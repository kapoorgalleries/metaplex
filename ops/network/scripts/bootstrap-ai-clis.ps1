<#
Install Claude Code, OpenAI Codex CLI and Gemini CLI on this Windows machine,
plus Node.js LTS (Codex and Gemini are npm packages and need Node 20+) and,
with -WithGit, Git for Windows so Claude Code gets a Bash tool. Idempotent:
rerun to upgrade everything.

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
function Winget-Install($id) {
  & winget install --id $id -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { throw "winget install $id failed ($LASTEXITCODE)" }  # -1978335189 = already installed
}
function Npm-Global($pkg) {
  & npm install -g --no-fund --no-audit $pkg 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "npm install -g $pkg failed" }
}

if (-not (Have 'winget')) { throw "winget not found. Install 'App Installer' from the Microsoft Store, then rerun." }

if (-not $SkipNode -and -not ($SkipCodex -and $SkipGemini)) {
  $ok = $false
  if (Have 'node') { $ok = ([int]((node --version).TrimStart('v').Split('.')[0])) -ge 20 }
  if ($ok) { Log "node $(node --version) present" }
  else { Log 'installing Node.js LTS (Codex and Gemini need 20+)'; Winget-Install 'OpenJS.NodeJS.LTS'; Refresh-Path }
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
    Refresh-Path
  }
}
if (-not $SkipCodex  -and (Have 'npm')) { Log 'installing/updating Codex CLI';  Npm-Global '@openai/codex@latest' }
if (-not $SkipGemini -and (Have 'npm')) { Log 'installing/updating Gemini CLI'; Npm-Global '@google/gemini-cli@latest' }
Refresh-Path

Log "versions on $env:COMPUTERNAME:"
foreach ($c in 'node', 'claude', 'codex', 'gemini') {
  if (Have $c) { $v = (& $c --version 2>&1 | Select-Object -First 1) } else { $v = 'MISSING' }
  Write-Host ("  {0,-7} {1}" -f $c, $v)
}
@'

Sign in once per machine, per user (open a NEW terminal first so PATH is fresh):
  claude   run `claude`. A browser opens. Over SSH press `c` to copy the URL, open it on any
           machine, then paste the code back at "Paste code here if prompted".
           No-browser alternative: on a machine that is already signed in run `claude setup-token`,
           then on this machine  $env:CLAUDE_CODE_OAUTH_TOKEN = '<token>'  (needs a Pro/Max/Team plan).
  codex    run `codex login` (browser), or over SSH  `codex login --device-auth`.
           API key instead:  $env:OPENAI_API_KEY | codex login --with-api-key
           check with:  codex login status
  gemini   run `gemini` and choose "Login with Google". Over SSH set  $env:NO_BROWSER = 'true'
           first and paste the code back, or use an AI Studio key:  $env:GEMINI_API_KEY = '<key>'
'@ | Write-Host
