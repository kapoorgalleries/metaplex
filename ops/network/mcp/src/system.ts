import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IS_WINDOWS, KEY_FILE } from './constants.js';
import { run } from './exec.js';

/**
 * Git Bash on Windows, found explicitly: a default Git for Windows install puts only Git\cmd on
 * PATH, and a bare "bash" can be WSL's System32\bash.exe, which cannot open Windows script paths.
 * Order: TRIMURTI_BASH, <Program Files>\Git\bin\bash.exe, then relative to `git --exec-path`.
 */
export function findGitBash(
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean,
  gitExecPath: () => string,
): string | undefined {
  const w = path.win32;
  const notWsl = (p: string) => !/\\(System32|Sysnative|SysWOW64)\\bash\.exe$/i.test(w.normalize(p));
  if (env.TRIMURTI_BASH && exists(env.TRIMURTI_BASH) && notWsl(env.TRIMURTI_BASH)) return env.TRIMURTI_BASH;
  const roots = [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)'], env.LOCALAPPDATA && w.join(env.LOCALAPPDATA, 'Programs')];
  for (const root of roots) {
    if (!root) continue;
    const p = w.join(root, 'Git', 'bin', 'bash.exe');
    if (exists(p)) return p;
  }
  let exec = '';
  try {
    exec = gitExecPath().trim();
  } catch {
    return undefined;
  }
  if (!exec) return undefined;
  // <git>\mingw64\libexec\git-core (Git for Windows prints it with forward slashes)
  const top = w.resolve(w.normalize(exec), '..', '..', '..');
  for (const p of [w.join(top, 'bin', 'bash.exe'), w.join(top, 'usr', 'bin', 'bash.exe')]) {
    if (exists(p) && notWsl(p)) return p;
  }
  return undefined;
}

let bashCache: string | undefined;

/** The bash that runs the kit's .sh scripts: "bash" on macOS and Linux, Git Bash on Windows. */
export function bashCommand(): string {
  if (!IS_WINDOWS) return 'bash';
  if (bashCache) return bashCache;
  const found = findGitBash(process.env, (p) => fs.existsSync(p), () =>
    execFileSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }),
  );
  if (!found) {
    throw new Error(
      'Git Bash not found (looked for Program Files\\Git\\bin\\bash.exe and next to `git --exec-path`). Install Git for Windows (winget install Git.Git) or set TRIMURTI_BASH to its bash.exe. WSL\'s bash cannot run the kit.',
    );
  }
  bashCache = found;
  return found;
}

/**
 * Git for Windows' usr\bin, where the ssh, ssh-keygen and ssh-add that Git Bash (and so the kit's
 * .sh scripts) run live: next to <git>\bin\bash.exe, or bash's own folder for usr\bin\bash.exe.
 */
export function gitUsrBin(bash: string, exists: (p: string) => boolean): string | undefined {
  const w = path.win32;
  const dir = w.dirname(w.normalize(bash));
  return [w.join(dir, '..', 'usr', 'bin'), dir].find((d) => exists(w.join(d, 'ssh.exe')));
}

let sshDirCache: string | null | undefined;

/**
 * The ssh, ssh-keygen or ssh-add to run: from PATH on macOS and Linux. On Windows Git's own, next to
 * the Git Bash the scripts run in, so this server uses the same key handling, the same ssh-agent
 * (the SSH_AUTH_SOCK launch.ps1 sets is Git's, which Windows' OpenSSH cannot read) and the same
 * known_hosts as the scripts. Windows' own ssh on PATH only when there is no Git Bash.
 */
export function sshTool(name: 'ssh' | 'ssh-keygen' | 'ssh-add'): string {
  if (!IS_WINDOWS) return name;
  if (sshDirCache === undefined) {
    let bash: string | undefined;
    try {
      bash = bashCommand();
    } catch {
      bash = undefined;
    }
    sshDirCache = (bash && gitUsrBin(bash, (p) => fs.existsSync(p))) || null;
  }
  return sshDirCache ? path.win32.join(sshDirCache, `${name}.exe`) : name;
}

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Linux /proc/net/route: default routes (destination 0) with a gateway, little-endian hex. */
export function gatewaysFromProcRoute(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n').slice(1)) {
    const c = line.trim().split(/\s+/);
    const gw = c[2] ?? '';
    if (c[1] !== '00000000' || !/^[0-9A-Fa-f]{8}$/.test(gw) || gw === '00000000') continue;
    out.push([6, 4, 2, 0].map((i) => Number.parseInt(gw.slice(i, i + 2), 16)).join('.'));
  }
  return out;
}

/** `netstat -rn -f inet` (macOS: "default  192.168.1.1  UGScg  en0") or `netstat -rn` (Windows: "0.0.0.0  0.0.0.0  192.168.1.1  ..."). */
export function gatewaysFromNetstat(text: string): string[] {
  return [...text.matchAll(/^(?:default|\s*0\.0\.0\.0\s+0\.0\.0\.0)\s+(\d+\.\d+\.\d+\.\d+)\s/gm)].map((m) => m[1] ?? '');
}

