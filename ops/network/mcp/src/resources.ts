import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CHECKLISTS_DIR, INVENTORY, OPS_DIR } from './constants.js';

async function text(file: string): Promise<string> {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return `(missing: ${file})`;
  }
}

async function checklistNames(): Promise<string[]> {
  try {
    return (await fsp.readdir(CHECKLISTS_DIR))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .sort();
  } catch {
    return [];
  }
}

export function registerResources(server: McpServer): void {
  const statics: Array<[string, string, string, string, string]> = [
    ['readme', 'trimurti://readme', 'Network kit runbook', 'The ordered plan, ground rules and SSH troubleshooting for the network clean-up', path.join(OPS_DIR, 'README.md')],
    ['status', 'trimurti://status', 'Status sheet', 'The record of what was found and changed; fill it as the work progresses', path.join(OPS_DIR, 'status.md')],
  ];
  for (const [name, uri, title, description, file] of statics) {
    server.registerResource(name, uri, { title, description, mimeType: 'text/markdown' }, async (u) => ({
      contents: [{ uri: u.href, mimeType: 'text/markdown', text: await text(file) }],
    }));
  }

  server.registerResource(
    'inventory',
    'trimurti://inventory',
    { title: 'Inventory CSV', description: 'inventory.csv as-is (name,ip,mac,os,user,role,ssh_port,trimurti,notes); prefer trimurti_list_hosts for parsed rows', mimeType: 'text/csv' },
    async (u) => ({ contents: [{ uri: u.href, mimeType: 'text/csv', text: await text(INVENTORY) }] }),
  );

  server.registerResource(
    'checklist',
    new ResourceTemplate('trimurti://checklists/{name}', {
      list: async () => ({
        resources: (await checklistNames()).map((n) => ({
          uri: `trimurti://checklists/${n}`,
          name: n,
          title: `Checklist: ${n}`,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    {
      title: 'Checklists',
      description: 'network-triage, router-tuning, nas, hulk-drives, trimurti-join: symptom-to-fix tables and gated procedures',
      mimeType: 'text/markdown',
    },
    async (u, vars) => {
      const raw = String(vars.name ?? '');
      const name = raw.replace(/[^a-z0-9-]/g, '');
      const body = name ? await text(path.join(CHECKLISTS_DIR, `${name}.md`)) : `(no checklist named "${raw}"; available: ${(await checklistNames()).join(', ')})`;
      return { contents: [{ uri: u.href, mimeType: 'text/markdown', text: body }] };
    },
  );
}
