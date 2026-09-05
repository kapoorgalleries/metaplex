#Requires -Version 5.1
<#
.SYNOPSIS
    Preserve (pull off) every file from a QNAP NAS to local storage before any
    destructive troubleshooting, with safe, verifiable resume.

.DESCRIPTION
    Built for the case where the NAS is flaky or intermittently unreachable and
    you need a complete, trustworthy local copy BEFORE you touch firmware, RAID,
    or a factory reset.

    The governing rule is that every check fails CLOSED. Anything this script
    cannot positively verify is reported as unverified, never as done. A share
    is marked complete only on affirmative evidence; absence of evidence is
    treated as failure, because the cost of a false "complete" here is losing
    files you then wipe.

    Design decisions that matter:

    * Runs on Windows PowerShell 5.1. No PowerShell 7 / pwsh required.
    * Copies with robocopy in restartable mode (/Z), which survives dropped SMB
      sessions mid-file.
    * NEVER mirrors. /E only. Nothing on the destination is ever deleted.
    * Resume is verified, not assumed. A share is marked complete only after a
      robocopy list-only pass is successfully PARSED and shows zero files
      outstanding, counting Copied, Mismatch and FAILED. An unparseable summary
      is a verification failure, not a pass.
    * An empty source is treated as suspicious, not as success. A QNAP whose
      volume failed to mount still presents its shares, and they enumerate
      empty. Copying nothing from one and calling it preserved is the worst
      thing this script could do, so that requires -AllowEmptyShares.
    * UNC paths only. Mapped drive letters are resolved to UNC where possible.
    * /FFT and /DST are on by default. NAS filesystems report timestamps at
      coarser granularity than NTFS; without these robocopy re-copies unchanged
      files forever and resume never converges.

.PARAMETER Nas
    Hostname or IP of the NAS. Stored in the state file on first run so later
    -Resume calls need no arguments.

.PARAMETER Share
    Share names to preserve. If omitted the script enumerates them, falling back
    to probing common names. A probed list is explicitly NOT treated as
    authoritative - see -Share in the notes below.

.PARAMETER Destination
    Local or external folder to receive the copy. One subfolder per share.

.PARAMETER Credential
    NAS credentials. If omitted, the current Windows identity is tried first and
    you are prompted only if that is refused (unless -NonInteractive).

.PARAMETER Resume
    Continue a previous run. Shares proven complete are skipped; anything else
    is retried.

.PARAMETER Recheck
    With -Resume, re-verify shares already marked complete instead of skipping.

.PARAMETER Force
    Discard existing state and start fresh. Does not delete copied data.

.PARAMETER DryRun
    Report what would be copied. Copies nothing, and never reports a share as
    complete.

.PARAMETER Threads
    Use robocopy multi-threading (/MT:N) instead of restartable mode (/Z).
    Faster on many small files, but loses mid-file restart.

.PARAMETER DeepVerify
    Additionally compare recursive file counts and total bytes. An enumeration
    that hits errors is reported as unreliable rather than passing.

.PARAMETER Hash
    Full SHA-256 comparison of every file. Authoritative and very slow.

.PARAMETER AllowEmptyShares
    Accept a share that contains no files as legitimately empty. Without this,
    an empty source is flagged rather than marked complete.

.PARAMETER NonInteractive
    Never prompt for credentials; fail instead. For scheduled runs.

.PARAMETER IncludeSystemFolders
    Include QNAP internal folders (@Recycle, .@__thumb, @Recently-Snapshot,
    @Transcode, .streams). Excluded by default as regenerable. Note that
    @Recycle can contain deleted files you may still want.

.PARAMETER WithAcls
    Also copy security descriptors (/COPY:DATSOU). Off by default: NAS-to-NTFS
    ACL copies commonly fail and bury real errors.

.EXAMPLE
    .\qnap-preserve-files.ps1 -Nas 192.168.1.50 -Destination E:\QNAP-Rescue

.EXAMPLE
    .\qnap-preserve-files.ps1 -Resume

.EXAMPLE
    .\qnap-preserve-files.ps1 -Resume -Recheck -DeepVerify -Hash
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
    [switch]   $AllowEmptyShares,
    [switch]   $NonInteractive,
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

# $PSScriptRoot is empty when the script is not run from a file, and
# MyCommand.Definition then holds the script TEXT rather than a path, so only
# MyCommand.Path is safe to feed to Split-Path.
$ScriptDir = $null
if ($PSScriptRoot) {
    $ScriptDir = $PSScriptRoot
}
elseif ($MyInvocation.MyCommand.Path) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$localAppData = $env:LOCALAPPDATA
if (-not $localAppData) { $localAppData = [System.IO.Path]::GetTempPath() }
$FallbackDir = Join-Path $localAppData 'QnapPreserve'

