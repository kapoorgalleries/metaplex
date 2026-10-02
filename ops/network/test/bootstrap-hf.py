#!/usr/bin/env python3
"""Offline bootstrap regression cases; Python 3.11+ (stdlib tomllib), no installers.

Extract only registration functions and execute them with child-only HOME/CODEX_HOME
and mock CLIs. No real agent config, network, auth or package manager is touched.
Run: python3 ops/network/test/bootstrap-hf.py
"""
import json
import os
from pathlib import Path
import pwd
import struct
import subprocess
import sys
import tempfile
import unittest

if sys.version_info < (3, 11):
    raise SystemExit('bootstrap-hf.py needs Python 3.11+ (the mock codex parses TOML with tomllib)')

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/bootstrap-ai-clis.sh'
URL = 'https://huggingface.co/mcp'
DENY = 'hf_jobs create_repo dynamic_space hf_sandbox hf_sandbox_exec hf_sandbox_fs'.split()
MOCK = r'''
import json, os, pathlib, sys, tomllib
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['HOME'])
with open(root / 'calls.jsonl', 'a') as f:
    f.write(json.dumps([name, args, os.getcwd()]) + '\n')
if os.environ.get('FAIL_CLIENT') == name:
    print('error includes ' + os.environ['HF_TOKEN'], file=sys.stderr)
    sys.exit(1)
if name == 'codex':
    cfg = pathlib.Path(os.environ['CODEX_HOME']) / 'config.toml'
    try:
        data = tomllib.loads(cfg.read_text()) if cfg.exists() else {}
        servers = data.get('mcp_servers', {})
        # Emulate the real CLI's project merge: the bootstrap must avoid this cwd.
        if pathlib.Path.cwd() == root / 'project':
            servers = dict(servers, huggingface={'url': 'PROJECT-SHADOW'})
        if args[:2] == ['mcp', 'list']:
            print('[]'); sys.exit(0)
        s = servers['huggingface']
        print(json.dumps(dict(name='huggingface', enabled=s.get('enabled', True),
                              transport={'type': 'streamable_http', 'url': s.get('url')},
                              disabled_tools=s.get('disabled_tools'))))
        sys.exit(0)
    except (KeyError, ValueError):
        sys.exit(1)
if name == 'gemini':
    # The bootstrap must never run `gemini mcp add`/`remove`: Gemini 0.61 writes back the
    # env-expanded mcpServers map, saving other servers' ${VAR} values in the clear.
    sys.exit(97)
cfg = pathlib.Path(os.environ.get('CLAUDE_CONFIG_DIR', root)) / '.claude.json'
s = dict(type='http', url=args[-1])
data = json.loads(cfg.read_text()) if cfg.exists() else {}
data.setdefault('mcpServers', {})['huggingface'] = s
cfg.parent.mkdir(parents=True, exist_ok=True)
cfg.write_text(json.dumps(data))
'''

