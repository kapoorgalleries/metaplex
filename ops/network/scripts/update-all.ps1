<#
Update this Windows machine: every winget-managed app (Store apps included),
Windows Update through the PSWindowsUpdate module, and the AI CLIs (claude,
codex, gemini, hf). Never reboots; prints REBOOT_REQUIRED=yes when one is
needed. Run elevated (an SSH session as an administrator already is), or push
it with run-remote.sh --os windows update-all.

Windows Update installs security and critical updates only, unless a flag
widens it. Drivers and feature upgrades (a new Windows version) need Sanjay's
yes first. The Windows Update Agent refuses a network logon such as SSH, so the
install runs as a local SYSTEM scheduled task that this script creates, waits
for (up to 2 hours) and removes again; its log is
C:\ProgramData\trimurti\windows-update.log.

Usage: powershell -ExecutionPolicy Bypass -File scripts\update-all.ps1 [-NoOS] [-NoCLIs] [-AllUpdates] [-Drivers] [-FeatureUpgrades]
  -NoOS             skip winget and Windows Update
  -NoCLIs           skip claude, codex, gemini and hf
  -AllUpdates       every software update Windows Update offers, not only security and critical ones
  -Drivers          also driver updates (ask Sanjay first)
  -FeatureUpgrades  also feature upgrades to a new Windows version (ask Sanjay first)
  -h, --help        this text
  The update-all.sh spellings work too: --no-os --no-clis --all-updates --drivers --feature-upgrades
  (--major-upgrade = -FeatureUpgrades; --cleanup has nothing to clean on Windows and is ignored).
Last line: REBOOT_REQUIRED=yes|no|unknown. Exit: 0 every step worked, 1 a step failed (UPDATE_FAILED=
names it), 2 bad arguments.
#>
$ErrorActionPreference = 'Continue'

function Show-Usage([int]$Code, [string]$Why) {
  $text = (((Get-Content -LiteralPath $PSCommandPath -Raw) -split '#>')[0] -replace '^\s*<#\r?\n', '').TrimEnd()
  if ($Code -eq 0) { Write-Host $text } else { [Console]::Error.WriteLine("$Why`n$text") }
  exit $Code
}
$NoOS = $false; $NoCLIs = $false; $AllUpdates = $false; $Drivers = $false; $FeatureUpgrades = $false
foreach ($a in $args) {
  switch -regex ("$a") {
    '^(-h|-help|--help|-\?|/\?)$'                        { Show-Usage 0 }
    '^(-NoOS|--no-os)$'                                  { $NoOS = $true }
    '^(-NoCLIs|--no-clis)$'                              { $NoCLIs = $true }
    '^(-AllUpdates|--all-updates)$'                      { $AllUpdates = $true }
    '^(-Drivers|--drivers)$'                             { $Drivers = $true }
    '^(-FeatureUpgrades|--feature-upgrades|--major-upgrade)$' { $FeatureUpgrades = $true }
    '^--cleanup$'                                        { }
    default                                              { Show-Usage 2 "unknown argument: $a" }
  }
}

