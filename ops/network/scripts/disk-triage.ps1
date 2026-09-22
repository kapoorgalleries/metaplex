<#
Read-only look at every disk on this Windows machine: model, size, bus,
partition style, volumes, health, reliability counters and the SMART
failure-prediction bit. For the Hulk drives run it on the machine they are
plugged into. Nothing is written to any disk. Run elevated for the
reliability counters. Report: %USERPROFILE%\trimurti-disks-<host>-<stamp>.txt

Usage: powershell -ExecutionPolicy Bypass -File scripts\disk-triage.ps1
#>
$ErrorActionPreference = 'Continue'
$report = Join-Path $HOME ("trimurti-disks-{0}-{1}.txt" -f $env:COMPUTERNAME, (Get-Date -Format 'yyyyMMdd-HHmmss'))
Start-Transcript -Path $report | Out-Null

"== $env:COMPUTERNAME · $(Get-Date) =="
"`n== disks =="
Get-Disk | Sort-Object Number | Format-Table Number, FriendlyName, SerialNumber,
  @{n = 'SizeGB'; e = { [math]::Round($_.Size / 1GB) } }, BusType, PartitionStyle, HealthStatus, OperationalStatus -AutoSize | Out-String -Width 220
"== physical disks =="
Get-PhysicalDisk | Format-Table DeviceId, FriendlyName, MediaType, BusType,
  @{n = 'SizeGB'; e = { [math]::Round($_.Size / 1GB) } }, HealthStatus, OperationalStatus -AutoSize | Out-String -Width 220
"== volumes =="
Get-Volume | Where-Object DriveLetter | Sort-Object DriveLetter | Format-Table DriveLetter, FileSystemLabel, FileSystem,
  @{n = 'SizeGB'; e = { [math]::Round($_.Size / 1GB) } }, @{n = 'FreeGB'; e = { [math]::Round($_.SizeRemaining / 1GB) } }, HealthStatus -AutoSize | Out-String -Width 220
"== reliability counters (admin) =="
try {
  Get-PhysicalDisk | Get-StorageReliabilityCounter | Format-Table DeviceId, Temperature, PowerOnHours,
    ReadErrorsTotal, ReadErrorsUncorrected, WriteErrorsUncorrected, Wear, StartStopCycleCount -AutoSize | Out-String -Width 220
} catch { "not available: $($_.Exception.Message)" }
"== SMART failure prediction (ATA disks only; NVMe is not covered by this class) =="
try {
  Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction Stop |
    ForEach-Object { "  {0}  PredictFailure={1}" -f $_.InstanceName, $_.PredictFailure }
} catch { "  not available (USB bridges often hide SMART; test the drive in a SATA bay or the NAS)" }
if (Get-Command smartctl -ErrorAction SilentlyContinue) {
  "`n== smartctl =="
  smartctl --scan | ForEach-Object {
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
} else { "`nsmartctl missing:  winget install smartmontools.smartmontools   (then reopen the terminal and rerun)" }
"`nverdict rule: HealthStatus=Healthy, PredictFailure=False, Pending (197) and Uncorrectable (198) both 0 -> HEALTHY, then run a long self-test before trusting it."
"              Reallocated (5), Reported Uncorrectable (187) or Command Timeout (188) > 0 -> WATCH (offline copies only)."
"              197 or 198 > 0, NVMe Media Errors > 0, or a Critical Warning -> FAILING: image it with ddrescue first."
Stop-Transcript | Out-Null
"saved: $report   -> decide with checklists\hulk-drives.md"
