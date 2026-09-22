#!/usr/bin/env bash
# Read-only look at every disk attached to this macOS or Linux machine: model,
# size, filesystem, mount state, and SMART health with a plain verdict per
# disk (HEALTHY / WATCH / FAILING / UNKNOWN). For the Hulk drives run it on
# the machine they are plugged into. Nothing is written to any disk; the
# report goes to ~/trimurti-disks-<host>-<timestamp>.txt.
#
# Usage: disk-triage.sh
set -u
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"
OS="$(uname -s)"
REPORT="$HOME/trimurti-disks-$(hostname -s)-$(date +%Y%m%d-%H%M%S).txt"
exec > >(tee "$REPORT") 2>&1

echo "== $(hostname) · $(date) · $OS =="

smart_verdict() {  # $1 = smartctl -H -A output
  local out="$1" realloc pend uncorr
  realloc="$(printf '%s\n' "$out" | awk '$1 == 5   {print $NF}')"
  pend="$(printf '%s\n' "$out"    | awk '$1 == 197 {print $NF}')"
  uncorr="$(printf '%s\n' "$out"  | awk '$1 == 198 {print $NF}')"
  if printf '%s' "$out" | grep -qE 'overall-health.*FAILED|Health Status: FAILED'; then
    echo "FAILING (SMART self-assessment failed) - copy data off NOW, then retire"
  elif [ "${pend:-0}" -gt 0 ] 2>/dev/null || [ "${uncorr:-0}" -gt 0 ] 2>/dev/null; then
    echo "FAILING (pending=${pend:-0} uncorrectable=${uncorr:-0} sectors) - copy data off NOW with ddrescue, then retire"
  elif [ "${realloc:-0}" -gt 0 ] 2>/dev/null; then
    echo "WATCH (reallocated sectors=$realloc) - ok for an offline copy, never for RAID"
  elif printf '%s' "$out" | grep -qE 'overall-health.*PASSED|Health Status: OK|Percentage Used'; then
    echo "HEALTHY"
  else
    echo "UNKNOWN (SMART not readable through this USB bridge; test it in a SATA bay or the NAS)"
  fi
}

if [ "$OS" = "Linux" ]; then
  echo; echo "== block devices =="
  lsblk -o NAME,SIZE,TYPE,TRAN,ROTA,MODEL,SERIAL,FSTYPE,LABEL,MOUNTPOINT 2>/dev/null || lsblk
  echo; echo "== filesystems =="
  df -hT -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null || df -h
  [ -r /proc/mdstat ] && { echo; echo "== mdadm =="; cat /proc/mdstat; }
  have zpool && { echo; echo "== zfs ==";   $SUDO zpool status 2>/dev/null; }
  have btrfs && { echo; echo "== btrfs =="; $SUDO btrfs filesystem show 2>/dev/null; }
  echo; echo "== SMART =="
  if have smartctl; then
    for d in $(lsblk -dno NAME,TYPE 2>/dev/null | awk '$2 == "disk" {print "/dev/" $1}'); do
      echo "--- $d  $(lsblk -dno MODEL,SIZE "$d" 2>/dev/null | tr -s ' ')"
      out="$($SUDO smartctl -H -A -d auto "$d" 2>/dev/null)"
      printf '%s' "$out" | grep -q 'SMART' || out="$($SUDO smartctl -H -A -d sat "$d" 2>/dev/null)"
      printf '%s\n' "$out" | awk '
        /overall-health|Health Status/ {print "   " $0}
        /^ *(5|9|187|188|194|196|197|198|199) / {printf "   %-4s %-28s raw=%s\n", $1, $2, $NF}
        /Percentage Used|Available Spare:|Media and Data Integrity Errors|^Temperature:|Power On Hours/ {print "   " $0}'
      echo "   VERDICT $d: $(smart_verdict "$out")"
    done
  else
    echo "smartctl missing:  sudo apt install smartmontools   (dnf/pacman: smartmontools), then rerun"
  fi
  echo; echo "To look inside a drive without writing to it:  sudo mkdir -p /mnt/ro && sudo mount -o ro /dev/sdX1 /mnt/ro"
else
  echo; echo "== disks =="
  diskutil list
  echo; echo "== details =="
  for d in $(diskutil list 2>/dev/null | awk '/^\/dev\/disk[0-9]+ \(/ {print $1}'); do
    echo "--- $d"
    diskutil info "$d" 2>/dev/null | grep -E 'Device / Media Name|Disk Size|Protocol|SMART Status|Solid State|Removable Media|Content \(IOContent\)|Device Location' | sed 's/^ */   /'
  done
  echo; echo "== mounted volumes =="
  df -h 2>/dev/null | grep -E '^Filesystem|^/dev/'
  echo; echo "== SMART =="
  if have smartctl; then
    for d in $(diskutil list 2>/dev/null | awk '/^\/dev\/disk[0-9]+ \(/ && !/synthesized/ {print $1}'); do
      echo "--- $d"
      out="$($SUDO smartctl -H -A "$d" 2>/dev/null)"
      printf '%s\n' "$out" | grep -E 'overall-health|Health Status|Reallocated|Pending|Uncorrectable|Power_On|Temperature|Percentage Used|Media and Data' | sed 's/^ */   /'
      echo "   VERDICT $d: $(smart_verdict "$out")"
    done
  else
    echo "smartctl missing:  brew install smartmontools"
    echo "note: USB enclosures rarely pass SMART through on macOS; 'SMART Status: Not Supported' above means unknown, not bad."
  fi
  echo; echo "To look inside a drive without writing to it:  diskutil mount readOnly /dev/diskNsM"
fi

echo; echo "saved: $REPORT   -> decide with checklists/hulk-drives.md"
