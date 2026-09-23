# Trimurti network job: instructions for the agent

You are running on the gallery's admin machine, on the LAN. Codex and Claude Code both load this file when started in `ops/network` (`./start-codex.sh` does that). Sanjay Kapoor, the gallery director, is the only person you answer to. He is technical and wants the work done, not described. Keep updates short.

## The job, in Sanjay's words

"Get this network sorted out, it's a mess. Get Codex, Claude and Gemini on every machine, have their SSH work perfectly, fix the NAS and see what you can do with the Hulk drives. Add the two new computers to Trimurti. Update all of the PCs and fine-tune the router."

Done means all of this is true:

- One router, one subnet, one DHCP server, no double NAT, a DHCP reservation for every machine (`checklists/network-triage.md`, "What sorted means").
- `ssh <name>` works with the admin key from this machine to every machine in `inventory.csv`.
- `claude`, `codex` and `gemini` are installed and signed in on every machine.
- The NAS is reachable, its shares mount from every PC, its volume is healthy, and it is hardened.
- Every Hulk drive has a verdict, its data is safe, and it has a job.
- Both new computers are onboarded and `trimurti=yes` in the inventory.
- Every machine is updated, and Sanjay knows which ones still need a reboot.
- Every router checklist row is decided and recorded.
- `scripts/verify.sh` is all green, and `status.md` is filled in.

## Resume first

Read `status.md` before anything else. If it has entries, continue from the first unfinished step below instead of starting over. Update `status.md` after every step.

## Hard rules

Ask Sanjay and wait for a yes before you:

- change any router setting (one change at a time, config backup first, verify after each; the rows marked **ASK** in `checklists/router-tuning.md` need an explicit yes each);
- wipe, format, secure-erase, repartition, or `ddrescue` onto any disk, start a RAID rebuild, or pull a disk from the NAS. Name the drive by serial number when you ask;
- reboot any machine, rename one, or join it to a workgroup or domain (those reboot);
- run `enable-ssh-server.sh --harden` (turns password logins off);
- delete anything that is not in `out/`;
- install software on a machine that is not in `inventory.csv`;
- commit, push, or post anything anywhere.

Never:

- write a password, token, API key or private key into any file, command history you save, or `status.md`. Ask Sanjay to type secrets into the prompt that needs them;
- commit `inventory.csv`, `status.md` or anything in `out/`. With real data they map the internal network. Leave them as local changes;
- log into the router with scripts, or run anything against a host with `role=router`;
- re-enable SMB1, turn a firewall off wholesale, or open a port to the internet to make something work.

Work read-only first. `netscan`, `nas-check`, `disk-triage` and `verify` change nothing; run them before and after each change.

## Ask these up front, in one message

1. Which machine is this, and which machines exist (names, rough location, OS)?
2. Which two computers are the new ones, and are they powered on and plugged in?
3. What is "Trimurti": a Tailscale tailnet, a naming convention, a Windows workgroup or domain, or a specific server? (`checklists/trimurti-join.md` explains each case.)
4. Router make and model, and whether he will make router changes in its web page himself while you guide, or give you SSH access to it (ASUS Merlin, UniFi and OpenWrt have SSH).
5. NAS make and model, and what "fix the NAS" means: unreachable, shares won't mount, degraded, slow?
6. Where the Hulk drives are plugged in, and what should be on them.

Start step 0 while you wait for the answers; it needs none of them.

## Order of work

On Windows, use the `.ps1` scripts where they exist, and run `.sh` scripts through Git Bash (`& "C:\Program Files\Git\bin\bash.exe" scripts/<name>.sh`). If the `trimurti-ops` MCP tools are available, prefer them to calling the scripts yourself; they are the same scripts with validation and structured results.

| Step | Do | With |
|---|---|---|
| 0. Discover | Sweep the LAN, then fill `inventory.csv` with every real machine (name, ip, mac, os, user, role, trimurti) | `scripts/netscan.sh` or `netscan.ps1`; MCP `trimurti_scan_lan`, `trimurti_upsert_host` |
| 1. Fix the LAN | Work `checklists/network-triage.md` top to bottom: topology, one DHCP server, reservations, DNS, Windows Private profile, cables | Router changes by the rules above |
| 2. SSH | Once per machine, locally: `enable-ssh-server.sh` or `.ps1` (elevated). Then from here: `ssh-keys.sh` (Sanjay types each machine's password once), `ssh-config-gen.sh` | MCP `trimurti_test_ssh` for the diagnosis per failure |
| 3. AI CLIs | `run-remote.sh bootstrap-ai-clis` for every machine, then sign each one in. Signing in needs Sanjay at a browser; give him the exact command per machine | MCP `trimurti_run_script`, `trimurti_get_job` |
| 4. NAS | `nas-check.sh`, then the matching section of `checklists/nas.md` | MCP `trimurti_check_nas` |
| 5. Hulk drives | `disk-triage` on the machine they are plugged into, then `checklists/hulk-drives.md` | Destructive steps by the rules above |
| 6. New computers | `checklists/trimurti-join.md`: the join step for whatever Trimurti is, then the per-machine onboarding list | |
| 7. Updates | `run-remote.sh --os linux --tty update-all`, `--os macos --tty`, `--os windows`. Report `REBOOT_REQUIRED` per machine; reboot only with a yes | |
| 8. Router | `checklists/router-tuning.md`, one row at a time | |
| 9. Verify | `verify.sh` all green; `status.md` complete | MCP `trimurti_verify_hosts` |

Some steps need Sanjay's hands (a password prompt, a browser sign-in, a cable, a local run on a Windows PC that has no SSH yet). When you reach one, tell him exactly what to do on which machine, then carry on with anything that does not depend on it.

## Reporting

After each step, report in a few lines: what you found, what you changed, what is left, and anything you need from Sanjay. At the end, give one short summary with the `verify.sh` table and the open items.

## Reference

`README.md` has the full runbook, the script table and SSH troubleshooting. `mcp/README.md` covers the MCP server. `../../reports/Trimurti network kit verification.md` records which checklist facts rest on unconfirmed sources; spot-check the router and NAS menu paths against the real web pages.
