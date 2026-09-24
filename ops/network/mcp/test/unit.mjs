// Unit tests for the parsers and helpers that need no MCP client: the job summary, Git Bash
// lookup, gateway parsing, the remote timeout wrapper, ssh diagnoses and output shaping.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mdTable, clipStream } from '../dist/result.js';
import { HARD_RULE_FLAG, parseSummary, refusedArgs, verifySavedFile } from '../dist/tools/scripts.js';
import { diagnose, isSshFailure, posixWrap, powershellInvocation } from '../dist/tools/ssh.js';
import { findGitBash, gatewaysFromNetstat, gatewaysFromProcRoute, gitUsrBin, lockedKeyHint } from '../dist/system.js';
import { LOGIN_USER, sshSkipReason } from '../dist/inventory.js';
import { stripAnsi } from '../dist/exec.js';
import { NETSCAN_PS_COMMAND, parseNetscanOutput } from '../dist/tools/network.js';
import fs from 'node:fs';
import os from 'node:os';

// C4: only run-remote.sh's TRIMURTI_SUMMARY lines count, the last of each wins
const log = [
  '[10:00:01] new-pc-2: update-all.sh -> gallery@192.168.85.25 (log: x)',
  'REBOOT_REQUIRED=no',
  'WARNING: PSWindowsUpdate failed: Access is denied. Use Settings > Windows Update',
  'Codex installer failed: exit 1',
  '[10:00:09] arch-pc: update-all.sh -> gallery@192.168.85.24 (log: y)',
  'REBOOT_REQUIRED=yes',
  'TRIMURTI_SUMMARY passed=new-pc-2,arch-pc',
  'TRIMURTI_SUMMARY failed=',
  'TRIMURTI_SUMMARY reboot_required=arch-pc',
  '',
].join('\n');
assert.deepEqual(parseSummary(log), { found: true, passed: ['new-pc-2', 'arch-pc'], failed: [], reboot_required: ['arch-pc'] });
assert.deepEqual(parseSummary('failed: none\nREBOOT_REQUIRED=yes\n').found, false);
assert.deepEqual(parseSummary('TRIMURTI_SUMMARY failed=a\r\nTRIMURTI_SUMMARY failed=b,c\r\n').failed, ['b', 'c']);
console.log('summary: ok');

// Git Bash on Windows: Program Files first, then git --exec-path, never System32's WSL bash
const PF = 'C:\\Program Files';
const have = (list) => (p) => list.includes(p);
const noGit = () => {
  throw new Error('git not found');
};
assert.equal(findGitBash({ ProgramFiles: PF }, have([`${PF}\\Git\\bin\\bash.exe`]), noGit), `${PF}\\Git\\bin\\bash.exe`);
assert.equal(
  findGitBash({ ProgramFiles: PF }, have(['D:\\Tools\\Git\\bin\\bash.exe']), () => 'D:/Tools/Git/mingw64/libexec/git-core\n'),
  'D:\\Tools\\Git\\bin\\bash.exe',
);
assert.equal(findGitBash({ ProgramFiles: PF, TRIMURTI_BASH: 'C:\\Windows\\System32\\bash.exe' }, have(['C:\\Windows\\System32\\bash.exe']), noGit), undefined);
assert.equal(findGitBash({ ProgramFiles: PF }, have([]), noGit), undefined);
assert.equal(
  findGitBash({ LOCALAPPDATA: 'C:\\Users\\Sanjay Kapoor\\AppData\\Local' }, have(['C:\\Users\\Sanjay Kapoor\\AppData\\Local\\Programs\\Git\\bin\\bash.exe']), noGit),
  'C:\\Users\\Sanjay Kapoor\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
);
console.log('git bash: ok');

