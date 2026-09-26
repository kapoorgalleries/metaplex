# Trimurti network job: instructions for the agent

You are running on the gallery's admin machine, on the LAN. Codex and Claude Code both load this file when started in `ops/network` (`./start-codex.sh` does that). Sanjay Kapoor, the gallery director, is the only person you answer to. He is technical and wants the work done, not described. Keep updates short.

## The job, in Sanjay's words

"Get this network sorted out, it's a mess. Get Codex, Claude and Gemini on every machine, have their SSH work perfectly, fix the NAS and see what you can do with the Hulk drives. Add the two new computers to Trimurti. Update all of the PCs and fine-tune the router."

Done means all of this is true:

- One router, one subnet, one DHCP server, no double NAT, a DHCP reservation for every machine (`checklists/network-triage.md`, "What sorted means").
- `ssh <name>` works with the admin key from this machine to every computer in `inventory.csv` (role `admin`, `workstation` or `new`; this machine itself only if its row has an `ssh_port`), and to the NAS once its SSH is on.
- `claude`, `codex`, `gemini` and `hf` are installed and signed in on every computer, and each agent reaches Hugging Face's MCP server (Codex and Gemini through the bootstrap's registration; Claude through the claude.ai connector, or `--with-claude-hf-mcp` on a machine without a claude.ai login). `verify.sh` proves the install; prove each sign-in on the machine (`claude auth status`, `codex login status`, `gemini -p "hi"`, `hf auth whoami`) and record it in `status.md`'s Signed in table.
- The NAS is reachable, its shares mount from every PC, its volume is healthy, and it is hardened.
- Every Hulk drive has a verdict, its data is safe, and it has a job.
- Both new computers are onboarded and `trimurti=yes` in the inventory.
- Every machine is updated, and Sanjay knows which ones still need a reboot.
- Every router checklist row is decided and recorded.
- `scripts/verify.sh` exits 0 (every computer green; NAS and printer rows show `n/a` and do not count), and `status.md` is filled in.

## Resume first

Read `status.md` before anything else. If it has entries, continue from the first unfinished step below instead of starting over. Update `status.md` after every step.

## Hard rules

Ask Sanjay and wait for a yes before you:

- change any router setting (one change at a time, config backup first, verify after each). He may approve unmarked rows of `checklists/router-tuning.md` as a named list; each row marked **ASK** needs its own yes;
- wipe, format, secure-erase, repartition, or `ddrescue` onto any disk, put a disk into a NAS bay, start a RAID rebuild or repair, or pull a disk from the NAS. Name the drive by serial number when you ask;
- reboot or shut down any machine, rename one, or join it to a workgroup or domain (those reboot);
- run `enable-ssh-server.sh --harden` (turns password logins off). The MCP tools refuse it: after his yes, give him `scripts/run-remote.sh --host <name> --tty enable-ssh-server --harden` for his terminal;
- run `update-all` with `--cleanup` (removes packages and caches) or `--major-upgrade` (a new macOS version), or `update-all.ps1` with `-Drivers` or `-FeatureUpgrades` (a new Windows version). The MCP tools refuse these flags: after his yes, give him `scripts/run-remote.sh --host <name> --tty update-all <the flag>`;
- change a PC's PowerShell execution policy;
- delete anything that is not in `out/`;
- install software on a machine that is not in `inventory.csv`;
- commit, push, or post anything anywhere.

Every step in the checklists that needs this yes is marked **ASK**, except in `router-tuning.md`, where every row needs it.

Never:

