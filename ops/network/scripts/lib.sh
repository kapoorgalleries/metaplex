#!/usr/bin/env bash
# Shared helpers for the ops/network scripts. Source it; do not run it.
# Written for bash 3.2 (stock macOS) and newer, so: no associative arrays,
# no mapfile, no ${var,,}.

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INVENTORY="${INVENTORY:-$OPS_DIR/inventory.csv}"
OUT_DIR="${OUT_DIR:-$OPS_DIR/out}"
KEY_FILE="${KEY_FILE:-$HOME/.ssh/id_ed25519_trimurti}"
# shellcheck disable=SC2034  # used by the scripts that source this file
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new"

mkdir -p "$OUT_DIR"

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
ok()   { printf '\033[1;32m  OK  \033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m WARN \033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m FAIL \033[0m %s\n' "$*"; }
die()  { fail "$*"; exit 1; }

have()  { command -v "$1" >/dev/null 2>&1; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Data rows of the inventory: no comments, no blank lines, no header.
inventory_rows() {
  [ -f "$INVENTORY" ] || die "inventory not found: $INVENTORY"
  grep -v -E '^[[:space:]]*(#|$)' "$INVENTORY" | tail -n +2
}

# Rows filtered by the FILTER_* environment variables, all optional:
#   FILTER_HOSTS="a,b"   FILTER_OS=windows   FILTER_ROLE=new   FILTER_TRIMURTI=yes
# Rows with role=router are never selected: nothing here logs into the router.
select_hosts() {
  inventory_rows | while IFS=, read -r name ip mac os user role port trimurti notes; do
    [ "$(lower "$role")" = "router" ] && continue
    if [ -n "${FILTER_HOSTS:-}" ]; then
      case ",$FILTER_HOSTS," in *",$name,"*) ;; *) continue ;; esac
    fi
    [ -n "${FILTER_OS:-}" ]       && [ "$(lower "$os")" != "$(lower "$FILTER_OS")" ] && continue
    [ -n "${FILTER_ROLE:-}" ]     && [ "$(lower "$role")" != "$(lower "$FILTER_ROLE")" ] && continue
    [ -n "${FILTER_TRIMURTI:-}" ] && [ "$(lower "$trimurti")" != "$(lower "$FILTER_TRIMURTI")" ] && continue
    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$name" "$ip" "$mac" "$os" "$user" "$role" "${port:-22}" "$trimurti" "$notes"
  done
}

# Parse the common "--host a,b --os X --role Y --trimurti yes" flags into
# FILTER_* variables. Leaves the remaining arguments in REST.
parse_filters() {
  REST=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --host|--hosts) FILTER_HOSTS="$2"; shift 2 ;;
      --os)           FILTER_OS="$2"; shift 2 ;;
      --role)         FILTER_ROLE="$2"; shift 2 ;;
      --trimurti)     FILTER_TRIMURTI="$2"; shift 2 ;;
      *)              REST="$REST $1"; shift ;;
    esac
  done
  export FILTER_HOSTS FILTER_OS FILTER_ROLE FILTER_TRIMURTI
}

# user@host for a row; falls back to the name when ip is blank so that
# ~/.ssh/config, DNS or mDNS can resolve it.
ssh_target() { printf '%s@%s' "$1" "${2:-$3}"; }   # user ip name

# Detect the OS family of this machine: macos | linux | windows(git-bash)
local_os() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo linux ;;
  esac
}
