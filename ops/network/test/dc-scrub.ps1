# Scrub and the review's credential scan. Scrub is copied into dc-diagnose.ps1, dc-fix.ps1 and
# dc-gemini-review.ps1 (dc-pack.py ships one file at a time); this test checks that the copies are identical,
# that each secret shape below is masked and every harmless line is left alone, and that the review's $CRED
# pattern hits the secrets it should and none of the variable references. Fake secrets are built at run time,
# so this file itself passes the credential scan.
# Run: pwsh -NoProfile -File ops/network/test/dc-scrub.ps1 (or powershell.exe -File on Windows PowerShell 5.1).
# Exits non-zero on any failure.
$ErrorActionPreference = 'Stop'
$scripts = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts'
$fails = 0; $cases = 0
function Check([bool]$ok, [string]$what) { $script:cases++; if (-not $ok) { $script:fails++; Write-Output "FAIL: $what" } }

$bodies = @{}
foreach ($n in 'dc-diagnose.ps1', 'dc-fix.ps1', 'dc-gemini-review.ps1') {
  $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $scripts $n), [ref]$null, [ref]$null)
  $f = $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Scrub' }, $true)
  Check ($f.Count -eq 1) "$n defines Scrub once"
  if ($f.Count -ge 1) { $bodies[$n] = $f[0].Extent.Text -replace "`r", '' }   # git may check a file out with CRLF
}
$texts = @($bodies.Values | Select-Object -Unique)
Check ($texts.Count -eq 1) 'the three Scrub copies are identical'
if (-not $texts.Count) { Write-Output "$cases cases, $fails failures"; exit 1 }
. ([ScriptBlock]::Create($texts[0]))

