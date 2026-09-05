<#
.SYNOPSIS
    Locate a QNAP NAS on the local network and report its IP address.

.DESCRIPTION
    Runs four independent checks, cheapest first, because any one of them can
    fail on its own:

      1. Remembered SMB connections (net use) - if you ever mapped the NAS,
         its address is already recorded on this machine.
      2. The ARP cache, matched against QNAP's registered MAC prefixes.
      3. An active sweep of every local /24 for the ports a QNAP answers on
         (445 SMB, 8080 web UI, 443, 22).
      4. Reverse DNS on whatever the sweep finds, plus the default QNAP
         hostname.

    Read-only. Opens TCP connections and closes them; changes nothing.

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\find-qnap.ps1
#>

[CmdletBinding()]
param(
    [int] $TimeoutMs = 1500,
    [int] $BatchSize = 128
)

$ErrorActionPreference = 'Continue'

function Write-Section {
    param([string] $Title)
    Write-Host ''
    Write-Host "== $Title ==" -ForegroundColor Cyan
}

# QNAP Systems registered MAC prefixes.
$QnapOuis = @('24-5E-BE', '00-08-9B', '24:5E:BE', '00:08:9B')

# Ports a QNAP typically answers on. 8080 is the default QTS web UI.
$ProbePorts = @(445, 8080, 443, 22)

$candidates = @{}

function Add-Candidate {
    param([string] $Ip, [string] $Why)
    if ([string]::IsNullOrWhiteSpace($Ip)) { return }
    if (-not $candidates.ContainsKey($Ip)) { $candidates[$Ip] = New-Object System.Collections.ArrayList }
    [void]$candidates[$Ip].Add($Why)
}

# ---------------------------------------------------------------------------
# 1. Remembered SMB connections
# ---------------------------------------------------------------------------

Write-Section 'Remembered network connections'

$netUse = & net.exe use 2>&1
$sawAny = $false
foreach ($line in $netUse) {
    $text = [string]$line
    if ($text -match '\\\\([^\\\s]+)\\') {
        $server = $Matches[1]
        $sawAny = $true
        Write-Host "  $text"
        Add-Candidate $server 'previously mapped SMB connection'
    }
}
if (-not $sawAny) { Write-Host '  none recorded' -ForegroundColor DarkGray }

# ---------------------------------------------------------------------------
# 2. ARP cache, matched on QNAP MAC prefixes
# ---------------------------------------------------------------------------

Write-Section 'ARP cache (QNAP MAC prefixes)'

$arp = & arp.exe -a 2>&1
$sawAny = $false
foreach ($line in $arp) {
    $text = [string]$line
    if ($text -match '^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2})') {
        $ip     = $Matches[1]
        $prefix = $Matches[2].ToUpper()
        foreach ($oui in $QnapOuis) {
            if ($prefix -eq $oui.Substring(0, 8).ToUpper()) {
                Write-Host "  $ip  ($prefix)  <- QNAP MAC prefix" -ForegroundColor Green
                Add-Candidate $ip "QNAP MAC prefix $prefix"
                $sawAny = $true
            }
        }
    }
}
if (-not $sawAny) { Write-Host '  no QNAP MAC prefixes in cache (normal if you have not talked to it recently)' -ForegroundColor DarkGray }

# ---------------------------------------------------------------------------
# 3. Sweep local subnets
# ---------------------------------------------------------------------------

Write-Section 'Scanning local subnets'

$prefixes = New-Object System.Collections.ArrayList
try {
    $addrs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixLength -ge 24 }
    foreach ($a in $addrs) {
        $octets = $a.IPAddress.Split('.')
        $base   = "$($octets[0]).$($octets[1]).$($octets[2])"
        if (-not $prefixes.Contains($base)) {
            [void]$prefixes.Add($base)
            Write-Host "  local address $($a.IPAddress)/$($a.PrefixLength) -> scanning $base.1-254"
        }
    }
}
catch {
    Write-Host "  Get-NetIPAddress unavailable: $($_.Exception.Message)" -ForegroundColor Yellow
}

if ($prefixes.Count -eq 0) {
    Write-Host '  no usable local IPv4 subnet found' -ForegroundColor Yellow
}

