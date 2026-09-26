# Hugging Face agent tooling in Claude Code, Codex and Gemini CLI, at project and user level (as of 2026-09-24)

> Historical research, not setup instructions. Read this alongside `verification_agent_tooling.md`; the implemented configuration and current restrictions are in `docs/hugging-face.md` at the repository root. Recommendations below may have been superseded.

Scope note on sources. The relayed request reads "for both claude and cable". This note reads "cable" as OpenAI Codex, the tool the task names.

- **Run in the sandbox.** Each tool was installed in a scratch directory. `HOME`, `CODEX_HOME` and `CLAUDE_CONFIG_DIR` pointed at scratch folders, so no real configuration on this machine changed. Versions:
  - Claude Code 2.1.282, the sandbox's own binary.
  - Codex CLI 0.156.1, the npm `latest` dist-tag.
  - Gemini CLI 0.61.0, from npm.
  - `huggingface_hub` / `hf` 2.0.0, uploaded to PyPI on 2026-09-24T12:01:21Z.
  - The `skills` CLI 1.7.0, from npm.
  - `@llmindset/hf-mcp-server` 0.4.23 and `@llmindset/hf-mcp` 0.4.23, from npm. These are the published build of `huggingface/hf-mcp-server`, and the server was read as source code only.
- **Read directly:**
  - Hugging Face docs through the HF MCP connector (`hf://docs/hub/…` and `hf://docs/huggingface_hub/v2.0.0/…`).
  - The HF bucket `hf://buckets/huggingface/skills`.
  - Files from raw.githubusercontent.com in `huggingface/skills`, `huggingface/hf-mcp-server`, `huggingface/huggingface_hub`, `openai/codex`, `google-gemini/gemini-cli` and `Homebrew/homebrew-core`.
  - GitHub directory listings and the commit Atom feed, through server-side WebFetch.
  - code.claude.com docs, fetched as `.md`.
- **Blocked:**
  - developers.openai.com, from both the shell and WebFetch (`EGRESS_BLOCKED`). Only search-result snippets were available, and they are marked "snippet".
  - huggingface.co and hf.co, from both the shell and WebFetch. The hosted MCP endpoint was never called and `huggingface.co/settings/mcp` was never seen. `hf.co/cli/install.sh` was read from its source in the huggingface_hub repo instead.
  - github.com, from the shell. No real `git clone` of a marketplace was possible, so marketplaces were tested from a local mirror of `huggingface/skills`. That mirror was assembled from raw.githubusercontent.com, and all 158 skill files matched the bucket's SHA-256 digests.
- **Nothing spent:** no inference, Job, Space invocation or Hub or GitHub write, and no token was created or stored.

Kit files examined:
- `/home/user/metaplex/.claude/README.md`
- `/home/user/metaplex/.mcp.json`
- `/home/user/metaplex/skills-lock.json`
- `/home/user/metaplex/.agents/skills/` (two real directories, `supabase` and `supabase-postgres-best-practices`)
- `/home/user/metaplex/.claude/skills/` (relative symlinks `../../.agents/skills/<name>`)
- `/home/user/metaplex/ops/network/scripts/bootstrap-ai-clis.sh` and `.ps1`

Confidence tags used below:
- **[confirmed]**: read in current source or docs, or observed by running the tool.
- **[strong evidence]**: follows directly from confirmed material but was not run end to end.
- **[unverified]**: could not be checked.

---

## Key question 1: Hugging Face MCP server (URL, `?login`, bearer auth, default tools, Spaces, URL options)

### Answer

- **Endpoint** **[confirmed]**
  - The server is at `https://huggingface.co/mcp`. It speaks Streamable HTTP in stateless JSON mode ("StreamableHTTP in Stateless JSON Mode (**StreamableHTTPJson**)").
  - A public server card is at `/mcp/server-card`.
- **What `?login` does** **[confirmed in source 0.4.23]**
  - `dist/server/utils/query-params.js` sets the header `x-mcp-force-auth: true` whenever the URL carries `login`, `auth` or `forceauth`: `if (forceauth || login !== undefined || auth !== undefined) { headers['x-mcp-force-auth'] = 'true'; }`.
  - When no token is present, `base-transport.js` then refuses the request (`const shouldContinue = !headers['x-mcp-force-auth'];`). The transport answers `401` with `WWW-Authenticate: Bearer resource_metadata="https://huggingface.co/.well-known/oauth-protected-resource/mcp?login"`.
  - The client follows that header to huggingface.co's authorization-server metadata. That server "advertises both a dynamic registration endpoint and `"client_id_metadata_document_supported": true`", so the client registers itself (DCR or CIMD) and runs a browser OAuth flow at huggingface.co.
  - Without `?login` and without a token, the request continues anonymously with the anonymous tool set.
  - **[strong evidence]** The hosted deployment runs this same code. The npm package is the published build of the repo, but the hosted version number was not visible.
  - **[unverified]** Which OAuth scopes each client requests. The OAuth diagnostic in the repo "deliberately narrows HF's advertised scope set to `read-mcp`; it does not request identity, job, repository-write, or inference scopes". That implies the advertised scope set includes job, repo-write and inference scopes. Codex can narrow its request with `codex mcp login <name> --scopes …` (the flag is **[confirmed]**). Whether HF's tools work with `read-mcp` alone is **[unverified]**.
- **Bearer-token alternative** **[confirmed]**
  - The server accepts `Authorization: Bearer <HF token>`.
  - README, Claude Code: `claude mcp add hf-mcp-server -t http https://huggingface.co/mcp -H "Authorization: Bearer <YOUR_HF_TOKEN>"`.
  - README, VS Code and Cursor: `"huggingface": { "url": "https://huggingface.co/mcp", "headers": { "Authorization": "Bearer <YOUR_HF_TOKEN>" } }`.
  - The server parses the header with `/^Bearer\s+(\S+)\s*$/i` and validates the token with `whoami`:
    - An invalid token gets `401`.
    - If `whoami` itself is unavailable, the request fails open unless `MCP_STRICT_TOKEN=true`.
    - An empty `Bearer ` header does not match the regex, so it is treated as no token and the request runs anonymously.
  - HF docs: "You need a valid Hugging Face token with READ permissions to use MCP tools."
  - Token roles are `read` ("can only be used to provide read access to repositories you could read"), `write` and `fine-grained`.
- **Default tools**
  - **Anonymous** (no token) **[confirmed]**: `hub_repo_search`, `hub_repo_details` and `hf_fs` (`ANONYMOUS_BUILTIN_TOOL_IDS` in `shared/settings.js`).
  - **Authenticated** **[confirmed in code]**:
    - The server fetches the user's selection from HF's user-config API, which is what the user picks at `huggingface.co/settings/mcp`. On any error it falls back to the anonymous set.
    - Built-in tool IDs are `hub_repo_search`, `create_repo`, `hub_repo_details`, `hf_fs`, `hf_jobs` and `dynamic_space`.
    - The sandbox group is `hf_sandbox`, `hf_sandbox_exec` and `hf_sandbox_fs`, enabled together.
    - `hf_fs` is always added as a dependency.
    - `hf_whoami` is a fixed tool, "Read-only and never returns credential values".
    - A self-hosted server in "static" mode defaults to all six built-in tools plus the Space `mcp-tools/Z-Image-Turbo`.
  - The HF docs say "Most Hub tasks can be efficiently completed with the built in `hf_fs` tool". They list the optional extras as "Contribute Repos", "Sandboxes" and "Run and Manage Jobs", all switched on from the settings page. The account defaults as that page shows them are **[unverified]**, because the page was blocked.
  - **[confirmed as observed]** For HF account `Sanjaykapoor`, the claude.ai "Hugging Face" connector in this session exposes `hf_fs`, `hf_whoami`, `hub_repo_details`, `hub_repo_search` and `dynamic_space`, with no `hf_jobs` and no `create_repo`. That a CLI client would see the same set is **[strong evidence]**, since both read the same per-account settings.
- **Gradio Space tools** **[confirmed]**
  - HF docs: "Browse compatible Spaces… look for the grey **MCP** badge… Click the badge and choose **Add to MCP tools**… The Space should be listed in your MCP Server settings in the Spaces Tools section." Restart or refresh the client afterwards.
  - The settings page also has "**Dynamic Spaces**", which lets the assistant "discover and use MCP-compatible Spaces on-the-fly without adding them manually", and "**Remove Embedded Images**".
  - URL overrides:
    - `?gradio=<space ids>` adds Spaces for that connection.
    - `?gradio=none` disables Space tools and the `dynamic_space` `invoke` operation ("The invoke operation is disabled because gradio=none is set").
    - `?no_image_content=true` strips image content blocks from Gradio results.
  - Cost:
    - "For ZeroGPU Spaces, your quota will be used when the tool is called."
    - The HF `huggingface-zerogpu` skill adds: "For Pro / Team / Enterprise, pay-as-you-go credits cover the overflow". So `dynamic_space` invoke **can spend credits** on a paid account.
- **Tool-selection and read-only URL options** **[confirmed]**
  - `bouquet=<name>` replaces the tool set. Presets in `shared/bouquet-presets.js`:
    - `hf_api`, `spaces`, `search`, `docs`, `files`, `skills`, `research`, `intern`
    - `openai` ("expose Hub filesystem, repository search, details and creation, dynamic Space, Jobs, and sandbox tools")
    - `all`, `hub_repo_details`, `no_gradio_images`, `jobs`, `sandbox`, `write`, `dynamic_space`, `proxy`
  - `mix=<name[,name]>` adds presets on top of the user's settings.
  - `bouquet=docs` or `bouquet=files` gives `hf_fs` only. `bouquet=search` gives `hub_repo_search` plus the `hf_fs` dependency.
  - A preset other than `all` also drops Space tools unless `gradio=` is given.
  - There is **no read-only switch**. A grep of the built server found none.
  - Tool selection is **advertisement only**. The README says these settings "control which deployed tools are advertised, not whether a direct `tools/call` to a known tool may execute". `utils/direct-tool-settings.js` deletes `x-mcp-bouquet` and `x-mcp-mix` for `tools/call` and builds settings for the named built-in tool.
  - "Read-only" therefore has to be enforced in two places:
    1. The token's own permissions. A read-role token cannot create repos. Jobs "are available to any user or organization with a positive credit balance" and need job permission.
    2. A deny list in each client: Claude Code `permissions.deny`, Codex `disabled_tools`, Gemini `excludeTools`.
- **Skills over MCP.** When a skills snapshot is mounted, the server also implements `skills/list`, `skills/get` and `resources/read` (SEP-2640) and advertises `io.modelcontextprotocol/skills`. Whether the hosted server advertises this today, and whether any of the three CLIs consumes it, is **[unverified]**.

