# NAS

Run `scripts/nas-check.sh` first. It tells you which of these sections applies, and it guesses the vendor. Fill the vendor into `inventory.csv` (notes column) once known.

Where the same thing lives per vendor:

| | Synology DSM | QNAP QTS | TrueNAS | Generic Linux (OMV, Unraid, hand-built) |
|---|---|---|---|---|
| Web UI | `http://nas:5000` / `https://nas:5001` | `http://nas:8080` | `http://nas` | `http://nas` |
| Storage health | Storage Manager | Storage & Snapshots | Storage → Pools | `cat /proc/mdstat`, `zpool status`, `btrfs fi show` |
| SMART | Storage Manager → HDD/SSD → Health Info | Storage & Snapshots → Disks → Health | Storage → Disks → SMART | `smartctl -a /dev/sdX` |
| SMB settings | Control Panel → File Services → SMB → Advanced | Control Panel → Network & File Services → Win/Mac/NFS → Advanced | Shares → SMB → Advanced | `/etc/samba/smb.conf` |
| Enable SSH | Control Panel → Terminal & SNMP | Control Panel → Telnet/SSH | System → Services → SSH | already on |
| Updates | Control Panel → Update & Restore | Control Panel → Firmware Update | System → Update | `apt` / vendor |
| USB backup to an external drive | Hyper Backup → local folder & USB | HBS 3 → local | Data Protection → Replication / rsync task | `rsync -aHAX --delete` cron |

## Not reachable at all (no ping)

1. Lights. Power LED off → PSU or cord. Status LED amber/red blinking → check the vendor's LED code (Synology: orange blinking status = degraded volume or no volume).
2. Link LED on the NAS port and on the switch port. None → cable, port, or the NAS NIC. Try another cable and port.
3. Router's client list: is the NAS listed, and at which IP? DHCP may have moved it. If found: fix with a **DHCP reservation**, then set the NAS back to DHCP (or a static outside the pool). If the NAS has a static IP from an old subnet (say `192.168.0.20` on a `192.168.1.x` LAN), it is invisible: plug a laptop directly into the NAS with a static `192.168.0.5/24`, open the web UI, set DHCP, move it back.
4. Synology Assistant / Qfinder Pro / `find.synology.com` from a PC on the LAN finds a NAS with a wrong IP.
5. Hung: hold the power button until it shuts down (Synology: ~5 s for a safe shutdown; do not pull the plug while the LED is blinking). Power on, wait 3–5 minutes. Check the log afterwards.
6. Still nothing: pull the disks (label their bay order first), power on with no disks. If the UI comes up, a disk is hanging the SATA bus; reinsert one at a time.

## Reachable but shares will not mount

Windows 10/11 refuses **SMB1** and **guest** (passwordless) access by default, and caches old credentials. macOS is fussy about signing.

- **Protocol**: on the NAS set min SMB2, max SMB3. Never re-enable SMB1 on the PC.
- **Guest**: turn guest access off on the NAS; create a real user per person and mount with it.
- **Stale Windows credentials**: `cmdkey /list` → `cmdkey /delete:nas` (and the IP form), then reconnect with the new user. Mapping: `net use N: \\nas\share /user:nas\sanjay /persistent:yes`.
- **macOS**: Finder → Go → Connect to Server → `smb://sanjay@nas.local/share`. If it hangs, check the NAS's "SMB signing" setting (leave "auto") and that the Mac resolves `nas.local` (mDNS on the NAS).
- **Wrong password loop**: reset the user's password on the NAS; check the account is not disabled after failed attempts (Control Panel → Security → Account → Auto block).
- **Permissions**: the user must be in the share's permission list *and* have file-level rights on the folder.

## Web UI up, shares gone

- Volume not mounted / crashed: Storage Manager. A "degraded" volume still serves; a "crashed" one does not.
- Service stopped: File Services → SMB is enabled? Restart it.
- Volume 100% full: SMB writes fail, some NAS stop the service. Free space; set a quota or move snapshots.

## Degraded or failing volume

1. **Do not pull any disk yet.** Take a screenshot of Storage Manager and the SMART page of every disk.
2. Is there a current backup of the volume? If not, back it up **now** to the healthiest place available (a PC, or one of the Hulk drives once `disk-triage` calls it HEALTHY). A rebuild with a second marginal disk is how arrays die.
3. Identify the bad disk (bay number, serial). Replace with a NAS-class CMR drive of the same or larger size. Rebuild from the Storage Manager. Rebuilds take hours per TB; let it finish before anything else.
4. Two disks bad on a single-parity array (SHR-1, RAID 5): stop. Do not rebuild. Copy data off first; then rebuild from scratch.
5. Afterwards: schedule monthly SMART extended tests and a quarterly data scrub (Storage Manager → schedule).

## Slow

- Link speed on the NAS network page: 100 Mb/s means a cable/port problem (network-triage). Gigabit tops out around 110 MB/s.
- Wi-Fi client copying to a wired NAS is limited by the Wi-Fi link, not the NAS.
- SMB multichannel or a 2.5 GbE upgrade only after the above is clean.

## Hardening and housekeeping once it works

- DSM/QTS/TrueNAS **update** (release notes first; do it after the volume is healthy).
- Admin account: strong password, **2FA**; disable the default `admin` on Synology and use a named admin.
- Turn off QuickConnect / myQNAPcloud / UPnP port forwarding unless actively used. The NAS should not be reachable from the internet.
- Firewall on the NAS: allow only the LAN subnet.
- Enable SSH (for these scripts) with key login: on Synology the user's home service must be on (User & Group → Advanced → Enable user home), and `~` must not be group-writable (`chmod 755 ~`) or sshd rejects the key.
- Snapshots on the main shares (daily, keep 30) and a **USB backup task** to a Hulk drive (see `hulk-drives.md`): one copy on the NAS, one on a rotated external, one off-site (cloud or a drive kept elsewhere).
- Reservation on the router, hostname set on the NAS, row filled in `inventory.csv`.
