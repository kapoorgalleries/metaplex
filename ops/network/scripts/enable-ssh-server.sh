#!/usr/bin/env bash
# Turn on the OpenSSH server on this macOS or Linux machine, open the firewall
# for it, and make sure the login user's ~/.ssh is usable. Idempotent. Run it
# as the user who will log in, without sudo: it calls sudo itself. Under sudo
# it prepares $SUDO_USER's ~/.ssh, not root's.
#
# --harden switches password logins OFF (key only) through a drop-in that sorts
# first (sshd_config.d/00-trimurti.conf; sshd keeps the first value it reads).
# It refuses to start when the existing config is already invalid, and keeps its
# file only when 'sshd -T' then shows key-only as the effective setting;
# otherwise it removes the file again, names the files that override it, and
# leaves sshd untouched. Only run --harden after ssh-keys.sh has shown key login
# to this host PASSing, and keep a second terminal open while you re-test.
#
# Exit: 0 done, 1 failed, 2 bad arguments.
# Usage: enable-ssh-server.sh [--harden] [--user NAME]
set -eu

usage() {
  cat <<'EOF'
Usage: enable-ssh-server.sh [--harden] [--user NAME]
Turns sshd on, opens the firewall for it and prepares the login user's ~/.ssh.
Run it as that user, without sudo (it calls sudo itself).
  --harden      password logins off (key only); ask Sanjay first
  --user NAME   prepare NAME's ~/.ssh (default: the user running it, or $SUDO_USER under sudo)
  -h, --help    this text
Exit: 0 done, 1 failed, 2 bad arguments.
EOF
}

HARDEN=0; TARGET_USER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --harden) HARDEN=1 ;;
    --user) [ $# -ge 2 ] || { echo "--user needs a name" >&2; usage >&2; exit 2; }; TARGET_USER="$2"; shift ;;
    --user=*) TARGET_USER="${1#--user=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown flag: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"
OS="$(uname -s)"
HOST="$(uname -n)"; HOST="${HOST%%.*}"
# sshd, ufw and firewall-cmd live in sbin, which is not on a normal user's PATH on Debian.
PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"
SVC=""

U="${TARGET_USER:-${SUDO_USER:-$(id -un)}}"
id "$U" >/dev/null 2>&1 || { echo "no such user: $U" >&2; exit 2; }
if [ "$U" = "$(id -un)" ]; then H="$HOME"
elif [ "$OS" = "Darwin" ]; then H="$(dscl . -read "/Users/$U" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
else H="$(getent passwd "$U" | cut -d: -f6)"; fi
[ -n "$H" ] && [ -d "$H" ] || { echo "no home directory for $U"; exit 1; }

# Everything below needs root: fail fast when sudo would have to ask and cannot.
if [ "$(id -u)" -ne 0 ]; then
  [ -n "$SUDO" ] || { echo "this needs root and sudo is not installed on $HOST: run it as root with --user NAME"; exit 1; }
  if ! sudo -n true 2>/dev/null && ! ( : </dev/tty ) 2>/dev/null; then
    echo "sudo needs a password on $HOST: rerun with --tty or run it locally"; exit 1
  fi
fi

umask 077
G="$(id -g "$U")"
if [ -e "$H/.ssh" ] && [ "$(ls -ldn "$H/.ssh" | awk '{print $3}')" != "$(id -u "$U")" ]; then
  $SUDO chown -R "$U:$G" "$H/.ssh"   # left root-owned by an earlier run under sudo
fi
if [ "$U" = "$(id -un)" ]; then
  mkdir -p "$H/.ssh"; touch "$H/.ssh/authorized_keys"
else
  $SUDO mkdir -p "$H/.ssh"; $SUDO touch "$H/.ssh/authorized_keys"
  $SUDO chown "$U:$G" "$H/.ssh" "$H/.ssh/authorized_keys"
fi
$SUDO chmod 700 "$H/.ssh"; $SUDO chmod 600 "$H/.ssh/authorized_keys"

