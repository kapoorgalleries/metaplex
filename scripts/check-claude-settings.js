#!/usr/bin/env node
// Checks .claude/settings.json, the committed Claude Code permission policy.
//
// Why this exists: PRs #20 and #21 each added their own "allow" key to the
// file. JSON allows that, JSON.parse keeps the last one silently, and so
// #21's rules were never in effect (PR #23). This script fails on a duplicate
// key at any depth, then checks the parts of the file this repository relies
// on against the Claude Code reference: permission keys, values and lists,
// hook event names, the hook types each event supports, hook fields, and
// that every command hook runs an allowed interpreter in exec form on a
// script that lives under .claude/hooks/, is present, and parses.
//
// This is a lint that catches mistakes, not a security boundary: CI runs the
// pull request's own copy of this script, so a pull request can change the
// checker along with the settings. The security boundary is reviewing the
// diff.
//
// Run: node scripts/check-claude-settings.js
// CI:  .github/workflows/claude-settings.yml

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Deeper than this is not a settings file. JSON.parse would accept it; we
// stop with a clear message instead of a RangeError from the call stack.
const MAX_DEPTH = 256;

// Hook scripts must live here, so an edit to one is covered by the CI path
// filter (.claude/**) and the file is reviewed with the policy that runs it.
const HOOKS_DIR = '.claude/hooks/';

// Documented names, from code.claude.com/docs/en/settings-reference and
// code.claude.com/docs/en/hooks. An entry outside these lists is most likely
// a typo that Claude Code drops, which is the class of failure this script
// exists to catch. An unknown hook event gets a Settings Warning at the start
// of an interactive session and nothing in a -p or CI run; an unknown
// permission key or hook field gets no warning anywhere. When the docs add a
// name, add it here.
const SKIPPED_EVENT = 'Claude Code skips it (a Settings Warning in an interactive session, nothing in a -p or CI run)';
const IGNORED_KEY = 'Claude Code ignores it without any warning, interactive or -p';
const PERMISSION_KEYS = [
  'allow', 'ask', 'deny', 'additionalDirectories', 'defaultMode',
  'blockReadsOutsideWorkingDirectories', 'disableBypassPermissionsMode', 'disableAutoMode',
];
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions', 'manual'];
// Documented as having no effect from project or local settings.
const PROJECT_INEFFECTIVE_MODES = ['auto', 'bypassPermissions'];
const HOOK_EVENTS = [
  'SessionStart', 'Setup', 'InstructionsLoaded', 'UserPromptSubmit', 'UserPromptExpansion',
  'MessageDisplay', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure',
  'PostToolBatch', 'PermissionDenied', 'Notification', 'SubagentStart', 'SubagentStop',
  'TaskCreated', 'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle', 'ConfigChange',
  'CwdChanged', 'DirectoryAdded', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove',
  'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'SessionEnd',
  'Elicitation', 'ElicitationResult',
];
// "if" is evaluated only on these events; elsewhere a hook with "if" never runs.
const TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied'];
// A matcher on these events is ignored.
const NO_MATCHER_EVENTS = [
  'CwdChanged', 'UserPromptSubmit', 'PostToolBatch', 'Stop', 'TeammateIdle', 'TaskCreated',
  'TaskCompleted', 'WorktreeCreate', 'WorktreeRemove', 'MessageDisplay',
];
const HOOK_TYPES = ['command', 'http', 'mcp_tool', 'prompt', 'agent'];
// Which hook types each event runs (hooks reference, "Prompt-based hooks",
// and "Setup decision control" for Setup). Claude Code skips the others.
const ALL_TYPES = HOOK_TYPES;
const NO_LLM_TYPES = ['command', 'http', 'mcp_tool'];
const EVENT_HOOK_TYPES = {
  PermissionDenied: ALL_TYPES, PostToolBatch: ALL_TYPES, PostToolUse: ALL_TYPES,
  PostToolUseFailure: ALL_TYPES, PreToolUse: ALL_TYPES, Stop: ALL_TYPES, SubagentStop: ALL_TYPES,
  TaskCompleted: ALL_TYPES, TaskCreated: ALL_TYPES, TeammateIdle: ALL_TYPES,
  UserPromptExpansion: ALL_TYPES, UserPromptSubmit: ALL_TYPES,
  PermissionRequest: ['command', 'http', 'mcp_tool', 'prompt'],
  ConfigChange: NO_LLM_TYPES, CwdChanged: NO_LLM_TYPES, DirectoryAdded: NO_LLM_TYPES,
  Elicitation: NO_LLM_TYPES, ElicitationResult: NO_LLM_TYPES, FileChanged: NO_LLM_TYPES,
  InstructionsLoaded: NO_LLM_TYPES, MessageDisplay: NO_LLM_TYPES, Notification: NO_LLM_TYPES,
  PostCompact: NO_LLM_TYPES, PostModelSwitch: NO_LLM_TYPES, PreCompact: NO_LLM_TYPES,
  PreModelSwitch: NO_LLM_TYPES, SessionEnd: NO_LLM_TYPES, StopFailure: NO_LLM_TYPES,
  SubagentStart: NO_LLM_TYPES, WorktreeCreate: NO_LLM_TYPES, WorktreeRemove: NO_LLM_TYPES,
  SessionStart: ['command', 'mcp_tool'],
  Setup: ['command'],
};
// "once" is documented but honoured only in skill frontmatter; see checkHook.
const HOOK_COMMON_FIELDS = ['type', 'if', 'timeout', 'statusMessage', 'once'];
const HOOK_TYPE_FIELDS = {
  command: ['command', 'args', 'async', 'asyncRewake', 'shell'],
  http: ['url', 'headers', 'allowedEnvVars'],
  mcp_tool: ['server', 'tool', 'input'],
  prompt: ['prompt', 'model', 'continueOnBlock'],
  agent: ['prompt', 'model'],
};
const HOOK_REQUIRED_STRINGS = { http: ['url'], mcp_tool: ['server', 'tool'], prompt: ['prompt'], agent: ['prompt'] };
// An mcp_tool hook calls a tool on an MCP server configured somewhere else
// (another settings file, .mcp.json, a plugin) with "input" written in this
// file. A tool that can run commands, write files or send data would let a
// hook do that from inline input that no reviewed script holds, which is
// what the command-hook rules forbid. So only the server/tool pairs listed
// here are accepted, matched exactly. Add a pair only after confirming that
// the tool can do none of those things, whatever its input.
//
// A pair binds only a server name, which Claude Code looks up among the
// servers configured on the machine running the hook. So each entry also
// pins that server's definition in the committed .mcp.json,
// { server, tool, definition }: the server must be defined there, exactly as
// pinned, and an edit to .mcp.json fails the check until the pin is reviewed
// and updated. A pinned definition may not use ${VAR} expansion, which
// differs per machine; a stdio server should name an exact package version,
// since `npx -y pkg` runs whatever is published. Claude Code reads this
// file's hooks only in a session started at the repository root, where the
// root .mcp.json is the nearest one and so wins over any above it. What no
// check here can see: a local-scope, managed or --mcp-config server of the
// same name replaces the project one on that machine, and so does a
// user-scope one while the project server is not yet approved.
const MCP_TOOL_HOOKS = [];
// An http hook posts every hook input (tool inputs, prompts) to its URL,
// and the reply is handled like a command hook's output: it can approve or
// block a tool call, change the call's input, or add to Claude's context.
// Its headers can also carry the environment variables it names in
// allowedEnvVars. So only URLs listed here are accepted, matched exactly.
// Add one only after confirming who runs that endpoint and what it does
// with what it receives.
const HTTP_HOOK_URLS = [];
// What this file holds at the top level. Anything within two edits of one
// of these names is a misspelling that would silently drop the whole block.
const TOP_LEVEL_KEYS_HERE = ['permissions', 'hooks'];
// The only top-level keys accepted. Other settings can bring in code no
// reviewed script holds: enabledPlugins and extraKnownMarketplaces load a
// plugin with its own hooks, and apiKeyHelper, statusLine, awsAuthRefresh,
// awsCredentialExport and otelHeadersHelper run commands. A key added here
// must be one that runs nothing.
const TOP_LEVEL_KEYS = [...TOP_LEVEL_KEYS_HERE, '$schema'];

