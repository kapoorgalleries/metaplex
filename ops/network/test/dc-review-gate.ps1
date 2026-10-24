# The agy gate in dc-gemini-review.ps1: AgyRules and AgyModes decide from agy's saved settings whether a headless
# review can stay read-only. The rule shapes below are the ones agy 1.3.3 printed for -p "/permissions" on the
# gallery's desktop (rule text replaced). Every saved allow rule blocks, and so does a shape the gate does not know.
# AgyErrLines is checked too: of agy's stderr only its failure lines reach the report and the 'agy failed' verdict.
# Run: pwsh -NoProfile -File ops/network/test/dc-review-gate.ps1 (or powershell.exe -File on Windows PowerShell 5.1).
# Exits non-zero on any failure.
$ErrorActionPreference = 'Stop'
$script = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/dc-gemini-review.ps1'
$fails = 0; $cases = 0
function Check([bool]$ok, [string]$what) { $script:cases++; if (-not $ok) { $script:fails++; Write-Output "FAIL: $what" } }

$ast = [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$null, [ref]$null)
foreach ($n in 'Scrub', 'Clip', 'AgyRules', 'AgyModes') {
  $f = @($ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $n }, $true))
  Check ($f.Count -eq 1) "dc-gemini-review.ps1 defines $n once"
  if ($f.Count) { . ([ScriptBlock]::Create($f[0].Extent.Text)) }
}
function Perms([string]$json) { (ConvertFrom-Json -InputObject $json).command.data.permissions }

# The desktop's shape: commands and MCP tools in shared, plus file, URL and wildcard rules. Every rule blocks: a
# command rule matches by command words (or regex), and MCP calls run outside --sandbox.
$desk = Perms ('{"command":{"name":"permissions","data":{"permissions":[{"scope":"project"},' +
  '{"scope":"shared","allow":["command(Get-Content -Raw \"C:\\Users\\u\\notes.txt\" | Select-String x)","command(git status\nGet-Date)",' +
  '"mcp(hf-mcp-server/hub_repo_search)","read_file(C:\\Users\\u\\Documents)","write_file(C:\\Users\\u\\out.txt)","read_url(https://example.org)"]},' +
  '{"scope":"global","allow":["mcp(hf-mcp-server/hf_whoami)","command(*)","unsandboxed","execute_url(*)"]}]}}}')
$r = AgyRules $desk
$want = @('shared/command', 'shared/mcp', 'shared/read_file', 'shared/write_file', 'shared/read_url', 'global/mcp', 'global/command', 'global/unsandboxed', 'global/execute_url')
foreach ($w in $want) { Check ($r.blocked -contains $w) "blocks $w" }
Check ($r.blocked.Count -eq $want.Count) ("blocks nothing else: " + ($r.blocked -join ', '))
Check ($r.counts['shared/command'] -eq 2 -and $r.counts['shared/mcp'] -eq 1 -and $r.counts['global/mcp'] -eq 1) 'counts each rule type'

# No rules at all (a fresh agy), an empty allow list, and ask/deny lists (they only make agy ask or refuse).
$r = AgyRules (Perms '{"command":{"data":{"permissions":[{"scope":"project"},{"scope":"shared","allow":[]}]}}}')
Check ($r.blocked.Count -eq 0 -and $r.counts.Count -eq 0) 'no rules: nothing blocks'
$r = AgyRules (Perms '{"command":{"data":{"permissions":[]}}}')
Check ($r.blocked.Count -eq 0) 'empty permissions list: nothing blocks'
$r = AgyRules (Perms '{"command":{"data":{"permissions":[{"scope":"global","deny":["command(rm)"],"ask":["command(git push)"]}]}}}')
Check ($r.blocked.Count -eq 0) 'ask and deny rules alone: nothing blocks'