### Sources
- hf://docs/hub/agents-mcp.md → https://huggingface.co/docs/hub/agents-mcp
- hf://docs/hub/agents-overview.md → https://huggingface.co/docs/hub/agents-overview (Claude Code command `claude mcp add hf-mcp-server -t http "https://huggingface.co/mcp?login"`)
- hf://docs/hub/spaces-mcp-servers.md → https://huggingface.co/docs/hub/spaces-mcp-servers
- hf://docs/hub/security-tokens.md → https://huggingface.co/docs/hub/security-tokens
- hf://docs/hub/jobs-pricing.md → https://huggingface.co/docs/hub/jobs-pricing
- https://raw.githubusercontent.com/huggingface/hf-mcp-server/main/README.md
- https://raw.githubusercontent.com/huggingface/hf-mcp-server/main/docs/oauth-diagnostics.md
- npm `@llmindset/hf-mcp-server@0.4.23` (https://registry.npmjs.org/@llmindset/hf-mcp-server), files `dist/server/utils/query-params.js`, `dist/server/transport/base-transport.js`, `dist/server/transport/stateless-http-transport.js`, `dist/server/utils/tool-selection-strategy.js`, `dist/server/utils/direct-tool-settings.js`, `dist/server/utils/mcp-api-client.js`, `dist/shared/settings.js`, `dist/shared/bouquet-presets.js`, `dist/server/mcp-proxy.js`
- npm `@llmindset/hf-mcp@0.4.23`, `dist/tool-ids.js`, `dist/jobs/jobs-tool.js` (`name: 'hf_jobs'`), `dist/space/dynamic-space-tool.js` (`name: 'dynamic_space'`)
- `hf://buckets/huggingface/skills/distribution/latest/skills.json`, `huggingface-zerogpu/references/how-quota-works.md`

---

## Key question 2: Codex CLI (MCP config, `codex mcp add` / `login`, project config and trust, skills, plugins)

### Answer

- **Version** **[confirmed]**
  - `npm view @openai/codex` shows `latest` = `0.156.1` and `alpha` = `0.157.0-alpha.11.1`.
  - The kit's earlier note (2026-09-22) recorded 0.155.1.
- **config.toml table for a streamable-HTTP server** **[confirmed in source, and observed by `codex mcp get --json`]**

  ```toml
  [mcp_servers.huggingface]
  url = "https://huggingface.co/mcp"
  bearer_token_env_var = "HF_TOKEN"          # sends Authorization: Bearer <value of $HF_TOKEN>
  # http_headers     = { "X-Example" = "static value" }
  # env_http_headers = { "X-Example" = "NAME_OF_ENV_VAR_HOLDING_THE_VALUE" }
  disabled_tools = ["hf_jobs", "create_repo", "dynamic_space", "hf_sandbox", "hf_sandbox_exec", "hf_sandbox_fs"]
  tool_timeout_sec = 120
  ```

  - Other accepted keys:
    - `enabled`, `required`, `startup_timeout_sec` / `startup_timeout_ms`, `enabled_tools`
    - `scopes`, `oauth = { client_id, client_secret, callback_url, callback_port }`, `oauth_resource`
    - `default_tools_approval_mode`, `tools.<tool>.approval_mode`, `supports_parallel_tool_calls`
    - `http_headers_helper`, a local command that prints JSON headers
  - `disabled_tools` is "Explicit deny-list of tools. These tools will be removed after applying `enabled_tools`."
  - An inline `bearer_token = "…"` is rejected. Observed: `Error: failed to load bootstrap configuration … bearer_token is not supported for streamable_http in 'mcp_servers.bad-inline'`.
  - Top-level OAuth keys:
    - `mcp_oauth_credentials_store`: "file: Use a file in the Codex home directory. auto (default): Use the OS-specific keyring service if available, otherwise use a file."
    - `mcp_oauth_callback_port`
    - `mcp_oauth_callback_url`
- **`codex mcp add`** **[confirmed]**
  - Usage line: `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)`, with `--bearer-token-env-var <ENV_VAR>` ("Only valid with streamable HTTP servers"), `--oauth-client-id`, `--oauth-client-registration <AUTO|CIMD|DCR>` and `--oauth-resource`.
  - It always writes the **global** file: "`add` — add a server launcher entry to `~/.codex/config.toml`".
  - Running `codex mcp add huggingface --url https://huggingface.co/mcp --bearer-token-env-var HF_TOKEN` printed `Added global MCP server 'huggingface'.` and wrote exactly `[mcp_servers.huggingface]` / `url = "https://huggingface.co/mcp"` / `bearer_token_env_var = "HF_TOKEN"`. `codex mcp list` showed `Auth: Bearer token`.
  - After writing, `add` probes the server for OAuth support and starts the flow itself when OAuth is detected ("Detected OAuth support. Starting OAuth flow…"). Here huggingface.co was unreachable, so `codex mcp add hf-oauth --url "https://huggingface.co/mcp?login"` printed "MCP server may or may not require login. Run `codex mcp login hf-oauth` to login."
- **`codex mcp login NAME`** **[confirmed]**
  - Flags: `--no-browser` ("Print the authorization URL and accept the callback URL without opening a browser"), `--scopes <SCOPE,SCOPE>` and `--oauth-client-registration <AUTO|CIMD|DCR>`.
  - `codex mcp logout NAME` removes the credentials.
  - An end-to-end OAuth login against HF is **[unverified]**, because the network was blocked. **[strong evidence]** that it should work: HF advertises both DCR and CIMD, and Codex implements both.
- **Project-scoped `.codex/config.toml`** **[confirmed, observed]**
  - It is loaded only for a **trusted** project.
  - Tested in a scratch git repo: a `[mcp_servers.hf-project]` in `.codex/config.toml` did not appear in `codex mcp list` until `~/.codex/config.toml` contained `[projects."<abs path>"]` / `trust_level = "trusted"`. It then appeared, and only inside that project.
  - Loader doc comment: "tree: parent directories up to root looking for `./.codex/config.toml` (loaded but disabled when untrusted)"; "repo: `$(git rev-parse --show-toplevel)/.codex/config.toml` (loaded but disabled when untrusted)".
  - Disabled-reason text: "To load project-local config, hooks, and exec policies, add <path> as a trusted project in <user config.toml>."
  - `mcp_servers` is **not** on the project denylist. `PROJECT_LOCAL_CONFIG_DENYLIST` = `openai_base_url, chatgpt_base_url, apps_mcp_product_sku, responses_api_metadata, model_provider, model_providers, notify, profile, profiles, experimental_realtime_webrtc_call_base_url, experimental_realtime_ws_base_url, otel`.
  - Search-result summary (developers.openai.com, not verbatim): "you can also scope MCP servers to a project with .codex/config.toml (trusted projects only)."
- **Skills discovery** **[confirmed, observed]**
  - Tested with `codex debug prompt-input` (renders the model-visible prompt locally, no model call). Probe skills were placed in every candidate folder. Skill-roots table for a session started in a subfolder of an untrusted repo:
    - `<repo>/.codex/skills`
    - `$CODEX_HOME/skills`, i.e. `~/.codex/skills`
    - `~/.agents/skills`
    - `$CODEX_HOME/skills/.system`, the bundled system skills
    - `<repo>/.agents/skills`
    - `<repo>/<subdir>/.agents/skills`, i.e. every `.agents/skills` from cwd up to the repo root
  - `.claude/skills` is **not** read.
  - Skill discovery did **not** require trust. The same roots appeared in an untrusted repo.
  - Search-result summary (developers.openai.com/codex/skills, not verbatim): "Codex scans .agents/skills in every directory from your current working directory up to the repository root… $REPO_ROOT/.agents/skills… skills in ~/.codex/skills are available from any repo."
  - The HF docs name `$REPO_ROOT/.agents/skills` or `$HOME/.agents/skills`, and both work.
- **SKILL.md frontmatter** **[confirmed, source `codex-rs/skills/src/parser.rs`]**
  - YAML frontmatter delimited by `---` is required ("missing YAML frontmatter delimited by ---").
  - `description` is required and must be non-empty ("missing field `description`").
  - `name` is optional. It defaults to the directory name and may be at most 64 characters (`MAX_NAME_LEN: usize = 64`).
  - `metadata.short-description` is optional.
  - Unquoted colons in values are repaired ("Some third-party skills use prose like `description: Build for AWS: ECS`").
- **Plugins and marketplaces** **[confirmed, observed with a local mirror]**
  - Help text:
    - `codex plugin marketplace add <SOURCE>`: "Marketplace source: a local path, owner/repo[@ref], HTTPS Git URL, or SSH Git URL", plus `--ref` and `--sparse`.
    - `codex plugin add`: "Install a plugin from a configured or remote marketplace".
  - Codex reads marketplace manifests from `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json` and `.cursor-plugin/marketplace.json`, and plugin manifests from `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json` **[strong evidence: strings in the 0.156.1 binary, e.g. "marketplace root does not contain a supported manifest"]**. `huggingface/skills` has only the Claude and Cursor manifests, and Codex accepted it.
  - `codex plugin marketplace add <mirror of huggingface/skills>` printed "Added marketplace `huggingface-skills` …". It wrote `[marketplaces.huggingface-skills]` / `source_type = "local"` / `source = "<path>"`.
  - `codex plugin list` showed exactly one plugin, `hf-cli@huggingface-skills`. The client marketplace intentionally lists only `hf-cli`.
  - `codex plugin add hf-cli@huggingface-skills` wrote `[plugins."hf-cli@huggingface-skills"]` / `enabled = true` and cached the plugin at `$CODEX_HOME/plugins/cache/huggingface-skills/hf-cli/local`. It added **no MCP server**: the plugin root is `skills/hf-cli`, which holds only `SKILL.md`, and `codex mcp list` stayed empty.
  - For `codex plugin marketplace add huggingface/skills` itself, the entry is `source_type = "git"` and `source = "https://github.com/huggingface/skills.git"`, with a git clone kept under `CODEX_HOME` **[strong evidence: `marketplace_edit.rs` tests use `source_type = "git"`, `source = "https://github.com/owner/repo.git"`]**. The exact clone path is **[unverified]**.
  - Can a project declare it? Partly.
    - A **trusted** project's `.codex/config.toml` with `[marketplaces.huggingface-skills]` made the marketplace appear in `codex plugin marketplace list`.
    - `[plugins."hf-cli@huggingface-skills"] enabled = true` in the project file did **not** install the plugin. `codex plugin list` still showed "not installed", so each user has to run `codex plugin add`.
    - An untrusted project showed "No plugin marketplaces in scope."
    - Codex's bundled plugin-creator skill also describes a repo marketplace at `<repo-root>/.agents/plugins/marketplace.json`, which requires plugin sources inside the repo. **[unverified]** by test.

### Sources
- https://registry.npmjs.org/@openai/codex (`npm view @openai/codex version dist-tags`)
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/config/src/mcp_types.rs
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/config/src/config_toml.rs
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/config/src/loader/mod.rs and `loader/README.md`
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/config/src/project_trust.rs, `project_root_markers.rs`, `marketplace_edit.rs`
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/mcp_cmd.rs, `mcp_login.rs`, `marketplace_cmd.rs`
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/skills/src/parser.rs
- https://raw.githubusercontent.com/openai/codex/main/docs/config.md (now only points to developers.openai.com/codex/config-basic, /config-advanced, /config-reference)
- https://github.com/openai/codex/tree/main/codex-rs (listing via WebFetch)
- Snippets only: https://developers.openai.com/codex/mcp, https://developers.openai.com/codex/config-basic, https://developers.openai.com/codex/config-reference, https://developers.openai.com/codex/skills

---

## Key question 3: Gemini CLI (`gemini mcp add`, settings.json, extension install)

### Answer

- **Version** **[confirmed]**: `@google/gemini-cli` 0.61.0.
- **`gemini mcp add` for HTTP with a header** **[confirmed, help and observed]**
  - Usage: `gemini mcp add [options] <name> <commandOrUrl> [args...]`.
  - Options:
    - `-s, --scope` (`user` | `project`, **default `project`**)
    - `-t, --transport, --type` (`stdio` | `sse` | `http`, default `stdio`)
    - `-H, --header` ("Set HTTP headers for SSE and HTTP transports (e.g. -H "X-Api-Key: abc123" -H "Authorization: Bearer abc123")")
    - `--timeout`, `--trust`, `--description`, `--include-tools`, `--exclude-tools`
  - `gemini mcp add -s project -t http huggingface https://huggingface.co/mcp -H 'Authorization: Bearer ${HF_TOKEN}'` wrote this to `.gemini/settings.json`:

    ```json
    { "mcpServers": { "huggingface": { "url": "https://huggingface.co/mcp", "type": "http", "headers": { "Authorization": "Bearer ${HF_TOKEN}" } } } }
    ```

  - With `-s user` it writes `~/.gemini/settings.json`.
  - Quirk (observed): `--exclude-tools hf_jobs,create_repo,dynamic_space` was stored as the **single** string `["hf_jobs,create_repo,dynamic_space"]`. Edit the JSON array by hand instead.
- **`httpUrl` form** **[confirmed, docs]**
  - The docs define `url` as the "SSE endpoint URL" and `httpUrl` as the "HTTP streaming endpoint URL". The CLI instead writes `url` plus `"type": "http"`.
  - HF's own `gemini-extension.json` uses the documented form: `"mcpServers": { "huggingface-skills": { "httpUrl": "https://huggingface.co/mcp?login" } }`.
- **Environment variables** **[confirmed, source]**
  - `${VAR}` and `$VAR` are expanded across the **whole** settings file when it loads (`resolveEnvVarsInObject(settingsObject)` in the settings loader), not only in `env` blocks.
  - An undefined variable "resolves to an empty string".
  - `Bearer ${HF_TOKEN}` with `HF_TOKEN` unset therefore becomes `Bearer `, which HF treats as anonymous (Q1).
- **Folder trust gate** **[confirmed, source and observed]**
  - `gemini mcp list` showed both servers as "Disabled" in an untrusted folder.
  - Source message: "MCP servers are configured but disabled because this folder is untrusted. User-level servers are also suppressed in untrusted folders to prevent accidental side-effects."
  - Workspace skills are also skipped in untrusted folders.
  - Trust is stored in `~/.gemini/trustedFolders.json`. `gemini trust` needs an auth method configured first. Observed: it printed "Please set an Auth method…".
- **OAuth with `?login`** **[confirmed, docs]**
  - Gemini does "Automatic OAuth discovery" on a 401, but "OAuth authentication requires that your local machine can: Open a web browser… Receive redirects on `http://localhost:<random-port>/oauth/callback`".
  - It "will not work in… Remote SSH sessions without X11 forwarding".
  - Tokens are "Stored securely in `~/.gemini/mcp-oauth-tokens.json`".
  - On the SSH-managed LAN machines, use the bearer header, not `?login`.
- **`gemini extensions install https://github.com/huggingface/skills.git --consent`** **[confirmed for flags; observed with a local mirror]**
  - Syntax: `gemini extensions install <source> [--ref <ref>] [--auto-update] [--pre-release] [--consent] [--skip-settings]`, where `--consent` means "Acknowledge security risks and skip the confirmation prompt".
  - "To install from GitHub, you must have `git` installed."
  - "Gemini CLI creates a copy of the extension during installation. You must run `gemini extensions update` to pull changes".
  - Installing the mirror with `--consent` gave `huggingface-skills (1.0.31)` with:
    - MCP server `huggingface-skills`, pointing at `https://huggingface.co/mcp?login`
    - context file `agentsmd/AGENTS.md`
    - **all 25 skills**, including the six SageMaker/AWS skills and the HF Jobs trainers
  - Installing from a local path also required that source folder to be trusted.
  - Where Gemini finds skills: extension skills; user `~/.gemini/skills/` or `~/.agents/skills/`; workspace `.gemini/skills/` or `.agents/skills/`. "Within the same tier… the `.agents/skills/` alias takes precedence over the `.gemini/skills/` directory."
  - Observed: in a trusted scratch copy of this repo, `gemini skills list` found `supabase` and `supabase-postgres-best-practices` from `.agents/skills`.

### Sources
- https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/tools/mcp-server.md
- https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/extensions/reference.md
- https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/skills.md
- https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/trusted-folders.md
- npm `@google/gemini-cli@0.61.0`, `bundle/gemini-NPCD6A4N.js` (`getServerStatus`, `listMcpServers`), `bundle/chunk-2YTYPKEZ.js` (`resolveEnvVarsInObject` applied to each settings file)
- https://raw.githubusercontent.com/huggingface/skills/main/gemini-extension.json
- https://raw.githubusercontent.com/huggingface/hf-mcp-server/main/README.md (Gemini: `gemini mcp add -t http huggingface https://huggingface.co/mcp?login`)

---

## Key question 4: the `hf` CLI (installers, auth, update, skills, version, env vars)

### Answer

- **Current major version** **[confirmed]**
  - `huggingface_hub` **2.0.0** is on PyPI (uploaded 2026-09-24T12:01:21Z, `requires_python >=3.10.0`).
  - The docs tree has only `hf://docs/huggingface_hub/v2.0.0/`, so there is no unversioned `guides/cli.md`.
  - Installed locally: `hf version` printed `version: 2.0.0`, and `hf --version` printed `2.0.0`.
- **Standalone installers** **[confirmed, docs and installer source]**

  | OS | Command |
  | --- | --- |
  | macOS / Linux | `curl -LsSf https://hf.co/cli/install.sh \| bash` |
  | macOS / Linux, without the skill | `curl -LsSf https://hf.co/cli/install.sh \| bash -s -- --exclude-skill` |
  | Windows | `powershell -ExecutionPolicy ByPass -c "irm https://hf.co/cli/install.ps1 \| iex"` |
  | Windows, without the skill | `powershell -ExecutionPolicy ByPass -c "& ([scriptblock]::Create((irm https://hf.co/cli/install.ps1))) -ExcludeSkill"` |

  - `install.sh` options: `--force`, `--no-modify-path`, `--with-transformers`, `--exclude-skill` and `-v, --verbose`. Environment: `HF_HOME` ("installer uses $HF_HOME/cli when set"), `HF_CLI_BIN_DIR` ("default: ~/.local/bin") and `HF_CLI_PIP_ARGS`.
  - `install.ps1` switches: `-Force`, `-Verbose`, `-NoModifyPath`, `-WithTransformers` and `-ExcludeSkill`.
  - Where it installs:
    - **Unix:** a venv at `~/.hf-cli/venv` (or `$HF_HOME/cli/venv`), with `hf` symlinked into `~/.local/bin`.
    - **Windows:** `%USERPROFILE%\.hf-cli\venv`, with `hf.exe` copied into `%USERPROFILE%\.local\bin`.
  - Installer behaviour:
    - It uses `uv pip` when `uv` is present, otherwise pip.
    - It edits shell rc files unless `--no-modify-path` / `-NoModifyPath` is given: `.bashrc`/`.bash_profile`/`.profile`, `.zshrc`/`.zprofile`, and `fish_user_paths`.
    - It does **not** install Python ("Python 3.10+ is required but was not found").
    - It installs the skill by running `hf skills add hf-cli --global --force`.
  - Docs: "The installer also installs the `hf-cli` skill globally, for Claude Code and any agent reading `~/.agents/skills`."
- **Other install routes** **[confirmed]**
  - `pip install -U "huggingface_hub"`
  - `uvx hf …`, which uses "the `hf` PyPI package"
  - `brew install hf`. The Homebrew formula `hf.rb` is still at `huggingface_hub-1.32.0`, so it lags PyPI.
- **`hf auth login`** **[confirmed, help and docs]**
  - Options: `--token TEXT`, `--add-to-git-credential / --no-add-to-git-credential` (default no), `--force / --no-force` and `--format`.
  - The default is a browser device flow: "it prints a URL and a short code. Open the URL, enter the code… The token expires after a while but is refreshed automatically as long as you keep using it." The URL is `https://huggingface.co/oauth/device`.
  - Non-interactive: `hf auth login --token $HF_TOKEN`. "`--format json` and `--format quiet` are not supported: pass `--token` for scripted, non-interactive logins."
  - Run by an agent, it "never prompts".
  - **SSH** **[strong evidence]**: the device flow only prints a URL and a code, so it works from an SSH session with the browser on any other machine. No HF doc statement about SSH was found.
  - Storage: "saved to /home/…/.cache/huggingface/stored_tokens" and "…/.cache/huggingface/token". `HF_TOKEN_PATH` defaults to `$HF_HOME/token`.
- **`hf auth whoami`** prints the username and orgs. **`hf auth logout`** "will not log you out if you are logged in using the `HF_TOKEN` environment variable".
- **`hf update`** **[confirmed]**: "detects how `hf` was installed (Homebrew, standalone installer, or pip) and runs the matching update command. If the `hf-cli` skill is installed globally, it is refreshed as well… updating never brings it back if you skipped or removed it."
- **`hf skills`** **[confirmed, 2.0.0 help and observed]**
  - Subcommands: `add`, `list` (`ls`), `preview` and `update`. `hf --skills` prints the generated SKILL.md.
  - `hf skills add [NAME] [-g|--global] [--dest PATH] [--force]`.
  - "The default `hf-cli` skill is generated locally from the installed CLI version; other skills are downloaded from the Hugging Face marketplace. Default location is in the current directory (.agents/skills) or user-level (~/.agents/skills). The skill is also symlinked into Claude Code's skills directory (`.claude/skills` or `~/.claude/skills`, honoring `CLAUDE_CONFIG_DIR` when set), unless `--dest` is used."
  - **`--claude` is gone in 2.0.0.** `hf skills add --claude` fails with `Error: No such option '--claude'.` The package reference still calls it "(Deprecated) No longer needed". hub/agents-cli.md still shows `hf skills add --claude --global`, so that page is stale.
  - Observed layout:
    - The skill is written to `.agents/skills/hf-cli/` as `SKILL.md` plus an **empty `.hf-skill-manifest.json`**.
    - `.claude/skills/hf-cli` becomes a relative symlink `../../.agents/skills/hf-cli`.
    - `-g` does the same under `~`.
    - On Windows, if symlinking fails, the skill is copied instead ("Windows needs Developer Mode or admin rights for symlinks").
  - The generated `hf-cli` SKILL.md from 2.0.0 differs from the repo copy at `80f9fa5` only by a trailing newline.
- **Environment variables** **[confirmed]**
  - `HF_TOKEN`: "If set, this value will overwrite the token stored on the machine".
  - `HF_HUB_DISABLE_UPDATE_CHECK=1`: "skip the PyPI request and silence both hints entirely". The hints are the once-a-day newer-version warning and the check for a missing or stale `hf-cli` skill.

### Sources
- hf://docs/huggingface_hub/v2.0.0/guides/cli.md → https://huggingface.co/docs/huggingface_hub/v2.0.0/guides/cli
- hf://docs/huggingface_hub/v2.0.0/package_reference/cli.md (`hf skills add`, `hf version`)
- hf://docs/huggingface_hub/v2.0.0/package_reference/environment_variables.md (`HF_TOKEN`, `HF_TOKEN_PATH`, `HF_HUB_DISABLE_UPDATE_CHECK`)
- hf://docs/hub/agents-cli.md → https://huggingface.co/docs/hub/agents-cli
- https://pypi.org/pypi/huggingface_hub/json
- https://raw.githubusercontent.com/huggingface/huggingface_hub/main/utils/installers/install.sh and `install.ps1`
- https://raw.githubusercontent.com/Homebrew/homebrew-core/master/Formula/h/hf.rb
- Local `huggingface_hub==2.0.0`: `hf --help`, `hf skills add --help`, `hf auth login --help`, `hf update --help`; source `huggingface_hub/cli/skills.py`

---

## Key question 5: the `huggingface/skills` repository (manifests, every skill and file, paid compute, relevance)

### Answer

- **Current commit of `main`** **[confirmed]**
  - `80f9fa530e46f4ae642fcb9e1725bad0e1979395`, "Sync HF CLI skill from huggingface_hub@v2.0.0 (#261)", 2026-09-24T12:02:12Z, per the commits Atom feed.
  - Raw fetches at that SHA return the same `skills/hf-cli/SKILL.md` as `main` (sha256 `6ef2841e…75abf`).
  - The HF bucket distribution `hf://buckets/huggingface/skills/distribution/latest/manifest.json` was generated 2026-09-24T12:02:25Z from `source_repo: huggingface/skills`, with `skill_count: 25`.
- **Top level** (GitHub listing): `.claude-plugin`, `.cursor-plugin`, `.github`, `agentsmd`, `apps`, `assets`, `hf-mcp`, `scripts`, `skills`, `.gitignore`, `.mcp.json`, `LICENSE`, `README.md`, `fast-agent-log.jsonl` and `gemini-extension.json`.
- **Manifests** **[confirmed, fetched]**
  - `.claude-plugin/marketplace.json`: `"name": "huggingface-skills"`, `"metadata": {"version": "1.0.31"}`, and a single plugin `{"name": "hf-cli", "source": "./skills/hf-cli", "skills": "./"}`.
  - `.cursor-plugin/marketplace.json` is identical.
  - `.claude-plugin/marketplace-internal.json` lists all 25 skills. The bucket's `marketplace.json` has the same size, 7,374 bytes, and README says "Publish automation uploads it to the Hub bucket as `marketplace.json` so `hf skills list`, `hf skills add`, and `hf skills update` continue to see every available skill."
  - `.claude-plugin/plugin.json`: `"name": "huggingface-skills"`, `"version": "1.0.31"`, `"license": "Apache-2.0"`.
  - `.cursor-plugin/plugin.json` adds `"skills": "skills"` and `"mcpServers": ".mcp.json"`.
  - `.mcp.json`: `{"mcpServers": {"huggingface-skills": {"type": "http", "url": "https://huggingface.co/mcp?login"}}}`.
  - `gemini-extension.json`: `contextFileName: "agentsmd/AGENTS.md"` and `mcpServers.huggingface-skills.httpUrl: "https://huggingface.co/mcp?login"`.
  - The fallback file is `agentsmd/AGENTS.md`, 15,261 bytes. **`agents/AGENTS.md` returns 404**, although hub/agents-skills.md still links to `agents/AGENTS.md`.
  - README: "The `.claude-plugin/marketplace.json` and `.cursor-plugin/marketplace.json` files intentionally expose only `hf-cli`… points users to `hf skills add <skill-name>` for the rest".
- **Claude Code plugin name: correction to the HF docs** **[confirmed, observed]**
  - hub/agents-overview.md, agents-cli.md, agents-skills.md and the repo README all say `/plugin install hf-cli@huggingface/skills`. In Claude Code 2.1.282 that fails: `Plugin "hf-cli" not found in marketplace "huggingface/skills"`.
  - The working form is `hf-cli@huggingface-skills`, because the marketplace is named by its `marketplace.json` `name`. That was tested with the mirror as a `directory` source.
  - The installed plugin holds only `SKILL.md` and adds no MCP server (`claude mcp list`: "No MCP servers configured").
- **Complete list of skills** **[confirmed]**
  - 25 skill directories were listed by the GitHub tree and match the bucket manifest.
  - File paths come from the bucket's per-file `{uri, digest}` resource manifest. All **158** files were fetched from `raw.githubusercontent.com/huggingface/skills/main/skills/…`, and every one returned HTTP 200 with a SHA-256 matching its bucket digest.
  - Spot checks against the GitHub tree agreed: `skills/`, `huggingface-llm-trainer/`, `huggingface-llm-trainer/scripts/`, `huggingface-community-evals/` and `huggingface-spaces/`.
  - Each entry below also gives the `computedHash` the `skills` CLI would record for it, computed with the validated script from Q6.

#### `hf-cli`

- Description (frontmatter, first sentences verbatim): Hugging Face Hub CLI (`hf`) for downloading, uploading, and managing models, datasets, spaces, buckets, repos, papers, jobs, and more on the Hugging Face Hub. Use when: handling authentication; managing local cache; managing Hugging Face Buckets; running or scheduling jobs on Hugging Face infrastructure; managing Hugging Face repos; discussions and pull requests; browsing models, datasets and spaces; reading, searching, or browsing academic papers; managing collections; querying datasets; configuring spaces; setting up webhooks; or deploying and managing HF Inference Endpoints. …
- Files (1): `SKILL.md`
- Paid compute: Yes, on command: documents `hf jobs run/uv run/scheduled` (HF Jobs, billed per minute from credits) and `hf endpoints deploy` / `hf endpoints catalog deploy` (Inference Endpoints)
- Gallery relevance: Yes: general Hub access (search/download models and datasets, read papers), useful for any Hub work; install it user-level rather than vendoring (see Q4)
- skills-CLI `computedHash` at `80f9fa5`: `8530c415b7729812b5801787f2d1db3dbd0012a873b581a7983024da3fa92e9d`

#### `hf-cloud-aws-context-discovery`

- Description (frontmatter, first sentences verbatim): Discover the user's local AWS context (active profile, region, account ID, caller identity) at the start of any AWS task. Use this skill before any other AWS work — deploying to SageMaker, creating resources, calling AWS APIs, or anything that touches an AWS account. …
- Files (1): `SKILL.md`
- Paid compute: No by itself (reads local AWS profile/region/identity), but it is the entry step for AWS/SageMaker work
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `8585c46ea916c627a9059d94572241f7aa250097557084cabde8b8389bfe38f4`

#### `hf-cloud-python-env-setup`

- Description (frontmatter, first sentences verbatim): Set up an isolated Python environment for SageMaker / AWS work, with the right Python version and current boto3. Use this skill whenever Python code will be executed for a SageMaker deployment, training job, or any AWS automation — including when about to run `pip install`, when about to invoke `boto3`, when creating or activating a virtualenv, or when the user asks to "set up the environment". …
- Files (4): `SKILL.md`, `requirements.txt`, `scripts/check_versions.py`, `scripts/setup_env.py`
- Paid compute: No by itself (local venv + boto3); exists to support SageMaker/AWS runs
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `5fdce66710facf3cc1137cdfa07030b4a0defdab140282ac77bfa1cc59c78a4c`

#### `hf-cloud-sagemaker-deployment-planner`

- Description (frontmatter, first sentences verbatim): Plan and coordinate the deployment of a model to Amazon SageMaker AI. Use this skill whenever the user wants to deploy, host, serve, or expose a model on SageMaker or AWS — including phrases like "deploy a model", "host this LLM on AWS", "serve this embedding model", "deploy a reranker", "deploy a text-to-image / diffusion model", "host this for async inference", "create an endpoint", "serve my fine-tuned model", or any request that involves making a model available for inference on AWS. …
- Files (1): `SKILL.md`
- Paid compute: Yes, indirectly: plans and coordinates SageMaker endpoint deployment (AWS-billed)
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `25a72aa2b9444a8574474476d025fff7c68ad0cf1bf8ff863f81f2b390242d08`

#### `hf-cloud-sagemaker-iam-preflight`

- Description (frontmatter, first sentences verbatim): Ensure a usable SageMaker execution role exists before deploying or training. Use this skill whenever about to create a SageMaker endpoint, model, training job, or any resource that requires an execution role. …
- Files (5): `SKILL.md`, `references/minimum-permissions.json`, `references/trust-policy.json`, `scripts/check_role.py`, `scripts/create_role.py`
- Paid compute: No compute, but can create IAM roles in an AWS account (`scripts/create_role.py`)
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `c3f78beab5235fc5f2b215f68178ae1f38b2bd8b2f67f4840c0fa7b474d62576`

#### `hf-cloud-sagemaker-production-defaults`

- Description (frontmatter, first sentences verbatim): Create a SageMaker endpoint (real-time, real-time scale-to-zero, or async) with autoscaling, CloudWatch alarms, and tagging enabled by default. Use this skill whenever about to create a SageMaker endpoint, write deployment code that calls `create_endpoint`, or finalize a deployment after the image URI and IAM role are known. …
- Files (8): `SKILL.md`, `references/deployment-template.md`, `scripts/_common.py`, `scripts/deploy.py`, `scripts/deploy_async.py`, `scripts/deploy_ic.py`, `scripts/invoke_endpoint.py`, `scripts/teardown.py`
- Paid compute: Yes: `scripts/deploy.py`, `deploy_ic.py`, `deploy_async.py` create SageMaker endpoints (AWS-billed)
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `1920c3e98d3daeb43a7d4e6dd86a73b1cde14b1e743e0249ee7b64b7b4725526`

#### `hf-cloud-serving-image-selection`

- Description (frontmatter, first sentences verbatim): Pick the right serving container for a SageMaker model deployment and find its current image URI. Use this skill whenever about to deploy a model to a SageMaker endpoint and an image URI needs to be chosen — including when the user says "deploy this LLM", "host this HuggingFace model", "serve this fine-tuned model", "deploy this embedding model", "host a reranker", "serve a sentence-transformers model", or when about to hardcode any container URI in deployment code. …
- Files (3): `SKILL.md`, `references/model-to-image.md`, `scripts/mirror_image.py`
- Paid compute: No compute itself; `scripts/mirror_image.py` "Mirror[s] an ECR Public image to a private ECR repo" (AWS account resources)
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `d1a474163955afe291bcf5e369d25aafad4ad77964b6d0456bd49ec873c010be`

#### `hf-mem`

- Description (frontmatter, first sentences verbatim): Hugging Face CLI to estimate the required memory to load Safetensors or GGUF model weights for inference from the Hugging Face Hub
- Files (1): `SKILL.md`
- Paid compute: No (memory estimate from Hub metadata)
- Gallery relevance: Marginal (only if running open models on gallery hardware)
- skills-CLI `computedHash` at `80f9fa5`: `8e38f548246956ff9c2b156bd143c7d5da892993baf8ac61b83687f1ff3102f6`

#### `huggingface-best`

- Description (frontmatter, first sentences verbatim): Use when the user asks about finding the best, top, or recommended model for a task, wants to know what AI model to use, or wants to compare models by benchmark scores. Triggers on: "best model for X", "what model should I use for", "top models for [task]", "which model runs on my laptop/machine/device", "recommend a model for", "what LLM should I use for", "compare models for", "what's state of the art for", or any question about choosing an AI model for a specific use case. …
- Files (1): `SKILL.md`
- Paid compute: No (model selection); only points users to the HF Jobs guide
- Gallery relevance: Yes: picking a model for image similarity, captioning, OCR of inscriptions, translation
- skills-CLI `computedHash` at `80f9fa5`: `03329469a54bec7cf5bbe0f587d24718cc29a76fc51ea39a67544bf9d73d9a23`

#### `huggingface-community-evals`

- Description (frontmatter, first sentences verbatim): Run evaluations for Hugging Face Hub models using inspect-ai and lighteval on local hardware. Use for backend selection, local GPU evals, and choosing between vLLM / Transformers / accelerate. …
- Files (6): `SKILL.md`, `examples/.env.example`, `examples/USAGE_EXAMPLES.md`, `scripts/inspect_eval_uv.py`, `scripts/inspect_vllm_uv.py`, `scripts/lighteval_vllm_uv.py`
- Paid compute: No by design ("on local hardware"; "Not for HF Jobs orchestration"); needs a local GPU for vLLM backends
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `32eec43c4c176086132aefee5377b47e98095727289f128492da697dccbc1598`

#### `huggingface-datasets`

- Description (frontmatter, first sentences verbatim): Use this skill for Hugging Face Dataset Viewer API workflows that fetch subset/split metadata, paginate rows, search text, apply filters, download parquet URLs, and read size or statistics.
- Files (1): `SKILL.md`
- Paid compute: No (Dataset Viewer API, read-only)
- Gallery relevance: Yes: reading open-collection datasets on the Hub (e.g. museum open-access metadata) and the gallery's own catalogue dataset if one is published
- skills-CLI `computedHash` at `80f9fa5`: `d28d1ee4a61133ab6c1e12c74094681c2026c7e656784bd09831f91618fd0120`

#### `huggingface-gradio`

- Description (frontmatter, first sentences verbatim): Build Gradio web UIs and demos in Python. Use when creating or editing Gradio apps, components, event listeners, layouts, or chatbots.
- Files (2): `SKILL.md`, `examples.md`
- Paid compute: No (local Gradio code)
- Gallery relevance: Low (internal review tools/demos)
- skills-CLI `computedHash` at `80f9fa5`: `267dadfa06166207300e6995c0f38ece48d56cfe0067865563955f36a252ed88`

#### `huggingface-llm-trainer`

- Description (frontmatter, first sentences verbatim): Train or fine-tune language and vision models using TRL (Transformer Reinforcement Learning) or Unsloth with Hugging Face Jobs infrastructure. Covers SFT, DPO, GRPO and reward modeling training methods, plus GGUF conversion for local deployment. …
- Files (19): `SKILL.md`, `references/gguf_conversion.md`, `references/hardware_guide.md`, `references/hub_saving.md`, `references/local_training_macos.md`, `references/reliability_principles.md`, `references/trackio_guide.md`, `references/training_methods.md`, `references/training_patterns.md`, `references/troubleshooting.md`, `references/unsloth.md`, `scripts/convert_to_gguf.py`, `scripts/dataset_inspector.py`, `scripts/estimate_cost.py`, `scripts/hf_benchmarks.py`, `scripts/train_dpo_example.py`, `scripts/train_grpo_example.py`, `scripts/train_sft_example.py`, `scripts/unsloth_sft_example.py`
- Paid compute: Yes: trains on HF Jobs cloud GPUs (e.g. `hf jobs uv run --flavor a10g-large ...`), includes `scripts/estimate_cost.py`
- Gallery relevance: No (training, paid)
- skills-CLI `computedHash` at `80f9fa5`: `43bf6f95ca2a02882478bb1ba0b915ad2efdb5793e9cb2625fdc14872117a7e5`

#### `huggingface-local-models`

- Description (frontmatter, first sentences verbatim): Use to select models to run locally with llama.cpp and GGUF on CPU, Mac Metal, CUDA, or ROCm. Covers finding GGUFs, quant selection, running servers, exact GGUF file lookup, conversion, and OpenAI-compatible local serving.
- Files (4): `SKILL.md`, `references/hardware.md`, `references/hub-discovery.md`, `references/quantization.md`
- Paid compute: No (llama.cpp/GGUF on local hardware)
- Gallery relevance: Possible: private, local inference over catalogue text on gallery machines
- skills-CLI `computedHash` at `80f9fa5`: `98d8dd87770bafa3dc8e777204264e2d57ea550b3e04aae805e93d1e45d056a8`

#### `huggingface-lora-space-builder`

- Description (frontmatter, first sentences verbatim): Build and publish a Gradio demo on Hugging Face Spaces for a user-provided LoRA. Use when someone asks to create, generate, ship, or publish a Space, demo, Gradio app, or playground for a LoRA — including LoRAs for Qwen-Image, Qwen-Image-Edit, LTX-Video, Wan, FLUX, SDXL, or other diffusion base models. …
- Files (8): `SKILL.md`, `references/adapting-to-the-lora.md`, `references/base-models/krea-2.md`, `references/base-models/ltx.md`, `references/base-models/qwen-image.md`, `references/creative-mode.md`, `references/tasks.md`, `references/zerogpu-and-publishing.md`
- Paid compute: Subscription-gated: publishes a private Space on ZeroGPU, and "ZeroGPU requires PRO/Team/Enterprise" (overflow beyond quota is credit-billed, see `huggingface-zerogpu`)
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `15f80d3ceb24f11194588cc5467036dc06791904cad87c8aa82a22ec29a6578f`

#### `huggingface-paper-publisher`

- Description (frontmatter, first sentences verbatim): Publish and manage research papers on Hugging Face Hub. Supports creating paper pages, linking papers to models/datasets, claiming authorship, and generating professional markdown-based research articles.
- Files (8): `SKILL.md`, `examples/example_usage.md`, `references/quick_reference.md`, `scripts/paper_manager.py`, `templates/arxiv.md`, `templates/ml-report.md`, `templates/modern.md`, `templates/standard.md`
- Paid compute: No compute; writes to the Hub (paper pages, repo links)
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `f20ababe4c4dfdc5e1b9bb24ffbb95792efff0e56f16917f41f9d665e2d31bfe`

#### `huggingface-papers`

- Description (frontmatter, first sentences verbatim): Look up and read Hugging Face paper pages in markdown, and use the papers API for structured metadata such as authors, linked models/datasets/spaces, Github repo and project page. Use when the user shares a Hugging Face paper page URL, an arXiv URL or ID, or asks to summarize, explain, or analyze an AI research paper.
- Files (1): `SKILL.md`
- Paid compute: No (reads paper pages / papers API)
- Gallery relevance: Low (researching vision/OCR methods)
- skills-CLI `computedHash` at `80f9fa5`: `d10f77f78592263ed257ff1be56ab53469490ada7e8158460037af88c52454a7`

#### `huggingface-spaces`

- Description (frontmatter, first sentences verbatim): Build, deploy, and maintain applications on Hugging Face Spaces — Gradio / Docker / Static SDKs, ZeroGPU and dedicated hardware, model loading, debugging, buckets, inference providers, community grants. Use whenever the user asks to create or host an app on Hugging Face, port code onto ZeroGPU, fix a Space that won't build or run, or otherwise work with `hf spaces …`, `@spaces.GPU`, Space README frontmatter, or the `spaces` Python package.
- Files (15): `README.md`, `SKILL.md`, `references/3d-cuda-extensions.md`, `references/3d-generation.md`, `references/3d-gsplat.md`, `references/3d-models.md`, `references/3d-outputs.md`, `references/buckets.md`, `references/debugging.md`, `references/gradio.md`, `references/grants.md`, `references/inference-providers.md`, `references/known-errors.md`, `references/requirements.md`, `references/zerogpu.md`
- Paid compute: Can be: "Dedicated GPU ... billed to the Space creator by the hour"; Inference Providers calls billed to the Space creator or visitor
- Gallery relevance: Low (only if the gallery hosts a demo on Spaces)
- skills-CLI `computedHash` at `80f9fa5`: `f68a0d4a167a1da21200093176684a110ee425e3d1bd11fabb53ee5c1ff281ef`

#### `huggingface-tool-builder`

- Description (frontmatter, first sentences verbatim): Use this skill when the user wants to build tool/scripts or achieve a task where using data from the Hugging Face API would help. This is especially useful when chaining or combining API calls or the task will be repeated/automated. …
- Files (8): `SKILL.md`, `references/baseline_hf_api.py`, `references/baseline_hf_api.sh`, `references/baseline_hf_api.tsx`, `references/find_models_by_paper.sh`, `references/hf_enrich_models.sh`, `references/hf_model_card_frontmatter.sh`, `references/hf_model_papers_auth.sh`
- Paid compute: No (builds scripts over the HF API)
- Gallery relevance: Moderate (scripts that query the Hub API)
- skills-CLI `computedHash` at `80f9fa5`: `5466e19d49b55fd0cec167f921acb01bb7473c30dee8f60962225efb96099908`

#### `huggingface-trackio`

- Description (frontmatter, first sentences verbatim): Track and visualize ML training experiments with Trackio. Use when logging metrics during training (Python API), firing alerts for training diagnostics, or retrieving/analyzing logged metrics (CLI). …
- Files (4): `SKILL.md`, `references/alerts.md`, `references/logging_metrics.md`, `references/retrieving_metrics.md`
- Paid compute: No (logging/dashboards; can sync to a Space)
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `0bb036906866198f55a40da22c3a8758140357a19b985af67c09af5d599def62`

#### `huggingface-vision-trainer`

- Description (frontmatter, first sentences verbatim): Trains and fine-tunes vision models for object detection (D-FINE, RT-DETR v2, DETR, YOLOS), image classification (timm models — MobileNetV3, MobileViT, ResNet, ViT/DINOv3 — plus any Transformers classifier), and SAM/SAM2 segmentation using Hugging Face Transformers on Hugging Face Jobs cloud GPUs. Covers COCO-format dataset preparation, Albumentations augmentation, mAP/mAR evaluation, accuracy metrics, SAM segmentation with bbox/point prompts, DiceCE loss, hardware selection, cost estimation, Trackio monitoring, and Hub persistence. …
- Files (12): `SKILL.md`, `references/finetune_sam2_trainer.md`, `references/hub_saving.md`, `references/image_classification_training_notebook.md`, `references/object_detection_training_notebook.md`, `references/reliability_principles.md`, `references/timm_trainer.md`, `scripts/dataset_inspector.py`, `scripts/estimate_cost.py`, `scripts/image_classification_training.py`, `scripts/object_detection_training.py`, `scripts/sam_segmentation_training.py`
- Paid compute: Yes: fine-tunes on "Hugging Face Jobs cloud GPUs"; includes `scripts/estimate_cost.py`
- Gallery relevance: Low and paid (would matter only for training a custom artwork classifier)
- skills-CLI `computedHash` at `80f9fa5`: `bf5eff3c692372a798f1763f975ed2725794a55af4f0ba4de58492e7d83b8d75`

#### `huggingface-zerogpu`

- Description (frontmatter, first sentences verbatim): AI demos and GPU compute with Gradio Spaces and Hugging Face Spaces ZeroGPU. Use when writing or reviewing code that uses `@spaces.GPU`, configuring `python_version` or `requirements.txt` for a ZeroGPU Space, or handling ZeroGPU-specific code constraints — pickle-based process isolation, `gr.State` semantics across the worker boundary, no `torch.compile` (use AoTI instead), CUDA wheel-only builds (no `nvcc` at build or runtime), large vs xlarge sizing, and dynamic duration callables. …
- Files (5): `SKILL.md`, `references/concurrency.md`, `references/cuda-and-deps.md`, `references/how-quota-works.md`, `references/how-zerogpu-works.md`
- Paid compute: Can be: ZeroGPU runs against a daily quota, and per `references/how-quota-works.md` "For Pro / Team / Enterprise, pay-as-you-go credits cover the overflow"
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `740dfb441230ae6a7ba08a19c357aee7b758b25d1fe435df3233adc144aa2dd0`

#### `train-sentence-transformers`

- Description (frontmatter, first sentences verbatim): Train or fine-tune sentence-transformers models across `SentenceTransformer` (bi-encoder, dense or static embedding model for retrieval, similarity, clustering, classification, paraphrase mining, dedup, multimodal), `CrossEncoder` (reranker, pair scoring for two-stage retrieval / pair classification), `SparseEncoder` (SPLADE, sparse embedding model for learned-sparse retrieval), and `MultiVectorEncoder` (ColBERT / late-interaction, per-token embeddings scored with MaxSim). Covers loss selection, hard-negative mining, evaluators, distillation, LoRA, Matryoshka, and Hugging Face Hub publishing. …
- Files (31): `SKILL.md`, `references/base_model_selection.md`, `references/dataset_formats.md`, `references/evaluators_cross_encoder.md`, `references/evaluators_multi_vector_encoder.md`, `references/evaluators_sentence_transformer.md`, `references/evaluators_sparse_encoder.md`, `references/hardware_guide.md`, `references/hf_jobs_execution.md`, `references/losses_cross_encoder.md`, `references/losses_multi_vector_encoder.md`, `references/losses_sentence_transformer.md`, `references/losses_sparse_encoder.md`, `references/model_architectures.md`, `references/prompts_and_instructions.md`, `references/training_args.md`, `references/troubleshooting.md`, `scripts/mine_hard_negatives.py`, `scripts/train_cross_encoder_distillation_example.py`, `scripts/train_cross_encoder_example.py`, `scripts/train_cross_encoder_listwise_example.py`, `scripts/train_multi_vector_encoder_example.py`, `scripts/train_sentence_transformer_distillation_example.py`, `scripts/train_sentence_transformer_example.py`, `scripts/train_sentence_transformer_make_multilingual_example.py`, `scripts/train_sentence_transformer_matryoshka_example.py`, `scripts/train_sentence_transformer_multi_dataset_example.py`, `scripts/train_sentence_transformer_static_embedding_example.py`, `scripts/train_sentence_transformer_with_lora_example.py`, `scripts/train_sparse_encoder_distillation_example.py`, `scripts/train_sparse_encoder_example.py`
- Paid compute: Optional: defaults to local execution ("Pitch HF Jobs only if local hardware can't fit the job"); `references/hf_jobs_execution.md` covers Jobs
- Gallery relevance: Low (custom embedding model for catalogue search)
- skills-CLI `computedHash` at `80f9fa5`: `1e0c95b3dc87412e15356edda99ebdf37047f79f993da18a169749b3f8bf7c84`

#### `transformers-js`

- Description (frontmatter, first sentences verbatim): Use Transformers.js to run state-of-the-art machine learning models directly in JavaScript/TypeScript. Supports NLP (text classification, translation, summarization), computer vision (image classification, object detection), audio (speech recognition, audio classification), and multimodal tasks. …
- Files (8): `SKILL.md`, `references/CACHE.md`, `references/CONFIGURATION.md`, `references/EXAMPLES.md`, `references/MODEL_ARCHITECTURES.md`, `references/MODEL_REGISTRY.md`, `references/PIPELINE_OPTIONS.md`, `references/TEXT_GENERATION.md`
- Paid compute: No (runs models in the browser/Node via WebGPU/WASM)
- Gallery relevance: Yes: the storefront is a JS/TS app (`js/packages/web`); in-browser/Node embeddings or classification without a paid API
- skills-CLI `computedHash` at `80f9fa5`: `f61c531d0cc9ee4cb714b5a651f4a7a939ce127f70333d44af179cbbb1663de1`

#### `trl-training`

- Description (frontmatter, first sentences verbatim): Train and fine-tune transformer language models using TRL (Transformers Reinforcement Learning). Supports SFT, DPO, GRPO, KTO, RLOO and Reward Model training via CLI commands.
- Files (1): `SKILL.md`
- Paid compute: No by itself (local `trl` CLI), needs a GPU
- Gallery relevance: No
- skills-CLI `computedHash` at `80f9fa5`: `6d67e55c6716dc2f526e3c29c4ef2704adb6e28cc074a1a4afe54b57bf2507e1`

- **Summary: skills that can launch paid compute**
  - **Yes:**
    - `hf-cli`, through documented `hf jobs` and `hf endpoints deploy` commands
    - `huggingface-llm-trainer` and `huggingface-vision-trainer` (HF Jobs)
    - `hf-cloud-sagemaker-production-defaults` and `hf-cloud-sagemaker-deployment-planner` (AWS SageMaker)
    - `huggingface-spaces`, if dedicated hardware or Inference Providers are used
    - `huggingface-zerogpu` and `huggingface-lora-space-builder`, through ZeroGPU overflow credits or a PRO requirement
  - **Optional:** `train-sentence-transformers` (local by default).
  - **AWS account side effects without compute:** `hf-cloud-sagemaker-iam-preflight` and `hf-cloud-serving-image-selection`.
- **Summary: skills relevant to the storefront and cataloguing**
  - `hf-cli`, at user level
  - `huggingface-datasets`
  - `huggingface-best`
  - `transformers-js`
  - `huggingface-local-models` is optional.
  - Everything else is training, AWS or publishing tooling that the gallery does not need.

### Sources
- https://github.com/huggingface/skills (root listing, via WebFetch)
- https://github.com/huggingface/skills/tree/main/skills (25 directories, via WebFetch)
- https://github.com/huggingface/skills/commits/main and https://github.com/huggingface/skills/commits/main.atom
- https://raw.githubusercontent.com/huggingface/skills/main/.claude-plugin/marketplace.json, `.claude-plugin/marketplace-internal.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.cursor-plugin/marketplace.json`, `.mcp.json`, `gemini-extension.json`, `README.md`, `agentsmd/AGENTS.md`
- https://raw.githubusercontent.com/huggingface/skills/main/agents/AGENTS.md (404)
- hf://buckets/huggingface/skills/distribution/latest/skills.json and `manifest.json`
- hf://docs/hub/agents-skills.md → https://huggingface.co/docs/hub/agents-skills

---

## Key question 6: the `skills` CLI behind `skills-lock.json` (hash, lock fields, layout, local installs)

### Answer

- **Which package** **[confirmed]**
  - npm `skills`, version **1.7.0**: "The open agent skills ecosystem". Repository `git+https://github.com/vercel-labs/skills.git`, bins `skills` and `add-skill`, licence MIT, last modified 2026-09-17T15:02:04.723Z.
  - The lock file name and version match `dist/cli.mjs`: `const LOCAL_LOCK_FILE = "skills-lock.json"` and `CURRENT_VERSION$1 = 1`.
- **How `computedHash` is computed** **[confirmed in source, and reproduced]**
  - `computeSkillFolderHash(skillDir)` and `collectFiles`:
    1. Walk the skill folder recursively, skipping directories named `.git` and `node_modules`.
    2. Include only regular files (`entry.isFile()`). Symlinks are neither followed nor hashed.
    3. Record each file's path relative to the skill folder with `/` separators, plus its raw bytes.
    4. Sort by that path using `String.prototype.localeCompare`, i.e. the ICU default locale, not byte order. For example, `references/CACHE.md` sorts before `SKILL.md`.
    5. Take one SHA-256 over `relativePath` then `content` for each file, with no separators or length prefixes, output as hex.
  - For a project install, the hash is taken over the **source** skill folder (`skill.path` in the temporary clone). For the four "blob" GitHub owners (`vercel`, `vercel-labs`, `heygen-com`, `remotion-dev`) and `zapier/connectors`, it is a snapshot hash instead: `computeSnapshotHash`, the same path-then-contents scheme over the downloaded files.
  - Caveat: the copy step excludes files named `metadata.json` and the directories `.git`, `__pycache__` and `__pypackages__`. A source skill containing those would record a hash that differs from its installed folder. None of the 25 HF skills contains them.
- **Lock entry fields** **[confirmed in source]**
  - `version`: `1`. Older versions are discarded as empty.
  - `skills.<name>`: keys are sorted alphabetically on every write.
  - `source`: `owner/repo` for GitHub. For `local`, a path relative to the lock file (`./…` or `../…`).
  - `sourceType`: e.g. `github`, `local`, `node_modules` (from `experimental_sync`), or generic git.
  - `sourceUrl`: written only for generic git sources, so they can be restored.
  - `ref`: written only when a ref was given, e.g. `owner/repo#ref`. The existing entries have none, so the lock does **not** pin a commit.
  - `skillPath`: path of `SKILL.md` inside the source repo, e.g. `skills/supabase/SKILL.md`.
  - `computedHash`: the hash described above.
  - `skills update` for a project uses only entries whose `sourceType` is neither `local` nor `node_modules` (`getProjectSkillsForUpdate`).
  - The **global** lock is a different file: `~/.agents/.skill-lock.json`, or `$XDG_STATE_HOME/skills/.skill-lock.json`, version 3. It stores `skillFolderHash`, which is the GitHub tree SHA for GitHub sources, not `computedHash`.
- **Layout** **[confirmed, observed]**
  - The canonical copy is the real directory `.agents/skills/<name>/`.
  - Agents whose project skills directory is `.agents/skills` read it directly. The CLI calls these "universal", and they include `codex` and `gemini-cli`.
  - Agents with their own directory get a relative symlink. Claude Code: `.claude/skills/<name> -> ../../.agents/skills/<name>`, observed exactly as in this repo. `--copy` copies instead.
  - Global directories in the CLI's agent table:
    - Claude Code `~/.claude/skills`, honouring `CLAUDE_CONFIG_DIR`
    - Codex `$CODEX_HOME/skills`, i.e. `~/.codex/skills`
    - Gemini `~/.gemini/skills`
  - Codex also reads `~/.agents/skills` (Q2).
- **Telemetry** **[confirmed]**: `track()` calls `https://add-skill.vercel.sh/t`, and an audit lookup calls `https://add-skill.vercel.sh/audit`. Both are skipped when `DISABLE_TELEMETRY` or `DO_NOT_TRACK` is set.
- **Reproduction script** **[confirmed, MATCHED]**
  - Script: `/tmp/claude-0/-home-user-metaplex/72f4fc58-486f-5787-bedd-9a9510ec3c9a/scratchpad/skills-hash.mjs`, full text below.
  - `node skills-hash.mjs --check /home/user/metaplex` printed, and exited 0:

  ```
  MATCH    supabase files=4
    computed 583344c20e90f3654dbb0632f088d89fd9f1dde8ac85e8a644dd12eee59b1380
    lock     583344c20e90f3654dbb0632f088d89fd9f1dde8ac85e8a644dd12eee59b1380
  MATCH    supabase-postgres-best-practices files=36
    computed e14e276241805c97dbcfe40dcbea1a3035269cc7293cac4b1832dda41a835e60
    lock     e14e276241805c97dbcfe40dcbea1a3035269cc7293cac4b1832dda41a835e60
  ```

  - Hashing through the `.claude/skills/supabase` symlink gives the same value. Node was v22.22.2.
- **Installing from a local directory** **[confirmed, observed]**
  - It works. In a scratch copy of this repo's `.agents`, `.claude/skills` and `skills-lock.json`, `DISABLE_TELEMETRY=1 skills add <mirror>/skills/huggingface-datasets -a claude-code codex -y` did three things:
    1. Created `.agents/skills/huggingface-datasets/`.
    2. Created the symlink `.claude/skills/huggingface-datasets -> ../../.agents/skills/huggingface-datasets`.
    3. Added `"huggingface-datasets": {"source": "../../hfskills/mirror/skills/huggingface-datasets", "sourceType": "local", "computedHash": "d28d1ee4a61133ab6c1e12c74094681c2026c7e656784bd09831f91618fd0120"}` while leaving the two supabase entries untouched.
  - The script gives the same hash for the installed folder and the mirror.
  - `skills add <mirror-root> --list` found all 25 skills.
  - Consequence: skills fetched via raw.githubusercontent.com can be installed with the real CLI. The lock entry then says `sourceType: "local"`, carries a machine-specific relative `source`, and is skipped by `skills update`.
  - Rewriting such an entry to `{"source": "huggingface/skills", "sourceType": "github", "skillPath": "skills/<name>/SKILL.md", "computedHash": <same>}` gives the entry `npx skills add huggingface/skills` would write for the same content **[strong evidence]**. Non-blob GitHub installs hash the cloned folder with the same function, and the files matched `main` at `80f9fa5`. It was not run against GitHub, which is blocked here.
- **Running the CLI inside an agent**: it detected Claude Code ("claude-code_2-1-282_agent Agent detected — installing non-interactively").

```js
#!/usr/bin/env node
// Reproduce the `computedHash` that the `skills` CLI (npm "skills", vercel-labs/skills,
// checked against v1.7.0 dist/cli.mjs `computeSkillFolderHash` + `collectFiles`) writes
// into skills-lock.json for a project-scope install.
//
// Algorithm (mirrors the CLI exactly):
//   1. Walk the skill folder recursively. Skip directories named ".git" and "node_modules".
//      Include only regular files (Dirent.isFile()); symlinks are NOT followed or hashed.
//   2. For each file record its path relative to the skill folder, with "/" separators,
//      and its raw bytes.
//   3. Sort by relative path with String.prototype.localeCompare (default locale, as the CLI does).
//   4. SHA-256 over, for each file in order: update(relativePath) then update(contentBytes).
//      No separators, no length prefixes. Output lowercase hex.
//
// Usage: node skills-hash.mjs <skillDir> [<skillDir> ...]
//        node skills-hash.mjs --check <repoRoot>   (compare every entry in <repoRoot>/skills-lock.json
//                                                   against <repoRoot>/.agents/skills/<name>)
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

async function collectFiles(baseDir, currentDir, results) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") return;
        await collectFiles(baseDir, fullPath, results);
      } else if (entry.isFile()) {
        const content = await readFile(fullPath);
        const relativePath = relative(baseDir, fullPath).split("\\").join("/");
        results.push({ relativePath, content });
      }
    }),
  );
}

export async function computeSkillFolderHash(skillDir) {
  const files = [];
  await collectFiles(skillDir, skillDir, files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return { hash: hash.digest("hex"), fileCount: files.length };
}

async function main(argv) {
  if (argv[0] === "--check") {
    const root = resolve(argv[1] ?? ".");
    const lock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
    let allOk = true;
    for (const [name, entry] of Object.entries(lock.skills)) {
      const dir = join(root, ".agents", "skills", name);
      const { hash, fileCount } = await computeSkillFolderHash(dir);
      const ok = hash === entry.computedHash;
      allOk &&= ok;
      console.log(`${ok ? "MATCH   " : "MISMATCH"} ${name} files=${fileCount}\n  computed ${hash}\n  lock     ${entry.computedHash}`);
    }
    process.exitCode = allOk ? 0 : 1;
    return;
  }
  if (argv.length === 0) {
    console.error("usage: node skills-hash.mjs <skillDir>... | --check <repoRoot>");
    process.exitCode = 2;
    return;
  }
  for (const dir of argv) {
    const { hash, fileCount } = await computeSkillFolderHash(resolve(dir));
    console.log(`${hash}  ${dir}  (files=${fileCount})`);
  }
}

await main(process.argv.slice(2));
```

### Sources
- https://registry.npmjs.org/skills (`npm view skills`, `npm pack skills` → `skills-1.7.0.tgz`), `package/dist/cli.mjs`:
  - `LOCAL_LOCK_FILE`, `readLocalLock` / `writeLocalLock`
  - `computeSkillFolderHash` / `collectFiles`
  - `computeSnapshotHash`, `BLOB_ALLOWED_OWNERS`, `BLOB_ALLOWED_REPOS`
  - the `claude-code`, `codex` and `gemini-cli` agent entries
  - `getProjectSkillsForUpdate`, `getSkillLockPath`
  - `TELEMETRY_URL` / `AUDIT_URL`
  - `EXCLUDE_FILES` / `EXCLUDE_DIRS`
- `skills --help` from `npm install skills@1.7.0`

---

## Recommended configuration

This section is a set of choices for Sanjay to make. Nothing below has been applied to the repo.

The recommendation follows the pattern `.claude/README.md` already sets for Supabase:
- No credentials in the repository.
- Each person signs in with OAuth.
- The tool surface is narrowed. HF's URL presets only change what is advertised (Q1), so this repo narrows it with a deny list in each client.

The server name is `huggingface` everywhere. Claude Code only warns about a name defined in more than one scope when the endpoints differ, so project and user entries should use the same URL.

### 0. One-time Hugging Face account settings (Sanjay, browser)

- At `https://huggingface.co/settings/mcp`, keep the built-in tools to `hf_fs`, `hub_repo_search` and `hub_repo_details`. Leave "Run and Manage Jobs", "Contribute Repos" and "Sandboxes" off. Leave "Dynamic Spaces" off unless Space tools are wanted, since ZeroGPU overflow can be billed.
- Only if the Gemini bearer route is used (§3): create one **read** or fine-grained read-only token per machine at `https://huggingface.co/settings/tokens`. HF's advice is "one access token per app or usage… A local machine".

### 1. Claude Code

**Project (this repo).**

`.mcp.json`: add a second server next to `supabase`, which stays unchanged:

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=xgsfrltjnigsglkxhmsq&read_only=true&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment"
    },
    "huggingface": {
      "type": "http",
      "url": "https://huggingface.co/mcp?login"
    }
  }
}
```

- This is exactly what `claude mcp add --scope project --transport http huggingface "https://huggingface.co/mcp?login"` writes (observed).
- Each person approves the server on the first interactive `claude` run in the repo, then runs `claude mcp login huggingface`. Over SSH, connect with `ssh -t` and add `--no-browser`: "Print the authorization URL instead of opening a browser (for SSH/headless sessions — paste the redirect URL back when prompted)".
- Keep no `Authorization` header in this entry. Claude Code reports "OAuth fallback is disabled when headers.Authorization is set" (observed).

`.claude/settings.json`: a new file. Deny rules "apply right away", even before workspace trust:

```json
{
  "permissions": {
    "deny": [
      "mcp__huggingface__hf_jobs",
      "mcp__huggingface__create_repo",
      "mcp__huggingface__dynamic_space",
      "mcp__huggingface__hf_sandbox",
      "mcp__huggingface__hf_sandbox_exec",
      "mcp__huggingface__hf_sandbox_fs",
      "Bash(hf jobs *)",
      "Bash(hf endpoints *)"
    ]
  }
}
```

- Drop the `dynamic_space` line if Space tools should be callable.
- The `Bash(...)` rules cover the paid commands that the `hf-cli` skill teaches. `Bash(git log *)`-style wildcards are the documented syntax.

**Skills (project):** vendor only the relevant, compute-free skills, the same way the Supabase skills are held. On a machine with GitHub access, from the repo root:

```bash
DISABLE_TELEMETRY=1 npx skills@1.7.0 add huggingface/skills \
  --skill huggingface-datasets huggingface-best transformers-js \
  --agent claude-code codex gemini-cli -y
