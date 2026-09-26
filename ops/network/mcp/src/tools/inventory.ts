import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { INVENTORY, OS_VALUES, ROLE_VALUES, YES_NO } from '../constants.js';
import { listHosts, LOGIN_USER, removeHost, upsertHost, type HostPatch } from '../inventory.js';
import { errorMessage, fail, mdTable, ok } from '../result.js';

export const HostSchema = z.object({
  name: z.string(),
  ip: z.string(),
  mac: z.string(),
  os: z.string(),
  user: z.string(),
  role: z.string(),
  ssh_port: z.number().nullable(),
  trimurti: z.string(),
  notes: z.string(),
});

/** An existing row's name, any case (hand-entered rows may have capitals, dots or underscores). */
export const HostName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/, 'an inventory host name: letters, digits, . _ -');

/** Dotted IPv4, each octet 0-255 without leading zeros (192.168.1.021 would be read as octal). */
export const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export const FilterFields = {
  name: HostName.optional().describe('Inventory name of one host, e.g. "new-pc-1" (case does not matter)'),
  os: z.enum(OS_VALUES).optional().describe('Only hosts with this os'),
  role: z.enum(ROLE_VALUES).optional().describe('Only hosts with this role'),
  trimurti: z.enum(YES_NO).optional().describe('Only hosts that are (yes) or are not (no) Trimurti members'),
};

const ListInput = z
  .object({
    ...FilterFields,
    limit: z.number().int().min(1).max(100).default(50).describe('Maximum hosts to return (default 50)'),
    offset: z.number().int().min(0).default(0).describe('Hosts to skip, for paging'),
    response_format: z
      .enum(['markdown', 'json'])
      .default('markdown')
      .describe("'markdown' for a table, 'json' for the raw rows"),
  })
  .strict();

const ListOutput = z.object({
  total: z.number(),
  count: z.number(),
  offset: z.number(),
  has_more: z.boolean(),
  next_offset: z.number().optional(),
  inventory_file: z.string(),
  hosts: z.array(HostSchema),
});

const UpsertInput = z
  .object({
    name: HostName.describe('Host name, the row key. Stored lowercase for a new row (DESKTOP-AB12CD -> desktop-ab12cd); an existing row matches in any case'),
    ip: z
      .string()
      .regex(IPV4, 'dotted IPv4, octets 0-255 without leading zeros')
      .or(z.literal(''))
      .optional()
      .describe('Reserved LAN IPv4; "" clears it'),
    mac: z
      .string()
      .regex(/^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/, 'aa:bb:cc:dd:ee:ff')
      .or(z.literal(''))
      .optional()
      .describe('MAC address for the DHCP reservation; "" clears it'),
    os: z.enum(OS_VALUES).optional().describe('Required for a new row'),
    user: z
      .string()
      .regex(LOGIN_USER, "the SSH login user: up to 64 characters, spaces inside are fine; no '-' or space at the start, no comma, double quote or control character")
      .or(z.literal(''))
      .optional()
      .describe('SSH login user on that machine, as it is spelled there (a Windows account may have a space: "Sanjay Kapoor")'),
    role: z.enum(ROLE_VALUES).optional().describe('Required for a new row'),
    ssh_port: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .or(z.literal(''))
      .optional()
      .describe('22 (or the real port) for a machine that runs sshd; "" = no SSH on this device. A new row without it has no SSH'),
    trimurti: z.enum(YES_NO).optional().describe("Default 'no' for a new row"),
    notes: z
      .string()
      .max(200)
      .regex(/^[^,\r\n]*$/, 'no commas or line breaks')
      .optional()
      .describe('Free text without commas'),
  })
  .strict();

const UpsertOutput = z.object({
  action: z.enum(['created', 'updated']),
  inventory_file: z.string(),
  host: HostSchema,
  changed: z.array(z.string()),
  warnings: z.array(z.string()),
});

const RemoveInput = z
  .object({
    name: HostName.describe('Inventory name of the row to remove'),
    confirm: z.boolean().default(false).describe('Must be true to remove a role=router row'),
  })
  .strict();

const RemoveOutput = z.object({ inventory_file: z.string(), removed: HostSchema });

const COLUMNS = ['name', 'ip', 'mac', 'os', 'user', 'role', 'ssh_port', 'trimurti', 'notes'];

