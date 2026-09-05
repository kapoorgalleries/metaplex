<#
.SYNOPSIS
    Tests for the two pure parsers in qnap-preserve-files.ps1.

.DESCRIPTION
    These two functions carry the highest consequence in the script:

    * Read-RobocopySummary alone decides whether a share is recorded as
      preserved. If it reports "nothing outstanding" when it should not, an
      unpreserved share is marked complete and skipped forever after.
    * Read-NetViewShares decides which shares get copied at all. A share it
      drops is never copied and never reported missing.

    Both are separated from their command invocations so they can be exercised
    against real robocopy and net.exe output with no NAS present.

    No test framework dependency, so this runs anywhere PowerShell does.

.EXAMPLE
    pwsh -NoProfile -File .\tests\Parsers.Tests.ps1
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\Parsers.Tests.ps1
#>

[CmdletBinding()]
param(
    [string] $ScriptPath
)

$ErrorActionPreference = 'Stop'

if (-not $ScriptPath) {
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $ScriptPath = Join-Path (Split-Path -Parent $here) 'qnap-preserve-files.ps1'
}

if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Cannot find qnap-preserve-files.ps1 at $ScriptPath"
}

# Load only the function definitions. Dot-sourcing the script would execute its
# main body and try to reach a NAS.
$errors = $null; $tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$errors)
if ($errors -and $errors.Count -gt 0) {
    foreach ($e in $errors) { Write-Host ("PARSE ERROR line {0}: {1}" -f $e.Extent.StartLineNumber, $e.Message) -ForegroundColor Red }
    throw "Script does not parse; aborting tests."
}

$fns = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
foreach ($fn in $fns) {
    if ($fn.Name -in @('Read-RobocopySummary', 'Read-NetViewShares', 'Format-Bytes', 'ConvertTo-Hashtable', 'Get-ShareSkipDecision')) {
        . ([scriptblock]::Create($fn.Extent.Text))
    }
}

$script:Pass = 0
$script:Fail = 0
$script:Failures = New-Object System.Collections.ArrayList

function Assert-Equal {
    param($Expected, $Actual, [string] $Name)
    if ($Expected -eq $Actual) {
        $script:Pass++
        Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green
    }
    else {
        $script:Fail++
        [void]$script:Failures.Add($Name)
        Write-Host ("  FAIL  {0}" -f $Name) -ForegroundColor Red
        Write-Host ("        expected [{0}] got [{1}]" -f $Expected, $Actual) -ForegroundColor Red
    }
}

# ---------------------------------------------------------------------------
# Read-RobocopySummary
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host 'Read-RobocopySummary' -ForegroundColor Cyan

# A complete, realistic robocopy /L summary block.
$realBlock = @'
------------------------------------------------------------------------------

               Total    Copied   Skipped  Mismatch    FAILED    Extras
    Dirs :        45         0        45         0         0         0
   Files :       345        12       333         0         0         0
   Bytes :   1.234 g   45.6 m   1.190 g         0         0         0
   Times :   0:00:12   0:00:03                       0:00:00   0:00:08

   Speed :            15234567 Bytes/sec.
   Ended : Friday, September 5, 2026 4:12:00 AM
'@ -split "`n"

$r = Read-RobocopySummary -Lines $realBlock
Assert-Equal $true  $r.Parsed      'realistic block parses'
Assert-Equal 345    $r.Total       'realistic block: total'
Assert-Equal 12     $r.Copied      'realistic block: copied'
Assert-Equal 12     $r.Outstanding 'realistic block: outstanding = copied'

# Nothing left to do.
$done = @('   Files :       345         0       345         0         0         0')
$r = Read-RobocopySummary -Lines $done
Assert-Equal $true $r.Parsed      'completed block parses'
Assert-Equal 0     $r.Outstanding 'completed block: zero outstanding'
Assert-Equal 345   $r.Total       'completed block: total preserved'

# Mismatch and FAILED must count as outstanding. Reading only the Copied
# column would report this share as finished.
$trouble = @('   Files :       345         0       330         3         2         0')
$r = Read-RobocopySummary -Lines $trouble
Assert-Equal $true $r.Parsed      'mismatch/failed block parses'
Assert-Equal 5     $r.Outstanding 'mismatch(3) + failed(2) counted as outstanding'

