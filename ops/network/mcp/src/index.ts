#!/usr/bin/env node
/**
 * trimurti-ops-mcp-server: MCP server that drives the Trimurti network kit
 * (ops/network) from a Claude session on the admin machine. stdio transport;
 * all logging goes to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'node:fs';
import { INVENTORY, KEY_FILE, OPS_DIR, SCRIPTS_DIR } from './constants.js';
import { registerResources } from './resources.js';
import { registerInventoryTools } from './tools/inventory.js';
import { registerNetworkTools } from './tools/network.js';
import { registerScriptTools } from './tools/scripts.js';
import { registerSshTools } from './tools/ssh.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`trimurti-ops-mcp-server (stdio)

Runs the ops/network kit through MCP tools. Start it from an MCP client, e.g.
  claude mcp add --scope user trimurti-ops -- node ${process.argv[1] ?? 'dist/index.js'}

Environment:
  TRIMURTI_OPS_DIR  ops/network directory (default: two levels above this file)
  INVENTORY         inventory.csv path    (default: $TRIMURTI_OPS_DIR/inventory.csv)
  KEY_FILE          admin ssh key         (default: ~/.ssh/id_ed25519_trimurti)
  OUT_DIR           scan/verify/job output (default: $TRIMURTI_OPS_DIR/out)

Tools: trimurti_list_hosts, trimurti_upsert_host, trimurti_scan_lan, trimurti_test_ssh,
       trimurti_ssh_run, trimurti_run_script, trimurti_get_job, trimurti_list_jobs,
       trimurti_verify_hosts, trimurti_check_nas
Resources: trimurti://readme, trimurti://status, trimurti://inventory, trimurti://checklists/{name}
`);
  process.exit(0);
}

const server = new McpServer({ name: 'trimurti-ops-mcp-server', version: '1.0.0' });
registerInventoryTools(server);
registerNetworkTools(server);
registerSshTools(server);
registerScriptTools(server);
registerResources(server);

async function main(): Promise<void> {
  if (!fs.existsSync(SCRIPTS_DIR)) {
    console.error(`WARNING: scripts dir not found at ${SCRIPTS_DIR}; set TRIMURTI_OPS_DIR to the ops/network directory`);
  }
  if (!fs.existsSync(INVENTORY)) console.error(`WARNING: inventory not found at ${INVENTORY}`);
  if (!fs.existsSync(KEY_FILE)) console.error(`note: admin key ${KEY_FILE} does not exist yet; run scripts/ssh-keys.sh first`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`trimurti-ops-mcp-server ready (ops dir ${OPS_DIR})`);
}

main().catch((e: unknown) => {
  console.error('fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