$k = 'Zq7' + ('x' * 37)   # 40 characters, enough for every prefixed pattern
$u = [string][char]92 + 'u0027'   # Windows PowerShell 5.1's ConvertTo-Json writes ' as \u0027
$d = [string][char]36   # a $ inside a "..." password: PowerShell keeps $! $# $@ and the like as they are
$masked = [ordered]@{
  'Authorization header'  = "Authorization: Bearer $k"
  'curl -H bearer'        = "curl -H `"Authorization: Bearer $k`" https://example.org"
  'json api_key'          = '{"api_key": "' + $k + '"}'
  'json token, no space'  = '{"token":"' + $k + '"}'
  'dotenv'                = "API_KEY=$k"
  'switch --token'        = "tool --token $k"
  'switch --api-key='     = "tool --api-key=$k"
  'url userinfo'          = "https://user:$k@github.com/x.git"
  'url query code'        = "https://example.org/cb?state=1&code=$k"
  'github classic'        = "ghp_$k"
  'github fine-grained'   = "github_pat_$k"
  'hugging face'          = "hf_$k"
  'anthropic'             = "sk-ant-$k"
  'google api key'        = "AIza$k"
  'slack'                 = "xoxb-$k"
  'aws'                   = 'AKIA' + ('Q' * 16)
  'gitlab'                = "glpat-$k"
  'npm'                   = "npm_$k"
  'google oauth'          = "ya29.$k"
  'supabase'              = "sbp_$k"
  'jwt'                   = "eyJ$k.eyJ$k.$k"
  'ps 5.1 json escape'    = '{"secret":  "' + $u + $k + $u + '"}'
  'literal quote in json' = '{"token": "' + "'" + $k + "'" + '"}'
  'escaped dquote in json' = '{"api_key": "' + [char]92 + '"' + $k + [char]92 + '""}'
  'authorization basic'   = "Authorization: Basic $k"
  'backslash in value'    = "PASSWORD=ab\$k"
  'brace-quoted json'     = '{"password": "{' + $k + '"}'
  'bracket-quoted dotenv' = "DB_PASSWORD='[" + $k + "'"
  'dquote mid value'      = 'DB_PASSWORD=Ab1"' + $k
  'squote mid switch'     = "tool --password Ab1'" + $k
  'basic dquote mid'      = 'Authorization: Basic Ab1"' + $k
  'json 5.1 amp mid'      = '{"password": "Ab1' + [char]92 + 'u0026' + $k + '"}'
  'json esc dquote mid'   = '{"password": "Ab1' + [char]92 + '"' + $k + '"}'
  'json value with space' = '{"api_key": "Ab1 ' + $k + '"}'
  'curl -u'               = "curl -u admin:$k https://nas.local/x"
  'smbclient -U'          = "smbclient //nas/share -U admin%$k"
  'curl --user'           = "curl --user admin:$k https://nas.local/x"
  'curl --user='          = "curl --user=admin:$k https://nas.local/x"
  'curl --user quoted'    = "curl --user `"admin:$k`" https://nas.local/x"
  'curl --proxy-user'     = "curl --proxy-user admin:$k -x http://proxy.local:3128 https://nas.local/x"
  'smbclient --user='     = "smbclient //nas/share --user=admin%$k"
  'json ends in --user'   = '{"m":"curl --user admin:' + $k + '","n":1}'
  'sshpass -p'            = "sshpass -p $k ssh admin@nas"
  'net use'               = 'net use Z: \\nas\share ' + $k + ' /user:admin'
  # net use: the password after /user: and other switches, with a * drive, after a quoted share (spaces too).
  'net use /user first'   = 'net use N: \\nas\share /user:nas\sanjay ' + $k + ' /persistent:yes'
  'net use * drive'       = 'net use * \\nas\share ' + $k + ' /user:admin'
  'net use quoted share'  = 'net use Z: "\\nas\Gallery Photos" /user:admin ' + $k
  'net use no drive'      = 'cmd /c net use \\nas\share /user:admin "' + $k + '"'
  'net use, starts with *' = 'net use Z: \\nas\share *' + "'" + $k + ' /user:admin'
  'net use, starts with *"' = 'net use Z: \\nas\share *"' + $k + ' /user:admin'
  'json ends in net use'  = '{"m":"net use Z: \\\\nas\\share /user:admin ' + $k + '","n":1}'
  'securestring'          = "ConvertTo-SecureString '$k' -AsPlainText -Force"
  'github server token'   = "ghs_$k"
  'telegram bot'          = "bot123456:$k"
  # A value that starts with JSON punctuation is still a value (unquoted, or quoted and closed).
  'dotenv, leading ;'     = "NAS_PASSWORD=;$k"
  'yaml, leading )'       = "password: )$k"
  'switch, leading ,'     = "tool --password ,$k"
  'set, leading ]'        = "set SMB_PASS=]$k"
  'lower, leading ;'      = "db_password=;$k"
  'quoted, leading )'     = 'PASSWORD=")' + $k + '"'
  'quoted, leading ),'    = 'PASSWORD="),' + $k + '"'
  'json ends in sshpass'  = '{"m":"sshpass -p ' + $k + '","n":1}'
  'json ends in smbclient' = '{"m":"smbclient //nas/s -U admin%' + $k + '","n":1}'
  # A quoted command-line password is masked to its closing quote, whatever quotes, escapes and JSON punctuation
  # it holds ({0} keeps these lines out of the review's credential scan).
  'sshpass sq, ",'        = 'sshpass -p {0} ssh admin@nas' -f ("'Ab1" + '",;' + $k + "'")
  'sshpass sq, bash quote' = 'sshpass -p {0} ssh nas' -f ("'it'\''s" + '",' + $k + "'")
  'sshpass dq, \",'       = 'sshpass -p {0} ssh nas' -f ('"Ab1\",;' + $k + '"')
  'sshpass sq, \u'        = 'sshpass -p {0} ssh nas' -f ("'Ab1\u" + $k + "'")
  'curl -u sq, ")'        = 'curl -u {0} https://nas.local/x' -f ("'admin:Ab1" + '")' + $k + "'")
  'curl -u user:sq'       = 'curl -u admin:{0} https://nas.local/x' -f ("'Ab1" + '",;' + $k + "'")
  'smbclient -U dq, '']'  = 'smbclient //nas/share -U {0} -c ls' -f ('"admin%Ab1' + "'']" + $k + '"')
  'net use dq, '':'       = 'net use Z: \\nas\share {0} /user:admin' -f ('"Ab1' + "':" + $k + '"')
  'net use, '';'          = 'net use Z: \\nas\share {0} /user:admin' -f ("Ab1';" + $k)
  'net use ps dq, `",'    = 'net use Z: \\nas\share {0} /user:admin' -f ('"Ab1`",;' + $k + '"')
  # A double-quoted password that starts with , : } or ]: on a bracketed log line (which is not JSON), and before
  # a backtick, a period, a colon or a bracket in prose.
  'sshpass, bracketed log line' = '[12:00:01] sshpass -p {0} ssh admin@nas [exit 0]' -f ('"}' + $k + '"')
  'net use, bracketed log line' = '[12:00:01] net use Z: \\nas\share {0} /user:admin [exit 0]' -f ('":' + $k + '"')
  'curl -u, bracketed log line' = '[INFO] curl -u admin:{0} https://nas.local/x [ok]' -f ('"]' + $k + '"')
  'sshpass, bash test line' = '[[ -f x ]] && sshpass -p {0} ssh nas || echo [fail]' -f ('",' + $k + '"')
  'sshpass, before a backtick' = '- run `sshpass -p {0}` to check it' -f ('"]' + $k + '"')
  'sshpass, before a period' = 'Run sshpass -p {0}. Then retry.' -f ('"}' + $k + '"')
  'net use, before a colon' = 'net use Z: \\nas\share {0}: access denied' -f ('",' + $k + '"')
  'sshpass, in brackets'  = '[cmd: sshpass -p {0}]' -f ('":' + $k + '"')
  # Two quoted command lines in a row: the gap between them ("," or " + ") is not part of the first password,
  # so the mask stops there and the second command's password is masked too.
  'two commands, bracketed log line' = '[12:00] "smbclient //nas/s -U admin%{0}","&sshpass -p {0}" [ok]' -f $k
  'two commands, joined with +' = '"curl -u admin:{0}" + "|net use Z: \\nas\share {0}"' -f $k
  # Not a gap: a password that starts with } or , written with doubled quotes ("" is one ").
  'sshpass dq doubled, }'  = 'sshpass -p {0} ssh nas' -f ('"}""' + $k + '"')
  'net use dq doubled, ,'  = 'net use Z: \\nas\share {0} /user:admin' -f ('",""' + $k + '"')
  'securestring switch first' = "ConvertTo-SecureString -AsPlainText '$k' -Force"
  'securestring -String last' = "ConvertTo-SecureString -AsPlainText -Force -String '$k'"
  'securestring pipe'     = "'$k' | ConvertTo-SecureString -AsPlainText -Force"
  'securestring pipe dq'  = "`"$k`" | ConvertTo-SecureString -AsPlainText -Force"
  'securestring in json'  = '{"m":"' + [char]92 + '"' + $k + [char]92 + '" | ConvertTo-SecureString -AsPlainText","n":1}'
  # PowerShell's own escapes: '' inside '...', "" and `" inside "...", and the other quote kind raw.
  'securestring sq, dquote' = "ConvertTo-SecureString 'A`"$k' -AsPlainText -Force"
  'securestring dq, squote' = "ConvertTo-SecureString `"A'$k`" -AsPlainText -Force"
  "securestring sq, ''"   = "ConvertTo-SecureString 'I''$k' -AsPlainText -Force"
  'securestring dq, ""'   = "ConvertTo-SecureString `"A`"`"$k`" -AsPlainText -Force"
  'securestring dq, `"'   = "ConvertTo-SecureString `"A```"$k`" -AsPlainText -Force"
  'securestring in parens' = "New-Object PSCredential('admin', (ConvertTo-SecureString 'A`"$k' -AsPlainText -Force))"
  'securestring pipe, dquote' = "'A`"$k' | ConvertTo-SecureString -AsPlainText -Force"
  'securestring pipe dq, ""' = "`"A`"`"$k`" | ConvertTo-SecureString -AsPlainText -Force"
  'securestring dq, $'    = "ConvertTo-SecureString `"Ab$d!$k`" -AsPlainText -Force"
  'securestring pipe dq, $' = "`"Kap$d#$k`" | ConvertTo-SecureString -AsPlainText -Force"
  # A `"...`" inside a "..." command line (as JSON too, below).
  'nested securestring'   = 'powershell -Command "ConvertTo-SecureString `"' + $k + '`" -AsPlainText"'
  'nested securestring pipe' = 'powershell -Command "`"' + $k + '`" | ConvertTo-SecureString -AsPlainText"'
  # A quoted string ends at its closing quote whatever follows it (a code span, a sentence); one that never closes
  # ends at the next quote of the other kind, and in JSON text at the end of the JSON string.
  'securestring dq, then `' = "Uses ``ConvertTo-SecureString `"$k`"`` on line 12."
  'securestring dq, then .' = "Line 12 calls ConvertTo-SecureString `"$k`". Move it to a vault."
  'securestring dq, then :' = "ConvertTo-SecureString `"$k`": hardcoded"
  'securestring dq, then ]' = "Line 12 [ConvertTo-SecureString `"$k`"] is hardcoded"
  'securestring sq never closes' = "Line 12 sets ConvertTo-SecureString '$k -AsPlainText (see `"notes`")"
  'securestring dq never closes' = "Line 12 sets ConvertTo-SecureString `"$k -AsPlainText (it's cut)"
  'json, sq never closes'  = '{"m":"ConvertTo-SecureString ' + "'" + $k + '","n":1}'
  'json 5.1, sq never closes' = '{{"m":"ConvertTo-SecureString {0}{1} -AsPlainText","x":"it{0}s","n":1}}' -f $u, $k
  'json, dq never closes'  = '{{"m":"Uses `ConvertTo-SecureString {0}{1}`","n":1}}' -f ([string][char]92 + '"'), $k
  # An escaped single quote opens a password or a ConvertTo-SecureString string too, as Python's repr prints
  # one in a string that holds both quote kinds (and PHP's var_export, Perl's Data::Dumper, Node's inspect).
  'repr curl -u'          = "curl -u \'admin:$k\' https://nas.local/x"
  'repr curl --user'      = "curl --user \'admin:$k\' https://nas.local/x"
  'repr smbclient -U'     = "smbclient //nas/share -U \'admin%$k\'"
  'repr smbclient --user' = "smbclient //nas/share --user \'admin%$k\'"
  'repr securestring'     = "ConvertTo-SecureString \'$k\' -AsPlainText"
  'repr securestring -String' = "ConvertTo-SecureString -AsPlainText -Force -String \'$k\'"
  'repr securestring pipe' = "\'$k\' | ConvertTo-SecureString -AsPlainText -Force"
  'repr command line'     = "cmd='curl -u \'admin:$k\' -H `"Accept: */*`" https://nas.local/x'"
  'repr powershell -c'    = "'powershell -c `"`$p = ConvertTo-SecureString \'$k\' -AsPlainText -Force`"'"
}
foreach ($c in $masked.Keys) {
  $out = Scrub $masked[$c]
  Check ($out -notmatch [regex]::Escape($k) -and $out -notmatch 'Q{16}') "masks: $c -> $out"
}
foreach ($c in ('sshpass -p {0}' -f '"}}"'), ('sshpass -p {0} ssh nas' -f '"}}"')) { $out = Scrub $c; Check ($out -notmatch '}}') "masks a password of separators: $c -> $out" }
foreach ($c in 'repr securestring', 'repr securestring -String', 'repr securestring pipe', 'repr powershell -c') {
  $out = Scrub $masked[$c]; Check ($out.Contains([string][char]92 + "'***" + [char]92 + "'")) "keeps the escaped quotes: $c -> $out"
}
# An unclosed quote before a run of backslashes or backticks must not make the regex backtrack for minutes.
$sw = [Diagnostics.Stopwatch]::StartNew(); [void](Scrub ('sshpass -p "' + ([string][char]92 * 34) + ' x' + ' -u "a:' + ('`' * 34)))
Check ($sw.ElapsedMilliseconds -lt 2000) "an unclosed quote scrubs in time ($($sw.ElapsedMilliseconds) ms)"
# Nor may a long run of quotes (the ConvertTo-SecureString patterns; the scan is timed below too).
$runs = @(('x ' + ([string][char]34 * 8000)), ('x ' + ([string][char]39 * 8000)), ('x ' + ('"a"' * 2700)), ('x ' + (([string][char]92 + [char]34) * 4000)))
$sw = [Diagnostics.Stopwatch]::StartNew(); foreach ($r in $runs) { [void](Scrub $r) }
Check ($sw.ElapsedMilliseconds -lt 2000) "a long run of quotes scrubs in time ($($sw.ElapsedMilliseconds) ms)"
# Nor the JSON test, nor a closing quote before a run of punctuation.
$sw = [Diagnostics.Stopwatch]::StartNew(); foreach ($r in ('[' + ('"a",' * 10000) + 'x]'), ('[' + ('1,' * 20000) + 'x]'), ('sshpass -p ' + ('"a"!' * 4000) + 'x')) { [void](Scrub $r) }
Check ($sw.ElapsedMilliseconds -lt 2000) "a long JSON-like line scrubs in time ($($sw.ElapsedMilliseconds) ms)"
# Nor a long run of spaces, tabs or line breaks after a { or [ in text that is not JSON (each place the JSON test
# could stop would look back over the whole run).
$sw = [Diagnostics.Stopwatch]::StartNew(); foreach ($r in ('[' + (' ' * 20000) + 'x'), ('{"a":' + ("`t" * 20000) + 'x'), ('[1,' + ("`r`n" * 10000)), ('{' + (' ' * 20000))) { [void](Scrub $r) }
Check ($sw.ElapsedMilliseconds -lt 2000) "a long run of spaces after { or [ scrubs in time ($($sw.ElapsedMilliseconds) ms)"
# Nor a long run of gaps between quoted strings after a password switch.
$sw = [Diagnostics.Stopwatch]::StartNew(); foreach ($r in ('sshpass -p x' + ('","' * 6000) + 'y'), ('curl -u a:x' + ('" + "' * 4000)), ('sshpass -p "' + (' ' * 20000) + 'x')) { [void](Scrub $r) }
Check ($sw.ElapsedMilliseconds -lt 2000) "a long run of gaps between strings scrubs in time ($($sw.ElapsedMilliseconds) ms)"
# With the cmdlet named a piped string is looked for from every quote, so a long run of an escape that holds a
# quote (or of \\u0027 or \`\", read from its second character) must cost one pass too, not one per quote, in
# JSON text too. The scan is timed on the same runs below.
$cs = 'ConvertTo-' + 'SecureString'; $bt = [string][char]96; $bq = [string][char]92 + [char]34
$csRuns = @(foreach ($e in [string][char]34, [string][char]39, ($bt + [char]34), $bq, ([string][char]92 + [char]39), $u, ([string][char]92 + $u), ([string][char]92 + $bt + $bq)) {
  $r = $e * [int](20000 / $e.Length)
  ('x ' + $r + ' ' + $cs), ('x ' + $r + ' | ' + $cs), ($cs + ' x ' + $bt + $bq + $r), ('{"m":"' + $cs + ' x ' + $r + '","n":1}')
})
$n = 0; foreach ($r in $csRuns) {
  $n++; $sw = [Diagnostics.Stopwatch]::StartNew(); [void](Scrub $r)
  Check ($sw.ElapsedMilliseconds -lt 2000) "a long run of quotes with the cmdlet named scrubs in time (run $n, $($sw.ElapsedMilliseconds) ms)"
}
# The same, 20,000 long, on a line that names the cmdlet (its rules read at most 16 doubled or escaped quotes).
$tail = ' | ConvertTo-SecureString -AsPlainText'
$runs2 = @(foreach ($r in [string][char]34, [string][char]39, ('`' + [char]34), ([string][char]92 + [char]34), ('"a"'), ('"' + "'" + [char]92 + '`')) {
  'x ' + ($r * [int](20000 / $r.Length)) + $tail })
$sw = [Diagnostics.Stopwatch]::StartNew(); foreach ($r in $runs2) { [void](Scrub $r) }
Check ($sw.ElapsedMilliseconds -lt 2000) "a long run of quotes before the cmdlet scrubs in time ($($sw.ElapsedMilliseconds) ms)"
# The curl -u, smbclient -U, sshpass -p and net use rules mask the whole password: a quote, a backslash or \u
# inside it, or a quote doubled or escaped as PowerShell, cmd and bash write one; and the JSON around it stays JSON.
$q = [string][char]34; $a = [string][char]39; $bs = [string][char]92; $sh = $bs + $bs + 'nas' + $bs + 's '
$cmd = @(('sshpass -p Ab' + $q + ')' + $k + ' ssh nas'), ('curl -u admin:Ab' + $bs + 'u' + $k + ' https://nas.local/x'),
  ('net use Z: ' + $sh + 'Ab' + $a + ';' + $k + ' /user:admin'), ('smbclient //nas/s -U admin%Ab' + $a + ',' + $k + ' -m SMB3'),
  ('net use Z: ' + $sh + $a + 'Ab' + $a + $a + $k + $a + ' /user:admin'), ('sshpass -p ' + $a + 'Ab' + $a + $bs + $a + $a + $k + $a + ' ssh nas'),
  ('net use Z: ' + $sh + $q + 'Ab' + $q + $q + $k + $q + ' /user:admin'), ('curl -u ' + $q + 'admin:Ab' + $bs + $q + ',' + $k + $q + ' https://nas.local/x'))
foreach ($c in $cmd) { $out = Scrub $c; Check ($out -notmatch [regex]::Escape($k)) "masks the whole password: $c -> $out" }
# In text a bare " before , : } ] or a space ends the value (it can close a JSON string); in JSON it is \" and masked.
foreach ($c in @($cmd) + ('sshpass -p Ab' + $q + ',' + $k + ' ssh nas')) {
  $j = ConvertTo-Json -InputObject ([ordered]@{ m = $c; n = 1 }) -Compress
  foreach ($t in $j, $j.Replace($a, $bs + 'u0027')) {
    $ok = $true; try { $ok = (ConvertFrom-Json -InputObject (Scrub $t) -ErrorAction Stop).m -notmatch [regex]::Escape($k) } catch { $ok = $false }
    Check $ok "masks the whole password, stays JSON: $t"
  }
}
foreach ($c in 'json, sq never closes', 'json 5.1, sq never closes', 'json, dq never closes', 'json api_key', 'json token, no space', 'ps 5.1 json escape', 'literal quote in json', 'escaped dquote in json', 'brace-quoted json', 'json 5.1 amp mid', 'json esc dquote mid', 'json value with space', 'json ends in sshpass', 'json ends in smbclient', 'json ends in --user', 'json ends in net use', 'securestring in json') {
  $ok = $true; try { [void](ConvertFrom-Json -InputObject (Scrub $masked[$c]) -ErrorAction Stop) } catch { $ok = $false }
  Check $ok "stays JSON: $c"
}
# One compressed JSON object holding the same command line twice (summary and finding) with an odd number of ':
# a quoted part must not run from one string into the next.
foreach ($c in ('sshpass -p ' + $k + "'"), ('curl -u admin:' + $k + "'"), ('net use Z: \\nas\share ' + $k + "' /user:admin")) {
  $j = ConvertTo-Json -InputObject ([ordered]@{ summary = $c; findings = @([ordered]@{ message = "see: $c"; line = 3 }); n = 1 }) -Depth 5 -Compress
  $ok = $true; try { $back = ConvertFrom-Json -InputObject (Scrub $j) -ErrorAction Stop; $ok = ($back.n -eq 1) -and ($back.summary -notmatch [regex]::Escape($k)) } catch { $ok = $false }
  Check $ok "stays JSON, two strings: $j"
}
# The same ConvertTo-SecureString lines as JSON strings, as pwsh 7 and as Windows PowerShell 5.1 write them.
foreach ($c in @($masked.Keys | Where-Object { $_ -like 'securestring *' })) {
  $j = ConvertTo-Json -InputObject ([ordered]@{ m = $masked[$c]; n = 1 }) -Compress
  foreach ($e in $j, $j.Replace([string][char]39, $u)) {
    $out = Scrub $e; $ok = $out -notmatch [regex]::Escape($k); try { $ok = $ok -and ((ConvertFrom-Json -InputObject $out -ErrorAction Stop).n -eq 1) } catch { $ok = $false }
    Check $ok "masked and stays JSON: $c -> $out"
  }
}
# A `"...`" nested in a "..." command line, and the same in PowerShell source, as JSON: masked, and still JSON.
foreach ($c in $masked['nested securestring'], $masked['nested securestring pipe'], ('x = "`"' + $k + '`" | ConvertTo-SecureString -AsPlainText -Force"')) {
  $j = ConvertTo-Json -InputObject ([ordered]@{ m = $c; n = 1 }) -Compress
  foreach ($e in $j, $j.Replace([string][char]39, $u)) {
    $out = Scrub $e; $ok = $out -notmatch [regex]::Escape($k); try { $ok = $ok -and ((ConvertFrom-Json -InputObject $out -ErrorAction Stop).n -eq 1) } catch { $ok = $false }
    Check $ok "masked and stays JSON: $e -> $out"
  }
}
foreach ($e in '{"m":"ConvertTo-SecureString ","n":1}', '{"m":"ConvertTo-SecureString -AsPlainText ","n":1}', '{"m":"x | ConvertTo-SecureString","n":"y"}') {
  $ok = $true; try { [void](ConvertFrom-Json -InputObject (Scrub $e) -ErrorAction Stop) } catch { $ok = $false }; Check $ok "stays JSON: $e"
}
# A '...' in one JSON string must not run past a raw " into the next (the same line as summary and finding).
$tl = '+$tail = ' + "'" + ' | ConvertTo-SecureString -AsPlainText' + "'"
$j = ConvertTo-Json -InputObject ([ordered]@{ summary = $tl; findings = @([ordered]@{ message = $tl; line = 1 }) }) -Compress
foreach ($e in $j, $j.Replace([string][char]39, $u)) {
  $ok = $true; try { $ok = (@((ConvertFrom-Json -InputObject (Scrub $e) -ErrorAction Stop).findings)[0].line -eq 1) } catch { $ok = $false }; Check $ok "stays JSON: $e"
}
# The verdict file: Finish scrubs ConvertTo-Json's multi-line output, nested objects and arrays included.
$nested = [ordered]@{ verdict = 'approve'; findings = @([ordered]@{ severity = 'low'; file = 'a.ps1'; line = 3; message = 'm' })
  credential_scan = [ordered]@{ clean = $true; details = 'no credential patterns in 12 lines' }
  usage = [ordered]@{ promptTokenCount = 5; promptTokensDetails = @([ordered]@{ modality = 'TEXT'; tokenCount = 5 }) }; exit_code = 0 }
$ok = $true
try { $back = ConvertFrom-Json -InputObject (Scrub (ConvertTo-Json -InputObject $nested -Depth 10)) -ErrorAction Stop; $ok = ($back.credential_scan.clean -eq $true) -and (@($back.usage.promptTokensDetails).Count -eq 1) } catch { $ok = $false }
Check $ok 'stays JSON: nested verdict object'
# Empty values, and a summary that ends in a key-like word and its delimiter.
$u2 = [ordered]@{ verdict = 'comment'; summary = 'Three gaps in the api key:'; findings = @([ordered]@{ message = 'set --api-key='; line = 1 }); exit_code = 0 }
foreach ($e in ('{"m":"or sshpass -p' + '","n":1}'), '{"m": "net use Z: \\\\nas\\s ", "n": "a"}', '{"token": "", "x": 1}', ('{"api_key":  "",' + "`n" + '  "verdict": "approve"}'), (ConvertTo-Json -InputObject $u2 -Depth 5), (ConvertTo-Json -InputObject $u2 -Depth 5 -Compress)) {
  $ok = $true; try { [void](ConvertFrom-Json -InputObject (Scrub $e) -ErrorAction Stop) } catch { $ok = $false }; Check $ok "stays JSON: $e"
}
# An array that starts with a number is JSON too: a raw " in it still ends a string.
foreach ($e in '[1,"or sshpass -p "," ssh nas"]', '[2,"net use Z: \\\\nas\\s "," x"]') {
  $ok = $true; try { $back = ConvertFrom-Json -InputObject (Scrub $e) -ErrorAction Stop; $ok = ($back.Count -eq 3) } catch { $ok = $false }; Check $ok "stays JSON: $e"
}
# Numbers: a numeric password is masked (a JSON number becomes the string "***"); counts are kept.
foreach ($c in 'password: 4821937', 'NAS_PASSWORD=4821937', '{"pin_token": 4821937}') { $out = Scrub $c; Check ($out -notmatch '4821937') "masks a number: $c -> $out" }
$ok = $true; try { [void](ConvertFrom-Json -InputObject (Scrub '{"pin_token": 4821937, "x": 1}') -ErrorAction Stop) } catch { $ok = $false }; Check $ok 'stays JSON: masked number'
$kept = @(
  'TRIMURTI_SUMMARY passed=DESKTOP-4D08JI5,Kg failed= reboot_required=',
  'From https://github.com/kapoorgalleries/metaplex',
  '   4b990e5..2c9a38a  claude/eloquent-wright-woxv2e -> origin/claude/eloquent-wright-woxv2e',
  'auth: true', '"loggedIn": false', '"promptTokenCount": 1234', 'token_count = 12',
  'agy 1.3.3', 'Gemini Models	Weekly Limit Remaining	78%',
  '  "authMethod": "api_key",', '  "apiKeySource": "ANTHROPIC_API_KEY"',
  '"input_tokens": 5', '"total_tokens": 99', 'max_tokens: 4096', '"candidatesTokenCount": 12', 'git log -1 --format=%h',
  '{"m":"net use Z: \\\\nas\\share *","n":1}', 'net use * \\nas\share * /user:admin', 'net use Z: "\\nas\Gallery Photos" /user:nas\sanjay /persistent:yes',
  'systemctl --user restart gallery-web.service'
)
foreach ($l in $kept) { $out = Scrub $l; Check ($out -ceq $l) "leaves alone: $l -> $out" }

# The credential scan in dc-gemini-review.ps1: the gate before a packet leaves the PC.
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $scripts 'dc-gemini-review.ps1'), [ref]$null, [ref]$null)
$asg = $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.AssignmentStatementAst] -and $a.Left.Extent.Text -eq '$CRED' }, $true)
Check ($asg.Count -eq 1) 'dc-gemini-review.ps1 assigns $CRED once'
if ($asg.Count -ge 1) {
  $CRED = & ([ScriptBlock]::Create($asg[0].Right.Extent.Text))
  $hit = @("+ghp_$k", "github_pat_$k", "-glpat-$k", " npm_$k", "ya29.$k", "sbp_$k", "AIza$k", ('+  "api_key": "' + $k + '"'),
    "+API_KEY=$k", "+export SECRET_TOKEN=$k", " PASSWORD=$k", ('-----BEGIN ' + 'OPENSSH PRIVATE KEY-----'),
    "+git clone https://user:$k@github.com/x.git", "+AWS_SECRET_ACCESS_KEY=$k", "+SECRET_KEY = '$k'",
    "+Authorization: Bearer $k", "+password: $k", "+db_password=$k", "+hf auth login --token $k",
    "+SMTP_PASSWORD=Ab1!$k", "+API_KEY=$k # prod", "+  - API_KEY=$k", "+API_KEY: $k", "+set API_KEY=$k",
    "+curl -u admin:$k https://nas.local/x", "+smbclient //nas/share -U admin%$k", "+sshpass -p $k ssh nas",
    "+curl --user admin:$k https://nas.local/x", "+curl --user=admin:$k https://nas.local/x", "+smbclient //nas/share --user=admin%$k",
    "+curl --proxy-user admin:$k https://nas.local/x",
    ('+net use Z: \\nas\share ' + $k + ' /user:admin'), "+ConvertTo-SecureString '$k' -AsPlainText -Force",
    ('+net use N: \\nas\share /user:nas\sanjay ' + $k + ' /persistent:yes'), ('+net use * \\nas\share ' + $k + ' /user:admin'),
    ('+net use Z: "\\nas\Gallery Photos" /user:admin ' + $k), ('+net use \\nas\share /user:admin ' + $k),
    "+Connect-Nas -Password $k", "+https://user:%41$k@nas.local/x", "+`$pw = ConvertTo-SecureString -AsPlainText '$k' -Force",
    "+ConvertTo-SecureString -AsPlainText -Force -String '$k'", "+`$pw = '$k' | ConvertTo-SecureString -AsPlainText -Force",
    "+`"$k`" | ConvertTo-SecureString -AsPlainText -Force", "+ConvertTo-SecureString 'A`"$k' -AsPlainText -Force",
    "+ConvertTo-SecureString `"A'$k`" -AsPlainText -Force", "+ConvertTo-SecureString 'I''$k' -AsPlainText -Force",
    "+ConvertTo-SecureString `"A`"`"$k`" -AsPlainText -Force", "+ConvertTo-SecureString `"A```"$k`" -AsPlainText -Force",
    "+`$pw = 'A`"$k' | ConvertTo-SecureString -AsPlainText -Force", "+`"A`"`"$k`" | ConvertTo-SecureString -AsPlainText -Force",
    ('+powershell -Command "ConvertTo-SecureString `"' + $k + '`" -AsPlainText"'), ('+powershell -Command "`"' + $k + '`" | ConvertTo-SecureString -AsPlainText"'),
    # Piped in with -AsPlainText (any order, abbreviated), a splat or a line continuation.
    "+`"$k`" | ConvertTo-SecureString -Force -AsPlainText", "+`$pw = '$k'|ConvertTo-SecureString -a -f",
    "+`$pw = '$k' | ConvertTo-SecureString @plain", "+`$pw = '$k' | ConvertTo-SecureString ``",
    # A "..." password with a $ in it (in its first 6 characters too), and a ' after its first character.
    "+`$pw = ConvertTo-SecureString `"Ab$d!$k`" -AsPlainText -Force", "+`$pw = `"Kap$d#$k`" | ConvertTo-SecureString -AsPlainText -Force",
    "+ConvertTo-SecureString -AsPlainText -Force -String `"Pa$d$d$k`"", "+- ``ConvertTo-SecureString `"Gal$d$k`" -AsPlainText``",
    "+`$pw = `"Ab$d'$k`" | ConvertTo-SecureString -AsPlainText -Force", "+`$pw = `"Ab$d!x'$k`" | ConvertTo-SecureString -a",
    "+ConvertTo-SecureString `"Ab$d'$k`" -AsPlainText -Force",
    "+`$c = New-Object PSCredential('admin', (ConvertTo-SecureString `"Ab$d!$k`" -AsPlainText -Force))",
    ('+$pw = ConvertTo-SecureString {0} -AsPlainText -Force' -f ('"Pa' + $d + $d + 'w0rd2026"')),
    ('+$pw = {0} | ConvertTo-SecureString -AsPlainText -Force' -f ('"Kapoor' + $d + '2026"')))
  foreach ($l in $hit) { Check ($CRED.IsMatch($l)) "scan hits: $l" }
  $miss = @('+  "Authorization": "Bearer ${HF_TOKEN}"', '+$env:HF_TOKEN = $null', '+  "token": "${HF_TOKEN}"',
    '+$token = [Environment]::GetEnvironmentVariable(''HF_TOKEN'', ''User'')', '+TOKEN_URL=https://example.org/oauth', '+password: changeme',
    ('+$f = "disk-' + ('a' * 24) + '"'), '+git clone https://user:${TOKEN}@github.com/x.git', '+https://x-access-token:%GH_TOKEN%@github.com/x.git',
    '+API_KEY="YOUR_API_KEY_HERE_PLEASE"', '+  "token": "<your-token-goes-here>"', '+Connect-Nas -Password $pw', '+curl -u $NAS_USER:$NAS_PASS https://nas.local/x',
    '+curl --user "$NAS_USER:$NAS_PASS" https://nas.local/x', '+curl --user admin:"$NAS_PASS" https://nas.local/x', '+docker run --user 1000:1000 gallery-web',
    '+smbclient //nas/share --user=admin%"$NAS_PASS"', '+curl -u admin:"$NAS_PASS" https://nas.local/x',
    '+curl --user admin:%NAS_PASS% https://nas.local/x',
    # pip install --user with a URL or a Windows path: not user:password.
    '+pip install --user git+https://github.com/huggingface/huggingface_hub', '+python -m pip install --user https://example.org/pkg-1.0.whl',
    '+pip install --user=git+ssh://git@github.com/x/y.git', '+pip install --user C:\wheels\pkg-1.0-py3-none-any.whl',
    '+pip install --user "D:/wheels/pkg-1.0.whl"', '+python -u C:\gallery\scripts\sync.py',
    '+sshpass -p "$LAB_PW" ssh nas', '+net use Z: \\nas\share /user:admin', '+  --secrets HF_TOKEN', '+hf auth login --token $HF_TOKEN',
    '+net use N: \\nas\share /user:nas\sanjay /persistent:yes', '+net use * \\nas\share * /user:admin', '+net use Z: \\nas\share /user:admin %NAS_PW%',
    '+net use Z: "\\nas\Gallery Photos" /user:admin /persistent:yes', '+net use Z: \\nas\share <password> /user:admin',
    '+net use Z: \\nas\share /user:admin (Get-Secret NAS -AsPlainText)',
    '+x.key = Enum.Value1234567890123', '+$k = ''Zq7'' + (''x'' * 37)',
    '+$pw = ConvertTo-SecureString $pw -AsPlainText -Force', '+$pw = Read-Host -AsSecureString', '+$pw | ConvertTo-SecureString -AsPlainText -Force',
    '+$pw = ConvertTo-SecureString "$env:NAS_PW" -AsPlainText -Force', '+$pw = "$env:NAS_PW" | ConvertTo-SecureString -AsPlainText -Force',
    '+$cmd = "ConvertTo-SecureString " + $pw + " -AsPlainText -Force"', '+$cmd = "ConvertTo-SecureString "+$pw',
    '+$l = ''ConvertTo-SecureString "'' + $k + ''" -AsPlainText''',
    '+$l = ''"'' + $k + ''" | ConvertTo-SecureString -AsPlainText''', '+$pw = ConvertTo-SecureString ''<nas password>'' -AsPlainText -Force',
    # A string piped in without -AsPlainText is an encrypted one, as read from a file: not a secret.
    '+$pw = Get-Content ''C:\ProgramData\trimurti\nas.cred'' | ConvertTo-SecureString', '+$pw = Get-Content -Path "nas.cred" | ConvertTo-SecureString -Key $aes',
    '+| `Get-Content ''nas.cred'' | ConvertTo-SecureString` | reads the saved credential |', '+Read it with `Get-Content ''nas.cred'' | ConvertTo-SecureString`',
    # Public keys (Solana addresses in this Metaplex fork) and key files are not secrets.
    '+  publicKey: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",', '+  creatorPubkey = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";',
    '+SOLANA_PUBLIC_KEY=metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', '+  - SSH_KEY: id_ed25519_trimurti.pub', '+TLS_KEY=/etc/ssl/private/nas-2026.pem',
    # A file name after any of the five upper-case names is a path, not a secret.
    '+CLIENT_SECRET: client_secret_2026.json', '+DB_PASSWORD=/run/secrets/db_password_2026.txt', '+NAS_PASSWD=C:\trimurti\nas-2026.txt')
  foreach ($l in $miss) { Check (-not $CRED.IsMatch($l)) "scan ignores: $l" }
  $sw = [Diagnostics.Stopwatch]::StartNew(); foreach ($r in $runs) { [void]$CRED.IsMatch('+' + $r) }
  Check ($sw.ElapsedMilliseconds -lt 2000) "a long run of quotes scans in time ($($sw.ElapsedMilliseconds) ms)"
  $n = 0; foreach ($r in $csRuns) {
    $n++; $sw = [Diagnostics.Stopwatch]::StartNew(); [void]$CRED.IsMatch('+' + $r)
    Check ($sw.ElapsedMilliseconds -lt 2000) "a long run of quotes with the cmdlet named scans in time (run $n, $($sw.ElapsedMilliseconds) ms)"
  }
  $sw.Restart(); foreach ($r in $runs2) { [void]$CRED.IsMatch('+' + $r) }
  Check ($sw.ElapsedMilliseconds -lt 2000) "a long run of quotes before the cmdlet scans in time ($($sw.ElapsedMilliseconds) ms)"
  # This file goes into review packets too: none of its lines may trip the scan, as an added diff line.
  $n = 0; foreach ($l in [IO.File]::ReadAllLines($PSCommandPath)) { $n++; Check (-not $CRED.IsMatch('+' + $l)) "this file passes the scan: line $n" }
}
Write-Output "$cases cases, $fails failures"
if ($fails) { exit 1 }
