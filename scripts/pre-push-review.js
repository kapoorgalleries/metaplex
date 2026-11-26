#!/usr/bin/env node
// Local pre-push AI review gate for kapoorgalleries/metaplex.
//
// Enforces genuine included-allowance Antigravity CLI (`agy`) diff review
// locally before `git push` transmits commits to a remote (with zero mock
// fallback and zero paid API fallback).
//
// Modes:
//   1. Git `pre-push` hook mode (invoked by `.git/hooks/pre-push <remote> <url>`
//      with `<local-ref> <local-oid> <remote-ref> <remote-oid>` lines on stdin):
//      computes the unified diff for all pushed refs into `$REVIEW_DIR/pre-push.diff`
//      and runs `scripts/reviewer.js` -> `$REVIEW_DIR/pre-push-review_result.json`
//      (never clobbering `/tmp/gemini/pr26.diff` unless `REVIEW_DIFF_PATH` is set).
//      Exits 0 on `APPROVE`; exits 1 (blocking push) on `REQUEST_CHANGES` or
//      any fail-closed `agy` / OAuth / 5%-quota-reserve / permission / schema error.
//   2. Manual CLI check (when stdin is a TTY or `--range <rev-range>` is given):
//      diffs the current branch against `origin/master` (or `origin/main`) and
//      runs the same review pipeline.
//   3. Hook installer (`node scripts/pre-push-review.js --install-hook`):
//      installs `.git/hooks/pre-push` safely (refusing symlinks and backing up
//      unmanaged hooks before `--force` replacement).

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tty = require('tty');
const { spawnSync } = require('child_process');

const {
  REVIEW_LOCK_TIMEOUT_CODE,
  assertAllowedReviewerModel,
  assertSafeOutputTarget,
  classifyReviewerUnavailable,
  createStaticSecurityScanner,
  resolveEffectiveTimeoutMs,
  resolveEffectiveTotalTimeoutMs,
  resolveMaxReviewChunks,
  runReview,
  sanitizeLogText,
  staticSecurityReview,
  withOutputLock,
} = require('./reviewer');

const MANAGED_HOOK_MARKER = '# Managed by scripts/pre-push-review.js';
const PINNED_DIR_NAME = '.trimurti-review';
const PINNED_SCRIPT_NAMES = Object.freeze(['pre-push-review.js', 'reviewer.js']);
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const MAX_TIMEOUT_MS = 2147483647;
const HEX_OID_RE = /^[0-9a-f]{40,64}$/i;
const ZERO_OID_RE = /^0+$/;

function isTruthyEnvFlag(env, name) {
  const raw = env && typeof env[name] === 'string' ? env[name].trim().toLowerCase() : '';
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function resolveDefaultFallbackRepoRoot(scriptDir = __dirname) {
  if (path.basename(scriptDir) === PINNED_DIR_NAME) {
    const hooksDir = path.dirname(scriptDir);
    const maybeGitDir = path.dirname(hooksDir);
    if (path.basename(hooksDir) === 'hooks' && path.basename(maybeGitDir) === '.git') {
      return path.dirname(maybeGitDir);
    }
    return null;
  }
  return path.resolve(scriptDir, '..');
}

function parsePositiveSafeInt(raw, label, maxValue = Number.MAX_SAFE_INTEGER) {
  const str = String(raw ?? '');
  if (!/^\d+$/.test(str)) {
    throw new Error(`Invalid ${label}: "${raw ?? ''}"`);
  }
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num <= 0 || num > maxValue) {
    throw new Error(`Invalid ${label}: "${raw ?? ''}"`);
  }
  return num;
}

function defaultReviewDir(env = process.env, platform = process.platform) {
  if (env && env.REVIEW_DIR && env.REVIEW_DIR.trim() !== '') {
    return env.REVIEW_DIR.trim();
  }
  if (platform === 'win32') {
    return path.join(os.tmpdir(), 'gemini');
  }
  if (typeof process.getuid === 'function') {
    const myUid = process.getuid();
    try {
      const st = fs.lstatSync('/tmp/gemini');
      if (st.isSymbolicLink() || (st.uid !== myUid && st.uid !== 0)) {
        return `/tmp/gemini-${myUid}`;
      }
    } catch (_) {}
  }
  return '/tmp/gemini';
}

function parsePrePushArgs(argv = process.argv.slice(2)) {
  let help = false;
  let installHook = false;
  let force = false;
  let allowWslInterop;
  let range = null;
  let outputOverride = null;
  const models = [];
  let timeoutMs;
  let maxDiffChars;
  const positional = [];
  let endOfOptions = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!endOfOptions && arg === '--') {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && (arg === '--help' || arg === '-h')) {
      help = true;
      continue;
    }
    if (!endOfOptions && (arg === '--install-hook' || arg === '--install')) {
      installHook = true;
      continue;
    }
    if (!endOfOptions && arg === '--force') {
      force = true;
      continue;
    }
    if (!endOfOptions && arg === '--allow-wsl-interop') {
      allowWslInterop = true;
      continue;
    }
    if (!endOfOptions && (arg === '--range' || arg.startsWith('--range='))) {
      const val = arg === '--range' ? argv[++i] : arg.slice('--range='.length);
      if (!val || val.startsWith('-') || val.startsWith('^') || /[\s\0]/.test(val)) {
        throw new Error('Invalid or missing revision range for --range');
      }
      range = val;
      continue;
    }
    if (!endOfOptions && (arg === '--output' || arg === '-o' || arg.startsWith('--output='))) {
      const val =
        arg === '--output' || arg === '-o' ? argv[++i] : arg.slice('--output='.length);
      if (!val || ((arg === '--output' || arg === '-o') && val.startsWith('-'))) {
        throw new Error(`Missing value for ${arg}`);
      }
      outputOverride = val;
      continue;
    }
    if (!endOfOptions && (arg === '--model' || arg.startsWith('--model='))) {
      const val = arg === '--model' ? argv[++i] : arg.slice('--model='.length);
      if (!val || (arg === '--model' && val.startsWith('-'))) {
        throw new Error('Missing value for --model');
      }
      models.push(assertAllowedReviewerModel(val));
      continue;
    }
    if (!endOfOptions && (arg === '--timeout-ms' || arg.startsWith('--timeout-ms='))) {
      const val = arg === '--timeout-ms' ? argv[++i] : arg.slice('--timeout-ms='.length);
      timeoutMs = parsePositiveSafeInt(val, '--timeout-ms', MAX_TIMEOUT_MS);
      continue;
    }
    if (
      !endOfOptions &&
      (arg === '--max-diff-chars' || arg.startsWith('--max-diff-chars='))
    ) {
      const val =
        arg === '--max-diff-chars' ? argv[++i] : arg.slice('--max-diff-chars='.length);
      maxDiffChars = parsePositiveSafeInt(val, '--max-diff-chars');
      continue;
    }
    if (!endOfOptions && arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length > 2) {
    throw new Error(`Too many positional arguments (${positional.length}); expected at most 2`);
  }

  return {
    help,
    installHook,
    force,
    allowWslInterop,
    range,
    outputPath: outputOverride,
    models: models.length > 0 ? models : undefined,
    timeoutMs,
    maxDiffChars,
    positionalCount: positional.length,
    remoteName: positional[0] || 'origin',
    remoteUrl: positional[1] || '',
  };
}

const GIT_SCOPED_ENV_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
];

function buildGitSubprocessEnv(baseEnv = process.env) {
  const envCopy = Object.assign({}, baseEnv);
  for (const key of GIT_SCOPED_ENV_VARS) {
    delete envCopy[key];
  }
  return envCopy;
}

function buildGitArgs(args, options = {}) {
  const prefix = [];
  if (options && options.gitDir) {
    prefix.push(`--git-dir=${options.gitDir}`);
  }
  if (options && options.workTree) {
    prefix.push(`--work-tree=${options.workTree}`);
  }
  return prefix.length > 0 ? prefix.concat(args) : args;
}

function runGit(repoRoot, args, options = {}) {
  const res = spawnSync('git', buildGitArgs(args, options), {
    cwd: repoRoot,
    env: buildGitSubprocessEnv(options.env || process.env),
    encoding: 'utf8',
    input: options.input ?? '',
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
  });
  if (res.error) {
    throw new Error(`git ${args[0]} failed: ${res.error.message}`);
  }
  return res;
}

