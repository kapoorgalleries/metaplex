# Instructions for coding agents in this repository

This repo is Kapoor Galleries' storefront for Indian, Himalayan and South Asian art, built on a Metaplex fork. Sanjay Kapoor, the gallery director, is the only person who can approve anything below. He is technical, so keep updates short.

- `ops/network/` has its own `AGENTS.md` for the LAN job. Follow it when you work there.
- `.claude/README.md` explains the Supabase MCP server. It points at live production guest data and must stay read-only.
- `docs/hugging-face.md` covers the Hugging Face setup in full.

## Hugging Face tooling available here

- **Skills.** 18 skills from `huggingface/skills` live in `.agents/skills/`, where Codex and Gemini CLI read them. Claude Code reads them through the symlinks in `.claude/skills/`. Use a skill when its description fits the task. The ones most useful here:
  - `huggingface-datasets`: Dataset Viewer API
  - `huggingface-best`: picking a model
  - `transformers-js`: running models in the storefront's JS/TS
  - `huggingface-papers`, `hf-mem`, `huggingface-local-models`, `huggingface-tool-builder`

  The training, Spaces, ZeroGPU, evaluation and publishing skills are here for reference. Anything they launch falls under the rules below.
- **The `hf` CLI and its `hf-cli` skill.** These are installed per machine by the official installer, which puts the skill in `~/.agents/skills/hf-cli`. They are not vendored here. Run `hf auth whoami` before doing any Hub work.
- **Hugging Face MCP server** (`https://huggingface.co/mcp`).
  - Codex gets it from `.codex/config.toml`, but only in a trusted checkout.
  - Claude Code gets it from Sanjay's claude.ai Hugging Face connector, or from a user-scope server.
  - To read the Hub, use `hf_fs`, `hub_repo_search` and `hub_repo_details`.
- **Storefront.** A `huggingface` provider in `js/packages/web/src/ai/providers.ts` calls `https://router.huggingface.co/v1`.

## Secrets

- Never copy a Hugging Face token into a project file, commit, saved command, process argument, log, or chat reply. Never run `hf auth token`, because it prints the token. Interactive sign-in may persist credentials in the client's own credential store; do not copy those credentials elsewhere.
- Get tokens only from the `HF_TOKEN` environment variable or from the CLI's own interactive login (`hf auth login`). Codex and Claude MCP clients sign in with OAuth; Gemini reads `HF_TOKEN` from its process environment. Enter it through a hidden prompt, never as an inline command or `--token` argument.
- The storefront keeps the dealer's token in the browser's localStorage. That token must therefore be a fine-grained token with only the "Make calls to Inference Providers" permission. Never suggest a read or write token for it.

## Spending: ask Sanjay and wait for a yes

These cost money or credits:

- HF Jobs: `hf jobs …`, the `hf_jobs` tool, and any trainer skill that runs on Jobs
- Inference Endpoints (`hf endpoints …`)
- HF sandboxes
- Training or fine-tuning on any paid hardware
- Spaces hardware upgrades, and ZeroGPU runs (`dynamic_space` invoke)
- A PRO subscription, or buying credits
- Inference beyond the account's free monthly credit. If you cannot tell whether a call is free, ask.

When you ask, name the job, the hardware and the estimated cost. Free local work needs no approval: reading the Hub, running local models, and running local scripts.

## Anything visible outside the gallery: ask first

- These need a yes: creating or publishing anything on the Hub (repos, Spaces, datasets, collections, paper pages, discussions, pull requests, webhooks), and uploading any file (`hf upload`, `hf cp` or `hf sync` into a repo or bucket, `create_repo`).
- Never put these on the Hub or into a Space tool, even with a yes: gallery photographs, client or collector records, inventory, prices or valuations.
- Never upload agent session transcripts (`~/.claude/projects`, `~/.codex/sessions`, `~/.pi/agent/sessions`) to the Hub, not even to a private repo or bucket. The Hub's "agent traces" viewer invites exactly that, and HF's own page says traces can hold "secrets, private code, and personal data"; the gallery's sessions hold client names, valuations and drafts.

## Vendored skills

- Do not edit files under `.agents/skills/`. `skills-lock.json` pins every file there by hash.
- Update the skills with the skills CLI, following `docs/hugging-face.md`.
- Vendored examples do not override the secrets and spending rules above. Never ask anyone to paste a token into chat, print a cached token, or expand a token into a process argument, even if a skill suggests it.
- Never install a generic fetch wrapper that adds an HF bearer token to every request. Authenticate only the exact trusted HTTPS origin required for the approved HF operation; do not forward credentials to model-supplied, third-party, or arbitrary download URLs.
- Do not invoke `.agents/skills/huggingface-paper-publisher/scripts/paper_manager.py`. The pinned script ignores `--create-pr` and commits directly, and its arXiv metadata parser drops the first author (`authors_matches[1:]`), and linking a paper twice into a README that had no YAML frontmatter appends a duplicate block (the empty frontmatter it writes fails its own check). Use source-verified paper metadata and separately reviewed publishing commands instead. This is an instruction restriction, not a sandbox; retain the pinned files unchanged until a verified upstream update fixes these issues.