// Windows: the MCP's own ssh, ssh-keygen and ssh-add are Git's, next to the Git Bash the scripts use
assert.equal(gitUsrBin(`${PF}\\Git\\bin\\bash.exe`, have([`${PF}\\Git\\usr\\bin\\ssh.exe`])), `${PF}\\Git\\usr\\bin`);
assert.equal(gitUsrBin('D:\\Tools\\Git\\usr\\bin\\bash.exe', have(['D:\\Tools\\Git\\usr\\bin\\ssh.exe'])), 'D:\\Tools\\Git\\usr\\bin');
assert.equal(
  gitUsrBin('C:\\Users\\Sanjay Kapoor\\AppData\\Local\\Programs\\Git\\bin\\bash.exe', have(['C:\\Users\\Sanjay Kapoor\\AppData\\Local\\Programs\\Git\\usr\\bin\\ssh.exe'])),
  'C:\\Users\\Sanjay Kapoor\\AppData\\Local\\Programs\\Git\\usr\\bin',
);
assert.equal(gitUsrBin(`${PF}\\Git\\bin\\bash.exe`, have([])), undefined, 'no Git ssh: PATH ssh');
console.log('git ssh: ok');

// A locked key: what Sanjay does, never "start an agent" in the agent's own shells (contract D)
const k = '/home/sanjay/.ssh/id_ed25519_trimurti';
assert.match(lockedKeyHint(k, 'darwin', 1, undefined), /ssh-add --apple-use-keychain \/home\/sanjay\/.ssh\/id_ed25519_trimurti in any terminal, or reruns launch\.sh/);
assert.match(lockedKeyHint(k, 'linux', 1, '/tmp/ssh-x/agent.1'), /reruns launch\.sh, or adds it .*SSH_AUTH_SOCK='\/tmp\/ssh-x\/agent\.1' ssh-add/);
assert.match(lockedKeyHint(k, 'linux', 2, undefined), /has no ssh-agent and no terminal .*reruns launch\.sh/);
assert.match(lockedKeyHint('"C:\\Users\\Sanjay Kapoor\\.ssh\\id_ed25519_trimurti"', 'win32', 1, '/tmp/ssh-y/agent.2'), /reruns launch\.ps1/);
for (const h of [lockedKeyHint(k, 'linux', 2, undefined), lockedKeyHint(k, 'win32', 2, undefined)]) assert.doesNotMatch(h, /ssh-agent -s|start one/);
console.log('locked key hint: ok');

const route = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
eth0\t00000000\t0155A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0
eth0\t0055A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0
`;
assert.deepEqual(gatewaysFromProcRoute(route), ['192.168.85.1']);
const mac = `Routing tables

Internet:
Destination        Gateway            Flags               Netif Expire
default            192.168.1.1        UGScg                 en0
default            link#17            UCSIg           bridge100      !
127                127.0.0.1          UCS                   lo0
192.168.1          link#6             UCS                   en0      !
`;
assert.deepEqual(gatewaysFromNetstat(mac), ['192.168.1.1']);
const win = `IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.10     25
        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331
===========================================================================
Persistent Routes:
  None
