# Drive health triage and data recovery — verification of disk-triage.sh / disk-triage.ps1 / hulk-drives.md (as of 2026-09-22)

Kit files verified:
- `/home/user/metaplex/ops/network/scripts/disk-triage.sh`
- `/home/user/metaplex/ops/network/scripts/disk-triage.ps1`
- `/home/user/metaplex/ops/network/checklists/hulk-drives.md`

Sourcing note for the report writer. This session's egress proxy blocked most primary hosts outright (smartmontools.org, backblaze.com, gnu.org, learn.microsoft.com, samba.org, nist.gov, kernel.org, wiki.archlinux.org, kb.synology.com, docs.qnap.com, seagate.com, westerndigital.com, support.apple.com, en.wikipedia.org, web.archive.org, arstechnica.com, usenix.org). Where the same document is published verbatim in a GitHub repository (smartmontools man pages and source, MicrosoftDocs markdown that renders to learn.microsoft.com, the rsync man page, the Linux kernel Documentation tree, util-linux, coreutils, nvme-cli, ntfs-3g, hdparm), I quote from that mirror and give both URLs. Where only search-result snippets were available (Backblaze, Synology KB, QNAP docs, Seagate, NIST, ArchWiki/ATA wiki, Volitans/BinaryFruit), the finding is tagged **(snippet)** and should be treated as lower confidence than a full-text quote. Backblaze and Wikipedia are secondary/aggregated by the assignment's own definition; Wikipedia could not be reached at all.

---

## Key question 1 — smartctl through USB bridges (`-d auto`/`sat`/`sat,12`/`usbjmicron`/`usbsunplus`), failure text, macOS and Windows limits

### Takeaway
The kit's `-d auto` then `-d sat` fallback is the right first two steps and matches how smartctl works (auto = OS info + USB-ID database; unknown bridges print "Unknown USB bridge [0x....:0x.... (0x...)] / Please specify device type with the -d option"), but the fallback ladder should also try `sat,12`, `usbjmicron` and `usbsunplus`, the "did it work" test in the shell script is too loose, the PowerShell script has no fallback at all, and the macOS note about SMART-over-USB should be printed whether or not smartctl is installed (macOS has no native SAT support; the third-party kext is effectively Intel-only now).

### Cited Findings

**(a) Kit text**
- `disk-triage.sh` lines 48-49: `out="$($SUDO smartctl -H -A -d auto "$d" 2>/dev/null)"` then `printf '%s' "$out" | grep -q 'SMART' || out="$($SUDO smartctl -H -A -d sat "$d" 2>/dev/null)"`.
- `disk-triage.sh` line 32: `echo "UNKNOWN (SMART not readable through this USB bridge; test it in a SATA bay or the NAS)"`.
- `disk-triage.sh` line 74 (macOS): `out="$($SUDO smartctl -H -A "$d" 2>/dev/null)"`; line 80 (printed only when smartctl is *missing*): `"note: USB enclosures rarely pass SMART through on macOS; 'SMART Status: Not Supported' above means unknown, not bad."`
- `disk-triage.ps1` line 38: `smartctl -H -A $dev | Select-String ...` (no `-d` retry); line 40: `winget install smartmontools.smartmontools`; lines 26-27: `Get-PhysicalDisk | Get-StorageReliabilityCounter | Format-Table ...`; lines 31-33: `Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus` with the catch text `"not available (USB bridges often hide SMART; test the drive in a SATA bay or the NAS)"`.
- `hulk-drives.md` line 12: "`UNKNOWN` is common through USB enclosures on macOS and Windows; if it matters, put the bare disk in a Linux box or a NAS bay for a real SMART read."

