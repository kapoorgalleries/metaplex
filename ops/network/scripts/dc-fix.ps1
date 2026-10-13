# dc-fix.ps1: the unattended "fix and update" run for one Windows machine in the Trimurti job, through Desktop
# Commander (no terminal; start_process returns after 3 s, so the result is the report file). One run: rebuild
# PATH; git fetch + log in the kit clone (never a checkout); compare the kg-permission-gates copies (and copy the
# newest over the others with -SyncPermissionGates, backups first); the kit's read-only netscan.ps1;
# bootstrap-ai-clis.ps1 when a CLI is missing; the kit's update-all.ps1 without the ASK flags; on the admin
# machine verify.sh and run-remote.sh --os windows update-all through Git Bash; the version and sign-in checks
# again. Not elevated, update-all.ps1 gets -NoOS (the CLIs only) and winget only lists the pending app
# upgrades: a machine-wide installer waits on a UAC prompt that nobody answers, and an open app makes its own
# installer wait. The report %USERPROFILE%\trimurti-dc\<host>-fix-latest.md is rewritten after every step and
# before every long command; the END line comes last, after a FATAL too, and a stamped copy is written then.
# Never reboots, never passes an ASK flag, never touches inventory.csv or status.md, never the router.
# Secrets: names only, never a value; every line of external output passes through Scrub. Every long-running
# command runs with stdin closed and a timeout. winget upgrade --all may replace the app that runs Desktop
# Commander; the run and the report survive that. Windows PowerShell 5.1 is enough. An unknown switch is an
# error (no -h): nothing runs.
#   -Kit <ops\network path>   default: %USERPROFILE%\trimurti-network\ops\network, then any clone with scripts\verify.sh
#   -SkipWinget, -SkipWindowsUpdate   update-all.ps1 then gets -NoOS (it cannot skip one of the two alone); winget
#                                     still upgrades here unless -SkipWinget, and only when elevated
#   -NoRemote                 admin machine: verify.sh only, no run-remote.sh to the other PCs
#   -SyncPermissionGates      copy the highest-version kg-permission-gates folder over the stale copies (each
#                             backed up first under trimurti-dc\backup-<stamp>); without it the copies are only compared
#   -NoScan                   skip the kit's read-only netscan.ps1 LAN sweep
# A PR review is a separate run: dc-gemini-review.ps1 (through dc-bootstrap.ps1).
# Order: PATH, kit fetch, kg-permission-gates, netscan, then the long steps (bootstrap, update-all, verify,
# run-remote) and the final checks, so the report has the quick results early.
[CmdletBinding()]
param([string]$Kit = '', [switch]$SkipWinget, [switch]$SkipWindowsUpdate, [switch]$NoRemote, [switch]$SyncPermissionGates, [switch]$NoScan)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$t0 = Get-Date
$env:CI = '1'; $env:NO_COLOR = '1'; $env:TERM = 'dumb'; $env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
$env:PYTHONUTF8 = '1'; $env:PYTHONIOENCODING = 'utf-8'; $env:HF_HUB_DISABLE_UPDATE_CHECK = '1'
# Unlike dc-diagnose, DISABLE_AUTOUPDATER stays unset here: `claude update` is one of the steps.
$H = $env:USERPROFILE
# Tools installed after the Desktop Commander app started are not on its PATH: rebuild it from the
# registry-backed Machine and User values plus the folders the kit's bootstrap and per-user Node use.
$extra = @((Join-Path $H '.local\bin'), (Join-Path $env:APPDATA 'npm'), (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'), (Join-Path $env:ProgramFiles 'Git\cmd'), (Join-Path $env:ProgramFiles 'nodejs'),
  (Join-Path $env:LOCALAPPDATA 'Programs\nodejs'), (Join-Path $env:APPDATA 'nvm'), (Join-Path $env:LOCALAPPDATA 'nodejs'), (Join-Path $env:LOCALAPPDATA 'Volta\bin'))
$env:Path = (@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path) + $extra) -join ';'
$dir = Join-Path $H 'trimurti-dc'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$me = [Environment]::MachineName   # $env:COMPUTERNAME and $env:ComSpec are empty in Desktop Commander's process
$cmdExe = Join-Path ([Environment]::SystemDirectory) 'cmd.exe'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $dir "$me-fix-$stamp.md"
$latest = Join-Path $dir "$me-fix-latest.md"
$utf8 = New-Object Text.UTF8Encoding $false
$L = New-Object System.Collections.Generic.List[string]
function W([string]$s) { $script:L.Add($s) }
function Flush() { [IO.File]::WriteAllText($script:latest, (($script:L -join "`r`n") + "`r`n"), $script:utf8) }
function Sec([string]$t) { W ''; W "## $t"; Flush }
# Scrub runs on every line of external content (command output, file dumps, the verdict JSON): bearer and other
# Authorization values, values after token/key/secret/password/auth switches and NAME=/Header:/"json_key": pairs,
# secret-looking URL query values, URL passwords and token-shaped strings are masked. Quotes, \" and \u0027 end a
# value and a value that opens an object or array is left alone, so scrubbed JSON stays JSON. Not secrets:
# `passed=` (run-remote.sh's TRIMURTI_SUMMARY line) and claude auth status's authMethod / apiKeySource, which name
# the kind of sign-in (they show when a PC bills an API key). The same function is in dc-diagnose.ps1, dc-fix.ps1
# and dc-gemini-review.ps1; test/dc-scrub.ps1 keeps them identical.
function Scrub([string]$s) {
  $s = $s -replace '(?i)\b(Bearer)\s+(?:[^\s"''\\]|\\[^\s"''u])+', '$1 ***'
  $s = $s -replace '(?i)\b((?:proxy-)?authorization["'']?\s*[:=]\s*["'']?)[A-Za-z]+\s+(?:[^\s"''\\]|\\[^\s"''u])+', '$1***'
  $s = $s -replace '(?i)(--?[\w-]*(token|key|secret|password|passwd|pass|auth|bearer|credential)[\w-]*)([=\s]+)(\\?["'']|\\u0027)?(?:[^\s"''\\]|\\[^\s"''u])+', '$1$3$4***'
  $s = $s -replace '(?i)\b(?!(?:passed|authMethod|apiKeySource)\b)([\w-]*(token|key|secret|password|passwd|pass|auth|bearer|credential)[\w-]*)(\\?["'']|\\u0027)?\s*([=:])\s*(?!(?:true|false|yes|no|null|none|\d+)\b)((?:\\?["'']|\\u0027){0,2})(?![{\[])(?:[^\s"''\\]|\\[^\s"''u])+', '$1$3$4$5***'
  $s = $s -replace '(?i)([?&][^=&\s"\\]*(token|key|secret|sig|code|auth|pass)[^=&\s"\\]*=)[^&\s"\\]+', '$1***'
  $s = $s -replace '(://[^/@\s:"\\]+:)[^@\s"\\]+@', '$1***@'
  $s -replace '(?i)\b(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|sbp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[abprs]-[A-Za-z0-9-]+|AKIA[0-9A-Z]{16}|glpat-[\w-]{20,}|npm_[A-Za-z0-9]{30,}|ya29\.[\w.-]+|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})\b', '***'
}
function Clip([string]$s, [int]$n = 220) { $s = Scrub $s; if ($s.Length -gt $n) { $s.Substring(0, $n) + ' ...' } else { $s } }
function Lines($text, [int]$max = 14) {
  $ls = @(([string]$text) -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
  foreach ($l in ($ls | Select-Object -First $max)) { W ('    ' + (Clip $l)) }
  if ($ls.Count -gt $max) { W ("    ... {0} more lines" -f ($ls.Count - $max)) }
}
# Run a command line through cmd.exe (so .cmd and .exe shims resolve as in a user's shell), stdin closed,
# output to a file under the report folder, the whole tree killed when it outlives the timeout.
function Run([string]$label, [string]$cmd, [int]$sec = 45) {
  $tf = Join-Path $script:dir ('run-' + [IO.Path]::GetRandomFileName() + '.tmp')
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $script:cmdExe; $psi.Arguments = ('/d /s /c "{0} > "{1}" 2>&1 <nul"' -f $cmd, $tf)
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardInput = $true
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $to = $false; $code = 'n/a'; $o = ''; $ok = $true
  try {
    try {
      $p = [Diagnostics.Process]::Start($psi); $p.StandardInput.Close()
      if (-not $p.WaitForExit($sec * 1000)) { $to = $true; & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null }
      else { $code = $p.ExitCode }
    } catch { $ok = $false; W ("- **{0}**: could not start: {1}" -f $label, (Clip $_.Exception.Message)) }
    $sw.Stop()
    if (Test-Path -LiteralPath $tf) { $o = Get-Content -LiteralPath $tf -Raw -Encoding UTF8 -ErrorAction SilentlyContinue }
  } finally {
    foreach ($i in 1..3) { if (Test-Path -LiteralPath $tf) { Remove-Item -LiteralPath $tf -Force -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $tf) { Start-Sleep -Milliseconds 300 } } }
  }
  if (-not $ok) { return }
  $flag = ''; if ($to) { $flag = ', TIMEOUT after ' + $sec + 's' }
  W ('- **{0}** `{1}` (exit {2}, {3:n1}s{4})' -f $label, $cmd, $code, $sw.Elapsed.TotalSeconds, $flag)
  if ([string]::IsNullOrWhiteSpace($o)) { W '    (no output)' } else { Lines $o }
}
function Has([string]$p) { if (Test-Path -LiteralPath $p) { 'yes' } else { 'no' } }
function Where1([string]$n) { $c = Get-Command $n -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.Source } else { '-' } }
function Plain($text) { ([string]$text) -replace '\x1b\[[0-9;?]*[A-Za-z]', '' }   # Git Bash colour codes
function Tail($text, [int]$max = 25) {
  $ls = @((Plain $text) -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
  if ($ls.Count -gt $max) { W ("    ... {0} earlier lines not shown" -f ($ls.Count - $max)) }
  foreach ($l in ($ls | Select-Object -Last $max)) { W ('    ' + (Clip $l)) }
}
function Marks($text, [string]$pattern, [int]$max = 40) { @((Plain $text) -split "`r?`n" | Where-Object { $_ -match $pattern } | Select-Object -First $max | ForEach-Object { $_.Trim() }) }
function Markers($r, [string]$pattern, [string]$none) {
  if (-not $r.Started) { return }
  $mk = Marks $r.Out $pattern
  W '- markers:'; if ($mk.Count) { foreach ($m in $mk) { W ('    ' + (Clip $m)) } } else { W ('    ' + $none) }
}
# Run's engine for the long steps: same launch, output file and kill, but the report is flushed before the
# command starts, the output comes back (Out, Code, Timeout, Started) and the LAST lines are shown.
function Exec([string]$label, [string]$cmd, [int]$sec = 600, [int]$tail = 25) {
  Flush
  $tf = Join-Path $script:dir ('run-' + [IO.Path]::GetRandomFileName() + '.tmp')
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $script:cmdExe; $psi.Arguments = ('/d /s /c "{0} > "{1}" 2>&1 <nul"' -f $cmd, $tf)
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardInput = $true
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = @{ Out = ''; Code = 'n/a'; Timeout = $false; Started = $true }
  try {
    try {
      $p = [Diagnostics.Process]::Start($psi); $p.StandardInput.Close()
      if (-not $p.WaitForExit($sec * 1000)) { $r.Timeout = $true; & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null }
      else { $r.Code = $p.ExitCode }
    } catch { $r.Started = $false; W ("- **{0}**: could not start: {1}" -f $label, (Clip $_.Exception.Message)) }
    $sw.Stop()
    if (Test-Path -LiteralPath $tf) { $r.Out = [string](Get-Content -LiteralPath $tf -Raw -Encoding UTF8 -ErrorAction SilentlyContinue) }
  } finally {
    foreach ($i in 1..3) { if (Test-Path -LiteralPath $tf) { Remove-Item -LiteralPath $tf -Force -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $tf) { Start-Sleep -Milliseconds 300 } } }
  }
  if (-not $r.Started) { Flush; return $r }
  $flag = ''; if ($r.Timeout) { $flag = ', TIMEOUT after ' + $sec + 's, killed with its children' }
  W ('- **{0}** `{1}` (exit {2}, {3:n1}s{4})' -f $label, (Clip $cmd 200), $r.Code, $sw.Elapsed.TotalSeconds, $flag)
  if ([string]::IsNullOrWhiteSpace($r.Out)) { W '    (no output)' } else { Tail $r.Out $tail }
  Flush
  return $r
}
$sum = New-Object System.Collections.Generic.List[string]
# The kit's own update and bootstrap scripts: the copy dc-bootstrap.ps1 unpacked beside this one (fresh from
# the branch) when there is one, else the kit clone's, which may be behind (it is never pulled here).
function KitScript([string]$n) {
  $f = Join-Path $PSScriptRoot $n
  if ($PSScriptRoot -and (Test-Path -LiteralPath $f)) { return $f }
  Join-Path $script:kitDir ('scripts\' + $n)
}
function Note([string]$s) { $script:sum.Add($s) }

W ("# DC-FIX BEGIN {0} {1} ({2})" -f $me, $stamp, (Get-Date -Format o))
W "report: $out"
W ("flags: Kit={0} SkipWinget={1} SkipWindowsUpdate={2} NoRemote={3}" -f $(if ($Kit) { $Kit } else { '(auto)' }), [bool]$SkipWinget, [bool]$SkipWindowsUpdate, [bool]$NoRemote)
Flush
try {

Sec '1. PATH rebuilt (Machine + User + the kit''s folders)'
W ("- {0} PATH entries" -f @($env:Path -split ';' | Where-Object { $_ }).Count)
foreach ($n in 'claude', 'codex', 'gemini.cmd', 'agy', 'hf', 'node', 'npm', 'git', 'winget', 'python', 'bash') { W ("- {0}: {1}" -f $n, (Where1 $n)) }
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$elev = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
W ("- running as {0}; elevated token: {1}; PowerShell {2}; arch {3}" -f $id.Name, $elev, $PSVersionTable.PSVersion, $env:PROCESSOR_ARCHITECTURE)
$missing = @(foreach ($n in 'claude', 'codex', 'gemini.cmd', 'agy', 'hf') { if ((Where1 $n) -eq '-') { $n } })
W ("- CLIs missing before the run: {0}" -f $(if ($missing.Count) { $missing -join ', ' } else { 'none' }))

Sec '2. Kit clone: git fetch and log only (no checkout; inventory.csv and status.md untouched)'
$kitDir = $null
if ($Kit) {
  if (Test-Path -LiteralPath (Join-Path $Kit 'scripts\verify.sh')) { $kitDir = (Resolve-Path -LiteralPath $Kit).Path } else { W "- -Kit $Kit has no scripts\verify.sh: ignored, auto-detecting" }
}
if (-not $kitDir) {
  $cands = @((Join-Path $H 'trimurti-network'))
  foreach ($r in @($H, (Join-Path $H 'Documents'), (Join-Path $H 'source'), (Join-Path $H 'source\repos'), (Join-Path $H 'src'), (Join-Path $H 'dev'), (Join-Path $H 'Desktop'), (Join-Path $H 'Projects'), 'C:\src', 'C:\dev', 'C:\code', 'C:\repos', 'C:\Projects')) {
    if (Test-Path -LiteralPath $r) { $cands += @(Get-ChildItem -LiteralPath $r -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
  }
  foreach ($c in $cands) { if ((Test-Path -LiteralPath (Join-Path $c 'ops\network\scripts\verify.sh')) -and (Test-Path -LiteralPath (Join-Path $c '.git'))) { $kitDir = Join-Path $c 'ops\network'; break } }
}
if (-not $kitDir) { W '- no kit clone found (-Kit, ~\trimurti-network, the usual code folders)'; Note 'no kit clone: minimal updates only; nothing verified or pushed' }
elseif ((Where1 'git') -eq '-') { W "- kit: $kitDir, but git is not on PATH: no fetch" }
else {
  W "- kit: $kitDir"
  $br = "$(& git -C $kitDir rev-parse --abbrev-ref HEAD 2>$null)".Trim()
  $url = "$(& git -C $kitDir remote get-url origin 2>$null)".Trim() -replace '^([A-Za-z][A-Za-z0-9+.-]*://)[^/@]+@', '$1'
  W ("- origin {0}; branch {1} @ {2}" -f (Clip $url 90), $br, "$(& git -C $kitDir rev-parse --short HEAD 2>$null)".Trim())
  $skip = @(& git -C $kitDir ls-files -v -- inventory.csv status.md 2>$null | Where-Object { $_ -match '^[Ss] ' } | ForEach-Object { $_.Substring(2) })
  W ("- {0} changed file(s); skip-worktree: {1}" -f @(& git --no-optional-locks -C $kitDir -c core.fsmonitor=false -c core.untrackedCache=false status --porcelain 2>$null).Count, $(if ($skip.Count) { $skip -join ' ' } else { 'none' }))
  $kf = Exec 'git fetch' ('git -C "{0}" fetch origin' -f $kitDir) 180 8
  if ($kf.Started -and $kf.Code -ne 0) { Note ("kit: git fetch failed (exit {0}); the behind count is from the last good fetch" -f $kf.Code) }
  if ($br -and $br -ne 'HEAD') {
    $rem = "$(& git -C $kitDir log -1 --format=%h origin/$br 2>$null)".Trim(); $behind = "$(& git -C $kitDir rev-list --count HEAD..origin/$br 2>$null)".Trim()
    W ('- origin/{0} at {1}; this clone is {2} commit(s) behind (no checkout here)' -f $br, $(if ($rem) { $rem } else { '? (fetch failed or branch gone)' }), $(if ($behind) { $behind } else { '?' }))
    if ($behind -and $behind -ne '0') { Note "kit clone is $behind commit(s) behind origin/$br (not pulled)" }
  } else { W '- detached HEAD: no branch to compare with origin' }
}

Sec '5. kg-permission-gates copies (compared; copied over only with -SyncPermissionGates)'
$pg = @()
foreach ($b in (Join-Path $H '.claude\skills'), (Join-Path $H '.agents\skills'), (Join-Path $H '.codex\skills'), (Join-Path $H '.gemini\skills'), (Join-Path $H '.claude\plugins')) {
  if (-not (Test-Path -LiteralPath $b)) { continue }
  foreach ($d in @(Get-ChildItem -LiteralPath $b -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*permission-gates*' })) {
    $sk = Join-Path $d.FullName 'SKILL.md'; $hash = '(no SKILL.md)'; $ver = '?'; $lw = $d.LastWriteTime
    if (Test-Path -LiteralPath $sk) {
      $hash = (Get-FileHash -LiteralPath $sk -Algorithm SHA256).Hash.Substring(0, 16).ToLower(); $lw = (Get-Item -LiteralPath $sk).LastWriteTime
      $m = Select-String -LiteralPath $sk -Pattern '^\s*"?version"?\s*[:=]\s*"?([0-9][0-9A-Za-z.\-]*)' | Select-Object -First 1; if ($m) { $ver = $m.Matches[0].Groups[1].Value }
    }
    $files = @(Get-ChildItem -LiteralPath $d.FullName -Recurse -File -ErrorAction SilentlyContinue).Count
    $pg += New-Object PSObject -Property @{ Path = $d.FullName; Skill = $sk; Hash = $hash; Ver = $ver; Time = $lw; Files = $files }
    W ("- {0}: SKILL.md sha256 {1}, version {2}, {3} files, link {4}, modified {5}" -f $d.FullName, $hash, $ver, $files, $(if ($d.LinkType) { $d.LinkType } else { 'copy' }), $lw)
  }
}
if ($pg.Count -eq 0) { W '- none found under ~\.claude\skills, ~\.agents\skills, ~\.codex\skills, ~\.gemini\skills, ~\.claude\plugins' }
elseif (@($pg | ForEach-Object { $_.Hash } | Select-Object -Unique).Count -le 1) { W ("- all {0} copies identical (same SKILL.md hash)" -f $pg.Count) }
else {
  # The copy with the highest version wins (LastWriteTime breaks a tie); Sanjay said v1.1.0 was synced everywhere.
  function VerNum([string]$v) { try { [Version]($v -replace '[^0-9.].*$', '') } catch { [Version]'0.0' } }
  $new = $pg | Sort-Object @{ Expression = { VerNum $_.Ver }; Descending = $true }, @{ Expression = 'Time'; Descending = $true } | Select-Object -First 1
  $stale = @($pg | Where-Object { $_.Path -ne $new.Path -and $_.Hash -ne $new.Hash })
  if ($SyncPermissionGates) {
    $bk = Join-Path $script:dir "backup-$stamp"
    W ("- COPIES DIFFER; syncing from {0} (version {1}, {2}) to {3} stale cop(y/ies); originals backed up under {4}" -f $new.Path, $new.Ver, $new.Time, $stale.Count, $bk)
    $n = 0
    foreach ($o in $stale) {
      $n++
      try {
        $dst = Join-Path $bk ("permission-gates-$n")
        New-Item -ItemType Directory -Force -Path $dst | Out-Null
        Copy-Item -LiteralPath $o.Path -Destination $dst -Recurse -Force
        Get-ChildItem -LiteralPath $new.Path -Force | Copy-Item -Destination $o.Path -Recurse -Force
        $h2 = (Get-FileHash -LiteralPath $o.Skill -Algorithm SHA256).Hash.Substring(0, 16).ToLower()
        W ("    {0}: was {1}, now SKILL.md sha256 {2} ({3})" -f $o.Path, $o.Hash, $h2, $(if ($h2 -eq $new.Hash) { 'matches' } else { 'STILL DIFFERS' }))
        if ($h2 -ne $new.Hash) { Note "kg-permission-gates: $($o.Path) still differs after the copy" }
      } catch { W ("    {0}: sync failed: {1}" -f $o.Path, (Clip $_.Exception.Message)); Note "kg-permission-gates: sync to $($o.Path) failed" }
    }
    Note ("kg-permission-gates: {0} cop(y/ies) synced to version {1} from {2}; backups in {3}" -f $stale.Count, $new.Ver, $new.Path, $bk)
  } else {
    W ("- COPIES DIFFER, nothing overwritten (no -SyncPermissionGates); highest version: {0} (version {1}, {2})" -f $new.Path, $new.Ver, $new.Time)
    Note ("kg-permission-gates: {0} copies differ, highest version at {1}; rerun with -SyncPermissionGates to sync" -f $pg.Count, $new.Path)
  }
  foreach ($o in $stale) {
    if (-not ((Test-Path -LiteralPath $o.Skill) -and (Test-Path -LiteralPath $new.Skill))) { W ("    vs {0}: no SKILL.md to compare" -f $o.Path); continue }
    try {
      $cmp = @(Compare-Object @(Get-Content -LiteralPath $new.Skill) @(Get-Content -LiteralPath $o.Skill))
      $a = @($cmp | Where-Object { $_.SideIndicator -eq '<=' }); $z = @($cmp | Where-Object { $_.SideIndicator -eq '=>' })
      W ("    vs {0} (version {1}, {2}): {3} line(s) only in the newest, {4} only here" -f $o.Path, $o.Ver, $o.Time, $a.Count, $z.Count)
      foreach ($l in ($a | Select-Object -First 4)) { W ('      + ' + (Clip $l.InputObject 120)) }
      foreach ($l in ($z | Select-Object -First 4)) { W ('      - ' + (Clip $l.InputObject 120)) }
    } catch { W ("    vs {0}: compare failed: {1}" -f $o.Path, (Clip $_.Exception.Message)) }
  }
}

Sec '6a. LAN sweep: netscan.ps1 (read-only; writes out\scan-<stamp>.csv in the kit)'
if (-not $kitDir) { W '- no kit: no netscan' }
elseif ($NoScan) { W '- skipped (-NoScan)' }
else {
  $ns = Exec 'netscan.ps1' ('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $kitDir 'scripts\netscan.ps1')) 600 12
  Markers $ns '^(adapter=|dns servers|.*DOUBLE NAT|single NAT|.*CGNAT|\d+ hosts answered|saved: )' '(no saved: line: the sweep did not finish)'
  $csv = Get-ChildItem -LiteralPath (Join-Path $kitDir 'out') -Filter 'scan-*.csv' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($csv -and $csv.LastWriteTime -gt $t0) { W "- $($csv.Name):"; Lines (Get-Content -LiteralPath $csv.FullName -Raw -Encoding UTF8) 60; Note "netscan: $($csv.Name) has the live hosts; inventory.csv is still the template" }
}

Sec '4. Missing CLIs: bootstrap-ai-clis.ps1'
if ($missing.Count -eq 0) { W '- nothing missing: bootstrap not run' }
elseif ($kitDir) {
  $bf = ''
  if (-not $elev) { $bf = ' -SkipNode'; W '- not elevated: -SkipNode (only the Node.js MSI needs elevation), no -WithGit; the elevated run is Sanjay''s: powershell -ExecutionPolicy Bypass -File scripts\bootstrap-ai-clis.ps1' }
  W '- idempotent; also registers the Hugging Face MCP server with Codex and Gemini; no -WithClaudeHfMcp'
  $b = Exec 'bootstrap-ai-clis.ps1' ('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"{1}' -f (KitScript 'bootstrap-ai-clis.ps1'), $bf) $(if ($elev) { 2400 } else { 900 }) 6
  Markers $b '^(==> |WARNING:|INSTALL (OK|INCOMPLETE)|\s{2}(node|claude|codex|gemini|hf)\s)' '(no INSTALL OK/INCOMPLETE line: the run did not finish)'
  if ($b.Started) { $mk = Marks $b.Out '^INSTALL (OK|INCOMPLETE)'; if ($mk.Count) { Note "bootstrap: $($mk[-1])" } else { Note 'bootstrap-ai-clis.ps1 did not finish' } }
} else {
  W ("- missing: {0}; nothing is installed without the kit. On this PC (elevated only for Node or Git):" -f ($missing -join ', '))
  W '    git clone --filter=blob:none --sparse -b claude/beautiful-turing-abqvwm https://github.com/kapoorgalleries/metaplex.git $HOME\trimurti-network'
  W '    git -C $HOME\trimurti-network sparse-checkout set ops/network reports'
  W '    powershell -ExecutionPolicy Bypass -File $HOME\trimurti-network\ops\network\scripts\bootstrap-ai-clis.ps1'
  Note ('CLIs missing and no kit: ' + ($missing -join ', '))
}

Sec '3. Updates: update-all.ps1 (no ASK flags; never a reboot)'
$wgArgs = 'upgrade --all --silent --include-unknown --accept-source-agreements --accept-package-agreements --disable-interactivity'
# Not elevated, app upgrades cannot finish unattended: machine-wide installers wait on UAC, and an app that is
# open (Antigravity on the gallery desktop, 2026-10-12) makes its own installer wait. Then the pending upgrades
# are listed for an elevated run with the apps closed, and nothing is upgraded.
function WingetAll {
  if ((Where1 'winget') -eq '-') { W '- winget not on PATH: app upgrades skipped'; return }
  if (-not $script:elev) {
    [void](Exec 'winget upgrades pending' 'winget upgrade --include-unknown --disable-interactivity --source winget' 120 30)
    W '- not elevated: winget upgrade --all not attempted'
    Note 'app upgrades need an elevated update-all.ps1 run with the apps closed (pending list in step 3)'
    return
  }
  $w = Exec 'winget upgrade --all' "winget $wgArgs" 2700 25
  if (-not $w.Started) { return }
  if ($w.Code -eq -1978335189) { W '    (0x8A15002B: nothing to upgrade)' }
  elseif ($w.Code -ne 0) { Note ('winget upgrade --all: exit ' + $w.Code + $(if ($w.Timeout) { ', killed at the time limit' } else { '' }) + ' (some upgrades may have failed; see step 3)') }
}
if ($kitDir) {
  $flags = ''; $secs = 3600; $why = @()
  if ($SkipWinget) { $why += '-SkipWinget' }; if ($SkipWindowsUpdate) { $why += '-SkipWindowsUpdate' }
  if ($why.Count) { $flags = ' -NoOS'; $secs = 1800; W ("- {0}: update-all.ps1 -NoOS (it cannot skip one of the two alone)" -f ($why -join ' and ')) }
  elseif (-not $elev) { $flags = ' -NoOS'; $secs = 1800; W '- not elevated: update-all.ps1 -NoOS (the CLIs only); app upgrades are only listed and Windows Update is not run' }
  $upd = Exec 'update-all.ps1' ('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"{1}' -f (KitScript 'update-all.ps1'), $flags) $secs 20
  Markers $upd '^(==> |WARNING:|UPDATE_FAILED=|REBOOT_REQUIRED=|\s{2}(claude|codex|gemini|hf|node)\s|\s+(not installed on purpose|->|\(files are queued))' '(no REBOOT_REQUIRED= line: the run did not finish)'
  if ($upd.Started) { $mk = Marks $upd.Out '^(UPDATE_FAILED=|REBOOT_REQUIRED=)'; if ($mk.Count) { foreach ($m in $mk) { Note "update-all: $m" } } else { Note 'update-all.ps1 did not finish (no REBOOT_REQUIRED= line)' } }
  if ($flags) {
    if (-not $SkipWinget) { WingetAll } else { W '- winget: skipped (-SkipWinget)' }
    W '- Windows Update: skipped (-NoOS)'
    if (-not $elev -and -not $SkipWindowsUpdate) { Note 'Windows Update needs an elevated update-all.ps1 run (not elevated here)' }
  }
} else {
  W '- no kit: minimal safe updates'
  # A failed update goes into the summary too, not only into its section.
  function ExecNote([string]$label, [string]$cmd, [int]$sec) { $r = Exec $label $cmd $sec 8; if ($r.Started -and $r.Code -ne 0) { Note ("{0}: exit {1}" -f $label, $r.Code) } }
  if ((Where1 'claude') -ne '-') { ExecNote 'claude update' 'claude update' 300 }
  $cx = Where1 'codex'
  if ($cx -ne '-') { if ($cx -match '\\npm\\') { ExecNote 'codex (npm)' 'npm install -g --no-fund --no-audit @openai/codex@latest' 600 } else { ExecNote 'codex update' 'codex update' 300 } }
  if ((Where1 'gemini.cmd') -ne '-' -and (Where1 'npm') -ne '-') { ExecNote 'gemini (npm)' 'npm install -g --no-fund --no-audit @google/gemini-cli@latest' 600 }
  if ((Where1 'hf') -ne '-') { ExecNote 'hf update' 'hf update' 600 }
  if ($SkipWinget) { W '- winget: skipped (-SkipWinget)' } else { WingetAll }
  W '- Windows Update: needs the kit''s update-all.ps1 (SYSTEM task); not run'
}

Sec '6. Admin machine only: verify.sh, then run-remote.sh --os windows update-all (Git Bash, never WSL)'
$isAdmin = $false; $rows = @(); $myIps = @(); $gw = @()
if (-not $kitDir) { W '- no kit: nothing to verify or push from here' }
else {
  $inv = Join-Path $kitDir 'inventory.csv'
  if (Test-Path -LiteralPath $inv) {
    $ls = @(Get-Content -LiteralPath $inv -Encoding UTF8 | ForEach-Object { "$_".Trim() } | Where-Object { $_ -and $_ -notmatch '^#' })
    $hi = -1; for ($i = 0; $i -lt $ls.Count; $i++) { if ($ls[$i] -match '^name,ip,mac,os,user,role,ssh_port,trimurti') { $hi = $i; break } }
    if ($hi -ge 0) { $rows = @($ls | Select-Object -Skip ($hi + 1) | ConvertFrom-Csv -Header name, ip, mac, os, user, role, ssh_port, trimurti, notes) }
  }
  $myIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddress })
  $gw = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | ForEach-Object { $_.IPv4DefaultGateway } | ForEach-Object { $_.NextHop })
  $adm = @($rows | Where-Object { "$($_.role)".Trim() -ieq 'admin' })
  $mine = @($adm | Where-Object { ("$($_.name)".Trim() -ieq $me) -or ($myIps -contains "$($_.ip)".Trim()) })
  $key = Join-Path $H '.ssh\id_ed25519_trimurti'
  if ($mine.Count) { $isAdmin = $true; $why = "admin row '$($mine[0].name)' matches this host's name or IP" }
  elseif ($adm.Count -and (Test-Path -LiteralPath $key) -and ($kitDir -ieq (Join-Path $H 'trimurti-network\ops\network'))) { $isAdmin = $true; $why = "admin row '$($adm[0].name)' has another name and ip, but the admin key and ~\trimurti-network are here" }
  elseif (-not $rows.Count) { $why = 'inventory.csv missing or without data rows' }
  elseif (-not $adm.Count) { $why = 'no row with role admin' }
  else { $why = "admin row '$($adm[0].name)' is another machine" }
  W ("- inventory: {0} row(s); this is the admin machine: {1} ({2}); admin key: {3}" -f $rows.Count, $isAdmin, $why, (Has $key))
}
if ($isAdmin) {
  $bash = $null
  foreach ($c in (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')) { if (Test-Path -LiteralPath $c) { $bash = $c; break } }
  if (-not $bash) { $g = Where1 'git'; if ($g -ne '-') { $c = Join-Path (Split-Path (Split-Path $g)) 'bin\bash.exe'; if (Test-Path -LiteralPath $c) { $bash = $c } } }
  if (-not $bash) { W '- Git Bash not found (Program Files\Git\bin\bash.exe): verify.sh and run-remote.sh need it'; Note 'no Git Bash on the admin machine: verify.sh and run-remote.sh not run' }
  else {
    W "- Git Bash: $bash; cwd $kitDir"
    $v = Exec 'verify.sh' ('cd /d "{0}" && "{1}" scripts/verify.sh' -f $kitDir, $bash) 600 40
    if ($v.Started) { $mk = Marks $v.Out '(not green|computers are green|saved: )'; foreach ($m in $mk) { Note "verify: $m" }; if (-not $mk.Count) { Note 'verify.sh did not finish' } }
    if ($NoRemote) { W '- run-remote.sh: skipped (-NoRemote)' }
    else {
      # Other Windows computers only: this machine updated itself in step 3; a router row or the gateway is never a target.
      $others = @($rows | Where-Object { ("$($_.os)".Trim() -ieq 'windows') -and (@('workstation', 'new') -contains "$($_.role)".Trim().ToLower()) -and "$($_.ssh_port)".Trim() -and ("$($_.name)".Trim() -ine $me) -and ($myIps -notcontains "$($_.ip)".Trim()) -and ($gw -notcontains "$($_.ip)".Trim()) -and ("$($_.name)".Trim() -match '^[A-Za-z0-9._-]+$') } | ForEach-Object { "$($_.name)".Trim() })
      if ($others.Count -eq 0) { W '- run-remote.sh: no other Windows computer (workstation or new) with an ssh_port; nothing to push' }
      else {
        $r = Exec ('run-remote.sh update-all -> ' + ($others -join ',')) ('cd /d "{0}" && "{1}" scripts/run-remote.sh --host {2} --os windows update-all' -f $kitDir, $bash, ($others -join ',')) 1800 30
        Markers $r '^(TRIMURTI_SUMMARY|.*(UPDATE_FAILED=|REBOOT_REQUIRED=|exit \d+|could not copy|skipped,|not in ))' '(no TRIMURTI_SUMMARY lines: the run did not finish)'
        if ($r.Started) {
          foreach ($m in (Marks $r.Out '^TRIMURTI_SUMMARY')) { Note $m }
          if ($r.Timeout) { W "    killed at 1800 s: each remote update-all keeps running on its host; logs in $kitDir\out\logs"; Note 'run-remote.sh hit the 1800 s limit; see out\logs' }
        }
      }
    }
  }
}

Sec '7. CLI versions and sign-in after the run'
Run 'node' 'node -v' 15
Run 'npm' 'npm -v' 30
Run 'git' 'git --version' 15
Run 'claude version' 'claude --version' 45
Run 'claude auth' 'claude auth status' 45
Run 'claude mcp' 'claude mcp list' 90
Run 'codex version' 'codex --version' 45
Run 'codex login' 'codex login status' 45
Run 'gemini version' 'gemini.cmd --version' 60
if ((Where1 'agy') -ne '-') { Run 'agy version' 'agy --version' 45 }
Run 'hf version' 'hf --version' 45
Run 'hf whoami' 'hf auth whoami' 45
Run 'winget version' 'winget --version' 30
Run 'winget upgrades left' 'winget upgrade --include-unknown --disable-interactivity --source winget' 120
$rb1 = Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
$rb2 = Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
W ("- reboot pending now: WindowsUpdate={0} CBS={1} (nothing here reboots)" -f $rb1, $rb2)
if ($rb1 -or $rb2) { Note 'Windows says a reboot is pending (not done)' }
$still = @(foreach ($n in 'claude', 'codex', 'gemini.cmd', 'agy', 'hf') { if ((Where1 $n) -eq '-') { $n } })
W ("- CLIs still missing: {0}" -f $(if ($still.Count) { $still -join ', ' } else { 'none' }))
if ($still.Count) { Note ('CLIs still missing: ' + ($still -join ', ')) }

} catch { W ('- FATAL: ' + (Clip $_.Exception.Message) + ' at line ' + $_.InvocationInfo.ScriptLineNumber); Note 'the run stopped early (FATAL above)' }
finally {
  Sec 'Summary for Sanjay'
  if ($sum.Count) { foreach ($s in $sum) { W ('- ' + (Clip $s)) } } else { W '- nothing to decide: every step finished without a marker' }
  W ''
  W ("# DC-FIX END {0} in {1:n0}s -> {2}" -f $me, ((Get-Date) - $t0).TotalSeconds, $out)
  Flush
  Copy-Item -LiteralPath $latest -Destination $out -Force
  Write-Output $latest
}
