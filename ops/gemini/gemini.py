#!/usr/bin/env python3
"""Talk to Google's Gemini API from an agent session, without a person relaying.

Sanjay chose this route on 2026-10-07: a free AI Studio key attached to the
cloud environment as a network secret (the agent proxy adds it to requests for
generativelanguage.googleapis.com, so sessions never hold it), or, where
network secrets are unavailable, the GEMINI_API_KEY environment variable. See
README.md in this folder.

Guarantees:
- When GEMINI_API_KEY is set, the key is sent only to
  https://generativelanguage.googleapis.com in the x-goog-api-key header. It is
  never put in a URL, printed, logged or written to disk, and redirects are
  refused so the header cannot follow one. When the variable is absent, requests
  carry no key and rely on the network proxy to add it.
- Everything sent (prompt, stdin, -f files, --system, thread history) is checked
  first. Input that looks like a secret, a session transcript, the network map,
  mail, a database or spreadsheet, or gallery business data (client or collector
  records, inventory, prices, valuations, photographs) is refused. The free tier
  lets Google use prompts to improve its products, so nothing confidential
  belongs here. The checks catch obvious cases only; the caller still has to keep
  client data out.
- Standard library only (Python 3.9+).

Usage:
  gemini.py "question"                       one-off prompt
  gemini.py -f a.md -f b.diff "review this"  files are appended to the prompt
  git diff | gemini.py -                     prompt from stdin
  gemini.py --thread control-room "..."      keep a running conversation
  gemini.py --list-models | --check | --dry-run ...

Exit codes: 0 ok, 2 usage, 3 no key, 4 input refused, 5 API error,
6 rate limited or quota exhausted, 7 response blocked or empty.
"""

import argparse
import json
import os
import re
import stat
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
FALLBACK_STATUSES = (429, 500, 503, 504)

EXIT_USAGE, EXIT_NO_KEY, EXIT_REFUSED, EXIT_API, EXIT_RATE, EXIT_BLOCKED = 2, 3, 4, 5, 6, 7

KEY_SHAPE = re.compile(r"^[A-Za-z0-9_\-]{20,128}$")
MODEL_ID = re.compile(r"^(?:models/)?([a-z0-9][a-z0-9.\-]{0,63})$")
THREAD_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
VARIANT_WORDS = ("preview", "exp", "latest", "lite", "tts", "image", "live", "audio",
                 "embedding", "thinking", "customtools", "computer")

# ---------------------------------------------------------------- secret shapes

