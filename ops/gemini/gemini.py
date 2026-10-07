#!/usr/bin/env python3
"""Talk to Google's Gemini API from an agent session, without a person relaying.

Sanjay chose this route on 2026-10-07: a free AI Studio key, stored as the
GEMINI_API_KEY environment variable of the cloud environment (never in a file,
command line or chat). See README.md in this folder.

Guarantees:
- The key is read from GEMINI_API_KEY only and sent only to
  https://generativelanguage.googleapis.com in the x-goog-api-key header. It is
  never printed, logged, written to disk or put in a URL. Redirects are refused,
  so the header can never follow a redirect to another host. When the variable
  is absent, requests go out without the header, for an environment whose
  network proxy adds the key itself (a "network secret").
- Input that looks like a secret, a session transcript or gallery data (client
  or collector records, inventory, prices, valuations, photographs) is refused
  before anything is sent. The free tier lets Google use prompts to improve its
  products, so nothing confidential belongs here. The guard catches obvious
  cases only; the caller still has to keep client data out.
- Standard library only (Python 3.9+).

Usage:
  gemini.py "question"                       one-off prompt
  gemini.py -f a.md -f b.diff "review this"  files are appended to the prompt
  echo text | gemini.py -                    prompt from stdin
  gemini.py --thread control-room "..."      keep a running conversation
  gemini.py --list-models | --check | --dry-run ...

Exit codes: 0 ok, 2 usage, 3 no key, 4 input refused, 5 API error,
6 rate limited or quota exhausted, 7 response blocked or empty.
"""

import argparse
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
KEY_ENV = "GEMINI_API_KEY"
DEFAULT_MAX_CHARS = 200_000
HARD_MAX_CHARS = 1_000_000
TIMEOUT_S = 300

EXIT_USAGE, EXIT_NO_KEY, EXIT_REFUSED, EXIT_API, EXIT_RATE, EXIT_BLOCKED = 2, 3, 4, 5, 6, 7