# pid of the listening sshd, for systems without systemd or OpenRC
sshd_pid() {
  local f
  for f in /run/sshd.pid /var/run/sshd.pid; do
    [ -r "$f" ] && [ -d "/proc/$(cat "$f")" ] && { cat "$f"; return 0; }
  done
  pgrep -xo sshd 2>/dev/null
}
systemd_up() { have systemctl && [ -d /run/systemd/system ]; }

restart_sshd() {
  local pid
  if [ "$OS" = "Darwin" ]; then
    # launchd starts a fresh sshd for each connection, so this is belt and braces
    $SUDO launchctl kickstart -k system/com.openssh.sshd 2>/dev/null || true
  elif systemd_up; then $SUDO systemctl restart "$SVC"
  elif have rc-service; then $SUDO rc-service sshd restart
  elif pid="$(sshd_pid)"; then $SUDO sh -c 'kill -HUP "$1"' sh "$pid"   # sshd re-reads its config on SIGHUP
  else echo "could not find the running sshd: restart it by hand so the change takes effect"; return 1; fi
}

if [ "$OS" = "Darwin" ]; then
  if $SUDO systemsetup -getremotelogin 2>/dev/null | grep -qi ': on'; then
    echo "Remote Login already on"
  else
    out="$($SUDO systemsetup -setremotelogin on 2>&1)" || true
    if printf '%s' "$out" | grep -qi 'Full Disk Access'; then
      echo "$out"
      echo "This terminal app needs Full Disk Access for that command (System Settings > Privacy & Security > Full Disk Access)."
    fi
    if ! $SUDO systemsetup -getremotelogin 2>/dev/null | grep -qi ': on'; then
      # launchd route (the old 'launchctl load -w' is deprecated)
      $SUDO launchctl enable system/com.openssh.sshd 2>/dev/null || true
      $SUDO launchctl bootstrap system /System/Library/LaunchDaemons/ssh.plist 2>/dev/null || true
    fi
    if ! $SUDO systemsetup -getremotelogin 2>/dev/null | grep -qi ': on'; then
      echo "Could not enable Remote Login from the shell."
      echo "System Settings > General > Sharing > Remote Login: on. Then the (i) button: 'Allow access for' All users, or add your user,"
      echo "and tick 'Allow full disk access for remote users' if SSH sessions must reach protected folders. Rerun afterwards."
      exit 1
    fi
  fi
else
  if ! have sshd; then
    if   have apt-get; then
      { $SUDO apt-get update -qq && $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssh-server; } \
        || { echo "could not install openssh-server"; exit 1; }
    elif have dnf;     then $SUDO dnf install -y openssh-server || { echo "could not install openssh-server"; exit 1; }
    # No -y: installing against a freshly synced database without upgrading everything is a partial upgrade.
    elif have pacman;  then $SUDO pacman -S --needed --noconfirm openssh \
      || { echo "pacman could not install openssh from the current package database: update the system first (update-all.sh runs a full pacman -Syu), then rerun"; exit 1; }
    elif have zypper;  then $SUDO zypper install -y openssh-server || { echo "could not install openssh-server"; exit 1; }
    elif have apk;     then $SUDO apk add openssh-server || { echo "could not install openssh-server"; exit 1; }
    else echo "install openssh-server with your package manager, then rerun"; exit 1; fi
  fi
  if systemd_up; then
    SVC=sshd; systemctl cat ssh.service >/dev/null 2>&1 && SVC=ssh
    $SUDO systemctl enable --now "$SVC"
  elif have rc-service; then   # OpenRC (Alpine)
    $SUDO rc-update add sshd default >/dev/null; $SUDO rc-service sshd start
  elif sshd_pid >/dev/null; then
    echo "sshd is running, but not under systemd or OpenRC: make sure this system starts it at boot"
  else
    echo "no systemd or OpenRC here: start sshd with this system's init system, then rerun"; exit 1
  fi
  if have ufw && $SUDO ufw status 2>/dev/null | grep -q 'Status: active'; then
    $SUDO ufw allow OpenSSH >/dev/null 2>&1 || $SUDO ufw allow 22/tcp >/dev/null
  fi
  if have firewall-cmd && $SUDO firewall-cmd --state >/dev/null 2>&1; then
    $SUDO firewall-cmd --permanent --add-service=ssh >/dev/null && $SUDO firewall-cmd --reload >/dev/null
  fi
