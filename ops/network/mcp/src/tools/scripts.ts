import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { REMOTE_SCRIPTS, SCRIPTS_DIR } from '../constants.js';
import { getJob, listJobs, run, startJob, stripAnsi, tailFile } from '../exec.js';
import { sshableHosts } from '../inventory.js';
import { clipStream, errorMessage, fail, mdTable, ok, parseMdTable } from '../result.js';
import { FilterFields } from './inventory.js';

const ARG = /^[A-Za-z0-9._=:\\/-]{1,120}$/;

function filterArgs(p: { name?: string | undefined; os?: string | undefined; role?: string | undefined; trimurti?: string | undefined }): string[] {
  const a: string[] = [];
  if (p.name) a.push('--host', p.name);
  if (p.os) a.push('--os', p.os);
  if (p.role) a.push('--role', p.role);
  if (p.trimurti) a.push('--trimurti', p.trimurti);
  return a;
}

const RunScriptInput = z
  .object({
    script: z.enum(REMOTE_SCRIPTS).describe('Which kit script to push and run on each selected host'),
    ...FilterFields,
    args: z
      .array(z.string().regex(ARG, 'flags only: letters, digits, . _ = : / -, no spaces or quotes'))
      .max(8)
      .default([])
      .describe("Arguments for the script, e.g. ['--skip-gemini'] or ['-WithGit']"),
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
});

const GetJobInput = z
  .object({
    job_id: z.string().regex(/^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/, 'a job id from trimurti_run_script'),
    tail_lines: z.number().int().min(1).max(500).default(80),
  })
  .strict();

const GetJobOutput = z.object({
  job: JobSchema,
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
  all_green: z.boolean(),
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
  - update-all: OS packages, Homebrew/winget, Windows Update, the CLIs; never reboots (args: --no-os/--no-clis; Windows -NoOS/-NoCLIs)
  - enable-ssh-server: sshd on + firewall (only useful once a host is already reachable, e.g. to add --harden on Linux/macOS, or -Pwsh7 on Windows)
  - disk-triage: read-only disk and SMART report on that host (for the Hulk drives)

Args: script, the inventory filters (name/os/role/trimurti; none = all hosts except routers), args (flags without spaces).

Returns: { job: { job_id, status, log_file, ... }, hosts: [names] }.

Needs key login to each host first (trimurti_test_ssh). No TTY: on Linux hosts where sudo needs a password, update-all and bootstrap will fail at the sudo step; run those locally with --tty via a terminal, or set up passwordless sudo.`,
      inputSchema: RunScriptInput,
      outputSchema: RunScriptOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (p) => {
      try {
        const hosts = await sshableHosts({ name: p.name, os: p.os, role: p.role, trimurti: p.trimurti });
        if (!hosts.length) return fail('no inventory host matches those filters.');
        const args = [path.join(SCRIPTS_DIR, 'run-remote.sh'), ...filterArgs(p), p.script, ...p.args];
        const job = await startJob(p.script, 'bash', args);
        const out = { job: jobView(job), hosts: hosts.map((h) => h.name) };
        return ok(
          `started job ${job.id}: ${p.script} on ${hosts.map((h) => h.name).join(', ')}\nlog: ${job.logFile}\nPoll with trimurti_get_job.`,
          out,
        );
      } catch (e) {
        return fail(`could not start run-remote.sh: ${errorMessage(e)} (needs bash on the admin machine)`);
      }
    },
  );

  server.registerTool(
    'trimurti_get_job',
    {
      title: 'Get a script job',
      description: `Status and log tail of a job started by trimurti_run_script. When finished, also lists which hosts passed and failed (from run-remote.sh's summary) and which hosts printed REBOOT_REQUIRED=yes.

Args: job_id, tail_lines (1-500, default 80).
Returns: { job, passed[], failed[], reboot_required[], log_tail }.`,
      inputSchema: GetJobInput,
      outputSchema: GetJobOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (p) => {
      const job = getJob(p.job_id);
      if (!job) return fail(`unknown job ${p.job_id}. Jobs live in this server process; see trimurti_list_jobs. Older logs are under out/logs/jobs/.`);
      const tail = await tailFile(job.logFile, p.tail_lines);
      const full = stripAnsi(await fsp.readFile(job.logFile, 'utf8').catch(() => ''));
      const list = (label: string) =>
        (new RegExp(`${label}:\\s*(.*)$`, 'm').exec(full)?.[1] ?? '')
          .split(/\s+/)
          .filter((s) => s && s !== 'none');
      const rebootHosts = [...full.matchAll(/^\[\d\d:\d\d:\d\d\]\s+(\S+): .*?\n(?:[^\n]*\n)*?REBOOT_REQUIRED=yes/gm)].map((m) => m[1] ?? '');
      const out = {
        job: jobView(job),
        passed: job.finishedAt ? list('passed') : [],
        failed: job.finishedAt ? list('failed') : [],
        reboot_required: [...new Set(rebootHosts)],
        log_tail: clipStream(tail),
      };
      const head = `${job.id} ${out.job.status}${job.finishedAt ? ` (exit ${job.exitCode ?? 'null'})` : ''}: ${job.script}`;
      return ok(`${head}\npassed: ${out.passed.join(' ') || '-'}   failed: ${out.failed.join(' ') || '-'}   reboot: ${out.reboot_required.join(' ') || '-'}\n--- log tail\n${out.log_tail}`, out);
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
Returns: { md_file, all_green, problems: ['host: what is wrong', ...], rows: [{ host, ping, ssh_key, claude, codex, gemini, node, os }] }.

all_green means every selected host pings, accepts the key, and has all three CLIs and node present. Paste rows into status.md.`,
      inputSchema: VerifyInput,
      outputSchema: VerifyOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (p) => {
      try {
        const args = [path.join(SCRIPTS_DIR, 'verify.sh'), ...filterArgs(p)];
        const r = await run('bash', args, { timeoutMs: p.timeout_seconds * 1000 });
        const text = stripAnsi(r.stdout + '\n' + r.stderr);
        if (r.timedOut) return fail(`verify.sh did not finish in ${p.timeout_seconds}s. Narrow the filters or raise timeout_seconds.`);
        const md = /saved:\s+(\S+\.md)/.exec(text)?.[1];
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
        const problems: string[] = [];
        for (const row of rows) {
          const bad: string[] = [];
          if (row.ping !== 'yes') bad.push('no ping');
          if (row.ssh_key !== 'yes') bad.push('key login fails');
          for (const k of ['claude', 'codex', 'gemini', 'node'] as const) {
            if (row[k] === 'missing' || row[k] === '-' || row[k] === '') bad.push(`${k} missing`);
          }
          if (bad.length) problems.push(`${row.host}: ${bad.join(', ')}`);
        }
        const out = { md_file: md, all_green: rows.length > 0 && problems.length === 0, problems, rows };
        const summary = out.all_green ? 'ALL GREEN' : `${problems.length} host(s) with problems`;
        return ok(`${summary} (${md})\n\n${mdTable(rows, ['host', 'ping', 'ssh_key', 'claude', 'codex', 'gemini', 'node', 'os'])}\n\n${problems.map((x) => `- ${x}`).join('\n')}`, out);
      } catch (e) {
        return fail(`could not run verify.sh: ${errorMessage(e)} (needs bash on the admin machine)`);
      }
    },
  );
}