function resolveRepoRoot(cwd = process.cwd(), fallbackDir = null, options = {}) {
  if (cwd && fs.existsSync(cwd)) {
    const res = runGit(cwd, ['rev-parse', '--show-toplevel'], options);
    if (res.status === 0 && res.stdout.trim()) {
      return res.stdout.trim();
    }
  }
  if (fallbackDir && fs.existsSync(fallbackDir)) {
    const fbRes = runGit(fallbackDir, ['rev-parse', '--show-toplevel'], options);
    if (fbRes.status === 0 && fbRes.stdout.trim()) {
      return fbRes.stdout.trim();
    }
  }
  throw new Error(`Not inside a git repository: ${cwd}`);
}

function resolveLinkedWorktreeRootFromGitDir(gitDir) {
  try {
    const gitdirLinkFile = path.join(gitDir, 'gitdir');
    const lst = fs.lstatSync(gitdirLinkFile);
    if (!lst.isFile() || lst.isSymbolicLink() || lst.size <= 0 || lst.size > 4096) {
      return null;
    }
    const rawTarget = fs.readFileSync(gitdirLinkFile, 'utf8').trim();
    if (!rawTarget || rawTarget.includes('\0')) return null;
    const resolvedDotGit = path.resolve(gitDir, rawTarget);
    const wtRoot = path.dirname(resolvedDotGit);
    const wtStat = fs.existsSync(wtRoot) ? fs.lstatSync(wtRoot) : null;
    if (wtStat && wtStat.isDirectory() && !wtStat.isSymbolicLink()) {
      return wtRoot;
    }
  } catch (_) {}
  return null;
}

function resolveTargetGitContext(explicitRepoRoot, fallbackRepoRoot = null, env = process.env) {
  if (explicitRepoRoot) {
    return {
      repoRoot: resolveRepoRoot(explicitRepoRoot, null, { env }),
      gitDir: null,
      workTree: null,
    };
  }
  const hasExplicitGitDir = Boolean(env && env.GIT_DIR && String(env.GIT_DIR).trim() !== '');
  const hasExplicitWorkTree = Boolean(
    env && env.GIT_WORK_TREE && String(env.GIT_WORK_TREE).trim() !== ''
  );
  if (hasExplicitGitDir || hasExplicitWorkTree) {
    const baseCwd = fs.existsSync(process.cwd()) ? process.cwd() : os.tmpdir();
    const probeEnv = buildGitSubprocessEnv(env);
    if (hasExplicitGitDir) {
      probeEnv.GIT_DIR = String(env.GIT_DIR).trim();
    }
    if (hasExplicitWorkTree) {
      probeEnv.GIT_WORK_TREE = String(env.GIT_WORK_TREE).trim();
    }
    const gitDirRes = spawnSync('git', ['rev-parse', '--git-dir'], {
      cwd: baseCwd,
      env: probeEnv,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
    });
    if (gitDirRes.error || gitDirRes.status !== 0 || !gitDirRes.stdout.trim()) {
      throw new Error(
        `Not inside a git repository (invalid GIT_DIR/GIT_WORK_TREE): ${baseCwd}`
      );
    }
    const gitDir = path.resolve(baseCwd, gitDirRes.stdout.trim());
    if (hasExplicitWorkTree) {
      const workTree = path.resolve(baseCwd, String(env.GIT_WORK_TREE).trim());
      if (!fs.existsSync(workTree)) {
        throw new Error(`GIT_WORK_TREE does not exist: ${workTree}`);
      }
      return { repoRoot: workTree, gitDir, workTree };
    }
    // Never call `git rev-parse --show-toplevel` when GIT_DIR is set without GIT_WORK_TREE:
    // Git echoes `baseCwd` ($PWD), which may be an unrelated or untrusted directory.
    const linkedWtRoot = resolveLinkedWorktreeRootFromGitDir(gitDir);
    if (linkedWtRoot) {
      return { repoRoot: linkedWtRoot, gitDir, workTree: null };
    }
    if (path.basename(gitDir) === '.git' && fs.existsSync(path.dirname(gitDir))) {
      return { repoRoot: path.dirname(gitDir), gitDir, workTree: null };
    }
    const commonRes = spawnSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: gitDir,
      env: probeEnv,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
    });
    if (!commonRes.error && commonRes.status === 0 && commonRes.stdout.trim()) {
      const commonDir = path.resolve(gitDir, commonRes.stdout.trim());
      if (path.basename(commonDir) === '.git' && fs.existsSync(path.dirname(commonDir))) {
        return { repoRoot: path.dirname(commonDir), gitDir, workTree: null };
      }
    }
    return {
      repoRoot: fs.existsSync(gitDir) ? gitDir : os.tmpdir(),
      gitDir,
      workTree: null,
    };
  }
  return {
    repoRoot: resolveRepoRoot(process.cwd(), fallbackRepoRoot, { env }),
    gitDir: null,
    workTree: null,
  };
}

