# trimurti-ops-mcp-server

An MCP server that lets a Claude session on the admin machine drive the network kit in `ops/network` through typed tools instead of raw shell: read and update the inventory, scan the LAN, prove SSH key login, run commands, push the kit's scripts to many machines as background jobs, verify the end state, and probe the NAS. The runbook, status sheet, inventory and checklists are exposed as resources.

It runs on the admin machine (the one Cowork runs on), over stdio. Everything it does is what the scripts in `../scripts` do; the server adds validation, structured results, actionable diagnoses and a job queue for the slow parts.

## Setup

```bash
cd ops/network/mcp
npm install
npm run build          # -> dist/index.js
npm test               # builds, then runs test/smoke.mjs against a scratch copy of ops/network
```

Register it with Claude Code (absolute path, since the client starts it from anywhere):

```bash
claude mcp add --scope user trimurti-ops -- node "$PWD/dist/index.js"
```

Codex (`../start-codex.sh` does this for you):

```bash
codex mcp add trimurti-ops --env "TRIMURTI_OPS_DIR=$(cd .. && pwd)" -- node "$PWD/dist/index.js"
```

Claude Desktop or Cowork (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "trimurti-ops": { "command": "node", "args": ["/ABSOLUTE/PATH/ops/network/mcp/dist/index.js"] }
  }
}
```

Environment (all optional): `TRIMURTI_OPS_DIR` (the `ops/network` directory; default is two levels above `dist/`), `INVENTORY`, `KEY_FILE` (default `~/.ssh/id_ed25519_trimurti`), `OUT_DIR`.

Requirements on the admin machine: Node 20+, `ssh`/`scp` on PATH, and `bash` (macOS and Linux have it; on Windows install Git for Windows so `bash` resolves to Git Bash, since the kit's `.sh` scripts run through it). The admin key must already exist and be on every host: that is `scripts/ssh-keys.sh`, run once from a terminal, because the first push asks for each host's password and MCP has no terminal.

## Tools

| Tool | Read-only | What it does |
|---|---|---|
| `trimurti_list_hosts` | yes | Inventory rows with `name/os/role/trimurti` filters, paging, markdown or JSON |
| `trimurti_upsert_host` | no | Create or replace one inventory row by name, strictly validated (IPv4, MAC, enums, no commas) |
| `trimurti_scan_lan` | yes | `netscan.sh`/`.ps1`: every host on the /24 with MAC, name, open ports and hints; double-NAT and 100 Mb warnings |
| `trimurti_test_ssh` | yes | Key-only login test per host with a diagnosis naming the fix (Windows admin key file, Public profile, sshd off, host key changed, missing key) |
| `trimurti_ssh_run` | no | One command on one inventory host (`default`, `bash` or `powershell` shell), output capped |
| `trimurti_run_script` | no | Push `bootstrap-ai-clis`, `update-all`, `enable-ssh-server` or `disk-triage` to the selected hosts as a background job |
| `trimurti_get_job` / `trimurti_list_jobs` | yes | Job status, passed/failed hosts, hosts needing a reboot, log tail |
| `trimurti_verify_hosts` | yes | `verify.sh`: ping, key login and CLI versions (claude, codex, gemini, hf, node) per host; `all_green` and a problems list |
| `trimurti_check_nas` | yes | `nas-check.sh`: ping, open ports, vendor guess, shares, SSH probe, and which `nas.md` section applies |

Resources: `trimurti://readme`, `trimurti://status`, `trimurti://inventory`, `trimurti://checklists/{network-triage|router-tuning|nas|hulk-drives|trimurti-join}`.

## Typical flow

Inventory and discovery:

1. `trimurti_scan_lan` → rows with MAC and hints.
2. `trimurti_upsert_host` for each real machine (`name`, `ip`, `mac`, `os`, `user`, `role`).
3. `trimurti_list_hosts` with `trimurti: "no"` to see what still has to be onboarded.

SSH and fan-out:

1. `trimurti_test_ssh` (no filter) → every host `ok`, or a diagnosis per failure.
2. `trimurti_run_script` with `script: "bootstrap-ai-clis"`, `role: "new"` → `job_id`.
3. `trimurti_get_job` until `status: "finished"`; read `passed`, `failed`, `reboot_required`.
4. `trimurti_ssh_run` with `name: "new-pc-2"`, `command: "claude --version"` to spot-check.

Checks:

1. `trimurti_check_nas` → `open_ports`, `vendor_guess`, `next_step`.
2. `trimurti_verify_hosts` → `all_green` or the `problems` list to work through.
3. Read `trimurti://checklists/router-tuning` before touching the router.

## Security and limits

- Every tool acts only on hosts present in `inventory.csv`; rows with `role=router` are never logged into. Hostnames, MACs, script names and script arguments are validated by schema, and every process is spawned with an argv array, never a shell string.
- `trimurti_ssh_run` is the one tool that can run anything on a machine; it is annotated destructive so clients ask. `trimurti_run_script` is limited to the four kit scripts, none of which formats, wipes or reboots.
- No TTY: `sudo` cannot prompt over these sessions. Linux hosts that need a sudo password for `update-all` or `bootstrap-ai-clis` should run those locally, or have passwordless sudo for the admin user.
- Jobs live in the server process. If the client restarts the server, running jobs keep going but are no longer listed; their logs stay in `out/logs/jobs/`.
- Output is capped (25k characters per result, 10k per stream) and says so when it truncates.

## Evaluation

`evals/evaluation.xml` holds ten read-only questions with fixed answers against the template inventory and the checklists, in the format the `mcp-builder` evaluation harness expects (`python scripts/evaluation.py -t stdio -c node -a dist/index.js evals/evaluation.xml`).
