#!/usr/bin/env bash
# Shared helpers for the ops/network scripts. Source it; do not run it.
# Written for bash 3.2 (stock macOS) and newer, so: no associative arrays,
# no mapfile, no ${var,,}.

OPS_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
INVENTORY="${INVENTORY:-$OPS_DIR/inventory.csv}"
OUT_DIR="${OUT_DIR:-$OPS_DIR/out}"
KEY_FILE="${KEY_FILE:-$HOME/.ssh/id_ed25519_trimurti}"
# shellcheck disable=SC2034  # used by the scripts that source this file
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new"
# The admin key, passed to every ssh and scp. An array, so a path with spaces survives.
# shellcheck disable=SC2034
KEY_OPTS=(-i "$KEY_FILE" -o IdentitiesOnly=yes)

mkdir -p "$OUT_DIR"

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
ok()   { printf '\033[1;32m  OK  \033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m WARN \033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m FAIL \033[0m %s\n' "$*" >&2; }
die()  { fail "$*"; exit 1; }

have()  { command -v "$1" >/dev/null 2>&1; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
# A terminal to type passwords and passphrases into (ssh and ssh-keygen prompt on /dev/tty).
has_tty() { { : </dev/tty; } 2>/dev/null; }

# The calling script's header comment is its usage. -h/--help prints it and
# exits 0; bad arguments print it on stderr and exit 2.
usage() {
  if [ "${1:-0}" = 0 ]; then usage_text; else usage_text >&2; fi
  exit "${1:-0}"
}
usage_text() { awk 'NR == 1 { next } /^#/ { if ($0 !~ /^# shellcheck/) { sub(/^# ?/, ""); print }; next } { exit }' "$0"; }
bad_usage() { fail "$*"; usage 2; }

# The inventory with a UTF-8 BOM, CRs and spaces around fields removed (Excel saves all three).
inventory_clean() {
  LC_ALL=C tr -d '\r' < "$INVENTORY" |
    LC_ALL=C sed -e "1s/^$(printf '\357\273\277')//" -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/[[:space:]]*,[[:space:]]*/,/g'
}

# Stop in the calling shell (select_hosts runs in a pipeline, where die cannot stop the script).
check_inventory() {
  [ -f "$INVENTORY" ] || die "inventory not found: $INVENTORY"
  inventory_clean | grep -v -E '^(#|$)' | head -1 | grep -qi '^name,ip,mac,os,user,role,ssh_port,trimurti' \
    || die "inventory has no header row name,ip,mac,os,user,role,ssh_port,trimurti,notes: $INVENTORY"
}

# Data rows of the inventory: no comments, no blank lines, nothing up to and including the header.
inventory_rows() {
  [ -f "$INVENTORY" ] || die "inventory not found: $INVENTORY"
  inventory_clean | grep -v -E '^(#|$)' | awk 'h { print; next } tolower($0) ~ /^name,ip,/ { h = 1 }'
}

# This machine's default gateway, which is the router whatever the inventory says.
default_gateway() {
  case "$(local_os)" in
    macos)   route -n get default 2>/dev/null | awk '/gateway:/ { print $2; exit }' ;;
    windows) netstat -rn 2>/dev/null | tr -d '\r' | awk '$1 == "0.0.0.0" && $2 == "0.0.0.0" && $3 ~ /^[0-9.]+$/ { print $3; exit }' ;;
    *)       if have ip; then ip route show default 2>/dev/null | awk '/^default/ { print $3; exit }'
             else awk '$2 == "00000000" && $3 != "00000000" { print $3; exit }' /proc/net/route 2>/dev/null |
               { read -r g && printf '%d.%d.%d.%d\n' "0x${g:6:2}" "0x${g:4:2}" "0x${g:2:2}" "0x${g:0:2}"; }; fi ;;
  esac
}

