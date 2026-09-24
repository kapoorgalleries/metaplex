#!/usr/bin/env bash
# Update this macOS or Linux machine: OS packages, Homebrew, snap/flatpak if
# present, and the three AI CLIs. Never reboots; prints REBOOT_REQUIRED=yes
# when one is needed so you can schedule it. Removes nothing (no autoremove,
# no Homebrew cleanup) unless --cleanup, and leaves a new major macOS version
# alone unless --major-upgrade: both need Sanjay's yes. Run on the target, or
# push it with:  run-remote.sh --os linux --tty update-all   (--tty so sudo can ask).
#
# Last line: REBOOT_REQUIRED=yes|no|unknown. Exit: 0 every step worked, 1 a step
# failed (UPDATE_FAILED= names it), 2 bad arguments.
#
# Usage: update-all.sh [--no-os] [--no-clis] [--cleanup] [--major-upgrade]
set -u

usage() {
  cat <<'EOF'
Usage: update-all.sh [--no-os] [--no-clis] [--cleanup] [--major-upgrade]
Updates OS packages, Homebrew, snap/flatpak and the AI CLIs. Never reboots.
  --no-os          skip OS packages, Homebrew, App Store, snap and flatpak
  --no-clis        skip claude, codex and gemini
  --cleanup        also remove packages and caches: apt dist-upgrade removals and autoremove,
                   Homebrew cleanup (ask Sanjay first)
  --major-upgrade  macOS: also install a new major macOS version (ask Sanjay first)
  -h, --help       this text
Last line: REBOOT_REQUIRED=yes|no|unknown. Exit: 0 all steps worked, 1 a step failed, 2 bad arguments.
EOF
}

NO_OS=0; NO_CLIS=0; CLEANUP=0; MAJOR=0
for a in "$@"; do
  case "$a" in
    --no-os) NO_OS=1 ;;
    --no-clis) NO_CLIS=1 ;;
    --cleanup) CLEANUP=1 ;;
    --major-upgrade) MAJOR=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown flag: $a" >&2; usage >&2; exit 2 ;;
  esac
done
log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"
OS="$(uname -s)"; REBOOT=unknown; FAILED=""
HOST="$(uname -n)"; HOST="${HOST%%.*}"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH:/usr/local/sbin:/usr/sbin:/sbin"
failed() { FAILED="$FAILED $1"; warn "$1 failed"; }

# Root for package managers: fail fast when sudo would have to ask and cannot.
need_sudo() {
  [ "$(id -u)" -eq 0 ] && return 0
  if [ -z "$SUDO" ]; then warn "OS updates need root and sudo is not installed on $HOST"; return 1; fi
  sudo -n true 2>/dev/null && return 0
  ( : </dev/tty ) 2>/dev/null && return 0
  warn "sudo needs a password on $HOST: rerun with --tty or run it locally"; return 1
}

# sudo drops DEBIAN_FRONTEND, so pass it through env; keep changed config files without asking.
apt_get() {
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get -y -qq \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"
}

# Installs what softwareupdate offers, one label at a time. A new major macOS
# version is only listed unless --major-upgrade. REBOOT=yes only when an update
# that needs a restart was installed by this run.
macos_updates() {
  local list items cur label title ver act major name rc r
  log "macOS software update (on Apple silicon the OS update itself may need the owner's password: System Settings > General > Software Update)"
  list="$(softwareupdate -l 2>&1)" || { printf '%s\n' "$list" | tail -5; return 1; }
  items="$(printf '%s\n' "$list" | awk '
    /^\* Label: / { label = substr($0, 10); next }
    label != "" && /Title: / {
      line = $0; sub(/^[ \t]*/, "", line)
      n = split(line, f, ", "); title = ""; ver = ""; act = "no"
      for (i = 1; i <= n; i++) {
        if (f[i] ~ /^Title: /) title = substr(f[i], 8)
        else if (f[i] ~ /^Version: /) ver = substr(f[i], 10)
        else if (f[i] ~ /^Action: (restart|shut down)/) act = "yes"
      }
      print label "|" title "|" ver "|" act; label = ""
    }')"
  if [ -z "$items" ]; then
    case "$list" in *"No new software available"*) log "macOS: nothing to install"; REBOOT=no; return 0 ;; esac
    printf '%s\n' "$list" | tail -5
    warn "could not read the softwareupdate list; use System Settings > General > Software Update"; return 1
  fi
  cur="$(sw_vers -productVersion 2>/dev/null)"; cur="${cur%%.*}"
  REBOOT=no; rc=0; MAJOR_PENDING=""
  while IFS='|' read -r label title ver act; do
    [ -n "$label" ] || continue
    major=""; name="$title"
    case "$title" in *"$ver"*) ;; *) name="$title $ver" ;; esac
    case "$title" in macOS*) [ -n "$cur" ] && [ -n "$ver" ] && [ "${ver%%.*}" != "$cur" ] && major=yes ;; esac
    if [ -n "$major" ] && [ "$MAJOR" = 0 ]; then MAJOR_PENDING="$MAJOR_PENDING${MAJOR_PENDING:+, }$name"; continue; fi
    log "installing $name"
    if [ -n "$major" ]; then
      $SUDO softwareupdate -i "$label" --agree-to-license --verbose 2>&1 | tail -5; r=${PIPESTATUS[0]}
    else
      $SUDO softwareupdate -i "$label" --verbose 2>&1 | tail -5; r=${PIPESTATUS[0]}
    fi
    if [ "$r" -eq 0 ]; then [ "$act" = yes ] && REBOOT=yes
    else warn "softwareupdate could not install $name (pending until someone installs it in System Settings)"; rc=1; fi
  done <<EOF