node /path/to/skills-hash.mjs --check .   # every entry must print MATCH
```

Expected new `skills-lock.json` entries if `main` is still at `80f9fa5`, in the same shape as the supabase ones **[strong evidence]**:

```json
"huggingface-best": {
  "source": "huggingface/skills",
  "sourceType": "github",
  "skillPath": "skills/huggingface-best/SKILL.md",
  "computedHash": "03329469a54bec7cf5bbe0f587d24718cc29a76fc51ea39a67544bf9d73d9a23"
},
"huggingface-datasets": {
  "source": "huggingface/skills",
  "sourceType": "github",
  "skillPath": "skills/huggingface-datasets/SKILL.md",
  "computedHash": "d28d1ee4a61133ab6c1e12c74094681c2026c7e656784bd09831f91618fd0120"
},
"transformers-js": {
  "source": "huggingface/skills",
  "sourceType": "github",
  "skillPath": "skills/transformers-js/SKILL.md",
  "computedHash": "f61c531d0cc9ee4cb714b5a651f4a7a939ce127f70333d44af179cbbb1663de1"
}
```

- Offline alternative: install from a local copy fetched from raw.githubusercontent.com (Q6), then edit each lock entry to the GitHub form above.
- Do **not** vendor `hf-cli` by default. It is generated from each machine's installed `hf` version and is installed at user level by the `hf` installer. In Claude Code a personal skill of the same name wins over a project one anyway: "personal over project".
- Vendoring `hf-cli` too is only worth it for cloud sessions (e.g. Claude Code on the web), which have no user-level skills.
- Do not use the Claude plugin route (`claude plugin marketplace add huggingface/skills` then `claude plugin install hf-cli@huggingface-skills`) on top of the installer. It is the same skill a second time.

**User (every LAN machine).** Registration is scriptable. Sign-in is manual, once per machine:

```bash
claude mcp add --scope user --transport http huggingface "https://huggingface.co/mcp?login"
claude mcp login huggingface            # over SSH: ssh -t host, then add --no-browser
```

- For user-wide safety, put the same deny list in `~/.claude/settings.json`. On Windows that is `%USERPROFILE%\.claude\settings.json`.
- The user-level `hf-cli` skill comes from the `hf` installer (§4): `~/.agents/skills/hf-cli`, plus the symlink `~/.claude/skills/hf-cli`.
- **Bearer variant, if OAuth is not wanted:** `claude mcp add --scope user --transport http huggingface https://huggingface.co/mcp --header 'Authorization: Bearer ${HF_TOKEN}'`.
  - The single quotes keep `${HF_TOKEN}` literal in `~/.claude.json` (observed), and it is expanded at connect time.
  - Observed with a local header-logging server: `${HF_TOKEN}` expanded in both a user-scope entry and a project `.mcp.json`.
  - Caveat: the 2.1.282 binary does contain `HF_TOKEN`, `HUGGING_FACE_HUB_TOKEN` and `HUGGINGFACEHUB_API_TOKEN` in a credential-name list next to `NPM_TOKEN` and `PYPI_TOKEN`. That list is not what blanks `${VAR}` in MCP headers today, and its purpose is **[unverified]**. Re-test after upgrades.

