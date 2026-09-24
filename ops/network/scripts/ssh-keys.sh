#!/usr/bin/env bash
# One admin key for the whole network. Creates ~/.ssh/id_ed25519_trimurti if
# it does not exist, pushes the public half to every selected host in
# inventory.csv (Windows hosts: administrators_authorized_keys with the right
# ACL, or the user's authorized_keys for non-admins; everything else:
# ~/.ssh/authorized_keys), then proves key-only login to each host.
#
# Run it yourself in a terminal: it asks for the key's passphrase and, on the
# first push to a host, for that host's password. Without a terminal it stops
# and changes nothing, unless --no-passphrase is given (then it makes a key
# without a passphrase, on purpose, and can only check hosts that already have
# the key). A key with a passphrase is loaded into the ssh-agent (on macOS also
# the Keychain); if no agent runs, one is started for this run only. Run this
# from the admin machine (macOS, Linux, or Git Bash / WSL on Windows).
#
# Usage: ssh-keys.sh [--host a,b] [--os windows] [--role new] [--trimurti yes] [--no-passphrase]
# Without --host or --role it covers computers only (role admin, workstation or
# new); name the NAS with --role nas or --host <name>. Never the router. Rows
# with a blank ssh_port (no SSH) are skipped.
# shellcheck disable=SC2034  # every inventory column is read, not every one is used
set -u
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
SCRIPT_FLAGS="--no-passphrase"
parse_filters "$@"
NOPASS=0
set -f
# shellcheck disable=SC2086
for a in $REST; do
  case "$a" in --no-passphrase) NOPASS=1 ;; *) bad_usage "unexpected argument: $a" ;; esac
done
set +f
check_inventory
TTY=0; has_tty && TTY=1
if [ "$TTY" = 0 ] && [ "$NOPASS" = 0 ]; then
  die "no terminal here, so nothing was changed: ssh-keys.sh asks for the key's passphrase and each host's password.
       Run it yourself in a terminal on this machine:  bash scripts/ssh-keys.sh
       (or bash scripts/ssh-keys.sh --no-passphrase for a key without a passphrase)"
fi
HOSTS="$(select_hosts)"; [ -n "$HOSTS" ] || die "no hosts selected from $INVENTORY"

PUB="$KEY_FILE.pub"
umask 077
if [ ! -f "$KEY_FILE" ]; then
  log "creating $KEY_FILE (ed25519)"
  mkdir -p "$(dirname "$KEY_FILE")"
  me="$(hostname -s 2>/dev/null || uname -n)"; me="${me%%.*}"
  if [ "$NOPASS" = 1 ]; then ssh-keygen -q -t ed25519 -a 64 -N "" -C "trimurti-admin@$me" -f "$KEY_FILE" </dev/null
  else ssh-keygen -t ed25519 -a 64 -C "trimurti-admin@$me" -f "$KEY_FILE"; fi || die "ssh-keygen failed"
elif [ "$NOPASS" = 1 ]; then
  warn "$KEY_FILE exists; --no-passphrase only applies when the key is created"
fi
[ -f "$PUB" ] || die "public key missing: $PUB"
PUBKEY="$(cat "$PUB")"

# A key with a passphrase must sit in an ssh-agent, or no BatchMode login (here,
# run-remote.sh, verify.sh, the MCP tools) can use it.
TEMP_AGENT=0
if ! ssh-keygen -y -P '' -f "$KEY_FILE" >/dev/null 2>&1 && ! key_in_agent; then
  [ "$TTY" = 1 ] || die "$(key_problem)"
  ssh-add -l >/dev/null 2>&1
  if [ $? -eq 2 ]; then
    eval "$(ssh-agent -s)" >/dev/null || die "could not start an ssh-agent"
    TEMP_AGENT=1; trap 'ssh-agent -k >/dev/null 2>&1' EXIT
  fi
  log "loading $KEY_FILE into the ssh-agent (type the key's passphrase)"
  if [ "$(local_os)" = macos ]; then ssh-add --apple-use-keychain "$KEY_FILE" || ssh-add -K "$KEY_FILE"
  else ssh-add "$KEY_FILE"; fi || die "could not load $KEY_FILE into the ssh-agent"
fi

