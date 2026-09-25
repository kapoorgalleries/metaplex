<#
Install Claude Code, OpenAI Codex CLI, Gemini CLI and the Hugging Face CLI (hf)
on this Windows machine, and register Hugging Face's MCP server with Codex and
Gemini. Claude Code, Codex and hf are put in place by their official installers,
each run in a child PowerShell so that its own exit or StrictMode cannot end
this script (npm is the fallback for Codex); Gemini CLI is an npm package, so
Node.js LTS is installed for it; hf's installer needs Python 3.10+, so Python
3.13 is installed when no 3.10+ is present. Idempotent: rerun to upgrade.

winget (App Installer; present on Windows 10 1809+ and 11) is needed only to
install Node.js, Python or Git. Node's MSI needs elevation: run from an elevated
PowerShell, or over SSH as a member of Administrators (those SSH sessions are
already elevated).

Usage: powershell -ExecutionPolicy Bypass -File scripts\bootstrap-ai-clis.ps1 [-SkipClaude] [-SkipCodex] [-SkipGemini] [-SkipNode] [-WithNode] [-SkipHf] [-WithClaudeHfMcp] [-WithGit]
  -SkipClaude, -SkipCodex, -SkipGemini   leave that CLI alone
  -SkipHf           no hf CLI and no Hugging Face MCP registration
  -WithClaudeHfMcp  also register the Hugging Face MCP server with Claude Code (see register_hf_mcp in bootstrap-ai-clis.sh)
  -SkipNode    never install Node.js (Gemini then needs Node 20+ already)
  -WithNode    install Node.js 20+ even when Gemini is skipped (the trimurti-ops MCP server needs it)
  -WithGit     also install Git for Windows (the Bash tool for Claude Code)
  -h, --help   this text
  The bootstrap-ai-clis.sh spellings work too: --skip-claude --skip-codex --skip-gemini --skip-node --with-node --skip-hf --with-claude-hf-mcp --with-git
Exit: 0 every requested CLI is installed, 1 something failed (the last line says what), 2 bad arguments.
#>
$ErrorActionPreference = 'Stop'

function Show-Usage([int]$Code, [string]$Why) {
  $text = (((Get-Content -LiteralPath $PSCommandPath -Raw) -split '#>')[0] -replace '^\s*<#\r?\n', '').TrimEnd()
  if ($Code -eq 0) { Write-Host $text } else { [Console]::Error.WriteLine("$Why`n$text") }
  exit $Code
}
$SkipClaude = $false; $SkipCodex = $false; $SkipGemini = $false; $SkipNode = $false; $WithNode = $false; $WithGit = $false
$SkipHf = $false; $WithClaudeHfMcp = $false
foreach ($a in $args) {
  switch -regex ("$a") {
    '^(-h|-help|--help|-\?|/\?)$'   { Show-Usage 0 }
    '^(-SkipClaude|--skip-claude)$' { $SkipClaude = $true }
    '^(-SkipCodex|--skip-codex)$'   { $SkipCodex = $true }
    '^(-SkipGemini|--skip-gemini)$' { $SkipGemini = $true }
    '^(-SkipNode|--skip-node)$'     { $SkipNode = $true }
    '^(-WithNode|--with-node)$'     { $WithNode = $true }
    '^(-SkipHf|--skip-hf)$'         { $SkipHf = $true }
    '^(-WithClaudeHfMcp|--with-claude-hf-mcp)$' { $WithClaudeHfMcp = $true }
    '^(-WithGit|--with-git)$'       { $WithGit = $true }
    default                         { Show-Usage 2 "unknown argument: $a" }
  }
}

