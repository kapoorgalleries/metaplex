import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { REMOTE_SCRIPTS, SCRIPTS_DIR } from '../constants.js';
import { getJob, listJobs, run, startJob, stripAnsi, tailFile } from '../exec.js';
import { isComputer, listHosts, selectHosts, sshSkipReason, type HostFilter } from '../inventory.js';
import { clipStream, errorMessage, fail, mdTable, ok, parseMdTable } from '../result.js';
import { bashCommand, keyProblem } from '../system.js';
import { FilterFields } from './inventory.js';

const ARG = /^[A-Za-z0-9._=:\\/-]{1,120}$/;

function filterArgs(p: HostFilter): string[] {
  const a: string[] = [];
  if (p.name) a.push('--host', p.name);
  if (p.os) a.push('--os', p.os);
  if (p.role) a.push('--role', p.role);
  if (p.trimurti) a.push('--trimurti', p.trimurti);
  return a;
}

/** run-remote.sh's closing lines (C4): TRIMURTI_SUMMARY passed=a,b / failed=... / reboot_required=... The last of each wins. */
export function parseSummary(log: string): { found: boolean; passed: string[]; failed: string[]; reboot_required: string[] } {
  const out = { found: false, passed: [] as string[], failed: [] as string[], reboot_required: [] as string[] };
  for (const m of log.matchAll(/^TRIMURTI_SUMMARY (passed|failed|reboot_required)=(.*?)\r?$/gm)) {
    out.found = true;
    out[m[1] as 'passed' | 'failed' | 'reboot_required'] = (m[2] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  }
  return out;
}

/** The inventory row's own spelling of a host name (lib.sh matches names exactly; MCP in any case). */
async function rowName(name: string | undefined): Promise<string | undefined> {
  if (!name) return undefined;
  return (await listHosts({ name }))[0]?.name ?? name;
}

const RunScriptInput = z
  .object({
    script: z.enum(REMOTE_SCRIPTS).describe('Which kit script to push and run on each selected host'),
    ...FilterFields,
    args: z
      .array(z.string().regex(ARG, 'flags only: letters, digits, . _ = : / -, no spaces or quotes'))
      .max(8)
      .default([])
      .describe("Arguments for the script, e.g. ['--skip-gemini'] or ['-WithGit']. --harden is refused here"),
  })
  .strict();

const JobSchema = z.object({
  job_id: z.string(),
  script: z.string(),
  command: z.string(),
  started_at: z.string(),
  finished_at: z.string().optional(),
  status: z.enum(['running', 'finished']),
  exit_code: z.number().nullable().optional(),
  log_file: z.string(),
});

const RunScriptOutput = z.object({
  job: JobSchema,
  hosts: z.array(z.string()),
  skipped: z.array(z.string()),
});

const GetJobInput = z
  .object({
    job_id: z.string().regex(/^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/, 'a job id from trimurti_run_script'),
    tail_lines: z.number().int().min(1).max(500).default(80),
  })
  .strict();

const GetJobOutput = z.object({
  job: JobSchema,
  summary_found: z.boolean(),
  passed: z.array(z.string()),
  failed: z.array(z.string()),
  reboot_required: z.array(z.string()),
  log_tail: z.string(),
});

const ListJobsOutput = z.object({ jobs: z.array(JobSchema) });

const VerifyInput = z
  .object({
    ...FilterFields,
    timeout_seconds: z.number().int().min(30).max(900).default(240).describe('For the whole run; about 10-20 s per host'),
  })
  .strict();

const VerifyRow = z.object({
  host: z.string(),
  ping: z.string(),
  ssh_key: z.string(),
  claude: z.string(),
  codex: z.string(),
  gemini: z.string(),
  node: z.string(),
  os: z.string(),
});

const VerifyOutput = z.object({
  md_file: z.string(),
  exit_code: z.number().nullable(),
  all_green: z.boolean(),
  key_problem: z.string(),
  problems: z.array(z.string()),
  rows: z.array(VerifyRow),
});

function jobView(j: NonNullable<ReturnType<typeof getJob>>) {
  return {
    job_id: j.id,
    script: j.script,
    command: j.command,
    started_at: j.startedAt,
    ...(j.finishedAt ? { finished_at: j.finishedAt } : {}),
    status: j.finishedAt ? ('finished' as const) : ('running' as const),
    ...(j.finishedAt ? { exit_code: j.exitCode ?? null } : {}),
    log_file: j.logFile,
  };
}

export function registerScriptTools(server: McpServer): void {
  server.registerTool(
    'trimurti_run_script',
    {
      title: 'Run a kit script on hosts',
      description: `Push one of the kit's scripts to every selected inventory host and run it there, choosing the .sh or .ps1 variant per host OS (this is scripts/run-remote.sh). The run happens in the background: you get a job_id at once and poll it with trimurti_get_job, because installs and OS updates take minutes.

Scripts:
  - bootstrap-ai-clis: Node 20+, Claude Code, Codex CLI, Gemini CLI (args: --skip-claude/--skip-codex/--skip-gemini/--skip-node; Windows: -SkipClaude/-SkipCodex/-SkipGemini/-SkipNode/-WithGit)
  - update-all: OS packages, Homebrew/winget, Windows Update, the CLIs; never reboots, ends with REBOOT_REQUIRED=yes|no|unknown (args: --no-os/--no-clis; Windows -NoOS/-NoCLIs)
  - enable-ssh-server: sshd on + firewall (only useful once a host is already reachable, e.g. -Pwsh7 on Windows). --harden (password logins off) is refused here: it needs Sanjay's yes and a terminal
  - disk-triage: read-only disk and SMART report on that host (for the Hulk drives)

Args: script, the inventory filters, args (flags without spaces). Without name or role it runs on computers only (role admin, workstation, new); a nas, printer or iot row runs only when named or selected by role. The router (role=router, or this machine's default gateway) is never selected, even by name. Rows with a blank ssh_port (no SSH) are skipped.

Returns: { job: { job_id, status, log_file, ... }, hosts: [names it runs on], skipped: ['name: why'] }.

Needs key login to each host first (trimurti_test_ssh); a missing or locked admin key is reported before anything starts. No TTY: on Linux hosts where sudo needs a password, update-all and bootstrap stop at the sudo step with "sudo needs a password on <host>"; run those locally with --tty via a terminal, or set up passwordless sudo.`,
      inputSchema: RunScriptInput,
      outputSchema: RunScriptOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (p) => {
      try {
        if (p.args.some((a) => /harden/i.test(a))) {
          return fail('--harden turns password logins off, which AGENTS.md reserves for Sanjay\'s explicit yes. It is not run through MCP: after he says yes, give him the command for a terminal (scripts/run-remote.sh --host <name> --tty enable-ssh-server --harden).');
        }
        const sel = await selectHosts({ name: p.name, os: p.os, role: p.role, trimurti: p.trimurti });
        const skipped = sel.skipped.map((s) => `${s.name}: ${s.reason}`);
        const hosts = sel.hosts.filter((h) => {
          const why = sshSkipReason(h);
          if (why) skipped.push(`${h.name}: ${why}`);
          return !why;
        });
        if (!hosts.length) {
          const why = skipped.length ? skipped.join('; ') : 'no inventory host matches those filters';
          return fail(`${why}. Nothing started (routers are never selected; without name or role only computers are).`);
        }
        const kp = await keyProblem();
        if (kp) return fail(`${kp}. Nothing started.`);
        // exactly the hosts listed here; run-remote.sh applies its own router guard again
        const args = [path.join(SCRIPTS_DIR, 'run-remote.sh'), '--host', hosts.map((h) => h.name).join(','), p.script, ...p.args];
        const job = await startJob(p.script, bashCommand(), args);
        const out = { job: jobView(job), hosts: hosts.map((h) => h.name), skipped };
        return ok(
          `started job ${job.id}: ${p.script} on ${out.hosts.join(', ')}${skipped.length ? `\nskipped: ${skipped.join('; ')}` : ''}\nlog: ${job.logFile}\nPoll with trimurti_get_job.`,
          out,
        );
      } catch (e) {
        return fail(`could not start run-remote.sh: ${errorMessage(e)}`);
      }
    },
  );

  server.registerTool(
    'trimurti_get_job',
    {
      title: 'Get a script job',
      description: `Status and log tail of a job started by trimurti_run_script. When finished, lists which hosts passed and failed and which need a reboot, read only from run-remote.sh's closing TRIMURTI_SUMMARY lines (a host needs a reboot when its own run printed REBOOT_REQUIRED=yes). summary_found is false when run-remote.sh stopped before its summary; then read the log tail.

Args: job_id, tail_lines (1-500, default 80).
Returns: { job, summary_found, passed[], failed[], reboot_required[], log_tail }.`,
      inputSchema: GetJobInput,
      outputSchema: GetJobOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (p) => {
      const job = getJob(p.job_id);
      if (!job) return fail(`unknown job ${p.job_id}. Jobs live in this server process; see trimurti_list_jobs. Older logs are under out/logs/jobs/.`);
      const tail = await tailFile(job.logFile, p.tail_lines);
      const sum = job.finishedAt
        ? parseSummary(stripAnsi(await fsp.readFile(job.logFile, 'utf8').catch(() => '')))
        : { found: false, passed: [], failed: [], reboot_required: [] };
      const out = {
        job: jobView(job),
        summary_found: sum.found,
        passed: sum.passed,
        failed: sum.failed,
        reboot_required: sum.reboot_required,
        log_tail: clipStream(tail),
      };
      const head = `${job.id} ${out.job.status}${job.finishedAt ? ` (exit ${job.exitCode ?? 'null'})` : ''}: ${job.script}`;
      const result = !job.finishedAt
        ? 'still running'
        : sum.found
          ? `passed: ${out.passed.join(' ') || '-'}   failed: ${out.failed.join(' ') || '-'}   reboot: ${out.reboot_required.join(' ') || '-'}`
          : 'run-remote.sh printed no TRIMURTI_SUMMARY: it stopped before running the hosts; see the log tail';
      return ok(`${head}\n${result}\n--- log tail\n${out.log_tail}`, out);
    },
  );

  server.registerTool(
    'trimurti_list_jobs',
    {
      title: 'List script jobs',
      description: 'Jobs started by trimurti_run_script in this server process, newest first, with status and log file. Returns { jobs: [...] }.',
      inputSchema: z.object({}).strict(),
      outputSchema: ListJobsOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const jobs = listJobs().map(jobView);
      return ok(mdTable(jobs, ['job_id', 'script', 'status', 'exit_code', 'started_at', 'log_file']), { jobs });
    },
  );

  server.registerTool(
    'trimurti_verify_hosts',
    {
      title: 'Verify the end state',
      description: `The done-check for the whole network: for each selected host, ping, key-only SSH login, and the installed versions of claude, codex, gemini and node, plus the OS string. Runs scripts/verify.sh and returns the table it saves. Read-only.

Args: inventory filters (name/os/role/trimurti) and timeout_seconds (default 240).
Returns: { md_file, exit_code, all_green, key_problem, problems: ['host: what is wrong', ...], rows: [{ host, ping, ssh_key, claude, codex, gemini, node, os }] }.

Every inventory row except the router is listed; only computers (role admin, workstation, new) need the CLIs and count for all_green, other rows show n/a. all_green means every selected computer pings, accepts the key (or is this machine, probed locally), has all three CLIs, and node 20 or newer. Paste rows into status.md.`,
      inputSchema: VerifyInput,
      outputSchema: VerifyOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (p) => {
      try {
        const name = await rowName(p.name);
        const sel = await selectHosts({ name, os: p.os, role: p.role, trimurti: p.trimurti }, { devices: true });
        if (!sel.hosts.length) {
          const why = sel.skipped.length ? sel.skipped.map((s) => `${s.name}: skipped, ${s.reason}`).join('; ') : 'no inventory host matches those filters';
          return fail(`${why} (routers are never selected).`);
        }
        const kp = await keyProblem();
        const args = [path.join(SCRIPTS_DIR, 'verify.sh'), ...filterArgs({ name, os: p.os, role: p.role, trimurti: p.trimurti })];
        const r = await run(bashCommand(), args, { timeoutMs: p.timeout_seconds * 1000 });
        const text = stripAnsi(r.stdout + '\n' + r.stderr);
        if (r.timedOut) return fail(`verify.sh did not finish in ${p.timeout_seconds}s. Narrow the filters or raise timeout_seconds.`);
        const md = /saved:\s+(.+?\.md)\s*$/m.exec(text)?.[1];
        if (!md) return fail(`verify.sh produced no table. Output:\n${clipStream(text)}`);
        const raw = parseMdTable(await fsp.readFile(md, 'utf8'));
        const rows = raw.map((row) => ({
          host: row.host ?? '',
          ping: row.ping ?? '',
          ssh_key: row['ssh key'] ?? '',
          claude: row.claude ?? '',
          codex: row.codex ?? '',
          gemini: row.gemini ?? '',
          node: row.node ?? '',
          os: row.os ?? '',
        }));
        const computers = new Set(sel.hosts.filter((h) => isComputer(h.role)).map((h) => h.name));
        const problems: string[] = [];
        if (kp) problems.push(`admin key: ${kp}`);
        for (const row of rows) {
          if (!computers.has(row.host)) continue;
          const bad: string[] = [];
          if (row.ping !== 'yes') bad.push('no ping');
          if (row.ssh_key === 'NO') bad.push('key login fails');
          else if (row.ssh_key !== 'yes' && row.ssh_key !== 'n/a') bad.push(row.ssh_key || 'key login not tried');
          for (const k of ['claude', 'codex', 'gemini', 'node'] as const) {
            if (row[k] === 'missing' || row[k] === '-' || row[k] === '') bad.push(`${k} missing`);
            else if (row[k].startsWith('error:')) bad.push(`${k} does not run`);
          }
          const major = /^v?(\d+)\./.exec(row.node)?.[1];
          if (major && Number(major) < 20) bad.push(`node ${row.node} is too old (need 20+)`);
          if (bad.length) problems.push(`${row.host}: ${bad.join(', ')}`);
        }
        if (r.code !== 0 && !problems.length) problems.push(`verify.sh exited ${r.code}: see its output`);
        const counted = rows.filter((row) => computers.has(row.host)).length;
        const out = { md_file: md, exit_code: r.code, all_green: counted > 0 && problems.length === 0 && r.code === 0, key_problem: kp, problems, rows };
        const summary = out.all_green
          ? `ALL GREEN (${counted} computer(s))`
          : counted === 0
            ? 'no computer selected, so nothing counts toward the verdict'
            : `${problems.length} problem(s)`;
        const others = rows.filter((row) => !computers.has(row.host)).map((row) => row.host);
        return ok(
          `${summary} (${md})\n\n${mdTable(rows, ['host', 'ping', 'ssh_key', 'claude', 'codex', 'gemini', 'node', 'os'])}\n\n${problems.map((x) => `- ${x}`).join('\n')}${others.length ? `\nnot counted (not a computer): ${others.join(', ')}` : ''}`,
          out,
        );
      } catch (e) {
        return fail(`could not run verify.sh: ${errorMessage(e)}`);
      }
    },
  );
}
