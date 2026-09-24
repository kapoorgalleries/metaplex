// End-to-end smoke test over stdio: spawns dist/index.js against a scratch copy
// of ops/network so nothing in the repo is modified. Exercises tool listing,
// resources, inventory read/write, an SSH probe that must fail fast, verify.sh's
// table parsing (with the hf column) and the job API's error path. Run with `npm test`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const opsSrc = path.resolve(here, '..', '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'trimurti-ops-'));
for (const entry of ['inventory.csv', 'README.md', 'status.md', 'scripts', 'checklists']) {
  fs.cpSync(path.join(opsSrc, entry), path.join(scratch, entry), { recursive: true });
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, '..', 'dist', 'index.js')],
  env: { ...process.env, TRIMURTI_OPS_DIR: scratch, KEY_FILE: path.join(scratch, 'no-such-key') },
  stderr: 'pipe',
});
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const listed = (await client.listTools()).tools;
const tools = listed.map((t) => t.name).sort();
assert.deepEqual(tools, [
  'trimurti_check_nas',
  'trimurti_get_job',
  'trimurti_list_hosts',
  'trimurti_list_jobs',
  'trimurti_run_script',
  'trimurti_scan_lan',
  'trimurti_ssh_run',
  'trimurti_test_ssh',
  'trimurti_upsert_host',
  'trimurti_verify_hosts',
]);
console.log('tools:', tools.length);
const byName = Object.fromEntries(listed.map((t) => [t.name, t]));
assert.match(byName.trimurti_run_script.description, /--skip-hf/, 'bootstrap flags documented');
assert.ok(byName.trimurti_verify_hosts.outputSchema.properties.rows.items.properties.hf, 'verify rows carry hf');

const resources = (await client.listResources()).resources.map((r) => r.uri).sort();
assert.ok(resources.includes('trimurti://readme') && resources.includes('trimurti://inventory'));
assert.ok(resources.some((u) => u === 'trimurti://checklists/router-tuning'), 'checklists listed via template');
const readme = await client.readResource({ uri: 'trimurti://readme' });
assert.match(readme.contents[0].text, /Trimurti network kit/);
const nas = await client.readResource({ uri: 'trimurti://checklists/nas' });
assert.match(nas.contents[0].text, /Synology/);
console.log('resources:', resources.length);

let r = await client.callTool({ name: 'trimurti_list_hosts', arguments: {} });
assert.equal(r.isError, undefined);
assert.equal(r.structuredContent.total, 6, 'template inventory has 6 rows incl. router');
r = await client.callTool({ name: 'trimurti_list_hosts', arguments: { role: 'new', response_format: 'json' } });
assert.equal(r.structuredContent.count, 2);
assert.deepEqual(r.structuredContent.hosts.map((h) => h.name), ['new-pc-1', 'new-pc-2']);

r = await client.callTool({
  name: 'trimurti_upsert_host',
  arguments: { name: 'new-pc-3', ip: '192.0.2.9', mac: 'AA-BB-CC-DD-EE-03', os: 'linux', user: 'sanjay', role: 'new', trimurti: 'yes', notes: 'smoke test' },
});
assert.equal(r.structuredContent.action, 'created');
assert.equal(r.structuredContent.host.mac, 'aa:bb:cc:dd:ee:03');
r = await client.callTool({
  name: 'trimurti_upsert_host',
  arguments: { name: 'new-pc-3', ip: '192.0.2.9', os: 'linux', user: 'sanjay', role: 'new', notes: 'second write' },
});
assert.equal(r.structuredContent.action, 'updated');
r = await client.callTool({ name: 'trimurti_list_hosts', arguments: { name: 'new-pc-3' } });
assert.equal(r.structuredContent.total, 1);
assert.equal(r.structuredContent.hosts[0].notes, 'second write');
const csv = fs.readFileSync(path.join(scratch, 'inventory.csv'), 'utf8');
assert.ok(csv.startsWith('# Trimurti network inventory'), 'comments preserved');
assert.equal((csv.match(/^new-pc-3,/gm) || []).length, 1, 'one row per name');
assert.ok(!fs.readFileSync(path.join(opsSrc, 'inventory.csv'), 'utf8').includes('new-pc-3'), 'repo inventory untouched');
console.log('inventory: ok');

r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'bad host', os: 'linux', user: 'x', role: 'new' } });
assert.equal(r.isError, true, 'validation rejects a bad name');

const t0 = Date.now();
r = await client.callTool({ name: 'trimurti_test_ssh', arguments: { name: 'new-pc-3', timeout_seconds: 5 } });
assert.equal(r.structuredContent.all_ok, false);
assert.equal(r.structuredContent.results[0].ok, false);
assert.ok(r.structuredContent.results[0].diagnosis.length > 10);
assert.ok(Date.now() - t0 < 20000, 'ssh probe fails fast');
console.log('ssh probe:', r.structuredContent.results[0].diagnosis.slice(0, 70));

r = await client.callTool({ name: 'trimurti_test_ssh', arguments: { role: 'router' } });
assert.equal(r.isError, true, 'routers are never tested');

// 192.0.2.9 is TEST-NET: the host is unreachable, so every CLI column reads '-'.
r = await client.callTool({ name: 'trimurti_verify_hosts', arguments: { name: 'new-pc-3', timeout_seconds: 60 } });
assert.equal(r.isError, undefined, 'verify.sh ran and produced a table');
assert.equal(r.structuredContent.all_green, false);
assert.deepEqual(r.structuredContent.rows.map((x) => [x.host, x.hf]), [['new-pc-3', '-']], 'hf column parsed');
assert.match(r.structuredContent.problems[0], /hf missing/);
console.log('verify:', r.structuredContent.problems[0]);

r = await client.callTool({ name: 'trimurti_get_job', arguments: { job_id: '20260101-000000-abcd' } });
assert.equal(r.isError, true);
r = await client.callTool({ name: 'trimurti_list_jobs', arguments: {} });
assert.deepEqual(r.structuredContent.jobs, []);

await client.close();
fs.rmSync(scratch, { recursive: true, force: true });
console.log('SMOKE PASS');
