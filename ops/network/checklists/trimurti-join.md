# Joining the two new computers to Trimurti

First, pin down what "Trimurti" is on the network. In this repo the name belongs to the gallery's AI gateway (a Supabase function), which has nothing to join. On the LAN it is one of these; tick the one that applies and record it in `status.md`:

- [ ] **A Tailscale tailnet** named Trimurti (or another overlay VPN). Machines join by logging in; they get a stable name and are reachable from anywhere.
- [ ] **A naming and access convention**: the machines that are "in Trimurti" are the ones with a fixed IP, a hostname, an inventory row, SSH from the admin key, and the AI CLIs. Nothing to join beyond doing this checklist.
- [ ] **A Windows workgroup or domain** called TRIMURTI that the PCs must be members of for file sharing.
- [ ] **A specific machine** called Trimurti (a server) that the new PCs must reach or mount shares from.

Whatever the answer, the per-machine onboarding at the bottom applies. The middle sections add the join step for each case.

## Case A: Tailscale tailnet

Install and join, per OS:

```bash
# Linux (a real distro; not the Synology/QNAP packages)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh              # Tailscale SSH: tailnet members log in with their tailnet identity
# macOS: the standalone app (Tailscale's recommended build)
brew install --cask tailscale-app    # sign in from the menu bar. CLI: /Applications/Tailscale.app/Contents/MacOS/Tailscale
```

```powershell
# Windows
winget install --id Tailscale.Tailscale -e      # the id is case-sensitive when -e is used
# then sign in from the tray icon, or:  tailscale up
```

Tailscale SSH (`--ssh`) can run on Linux and the BSDs, and on macOS only with the open-source daemon (`brew install tailscale`, not the app). Windows cannot be a Tailscale SSH server as of September 2026. It also needs an `ssh` section in the tailnet's access policy. Everywhere else, ordinary OpenSSH over the tailnet works, which is what this kit sets up anyway.

Then in the Tailscale admin console: approve the machine if device approval is on, give it the right tags or ACL group, check **MagicDNS** is on (the default for tailnets created since late 2022) so `ssh new-pc-1` resolves as `new-pc-1.<tailnet>.ts.net`, and **Disable key expiry** on machines that must stay reachable unattended (keys otherwise expire after 180 days). The free Personal plan covers 6 users and their devices. Put the tailnet name in the inventory notes.

## Case B: Convention only

Nothing to install. The onboarding list below *is* the join. When it is complete, set `trimurti=yes` on the row.

## Case C: Windows workgroup / domain

```powershell
# workgroup (elevated)
Add-Computer -WorkgroupName TRIMURTI -Restart
# domain
Add-Computer -DomainName trimurti.local -Credential TRIMURTI\Administrator -Restart
```

macOS and Linux do not join workgroups; they only need the SMB user on the NAS/server. For a domain, macOS: System Settings → Users & Groups → Network Account Server.

## Case D: A server named Trimurti

Add it to `inventory.csv` as its own row. On each new PC: DHCP reservation, `ssh trimurti` via `ssh-config-gen.sh`, and map whatever share it exports (see `nas.md`, "Reachable but shares will not mount", for the mount commands).

## Per-machine onboarding (both new computers)

Do these in order; each has a script or a checklist item.

1. **Physical**: wired if it stays put. Note the MAC (`netscan` finds it once it is on).
2. **Hostname** that matches the inventory name:
   - Windows: `Rename-Computer -NewName new-pc-1 -Restart`
   - macOS: `sudo scutil --set HostName new-pc-1 && sudo scutil --set LocalHostName new-pc-1 && sudo scutil --set ComputerName new-pc-1`
   - Linux: `sudo hostnamectl set-hostname new-pc-1`
3. **DHCP reservation** on the router (router-tuning.md §2). Renew the lease. Fill `ip` and `mac` in `inventory.csv`.
4. **OS updates** now, before anything else: `update-all.ps1` / `update-all.sh` locally (first time), reboot.
5. **SSH server on**: `enable-ssh-server.ps1` (elevated) or `enable-ssh-server.sh`, run locally this first time. Windows: the script also flips the network profile to Private.
6. **Admin key**: from the admin machine, `scripts/ssh-keys.sh --host new-pc-1`. Must print `PASS`.
7. **`ssh new-pc-1` works**: `scripts/ssh-config-gen.sh`, then try it.
8. **AI CLIs**: `scripts/run-remote.sh --host new-pc-1 bootstrap-ai-clis`. Then sign in to each of the three on that machine (the bootstrap output says how, including the no-browser routes).
9. **NAS share** mounted with a named user (nas.md).
10. **Trimurti join step** for the case ticked above.
11. **Verify**: `scripts/verify.sh --host new-pc-1` all green; set `trimurti=yes`; paste the row into `status.md`.
