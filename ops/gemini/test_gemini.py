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


if __name__ == "__main__":
    unittest.main(verbosity=1)