# High-confidence token formats. Any match refuses the input.
SECRET_PATTERNS = [
    ("private key block", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_\-]{35}")),
    ("Google OAuth token or client secret", re.compile(r"\bya29\.[A-Za-z0-9_\-]{20,}|\bGOCSPX-[A-Za-z0-9_\-]{20,}")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})")),
    ("GitLab token", re.compile(r"\bglpat-[A-Za-z0-9_\-]{20,}")),
    ("npm token", re.compile(r"\bnpm_[A-Za-z0-9]{36}\b")),
    ("OpenAI/Anthropic-style key", re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}")),
    ("Stripe secret key", re.compile(r"\b[rs]k_live_[A-Za-z0-9]{16,}")),
    ("Supabase secret key", re.compile(r"\bsb_secret_[A-Za-z0-9_\-]{16,}|\bsbp_[a-f0-9]{40}\b")),
    ("SendGrid key", re.compile(r"\bSG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{30,}")),
    ("Hugging Face token", re.compile(r"\bhf_[A-Za-z0-9]{30,}")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}")),
    ("AWS access key id", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("JSON web token", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")),
    ("Solana keypair", re.compile(r"\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]")),
    ("bearer token", re.compile(r"(?i)\bauthorization\s*[:=]\s*[\"']?bearer\s+[A-Za-z0-9._~+/=\-]{16,}")),
    ("netrc password", re.compile(r"(?im)^\s*(?:machine\s+\S+\s+)?(?:login\s+\S+\s+)?password\s+[^\s$<{]{6,}\s*$")),
]

# Values that are references or placeholders, not secrets.
PLACEHOLDER = re.compile(r"(?i)^(?:process\.env|import\.meta\.env|env\.|os\.environ|os\.getenv|getenv|"
                         r"secrets\.|vars\.|config\.|settings\.|self\.|this\.)|^[$<{/%]|"
                         r"test|example|fake|dummy|placeholder|changeme|your[_-]|redacted|x{4,}|\*{4,}")
# key: value / key = value where the key names a credential.
ASSIGNMENT = re.compile(
    r"(?i)(?<![A-Za-z])(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|"
    r"service[_-]?role(?:[_-]?key)?|client[_-]?secret|credentials?)[A-Za-z0-9_]*[\"']?\s*[:=]\s*"
    r"(?:(\"|')([^\"'\n]{8,})\2|([^\s\"',;(){}<>\[\]]{8,}))")
# KEY=value lines in env files and shell scripts.
ENV_LINE = re.compile(r"(?m)^\s*(?:export\s+)?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?)"
                      r"[A-Z0-9_]*\s*=\s*[\"']?([^\s\"'#]{8,})")
URL_PASSWORD = re.compile(r"\b[a-z][a-z0-9+.\-]*://[^/\s:@'\"]+:([^/\s@'\"]{6,})@", re.I)


def _classes(v):
    """How many of lower case, upper case and digits a value mixes (a crude entropy test)."""
    return sum(bool(re.search(p, v)) for p in (r"[a-z]", r"[A-Z]", r"[0-9]"))


def _looks_secret(keyword, value):
    if PLACEHOLDER.search(value):
        return False
    if re.match(r"(?i)^(password|passwd|pwd)$", keyword) or keyword.lower().startswith("pass"):
        return True
    return _classes(value) >= 3 or (len(value) >= 32 and _classes(value) >= 2)


def find_secret(text):
    """Name of the first secret shape found in text, or None."""
    for name, pat in SECRET_PATTERNS:
        if pat.search(text):
            return name
    for m in ASSIGNMENT.finditer(text):
        value = m.group(3) or m.group(4) or ""
        if _looks_secret(m.group(1), value):
            return "credential assignment"
    for m in ENV_LINE.finditer(text):
        if not PLACEHOLDER.search(m.group(1)):
            return "credential in an env-style line"
    for m in URL_PASSWORD.finditer(text):
        if not PLACEHOLDER.search(m.group(1)) and m.group(1).lower() not in ("password", "pass"):
            return "password in a URL"
    return None


def redact_secrets(text):
    for _, pat in SECRET_PATTERNS:
        text = pat.sub("[redacted]", text)
    return text


# ---------------------------------------------------------------- path rules

PATH_DENY = [(re.compile(p, re.I), why) for p, why in [
    (r"(^|/)\.claude/(projects|todos|shell-snapshots|session-env|file-history|statsig|ide)(/|$)", "a session transcript"),
    (r"(^|/)\.claude/history\.jsonl$|(^|/)\.config/claude(/|$)|(^|/)\.codex(/|$)|(^|/)\.pi(/|$)", "a session transcript"),
    (r"(^|/)tasks/[^/]+\.output$|(^|/)subagents(/|$)", "an agent run log"),
    (r"\.(jsonl|ndjson)$", "a log or transcript (JSON lines)"),
    (r"(^|/)\.(ssh|gnupg|gemini|aws|kube|docker)(/|$)|(^|/)\.config/(solana|gcloud|gh)(/|$)", "a credentials folder"),
    (r"(^|/)(\.netrc|_netrc|\.pgpass|\.git-credentials|\.npmrc|\.pypirc|\.dev\.vars|\.envrc)$", "a credentials file"),
    (r"(^|/)\.env(?!\.(example|sample|template|dist)$)[^/]*$|\.env$", "an env file"),
    (r"(^|/)id_(rsa|dsa|ecdsa|ed25519)[^/]*$|\.(pem|key|p12|pfx|kdbx|keystore|jks)$", "a key file"),
    (r"(^|/)(credentials|service[-_]?account)[^/]*\.json$|keypair[^/]*\.json$", "a credentials file"),
    (r"(^|/)ops/network/(out(/|$)|inventory\.csv$|status\.md$)", "the network map"),
    (r"\.(eml|msg|mbox|pst|vcf|ics)$", "mail, contacts or calendar"),
    (r"\.(csv|tsv|xlsx?|xlsm|ods|numbers|sql|sqlite3?|db|dump|bak)$", "a spreadsheet, database or export"),
    (r"\.(jpe?g|png|gif|heic|heif|tiff?|webp|bmp|raw|cr2|cr3|nef|arw|dng|psd)$", "an image"),
]]
# Documents whose path names gallery business data.
DOC_EXT = re.compile(r"\.(md|txt|json|ya?ml|xml|html?|pdf|docx?|rtf|pages)$", re.I)
DATA_WORD = re.compile(
    r"(?<![a-z])(inventor(y|ies)|valuations?|appraisals?|consign(ment|ments|or|ors)?|invoices?|clients?|"
    r"collectors?|customers?|guests?|prices?|pricing|price[-_]?list|wires?|wire[-_]?transfers?|bank(ing)?|"
    r"payroll|provenance|orders?|contacts?|sales|donations?|donors?|auctions?|offers?|buyers?|squarespace)(?![a-z])",
    re.I)


class Refused(Exception):
    """The input must not be sent."""


def check_path_name(name):
    """Refuse a path by its name alone (also used for paths named inside diffs)."""
    p = name.replace("\\", "/")
    for pat, why in PATH_DENY:
        if pat.search(p):
            raise Refused(f"{name}: looks like {why}; never sent")
    if DOC_EXT.search(p) and DATA_WORD.search(p):
        raise Refused(f"{name}: its path names gallery business data (clients, inventory, prices, "
                      f"valuations and the like); never sent")


def check_path(path):
    check_path_name(path)
    check_path_name(os.path.realpath(os.path.expanduser(path)))


DIFF_PATH = re.compile(r"(?m)^(?:diff --git a/(\S+) b/(\S+)|\+\+\+ b/(\S+)|--- a/(\S+)|"
                       r"rename (?:from|to) (\S+)|Index: (\S+))$")
TRANSCRIPT_LINE = re.compile(r'"parentUuid"\s*:|"sessionId"\s*:\s*"[^"]+"[^\n]*"type"\s*:\s*"(user|assistant)"|'
                             r'"type"\s*:\s*"response_item"')
NETWORK_MAP_HEADER = re.compile(r"(?mi)^name,ip,mac,os,user,role\b")
SENSITIVE_COLUMNS = re.compile(r"(?i)(?<![a-z])(price|cost|ask[_ ]?price|consignor|valuation|appraisal|collector|"
                               r"client|buyer|donor|guest|email|phone|address)(?![a-z])")


def check_text(text, label, key):
    if key and key in text:
        raise Refused(f"{label}: contains the Gemini API key itself")
    found = find_secret(text)
    if found:
        raise Refused(f"{label}: contains something shaped like a secret ({found}); remove it first")
    if TRANSCRIPT_LINE.search(text):
        raise Refused(f"{label}: looks like a session transcript; never sent")
    if NETWORK_MAP_HEADER.search(text):
        raise Refused(f"{label}: looks like the network inventory; never sent")
    for m in DIFF_PATH.finditer(text):
        for name in m.groups():
            if name and name != "/dev/null":
                try:
                    check_path_name(name)
                except Refused as e:
                    raise Refused(f"{label}: a diff touches {e}")
    for line in text.splitlines():
        cells = re.split(r"[,\t;|]", line)
        if len(cells) >= 3 and sum(bool(SENSITIVE_COLUMNS.fullmatch(c.strip().strip('"').strip())) for c in cells) >= 2:
            raise Refused(f"{label}: has a table header with client or price columns ({line.strip()[:60]}); never sent")


def read_file(path):
    check_path(path)
    try:
        st = os.stat(path)
    except OSError as e:
        raise Refused(f"{path}: cannot read ({e.strerror})")
    if not stat.S_ISREG(st.st_mode):
        raise Refused(f"{path}: not a regular file (pipes and devices are not read; use '-' for stdin)")
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


def load_thread(name, key):
    path = thread_path(name)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    turns = data.get("turns", []) if isinstance(data, dict) else []
    turns = [t for t in turns if isinstance(t, dict) and t.get("role") in ("user", "model")
             and isinstance(t.get("text"), str)]
    for t in turns:
        if t["role"] == "user":
            check_text(t["text"], f"thread {name} ({path}; --reset starts afresh)", key)
        else:
            t["text"] = redact_secrets(scrub(t["text"], key))
    return turns


def save_thread(name, turns, key):
    path = thread_path(name)
    d = os.path.dirname(path)
    os.makedirs(d, mode=0o700, exist_ok=True)
    clean = [{"role": t["role"], "text": t["text"] if t["role"] == "user"
              else redact_secrets(scrub(t["text"], key))} for t in turns]
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"turns": clean}, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------- HTTP

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
            raw = resp.read()
        return json.loads(raw.decode("utf-8"))
    except ApiError:
        raise
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8", "replace"))
            info = payload.get("error", {}) if isinstance(payload, dict) else {}
        except Exception:
            info = {}
        raise ApiError(e.code, str(info.get("status", "HTTP_ERROR")),
                       scrub(str(info.get("message", "request failed")), key))
    except urllib.error.URLError as e:
        raise ApiError(0, "NETWORK", scrub(str(e.reason), key))
    except Exception as e:
        # Timeouts, resets, bad responses, header errors. The exception text can
        # quote request headers, so only its type is reported.
        raise ApiError(0, type(e).__name__, "request failed")


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

