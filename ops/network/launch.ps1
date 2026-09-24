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

The admin key (%USERPROFILE%\.ssh\id_ed25519_trimurti, or KEY_FILE): the kit's
.sh scripts use Git Bash's ssh, which cannot use the Windows ssh-agent service.
So a missing key is created without a passphrase; it stays in your profile,
which NTFS permissions keep to your account and the PC's administrators.
-Passphrase gives a new key one. A
key with a passphrase is loaded into Git's ssh-agent here (you type it once per
launch); Claude or Codex and everything they start use that agent, and it
stops when they exit.

Usage: launch.ps1 [-Codex] [-Local] [-NoPull] [-Passphrase] [-DryRun] [-Help]
  -Codex       hand the job to Codex instead (runs start-codex.ps1)
  -Local       Claude in this window only, without Remote Control
  -NoPull      start with the kit as it is, without updating it
  -Passphrase  if the admin key is created now, give it a passphrase
  -DryRun      print what would happen and change nothing
#>
$Codex = $false; $Local = $false; $NoPull = $false; $Passphrase = $false; $DryRun = $false; $h = $false; $bad = $false
foreach ($a in $args) {
  switch -Regex ([string]$a) {
    '^(-Codex|--codex)$'      { $Codex = $true }
    '^(-Local|--local)$'      { $Local = $true }
    '^(-NoPull|--no-pull)$'   { $NoPull = $true }
    '^(-Passphrase|--passphrase)$' { $Passphrase = $true }
    '^(-DryRun|--dry-run)$'   { $DryRun = $true }
    '^(-Help|-h|--help|-\?)$' { $h = $true }
    default { Write-Host "unknown option: $a"; $bad = $true }
  }
}
$Ops = Split-Path -Parent $MyInvocation.MyCommand.Path
$usage = (((Get-Content -LiteralPath $MyInvocation.MyCommand.Path -Raw) -split '#>')[0] -replace '^\s*<#\r?\n', '').TrimEnd()
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
# A native command's output and stderr as lines, for a check; $LASTEXITCODE is its exit code.
function Quiet([string]$exe, [string[]]$argv) {
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { return @(& $exe @argv 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $eap }
}
# An empty argument (ssh-keygen -N '' -P ''). Windows PowerShell 5.1 and PowerShell 7.0-7.2 drop an
# empty string on a native command line, so there it goes as "" (about_Parsing).
function EmptyArg {
  $mode = "$(Get-Variable -Name PSNativeCommandArgumentPassing -ValueOnly -ErrorAction SilentlyContinue)"
  if ($mode -eq 'Standard' -or $mode -eq 'Windows') { return '' } else { return '""' }
}
# Git for Windows' own OpenSSH (Git\usr\bin): the ssh, ssh-agent and ssh-add that Git Bash, and so the
# kit's .sh scripts, use. Searched like the MCP server finds Git Bash: TRIMURTI_BASH, Program Files,
# then next to `git --exec-path` (<git>\mingw64\libexec\git-core).
function Find-GitSsh {
  $dirs = @()
  if ($env:TRIMURTI_BASH) { $b = Split-Path -Parent $env:TRIMURTI_BASH; $dirs += (Join-Path (Split-Path -Parent $b) 'usr\bin'), $b }
  foreach ($r in $env:ProgramFiles, $env:ProgramW6432, ${env:ProgramFiles(x86)}, $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs' })) {
    if ($r) { $dirs += Join-Path $r 'Git\usr\bin' }
  }
  if (Have 'git') {
    $x = Quiet 'git' @('--exec-path') | Select-Object -First 1
    if ($LASTEXITCODE -eq 0 -and $x) { $dirs += Join-Path ([IO.Path]::GetFullPath((Join-Path $x '..\..\..'))) 'usr\bin' }
  }
  foreach ($d in $dirs) { if (Test-Path -LiteralPath (Join-Path $d 'ssh-agent.exe')) { return $d } }
  return $null
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

# 2. The admin key, before the agent starts: its shells have no terminal to type a passphrase
#    into and never start an ssh-agent themselves. They inherit this window's environment, so a
#    key with a passphrase goes into Git's ssh-agent here (SSH_AUTH_SOCK, SSH_AGENT_PID), the
#    way Git for Windows' own start-ssh-agent.cmd does it. An agent started here stops at the end.
$KeyFile = if ($env:KEY_FILE) { $env:KEY_FILE } else { Join-Path $HOME '.ssh\id_ed25519_trimurti' }
$ourAgent = ''
function Stop-KitAgent { if ($script:ourAgent) { [void](Quiet $script:ourAgent @('-k')); $script:ourAgent = '' } }
$gitSsh = Find-GitSsh
if (-not $gitSsh) { Warn "Git for Windows not found, so the admin key was not checked (the kit's .sh scripts need Git Bash: winget install --id Git.Git -e)" }
else {
  $keygen = Join-Path $gitSsh 'ssh-keygen.exe'; $sshAdd = Join-Path $gitSsh 'ssh-add.exe'; $sshAgent = Join-Path $gitSsh 'ssh-agent.exe'
  $tty = -not [Console]::IsInputRedirected
  if (-not (Test-Path -LiteralPath $KeyFile)) {
    $comment = 'trimurti-admin@' + [Environment]::MachineName.ToLower()
    if ($DryRun) { Write-Host ("  [dry-run] {0} -t ed25519 -a 64 {1}-C {2} -f {3}" -f $keygen, $(if ($Passphrase) { '' } else { "-N '' " }), $comment, $KeyFile) }
    elseif ($Passphrase -and -not $tty) { Warn "no terminal to type a passphrase into, so the admin key was not created: run launch.ps1 -Passphrase in PowerShell yourself" }
    else {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $KeyFile) | Out-Null
      if ($Passphrase) {
        Log "creating the admin key $KeyFile (type its passphrase twice here, then once more to load it)"
        & $keygen -t ed25519 -a 64 -C $comment -f $KeyFile
      } else {
        Log "creating the admin key $KeyFile without a passphrase: Git Bash's ssh cannot use the Windows ssh-agent service, and the file stays in your profile, which NTFS permissions keep to your Windows account and the PC's administrators (-Passphrase for one, typed once per launch)"
        Quiet $keygen @('-q', '-t', 'ed25519', '-a', '64', '-N', (EmptyArg), '-C', $comment, '-f', $KeyFile) | ForEach-Object { Write-Host "  $_" }
      }
      if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $KeyFile)) { Log 'next, in Git Bash in ops\network: scripts/ssh-keys.sh copies it to each computer (it asks for each one''s password)' }
      else { Warn "ssh-keygen could not create $KeyFile" }
    }
  } elseif ($Passphrase) { Warn "$KeyFile exists; -Passphrase only applies when the key is created" }

  if (Test-Path -LiteralPath $KeyFile) {
    $err = Quiet $keygen @('-y', '-P', (EmptyArg), '-f', $KeyFile)
    if ($LASTEXITCODE -ne 0) {
      $pub = "$KeyFile.pub"; if (-not (Test-Path -LiteralPath $pub)) { $pub = $KeyFile }
      $fp = "$(Quiet $keygen @('-l', '-f', $pub) | Select-Object -First 1)".Split(' ')[1]
      $held = Quiet $sshAdd @('-l'); $agentUp = ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 1)
      if (($err -join ' ') -notmatch 'passphrase') { Warn "admin key $KeyFile is unusable: $($err | Select-Object -Last 1)" }
      elseif ($agentUp -and $fp -and ($held -join "`n").Contains($fp)) { Log 'the admin key is already in the ssh-agent' }
      elseif ($DryRun) { Write-Host "  [dry-run] $(if (-not $agentUp) { "$sshAgent -s, then " })$sshAdd $KeyFile (you type the key's passphrase)" }
      elseif (-not $tty) { Warn "no terminal to type the key's passphrase into: run launch.ps1 in PowerShell yourself, or every SSH step stops with 'no ssh-agent holds it'" }
      else {
        if (-not $agentUp) {
          Remove-Item Env:SSH_AUTH_SOCK, Env:SSH_AGENT_PID -ErrorAction SilentlyContinue
          # stdout only, as start-ssh-agent.cmd reads it: the agent's daemon half keeps no handle to it
          foreach ($l in @(& $sshAgent -s)) {
            if ($l -match '^(SSH_AUTH_SOCK|SSH_AGENT_PID)=([^;]+);') { Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2] }
          }
          if ($env:SSH_AUTH_SOCK -and $env:SSH_AGENT_PID) { $ourAgent = $sshAgent; $agentUp = $true }
          else { Warn "could not start Git's ssh-agent ($sshAgent)" }
        }
        if ($agentUp) {
          Log "loading $KeyFile into the ssh-agent (type the key's passphrase)"
          & $sshAdd $KeyFile
          if ($LASTEXITCODE -ne 0) { Warn "the key was not loaded, so every SSH step will stop with 'no ssh-agent holds it'; rerun launch.ps1 to try again" }
        }
      }
    }
  }
}

