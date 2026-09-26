# Claude Code configuration

## Supabase MCP server (`.mcp.json`)

Project-scoped, so it applies to every Claude Code session opened in this repo.
Authentication is per-developer OAuth 2.1 — run `/mcp` in an interactive
terminal, pick `supabase`, complete the browser flow. No credentials are stored
in this repository.

### Read this before widening the config

The configured project ref `xgsfrltjnigsglkxhmsq` (`bolt-native-database-67817695`)
holds **live production data** — several hundred real guest and RSVP records for
the wedding site, plus invitation and reminder logs. It is not a scratch database.

Supabase's own guidance is to [never point the MCP server at production data](https://supabase.com/docs/guides/getting-started/mcp),
and, where you must, to run it in read-only mode. The URL is therefore deliberately
constrained:

| Setting | Effect |
| --- | --- |
| `read_only=true` | Every SQL statement runs as a read-only Postgres user, so `execute_sql` and `apply_migration` cannot mutate live records |
| `project_ref=…` | Scopes the server to this one project, and disables the account-level tools (including `pause_project`) |
| `features=docs,account,database,debugging,development` | `functions` and `branching` are omitted on purpose — `deploy_edge_function`, `delete_branch` and `reset_branch` are not SQL, so `read_only` does not restrain them |

Removing `read_only=true` or adding back `functions` / `branching` gives an agent
write access to real guest data. If you need that, prefer pointing at a
development project or a Supabase branch instead.

## Skills

`.claude/skills/` holds relative symlinks into `.agents/skills/`, which is the
tool-agnostic location the `skills` CLI installs to. Codex and Gemini CLI read
`.agents/skills/` directly. Manage them with `npx skills`. `skills-lock.json`
pins each skill to its source and content hash.

## Hugging Face

The full guide is [`docs/hugging-face.md`](../docs/hugging-face.md). The agent
rules, covering spending, publishing and tokens, are in [`AGENTS.md`](../AGENTS.md),
which `CLAUDE.md` imports.

### Skills

Eighteen skills are vendored from `huggingface/skills` at commit `80f9fa5`, the
same way as the Supabase ones, and are hash-checked in `skills-lock.json`. Two
groups are deliberately left out:

- **The six `hf-cloud-*` skills** only serve AWS SageMaker, which the gallery
  does not use.
- **`hf-cli`** is generated from each machine's installed `hf` version and is
  installed at user level by the `hf` installer. A copy here would go stale,
  and Codex would list it twice.

Do not also install HF's Claude plugin (`hf-cli@huggingface-skills`). It
contains only that same `hf-cli` skill, and plugin skills are namespaced, so
both copies would load.

### MCP server: not in `.mcp.json`

This is deliberate. Sanjay's claude.ai account already has a Hugging Face
connector, and Claude Code loads it both in terminal sessions signed in with
that account and in cloud sessions. A `.mcp.json` entry would cause trouble
either way:

- **Same URL as the connector:** Claude Code prefers the entry and hides the
  connector ([docs](https://code.claude.com/docs/en/mcp)).
- **Different URL:** every tool appears twice.
- **Cloud sessions:** huggingface.co is unreachable there, so the entry would
  fail just as the Supabase entry does (`ERR_PROXY_TUNNEL`).

On a machine that does not get claude.ai connectors (API key, `claude
setup-token`, Bedrock or Vertex), add it once at user scope:

```bash
claude mcp add --scope user --transport http huggingface "https://huggingface.co/mcp?login"
claude mcp login huggingface   # --no-browser over SSH
```

### Guarding paid and publishing tools

The server's URL options only change which tools are *advertised*. A direct
call to any tool still works. The guards are:

- The HF account's MCP settings (<https://huggingface.co/settings/mcp>).
  Nobody has read that page; what was observed is the claude.ai connector's
  tool list on 2026-09-24 and 2026-09-25: `hf_fs`, `hf_whoami`,
  `hub_repo_details`, `hub_repo_search` and `dynamic_space`, with no Jobs,
  repo-creation or sandbox tool. So Dynamic Spaces appears to be on and
  should be turned off there; Jobs, Contribute Repos and Sandboxes appear
  to be off already.
- Codex removes the risky tools in `.codex/config.toml` (`disabled_tools`).
- Gemini removes them in its user-level `excludeTools` list, which the ops
  bootstrap writes.

- Claude Code asks before them, through `.claude/settings.json` (project scope,
  so it applies to every checkout):
  - `permissions.ask` for `mcp__*__hf_jobs`, `mcp__*__dynamic_space`,
    `mcp__*__create_repo` and the three `hf_sandbox*` tools, whatever the
    server is named (`mcp__*__` covers the claude.ai connector and a
    user-scope entry alike);
  - `permissions.ask` for both Bash and PowerShell commands that spend or publish: `hf jobs`,
    `hf endpoints`, `hf sandbox`, `hf spaces`, `hf repos`, `hf upload`,
    `hf upload-large-folder`, `hf cp`, `hf sync`, `hf buckets`,
    `hf collections`, `hf discussions`, `hf webhooks`;
  - `permissions.deny` in both Bash and PowerShell for `hf auth token`, which
    prints the stored token. Claude Code treats these as separate tools, so
    each has its own rules. The deny matches the direct form only, not the
    program by path or inside a subshell (docs, "What a Bash rule doesn't
    match"); the rule in `AGENTS.md` is what forbids it.

An ask rule prompts in every permission mode, including `bypassPermissions`
([docs](https://code.claude.com/docs/en/permission-modes)). The file declares
no `extraKnownMarketplaces`: HF's marketplace holds only the `hf-cli` plugin,
which would duplicate the installer's skill.