if (-not $ScriptDir -or -not (Test-Path -LiteralPath $ScriptDir)) {
    $ScriptDir = $FallbackDir
    Write-Warning "Not running from a script file. State and logs will go to $ScriptDir."
    Write-Warning "Save this script as a .ps1 and run it with -File; pasting it into the console will not bind parameters."
}

$WorkDir = Join-Path $ScriptDir '.qnap-preserve'
try {
    if (-not (Test-Path -LiteralPath $WorkDir)) {
        New-Item -ItemType Directory -Path $WorkDir -Force -ErrorAction Stop | Out-Null
    }
    $probe = Join-Path $WorkDir '.write-test'
    Set-Content -LiteralPath $probe -Value 'ok' -ErrorAction Stop
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
}
catch {
    Write-Warning "Cannot write to $WorkDir ($($_.Exception.Message)). Falling back to $FallbackDir."
    $WorkDir = Join-Path $FallbackDir '.qnap-preserve'
    New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
}

if (-not $StateFile) { $StateFile = Join-Path $WorkDir 'state.json' }

$RunStamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$LogDir   = Join-Path $WorkDir 'logs'
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$RunLog = Join-Path $LogDir ("run-$RunStamp.log")

$QnapSystemFolders = @('@Recycle', '.@__thumb', '@Recently-Snapshot', '@Transcode', '.streams', '@Thumbnail')

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