# This machine's IPv4 addresses, one per line.
local_ips() {
  case "$(local_os)" in
    macos)   ifconfig 2>/dev/null | awk '$1 == "inet" { print $2 }' ;;
    windows) ipconfig 2>/dev/null | tr -d '\r' | awk -F': ' '/IPv4/ { print $2 }' | sed 's/[^0-9.].*//' ;;
    *)       if have ip; then ip -4 -o addr show 2>/dev/null | awk '{ sub(/\/.*/, "", $4); print $4 }'
             else hostname -I 2>/dev/null | tr ' ' '\n'; fi ;;
  esac
}

# admin, workstation and new rows are computers; nas, printer, iot and anything else are devices.
is_computer() { case "$(lower "$1")" in admin|workstation|new) return 0 ;; esac; return 1; }

# Rows filtered by the FILTER_* environment variables, all optional:
#   FILTER_HOSTS="a,b"   FILTER_OS=windows   FILTER_ROLE=new   FILTER_TRIMURTI=yes
# Without FILTER_HOSTS or FILTER_ROLE only computers are selected; `select_hosts all`
# selects devices too. The router (role=router, or the IP of this machine's default
# gateway) is never selected, even by name: nothing here logs into the router.
# A blank ssh_port stays blank: it means the device has no SSH.
select_hosts() {
  local gw hosts
  gw="$(default_gateway)"; hosts="$(printf '%s' "${FILTER_HOSTS:-}" | tr -d ' ')"
  inventory_rows | {
    seen=","
    while IFS=, read -r name ip mac os user role port trimurti notes; do
      [ -n "$name" ] || continue
      if [ -n "$hosts" ]; then
        case ",$hosts," in *",$name,"*) seen="$seen$name," ;; *) continue ;; esac
      fi
      if [ "$(lower "$role")" = "router" ] || { [ -n "$gw" ] && [ "$ip" = "$gw" ]; }; then
        if [ -n "$hosts" ] || [ "$(lower "${FILTER_ROLE:-}")" = router ]; then
          warn "$name: skipped, it is the router (role=router or this machine's gateway); nothing here logs into it" >&2
        fi
        continue
      fi
      case "$name" in *[!A-Za-z0-9._-]*)
        warn "$name: skipped, a name may only have letters, digits, '.', '_' and '-'" >&2; continue ;;
      esac
      [ -n "${FILTER_OS:-}" ]       && [ "$(lower "$os")" != "$(lower "$FILTER_OS")" ] && continue
      [ -n "${FILTER_ROLE:-}" ]     && [ "$(lower "$role")" != "$(lower "$FILTER_ROLE")" ] && continue
      [ -n "${FILTER_TRIMURTI:-}" ] && [ "$(lower "$trimurti")" != "$(lower "$FILTER_TRIMURTI")" ] && continue
      if [ "${1:-}" != all ] && [ -z "$hosts" ] && [ -z "${FILTER_ROLE:-}" ] && ! is_computer "$role"; then continue; fi
      printf '%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$name" "$ip" "$mac" "$os" "$user" "$role" "$port" "$trimurti" "$notes"
    done
    if [ -n "$hosts" ]; then
      set -f
      for h in $(printf '%s' "$hosts" | tr ',' ' '); do
        case "$seen" in *",$h,"*) ;; *) warn "$h: not in $INVENTORY" >&2 ;; esac
      done
    fi
  }
}

# Why SSH-based tools skip a row, or nothing when it can be reached. A blank
# ssh_port means "no SSH on this device"; 22 has to be written out.
ssh_skip_reason() {  # user port
  case "$2" in
    "")       echo "no ssh_port set" ;;
    *[!0-9]*) echo "ssh_port '$2' is not a number" ;;
    *)        [ -n "$1" ] || echo "no user set" ;;
  esac
}

