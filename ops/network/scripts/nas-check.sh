#!/usr/bin/env bash
# Is the NAS alive, and through which doors? Run from the admin machine.
# Read-only: ping, TCP probes of every port a NAS normally answers on, a
# vendor guess, guest share listing, NFS exports, and an SSH probe if port 22
# is open. Then it points at the matching section of checklists/nas.md.
#
# Usage: nas-check.sh [host-or-ip] [ssh-user]     default: the inventory row with role=nas
# shellcheck disable=SC2034  # every inventory column is read, not every one is used
set -u
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

NAS="${1:-}"; NAS_USER="${2:-}"
if [ -z "$NAS" ]; then
  row="$(FILTER_ROLE=nas select_hosts | head -1)"
  IFS=, read -r name ip mac os user role port trimurti notes <<< "$row"
  NAS="${ip:-$name}"; [ -z "$NAS_USER" ] && NAS_USER="${user:-}"
fi
[ -n "$NAS" ] || die "no NAS given and no role=nas row in $INVENTORY"

OS="$(uname -s)"; PING_W="-W 1"; NC_T="-w 1"
[ "$OS" = "Darwin" ] && { PING_W="-W 1000"; NC_T="-G 1"; }
probe() {
  # shellcheck disable=SC2086
  if have nc; then nc -z $NC_T "$1" "$2" >/dev/null 2>&1
  elif have timeout; then timeout 1 bash -c "exec 3<>/dev/tcp/$1/$2" >/dev/null 2>&1
  else return 2; fi
}

log "NAS = $NAS (ssh user ${NAS_USER:-not given})"
# shellcheck disable=SC2086
if ping -c 2 $PING_W "$NAS" >/dev/null 2>&1; then ok "ping answers"
else fail "no ping. Power, link or IP problem -> checklists/nas.md 'Not reachable at all'"; fi

OPEN=""
for spec in "22:ssh" "80:http" "443:https" "5000:Synology DSM http" "5001:Synology DSM https" \
            "8080:QNAP QTS http" "445:SMB" "139:SMB over NetBIOS" "2049:NFS" "548:AFP (old Mac)" \
            "873:rsync" "3260:iSCSI" "5900:VNC/other"; do
  port="${spec%%:*}"; label="${spec#*:}"
  if probe "$NAS" "$port"; then ok "$(printf '%-5s open    %s' "$port" "$label")"; OPEN="$OPEN $port"
  else printf '        %-5s closed  %s\n' "$port" "$label"; fi
done

guess=""
case " $OPEN " in *" 5000 "*|*" 5001 "*) guess="Synology" ;; esac
[ -z "$guess" ] && case " $OPEN " in *" 8080 "*) guess="QNAP" ;; esac
if have curl; then
  # QTS does not redirect 80 -> 8080 by default and DSM lives on 5000, so look at those too
  page="$(curl -sk -m 4 -D - "https://$NAS/" 2>/dev/null; curl -s -m 4 -D - "http://$NAS/" 2>/dev/null
          curl -s -m 4 -D - "http://$NAS:5000/" 2>/dev/null; curl -s -m 4 -D - "http://$NAS:8080/" 2>/dev/null)"
  printf '%s' "$page" | grep -qi truenas  && guess="TrueNAS"
  printf '%s' "$page" | grep -qi synology && guess="Synology"
  printf '%s' "$page" | grep -qi qnap     && guess="QNAP"
  printf '%s' "$page" | grep -qiE 'unraid|openmediavault' && guess="Unraid/OMV"
fi
log "vendor guess: ${guess:-unknown}"
log "web UI:  Synology http://$NAS:5000   QNAP http://$NAS:8080   TrueNAS/OMV/Unraid http://$NAS"

if have smbclient; then
  log "SMB shares as guest (ACCESS_DENIED here just means guest is off, which is fine):"
  smbclient -L "//$NAS" -N -m SMB3 2>&1 | sed 's/^/   /' | head -25
elif [ "$OS" = "Darwin" ]; then
  log "SMB shares as guest:"; smbutil view -G "//$NAS" 2>&1 | sed 's/^/   /' | head -25
else
  warn "smbclient not installed (apt install smbclient); skipping share listing"
fi
have showmount && { log "NFS exports:"; showmount -e "$NAS" 2>&1 | sed 's/^/   /'; }

case " $OPEN " in
  *" 22 "*)
    if [ -n "$NAS_USER" ]; then
      log "ssh probe as $NAS_USER (key, then password if needed):"
      ssh -o ConnectTimeout=6 -o StrictHostKeyChecking=accept-new "$NAS_USER@$NAS" \
        'uname -a; for f in /etc/synoinfo.conf /etc/config/uLinux.conf /etc/version; do [ -f $f ] && echo "  $f present"; done; df -h 2>/dev/null | grep -E "^/dev|volume|Filesystem" | head -8' </dev/null 2>&1 | sed 's/^/   /'
    else
      warn "ssh is open but no user known: rerun as  nas-check.sh $NAS <user>  (Synology: your named admin; QNAP: admin; TrueNAS: truenas_admin), or fill the inventory row"
    fi
    ;;
  *) warn "ssh is closed on the NAS (Synology: Control Panel > Terminal & SNMP; QNAP: Control Panel > Network & File Services > Telnet/SSH; TrueNAS: System > Services > SSH)" ;;
esac

echo
case " $OPEN " in
  *" 445 "*) log "SMB is up. If a PC still cannot mount a share, it is credentials or protocol: nas.md 'Reachable but shares will not mount'" ;;
  *) [ -n "$OPEN" ] && warn "NAS answers but SMB (445) is closed: the file service is off or the volume is not mounted -> nas.md 'Web UI up, shares gone'" ;;
esac
