// End-to-end smoke test over stdio: spawns dist/index.js against a scratch copy
// of ops/network with the template inventory from test/fixtures (never the real
// inventory.csv, which holds the gallery's machines), so nothing in the repo is
// modified and the result does not depend on it. Exercises tool listing,
// resources, inventory read/merge/remove, the router guard, SSH probes that
// must fail fast and the job API's error path. Run with `npm test`.
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
for (const entry of ['AGENTS.md', 'README.md', 'scripts', 'checklists']) {
  fs.cpSync(path.join(opsSrc, entry), path.join(scratch, entry), { recursive: true });
}
fs.writeFileSync(path.join(scratch, 'status.md'), '# Status\n');
const fixture = fs.readFileSync(path.join(here, 'fixtures', 'inventory.csv'), 'utf8');
const invFile = path.join(scratch, 'inventory.csv');
fs.writeFileSync(invFile, fixture);
const repoInventory = fs.existsSync(path.join(opsSrc, 'inventory.csv')) ? fs.readFileSync(path.join(opsSrc, 'inventory.csv'), 'utf8') : '';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, '..', 'dist', 'index.js')],
  env: { ...process.env, TRIMURTI_OPS_DIR: scratch, KEY_FILE: path.join(scratch, 'no-such-key') },
  stderr: 'pipe',
});
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, [
  'trimurti_check_nas',
  'trimurti_get_job',
  'trimurti_list_hosts',
  'trimurti_list_jobs',
  'trimurti_remove_host',
  'trimurti_run_script',
  'trimurti_scan_lan',
  'trimurti_ssh_run',
  'trimurti_test_ssh',
  'trimurti_upsert_host',
  'trimurti_verify_hosts',
]);
console.log('tools:', tools.length);
const listed = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t]));
assert.equal(listed.trimurti_run_script.annotations.destructiveHint, true, 'run_script updates and reconfigures many machines');
// the user pattern a client validates against has no flags: it must take "Sanjay Kapoor" and refuse "-x"
const userPattern = new RegExp(listed.trimurti_upsert_host.inputSchema.properties.user.anyOf?.[0]?.pattern ?? listed.trimurti_upsert_host.inputSchema.properties.user.pattern);
assert.ok(userPattern.test('Sanjay Kapoor') && !userPattern.test('-x') && !userPattern.test('a,b'));

const resources = (await client.listResources()).resources.map((r) => r.uri).sort();
assert.ok(resources.includes('trimurti://readme') && resources.includes('trimurti://inventory') && resources.includes('trimurti://agents'));
const agents = await client.readResource({ uri: 'trimurti://agents' });
assert.match(agents.contents[0].text, /Hard rules/);
const nosuch = await client.readResource({ uri: 'trimurti://checklists/nosuch' });
assert.match(nosuch.contents[0].text, /no checklist named "nosuch"; available: .*router-tuning/);
assert.ok(resources.some((u) => u === 'trimurti://checklists/router-tuning'), 'checklists listed via template');
const readme = await client.readResource({ uri: 'trimurti://readme' });
assert.match(readme.contents[0].text, /Trimurti network kit/);
const nas = await client.readResource({ uri: 'trimurti://checklists/nas' });
assert.match(nas.contents[0].text, /Synology/);
console.log('resources:', resources.length);

let r = await client.callTool({ name: 'trimurti_list_hosts', arguments: {} });
assert.equal(r.isError, undefined);
assert.equal(r.structuredContent.total, 6, 'template inventory has 6 rows incl. router');
assert.equal(r.structuredContent.hosts[0].ssh_port, null, 'a blank ssh_port stays blank');
r = await client.callTool({ name: 'trimurti_list_hosts', arguments: { role: 'new', response_format: 'json' } });
assert.equal(r.structuredContent.count, 2);
assert.deepEqual(r.structuredContent.hosts.map((h) => h.name), ['new-pc-1', 'new-pc-2']);

