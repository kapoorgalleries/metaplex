#!/usr/bin/env python3
"""Offline tests for gemini.py. No network: the HTTP opener is replaced.

Run: python3 -I ops/gemini/test_gemini.py
"""

import contextlib
import io
import json
import os
import stat
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gemini  # noqa: E402

FAKE_KEY = "AIzaFAKEfakeFAKEfakeFAKEfakeFAKEfake123"  # 39 chars, Google key shape

MODELS = {"models": [
    {"name": "models/gemini-2.5-pro", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-3.1-pro", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-3.5-pro-preview", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-3.8-flash", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-3.8-flash-lite", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-embedding-001", "supportedGenerationMethods": ["embedContent"]},
]}


def answer(text, finish="STOP"):
    return {"candidates": [{"content": {"parts": [{"text": "hidden", "thought": True}, {"text": text}]},
                            "finishReason": finish}],
            "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 2}}


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def http_error(url, code, status, message):
    body = json.dumps({"error": {"code": code, "status": status, "message": message}}).encode()
    return urllib.error.HTTPError(url, code, status, {}, io.BytesIO(body))


class Recorder:
    """Stands in for the opener: records requests and replays scripted responses."""

    def __init__(self, script):
        self.script = list(script)
        self.requests = []

    def open(self, req, timeout=None):
        self.requests.append(req)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return FakeResp(json.dumps(item).encode())


def run(argv, script=(), env_key=FAKE_KEY, stdin=None):
    rec = Recorder(script)
    out, errs = io.StringIO(), io.StringIO()
    env = {k: v for k, v in os.environ.items() if k != "GEMINI_API_KEY"}
    if env_key is not None:
        env["GEMINI_API_KEY"] = env_key
    with mock.patch.object(gemini, "_OPENER", rec), mock.patch.dict(os.environ, env, clear=True), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(errs):
        if stdin is not None:
            with mock.patch.object(sys, "stdin", io.StringIO(stdin)):
                code = gemini.main(argv)
        else:
            code = gemini.main(argv)
    return code, out.getvalue(), errs.getvalue(), rec


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = mock.patch.dict(os.environ, {"KG_GEMINI_HOME": self.tmp.name})
        p.start()
        self.addCleanup(p.stop)

    def write(self, name, text):
        path = os.path.join(self.tmp.name, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        return path

    def assertNoKey(self, *texts):
        for t in texts:
            self.assertNotIn(FAKE_KEY, t)


class KeyHandling(Base):
    def test_key_goes_in_header_only_to_api_host(self):
        code, out, errs, rec = run(["hello"], [MODELS, answer("hi there")])
        self.assertEqual(code, 0, errs)
        self.assertEqual(out.strip(), "hi there")
        for req in rec.requests:
            self.assertTrue(req.full_url.startswith("https://generativelanguage.googleapis.com/v1beta/"))
            self.assertNotIn(FAKE_KEY, req.full_url)
            self.assertEqual(req.get_header("X-goog-api-key"), FAKE_KEY)
        self.assertNoKey(out, errs)

    def test_no_key_and_no_proxy_key(self):
        e = http_error("u", 403, "PERMISSION_DENIED", "Method doesn't allow unregistered callers")
        code, out, errs, rec = run(["hello"], [e], env_key=None)
        self.assertEqual(code, gemini.EXIT_NO_KEY)
        self.assertIn("network proxy supplied none", errs)
        self.assertEqual(len(rec.requests), 1)
        self.assertIsNone(rec.requests[0].get_header("X-goog-api-key"))

    def test_proxy_bearer_header_is_diagnosed(self):
        e = http_error("u", 401, "UNAUTHENTICATED", "Request had invalid authentication credentials.")
        code, _, errs, _ = run(["--check"], [e], env_key=None)
        self.assertEqual(code, gemini.EXIT_NO_KEY)
        self.assertIn("x-goog-api-key", errs)

    def test_proxy_supplied_key(self):
        code, out, errs, rec = run(["hello"], [MODELS, answer("via proxy")], env_key=None)
        self.assertEqual(code, 0, errs)
        self.assertEqual(out.strip(), "via proxy")
        for req in rec.requests:
            self.assertIsNone(req.get_header("X-goog-api-key"))
        code, out, _, _ = run(["--check"], [MODELS], env_key=None)
        self.assertIn("supplied by the network proxy", out)

    def test_key_echoed_in_error_is_scrubbed(self):
        e = http_error("u", 400, "INVALID_ARGUMENT", f"bad key {FAKE_KEY}")
        code, out, errs, _ = run(["-m", "gemini-3.1-pro", "hello"], [e])
        self.assertEqual(code, gemini.EXIT_API)
        self.assertIn("[GEMINI_API_KEY]", errs)
        self.assertNoKey(out, errs)

    def test_redirect_is_refused(self):
        h = gemini._NoRedirect()
        with self.assertRaises(gemini.ApiError):
            h.redirect_request(None, None, 302, "Found", {}, "https://evil.example/")

    def test_prompt_containing_the_key_is_refused(self):
        code, out, errs, rec = run([f"my key is {FAKE_KEY}"], [MODELS, answer("x")])
        self.assertEqual(code, gemini.EXIT_REFUSED)
        self.assertEqual(rec.requests, [])
        self.assertNoKey(out, errs)

    def test_check_prints_no_key_material(self):
        code, out, errs, _ = run(["--check"], [MODELS])
        self.assertEqual(code, 0)
        self.assertIn("key: from GEMINI_API_KEY", out)
        self.assertIn("gemini-3.1-pro, gemini-3.8-flash", out)
        self.assertNoKey(out, errs)


class Guards(Base):
    SECRETS = [
        "-----BEGIN OPENSSH PRIVATE KEY-----\nabc",
        "token ghp_" + "a" * 36,
        "key sk-ant-" + "b" * 30,
        "hf_" + "c" * 34,
        "AKIA" + "D" * 16,
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijklmnop",
        "password = 'Hunter2Hunter2Hunter2'",
        "TRIMURTI_ACCESS_KEY: x9Yz8Wv7Ut6Sr5Qp4On3",
        "AIza" + "E" * 35,
    ]
    BENIGN = [
        "token = getToken()",
        "const apiKey = process.env.GEMINI_API_KEY",
        "Rotate TRIMURTI_ACCESS_KEY with openssl rand -base64 33",
        "password: ${{ secrets.PASSWORD }}",
        "the secret is that there is none",
    ]

    def test_secret_shapes_refused(self):
        for s in self.SECRETS:
            with self.subTest(s=s[:20]):
                code, _, errs, rec = run([s], [MODELS, answer("x")])
                self.assertEqual(code, gemini.EXIT_REFUSED, errs)
                self.assertEqual(rec.requests, [])

    def test_benign_text_allowed(self):
        for s in self.BENIGN:
            with self.subTest(s=s[:20]):
                code, _, errs, _ = run(["--dry-run", s])
                self.assertEqual(code, 0, errs)

    def test_secret_inside_file_refused(self):
        p = self.write("notes.md", "fine\nghp_" + "z" * 36 + "\n")
        code, _, errs, rec = run(["-f", p, "review"], [MODELS, answer("x")])
        self.assertEqual(code, gemini.EXIT_REFUSED)
        self.assertEqual(rec.requests, [])

    def test_denied_paths(self):
        for rel in [".claude/projects/x/s.jsonl", ".codex/sessions/a.json", ".ssh/config",
                    "ops/network/inventory.csv", "ops/network/status.md", "ops/network/out/scan.csv",
                    ".env", ".env.local", "id_ed25519", "server.pem", "x/.gemini/settings.json"]:
            with self.subTest(rel=rel):
                p = self.write(rel, "harmless")
                code, _, errs, rec = run(["-f", p, "read"], [MODELS, answer("x")])
                self.assertEqual(code, gemini.EXIT_REFUSED, rel)
                self.assertEqual(rec.requests, [])

    def test_gallery_data_and_images_refused_but_code_allowed(self):
        for rel in ["inventory-2026.csv", "client_list.xlsx", "Valuations.md", "price-sheet.json",
                    "photo.JPG", "scan.heic"]:
            with self.subTest(rel=rel):
                p = self.write(rel, "x")
                code, _, _, _ = run(["--dry-run", "-f", p, "q"])
                self.assertEqual(code, gemini.EXIT_REFUSED, rel)
        for rel in ["inventory-feed.ts", "price.py", "client.rs", "README.md"]:
            with self.subTest(rel=rel):
                p = self.write(rel, "export const x = 1\n")
                code, _, errs, _ = run(["--dry-run", "-f", p, "q"])
                self.assertEqual(code, 0, f"{rel}: {errs}")

    def test_binary_refused(self):
        p = os.path.join(self.tmp.name, "blob.txt")
        with open(p, "wb") as fh:
            fh.write(b"abc\x00def")
        code, _, _, _ = run(["--dry-run", "-f", p, "q"])
        self.assertEqual(code, gemini.EXIT_REFUSED)

    def test_size_limit(self):
        code, _, errs, _ = run(["--dry-run", "--max-chars", "10", "this is longer than ten"])
        self.assertEqual(code, gemini.EXIT_REFUSED)
        self.assertIn("limit", errs)

    def test_stdin_prompt(self):
        code, out, errs, _ = run(["-"], [MODELS, answer("from stdin")], stdin="question?")
        self.assertEqual(code, 0, errs)
        self.assertEqual(out.strip(), "from stdin")

    def test_empty_refused(self):
        code, _, _, _ = run(["   "])
        self.assertEqual(code, gemini.EXIT_REFUSED)


class Models(Base):
    def test_pick_newest_stable_pro_then_flash(self):
        self.assertEqual(gemini.pick_models(MODELS["models"]), ["gemini-3.1-pro", "gemini-3.8-flash"])

    def test_pick_numeric_not_lexical(self):
        ms = [{"name": f"models/gemini-{v}-pro", "supportedGenerationMethods": ["generateContent"]}
              for v in ("2.5", "10.0", "9.1")]
        self.assertEqual(gemini.pick_models(ms), ["gemini-10.0-pro"])

    def test_429_on_pro_falls_back_to_flash(self):
        e = http_error("u", 429, "RESOURCE_EXHAUSTED", "quota")
        code, out, errs, rec = run(["q"], [MODELS, e, answer("flash answer")])
        self.assertEqual(code, 0, errs)
        self.assertEqual(out.strip(), "flash answer")
        self.assertIn("gemini-3.8-flash:generateContent", rec.requests[-1].full_url)

    def test_429_everywhere_is_rate_exit(self):
        e1 = http_error("u", 429, "RESOURCE_EXHAUSTED", "quota")
        e2 = http_error("u", 429, "RESOURCE_EXHAUSTED", "quota")
        code, _, errs, _ = run(["q"], [MODELS, e1, e2])
        self.assertEqual(code, gemini.EXIT_RATE)

    def test_explicit_model_skips_listing(self):
        code, _, _, rec = run(["-m", "gemini-3.1-pro", "q"], [answer("ok")])
        self.assertEqual(code, 0)
        self.assertEqual(len(rec.requests), 1)

    def test_blocked_prompt(self):
        code, _, errs, _ = run(["-m", "m", "q"], [{"promptFeedback": {"blockReason": "SAFETY"}}])
        self.assertEqual(code, gemini.EXIT_BLOCKED)
        self.assertIn("SAFETY", errs)

    def test_thought_parts_dropped(self):
        code, out, _, _ = run(["-m", "m", "q"], [answer("visible")])
        self.assertEqual(out.strip(), "visible")


class Threads(Base):
    def test_thread_round_trip_and_permissions(self):
        run(["-m", "m", "-t", "room", "first"], [answer("one")])
        code, out, errs, rec = run(["-m", "m", "-t", "room", "second"], [answer("two")])
        self.assertEqual(code, 0, errs)
        sent = json.loads(rec.requests[0].data)["contents"]
        self.assertEqual([c["role"] for c in sent], ["user", "model", "user"])
        self.assertEqual(sent[1]["parts"][0]["text"], "one")
        path = gemini.thread_path("room")
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(path)).st_mode) & 0o077, 0)

    def test_reset(self):
        run(["-m", "m", "-t", "r", "first"], [answer("one")])
        _, _, _, rec = run(["-m", "m", "-t", "r", "--reset", "again"], [answer("x")])
        self.assertEqual(len(json.loads(rec.requests[0].data)["contents"]), 1)

    def test_failed_call_does_not_save(self):
        e = http_error("u", 500, "INTERNAL", "boom")
        run(["-m", "m", "-t", "f", "q"], [e])
        self.assertFalse(os.path.exists(gemini.thread_path("f")))

    def test_bad_thread_names(self):
        for name in ["../x", "a/b", "", ".hidden", "x" * 65]:
            with self.subTest(name=name):
                code, _, _, _ = run(["--dry-run", "-t", name, "q"])
                self.assertEqual(code, gemini.EXIT_REFUSED)

    def test_dry_run_sends_nothing(self):
        code, out, _, rec = run(["--dry-run", "hello"], env_key=None)
        self.assertEqual(code, 0)
        self.assertIn("nothing sent", out)
        self.assertEqual(rec.requests, [])