# TLS 1.2 for PSGallery and the installers where .NET does not leave the choice to Windows
if ([int][Net.ServicePointManager]::SecurityProtocol -ne 0) { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 }
$PsExe = (Get-Process -Id $PID).Path
$Failed = New-Object System.Collections.Generic.List[string]
# hf prints a once-a-day update/skill hint on stderr, which a version probe would read (and which
# Windows PowerShell turns into an error when stderr is redirected). Only the hints; `hf update` still checks.
$env:HF_HUB_DISABLE_UPDATE_CHECK = '1'

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
# A vendor's install.ps1 in a child PowerShell: an 'exit' or Set-StrictMode in it stays there. Returns
# its exit code. $Flags go to the script's own param block (hf's -NoModifyPath), which Invoke-Expression cannot pass.
function Invoke-Installer([string]$Url, [string]$Flags = '') {
  # Only the download is made terminating: a vendor installer that relies on the default 'Continue'
  # (Windows PowerShell 5.1 turns redirected native stderr into error records) keeps working.
  $cmd = "if ([int][Net.ServicePointManager]::SecurityProtocol -ne 0) { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 }; try { `$s = Invoke-RestMethod -Uri '$Url' -ErrorAction Stop } catch { [Console]::Error.WriteLine(`$_.Exception.Message); exit 1 }; "
  if ($Flags) { $cmd += "& ([scriptblock]::Create(`$s)) $Flags" }
  else { $cmd += "Invoke-Expression `$s" }
  return (Invoke-Native $PsExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd))
}
# Put a directory on the user's persistent PATH (and this session's) once.
function Add-UserPath($dir) {
  $u = "$([Environment]::GetEnvironmentVariable('Path', 'User'))"
  if (($u -split ';') -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', ($u.TrimEnd(';') + ';' + $dir).TrimStart(';'), 'User') }
  if (($env:Path -split ';') -notcontains $dir) { $env:Path += ";$dir" }
}
# A native command's output (stdout and stderr as text) and exit code, for a check.
function Invoke-Captured([string]$Exe, [string[]]$ArgList = @()) {
  $ErrorActionPreference = 'Continue'
  $global:LASTEXITCODE = 1   # stays 1 if the command never starts
  try { $out = (& $Exe @ArgList 2>&1 | ForEach-Object { "$_" }) -join "`n" } catch { $out = $_.Exception.Message }
  return @{ Out = "$out".Trim(); Code = $LASTEXITCODE }
}
# The hf installer builds a venv, so it needs Python 3.10+ and installs none. The WindowsApps
# python.exe stub prints no version, so it counts as missing.
function Test-Python {
  foreach ($probe in @(@('py', '-3', '--version'), @('python', '--version'))) {
    if (-not (Have $probe[0])) { continue }
    $r = Invoke-Captured $probe[0] $probe[1..($probe.Count - 1)]
    if ($r.Code -eq 0 -and $r.Out -match 'Python 3\.(\d+)\.' -and [int]$Matches[1] -ge 10) { return $true }
  }
  return $false
}
# A child process reads a candidate user config in isolation, without this checkout's MCP entry.
# The parent's CODEX_HOME and working directory are never modified. Codex performs bounded
# OAuth-discovery requests for each HTTP server in that config (failures tolerated) and consults
# its OAuth token store; it starts no server and triggers no login.
function Invoke-CodexConfig([string]$Dir, [string]$Action) {
  $quoted = $Dir.Replace("'", "''")
  $cmd = "`$ErrorActionPreference = 'Stop'; `$env:CODEX_HOME = '$quoted'; Set-Location -LiteralPath '$quoted'; try { `$ErrorActionPreference = 'Continue'; `$global:LASTEXITCODE = 1; & codex mcp $Action --json 2>`$null; exit `$LASTEXITCODE } catch { exit 1 }"
  return (Invoke-Captured $PsExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd))
}
function Test-HfCodexEntry([string]$Json) {
  try {
    $entry = $Json | ConvertFrom-Json -ErrorAction Stop
    if ($entry.enabled -eq $false -or @('https://huggingface.co/mcp', 'https://huggingface.co/mcp?login') -cnotcontains $entry.transport.url) { return $false }
    foreach ($tool in $hfDeny) { if (@($entry.disabled_tools) -cnotcontains $tool) { return $false } }
    return $true
  } catch { return $false }
}
function Register-CodexHf {
  $userDir = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
  $cfg = Join-Path $userDir 'config.toml'
  $stage = Join-Path ([IO.Path]::GetTempPath()) ('trimurti-hf-mcp-' + [guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    $candidate = Join-Path $stage 'config.toml'
    $exists = Test-Path -LiteralPath $cfg
    $original = $null
    if ($exists) { $original = [IO.File]::ReadAllBytes($cfg); [IO.File]::WriteAllBytes($candidate, $original) }
    if ((Invoke-CodexConfig $stage 'list').Code -ne 0) { throw 'user config could not be parsed; left unchanged' }
    $entry = Invoke-CodexConfig $stage 'get huggingface'
    if ($entry.Code -eq 0) {
      if (-not (Test-HfCodexEntry $entry.Out)) { throw 'existing user huggingface entry has an incompatible URL, disabled server, or missing blocked tools; left unchanged' }
      Log 'codex: compatible user huggingface MCP server already configured; left as is'; return
    }
    $addition = (@('', '# Hugging Face MCP (ops/network bootstrap). Sign in once: codex mcp login huggingface',
      '[mcp_servers.huggingface]', ('url = "{0}?login"' -f $hfUrl),
      ('disabled_tools = [{0}]' -f (($hfDeny | ForEach-Object { '"' + $_ + '"' }) -join ', '))) -join "`n") + "`n"
    [IO.File]::AppendAllText($candidate, $addition)
    $entry = Invoke-CodexConfig $stage 'get huggingface'
    if ($entry.Code -ne 0 -or -not (Test-HfCodexEntry $entry.Out)) { throw 'cannot safely append to this user config; left unchanged. Add the Hugging Face entry manually.' }
    if ($exists) {
      if (-not (Test-Path -LiteralPath $cfg) -or [Convert]::ToBase64String([IO.File]::ReadAllBytes($cfg)) -cne [Convert]::ToBase64String($original)) { throw 'user config changed during validation; rerun' }
    } elseif (Test-Path -LiteralPath $cfg) { throw 'user config appeared during validation; rerun' }
    New-Item -ItemType Directory -Force -Path $userDir | Out-Null
    [IO.File]::AppendAllText($cfg, $addition) # Preserve existing bytes, permissions and user entries.
    Log 'codex: added the user huggingface MCP server'
  } catch { Add-Failure 'hf-mcp-codex' "codex: $($_.Exception.Message)" }
  finally {
    try { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction Stop } }
    catch { Write-Warning "codex: could not remove the staging directory $stage" }
  }
}
# claude mcp get answers from the merged configuration: exit 1 when the server is absent, otherwise a
# text block whose Scope, Type and URL lines identify a compatible user-scope entry. It also probes the
# server, so it may take a moment offline; the result is decided by the config lines alone.
function Get-ClaudeHfStateFromCli {
  $r = Invoke-Captured 'claude' @('mcp', 'get', 'huggingface')
  if ($r.Code -ne 0) { return 3 }
  $urlPattern = '(?m)^\s*URL:\s*' + [regex]::Escape($hfUrl) + '(\?login)?\s*$'
  if ($r.Out -match '(?m)^\s*Scope:\s*User config' -and $r.Out -match '(?m)^\s*Type:\s*http\s*$' -and $r.Out -match $urlPattern) { return 0 }
  return 1
}
# 0 compatible, 3 absent, 1 unsupported/incompatible. Use properties, not a textual key match.
# PS 5.1 ConvertFrom-Json does not accept comments: preserve those settings for manual review.
function Get-HfClientState([string]$Client) {
  $geminiDir = if ($env:GEMINI_CLI_HOME) { $env:GEMINI_CLI_HOME } else { $env:USERPROFILE }
  $cfg = Join-Path $geminiDir '.gemini\settings.json'
  if ($Client -eq 'claude') {
    $dir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { $env:USERPROFILE }
    $cfg = Join-Path $dir '.claude.json'
  }
  if (-not (Test-Path -LiteralPath $cfg)) { return 3 }
  try {
    $settings = [IO.File]::ReadAllText($cfg) | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $settings -or $settings -isnot [pscustomobject]) { return 1 }
    $servers = $settings.mcpServers
    # A present-but-null mcpServers needs manual review, as in the bash validator; absent means absent.
    if ($null -eq $servers) { if ($settings.PSObject.Properties['mcpServers']) { return 1 }; return 3 }
    if ($servers -isnot [pscustomobject]) { return 1 }
    $property = $servers.PSObject.Properties | Where-Object { $_.Name -ceq 'huggingface' } | Select-Object -First 1
    if ($null -eq $property) { return 3 }
    $entry = $property.Value
    if ($Client -eq 'claude') {
      if ($entry.type -cne 'http' -or @($hfUrl, "$($hfUrl)?login") -cnotcontains $entry.url) { return 1 }
    } else {
      # Gemini CLI 0.61 writes url + type "http"; older settings carry the deprecated httpUrl. Both count.
      $gurl = if ($entry.PSObject.Properties['httpUrl']) { $entry.httpUrl } elseif ($entry.type -ceq 'http') { $entry.url } else { $null }
      if (@($hfUrl, "$($hfUrl)?login") -cnotcontains $gurl) { return 1 }
      foreach ($tool in $hfDeny) { if (@($entry.excludeTools) -cnotcontains $tool) { return 1 } }
    }
    return 0
  } catch {
    if ($Client -ne 'claude') { return 1 }
    # Claude Code's user store also carries per-project history, and ConvertFrom-Json rejects any
    # object whose keys differ only in case (two spellings of one project path). Ask the CLI about
    # the single entry instead of parsing the whole file.
    return (Get-ClaudeHfStateFromCli)
  }
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

