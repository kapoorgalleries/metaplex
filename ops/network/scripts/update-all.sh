#!/usr/bin/env bash
# Update this macOS or Linux machine: OS packages, Homebrew, snap/flatpak if
# present, and the three AI CLIs. Never reboots; prints REBOOT_REQUIRED=yes
# when one is needed so you can schedule it. Run on the target, or push it
# with:  run-remote.sh --os linux --tty update-all   (--tty so sudo can ask).
#
# Usage: update-all.sh [--no-os] [--no-clis]
set -u
NO_OS=0; NO_CLIS=0
for a in "$@"; do
  case "$a" in --no-os) NO_OS=1 ;; --no-clis) NO_CLIS=1 ;; *) echo "unknown flag: $a" >&2; exit 2 ;; esac
done
log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"
OS="$(uname -s)"; REBOOT=no
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export DEBIAN_FRONTEND=noninteractive

if [ "$NO_OS" = 0 ]; then
  if [ "$OS" = "Darwin" ]; then
    log "macOS software update (installs what it can without a restart)"
    $SUDO softwareupdate -ia --verbose 2>&1 | tail -15
    softwareupdate -l 2>&1 | grep -qi 'restart' && REBOOT=yes
    if have brew; then log "Homebrew"; brew update >/dev/null 2>&1; brew upgrade; brew cleanup -s >/dev/null 2>&1; fi
    if have mas; then log "App Store"; mas upgrade; fi
  elif have apt-get; then
    log "apt"; $SUDO apt-get update -qq && $SUDO apt-get -y -qq dist-upgrade && $SUDO apt-get -y -qq autoremove
    [ -f /var/run/reboot-required ] && REBOOT=yes
  elif have dnf; then
    log "dnf"; $SUDO dnf -y upgrade --refresh
    if have needs-restarting; then needs-restarting -r >/dev/null 2>&1 || REBOOT=yes; fi
  elif have pacman; then
    log "pacman"; $SUDO pacman -Syu --noconfirm
    [ -d "/usr/lib/modules/$(uname -r)" ] || REBOOT=yes
  elif have zypper; then
    log "zypper"; $SUDO zypper -n update
    zypper ps -s 2>/dev/null | grep -qi reboot && REBOOT=yes
  elif have apk; then
    log "apk"; $SUDO apk update && $SUDO apk upgrade
  fi
  if have snap;    then log "snap";    $SUDO snap refresh; fi
  if have flatpak; then log "flatpak"; flatpak update -y --noninteractive; fi
fi

if [ "$NO_CLIS" = 0 ]; then
  if have claude; then log "Claude Code"; claude update 2>&1 | tail -2; fi
  if have npm; then
    for p in @openai/codex @google/gemini-cli; do
      if npm ls -g --depth=0 "$p" >/dev/null 2>&1; then
        log "$p"; npm install -g --no-fund --no-audit "$p@latest" >/dev/null 2>&1 || echo "  (npm update of $p failed; rerun bootstrap-ai-clis.sh)"
      fi
    done
  fi
fi

log "versions on $(hostname -s):"
for c in claude codex gemini node; do
  if have "$c"; then printf '  %-7s %s\n' "$c" "$("$c" --version 2>&1 | head -1)"; else printf '  %-7s missing\n' "$c"; fi
done
echo "REBOOT_REQUIRED=$REBOOT"
[ "$REBOOT" = yes ] && echo "  -> reboot this machine when convenient (nothing here reboots for you)"
exit 0
