#!/usr/bin/env node
// Tests for the strict parser in scripts/check-claude-settings.js.
//
// The parser's one job beyond JSON.parse is to reject a duplicate key at any
// depth. These cases pin that down, including the ways a duplicate can hide
// (an escaped spelling of the same key, a duplicate deep inside an array),
// and confirm that valid JSON of every shape still parses to the same value
// JSON.parse gives.
//
// Run: node scripts/test-check-claude-settings.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseStrict } = require('./check-claude-settings.js');

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
};
const rejects = (name, text, pattern) =>
  check(name, () => assert.throws(() => parseStrict(text), pattern));
// parseStrict returns prototype-less objects; rebuild them as plain objects
// (without going through JSON.stringify, which would turn -0 into 0) so
// deepStrictEqual can compare against JSON.parse.
function plain(v) {
  if (Array.isArray(v)) return v.map(plain);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = plain(v[k]);
    return out;
  }
  return v;
}
const sameAsJsonParse = (name, text) =>
  check(name, () => assert.deepStrictEqual(plain(parseStrict(text)), JSON.parse(text)));

// Duplicates that must be caught.
rejects('duplicate top-level key', '{"a":1,"a":2}', /duplicate key "a"/);
rejects('the #20/#21 shape: two "allow" keys in one object', '{"permissions":{"allow":["x"],"ask":[],"deny":[],"allow":["y"]}}', /duplicate key "allow"/);
rejects('duplicate key three levels down', '{"a":{"b":{"c":1,"c":2}}}', /duplicate key "c"/);
rejects('duplicate inside an object inside an array', '{"hooks":{"PreToolUse":[{"matcher":"x","matcher":"y"}]}}', /duplicate key "matcher"/);
rejects('same key spelled with a \\u escape', '{"allow":1,"\\u0061llow":2}', /duplicate key "allow"/);
rejects('duplicate empty-string key', '{"":1,"":2}', /duplicate key ""/);
rejects('duplicate "__proto__" key', '{"__proto__":1,"__proto__":2}', /duplicate key "__proto__"/);

// Malformed documents that JSON.parse also rejects.
rejects('trailing comma in object', '{"a":1,}', /expected a string key/);
rejects('trailing comma in array', '[1,]', /unexpected character/);
rejects('single quotes', "{'a':1}", /expected a string key/);
rejects('unquoted key', '{a:1}', /expected a string key/);
rejects('comment', '{"a":1} // x', /characters after the end/);
rejects('two documents', '{"a":1}{"b":2}', /characters after the end/);
rejects('raw newline inside a string', '{"a":"x\ny"}', /control character/);
rejects('bad escape', '{"a":"\\q"}', /bad escape/);
rejects('short \\u escape', '{"a":"\\u12"}', /bad \\u escape/);
rejects('leading zero', '{"a":01}', /expected , or }/);
rejects('NaN', '{"a":NaN}', /unexpected character/);
rejects('unterminated string', '{"a":"x', /unterminated string/);
rejects('unterminated object', '{"a":1', /expected , or }/);
rejects('empty document', '', /unexpected character/);

// Valid JSON must parse to what JSON.parse gives.
sameAsJsonParse('nested objects and arrays', '{"a":{"b":[1,2,{"c":null}],"d":true,"e":false},"f":[]}');
sameAsJsonParse('numbers', '[0,-0,1,-1,1.5,-1.5,1e3,1E-3,1.25e+2,123456789012345]');
sameAsJsonParse('strings with escapes', '["a\\"b","c\\\\d","e\\/f","\\b\\f\\n\\r\\t","\\u00e9","\\ud83c\\udfa8"]');
sameAsJsonParse('whitespace everywhere', ' \n\t{ "a" : [ 1 , 2 ] , "b" : { } }\r\n ');
sameAsJsonParse('empty object and array', '{"a":{},"b":[]}');
sameAsJsonParse('same key in sibling objects is not a duplicate', '{"a":{"k":1},"b":{"k":2},"c":[{"k":3},{"k":4}]}');
sameAsJsonParse('top-level string', '"just a string"');
sameAsJsonParse('top-level number', '42');
sameAsJsonParse('unicode outside the BMP in a key', '{"\\ud83d\\ude00":1}');

// Parsed objects carry no prototype, so a "__proto__" key is an own key.
check('objects have no prototype', () => {
  const v = parseStrict('{"__proto__":{"polluted":true},"constructor":1}');
  assert.strictEqual(Object.getPrototypeOf(v), null);
  assert.strictEqual(({}).polluted, undefined);
  assert.deepStrictEqual(Object.keys(v).sort(), ['__proto__', 'constructor']);
});

// The committed settings file itself.
check('.claude/settings.json parses with no duplicate keys', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '..', '.claude', 'settings.json'), 'utf8');
  const v = parseStrict(text);
  assert.ok(Array.isArray(v.permissions.allow));
});

if (failures) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('all parser tests passed');
