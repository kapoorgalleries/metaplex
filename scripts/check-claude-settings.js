#!/usr/bin/env node
// Checks .claude/settings.json, the committed Claude Code permission policy.
//
// Why this exists: PRs #20 and #21 each added their own "allow" key to the
// file. JSON allows that, JSON.parse keeps the last one silently, and so
// #21's rules were never in effect (PR #23). This script fails on a duplicate
// key at any depth, then checks the parts of the file this repository relies
// on against the Claude Code reference: permission keys and lists, hook event
// names, hook fields, and that every command hook is in exec form with its
// scripts under .claude/hooks/, present and parsing.
//
// Run: node scripts/check-claude-settings.js
// CI:  .github/workflows/claude-settings.yml

'use strict';

const fs = require('fs');
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
// code.claude.com/docs/en/hooks. A key outside these lists is most likely a
// typo that Claude Code would ignore silently, which is the class of failure
// this script exists to catch. When the docs add a name, add it here.
const PERMISSION_KEYS = [
  'allow', 'ask', 'deny', 'additionalDirectories', 'defaultMode',
  'blockReadsOutsideWorkingDirectories', 'disableBypassPermissionsMode',
];
const HOOK_EVENTS = [
  'SessionStart', 'Setup', 'InstructionsLoaded', 'UserPromptSubmit', 'UserPromptExpansion',
  'MessageDisplay', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure',
  'PostToolBatch', 'PermissionDenied', 'Notification', 'SubagentStart', 'SubagentStop',
  'TaskCreated', 'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle', 'ConfigChange',
  'CwdChanged', 'DirectoryAdded', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove',
  'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'SessionEnd',
  'Elicitation', 'ElicitationResult',
];
const HOOK_TYPES = ['command', 'http', 'mcp_tool', 'prompt', 'agent'];
const HOOK_COMMON_FIELDS = ['type', 'if', 'timeout', 'statusMessage', 'once'];
const HOOK_COMMAND_FIELDS = ['command', 'args', 'async', 'asyncRewake', 'shell'];
const HOOK_REQUIRED_STRINGS = { http: ['url'], mcp_tool: ['server', 'tool'], prompt: ['prompt'], agent: ['prompt'] };

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
      ws();
      if (text[i] !== ':') err('expected : after key');
      i++;
      if (hasOwn(out, key)) err(`duplicate key "${key}"`);
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

function checkUnknownKeys(obj, known, at, what, fail) {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) {
      fail(`${at}.${key} is not ${what} in the Claude Code reference; a typo here is ignored silently (if the docs added it, add it to the list in scripts/check-claude-settings.js)`);
    }
  }
}

