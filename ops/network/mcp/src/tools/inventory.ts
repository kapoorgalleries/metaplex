import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { INVENTORY, OS_VALUES, ROLE_VALUES, YES_NO } from '../constants.js';
import { listHosts, upsertHost, type Host } from '../inventory.js';
import { errorMessage, fail, mdTable, ok } from '../result.js';

const HostSchema = z.object({
  name: z.string(),
  ip: z.string(),
  mac: z.string(),
  os: z.string(),
  user: z.string(),
  role: z.string(),
  ssh_port: z.number(),
  trimurti: z.string(),
  notes: z.string(),
});

export const FilterFields = {
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and hyphens')
    .optional()
    .describe('Exact inventory name of one host, e.g. "new-pc-1"'),
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
    name: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and hyphens; this is also the ssh alias'),
    ip: z
      .string()
      .regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'dotted IPv4')
      .or(z.literal(''))
      .default('')
      .describe('Reserved LAN IPv4, or "" if not yet known'),
    mac: z
      .string()
      .regex(/^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/, 'aa:bb:cc:dd:ee:ff')
      .or(z.literal(''))
      .default('')
      .describe('MAC address for the DHCP reservation, or ""'),
    os: z.enum(OS_VALUES),
    user: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/, 'the SSH login user')
      .describe('SSH login user on that machine'),
    role: z.enum(ROLE_VALUES),
    ssh_port: z.number().int().min(1).max(65535).default(22),
    trimurti: z.enum(YES_NO).default('no'),
    notes: z
      .string()
      .max(200)
      .regex(/^[^,\r\n]*$/, 'no commas or line breaks')
      .default('')
      .describe('Free text without commas'),
  })
  .strict();

const UpsertOutput = z.object({
  action: z.enum(['created', 'updated']),
  inventory_file: z.string(),
  host: HostSchema,
});

const COLUMNS = ['name', 'ip', 'mac', 'os', 'user', 'role', 'ssh_port', 'trimurti', 'notes'];

export function registerInventoryTools(server: McpServer): void {
  server.registerTool(
    'trimurti_list_hosts',
    {
      title: 'List inventory hosts',
      description: `List the machines in the Trimurti network inventory (ops/network/inventory.csv), optionally filtered.

The inventory is the single source of truth every other tool reads: a host must be listed here before it can be scanned, SSH'd into or updated. Rows with role=router are listed but never logged into.

Args:
  - name (string, optional): exact host name
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
      description: `Create or replace one row in ops/network/inventory.csv, keyed by name. Use it to record what trimurti_scan_lan found (ip, mac), to add the two new machines, or to flip trimurti to 'yes' once a machine is onboarded.

Args: name, os, user, role are required; ip, mac, ssh_port (default 22), trimurti (default 'no'), notes (no commas) are optional. Validation is strict: a bad MAC or IP is rejected with the expected format.

Returns: { action: 'created'|'updated', inventory_file, host }.

Side effects: rewrites the one CSV row (comments and other rows are untouched). Does not touch the router, DHCP or any machine. After changing ip or user, regenerate the ssh aliases with scripts/ssh-config-gen.sh.`,
      inputSchema: UpsertInput,
      outputSchema: UpsertOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (p) => {
      try {
        const host: Host = {
          name: p.name,
          ip: p.ip,
          mac: p.mac.toLowerCase().replace(/-/g, ':'),
          os: p.os,
          user: p.user,
          role: p.role,
          ssh_port: p.ssh_port,
          trimurti: p.trimurti,
          notes: p.notes,
        };
        const action = await upsertHost(host);
        const out = { action, inventory_file: INVENTORY, host };
        return ok(`${action}: ${host.name} (${host.user}@${host.ip || '<no ip>'}, ${host.os}, ${host.role})`, out);
      } catch (e) {
        return fail(errorMessage(e));
      }
    },
  );
}
