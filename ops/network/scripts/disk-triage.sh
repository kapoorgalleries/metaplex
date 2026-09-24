#!/usr/bin/env bash
# Read-only look at every disk attached to this macOS or Linux machine: model,
# size, filesystem, mount state, and SMART health with a plain verdict per
# disk (HEALTHY / WATCH / FAILING / UNKNOWN). For the Hulk drives run it on
# the machine they are plugged into. Nothing is written to any disk. Run from
# the kit, the report is saved as out/disks-<host>-<timestamp>.txt; pushed by
# run-remote.sh (or the MCP), nothing is saved on the target and the admin
# machine keeps the output in out/logs/. SMART needs root: without a terminal,
# sudo must work without a password (run-remote.sh --tty otherwise).
#
# Usage: disk-triage.sh
# Exit: 0 every disk got a verdict, 1 a step failed (no root, smartctl missing), 2 bad arguments.
set -u
usage() { printf '%s\n' "Usage: disk-triage.sh" "Read-only disk and SMART report with a HEALTHY / WATCH / FAILING / UNKNOWN verdict per disk." \
  "Exit: 0 every disk got a verdict, 1 a step failed (no root, smartctl missing), 2 bad arguments."; }
for a in "$@"; do
  case "$a" in
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $a" >&2; usage >&2; exit 2 ;;
  esac
done
have() { command -v "$1" >/dev/null 2>&1; }
OS="$(uname -s)"
HOST="${HOSTNAME:-$(uname -n)}"; HOST="${HOST%%.*}"   # no hostname(1) on Arch or minimal Fedora
FAILED=""

# SMART needs root. Without a terminal sudo cannot ask, so stop here instead of
# reporting every disk as unreadable.
SUDO=""
if [ "$(id -u)" -ne 0 ] && { have smartctl || have zpool || have btrfs; }; then
  if ! have sudo; then
    echo "SMART needs root on $HOST and sudo is not installed: run it as root"; exit 1
  fi
  SUDO="sudo"
  if ! sudo -n true 2>/dev/null; then
    if ( : </dev/tty ) 2>/dev/null; then sudo -v || { echo "sudo failed on $HOST"; exit 1; }
    else echo "sudo needs a password on $HOST: rerun with --tty or run it locally"; exit 1; fi
  fi
fi

# In the kit: a copy in out/. A lone copy (run-remote.sh puts one in /tmp) saves nothing.
REPORT=""
KIT="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
if [ -f "$KIT/lib.sh" ]; then
  OUT="${OUT_DIR:-$KIT/../out}"
  mkdir -p "$OUT" 2>/dev/null && REPORT="$(cd "$OUT" && pwd)/disks-$HOST-$(date +%Y%m%d-%H%M%S).txt"
fi
[ -n "$REPORT" ] && exec > >(tee "$REPORT") 2>&1

echo "== $HOST · $(date) · $OS =="

# Raw value of one ATA attribute: column 10, with any "(min max)" tail that some
# firmwares append stripped off. ($NF would pick up that tail and break the test.)
attr() { printf '%s\n' "$1" | awk -v id="$2" '$1 == id {v = $10; gsub(/[^0-9].*/, "", v); print v; exit}'; }
# 188 Command_Timeout is three 16-bit counters, shown "a b c" (raw16) or, with an older
# drive database, packed into one number (4295032833 = 1 1 1). Read both as raw16's first.
cmd_timeouts() { printf '%s\n' "$1" | awk '$1 == 188 {v = $10; if (NF == 10 && v + 0 > 65535) v = int(v / 4294967296); gsub(/[^0-9].*/, "", v); print v; exit}'; }
nvme_field() { printf '%s\n' "$1" | awk -F: -v k="$2" 'index($0, k) == 1 {gsub(/[^0-9]/, "", $2); print $2; exit}'; }

