#!/usr/bin/env bash
# Turn on the OpenSSH server on this macOS or Linux machine, open the firewall
# for it, and make sure the login user's ~/.ssh is usable. Idempotent.
#
# --harden switches password logins OFF (key only) through a drop-in file and
# rolls itself back if sshd rejects the config. Only run --harden after
# ssh-keys.sh has shown key login to this host PASSing, and keep a second
# terminal open while you re-test.
#
# Usage: enable-ssh-server.sh [--harden]
set -eu
HARDEN=0; [ "${1:-}" = "--harden" ] && HARDEN=1
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"
OS="$(uname -s)"
SVC=""

umask 077
mkdir -p "$HOME/.ssh"; touch "$HOME/.ssh/authorized_keys"
chmod 700 "$HOME/.ssh"; chmod 600 "$HOME/.ssh/authorized_keys"

if [ "$OS" = "Darwin" ]; then
  if $SUDO systemsetup -getremotelogin 2>/dev/null | grep -qi ': on'; then
    echo "Remote Login already on"
  else
    $SUDO systemsetup -setremotelogin on 2>/dev/null || $SUDO launchctl load -w /System/Library/LaunchDaemons/ssh.plist 2>/dev/null || true
    if ! $SUDO systemsetup -getremotelogin 2>/dev/null | grep -qi ': on'; then
      echo "Could not enable Remote Login from the shell (macOS wants Full Disk Access for the terminal app)."
      echo "Turn it on in System Settings > General > Sharing > Remote Login, allow your user, then rerun."
      exit 1
    fi
  fi
else
  if ! have sshd; then
    if   have apt-get; then $SUDO apt-get update -qq && $SUDO apt-get install -y -qq openssh-server
    elif have dnf;     then $SUDO dnf install -y openssh-server
    elif have pacman;  then $SUDO pacman -Sy --noconfirm openssh
    elif have zypper;  then $SUDO zypper install -y openssh-server
    elif have apk;     then $SUDO apk add openssh-server
    else echo "install openssh-server with your package manager, then rerun"; exit 1; fi
  fi
  SVC=sshd; systemctl cat ssh.service >/dev/null 2>&1 && SVC=ssh
  $SUDO systemctl enable --now "$SVC"
  if have ufw && $SUDO ufw status 2>/dev/null | grep -q 'Status: active'; then
    $SUDO ufw allow OpenSSH >/dev/null 2>&1 || $SUDO ufw allow 22/tcp >/dev/null
  fi
  if have firewall-cmd && $SUDO firewall-cmd --state >/dev/null 2>&1; then
    $SUDO firewall-cmd --permanent --add-service=ssh >/dev/null && $SUDO firewall-cmd --reload >/dev/null
  fi
fi

if [ "$HARDEN" = 1 ]; then
  SSHD_DIR=/etc/ssh/sshd_config.d
  if ! grep -qs '^Include /etc/ssh/sshd_config.d/' /etc/ssh/sshd_config; then
    echo "/etc/ssh/sshd_config does not Include sshd_config.d; add these lines to it by hand instead:"
    echo "  PubkeyAuthentication yes / PasswordAuthentication no / KbdInteractiveAuthentication no / PermitRootLogin no"
    exit 1
  fi
  $SUDO mkdir -p "$SSHD_DIR"
  printf 'PubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' \
    | $SUDO tee "$SSHD_DIR/50-trimurti.conf" >/dev/null
  if $SUDO sshd -t; then
    if [ "$OS" = "Darwin" ]; then $SUDO launchctl kickstart -k system/com.openssh.sshd; else $SUDO systemctl restart "$SVC"; fi
    echo "password logins are now OFF on this host (key only). Re-test from another terminal before closing this one."
  else
    $SUDO rm -f "$SSHD_DIR/50-trimurti.conf"
    echo "sshd -t rejected the config; hardening rolled back"; exit 1
  fi
fi

echo "sshd is on. Add this row to inventory.csv:"
if [ "$OS" = "Darwin" ]; then
  ip="$(ipconfig getifaddr "$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')" 2>/dev/null)"
else
  ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
fi
echo "  name=$(hostname -s)  ip=${ip:-?}  user=$(id -un)  os=$( [ "$OS" = "Darwin" ] && echo macos || echo linux )"
