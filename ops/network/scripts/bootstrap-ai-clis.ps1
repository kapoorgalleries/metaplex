<#
Install Claude Code, OpenAI Codex CLI and Gemini CLI on this Windows machine.
Claude Code and Codex are native binaries put in place by their official
installers, each run in a child PowerShell so that its own exit or StrictMode
cannot end this script (npm is the fallback for Codex); Gemini CLI is an npm
package, so Node.js LTS is installed for it. Idempotent: rerun to upgrade.

winget (App Installer; present on Windows 10 1809+ and 11) is needed only to
install Node.js or Git. Node's MSI needs elevation: run from an elevated
PowerShell, or over SSH as a member of Administrators (those SSH sessions are
already elevated).

Usage: powershell -ExecutionPolicy Bypass -File scripts\bootstrap-ai-clis.ps1 [-SkipClaude] [-SkipCodex] [-SkipGemini] [-SkipNode] [-WithNode] [-WithGit]
  -SkipClaude, -SkipCodex, -SkipGemini   leave that CLI alone
  -SkipNode    never install Node.js (Gemini then needs Node 20+ already)
  -WithNode    install Node.js 20+ even when Gemini is skipped (the trimurti-ops MCP server needs it)
  -WithGit     also install Git for Windows (the Bash tool for Claude Code)
  -h, --help   this text
  The bootstrap-ai-clis.sh spellings work too: --skip-claude --skip-codex --skip-gemini --skip-node --with-node --with-git
Exit: 0 every requested CLI is installed, 1 something failed (the last line says what), 2 bad arguments.
#>
$ErrorActionPreference = 'Stop'

function Show-Usage([int]$Code, [string]$Why) {
  $text = (((Get-Content -LiteralPath $PSCommandPath -Raw) -split '#>')[0] -replace '^\s*<#\r?\n', '').TrimEnd()
  if ($Code -eq 0) { Write-Host $text } else { [Console]::Error.WriteLine("$Why`n$text") }
  exit $Code
}
$SkipClaude = $false; $SkipCodex = $false; $SkipGemini = $false; $SkipNode = $false; $WithNode = $false; $WithGit = $false
foreach ($a in $args) {
  switch -regex ("$a") {
    '^(-h|-help|--help|-\?|/\?)$'   { Show-Usage 0 }
    '^(-SkipClaude|--skip-claude)$' { $SkipClaude = $true }
    '^(-SkipCodex|--skip-codex)$'   { $SkipCodex = $true }
    '^(-SkipGemini|--skip-gemini)$' { $SkipGemini = $true }
    '^(-SkipNode|--skip-node)$'     { $SkipNode = $true }
    '^(-WithNode|--with-node)$'     { $WithNode = $true }
    '^(-WithGit|--with-git)$'       { $WithGit = $true }
    default                         { Show-Usage 2 "unknown argument: $a" }
  }
}

# TLS 1.2 for PSGallery and the installers where .NET does not leave the choice to Windows
if ([int][Net.ServicePointManager]::SecurityProtocol -ne 0) { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 }
$PsExe = (Get-Process -Id $PID).Path
$Failed = New-Object System.Collections.Generic.List[string]

