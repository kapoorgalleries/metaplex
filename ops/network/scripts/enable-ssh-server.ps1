<#
Turn on the OpenSSH server on this Windows 10/11 machine, open the firewall
for it (from the local subnet only), make PowerShell the login shell, and
(optionally) install the admin public key in the ONE place Windows reads it for
administrators. Run as Administrator. Idempotent.

Windows quirk this script gets right: for any user in the Administrators
group, sshd ignores %USERPROFILE%\.ssh\authorized_keys and reads
C:\ProgramData\ssh\administrators_authorized_keys instead, and that file
must be owned by Administrators and ACL'd to Administrators + SYSTEM only or
sshd refuses it. The file is rewritten as UTF-8 without a BOM, one key per line.

Firewall and network profile: the rule OpenSSH-Server-In-TCP is enabled for port 22
on the Domain and Private profiles, from the local subnet only. The interface that
carries the default route (the gallery LAN) is switched from Public to Private,
unless -KeepPublicProfile; other interfaces (VPN, hotspot) are left alone. When the
LAN stays Public, the rule covers Public too, still local subnet only.

Usage: powershell -ExecutionPolicy Bypass -File scripts\enable-ssh-server.ps1 [-PublicKey "ssh-ed25519 AAAA... comment"] [-Pwsh7] [-KeepPublicProfile]
  -PublicKey KEY       the admin public key line to install (-PublicKey=KEY works too)
  -Pwsh7               make PowerShell 7 the login shell (when it is installed)
  -KeepPublicProfile   leave the LAN's network profile as it is
  -h, --help           this text
Exit: 0 done, 1 a step failed (the last line says what), 2 bad arguments.
#>
$ErrorActionPreference = 'Stop'

function Show-Usage([int]$Code, [string]$Why) {
  $text = (((Get-Content -LiteralPath $PSCommandPath -Raw) -split '#>')[0] -replace '^\s*<#\r?\n', '').TrimEnd()
  if ($Code -eq 0) { Write-Host $text } else { [Console]::Error.WriteLine("$Why`n$text") }
  exit $Code
}
$PublicKey = ''; $Pwsh7 = $false; $KeepPublicProfile = $false
for ($i = 0; $i -lt $args.Count; $i++) {
  $a = "$($args[$i])"
  if ($a -match '^(-h|-help|--help|-\?|/\?)$') { Show-Usage 0 }
  elseif ($a -match '^(-PublicKey|--public-key)(?:[=:](.*))?$') {
    if ($null -ne $Matches[2]) { $PublicKey = $Matches[2] }
    elseif ($i + 1 -lt $args.Count) { $i++; $PublicKey = "$($args[$i])" }
    if (-not $PublicKey.Trim()) { Show-Usage 2 "$a needs a key" }
  }
  elseif ($a -match '^(-Pwsh7|--pwsh7)$') { $Pwsh7 = $true }
  elseif ($a -match '^(-KeepPublicProfile|--keep-public-profile)$') { $KeepPublicProfile = $true }
  else { Show-Usage 2 "unknown argument: $a" }
}
if ($PublicKey) {
  $PublicKey = $PublicKey.Trim()
  if ($PublicKey -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+=*( .*)?$' -or $PublicKey -match '[\r\n]') {
    Show-Usage 2 'PublicKey does not look like one OpenSSH public key line'
  }
}

