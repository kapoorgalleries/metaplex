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
  if ($f.Count -ge 1) { $bodies[$n] = $f[0].Extent.Text }
}
$texts = @($bodies.Values | Select-Object -Unique)
Check ($texts.Count -eq 1) 'the three Scrub copies are identical'
if (-not $texts.Count) { Write-Output "$cases cases, $fails failures"; exit 1 }
. ([ScriptBlock]::Create($texts[0]))

$k = 'Zq7' + ('x' * 37)   # 40 characters, enough for every prefixed pattern
$u = [string][char]92 + 'u0027'   # Windows PowerShell 5.1's ConvertTo-Json writes ' as \u0027
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
  'sshpass -p'            = "sshpass -p $k ssh admin@nas"
  'net use'               = 'net use Z: \\nas\share ' + $k + ' /user:admin'
  'securestring'          = "ConvertTo-SecureString '$k' -AsPlainText -Force"
  'github server token'   = "ghs_$k"
  'telegram bot'          = "bot123456:$k"
}
foreach ($c in $masked.Keys) {
  $out = Scrub $masked[$c]
  Check ($out -notmatch [regex]::Escape($k) -and $out -notmatch 'Q{16}') "masks: $c -> $out"
}
foreach ($c in 'json api_key', 'json token, no space', 'ps 5.1 json escape', 'literal quote in json', 'escaped dquote in json', 'brace-quoted json', 'json 5.1 amp mid', 'json esc dquote mid', 'json value with space') {
  $ok = $true; try { [void](ConvertFrom-Json -InputObject (Scrub $masked[$c]) -ErrorAction Stop) } catch { $ok = $false }
  Check $ok "stays JSON: $c"
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
foreach ($e in '{"token": "", "x": 1}', ('{"api_key":  "",' + "`n" + '  "verdict": "approve"}'), (ConvertTo-Json -InputObject $u2 -Depth 5), (ConvertTo-Json -InputObject $u2 -Depth 5 -Compress)) {
  $ok = $true; try { [void](ConvertFrom-Json -InputObject (Scrub $e) -ErrorAction Stop) } catch { $ok = $false }; Check $ok "stays JSON: $e"
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
  '"input_tokens": 5', '"total_tokens": 99', 'max_tokens: 4096', '"candidatesTokenCount": 12', 'git log -1 --format=%h'
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
    ('+net use Z: \\nas\share ' + $k + ' /user:admin'), "+ConvertTo-SecureString '$k' -AsPlainText -Force",
    "+Connect-Nas -Password $k", "+https://user:%41$k@nas.local/x")
  foreach ($l in $hit) { Check ($CRED.IsMatch($l)) "scan hits: $l" }
  $miss = @('+  "Authorization": "Bearer ${HF_TOKEN}"', '+$env:HF_TOKEN = $null', '+  "token": "${HF_TOKEN}"',
    '+$token = [Environment]::GetEnvironmentVariable(''HF_TOKEN'', ''User'')', '+TOKEN_URL=https://example.org/oauth', '+password: changeme',
    ('+$f = "disk-' + ('a' * 24) + '"'), '+git clone https://user:${TOKEN}@github.com/x.git', '+https://x-access-token:%GH_TOKEN%@github.com/x.git',
    '+API_KEY="YOUR_API_KEY_HERE_PLEASE"', '+  "token": "<your-token-goes-here>"', '+Connect-Nas -Password $pw', '+curl -u $NAS_USER:$NAS_PASS https://nas.local/x',
    '+sshpass -p "$LAB_PW" ssh nas', '+net use Z: \\nas\share /user:admin', '+  --secrets HF_TOKEN', '+hf auth login --token $HF_TOKEN',
    '+x.key = Enum.Value1234567890123', '+$k = ''Zq7'' + (''x'' * 37)')
  foreach ($l in $miss) { Check (-not $CRED.IsMatch($l)) "scan ignores: $l" }
  # This file goes into review packets too: none of its lines may trip the scan, as an added diff line.
  $n = 0; foreach ($l in [IO.File]::ReadAllLines($PSCommandPath)) { $n++; Check (-not $CRED.IsMatch('+' + $l)) "this file passes the scan: line $n" }
}
Write-Output "$cases cases, $fails failures"
if ($fails) { exit 1 }
