#!/usr/bin/env bash
# One command on the admin machine: bring the network kit up to date, then start
# the agent that runs the job: Claude Code by default, or Codex with --codex.
# One agent owns the job at a time; status.md is how the next one picks it up.
#
# First time, in a terminal on the admin machine (git asks for your GitHub
# sign-in; only ops/network and reports are checked out):
#   git clone --filter=blob:none --sparse -b claude/beautiful-turing-abqvwm \
#     https://github.com/kapoorgalleries/metaplex.git ~/trimurti-network
#   git -C ~/trimurti-network sparse-checkout set ops/network reports
#   ~/trimurti-network/ops/network/launch.sh
# After that, run launch.sh again; it updates the kit first.
#
# Claude starts with Remote Control on, so the session also shows up in the
# Claude app (desktop and phone) and can be answered from anywhere.
#
# Before the agent starts, the admin key (~/.ssh/id_ed25519_trimurti) is made
# ready here, where you can type: created if missing (you choose a passphrase
# or none), and a key with a passphrase is loaded into an ssh-agent (macOS: the
# Keychain). The agent's shells cannot type a passphrase; they inherit the
# ssh-agent. If the agent later reports "no ssh-agent holds it", run this again.
# Node.js 20+ is installed if missing, for the trimurti-ops MCP server.
#
# Usage: launch.sh [--codex] [--local] [--no-pull] [--dry-run] [-h|--help]
#   --codex    hand the job to Codex instead (runs start-codex.sh)
#   --local    Claude in this terminal only, without Remote Control
#   --no-pull  start with the kit as it is, without updating it
#   --dry-run  print what would happen and change nothing
set -eu

OPS="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$OPS/scripts/lib.sh"   # load_admin_key; the functions below replace its log, warn and have
REPO="$(git -C "$OPS" rev-parse --show-toplevel 2>/dev/null || true)"
AGENT=claude; REMOTE=1; PULL=1; DRY=0

usage() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; }
for a in "$@"; do
  case "$a" in
    --codex)   AGENT=codex ;;
    --local)   REMOTE=0 ;;
    --no-pull) PULL=0 ;;
    --dry-run) DRY=1 ;;
    -h|--help) usage; exit 0 ;;
    *)         printf 'unknown option: %s\n\n' "$a" >&2; usage >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }
run()  { if [ "$DRY" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# 1. Update the kit. inventory.csv and status.md hold this site's real data and
#    are never committed: back them up to out/ (git-ignored), pull with
#    autostash, and if the templates changed underneath them, keep Sanjay's copy.
if [ "$PULL" = 1 ] && [ -n "$REPO" ]; then
  bak="$OPS/out/backup-$(date +%Y%m%d-%H%M%S)"
  run mkdir -p "$bak"
  for f in inventory.csv status.md; do
    if [ -f "$OPS/$f" ]; then run cp -p "$OPS/$f" "$bak/$f"; fi
  done
  log "updating the kit (backup of inventory.csv and status.md in ${bak#"$OPS"/})"
  if [ "$DRY" = 0 ]; then
    # start-codex.sh marks the two files skip-worktree, which would block the pull.
    sw="$(git -C "$REPO" ls-files -v -- ops/network/inventory.csv ops/network/status.md | awk '/^S /{print $2}')"
    # shellcheck disable=SC2086  # repo-relative paths without spaces
    if [ -n "$sw" ]; then git -C "$REPO" update-index --no-skip-worktree $sw; fi
    if ! git -C "$REPO" pull --ff-only --autostash -q; then
      warn "could not update the kit (network, sign-in or local commits); starting with the version already here"
    fi
    if [ -n "$(git -C "$REPO" diff --name-only --diff-filter=U)" ]; then
      for f in inventory.csv status.md; do
        git -C "$REPO" checkout HEAD -- "ops/network/$f" 2>/dev/null || true
        if [ -f "$bak/$f" ]; then cp -p "$bak/$f" "$OPS/$f"; fi
      done
      git -C "$REPO" stash drop -q 2>/dev/null || true
      warn "the inventory/status templates changed upstream; your copies were kept as they were (compare: git diff)"
    fi
    # shellcheck disable=SC2086
    if [ -n "$sw" ]; then git -C "$REPO" update-index --skip-worktree $sw; fi
  fi
fi

PROMPT="Read AGENTS.md and status.md, then run the Trimurti network job from where status.md leaves off (step 0 if it is empty). Ask me the up-front questions in one message and start step 0 while I answer. Before any step that changes a machine, update the kit with: git pull --ff-only --autostash"

# 2a. Codex: start-codex.sh installs, signs in, registers the MCP server and starts it.
if [ "$AGENT" = codex ]; then
  log "handing the job to Codex"
  if [ "$DRY" = 1 ]; then exec bash "$OPS/start-codex.sh" --dry-run; fi
  exec bash "$OPS/start-codex.sh"
fi

# 2b. Claude Code.
if ! have claude; then
  log "Claude Code is not installed; installing it with the kit's bootstrap (Claude only)"
  run bash "$OPS/scripts/bootstrap-ai-clis.sh" --skip-codex --skip-gemini --skip-node
  hash -r
fi
if [ "$DRY" = 0 ] && ! have claude; then warn "claude is still not on PATH; open a new terminal and rerun"; exit 1; fi

node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]; }
if ! node_ok; then
  log "Node.js 20+ is missing; installing it for the trimurti-ops MCP server (Node only)"
  run bash "$OPS/scripts/bootstrap-ai-clis.sh" --skip-claude --skip-codex --skip-gemini --with-node || warn "the Node.js install reported a problem (see above)"
  hash -r
fi
if node_ok; then
  if [ ! -f "$OPS/mcp/dist/index.js" ] || [ -n "$(find "$OPS/mcp/src" -newer "$OPS/mcp/dist/index.js" -print -quit 2>/dev/null)" ]; then
    log "building the trimurti-ops MCP server"
    run npm --prefix "$OPS/mcp" install --no-audit --no-fund
    run npm --prefix "$OPS/mcp" run build
  fi
  log "registering trimurti-ops with Claude Code"
  if [ "$DRY" = 0 ]; then claude mcp remove --scope user trimurti-ops >/dev/null 2>&1 || true; fi
  run claude mcp add --scope user trimurti-ops --env "TRIMURTI_OPS_DIR=$OPS" -- node "$OPS/mcp/dist/index.js"
else
  warn "Node 20+ not found, so the trimurti-ops MCP server is skipped; Claude will call the scripts directly"
fi

# 3. The admin key, while this terminal can still take a passphrase.
load_admin_key "$DRY"

cd "$OPS"
if [ "$REMOTE" = 1 ]; then set -- --remote-control trimurti-network "$PROMPT"; else set -- "$PROMPT"; fi
if [ "$REMOTE" = 1 ]; then
  log "starting Claude Code in $OPS (Remote Control on: it also appears in the Claude app as trimurti-network)"
else
  log "starting Claude Code in $OPS"
fi
if [ "$DRY" = 1 ]; then printf '  [dry-run] claude'; printf ' %q' "$@"; printf '\n'; exit 0; fi
# An ssh-agent started by load_admin_key lives as long as Claude does.
if [ "$ADMIN_AGENT_STARTED" = 1 ]; then trap 'ssh-agent -k >/dev/null 2>&1' EXIT; claude "$@"; exit; fi
exec claude "$@"