# High-confidence secret shapes. Matching any of them refuses the input outright.
SECRET_PATTERNS = [
    ("private key block", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_\-]{35}")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})")),
    ("OpenAI/Anthropic-style key", re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}")),
    ("Hugging Face token", re.compile(r"\bhf_[A-Za-z0-9]{30,}")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}")),
    ("AWS access key id", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("JSON web token", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")),
    ("credential assignment",
     re.compile(r"(?i)(?<![A-Za-z])(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|"
                r"auth[_-]?token|bearer)[A-Za-z0-9_]*[\"']?\s*[:=]\s*[\"']?(?=[^\s\"'(){}<>]*\d)(?=[^\s\"'(){}<>]*[A-Za-z])"
                r"[^\s\"'(){}<>$]{16,}")),
]

# Paths that must never be sent: transcripts, keys, the network map, env files.
PATH_DENY = [
    re.compile(r"(^|/)\.claude/projects(/|$)"),
    re.compile(r"(^|/)\.codex/sessions(/|$)"),
    re.compile(r"(^|/)\.pi/agent/sessions(/|$)"),
    re.compile(r"(^|/)\.ssh(/|$)"),
    re.compile(r"(^|/)\.gemini(/|$)"),
    re.compile(r"(^|/)ops/network/(out/|inventory\.csv$|status\.md$)"),
    re.compile(r"(^|/)\.env(\.[^/]*)?$"),
    re.compile(r"(^|/)id_(rsa|dsa|ecdsa|ed25519)[^/]*$"),
    re.compile(r"\.(pem|key|p12|pfx|kdbx)$"),
]
# Gallery data files: a data-like extension plus a business-data word in the name.
DATA_EXT = re.compile(r"\.(csv|tsv|xlsx?|xlsm|numbers|json|txt|md|pdf|docx?|eml|msg)$", re.I)
DATA_WORD = re.compile(r"(inventory|valuation|apprais|consign|invoice|client|collector|"
                       r"customer|guest|price|pricing|wire|bank|payroll|provenance)", re.I)
IMAGE_EXT = re.compile(r"\.(jpe?g|png|gif|heic|heif|tiff?|webp|bmp|raw|cr2|cr3|nef|arw|dng|psd)$", re.I)

THREAD_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
VARIANT_WORDS = ("preview", "exp", "latest", "lite", "tts", "image", "live", "audio",
                 "embedding", "thinking", "customtools", "computer")


class Refused(Exception):
    """The input must not be sent."""


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ApiError(code, "REDIRECT_REFUSED",
                       "the API answered with a redirect; refusing to resend the key")


_OPENER = urllib.request.build_opener(_NoRedirect())


def err(msg):
    print(msg, file=sys.stderr)


def scrub(text, key):
    if key and text:
        text = text.replace(key, "[GEMINI_API_KEY]")
    return text


# ---------------------------------------------------------------- input guard

def check_path(path):
    norm = os.path.realpath(os.path.expanduser(path)).replace("\\", "/")
    shown = path.replace("\\", "/")
    for pat in PATH_DENY:
        if pat.search(norm) or pat.search(shown):
            raise Refused(f"{path}: this path is never sent (keys, transcripts, network map or env files)")
    base = os.path.basename(norm)
    if IMAGE_EXT.search(base):
        raise Refused(f"{path}: images are not sent (gallery photographs stay private)")
    if DATA_EXT.search(base) and DATA_WORD.search(base):
        raise Refused(f"{path}: looks like gallery business data (client, inventory, price or "
                      f"valuation records); not sent")


def check_text(text, label, key):
    if key and key in text:
        raise Refused(f"{label}: contains the Gemini API key itself")
    for name, pat in SECRET_PATTERNS:
        if pat.search(text):
            raise Refused(f"{label}: contains something shaped like a secret ({name}); remove it first")


def read_file(path):
    check_path(path)
    try:
        with open(path, "rb") as fh:
            raw = fh.read(HARD_MAX_CHARS * 4 + 1)
    except OSError as e:
        raise Refused(f"{path}: cannot read ({e.strerror})")
    if b"\x00" in raw[:8192]:
        raise Refused(f"{path}: binary file; only text is sent")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        raise Refused(f"{path}: not UTF-8 text")


def build_prompt(args, key):
    parts = []
    if args.prompt == "-":
        parts.append(sys.stdin.read())
    elif args.prompt:
        parts.append(args.prompt)
    for path in args.file or []:
        body = read_file(path)
        check_text(body, path, key)
        parts.append(f"\n\n===== file: {os.path.basename(path)} =====\n{body}")
    text = "".join(parts).strip()
    if not text:
        raise Refused("nothing to send: give a prompt, '-' for stdin, or -f files")
    check_text(text, "prompt", key)
    limit = min(args.max_chars, HARD_MAX_CHARS)
    if len(text) > limit:
        raise Refused(f"input is {len(text):,} characters, over the {limit:,} limit "
                      f"(--max-chars raises it, up to {HARD_MAX_CHARS:,})")
    return text


# ---------------------------------------------------------------- threads

def state_dir():
    base = os.environ.get("KG_GEMINI_HOME") or os.path.join(
        os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"), "kg-gemini")
    return os.path.join(base, "threads")


def thread_path(name):
    if not THREAD_NAME.match(name):
        raise Refused(f"thread name {name!r}: use letters, digits, '.', '_' or '-' (max 64)")
    return os.path.join(state_dir(), name + ".json")


def load_thread(name):
    path = thread_path(name)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    turns = data.get("turns", []) if isinstance(data, dict) else []
    return [t for t in turns if isinstance(t, dict) and t.get("role") in ("user", "model")
            and isinstance(t.get("text"), str)]


def save_thread(name, turns):
    path = thread_path(name)
    d = os.path.dirname(path)
    os.makedirs(d, mode=0o700, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"turns": turns}, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------- HTTP

def call(method, path, key, body=None):
    url = API_ROOT + path
    if not url.startswith(API_ROOT + "/"):
        raise ApiError(0, "BAD_PATH", "refusing a request outside the Gemini API root")
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if key:
        req.add_header("x-goog-api-key", key)
    req.add_header("Content-Type", "application/json")
    try:
        with _OPENER.open(req, timeout=TIMEOUT_S) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8", "replace"))
            info = payload.get("error", {}) if isinstance(payload, dict) else {}
        except (ValueError, OSError):
            info = {}
        raise ApiError(e.code, info.get("status", "HTTP_ERROR"),
                       scrub(info.get("message", e.reason or "request failed"), key))
    except urllib.error.URLError as e:
        raise ApiError(0, "NETWORK", scrub(str(e.reason), key))


def list_models(key):
    models, token = [], None
    for _ in range(20):
        q = "/models?pageSize=1000" + (f"&pageToken={urllib.parse.quote(token, safe='')}" if token else "")
        page = call("GET", q, key)
        models.extend(page.get("models", []))
        token = page.get("nextPageToken")
        if not token:
            break
    return models


def _version(name):
    m = re.match(r"^gemini-(\d+(?:\.\d+)?)-(pro|flash)$", name)
    return (float(m.group(1)), m.group(2)) if m else None


def pick_models(models):
    """Newest stable Pro first, then newest stable Flash as the fallback."""
    best = {}
    for m in models:
        if "generateContent" not in m.get("supportedGenerationMethods", []):
            continue
        name = m.get("name", "").split("/", 1)[-1]
        if any(w in name for w in VARIANT_WORDS):
            continue
        v = _version(name)
        if v and (v[1] not in best or v[0] > best[v[1]][0]):
            best[v[1]] = (v[0], name)
    return [best[k][1] for k in ("pro", "flash") if k in best]


def generate(model, key, turns, system, temperature):
    body = {"contents": [{"role": t["role"], "parts": [{"text": t["text"]}]} for t in turns]}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    if temperature is not None:
        body["generationConfig"] = {"temperature": temperature}
    return call("POST", f"/models/{urllib.parse.quote(model, safe='.-_')}:generateContent", key, body)


def response_text(resp):
    fb = resp.get("promptFeedback") or {}
    if fb.get("blockReason"):
        return None, f"prompt blocked: {fb['blockReason']}"
    cands = resp.get("candidates") or []
    if not cands:
        return None, "no candidates returned"
    c = cands[0]
    texts = [p.get("text", "") for p in (c.get("content") or {}).get("parts", [])
             if isinstance(p, dict) and not p.get("thought")]
    text = "".join(texts).strip()
    if not text:
        return None, f"empty answer (finishReason {c.get('finishReason', '?')})"
    return text, c.get("finishReason", "")


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description="Ask Gemini through the API key in GEMINI_API_KEY.")
    ap.add_argument("prompt", nargs="?", help="the prompt, or '-' to read it from stdin")
    ap.add_argument("-f", "--file", action="append", help="append a text file to the prompt (repeatable)")
    ap.add_argument("-m", "--model", default=os.environ.get("GEMINI_MODEL", "auto"),
                    help="model id, or 'auto' (newest stable Pro, falling back to Flash)")
    ap.add_argument("-s", "--system", help="system instruction")
    ap.add_argument("-t", "--thread", help="keep a running conversation under this name")
    ap.add_argument("--reset", action="store_true", help="start --thread afresh")
    ap.add_argument("--temperature", type=float)
    ap.add_argument("--max-chars", type=int, default=DEFAULT_MAX_CHARS)
    ap.add_argument("--json", action="store_true", help="print the raw API response")
    ap.add_argument("--dry-run", action="store_true", help="check and size the input, send nothing")
    ap.add_argument("--list-models", action="store_true")
    ap.add_argument("--check", action="store_true", help="confirm the key works (lists models)")
    args = ap.parse_args(argv)

    key = os.environ.get(KEY_ENV, "").strip()

    try:
        if args.list_models or args.check:
            models = list_models(key)
            picks = pick_models(models)
            if args.check:
                source = "from GEMINI_API_KEY" if key else "supplied by the network proxy"
                print(f"key: {source}; {len(models)} models visible; auto picks: {', '.join(picks) or 'none'}")
            else:
                for m in models:
                    if "generateContent" in m.get("supportedGenerationMethods", []):
                        print(m.get("name", "").split("/", 1)[-1])
            return 0

        if args.prompt is None and not args.file:
            ap.print_usage(sys.stderr)
            return EXIT_USAGE
        text = build_prompt(args, key)
        history = []
        if args.thread is not None:
            history = [] if args.reset else load_thread(args.thread)
            for t in history:
                check_text(t["text"], f"thread {args.thread}", key)
        turns = history + [{"role": "user", "text": text}]

        if args.dry_run:
            chars = sum(len(t["text"]) for t in turns)
            print(f"dry run: {len(turns)} turn(s), {chars:,} characters (~{chars // 4:,} tokens), "
                  f"model {args.model}; nothing sent")
            return 0
        candidates = pick_models(list_models(key)) if args.model == "auto" else [args.model]
        if not candidates:
            err("no stable Gemini Pro or Flash model is visible to this key; pass --model")
            return EXIT_API
        last = None
        for model in candidates:
            try:
                resp = generate(model, key, turns, args.system, args.temperature)
            except ApiError as e:
                last = e
                if e.status == 429 and model != candidates[-1]:
                    err(f"{model}: {e.code} (rate limit or free-tier quota); trying {candidates[-1]}")
                    continue
                raise
            if args.json:
                print(json.dumps(resp, indent=1))
                return 0
            answer, info = response_text(resp)
            if answer is None:
                err(f"{model}: {info}")
                return EXIT_BLOCKED
            print(answer)
            usage = resp.get("usageMetadata") or {}
            err(f"[{model} | in {usage.get('promptTokenCount', '?')} / out "
                f"{usage.get('candidatesTokenCount', '?')} tokens | {info}]")
            if args.thread is not None:
                save_thread(args.thread, turns + [{"role": "model", "text": answer}])
            return 0
        raise last
    except Refused as e:
        err(f"refused: {e}")
        return EXIT_REFUSED
    except ApiError as e:
        if not key and e.status in (401, 403):
            err(f"no key: {KEY_ENV} is not set and the network proxy supplied none "
                f"({e.status} {e.code}); see ops/gemini/README.md")
            return EXIT_NO_KEY
        err(f"Gemini API error {e.status} {e.code}: {scrub(e.message, key)}")
        return EXIT_RATE if e.status == 429 else EXIT_API


if __name__ == "__main__":
    sys.exit(main())