$targets = New-Object System.Collections.ArrayList
foreach ($base in $prefixes) {
    for ($i = 1; $i -le 254; $i++) { [void]$targets.Add("$base.$i") }
}

$openPorts = @{}

if ($targets.Count -gt 0) {
    Write-Host "  probing $($targets.Count) address(es) on ports $($ProbePorts -join ', ')..."

    $work = New-Object System.Collections.ArrayList
    foreach ($ip in $targets) {
        foreach ($port in $ProbePorts) { [void]$work.Add(@{ Ip = $ip; Port = $port }) }
    }

    $index = 0
    while ($index -lt $work.Count) {
        $slice   = $work[$index..([Math]::Min($index + $BatchSize - 1, $work.Count - 1))]
        $pending = New-Object System.Collections.ArrayList

        foreach ($item in $slice) {
            $client = New-Object System.Net.Sockets.TcpClient
            try {
                $async = $client.BeginConnect($item.Ip, $item.Port, $null, $null)
                [void]$pending.Add([pscustomobject]@{ Ip = $item.Ip; Port = $item.Port; Client = $client; Async = $async })
            }
            catch {
                try { $client.Close() } catch { }
            }
        }

        Start-Sleep -Milliseconds $TimeoutMs

        foreach ($p in $pending) {
            if ($p.Async.IsCompleted) {
                try {
                    $p.Client.EndConnect($p.Async)
                    if (-not $openPorts.ContainsKey($p.Ip)) { $openPorts[$p.Ip] = New-Object System.Collections.ArrayList }
                    [void]$openPorts[$p.Ip].Add($p.Port)
                }
                catch { }
            }
            try { $p.Client.Close() } catch { }
        }

        $index += $BatchSize
        Write-Host "." -NoNewline
    }
    Write-Host ''
}

foreach ($ip in $openPorts.Keys) {
    $ports = $openPorts[$ip] | Sort-Object
    if ($ports -contains 445) { Add-Candidate $ip "SMB open (ports: $($ports -join ', '))" }
    elseif ($ports -contains 8080) { Add-Candidate $ip "QNAP web UI port open (ports: $($ports -join ', '))" }
}

# ---------------------------------------------------------------------------
# 4. Default hostname
# ---------------------------------------------------------------------------

Write-Section 'Default QNAP hostname'

foreach ($name in @('NAS', 'QNAP')) {
    try {
        $entry = [System.Net.Dns]::GetHostEntry($name)
        foreach ($addr in $entry.AddressList) {
            if ($addr.AddressFamily -eq 'InterNetwork') {
                Write-Host "  '$name' resolves to $($addr.IPAddressToString)" -ForegroundColor Green
                Add-Candidate $addr.IPAddressToString "resolves from default hostname '$name'"
            }
        }
    }
    catch {
        Write-Host "  '$name' does not resolve" -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

Write-Section 'Candidates'

if ($candidates.Count -eq 0) {
    Write-Host '  Nothing found.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  Next steps:' -ForegroundColor Yellow
    Write-Host '   - Confirm the NAS is powered on and its status LED is steady, not blinking.'
    Write-Host '   - Check your router admin page for its DHCP client list; the NAS will be there by name.'
    Write-Host '   - If the NAS is on a different subnet or VLAN, this scan cannot see it.'
    exit 1
}

$rows = New-Object System.Collections.ArrayList
foreach ($ip in $candidates.Keys) {
    $name = ''
    try { $name = [System.Net.Dns]::GetHostEntry($ip).HostName } catch { }

    $ports = ''
    if ($openPorts.ContainsKey($ip)) { $ports = ($openPorts[$ip] | Sort-Object) -join ', ' }

    [void]$rows.Add([pscustomobject]@{
            Address  = $ip
            Hostname = $name
            Ports    = $ports
            Evidence = ($candidates[$ip] -join '; ')
        })
}

$rows | Sort-Object Address | Format-Table -AutoSize -Wrap

Write-Host 'Most likely NAS: the address with port 445 open.' -ForegroundColor Green
Write-Host ''
Write-Host 'Then run, substituting the real address:' -ForegroundColor Cyan
Write-Host '  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qnap-preserve-files.ps1 -Nas 192.168.1.50 -ListSharesOnly'
