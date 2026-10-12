# dc-diagnose.ps1: read-only snapshot of one Windows machine for the Trimurti job, run through Desktop
# Commander, which has no terminal and few calls to spare. One run writes everything an agent needs into
# %USERPROFILE%\trimurti-dc\<host>-diag-latest.md (and a stamped copy), so the report costs one read.
# Changes nothing on the machine. Prints the names of secrets (set / not set), never a value: no token,
# key or password is read, echoed or stored. Every external command runs with stdin closed and a
# timeout, so nothing can wait for input. Windows PowerShell 5.1 is enough.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$t0 = Get-Date
$env:CI = '1'; $env:NO_COLOR = '1'; $env:TERM = 'dumb'; $env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
$H = $env:USERPROFILE
# Tools installed after the Desktop Commander app started are not on its PATH: rebuild it from the
# registry-backed Machine and User values plus the folders the kit's bootstrap uses.
$extra = @((Join-Path $H '.local\bin'), (Join-Path $env:APPDATA 'npm'), (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'), (Join-Path $env:ProgramFiles 'Git\cmd'), (Join-Path $env:ProgramFiles 'nodejs'))
$env:Path = (@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path) + $extra) -join ';'
$dir = Join-Path $H 'trimurti-dc'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$me = $env:COMPUTERNAME
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $dir "$me-diag-$stamp.md"
$latest = Join-Path $dir "$me-diag-latest.md"
$L = New-Object System.Collections.Generic.List[string]
function W([string]$s) { $script:L.Add($s) }
function Sec([string]$t) { W ''; W "## $t" }
function Clip([string]$s, [int]$n = 220) { if ($s.Length -gt $n) { $s.Substring(0, $n) + ' …' } else { $s } }
function Lines($text, [int]$max = 14) {
  $ls = @(([string]$text) -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
  foreach ($l in ($ls | Select-Object -First $max)) { W ('    ' + (Clip $l)) }
  if ($ls.Count -gt $max) { W ("    … {0} more lines" -f ($ls.Count - $max)) }
}
# Run a command line through cmd.exe (so .cmd and .exe shims resolve the same way a user's shell does),
# stdin from NUL, output to a temp file, killed with its children when it outlives the timeout.
function Run([string]$label, [string]$cmd, [int]$sec = 45) {
  $tf = [IO.Path]::GetTempFileName()
  $argl = ('/d /s /c "{0} > "{1}" 2>&1 <nul"' -f $cmd, $tf)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $to = $false; $code = 'n/a'
  try {
    $p = Start-Process -FilePath $env:ComSpec -ArgumentList $argl -WindowStyle Hidden -PassThru
    if (-not $p.WaitForExit($sec * 1000)) { $to = $true; Start-Process -FilePath 'taskkill.exe' -ArgumentList "/PID $($p.Id) /T /F" -WindowStyle Hidden -Wait | Out-Null }
    else { $code = $p.ExitCode }
  } catch { W ("- **{0}**: could not start: {1}" -f $label, (Clip $_.Exception.Message)); return }
  $sw.Stop()
  $o = ''
  if (Test-Path $tf) { $o = Get-Content -LiteralPath $tf -Raw -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $tf -Force -ErrorAction SilentlyContinue }
  $flag = ''; if ($to) { $flag = ', TIMEOUT after ' + $sec + 's' }
  W ('- **{0}** `{1}` (exit {2}, {3:n1}s{4})' -f $label, $cmd, $code, $sw.Elapsed.TotalSeconds, $flag)
  if ([string]::IsNullOrWhiteSpace($o)) { W '    (no output)' } else { Lines $o }
}
function Has([string]$p) { if (Test-Path -LiteralPath $p) { 'yes' } else { 'no' } }
function Where1([string]$n) { $c = Get-Command $n -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.Source } else { '-' } }
function JsonKeys([string]$path, [string]$prop) {
  try {
    $j = Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($prop) { $j = $j.$prop }
    if ($null -eq $j) { return '(none)' }
    $k = @($j.PSObject.Properties | ForEach-Object { $_.Name }); if ($k.Count -eq 0) { '(none)' } else { $k -join ', ' }
  } catch { 'unreadable: ' + (Clip $_.Exception.Message 80) }
}
function DirNames([string]$p) { if (Test-Path -LiteralPath $p) { $n = @(Get-ChildItem -LiteralPath $p -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }); if ($n.Count) { $n -join ', ' } else { '(empty)' } } else { '(absent)' } }