# The newest failed self-test that no later successful extended test has cleared
# (smartctl's own rule), or nothing. ATA, NVMe and SCSI logs; newest first.
selftest_failure() {
  printf '%s\n' "$1" | awk '/^ *#? *[0-9]+ +[A-Za-z]/ {
    l = $0
    if (l ~ /[Ff]ail|Fatal/ && l !~ /without error/) { sub(/^ *#? *[0-9]+ +/, "", l); gsub(/  +/, " ", l); print l; exit }
    if (l ~ /Extended|[Ll]ong/ && l ~ /Completed/ && l !~ /[Aa]bort|[Ii]nterrupt/) exit }'
}

smart_verdict() {  # $1 = smartctl -H -A output, $2 = smartctl -l selftest output
  local out="$1" realloc rep_unc cmd_to pend uncorr nvme_err spare used crit bad=0 hot=0 health grown st worn rsvd now past
  realloc="$(attr "$out" 5)"; rep_unc="$(attr "$out" 187)"; cmd_to="$(cmd_timeouts "$out")"
  pend="$(attr "$out" 197)"; uncorr="$(attr "$out" 198)"
  nvme_err="$(nvme_field "$out" 'Media and Data Integrity Errors')"
  spare="$(nvme_field "$out" 'Available Spare:')"; used="$(nvme_field "$out" 'Percentage Used')"
  crit="$(printf '%s\n' "$out" | awk -F: '/^Critical Warning/ {gsub(/[[:space:]]/, "", $2); print $2; exit}')"
  # NVMe critical warning bits: 0x01 spare low, 0x04 reliability degraded, 0x08 read-only,
  # 0x20 PMR read-only = failing; 0x02 temperature, 0x10 backup power = watch
  case "$crit" in 0x[0-9a-fA-F][0-9a-fA-F]) bad=$((crit & 0x2D)); hot=$((crit & 0x12)) ;; esac
  health="$(printf '%s\n' "$out" | sed -n 's/^SMART Health Status: *//p' | head -1)"   # SCSI/SAS
  grown="$(printf '%s\n' "$out" | awk -F: '/^Elements in grown defect list/ {gsub(/[^0-9]/, "", $2); print $2; exit}')"
  # attributes smartctl flags: FAILING_NOW on a pre-fail one fails the drive, anything else is wear or history
  now="$(printf '%s\n' "$out" | awk '$1 ~ /^[0-9]+$/ && $9 == "FAILING_NOW" && $7 == "Pre-fail" {printf "%s%s", s, $2; s = ","}')"
  past="$(printf '%s\n' "$out" | awk '$1 ~ /^[0-9]+$/ && ($9 == "In_the_past" || ($9 == "FAILING_NOW" && $7 != "Pre-fail")) {printf "%s%s", s, $2; s = ","}')"
  # SATA SSD life left (normalized value counts down from 100) and used reserve blocks
  worn="$(printf '%s\n' "$out" | awk '$1 ~ /^[0-9]+$/ && $2 ~ /Wear_Leveling_Count|Media_Wearout_Indicator|SSD_Life_Left|Percent_Lifetime_Remain|Remaining_Lifetime_Perc|Percent_Life_Remaining|Available_Reservd_Space/ && $4 + 0 <= 10 {print $2 "=" $4 + 0; exit}')"
  rsvd="$(printf '%s\n' "$out" | awk '$2 ~ /^Used_Rsvd_Blk_Cnt/ {v = $10; gsub(/[^0-9].*/, "", v); print v; exit}')"
  st="$(selftest_failure "$2")"
  if { [ -z "$crit" ] && printf '%s' "$out" | grep -q 'overall-health.*FAILED'; } || [ -n "$now" ]; then
    echo "FAILING (SMART self-assessment failed${now:+: $now}) - copy data off NOW with ddrescue, then retire"
  elif [ -n "$health" ] && [ "$health" != "OK" ]; then
    echo "FAILING (SMART health: $health) - copy data off NOW with ddrescue, then retire"
  elif [ "${pend:-0}" -gt 0 ] 2>/dev/null || [ "${uncorr:-0}" -gt 0 ] 2>/dev/null; then
    echo "FAILING (pending=${pend:-0} uncorrectable=${uncorr:-0} sectors) - copy data off NOW with ddrescue, then retire"
  elif [ "${nvme_err:-0}" -gt 0 ] 2>/dev/null || [ "$bad" -ne 0 ]; then
    echo "FAILING (NVMe media errors=${nvme_err:-0} critical warning=${crit:-none}) - copy data off NOW, then retire"
  elif [ -n "$st" ]; then
    echo "FAILING (self-test: $st) - copy data off NOW with ddrescue, then retire"
  elif [ "${realloc:-0}" -gt 0 ] 2>/dev/null || [ "${rep_unc:-0}" -gt 0 ] 2>/dev/null || [ "${cmd_to:-0}" -gt 0 ] 2>/dev/null; then
    echo "WATCH (reallocated=${realloc:-0} reported-uncorrectable=${rep_unc:-0} command-timeouts=${cmd_to:-0}) - ok for an offline copy, never for RAID"
  elif [ "${grown:-0}" -gt 0 ] 2>/dev/null; then
    echo "WATCH (grown defect list=$grown) - ok for an offline copy, never for RAID"
  elif [ -n "$past" ]; then
    echo "WATCH (at or below threshold now or in the past: $past) - ok for an offline copy, never for RAID"
  elif [ -n "$worn" ] || [ "${rsvd:-0}" -gt 0 ] 2>/dev/null; then
    echo "WATCH (SSD life left ${worn:-ok}, reserve blocks used=${rsvd:-0}) - near end of life, offline copies only"
  elif { [ -n "$spare" ] && [ "$spare" -lt 10 ]; } 2>/dev/null || { [ -n "$used" ] && [ "$used" -ge 100 ]; } 2>/dev/null; then
    echo "WATCH (NVMe spare=${spare:-?}% used=${used:-?}%) - near end of life, offline copies only"
  elif [ "$hot" -ne 0 ]; then
    echo "WATCH (NVMe critical warning $crit: temperature or backup power, not the flash) - cool it and recheck before trusting it"
  elif printf '%s' "$out" | grep -qE 'overall-health.*PASSED|SMART Health Status: OK|SMART/Health Information' &&
       printf '%s' "$out" | grep -qE '^ID# ATTRIBUTE_NAME|SMART/Health Information|^Elements in grown defect list'; then
    echo "HEALTHY (run a long self-test before trusting it: smartctl -t long, then smartctl -l selftest)"
  elif printf '%s' "$out" | grep -q '^ID# ATTRIBUTE_NAME'; then
    echo "UNKNOWN (the attributes look clean but the drive gave no health verdict; test it in a SATA bay or the NAS)"
  else
    # a bare "SMART Health Status: OK" is often the USB bridge's own answer, not the drive's
    echo "UNKNOWN (the USB bridge answers OK but shows no SMART data; test it in a SATA bay or the NAS)"
  fi
}

