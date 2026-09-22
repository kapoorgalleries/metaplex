import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { IS_WINDOWS, SCRIPTS_DIR } from '../constants.js';
import { run, stripAnsi } from '../exec.js';
import { listHosts } from '../inventory.js';
import { clipStream, errorMessage, fail, mdTable, ok, parseCsv } from '../result.js';

const ScanInput = z
  .object({
    subnet: z
      .string()
      .regex(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/, 'first three octets, e.g. 192.168.1')
      .optional()
      .describe('First three octets of the /24 to sweep. Default: the admin machine\'s own subnet'),
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
      .regex(/^[A-Za-z0-9.-]{1,253}$/, 'hostname or IPv4')
      .optional()
      .describe('NAS hostname or IP. Default: the inventory row with role=nas'),
    ssh_user: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .optional()
      .describe('SSH user for the probe (default: the inventory user, else admin)'),
    timeout_seconds: z.number().int().min(15).max(300).default(90),
  })
  .strict();

const NasOutput = z.object({
  host: z.string(),
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
  - subnet (string, optional): "192.168.1" style; default is the admin machine's own subnet
  - timeout_seconds (30-300, default 120)
  - response_format ('markdown'|'json')

Returns: { csv_file, host_count, warnings[], context[] (interface, gateway, DNS lines), hosts: [{ ip, mac, hostname, ssh22, smb445, http80, https443, dsm5000, qnap8080, hint }] }.

Use the rows to fill the inventory with trimurti_upsert_host (mac is what the router's DHCP reservation needs). Two scans from different machines that disagree on gateway or subnet are the "mess" checklists/network-triage.md describes.`,
      inputSchema: ScanInput,
      outputSchema: ScanOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (p) => {
      try {
        const cmd = IS_WINDOWS ? 'powershell' : 'bash';
        const args = IS_WINDOWS
          ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS_DIR, 'netscan.ps1'), ...(p.subnet ? ['-Subnet', p.subnet] : [])]
          : [path.join(SCRIPTS_DIR, 'netscan.sh'), ...(p.subnet ? [p.subnet] : [])];
        const r = await run(cmd, args, { timeoutMs: p.timeout_seconds * 1000 });
        const text = stripAnsi(r.stdout + '\n' + r.stderr);
        if (r.timedOut) return fail(`netscan did not finish in ${p.timeout_seconds}s. Pass subnet explicitly or raise timeout_seconds.`);
        const csv = /saved:\s+(\S+\.csv)/.exec(text)?.[1];
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
        const lines = text.split(/\r?\n/);
        const warnings = lines.filter((l) => /WARN/.test(l)).map((l) => l.replace(/^\s*WARN(ING:)?\s*/, '').trim());
        const context = lines
          .filter((l) => /interface=|adapter=|dns servers:|single NAT|DOUBLE NAT/i.test(l))
          .map((l) => l.replace(/^\[\d\d:\d\d:\d\d\]\s*/, '').trim());
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
        return fail(`could not run netscan: ${errorMessage(e)}. On Windows the .sh scripts need Git Bash or WSL; this tool uses netscan.ps1 there.`);
      }
    },
  );

  server.registerTool(
    'trimurti_check_nas',
    {
      title: 'Check the NAS',
      description: `Probe the NAS from the admin machine: ping, every port a NAS normally listens on (22, 80, 443, 5000/5001 Synology, 8080 QNAP, 445/139 SMB, 2049 NFS, 548 AFP, 873 rsync, 3260 iSCSI), a vendor guess from ports and HTTP banners, the guest share listing, NFS exports, and an SSH probe when port 22 is open. Read-only. Runs ops/network/scripts/nas-check.sh.

Args:
  - host (optional): hostname or IP; default is the inventory row with role=nas
  - ssh_user (optional): user for the SSH probe
  - timeout_seconds (15-300, default 90)

Returns: { host, ping, open_ports[], vendor_guess, smb_listening, web_ui_hint, next_step (the checklists/nas.md section to open), raw }.

Interpretation: no ping -> power/link/IP problem; ping but 445 closed -> file service off or volume unmounted; 445 open but a PC cannot mount -> credentials/protocol (Windows 11 refuses SMB1 and guest).`,
      inputSchema: NasInput,
      outputSchema: NasOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (p) => {
      try {
        let host = p.host;
        let user = p.ssh_user;
        if (!host) {
          const nas = (await listHosts({ role: 'nas' }))[0];
          if (!nas) return fail('no host given and no inventory row with role=nas. Add the NAS with trimurti_upsert_host first.');
          host = nas.ip || nas.name;
          user = user ?? nas.user;
        }
        const args = [path.join(SCRIPTS_DIR, 'nas-check.sh'), host, ...(user ? [user] : [])];
        const r = await run('bash', args, { timeoutMs: p.timeout_seconds * 1000 });
        const text = stripAnsi(r.stdout + (r.stderr ? `\n${r.stderr}` : ''));
        if (r.timedOut) return fail(`nas-check did not finish in ${p.timeout_seconds}s. Partial output:\n${clipStream(text)}`);
        const openPorts = [...text.matchAll(/^\s*(?:OK\s+)?(\d{1,5})\s+open/gm)].map((m) => Number(m[1]));
        const vendor = /vendor guess:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? 'unknown';
        const webUi = /web UI:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
        const nextStep = text
          .split(/\r?\n/)
          .filter((l) => /nas\.md/.test(l))
          .map((l) => l.replace(/^\s*(OK|WARN|FAIL|\[\d\d:\d\d:\d\d\])\s*/, '').trim())
          .join(' | ');
        const out = {
          host,
          ping: /ping answers/.test(text),
          open_ports: openPorts,
          vendor_guess: vendor,
          smb_listening: openPorts.includes(445),
          web_ui_hint: webUi,
          next_step: nextStep || (openPorts.length ? 'checklists/nas.md "Hardening and housekeeping"' : 'checklists/nas.md "Not reachable at all"'),
          raw: clipStream(text),
        };
        return ok(text, out);
      } catch (e) {
        return fail(`could not run nas-check.sh: ${errorMessage(e)} (needs bash on the admin machine)`);
      }
    },
  );
}
