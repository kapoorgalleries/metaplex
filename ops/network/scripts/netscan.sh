#!/usr/bin/env bash
# LAN discovery from a macOS or Linux machine that is on the network.
# Read-only: pings, reads the ARP table, resolves names, probes a few TCP
# ports, and checks for double NAT. Nothing is changed anywhere.
#
# Usage:  scripts/netscan.sh [SUBNET]      SUBNET = first three octets, e.g. 192.168.1
# Output: out/scan-<timestamp>.csv (ip,mac,hostname,ssh,smb,http,https,dsm,qnap,hint)
set -u
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

OS="$(uname -s)"
STAMP="$(date +%Y%m%d-%H%M%S)"
CSV="$OUT_DIR/scan-$STAMP.csv"

# ---------------------------------------------------------------- 1. where am I
if [ "$OS" = "Darwin" ]; then
  GW="$(route -n get default 2>/dev/null | awk '/gateway:/ {print $2}')"
  IFACE="$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')"
  MYIP="$(ipconfig getifaddr "$IFACE" 2>/dev/null)"
  MASK="$(ipconfig getoption "$IFACE" subnet_mask 2>/dev/null)"
  DNS="$(scutil --dns 2>/dev/null | awk '/nameserver\[/ {print $3}' | sort -u | tr '\n' ' ')"
  LINK="$(networksetup -getmedia "$IFACE" 2>/dev/null | awk -F': ' '/Active/ {print $2}')"
  PING_W="-W 1000"      # macOS ping: milliseconds
  NC_T="-G 1"           # macOS nc: connect timeout in seconds
else
  GW="$(ip route 2>/dev/null | awk '/^default/ {print $3; exit}')"
  IFACE="$(ip route 2>/dev/null | awk '/^default/ {print $5; exit}')"
  MYIP="$(ip -4 -o addr show "$IFACE" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
  MASK="/$(ip -4 -o addr show "$IFACE" 2>/dev/null | awk '{print $4}' | cut -d/ -f2 | head -1)"
  DNS="$( (resolvectl status 2>/dev/null | awk '/DNS Servers:/ {for (i=3; i<=NF; i++) print $i}'
           awk '/^nameserver/ {print $2}' /etc/resolv.conf 2>/dev/null) | sort -u | tr '\n' ' ')"
  LINK="$(cat "/sys/class/net/$IFACE/speed" 2>/dev/null)"; [ -n "$LINK" ] && LINK="${LINK}Mb/s"
  PING_W="-W 1"         # Linux ping: seconds
  NC_T="-w 1"
fi

SUBNET="${1:-$(printf '%s' "$MYIP" | cut -d. -f1-3)}"
[ -n "$SUBNET" ] || die "could not work out the local subnet; pass it, e.g. netscan.sh 192.168.1"

log "interface=$IFACE  ip=$MYIP$MASK  gateway=$GW  link=${LINK:-?}"
log "dns servers: ${DNS:-none found}"
case "$LINK" in *100Mb*|100baseT*|*"100baseTX"*) warn "link is 100 Mb/s on $IFACE: bad cable or a 100 Mb switch port. Gigabit expected." ;; esac
case "$MASK" in /24|255.255.255.0) ;; "") ;; *) warn "subnet mask is $MASK, not /24. Passing the right SUBNET matters and the network may be split." ;; esac

# ---------------------------------------------------------------- 2. double NAT
is_private() {
  case "$1" in
    10.*|192.168.*) return 0 ;;
    172.*) o="$(printf '%s' "$1" | cut -d. -f2)"; [ "$o" -ge 16 ] && [ "$o" -le 31 ] ;;
    100.*) o="$(printf '%s' "$1" | cut -d. -f2)"; [ "$o" -ge 64 ] && [ "$o" -le 127 ] ;;
    *) return 1 ;;
  esac
}
if have traceroute; then
  HOPS="$(traceroute -n -m 3 -w 1 -q 1 1.1.1.1 2>/dev/null | awk 'NR>1 {print $2}' | tr '\n' ' ')"
  PRIV=0
  for h in $HOPS; do is_private "$h" && PRIV=$((PRIV+1)); done
  if [ "$PRIV" -ge 2 ]; then
    warn "DOUBLE NAT: the first $PRIV hops are private addresses ($HOPS). See checklists/network-triage.md, 'Double NAT'."
  else
    ok "single NAT (first hops: ${HOPS:-none})"
  fi
