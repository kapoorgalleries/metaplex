<#
LAN discovery from a Windows machine that is on the network. Read-only.
Pings the subnet, reads the neighbour table, resolves names, probes a few
TCP ports and checks for double NAT. Works on Windows PowerShell 5.1 and 7.
The router (this machine's default gateway, or a role=router row in the
inventory) is pinged but never port-probed. All port probes and name lookups
run at once, so the sweep takes about 5-10 s plus the trace route.

Usage:  powershell -ExecutionPolicy Bypass -File scripts\netscan.ps1 [-Subnet 192.168.1]
  -Subnet X.Y.Z   the first three octets to sweep (default: this machine's own); a bare X.Y.Z works too
  -h, --help      this text
Output: out\scan-<timestamp>.csv (ip,mac,hostname,ssh22,smb445,http80,https443,dsm5000,qnap8080,hint).
A row whose hint says 'stale ARP' is only in the neighbour cache: it answered neither ping nor a port.
Exit: 0 scanned, 1 failed, 2 bad arguments.
#>
$ErrorActionPreference = 'Continue'
# Warnings as plain 'WARN ...' lines, the same on every Windows language (the MCP scan tool reads them).
function Warn([string]$m) { Write-Host "WARN $m" -ForegroundColor Yellow }

function Show-Usage([int]$Code, [string]$Why) {
  $text = (((Get-Content -LiteralPath $PSCommandPath -Raw) -split '#>')[0] -replace '^\s*<#\r?\n', '').TrimEnd()
  if ($Code -eq 0) { Write-Host $text } else { [Console]::Error.WriteLine("$Why`n$text") }
  exit $Code
}
$Subnet = ''
for ($i = 0; $i -lt $args.Count; $i++) {
  $a = "$($args[$i])"
  if ($a -match '^(-h|-help|--help|-\?|/\?)$') { Show-Usage 0 }
  elseif ($a -match '^(-Subnet|--subnet)(?:[=:](.*))?$') {
    if ($null -ne $Matches[2]) { $Subnet = $Matches[2] }
    elseif ($i + 1 -lt $args.Count) { $i++; $Subnet = "$($args[$i])" }
    else { Show-Usage 2 "$a needs a value" }
  }
  elseif ($a -notmatch '^-' -and -not $Subnet) { $Subnet = $a }
  else { Show-Usage 2 "unknown argument: $a" }
}
if ($Subnet -and $Subnet -notmatch '^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){2}$') {
  Show-Usage 2 "Subnet is the first three octets, e.g. 192.168.1, not '$Subnet'"
}

$OpsDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$OutDir = if ($env:OUT_DIR) { $env:OUT_DIR } else { Join-Path $OpsDir 'out' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Csv = Join-Path $OutDir ("scan-{0}.csv" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

# ---------------------------------------------------------------- 1. where am I
$route   = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
           Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1
if (-not $route) { [Console]::Error.WriteLine('no default route: this machine is not on a network'); exit 1 }
$gw      = $route.NextHop
$ifIndex = $route.InterfaceIndex
$ipInfo  = Get-NetIPAddress -InterfaceIndex $ifIndex -AddressFamily IPv4 | Select-Object -First 1
$myIp    = $ipInfo.IPAddress
$prefix  = $ipInfo.PrefixLength
$adapter = Get-NetAdapter -InterfaceIndex $ifIndex
$dns     = (Get-DnsClientServerAddress -InterfaceIndex $ifIndex -AddressFamily IPv4).ServerAddresses -join ' '
$netCat  = (Get-NetConnectionProfile -InterfaceIndex $ifIndex -ErrorAction SilentlyContinue).NetworkCategory
if (-not $Subnet) { $Subnet = ($myIp -split '\.')[0..2] -join '.' }

Write-Host "adapter=$($adapter.Name)  link=$($adapter.LinkSpeed)  ip=$myIp/$prefix  gateway=$gw  profile=$netCat"
Write-Host "dns servers: $dns"
if ($adapter.LinkSpeed -match '^100 Mbps') { Warn "link is 100 Mbps: bad cable or a 100 Mb switch port. Gigabit expected." }
if ($prefix -ne 24) { Warn "prefix is /$prefix, not /24. The network may be split; pass -Subnet if the sweep looks wrong." }
if ($netCat -and "$netCat" -ne 'Private' -and "$netCat" -ne 'DomainAuthenticated') {
  Warn "network profile is '$netCat'. On Public, Windows hides this machine and blocks file sharing, discovery and ping; the kit's SSH rule then only works if it includes Public (enable-ssh-server.ps1 moves this LAN to Private)."
  Warn "fix (admin): Set-NetConnectionProfile -InterfaceIndex $ifIndex -NetworkCategory Private"
}

# ---------------------------------------------------------------- 2. double NAT
function Test-Rfc1918([string]$ip) {   # 10/8, 172.16/12, 192.168/16: a LAN behind a NAT box
  $o = $ip -split '\.'
  if ($o.Count -ne 4) { return $false }
  return ($o[0] -eq '10') -or ($o[0] -eq '192' -and $o[1] -eq '168') -or
         ($o[0] -eq '172' -and [int]$o[1] -ge 16 -and [int]$o[1] -le 31)
}
function Test-Cgnat([string]$ip) {     # 100.64/10 (RFC 6598): the ISP's carrier-grade NAT
  $o = $ip -split '\.'
  return ($o.Count -eq 4) -and ($o[0] -eq '100' -and [int]$o[1] -ge 64 -and [int]$o[1] -le 127)
}
# The verdicts for the first hops ('*' = no answer), as warning texts; none means single NAT.
# Private hops in a row from hop 1 (the router): two means the router's upstream is private too,
# a second NAT box or an ISP that numbers its own network privately. CGNAT is reported on its own.
function Get-NatVerdict([string[]]$Hops) {
  $shown = $Hops -join ' '
  $answered = @($Hops | Where-Object { $_ -ne '*' })
  if (-not $answered.Count) { return , @("double-NAT check inconclusive: no hop towards 1.1.1.1 answered ($shown)") }
  $out = @(); $priv = 0; $run = $true; $hop2 = ''
  foreach ($h in $answered) {
    if ($run -and (Test-Rfc1918 $h)) { $priv++; if ($priv -eq 2) { $hop2 = $h } } else { $run = $false }
  }
  $confirm = "Confirm on the router's status page: a WAN IP in 10/8, 172.16/12 or 192.168/16 proves double NAT; a public WAN IP means single NAT. See checklists\network-triage.md, 'Double NAT'."
  if ($priv -ge 2) {
    if ($hop2 -like '192.168.*') { $out += "DOUBLE NAT likely: the router's upstream hop $hop2 is a home-router address ($shown), so a second NAT box (the ISP modem in router mode) sits between this LAN and the internet. $confirm" }
    else { $out += "possible double NAT: the router's upstream hop $hop2 is private ($shown). That is either a second NAT box or an ISP that uses private addresses inside its own network. $confirm" }
  }
  if (@($answered | Where-Object { Test-Cgnat $_ }).Count) {
    $out += "ISP CGNAT: a hop is in 100.64.0.0/10 ($shown). That is the carrier's NAT, not a box on this LAN. Inbound port forwards and some VPNs will not work, and only the ISP can change it (ask for a public IP). Nothing to fix on the router."
  }
  return , $out
}
$hops = @(tracert -d -h 4 -w 1000 1.1.1.1 2>$null | ForEach-Object {
  if ($_ -match '^\s*\d+\s.*?(\d+\.\d+\.\d+\.\d+)\s*$') { $matches[1] } elseif ($_ -match '^\s*\d+\s') { '*' }
})
$verdicts = Get-NatVerdict $hops
foreach ($v in $verdicts) { Warn $v }
if (-not $verdicts.Count) { Write-Host "single NAT (first hops: $($hops -join ' '))" }

# ---------------------------------------------------------------- 3. sweep
Write-Host "pinging $Subnet.1-254 in parallel (about 3 s) ..."
$tasks = @{}
1..254 | ForEach-Object {
  $ip = "$Subnet.$_"
  $tasks[$ip] = (New-Object System.Net.NetworkInformation.Ping).SendPingAsync($ip, 800)
}
foreach ($t in $tasks.Values) { try { $null = $t.Wait(2500) } catch { } }
$alive = @($tasks.GetEnumerator() | Where-Object {
  $_.Value.Status -eq 'RanToCompletion' -and $_.Value.Result.Status -eq 'Success' } | ForEach-Object { $_.Key })

# Every neighbour with a MAC, and how fresh the entry is (Stale = not confirmed lately).
$neigh = @{}; $state = @{}
Get-NetNeighbor -AddressFamily IPv4 -InterfaceIndex $ifIndex -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -like "$Subnet.*" -and "$($_.State)" -ne 'Unreachable' -and "$($_.State)" -ne 'Incomplete' -and
                 $_.LinkLayerAddress -and $_.LinkLayerAddress -notmatch '^(00-00-00-00-00-00|FF-FF-FF-FF-FF-FF)$' } |
  ForEach-Object { $neigh[$_.IPAddress] = $_.LinkLayerAddress.ToLower().Replace('-', ':'); $state[$_.IPAddress] = "$($_.State)" }
$neigh[$myIp] = $adapter.MacAddress.ToLower().Replace('-', ':')
foreach ($ip in $alive) { if (-not $neigh.ContainsKey($ip)) { $neigh[$ip] = '' } }
foreach ($ip in @($neigh.Keys)) { if ($ip -match '\.(0|255)$') { $neigh.Remove($ip) } }

# The router is never port-probed: the gateway, plus any role=router row in the inventory.
$routers = @($gw)
$inventory = if ($env:INVENTORY) { $env:INVENTORY } else { Join-Path $OpsDir 'inventory.csv' }
if (Test-Path -LiteralPath $inventory) {
  Get-Content -LiteralPath $inventory -Encoding UTF8 | ForEach-Object { ("$_".Trim()) -replace '\s*,\s*', ',' } | ForEach-Object {
    $f = $_ -split ','
    if ($f.Count -ge 6 -and $f[5] -eq 'router' -and $f[1] -match '^\d+\.\d+\.\d+\.\d+$') { $routers += $f[1] }
  }
}

# ---------------------------------------------------------------- 4. per host, all at once
$Ports = 22, 445, 80, 443, 5000, 8080
$targets = @($neigh.Keys | Sort-Object { [int]($_ -split '\.')[3] })
$names = @{}
foreach ($ip in $targets) { try { $names[$ip] = [System.Net.Dns]::GetHostEntryAsync($ip) } catch { } }
$probes = @()
foreach ($ip in $targets) {
  if ($routers -contains $ip) { continue }
  foreach ($port in $Ports) {
    $c = New-Object System.Net.Sockets.TcpClient
    $t = $null
    try { $t = $c.ConnectAsync([Net.IPAddress]::Parse($ip), $port) } catch { }
    $probes += [pscustomobject]@{ ip = $ip; port = $port; client = $c; task = $t }
  }
}
$wait = @($probes | Where-Object { $_.task } | ForEach-Object { $_.task })
if ($wait.Count) { try { $null = [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]$wait, 1000) } catch { } }
$open = @{}
foreach ($p in $probes) {
  if ($p.task -and $p.task.Status -eq 'RanToCompletion' -and $p.client.Connected) { $open["$($p.ip):$($p.port)"] = 'y' }
  $p.client.Close()
}
$pending = @($names.Values)
if ($pending.Count) { try { $null = [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]$pending, 2000) } catch { } }

