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
# ssh_port means "no SSH on this device"; 22 has to be written out. A user that
# starts with '-' would reach ssh and scp as an option (user@host is their first
# non-option argument), so such a row is skipped too.
ssh_skip_reason() {  # user port
  case "$2" in
    "")       echo "no ssh_port set" ;;
    *[!0-9]*) echo "ssh_port '$2' is not a number" ;;
    *)        if [ ${#2} -gt 5 ] || [ "$2" -lt 1 ] || [ "$2" -gt 65535 ]; then echo "ssh_port '$2' is not a port"
              elif [ -z "$1" ]; then echo "no user set"
              else case "$1" in -*) echo "user '$1' starts with '-' (fix the inventory row)" ;; esac; fi ;;
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
# Safe under set -e (launch.sh). The AI agent's shells have no terminal: they
# never start an agent or type a passphrase; Sanjay loads the key in his terminal.
key_problem() {
  local err k="$KEY_FILE" rc=0 msg launcher=launch.sh
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
    { ssh-add --apple-load-keychain || ssh-add -A || true; } >/dev/null 2>&1
    key_in_agent && return
  fi
  ssh-add -l >/dev/null 2>&1 || rc=$?
  msg="key is passphrase-protected and no ssh-agent holds it: run ssh-add $k"
  [ "$(local_os)" = windows ] && launcher=launch.ps1
  if has_tty; then
    if [ "$rc" = 2 ]; then echo "$msg (this terminal has no ssh-agent: run eval \"\$(ssh-agent -s)\" && ssh-add $k here, then rerun the command; for the AI agent's shells, rerun $launcher instead)"
    else echo "$msg"; fi
  elif [ "$(local_os)" = macos ]; then
    echo "$msg (this shell has no terminal for the passphrase: Sanjay runs ssh-add --apple-use-keychain $k in any terminal, or reruns $launcher)"
  elif [ "$(local_os)" != windows ] && [ "$rc" != 2 ] && [ -n "${SSH_AUTH_SOCK:-}" ]; then
    echo "$msg (this shell has no terminal for the passphrase: Sanjay reruns $launcher, or adds it to this shell's agent from any terminal: SSH_AUTH_SOCK='$SSH_AUTH_SOCK' ssh-add $k)"
  else
    echo "$msg (this shell has no ssh-agent and no terminal for the passphrase: Sanjay reruns $launcher, which loads the key and starts the agent session with it)"
  fi
}

# Launchers only (launch.sh, start-codex.sh), in Sanjay's terminal, before the AI
# agent starts: make the admin key usable without a prompt, so the agent and
# every shell it opens inherit it. A missing key is created (ssh-keygen asks for
# a passphrase; empty for none). A key with a passphrase is loaded into the
# macOS Keychain-backed agent, the ssh-agent this terminal already answers on,
# or one started here: then ADMIN_AGENT_STARTED=1 and the caller stops it when
# the agent CLI exits. $1 = 1: dry run. Problems are warnings, never fatal.
# shellcheck disable=SC2034  # read by the launchers
ADMIN_AGENT_STARTED=0
load_admin_key() {
  local dry="${1:-0}" k="$KEY_FILE" kp me when rc=0
  case "$k" in *" "*) k="\"$k\"" ;; esac
  if [ ! -f "$KEY_FILE" ]; then
    if ! has_tty; then warn "admin key $k not found and there is no terminal to create it: run scripts/ssh-keys.sh in a terminal"; return 0; fi
    if [ "$(local_os)" = macos ]; then when="once (the Keychain remembers it)"; else when="once each time you run this launcher"; fi
    log "creating the admin key $k. With a passphrase a copied key is useless, and you type it $when; with none there is nothing to type, but anyone who can read your home folder can log into every machine."
    if [ "$dry" = 1 ]; then printf '  [dry-run] ssh-keygen -t ed25519 -a 64 -f %s\n' "$k"; return 0; fi
    me="$(hostname -s 2>/dev/null || uname -n)"; me="${me%%.*}"
    if ! ( umask 077; mkdir -p "$(dirname "$KEY_FILE")" && ssh-keygen -t ed25519 -a 64 -C "trimurti-admin@$me" -f "$KEY_FILE" ); then
      warn "ssh-keygen failed: every SSH step will stop until the admin key exists"; return 0
    fi
  fi
  kp="$(key_problem)"
  case "$kp" in
    "") return 0 ;;
    "key is passphrase-protected"*) has_tty || { warn "$kp"; return 0; } ;;
    *) warn "$kp"; return 0 ;;
  esac
  if [ "$dry" = 1 ]; then printf '  [dry-run] ssh-add %s\n' "$k"; return 0; fi
  ssh-add -l >/dev/null 2>&1 || rc=$?
  if [ "$rc" = 2 ]; then   # no agent answers in this terminal: start one for this launch
    if ! eval "$(ssh-agent -s)" >/dev/null; then warn "could not start an ssh-agent: $kp"; return 0; fi
    # shellcheck disable=SC2034
    ADMIN_AGENT_STARTED=1
    trap 'ssh-agent -k >/dev/null 2>&1; exit 130' INT TERM
  fi
  log "loading the admin key into the ssh-agent: type its passphrase (the agent session inherits it)"
  if [ "$(local_os)" = macos ]; then ssh-add --apple-use-keychain "$KEY_FILE" || ssh-add -K "$KEY_FILE" || true
  else ssh-add "$KEY_FILE" || true; fi
  if [ "$ADMIN_AGENT_STARTED" = 1 ]; then trap - INT TERM; fi
  key_in_agent || warn "the admin key is not in the ssh-agent, so every SSH step will stop with 'no ssh-agent holds it'; rerun this launcher to try again"
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
