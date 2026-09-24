<#
One command on a Windows admin machine: bring the network kit up to date, then
start the agent that runs the job: Claude Code by default, or Codex with -Codex.
One agent owns the job at a time; status.md is how the next one picks it up.
(On macOS or Linux use launch.sh.)

First time, in PowerShell on the admin machine (needs Git for Windows:
winget install --id Git.Git -e; git asks for your GitHub sign-in; only
ops/network and reports are checked out):
  git clone --filter=blob:none --sparse -b claude/beautiful-turing-abqvwm https://github.com/kapoorgalleries/metaplex.git $HOME\trimurti-network
  git -C $HOME\trimurti-network sparse-checkout set ops/network reports
  powershell -ExecutionPolicy Bypass -File $HOME\trimurti-network\ops\network\launch.ps1
After that, run launch.ps1 again; it updates the kit first.

Claude starts with Remote Control on, so the session also shows up in the
Claude app (desktop and phone) and can be answered from anywhere.

Usage: launch.ps1 [-Codex] [-Local] [-NoPull] [-DryRun] [-Help]
  -Codex    hand the job to Codex instead (runs start-codex.ps1)
  -Local    Claude in this window only, without Remote Control
  -NoPull   start with the kit as it is, without updating it
  -DryRun   print what would happen and change nothing
#>
$Codex = $false; $Local = $false; $NoPull = $false; $DryRun = $false; $h = $false; $bad = $false
foreach ($a in $args) {
  switch -Regex ([string]$a) {
    '^(-Codex|--codex)$'      { $Codex = $true }
    '^(-Local|--local)$'      { $Local = $true }
    '^(-NoPull|--no-pull)$'   { $NoPull = $true }
    '^(-DryRun|--dry-run)$'   { $DryRun = $true }
    '^(-Help|-h|--help|-\?)$' { $h = $true }
    default { Write-Host "unknown option: $a"; $bad = $true }
  }
}
$Ops = Split-Path -Parent $MyInvocation.MyCommand.Path
$usage = ((Get-Content -LiteralPath $MyInvocation.MyCommand.Path -TotalCount 23) | Select-Object -Skip 1) -join "`n"
if ($h) { Write-Host $usage; exit 0 }
if ($bad) { Write-Host ''; Write-Host $usage; exit 2 }

function Log($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "WARN $m" -ForegroundColor Yellow }
function Have($c) { return [bool](Get-Command $c -ErrorAction SilentlyContinue) }
# Native commands: never let their stderr end the script; the caller checks $LASTEXITCODE.
function Native([string]$exe, [string[]]$argv) {
  if ($DryRun) { Write-Host ("  [dry-run] {0} {1}" -f $exe, ($argv -join ' ')); $global:LASTEXITCODE = 0; return }
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $exe @argv 2>&1 | ForEach-Object { Write-Host "  $_" } } finally { $ErrorActionPreference = $eap }
}
$env:Path = "$env:USERPROFILE\.local\bin;$env:LOCALAPPDATA\Programs\OpenAI\Codex\bin;$env:APPDATA\npm;$env:ProgramFiles\Git\cmd;" + $env:Path

# 1. Update the kit. inventory.csv and status.md hold this site's real data and
#    are never committed: back them up to out\ (git-ignored), pull with
#    autostash, and if the templates changed underneath them, keep Sanjay's copy.
$repo = ''
if (Have 'git') {
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $repo = (& git -C $Ops rev-parse --show-toplevel 2>$null | Select-Object -First 1)
  $ErrorActionPreference = $eap
}
if (-not $NoPull -and $repo) {
  $bak = Join-Path $Ops ('out\backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $bak | Out-Null }
  foreach ($f in 'inventory.csv', 'status.md') {
    $p = Join-Path $Ops $f
    if ((Test-Path -LiteralPath $p) -and -not $DryRun) { Copy-Item -LiteralPath $p -Destination $bak }
  }
  Log "updating the kit (backup of inventory.csv and status.md in out\$(Split-Path -Leaf $bak))"
  # start-codex marks the two files skip-worktree, which would block the pull.
  $sw = @()
  if (-not $DryRun) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $sw = @(& git -C $repo ls-files -v -- ops/network/inventory.csv ops/network/status.md 2>$null | Where-Object { $_ -like 'S *' } | ForEach-Object { $_.Substring(2) })
    if ($sw.Count) { & git -C $repo update-index --no-skip-worktree @sw 2>$null | Out-Null }
    $ErrorActionPreference = $eap
  }
  Native 'git' @('-C', $repo, 'pull', '--ff-only', '--autostash', '-q')
  if ($LASTEXITCODE -ne 0) { Warn 'could not update the kit (network, sign-in or local commits); starting with the version already here' }
  if (-not $DryRun) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $conflicts = & git -C $repo diff --name-only --diff-filter=U 2>$null
    if ($conflicts) {
      foreach ($f in 'inventory.csv', 'status.md') {
        & git -C $repo checkout HEAD -- "ops/network/$f" 2>$null | Out-Null
        $b = Join-Path $bak $f
        if (Test-Path -LiteralPath $b) { Copy-Item -LiteralPath $b -Destination (Join-Path $Ops $f) -Force }
      }
      & git -C $repo stash drop -q 2>$null | Out-Null
      Warn 'the inventory/status templates changed upstream; your copies were kept as they were (compare: git diff)'
    }
    if ($sw.Count) { & git -C $repo update-index --skip-worktree @sw 2>$null | Out-Null }
    $ErrorActionPreference = $eap
  }
}

