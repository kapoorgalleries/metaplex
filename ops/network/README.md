# Trimurti network kit

Everything needed to run the network clean-up from an agent session (Codex, Claude Code or Cowork) **on a machine that is on the LAN** (the admin machine). None of this can run from a cloud session: it has no route to the router, the NAS, the PCs or the drives.

Scope, in the order it should be done: discover the LAN → fix the mess → SSH working to every machine → Claude Code, Codex, Gemini CLI and Hugging Face's CLI and MCP server on every machine → NAS → Hulk drives → the two new computers into Trimurti → OS updates everywhere → router tuning → verified end state.

## Hand it to Codex

On the admin machine, from a clone of this branch:

```bash
cd ops/network && ./start-codex.sh                                   # macOS / Linux
powershell -ExecutionPolicy Bypass -File ops\network\start-codex.ps1   # Windows
```

The launcher installs Codex if it is missing, signs it in, builds and registers the `trimurti-ops` MCP server with Codex, and starts Codex in this directory. Codex loads `AGENTS.md` here as its instructions: the job, the done criteria, the actions that always need Sanjay's yes, the questions to ask up front, and the order of work. It records progress in `status.md` and picks up from there next time (`codex resume --last` resumes the conversation itself). Add `--sandboxed` (`-Sandboxed` on Windows) to keep Codex's workspace sandbox with network allowed, at the cost of more approval prompts; `--dry-run` shows what it would do.

Claude Code started in this directory follows the same `AGENTS.md` (through `CLAUDE.md`), so either agent can take over from the other using `status.md`.

## Before starting

- Start Cowork on a machine on the LAN. macOS or Linux runs the `.sh` scripts as-is. On Windows, run the `.sh` scripts from **Git Bash** or **WSL**; `netscan`, `ssh-config-gen`, `enable-ssh-server`, `bootstrap-ai-clis`, `update-all` and `disk-triage` also have native `.ps1` versions.
- Pull this branch, then `cd ops/network` and `chmod +x scripts/*.sh`.
- Have at hand: the router admin URL and password; the NAS admin login; the two new machines powered on and connected; and a decision on what "Trimurti" is (`checklists/trimurti-join.md`, first section).
- Every script's output goes to `out/` (git-ignored). `status.md` is the record; fill it as you go.

## Ground rules

1. **Nothing destructive without an explicit yes.** No wipes, formats, RAID rebuilds, or switching password logins off before key login is proven. The scripts do not contain destructive commands; the only such commands are written out in `checklists/hulk-drives.md` §5 and require a confirmed serial number.
2. **Router changes one at a time, with a way back.** `checklists/router-tuning.md` gives Do / Verify / Undo per item and marks the ones to confirm first. Config backup before anything. Firmware last.
3. **Read-only first.** `netscan`, `nas-check`, `disk-triage` and `verify` change nothing. Run them before and after.

## The order

