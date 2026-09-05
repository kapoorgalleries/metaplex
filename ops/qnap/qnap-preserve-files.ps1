#Requires -Version 5.1
<#
.SYNOPSIS
    Preserve (pull off) every file from a QNAP NAS to local storage before any
    destructive troubleshooting, with safe, verifiable resume.

.DESCRIPTION
    Built for the case where the NAS is flaky or intermittently unreachable and
    you need a complete, trustworthy local copy BEFORE you touch firmware, RAID,
    or a factory reset.

    Design decisions that matter:

    * Runs on Windows PowerShell 5.1. No PowerShell 7 / pwsh required.
    * Copies with robocopy in restartable mode (/Z), which survives dropped SMB
      sessions mid-file.
    * NEVER mirrors. /E only. Nothing on the destination is ever deleted.
    * Resume is verified, not assumed. A share is only marked complete after a
      robocopy list-only pass proves zero files remain outstanding. A crashed or
      half-finished pass can therefore never cause a file to be silently skipped.
    * UNC paths only. Mapped drive letters are resolved to UNC up front, because
      an elevated session does not inherit the drive mappings of the normal user
      and the script would otherwise report a healthy share as missing.
    * /FFT and /DST are on by default. NAS filesystems report timestamps at
      coarser granularity than NTFS; without these robocopy re-copies unchanged
      files forever and resume never converges.

.PARAMETER Nas
    Hostname or IP of the NAS, e.g. 192.168.1.50 or QNAP-TS453. Stored in the
    state file on first run so later -Resume calls need no arguments.

.PARAMETER Share
    One or more share names to preserve. If omitted the script probes for shares
    it can reach and asks you to confirm the list.

.PARAMETER Destination
    Local (or external-drive) folder that will receive the copy. One subfolder is
    created per share. Stored in state on first run.

.PARAMETER Credential
    NAS credentials. If omitted the script first tries your current Windows
    credentials, then prompts.

.PARAMETER Resume
    Continue a previous run from its state file. Shares already proven complete
    are skipped; everything else is retried.

.PARAMETER Recheck
    With -Resume, re-verify shares already marked complete instead of skipping
    them. Slower, but this is the paranoid option before you wipe the NAS.

.PARAMETER Force
    Discard existing state and start a fresh run. Does not delete copied data.

.PARAMETER DryRun
    List what would be copied without copying anything (robocopy /L).

.PARAMETER Threads
    Use robocopy multi-threading (/MT:N) instead of restartable mode (/Z).
    Much faster on many small files, but loses mid-file restart. Only use this
    if the link has proven stable.

.PARAMETER DeepVerify
    After copying, compare recursive file counts and total bytes between source
    and destination, in addition to the standard robocopy residual check.

.PARAMETER Hash
    Full SHA-256 comparison of every copied file. Authoritative and very slow.
    Reserve for the final pass on irreplaceable data.

.PARAMETER IncludeSystemFolders
    Include QNAP internal folders (@Recycle, .@__thumb, @Recently-Snapshot,
    @Transcode, .streams). Excluded by default as they are regenerable junk.

.PARAMETER WithAcls
    Also copy security descriptors (/COPY:DATSOU). Off by default: NAS-to-NTFS
    ACL copies commonly fail and produce spurious errors that mask real ones.

.EXAMPLE
    .\qnap-preserve-files.ps1 -Nas 192.168.1.50 -Destination E:\QNAP-Rescue

.EXAMPLE
    .\qnap-preserve-files.ps1 -Resume

.EXAMPLE
    .\qnap-preserve-files.ps1 -Resume -Recheck -DeepVerify
#>