W "# DC-DIAG BEGIN $me $stamp"
W "report: $out"

Sec 'System'
try {
  $os = Get-CimInstance Win32_OperatingSystem
  $up = (Get-Date) - $os.LastBootUpTime
  W ("- OS: {0} {1} build {2} ({3}); PowerShell {4}; CPU arch {5}" -f $os.Caption, $os.Version, $os.BuildNumber, $os.OSArchitecture, $PSVersionTable.PSVersion, $env:PROCESSOR_ARCHITECTURE)
  W ("- Up {0}d {1}h since {2}; RAM {3:n1}/{4:n1} GB free" -f $up.Days, $up.Hours, $os.LastBootUpTime, ($os.FreePhysicalMemory / 1MB), ($os.TotalVisibleMemorySize / 1MB))
} catch { W "- OS: unreadable ($_)" }
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$elev = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
W ("- Running as {0}; elevated token: {1}" -f $id.Name, $elev)
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | ForEach-Object { W ("- Disk {0} {1:n0}/{2:n0} GB free" -f $_.DeviceID, ($_.FreeSpace / 1GB), ($_.Size / 1GB)) }
try { $mp = Get-MpComputerStatus -ErrorAction Stop; W ("- Defender: mode {0}; real-time {1}; signatures {2}; last quick scan {3}" -f $mp.AMRunningMode, $mp.RealTimeProtectionEnabled, $mp.AntivirusSignatureLastUpdated, $mp.QuickScanEndTime) } catch { W '- Defender: status unavailable' }
$rb1 = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
$rb2 = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
W ("- Reboot pending: WindowsUpdate={0} CBS={1}" -f $rb1, $rb2)
try { $au = (New-Object -ComObject Microsoft.Update.AutoUpdate).Results; W ("- Windows Update: last search {0}; last install {1}" -f $au.LastSearchSuccessDate, $au.LastInstallationSuccessDate) } catch { W '- Windows Update: history unavailable' }
try { Get-HotFix -ErrorAction Stop | Sort-Object InstalledOn -Descending | Select-Object -First 3 | ForEach-Object { W ("- Hotfix {0} {1} {2}" -f $_.HotFixID, $_.Description, $_.InstalledOn) } } catch { }

