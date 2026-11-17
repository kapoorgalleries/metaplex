#!/usr/bin/env node
// Hardening tests for the AI reviewer pipeline (follow-up to PR #40).
//
// Covers:
//   M1  pre-push hook never blocks on infrastructure: missing scripts, REVIEWER_SKIP,
//       REVIEWER_OFFLINE, fail-open on agy outages (missing binary, 429/quota, timeout,
//       lock wait), pinned (not branch) script execution, and the static secret floor that
//       still blocks while the reviewer is down
//   M2  escaping / mention stripping / unfurl control / AI labelling for the job summary,
//       Slack, email and webhook sinks, exercised through the real workflow steps
//   M3  oversized diffs are reviewed in chunks and can never end as APPROVE with an
//       unreviewed tail
//   M4  REVIEWER_CHECK_QUOTA=0 skips only the 5% reserve, never the paid-overage guard
//   S   no-runner manual runs skip cleanly; env allowlist; log sanitising; run-root sweep and
//       signal cleanup; stale lock age limit
//
// Run: node scripts/test-reviewer-hardening.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const {
  createAuthHome,
  buildHealthyPermissionsEnvelope,
  buildHealthyUsageEnvelope,
  buildHealthyModelsEnvelope,
  extractYamlRunBlock,
} = require('./test-fake-agy');
const reviewer = require('./reviewer');
const prePush = require('./pre-push-review');
const sanitize = require('./ai-review-sanitize');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ai-reviewer.yml');
const NODE_DIR = path.dirname(process.execPath);
const HERMETIC_PATH = `${NODE_DIR}:/usr/bin:/bin`;

const SECRET_TOKEN = ['ghp', 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4'].join('_');

let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${name}: ${err && err.stack ? err.stack : String(err)}`);
  }
}

function git(cwd, args, env) {
  return spawnSync('git', args, { cwd, env, encoding: 'utf8' });
}

function gitEnvFor(home, extra = {}) {
  const base = { ...process.env };
  for (const k of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_PREFIX',
  ]) {
    delete base[k];
  }
  for (const k of Object.keys(base)) {
    if (/^(?:REVIEWER_|AGY_|ANTIGRAVITY_|REVIEW_)/.test(k)) delete base[k];
  }
  return {
    ...base,
    PATH: HERMETIC_PATH,
    HOME: home,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@users.noreply.github.com',
    ...extra,
  };
}

function makeMockAgy(dir, { name = 'mock-agy.js', usage, reviewBody, logFile }) {
  const usageEnvelope = usage || buildHealthyUsageEnvelope();
  const script = `
const fs = require("fs");
const argv = process.argv.slice(2);
const LOG = ${JSON.stringify(logFile || '')};
function log(entry) {
  if (LOG) fs.appendFileSync(LOG, JSON.stringify(entry) + "\\n");
}
if (argv.includes("/permissions")) {
  process.stdout.write(${JSON.stringify(JSON.stringify(buildHealthyPermissionsEnvelope()))} + "\\n");
  process.exit(0);
}
if (argv.includes("/usage")) {
  log({ call: "usage" });
  process.stdout.write(${JSON.stringify(JSON.stringify(usageEnvelope))} + "\\n");
  process.exit(0);
}
if (argv.includes("models")) {
  process.stdout.write("\\r\\x1b[K" + ${JSON.stringify(JSON.stringify(buildHealthyModelsEnvelope()))} + "\\n");
  process.exit(0);
}
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { prompt += d; });
process.stdin.on("end", () => {
  log({ call: "review", promptLength: prompt.length });
  ${reviewBody}
});
process.stdin.resume();
`;
  const scriptPath = path.join(dir, name);
  fs.writeFileSync(scriptPath, `#!/usr/bin/env node\n${script}\n`, { mode: 0o755 });
  return scriptPath;
}

const APPROVE_BODY = `
  process.stdout.write(JSON.stringify({
    conversation_id: "c",
    status: "SUCCESS",
    structured_output: { verdict: "APPROVE", summary: "Looks fine.", issues: [] }
  }) + "\\n");
`;

const QUOTA_429_BODY = `
  process.stderr.write("HTTP 429 RESOURCE_EXHAUSTED: quota exceeded for model\\n");
  process.exit(1);
`;

