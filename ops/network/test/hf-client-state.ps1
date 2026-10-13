# Get-HfClientState cases: member names are matched case-sensitively and each value must have the
# type bash's validator accepts. Run: pwsh -NoProfile -File ops/network/test/hf-client-state.ps1
# (or powershell.exe -File on Windows PowerShell 5.1). Exits non-zero on any failure.
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\scripts\bootstrap-ai-clis.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path $script), [ref]$null, [ref]$null)
# Load only the definitions this test needs, without running the bootstrap.
foreach ($a in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -match '^\$json' -and $n.Parent.Parent -eq $ast }, $false)) {
  . ([scriptblock]::Create($a.Extent.Text))
}
$helpers = 'Read-Utf8', 'Test-UniqueKeys', 'Test-StrictJson', 'Skip-JsonWs', 'Get-JsonMember', 'Get-HfClientState'
foreach ($f in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  if ($helpers -contains $f.Name) {
    . ([scriptblock]::Create($f.Extent.Text))
  }
}
# Get-HfClientState turns any error into 1 (manual review), so a helper missing here would show up only
# as wrong results. Fail loudly instead.
$missing = @($helpers | Where-Object { -not (Get-Command $_ -CommandType Function -ErrorAction SilentlyContinue) })
if ($missing.Count) { throw "hf-client-state.ps1: not defined in bootstrap-ai-clis.ps1: $($missing -join ', ')" }
$hfUrl = 'https://huggingface.co/mcp'
$hfDeny = 'hf_jobs', 'create_repo', 'dynamic_space', 'hf_sandbox', 'hf_sandbox_exec', 'hf_sandbox_fs'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path (Join-Path $tmp '.gemini') | Out-Null
$env:GEMINI_CLI_HOME = $tmp
$env:CLAUDE_CONFIG_DIR = $tmp
$deny = '["hf_jobs","create_repo","dynamic_space","hf_sandbox","hf_sandbox_exec","hf_sandbox_fs"]'
$u = '"https://huggingface.co/mcp"'
$cases = @(
  @('gemini', 0, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http","excludeTools":' + $deny + '}}}')),
  @('gemini', 0, ('{"mcpServers":{"huggingface":{"httpUrl":' + $u + ',"excludeTools":' + $deny + '}}}')),
  @('gemini', 3, ('{"other":1}')),
  @('gemini', 3, ('{"MCPServers":{"huggingface":{"url":' + $u + ',"type":"http","excludeTools":' + $deny + '}}}')),
  @('gemini', 3, ('{"mcpServers":{"HuggingFace":{"url":' + $u + ',"type":"http","excludeTools":' + $deny + '}}}')),
  @('gemini', 1, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http","excludetools":' + $deny + '}}}')),
  @('gemini', 1, ('{"mcpServers":{"huggingface":{"URL":' + $u + ',"type":"http","excludeTools":' + $deny + '}}}')),
  @('gemini', 1, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"Type":"http","excludeTools":' + $deny + '}}}')),
  @('gemini', 1, ('{"mcpServers":{"huggingface":[{"url":' + $u + ',"type":"http","excludeTools":' + $deny + '}]}}')),
  @('gemini', 1, ('{"mcpServers":{"huggingface":{"url":[' + $u + '],"type":"http","excludeTools":' + $deny + '}}}')),
  @('gemini', 1, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"type":["http"],"excludeTools":' + $deny + '}}}')),
  @('gemini', 1, ('{"mcpServers":{"huggingface":{"httpUrl":[' + $u + '],"excludeTools":' + $deny + '}}}')),
  @('gemini', 1, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http","excludeTools":"hf_jobs create_repo dynamic_space hf_sandbox hf_sandbox_exec hf_sandbox_fs"}}}')),
  @('gemini', 1, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http","excludeTools":["hf_jobs"]}}}')),
  @('gemini', 1, ('{"mcpServers":null}')),
  @('gemini', 1, ('{"mcpServers":[]}')),
  @('claude', 0, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http"}}}')),
  @('claude', 1, ('{"mcpServers":{"huggingface":{"URL":' + $u + ',"type":"http"}}}')),
  @('claude', 1, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"TYPE":"http"}}}')),
  @('claude', 1, ('{"mcpServers":{"huggingface":{"url":[' + $u + '],"type":"http"}}}')),
  @('claude', 1, ('{"mcpServers":{"huggingface":[{"url":' + $u + ',"type":"http"}]}}')),
  @('claude', 3, ('{"MCPServers":{"huggingface":{"url":' + $u + ',"type":"http"}}}')),
  # A key repeated in one object, in any spelling, goes to manual review (Test-UniqueKeys).
  @('claude', 1, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http"}},"mcpServers":{}}')),
  @('claude', 1, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http"},"huggingface":{}}}')),
  @('claude', 1, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http","type":"x"}}}')),
  @('claude', 1, ('{"a":1,"\u0061":2,"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http"}}}')),
  @('claude', 1, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http"},"hugging\u0066ace":{}}}')),
  @('claude', 1, ('{"x":{"\/Date(1)\/":1,"/Date(1)/":2},"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http"}}}')),
  @('claude', 1, ('{"x":[{"k":1,"k":2}],"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http"}}}')),
  @('gemini', 1, ('{"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http","excludeTools":' + $deny + ',"excludeTools":[]}}}')),
  # Controls: the same key in separate objects is allowed, and \/Date strings stay strings.
  @('claude', 0, ('{"a":{"x":1},"b":{"x":2},"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http"}}}')),
  @('claude', 0, ('{"d":"\/Date(1)\/","e":"\/Date(2)\/","mcpServers":{"huggingface":{"url":' + $u + ',"type":"http"}}}')),
  @('gemini', 0, ('{"x":[{"k":1},{"k":2}],"mcpServers":{"huggingface":{"url":' + $u + ',"type":"http","excludeTools":' + $deny + '}}}'))
)
$fail = 0
try {
  foreach ($c in $cases) {
    $path = if ($c[0] -eq 'claude') { Join-Path $tmp '.claude.json' } else { Join-Path $tmp '.gemini\settings.json' }
    [IO.File]::WriteAllText($path, $c[2]); if ($c[0] -ne "claude" -and [IO.Path]::DirectorySeparatorChar -ne [char]92) { [IO.File]::WriteAllText(($path -replace "\\", "/"), $c[2]) }
    $got = Get-HfClientState $c[0]
    if ($got -ne $c[1]) { $fail++; Write-Host "FAIL $($c[0]) expected $($c[1]) got ${got}: $($c[2])" }
    [IO.File]::Delete($path); [IO.File]::Delete(($path -replace "\\", "/"))
  }
} finally { Remove-Item -Recurse -Force -LiteralPath $tmp }
Write-Host "$($cases.Count) cases, $fail failures"
exit [int]($fail -ne 0)