fi

if [ "$HARDEN" = 1 ]; then
  SSHD_DIR=/etc/ssh/sshd_config.d; DROPIN="$SSHD_DIR/00-trimurti.conf"
  if ! $SUDO grep -qs '^Include /etc/ssh/sshd_config.d/' /etc/ssh/sshd_config; then
    echo "/etc/ssh/sshd_config does not Include sshd_config.d; add these lines to it by hand instead:"
    echo "  PubkeyAuthentication yes / PasswordAuthentication no / KbdInteractiveAuthentication no / PermitRootLogin no"
    exit 1
  fi
  # A config sshd already rejects has to be fixed first: the next sshd restart or reboot would lock everyone out.
  if ! err="$($SUDO sshd -t 2>&1)"; then
    printf '%s\n' "$err"
    echo "The existing sshd config is already invalid, so nothing was changed. Fix it before hardening,"
    echo "and do NOT restart sshd or reboot this machine until 'sudo sshd -t' prints nothing: sshd would not come back."
    exit 1
  fi
  $SUDO mkdir -p "$SSHD_DIR"
  printf 'PubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' \
    | $SUDO tee "$DROPIN" >/dev/null
  if ! err="$($SUDO sshd -t 2>&1)"; then
    $SUDO rm -f "$DROPIN"
    printf '%s\n' "$err"
    echo "sshd -t rejected the hardened config; removed $DROPIN again. sshd was not restarted: nothing changed."
    exit 1
  fi
  # What sshd would really use, as the admin machine connecting as this user sees it.
  addr="${SSH_CLIENT:-}"; addr="${addr%% *}"; addr="${addr:-127.0.0.1}"
  eff="$($SUDO sshd -T -C "user=$U,host=$addr,addr=$addr" 2>/dev/null)" || eff="$($SUDO sshd -T 2>/dev/null)" || eff=""
  eff="$(printf '%s\n' "$eff" | tr '[:upper:]' '[:lower:]')"
  bad=""
  for kv in "passwordauthentication no" "permitrootlogin no" "pubkeyauthentication yes"; do
    printf '%s\n' "$eff" | grep -qx "$kv" || bad="$bad ${kv%% *}"
  done
  if printf '%s\n' "$eff" | grep -qx -e 'kbdinteractiveauthentication yes' -e 'challengeresponseauthentication yes'; then
    bad="$bad kbdinteractiveauthentication"
  fi
  if [ -n "$bad" ]; then
    $SUDO rm -f "$DROPIN"
    echo "Hardening NOT applied: even with $DROPIN, sshd -T still shows:"
    printf '%s\n' "$eff" | grep -E '^(passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication|permitrootlogin|pubkeyauthentication) ' || echo "  (sshd -T printed nothing)"
    echo "These lines set them (sshd keeps the first value it reads; a Match block overrides it per connection):"
    $SUDO sh -c 'grep -H -n -i -E "^[[:space:]]*(passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication|permitrootlogin|pubkeyauthentication|match)[[:space:]]" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/* 2>/dev/null' || true
    echo "Removed $DROPIN again and did not restart sshd, so nothing changed. Fix those lines (with Sanjay's yes), then rerun --harden."
    exit 1
  fi
  $SUDO rm -f "$SSHD_DIR/50-trimurti.conf"   # this script's earlier name for the same file
  if ! restart_sshd; then
    echo "The hardened config is valid, but sshd did not restart. Keep this session open and check the sshd service."
    exit 1
  fi
  echo "password logins are now OFF on this host (key only; sshd -T agrees). Re-test from another terminal before closing this one."
fi

echo "sshd is on. Add this row to inventory.csv:"
if [ "$OS" = "Darwin" ]; then
  ip="$(ipconfig getifaddr "$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')" 2>/dev/null)" || ip=""
else
  ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
fi
echo "  name=$HOST  ip=${ip:-?}  user=$U  os=$( [ "$OS" = "Darwin" ] && echo macos || echo linux )"
if [ "$U" = root ]; then
  echo "  (user=root: rerun as the everyday login user, or with --user NAME, so that user's ~/.ssh is prepared)"
fi
