import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { OUT_DIR } from './constants.js';

export interface RunOptions {
  timeoutMs: number;
  stdin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/** Run a program with an argv array (never a shell string), a timeout and capped output. */
export function run(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const max = opts.maxOutputBytes ?? 2_000_000;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < max) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < max) stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 3000).unref();
    }, opts.timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, durationMs: Date.now() - started });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.stdin ?? '');
  });
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

/* ---------------------------------------------------------------- jobs */

export interface Job {
  id: string;
  script: string;
  command: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  logFile: string;
}

const jobs = new Map<string, Job>();

/** Start a long-running command whose output goes to a log file; poll it with getJob. */
export async function startJob(script: string, cmd: string, args: string[]): Promise<Job> {
  const dir = path.join(OUT_DIR, 'logs', 'jobs');
  await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const id = `${stamp}-${randomBytes(2).toString('hex')}`;
  const logFile = path.join(dir, `${id}-${script}.log`);
  const fd = fs.openSync(logFile, 'a');
  const job: Job = {
    id,
    script,
    command: [cmd, ...args].join(' '),
    startedAt: new Date().toISOString(),
    logFile,
  };
  jobs.set(id, job);
  const child = spawn(cmd, args, { stdio: ['ignore', fd, fd], windowsHide: true, env: process.env });
  fs.closeSync(fd);
  child.on('error', (e) => {
    fs.appendFileSync(logFile, `\n[job error] ${e.message}\n`);
    job.exitCode = -1;
    job.finishedAt = new Date().toISOString();
  });
  child.on('close', (code) => {
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
  });
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/** Last `lines` lines of a file, reading at most the final 512 KB. */
export async function tailFile(file: string, lines: number): Promise<string> {
  let handle: fsp.FileHandle | undefined;
  try {
    handle = await fsp.open(file, 'r');
    const { size } = await handle.stat();
    const span = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(span);
    await handle.read(buf, 0, span, size - span);
    const all = stripAnsi(buf.toString('utf8')).split(/\r?\n/);
    return all.slice(-lines).join('\n');
  } catch {
    return '';
  } finally {
    await handle?.close();
  }
}
