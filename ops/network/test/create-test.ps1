# Windows check of Add-GeminiHf's create path in bootstrap-ai-clis.ps1: Windows PowerShell 5.1 or PowerShell 7, no installers.
#
# Runs the script's own Add-GeminiHf, unmodified, with the real CreateNew and the protected owner-only DACL, in a fresh folder
# under %TEMP% (GEMINI_CLI_HOME per case; the user's own .gemini is never touched, and the run checks that). Write, Flush and
# Dispose failures are injected only by shadowing those FileStream methods with Update-TypeData: PowerShell resolves type-table
# members before .NET ones, so nothing in the function is rewritten, and each faulted case checks the fault hit the function's
# own stream. Contract: 0 created; 4 settings.json (or anything by that name) exists and is left untouched; 1 could not create,
# and nothing this run created is left behind (or a warning names the file to delete).
#
# Run: powershell -NoProfile -File ops\network\test\create-test.ps1 [-Script <bootstrap-ai-clis.ps1>] [-Work <new empty dir>]
# Exit 0 when every case passes. -SwapAcl replaces the Windows-ACL stream construction so the rest can be sanity-run with pwsh
# off Windows; it proves nothing about Windows.
param([string]$Script, [string]$Work, [switch]$SwapAcl)
$ErrorActionPreference = 'Stop'
# The 364 bytes bash and PowerShell both create (python3 ops/network/test/bootstrap-hf.py pins the bash side). Update with the entry.
$expectSha = '6a464dc2999712986b6ff6b7a44765fc85a387c65f2b1eaba5eebfc34367617c'
$onWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
function Sha([string]$p) { (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant() }
# GetAttributes reads the name itself, a dangling link included (as Add-GeminiHf's own check does).
function Test-Reparse([string]$p) { try { [bool]([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) } catch { $false } }

if (-not $Script) { $Script = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts') 'bootstrap-ai-clis.ps1' }
if (-not $Work) { $Work = Join-Path ([IO.Path]::GetTempPath()) ('kg-create-test-' + [guid]::NewGuid().ToString('N')) }
"host: PowerShell $($PSVersionTable.PSVersion) $($PSVersionTable.PSEdition) on $([Environment]::OSVersion.VersionString)"
"harness: $PSCommandPath sha256=$(Sha $PSCommandPath)"
"script: $Script sha256=$(Sha $Script) bytes=$((Get-Item -LiteralPath $Script).Length)"
if (Test-Path -LiteralPath $Work) { if (@(Get-ChildItem -Force -LiteralPath $Work).Count) { 'WORK DIR NOT EMPTY'; exit 7 } }
else { New-Item -ItemType Directory -Path $Work | Out-Null }
$Work = (Resolve-Path -LiteralPath $Work).ProviderPath
"work: $Work (left in place for inspection)"

$tok = $null; $errs = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Script, [ref]$tok, [ref]$errs)
"parse errors: $($errs.Count)"
if ($errs.Count) { $errs | ForEach-Object { $_.ToString() }; exit 9 }
$fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Add-GeminiHf' }, $true).Extent.Text
if ($SwapAcl) {
  $sw = [regex]::Replace($fn, '(?s)\$acl = New-Object Security\.AccessControl\.FileSecurity.*?\[IO\.FileOptions\]::None, \$acl\) \}',
    '$fs = New-Object IO.FileStream($cfg, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)')
  if ($sw -eq $fn) { 'SWAP FAILED'; exit 8 }
  $fn = $sw; 'NOTE: -SwapAcl: the Windows-ACL stream construction is replaced (sanity run only)'
}
. ([scriptblock]::Create($fn))
# $hfUrl and $hfDeny come from the script's own assignments.
foreach ($a in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and
      $n.Left -is [Management.Automation.Language.VariableExpressionAst] -and $n.Left.VariablePath.UserPath -in 'hfUrl', 'hfDeny' }, $true)) {
  . ([scriptblock]::Create($a.Extent.Text))
}
"hfUrl=$hfUrl hfDeny=$($hfDeny -join ',')"
if (Get-TypeData System.IO.FileStream) { 'FileStream already has type data here; the fault shadow would replace it'; exit 5 }

