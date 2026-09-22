# Trimurti network kit

Everything needed to run the network clean-up from a **Cowork session on a machine that is on the LAN** (the admin machine). None of this can run from a cloud session: it has no route to the router, the NAS, the PCs or the drives.

Scope, in the order it should be done: discover the LAN → fix the mess → SSH working to every machine → Claude Code, Codex and Gemini CLI on every machine → NAS → Hulk drives → the two new computers into Trimurti → OS updates everywhere → router tuning → verified end state.

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
| 3. AI CLIs everywhere | `verify.sh` shows versions for claude, codex, gemini on every host | `scripts/run-remote.sh bootstrap-ai-clis` (picks `.sh`/`.ps1` per host). Then sign in on each machine; the script prints the browser and no-browser routes. |
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
| `bootstrap-ai-clis.sh` / `.ps1` | each target | Node 20+, Claude Code (native installer), Codex CLI, Gemini CLI; prints versions and the sign-in routes |
| `update-all.sh` / `.ps1` | each target | OS packages, Homebrew/winget, Windows Update, the three CLIs; reports `REBOOT_REQUIRED` and never reboots |
| `nas-check.sh` | admin machine | Ping, port map, vendor guess, share list, SSH probe of the NAS; points at the right `nas.md` section |
| `disk-triage.sh` / `.ps1` | the machine with the drives | Read-only disk inventory and SMART verdict per disk |
| `verify.sh` | admin machine | Ping, key login and CLI versions for every host as a Markdown table |
| `lib.sh` | sourced | Inventory parsing and the `--host/--os/--role/--trimurti` filters |

`inventory.csv` columns: `name,ip,mac,os,user,role,ssh_port,trimurti,notes`. `os` is `windows`, `macos`, `linux`, `nas` or `other`; `role` is `admin`, `workstation`, `nas`, `new`, `router`, `printer` or `iot`. Rows with `role=router` are listed but never logged into.

## Windows: the one thing that cannot be done remotely

`enable-ssh-server.ps1` is what makes a Windows PC reachable over SSH, so it has to be run on that PC once, from an elevated PowerShell (copy the file over on a USB stick or from the NAS share). Give it the admin public key at the same time and that machine is done in one visit:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\enable-ssh-server.ps1 -PublicKey "ssh-ed25519 AAAA... trimurti-admin@gallery-desk"
```

The same applies to a Mac with Remote Login off and a Linux box without `openssh-server`: run the `.sh` locally once.

## SSH troubleshooting (the usual causes, in order)

1. **Windows, admin user, key ignored**: the key must be in `C:\ProgramData\ssh\administrators_authorized_keys` with the file ACL'd to Administrators + SYSTEM only. `%USERPROFILE%\.ssh\authorized_keys` is ignored for administrators. `ssh-keys.sh` and `enable-ssh-server.ps1` do this.
2. **Windows on a Public network profile**: nothing inbound works. `Set-NetConnectionProfile -NetworkCategory Private`.
3. **macOS Remote Login off**, or on but restricted to "Only these users" without yours: System Settings → General → Sharing → Remote Login.
4. **IP moved** since the inventory was written: DHCP reservation, then `ssh-config-gen.sh` again.
5. **Permissions on the target**: `~/.ssh` 700, `authorized_keys` 600, and the home directory itself not group- or world-writable (Synology defaults to 777: `chmod 755 ~`).
6. **Host key changed** (machine reinstalled): `ssh-keygen -R <ip>` on the admin machine, then reconnect.
7. Still stuck: `ssh -vvv <name>` and read the last ten lines; on the target, Linux `sudo journalctl -u ssh -n 50`, Windows `Get-WinEvent -LogName OpenSSH/Operational -MaxEvents 50`.

## Sign-in for the three CLIs (per machine, per user)

- **Claude Code**: `claude` opens a browser. Over SSH press `c` to copy the URL, open it anywhere, paste the code back. Without any browser: `claude setup-token` on a signed-in machine, then `CLAUDE_CODE_OAUTH_TOKEN` on the target. Check: `claude doctor`.
- **Codex**: `codex login` (browser) or `codex login --device-auth` over SSH; API key via `printenv OPENAI_API_KEY | codex login --with-api-key`. Check: `codex login status`.
- **Gemini CLI**: `gemini` → "Login with Google". Over SSH: `NO_BROWSER=true gemini`, paste the code. Or `GEMINI_API_KEY`. Check: `gemini --version` and a one-line prompt `gemini -p "hi"`.

Native Claude Code installs auto-update; Codex and Gemini are npm packages that `update-all` moves to `@latest`.