// A small JSON parser that rejects duplicate keys. Objects are returned as
// prototype-less so a key such as "__proto__" cannot shadow anything.
function parseStrict(text) {
  let i = 0;
  let depth = 0;
  const err = (msg) => {
    const line = text.slice(0, i).split('\n').length;
    throw new Error(`${msg} (line ${line})`);
  };
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const enter = () => {
    if (++depth > MAX_DEPTH) err(`nesting deeper than ${MAX_DEPTH} levels`);
  };
  const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

  function value() {
    ws();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (text.startsWith('true', i)) return (i += 4), true;
    if (text.startsWith('false', i)) return (i += 5), false;
    if (text.startsWith('null', i)) return (i += 4), null;
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) err('unexpected character');
    i += m[0].length;
    return Number(m[0]);
  }
  function string() {
    i++;
    let out = '';
    while (i < text.length) {
      const c = text[i++];
      if (c === '"') return out;
      if (c === '\\') {
        if (i >= text.length) break;
        const e = text[i++];
        if (e === 'u') {
          const hex = text.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) err('bad \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else if (hasOwn(escapes, e)) {
          out += escapes[e];
        } else {
          err(`bad escape \\${e}`);
        }
      } else if (c < ' ') {
        i--;
        err('control character inside a string');
      } else {
        out += c;
      }
    }
    err('unterminated string');
  }
  function array() {
    enter();
    i++;
    const out = [];
    ws();
    if (text[i] === ']') return i++, depth--, out;
    for (;;) {
      out.push(value());
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') return i++, depth--, out;
      err('expected , or ] in array');
    }
  }
  function object() {
    enter();
    i++;
    const out = Object.create(null);
    ws();
    if (text[i] === '}') return i++, depth--, out;
    for (;;) {
      ws();
      if (text[i] !== '"') err('expected a string key');
      const key = string();
      if (hasOwn(out, key)) err(`duplicate key "${key}"`);
      ws();
      if (text[i] !== ':') err('expected : after key');
      i++;
      out[key] = value();
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') return i++, depth--, out;
      err('expected , or } in object');
    }
  }

  const result = value();
  ws();
  if (i !== text.length) err('characters after the end of the document');
  return result;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function checkUnknownKeys(obj, known, at, what, fail) {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) {
      fail(`${at}.${key} is not ${what} in the Claude Code reference; ${IGNORED_KEY}. If the docs added it, add it to the list in scripts/check-claude-settings.js`);
    }
  }
}