$mixed = @('   Files :       345        12       330         1         2         0')
$r = Read-RobocopySummary -Lines $mixed
Assert-Equal 15 $r.Outstanding 'copied(12) + mismatch(1) + failed(2) = 15'

# An empty share. Parses fine, but Total 0 is what triggers the caller's
# empty-source guard.
$empty = @('   Files :         0         0         0         0         0         0')
$r = Read-RobocopySummary -Lines $empty
Assert-Equal $true $r.Parsed      'empty share parses'
Assert-Equal 0     $r.Total       'empty share: total zero'
Assert-Equal 0     $r.Outstanding 'empty share: outstanding zero'

# Everything below must FAIL to parse. Each would otherwise be read as
# "nothing outstanding" and mark a share complete.
$german = @('  Dateien:       345        12       333         0         0         0')
Assert-Equal $false (Read-RobocopySummary -Lines $german).Parsed 'localized (German) summary does not parse'

$french = @('  Fichiers :       345        12       333         0         0         0')
Assert-Equal $false (Read-RobocopySummary -Lines $french).Parsed 'localized (French) summary does not parse'

Assert-Equal $false (Read-RobocopySummary -Lines @()).Parsed    'empty output does not parse'
Assert-Equal $false (Read-RobocopySummary -Lines $null).Parsed  'null output does not parse'

$dirsOnly = @('    Dirs :        45         0        45         0         0         0')
Assert-Equal $false (Read-RobocopySummary -Lines $dirsOnly).Parsed 'Dirs line alone does not parse as Files'

# The original two-column regex would have matched this and returned a bogus
# count. A truncated summary must not parse.
$truncated = @('   Files :       345        12')
Assert-Equal $false (Read-RobocopySummary -Lines $truncated).Parsed 'truncated Files line does not parse'

$garbage = @('ERROR 5 (0x00000005) Accessing Source Directory', 'Access is denied.')
Assert-Equal $false (Read-RobocopySummary -Lines $garbage).Parsed 'error output does not parse'

# Missing value returned on a parse failure must be unusable, not zero.
$r = Read-RobocopySummary -Lines $garbage
Assert-Equal -1 $r.Outstanding 'failed parse yields Outstanding = -1, not 0'
Assert-Equal -1 $r.Total       'failed parse yields Total = -1, not 0'

# ---------------------------------------------------------------------------
# Read-NetViewShares
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host 'Read-NetViewShares' -ForegroundColor Cyan

$netView = @'
Shared resources at \\192.168.1.50

QNAP TS-453

Share name       Type         Used as  Comment

-------------------------------------------------------------------------------
Public           Disk                  System default share
Multimedia       Disk                  System default share
Family Docs      Disk
homes            Disk
Web              Disk                  System default share
The command completed successfully.
'@ -split "`n"

$shares = Read-NetViewShares -Lines $netView
Assert-Equal 5 $shares.Count 'realistic net view: five shares'
Assert-Equal $true ($shares -contains 'Public')      'finds Public'
Assert-Equal $true ($shares -contains 'Multimedia')  'finds Multimedia'
Assert-Equal $true ($shares -contains 'homes')       'finds homes'
Assert-Equal $true ($shares -contains 'Web')         'finds Web'

# The whole point: a share name with a space must survive. The original
# ^(\S+)\s+Disk regex dropped it silently.
Assert-Equal $true ($shares -contains 'Family Docs') 'finds share name containing a space'

# Non-share lines must be excluded.
Assert-Equal $false ($shares -contains 'Share name') 'excludes the header row'
Assert-Equal $false ($shares -contains 'QNAP TS-453') 'excludes the server description'

# A single result must come back as an array, not a bare string. Without the
# leading-comma return, PowerShell unwraps it and indexing walks characters:
# "Backup Disk"[0] is "B", so a caller sees a one-letter share name.
$one = Read-NetViewShares -Lines @('Public           Disk')
Assert-Equal $true ($one -is [array]) 'single result returns an array, not a string'

