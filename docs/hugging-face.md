# Hugging Face at Kapoor Galleries

This guide is current as of 2026-09-24. It covers what is wired in, where it lives, how each agent signs in, what costs money, and what was left out on purpose.

- **Tags.** A fact that could not be checked is marked *unverified*. Everything else was read in current docs or source, or seen by running the tool.
- **Sources.** Each fact names its source inline. The underlying research is in `research_notes/Hugging Face integration/`: `agent_tooling.md` covers the agent tooling, and `inference_providers.md` covers the storefront provider.

## What is integrated, and where

| Piece | Where | Used by |
| --- | --- | --- |
| "Hugging Face" AI provider | `js/packages/web/src/ai/providers.ts`, calling `https://router.huggingface.co/v1` | Dealers, from AI settings in the storefront |
| 18 Hugging Face agent skills | `.agents/skills/<name>/`, plus `.claude/skills/<name>` symlinks. Pinned in `skills-lock.json` | Claude Code, Codex, Gemini CLI |
| Hugging Face MCP server for Codex | `.codex/config.toml` | Codex, in a trusted checkout |
| Hugging Face MCP server for Claude Code | Sanjay's claude.ai Hugging Face connector. Other machines use a user-scope entry (see below) | Claude Code |
| `hf` CLI and its `hf-cli` skill | Installed per machine by `ops/network/scripts/bootstrap-ai-clis.sh` / `.ps1`. Pass `--skip-hf` to leave it out | Every agent on the LAN machines |
| Agent rules | `AGENTS.md`. `CLAUDE.md` only imports it | Codex, Claude Code. Gemini CLI once configured (see below) |

`AGENTS.md` sets the rules agents follow:

- Nothing that spends money goes ahead without Sanjay's explicit yes.
- Nothing is published or uploaded to the Hub without his yes.
- Tokens are never copied into project files, saved commands, command arguments, logs or chat replies. Interactive sign-in may save credentials in the client's own credential store; the storefront uses the browser storage described below.
- Gallery photographs, client records, inventory and valuations never go to the Hub.

## Storefront: Hugging Face as an AI provider

1. In the storefront's AI settings, pick **Hugging Face**.
2. Paste a fine-grained access token that has only the **Make calls to Inference Providers** permission.
   - Create it at <https://huggingface.co/settings/tokens>: choose **Fine-grained** and tick nothing else.
   - The token is saved in that browser's local storage. A read or write token would also open the account's repositories to anyone who got hold of it.
   - HF's authentication docs ask for exactly this token: "a `fine-grained` token with `Make calls to Inference Providers` permissions" (<https://huggingface.co/docs/inference-providers/index>).

The provider's own note in the settings panel explains model suffixes (`:provider`, `:cheapest`, `:preferred`) and what happens when credit runs out. Credits are covered under [Costs and credits](#costs-and-credits).

This provider is separate from the Trimurti gateway, the `trimurti` provider. The gateway lives in `kapoorgalleries/sb1-vuxiwzek` and was not changed.

The token guidance above applies to the Inference Providers router. Whether a private dedicated Inference Endpoint accepts a Providers-only token is *unverified* (the endpoint docs name no permission; `research_notes/Hugging Face integration/inference_providers.md` §10), so do not broaden the token stored in the browser to reach one: put a trusted proxy that holds the endpoint's credential in Base URL and leave the token blank. Endpoint use remains a separate, reviewed setup.

## Agent skills (Claude Code, Codex, Gemini CLI)

### What is vendored

