<#
One command to hand the network job to Codex on this admin machine (Windows;
on macOS or Linux use start-codex.sh). It:
  1. installs Codex if it is missing (the kit's own bootstrap, Codex only),
  2. signs Codex in if it is not signed in,
  3. builds the trimurti-ops MCP server and registers it with Codex (needs Node 20+),
  4. starts Codex in ops\network, where it loads AGENTS.md as its instructions.

Default permissions: full access to this machine, and Codex asks before anything
it judges risky. AGENTS.md lists what always needs Sanjay's yes. -Sandboxed
keeps Codex's workspace sandbox but lets network through; expect more prompts.
The kit's .sh scripts need Git for Windows (Git Bash); install it with
scripts\bootstrap-ai-clis.ps1 -WithGit if it is missing.

Usage: powershell -ExecutionPolicy Bypass -File start-codex.ps1 [-Sandboxed] [-NoMcp] [-DryRun] [-Extra "more words for the first prompt"]
#>
param([switch]$Sandboxed, [switch]$NoMcp, [switch]$DryRun, [string]$Extra)
$ErrorActionPreference = 'Stop'

$Ops = Split-Path -Parent $MyInvocation.MyCommand.Path
function Log($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Have($c) { return [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Run([string]$exe, [string[]]$argv) {
  if ($DryRun) { Write-Host ("  [dry-run] {0} {1}" -f $exe, ($argv -join ' ')); return }
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed ($LASTEXITCODE)" }
}
$env:Path = "$env:USERPROFILE\.local\bin;$env:LOCALAPPDATA\Programs\OpenAI\Codex\bin;$env:APPDATA\npm;" + $env:Path

# 1. Codex installed
if (-not (Have 'codex')) {
  Log "Codex is not installed; installing it with the kit's bootstrap (Codex only)"
  if ($DryRun) { Write-Host "  [dry-run] scripts\bootstrap-ai-clis.ps1 -SkipClaude -SkipGemini"; Write-Host "dry run: codex not found, stopping here"; exit 0 }
  & (Join-Path $Ops 'scripts\bootstrap-ai-clis.ps1') -SkipClaude -SkipGemini
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Have 'codex')) { throw 'codex is still not on PATH; open a new terminal and rerun' }
}
Log "codex $(codex --version 2>$null | Select-Object -First 1)"

# 2. Codex signed in
& codex login status *> $null
if ($LASTEXITCODE -eq 0) { Log 'Codex is signed in' }
elseif ($env:SSH_CONNECTION) { Log 'signing Codex in with a device code (turn on device-code sign-in under ChatGPT Settings > Security first)'; Run 'codex' @('login', '--device-auth') }
else { Log 'signing Codex in (a browser opens)'; Run 'codex' @('login') }

# 3. trimurti-ops MCP server
$nodeOk = $false
if (Have 'node') { $nodeOk = ([int]((node --version).TrimStart('v').Split('.')[0])) -ge 20 }
$mcp = Join-Path $Ops 'mcp'
$dist = Join-Path $mcp 'dist\index.js'
if ($NoMcp) { Log 'skipping the MCP server (-NoMcp); Codex will call the scripts directly' }
elseif (-not $nodeOk) { Write-Warning 'Node 20+ not found, so the trimurti-ops MCP server is skipped; Codex will call the scripts directly' }
else {
  $stale = -not (Test-Path $dist)
  if (-not $stale) {
    $built = (Get-Item $dist).LastWriteTime
    $stale = [bool](Get-ChildItem (Join-Path $mcp 'src') -Recurse -File | Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1)
  }
  if ($stale) {
    Log 'building the trimurti-ops MCP server'
    Run 'npm' @('--prefix', $mcp, 'install', '--no-audit', '--no-fund')
    Run 'npm' @('--prefix', $mcp, 'run', 'build')
  }
  Log 'registering trimurti-ops with Codex'
  if (-not $DryRun) { & codex mcp remove trimurti-ops *> $null }
  Run 'codex' @('mcp', 'add', 'trimurti-ops', '--env', "TRIMURTI_OPS_DIR=$Ops", '--', 'node', $dist)
}

# 4. Start Codex
$prompt = 'Read AGENTS.md and status.md, then run the Trimurti network job from where status.md leaves off (step 0 if it is empty). Ask me the up-front questions in one message and start step 0 while I answer.'
if ($Extra) { $prompt = "$prompt $Extra" }
if ($Sandboxed) { $argv = @('-C', $Ops, '-s', 'workspace-write', '-a', 'on-request', '-c', 'sandbox_workspace_write.network_access=true') }
else { $argv = @('-C', $Ops, '-s', 'danger-full-access', '-a', 'on-request') }
Log "starting Codex in $Ops (resume later with: codex resume --last)"
if ($DryRun) { Write-Host ("  [dry-run] codex {0} `"{1}`"" -f ($argv -join ' '), $prompt); exit 0 }
& codex @argv $prompt
