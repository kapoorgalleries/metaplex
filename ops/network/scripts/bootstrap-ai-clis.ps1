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
  $cmd = "if ([int][Net.ServicePointManager]::SecurityProtocol -ne 0) { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 }; try { `$s = Invoke-RestMethod -Uri '$Url' -ErrorAction Stop } catch { exit 1 }; "
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
# The parent's CODEX_HOME and working directory are never modified. No OAuth/server calls.
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
  finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
}
# Settings files are read as bash reads them (utf-8-sig): a BOM is dropped and invalid UTF-8 throws.
function Read-Utf8([byte[]]$Bytes) {
  $n = if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) { 3 } else { 0 }
  return (New-Object Text.UTF8Encoding($false, $true)).GetString($Bytes, $n, $Bytes.Length - $n)
}
# Plain JSON only (RFC 8259), the grammar bash's json.loads applies once NaN and Infinity are refused.
# ConvertFrom-Json cannot be the gatekeeper: Windows PowerShell 5.1's also takes single quotes, bare
# keys and NaN, PowerShell 7's takes comments. Anything else is left for manual review. The check runs
# in .NET regexes, since a PowerShell loop over a large .claude.json takes many seconds.
$jsonString = '"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9A-Fa-f]{4}))*"'
$jsonScalar = '-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null'
$jsonToken = [regex]($jsonString + '|' + $jsonScalar + '|[{}\[\],:]')
$jsonString = [regex]$jsonString
$jsonScalar = [regex]$jsonScalar
$jsonWs = [regex]'[ \t\r\n]+'
$jsonFold = [regex]'\{(?:":[0"](?:,":[0"])*)?\}|\[(?:[0"](?:,[0"])*)?\]'
function Test-StrictJson([string]$T) {
  # Read left to right, every character outside whitespace must belong to a token.
  if ($jsonWs.Replace($jsonToken.Replace($T, ''), '') -cne '') { return $false }
  # Then the structure: strings become ", other scalars 0, and well-formed innermost arrays and
  # objects fold to 0 until a single value is left.
  $s = $jsonWs.Replace($jsonScalar.Replace($jsonString.Replace($T, '"'), '0'), '')
  do { $prev = $s; $s = $jsonFold.Replace($s, '0') } while ($s -cne $prev)
  return $s -ceq '0' -or $s -ceq '"'
}
function Skip-JsonWs([string]$T, [int]$i) {
  while ($i -lt $T.Length -and " `t`r`n".IndexOf($T[$i]) -ge 0) { $i++ }
  return $i
}
# 0 compatible, 3 absent, 1 unsupported/incompatible. Use properties, not a textual key match.
function Get-HfClientState([string]$Client) {
  $geminiDir = if ($env:GEMINI_CLI_HOME) { $env:GEMINI_CLI_HOME } else { $env:USERPROFILE }
  $cfg = Join-Path $geminiDir '.gemini\settings.json'
  if ($Client -eq 'claude') {
    $dir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { $env:USERPROFILE }
    $cfg = Join-Path $dir '.claude.json'
  }
  if (-not (Test-Path -LiteralPath $cfg)) { return 3 }
  try {
    $raw = Read-Utf8 ([IO.File]::ReadAllBytes($cfg))
    # The root must be an object: [pscustomobject] is [psobject], which a parsed array also passes.
    if (-not (Test-StrictJson $raw) -or $raw[(Skip-JsonWs $raw 0)] -cne [char]'{') { return 1 }
    $settings = $raw | ConvertFrom-Json -ErrorAction Stop
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
  } catch { return 1 }
}
# Gemini's huggingface entry is spliced into settings.json as text, so no existing byte is rewritten.
# Never `gemini mcp add` (or `remove`): Gemini 0.61 writes back the whole mcpServers map as loaded,
# with every ${VAR} already expanded, so another server's secret would be saved in the clear.
# Byte-for-byte parity with add_gemini_hf in bootstrap-ai-clis.sh; the scanner reads the top level
# only, on text Test-StrictJson has already passed.
function Skip-JsonString([string]$T, [int]$i) {
  $i++
  while ($i -lt $T.Length) {
    $c = $T[$i]
    if ($c -ceq [char]'\') { $i += 2 }
    elseif ($c -ceq [char]'"') { return $i + 1 }
    elseif ([int]$c -lt 0x20) { throw 'control character' }
    else { $i++ }
  }
  throw 'unterminated string'
}
function Skip-JsonValue([string]$T, [int]$i) {
  if ($i -ge $T.Length) { throw 'missing value' }
  $c = $T[$i]
  if ($c -ceq [char]'"') { return Skip-JsonString $T $i }
  if ($c -ceq [char]'{' -or $c -ceq [char]'[') {
    $depth = 0
    while ($i -lt $T.Length) {
      $c = $T[$i]
      if ($c -ceq [char]'"') { $i = Skip-JsonString $T $i; continue }
      if ($c -ceq [char]'/') { throw 'comment' }
      if ($c -ceq [char]'{' -or $c -ceq [char]'[') { $depth++ }
      elseif ($c -ceq [char]'}' -or $c -ceq [char]']') { $depth--; if ($depth -eq 0) { return $i + 1 } }
      $i++
    }
    throw 'unterminated value'
  }
  $j = $i
  while ($j -lt $T.Length -and ",}] `t`r`n/".IndexOf($T[$j]) -lt 0) { $j++ }
  if ($j -eq $i) { throw 'missing value' }
  return $j
}
function Add-HfToSettingsText([string]$T) {
  $nl = if ($T.Contains("`r`n")) { "`r`n" } else { "`n" }
  $tools = @($hfDeny | ForEach-Object { '    "' + $_ + '"' })
  for ($k = 0; $k -lt $tools.Count - 1; $k++) { $tools[$k] += ',' }
  # Single quotes keep ${HF_TOKEN} literal.
  $lines = @('{', ('  "url": "' + $hfUrl + '",'), '  "type": "http",', '  "headers": {',
    '    "Authorization": "Bearer ${HF_TOKEN}"', '  },', '  "excludeTools": [') + $tools + @('  ]', '}')
  $body = $lines -join ($nl + '    ')
  $i = Skip-JsonWs $T 0
  if ($i -ge $T.Length -or $T[$i] -cne [char]'{') { throw 'root is not an object' }
  $root = $i; $i = Skip-JsonWs $T ($i + 1)
  $rootEmpty = $i -lt $T.Length -and $T[$i] -ceq [char]'}'
  $servers = -1
  while (-not $rootEmpty) {
    if ($i -ge $T.Length -or $T[$i] -cne [char]'"') { throw 'expected a key' }
    $k = Skip-JsonString $T $i
    $key = ConvertFrom-Json -InputObject $T.Substring($i, $k - $i)
    $i = Skip-JsonWs $T $k
    if ($i -ge $T.Length -or $T[$i] -cne [char]':') { throw 'expected a colon' }
    $v = Skip-JsonWs $T ($i + 1)
    $i = Skip-JsonWs $T (Skip-JsonValue $T $v)
    if ($key -ceq 'mcpServers') {
      if ($servers -ge 0) { throw 'duplicate mcpServers' }
      $servers = $v
    }
    if ($i -lt $T.Length -and $T[$i] -ceq [char]',') { $i = Skip-JsonWs $T ($i + 1) }
    elseif ($i -lt $T.Length -and $T[$i] -ceq [char]'}') { break }
    else { throw 'expected a comma' }
  }
  if ($servers -lt 0) {
    $at = $root + 1
    $add = $nl + '  "mcpServers": {' + $nl + '    "huggingface": ' + $body + $nl + '  }' + $(if ($rootEmpty) { $nl } else { ',' })
  } else {
    if ($T[$servers] -cne [char]'{') { throw 'mcpServers is not an object' }
    $at = $servers + 1
    $empty = $T[(Skip-JsonWs $T $at)] -ceq [char]'}'
    $add = $nl + '    "huggingface": ' + $body + $(if ($empty) { $nl + '  ' } else { ',' })
  }
  return $T.Substring(0, $at) + $add + $T.Substring($at)
}
# The access list of an open file, as SDDL. Read from the same handle as the text, it describes the
# same version of settings.json as the text does, whatever the name points at afterwards.
function Get-HandleSddl([IO.FileStream]$Stream) {
  $sec = if ($PSVersionTable.PSEdition -ceq 'Core') { [IO.FileSystemAclExtensions]::GetAccessControl($Stream) } else { $Stream.GetAccessControl() }
  return $sec.GetSecurityDescriptorSddlForm('Access')
}
function New-FileSecurity([string]$Sddl) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetSecurityDescriptorSddlForm($Sddl)
  $acl.SetAccessRuleProtection($true, $true)
  return $acl
}
# A new, empty file carrying the access list $Sddl, set at creation: settings text never sits, even
# briefly, in a file the folder's (possibly wider) access list lets others open. Bash: mkstemp, 0600.
function New-FileLike([string]$Path, [string]$Sddl) {
  $acl = New-FileSecurity $Sddl
  $w = [Security.AccessControl.FileSystemRights]::Write
  if ($PSVersionTable.PSEdition -ceq 'Core') {
    return [IO.FileSystemAclExtensions]::Create([IO.FileInfo]$Path, [IO.FileMode]::CreateNew, $w, [IO.FileShare]::None, 4096, [IO.FileOptions]::None, $acl)
  }
  return New-Object IO.FileStream($Path, [IO.FileMode]::CreateNew, $w, [IO.FileShare]::None, 4096, [IO.FileOptions]::None, $acl)
}
function Set-FileSddl([string]$Path, [string]$Sddl) {
  # The access list only: writing back every section would include the audit list, which needs a
  # privilege this run does not hold.
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetSecurityDescriptorSddlForm($Sddl, [Security.AccessControl.AccessControlSections]::Access)
  $acl.SetAccessRuleProtection($true, $true)
  if ($PSVersionTable.PSEdition -ceq 'Core') { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$Path, $acl) } else { [IO.File]::SetAccessControl($Path, $acl) }
}
# A dated name next to settings.json that no file has yet, taken with CreateNew (New-FileLike: a
# placeholder carrying $Sddl and holding $Marker, this run's random bytes), so two runs never share
# one and nothing is overwritten. Parity with keep() in bootstrap-ai-clis.sh.
function Reserve-BackupName([string]$Dir, [string]$Stamp, [string]$Suffix, [string]$Sddl, [byte[]]$Marker) {
  for ($n = 1; $n -lt 100; $n++) {
    $name = Join-Path $Dir ("settings.json.$Stamp" + $(if ($n -gt 1) { "-$n" } else { '' }) + $Suffix)
    try { $fs = New-FileLike $name $Sddl } catch { if (Test-Path -LiteralPath $name) { continue }; throw }
    try { $fs.Write($Marker, 0, $Marker.Length) } finally { $fs.Dispose() }
    return $name
  }
  throw 'no free backup name'
}
# True only when $Path still holds exactly this run's placeholder bytes. A file that cannot be read
# (another process holds it open) or holds anything else, empty included, is never taken for one.
function Test-Placeholder([string]$Path, [byte[]]$Marker) {
  try { return [Convert]::ToBase64String([IO.File]::ReadAllBytes($Path)) -ceq [Convert]::ToBase64String($Marker) } catch { return $false }
}
# Moves $Path to a free dated name next to settings.json. Move refuses a name that exists, so nothing
# is overwritten; if no name is free, or the move fails, the file stays where it is and that path is
# returned. Parity with keep() in bootstrap-ai-clis.sh.
function Move-ToKept([string]$Dir, [string]$Stamp, [string]$Suffix, [string]$Path) {
  for ($n = 1; $n -lt 100; $n++) {
    $name = Join-Path $Dir ("settings.json.$Stamp" + $(if ($n -gt 1) { "-$n" } else { '' }) + $Suffix)
    try { [IO.File]::Move($Path, $name); return $name } catch { if (-not (Test-Path -LiteralPath $name)) { return $Path } }
  }
  return $Path
}
# 0 added; 1 unsupported layout or unwritable; 2 changed during the edit. Never logs settings text.
function Add-GeminiHf {
  $geminiDir = if ($env:GEMINI_CLI_HOME) { $env:GEMINI_CLI_HOME } else { $env:USERPROFILE }
  $dir = Join-Path $geminiDir '.gemini'
  $cfg = Join-Path $dir 'settings.json'
  $tmp = $null
  try {
    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    $exists = Test-Path -LiteralPath $cfg
    $original = $null; $bom = [byte[]]@(); $text = "{}`n"
    if ($exists) {
      # One open handle gives the text, the attributes and the access list: all of one version of
      # the file. While it is held (no write or delete sharing) the name cannot be pointed elsewhere.
      $in = [IO.File]::Open($cfg, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      try {
        # A link would be replaced by a plain file, and an EFS-encrypted file would be staged as
        # plain text: leave both for manual edit.
        $attrs = [IO.File]::GetAttributes($cfg)
        if ($attrs -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Encrypted)) { return 1 }
        $sddl = Get-HandleSddl $in
        $original = New-Object byte[] $in.Length
        $got = 0
        while ($got -lt $original.Length) {
          $n = $in.Read($original, $got, $original.Length - $got)
          if ($n -le 0) { throw 'short read' }
          $got += $n
        }
        if ($in.ReadByte() -ne -1) { throw 'file grew' }
      } finally { $in.Dispose() }
      if ($original.Length -ge 3 -and $original[0] -eq 0xEF -and $original[1] -eq 0xBB -and $original[2] -eq 0xBF) { $bom = [byte[]]@(0xEF, 0xBB, 0xBF) }
      $text = Read-Utf8 $original
    }
    if (-not (Test-StrictJson $text)) { return 1 }
    $after = Add-HfToSettingsText $text
    if (-not (Test-StrictJson $after)) { return 1 }
    # The splice must parse, carry exactly this entry, and add nothing else.
    $was = $text | ConvertFrom-Json -ErrorAction Stop
    $now = $after | ConvertFrom-Json -ErrorAction Stop
    $want = '{"url":"' + $hfUrl + '","type":"http","headers":{"Authorization":"Bearer ${HF_TOKEN}"},"excludeTools":[' + (($hfDeny | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']}'
    if ((ConvertTo-Json -InputObject $now.mcpServers.huggingface -Depth 5 -Compress) -cne $want) { return 1 }
    $wasTop = @($was.PSObject.Properties).Count; $nowTop = @($now.PSObject.Properties).Count
    $wasServers = if ($null -ne $was.mcpServers) { @($was.mcpServers.PSObject.Properties).Count } else { 0 }
    if ($nowTop -ne $wasTop + $(if ($null -eq $was.mcpServers) { 1 } else { 0 }) -or @($now.mcpServers.PSObject.Properties).Count -ne $wasServers + 1) { return 1 }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $tmp = Join-Path $dir ('.settings.json.' + [guid]::NewGuid().ToString('N') + '.tmp')
    $bytes = [byte[]]($bom + $utf8.GetBytes($after))
    if ($exists) {
      $fs = New-FileLike $tmp $sddl
      try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Dispose() }
      # Replace moves the version settings.json holds at that moment to $bak and the new text in,
      # keeping that version's attributes and access list on the name. A version other than the one
      # read above is put back, so an edit made meanwhile is never lost. The old version is kept,
      # not deleted: a process that opened settings.json before the swap and writes later writes
      # into it. Parity with the exchange in bootstrap-ai-clis.sh.
      $stamp = [DateTime]::UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'")
      $marker = [guid]::NewGuid().ToByteArray()
      $bak = Reserve-BackupName $dir $stamp '.bak' $sddl $marker  # Replace fills this run's own placeholder
      $replaced = $false
      try {
        [IO.File]::Replace($tmp, $cfg, $bak)
        $replaced = $true; $tmp = $null  # settings.json holds this run's text, $bak the version it displaced
        # The same version means the same text, access list and (no link, no EFS) attributes.
        $same = $false
        try {
          $same = ([Convert]::ToBase64String([IO.File]::ReadAllBytes($bak)) -ceq [Convert]::ToBase64String($original)) -and
            ((Get-Acl -LiteralPath $bak).GetSecurityDescriptorSddlForm('Access') -ceq $sddl) -and
            -not ([IO.File]::GetAttributes($bak) -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Encrypted))
        } catch { }
        if ($same) { Log "gemini: previous settings kept at $bak"; return 0 }
        # Two renames, not Replace: a rename goes through while another process holds the file open
        # (with delete sharing), Replace does not. The file that was settings.json for a moment is
        # kept too, under the access list of the version its text came from (Replace gave it the
        # displaced version's): a process that opened it then writes into it.
        $back = Join-Path $dir ('.settings.json.' + [guid]::NewGuid().ToString('N') + '.tmp')
        [IO.File]::Move($cfg, $back)
        [IO.File]::Move($bak, $cfg)
        $note = ''
        try { Set-FileSddl $back $sddl } catch { $note = ' (its access list could not be reset to the one it was read with; check it)' }
        $kept = Move-ToKept $dir $stamp '.rejected' $back
        Write-Warning "gemini: settings.json changed during the edit and was left as it is; this run's text is kept at $kept$note"
        return 2
      } catch {
        if ($replaced) {
          # The rollback stopped part way. Nothing is deleted: this run's text is at $cfg or $back,
          # the version it displaced at $bak.
          if (-not (Test-Path -LiteralPath $cfg)) { try { [IO.File]::Move($back, $cfg) } catch { } }
          $where = if (Test-Path -LiteralPath $cfg) { "it holds this run's text" } else { "this run's text is at $back" }
          Write-Warning "gemini: settings.json changed during the edit and could not be put back; $where, the version it displaced is at $bak"
          return 2
        } elseif (Test-Placeholder $bak $marker) {
          # Replace did not get as far as moving settings.json: $bak is still this run's placeholder.
          Remove-Item -LiteralPath $bak -Force -ErrorAction SilentlyContinue
        } elseif (-not (Test-Path -LiteralPath $cfg)) {
          # Replace moved settings.json to $bak, then failed to move the new text in: put it back.
          try { [IO.File]::Move($bak, $cfg) } catch { Write-Warning "gemini: settings.json could not be put back; it is at $bak" }
        }
        throw
      }
    } else {
      [IO.File]::WriteAllBytes($tmp, $bytes)
      if (Test-Path -LiteralPath $cfg) { return 2 }
      # Move refuses an existing name, so a file created meanwhile is never overwritten.
      try { [IO.File]::Move($tmp, $cfg) } catch { if (Test-Path -LiteralPath $cfg) { return 2 }; throw }
    }
    $tmp = $null
    return 0
  } catch { return 1 }
  finally { if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } }
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
      $rc = Add-GeminiHf
      if ($rc -eq 0 -and (Get-HfClientState 'gemini') -eq 0) { Log 'gemini: added the user huggingface MCP server' }
      elseif ($rc -eq 2) { Add-Failure 'hf-mcp-gemini' 'gemini: user settings changed during the edit; rerun' }
      else { Add-Failure 'hf-mcp-gemini' 'gemini: could not add the Hugging Face entry (unsupported settings layout or unwritable file); left unchanged' }
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
  gemini   "Sign in with Google" on a personal (free individual) account now fails: "This client
           is no longer supported for Gemini Code Assist for individuals" (seen 2026-09-26). Use an
           API key (this window only; https://aistudio.google.com/app/apikey), then run `gemini`:
           $env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', (Read-Host 'key' -AsSecureString)).Password
           Google Workspace account (not retested): $env:GOOGLE_CLOUD_PROJECT = '<project-id>', run
           `gemini` and choose "Sign in with Google"; over SSH (ssh -t) set $env:NO_BROWSER = 'true'
           first and paste the code back within 5 minutes. Personal Gmail must leave it unset.
  hf       run `hf auth login` (over SSH: ssh -t). "Log in with your browser" prints a URL and a code:
           open the URL on any machine and enter the code. "Paste an access token" reads a token at a
           hidden prompt: make one per machine at https://huggingface.co/settings/tokens > New token,
           role Read (all that downloads and the MCP server need; never Write).
           check:  hf auth whoami     ($env:HF_TOKEN, when set, overrides the stored login)
  HF MCP   codex   codex mcp login huggingface   (over SSH: ssh -t, add --no-browser, open the URL on
                   any machine, paste the redirect URL back)
           gemini  sends $env:HF_TOKEN as its bearer token. Give it to one Gemini run, from a hidden prompt:
                   $env:HF_TOKEN = [Net.NetworkCredential]::new('', (Read-Host 'HF token' -AsSecureString)).Password; try { gemini } finally { Remove-Item Env:HF_TOKEN }
                   Never run `gemini mcp add` or `gemini mcp remove` with HF_TOKEN set: they save
                   every ${VAR} in its settings file as the value, this token included.
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