else
  warn "traceroute not installed; skipping the double-NAT check (Debian/Ubuntu: sudo apt install traceroute)"
fi

# ---------------------------------------------------------------- 3. sweep
log "pinging $SUBNET.1-254 in parallel (about 5 s)"
for i in $(seq 1 254); do
  # shellcheck disable=SC2086
  ( ping -c 1 $PING_W "$SUBNET.$i" >/dev/null 2>&1 ) &
done
wait

# ip mac pairs from the neighbour table, plus this machine
if [ "$OS" = "Darwin" ]; then
  MYMAC="$(ifconfig "$IFACE" 2>/dev/null | awk '/ether/ {print $2}')"
  PAIRS="$(arp -an 2>/dev/null | awk -v s="($SUBNET." 'index($2, s)==1 && $4 != "(incomplete)" {gsub(/[()]/, "", $2); print $2, $4}')"
else
  MYMAC="$(cat "/sys/class/net/$IFACE/address" 2>/dev/null)"
  PAIRS="$(ip neigh show 2>/dev/null | awk -v s="$SUBNET." 'index($1, s)==1 && $3 == "lladdr" {print $1, $4}')"
fi
PAIRS="$(printf '%s\n%s %s\n' "$PAIRS" "$MYIP" "${MYMAC:-?}" | awk 'NF == 2 && !seen[$1]++')"

# ---------------------------------------------------------------- 4. per host
resolve() {
  local n=""
  if [ "$OS" = "Darwin" ]; then
    n="$(dscacheutil -q host -a ip_address "$1" 2>/dev/null | awk '/^name:/ {print $2; exit}')"
  else
    n="$(getent hosts "$1" 2>/dev/null | awk '{print $2; exit}')"
    [ -z "$n" ] && have avahi-resolve && n="$(avahi-resolve -a "$1" 2>/dev/null | awk '{print $2}')"
  fi
  printf '%s' "$n"
}
probe() {  # ip port -> prints y when the port accepts a connection
  if have nc; then
    # shellcheck disable=SC2086
    nc -z $NC_T "$1" "$2" >/dev/null 2>&1 && printf y
  elif have timeout; then
    timeout 1 bash -c "exec 3<>/dev/tcp/$1/$2" >/dev/null 2>&1 && printf y
  fi
}

printf 'ip,mac,hostname,ssh22,smb445,http80,https443,dsm5000,qnap8080,hint\n' > "$CSV"
printf '%s\n' "$PAIRS" | sort -t. -k4,4n | while read -r ip mac; do
  [ -n "$ip" ] || continue
  name="$(resolve "$ip")"
  s22="$(probe "$ip" 22)"; s445="$(probe "$ip" 445)"; s80="$(probe "$ip" 80)"
  s443="$(probe "$ip" 443)"; s5000="$(probe "$ip" 5000)"; s8080="$(probe "$ip" 8080)"
  hint=""
  [ "$ip" = "$GW" ] && hint="gateway/router"
  [ "$ip" = "$MYIP" ] && hint="this machine"
  [ -n "$s5000" ] && hint="${hint:+$hint; }Synology DSM?"
  [ -n "$s8080" ] && [ -n "$s445" ] && hint="${hint:+$hint; }QNAP?"
  [ -n "$s445" ] && [ -z "$hint" ] && hint="SMB host (PC or NAS)"
  [ -n "$s22" ] && hint="${hint:+$hint; }ssh open"
  [ -z "$hint" ] && [ -n "$s80" ] && hint="web only (printer/IoT/AP?)"
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$ip" "$mac" "$name" "$s22" "$s445" "$s80" "$s443" "$s5000" "$s8080" "$hint" >> "$CSV"
done

# ---------------------------------------------------------------- 5. report
N="$(($(wc -l < "$CSV") - 1))"
log "$N hosts answered. Table (y = port open):"
if have column; then column -t -s, "$CSV"; else cat "$CSV"; fi
log "saved: $CSV"
log "next: copy the real machines into inventory.csv (name,ip,mac,os,user,role,ssh_port,trimurti,notes),"
log "      then set a DHCP reservation on the router for each one (checklists/router-tuning.md, DHCP)."
