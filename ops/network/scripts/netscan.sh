#!/usr/bin/env bash
# LAN discovery from a macOS or Linux machine that is on the network.
# Read-only: pings, reads the ARP table, resolves names, probes a few TCP
# ports, and checks for double NAT. Nothing is changed anywhere. The router
# (this machine's default gateway, or a role=router row in the inventory) is
# pinged but never port-probed.
#
# Usage:  scripts/netscan.sh [SUBNET]      SUBNET = first three octets, e.g. 192.168.1
# Output: out/scan-<timestamp>.csv (ip,mac,hostname,ssh22,smb445,http80,https443,dsm5000,qnap8080,hint)
set -u
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

for a in "$@"; do
  case "$a" in
    -h|--help) usage 0 ;;
    -*) bad_usage "unknown flag: $a" ;;
  esac
done
[ $# -le 1 ] || bad_usage "one SUBNET at most"
if [ -n "${1:-}" ]; then
  printf '%s' "$1" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$' || bad_usage "SUBNET is the first three octets, e.g. 192.168.1, not '$1'"
fi

OS="$(uname -s)"
STAMP="$(date +%Y%m%d-%H%M%S)"
CSV="$OUT_DIR/scan-$STAMP.csv"

# ---------------------------------------------------------------- 1. where am I
if [ "$OS" = "Darwin" ]; then
  GW="$(route -n get default 2>/dev/null | awk '/gateway:/ {print $2}')"
  IFACE="$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')"
  MYIP="$(ipconfig getifaddr "$IFACE" 2>/dev/null)"
  # dotted mask -> /prefix, as on Linux
  MASK="$(ipconfig getoption "$IFACE" subnet_mask 2>/dev/null | awk -F. 'NF == 4 {
    n = 0; for (i = 1; i <= 4; i++) for (b = 128; b >= 1; b /= 2) if ($i >= b) { n++; $i -= b }
    print "/" n }')"
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
is_rfc1918() {  # 10/8, 172.16/12, 192.168/16: a LAN behind a NAT box
  case "$1" in
    10.*|192.168.*) return 0 ;;
    172.*) o="$(printf '%s' "$1" | cut -d. -f2)"; [ "$o" -ge 16 ] && [ "$o" -le 31 ] ;;
    *) return 1 ;;
  esac
}
is_cgnat() {  # 100.64/10 (RFC 6598): the ISP's carrier-grade NAT, nothing on this LAN
  case "$1" in
    100.*) o="$(printf '%s' "$1" | cut -d. -f2)"; [ "$o" -ge 64 ] && [ "$o" -le 127 ] ;;
    *) return 1 ;;
  esac
}
TO=""; have timeout && TO="timeout 20"
# First four hops towards 1.1.1.1, one per line ("*" = no answer). Hop lines only:
# BSD traceroute prints its header on stderr, Linux on stdout.
if have traceroute; then
  # shellcheck disable=SC2086
  HOPS="$($TO traceroute -n -m 4 -w 1 -q 1 1.1.1.1 2>/dev/null | awk '$1 ~ /^[0-9]+$/ {print $2}' | tr '\n' ' ')"
elif have tracepath; then
  # one address per hop number; a "pmtu" line is the hop before reporting a smaller MTU
  # shellcheck disable=SC2086
  HOPS="$($TO tracepath -n -m 4 1.1.1.1 2>/dev/null | awk '$1 ~ /^[0-9]+:$/ && !/pmtu/ { n = $1 + 0
      if ($2 ~ /^[0-9.]+$/) h[n] = $2; else if (!(n in h)) h[n] = "*"; if (n > m) m = n }
    END { for (i = 1; i <= m; i++) print ((i in h) ? h[i] : "*") }' | tr '\n' ' ')"
else
  HOPS="none"
fi
if [ "$HOPS" = none ]; then
  warn "neither traceroute nor tracepath is installed; skipping the double-NAT check (Debian/Ubuntu: sudo apt install traceroute)"