### 2. Codex

**Project (this repo):** `.codex/config.toml`, a new file:

```toml
# Hugging Face MCP. Codex loads this file only after the repo is trusted in ~/.codex/config.toml.
[mcp_servers.huggingface]
url = "https://huggingface.co/mcp?login"
disabled_tools = ["hf_jobs", "create_repo", "dynamic_space", "hf_sandbox", "hf_sandbox_exec", "hf_sandbox_fs"]
```

Each person trusts the repo once in `~/.codex/config.toml`, using the absolute path of their clone. This is **[confirmed]** to gate loading:

```toml
[projects."/path/to/metaplex"]
trust_level = "trusted"
```

- Then run `codex mcp login huggingface`, or `codex mcp login huggingface --no-browser` over SSH. Running it inside the repo for a project-only server is **[unverified]**. If it fails, define the server at user scope as below; the project entry then simply overrides it with identical values.
- Skills need nothing extra. Codex reads `<repo>/.agents/skills`, which the `skills` CLI fills (Q2, observed), without trust.

**User (every LAN machine):** add to `~/.codex/config.toml` (Windows: `%USERPROFILE%\.codex\config.toml`):

```toml
[mcp_servers.huggingface]
url = "https://huggingface.co/mcp?login"
disabled_tools = ["hf_jobs", "create_repo", "dynamic_space", "hf_sandbox", "hf_sandbox_exec", "hf_sandbox_fs"]
```

