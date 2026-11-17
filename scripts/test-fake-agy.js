#!/usr/bin/env node
// Shared hermetic helpers for the reviewer test suites: a synthetic OAuth home, healthy
// mock `agy` preflight envelopes, and a mock `agy` script factory.
//
// Mirrors the helpers inside scripts/test-reviewer.js so the hardening tests can reuse them
// without executing that file's test run.

'use strict';

const fs = require('fs');
const path = require('path');

function createAuthHome(baseDir, name = 'auth-home') {
  const home = fs.mkdtempSync(path.join(baseDir, `${name}-`));
  const geminiDir = path.join(home, '.gemini');
  const cliDir = path.join(geminiDir, 'antigravity-cli');
  fs.mkdirSync(cliDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(geminiDir, 'jetski-standalone-oauth-token'),
    'synthetic-test-oauth-token-placeholder\n',
    { mode: 0o600 }
  );
  fs.writeFileSync(
    path.join(cliDir, 'settings.json'),
    JSON.stringify({ useG1Credits: false }) + '\n',
    { mode: 0o600 }
  );
  return home;
}

function buildHealthyPermissionsEnvelope() {
  const denyRules = [
    'read_file(*)',
    'write_file(*)',
    'read_url(*)',
    'execute_url(*)',
    'command(*)',
    'mcp(*)',
  ];
  return {
    conversation_id: '',
    status: 'SUCCESS',
    response: denyRules.map((r) => `global\tdeny\t${r}`).join('\n') + '\n',
    duration_seconds: 0,
    num_turns: 0,
    command: {
      name: 'permissions',
      data: {
        permissions: [
          { scope: 'project', allow: [], deny: [] },
          { scope: 'shared', allow: [], deny: [] },
          { scope: 'global', allow: [], deny: denyRules },
        ],
      },
    },
  };
}

function buildHealthyUsageEnvelope(weeklyFraction = 0.85, fiveHourFraction = 0.51) {
  return {
    conversation_id: '',
    status: 'SUCCESS',
    response: 'Gemini Models\tWeekly Limit Remaining\t85%\t2026-11-20T22:51:40Z\n',
    duration_seconds: 0,
    num_turns: 0,
    command: {
      name: 'usage',
      data: {
        groups: [
          {
            name: 'Gemini Models',
            buckets: [
              {
                id: 'gemini-weekly',
                window: 'weekly',
                remaining_fraction: weeklyFraction,
                reset_time: '2026-11-20T22:51:40Z',
              },
              {
                id: 'gemini-5h',
                window: '5h',
                remaining_fraction: fiveHourFraction,
                reset_time: '2026-11-16T20:39:40Z',
              },
            ],
          },
        ],
      },
    },
  };
}

function buildHealthyModelsEnvelope() {
  return {
    conversation_id: '',
    status: 'SUCCESS',
    command: {
      name: 'models',
      data: {
        models: [
          'claude-opus-5-5-high',
          'gemini-pro-orchestrator',
          'gemini-3.8-flash-medium',
          'gemini-3.8-flash-high',
          'gemini-4-argon-high',
          'gemini-4-carbon-high',
        ],
      },
    },
  };
}

const DEFAULT_PREFLIGHT_PREAMBLE = `
const _fs = require("fs");
const _os = require("os");
const _path = require("path");
const _argv = process.argv.slice(2);

if (
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.TRIMURTI_GEMINI_API_KEY ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.AGY_API_KEY ||
  process.env.AGY_USE_G1_CREDITS ||
  process.env.ANTIGRAVITY_API_KEY ||
  process.env.JETSKI_API_KEY ||
  process.env.BASH_ENV ||
  process.env.ENV ||
  process.env.PROMPT_COMMAND ||
  process.env.SLACK_WEBHOOK_URL ||
  process.env.EMAIL_API_KEY ||
  process.env.GITHUB_TOKEN ||
  process.env.HF_TOKEN
) {
  console.error("LEAKED SECRET, HOOK, OR PAID KEY INTO AGY ENV!");
  process.exit(9);
}

if (_path.resolve(process.cwd()) === _path.resolve(_os.tmpdir())) {
  console.error("FORBIDDEN CWD: agy spawned in os.tmpdir() instead of isolated workDir!");
  process.exit(9);
}

if (_argv.includes("/permissions")) {
  process.stdout.write(${JSON.stringify(JSON.stringify(buildHealthyPermissionsEnvelope()))} + "\\n");
  process.exit(0);
}

if (_argv.includes("/usage")) {
  process.stdout.write(${JSON.stringify(JSON.stringify(buildHealthyUsageEnvelope()))} + "\\n");
  process.exit(0);
}

if (_argv.includes("models")) {
  process.stdout.write("\\r\\x1b[K" + ${JSON.stringify(JSON.stringify(buildHealthyModelsEnvelope()))} + "\\n");
  process.exit(0);
}
`;

function makeFakeAgy(dir, bodyJs, options = {}) {
  const name = options.name || 'fake-agy.js';
  const scriptPath = path.join(dir, name);
  const fullBody = options.rawScript ? bodyJs : `${DEFAULT_PREFLIGHT_PREAMBLE}\n${bodyJs}`;
  fs.writeFileSync(scriptPath, `#!/usr/bin/env node\n${fullBody}\n`, { mode: 0o755 });
  if (process.platform === 'win32') {
    const cmdPath = path.join(dir, `${path.parse(name).name}.cmd`);
    fs.writeFileSync(
      cmdPath,
      `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
      'utf8'
    );
    return cmdPath;
  }
  return scriptPath;
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


module.exports = {
  createAuthHome,
  buildHealthyPermissionsEnvelope,
  buildHealthyUsageEnvelope,
  buildHealthyModelsEnvelope,
  makeFakeAgy,
  extractYamlRunBlock,
};