$prompt = 'Read AGENTS.md and status.md, then run the Trimurti network job from where status.md leaves off (step 0 if it is empty). Ask me the up-front questions in one message and start step 0 while I answer. Before any step that changes a machine, update the kit with: git pull --ff-only --autostash'

# 3a. Codex: start-codex.ps1 installs, signs in, registers the MCP server and starts it.
if ($Codex) {
  Log 'handing the job to Codex'
  $sc = Join-Path $Ops 'start-codex.ps1'
  $rc = 1
  try { if ($DryRun) { & $sc -DryRun } else { & $sc }; $rc = $LASTEXITCODE } finally { Stop-KitAgent }
  exit $rc
}

# 3b. Claude Code.
if (-not (Have 'claude')) {
  Log "Claude Code is not installed; installing it with the kit's bootstrap (Claude only)"
  if ($DryRun) { Write-Host '  [dry-run] scripts\bootstrap-ai-clis.ps1 -SkipCodex -SkipGemini -SkipNode' }
  else {
    & (Join-Path $Ops 'scripts\bootstrap-ai-clis.ps1') -SkipCodex -SkipGemini -SkipNode
    $env:Path = "$env:USERPROFILE\.local\bin;" + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  }
}
if (-not $DryRun -and -not (Have 'claude')) { Warn 'claude is still not on PATH; open a new PowerShell window and rerun'; Stop-KitAgent; exit 1 }

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
$rc = 1
try { & claude @argv; $rc = $LASTEXITCODE } finally { Stop-KitAgent }
exit $rc
