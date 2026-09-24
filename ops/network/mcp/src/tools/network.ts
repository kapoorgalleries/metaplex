import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { IS_WINDOWS, SCRIPTS_DIR } from '../constants.js';
import { run, stripAnsi } from '../exec.js';
import { listHosts, routerInfo, routerReason } from '../inventory.js';
import { clipStream, errorMessage, fail, mdTable, ok, parseCsv } from '../result.js';
import { bashCommand } from '../system.js';
import { LOGIN_USER } from './inventory.js';

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
/** Private /24s only (10/8, 172.16/12, 192.168/16): the sweep pings and port-probes every address. */
const PRIVATE_SUBNET = new RegExp(`^(?:10\\.${OCTET}|172\\.(?:1[6-9]|2\\d|3[01])|192\\.168)\\.${OCTET}$`);

/**
 * netscan.ps1 through Windows PowerShell with its warning stream turned into "WARN: " lines, so the
 * warnings are found whatever the display language (Write-Warning's own prefix is translated).
 */
export const NETSCAN_PS_COMMAND =
  "$a = @(); if ($env:TRIMURTI_SUBNET) { $a = @($env:TRIMURTI_SUBNET) }; $global:LASTEXITCODE = 0; " +
  "& $env:TRIMURTI_NETSCAN @a 3>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.WarningRecord]) { 'WARN: ' + $_.Message } else { $_ } }; " +
  'exit $LASTEXITCODE';

/** The CSV path (the whole rest of the "saved:" line: a Windows profile path has spaces), warnings and context lines. */
export function parseNetscanOutput(text: string): { csv: string | undefined; warnings: string[]; context: string[] } {
  const lines = text.split(/\r?\n/);
  return {
    csv: /saved:\s+(.+?\.csv)\s*$/m.exec(text)?.[1],
    warnings: lines.filter((l) => /^\s*(WARN\b|WARNING:)/.test(l)).map((l) => l.replace(/^\s*WARN(ING)?:?\s*/, '').trim()),
    context: lines
      .filter((l) => /interface=|adapter=|dns servers:|single NAT|DOUBLE NAT/i.test(l))
      .map((l) => l.replace(/^\[\d\d:\d\d:\d\d\]\s*/, '').trim()),
  };
}

const ScanInput = z
  .object({
    subnet: z
      .string()
      .regex(PRIVATE_SUBNET, 'first three octets of a private LAN, e.g. 192.168.1 (10.x.y, 172.16-31.y or 192.168.y)')
      .optional()
      .describe('First three octets of the private /24 to sweep. Default: the admin machine\'s own subnet'),
    timeout_seconds: z.number().int().min(30).max(300).default(120),
    response_format: z.enum(['markdown', 'json']).default('markdown'),
  })
  .strict();

const ScanRow = z.object({
  ip: z.string(),
  mac: z.string(),
  hostname: z.string(),
  ssh22: z.boolean(),
  smb445: z.boolean(),
  http80: z.boolean(),
  https443: z.boolean(),
  dsm5000: z.boolean(),
  qnap8080: z.boolean(),
  hint: z.string(),
});

const ScanOutput = z.object({
  csv_file: z.string(),
  host_count: z.number(),
  warnings: z.array(z.string()),
  context: z.array(z.string()),
  hosts: z.array(ScanRow),
});

const NasInput = z
  .object({
    host: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/, 'inventory name or IPv4')
      .optional()
      .describe('Inventory name or IP of a role=nas row. Default: the first role=nas row'),
    ssh_user: z
      .string()
      .regex(LOGIN_USER, 'a login name, not starting with -')
      .optional()
      .describe("SSH user for the key-only probe (default: the NAS row's user; a blank user or ssh_port means no login is tried)"),
    timeout_seconds: z.number().int().min(15).max(300).default(90),
  })
  .strict();

const NasOutput = z.object({
  host: z.string(),
  inventory_name: z.string(),
  ping: z.boolean(),
  open_ports: z.array(z.number()),
  vendor_guess: z.string(),
  smb_listening: z.boolean(),
  web_ui_hint: z.string(),
  next_step: z.string(),
  raw: z.string(),
});