- write a password, token, API key or private key into any file, log, `out/`, or `status.md`, or have one typed inline (`export X=...` lands in shell history). Secrets go only into the prompt that asks for them: `printf 'key: '; read -rs X` in bash or zsh (not `read -p`, a coprocess in zsh), `Read-Host -AsSecureString` in PowerShell. Your shell has no terminal, so Sanjay types them in his;
- commit `inventory.csv`, `status.md` or anything in `out/`. With real data they map the internal network. Leave them as local changes (`start-codex.sh` and `start-codex.ps1` mark the two files skip-worktree);
- log into the router with scripts, or run anything against a host with `role=router` or against this machine's default gateway (the scripts and MCP tools refuse both);
- re-enable SMB1, turn a firewall off wholesale, or open a port to the internet to make something work.

Work read-only first. `netscan`, `nas-check`, `disk-triage` and `verify` change nothing on any device; they write only under `out/` here (`nas-check`'s SSH probe may add the NAS to `~/.ssh/known_hosts`). Run them before and after each change.

## Ask these up front, in one message

1. Which machine is this, and which machines exist (names, rough location, OS)?
2. Which two computers are the new ones, and are they powered on and plugged in?
3. What is "Trimurti": the gallery's AI gateway (`trimurti-gateway`, which the storefront code in this repo already uses), a Tailscale tailnet, a naming convention, a Windows workgroup or domain, or a specific server? (`checklists/trimurti-join.md` explains each case.)
4. Router make and model. He makes router changes in its web page himself while you guide; nothing here logs into the router.
5. NAS make and model, and what "fix the NAS" means: unreachable, shares won't mount, degraded, slow?
6. Where the Hulk drives are plugged in, and what should be on them.

Start step 0 while you wait for the answers; it needs none of them.

## Order of work

On Windows, use the `.ps1` scripts where they exist, and run `.sh` scripts through Git Bash (`& "C:\Program Files\Git\bin\bash.exe" scripts/<name>.sh`), never WSL. Run `ssh` only through Git Bash or the MCP tools, never PowerShell's `ssh.exe`: that is Windows' own OpenSSH, which cannot use the launcher's Git ssh-agent. If the `trimurti-ops` MCP tools are available, prefer them to calling the scripts yourself; they are the same scripts with validation and structured results. Scripts and MCP tools act on computers (role `admin`, `workstation`, `new`) unless you name a host or role; a NAS, printer or IoT row only when named; the router never. Filters go before the script name in `run-remote.sh`; everything after it goes to the script.

Your shell has no terminal. Anything that prompts (a password, a key passphrase, `sudo` on a host where it asks) is Sanjay's to run in his terminal: `ssh-keys.sh`, and every `--tty` run. Without a terminal, the sudo steps fail with `sudo needs a password on <host>: rerun with --tty or run it locally`. If the admin key has a passphrase, the launcher (`launch.sh`, `launch.ps1`, `start-codex.sh`) loaded it into an ssh-agent in Sanjay's terminal before you started, and your shells and the MCP server inherit that agent. If an SSH step reports `key is passphrase-protected and no ssh-agent holds it`, never start an ssh-agent or run `ssh-add` yourself (no terminal for the passphrase, and a new agent hides the launcher's). If only the MCP tools report it and the scripts work, use the scripts. Otherwise ask Sanjay to do what the message says, in a terminal: rerun the launcher (`launch.ps1` on Windows, `launch.sh` elsewhere; this restarts the session, so bring `status.md` up to date first), or on macOS `ssh-add --apple-use-keychain <key>` in any terminal, or the `SSH_AUTH_SOCK='<sock>' ssh-add <key>` line the message prints (README, SSH troubleshooting 0).

| Step | Do | With |
|---|---|---|
| 0. Discover | Sweep the LAN, then fill `inventory.csv` with every real machine: name, ip, mac, os, user, role, `ssh_port` (22 for every machine that runs sshd; blank = no SSH on that device), trimurti (`yes` only for machines already in Trimurti). Remove the template's example rows | `scripts/netscan.sh` or `netscan.ps1`; MCP `trimurti_scan_lan`, `trimurti_upsert_host` (pass only the fields to change), `trimurti_remove_host` |
| 1. Fix the LAN | Work `checklists/network-triage.md` top to bottom: topology, one DHCP server, reservations, DNS, Windows Private profile, cables | Router changes by the rules above |
| 2. SSH | The launcher made the admin key (README, "Start here"). Once per machine, locally: `enable-ssh-server.sh` as the login user without sudo, or `enable-ssh-server.ps1` elevated (README, "Windows"). Then Sanjay runs `scripts/ssh-keys.sh` in his terminal, Git Bash on Windows (it asks for each password, and for the key's passphrase if no agent holds it; without a terminal it refuses). Then `ssh-config-gen.sh`. The new PCs follow in step 6, the NAS in step 4 | MCP `trimurti_test_ssh` for the diagnosis per failure |
| 3. AI CLIs | `run-remote.sh bootstrap-ai-clis` (computers only; it also installs `hf` and registers Hugging Face's MCP server with Codex and Gemini). A host whose sudo asks for a password needs `run-remote.sh --tty --host <name> bootstrap-ai-clis` in Sanjay's terminal. Report each failed host with the CLIs its `INSTALL INCOMPLETE` line names. `run-remote.sh` skips this machine when its row has a blank `ssh_port`: here the CLIs come from `scripts/bootstrap-ai-clis.sh` run locally (Sanjay's terminal where sudo asks; on Windows `scripts\bootstrap-ai-clis.ps1`, elevated, which is his too). Then sign each machine in, including `hf auth login` and `codex mcp login huggingface`: that needs Sanjay at a browser, so give him the exact command per machine | MCP `trimurti_run_script`, `trimurti_get_job` |
| 4. NAS | `nas-check.sh`, then the matching section of `checklists/nas.md`. Once its SSH is on: `ssh_port` 22 on its row, `ssh-keys.sh --host <nas>` | MCP `trimurti_check_nas` |
| 5. Hulk drives | `disk-triage` on the machine they are plugged into (SMART needs root: `--tty` or a local run where sudo asks), then `checklists/hulk-drives.md` | Destructive steps by the rules above |
| 6. New computers | `checklists/trimurti-join.md`: the join step for whatever Trimurti is, then the per-machine onboarding list | |
| 7. Updates | `run-remote.sh --os linux --tty update-all` and `--os macos --tty update-all` are Sanjay's to run (or yours without `--tty` where sudo needs no password); `--os windows update-all` (security and critical updates only by default). Report `UPDATE_FAILED=` and each host's `REBOOT_REQUIRED=yes\|no\|unknown`; the hosts to reboot are on the `TRIMURTI_SUMMARY reboot_required=` line. This machine with a blank `ssh_port`: `scripts/update-all.sh` (or `update-all.ps1`, elevated) run locally, in Sanjay's terminal where sudo asks or elevation is needed. Reboot only with a yes | MCP `trimurti_run_script` |
| 8. Router | `checklists/router-tuning.md`, one row at a time | |
| 9. Verify | `verify.sh` exits 0: every computer green (ping, key login, claude, codex, gemini, hf, node, which must be 20+); NAS and printer rows show `n/a` and do not count. A `?` CLI cell was not checked: the `ssh key` cell says why. Sign-ins recorded; `status.md` complete | MCP `trimurti_verify_hosts` |

Some steps need Sanjay's hands (a password prompt, a browser sign-in, a cable, a local run on a Windows PC that has no SSH yet). When you reach one, tell him exactly what to do on which machine, then carry on with anything that does not depend on it.

## Reporting

After each step, report in a few lines: what you found, what you changed, what is left, and anything you need from Sanjay. At the end, give one short summary with the `verify.sh` table and the open items.

## Reference

`README.md` has the full runbook, the script table and SSH troubleshooting. `mcp/README.md` covers the MCP server. `../../reports/Trimurti network kit verification.md` records which checklist facts rest on unconfirmed sources; spot-check the router and NAS menu paths against the real web pages.