r = await client.callTool({
  name: 'trimurti_upsert_host',
  arguments: { name: 'new-pc-3', ip: '192.0.2.9', mac: 'AA-BB-CC-DD-EE-03', os: 'linux', user: 'sanjay', role: 'new', ssh_port: 2222, notes: 'smoke test' },
});
assert.equal(r.structuredContent.action, 'created');
assert.equal(r.structuredContent.host.mac, 'aa:bb:cc:dd:ee:03');
// only the fields given change
r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'NEW-PC-3', trimurti: 'yes' } });
assert.equal(r.structuredContent.action, 'updated');
assert.deepEqual(r.structuredContent.changed, ['trimurti']);
assert.deepEqual(
  { ...r.structuredContent.host },
  { name: 'new-pc-3', ip: '192.0.2.9', mac: 'aa:bb:cc:dd:ee:03', os: 'linux', user: 'sanjay', role: 'new', ssh_port: 2222, trimurti: 'yes', notes: 'smoke test' },
);
r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'new-pc-3', notes: 'a | b', ssh_port: '' } });
assert.equal(r.structuredContent.host.ssh_port, null);
r = await client.callTool({ name: 'trimurti_list_hosts', arguments: { name: 'new-pc-3' } });
assert.equal(r.structuredContent.total, 1);
assert.match(r.content[0].text, /\| a \\\| b \|/, 'a | in a cell is escaped');
let csv = fs.readFileSync(invFile, 'utf8');
assert.ok(csv.startsWith('# Trimurti network inventory'), 'comments preserved');
assert.equal((csv.match(/^new-pc-3,/gm) || []).length, 1, 'one row per name');
assert.ok(csv.includes('\nnew-pc-3,192.0.2.9,aa:bb:cc:dd:ee:03,linux,sanjay,new,,yes,a | b\n'));
assert.equal(fs.existsSync(path.join(opsSrc, 'inventory.csv')) ? fs.readFileSync(path.join(opsSrc, 'inventory.csv'), 'utf8') : '', repoInventory, 'repo inventory untouched');

r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'DESKTOP-AB12CD', os: 'windows', user: 'sanjay', role: 'new' } });
assert.equal(r.structuredContent.host.name, 'desktop-ab12cd', 'new names are stored lowercase');
assert.equal(r.structuredContent.host.ssh_port, null, 'no ssh_port given: no SSH');
r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'h9', ip: '192.0.2.9', os: 'linux', role: 'workstation' } });
assert.match(r.structuredContent.warnings[0], /also on row new-pc-3/);
r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'h10', os: 'linux', role: 'workstation' } });
assert.equal(r.isError, undefined, 'user is optional');
// a Windows local account with a space (the scripts quote it; every process gets it as one argv element)
r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'h11', ip: '192.0.2.11', os: 'windows', user: 'Sanjay Kapoor', role: 'workstation', ssh_port: 22 } });
assert.equal(r.isError, undefined, 'a user with a space is accepted');
assert.equal(r.structuredContent.host.user, 'Sanjay Kapoor');
assert.ok(fs.readFileSync(invFile, 'utf8').includes('\nh11,192.0.2.11,,windows,Sanjay Kapoor,workstation,22,no,\n'));
r = await client.callTool({ name: 'trimurti_test_ssh', arguments: { name: 'h11', timeout_seconds: 5 } });
assert.equal(r.structuredContent.results[0].skipped, false, 'the SSH tools try that row');
assert.match(r.structuredContent.results[0].diagnosis, /admin key not found/);
r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'h11', user: 'GALLERY\\sanjay' } });
assert.equal(r.structuredContent.host.user, 'GALLERY\\sanjay', 'a domain account too');
r = await client.callTool({ name: 'trimurti_remove_host', arguments: { name: 'h11' } });
assert.equal(r.structuredContent.removed.name, 'h11');
for (const bad of [
  { name: 'bad host', os: 'linux', user: 'x', role: 'new' },
  { name: 'h15', os: 'linux', user: 'a,b', role: 'new' },
  { name: 'h16', os: 'linux', user: 'a"b', role: 'new' },
  { name: 'h17', os: 'linux', user: ' lead', role: 'new' },
  { name: 'h18', os: 'linux', user: '- x', role: 'new' },
  { name: 'h5', ip: '192.168.1.021', os: 'linux', user: 'x', role: 'new' },
  { name: 'h6', ip: '999.1.1.1', os: 'linux', user: 'x', role: 'new' },
  { name: 'h13', ip: '192.0.2.13', os: 'linux', user: '-Eowned', role: 'new' },
  { name: 'h14', os: 'linux', user: 'x', role: 'new', notes: 'a,b' },
]) {
  r = await client.callTool({ name: 'trimurti_upsert_host', arguments: bad });
  assert.equal(r.isError, true, `validation rejects ${JSON.stringify(bad)}`);
}
r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'brand-new', ip: '192.0.2.50' } });
assert.equal(r.isError, true);
assert.match(r.content[0].text, /needs os and role/);