Sec 'Network'
Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object {
  W ("- {0}: {1} gw {2} dns {3}" -f $_.InterfaceAlias, (($_.IPv4Address | ForEach-Object { $_.IPAddress }) -join ','), (($_.IPv4DefaultGateway | ForEach-Object { $_.NextHop }) -join ','), (($_.DNSServer | ForEach-Object { $_.ServerAddresses }) -join ','))
}
Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { W ("- Profile: {0} on {1} = {2}" -f $_.Name, $_.InterfaceAlias, $_.NetworkCategory) }
foreach ($svc in 'sshd', 'ssh-agent', 'Tailscale') { $s = Get-Service $svc -ErrorAction SilentlyContinue; if ($s) { W ("- Service {0}: {1}, {2}" -f $svc, $s.Status, $s.StartType) } else { W "- Service ${svc}: absent" } }
@((Get-NetFirewallRule -DisplayName '*OpenSSH*' -ErrorAction SilentlyContinue), (Get-NetFirewallRule -DisplayName '*trimurti*' -ErrorAction SilentlyContinue), (Get-NetFirewallRule -Name 'FPS-ICMP4-ERQ-In' -ErrorAction SilentlyContinue)) | ForEach-Object { $_ } | Where-Object { $_ } | ForEach-Object { W ("- Firewall rule {0}: enabled {1}, profile {2}, {3}" -f $_.DisplayName, $_.Enabled, $_.Profile, $_.Direction) }
W ("- administrators_authorized_keys: {0}; sshd_config: {1}" -f (Has 'C:\ProgramData\ssh\administrators_authorized_keys'), (Has 'C:\ProgramData\ssh\sshd_config'))
$sshd = Join-Path $H '.ssh'
if (Test-Path $sshd) { W ("- ~\.ssh: " + ((Get-ChildItem -LiteralPath $sshd -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ', ')) } else { W '- ~\.ssh: absent' }
$tc = Join-Path $sshd 'config.d\trimurti'
if (Test-Path $tc) { W ("- ~\.ssh\config.d\trimurti hosts: " + ((Select-String -LiteralPath $tc -Pattern '^Host ' | ForEach-Object { $_.Line -replace '^Host\s+', '' }) -join ', ')) } else { W '- ~\.ssh\config.d\trimurti: absent' }
if ((Where1 'tailscale') -ne '-') { Run 'tailscale status' 'tailscale status' 20 }

Sec 'Git clones'
$roots = @($H, (Join-Path $H 'Documents'), (Join-Path $H 'source'), (Join-Path $H 'source\repos'), (Join-Path $H 'src'), (Join-Path $H 'dev'), (Join-Path $H 'Desktop'), (Join-Path $H 'Projects'), 'C:\src', 'C:\dev', 'C:\code', 'C:\repos', 'C:\Projects')
$clones = @(); $kit = $null
foreach ($r in $roots) {
  if (-not (Test-Path -LiteralPath $r)) { continue }
  foreach ($d in (Get-ChildItem -LiteralPath $r -Directory -Force -ErrorAction SilentlyContinue)) {
    if ((Test-Path -LiteralPath (Join-Path $d.FullName '.git')) -and ($clones -notcontains $d.FullName) -and $clones.Count -lt 20) { $clones += $d.FullName }
  }
}
$cnt = 0
foreach ($c in $clones) {
  $url = (& git -C $c remote get-url origin 2>$null | Select-Object -First 1)
  if (-not $url) { $url = '(no origin)' }
  $br = (& git -C $c rev-parse --abbrev-ref HEAD 2>$null); $sha = (& git -C $c rev-parse --short HEAD 2>$null)
  $dirty = @(& git -C $c status --porcelain 2>$null).Count
  $skip = @(& git -C $c ls-files -v 2>$null | Where-Object { $_ -match '^[Ss] ' } | ForEach-Object { $_.Substring(2) })
  $hasKit = Test-Path -LiteralPath (Join-Path $c 'ops\network\scripts\verify.sh')
  W ("- {0}: {1} @ {2} {3}; {4} changed; skip-worktree: {5}; kit: {6}" -f $c, (Clip $url 90), $br, $sha, $dirty, ($(if ($skip.Count) { $skip -join ' ' } else { 'none' })), $hasKit)
  if ($hasKit -and -not $kit) { $kit = $c }
  if ($hasKit -and ($c -ieq (Join-Path $H 'trimurti-network'))) { $kit = $c }
  $cnt++
}
if ($cnt -eq 0) { W '- no git clones found under the usual folders' }

Sec 'Trimurti kit on this machine'
if ($kit) {
  $k = Join-Path $kit 'ops\network'
  W "- kit: $k"
  $inv = Join-Path $k 'inventory.csv'
  if (Test-Path $inv) { W '- inventory.csv (rows):'; Get-Content -LiteralPath $inv | Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() } | ForEach-Object { W ('    ' + (Clip $_)) } }
  $st = Join-Path $k 'status.md'
  if (Test-Path $st) { $sl = @(Get-Content -LiteralPath $st); W ("- status.md ({0} lines; non-empty table cells: {1}):" -f $sl.Count, @($sl | Where-Object { $_ -match '^\|' -and $_ -notmatch '^\|[\s\|-]*$' }).Count); $sl | Select-Object -First 70 | ForEach-Object { W ('    ' + (Clip $_)) } }
  $vo = Get-ChildItem -LiteralPath (Join-Path $k 'out') -Filter 'verify-*.md' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($vo) { W "- newest verify: $($vo.Name) ($($vo.LastWriteTime))"; Lines (Get-Content -LiteralPath $vo.FullName -Raw) 40 } else { W '- no out\verify-*.md yet' }
  $lg = Get-ChildItem -LiteralPath (Join-Path $k 'out\logs') -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  if ($lg) { W ("- out\logs: {0} files; newest: {1}" -f @($lg).Count, (($lg | Select-Object -First 5 | ForEach-Object { $_.Name }) -join ', ')) }
} else { W '- no clone with ops\network\scripts\verify.sh found' }

