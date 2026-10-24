# dc-diagnose.ps1: read-only snapshot of one Windows machine for the Trimurti job, run through Desktop
# Commander (no terminal; start_process returns after 3 s, so the result is the report file) by dc-bootstrap.ps1:
# packed on its own it is over dc-pack.py's limit. One run writes
# everything an agent needs into %USERPROFILE%\trimurti-dc\<host>-diag-latest.md (and a stamped copy).
# The file is rewritten after every section: a run that dies leaves a report without its END line, never
# a stale complete one. Installs, updates, reboots and settings are never touched; the only writes are the
# report folder and winget's own source cache. `claude mcp list` starts the configured MCP servers to show
# their health. git status runs with --no-optional-locks, so it does not rewrite a clone's index. Config files
# are read to list key names; secrets are reported by name (set / not set), never by value, and every line of
# external output is scrubbed. Every external command runs with stdin closed and a timeout (worst case
# ~12 min), except quick local git calls. No parameters: any argument is an error.
# Windows PowerShell 5.1 is enough.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$t0 = Get-Date
$env:CI = '1'; $env:NO_COLOR = '1'; $env:TERM = 'dumb'; $env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
$env:DISABLE_AUTOUPDATER = '1'; $env:PYTHONUTF8 = '1'; $env:PYTHONIOENCODING = 'utf-8'
$H = $env:USERPROFILE
# Tools installed after the Desktop Commander app started are not on its PATH: rebuild it from the
# registry-backed Machine and User values plus the folders the kit's bootstrap and per-user Node use.
$extra = @((Join-Path $H '.local\bin'), (Join-Path $env:APPDATA 'npm'), (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'), (Join-Path $env:ProgramFiles 'Git\cmd'), (Join-Path $env:ProgramFiles 'nodejs'),
  (Join-Path $env:LOCALAPPDATA 'Programs\nodejs'), (Join-Path $env:APPDATA 'nvm'), (Join-Path $env:LOCALAPPDATA 'nodejs'), (Join-Path $env:LOCALAPPDATA 'Volta\bin'))
$env:Path = (@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path) + $extra) -join ';'
$dir = Join-Path $H 'trimurti-dc'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$me = [Environment]::MachineName   # $env:COMPUTERNAME is empty in Desktop Commander's process
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $dir "$me-diag-$stamp.md"
$latest = Join-Path $dir "$me-diag-latest.md"
$utf8 = New-Object Text.UTF8Encoding $false
$L = New-Object System.Collections.Generic.List[string]
function W([string]$s) { $script:L.Add($s) }
function Flush() { [IO.File]::WriteAllText($script:latest, (($script:L -join "`r`n") + "`r`n"), $script:utf8) }
function Sec([string]$t) { W ''; W "## $t"; Flush }
# Scrub runs on every line of external content (command output, file dumps) and on each string of the verdict
# object (ScrubObj masks a value under a key-like property name itself). It masks: JSON strings and numbers under
# key-like names (counts excepted); Bearer and other Authorization values; values after token/key/secret/password/
# auth switches and in NAME=, Header: and "json_key": pairs, whatever their first character; secret-looking URL
# query values and URL passwords; curl/smbclient -u/-U/--user, sshpass -p and net use passwords (net use: after
# any /switches, with a * drive or a quoted share too); ConvertTo-SecureString strings, after its switches or piped
# in; token-shaped strings. A quote or an escaped quote inside a value continues it only when another value
# character follows, so a closing quote still ends it; a value that opens an object or array is left alone, and
# so is a quote followed by JSON punctuation and then a delimiter, a space or the end, unless a closing quote ends
# the value. The command-line passwords and the ConvertTo-SecureString strings run to their closing quote instead
# ($w, $q and $sb below). So scrubbed JSON stays JSON in the shapes test/dc-scrub.ps1 checks, but not always when
# a string ends just where a value would start (["set api key:",5]): masking wins there, and nothing reads
# scrubbed JSON text back. Not secrets: `passed=`
# (run-remote.sh's TRIMURTI_SUMMARY line) and claude auth status's authMethod / apiKeySource, which name the kind of
# sign-in (they show when a PC bills an API key). The same function is in dc-diagnose.ps1, dc-fix.ps1 and
# dc-gemini-review.ps1; test/dc-scrub.ps1 keeps them identical.
function Scrub([string]$s) {
  $v = '(?:[^\s"''\\]|\\u(?!0027)[0-9a-fA-F]{4}|\\[^\s"''u]|(?:\\?["'']|\\u0027)(?![\s,;:}\])"''\\]|$))+'
  $s = $s -replace '(?i)("(?!(?:passed|authMethod|apiKeySource)")[\w-]*(?:token|key|secret|password|passwd|pass|auth|bearer|credential)[\w-]*"\s*:\s*")(?:[^"\\]|\\.)+(")', '$1***$2'
  $s = $s -replace '(?i)("(?!(?:passed|authMethod|apiKeySource)")[\w-]*(?:token|key|secret|password|passwd|pass|auth|bearer|credential)[\w-]*(?<!count|tokens)"\s*:\s*)-?\d+(?![\w.])', '$1"***"'
  $s = $s -replace ('(?i)\b(Bearer)\s+' + $v), '$1 ***'
  $s = $s -replace ('(?i)\b((?:proxy-)?authorization["'']?\s*[:=]\s*["'']?)[A-Za-z]+\s+' + $v), '$1***'
  $s = $s -replace ('(?i)(--?[\w-]*(token|key|secret|password|passwd|pass|auth|bearer|credential)[\w-]*)([=\s]+)(?:(\\?["'']|\\u0027)(?!(?=[,}\]](?:[\s"'',;:}\])\\]|$))(?![^\s"'']*["''](?:[\s,;:}\])]|$)))|)' + $v), '$1$3$4***'
  $s = $s -replace ('(?i)\b(?!(?:passed|authMethod|apiKeySource)\b)([\w-]*(token|key|secret|password|passwd|pass|auth|bearer|credential)[\w-]*)(\\?["'']|\\u0027)?\s*([=:])\s*(?!(?:true|false|yes|no|null|none)(?=[\s,;}\])]|$)|(?<=(?:count|tokens)(?:\\?["'']|\\u0027)?\s*[=:]\s*)\d+(?=[\s,;}\])]|$))(?![{\[])(?:(\\?["'']|\\u0027|"(?:\\u0027|''|\\"))(?!(?=[,;}\])](?:[\s"'',;:}\])\\]|$))(?![^\s"'']*["''](?:[\s,;:}\])]|$)))|)' + $v), '$1$3$4$5***'
  $s = $s -replace '(?i)([?&][^=&\s"\\]*(token|key|secret|sig|code|auth|pass)[^=&\s"\\]*=)[^&\s"\\]+', '$1***'
  $s = $s -replace '(://[^/@\s:"\\]+:)[^@\s"\\]+@', '$1***@'
  # $w: a password after sshpass -p or net use, or after user: (curl -u/--user) or user% (smbclient -U/--user).
  # Like \S+, but a bare " ends it where a JSON string can end (before a space, , : } ] or the end; \" and "" never
  # do), and a quoted part ('...' or "..." with \ or ` escapes) runs to its closing quote, spaces included. Each
  # character of a quoted part can be read only one way, so an unclosed quote cannot make the regex backtrack for
  # minutes. $q: after a quote opened before user: or user%, the password runs to its closing quote ('\'' and ''
  # kept).
  # A "..." part closes before a space, " ' \ ) , ; | & < >, the end, or up to 8 other punctuation characters and
  # then a space or the end (a backtick, a period, a colon or ** after it in prose), never before a letter or
  # digit, so it cannot run on into the command word of the next string. Nor does a "..." part that holds only
  # spaces and , ; + ( ) [ ] { } | & < > = and whose closing quote runs straight into more text: that is the gap
  # between two strings ("," " + " "),(" and the like), and reading it would carry the mask into the next string's
  # command word and past its password. Before a space, a quote ("}""... is "}" doubled) or the end it is read.
  # JSON text ($j) starts with { or [, ends with } or ], and holds only strings, numbers, true, false, null and
  # JSON punctuation ([12:00:01] ... [exit 0] is not JSON). In it a raw " is a string delimiter: a quoted part may
  # not hold one (\" is fine) and a raw " never opens one, so a quoted part cannot run from one string into the next.
  $c = '[^''\r\n]'; $d = '"(?![\s,;+()\[\]{}|&<>=]*"(?![\s"]|$))(?:[^"\\`\r\n]|\\[^`]|\\(?=`)|`.)*[\\`]?"(?=[\s"''\\),;|&<>]|$|[^\w\s]{1,8}(?:\s|$))|'
  $j = $s -match '^\s*[\[{](?>(?:"(?:[^"\\]|\\.)*"|[\s{}\[\],:]|-?\d[\d.eE+-]*|true|false|null)*)(?<=[\]}]\s*)$'; if ($j) { $c = '(?:\\.|[^''"\\\r\n])'; $d = '' }
  $w = '(?:''(?:''''|' + $c + ')*''(?=[\s"''\\),;|&<>]|$)|' + $d + '[^\s"\\]|\\\S?|""|"(?![\s,:}\]]|$))+'
  $q = '(?:(?(sq)(?:''\\''''|''''|' + $c + ')+(?=''(?:[\s"''),;|&<>]|$))|(?(dq)(?:[^"\\`\r\n]|\\[^`]|\\(?=`)|`.)*[\\`]?(?="(?:[\s"''),;|&<>]|$))|(?!)))|' + $w + ')'
  $s = $s -replace ('(?i)(\s(?:-u\s+|--(?:proxy-)?user[=\s]+)(?:\\u0027|\\["'']|(?<sq>'')|(?<dq>"))?[^\s:"'']+:)' + $q), '$1***'
  $s = $s -creplace ('(\s(?:-U\s+|--user[=\s]+)(?:\\u0027|\\["'']|(?<sq>'')|(?<dq>"))?[^\s%"'']+%)' + $q), '$1***'
  $s = $s -replace ('(?i)(\bsshpass\s+-p\s*)' + $w), '$1***'
  # net use [X: or *] <share, quoted (spaces too) or not> [/switches] <password>; a bare * (prompt for it) is kept.
  $s = $s -replace ('(?i)(\bnet\s+use(?:\s+(?:[^\s"'']+:|\*))?\s+(?:(\\?["'']|\\u0027)\\\\(?:(?!\2)[^"''])+\2|\\\\[^\s"'']+)(?:\s+/[^\s"'']+)*\s+)(?!/|\*(?:\s|$|"(?:[\s,:}\]]|$)))' + $w), '$1***'
  # A ConvertTo-SecureString string, after its switches or piped in, runs to its closing quote, whatever follows
  # it (a backtick, . : ] and so on): '' inside '...', "" and `" inside "...", the same written as JSON (\u0027,
  # \") or as \'...\', and a `"...`" inside a "..." command line (as JSON `\"...`\"). One that never closes ends at
  # the next quote of another kind: a '...' or \u0027 at the next raw ", a \" at the next raw " or `", a "..." at
  # the next '. In JSON text a '...' cannot run past a raw " into the next string, and a raw "..." ends only before
  # a space, ) ; | , } or the end, so a JSON string that ends right after the cmdlet stays JSON. Both rules run only
  # on text that names the cmdlet, and each character of $sb can be read only one way. A piped string is looked for
  # from every quote, so in a long run of escaped quotes ('' "" `" \"\" `\" \u0027\u0027, or a \\u0027 or \` read
  # from its second character) each quote would start a read to the end of the run: there $sb reads at most 16 of
  # them (its @ is {0,16}; after the cmdlet it is *), so a piped password holding more is masked only from its
  # 16th-last on.
  $so = '(?:(?<sq>'')|(?<xs>\\u0027)|(?<xd>\\")|(?<xb>`")|(?<xj>`\\")|(?<xa>\\'')|(?<dq>"))'
  $ss = '[^'']*(?:''''[^'']*)@(?='')|[^''"]*(?=")'; $sd = '(?=")|[^"''`]*(?='')'
  if ($j) { $ss = '(?:\\[^''\n]|[^''"\\])*(?:(?:''''|\\'')(?:\\[^''\n]|[^''"\\])*)@(?=[''"])'; $sd = '(?="(?:[\s);|,}]|$))' }
  $sb = '(?(sq)(?:' + $ss + ')|(?(xs)(?:(?!\\u0027)(?:[^"\\]|\\[^\\\n]|\\\\(?!u0027)))*(?:(?:\\u0027\\u0027|\\\\u0027)(?:(?!\\u0027)(?:[^"\\]|\\[^\\\n]|\\\\(?!u0027)))*)@(?=\\u0027|")|(?(xd)(?:[^"\\`]|\\[^"\n]|`(?:\\[^"\n]|[^"\\]))*(?:(?:\\"\\"|`\\")(?:[^"\\`]|\\[^"\n]|`(?:\\[^"\n]|[^"\\]))*)@(?=\\"|`?")|(?(xb)(?:`[^"]|[^"`])*(?=`")|(?(xj)(?:(?!`\\")(?:[^"\\]|\\[^`\n]))*(?:\\`(?:(?!`\\")(?:[^"\\]|\\[^`\n]))*)@(?=`\\")|(?(xa)(?:[^\\'']|\\[^''])*(?=\\'')|(?:(?:[^"`]|`[^"\n])*(?:(?:""|`")(?:[^"`]|`[^"\n])*)@' + $sd + ')))))))'
  if ($s -match 'ConvertTo-SecureString') {
    $s = $s -replace ('(?i)(ConvertTo-SecureString(?:\s+-\w+)*\s+' + $so + ')' + $sb.Replace('@', '*')), '$1***'
    $s = $s -replace ('(?i)(' + $so + ')' + $sb.Replace('@', '{0,16}') + '(?=(?:''|\\u0027|\\''|`?\\?")\s*\|\s*ConvertTo-SecureString\b)'), '$1***'
  }
  $s = $s -replace '(\bbot\d+:)[A-Za-z0-9_-]{30,}', '$1***'
  $s -replace '(?i)\b(sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|hf_[A-Za-z0-9]{20,}|sbp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[abprs]-[A-Za-z0-9-]+|AKIA[0-9A-Z]{16}|glpat-[\w-]{20,}|npm_[A-Za-z0-9]{30,}|ya29\.[\w.-]+|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})\b', '***'
}
function Clip([string]$s, [int]$n = 220) { $s = Scrub $s; if ($s.Length -gt $n) { $s.Substring(0, $n) + ' ...' } else { $s } }
function Lines($text, [int]$max = 14) {
  $ls = @(([string]$text) -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
  foreach ($l in ($ls | Select-Object -First $max)) { W ('    ' + (Clip $l)) }
  if ($ls.Count -gt $max) { W ("    ... {0} more lines" -f ($ls.Count - $max)) }
}
# Run a command line through cmd.exe (so .cmd and .exe shims resolve as in a user's shell), stdin closed,
# output to a file under the report folder, the whole tree killed when it outlives the timeout.
function Run([string]$label, [string]$cmd, [int]$sec = 45) {
  $tf = Join-Path $script:dir ('run-' + [IO.Path]::GetRandomFileName() + '.tmp')
  $psi = New-Object Diagnostics.ProcessStartInfo
  # $env:ComSpec is empty in Desktop Commander's process; System32 from .NET is always right.
  $psi.FileName = Join-Path ([Environment]::SystemDirectory) 'cmd.exe'; $psi.Arguments = ('/d /s /c "{0} > "{1}" 2>&1 <nul"' -f $cmd, $tf)
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardInput = $true
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $to = $false; $code = 'n/a'; $o = ''; $ok = $true
  try {
    try {
      $p = [Diagnostics.Process]::Start($psi); $p.StandardInput.Close()
      if (-not $p.WaitForExit($sec * 1000)) { $to = $true; & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null }
      else { $code = $p.ExitCode }
    } catch { $ok = $false; W ("- **{0}**: could not start: {1}" -f $label, (Clip $_.Exception.Message)) }
    $sw.Stop()
    if (Test-Path -LiteralPath $tf) { $o = Get-Content -LiteralPath $tf -Raw -Encoding UTF8 -ErrorAction SilentlyContinue }
  } finally {
    foreach ($i in 1..3) { if (Test-Path -LiteralPath $tf) { Remove-Item -LiteralPath $tf -Force -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $tf) { Start-Sleep -Milliseconds 300 } } }
  }
  if (-not $ok) { return }
  $flag = ''; if ($to) { $flag = ', TIMEOUT after ' + $sec + 's' }
  W ('- **{0}** `{1}` (exit {2}, {3:n1}s{4})' -f $label, $cmd, $code, $sw.Elapsed.TotalSeconds, $flag)
  if ([string]::IsNullOrWhiteSpace($o)) { W '    (no output)' } else { Lines $o }
}
function Has([string]$p) { if (Test-Path -LiteralPath $p) { 'yes' } else { 'no' } }
function Where1([string]$n) { $c = Get-Command $n -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.Source } else { '-' } }
# ConvertFrom-Json in 5.1 refuses files over 2 MB (~\.claude.json is one); the serializer underneath has no such limit.
Add-Type -AssemblyName System.Web.Extensions -ErrorAction SilentlyContinue
function JsonKeys([string]$path, [string]$prop) {
  try {
    $ser = New-Object Web.Script.Serialization.JavaScriptSerializer; $ser.MaxJsonLength = [int]::MaxValue
    $j = $ser.DeserializeObject((Get-Content -LiteralPath $path -Raw -ErrorAction Stop))
    if ($prop) { $j = $j[$prop] }
    if ($null -eq $j) { return '(none)' }
    $k = @($j.Keys); if ($k.Count -eq 0) { '(none)' } else { $k -join ', ' }
  } catch { 'unreadable (JSON parse error)' }
}
function DirNames([string]$p) { if (Test-Path -LiteralPath $p) { $n = @(Get-ChildItem -LiteralPath $p -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }); if ($n.Count) { $n -join ', ' } else { '(empty)' } } else { '(absent)' } }

W ("# DC-DIAG BEGIN {0} {1} ({2})" -f $me, $stamp, (Get-Date -Format o))
W "report: $out"
Flush
try {

Sec 'System'
try {
  $os = Get-CimInstance Win32_OperatingSystem
  W ("- OS: {0} {1} build {2} ({3}); PowerShell {4}; CPU arch {5}" -f $os.Caption, $os.Version, $os.BuildNumber, $os.OSArchitecture, $PSVersionTable.PSVersion, $env:PROCESSOR_ARCHITECTURE)
  $up = $null; if ($os.LastBootUpTime) { $up = (Get-Date) - $os.LastBootUpTime }
  W ("- Up {0}; RAM {1:n1}/{2:n1} GB free" -f $(if ($up) { "{0}d {1}h since {2}" -f $up.Days, $up.Hours, $os.LastBootUpTime } else { 'unknown' }), ($os.FreePhysicalMemory / 1MB), ($os.TotalVisibleMemorySize / 1MB))
} catch { W "- OS: unreadable" }
try { $cs = Get-CimInstance Win32_ComputerSystem; W ("- Name {0}; domain/workgroup {1} (joined {2}); DNS host {3}" -f $cs.Name, $(if ($cs.PartOfDomain) { $cs.Domain } else { $cs.Workgroup }), $cs.PartOfDomain, $cs.DNSHostName) } catch { }
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$elev = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$adm = (($id.Groups | ForEach-Object { $_.Value }) -contains 'S-1-5-32-544')
$src = '?'; try { $src = (Get-LocalUser -Name $env:USERNAME -ErrorAction Stop).PrincipalSource } catch { }
W ("- Running as {0}; member of Administrators {1}; elevated token {2}; account source {3}" -f $id.Name, $adm, $elev, $src)
W ("- Execution policy: " + ((Get-ExecutionPolicy -List | ForEach-Object { "{0}={1}" -f $_.Scope, $_.ExecutionPolicy }) -join ' '))
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | ForEach-Object { W ("- Disk {0} {1:n0}/{2:n0} GB free" -f $_.DeviceID, ($_.FreeSpace / 1GB), ($_.Size / 1GB)) }
Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | ForEach-Object { W ("- Drive {0}: serial {1}, {2}, {3:n0} GB" -f $_.Model, ([string]$_.SerialNumber).Trim(), $_.InterfaceType, ($_.Size / 1GB)) }
Get-SmbMapping -ErrorAction SilentlyContinue | ForEach-Object { W ("- SMB mapping {0} -> {1} ({2})" -f $_.LocalPath, $_.RemotePath, $_.Status) }
try { $mp = Get-MpComputerStatus -ErrorAction Stop; W ("- Defender: mode {0}; real-time {1}; signatures {2}; last quick scan {3}" -f $mp.AMRunningMode, $mp.RealTimeProtectionEnabled, $mp.AntivirusSignatureLastUpdated, $mp.QuickScanEndTime) } catch { W '- Defender: status unavailable' }
$rb1 = Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
$rb2 = Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
W ("- Reboot pending: WindowsUpdate={0} CBS={1}" -f $rb1, $rb2)
try { $au = (New-Object -ComObject Microsoft.Update.AutoUpdate).Results; W ("- Windows Update: last search {0}; last install {1}" -f $au.LastSearchSuccessDate, $au.LastInstallationSuccessDate) } catch { W '- Windows Update: history unavailable' }
try { Get-HotFix -ErrorAction Stop | Sort-Object InstalledOn -Descending | Select-Object -First 3 | ForEach-Object { W ("- Hotfix {0} {1} {2}" -f $_.HotFixID, $_.Description, $_.InstalledOn) } } catch { }
$tk = Get-ScheduledTask -TaskName 'trimurti-windows-update' -ErrorAction SilentlyContinue
if ($tk) { $ti = $tk | Get-ScheduledTaskInfo; W ("- update-all task: {0}, last run {1}, result {2}" -f $tk.State, $ti.LastRunTime, $ti.LastTaskResult) } else { W '- update-all task: none' }
$wul = 'C:\ProgramData\trimurti\windows-update.log'
if (Test-Path -LiteralPath $wul) { W "- windows-update.log tail:"; Lines ((Get-Content -LiteralPath $wul -Tail 10 -Encoding UTF8) -join "`n") 10 }

Sec 'Network'
Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { W ("- Adapter {0}: {1}, {2}, MAC {3}" -f $_.Name, $_.LinkSpeed, $_.MediaType, $_.MacAddress) }
Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object {
  W ("- {0}: {1} gw {2} dns {3}" -f $_.InterfaceAlias, (($_.IPv4Address | ForEach-Object { $_.IPAddress }) -join ','), (($_.IPv4DefaultGateway | ForEach-Object { $_.NextHop }) -join ','), (($_.DNSServer | ForEach-Object { $_.ServerAddresses }) -join ','))
}
Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=true' -ErrorAction SilentlyContinue | ForEach-Object { W ("- DHCP {0}: enabled {1}, server {2}, lease {3} .. {4}" -f $_.Description, $_.DHCPEnabled, $_.DHCPServer, $_.DHCPLeaseObtained, $_.DHCPLeaseExpires) }
Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { W ("- Profile: {0} on {1} = {2}" -f $_.Name, $_.InterfaceAlias, $_.NetworkCategory) }
foreach ($svc in 'sshd', 'ssh-agent', 'Tailscale') { $s = Get-Service $svc -ErrorAction SilentlyContinue; if ($s) { W ("- Service {0}: {1}, {2}" -f $svc, $s.Status, $s.StartType) } else { W "- Service ${svc}: absent" } }
$l22 = @(Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.LocalAddress })
W ("- Port 22 listening on: {0}; sshd.exe present: {1}" -f $(if ($l22.Count) { $l22 -join ',' } else { 'nothing' }), (Has 'C:\Windows\System32\OpenSSH\sshd.exe'))
@((Get-NetFirewallRule -DisplayName '*OpenSSH*' -ErrorAction SilentlyContinue), (Get-NetFirewallRule -DisplayName '*trimurti*' -ErrorAction SilentlyContinue), (Get-NetFirewallRule -Name 'FPS-ICMP4-ERQ-In' -ErrorAction SilentlyContinue)) | ForEach-Object { $_ } | Where-Object { $_ } | ForEach-Object { W ("- Firewall rule {0}: enabled {1}, profile {2}, {3}" -f $_.DisplayName, $_.Enabled, $_.Profile, $_.Direction) }
$aak = 'C:\ProgramData\ssh\administrators_authorized_keys'; $scf = 'C:\ProgramData\ssh\sshd_config'
W ("- administrators_authorized_keys: {0}; sshd_config: {1}" -f (Has $aak), (Has $scf))
if (Test-Path -LiteralPath $scf) { W ("- sshd_config auth lines: " + ((Select-String -LiteralPath $scf -Pattern '^\s*(Port|PubkeyAuthentication|PasswordAuthentication|AuthorizedKeysFile|Match Group administrators)' -ErrorAction SilentlyContinue | ForEach-Object { $_.Line.Trim() }) -join ' | ')) }
if (Test-Path -LiteralPath $aak) { Run 'authorized key fingerprints' ('ssh-keygen -lf "' + $aak + '"') 20 }
$sshd = Join-Path $H '.ssh'
if (Test-Path -LiteralPath $sshd) { W ("- ~\.ssh: " + ((Get-ChildItem -LiteralPath $sshd -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ', ')) } else { W '- ~\.ssh: absent' }
$pub = Join-Path $sshd 'id_ed25519_trimurti.pub'
if (Test-Path -LiteralPath $pub) { Run 'trimurti key fingerprint' ('ssh-keygen -lf "' + $pub + '"') 20 } else { W '- ~\.ssh\id_ed25519_trimurti.pub: absent' }
$tc = Join-Path $sshd 'config.d\trimurti'
if (Test-Path -LiteralPath $tc) { W ("- ~\.ssh\config.d\trimurti hosts: " + ((Select-String -LiteralPath $tc -Pattern '^Host ' | ForEach-Object { $_.Line -replace '^Host\s+', '' }) -join ', ')) } else { W '- ~\.ssh\config.d\trimurti: absent' }
Run 'join state' 'dsregcmd /status | findstr /i Joined' 20
if ((Where1 'tailscale') -ne '-') { Run 'tailscale status' 'tailscale status' 20 }

Sec 'Git clones'
$roots = @((Join-Path $H 'trimurti-network'), $H, (Join-Path $H 'Documents'), (Join-Path $H 'source'), (Join-Path $H 'source\repos'), (Join-Path $H 'src'), (Join-Path $H 'dev'), (Join-Path $H 'Desktop'), (Join-Path $H 'Projects'), 'C:\src', 'C:\dev', 'C:\code', 'C:\repos', 'C:\Projects')
$clones = @(); $kit = $null
if (Test-Path -LiteralPath (Join-Path $H 'trimurti-network\.git')) { $clones += (Join-Path $H 'trimurti-network') }
foreach ($r in $roots) {
  if (-not (Test-Path -LiteralPath $r)) { continue }
  foreach ($d in (Get-ChildItem -LiteralPath $r -Directory -Force -ErrorAction SilentlyContinue)) {
    if ((Test-Path -LiteralPath (Join-Path $d.FullName '.git')) -and ($clones -notcontains $d.FullName) -and $clones.Count -lt 12) { $clones += $d.FullName }
  }
}
if ((Where1 'git') -eq '-') { W '- git not on PATH; clone details skipped'; foreach ($c in $clones) { W "- $c" } }
else {
  foreach ($c in $clones) {
    $url = $null; $br = $null; $sha = $null; $dirty = 0; $skip = @()
    $url = (& git -C $c remote get-url origin 2>$null | Select-Object -First 1)
    if (-not $url) { $url = '(no origin)' }
    $u2 = $url -replace '^([A-Za-z][A-Za-z0-9+.-]*://)[^/@]+@', '$1'   # drop user:token@ from an https remote
    if ($u2 -ne $url) { $url = $u2 + ' (credentials stripped)' }
    $br = (& git -C $c rev-parse --abbrev-ref HEAD 2>$null); $sha = (& git -C $c rev-parse --short HEAD 2>$null)
    $dirty = @(& git --no-optional-locks -C $c -c core.fsmonitor=false -c core.untrackedCache=false status --porcelain 2>$null).Count
    $hasKit = Test-Path -LiteralPath (Join-Path $c 'ops\network\scripts\verify.sh')
    if ($hasKit) { $skip = @(& git -C $c ls-files -v -- ops/network/inventory.csv ops/network/status.md 2>$null | Where-Object { $_ -match '^[Ss] ' } | ForEach-Object { $_.Substring(2) }) }
    W ("- {0}: {1} @ {2} {3}; {4} changed; skip-worktree: {5}; kit: {6}" -f $c, (Clip $url 90), $br, $sha, $dirty, ($(if ($skip.Count) { $skip -join ' ' } else { 'none' })), $hasKit)
    if ($hasKit -and -not $kit) { $kit = $c }
  }
}
if ($clones.Count -eq 0) { W '- no git clones found under the usual folders' }

Sec 'Trimurti kit on this machine'
if ($kit) {
  $k = Join-Path $kit 'ops\network'
  W "- kit: $k"
  $inv = Join-Path $k 'inventory.csv'
  if (Test-Path -LiteralPath $inv) { W '- inventory.csv (rows):'; Get-Content -LiteralPath $inv -Encoding UTF8 | Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() } | ForEach-Object { W ('    ' + (Clip $_)) } }
  $st = Join-Path $k 'status.md'
  if (Test-Path -LiteralPath $st) { $sl = @(Get-Content -LiteralPath $st -Encoding UTF8); W ("- status.md ({0} lines; filled table rows: {1}):" -f $sl.Count, @($sl | Where-Object { $_ -match '^\|' -and $_ -notmatch '^\|[\s\|-]*$' }).Count); $sl | Select-Object -First 70 | ForEach-Object { W ('    ' + (Clip $_)) } }
  $vo = Get-ChildItem -LiteralPath (Join-Path $k 'out') -Filter 'verify-*.md' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($vo) { W "- newest verify: $($vo.Name) ($($vo.LastWriteTime))"; Lines (Get-Content -LiteralPath $vo.FullName -Raw -Encoding UTF8) 40 } else { W '- no out\verify-*.md yet' }
  $lg = Get-ChildItem -LiteralPath (Join-Path $k 'out\logs') -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  if ($lg) { W ("- out\logs: {0} files; newest: {1}" -f @($lg).Count, (($lg | Select-Object -First 5 | ForEach-Object { $_.Name }) -join ', ')) }
} else { W '- no clone with ops\network\scripts\verify.sh found' }

Sec 'AI CLIs: where'
foreach ($n in 'claude', 'codex', 'gemini.cmd', 'gemini', 'agy', 'hf', 'node', 'npm', 'git', 'winget', 'pwsh', 'python', 'tailscale', 'ssh', 'ssh-keygen', 'bash', 'wsl.exe') { W ("- {0}: {1}" -f $n, (Where1 $n)) }
W ("- Git Bash: {0}; Git ssh: {1}; per-user node: {2}" -f (Has 'C:\Program Files\Git\bin\bash.exe'), (Has 'C:\Program Files\Git\usr\bin\ssh.exe'), (Has (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')))

Sec 'AI CLIs: versions and sign-in'
Run 'node' 'node -v' 15
Run 'npm' 'npm -v' 30
Run 'git' 'git --version' 15
Run 'claude version' 'claude --version' 45
Run 'claude auth' 'claude auth status' 45
Run 'claude mcp' 'claude mcp list' 90
Run 'codex version' 'codex --version' 45
Run 'codex login' 'codex login status' 45
Run 'gemini version' 'gemini.cmd --version' 60
if ((Where1 'agy') -ne '-') { Run 'agy version' 'agy --version' 45 }
Run 'hf version' 'hf --version' 45
Run 'hf whoami' 'hf auth whoami' 45
Run 'winget version' 'winget --version' 30
Run 'winget upgrades' 'winget upgrade --include-unknown --disable-interactivity --source winget' 120

Sec 'Config present (names only, no values)'
W ("- ~\.claude: {0}; settings.json keys: {1}; .credentials.json: {2}; ~\.claude.json: {3}; its mcpServers: {4}" -f (Has (Join-Path $H '.claude')), $(if (Test-Path -LiteralPath (Join-Path $H '.claude\settings.json')) { JsonKeys (Join-Path $H '.claude\settings.json') $null } else { '(absent)' }), (Has (Join-Path $H '.claude\.credentials.json')), (Has (Join-Path $H '.claude.json')), $(if (Test-Path -LiteralPath (Join-Path $H '.claude.json')) { JsonKeys (Join-Path $H '.claude.json') 'mcpServers' } else { '-' }))
W ("- ~\.claude\skills: {0}" -f (DirNames (Join-Path $H '.claude\skills')))
W ("- ~\.claude\plugins: {0}" -f (DirNames (Join-Path $H '.claude\plugins')))
W ("- ~\.agents\skills: {0}; hf-cli skill: {1}" -f (DirNames (Join-Path $H '.agents\skills')), (Has (Join-Path $H '.agents\skills\hf-cli\SKILL.md')))
W ("- ~\.codex: {0}; auth.json: {1}; skills: {2}" -f (Has (Join-Path $H '.codex')), (Has (Join-Path $H '.codex\auth.json')), (DirNames (Join-Path $H '.codex\skills')))
$ct = Join-Path $H '.codex\config.toml'
if (Test-Path -LiteralPath $ct) { W ("- ~\.codex\config.toml: " + ((Select-String -LiteralPath $ct -Pattern '^\s*(\[mcp_servers\.|model\s*=|approval_policy|sandbox_mode)' | ForEach-Object { $_.Line.Trim() }) -join ' | ')) } else { W '- ~\.codex\config.toml: absent' }
$gs = Join-Path $H '.gemini\settings.json'
W ("- ~\.gemini: {0}; settings.json keys: {1}; mcpServers: {2}; google_accounts.json: {3}; oauth_creds.json: {4}; skills: {5}" -f (Has (Join-Path $H '.gemini')), $(if (Test-Path -LiteralPath $gs) { JsonKeys $gs $null } else { '(absent)' }), $(if (Test-Path -LiteralPath $gs) { JsonKeys $gs 'mcpServers' } else { '-' }), (Has (Join-Path $H '.gemini\google_accounts.json')), (Has (Join-Path $H '.gemini\oauth_creds.json')), (DirNames (Join-Path $H '.gemini\skills')))
if (Test-Path -LiteralPath $gs) { try { $g = Get-Content -LiteralPath $gs -Raw | ConvertFrom-Json; W ("- gemini auth selectedType: {0}" -f $g.security.auth.selectedType) } catch { } }
W ("- Desktop Commander process env: ComSpec '{0}', COMPUTERNAME '{1}', SystemRoot '{2}'" -f $env:ComSpec, $env:COMPUTERNAME, $env:SystemRoot)
$ge = Join-Path $H '.gemini\.env'
if (Test-Path -LiteralPath $ge) {
  # Only names shaped like env vars are shown; anything else (a stray pasted value) is counted, not printed.
  $ns = @(Get-Content -LiteralPath $ge | ForEach-Object { $_ -replace '^\s*export\s+', '' } | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } | ForEach-Object { ($_ -split '=', 2)[0].Trim() })
  $ok = @($ns | Where-Object { $_ -match '^[A-Z][A-Z0-9_]{0,63}$' })
  $odd = $ns.Count - $ok.Count
  W ('- ~\.gemini\.env defines: ' + ($ok -join ', ') + $(if ($odd) { " (+$odd non-standard line(s) not shown)" } else { '' }))
} else { W '- ~\.gemini\.env: absent' }
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
    $v = '?'; $hash = '-'
    foreach ($f in 'SKILL.md', 'plugin.json', '.claude-plugin\plugin.json', 'package.json') {
      $fp = Join-Path $_.FullName $f
      if (Test-Path -LiteralPath $fp) { $m = Select-String -LiteralPath $fp -Pattern '"?version"?\s*[:=]\s*"?([0-9][0-9A-Za-z.\-]*)' | Select-Object -First 1; if ($m) { $v = $m.Matches[0].Groups[1].Value + " ($f)"; break } }
    }
    $sk = Join-Path $_.FullName 'SKILL.md'
    if (Test-Path -LiteralPath $sk) { $hash = (Get-FileHash -LiteralPath $sk -Algorithm SHA256).Hash.Substring(0, 12) }
    W ("- {0}: version {1}, SKILL.md sha256 {2}, link {3}, modified {4}" -f $_.FullName, $v, $hash, $(if ($_.LinkType) { $_.LinkType } else { 'copy' }), $_.LastWriteTime)
  }
}
if ($found -eq 0) { W '- not found in ~\.claude\skills, ~\.agents\skills, ~\.codex\skills, ~\.gemini\skills or ~\.claude\plugins' }

} catch { W ('- FATAL: ' + (Clip $_.Exception.Message) + ' at line ' + $_.InvocationInfo.ScriptLineNumber) }
finally {
  W ''
  W ("# DC-DIAG END {0} in {1:n0}s -> {2}" -f $me, ((Get-Date) - $t0).TotalSeconds, $out)
  Flush
  Copy-Item -LiteralPath $latest -Destination $out -Force
  Write-Output $latest
}