# Why smartctl could not read a device, from its own message.
unknown_reason() {  # device, smartctl output
  case "$1" in /dev/vd*|/dev/xvd*) echo "virtual disk: SMART lives on the host's physical disks"; return ;; esac
  case "$2" in
    *"Permission denied"*|*"Operation not permitted"*|*"password is required"*) echo "no root: rerun as root or with sudo" ;;
    *"SMART Disabled"*) echo "SMART is switched off in this drive: sudo smartctl -s on $1 (a drive setting, not data), then rerun" ;;
    *"USB bridge"*|*"USB connected"*|*"[USB "*) echo "SMART not readable through this USB bridge; test it in a SATA bay or the NAS" ;;
    *"lacks SMART"*|*"SMART support is: Unavailable"*) echo "the drive reports no SMART; test it in a SATA bay or the NAS" ;;
    *"Unable to detect device type"*) echo "smartctl cannot talk to this kind of device" ;;
    *) echo "smartctl: $(printf '%s\n' "$2" | grep -vE '^(smartctl [0-9]|Copyright|[[:space:]]*$)' | head -1)" ;;
  esac
}

# smartctl output for a device, trying the device types that rescue USB bridges.
# Sets SMART_OUT, SMART_TYPE (the -d type that worked, empty if none) and SMART_MSG
# (the first answer, for the reason). A bare SCSI health line without attributes
# is kept only if no ATA pass-through type shows more.
smart_read() {
  local d out
  SMART_OUT=""; SMART_TYPE=""; SMART_MSG=""
  for d in auto sat sat,12 usbjmicron usbsunplus; do
    out="$($SUDO smartctl -H -A -d "$d" "$1" 2>&1)"
    [ -n "$SMART_MSG" ] || SMART_MSG="$out"
    printf '%s' "$out" | grep -qE 'overall-health|SMART Health Status:|SMART/Health Information' || continue
    if printf '%s' "$out" | grep -qE '^ID# ATTRIBUTE_NAME|SMART/Health Information|^Elements in grown defect list'; then
      SMART_OUT="$out"; SMART_TYPE="$d"; return 0
    fi
    [ -n "$SMART_TYPE" ] || { SMART_OUT="$out"; SMART_TYPE="$d"; }
  done
  [ -n "$SMART_TYPE" ]
}

