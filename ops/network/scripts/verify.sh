#!/usr/bin/env bash
# The end-state check. For every selected host: ping, key-only SSH login, and
# the versions of claude, codex, gemini and node. Prints a table and saves it
# as Markdown in out/verify-<timestamp>.md so it can be pasted into status.md.
#
# Usage: verify.sh [--host a,b] [--os linux] [--role new] [--trimurti yes]
# shellcheck disable=SC2034  # every inventory column is read, not every one is used
set -u
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
parse_filters "$@"

OS="$(uname -s)"; PING_W="-W 1"; [ "$OS" = "Darwin" ] && PING_W="-W 1000"

UNIX_PROBE='export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
for c in claude codex gemini node; do
  if command -v "$c" >/dev/null 2>&1; then v="$("$c" --version 2>&1 | head -1)"; else v=missing; fi
  printf "%s=%s\n" "$c" "$v"
done
printf "os=%s\n" "$(uname -sr)"'

WIN_PROBE='$env:Path = "$env:USERPROFILE\.local\bin;$env:LOCALAPPDATA\Programs\OpenAI\Codex\bin;$env:APPDATA\npm;" + $env:Path
foreach ($c in "claude","codex","gemini","node") {
  if (Get-Command $c -ErrorAction SilentlyContinue) { $v = (& $c --version 2>&1 | Select-Object -First 1) } else { $v = "missing" }
  "$c=$v"
}
"os=" + (Get-CimInstance Win32_OperatingSystem).Caption'

MD="$OUT_DIR/verify-$(date +%Y%m%d-%H%M%S).md"
{
  printf '| host | ping | ssh key | claude | codex | gemini | node | os |\n|---|---|---|---|---|---|---|---|\n'
} > "$MD"

HOSTS="$(select_hosts)"; [ -n "$HOSTS" ] || die "no hosts selected from $INVENTORY"
OLDIFS="$IFS"; IFS='
'
for row in $HOSTS; do
  IFS="$OLDIFS"
  IFS=, read -r name ip mac os user role port trimurti notes <<< "$row"
  host="${ip:-$name}"; target="$user@$host"
  # shellcheck disable=SC2086
  if ping -c 1 $PING_W "$host" >/dev/null 2>&1; then p="yes"; else p="NO"; fi
  claude=; codex=; gemini=; node=; osname=; sshok="NO"
  if [ "$(lower "$os")" = "windows" ]; then
    out="$(printf '%s\n' "$WIN_PROBE" | ssh $SSH_OPTS -i "$KEY_FILE" -o IdentitiesOnly=yes -o PasswordAuthentication=no -p "$port" "$target" "powershell -NoProfile -Command -" 2>/dev/null)" && sshok="yes"
  else
    out="$(printf '%s\n' "$UNIX_PROBE" | ssh $SSH_OPTS -i "$KEY_FILE" -o IdentitiesOnly=yes -o PasswordAuthentication=no -p "$port" "$target" "bash -s" 2>/dev/null)" && sshok="yes"
  fi
  while IFS='=' read -r k v; do
    case "$k" in
      claude) claude="$v" ;; codex) codex="$v" ;; gemini) gemini="$v" ;; node) node="$v" ;; os) osname="$v" ;;
    esac
  done <<< "$out"
  printf '| %s | %s | %s | %s | %s | %s | %s | %s |\n' "$name" "$p" "$sshok" "${claude:--}" "${codex:--}" "${gemini:--}" "${node:--}" "${osname:--}" | tr -d '\r' >> "$MD"
  IFS='
'
done
IFS="$OLDIFS"

if have column; then column -t -s'|' "$MD"; else cat "$MD"; fi
log "saved: $MD  (paste the table into status.md)"