LOGIN_ERR=""
test_login() {  # user host port
  LOGIN_ERR="$(ssh $SSH_OPTS "${KEY_OPTS[@]}" -o PasswordAuthentication=no -p "$3" "$1@$2" 'echo TRIMURTI_OK' </dev/null 2>&1)"
  case "$LOGIN_ERR" in *TRIMURTI_OK*) return 0 ;; esac
  LOGIN_ERR="$(printf '%s\n' "$LOGIN_ERR" | tr -d '\r' | grep -v '^[[:space:]]*$' | tail -1)"
  return 1
}

push_unix() {  # user host port
  if have ssh-copy-id; then
    ssh-copy-id -i "$PUB" -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -p "$3" "$1@$2" </dev/null >/dev/null
  else
    ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -p "$3" "$1@$2" \
      "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qF '$PUBKEY' ~/.ssh/authorized_keys || echo '$PUBKEY' >> ~/.ssh/authorized_keys" </dev/null >/dev/null
  fi
}

push_windows() {  # user host port  -- the PowerShell below is fed over stdin, so it works whether the login shell is cmd or powershell
  cat <<EOF | ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -p "$3" "$1@$2" "powershell -NoProfile -ExecutionPolicy Bypass -Command -" >/dev/null
\$k = '$PUBKEY'
\$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (\$isAdmin) { \$f = 'C:\ProgramData\ssh\administrators_authorized_keys' } else { \$f = Join-Path \$env:USERPROFILE '.ssh\authorized_keys' }
\$d = Split-Path -Parent \$f; if (-not (Test-Path \$d)) { New-Item -ItemType Directory -Path \$d -Force | Out-Null }
if (-not (Test-Path \$f)) { New-Item -ItemType File -Path \$f -Force | Out-Null }
if (-not (Select-String -Path \$f -SimpleMatch -Pattern \$k -Quiet)) { Add-Content -Path \$f -Value \$k }
if (\$isAdmin) { icacls.exe \$f /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null }
Write-Output "key installed in \$f"

EOF
}

RESULTS="$OUT_DIR/ssh-keys-$(date +%Y%m%d-%H%M%S).txt"; : > "$RESULTS"
while IFS=, read -r name ip mac os user role port trimurti notes <&3; do
  host="${ip:-$name}"
  why="$(ssh_skip_reason "$user" "$port")"
  if [ -n "$why" ]; then warn "$name: skipped, $why"; echo "$name SKIP ($why)" >> "$RESULTS"; continue; fi
  log "$name  ($user@$host:$port, $os)"
  if test_login "$user" "$host" "$port"; then
    ok "$name: key login already works"; echo "$name PASS" >> "$RESULTS"; continue
  fi
  if [ "$TTY" = 0 ]; then
    fail "$name: key login fails ($LOGIN_ERR); pushing the key needs $user@$host's password: run ssh-keys.sh in a terminal"
    echo "$name FAIL" >> "$RESULTS"; continue
  fi
  if [ "$(lower "$os")" = "windows" ]; then push_err="$(push_windows "$user" "$host" "$port" 2>&1)"
  else push_err="$(push_unix "$user" "$host" "$port" 2>&1)"; fi
  if test_login "$user" "$host" "$port"; then
    ok "$name: key login PASS"; echo "$name PASS" >> "$RESULTS"
  else
    push_err="$(printf '%s\n' "$push_err" | tr -d '\r' | grep -v '^[[:space:]]*$' | tail -1)"
    fail "$name: key login still FAILS: ${push_err:+push: $push_err; }login: $LOGIN_ERR (see README, 'SSH troubleshooting')"
    echo "$name FAIL" >> "$RESULTS"
  fi
done 3<<< "$HOSTS"
log "results in $RESULTS:"; cat "$RESULTS"
if [ "$TEMP_AGENT" = 1 ]; then
  warn "no ssh-agent was running, so the key was held by one started for this run only, now stopped.
       run-remote.sh, verify.sh and the MCP tools need it in an agent: in the shell that runs them,
       eval \"\$(ssh-agent -s)\"; ssh-add $KEY_FILE    (Git Bash: add both lines to ~/.bashrc)"
fi
grep -q ' FAIL$' "$RESULTS" && exit 1 || exit 0
