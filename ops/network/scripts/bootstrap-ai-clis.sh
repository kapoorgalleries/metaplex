#!/usr/bin/env bash
# Install Claude Code, OpenAI Codex CLI, Gemini CLI and the Hugging Face CLI
# (hf) on this macOS or Linux machine, and register Hugging Face's MCP server
# with Codex and Gemini. Claude Code and Codex are native binaries put in place
# by their official installers (npm is the fallback for Codex); Gemini CLI is an
# npm package, so Node.js 20+ is installed for it; hf comes from its official
# installer, which needs Python 3.10+. Idempotent: rerun to upgrade.
# Run it on the target, or push it to every host with run-remote.sh (add --tty
# there when sudo on the host asks for a password).
#
# The CLIs are put on the PATH of later shells, including a plain
# 'ssh <host> claude': zsh reads ~/.zshenv, and Debian/Ubuntu/Fedora bash read
# ~/.bashrc, where the line goes above the stock "not interactive: return"
# guard. A shell that reads neither for ssh commands (Arch's bash) gets links in
# /usr/local/bin instead.
#
# Exit: 0 when every requested CLI is installed and a plain ssh command finds
# it, 1 when something failed (the last line says what), 2 on bad arguments.
#
# Usage: bootstrap-ai-clis.sh [--skip-claude] [--skip-codex] [--skip-gemini] [--skip-node] [--with-node]
#                             [--skip-hf] [--with-claude-hf-mcp]
set -u

usage() {
  cat <<'EOF'
Usage: bootstrap-ai-clis.sh [--skip-claude] [--skip-codex] [--skip-gemini] [--skip-node] [--with-node]
                            [--skip-hf] [--with-claude-hf-mcp]
Installs or updates Claude Code, Codex CLI, Gemini CLI and the Hugging Face CLI (hf; Node.js 20+
for Gemini, Python 3.10+ for hf), and registers Hugging Face's MCP server with Codex and Gemini.
  --skip-claude|--skip-codex|--skip-gemini   leave that CLI alone
  --skip-hf             no hf CLI and no Hugging Face MCP registration
  --with-claude-hf-mcp  also register the Hugging Face MCP server with Claude Code (see register_hf_mcp)
  --skip-node   never install Node.js (Gemini then needs Node 20+ already)
  --with-node   install Node.js 20+ even when Gemini is skipped (the trimurti-ops
                MCP server needs it on the admin machine)
  -h, --help    this text
Exit: 0 all requested CLIs installed and on the PATH of a plain 'ssh <host> <cli>',
      1 something failed (see the last line), 2 bad arguments.
EOF
}

SKIP_CLAUDE=0; SKIP_CODEX=0; SKIP_GEMINI=0; SKIP_NODE=0; WITH_NODE=0; SKIP_HF=0; CLAUDE_HF_MCP=0
for a in "$@"; do
  case "$a" in
    --skip-claude) SKIP_CLAUDE=1 ;;
    --skip-codex)  SKIP_CODEX=1 ;;
    --skip-gemini) SKIP_GEMINI=1 ;;
    --skip-node)   SKIP_NODE=1 ;;
    --with-node)   WITH_NODE=1 ;;
    --skip-hf)     SKIP_HF=1 ;;
    --with-claude-hf-mcp) CLAUDE_HF_MCP=1 ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "unknown flag: $a" >&2; usage >&2; exit 2 ;;
  esac
done
if [ "$SKIP_NODE" = 1 ] && [ "$WITH_NODE" = 1 ]; then
  echo "--skip-node and --with-node contradict each other" >&2; usage >&2; exit 2