The skills below come from [`huggingface/skills`](https://github.com/huggingface/skills), pinned at commit `80f9fa530e46f4ae642fcb9e1725bad0e1979395`. That commit is "Sync HF CLI skill from huggingface_hub@v2.0.0 (#261)", 2026-09-24T12:02:12Z, and was the head of `main` when fetched.

How the copy was made and checked:

- 135 files were fetched from `raw.githubusercontent.com` at that commit; each returned HTTP 200 with plain text, not an HTML error page. The lock-hash check under "Updating the vendored skills" passed on 2026-09-25 (all 20 skills).
- Every file's SHA-256 matches the digest in HF's published skills bucket (`hf://buckets/huggingface/skills/distribution/latest/skills.json`). HF built that bucket from the same commit.
- The five scripts GitHub marks executable are executable here too:
  - `huggingface-llm-trainer/scripts/convert_to_gguf.py`, `estimate_cost.py` and `hf_benchmarks.py`
  - `huggingface-paper-publisher/scripts/paper_manager.py`
  - `huggingface-vision-trainer/scripts/estimate_cost.py`
- `huggingface-datasets/SKILL.md` has CRLF line endings upstream, and they are kept, because the hash covers the exact bytes. Claude Code 2.1.282 and Codex 0.156.1 both load it.

| Skill | Use it for | Can spend money? |
| --- | --- | --- |
| `huggingface-datasets` | Dataset Viewer API: rows, search, filters, parquet, statistics | No |
| `huggingface-best` | Choosing a model for a task (captioning, OCR of inscriptions, translation, similarity) | No |
| `transformers-js` | Running models in the storefront's JS/TS, in the browser or in Node | No |
| `huggingface-papers` | Reading paper pages and the papers API | No |
| `hf-mem` | Estimating the memory needed to run a model | No |
| `huggingface-local-models` | Running GGUF models locally with llama.cpp | No |
| `huggingface-tool-builder` | Scripts built on the Hub API | No |
| `huggingface-gradio` | Gradio apps | No |
| `huggingface-trackio` | Experiment tracking | No (can sync to a Space) |
| `huggingface-community-evals` | Evaluations on local hardware | No |
| `trl-training` | TRL training through its CLI | Only on paid hardware |
| `train-sentence-transformers` | Embedding and reranker training, local by default | Only if moved to HF Jobs |
| `huggingface-llm-trainer` | LLM fine-tuning on HF Jobs | **Yes**: Jobs |
| `huggingface-vision-trainer` | Vision fine-tuning on HF Jobs | **Yes**: Jobs |
| `huggingface-spaces` | Building and running Spaces | **Yes**, with dedicated hardware |
| `huggingface-zerogpu` | ZeroGPU Spaces | **Yes**: overflow beyond the quota is billed on paid plans |
| `huggingface-lora-space-builder` | Publishing a LoRA demo Space | **Yes**: ZeroGPU needs PRO. It also publishes |
| `huggingface-paper-publisher` | Paper pages on the Hub | No, but it publishes |

The "can spend money" column restates each skill's own description. The ZeroGPU billing comes from `huggingface-zerogpu/references/how-quota-works.md`: "For Pro / Team / Enterprise, pay-as-you-go credits cover the overflow".

### Where each agent finds them

- **Claude Code** loads `.claude/skills/<name>`. Each entry is a relative symlink to `../../.agents/skills/<name>`, the same layout as the two Supabase skills.
  - The docs say symlinked folders are supported: "a `<skill-name>` entry in the enterprise, personal, or project location can be a symlink to a directory elsewhere on disk" (<https://code.claude.com/docs/en/skills>). Claude Code 2.1.282 listed all 18 skills after they were added here.
  - A personal skill with the same name wins over a project skill ("personal over project", same page).
- **Codex** reads `.agents/skills/` in every directory from the working directory up to the repo root. It needs no project trust for this.
  - Codex 0.156.1 listed all 20 repo skills in `codex debug prompt-input`, which renders the prompt locally without calling a model.
  - Codex does not de-duplicate names. With `hf-cli` in both `~/.agents/skills` and a repo's `.agents/skills`, it listed both.
- **Gemini CLI** reads workspace skills from `.agents/skills/` only in a trusted folder ([`docs/cli/skills.md`](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md), [`docs/cli/trusted-folders.md`](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/trusted-folders.md)).

### Deliberately not vendored

- **Six `hf-cloud-*` skills.** Their only purpose is Amazon SageMaker and AWS, which the gallery does not use. Some of them create real AWS resources.

  | Skill | What it does |
  | --- | --- |
  | `hf-cloud-aws-context-discovery` | Reads the local AWS profile and identity |
  | `hf-cloud-python-env-setup` | Sets up a boto3 environment for SageMaker |
  | `hf-cloud-sagemaker-deployment-planner` | Plans SageMaker endpoints |
  | `hf-cloud-sagemaker-iam-preflight` | Can create IAM roles |
  | `hf-cloud-sagemaker-production-defaults` | Creates billed SageMaker endpoints |
  | `hf-cloud-serving-image-selection` | Can mirror images into a private ECR repository |

- **`hf-cli`.** This is the one Hugging Face platform skill left out, for four reasons:
  - It is generated from whichever `hf` version is installed ("The default `hf-cli` skill is generated locally from the installed CLI version", `hf skills add --help`, huggingface_hub 2.0.0). A vendored copy would drift from each machine's CLI.
  - The official installer already puts it in `~/.agents/skills/hf-cli` and links it into `~/.claude/skills`, and `hf update` keeps it current.
  - A repo copy would show up twice in Codex, as observed above.
  - Cloud sessions for this repo have neither `hf` nor access to huggingface.co, so a repo copy would not help there.

  On a machine where `hf` came from pip or Homebrew, add the skill with `hf skills add hf-cli --global`.

### Updating the vendored skills

Run these from the repo root on a machine that can reach GitHub.

1. Refresh every GitHub-sourced skill in `skills-lock.json`. This also updates the two Supabase skills:

   ```bash
   DISABLE_TELEMETRY=1 npx skills@1.7.0 update -p -y
   ```

   To add one more Hugging Face skill instead:

   ```bash
   DISABLE_TELEMETRY=1 npx skills@1.7.0 add huggingface/skills --skill <name> --agent claude-code codex -y
   ```

   - Codex and Gemini both read `.agents/skills`, so `codex` covers Gemini as well.
   - `DISABLE_TELEMETRY=1` stops the CLI's calls to `add-skill.vercel.sh`.
2. Review `git diff --stat .agents/skills .claude/skills skills-lock.json`.
   - No `hf-cloud-*` or `hf-cli` skill should have appeared.
   - Every new skill needs a `.claude/skills` symlink.
   - Read any new script before committing it.
3. Update the commit SHA recorded in this file. `skills-lock.json` records no commit: the CLI writes a `ref` only when you pin one.
4. Check that every folder still matches its lock hash. The script below uses the skills CLI's own `computeSkillFolderHash` scheme: a SHA-256 over each file's relative path followed by its bytes, in `localeCompare` order.

   ```bash
   node --input-type=module -e '
   import { createHash } from "node:crypto";
   import { readdirSync, readFileSync } from "node:fs";
   import { join, relative } from "node:path";
   const walk = (base, dir, out = []) => {
     for (const e of readdirSync(dir, { withFileTypes: true })) {
       const p = join(dir, e.name);
       if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(base, p, out); }
       else if (e.isFile()) out.push([relative(base, p).split("\\").join("/"), readFileSync(p)]);
     }
     return out;
   };
   const lock = JSON.parse(readFileSync("skills-lock.json", "utf8"));
   let bad = 0;
   for (const [name, entry] of Object.entries(lock.skills)) {
     const dir = join(".agents/skills", name), h = createHash("sha256");
     for (const [rel, bytes] of walk(dir, dir).sort((a, b) => a[0].localeCompare(b[0]))) { h.update(rel); h.update(bytes); }
     if (h.digest("hex") !== entry.computedHash) { bad++; console.log("MISMATCH " + name); }
   }
   console.log(bad ? bad + " mismatch(es)" : "all " + Object.keys(lock.skills).length + " skills match skills-lock.json");
   process.exitCode = bad ? 1 : 0;
   '
   ```

   On Windows, run the check in a clone with `core.autocrlf=false`. Otherwise git's line-ending conversion changes the bytes and every text file reports a mismatch.

Do not edit the vendored files by hand. A hand edit breaks the hash, and the next update overwrites it anyway.

### Known restrictions in the pinned upstream skills

The pinned examples are reference material and do not override `AGENTS.md`. Some upstream examples put a token in command arguments or ask for a token in chat; use the approved hidden-prompt or environment routes instead.

Agents must not invoke `huggingface-paper-publisher/scripts/paper_manager.py` at this pin. Its `--create-pr` option prints "not yet implemented" and commits directly (`upload_file` is never passed `create_pr`), and its arXiv parser drops the first author (`authors_matches[1:]`, line 368). This is an instruction restriction, not a technical sandbox. Use source-verified paper metadata and separately reviewed publishing commands until both upstream bugs are fixed and a new pin is verified. No vendored bytes were changed for this restriction.

## Hugging Face MCP server

The server is at `https://huggingface.co/mcp`.

- **Signed out**, it offers only `hub_repo_search`, `hub_repo_details` and `hf_fs`.
- **Signed in**, it offers the tools picked at <https://huggingface.co/settings/mcp> (source: `hf-mcp-server` 0.4.23). HF's docs list the extras on that page as "Contribute Repos", "Sandboxes" and "Run and Manage Jobs", plus the Spaces option "Dynamic Spaces" (<https://huggingface.co/docs/hub/agents-mcp>).
- **Settings for Sanjay's account:** keep Contribute Repos, Sandboxes and Run and Manage Jobs off. Turn Dynamic Spaces off unless Space tools are wanted.
  - Calling a Space can use ZeroGPU quota, and overflow is billed on paid plans.
  - The claude.ai connector on Sanjay's account currently exposes `dynamic_space` (seen 2026-09-24).
- **URL options are not a guard.** The server's URL options (`bouquet=`, `mix=`, `gradio=`) only change which tools are *advertised*, "not whether a direct `tools/call` to a known tool may execute" (hf-mcp-server README). So each client removes the risky tools itself where it can.
- **`?login` forces a sign-in.** It makes an unauthenticated client get a `401` and start OAuth. Without it, the server silently serves the anonymous tool set.

### Claude Code: deliberately not in `.mcp.json`

`.mcp.json` still holds only the Supabase server, byte for byte as before. There are three reasons.

1. **Sanjay already has it.** The Hugging Face connector on his claude.ai account reaches Claude Code in two ways:
   - Terminal, VS Code and JetBrains sessions signed in with a claude.ai subscription fetch it themselves.
   - Cloud sessions are handed it by the host.

   (<https://code.claude.com/docs/en/mcp>, "Use MCP servers from claude.ai".)
2. **A project entry would clash with the connector.** "A server you've added in Claude Code takes precedence over a claude.ai connector that points at the same URL. When this happens, `/mcp` lists the connector as hidden" (same page).
   - At the same URL, the entry would replace a working connector with one that needs a separate local sign-in.
   - At a different URL, both would load and every Hugging Face tool would appear twice.
   - The connector's exact URL is *unverified*.
3. **It would fail in the cloud.** Cloud sessions for this repo cannot reach huggingface.co. The Supabase entry already fails there with `ERR_PROXY_TUNNEL`, seen 2026-09-24. A project entry would add a second failing server and could hide the working connector.

On a machine that does not get claude.ai connectors, add the server once at user scope. That covers machines signed in with an API key, with `claude setup-token`, or through Bedrock or Vertex:

```bash
claude mcp add --scope user --transport http huggingface "https://huggingface.co/mcp?login"
claude mcp login huggingface        # over SSH: claude mcp login huggingface --no-browser
```

`ops/network/scripts/bootstrap-ai-clis.sh --with-claude-hf-mcp` runs the first command. `--no-browser` prints the authorization URL, and you paste the redirect URL back (`claude mcp login --help`, 2.1.282).

The project's shell permission rules cover both the Bash and native PowerShell tools. These are separate rule namespaces in [Claude Code permissions](https://code.claude.com/docs/en/permissions#powershell).

`claude mcp add` has no per-server tool filter. On Claude Code the guards are `AGENTS.md`, the account settings above, and the project's `.claude/settings.json`: `permissions.ask` rules for the paid and publishing tools (`hf_jobs`, `dynamic_space`, `create_repo`, the sandboxes, and the `hf jobs`, `hf endpoints`, `hf upload` and similar commands) and a `deny` for `hf auth token`, which prints the token. An ask rule prompts in every permission mode, including `bypassPermissions` (<https://code.claude.com/docs/en/permission-modes>). `.claude/README.md` lists the rules.

### Codex: `.codex/config.toml`

The project file defines `huggingface` at `https://huggingface.co/mcp?login`, with `disabled_tools` set to `hf_jobs`, `dynamic_space`, `create_repo`, `hf_sandbox`, `hf_sandbox_exec` and `hf_sandbox_fs`. It holds no credentials.

1. **Trust the checkout once per machine** in `~/.codex/config.toml` (Windows: `%USERPROFILE%\.codex\config.toml`):

   ```toml
   [projects."/absolute/path/to/metaplex"]
   trust_level = "trusted"
   ```

   Codex ignores a project's `.codex/config.toml` until that project is trusted. With Codex 0.156.1, `codex mcp list` showed no server before trust and showed `huggingface` after it.
2. **Sign in from inside the repo:** `codex mcp login huggingface`, adding `--no-browser` over SSH.
   - Run it inside the repo. Outside, Codex answers "No MCP server named 'huggingface' found."
   - Inside the trusted repo it found the server and went on to OAuth discovery. The sandbox could not reach huggingface.co, so the complete sign-in is *unverified*. HF advertises dynamic client registration, and Codex implements it.
3. **Every repo at once:** the ops bootstrap adds the same table to the user config (`$CODEX_HOME/config.toml`, or `~/.codex/config.toml` by default). It asks Codex to parse a private candidate outside this checkout before changing the user file. A project-only entry cannot satisfy this check. Compatible existing entries stay untouched; incompatible or unsupported configurations produce an `hf-mcp-codex` installation failure and remain unchanged.

Details:

- `disabled_tools` removes a tool outright. Codex also has `tools.<name>.approval_mode = "prompt"`, but how that behaves when Codex runs without approvals is *unverified*, so this repo removes the tools instead. If Sanjay approves one of those jobs, run it with the `hf` CLI.
- **Token instead of OAuth:**
  - Use `url = "https://huggingface.co/mcp"` with `bearer_token_env_var = "HF_TOKEN"`, in your user config and not in the repo.
  - Codex rejects an inline `bearer_token` for HTTP servers.
  - What Codex does when `HF_TOKEN` is unset is *unverified*.

### Gemini CLI (user level)

No project file is checked in. On each machine:

1. Register the server with a token header, because Gemini's OAuth needs a local browser callback that SSH sessions lack. The docs say it "will not work in… Remote SSH sessions without X11 forwarding" ([`docs/tools/mcp-server.md`](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md)):

   ```bash
   gemini mcp add -s user -t http huggingface https://huggingface.co/mcp -H 'Authorization: Bearer ${HF_TOKEN}'
   ```

   - The single quotes keep `${HF_TOKEN}` literal. Gemini expands it when it loads the settings file.
   - If `HF_TOKEN` is unset the header is empty, and HF serves the anonymous, read-only tools.
   - `ops/network/scripts/bootstrap-ai-clis.sh` does this step.
2. Make sure `~/.gemini/settings.json` has `"excludeTools": ["hf_jobs", "create_repo", "dynamic_space", "hf_sandbox", "hf_sandbox_exec", "hf_sandbox_fs"]` under `mcpServers.huggingface`, as a list of six separate names. In a test with Gemini CLI 0.61.0, a comma-joined `--exclude-tools a,b,c` was stored as one string.
3. Trust the checkout (`~/.gemini/trustedFolders.json`, or answer the prompt). Otherwise Gemini loads neither MCP servers nor workspace skills.
4. Have Gemini read `AGENTS.md` by adding `"context": { "fileName": ["AGENTS.md", "GEMINI.md"] }` to `~/.gemini/settings.json`. Gemini reads only `GEMINI.md` by default ([`docs/cli/gemini-md.md`](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md), "Customize the context file name").

Do not install HF's Gemini extension (`gemini extensions install https://github.com/huggingface/skills.git`). It brings all 25 skills, including the SageMaker ones, plus a second MCP server named `huggingface-skills`.

The bootstrap checks the actual `mcpServers.huggingface` entry at user scope, including `GEMINI_CLI_HOME` when set. An unrelated key named `huggingface` does not count. It preserves existing compatible configurations and reports incompatible URLs or missing tool exclusions as an installation failure. Gemini itself accepts JSON comments; the shell validator and Windows PowerShell 5.1's `ConvertFrom-Json` accept plain JSON only (PowerShell 7 also accepts comments), so a commented or otherwise unsupported settings file is left untouched for manual review. A failed registration command or a failed post-registration check makes the overall install incomplete.

## The `hf` CLI

The ops bootstrap installs `hf` with HF's official installer. It needs Python 3.10 or later, and `--skip-hf` leaves it out.

The shell bootstrap also uses Python 3.10+ on PATH to validate client JSON without printing credentials. If Python is missing, registration stops before touching any client and the run reports `hf-mcp-validation`. PowerShell uses its built-in JSON parser. Successful registration checks configuration only, not OAuth completion, account permissions or live inference.

| System | Installer command |
| --- | --- |
| macOS, Linux | `curl -LsSf https://hf.co/cli/install.sh \| bash` |
| Windows | `powershell -ExecutionPolicy ByPass -c "irm https://hf.co/cli/install.ps1 \| iex"` |

The installer also installs the `hf-cli` skill globally (<https://huggingface.co/docs/huggingface_hub/v2.0.0/guides/cli>).

| Task | Command |
| --- | --- |
| Sign in | `hf auth login`. It prints a URL and a short code: open <https://huggingface.co/oauth/device> on any machine and enter the code |
| Script authentication | Inherit `HF_TOKEN` from a secure environment; do not pass it as a `--token` argument. For an interactive session, use `hf auth login` or the hidden prompt below. |
| Check | `hf auth whoami` |
| Update the CLI and the skill | `hf update` |

- The device flow never needs a browser on the machine itself, so it should work over SSH. That is inferred from how the flow works; no HF doc says it outright.
- The token is stored under `~/.cache/huggingface/`. A set `HF_TOKEN` overrides it ("If set, this value will overwrite the token stored on the machine", `huggingface_hub` environment-variable reference).
- `hf auth token` prints the stored token. Agents are told never to run it.
- Two HF sources are out of date:
  - <https://huggingface.co/docs/hub/agents-cli> still shows `hf skills add --claude --global`. In `hf` 2.0.0 `--claude` is gone and plain `hf skills add` already links the skill for Claude Code.
  - The Homebrew formula is at 1.32.0, behind PyPI's 2.0.0.

For Gemini or a local script, Sanjay can enter a token without putting it in shell history or process arguments. In bash or zsh, in his terminal:

```bash
printf 'HF token: '; read -rs HF_TOKEN; printf '\n'; export HF_TOKEN
```

The bootstrap prints the corresponding `Read-Host -AsSecureString` instructions for PowerShell. Use `unset HF_TOKEN` (PowerShell: `Remove-Item Env:HF_TOKEN`) when finished. Do not enable shell tracing while handling credentials.

## Which token for what

Create tokens at <https://huggingface.co/settings/tokens>. HF recommends one token per app or machine (<https://huggingface.co/docs/hub/security-tokens>), and a leaked token can be revoked from the same page.

| Use | Token | Where it lives |
| --- | --- | --- |
| Storefront provider | Fine-grained, only "Make calls to Inference Providers" | The dealer's browser, in local storage |
| MCP in Claude Code or Codex | None: OAuth sign-in | The client's own credential store |
| MCP in Gemini CLI | A `read` token, one per machine. HF's docs: "You need a valid Hugging Face token with READ permissions to use MCP tools" (<https://huggingface.co/docs/hub/spaces-mcp-servers>) | The `HF_TOKEN` environment variable |
| `hf` CLI | The browser sign-in above. Use a write token only on a machine where Sanjay wants uploads | `~/.cache/huggingface/token` |

Never put a token in this repository, in `.mcp.json`, in `.codex/config.toml`, or in a committed settings file.

## Costs and credits

- **Inference Providers** (the storefront provider, and any agent inference call). Source: <https://huggingface.co/docs/inference-providers/pricing>.
  - Included credit is $0.10 a month on a free account ("subject to change") and $2.00 on PRO.
  - After that, the router answers HTTP 402 until credit is bought or the month resets.
  - Only successful requests are billed.
  - Spending is shown at <https://huggingface.co/settings/billing>.
- **PRO, Team and Enterprise credits** also pay for Inference Endpoints, Spaces hardware and Jobs (same page).
- **HF Jobs** "are available to any user or organization with a positive credit balance". They are billed by the minute of hardware, for example about $0.17 for 10 minutes on `a10g-small` (<https://huggingface.co/docs/hub/jobs-pricing>).
- **ZeroGPU** runs against a daily quota. Overflow is billed on paid plans, and hosting a ZeroGPU Space needs PRO (the `huggingface-zerogpu` and `huggingface-lora-space-builder` skills).
- **Guards:**
  - `AGENTS.md`: spending needs Sanjay's explicit yes.
  - The HF account's MCP tool settings.
  - Codex `disabled_tools`.
  - The Gemini `excludeTools` list.

## Research material on the Hub

For comparables and provenance work through the vendored `huggingface-datasets` skill (all CC0; figures as of 2026-09-24, from `research_notes/Hugging Face integration/opportunities.md` §4):

| Dataset | What it is | How to use it |
| --- | --- | --- |
| `metmuseum/openaccess` | The Met's official Open Access set: 259.9K objects, 58 columns, images embedded (393.5 GB) | Dataset Viewer API only (`/rows`, `/search`, `/filter`); the Viewer timed out twice on it today, so the Met's own API stays primary |
| `metmuseum/openaccess-embeddings-siglip2` | One 1,152-d L2-normalised SigLIP2 vector per Met object (`objectID` joins the set above), 1.1 GB | Visual nearest-neighbour search against the Met; the proposal for a local comparables index is in the note |
| `nyuuzyou/ClevelandMuseumArt` | Cleveland Museum of Art open access, 67.9K rows, one 39.9 MB parquet | Download once; trivially queryable |
| `BDRC/tibetan-ocr-benchmark` | 472 hand-transcribed Tibetan pages with script and legibility metadata; companion to the `BDRC/tibetan-ocr` model and leaderboard | Ground truth if inscription OCR is ever evaluated |

Caveats: `datasets-server.huggingface.co` is unreachable from this repo's cloud sessions, so the skill only works from a gallery machine; the Rubin / Himalayan Art Resources, LACMA and Asian Art Museum collections are not on the Hub. The note's §7 lists twelve papers worth reading with the `huggingface-papers` skill — on cross-cultural metadata inference by VLMs (Appear2Meaning, 2604.07338), retrieval-augmented artwork cataloguing (ArtSeek, 2507.21917), VLMs' weakness at attribution (2508.01408), and Tibetan and Sanskrit OCR (OmniOCR 2602.21042, FTibSuite 2605.26601, 2211.07980).

## What else Hugging Face offers, and what was decided

`research_notes/Hugging Face integration/opportunities.md` assesses every other Hugging Face surface for the gallery, with sources. In short:

- **Skipped:** in-browser OCR of inscriptions (no Transformers.js model reads Devanagari or Tibetan; `BDRC/tibetan-ocr` needs a GPU server), the translation task (nothing usable is live), text-to-image, Hub storage for gallery assets (the no-upload rule), a private Gradio cataloguing Space (duplicates the storefront without its review gate), and uploading agent traces (forbidden in `AGENTS.md`).
- **Proposed, needing Sanjay's decision:** in-browser background removal for catalogue photographs with Transformers.js (`onnx-community/BiRefNet_lite-ONNX`; the photograph never leaves the browser, but webpack 4 cannot bundle the library, so it would be CDN-loaded at runtime and never enter the Arweave bundle); the single `hf-applications/background-removal` Space as an MCP tool, on already-public images only; a local vision model on the LAN through llama.cpp (`Qwen/Qwen3-VL-8B-Instruct-GGUF`, ~5.8 GB) as a private first pass — far weaker than the 235B default and untested on Tibetan or Ranjana; a dedicated Inference Endpoint (≈ $0.50–1.80 an hour) only if photographs must avoid third-party providers; a local Met comparables index built from the SigLIP2 embeddings above.

## Not integrated, and why

- **The `hf-cloud-*` skills and `hf-cli`:** see [Deliberately not vendored](#deliberately-not-vendored).
- **HF's Claude Code plugin.**
  - HF's marketplace exposes one plugin, `hf-cli`, which duplicates the installer's skill. Plugin skills are namespaced, so both copies would load (<https://code.claude.com/docs/en/skills>, "Resolve skills that share a name").
  - HF's docs give `/plugin install hf-cli@huggingface/skills`, which fails in Claude Code 2.1.282 ("Plugin "hf-cli" not found in marketplace "huggingface/skills""). The working name is `hf-cli@huggingface-skills`.
- **The HF MCP server in `.mcp.json`:** see [Claude Code: deliberately not in `.mcp.json`](#claude-code-deliberately-not-in-mcpjson).
- **HF's marketplace in `.claude/settings.json`.** Declaring it (`extraKnownMarketplaces`) would only invite installing the `hf-cli` plugin, which duplicates the installer's skill, so the file carries the permission rules above and no marketplace.
- **HF's Gemini extension** and **a project `.gemini/settings.json`.** Gemini is set up per user, as above.
- **The Trimurti gateway** (`kapoorgalleries/sb1-vuxiwzek`) was not touched.
