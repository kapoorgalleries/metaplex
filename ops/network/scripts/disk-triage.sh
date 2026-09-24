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

# Raw value of one ATA attribute: column 10, with any "(min max)" tail that some
# firmwares append stripped off. ($NF would pick up that tail and break the test.)
attr() { printf '%s\n' "$1" | awk -v id="$2" '$1 == id {v = $10; gsub(/[^0-9].*/, "", v); print v; exit}'; }
nvme_field() { printf '%s\n' "$1" | awk -F: -v k="$2" 'index($0, k) == 1 {gsub(/[^0-9]/, "", $2); print $2; exit}'; }

smart_verdict() {  # $1 = smartctl -H -A output
  local out="$1" realloc rep_unc cmd_to pend uncorr nvme_err spare used crit
  realloc="$(attr "$out" 5)"; rep_unc="$(attr "$out" 187)"; cmd_to="$(attr "$out" 188)"
  pend="$(attr "$out" 197)"; uncorr="$(attr "$out" 198)"
  nvme_err="$(nvme_field "$out" 'Media and Data Integrity Errors')"
  spare="$(nvme_field "$out" 'Available Spare:')"; used="$(nvme_field "$out" 'Percentage Used')"
  crit="$(printf '%s\n' "$out" | awk -F: '/^Critical Warning/ {gsub(/[[:space:]]/, "", $2); print $2; exit}')"
  if printf '%s' "$out" | grep -qE 'overall-health.*FAILED|Health Status: FAILED'; then
    echo "FAILING (SMART self-assessment failed) - copy data off NOW with ddrescue, then retire"
  elif [ "${pend:-0}" -gt 0 ] 2>/dev/null || [ "${uncorr:-0}" -gt 0 ] 2>/dev/null; then
    echo "FAILING (pending=${pend:-0} uncorrectable=${uncorr:-0} sectors) - copy data off NOW with ddrescue, then retire"
  elif [ "${nvme_err:-0}" -gt 0 ] 2>/dev/null || { [ -n "$crit" ] && [ "$crit" != "0x00" ]; }; then
    echo "FAILING (NVMe media errors=${nvme_err:-0} critical warning=${crit:-none}) - copy data off NOW, then retire"
  elif [ "${realloc:-0}" -gt 0 ] 2>/dev/null || [ "${rep_unc:-0}" -gt 0 ] 2>/dev/null || [ "${cmd_to:-0}" -gt 0 ] 2>/dev/null; then
    echo "WATCH (reallocated=${realloc:-0} reported-uncorrectable=${rep_unc:-0} command-timeouts=${cmd_to:-0}) - ok for an offline copy, never for RAID"
  elif { [ -n "$spare" ] && [ "$spare" -lt 10 ]; } 2>/dev/null || { [ -n "$used" ] && [ "$used" -ge 100 ]; } 2>/dev/null; then
    echo "WATCH (NVMe spare=${spare:-?}% used=${used:-?}%) - near end of life, offline copies only"
  elif printf '%s' "$out" | grep -qE 'overall-health.*PASSED|Health Status: OK|SMART/Health Information'; then
    echo "HEALTHY (run a long self-test before trusting it: smartctl -t long, then smartctl -l selftest)"
  else
    echo "UNKNOWN (SMART not readable through this USB bridge; test it in a SATA bay or the NAS)"
  fi
}

# smartctl output for a device, trying the device types that rescue USB bridges.
smart_read() {
  local d out
  for d in auto sat sat,12 usbjmicron usbsunplus; do
    out="$($SUDO smartctl -H -A -d "$d" "$1" 2>/dev/null)"
    if printf '%s' "$out" | grep -qE 'overall-health|Health Status|SMART/Health Information'; then printf '%s' "$out"; return 0; fi
  done
  printf '%s' "$out"; return 1
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
      out="$(smart_read "$d")" || true
      printf '%s\n' "$out" | awk '
        /overall-health|Health Status/ {print "   " $0}
        /^ *(5|9|187|188|194|196|197|198|199) / {printf "   %-4s %-28s raw=%s\n", $1, $2, $10}
        /Percentage Used|Available Spare:|Media and Data Integrity Errors|Critical Warning|^Temperature:|Power On Hours/ {print "   " $0}'
      $SUDO smartctl -l selftest "$d" 2>/dev/null | awk '/^# *[0-9]/ {n++; if (n <= 2) print "   selftest " $0}'
      echo "   VERDICT $d: $(smart_verdict "$out")"
    done
  else
    echo "smartctl missing:  sudo apt install smartmontools   (dnf/pacman: smartmontools), then rerun"
  fi
  echo; echo "To look inside a drive without writing to it:  sudo blockdev --setro /dev/sdX && sudo mkdir -p /mnt/ro && sudo mount -o ro,noload /dev/sdX1 /mnt/ro"
  echo "   (ro,noload keeps ext4 from replaying its journal; for NTFS use  -t ntfs-3g -o ro)"
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
  echo "note: macOS has no SAT pass-through, so SMART is normally unreadable for USB drives here ('SMART Status: Not Supported'"
  echo "      means unknown, not bad), and the third-party SAT SMART driver does not work on Apple-silicon Macs."
  echo "      For a real answer test the bare drive in a Linux box or a NAS bay."
  if have smartctl; then
    for d in $(diskutil list 2>/dev/null | awk '/^\/dev\/disk[0-9]+ \(/ && !/synthesized/ {print $1}'); do
      echo "--- $d"
      out="$(smart_read "$d")" || true
      printf '%s\n' "$out" | grep -E 'overall-health|Health Status|Reallocated|Reported_Uncorrect|Command_Timeout|Pending|Uncorrectable|Power_On|Temperature|Percentage Used|Available Spare|Media and Data|Critical Warning' | sed 's/^ */   /'
      echo "   VERDICT $d: $(smart_verdict "$out")"
    done
  else
    echo "smartctl missing:  brew install smartmontools"
  fi
  echo; echo "To look inside a drive without writing to it:  diskutil mount readOnly /dev/diskNsM"
fi

echo; echo "saved: $REPORT   -> decide with checklists/hulk-drives.md"
