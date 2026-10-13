# The agy gate in dc-gemini-review.ps1: AgyRules and AgyModes decide from agy's saved settings whether a headless
# review can stay read-only. The rule shapes below are the ones agy 1.3.3 printed for -p "/permissions" on the
# gallery's desktop (rule text replaced); a rule that allows more than reading the review folder must block.
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

# The desktop's shape: specific commands and MCP tools in shared, plus file, URL and wildcard rules.
$desk = Perms ('{"command":{"name":"permissions","data":{"permissions":[{"scope":"project"},' +
  '{"scope":"shared","allow":["command(Get-Content -Raw \"C:\\Users\\u\\notes.txt\" | Select-String x)","command(git status\nGet-Date)",' +
  '"mcp(hf-mcp-server/hub_repo_search)","read_file(C:\\Users\\u\\Documents)","write_file(C:\\Users\\u\\out.txt)","read_url(https://example.org)"]},' +
  '{"scope":"global","allow":["mcp(hf-mcp-server/hf_whoami)","command(*)","unsandboxed","execute_url(*)"]}]}}}')
$r = AgyRules $desk
$want = @('shared/read_file', 'shared/write_file', 'shared/read_url', 'global/command', 'global/unsandboxed', 'global/execute_url')
foreach ($w in $want) { Check ($r.blocked -contains $w) "blocks $w" }
Check ($r.blocked.Count -eq $want.Count) ("blocks nothing else: " + ($r.blocked -join ', '))
Check ($r.counts['shared/command'] -eq 2 -and $r.counts['shared/mcp'] -eq 1 -and $r.counts['global/mcp'] -eq 1) 'counts specific command and MCP rules'
Check (-not ($r.blocked -contains 'shared/command') -and -not ($r.blocked -contains 'shared/mcp')) 'specific command and MCP rules do not block'

# No rules at all (a fresh agy), and an empty allow list.
$r = AgyRules (Perms '{"command":{"data":{"permissions":[{"scope":"project"},{"scope":"shared","allow":[]}]}}}')
Check ($r.blocked.Count -eq 0 -and $r.counts.Count -eq 0) 'no rules: nothing blocks'
$r = AgyRules (Perms '{"command":{"data":{"permissions":[]}}}')
Check ($r.blocked.Count -eq 0) 'empty permissions list: nothing blocks'

# Wildcards and anything the gate does not know.
foreach ($rule in 'command', 'command()', 'command( )', 'command(git *)', 'mcp(hf-mcp-server/*)', 'mcp', 'Bash(ls)', 'read_file', '(odd)') {
  $j = '{"command":{"data":{"permissions":[{"scope":"global","allow":[' + (ConvertTo-Json -InputObject $rule -Compress) + ']}]}}}'
  $r = AgyRules (Perms $j)
  Check ($r.blocked.Count -eq 1) "blocks the rule: $rule"
}

# Agent modes in /config.
function Cfg([string]$json) { (ConvertFrom-Json -InputObject $json).command.data.config }
Check (@(AgyModes (Cfg '{"command":{"data":{"config":{"agentMode":"always-proceed"}}}}')).Count -eq 1) 'always-proceed mode blocks'
Check (@(AgyModes (Cfg '{"command":{"data":{"config":{"permissions":{"cycleMode":"alwaysProceed"}}}}}')).Count -eq 1) 'nested always-proceed blocks'
Check (@(AgyModes (Cfg '{"command":{"data":{"config":{"agentMode":"default","themeMode":"auto","ui":{"editorMode":"vim"},"useG1Credits":false}}}}')).Count -eq 0) 'default modes do not block'

Write-Output "$cases cases, $fails failures"
if ($fails) { exit 1 }
