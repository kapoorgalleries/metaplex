#!/usr/bin/env bash
# Install Claude Code, OpenAI Codex CLI, Gemini CLI and the Hugging Face CLI
# (hf) on this macOS or Linux machine, and register Hugging Face's MCP server
# with Codex and Gemini. Claude Code and Codex are native binaries put in place
# by their official installers (npm is the fallback for Codex); Gemini CLI is an
# npm package, so Node.js 20+ is installed for it; hf comes from its official
# installer, which needs Python 3.10+. Idempotent: rerun to upgrade.
# Run it on the target, or push it to every host with run-remote.sh.
#
# Usage: bootstrap-ai-clis.sh [--skip-claude] [--skip-codex] [--skip-gemini] [--skip-node]
#                             [--skip-hf] [--with-claude-hf-mcp]
#   --skip-hf             no hf CLI and no Hugging Face MCP registration
#   --with-claude-hf-mcp  also register the Hugging Face MCP server with Claude Code (see register_hf_mcp)
set -eu

SKIP_CLAUDE=0; SKIP_CODEX=0; SKIP_GEMINI=0; SKIP_NODE=0; SKIP_HF=0; CLAUDE_HF_MCP=0
for a in "$@"; do
  case "$a" in
    --skip-claude) SKIP_CLAUDE=1 ;;
    --skip-codex)  SKIP_CODEX=1 ;;
    --skip-gemini) SKIP_GEMINI=1 ;;
    --skip-node)   SKIP_NODE=1 ;;
    --skip-hf)     SKIP_HF=1 ;;
    --with-claude-hf-mcp) CLAUDE_HF_MCP=1 ;;
    -h|--help)     sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
OS="$(uname -s)"
SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"
# hf prints a once-a-day update/skill hint on stderr before its output, which the version table
# would read instead of the version. This only silences the hints; `hf update` still checks PyPI.
export HF_HUB_DISABLE_UPDATE_CHECK=1

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

# The hf installer builds a venv, so it needs Python 3.10+ with venv and ensurepip, and installs
# neither. Debian/Ubuntu ship ensurepip in python3-venv, which desktop installs often lack.
py_ok() {
  for p in python3 python; do
    have "$p" && "$p" -c 'import sys, ensurepip, venv; sys.exit(sys.version_info < (3, 10))' >/dev/null 2>&1 && return 0
  done
  return 1
}

# Hugging Face CLI through its official installer: a venv in ~/.hf-cli, hf linked into ~/.local/bin.
# The installer also runs `hf skills add hf-cli --global`, which writes the hf-cli agent skill to
# ~/.agents/skills (read by Codex and Gemini) and links it into ~/.claude/skills, so there is no
# separate skill step; `hf update` refreshes the skill with the CLI. No pip fallback: the installer
# is itself a venv plus pip, so whatever stops it stops pip too, and Debian/Ubuntu's system pip
# refuses global installs (PEP 668).
install_hf() {
  # A non-login SSH session can lack ~/.local/bin, and on a Mac Homebrew's bin (the stock python3 is 3.9).
  PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH
  if have hf; then
    log "hf present ($(hf --version 2>/dev/null | head -1)); checking for an update"
    hf update >/dev/null 2>&1 || true
    # hf update never re-adds a skill that was skipped or removed; a pip or brew install never had it.
    [ -d "$HOME/.agents/skills/hf-cli" ] || warn "the hf-cli agent skill is not installed; add it with: hf skills add --global"
    return 0
  fi
  if ! py_ok; then
    log "installing Python 3 with venv (the hf installer needs 3.10+)"
    if [ "$OS" = "Darwin" ]; then { have brew && brew install python >/dev/null 2>&1; } || true
    elif have apt-get; then { $SUDO apt-get update -qq && $SUDO apt-get install -y -qq python3 python3-venv; } >/dev/null 2>&1 || true
    elif have dnf;    then $SUDO dnf install -y python3 >/dev/null 2>&1 || true
    elif have pacman; then $SUDO pacman -S --needed --noconfirm python >/dev/null 2>&1 || true
    fi
    py_ok || { warn "hf needs Python 3.10+ with venv (have: $(python3 --version 2>&1 || echo none)); install it and rerun"; return 0; }
  fi
  log "installing Hugging Face CLI (official installer; also installs the hf-cli agent skill)"
  # --no-modify-path: ensure_path owns the rc files, as for the other CLIs. `have hf` catches a
  # failed download, after which bash reads an empty script and exits 0.
  if curl -LsSf https://hf.co/cli/install.sh | bash -s -- --no-modify-path && have hf; then
    ensure_path "$HOME/.local/bin"
  else
    warn "hf install failed; rerun after fixing access to hf.co and pypi.org"
  fi
}

