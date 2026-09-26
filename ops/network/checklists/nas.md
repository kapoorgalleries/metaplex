# NAS

Run `scripts/nas-check.sh` first (`--smb-user <name>` in a terminal lists the shares as that user). It tells you which of these sections applies, guesses the vendor, and says whether SMB1 is on. Fill the vendor into `inventory.csv` (notes column) once known. Steps marked **ASK** need Sanjay's yes first.

Where the same thing lives per vendor:

| | Synology DSM | QNAP QTS | TrueNAS | Generic Linux (OMV, Unraid, hand-built) |
|---|---|---|---|---|
| Web UI | `http://nas:5000` / `https://nas:5001` | `http://nas:8080` | `http://nas` | `http://nas` |
| Storage health | Storage Manager | Storage & Snapshots | Storage → Pools | `cat /proc/mdstat`, `zpool status`, `btrfs fi show` |
| SMART | Storage Manager → HDD/SSD → Health Info | Storage & Snapshots → Disks → Health | Storage → Disks → SMART | `smartctl -a /dev/sdX` |
| SMB settings | Control Panel → File Services → SMB → Advanced | Control Panel → Network & File Services → Win/Mac/NFS → Advanced | Shares → SMB → Advanced | `/etc/samba/smb.conf` |
| Enable SSH | Control Panel → Terminal & SNMP; the user must be in the administrators group | Control Panel → Network & File Services → Telnet / SSH, then "Edit Access Permission" (administrators only) | System → Services → SSH (off by default); the user needs a home directory, a shell, and the public key pasted in Credentials → Users → SSH Public Key | already on |
| Admin login for SSH | the named admin you created (the built-in `admin` should be disabled) | `admin` | `truenas_admin` (root login is disabled) | your user |
| Updates | Control Panel → Update & Restore | Control Panel → Firmware Update | System → Update | `apt` / vendor |
| USB backup to an external drive | Hyper Backup → local folder & USB; format the drive first under Control Panel → External Devices (ext4; exFAT is included from DSM 7.3) | HBS 3 → local; exFAT is free from QTS 5.0.1 | make the USB disk its own ZFS pool, then Data Protection → Replication (local); the UI cannot write NTFS or exFAT | `rsync -aHAX --delete` cron |

## Not reachable at all (no ping)

1. Lights. Power LED off → PSU or cord. Status LED amber/red blinking → check the vendor's LED code (Synology: orange blinking status = degraded volume or no volume).
2. Link LED on the NAS port and on the switch port. None → cable, port, or the NAS NIC. Try another cable and port.
3. Router's client list: is the NAS listed, and at which IP? DHCP may have moved it. If found: fix with a **DHCP reservation** (a router change: **ASK**), then set the NAS back to DHCP (or a static outside the pool). If the NAS has a static IP from an old subnet (say `192.168.0.20` on a `192.168.1.x` LAN), it is invisible: plug a laptop directly into the NAS with a static `192.168.0.5/24`, open the web UI, set DHCP, move it back.
4. Synology Assistant / Qfinder Pro / `find.synology.com` from a PC on the LAN finds a NAS with a wrong IP.
5. **ASK** Hung: use the power button for a *software* shutdown, not a forced one. Synology: press and hold only until it beeps (about 3–4 s), then let go and wait; holding 10 s forces power off and risks the volume. QNAP: hold about 1.5–3 s until the beep for a software shutdown; 5–10 s forces it. Never pull the plug while the disk LEDs are blinking. Power on, wait 3–5 minutes. Check the log afterwards.
6. **ASK** Still nothing: pull the disks (label their bay order first), power on with no disks. If the UI comes up, a disk is hanging the SATA bus; reinsert one at a time.

## Reachable but shares will not mount

Windows 11 has no SMB1 client at all, refuses **guest** (passwordless) shares (Pro since 24H2), **requires SMB signing** since 24H2, and caches old credentials. macOS is fussy about signing too.

