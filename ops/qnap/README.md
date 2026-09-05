# QNAP file preservation

Pulls every file off a QNAP NAS to local or external storage **before** any
destructive troubleshooting — firmware reflash, RAID rebuild, factory reset.

Runs on **Windows PowerShell 5.1**, which is already on every Windows machine.
PowerShell 7 (`pwsh`) is *not* required.

## Run it

Open Windows PowerShell (the built-in one — Start menu → "Windows PowerShell").
First run names the NAS and the destination:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qnap-preserve-files.ps1 `
    -Nas 192.168.1.50 `
    -Destination E:\QNAP-Rescue
```

Every run after that needs nothing else — the NAS, destination, and share list are
remembered:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qnap-preserve-files.ps1 -Resume
```

If the NAS needs credentials:

```powershell
$cred = Get-Credential          # QNAP username and password
.\qnap-preserve-files.ps1 -Nas 192.168.1.50 -Destination E:\QNAP-Rescue -Credential $cred
```

### Before you trust the copy

Run a full verification pass before wiping anything:

```powershell
.\qnap-preserve-files.ps1 -Resume -Recheck -DeepVerify
```

Add `-Hash` for a SHA-256 comparison of every file. It is slow — hours on a large
volume — but it is the only check that proves byte-for-byte fidelity.

## What it does

| Behaviour | Why |
|---|---|
| `robocopy /Z` restartable mode | Survives the SMB session dropping mid-file, which is the normal failure on a flaky NAS |
| Never uses `/MIR` | Mirroring deletes. Nothing here ever removes a file, on either side |
| `/FFT` and `/DST` | NAS volumes report coarser timestamps than NTFS; without these robocopy re-copies unchanged files forever and resume never finishes |
| Verified completion | A share is marked complete only after a list-only pass proves zero files outstanding — an interrupted run can't cause a file to be silently skipped on resume |
| UNC paths only | An elevated session doesn't inherit the drive letters mapped by your normal login, so `Z:\` would look missing. Mapped drives are resolved to `\\server\share` up front |
| Excludes `@Recycle`, `.@__thumb`, `@Recently-Snapshot`, `@Transcode` | QNAP-regenerable junk, often a large fraction of the volume. Use `-IncludeSystemFolders` to keep them |
| Waits out NAS dropouts | If the NAS stops answering mid-run it waits and retries rather than failing the share |

## State and logs

Both live in `.qnap-preserve\` next to the script:

- `state.json` — per-share status, verification timestamps, pass counts. Delete it
  or pass `-Force` to start over. No credentials are stored in it.
- `logs\run-<timestamp>.log` — the run narrative.
- `logs\<share>-<timestamp>.log` — robocopy's per-file detail.

## Useful switches

| Switch | Effect |
|---|---|
| `-ListSharesOnly` | Show what shares are visible, copy nothing |
| `-DryRun` | Report what would be copied, copy nothing |
| `-Share Public,Multimedia` | Restrict to named shares |
| `-Recheck` | With `-Resume`, re-verify shares already complete |
| `-Force` | Discard state and start fresh (copied data is left alone) |
| `-Threads 16` | Multi-threaded copy — faster on many small files, but gives up mid-file restart. Only on a stable link |
| `-DeepVerify` | Compare recursive file counts and byte totals |
| `-Hash` | SHA-256 every file (slow, authoritative) |
| `-WithAcls` | Also copy permissions. Off by default: NAS→NTFS ACL copies usually fail and bury real errors |
| `-MaxPasses 8` | How many retry passes per share before giving up |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Every requested share copied and verified |
| 1 | Fatal error — read the log |
| 2 | One or more shares incomplete — re-run with `-Resume` |

## If the NAS won't answer at all

The script stops early with "not answering on TCP 445 or 139". That is a
connectivity problem, not a copy problem. Check in this order: NAS powered and past
boot, same subnet, `ping` the IP, SMB enabled in QNAP Control Panel → Network & File
Services, and Windows' SMB client not blocking the older dialect the NAS offers.
