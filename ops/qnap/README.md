# QNAP file preservation

Pulls every file off a QNAP NAS to local or external storage **before** any
destructive troubleshooting — firmware reflash, RAID rebuild, factory reset.

Runs on **Windows PowerShell 5.1**, which is already on every Windows machine.
PowerShell 7 (`pwsh`) is *not* required.

Two scripts:

- `find-qnap.ps1` — locates the NAS on the network. Start here if you don't know its address.
- `qnap-preserve-files.ps1` — does the copy.

## Run it

Open Windows PowerShell (Start menu → "Windows PowerShell"). Don't paste the
script into the console — save it and run it with `-File`, or parameters won't
bind.

Find the NAS:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\find-qnap.ps1
```

First real run names the NAS and the destination:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qnap-preserve-files.ps1 `
    -Nas 192.168.1.50 `
    -Destination E:\QNAP-Rescue
```

Every run after that needs nothing else — the NAS, destination, and share list
are remembered:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qnap-preserve-files.ps1 -Resume
```

Credentials are only needed if your Windows login is refused; the script tries
your current identity first and prompts only if the NAS rejects it.

### Before you trust the copy

Run a full verification pass before wiping anything:

```powershell
.\qnap-preserve-files.ps1 -Resume -Recheck -DeepVerify -Hash
```

`-Hash` is a SHA-256 comparison of every file. It is slow — hours on a large
volume — and it is the only check that proves byte-for-byte fidelity.

## The governing rule: everything fails closed

Anything the script cannot positively verify is reported as **unverified**,
never as done. A share is marked complete only on affirmative evidence, because
the cost of a false "complete" here is losing files you then wipe.

Concretely:

| Situation | What happens |
|---|---|
| robocopy's summary can't be parsed (e.g. a non-English Windows) | Verification **fails**. The share stays incomplete. It is not read as "zero files outstanding" |
| Files land in robocopy's `Mismatch` or `FAILED` columns | Counted as outstanding work, not just the `Copied` column |
| A share contains no files at all | **Refuses** to mark it preserved. A QNAP whose volume failed to mount still publishes its shares and they enumerate empty. Override with `-AllowEmptyShares` once you've confirmed it really is empty |
| Deep verify hits unreadable subtrees | Reported as unreliable, not as a pass. Silently dropping unreadable files would let a truncated source match the destination |
| Source contains junctions | Deep verify reports its counts as not comparable, since robocopy skips junctions (`/XJ`) and `Get-ChildItem` follows them |
| Share list came from probing rather than enumeration | Flagged loudly and re-probed every run, never persisted as authoritative |
| `-Resume` finds a share verified less deeply than this run asks for | Re-verifies instead of skipping |
| `-DryRun` | Never marks anything complete |

## What it does

| Behaviour | Why |
|---|---|
| `robocopy /Z` restartable mode | Survives the SMB session dropping mid-file, the normal failure on a flaky NAS |
| Never uses `/MIR` | Mirroring deletes. Nothing here removes a file, on either side |
| `/FFT` and `/DST` | NAS volumes report coarser timestamps than NTFS; without these robocopy re-copies unchanged files forever and resume never converges |
| UNC paths only | An elevated session doesn't inherit drive letters mapped by your normal login. Mapped drives are resolved where possible, and you get an explicit warning where they can't be |
| Refuses a destination on the NAS itself | Compares resolved IP addresses, not spelling, so `\\192.168.1.50\backup` and `\\NAS\backup` are both caught |
| Excludes `@Recycle`, `.@__thumb`, `@Recently-Snapshot`, `@Transcode` | QNAP-regenerable, often a large fraction of the volume. Use `-IncludeSystemFolders` to keep them — note `@Recycle` may hold deleted files you still want |
| Waits out NAS dropouts | If the NAS stops answering mid-run it waits and retries rather than failing the share |

## State and logs

Both live in `.qnap-preserve\` next to the script (or `%LOCALAPPDATA%\QnapPreserve\`
if that location isn't writable):

- `state.json` — per-share status, verification depth, timestamps. Delete it or
  pass `-Force` to start over. No credentials are stored in it.
- `logs\run-<timestamp>.log` — the run narrative.
- `logs\<share>-<timestamp>.log` — robocopy's per-file detail.

## Switches

| Switch | Effect |
|---|---|
| `-ListSharesOnly` | Show what shares are visible, copy nothing |
| `-DryRun` | Report outstanding work, copy nothing, mark nothing complete |
| `-Share Public,Multimedia` | Restrict to named shares. Use this if probing might miss unusually-named shares |
| `-Recheck` | With `-Resume`, re-verify shares already marked complete |
| `-Force` | Discard state and start fresh (copied data is left alone) |
| `-AllowEmptyShares` | Accept a share with no files as genuinely empty |
| `-NonInteractive` | Never prompt for credentials; for scheduled runs |
| `-Threads 16` | Multi-threaded copy — faster on many small files, but gives up mid-file restart. Only on a stable link |
| `-DeepVerify` | Compare recursive file counts and byte totals |
| `-Hash` | SHA-256 every file (slow, authoritative) |
| `-WithAcls` | Also copy permissions. Off by default: NAS→NTFS ACL copies usually fail and bury real errors |
| `-MaxPasses 8` | Retry passes per share before giving up |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Every requested share copied and verified (or a clean dry run) |
| 1 | Fatal error — read the log |
| 2 | One or more shares incomplete or empty — re-run with `-Resume` |

## If the NAS won't answer at all

The script stops with "not answering on TCP 445 or 139" — a connectivity
problem, not a copy problem. Check in order: NAS powered and past boot, status
LED steady rather than blinking, same subnet as your PC, `ping` the IP, SMB
enabled in QNAP Control Panel → Network & File Services. `find-qnap.ps1` will
tell you whether anything on your network is answering on SMB at all.

## Tests

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\Parsers.Tests.ps1
```

72 assertions, no framework dependency, no NAS required. They cover the logic
whose failure would be silent and expensive:

- **`Read-RobocopySummary`** — the function whose answer alone decides whether a
  share is recorded as preserved. Tested against real robocopy summary blocks,
  including localized (German, French) output, truncated lines, `Dirs`-only
  output, error text, and empty input. Every one of those must fail to parse
  rather than report zero outstanding.
- **`Read-NetViewShares`** — tested against real `net view` output, including
  share names containing spaces, a name collapsed to a single-space column, a
  share literally named `Backup Disk`, a comment containing the word "Disk",
  and non-Disk share types.
- **`Get-ShareSkipDecision`** — every combination of `-Resume`, `-Recheck`,
  `-DryRun`, `-DeepVerify` and `-Hash` against stored records of each
  verification depth, including legacy records written without depth fields.
- **`ConvertTo-Hashtable`** and **`Format-Bytes`** — state round-tripping and
  size formatting up to multi-terabyte volumes.

## Status

The parsers, the resume-skip logic and the state round-trip are covered by the
tests above, and both scripts parse clean. The startup and failure paths have
been executed end to end.

**The actual copy has never run against a live NAS.** Everything involving
robocopy, SMB and real shares is verified by reasoning and unit tests, not by a
real transfer. Validate on your own hardware before trusting a copy you intend
to wipe the source for:

1. `-ListSharesOnly` — confirm it sees every share you expect
2. `-DryRun` — confirm the file counts look right
3. the real run
4. `-Resume -Recheck -DeepVerify -Hash` before anything destructive