fi

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
OS="$(uname -s)"
HOST="$(uname -n)"; HOST="${HOST%%.*}"
ME="$(id -un)"
SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"
FAILED=""
failed() { FAILED="$FAILED $1"; }
# hf prints a once-a-day update/skill hint on stderr before its output, which the version table
# would read instead of the version. This only silences the hints; `hf update` still checks PyPI.
export HF_HUB_DISABLE_UPDATE_CHECK=1
# An ssh command starts with a bare PATH: look where earlier runs, npm and Homebrew put things.
[ "$OS" = "Darwin" ] && PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
if have npm; then
  p="$(npm prefix -g 2>/dev/null)/bin"
  case ":$PATH:" in *":$p:"*) ;; *) PATH="$PATH:$p" ;; esac
fi
# The PATH sshd hands a plain 'ssh <host> cmd' before the shell's own files run.
if [ "$OS" = "Darwin" ]; then SSH_PATH=/usr/bin:/bin:/usr/sbin:/sbin; else SSH_PATH=/usr/local/bin:/usr/bin:/bin; fi
LOGIN_SHELL="${SHELL:-}"
[ -n "$LOGIN_SHELL" ] || LOGIN_SHELL="$(getent passwd "$ME" 2>/dev/null | cut -d: -f7)"
[ -n "$LOGIN_SHELL" ] || LOGIN_SHELL="$(dscl . -read "/Users/$ME" UserShell 2>/dev/null | awk '{print $2}')"
[ -n "$LOGIN_SHELL" ] || LOGIN_SHELL=/bin/bash

# Root for package installs and links: fail fast when sudo would have to ask and cannot.
SUDO_RC=""
need_sudo() {
  [ -z "$SUDO_RC" ] || return "$SUDO_RC"
  SUDO_RC=0
  if [ "$(id -u)" -eq 0 ]; then :
  elif [ -z "$SUDO" ]; then warn "this step needs root and sudo is not installed on $HOST"; SUDO_RC=1
  elif sudo -n true 2>/dev/null || ( : </dev/tty ) 2>/dev/null; then :
  else warn "sudo needs a password on $HOST: rerun with --tty or run it locally"; SUDO_RC=1; fi
  return "$SUDO_RC"
}

# Download an installer, then run it: 'curl | sh' reports success when the download fails.
fetch_run() {   # url, then the command that runs the downloaded file
  local url="$1" f rc; shift
  f="$(mktemp "${TMPDIR:-/tmp}/trimurti-installer.XXXXXX")" || return 1
  if curl -fsSL "$url" -o "$f"; then "$@" "$f"; rc=$?; else warn "could not download $url"; rc=1; fi
  rm -f "$f"; return "$rc"
}

# Put a directory on PATH now and in the shell start files, at the top, once.
ensure_path() {
  local d="$1" line rc
  case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH"; export PATH ;; esac
  case ":$SSH_PATH:" in *":$d:"*) return 0 ;; esac   # every shell has it already
  line="case \":\$PATH:\" in *\":$d:\"*) ;; *) export PATH=\"$d:\$PATH\" ;; esac  # added by bootstrap-ai-clis.sh"
  case "$LOGIN_SHELL" in */zsh) touch "$HOME/.zshenv" ;; */bash) touch "$HOME/.bashrc" ;; esac
  for rc in "$HOME/.zshenv" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    grep -qxF "$line" "$rc" && continue
    { printf '%s\n' "$line"; cat "$rc"; } > "$rc.trimurti-tmp" && cat "$rc.trimurti-tmp" > "$rc"
    rm -f "$rc.trimurti-tmp"
  done
}

# Would a fresh 'ssh <this host> ...' find these commands? Asks the login shell the way sshd starts it.
ssh_finds() {
  local c cmd="true"
  for c in "$@"; do cmd="$cmd && command -v $c"; done
  env -i HOME="$HOME" USER="$ME" LOGNAME="$ME" SHELL="$LOGIN_SHELL" PATH="$SSH_PATH" \
    SSH_CLIENT="127.0.0.1 22 22" SSH_CONNECTION="127.0.0.1 22 127.0.0.1 22" \
    "$LOGIN_SHELL" -c "$cmd" </dev/null >/dev/null 2>&1
}