class ReviewFindings(Base):
    """Regression tests for the findings of the 2026-10-07 adversarial review."""

    def test_system_instruction_is_checked(self):
        for s in ["ctx ghp_" + "a" * 36, f"key={FAKE_KEY}", "-----BEGIN OPENSSH PRIVATE KEY-----"]:
            with self.subTest(s=s[:12]):
                code, out, errs, rec = run(["-m", "m", "-s", s, "hello"], [answer("x")])
                self.assertEqual(code, gemini.EXIT_REFUSED)
                self.assertEqual(rec.requests, [])
                self.assertNotIn(FAKE_KEY, out + errs)

    def test_system_instruction_counts_toward_limit(self):
        code, _, errs, rec = run(["--max-chars", "100", "-m", "m", "-s", "x" * 200, "hi"], [answer("x")])
        self.assertEqual(code, gemini.EXIT_REFUSED)
        self.assertEqual(rec.requests, [])

    def test_model_id_validated_and_prefix_stripped(self):
        code, _, errs, rec = run(["-m", FAKE_KEY + "/../x", "q"], [answer("x")])
        self.assertEqual(code, gemini.EXIT_REFUSED)
        self.assertNotIn(FAKE_KEY, errs)
        code, _, _, rec = run(["-m", "models/gemini-2.5-flash", "q"], [answer("ok")])
        self.assertEqual(code, 0)
        self.assertIn("/models/gemini-2.5-flash:generateContent", rec.requests[0].full_url)

    def test_malformed_key_never_printed(self):
        for bad in [FAKE_KEY + "\n" + FAKE_KEY, FAKE_KEY[:10] + "\r" + FAKE_KEY[10:], "short"]:
            with self.subTest(bad=repr(bad[:6])):
                code, out, errs, rec = run(["--check"], [MODELS], env_key=bad)
                self.assertEqual(code, gemini.EXIT_NO_KEY)
                self.assertEqual(rec.requests, [])
                self.assertNotIn(FAKE_KEY[:20], out + errs)

    def test_transport_errors_are_clean(self):
        for exc in [TimeoutError("timed out"), ConnectionResetError("reset"), ValueError(f"bad header {FAKE_KEY}")]:
            with self.subTest(exc=type(exc).__name__):
                code, out, errs, _ = run(["-m", "m", "q"], [exc])
                self.assertEqual(code, gemini.EXIT_API)
                self.assertNotIn("Traceback", errs)
                self.assertNotIn(FAKE_KEY, out + errs)

    def test_non_json_200_is_clean(self):
        class Bad(Recorder):
            def open(self, req, timeout=None):
                self.requests.append(req)
                return FakeResp(b"<html>proxy page</html>")
        rec = Bad([])
        out, errs = io.StringIO(), io.StringIO()
        with mock.patch.object(gemini, "_OPENER", rec), mock.patch.dict(os.environ, {"GEMINI_API_KEY": FAKE_KEY}), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(errs):
            code = gemini.main(["-m", "m", "q"])
        self.assertEqual(code, gemini.EXIT_API)
        self.assertNotIn("Traceback", errs.getvalue())

    def test_5xx_on_pro_falls_back_to_flash(self):
        for status in (500, 503, 504):
            with self.subTest(status=status):
                e = http_error("u", status, "UNAVAILABLE", "overloaded")
                code, out, _, rec = run(["q"], [MODELS, e, answer("flash")])
                self.assertEqual(code, 0)
                self.assertEqual(out.strip(), "flash")

    def test_thread_history_counts_toward_limit(self):
        run(["-m", "m", "-t", "big", "x" * 150], [answer("y" * 150)])
        code, _, errs, rec = run(["--max-chars", "250", "-m", "m", "-t", "big", "more"], [answer("z")])
        self.assertEqual(code, gemini.EXIT_REFUSED)
        self.assertIn("--reset", errs)
        self.assertEqual(rec.requests, [])

    def test_secret_shaped_example_in_answer_is_redacted_not_blocking(self):
        run(["-m", "m", "-t", "room", "how do I set an R2 key?"], [answer("use AKIAIOSFODNN7EXAMPLE as the id")])
        with open(gemini.thread_path("room"), encoding="utf-8") as fh:
            self.assertNotIn("AKIAIOSFODNN7EXAMPLE", fh.read())
        code, _, errs, rec = run(["-m", "m", "-t", "room", "thanks"], [answer("ok")])
        self.assertEqual(code, 0, errs)
        self.assertNotIn("AKIAIOSFODNN7EXAMPLE", rec.requests[0].data.decode())

    def test_json_mode_saves_thread_and_reports_blocked(self):
        code, out, _, _ = run(["--json", "-m", "m", "-t", "j", "q"], [answer("a")])
        self.assertEqual(code, 0)
        self.assertTrue(os.path.exists(gemini.thread_path("j")))
        code, out, _, _ = run(["--json", "-m", "m", "q"], [{"promptFeedback": {"blockReason": "SAFETY"}}])
        self.assertEqual(code, gemini.EXIT_BLOCKED)
        self.assertIn("SAFETY", out)

    def test_truncated_answer_warns(self):
        code, out, errs, _ = run(["-m", "m", "q"], [answer("partial", finish="MAX_TOKENS")])
        self.assertEqual(code, 0)
        self.assertIn("WARNING", errs)

    def test_content_guards_on_stdin_and_prompt(self):
        cases = {
            "transcript": '{"parentUuid":"a1","sessionId":"s","type":"user","message":{"role":"user"}}',
            "codex transcript": '{"type":"response_item","payload":{}}',
            "network map": "name,ip,mac,os,user,role,ssh_port,trimurti,notes\ndesk,192.168.50.10,,windows,s,admin,22,yes,",
            "price table": "sku,title,cost,ask_price,consignor\n1,Thangka,100,900,Someone",
            "diff of network map": "diff --git a/ops/network/inventory.csv b/ops/network/inventory.csv\n+++ b/ops/network/inventory.csv\n+x",
            "diff of transcript": "diff --git a/.claude/projects/p/s.jsonl b/.claude/projects/p/s.jsonl\n",
        }
        for name, text in cases.items():
            with self.subTest(case=name):
                code, _, errs, rec = run(["-"], [MODELS, answer("x")], stdin=text)
                self.assertEqual(code, gemini.EXIT_REFUSED, errs)
                self.assertEqual(rec.requests, [])
                code, _, _, _ = run(["--dry-run", text])
                self.assertEqual(code, gemini.EXIT_REFUSED)

    def test_pipes_and_devices_refused(self):
        fifo = os.path.join(self.tmp.name, "pipe")
        os.mkfifo(fifo)
        code, _, errs, _ = run(["--dry-run", "-f", fifo, "q"])
        self.assertEqual(code, gemini.EXIT_REFUSED)
        self.assertIn("regular file", errs)

    def test_more_denied_paths(self):
        for rel in [".config/claude/projects/p/s.jsonl", ".claude/history.jsonl", "fakehome/.Claude/Projects/s.txt",
                    ".codex/history.jsonl", ".codex/archived_sessions/a.txt", "x/tasks/wm5.output", "notes.jsonl",
                    ".dev.vars", ".envrc", ".env-production", "prod.env", ".ENV", ".netrc", ".pgpass",
                    ".git-credentials", ".aws/credentials", ".config/solana/id.json", "deploy-keypair.json",
                    "service-account.json", "gallery/clients/mehta-family.md", "valuations/2026/bronze.txt",
                    "orders.csv", "contacts.csv", "guests.sql", "collectors.vcf", "Re- thangka offer.eml",
                    "sales-2026.xlsx", "donors.yaml"]:
            with self.subTest(rel=rel):
                p = self.write(rel, "harmless")
                code, _, _, rec = run(["--dry-run", "-f", p, "q"])
                self.assertEqual(code, gemini.EXIT_REFUSED, rel)

    def test_more_secret_formats(self):
        for s in ["SUPABASE_SERVICE_ROLE_KEY=sb_secret_" + "a1B2" * 8,
                  'curl -H "Authorization: Bearer abcDEF123456ghiJKL789"',
                  "machine db.example.com login postgres password Sup3rS3cretPw",
                  "[" + ",".join(["12"] * 64) + "]",
                  "DATABASE_URL=postgresql://postgres:Pw9xLq2zT@db.example.supabase.co:5432/postgres",
                  "DB_PASSWORD=CorrectHorseBatteryStaple",
                  "glpat-" + "x" * 20, "npm_" + "A" * 36, "ya29." + "b" * 30, "GOCSPX-" + "c" * 24,
                  "sk_live_" + "d" * 24]:
            with self.subTest(s=s[:24]):
                code, _, _, rec = run(["--dry-run", s])
                self.assertEqual(code, gemini.EXIT_REFUSED, s[:40])

    def test_ordinary_code_still_passes(self):
        for s in ["credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET! }",
                  "apiKey: process.env.GPT4_API_KEY",
                  "passwordResetPath: /account/reset-password/v2/confirm",
                  "secretName: letsencrypt-prod-2024",
                  "const key = 'sk-TESTKEY0123456789'",
                  'API_KEY = os.environ["GEMINI_API_KEY"]',
                  "GEMINI_API_KEY=YOUR_API_KEY",
                  "postgresql://user:password@localhost/db",
                  "token: ${{ secrets.GITHUB_TOKEN }}"]:
            with self.subTest(s=s[:24]):
                code, _, errs, _ = run(["--dry-run", s])
                self.assertEqual(code, 0, f"{s}: {errs}")
        for rel in [".env.example", "wireframes.md", "src/inventory-feed.ts", "price.py", "README.md",
                    ".claude/settings.json", ".claude/README.md"]:
            with self.subTest(rel=rel):
                p = self.write(rel, "export const x = 1\n")
                code, _, errs, _ = run(["--dry-run", "-f", p, "q"])
                self.assertEqual(code, 0, f"{rel}: {errs}")

    def test_non_ascii_answer_on_cp1252_console(self):
        raw = io.BytesIO()
        out = io.TextIOWrapper(raw, encoding="cp1252")
        rec = Recorder([answer("thangka — Tibet, 18th c. ✓")])
        with mock.patch.object(gemini, "_OPENER", rec), mock.patch.dict(os.environ, {"GEMINI_API_KEY": FAKE_KEY}), \
                mock.patch.object(sys, "stdout", out), contextlib.redirect_stderr(io.StringIO()):
            code = gemini.main(["-m", "m", "q"])
            out.flush()
        self.assertEqual(code, 0)
        self.assertIn("✓", raw.getvalue().decode("utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
