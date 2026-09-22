<#
LAN discovery from a Windows machine that is on the network. Read-only.
Pings the subnet, reads the neighbour table, resolves names, probes a few
TCP ports and checks for double NAT. Works on Windows PowerShell 5.1 and 7.

Usage:  powershell -ExecutionPolicy Bypass -File scripts\netscan.ps1 [-Subnet 192.168.1]
Output: out\scan-<timestamp>.csv
#>
param([string]$Subnet)
$ErrorActionPreference = 'Continue'

$OpsDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$OutDir = Join-Path $OpsDir 'out'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Csv = Join-Path $OutDir ("scan-{0}.csv" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

# ---------------------------------------------------------------- 1. where am I
$route   = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
           Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1
if (-not $route) { Write-Error 'no default route: this machine is not on a network'; exit 1 }
$gw      = $route.NextHop
$ifIndex = $route.InterfaceIndex
$ipInfo  = Get-NetIPAddress -InterfaceIndex $ifIndex -AddressFamily IPv4 | Select-Object -First 1
$myIp    = $ipInfo.IPAddress
$prefix  = $ipInfo.PrefixLength
$adapter = Get-NetAdapter -InterfaceIndex $ifIndex
$dns     = (Get-DnsClientServerAddress -InterfaceIndex $ifIndex -AddressFamily IPv4).ServerAddresses -join ' '
$profile = (Get-NetConnectionProfile -InterfaceIndex $ifIndex -ErrorAction SilentlyContinue).NetworkCategory
if (-not $Subnet) { $Subnet = ($myIp -split '\.')[0..2] -join '.' }

Write-Host "adapter=$($adapter.Name)  link=$($adapter.LinkSpeed)  ip=$myIp/$prefix  gateway=$gw  profile=$profile"
Write-Host "dns servers: $dns"
if ($adapter.LinkSpeed -match '^100 Mbps') { Write-Warning "link is 100 Mbps: bad cable or a 100 Mb switch port. Gigabit expected." }
if ($prefix -ne 24) { Write-Warning "prefix is /$prefix, not /24. The network may be split; pass -Subnet if the sweep looks wrong." }
if ($profile -and $profile -ne 'Private' -and $profile -ne 'DomainAuthenticated') {
  Write-Warning "network profile is '$profile'. Windows blocks inbound ping, SSH and SMB on Public."
  Write-Warning "fix (admin): Set-NetConnectionProfile -InterfaceIndex $ifIndex -NetworkCategory Private"
}

# ---------------------------------------------------------------- 2. double NAT
function Test-Private([string]$ip) {
  $o = $ip -split '\.'
  if ($o.Count -ne 4) { return $false }
  return ($o[0] -eq '10') -or ($o[0] -eq '192' -and $o[1] -eq '168') -or
         ($o[0] -eq '172' -and [int]$o[1] -ge 16 -and [int]$o[1] -le 31) -or
         ($o[0] -eq '100' -and [int]$o[1] -ge 64 -and [int]$o[1] -le 127)
}
$hops = @(tracert -d -h 3 -w 1000 1.1.1.1 2>$null | ForEach-Object {
  if ($_ -match '^\s*\d+\s.*?(\d+\.\d+\.\d+\.\d+)\s*$') { $matches[1] }
})
$priv = @($hops | Where-Object { Test-Private $_ }).Count
if ($priv -ge 2) { Write-Warning "DOUBLE NAT: the first $priv hops are private ($($hops -join ' ')). See checklists\network-triage.md, 'Double NAT'." }
else { Write-Host "single NAT (first hops: $($hops -join ' '))" }

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

$neigh = @{}
Get-NetNeighbor -AddressFamily IPv4 -InterfaceIndex $ifIndex -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -like "$Subnet.*" -and $_.State -ne 'Unreachable' -and
                 $_.LinkLayerAddress -and $_.LinkLayerAddress -notmatch '^(00-00-00-00-00-00|FF-FF-FF-FF-FF-FF)$' } |
  ForEach-Object { $neigh[$_.IPAddress] = $_.LinkLayerAddress.ToLower().Replace('-', ':') }
$neigh[$myIp] = $adapter.MacAddress.ToLower().Replace('-', ':')
foreach ($ip in $alive) { if (-not $neigh.ContainsKey($ip)) { $neigh[$ip] = '' } }

# ---------------------------------------------------------------- 4. per host
function Test-Port([string]$ip, [int]$port, [int]$ms = 700) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $r = $c.BeginConnect($ip, $port, $null, $null)
    if ($r.AsyncWaitHandle.WaitOne($ms) -and $c.Connected) { return 'y' } else { return '' }
  } catch { return '' } finally { $c.Close() }
}
$rows = foreach ($ip in ($neigh.Keys | Sort-Object { [int]($_ -split '\.')[3] })) {
  $name = try { [System.Net.Dns]::GetHostEntry($ip).HostName } catch { '' }
  $p = @{}
  foreach ($port in 22, 445, 80, 443, 5000, 8080) { $p[$port] = Test-Port $ip $port }
  $hint = @()
  if ($ip -eq $gw)   { $hint += 'gateway/router' }
  if ($ip -eq $myIp) { $hint += 'this machine' }
  if ($p[5000])      { $hint += 'Synology DSM?' }
  if ($p[8080] -and $p[445]) { $hint += 'QNAP?' }
  if ($p[445] -and $hint.Count -eq 0) { $hint += 'SMB host (PC or NAS)' }
  if ($p[22])        { $hint += 'ssh open' }
  if ($hint.Count -eq 0 -and $p[80]) { $hint += 'web only (printer/IoT/AP?)' }
  [pscustomobject]@{
    ip = $ip; mac = $neigh[$ip]; hostname = $name
    ssh22 = $p[22]; smb445 = $p[445]; http80 = $p[80]; https443 = $p[443]; dsm5000 = $p[5000]; qnap8080 = $p[8080]
    hint = ($hint -join '; ')
  }
}

# ---------------------------------------------------------------- 5. report
$rows | Export-Csv -NoTypeInformation -Path $Csv
Write-Host "$($rows.Count) hosts answered. Table (y = port open):"
$rows | Format-Table -AutoSize | Out-String -Width 220 | Write-Host
Write-Host "saved: $Csv"
Write-Host "next: copy the real machines into inventory.csv, then set a DHCP reservation on the router for each one."