Sec 'AI CLIs: where'
foreach ($n in 'claude', 'codex', 'gemini.cmd', 'gemini', 'agy', 'hf', 'node', 'npm', 'git', 'winget', 'pwsh', 'python', 'tailscale', 'ssh', 'bash') { W ("- {0}: {1}" -f $n, (Where1 $n)) }

Sec 'AI CLIs: versions and sign-in'
Run 'node' 'node -v' 20
Run 'npm' 'npm -v' 40
Run 'git' 'git --version' 20
Run 'claude version' 'claude --version' 45
Run 'claude auth' 'claude auth status' 45
Run 'claude mcp' 'claude mcp list' 90
Run 'codex version' 'codex --version' 45
Run 'codex login' 'codex login status' 45
Run 'codex mcp' 'codex mcp list' 45
Run 'gemini version' 'gemini.cmd --version' 90
if ((Where1 'agy') -ne '-') { Run 'agy version' 'agy --version' 45 }
Run 'hf version' 'hf --version' 45
Run 'hf whoami' 'hf auth whoami' 45
Run 'winget version' 'winget --version' 30
Run 'winget upgrades' 'winget upgrade --include-unknown --disable-interactivity --accept-source-agreements' 180

Sec 'Config present (names only, no values)'
W ("- ~\.claude: {0}; settings.json keys: {1}; ~\.claude.json: {2}; its mcpServers: {3}" -f (Has (Join-Path $H '.claude')), $(if (Test-Path (Join-Path $H '.claude\settings.json')) { JsonKeys (Join-Path $H '.claude\settings.json') $null } else { '(absent)' }), (Has (Join-Path $H '.claude.json')), $(if (Test-Path (Join-Path $H '.claude.json')) { JsonKeys (Join-Path $H '.claude.json') 'mcpServers' } else { '-' }))
W ("- ~\.claude\skills: {0}" -f (DirNames (Join-Path $H '.claude\skills')))
W ("- ~\.claude\plugins: {0}" -f (DirNames (Join-Path $H '.claude\plugins')))
W ("- ~\.agents\skills: {0}" -f (DirNames (Join-Path $H '.agents\skills')))
W ("- ~\.codex: {0}; auth.json: {1}; skills: {2}" -f (Has (Join-Path $H '.codex')), (Has (Join-Path $H '.codex\auth.json')), (DirNames (Join-Path $H '.codex\skills')))
$ct = Join-Path $H '.codex\config.toml'
if (Test-Path $ct) { W ("- ~\.codex\config.toml: " + ((Select-String -LiteralPath $ct -Pattern '^\s*(\[mcp_servers\.|model\s*=|approval_policy|sandbox_mode)' | ForEach-Object { $_.Line.Trim() }) -join ' | ')) } else { W '- ~\.codex\config.toml: absent' }
$gs = Join-Path $H '.gemini\settings.json'
W ("- ~\.gemini: {0}; settings.json keys: {1}; mcpServers: {2}; google_accounts.json: {3}; oauth_creds.json: {4}; skills: {5}" -f (Has (Join-Path $H '.gemini')), $(if (Test-Path $gs) { JsonKeys $gs $null } else { '(absent)' }), $(if (Test-Path $gs) { JsonKeys $gs 'mcpServers' } else { '-' }), (Has (Join-Path $H '.gemini\google_accounts.json')), (Has (Join-Path $H '.gemini\oauth_creds.json')), (DirNames (Join-Path $H '.gemini\skills')))
if (Test-Path $gs) { try { $g = Get-Content -LiteralPath $gs -Raw | ConvertFrom-Json; W ("- gemini auth selectedType: {0}" -f $g.security.auth.selectedType) } catch { } }
$ge = Join-Path $H '.gemini\.env'
if (Test-Path $ge) { W ("- ~\.gemini\.env defines: " + ((Get-Content -LiteralPath $ge | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } | ForEach-Object { ($_ -split '=', 2)[0].Trim() }) -join ', ')) } else { W '- ~\.gemini\.env: absent' }
W ("- Antigravity: {0}; review-pr.sh: {1}" -f (Has (Join-Path $H '.gemini\antigravity')), (Has (Join-Path $H '.gemini\antigravity\brain\0f5ca863-d420-4cf5-88fd-8ed94f78d7f6\scratch\review-pr.sh')))
W ("- HF: ~\.hf-cli {0}; ~\.cache\huggingface\token {1}" -f (Has (Join-Path $H '.hf-cli')), (Has (Join-Path $H '.cache\huggingface\token')))
$names = 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_GENAI_USE_GCA', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'OPENAI_API_KEY', 'CODEX_HOME', 'HF_TOKEN', 'GEMINI_CLI_HOME'
foreach ($n in $names) {
  $u = [Environment]::GetEnvironmentVariable($n, 'User'); $m = [Environment]::GetEnvironmentVariable($n, 'Machine'); $p = [Environment]::GetEnvironmentVariable($n, 'Process')
  $where = @(); if ($u) { $where += 'User' }; if ($m) { $where += 'Machine' }; if ($p) { $where += 'Process' }
  W ("- env {0}: {1}" -f $n, $(if ($where.Count) { 'set (' + ($where -join ',') + ')' } else { 'not set' }))
}