function resolveCommitOid(repoRoot, rev, gitOptions = {}) {
  if (!rev) return null;
  const res = runGit(
    repoRoot,
    ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`],
    gitOptions
  );
  if (res.status !== 0) return null;
  const oid = res.stdout.trim();
  return HEX_OID_RE.test(oid) ? oid : null;
}

function resolveTreeOid(repoRoot, rev, gitOptions = {}) {
  if (!rev) return null;
  const res = runGit(
    repoRoot,
    ['rev-parse', '--verify', '--quiet', `${rev}^{tree}`],
    gitOptions
  );
  if (res.status !== 0) return null;
  const oid = res.stdout.trim();
  return HEX_OID_RE.test(oid) ? oid : null;
}

function resolveBlobOid(repoRoot, rev, gitOptions = {}) {
  if (!rev) return null;
  const res = runGit(
    repoRoot,
    ['rev-parse', '--verify', '--quiet', `${rev}^{blob}`],
    gitOptions
  );
  if (res.status !== 0) return null;
  const oid = res.stdout.trim();
  return HEX_OID_RE.test(oid) ? oid : null;
}

function formatPushedBlobDiff(repoRoot, blobOid, refLabel, gitOptions = {}) {
  const res = spawnSync('git', buildGitArgs(['cat-file', 'blob', blobOid], gitOptions), {
    cwd: repoRoot,
    env: buildGitSubprocessEnv(gitOptions.env || process.env),
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
  });
  if (res.error || res.status !== 0 || !Buffer.isBuffer(res.stdout)) {
    throw new Error(`Unable to read pushed git blob ${blobOid}`);
  }
  const cleanLabel =
    String(refLabel || blobOid)
      .replace(/^refs\/(?:tags|heads)\//, '')
      .replace(/[\r\n"\\]+/g, '_')
      .trim() || blobOid;

  const buf = res.stdout;
  if (buf.length === 0) {
    return [
      `diff --git a/${cleanLabel} b/${cleanLabel}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${cleanLabel}`,
      '',
    ].join('\n');
  }
  if (buf.includes(0)) {
    return [
      `diff --git a/${cleanLabel} b/${cleanLabel}`,
      'new file mode 100644',
      `Binary files /dev/null and b/${cleanLabel} differ`,
      '',
    ].join('\n');
  }
  const text = buf.toString('utf8');
  const hasTrailingNewline = text.endsWith('\n');
  const rawLines = (hasTrailingNewline ? text.slice(0, -1) : text).split('\n');
  const out = [
    `diff --git a/${cleanLabel} b/${cleanLabel}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${cleanLabel}`,
    `@@ -0,0 +1,${rawLines.length} @@`,
    ...rawLines.map((l) => `+${l}`),
  ];
  if (!hasTrailingNewline) {
    out.push('\\ No newline at end of file');
  }
  out.push('');
  return out.join('\n');
}

function getMergeBase(repoRoot, oidA, oidB, gitOptions = {}) {
  const res = runGit(repoRoot, ['merge-base', oidA, oidB], gitOptions);
  if (res.status !== 0) return null;
  const oid = res.stdout.trim();
  return HEX_OID_RE.test(oid) ? oid : null;
}

function isAncestor(repoRoot, ancestorOid, descendantOid, gitOptions = {}) {
  if (!ancestorOid || !descendantOid) return false;
  if (ancestorOid === descendantOid) return true;
  const res = runGit(
    repoRoot,
    ['merge-base', '--is-ancestor', ancestorOid, descendantOid],
    gitOptions
  );
  return res.status === 0;
}

function isShallowRepository(repoRoot, gitOptions = {}) {
  const res = runGit(repoRoot, ['rev-parse', '--is-shallow-repository'], gitOptions);
  return res.status === 0 && res.stdout.trim() === 'true';
}

function getEmptyTreeOid(repoRoot, gitOptions = {}) {
  const res = runGit(
    repoRoot,
    ['hash-object', '-t', 'tree', '--stdin'],
    Object.assign({}, gitOptions, { input: '' })
  );
  if (res.status !== 0 || !res.stdout.trim()) {
    throw new Error('Unable to compute git empty tree OID');
  }
  return res.stdout.trim();
}

function resolveDefaultBaseCommit(
  repoRoot,
  remoteName = 'origin',
  refOptions = {},
  gitOptions = {}
) {
  const localRef =
    typeof refOptions === 'string' ? refOptions : (refOptions && refOptions.localRef) || '';
  const remoteRef =
    refOptions && typeof refOptions === 'object' ? refOptions.remoteRef || '' : '';
  const allowLocalHeads =
    refOptions && typeof refOptions === 'object' ? Boolean(refOptions.allowLocalHeads) : false;

  const safeRemote =
    /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(remoteName) &&
    !remoteName.includes('..')
      ? remoteName
      : 'origin';
  const remoteCandidates = [
    `refs/remotes/${safeRemote}/HEAD`,
    `refs/remotes/${safeRemote}/main`,
    `refs/remotes/${safeRemote}/master`,
  ];
  if (safeRemote !== 'origin') {
    remoteCandidates.push(
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main',
      'refs/remotes/origin/master'
    );
  }
  for (const cand of remoteCandidates) {
    const oid = resolveCommitOid(repoRoot, cand, gitOptions);
    if (oid) return oid;
  }

  if (allowLocalHeads) {
    for (const localCand of ['refs/heads/main', 'refs/heads/master']) {
      if (localCand === localRef || localCand === remoteRef) continue;
      const oid = resolveCommitOid(repoRoot, localCand, gitOptions);
      if (oid) return oid;
    }
  }
  return null;
}

function parsePrePushStdin(stdinText) {
  if (typeof stdinText !== 'string') {
    return [];
  }
  if (stdinText.includes('\0')) {
    throw new Error('Invalid NUL byte in git pre-push stdin');
  }
  if (stdinText.trim() === '') {
    return [];
  }
  const updates = [];
  const lines = stdinText.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 4) {
      throw new Error(`Malformed git pre-push stdin line: "${trimmed}"`);
    }
    const [localRef, localOid, remoteRef, remoteOid] = parts;
    if (!HEX_OID_RE.test(localOid) || !HEX_OID_RE.test(remoteOid)) {
      throw new Error(`Invalid object ID in git pre-push stdin line: "${trimmed}"`);
    }
    updates.push({ localRef, localOid, remoteRef, remoteOid });
  }
  return updates;
}

function computePrePushDiff(repoRoot, options = {}) {
  const remoteName = options.remoteName || 'origin';
  const gitOptions = {
    env: options.env,
    gitDir: options.gitDir || null,
    workTree: options.workTree || null,
  };

  if (options.range) {
    if (
      typeof options.range !== 'string' ||
      options.range.trim() === '' ||
      options.range.startsWith('-') ||
      options.range.startsWith('^') ||
      /[\s\0]/.test(options.range)
    ) {
      throw new Error(`Invalid revision range "${options.range}"`);
    }
    const diffRes = runGit(
      repoRoot,
      ['diff', '--no-ext-diff', '--no-color', options.range, '--'],
      gitOptions
    );
    if (diffRes.status !== 0) {
      throw new Error(
        `git diff failed for range "${options.range}": ${(diffRes.stderr || '').trim()}`
      );
    }
    return diffRes.stdout;
  }

  const isHookStdinMode = typeof options.stdinText === 'string';
  let updates;
  if (isHookStdinMode) {
    updates = parsePrePushStdin(options.stdinText);
    if (updates.length === 0) {
      return '';
    }
  } else {
    const headOid = resolveCommitOid(repoRoot, 'HEAD', gitOptions);
    if (!headOid) {
      return '';
    }
    const symRes = runGit(repoRoot, ['symbolic-ref', '--quiet', 'HEAD'], gitOptions);
    const currentRef = symRes.status === 0 ? symRes.stdout.trim() : 'HEAD';
    updates = [
      {
        localRef: currentRef,
        localOid: headOid,
        remoteRef: currentRef,
        remoteOid: '0'.repeat(headOid.length),
      },
    ];
  }

  let emptyTreeOid = null;
  let shallowChecked = null;
  const seenPairs = new Set();
  const chunks = [];

  for (const update of updates) {
    if (ZERO_OID_RE.test(update.localOid)) {
      continue;
    }
    const localCommit = resolveCommitOid(repoRoot, update.localOid, gitOptions);
    if (!localCommit) {
      const localTree = resolveTreeOid(repoRoot, update.localOid, gitOptions);
      if (localTree) {
        const remoteTree = !ZERO_OID_RE.test(update.remoteOid)
          ? resolveTreeOid(repoRoot, update.remoteOid, gitOptions)
          : null;
        if (remoteTree === localTree) {
          continue;
        }
        const treeFromOid =
          remoteTree || (emptyTreeOid = emptyTreeOid || getEmptyTreeOid(repoRoot, gitOptions));
        const treePairKey = `tree:${treeFromOid}..${localTree}`;
        if (!seenPairs.has(treePairKey)) {
          seenPairs.add(treePairKey);
          const treeDiffRes = runGit(
            repoRoot,
            ['diff', '--no-ext-diff', '--no-color', treeFromOid, localTree, '--'],
            gitOptions
          );
          if (treeDiffRes.status !== 0) {
            throw new Error(
              `git diff failed for pushed tree ${localTree}: ${(treeDiffRes.stderr || '').trim()}`
            );
          }
          if (treeDiffRes.stdout) {
            chunks.push(treeDiffRes.stdout);
          }
        }
        continue;
      }

      const localBlob = resolveBlobOid(repoRoot, update.localOid, gitOptions);
      if (localBlob) {
        const remoteBlob = !ZERO_OID_RE.test(update.remoteOid)
          ? resolveBlobOid(repoRoot, update.remoteOid, gitOptions)
          : null;
        if (remoteBlob === localBlob) {
          continue;
        }
        const blobKey = `blob:${localBlob}:${update.remoteRef || update.localRef}`;
        if (!seenPairs.has(blobKey)) {
          seenPairs.add(blobKey);
          chunks.push(
            formatPushedBlobDiff(
              repoRoot,
              localBlob,
              update.remoteRef || update.localRef,
              gitOptions
            )
          );
        }
        continue;
      }

      throw new Error(
        `Unable to resolve pushed git object "${update.localOid}" for ref "${update.localRef}"`
      );
    }

    const remoteCommit = !ZERO_OID_RE.test(update.remoteOid)
      ? resolveCommitOid(repoRoot, update.remoteOid, gitOptions)
      : null;

    let fromOid = null;
    let isFastForward = false;
    let rangeDefaultBase = null;
    if (remoteCommit) {
      if (remoteCommit === localCommit) {
        continue;
      }
      if (isAncestor(repoRoot, remoteCommit, localCommit, gitOptions)) {
        // Fast-forward push: review strictly the newly pushed commits.
        fromOid = remoteCommit;
        isFastForward = true;
        if (
          update.remoteRef !== 'refs/heads/master' &&
          update.remoteRef !== 'refs/heads/main'
        ) {
          rangeDefaultBase = resolveDefaultBaseCommit(
            repoRoot,
            remoteName,
            {
              localRef: update.localRef,
              remoteRef: update.remoteRef,
              allowLocalHeads: false,
            },
            gitOptions
          );
        }
      } else {
        // Non-fast-forward force-push (rebase, amend, ancestor rewind, or orphan rewrite):
        // prefer merge-base against the remote's default branch so rebased PR branches
        // exclude upstream master commits and ancestor rewinds still scan remaining PR commits;
        // otherwise diff directly from the overwritten remoteCommit tree.
        const defaultBase = resolveDefaultBaseCommit(
          repoRoot,
          remoteName,
          {
            localRef: update.localRef,
            remoteRef: update.remoteRef,
            allowLocalHeads: !isHookStdinMode,
          },
          gitOptions
        );
        rangeDefaultBase = defaultBase;
        const mbDefault = defaultBase
          ? getMergeBase(repoRoot, defaultBase, localCommit, gitOptions)
          : null;
        if (mbDefault && mbDefault !== localCommit) {
          fromOid = mbDefault;
        } else if (defaultBase && defaultBase !== remoteCommit && localCommit === defaultBase) {
          continue;
        } else {
          fromOid = remoteCommit;
        }
      }
    } else {
      const defaultBase = resolveDefaultBaseCommit(
        repoRoot,
        remoteName,
        {
          localRef: update.localRef,
          remoteRef: update.remoteRef,
          allowLocalHeads: !isHookStdinMode,
        },
        gitOptions
      );
      rangeDefaultBase = defaultBase;
      if (defaultBase) {
        const mb = getMergeBase(repoRoot, defaultBase, localCommit, gitOptions);
        if (mb) {
          fromOid = mb;
        } else {
          if (shallowChecked === null) {
            shallowChecked = isShallowRepository(repoRoot, gitOptions);
          }
          if (shallowChecked) {
            fromOid = defaultBase;
          } else {
            emptyTreeOid = emptyTreeOid || getEmptyTreeOid(repoRoot, gitOptions);
            fromOid = emptyTreeOid;
          }
        }
      } else {
        emptyTreeOid = emptyTreeOid || getEmptyTreeOid(repoRoot, gitOptions);
        fromOid = emptyTreeOid;
      }
    }

    if (fromOid === localCommit) {
      continue;
    }

    const pairKey = `${fromOid}..${localCommit}`;
    if (seenPairs.has(pairKey)) {
      continue;
    }
    seenPairs.add(pairKey);

    if (Array.isArray(options._commitRangesOut)) {
      options._commitRangesOut.push({
        fromOid,
        localCommit,
        isFromEmptyTree: Boolean(emptyTreeOid && fromOid === emptyTreeOid),
        isFastForward,
        defaultBase: rangeDefaultBase,
      });
    }

    const diffRes = runGit(
      repoRoot,
      ['diff', '--no-ext-diff', '--no-color', fromOid, localCommit, '--'],
      gitOptions
    );
    if (diffRes.status !== 0) {
      throw new Error(
        `git diff failed for ${pairKey}: ${(diffRes.stderr || '').trim()}`
      );
    }
    if (diffRes.stdout) {
      chunks.push(diffRes.stdout);
    }
  }

  return chunks.map((c) => (c.endsWith('\n') ? c : `${c}\n`)).join('');
}

function scanPrePushHistorySecrets(repoRoot, commitRanges = [], gitOptions = {}) {
  if (!Array.isArray(commitRanges) || commitRanges.length === 0) {
    return [];
  }
  const found = [];
  const seen = new Set();
  const histTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trimurti-hist-'));
  try {
    fs.chmodSync(histTmpDir, 0o700);
  } catch (_) {}

  const readChunkBuf = Buffer.allocUnsafe(1024 * 1024);

  try {
    for (let rangeIdx = 0; rangeIdx < commitRanges.length; rangeIdx += 1) {
      const range = commitRanges[rangeIdx];
      if (!range || !range.localCommit) continue;
      const revLabel = range.isFromEmptyTree
        ? range.localCommit
        : `${range.fromOid}..${range.localCommit}`;
      const logArgs = ['log', '--cc', '--no-ext-diff', '--no-color', '--format=', '-p'];
      if (range.isFromEmptyTree) {
        logArgs.push(range.localCommit, '--');
      } else {
        const notRevs = [range.fromOid];
        if (
          range.isFastForward &&
          range.defaultBase &&
          range.defaultBase !== range.localCommit &&
          range.defaultBase !== range.fromOid
        ) {
          notRevs.push(range.defaultBase);
        }
        logArgs.push(range.localCommit, '--not', ...notRevs, '--');
      }

      const patchFile = path.join(histTmpDir, `range-${rangeIdx}.patch`);
      const outFd = fs.openSync(patchFile, 'wx', 0o600);
      let logRes;
      try {
        logRes = spawnSync('git', buildGitArgs(logArgs, gitOptions), {
          cwd: repoRoot,
          env: buildGitSubprocessEnv(gitOptions.env || process.env),
          stdio: ['ignore', outFd, 'pipe'],
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        });
      } finally {
        try {
          fs.closeSync(outFd);
        } catch (_) {}
      }

      try {
        if (logRes.error) {
          throw new Error(`git log secret scan failed for ${revLabel}: ${logRes.error.message}`);
        }
        if (logRes.status !== 0) {
          throw new Error(
            `git log secret scan failed for ${revLabel}: ${(logRes.stderr || '').trim()}`
          );
        }

        const scanner = createStaticSecurityScanner();
        const readFd = fs.openSync(patchFile, 'r');
        try {
          let offset = 0;
          while (true) {
            const bytesRead = fs.readSync(readFd, readChunkBuf, 0, readChunkBuf.length, offset);
            if (bytesRead <= 0) break;
            offset += bytesRead;
            scanner.pushChunk(readChunkBuf.subarray(0, bytesRead));
          }
        } finally {
          try {
            fs.closeSync(readFd);
          } catch (_) {}
        }

        const historyStatic = scanner.finish();
        for (const issue of historyStatic.issues || []) {
          if (!issue || typeof issue.message !== 'string') continue;
          // Resolved merge conflict markers in intermediate commits do not leak secrets if
          // the pushed tip tree is clean; credentials/keys in intermediate commits DO leak.
          if (issue.message.includes('merge conflict marker')) continue;
          const key = `${issue.file}:${issue.line || 1}:${issue.message}`;
          if (!seen.has(key)) {
            seen.add(key);
            found.push({
              file: issue.file,
              line: issue.line || 1,
              message: issue.message,
            });
          }
        }
      } finally {
        try {
          fs.unlinkSync(patchFile);
        } catch (_) {}
      }
    }
  } finally {
    try {
      fs.rmSync(histTmpDir, { recursive: true, force: true });
    } catch (_) {}
  }

  return found;
}

function prepareSecureReviewDir(workDir) {
  assertSafeOutputTarget(path.join(workDir, '.dir-probe'));
  if (fs.existsSync(workDir) && fs.lstatSync(workDir).isSymbolicLink()) {
    throw new Error(`Refusing symlinked REVIEW_DIR: ${workDir}`);
  }
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(workDir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`Invalid REVIEW_DIR directory: ${workDir}`);
  }
  if (process.platform !== 'win32') {
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
      throw new Error(
        `Refusing REVIEW_DIR owned by uid ${st.uid} (expected ${process.getuid()}): ${workDir}`
      );
    }
    try {
      fs.chmodSync(workDir, 0o700);
    } catch (_) {}
  }
}

function buildHookScript() {
  return [
    '#!/bin/sh',
    `${MANAGED_HOOK_MARKER} - Trimurti local pre-push AI review gate.`,
    'set -eu',
    '',
    'warn_allow() {',
    '  echo "Trimurti pre-push AI review SKIPPED, push allowed: $1" >&2',
    '  exit 0',
    '}',
    '',
    'fail_or_warn() {',
    '  case "${REVIEWER_FAIL_CLOSED:-}" in',
    '    1|true|TRUE|True|yes|YES|Yes|on|ON|On)',
    '      echo "Trimurti pre-push AI review failed closed: $1" >&2',
    '      exit 1',
    '      ;;',
    '  esac',
    '  warn_allow "$1"',
    '}',
    '',
    'case "${REVIEWER_SKIP:-}" in',
    '  1|true|TRUE|True|yes|YES|Yes|on|ON|On) warn_allow "REVIEWER_SKIP is set." ;;',
    'esac',
    '',
    'HOOK_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P || dirname "$0")"',
    `PINNED_DIR="$HOOK_DIR/${PINNED_DIR_NAME}"`,
    '',
    'HOOK_GIT_DIR="$(git rev-parse --git-dir 2>/dev/null || true)"',
    'if [ -n "$HOOK_GIT_DIR" ] && [ -d "$HOOK_GIT_DIR" ]; then',
    '  HOOK_GIT_DIR="$(cd "$HOOK_GIT_DIR" 2>/dev/null && pwd || printf \'%s\' "$HOOK_GIT_DIR")"',
    'fi',
    'HOOK_COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"',
    'if [ -n "$HOOK_COMMON_DIR" ] && [ -d "$HOOK_COMMON_DIR" ]; then',
    '  HOOK_COMMON_DIR="$(cd "$HOOK_COMMON_DIR" 2>/dev/null && pwd || printf \'%s\' "$HOOK_COMMON_DIR")"',
    'fi',
    'HOOK_WORK_TREE=""',
    'if [ -n "${GIT_WORK_TREE:-}" ] && [ -d "$GIT_WORK_TREE" ]; then',
    '  HOOK_WORK_TREE="$(cd "$GIT_WORK_TREE" 2>/dev/null && pwd -P || printf \'%s\' "$GIT_WORK_TREE")"',
    'fi',
    '',
    'REPO_ROOT=""',
    'if [ -z "${GIT_DIR:-}" ] && [ -z "${GIT_WORK_TREE:-}" ]; then',
    '  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"',
    'else',
    '  if [ -n "$HOOK_GIT_DIR" ] && [ -f "$HOOK_GIT_DIR/gitdir" ] && [ ! -L "$HOOK_GIT_DIR/gitdir" ]; then',
    '    WT_DOTGIT="$(tr -d \'\\r\\n\' < "$HOOK_GIT_DIR/gitdir" 2>/dev/null || true)"',
    '    if [ -n "$WT_DOTGIT" ]; then',
    '      case "$WT_DOTGIT" in',
    '        /*|[A-Za-z]:/*|[A-Za-z]:\\\\*) WT_CAND="$(dirname "$WT_DOTGIT")" ;;',
    '        *)  WT_CAND="$(dirname "$HOOK_GIT_DIR/$WT_DOTGIT")" ;;',
    '      esac',
    '      if [ -d "$WT_CAND" ] && [ ! -L "$WT_CAND" ]; then',
    '        REPO_ROOT="$(cd "$WT_CAND" 2>/dev/null && pwd -P || true)"',
    '      fi',
    '    fi',
    '  fi',
    '  if [ -z "$REPO_ROOT" ] && [ -n "$HOOK_GIT_DIR" ] && [ "$(basename "$HOOK_GIT_DIR")" = ".git" ]; then',
    '    CAND_ROOT="$(dirname "$HOOK_GIT_DIR")"',
    '    if [ -d "$CAND_ROOT" ] && [ ! -L "$CAND_ROOT" ]; then',
    '      REPO_ROOT="$(cd "$CAND_ROOT" 2>/dev/null && pwd -P || true)"',
    '    fi',
    '  fi',
    '  if [ -z "$REPO_ROOT" ] && [ -n "$HOOK_COMMON_DIR" ] && [ "$(basename "$HOOK_COMMON_DIR")" = ".git" ]; then',
    '    COMMON_ROOT="$(dirname "$HOOK_COMMON_DIR")"',
    '    if [ -d "$COMMON_ROOT" ] && [ ! -L "$COMMON_ROOT" ]; then',
    '      REPO_ROOT="$(cd "$COMMON_ROOT" 2>/dev/null && pwd -P || true)"',
    '    fi',
    '  fi',
    '  if [ -z "$REPO_ROOT" ] && [ -n "$HOOK_GIT_DIR" ]; then',
    '    CFG_WT="$(git --git-dir="$HOOK_GIT_DIR" config --get core.worktree 2>/dev/null || true)"',
    '    if [ -n "$CFG_WT" ]; then',
    '      case "$CFG_WT" in',
    '        /*|[A-Za-z]:/*|[A-Za-z]:\\\\*) CFG_CAND="$CFG_WT" ;;',
    '        *)  CFG_CAND="$HOOK_GIT_DIR/$CFG_WT" ;;',
    '      esac',
    '      if [ -d "$CFG_CAND" ] && [ ! -L "$CFG_CAND" ]; then',
    '        REPO_ROOT="$(cd "$CFG_CAND" 2>/dev/null && pwd -P || true)"',
    '      fi',
    '    fi',
    '  fi',
    '  if [ -z "$REPO_ROOT" ] && [ -n "$HOOK_WORK_TREE" ]; then',
    '    REPO_ROOT="$HOOK_WORK_TREE"',
    '  fi',
    'fi',
    '',
    'SCRIPT=""',
    'if [ ! -L "$PINNED_DIR" ] && [ -f "$PINNED_DIR/pre-push-review.js" ] && [ ! -L "$PINNED_DIR/pre-push-review.js" ] && [ -f "$PINNED_DIR/reviewer.js" ] && [ ! -L "$PINNED_DIR/reviewer.js" ]; then',
    '  SCRIPT="$PINNED_DIR/pre-push-review.js"',
    'elif [ -n "$REPO_ROOT" ] && [ ! -L "$REPO_ROOT" ] && [ -f "$REPO_ROOT/scripts/pre-push-review.js" ] && [ ! -L "$REPO_ROOT/scripts/pre-push-review.js" ] && [ -f "$REPO_ROOT/scripts/reviewer.js" ] && [ ! -L "$REPO_ROOT/scripts/reviewer.js" ]; then',
    '  echo "Trimurti pre-push AI review: pinned copy missing; using checkout scripts. Re-run: node scripts/pre-push-review.js --install-hook" >&2',
    '  SCRIPT="$REPO_ROOT/scripts/pre-push-review.js"',
    'else',
    '  fail_or_warn "reviewer scripts not found (branch predates them or pinned scripts missing)."',
    'fi',
    '',
    'NODE_BIN=""',
    'if command -v node >/dev/null 2>&1; then',
    '  NODE_BIN="$(command -v node)"',
    'else',
    '  NVM_BASE="${NVM_DIR:-$HOME/.nvm}/versions/node"',
    '  if [ -d "$NVM_BASE" ]; then',
    '    if [ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/.node-version" ] && [ ! -L "$REPO_ROOT/.node-version" ]; then',
    '      WANT_VER="$(tr -d \'[:space:]\' < "$REPO_ROOT/.node-version")"',
    '      WANT_VER="${WANT_VER#v}"',
    '      WANT_VER="${WANT_VER#V}"',
    '      case "$WANT_VER" in',
    '        ""|*[!0-9.]*|.*|*.|*..*) WANT_VER="" ;;',
    '      esac',
    '      if [ -n "$WANT_VER" ]; then',
    '        for ver in $(cd "$NVM_BASE" 2>/dev/null && ls -1d v* 2>/dev/null | sed \'s/^v//\' | sort -t. -k1,1n -k2,2n -k3,3n); do',
    '          case "$ver" in',
    '            "$WANT_VER"|"$WANT_VER".*)',
    '              cand="$NVM_BASE/v$ver/bin/node"',
    '              if [ -x "$cand" ]; then',
    '                NODE_BIN="$cand"',
    '              fi',
    '              ;;',
    '          esac',
    '        done',
    '      fi',
    '    fi',
    '    if [ -z "$NODE_BIN" ]; then',
    '      for ver in $(cd "$NVM_BASE" 2>/dev/null && ls -1d v* 2>/dev/null | sed \'s/^v//\' | sort -t. -k1,1n -k2,2n -k3,3n); do',
    '        cand="$NVM_BASE/v$ver/bin/node"',
    '        if [ -x "$cand" ]; then',
    '          NODE_BIN="$cand"',
    '        fi',
    '      done',
    '    fi',
    '  fi',
    '  if [ -z "$NODE_BIN" ]; then',
    '    for cand in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do',
    '      if [ -x "$cand" ]; then',
    '        NODE_BIN="$cand"',
    '        break',
    '      fi',
    '    done',
    '  fi',
    'fi',
    '',
    'if [ -z "$NODE_BIN" ]; then',
    '  fail_or_warn "node executable not found in PATH or NVM."',
    'fi',
    '',
    'if [ -n "${GIT_DIR:-}" ] && [ -n "$HOOK_GIT_DIR" ]; then',
    '  export GIT_DIR="$HOOK_GIT_DIR"',
    'fi',
    'if [ -n "${GIT_WORK_TREE:-}" ] && [ -n "$HOOK_WORK_TREE" ]; then',
    '  export GIT_WORK_TREE="$HOOK_WORK_TREE"',
    'fi',
    'export PATH="$(dirname "$NODE_BIN"):$PATH"',
    'if [ -z "${GIT_DIR:-}" ] && [ -z "${GIT_WORK_TREE:-}" ] && [ -n "$REPO_ROOT" ] && [ -d "$REPO_ROOT" ] && [ ! -L "$REPO_ROOT" ]; then',
    '  cd "$REPO_ROOT"',
    'fi',
    'exec "$NODE_BIN" "$SCRIPT" "$@"',
    '',
  ].join('\n');
}

function writePinnedFileAtomically(targetPath, content, mode) {
  const tmpPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  try {
    if (fs.existsSync(targetPath)) {
      try {
        fs.chmodSync(targetPath, 0o600);
      } catch (_) {}
    }
    fs.writeFileSync(tmpPath, content, { mode });
    if (process.platform !== 'win32') {
      fs.chmodSync(tmpPath, mode);
    }
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch (_) {}
    throw err;
  }
}

function installPinnedScripts(hooksDir, sourceDir = __dirname) {
  const pinnedDir = path.join(hooksDir, PINNED_DIR_NAME);
  if (fs.existsSync(pinnedDir) && fs.lstatSync(pinnedDir).isSymbolicLink()) {
    throw new Error(`Refusing symlinked pinned reviewer directory: ${pinnedDir}`);
  }
  const contents = PINNED_SCRIPT_NAMES.map((name) => {
    const src = path.join(sourceDir, name);
    const st = fs.lstatSync(src);
    if (st.isSymbolicLink() || !st.isFile()) {
      throw new Error(`Refusing to pin non-regular reviewer script: ${src}`);
    }
    return [name, fs.readFileSync(src)];
  });
  fs.mkdirSync(pinnedDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(pinnedDir, 0o700);
    } catch (_) {}
  }
  const fileMode = process.platform === 'win32' ? 0o600 : 0o444;
  for (const [name, buf] of contents) {
    const dst = path.join(pinnedDir, name);
    if (fs.existsSync(dst) && fs.lstatSync(dst).isSymbolicLink()) {
      throw new Error(`Refusing symlinked pinned reviewer script: ${dst}`);
    }
    writePinnedFileAtomically(dst, buf, fileMode);
  }
  return pinnedDir;
}

function installPrePushHook(repoRoot, options = {}) {
  const gitOptions = {
    env: options.env,
    gitDir: options.gitDir || null,
    workTree: options.workTree || null,
  };
  const resolvedRoot = options.gitDir
    ? repoRoot
    : resolveRepoRoot(repoRoot, null, gitOptions);
  const hooksRes = runGit(resolvedRoot, ['rev-parse', '--git-path', 'hooks'], gitOptions);
  if (hooksRes.status !== 0 || !hooksRes.stdout.trim()) {
    throw new Error('Unable to resolve git hooks directory');
  }
  const hooksDir = path.resolve(resolvedRoot, hooksRes.stdout.trim());
  if (fs.existsSync(hooksDir) && fs.lstatSync(hooksDir).isSymbolicLink()) {
    throw new Error(`Refusing symlinked git hooks directory: ${hooksDir}`);
  }
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, 'pre-push');
  let backupPath = null;

  if (fs.existsSync(hookPath)) {
    const lst = fs.lstatSync(hookPath);
    if (lst.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite symlinked pre-push hook: ${hookPath}`);
    }
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (!existing.includes(MANAGED_HOOK_MARKER)) {
      if (!options.force) {
        throw new Error(
          `Existing unmanaged pre-push hook found at ${hookPath}; pass --force to back up and replace it`
        );
      }
      const backupDir =
        options.backupDir ||
        path.join(os.homedir(), '.cache', 'trimurti-git-hook-backups');
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      backupPath = path.join(backupDir, `pre-push.${Date.now()}.bak`);
      fs.writeFileSync(backupPath, existing, { encoding: 'utf8', mode: 0o600 });
    }
  }

  const pinnedDir = installPinnedScripts(hooksDir, options.sourceDir || __dirname);

  const tmpHook = path.join(
    hooksDir,
    `.pre-push.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  fs.writeFileSync(tmpHook, buildHookScript(), { encoding: 'utf8', mode: 0o755 });
  if (process.platform !== 'win32') {
    fs.chmodSync(tmpHook, 0o755);
  }
  fs.renameSync(tmpHook, hookPath);

  return { hookPath, backupPath, pinnedDir };
}

function writeDiffAtomically(diffPath, diffContent) {
  const { resolved, dir } = assertSafeOutputTarget(diffPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const rand = crypto.randomBytes(6).toString('hex');
  const tmpPath = path.join(
    dir,
    `.${path.basename(resolved)}.${process.pid}.${Date.now()}.${rand}.tmp`
  );
  try {
    fs.writeFileSync(tmpPath, diffContent, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') {
      fs.chmodSync(tmpPath, 0o600);
    }
    fs.renameSync(tmpPath, resolved);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch (_) {}
    throw err;
  }
}

function mergeHistorySecretIssues(baseResult, historySecretIssues = []) {
  if (!Array.isArray(historySecretIssues) || historySecretIssues.length === 0) {
    return baseResult;
  }
  const mergedIssues = Array.isArray(baseResult.issues) ? baseResult.issues.slice() : [];
  let addedHistoryCount = 0;
  for (const hIssue of historySecretIssues) {
    const alreadyPresent = mergedIssues.some(
      (existing) => existing.file === hIssue.file && existing.message === hIssue.message
    );
    if (!alreadyPresent) {
      mergedIssues.push({
        file: hIssue.file,
        line: hIssue.line,
        message: `${hIssue.message} (in pushed commit history)`,
      });
      addedHistoryCount += 1;
    }
  }
  const historyNote =
    addedHistoryCount > 0
      ? `Pre-push commit-history scan detected ${addedHistoryCount} credential/secret issue(s) in intermediate pushed commit(s).`
      : '';
  return {
    verdict: 'REQUEST_CHANGES',
    summary: historyNote ? `${baseResult.summary} ${historyNote}`.trim() : baseResult.summary,
    issues: mergedIssues,
  };
}

function failOpenResult({
  diffContent,
  historySecretIssues = [],
  reason,
  err,
  diffPath,
  outputPath,
}) {
  let floor = staticSecurityReview(diffContent);
  floor = mergeHistorySecretIssues(floor, historySecretIssues);
  const diffBytes = Buffer.byteLength(diffContent, 'utf8');
  if (floor.verdict !== 'APPROVE') {
    const blockedResult = {
      verdict: floor.verdict,
      summary: `${floor.summary} (reviewer unavailable: ${reason}; static security floor only)`,
      issues: floor.issues,
    };
    if (outputPath) {
      try {
        writeDiffAtomically(outputPath, JSON.stringify(blockedResult, null, 2) + '\n');
      } catch (_) {}
    }
    return {
      exitCode: 1,
      verdict: blockedResult.verdict,
      summary: blockedResult.summary,
      issues: blockedResult.issues,
      diffBytes,
      diffPath,
      outputPath,
    };
  }
  const errMsg = err && err.message ? err.message : String(err || reason);
  return {
    exitCode: 0,
    verdict: 'SKIPPED',
    summary: `reviewer unavailable (${reason}): ${sanitizeLogText(errMsg, 400)}`,
    issues: [],
    unavailableReason: reason,
    diffBytes,
    diffPath,
    outputPath,
  };
}

async function runPrePushReview(options = {}) {
  const env = options.env || process.env;
  const targetCtx = resolveTargetGitContext(
    options.repoRoot,
    options.repoRoot ? null : options.fallbackRepoRoot || null,
    env
  );
  const repoRoot = targetCtx.repoRoot;
  const workDir = options.reviewDir || defaultReviewDir(env);
  prepareSecureReviewDir(workDir);

  const diffPath =
    options.diffPath ||
    (env && env.REVIEW_DIFF_PATH && env.REVIEW_DIFF_PATH.trim()) ||
    path.join(workDir, 'pre-push.diff');
  const outputPath =
    options.outputPath ||
    (env && env.REVIEW_OUTPUT_PATH && env.REVIEW_OUTPUT_PATH.trim()) ||
    path.join(workDir, 'pre-push-review_result.json');
  const pipelineLockTarget = path.join(workDir, '.pre-push-pipeline');
  const effectiveTimeoutMs = resolveEffectiveTimeoutMs(options.timeoutMs, env);
  const maxChunks = resolveMaxReviewChunks(options, env);
  const MAX_HOOK_LOCK_WAIT_MS = 420000;
  const scaledTotalTimeoutMs = resolveEffectiveTotalTimeoutMs(
    options,
    env,
    maxChunks,
    effectiveTimeoutMs
  );
  const defaultLockWaitMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(MAX_HOOK_LOCK_WAIT_MS, scaledTotalTimeoutMs + 60000)
  );
  const pipelineLockTimeoutMs =
    Number.isFinite(options.lockWaitMs) && options.lockWaitMs > 0
      ? options.lockWaitMs
      : options.failOpen
        ? Math.min(defaultLockWaitMs, MAX_HOOK_LOCK_WAIT_MS)
        : defaultLockWaitMs;

  const computeDiffAndHistorySecrets = () => {
    const commitRanges = [];
    const diffContent = computePrePushDiff(repoRoot, {
      remoteName: options.remoteName,
      stdinText: options.stdinText,
      range: options.range,
      env,
      gitDir: targetCtx.gitDir,
      workTree: targetCtx.workTree,
      _commitRangesOut: commitRanges,
    });
    const historySecretIssues = scanPrePushHistorySecrets(repoRoot, commitRanges, {
      env,
      gitDir: targetCtx.gitDir,
      workTree: targetCtx.workTree,
    });
    return { diffContent, historySecretIssues };
  };

  const runLocked = () =>
    withOutputLock(
      pipelineLockTarget,
      async () => {
        for (const artifactPath of [diffPath, outputPath]) {
          assertSafeOutputTarget(artifactPath);
        }

        const { diffContent, historySecretIssues } = computeDiffAndHistorySecrets();
        writeDiffAtomically(diffPath, diffContent);

        if (options.offline) {
          let floor = staticSecurityReview(diffContent);
          floor = mergeHistorySecretIssues(floor, historySecretIssues);
          const diffBytes = Buffer.byteLength(diffContent, 'utf8');
          if (floor.verdict !== 'APPROVE') {
            writeDiffAtomically(outputPath, JSON.stringify(floor, null, 2) + '\n');
            return {
              exitCode: 1,
              verdict: floor.verdict,
              summary: floor.summary,
              issues: floor.issues,
              diffBytes,
              diffPath,
              outputPath,
            };
          }
          return {
            exitCode: 0,
            verdict: 'SKIPPED',
            summary: 'REVIEWER_OFFLINE is set (agy not contacted).',
            issues: [],
            unavailableReason: 'offline',
            diffBytes,
            diffPath,
            outputPath,
          };
        }

        let result;
        try {
          result = await runReview({
            diffPath,
            outputPath,
            models: options.models,
            timeoutMs: effectiveTimeoutMs,
            lockTimeoutMs: options.lockWaitMs,
            maxDiffChars: options.maxDiffChars,
            maxChunks: options.maxChunks,
            allowWslInterop: options.allowWslInterop,
            agyBin: options.agyBin,
            settingsPaths: options.settingsPaths,
            env,
          });
        } catch (err) {
          const reason = options.failOpen ? classifyReviewerUnavailable(err) : null;
          if (!reason) {
            throw err;
          }
          return failOpenResult({
            diffContent,
            historySecretIssues,
            reason,
            err,
            diffPath,
            outputPath,
          });
        }

        if (historySecretIssues.length > 0) {
          result = mergeHistorySecretIssues(result, historySecretIssues);
          writeDiffAtomically(outputPath, JSON.stringify(result, null, 2) + '\n');
        }

        return {
          exitCode: result.verdict === 'APPROVE' ? 0 : 1,
          verdict: result.verdict,
          summary: result.summary,
          issues: result.issues,
          diffBytes: Buffer.byteLength(diffContent, 'utf8'),
          diffPath,
          outputPath,
        };
      },
      pipelineLockTimeoutMs
    );

  try {
    return await runLocked();
  } catch (err) {
    if (!options.failOpen || !err || err.code !== REVIEW_LOCK_TIMEOUT_CODE) {
      throw err;
    }
    const { diffContent, historySecretIssues } = computeDiffAndHistorySecrets();
    return failOpenResult({
      diffContent,
      historySecretIssues,
      reason: 'lock-timeout',
      err,
      diffPath,
      outputPath,
    });
  }
}

const MAX_STDIN_BYTES = 16 * 1024 * 1024;
const DEFAULT_STDIN_TIMEOUT_MS = 30000;

function resolveStdinTimeoutMs(explicitTimeoutMs, cliTimeoutMs, env = process.env) {
  if (explicitTimeoutMs !== undefined) {
    if (
      !Number.isFinite(explicitTimeoutMs) ||
      explicitTimeoutMs <= 0 ||
      explicitTimeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new Error(`Invalid stdinTimeoutMs: "${explicitTimeoutMs}"`);
    }
    return explicitTimeoutMs;
  }
  const rawEnv =
    env && env.PRE_PUSH_STDIN_TIMEOUT_MS !== undefined
      ? String(env.PRE_PUSH_STDIN_TIMEOUT_MS).trim()
      : '';
  if (rawEnv !== '') {
    return parsePositiveSafeInt(rawEnv, 'PRE_PUSH_STDIN_TIMEOUT_MS', MAX_TIMEOUT_MS);
  }
  if (Number.isFinite(cliTimeoutMs) && cliTimeoutMs > 0) {
    return Math.min(cliTimeoutMs, DEFAULT_STDIN_TIMEOUT_MS);
  }
  if (
    env &&
    ((env.REVIEWER_TIMEOUT_MS !== undefined && env.REVIEWER_TIMEOUT_MS !== '') ||
      (env.AGY_TIMEOUT_MS !== undefined && env.AGY_TIMEOUT_MS !== ''))
  ) {
    return Math.min(resolveEffectiveTimeoutMs(undefined, env), DEFAULT_STDIN_TIMEOUT_MS);
  }
  return DEFAULT_STDIN_TIMEOUT_MS;
}

function readAllStdin(
  stream = process.stdin,
  maxBytes = MAX_STDIN_BYTES,
  timeoutMs = DEFAULT_STDIN_TIMEOUT_MS
) {
  return new Promise((resolve, reject) => {
    if (
      !stream ||
      typeof stream.on !== 'function' ||
      typeof stream.removeListener !== 'function'
    ) {
      reject(new Error('Invalid stdin stream'));
      return;
    }
    const installLateErrorGuard = () => {
      const swallowLateError = () => {};
      const clearLateError = () => {
        stream.removeListener('error', swallowLateError);
      };
      stream.on('error', swallowLateError);
      if (stream.closed || (stream._readableState && stream._readableState.closed)) {
        setImmediate(clearLateError);
      } else {
        stream.once('close', clearLateError);
      }
    };

    if (
      !Number.isFinite(maxBytes) ||
      maxBytes <= 0 ||
      maxBytes > Number.MAX_SAFE_INTEGER
    ) {
      installLateErrorGuard();
      reject(new Error(`Invalid stdin maxBytes: ${maxBytes}`));
      return;
    }
    if (
      timeoutMs !== undefined &&
      timeoutMs !== null &&
      (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS)
    ) {
      installLateErrorGuard();
      reject(new Error(`Invalid stdin timeoutMs: ${timeoutMs}`));
      return;
    }
    if (stream.errored) {
      installLateErrorGuard();
      reject(
        stream.errored instanceof Error
          ? stream.errored
          : new Error(`Stdin stream errored before EOF: ${String(stream.errored)}`)
      );
      return;
    }
    if (stream.destroyed) {
      installLateErrorGuard();
      reject(new Error('Stdin stream was destroyed before EOF'));
      return;
    }
    if (stream.readableEnded || stream.readableDidRead) {
      installLateErrorGuard();
      reject(new Error('Stdin stream was already consumed before readAllStdin attached'));
      return;
    }

    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      stream.removeListener('close', onClose);
    };

    const finishError = (err, abortActiveStream = false) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      if (abortActiveStream) {
        // Attach before cleanup() and pause() so synchronous pause->destroy(err)
        // or nextTick emitErrorNT on an already-destroyed stream never goes unhandled.
        installLateErrorGuard();
        cleanup();
        if (typeof stream.pause === 'function') {
          try {
            stream.pause();
          } catch (_) {}
        }
        if (stream === process.stdin && typeof stream.unref === 'function') {
          try {
            stream.unref();
          } catch (_) {}
        }
      } else {
        cleanup();
      }
      reject(err);
    };

    const onData = (chunk) => {
      let buf;
      if (Buffer.isBuffer(chunk)) {
        buf = chunk;
      } else if (ArrayBuffer.isView(chunk)) {
        buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      } else if (chunk instanceof ArrayBuffer) {
        buf = Buffer.from(chunk);
      } else if (typeof chunk === 'string') {
        buf = Buffer.from(chunk, 'utf8');
      } else {
        finishError(new Error(`Invalid pre-push stdin chunk type: ${typeof chunk}`), true);
        return;
      }
      if (buf.includes(0)) {
        finishError(new Error('Invalid NUL byte in pre-push stdin'), true);
        return;
      }
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        finishError(new Error(`Pre-push stdin exceeded maximum size of ${maxBytes} bytes`), true);
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (settled) return;
      let decoded;
      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      } catch (_) {
        finishError(new Error('Invalid UTF-8 byte sequence in pre-push stdin'), false);
        return;
      }
      settled = true;
      cleanup();
      resolve(decoded);
    };

    const onError = (err) => {
      finishError(err instanceof Error ? err : new Error(String(err)), true);
    };

    const onClose = () => {
      if (settled) return;
      finishError(new Error('Stdin stream closed unexpectedly before EOF'), false);
    };

    if (timeoutMs !== undefined && timeoutMs !== null) {
      timer = setTimeout(() => {
        finishError(
          new Error(`Timed out after ${timeoutMs}ms waiting for pre-push stdin EOF`),
          true
        );
      }, timeoutMs);
    }

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    stream.on('close', onClose);
    if (typeof stream.resume === 'function') {
      stream.resume();
    }
  });
}

async function runCli(argv = process.argv.slice(2), env = process.env, io = {}) {
  let opts;
  try {
    opts = parsePrePushArgs(argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return 1;
  }

  if (opts.help) {
    console.log(
      'Usage: node scripts/pre-push-review.js [remote-name] [remote-url] [--install-hook] [--force] [--range <rev-range>] [--allow-wsl-interop]'
    );
    return 0;
  }

  const explicitRepoRoot = io.repoRoot || undefined;
  const fallbackRepoRoot = explicitRepoRoot ? null : resolveDefaultFallbackRepoRoot(__dirname);

  if (opts.installHook) {
    try {
      const targetCtx = resolveTargetGitContext(explicitRepoRoot, fallbackRepoRoot, env);
      const { hookPath, backupPath, pinnedDir } = installPrePushHook(targetCtx.repoRoot, {
        force: opts.force,
        env,
        gitDir: targetCtx.gitDir,
        workTree: targetCtx.workTree,
      });
      console.log(`Installed Trimurti pre-push AI review hook at ${hookPath}`);
      console.log(`Pinned reviewer scripts at ${pinnedDir} (re-run --install-hook to update them)`);
      if (backupPath) {
        console.log(`Backed up previous pre-push hook to ${backupPath}`);
      }
      return 0;
    } catch (err) {
      console.error(`Error installing pre-push hook: ${err.message}`);
      return 1;
    }
  }

  if (isTruthyEnvFlag(env, 'REVIEWER_SKIP')) {
    console.error('[Trimurti Pre-Push Review] SKIPPED, push allowed: REVIEWER_SKIP is set.');
    return 0;
  }

  const isTty =
    io.isTTY !== undefined
      ? Boolean(io.isTTY)
      : io.stdinStream
        ? Boolean(io.stdinStream.isTTY)
        : Boolean(tty.isatty(0));
  let stdinText;
  if (opts.range) {
    stdinText = undefined;
  } else if (io.stdinText !== undefined) {
    stdinText = io.stdinText;
  } else if (!isTty && (opts.positionalCount === 2 || Boolean(io.stdinStream))) {
    // Only read hook ref lines from stdin in git's `<remote-name> <remote-url>` hook
    // protocol (2 positional args) or when a test explicitly injects `io.stdinStream`.
    // Manual CLI checks (`positionalCount < 2`) in non-TTY runners with open/idle
    // stdin pipes must never block waiting for EOF on `process.stdin`.
    let rawStdin;
    try {
      const stdinTimeoutMs = resolveStdinTimeoutMs(io.stdinTimeoutMs, opts.timeoutMs, env);
      const maxStdinBytes = io.maxStdinBytes !== undefined ? io.maxStdinBytes : MAX_STDIN_BYTES;
      rawStdin = await readAllStdin(
        io.stdinStream || process.stdin,
        maxStdinBytes,
        stdinTimeoutMs
      );
    } catch (err) {
      console.error(
        `[Trimurti Pre-Push Review] ERROR (fail-closed): Failed to read pre-push stdin: ${sanitizeLogText(err.message)}`
      );
      return 1;
    }
    if (rawStdin.trim() !== '') {
      stdinText = rawStdin;
    } else if (opts.positionalCount === 2) {
      // Invoked by `git push` as `.git/hooks/pre-push <remote-name> <remote-url>`
      // with zero ref updates on stdin (up-to-date push).
      stdinText = '';
    } else {
      stdinText = undefined;
    }
  } else {
    stdinText = undefined;
  }

  const isHookInvocation = !opts.range && stdinText !== undefined;
  const offlineMode = isTruthyEnvFlag(env, 'REVIEWER_OFFLINE');
  const failOpenMode =
    isHookInvocation &&
    !isTruthyEnvFlag(env, 'REVIEWER_FAIL_CLOSED');

  try {
    const res = await runPrePushReview({
      repoRoot: explicitRepoRoot,
      fallbackRepoRoot,
      remoteName: opts.remoteName,
      stdinText,
      range: opts.range,
      outputPath: opts.outputPath || undefined,
      models: opts.models,
      timeoutMs: opts.timeoutMs,
      maxDiffChars: opts.maxDiffChars,
      allowWslInterop: opts.allowWslInterop,
      offline: offlineMode,
      failOpen: failOpenMode,
      env,
    });

    if (res.verdict === 'SKIPPED') {
      if (res.unavailableReason === 'offline') {
        console.error(
          '[Trimurti Pre-Push Review] SKIPPED, push allowed: REVIEWER_OFFLINE is set (agy not contacted).'
        );
      } else {
        console.error(
          `[Trimurti Pre-Push Review] WARNING: push allowed without AI review, ${res.summary}. Set REVIEWER_FAIL_CLOSED=1 to block instead.`
        );
      }
      return 0;
    }

    if (res.verdict === 'APPROVE') {
      console.error(`[Trimurti Pre-Push Review] APPROVE: ${sanitizeLogText(res.summary)}`);
      return 0;
    }

    console.error(`[Trimurti Pre-Push Review] REQUEST_CHANGES: ${sanitizeLogText(res.summary)}`);
    for (const issue of res.issues) {
      const loc = issue.line ? `${issue.file}:${issue.line}` : issue.file;
      console.error(`  - ${sanitizeLogText(loc)}: ${sanitizeLogText(issue.message)}`);
    }
    console.error(`Saved review verdict artifact: ${res.outputPath}`);
    return 1;
  } catch (err) {
    console.error(`[Trimurti Pre-Push Review] ERROR (fail-closed): ${sanitizeLogText(err.message)}`);
    return 1;
  }
}

if (require.main === module) {
  runCli().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}

module.exports = {
  MANAGED_HOOK_MARKER,
  PINNED_DIR_NAME,
  MAX_STDIN_BYTES,
  DEFAULT_STDIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  defaultReviewDir,
  buildHookScript,
  failOpenResult,
  parsePrePushArgs,
  parsePrePushStdin,
  computePrePushDiff,
  scanPrePushHistorySecrets,
  installPrePushHook,
  runPrePushReview,
  resolveTargetGitContext,
  resolveStdinTimeoutMs,
  readAllStdin,
  runCli,
};