# Each single rule blocks, the narrowest included.
foreach ($rule in 'command(git diff)', 'command(git)', 'command(regex:.+)', 'command', 'command(*)', 'mcp(hf-mcp-server/hub_repo_search)', 'mcp(desktop-commander/read_file)', 'read_file', 'Bash(ls)', '(odd)') {
  $j = '{"command":{"data":{"permissions":[{"scope":"global","allow":[' + (ConvertTo-Json -InputObject $rule -Compress) + ']}]}}}'
  $r = AgyRules (Perms $j)
  Check ($r.blocked.Count -eq 1) "blocks the rule: $rule"
}
# A shape the gate does not know blocks too (agy updates itself, and a renamed key must not turn the gate off).
foreach ($j in '{"command":{"data":{"permissions":[{"scope":"shared","rules":["command(git)"]}]}}}',
  '{"command":{"data":{"permissions":[{"scope":"shared","allow":[{"tool":"command","arg":"git"}]}]}}}',
  '{"command":{"data":{"permissions":["command(git)"]}}}', '{"command":{"data":{"permissions":[{"allow":["mcp(x/y)"]}]}}}') {
  $r = AgyRules (Perms $j)
  Check ($r.blocked -contains '(unexpected /permissions shape)') "unknown shape blocks: $j"
}

# Settings in /config.
function Cfg([string]$json) { (ConvertFrom-Json -InputObject $json).command.data.config }
foreach ($c in '{"agentMode":"always-proceed"}', '{"permissions":{"cycleMode":"alwaysProceed"}}', '{"agentMode":"accept-edits"}',
  '{"allowNonWorkspaceFileAccess":true}', '{"fileAccess":{"outsideWorkspace":"read"}}', '{"autoExecution":"on"}', '{"modes":["plan","yolo"]}') {
  Check (@(AgyModes (Cfg ('{"command":{"data":{"config":' + $c + '}}}'))).Count -ge 1) "blocks the setting: $c"
}
Check (@(AgyModes (Cfg '{"command":{"data":{"config":{"agentMode":"default","themeMode":"auto","ui":{"editorMode":"vim"},"useG1Credits":false,"allowNonWorkspaceFileAccess":false,"pickerGrouping":"workspace","queuedMessages":"Queue"}}}}')).Count -eq 0) 'default settings do not block'
Check (@(AgyModes 'text').Count -eq 1 -and @(AgyModes $null).Count -eq 1) 'a /config that is not an object blocks'
# The keys agy 1.3.3 printed on the desktop (paths replaced): nothing blocks, and a trusted folder blocks only when
# it holds the review folder.
$real = '{"command":{"data":{"config":{"agentMode":"","allowNonWorkspaceAccess":false,"altScreenMode":"default","artifactReviewPolicy":"asks-for-review","enableTerminalSandbox":false,"editorMode":"default","pickerGrouping":"none","queuedMessages":"queue","toolPermission":"request-review","trustedWorkspaces":["C:\\Users\\u\\AppData\\Local\\Temp\\Kapoor"],"useG1Credits":false,"verbosity":"medium","permissions":{"allow":["mcp(hf-mcp-server/hf_whoami)"]}}}}}'
$ws = 'C:\Users\u\trimurti-dc\agy-pr31-1'
Check (@(AgyModes (Cfg $real) $ws).Count -eq 0) 'the desktop /config does not block'
Check (@(AgyModes (Cfg ($real -replace 'request-review', 'always-proceed')) $ws).Count -eq 1) 'toolPermission always-proceed blocks'
Check (@(AgyModes (Cfg ($real -replace '"allowNonWorkspaceAccess":false', '"allowNonWorkspaceAccess":true')) $ws).Count -eq 1) 'allowNonWorkspaceAccess true blocks'
Check (@(AgyModes (Cfg ($real -replace 'AppData\\\\Local\\\\Temp\\\\Kapoor', 'trimurti-dc')) $ws).Count -eq 1) 'a trusted parent of the review folder blocks'
Check (@(AgyModes (Cfg ($real -replace '"C:\\\\Users\\\\u\\\\AppData\\\\Local\\\\Temp\\\\Kapoor"', '"C:/Users/u/trimurti-dc/"')) $ws).Count -eq 1) 'a trusted parent written with / blocks'
Check (@(AgyModes (Cfg ($real -replace '"C:\\\\Users\\\\u\\\\AppData\\\\Local\\\\Temp\\\\Kapoor"', '"C:/Users/u/Temp"')) $ws).Count -eq 0) 'a trusted folder written with / elsewhere does not block'
# A trust key whose value is not a folder is a setting: true or an auto-approving mode blocks, false does not.
foreach ($c in '{"trustAllWorkspaces":true}', '{"workspaceTrust":"always-proceed"}', '{"trust":{"mode":"bypass"}}', '{"trustedWorkspaces":["*"]}') {
  Check (@(AgyModes (Cfg ('{"command":{"data":{"config":' + $c + '}}}')) $ws).Count -ge 1) "blocks the trust setting: $c"
}
Check (@(AgyModes (Cfg '{"command":{"data":{"config":{"trustAllWorkspaces":false,"trustedWorkspaces":[]}}}}') $ws).Count -eq 0) 'trust settings that are off do not block'