function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function fileDiff(name, lines) {
  return [
    `diff --git a/${name} b/${name}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${name}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
    '',
  ].join('\n');
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-reviewer-hardening-'));
  const authHome = createAuthHome(tmpRoot, 'auth-home');
  const emptyHome = fs.mkdtempSync(path.join(tmpRoot, 'empty-home-'));

  try {
    // ------------------------------------------------------------------ M1: pre-push hook
    const haveGit = !spawnSync('git', ['--version']).error;
    if (haveGit && process.platform !== 'win32') {
      const remoteBare = fs.mkdtempSync(path.join(tmpRoot, 'remote-'));
      const repo = fs.mkdtempSync(path.join(tmpRoot, 'repo-'));
      const env = gitEnvFor(emptyHome, { REVIEW_DIR: fs.mkdtempSync(path.join(tmpRoot, 'rev-')) });
      assert.strictEqual(git(remoteBare, ['init', '--bare', '-b', 'master'], env).status, 0);
      assert.strictEqual(git(repo, ['init', '-b', 'master'], env).status, 0);
      assert.strictEqual(git(repo, ['remote', 'add', 'origin', remoteBare], env).status, 0);
      fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
      assert.strictEqual(git(repo, ['add', '.'], env).status, 0);
      assert.strictEqual(git(repo, ['commit', '-m', 'init'], env).status, 0);
      assert.strictEqual(git(repo, ['push', '-u', 'origin', 'master'], env).status, 0);

      const installed = prePush.installPrePushHook(repo, { force: true });
      const pinnedDir = installed.pinnedDir;
      let branchCounter = 0;

      function pushNewBranch(pushEnv, files = { 'feature.js': 'module.exports = 1;\n' }) {
        branchCounter += 1;
        const branch = `feat-${branchCounter}`;
        assert.strictEqual(git(repo, ['checkout', '-b', branch, 'master'], env).status, 0);
        for (const [name, content] of Object.entries(files)) {
          fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
          fs.writeFileSync(path.join(repo, name), content);
        }
        assert.strictEqual(git(repo, ['add', '.'], env).status, 0);
        assert.strictEqual(git(repo, ['commit', '-m', `change ${branch}`], env).status, 0);
        const res = git(repo, ['push', 'origin', branch], pushEnv);
        assert.strictEqual(git(repo, ['checkout', '-f', 'master'], env).status, 0);
        return res;
      }

      await check('M1 hook: pins reviewer scripts outside the working tree and never hard-fails on missing scripts', () => {
        assert.ok(pinnedDir.startsWith(path.join(repo, '.git')));
        for (const name of ['pre-push-review.js', 'reviewer.js']) {
          assert.ok(fs.existsSync(path.join(pinnedDir, name)), `${name} must be pinned`);
        }
        const script = prePush.buildHookScript();
        assert.ok(script.includes('REVIEWER_SKIP'));
        assert.ok(!/failed closed/.test(script), 'hook shell must not fail closed on missing pieces');
        assert.ok(!script.includes('\u2014'), 'hook script must not contain em dashes');
      });

      await check('M1 hook: branch WITHOUT scripts/ is allowed and runs the pinned copy, not the branch copy', () => {
        const res = pushNewBranch(env);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.ok(/reviewer unavailable \(agy-missing\)/.test(res.stderr), res.stderr);
        assert.ok(!fs.existsSync(path.join(repo, 'scripts')), 'branch has no scripts/ dir');
      });

      await check('M1 hook: a branch-supplied malicious scripts/pre-push-review.js is never executed', () => {
        const marker = path.join(tmpRoot, 'pwned-marker');
        const res = pushNewBranch(env, {
          'scripts/pre-push-review.js': `require("fs").writeFileSync(${JSON.stringify(marker)}, "x"); process.exit(1);\n`,
          'scripts/reviewer.js': 'process.exit(1);\n',
        });
        assert.strictEqual(fs.existsSync(marker), false, 'branch copy must not run');
        assert.strictEqual(res.status, 0, res.stderr);
      });

      await check('M1 hook: missing pinned AND repo scripts warns and allows the push', () => {
        const saved = fs.mkdtempSync(path.join(tmpRoot, 'pinned-saved-'));
        for (const name of ['pre-push-review.js', 'reviewer.js']) {
          fs.renameSync(path.join(pinnedDir, name), path.join(saved, name));
        }
        try {
          const res = pushNewBranch(env);
          assert.strictEqual(res.status, 0, res.stderr);
          assert.ok(/SKIPPED, push allowed.*reviewer scripts not found/.test(res.stderr), res.stderr);
        } finally {
          for (const name of ['pre-push-review.js', 'reviewer.js']) {
            fs.renameSync(path.join(saved, name), path.join(pinnedDir, name));
          }
        }
      });

      await check('M1 hook: REVIEWER_SKIP=1 bypasses the gate, REVIEWER_OFFLINE=1 skips without contacting agy', () => {
        const skip = pushNewBranch({ ...env, REVIEWER_SKIP: '1' });
        assert.strictEqual(skip.status, 0, skip.stderr);
        assert.ok(/SKIPPED, push allowed: REVIEWER_SKIP is set/.test(skip.stderr), skip.stderr);

        const offline = pushNewBranch({ ...env, REVIEWER_OFFLINE: '1' });
        assert.strictEqual(offline.status, 0, offline.stderr);
        assert.ok(/REVIEWER_OFFLINE is set/.test(offline.stderr), offline.stderr);
      });

      await check('M1 hook: REVIEWER_FAIL_CLOSED=1 restores blocking when the reviewer is unavailable', () => {
        const res = pushNewBranch({ ...env, REVIEWER_FAIL_CLOSED: '1' });
        assert.notStrictEqual(res.status, 0, 'strict mode must block');
        assert.ok(/fail-closed/.test(res.stderr), res.stderr);
      });

      await check('M1 hook: fail-open on a 429/quota error from agy (warns, allows), strict mode blocks', () => {
        const agyDir = fs.mkdtempSync(path.join(tmpRoot, 'agy-429-'));
        const mock = makeMockAgy(agyDir, { reviewBody: QUOTA_429_BODY });
        const quotaEnv = { ...env, HOME: authHome, AGY_BIN: mock };
        const res = pushNewBranch(quotaEnv);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.ok(/reviewer unavailable \(quota\)/.test(res.stderr), res.stderr);
        assert.ok(/push allowed without AI review/.test(res.stderr), res.stderr);

        const strict = pushNewBranch({ ...quotaEnv, REVIEWER_FAIL_CLOSED: '1' });
        assert.notStrictEqual(strict.status, 0);
      });

      await check('M1 hook: fail-open on an agy timeout, and the review still approves normally when agy works', () => {
        const agyDir = fs.mkdtempSync(path.join(tmpRoot, 'agy-timeout-'));
        const hang = makeMockAgy(agyDir, {
          name: 'hang.js',
          reviewBody: 'setTimeout(() => {}, 60000);',
        });
        const res = pushNewBranch({
          ...env,
          HOME: authHome,
          AGY_BIN: hang,
          REVIEWER_TIMEOUT_MS: '1500',
        });
        assert.strictEqual(res.status, 0, res.stderr);
        assert.ok(/reviewer unavailable \(timeout\)/.test(res.stderr), res.stderr);

        const ok = makeMockAgy(agyDir, { name: 'ok.js', reviewBody: APPROVE_BODY });
        const approved = pushNewBranch({ ...env, HOME: authHome, AGY_BIN: ok });
        assert.strictEqual(approved.status, 0, approved.stderr);
        assert.ok(/APPROVE/.test(approved.stderr), approved.stderr);
      });

      await check('M1 hook: the static secret floor still blocks while the reviewer is down; REVIEWER_SKIP overrides', () => {
        const leaky = { 'config.js': `const token = "${SECRET_TOKEN}";\n` };
        const blocked = pushNewBranch(env, leaky);
        assert.notStrictEqual(blocked.status, 0, 'leaked secret must block even when agy is unavailable');
        assert.ok(/static security floor only/.test(blocked.stderr), blocked.stderr);

        const bypassed = pushNewBranch({ ...env, REVIEWER_SKIP: '1' }, leaky);
        assert.strictEqual(bypassed.status, 0, bypassed.stderr);
      });

      await check('M1 pipeline: a lock wait that times out never blocks a push (warn and allow); strict mode throws', async () => {
        const workDir = fs.mkdtempSync(path.join(tmpRoot, 'lock-rev-'));
        const lockTarget = path.join(workDir, '.pre-push-pipeline');
        const headOid = git(repo, ['rev-parse', 'master'], env).stdout.trim();
        const args = {
          repoRoot: repo,
          reviewDir: workDir,
          stdinText: `refs/heads/x ${headOid} refs/heads/x ${'0'.repeat(40)}\n`,
          lockWaitMs: 300,
          env: { ...env, HOME: emptyHome },
        };
        await reviewer.withOutputLock(lockTarget, async () => {
          const res = await prePush.runPrePushReview({ ...args, failOpen: true });
          assert.strictEqual(res.exitCode, 0);
          assert.strictEqual(res.verdict, 'SKIPPED');
          assert.strictEqual(res.unavailableReason, 'lock-timeout');

          await assert.rejects(
            () => prePush.runPrePushReview({ ...args, failOpen: false }),
            (err) => err.code === reviewer.REVIEW_LOCK_TIMEOUT_CODE
          );
        });
      });

      await check('M1 classifier: only reviewer outages fail open; spend, permission, schema and secret refusals stay closed', () => {
        const c = reviewer.classifyReviewerUnavailable;
        const mk = (msg, props = {}) => Object.assign(new Error(msg), props);
        assert.strictEqual(c(mk('x', { quotaExhausted: true })), 'quota');
        assert.strictEqual(c(mk('x', { authRequired: true })), 'auth');
        assert.strictEqual(c(mk('x', { timedOut: true })), 'timeout');
        assert.strictEqual(c(mk('spawn agy ENOENT', { code: 'ENOENT' })), 'agy-missing');
        assert.strictEqual(c(mk('No executable native agy CLI found. Checked: PATH')), 'agy-missing');
        assert.strictEqual(c(mk('getaddrinfo ENOTFOUND api', { code: 'ENOTFOUND' })), 'network');
        assert.strictEqual(c(mk('upstream said 429 Too Many Requests')), 'network');
        assert.strictEqual(
          c(mk('All attempts failed', { cause: mk('x', { quotaExhausted: true }) })),
          'quota'
        );
        assert.strictEqual(c(mk('lock', { code: reviewer.REVIEW_LOCK_TIMEOUT_CODE })), 'lock-timeout');

        assert.strictEqual(c(mk('x', { permissionCheckFailed: true, quotaExhausted: true })), null);
        assert.strictEqual(c(mk('x', { toolAttempt: true })), null);
        assert.strictEqual(c(mk('Parsed response failed verdict schema validation')), null);
        assert.strictEqual(
          c(mk('Refusing to send unredacted credential to cloud Gemini reviewer (x)')),
          null
        );
        assert.strictEqual(
          c(mk('Paid overage billing (overage_info.enabled: true) is active', { quotaCheckFailed: true })),
          null
        );
        assert.strictEqual(
          c(mk('Metered or credit-based quota plan (x) is not permitted', { quotaCheckFailed: true })),
          null
        );
      });
    }

    // ------------------------------------------------------------------ M4: overage guard
    await check('M4: REVIEWER_CHECK_QUOTA=0 skips only the 5% reserve; the paid-overage guard still blocks before any review call', async () => {
      const agyDir = fs.mkdtempSync(path.join(tmpRoot, 'agy-overage-'));
      const logFile = path.join(agyDir, 'calls.log');
      const overageUsage = buildHealthyUsageEnvelope();
      overageUsage.command.data.overage_info = { enabled: true };
      const overageAgy = makeMockAgy(agyDir, {
        name: 'overage.js',
        usage: overageUsage,
        reviewBody: APPROVE_BODY,
        logFile,
      });
      const diff = fileDiff('a.js', ['const a = 1;']);

      for (const [label, env, options] of [
        ['env REVIEWER_CHECK_QUOTA=0', { HOME: authHome, PATH: HERMETIC_PATH, REVIEWER_CHECK_QUOTA: '0' }, {}],
        ['option checkQuota:false', { HOME: authHome, PATH: HERMETIC_PATH }, { checkQuota: false }],
        ['default (quota check on)', { HOME: authHome, PATH: HERMETIC_PATH }, {}],
      ]) {
        fs.rmSync(logFile, { force: true });
        await assert.rejects(
          () =>
            reviewer.reviewDiff(diff, {
              ...options,
              env,
              sourceHome: authHome,
              agyBin: overageAgy,
              tempRoot: tmpRoot,
            }),
          /Paid overage billing/,
          `overage must block with ${label}`
        );
        assert.strictEqual(
          readLog(logFile).filter((e) => e.call === 'review').length,
          0,
          `no review call may happen with ${label}`
        );
      }

      const metered = buildHealthyUsageEnvelope();
      metered.command.data.description = 'Pay-as-you-go credits plan';
      const meteredAgy = makeMockAgy(agyDir, { name: 'metered.js', usage: metered, reviewBody: APPROVE_BODY });
      await assert.rejects(
        () =>
          reviewer.reviewDiff(diff, {
            env: { HOME: authHome, PATH: HERMETIC_PATH, REVIEWER_CHECK_QUOTA: '0' },
            sourceHome: authHome,
            agyBin: meteredAgy,
            tempRoot: tmpRoot,
          }),
        /Metered or credit-based/
      );

      const lowQuota = buildHealthyUsageEnvelope(0.03, 0.02);
      const lowAgy = makeMockAgy(agyDir, { name: 'low.js', usage: lowQuota, reviewBody: APPROVE_BODY });
      await assert.rejects(
        () =>
          reviewer.reviewDiff(diff, {
            env: { HOME: authHome, PATH: HERMETIC_PATH },
            sourceHome: authHome,
            agyBin: lowAgy,
            tempRoot: tmpRoot,
          }),
        /allowance is exhausted|reserve/
      );
      const skipped = await reviewer.reviewDiff(diff, {
        env: { HOME: authHome, PATH: HERMETIC_PATH, REVIEWER_CHECK_QUOTA: '0' },
        sourceHome: authHome,
        agyBin: lowAgy,
        tempRoot: tmpRoot,
      });
      assert.strictEqual(skipped.verdict, 'APPROVE', 'reserve check is the only thing REVIEWER_CHECK_QUOTA=0 skips');
    });

    // ------------------------------------------------------------------ M3: chunked review
    await check('M3 splitDiffIntoChunks: every chunk fits the limit and no content is dropped', () => {
      const big = fileDiff('big.js', Array.from({ length: 300 }, (_, i) => `const big_${i} = "${'q'.repeat(60)}";`));
      const small = fileDiff('small.js', ['const SMALL_MARKER = 1;']);
      const tail = fileDiff('tail.js', ['const TAIL_MARKER = 2;']);
      const diff = big + small + tail;
      const limit = 2500;
      const chunks = reviewer.splitDiffIntoChunks(diff, limit);
      assert.ok(chunks.length > 2);
      assert.ok(chunks.every((c) => c.length <= limit), 'chunk over limit');
      const joined = chunks.join('\n');
      assert.ok(joined.includes('SMALL_MARKER') && joined.includes('TAIL_MARKER'));
      for (let i = 0; i < 300; i += 1) {
        assert.ok(joined.includes(`const big_${i} =`), `big_${i} dropped`);
      }
      const bigChunks = chunks.filter((c) => c.includes('const big_'));
      assert.ok(bigChunks.every((c) => c.includes('diff --git a/big.js')), 'file header repeated per piece');

      const emoji = `+${'\u{1F600}'.repeat(3000)}\n`;
      const emojiChunks = reviewer.splitDiffIntoChunks(
        `diff --git a/e b/e\n--- a/e\n+++ b/e\n@@ -0,0 +1 @@\n${emoji}`,
        1000
      );
      assert.ok(emojiChunks.every((c) => c.length <= 1000));
      assert.strictEqual((emojiChunks.join('').match(/\u{1F600}/gu) || []).length, 3000);
      assert.deepStrictEqual(reviewer.splitDiffIntoChunks('', 1000), []);
    });

    await check('M3 reviewDiff: a diff over the default 400,000 char limit has its tail reviewed, and a tail finding blocks', async () => {
      const agyDir = fs.mkdtempSync(path.join(tmpRoot, 'agy-chunk-'));
      const logFile = path.join(agyDir, 'calls.log');
      const filler = Array.from({ length: 4200 }, (_, i) => `const filler_${i} = "${'z'.repeat(80)}";`);
      const diff =
        fileDiff('front.js', filler) +
        fileDiff('middle.js', filler.slice(0, 200)) +
        fileDiff('tail.js', ['const TAIL_ONLY_MARKER = 1;']);
      assert.ok(diff.length > 400000, `diff is ${diff.length} chars`);

      const approveAgy = makeMockAgy(agyDir, { name: 'approve.js', reviewBody: APPROVE_BODY, logFile });
      const okVerdict = await reviewer.reviewDiff(diff, {
        env: { HOME: authHome, PATH: HERMETIC_PATH },
        sourceHome: authHome,
        agyBin: approveAgy,
        tempRoot: tmpRoot,
      });
      const reviewCalls = readLog(logFile).filter((e) => e.call === 'review');
      assert.ok(reviewCalls.length >= 2, `expected >= 2 chunk reviews, got ${reviewCalls.length}`);
      assert.strictEqual(okVerdict.verdict, 'APPROVE');
      assert.ok(/Reviewed all \d+ diff chunks/.test(okVerdict.summary), okVerdict.summary);
      assert.ok(!/truncated/i.test(okVerdict.summary));

      fs.rmSync(logFile, { force: true });
      const tailFindingAgy = makeMockAgy(agyDir, {
        name: 'tail-finding.js',
        logFile,
        reviewBody: `
          const hasTail = prompt.includes("TAIL_ONLY_MARKER");
          process.stdout.write(JSON.stringify({
            conversation_id: "c",
            status: "SUCCESS",
            structured_output: hasTail
              ? { verdict: "REQUEST_CHANGES", summary: "Tail is broken.", issues: [{ file: "tail.js", line: 1, message: "Bad tail" }] }
              : { verdict: "APPROVE", summary: "Fine.", issues: [] }
          }) + "\\n");
        `,
      });
      const blocked = await reviewer.reviewDiff(diff, {
        env: { HOME: authHome, PATH: HERMETIC_PATH },
        sourceHome: authHome,
        agyBin: tailFindingAgy,
        tempRoot: tmpRoot,
      });
      assert.strictEqual(blocked.verdict, 'REQUEST_CHANGES', 'a finding in the tail must not be lost');
      assert.ok(blocked.issues.some((i) => i.file === 'tail.js'));
    });

    await check('M3 reviewDiff: a diff needing more chunks than REVIEWER_MAX_CHUNKS is downgraded, never APPROVE', async () => {
      const agyDir = fs.mkdtempSync(path.join(tmpRoot, 'agy-overflow-'));
      const logFile = path.join(agyDir, 'calls.log');
      const approveAgy = makeMockAgy(agyDir, { reviewBody: APPROVE_BODY, logFile });
      const diff = [1, 2, 3, 4].map((n) => fileDiff(`f${n}.js`, Array.from({ length: 60 }, (_, i) => `const v${n}_${i} = "${'y'.repeat(50)}";`))).join('');
      const verdict = await reviewer.reviewDiff(diff, {
        env: { HOME: authHome, PATH: HERMETIC_PATH },
        sourceHome: authHome,
        agyBin: approveAgy,
        tempRoot: tmpRoot,
        maxDiffChars: 4000,
        maxChunks: 2,
      });
      assert.strictEqual(readLog(logFile).filter((e) => e.call === 'review').length, 2);
      assert.strictEqual(verdict.verdict, 'REQUEST_CHANGES');
      assert.ok(verdict.issues.some((i) => i.file === '(diff)' && /Review incomplete/.test(i.message)));
      assert.ok(/Review incomplete/.test(verdict.summary));
    });

    // ------------------------------------------------------------------ M2: sanitising
    const hostile =
      'Ping <!channel> <!here> <!everyone> @channel @here @everyone <@U123ABC> <<!channel>!here> @alice @org/team ' +
      '<script>alert(1)</script> [click](https://evil.test) ![x](https://evil.test/p.png) A & B';

    await check('M2 sanitizeAiText: escapes & < >, strips broadcast tokens and @-mentions, caps length', () => {
      const out = sanitize.sanitizeAiText(hostile, { maxChars: 1000 });
      for (const bad of ['<!channel>', '<!here>', '<!everyone>', '@channel', '@here', '@everyone', '@alice', '@org/team', '<@U123ABC>']) {
        assert.ok(!out.includes(bad), `${bad} survived: ${out}`);
      }
      assert.ok(!/[<>]/.test(out), `raw angle bracket survived: ${out}`);
      assert.ok(out.includes('&lt;script&gt;'));
      assert.ok(out.includes('A &amp; B'));
      assert.ok(sanitize.sanitizeAiText('x'.repeat(5000), { maxChars: 100 }).length <= 103);
      assert.ok(!/@(?=\w)/.test(sanitize.sanitizeAiText('mail me at bob@example.test')));
      assert.strictEqual(sanitize.sanitizeAiText('line1\nline2\u202e'), 'line1 line2');
    });

    await check('M2 payload builders: Slack disables unfurling and labels AI output; email and webhook are escaped and labelled', () => {
      const input = {
        verdict: 'REQUEST_CHANGES',
        summary: hostile,
        issues: [{ file: 'a`b<!here>.js', line: 7, message: hostile }],
        repo: 'org/repo',
        num: '12',
        title: 'Title <!channel>',
        prUrl: 'https://github.com/org/repo/pull/12',
        runUrl: 'javascript:alert(1)',
      };
      const slack = sanitize.buildSlackPayload(input);
      assert.strictEqual(slack.unfurl_links, false);
      assert.strictEqual(slack.unfurl_media, false);
      assert.ok(slack.text.includes('AI-generated advisory output'));
      assert.ok(!/<!(?:channel|here|everyone)/.test(slack.text));
      assert.ok(!slack.text.includes('javascript:'), 'non-https URLs are dropped');
      assert.ok(!/@(?:channel|here|everyone|alice)/.test(slack.text));
      assert.ok(!/<(?!https:\/\/github\.com\/org\/repo\/pull\/12>)/.test(slack.text), 'only the trusted PR link may use angle brackets');

      const email = sanitize.buildEmailMessage(input);
      assert.ok(email.body.includes('AI-generated advisory output'));
      assert.ok(!/[<>]/.test(email.body));
      assert.ok(!/@(?:channel|here|everyone|alice)/.test(email.body));
      assert.ok(!email.subject.includes('<'));

      const hook = sanitize.buildWebhookPayload(input);
      assert.strictEqual(hook.ai_generated, true);
      assert.strictEqual(hook.advisory, true);
      assert.ok(!JSON.stringify(hook).includes('<!channel>'));

      const md = sanitize.buildSummaryMarkdown({ verdict: 'REQUEST_CHANGES', summary: hostile, issues: input.issues });
      assert.ok(md.includes('AI-generated advisory output'));
      assert.ok(!md.includes('<'), 'no raw HTML in the job summary');
      assert.ok(md.includes('\\[click\\]'), 'markdown links are neutralised');
      assert.ok(!md.includes('![x]'), 'markdown images are neutralised');

      assert.deepStrictEqual(sanitize.parseEmailList('a@x.test, A@x.test, bad, <b@x.test>, c@y.test'), ['a@x.test', 'c@y.test']);
    });

    if (process.platform !== 'win32' && !spawnSync('bash', ['--version']).error) {
      const workflowText = fs.readFileSync(WORKFLOW_PATH, 'utf8');

      await check('M2 workflow: record step writes an escaped, labelled job summary from hostile model output', () => {
        const recordScript = extractYamlRunBlock(workflowText, 'Record review summary');
        const dir = fs.mkdtempSync(path.join(tmpRoot, 'record-'));
        const resultPath = path.join(dir, 'review_result.json');
        fs.writeFileSync(
          resultPath,
          JSON.stringify({
            verdict: 'REQUEST_CHANGES',
            summary: hostile,
            issues: [{ file: 'src/a.js', line: 3, message: hostile }],
          })
        );
        const summaryFile = path.join(dir, 'summary.md');
        const outputFile = path.join(dir, 'output.txt');
        fs.writeFileSync(summaryFile, '');
        fs.writeFileSync(outputFile, '');
        const res = spawnSync('bash', ['-c', recordScript], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          env: {
            PATH: HERMETIC_PATH,
            HOME: tmpRoot,
            GITHUB_WORKSPACE: REPO_ROOT,
            REVIEW_OUTPUT_PATH: resultPath,
            REVIEW_DIR: dir,
            REVIEWER_OUTCOME: 'success',
            GITHUB_STEP_SUMMARY: summaryFile,
            GITHUB_OUTPUT: outputFile,
          },
        });
        assert.strictEqual(res.status, 1, 'REQUEST_CHANGES still fails the job');
        const md = fs.readFileSync(summaryFile, 'utf8');
        assert.ok(md.includes('AI-generated advisory output'));
        assert.ok(!/<!(?:channel|here|everyone)/.test(md));
        assert.ok(!/@(?:channel|here|everyone|alice)/.test(md));
        assert.ok(!/<script/i.test(md));
        assert.ok(md.includes('&lt;script&gt;'));
      });

      await check('M2 workflow: Slack, email and webhook bodies produced by the real notify step are sanitised', () => {
        const notifyScript = extractYamlRunBlock(workflowText, 'Send Notifications');
        const dir = fs.mkdtempSync(path.join(tmpRoot, 'notify-'));
        const binDir = path.join(dir, 'bin');
        const capture = path.join(dir, 'capture');
        fs.mkdirSync(binDir);
        fs.mkdirSync(capture);
        fs.writeFileSync(
          path.join(binDir, 'curl'),
          `#!/bin/bash
set -eu
cfg=""; data=""
while [ $# -gt 0 ]; do
  case "$1" in
    --config) cfg="$2"; shift 2 ;;
    --data-binary) data="\${2#@}"; shift 2 ;;
    *) shift ;;
  esac
done
name="$(grep -o 'url = .*' "$cfg" | head -1 | sed 's#.*/##; s#"##g')"
cp "$data" "${capture}/$name.json"
`,
          { mode: 0o755 }
        );
        const res = spawnSync('bash', ['-c', notifyScript], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          env: {
            PATH: `${binDir}:${HERMETIC_PATH}`,
            HOME: tmpRoot,
            GITHUB_WORKSPACE: REPO_ROOT,
            TRIMURTI_WEBHOOK_URL: 'https://hooks.invalid/trimurti',
            SLACK_WEBHOOK_URL: 'https://hooks.invalid/slack',
            EMAIL_API_KEY: 'k',
            EMAIL_TO: 'ops@example.test',
            EMAIL_FROM: 'ci@example.test',
            SENDGRID_API_URL: 'https://hooks.invalid/send',
            PR_NUMBER: '9',
            PR_URL: 'https://github.com/org/repo/pull/9',
            PR_TITLE: 'Title',
            REPO_FULL_NAME: 'org/repo',
            RUN_URL: 'https://github.com/org/repo/actions/runs/1',
            REVIEW_VERDICT: 'REQUEST_CHANGES',
            REVIEW_SUMMARY: hostile,
            REVIEW_ISSUES_JSON: JSON.stringify([{ file: 'x.js', line: 2, message: hostile }]),
          },
        });
        assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
        const slack = JSON.parse(fs.readFileSync(path.join(capture, 'slack.json'), 'utf8'));
        assert.strictEqual(slack.unfurl_links, false);
        assert.strictEqual(slack.unfurl_media, false);
        assert.ok(slack.text.includes('AI-generated'));
        assert.ok(!/<!(?:channel|here|everyone)/.test(slack.text));
        assert.ok(!/@(?:channel|here|everyone|alice)/.test(slack.text));
        const mail = JSON.parse(fs.readFileSync(path.join(capture, 'send.json'), 'utf8'));
        const mailBody = mail.content[0].value;
        assert.ok(mailBody.includes('AI-generated'));
        assert.ok(!/[<>]/.test(mailBody));
        assert.ok(!/@(?:channel|here|everyone|alice)/.test(mailBody));
        assert.strictEqual(mail.personalizations[0].to[0].email, 'ops@example.test');
        const hook = JSON.parse(fs.readFileSync(path.join(capture, 'trimurti.json'), 'utf8'));
        assert.strictEqual(hook.ai_generated, true);
        assert.ok(!JSON.stringify(hook).includes('<!channel>'));

        fs.rmSync(capture, { recursive: true });
        fs.mkdirSync(capture);
        const noAddr = spawnSync('bash', ['-c', notifyScript], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          env: {
            PATH: `${binDir}:${HERMETIC_PATH}`,
            HOME: tmpRoot,
            GITHUB_WORKSPACE: REPO_ROOT,
            EMAIL_API_KEY: 'k',
            SENDGRID_API_URL: 'https://hooks.invalid/send',
            REVIEW_VERDICT: 'ERROR',
          },
        });
        assert.strictEqual(noAddr.status, 0, noAddr.stderr);
        assert.ok(!fs.existsSync(path.join(capture, 'send.json')), 'no built-in recipient: email is skipped');
      });

      await check('workflow: no-runner manual run is a clean skip (no failure, no alert); a real failure still fails', () => {
        const prepScript = extractYamlRunBlock(workflowText, 'Prepare environment and prerequisites');
        const recordScript = extractYamlRunBlock(workflowText, 'Record review summary');
        const dir = fs.mkdtempSync(path.join(tmpRoot, 'norunner-'));
        const home = fs.mkdtempSync(path.join(dir, 'home-'));
        const outFile = path.join(dir, 'prep-output.txt');
        fs.writeFileSync(outFile, '');
        const prep = spawnSync('bash', ['-c', prepScript], {
          encoding: 'utf8',
          env: { PATH: HERMETIC_PATH, HOME: home, REVIEW_DIR: path.join(dir, 'work'), GITHUB_OUTPUT: outFile },
        });
        assert.strictEqual(prep.status, 0, prep.stderr);
        assert.ok(fs.readFileSync(outFile, 'utf8').includes('agy_available=false'));
        assert.ok(!/::warning::/.test(prep.stdout), 'missing runner is a notice, not a warning');

        const stepOutput = path.join(dir, 'record-output.txt');
        const stepSummary = path.join(dir, 'record-summary.md');
        fs.writeFileSync(stepOutput, '');
        fs.writeFileSync(stepSummary, '');
        const baseEnv = {
          PATH: HERMETIC_PATH,
          HOME: home,
          GITHUB_WORKSPACE: REPO_ROOT,
          REVIEW_DIR: path.join(dir, 'work'),
          GITHUB_OUTPUT: stepOutput,
          GITHUB_STEP_SUMMARY: stepSummary,
        };
        const skipped = spawnSync('bash', ['-c', recordScript], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          env: { ...baseEnv, REVIEWER_OUTCOME: 'skipped', AGY_AVAILABLE: 'false' },
        });
        assert.strictEqual(skipped.status, 0, `${skipped.stdout}\n${skipped.stderr}`);
        assert.ok(fs.readFileSync(stepOutput, 'utf8').includes('verdict=SKIPPED'));
        assert.ok(/::notice[^\n]*SKIPPED/.test(skipped.stdout));
        assert.ok(!/::error/.test(skipped.stdout));

        const failed = spawnSync('bash', ['-c', recordScript], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          env: { ...baseEnv, REVIEWER_OUTCOME: 'failure', AGY_AVAILABLE: 'true' },
        });
        assert.strictEqual(failed.status, 1, 'reviewer failure with a runner present must still fail');
        const unknownAvail = spawnSync('bash', ['-c', recordScript], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          env: { ...baseEnv, REVIEWER_OUTCOME: 'skipped' },
        });
        assert.strictEqual(unknownAvail.status, 1, 'skipped without a no-runner signal is an error');

        assert.ok(
          /id: run_reviewer\n\s+if: steps\.prepare\.outputs\.agy_available == 'true'/.test(workflowText),
          'reviewer step must only run when agy is available'
        );
      });

      await check('workflow: actions pinned by full SHA, checkout drops credentials, no personal addresses or shared /tmp/gemini', () => {
        const usesLines = workflowText.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l));
        assert.ok(usesLines.length >= 5);
        for (const line of usesLines) {
          assert.ok(/@[0-9a-f]{40}\b/.test(line), `unpinned action: ${line}`);
        }
        const checkouts = (workflowText.match(/uses: actions\/checkout@/g) || []).length;
        assert.strictEqual((workflowText.match(/persist-credentials: false/g) || []).length, checkouts);
        assert.ok(!workflowText.includes('kapoors.com'));
        assert.ok(!/REVIEW_DIR: \/tmp\/gemini\s*$/m.test(workflowText));
        assert.ok(workflowText.includes('node scripts/test-reviewer-hardening.js'));
      });
    }

    // ------------------------------------------------------------------ Soft items
    await check('agy env is an allowlist: unknown variables and CI secrets are dropped, REVIEWER_AGY_ENV_ALLOW opts names in', () => {
      const cleaned = reviewer.cleanEnvironment({
        PATH: '/usr/bin',
        HOME: '/h',
        LC_ALL: 'C.UTF-8',
        MY_CI_SECRET: 'nope',
        AWS_SECRET_ACCESS_KEY: 'nope',
        RANDOM_TOOL_TOKEN: 'nope',
        GEMINI_API_KEY: 'nope',
        CUSTOM_OK: 'yes',
        REVIEWER_AGY_ENV_ALLOW: 'CUSTOM_OK, GEMINI_API_KEY, bad name',
      });
      assert.strictEqual(cleaned.PATH, '/usr/bin');
      assert.strictEqual(cleaned.LC_ALL, 'C.UTF-8');
      assert.strictEqual(cleaned.CUSTOM_OK, 'yes');
      for (const k of ['MY_CI_SECRET', 'AWS_SECRET_ACCESS_KEY', 'RANDOM_TOOL_TOKEN', 'GEMINI_API_KEY', 'REVIEWER_AGY_ENV_ALLOW']) {
        assert.ok(!(k in cleaned), `${k} must not reach agy`);
      }
    });

    await check('sanitizeLogText: caps length, redacts credentials, strips escapes, neutralises workflow commands', () => {
      const raw = `\u001b[31mred\u001b[0m\n::error::injected\n  ::set-output name=x::y\n##[add-mask]z\ntoken=${SECRET_TOKEN}\n${'x'.repeat(5000)}`;
      const out = reviewer.sanitizeLogText(raw);
      assert.ok(out.length < 2100, `log text not capped (${out.length})`);
      assert.ok(!out.includes('\u001b'));
      assert.ok(!out.includes(SECRET_TOKEN));
      for (const line of out.split('\n')) {
        assert.ok(!/^\s*(?:::|##\[)/.test(line), `workflow command survived: ${line}`);
      }
      assert.ok(/truncated \d+ chars/.test(out));
    });

    await check('run roots: startup sweep removes orphaned token copies, spares live and foreign dirs; SIGTERM cleans up', async () => {
      const sweepRoot = fs.mkdtempSync(path.join(tmpRoot, 'sweep-'));
      const dead = path.join(sweepRoot, 'trimurti-agy-run-dead');
      const live = path.join(sweepRoot, 'trimurti-agy-run-live');
      const old = path.join(sweepRoot, 'trimurti-agy-run-old');
      const unrelated = path.join(sweepRoot, 'something-else');
      for (const d of [dead, live, old, unrelated]) fs.mkdirSync(d);
      const deadChild = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
      fs.writeFileSync(path.join(dead, 'owner.pid'), deadChild.stdout.trim());
      fs.writeFileSync(path.join(live, 'owner.pid'), String(process.ppid));
      const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      fs.utimesSync(old, longAgo, longAgo);
      const removed = reviewer.sweepStaleRunRoots(sweepRoot);
      assert.strictEqual(removed, 2);
      assert.ok(!fs.existsSync(dead) && !fs.existsSync(old));
      assert.ok(fs.existsSync(live) && fs.existsSync(unrelated));

      if (process.platform !== 'win32') {
        const sigRoot = fs.mkdtempSync(path.join(tmpRoot, 'sig-'));
        const child = spawn(
          process.execPath,
          [
            '-e',
            `
            const r = require(${JSON.stringify(path.join(__dirname, 'reviewer.js'))});
            const ws = r.createIsolatedRunWorkspace({ sourceHome: ${JSON.stringify(authHome)}, tempRoot: ${JSON.stringify(sigRoot)} });
            process.stdout.write(ws.runRoot + "\\n");
            setInterval(() => {}, 1000);
            `,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] }
        );
        const runRoot = await new Promise((resolve, reject) => {
          let buf = '';
          child.stdout.on('data', (d) => {
            buf += d.toString();
            if (buf.includes('\n')) resolve(buf.trim());
          });
          child.on('error', reject);
          child.on('exit', () => reject(new Error('child exited early')));
        });
        assert.ok(fs.existsSync(runRoot), 'run root exists while running');
        const exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));
        child.kill('SIGTERM');
        const { sig } = await exited;
        assert.strictEqual(sig, 'SIGTERM', 'default signal behaviour must be preserved');
        assert.ok(!fs.existsSync(runRoot), 'copied OAuth token dir must be removed on SIGTERM');
      }
    });

    await check('withOutputLock: evicts a stale lock whose PID is still alive once it exceeds the age limit', async () => {
      const lockDir = fs.mkdtempSync(path.join(tmpRoot, 'lockage-'));
      const target = path.join(lockDir, 'out.json');
      const lockPath = path.join(lockDir, '.out.json.lock');
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, token: 'x', startedAt: Date.now() - 60000 }));
      const val = await reviewer.withOutputLock(target, async () => 'acquired', 3000, { staleLockMaxAgeMs: 1000 });
      assert.strictEqual(val, 'acquired');

      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, token: 'x', startedAt: Date.now() }));
      await assert.rejects(
        () => reviewer.withOutputLock(target, async () => 'no', 300, { staleLockMaxAgeMs: 60000 }),
        (err) => err.code === reviewer.REVIEW_LOCK_TIMEOUT_CODE
      );
    });

    await check('defaults: review scratch dir is per-user and no personal home paths remain in the scripts', () => {
      if (process.platform !== 'win32') {
        assert.strictEqual(reviewer.POSIX_DEFAULT_REVIEW_DIR, `/tmp/gemini-${process.getuid()}`);
        assert.strictEqual(prePush.defaultReviewDir({}, 'linux'), reviewer.POSIX_DEFAULT_REVIEW_DIR);
      }
      for (const file of ['reviewer.js', 'pre-push-review.js', 'ai-review-sanitize.js']) {
        const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assert.ok(!/sanjaykapoor|\/Users\/sanja|kapoors\.com/.test(text), `${file} has personal paths or addresses`);
      }
      assert.ok(!/[\u2013\u2014]/.test(fs.readFileSync(path.join(__dirname, 'ai-review-sanitize.js'), 'utf8')));
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log('\nall hardening tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