# Hugging Face CLI through its official installer: a venv in %USERPROFILE%\.hf-cli, hf.exe copied to
# %USERPROFILE%\.local\bin. The installer also runs `hf skills add hf-cli --global`: the hf-cli agent
# skill lands in ~\.agents\skills (Codex, Gemini) and ~\.claude\skills (Claude Code; a copy when
# symlinks need Developer Mode), so there is no separate skill step, and `hf update` refreshes it.
# winget's Python.Python.3.13 sets PrependPath=1, so the installer's child PowerShell finds python.
if (-not $SkipHf) {
  if (Have 'hf') {
    Log "hf present ($(Get-CliVersion 'hf')); checking for an update"
    if ((Invoke-Native 'hf' @('update')) -ne 0) { Add-Failure 'hf' "'hf update' failed" }
    # hf update never re-adds a skill that was skipped or removed; a pip install never had it.
    if (-not (Test-Path (Join-Path $env:USERPROFILE '.agents\skills\hf-cli'))) { Write-Warning 'the hf-cli agent skill is not installed; add it with: hf skills add --global' }
  } else {
    if (-not (Test-Python)) {
      Log 'installing Python 3.13 (the hf installer needs 3.10+)'
      if (Winget-Install 'Python.Python.3.13') { Refresh-Path }
    }
    if (-not (Test-Python)) { Add-Failure 'hf' 'hf needs Python 3.10+ (py -3 or python on PATH): install it and rerun' }
    else {
      Log 'installing Hugging Face CLI (official installer; also installs the hf-cli agent skill)'
      # -NoModifyPath: Add-UserPath owns the user PATH, as for Claude Code.
      $rc = Invoke-Installer 'https://hf.co/cli/install.ps1' '-NoModifyPath'
      if ($env:USERPROFILE) { Add-UserPath (Join-Path $env:USERPROFILE '.local\bin') }
      Refresh-Path
      if ($rc -ne 0 -or -not (Have 'hf')) { Add-Failure 'hf' "hf install FAILED (installer exit $rc; https://hf.co/cli/install.ps1 needs Python 3.10+ and access to hf.co and pypi.org)" }
    }
  }

  # Validate user entries without logging config contents, which may hold credentials.
  $hfUrl = 'https://huggingface.co/mcp'
  $hfDeny = 'hf_jobs', 'create_repo', 'dynamic_space', 'hf_sandbox', 'hf_sandbox_exec', 'hf_sandbox_fs'
  if (-not $SkipCodex -and (Have 'codex')) { Register-CodexHf }
  if (-not $SkipGemini -and (Have 'gemini')) {
    $state = Get-HfClientState 'gemini'
    if ($state -eq 0) { Log 'gemini: compatible user huggingface MCP server already configured; left as is' }
    elseif ($state -eq 3) {
      # Single quotes preserve the placeholder, so neither argv nor settings contain the token value.
      $r = Invoke-Captured 'gemini' (@('mcp', 'add', '-s', 'user', '-t', 'http', 'huggingface', $hfUrl, '-H', 'Authorization: Bearer ${HF_TOKEN}', '--exclude-tools') + $hfDeny)
      if ($r.Code -eq 0 -and (Get-HfClientState 'gemini') -eq 0) { Log 'gemini: added the user huggingface MCP server' }
      else { Add-Failure 'hf-mcp-gemini' 'gemini: Hugging Face MCP registration failed; check user settings' }
    } else { Add-Failure 'hf-mcp-gemini' 'gemini: user settings need manual review (commented/unsupported JSON, incompatible URL or missing blocked tools); left unchanged' }
  }
  if ($WithClaudeHfMcp -and -not $SkipClaude -and (Have 'claude')) {
    $state = Get-HfClientState 'claude'
    if ($state -eq 0) { Log 'claude: compatible user huggingface MCP server already configured; left as is' }
    elseif ($state -eq 3) {
      $r = Invoke-Captured 'claude' @('mcp', 'add', '--scope', 'user', '--transport', 'http', 'huggingface', "$($hfUrl)?login")
      if ($r.Code -eq 0 -and (Get-HfClientState 'claude') -eq 0) { Log 'claude: added the user huggingface MCP server' }
      else { Add-Failure 'hf-mcp-claude' 'claude: Hugging Face MCP registration failed; check user settings' }
    } else { Add-Failure 'hf-mcp-claude' 'claude: user settings or the existing huggingface URL could not be validated; left unchanged' }
    Log 'claude: verify account MCP tool restrictions before use; registration does not apply per-tool blocks'
  }
}
Refresh-Path

