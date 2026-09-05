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
tool-agnostic location the `skills` CLI installs to. Manage them with
`npx skills`; `skills-lock.json` pins each skill to its source and content hash.