def _utf8_streams():
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stdin, "reconfigure"):
        try:
            sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass


def main(argv=None):
    _utf8_streams()
    ap = argparse.ArgumentParser(description="Ask Gemini through the gallery's API key.")
    ap.add_argument("prompt", nargs="?", help="the prompt, or '-' to read it from stdin")
    ap.add_argument("-f", "--file", action="append", help="append a text file to the prompt (repeatable)")
    ap.add_argument("-m", "--model", default=os.environ.get("GEMINI_MODEL", "auto"),
                    help="model id, or 'auto' (newest stable Pro, falling back to Flash)")
    ap.add_argument("-s", "--system", help="system instruction (checked like the prompt)")
    ap.add_argument("-t", "--thread", help="keep a running conversation under this name")
    ap.add_argument("--reset", action="store_true", help="start --thread afresh")
    ap.add_argument("--temperature", type=float)
    ap.add_argument("--max-chars", type=int, default=DEFAULT_MAX_CHARS)
    ap.add_argument("--json", action="store_true", help="print the raw API response")
    ap.add_argument("--dry-run", action="store_true", help="check and size the input, send nothing")
    ap.add_argument("--list-models", action="store_true")
    ap.add_argument("--check", action="store_true", help="confirm a key reaches the API (lists models)")
    args = ap.parse_args(argv)

    key = os.environ.get(KEY_ENV, "").strip()
    if key and not KEY_SHAPE.match(key):
        err(f"{KEY_ENV} is malformed (unexpected characters or length); fix it in the environment "
            f"settings. Its value is not shown.")
        return EXIT_NO_KEY

    try:
        if args.model != "auto":
            m = MODEL_ID.match(args.model)
            if not m:
                raise Refused("model id: use letters, digits, '.' and '-' only (for example gemini-2.5-flash)")
            args.model = m.group(1)

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
        if args.system:
            check_text(args.system, "system instruction", key)
        history = []
        if args.thread is not None:
            thread_path(args.thread)
            history = [] if args.reset else load_thread(args.thread, key)
        turns = history + [{"role": "user", "text": text}]
        total = sum(len(t["text"]) for t in turns) + len(args.system or "")
        limit = min(args.max_chars, HARD_MAX_CHARS)
        if total > limit:
            hint = " (most of it is thread history; --reset starts afresh)" if history else ""
            raise Refused(f"input is {total:,} characters, over the {limit:,} limit{hint}; "
                          f"--max-chars raises it, up to {HARD_MAX_CHARS:,}")

        if args.dry_run:
            print(f"dry run: {len(turns)} turn(s), {total:,} characters (~{total // 4:,} tokens), "
                  f"model {args.model}; nothing sent")
            return 0

        candidates = pick_models(list_models(key)) if args.model == "auto" else [args.model]
        if not candidates:
            err("no stable Gemini Pro or Flash model is visible to this key; pass --model")
            return EXIT_API
        for i, model in enumerate(candidates):
            try:
                resp = generate(model, key, turns, args.system, args.temperature)
            except ApiError as e:
                if e.status in FALLBACK_STATUSES and i < len(candidates) - 1:
                    err(f"{model}: {e.status} {e.code}; trying {candidates[i + 1]}")
                    continue
                raise
            answer, info = response_text(resp)
            if args.json:
                print(scrub(json.dumps(resp, indent=1, ensure_ascii=False), key))
            elif answer is not None:
                print(scrub(answer, key))
            if answer is None:
                err(f"{model}: {info}")
                return EXIT_BLOCKED
            usage = resp.get("usageMetadata") or {}
            note = "" if info in ("STOP", "") else f" | WARNING: finishReason {info}, the answer may be cut short"
            err(f"[{model} | in {usage.get('promptTokenCount', '?')} / out "
                f"{usage.get('candidatesTokenCount', '?')} tokens | {info}{note}]")
            if args.thread is not None:
                save_thread(args.thread, turns + [{"role": "model", "text": answer}], key)
            return 0
        return EXIT_API
    except Refused as e:
        err(f"refused: {e}")
        return EXIT_REFUSED
    except ApiError as e:
        if not key and e.status == 403 and "unregistered callers" in e.message:
            err(f"no key: {KEY_ENV} is not set and the network proxy supplied none "
                f"({e.status} {e.code}); see ops/gemini/README.md")
            return EXIT_NO_KEY
        if not key and e.status == 401:
            err(f"a credential reached Google but was rejected ({e.status} {e.code}): the network "
                f"secret must use header x-goog-api-key with no Bearer prefix; see ops/gemini/README.md")
            return EXIT_NO_KEY
        err(f"Gemini API error {e.status} {e.code}: {scrub(e.message, key)}")
        return EXIT_RATE if e.status == 429 else EXIT_API


if __name__ == "__main__":
    sys.exit(main())