$items
EOF
  [ -z "$MAJOR_PENDING" ] || echo "MACOS_MAJOR_UPGRADE_AVAILABLE=$MAJOR_PENDING (not installed: ask Sanjay, then rerun with --major-upgrade)"
  return "$rc"
}

brew_updates() {
  local out
  log "Homebrew"
  # brew upgrade deletes old versions by itself unless told not to.
  [ "$CLEANUP" = 1 ] || export HOMEBREW_NO_INSTALL_CLEANUP=1
  out="$(brew update 2>&1)" || { printf '%s\n' "$out" | tail -5; failed "brew-update"; return; }
  brew upgrade || failed brew-upgrade
  if [ "$CLEANUP" = 1 ]; then brew cleanup -s >/dev/null 2>&1 || failed brew-cleanup; fi
}

linux_packages() {
  local n r
  if have apt-get; then
    log "apt"
    if [ "$CLEANUP" = 1 ]; then
      apt_get -o APT::Update::Error-Mode=any update && apt_get dist-upgrade && apt_get autoremove || failed apt
    else
      # upgrade --with-new-pkgs takes new kernels but never removes a package.
      apt_get -o APT::Update::Error-Mode=any update && apt_get upgrade --with-new-pkgs || failed apt
      n="$(apt-get -s autoremove 2>/dev/null | grep -c '^Remv')"
      [ "${n:-0}" -gt 0 ] && echo "  $n package(s) are no longer needed; --cleanup removes them (apt autoremove)"
    fi
  elif have dnf; then
    log "dnf"; $SUDO dnf -y upgrade --refresh || failed dnf
  elif have pacman; then
    log "pacman"; $SUDO pacman -Syu --noconfirm || failed pacman
  elif have zypper; then
    log "zypper"; $SUDO zypper -n update; r=$?
    if [ "$r" = 103 ]; then $SUDO zypper -n update; r=$?; fi   # 103: zypper updated itself; run it again
    case "$r" in 0) ;; 102) REBOOT=yes ;; *) failed zypper ;; esac
  elif have apk; then
    log "apk"; { $SUDO apk update && $SUDO apk upgrade; } || failed apk
  else
    warn "no known package manager on $HOST"; failed os-packages
  fi
  if have snap; then log "snap"; $SUDO snap refresh || failed snap; fi
}

# yes|no|unknown from what the system itself records; read-only.
linux_reboot() {
  local out newest
  if have apt-get; then
    if [ -f /var/run/reboot-required ]; then echo yes; else echo no; fi
  elif have dnf; then
    # --disablerepo: the check must not need the network (a failed repo load also exits 1).
    out="$(dnf -q --disablerepo='*' needs-restarting -r 2>&1)"
    case "$out" in
      *"Reboot is required"*) echo yes; return ;;
      *"should not be necessary"*) echo no; return ;;
    esac
    newest="$(rpm -q --last kernel-core 2>/dev/null)" || newest=""
    newest="$(printf '%s\n' "$newest" | awk 'NR == 1 {print $1}')"; newest="${newest#kernel-core-}"
    if [ -z "$newest" ]; then echo unknown; elif [ "$newest" = "$(uname -r)" ]; then echo no; else echo yes; fi
  elif have pacman || have apk; then
    if [ -d "/usr/lib/modules/$(uname -r)" ] || [ -d "/lib/modules/$(uname -r)" ]; then echo no; else echo yes; fi
  elif have zypper; then
    zypper needs-rebooting >/dev/null 2>&1
    case $? in 0) echo no ;; 102) echo yes ;; *) echo unknown ;; esac
  else
    echo unknown
  fi
}

if [ "$NO_OS" = 0 ]; then
  if [ "$OS" = "Darwin" ]; then
    if need_sudo; then
      macos_updates || failed softwareupdate
      if have mas; then log "App Store"; $SUDO mas update || failed mas; fi
    else
      failed softwareupdate
    fi
    if have brew; then brew_updates; fi
  else
    if need_sudo; then linux_packages; else failed os-packages; fi
    if have flatpak; then log "flatpak"; flatpak update -y --noninteractive || failed flatpak; fi
  fi
fi
if [ "$OS" != "Darwin" ]; then
  r="$(linux_reboot)"; [ "$REBOOT" = yes ] || REBOOT="$r"
fi

if [ "$NO_CLIS" = 0 ]; then
  if have claude; then
    log "Claude Code"; claude update 2>&1 | tail -2; [ "${PIPESTATUS[0]}" -eq 0 ] || failed claude
  fi
  if have codex; then   # codex update knows whether it came from the installer, brew or npm
    log "Codex CLI"; codex update 2>&1 | tail -2; [ "${PIPESTATUS[0]}" -eq 0 ] || failed codex
  fi
  if have npm && npm ls -g --depth=0 @google/gemini-cli >/dev/null 2>&1; then
    log "Gemini CLI"
    npm install -g --no-fund --no-audit @google/gemini-cli@latest >/dev/null 2>&1 \
      || { echo "  (npm update of Gemini CLI failed; rerun bootstrap-ai-clis.sh)"; failed gemini; }
  fi
fi

log "versions on $HOST:"
for c in claude codex gemini node; do
  if have "$c"; then printf '  %-7s %s\n' "$c" "$("$c" --version 2>&1 | head -1)"; else printf '  %-7s missing\n' "$c"; fi
done
f="${FAILED# }"; [ -z "$f" ] || echo "UPDATE_FAILED=${f// /,}"
[ "$REBOOT" = yes ] && echo "  -> reboot this machine when convenient (nothing here reboots for you)"
echo "REBOOT_REQUIRED=$REBOOT"
[ -z "$FAILED" ]
