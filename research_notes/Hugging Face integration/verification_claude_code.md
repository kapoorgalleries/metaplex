# Verification of `claude_code.md` (adversarial fact-check)

Checked 2026-09-25 against the live Claude Code docs at code.claude.com (fetched with curl as `.md`), the Claude Code changelog (raw.githubusercontent.com, latest entry `## 2.1.282`), the Hugging Face skills marketplace file (raw.githubusercontent.com), and current Hugging Face Hub docs (via the Hugging Face MCP connector, `hf://docs/hub/agents-mcp.md`). Line numbers below refer to the `.md` files as served on the check date.

Verdict in one line: the note's schemas (`.mcp.json`, `extraKnownMarketplaces`, `enabledPlugins`), the marketplace/plugin names, the `-p`/cloud no-prompt behaviour, the covered-credential rule and the cloud network model are correct. Its Section 2 ("Unverified") is wrong on every point it hedged: connector loading, same-URL deduplication and a disable setting are all documented. Its HF MCP URL is wrong (host does not resolve). Its unset-`${VAR}` behaviour, `hasTrustDialogAccepted` guidance, "symlinks not documented" and "no documented limits" claims are also contradicted by the docs.

Sources used:

- MCP: https://code.claude.com/docs/en/mcp.md
- Settings reference: https://code.claude.com/docs/en/settings-reference.md
- Settings precedence / cloud: https://code.claude.com/docs/en/settings.md
- Permissions / workspace trust: https://code.claude.com/docs/en/permissions.md
- Plugins overview / marketplaces / install / org / loading / marketplace-reference: https://code.claude.com/docs/en/plugins.md, /docs/en/plugin-marketplaces.md, /docs/en/plugins/install.md (same page as /docs/en/discover-plugins.md), /docs/en/plugins/org.md, /docs/en/plugins/loading.md, /docs/en/plugins/marketplace-reference.md
- Skills: https://code.claude.com/docs/en/skills.md
- Cloud: https://code.claude.com/docs/en/claude-code-on-the-web.md, https://code.claude.com/docs/en/cloud-environments.md
- Env vars: https://code.claude.com/docs/en/env-vars.md
- Changelog: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
- HF marketplace: https://raw.githubusercontent.com/huggingface/skills/main/.claude-plugin/marketplace.json, https://raw.githubusercontent.com/huggingface/skills/main/README.md
- HF MCP docs: https://huggingface.co/docs/hub/agents-mcp (read as `hf://docs/hub/agents-mcp.md`), https://huggingface.co/docs/sagemaker/examples/sagemaker-sdk-neuron-agent-inf

---

## A. Refuted claims

### R1. HF MCP endpoint is `https://mcp.huggingface.co/mcp` (Section 1, "OAuth Example") — impact: changes-code

