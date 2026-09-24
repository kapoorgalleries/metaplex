# trimurti-ops-mcp-server

An MCP server that lets a Claude session on the admin machine drive the network kit in `ops/network` through typed tools instead of raw shell: read and update the inventory, scan the LAN, prove SSH key login, run commands, push the kit's scripts to many machines as background jobs, verify the end state, and probe the NAS. The runbook, status sheet, inventory and checklists are exposed as resources.

It runs on the admin machine (the one Cowork runs on), over stdio. Everything it does is what the scripts in `../scripts` do; the server adds validation, structured results, actionable diagnoses and a job queue for the slow parts.

## Setup

```bash
cd ops/network/mcp
npm install
npm run build          # -> dist/index.js
npm test               # builds, then runs test/unit.mjs and test/smoke.mjs (a scratch copy of ops/network with the
                       # template inventory in test/fixtures, so a filled-in inventory.csv does not matter)
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

Environment (all optional): `TRIMURTI_OPS_DIR` (the `ops/network` directory; default is two levels above `dist/`), `INVENTORY`, `KEY_FILE` (default `~/.ssh/id_ed25519_trimurti`), `OUT_DIR`, and on Windows `TRIMURTI_BASH` (Git Bash's `bash.exe`).

Requirements on the admin machine: Node 20+, `ssh`/`scp` on PATH, and bash for the kit's `.sh` scripts. macOS and Linux have it. On Windows install Git for Windows (`winget install Git.Git`): the server looks for `Program Files\Git\bin\bash.exe`, then for `bin\bash.exe` next to `git --exec-path`, and never uses a bare `bash` (a default Git install does not put it on PATH, and `System32\bash.exe` is WSL, which cannot run the kit); set `TRIMURTI_BASH` if Git lives elsewhere. Its own `ssh`, `ssh-keygen` and `ssh-add` calls use Git's `usr\bin` next to that bash, the same OpenSSH the scripts run in Git Bash, so the key, the ssh-agent `launch.ps1` starts (Git's, which Windows' own OpenSSH cannot read) and `known_hosts` are the same for both; Windows' OpenSSH on PATH only when there is no Git Bash. `trimurti_scan_lan` uses `netscan.ps1` there.

The admin key must already exist and be on every host: `launch.sh` or `launch.ps1` creates it, and `scripts/ssh-keys.sh` pushes it, run once by Sanjay in a terminal, because the first push asks for each host's password and MCP has no terminal. If the key has a passphrase, the launcher loads it into an ssh-agent before it starts Claude or Codex, and this server inherits that agent (`SSH_AUTH_SOCK`; on macOS the Keychain is tried too). The server never starts an agent or asks for a passphrase: without one, every SSH tool stops before contacting any host with `key is passphrase-protected and no ssh-agent holds it: run ssh-add <path>`, followed by what Sanjay does (rerun the launcher; on macOS `ssh-add --apple-use-keychain <path>` in any terminal).

## Tools

| Tool | Read-only | What it does |
|---|---|---|
| `trimurti_list_hosts` | yes | Inventory rows with `name/os/role/trimurti` filters, paging, markdown or JSON |
| `trimurti_upsert_host` | no | Create a row, or change only the fields given (`{name, trimurti: "yes"}` changes nothing else). Strictly validated: IPv4 without leading zeros, MAC, enums, no commas; users as `lib.sh` takes them (a space inside is fine, as in the Windows account `Sanjay Kapoor`; not starting with `-`, no double quote or control character). New names are stored lowercase. Warns when an IP is on two rows |
| `trimurti_remove_host` | no | Delete one row by name (the router's row needs `confirm: true`) |
| `trimurti_scan_lan` | yes | `netscan.sh`/`.ps1`: every host on a private /24 with MAC, name, open ports and hints; double-NAT and 100 Mb warnings. Public or invalid subnets are refused |
| `trimurti_test_ssh` | yes | Key-only login test per host with a diagnosis naming the fix (key missing or locked, wrong user, Windows admin key file, Public profile, nothing listening on the port, host key changed) |
| `trimurti_ssh_run` | no | One command on one inventory host (`default`, `bash` or `powershell` shell), output capped (head and tail kept). `powershell` runs the text as one script (Windows PowerShell on Windows, `pwsh` elsewhere; sent base64 over stdin behind a fixed `-EncodedCommand` bootstrap), so multi-line blocks work, and its exit code is the script's `exit N`, 1 on a parse or terminating error, the last native exit code or 1 when the last command failed, else 0. A `hint` only when ssh itself failed or the command timed out; on Linux and macOS hosts with GNU `timeout` a timed-out `default` or `bash` command is stopped on the host |
| `trimurti_run_script` | no | Push `bootstrap-ai-clis`, `update-all`, `enable-ssh-server` or `disk-triage` to the selected hosts as a background job. Refused, with the `run-remote.sh` command for Sanjay's terminal after his yes: `--harden`, and `update-all`'s `--cleanup`, `--major-upgrade`, `-Drivers`, `-FeatureUpgrades` (every spelling) |
| `trimurti_get_job` / `trimurti_list_jobs` | yes | Job status, and from run-remote.sh's `TRIMURTI_SUMMARY` lines the passed and failed hosts and the hosts whose own run printed `REBOOT_REQUIRED=yes`; log tail |
| `trimurti_verify_hosts` | yes | `verify.sh`: ping, key login and CLI versions per host; `all_green` (computers only, node 20+) and a problems list |
| `trimurti_check_nas` | yes | `nas-check.sh` on a `role=nas` row: ping, open ports, vendor guess, shares, key-only SSH probe, and which `nas.md` section applies |

Which rows the SSH tools touch: without `name` or `role`, computers only (role `admin`, `workstation`, `new`); a `nas`, `printer` or `iot` row only when named or selected by role. The router is never selected, even by name: a `role=router` row, any row whose IP is this machine's default gateway (read from the route table at every call), and any row sharing a router row's IP. A blank `ssh_port` means the device has no SSH: those rows are skipped with "no ssh_port set", never tried on 22. Write 22 for every machine that runs sshd.

Resources: `trimurti://agents` (AGENTS.md: the hard rules; the server's instructions point clients to it first), `trimurti://readme`, `trimurti://status`, `trimurti://inventory`, `trimurti://checklists/{network-triage|router-tuning|nas|hulk-drives|trimurti-join}` (an unknown name lists the available ones).