# One disk: the key SMART lines, the last two self-tests and the verdict.
triage() {  # device
  local st
  if smart_read "$1"; then
    printf '%s\n' "$SMART_OUT" | awk '
      /overall-health|Health Status|Elements in grown defect list/ {print "   " $0}
      /^ *(5|9|187|188|194|196|197|198|199) / {printf "   %-4s %-28s raw=%s\n", $1, $2, $10}
      /^ *[0-9]+ (Wear_Leveling_Count|Media_Wearout_Indicator|SSD_Life_Left|Percent_Lifetime_Remain|Remaining_Lifetime_Perc|Used_Rsvd_Blk_Cnt)/ {printf "   %-4s %-28s value=%s raw=%s\n", $1, $2, $4, $10}
      /Percentage Used|Available Spare:|Media and Data Integrity Errors|Critical Warning|^Temperature:|Power On Hours/ {print "   " $0}'
    st="$($SUDO smartctl -l selftest -d "$SMART_TYPE" "$1" 2>/dev/null)"
    printf '%s\n' "$st" | awk '/^ *#? *[0-9]+ +[A-Za-z]/ {n++; if (n <= 2) print "   selftest " $0}'
    echo "   VERDICT $1: $(smart_verdict "$SMART_OUT" "$st")"
  else
    echo "   VERDICT $1: UNKNOWN ($(unknown_reason "$1" "$SMART_MSG"))"
  fi
}

# Whole disks. Compressed RAM, ramdisks, loop, network, optical and device-mapper/RAID
# devices are not drives. Minimal Fedora has no lsblk: read /sys/block then.
linux_disks() {
  if have lsblk; then lsblk -dno NAME,TYPE 2>/dev/null | awk '$2 == "disk" {print $1}'
  else ls /sys/block 2>/dev/null; fi | awk '$1 !~ /^(zram|ram|loop|nbd|dm-|md|sr)/ {print "/dev/" $1}'
}
linux_model() {  # /dev/name -> model and size
  if have lsblk; then lsblk -dno MODEL,SIZE "$1" 2>/dev/null | tr -s ' '
  else printf '%s %sG' "$(cat "/sys/block/${1#/dev/}/device/model" 2>/dev/null)" "$(( $(cat "/sys/block/${1#/dev/}/size" 2>/dev/null || echo 0) / 2097152 ))"; fi
}

if [ "$OS" = "Linux" ]; then
  echo; echo "== block devices =="
  if have lsblk; then lsblk -o NAME,SIZE,TYPE,TRAN,ROTA,MODEL,SERIAL,FSTYPE,LABEL,MOUNTPOINT 2>/dev/null || lsblk
  else cat /proc/partitions; fi
  echo; echo "== filesystems =="
  df -hT -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null || df -h
  [ -r /proc/mdstat ] && { echo; echo "== mdadm =="; cat /proc/mdstat; }
  have zpool && { echo; echo "== zfs ==";   $SUDO zpool status 2>/dev/null; }
  have btrfs && { echo; echo "== btrfs =="; $SUDO btrfs filesystem show 2>/dev/null; }
  echo; echo "== SMART =="
  if have smartctl; then
    DISKS="$(linux_disks)"
    [ -n "$DISKS" ] || { echo "no disks found (lsblk and /sys/block list none)"; FAILED="no-disks"; }
    for d in $DISKS; do
      echo "--- $d  $(linux_model "$d")"
      triage "$d"
    done
  else
    echo "smartctl missing:  sudo apt install smartmontools   (dnf/pacman: smartmontools), then rerun"
    FAILED="smartctl-missing"
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
    # APFS containers (synthesized) and mounted disk images are not drives
    for d in $(diskutil list 2>/dev/null | awk '/^\/dev\/disk[0-9]+ \(/ && !/synthesized|disk image/ {print $1}'); do
      echo "--- $d"
      triage "$d"
    done
  else
    echo "smartctl missing:  brew install smartmontools"
    FAILED="smartctl-missing"
  fi
  echo; echo "To look inside a drive without writing to it:  diskutil mount readOnly /dev/diskNsM"
fi

echo
if [ -n "$REPORT" ]; then echo "saved: $REPORT   -> decide with checklists/hulk-drives.md"
else echo "not saved on $HOST: run-remote.sh keeps this output in out/logs/ on the admin machine   -> decide with checklists/hulk-drives.md"; fi
[ -z "$FAILED" ] || { echo "DISK_TRIAGE_FAILED=$FAILED"; exit 1; }