$Failed = New-Object System.Collections.Generic.List[string]
function Add-Failure([string]$Name, [string]$Why) { Write-Warning $Why; $Failed.Add($Name) }
# Run a native command without letting its stderr become a PowerShell error (Windows PowerShell 5.1
# with 'Stop'). Returns the exit code; the output goes to the host unless -Quiet.
function Invoke-Native([string]$Exe, [string[]]$ArgList = @(), [switch]$Quiet) {
  $ErrorActionPreference = 'Continue'
  try {
    $out = @(& $Exe @ArgList 2>&1 | ForEach-Object { "$_" })
    if (-not $Quiet -or $LASTEXITCODE -ne 0) { $out | Out-Host }
  } catch { Write-Warning "${Exe}: $($_.Exception.Message)"; return 127 }
  return $LASTEXITCODE
}
# The lines of a file sshd may have been given in any encoding: UTF-16 (an 'echo key > file' in
# Windows PowerShell 5.1), UTF-8 with or without a BOM.
function Read-TextLines([string]$Path) {
  $b = [IO.File]::ReadAllBytes($Path)
  if ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE) { $t = [Text.Encoding]::Unicode.GetString($b, 2, $b.Length - 2) }
  elseif ($b.Length -ge 2 -and $b[0] -eq 0xFE -and $b[1] -eq 0xFF) { $t = [Text.Encoding]::BigEndianUnicode.GetString($b, 2, $b.Length - 2) }
  elseif ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $t = [Text.Encoding]::UTF8.GetString($b, 3, $b.Length - 3) }
  else { $t = [Text.Encoding]::UTF8.GetString($b) }
  return , @($t -split '\r?\n')
}
# The key lines of an authorized_keys file plus $Key, without blank lines. The same key with
# another comment counts as present.
function Merge-AuthorizedKey([string[]]$Lines, [string]$Key) {
  $keys = @($Lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
  $body = ($Key -split '\s+')[0..1] -join ' '
  if (@($keys | Where-Object { (($_ -split '\s+')[0..1] -join ' ') -eq $body }).Count -eq 0) { $keys += $Key }
  return , $keys
}
# Add the key to an authorized_keys file, rebuilt rather than appended (a last line without a newline
# would swallow the new key into its comment): UTF-8 without a BOM, one key per LF-ended line. Returns the count.
function Set-AuthorizedKey([string]$Path, [string]$Key) {
  $old = @(); if (Test-Path -LiteralPath $Path) { $old = Read-TextLines $Path }
  $keys = Merge-AuthorizedKey $old $Key
  [IO.File]::WriteAllText($Path, (($keys -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
  return $keys.Count
}
# sshd's own rule (Win32-OpenSSH): owned by Administrators or SYSTEM, nobody else may write to it.
function Test-AdminKeysAcl([string]$Path) {
  $acl = Get-Acl -LiteralPath $Path
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ('S-1-5-32-544', 'S-1-5-18' -notcontains $owner) { return "owner is $owner" }
  foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    $sid = $r.IdentityReference.Value
    if ('S-1-5-32-544', 'S-1-5-18' -notcontains $sid) { return "$sid has access ($($r.FileSystemRights))" }
  }
  return ''
}

$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  [Console]::Error.WriteLine('run this from an elevated PowerShell (Run as administrator)'); exit 1
}

try {
  foreach ($cap in 'OpenSSH.Client~~~~0.0.1.0', 'OpenSSH.Server~~~~0.0.1.0') {
    if ((Get-WindowsCapability -Online -Name $cap).State -ne 'Installed') {
      Write-Host "installing $cap"; Add-WindowsCapability -Online -Name $cap | Out-Null
    }
  }
  Set-Service -Name sshd -StartupType Automatic
  if ((Get-Service sshd).Status -ne 'Running') { Start-Service sshd }
} catch {
  [Console]::Error.WriteLine("the OpenSSH server could not be installed or started: $($_.Exception.Message)"); exit 1
}
if (Get-Service ssh-agent -ErrorAction SilentlyContinue) {
  try { Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent } catch { Write-Warning "ssh-agent not started: $($_.Exception.Message)" }
}

$shell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
if ($Pwsh7) {
  if (Test-Path 'C:\Program Files\PowerShell\7\pwsh.exe') { $shell = 'C:\Program Files\PowerShell\7\pwsh.exe' }
  else { Add-Failure 'pwsh7' 'PowerShell 7 is not installed (C:\Program Files\PowerShell\7\pwsh.exe); the login shell stays Windows PowerShell' }
}
if (-not (Test-Path 'HKLM:\SOFTWARE\OpenSSH')) { New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null }
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value $shell -PropertyType String -Force | Out-Null

if ($PublicKey) {
  $adminKeys = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
  try {
    $n = Set-AuthorizedKey $adminKeys $PublicKey
    # SIDs rather than names so this also works on non-English Windows (Administratoren, Administrateurs ...)
    $icacls = "$env:SystemRoot\System32\icacls.exe"
    foreach ($acl in @(@($adminKeys, '/reset'), @($adminKeys, '/setowner', '*S-1-5-32-544'),
                       @($adminKeys, '/inheritance:r', '/grant:r', '*S-1-5-32-544:F', '*S-1-5-18:F'))) {
      $rc = Invoke-Native $icacls $acl -Quiet
      if ($rc -ne 0) { throw "icacls $($acl -join ' ') failed ($rc)" }
    }
    $bad = Test-AdminKeysAcl $adminKeys
    if ($bad) { throw "sshd would refuse $adminKeys ($bad)" }
    Write-Host "admin key installed in $adminKeys ($n key(s); owner Administrators, access Administrators + SYSTEM only)"
  } catch { Add-Failure 'admin-key' "admin key NOT installed: $($_.Exception.Message)" }
}

# The gallery LAN: the interface with the default route (lowest metric). On Public, Windows hides the
# machine and blocks file sharing, discovery and ping (those built-in rules are Private-only).
$lan = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
       Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
$lanProfile = $null
if ($lan) { $lanProfile = Get-NetConnectionProfile -InterfaceIndex $lan.InterfaceIndex -ErrorAction SilentlyContinue }
if (-not $lanProfile) { Write-Warning 'no default route: could not tell which interface is the gallery LAN; network profiles left alone' }
elseif ("$($lanProfile.NetworkCategory)" -eq 'Public') {
  if ($KeepPublicProfile) { Write-Warning "interface '$($lanProfile.InterfaceAlias)' (the LAN) stays on the Public profile (-KeepPublicProfile)" }
  else {
    try {
      Set-NetConnectionProfile -InterfaceIndex $lan.InterfaceIndex -NetworkCategory Private
      Write-Host "interface '$($lanProfile.InterfaceAlias)' (the LAN) switched from Public to Private (pass -KeepPublicProfile to skip)"
    } catch { Add-Failure 'network-profile' "could not switch '$($lanProfile.InterfaceAlias)' to Private (a policy may lock it): $($_.Exception.Message)" }
  }
}
$lanPublic = $lan -and "$((Get-NetConnectionProfile -InterfaceIndex $lan.InterfaceIndex -ErrorAction SilentlyContinue).NetworkCategory)" -eq 'Public'

# Microsoft's install normally creates this rule; make sure it is on, on port 22, and LAN-only.
try {
  $profiles = @('Domain', 'Private'); if ($lanPublic) { $profiles += 'Public' }
  $rule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
  if (-not $rule) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Direction Inbound -Protocol TCP -Action Allow `
      -LocalPort 22 -Enabled True -Profile ($profiles -join ',') -RemoteAddress LocalSubnet | Out-Null
  } else {
    Set-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -Enabled True -Direction Inbound -Action Allow -Profile ($profiles -join ',') `
      -Protocol TCP -LocalPort 22 -RemoteAddress LocalSubnet
  }
  $rule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP'
  $port = $rule | Get-NetFirewallPortFilter
  $addr = $rule | Get-NetFirewallAddressFilter
  Write-Host "firewall: OpenSSH-Server-In-TCP enabled=$($rule.Enabled) profile=$($rule.Profile) port=$($port.LocalPort) from=$($addr.RemoteAddress)"
  if ($lanPublic) { Write-Warning 'the LAN is on the Public profile, so the SSH rule covers Public too (local subnet only)' }
} catch { Add-Failure 'firewall' "the firewall rule for sshd could not be set: $($_.Exception.Message)" }

try { Restart-Service sshd } catch { Add-Failure 'sshd' "sshd did not restart: $($_.Exception.Message)" }
$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress -join ', '
Write-Host "sshd: $((Get-Service sshd).Status)   login shell: $shell"
Write-Host "Add this row to inventory.csv:  name=$env:COMPUTERNAME  ip=$ips  user=$env:USERNAME  os=windows  ssh_port=22"
if ($Failed.Count) { Write-Host "ENABLE-SSH INCOMPLETE on ${env:COMPUTERNAME}, failed: $($Failed -join ' ')"; exit 1 }
Write-Host "ENABLE-SSH OK on ${env:COMPUTERNAME}"
exit 0
