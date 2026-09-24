#!/usr/bin/env bash
# Is the NAS alive, and through which doors? Run from the admin machine.
# Read-only: ping, TCP probes of every port a NAS normally answers on, a
# vendor guess, the share listing (as guest, or as --smb-user), an SMB1 check,
# NFS exports, and a key-only SSH probe. Then it points at the matching
# section of checklists/nas.md. It refuses the router (a role=router row or
# this machine's default gateway) and exits 2 without touching it.
#
# Usage: nas-check.sh [--smb-user USER] [host-or-ip] [ssh-user]
# Default host: the inventory row with role=nas. The SSH probe uses the admin
# key, the ssh_port and the user of the host's inventory row, and never asks
# for a password; no row or a blank ssh_port means no SSH login is tried.
# --smb-user lists the shares as USER: smbclient asks for the password, so
# that part needs Sanjay's terminal (without one it is skipped with a note).
# The password is never passed on a command line, stored or logged.
# shellcheck disable=SC2034  # every inventory column is read, not every one is used
set -u
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

SMB_USER=""; NAS=""; NAS_USER=""; n=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --smb-user) case "${2:-}" in ""|-*) bad_usage "--smb-user needs a value" ;; esac; SMB_USER="$2"; shift ;;
    --smb-user=*) SMB_USER="${1#*=}"; [ -n "$SMB_USER" ] || bad_usage "--smb-user needs a value" ;;
    -*) bad_usage "unknown flag: $1" ;;
    *) n=$((n + 1))
       case "$n" in 1) NAS="$1" ;; 2) NAS_USER="$1" ;; *) bad_usage "unexpected argument: $1" ;; esac ;;
  esac
  shift
done
case "$NAS" in *[!A-Za-z0-9._-]*) bad_usage "not a host name or IP: $NAS" ;; esac
case "$NAS_USER" in *[!A-Za-z0-9._-]*) bad_usage "not a user name: $NAS_USER" ;; esac
case "$SMB_USER" in *[!A-Za-z0-9._@\\-]*) bad_usage "not a user name: $SMB_USER" ;; esac

# The inventory row for this host (by name or IP), or the role=nas row when no host is given.
row=""
if [ -f "$INVENTORY" ]; then
  if [ -n "$NAS" ]; then
    row="$(inventory_rows | awk -F, -v h="$(lower "$NAS")" 'tolower($1) == h || $2 == h { print; exit }')"
  else
    row="$(inventory_rows | awk -F, 'tolower($6) == "nas" { print; exit }')"
  fi
fi
name=""; ip=""; user=""; role=""; port=""
[ -n "$row" ] && IFS=, read -r name ip mac os user role port trimurti notes <<< "$row"
NAS="${ip:-${NAS:-$name}}"   # a row's IP wins over its name
[ -n "$NAS" ] || die "no NAS given and no role=nas row in $INVENTORY"
[ -n "$NAS_USER" ] || NAS_USER="$user"

# Never the router: a role=router row, or this machine's default gateway, by name or address.
resolve_ip() {
  case "$(local_os)" in
    macos)   dscacheutil -q host -a name "$1" 2>/dev/null | awk '/^ip_address:/ { print $2; exit }' ;;
    windows) ping -4 -n 1 -w 500 "$1" 2>/dev/null | tr -d '\r' | sed -n 's/.*\[\([0-9.]*\)\].*/\1/p' | head -1 ;;
    *)       getent ahostsv4 "$1" 2>/dev/null | awk '{ print $1; exit }' ;;
  esac
}
ADDR="${ip:-$NAS}"
case "$ADDR" in *[!0-9.]*) ADDR="$(resolve_ip "$ADDR")" ;; esac
GW="$(default_gateway)"
ROUTERS=" $GW "
[ -f "$INVENTORY" ] && ROUTERS="$ROUTERS$(inventory_rows | awk -F, 'tolower($6) == "router" { printf "%s %s ", $1, $2 }')"
if [ "$(lower "$role")" = router ] || case "$ROUTERS" in *" $NAS "*|*" ${ADDR:-none} "*) true ;; *) false ;; esac; then
  fail "$NAS is the router (role=router, or this machine's default gateway $GW): nas-check never probes or logs into it. Pass the NAS's own IP (netscan lists it)."
  exit 2
