import fsp from 'node:fs/promises';
import { INVENTORY } from './constants.js';

export interface Host {
  name: string;
  ip: string;
  mac: string;
  os: string;
  user: string;
  role: string;
  ssh_port: number;
  trimurti: string;
  notes: string;
}

export interface HostFilter {
  name?: string | undefined;
  os?: string | undefined;
  role?: string | undefined;
  trimurti?: string | undefined;
}

const HEADER = 'name,ip,mac,os,user,role,ssh_port,trimurti,notes';
const COLUMNS = HEADER.split(',');

interface InventoryFile {
  lines: string[];
  headerIndex: number;
  hosts: Host[];
  rowIndex: Map<string, number>; // host name -> line index
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
  const port = Number.parseInt(fields[6] ?? '', 10);
  return {
    name: fields[0] ?? '',
    ip: fields[1] ?? '',
    mac: (fields[2] ?? '').toLowerCase(),
    os: (fields[3] ?? '').toLowerCase(),
    user: fields[4] ?? '',
    role: (fields[5] ?? '').toLowerCase(),
    ssh_port: Number.isFinite(port) && port > 0 ? port : 22,
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
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const headerIndex = lines.findIndex(isData);
  if (headerIndex < 0) throw new Error(`inventory ${INVENTORY} has no header row (${HEADER})`);
  const hosts: Host[] = [];
  const rowIndex = new Map<string, number>();
  lines.forEach((line, i) => {
    if (i <= headerIndex || !isData(line)) return;
    const host = parseRow(line);
    if (!host) return;
    hosts.push(host);
    rowIndex.set(host.name, i);
  });
  return { lines, headerIndex, hosts, rowIndex };
}

export function matches(host: Host, f: HostFilter): boolean {
  if (f.name && host.name !== f.name) return false;
  if (f.os && host.os !== f.os.toLowerCase()) return false;
  if (f.role && host.role !== f.role.toLowerCase()) return false;
  if (f.trimurti && host.trimurti !== f.trimurti.toLowerCase()) return false;
  return true;
}

export async function listHosts(f: HostFilter = {}): Promise<Host[]> {
  const { hosts } = await readFile();
  return hosts.filter((h) => matches(h, f));
}

/** Hosts a script may log into: everything selected except role=router. */
export async function sshableHosts(f: HostFilter = {}): Promise<Host[]> {
  return (await listHosts(f)).filter((h) => h.role !== 'router');
}

export function toRow(h: Host): string {
  return [h.name, h.ip, h.mac, h.os, h.user, h.role, String(h.ssh_port), h.trimurti, h.notes].join(',');
}

export function sshTarget(h: Host): string {
  return `${h.user}@${h.ip || h.name}`;
}

/** Insert or replace the row for host.name; comments and other rows are kept as they are. */
export async function upsertHost(host: Host): Promise<'created' | 'updated'> {
  const file = await readFile();
  const existing = file.rowIndex.get(host.name);
  let action: 'created' | 'updated';
  if (existing === undefined) {
    file.lines.push(toRow(host));
    action = 'created';
  } else {
    file.lines[existing] = toRow(host);
    action = 'updated';
  }
  await fsp.writeFile(INVENTORY, file.lines.join('\n') + '\n', 'utf8');
  return action;
}
