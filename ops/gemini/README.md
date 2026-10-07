# Gemini from an agent session

`gemini.py` lets a Claude, Codex or other agent session ask Gemini directly, so Sanjay no longer has to copy messages between a Gemini chat and the sessions. Sanjay chose this route on 2026-10-07: a free Google AI Studio API key, stored as the `GEMINI_API_KEY` environment variable of the cloud environment.

Why this route: the Gemini CLI's personal Google sign-in is refused (`IneligibleTierError ... no longer supported for Gemini Code Assist for individuals`). Antigravity (`agy`) on DESKTOP-4D08JI5 works, but only while that PC is reachable and only within its individual quota (exhausted on 2026-10-07 until 2026-10-10 05:52 UTC). The Gemini API answers from the cloud sessions directly.

## One-time setup (Sanjay)

1. Open https://aistudio.google.com/app/apikey, choose **Create API key**, and create it in a new project. Leave billing off on that project: with no billing account, the key can only use the free tier and cannot be charged. Copy the key. It goes only into step 2's settings field, never into a chat, file or command.
2. In the Claude app or claude.ai/code, open the cloud environment menu in a session's title bar, choose the **Kapoor Syndicate** environment, then **Edit**. Add an environment variable named `GEMINI_API_KEY` with the key as its value. If the page offers a Network secrets section, use it and keep the same name.
3. Sessions started after that see the key; sessions already running do not. In a new session, `python3 ops/gemini/gemini.py --check` should print `key: from GEMINI_API_KEY` (an environment variable) or `key: supplied by the network proxy` (a Network secret, which the proxy adds to each request so the session never holds it), followed by `N models visible; auto picks: ...`.

To revoke: delete the key in AI Studio. Every session loses access at once.

## Using it

```bash
python3 ops/gemini/gemini.py "One question for Gemini"
python3 ops/gemini/gemini.py -f plan.md -f change.diff "Review this plan and diff. List problems only."
git diff master... | python3 ops/gemini/gemini.py -
python3 ops/gemini/gemini.py --thread control-room "..."   # remembers earlier turns of this thread
python3 ops/gemini/gemini.py --thread control-room --reset "..."
python3 ops/gemini/gemini.py --dry-run -f big.md "..."      # checks and sizes the input, sends nothing
python3 ops/gemini/gemini.py --list-models
```

- The answer goes to stdout. The model, token counts and finish reason go to stderr.
- `--model auto` (the default) uses the newest stable Gemini Pro the key can see. On a 429 (rate limit or free-tier quota) it retries once on the newest stable Flash. `--model <id>` or `GEMINI_MODEL` pins one.
- Threads live in `~/.local/state/kg-gemini/threads/` (mode 600, outside the repo). A cloud container's threads disappear when the container is reclaimed.
- Exit codes: 0 ok, 2 usage, 3 no key, 4 input refused, 5 API error, 6 rate limited or quota exhausted, 7 response blocked or empty.

## Rules

- On the free tier, Google may use prompts and answers to improve its products, and people may read them. So never send client or collector records, consignor names, inventory, prices, valuations, gallery photographs, or anything from a session transcript. Send code, plans, public facts and redacted summaries only.
- The script refuses inputs that look like secrets (private keys, Google, GitHub, OpenAI/Anthropic, Hugging Face, Slack or AWS keys, JWTs, `password=`-style assignments) and the key itself. It also refuses some paths outright:
  - transcripts (`.claude/projects`, `.codex/sessions`, `.pi/agent/sessions`)
  - `~/.ssh`, `~/.gemini`, `.env*` and key files
  - `ops/network/inventory.csv`, `status.md` and `out/`
  - images, and data files whose names say inventory, client, price, valuation and the like

  These checks catch obvious cases only. Keeping client data out is still the caller's job.
- The key is read only from `GEMINI_API_KEY`. It is sent only to `https://generativelanguage.googleapis.com` in the `x-goog-api-key` header, never in a URL. Redirects are refused, and error text is scrubbed of the key. Never print the variable, never copy it elsewhere, and never pass it on a command line. With no variable set, requests go out without the header and rely on the proxy adding it; if neither supplies a key, the script exits 3.
- Free tier only. Turning on billing for the key's project, or using a paid model tier, is spending, and spending needs Sanjay's yes first (root `AGENTS.md`).
- Choosing this route did not change any review gate. Whether a Gemini answer obtained this way satisfies a session's cross-model review requirement is Sanjay's call.

## Tests

`python3 -I ops/gemini/test_gemini.py` runs offline: the HTTP layer is mocked, and the tests check that the key never reaches a URL, stdout or stderr.
