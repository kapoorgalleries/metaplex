#!/usr/bin/env bash
# Update this macOS or Linux machine: OS packages, Homebrew, snap/flatpak if
# present, and the AI CLIs (claude, codex, gemini, hf). Never reboots; prints
# REBOOT_REQUIRED=yes when one is needed so you can schedule it. Run on the
# target, or push it with:  run-remote.sh --os linux --tty update-all   (--tty so sudo can ask).
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
export HF_HUB_DISABLE_UPDATE_CHECK=1   # hf's daily hint goes to stderr ahead of --version; hf update still checks

if [ "$NO_OS" = 0 ]; then
  if [ "$OS" = "Darwin" ]; then
    log "macOS software update (installs what it can; the OS update itself needs a restart and, on Apple silicon, the owner's password: System Settings > General > Software Update)"
    $SUDO softwareupdate -ia --agree-to-license --verbose 2>&1 | tail -15
    softwareupdate -l 2>&1 | grep -qi 'restart' && REBOOT=yes
    if have brew; then log "Homebrew"; brew update >/dev/null 2>&1; brew upgrade; brew cleanup -s >/dev/null 2>&1; fi
    if have mas; then log "App Store"; $SUDO mas update; fi
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
  if have codex; then log "Codex CLI"; codex update 2>&1 | tail -2; fi   # knows whether it came from the installer, brew or npm
  if have npm && npm ls -g --depth=0 @google/gemini-cli >/dev/null 2>&1; then
    log "Gemini CLI"
    npm install -g --no-fund --no-audit @google/gemini-cli@latest >/dev/null 2>&1 || echo "  (npm update of Gemini CLI failed; rerun bootstrap-ai-clis.sh)"
  fi
  if have hf; then log "Hugging Face CLI"; hf update 2>&1 | tail -2; fi   # installer, brew or pip, whichever it came from; refreshes the hf-cli skill
fi

log "versions on $(hostname -s):"
for c in claude codex gemini hf node; do
  if have "$c"; then printf '  %-7s %s\n' "$c" "$("$c" --version 2>&1 | head -1)"; else printf '  %-7s missing\n' "$c"; fi
done
echo "REBOOT_REQUIRED=$REBOOT"
[ "$REBOOT" = yes ] && echo "  -> reboot this machine when convenient (nothing here reboots for you)"
exit 0