# Hugging Face's MCP server, user scope, added only when missing so a hand-made entry is never
# replaced. The auth follows what each client can do:
#  - codex:  OAuth (the ?login URL); sign in once with `codex mcp login huggingface`. The table is
#            appended rather than written by `codex mcp add`, because add starts a browser OAuth
#            flow as soon as it detects OAuth support and would hang this unattended run
#            (codex-rs/cli/src/mcp_cmd.rs, rust-v0.156.1). A later `codex mcp add` keeps the table.
#  - gemini: its OAuth needs a browser and a localhost callback on this machine, which SSH sessions
#            lack, so it sends `Authorization: Bearer ${HF_TOKEN}`. Gemini expands the variable
#            when it loads settings; unset, it is empty and HF serves its anonymous read-only tools.
#  - claude: not by default. A claude.ai login already brings the account's Hugging Face connector,
#            and a server added in Claude Code at the same URL takes precedence and hides it, while
#            a different URL loads the same tools twice (code.claude.com/docs/en/mcp, "Use MCP
#            servers from claude.ai"). --with-claude-hf-mcp is for machines signed in with
#            `claude setup-token` or an API key, which never fetch connectors.
# HF's URL presets only choose which tools are advertised, so the tools that create repos or can
# spend money (hf_jobs, create_repo, dynamic_space, the sandboxes) are removed in each client:
# disabled_tools (codex), excludeTools (gemini). Claude Code has no per-server filter in `claude mcp add`.
HF_MCP_URL="https://huggingface.co/mcp"
HF_DENY="hf_jobs create_repo dynamic_space hf_sandbox hf_sandbox_exec hf_sandbox_fs"
register_hf_mcp() {
  local cfg list="" t out
  if [ "$SKIP_CODEX" = 0 ] && have codex; then
    cfg="${CODEX_HOME:-$HOME/.codex}/config.toml"
    if codex mcp get huggingface >/dev/null 2>&1 || grep -Eqs '^[[:space:]]*\[mcp_servers\."?huggingface"?[[:space:]]*\]' "$cfg"; then
      log "codex: huggingface MCP server already configured; left as is"
    else
      for t in $HF_DENY; do list="${list:+$list, }\"$t\""; done
      mkdir -p "$(dirname "$cfg")"
      printf '\n# Hugging Face MCP (ops/network bootstrap). Sign in once: codex mcp login huggingface\n[mcp_servers.huggingface]\nurl = "%s?login"\ndisabled_tools = [%s]\n' "$HF_MCP_URL" "$list" >> "$cfg"
      log "codex: added the huggingface MCP server"
    fi
  fi
  if [ "$SKIP_GEMINI" = 0 ] && have gemini; then
    if grep -Eqs '"huggingface"[[:space:]]*:' "$HOME/.gemini/settings.json"; then
      log "gemini: huggingface MCP server already configured; left as is"
    else
      # Options go after the two positionals: --exclude-tools takes several values and would swallow them.
      # shellcheck disable=SC2016,SC2086  # ${HF_TOKEN} is for Gemini to expand; $HF_DENY splits into one value per tool
      if out="$(gemini mcp add -s user -t http huggingface "$HF_MCP_URL" -H 'Authorization: Bearer ${HF_TOKEN}' --exclude-tools $HF_DENY 2>&1)"; then
        log "gemini: added the huggingface MCP server"
      else
        warn "gemini mcp add failed: $out"
      fi
    fi
  fi
  if [ "$CLAUDE_HF_MCP" = 1 ] && [ "$SKIP_CLAUDE" = 0 ] && have claude; then
    if out="$(claude mcp add --scope user --transport http huggingface "$HF_MCP_URL?login" 2>&1)"; then
      log "claude: added the huggingface MCP server"
    else
      case "$out" in
        *"already exists"*) log "claude: huggingface MCP server already configured; left as is" ;;
        *) warn "claude mcp add failed: $out" ;;
      esac
    fi
  fi
}

