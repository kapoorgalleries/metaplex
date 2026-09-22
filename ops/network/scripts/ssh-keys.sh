#!/usr/bin/env bash
# One admin key for the whole network. Creates ~/.ssh/id_ed25519_trimurti if
# it does not exist, pushes the public half to every selected host in
# inventory.csv (Windows hosts: administrators_authorized_keys with the right
# ACL, or the user's authorized_keys for non-admins; everything else:
# ~/.ssh/authorized_keys), then proves key-only login to each host.
#
# The first push to a host asks for that host's password once. After it
# PASSes, every other script here uses the key. Run this from the admin
# machine (macOS, Linux, or Git Bash / WSL on Windows).
#
# Usage: ssh-keys.sh [--host a,b] [--os windows] [--role new] [--trimurti yes] [--no-passphrase]
# shellcheck disable=SC2034  # every inventory column is read, not every one is used
set -u
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
parse_filters "$@"
NOPASS=0; case " $REST " in *" --no-passphrase "*) NOPASS=1 ;; esac

PUB="$KEY_FILE.pub"
if [ ! -f "$KEY_FILE" ]; then
  log "creating $KEY_FILE (ed25519)"
  umask 077; mkdir -p "$HOME/.ssh"
  if [ "$NOPASS" = 1 ]; then ssh-keygen -t ed25519 -a 64 -N "" -C "trimurti-admin@$(hostname -s)" -f "$KEY_FILE"
  else ssh-keygen -t ed25519 -a 64 -C "trimurti-admin@$(hostname -s)" -f "$KEY_FILE"; fi
fi
[ -f "$PUB" ] || die "public key missing: $PUB"
PUBKEY="$(cat "$PUB")"
ssh-add "$KEY_FILE" >/dev/null 2>&1 || true

test_login() {  # user host port
  ssh $SSH_OPTS -i "$KEY_FILE" -o IdentitiesOnly=yes -o PasswordAuthentication=no -p "$3" "$1@$2" 'echo TRIMURTI_OK' </dev/null 2>/dev/null | grep -q TRIMURTI_OK
}

push_unix() {  # user host port
  if have ssh-copy-id; then
    ssh-copy-id -i "$PUB" -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -p "$3" "$1@$2" </dev/null >/dev/null 2>&1
  else
    ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -p "$3" "$1@$2" \
      "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qF '$PUBKEY' ~/.ssh/authorized_keys || echo '$PUBKEY' >> ~/.ssh/authorized_keys" </dev/null
  fi
}

push_windows() {  # user host port  -- the PowerShell below is fed over stdin, so it works whether the login shell is cmd or powershell
  cat <<EOF | ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -p "$3" "$1@$2" "powershell -NoProfile -ExecutionPolicy Bypass -Command -"
\$k = '$PUBKEY'
\$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (\$isAdmin) { \$f = 'C:\ProgramData\ssh\administrators_authorized_keys' } else { \$f = Join-Path \$env:USERPROFILE '.ssh\authorized_keys' }
\$d = Split-Path -Parent \$f; if (-not (Test-Path \$d)) { New-Item -ItemType Directory -Path \$d -Force | Out-Null }
if (-not (Test-Path \$f)) { New-Item -ItemType File -Path \$f -Force | Out-Null }
if (-not (Select-String -Path \$f -SimpleMatch -Pattern \$k -Quiet)) { Add-Content -Path \$f -Value \$k }
if (\$isAdmin) { icacls.exe \$f /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null }
Write-Output "key installed in \$f"
EOF
}

HOSTS="$(select_hosts)"; [ -n "$HOSTS" ] || die "no hosts selected from $INVENTORY"
RESULTS="$OUT_DIR/ssh-keys-$(date +%Y%m%d-%H%M%S).txt"; : > "$RESULTS"
OLDIFS="$IFS"; IFS='
'
for row in $HOSTS; do
  IFS="$OLDIFS"
  IFS=, read -r name ip mac os user role port trimurti notes <<< "$row"
  host="${ip:-$name}"
  log "$name  ($user@$host:$port, $os)"
  if test_login "$user" "$host" "$port"; then
    ok "$name: key login already works"; echo "$name PASS" >> "$RESULTS"; continue
  fi
  if [ "$(lower "$os")" = "windows" ]; then push_windows "$user" "$host" "$port"; else push_unix "$user" "$host" "$port"; fi
  if test_login "$user" "$host" "$port"; then
    ok "$name: key login PASS"; echo "$name PASS" >> "$RESULTS"
  else
    fail "$name: key login still FAILS (see README, 'SSH troubleshooting')"; echo "$name FAIL" >> "$RESULTS"
  fi
  IFS='
'
done
IFS="$OLDIFS"
log "results in $RESULTS:"; cat "$RESULTS"
grep -q FAIL "$RESULTS" && exit 1 || exit 0