function checkTopLevel(settings, fail) {
  if (!hasOwn(settings, 'permissions')) fail('"permissions" is missing; this file exists to hold the permission policy');
  for (const key of Object.keys(settings)) {
    if (TOP_LEVEL_KEYS.includes(key) || key === 'env') continue;
    const near = TOP_LEVEL_KEYS_HERE.find((k) => editDistance(key.toLowerCase(), k) <= 2);
    if (near) {
      fail(`"${key}" looks like a misspelling of "${near}"; Claude Code does not read it, so nothing in it applies`);
    } else {
      fail(`"${key}" is not accepted in this file, which holds only ${TOP_LEVEL_KEYS.map((k) => `"${k}"`).join(', ')}: other settings can bring in code no reviewed script holds (enabledPlugins and extraKnownMarketplaces load a plugin with its own hooks; apiKeyHelper, statusLine, awsAuthRefresh, awsCredentialExport and otelHeadersHelper run commands). Put personal settings in your untracked .claude/settings.local.json, or add a key that runs nothing to TOP_LEVEL_KEYS in scripts/check-claude-settings.js`);
    }
  }
  if (hasOwn(settings, '$schema') && typeof settings.$schema !== 'string') {
    fail('"$schema" must be a string: Claude Code skips a settings file that fails its schema, so none of this policy would apply');
  }
  // Claude Code passes "env" to every hook process: NODE_OPTIONS, BASH_ENV
  // or PYTHONPATH would make an allowed interpreter load code from outside
  // .claude/hooks/ before the reviewed script, and PATH could swap the
  // interpreter itself.
  if (hasOwn(settings, 'env')) {
    fail('"env" is not accepted in this file: Claude Code passes it to every hook process, where NODE_OPTIONS, BASH_ENV or PYTHONPATH would load code from outside .claude/hooks/ before the reviewed script and PATH could swap the interpreter itself. Set personal variables in .claude/settings.local.json or your shell');
  }
}