`;
assert.deepEqual(gatewaysFromNetstat(win.replace(/\n/g, '\r\n')), ['192.168.1.1']);
console.log('gateway: ok');

// The remote wrapper keeps the command exactly as the login shell would run it
if (process.platform !== 'win32') {
  const sh = (cmd, input) =>
    spawnSync('bash', ['-c', cmd], { input: input ?? '', encoding: 'utf8', env: { ...process.env, SHELL: '/bin/bash' } });
  const tricky = `printf '%s|' "it's" 'a"b' "$((1+2))" \\$HOME; echo; exit 3`;
  const direct = sh(tricky);
  const wrapped = sh(posixWrap(tricky, 5));
  assert.equal(wrapped.stdout, direct.stdout);
  assert.equal(wrapped.status, 3);
  const t0 = Date.now();
  const slow = sh(posixWrap('sleep 30', 1));
  assert.equal(slow.status, 124, 'GNU timeout stops it on the host');
  assert.ok(Date.now() - t0 < 10000);
  const viaStdin = sh(posixWrap(undefined, 5), 'x=41\necho $((x+1))\n');
  assert.equal(viaStdin.stdout, '42\n');
  console.log('posix wrapper: ok');
}

// ssh diagnoses: key and user problems are named, remote command failures are not ssh failures
const host = { name: 'arch-pc', ip: '192.168.85.24', mac: '', os: 'linux', user: 'nobodyhere', role: 'workstation', ssh_port: 22, trimurti: 'yes', notes: '' };
assert.match(diagnose('nobodyhere@192.168.85.24: Permission denied (publickey,password).', host), /inventory user is "nobodyhere"/);
assert.match(
  diagnose("Warning: Identity file /x not accessible: No such file or directory.\nnobodyhere@h: Permission denied (publickey).", host),
  /admin key missing/,
);
assert.match(diagnose('ssh: connect to host 192.168.85.24 port 2222: Connection refused', { ...host, ssh_port: 2222 }), /nothing listening on port 2222.*ssh_port 2222/);
assert.match(diagnose('ssh: connect to host x port 22: Connection refused', { ...host, role: 'nas', os: 'nas' }), /Terminal & SNMP/);
assert.match(diagnose('ssh: connect to host x port 22: Connection refused', { ...host, role: 'admin' }), /admin machine itself/);
assert.match(diagnose('remote username contains invalid characters', { ...host, user: "O'Brien" }), /ssh itself refuses the inventory user "O'Brien"/);
assert.equal(isSshFailure(255, 'remote username contains invalid characters'), true);
assert.equal(isSshFailure(2, "ls: cannot access '/nonexistent-dir': No such file or directory"), false);
assert.equal(isSshFailure(1, 'cat: /etc/shadow: Permission denied'), false);
assert.equal(isSshFailure(255, 'gallery@192.168.85.24: Permission denied (publickey).'), true);
assert.equal(isSshFailure(255, 'Sanjay Kapoor@192.168.85.24: Permission denied (publickey,password).'), true, 'a user with a space');
assert.equal(isSshFailure(255, 'ssh: connect to host 192.168.85.26 port 22: No route to host'), true);
console.log('diagnose: ok');

// netscan: the CSV path keeps its spaces; warnings are found by our own marker or the English prefix
const scan = parseNetscanOutput(
  'adapter=Ethernet  link=1 Gbps\nWARN: network profile is Public\nWARNING: prefix is /23\nnot a WARN line\nsaved: C:\\Users\\Sanjay Kapoor\\ops\\network\\out\\scan-20260924-153401.csv\r\n',
);
assert.equal(scan.csv, 'C:\\Users\\Sanjay Kapoor\\ops\\network\\out\\scan-20260924-153401.csv');
assert.deepEqual(scan.warnings, ['network profile is Public', 'prefix is /23']);
assert.equal(parseNetscanOutput('[10:00:00] saved: /Users/Sanjay Kapoor/kit/out/scan-1.csv').csv, '/Users/Sanjay Kapoor/kit/out/scan-1.csv');
// netscan.ps1's Write-Warning comes out as "WARN: " in any display language (pwsh stands in for powershell.exe)
const pwsh = [process.env.PWSH, 'pwsh'].find((c) => c && spawnSync(c, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0);
if (pwsh) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trimurti scan '));
  const fake = path.join(dir, 'netscan.ps1');
  fs.writeFileSync(
    fake,
    'Write-Host "adapter=Ethernet  link=1 Gbps"\nWrite-Warning "network profile is \'Public\'"\nWrite-Host "args=$($args -join \'+\')"\n' +
      `Write-Host "saved: ${dir}/scan-1.csv"\nif ($args[0] -eq '10.9.9') { exit 1 }\nexit 0\n`,
  );
  const ps = (subnet) =>
    spawnSync(pwsh, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', NETSCAN_PS_COMMAND], {
      encoding: 'utf8',
      env: { ...process.env, TRIMURTI_NETSCAN: fake, TRIMURTI_SUBNET: subnet },
    });
  let r = ps('');
  assert.equal(r.status, 0, r.stderr);
  let parsed = parseNetscanOutput(r.stdout);
  assert.deepEqual(parsed.warnings, ["network profile is 'Public'"]);
  assert.equal(parsed.csv, `${dir}/scan-1.csv`);
  assert.match(r.stdout, /^args=$/m);
  r = ps('192.168.1');
  assert.match(r.stdout, /^args=192\.168\.1$/m);
  assert.equal(ps('10.9.9').status, 1, 'the script exit code comes through');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('netscan.ps1 wrapper: ok');
}

// Login names as lib.sh takes them: spaces inside are fine; no leading '-', comma, quote or control character
const row = (user) => ({ name: 'pc', ip: '192.0.2.5', mac: '', os: 'windows', user, role: 'workstation', ssh_port: 22, trimurti: 'no', notes: '' });
for (const u of ['sanjay', 'Sanjay Kapoor', 'GALLERY\\sanjay', 'sanjay@gallery.local', 'José', 'o.brien_2', 'x'.repeat(64)]) {
  assert.ok(LOGIN_USER.test(u), `accepts ${u}`);
  assert.equal(sshSkipReason(row(u)), '', `ssh tools try ${u}`);
}
for (const u of ['-oProxyCommand=x', ' sanjay', 'sanjay ', 'a,b', 'a"b', 'a\tb', 'a\nb', 'a\u0085b', 'x'.repeat(65), '']) {
  assert.ok(!LOGIN_USER.test(u), `refuses ${JSON.stringify(u)}`);
}
assert.match(sshSkipReason(row('-oProxyCommand=x')), /starts with '-'/);
assert.match(sshSkipReason(row('')), /no user set/);
assert.match(sshSkipReason(row('a"b')), /not a login name/);
// the JSON Schema a client sees has no regex flags: the pattern must mean the same without 'u'
assert.equal(LOGIN_USER.flags, '');
assert.ok(new RegExp(LOGIN_USER.source).test('Sanjay Kapoor') && !new RegExp(LOGIN_USER.source).test('-x'));
console.log('login names: ok');

// update-all's hard-rule flags, every spelling the .sh and the .ps1 take, are refused like --harden
for (const a of ['--cleanup', '--major-upgrade', '-Drivers', '--drivers', '-drivers', '-FeatureUpgrades', '-featureupgrades', '--feature-upgrades', '--MAJOR-UPGRADE', '--cleanup=yes']) {
  assert.ok(HARD_RULE_FLAG.test(a), `refuses ${a}`);
}
for (const a of ['--no-os', '--no-clis', '-NoOS', '-NoCLIs', '-AllUpdates', '--all-updates', '--skip-gemini', '-WithGit', '-Pwsh7']) {
  assert.ok(!HARD_RULE_FLAG.test(a), `allows ${a}`);
  assert.equal(refusedArgs([a], []), '');
}
assert.match(refusedArgs(['--no-os', '-Drivers'], ['--host', 'new-pc-1']), /^-Drivers: .*Sanjay's explicit yes.*scripts\/run-remote\.sh --host new-pc-1 --tty update-all -Drivers\)/);
assert.match(refusedArgs(['--cleanup', '--major-upgrade'], ['--os', 'macos']), /run-remote\.sh --os macos --tty update-all --cleanup --major-upgrade\)/);
assert.match(refusedArgs(['--harden'], ['--host', 'arch-pc']), /^--harden .*run-remote\.sh --host arch-pc --tty enable-ssh-server --harden\)/);
console.log('refused flags: ok');

// verify.sh's unique table file is still found from its "saved:" line
assert.equal(
  verifySavedFile(stripAnsi('\u001b[1;34m[12:00:01]\u001b[0m saved: /Users/Sanjay Kapoor/kit/out/verify-20260924-120001-4242.md\n\u001b[1;34m[12:00:01]\u001b[0m paste the table into status.md\n')),
  '/Users/Sanjay Kapoor/kit/out/verify-20260924-120001-4242.md',
);
assert.equal(verifySavedFile('no table\n'), undefined);
console.log('verify saved: ok');

// shell=powershell: the command goes base64 over stdin behind a fixed -EncodedCommand bootstrap
const inv = powershellInvocation('foreach ($i in 1,2) {\n "i=$i"\n}', true);
assert.deepEqual(inv.argv.slice(0, 8), ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand']);
assert.equal(powershellInvocation('1', false).argv[0], 'pwsh');
assert.match(inv.argv[8], /^[A-Za-z0-9+/]+=*$/, 'only base64 characters reach the remote shell');
assert.ok(inv.argv.join(' ').length < 8000, "fits cmd.exe's 8191-character command line");
assert.equal(Buffer.from(inv.stdin.trim(), 'base64').toString('utf8'), 'foreach ($i in 1,2) {\n "i=$i"\n}');
const pwshExe = [process.env.PWSH, 'pwsh'].find((c) => c && spawnSync(c, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0);
if (pwshExe) {
  // pwsh stands in for powershell.exe; it reads exactly the argv and stdin that ssh passes on
  const ps = (command) => {
    const { argv, stdin } = powershellInvocation(command, false);
    const r = spawnSync(pwshExe, argv.slice(1), { input: stdin, encoding: 'utf8' });
    return { code: r.status, out: stripAnsi(r.stdout), err: stripAnsi(r.stderr) };
  };
  let r = ps('foreach ($i in 1,2) {\n  "i=$i"\n}');
  assert.deepEqual([r.code, r.out], [0, 'i=1\ni=2\n'], 'a multi-line block runs (with "-Command -" it was dropped, exit 0)');
  r = ps('foreach ($i in 1,2) {\n  "i=$i"\n\n  "after a blank line"\n}');
  assert.equal(r.out, 'i=1\nafter a blank line\ni=2\nafter a blank line\n');
  assert.deepEqual([ps('"a"; exit 7').code, ps('"a"; exit 7').out], [7, 'a\n'], 'exit N');
  assert.equal(ps('function f { exit 9 }\nf\n"not here"').code, 9);
  assert.equal(ps('bash -c "exit 5"').code, 5, 'a failed native last command gives its own exit code');
  assert.equal(ps('bash -c "exit 5"\n"later"').code, 0, 'as -Command: only the last command counts');
  r = ps('Get-Item /no/such/path');
  assert.equal(r.code, 1, 'a failed cmdlet as the last command');
  assert.match(r.err, /Cannot find path/);
  assert.doesNotMatch(r.err, /CLIXML/, '-OutputFormat Text: errors as text, not serialized');
  r = ps('throw "boom"');
  assert.deepEqual([r.code, /boom/.test(r.err)], [1, true]);
  r = ps('foreach ($i in 1 {');
  assert.equal(r.code, 1, 'a parse error is a failure, never a silent exit 0');
  assert.match(r.err, /Missing closing/);
  r = ps('$x = @"\nhere-string\n"@\n"héllo — ✓ $x" + \'q\'');
  assert.deepEqual([r.code, r.out], [0, 'héllo — ✓ here-stringq\n'], 'quotes, here-strings and non-ASCII arrive intact');
  r = ps('Read-Host "password"');
  assert.equal(r.code, 1, '-NonInteractive: a prompt fails instead of hanging');
  console.log('powershell invocation (pwsh): ok');
}

assert.equal(mdTable([{ a: 'x | y', b: 'l1\nl2' }], ['a', 'b']).split('\n')[2], '| x \\| y | l1 l2 |');
const long = 'HEAD' + 'x'.repeat(20000) + 'TAIL';
const c = clipStream(long);
assert.ok(c.startsWith('HEAD') && c.endsWith('TAIL') && c.length < 10200);
console.log('output: ok');
console.log('UNIT PASS', path.basename(import.meta.url));
