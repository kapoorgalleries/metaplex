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
$reboot = $false

if (-not $NoOS) {
  if (Have 'winget') {
    Log 'winget upgrade --all'
    & winget upgrade --all --silent --include-unknown --accept-source-agreements --accept-package-agreements | Out-Host
  } else { Write-Warning 'winget missing (install App Installer from the Store); skipping app upgrades' }

  Log 'Windows Update (PSWindowsUpdate module)'
  try {
    if (-not (Get-Module -ListAvailable -Name PSWindowsUpdate)) {
      Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force | Out-Null
      Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
      Install-Module -Name PSWindowsUpdate -Force -Scope AllUsers
    }
    Import-Module PSWindowsUpdate
    Get-WindowsUpdate -AcceptAll -Install -IgnoreReboot | Out-Host
    $reboot = [bool](Get-WURebootStatus -Silent)
  } catch {
    Write-Warning "PSWindowsUpdate failed: $($_.Exception.Message). Use Settings > Windows Update on this machine instead."
  }
}

if (-not $NoCLIs) {
  if (Have 'claude') { Log 'Claude Code'; try { & claude update | Out-Host } catch { } }
  if (Have 'winget') { & winget upgrade --id Anthropic.ClaudeCode --silent --accept-source-agreements --accept-package-agreements *> $null }
  if (Have 'npm') {
    foreach ($p in '@openai/codex', '@google/gemini-cli') {
      & npm ls -g --depth=0 $p *> $null
      if ($LASTEXITCODE -eq 0) { Log $p; & npm install -g --no-fund --no-audit "$p@latest" | Out-Host }
    }
  }
}

# Other reboot signals Windows leaves behind
if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') { $reboot = $true }
if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') { $reboot = $true }

Log "versions on ${env:COMPUTERNAME}:"
foreach ($c in 'claude', 'codex', 'gemini', 'node') {
  if (Have $c) { $v = (& $c --version 2>&1 | Select-Object -First 1) } else { $v = 'missing' }
  Write-Host ("  {0,-7} {1}" -f $c, $v)
}
Write-Host ("REBOOT_REQUIRED={0}" -f $(if ($reboot) { 'yes' } else { 'no' }))
if ($reboot) { Write-Host '  -> reboot this machine when convenient (nothing here reboots for you)' }
exit 0
