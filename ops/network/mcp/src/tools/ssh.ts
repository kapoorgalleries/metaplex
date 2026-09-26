import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { KEY_FILE, SSH_BASE_OPTS } from '../constants.js';
import { run, stripAnsi } from '../exec.js';
import { selectHosts, sshSkipReason, sshTarget, type Host } from '../inventory.js';
import { clipStream, errorMessage, fail, mdTable, ok } from '../result.js';
import { keyProblem, localIps, sshTool } from '../system.js';
import { FilterFields, HostName } from './inventory.js';

const NAS_SSH_SWITCH =
  "turn SSH on in the NAS's web UI (Synology: Control Panel > Terminal & SNMP; QNAP: Control Panel > Network & File Services > Telnet/SSH; TrueNAS: System > Services > SSH; checklists/nas.md 'Hardening and housekeeping'), or blank its ssh_port if it should have no SSH";

/** Turn ssh's stderr into the fix from README "SSH troubleshooting". The admin key itself is checked before (keyProblem). */
export function diagnose(stderr: string, host: Host, local: string[] = []): string {
  const s = stderr;
  const port = host.ssh_port ?? 22;
  if (/identity file .* not accessible/i.test(s)) {
    return `admin key missing at ${KEY_FILE}. Run scripts/ssh-keys.sh once from a terminal (it asks each host's password) or set KEY_FILE.`;
  }
  if (/HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(s)) {
    return `host key changed (reinstalled machine, or another machine now has this IP?). On the admin machine: ssh-keygen -R ${host.ip || host.name}`;
  }
  if (/remote username contains invalid characters/i.test(s)) {
    return `ssh itself refuses the inventory user "${host.user}": OpenSSH 9.6 and newer reject a user name given on the command line (as the kit gives it) with ' \` " ; & < > | ( ) { }, a '-' after a space, or a '\\' at the end. Log in with another account on that machine, or rename this one.`;
  }
  if (/Could not resolve hostname/i.test(s)) {
    return 'name does not resolve: set ip in the inventory (trimurti_upsert_host) or run scripts/ssh-config-gen.sh.';
  }
  if (/Connection refused/i.test(s)) {
    const head = `nothing listening on port ${port}`;
    if (host.role === 'admin' || (host.ip && local.includes(host.ip))) {
      return `${head}: this is the admin machine itself, which needs no SSH to itself. Blank its ssh_port (trimurti_upsert_host ssh_port "") or run enable-ssh-server there if you want it.`;
    }
    if (host.role === 'nas' || host.os === 'nas') return `${head}: ${NAS_SSH_SWITCH}.`;
    const portNote = port !== 22 ? ` The inventory says ssh_port ${port}: check that sshd really listens there (it uses 22 unless changed).` : '';
    return `${head}: sshd is not running. Run enable-ssh-server on that machine once, locally (README "Windows: the one thing that cannot be done remotely").${portNote}`;
  }
  if (/timed out|No route to host|Network is unreachable/i.test(s)) {
    return `no answer on ${host.ip || host.name}:${port}: machine off, IP moved (set a DHCP reservation, fix the inventory), or a Windows Public network profile blocking inbound (README troubleshooting 2 and 4).`;
  }
  if (/Permission denied/i.test(s)) {
    const who = ` (inventory user is "${host.user}"; check that account exists on the machine)`;
    if (host.os === 'windows') {
      return `key rejected${who}. Windows administrators are read from C:\\ProgramData\\ssh\\administrators_authorized_keys, ACL Administrators+SYSTEM only (README troubleshooting 1). Push again with scripts/ssh-keys.sh --host ${host.name}`;
    }
    if (host.role === 'nas' || host.os === 'nas') {
      return `key rejected${who}. Push it once from a terminal with scripts/ssh-keys.sh --host ${host.name} (Synology: enable the user home service first).`;
    }
    return `key rejected${who}: ~/.ssh must be 700, authorized_keys 600, and the home dir not group-writable (README troubleshooting 5). Push again with scripts/ssh-keys.sh --host ${host.name}`;
  }
  if (/Connection (closed|reset) by|kex_exchange_identification/i.test(s)) {
    return `port ${port} answered but closed the connection before SSH started: something other than sshd listens there, or sshd refuses this machine (MaxStartups, hosts.deny).`;
  }
  return s.trim().split(/\r?\n/).slice(-2).join(' ') || 'unknown failure';
}