class BootstrapHf(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='bootstrap-hf-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        (self.root / 'project').mkdir()
        for name in ['codex', 'gemini', 'claude']:
            p = self.bin / name
            p.write_text('#!' + sys.executable + '\n' + MOCK)
            p.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.root), CODEX_HOME=str(self.root / '.codex'),
                        PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                        HF_TOKEN='test-secret-must-not-appear', TMPDIR=str(self.root))
        self.env.pop('CLAUDE_CONFIG_DIR', None)
        self.env.pop('GEMINI_CLI_HOME', None)
        self.source = SCRIPT.read_text()
        self.functions = self.source[self.source.index('HF_MCP_URL='):self.source.index('\nhave curl ||')]

    def write(self, rel, content):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        return p

    def run_registration(self, only=None, extra='', **as_user):
        prelude = '''set -u
log() { printf '%s\\n' "$*"; }
warn() { printf '%s\\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
FAILED=''
failed() { FAILED="$FAILED $1"; }
'''
        flags = '\n'.join(f'SKIP_{c.upper()}={int(only is not None and c != only)}' for c in ['claude', 'codex', 'gemini'])
        code = prelude + self.functions + '\n' + flags + '\nCLAUDE_HF_MCP=1\n' + extra + '\nregister_hf_mcp\n[ -z "$FAILED" ] || { echo "INSTALL INCOMPLETE:$FAILED"; exit 1; }\necho "INSTALL OK"\n'
        return subprocess.run(['bash', '-c', code], cwd=self.root / 'project', env=self.env,
                              text=True, capture_output=True, timeout=15, **as_user)

    def test_new_user_registration_and_all_three_repeat_without_rewrite(self):
        first = self.run_registration()
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        paths = [self.root / x for x in ['.codex/config.toml', '.gemini/settings.json', '.claude.json']]
        before = [p.read_bytes() for p in paths]
        second = self.run_registration()
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertEqual(before, [p.read_bytes() for p in paths])
        calls = [json.loads(x) for x in (self.root / 'calls.jsonl').read_text().splitlines()]
        self.assertEqual(sum(c[0] == 'claude' for c in calls), 1)
        self.assertEqual(sum(c[0] == 'gemini' for c in calls), 0)
        self.assertNotIn('test-secret-must-not-appear', json.dumps(calls) + first.stdout + second.stdout + ''.join(p.read_text() for p in paths))
        self.assertIn('${HF_TOKEN}', paths[1].read_text())
        self.assertEqual(json.loads(paths[1].read_text())['mcpServers']['huggingface']['type'], 'http')
        self.assertNotIn('PROJECT-SHADOW', paths[0].read_text())

    def test_unrelated_keys_and_other_servers_preserved(self):
        self.write('.gemini/settings.json', json.dumps({'theme': {'huggingface': True}, 'mcpServers': {'existing': {'command': 'keep-me'}}}))
        result = self.run_registration('gemini')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        data = json.loads((self.root / '.gemini/settings.json').read_text())
        self.assertEqual(data['theme'], {'huggingface': True})
        self.assertEqual(data['mcpServers']['existing']['command'], 'keep-me')
        self.assertIn('huggingface', data['mcpServers'])

    def test_legacy_gemini_httpurl_entry_is_compatible(self):
        p = self.write('.gemini/settings.json', json.dumps({'mcpServers': {'huggingface': {'httpUrl': URL, 'excludeTools': DENY}}}))
        original = p.read_bytes()
        result = self.run_registration('gemini')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(p.read_bytes(), original)
        self.assertIn('left as is', result.stdout)

    def test_codex_quoted_table_and_existing_options_preserved(self):
        p = self.write('.codex/config.toml', "model = 'custom'\n[mcp_servers.'huggingface']\nurl = '" + URL + "?login'\ndisabled_tools = " + json.dumps(DENY) + "\nstartup_timeout_sec = 20\n")
        original = p.read_bytes()
        result = self.run_registration('codex')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(p.read_bytes(), original)

    def test_codex_safe_append_preserves_others_and_permissions(self):
        p = self.write('.codex/config.toml', "model = 'custom'\n[mcp_servers.other]\ncommand = 'other-cli'\n")
        p.chmod(0o600)
        original = p.read_text()
        result = self.run_registration('codex')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(p.read_text().startswith(original))
        self.assertEqual(p.stat().st_mode & 0o777, 0o600)

    def test_codex_malformed_and_inline_table_refused_without_corruption(self):
        for content in ['not valid = [', 'mcp_servers = { other = { command = "keep-me" } }\n']:
            with self.subTest(content=content):
                p = self.write('.codex/config.toml', content)
                result = self.run_registration('codex')
                self.assertEqual(result.returncode, 1)
                self.assertIn('hf-mcp-codex', result.stdout)
                self.assertEqual(p.read_text(), content)

    def test_incompatible_existing_configs_preserved(self):
        cases = [('codex', '.codex/config.toml', '[mcp_servers.huggingface]\nurl = "' + URL + '"\n'),
                 ('gemini', '.gemini/settings.json', json.dumps({'mcpServers': {'huggingface': {'httpUrl': URL}}})),
                 ('claude', '.claude.json', json.dumps({'mcpServers': {'huggingface': {'type': 'http', 'url': 'https://other.example/mcp'}}}))]
        for client, rel, content in cases:
            with self.subTest(client=client):
                p = self.write(rel, content)
                result = self.run_registration(client)
                self.assertEqual(result.returncode, 1)
                self.assertIn('hf-mcp-' + client, result.stdout)
                self.assertEqual(p.read_text(), content)

    def test_commented_or_invalid_settings_preserved(self):
        for content in ['{/* retain this comment */ "theme": "light"}', '{ invalid']:
            p = self.write('.gemini/settings.json', content)
            result = self.run_registration('gemini')
            self.assertEqual(result.returncode, 1)
            self.assertIn('manual review', result.stdout)
            self.assertEqual(p.read_text(), content)

    def test_registration_failure_fails_install_without_leaking_error_secrets(self):
        for client in ['codex', 'gemini', 'claude']:
            with self.subTest(client=client):
                self.env['FAIL_CLIENT'] = client
                if client == 'gemini':
                    self.write('.gemini', 'a file where the settings directory should be')
                result = self.run_registration(client)
                self.assertEqual(result.returncode, 1)
                self.assertIn('hf-mcp-' + client, result.stdout)
                self.assertNotIn('test-secret-must-not-appear', result.stdout + result.stderr)
                self.assertNotIn('Traceback', result.stdout + result.stderr)

    def test_gemini_other_servers_env_references_never_expanded(self):
        # Codex's PR #18 blocker: `gemini mcp add` saved Bearer ${OTHER_TOKEN} as the value.
        self.env['OTHER_TOKEN'] = 'synthetic-other-secret'
        original = ('{\n  "theme": "light",\n  "mcpServers": {\n    "other": {\n      "url": "https://x.example/mcp",\n'
                    '      "headers": {"Authorization": "Bearer ${OTHER_TOKEN}"}\n    }\n  }\n}\n')
        p = self.write('.gemini/settings.json', original)
        p.chmod(0o640)
        result = self.run_registration('gemini')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        after = p.read_text()
        self.assertNotIn('synthetic-other-secret', after)
        self.assertNotIn('test-secret-must-not-appear', after)
        self.assertIn('"Bearer ${OTHER_TOKEN}"', after)
        self.assertIn('"Bearer ${HF_TOKEN}"', after)
        # Every original byte is kept: the entry is one contiguous insertion.
        at = after.index('\n    "huggingface"')
        added = len(after) - len(original)
        self.assertEqual(after[:at] + after[at + added:], original)
        self.assertEqual(p.stat().st_mode & 0o777, 0o640)
        data = json.loads(after)
        self.assertEqual(data['mcpServers']['huggingface'], {
            'url': URL, 'type': 'http', 'headers': {'Authorization': 'Bearer ${HF_TOKEN}'}, 'excludeTools': DENY})
        self.assertEqual(list(data['mcpServers']), ['huggingface', 'other'])
        self.assertFalse((self.root / 'calls.jsonl').exists())
        self.assertEqual(list((self.root / '.gemini').iterdir()), [p])  # no temporary file left

    def test_gemini_insertion_layouts_and_refusals(self):
        entry = {'url': URL, 'type': 'http', 'headers': {'Authorization': 'Bearer ${HF_TOKEN}'}, 'excludeTools': DENY}
        added = [('{}', {}),
                 ('{"theme":{"mcpServers":1},"mcpServers":{}}', {'theme': {'mcpServers': 1}}),
                 ('{"mcp\\u0053ervers": {"o": {"command": "x"}}}', {'o': {'command': 'x'}}),
                 ('{"note": "a } { \\" [ ] / text", "mcpServers": {"o": {"args": ["{", "}"]}}}', {'o': {'args': ['{', '}']}}),
                 ('\ufeff{\r\n  "theme": "caf\u00e9"\r\n}\r\n', {'theme': 'caf\u00e9'})]
        for content, rest in added:
            with self.subTest(content=content):
                p = self.write('.gemini/settings.json', content)
                result = self.run_registration('gemini')
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                raw = p.read_bytes()
                text = raw.decode('utf-8')
                self.assertEqual(raw.startswith(b'\xef\xbb\xbf'), content.startswith('\ufeff'))
                if '\r\n' in content:
                    self.assertEqual(text.count('\n'), text.count('\r\n'))
                data = json.loads(text.lstrip('\ufeff'))
                self.assertEqual(data['mcpServers']['huggingface'], entry)
                servers = data['mcpServers']
                if 'o' in rest:
                    self.assertEqual(servers['o'], rest['o'])
                if 'theme' in rest:
                    self.assertEqual(data['theme'], rest['theme'])
        for content in ['{"mcpServers": {}, "mcpServers": {"x": {}}}', '{"mcpServers": null}',
                        '{"a": {/* c */ "b": 1}}', '[1, 2]']:
            with self.subTest(content=content):
                p = self.write('.gemini/settings.json', content)
                result = self.run_registration('gemini')
                self.assertEqual(result.returncode, 1)
                self.assertIn('hf-mcp-gemini', result.stdout)
                self.assertEqual(p.read_text(), content)

    def test_non_standard_json_refused_by_check_and_by_splice(self):
        # Plain JSON only: Windows PowerShell 5.1's ConvertFrom-Json and Python's json.loads each
        # accept some of these, Gemini's parser does not. The .ps1 applies the same strict grammar.
        contents = ['{"theme":\'light\'}', '{theme: "light"}', '{"a": {b: 1}}', '{"a": NaN}',
                    '{"a": Infinity}', '{"a": -Infinity}', '{"a": [1,]}', '{"a": 01}', '{"a": "\\x"}']
        for content in contents:
            for forced in ['', 'check_client_hf() { return 3; }']:
                with self.subTest(content=content, forced=forced):
                    p = self.write('.gemini/settings.json', content)
                    result = self.run_registration('gemini', forced)
                    self.assertEqual(result.returncode, 1)
                    self.assertIn('manual review' if not forced else 'could not add', result.stdout)
                    self.assertEqual(p.read_text(), content)
                    self.assertEqual(list((self.root / '.gemini').iterdir()), [p])

    def test_new_settings_file_created_meanwhile_is_not_overwritten(self):
        # Another process creates settings.json just before the bootstrap's final rename/link.
        hook = self.root / 'hook'
        hook.mkdir()
        (hook / 'sitecustomize.py').write_text(
            'import os\n'
            'def race(real):\n'
            '    def step(src, dst, *a, **k):\n'
            '        t = os.environ["RACE_TARGET"]\n'
            '        if not os.path.exists(t):\n'
            '            with open(t, "w") as f:\n'
            '                f.write("{\\"created\\": \\"meanwhile\\"}\\n")\n'
            '        return real(src, dst, *a, **k)\n'
            '    return step\n'
            'os.link, os.replace = race(os.link), race(os.replace)\n')
        target = self.root / '.gemini/settings.json'
        self.env.update(PYTHONPATH=str(hook), RACE_TARGET=str(target))
        result = self.run_registration('gemini')
        self.assertEqual(result.returncode, 1)
        self.assertIn('changed during the edit', result.stdout)
        self.assertEqual(target.read_text(), '{"created": "meanwhile"}\n')
        self.assertEqual(list((self.root / '.gemini').iterdir()), [target])

    def test_existing_settings_edited_meanwhile_is_kept(self):
        # Another process edits settings.json right before the bootstrap's swap, after its read:
        # in place (as Gemini writes it) or by renaming a new file over it. Either edit survives.
        hook = self.root / 'hook'
        hook.mkdir()
        (hook / 'sitecustomize.py').write_text(r'''import ctypes, os
done = []
def once(fn):
    def step(*a, **k):
        if not done:
            done.append(1)
            t = os.environ["RACE_TARGET"]
            with open(t + ".new" if os.environ["RACE_MODE"] == "rename" else t, "w") as f:
                f.write('{"edited": "meanwhile"}\n')
            if os.environ["RACE_MODE"] == "rename":
                os.rename(t + ".new", t)
        return fn(*a, **k)
    return step
class CDLL(ctypes.CDLL):
    def __getattr__(self, name):
        fn = super().__getattr__(name)
        return once(fn) if name in ("renameat2", "renamex_np") else fn
ctypes.CDLL = CDLL
os.replace = once(os.replace)
''')
        target = self.root / '.gemini/settings.json'
        for mode in ['in-place', 'rename']:
            with self.subTest(mode=mode):
                self.write('.gemini/settings.json', '{"theme": "light"}\n')
                self.env.update(PYTHONPATH=str(hook), RACE_TARGET=str(target), RACE_MODE=mode)
                result = self.run_registration('gemini')
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn('changed during the edit', result.stdout)
                self.assertEqual(target.read_text(), '{"edited": "meanwhile"}\n')
                self.assertEqual(list((self.root / '.gemini').iterdir()), [target])

    def test_gemini_edit_keeps_owner_group_mode_and_acl(self):
        if os.geteuid() != 0:
            self.skipTest('needs root to give the settings file another owner and group')
        p = self.write('.gemini/settings.json', '{"theme": "light"}\n')
        os.chown(p, 1, 2)
        # user::rw- group::--- group:3:r-- mask::r-- other::---, so mode 0640 without the owning group.
        acl = struct.pack('<I', 2) + b''.join(struct.pack('<HHI', *e) for e in [
            (0x01, 6, 0xFFFFFFFF), (0x04, 0, 0xFFFFFFFF), (0x08, 4, 3), (0x10, 4, 0xFFFFFFFF), (0x20, 0, 0xFFFFFFFF)])
        try:
            os.setxattr(p, 'system.posix_acl_access', acl)
        except OSError:
            self.skipTest('filesystem without POSIX ACLs')
        before = os.stat(p)
        result = self.run_registration('gemini')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        after = os.stat(p)
        self.assertEqual((after.st_uid, after.st_gid, after.st_mode & 0o7777), (1, 2, before.st_mode & 0o7777))
        self.assertEqual(os.getxattr(p, 'system.posix_acl_access'), acl)
        self.assertIn('huggingface', json.loads(p.read_text())['mcpServers'])
        self.assertEqual(list((self.root / '.gemini').iterdir()), [p])

    def test_gemini_edit_refused_when_group_cannot_be_kept(self):
        if os.geteuid() != 0:
            self.skipTest('needs root to run the bootstrap as another user')
        nobody = pwd.getpwnam('nobody')
        p = self.write('.gemini/settings.json', '{"theme": "light"}\n')
        p.chmod(0o640)
        for path in [self.root, *self.root.rglob('*')]:
            os.chown(path, nobody.pw_uid, nobody.pw_gid)
        os.chown(p, nobody.pw_uid, 0)  # nobody cannot give the new file group root
        result = self.run_registration('gemini', user=nobody.pw_uid, group=nobody.pw_gid, extra_groups=[])
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('could not add', result.stdout)
        self.assertEqual(p.read_text(), '{"theme": "light"}\n')
        self.assertEqual((p.stat().st_gid, p.stat().st_mode & 0o777), (0, 0o640))
        self.assertEqual(list((self.root / '.gemini').iterdir()), [p])

    def test_gemini_symlinked_settings_stay_a_symlink(self):
        real = self.write('dotfiles/gemini-settings.json', '{"theme": "light"}\n')
        link = self.root / '.gemini/settings.json'
        link.parent.mkdir()
        link.symlink_to(real)
        result = self.run_registration('gemini')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(link.is_symlink())
        self.assertIn('huggingface', json.loads(real.read_text())['mcpServers'])
        link.unlink()
        link.symlink_to(self.root / 'missing.json')
        result = self.run_registration('gemini')
        self.assertEqual(result.returncode, 1)
        self.assertFalse((self.root / 'missing.json').exists())

    def test_gemini_settings_changed_during_edit_is_reported(self):
        result = self.run_registration('gemini', 'add_gemini_hf() { return 2; }')
        self.assertEqual(result.returncode, 1)
        self.assertIn('changed during the edit', result.stdout)
        self.assertIn('hf-mcp-gemini', result.stdout)

    def test_custom_user_config_directories(self):
        self.env['CODEX_HOME'] = str(self.root / 'custom-codex')
        self.env['CLAUDE_CONFIG_DIR'] = str(self.root / 'custom-claude')
        self.env['GEMINI_CLI_HOME'] = str(self.root / 'custom-gemini')
        result = self.run_registration()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.root / 'custom-codex/config.toml').exists())
        self.assertTrue((self.root / 'custom-claude/.claude.json').exists())
        self.assertFalse((self.root / '.claude.json').exists())
        self.assertTrue((self.root / 'custom-gemini/.gemini/settings.json').exists())
        self.assertFalse((self.root / '.gemini/settings.json').exists())
        repeat = self.run_registration()
        self.assertEqual(repeat.returncode, 0, repeat.stdout + repeat.stderr)

    def test_missing_parser_fails_explicitly_without_writing_config(self):
        result = self.run_registration('codex', 'json_python() { return 1; }')
        self.assertEqual(result.returncode, 1)
        self.assertIn('Python 3.10+', result.stdout)
        self.assertIn('hf-mcp-validation', result.stdout)
        self.assertFalse((self.root / '.codex/config.toml').exists())

if __name__ == '__main__':
    unittest.main(verbosity=2)
