# Gemini from an agent session

`gemini.py` lets a Claude, Codex or other agent session ask Gemini directly, so Sanjay no longer has to copy messages between a Gemini chat and the sessions. Sanjay chose this route on 2026-10-07: a free Google AI Studio API key, stored as the `GEMINI_API_KEY` environment variable of the cloud environment.

Why this route: the Gemini CLI's personal Google sign-in is refused (`IneligibleTierError ... no longer supported for Gemini Code Assist for individuals`). Antigravity (`agy`) on DESKTOP-4D08JI5 works, but only while that PC is reachable and only within its individual quota (exhausted on 2026-10-07 until 2026-10-10 05:52 UTC). The Gemini API answers from the cloud sessions directly.

## One-time setup (Sanjay)

1. Open https://aistudio.google.com/app/apikey, choose **Create API key**, and create it in a new project. Leave billing off on that project: with no billing account, the key can only use the free tier and cannot be charged. Copy the key. It goes only into step 2's settings field, never into a chat, file or command.
2. At claude.ai/code, open the cloud environment menu in a session's title bar, choose **Kapoor Syndicate**, then **Edit**. Under **Network secrets**, choose **Add secret** and fill in:
   - **Name**: `Gemini API`. This is only a label.
   - **Allowed websites**: `generativelanguage.googleapis.com`
   - **Custom headers**: change the header **Name** from `Authorization` to `x-goog-api-key`, clear the **Prefix** (delete `Bearer`), and paste the key as the **Value**. Gemini rejects an API key sent as `Authorization: Bearer`.

   Then choose **Connect**. A secret can't be edited afterwards; to fix one, delete it and add it again. The agent proxy adds the key to every request for that host, so sessions never see it. If the list marks the secret **Not sent**, the note under it says why.

   On a plan without Network secrets, add an environment variable `GEMINI_API_KEY` instead. Anyone who uses the environment can read environment variables.
3. `python3 ops/gemini/gemini.py --check` should then print `key: supplied by the network proxy` (or `key: from GEMINI_API_KEY` for the variable), followed by `N models visible; auto picks: ...`. A 403 "unregistered callers" means no key reached Google: wrong environment, wrong website, or a **Not sent** secret. A 401 "invalid authentication credentials" means the header is still `Authorization: Bearer`.

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