Log "versions on ${env:COMPUTERNAME}:"
foreach ($c in 'node', 'claude', 'codex', 'gemini', 'hf') {
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
  hf       run `hf auth login` (over SSH: ssh -t). "Log in with your browser" prints a URL and a code:
           open the URL on any machine and enter the code. "Paste an access token" reads a token at a
           hidden prompt: make one per machine at https://huggingface.co/settings/tokens > New token,
           role Read (all that downloads and the MCP server need; never Write).
           check:  hf auth whoami     ($env:HF_TOKEN, when set, overrides the stored login)
  HF MCP   codex   codex mcp login huggingface   (over SSH: ssh -t, add --no-browser, open the URL on
                   any machine, paste the redirect URL back)
           gemini  sends $env:HF_TOKEN as its bearer token. Set it before starting Gemini.
                   Set the token at a hidden prompt in your terminal, then start Gemini:
                   $env:HF_TOKEN = [Net.NetworkCredential]::new('', (Read-Host 'HF token' -AsSecureString)).Password; gemini
                   Gemini loads MCP servers only in folders it trusts (it asks on the first run there).
           claude  the account's Hugging Face connector comes with the claude.ai login (/mcp lists it).
                   Signed in with setup-token or an API key? Rerun this script with -WithClaudeHfMcp,
                   then  claude mcp login huggingface   (--no-browser over SSH)
           Which tools every client sees is set per account at https://huggingface.co/settings/mcp:
           keep Jobs, Contribute Repos, Sandboxes and Dynamic Spaces off (they create repos, run code
           or can spend credits).
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