# Make a plain 'ssh <host> <cli>' work: start-file PATH lines, or a /usr/local/bin link
# where the shell reads no start file for ssh commands (Arch's bash).
reach() {
  local c="$1" x p need="$1"
  [ "$c" = gemini ] && need="gemini node"
  for x in $need; do
    p="$(command -v "$x")" || continue
    p="$(dirname "$p")"
    case ":$SSH_PATH:" in *":$p:"*) ;; *) ensure_path "$p" ;; esac
  done
  # shellcheck disable=SC2086
  ssh_finds $need && return 0
  if [ "$OS" = "Linux" ] && [ -d /usr/local/bin ] && [ ! -e "/usr/local/bin/$c" ] && need_sudo; then
    log "linking $c into /usr/local/bin ($(basename "$LOGIN_SHELL") reads no start file for ssh commands here)"
    # shellcheck disable=SC2086
    $SUDO ln -sfn "$(command -v "$c")" "/usr/local/bin/$c" && ssh_finds $need && return 0
  fi
  warn "$c is installed, but a plain 'ssh $HOST $c' will not find it (login shell $LOGIN_SHELL)"
  return 1
}

node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]; }

install_node() {
  local cand
  if node_ok; then log "node $(node --version) present"; return 0; fi
  log "installing Node.js 22 (Gemini CLI and the trimurti-ops MCP server need 20+)"
  if [ "$OS" = "Darwin" ]; then
    have brew || { warn "Homebrew is missing. Install it from https://brew.sh, then rerun."; return 1; }
    brew install node >/dev/null 2>&1 || brew upgrade node >/dev/null 2>&1 || true
  else
    need_sudo || return 1
    if have apt-get; then
      $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg >/dev/null
      # shellcheck disable=SC2086
      fetch_run https://deb.nodesource.com/setup_22.x $SUDO ${SUDO:+-E} bash >/dev/null \
        || warn "NodeSource setup failed; trying this release's own nodejs package"
      cand="$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/ {print $2}')"; cand="${cand#*:}"; cand="${cand%%.*}"
      case "$cand" in
        ''|*[!0-9]*) warn "apt has no nodejs package"; return 1 ;;
      esac
      [ "$cand" -ge 20 ] || { warn "apt only offers nodejs $cand (20+ is needed); not installing it"; return 1; }
      $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
    elif have dnf;    then $SUDO dnf install -y nodejs npm >/dev/null
    # No -y: installing against a freshly synced database without upgrading everything is a partial upgrade.
    elif have pacman; then $SUDO pacman -S --needed --noconfirm nodejs npm >/dev/null \
      || warn "pacman could not install nodejs from the current package database: update the system first (update-all.sh), then rerun"
    elif have zypper; then $SUDO zypper install -y nodejs22 npm22 >/dev/null
    elif have apk;    then $SUDO apk add nodejs npm >/dev/null
    else warn "no known package manager. Install Node 20+ from https://nodejs.org and rerun."; return 1; fi
  fi
  node_ok || { warn "node is still missing or older than 20 (have: $(node --version 2>/dev/null || echo none))"; return 1; }
  log "node $(node --version) installed"
}

# Node is installed at most once per run, and its failure is reported once.
NODE_RC=""
node_once() {
  if [ -z "$NODE_RC" ]; then install_node; NODE_RC=$?; [ "$NODE_RC" = 0 ] || failed node; fi
  return "$NODE_RC"
}

# Global npm installs without sudo: use ~/.npm-global when the default prefix is root-owned.
setup_npm_prefix() {
  local prefix nm; prefix="$(npm prefix -g 2>/dev/null || true)"; nm="$prefix/lib/node_modules"
  if [ -n "$prefix" ] && { [ -w "$nm" ] || { [ ! -e "$nm" ] && [ -w "$prefix/lib" ]; }; } \
     && { [ -w "$prefix/bin" ] || [ ! -e "$prefix/bin" ]; }; then
    ensure_path "$prefix/bin"; return 0
  fi
  log "npm global dir is not writable; switching to ~/.npm-global (never sudo npm)"
  mkdir -p "$HOME/.npm-global" && npm config set prefix "$HOME/.npm-global" || return 1
  ensure_path "$HOME/.npm-global/bin"
}