## Typical flow

Inventory and discovery:

1. `trimurti_scan_lan` → rows with MAC and hints.
2. `trimurti_upsert_host` for each real machine (`name`, `ip`, `mac`, `os`, `user`, `role`, and `ssh_port: 22` if it will run sshd); `trimurti_remove_host` for the template's example rows.
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

- The SSH tools (`trimurti_test_ssh`, `trimurti_ssh_run`, `trimurti_run_script`, `trimurti_verify_hosts`) act only on rows in `inventory.csv`, and `trimurti_check_nas` only on `role=nas` rows. The router (a `role=router` row, this machine's default gateway, or a router row's IP) is refused by every tool with a clear error, whatever its row says; `trimurti_upsert_host` will not give the router's row or IP another role. `trimurti_scan_lan` pings a private /24 you name (or this machine's own) and port-probes every answer except the router.
- Hostnames, IPs, MACs, users, script names and script arguments are validated by schema; ssh gets `--` before the destination, and every process is spawned with an argv array, never a shell string.
- `trimurti_ssh_run` is the one tool that can run anything on a machine; it is annotated destructive so clients ask. `trimurti_remove_host` is annotated destructive too, and so is `trimurti_run_script`, which installs updates and changes sshd and firewall settings on many machines at once. It is limited to the four kit scripts, none of which formats, wipes or reboots, and it refuses the flags AGENTS.md reserves for Sanjay's yes: `--harden`, `--cleanup`, `--major-upgrade`, `-Drivers` and `-FeatureUpgrades`.
- No TTY: `sudo` cannot prompt over these sessions. Linux hosts that need a sudo password for `update-all` or `bootstrap-ai-clis` stop with "sudo needs a password on <host>"; run those locally with `--tty`, or give the admin user passwordless sudo.
- A timed-out `trimurti_ssh_run` on a Windows host, or on a Mac without GNU `timeout`, may keep running there; the hint says so.
- Jobs live in the server process. If the client restarts the server, running jobs keep going but are no longer listed; their logs stay in `out/logs/jobs/`.
- Output is capped (25k characters per result, 10k per stream) and says so when it truncates.

## Evaluation

`evals/evaluation.xml` holds ten read-only questions with fixed answers against the shipped template `inventory.csv`, the checklists, the runbook and the status sheet, in the format the `mcp-builder` evaluation harness expects (`python scripts/evaluation.py -t stdio -c node -a dist/index.js evals/evaluation.xml`). Recheck the answers when any of those files changes.