fi

OS="$(uname -s)"; NC_T="-w 1"
[ "$OS" = "Darwin" ] && NC_T="-G 1"
probe() {
  # shellcheck disable=SC2086
  if have nc; then nc -z $NC_T "$1" "$2" >/dev/null 2>&1
  elif have timeout; then timeout 1 bash -c "exec 3<>/dev/tcp/$1/$2" >/dev/null 2>&1
  else return 2; fi
}

log "NAS = $NAS${name:+ (inventory row $name)} (ssh user ${NAS_USER:-not given}, ssh_port ${port:-none})"
PING=0
if ping_host "$NAS" || ping_host "$NAS"; then ok "ping answers"; PING=1
else fail "no ping. Power, link or IP problem -> checklists/nas.md 'Not reachable at all'"; fi

EXTRA=""
case "$port" in ""|22|*[!0-9]*) ;; *) EXTRA="$port:ssh (inventory ssh_port)" ;; esac
OPEN=""
for spec in ${EXTRA:+"$EXTRA"} "22:ssh" "80:http" "443:https" "5000:Synology DSM http" "5001:Synology DSM https" \
            "8080:QNAP QTS http" "445:SMB" "139:SMB over NetBIOS" "2049:NFS" "548:AFP (old Mac)" \
            "873:rsync" "3260:iSCSI" "5900:VNC/other"; do
  p="${spec%%:*}"; label="${spec#*:}"
  if probe "$NAS" "$p"; then ok "$(printf '%-5s open    %s' "$p" "$label")"; OPEN="$OPEN $p"
  else printf '        %-5s closed  %s\n' "$p" "$label"; fi
done
is_open() { case " $OPEN " in *" $1 "*) return 0 ;; esac; return 1; }
WEB=""; for p in 80 443 5000 5001 8080; do is_open "$p" && WEB=1; done
SMB=""; is_open 445 && SMB=1

guess=""
{ is_open 5000 || is_open 5001; } && guess="Synology"
[ -z "$guess" ] && is_open 8080 && guess="QNAP"
if have curl && [ -n "$WEB" ]; then
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

if [ -n "$SMB" ]; then
  if have smbclient; then
    log "SMB shares as guest (ACCESS_DENIED here just means guest is off, which is fine):"
    smbclient -L "//$NAS" -N -m SMB3 </dev/null 2>&1 | sed 's/^/   /' | head -25
    if [ -n "$SMB_USER" ]; then
      if has_tty; then
        # straight to the terminal: through a pipe the password prompt would not show
        log "SMB shares as $SMB_USER (smbclient asks for the password):"
        smbclient -L "//$NAS" -U "$SMB_USER" -m SMB3 </dev/tty
      else
        warn "listing shares as $SMB_USER needs the password and there is no terminal here: run  nas-check.sh --smb-user $SMB_USER $NAS  in a terminal (smbclient asks for it)"
      fi
    fi
    # SMB1 is off when the server refuses an NT1-only negotiation
    smb1="$(smbclient -L "//$NAS" -N -m NT1 --option='client min protocol=NT1' </dev/null 2>&1)"
    if printf '%s' "$smb1" | grep -qE 'Sharename|Anonymous login successful|NT_STATUS_(ACCESS_DENIED|LOGON_FAILURE|ACCOUNT_DISABLED)|session setup failed'; then
      warn "SMB1 is ON: set the NAS's minimum SMB protocol to SMB2 -> nas.md 'Reachable but shares will not mount' (Protocol)"
    elif printf '%s' "$smb1" | grep -qE 'protocol negotiation failed|No compatible protocol|NT_STATUS_(CONNECTION_RESET|CONNECTION_DISCONNECTED|INVALID_NETWORK_RESPONSE|NOT_SUPPORTED|IO_TIMEOUT)'; then
      ok "SMB1 off (good)"
    else
      warn "SMB1 check inconclusive: $(printf '%s\n' "$smb1" | grep -v '^[[:space:]]*$' | tail -1)"
    fi
  elif [ "$OS" = "Darwin" ]; then
    # -g: guest only, never prompts (-G would still ask for a password)
    log "SMB shares as guest:"; smbutil view -g "//$NAS" 2>&1 | sed 's/^/   /' | head -25
    if [ -n "$SMB_USER" ]; then
      log "SMB shares as $SMB_USER:"
      if has_tty; then smbutil view "//$SMB_USER@$NAS" 2>&1 | sed 's/^/   /' | head -25
      else smbutil view -N "//$SMB_USER@$NAS" 2>&1 | sed 's/^/   /' | head -25; fi
    fi
    log "SMB1 check needs smbclient (brew install samba); or look in the NAS's SMB settings"
  else
    warn "smbclient not installed (apt install smbclient); skipping the share listing and the SMB1 check"
  fi