# A long name collapses the column to one space.
$tight = @('VeryLongShareNameHere Disk')
$r = Read-NetViewShares -Lines $tight
Assert-Equal 1 $r.Count 'single-space column still parses'
Assert-Equal 'VeryLongShareNameHere' $r[0] 'single-space column: correct name'

# A share genuinely named "Backup Disk" must not truncate to "Backup".
$diskName = @('Backup Disk      Disk                  archive')
$r = Read-NetViewShares -Lines $diskName
Assert-Equal 1 $r.Count 'share named "Backup Disk" parses'
Assert-Equal 'Backup Disk' $r[0] 'share named "Backup Disk" is not truncated'

# A comment containing the word Disk must not confuse the name.
$diskComment = @('Archive          Disk                  Disk archive for 2024')
$r = Read-NetViewShares -Lines $diskComment
Assert-Equal 'Archive' $r[0] 'comment containing "Disk" does not corrupt the name'

# Non-Disk types must be ignored.
$otherTypes = @('IPC$             IPC', 'HP LaserJet      Print                 Office printer')
Assert-Equal 0 (Read-NetViewShares -Lines $otherTypes).Count 'ignores IPC and Print shares'

Assert-Equal 0 (Read-NetViewShares -Lines @()).Count   'empty input yields no shares'
Assert-Equal 0 (Read-NetViewShares -Lines $null).Count 'null input yields no shares'

# ---------------------------------------------------------------------------
# Format-Bytes
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host 'Format-Bytes' -ForegroundColor Cyan

Assert-Equal '0 B'       (Format-Bytes 0)             'zero bytes'
Assert-Equal '512 B'     (Format-Bytes 512)           'sub-kilobyte'
Assert-Equal '1.00 KB'   (Format-Bytes 1024)          'one kilobyte'
Assert-Equal '1.00 MB'   (Format-Bytes 1048576)       'one megabyte'
Assert-Equal '1.00 GB'   (Format-Bytes 1073741824)    'one gigabyte'
Assert-Equal '1.00 TB'   (Format-Bytes 1099511627776) 'one terabyte'
Assert-Equal '2.50 TB'   (Format-Bytes 2748779069440) 'multi-terabyte NAS volume'

# ---------------------------------------------------------------------------
# ConvertTo-Hashtable
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host 'ConvertTo-Hashtable' -ForegroundColor Cyan

$json = @'
{
  "version": 2,
  "nas": "192.168.1.50",
  "shareList": ["Public", "Family Docs"],
  "shares": {
    "Public": { "status": "complete", "deepVerified": true, "passes": 2 }
  }
}
'@

$h = ConvertTo-Hashtable (ConvertFrom-Json $json)
Assert-Equal $true ($h -is [hashtable])                'top level becomes a hashtable'
Assert-Equal '192.168.1.50' $h['nas']                  'scalar survives'
Assert-Equal 2 $h['version']                           'integer survives'
Assert-Equal $true ($h['shares'] -is [hashtable])      'nested object becomes a hashtable'
Assert-Equal 'complete' $h['shares']['Public']['status'] 'deeply nested value survives'
Assert-Equal $true $h['shares']['Public']['deepVerified'] 'boolean survives'
Assert-Equal 2 $h['shareList'].Count                   'array survives with correct length'
Assert-Equal 'Family Docs' $h['shareList'][1]          'array element with a space survives'
Assert-Equal $true ($h['shares'].ContainsKey('Public')) 'ContainsKey works on the rehydrated state'

# ---------------------------------------------------------------------------
# Get-ShareSkipDecision
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host 'Get-ShareSkipDecision' -ForegroundColor Cyan

function New-Record {
    param([string] $Status = 'complete', [bool] $Deep = $false, [bool] $HashOk = $false)
    return @{ status = $Status; deepVerified = $Deep; hashVerified = $HashOk; verifiedAt = '2026-09-05T00:00:00Z' }
}

$plain = New-Record
$deep  = New-Record -Deep $true
$full  = New-Record -Deep $true -HashOk $true

