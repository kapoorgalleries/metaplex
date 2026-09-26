<#
Windows admin-machine version of ssh-config-gen.sh: writes
$HOME\.ssh\config.d\trimurti from inventory.csv and includes it from
$HOME\.ssh\config, so `ssh <name>` works from PowerShell. Windows' OpenSSH
client (8.1+) honours Include. Safe to rerun; edit inventory.csv, not the
generated file.

One Host block per row that has a user and an ssh_port. Rows with a blank
ssh_port (no SSH) and the router (role=router, or this machine's default
gateway) get none. Both files are written as UTF-8 without a BOM (ssh rejects
a BOM), and the key path is quoted, so a profile folder with spaces or accents
works. The new file is checked with `ssh -G` first; if ssh rejects it, the old
file stays and this exits 1.

Usage: powershell -ExecutionPolicy Bypass -File scripts\ssh-config-gen.ps1 [-KeyFile C:\Users\me\.ssh\id_ed25519_trimurti]
  -KeyFile PATH   the admin private key (default: $env:KEY_FILE, else ~\.ssh\id_ed25519_trimurti)
  -h, --help      this text
Exit: 0 written, 1 failed, 2 bad arguments.
#>
$ErrorActionPreference = 'Stop'

function Show-Usage([int]$Code, [string]$Why) {
  $text = (((Get-Content -LiteralPath $PSCommandPath -Raw) -split '#>')[0] -replace '^\s*<#\r?\n', '').TrimEnd()
  if ($Code -eq 0) { Write-Host $text } else { [Console]::Error.WriteLine("$Why`n$text") }
  exit $Code
}
$KeyFile = $env:KEY_FILE
if (-not $KeyFile) { $KeyFile = Join-Path (Join-Path $HOME '.ssh') 'id_ed25519_trimurti' }
for ($i = 0; $i -lt $args.Count; $i++) {
  $a = "$($args[$i])"
  if ($a -match '^(-h|-help|--help|-\?|/\?)$') { Show-Usage 0 }
  elseif ($a -match '^(-KeyFile|--key-file)(?:[=:](.*))?$') {
    if ($null -ne $Matches[2]) { $KeyFile = $Matches[2] }
    elseif ($i + 1 -lt $args.Count) { $i++; $KeyFile = "$($args[$i])" }
    else { $KeyFile = '' }
    if (-not $KeyFile) { Show-Usage 2 "$a needs a path" }
  }
  else { Show-Usage 2 "unknown argument: $a" }
}
function Fail([string]$Why) { [Console]::Error.WriteLine("FAIL $Why"); exit 1 }

# inventory.csv rows, cleaned the way lib.sh does it: BOM, comments, blank lines and spaces around fields go.
function Read-Inventory([string]$Path) {
  $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object { (("$_" -replace '^\uFEFF', '').Trim()) -replace '\s*,\s*', ',' } |
             Where-Object { $_ -and $_ -notmatch '^#' })
  $h = -1
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^name,ip,mac,os,user,role,ssh_port,trimurti') { $h = $i; break } }
  if ($h -lt 0) { throw "inventory has no header row name,ip,mac,os,user,role,ssh_port,trimurti,notes: $Path" }
  if ($h -eq $lines.Count - 1) { return , @() }
  return , @($lines[$h..($lines.Count - 1)] | ConvertFrom-Csv)
}
# Why a row gets no Host block, or '' (lib.sh's ssh_skip_reason, plus what would break the file).
function Get-SkipReason($Row, [string]$Gateway) {
  $ip = "$($Row.ip)"; $user = "$($Row.user)"; $port = "$($Row.ssh_port)"
  if ("$($Row.role)" -eq 'router' -or ($Gateway -and $ip -eq $Gateway)) { return 'it is the router (role=router or this machine''s gateway); nothing here logs into it' }
  if ("$($Row.name)" -notmatch '^[A-Za-z0-9._-]+$') { return "a name may only have letters, digits, '.', '_' and '-'" }
  if (-not $port) { return 'no ssh_port set' }
  if ($port -notmatch '^\d+$') { return "ssh_port '$port' is not a number" }
  if ($port.Length -gt 5 -or [int]$port -lt 1 -or [int]$port -gt 65535) { return "ssh_port '$port' is not a port" }
  if (-not $user) { return 'no user set' }
  if ($user -match '"') { return "user '$user' has a double quote" }
  if ($ip -and $ip -notmatch '^[0-9A-Za-z.:-]+$') { return "ip '$ip' is not an address" }
  return ''
}
# The key path as ssh wants it: forward slashes, under ~/ when it is in the profile folder.
function Get-ConfigKeyPath([string]$Key, [string]$HomeDir) {
  $k = $Key -replace '\\', '/'; $h = ($HomeDir -replace '\\', '/').TrimEnd('/')
  if ($h -and $k.StartsWith("$h/", [StringComparison]::OrdinalIgnoreCase)) { $k = '~/' + $k.Substring($h.Length + 1) }
  return $k
}
# The bytes of ~/.ssh/config with the Include line on top: the rest is kept byte for byte, except a
# UTF-8 BOM (ssh rejects line 1) or UTF-16 (ssh cannot read it), which become plain UTF-8.
function Add-IncludeLine([byte[]]$Old) {
  $utf8 = New-Object Text.UTF8Encoding $false
  if ($Old.Length -ge 2 -and $Old[0] -eq 0xFF -and $Old[1] -eq 0xFE) { $Old = $utf8.GetBytes([Text.Encoding]::Unicode.GetString($Old, 2, $Old.Length - 2)) }
  elseif ($Old.Length -ge 3 -and $Old[0] -eq 0xEF -and $Old[1] -eq 0xBB -and $Old[2] -eq 0xBF) {
    $rest = New-Object byte[] ($Old.Length - 3); [Array]::Copy($Old, 3, $rest, 0, $rest.Length); $Old = $rest
  }
  if ($utf8.GetString($Old) -match '(?m)^Include config\.d/\*') { return , $Old }
  return , [byte[]]($utf8.GetBytes("Include config.d/*`n`n") + $Old)
}

$OpsDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$inventory = $env:INVENTORY; if (-not $inventory) { $inventory = Join-Path $OpsDir 'inventory.csv' }
if (-not (Test-Path -LiteralPath $inventory)) { Fail "inventory not found: $inventory" }
try { $rows = Read-Inventory $inventory } catch { Fail $_.Exception.Message }
$gw = ''
try {
  $gw = "$((Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction Stop |
            Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1).NextHop)"
} catch { }
$sshDir = Join-Path $HOME '.ssh'
$dir  = Join-Path $sshDir 'config.d'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
$cfg  = Join-Path $dir 'trimurti'
$main = Join-Path $sshDir 'config'
$key  = Get-ConfigKeyPath $KeyFile $HOME

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# generated by ops/network/scripts/ssh-config-gen.ps1 on $(Get-Date -Format yyyy-MM-dd) -- edit inventory.csv, not this file")
$names = @()
foreach ($r in $rows) {
  $name = "$($r.name)"
  if (-not $name) { continue }
  $why = Get-SkipReason $r $gw
  if ($why) { Write-Warning "${name}: no Host block, $why"; continue }
  $hostName = if ($r.ip) { "$($r.ip)" } else { $name }
  foreach ($l in '', "Host $name", "  HostName $hostName", "  User `"$($r.user)`"", "  Port $($r.ssh_port)",
                 "  IdentityFile `"$key`"", '  IdentitiesOnly yes', '  ServerAliveInterval 30', '  ServerAliveCountMax 3') { $lines.Add($l) }
  $names += $name
}
$utf8 = New-Object Text.UTF8Encoding $false
$tmp = Join-Path $dir '.trimurti.tmp'
[IO.File]::WriteAllText($tmp, (($lines -join "`n") + "`n"), $utf8)

# A bad line in an included file stops every ssh on this machine, so check before replacing.
if (Get-Command ssh -ErrorAction SilentlyContinue) {
  foreach ($n in $names) {
    $ErrorActionPreference = 'Continue'
    $err = @(& ssh -G -F $tmp $n 2>&1 | Where-Object { $_ -is [Management.Automation.ErrorRecord] } | ForEach-Object { "$_" })
    $rc = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($rc -ne 0) { Remove-Item -LiteralPath $tmp -Force; Fail "ssh rejects the generated block for $n, so $cfg was left as it was: $($err | Select-Object -First 1)" }
  }
}
Move-Item -LiteralPath $tmp -Destination $cfg -Force

$old = [byte[]]@(); if (Test-Path -LiteralPath $main) { $old = [IO.File]::ReadAllBytes($main) }
$new = Add-IncludeLine $old
if ($new.Length -ne $old.Length -or -not (Test-Path -LiteralPath $main)) { [IO.File]::WriteAllBytes($main, $new) }
Write-Host "wrote $cfg ($($names.Count) hosts); 'Include config.d/*' is in $main. Try:  ssh <name>"