[CmdletBinding()]
param(
    [string]   $Nas,
    [string[]] $Share,
    [string]   $Destination,
    [System.Management.Automation.PSCredential] $Credential,
    [switch]   $Resume,
    [switch]   $Recheck,
    [switch]   $Force,
    [switch]   $DryRun,
    [int]      $Threads = 0,
    [switch]   $DeepVerify,
    [switch]   $Hash,
    [switch]   $IncludeSystemFolders,
    [switch]   $WithAcls,
    [int]      $RetryCount = 3,
    [int]      $RetryWaitSeconds = 10,
    [int]      $MaxPasses = 5,
    [string]   $StateFile,
    [switch]   $ListSharesOnly
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

if ($PSScriptRoot) { $ScriptDir = $PSScriptRoot }
else { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition }

$WorkDir = Join-Path $ScriptDir '.qnap-preserve'
if (-not (Test-Path -LiteralPath $WorkDir)) {
    New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
}

if (-not $StateFile) { $StateFile = Join-Path $WorkDir 'state.json' }

$RunStamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$LogDir   = Join-Path $WorkDir 'logs'
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$RunLog = Join-Path $LogDir ("run-$RunStamp.log")

# QNAP internal folders that are regenerable and usually huge.
$QnapSystemFolders = @('@Recycle', '.@__thumb', '@Recently-Snapshot', '@Transcode', '.streams', '@Thumbnail')

# Share names QNAP creates out of the box; used only for probing when the user
# did not name shares explicitly and share enumeration is blocked.
$CommonQnapShares = @(
    'Public', 'Multimedia', 'Download', 'Web', 'homes', 'home', 'Recordings',
    'Backup', 'Photo', 'Music', 'Video', 'Documents', 'Archive', 'Media',
    'Qsync', 'Container', 'USBDisk1', 'DataVol1'
)

$script:MappedSessions = New-Object System.Collections.ArrayList

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

function Write-Log {
    param(
        [Parameter(Mandatory = $true)][string] $Message,
        [ValidateSet('INFO', 'WARN', 'ERROR', 'OK', 'STEP')][string] $Level = 'INFO'
    )
    $ts   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $line = "[$ts] [$Level] $Message"

    try { Add-Content -LiteralPath $RunLog -Value $line -Encoding UTF8 } catch { }

    switch ($Level) {
        'ERROR' { Write-Host $line -ForegroundColor Red }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'OK'    { Write-Host $line -ForegroundColor Green }
        'STEP'  { Write-Host ''; Write-Host $line -ForegroundColor Cyan }
        default { Write-Host $line }
    }
}

function Format-Bytes {
    param([double] $Bytes)
    if ($Bytes -ge 1TB) { return ('{0:N2} TB' -f ($Bytes / 1TB)) }
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N2} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N2} KB' -f ($Bytes / 1KB)) }
    return ('{0:N0} B' -f $Bytes)
}

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

function ConvertTo-Hashtable {
    # ConvertFrom-Json returns PSCustomObject on 5.1 (no -AsHashtable). Normalise
    # so downstream code is version-agnostic.
    param($InputObject)

    if ($null -eq $InputObject) { return $null }

    if ($InputObject -is [System.Collections.IDictionary]) {
        $out = @{}
        foreach ($k in $InputObject.Keys) { $out[[string]$k] = ConvertTo-Hashtable $InputObject[$k] }
        return $out
    }

    if ($InputObject -is [System.Management.Automation.PSCustomObject]) {
        $out = @{}
        foreach ($p in $InputObject.PSObject.Properties) { $out[$p.Name] = ConvertTo-Hashtable $p.Value }
        return $out
    }

    if ($InputObject -is [string]) { return $InputObject }

    if ($InputObject -is [System.Collections.IEnumerable]) {
        $list = New-Object System.Collections.ArrayList
        foreach ($item in $InputObject) { [void]$list.Add((ConvertTo-Hashtable $item)) }
        return , $list.ToArray()
    }

    return $InputObject
}

function New-State {
    return @{
        version     = 1
        createdUtc  = (Get-Date).ToUniversalTime().ToString('o')
        nas         = ''
        destination = ''
        shares      = @{}
    }
}

function Read-State {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
        return ConvertTo-Hashtable (ConvertFrom-Json $raw)
    }
    catch {
        Write-Log "State file at $Path is unreadable ($($_.Exception.Message)). Treating as absent." 'WARN'
        return $null
    }
}

