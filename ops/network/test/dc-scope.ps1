# PowerShell variable names ignore case, so at script scope `$l = ...` overwrites the report list `$L` and every
# later report line is lost (it happened in dc-gemini-review.ps1 and dc-fix.ps1). This test fails when a dc-*.ps1
# script assigns, loops over or declares as a parameter, outside its functions, two names that differ only in case.
# Run: pwsh -NoProfile -File ops/network/test/dc-scope.ps1 (or powershell.exe -File on Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'
$scripts = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts'
$fails = 0; $cases = 0
foreach ($f in @(Get-ChildItem -LiteralPath $scripts -Filter 'dc-*.ps1')) {
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$null)
  $seen = @{}
  $nodes = $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.AssignmentStatementAst] -or $a -is [System.Management.Automation.Language.ForEachStatementAst] -or $a -is [System.Management.Automation.Language.ParameterAst] }, $true)
  foreach ($a in $nodes) {
    $p = $a.Parent; $inFn = $false
    while ($p) { if ($p -is [System.Management.Automation.Language.FunctionDefinitionAst]) { $inFn = $true; break }; $p = $p.Parent }
    if ($inFn) { continue }
    $v = $null
    if ($a -is [System.Management.Automation.Language.AssignmentStatementAst]) { if ($a.Left -is [System.Management.Automation.Language.VariableExpressionAst]) { $v = $a.Left } }
    elseif ($a -is [System.Management.Automation.Language.ForEachStatementAst]) { $v = $a.Variable }
    else { $v = $a.Name }
    if (-not $v -or $v.VariablePath.DriveName) { continue }
    $n = $v.VariablePath.UserPath -replace '^script:', ''
    $key = $n.ToLowerInvariant()
    if (-not $seen.ContainsKey($key)) { $seen[$key] = New-Object System.Collections.Generic.List[string] }
    if (-not $seen[$key].Contains($n)) { $seen[$key].Add($n) }
  }
  foreach ($key in $seen.Keys) {
    $cases++
    if ($seen[$key].Count -gt 1) { $fails++; Write-Output ("FAIL: {0} uses {1} at script scope (the same variable)" -f $f.Name, ($seen[$key] -join ' and ')) }
  }
}
Write-Output "$cases names, $fails failures"
if ($fails) { exit 1 }
