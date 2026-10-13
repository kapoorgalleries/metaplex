#!/usr/bin/env python3
"""dc-pack.py: the travelling copy of each kit .ps1 must still be the same program.

Packs every scripts/*.ps1, decodes the command the way Windows would (base64 -> UTF-16LE stub ->
gzip payload), and checks: the stub ends with the script's exit code; a <# ... #> block survives
(its closing #> line used to be dropped as a comment); '#requires' survives; and, when pwsh is on
PATH, the travelling copy parses. Scripts over the size limit must be refused, not truncated.
Run: python3 ops/network/test/dc-pack.py
"""
import base64, gzip, pathlib, re, shutil, subprocess, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
SCRIPTS = HERE.parent / 'scripts'
PACK = SCRIPTS / 'dc-pack.py'


def pack(script, *extra):
    return subprocess.run([sys.executable, '-I', str(PACK), str(script), *extra], capture_output=True, text=True)


def travelling_copy(cmd):
    enc = cmd.strip().rsplit(' ', 1)[1]
    stub = base64.b64decode(enc).decode('utf-16-le')
    payload = re.search(r"FromBase64String\('([^']+)'\)", stub).group(1)
    return stub, gzip.decompress(base64.b64decode(payload)).decode('utf-8')


class DcPack(unittest.TestCase):
    def test_every_script(self):
        pwsh = shutil.which('pwsh')
        for ps1 in sorted(SCRIPTS.glob('*.ps1')):
            with self.subTest(script=ps1.name):
                r = pack(ps1)
                if r.returncode != 0:
                    self.assertIn("Windows allows 32767", r.stdout + r.stderr, r.stderr)
                    continue
                stub, src = travelling_copy(r.stdout)
                self.assertTrue(stub.rstrip().endswith('exit $LASTEXITCODE'), 'stub does not pass the exit code on')
                orig = ps1.read_text(encoding='utf-8')
                self.assertEqual(len(re.findall(r'(?m)^\s*<#', orig)), len(re.findall(r'(?m)^<#', src)), 'a <# line was lost')
                self.assertEqual(len(re.findall(r'(?m)^\s*#>', orig)), len(re.findall(r'(?m)^#>', src)), 'a #> line was lost')
                if pwsh:
                    with tempfile.TemporaryDirectory() as d:
                        f = pathlib.Path(d) / ps1.name
                        f.write_text(src, encoding='utf-8')
                        check = ("$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('%s', [ref]$null, [ref]$e); "
                                 "if ($e) { $e | %% { $_.Message }; exit 1 }") % str(f).replace("'", "''")
                        p = subprocess.run([pwsh, '-NoProfile', '-Command', check], capture_output=True, text=True)
                        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_requires_and_block_comment(self):
        with tempfile.TemporaryDirectory() as d:
            f = pathlib.Path(d) / 't.ps1'
            f.write_text('#requires -Version 5.1\n<#\nhelp text\n  # an indented comment inside\n#>\n# a comment line\n    Write-Output ok\n', encoding='utf-8')
            r = pack(f)
            self.assertEqual(r.returncode, 0, r.stderr)
            _, src = travelling_copy(r.stdout)
            self.assertEqual(src, '#requires -Version 5.1\n<#\nhelp text\n#>\nWrite-Output ok\n')

    def test_args_whitelist(self):
        self.assertNotEqual(pack(SCRIPTS / 'dc-bootstrap.ps1', '--args', '-Script x.ps1; Remove-Item C:\\').returncode, 0)
        self.assertEqual(pack(SCRIPTS / 'dc-bootstrap.ps1', '--args', '-Script dc-gemini-review.ps1 -Pr 31 -Branch claude/x -Head 2c9a38a -Via agy').returncode, 0)
        r = pack(SCRIPTS / 'dc-bootstrap.ps1', '--args', '-NoRemote')   # one dash-led value
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('-NoRemote', travelling_copy(r.stdout)[0])


if __name__ == '__main__':
    unittest.main(verbosity=1)
