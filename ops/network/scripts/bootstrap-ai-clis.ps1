<#
Install Claude Code, OpenAI Codex CLI, Gemini CLI and the Hugging Face CLI (hf)
on this Windows machine, and register Hugging Face's MCP server with Codex and
Gemini. Claude Code and Codex are native binaries put in place by their official
installers (npm is the fallback for Codex); Gemini CLI is an npm package, so
Node.js LTS is installed for it; hf comes from its official installer, which
needs Python 3.10+, so Python 3.13 is installed when no 3.10+ is present. With
-WithGit, Git for Windows so Claude Code gets a Bash tool. Idempotent: rerun to
upgrade everything.

Needs winget (App Installer; present on Windows 10 1809+ and 11). Node's MSI
needs elevation: run from an elevated PowerShell, or over SSH as a member of
Administrators (those SSH sessions are already elevated).

Usage: powershell -ExecutionPolicy Bypass -File scripts\bootstrap-ai-clis.ps1 [-SkipClaude] [-SkipCodex] [-SkipGemini] [-SkipNode] [-SkipHf] [-WithClaudeHfMcp] [-WithGit]
  -SkipHf           no hf CLI and no Hugging Face MCP registration
  -WithClaudeHfMcp  also register the Hugging Face MCP server with Claude Code (see bootstrap-ai-clis.sh, register_hf_mcp)
