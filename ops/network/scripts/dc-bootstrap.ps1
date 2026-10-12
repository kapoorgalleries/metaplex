# dc-bootstrap.ps1: the small script that travels inside a Desktop Commander command (dc-pack.py) when the real
# one is too big for Windows' command line. It fetches one branch of kapoorgalleries/metaplex through a clone
# that already exists on the PC (fetch + `git archive`, never a checkout), unpacks ops/network/scripts into
# %USERPROFILE%\trimurti-dc\kit-scripts and runs the named script there. Progress goes to trimurti-dc\bootstrap-
# latest.md, so a failed hand-over is readable too. Windows PowerShell 5.1 is enough.
#   -Script dc-fix.ps1            which script to run
#   -ScriptArgs:"-X -Y"           its arguments (use the colon form, so a leading dash is not read as a parameter)
#   -Branch claude/...            the branch to take the scripts from
param([string]$Script = 'dc-fix.ps1', [string]$ScriptArgs = '', [string]$Branch = 'claude/eloquent-wright-woxv2e')
$ErrorActionPreference = 'Continue'
$env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
$H = $env:USERPROFILE
$dir = Join-Path $H 'trimurti-dc'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$log = Join-Path $dir 'bootstrap-latest.md'
$L = New-Object System.Collections.Generic.List[string]
function W([string]$s) { $script:L.Add($s); [IO.File]::WriteAllText($script:log, (($script:L -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false)) }
W ("# DC-BOOT BEGIN {0} {1} script={2} args={3} branch={4}" -f [Environment]::MachineName, (Get-Date -Format o), $Script, $ScriptArgs, $Branch)
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
W "- fetch exit $LASTEXITCODE; branch head $(& git -C $clone rev-parse --short $ref 2>$null)"
$zip = Join-Path $dir 'kit-scripts.zip'; $dst = Join-Path $dir 'kit-scripts'
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
& git -C $clone archive --format=zip -o $zip $ref ops/network/scripts 2>&1 | ForEach-Object { W ('    ' + $_) }
W "- archive exit $LASTEXITCODE"
if (-not (Test-Path -LiteralPath $zip)) { W '# DC-BOOT END failed'; exit 2 }
if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force -ErrorAction SilentlyContinue }
Expand-Archive -LiteralPath $zip -DestinationPath $dst -Force
$target = Join-Path $dst ('ops\network\scripts\' + $Script)
W ("- script: {0} ({1})" -f $target, $(if (Test-Path -LiteralPath $target) { 'present' } else { 'MISSING' }))
if (-not (Test-Path -LiteralPath $target)) { W '# DC-BOOT END failed'; exit 2 }
W '# DC-BOOT END handing over'
$argv = @($ScriptArgs -split '\s+' | Where-Object { $_ })
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $target @argv
exit $LASTEXITCODE