$prompt = 'Read AGENTS.md and status.md, then run the Trimurti network job from where status.md leaves off (step 0 if it is empty). Ask me the up-front questions in one message and start step 0 while I answer. Before any step that changes a machine, update the kit with: git pull --ff-only --autostash'

# 2a. Codex: start-codex.ps1 installs, signs in, registers the MCP server and starts it.
if ($Codex) {
  Log 'handing the job to Codex'
  $sc = Join-Path $Ops 'start-codex.ps1'
  if ($DryRun) { & $sc -DryRun } else { & $sc }
  exit $LASTEXITCODE
}

# 2b. Claude Code.
if (-not (Have 'claude')) {
  Log "Claude Code is not installed; installing it with the kit's bootstrap (Claude only)"
  if ($DryRun) { Write-Host '  [dry-run] scripts\bootstrap-ai-clis.ps1 -SkipCodex -SkipGemini -SkipNode' }
  else {
    & (Join-Path $Ops 'scripts\bootstrap-ai-clis.ps1') -SkipCodex -SkipGemini -SkipNode
    $env:Path = "$env:USERPROFILE\.local\bin;" + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  }
}
if (-not $DryRun -and -not (Have 'claude')) { Warn 'claude is still not on PATH; open a new PowerShell window and rerun'; exit 1 }

$nodeOk = $false
if (Have 'node') { $nodeOk = ([int]((& node --version).TrimStart('v').Split('.')[0])) -ge 20 }
if ($nodeOk) {
  $mcp = Join-Path $Ops 'mcp'
  $dist = Join-Path $mcp 'dist\index.js'
  $stale = -not (Test-Path -LiteralPath $dist)
  if (-not $stale) {
    $built = (Get-Item -LiteralPath $dist).LastWriteTime
    $stale = [bool](Get-ChildItem -LiteralPath (Join-Path $mcp 'src') -Recurse -File | Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1)
  }
  $mcpOk = $true
  if ($stale) {
    Log 'building the trimurti-ops MCP server'
    Native 'npm' @('--prefix', $mcp, 'install', '--no-audit', '--no-fund')
    if ($LASTEXITCODE -eq 0) { Native 'npm' @('--prefix', $mcp, 'run', 'build') }
    $mcpOk = ($LASTEXITCODE -eq 0)
  }
  if ($mcpOk) {
    Log 'registering trimurti-ops with Claude Code'
    if (-not $DryRun) {
      $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      & claude mcp remove --scope user trimurti-ops *> $null
      $ErrorActionPreference = $eap
    }
    Native 'claude' @('mcp', 'add', '--scope', 'user', 'trimurti-ops', '--env', "TRIMURTI_OPS_DIR=$Ops", '--', 'node', $dist)
  } else { Warn 'the MCP server did not build; Claude will call the scripts directly' }
} else { Warn 'Node 20+ not found, so the trimurti-ops MCP server is skipped; Claude will call the scripts directly' }

Set-Location -LiteralPath $Ops
if ($Local) { $argv = @($prompt); Log "starting Claude Code in $Ops" }
else { $argv = @('--remote-control', 'trimurti-network', $prompt); Log "starting Claude Code in $Ops (Remote Control on: it also appears in the Claude app as trimurti-network)" }
if ($DryRun) { Write-Host ("  [dry-run] claude {0}" -f (($argv | ForEach-Object { if ($_ -match '\s') { "'$_'" } else { $_ } }) -join ' ')); exit 0 }
& claude @argv
exit $LASTEXITCODE
