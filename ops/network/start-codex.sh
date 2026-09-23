#!/usr/bin/env bash
# One command to hand the network job to Codex on this admin machine (macOS or
# Linux; on Windows use start-codex.ps1). It:
#   1. installs Codex if it is missing (the kit's own bootstrap, Codex only),
#   2. signs Codex in if it is not signed in,
#   3. builds the trimurti-ops MCP server and registers it with Codex (needs Node 20+),
#   4. starts Codex in ops/network, where it loads AGENTS.md as its instructions.
#
# Default permissions: full access to this machine, and Codex asks before
# anything it judges risky. The work needs network access, sudo and ~/.ssh,
# which Codex's workspace sandbox blocks. AGENTS.md lists what always needs
# Sanjay's yes. --sandboxed keeps the workspace sandbox but lets network through
# and makes ~/.ssh writable; expect more approval prompts.
#
# Usage: ./start-codex.sh [--sandboxed] [--no-mcp] [--dry-run] [extra words for the first prompt]
set -eu

OPS="$(cd "$(dirname "$0")" && pwd)"
SANDBOXED=0; NO_MCP=0; DRY=0; EXTRA=""
for a in "$@"; do
  case "$a" in
    --sandboxed) SANDBOXED=1 ;;
    --no-mcp)    NO_MCP=1 ;;
    --dry-run)   DRY=1 ;;
    -h|--help)   sed -n '2,17p' "$0"; exit 0 ;;
    *)           EXTRA="${EXTRA:+$EXTRA }$a" ;;
  esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
run()  { if [ "$DRY" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# 1. Codex installed
if ! have codex; then
  log "Codex is not installed; installing it with the kit's bootstrap (Codex only)"
  run bash "$OPS/scripts/bootstrap-ai-clis.sh" --skip-claude --skip-gemini
  [ "$DRY" = 1 ] || have codex || { warn "codex still not on PATH; open a new terminal and rerun"; exit 1; }
fi
[ "$DRY" = 1 ] && ! have codex && { warn "dry run: codex not found, stopping here"; exit 0; }
log "codex $(codex --version 2>/dev/null | head -1)"

# 2. Codex signed in
if codex login status >/dev/null 2>&1; then
  log "Codex is signed in"
elif [ -n "${SSH_CONNECTION:-}" ]; then
  log "signing Codex in with a device code (turn on device-code sign-in under ChatGPT Settings > Security first)"
  run codex login --device-auth
else
  log "signing Codex in (a browser opens)"
  run codex login
fi

# 3. trimurti-ops MCP server
node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; }
if [ "$NO_MCP" = 1 ]; then
  log "skipping the MCP server (--no-mcp); Codex will call the scripts directly"
elif ! node_ok; then
  warn "Node 20+ not found, so the trimurti-ops MCP server is skipped; Codex will call the scripts directly"
else
  if [ ! -f "$OPS/mcp/dist/index.js" ] || [ -n "$(find "$OPS/mcp/src" -newer "$OPS/mcp/dist/index.js" -print -quit 2>/dev/null)" ]; then
    log "building the trimurti-ops MCP server"
    run npm --prefix "$OPS/mcp" install --no-audit --no-fund
    run npm --prefix "$OPS/mcp" run build
  fi
  log "registering trimurti-ops with Codex"
  if [ "$DRY" = 0 ]; then codex mcp remove trimurti-ops >/dev/null 2>&1 || true; fi
  run codex mcp add trimurti-ops --env "TRIMURTI_OPS_DIR=$OPS" -- node "$OPS/mcp/dist/index.js"
fi

# 4. Start Codex
PROMPT="Read AGENTS.md and status.md, then run the Trimurti network job from where status.md leaves off (step 0 if it is empty). Ask me the up-front questions in one message and start step 0 while I answer."
[ -n "$EXTRA" ] && PROMPT="$PROMPT $EXTRA"
if [ "$SANDBOXED" = 1 ]; then
  set -- -C "$OPS" -s workspace-write -a on-request -c sandbox_workspace_write.network_access=true --add-dir "$HOME/.ssh"
else
  set -- -C "$OPS" -s danger-full-access -a on-request
fi
log "starting Codex in $OPS (resume later with: codex resume --last)"
if [ "$DRY" = 1 ]; then printf '  [dry-run] codex'; printf ' %q' "$@" "$PROMPT"; printf '\n'; exit 0; fi
exec codex "$@" "$PROMPT"
