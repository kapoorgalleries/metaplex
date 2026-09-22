#!/usr/bin/env bash
# Install Claude Code, OpenAI Codex CLI and Gemini CLI on this macOS or Linux
# machine. Claude Code and Codex are native binaries put in place by their
# official installers (npm is the fallback for Codex); Gemini CLI is an npm
# package, so Node.js 20+ is installed for it. Idempotent: rerun to upgrade.
# Run it on the target, or push it to every host with run-remote.sh.
#
# Usage: bootstrap-ai-clis.sh [--skip-claude] [--skip-codex] [--skip-gemini] [--skip-node]
set -eu

SKIP_CLAUDE=0; SKIP_CODEX=0; SKIP_GEMINI=0; SKIP_NODE=0
for a in "$@"; do
  case "$a" in
    --skip-claude) SKIP_CLAUDE=1 ;;
    --skip-codex)  SKIP_CODEX=1 ;;
    --skip-gemini) SKIP_GEMINI=1 ;;
    --skip-node)   SKIP_NODE=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
OS="$(uname -s)"
SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"

# Put a directory on PATH now and in the shell rc files, once.
ensure_path() {
  case ":$PATH:" in *":$1:"*) ;; *) PATH="$1:$PATH"; export PATH ;; esac
  if [ "$OS" = "Darwin" ]; then touch "$HOME/.zshrc"; else touch "$HOME/.bashrc"; fi
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    grep -qs "$1" "$rc" || printf '\n# added by ops/network/scripts/bootstrap-ai-clis.sh\nexport PATH="%s:$PATH"\n' "$1" >> "$rc"
  done
}

node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; }

install_node() {
  if node_ok; then log "node $(node --version) present"; return 0; fi
  log "installing Node.js 22 (Gemini CLI needs 20+)"
  if [ "$OS" = "Darwin" ]; then
    have brew || { warn "Homebrew is missing. Install it from https://brew.sh, then rerun."; return 1; }
    brew install node >/dev/null 2>&1 || brew upgrade node >/dev/null 2>&1 || true
  elif have apt-get; then
    $SUDO apt-get install -y -qq ca-certificates curl gnupg >/dev/null
    if [ -n "$SUDO" ]; then curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - >/dev/null
    else curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null; fi
    $SUDO apt-get install -y -qq nodejs >/dev/null
  elif have dnf;    then $SUDO dnf install -y nodejs npm >/dev/null
  elif have pacman; then $SUDO pacman -Sy --noconfirm nodejs npm >/dev/null
  elif have zypper; then $SUDO zypper install -y nodejs22 npm22 >/dev/null
  elif have apk;    then $SUDO apk add nodejs npm >/dev/null
  else warn "no known package manager. Install Node 20+ from https://nodejs.org and rerun."; return 1; fi
  node_ok || { warn "node is still missing or older than 20 (have: $(node --version 2>/dev/null || echo none))"; return 1; }
  log "node $(node --version) installed"
}

# Global npm installs without sudo: use ~/.npm-global when the default prefix is root-owned.
setup_npm_prefix() {
  local prefix; prefix="$(npm prefix -g 2>/dev/null || true)"
  if [ -n "$prefix" ] && { [ -w "$prefix/lib/node_modules" ] || [ -w "$prefix/lib" ]; }; then
    ensure_path "$prefix/bin"; return 0
  fi
  log "npm global dir is not writable; switching to ~/.npm-global (never sudo npm)"
  mkdir -p "$HOME/.npm-global"
  npm config set prefix "$HOME/.npm-global"
  ensure_path "$HOME/.npm-global/bin"
}

install_claude() {
  if have claude; then
    log "claude present ($(claude --version 2>/dev/null | head -1)); checking for an update"
    claude update >/dev/null 2>&1 || true
    return 0
  fi
  log "installing Claude Code (native installer, auto-updates itself)"
  curl -fsSL https://claude.ai/install.sh | bash
  ensure_path "$HOME/.local/bin"
}

install_codex() {
  if have codex; then
    log "codex present ($(codex --version 2>/dev/null | head -1)); checking for an update"
    codex update >/dev/null 2>&1 || true
    return 0
  fi
  log "installing Codex CLI (official installer, self-updates with 'codex update')"
  if curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh; then
    ensure_path "$HOME/.local/bin"
  elif have npm; then
    warn "installer failed; falling back to npm"
    npm install -g --no-fund --no-audit @openai/codex@latest >/dev/null
  else
    warn "Codex install failed and npm is not available; rerun after fixing network access to chatgpt.com"
  fi
}

install_gemini() { log "installing/updating Gemini CLI (npm)"; npm install -g --no-fund --no-audit @google/gemini-cli@latest >/dev/null; }

have curl || { warn "curl is required"; exit 1; }
[ "$SKIP_CLAUDE" = 1 ] || install_claude
[ "$SKIP_CODEX" = 1 ]  || install_codex
if [ "$SKIP_GEMINI" = 0 ]; then
  if [ "$SKIP_NODE" = 1 ] || install_node; then
    if node_ok; then setup_npm_prefix; install_gemini; fi
  fi
fi

log "versions on $(hostname -s) ($OS):"
for c in node claude codex gemini; do
  if have "$c"; then printf '  %-7s %s\n' "$c" "$("$c" --version 2>&1 | head -1)"; else printf '  %-7s MISSING\n' "$c"; fi
done
cat <<'EOF'

Sign in once per machine, per user (open a NEW terminal first so PATH is fresh):
  claude   run `claude` (or `claude auth login`). A browser opens; over SSH press `c` to copy the
           URL, open it on any machine, then paste the code back at "Paste code here if prompted".
           No browser anywhere: `claude setup-token` on any machine with a browser prints a one-year
           token (Pro/Max/Team/Enterprise; model requests only), then here:
           export CLAUDE_CODE_OAUTH_TOKEN=<token>
           check:  claude auth status     install health:  claude doctor
           (Over SSH on a Mac the Keychain is locked, so the login lands in ~/.claude/.credentials.json
           with mode 600 instead. That is expected.)
  codex    run `codex login` (browser). Over SSH: `codex login --device-auth` (turn on device-code
           sign-in under ChatGPT Settings > Security first), or forward the callback port from the
           machine with the browser:  ssh -L 1455:localhost:1455 <this-host>  then `codex login`.
           API key:  printenv OPENAI_API_KEY | codex login --with-api-key
           (exporting OPENAI_API_KEY on its own is not a login)
           check:  codex login status     credentials: ~/.codex/auth.json
  gemini   run `gemini` and choose "Sign in with Google". Over SSH run  NO_BROWSER=true gemini
           and paste the code back. Google Workspace account (not personal Gmail): first
           export GOOGLE_CLOUD_PROJECT=<project-id>; personal Gmail must leave it unset.
           API key instead:  export GEMINI_API_KEY=<key>   (https://aistudio.google.com/app/apikey)
EOF
