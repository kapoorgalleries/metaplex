# Trimurti network kit

Everything needed to run the network clean-up from an agent session (Codex, Claude Code or Cowork) **on a machine that is on the LAN** (the admin machine). None of this can run from a cloud session: it has no route to the router, the NAS, the PCs or the drives.

Scope, in the order it should be done: discover the LAN → fix the mess → SSH working to every machine → Claude Code, Codex and Gemini CLI on every machine → NAS → Hulk drives → the two new computers into Trimurti → OS updates everywhere → router tuning → verified end state.

## Hand it to Codex

On the admin machine, from a clone of this branch:

```bash
cd ops/network && ./start-codex.sh                                   # macOS / Linux
powershell -ExecutionPolicy Bypass -File ops\network\start-codex.ps1   # Windows
```

The launcher installs Codex if it is missing, signs it in, builds and registers the `trimurti-ops` MCP server with Codex (the Windows launcher installs Node 20+ for it first), marks `inventory.csv` and `status.md` skip-worktree (`start-codex.sh`) so `git commit -a` leaves the network map out (undo: `git update-index --no-skip-worktree inventory.csv status.md`), and starts Codex in this directory. Codex loads `AGENTS.md` here as its instructions: the job, the done criteria, the actions that always need Sanjay's yes, the questions to ask up front, and the order of work. It records progress in `status.md` and picks up from there next time (`codex resume --last` resumes the conversation itself). Add `--sandboxed` (`-Sandboxed`) to keep Codex's workspace sandbox with network allowed and `~/.ssh` writable, at the cost of more approval prompts; `--dry-run` (`-DryRun`) shows what it would do. Other words go into Codex's first prompt; an unknown flag exits 2.

Claude Code started in this directory follows the same `AGENTS.md` (through `CLAUDE.md`), so either agent can take over from the other using `status.md`.

## Before starting

- Start the agent on a machine on the LAN. macOS or Linux runs the `.sh` scripts as-is. On Windows, run them from **Git Bash** (Git for Windows), not WSL: WSL has its own `~/.ssh`, and under WSL2's default NAT networking `netscan` sees a 172.x network instead of the LAN. `netscan`, `ssh-config-gen`, `enable-ssh-server`, `bootstrap-ai-clis`, `update-all` and `disk-triage` also have native `.ps1` versions.
- macOS 15 and later: a script started by an app (Codex or Claude desktop, Cowork, an IDE) reaches LAN hosts only once that app is allowed under System Settings → Privacy & Security → Local Network; until then pings and connects fail with "No route to host". Scripts run from Terminal or over SSH are exempt.
- Pull this branch, then `cd ops/network` and `chmod +x scripts/*.sh`.
- Have at hand: the router admin URL and password; the NAS admin login; the two new machines powered on and connected; and a decision on what "Trimurti" is (`checklists/trimurti-join.md`, first section).
- Every script's output goes to `out/` (git-ignored). `status.md` is the record; fill it as you go. `inventory.csv` and `status.md` stay local changes: never commit them.
- Every script takes `-h`/`--help` (prints its usage, changes nothing). Filters work as `--host a,b` or `--host=a,b`; an unknown flag exits 2 and never widens a run. `bootstrap-ai-clis.ps1` and `update-all.ps1` also accept the `.sh` flag spellings, so one `run-remote.sh` argument list works for mixed hosts.
- Where a script needs sudo and has no terminal to ask in, the steps that need it fail with `sudo needs a password on <host>: rerun with --tty or run it locally`, and the script exits 1. `--tty` needs a real terminal, so those runs are Sanjay's, unless the host's sudo needs no password.

## Ground rules

