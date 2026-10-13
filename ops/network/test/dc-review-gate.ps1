# The agy gate in dc-gemini-review.ps1: AgyRules and AgyModes decide from agy's saved settings whether a headless
# review can stay read-only. The rule shapes below are the ones agy 1.3.3 printed for -p "/permissions" on the
# gallery's desktop (rule text replaced). Every saved allow rule blocks, and so does a shape the gate does not know.
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

# The verdict object: ScrubObj masks strings anywhere in it and the JSON always parses.
foreach ($n in 'ScrubObj') { $f = @($ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $n }, $true)); Check ($f.Count -eq 1) "defines $n once"; if ($f.Count) { . ([ScriptBlock]::Create($f[0].Extent.Text)) } }
$k = 'Zq7' + ('x' * 37)
$o = [ordered]@{ verdict = 'comment'; summary = "Three gaps in the api key: token=$k"; findings = @([ordered]@{ message = "uses --password $k,"; line = 1 }, (ConvertFrom-Json '{"message":"x","line":2}')); usage = (ConvertFrom-Json '{"input_tokens":5}'); empty = @(); exit_code = 0 }
$j = ConvertTo-Json -InputObject (ScrubObj $o) -Depth 10
$ok = $true; try { $back = ConvertFrom-Json -InputObject $j -ErrorAction Stop } catch { $ok = $false }
Check $ok 'ScrubObj: the verdict JSON parses'
Check ($j -notmatch [regex]::Escape($k)) 'ScrubObj: secrets in nested strings are masked'
Check ($ok -and @($back.findings).Count -eq 2 -and $back.usage.input_tokens -eq 5 -and $back.exit_code -eq 0) 'ScrubObj: structure and numbers are kept'

Write-Output "$cases cases, $fails failures"
if ($fails) { exit 1 }