export function registerNetworkTools(server: McpServer): void {
  server.registerTool(
    'trimurti_scan_lan',
    {
      title: 'Scan the LAN',
      description: `Sweep the admin machine's /24 and report every host that answered: IP, MAC, resolved hostname, which of ports 22/445/80/443/5000/8080 are open, and a hint (gateway, Synology, QNAP, SMB host, this machine). Also checks for double NAT and a 100 Mb link and returns those as warnings. Read-only; takes 10-30 s.

Runs ops/network/scripts/netscan.sh (netscan.ps1 on a Windows admin machine).

Args:
  - subnet (string, optional): "192.168.1" style, private ranges only (10.x.y, 172.16-31.y, 192.168.y); default is the admin machine's own subnet
  - timeout_seconds (30-300, default 120)
  - response_format ('markdown'|'json')

Returns: { csv_file, host_count, warnings[], context[] (interface, gateway, DNS lines), hosts: [{ ip, mac, hostname, ssh22, smb445, http80, https443, dsm5000, qnap8080, hint }] }.

The router (this machine's default gateway, or a role=router row) is pinged but never port-probed.

Use the rows to fill the inventory with trimurti_upsert_host (mac is what the router's DHCP reservation needs). Two scans from different machines that disagree on gateway or subnet are the "mess" checklists/network-triage.md describes.`,
      inputSchema: ScanInput,
      outputSchema: ScanOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (p) => {
      try {
        const r = IS_WINDOWS
          ? await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', NETSCAN_PS_COMMAND], {
              timeoutMs: p.timeout_seconds * 1000,
              env: { TRIMURTI_NETSCAN: path.join(SCRIPTS_DIR, 'netscan.ps1'), TRIMURTI_SUBNET: p.subnet ?? '' },
            })
          : await run(bashCommand(), [path.join(SCRIPTS_DIR, 'netscan.sh'), ...(p.subnet ? [p.subnet] : [])], { timeoutMs: p.timeout_seconds * 1000 });
        const text = stripAnsi(r.stdout + '\n' + r.stderr);
        if (r.timedOut) return fail(`netscan did not finish in ${p.timeout_seconds}s. Pass subnet explicitly or raise timeout_seconds.`);
        const { csv, warnings, context } = parseNetscanOutput(text);
        if (!csv || r.code !== 0) {
          return fail(`netscan exited ${r.code} without a CSV. Output:\n${clipStream(text)}`);
        }
        const rows = parseCsv(await fsp.readFile(csv, 'utf8'));
        const yes = (v: string | undefined) => (v ?? '').toLowerCase() === 'y';
        const hosts = rows.map((r0) => ({
          ip: r0.ip ?? '',
          mac: r0.mac ?? '',
          hostname: r0.hostname ?? '',
          ssh22: yes(r0.ssh22),
          smb445: yes(r0.smb445),
          http80: yes(r0.http80),
          https443: yes(r0.https443),
          dsm5000: yes(r0.dsm5000),
          qnap8080: yes(r0.qnap8080),
          hint: r0.hint ?? '',
        }));
        const out = { csv_file: csv, host_count: hosts.length, warnings, context, hosts };
        const md = [
          `${hosts.length} host(s) answered. CSV: ${csv}`,
          ...context.map((c) => `- ${c}`),
          ...(warnings.length ? ['', '**Warnings**', ...warnings.map((w) => `- ${w}`)] : []),
          '',
          mdTable(
            hosts.map((h) => ({
              ...h,
              ports: ['ssh22', 'smb445', 'http80', 'https443', 'dsm5000', 'qnap8080']
                .filter((k) => (h as Record<string, unknown>)[k] === true)
                .map((k) => k.replace(/\D/g, ''))
                .join(' '),
            })),
            ['ip', 'mac', 'hostname', 'ports', 'hint'],
          ),
        ].join('\n');
        return ok(p.response_format === 'json' ? JSON.stringify(out, null, 2) : md, out);
      } catch (e) {
        return fail(`could not run netscan: ${errorMessage(e)}`);
      }
    },
  );

  server.registerTool(
    'trimurti_check_nas',
    {
      title: 'Check the NAS',
      description: `Probe the NAS from the admin machine: ping, every port a NAS normally listens on (22, 80, 443, 5000/5001 Synology, 8080 QNAP, 445/139 SMB, 2049 NFS, 548 AFP, 873 rsync, 3260 iSCSI), a vendor guess from ports and HTTP banners, the guest share listing, an SMB1 check, NFS exports, and a key-only SSH probe with the admin key on the row's ssh_port (never a password). Read-only. Runs ops/network/scripts/nas-check.sh.

Args:
  - host (optional): inventory name or IP of a role=nas row; default is the first role=nas row. Anything else is refused: add the NAS with trimurti_upsert_host (role nas) first. The router (role=router, or this machine's default gateway) is never probed.
  - ssh_user (optional): user for the SSH probe; default is the NAS row's user. A blank user or ssh_port means no login is tried.
  - timeout_seconds (15-300, default 90)

Returns: { host, inventory_name, ping, open_ports[], vendor_guess, smb_listening, web_ui_hint, next_step (the checklists/nas.md section to open), raw }.

Interpretation: no ping -> power/link/IP problem; ping but 445 closed -> file service off or volume unmounted; 445 open but a PC cannot mount -> credentials/protocol (Windows 11 refuses SMB1 and guest); SMB and the web UI up -> hardening and housekeeping.`,
      inputSchema: NasInput,
      outputSchema: NasOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (p) => {
      try {
        const all = await listHosts();
        const info = routerInfo(all);
        if (p.host && (info.gateways.includes(p.host) || info.routerIps.includes(p.host))) {
          return fail(`${p.host} is the router (this machine's default gateway, or a role=router row's IP): it is never probed or logged into. Pass the NAS's own inventory name or IP.`);
        }
        const key = p.host?.toLowerCase();
        const nas = key ? all.find((h) => h.name.toLowerCase() === key || h.ip === p.host) : all.find((h) => h.role === 'nas');
        if (!nas) {
          return fail(
            p.host
              ? `${p.host} is not in the inventory. Add the NAS with trimurti_upsert_host (role nas) first; trimurti_check_nas only probes role=nas rows.`
              : 'no host given and no inventory row with role=nas. Add the NAS with trimurti_upsert_host first.',
          );
        }
        const why = routerReason(nas, info);
        if (why) return fail(`${nas.name} is the router (${why}): it is never probed or logged into.`);
        if (nas.role !== 'nas') return fail(`${nas.name} has role=${nas.role}, not nas. trimurti_check_nas only probes role=nas rows; fix the row with trimurti_upsert_host if it is the NAS.`);
        const host = nas.ip || nas.name;
        const args = [path.join(SCRIPTS_DIR, 'nas-check.sh'), host, ...(p.ssh_user ? [p.ssh_user] : [])];
        const r = await run(bashCommand(), args, { timeoutMs: p.timeout_seconds * 1000 });
        const text = stripAnsi(r.stdout + (r.stderr ? `\n${r.stderr}` : ''));
        if (r.timedOut) return fail(`nas-check did not finish in ${p.timeout_seconds}s. Partial output:\n${clipStream(text)}`);
        if (r.code === 2) return fail(`nas-check.sh refused: ${clipStream(text.trim())}`);
        const openPorts = [...text.matchAll(/^\s*(?:OK\s+)?(\d{1,5})\s+open/gm)].map((m) => Number(m[1]));
        const vendor = /vendor guess:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? 'unknown';
        const webUi = /web UI:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
        const ping = /ping answers/.test(text);
        const smb = openPorts.includes(445);
        const web = [80, 443, 5000, 5001, 8080].some((x) => openPorts.includes(x));
        const smb1 = /SMB1 is ON/.test(text);
        const section = (t: string) => `checklists/nas.md "${t}"`;
        const nextStep = !openPorts.length
          ? `${section('Not reachable at all (no ping)')}${ping ? ': it answers ping but no NAS port is open; check the IP against trimurti_scan_lan' : ''}`
          : smb1
            ? `${section('Reachable but shares will not mount')}: set the minimum SMB protocol to SMB2`
            : smb && web
              ? `${section('Hardening and housekeeping once it works')}; if a PC still cannot mount a share: ${section('Reachable but shares will not mount')}`
              : web
                ? section('Web UI up, shares gone')
                : smb
                  ? `${section('Reachable but shares will not mount')}; no web UI port answers: is ${host} a PC sharing files rather than the NAS?`
                  : `${section('Not reachable at all (no ping)')}: no web UI and no SMB, so this does not look like a NAS`;
        const out = {
          host,
          inventory_name: nas.name,
          ping,
          open_ports: openPorts,
          vendor_guess: vendor,
          smb_listening: smb,
          web_ui_hint: webUi,
          next_step: nextStep,
          raw: clipStream(text),
        };
        return ok(`${text.trim()}\n\nnext step: ${nextStep}`, out);
      } catch (e) {
        return fail(`could not run nas-check.sh: ${errorMessage(e)}`);
      }
    },
  );
}