// the router: its row keeps role=router, and its IP cannot be given another role
r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'router', role: 'workstation' } });
assert.equal(r.isError, true);
assert.match(r.content[0].text, /router row/);
r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'gw2', ip: '192.168.1.1', os: 'other', user: 'admin', role: 'workstation' } });
assert.equal(r.isError, true);
assert.match(r.content[0].text, /must have role=router/);
r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'router', ip: '192.168.1.254', notes: 'fixed ip' } });
assert.equal(r.isError, undefined, 'the router row itself can be corrected');
console.log('inventory: ok');

const t0 = Date.now();
r = await client.callTool({ name: 'trimurti_test_ssh', arguments: { name: 'new-pc-2', timeout_seconds: 5 } });
assert.equal(r.structuredContent.all_ok, false);
assert.equal(r.structuredContent.results[0].ok, false);
assert.match(r.structuredContent.key_problem, /admin key not found/);
assert.match(r.structuredContent.results[0].diagnosis, /admin key not found/);
assert.ok(Date.now() - t0 < 20000, 'ssh probe fails fast');
console.log('ssh probe:', r.structuredContent.results[0].diagnosis.slice(0, 70));
r = await client.callTool({ name: 'trimurti_test_ssh', arguments: { name: 'new-pc-3' } });
assert.equal(r.structuredContent.results[0].skipped, true);
assert.match(r.structuredContent.results[0].diagnosis, /no ssh_port set/);
r = await client.callTool({ name: 'trimurti_test_ssh', arguments: {} });
assert.deepEqual(
  r.structuredContent.results.map((x) => x.name),
  ['gallery-desk', 'studio-mac', 'new-pc-1', 'new-pc-2', 'new-pc-3', 'desktop-ab12cd', 'h9', 'h10'],
  'no filter: computers only, never the router or the NAS',
);