else
  # Private hops in a row from hop 1 (the router). Two means the router's upstream is
  # a private address too: a second NAT box, or an ISP that numbers its own network privately.
  PRIV=0; CG=0; run=1; HOP2=""; ANS=0
  set -f   # a hop can be "*"
  for h in $HOPS; do
    [ "$h" = "*" ] && continue
    ANS=$((ANS+1))
    if [ "$run" = 1 ] && is_rfc1918 "$h"; then PRIV=$((PRIV+1)); [ "$PRIV" = 2 ] && HOP2="$h"; else run=0; fi
    is_cgnat "$h" && CG=$((CG+1))
  done
  set +f
  CONFIRM="Confirm on the router's status page: a WAN IP in 10/8, 172.16/12 or 192.168/16 proves double NAT; a public WAN IP means single NAT. See checklists/network-triage.md, 'Double NAT'."
  if [ "$ANS" -lt 2 ]; then
    warn "double-NAT check inconclusive: $ANS of the first hops towards 1.1.1.1 answered (${HOPS:-none}). Look at the router's status page: a WAN IP in 10/8, 172.16/12 or 192.168/16 means double NAT."
  elif [ "$PRIV" -ge 2 ]; then
    case "$HOP2" in
      192.168.*) warn "DOUBLE NAT likely: the router's upstream hop $HOP2 is a home-router address ($HOPS), so a second NAT box (the ISP modem in router mode) sits between this LAN and the internet. $CONFIRM" ;;
      *) warn "possible double NAT: the router's upstream hop $HOP2 is private ($HOPS). That is either a second NAT box or an ISP that uses private addresses inside its own network. $CONFIRM" ;;
    esac
  elif [ "$CG" -ge 1 ]; then
    warn "ISP CGNAT: a hop is in 100.64.0.0/10 ($HOPS). That is the carrier's NAT, not a box on this LAN. Inbound port forwards and some VPNs will not work, and only the ISP can change it (ask for a public IP). Nothing to fix on the router."
  else
    ok "single NAT (first hops: ${HOPS:-none})"
  fi
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
  # "IP dev IF [router] lladdr MAC STATE": find lladdr rather than trusting a column
  PAIRS="$(ip neigh show 2>/dev/null | awk -v s="$SUBNET." 'index($1, s)==1 { for (i = 2; i < NF; i++) if ($i == "lladdr") { print $1, $(i+1); break } }')"
fi
# Only this subnet, no network or broadcast address; MACs lowercase and zero-padded
# (macOS arp prints 2:42:c0:a8:58:b), without the broadcast MAC.
PAIRS="$(printf '%s\n%s %s\n' "$PAIRS" "$MYIP" "${MYMAC:-?}" | awk -v s="$SUBNET." '
  NF == 2 && index($1, s) == 1 && !seen[$1]++ {
    o = substr($1, length(s) + 1); if (o == "0" || o == "255") next
    m = tolower($2)
    if (m != "?") {
      if (split(m, p, /[:-]/) != 6) next
      m = ""; for (i = 1; i <= 6; i++) m = m (i > 1 ? ":" : "") (length(p[i]) == 1 ? "0" : "") p[i]
    }
    if (m == "ff:ff:ff:ff:ff:ff" || m == "00:00:00:00:00:00") next
    print $1, m }')"

# The router: never port-probed (C2). The gateway, plus any role=router row in the inventory.
ROUTERS=" $GW "
[ -f "$INVENTORY" ] && ROUTERS="$ROUTERS$(inventory_rows 2>/dev/null | awk -F, 'tolower($6) == "router" && $2 != "" {printf "%s ", $2}')"

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
  s22=""; s445=""; s80=""; s443=""; s5000=""; s8080=""
  case "$ROUTERS" in
    *" $ip "*)
      if [ "$ip" = "$GW" ]; then hint="gateway/router: not probed; never log in"
      else hint="router (inventory role=router): not probed; never log in"; fi ;;
    *)
      s22="$(probe "$ip" 22)"; s445="$(probe "$ip" 445)"; s80="$(probe "$ip" 80)"
      s443="$(probe "$ip" 443)"; s5000="$(probe "$ip" 5000)"; s8080="$(probe "$ip" 8080)"
      hint=""
      [ "$ip" = "$MYIP" ] && hint="this machine"
      [ -n "$s5000" ] && hint="${hint:+$hint; }Synology DSM?"
      [ -n "$s8080" ] && [ -n "$s445" ] && hint="${hint:+$hint; }QNAP?"
      [ -n "$s445" ] && [ -z "$hint" ] && hint="SMB host (PC or NAS)"
      [ -n "$s22" ] && hint="${hint:+$hint; }ssh open"
      [ -z "$hint" ] && [ -n "$s80" ] && hint="web only (printer/IoT/AP?)" ;;
  esac
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$ip" "$mac" "$name" "$s22" "$s445" "$s80" "$s443" "$s5000" "$s8080" "$hint" >> "$CSV"
done

# ---------------------------------------------------------------- 5. report
N="$(($(wc -l < "$CSV") - 1))"
log "$N hosts answered. Table (y = port open):"
# awk, not column: BSD column (macOS) merges empty cells and shifts the rest left
awk -F, '{ for (i = 1; i <= NF; i++) { c[NR, i] = $i; if (length($i) > w[i]) w[i] = length($i) } if (NF > n) n = NF }
  END { for (r = 1; r <= NR; r++) { l = ""; for (i = 1; i <= n; i++) l = l sprintf("%-" w[i] "s  ", c[r, i]); sub(/ +$/, "", l); print l } }' "$CSV"
log "saved: $CSV"
log "next: copy the real machines into inventory.csv (name,ip,mac,os,user,role,ssh_port,trimurti,notes),"
log "      the router as role=router with a blank ssh_port,"
log "      then set a DHCP reservation on the router for each one (checklists/router-tuning.md, DHCP)."
