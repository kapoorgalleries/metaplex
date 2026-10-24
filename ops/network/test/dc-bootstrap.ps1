# dc-bootstrap.ps1's check for a target that refused its arguments: only the target's own binding errors turn
# its exit code into 2. The lines below are the shapes Windows PowerShell 5.1 (NormalView) and pwsh 7
# (ConciseView, with colour codes) print for -File script.ps1 with a bad switch. The test loads the regex and
# the matching condition from dc-bootstrap.ps1 without running it.
# Run: pwsh -NoProfile -File ops/network/test/dc-bootstrap.ps1 (or powershell.exe -File on Windows PowerShell 5.1).
# Exits non-zero on any failure.
$ErrorActionPreference = 'Stop'
$boot = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/dc-bootstrap.ps1'
$fails = 0; $cases = 0
function Check([bool]$ok, [string]$what) { $script:cases++; if (-not $ok) { $script:fails++; Write-Output "FAIL: $what" } }

$ast = [System.Management.Automation.Language.Parser]::ParseFile($boot, [ref]$null, [ref]$null)
$Script = 'dc-gemini-review.ps1'
foreach ($n in '$sn', '$bindRe') {
  $a = @($ast.FindAll({ param($x) $x -is [System.Management.Automation.Language.AssignmentStatementAst] -and $x.Left.Extent.Text -eq $n }, $true))
  Check ($a.Count -eq 1) "dc-bootstrap.ps1 assigns $n once"
  if ($a.Count) { Set-Variable -Name $n.TrimStart('$') -Value (& ([ScriptBlock]::Create($a[0].Right.Extent.Text))) }
}
$ifs = @($ast.FindAll({ param($x) $x -is [System.Management.Automation.Language.IfStatementAst] -and $x.Clauses[0].Item1.Extent.Text -match '\$bindRe' }, $true))
Check ($ifs.Count -eq 1) 'dc-bootstrap.ps1 tests $bindRe in one if'
if (-not $ifs.Count) { Write-Output "$cases cases, $fails failures"; exit 1 }
$cond = [ScriptBlock]::Create($ifs[0].Clauses[0].Item1.Extent.Text)
function Counts([string]$line) { $s = $line; [bool](& $cond) }

