import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { KEY_FILE, SSH_BASE_OPTS } from '../constants.js';
import { run } from '../exec.js';
import { sshableHosts, sshTarget, type Host } from '../inventory.js';
import { clipStream, errorMessage, fail, mdTable, ok } from '../result.js';
import { FilterFields } from './inventory.js';

/** Turn ssh's stderr into the fix from README "SSH troubleshooting". */
export function diagnose(stderr: string, host: Host): string {
  const s = stderr;
  if (/Permission denied/i.test(s)) {
    return host.os === 'windows'
      ? 'key rejected. Windows administrators are read from C:\\ProgramData\\ssh\\administrators_authorized_keys, ACL Administrators+SYSTEM only (README troubleshooting 1). Push again with scripts/ssh-keys.sh --host ' +
          host.name
      : 'key rejected: ~/.ssh must be 700, authorized_keys 600, and the home dir not group-writable (README troubleshooting 5). Push again with scripts/ssh-keys.sh --host ' +
          host.name;
  }
  if (/timed out|No route to host|Network is unreachable/i.test(s)) {
    return 'no answer on the port: machine off, IP moved (set a DHCP reservation, fix the inventory), or a Windows Public network profile blocking inbound (README troubleshooting 2 and 4).';
  }
  if (/Connection refused/i.test(s)) {
    return 'port is closed: sshd is not running. Run enable-ssh-server on that machine once, locally (README "Windows: the one thing that cannot be done remotely").';
  }
  if (/HOST IDENTIFICATION HAS CHANGED/i.test(s)) {
    return `host key changed (reinstalled machine?). On the admin machine: ssh-keygen -R ${host.ip || host.name}`;
  }
  if (/Could not resolve hostname/i.test(s)) {
    return 'name does not resolve: set ip in the inventory (trimurti_upsert_host) or run scripts/ssh-config-gen.sh.';
  }
  if (/identity file .* not accessible|No such file or directory/i.test(s)) {
    return `admin key missing at ${KEY_FILE}. Run scripts/ssh-keys.sh once from a terminal (it asks each host's password) or set KEY_FILE.`;
  }
  return s.trim().split(/\r?\n/).slice(-2).join(' ') || 'unknown failure';
}

async function sshExec(
  host: Host,
  command: string[],
  opts: { stdin?: string; timeoutMs: number },
): Promise<Awaited<ReturnType<typeof run>>> {
  const args = [...SSH_BASE_OPTS, '-o', 'ConnectTimeout=8', '-p', String(host.ssh_port), sshTarget(host), ...command];
  const runOpts: Parameters<typeof run>[2] = { timeoutMs: opts.timeoutMs };
  if (opts.stdin !== undefined) runOpts.stdin = opts.stdin;
  return run('ssh', args, runOpts);
}

const TestInput = z
  .object({
    ...FilterFields,
    timeout_seconds: z.number().int().min(3).max(60).default(12).describe('Per host'),
  })
  .strict();

const TestOutput = z.object({
  key_file: z.string(),
  all_ok: z.boolean(),
  results: z.array(
    z.object({
      name: z.string(),
      target: z.string(),
      ok: z.boolean(),
      duration_ms: z.number(),
      diagnosis: z.string(),
    }),
  ),
});

const RunInput = z
  .object({
    name: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
      .describe('Inventory name of the host to run on'),
    command: z.string().min(1).max(4000).describe('The command line to run on that host'),
    shell: z
      .enum(['default', 'bash', 'powershell'])
      .default('default')
      .describe("'default' hands the string to the host's login shell; 'bash' or 'powershell' feed it to that interpreter over stdin (multi-line ok)"),
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
});

