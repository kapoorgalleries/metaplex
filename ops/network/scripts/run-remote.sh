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
# Without --host or --role it runs on computers only (role admin, workstation or
# new); a nas, printer or iot row runs only when named. Never on the router.
# Rows with a blank ssh_port (no SSH) are skipped. Flags go before <script-base>;
# everything after it goes to the script. Args must not contain spaces (exit 2).
# Ends with three plain lines, TRIMURTI_SUMMARY passed=... failed=... reboot_required=...
# (comma-separated host names), also when it stops before any host ran; exits 0
# only if none failed, 1 otherwise, 2 on bad arguments.
# shellcheck disable=SC2034  # every inventory column is read, not every one is used
set -u
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
SCRIPT_FLAGS="--tty"
parse_filters "$@"
# parse_filters joins the script arguments with spaces: refuse one that would fall
# apart there. Filter values ("--host a, b") are split on commas and may hold spaces.
skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; continue; fi
  case "$a" in
    --host|--hosts|--os|--role|--trimurti) skip=1; continue ;;
    --host=*|--hosts=*|--os=*|--role=*|--trimurti=*) continue ;;
  esac
  case "$a" in *[[:space:]]*) bad_usage "argument '$a' contains whitespace: arguments reach the script unquoted, so each must be one word" ;; esac
done
set -f
# shellcheck disable=SC2086
set -- $REST
set +f
TTY=0; while [ "${1:-}" = "--tty" ]; do TTY=1; shift; done
BASE="${1:-}"; [ -n "$BASE" ] || bad_usage "no script given"
shift
case "$BASE" in .*|*[!A-Za-z0-9._-]*) bad_usage "not a script name: $BASE" ;; esac
SCRIPTS="$OPS_DIR/scripts"; LOGS="$OUT_DIR/logs"
[ -f "$SCRIPTS/$BASE.sh" ] || [ -f "$SCRIPTS/$BASE.ps1" ] || bad_usage "no $BASE.sh or $BASE.ps1 in $SCRIPTS"
for a in "$@"; do
  case "$a" in *[!A-Za-z0-9._=:/,@+\\-]*) bad_usage "argument '$a': only letters, digits and . _ = : / , @ + \\ - are allowed" ;; esac
done
ARGS="$*"
[ "$TTY" = 0 ] || has_tty || bad_usage "--tty needs a terminal to type sudo passwords into; run it yourself in a terminal"

PASSED=""; FAILED=""; REBOOT=""; RAN=0
summary() {
  printf 'TRIMURTI_SUMMARY passed=%s\n' "$PASSED"
  printf 'TRIMURTI_SUMMARY failed=%s\n' "$FAILED"
  printf 'TRIMURTI_SUMMARY reboot_required=%s\n' "$REBOOT"
}
mkdir -p "$LOGS"
( check_inventory ) || { summary; exit 1; }
HOSTS="$(select_hosts)"; [ -n "$HOSTS" ] || { fail "no hosts selected from $INVENTORY"; summary; exit 1; }
ESC="$(printf '\033')"; BEL="$(printf '\007')"

KEY_PROBLEM="$(key_problem)"
if [ -n "$KEY_PROBLEM" ]; then
  fail "$KEY_PROBLEM"
  while IFS=, read -r name ip mac os user role port trimurti notes; do
    [ -n "$(ssh_skip_reason "$user" "$port")" ] || FAILED="${FAILED:+$FAILED,}$name"
  done <<< "$HOSTS"
  summary; exit 1
fi

while IFS=, read -r name ip mac os user role port trimurti notes <&3; do
  why="$(ssh_skip_reason "$user" "$port")"
  if [ -n "$why" ]; then warn "$name: skipped, $why"; continue; fi
  RAN=$((RAN + 1)); rc=1
  target="$(ssh_target "$user" "$ip" "$name")"
  logf="$LOGS/$name-$BASE-$(date +%Y%m%d-%H%M%S)-$$.log"
  tag="$$-$RANDOM"   # a remote file of its own, so two jobs on one host do not clash
  if [ "$(lower "$os")" = "windows" ]; then src="$SCRIPTS/$BASE.ps1"; remote="trimurti-$BASE-$tag.ps1"
  else src="$SCRIPTS/$BASE.sh"; remote="/tmp/trimurti-$BASE-$tag.sh"; fi
  if [ ! -f "$src" ]; then fail "$name: no ${src##*/} for a $os host"; FAILED="${FAILED:+$FAILED,}$name"; continue; fi
  log "$name: ${src##*/} -> $target (log: $logf)"
  printf '# %s %s on %s (%s)\n' "$(date '+%F %T')" "${src##*/}${ARGS:+ $ARGS}" "$name" "$target" > "$logf"
  # shellcheck disable=SC2086
  if err="$(scp $SSH_OPTS "${KEY_OPTS[@]}" -P "$port" "$src" "$target:$remote" </dev/null 2>&1)"; then
    if [ "$(lower "$os")" = "windows" ]; then
      # -File works whether the login shell is cmd or powershell; its exit code is the script's.
      # shellcheck disable=SC2086
      ssh $SSH_OPTS "${KEY_OPTS[@]}" -p "$port" "$target" "powershell -NoProfile -ExecutionPolicy Bypass -File $remote $ARGS" </dev/null 2>&1 | tee -a "$logf"
      rc=${PIPESTATUS[0]}
      # shellcheck disable=SC2086
      ssh $SSH_OPTS "${KEY_OPTS[@]}" -p "$port" "$target" "del $remote" </dev/null >/dev/null 2>&1 || true
    elif [ "$TTY" = 1 ]; then
      # shellcheck disable=SC2086
      ssh -t $SSH_OPTS "${KEY_OPTS[@]}" -p "$port" "$target" "bash $remote $ARGS; c=\$?; rm -f $remote; exit \$c" 2>&1 | tee -a "$logf"
      rc=${PIPESTATUS[0]}
    else
      # shellcheck disable=SC2086
      ssh $SSH_OPTS "${KEY_OPTS[@]}" -p "$port" "$target" "bash $remote $ARGS; c=\$?; rm -f $remote; exit \$c" </dev/null 2>&1 | tee -a "$logf"
      rc=${PIPESTATUS[0]}
    fi
  else
    printf '%s\n' "$err" | tee -a "$logf" >&2
    rc="copy failed"
  fi
  # the log without terminal colours and CRs (ssh -t and Windows add them)
  tr -d '\r' < "$logf" | LC_ALL=C sed -e "s/$ESC\[[0-9;?]*[A-Za-z]//g" -e "s/$ESC][^$ESC$BEL]*$ESC\\\\//g" -e "s/$ESC][^$BEL]*$BEL//g" \
    > "$logf.tmp" && mv "$logf.tmp" "$logf"
  grep -q '^REBOOT_REQUIRED=yes' "$logf" && REBOOT="${REBOOT:+$REBOOT,}$name"
  if [ "$rc" = 0 ]; then ok "$name: exit 0"; PASSED="${PASSED:+$PASSED,}$name"
  elif [ "$rc" = "copy failed" ]; then fail "$name: could not copy ${src##*/} to $target"; FAILED="${FAILED:+$FAILED,}$name"
  else fail "$name: exit $rc"; FAILED="${FAILED:+$FAILED,}$name"; fi
done 3<<< "$HOSTS"

[ "$RAN" -gt 0 ] || fail "none of the selected hosts can be reached over SSH (see the skip reasons above): nothing ran"
summary
[ -z "$FAILED" ] && [ "$RAN" -gt 0 ]