# Parse the common "--host a,b --os X --role Y --trimurti yes" flags (or --host=a,b)
# into FILTER_* variables, up to the first argument that is not a flag. -h/--help
# prints the usage and exits 0. Flags named in SCRIPT_FLAGS belong to the calling
# script and are kept; any other flag exits 2, so a typo never widens the run.
# Leaves the script's own flags and every argument from the first non-flag on in REST.
parse_filters() {
  local opt val
  REST=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help) usage 0 ;;
      --host|--hosts|--os|--role|--trimurti)
        case "${2:-}" in ""|-*) bad_usage "$1 needs a value" ;; esac
        opt="$1"; val="$2"; shift ;;
      --host=*|--hosts=*|--os=*|--role=*|--trimurti=*)
        opt="${1%%=*}"; val="${1#*=}"; [ -n "$val" ] || bad_usage "$opt needs a value" ;;
      --) shift; break ;;
      -*) case " ${SCRIPT_FLAGS:-} " in *" $1 "*) REST="$REST $1"; shift; continue ;; esac
          bad_usage "unknown flag: $1" ;;
      *) break ;;
    esac
    case "$opt" in
      --host|--hosts) FILTER_HOSTS="$val" ;;
      --os)           FILTER_OS="$val" ;;
      --role)         FILTER_ROLE="$val" ;;
      --trimurti)     FILTER_TRIMURTI="$val" ;;
    esac
    shift
  done
  REST="$REST $*"
  export FILTER_HOSTS FILTER_OS FILTER_ROLE FILTER_TRIMURTI
}

# user@host for a row; falls back to the name when ip is blank so that
# ~/.ssh/config, DNS or mDNS can resolve it.
ssh_target() { printf '%s@%s' "$1" "${2:-$3}"; }   # user ip name

# Is the admin key in the ssh-agent? Compares fingerprints.
key_in_agent() {
  local pub fp
  pub="$KEY_FILE.pub"; [ -f "$pub" ] || pub="$KEY_FILE"
  fp="$(ssh-keygen -l -f "$pub" 2>/dev/null | awk '{ print $2 }')"
  [ -n "$fp" ] && ssh-add -l 2>/dev/null | grep -qF "$fp"
}

# Why ssh cannot use the admin key without a prompt, or nothing when it can.
key_problem() {
  local err k="$KEY_FILE"
  case "$k" in *" "*) k="\"$k\"" ;; esac
  [ -f "$KEY_FILE" ] || { echo "admin key not found: $k (run scripts/ssh-keys.sh in a terminal first)"; return; }
  err="$(ssh-keygen -y -P '' -f "$KEY_FILE" 2>&1 >/dev/null)" && return
  case "$err" in
    *passphrase*) ;;
    *) echo "admin key $k is unusable: $(printf '%s\n' "$err" | grep -v '^[[:space:]]*$' | tail -1)"; return ;;
  esac
  key_in_agent && return
  # macOS: a passphrase stored in the Keychain loads without a prompt
  if [ "$(local_os)" = macos ]; then
    { ssh-add --apple-load-keychain || ssh-add -A; } >/dev/null 2>&1
    key_in_agent && return
  fi
  ssh-add -l >/dev/null 2>&1
  if [ $? -eq 2 ]; then
    echo "key is passphrase-protected and no ssh-agent holds it: run ssh-add $k (no agent is running in this shell: start one first with eval \"\$(ssh-agent -s)\")"
  else
    echo "key is passphrase-protected and no ssh-agent holds it: run ssh-add $k"
  fi
}

# One ping with a 1 s timeout. The flags differ per OS; Git Bash runs Windows
# ping.exe, which exits 0 on "Destination host unreachable", so look for a reply.
ping_host() {  # host
  case "$(local_os)" in
    windows) ping -4 -n 1 -w 1000 "$1" 2>/dev/null | grep -q 'TTL=' ;;
    macos)   ping -c 1 -W 1000 "$1" >/dev/null 2>&1 ;;
    *)       ping -c 1 -W 1 "$1" >/dev/null 2>&1 ;;
  esac
}

# Detect the OS family of this machine: macos | linux | windows(git-bash)
local_os() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo linux ;;
  esac
}
