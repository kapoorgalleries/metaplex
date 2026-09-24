<#
One command to hand the network job to Codex on this admin machine (Windows;
on macOS or Linux use start-codex.sh). It:
  1. installs Codex if it is missing (the kit's own bootstrap, Codex only),
  2. signs Codex in if it is not signed in,
  3. installs Node 20+ if needed (the bootstrap again), builds the trimurti-ops MCP
     server and registers it with Codex,
  4. starts Codex in ops\network, where it loads AGENTS.md as its instructions.

Default permissions: full access to this machine, and Codex asks before anything
it judges risky. AGENTS.md lists what always needs Sanjay's yes. -Sandboxed
keeps Codex's workspace sandbox but lets network through and makes ~\.ssh
writable; expect more prompts. The kit's .sh scripts need Git for Windows
(Git Bash); install it with scripts\bootstrap-ai-clis.ps1 -WithGit if it is missing.

Usage: powershell -ExecutionPolicy Bypass -File start-codex.ps1 [-Sandboxed] [-NoMcp] [-DryRun] [-Extra "more words for the first prompt"] [more words ...]
  -Sandboxed   keep Codex's workspace sandbox (network allowed, ~\.ssh writable)
  -NoMcp       do not build or register the trimurti-ops MCP server
  -DryRun      show what it would do, change nothing
  -Extra TEXT  added to Codex's first prompt; so are any other words that are not flags
  -h, --help   this text
  The start-codex.sh spellings work too: --sandboxed --no-mcp --dry-run
#>
$ErrorActionPreference = 'Stop'

function Show-Usage([int]$Code, [string]$Why) {
  $text = (((Get-Content -LiteralPath $PSCommandPath -Raw) -split '#>')[0] -replace '^\s*<#\r?\n', '').TrimEnd()
  if ($Code -eq 0) { Write-Host $text } else { [Console]::Error.WriteLine("$Why`n$text") }
  exit $Code
}
$Sandboxed = $false; $NoMcp = $false; $DryRun = $false; $Extra = ''
for ($i = 0; $i -lt $args.Count; $i++) {
  $a = "$($args[$i])"
  if ($a -match '^(-h|-help|--help|-\?|/\?)$') { Show-Usage 0 }
  elseif ($a -match '^(-Sandboxed|--sandboxed)$') { $Sandboxed = $true }
  elseif ($a -match '^(-NoMcp|--no-mcp)$') { $NoMcp = $true }
  elseif ($a -match '^(-DryRun|--dry-run)$') { $DryRun = $true }
  elseif ($a -match '^(-Extra|--extra)(?:[=:](.*))?$') {
    if ($null -ne $Matches[2]) { $e = $Matches[2] }
    elseif ($i + 1 -lt $args.Count) { $i++; $e = "$($args[$i])" }
    else { Show-Usage 2 "$a needs text" }
    $Extra = "$Extra $e".Trim()
  }
  elseif ($a -match '^-') { Show-Usage 2 "unknown argument: $a" }
  else { $Extra = "$Extra $a".Trim() }
}

$Ops = Split-Path -Parent $PSCommandPath
$PsExe = (Get-Process -Id $PID).Path
function Log($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Have($c) { return [bool](Get-Command $c -ErrorAction SilentlyContinue) }
# Native commands run with 'Continue': Windows PowerShell 5.1 turns redirected stderr lines into
# error records, which 'Stop' makes fatal (codex prints its login status on stderr).
function Run([string]$exe, [string[]]$argv) {
  if ($DryRun) { Write-Host ("  [dry-run] {0} {1}" -f $exe, ($argv -join ' ')); return }
  $ErrorActionPreference = 'Continue'
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed ($LASTEXITCODE)" }
}
function Test-Quiet([string]$exe, [string[]]$argv) {
  $ErrorActionPreference = 'Continue'
  try { & $exe @argv *> $null } catch { return $false }
  return ($LASTEXITCODE -eq 0)
}
function Get-CliVersion($c) {
  $ErrorActionPreference = 'Continue'
  $v = $null
  try { $v = & $c --version 2>$null | ForEach-Object { "$_" } | Where-Object { $_ -match '\d+\.\d+' } | Select-Object -First 1 } catch { }
  if ($v) { return $v.Trim() } else { return '(no version output)' }
}
function Get-NodeMajor {
  if (-not (Have 'node')) { return 0 }
  if ((Get-CliVersion 'node') -match '(\d+)\.\d+') { return [int]$Matches[1] } else { return 0 }
}
function Refresh-Path {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($m) { $env:Path = "$m;$u" }
}
function Add-KnownPaths { $env:Path = "$env:USERPROFILE\.local\bin;$env:LOCALAPPDATA\Programs\OpenAI\Codex\bin;$env:APPDATA\npm;" + $env:Path }
# The kit's bootstrap in its own PowerShell, so its exit code is its own.
function Invoke-Bootstrap([string[]]$Flags) {
  $b = Join-Path $Ops 'scripts\bootstrap-ai-clis.ps1'
  if ($DryRun) { Write-Host "  [dry-run] scripts\bootstrap-ai-clis.ps1 $($Flags -join ' ')"; return $true }
  $ErrorActionPreference = 'Continue'
  & $PsExe -NoProfile -ExecutionPolicy Bypass -File $b @Flags | Out-Host
  $ok = ($LASTEXITCODE -eq 0)
  Refresh-Path; Add-KnownPaths
  return $ok
}
# An argument for a native command, escaped the way Windows splits a command line when PowerShell
# will not do it itself: Windows PowerShell 5.1 and PowerShell 7.0-7.2 always, and 7.3+ for a
# .cmd or .bat (npm's codex.cmd) in its default 'Windows' mode. Otherwise double quotes vanish.
function ConvertTo-NativeArg([string]$Arg, $Command) {
  $mode = "$(Get-Variable -Name PSNativeCommandArgumentPassing -ValueOnly -ErrorAction SilentlyContinue)"
  $legacy = ($mode -ne 'Standard' -and $mode -ne 'Windows') -or
            ($mode -eq 'Windows' -and $Command -and $Command.CommandType -eq 'Application' -and $Command.Extension -match '^\.(cmd|bat)$')
  if (-not $legacy -or $Arg -notmatch '"') { return $Arg }
  return (($Arg -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1')
}
Add-KnownPaths

# 1. Codex installed
if (-not (Have 'codex')) {
  Log "Codex is not installed; installing it with the kit's bootstrap (Codex only)"
  $flags = @('-SkipClaude', '-SkipGemini'); if (-not $NoMcp) { $flags += '-WithNode' }
  $ok = Invoke-Bootstrap $flags
  if ($DryRun) { Write-Host "dry run: codex not found, stopping here"; exit 0 }
  if (-not (Have 'codex')) { [Console]::Error.WriteLine('codex is still not on PATH; open a new terminal and rerun'); exit 1 }
  if (-not $ok) { Write-Warning 'the bootstrap reported a problem (see above); carrying on with the Codex it installed' }
}
Log "codex $(Get-CliVersion 'codex')"

# 2. Codex signed in
if (Test-Quiet 'codex' @('login', 'status')) { Log 'Codex is signed in' }
elseif ($env:SSH_CONNECTION) { Log 'signing Codex in with a device code (turn on device-code sign-in under ChatGPT Settings > Security first)'; Run 'codex' @('login', '--device-auth') }
else { Log 'signing Codex in (a browser opens)'; Run 'codex' @('login') }

# 3. trimurti-ops MCP server
$mcp = Join-Path $Ops 'mcp'
$dist = Join-Path $mcp 'dist\index.js'
if ($NoMcp) { Log 'skipping the MCP server (-NoMcp); Codex will call the scripts directly' }
else {
  if ((Get-NodeMajor) -lt 20) {
    Log 'Node 20+ is missing; installing it with the kit''s bootstrap (Node only)'
    [void](Invoke-Bootstrap @('-SkipClaude', '-SkipCodex', '-SkipGemini', '-WithNode'))
  }
  if ((Get-NodeMajor) -lt 20 -and -not $DryRun) { Write-Warning 'Node 20+ not found, so the trimurti-ops MCP server is skipped; Codex will call the scripts directly' }
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
    if (-not $DryRun) { [void](Test-Quiet 'codex' @('mcp', 'remove', 'trimurti-ops')) }
    Run 'codex' @('mcp', 'add', 'trimurti-ops', '--env', "TRIMURTI_OPS_DIR=$Ops", '--', 'node', $dist)
  }
}

# 4. Start Codex
$prompt = 'Read AGENTS.md and status.md, then run the Trimurti network job from where status.md leaves off (step 0 if it is empty). Ask me the up-front questions in one message and start step 0 while I answer.'
if ($Extra) { $prompt = "$prompt $Extra" }
if ($Sandboxed) { $argv = @('-C', $Ops, '-s', 'workspace-write', '-a', 'on-request', '-c', 'sandbox_workspace_write.network_access=true', '--add-dir', (Join-Path $HOME '.ssh')) }
else { $argv = @('-C', $Ops, '-s', 'danger-full-access', '-a', 'on-request') }
Log "starting Codex in $Ops (resume later with: codex resume --last)"
if ($DryRun) { Write-Host ("  [dry-run] codex {0} `"{1}`"" -f ($argv -join ' '), $prompt); exit 0 }
$ErrorActionPreference = 'Continue'
& codex @argv (ConvertTo-NativeArg $prompt (Get-Command codex | Select-Object -First 1))
exit $LASTEXITCODE
