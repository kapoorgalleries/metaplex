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
const { spawnSync } = require('child_process');

const {
  assertAllowedReviewerModel,
  assertSafeOutputTarget,
  resolveEffectiveTimeoutMs,
  runReview,
  withOutputLock,
} = require('./reviewer');

const MANAGED_HOOK_MARKER = '# Managed by scripts/pre-push-review.js';
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const HEX_OID_RE = /^[0-9a-f]{40,64}$/i;
const ZERO_OID_RE = /^0+$/;

function defaultReviewDir(env = process.env, platform = process.platform) {
  if (env && env.REVIEW_DIR && env.REVIEW_DIR.trim() !== '') {
    return env.REVIEW_DIR.trim();
  }
  if (platform === 'win32') {
    return path.join(os.tmpdir(), 'gemini');
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
      if (!val || val.startsWith('-')) {
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
      if (!val || !/^\d+$/.test(val) || Number(val) <= 0) {
        throw new Error(`Invalid --timeout-ms: "${val ?? ''}"`);
      }
      timeoutMs = Number(val);
      continue;
    }
    if (
      !endOfOptions &&
      (arg === '--max-diff-chars' || arg.startsWith('--max-diff-chars='))
    ) {
      const val =
        arg === '--max-diff-chars' ? argv[++i] : arg.slice('--max-diff-chars='.length);
      if (!val || !/^\d+$/.test(val) || Number(val) <= 0) {
        throw new Error(`Invalid --max-diff-chars: "${val ?? ''}"`);
      }
      maxDiffChars = Number(val);
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

function runGit(repoRoot, args, options = {}) {
  const res = spawnSync('git', args, {
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

function resolveRepoRoot(cwd = process.cwd(), fallbackDir = null) {
  if (cwd && fs.existsSync(cwd)) {
    const res = runGit(cwd, ['rev-parse', '--show-toplevel']);
    if (res.status === 0 && res.stdout.trim()) {
      return res.stdout.trim();
    }
  }
  if (fallbackDir && fs.existsSync(fallbackDir)) {
    const fbRes = runGit(fallbackDir, ['rev-parse', '--show-toplevel']);
    if (fbRes.status === 0 && fbRes.stdout.trim()) {
      return fbRes.stdout.trim();
    }
  }
  throw new Error(`Not inside a git repository: ${cwd}`);
}

function resolveCommitOid(repoRoot, rev) {
  if (!rev) return null;
  const res = runGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  if (res.status !== 0) return null;
  const oid = res.stdout.trim();
  return HEX_OID_RE.test(oid) ? oid : null;
}

function resolveTreeOid(repoRoot, rev) {
  if (!rev) return null;
  const res = runGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${rev}^{tree}`]);
  if (res.status !== 0) return null;
  const oid = res.stdout.trim();
  return HEX_OID_RE.test(oid) ? oid : null;
}

function resolveBlobOid(repoRoot, rev) {
  if (!rev) return null;
  const res = runGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${rev}^{blob}`]);
  if (res.status !== 0) return null;
  const oid = res.stdout.trim();
  return HEX_OID_RE.test(oid) ? oid : null;
}

function formatPushedBlobDiff(repoRoot, blobOid, refLabel) {
  const res = spawnSync('git', ['cat-file', 'blob', blobOid], {
    cwd: repoRoot,
    env: buildGitSubprocessEnv(process.env),
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

function getMergeBase(repoRoot, oidA, oidB) {
  const res = runGit(repoRoot, ['merge-base', oidA, oidB]);
  if (res.status !== 0) return null;
  const oid = res.stdout.trim();
  return HEX_OID_RE.test(oid) ? oid : null;
}

function isAncestor(repoRoot, ancestorOid, descendantOid) {
  if (!ancestorOid || !descendantOid) return false;
  if (ancestorOid === descendantOid) return true;
  const res = runGit(repoRoot, ['merge-base', '--is-ancestor', ancestorOid, descendantOid]);
  return res.status === 0;
}

function isShallowRepository(repoRoot) {
  const res = runGit(repoRoot, ['rev-parse', '--is-shallow-repository']);
  return res.status === 0 && res.stdout.trim() === 'true';
}

function getEmptyTreeOid(repoRoot) {
  const res = runGit(repoRoot, ['hash-object', '-t', 'tree', '--stdin'], { input: '' });
  if (res.status !== 0 || !res.stdout.trim()) {
    throw new Error('Unable to compute git empty tree OID');
  }
  return res.stdout.trim();
}

function resolveDefaultBaseCommit(repoRoot, remoteName = 'origin', refOptions = {}) {
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
    const oid = resolveCommitOid(repoRoot, cand);
    if (oid) return oid;
  }

  if (allowLocalHeads) {
    for (const localCand of ['refs/heads/main', 'refs/heads/master']) {
      if (localCand === localRef || localCand === remoteRef) continue;
      const oid = resolveCommitOid(repoRoot, localCand);
      if (oid) return oid;
    }
  }
  return null;
}

function parsePrePushStdin(stdinText) {
  if (typeof stdinText !== 'string' || stdinText.trim() === '') {
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

  if (options.range) {
    if (options.range.startsWith('-')) {
      throw new Error(`Invalid revision range "${options.range}"`);
    }
    const diffRes = runGit(repoRoot, [
      'diff',
      '--no-ext-diff',
      '--no-color',
      options.range,
      '--',
    ]);
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
    const headOid = resolveCommitOid(repoRoot, 'HEAD');
    if (!headOid) {
      return '';
    }
    const symRes = runGit(repoRoot, ['symbolic-ref', '--quiet', 'HEAD']);
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
    const localCommit = resolveCommitOid(repoRoot, update.localOid);
    if (!localCommit) {
      const localTree = resolveTreeOid(repoRoot, update.localOid);
      if (localTree) {
        const remoteTree = !ZERO_OID_RE.test(update.remoteOid)
          ? resolveTreeOid(repoRoot, update.remoteOid)
          : null;
        if (remoteTree === localTree) {
          continue;
        }
        const treeFromOid = remoteTree || (emptyTreeOid = emptyTreeOid || getEmptyTreeOid(repoRoot));
        const treePairKey = `tree:${treeFromOid}..${localTree}`;
        if (!seenPairs.has(treePairKey)) {
          seenPairs.add(treePairKey);
          const treeDiffRes = runGit(repoRoot, [
            'diff',
            '--no-ext-diff',
            '--no-color',
            treeFromOid,
            localTree,
            '--',
          ]);
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

      const localBlob = resolveBlobOid(repoRoot, update.localOid);
      if (localBlob) {
        const remoteBlob = !ZERO_OID_RE.test(update.remoteOid)
          ? resolveBlobOid(repoRoot, update.remoteOid)
          : null;
        if (remoteBlob === localBlob) {
          continue;
        }
        const blobKey = `blob:${localBlob}:${update.remoteRef || update.localRef}`;
        if (!seenPairs.has(blobKey)) {
          seenPairs.add(blobKey);
          chunks.push(formatPushedBlobDiff(repoRoot, localBlob, update.remoteRef || update.localRef));
        }
        continue;
      }

      throw new Error(
        `Unable to resolve pushed git object "${update.localOid}" for ref "${update.localRef}"`
      );
    }

    const remoteCommit = !ZERO_OID_RE.test(update.remoteOid)
      ? resolveCommitOid(repoRoot, update.remoteOid)
      : null;

    let fromOid = null;
    if (remoteCommit) {
      if (remoteCommit === localCommit) {
        continue;
      }
      if (isAncestor(repoRoot, remoteCommit, localCommit)) {
        // Fast-forward push: review strictly the newly pushed commits.
        fromOid = remoteCommit;
      } else {
        // Non-fast-forward force-push (rebase, amend, ancestor rewind, or orphan rewrite):
        // prefer merge-base against the remote's default branch so rebased PR branches
        // exclude upstream master commits and ancestor rewinds still scan remaining PR commits;
        // otherwise diff directly from the overwritten remoteCommit tree.
        const defaultBase = resolveDefaultBaseCommit(repoRoot, remoteName, {
          localRef: update.localRef,
          remoteRef: update.remoteRef,
          allowLocalHeads: !isHookStdinMode,
        });
        const mbDefault = defaultBase
          ? getMergeBase(repoRoot, defaultBase, localCommit)
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
      const defaultBase = resolveDefaultBaseCommit(repoRoot, remoteName, {
        localRef: update.localRef,
        remoteRef: update.remoteRef,
        allowLocalHeads: !isHookStdinMode,
      });
      if (defaultBase) {
        const mb = getMergeBase(repoRoot, defaultBase, localCommit);
        if (mb) {
          fromOid = mb;
        } else {
          if (shallowChecked === null) {
            shallowChecked = isShallowRepository(repoRoot);
          }
          if (shallowChecked) {
            fromOid = defaultBase;
          } else {
            emptyTreeOid = emptyTreeOid || getEmptyTreeOid(repoRoot);
            fromOid = emptyTreeOid;
          }
        }
      } else {
        emptyTreeOid = emptyTreeOid || getEmptyTreeOid(repoRoot);
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

    const diffRes = runGit(repoRoot, [
      'diff',
      '--no-ext-diff',
      '--no-color',
      fromOid,
      localCommit,
      '--',
    ]);
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
    `${MANAGED_HOOK_MARKER} — Trimurti local pre-push AI review gate.`,
    'set -eu',
    '',
    'REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"',
    'if [ -z "$REPO_ROOT" ] || [ ! -f "$REPO_ROOT/scripts/pre-push-review.js" ]; then',
    '  echo "Trimurti pre-push AI review failed closed: scripts/pre-push-review.js not found." >&2',
    '  exit 1',
    'fi',
    '',
    'NODE_BIN=""',
    'if command -v node >/dev/null 2>&1; then',
    '  NODE_BIN="$(command -v node)"',
    'else',
    '  NVM_BASE="${NVM_DIR:-$HOME/.nvm}/versions/node"',
    '  if [ -d "$NVM_BASE" ]; then',
    '    if [ -f "$REPO_ROOT/.node-version" ]; then',
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
    '  echo "Trimurti pre-push AI review failed closed: node executable not found in PATH or NVM." >&2',
    '  exit 1',
    'fi',
    '',
    'export PATH="$(dirname "$NODE_BIN"):$PATH"',
    'exec "$NODE_BIN" "$REPO_ROOT/scripts/pre-push-review.js" "$@"',
    '',
  ].join('\n');
}

function installPrePushHook(repoRoot, options = {}) {
  const resolvedRoot = resolveRepoRoot(repoRoot);
  const hooksRes = runGit(resolvedRoot, ['rev-parse', '--git-path', 'hooks']);
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

  const tmpHook = path.join(
    hooksDir,
    `.pre-push.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  fs.writeFileSync(tmpHook, buildHookScript(), { encoding: 'utf8', mode: 0o755 });
  if (process.platform !== 'win32') {
    fs.chmodSync(tmpHook, 0o755);
  }
  fs.renameSync(tmpHook, hookPath);

  return { hookPath, backupPath };
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

async function runPrePushReview(options = {}) {
  const env = options.env || process.env;
  const repoRoot = resolveRepoRoot(
    options.repoRoot || process.cwd(),
    options.repoRoot ? null : options.fallbackRepoRoot || null
  );
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
  const pipelineLockTimeoutMs = Math.max(420000, effectiveTimeoutMs + 60000);

  return withOutputLock(
    pipelineLockTarget,
    async () => {
      for (const artifactPath of [diffPath, outputPath]) {
        assertSafeOutputTarget(artifactPath);
      }

      const diffContent = computePrePushDiff(repoRoot, {
        remoteName: options.remoteName,
        stdinText: options.stdinText,
        range: options.range,
      });

      writeDiffAtomically(diffPath, diffContent);

      const result = await runReview({
        diffPath,
        outputPath,
        models: options.models,
        timeoutMs: effectiveTimeoutMs,
        maxDiffChars: options.maxDiffChars,
        allowWslInterop: options.allowWslInterop,
        agyBin: options.agyBin,
        settingsPaths: options.settingsPaths,
        env,
      });

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
}

function readAllStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
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
  const fallbackRepoRoot = explicitRepoRoot ? null : path.resolve(__dirname, '..');

  if (opts.installHook) {
    try {
      const targetRoot = resolveRepoRoot(
        explicitRepoRoot || process.cwd(),
        fallbackRepoRoot
      );
      const { hookPath, backupPath } = installPrePushHook(targetRoot, {
        force: opts.force,
      });
      console.log(`Installed Trimurti pre-push AI review hook at ${hookPath}`);
      if (backupPath) {
        console.log(`Backed up previous pre-push hook to ${backupPath}`);
      }
      return 0;
    } catch (err) {
      console.error(`Error installing pre-push hook: ${err.message}`);
      return 1;
    }
  }

  const isTty = io.isTTY !== undefined ? Boolean(io.isTTY) : Boolean(process.stdin.isTTY);
  let stdinText;
  if (opts.range) {
    stdinText = undefined;
  } else if (io.stdinText !== undefined) {
    stdinText = io.stdinText;
  } else if (!isTty) {
    const rawStdin = readAllStdinSync();
    if (rawStdin.trim() !== '') {
      stdinText = rawStdin;
    } else if (opts.positionalCount === 2) {
      // Invoked by `git push` as `.git/hooks/pre-push <remote-name> <remote-url>`
      // with zero ref updates on stdin (up-to-date push).
      stdinText = '';
    } else {
      // Invoked as a manual/script CLI check in a non-TTY subshell without `--range`.
      stdinText = undefined;
    }
  } else {
    stdinText = undefined;
  }

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
      env,
    });

    if (res.verdict === 'APPROVE') {
      console.error(`[Trimurti Pre-Push Review] APPROVE: ${res.summary}`);
      return 0;
    }

    console.error(`[Trimurti Pre-Push Review] REQUEST_CHANGES: ${res.summary}`);
    for (const issue of res.issues) {
      const loc = issue.line ? `${issue.file}:${issue.line}` : issue.file;
      console.error(`  - ${loc}: ${issue.message}`);
    }
    console.error(`Saved review verdict artifact: ${res.outputPath}`);
    return 1;
  } catch (err) {
    console.error(`[Trimurti Pre-Push Review] ERROR (fail-closed): ${err.message}`);
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
  defaultReviewDir,
  parsePrePushArgs,
  parsePrePushStdin,
  computePrePushDiff,
  installPrePushHook,
  runPrePushReview,
  runCli,
};