# TLS 1.2 for PSGallery and the installers where .NET does not leave the choice to Windows
if ([int][Net.ServicePointManager]::SecurityProtocol -ne 0) { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 }
function Log($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Have($c) { return [bool](Get-Command $c -ErrorAction SilentlyContinue) }
$Failed = New-Object System.Collections.Generic.List[string]
function Add-Failure([string]$Name, [string]$Why) { Write-Warning $Why; $Failed.Add($Name) }
$env:HF_HUB_DISABLE_UPDATE_CHECK = '1'   # hf's daily hint goes to stderr ahead of its output; hf update still checks
# Run a native command with its stderr shown as plain text (Windows PowerShell 5.1 turns redirected
# stderr into error records). Returns the exit code.
function Invoke-Native([string]$Exe, [string[]]$ArgList = @()) {
  $ErrorActionPreference = 'Continue'
  try { & $Exe @ArgList 2>&1 | ForEach-Object { "$_" } | Out-Host } catch { Write-Warning "${Exe}: $($_.Exception.Message)"; return 127 }
  return $LASTEXITCODE
}
# The first line of '<cli> --version' that looks like a version, from stdout only.
function Get-CliVersion($c) {
  $v = $null
  try { $v = & $c --version 2>$null | ForEach-Object { "$_" } | Where-Object { $_ -match '\d+\.\d+' } | Select-Object -First 1 } catch { }
  if ($v) { return $v.Trim() } else { return '(no version output)' }
}
# winget is a per-user Store app and can be missing from PATH in an SSH session; find it.
function Find-Winget {
  $c = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  if ($env:LOCALAPPDATA) { $p = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe'; if (Test-Path $p) { return $p } }
  $q = Get-ChildItem 'C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*\winget.exe' -ErrorAction SilentlyContinue |
       Sort-Object FullName -Descending | Select-Object -First 1
  if ($q) { return $q.FullName }
  return $null
}
# The Windows Update classifications to install: security and critical by default.
function Get-WUFilter([bool]$All, [bool]$WithDrivers, [bool]$WithUpgrades) {
  $skip = @(); if (-not $WithDrivers) { $skip += 'Drivers' }; if (-not $WithUpgrades) { $skip += 'Upgrades' }
  if ($All) { if ($skip.Count) { return @{ NotCategory = $skip } } else { return @{} } }
  $cats = @('Security Updates', 'Critical Updates'); if ($WithDrivers) { $cats += 'Drivers' }; if ($WithUpgrades) { $cats += 'Upgrades' }
  return @{ Category = $cats }
}
# PSWindowsUpdate for all users (the SYSTEM task imports it by path). NuGet and the module come from
# PSGallery without a prompt (-Force) and without marking PSGallery trusted.
function Get-PSWUModulePath {
  $pf = $env:ProgramFiles
  $find = { Get-Module -ListAvailable -Name PSWindowsUpdate | Where-Object { $_.Path -like "$pf\*" } | Sort-Object Version -Descending | Select-Object -First 1 }
  $m = & $find
  if (-not $m) {
    Log 'installing the PSWindowsUpdate module from PSGallery (for all users)'
    if (-not (Get-PackageProvider -ListAvailable -Name NuGet -ErrorAction SilentlyContinue | Where-Object { $_.Version -ge [version]'2.8.5.201' })) {
      Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope AllUsers -Force -ErrorAction Stop | Out-Null
    }
    Install-Module -Name PSWindowsUpdate -Repository PSGallery -Scope AllUsers -Force -ErrorAction Stop
    $m = & $find
    if (-not $m) { throw "PSWindowsUpdate is still not installed under $pf" }
  }
  return $m.Path
}
# The script the SYSTEM task runs. It logs what Windows Update offers, installs the chosen
# classifications, and ends with one TRIMURTI_WU_RESULT or TRIMURTI_WU_ERROR line and exit 0/1.
function New-WUTaskScript([string]$ModulePath, [string]$Log, [hashtable]$Filter) {
  $f = ($Filter.Keys | ForEach-Object { "$_ = @('" + (($Filter[$_] | ForEach-Object { $_ -replace "'", "''" }) -join "', '") + "')" }) -join '; '
@"
`$ErrorActionPreference = 'Stop'
function W(`$m) { Add-Content -LiteralPath '$Log' -Value `$m -Encoding UTF8 }
`$code = 1
try {
  Import-Module '$($ModulePath -replace "'", "''")'
  `$filter = @{ $f }
  `$offered = @(Get-WindowsUpdate)
  W "offered by Windows Update: `$(`$offered.Count)"
  foreach (`$u in `$offered) { W ("  {0,-10} {1}" -f `$u.KB, `$u.Title) }
  `$res = @(Get-WindowsUpdate @filter -AcceptAll -Install -IgnoreReboot)
  foreach (`$u in `$res) { W ("  {0,-12} {1,-10} {2}" -f `$u.Result, `$u.KB, `$u.Title) }
  `$done = @(`$res | Where-Object { "`$(`$_.Result)" -like 'Installed*' } | ForEach-Object { `$_.Title } | Select-Object -Unique)
  `$bad = @(`$res | Where-Object { "`$(`$_.Result)" -match 'Failed|Aborted|WithErrors' } | ForEach-Object { `$_.Title } | Select-Object -Unique)
  `$skipped = @(`$offered | Where-Object { @(`$res | ForEach-Object { `$_.Title }) -notcontains `$_.Title })
  foreach (`$u in `$skipped) { W ("  skipped    {0,-10} {1}" -f `$u.KB, `$u.Title) }
  `$reboot = [bool](Get-WURebootStatus -Silent)
  W "TRIMURTI_WU_RESULT installed=`$(`$done.Count) failed=`$(`$bad.Count) skipped=`$(`$skipped.Count) reboot=`$(if (`$reboot) { 'yes' } else { 'no' })"
  if (`$bad.Count -eq 0) { `$code = 0 }
} catch {
  W "TRIMURTI_WU_ERROR `$(`$_.Exception.Message)"
}
exit `$code
"@
}
# Parse the task's last result line: @{ ok; reboot (yes|no|unknown); text }.
function Read-WUResult([string[]]$Lines) {
  $r = @{ ok = $false; reboot = 'unknown'; text = 'the Windows Update task wrote no result line' }
  $last = $Lines | Where-Object { $_ -match '^TRIMURTI_WU_(RESULT|ERROR)' } | Select-Object -Last 1
  if ($last -match '^TRIMURTI_WU_RESULT installed=(\d+) failed=(\d+) skipped=(\d+) reboot=(yes|no)') {
    $r.ok = ($Matches[2] -eq '0'); $r.reboot = $Matches[4]
    $r.text = "installed $($Matches[1]), failed $($Matches[2]), skipped $($Matches[3])"
  } elseif ($last -match '^TRIMURTI_WU_ERROR (.*)$') { $r.text = "Windows Update failed: $($Matches[1])" }
  return $r
}
# Windows Update through a SYSTEM scheduled task: create it, wait for it ($Minutes at most), read its
# result and remove it. Returns what Windows Update says about a reboot: yes, no or unknown.
function Invoke-WUTask([string]$Dir, [hashtable]$Filter, [int]$Minutes = 120) {
  $wuLog = Join-Path $Dir 'windows-update.log'
  try {
    $module = Get-PSWUModulePath
    # SYSTEM runs the script in this folder and writes the log there, so only Administrators and
    # SYSTEM may write to it: owner, ACL and our two files are reset before every run.
    if ((Test-Path $Dir) -and ((Get-Item -LiteralPath $Dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "$Dir is a link, not a folder; remove it by hand and rerun"
    }
    New-Item -ItemType Directory -Path $Dir -Force -ErrorAction Stop | Out-Null
    $icacls = "$env:SystemRoot\System32\icacls.exe"
    foreach ($acl in @(@($Dir, '/reset'), @($Dir, '/setowner', '*S-1-5-32-544'),
                       @($Dir, '/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'))) {
      $rc = Invoke-Native $icacls $acl
      if ($rc -ne 0) { throw "icacls $($acl -join ' ') failed ($rc)" }
    }
    $taskScript = Join-Path $Dir 'windows-update-task.ps1'
    Remove-Item -LiteralPath $taskScript, $wuLog -Force -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText($taskScript, (New-WUTaskScript $module $wuLog $Filter), (New-Object Text.UTF8Encoding $false))
    # -ExecutionPolicy Bypass: the default policy on Windows clients (Restricted) would refuse the
    # script and PSWindowsUpdate's own .psm1 and .ps1xml files.
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
      -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$taskScript`""
    $principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    $start = (Get-Date).AddSeconds(-5)
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $deadline = (Get-Date).AddMinutes($Minutes); $began = $false; $state = ''
    do {
      Start-Sleep -Seconds 10
      $state = "$((Get-ScheduledTask -TaskName $TaskName).State)"
      if ($state -eq 'Running' -or (Get-ScheduledTaskInfo -TaskName $TaskName).LastRunTime -ge $start) { $began = $true }
      if (-not $began -and (Get-Date) -gt $start.AddMinutes(3)) { break }
    } until (($began -and $state -ne 'Running' -and $state -ne 'Queued') -or (Get-Date) -gt $deadline)
    $lines = @(); if (Test-Path $wuLog) { $lines = @(Get-Content -LiteralPath $wuLog -Encoding UTF8) }
    $lines | Where-Object { $_ -notmatch '^TRIMURTI_WU_' } | Out-Host
    if (-not $began) {
      Add-Failure 'windows-update' 'the Windows Update task did not start within 3 minutes'
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
      return 'unknown'
    }
    if ($state -eq 'Running' -or $state -eq 'Queued') {
      Add-Failure 'windows-update' "Windows Update is still running after $Minutes minutes; the task keeps going, check $wuLog later"
      return 'unknown'
    }
    $r = Read-WUResult $lines
    $code = (Get-ScheduledTaskInfo -TaskName $TaskName).LastTaskResult
    Log "Windows Update: $($r.text) (task exit $code)"
    if (-not $r.ok -or $code -ne 0) { Add-Failure 'windows-update' "Windows Update: $($r.text) (task exit $code); see $wuLog" }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $taskScript -Force -ErrorAction SilentlyContinue
    return $r.reboot
  } catch {
    Add-Failure 'windows-update' "Windows Update could not run: $($_.Exception.Message). Use Settings > Windows Update on this machine instead."
    return 'unknown'
  }
}
$Winget = Find-Winget
$reboot = 'no'
$TaskName = 'trimurti-windows-update'

