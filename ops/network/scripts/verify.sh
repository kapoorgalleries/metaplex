#!/usr/bin/env bash
# The end-state check. For every selected host: ping, key-only SSH login, and
# the versions of claude, codex, gemini, hf and node. Prints a table and saves
# it as Markdown in out/verify-<timestamp>-<pid>.md (the "saved:" line names
# it) so it can be pasted into status.md.
#
# Usage: verify.sh [--host a,b] [--os linux] [--role new] [--trimurti yes]
# Lists every inventory row except the router. Only computers (role admin,
# workstation or new) need the CLIs and count for the verdict; other rows show
# n/a there. A computer is green when it pings, the key logs in, all five
# --version calls succeed and node is 20 or newer. This machine's own row is
# probed locally when its ssh_port is blank. When the admin key cannot be used
# (missing, or locked with no ssh-agent holding it) or a login fails, that is
# said once and the CLI cells show '?' (not checked). Exits 0 when every
# selected computer is green, 1 if not.
# shellcheck disable=SC2034  # every inventory column is read, not every one is used
set -u
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
parse_filters "$@"
case "$REST" in *[![:space:]]*) bad_usage "unexpected argument:$REST" ;; esac
check_inventory

UNIX_PROBE='export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export HF_HUB_DISABLE_UPDATE_CHECK=1   # else hf may print its daily hint (stderr) before the version
for c in claude codex gemini hf node; do
  if ! command -v "$c" >/dev/null 2>&1; then v=missing
  elif o="$("$c" --version 2>&1 </dev/null)"; then v="$(printf "%s\n" "$o" | head -1)"; [ -n "$v" ] || v="error: printed no version"
  else v="error: $(printf "%s\n" "$o" | head -1)"; fi
  printf "%s=%s\n" "$c" "$v"
done
if [ -r /etc/os-release ]; then os="$(. /etc/os-release; printf "%s" "${PRETTY_NAME:-}")"; fi
if [ -z "${os:-}" ] && command -v sw_vers >/dev/null 2>&1; then os="$(sw_vers -productName) $(sw_vers -productVersion)"; fi
printf "os=%s\n" "${os:-$(uname -sr)}"'

# Fed to "powershell -Command -", which runs stdin one statement at a time and
# drops an unfinished multi-line statement at EOF: keep each statement on one line.
WIN_PROBE='$env:Path = "$env:USERPROFILE\.local\bin;$env:LOCALAPPDATA\Programs\OpenAI\Codex\bin;$env:APPDATA\npm;" + $env:Path
$env:HF_HUB_DISABLE_UPDATE_CHECK = "1"
foreach ($c in "claude","codex","gemini","hf","node") { $v = "missing"; if (Get-Command $c -ErrorAction SilentlyContinue) { try { $global:LASTEXITCODE = 0; $o = @(& $c --version 2>&1 | ForEach-Object { "$_" }); $v = "$($o | Select-Object -First 1)"; if ($LASTEXITCODE -ne 0) { $v = "error: $v" } elseif (-not $v) { $v = "error: printed no version" } } catch { $v = "error: " + $_.Exception.Message } }; "$c=$v" }
"os=" + (Get-CimInstance Win32_OperatingSystem).Caption'
WIN_PS="powershell -NoProfile -ExecutionPolicy Bypass -Command -"

MD="$OUT_DIR/verify-$(date +%Y%m%d-%H%M%S)-$$.md"   # $$: two runs in one second get a file each
{
  printf '| host | ping | ssh key | claude | codex | gemini | hf | node | os |\n|---|---|---|---|---|---|---|---|---|\n'
} > "$MD"

HOSTS="$(select_hosts all)"; [ -n "$HOSTS" ] || die "no hosts selected from $INVENTORY"
# The admin key's problem, said once here; the rows show it short and skip SSH.
KEY_PROBLEM="$(key_problem)"; KEY_CELL=""
case "$KEY_PROBLEM" in
  "") ;;
  "admin key not found"*) KEY_CELL="no admin key" ;;
  "key is passphrase-protected"*) KEY_CELL="key locked" ;;
  *) KEY_CELL="key unusable" ;;