# No record at all: never skip.
$d = Get-ShareSkipDecision -Existing $null -Resume $true -Recheck $false -DryRun $false -WantDeep $false -WantHash $false
Assert-Equal $false $d.Complete 'no record: not complete'
Assert-Equal $false $d.Skip     'no record: not skipped'

# An unfinished share is never skipped, whatever its stored status.
foreach ($st in @('incomplete', 'unreachable', 'empty-source')) {
    $d = Get-ShareSkipDecision -Existing (New-Record -Status $st) -Resume $true -Recheck $false -DryRun $false -WantDeep $false -WantHash $false
    Assert-Equal $false $d.Skip ("status '$st' is never skipped")
}

# The ordinary resume case.
$d = Get-ShareSkipDecision -Existing $plain -Resume $true -Recheck $false -DryRun $false -WantDeep $false -WantHash $false
Assert-Equal $true $d.Skip 'complete + -Resume: skipped'

# Without -Resume a fresh run redoes everything.
$d = Get-ShareSkipDecision -Existing $plain -Resume $false -Recheck $false -DryRun $false -WantDeep $false -WantHash $false
Assert-Equal $false $d.Skip 'complete without -Resume: not skipped'

# -Recheck and -DryRun both defeat skipping.
$d = Get-ShareSkipDecision -Existing $plain -Resume $true -Recheck $true -DryRun $false -WantDeep $false -WantHash $false
Assert-Equal $false $d.Skip '-Recheck forces re-verification'

$d = Get-ShareSkipDecision -Existing $plain -Resume $true -Recheck $false -DryRun $true -WantDeep $false -WantHash $false
Assert-Equal $false $d.Skip '-DryRun never skips'

# The critical cases: a shallow record must not satisfy a deeper request, or
# the run reports verification that never happened.
$d = Get-ShareSkipDecision -Existing $plain -Resume $true -Recheck $false -DryRun $false -WantDeep $true -WantHash $false
Assert-Equal $false $d.DeepEnough 'count-verified record does not satisfy -DeepVerify'
Assert-Equal $false $d.Skip       '-DeepVerify re-verifies a shallow record'

$d = Get-ShareSkipDecision -Existing $deep -Resume $true -Recheck $false -DryRun $false -WantDeep $true -WantHash $false
Assert-Equal $true $d.Skip 'deep-verified record satisfies -DeepVerify'

$d = Get-ShareSkipDecision -Existing $deep -Resume $true -Recheck $false -DryRun $false -WantDeep $false -WantHash $true
Assert-Equal $false $d.Skip 'deep-verified record does not satisfy -Hash'

$d = Get-ShareSkipDecision -Existing $plain -Resume $true -Recheck $false -DryRun $false -WantDeep $false -WantHash $true
Assert-Equal $false $d.Skip 'plain record does not satisfy -Hash'

$d = Get-ShareSkipDecision -Existing $full -Resume $true -Recheck $false -DryRun $false -WantDeep $true -WantHash $true
Assert-Equal $true $d.Skip 'fully verified record satisfies -DeepVerify -Hash'

# A record written by an older version has no depth fields at all.
$legacy = @{ status = 'complete'; verifiedAt = '2026-09-01T00:00:00Z' }
$d = Get-ShareSkipDecision -Existing $legacy -Resume $true -Recheck $false -DryRun $false -WantDeep $true -WantHash $false
Assert-Equal $false $d.Skip 'record missing depth fields is re-verified under -DeepVerify'

$d = Get-ShareSkipDecision -Existing $legacy -Resume $true -Recheck $false -DryRun $false -WantDeep $false -WantHash $false
Assert-Equal $true $d.Skip 'record missing depth fields still skips a plain -Resume'

# ---------------------------------------------------------------------------

Write-Host ''
if ($script:Fail -eq 0) {
    Write-Host ("ALL {0} ASSERTIONS PASSED" -f $script:Pass) -ForegroundColor Green
    exit 0
}
else {
    Write-Host ("{0} passed, {1} FAILED" -f $script:Pass, $script:Fail) -ForegroundColor Red
    foreach ($f in $script:Failures) { Write-Host ("  - {0}" -f $f) -ForegroundColor Red }
    exit 1
}
