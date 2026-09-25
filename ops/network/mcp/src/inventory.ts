import fsp from 'node:fs/promises';
import { INVENTORY } from './constants.js';
import { defaultGateways } from './system.js';

export interface Host {
  name: string;
  ip: string;
  mac: string;
  os: string;
  user: string;
  role: string;
  /** null = blank in the CSV: the device has no SSH (22 must be written out). */
  ssh_port: number | null;
  trimurti: string;
  notes: string;
}

export interface HostFilter {
  name?: string | undefined;
  os?: string | undefined;
  role?: string | undefined;
  trimurti?: string | undefined;
}

export const HEADER = 'name,ip,mac,os,user,role,ssh_port,trimurti,notes';
const COLUMNS = HEADER.split(',');

interface InventoryFile {
  lines: string[];
  eol: string;
  headerIndex: number;
  hosts: Host[];
  rowIndex: Map<string, number>; // lowercased host name -> line index
}

function isData(line: string): boolean {
  return line.trim() !== '' && !line.trimStart().startsWith('#');
}

function parseRow(line: string): Host | undefined {
  const parts = line.split(',');
  if (parts.length < 2 || !parts[0]?.trim()) return undefined;
  const fields = parts.slice(0, COLUMNS.length - 1).map((f) => f.trim());
  const notes = parts.slice(COLUMNS.length - 1).join(',').trim(); // notes is last; tolerate stray commas
  while (fields.length < COLUMNS.length - 1) fields.push('');
  const rawPort = fields[6] ?? '';
  const port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : NaN;
  return {
    name: fields[0] ?? '',
    ip: fields[1] ?? '',
    mac: (fields[2] ?? '').toLowerCase(),
    os: (fields[3] ?? '').toLowerCase(),
    user: fields[4] ?? '',
    role: (fields[5] ?? '').toLowerCase(),
    ssh_port: port >= 1 && port <= 65535 ? port : null,
    trimurti: (fields[7] ?? '').toLowerCase(),
    notes,
  };
}