- Claim: `"url": "https://mcp.huggingface.co/mcp"`.
- Contradiction: HF Hub docs list the server as `Hugging Face MCP Server: https://huggingface.co/mcp` (hf://docs/hub/agents-mcp.md, "Learn more" list). The HF SageMaker example hard-codes `hf_mcp_url = "https://huggingface.co/mcp"` and reads `HF_TOKEN` for auth (hf://docs/sagemaker/examples/sagemaker-sdk-neuron-agent-inf.md, section "3. Use my Agent with HF MCP server").
- Live check: a WebFetch of `https://mcp.huggingface.co/mcp` failed with `getaddrinfo ENOTFOUND mcp.huggingface.co` — the hostname does not resolve at all. (`huggingface.co` itself is egress-blocked from this container, so I could not probe the real endpoint; the docs are the source.)
- Correct fact: use `https://huggingface.co/mcp`. HF's docs also say the settings page at https://huggingface.co/settings/mcp generates the exact per-client snippet and "Use it rather than writing config by hand."

### R2. Unset `${VAR}` "may send empty or fail to load" (Section 1) — impact: changes-docs

- Claim: "If unset: `${VAR}` behavior is context-dependent (may send empty or fail to load)".
- Contradiction (mcp.md L645-647, "Unset variables without a default"): "If a referenced environment variable isn't set and has no default value, the config still loads: Claude Code reports a missing-variable warning for that server in `claude mcp list` output and uses the unexpanded `${VAR}` text as-is. Set the variable or add a `:-default` fallback so the server starts with the value you intend. In a remote server's `url` and `headers`, some credential variables read as empty instead, with no warning." Also L294 ("Missing environment variable" warning) says the same.
- Correct fact: the server always loads; an unset non-credential variable is sent literally (so `Bearer ${HF_TOKEN}` would reach the server as the literal string and produce a 401). Only the covered credential names (see C8/U2) read as empty. Practical consequence for the storefront: a bootstrap that relies on `HF_TOKEN` must ensure the variable is set; there is no "skip the server" behaviour to fall back on.

### R3. `hasTrustDialogAccepted: true` "to skip re-prompting" for `.mcp.json` servers (Section 1, "Approval Mechanism") — impact: changes-code

- Claim: "Trusted projects: set `hasTrustDialogAccepted: true` in `~/.claude.json` to skip re-prompting".
- Contradiction: the key exists but it is the *workspace-trust* flag, not the `.mcp.json` approval. permissions.md L673 (table "What runs before you trust a folder", row "Servers in `.mcp.json`, including ones the repository approves in its own settings"): "Claude Code asks you before connecting them. The repository's own approvals don't count" (parent-trusted column) / "Connected without asking, approved or not" (`claude -p` column). permissions.md L676: "set `projects["<path>"].hasTrustDialogAccepted` to `true` in `~/.claude.json`" is offered for "the rows that need this exact folder trusted" (allow rules, headersHelper, `extraKnownMarketplaces`), not as an MCP approval. mcp.md L252: "A cloned repository can't approve its own servers: `enableAllProjectMcpServers` or `enabledMcpjsonServers` committed to the project's `.claude/settings.json` is ignored in an untrusted folder, and the server stays at `⏸ Pending approval`."
- Correct fact: the per-server approval is governed by three settings keys the note never mentions (settings-reference.md L4750-4800):
  - `enableAllProjectMcpServers` (Boolean, any file): "Approve every MCP server defined in project `.mcp.json` files without a prompt. Claude Code writes this key to `.claude/settings.local.json` when you choose to approve all servers in the approval dialog."
  - `enabledMcpjsonServers` (array of names): "Approve specific servers defined in project `.mcp.json` files so Claude Code connects them without asking."
  - `disabledMcpjsonServers` (array of names): "Reject specific servers ... so Claude Code never connects them or asks you to approve them. A rejection in any settings file applies ... Rejection takes precedence over `enabledMcpjsonServers` and `enableAllProjectMcpServers`."
  Trust matters only in that committed approvals in `.claude/settings.json` are honoured after the folder is trusted (interactively, or via `hasTrustDialogAccepted`); approvals in `~/.claude/settings.json`, managed settings or `--settings` apply regardless (mcp.md L254-258). So a bootstrap that wants zero prompts on a fresh clone should commit `enabledMcpjsonServers: ["huggingface"]` in `.claude/settings.json` *and* expect the trust dialog once; `hasTrustDialogAccepted` alone does not approve the server.

### R4. "Docs do not explicitly describe how MCP connectors load into Claude Code from claude.ai accounts" (Section 2) — impact: changes-docs

- Contradiction: mcp.md has a whole section, L1100 "## Use MCP servers from claude.ai": "If you've logged into Claude Code with a claude.ai account, MCP servers you've added in claude.ai, known as connectors, are automatically available in Claude Code". L1128-1133 list when they are *not* fetched ("`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `apiKeyHelper` is active", third-party providers, `CLAUDE_CODE_OAUTH_TOKEN`, etc.). L1152 "### How connectors reach Claude Code" gives a per-surface table: terminal/IDE/SDK sessions "Claude Code fetches them from claude.ai"; cloud sessions "The cloud host passes them in"; desktop app local/SSH sessions "The desktop app delivers them in-process" as `type: "sdk"` servers.
- Correct fact: connector loading is documented in detail, including the cloud-session path.

### R5. "No documented deduplication behavior when both a synced plugin and project `.mcp.json` configure the same URL" (Section 2) — impact: changes-code

- Contradiction (mcp.md L594-606, "Scope hierarchy and precedence"): "When the same server is defined in more than one place, Claude Code connects to it once, using the definition from the highest-precedence source. The entire server entry from that source is used; fields are not merged across scopes. 1. Local scope 2. Project scope 3. User scope 4. Plugin-provided servers 5. claude.ai connectors. The three scopes match duplicates by name. Plugins and connectors match by endpoint, so one that points at the same URL or command as a server above is treated as a duplicate." And L1146: "A server you've added in Claude Code takes precedence over a claude.ai connector that points at the same URL. When this happens, `/mcp` lists the connector as hidden and shows how to remove the duplicate if you'd rather use the connector."
- Changelog corroboration: 2.1.71 "servers that duplicate a manually-configured server (same command/URL) are now skipped"; 2.1.84 "MCP servers configured both locally and via claude.ai connectors are now deduplicated — the local config wins"; 2.1.121 "Claude.ai connectors with the same upstream URL are now deduplicated"; 2.1.122 "`/mcp` now shows claude.ai connectors hidden by a manually-added server with the same URL"; 2.1.281 "Fixed the same MCP server being connected twice when a plugin or claude.ai connector and a configured server spell its URL differently (host letter case, default port, trailing slash)".
- Why this changes code: if the storefront commits a `.mcp.json` entry for `https://huggingface.co/mcp`, that entry *wins* over the user's claude.ai Hugging Face connector in terminal/IDE sessions and the connector is hidden — so the project entry must carry its own working auth (token header or OAuth), and users lose the connector's claude.ai-managed sign-in for that server. Caveat for cloud sessions (mcp.md L1164): "The session's proxy rewrites each connector's URL, so a `serverUrl` pattern written for the connector's own URL doesn't match it" — the docs don't say whether endpoint-matching dedup still fires against the rewritten URL there (see U4).

### R6. "No setting exists to disable claude.ai connectors" (Section 2) — impact: changes-docs

- Contradiction (mcp.md L1174 "### Disable claude.ai connectors"; settings-reference.md L4731): `disableClaudeAiConnectors` — "Turn off the claude.ai MCP connectors Claude Code fetches itself, so it neither fetches nor connects them. A `true` in any settings file applies: a checked-in project `.claude/settings.json` can opt a repository out of those connectors, but a project-level `false` can't override a user- or managed-level `true`." Also: `ENABLE_CLAUDEAI_MCP_SERVERS=false` (env-vars.md L441; added in changelog 2.1.63); `deniedMcpServers` with `serverName` such as `"claude.ai Slack"` or a `serverUrl` pattern (settings-reference.md L4713-4718); and the per-project `/mcp` toggle, which writes the connector's display name to `disabledMcpServers` in `~/.claude.json` (mcp.md L314).
- Scope caveat the note would need: mcp.md L1176 "Claude Code applies `disableClaudeAiConnectors` only to the connectors it fetches itself, not to the connectors a cloud host or the desktop app delivers." In cloud sessions, `allowedMcpServers`/`deniedMcpServers` that reach the session still filter delivered connectors (L1164).

### R7. "Symlink support is NOT documented" for project skills (Section 4) — impact: changes-docs

- Contradiction (skills.md L129, under "Skill folders also follow these rules"): "**Symlinked folders**: a `<skill-name>` entry in the enterprise, personal, or project location can be a symlink to a directory elsewhere on disk. Claude Code reads `SKILL.md` from the target and loads the skill once even if several locations point at the same target. Plugin skills handle symlinks differently."
- Correct fact: `.claude/skills/NAME -> ../../.agents/skills/NAME` is a documented, supported layout for a project skill. The docs do not distinguish relative from absolute targets. Caveats: (a) plugin skills are the exception (plugins/host-marketplace "Share files within a marketplace with symlinks"); (b) cloud sessions load "Your repo's `.claude/skills/`" from the clone (cloud-environments.md L264), and git preserves symlinks, so the layout should carry over, but the docs don't state that explicitly (see U5).

### R8. "No documented limits on file size or nesting" for skills (Section 4) — impact: changes-docs

- Contradiction (skills.md): L338 `description` — "the combined `description` and `when_to_use` text is truncated at 1,536 characters in the skill listing to reduce context usage"; L339 `when_to_use` "counts toward the 1,536-character cap"; L1083 "Claude Code shortens descriptions to fit the listing's character budget ... The budget scales at 1% of the model's context window"; L1089 "each entry's combined text is capped at 1,536 characters regardless of budget. The cap is configurable with `skillListingMaxDescChars`"; L356 `compatibility` "Accepts a string of up to 500 characters".
- On nesting: nested skills in `<subdir>/.claude/skills/` are documented and supported (L122, L138-147), so "nesting" is not a limit, but it is documented behaviour the note said was absent.
- Correct fact: no cap on `SKILL.md` body size is documented, but front-matter `description` (+`when_to_use`) is capped at 1,536 chars in the listing and the whole listing has a 1%-of-context budget. The HF `hf-cli` SKILL.md description is very long (several hundred words); it will be truncated in the listing.

### R9. Citation error: the `.mcp.json`-in-cloud quote is attributed to `claude-code-on-the-web.md` "line 262" (Section 5) — impact: cosmetic

- The quoted table row "Your repo's `.mcp.json` MCP servers | Yes, in a session with one repository" is at cloud-environments.md L262, not in claude-code-on-the-web.md (which contains no `.mcp.json` text at all). The fact itself is correct (see C20).

---

## B. Confirmed (with exact source)

- C1 `.mcp.json` shape `{"mcpServers": {"<name>": {"type": "http", "url": "..."}}}` — mcp.md L562-573.
- C2 `headers` block with `"Authorization": "Bearer ${VAR}"` — mcp.md L631-643 (example uses `${API_KEY}`).
- C3 Syntax `${VAR}` and `${VAR:-default}` — mcp.md L616-617.
- C4 Expansion locations `command`, `args`, `env`, `url`, `headers` — mcp.md L621-627.
- C5 `${VAR:-default}` uses the default when unset — mcp.md L617.
- C6 Interactive sessions prompt for `.mcp.json` servers — mcp.md L575: "Claude Code prompts for approval in interactive sessions before using project-scoped servers from `.mcp.json` files. To reset those approval choices, run `claude mcp reset-project-choices`."
- C7 `-p`, Agent SDK and cloud sessions load without prompting — mcp.md L577: "In `claude -p` runs, Agent SDK sessions, and cloud sessions, Claude Code can't show that prompt: it loads project-scoped servers without asking." (Escape hatches: `disabledMcpjsonServers`, `--setting-sources`, `--strict-mcp-config`, L579-581.)
- C8 Covered credentials read as empty in a remote server's `url`/`headers` — mcp.md L649-661: "If you write `Bearer ${ANTHROPIC_AUTH_TOKEN}`, the server receives `Bearer ` with no credential ... A covered name reads as empty whether or not you have set the variable, and a `:-default` fallback on it is ignored ... A name outside this set, such as `API_KEY`, expands as written. To give the server one of the covered credentials, copy it into a variable with a name of your own and reference that name instead." Named examples: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `HTTPS_PROXY`, `NPM_TOKEN` — the list is introduced with "such as", so it is open-ended (see U2 about `HF_TOKEN`).
- C9 `extraKnownMarketplaces` schema: map of name -> `{ "source": {...}, "autoUpdate"?: boolean }` — settings-reference.md L4518-4549; `source.source` may be `github` (with `repo`), `git` (with `url`), `url`, `file`, `directory` (L4553-4561). `autoUpdate` defaults to `false` for third-party marketplaces (L4549).
- C10 `enabledPlugins` map `"plugin-name@marketplace-name": true|false` — settings-reference.md L4487-4505; project settings beat user settings, opt out locally in `.claude/settings.local.json` (L4514).
- C11 Marketplace name is `huggingface-skills` — marketplace.json `"name": "huggingface-skills"`, `"metadata": {"version": "1.0.31"}`.
- C12 Only one plugin, `hf-cli`, `"source": "./skills/hf-cli"`, `"skills": "./"` — marketplace.json `plugins` array (one entry). README L158: "The `.claude-plugin/marketplace.json` ... files intentionally expose only `hf-cli`". Description text in the note matches `metadata.description`.
- C13 Install id `hf-cli@huggingface-skills` is the form the Claude Code docs prescribe ("The install id is the entry's `name`, an `@`, and the marketplace `name`", plugin-marketplaces.md L89; marketplace-reference.md L58 "Users type it after `@`"). Note the HF README writes `/plugin install hf-cli@huggingface/skills` (repo slug), which does not match the Claude Code docs' rule; the note's spelling is the one consistent with Claude Code.
- C14 A relative-path plugin does load from a repo-declared marketplace, after trust — plugins/org.md L91: "A plugin that the marketplace lists by a relative path loads from the marketplace copy once the repository's `extraKnownMarketplaces` entries apply." Trust gate: L86-89 ("in an untrusted folder Claude Code ignores them without a message"; `-p` runs need prior interactive trust or `hasTrustDialogAccepted`).
- C15 Cloud sessions do not install repo-declared plugins/marketplaces — cloud-environments.md L265: "A cloud session doesn't install the plugins a repository turns on under `enabledPlugins`, including ones from the marketplaces it lists under `extraKnownMarketplaces`"; plugins/loading.md L71: "because that requires the workspace trust dialog, which a cloud session never shows"; settings.md L752.
- C16 Skills load from `.claude/skills/` in the start directory and every parent up to the repo root — skills.md L138.
- C17 Frontmatter fields `name` ("Display name shown in skill listings. Defaults to the directory name"), `description`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `context: fork`, `argument-hint`, `arguments` — skills.md L337-349. (Also available, not in the note: `when_to_use`, `model`, `effort`, `agent`, `hooks`, `paths`, `shell`, `metadata`, `license`, `compatibility`.)
- C18 Connector traffic bypasses the cloud network allowlist — cloud-environments.md L185: "MCP connectors you enable on a session or routine work without adding their hosts to **Allowed domains**, because connector traffic travels through Anthropic's servers rather than the session's network." L199-204 list what bypasses the allowlist (GitHub proxy, connectors, API-credential hosts, Anthropic API); `.mcp.json` servers are not on that list, so they go through the session network.
- C19 Network levels are per environment: None / Trusted / Full / Custom — cloud-environments.md L188-197; Custom "Allowed domains" L206-216.
- C20 Repo `.mcp.json` servers load in cloud sessions with one repository — cloud-environments.md L262 and L270.
- C21 No `skipInCloudSessions` / `requireNetworkAccess` or similar per-server key exists — grep across mcp.md, settings-reference.md, cloud-environments.md, claude-code-on-the-web.md returns nothing. Documented alternatives: `disabledMcpjsonServers` (any settings file, "blocks it in every permission mode", mcp.md L579); and a remote entry with an empty `url` "shows as `not configured` ... and Claude Code doesn't attempt to connect to it" (mcp.md L285), which combined with `${VAR:-}` expansion is a documented building block for env-gated loading (the combination itself is my inference, not a documented recipe).
- C22 Failure behaviour when a host is unreachable — mcp.md L372: for a transient error "Claude Code retries up to three times. If the connection still fails, Claude Code marks the server as failed ... That includes a server Claude Code adds to a cloud session from its configuration"; L387: with tool search on, Claude is told which server failed and why. Other servers keep working.
- C23 Cloud sessions load claude.ai-enabled *skills* and the repo's `.claude/skills/` — cloud-environments.md L264, L268; skills.md L176.

---

## C. Still unverified (no source reached or docs silent)

- U1 Whether `https://huggingface.co/mcp` supports OAuth discovery for a headerless `.mcp.json` entry (the note's "OAuth Example"). HF docs only say a READ token is needed and to copy the generated snippet from https://huggingface.co/settings/mcp; the SageMaker example uses a bearer `HF_TOKEN`. `huggingface.co` is egress-blocked from this container, so I could not probe the endpoint's `WWW-Authenticate` behaviour.
- U2 Whether `HF_TOKEN` is on Claude Code's covered-credential list (read as empty in remote `url`/`headers`). The docs' list is non-exhaustive ("Other credentials your environment carries, such as `HTTPS_PROXY` and `NPM_TOKEN`"); no changelog entry enumerates the set. If it is covered, `Bearer ${HF_TOKEN}` can never work and the documented workaround (copy into a differently named variable, e.g. `KG_HF_MCP_TOKEN`) is required. Test with `claude --debug-file /tmp/claude-debug.log` and search for `never expanded toward a remote server` (mcp.md L663).
- U3 Whether claude.ai *plugins* (as opposed to skills) load in cloud sessions. plugins/loading.md L95-98 says "Synced plugins load in Cowork sessions and in terminal sessions where you sign in with your claude.ai account" and lists only those two; cloud sessions are not named. The note's "enable plugins on their claude.ai account instead to load them as synced plugins in cloud sessions" is therefore unsupported by the docs, though not explicitly contradicted. Skills enabled on claude.ai do load in cloud sessions (C23).
- U4 Whether endpoint-based dedup between a repo `.mcp.json` entry and a cloud-delivered connector fires in cloud sessions, given "The session's proxy rewrites each connector's URL" (mcp.md L1164). Docs don't say; both could load, or the project entry could shadow the connector.
- U5 Whether a symlinked `.claude/skills/NAME` survives into a cloud session's clone. Git preserves symlinks and the cloud VM is Ubuntu, so it should, but the docs only state that `.claude/skills/` is "Part of the clone".
- U6 The `ERR_PROXY_TUNNEL` error string for blocked hosts in cloud sessions. Not in any doc I fetched; it is, however, exactly what this session reported for the Supabase server (`supabase (ERR_PROXY_TUNNEL): "Error dialing https://mcp.supabase.com/mcp..."`), so the note's example is empirically right even though undocumented.
- U7 The note's Section 2 statement that `.mcp.json` servers "must comply with network access policy" is consistent with the allowlist text (C18) but the docs never state it in those words.

---

## D. Terminology / cosmetic notes

- The note calls claude.ai connectors "synced". The docs reserve "synced" for plugins and skills (`<name>@synced`, `~/.claude/skills/synced/`); connectors are "fetched" (terminal), "passed in"/"delivered" (cloud, desktop).
- Section 2's "Recommendation: Verify with Anthropic support" is moot; every question it raises is answered in mcp.md L594-606 and L1100-1192.
- Interactive approval happens at startup/first load, not literally "on first use" of a tool.