Sec 'kg-permission-gates'
$found = 0
foreach ($b in (Join-Path $H '.claude\skills'), (Join-Path $H '.agents\skills'), (Join-Path $H '.codex\skills'), (Join-Path $H '.gemini\skills'), (Join-Path $H '.claude\plugins')) {
  if (-not (Test-Path -LiteralPath $b)) { continue }
  Get-ChildItem -LiteralPath $b -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*permission-gates*' } | ForEach-Object {
    $found++
    $v = '?'
    foreach ($f in 'SKILL.md', 'plugin.json', '.claude-plugin\plugin.json', 'package.json') {
      $fp = Join-Path $_.FullName $f
      if (Test-Path -LiteralPath $fp) { $m = Select-String -LiteralPath $fp -Pattern '"?version"?\s*[:=]\s*"?([0-9][0-9A-Za-z.\-]*)' | Select-Object -First 1; if ($m) { $v = $m.Matches[0].Groups[1].Value + " ($f)"; break } }
    }
    W ("- {0}: version {1}, modified {2}" -f $_.FullName, $v, $_.LastWriteTime)
  }
}
if ($found -eq 0) { W '- not found in ~\.claude\skills, ~\.agents\skills, ~\.codex\skills, ~\.gemini\skills or ~\.claude\plugins' }

W ''
W ("# DC-DIAG END {0} in {1:n0}s" -f $me, ((Get-Date) - $t0).TotalSeconds)
$txt = ($L -join "`r`n") + "`r`n"
[IO.File]::WriteAllText($out, $txt, (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText($latest, $txt, (New-Object Text.UTF8Encoding $false))
Write-Output $latest
