#!/usr/bin/env bash
# One command to hand the network job to Codex on this admin machine (macOS or
# Linux; on Windows use start-codex.ps1). It:
#   1. installs Codex if it is missing (the kit's own bootstrap, Codex only),
#   2. signs Codex in if it is not signed in,
#   3. builds the trimurti-ops MCP server and registers it with Codex (installs
#      Node 20+ first if it is missing),
#   4. keeps inventory.csv and status.md out of commits (git skip-worktree),
#   5. makes the admin key ready here, where you can type: creates it if missing
#      and loads a key with a passphrase into an ssh-agent (macOS: the Keychain),
#      which Codex and its shells inherit (they cannot type a passphrase),
#   6. starts Codex in ops/network, where it loads AGENTS.md as its instructions.
#
# Default permissions: full access to this machine, and Codex asks before
# anything it judges risky. The work needs network access, sudo and ~/.ssh,
# which Codex's workspace sandbox blocks. AGENTS.md lists what always needs
# Sanjay's yes. --sandboxed keeps the workspace sandbox but lets network through
# and makes ~/.ssh writable; expect more approval prompts.
#
# Usage: ./start-codex.sh [--sandboxed] [--no-mcp] [--dry-run] [--] [extra words for the first prompt]
#   --dry-run shows what it would do and changes nothing; -h/--help prints this.
#   Any other flag exits 2. Words after -- go to the prompt even if they start with -.
set -eu

OPS="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$OPS/scripts/lib.sh"   # load_admin_key; the functions below replace its log, warn and have
usage() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; }
SANDBOXED=0; NO_MCP=0; DRY=0; EXTRA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sandboxed) SANDBOXED=1 ;;
    --no-mcp)    NO_MCP=1 ;;
    --dry-run)   DRY=1 ;;
    -h|--help)   usage; exit 0 ;;
    --)          shift; [ $# -eq 0 ] || EXTRA="${EXTRA:+$EXTRA }$*"; break ;;
    -*)          printf 'unknown flag: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    *)           EXTRA="${EXTRA:+$EXTRA }$1" ;;
  esac
  shift
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
run()  { if [ "$DRY" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# 1. Codex installed
if ! have codex; then
  log "Codex is not installed; installing it with the kit's bootstrap (Codex only)"
  run bash "$OPS/scripts/bootstrap-ai-clis.sh" --skip-claude --skip-gemini || warn "the bootstrap reported a problem (see above)"
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
node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]; }
if [ "$NO_MCP" = 0 ] && ! node_ok; then
  log "Node.js 20+ is missing; installing it for the trimurti-ops MCP server (Node only)"
  run bash "$OPS/scripts/bootstrap-ai-clis.sh" --skip-claude --skip-codex --skip-gemini --with-node || warn "the Node.js install reported a problem (see above)"
  hash -r
fi
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

# 4. With real data these two map the gallery's network: keep them out of 'git commit -a'
if git -C "$OPS" ls-files -v -- inventory.csv status.md 2>/dev/null | grep -q '^H'; then
  log "marking inventory.csv and status.md skip-worktree so commits leave them out (undo: git update-index --no-skip-worktree inventory.csv status.md)"
  run git -C "$OPS" update-index --skip-worktree -- inventory.csv status.md
fi

# 5. The admin key, while this terminal can still take a passphrase.
load_admin_key "$DRY"

# 6. Start Codex
PROMPT="Read AGENTS.md and status.md, then run the Trimurti network job from where status.md leaves off (step 0 if it is empty). Ask me the up-front questions in one message and start step 0 while I answer."
[ -n "$EXTRA" ] && PROMPT="$PROMPT $EXTRA"
if [ "$SANDBOXED" = 1 ]; then
  set -- -C "$OPS" -s workspace-write -a on-request -c sandbox_workspace_write.network_access=true --add-dir "$HOME/.ssh"
else
  set -- -C "$OPS" -s danger-full-access -a on-request
fi
log "starting Codex in $OPS (resume later with: codex resume --last)"
if [ "$DRY" = 1 ]; then printf '  [dry-run] codex'; printf ' %q' "$@" "$PROMPT"; printf '\n'; exit 0; fi
# An ssh-agent started by load_admin_key lives as long as Codex does.
if [ "$ADMIN_AGENT_STARTED" = 1 ]; then trap 'ssh-agent -k >/dev/null 2>&1' EXIT; codex "$@" "$PROMPT"; exit; fi
exec codex "$@" "$PROMPT"