function checkPermissions(permissions, fail) {
  if (permissions === undefined) return;
  if (!isPlainObject(permissions)) return fail('"permissions" must be an object');
  checkUnknownKeys(permissions, PERMISSION_KEYS, 'permissions', 'a permissions key', fail);
  if (hasOwn(permissions, 'defaultMode')) {
    if (!PERMISSION_MODES.includes(permissions.defaultMode)) {
      fail(`permissions.defaultMode must be one of ${PERMISSION_MODES.map((m) => `"${m}"`).join(', ')}`);
    } else if (PROJECT_INEFFECTIVE_MODES.includes(permissions.defaultMode)) {
      fail(`permissions.defaultMode "${permissions.defaultMode}" does not take effect from a project .claude/settings.json; set it in ~/.claude/settings.json instead`);
    }
  }
  if (hasOwn(permissions, 'blockReadsOutsideWorkingDirectories') && typeof permissions.blockReadsOutsideWorkingDirectories !== 'boolean') {
    fail('permissions.blockReadsOutsideWorkingDirectories must be true or false');
  }
  for (const k of ['disableBypassPermissionsMode', 'disableAutoMode']) {
    if (hasOwn(permissions, k) && permissions[k] !== 'disable') fail(`permissions.${k} must be the string "disable"`);
  }
  if (hasOwn(permissions, 'additionalDirectories')) {
    const dirs = permissions.additionalDirectories;
    if (!Array.isArray(dirs) || !dirs.every(isNonEmptyString)) fail('permissions.additionalDirectories must be an array of strings');
  }
  const where = new Map();
  for (const list of ['allow', 'ask', 'deny']) {
    if (!hasOwn(permissions, list)) continue;
    const rules = permissions[list];
    if (!Array.isArray(rules)) {
      fail(`permissions.${list} must be an array`);
      continue;
    }
    const seen = new Set();
    rules.forEach((rule, n) => {
      if (!isNonEmptyString(rule)) {
        return fail(`permissions.${list}[${n}] must be a non-empty string`);
      }
      if (rule !== rule.trim()) fail(`permissions.${list}[${n}] has leading or trailing whitespace: ${JSON.stringify(rule)}`);
      if (/^mcp__[^(]*\(/.test(rule)) fail(`permissions.${list}[${n}] is an mcp__ rule with parentheses; Claude Code skips such rules when loading a settings file: ${JSON.stringify(rule)}`);
      if (seen.has(rule)) fail(`permissions.${list} lists ${JSON.stringify(rule)} twice`);
      seen.add(rule);
      if (where.has(rule) && where.get(rule) !== list) {
        fail(`${JSON.stringify(rule)} appears in both permissions.${where.get(rule)} and permissions.${list}`);
      }
      if (!where.has(rule)) where.set(rule, list);
    });
  }
}

// Matcher evaluation per the hooks reference: "*", "" or omitted match all;
// only letters, digits, _, -, space, comma and | is an exact string or list
// (FileChanged and StopFailure: letters, digits, _ and | only, so their
// other matchers are regular expressions, which strings of those characters
// always are); anything else is a JavaScript regular expression, which must
// compile.
const PIPE_ONLY_MATCHER_EVENTS = ['FileChanged', 'StopFailure'];
function checkMatcher(matcher, event, at, fail) {
  if (NO_MATCHER_EVENTS.includes(event)) fail(`${at}.matcher has no effect: ${event} has no matcher support`);
  if (typeof matcher !== 'string') return fail(`${at}.matcher must be a string`);
  if (PIPE_ONLY_MATCHER_EVENTS.includes(event) && /[,\s]/.test(matcher)) {
    fail(`${at}.matcher: ${event} separates alternatives with | only; a comma or whitespace is matched literally, so ${JSON.stringify(matcher)} will not match the names it lists. Use ${JSON.stringify(matcher.split(/[,\s]+/).filter(Boolean).join('|'))}`);
  }
  if (matcher === '*' || /^[A-Za-z0-9_\- ,|]*$/.test(matcher)) return;
  try {
    new RegExp(matcher);
  } catch (e) {
    fail(`${at}.matcher is not a valid pattern: ${e.message}`);
  }
}

// Where `real`, a resolved script path, sits relative to `hooksDir`, the
// resolved project root joined with .claude/hooks: 'self', 'inside' or
// 'outside'. checkPathToken first compares the two as text, which can fail
// for a script that really is in the hooks directory. On macOS and Windows,
// whose default file systems ignore case (and on macOS, Unicode
// normalization), a symlink's target may spell part of the path, or the
// root, differently from the root the checker was given: fs.realpathSync
// (the JavaScript one) keeps the text it is given and copies symlink
// targets verbatim. So before rejecting, this asks the operating system for
// both paths' canonical spelling with fs.realpathSync.native (realpath(3)
// on macOS returns each component's on-disk name; GetFinalPathNameByHandleW
// does the same on Windows) and compares those as text. Linux's realpath
// keeps the spelling it is given, so there this gives the text comparison's
// answer. Neither .claude nor hooks may be a symlink, so a hooks directory
// that points somewhere else is still rejected, as the text comparison
// rejects it. Device and inode numbers are not used: some FUSE and overlay
// mounts give two different directories the same pair.
const fsIo = {
  lstat: (p) => fs.lstatSync(p),
  realpath: (p) => fs.realpathSync.native(p),
};
function locateInHooksDir(real, hooksDir, io = fsIo) {
  let canonReal;
  let canonHooks;
  try {
    // lstat does not follow a symlink, so a symlinked .claude or hooks is
    // not a directory here.
    for (const dir of [path.dirname(hooksDir), hooksDir]) {
      if (!io.lstat(dir).isDirectory()) return 'outside';
    }
    canonHooks = io.realpath(hooksDir);
    canonReal = io.realpath(real);
  } catch (e) {
    return 'outside';
  }
  if (canonReal === canonHooks) return 'self';
  return canonReal.startsWith(canonHooks + path.sep) ? 'inside' : 'outside';
}

// One exec-form token: the command, or an element of args. Returns true when
// the token referenced a path placeholder, whether or not it was valid. The
// project placeholder is the braced form the hooks reference defines; the
// bare $CLAUDE_PROJECT_DIR spelling is a shell variable, and exec form has no
// shell to expand it (Claude Code does not rewrite that form).
const PLACEHOLDER = /\$\{CLAUDE_PROJECT_DIR\}\/(.*)$/;
function checkPathToken(token, root, at, fail) {
  if (/\$\{?CLAUDE_PLUGIN_(ROOT|DATA)/.test(token)) {
    fail(`${at}: plugin placeholders do not apply to a settings.json hook: ${JSON.stringify(token)}`);
    return true;
  }
  if (!/\$\{?CLAUDE_PROJECT_DIR/.test(token)) return false;
  const m = PLACEHOLDER.exec(token);
  if (!m) {
    fail(`${at} must reference the script as \${CLAUDE_PROJECT_DIR}/<path> (braces; the bare spelling is not substituted in exec form): ${JSON.stringify(token)}`);
    return true;
  }
  const rel = m[1];
  if (rel.includes('\\')) {
    fail(`${at}: ${rel} must use forward slashes, which Claude Code resolves on every platform`);
    return true;
  }
  if (rel === '') {
    fail(`${at} names the project directory, not a script: ${JSON.stringify(token)}`);
    return true;
  }
  if (rel === HOOKS_DIR.slice(0, -1)) {
    fail(`${at} names the hooks directory, not a script: ${JSON.stringify(token)}`);
    return true;
  }
  if (!rel.startsWith(HOOKS_DIR)) {
    fail(`${at}: ${rel} is not under ${HOOKS_DIR}`);
    return true;
  }
  let real;
  let hooksRoot;
  try {
    hooksRoot = path.join(fs.realpathSync(root), HOOKS_DIR);
    real = fs.realpathSync(path.resolve(root, rel));
  } catch (e) {
    fail(`${at}: ${rel} does not exist`);
    return true;
  }
  let where = real === hooksRoot.slice(0, -1) ? 'self' : real.startsWith(hooksRoot) ? 'inside' : 'outside';
  if (where === 'outside') where = locateInHooksDir(real, hooksRoot.slice(0, -1));
  if (where === 'self') {
    fail(`${at} names the hooks directory, not a script: ${JSON.stringify(token)}`);
    return true;
  }
  if (where === 'outside') {
    fail(`${at}: ${rel} resolves outside ${HOOKS_DIR}`);
    return true;
  }
  if (!fs.statSync(real).isFile()) {
    fail(`${at}: ${rel} is not a file`);
    return true;
  }
  // A .gitattributes file at any level can hide a text script as well:
  // "-diff" or "binary" makes git show "Binary files differ", and
  // working-tree-encoding re-encodes the script on checkout, so the bytes
  // that run, and that the NUL check below reads, are not the ones a pull
  // request shows. They are read for the file the script resolves to: git
  // applies none of them to a symlink, which a diff shows as its target
  // path. The global and system attributes files are turned off, so in
  // CI's fresh checkout only the committed .gitattributes files count. A
  // local run also reads uncommitted .gitattributes files and
  // .git/info/attributes, which overrides them and which git has no switch
  // to skip, so it can disagree with CI. Outside a git repository check-attr
  // fails and this check is skipped; main() fails there anyway.
  const attrs = spawnSync('git', ['-c', `core.attributesFile=${os.devNull}`, '-C', path.dirname(real), 'check-attr', '-z', '-a', '--', path.basename(real)], { encoding: 'utf8', env: { ...process.env, GIT_ATTR_NOSYSTEM: '1' } });
  const attr = attrs.status === 0 ? attrs.stdout.split('\0') : [];
  for (let n = 0; n + 2 < attr.length; n += 3) {
    const [name, value] = [attr[n + 1], attr[n + 2]];
    if (name === 'diff' && value === 'unset') {
      fail(`${at}: ${rel} is marked -diff or binary by a .gitattributes file, so git and a pull request show "Binary files differ" instead of its content; a hook script must be text that review can read. Remove that attribute for it`);
      return true;
    }
    if (name === 'working-tree-encoding' && value !== 'unset') {
      fail(`${at}: ${rel} has working-tree-encoding ${value} from a .gitattributes file, so git re-encodes it on checkout and the bytes that run are not the ones a pull request shows. Remove that attribute and commit the script as UTF-8`);
      return true;
    }
  }
  // A file with a NUL byte is binary to git, so a pull request shows
  // "Binary files differ" instead of its content. That covers executables,
  // zip archives (python3 runs one named .py) and bytecode, and also UTF-16
  // text, such as a .ps1 written by Windows PowerShell 5.1.
  if (fs.readFileSync(real).includes(0)) {
    fail(`${at}: ${rel} contains a NUL byte, so git treats it as binary and a pull request does not show its content; a hook script must be text that review can read (UTF-16 text: save it as UTF-8)`);
    return true;
  }
  if (/\.[cm]?js$/.test(rel)) {
    const r = spawnSync(process.execPath, ['--check', real], { encoding: 'utf8' });
    if (r.status !== 0) fail(`${at}: ${rel} does not parse: ${r.stderr.trim()}`);
  }
  return true;
}

// Command hooks here use exec form, which the hooks reference asks for
// whenever a path placeholder is involved: "command" is the executable and
// each element of "args" is one argument, with no shell on any platform.
// The command is one of a fixed set of interpreters and the script is its
// first argument; arguments after the script are passed to it. Any other
// program is rejected, because with the script as an argument it may do
// something else entirely ("find <script> -exec ...", "rm <script>",
// "true <script>"). A script as the command is not accepted either: on
// Windows exec form needs a real executable such as a .exe, and an
// interpreter plus the script path is the pattern the reference says works
// on every platform. Interpreter flags before the script, including
// PowerShell's -File, and inline code ("bash -c ...", "node -e ...") are
// rejected: what a hook runs must be a file this repository reviews.
const INTERPRETERS = ['node', 'python3', 'bash', 'sh', 'pwsh'];
function checkCommandHook(hook, root, at, fail) {
  if (!isNonEmptyString(hook.command)) return fail(`${at}.command must be a non-empty string`);
  if (!Array.isArray(hook.args)) {
    return fail(`${at} must use exec form: the executable in "command" and the script path as one element of "args" (shell form is not used in this repository; see "Exec form and shell form" in the hooks reference)`);
  }
  const args = hook.args.map((arg, n) => {
    if (typeof arg === 'string') return arg;
    fail(`${at}.args[${n}] must be a string`);
    return '';
  });
  if (/CLAUDE_PROJECT_DIR/.test(hook.command)) {
    fail(`${at}.command must be an interpreter (${INTERPRETERS.join(', ')}), with the script as args[0]; a script as the command cannot be spawned on Windows, where exec form needs a real executable: ${JSON.stringify(hook.command)}`);
  } else if (!INTERPRETERS.includes(hook.command)) {
    fail(`${at}.command must be one of the allowed interpreters (${INTERPRETERS.join(', ')}): ${JSON.stringify(hook.command)}`);
  }
  if (args.length === 0 || !args[0].startsWith('${CLAUDE_PROJECT_DIR}/')) {
    fail(`${at}.args[0] must be the \${CLAUDE_PROJECT_DIR}/.claude/hooks/ script; interpreter flags and inline code are not accepted, put them in the script`);
  }
  args.forEach((arg, n) => checkPathToken(arg, root, `${at}.args[${n}]`, fail));
  for (const k of ['async', 'asyncRewake']) {
    if (hasOwn(hook, k) && typeof hook[k] !== 'boolean') fail(`${at}.${k} must be true or false`);
  }
  if (hasOwn(hook, 'shell')) fail(`${at}.shell has no effect in exec form`);
}

function checkHook(hook, event, root, at, fail, { mcpToolHooks, allowAgentHooks, httpHookUrls }) {
  if (!isPlainObject(hook)) return fail(`${at} must be an object`);
  if (!HOOK_TYPES.includes(hook.type)) return fail(`${at}.type must be one of ${HOOK_TYPES.map((t) => `"${t}"`).join(', ')}`);
  checkUnknownKeys(hook, [...HOOK_COMMON_FIELDS, ...HOOK_TYPE_FIELDS[hook.type]], at, `a ${hook.type} hook field`, fail);
  if (hasOwn(hook, 'if')) {
    if (!isNonEmptyString(hook.if)) fail(`${at}.if must be a permission rule string`);
    if (!TOOL_EVENTS.includes(event)) fail(`${at}.if is only evaluated on ${TOOL_EVENTS.join(', ')}; on ${event} a hook with "if" set never runs`);
  }
  if (hasOwn(hook, 'timeout') && !(typeof hook.timeout === 'number' && Number.isFinite(hook.timeout) && hook.timeout > 0)) {
    fail(`${at}.timeout must be a positive number of seconds`);
  }
  if (hasOwn(hook, 'statusMessage') && typeof hook.statusMessage !== 'string') fail(`${at}.statusMessage must be a string`);
  if (hasOwn(hook, 'once')) fail(`${at}.once is honoured only in skill frontmatter and ignored in a settings file`);
  if (!EVENT_HOOK_TYPES[event].includes(hook.type)) {
    const why = event === 'Setup' && hook.type === 'mcp_tool' ? ' (Setup fires before MCP servers are available)' : '';
    fail(`${at}: ${event} does not run ${hook.type} hooks${why}; Claude Code skips it. ${event} supports ${EVENT_HOOK_TYPES[event].join(', ')}`);
  }
  if (hook.type === 'command') return checkCommandHook(hook, root, at, fail);
  if (hook.type === 'prompt' && hasOwn(hook, 'continueOnBlock') && typeof hook.continueOnBlock !== 'boolean') {
    fail(`${at}.continueOnBlock must be true or false`);
  }
  for (const k of HOOK_REQUIRED_STRINGS[hook.type]) {
    if (!isNonEmptyString(hook[k])) fail(`${at}.${k} must be a non-empty string for a ${hook.type} hook`);
  }
  // A hook agent runs in dontAsk mode with every allow rule from every
  // settings scope, so its inline prompt can call any allowed tool, MCP tools
  // included, which would get around MCP_TOOL_HOOKS. Prompt hooks get no tools.
  if (hook.type === 'agent' && !allowAgentHooks) {
    fail(`${at}: agent hooks are not accepted in this file: the hook agent runs in dontAsk mode with every allow rule from every settings scope, so its inline prompt can call any allowed tool, MCP tools included, and get around MCP_TOOL_HOOKS. Use a command hook with a reviewed script, or a prompt hook, which has no tools`);
  }
  if (hook.type === 'http' && isNonEmptyString(hook.url) && !httpHookUrls.includes(hook.url)) {
    fail(`${at}: http hook URL ${JSON.stringify(hook.url)} is not in HTTP_HOOK_URLS in scripts/check-claude-settings.js. Claude Code posts every hook input, tool inputs and prompts included, to it, and its reply can approve a tool call, change the call's input or add to Claude's context, so add the URL there only after confirming who runs that endpoint and what it does with what it receives`);
  }
  if (hook.type === 'mcp_tool' && isNonEmptyString(hook.server) && isNonEmptyString(hook.tool)
    && !mcpToolHooks.some((p) => p.server === hook.server && p.tool === hook.tool)) {
    fail(`${at}: mcp_tool hook ${JSON.stringify(`${hook.server}/${hook.tool}`)} is not in MCP_TOOL_HOOKS in scripts/check-claude-settings.js. Its input is written in this file and the tool runs outside any reviewed script, so add the pair there only after confirming the tool cannot run commands, write files or send data, whatever its input`);
  }
}

function checkHooks(hooks, root, fail, options) {
  if (hooks === undefined) return;
  if (!isPlainObject(hooks)) return fail('"hooks" must be an object');
  for (const event of Object.keys(hooks)) {
    if (!HOOK_EVENTS.includes(event)) {
      fail(`hooks.${event} is not a hook event in the Claude Code reference; ${SKIPPED_EVENT}, so the hook never runs. If the docs added it, add it to HOOK_EVENTS in scripts/check-claude-settings.js`);
      continue;
    }
    const matchers = hooks[event];
    if (!Array.isArray(matchers)) {
      fail(`hooks.${event} must be an array`);
      continue;
    }
    matchers.forEach((entry, n) => {
      const at = `hooks.${event}[${n}]`;
      if (!isPlainObject(entry)) return fail(`${at} must be an object`);
      checkUnknownKeys(entry, ['matcher', 'hooks'], at, 'a hook group field', fail);
      if (hasOwn(entry, 'matcher')) checkMatcher(entry.matcher, event, at, fail);
      if (!Array.isArray(entry.hooks)) return fail(`${at}.hooks must be an array`);
      if (entry.hooks.length === 0) fail(`${at}.hooks is empty`);
      entry.hooks.forEach((hook, m) => checkHook(hook, event, root, `${at}.hooks[${m}]`, fail, options));
    });
  }
}

// JSON values compared regardless of key order.
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// Every MCP_TOOL_HOOKS pair must name a server defined in the committed
// .mcp.json exactly as the pair pins it (see MCP_TOOL_HOOKS).
function checkMcpToolPins(root, mcpToolHooks, fail) {
  if (mcpToolHooks.length === 0) return;
  let servers;
  try {
    const mcp = parseStrict(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'));
    servers = isPlainObject(mcp) && isPlainObject(mcp.mcpServers) ? mcp.mcpServers : null;
    if (!servers) fail('.mcp.json has no "mcpServers" object, so no MCP_TOOL_HOOKS pair can be pinned to it');
  } catch (e) {
    fail(`.mcp.json cannot be read, so no MCP_TOOL_HOOKS pair can be pinned to it: ${e.message}`);
  }
  if (!servers) return;
  for (const p of mcpToolHooks) {
    const pair = JSON.stringify(`${p.server}/${p.tool}`);
    if (!hasOwn(servers, p.server)) {
      fail(`MCP_TOOL_HOOKS pair ${pair} names a server that the committed .mcp.json does not define; a pair must name a server defined there`);
    } else if (canonicalJson(servers[p.server]) !== canonicalJson(p.definition)) {
      fail(`.mcp.json's definition of ${JSON.stringify(p.server)} differs from the one pinned with ${pair} in MCP_TOOL_HOOKS; review what the new definition can do, then update the pin`);
    } else if (canonicalJson(p.definition).includes('${')) {
      fail(`the definition pinned with ${pair} in MCP_TOOL_HOOKS uses \${...} expansion, which resolves differently on each machine; pin a definition with literal values`);
    }
  }
}

// Claude Code reads .claude/settings.json from the directory a session
// starts in, and .claude/settings.local.json from the repository root, which
// it treats as repository-supplied when tracked. This check reads only the
// root settings.json, so that is the only settings file that may be tracked.
// Paths are compared ignoring case, as on macOS and Windows, where a tracked
// .Claude/Settings.json is the file Claude Code opens as
// .claude/settings.json. A tracked path named .claude itself is a symlink or
// submodule, through which Claude Code would read settings this check never
// sees. `tracked` lists the tracked paths, relative to the repository root
// with forward slashes.
function checkTrackedFiles(tracked) {
  const problems = [];
  for (const file of tracked) {
    const lower = file.toLowerCase();
    if (/(^|\/)\.claude$/.test(lower)) {
      problems.push(`${file} is tracked as a symlink or submodule: Claude Code reads .claude/settings.json and settings.local.json through it, and this check does not. Make it a real directory, or remove it`);
    } else if (/(^|\/)\.claude\/settings\.local\.json$/.test(lower)) {
      problems.push(`${file} is tracked: Claude Code treats a tracked settings.local.json as repository-supplied, and this check does not read it. Keep it untracked: git rm --cached removes it from the index and leaves your copy`);
    } else if (lower === '.claude/settings.json' && file !== '.claude/settings.json') {
      problems.push(`${file} is tracked: it differs from .claude/settings.json only in case, so on macOS and Windows Claude Code can open it in place of the file this check reads. Keep the policy in .claude/settings.json only`);
    } else if (/\/\.claude\/settings\.json$/.test(lower)) {
      problems.push(`${file} is tracked: Claude Code loads it for a session started in ${file.slice(0, -'/.claude/settings.json'.length)}, and this check reads only the root .claude/settings.json. Keep the policy in the root file`);
    }
  }
  return problems;
}

// The tracked files of the repository at `root`, from git.
function trackedFiles(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${(r.stderr || '').trim() || r.error}`);
  return r.stdout.split('\0').filter(Boolean);
}

// Returns the list of problems with a parsed settings object. `root` is the
// repository root that ${CLAUDE_PROJECT_DIR} stands for. The tests pass
// `mcpToolHooks` and `httpHookUrls` in place of MCP_TOOL_HOOKS and
// HTTP_HOOK_URLS, and `allowAgentHooks`, to reach the other rules for those
// hook types.
function checkSettings(settings, root, { mcpToolHooks = MCP_TOOL_HOOKS, allowAgentHooks = false, httpHookUrls = HTTP_HOOK_URLS } = {}) {
  const problems = [];
  const fail = (msg) => problems.push(msg);
  if (!isPlainObject(settings)) {
    fail('top level must be an object');
    return problems;
  }
  checkTopLevel(settings, fail);
  checkPermissions(settings.permissions, fail);
  checkHooks(settings.hooks, root, fail, { mcpToolHooks, allowAgentHooks, httpHookUrls });
  checkMcpToolPins(root, mcpToolHooks, fail);
  return problems;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const settingsPath = path.join(root, '.claude', 'settings.json');
  const problems = [];
  let text;
  try {
    text = fs.readFileSync(settingsPath, 'utf8');
  } catch (e) {
    console.error(`cannot read ${settingsPath}: ${e.message}`);
    process.exit(1);
  }
  // CRLF is not checked: a Windows checkout with core.autocrlf rewrites the
  // working copy, and both JSON parsers treat CR as whitespace.
  if (text.charCodeAt(0) === 0xfeff) problems.push('file starts with a byte-order mark');
  if (!text.endsWith('\n')) problems.push('file does not end with a newline');

  let settings;
  try {
    settings = parseStrict(text);
  } catch (e) {
    // A BOM makes the parse fail too; report it first so the developer sees
    // the cause rather than "unexpected character".
    for (const p of problems) console.error(`.claude/settings.json: ${p}`);
    console.error(`.claude/settings.json: ${e.message}`);
    process.exit(1);
  }
  problems.push(...checkSettings(settings, root));
  let repoProblems = [];
  try {
    repoProblems = checkTrackedFiles(trackedFiles(root));
  } catch (e) {
    repoProblems = [`cannot list the repository's tracked files, which this check needs: ${e.message}`];
  }

  if (problems.length || repoProblems.length) {
    for (const p of repoProblems) console.error(p);
    for (const p of problems) console.error(`.claude/settings.json: ${p}`);
    process.exit(1);
  }
  const p = settings.permissions || {};
  const count = (k) => (Array.isArray(p[k]) ? p[k].length : 0);
  const hookCount = settings.hooks
    ? Object.values(settings.hooks).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
    : 0;
  console.log(`ok: .claude/settings.json has no duplicate keys; allow ${count('allow')}, ask ${count('ask')}, deny ${count('deny')}, hook matchers ${hookCount}`);
}

if (require.main === module) {
  main();
} else {
  module.exports = { parseStrict, checkSettings, locateInHooksDir, MAX_DEPTH, HOOKS_DIR, HOOK_EVENTS, PERMISSION_KEYS, EVENT_HOOK_TYPES, INTERPRETERS, MCP_TOOL_HOOKS, HTTP_HOOK_URLS, checkTrackedFiles, trackedFiles };
}