$e = [string][char]27
$p51 = 'C:\Users\Sanjay Kapoor\trimurti-dc\kit-scripts\ops\network\scripts\dc-gemini-review.ps1 : '
$bad = [ordered]@{
  'NamedParameterNotFound (-Vai agy)'                  = @("A parameter cannot be found that matches parameter name 'Vai'.", 'NamedParameterNotFound')
  'AmbiguousParameter (-P 31)'                         = @("Parameter cannot be processed because the parameter name 'P' is ambiguous. Possible matches include: -Pr -Primary -PipelineVariable.", 'AmbiguousParameter')
  'ParameterAlreadyBound (-Pr twice)'                  = @("Cannot bind parameter because parameter 'Pr' is specified more than once. To provide multiple values to parameters that can accept multiple values, use the array syntax.", 'ParameterAlreadyBound')
  'MissingArgument (bare -Via)'                        = @("Missing an argument for parameter 'Via'. Specify a parameter of type 'System.String' and try again.", 'MissingArgument')
  'ParameterArgumentValidationError (-Via agyy)'       = @("Cannot validate argument on parameter 'Via'. The argument `"agyy`" does not belong to the set `"auto,api,agy,cli`" specified by the ValidateSet attribute.", 'ParameterArgumentValidationError')
  'ParameterArgumentTransformationError (-Pr x31)'     = @("Cannot process argument transformation on parameter 'Pr'. Cannot convert value `"x31`" to type `"System.Int32`".", 'ParameterArgumentTransformationError')
  'PositionalParameterNotFound (stray word)'           = @("A positional parameter cannot be found that accepts argument 'extra'.", 'PositionalParameterNotFound')
  'CannotConvertArgumentNoMessage (-ErrorAction Stopp)' = @("Cannot bind parameter 'ErrorAction'. Cannot convert value `"Stopp`" to type `"System.Management.Automation.ActionPreference`". Error: `"Unable to match the identifier name Stopp to a valid enumerator name.`"", 'CannotConvertArgumentNoMessage')
  'CannotConvertArgument (-Verbose:0)'                 = @("Cannot convert 'System.String' to the type 'System.Management.Automation.SwitchParameter' required by parameter 'Verbose'.", 'CannotConvertArgument')
  'ParameterBindingFailed (-ErrorAction Suspend)'      = @("Cannot bind parameter 'ErrorAction' to the target. Exception setting `"ErrorAction`": `"The Suspend value is not supported for the ErrorAction parameter.`"", 'ParameterBindingFailed')
}
foreach ($c in $bad.Keys) {
  $msg = $bad[$c][0]; $id = $bad[$c][1]
  Check (Counts ($p51 + $msg)) "counts, 5.1 message line: $c"
  Check (Counts ('    + FullyQualifiedErrorId : ' + $id + ',dc-gemini-review.ps1')) "counts, 5.1 error ID line: $c"
  Check (Counts ($e + '[31;1m' + $e + '[31;1m' + $e + '[31;1m+ FullyQualifiedErrorId : ' + $id + ',dc-gemini-review.ps1' + $e + '[0m' + $e + '[0m')) "counts, NormalView with colour codes: $c"
  Check (Counts ($e + '[31;1m' + $e + '[31;1mdc-gemini-review.ps1: ' + $e + '[31;1m' + $msg + $e + '[0m' + $e + '[0m')) "counts, pwsh 7 line: $c"
  Check (Counts ('/home/u/trimurti-dc/kit-scripts/ops/network/scripts/dc-gemini-review.ps1 : ' + $msg)) "counts, path with slashes: $c"
  # Not the target's own: a cmdlet inside it, another script, or a report line that quotes the error.
  Check (-not (Counts ('    + FullyQualifiedErrorId : ' + $id + ',Microsoft.PowerShell.Commands.GetChildItemCommand'))) "ignores a cmdlet's error ID: $c"
  Check (-not (Counts ('Get-ChildItem: ' + $msg))) "ignores a cmdlet's pwsh 7 line: $c"
  Check (-not (Counts ('dc-fix.ps1: ' + $msg))) "ignores another script: $c"
  Check (-not (Counts ('    - dc-gemini-review.ps1: ' + $msg))) "ignores an indented report line: $c"
  Check (-not (Counts ('- agy stderr: dc-gemini-review.ps1: ' + $msg))) "ignores a report line that quotes it: $c"
  Check (-not (Counts ('- note: C:\kit\dc-gemini-review.ps1 : ' + $msg))) "ignores a quoted path: $c"
  Check (-not (Counts ('xdc-gemini-review.ps1: ' + $msg))) "ignores a longer name: $c"
  Check (-not (Counts ('    params: + FullyQualifiedErrorId : ' + $id + ',dc-gemini-review.ps1'))) "ignores an ID inside a line: $c"
  Check (-not (Counts ('    + FullyQualifiedErrorId : ' + $id + ',dc-gemini-review.ps1.bak'))) "ignores another file's ID: $c"
  Check (-not (Counts $msg)) "ignores the bare message: $c"
}
foreach ($l in 'C:\Users\u\trimurti-dc\vm-review-latest.md', '', 'dc-gemini-review.ps1: done', '    + CategoryInfo          : InvalidArgument: (:) [dc-gemini-review.ps1], ParentContainsErrorRecordException',
  '    + FullyQualifiedErrorId : CommandNotFoundException,dc-gemini-review.ps1') {
  Check (-not (Counts $l)) "ignores: $l"
}
# The name is taken from -Script, so another target is matched by its own name.
$Script = 'dc-fix.ps1'
$a = @($ast.FindAll({ param($x) $x -is [System.Management.Automation.Language.AssignmentStatementAst] -and $x.Left.Extent.Text -in '$sn', '$bindRe' }, $true))
foreach ($x in $a) { Set-Variable -Name $x.Left.Extent.Text.TrimStart('$') -Value (& ([ScriptBlock]::Create($x.Right.Extent.Text))) }
Check (Counts '    + FullyQualifiedErrorId : NamedParameterNotFound,dc-fix.ps1') 'counts dc-fix.ps1 for -Script dc-fix.ps1'
Check (-not (Counts '    + FullyQualifiedErrorId : NamedParameterNotFound,dc-gemini-review.ps1')) 'ignores dc-gemini-review.ps1 for -Script dc-fix.ps1'

# The bootstrap's own switches: a refused one must still rewrite bootstrap-latest.md (exit 2), or the last run's log
# reads as this run's. Runs the bootstrap in an empty profile, where it stops at the clone search after its BEGIN line.
Check ($null -eq $ast.ParamBlock) 'dc-bootstrap.ps1 has no top-level param block (it would refuse before the log exists)'
$exe = (Get-Process -Id $PID).Path
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('dcboot-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$keep = @{ USERPROFILE = $env:USERPROFILE; ProgramFiles = $env:ProgramFiles }
$env:USERPROFILE = $tmp; if (-not $env:ProgramFiles) { $env:ProgramFiles = $tmp }
$blog = Join-Path $tmp 'trimurti-dc/bootstrap-latest.md'
$runs = [ordered]@{
  '-S dc-gemini-review.ps1 -Pr 31'                     = @(2, "refused: Parameter cannot be processed because the parameter name 'S' is ambiguous")
  '-Script dc-fix.ps1 -NoRemote -Script dc-fix.ps1'    = @(2, "refused: Cannot bind parameter because parameter 'Script' is specified more than once")
  '-Script dc-fix.ps1 -FromBranch'                     = @(2, "refused: Missing an argument for parameter 'FromBranch'")
  '-ScriptArgs'                                        = @(2, "refused: Missing an argument for parameter 'ScriptArgs'")
  '-Script dc-gemini-review.ps1 -Pr 31 -Via agy'       = @(2, 'script=dc-gemini-review.ps1 args=-Pr 31 -Via agy branch=claude/eloquent-wright-woxv2e')
  'dc-diagnose.ps1 -FromBranch claude/b'               = @(2, 'script=dc-diagnose.ps1 args= branch=claude/b')
  '-From claude/b -ScriptArgs:-NoScan -Script dc-fix.ps1 -Kit:k' = @(2, 'script=dc-fix.ps1 args=-NoScan -Kit k branch=claude/b')
  # A passed-on -Name:value arrives as -Name value, so a bare word after either binds alike; never as the branch.
  '-Kit:C:\k dc-diagnose.ps1'                          = @(2, 'script=dc-diagnose.ps1 args=-Kit C:\k branch=claude/eloquent-wright-woxv2e')
  '-Kit C:\k dc-diagnose.ps1'                          = @(2, 'script=dc-diagnose.ps1 args=-Kit C:\k branch=claude/eloquent-wright-woxv2e')
  '-Script dc-fix.ps1 -Kit:k extra claude/b'           = @(2, "refused: 'claude/b' was read as -FromBranch by its position")
  '-Script dc-fix.ps1 -Kit k extra claude/b'           = @(2, "refused: 'claude/b' was read as -FromBranch by its position")
  '-f claude/b -Script dc-fix.ps1 -Kit:k'              = @(2, 'script=dc-fix.ps1 args=-Kit k branch=claude/b')
}
try {
  foreach ($r in $runs.Keys) {
    if (Test-Path -LiteralPath $blog) { Remove-Item -LiteralPath $blog -Force }
    $null = & $exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $boot @($r -split ' ') 2>&1
    $rc = $LASTEXITCODE
    $txt = if (Test-Path -LiteralPath $blog) { [IO.File]::ReadAllText($blog) } else { '' }
    Check ($rc -eq $runs[$r][0]) "bootstrap $r exits $($runs[$r][0]) (got $rc)"
    Check ($txt.StartsWith('# DC-BOOT BEGIN ') -and $txt.Contains($runs[$r][1]) -and $txt.TrimEnd().EndsWith('# DC-BOOT END failed')) "bootstrap $r logs '$($runs[$r][1])'"
  }
} finally {
  $env:USERPROFILE = $keep.USERPROFILE; $env:ProgramFiles = $keep.ProgramFiles
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "$cases cases, $fails failures"
if ($fails) { exit 1 }