export function registerInventoryTools(server: McpServer): void {
  server.registerTool(
    'trimurti_list_hosts',
    {
      title: 'List inventory hosts',
      description: `List the machines in the Trimurti network inventory (ops/network/inventory.csv), optionally filtered.

The inventory is the single source of truth every other tool reads: a host must be listed here before it can be SSH'd into, checked or updated. The router (a role=router row, or any row whose IP is this machine's default gateway) is listed but never logged into. A blank ssh_port (null) means the device has no SSH.

Args:
  - name (string, optional): host name, any case
  - os ('windows'|'macos'|'linux'|'nas'|'other', optional)
  - role ('admin'|'workstation'|'nas'|'new'|'router'|'printer'|'iot', optional)
  - trimurti ('yes'|'no', optional): membership flag
  - limit (1-100, default 50), offset (default 0)
  - response_format ('markdown'|'json', default 'markdown')

Returns: { total, count, offset, has_more, next_offset?, inventory_file, hosts: [{ name, ip, mac, os, user, role, ssh_port, trimurti, notes }] }.
An empty ip means the host has not been placed yet: run trimurti_scan_lan and then trimurti_upsert_host.

Examples:
  - "Which machines still need to join Trimurti?" -> trimurti='no' (then ignore role=router and role=nas)
  - "What is the NAS's IP?" -> role='nas'`,
      inputSchema: ListInput,
      outputSchema: ListOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (p) => {
      try {
        const all = await listHosts({ name: p.name, os: p.os, role: p.role, trimurti: p.trimurti });
        const page = all.slice(p.offset, p.offset + p.limit);
        const hasMore = all.length > p.offset + page.length;
        const out = {
          total: all.length,
          count: page.length,
          offset: p.offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: p.offset + page.length } : {}),
          inventory_file: INVENTORY,
          hosts: page,
        };
        const text =
          p.response_format === 'json'
            ? JSON.stringify(out, null, 2)
            : `${all.length} host(s) in ${INVENTORY}${hasMore ? ` (showing ${page.length})` : ''}\n\n${mdTable(page, COLUMNS)}`;
        return ok(text, out);
      } catch (e) {
        return fail(errorMessage(e));
      }
    },
  );

  server.registerTool(
    'trimurti_upsert_host',
    {
      title: 'Add or update an inventory host',
      description: `Create one row in ops/network/inventory.csv, or change fields of an existing one, keyed by name. Only the fields you pass change; everything else in the row is kept, so {name, trimurti: 'yes'} flips the flag and nothing else. Use it to record what trimurti_scan_lan found (ip, mac), to add the two new machines, or to set trimurti to 'yes' once a machine is onboarded.

Args: name always; os and role as well for a new row. Optional: ip, mac, user, ssh_port (22 for a machine that runs sshd; "" or left out on a new row = no SSH on this device), trimurti (default 'no'), notes (no commas). "" clears ip, mac, user, ssh_port or notes. Validation is strict: IPv4 without leading zeros, aa:bb:cc:dd:ee:ff MACs, users not starting with '-' and without commas, double quotes or control characters (a space inside, as in "Sanjay Kapoor", is fine). A new row's name is stored lowercase.

Refused: giving the router's row another role, and any non-router role for an IP that is this machine's default gateway or a role=router row's IP (the router is never logged into).

Returns: { action: 'created'|'updated', inventory_file, host, changed: [fields], warnings: [e.g. the IP is also on another row] }.

Side effects: rewrites that one CSV row (comments and other rows are untouched). Does not touch the router, DHCP or any machine. After changing ip or user, regenerate the ssh aliases with scripts/ssh-config-gen.sh.`,
      inputSchema: UpsertInput,
      outputSchema: UpsertOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (p) => {
      try {
        const patch: HostPatch = { name: p.name.toLowerCase() };
        if (p.ip !== undefined) patch.ip = p.ip;
        if (p.mac !== undefined) patch.mac = p.mac.toLowerCase().replace(/-/g, ':');
        if (p.os !== undefined) patch.os = p.os;
        if (p.user !== undefined) patch.user = p.user;
        if (p.role !== undefined) patch.role = p.role;
        if (p.ssh_port !== undefined) patch.ssh_port = p.ssh_port === '' ? null : p.ssh_port;
        if (p.trimurti !== undefined) patch.trimurti = p.trimurti;
        if (p.notes !== undefined) patch.notes = p.notes;
        const r = await upsertHost(patch);
        const h = r.host;
        const out = { action: r.action, inventory_file: INVENTORY, host: h, changed: r.changed, warnings: r.warnings };
        const what = r.action === 'updated' ? (r.changed.length ? ` [changed: ${r.changed.join(', ')}]` : ' [no change]') : '';
        const ssh = h.ssh_port === null ? 'no SSH' : `ssh ${h.user || '<no user>'}@${h.ip || h.name}:${h.ssh_port}`;
        return ok(
          `${r.action}: ${h.name} (${h.ip || '<no ip>'}, ${h.os}, ${h.role}, ${ssh}, trimurti=${h.trimurti})${what}${r.warnings.map((w) => `\nWARNING: ${w}`).join('')}`,
          out,
        );
      } catch (e) {
        return fail(errorMessage(e));
      }
    },
  );

  server.registerTool(
    'trimurti_remove_host',
    {
      title: 'Remove an inventory host',
      description: `Delete one row from ops/network/inventory.csv by name (any case), e.g. the template's example rows or a machine that left the network. Comments and other rows are kept. Removing the router's row needs confirm: true (the default-gateway check still keeps every tool off the router).

Returns: { inventory_file, removed: { the row as it was } }.`,
      inputSchema: RemoveInput,
      outputSchema: RemoveOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (p) => {
      try {
        const row = (await listHosts({ name: p.name }))[0];
        if (!row) return fail(`no inventory row named "${p.name}". See trimurti_list_hosts.`);
        if (row.role === 'router' && !p.confirm) {
          return fail(`${row.name} is the router's row. Pass confirm: true to remove it anyway (its IP stays protected while it is this machine's default gateway).`);
        }
        const removed = await removeHost(row.name);
        if (!removed) return fail(`no inventory row named "${p.name}".`);
        return ok(`removed: ${removed.name} (${removed.ip || '<no ip>'}, ${removed.os}, ${removed.role}) from ${INVENTORY}`, { inventory_file: INVENTORY, removed });
      } catch (e) {
        return fail(errorMessage(e));
      }
    },
  );
}
