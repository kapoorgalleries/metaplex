#!/usr/bin/env bash
# The end-state check. For every selected host: ping, key-only SSH login, and
# the versions of claude, codex, gemini and node. Prints a table and saves it
# as Markdown in out/verify-<timestamp>.md so it can be pasted into status.md.
#
# Usage: verify.sh [--host a,b] [--os linux] [--role new] [--trimurti yes]
# Lists every inventory row except the router. Only computers (role admin,
# workstation or new) need the CLIs and count for the verdict; other rows show
# n/a there. A computer is green when it pings, the key logs in and all four
# versions are present. This machine's own row is probed locally when its
# ssh_port is blank. Exits 0 when every selected computer is green, 1 if not.
# shellcheck disable=SC2034  # every inventory column is read, not every one is used
set -u
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
parse_filters "$@"
case "$REST" in *[![:space:]]*) bad_usage "unexpected argument:$REST" ;; esac
check_inventory

UNIX_PROBE='export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
for c in claude codex gemini node; do
  if command -v "$c" >/dev/null 2>&1; then v="$("$c" --version 2>&1 | head -1)"; else v=missing; fi
  printf "%s=%s\n" "$c" "$v"
done
if [ -r /etc/os-release ]; then os="$(. /etc/os-release; printf "%s" "${PRETTY_NAME:-}")"; fi
if [ -z "${os:-}" ] && command -v sw_vers >/dev/null 2>&1; then os="$(sw_vers -productName) $(sw_vers -productVersion)"; fi
printf "os=%s\n" "${os:-$(uname -sr)}"'

# Fed to "powershell -Command -", which runs stdin one statement at a time and
# drops an unfinished multi-line statement at EOF: keep each statement on one line.
WIN_PROBE='$env:Path = "$env:USERPROFILE\.local\bin;$env:LOCALAPPDATA\Programs\OpenAI\Codex\bin;$env:APPDATA\npm;" + $env:Path
foreach ($c in "claude","codex","gemini","node") { $v = "missing"; if (Get-Command $c -ErrorAction SilentlyContinue) { try { $v = (& $c --version 2>&1 | Select-Object -First 1) } catch { $v = "error: " + $_.Exception.Message } }; "$c=$v" }
"os=" + (Get-CimInstance Win32_OperatingSystem).Caption'
WIN_PS="powershell -NoProfile -ExecutionPolicy Bypass -Command -"

MD="$OUT_DIR/verify-$(date +%Y%m%d-%H%M%S).md"
{
  printf '| host | ping | ssh key | claude | codex | gemini | node | os |\n|---|---|---|---|---|---|---|---|\n'
} > "$MD"

HOSTS="$(select_hosts all)"; [ -n "$HOSTS" ] || die "no hosts selected from $INVENTORY"
KEY_PROBLEM="$(key_problem)"; [ -z "$KEY_PROBLEM" ] || warn "$KEY_PROBLEM"
LOCAL_IPS=" $(local_ips | tr '\n' ' ') "
cell() { printf '%s' "${1:--}" | tr '|' '/'; }
COMPUTERS=0; NOT_GREEN=""; OTHERS=""
while IFS=, read -r name ip mac os user role port trimurti notes <&3; do
  host="${ip:-$name}"; target="$user@$host"
  if ping_host "$host"; then p="yes"; else p="NO"; fi
  claude=; codex=; gemini=; node=; osname=; sshok="NO"; out=""; rc=255
  why="$(ssh_skip_reason "$user" "$port")"
  win=0; [ "$(lower "$os")" = "windows" ] && win=1
  if [ -n "$why" ] && [ -n "$ip" ] && case "$LOCAL_IPS" in *" $ip "*) true ;; *) false ;; esac; then
    sshok="n/a"   # this machine: no SSH needed, probe it here
    if [ "$win" = 1 ]; then out="$(printf '%s\n\n' "$WIN_PROBE" | $WIN_PS 2>/dev/null)"; else out="$(printf '%s\n' "$UNIX_PROBE" | bash -s 2>/dev/null)"; fi
  elif [ -n "$why" ]; then
    sshok="$why"
  else
    # shellcheck disable=SC2086
    if [ "$win" = 1 ]; then
      out="$(printf '%s\n\n' "$WIN_PROBE" | ssh $SSH_OPTS "${KEY_OPTS[@]}" -o PasswordAuthentication=no -p "$port" "$target" "$WIN_PS" 2>/dev/null)"; rc=$?
    elif is_computer "$role"; then
      out="$(printf '%s\n' "$UNIX_PROBE" | ssh $SSH_OPTS "${KEY_OPTS[@]}" -o PasswordAuthentication=no -p "$port" "$target" "bash -s" 2>/dev/null)"; rc=$?
    else
      out="$(ssh $SSH_OPTS "${KEY_OPTS[@]}" -o PasswordAuthentication=no -p "$port" "$target" "echo ok" </dev/null 2>/dev/null)"; rc=$?
    fi
    [ "$rc" -ne 255 ] && sshok="yes"   # 255 is ssh's own failure; anything else came from the host
  fi
  while IFS='=' read -r k v; do
    v="${v%$'\r'}"
    case "$k" in
      claude) claude="$v" ;; codex) codex="$v" ;; gemini) gemini="$v" ;; node) node="$v" ;; os) osname="$v" ;;
    esac
  done <<< "$out"
  if is_computer "$role"; then
    COMPUTERS=$((COMPUTERS + 1)); bad=""
    [ "$p" = yes ] || bad="$bad, no ping"
    case "$sshok" in yes|n/a) ;; NO) bad="$bad, key login fails" ;; *) bad="$bad, $sshok" ;; esac
    for c in "claude=$claude" "codex=$codex" "gemini=$gemini" "node=$node"; do
      case "${c#*=}" in ""|missing|error:*) bad="$bad, ${c%%=*} missing" ;; esac
    done
    [ -z "$bad" ] || NOT_GREEN="$NOT_GREEN
  $name: ${bad#, }"
  else
    claude="n/a"; codex="n/a"; gemini="n/a"; node="n/a"; OTHERS="$OTHERS $name"
  fi
  printf '| %s | %s | %s | %s | %s | %s | %s | %s |\n' "$name" "$p" "$(cell "$sshok")" "$(cell "$claude")" "$(cell "$codex")" \
    "$(cell "$gemini")" "$(cell "$node")" "$(cell "$osname")" >> "$MD"
done 3<<< "$HOSTS"

if have column; then column -t -s'|' "$MD"; else cat "$MD"; fi
log "saved: $MD"
log "paste the table into status.md"
[ -z "$OTHERS" ] || log "not counted (not a computer):$OTHERS"
if [ -n "$NOT_GREEN" ]; then
  fail "$(printf '%s' "$NOT_GREEN" | grep -c .) of $COMPUTERS computers not green:$NOT_GREEN"
  exit 1
fi
if [ "$COMPUTERS" = 0 ]; then log "no computer selected, so nothing counts toward the verdict"
else ok "all $COMPUTERS selected computers are green"; fi
