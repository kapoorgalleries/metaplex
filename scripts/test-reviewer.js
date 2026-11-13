#!/usr/bin/env node
// Tests for scripts/reviewer.js and .github/workflows/ai-reviewer.yml.
//
// Covers:
//   1. CLI option parsing (parseArgs) and validation
//   2. JSON / agy envelope extraction and schema validation
//   3. agy binary resolution across Linux/Windows and child env scrubbing
//   4. Static diff analyzer (line numbers across multi-hunk/multi-file diffs,
//      conflict markers, credential detectors, placeholder/removal exemptions)
//   5. End-to-end reviewer execution with mock agy subprocesses (APPROVE,
//      REQUEST_CHANGES, model fallback, OAuth prompt kill, hang timeout kill,
//      prompt-injection / post-truncation secret floor, missing/invalid inputs)
//   6. Workflow policy & live HTTPS execution of .github/workflows/ai-reviewer.yml
//      (no script injection in `run:` blocks, real notification defaults,
//      GITHUB_OUTPUT newline sanitization, TLS enforcement, Slack + SendGrid
//      delivery with hostile PR titles/summaries, partial-failure resilience)
//
// Run: node scripts/test-reviewer.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const {
  DEFAULT_MODELS,
  DEFAULT_TIMEOUT_MS,
  parseArgs,
  resolveAgyBin,
  isValidVerdict,
  extractJsonObject,
  parseAgyStdout,
  buildAgyEnv,
  staticFallbackReview,
  run,
} = require('./reviewer.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ai-reviewer.yml');

let failures = 0;

function recordPass(name) {
  console.log(`ok   ${name}`);
}

function recordFail(name, err) {
  failures++;
  console.error(`FAIL ${name}: ${err && err.stack ? err.message : String(err)}`);
}

function check(name, fn) {
  try {
    fn();
    recordPass(name);
  } catch (err) {
    recordFail(name, err);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    recordPass(name);
  } catch (err) {
    recordFail(name, err);
  }
}

function haveCmd(cmd, versionArg = '--version') {
  const res = spawnSync(cmd, [versionArg], { stdio: 'ignore' });
  return !res.error && res.status === 0;
}

function extractYamlRunBlock(yamlText, stepName) {
  const lines = yamlText.split(/\r?\n/);
  const escaped = stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stepRe = new RegExp(`^(\\s*)-\\s+name:\\s+${escaped}\\s*$`);

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(stepRe);
    if (!m) continue;
    const stepIndent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === '' || line.trim().startsWith('#')) continue;
      const indent = line.match(/^\s*/)[0].length;
      if (indent <= stepIndent) break;
      const runMatch = line.match(/^(\s*)run:\s*\|\s*$/);
      if (runMatch) {
        const runIndent = runMatch[1].length;
        const body = [];
        let blockIndent = null;
        for (let k = j + 1; k < lines.length; k++) {
          const raw = lines[k];
          if (raw.trim() === '') {
            body.push('');
            continue;
          }
          const curIndent = raw.match(/^\s*/)[0].length;
          if (curIndent <= runIndent) break;
          if (blockIndent === null) blockIndent = curIndent;
          body.push(raw.slice(blockIndent));
        }
        return body.join('\n');
      }
    }
  }
  throw new Error(`Could not find run: | block for step "${stepName}"`);
}