have curl || { warn "curl is required"; exit 1; }
if [ "$OS" = "Linux" ] && [ -r /proc/cpuinfo ] && ! grep -qw avx /proc/cpuinfo; then
  warn "this CPU has no AVX; Claude Code's native binary needs it (pre-2013 hardware). Skipping Claude Code on this machine."
  SKIP_CLAUDE=1
fi
[ "$SKIP_CLAUDE" = 1 ] || install_claude
[ "$SKIP_CODEX" = 1 ]  || install_codex
if [ "$SKIP_GEMINI" = 0 ]; then
  if [ "$SKIP_NODE" = 1 ] || install_node; then
    if node_ok; then setup_npm_prefix; install_gemini; fi
  fi
fi
if [ "$SKIP_HF" = 0 ]; then install_hf; register_hf_mcp; fi

log "versions on $(hostname -s) ($OS):"
for c in node claude codex gemini hf; do
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
           with mode 600 instead. That is expected. If ANTHROPIC_API_KEY is set in the environment,
           Claude Code bills that key instead of the subscription: unset it on these machines.)
  codex    run `codex login` (browser). Over SSH: `codex login --device-auth` (turn on device-code
           sign-in under ChatGPT Settings > Security first), or forward the callback port from the
           machine with the browser:  ssh -L 1455:localhost:1455 <this-host>  then `codex login`.
           API key:  printenv OPENAI_API_KEY | codex login --with-api-key
           (exporting OPENAI_API_KEY on its own is not a login)
           check:  codex login status     credentials: ~/.codex/auth.json
  gemini   run `gemini` and choose "Sign in with Google". Over SSH (with a terminal: ssh -t) run
           NO_BROWSER=true gemini  and paste the code back within 5 minutes. Google Workspace account (not personal Gmail): first
           export GOOGLE_CLOUD_PROJECT=<project-id>; personal Gmail must leave it unset.
           API key instead:  export GEMINI_API_KEY=<key>   (https://aistudio.google.com/app/apikey)
  hf       run `hf auth login` (over SSH: ssh -t). "Log in with your browser" prints a URL and a code:
           open the URL on any machine and enter the code. "Paste an access token" reads a token at a
           hidden prompt: make one per machine at https://huggingface.co/settings/tokens > New token,
           role Read (all that downloads and the MCP server need; never Write).
           check:  hf auth whoami     (HF_TOKEN in the environment overrides the stored login)
  HF MCP   codex   codex mcp login huggingface   (over SSH: ssh -t, add --no-browser, open the URL on
                   any machine, paste the redirect URL back)
           gemini  sends $HF_TOKEN as its bearer token; unset, it gets HF's anonymous read-only tools.
                   Start it with the token hf already stored, so it is never typed or copied to a file:
                   HF_TOKEN="$(hf auth token)" gemini
                   Gemini loads MCP servers only in folders it trusts (it asks on the first run there).
           claude  the account's Hugging Face connector comes with the claude.ai login (/mcp lists it).
                   Signed in with setup-token or an API key? Rerun this script with --with-claude-hf-mcp,
                   then  claude mcp login huggingface   (--no-browser over SSH)
           Which tools every client sees is set per account at https://huggingface.co/settings/mcp:
           keep Jobs, Contribute Repos, Sandboxes and Dynamic Spaces off (they create repos, run code
           or can spend credits).
EOF