- Then run `codex mcp login huggingface [--no-browser]`.
- Appending the block is safer in an unattended script than `codex mcp add`. `add` starts an OAuth flow by itself once it detects OAuth support ("Detected OAuth support. Starting OAuth flow…").
- Bearer variant: `url = "https://huggingface.co/mcp"` plus `bearer_token_env_var = "HF_TOKEN"`. An inline `bearer_token` is rejected. What Codex does when `HF_TOKEN` is unset is **[unverified]**.
- Skills: Codex reads `~/.agents/skills`, where the `hf` installer puts `hf-cli`, so no plugin is needed. The plugin route (`codex plugin marketplace add huggingface/skills` then `codex plugin add hf-cli@huggingface-skills`) would duplicate it.

### 3. Gemini CLI (bonus)

- OAuth "will not work in… Remote SSH sessions without X11 forwarding", so use the bearer header with a read-only token here.
- `${HF_TOKEN}` is expanded across the whole settings file, and an unset variable becomes empty. An unset token then degrades to HF's anonymous read-only tool set instead of failing.
- MCP servers and workspace skills load only in trusted folders (`~/.gemini/trustedFolders.json`).

**Project:** `.gemini/settings.json`, a new file:

```json
{
  "mcpServers": {
    "huggingface": {
      "httpUrl": "https://huggingface.co/mcp",
      "headers": { "Authorization": "Bearer ${HF_TOKEN}" },
      "excludeTools": ["hf_jobs", "create_repo", "dynamic_space", "hf_sandbox", "hf_sandbox_exec", "hf_sandbox_fs"]
    }
  }
}
```