/** ssh's own failure (exit 255 with one of its messages), as opposed to the remote command failing. */
export function isSshFailure(code: number | null, stderr: string): boolean {
  return (
    code === 255 &&
    /^.+@\S+: Permission denied \(|^ssh: |Host key verification failed|kex_exchange_identification|^Connection (closed|reset|timed out)|REMOTE HOST IDENTIFICATION HAS CHANGED|Could not resolve hostname|Warning: Identity file|remote username contains invalid characters/m.test(
      stderr,
    )
  );
}

function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The remote command line for a Linux or macOS host, stopped on the host after `seconds` by GNU
 * timeout where there is one (it kills the whole process group, so a hung apt does not keep its
 * locks). The user's command still runs in their login shell, as sshd would run it.
 */
export function posixWrap(command: string | undefined, seconds: number): string {
  const prog = command === undefined ? 'bash -s' : '"$s" -c "$1"';
  const w = `s=\${SHELL:-/bin/sh}; if timeout --version >/dev/null 2>&1; then exec timeout -k 5 ${seconds} ${prog}; fi; exec ${prog}`;
  return command === undefined ? `sh -c ${q(w)}` : `sh -c ${q(w)} trimurti ${q(command)}`;
}

async function sshExec(
  host: Host,
  command: string[],
  opts: { stdin?: string; timeoutMs: number },
): Promise<Awaited<ReturnType<typeof run>>> {
  if (host.ssh_port === null) throw new Error(`${host.name}: no ssh_port set`); // never a silent 22
  // '--' so a user or host that starts with '-' can never become an ssh option
  const args = [...SSH_BASE_OPTS, '-o', 'ConnectTimeout=8', '-p', String(host.ssh_port), '--', sshTarget(host), ...command];
  const runOpts: Parameters<typeof run>[2] = { timeoutMs: opts.timeoutMs };
  if (opts.stdin !== undefined) runOpts.stdin = opts.stdin;
  return run(sshTool('ssh'), args, runOpts);
}

/**
 * Runs the script that arrives on stdin as base64 of its UTF-8 text, as one script block, so a
 * multi-line statement is never dropped ("-Command -" runs stdin one statement at a time and
 * silently skips an unfinished one at EOF, exit 0). Base64 keeps the text intact whatever the
 * console code page. Exit code: the script's own `exit N`; 1 for a parse or terminating error; when
 * its last command failed, the last native program's exit code, or 1; else 0.
 */
export const PS_BOOTSTRAP = [
  "$ErrorActionPreference = 'Continue'; $ProgressPreference = 'SilentlyContinue'",
  'try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }',
  "if ($PSStyle) { $PSStyle.OutputRendering = 'PlainText' }",
  "$global:__trimurti_ok = $true; $global:LASTEXITCODE = 0",
  "try { $__trimurti_sb = [ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((@($input) -join '').Trim())) + \"`n`$global:__trimurti_ok = `$?\") }",
  'catch { [Console]::Error.WriteLine($_.Exception.GetBaseException().Message); exit 1 }',
  'try { & $__trimurti_sb } catch { [Console]::Error.WriteLine(($_ | Out-String).Trim()); exit 1 }',
  'if (-not $global:__trimurti_ok) { if ($LASTEXITCODE) { exit $LASTEXITCODE }; exit 1 }',
  'exit 0',
].join('\n');

/**
 * The remote command line and stdin for shell=powershell: Windows PowerShell on Windows, pwsh
 * elsewhere, started with the fixed bootstrap as -EncodedCommand (UTF-16LE base64, about 2 KB, well
 * under cmd.exe's 8191-character limit) and the command itself on stdin.
 */
export function powershellInvocation(command: string, windows: boolean): { argv: string[]; stdin: string } {
  return {
    argv: [
      windows ? 'powershell' : 'pwsh',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-OutputFormat',
      'Text',
      '-EncodedCommand',
      Buffer.from(PS_BOOTSTRAP, 'utf16le').toString('base64'),
    ],
    stdin: `${Buffer.from(command, 'utf8').toString('base64')}\n`,
  };
}

function routerNote(skipped: Array<{ name: string; reason: string }>): string {
  return skipped.map((s) => `${s.name}: skipped, ${s.reason}`).join('; ');
}

const TestInput = z
  .object({
    ...FilterFields,
    timeout_seconds: z.number().int().min(3).max(60).default(12).describe('Per host'),
  })
  .strict();

const TestOutput = z.object({
  key_file: z.string(),
  key_problem: z.string(),
  all_ok: z.boolean(),
  results: z.array(
    z.object({
      name: z.string(),
      target: z.string(),
      ok: z.boolean(),
      skipped: z.boolean(),
      duration_ms: z.number(),
      diagnosis: z.string(),
    }),
  ),
  not_selected: z.array(z.string()),
});

const RunInput = z
  .object({
    name: HostName.describe('Inventory name of the host to run on (never the router)'),
    command: z.string().min(1).max(4000).describe('The command line to run on that host'),
    shell: z
      .enum(['default', 'bash', 'powershell'])
      .default('default')
      .describe(
        "'default' hands the string to the host's login shell; 'bash' feeds it to bash over stdin; 'powershell' runs it as one PowerShell script (Windows PowerShell on Windows, pwsh on Linux and macOS). Multi-line scripts work in 'bash' and 'powershell'",
      ),
    timeout_seconds: z.number().int().min(1).max(600).default(60),
  })
  .strict();

const RunOutput = z.object({
  name: z.string(),
  target: z.string(),
  exit_code: z.number().nullable(),
  timed_out: z.boolean(),
  duration_ms: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  hint: z.string(),
});

export function registerSshTools(server: McpServer): void {
  server.registerTool(
    'trimurti_test_ssh',
    {
      title: 'Test key-only SSH login',
      description: `Prove that the admin key logs into each selected inventory host without a password (ssh -o BatchMode=yes, PasswordAuthentication=no). For every failure it returns a diagnosis that names the fix from README "SSH troubleshooting". Read-only; never pushes keys (scripts/ssh-keys.sh does that, from a terminal, because the first push needs the host's password).

Args: the inventory filters (name, os, role, trimurti) and timeout_seconds per host (default 12). Without name or role it tests computers only (role admin, workstation, new); name the NAS, a printer or an iot row with name or role. The router (role=router, or this machine's default gateway) is never tested. Rows with a blank ssh_port have no SSH and are reported as skipped.

If the admin key is missing, unusable, or passphrase-protected with no ssh-agent holding it, no host is contacted and key_problem says what to do (e.g. "key is passphrase-protected and no ssh-agent holds it: run ssh-add <path>").

Returns: { key_file, key_problem, all_ok (every host that was tried logged in), results: [{ name, target, ok, skipped, duration_ms, diagnosis }], not_selected }.`,
      inputSchema: TestInput,
      outputSchema: TestOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (p) => {
      try {
        const sel = await selectHosts({ name: p.name, os: p.os, role: p.role, trimurti: p.trimurti });
        if (!sel.hosts.length) {
          return fail(
            sel.skipped.length
              ? `${routerNote(sel.skipped)} (routers are never tested).`
              : `no inventory host matches those filters${sel.matched ? ' (without name or role only computers are tested: admin, workstation, new)' : ''}.`,
          );
        }
        const kp = await keyProblem();
        const local = localIps();
        const results = await Promise.all(
          sel.hosts.map(async (h) => {
            const target = h.ssh_port === null ? sshTarget(h) : `${sshTarget(h)}:${h.ssh_port}`;
            const skip = sshSkipReason(h);
            if (skip) return { name: h.name, target, ok: false, skipped: true, duration_ms: 0, diagnosis: `skipped: ${skip}` };
            if (kp) return { name: h.name, target, ok: false, skipped: false, duration_ms: 0, diagnosis: kp };
            try {
              const r = await sshExec(h, ['echo', 'TRIMURTI_OK'], { timeoutMs: p.timeout_seconds * 1000 });
              const good = r.code === 0 && /TRIMURTI_OK/.test(r.stdout);
              return {
                name: h.name,
                target,
                ok: good,
                skipped: false,
                duration_ms: r.durationMs,
                diagnosis: good ? 'key login works' : r.timedOut ? 'timed out: ' + diagnose('timed out', h, local) : diagnose(r.stderr, h, local),
              };
            } catch (e) {
              return { name: h.name, target, ok: false, skipped: false, duration_ms: 0, diagnosis: `ssh could not start: ${errorMessage(e)}` };
            }
          }),
        );
        const tried = results.filter((r) => !r.skipped);
        const notSelected = sel.skipped.map((s) => `${s.name}: ${s.reason}`);
        const out = { key_file: KEY_FILE, key_problem: kp, all_ok: tried.length > 0 && tried.every((r) => r.ok), results, not_selected: notSelected };
        const lines = [`key: ${KEY_FILE}${kp ? `\nKEY PROBLEM: ${kp}` : ''}`, '', mdTable(results, ['name', 'target', 'ok', 'duration_ms', 'diagnosis'])];
        if (notSelected.length) lines.push('', ...notSelected.map((n) => `not selected: ${n}`));
        return ok(lines.join('\n'), out);
      } catch (e) {
        return fail(errorMessage(e));
      }
    },
  );

  server.registerTool(
    'trimurti_ssh_run',
    {
      title: 'Run a command on one host',
      description: `Run one command on one inventory host over SSH with the admin key and return its output. This is the general-purpose escape hatch: reading a log, checking a service, listing disks, fetching a version. It can also change things, so prefer trimurti_run_script for the kit's own scripts and keep destructive commands (rm, format, reboot) for when Sanjay has said yes.

Args:
  - name: inventory host name (never the router: a role=router row or this machine's default gateway). The row needs an ssh_port.
  - command: what to run
  - shell: 'default' (the host's login shell: bash/zsh on Unix, cmd or PowerShell on Windows depending on enable-ssh-server.ps1), 'bash' (piped to bash -s), or 'powershell' (run as one script block by Windows PowerShell on Windows, pwsh on Linux and macOS; the text is sent base64-encoded over stdin, so multi-line blocks, quotes and non-ASCII text arrive intact)
  - timeout_seconds (1-600, default 60). On Linux and macOS hosts with GNU timeout a 'default' or 'bash' command is stopped on the host when it runs out; elsewhere it may keep running there, and the hint says so.

Returns: { name, target, exit_code, timed_out, duration_ms, stdout, stderr, hint } (streams capped at 10k characters each, head and tail kept). hint is set only when ssh itself failed (with the fix) or the command timed out; a non-zero exit_code with no hint is the command's own result. With shell 'powershell', exit_code is the script's own \`exit N\`; 1 for a parse error or a terminating error (the error is on stderr); when the last command failed, the last native program's exit code, or 1; else 0.

Notes: no TTY, so sudo cannot prompt and PowerShell runs -NonInteractive (Read-Host and credential prompts fail); use passwordless sudo or run such things locally. shell 'powershell' needs the command in PowerShell syntax.`,
      inputSchema: RunInput,
      outputSchema: RunOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (p) => {
      try {
        const sel = await selectHosts({ name: p.name });
        const host = sel.hosts[0];
        if (!host) {
          return fail(sel.skipped.length ? `${routerNote(sel.skipped)} (routers are never selected).` : `no inventory host named "${p.name}". See trimurti_list_hosts.`);
        }
        const skip = sshSkipReason(host);
        if (skip) return fail(`${host.name}: ${skip}.`);
        const kp = await keyProblem();
        if (kp) return fail(kp);
        const posix = host.os === 'linux' || host.os === 'macos';
        let argv: string[];
        let stdin: string | undefined;
        if (p.shell === 'bash') {
          argv = posix ? [posixWrap(undefined, p.timeout_seconds)] : ['bash', '-s'];
          stdin = p.command;
        } else if (p.shell === 'powershell') {
          ({ argv, stdin } = powershellInvocation(p.command, !posix));
        } else {
          argv = [posix ? posixWrap(p.command, p.timeout_seconds) : p.command];
        }
        const wrapped = posix && p.shell !== 'powershell';
        // the host stops the command itself; the local limit only catches a hung connection
        const opts: { stdin?: string; timeoutMs: number } = { timeoutMs: (p.timeout_seconds + (wrapped ? 15 : 0)) * 1000 };
        if (stdin !== undefined) opts.stdin = stdin;
        const r = await sshExec(host, argv, opts);
        const stoppedThere = wrapped && !r.timedOut && (r.code === 124 || r.code === 137) && r.durationMs >= p.timeout_seconds * 1000 - 500;
        let hint = '';
        if (r.timedOut) hint = `timed out after ${p.timeout_seconds} s; the command may still be running on ${host.name}`;
        else if (stoppedThere) hint = `timed out after ${p.timeout_seconds} s; the command was stopped on ${host.name}`;
        else if (isSshFailure(r.code, r.stderr)) hint = diagnose(r.stderr, host, localIps());
        const out = {
          name: host.name,
          target: `${sshTarget(host)}:${host.ssh_port}`,
          exit_code: r.code,
          timed_out: r.timedOut || stoppedThere,
          duration_ms: r.durationMs,
          // pwsh 7 colours its error lines even with OutputRendering PlainText
          stdout: clipStream(p.shell === 'powershell' ? stripAnsi(r.stdout) : r.stdout),
          stderr: clipStream(p.shell === 'powershell' ? stripAnsi(r.stderr) : r.stderr),
          hint,
        };
        const text = [
          `${host.name} exit ${r.code ?? 'null'}${out.timed_out ? ' (TIMED OUT)' : ''} in ${r.durationMs} ms`,
          out.stdout ? `--- stdout\n${out.stdout}` : '',
          out.stderr ? `--- stderr\n${out.stderr}` : '',
          hint ? `hint: ${hint}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        return ok(text, out);
      } catch (e) {
        return fail(`ssh could not start: ${errorMessage(e)}`);
      }
    },
  );
}
