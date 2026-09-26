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
# from the admin machine (macOS, Linux, or Git Bash on Windows; not WSL).
# Every push offers only the admin key (IdentitiesOnly), so an ssh-agent full of
# other keys cannot use up the host's login attempts before the password prompt.
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

# Password pushes offer the admin key alone (-i, IdentitiesOnly): with every key of an
# ssh-agent on offer, sshd's MaxAuthTries (6) runs out before it asks for the password.
push_unix() {  # user host port
  if have ssh-copy-id; then
    ssh-copy-id -i "$PUB" -o "IdentityFile=\"$KEY_FILE\"" -o IdentitiesOnly=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new \
      -p "$3" "$1@$2" </dev/null >/dev/null
  else
    # a last line without a newline would swallow the key into its comment
    ssh "${KEY_OPTS[@]}" -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -p "$3" "$1@$2" \
      "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qF '$PUBKEY' ~/.ssh/authorized_keys || { [ -z \"\$(tail -c 1 ~/.ssh/authorized_keys)\" ] || echo >> ~/.ssh/authorized_keys; echo '$PUBKEY' >> ~/.ssh/authorized_keys; }" </dev/null >/dev/null
  fi
}

# The PowerShell below is fed over stdin, so it works whether the login shell is cmd or
# powershell. '-Command -' runs stdin one line at a time and drops an unfinished statement
# at EOF: every statement is one line, and the blank line at the end must stay. Like
# enable-ssh-server.ps1, it rebuilds the file (UTF-8 without BOM, one key per LF line, the
# key matched on type and body) instead of appending to it, then sets and checks the ACL
# sshd demands of administrators_authorized_keys, and exits 1 with the reason on stderr.
push_windows() {  # user host port
  {
    printf "\$k = '%s'\n" "$(printf '%s' "$PUBKEY" | sed "s/'/''/g")"
    cat <<'EOF'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) { $f = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys' } else { $f = Join-Path $env:USERPROFILE '.ssh\authorized_keys' }
$err = ''; $lines = @()
try { $d = Split-Path -Parent $f; if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force -ErrorAction Stop | Out-Null } } catch { $err = "could not create ${d}: $($_.Exception.Message)" }
if (-not $err -and (Test-Path -LiteralPath $f)) { try { $b = [IO.File]::ReadAllBytes($f); if ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE) { $t = [Text.Encoding]::Unicode.GetString($b, 2, $b.Length - 2) } elseif ($b.Length -ge 2 -and $b[0] -eq 0xFE -and $b[1] -eq 0xFF) { $t = [Text.Encoding]::BigEndianUnicode.GetString($b, 2, $b.Length - 2) } elseif ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $t = [Text.Encoding]::UTF8.GetString($b, 3, $b.Length - 3) } else { $t = [Text.Encoding]::UTF8.GetString($b) }; $lines = @($t -split '\r?\n') } catch { $err = "could not read it: $($_.Exception.Message)" } }
$keys = @($lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ }); $body = ($k -split '\s+')[0..1] -join ' '
if (@($keys | Where-Object { (($_ -split '\s+')[0..1] -join ' ') -eq $body }).Count -eq 0) { $keys += $k }
if (-not $err) { try { [IO.File]::WriteAllText($f, (($keys -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false)) } catch { $err = "could not write it: $($_.Exception.Message)" } }
if (-not $err -and $isAdmin) { $ic = Join-Path $env:SystemRoot 'System32\icacls.exe'; foreach ($a in @(@($f, '/reset'), @($f, '/setowner', '*S-1-5-32-544'), @($f, '/inheritance:r', '/grant:r', '*S-1-5-32-544:F', '*S-1-5-18:F'))) { if (-not $err) { $o = (& $ic @a 2>&1 | Out-String).Trim(); if ($LASTEXITCODE -ne 0) { $err = "icacls $($a -join ' ') failed ($LASTEXITCODE): $o" } } } }
if (-not $err -and $isAdmin) { try { $acl = Get-Acl -LiteralPath $f; $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; if ('S-1-5-32-544', 'S-1-5-18' -notcontains $owner) { $err = "sshd would refuse it: owner is $owner" }; foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) { if ('S-1-5-32-544', 'S-1-5-18' -notcontains $r.IdentityReference.Value) { $err = "sshd would refuse it: $($r.IdentityReference.Value) has access" } } } catch { $err = "could not check its ACL: $($_.Exception.Message)" } }
if ($err) { [Console]::Error.WriteLine("key NOT installed in ${f}: $err"); exit 1 }
Write-Output "key installed in $f ($($keys.Count) key(s))"

EOF
  } | ssh "${KEY_OPTS[@]}" -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -p "$3" "$1@$2" "powershell -NoProfile -ExecutionPolicy Bypass -Command -" >/dev/null
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
    case "$push_err" in   # sshd hung up before it asked for the password
      *"Too many authentication failures"*|*"Disconnected from"*|*"Received disconnect"*)
        hint=" (the host closed the connection before asking for the password: its MaxAuthTries ran out on the keys ssh offered; check IdentityFile lines in ~/.ssh/config)" ;;
      *) hint="" ;;
    esac
    push_err="$(printf '%s\n' "$push_err" | tr -d '\r' | grep -v '^[[:space:]]*$')"
    case "$push_err" in   # push_windows' own reason, else ssh's last word
      *"key NOT installed"*) push_err="$(printf '%s\n' "$push_err" | grep 'key NOT installed' | tail -1)" ;;
      *) push_err="$(printf '%s\n' "$push_err" | tail -1)" ;;
    esac
    fail "$name: key login still FAILS: ${push_err:+push: $push_err$hint; }login: $LOGIN_ERR (see README, 'SSH troubleshooting')"
    echo "$name FAIL" >> "$RESULTS"
  fi
done 3<<< "$HOSTS"
log "results in $RESULTS:"; cat "$RESULTS"
if [ "$TEMP_AGENT" = 1 ]; then
  warn "no ssh-agent was running, so the key was held by one started for this run only, now stopped.
       The AI agent's shells cannot type the passphrase: they need an ssh-agent holding the key when
       the session starts. Start (or restart) it with launch.sh (launch.ps1 on Windows), which loads
       the key first$([ "$(local_os)" = macos ] && printf '; on macOS, ssh-add --apple-use-keychain in any terminal also works')."
fi
grep -q ' FAIL$' "$RESULTS" && exit 1
grep -q -v ' SKIP (' "$RESULTS" || { warn "no host was pushed to (every selected host was skipped, or none was selected)"; exit 1; }
exit 0