**User:**

```bash
gemini mcp add -s user -t http huggingface https://huggingface.co/mcp -H 'Authorization: Bearer ${HF_TOKEN}'
```

- Afterwards, add the `excludeTools` array to `~/.gemini/settings.json` by hand. The `--exclude-tools a,b,c` flag stores one comma-joined string (observed).
- Token delivery: `hf auth login --token <read token>` stores it at `~/.cache/huggingface/token`, and the shell rc can export `HF_TOKEN` from that file. `HF_TOKEN` then also overrides the stored token for `hf` itself.
- Do not use `gemini extensions install https://github.com/huggingface/skills.git --consent` for the gallery. It brings all 25 skills, including the SageMaker and HF Jobs ones, plus a second `?login` server named `huggingface-skills`.

### 4. `ops/network/scripts/bootstrap-ai-clis.sh` and `.ps1` additions (proposed, not applied)

Bash, in the kit's style, reusing `have`, `log`, `warn` and `ensure_path`. Pass `--no-modify-path` so that only the kit's `ensure_path` edits rc files:

```bash
install_hf() {
  if have hf; then
    log "hf present ($(HF_HUB_DISABLE_UPDATE_CHECK=1 hf --version 2>/dev/null | head -1)); checking for an update"
    hf update >/dev/null 2>&1 || true      # also refreshes the global hf-cli skill if it is installed
    return 0
  fi
  log "installing Hugging Face CLI (official installer; also installs the hf-cli skill for Claude Code, Codex and Gemini)"
  if curl -LsSf https://hf.co/cli/install.sh | bash -s -- --no-modify-path; then
    ensure_path "$HOME/.local/bin"
  else
    warn "hf install failed: it needs Python 3.10+ with venv (macOS: brew install python; Debian/Ubuntu: apt-get install python3 python3-venv)"
  fi
}
```