function Log($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Have($c) { return [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Add-Failure([string]$Name, [string]$Why) { Write-Warning $Why; $Failed.Add($Name) }
function Refresh-Path {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($m) { $env:Path = "$m;$u" }
}
# Run a native command with its stderr shown as plain text: Windows PowerShell 5.1 turns redirected
# stderr lines into error records, which 'Stop' makes fatal (npm's notices, winget's progress).
# Returns the exit code.
function Invoke-Native([string]$Exe, [string[]]$ArgList = @()) {
  $ErrorActionPreference = 'Continue'
  try { & $Exe @ArgList 2>&1 | ForEach-Object { "$_" } | Out-Host } catch { Write-Warning "${Exe}: $($_.Exception.Message)"; return 127 }
  return $LASTEXITCODE
}
# The first line of '<cli> --version' that looks like a version, from stdout only (a warning on stderr is not a version).
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
# winget is a per-user Store app and can be missing from PATH in an SSH session; find it.
function Find-Winget {
  $c = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  if ($env:LOCALAPPDATA) { $p = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe'; if (Test-Path $p) { return $p } }
  $q = Get-ChildItem 'C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*\winget.exe' -ErrorAction SilentlyContinue |
       Sort-Object FullName -Descending | Select-Object -First 1
  if ($q) { return $q.FullName }
  return $null
}
$Winget = Find-Winget
function Winget-Install($id) {
  if (-not $Winget) {
    Write-Warning "winget not found, so $id cannot be installed. Install 'App Installer' from the Microsoft Store (or run: Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe), log in to the desktop once, then rerun."
    return $false
  }
  $rc = Invoke-Native $Winget @('install', '--id', $id, '-e', '--silent', '--disable-interactivity', '--accept-source-agreements', '--accept-package-agreements')
  if ($rc -eq -1978334967) { Write-Warning "$id is installed; restart this PC to finish (winget 0x8A150109)"; return $true }
  # benign: 0x8A15002B no applicable update, 0x8A150061 package already installed, 0x8A15010D another version
  # is already installed, 0x8A15010E a higher version is already installed, 0x8A15004F upgrade version not newer
  $benign = 0, -1978335189, -1978335135, -1978334963, -1978334962, -1978335153
  if ($benign -notcontains $rc) { Write-Warning "winget install $id failed ($rc)"; return $false }
  return $true
}
function Npm-Global($pkg) { return ((Invoke-Native 'npm' @('install', '-g', '--no-fund', '--no-audit', $pkg)) -eq 0) }
# A vendor's install.ps1 in a child PowerShell: an 'exit' or Set-StrictMode in it stays there. Returns its exit code.
function Invoke-Installer([string]$Url) {
  $cmd = "if ([int][Net.ServicePointManager]::SecurityProtocol -ne 0) { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 }; Invoke-RestMethod -Uri '$Url' | Invoke-Expression"
  $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
  return (Invoke-Native $PsExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $enc))
}
# Put a directory on the user's persistent PATH (and this session's) once.
function Add-UserPath($dir) {
  $u = "$([Environment]::GetEnvironmentVariable('Path', 'User'))"
  if (($u -split ';') -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', ($u.TrimEnd(';') + ';' + $dir).TrimStart(';'), 'User') }
  if (($env:Path -split ';') -notcontains $dir) { $env:Path += ";$dir" }
}
# Node 20+ at most once per run; $true when it is on PATH afterwards.
$NodeOk = $null
function Install-Node {
  if ($null -ne $script:NodeOk) { return $script:NodeOk }
  $script:NodeOk = $false
  if ((Get-NodeMajor) -ge 20) { Log "node $(Get-CliVersion 'node') present"; $script:NodeOk = $true; return $true }
  Log 'installing Node.js LTS (Gemini CLI and the trimurti-ops MCP server need 20+)'
  if (-not (Winget-Install 'OpenJS.NodeJS.LTS')) { Add-Failure 'node' 'Node.js install FAILED'; return $false }
  Refresh-Path
  if ((Get-NodeMajor) -lt 20) {
    if (Have 'node') { Add-Failure 'node' "node on PATH is still older than 20 ($(Get-CliVersion 'node') at $((Get-Command node).Source)); remove that one or put $env:ProgramFiles\nodejs first on PATH, then rerun" }
    else { Add-Failure 'node' 'node is still not on PATH; open a new terminal and rerun' }
    return $false
  }
  Log "node $(Get-CliVersion 'node') installed"
  $script:NodeOk = $true; return $true
}

if (-not $SkipNode -and (-not $SkipGemini -or $WithNode)) { [void](Install-Node) }

if ($WithGit -and -not (Have 'git')) {
  Log 'installing Git for Windows (Bash tool for Claude Code)'
  if (Winget-Install 'Git.Git') { Refresh-Path }
  if (-not (Have 'git')) { Add-Failure 'git' 'Git for Windows install FAILED' }
}

if (-not $SkipClaude) {
  if (Have 'claude') {
    Log "claude present ($(Get-CliVersion 'claude')); checking for an update"
    if ((Invoke-Native 'claude' @('update')) -ne 0) { Add-Failure 'claude' "'claude update' failed" }
  } else {
    Log 'installing Claude Code (native installer, auto-updates itself)'
    $rc = Invoke-Installer 'https://claude.ai/install.ps1'
    if ($env:USERPROFILE) { Add-UserPath (Join-Path $env:USERPROFILE '.local\bin') }   # the installer puts claude.exe here; make sure new terminals find it
    Refresh-Path
    if (-not (Have 'claude')) { Add-Failure 'claude' "Claude Code install FAILED (installer exit $rc; https://claude.ai/install.ps1)" }
  }
}
if (-not $SkipCodex) {
  if (Have 'codex') {
    Log "codex present ($(Get-CliVersion 'codex')); checking for an update"
    if ((Invoke-Native 'codex' @('update')) -ne 0) { Add-Failure 'codex' "'codex update' failed" }
  } else {
    Log 'installing Codex CLI (official installer, self-updates with "codex update")'
    $env:CODEX_NON_INTERACTIVE = '1'
    $rc = Invoke-Installer 'https://chatgpt.com/codex/install.ps1'
    Refresh-Path
    if ($env:LOCALAPPDATA) {
      $bin = Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin'
      if (-not (Have 'codex') -and (Test-Path (Join-Path $bin 'codex.exe'))) { Add-UserPath $bin }
    }
    if (-not (Have 'codex')) {
      Write-Warning "Codex installer failed (exit $rc); falling back to npm"
      if (-not (Have 'npm') -and -not $SkipNode) { [void](Install-Node) }
      if (-not (Have 'npm')) { Add-Failure 'codex' 'Codex install FAILED: the installer failed and npm is not available' }
      elseif (-not (Npm-Global '@openai/codex@latest')) { Add-Failure 'codex' 'Codex npm install FAILED' }
      else { Refresh-Path; if (-not (Have 'codex')) { Add-Failure 'codex' 'Codex installed with npm, but codex is not on PATH' } }
    }
  }
}
if (-not $SkipGemini) {
  if ((Get-NodeMajor) -lt 20 -or -not (Have 'npm')) { Add-Failure 'gemini' 'Gemini CLI needs Node.js 20+ and npm; not installed' }
  else {
    Log 'installing/updating Gemini CLI (npm)'
    if (-not (Npm-Global '@google/gemini-cli@latest')) { Add-Failure 'gemini' 'Gemini CLI npm install FAILED' }
    else { Refresh-Path; if (-not (Have 'gemini')) { Add-Failure 'gemini' 'Gemini CLI installed, but gemini is not on PATH' } }
  }
}
Refresh-Path

Log "versions on ${env:COMPUTERNAME}:"
foreach ($c in 'node', 'claude', 'codex', 'gemini') {
  if (Have $c) { $v = Get-CliVersion $c } else { $v = 'MISSING' }
  Write-Host ("  {0,-7} {1}" -f $c, $v)
}
@'

Sign in once per machine, per user (open a NEW terminal first so PATH is fresh). Never type a token
or key into a command line: PowerShell keeps every command in its history file. The routes below
read it with Read-Host -AsSecureString, and it lasts for that window only.
  claude   run `claude` (or `claude auth login`). A browser opens; over SSH press `c` to copy the
           URL, open it on any machine, then paste the code back at "Paste code here if prompted".
           No browser anywhere: `claude setup-token` on any machine with a browser prints a one-year
           token (Pro/Max/Team/Enterprise; model requests only), then here:
           $env:CLAUDE_CODE_OAUTH_TOKEN = [Net.NetworkCredential]::new('', (Read-Host 'token' -AsSecureString)).Password
           Keeping it past this window means a file outside the repo that only this user can read, and
           only Sanjay decides that; prefer the browser sign-in, which Claude Code stores by itself.
           check:  claude auth status     install health:  claude doctor
           (If ANTHROPIC_API_KEY is set, Claude Code bills that key instead of the subscription: remove it here.)
  codex    run `codex login` (browser). Over SSH: `codex login --device-auth` (turn on device-code
           sign-in under ChatGPT Settings > Security first), or forward the callback port from the
           machine with the browser:  ssh -L 1455:localhost:1455 <this-host>  then `codex login`.
           API key:  [Net.NetworkCredential]::new('', (Read-Host 'key' -AsSecureString)).Password | codex login --with-api-key
           (setting OPENAI_API_KEY on its own is not a login)
           check:  codex login status     credentials: %USERPROFILE%\.codex\auth.json
  gemini   run `gemini` and choose "Sign in with Google". Over SSH (with a terminal: ssh -t) set
           $env:NO_BROWSER = 'true'  first and paste the code back within 5 minutes.
           Google Workspace account (not personal Gmail): first
           $env:GOOGLE_CLOUD_PROJECT = '<project-id>'; personal Gmail must leave it unset.
           API key instead (this window only; https://aistudio.google.com/app/apikey):
           $env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', (Read-Host 'key' -AsSecureString)).Password
'@ | Write-Host
# npm puts gemini.ps1 (and codex.ps1) next to gemini.cmd, and PowerShell picks the .ps1, which the
# default policy for Windows clients (Restricted) refuses to run. This run has its own Bypass.
$policy = 'Restricted'
foreach ($s in 'MachinePolicy', 'UserPolicy', 'CurrentUser', 'LocalMachine') {
  $p = "$(Get-ExecutionPolicy -Scope $s)"; if ($p -ne 'Undefined') { $policy = $p; break }
}
if ($policy -eq 'Restricted' -or $policy -eq 'AllSigned') {
  Write-Host @"
  note     PowerShell windows on this PC run no scripts (execution policy $policy), and npm's gemini.ps1
           is one. In PowerShell type gemini.cmd (and codex.cmd if Codex came from npm); cmd.exe finds
           gemini as is, and over SSH use: ssh -t <this-host> gemini.cmd. Set-ExecutionPolicy -Scope
           CurrentUser RemoteSigned would fix it for this user, but it is a security setting: Sanjay's yes first.
"@
}
if ($Failed.Count) { Write-Host "INSTALL INCOMPLETE on ${env:COMPUTERNAME}, failed: $($Failed -join ' ')"; exit 1 }
Write-Host "INSTALL OK on ${env:COMPUTERNAME}"
exit 0