if (-not $NoOS) {
  if ($Winget) {
    Log 'winget upgrade --all'
    $rc = Invoke-Native $Winget @('upgrade', '--all', '--silent', '--include-unknown', '--disable-interactivity', '--accept-source-agreements', '--accept-package-agreements')
    # 0x8A15002B: nothing to upgrade
    if ($rc -eq -1978335188) { Add-Failure 'winget' 'winget: some packages failed to upgrade (0x8A15002C); see the lines above and rerun after closing those apps' }
    elseif ($rc -ne 0 -and $rc -ne -1978335189) { Add-Failure 'winget' "winget upgrade --all failed ($rc)" }
  } else { Add-Failure 'winget' 'winget missing (install App Installer from the Store and log in to the desktop once); app upgrades skipped' }

  $what = 'security and critical updates'
  if ($AllUpdates) { $what = 'all software updates' }
  if ($Drivers) { $what += ', drivers' }
  if ($FeatureUpgrades) { $what += ', feature upgrades' }
  Log "Windows Update ($what; PSWindowsUpdate in a local SYSTEM scheduled task)"
  $me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  $dir = Join-Path $env:ProgramData 'trimurti'
  $wuLog = Join-Path $dir 'windows-update.log'
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Add-Failure 'windows-update' "Windows Update needs an elevated PowerShell on ${env:COMPUTERNAME}: rerun as administrator (an SSH session as an administrator already is)"
  } elseif ($existing -and "$($existing.State)" -eq 'Running') {
    Add-Failure 'windows-update' "a Windows Update task from an earlier run is still running; check $wuLog and rerun later"
    $reboot = 'unknown'
  } else {
    $wu = Invoke-WUTask $dir (Get-WUFilter $AllUpdates $Drivers $FeatureUpgrades)
    if ($wu -ne 'no') { $reboot = $wu }
    $left = @()
    if (-not $AllUpdates) { $left += 'other software updates (-AllUpdates)' }
    if (-not $Drivers) { $left += 'drivers (-Drivers)' }
    if (-not $FeatureUpgrades) { $left += 'feature upgrades (-FeatureUpgrades)' }
    if ($left.Count) { Write-Host "  not installed on purpose: $($left -join ', '); drivers and feature upgrades only with Sanjay's yes" }
  }
  # Earlier versions of this script left a 'PSWindowsUpdate' task behind (Invoke-WUJob)
  $old = Get-ScheduledTask -TaskName 'PSWindowsUpdate' -ErrorAction SilentlyContinue
  if ($old -and "$($old.Actions.Arguments)" -match 'TRIMURTI_WU_DONE' -and "$($old.State)" -ne 'Running') { Unregister-ScheduledTask -TaskName 'PSWindowsUpdate' -Confirm:$false -ErrorAction SilentlyContinue }
}

