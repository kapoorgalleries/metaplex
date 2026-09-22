<#
Turn on the OpenSSH server on this Windows 10/11 machine, open the firewall
for it, make PowerShell the login shell, and (optionally) install the admin
public key in the ONE place Windows reads it for administrators. Run as
Administrator. Idempotent.

Windows quirk this script gets right: for any user in the Administrators
group, sshd ignores %USERPROFILE%\.ssh\authorized_keys and reads
C:\ProgramData\ssh\administrators_authorized_keys instead, and that file
must be ACL'd to Administrators + SYSTEM only or sshd refuses it.

Usage: powershell -ExecutionPolicy Bypass -File scripts\enable-ssh-server.ps1 [-PublicKey "ssh-ed25519 AAAA... comment"] [-Pwsh7] [-KeepPublicProfile]
#>
param([string]$PublicKey, [switch]$Pwsh7, [switch]$KeepPublicProfile)
$ErrorActionPreference = 'Stop'

$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'run this from an elevated PowerShell (Run as administrator)' }

foreach ($cap in 'OpenSSH.Client~~~~0.0.1.0', 'OpenSSH.Server~~~~0.0.1.0') {
  if ((Get-WindowsCapability -Online -Name $cap).State -ne 'Installed') {
    Write-Host "installing $cap"; Add-WindowsCapability -Online -Name $cap | Out-Null
  }
}
Set-Service -Name sshd -StartupType Automatic
if ((Get-Service sshd).Status -ne 'Running') { Start-Service sshd }
if (Get-Service ssh-agent -ErrorAction SilentlyContinue) {
  Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent -ErrorAction SilentlyContinue
}

if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True `
    -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}
# The SSH rule above applies to every profile, but on a Public profile Windows hides the machine and blocks
# file sharing, discovery and ping (those built-in rules are Private-only). The rest of the kit needs Private.
if (-not $KeepPublicProfile) {
  Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' } | ForEach-Object {
    Write-Warning "interface '$($_.InterfaceAlias)' was on the Public profile; switching it to Private (pass -KeepPublicProfile to skip)"
    Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private
  }
}

$shell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
if ($Pwsh7 -and (Test-Path 'C:\Program Files\PowerShell\7\pwsh.exe')) { $shell = 'C:\Program Files\PowerShell\7\pwsh.exe' }
if (-not (Test-Path 'HKLM:\SOFTWARE\OpenSSH')) { New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null }
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value $shell -PropertyType String -Force | Out-Null

if ($PublicKey) {
  $PublicKey = $PublicKey.Trim()
  if ($PublicKey -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|sk-ssh-ed25519@openssh\.com) ') { throw 'PublicKey does not look like an OpenSSH public key line' }
  $adminKeys = 'C:\ProgramData\ssh\administrators_authorized_keys'
  if (-not (Test-Path $adminKeys)) { New-Item -ItemType File -Path $adminKeys -Force | Out-Null }
  if (-not (Select-String -Path $adminKeys -SimpleMatch -Pattern $PublicKey -Quiet)) { Add-Content -Path $adminKeys -Value $PublicKey }
  & icacls.exe $adminKeys /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
  Write-Host "admin key installed in $adminKeys"
}

Restart-Service sshd
$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress -join ', '
Write-Host "sshd: $((Get-Service sshd).Status)   login shell: $shell"
Write-Host "Add this row to inventory.csv:  name=$env:COMPUTERNAME  ip=$ips  user=$env:USERNAME  os=windows"