fi
is_open 2049 && have showmount && { log "NFS exports:"; showmount -e "$NAS" 2>&1 | sed 's/^/   /'; }

# SSH: key only, on the inventory ssh_port, never a password prompt
why="$(ssh_skip_reason "$NAS_USER" "$port")"
[ -n "$row" ] || why="$NAS is not in $INVENTORY"
if [ -n "$WEB$SMB" ] || { [ -n "$OPEN" ] && [ "$(lower "$role")" = nas ]; }; then
  if [ -n "$why" ]; then
    if is_open 22; then log "ssh: port 22 answers, no login tried: $why (add the NAS row with ssh_port 22 and its user)"
    else log "ssh: no login tried: $why"; fi
  elif is_open "$port"; then
    kp="$(key_problem)"
    if [ -n "$kp" ]; then
      warn "ssh probe skipped: $kp"
    else
      log "ssh probe as $NAS_USER on port $port (admin key only):"
      # shellcheck disable=SC2086
      out="$(ssh $SSH_OPTS "${KEY_OPTS[@]}" -p "$port" "$NAS_USER@$NAS" \
        'uname -a; for f in /etc/synoinfo.conf /etc/config/uLinux.conf /etc/version; do [ -f $f ] && echo "  $f present"; done; df -h 2>/dev/null | grep -E "^/dev|volume|Filesystem" | head -8' </dev/null 2>&1)"
      rc=$?
      printf '%s\n' "$out" | sed 's/^/   /'
      if [ "$rc" -ne 0 ]; then
        case "$out" in
          *"Permission denied"*) warn "the NAS refused the admin key for $NAS_USER: push it once from a terminal with  scripts/ssh-keys.sh --host ${name:-<nas row>}  (Synology: enable 'user home service' first)" ;;
          *) warn "ssh to $NAS_USER@$NAS:$port failed (exit $rc)" ;;
        esac
      fi
    fi
  else
    warn "ssh ($port) is closed on the NAS (Synology: Control Panel > Terminal & SNMP; QNAP: Control Panel > Network & File Services > Telnet/SSH; TrueNAS: System > Services > SSH)"
  fi
fi

echo
if [ -z "$OPEN" ]; then
  [ "$PING" = 1 ] && warn "$NAS answers ping but no NAS port is open: wrong IP, or every NAS service is off. Check netscan and the inventory row"
elif [ -n "$SMB" ]; then
  log "SMB is up. If a PC still cannot mount a share, it is credentials or protocol: nas.md 'Reachable but shares will not mount'"
  [ -n "$WEB" ] || warn "no NAS web UI port (80, 443, 5000, 5001, 8080) answers: is $NAS a PC sharing files rather than the NAS? Check netscan and the inventory row"
elif [ -n "$WEB" ]; then
  warn "NAS answers but SMB (445) is closed: the file service is off or the volume is not mounted -> nas.md 'Web UI up, shares gone'"
else
  warn "this does not look like a NAS (no web UI, no SMB; open:$OPEN): wrong IP? Check netscan and the inventory row"
fi