if (-not $NoCLIs) {
  if (Have 'claude') {
    Log 'Claude Code'
    if ((Invoke-Native 'claude' @('update')) -ne 0) { Add-Failure 'claude' "'claude update' failed" }
  }
  if ($Winget) { & $Winget upgrade --id Anthropic.ClaudeCode --silent --disable-interactivity --accept-source-agreements --accept-package-agreements *> $null }
  if (Have 'codex') {   # codex update knows whether it came from the installer or npm
    Log 'Codex CLI'
    if ((Invoke-Native 'codex' @('update')) -ne 0) { Add-Failure 'codex' "'codex update' failed" }
  }
  if (Have 'npm') {
    foreach ($p in '@google/gemini-cli') {
      & npm ls -g --depth=0 $p *> $null
      if ($LASTEXITCODE -eq 0) {
        Log $p
        if ((Invoke-Native 'npm' @('install', '-g', '--no-fund', '--no-audit', "$p@latest")) -ne 0) { Add-Failure 'gemini' "npm update of $p failed; rerun bootstrap-ai-clis.ps1" }
      }
    }
  }
  if (Have 'hf') {   # installer or pip, whichever it came from; refreshes the hf-cli skill too
    Log 'Hugging Face CLI'
    if ((Invoke-Native 'hf' @('update')) -ne 0) { Add-Failure 'hf' "'hf update' failed" }
  }
}

# Other reboot signals Windows leaves behind. PendingFileRenameOperations alone is not one: almost
# every installer queues a file there, so it only suggests a reboot.
if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') { $reboot = 'yes' }
if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') { $reboot = 'yes' }
$renames = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue

Log "versions on ${env:COMPUTERNAME}:"
foreach ($c in 'claude', 'codex', 'gemini', 'hf', 'node') {
  if (Have $c) { $v = Get-CliVersion $c } else { $v = 'missing' }
  Write-Host ("  {0,-7} {1}" -f $c, $v)
}
if ($Failed.Count) { Write-Host "UPDATE_FAILED=$($Failed -join ',')" }
if ($reboot -eq 'yes') { Write-Host '  -> reboot this machine when convenient (nothing here reboots for you)' }
elseif ($renames) { Write-Host '  (files are queued for replacement at the next restart: a reboot is suggested, not required)' }
Write-Host "REBOOT_REQUIRED=$reboot"
if ($Failed.Count) { exit 1 }
exit 0
