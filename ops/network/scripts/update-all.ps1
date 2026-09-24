<#
Update this Windows machine: every winget-managed app (Store apps included),
Windows Update through the PSWindowsUpdate module, and the three AI CLIs.
Never reboots; prints REBOOT_REQUIRED=yes when one is needed. Run elevated
(an SSH session as an administrator already is), or push it with
run-remote.sh --os windows update-all.

Usage: powershell -ExecutionPolicy Bypass -File scripts\update-all.ps1 [-NoOS] [-NoCLIs]
#>
param([switch]$NoOS, [switch]$NoCLIs)
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Log($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Have($c) { return [bool](Get-Command $c -ErrorAction SilentlyContinue) }
# winget is a per-user Store app and can be missing from PATH in an SSH session; find it.
function Find-Winget {
  $c = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe'
  if (Test-Path $p) { return $p }
  $q = Get-ChildItem 'C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*\winget.exe' -ErrorAction SilentlyContinue |
       Sort-Object FullName -Descending | Select-Object -First 1
  if ($q) { return $q.FullName }
  return $null
}
$Winget = Find-Winget
$reboot = $false

if (-not $NoOS) {
  if ($Winget) {
    Log 'winget upgrade --all'
    & $Winget upgrade --all --silent --include-unknown --disable-interactivity --accept-source-agreements --accept-package-agreements | Out-Host
    if ($LASTEXITCODE -eq -1978335188) { Write-Warning 'winget: some packages failed to upgrade (0x8A15002C); see the lines above and rerun after closing those apps' }
  } else { Write-Warning 'winget missing (install App Installer from the Store and log in to the desktop once); skipping app upgrades' }

  # The Windows Update Agent refuses to install from a network logon such as SSH (E_ACCESSDENIED), so the
  # module's Invoke-WUJob runs the install as a local scheduled task under SYSTEM and we wait for it.
  Log 'Windows Update (PSWindowsUpdate, as a local scheduled task)'
  try {
    if (-not (Get-Module -ListAvailable -Name PSWindowsUpdate)) {
      Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force | Out-Null
      Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
      Install-Module -Name PSWindowsUpdate -Force -Scope AllUsers
    }
    Import-Module PSWindowsUpdate
    $wuLog = Join-Path $env:ProgramData 'trimurti-windows-update.log'
    Remove-Item $wuLog -ErrorAction SilentlyContinue
    $script = "Import-Module PSWindowsUpdate; Get-WindowsUpdate -AcceptAll -Install -IgnoreReboot | Out-File -FilePath '$wuLog' -Append; 'TRIMURTI_WU_DONE' | Out-File -FilePath '$wuLog' -Append"
    Invoke-WUJob -ComputerName $env:COMPUTERNAME -Script $script -RunNow -Confirm:$false | Out-Null
    $deadline = (Get-Date).AddMinutes(90)
    do {
      Start-Sleep -Seconds 30
      $done = (Test-Path $wuLog) -and (Select-String -Path $wuLog -SimpleMatch 'TRIMURTI_WU_DONE' -Quiet)
    } until ($done -or (Get-Date) -gt $deadline)
    if (Test-Path $wuLog) { Get-Content $wuLog | Where-Object { $_ -ne 'TRIMURTI_WU_DONE' } | Out-Host }
    if (-not $done) { Write-Warning 'Windows Update task is still running after 90 minutes; check Settings > Windows Update later' }
    $reboot = [bool](Get-WURebootStatus -Silent)
  } catch {
    Write-Warning "PSWindowsUpdate failed: $($_.Exception.Message). Use Settings > Windows Update on this machine instead."
  }
}

if (-not $NoCLIs) {
  if (Have 'claude') { Log 'Claude Code'; try { & claude update | Out-Host } catch { } }
  if ($Winget) { & $Winget upgrade --id Anthropic.ClaudeCode --silent --disable-interactivity --accept-source-agreements --accept-package-agreements *> $null }
  if (Have 'codex') { Log 'Codex CLI'; try { & codex update | Out-Host } catch { } }   # knows whether it came from the installer or npm
  if (Have 'npm') {
    foreach ($p in '@google/gemini-cli') {
      & npm ls -g --depth=0 $p *> $null
      if ($LASTEXITCODE -eq 0) { Log $p; & npm install -g --no-fund --no-audit "$p@latest" | Out-Host }
    }
  }
}

# Other reboot signals Windows leaves behind
if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') { $reboot = $true }
if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') { $reboot = $true }
if (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue) { $reboot = $true }

Log "versions on ${env:COMPUTERNAME}:"
foreach ($c in 'claude', 'codex', 'gemini', 'node') {
  if (Have $c) { $v = (& $c --version 2>&1 | Select-Object -First 1) } else { $v = 'missing' }
  Write-Host ("  {0,-7} {1}" -f $c, $v)
}
Write-Host ("REBOOT_REQUIRED={0}" -f $(if ($reboot) { 'yes' } else { 'no' }))
if ($reboot) { Write-Host '  -> reboot this machine when convenient (nothing here reboots for you)' }
exit 0
