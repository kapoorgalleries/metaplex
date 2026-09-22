# Hulk drives

Unknown so far: what they are (bare SATA disks, USB externals, a multi-bay enclosure), what is on them, and whether they are healthy. Every step here is read-only until the one section that is not, and that one asks first.

## 1. Identify (read-only)

Plug them into any machine and run the matching script on that machine:

- Linux / macOS: `scripts/disk-triage.sh`
- Windows: `scripts/disk-triage.ps1` (elevated)

Write down per drive: label, model, serial, size, filesystem, and the script's **VERDICT** line (`HEALTHY`, `WATCH`, `FAILING`, `UNKNOWN`). `UNKNOWN` is common through USB enclosures on macOS and Windows; if it matters, put the bare disk in a Linux box or a NAS bay for a real SMART read.

## 2. Look inside without writing (read-only)

- Linux: `sudo mkdir -p /mnt/ro && sudo mount -o ro /dev/sdX1 /mnt/ro && du -sh /mnt/ro/* | sort -h`
- macOS: `diskutil mount readOnly /dev/diskNsM`, then Finder.
- Windows: it auto-mounts read-write. To be safe, `diskpart` → `select disk N` → `attributes disk set readonly` before browsing; `attributes disk clear readonly` afterwards.

Note what is there and whether the NAS already holds a copy (compare a few folder sizes or file counts). Do not delete anything at this stage.

## 3. Decide

| Verdict | Data you want on it? | Do |
|---|---|---|
| HEALTHY | yes | Copy to the NAS with a verifying copy (below). Then move to the repurpose column |
| HEALTHY | no | Repurpose (section 4) |
| WATCH | yes | Copy off now, verify, then repurpose only as an **offline** backup target, never in RAID |
| WATCH | no | Repurpose as offline backup only, or retire |
| FAILING | yes | **Image first, recover second**: `ddrescue` the whole disk to a HEALTHY disk of equal or larger size, then mount the image. No direct file copies from a failing disk; each read may be the last. Then retire |
| FAILING | no | Retire. Wipe if it ever held gallery or client data (section 5) |
| UNKNOWN | any | Get a real SMART read (bare SATA in a Linux box or NAS bay) before trusting it with anything |

Verifying copy to the NAS (Linux/macOS, SMB share mounted at `/Volumes/share` or `/mnt/nas`):

```bash
rsync -rltv --checksum --progress /mnt/ro/ /mnt/nas/hulk-1/
rsync -rltvn --checksum /mnt/ro/ /mnt/nas/hulk-1/ | grep -v '/$'   # dry-run again: nothing listed = every file matches
```

Windows: `robocopy E:\ \\nas\hulk-1 /E /COPY:DAT /R:2 /W:5 /LOG:C:\hulk-1.log`, then compare counts with `dir /s` on both sides.

## 4. Repurpose (the useful outcomes)

Pick per drive, in this order of value:

1. **NAS bay** if the NAS has a free bay and the drive is a NAS-class CMR disk of the same size class as the existing ones. Adds capacity or a hot spare. Check the NAS compatibility list. Not for SMR or desktop-class drives in a RAID.
2. **USB backup target on the NAS**: plug it into the NAS's USB port, format it from the NAS UI (ext4 on Synology/QNAP, ZFS or ext4 on TrueNAS), and create the backup task (Hyper Backup / HBS 3 / replication) to run nightly. Two drives = rotate them, one always off-site.
3. **Offline archive of the photo/catalogue masters**: one full copy, unplugged, in a drawer. Refresh quarterly.
4. Scratch space on a desktop (fast local disk for exports). Only for data that also exists elsewhere.

Filesystem when formatting for direct use on PCs: exFAT for a drive that moves between Mac and Windows; NTFS for Windows-only; APFS for Mac-only; ext4 for Linux or NAS-attached.

## 5. The only destructive step: wipe or format (ask first)

Say which drive, by **serial number**, and get a yes before running any of these. They are irreversible.

- Format from the NAS UI (for backup targets): the UI names the drive; confirm the serial matches.
- Linux full wipe: `sudo wipefs -a /dev/sdX` then `sudo mkfs.ext4 -L hulk-1 /dev/sdX` (replace `sdX`; check with `lsblk -o NAME,SERIAL` first).
- Secure erase before disposal: `sudo nvme format --ses=1 /dev/nvme0n1` for NVMe; `sudo hdparm --user-master u --security-erase NULL /dev/sdX` for SATA (drive must not be frozen; suspend/resume unfreezes it); or `shred -n 1 -v /dev/sdX` if the above is not available.
- Windows: Disk Management → right-click → Format (quick is fine for reuse; use `diskpart` → `clean all` before disposal).

## 6. Record

In `status.md` → Hulk drives: one line per serial: model, size, verdict, what was on it, what was done with the data, what the drive is now used for.