async function readFile(): Promise<InventoryFile> {
  let text: string;
  try {
    text = await fsp.readFile(INVENTORY, 'utf8');
  } catch {
    throw new Error(
      `inventory not found at ${INVENTORY}. Copy ops/network/inventory.csv into place or set TRIMURTI_OPS_DIR.`,
    );
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const headerIndex = lines.findIndex(isData);
  const header = (lines[headerIndex] ?? '').toLowerCase().replace(/\s*,\s*/g, ',').trim();
  // Without this check a lost header line would silently turn the first host into the header.
  if (headerIndex < 0 || !header.startsWith('name,ip,mac,os,user,role,ssh_port,trimurti')) {
    throw new Error(`inventory header missing: the first line that is not a comment must be ${HEADER} (${INVENTORY})`);
  }
  const hosts: Host[] = [];
  const rowIndex = new Map<string, number>();
  lines.forEach((line, i) => {
    if (i <= headerIndex || !isData(line)) return;
    const host = parseRow(line);
    if (!host) return;
    hosts.push(host);
    rowIndex.set(host.name.toLowerCase(), i);
  });
  return { lines, eol, headerIndex, hosts, rowIndex };
}

async function writeFile(file: InventoryFile): Promise<void> {
  await fsp.writeFile(INVENTORY, file.lines.join(file.eol) + file.eol, 'utf8');
}

export function matches(host: Host, f: HostFilter): boolean {
  if (f.name && host.name.toLowerCase() !== f.name.toLowerCase()) return false;
  if (f.os && host.os !== f.os.toLowerCase()) return false;
  if (f.role && host.role !== f.role.toLowerCase()) return false;
  if (f.trimurti && host.trimurti !== f.trimurti.toLowerCase()) return false;
  return true;
}

export async function listHosts(f: HostFilter = {}): Promise<Host[]> {
  const { hosts } = await readFile();
  return hosts.filter((h) => matches(h, f));
}

/** admin, workstation and new rows are computers; nas, printer, iot and anything else are devices. */
export function isComputer(role: string): boolean {
  return ['admin', 'workstation', 'new'].includes(role.toLowerCase());
}

export interface RouterInfo {
  gateways: string[];
  routerIps: string[];
}

export function routerInfo(hosts: Host[]): RouterInfo {
  return {
    gateways: defaultGateways(),
    routerIps: hosts.filter((h) => h.role === 'router' && h.ip).map((h) => h.ip),
  };
}

/** Why a row is the router, or '' when it is not: role=router, this machine's default gateway, or a router row's IP. */
export function routerReason(h: { role: string; ip: string }, info: RouterInfo): string {
  if (h.role.toLowerCase() === 'router') return 'role=router';
  if (h.ip && info.gateways.includes(h.ip)) return `${h.ip} is this machine's default gateway`;
  if (h.ip && info.routerIps.includes(h.ip)) return `${h.ip} is the IP of the role=router row`;
  return '';
}

export interface Selection {
  hosts: Host[];
  /** named or role-selected rows that were left out, with the reason */
  skipped: Array<{ name: string; reason: string }>;
  /** every inventory row matching the filters, before the router and computer rules */
  matched: number;
}

/**
 * Rows a tool may touch (lib.sh select_hosts). Without a name or role filter only computers are
 * selected, unless devices is set. The router is never selected, even by name.
 */
export async function selectHosts(f: HostFilter, opts: { devices?: boolean } = {}): Promise<Selection> {
  const { hosts } = await readFile();
  const info = routerInfo(hosts);
  const out: Selection = { hosts: [], skipped: [], matched: 0 };
  for (const h of hosts) {
    if (!matches(h, f)) continue;
    out.matched++;
    const why = routerReason(h, info);
    if (why) {
      if (f.name || f.role) out.skipped.push({ name: h.name, reason: `it is the router (${why}); nothing here logs into it` });
      continue;
    }
    if (!opts.devices && !f.name && !f.role && !isComputer(h.role)) continue;
    out.hosts.push(h);
  }
  return out;
}

/**
 * An SSH login name, as lib.sh and ssh-config-gen take it: up to 64 characters, not starting with
 * '-' (ssh would read it as an option), no comma (the CSV), double quote (ssh-config-gen writes
 * User "<user>") or control character. Spaces inside are fine: a Windows local account is often
 * "Sanjay Kapoor", and every process gets it as one argv element. No space at either end (the CSV
 * trims it). Plain \x and \u escapes, so the pattern means the same in any JSON Schema validator.
 */
export const LOGIN_USER = /^(?![-\s])(?!.*\s$)[^,"\x00-\x1f\x7f-\x9f\u2028\u2029]{1,64}$/;

/** Why SSH-based tools skip a row, or '' when it can be tried (lib.sh ssh_skip_reason). */
export function sshSkipReason(h: Host): string {
  if (h.ssh_port === null) return 'no ssh_port set (blank means no SSH on this device; write 22 if it runs sshd)';
  if (!h.user) return 'no user set';
  if (h.user.startsWith('-')) return `user '${h.user}' starts with '-' (fix the inventory row)`;
  if (!LOGIN_USER.test(h.user)) return `user '${h.user}' is not a login name (a double quote or control character, or over 64 characters)`;
  if (!/^[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(h.name)) return "a name may only have letters, digits, '.', '_' and '-'";
  return '';
}

export function toRow(h: Host): string {
  return [h.name, h.ip, h.mac, h.os, h.user, h.role, h.ssh_port === null ? '' : String(h.ssh_port), h.trimurti, h.notes].join(',');
}

export function sshTarget(h: Host): string {
  return `${h.user}@${h.ip || h.name}`;
}

export type HostPatch = Partial<Omit<Host, 'name'>> & { name: string };

export interface UpsertResult {
  action: 'created' | 'updated';
  host: Host;
  changed: string[];
  warnings: string[];
}

/**
 * Create the row for patch.name, or change only the fields given in patch (names match without
 * regard to case). Comments and other rows are kept as they are. Throws on a router conflict.
 */
export async function upsertHost(patch: HostPatch): Promise<UpsertResult> {
  const file = await readFile();
  const idx = file.rowIndex.get(patch.name.toLowerCase());
  const before = idx === undefined ? undefined : parseRow(file.lines[idx] ?? '');
  if (!before) {
    const missing = (['os', 'role'] as const).filter((k) => patch[k] === undefined);
    if (missing.length) throw new Error(`${patch.name} is not in the inventory yet: creating it needs ${missing.join(' and ')}`);
  }
  const host: Host = {
    name: before?.name ?? patch.name,
    ip: patch.ip ?? before?.ip ?? '',
    mac: patch.mac ?? before?.mac ?? '',
    os: patch.os ?? before?.os ?? '',
    user: patch.user ?? before?.user ?? '',
    role: patch.role ?? before?.role ?? '',
    ssh_port: patch.ssh_port !== undefined ? patch.ssh_port : (before?.ssh_port ?? null),
    trimurti: patch.trimurti ?? before?.trimurti ?? 'no',
    notes: patch.notes ?? before?.notes ?? '',
  };
  const others = file.hosts.filter((h) => h.name.toLowerCase() !== host.name.toLowerCase());
  const info = routerInfo(others);
  if (before?.role === 'router' && host.role !== 'router') {
    throw new Error(`${before.name} is the router row: its role stays router (nothing here logs into the router). If the row is wrong, fix inventory.csv by hand.`);
  }
  if (host.role !== 'router') {
    const why = routerReason({ role: host.role, ip: host.ip }, info);
    if (why) throw new Error(`${why}, so it is the router: a row with that IP must have role=router, and nothing here logs into it.`);
  }
  const warnings: string[] = [];
  if (host.ip) {
    const dup = others.filter((h) => h.ip === host.ip).map((h) => h.name);
    if (dup.length) warnings.push(`ip ${host.ip} is also on row ${dup.join(', ')}: one of them is wrong`);
  }
  if (host.mac) {
    const dup = others.filter((h) => h.mac && h.mac === host.mac).map((h) => h.name);
    if (dup.length) warnings.push(`mac ${host.mac} is also on row ${dup.join(', ')}`);
  }
  const changed = before
    ? (Object.keys(host) as Array<keyof Host>).filter((k) => host[k] !== before[k])
    : (Object.keys(host) as Array<keyof Host>).filter((k) => k !== 'name');
  if (idx === undefined) file.lines.push(toRow(host));
  else file.lines[idx] = toRow(host);
  if (idx === undefined || changed.length) await writeFile(file);
  return { action: idx === undefined ? 'created' : 'updated', host, changed, warnings };
}

/** Remove the row for name (any case). Returns the removed row, or undefined if there is none. */
export async function removeHost(name: string): Promise<Host | undefined> {
  const file = await readFile();
  const idx = file.rowIndex.get(name.toLowerCase());
  if (idx === undefined) return undefined;
  const host = parseRow(file.lines[idx] ?? '');
  file.lines.splice(idx, 1);
  await writeFile(file);
  return host;
}