esac
[ -z "$KEY_PROBLEM" ] || warn "$KEY_PROBLEM"
LOCAL_IPS=" $(local_ips | tr '\n' ' ') "
ERRF="$(mktemp "${TMPDIR:-/tmp}/trimurti-verify.XXXXXX")" || die "mktemp failed"
trap 'rm -f "$ERRF"' EXIT
cell() { printf '%s' "${1:--}" | tr '|' '/'; }
COMPUTERS=0; NOT_GREEN=""; NG=0; OTHERS=""
while IFS=, read -r name ip mac os user role port trimurti notes <&3; do
  host="${ip:-$name}"; target="$user@$host"
  if ping_host "$host"; then p="yes"; else p="NO"; fi
  claude=; codex=; gemini=; hf=; node=; osname=; sshok="NO"; out=""; rc=255; loginerr=""
  why="$(ssh_skip_reason "$user" "$port")"
  win=0; [ "$(lower "$os")" = "windows" ] && win=1
  if [ -n "$why" ] && [ -n "$ip" ] && case "$LOCAL_IPS" in *" $ip "*) true ;; *) false ;; esac; then
    sshok="n/a"   # this machine: no SSH needed, probe it here
    if [ "$win" = 1 ]; then out="$(printf '%s\n\n' "$WIN_PROBE" | $WIN_PS 2>/dev/null)"; else out="$(printf '%s\n' "$UNIX_PROBE" | bash -s 2>/dev/null)"; fi
  elif [ -n "$why" ]; then
    sshok="$why"
  elif [ -n "$KEY_CELL" ]; then
    sshok="$KEY_CELL"   # not tried: ssh would fail on every host for the reason above
  else
    # shellcheck disable=SC2086
    if [ "$win" = 1 ]; then
      out="$(printf '%s\n\n' "$WIN_PROBE" | ssh $SSH_OPTS "${KEY_OPTS[@]}" -o PasswordAuthentication=no -p "$port" "$target" "$WIN_PS" 2>"$ERRF")"; rc=$?
    elif is_computer "$role"; then
      out="$(printf '%s\n' "$UNIX_PROBE" | ssh $SSH_OPTS "${KEY_OPTS[@]}" -o PasswordAuthentication=no -p "$port" "$target" "bash -s" 2>"$ERRF")"; rc=$?
    else
      out="$(ssh $SSH_OPTS "${KEY_OPTS[@]}" -o PasswordAuthentication=no -p "$port" "$target" "echo ok" </dev/null 2>"$ERRF")"; rc=$?
    fi
    if [ "$rc" -ne 255 ]; then sshok="yes"   # 255 is ssh's own failure; anything else came from the host
    else loginerr="$(tr -d '\r' < "$ERRF" | grep -v '^[[:space:]]*$' | tail -1)"; fi
  fi
  while IFS='=' read -r k v; do
    v="${v%$'\r'}"
    case "$k" in
      claude) claude="$v" ;; codex) codex="$v" ;; gemini) gemini="$v" ;; hf) hf="$v" ;; node) node="$v" ;; os) osname="$v" ;;
    esac
  done <<< "$out"
  if is_computer "$role"; then
    COMPUTERS=$((COMPUTERS + 1)); bad=""
    [ "$p" = yes ] || bad="$bad, no ping"
    case "$sshok" in
      yes|n/a)
        for c in "claude=$claude" "codex=$codex" "gemini=$gemini" "hf=$hf" "node=$node"; do
          case "${c#*=}" in ""|missing) bad="$bad, ${c%%=*} missing" ;; error:*) bad="$bad, ${c%%=*} does not run (${c#*=error: })" ;; esac
        done
        m="${node#v}"; m="${m%%.*}"
        case "$m" in ''|*[!0-9]*) ;; *) [ "$m" -ge 20 ] || bad="$bad, node $node is too old (need 20+)" ;; esac ;;
      *)  # nothing was probed, so the CLIs are unknown rather than missing
        claude="?"; codex="?"; gemini="?"; hf="?"; node="?"
        case "$sshok" in
          NO) bad="$bad, key login fails${loginerr:+ ($loginerr)}, CLIs not checked" ;;
          *)  bad="$bad, $sshok, CLIs not checked" ;;
        esac ;;
    esac
    [ -z "$bad" ] || { NG=$((NG + 1)); NOT_GREEN="$NOT_GREEN
  $name: ${bad#, }"; }
  else
    claude="n/a"; codex="n/a"; gemini="n/a"; hf="n/a"; node="n/a"; OTHERS="$OTHERS $name"
  fi
  printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' "$name" "$p" "$(cell "$sshok")" "$(cell "$claude")" "$(cell "$codex")" \
    "$(cell "$gemini")" "$(cell "$hf")" "$(cell "$node")" "$(cell "$osname")" >> "$MD"
done 3<<< "$HOSTS"

if have column; then column -t -s'|' "$MD"; else cat "$MD"; fi
log "saved: $MD"
log "paste the table into status.md"
[ -z "$OTHERS" ] || log "not counted (not a computer):$OTHERS"
if [ -n "$NOT_GREEN" ]; then
  fail "$NG of $COMPUTERS computers not green:$NOT_GREEN"
  exit 1
fi
if [ "$COMPUTERS" = 0 ]; then log "no computer selected, so nothing counts toward the verdict"
else ok "all $COMPUTERS selected computers are green"; fi