install_claude() {
  if have claude; then
    log "claude present ($(claude --version 2>/dev/null | head -1)); checking for an update"
    claude update >/dev/null 2>&1 || { warn "'claude update' failed"; return 1; }
    return 0
  fi
  log "installing Claude Code (native installer, auto-updates itself)"
  fetch_run https://claude.ai/install.sh bash || { warn "Claude Code install FAILED (https://claude.ai/install.sh)"; return 1; }
  ensure_path "$HOME/.local/bin"
  have claude || { warn "the Claude Code installer finished, but there is no claude in ~/.local/bin"; return 1; }
}

install_codex() {
  if have codex; then
    log "codex present ($(codex --version 2>/dev/null | head -1)); checking for an update"
    codex update >/dev/null 2>&1 || { warn "'codex update' failed"; return 1; }
    return 0
  fi
  log "installing Codex CLI (official installer, self-updates with 'codex update')"
  if fetch_run https://chatgpt.com/codex/install.sh env CODEX_NON_INTERACTIVE=1 sh; then
    ensure_path "$HOME/.local/bin"
  else
    warn "Codex installer failed; falling back to npm"
    have npm || [ "$SKIP_NODE" = 1 ] || node_once
    have npm || { warn "Codex install FAILED: the installer failed and npm is not available"; return 1; }
    setup_npm_prefix && npm install -g --no-fund --no-audit @openai/codex@latest >/dev/null \
      || { warn "Codex npm install FAILED"; return 1; }
  fi
  have codex || { warn "Codex install finished, but codex is not on PATH"; return 1; }
}

install_gemini() {
  [ "$SKIP_NODE" = 1 ] || node_once
  node_ok && have npm || { warn "Gemini CLI needs Node.js 20+ and npm; not installed"; return 1; }
  log "installing/updating Gemini CLI (npm)"
  setup_npm_prefix && npm install -g --no-fund --no-audit @google/gemini-cli@latest >/dev/null \
    || { warn "Gemini CLI npm install FAILED"; return 1; }
  have gemini || { warn "Gemini CLI installed, but gemini is not on PATH"; return 1; }
}