export function registerSshTools(server: McpServer): void {
  server.registerTool(
    'trimurti_test_ssh',
    {
      title: 'Test key-only SSH login',
      description: `Prove that the admin key logs into each selected inventory host without a password (ssh -o BatchMode=yes, PasswordAuthentication=no). For every failure it returns a diagnosis that names the fix from README "SSH troubleshooting". Read-only; never pushes keys (scripts/ssh-keys.sh does that, from a terminal, because the first push needs the host's password).

Args: the inventory filters (name, os, role, trimurti) and timeout_seconds per host (default 12). No filter = every host except role=router.

Returns: { key_file, all_ok, results: [{ name, target, ok, duration_ms, diagnosis }] }.`,
      inputSchema: TestInput,
      outputSchema: TestOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (p) => {
      try {
        const hosts = await sshableHosts({ name: p.name, os: p.os, role: p.role, trimurti: p.trimurti });
        if (!hosts.length) return fail('no inventory host matches those filters (routers are never tested).');
        const results = await Promise.all(
          hosts.map(async (h) => {
            try {
              const r = await sshExec(h, ['echo', 'TRIMURTI_OK'], { timeoutMs: p.timeout_seconds * 1000 });
              const good = r.code === 0 && /TRIMURTI_OK/.test(r.stdout);
              return {
                name: h.name,
                target: `${sshTarget(h)}:${h.ssh_port}`,
                ok: good,
                duration_ms: r.durationMs,
                diagnosis: good ? 'key login works' : r.timedOut ? 'timed out: ' + diagnose('timed out', h) : diagnose(r.stderr, h),
              };
            } catch (e) {
              return { name: h.name, target: sshTarget(h), ok: false, duration_ms: 0, diagnosis: `ssh could not start: ${errorMessage(e)}` };
            }
          }),
        );
        const out = { key_file: KEY_FILE, all_ok: results.every((r) => r.ok), results };
        return ok(`key: ${KEY_FILE}\n\n${mdTable(results, ['name', 'target', 'ok', 'duration_ms', 'diagnosis'])}`, out);
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
  - name: inventory host name (never the router)
  - command: what to run
  - shell: 'default' (the host's login shell: bash/zsh on Unix, cmd or PowerShell on Windows depending on enable-ssh-server.ps1), 'bash' or 'powershell' (the command is piped to that interpreter, so multi-line scripts work)
  - timeout_seconds (1-600, default 60)

Returns: { name, target, exit_code, timed_out, duration_ms, stdout, stderr } (streams capped at 10k characters each).

Notes: no TTY, so sudo cannot prompt; use passwordless sudo or run such things locally. Windows PowerShell as shell needs the command in PowerShell syntax.`,
      inputSchema: RunInput,
      outputSchema: RunOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (p) => {
      try {
        const host = (await sshableHosts({ name: p.name }))[0];
        if (!host) return fail(`no inventory host named "${p.name}" (or it is the router). See trimurti_list_hosts.`);
        let argv: string[];
        let stdin: string | undefined;
        if (p.shell === 'bash') {
          argv = ['bash', '-s'];
          stdin = p.command;
        } else if (p.shell === 'powershell') {
          argv = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'];
          stdin = p.command;
        } else {
          argv = [p.command];
        }
        const opts: { stdin?: string; timeoutMs: number } = { timeoutMs: p.timeout_seconds * 1000 };
        if (stdin !== undefined) opts.stdin = stdin;
        const r = await sshExec(host, argv, opts);
        const out = {
          name: host.name,
          target: `${sshTarget(host)}:${host.ssh_port}`,
          exit_code: r.code,
          timed_out: r.timedOut,
          duration_ms: r.durationMs,
          stdout: clipStream(r.stdout),
          stderr: clipStream(r.stderr),
        };
        const text = [
          `${host.name} exit ${r.code ?? 'null'}${r.timedOut ? ' (TIMED OUT)' : ''} in ${r.durationMs} ms`,
          out.stdout ? `--- stdout\n${out.stdout}` : '',
          out.stderr ? `--- stderr\n${out.stderr}` : '',
          r.code !== 0 && !r.stdout ? `hint: ${diagnose(r.stderr, host)}` : '',
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
