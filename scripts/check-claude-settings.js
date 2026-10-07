#!/usr/bin/env node
// Checks .claude/settings.json, the committed Claude Code permission policy.
//
// Why this exists: PRs #20 and #21 each added their own "allow" key to the
// file. JSON allows that, JSON.parse keeps the last one silently, and so
// #21's rules were never in effect (PR #23). This script fails on a duplicate
// key at any depth, then checks the parts of the file this repository relies
// on: the permission lists, and that every hook command points at a script
// that exists and parses.
//
// Run: node scripts/check-claude-settings.js
// CI:  .github/workflows/claude-settings.yml

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const settingsPath = path.join(root, '.claude', 'settings.json');
const problems = [];
const fail = (msg) => problems.push(msg);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// A small JSON parser that rejects duplicate keys. Objects are returned as
// prototype-less so a key such as "__proto__" cannot shadow anything.
function parseStrict(text) {
  let i = 0;
  const err = (msg) => {
    const line = text.slice(0, i).split('\n').length;
    throw new Error(`${msg} (line ${line})`);
  };
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
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
        err('control character inside a string');
      } else {
        out += c;
      }
    }
    err('unterminated string');
  }
  function array() {
    i++;
    const out = [];
    ws();
    if (text[i] === ']') return i++, out;
    for (;;) {
      out.push(value());
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') return i++, out;
      err('expected , or ] in array');
    }
  }
  function object() {
    i++;
    const out = Object.create(null);
    ws();
    if (text[i] === '}') return i++, out;
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
      if (text[i] === '}') return i++, out;
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

function checkPermissions(permissions) {
  if (permissions === undefined) return;
  if (!isPlainObject(permissions)) return fail('"permissions" must be an object');
  const lists = ['allow', 'ask', 'deny'];
  const where = new Map();
  for (const list of lists) {
    if (!hasOwn(permissions, list)) continue;
    const rules = permissions[list];
    if (!Array.isArray(rules)) {
      fail(`permissions.${list} must be an array`);
      continue;
    }
    const seen = new Set();
    rules.forEach((rule, n) => {
      if (typeof rule !== 'string' || rule.trim() === '') {
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

// Every "$CLAUDE_PROJECT_DIR/<path>" (or "${CLAUDE_PROJECT_DIR}/<path>") in a
// hook command must name a file in this repository, and a .js file must parse.
function checkHooks(hooks) {
  if (hooks === undefined) return;
  if (!isPlainObject(hooks)) return fail('"hooks" must be an object');
  const pathRe = /\$\{?CLAUDE_PROJECT_DIR\}?\/([^\s"']+)/g;
  for (const event of Object.keys(hooks)) {
    const matchers = hooks[event];
    if (!Array.isArray(matchers)) {
      fail(`hooks.${event} must be an array`);
      continue;
    }
    matchers.forEach((entry, n) => {
      const at = `hooks.${event}[${n}]`;
      if (!isPlainObject(entry)) return fail(`${at} must be an object`);
      if (hasOwn(entry, 'matcher')) {
        if (typeof entry.matcher !== 'string') return fail(`${at}.matcher must be a string`);
        try {
          new RegExp(entry.matcher);
        } catch (e) {
          fail(`${at}.matcher is not a valid pattern: ${e.message}`);
        }
      }
      if (!Array.isArray(entry.hooks)) return fail(`${at}.hooks must be an array`);
      entry.hooks.forEach((hook, m) => {
        const hat = `${at}.hooks[${m}]`;
        if (!isPlainObject(hook)) return fail(`${hat} must be an object`);
        if (hook.type !== 'command') return fail(`${hat}.type must be "command"`);
        if (typeof hook.command !== 'string' || hook.command.trim() === '') return fail(`${hat}.command must be a non-empty string`);
        if (hasOwn(hook, 'timeout') && !(Number.isInteger(hook.timeout) && hook.timeout > 0)) fail(`${hat}.timeout must be a positive integer`);
        let found = false;
        for (const match of hook.command.matchAll(pathRe)) {
          found = true;
          const rel = match[1];
          const abs = path.join(root, rel);
          if (!abs.startsWith(root + path.sep)) return fail(`${hat}: ${rel} escapes the repository`);
          if (!fs.existsSync(abs)) return fail(`${hat}: ${rel} does not exist`);
          if (rel.endsWith('.js')) {
            const r = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
            if (r.status !== 0) fail(`${hat}: ${rel} does not parse: ${r.stderr.trim()}`);
          }
        }
        if (!found) fail(`${hat}.command does not reference a script via $CLAUDE_PROJECT_DIR; hooks here must live in the repository`);
      });
    });
  }
}

function main() {
  let text;
  try {
    text = fs.readFileSync(settingsPath, 'utf8');
  } catch (e) {
    console.error(`cannot read ${settingsPath}: ${e.message}`);
    process.exit(1);
  }
  if (text.charCodeAt(0) === 0xfeff) fail('file starts with a byte-order mark');
  if (text.includes('\r')) fail('file has CR line endings');
  if (!text.endsWith('\n')) fail('file does not end with a newline');

  let settings;
  try {
    settings = parseStrict(text);
  } catch (e) {
    console.error(`.claude/settings.json: ${e.message}`);
    process.exit(1);
  }
  if (!isPlainObject(settings)) {
    console.error('.claude/settings.json: top level must be an object');
    process.exit(1);
  }
  checkPermissions(settings.permissions);
  checkHooks(settings.hooks);

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
  module.exports = { parseStrict };
}
