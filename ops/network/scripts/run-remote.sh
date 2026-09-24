#!/usr/bin/env bash
# Run one of the scripts in this directory on every selected inventory host,
# choosing the .sh or .ps1 variant by the host's OS. The script is copied over
# with scp, executed, then deleted. Output is logged per host in out/logs/.
# Needs key login to work first (ssh-keys.sh).
#
# Usage: run-remote.sh [--host a,b] [--os linux] [--role new] [--trimurti yes] [--tty] <script-base> [args...]
#   run-remote.sh --role new bootstrap-ai-clis            # both new machines, right variant each
#   run-remote.sh --os linux --tty update-all              # --tty lets sudo ask for its password
#   run-remote.sh --os windows enable-ssh-server -Pwsh7
# Args must not contain spaces.
# shellcheck disable=SC2034  # every inventory column is read, not every one is used
set -u
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
parse_filters "$@"
# shellcheck disable=SC2086
set -- $REST
TTY=0; [ "${1:-}" = "--tty" ] && { TTY=1; shift; }
BASE="${1:-}"; [ -n "$BASE" ] || die "usage: run-remote.sh [filters] [--tty] <script-base> [args...]"
shift; ARGS="$*"

SCRIPTS="$OPS_DIR/scripts"; LOGS="$OUT_DIR/logs"; mkdir -p "$LOGS"
HOSTS="$(select_hosts)"; [ -n "$HOSTS" ] || die "no hosts selected from $INVENTORY"
PASSED=""; FAILED=""

OLDIFS="$IFS"; IFS='
'
for row in $HOSTS; do
  IFS="$OLDIFS"
  IFS=, read -r name ip mac os user role port trimurti notes <<< "$row"
  target="$(ssh_target "$user" "$ip" "$name")"
  logf="$LOGS/$name-$BASE-$(date +%Y%m%d-%H%M%S).log"
  rc=1
  if [ "$(lower "$os")" = "windows" ]; then
    src="$SCRIPTS/$BASE.ps1"; remote="trimurti-$BASE.ps1"
    if [ ! -f "$src" ]; then fail "$name: no $BASE.ps1 for a Windows host"; FAILED="$FAILED $name"; IFS='
'; continue; fi
    log "$name: $BASE.ps1 -> $target (log: $logf)"
    if scp -q -o ConnectTimeout=8 -P "$port" "$src" "$target:$remote" </dev/null; then
      # -File works whether the login shell is cmd or powershell; its exit code is the script's.
      ssh $SSH_OPTS -p "$port" "$target" "powershell -NoProfile -ExecutionPolicy Bypass -File $remote $ARGS" </dev/null 2>&1 | tee "$logf"
      rc=${PIPESTATUS[0]}
      ssh $SSH_OPTS -p "$port" "$target" "del $remote" </dev/null >/dev/null 2>&1 || true
    fi
  else
    src="$SCRIPTS/$BASE.sh"; remote="/tmp/trimurti-$BASE.sh"
    if [ ! -f "$src" ]; then fail "$name: no $BASE.sh"; FAILED="$FAILED $name"; IFS='
'; continue; fi
    log "$name: $BASE.sh -> $target (log: $logf)"
    if scp -q -o ConnectTimeout=8 -P "$port" "$src" "$target:$remote" </dev/null; then
      if [ "$TTY" = 1 ]; then
        ssh -t -o ConnectTimeout=8 -p "$port" "$target" "bash $remote $ARGS; c=\$?; rm -f $remote; exit \$c" 2>&1 | tee "$logf"
      else
        ssh $SSH_OPTS -p "$port" "$target" "bash $remote $ARGS; c=\$?; rm -f $remote; exit \$c" </dev/null 2>&1 | tee "$logf"
      fi
      rc=${PIPESTATUS[0]}
    fi
  fi
  if [ "$rc" -eq 0 ]; then ok "$name: exit 0"; PASSED="$PASSED $name"; else fail "$name: exit $rc"; FAILED="$FAILED $name"; fi
  IFS='
'
done
IFS="$OLDIFS"

log "passed:${PASSED:- none}"
log "failed:${FAILED:- none}"
[ -z "$FAILED" ]