function Invoke-Native {
    # $ErrorActionPreference = 'Stop' turns a native command's stderr, once
    # merged with 2>&1, into a terminating NativeCommandError. Robocopy and
    # net.exe both write to stderr on ordinary recoverable conditions, so
    # without this the script aborts on errors it is designed to survive.
    param(
        [Parameter(Mandatory = $true)][string]   $Command,
        [Parameter(Mandatory = $true)][string[]] $Arguments
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Command @Arguments 2>&1
        $code   = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{ ExitCode = $code; Output = $output }
}

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

function ConvertTo-Hashtable {
    # ConvertFrom-Json returns PSCustomObject on 5.1 (no -AsHashtable).
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
        version         = 2
        createdUtc      = (Get-Date).ToUniversalTime().ToString('o')
        nas             = ''
        destination     = ''
        shareListSource = ''
        shares          = @{}
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

function Get-HostAddresses {
    param([string] $Name)
    try {
        return @([System.Net.Dns]::GetHostAddresses($Name) |
            Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
            ForEach-Object { $_.IPAddressToString })
    }
    catch { return @() }
}

function Resolve-ToUnc {
    param([string] $Path)

    if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
    if ($Path.StartsWith('\\')) { return $Path }
    if ($Path -notmatch '^[A-Za-z]:') { return $Path }

    $driveLetter = $Path.Substring(0, 2)
    try {
        $drive = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$driveLetter'" -ErrorAction Stop
    }
    catch { $drive = $null }

    if ($drive -and $drive.DriveType -eq 4 -and $drive.ProviderName) {
        $unc = $drive.ProviderName + $Path.Substring(2)
        Write-Log "Resolved mapped drive $driveLetter to UNC $unc" 'INFO'
        return $unc
    }

    if (-not $drive) {
        # Win32_LogicalDisk is per-logon-session, so an elevated process cannot
        # see the interactive user's mappings any more than Test-Path can. Say
        # so plainly rather than letting it surface later as "path not found".
        Write-Log "Drive $driveLetter is not visible to this session. If you mapped it as a normal user and this window is elevated, that mapping does not exist here - pass the UNC path (\\server\share\...) instead." 'WARN'
    }
    return $Path
}

function Connect-Nas {
    param(
        [string] $NasHost,
        [System.Management.Automation.PSCredential] $Cred
    )

    $ipc = "\\$NasHost\IPC$"

    if (-not $Cred) { return $true }

    $user = $Cred.UserName
    $pass = $Cred.GetNetworkCredential().Password

    if ($pass -match '^/') {
        # net.exe would parse a leading-slash password as a switch.
        Write-Log "Password begins with '/', which net.exe parses as a switch. Change the password or connect the share manually first." 'ERROR'
        return $false
    }

    # Drop stale sessions first; a half-open session with wrong credentials
    # produces misleading "access denied" on every subsequent share.
    [void](Invoke-Native -Command 'net.exe' -Arguments @('use', $ipc, '/delete', '/y'))

    $r = Invoke-Native -Command 'net.exe' -Arguments @('use', $ipc, "/user:$user", $pass)
    if ($r.ExitCode -eq 0) {
        [void]$script:MappedSessions.Add($ipc)
        Write-Log "Authenticated to $NasHost as $user" 'OK'
        return $true
    }

    # Never log $r.Output verbatim: net.exe can echo the supplied password back
    # in its usage text when it mis-parses an argument.
    Write-Log "Authentication to $NasHost failed (net.exe exit $($r.ExitCode))." 'ERROR'
    return $false
}

function Disconnect-Nas {
    foreach ($session in $script:MappedSessions) {
        try { [void](Invoke-Native -Command 'net.exe' -Arguments @('use', $session, '/delete', '/y')) } catch { }
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
    $r = Invoke-Native -Command 'net.exe' -Arguments @('view', "\\$NasHost")
    if ($r.ExitCode -eq 0) {
        foreach ($name in (Read-NetViewShares -Lines $r.Output)) { [void]$found.Add($name) }
    }

    if ($found.Count -gt 0) {
        Write-Log "Enumerated $($found.Count) share(s) from the NAS." 'OK'
        return [pscustomobject]@{ Names = $found.ToArray(); Source = 'enumerated' }
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
    return [pscustomobject]@{ Names = $found.ToArray(); Source = 'probed' }
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

    [void]$a.Add('/E')
    [void]$a.Add('/DCOPY:DAT')

    if ($WithAcls) { [void]$a.Add('/COPY:DATSOU') } else { [void]$a.Add('/COPY:DAT') }

    # /FFT: 2-second timestamp granularity, matching non-NTFS NAS volumes.
    # /DST: tolerate 1-hour daylight-saving offsets.
    # Without these, unchanged files look modified and resume never converges.
    [void]$a.Add('/FFT')
    [void]$a.Add('/DST')

    [void]$a.Add('/XJ')
    [void]$a.Add("/R:$RetryCount")
    [void]$a.Add("/W:$RetryWaitSeconds")
    [void]$a.Add('/NP')

    if ($Threads -gt 0) {
        [void]$a.Add("/MT:$Threads")
    }
    else {
        [void]$a.Add('/Z')
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

function Read-RobocopySummary {
    <#
        Pure parser for robocopy's trailing summary block, separated from the
        command invocation so it can be tested against real robocopy output
        without a NAS. This is the highest-consequence logic in the script: its
        answer alone decides whether a share is recorded as preserved.

        The block looks like:

                       Total    Copied   Skipped  Mismatch    FAILED    Extras
            Dirs :        12         0        12         0         0         0
           Files :       345        12       333         0         0         0
    #>
    param([object[]] $Lines)

    $miss = [pscustomobject]@{
        Parsed = $false; Total = -1; Copied = -1; Skipped = -1
        Mismatch = -1; Failed = -1; Extras = -1; Outstanding = -1
    }

    if (-not $Lines) { return $miss }

    foreach ($line in $Lines) {
        $text = [string]$line
        if ($text -match '^\s*Files\s*:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$') {
            $copied   = [int]$Matches[2]
            $mismatch = [int]$Matches[4]
            $failed   = [int]$Matches[5]
            return [pscustomobject]@{
                Parsed   = $true
                Total    = [int]$Matches[1]
                Copied   = $copied
                Skipped  = [int]$Matches[3]
                Mismatch = $mismatch
                Failed   = $failed
                Extras   = [int]$Matches[6]
                # Outstanding is everything not already identical at the
                # destination. Reading only Copied reports a share with FAILED
                # entries as having nothing left to do.
                Outstanding = $copied + $mismatch + $failed
            }
        }
    }

    return $miss
}

function Read-NetViewShares {
    <#
        Pure parser for `net view \\host` output, separated for testability.

        Share names may contain spaces, so this anchors on the gap before the
        type column rather than on the first whitespace run. A regex of
        ^(\S+)\s+Disk silently drops "Family Photos", and that share is then
        never copied and never reported missing.
    #>
    param([object[]] $Lines)

    $found = New-Object System.Collections.ArrayList
    # Leading comma throughout: PowerShell unwraps a single-element array on
    # return, so a lone share would come back as a bare string and any caller
    # indexing it would walk its characters instead of its elements.
    if (-not $Lines) { return , $found.ToArray() }

    foreach ($line in $Lines) {
        $text = [string]$line
        # Name, whitespace, the literal type "Disk", then either the comment
        # column (2+ spaces) or end of line. Tolerates a single space before
        # the type, which happens when a long share name collapses the column.
        # Greedy on purpose: a share genuinely named "Backup Disk" would be
        # truncated to "Backup" by a non-greedy match.
        if ($text -match '^(.+)\s+Disk(\s{2,}|\s*$)') {
            $name = $Matches[1].Trim()
            if ($name -and $name -ne 'Share name') { [void]$found.Add($name) }
        }
    }
    return , $found.ToArray()
}

function Get-RobocopyResidual {
    <#
        Runs a list-only pass and reports how much work robocopy still sees.

        This is the single check that decides whether a share is complete, so it
        fails closed in every direction: an unparseable summary, a non-English
        robocopy, empty output or a list-pass error all return Ok = $false. The
        earlier version initialised the count to zero and returned it whether or
        not the summary was ever matched, which turned "I could not read the
        result" into "nothing left to do" and marked unpreserved shares done.
    #>
    param([string] $Source, [string] $Dest)

    # Not named $args: that is an automatic variable in PowerShell.
    $roboArgs = Get-RobocopyArgs -Source $Source -Dest $Dest -LogPath $null -ListOnly
    $result   = Invoke-Native -Command 'robocopy.exe' -Arguments $roboArgs

    if ($result.ExitCode -ge 8) {
        return [pscustomobject]@{
            Ok = $false; Outstanding = -1; Total = -1
            ExitCode = $result.ExitCode; Reason = "list pass failed (exit $($result.ExitCode))"
        }
    }

    $summary = Read-RobocopySummary -Lines $result.Output

    if (-not $summary.Parsed) {
        return [pscustomobject]@{
            Ok = $false; Outstanding = -1; Total = -1
            ExitCode = $result.ExitCode
            Reason = 'could not parse the robocopy summary (a non-English robocopy will do this)'
        }
    }

    return [pscustomobject]@{
        Ok = $true; Outstanding = $summary.Outstanding; Total = $summary.Total
        ExitCode = $result.ExitCode; Reason = ''
    }
}

function Test-IsSystemPath {
    param([string] $FullName)
    foreach ($f in $QnapSystemFolders) {
        if ($FullName -like "*\$f\*" -or $FullName -like "*\$f") { return $true }
    }
    return $false
}

function Test-HasJunctions {
    param([string] $Root)
    try {
        $dirs = Get-ChildItem -LiteralPath $Root -Recurse -Directory -Force -ErrorAction SilentlyContinue
        foreach ($d in $dirs) {
            if ($d.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { return $true }
        }
    }
    catch { }
    return $false
}

function Compare-TreeCounts {
    <#
        Independent count/byte comparison. Reports Reliable = $false whenever
        enumeration hit errors, since -ErrorAction SilentlyContinue would
        otherwise drop unreadable subtrees from the SOURCE side and let a
        truncated source match the destination exactly.
    #>
    param([string] $Source, [string] $Dest)

    Write-Log "Deep verify: enumerating both trees (this can take a while)..." 'INFO'

    $srcErr = @(); $dstErr = @()
    try {
        $srcAll = @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force -ErrorAction SilentlyContinue -ErrorVariable +srcErr)
        $dstAll = @(Get-ChildItem -LiteralPath $Dest   -Recurse -File -Force -ErrorAction SilentlyContinue -ErrorVariable +dstErr)
    }
    catch {
        return [pscustomobject]@{ Reliable = $false; Reason = "enumeration failed: $($_.Exception.Message)" }
    }

    $srcFiles = @($srcAll | Where-Object { $IncludeSystemFolders -or -not (Test-IsSystemPath $_.FullName) })
    $dstFiles = @($dstAll | Where-Object { $IncludeSystemFolders -or -not (Test-IsSystemPath $_.FullName) })

    $reasons = New-Object System.Collections.ArrayList
    if ($srcErr.Count -gt 0) { [void]$reasons.Add("$($srcErr.Count) error(s) reading the source; unreadable subtrees would be silently excluded") }
    if ($dstErr.Count -gt 0) { [void]$reasons.Add("$($dstErr.Count) error(s) reading the destination") }

    # Get-ChildItem -Recurse traverses junctions in 5.1; robocopy is told not to
    # with /XJ. When junctions exist the two disagree by design, so the counts
    # are not comparable and must not be reported as a mismatch.
    if (Test-HasJunctions -Root $Source) {
        [void]$reasons.Add('source contains junctions, which robocopy skips (/XJ) but Get-ChildItem follows')
    }

    $srcBytes = 0; foreach ($f in $srcFiles) { $srcBytes += $f.Length }
    $dstBytes = 0; foreach ($f in $dstFiles) { $dstBytes += $f.Length }

    return [pscustomobject]@{
        Reliable    = ($reasons.Count -eq 0)
        Reason      = ($reasons -join '; ')
        SourceFiles = $srcFiles.Count
        DestFiles   = $dstFiles.Count
        SourceBytes = $srcBytes
        DestBytes   = $dstBytes
        Match       = ($srcFiles.Count -eq $dstFiles.Count -and $srcBytes -eq $dstBytes)
    }
}

function Compare-TreeHashes {
    param([string] $Source, [string] $Dest)

    Write-Log "Hash verify: SHA-256 over every file. This is slow." 'WARN'
    $mismatches = New-Object System.Collections.ArrayList
    $checked    = 0

    $srcErr   = @()
    $srcFiles = @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force -ErrorAction SilentlyContinue -ErrorVariable +srcErr)

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
            # A path 5.1 cannot open (over MAX_PATH, locked) is unverified, not
            # verified. Report it rather than counting it as a pass.
            [void]$mismatches.Add("UNREADABLE: $relative ($($_.Exception.Message))")
        }
        $checked++
        if ($checked % 250 -eq 0) { Write-Log "  hashed $checked files..." 'INFO' }
    }

    $reliable = $true
    $reason   = ''
    if ($srcErr.Count -gt 0) {
        $reliable = $false
        $reason   = "$($srcErr.Count) error(s) enumerating the source"
    }
    elseif ($checked -eq 0 -and $srcFiles.Count -gt 0) {
        $reliable = $false
        $reason   = 'no files were hashed despite a non-empty source'
    }

    return [pscustomobject]@{
        Checked = $checked; Mismatches = $mismatches.ToArray()
        Reliable = $reliable; Reason = $reason
    }
}

function Get-ShareSkipDecision {
    <#
        Decides whether -Resume may skip a share, given what the stored record
        proves and what this run is asking for. Separated for testability: the
        conditions are subtle, and getting them wrong means either re-copying
        terabytes needlessly or - far worse - reporting a depth of verification
        that never actually ran, immediately before someone wipes the source.
    #>
    param(
        [hashtable] $Existing,
        [bool] $Resume,
        [bool] $Recheck,
        [bool] $DryRun,
        [bool] $WantDeep,
        [bool] $WantHash
    )

    $complete = ($null -ne $Existing -and $Existing.ContainsKey('status') -and $Existing['status'] -eq 'complete')

    # A stored record only lets us skip if it was verified at least as deeply
    # as this run asks for. 'complete' from a plain run does not satisfy -Hash.
    $deepEnough = $true
    if ($complete -and $WantDeep) {
        $deepEnough = ($Existing.ContainsKey('deepVerified') -and [bool]$Existing['deepVerified'])
    }
    if ($complete -and $WantHash -and $deepEnough) {
        $deepEnough = ($Existing.ContainsKey('hashVerified') -and [bool]$Existing['hashVerified'])
    }

    $skip = ($Resume -and $complete -and $deepEnough -and (-not $Recheck) -and (-not $DryRun))

    return [pscustomobject]@{ Complete = $complete; DeepEnough = $deepEnough; Skip = $skip }
}

function Copy-Share {
    <#
        Returns a status string, not a boolean: 'complete', 'incomplete',
        'unreachable', 'empty-source', or 'dryrun'. A boolean could not
        distinguish "copied and verified" from "listed nothing because -DryRun",
        which previously made a dry run report every share as complete.
    #>
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

    # Wait for the NAS BEFORE testing the source. A momentary dropout would
    # otherwise mark the share unreachable without ever entering the retry loop
    # that exists to ride out exactly that.
    if (-not (Wait-ForNas -NasHost $NasHost)) {
        Write-Log "$NasHost is not reachable. Leaving '$ShareName' unfinished." 'ERROR'
        $State['shares'][$ShareName] = @{
            status = 'unreachable'; lastExit = -1; passes = 0
            note   = 'NAS not reachable at last attempt'
        }
        Write-State -State $State -Path $StateFile
        return 'unreachable'
    }

    if (-not (Test-Path -LiteralPath $source)) {
        Write-Log "Source $source is not accessible (share missing, or access denied)." 'ERROR'
        $State['shares'][$ShareName] = @{
            status = 'unreachable'; lastExit = -1; passes = 0
            note   = 'source not accessible at last attempt'
        }
        Write-State -State $State -Path $StateFile
        return 'unreachable'
    }

    if (-not (Test-Path -LiteralPath $dest)) {
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
    }

    if ($DryRun) {
        $residual = Get-RobocopyResidual -Source $source -Dest $dest
        if ($residual.Ok) {
            Write-Log "DRY RUN: $($residual.Outstanding) file(s) outstanding of $($residual.Total) total. Nothing copied." 'WARN'
        }
        else {
            Write-Log "DRY RUN: could not determine outstanding work - $($residual.Reason)" 'WARN'
        }
        return 'dryrun'
    }

    $pass    = 0
    $success = $false

    # Initialised before the loop: it can exit before robocopy ever runs, and
    # under StrictMode reading an unassigned variable afterwards is a
    # terminating error.
    $lastExit = -1
    $lastResidual = $null

    while ($pass -lt $MaxPasses) {
        $pass++
        Write-Log "Pass $pass of $MaxPasses for '$ShareName'." 'INFO'

        if (-not (Wait-ForNas -NasHost $NasHost)) {
            Write-Log "NAS did not come back. Aborting this share; rerun with -Resume later." 'ERROR'
            break
        }

        $roboArgs = Get-RobocopyArgs -Source $source -Dest $dest -LogPath $logPath
        $result   = Invoke-Native -Command 'robocopy.exe' -Arguments $roboArgs
        $lastExit = $result.ExitCode

        if ($lastExit -ge 16) {
            Write-Log "Robocopy fatal error (exit $lastExit) on '$ShareName'." 'ERROR'
        }
        elseif ($lastExit -ge 8) {
            Write-Log "Robocopy reported failures (exit $lastExit) on '$ShareName'. Will retry." 'WARN'
        }
        else {
            Write-Log "Robocopy pass completed (exit $lastExit)." 'OK'
        }

        $residual     = Get-RobocopyResidual -Source $source -Dest $dest
        $lastResidual = $residual

        if (-not $residual.Ok) {
            Write-Log "Could not verify '$ShareName': $($residual.Reason)" 'WARN'
        }
        elseif ($residual.Outstanding -eq 0) {
            Write-Log "Verified: nothing outstanding for '$ShareName' ($($residual.Total) file(s))." 'OK'
            $success = $true
            break
        }
        else {
            Write-Log "$($residual.Outstanding) file(s) still outstanding for '$ShareName'." 'WARN'
        }

        Start-Sleep -Seconds ([Math]::Min(60, 10 * $pass))
    }

    $entry = @{
        status       = 'incomplete'
        lastExit     = $lastExit
        passes       = $pass
        verifiedAt   = ''
        log          = $logPath
        deepVerified = $false
        hashVerified = $false
    }

    if ($lastResidual -and $lastResidual.Ok) { $entry['sourceTotal'] = $lastResidual.Total }

    # A share that verifies as complete while containing nothing is the failure
    # this script most needs to catch: a QNAP whose volume did not mount still
    # publishes its shares, and they enumerate empty. Copying nothing from one
    # and recording it preserved is how the files get wiped.
    if ($success -and $lastResidual -and $lastResidual.Total -eq 0 -and -not $AllowEmptyShares) {
        Write-Log "'$ShareName' contains no files. That is either genuinely empty or a volume that failed to mount - refusing to record it as preserved. Re-run with -AllowEmptyShares if it really is empty." 'ERROR'
        $entry['status'] = 'empty-source'
        $State['shares'][$ShareName] = $entry
        Write-State -State $State -Path $StateFile
        return 'empty-source'
    }

    if ($success -and $DeepVerify) {
        $cmp = Compare-TreeCounts -Source $source -Dest $dest
        if (-not $cmp -or -not $cmp.Reliable) {
            $why = 'enumeration failed'
            if ($cmp) { $why = $cmp.Reason }
            Write-Log "Deep verify could not be trusted for '$ShareName': $why. Not recording as verified." 'ERROR'
            $success = $false
        }
        else {
            $entry['sourceFiles'] = $cmp.SourceFiles
            $entry['destFiles']   = $cmp.DestFiles
            $entry['sourceBytes'] = $cmp.SourceBytes
            $entry['destBytes']   = $cmp.DestBytes
            if ($cmp.Match) {
                $entry['deepVerified'] = $true
                Write-Log "Deep verify OK: $($cmp.SourceFiles) files, $(Format-Bytes $cmp.SourceBytes)." 'OK'
            }
            else {
                Write-Log ("Deep verify MISMATCH: source {0} files / {1}; dest {2} files / {3}." -f `
                        $cmp.SourceFiles, (Format-Bytes $cmp.SourceBytes), $cmp.DestFiles, (Format-Bytes $cmp.DestBytes)) 'ERROR'
                $success = $false
            }
        }
    }

    if ($success -and $Hash) {
        $hres = Compare-TreeHashes -Source $source -Dest $dest
        $entry['hashChecked'] = $hres.Checked
        if (-not $hres.Reliable) {
            Write-Log "Hash verify could not be trusted for '$ShareName': $($hres.Reason)." 'ERROR'
            $success = $false
        }
        elseif ($hres.Mismatches.Count -gt 0) {
            Write-Log "Hash verify found $($hres.Mismatches.Count) problem(s) in '$ShareName'." 'ERROR'
            foreach ($m in $hres.Mismatches | Select-Object -First 20) { Write-Log "  $m" 'ERROR' }
            $entry['hashMismatches'] = $hres.Mismatches.Count
            $success = $false
        }
        else {
            $entry['hashVerified'] = $true
            Write-Log "Hash verify OK across $($hres.Checked) files." 'OK'
        }
    }

    if ($success) {
        $entry['status']     = 'complete'
        $entry['verifiedAt'] = (Get-Date).ToUniversalTime().ToString('o')
    }

    $State['shares'][$ShareName] = $entry
    Write-State -State $State -Path $StateFile

    if ($success) { return 'complete' }
    return 'incomplete'
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
    if ($DryRun) { Write-Log "DRY RUN: nothing will be copied and no share will be recorded as complete." 'WARN' }

    if ($Force -and (Test-Path -LiteralPath $StateFile)) {
        Remove-Item -LiteralPath $StateFile -Force
        Write-Log "-Force: previous state discarded. Copied data was left untouched." 'WARN'
    }

    $state = Read-State -Path $StateFile
    if (-not $state) { $state = New-State }
    if (-not $state.ContainsKey('shares') -or $null -eq $state['shares']) { $state['shares'] = @{} }
    if ($state['shares'] -isnot [hashtable]) { $state['shares'] = ConvertTo-Hashtable $state['shares'] }
    if (-not $state.ContainsKey('shareListSource')) { $state['shareListSource'] = '' }

    if (-not $Nas -and $state['nas']) { $Nas = $state['nas'] }
    if (-not $Destination -and $state['destination']) { $Destination = $state['destination'] }

    if (-not $Nas) {
        throw "No NAS specified and none found in state. Run once with -Nas <host-or-ip> -Destination <folder>."
    }

    Write-Log "Checking whether $Nas answers on SMB..." 'STEP'
    if (-not (Test-NasReachable -NasHost $Nas)) {
        throw "$Nas is not answering on TCP 445 or 139. Fix connectivity before preserving files."
    }
    Write-Log "$Nas is reachable." 'OK'

    if (-not $Credential) {
        # Try the current Windows identity first, and only ask for credentials
        # if the NAS refuses it. Documented behaviour has to be real behaviour:
        # without this, a permissions problem surfaced later as every share
        # being "not accessible", which reads like a dead NAS.
        $probeSession = Invoke-Native -Command 'net.exe' -Arguments @('use', "\\$Nas\IPC$")
        if ($probeSession.ExitCode -eq 0) {
            [void]$script:MappedSessions.Add("\\$Nas\IPC$")
            Write-Log "Connected to $Nas as the current Windows user." 'OK'
        }
        elseif ($NonInteractive) {
            Write-Log "$Nas refused the current Windows identity and -NonInteractive is set. Continuing unauthenticated; expect access failures." 'WARN'
        }
        else {
            Write-Log "$Nas refused the current Windows identity. Enter NAS credentials." 'WARN'
            $Credential = Get-Credential -Message "Credentials for $Nas"
        }
    }

    if ($Credential) {
        if (-not (Connect-Nas -NasHost $Nas -Cred $Credential)) {
            throw "Could not authenticate to $Nas."
        }
    }

    if ($ListSharesOnly) {
        $probeResult = Find-NasShares -NasHost $Nas
        if ($probeResult.Source -eq 'probed') {
            Write-Log "This list came from probing common names and may be INCOMPLETE." 'WARN'
        }
        Write-Log "Shares visible on ${Nas}: $($probeResult.Names -join ', ')" 'OK'
        $exitCode = 0
    }
    else {
        if (-not $Destination) {
            throw "No destination specified and none found in state. Run once with -Destination <folder>."
        }

        $Destination = Resolve-ToUnc $Destination
        if (-not (Test-Path -LiteralPath $Destination)) {
            New-Item -ItemType Directory -Path $Destination -Force | Out-Null
            Write-Log "Created destination $Destination" 'INFO'
        }

        # Refuse to write the rescue copy back onto the machine being rescued.
        # Compare resolved addresses, not spelling: \\192.168.1.50\backup and
        # \\NAS\backup are the same device.
        if ($Destination.StartsWith('\\')) {
            $destHost = $Destination.TrimStart('\').Split('\')[0]
            $sameName = ($destHost -eq $Nas)
            $sharedIp = $false
            $destIps  = Get-HostAddresses $destHost
            $nasIps   = Get-HostAddresses $Nas
            foreach ($d in $destIps) { if ($nasIps -contains $d) { $sharedIp = $true } }
            if ($sameName -or $sharedIp) {
                throw "Destination $Destination is on the NAS itself ($destHost). Choose local or external storage."
            }
        }

        if (-not $Share -or $Share.Count -eq 0) {
            $useStored = $false
            if ($state.ContainsKey('shareList') -and $state['shareList'] -and $state['shareListSource'] -eq 'enumerated') {
                $useStored = $true
            }

            if ($useStored) {
                $Share = @($state['shareList'])
                Write-Log "Using enumerated share list from state: $($Share -join ', ')" 'INFO'
            }
            else {
                # A probed list is a guess. Re-discover every run rather than
                # persisting a guess and treating it as the full set - a share
                # missed by the probe would otherwise never be copied and never
                # be reported missing.
                $probeResult = Find-NasShares -NasHost $Nas
                $Share = $probeResult.Names
                $state['shareListSource'] = $probeResult.Source
                if (-not $Share -or $Share.Count -eq 0) {
                    throw "No shares found. Re-run with -Share <name1>,<name2> to name them explicitly."
                }
                if ($probeResult.Source -eq 'probed') {
                    Write-Log "Discovered by PROBING common names: $($Share -join ', ')" 'WARN'
                    Write-Log "This is a guess, not an enumeration. Shares with unusual names will be missed - pass -Share explicitly if you know them." 'WARN'
                }
                else {
                    Write-Log "Discovered shares: $($Share -join ', ')" 'OK'
                }
            }
        }
        else {
            $state['shareListSource'] = 'explicit'
        }

        try {
            $destResolved = (Resolve-Path -LiteralPath $Destination).Path
            $destRoot = [System.IO.Path]::GetPathRoot($destResolved)
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
        $empty     = New-Object System.Collections.ArrayList
        $dryrun    = New-Object System.Collections.ArrayList

        foreach ($s in $Share) {
            $existing = $null
            if ($state['shares'].ContainsKey($s)) { $existing = $state['shares'][$s] }

            $decision = Get-ShareSkipDecision -Existing $existing `
                -Resume ([bool]$Resume) -Recheck ([bool]$Recheck) -DryRun ([bool]$DryRun) `
                -WantDeep ([bool]$DeepVerify) -WantHash ([bool]$Hash)

            if ($decision.Skip) {
                Write-Log "Skipping '$s': verified complete on $($existing['verifiedAt'])." 'INFO'
                [void]$skipped.Add($s)
                continue
            }
            if ($Resume -and $decision.Complete -and -not $decision.DeepEnough) {
                Write-Log "'$s' is marked complete but was not verified to the depth this run requests. Re-verifying." 'WARN'
            }

            $status = Copy-Share -NasHost $Nas -ShareName $s -DestRoot $Destination -State $state
            switch ($status) {
                'complete'     { [void]$completed.Add($s) }
                'empty-source' { [void]$empty.Add($s) }
                'dryrun'       { [void]$dryrun.Add($s) }
                default        { [void]$failed.Add($s) }
            }
        }

        Write-Log "Summary" 'STEP'

        if ($DryRun) {
            Write-Log "DRY RUN complete. Nothing was copied and no share was marked complete." 'WARN'
            Write-Log "Shares listed: $($dryrun -join ', ')" 'INFO'
            $exitCode = 0
        }
        else {
            Write-Log "Verified complete : $(if ($completed.Count) { $completed -join ', ' } else { 'none' })" 'OK'
            if ($skipped.Count) { Write-Log "Skipped (already verified) : $($skipped -join ', ')" 'INFO' }
            if ($empty.Count) {
                Write-Log "EMPTY SOURCE - not recorded as preserved : $($empty -join ', ')" 'ERROR'
                Write-Log "Check whether the NAS volume actually mounted before accepting these with -AllowEmptyShares." 'ERROR'
                $exitCode = 2
            }
            if ($failed.Count) {
                Write-Log "Incomplete : $($failed -join ', ')" 'ERROR'
                Write-Log "Re-run '.\qnap-preserve-files.ps1 -Resume' to continue where this left off." 'WARN'
                $exitCode = 2
            }
            if ($state['shareListSource'] -eq 'probed') {
                Write-Log "The share list was PROBED, not enumerated. Shares with unusual names may exist and not have been copied." 'WARN'
            }
            if (-not $empty.Count -and -not $failed.Count) {
                Write-Log "Every requested share is copied and verified." 'OK'
            }
        }
        Write-Log "Full log: $RunLog" 'INFO'
    }
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