# The -Via cli fallback without -o json sends gemini's stderr to its own file too, like the first call.
$gr = @($ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.CommandAst] -and $a.GetCommandName() -eq 'Run' -and $a.Extent.Text -match "gemini\.cmd" }, $true))
Check ($gr.Count -ge 2) 'two gemini CLI Run calls found'
foreach ($c in $gr) { Check ($c.Extent.Text -match '\$gErr\s*$') ("gemini CLI Run call ends with `$gErr: " + $c.Extent.Text.Substring(0, 30)) }

# dc-fix step 5 compares each stale kg-permission-gates copy before -SyncPermissionGates overwrites it.
$fx = [IO.File]::ReadAllText((Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/dc-fix.ps1'))
$ic = $fx.IndexOf('Compare-Object @(Get-Content -LiteralPath $new.Skill)'); $is = $fx.IndexOf('Get-ChildItem -LiteralPath $new.Path -Force | Copy-Item')
Check ($ic -gt 0 -and $is -gt 0 -and $ic -lt $is) 'dc-fix compares the stale SKILL.md before syncing over it'

# The verdict object: ScrubObj masks strings anywhere in it and the JSON always parses.
foreach ($n in 'ScrubObj') { $f = @($ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $n }, $true)); Check ($f.Count -eq 1) "defines $n once"; if ($f.Count) { . ([ScriptBlock]::Create($f[0].Extent.Text)) } }
$k = 'Zq7' + ('x' * 37)
$o = [ordered]@{ verdict = 'comment'; summary = "Three gaps in the api key: token=$k"; findings = @([ordered]@{ message = "uses --password $k,"; line = 1 }, (ConvertFrom-Json '{"message":"x","line":2}')); usage = (ConvertFrom-Json '{"input_tokens":5}'); empty = @(); exit_code = 0 }
$j = ConvertTo-Json -InputObject (ScrubObj $o) -Depth 10
$ok = $true; try { $back = ConvertFrom-Json -InputObject $j -ErrorAction Stop } catch { $ok = $false }
Check $ok 'ScrubObj: the verdict JSON parses'
Check ($j -notmatch [regex]::Escape($k)) 'ScrubObj: secrets in nested strings are masked'
Check ($ok -and @($back.findings).Count -eq 2 -and $back.usage.input_tokens -eq 5 -and $back.exit_code -eq 0) 'ScrubObj: structure and numbers are kept'
# A model's finding with extra fields under key-like names (the cli route keeps any field, and agy's schema does
# not forbid them): their values are masked, counts and the scan result are kept.
$m = ConvertFrom-Json ('{"verdict":"comment","summary":"s","findings":[{"severity":"low","file":"a","line":1,"message":"m","password":"' + $k + '","api_key":"' + $k + '","pin_token":4821937,"key_ok":true}]}')
$u = ConvertFrom-Json '{"promptTokenCount":5,"candidatesTokenCount":3,"totalTokenCount":8,"promptTokensDetails":[{"modality":"TEXT","tokenCount":5}],"cache_read_tokens":2}'
$o = [ordered]@{ verdict = 'comment'; findings = @($m.findings); credential_scan = [ordered]@{ clean = $false; details = @('diff:12', 'meta:3') }; usage = $u; exit_code = 0 }
$j = ConvertTo-Json -InputObject (ScrubObj $o) -Depth 10
$back = ConvertFrom-Json -InputObject $j; $f0 = @($back.findings)[0]
Check ($j -notmatch [regex]::Escape($k) -and $f0.password -eq '***' -and $f0.api_key -eq '***') 'ScrubObj: a string under a key-like name is masked'
Check ($f0.pin_token -eq '***' -and $f0.key_ok -eq $true) 'ScrubObj: a number under a key-like name is masked, true/false kept'
Check ($f0.message -eq 'm' -and $f0.line -eq 1 -and $f0.severity -eq 'low' -and $f0.file -eq 'a') 'ScrubObj: the finding''s own fields are kept'
$d0 = @($back.usage.promptTokensDetails)[0]
Check ($back.usage.promptTokenCount -eq 5 -and $back.usage.candidatesTokenCount -eq 3 -and $back.usage.totalTokenCount -eq 8 -and $back.usage.cache_read_tokens -eq 2 -and $d0.modality -eq 'TEXT' -and $d0.tokenCount -eq 5) 'ScrubObj: token counts and promptTokensDetails are kept'
Check ((@($back.credential_scan.details) -join ',') -eq 'diff:12,meta:3' -and $back.credential_scan.clean -eq $false) 'ScrubObj: credential_scan is kept'