/** Every default gateway of this machine, detected now. Each one is the router, whatever the inventory says. */
export function defaultGateways(): string[] {
  const found: string[] = [];
  try {
    if (process.platform === 'linux') {
      found.push(...gatewaysFromProcRoute(fs.readFileSync('/proc/net/route', 'utf8')));
    } else if (process.platform === 'darwin') {
      found.push(...gatewaysFromNetstat(execFileSync('netstat', ['-rn', '-f', 'inet'], { encoding: 'utf8', timeout: 5000 })));
    } else if (IS_WINDOWS) {
      found.push(...gatewaysFromNetstat(execFileSync('netstat', ['-rn'], { encoding: 'utf8', timeout: 5000, windowsHide: true })));
    }
  } catch {
    // no route table readable: the role=router rows still guard
  }
  return [...new Set(found.filter((g) => IPV4.test(g) && g !== '0.0.0.0'))];
}

/** This machine's IPv4 addresses. */
export function localIps(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4')
    .map((a) => a?.address ?? '');
}

function shownKey(): string {
  return /\s/.test(KEY_FILE) ? `"${KEY_FILE}"` : KEY_FILE;
}

async function keyInAgent(): Promise<boolean> {
  const pub = fs.existsSync(`${KEY_FILE}.pub`) ? `${KEY_FILE}.pub` : KEY_FILE;
  const fp = (await run(sshTool('ssh-keygen'), ['-l', '-f', pub], { timeoutMs: 10000 })).stdout.trim().split(/\s+/)[1];
  if (!fp) return false;
  return (await run(sshTool('ssh-add'), ['-l'], { timeoutMs: 10000 })).stdout.includes(fp);
}

/**
 * What Sanjay does about a locked key, said to this server, which never has a terminal (lib.sh
 * key_problem without a TTY): the launcher loads the key into an ssh-agent before the AI agent
 * starts, and this server inherits it. It never starts an agent or asks for a passphrase itself.
 */
export function lockedKeyHint(k: string, platform: NodeJS.Platform, agentCode: number | null, sock: string | undefined): string {
  const launcher = platform === 'win32' ? 'launch.ps1' : 'launch.sh';
  if (platform === 'darwin') return `this MCP server has no terminal for the passphrase: Sanjay runs ssh-add --apple-use-keychain ${k} in any terminal, or reruns ${launcher}`;
  if (platform !== 'win32' && agentCode !== 2 && sock) {
    return `this MCP server has no terminal for the passphrase: Sanjay reruns ${launcher}, or adds it to this server's agent from any terminal: SSH_AUTH_SOCK='${sock}' ssh-add ${k}`;
  }
  const what = agentCode === 2 ? 'has no ssh-agent and no terminal for the passphrase' : 'has no terminal for the passphrase';
  return `this MCP server ${what}: Sanjay reruns ${launcher}, which loads the key and starts the agent session with it`;
}

/**
 * Why ssh cannot use the admin key without a prompt, or '' when it can (lib.sh key_problem).
 * A passphrase-protected key must be in an ssh-agent; on macOS the Keychain is tried first.
 */
export async function keyProblem(): Promise<string> {
  const k = shownKey();
  if (!fs.existsSync(KEY_FILE)) return `admin key not found: ${k} (run scripts/ssh-keys.sh in a terminal first, or set KEY_FILE)`;
  try {
    const r = await run(sshTool('ssh-keygen'), ['-y', '-P', '', '-f', KEY_FILE], { timeoutMs: 10000 });
    if (r.code === 0) return '';
    const err = `${r.stderr}\n${r.stdout}`;
    if (!/passphrase/i.test(err)) {
      const lines = err.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const why = lines.find((l) => /Load key|bad permissions|too open|invalid format/i.test(l)) ?? lines.at(-1) ?? `ssh-keygen exit ${r.code}`;
      const fix = /too open|bad permissions/i.test(err) ? (IS_WINDOWS ? ' (only your user may read it)' : ` (chmod 600 ${k})`) : '';
      return `admin key ${k} is unusable: ${why}${fix}`;
    }
    if (await keyInAgent()) return '';
    if (process.platform === 'darwin') {
      const r2 = await run('ssh-add', ['--apple-load-keychain'], { timeoutMs: 10000 });
      if (r2.code !== 0) await run('ssh-add', ['-A'], { timeoutMs: 10000 });
      if (await keyInAgent()) return '';
    }
    const agent = await run(sshTool('ssh-add'), ['-l'], { timeoutMs: 10000 });
    const msg = `key is passphrase-protected and no ssh-agent holds it: run ssh-add ${k}`;
    return `${msg} (${lockedKeyHint(k, process.platform, agent.code, process.env.SSH_AUTH_SOCK)})`;
  } catch {
    return ''; // no ssh-keygen/ssh-add here: let ssh itself report
  }
}