for (const [tool, args] of [
  ['trimurti_test_ssh', { role: 'router' }],
  ['trimurti_test_ssh', { name: 'router' }],
  ['trimurti_ssh_run', { name: 'router', command: 'echo hi' }],
  ['trimurti_run_script', { script: 'disk-triage', name: 'router' }],
  ['trimurti_verify_hosts', { name: 'router' }],
  ['trimurti_check_nas', { host: 'router' }],
]) {
  r = await client.callTool({ name: tool, arguments: args });
  assert.equal(r.isError, true, `${tool} refuses the router`);
  assert.match(r.content[0].text, /router/);
}
r = await client.callTool({ name: 'trimurti_ssh_run', arguments: { name: 'new-pc-2', command: 'echo hi' } });
assert.equal(r.isError, true);
assert.match(r.content[0].text, /admin key not found/);
r = await client.callTool({ name: 'trimurti_run_script', arguments: { script: 'enable-ssh-server', name: 'new-pc-2', args: ['--harden'] } });
assert.equal(r.isError, true);
assert.match(r.content[0].text, /--harden/);
for (const flag of ['--cleanup', '--major-upgrade', '-Drivers', '-drivers', '--drivers', '-FeatureUpgrades', '--feature-upgrades']) {
  r = await client.callTool({ name: 'trimurti_run_script', arguments: { script: 'update-all', name: 'NEW-PC-2', args: ['--no-clis', flag] } });
  assert.equal(r.isError, true, `update-all ${flag} is refused`);
  assert.match(r.content[0].text, /Sanjay's explicit yes/);
  assert.ok(r.content[0].text.includes(`scripts/run-remote.sh --host new-pc-2 --tty update-all ${flag})`), r.content[0].text);
}
r = await client.callTool({ name: 'trimurti_run_script', arguments: { script: 'update-all', os: 'windows', args: ['-FeatureUpgrades'] } });
assert.match(r.content[0].text, /run-remote\.sh --os windows --tty update-all -FeatureUpgrades\)/, 'the command keeps the selection');
r = await client.callTool({ name: 'trimurti_run_script', arguments: { script: 'update-all', name: 'new-pc-2', args: ['--no-clis'] } });
assert.match(r.content[0].text, /admin key not found.*Nothing started/, 'update-all without those flags gets past the refusal');
r = await client.callTool({ name: 'trimurti_run_script', arguments: { script: 'disk-triage', name: 'new-pc-2' } });
assert.equal(r.isError, true, 'no job starts without a usable key');
assert.match(r.content[0].text, /admin key not found.*Nothing started/);
r = await client.callTool({ name: 'trimurti_check_nas', arguments: { host: 'new-pc-2' } });
assert.equal(r.isError, true);
assert.match(r.content[0].text, /not nas/);
r = await client.callTool({ name: 'trimurti_check_nas', arguments: { host: '192.0.2.77' } });
assert.equal(r.isError, true);
assert.match(r.content[0].text, /not in the inventory/);
r = await client.callTool({ name: 'trimurti_scan_lan', arguments: { subnet: '192.0.2' } });
assert.equal(r.isError, true, 'public subnets are refused');
console.log('guards: ok');

r = await client.callTool({ name: 'trimurti_remove_host', arguments: { name: 'router' } });
assert.equal(r.isError, true, 'the router row needs confirm');
for (const n of ['new-pc-3', 'desktop-ab12cd', 'h9', 'h10']) {
  r = await client.callTool({ name: 'trimurti_remove_host', arguments: { name: n } });
  assert.equal(r.structuredContent.removed.name, n);
}
r = await client.callTool({ name: 'trimurti_remove_host', arguments: { name: 'new-pc-3' } });
assert.equal(r.isError, true);
csv = fs.readFileSync(invFile, 'utf8');
assert.equal(csv, fixture.replace('router,192.168.1.1,,other,admin,router,,no,fill in make and model', 'router,192.168.1.254,,other,admin,router,,no,fixed ip'));

// a lost header line is an error, not a silently missing host
fs.writeFileSync(invFile, fixture.replace(/^name,ip,.*\n/m, ''));
r = await client.callTool({ name: 'trimurti_list_hosts', arguments: {} });
assert.equal(r.isError, true);
assert.match(r.content[0].text, /inventory header missing/);
fs.writeFileSync(invFile, '\uFEFF' + fixture.replace(/\n/g, '\r\n'));
r = await client.callTool({ name: 'trimurti_upsert_host', arguments: { name: 'new-pc-2', ip: '192.0.2.2' } });
assert.equal(r.structuredContent.host.ip, '192.0.2.2', 'Excel BOM and CRLF are read');
assert.ok(fs.readFileSync(invFile, 'utf8').includes('\r\nnew-pc-2,192.0.2.2,,linux,sanjay,new,22,yes,second of the two new machines\r\n'), 'CRLF kept');
console.log('remove/header: ok');

r = await client.callTool({ name: 'trimurti_get_job', arguments: { job_id: '20260101-000000-abcd' } });
assert.equal(r.isError, true);
r = await client.callTool({ name: 'trimurti_list_jobs', arguments: {} });
assert.deepEqual(r.structuredContent.jobs, []);

await client.close();
fs.rmSync(scratch, { recursive: true, force: true });
console.log('SMOKE PASS');