# The hf installer builds a venv, so it needs Python 3.10+ with venv and ensurepip, and installs
# neither. Debian/Ubuntu ship ensurepip in python3-venv, which desktop installs often lack.
py_ok() {
  local p
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
hf_installer() { bash "$1" --no-modify-path; }   # --no-modify-path: ensure_path owns the start files, as for the other CLIs
install_hf() {
  if have hf; then
    log "hf present ($(hf --version 2>/dev/null | head -1)); checking for an update"
    hf update >/dev/null 2>&1 || { warn "'hf update' failed"; return 1; }
    # hf update never re-adds a skill that was skipped or removed; a pip or brew install never had it.
    [ -d "$HOME/.agents/skills/hf-cli" ] || warn "the hf-cli agent skill is not installed; add it with: hf skills add --global"
    return 0
  fi
  if ! py_ok; then
    log "installing Python 3 with venv (the hf installer needs 3.10+)"
    if [ "$OS" = "Darwin" ]; then
      # the stock python3 is 3.9
      have brew || { warn "hf needs Python 3.10+ and Homebrew is missing. Install it from https://brew.sh, then rerun."; return 1; }
      brew install python >/dev/null 2>&1 || true
    else
      need_sudo || return 1
      if   have apt-get; then $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 python3-venv >/dev/null
      elif have dnf;     then $SUDO dnf install -y python3 >/dev/null
      elif have pacman;  then $SUDO pacman -S --needed --noconfirm python >/dev/null
      elif have zypper;  then $SUDO zypper install -y python3 >/dev/null
      elif have apk;     then $SUDO apk add python3 >/dev/null
      else warn "no known package manager. Install Python 3.10+ with venv and rerun."; return 1; fi
    fi
    py_ok || { warn "hf needs Python 3.10+ with venv (have: $(python3 --version 2>&1 || echo none)); install it and rerun"; return 1; }
  fi
  log "installing Hugging Face CLI (official installer; also installs the hf-cli agent skill)"
  fetch_run https://hf.co/cli/install.sh hf_installer || { warn "hf install FAILED (https://hf.co/cli/install.sh; needs access to hf.co and pypi.org)"; return 1; }
  ensure_path "$HOME/.local/bin"
  have hf || { warn "the hf installer finished, but there is no hf in ~/.local/bin"; return 1; }
}

# User-scope registration must not mistake this checkout's project entry for the user's.
# Codex parses a private candidate config outside the checkout before any append. Existing
# entries are preserved, but an incompatible URL/tool filter is an installation failure.
# Gemini stores a literal environment reference, never the value of HF_TOKEN, in its settings.
# Claude is opt-in because a local entry can mask a claude.ai connector.
HF_MCP_URL="https://huggingface.co/mcp"
HF_DENY="hf_jobs create_repo dynamic_space hf_sandbox hf_sandbox_exec hf_sandbox_fs"

# JSON checks use Python's standard library; hf itself needs Python 3.10+. The Python checks make no network calls.
json_python() {
  local p
  for p in python3 python; do
    if have "$p" && "$p" -c 'import sys; sys.exit(sys.version_info < (3, 10))' >/dev/null 2>&1; then
      printf '%s' "$p"; return 0
    fi
  done
  return 1
}
check_hf_json() {  # codex get --json on stdin
  local py
  py="$(json_python)" || return 1
  "$py" -c 'import json, sys
try:
    s = json.load(sys.stdin)
    required = set("hf_jobs create_repo dynamic_space hf_sandbox hf_sandbox_exec hf_sandbox_fs".split())
    valid = s.get("transport", {}).get("url") in ("https://huggingface.co/mcp", "https://huggingface.co/mcp?login") and s.get("enabled", True) is not False and required.issubset(s.get("disabled_tools") or [])
    sys.exit(0 if valid else 1)
except (ValueError, TypeError, AttributeError):
    sys.exit(1)'
}
register_codex_hf() (
  # Subshell confines cleanup/traps and config overrides to this operation.
  local cfg="${CODEX_HOME:-$HOME/.codex}/config.toml" stage list="" t out exists=0
  stage="$(mktemp -d "${TMPDIR:-/tmp}/trimurti-hf-mcp.XXXXXX")" || { warn "codex: could not create a staging directory under ${TMPDIR:-/tmp}"; return 1; }
  trap 'rm -rf "$stage"' EXIT
  if [ -e "$cfg" ]; then
    cp "$cfg" "$stage/config.toml" && cp "$cfg" "$stage/original.toml" || { warn "codex: cannot read $cfg; left unchanged"; return 1; }
    exists=1
  elif [ -L "$cfg" ]; then
    warn "codex: user config is a dangling symlink; left unchanged"; return 1
  fi
  # These commands read config and, for each HTTP server in it, perform bounded OAuth-discovery
  # requests (failures tolerated) and consult Codex's OAuth token store; they start no server and
  # trigger no login. The child override prevents project settings from making a missing user
  # entry look already configured.
  if ! (cd "$stage" && CODEX_HOME="$stage" codex mcp list --json >/dev/null 2>&1); then
    warn "codex: user config could not be parsed; left unchanged"; return 1
  fi
  if out="$(cd "$stage" && CODEX_HOME="$stage" codex mcp get huggingface --json 2>/dev/null)"; then
    if printf '%s' "$out" | check_hf_json; then
      log "codex: compatible user huggingface MCP server already configured; left as is"; return 0
    fi
    warn "codex: existing user huggingface entry has an incompatible URL, disabled server, or missing blocked tools; left unchanged"; return 1
  fi
  for t in $HF_DENY; do list="${list:+$list, }\"$t\""; done
  printf '\n# Hugging Face MCP (ops/network bootstrap). Sign in once: codex mcp login huggingface\n[mcp_servers.huggingface]\nurl = "%s?login"\ndisabled_tools = [%s]\n' "$HF_MCP_URL" "$list" > "$stage/addition.toml" || { warn "codex: could not stage the addition; left unchanged"; return 1; }
  cat "$stage/addition.toml" >> "$stage/config.toml" || { warn "codex: could not stage the addition; left unchanged"; return 1; }
  if ! out="$(cd "$stage" && CODEX_HOME="$stage" codex mcp get huggingface --json 2>/dev/null)" || ! printf '%s' "$out" | check_hf_json; then
    warn "codex: cannot safely append to this user config; left unchanged. Add the Hugging Face entry manually."; return 1
  fi
  # Preserve all existing bytes, permissions and symlinks; refuse a config changed during validation.
  if [ "$exists" = 1 ]; then
    cmp -s "$cfg" "$stage/original.toml" || { warn "codex: user config changed during validation; rerun"; return 1; }
  elif [ -e "$cfg" ] || [ -L "$cfg" ]; then
    warn "codex: user config appeared during validation; rerun"; return 1
  fi
  mkdir -p "$(dirname "$cfg")" && cat "$stage/addition.toml" >> "$cfg" || { warn "codex: could not write user config"; return 1; }
  log "codex: added the user huggingface MCP server"
)
check_client_hf() {  # client; 0 compatible, 3 absent, 1 unsupported/incompatible; no secret output
  local py cfg="${GEMINI_CLI_HOME:-$HOME}/.gemini/settings.json"
  [ "$1" != claude ] || cfg="${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json"
  py="$(json_python)" || return 1
  "$py" - "$cfg" "$1" <<'PYJSON'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
if not p.exists():
    sys.exit(3)
try:
    settings = json.loads(p.read_text(encoding="utf-8-sig"))
    servers = settings.get("mcpServers", {})
    if not isinstance(servers, dict):
        sys.exit(1)
    if "huggingface" not in servers:
        sys.exit(3)
    s = servers["huggingface"]
    required = set("hf_jobs create_repo dynamic_space hf_sandbox hf_sandbox_exec hf_sandbox_fs".split())
    urls = ("https://huggingface.co/mcp", "https://huggingface.co/mcp?login")
    # Gemini CLI 0.61 writes url + type "http"; older settings carry the deprecated httpUrl. Both count.
    gemini_url = s.get("httpUrl") if "httpUrl" in s else (s.get("url") if s.get("type") == "http" else None)
    valid = (s.get("url") in urls and s.get("type") == "http") if sys.argv[2] == "claude" else (gemini_url in urls and required.issubset(s.get("excludeTools") or []))
    sys.exit(0 if valid else 1)
except (ValueError, OSError, TypeError, AttributeError):
    sys.exit(1)
PYJSON
}
register_hf_mcp() {
  local state
  if { [ "$SKIP_CODEX" = 0 ] && have codex; } || { [ "$SKIP_GEMINI" = 0 ] && have gemini; } || { [ "$CLAUDE_HF_MCP" = 1 ] && [ "$SKIP_CLAUDE" = 0 ] && have claude; }; then
    json_python >/dev/null || { warn "Hugging Face MCP validation needs Python 3.10+ on PATH; user configs left unchanged"; failed hf-mcp-validation; return 1; }
  fi
  if [ "$SKIP_CODEX" = 0 ] && have codex; then register_codex_hf || failed hf-mcp-codex; fi
  if [ "$SKIP_GEMINI" = 0 ] && have gemini; then
    check_client_hf gemini; state=$?
    if [ "$state" = 0 ]; then
      log "gemini: compatible user huggingface MCP server already configured; left as is"
    elif [ "$state" = 3 ]; then
      # Options follow positionals; --exclude-tools consumes multiple values. Never echo CLI errors:
      # they may contain interpolated configuration credentials.
      # shellcheck disable=SC2016,SC2086
      if gemini mcp add -s user -t http huggingface "$HF_MCP_URL" -H 'Authorization: Bearer ${HF_TOKEN}' --exclude-tools $HF_DENY >/dev/null 2>&1 && check_client_hf gemini; then
        log "gemini: added the user huggingface MCP server"
      else
        warn "gemini: Hugging Face MCP registration failed; check user settings"; failed hf-mcp-gemini
      fi
    else
      warn "gemini: user settings need manual review (commented/unsupported JSON, incompatible URL or missing blocked tools); left unchanged"; failed hf-mcp-gemini
    fi
  fi
  if [ "$CLAUDE_HF_MCP" = 1 ] && [ "$SKIP_CLAUDE" = 0 ] && have claude; then
    check_client_hf claude; state=$?
    if [ "$state" = 0 ]; then
      log "claude: compatible user huggingface MCP server already configured; left as is"
    elif [ "$state" = 3 ]; then
      if claude mcp add --scope user --transport http huggingface "$HF_MCP_URL?login" >/dev/null 2>&1 && check_client_hf claude; then
        log "claude: added the user huggingface MCP server"
      else
        warn "claude: Hugging Face MCP registration failed; check user settings"; failed hf-mcp-claude
      fi
    else
      warn "claude: user settings or the existing huggingface URL could not be validated; left unchanged"; failed hf-mcp-claude
    fi
    log "claude: verify account MCP tool restrictions before use; registration does not apply per-tool blocks"
  fi
}

have curl || { warn "curl is required"; exit 1; }
if [ "$OS" = "Linux" ] && [ -r /proc/cpuinfo ] && ! grep -qw avx /proc/cpuinfo; then
  warn "this CPU has no AVX; Claude Code's native binary needs it (pre-2013 hardware). Skipping Claude Code on this machine."
  SKIP_CLAUDE=1
fi
[ "$SKIP_CLAUDE" = 1 ] || install_claude || failed claude
[ "$SKIP_CODEX" = 1 ]  || install_codex  || failed codex
[ "$SKIP_GEMINI" = 1 ] || install_gemini || failed gemini
[ "$SKIP_HF" = 1 ]     || install_hf     || failed hf
[ "$SKIP_HF" = 1 ]     || register_hf_mcp
[ "$WITH_NODE" = 0 ] || node_once || true   # node_once reports its own failure
for c in claude codex gemini hf; do
  case "$c" in claude) s=$SKIP_CLAUDE ;; codex) s=$SKIP_CODEX ;; gemini) s=$SKIP_GEMINI ;; *) s=$SKIP_HF ;; esac
  [ "$s" = 0 ] && have "$c" || continue
  reach "$c" || failed "$c-path"