1. **Nothing destructive without an explicit yes.** No wipes, formats, RAID rebuilds, reboots, or switching password logins off before key login is proven. The scripts contain no destructive commands. The checklists mark every step that needs Sanjay's yes with **ASK**: the wipes and formats in `hulk-drives.md` (by serial number), pulling disks and RAID repair in `nas.md`, renames, joins and reboots in `trimurti-join.md`, and router changes.
2. **Router changes one at a time, with a way back.** `checklists/router-tuning.md` gives Do / Verify / Undo per item; every row needs Sanjay's yes. Config backup before anything. Firmware last.
3. **Read-only first.** `netscan`, `nas-check`, `disk-triage` and `verify` change nothing on any device; they write only under `out/` on this machine (`nas-check`'s key-only SSH probe may add the NAS to `~/.ssh/known_hosts`). Run them before and after.

## The order

| Step | Deliverable | How |
|---|---|---|
| 0. Discover | `out/scan-*.csv`; `inventory.csv` filled | `scripts/netscan.sh` (or `netscan.ps1`) on the admin machine, then once more on a second machine to compare. Copy the real machines into `inventory.csv` (its header comment explains each column). |
| 1. Fix the LAN | Single NAT, one DHCP server, one /24, reservations for every named machine, Windows on Private | `checklists/network-triage.md` (symptom table, end state, order of work) |
| 2. SSH everywhere | `ssh <name>` works to every computer with the key; `out/ssh-keys-*.txt` | Create the admin key first ("Windows" below). On each machine once, locally: `enable-ssh-server.sh` as the everyday user without sudo (it calls sudo itself), or `enable-ssh-server.ps1` elevated. Then Sanjay, in a terminal on the admin machine: `scripts/ssh-keys.sh` → `scripts/ssh-config-gen.sh`. The new PCs follow in step 6 and the NAS in step 4, so their rows fail or are skipped now; leave them out with `--host a,b`. Optional later: `enable-ssh-server.sh --harden` (**ASK**). |
| 3. AI CLIs | `verify.sh` shows claude, codex, gemini and node 20+ on every computer | `scripts/run-remote.sh bootstrap-ai-clis` (computers only; `.sh` or `.ps1` per host). Where sudo asks for a password, Sanjay runs `scripts/run-remote.sh --tty --host <name> bootstrap-ai-clis` in his terminal. Then sign in on each machine; the script prints the browser and no-browser routes. |
| 4. NAS | Reachable, shares mount, volume healthy, hardened, backup task | `scripts/nas-check.sh` then `checklists/nas.md`. Once its SSH is on: `ssh_port` 22 on its row, then `ssh-keys.sh --host nas`. |
| 5. Hulk drives | A verdict and a use per drive, data safe | `scripts/disk-triage.sh` / `.ps1` on the machine they are plugged into, then `checklists/hulk-drives.md` |
| 6. Two new computers | Both rows `trimurti=yes` and green in verify | `checklists/trimurti-join.md` (join step for whatever Trimurti is, plus the per-machine onboarding list) |
| 7. Updates | `REBOOT_REQUIRED` known per host; reboots done with a yes | `scripts/run-remote.sh --os linux --tty update-all` and `--os macos --tty update-all` in Sanjay's terminal (without `--tty` where sudo needs no password), `--os windows update-all`. The hosts to reboot are on the `TRIMURTI_SUMMARY reboot_required=` line. |
| 8. Router | Every checklist row decided and recorded | `checklists/router-tuning.md` |
| 9. Done | `scripts/verify.sh` exits 0 (every computer green); sign-ins and `status.md` complete | |

## Scripts

| Script | Runs on | Does |
|---|---|---|
| `netscan.sh` / `netscan.ps1` | admin machine | Sweeps the /24: IP, MAC, hostname, open ports, a hint per host. Pings the router but never port-probes it. Flags double NAT (`DOUBLE NAT likely`, `possible double NAT`, or inconclusive: confirm with the router's WAN IP), ISP CGNAT, 100 Mb links, a Public profile. `.ps1` also lists neighbour-cache entries that did not answer, hint `stale ARP` |
| `enable-ssh-server.sh` / `.ps1` | each target, locally the first time | Turns sshd on at boot (systemd, OpenRC, or an sshd already running), opens the firewall, prepares the login user's `~/.ssh`. `.sh`: as the everyday user, without sudo (`--user NAME` for another user). `.ps1`: elevated, see "Windows" below |
| `ssh-keys.sh` | admin machine, in Sanjay's terminal | Creates `~/.ssh/id_ed25519_trimurti` if missing (with a passphrase, loaded into the ssh-agent, macOS: the Keychain; with no agent running it uses one for that run only and says how to keep one), pushes it to the selected hosts (each password once), proves key-only login. Without a terminal it stops and changes nothing, unless `--no-passphrase` (an unprotected key, on purpose; it can then only check hosts that already have the key). Computers by default; the NAS with `--host nas` |
| `ssh-config-gen.sh` / `.ps1` | admin machine | Writes `~/.ssh/config.d/trimurti` so `ssh <name>` works: a Host block per row with a user and an `ssh_port` (others get a warning), key path quoted. If `ssh -G` rejects the new file, the old one stays (exit 1). `.ps1`: `-KeyFile` |
| `run-remote.sh` | admin machine | Copies a script to the selected hosts and runs it, `.sh` or `.ps1` by the host's `os`. Computers only unless `--host` or `--role` names others; never the router. Filters and `--tty` go before the script name, the script's own flags after it (letters, digits and `. _ = : / , @ + \ -` only). `--tty` needs a real terminal. Ends with `TRIMURTI_SUMMARY passed=`, `failed=` and `reboot_required=` lines (comma-separated names) and exits 0 only if none failed. Logs: `out/logs/<host>-<script>-<time>-<pid>.log`, without colour codes |
| `bootstrap-ai-clis.sh` / `.ps1` | each target | Claude Code and Codex via their official installers, Gemini CLI via npm with Node 20+ (never an older distro Node), each on the PATH of a plain `ssh <host> <cli>` (a line atop `~/.bashrc`, `~/.zshenv`, or on Arch `/usr/local/bin` links to the installing user's copies, which every user of that PC then shares). Last line `INSTALL OK on <host>`, or `INSTALL INCOMPLETE on <host>, failed: ...` and exit 1 (`<cli>-path`: installed, but a plain ssh command does not find it). Arch installs with `pacman -S --needed` (no `-y`): update a stale system first. `.ps1`: `-WithNode`, `-WithGit` |
| `update-all.sh` / `.ps1` | each target | OS packages (apt `upgrade --with-new-pkgs`, which removes nothing), Homebrew, snap/flatpak, winget, Windows Update (security and critical only unless `-AllUpdates`; through a SYSTEM scheduled task, log in `C:\ProgramData\trimurti\windows-update.log`), and the three CLIs. Never reboots. **ASK** flags: `--cleanup` (apt autoremove, Homebrew cleanup), `--major-upgrade` (a new macOS, reported as `MACOS_MAJOR_UPGRADE_AVAILABLE=`), `-Drivers`, `-FeatureUpgrades`. A failed step prints `UPDATE_FAILED=<steps>` and exits 1; the last line is `REBOOT_REQUIRED=yes\|no\|unknown` |
| `nas-check.sh` | admin machine | `[--smb-user USER] [host-or-ip] [ssh-user]`: ping, port map, vendor guess, share list (guest, or as `--smb-user`: smbclient asks in a terminal), SMB1 check, key-only SSH probe of the NAS (its row's `ssh_port` and user). Never the router (exit 2). Points at the right `nas.md` section |
| `disk-triage.sh` / `.ps1` | the machine with the drives | Read-only disk inventory and a SMART verdict per disk (`HEALTHY`, `WATCH`, `FAILING`, or `UNKNOWN` with its reason); SMART needs root (`run-remote.sh --tty --host X disk-triage`). Run from the kit it saves `out/disks-<host>-<stamp>.txt`; pushed, the output is only in `out/logs/`. A failed step prints `DISK_TRIAGE_FAILED=` and exits 1. `.ps1`: elevated, saves to `%USERPROFILE%`, prints its grading rule instead of a verdict per disk |
| `verify.sh` | admin machine | Ping, key login, claude/codex/gemini/node versions and the OS per host as a Markdown table (`out/verify-*.md`). Lists every row but the router; only computers need the CLIs and count (others show `n/a`). This machine's row with a blank `ssh_port` is probed locally (`ssh key` n/a); the `ssh key` cell may name a skip reason (`no ssh_port set`). Exits 0 only when every selected computer is green, else prints `<n> of <m> computers not green` with the reasons |
| `lib.sh` | sourced | Inventory parsing, host selection, the `--host/--os/--role/--trimurti` filters, the key checks |

`enable-ssh-server.sh --harden` (**ASK**; only after `ssh-keys.sh` PASSes for that host) turns password logins off in `/etc/ssh/sshd_config.d/00-trimurti.conf`, which sorts first because sshd keeps the first value it reads (it replaces the kit's older `50-trimurti.conf`). It refuses to start when `sudo sshd -t` already fails, and restarts sshd only when `sshd -T` confirms key-only for that user and the admin's address; otherwise it removes its file, lists the overriding `file:line` entries (a line read earlier, a `Match` block) and exits 1. The MCP tools refuse `--harden`: after Sanjay's yes he runs `scripts/run-remote.sh --host <name> --tty enable-ssh-server --harden`.

`inventory.csv` columns: `name,ip,mac,os,user,role,ssh_port,trimurti,notes`; its header comment explains each one, and Excel's "CSV UTF-8" is fine. The computers (`role` admin, workstation or new) are what the kit sets up; `nas`, `printer` and `iot` rows are touched only when named with `--host` or `--role`; the router (`role=router`, or any row whose IP is this machine's default gateway) is never logged into or port-probed. A blank `ssh_port` means no SSH on that device ("no ssh_port set"), so write 22 explicitly. `trimurti=yes` once a machine is in Trimurti. Windows PCs answer ping, which `verify.sh` needs for green, only with the Echo Request rule on (SSH troubleshooting 2). Alpine has no bash by default and `run-remote.sh` runs `bash <script>`: `apk add bash` there first.

## MCP server (optional, recommended for the Cowork session)

`mcp/` holds `trimurti-ops-mcp-server`, which exposes the kit to an agent session as typed tools: list, update and remove inventory rows, scan the LAN, test key login with a diagnosis per failure, run a command on a host, push the bootstrap/update/disk-triage scripts to many hosts as background jobs, verify the end state, and check the NAS. `AGENTS.md` (`trimurti://agents`, which the server tells clients to read first), the runbook, status sheet and checklists are resources. Like the scripts, its SSH tools touch computers only unless a name or role is given, and never the router. Build and register it once on the admin machine (`npm test` runs against a fixture inventory, so a filled-in `inventory.csv` does not matter):

```bash
cd ops/network/mcp && npm install && npm run build && npm test
claude mcp add --scope user trimurti-ops -- node "$PWD/dist/index.js"
```

See `mcp/README.md` for the tool list, the typical flow and the limits (it cannot push the admin key for the first time; `scripts/ssh-keys.sh` in a terminal does that). On Windows it finds Git Bash by itself (`Program Files\Git\bin\bash.exe`, then next to `git --exec-path`; `TRIMURTI_BASH` overrides) and never uses WSL's bash. A passphrase-protected admin key must be loaded in an ssh-agent that the MCP client inherits.

## Windows: the one thing that cannot be done remotely

`enable-ssh-server.ps1` is what makes a Windows PC reachable over SSH, so it has to be run on that PC once, from an elevated PowerShell (copy the file over on a USB stick or from the NAS share). Create the admin key on the admin machine first and bring its public half along, and that machine is done in one visit:

```bash
ssh-keygen -t ed25519 -a 64 -C trimurti-admin -f ~/.ssh/id_ed25519_trimurti   # admin machine (Git Bash on Windows)
```

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\enable-ssh-server.ps1 -PublicKey (Get-Content .\id_ed25519_trimurti.pub)
```

Give the key a passphrase: `ssh-keys.sh` later loads it into the ssh-agent, which every shell and MCP client using the kit then needs (troubleshooting 0). An empty passphrase (`ssh-keys.sh --no-passphrase`) needs no agent, but whoever copies the file gets into every machine: only on an admin machine nobody else uses.

The script allows SSH on port 22 from the local subnet only (Domain and Private profiles); switches the LAN interface (the one with the default route) from Public to Private, leaving VPN and hotspot adapters alone (`-KeepPublicProfile` keeps it Public, and the rule then covers Public too); writes `administrators_authorized_keys` as UTF-8 without BOM, owned by Administrators, readable by Administrators and SYSTEM only; prints the inventory row to add; and ends with `ENABLE-SSH OK on <host>` or `ENABLE-SSH INCOMPLETE on <host>, failed: ...` (exit 1).

The same applies to a Mac with Remote Login off and a Linux box without `openssh-server`: run `enable-ssh-server.sh` there once, locally, as the everyday user.

## SSH troubleshooting (the usual causes, in order)

0. **`key is passphrase-protected and no ssh-agent holds it: run ssh-add <path>`**: the shell or MCP client running the kit has no agent holding the key. bash and Git Bash: `eval "$(ssh-agent -s)"; ssh-add ~/.ssh/id_ed25519_trimurti` (Git Bash: put both lines in `~/.bashrc`, so the shell the agent's tool runs gets them too). macOS: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519_trimurti` (`-K` on macOS 11 and older); the kit reloads Keychain-held keys by itself. Windows `ssh.exe` (the MCP server's own SSH tools on Windows), elevated: `Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent`, then `ssh-add $HOME\.ssh\id_ed25519_trimurti`; Git Bash's ssh cannot see that agent, so the `.sh` scripts need the Git Bash one as well. Or make the key with `ssh-keys.sh --no-passphrase` on a trusted admin machine. Other failures show ssh's own last error line.
1. **Windows, admin user, key ignored**: the key must be in `C:\ProgramData\ssh\administrators_authorized_keys` with the file ACL'd to Administrators + SYSTEM only. `%USERPROFILE%\.ssh\authorized_keys` is ignored for administrators. `ssh-keys.sh` and `enable-ssh-server.ps1` do this, using the group SIDs so it also works on non-English Windows. A PC signed in with a Microsoft Entra ID (work or school) account cannot use key login with the in-box OpenSSH; give such a machine a local administrator account for SSH.
2. **Windows on a Public network profile**: the machine is hidden and file sharing, discovery and ping are blocked, because those built-in rules are Private-only. `enable-ssh-server.ps1` switches only the LAN interface (the one with the default route) to Private and allows SSH from the local subnet only, so SSH can work while SMB does not. By hand: `Set-NetConnectionProfile -InterfaceIndex N -NetworkCategory Private`. Ping also needs the Echo Request rule, which is off on a fresh Windows (elevated): `Set-NetFirewallRule -Name FPS-ICMP4-ERQ-In -Enabled True`.
3. **macOS Remote Login off**, or on but restricted: System Settings → General → Sharing → Remote Login on, then its (i) button: "Allow access for" All users, or your user listed; tick "Allow full disk access for remote users" if SSH sessions must reach protected folders. From a terminal, `sudo systemsetup -setremotelogin on` only works when that terminal app has Full Disk Access. On a Mac admin machine `ssh-keys.sh` stores the key's passphrase in the Keychain and `ssh-config-gen.sh` adds `UseKeychain yes`, so it survives reboots.
4. **IP moved** since the inventory was written: DHCP reservation, then `ssh-config-gen.sh` again.
5. **Permissions on the target**: `~/.ssh` 700, `authorized_keys` 600, and the home directory itself not group- or world-writable (Synology defaults to 777: `chmod 755 ~`).
6. **Host key changed** (machine reinstalled): `ssh-keygen -R <ip>` on the admin machine, then reconnect.
7. Still stuck: `ssh -vvv <name>` and read the last ten lines; on the target, Linux `sudo journalctl -u ssh -n 50`, Windows `Get-WinEvent -LogName OpenSSH/Operational -MaxEvents 50`.
8. **What a Windows SSH session can and cannot do**: for a member of Administrators it is elevated, so installs work; but it is a network logon, so it carries no credentials for other machines and the Windows Update Agent refuses it. `update-all.ps1` therefore runs Windows Update through a local scheduled task, and `winget` may need its full path (the scripts find it).

## Sign-in for the three CLIs (per machine, per user)

Never type a token or key into a command line, `export X=...` included: it lands in the shell history. The routes below read it with echo off (bash and zsh: `printf` for the prompt, because `read -p` means a coprocess in zsh; PowerShell: `Read-Host -AsSecureString`, which the `.ps1` prints). It lasts for that shell only; keeping it means a mode-600 file outside the repo, and only with Sanjay's yes. The browser or device sign-in is preferred: each CLI stores it by itself.

- **Claude Code**: `claude` (or `claude auth login`) opens a browser. Over SSH press `c` to copy the URL, open it anywhere, paste the code back. Without any browser on the target: `claude setup-token` on any machine with a browser prints a one-year token (Pro, Max, Team or Enterprise; model requests only, no Remote Control or connectors), then on the target `printf 'token: '; read -rs CLAUDE_CODE_OAUTH_TOKEN; echo; export CLAUDE_CODE_OAUTH_TOKEN`. Check the login with `claude auth status`; `claude doctor` checks the install, not the login. Over SSH on a Mac the Keychain is locked, so the login is stored in `~/.claude/.credentials.json` (mode 600), which is expected. If `ANTHROPIC_API_KEY` is set in a machine's environment, Claude Code bills that key instead of the subscription, so unset it here. One subscription on many machines is fine; they share one usage pool. Claude's native binary needs a CPU with AVX (pre-2013 machines lack it); the bootstrap checks this on Linux only.
- **Codex**: `codex login` (browser), or over SSH `codex login --device-auth` after enabling device-code sign-in under ChatGPT Settings → Security, or forward the callback with `ssh -L 1455:localhost:1455 <host>` and log in through the forwarded browser. API key: `printf 'key: '; read -rs K; echo; printf '%s' "$K" | codex login --with-api-key; unset K` (exporting `OPENAI_API_KEY` alone is not a login). Credentials live in `~/.codex/auth.json`. Check: `codex login status`; `codex doctor` for the install.
- **Gemini CLI**: `gemini` → "Sign in with Google". Over SSH with a terminal (`ssh -t`): `NO_BROWSER=true gemini` prints a URL and asks for the authorization code, which must be pasted within five minutes. A Google Workspace account (not personal Gmail) must export `GOOGLE_CLOUD_PROJECT` first; a personal account must leave it unset. Or an API key from https://aistudio.google.com/app/apikey: `printf 'key: '; read -rs GEMINI_API_KEY; echo; export GEMINI_API_KEY`. Check: `gemini --version` and a one-line prompt `gemini -p "hi"`. On Windows, npm's `gemini.ps1` does not run under the default Restricted execution policy: type `gemini.cmd` in PowerShell (cmd.exe finds `gemini`; over SSH `ssh -t <host> gemini.cmd`). Changing the policy needs Sanjay's yes.

Claude Code and Codex are installed by their official installers and self-update (`claude update`, `codex update`). Gemini CLI is an npm package that also updates itself on launch; `update-all` still moves it to `@latest`. Record each sign-in in `status.md` (Signed in table).
