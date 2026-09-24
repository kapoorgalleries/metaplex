# Hulk drives

Unknown so far: what they are (bare SATA disks, USB externals, a multi-bay enclosure), what is on them, and whether they are healthy. Every step here is read-only until the one section that is not, and that one asks first.

## 1. Identify (read-only)

Plug them into any machine and run the matching script on that machine:

- Linux / macOS: `scripts/disk-triage.sh`
- Windows: `scripts/disk-triage.ps1` (elevated)

Write down per drive: label, model, serial, size, filesystem, and the script's **VERDICT** line (`HEALTHY`, `WATCH`, `FAILING`, `UNKNOWN`). `UNKNOWN` is common through USB enclosures on macOS and Windows; if it matters, put the bare disk in a Linux box or a NAS bay for a real SMART read.

## 2. Look inside without writing (read-only)

- Linux: `sudo blockdev --setro /dev/sdX` first (kernel-level read-only), then `sudo mkdir -p /mnt/ro && sudo mount -o ro,noload /dev/sdX1 /mnt/ro && du -sh /mnt/ro/* | sort -h`. `noload` stops ext4 replaying its journal; for NTFS use `-t ntfs-3g -o ro` (never the `force` option); APFS is better read on a Mac.
- macOS: `diskutil mount readOnly /dev/diskNsM`, then Finder.
- Windows: it auto-mounts read-write. `diskpart` → `select disk N` → `attributes disk set readonly` before browsing (`attributes disk clear readonly` afterwards). That only tells Windows to treat the disk as read-only; it is not a hardware write-blocker.

Note what is there and whether the NAS already holds a copy (compare a few folder sizes or file counts). Do not delete anything at this stage.

## 3. Decide

| Verdict | Data you want on it? | Do |
|---|---|---|
| HEALTHY | yes | Copy to the NAS with a verifying copy (below). Then move to the repurpose column |
| HEALTHY | no | Repurpose (section 4) |
| WATCH | yes | Copy off now, verify, then repurpose only as an **offline** backup target, never in RAID |
| WATCH | no | Repurpose as offline backup only, or retire |
| FAILING | yes | **Image first, recover second** (commands below): `ddrescue` the whole disk to an image on a HEALTHY disk with more free space than the failing disk, then mount the image. No direct file copies from a failing disk; each read may be the last. Then retire |
| FAILING | no | Retire. Wipe if it ever held gallery or client data (section 5) |
| UNKNOWN | any | Get a real SMART read (bare SATA in a Linux box or NAS bay) before trusting it with anything |

Imaging a FAILING drive (Linux; macOS: `brew install ddrescue`). Two passes, same map file, so it grabs the easy sectors first and only then hammers the bad ones:

```bash
sudo ddrescue -d -n  /dev/sdX /mnt/healthy/hulk-1.img /mnt/healthy/hulk-1.map   # pass 1: no retries, skip bad areas
sudo ddrescue -d -r3 /dev/sdX /mnt/healthy/hulk-1.img /mnt/healthy/hulk-1.map   # pass 2: retry the bad areas 3 times
sudo losetup -fP --show /mnt/healthy/hulk-1.img      # prints /dev/loopN; partitions appear as /dev/loopNp1 ...
sudo mount -o ro,noload /dev/loop0p1 /mnt/ro          # then copy from /mnt/ro as below
```

Imaging straight onto another disk instead of a file needs `-f` and destroys that disk's contents: ask first.

Verifying copy to the NAS (Linux/macOS, SMB share mounted at `/Volumes/share` or `/mnt/nas`):

```bash
rsync -rltvi --checksum --progress /mnt/ro/ /mnt/nas/hulk-1/
rsync -rltvni --checksum /mnt/ro/ /mnt/nas/hulk-1/ | grep -v '/$'   # dry-run again: nothing listed = every file matches
```

Windows: `robocopy E:\ \\nas\hulk-1 /E /R:2 /W:5 /LOG:C:\hulk-1.log`, then `robocopy E:\ \\nas\hulk-1 /E /L` (list mode) must report nothing left to copy. For a byte-level check on either OS, `hashdeep -r -l E:\ > hulk-1.hashes` on the source, then `hashdeep -a -k hulk-1.hashes -r -l <destination>`.

## 4. Repurpose (the useful outcomes)

Before any drive takes on a new job, run a long self-test and read the result (hours for a large disk): `sudo smartctl -t long /dev/sdX`, later `sudo smartctl -l selftest /dev/sdX`. Only "Completed without error" goes on.

Pick per drive, in this order of value:

1. **NAS bay** if the NAS has a free bay and the drive is a NAS-class CMR disk of the same size class as the existing ones. Adds capacity or a hot spare. Check the NAS compatibility list. Not for SMR or desktop-class drives in a RAID.
2. **USB backup target on the NAS**: plug it into the NAS's USB port, format it from the NAS UI, and create the backup task to run nightly. Synology: Control Panel → External Devices → Format (ext4; exFAT from DSM 7.3), then Hyper Backup. QNAP: Storage & Snapshots → External Storage (exFAT is free since QTS 5.0.1), then HBS 3. TrueNAS: make the drive its own ZFS pool and use a local replication task, since the UI cannot write NTFS or exFAT. Two drives = rotate them, one always off-site.
3. **Offline archive of the photo/catalogue masters**: one full copy, unplugged, in a drawer. Refresh quarterly.
4. Scratch space on a desktop (fast local disk for exports). Only for data that also exists elsewhere.

Filesystem when formatting for direct use on PCs: exFAT for a drive that moves between Mac and Windows; NTFS for Windows-only; APFS for Mac-only; ext4 for Linux or NAS-attached.

## 5. The only destructive step: wipe or format (ask first)

Say which drive, by **serial number**, and get a yes before running any of these. They are irreversible.

- Format from the NAS UI (for backup targets): the UI names the drive; confirm the serial matches.
- Linux full wipe: `sudo wipefs -a /dev/sdX` then `sudo mkfs.ext4 -L hulk-1 /dev/sdX` (replace `sdX`; check with `lsblk -o NAME,SERIAL` first).
- Secure erase before disposal (NIST SP 800-88 Rev. 2 "purge"): NVMe `sudo nvme format --ses=1 /dev/nvme0n1` (`--ses=2` for a crypto erase on self-encrypting drives), or `sudo nvme sanitize /dev/nvme0 --sanact=2` (block erase; `--sanact=4` crypto erase) and watch `sudo nvme sanitize-log /dev/nvme0`. SATA: first confirm `sudo hdparm -I /dev/sdX` shows "not frozen" under Security; if it says "frozen", suspend the machine for a minute and resume. Then `sudo hdparm --user-master u --security-set-pass NULL /dev/sdX` followed by `sudo hdparm --user-master u --security-erase NULL /dev/sdX`, or `--security-erase-enhanced NULL` when `-I` lists "supported: enhanced erase". Spinning disks without either: `shred -n 1 -v /dev/sdX` (do not use shred on SSDs).
- Windows: Disk Management → right-click → Format (quick is fine for reuse); before disposal `diskpart` → `select disk N` → `clean all`, which zeroes every sector.

## 6. Record

In `status.md` → Hulk drives: one line per serial: model, size, verdict, what was on it, what was done with the data, what the drive is now used for.