$rows = foreach ($ip in $targets) {
  $name = ''
  $n = $names[$ip]
  if ($n -and $n.Status -eq 'RanToCompletion' -and $n.Result.HostName -ne $ip) { $name = $n.Result.HostName }
  $p = @{}
  foreach ($port in $Ports) { $p[$port] = "$($open["${ip}:$port"])" }
  $hint = @()
  if ($routers -contains $ip) {
    if ($ip -eq $gw) { $hint += 'gateway/router: not probed; never log in' } else { $hint += 'router (inventory role=router): not probed; never log in' }
  } else {
    if ($ip -eq $myIp) { $hint += 'this machine' }
    if ($p[5000])      { $hint += 'Synology DSM?' }
    if ($p[8080] -and $p[445]) { $hint += 'QNAP?' }
    if ($p[445] -and $hint.Count -eq 0) { $hint += 'SMB host (PC or NAS)' }
    if ($p[22])        { $hint += 'ssh open' }
    if ($hint.Count -eq 0 -and $p[80]) { $hint += 'web only (printer/IoT/AP?)' }
    $answered = ($alive -contains $ip) -or ($ip -eq $myIp) -or @($Ports | Where-Object { $p[$_] }).Count
    if (-not $answered -and 'Reachable', 'Permanent' -notcontains $state[$ip]) { $hint += "stale ARP (not answering; neighbour state $($state[$ip]))" }
  }
  [pscustomobject]@{
    ip = $ip; mac = $neigh[$ip]; hostname = $name
    ssh22 = $p[22]; smb445 = $p[445]; http80 = $p[80]; https443 = $p[443]; dsm5000 = $p[5000]; qnap8080 = $p[8080]
    hint = ($hint -join '; ')
  }
}
$rows = @($rows)

# ---------------------------------------------------------------- 5. report
$rows | Export-Csv -NoTypeInformation -Path $Csv
$stale = @($rows | Where-Object { $_.hint -like '*stale ARP*' }).Count
$more = ''; if ($stale) { $more = " ($stale more only in the neighbour cache, marked 'stale ARP')" }
Write-Host "$($rows.Count - $stale) hosts answered$more. Table (y = port open):"
$rows | Format-Table -AutoSize | Out-String -Width 220 | Write-Host
Write-Host "saved: $Csv"
Write-Host "next: copy the real machines into inventory.csv (name,ip,mac,os,user,role,ssh_port,trimurti,notes),"
Write-Host "      the router as role=router with a blank ssh_port,"
Write-Host "      then set a DHCP reservation on the router for each one (checklists\router-tuning.md, DHCP)."
exit 0