- **Protocol**: on the NAS set min SMB2, max SMB3. Never re-enable SMB1 on the PC (QNAP's own guest-access workaround is SMB1: do not take it). Where: Synology Control Panel → File Services → SMB → Advanced; QNAP Control Panel → Network & File Services → Win/Mac/NFS/WebDAV → Microsoft Networking → Advanced Options; TrueNAS Shares → SMB → Advanced (it has only a minimum protocol, default SMB2).
- **Signing**: Windows 11 24H2 needs it. Synology: SMB signing = "Client defined" (not "Disable"); QNAP: leave signing enabled; TrueNAS has no signing switch and negotiates what the client asks.
- **Guest**: turn guest access off on the NAS; create a real user per person and mount with it. TrueNAS 25.10 and later has no guest option on normal shares at all.
- **Stale Windows credentials**: `cmdkey /list` → `cmdkey /delete:nas` (and the IP form), then reconnect with the new user. Mapping: `net use N: \\nas\share /user:nas\sanjay /persistent:yes`.
- **macOS**: Finder → Go → Connect to Server → `smb://sanjay@nas.local/share`. If it hangs, check the signing setting above and that the Mac resolves `nas.local` (mDNS on the NAS).
- **Wrong password loop**: reset the user's password on the NAS; check the account is not blocked after failed attempts (Synology: Control Panel → Security → Protection → Auto Block).
- A closed port 139 is normal now; SMB runs on 445.
- **Permissions**: the user must be in the share's permission list *and* have file-level rights on the folder.

## Web UI up, shares gone

- Volume not mounted / crashed: Storage Manager. A "degraded" volume still serves; a "crashed" one does not.
- Service stopped: File Services → SMB is enabled? Restart the service (not the NAS).
- Volume 100% full: SMB writes fail, some NAS stop the service. Free space; set a quota or move snapshots.

## Degraded or failing volume

1. **Do not pull any disk yet.** Take a screenshot of Storage Manager and the SMART page of every disk.
2. Is there a current backup of the volume? If not, back it up **now** to the healthiest place available (a PC, or one of the Hulk drives once `disk-triage` calls it HEALTHY). A rebuild with a second marginal disk is how arrays die.
3. Read the state word; the fix it names is an **ASK**. Synology: **Degraded** → Storage Manager → Repair (after the swap); **Crashed** → the volume is gone, restore from backup. QNAP: **Degraded** → Rebuild RAID; **Error / Not active** → Recover RAID. TrueNAS: Storage → Pools → offline the disk → Replace; the resilver runs on its own.
4. **ASK** Identify the bad disk (bay number, serial) and name it when you ask. Only then pull it and start the repair or rebuild from step 3. Replace it with a NAS-class CMR drive of the same or larger size. Rebuilds take hours per TB; let it finish before anything else.
5. Two disks bad on a single-parity array (SHR-1, RAID 5): stop. Do not rebuild. Copy data off first; then (**ASK**) rebuild from scratch, which erases the array.
6. Afterwards: schedule monthly SMART extended tests and a monthly data scrub (QNAP's own recommendation; TrueNAS defaults to a weekly scrub). A crashed pool drops out of scrub schedules, so re-add the schedule after a restore.

## Slow

- Link speed on the NAS network page: 100 Mb/s means a cable/port problem (network-triage). Gigabit tops out around 110 MB/s.
- Wi-Fi client copying to a wired NAS is limited by the Wi-Fi link, not the NAS.
- SMB multichannel or a 2.5 GbE upgrade only after the above is clean.

## Hardening and housekeeping once it works

- **ASK** DSM/QTS/TrueNAS **update** (release notes first; do it after the volume is healthy; it reboots the NAS).
- Admin account: strong password, **2FA**; disable the default `admin` on Synology and use a named admin.
- Turn off QuickConnect / myQNAPcloud / UPnP port forwarding unless actively used (QNAP itself "strongly recommends" UPnP off; the 2021–2022 Qlocker, eCh0raix and DeadBolt ransomware waves hit internet-exposed units). The NAS should not be reachable from the internet.
- Firewall on the NAS: allow only the LAN subnet.
- Enable SSH (for these scripts) with key login, then write `ssh_port` 22 on the NAS row and push the key from a terminal with `scripts/ssh-keys.sh --host <nas>`: on Synology the user must be in the administrators group, the home service must be on (User & Group → Advanced → Enable user home), `~` must not be group-writable (`chmod 755 ~`), `~/.ssh` must be 700 and `~/.ssh/authorized_keys` 600, or sshd rejects the key. After changing any of that, toggle SSH off and on in Control Panel → Terminal & SNMP.
- Snapshots on the main shares (daily, keep 30; Synology recommends immutable snapshots locked for 7–14 days) and a **USB backup task** to a Hulk drive (see `hulk-drives.md`): one copy on the NAS, one on a rotated external, one off-site (cloud or a drive kept elsewhere).
- **ASK** Reservation on the router, hostname set on the NAS; row filled in `inventory.csv`.