# The user's real Gemini settings must never be touched.
$real = if ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.gemini\settings.json' } else { Join-Path $HOME '.gemini/settings.json' }
$realBefore = if (Test-Path -LiteralPath $real) { "$(Sha $real) $((Get-Item -LiteralPath $real).LastWriteTimeUtc.Ticks)" } else { 'absent' }
$savedHome = $env:GEMINI_CLI_HOME

# Every shadowed call records the stream's path, so a case can show the fault hit the function's own file.
$global:CreateTestHits = New-Object System.Collections.ArrayList
function Clear-Fault { Remove-TypeData -TypeName System.IO.FileStream -ErrorAction SilentlyContinue }
function Set-Fault([string]$Mode) {
  Clear-Fault
  $full = { [void]$global:CreateTestHits.Add($this.Name); throw (New-Object IO.IOException 'There is not enough space on the disk. (injected)') }
  switch ($Mode) {
    'write' { Update-TypeData -TypeName System.IO.FileStream -MemberType ScriptMethod -MemberName Write -Value $full -Force }
    'partial' {
      # Half the bytes really go to the stream (the reflection call bypasses this shadow), then the disk is "full".
      Update-TypeData -TypeName System.IO.FileStream -MemberType ScriptMethod -MemberName Write -Force -Value {
        param($b, $o, $c)
        [void]$global:CreateTestHits.Add($this.Name)
        [void][IO.FileStream].GetMethod('Write', [type[]]@([byte[]], [int], [int])).Invoke($this, @($b, $o, [int][math]::Floor($c / 2)))
        throw (New-Object IO.IOException 'There is not enough space on the disk. (injected after a partial write)')
      }
    }
    'flush' { Update-TypeData -TypeName System.IO.FileStream -MemberType ScriptMethod -MemberName Flush -Value $full -Force }
    'flush-close' {
      # A full disk fails the flush and again the flush at close; the close still releases the handle.
      Update-TypeData -TypeName System.IO.FileStream -MemberType ScriptMethod -MemberName Flush -Value $full -Force
      Update-TypeData -TypeName System.IO.FileStream -MemberType ScriptMethod -MemberName Dispose -Force -Value {
        [void]$global:CreateTestHits.Add($this.Name)
        [void][IO.Stream].GetMethod('Dispose', [type[]]@()).Invoke($this, @())
        throw (New-Object IO.IOException 'There is not enough space on the disk. (injected at close)')
      }
    }
    'close' {
      # Write and flush succeed; dispose fails after really closing the stream.
      Update-TypeData -TypeName System.IO.FileStream -MemberType ScriptMethod -MemberName Dispose -Force -Value {
        [void]$global:CreateTestHits.Add($this.Name)
        [void][IO.Stream].GetMethod('Dispose', [type[]]@()).Invoke($this, @())
        throw (New-Object IO.IOException 'There is not enough space on the disk. (injected at close)')
      }
    }
    'write-undeletable' {
      # Read-only before the failure, so the cleanup's own delete fails too.
      Update-TypeData -TypeName System.IO.FileStream -MemberType ScriptMethod -MemberName Write -Force -Value {
        [void]$global:CreateTestHits.Add($this.Name)
        [IO.File]::SetAttributes($this.Name, [IO.FileAttributes]::ReadOnly)
        throw (New-Object IO.IOException 'There is not enough space on the disk. (injected)')
      }
    }
  }
}
# Proves the shadow is live: a plain FileStream must fail while a fault is set.
function Test-Fault([string]$Mode) {
  $p = Join-Path $Work ('probe-' + $Mode)
  $s = New-Object IO.FileStream($p, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $threw = $false
  try { $s.Write([byte[]](1, 2, 3, 4), 0, 4); $s.Flush($true) } catch { $threw = $true }
  try { $s.Dispose() } catch { $threw = $true }
  [IO.File]::SetAttributes($p, [IO.FileAttributes]::Normal); [IO.File]::Delete($p)
  $global:CreateTestHits.Clear()
  $threw
}

function Invoke-Case([string]$Name, [scriptblock]$Setup, [string]$Fault, [bool]$Race) {
  $h = Join-Path $Work $Name
  New-Item -ItemType Directory -Path $h | Out-Null
  $dir = Join-Path $h '.gemini'; $cfg = Join-Path $dir 'settings.json'
  $pre = $null
  if ($Setup) { $pre = & $Setup $dir $cfg }
  $env:GEMINI_CLI_HOME = $h
  if (-not $env:GEMINI_CLI_HOME.StartsWith($Work)) { 'GUARD: GEMINI_CLI_HOME outside the work dir'; exit 6 }
  $live = $null
  if ($Fault) { Set-Fault $Fault; $live = Test-Fault $Fault }
  $out = @()
  try {
    if ($Race) {
      $script:raceCfg = $cfg
      $out = @(& {
          # Shadows the cmdlet inside Add-GeminiHf (dynamic scope): the directory is made, then another writer creates settings.json.
          function New-Item { param($ItemType, [switch]$Force, $Path)
            Microsoft.PowerShell.Management\New-Item -ItemType $ItemType -Force:$Force -Path $Path
            [IO.File]::WriteAllText($script:raceCfg, "{`"racer`":true}`n") }
          Add-GeminiHf } 3>&1 6>&1)
    } else { $out = @(Add-GeminiHf 3>&1 6>&1) }
  } catch { $out += "UNCAUGHT: $($_.Exception.GetType().FullName): $($_.Exception.Message)" }
  finally { Clear-Fault; $env:GEMINI_CLI_HOME = $savedHome }
  $hits = @($global:CreateTestHits | Select-Object -Unique); $global:CreateTestHits.Clear()
  $warn = @($out | Where-Object { $_ -is [Management.Automation.WarningRecord] } | ForEach-Object { $_.Message })
  $info = (@($out | Where-Object { $_ -is [Management.Automation.InformationRecord] } | ForEach-Object { "$($_.MessageData)" }) -join "`n")
  $rest = @($out | Where-Object { $_ -isnot [Management.Automation.WarningRecord] -and $_ -isnot [Management.Automation.InformationRecord] })
  $rc = if ($rest.Count) { "$($rest[-1])" } else { '<none>' }
  $items = @(); $isDir = Test-Path -LiteralPath $dir -PathType Container
  if ($isDir) { $items = @(Get-ChildItem -Force -LiteralPath $dir | ForEach-Object { if ($_.PSIsContainer) { $_.Name + '/' } else { $_.Name + ':' + $_.Length } }) }
  [pscustomobject]@{ Name = $Name; Home = $h; Dir = $dir; Cfg = $cfg; Rc = $rc; Items = $items; Warn = $warn; Info = $info
    Extra = @($rest | Select-Object -SkipLast 1); FaultLive = $live; Pre = $pre; Hits = $hits; IsDir = $isDir }
}

$results = New-Object System.Collections.ArrayList
function Report($r, [string[]]$Fails, [string]$Detail) {
  $verdict = if ($Fails.Count) { 'FAIL' } else { 'PASS' }
  $line = "CASE {0,-22} rc={1} files={2} [{3}] {4}" -f $r.Name, $r.Rc, $r.Items.Count, ($r.Items -join ','), $verdict
  if ($r.FaultLive -ne $null) { $line += " fault-live=$($r.FaultLive) hit-own-file=$($r.Hits -contains $r.Cfg)" }
  $line
  if ($Detail) { "     $Detail" }
  foreach ($w in $r.Warn) { "     WARNING: $w" }
  foreach ($e in $r.Extra) { "     OUTPUT: $e" }
  foreach ($f in $Fails) { "     - $f" }
  [void]$results.Add($verdict)
}
function Get-AclSummary([string]$p) {
  if (-not $onWindows) { return 'n/a (not Windows)' }
  $a = Get-Acl -LiteralPath $p
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $rules = @($a.Access)
  $ok = $a.AreAccessRulesProtected -and $rules.Count -eq 1 -and
    $rules[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]) -eq $me -and
    $rules[0].FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl -and
    $rules[0].AccessControlType -eq 'Allow' -and -not $rules[0].IsInherited
  "protected=$($a.AreAccessRulesProtected) aces=$($rules.Count) " + (($rules | ForEach-Object { "$($_.IdentityReference):$($_.FileSystemRights):$($_.AccessControlType):inherited=$($_.IsInherited)" }) -join ' ') + " ok=$ok"
}
$mustBeOne = { param($r, $f) if ($r.Rc -ne '1') { $f.Add("expected rc 1 (could not create), got $($r.Rc)") } }
# A faulted case only counts if the fault hit the stream the function created (so the file existed, and rc 1 is the cleanup's).
$mustHitOwn = { param($r, $f)
  if ($r.FaultLive -ne $true) { $f.Add('fault injection was not live') }
  if (-not ($r.Hits -contains $r.Cfg)) { $f.Add("the fault never reached the function's own settings.json stream") }
  if (-not $r.IsDir) { $f.Add('.gemini was not created') } }

''
# 1. Nothing there: rc 0, the exact bytes, an owner-only protected DACL.
$r = Invoke-Case 'absent' $null $null $false
$f = New-Object System.Collections.Generic.List[string]
if ($r.Rc -ne '0') { $f.Add("expected rc 0, got $($r.Rc)") }
$d = ''
if (Test-Path -LiteralPath $r.Cfg -PathType Leaf) {
  $sha = Sha $r.Cfg; $d = "sha256=$sha bytes=$((Get-Item -LiteralPath $r.Cfg).Length) acl: $(Get-AclSummary $r.Cfg)"
  if ($sha -ne $expectSha) { $f.Add('bytes differ from the bash output') }
  if ($onWindows -and $d -notmatch 'ok=True') { $f.Add('DACL is not the protected owner-only one') }
} else { $f.Add('settings.json not created') }
if ($r.Items.Count -ne 1) { $f.Add('expected exactly settings.json in .gemini') }
if ($r.Warn.Count) { $f.Add('unexpected warning') }
Report $r $f $d

# 2. settings.json already there: rc 4, byte-identical, snippet printed.
$r = Invoke-Case 'existing-file' { param($dir, $cfg) New-Item -ItemType Directory -Path $dir | Out-Null; [IO.File]::WriteAllText($cfg, "{`"theme`":`"x`"}`n"); Sha $cfg } $null $false
$f = New-Object System.Collections.Generic.List[string]
if ($r.Rc -ne '4') { $f.Add("expected rc 4, got $($r.Rc)") }
if ((Sha $r.Cfg) -ne $r.Pre) { $f.Add('existing settings.json changed') }
if ($r.Info -notmatch '"huggingface": \{') { $f.Add('manual-step snippet not printed') }
if ($r.Items.Count -ne 1) { $f.Add('extra files in .gemini') }
Report $r $f "existing file byte-identical: $((Sha $r.Cfg) -eq $r.Pre)"

# 3. A directory named settings.json: rc 4, left alone.
$r = Invoke-Case 'existing-dir' { param($dir, $cfg) New-Item -ItemType Directory -Path $cfg | Out-Null } $null $false
$f = New-Object System.Collections.Generic.List[string]
if ($r.Rc -ne '4') { $f.Add("expected rc 4, got $($r.Rc)") }
if (-not (Test-Path -LiteralPath $r.Cfg -PathType Container)) { $f.Add('the settings.json directory was changed') }
if ($r.Info -notmatch '"huggingface": \{') { $f.Add('manual-step snippet not printed') }
Report $r $f $null

# 4. A read-only settings.json: rc 4, unchanged.
$r = Invoke-Case 'existing-readonly' { param($dir, $cfg) New-Item -ItemType Directory -Path $dir | Out-Null; [IO.File]::WriteAllText($cfg, "{}`n"); [IO.File]::SetAttributes($cfg, 'ReadOnly'); Sha $cfg } $null $false
$f = New-Object System.Collections.Generic.List[string]
if ($r.Rc -ne '4') { $f.Add("expected rc 4, got $($r.Rc)") }
if ((Sha $r.Cfg) -ne $r.Pre) { $f.Add('existing settings.json changed') }
if ($r.Info -notmatch '"huggingface": \{') { $f.Add('manual-step snippet not printed') }
Report $r $f $null
[IO.File]::SetAttributes($r.Cfg, 'Normal')

# 5. A dangling link named settings.json (Developer Mode or elevation needed on Windows): rc 4, link untouched.
$r = Invoke-Case 'dangling-link' { param($dir, $cfg)
  $ErrorActionPreference = 'Continue'
  New-Item -ItemType Directory -Path $dir | Out-Null
  if ($onWindows) { cmd /c mklink "$cfg" "$dir\missing-target.json" 2>$null | Out-Null } else { ln -s "$dir/missing-target.json" $cfg }
  if (Test-Reparse $cfg) { 'link' } else { 'nolink' } } $null $false
if ($r.Pre -eq 'nolink') { "CASE dangling-link          SKIP (could not create a symbolic link here)"; [void]$results.Add('SKIP') }
else {
  $f = New-Object System.Collections.Generic.List[string]
  if ($r.Rc -ne '4') { $f.Add("expected rc 4, got $($r.Rc)") }
  if (Test-Path -LiteralPath (Join-Path $r.Dir 'missing-target.json')) { $f.Add('a file was created through the link') }
  if (-not (Test-Reparse $r.Cfg)) { $f.Add('the link is gone or no longer a link') }
  if ($r.Info -notmatch '"huggingface": \{') { $f.Add('manual-step snippet not printed') }
  Report $r $f $null
}

# 6. .gemini is a file: rc 1, the file unchanged.
$r = Invoke-Case 'gemini-is-file' { param($dir, $cfg) [IO.File]::WriteAllText($dir, "not a directory`n"); Sha $dir } $null $false
$f = New-Object System.Collections.Generic.List[string]
& $mustBeOne $r $f
if (-not (Test-Path -LiteralPath $r.Dir -PathType Leaf) -or (Sha $r.Dir) -ne $r.Pre) { $f.Add('the .gemini file changed') }
Report $r $f $null

# 7. Another writer creates settings.json between the check and CreateNew: rc 4, the other file byte-identical.
$r = Invoke-Case 'race' $null $null $true
$f = New-Object System.Collections.Generic.List[string]
if ($r.Rc -ne '4') { $f.Add("expected rc 4, got $($r.Rc)") }
$racerText = "{`"racer`":true}`n"
$rs = if (Test-Path -LiteralPath $r.Cfg -PathType Leaf) { [IO.File]::ReadAllText($r.Cfg) } else { '<missing>' }
$intact = $rs -eq $racerText
if (-not $intact) { $f.Add("the other writer's file was changed: $rs") }
if ($r.Info -notmatch '"huggingface": \{') { $f.Add('manual-step snippet not printed') }
Report $r $f "racer's file intact: $intact"

# 8-12. Writing fails after CreateNew: rc 1 and an empty .gemini (before the fix: rc 4 and the broken file left).
foreach ($m in 'write', 'partial', 'flush', 'flush-close', 'close') {
  $r = Invoke-Case "fail-$m" $null $m $false
  $f = New-Object System.Collections.Generic.List[string]
  & $mustHitOwn $r $f
  & $mustBeOne $r $f
  if ($r.Items.Count) { $f.Add("leftover in .gemini: $($r.Items -join ',')") }
  if ($r.Warn.Count) { $f.Add('unexpected warning') }
  if ($r.Info -match 'already exists') { $f.Add('reported its own half-written file as existing settings') }
  Report $r $f $null
  if ($m -eq 'write') {
    # The next run starts clean and succeeds.
    $env:GEMINI_CLI_HOME = $r.Home
    $out2 = @()
    try {
      $out2 = @(Add-GeminiHf 3>&1 6>$null)
    } catch {
      $out2 += "UNCAUGHT: $($_.Exception.GetType().FullName): $($_.Exception.Message)"
    } finally {
      $env:GEMINI_CLI_HOME = $savedHome
    }
    $warn2 = @($out2 | Where-Object { $_ -is [Management.Automation.WarningRecord] } | ForEach-Object { $_.Message })
    $rest2 = @($out2 | Where-Object { $_ -isnot [Management.Automation.WarningRecord] })
    $rc2 = if ($rest2.Count) { "$($rest2[-1])" } else { '<none>' }
    $f2 = New-Object System.Collections.Generic.List[string]
    if ("$rc2" -ne '0') { $f2.Add("expected rc 0 on the rerun, got $rc2") }
    $d2 = ''
    if (Test-Path -LiteralPath $r.Cfg -PathType Leaf) {
      $s2 = Sha $r.Cfg; $d2 = "sha256=$s2 bytes=$((Get-Item -LiteralPath $r.Cfg).Length) acl: $(Get-AclSummary $r.Cfg)"
      if ($s2 -ne $expectSha) { $f2.Add('rerun bytes differ') }
      if ($onWindows -and $d2 -notmatch 'ok=True') { $f2.Add('DACL is not the protected owner-only one') }
    } else { $f2.Add('settings.json not created') }
    $r2 = [pscustomobject]@{ Name = 'fail-write-rerun'; Rc = "$rc2"; Items = @(Get-ChildItem -Force -LiteralPath $r.Dir | ForEach-Object { $_.Name + ':' + $_.Length }); Warn = $warn2; Extra = @(); FaultLive = $null }
    if ($r2.Warn.Count) { $f2.Add('unexpected warning') }
    Report $r2 $f2 $d2
  }
}

# 13. Writing fails and the cleanup's delete fails too: rc 1, a warning naming the file to delete.
# Windows only: a read-only attribute does not stop an unlink elsewhere.
if (-not $onWindows) { "CASE fail-write-undeletable SKIP (needs Windows read-only semantics)"; [void]$results.Add('SKIP') } else {
  $r = Invoke-Case 'fail-write-undeletable' $null 'write-undeletable' $false
  $f = New-Object System.Collections.Generic.List[string]
  & $mustHitOwn $r $f
  & $mustBeOne $r $f
  $want = "gemini: could not remove the partly written $($r.Cfg); delete it, then rerun"
  if (-not ($r.Warn -contains $want)) { $f.Add("missing warning: $want") }
  if ($r.Info -match 'already exists') { $f.Add('reported its own half-written file as existing settings') }
  Report $r $f $null
  if (Test-Path -LiteralPath $r.Cfg) { [IO.File]::SetAttributes($r.Cfg, 'Normal') }
}

# 14. settings.json stream is opened exclusively: concurrent open is refused while writing.
$script:openRefused = $false
$r = Invoke-Case 'exclusive-while-writing' {
  param($dir, $cfg)
  Clear-Fault
  Update-TypeData -TypeName System.IO.FileStream -MemberType ScriptMethod -MemberName Write -Force -Value {
    param($b, $o, $c)
    [void]$global:CreateTestHits.Add($this.Name)
    try {
      $s = [IO.File]::Open($this.Name, 'Open', 'Read', 'ReadWrite')
      $s.Dispose()
    } catch {
      $script:openRefused = $true
    }
    [void][IO.FileStream].GetMethod('Write', [type[]]@([byte[]], [int], [int])).Invoke($this, @($b, $o, $c))
  }
} $null $false
Clear-Fault
$f = New-Object System.Collections.Generic.List[string]
if ($r.Rc -ne '0') { $f.Add("expected rc 0, got $($r.Rc)") }
$d = ''
if (Test-Path -LiteralPath $r.Cfg -PathType Leaf) {
  $sha = Sha $r.Cfg; $d = "sha256=$sha bytes=$((Get-Item -LiteralPath $r.Cfg).Length) open-refused=$script:openRefused"
  if ($sha -ne $expectSha) { $f.Add('bytes differ from the bash output') }
} else { $f.Add('settings.json not created') }
if (-not $script:openRefused) { $f.Add('concurrent open was not refused') }
if ($r.Items.Count -ne 1) { $f.Add('expected exactly settings.json in .gemini') }
if ($r.Warn.Count) { $f.Add('unexpected warning') }
Report $r $f $d

# 15. Fallback to USERPROFILE when GEMINI_CLI_HOME is unset.
$readsHome = $fn -match '\bHOME\b'
if (-not $onWindows -and -not $readsHome) {
  "CASE userprofile-fallback  SKIP (Add-GeminiHf reads USERPROFILE, not HOME off Windows)"; [void]$results.Add('SKIP')
} else {
  $h = Join-Path $Work 'userprofile-fallback'
  if (-not $h.StartsWith($Work)) { 'GUARD: USERPROFILE outside the work dir'; exit 6 }
  New-Item -ItemType Directory -Path $h | Out-Null
  $dir = Join-Path $h '.gemini'; $cfg = Join-Path $dir 'settings.json'
  $savedUserProfile = $env:USERPROFILE
  $savedEnvHome = $env:HOME
  $out = @()
  try {
    Remove-Item Env:GEMINI_CLI_HOME -ErrorAction SilentlyContinue
    $env:USERPROFILE = $h
    if (-not $env:USERPROFILE.StartsWith($Work)) { 'GUARD: USERPROFILE outside the work dir'; exit 6 }
    if (-not $onWindows -and $readsHome) {
      $env:HOME = $h
      if (-not $env:HOME.StartsWith($Work)) { 'GUARD: HOME outside the work dir'; exit 6 }
    }
    $out = @(Add-GeminiHf 3>&1 6>&1)
  } catch {
    $out += "UNCAUGHT: $($_.Exception.GetType().FullName): $($_.Exception.Message)"
  } finally {
    $env:USERPROFILE = $savedUserProfile
    $env:GEMINI_CLI_HOME = $savedHome
    if (-not $onWindows -and $readsHome) { $env:HOME = $savedEnvHome }
  }
  $warn = @($out | Where-Object { $_ -is [Management.Automation.WarningRecord] } | ForEach-Object { $_.Message })
  $info = (@($out | Where-Object { $_ -is [Management.Automation.InformationRecord] } | ForEach-Object { "$($_.MessageData)" }) -join "`n")
  $rest = @($out | Where-Object { $_ -isnot [Management.Automation.WarningRecord] -and $_ -isnot [Management.Automation.InformationRecord] })
  $rc = if ($rest.Count) { "$($rest[-1])" } else { '<none>' }
  $items = @(); $isDir = Test-Path -LiteralPath $dir -PathType Container
  if ($isDir) { $items = @(Get-ChildItem -Force -LiteralPath $dir | ForEach-Object { if ($_.PSIsContainer) { $_.Name + '/' } else { $_.Name + ':' + $_.Length } }) }
  $r = [pscustomobject]@{ Name = 'userprofile-fallback'; Home = $h; Dir = $dir; Cfg = $cfg; Rc = $rc; Items = $items; Warn = $warn; Info = $info
    Extra = @($rest | Select-Object -SkipLast 1); FaultLive = $null; Pre = $null; Hits = @(); IsDir = $isDir }
  $f = New-Object System.Collections.Generic.List[string]
  if ($r.Rc -ne '0') { $f.Add("expected rc 0, got $($r.Rc)") }
  $d = ''
  if (Test-Path -LiteralPath $r.Cfg -PathType Leaf) {
    $sha = Sha $r.Cfg; $d = "sha256=$sha bytes=$((Get-Item -LiteralPath $r.Cfg).Length)"
    if ($sha -ne $expectSha) { $f.Add('bytes differ from the bash output') }
  } else { $f.Add('settings.json not created') }
  if ($r.Items.Count -ne 1) { $f.Add('expected exactly settings.json in .gemini') }
  if ($r.Warn.Count) { $f.Add('unexpected warning') }
  Report $r $f $d
}

''
$realAfter = if (Test-Path -LiteralPath $real) { "$(Sha $real) $((Get-Item -LiteralPath $real).LastWriteTimeUtc.Ticks)" } else { 'absent' }
"real settings.json untouched: $($realBefore -eq $realAfter)"
if ($realBefore -ne $realAfter) { [void]$results.Add('FAIL') }
"GEMINI_CLI_HOME restored: $($env:GEMINI_CLI_HOME -eq $savedHome)"
if ($env:GEMINI_CLI_HOME -ne $savedHome) { [void]$results.Add('FAIL') }
"type data left on FileStream: $([bool](Get-TypeData System.IO.FileStream))"
if (Get-TypeData System.IO.FileStream) { [void]$results.Add('FAIL') }
$p = @($results | Where-Object { $_ -eq 'PASS' }).Count; $x = @($results | Where-Object { $_ -eq 'FAIL' }).Count; $k = @($results | Where-Object { $_ -eq 'SKIP' }).Count
"RESULT pass=$p fail=$x skip=$k"
if ($x) { exit 1 } else { exit 0 }
