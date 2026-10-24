# dc-bootstrap.ps1: the small script that travels inside a Desktop Commander command (dc-pack.py) when the real
# one is too big for Windows' command line. It fetches one branch of kapoorgalleries/metaplex through a clone
# that already exists on the PC (fetch + `git archive`, never a checkout), unpacks ops/network/scripts into
# %USERPROFILE%\trimurti-dc\kit-scripts and runs the named script there. Progress goes to trimurti-dc\bootstrap-
# latest.md, then the script's own output and exit code, so a failed hand-over is readable too. A failed fetch or archive stops it: an old copy of the branch
# never runs. kit-scripts is this script's own output, replaced on every run; nothing else is deleted. Windows
# PowerShell 5.1 is enough.
#   -Script dc-fix.ps1            which script to run
#   -FromBranch claude/...        the branch to take the scripts from
#   every other argument goes to that script as it is, e.g. dc-pack.py --args
#   "-Script dc-gemini-review.ps1 -Pr 31 -Branch claude/x -Head 2c9a38a -Via agy" (the target script rejects a
#   misspelt switch). -ScriptArgs:-X still works for a single argument.
# No param block: PowerShell refuses a bad switch before line 1 runs, and the last run's log would then read as
# this run's. The same param block binds below, after the log exists: a refused -Script, -ScriptArgs or -FromBranch
# (ambiguous, repeated, no value) is logged with PowerShell's own message and is exit 2. A passed-on -Name:value
# reaches it as -Name value, so a bare word after either binds alike; -FromBranch must be named, never a bare word.
$ErrorActionPreference = 'Continue'
$env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
$H = $env:USERPROFILE
$dir = Join-Path $H 'trimurti-dc'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$log = Join-Path $dir 'bootstrap-latest.md'
$L = New-Object System.Collections.Generic.List[string]
function W([string]$s) { $script:L.Add($s); [IO.File]::WriteAllText($script:log, (($script:L -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false)) }
try {
  $bound = & { param([string]$Script = 'dc-fix.ps1', [string]$ScriptArgs = '', [string]$FromBranch = 'claude/eloquent-wright-woxv2e')
    @{ Script = $Script; Branch = $FromBranch; HasBranch = $PSBoundParameters.ContainsKey('FromBranch'); Argv = @(@($ScriptArgs -split '\s+' | Where-Object { $_ }) + @($args | ForEach-Object { [string]$_ })) } } @args
  if ($bound.HasBranch -and -not @(@($args | ForEach-Object { [string]$_ }) -match '^[-\u2013-\u2015]f(r(o(m(b(r(a(n(ch?)?)?)?)?)?)?)?)?:?$').Count) {
    throw ("'{0}' was read as -FromBranch by its position (a bare word); name the branch with -FromBranch" -f $bound.Branch)
  }
} catch {
  W ("# DC-BOOT BEGIN {0} {1} args={2}" -f [Environment]::MachineName, (Get-Date -Format o), (@($args | ForEach-Object { [string]$_ }) -join ' '))
  W ('- refused: ' + $_.Exception.Message); W '# DC-BOOT END failed'; exit 2
}
$Script = $bound.Script; $Branch = $bound.Branch; $argv = @($bound.Argv)
W ("# DC-BOOT BEGIN {0} {1} script={2} args={3} branch={4}" -f [Environment]::MachineName, (Get-Date -Format o), $Script, ($argv -join ' '), $Branch)
$env:Path = (@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path, (Join-Path $env:ProgramFiles 'Git\cmd')) -join ';')
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { W '- git not found on PATH'; W '# DC-BOOT END failed'; exit 2 }
# A full clone first (~\metaplex), then the kit's sparse one, then anything under the profile with the right origin.
$clone = $null
foreach ($c in (@((Join-Path $H 'metaplex'), (Join-Path $H 'trimurti-network')) + @(Get-ChildItem -LiteralPath $H -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }))) {
  if (-not (Test-Path -LiteralPath (Join-Path $c '.git'))) { continue }
  if ("$(& git -C $c remote get-url origin 2>$null)" -match '(?i)kapoorgalleries/metaplex') { $clone = $c; break }
}
if (-not $clone) { W '- no clone of kapoorgalleries/metaplex under the profile'; W '# DC-BOOT END failed'; exit 2 }
W "- clone: $clone"
$ref = "refs/remotes/origin/$Branch"
& git -C $clone fetch --no-tags origin ("+refs/heads/{0}:{1}" -f $Branch, $ref) 2>&1 | ForEach-Object { W ('    ' + $_) }
$fx = $LASTEXITCODE   # read before the next git call below resets it
W "- fetch exit $fx; branch head $(& git -C $clone rev-parse --short $ref 2>$null)"
if ($fx -ne 0) { W '- fetch failed: not running the old copy of the branch'; W '# DC-BOOT END failed'; exit 2 }
$zip = Join-Path $dir 'kit-scripts.zip'; $dst = Join-Path $dir 'kit-scripts'
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
& git -C $clone archive --format=zip -o $zip $ref ops/network/scripts 2>&1 | ForEach-Object { W ('    ' + $_) }
$ax = $LASTEXITCODE
W "- archive exit $ax"
# git creates the -o file before it fails, so the exit code decides, not the file.
if ($ax -ne 0 -or -not (Test-Path -LiteralPath $zip)) { W '# DC-BOOT END failed'; exit 2 }
if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force -ErrorAction SilentlyContinue }
Expand-Archive -LiteralPath $zip -DestinationPath $dst -Force
$target = Join-Path $dst ('ops\network\scripts\' + $Script)
W ("- script: {0} ({1})" -f $target, $(if (Test-Path -LiteralPath $target) { 'present' } else { 'MISSING' }))
if (-not (Test-Path -LiteralPath $target)) { W '# DC-BOOT END failed'; exit 2 }
W '# DC-BOOT END handing over'
# The target's own output (a refused switch shows here) and its exit code go after that line, appended so the
# lines above stay as they are.
$u8 = New-Object Text.UTF8Encoding $false
# A refused argument stops the target before it writes anything, so its report and verdict files are an earlier
# run's: that is exit 2 (error) here, never the 1 a review would mean as request_changes. Only the target's own
# binding errors count, colour codes removed: 5.1's error ID line (+ FullyQualifiedErrorId : <id>,<script>) or a
# message line that starts with the script's name or path (pwsh 7: <script>: <message>). A cmdlet's error inside
# the target, or a report line that quotes one, does not.
$sn = [regex]::Escape($Script)
$bindRe = '^\s*\+\s*FullyQualifiedErrorId\s*:\s*(?:NamedParameterNotFound|AmbiguousParameter|ParameterAlreadyBound|MissingArgument|PositionalParameterNotFound|ParameterArgumentValidationError|ParameterArgumentTransformationError|CannotConvertArgument|CannotConvertArgumentNoMessage|ParameterBindingFailed),' + $sn + '\s*$|^(?:(?:[A-Za-z]:|[\\/])[^:]*[\\/])?' + $sn + ' ?: (?:A parameter cannot be found|Parameter cannot be processed because the parameter name|Cannot bind parameter|Cannot validate argument on parameter|Cannot process argument transformation on parameter|Cannot convert ''[^'']*'' to the type ''[^'']*'' required by parameter|Missing an argument for parameter|A positional parameter cannot be found)'
$bindErr = $false
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $target @argv 2>&1 | ForEach-Object {
  $s = [string]$_
  if (($s -replace '\x1b\[[0-9;]*m', '') -match $bindRe) { $bindErr = $true }
  [IO.File]::AppendAllText($log, ('    ' + $s + "`r`n"), $u8); $_
}
$rc = $LASTEXITCODE
if ($rc -ne 0 -and $bindErr) {
  [IO.File]::AppendAllText($log, ("- {0} refused its arguments and did not run: its report and verdict files are from an earlier run`r`n# DC-BOOT END failed`r`n" -f $Script), $u8)
  exit 2
}
[IO.File]::AppendAllText($log, ("- {0} exit {1} {2}`r`n" -f $Script, $rc, (Get-Date -Format o)), $u8)
exit $rc