#>
param([switch]$SkipClaude, [switch]$SkipCodex, [switch]$SkipGemini, [switch]$SkipNode, [switch]$SkipHf, [switch]$WithClaudeHfMcp, [switch]$WithGit)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# hf prints a once-a-day update/skill hint on stderr, which the version probes would read (and which
# Windows PowerShell turns into an error when stderr is redirected). Only the hints; `hf update` still checks.
$env:HF_HUB_DISABLE_UPDATE_CHECK = '1'

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
  # benign codes: 0x8A15002B no applicable update, 0x8A150061 already installed, 0x8A15010D newer version present, 0x8A15004F nothing to do
  $benign = 0, -1978335189, -1978335135, -1978334963, -1978335153
  if ($benign -notcontains $LASTEXITCODE) { throw "winget install $id failed ($LASTEXITCODE)" }
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
# Output and exit code of a native command. Windows PowerShell 5.1 turns redirected stderr into a
# terminating error under 'Stop', so relax it for the call.
function Native($block) {
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $global:LASTEXITCODE = 1   # stays 1 if the command never starts
  try { $out = (& $block 2>&1 | Out-String).Trim(); $rc = $LASTEXITCODE } catch { $out = "$_"; $rc = 1 }
  finally { $ErrorActionPreference = $eap }
  return @{ Out = $out; Code = $rc }
}
# The hf installer builds a venv, so it needs Python 3.10+ and installs none. The WindowsApps
# python.exe stub prints no version, so it counts as missing.
function Python-Ok {
  foreach ($probe in { py -3 --version }, { python --version }) {
    if ((Native $probe).Out -match 'Python 3\.(\d+)\.' -and [int]$Matches[1] -ge 10) { return $true }
  }
  return $false
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

# Hugging Face CLI through its official installer: a venv in %USERPROFILE%\.hf-cli, hf.exe copied to
# %USERPROFILE%\.local\bin. The installer also runs `hf skills add hf-cli --global`: the hf-cli agent
# skill lands in ~\.agents\skills (Codex, Gemini) and ~\.claude\skills (Claude Code; a copy when
# symlinks need Developer Mode), so there is no separate skill step, and `hf update` refreshes it.
# It runs in a child PowerShell because it ends with `exit 1` on failure, which would end this
# script too. winget's Python.Python.3.13 sets PrependPath=1, so the child finds python.
if (-not $SkipHf) {
  if (Have 'hf') {
    Log "hf present ($(hf --version 2>$null)); checking for an update"
    try { & hf update | Out-Host } catch { }
    # hf update never re-adds a skill that was skipped or removed; a pip install never had it.
    if (-not (Test-Path (Join-Path $env:USERPROFILE '.agents\skills\hf-cli'))) { Write-Warning 'the hf-cli agent skill is not installed; add it with: hf skills add --global' }
  } else {
    try {
      if (-not (Python-Ok)) { Log 'installing Python 3.13 (the hf installer needs 3.10+)'; Winget-Install 'Python.Python.3.13'; Refresh-Path }
      Log 'installing Hugging Face CLI (official installer; also installs the hf-cli agent skill)'
      # -NoModifyPath: Add-UserPath owns the user PATH, as for Claude Code.
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; & ([scriptblock]::Create((Invoke-RestMethod -Uri 'https://hf.co/cli/install.ps1'))) -NoModifyPath" | Out-Host
      if ($LASTEXITCODE -ne 0) { throw "installer exited $LASTEXITCODE" }
      Add-UserPath (Join-Path $env:USERPROFILE '.local\bin')
      if (-not (Have 'hf')) { throw 'hf.exe is not in %USERPROFILE%\.local\bin after the installer ran' }
    } catch { Write-Warning "hf install failed: $($_.Exception.Message). It needs Python 3.10+ and access to hf.co and pypi.org." }
  }

  # Hugging Face's MCP server, user scope, added only when missing so a hand-made entry is never
  # replaced. Why Codex gets OAuth through an appended table, Gemini a bearer header from $HF_TOKEN,
  # and Claude Code nothing unless -WithClaudeHfMcp: see register_hf_mcp in bootstrap-ai-clis.sh.
  $hfUrl = 'https://huggingface.co/mcp'
  $hfDeny = 'hf_jobs', 'create_repo', 'dynamic_space', 'hf_sandbox', 'hf_sandbox_exec', 'hf_sandbox_fs'
  if (-not $SkipCodex -and (Have 'codex')) {
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $cfg = Join-Path $codexHome 'config.toml'
    $known = ((Native { codex mcp get huggingface }).Code -eq 0) -or
             ((Test-Path $cfg) -and (Select-String -Path $cfg -Pattern '^\s*\[mcp_servers\."?huggingface"?\s*\]' -Quiet))
    if ($known) { Log 'codex: huggingface MCP server already configured; left as is' }
    else {
      New-Item -ItemType Directory -Force -Path $codexHome | Out-Null
      $toml = @('', '# Hugging Face MCP (ops/network bootstrap). Sign in once: codex mcp login huggingface',
                 '[mcp_servers.huggingface]', ('url = "{0}?login"' -f $hfUrl),
                 ('disabled_tools = [{0}]' -f (($hfDeny | ForEach-Object { '"' + $_ + '"' }) -join ', ')))
      [IO.File]::AppendAllText($cfg, ($toml -join "`n") + "`n")   # UTF-8 without a BOM
      Log 'codex: added the huggingface MCP server'
    }
  }
  if (-not $SkipGemini -and (Have 'gemini')) {
    $gcfg = Join-Path $env:USERPROFILE '.gemini\settings.json'
    if ((Test-Path $gcfg) -and (Select-String -Path $gcfg -Pattern '"huggingface"\s*:' -Quiet)) { Log 'gemini: huggingface MCP server already configured; left as is' }
    else {
      # Single quotes keep ${HF_TOKEN} for Gemini to expand; options after the positionals (--exclude-tools takes several values).
      $r = Native { gemini mcp add -s user -t http huggingface $hfUrl -H 'Authorization: Bearer ${HF_TOKEN}' --exclude-tools @hfDeny }
      if ($r.Code -eq 0) { Log 'gemini: added the huggingface MCP server' } else { Write-Warning "gemini mcp add failed: $($r.Out)" }
    }
  }
  if ($WithClaudeHfMcp -and -not $SkipClaude -and (Have 'claude')) {
    $r = Native { claude mcp add --scope user --transport http huggingface "$($hfUrl)?login" }
    if ($r.Code -eq 0) { Log 'claude: added the huggingface MCP server' }
    elseif ($r.Out -match 'already exists') { Log 'claude: huggingface MCP server already configured; left as is' }
    else { Write-Warning "claude mcp add failed: $($r.Out)" }
  }
}
Refresh-Path

Log "versions on $env:COMPUTERNAME:"
foreach ($c in 'node', 'claude', 'codex', 'gemini', 'hf') {
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
           (If ANTHROPIC_API_KEY is set, Claude Code bills that key instead of the subscription: remove it here.)
  codex    run `codex login` (browser). Over SSH: `codex login --device-auth` (turn on device-code
           sign-in under ChatGPT Settings > Security first), or forward the callback port from the
           machine with the browser:  ssh -L 1455:localhost:1455 <this-host>  then `codex login`.
           API key:  $env:OPENAI_API_KEY | codex login --with-api-key
           (setting OPENAI_API_KEY on its own is not a login)
           check:  codex login status     credentials: %USERPROFILE%\.codex\auth.json
  gemini   run `gemini` and choose "Sign in with Google". Over SSH (with a terminal: ssh -t) set
           $env:NO_BROWSER = 'true'  first and paste the code back within 5 minutes.
           Google Workspace account (not personal Gmail): first
           $env:GOOGLE_CLOUD_PROJECT = '<project-id>'; personal Gmail must leave it unset.
           API key instead:  $env:GEMINI_API_KEY = '<key>'   (https://aistudio.google.com/app/apikey)
  hf       run `hf auth login` (over SSH: ssh -t). "Log in with your browser" prints a URL and a code:
           open the URL on any machine and enter the code. "Paste an access token" reads a token at a
           hidden prompt: make one per machine at https://huggingface.co/settings/tokens > New token,
           role Read (all that downloads and the MCP server need; never Write).
           check:  hf auth whoami     ($env:HF_TOKEN, when set, overrides the stored login)
  HF MCP   codex   codex mcp login huggingface   (over SSH: ssh -t, add --no-browser, open the URL on
                   any machine, paste the redirect URL back)
           gemini  sends $env:HF_TOKEN as its bearer token; unset, it gets HF's anonymous read-only tools.
                   Start it with the token hf already stored, so it is never typed or copied to a file:
                   $env:HF_TOKEN = hf auth token; gemini
                   Gemini loads MCP servers only in folders it trusts (it asks on the first run there).
           claude  the account's Hugging Face connector comes with the claude.ai login (/mcp lists it).
                   Signed in with setup-token or an API key? Rerun this script with -WithClaudeHfMcp,
                   then  claude mcp login huggingface   (--no-browser over SSH)
           Which tools every client sees is set per account at https://huggingface.co/settings/mcp:
           keep Jobs, Contribute Repos, Sandboxes and Dynamic Spaces off (they create repos, run code
           or can spend credits).
'@ | Write-Host