- Add a `--skip-hf` flag and a call `[ "$SKIP_HF" = 1 ] || install_hf`.
- Add `hf` to the versions loop.
- Add a sign-in line:
  - `hf  run \`hf auth login\` (prints a URL and a code; open https://huggingface.co/oauth/device on any machine). Scripted: hf auth login --token "$HF_TOKEN". check: hf auth whoami`
- Add MCP sign-in lines:
  - `claude mcp login huggingface --no-browser`
  - `codex mcp login huggingface --no-browser`

PowerShell, reusing `Have`, `Log` and `Refresh-Path`. The Windows installer manages the user PATH itself unless given `-NoModifyPath`:

```powershell
if (-not $SkipHf) {
  if (Have 'hf') { Log "hf present ($(hf --version 2>$null)); checking for an update"; hf update | Out-Null }
  else {
    Log 'installing Hugging Face CLI (official installer; also installs the hf-cli skill)'
    try { & ([scriptblock]::Create((Invoke-RestMethod -Uri 'https://hf.co/cli/install.ps1'))); Refresh-Path }
    catch { Write-Warning "hf install failed (it needs Python 3.10+): $_" }
  }
}
```

Caveats:
- **Python.** Neither installer installs Python. A Python 3.10+ prerequisite (e.g. `winget install`) was not verified here: **[unverified]**.
- **Homebrew.** `brew install hf` is an option on Macs, but the formula is at 1.32.0 and `hf update` would keep it on Homebrew's schedule.
- **Symlinks on Windows.** Without Developer Mode, `hf skills add` copies the skill into `~/.claude/skills` instead of symlinking it (source).