done

log "versions on $HOST ($OS):"
for c in node claude codex gemini hf; do
  skipped=0
  case "$c" in node) skipped=$SKIP_NODE ;; claude) skipped=$SKIP_CLAUDE ;; codex) skipped=$SKIP_CODEX ;; gemini) skipped=$SKIP_GEMINI ;; hf) skipped=$SKIP_HF ;; esac
  if have "$c"; then printf '  %-7s %s\n' "$c" "$("$c" --version 2>&1 | head -1)"
  elif [ "$skipped" = 1 ]; then printf '  %-7s not installed (skipped)\n' "$c"
  else printf '  %-7s MISSING\n' "$c"; fi
done
[ "$SKIP_CLAUDE$SKIP_CODEX$SKIP_GEMINI$SKIP_HF" = 1111 ] || cat <<'EOF'

Sign in once per machine, per user (open a NEW terminal first so PATH is fresh). Never type
a token or key into a command line: it lands in shell history. The routes below read it with
the terminal's echo off, and it lasts for that shell only.
  claude   run `claude` (or `claude auth login`). A browser opens; over SSH press `c` to copy the
           URL, open it on any machine, then paste the code back at "Paste code here if prompted".
           No browser anywhere: `claude setup-token` on any machine with a browser prints a one-year
           token (Pro/Max/Team/Enterprise; model requests only), then here:
           printf 'token: '; read -rs CLAUDE_CODE_OAUTH_TOKEN; echo; export CLAUDE_CODE_OAUTH_TOKEN
           Keeping it past this shell means a mode-600 file outside the repo, and only Sanjay decides
           that; prefer the browser sign-in, which Claude Code stores by itself.
           check:  claude auth status     install health:  claude doctor
           (Over SSH on a Mac the Keychain is locked, so the login lands in ~/.claude/.credentials.json
           with mode 600 instead. That is expected. If ANTHROPIC_API_KEY is set in the environment,
           Claude Code bills that key instead of the subscription: unset it on these machines.)
  codex    run `codex login` (browser). Over SSH: `codex login --device-auth` (turn on device-code
           sign-in under ChatGPT Settings > Security first), or forward the callback port from the
           machine with the browser:  ssh -L 1455:localhost:1455 <this-host>  then `codex login`.
           API key:  printf 'key: '; read -rs K; echo; printf '%s' "$K" | codex login --with-api-key; unset K
           (exporting OPENAI_API_KEY on its own is not a login)
           check:  codex login status     credentials: ~/.codex/auth.json
  gemini   run `gemini` and choose "Sign in with Google". Over SSH (with a terminal: ssh -t) run
           NO_BROWSER=true gemini  and paste the code back within 5 minutes. Google Workspace account (not personal Gmail): first
           export GOOGLE_CLOUD_PROJECT=<project-id>; personal Gmail must leave it unset.
           API key instead (this shell only; https://aistudio.google.com/app/apikey):
           printf 'key: '; read -rs GEMINI_API_KEY; echo; export GEMINI_API_KEY
  hf       run `hf auth login` (over SSH: ssh -t). "Log in with your browser" prints a URL and a code:
           open the URL on any machine and enter the code. "Paste an access token" reads a token at a
           hidden prompt: make one per machine at https://huggingface.co/settings/tokens > New token,
           role Read (all that downloads and the MCP server need; never Write).
           check:  hf auth whoami     (HF_TOKEN in the environment overrides the stored login)
  HF MCP   codex   codex mcp login huggingface   (over SSH: ssh -t, add --no-browser, open the URL on
                   any machine, paste the redirect URL back)
           gemini  sends $HF_TOKEN as its bearer token. Set it before starting Gemini.
                   Set the token at a hidden prompt in your terminal, then start Gemini:
                   printf 'HF token: '; read -rs HF_TOKEN; echo; export HF_TOKEN; gemini
                   Gemini loads MCP servers only in folders it trusts (it asks on the first run there).
           claude  the account's Hugging Face connector comes with the claude.ai login (/mcp lists it).
                   Signed in with setup-token or an API key? Rerun this script with --with-claude-hf-mcp,
                   then  claude mcp login huggingface   (--no-browser over SSH)
           Which tools every client sees is set per account at https://huggingface.co/settings/mcp:
           keep Jobs, Contribute Repos, Sandboxes and Dynamic Spaces off (they create repos, run code
           or can spend credits).
EOF
if [ -n "$FAILED" ]; then
  echo "INSTALL INCOMPLETE on $HOST, failed:$FAILED"
  exit 1
fi
echo "INSTALL OK on $HOST"