| Step | Deliverable | How |
|---|---|---|
| 0. Discover | `out/scan-*.csv`; `inventory.csv` filled | `scripts/netscan.sh` (or `netscan.ps1`) on the admin machine, then once more on a second machine to compare. Copy the real machines into `inventory.csv`. |
| 1. Fix the LAN | Single NAT, one DHCP server, one /24, reservations for every named machine, Windows on Private | `checklists/network-triage.md` (symptom table, end state, order of work) |
| 2. SSH everywhere | `ssh <name>` works to every host with the key; results file in `out/` | On each machine once, locally: `enable-ssh-server.sh` / `.ps1` (elevated). Then from the admin machine: `scripts/ssh-keys.sh` → `scripts/ssh-config-gen.sh`. Optional later: `enable-ssh-server.sh --harden` per Linux/macOS host. |
| 3. AI CLIs everywhere | `verify.sh` shows versions for claude, codex, gemini, hf on every host | `scripts/run-remote.sh bootstrap-ai-clis` (picks `.sh`/`.ps1` per host; also registers Hugging Face's MCP server with Codex and Gemini). Then sign in on each machine; the script prints the browser and no-browser routes. |
| 4. NAS | Reachable, shares mount, volume healthy, hardened, backup task | `scripts/nas-check.sh` then `checklists/nas.md` |
| 5. Hulk drives | A verdict and a use per drive, data safe | `scripts/disk-triage.sh` / `.ps1` on the machine they are plugged into, then `checklists/hulk-drives.md` |
| 6. Two new computers | Both rows `trimurti=yes` and green in verify | `checklists/trimurti-join.md` (join step for whatever Trimurti is, plus the per-machine onboarding list) |
| 7. Updates | `REBOOT_REQUIRED` known per host; reboots done | `scripts/run-remote.sh --os linux --tty update-all`, `--os macos --tty`, `--os windows` |
| 8. Router | Every checklist row decided and recorded | `checklists/router-tuning.md` |
| 9. Done | `scripts/verify.sh` all green; `status.md` complete | |

## Scripts

| Script | Runs on | Does |
|---|---|---|
| `netscan.sh` / `netscan.ps1` | admin machine | Sweeps the /24, lists IP/MAC/hostname/open ports, flags double NAT, 100 Mb links, Public profile |
| `enable-ssh-server.sh` / `.ps1` | each target, locally the first time | Turns sshd on, opens the firewall, fixes key file locations and ACLs (Windows admins), sets PowerShell as the SSH shell |
| `ssh-keys.sh` | admin machine | Creates `~/.ssh/id_ed25519_trimurti`, pushes it to every inventory host (asks each password once), proves key-only login |
| `ssh-config-gen.sh` / `.ps1` | admin machine | Generates `~/.ssh/config.d/trimurti` from the inventory so `ssh <name>` works |
| `run-remote.sh` | admin machine | Copies a script to every selected host and runs it (`--host`, `--os`, `--role`, `--trimurti` filters; `--tty` for sudo prompts) |
| `bootstrap-ai-clis.sh` / `.ps1` | each target | Claude Code, Codex and the Hugging Face CLI (`hf`, with its agent skill) via their official installers, Gemini CLI via npm (installs Node 20+ for Gemini, Python 3.10+ for `hf`); registers Hugging Face's MCP server with Codex and Gemini (`--skip-hf` for none, `--with-claude-hf-mcp` for Claude Code too); prints versions and the sign-in routes |
| `update-all.sh` / `.ps1` | each target | OS packages, Homebrew/winget, Windows Update, the AI CLIs including `hf`; reports `REBOOT_REQUIRED` and never reboots |
| `nas-check.sh` | admin machine | Ping, port map, vendor guess, share list, SSH probe of the NAS; points at the right `nas.md` section |
| `disk-triage.sh` / `.ps1` | the machine with the drives | Read-only disk inventory and SMART verdict per disk |
| `verify.sh` | admin machine | Ping, key login and CLI versions for every host as a Markdown table |
| `lib.sh` | sourced | Inventory parsing and the `--host/--os/--role/--trimurti` filters |

`inventory.csv` columns: `name,ip,mac,os,user,role,ssh_port,trimurti,notes`. `os` is `windows`, `macos`, `linux`, `nas` or `other`; `role` is `admin`, `workstation`, `nas`, `new`, `router`, `printer` or `iot`. Rows with `role=router` are listed but never logged into.

## MCP server (optional, recommended for the Cowork session)

`mcp/` holds `trimurti-ops-mcp-server`, which exposes the kit to a Claude session as typed tools: list and update the inventory, scan the LAN, test key login with a diagnosis per failure, run a command on a host, push the bootstrap/update/disk-triage scripts to many hosts as background jobs, verify the end state, and check the NAS. The runbook, status sheet and checklists are resources. Build and register it once on the admin machine:

```bash
cd ops/network/mcp && npm install && npm run build && npm test
claude mcp add --scope user trimurti-ops -- node "$PWD/dist/index.js"
```

See `mcp/README.md` for the tool list, the typical flow and the limits (it cannot push the admin key for the first time; `scripts/ssh-keys.sh` in a terminal does that).

## Windows: the one thing that cannot be done remotely

`enable-ssh-server.ps1` is what makes a Windows PC reachable over SSH, so it has to be run on that PC once, from an elevated PowerShell (copy the file over on a USB stick or from the NAS share). Give it the admin public key at the same time and that machine is done in one visit:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\enable-ssh-server.ps1 -PublicKey "ssh-ed25519 AAAA... trimurti-admin@gallery-desk"
```

The same applies to a Mac with Remote Login off and a Linux box without `openssh-server`: run the `.sh` locally once.

## SSH troubleshooting (the usual causes, in order)

1. **Windows, admin user, key ignored**: the key must be in `C:\ProgramData\ssh\administrators_authorized_keys` with the file ACL'd to Administrators + SYSTEM only. `%USERPROFILE%\.ssh\authorized_keys` is ignored for administrators. `ssh-keys.sh` and `enable-ssh-server.ps1` do this, using the group SIDs so it also works on non-English Windows. A PC signed in with a Microsoft Entra ID (work or school) account cannot use key login with the in-box OpenSSH; give such a machine a local administrator account for SSH.
2. **Windows on a Public network profile**: the machine is hidden and file sharing, discovery and ping are blocked, because those built-in rules are Private-only. The SSH rule `enable-ssh-server.ps1` creates covers all profiles, so SSH can work while SMB does not. `Set-NetConnectionProfile -InterfaceIndex N -NetworkCategory Private`.
3. **macOS Remote Login off**, or on but restricted: System Settings → General → Sharing → Remote Login on, then its (i) button: "Allow access for" All users, or your user listed; tick "Allow full disk access for remote users" if SSH sessions must reach protected folders. From a terminal, `sudo systemsetup -setremotelogin on` only works when that terminal app has Full Disk Access. On a Mac admin machine, load the key into the Keychain once so it survives reboots: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519_trimurti` (`ssh-keys.sh` does this; `ssh-config-gen.sh` adds `UseKeychain yes`).
4. **IP moved** since the inventory was written: DHCP reservation, then `ssh-config-gen.sh` again.
5. **Permissions on the target**: `~/.ssh` 700, `authorized_keys` 600, and the home directory itself not group- or world-writable (Synology defaults to 777: `chmod 755 ~`).
6. **Host key changed** (machine reinstalled): `ssh-keygen -R <ip>` on the admin machine, then reconnect.
7. Still stuck: `ssh -vvv <name>` and read the last ten lines; on the target, Linux `sudo journalctl -u ssh -n 50`, Windows `Get-WinEvent -LogName OpenSSH/Operational -MaxEvents 50`.
8. **What a Windows SSH session can and cannot do**: for a member of Administrators it is elevated, so installs work; but it is a network logon, so it carries no credentials for other machines and the Windows Update Agent refuses it. `update-all.ps1` therefore runs Windows Update through a local scheduled task, and `winget` may need its full path (the scripts find it).

## Sign-in for the AI CLIs (per machine, per user)

- **Claude Code**: `claude` (or `claude auth login`) opens a browser. Over SSH press `c` to copy the URL, open it anywhere, paste the code back. Without any browser on the target: `claude setup-token` on any machine with a browser prints a one-year token (Pro, Max, Team or Enterprise; model requests only, no Remote Control or connectors), then set `CLAUDE_CODE_OAUTH_TOKEN` on the target. Check the login with `claude auth status`; `claude doctor` checks the install, not the login. Over SSH on a Mac the Keychain is locked, so the login is stored in `~/.claude/.credentials.json` (mode 600), which is expected. If `ANTHROPIC_API_KEY` is set in a machine's environment, Claude Code bills that key instead of the subscription, so unset it here. One subscription on many machines is fine; they share one usage pool. Claude's native binary needs a CPU with AVX (pre-2013 machines lack it; the bootstrap checks).
- **Codex**: `codex login` (browser), or over SSH `codex login --device-auth` after enabling device-code sign-in under ChatGPT Settings → Security, or forward the callback with `ssh -L 1455:localhost:1455 <host>` and log in through the forwarded browser. API key via `printenv OPENAI_API_KEY | codex login --with-api-key` (exporting the variable alone is not a login). Credentials live in `~/.codex/auth.json`. Check: `codex login status`; `codex doctor` for the install.
- **Gemini CLI**: `gemini` → "Sign in with Google". Over SSH with a terminal (`ssh -t`): `NO_BROWSER=true gemini` prints a URL and asks for the authorization code, which must be pasted within five minutes. A Google Workspace account (not personal Gmail) must export `GOOGLE_CLOUD_PROJECT` first; a personal account must leave it unset. Or `GEMINI_API_KEY` from https://aistudio.google.com/app/apikey. Check: `gemini --version` and a one-line prompt `gemini -p "hi"`.
- **Hugging Face CLI**: `hf auth login` (over SSH with `ssh -t`). "Log in with your browser" prints a URL and a code to enter on any machine; "Paste an access token" reads one at a hidden prompt. For the token route make one token per machine at https://huggingface.co/settings/tokens with the **Read** role, which is all downloads and the MCP server need. `HF_TOKEN` in the environment overrides the stored login. Check: `hf auth whoami`.
- **Hugging Face MCP server** (`https://huggingface.co/mcp`, registered as `huggingface` at user scope):
  - Codex: OAuth, `codex mcp login huggingface`; over SSH add `--no-browser` and paste the redirect URL back. The bootstrap appends the `[mcp_servers.huggingface]` table itself because `codex mcp add` would start that browser flow unattended.
  - Gemini: its OAuth needs a browser and a localhost callback on the machine itself, so it sends `Authorization: Bearer ${HF_TOKEN}` instead, expanded by Gemini at start. `HF_TOKEN="$(hf auth token)" gemini` reuses the `hf` login without typing the token; without it Gemini gets HF's anonymous read-only tools. Gemini loads MCP servers only in folders it trusts.
  - Claude Code: nothing to register. A claude.ai login already brings the account's Hugging Face connector, and a server added in Claude Code at the same URL would take precedence and hide it (a different URL would duplicate its tools). A machine signed in with `claude setup-token` or an API key fetches no connectors: run the bootstrap with `--with-claude-hf-mcp` there, then `claude mcp login huggingface`.
  - The bootstrap also has Codex and Gemini drop `hf_jobs`, `create_repo`, `dynamic_space` and the sandbox tools. HF's URL presets only change which tools are advertised, so the filter has to live in the client. The tools each account exposes are set at https://huggingface.co/settings/mcp; keep Jobs, Contribute Repos, Sandboxes and Dynamic Spaces off there, since they create repos, run code or can spend credits.

Claude Code and Codex are installed by their official installers and self-update (`claude update`, `codex update`). Gemini CLI is an npm package that also updates itself on launch; `update-all` still moves it to `@latest`. `hf` comes from Hugging Face's installer (a Python venv in `~/.hf-cli`, `hf` in `~/.local/bin`, plus the `hf-cli` skill in `~/.agents/skills` and `~/.claude/skills`); `hf update` upgrades both, and `update-all` runs it.
