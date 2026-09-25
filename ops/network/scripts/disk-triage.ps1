<#
Read-only look at every disk on this Windows machine: model, size, bus,
partition style, volumes, health, reliability counters and the SMART
failure-prediction bit. For the Hulk drives run it on the machine they are
plugged into. Nothing is written to any disk. Run elevated for the
reliability counters. Run from the kit, the report is saved as
out\disks-<host>-<stamp>.txt; pushed by run-remote.sh (or the MCP), nothing is
saved on the target and the admin machine keeps the output in out/logs/.

Usage: powershell -ExecutionPolicy Bypass -File scripts\disk-triage.ps1
  -h, --help   this text
Exit: 0 every step ran, 1 a step failed (not elevated, smartctl missing; DISK_TRIAGE_FAILED= names it),
2 bad arguments.
#>
$ErrorActionPreference = 'Continue'

function Show-Usage([int]$Code, [string]$Why) {
  $text = (((Get-Content -LiteralPath $PSCommandPath -Raw) -split '#>')[0] -replace '^\s*<#\r?\n', '').TrimEnd()
  if ($Code -eq 0) { Write-Host $text } else { [Console]::Error.WriteLine("$Why`n$text") }
  exit $Code
}
foreach ($a in $args) {
  if ("$a" -match '^(-h|-help|--help|-\?|/\?)$') { Show-Usage 0 }
  Show-Usage 2 "unknown argument: $a"
}
$failed = @()
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
# In the kit (lib.sh next to this script): a copy in out\. A lone copy (run-remote.sh puts one in
# the SSH user's home) saves nothing; its output is the report.
$report = ''
$inKit = Test-Path -LiteralPath (Join-Path $PSScriptRoot 'lib.sh')
if ($inKit) {
  $outDir = if ($env:OUT_DIR) { $env:OUT_DIR } else { Join-Path (Split-Path -Parent $PSScriptRoot) 'out' }
  try {
    New-Item -ItemType Directory -Force -Path $outDir -ErrorAction Stop | Out-Null
    $report = Join-Path (Resolve-Path -LiteralPath $outDir -ErrorAction Stop).ProviderPath ("disks-{0}-{1}.txt" -f $env:COMPUTERNAME, (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Start-Transcript -Path $report -ErrorAction Stop | Out-Null
  } catch { "not saved in ${outDir}: $($_.Exception.Message)"; $report = '' }
}

"== $env:COMPUTERNAME - $(Get-Date) =="
"`n== disks =="
try {
  Get-Disk -ErrorAction Stop | Sort-Object Number | Format-Table Number, FriendlyName, SerialNumber,
    @{n = 'SizeGB'; e = { [math]::Round($_.Size / 1GB) } }, BusType, PartitionStyle, HealthStatus, OperationalStatus -AutoSize | Out-String -Width 220
} catch { "  not available: $($_.Exception.Message)"; $failed += 'disks' }
"== physical disks =="
Get-PhysicalDisk | Format-Table DeviceId, FriendlyName, MediaType, BusType,
  @{n = 'SizeGB'; e = { [math]::Round($_.Size / 1GB) } }, HealthStatus, OperationalStatus -AutoSize | Out-String -Width 220
"== volumes =="
Get-Volume | Where-Object DriveLetter | Sort-Object DriveLetter | Format-Table DriveLetter, FileSystemLabel, FileSystem,
  @{n = 'SizeGB'; e = { [math]::Round($_.Size / 1GB) } }, @{n = 'FreeGB'; e = { [math]::Round($_.SizeRemaining / 1GB) } }, HealthStatus -AutoSize | Out-String -Width 220
"== reliability counters (admin) =="
if (-not $admin) { "  skipped: they (and smartctl) need an elevated PowerShell; over SSH an administrator already is one"; $failed += 'not-elevated' }
else {
  $rel = @(Get-PhysicalDisk | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue -ErrorVariable relErr)
  if ($rel.Count) { $rel | Format-Table DeviceId, Temperature, PowerOnHours,
    ReadErrorsTotal, ReadErrorsUncorrected, WriteErrorsUncorrected, Wear, StartStopCycleCount -AutoSize | Out-String -Width 220 }
  foreach ($e in $relErr) { "  not available for a disk: $($e.Exception.Message)" }
}
"== SMART failure prediction (ATA disks only; NVMe is not covered by this class) =="
try {
  Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction Stop |
    ForEach-Object { "  {0}  PredictFailure={1}" -f $_.InstanceName, $_.PredictFailure }
} catch { "  not available (USB bridges often hide SMART; test the drive in a SATA bay or the NAS)" }
if (Get-Command smartctl -ErrorAction SilentlyContinue) {
  "`n== smartctl =="
  smartctl --scan 2>$null | ForEach-Object {
    $dev = ($_ -split ' ')[0]; "--- $dev"
    $out = smartctl -H -A $dev 2>$null
    # USB bridges usually need an explicit device type; try the ones that rescue most enclosures
    foreach ($t in 'sat', 'sat,12', 'usbjmicron', 'usbsunplus') {
      if ($out -match 'overall-health|Health Status|SMART/Health Information') { break }
      $out = smartctl -H -A -d $t $dev 2>$null
    }
    $out | Select-String 'overall-health|Health Status|Reallocated|Reported_Uncorrect|Command_Timeout|Pending|Uncorrectable|Power_On|Temperature|Percentage Used|Available Spare|Media and Data|Critical Warning'
    smartctl -l selftest $dev 2>$null | Select-String '^# *\d' | Select-Object -First 2
  }
} else { "`nsmartctl missing:  winget install smartmontools.smartmontools   (then reopen the terminal and rerun)"; $failed += 'smartctl-missing' }
"`nverdict rule: HealthStatus=Healthy, PredictFailure=False, Pending (197) and Uncorrectable (198) both 0 -> HEALTHY, then run a long self-test before trusting it."
"              Reallocated (5), Reported Uncorrectable (187) or Command Timeout (188) > 0 -> WATCH (offline copies only)."
"              197 or 198 > 0, NVMe Media Errors > 0, or a Critical Warning -> FAILING: image it with ddrescue first."
if ($report) { "saved: $report   -> decide with checklists\hulk-drives.md" }
elseif (-not $inKit) { "not saved on ${env:COMPUTERNAME}: run-remote.sh keeps this output in out/logs/ on the admin machine   -> decide with checklists\hulk-drives.md" }
if ($failed.Count) { "DISK_TRIAGE_FAILED=$($failed -join ',')" }
if ($report) { Stop-Transcript | Out-Null }
if ($failed.Count) { exit 1 }
exit 0