# agy's stderr in the report and the 'agy failed' verdict: only its failure lines (AGY_ERROR, error:), never the
# startup warnings, which can quote saved rules.
foreach ($n in 'AgyErrLines') { $f = @($ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $n }, $true)); Check ($f.Count -eq 1) "defines $n once"; if ($f.Count) { . ([ScriptBlock]::Create($f[0].Extent.Text)) } }
$wr = 'warning: C:\Users\u\.gemini\antigravity\settings.json: deprecated unsandboxed rules: unsandboxed(python C:\Users\u\Clients\x.py)'
$ae = @(AgyErrLines ($wr + "`r`n" + 'AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","code":429,"retryable":true,"error_id":"e-1"}' + "`r`n  unsandboxed(net use \\nas\x)`n" + 'error: you have reached your individual quota; it resets at 2026-10-15T00:00:00Z' + "`n"))
Check ($ae.Count -eq 2 -and $ae[0] -like 'AGY_ERROR: {"status":"RESOURCE_EXHAUSTED"*' -and $ae[1] -like 'error: you have reached*') 'AgyErrLines: keeps the AGY_ERROR and error: lines, in order'
Check (($ae -join "`n") -notmatch 'unsandboxed|Clients') 'AgyErrLines: leaves out warnings and the rules they quote'
Check (@(AgyErrLines ($wr + "`n  - command(git)`n")).Count -eq 0 -and @(AgyErrLines '').Count -eq 0) 'AgyErrLines: nothing from warnings alone or an empty stderr'
Check (@(AgyErrLines 'warning: rule x failed with error: y').Count -eq 0) 'AgyErrLines: an error: inside a warning line is not a failure line'
$many = @(AgyErrLines ((1..5 | ForEach-Object { "error: e$_" }) -join "`n"))
Check ($many.Count -eq 3 -and $many[2] -eq 'error: e3') 'AgyErrLines: at most 3 lines'
$long = @(AgyErrLines ('Error: ' + ('y' * 400)))
Check ($long.Count -eq 1 -and $long[0].Length -eq 304 -and $long[0].EndsWith(' ...')) 'AgyErrLines: each line is clipped, any case of error:'
$sl = @(AgyErrLines "error: request failed: token=$k")
Check ($sl.Count -eq 1 -and $sl[0] -notmatch [regex]::Escape($k)) 'AgyErrLines: each line is scrubbed'

Write-Output "$cases cases, $fails failures"
if ($fails) { exit 1 }