Optional unattended MCP registration, user scope, on each LAN machine:

```bash
register_hf_mcp() {
  if have claude; then
    claude mcp get huggingface >/dev/null 2>&1 || \
      claude mcp add --scope user --transport http huggingface "https://huggingface.co/mcp?login" >/dev/null
  fi
  CODEX_CFG="${CODEX_HOME:-$HOME/.codex}/config.toml"
  if have codex && ! grep -qs '^\[mcp_servers\.huggingface\]' "$CODEX_CFG"; then
    mkdir -p "$(dirname "$CODEX_CFG")"
    printf '\n[mcp_servers.huggingface]\nurl = "https://huggingface.co/mcp?login"\ndisabled_tools = ["hf_jobs", "create_repo", "dynamic_space", "hf_sandbox", "hf_sandbox_exec", "hf_sandbox_fs"]\n' >> "$CODEX_CFG"
  fi
}
```

The exit status of `claude mcp get` for a missing server is **[unverified]**. `claude mcp list | grep -q '^huggingface:'` is an alternative, but it runs health checks.

### 5. Suggested addition to `.claude/README.md`

This is a proposed section, not applied:

> ## Hugging Face MCP server (`.mcp.json`) and skills
> Project-scoped `huggingface` server at `https://huggingface.co/mcp?login`: per-person OAuth (`claude mcp login huggingface`; `codex mcp login huggingface`), no credentials in the repo.
>
> The server's URL presets only change which tools are advertised, not which can be called. `.claude/settings.json` (Claude Code), `.codex/config.toml` `disabled_tools` (Codex) and `.gemini/settings.json` `excludeTools` (Gemini) therefore deny `hf_jobs`, `create_repo`, `dynamic_space` and the sandbox tools, and Claude Code also denies `hf jobs` / `hf endpoints` shell commands, because those launch billed compute.
>
> HF skills are vendored with `npx skills add huggingface/skills --skill …` like the Supabase ones; check `skills-lock.json` with `node skills-hash.mjs --check .`.

---

## Successful queries

- `mcp__Hugging_Face__hf_fs`:
  - `cat hf://docs/hub/agents-mcp.md`, `agents-overview.md`, `agents-skills.md`, `agents-cli.md`, `agents.md`, `spaces-mcp-servers.md`, `security-tokens.md`
  - `ls hf://docs/huggingface_hub`, which showed only `v2.0.0`
  - `cat hf://docs/huggingface_hub/v2.0.0/guides/cli.md`
  - `search hf://docs/huggingface_hub "hf skills add --claude --global"`, `"HF_HUB_DISABLE_UPDATE_CHECK"`, `"HF_TOKEN …"`
  - `search hf://docs/hub "Jobs pricing billed…"`
  - `ls hf://buckets/huggingface/skills` and `…/distribution/latest`
  - `cat …/manifest.json` and `…/skills.json`, which has per-file digests for all 158 files
- Shell to raw.githubusercontent.com:
  - `huggingface/hf-mcp-server` `README.md` and `docs/oauth-diagnostics.md`
  - `huggingface/skills` manifests, README, `agentsmd/AGENTS.md`, and all 158 skill files (HTTP 200, SHA-256 equal to the bucket)
  - `huggingface/huggingface_hub/main/utils/installers/install.sh` and `install.ps1`
  - `openai/codex` `codex-rs/config/src/{mcp_types,config_toml,project_trust,project_root_markers,marketplace_edit}.rs`, `codex-rs/config/src/loader/{README.md,mod.rs}`, `codex-rs/cli/src/{mcp_cmd,mcp_login,marketplace_cmd}.rs`, `codex-rs/skills/src/{parser,loading}.rs`
  - `google-gemini/gemini-cli` `docs/tools/mcp-server.md`, `docs/extensions/reference.md`, `docs/cli/skills.md`, `docs/cli/trusted-folders.md`
  - `Homebrew/homebrew-core/master/Formula/h/hf.rb`
- Shell to npm and PyPI:
  - `npm view` for `@openai/codex`, `@google/gemini-cli`, `skills`, `@llmindset/hf-mcp-server` and `@llmindset/hf-mcp`
  - `npm pack` of `skills`, `@llmindset/hf-mcp-server` and `@llmindset/hf-mcp`
  - `npm install` of `@openai/codex@0.156.1`, `@google/gemini-cli`, `skills@1.7.0`
  - `pip install huggingface_hub==2.0.0`
  - `https://pypi.org/pypi/huggingface_hub/json`
- Shell to code.claude.com: `docs/en/{mcp,skills,plugins,plugin-marketplaces,settings,discover-plugins,permissions}.md`.
- WebFetch:
  - `https://github.com/openai/codex/tree/main/codex-rs`, `…/codex-rs/config/src`, `…/codex-rs/cli/src`, `…/codex-rs/skills/src`, `…/codex-rs/core/src`, `…/codex-rs/config/src/loader`
  - `https://github.com/huggingface/skills`, `…/tree/main/skills`, `…/skills/huggingface-llm-trainer`, `…/huggingface-llm-trainer/scripts`, `…/huggingface-community-evals`, `…/huggingface-spaces`, `…/commits/main`, `…/commits/main.atom`
  - `https://github.com/huggingface/huggingface_hub/tree/main/utils`
- WebSearch, snippets only, restricted to developers.openai.com: Codex MCP config and `bearer_token_env_var`, Codex skills locations, Codex project config and trust.
- Local experiments, all in scratch with HOME, CODEX_HOME and CLAUDE_CONFIG_DIR redirected:
  - `codex mcp add/list/get`
  - project `.codex/config.toml` with and without trust
  - `codex debug prompt-input` skill-root probe
  - `codex plugin marketplace add <mirror>` and `codex plugin add hf-cli@huggingface-skills`
  - project-declared marketplace
  - inline `bearer_token` rejection
  - `claude mcp add` user and project, `claude mcp list` against a local header-logging server (`${HF_TOKEN}` expansion)
  - `claude plugin marketplace add <mirror>`, `claude plugin install hf-cli@huggingface-skills`, and the failing `hf-cli@huggingface/skills`
  - `gemini mcp add/list`, `gemini skills list`, `gemini extensions install <mirror> --consent`
  - `hf skills add` (project and `-g`) and `hf skills add --claude`, which errors
  - `skills add <local path>` and `--list`
  - `node skills-hash.mjs --check /home/user/metaplex`, which matched

## Exhausted leads

- **developers.openai.com** (`/codex/mcp`, `/codex/config-basic`, `/codex/skills`, `/codex/plugins`) is blocked from WebFetch and the shell (`EGRESS_BLOCKED`). Only search snippets were available. Codex behaviour was established from the Rust source and by running 0.156.1.
- **`openai/codex` `docs/*.md` on raw.githubusercontent.com**: `config.md`, `skills.md` and `agents_md.md` are now stubs pointing to developers.openai.com. `docs/plugins.md` returns 404.
- **huggingface.co and hf.co** are blocked from WebFetch and the shell. As a result:
  - The hosted `/mcp`, `/mcp/server-card`, `/.well-known/oauth-protected-resource/mcp` and `settings/mcp` pages were not observed.
  - `hf.co/cli/install.sh` was replaced by its source in the huggingface_hub repo.
  - `hf skills add <marketplace skill>`, which downloads from the Hub, could not be exercised.
- **github.com and api.github.com from the shell** are blocked. Real clones were not possible (`npx skills add huggingface/skills`, `codex plugin marketplace add huggingface/skills`, `claude plugin marketplace add huggingface/skills`, `gemini extensions install https://github.com/…`), so all four were tested against a local mirror verified by SHA-256.
- **`huggingface/skills` `agents/AGENTS.md`** is 404. The file is at `agentsmd/AGENTS.md`, and the HF docs link is stale.
- **Paths not present in `huggingface/skills`** (404): `.agents/plugins/marketplace.json`, `.codex-plugin/plugin.json`, root `AGENTS.md`, root `CLAUDE.md`, `package.json`.
- **`hf-mcp-server` `docs/README.md`**: 404.
- **`@llmindset/hf-mcp-server-http`**: not on npm (404). The README's `npx @llmindset/hf-mcp-server-http` name does not resolve. The package `@llmindset/hf-mcp-server` 0.4.23 provides the `hf-mcp-server-http` bin.
- **`gemini trust`** in the scratch HOME refused without an auth method, so trust was set by writing `~/.gemini/trustedFolders.json` in the scratch HOME.
- **Codex behaviour with `bearer_token_env_var` set to an unset variable**: not determined from binary strings. **[unverified]**.
- **End-to-end OAuth** against HF from Claude Code, Codex or Gemini: not possible here (network). **[unverified]**.