function checkPermissions(permissions, fail) {
  if (permissions === undefined) return;
  if (!isPlainObject(permissions)) return fail('"permissions" must be an object');
  checkUnknownKeys(permissions, PERMISSION_KEYS, 'permissions', 'a permissions key', fail);
  if (hasOwn(permissions, 'defaultMode') && !isNonEmptyString(permissions.defaultMode)) fail('permissions.defaultMode must be a string');
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
// only letters, digits, _, -, space, comma and | is an exact string or list;
// anything else is a JavaScript regular expression, which must compile.
function checkMatcher(matcher, at, fail) {
  if (typeof matcher !== 'string') return fail(`${at}.matcher must be a string`);
  if (matcher === '*' || /^[A-Za-z0-9_\- ,|]*$/.test(matcher)) return;
  try {
    new RegExp(matcher);
  } catch (e) {
    fail(`${at}.matcher is not a valid pattern: ${e.message}`);
  }
}

// One exec-form token: the command, or an element of args. Returns true when
// the token referenced a repository path, whether or not it was valid. The
// placeholder is the braced form the hooks reference defines; the bare
// $CLAUDE_PROJECT_DIR spelling is a shell variable, and exec form has no
// shell to expand it (Claude Code does not rewrite that form).
const PLACEHOLDER = /\$\{CLAUDE_PROJECT_DIR\}\/(.*)$/;
function checkPathToken(token, root, at, fail) {
  if (!token.includes('CLAUDE_PROJECT_DIR')) return false;
  const m = PLACEHOLDER.exec(token);
  if (!m) {
    fail(`${at} must reference the script as \${CLAUDE_PROJECT_DIR}/<path> (braces; the bare spelling is not substituted in exec form): ${JSON.stringify(token)}`);
    return true;
  }
  const rel = m[1];
  if (!rel.startsWith(HOOKS_DIR)) {
    fail(`${at}: ${rel} is not under ${HOOKS_DIR}`);
    return true;
  }
  let real;
  let hooksRoot;
  try {
    real = fs.realpathSync(path.resolve(root, rel));
    hooksRoot = fs.realpathSync(path.join(root, HOOKS_DIR)) + path.sep;
  } catch (e) {
    fail(`${at}: ${rel} does not exist`);
    return true;
  }
  if (!real.startsWith(hooksRoot)) {
    fail(`${at}: ${rel} resolves outside ${HOOKS_DIR}`);
    return true;
  }
  if (!fs.statSync(real).isFile()) {
    fail(`${at}: ${rel} is not a file`);
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
function checkCommandHook(hook, root, at, fail) {
  checkUnknownKeys(hook, [...HOOK_COMMON_FIELDS, ...HOOK_COMMAND_FIELDS], at, 'a command hook field', fail);
  if (!isNonEmptyString(hook.command)) return fail(`${at}.command must be a non-empty string`);
  if (!Array.isArray(hook.args)) {
    return fail(`${at} must use exec form: the executable in "command" and the script path as one element of "args" (shell form is not used in this repository; see "Exec form and shell form" in the hooks reference)`);
  }
  if (/\s/.test(hook.command)) fail(`${at}.command must be one executable in exec form, not a command line: ${JSON.stringify(hook.command)}`);
  let found = checkPathToken(hook.command, root, `${at}.command`, fail);
  hook.args.forEach((arg, n) => {
    if (typeof arg !== 'string') return fail(`${at}.args[${n}] must be a string`);
    if (checkPathToken(arg, root, `${at}.args[${n}]`, fail)) found = true;
  });
  if (!found) fail(`${at} does not reference a script via \${CLAUDE_PROJECT_DIR}; hooks here must live in ${HOOKS_DIR}`);
  for (const k of ['async', 'asyncRewake']) {
    if (hasOwn(hook, k) && typeof hook[k] !== 'boolean') fail(`${at}.${k} must be true or false`);
  }
  if (hasOwn(hook, 'shell')) fail(`${at}.shell has no effect in exec form`);
}

function checkHook(hook, root, at, fail) {
  if (!isPlainObject(hook)) return fail(`${at} must be an object`);
  if (!HOOK_TYPES.includes(hook.type)) return fail(`${at}.type must be one of ${HOOK_TYPES.map((t) => `"${t}"`).join(', ')}`);
  if (hasOwn(hook, 'timeout') && !(typeof hook.timeout === 'number' && Number.isFinite(hook.timeout) && hook.timeout > 0)) {
    fail(`${at}.timeout must be a positive number of seconds`);
  }
  if (hasOwn(hook, 'if') && !isNonEmptyString(hook.if)) fail(`${at}.if must be a permission rule string`);
  if (hasOwn(hook, 'statusMessage') && typeof hook.statusMessage !== 'string') fail(`${at}.statusMessage must be a string`);
  if (hasOwn(hook, 'once') && typeof hook.once !== 'boolean') fail(`${at}.once must be true or false`);
  if (hook.type === 'command') return checkCommandHook(hook, root, at, fail);
  for (const k of HOOK_REQUIRED_STRINGS[hook.type]) {
    if (!isNonEmptyString(hook[k])) fail(`${at}.${k} must be a non-empty string for a ${hook.type} hook`);
  }
}

function checkHooks(hooks, root, fail) {
  if (hooks === undefined) return;
  if (!isPlainObject(hooks)) return fail('"hooks" must be an object');
  for (const event of Object.keys(hooks)) {
    if (!HOOK_EVENTS.includes(event)) {
      fail(`hooks.${event} is not a hook event in the Claude Code reference; a typo here means the hook never runs (if the docs added it, add it to HOOK_EVENTS in scripts/check-claude-settings.js)`);
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
      if (hasOwn(entry, 'matcher')) checkMatcher(entry.matcher, at, fail);
      if (!Array.isArray(entry.hooks)) return fail(`${at}.hooks must be an array`);
      if (entry.hooks.length === 0) fail(`${at}.hooks is empty`);
      entry.hooks.forEach((hook, m) => checkHook(hook, root, `${at}.hooks[${m}]`, fail));
    });
  }
}

// Returns the list of problems with a parsed settings object. `root` is the
// repository root that $CLAUDE_PROJECT_DIR stands for.
function checkSettings(settings, root) {
  const problems = [];
  const fail = (msg) => problems.push(msg);
  if (!isPlainObject(settings)) {
    fail('top level must be an object');
    return problems;
  }
  checkPermissions(settings.permissions, fail);
  checkHooks(settings.hooks, root, fail);
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

  if (problems.length) {
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
  module.exports = { parseStrict, checkSettings, MAX_DEPTH, HOOKS_DIR, HOOK_EVENTS, PERMISSION_KEYS };
}