function listenHttpsServer(certPem, keyPem, handler) {
  return new Promise((resolve, reject) => {
    const server = https.createServer({ cert: certPem, key: keyPem }, handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

function closeServer(server) {
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  return new Promise((resolve) => server.close(() => resolve()));
}

function runBashAsync(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', script], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-reviewer-'));

  try {
    // --------------------------------------------------------- 1. parseArgs
    check('parseArgs: defaults when no args given', () => {
      const opts = parseArgs([], {});
      assert.strictEqual(opts.help, false);
      assert.deepStrictEqual(opts.models, DEFAULT_MODELS);
      assert.strictEqual(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
      assert.ok(opts.diffPath.endsWith(path.join('gemini', 'pr26.diff')));
      assert.ok(opts.outputPath.endsWith(path.join('gemini', 'review_result.json')));
    });

    check('parseArgs: positional diffPath and outputPath', () => {
      const opts = parseArgs(['/tmp/a.diff', '/tmp/out.json'], {});
      assert.strictEqual(opts.diffPath, '/tmp/a.diff');
      assert.strictEqual(opts.outputPath, '/tmp/out.json');
    });

    check('parseArgs: supports agy-mcp-server invocation [diffPath, --model, id]', () => {
      const opts = parseArgs(['/tmp/a.diff', '--model', 'gemini-3.8-flash-medium'], {});
      assert.strictEqual(opts.diffPath, '/tmp/a.diff');
      assert.deepStrictEqual(opts.models, ['gemini-3.8-flash-medium']);
      assert.ok(opts.outputPath.endsWith('review_result.json'));
    });

    check('parseArgs: supports --model=, --output=, --timeout-ms=', () => {
      const opts = parseArgs(
        ['--model=m1', '--model', 'm2', '--output=/tmp/r.json', '--timeout-ms=4500', 'in.diff'],
        {}
      );
      assert.strictEqual(opts.diffPath, 'in.diff');
      assert.strictEqual(opts.outputPath, '/tmp/r.json');
      assert.deepStrictEqual(opts.models, ['m1', 'm2']);
      assert.strictEqual(opts.timeoutMs, 4500);
    });

    check('parseArgs: supports -- end-of-options for dash-prefixed paths', () => {
      const opts = parseArgs(['--', '-leading-dash.diff', '-out.json'], {});
      assert.strictEqual(opts.diffPath, '-leading-dash.diff');
      assert.strictEqual(opts.outputPath, '-out.json');
    });

    check('parseArgs: rejects invalid flags and invalid timeout values', () => {
      assert.throws(() => parseArgs(['--bogus'], {}), /Unknown option: --bogus/);
      assert.throws(() => parseArgs(['--model'], {}), /Missing value for --model/);
      assert.throws(() => parseArgs(['--model', '--output'], {}), /Missing value for --model/);
      assert.throws(() => parseArgs(['--output'], {}), /Missing value for --output/);
      assert.throws(() => parseArgs(['--timeout-ms', '0'], {}), /Invalid --timeout-ms/);
      assert.throws(() => parseArgs(['--timeout-ms', '-10'], {}), /Invalid --timeout-ms/);
      assert.throws(() => parseArgs(['--timeout-ms', '12.5'], {}), /Invalid --timeout-ms/);
      assert.throws(() => parseArgs(['a', 'b', 'c'], {}), /Too many positional arguments/);
      assert.throws(() => parseArgs([], { AGY_TIMEOUT_MS: 'nan' }), /Invalid AGY_TIMEOUT_MS/);
    });

    // ----------------------------------------- 2. JSON & envelope extraction
    check('isValidVerdict: validates schema strictly', () => {
      assert.strictEqual(
        isValidVerdict({ verdict: 'APPROVE', summary: 'ok', issues: [] }),
        true
      );
      assert.strictEqual(
        isValidVerdict({
          verdict: 'REQUEST_CHANGES',
          summary: 'bad',
          issues: [{ file: 'a.js', line: 10, message: 'bug' }],
        }),
        true
      );
      assert.strictEqual(isValidVerdict(null), false);
      assert.strictEqual(isValidVerdict([]), false);
      assert.strictEqual(
        isValidVerdict({ verdict: 'MAYBE', summary: 'ok', issues: [] }),
        false
      );
      assert.strictEqual(
        isValidVerdict({ verdict: 'APPROVE', summary: 'ok', issues: ['not-an-object'] }),
        false
      );
      assert.strictEqual(
        isValidVerdict({
          verdict: 'APPROVE',
          summary: 'ok',
          issues: [{ file: 'a.js', line: NaN, message: 'bad line' }],
        }),
        false
      );
    });

    check('parseAgyStdout: parses direct JSON, agy envelope, fenced JSON, and nested braces', () => {
      const direct = parseAgyStdout(
        '{"verdict":"APPROVE","summary":"Looks {good} and \\"safe\\"","issues":[]}'
      );
      assert.strictEqual(direct.verdict, 'APPROVE');

      const envelope = parseAgyStdout(
        JSON.stringify({
          response:
            'Here is the result:\n```json\n{"verdict":"REQUEST_CHANGES","summary":"Found 1 bug","issues":[{"file":"x.ts","line":4,"message":"oops"}]}\n```',
        })
      );
      assert.strictEqual(envelope.verdict, 'REQUEST_CHANGES');
      assert.strictEqual(envelope.issues.length, 1);
      assert.strictEqual(envelope.issues[0].file, 'x.ts');

      const noisyNdjson = parseAgyStdout(
        [
          'Spinner: thinking...',
          '{"status":"running"}',
          JSON.stringify({
            response: '{"verdict":"APPROVE","summary":"Clean diff","issues":[]}',
          }),
        ].join('\n')
      );
      assert.strictEqual(noisyNdjson.verdict, 'APPROVE');
    });

    check('parseAgyStdout: rejects empty envelope and non-verdict responses', () => {
      assert.throws(() => extractJsonObject('   '), /Response was empty/);
      assert.throws(
        () => parseAgyStdout(JSON.stringify({ response: '   ' })),
        /Agy response field was empty/
      );
      assert.throws(
        () => parseAgyStdout('No JSON object anywhere here'),
        /did not contain a valid JSON verdict/
      );
    });

    // ----------------------------------------- 3. resolveAgyBin & buildAgyEnv
    check('resolveAgyBin: honors AGY_BIN, Linux ~/.local/bin, Windows LOCALAPPDATA/USERPROFILE, and null fallback', () => {
      assert.strictEqual(
        resolveAgyBin({ AGY_BIN: '/custom/agy' }, 'linux', '/home/none'),
        '/custom/agy'
      );

      const fakeHome = path.join(tmpRoot, 'home-linux');
      const localBin = path.join(fakeHome, '.local', 'bin');
      fs.mkdirSync(localBin, { recursive: true });
      const binFile = path.join(localBin, 'agy');
      fs.writeFileSync(binFile, '#!/bin/sh\nexit 0\n', 'utf8');
      if (process.platform !== 'win32') {
        fs.chmodSync(binFile, 0o644);
        assert.strictEqual(resolveAgyBin({ PATH: '' }, 'linux', fakeHome), null);
        fs.chmodSync(binFile, 0o755);
      }
      assert.strictEqual(resolveAgyBin({ PATH: '' }, 'linux', fakeHome), binFile);

      assert.strictEqual(
        resolveAgyBin({ PATH: '/nonexistent-dir-1:/nonexistent-dir-2' }, 'linux', '/nonexistent-home'),
        null
      );
    });

    check('buildAgyEnv: scrubs CI notification secrets and GitHub token from child env', () => {
      const scrubbed = buildAgyEnv({
        PATH: '/usr/bin',
        HOME: '/tmp',
        SLACK_WEBHOOK_URL: 'https://example.invalid/webhook',
        EMAIL_API_KEY: 'secret-key',
        GITHUB_TOKEN: 'gh-token',
      });
      assert.strictEqual(scrubbed.PATH, '/usr/bin');
      assert.strictEqual('SLACK_WEBHOOK_URL' in scrubbed, false);
      assert.strictEqual('EMAIL_API_KEY' in scrubbed, false);
      assert.strictEqual('GITHUB_TOKEN' in scrubbed, false);
    });

    // ----------------------------------------- 4. staticFallbackReview
    check('staticFallbackReview: approves empty and whitespace-only diffs', () => {
      assert.strictEqual(staticFallbackReview('').verdict, 'APPROVE');
      assert.strictEqual(staticFallbackReview('   \n\t\r\n  ').verdict, 'APPROVE');
    });

    check('staticFallbackReview: approves clean multi-file diff including deletions, renames, and C-quoted paths', () => {
      const cleanDiff = [
        'diff --git a/old.txt b/old.txt',
        'deleted file mode 100644',
        '--- a/old.txt',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-legacy line',
        '-api_key = "' + 'RemovedOldSecretValue9999' + '"',
        'diff --git "a/notes/tab\\tname.md" "b/notes/tab\\tname.md"',
        '--- "a/notes/tab\\tname.md"',
        '+++ "b/notes/tab\\tname.md"',
        '@@ -1,1 +1,2 @@',
        ' heading',
        '+clean note line',
        'diff --git a/src/app.js b/src/app.js',
        '--- a/src/app.js',
        '+++ b/src/app.js',
        '@@ -10,3 +10,5 @@',
        ' const x = 1;',
        '+// ======== section divider (8 equals, not a conflict marker) ========',
        '+const apiKey = process.env.EMAIL_API_KEY;',
        '+const placeholder = "a-passphrase-of-at-least-32-characters!!";',
        ' return x;',
      ].join('\n');
      const res = staticFallbackReview(cleanDiff);
      assert.strictEqual(res.verdict, 'APPROVE');
      assert.deepStrictEqual(res.issues, []);
      assert.ok(res.summary.includes('3 file(s)'));
    });

    check('staticFallbackReview: flags conflict markers and credential formats with exact line numbers', () => {
      // Construct synthetic credential strings dynamically so this test file
      // itself never contains literal secret-like tokens in git diffs.
      const fakeHf = ['hf', 'A9b8C7d6E5f4G3h2I1j0K9l8M7n6'].join('_');
      const fakeSg = ['SG', 'a1B2c3D4e5F6g7H8i9', 'j0K1l2M3n4O5p6Q7r8'].join('.');
      const fakeSlackHook =
        'https://hooks.' +
        'slack.com/services/' +
        'T9ABCDEF12/B8ZYXWVU34/' +
        'mN9pQ2rS5tU8vW1xY4zA7bC0';
      const fakeGeneric = 'client_secret = "' + 'Zx9Yw8Vu7Ts6Rq5Po4' + '"';
      const fakePem = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----';

      const badDiff = [
        'diff --git a/config.js b/config.js',
        '--- a/config.js',
        '+++ b/config.js',
        '@@ -1,2 +1,5 @@',
        ' const clean = true;',
        '+<<<<<<< HEAD',
        '+const hf = "' + fakeHf + '";',
        '+=======',
        '+>>>>>>> feature',
        '@@ -20,1 +23,4 @@',
        ' // second hunk',
        '+const sg = "' + fakeSg + '";',
        '+const hook = "' + fakeSlackHook + '";',
        '+' + fakeGeneric,
        'diff --git a/key.pem b/key.pem',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/key.pem',
        '@@ -0,0 +1,1 @@',
        '+' + fakePem,
      ].join('\r\n');

      const res = staticFallbackReview(badDiff);
      assert.strictEqual(res.verdict, 'REQUEST_CHANGES');
      const byFileLine = res.issues.map((i) => `${i.file}:${i.line}`);
      assert.deepStrictEqual(byFileLine, [
        'config.js:2',
        'config.js:3',
        'config.js:4',
        'config.js:5',
        'config.js:24',
        'config.js:25',
        'config.js:26',
        'key.pem:1',
      ]);
    });

    // ----------------------------------- 5. End-to-end run() with mock agy
    const mockAgyScript = path.join(tmpRoot, 'mock-agy.js');
    fs.writeFileSync(
      mockAgyScript,
      [
        '#!/usr/bin/env node',
        'const fs = require("fs");',
        'const mode = process.env.MOCK_AGY_MODE || "approve";',
        'const args = process.argv.slice(2);',
        'const modelIdx = args.indexOf("--model");',
        'const model = modelIdx >= 0 ? args[modelIdx + 1] : "";',
        'if (process.env.MOCK_AGY_ENV_DUMP) {',
        '  fs.writeFileSync(process.env.MOCK_AGY_ENV_DUMP, JSON.stringify(process.env), "utf8");',
        '}',
        'let input = "";',
        'process.stdin.on("data", (d) => { input += d.toString(); });',
        'process.stdin.on("end", () => {',
        '  if (mode === "approve") {',
        '    console.log(JSON.stringify({ response: JSON.stringify({ verdict: "APPROVE", summary: "Approved by " + model, issues: [] }) }));',
        '    process.exit(0);',
        '  }',
        '  if (mode === "request_changes") {',
        '    console.log(JSON.stringify({ verdict: "REQUEST_CHANGES", summary: "Logic flaw", issues: [{ file: "a.js", line: 2, message: "Broken guard" }] }));',
        '    process.exit(0);',
        '  }',
        '  if (mode === "fallback_second") {',
        '    if (model === "gemini-3.8-flash-medium") {',
        '      console.error("primary model overloaded");',
        '      process.exit(2);',
        '    }',
        '    console.log(JSON.stringify({ response: "```json\\n{\\"verdict\\":\\"APPROVE\\",\\"summary\\":\\"Fallback model succeeded\\",\\"issues\\":[]}\\n```" }));',
        '    process.exit(0);',
        '  }',
        '  if (mode === "auth_hang") {',
        '    process.stderr.write("Authentication required: open browser\\n");',
        '    setTimeout(() => {}, 30000);',
        '    return;',
        '  }',
        '  if (mode === "timeout_hang") {',
        '    setTimeout(() => {}, 30000);',
        '    return;',
        '  }',
        '  process.exit(1);',
        '});',
      ].join('\n'),
      'utf8'
    );

    // Cross-platform wrapper (.cmd on win32, executable .sh on POSIX)
    const mockAgyLauncher =
      process.platform === 'win32'
        ? path.join(tmpRoot, 'mock-agy.cmd')
        : path.join(tmpRoot, 'mock-agy.sh');
    if (process.platform === 'win32') {
      fs.writeFileSync(
        mockAgyLauncher,
        `@echo off\r\n"${process.execPath}" "${mockAgyScript}" %*\r\n`,
        'utf8'
      );
    } else {
      fs.writeFileSync(
        mockAgyLauncher,
        `#!/bin/sh\nexec "${process.execPath}" "${mockAgyScript}" "$@"\n`,
        'utf8'
      );
      fs.chmodSync(mockAgyLauncher, 0o755);
    }

    const cleanSampleDiff = path.join(tmpRoot, 'clean.diff');
    fs.writeFileSync(
      cleanSampleDiff,
      [
        'diff --git a/hello.js b/hello.js',
        '--- a/hello.js',
        '+++ b/hello.js',
        '@@ -1,1 +1,2 @@',
        ' console.log("hi");',
        '+console.log("world");',
      ].join('\n'),
      'utf8'
    );

    await checkAsync('run(): exits 0 on APPROVE and scrubs secrets from agy subprocess env', async () => {
      const outPath = path.join(tmpRoot, 'out-approve.json');
      const envDump = path.join(tmpRoot, 'env-dump.json');
      const code = await run([cleanSampleDiff, outPath], {
        ...process.env,
        AGY_BIN: mockAgyLauncher,
        MOCK_AGY_MODE: 'approve',
        MOCK_AGY_ENV_DUMP: envDump,
        SLACK_WEBHOOK_URL: 'https://example.invalid/secret',
        EMAIL_API_KEY: 'test_email_api_key_placeholder',
        GITHUB_TOKEN: 'test_gh_token',
      });
      assert.strictEqual(code, 0);
      const result = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      assert.strictEqual(result.verdict, 'APPROVE');
      assert.strictEqual(result.summary, 'Approved by gemini-3.8-flash-medium');

      const dumped = JSON.parse(fs.readFileSync(envDump, 'utf8'));
      assert.strictEqual('SLACK_WEBHOOK_URL' in dumped, false);
      assert.strictEqual('EMAIL_API_KEY' in dumped, false);
      assert.strictEqual('GITHUB_TOKEN' in dumped, false);
    });

    await checkAsync('run(): exits 1 when agy returns REQUEST_CHANGES', async () => {
      const outPath = path.join(tmpRoot, 'out-reject.json');
      const code = await run([cleanSampleDiff, outPath], {
        ...process.env,
        AGY_BIN: mockAgyLauncher,
        MOCK_AGY_MODE: 'request_changes',
      });
      assert.strictEqual(code, 1);
      const result = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      assert.strictEqual(result.verdict, 'REQUEST_CHANGES');
      assert.strictEqual(result.issues.length, 1);
    });

    await checkAsync('run(): retries fallback model when primary model fails', async () => {
      const outPath = path.join(tmpRoot, 'out-fallback.json');
      const code = await run([cleanSampleDiff, outPath], {
        ...process.env,
        AGY_BIN: mockAgyLauncher,
        MOCK_AGY_MODE: 'fallback_second',
      });
      assert.strictEqual(code, 0);
      const result = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      assert.strictEqual(result.verdict, 'APPROVE');
      assert.strictEqual(result.summary, 'Fallback model succeeded');
    });

    if (process.platform !== 'win32') {
      await checkAsync('run(): kills auth-prompting agy process and falls back to static review', async () => {
        const outPath = path.join(tmpRoot, 'out-auth.json');
        const code = await run([cleanSampleDiff, outPath, '--model', 'm1'], {
          ...process.env,
          AGY_BIN: mockAgyLauncher,
          MOCK_AGY_MODE: 'auth_hang',
        });
        assert.strictEqual(code, 0);
        const result = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        assert.strictEqual(result.verdict, 'APPROVE');
      });

      await checkAsync('run(): kills hung agy process after --timeout-ms and falls back cleanly', async () => {
        const outPath = path.join(tmpRoot, 'out-timeout.json');
        const start = Date.now();
        const code = await run(
          [cleanSampleDiff, outPath, '--model', 'm1', '--timeout-ms', '200'],
          {
            ...process.env,
            AGY_BIN: mockAgyLauncher,
            MOCK_AGY_MODE: 'timeout_hang',
          }
        );
        const elapsed = Date.now() - start;
        assert.strictEqual(code, 0);
        assert.ok(elapsed < 5000, `Expected fast timeout, took ${elapsed}ms`);
        const result = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        assert.strictEqual(result.verdict, 'APPROVE');
      });
    }

    await checkAsync('run(): overrides model APPROVE when secret appears past prompt truncation limit', async () => {
      const longDiffPath = path.join(tmpRoot, 'long-secret.diff');
      const padding = Array.from({ length: 600 }, (_, i) => `+const line_${i} = ${i};`).join('\n');
      const tailToken = ['ghp', 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4'].join('_');
      fs.writeFileSync(
        longDiffPath,
        [
          'diff --git a/big.js b/big.js',
          '--- a/big.js',
          '+++ b/big.js',
          '@@ -1,0 +1,602 @@',
          padding,
          `+const leaked = "${tailToken}";`,
        ].join('\n'),
        'utf8'
      );
      const outPath = path.join(tmpRoot, 'out-long.json');
      const code = await run([longDiffPath, outPath], {
        ...process.env,
        AGY_BIN: mockAgyLauncher,
        MOCK_AGY_MODE: 'approve',
      });
      assert.strictEqual(code, 1);
      const result = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      assert.strictEqual(result.verdict, 'REQUEST_CHANGES');
      assert.strictEqual(result.issues.length, 1);
      assert.strictEqual(result.issues[0].file, 'big.js');
    });

    await checkAsync('run(): exits 1 and writes error JSON when diff file is missing or a directory', async () => {
      const outMissing = path.join(tmpRoot, 'out-missing.json');
      const codeMissing = await run([path.join(tmpRoot, 'does-not-exist.diff'), outMissing], {});
      assert.strictEqual(codeMissing, 1);
      const resMissing = JSON.parse(fs.readFileSync(outMissing, 'utf8'));
      assert.strictEqual(resMissing.verdict, 'REQUEST_CHANGES');

      const outDir = path.join(tmpRoot, 'out-dir.json');
      const codeDir = await run([tmpRoot, outDir], {});
      assert.strictEqual(codeDir, 1);
      const resDir = JSON.parse(fs.readFileSync(outDir, 'utf8'));
      assert.strictEqual(resDir.verdict, 'REQUEST_CHANGES');

      if (process.platform !== 'win32' && fs.existsSync('/dev/null')) {
        const outDevNull = path.join(tmpRoot, 'out-devnull.json');
        const codeDevNull = await run(['/dev/null', outDevNull], {});
        assert.strictEqual(codeDevNull, 0);
        const resDevNull = JSON.parse(fs.readFileSync(outDevNull, 'utf8'));
        assert.strictEqual(resDevNull.verdict, 'APPROVE');
      }
    });

    // ------------------ 6. Workflow policy & live HTTPS notification tests
    const workflowText = fs.readFileSync(WORKFLOW_PATH, 'utf8');

    check('ai-reviewer.yml: enforces security, pinning, real addresses, and zero run-block template interpolation', () => {
      assert.ok(!workflowText.includes('yourcompany.com'), 'Placeholder yourcompany.com must not appear');
      assert.ok(!workflowText.includes('example.com'), 'Placeholder example.com must not appear');
      assert.ok(workflowText.includes('sanjay@kapoors.com'), 'Expected verified default recipient sanjay@kapoors.com');
      assert.ok(workflowText.includes('info@kapoors.com'), 'Expected verified default sender info@kapoors.com');
      assert.ok(workflowText.includes('uses: actions/checkout@v5'), 'Expected actions/checkout@v5');
      assert.ok(workflowText.includes('uses: actions/setup-node@v7'), 'Expected actions/setup-node@v7');
      assert.ok(workflowText.includes('uses: actions/upload-artifact@v6'), 'Expected actions/upload-artifact@v6');
      assert.ok(workflowText.includes('node scripts/test-reviewer.js'), 'Expected test-reviewer.js step in CI');
      assert.ok(workflowText.includes('node scripts/reviewer.js'), 'Expected reviewer.js step in CI');
      assert.ok(workflowText.includes('needs: [report_verdict]'), 'Expected notify_failure to depend on report_verdict');
      assert.ok(
        workflowText.includes("if: failure() && needs.report_verdict.result == 'failure'"),
        'Expected strict failure() guard on notify_failure'
      );

      // Verify NO `run: |` block interpolates `${{ ... }}` directly (prevents script injection).
      for (const stepName of ['Generate pull request diff', 'Record review summary', 'Send Notifications']) {
        const scriptBody = extractYamlRunBlock(workflowText, stepName);
        assert.ok(
          !scriptBody.includes('${{'),
          `Step "${stepName}" must pass GitHub expressions via env:, not inline \${{ ... }}`
        );
      }
    });

    check('repo self-check: committed reviewer and workflow files pass staticFallbackReview cleanly', () => {
      const filesToCheck = [
        path.join(REPO_ROOT, 'scripts', 'reviewer.js'),
        path.join(REPO_ROOT, 'scripts', 'test-reviewer.js'),
        WORKFLOW_PATH,
      ];
      const syntheticDiffChunks = [];
      for (const filePath of filesToCheck) {
        const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
        syntheticDiffChunks.push(
          `diff --git a/${rel} b/${rel}`,
          '--- /dev/null',
          `+++ b/${rel}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...lines.map((l) => `+${l}`)
        );
      }
      const res = staticFallbackReview(syntheticDiffChunks.join('\n'));
      assert.strictEqual(
        res.verdict,
        'APPROVE',
        `Self-check failed with issues: ${JSON.stringify(res.issues)}`
      );
    });

    if (
      process.platform !== 'win32' &&
      haveCmd('bash', '--version') &&
      haveCmd('curl', '--version') &&
      haveCmd('openssl', 'version')
    ) {
      const diffGenScript = extractYamlRunBlock(workflowText, 'Generate pull request diff');
      const recordScript = extractYamlRunBlock(workflowText, 'Record review summary');
      const notifyScript = extractYamlRunBlock(workflowText, 'Send Notifications');

      if (haveCmd('git', '--version')) {
        check('ai-reviewer.yml Generate pull request diff: supports BASE_SHA...HEAD_SHA and origin/BASE_REF fallback', () => {
          const gitRepo = fs.mkdtempSync(path.join(tmpRoot, 'git-diff-'));
          const gitEnv = {
            ...process.env,
            GIT_AUTHOR_NAME: 'test',
            GIT_AUTHOR_EMAIL: 'test@users.noreply.github.com',
            GIT_COMMITTER_NAME: 'test',
            GIT_COMMITTER_EMAIL: 'test@users.noreply.github.com',
          };
          assert.strictEqual(spawnSync('git', ['init', '-b', 'master'], { cwd: gitRepo, env: gitEnv }).status, 0);
          fs.writeFileSync(path.join(gitRepo, 'file.txt'), 'base\n', 'utf8');
          assert.strictEqual(spawnSync('git', ['add', 'file.txt'], { cwd: gitRepo, env: gitEnv }).status, 0);
          assert.strictEqual(spawnSync('git', ['commit', '-m', 'base'], { cwd: gitRepo, env: gitEnv }).status, 0);
          const baseSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: gitRepo, encoding: 'utf8' }).stdout.trim();
          assert.strictEqual(
            spawnSync('git', ['update-ref', 'refs/remotes/origin/master', baseSha], { cwd: gitRepo, env: gitEnv }).status,
            0
          );

          assert.strictEqual(spawnSync('git', ['checkout', '-b', 'feat'], { cwd: gitRepo, env: gitEnv }).status, 0);
          fs.writeFileSync(path.join(gitRepo, 'file.txt'), 'base\nadded line\n', 'utf8');
          assert.strictEqual(spawnSync('git', ['commit', '-am', 'feat'], { cwd: gitRepo, env: gitEnv }).status, 0);
          const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: gitRepo, encoding: 'utf8' }).stdout.trim();

          const runTmp1 = fs.mkdtempSync(path.join(tmpRoot, 'diff1-'));
          const p1 = spawnSync('bash', ['-c', diffGenScript], {
            cwd: gitRepo,
            env: { ...gitEnv, RUNNER_TEMP: runTmp1, BASE_SHA: baseSha, HEAD_SHA: headSha, BASE_REF: 'master' },
            encoding: 'utf8',
          });
          assert.strictEqual(p1.status, 0, p1.stderr);
          assert.ok(fs.readFileSync(path.join(runTmp1, 'pr.diff'), 'utf8').includes('+added line'));

          const runTmp2 = fs.mkdtempSync(path.join(tmpRoot, 'diff2-'));
          const p2 = spawnSync('bash', ['-c', diffGenScript], {
            cwd: gitRepo,
            env: { ...gitEnv, RUNNER_TEMP: runTmp2, BASE_SHA: '', HEAD_SHA: '', BASE_REF: 'master' },
            encoding: 'utf8',
          });
          assert.strictEqual(p2.status, 0, p2.stderr);
          assert.ok(fs.readFileSync(path.join(runTmp2, 'pr.diff'), 'utf8').includes('+added line'));
        });
      }

      check('ai-reviewer.yml Record review summary: sanitizes newlines against GITHUB_OUTPUT injection', () => {
        const stepTmp = fs.mkdtempSync(path.join(tmpRoot, 'record-'));
        const ghOut = path.join(stepTmp, 'github_output.txt');
        const ghSum = path.join(stepTmp, 'step_summary.md');
        fs.writeFileSync(ghOut, '', 'utf8');
        fs.writeFileSync(ghSum, '', 'utf8');
        fs.writeFileSync(
          path.join(stepTmp, 'review_result.json'),
          JSON.stringify({
            verdict: 'REQUEST_CHANGES\ninjected_key=evil',
            summary: 'Line 1\r\nmalicious_output=pwned\nLine 3',
            issues: [{ file: 'src/x.js', line: 7, message: 'Bad token' }],
          }),
          'utf8'
        );

        const proc = spawnSync('bash', ['-c', recordScript], {
          env: {
            ...process.env,
            RUNNER_TEMP: stepTmp,
            GITHUB_OUTPUT: ghOut,
            GITHUB_STEP_SUMMARY: ghSum,
          },
          encoding: 'utf8',
        });
        assert.strictEqual(proc.status, 0, proc.stderr);

        const outputLines = fs.readFileSync(ghOut, 'utf8').trim().split('\n');
        assert.strictEqual(outputLines.length, 2, `Expected exactly 2 output lines, got: ${outputLines.join(' | ')}`);
        assert.ok(outputLines[0].startsWith('verdict=REQUEST_CHANGES injected_key=evil'));
        assert.ok(outputLines[1].startsWith('summary=Line 1 malicious_output=pwned Line 3'));
        assert.ok(fs.readFileSync(ghSum, 'utf8').includes('`src/x.js:7`: Bad token'));
      });

      // Generate ephemeral self-signed TLS cert for 127.0.0.1 to test real curl --proto '=https' --tlsv1.2
      const certPath = path.join(tmpRoot, 'cert.pem');
      const keyPath = path.join(tmpRoot, 'key.pem');
      const genCert = spawnSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-days',
          '1',
          '-subj',
          '/CN=127.0.0.1',
          '-addext',
          'subjectAltName=IP:127.0.0.1',
        ],
        { encoding: 'utf8' }
      );
      assert.strictEqual(genCert.status, 0, `openssl cert generation failed: ${genCert.stderr}`);

      const certPem = fs.readFileSync(certPath, 'utf8');
      const keyPem = fs.readFileSync(keyPath, 'utf8');

      await checkAsync('ai-reviewer.yml Send Notifications: exits 0 with warnings when secrets are unset or whitespace-only', async () => {
        const proc = spawnSync('bash', ['-c', notifyScript], {
          env: {
            PATH: process.env.PATH,
            HOME: tmpRoot,
            SLACK_WEBHOOK_URL: '   \r\n\t  ',
            EMAIL_API_KEY: '  \n ',
            PR_NUMBER: '42',
          },
          encoding: 'utf8',
        });
        assert.strictEqual(proc.status, 0, proc.stderr);
        assert.ok(proc.stdout.includes('::warning::SLACK_WEBHOOK_URL secret is not configured'));
        assert.ok(proc.stdout.includes('::warning::EMAIL_API_KEY secret is not configured'));
      });

      await checkAsync('ai-reviewer.yml Send Notifications: delivers valid Slack & SendGrid JSON over TLS with hostile strings', async () => {
        const received = [];
        let slackStatus = 200;

        const { server, port } = await listenHttpsServer(certPem, keyPem, (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            received.push({
              url: req.url,
              method: req.method,
              headers: req.headers,
              body,
            });
            if (req.url === '/slack') {
              res.writeHead(slackStatus, { 'Content-Type': 'text/plain' });
              res.end(slackStatus === 200 ? 'ok' : 'slack error');
            } else if (req.url === '/v3/mail/send') {
              res.writeHead(202, { 'Content-Type': 'application/json' });
              res.end('');
            } else {
              res.writeHead(404);
              res.end();
            }
          });
        });

        try {
          const pwnMarker = path.join(tmpRoot, 'should-not-exist');
          const hostileTitle = `Fix "quotes" \\backslash\\ $(touch ${pwnMarker}) \`touch ${pwnMarker}\``;
          const hostileSummary = `Found 'bug' & "leak" $(touch ${pwnMarker})`;

          // 1. Happy path with trailing CR/LF whitespace in secrets
          const okRun = await runBashAsync(notifyScript, {
            PATH: process.env.PATH,
            HOME: tmpRoot,
            CURL_CA_BUNDLE: certPath,
            SLACK_WEBHOOK_URL: `  https://127.0.0.1:${port}/slack\r\n`,
            EMAIL_API_KEY: '  test-sendgrid-token-value\r\n',
            SENDGRID_API_URL: `https://127.0.0.1:${port}/v3/mail/send`,
            PR_NUMBER: '40',
            PR_URL: 'https://github.com/kapoorgalleries/metaplex/pull/40',
            PR_TITLE: hostileTitle,
            REPO_FULL_NAME: 'kapoorgalleries/metaplex',
            RUN_URL: 'https://github.com/kapoorgalleries/metaplex/actions/runs/999',
            REVIEW_SUMMARY: hostileSummary,
          });
          assert.strictEqual(okRun.status, 0, `${okRun.stdout}\n${okRun.stderr}`);
          assert.strictEqual(fs.existsSync(pwnMarker), false, 'Shell injection marker must not exist');
          assert.strictEqual(received.length, 2);

          const slackReq = received.find((r) => r.url === '/slack');
          const emailReq = received.find((r) => r.url === '/v3/mail/send');
          assert.ok(slackReq, 'Expected Slack webhook POST');
          assert.ok(emailReq, 'Expected SendGrid API POST');

          const slackJson = JSON.parse(slackReq.body);
          assert.ok(slackJson.text.includes('#40'));
          assert.ok(slackJson.text.includes(hostileTitle));
          assert.ok(slackJson.text.includes(hostileSummary));

          assert.strictEqual(emailReq.headers.authorization, 'Bearer test-sendgrid-token-value');
          const emailJson = JSON.parse(emailReq.body);
          assert.strictEqual(emailJson.personalizations[0].to[0].email, 'sanjay@kapoors.com');
          assert.strictEqual(emailJson.from.email, 'info@kapoors.com');
          assert.ok(emailJson.subject.includes('Build Failed: PR #40'));
          assert.ok(emailJson.content[0].value.includes(hostileSummary));

          // 2. Partial failure + comma-separated deduplicated EMAIL_TO: Slack returns 500, SendGrid MUST still be called and step exits 1
          received.length = 0;
          slackStatus = 500;
          const partialFail = await runBashAsync(notifyScript, {
            PATH: process.env.PATH,
            HOME: tmpRoot,
            CURL_CA_BUNDLE: certPath,
            SLACK_WEBHOOK_URL: `https://127.0.0.1:${port}/slack`,
            EMAIL_API_KEY: 'test-sendgrid-token-value',
            EMAIL_TO: 'sanjay@kapoors.com, INFO@kapoors.com, info@kapoors.com ',
            SENDGRID_API_URL: `https://127.0.0.1:${port}/v3/mail/send`,
            PR_NUMBER: '41',
          });
          assert.strictEqual(partialFail.status, 1, 'Expected exit 1 when Slack fails');
          assert.strictEqual(
            received.length,
            2,
            'SendGrid email must still be attempted even when Slack webhook fails'
          );
          const secondEmailJson = JSON.parse(received.find((r) => r.url === '/v3/mail/send').body);
          assert.deepStrictEqual(secondEmailJson.personalizations[0].to, [
            { email: 'sanjay@kapoors.com' },
            { email: 'INFO@kapoors.com' },
          ]);

          // 3. Plaintext http:// URL must be blocked by curl --proto '=https'
          const httpBlocked = await runBashAsync(notifyScript, {
            PATH: process.env.PATH,
            HOME: tmpRoot,
            SLACK_WEBHOOK_URL: `http://127.0.0.1:${port}/slack`,
            EMAIL_API_KEY: '',
            PR_NUMBER: '42',
          });
          assert.strictEqual(httpBlocked.status, 1, 'Plaintext http:// webhook must fail');
        } finally {
          await closeServer(server);
        }
      });
    } else {
      console.log('skip bash/curl/openssl workflow execution tests (tools unavailable on this platform)');
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log('\nall tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