function Write-State {
    param([hashtable] $State, [string] $Path)
    $State['updatedUtc'] = (Get-Date).ToUniversalTime().ToString('o')
    $tmp = "$Path.tmp"
    # Write to a temp file then move, so a crash mid-write cannot corrupt state.
    ($State | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $tmp -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

# ---------------------------------------------------------------------------
# Connectivity and access
# ---------------------------------------------------------------------------

function Test-TcpPort {
    param([string] $ComputerName, [int] $Port, [int] $TimeoutMs = 4000)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($ComputerName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
        $client.EndConnect($async)
        return $true
    }
    catch { return $false }
    finally { try { $client.Close() } catch { } }
}

function Resolve-ToUnc {
    # An elevated session does not see drive mappings made by the interactive
    # user, so any Z:\-style path is converted to its UNC form here.
    param([string] $Path)

    if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
    if ($Path.StartsWith('\\')) { return $Path }
    if ($Path -notmatch '^[A-Za-z]:') { return $Path }

    $driveLetter = $Path.Substring(0, 2)
    try {
        $drive = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$driveLetter'" -ErrorAction Stop
    }
    catch { return $Path }

    if ($drive -and $drive.DriveType -eq 4 -and $drive.ProviderName) {
        $unc = $drive.ProviderName + $Path.Substring(2)
        Write-Log "Resolved mapped drive $driveLetter to UNC $unc" 'INFO'
        return $unc
    }
    return $Path
}

function Connect-Nas {
    param(
        [string] $NasHost,
        [System.Management.Automation.PSCredential] $Cred
    )

    $ipc = "\\$NasHost\IPC$"

    if (-not $Cred) {
        Write-Log "No credential supplied; trying current Windows identity." 'INFO'
        return $true
    }

    $user = $Cred.UserName
    $pass = $Cred.GetNetworkCredential().Password

    # Drop any stale session first; a half-open session with wrong credentials
    # produces misleading "access denied" on every subsequent share.
    & net.exe use $ipc /delete /y 2>&1 | Out-Null

    $output = & net.exe use $ipc /user:$user $pass 2>&1
    if ($LASTEXITCODE -eq 0) {
        [void]$script:MappedSessions.Add($ipc)
        Write-Log "Authenticated to $NasHost as $user" 'OK'
        return $true
    }

    Write-Log "Authentication to $NasHost failed: $($output -join ' ')" 'ERROR'
    return $false
}

function Disconnect-Nas {
    foreach ($session in $script:MappedSessions) {
        try { & net.exe use $session /delete /y 2>&1 | Out-Null } catch { }
    }
    $script:MappedSessions.Clear()
}

function Test-NasReachable {
    param([string] $NasHost)

    if (Test-TcpPort -ComputerName $NasHost -Port 445) { return $true }
    if (Test-TcpPort -ComputerName $NasHost -Port 139) {
        Write-Log "SMB port 445 closed but 139 answered. NAS may be forcing legacy SMB1." 'WARN'
        return $true
    }
    return $false
}

function Wait-ForNas {
    param([string] $NasHost, [int] $MaxWaitSeconds = 300)

    if (Test-NasReachable -NasHost $NasHost) { return $true }

    Write-Log "$NasHost is not answering on SMB. Waiting for it to come back..." 'WARN'
    $waited = 0
    $delay  = 10
    while ($waited -lt $MaxWaitSeconds) {
        Start-Sleep -Seconds $delay
        $waited += $delay
        if (Test-NasReachable -NasHost $NasHost) {
            Write-Log "$NasHost is reachable again after ${waited}s." 'OK'
            return $true
        }
        Write-Log "Still unreachable (${waited}s elapsed)." 'INFO'
        if ($delay -lt 30) { $delay += 5 }
    }
    return $false
}

function Find-NasShares {
    param([string] $NasHost)

    $found = New-Object System.Collections.ArrayList

    # Preferred: ask the server. Often blocked on modern Windows because share
    # enumeration rides on SMB1, so failure here is expected, not fatal.
    try {
        $view = & net.exe view "\\$NasHost" 2>&1
        if ($LASTEXITCODE -eq 0) {
            foreach ($line in $view) {
                if ($line -match '^(\S+)\s+Disk') {
                    [void]$found.Add($Matches[1])
                }
            }
        }
    }
    catch { }

    if ($found.Count -gt 0) {
        Write-Log "Enumerated $($found.Count) share(s) from the NAS." 'OK'
        return $found.ToArray()
    }

    Write-Log "Share enumeration blocked. Probing common QNAP share names instead." 'WARN'
    foreach ($candidate in $CommonQnapShares) {
        $path = "\\$NasHost\$candidate"
        try {
            if (Test-Path -LiteralPath $path -ErrorAction SilentlyContinue) {
                [void]$found.Add($candidate)
                Write-Log "  found: $candidate" 'OK'
            }
        }
        catch { }
    }
    return $found.ToArray()
}

# ---------------------------------------------------------------------------
# Copy engine
# ---------------------------------------------------------------------------

function Get-RobocopyArgs {
    param(
        [string] $Source,
        [string] $Dest,
        [string] $LogPath,
        [switch] $ListOnly
    )

    $a = New-Object System.Collections.ArrayList
    [void]$a.Add($Source.TrimEnd('\'))
    [void]$a.Add($Dest.TrimEnd('\'))

    [void]$a.Add('/E')            # include subdirectories, including empty ones
    [void]$a.Add('/DCOPY:DAT')    # preserve directory timestamps

    if ($WithAcls) { [void]$a.Add('/COPY:DATSOU') } else { [void]$a.Add('/COPY:DAT') }

    # /FFT: 2-second timestamp granularity, matching non-NTFS NAS volumes.
    # /DST: tolerate 1-hour daylight-saving offsets.
    # Without these, unchanged files look modified and resume never converges.
    [void]$a.Add('/FFT')
    [void]$a.Add('/DST')

    [void]$a.Add('/XJ')           # skip junctions; avoids infinite recursion
    [void]$a.Add("/R:$RetryCount")
    [void]$a.Add("/W:$RetryWaitSeconds")
    [void]$a.Add('/NP')           # no per-file percentage spam

    if ($Threads -gt 0) {
        # /MT and /Z are mutually exclusive in practice: multi-threaded copies
        # are not restartable. Caller opted into speed over resilience.
        [void]$a.Add("/MT:$Threads")
    }
    else {
        [void]$a.Add('/Z')        # restartable mode: survives a dropped session
    }

    if (-not $IncludeSystemFolders) {
        [void]$a.Add('/XD')
        foreach ($f in $QnapSystemFolders) { [void]$a.Add($f) }
    }

    if ($ListOnly) {
        [void]$a.Add('/L')
        [void]$a.Add('/NJH'); [void]$a.Add('/NFL'); [void]$a.Add('/NDL')
    }
    else {
        [void]$a.Add('/TEE')
        [void]$a.Add("/LOG+:$LogPath")
    }

    return $a.ToArray()
}

function Invoke-Robocopy {
    param([string[]] $Arguments)

    $output = & robocopy.exe @Arguments 2>&1
    $code   = $LASTEXITCODE
    return [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Get-RobocopyResidual {
    # Runs a list-only pass and returns how many files robocopy still considers
    # outstanding. Zero is the only thing that proves a share is complete.
    param([string] $Source, [string] $Dest)

    $args   = Get-RobocopyArgs -Source $Source -Dest $Dest -LogPath $null -ListOnly
    $result = Invoke-Robocopy -Arguments $args

    if ($result.ExitCode -ge 8) {
        return [pscustomobject]@{ Ok = $false; Files = -1; Bytes = -1; ExitCode = $result.ExitCode }
    }

    $files = 0
    $bytes = 0
    foreach ($line in $result.Output) {
        $text = [string]$line
        if ($text -match '^\s*Files\s*:\s+(\d+)\s+(\d+)') { $files = [int]$Matches[2] }
        elseif ($text -match '^\s*Bytes\s*:\s+(\S+)\s+(\S+)') { }
    }

    return [pscustomobject]@{ Ok = $true; Files = $files; Bytes = $bytes; ExitCode = $result.ExitCode }
}

function Compare-TreeCounts {
    param([string] $Source, [string] $Dest)

    Write-Log "Deep verify: enumerating both trees (this can take a while)..." 'INFO'
    try {
        $srcFiles = @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force -ErrorAction SilentlyContinue |
            Where-Object { $IncludeSystemFolders -or -not (Test-IsSystemPath $_.FullName) })
        $dstFiles = @(Get-ChildItem -LiteralPath $Dest -Recurse -File -Force -ErrorAction SilentlyContinue)
    }
    catch {
        Write-Log "Deep verify could not enumerate: $($_.Exception.Message)" 'WARN'
        return $null
    }

    $srcBytes = 0; foreach ($f in $srcFiles) { $srcBytes += $f.Length }
    $dstBytes = 0; foreach ($f in $dstFiles) { $dstBytes += $f.Length }

    return [pscustomobject]@{
        SourceFiles = $srcFiles.Count
        DestFiles   = $dstFiles.Count
        SourceBytes = $srcBytes
        DestBytes   = $dstBytes
        Match       = ($srcFiles.Count -eq $dstFiles.Count -and $srcBytes -eq $dstBytes)
    }
}

function Test-IsSystemPath {
    param([string] $FullName)
    foreach ($f in $QnapSystemFolders) {
        if ($FullName -like "*\$f\*" -or $FullName -like "*\$f") { return $true }
    }
    return $false
}

function Compare-TreeHashes {
    param([string] $Source, [string] $Dest)

    Write-Log "Hash verify: SHA-256 over every file. This is slow." 'WARN'
    $mismatches = New-Object System.Collections.ArrayList
    $checked    = 0

    $srcFiles = Get-ChildItem -LiteralPath $Source -Recurse -File -Force -ErrorAction SilentlyContinue
    foreach ($sf in $srcFiles) {
        if (-not $IncludeSystemFolders -and (Test-IsSystemPath $sf.FullName)) { continue }

        $relative = $sf.FullName.Substring($Source.TrimEnd('\').Length).TrimStart('\')
        $target   = Join-Path $Dest $relative

        if (-not (Test-Path -LiteralPath $target)) {
            [void]$mismatches.Add("MISSING: $relative")
            continue
        }
        try {
            $h1 = (Get-FileHash -LiteralPath $sf.FullName -Algorithm SHA256).Hash
            $h2 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
            if ($h1 -ne $h2) { [void]$mismatches.Add("DIFFERS: $relative") }
        }
        catch {
            [void]$mismatches.Add("UNREADABLE: $relative ($($_.Exception.Message))")
        }
        $checked++
        if ($checked % 250 -eq 0) { Write-Log "  hashed $checked files..." 'INFO' }
    }

    return [pscustomobject]@{ Checked = $checked; Mismatches = $mismatches.ToArray() }
}

function Copy-Share {
    param(
        [string]    $NasHost,
        [string]    $ShareName,
        [string]    $DestRoot,
        [hashtable] $State
    )

    $source  = "\\$NasHost\$ShareName"
    $dest    = Join-Path $DestRoot $ShareName
    $logPath = Join-Path $LogDir ("$ShareName-$RunStamp.log")

    Write-Log "Share '$ShareName'  ->  $dest" 'STEP'

    if (-not (Test-Path -LiteralPath $source)) {
        Write-Log "Source $source is not accessible. Skipping for now; it stays marked incomplete." 'ERROR'
        $State['shares'][$ShareName] = @{
            status   = 'unreachable'
            lastExit = -1
            passes   = 0
            note     = 'source not accessible at last attempt'
        }
        return $false
    }

    if (-not (Test-Path -LiteralPath $dest)) {
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
    }

    if ($DryRun) {
        Write-Log "DRY RUN: listing outstanding work only." 'WARN'
        $residual = Get-RobocopyResidual -Source $source -Dest $dest
        Write-Log "Would copy approximately $($residual.Files) file(s)." 'INFO'
        return $true
    }

    $pass    = 0
    $success = $false

    while ($pass -lt $MaxPasses) {
        $pass++
        Write-Log "Pass $pass of $MaxPasses for '$ShareName'." 'INFO'

        if (-not (Wait-ForNas -NasHost $NasHost)) {
            Write-Log "NAS did not come back. Aborting this share; rerun with -Resume later." 'ERROR'
            break
        }

        $args   = Get-RobocopyArgs -Source $source -Dest $dest -LogPath $logPath
        $result = Invoke-Robocopy -Arguments $args

        # Robocopy exit codes are a bitmask. Anything under 8 is a success;
        # 8 means some files failed, 16 is fatal.
        if ($result.ExitCode -ge 16) {
            Write-Log "Robocopy fatal error (exit $($result.ExitCode)) on '$ShareName'." 'ERROR'
        }
        elseif ($result.ExitCode -ge 8) {
            Write-Log "Robocopy reported failures (exit $($result.ExitCode)) on '$ShareName'. Will retry." 'WARN'
        }
        else {
            Write-Log "Robocopy pass completed (exit $($result.ExitCode))." 'OK'
        }

        $residual = Get-RobocopyResidual -Source $source -Dest $dest
        if ($residual.Ok -and $residual.Files -eq 0) {
            Write-Log "Verified: nothing outstanding for '$ShareName'." 'OK'
            $success = $true
            break
        }

        if ($residual.Ok) {
            Write-Log "$($residual.Files) file(s) still outstanding for '$ShareName'." 'WARN'
        }
        else {
            Write-Log "Could not verify '$ShareName' (list pass exit $($residual.ExitCode))." 'WARN'
        }

        Start-Sleep -Seconds ([Math]::Min(60, 10 * $pass))
    }

    $entry = @{
        status     = $(if ($success) { 'complete' } else { 'incomplete' })
        lastExit   = $result.ExitCode
        passes     = $pass
        verifiedAt = $(if ($success) { (Get-Date).ToUniversalTime().ToString('o') } else { '' })
        log        = $logPath
    }

    if ($success -and $DeepVerify) {
        $cmp = Compare-TreeCounts -Source $source -Dest $dest
        if ($cmp) {
            $entry['sourceFiles'] = $cmp.SourceFiles
            $entry['destFiles']   = $cmp.DestFiles
            $entry['sourceBytes'] = $cmp.SourceBytes
            $entry['destBytes']   = $cmp.DestBytes
            if ($cmp.Match) {
                Write-Log "Deep verify OK: $($cmp.SourceFiles) files, $(Format-Bytes $cmp.SourceBytes)." 'OK'
            }
            else {
                Write-Log ("Deep verify MISMATCH: source {0} files / {1}; dest {2} files / {3}." -f `
                        $cmp.SourceFiles, (Format-Bytes $cmp.SourceBytes), $cmp.DestFiles, (Format-Bytes $cmp.DestBytes)) 'ERROR'
                $entry['status'] = 'incomplete'
                $success = $false
            }
        }
    }

    if ($success -and $Hash) {
        $hres = Compare-TreeHashes -Source $source -Dest $dest
        $entry['hashChecked'] = $hres.Checked
        if ($hres.Mismatches.Count -gt 0) {
            Write-Log "Hash verify found $($hres.Mismatches.Count) problem(s) in '$ShareName'." 'ERROR'
            foreach ($m in $hres.Mismatches | Select-Object -First 20) { Write-Log "  $m" 'ERROR' }
            $entry['status'] = 'incomplete'
            $entry['hashMismatches'] = $hres.Mismatches.Count
            $success = $false
        }
        else {
            Write-Log "Hash verify OK across $($hres.Checked) files." 'OK'
        }
    }

    $State['shares'][$ShareName] = $entry
    Write-State -State $State -Path $StateFile
    return $success
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

$exitCode = 0

try {
    Write-Log "QNAP file preservation run $RunStamp" 'STEP'
    Write-Log "PowerShell $($PSVersionTable.PSVersion) on $env:COMPUTERNAME as $env:USERNAME"
    Write-Log "Log: $RunLog"
    Write-Log "State: $StateFile"

    if ($Force -and (Test-Path -LiteralPath $StateFile)) {
        Remove-Item -LiteralPath $StateFile -Force
        Write-Log "-Force: previous state discarded. Copied data was left untouched." 'WARN'
    }

    $state = Read-State -Path $StateFile
    if (-not $state) { $state = New-State }
    if (-not $state.ContainsKey('shares') -or $null -eq $state['shares']) { $state['shares'] = @{} }
    if ($state['shares'] -isnot [hashtable]) { $state['shares'] = ConvertTo-Hashtable $state['shares'] }

    # Fill in from state so `-Resume` alone is a valid invocation.
    if (-not $Nas -and $state['nas']) { $Nas = $state['nas'] }
    if (-not $Destination -and $state['destination']) { $Destination = $state['destination'] }

    if (-not $Nas) {
        throw "No NAS specified and none found in state. Run once with -Nas <host-or-ip> -Destination <folder>."
    }

    if ($ListSharesOnly) {
        if ($Credential) { [void](Connect-Nas -NasHost $Nas -Cred $Credential) }
        if (-not (Test-NasReachable -NasHost $Nas)) { throw "$Nas is not reachable on SMB." }
        $shares = Find-NasShares -NasHost $Nas
        Write-Log "Shares visible on ${Nas}: $($shares -join ', ')" 'OK'
        return
    }

    if (-not $Destination) {
        throw "No destination specified and none found in state. Run once with -Destination <folder>."
    }

    $Destination = Resolve-ToUnc $Destination
    if (-not (Test-Path -LiteralPath $Destination)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        Write-Log "Created destination $Destination" 'INFO'
    }

    # Refuse to write the rescue copy back onto the machine we are rescuing.
    if ($Destination -like "\\$Nas\*") {
        throw "Destination $Destination is on the NAS itself. Choose local or external storage."
    }

    Write-Log "Checking whether $Nas answers on SMB..." 'STEP'
    if (-not (Test-NasReachable -NasHost $Nas)) {
        throw "$Nas is not answering on TCP 445 or 139. Fix connectivity before preserving files."
    }
    Write-Log "$Nas is reachable." 'OK'

    if ($Credential) {
        if (-not (Connect-Nas -NasHost $Nas -Cred $Credential)) {
            throw "Could not authenticate to $Nas."
        }
    }

    if (-not $Share -or $Share.Count -eq 0) {
        if ($state.ContainsKey('shareList') -and $state['shareList']) {
            $Share = @($state['shareList'])
            Write-Log "Using share list from state: $($Share -join ', ')" 'INFO'
        }
        else {
            $Share = Find-NasShares -NasHost $Nas
            if (-not $Share -or $Share.Count -eq 0) {
                throw "No shares found. Re-run with -Share <name1>,<name2> to name them explicitly."
            }
            Write-Log "Discovered shares: $($Share -join ', ')" 'OK'
        }
    }

    # Free-space sanity check against the destination volume.
    try {
        $destRoot = [System.IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $Destination).Path)
        if ($destRoot -match '^[A-Za-z]:') {
            $vol = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$($destRoot.TrimEnd('\'))'"
            if ($vol) { Write-Log "Destination free space: $(Format-Bytes $vol.FreeSpace)" 'INFO' }
        }
    }
    catch { }

    $state['nas']         = $Nas
    $state['destination'] = $Destination
    $state['shareList']   = @($Share)
    Write-State -State $state -Path $StateFile

    $completed = New-Object System.Collections.ArrayList
    $failed    = New-Object System.Collections.ArrayList
    $skipped   = New-Object System.Collections.ArrayList

    foreach ($s in $Share) {
        $existing = $null
        if ($state['shares'].ContainsKey($s)) { $existing = $state['shares'][$s] }

        $alreadyDone = ($existing -and $existing.ContainsKey('status') -and $existing['status'] -eq 'complete')

        if ($Resume -and $alreadyDone -and -not $Recheck) {
            Write-Log "Skipping '$s': already verified complete on $($existing['verifiedAt']). Use -Recheck to re-verify." 'INFO'
            [void]$skipped.Add($s)
            continue
        }

        if (Copy-Share -NasHost $Nas -ShareName $s -DestRoot $Destination -State $state) {
            [void]$completed.Add($s)
        }
        else {
            [void]$failed.Add($s)
        }
    }

    Write-Log "Summary" 'STEP'
    Write-Log "Verified complete : $(if ($completed.Count) { $completed -join ', ' } else { 'none' })" 'OK'
    if ($skipped.Count)  { Write-Log "Skipped (already done) : $($skipped -join ', ')" 'INFO' }
    if ($failed.Count) {
        Write-Log "Incomplete : $($failed -join ', ')" 'ERROR'
        Write-Log "Re-run '.\qnap-preserve-files.ps1 -Resume' to continue where this left off." 'WARN'
        $exitCode = 2
    }
    else {
        Write-Log "Every requested share is copied and verified." 'OK'
    }
    Write-Log "Full log: $RunLog" 'INFO'
}
catch {
    Write-Log $_.Exception.Message 'ERROR'
    if ($_.ScriptStackTrace) { Write-Log $_.ScriptStackTrace 'ERROR' }
    $exitCode = 1
}
finally {
    Disconnect-Nas
}

exit $exitCode
