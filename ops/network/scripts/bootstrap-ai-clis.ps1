<#
Install Claude Code, OpenAI Codex CLI and Gemini CLI on this Windows machine.
Claude Code and Codex are native binaries put in place by their official
installers (npm is the fallback for Codex); Gemini CLI is an npm package, so
Node.js LTS is installed for it. With -WithGit, Git for Windows so Claude Code
gets a Bash tool. Idempotent: rerun to upgrade everything.

Needs winget (App Installer; present on Windows 10 1809+ and 11). Node's MSI
needs elevation: run from an elevated PowerShell, or over SSH as a member of
Administrators (those SSH sessions are already elevated).

Usage: powershell -ExecutionPolicy Bypass -File scripts\bootstrap-ai-clis.ps1 [-SkipClaude] [-SkipCodex] [-SkipGemini] [-SkipNode] [-WithGit]
#>
param([switch]$SkipClaude, [switch]$SkipCodex, [switch]$SkipGemini, [switch]$SkipNode, [switch]$WithGit)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Log($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Have($c) { return [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
# winget is a per-user Store app and can be missing from PATH in an SSH session; find it.
function Find-Winget {
  $c = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe'
  if (Test-Path $p) { return $p }
  $q = Get-ChildItem 'C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*\winget.exe' -ErrorAction SilentlyContinue |
       Sort-Object FullName -Descending | Select-Object -First 1
  if ($q) { return $q.FullName }
  return $null
}
$Winget = Find-Winget
function Winget-Install($id) {
  & $Winget install --id $id -e --silent --disable-interactivity --accept-source-agreements --accept-package-agreements | Out-Host
  # -1978335189 = 0x8A15002B "no applicable update found": the package is already current
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { throw "winget install $id failed ($LASTEXITCODE)" }
}
function Npm-Global($pkg) {
  & npm install -g --no-fund --no-audit $pkg 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "npm install -g $pkg failed" }
}
# Put a directory on the user's persistent PATH (and this session's) once.
function Add-UserPath($dir) {
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (($u -split ';') -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', ($u.TrimEnd(';') + ';' + $dir), 'User') }
  if (($env:Path -split ';') -notcontains $dir) { $env:Path += ";$dir" }
}

if (-not $Winget) {
  throw "winget not found. Install 'App Installer' from the Microsoft Store (or run: Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe), log in to the desktop once, then rerun."
}

if (-not $SkipNode -and -not $SkipGemini) {
  $ok = $false
  if (Have 'node') { $ok = ([int]((node --version).TrimStart('v').Split('.')[0])) -ge 20 }
  if ($ok) { Log "node $(node --version) present" }
  else { Log 'installing Node.js LTS (Gemini CLI needs 20+)'; Winget-Install 'OpenJS.NodeJS.LTS'; Refresh-Path }
  if (-not (Have 'node')) { throw 'node is still not on PATH; open a new terminal and rerun' }
}

if ($WithGit -and -not (Have 'git')) { Log 'installing Git for Windows (Bash tool for Claude Code)'; Winget-Install 'Git.Git'; Refresh-Path }

if (-not $SkipClaude) {
  if (Have 'claude') {
    Log "claude present ($(claude --version 2>$null)); checking for an update"
    try { & claude update | Out-Host } catch { }
  } else {
    Log 'installing Claude Code (native installer, auto-updates itself)'
    Invoke-Expression (Invoke-RestMethod -Uri 'https://claude.ai/install.ps1')
    Add-UserPath (Join-Path $env:USERPROFILE '.local\bin')   # the installer puts claude.exe here; make sure new terminals find it
    Refresh-Path
  }
}
if (-not $SkipCodex) {
  if (Have 'codex') {
    Log "codex present ($(codex --version 2>$null)); checking for an update"
    try { & codex update | Out-Host } catch { }
  } else {
    Log 'installing Codex CLI (official installer, self-updates with "codex update")'
    $env:CODEX_NON_INTERACTIVE = '1'
    try { Invoke-Expression (Invoke-RestMethod -Uri 'https://chatgpt.com/codex/install.ps1'); Refresh-Path }
    catch { Write-Warning "Codex installer failed: $($_.Exception.Message)" }
    if (-not (Have 'codex') -and (Have 'npm')) { Write-Warning 'falling back to npm'; Npm-Global '@openai/codex@latest'; Refresh-Path }
  }
}
if (-not $SkipGemini -and (Have 'npm')) { Log 'installing/updating Gemini CLI (npm)'; Npm-Global '@google/gemini-cli@latest' }
Refresh-Path

Log "versions on $env:COMPUTERNAME:"
foreach ($c in 'node', 'claude', 'codex', 'gemini') {
  if (Have $c) { $v = (& $c --version 2>&1 | Select-Object -First 1) } else { $v = 'MISSING' }
  Write-Host ("  {0,-7} {1}" -f $c, $v)
}
@'

Sign in once per machine, per user (open a NEW terminal first so PATH is fresh):
  claude   run `claude` (or `claude auth login`). A browser opens; over SSH press `c` to copy the
           URL, open it on any machine, then paste the code back at "Paste code here if prompted".
           No browser anywhere: `claude setup-token` on any machine with a browser prints a one-year
           token (Pro/Max/Team/Enterprise; model requests only), then here:
           $env:CLAUDE_CODE_OAUTH_TOKEN = '<token>'
           check:  claude auth status     install health:  claude doctor
  codex    run `codex login` (browser). Over SSH: `codex login --device-auth` (turn on device-code
           sign-in under ChatGPT Settings > Security first), or forward the callback port from the
           machine with the browser:  ssh -L 1455:localhost:1455 <this-host>  then `codex login`.
           API key:  $env:OPENAI_API_KEY | codex login --with-api-key
           (setting OPENAI_API_KEY on its own is not a login)
           check:  codex login status     credentials: %USERPROFILE%\.codex\auth.json
  gemini   run `gemini` and choose "Sign in with Google". Over SSH set  $env:NO_BROWSER = 'true'
           first and paste the code back. Google Workspace account (not personal Gmail): first
           $env:GOOGLE_CLOUD_PROJECT = '<project-id>'; personal Gmail must leave it unset.
           API key instead:  $env:GEMINI_API_KEY = '<key>'   (https://aistudio.google.com/app/apikey)
'@ | Write-Host