**(b) What the sources say**
- `-d auto`: "attempt to guess the device type from the device name or from controller type info provided by the operating system or from a matching USB ID entry in the drive database. This is the default." — [smartctl(8) man page source, smartmontools GitHub mirror](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in) (canonical: https://www.smartmontools.org/browser/trunk/smartmontools/smartctl.8.in, blocked)
- `-d sat`: "the device type is SCSI to ATA Translation (SAT). This is for ATA disks that have a SCSI to ATA Translation Layer (SATL) between the disk and the operating system." — [smartctl(8)](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in)
- `-d sat,12` / `sat,16`: "SAT defines two ATA PASS THROUGH SCSI commands, one 12 bytes long and the other 16 bytes long. The default is the 16 byte variant which can be overridden." — [smartctl(8)](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in)
- `-d sat,auto`: "device type SAT (for ATA/SATA disks) is only used if the SCSI INQUIRY data reports a SATL (VENDOR: "ATA"). Otherwise device type SCSI (for SCSI/SAS disks) is used." — [smartctl(8)](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in)
- `-d usbjmicron`: "for SATA disks behind a JMicron USB to PATA/SATA bridge. The 48-bit ATA commands do not work with all of these bridges and are disabled by default." `-d usbsunplus`: "for SATA disks behind a SunplusIT USB to SATA bridge." `-d usbcypress`: "for ATA disks behind a Cypress USB to PATA bridge." `-d usbprolific`: "for SATA disks behind a Prolific PL2571/2771/2773/2775 USB to SATA bridge." `-d usbasm1352r`: "for one or two SATA disks behind an ASMedia ASM1352R USB to SATA (RAID) bridge." — [smartctl(8)](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in)
- The USB-ID database that `-d auto` consults is `drivedb.h`: USB entries are a "String with format 'USB: DEVICE; BRIDGE' where DEVICE is the name of the device and BRIDGE is the name of the USB bridge"; the match field is "the USB vendor:product ID in hex notation ('0x1234:0xabcd')" and the preset is "one device type ('-d') option". Examples: `"USB: JMicron; SunPlus" "0x152d:0x2329" ... "-d sat"`; `"USB: JMicron generic; JMicron" "0x152d:.*" ... "-d usbjmicron,auto"`; `"USB: SunPlus; SunPlus" "0x04fc:0x0c15" ... "-d usbsunplus"`. Database version line: `VERSION: 7.5`. — [drivedb.h, smartmontools GitHub](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/drivedb.h). The human-readable list built from this is the wiki page https://www.smartmontools.org/wiki/Supported_USB-Devices (blocked in this session; URL given for the reader).
- Failure text for an unrecognised bridge, as reported in the smartmontools tracker: "Unknown USB bridge [0x####:0x#### (0x###)]" followed by "Please specify device type with the -d option." Tickets show that "Many unknown USB bridges only work with the '-d sat' option", that a Seagate FreeAgent GoFlex "work[s] with '-d sat,12' and '-d sat,16'", and that an Iomega MDHD500-U enclosure "works by specifying '-d usbjmicron,0' rather than '-d sat'". **(snippet)** — [smartmontools ticket #332](https://www.smartmontools.org/ticket/332); [ticket #720](https://www.smartmontools.org/ticket/720); [ticket #1003](https://www.smartmontools.org/ticket/1003)
- macOS: the man page's Darwin note is "Use the OS X SAT SMART Driver to access SMART data on SAT capable USB and Firewire devices." — [smartctl(8)](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in)
- The original SAT SMART driver README: requires "a SAT (SCSI ATA Translation) capable external drive enclosure"; after install "disks should display 'S.M.A.R.T. Status: Verified'" in Disk Utility; supported versions listed are "Snow Leopard and Lion and Mountain Lion", with Yosemite requiring `sudo nvram boot-args="kext-dev-mode=1"` (unsigned kexts). — [kasbert/OS-X-SAT-SMART-Driver](https://github.com/kasbert/OS-X-SAT-SMART-Driver)
- Maintained fork status: "DriveDx (1.12.1) and the SAT SMART driver are fully compatible with macOS 26 Tahoe"; "Some modern external USB/FireWire drive enclosures correctly send S.M.A.R.T. data over those interfaces using technology named SAT (SCSI / ATA Translation), though macOS doesn't support this feature out of the box." **(snippet)** — [BinaryFruit SAT SMART Driver blog](https://binaryfruit.com/category/blog/sat-smart-driver); [DriveDx USB drive support](https://binaryfruit.com/drivedx/usb-drive-support)
- Apple Silicon: SMART Utility "is fully compatible with Intel Macs running macOS 15 Sequoia, including the external driver. However, for M1, M2, M3, and M4 Macs running macOS 15 Sequoia, it should be compatible but not the external driver." **(snippet)** — [Volitans SMART Utility FAQ](https://www.volitans-software.com/support/smart-utility-faq/)
- Windows winget package: the manifest directory `manifests/s/smartmontools/smartmontools` exists with versions "7.2 2020-12-30 r5155 (sf-7.2-1)", "7.3 2022-02-28 r5338 (sf-7.3-1)", "7.4 2023-08-01 r5530 (sf-7.4-1)", "7.5" — so the identifier `smartmontools.smartmontools` is correct and the current package is 7.5. — [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs/tree/master/manifests/s/smartmontools/smartmontools)
- `Get-StorageReliabilityCounter`: "Gets storage reliability counters." It returns "information about such things as the device temperature, errors, wear, and length of time the device has been in use." Documented properties include LoadUnloadCycleCount, PowerOnHours, ReadErrorsCorrected/Total/Uncorrected, StartStopCycleCount, Temperature/TemperatureMax, Wear, WriteErrorsCorrected/Total/Uncorrected, ManufactureDate, DeviceId. Example: `Get-PhysicalDisk -FriendlyName "PhysicalDisk8" | Get-StorageReliabilityCounter | Format-List`. The doc contains "no explicit mention of admin rights requirements or device compatibility limitations". — [Get-StorageReliabilityCounter.md, MicrosoftDocs GitHub source of learn.microsoft.com](https://raw.githubusercontent.com/MicrosoftDocs/windows-powershell-docs/main/docset/winserver2025-ps/Storage/Get-StorageReliabilityCounter.md) (renders at https://learn.microsoft.com/en-us/powershell/module/storage/get-storagereliabilitycounter, blocked)
- `MSStorageDriver_FailurePredictStatus`: "The PredictFailure value should be FALSE if the disk controller doesn't detect any disk problems"; a field report states the class "does not work for NVMe disk types but works for Samsung/Toshiba and other disk drives". **(snippet, secondary)** — [Microsoft archived blog: Using WMIC to check for predicted disk failure](https://learn.microsoft.com/en-us/archive/blogs/jamesfi/using-wmic-to-check-for-predicted-disk-failure-s-m-a-r-t-analysis); [BigFix forum: Disk Predict Failure value issue](https://forum.bigfix.com/t/disk-predict-failure-value-issue/39048)

### Inferences
- **Correction 1 (disk-triage.sh lines 48-49, ps1 line 38): widen the fallback ladder and tighten the success test.** `grep -q 'SMART'` matches lines such as "SMART support is: Unavailable" and would then skip the `-d sat` retry, while the real failure text ("Unknown USB bridge ... Please specify device type with the -d option") does not contain the word. Suggested replacement for the Linux loop body:
  ```bash
  out=""
  for t in auto sat sat,12 usbjmicron usbsunplus; do
    out="$($SUDO smartctl -H -A -l selftest -d "$t" "$d" 2>/dev/null)"
    if printf '%s' "$out" | grep -qE 'overall-health|Health Status|SMART Attributes Data Structure|SMART/Health Information'; then break; fi
    out=""
  done
  [ -z "$out" ] && echo "   smartctl: no SMART through this bridge (tried auto, sat, sat,12, usbjmicron, usbsunplus)"
  ```
  For PowerShell: `$out = smartctl -H -A -l selftest -d auto $dev; if (-not ($out -match 'overall-health|Health Status')) { $out = smartctl -H -A -l selftest -d sat $dev }` (and the same ladder if desired). The `-d` types come verbatim from smartctl(8) above; the ladder order (auto, sat, sat,12, usbjmicron, usbsunplus) follows the pattern of successful workarounds in the tracker tickets.
- **Correction 2 (disk-triage.sh line 80): print the macOS caveat unconditionally**, and reword it: "macOS has no built-in SAT pass-through, so smartctl cannot read SMART from USB/Thunderbolt enclosures without the third-party SAT SMART Driver kext; on Apple-silicon Macs that kext is not usable, so 'SMART Status: Not Supported' in `diskutil info` means unknown, not bad. Test the bare disk in a Linux box or NAS bay." (Basis: smartctl(8) Darwin note; Volitans statement that the external driver is not compatible on M-series Macs.)
- **Correction 3 (ps1 line 33, hulk-drives.md line 12): add NVMe to the caveat.** `MSStorageDriver_FailurePredictStatus` is reported not to work for NVMe, so the "not available" branch should read "not available (USB bridges and NVMe drives are usually not exposed here; use smartctl below or test in a SATA bay/NAS)". The hulk-drives line should say UNKNOWN is common on **all three OSes** through an unrecognised USB bridge, with Linux being the one where `-d sat`/`sat,12`/`usbjmicron` usually rescues it.
- `smartmontools.smartmontools` as the winget ID is confirmed; no change.
- `Get-StorageReliabilityCounter` is documented without USB/admin caveats; the kit's "Run elevated for the reliability counters" claim is not contradicted by the doc but also not supported by it (see Gaps).

### Gaps
- Could not fetch the smartmontools USB wiki page (https://www.smartmontools.org/wiki/USB) or the Supported USB-Devices list; the "Unknown USB bridge" wording is taken from ticket titles/snippets rather than the wiki's own text.
- No source found stating whether `Get-StorageReliabilityCounter` requires elevation or returns empty data for USB-attached disks; the Microsoft page is silent on both.
- Apple's own documentation of `diskutil info` "SMART Status: Not Supported" for external drives could not be fetched (support.apple.com blocked).

---

## Key question 2 — SMART attribute thresholds (5/187/188/197/198), what raw > 0 implies, NVMe equivalents, and whether the kit's verdict rule is consistent

### Takeaway
The kit's rule (197 or 198 raw > 0 → FAILING; 5 raw > 0 → WATCH) is consistent with smartmontools' own definitions (a pending sector is one the drive "would like to mark as 'bad' and reallocate"; an offline-uncorrectable sector "was not readable during an off-line scan or a self-test") and with Backblaze's practice of treating any of the five as a red flag, but the kit ignores 187 (Reported_Uncorrect — Backblaze replaces the drive when it goes above zero) and 188 (Command_Timeout), and its NVMe branch only catches the Critical Warning byte, not Media and Data Integrity Errors or Available Spare.

### Cited Findings

**(a) Kit text**
- `disk-triage.sh` lines 18-34 (`smart_verdict`): reads raw values via `awk '$1 == 5 {print $NF}'`, `197`, `198`; FAILING if `overall-health.*FAILED|Health Status: FAILED`; FAILING if pending>0 or uncorrectable>0 ("copy data off NOW with ddrescue, then retire"); WATCH if reallocated>0 ("ok for an offline copy, never for RAID"); HEALTHY if `overall-health.*PASSED|Health Status: OK|Percentage Used`; else UNKNOWN. Line 52 prints IDs `5|9|187|188|194|196|197|198|199` but 187/188/196/199 are not used in the verdict.
- `disk-triage.ps1` lines 41-42: "verdict rule: HealthStatus=Healthy, PredictFailure=False, no Pending/Uncorrectable sectors -> HEALTHY. Reallocated > 0 -> WATCH (offline copies only). Anything else -> FAILING: copy data off first."
- `hulk-drives.md` lines 24-32 decision table (HEALTHY/WATCH/FAILING/UNKNOWN).

**(b) What the sources say**
- Canonical attribute names (smartmontools DEFAULT entry): `-v 5,raw16(raw16),Reallocated_Sector_Ct`, `-v 9,raw24(raw8),Power_On_Hours`, `-v 187,raw48,Reported_Uncorrect`, `-v 188,raw48,Command_Timeout`, `-v 194,tempminmax,Temperature_Celsius`, `-v 196,raw16(raw16),Reallocated_Event_Count`, `-v 197,raw48,Current_Pending_Sector`, `-v 198,raw48,Offline_Uncorrectable`, `-v 199,raw48,UDMA_CRC_Error_Count`. — [drivedb.h](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/drivedb.h)
- 197 meaning: "A pending sector is a disk sector (containing 512 bytes of your data) which the device would like to mark as 'bad' and reallocate." This "typically occurs when a read fails due to corrupted data with inconsistent error correction codes"; the count returns to zero "normally after reallocation or successful re-reads", and "Some disks don't reset this attribute when sectors reallocate." — [smartd.conf(5) `-C` directive, smartmontools GitHub](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartd.conf.5.in)
- 198 meaning: "An offline uncorrectable sector is a disk sector which was not readable during an off-line scan or a self-test." Unreadable data in such sectors means read attempts will fail. — [smartd.conf(5) `-U` directive](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartd.conf.5.in)
- `-H` semantics: "If the device reports failing health status, this means either that the device has already failed, or that it is predicting its own failure within the next 24 hours." smartctl also reports "Failed now" when "current value is below threshold" and "Failed in the past" when "worst value is below threshold". — [smartctl(8)](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in); [atacmds.cpp](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/atacmds.cpp)
- Backblaze (secondary/aggregated): "Backblaze uses SMART 5, 187, 188, 197, and 198 for determining the failure or potential failure of a hard drive"; "SMART 187 reports the number of reads that could not be corrected using hardware ECC, and once SMART 187 goes above zero, drives are scheduled for replacement"; "These five stats were chosen based on Backblaze's experience and input from others in the industry because they are consistent across manufacturers and they are good predictors of failure"; "drives with zero uncorrectable errors hardly ever fail". **(snippet)** — [Backblaze docs: Hard Drive SMART Stats and Failure Rates](https://www.backblaze.com/docs/cloud-storage-hard-drive-smart-stats-and-failure-rates); [Backblaze blog: What SMART Stats Tell Us About Hard Drives](https://www.backblaze.com/blog/what-smart-stats-indicate-hard-drive-failures/)
- NVMe fields as printed by smartctl: "Critical Warning:", "Temperature:", "Available Spare:", "Available Spare Threshold:", "Percentage Used:", "Data Units Read/Written:", "Power Cycles:", "Power On Hours:", "Unsafe Shutdowns:", "Media and Data Integrity Errors:", "Error Information Log Entries:". The NVMe health verdict "SMART overall-health self-assessment test result: %s" is "PASSED" when the Critical Warning byte is zero, otherwise "FAILED!", with explanations: 0x01 "available spare has fallen below threshold", 0x02 "temperature is above or below threshold", 0x04 "NVM subsystem reliability has been degraded", 0x08 "media has been placed in read only mode", 0x10 "volatile memory backup device has failed", 0x20 "persistent memory region has become read-only or unreliable". — [nvmeprint.cpp](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/nvmeprint.cpp)
- smartd's NVMe health check likewise "checks the 'Critical Warning' byte from the SMART/Health Information log; if any warning bit is set, a LOG_CRIT message is logged." — [smartd.conf(5) `-H`](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartd.conf.5.in)

### Inferences
- **Verdict rule: consistent but incomplete.** Treating any 197/198 > 0 as "copy off now" is stricter than Backblaze (which investigates on one, replaces on 187) and stricter than smartmontools (a pending sector can clear on a successful re-read), but for a triage of unknown drives the conservative reading is defensible. Recommended additions to `smart_verdict` (and the ps1 comment):
  - `187 Reported_Uncorrect > 0` → FAILING (Backblaze: "scheduled for replacement" once above zero).
  - `188 Command_Timeout > 0` → WATCH.
  - `199 UDMA_CRC_Error_Count > 0` → print "cable/bridge errors, not media" (do not change verdict).
  - NVMe: `Media and Data Integrity Errors > 0` → WATCH; `Available Spare` below `Available Spare Threshold` or `Percentage Used >= 100` → FAILING (the Critical Warning path already yields "FAILED!" for spare-below-threshold and read-only media).
  - Self-test log (once `-l selftest` is added, see Q3): any entry whose status contains "read failure" or "Completed: unknown failure" → FAILING.
- **Parsing bug (disk-triage.sh lines 20-22): `$NF` is the wrong column for raw values.** smartctl's `-A` table has ten columns and RAW_VALUE is `$10`; for formats such as `raw16(raw16)` (attribute 5) and `tempminmax` (194) smartctl appends extra tokens like `(0 1)` or `(Min/Max 20/45)`, so `$NF` can be `1)` and the numeric test silently fails (the `2>/dev/null` hides the error and the drive is then reported one grade too healthy). Exact fix:
  ```bash
  realloc="$(printf '%s\n' "$out" | awk '$1 == 5   {gsub(/[^0-9].*/, "", $10); print $10}')"
  pend="$(printf '%s\n' "$out"    | awk '$1 == 197 {gsub(/[^0-9].*/, "", $10); print $10}')"
  uncorr="$(printf '%s\n' "$out"  | awk '$1 == 198 {gsub(/[^0-9].*/, "", $10); print $10}')"
  ```
  (Basis: the raw-format definitions `raw16(raw16)`/`tempminmax` in drivedb.h above; column position is smartctl's standard `-A` layout.)
- The HEALTHY test `grep -qE '...|Percentage Used'` is safe only because the FAILED test runs first (NVMe prints the same "overall-health ... FAILED!" string per nvmeprint.cpp); keep the order.

### Gaps
- Backblaze's full post (with per-attribute percentages of failed vs operational drives and the exact "one attribute → investigate / more than one → replace" wording) could not be fetched; only snippet-level statements are cited.
- Google's FAST'07 "Failure Trends in a Large Disk Drive Population" (reallocation/scan-error hazard ratios) could not be fetched from research.google.com or usenix.org.
- Wikipedia's S.M.A.R.T. attribute table was unreachable, so the "critical" flags it assigns to 5/187/188/197/198 are not quoted.
- The NVMe specification's definitions of Percentage Used / Available Spare were not fetched (nvmexpress.org not attempted after repeated blocks); the smartctl label list and Critical Warning bit semantics stand in for them.

---

## Key question 3 — SMART self-tests (`-t short` / `-t long`, `-l selftest`) and when to run them

### Takeaway
The kit never runs or reads a self-test. smartctl's short test takes "usually under ten minutes", the extended test "tens of minutes to several hours", both can run "during normal system operation", and `-l selftest` shows the last 21 results — a long test plus a clean `-l selftest` should be the gate before a HEALTHY drive is repurposed into a NAS bay or as a backup target.

### Cited Findings

**(a) Kit text**
- `disk-triage.sh`/`.ps1`: no `-t` or `-l selftest` anywhere. `hulk-drives.md` §3/§4: repurposing decisions are made on the attribute verdict alone.

**(b) What the sources say**
- `-t short`: "runs SMART Short Self Test (usually under ten minutes). This command can be given during normal system operation (unless run in captive mode)." — [smartctl(8)](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in)
- `-t long`: "runs SMART Extended Self Test (tens of minutes to several hours). This is a longer and more thorough version of the Short Self Test. This command can be given during normal system operation (unless run in captive mode)." — [smartctl(8)](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in)
- `-l selftest`: "prints the SMART self-test log. The disk maintains a self-test log showing the results of the self tests. For each of the most recent twenty-one self-tests, the log shows the type of test (short or extended, off-line or captive) and the final status of the test." — [smartctl(8)](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartctl.8.in)
- smartd's `-l selftest` directive notes "Such errors will only be logged if you run self-tests on the disk (and it fails a test!)" and that failed tests are ignored once "a newer successful extended self-test" completes "all reallocations". The `-s` scheduler syntax uses "T/MM/DD/d/HH" with T = "L=Long, S=Short, C=Conveyance, O=Offline". — [smartd.conf(5)](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartd.conf.5.in)
- Offline-uncorrectable (198) is by definition populated by "an off-line scan or a self-test" — i.e. a drive that has never been self-tested may show 198 = 0 simply because nothing has scanned it. — [smartd.conf(5) `-U`](https://raw.githubusercontent.com/smartmontools/smartmontools/master/smartmontools/smartd.conf.5.in)

### Inferences
- **Addition (disk-triage.sh line 48, ps1 line 38):** add `-l selftest` to the smartctl call so the report shows prior test results, and print a hint after the verdict: `echo "   to confirm HEALTHY before reuse: sudo smartctl -t long $d ; wait the quoted time; sudo smartctl -l selftest $d"`.
- **Addition (hulk-drives.md §3, HEALTHY row and §4 item 1):** "Before a HEALTHY drive goes into a NAS bay or becomes a backup target, run `smartctl -t long /dev/sdX` (hours; the drive stays usable), then `smartctl -l selftest /dev/sdX`; only `Completed without error` qualifies. A `read failure` result moves the drive to FAILING." Rationale: 198 only increments when something scans the surface, so an untested drive's clean attributes prove less than they appear to.
- On macOS through USB the self-test cannot be started without the SAT kext (Q1), so the note should say "on Linux or in the NAS".

### Gaps
- The smartmontools "Bad blocks how-to" (https://www.smartmontools.org/wiki/BadBlockHowto), which is the canonical guidance on reading self-test failures and forcing reallocation, could not be fetched.

---

## Key question 4 — GNU ddrescue workflow (first pass `-d -n`, retry `-d -r3`, mapfile, file vs disk target, mounting the image; macOS/Homebrew; dd vs ddrescue)

### Takeaway
The kit names ddrescue and the right principle ("image first, recover second") but gives no command; the standard two-pass sequence is `ddrescue -d -n SRC IMG MAP` then `ddrescue -d -r3 SRC IMG MAP` with the same mapfile, `-f` when the target is a device, `losetup -fP --show IMG` and `mount -o ro,noload /dev/loopNp1` to inspect the image; ddrescue 1.30 is in Homebrew as `ddrescue`.

### Cited Findings

**(a) Kit text**
- `hulk-drives.md` line 30: "**Image first, recover second**: `ddrescue` the whole disk to a HEALTHY disk of equal or larger size, then mount the image. No direct file copies from a failing disk; each read may be the last. Then retire".
- `disk-triage.sh` line 26: "copy data off NOW with ddrescue, then retire".
- No install instruction for ddrescue on any OS; no mount-the-image command.

**(b) What the sources say**
- Two-pass sequence with a mapfile: first pass `sudo ddrescue -f -n /dev/sdX rescue.img rescue.map` ("-n: grab all the easy blocks first, fast"; "-f: allows writing to existing output file/device"; the mapfile "enables resumption at exact stopping point"); second pass `sudo ddrescue -d -r3 /dev/sdX rescue.img rescue.map` ("-d: use direct disc access for accuracy"; "-r3: retry bad sectors 3 times"). Mounting: `sudo losetup -fP rescue.img` then `sudo mount -o ro /dev/loop0p1 /mnt/rescue`. The gist "emphasizes working exclusively with clones rather than original drives" and says "Mapfiles are essential for safe resumption." **(secondary)** — [ddrescue cheatsheet gist](https://gist.github.com/ricco020/6d469c07a3949a6d70d0e9fa24854e79)
- Search-summary of the GNU manual and guides: "The -d flag uses direct disc access (bypass the kernel cache) for accuracy"; "The -r3 flag tells ddrescue to retry bad sectors 3 times before giving up"; "The -n flag allows for a fast single pass when imaging mechanically failing drives"; ddrescue "reads from a source (failing disk or partition) and writes to a destination (image file or another disk) while recording everything in a logfile (mapfile). It reuses the same logfile so it only works on previously failed or unfinished blocks"; example second pass `sudo ddrescue -d -f -r3 /dev/sdb /mnt/backup/disk.img /mnt/backup/rescue.map`. **(snippet)** — [GNU ddrescue Manual](https://www.gnu.org/software/ddrescue/manual/ddrescue_manual.html) (blocked; snippet only); [Technibble guide](https://www.technibble.com/guide-using-ddrescue-recover-data/)
- Loop-device mechanics: `-P, --partscan`: "Force the kernel to scan the partition table on a newly created loop device."; `-r, --read-only`: "Set up a read-only loop device."; `-f, --find`: "Find the first unused loop device. If a file argument is present, use the found device as loop device."; `--show`: "Display the name of the assigned loop device if the -f option and a file argument are present."; `-d, --detach` detaches. — [losetup(8), util-linux GitHub](https://raw.githubusercontent.com/util-linux/util-linux/master/sys-utils/losetup.8.adoc)
- ext4 images must be mounted `ro,noload` to avoid journal replay writes (quoted in Q5). — [ext4 admin guide, Linux kernel tree](https://raw.githubusercontent.com/torvalds/linux/master/Documentation/admin-guide/ext4.rst)
- macOS availability: Homebrew formula `ddrescue`, desc "GNU data recovery tool", url `https://ftpmirror.gnu.org/ddrescue/ddrescue-1.30.tar.lz` (version 1.30), license GPL-2.0-or-later. — [Homebrew/homebrew-core Formula/d/ddrescue.rb](https://raw.githubusercontent.com/Homebrew/homebrew-core/master/Formula/d/ddrescue.rb) (renders at https://formulae.brew.sh/formula/ddrescue, blocked)

### Inferences
- **Addition (hulk-drives.md §3 FAILING row): give the commands.** Suggested text:
  ```bash
  # target = a HEALTHY disk with >= source capacity, mounted at /mnt/good (image file) or a bare /dev/sdY (disk clone)
  sudo apt install gddrescue            # Debian/Ubuntu package name; binary is ddrescue.  macOS: brew install ddrescue
  sudo ddrescue -d -n  /dev/sdX /mnt/good/hulk-1.img /mnt/good/hulk-1.map   # pass 1: copy the easy blocks, skip scraping
  sudo ddrescue -d -r3 /dev/sdX /mnt/good/hulk-1.img /mnt/good/hulk-1.map   # pass 2: retry bad areas 3x; SAME mapfile
  # disk-to-disk instead of a file: same two lines with /dev/sdY as output and -f added (ddrescue refuses to write to a device without -f)
  sudo losetup -fP --show /mnt/good/hulk-1.img      # prints /dev/loopN; partitions appear as /dev/loopNp1 ...
  sudo mount -o ro,noload /dev/loopNp1 /mnt/ro       # then copy from /mnt/ro with rsync as in the HEALTHY row
  sudo umount /mnt/ro && sudo losetup -d /dev/loopN
  ```
  Never delete or reuse the mapfile between passes; never run plain `dd` (no retries, aborts on the first error) and never `fsck` the failing source — fsck the image or clone only.
- The kit's phrase "to a HEALTHY disk of equal or larger size" is correct for a clone; an image file needs the same free space plus the mapfile — the corrected text should say either is fine.
- `-d` uses O_DIRECT, which macOS lacks; on macOS drop `-d` and use the raw device `/dev/rdiskN` — flagged as an inference because the manual text about `-d` platform support could not be fetched (see Gaps).
- The Debian/Ubuntu package is `gddrescue` (binary `ddrescue`); this is common knowledge in the Debian archive but the package page was blocked, so treat the package name as unverified in this session.

### Gaps
- The GNU ddrescue manual's own Examples chapter (the authoritative `-n` then `-r3` sequence, the `-f` rule, the "ddrescue vs dd" paragraph, and the note on which platforms support `-d`) could not be fetched from gnu.org, savannah, or mirrors; the sequence above is corroborated only by secondary guides and search snippets.

---

## Key question 5 — Read-only inspection per OS (Linux `mount -o ro`/`ro,noload`, ntfs-3g/ntfs3, APFS on Linux; macOS `diskutil mount readOnly`; Windows `diskpart attributes disk set readonly`)

### Takeaway
Plain `mount -o ro` is not read-only for ext4 with a dirty journal ("ext4 will replay the journal (and thus write to the partition) even when mounted 'read only'"; use `ro,noload`), ntfs-3g's default `recover` option "clears" the Windows logfile unless `ro` is given, the kernel ntfs3 driver refuses dirty volumes unless `force` (do not use), Linux APFS is experimental and read-only by default with no encryption support, and `blockdev --setro` is the belt-and-braces step; Microsoft documents diskpart's read-only attribute only as "specifies that the disk is read-only" with no statement of what it blocks.

### Cited Findings

**(a) Kit text**
- `hulk-drives.md` line 16: "Linux: `sudo mkdir -p /mnt/ro && sudo mount -o ro /dev/sdX1 /mnt/ro && du -sh /mnt/ro/* | sort -h`"; `disk-triage.sh` line 59: "`sudo mkdir -p /mnt/ro && sudo mount -o ro /dev/sdX1 /mnt/ro`".
- `hulk-drives.md` line 17: "macOS: `diskutil mount readOnly /dev/diskNsM`, then Finder."; `disk-triage.sh` line 82: same command.
- `hulk-drives.md` line 18: "Windows: it auto-mounts read-write. To be safe, `diskpart` → `select disk N` → `attributes disk set readonly` before browsing; `attributes disk clear readonly` afterwards."

**(b) What the sources say**
- ext4 `ro`: "Mount filesystem read only. Note that ext4 will replay the journal (and thus write to the partition) even when mounted "read only". The mount options "ro,noload" can be used to prevent writes to the filesystem." `noload`/`norecovery`: "Don't load the journal on mounting. Note that if the filesystem was not unmounted cleanly, skipping the journal replay will lead to the filesystem containing inconsistencies that can lead to any number of problems." — [ext4 admin guide, Linux kernel tree](https://raw.githubusercontent.com/torvalds/linux/master/Documentation/admin-guide/ext4.rst) (renders at https://docs.kernel.org/admin-guide/ext4.html, blocked)
- ntfs-3g `ro`: "Mount the filesystem read-only. Useful if Windows is hibernated or the NTFS journal file is unclean." `recover`: "Recover and try to mount a partition which was not unmounted properly by Windows. The Windows logfile is cleared, which may cause inconsistencies. Currently this is the default option." `norecover`: "Do not try to mount a partition which was not unmounted properly by Windows." `remove_hiberfile`: "When the NTFS volume is hibernated, a read-write mount is denied and a read-only mount is forced." — [ntfs-3g(8), tuxera GitHub](https://raw.githubusercontent.com/tuxera/ntfs-3g/edge/src/ntfs-3g.8.in)
- Kernel ntfs3 driver: `force`: "Forces the driver to mount partitions even if volume is marked dirty. Not recommended for use."; features: "Supports native journal replaying". — [ntfs3.rst, Linux kernel tree](https://raw.githubusercontent.com/torvalds/linux/master/Documentation/filesystems/ntfs3.rst)
- APFS on Linux: "This module provides a degree of experimental support on Linux."; "If you make use of the write support, there is a real risk of data corruption, so mounts are read-only by default."; encryption "not yet implemented even in read-only mode"; Fusion drives "will likely never be supported"; targets "all kernel versions since 4.12, but testing is focused on 5.18 and above". — [linux-apfs-rw README](https://raw.githubusercontent.com/linux-apfs/linux-apfs-rw/master/README.rst)
- Block-device write protection: `blockdev --setro`: "Set read-only. The currently active access to the device may not be affected by the change. For example, a filesystem already mounted in read-write mode will not be affected. The change applies after remount." `--getro`: "Print 1 if the device is read-only, 0 otherwise." — [blockdev(8), util-linux GitHub](https://raw.githubusercontent.com/util-linux/util-linux/master/disk-utils/blockdev.8.adoc)
- Windows diskpart: `attributes disk` "displays, sets, or clears the attributes of a disk"; `readonly` "specifies that the disk is read-only"; "A disk must be selected for the attributes disk command to succeed." The page "does not specify whether the read-only attribute is stored on the disk itself, in the registry, or how it persists across systems or reboots." — [attributes-disk.md, MicrosoftDocs GitHub source of learn.microsoft.com](https://raw.githubusercontent.com/MicrosoftDocs/windowsserverdocs/main/WindowsServerDocs/administration/windows-commands/attributes-disk.md) (renders at https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/attributes-disk, blocked)
- A forensic how-to on dirty ext4 summarised in search results: "Ext3 or ext4 will replay its journal if the filesystem is dirty, but you can use the 'ro,noload' mount options to prevent this kind of write access." **(snippet, secondary)** — [Hal Pomeranz, How to Mount Dirty EXT4 File Systems (PDF)](https://righteousit.com/wp-content/uploads/2024/04/how-to-mount-dirty-ext4-file-systems.pdf)

### Inferences
- **Correction (hulk-drives.md line 16 and disk-triage.sh line 59):** replace the single mount line with a per-filesystem block:
  ```bash
  sudo blockdev --setro /dev/sdX                       # whole-device write block first (check: sudo blockdev --getro /dev/sdX -> 1)
  sudo mkdir -p /mnt/ro
  sudo mount -o ro,noload /dev/sdX1 /mnt/ro            # ext2/3/4: plain -o ro still replays the journal = writes
  sudo mount -t ntfs-3g -o ro /dev/sdX1 /mnt/ro        # NTFS: without 'ro' the default 'recover' clears the Windows logfile
  sudo mount -t apfs -o ro /dev/sdX2 /mnt/ro           # APFS: needs the linux-apfs-rw module; encrypted volumes will not mount
  du -sh /mnt/ro/* | sort -h
  ```
  Also state: never pass `force` to ntfs3, never run `fsck`/`chkdsk` on a drive you are only inspecting.
- **Windows line 18: keep the diskpart step but downgrade the promise.** Microsoft documents only that the attribute marks the disk read-only; it does not state that it blocks every write, and by the time diskpart runs Windows has already auto-mounted the volume read-write. Suggested wording: "Windows auto-mounts read-write. `diskpart` → `select disk N` → `attributes disk set readonly` reduces the risk but Microsoft does not document it as a write blocker; for a drive whose data matters, browse it from Linux with the block above, or from a ddrescue image." (`attributes disk clear readonly` afterwards stays.)
- macOS `diskutil mount readOnly` is the correct verb (the kit's syntax matches diskutil's `mount [readOnly] [-mountPoint path] device` form) but this could not be confirmed against Apple's man page in this session (see Gaps); no change proposed.

### Gaps
- Apple's diskutil(8) man page could not be fetched from any mirror (ss64, manpagez, keith.github.io, developer.apple.com archive all blocked/404), so `diskutil mount readOnly` is unverified here.
- No source was reachable that tests whether diskpart's read-only attribute prevents all writes (e.g. NTFS `$LogFile` replay, System Volume Information creation); Microsoft's page is silent, so the kit's "to be safe" claim is neither confirmed nor refuted.

---

## Key question 6 — Verifying copies (`rsync --checksum` semantics and cost, `robocopy /E /COPY:DAT /R:2 /W:5`, hashdeep/md5deep)

### Takeaway
The kit's rsync pair is sound: rsync already verifies every transferred file by whole-file checksum, and the second `--checksum` dry-run is a genuine content comparison at the cost of reading every file on both sides; robocopy's `/COPY:DAT` is the default anyway, `/R:2 /W:5` sensibly override the defaults of 1,000,000 retries and 30 s, and `robocopy ... /E /L` (list-only) or `hashdeep -a -k` are better final checks than comparing `dir /s` counts.

### Cited Findings

**(a) Kit text**
- `hulk-drives.md` lines 36-39: `rsync -rltv --checksum --progress /mnt/ro/ /mnt/nas/hulk-1/` then `rsync -rltvn --checksum /mnt/ro/ /mnt/nas/hulk-1/ | grep -v '/$'   # dry-run again: nothing listed = every file matches`.
- Line 41: "Windows: `robocopy E:\ \\nas\hulk-1 /E /COPY:DAT /R:2 /W:5 /LOG:C:\hulk-1.log`, then compare counts with `dir /s` on both sides."

**(b) What the sources say**
- `--checksum`: "This changes the way rsync checks if the files have been changed and are in need of a transfer." Instead of the default "quick check" (size and modification time) it compares checksums "for files matching in size"; "both sides will expend a lot of disk I/O reading all the data in the files in the transfer", which "can slow things down significantly". Independently of `-c`, "rsync normally verifies that each transferred file was correctly reconstructed on the receiving side by checking a whole-file checksum that is generated as the file is transferred." The algorithm is "auto-negotiated between the client and the server" and can be set with `--checksum-choice` (`--cc`). — [rsync(1) source, RsyncProject GitHub](https://raw.githubusercontent.com/RsyncProject/rsync/master/rsync.1.md) (renders at https://download.samba.org/pub/rsync/rsync.1, blocked)
- `-a` is "equivalent to -rlptgoD" and excludes ACLs, xattrs, atimes, crtimes, hardlinks; `-n/--dry-run` "makes rsync perform a trial run that doesn't make any changes"; `-i/--itemize-changes` prints "a change-summary for all updates" whose output "is supposed to be exactly the same on a dry run and a subsequent real run"; `-t` "set[s] the modification times of the destination files ... to be the same as the source files". — [rsync(1)](https://raw.githubusercontent.com/RsyncProject/rsync/master/rsync.1.md)
- robocopy `/E`: "Copies subdirectories. This option automatically includes empty directories." `/COPY:copyflags`: D (Data), A (Attributes), T (Time stamps), X (skip alt data streams), S (NTFS ACL), O (Owner), U (Auditing); "The default value for the /COPY option is DAT." `/DCOPY` default "DA". `/R:n`: default "1,000,000 retries". `/W:n`: default "30 seconds". `/LOG:file`: "Writes the status output to the log file (overwrites the existing log file)." `/TEE`: "Writes the status output to the console window, and to the log file." `/L`: "Specifies that files are to be listed only (and not copied, deleted, or time stamped)." `/Z`: "Copies files in restartable mode." `/MT`: "Creates multi-threaded copies with n threads. n must be an integer between 1 and 128." `/XJ`: "Excludes junction points, which are normally included by default." `/FFT`: "Assumes FAT file times (two-second precision)." — [robocopy.md, MicrosoftDocs GitHub source](https://raw.githubusercontent.com/MicrosoftDocs/windowsserverdocs/main/WindowsServerDocs/administration/windows-commands/robocopy.md) (renders at https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/robocopy, blocked)
- hashdeep: "Computes multiple hashes, or message digests, for any number of files while optionally recursively digging through the directory structure." `-c`: "Compute hashes of FILES using the algorithms specified. Legal values are md5, sha1, sha256, tiger, and whirlpool." `-k`: "Load a file of known hashes. This flag is required when using any of the matching or audit modes". `-a`: "Each input file is compared against the set of knowns. An audit is said to pass if each input file is matched against exactly one file in set of knowns. Any collisions, new files, or missing files will make the audit fail." `-r`: "Enables recursive mode." — [hashdeep(1), jessek/hashdeep GitHub](https://raw.githubusercontent.com/jessek/hashdeep/master/man/hashdeep.1)

### Inferences
- **rsync lines 37-38: keep, with two tweaks.** (1) Add `-i` so the dry-run prints an itemised reason for any mismatch: `rsync -rltvni --checksum /mnt/ro/ /mnt/nas/hulk-1/ | grep -v '^\.d'`. (2) Note in the checklist that the first pass with `--checksum` costs little (files absent on the NAS are simply sent), while the second pass reads every byte on both the source and the NAS share — hours for multi-TB drives; a mount without `-t` support (some SMB shares) will make every file re-list as a time mismatch, which is why `-i` matters.
- **robocopy line 41: `/COPY:DAT` is redundant (it is the default) but harmless; add `/TEE /XJ`, and replace the `dir /s` count comparison with a list-only re-run**:
  `robocopy E:\ \\nas\hulk-1 /E /R:2 /W:5 /XJ /TEE /LOG:C:\hulk-1.log`
  then verify: `robocopy E:\ \\nas\hulk-1 /E /L /NP /LOG:C:\hulk-1-verify.log` — the summary must show 0 files in the Copied/Extras/Mismatch columns. Add `/FFT` if the NAS share is exFAT/FAT (2-second timestamps).
- **Content-level final check (both OSes):** `hashdeep -r -c sha256 /mnt/ro > hulk-1.sha256` on the source, then `hashdeep -a -k hulk-1.sha256 -r /mnt/nas/hulk-1` — "audit passed" is the only acceptable result. (hashdeep/md5deep ship together; Windows builds exist in the same project.)

### Gaps
- Microsoft's robocopy exit-code table was not captured in the fetch; verification by exit code (0/1 = success, ≥8 = failures) is therefore not quoted.
- No source fetched on rsync's behaviour against SMB mounts that cannot set mtimes; the `-i` recommendation is an inference from the `-t` and `--checksum` definitions.

---

## Key question 7 — Repurposing: CMR vs SMR for NAS/RAID, "NAS-class", filesystem choice for portable drives, Synology/QNAP/TrueNAS external formats

### Takeaway
"NAS-class CMR" as the bar for a NAS bay is consistent with Seagate (IronWolf/IronWolf Pro are CMR; SMR is "best suited for workloads that are sequential") and with Synology's compatibility list, which has an explicit SMR filter; Synology recognises Btrfs/ext3/ext4/FAT32/exFAT/HFS+/NTFS on USB and formats to ext4/FAT32/exFAT, QNAP formats EXT3/EXT4/FAT32/NTFS/HFS+ and charges a licence for exFAT, and the kit's "ZFS or ext4 on TrueNAS" line is doubtful (TrueNAS creates ZFS pools only) but could not be verified.

### Cited Findings

**(a) Kit text**
- `hulk-drives.md` line 47: "**NAS bay** if the NAS has a free bay and the drive is a NAS-class CMR disk of the same size class as the existing ones ... Check the NAS compatibility list. Not for SMR or desktop-class drives in a RAID."
- Line 48: "**USB backup target on the NAS**: plug it into the NAS's USB port, format it from the NAS UI (ext4 on Synology/QNAP, ZFS or ext4 on TrueNAS) ..."
- Line 52: "Filesystem when formatting for direct use on PCs: exFAT for a drive that moves between Mac and Windows; NTFS for Windows-only; APFS for Mac-only; ext4 for Linux or NAS-attached."

**(b) What the sources say**
- Seagate: "IronWolf NAS drives feature CMR technology and AgileArray firmware, ensuring smooth RAID performance ... ideal for heavy workloads and 24×7 operation"; "IronWolf Pro offers up to 32TB of capacity powered by CMR technology for reliable, multi-user performance in RAID/NAS systems"; "SMR is best suited for workloads that are sequential or easily sequentialized, with examples including large media repositories, backup tiers, compliance archives, and object storage environments where data is written once and read occasionally." **(snippet)** — [Seagate: CMR and SMR Hard Drives](https://www.seagate.com/products/cmr-smr-list/); [Seagate IronWolf](https://www.seagate.com/products/nas-drives/ironwolf-hard-drive/)
- Synology publishes a compatibility list with a per-drive SMR feature filter (the URL itself encodes `filter_feature=SMR`). Forum guidance attributed to Synology: "you should not mix CMR and SMR drives in the same RAID. New SMR drives are NAS compatible but only recommended for users in the home environment or small business." **(snippet; the second sentence is forum-relayed, not a Synology page)** — [Synology Compatibility List, HDD, SMR filter](https://www.synology.com/en-global/compatibility?search_by=category&category=hdds_no_ssd_trim&filter_feature=SMR&p=1); [SynoForum thread](https://www.synoforum.com/threads/mix-type-of-drives.12570/)
- Synology external devices: "Synology NAS recognizes the following formats: Btrfs, ext3, ext4, FAT32, exFAT, HFS Plus, and NTFS."; "Some models support HFS Plus with read-only."; "You will need to install exFAT Access from Package Center to enable Synology NAS to support exFAT."; "You can format your external drives to ext4 and FAT32 with Synology NAS. To format the external drive to ext4, FAT32, or exFAT format, the drive capacity must be larger than 1 GB."; "When the drive is formatted as ext4 format, it is only recognized by Synology NAS. If you would like to read data directly from your external drive with a PC or Mac, choose FAT32 format."; "Any unrecognized external drive will have to be formatted first before they can be used on the system." **(snippet)** — [Synology KB: External Devices (DSM help)](https://kb.synology.com/en-global/DSM/help/DSM/AdminCenter/system_externaldevice_devicelist); [Synology KB: Can I use exFAT external storage devices](https://kb.synology.com/en-us/DSM/tutorial/Can_I_use_exFAT_external_storage_devices_with_my_Synology_NAS)
- QNAP: "QNAP external storage devices can be formatted as EXT3, EXT4, FAT32, NTFS, or HFS+ (Mac only)."; "To access partitions formatted using the exFAT file system, you must purchase an exFAT driver license in License Center." **(snippet)** — [QNAP QTS External Storage (4.4.x docs)](https://docs.qnap.com/operating-system/qts/4.4.x/en-us/GUID-B6C934B5-ABFF-4264-A71A-4446B9EE192C.html); [QNAP forum on exFAT licence](https://forum.qnap.com/viewtopic.php?t=168766)
- APFS on Linux is experimental/read-only (quoted in Q5), so an APFS-formatted drive is not "NAS-attached" material. — [linux-apfs-rw README](https://raw.githubusercontent.com/linux-apfs/linux-apfs-rw/master/README.rst)
- 2025 Synology drive policy (headlines only, bodies blocked): "Synology confirms that higher-end NAS products will require its branded drives" (April 2025) and later "Synology walks back controversial compatibility [policy]". **(titles only)** — [TechRadar](https://www.techradar.com/pro/synology-confirms-it-is-cracking-down-on-third-party-nas-hard-drives); [Yahoo Tech](https://tech.yahoo.com/computing/articles/synology-walks-back-controversial-compatibility-143231129.html)

### Inferences
- **Line 47: correct as written**; add one clause: "and, on a 2025-series Synology Plus model, confirm the drive is on the model's verified list before assuming it can join a pool — Synology restricted unverified drives in 2025 and later relaxed the rule; check the current compatibility page for the exact model." (Basis: the two headlines above; details unverified.)
- **Line 48: change "ZFS or ext4 on TrueNAS" to "a ZFS pool on TrueNAS" pending verification** (TrueNAS only creates ZFS pools; ext4 is an import-only format there). Also add "QNAP: exFAT needs a paid licence, so use ext4 (NAS-only) or NTFS (readable on PCs)", and "Synology: exFAT works after installing exFAT Access; ext4 drives are readable only by the NAS."
- **Line 52: add the NAS angle**: "If the same portable drive must also plug into the NAS, avoid APFS (Synology/QNAP do not read it; Linux support is experimental) and note QNAP's exFAT licence; NTFS is readable by both NAS brands and both desktop OSes (macOS reads NTFS natively but does not write it)."
- The SMR exclusion is supported by Seagate's positioning (SMR for sequential/archival workloads) and Synology's SMR filter; the WD "Red vs Red Plus" history is the usual concrete example but could not be fetched (see Gaps).

### Gaps
- Western Digital's 2020 statements (which WD Red models were SMR; WD Red Plus/Pro as CMR) could not be fetched from westerndigital.com, Ars Technica or NAS Compares.
- TrueNAS documentation (Import Disk / pool creation on USB) was blocked; the "ZFS pool only" correction is an inference.
- The body text of Synology's 2025 policy change and its partial reversal (DSM version, affected models) could not be read.
- Apple's Disk Utility format guide (APFS/exFAT/NTFS behaviour on macOS) could not be fetched.

---

## Key question 8 — Secure erase: `hdparm --security-erase` and the "frozen" workaround, `nvme format --ses=1`, `shred` on modern drives, `diskpart clean all`, NIST SP 800-88 purge vs clear

### Takeaway
The kit's hdparm line is missing the mandatory `--security-set-pass NULL` step (hdparm's `--security-erase PWD` erases a "(locked) drive, using password PWD"), its frozen-state note is right (suspend-to-RAM/S3 and resume lifts the freeze), `nvme format --ses=1` is correctly "User Data Erase" (`--ses=2` is cryptographic erase; `nvme sanitize` is the alternative), `shred` is fine for spinning disks but coreutils warns it "assumes the file system and hardware overwrite data in place", `diskpart clean all` "set[s] every sector on the disk to zero", and NIST SP 800-88 Rev. 1 was withdrawn on 26 September 2025 in favour of Rev. 2, which defers to IEEE 2883-2022 — the kit should cite Rev. 2.

### Cited Findings

**(a) Kit text**
- `hulk-drives.md` line 60: "Secure erase before disposal: `sudo nvme format --ses=1 /dev/nvme0n1` for NVMe; `sudo hdparm --user-master u --security-erase NULL /dev/sdX` for SATA (drive must not be frozen; suspend/resume unfreezes it); or `shred -n 1 -v /dev/sdX` if the above is not available."
- Line 61: "Windows: Disk Management → right-click → Format (quick is fine for reuse; use `diskpart` → `clean all` before disposal)."
- Line 59: "Linux full wipe: `sudo wipefs -a /dev/sdX` then `sudo mkfs.ext4 -L hulk-1 /dev/sdX`".

**(b) What the sources say**
- hdparm `--security-erase PWD`: "Erase (locked) drive, using password PWD (DANGEROUS). Password is given as an ASCII string and is padded with NULs to reach 32 bytes. Use the special password NULL to represent an empty password. The applicable drive password is selected with the --user-master switch (default is "user" password). No other options are permitted on the command line with this one." `--security-erase-enhanced PWD`: "Enhanced erase (locked) drive, using password PWD (DANGEROUS)." `--security-set-pass PWD`: "Lock the drive, using password PWD (Set Password) (DANGEROUS). ... Use the special password NULL to set an empty password." `--user-master USER`: "Specifies which password (user/master) to select. Defaults to "user" password." `--security-freeze`: "Freeze the drive's security settings. The drive does not accept any security commands until next power-on reset." — [hdparm(8), Distrotech GitHub mirror of the hdparm source](https://raw.githubusercontent.com/Distrotech/hdparm/master/hdparm.8)
- Password prerequisite and frozen workaround: "To successfully issue an ATA Security Erase command you need to first set a user password, a step omitted from almost all other sources."; "A possible solution for frozen drives is to simply suspend the system (using S3 not S0ix), and upon waking up, it is likely that the freeze will be lifted."; "If suspension doesn't work, one can try hot-(re)plug the data cable (which might crash the kernel)."; "To remove the frozen state, you must suspend your machine and leave it suspended for a couple of minutes, as less than one minute doesn't work." **(snippets)** — [ATA wiki: ATA Secure Erase](https://ata.wiki.kernel.org/index.php/ATA_Secure_Erase); [ArchWiki: Solid state drive/Memory cell clearing](https://wiki.archlinux.org/title/Solid_state_drive/Memory_cell_clearing); [Steven Maude: Securely erasing frozen hard disks with hdparm](https://www.stevenmaude.co.uk/posts/securely-erasing-frozen-hard-disks-with-hdparm)
- `nvme format`: "For the NVMe device given, send an nvme Format Namespace admin command"; `-s/--ses`: "0: No secure erase operation requested", "1: User Data Erase: All user data shall be erased", "2: Cryptographic Erase: All user data shall be erased cryptographically"; `-n 0xffffffff` sends "the format to all namespaces"; `--force` sends "the command immediately without warning of the implications"; warning: "Do not assume any particular device relationship based on their names. If you do, you may irrevocably erase data on an unintended device." — [nvme-format(1), linux-nvme GitHub](https://raw.githubusercontent.com/linux-nvme/nvme-cli/master/Documentation/nvme-format.txt)
- `nvme sanitize`: "sends a Sanitize command"; `-a/--sanact` 0x01 "Exit Failure Mode", 0x02 "Start a Block Erase sanitize operation", 0x03 "Start an Overwrite sanitize operation", 0x04 "Start a Crypto Erase sanitize operation". — [nvme-sanitize(1)](https://raw.githubusercontent.com/linux-nvme/nvme-cli/master/Documentation/nvme-sanitize.txt)
- shred: "-n, --iterations=N overwrite N times instead of the default (%d)"; "-v, --verbose show details of data and metadata operations performed"; "CAUTION: shred assumes the file system and hardware overwrite data in place. Although this is common, many platforms operate otherwise. Also, backups and mirrors may contain unremovable copies that will let a shredded file be recovered later. See the GNU coreutils manual for details." — [shred.c usage text, coreutils GitHub](https://raw.githubusercontent.com/coreutils/coreutils/master/src/shred.c)
- diskpart `clean`: "removes all partitions or volume formatting from the disk with focus"; by default on MBR "only the MBR partitioning information and hidden sector information is overwritten", on GPT "the gpt partitioning information, including the Protective MBR, is overwritten"; `all` "specifies that each and every sector on the disk is set to zero, which completely deletes all data contained on the disk." — [clean.md, MicrosoftDocs GitHub source](https://raw.githubusercontent.com/MicrosoftDocs/windowsserverdocs/main/WindowsServerDocs/administration/windows-commands/clean.md) (renders at https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/clean, blocked)
- NIST status: the nvlpubs copy of SP 800-88 Rev. 1 is now headed "Date updated: September 26, 2025 Withdrawn NIST Technical Series Publication". **(search-result title)** — [NIST SP 800-88r1 PDF](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-88r1.pdf). A vendor summary states: "NIST 800 88 Rev. 2 guidelines supersede NIST 800 88 Rev. 1 on September 26, 2025, with the purge method recommending use of the 2883:2022 standard for performing media sanitization"; "NIST Rev.2 directly does not mention any particular technology-specific techniques to perform data wiping, but it recommends consulting the IEEE 2883 standard". Rev. 1's Appendix A for ATA hard drives: "Clear method uses overwrite media by using agency-approved and validated overwriting technologies/methods/tools, while Purge uses Secure Erase." **(snippet, secondary)** — [BitRaser: NIST 800-88 Purge Standard](https://www.bitraser.com/article/nist-purge-standard.php); [BitRaser: NIST 800-88 clear & purge techniques](https://www.bitraser.com/article/use-nist-hard-drive-erasure.php)

### Inferences
- **Correction (line 60, SATA): the command as written will fail on a drive with no password set.** Exact replacement:
  ```bash
  sudo hdparm -I /dev/sdX | sed -n '/^Security:/,/^$/p'          # must show "not locked" and "not frozen"; note whether "enhanced erase" is supported
  # if "frozen": suspend to RAM (S3), wait a couple of minutes, resume, re-check
  sudo hdparm --user-master u --security-set-pass NULL /dev/sdX   # required first step: sets an empty user password
  sudo hdparm --user-master u --security-erase NULL /dev/sdX      # or --security-erase-enhanced NULL when supported
  # do not power off or interrupt; the drive stays locked if the erase is aborted
  ```
- **Line 60, NVMe:** `--ses=1` is correct. Add: "`--ses=2` (cryptographic erase) is faster where supported; `sudo nvme sanitize /dev/nvme0 -a 2` (block erase) or `-a 4` (crypto erase) is the alternative on drives that implement Sanitize. Check the device name twice — nvme-cli's own warning is that a wrong name 'may irrevocably erase data on an unintended device'."
- **Line 60, shred:** keep for spinning disks only; add "not for SSDs (coreutils: shred 'assumes the file system and hardware overwrite data in place'), and one pass is the NIST 'Clear' level, not 'Purge'."
- **Line 61 (Windows):** correct — `clean` alone only wipes partition tables; `clean all` zeroes every sector (Clear level). Add that a disk must be `select`ed first (Microsoft) and that it is slow (one full write of the disk).
- **Add a NIST line to §5:** "Standard: NIST SP 800-88 Rev. 2 (Sept 2025; Rev. 1 withdrawn), which points to IEEE 2883-2022 for method details. Clear = overwrite (`shred`, `clean all`); Purge = ATA Secure Erase / Enhanced Erase, NVMe Format with SES=1/2 or Sanitize; Destroy = physical." The Rev. 2 details are from a vendor summary and should be re-checked against nist.gov before publication.
- `wipefs -a` + `mkfs.ext4` on line 59 is a reuse-format only (not an erase); the checklist already separates it from disposal, no change.

### Gaps
- NIST SP 800-88 (Rev. 1 or Rev. 2) could not be fetched from nvlpubs.nist.gov, csrc.nist.gov, or tsapps.nist.gov; all NIST quotations here are second-hand.
- hdparm's man page (Distrotech mirror) does not itself describe the "frozen" state or the suspend workaround; those come from the ATA wiki / ArchWiki / blog snippets, none of which could be opened in full.
- No fetched source on whether `shred` on a USB-attached HDD is affected by bridge write caching (irrelevant for a full-device overwrite, but not verified).
