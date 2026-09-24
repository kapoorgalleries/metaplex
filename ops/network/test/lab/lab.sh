#!/usr/bin/env bash
# lab.sh: a simulated gallery LAN in Docker for testing ops/network (the Trimurti kit).
# See README.md next to this file.
#
#   lab.sh up <name> <octet>                       build images (cached), create
#                                                  192.168.<octet>.0/24 and start the hosts
#   lab.sh down <name>                             remove containers, network, forwarder,
#                                                  tripwire and state (safe on a half-built lab)
#   lab.sh status [<name>]                         one lab in detail, or all labs
#   lab.sh exec <name> <host> [-u USER] [cmd...]   docker exec into a host (bash -l if no cmd)
#   lab.sh inventory <name>                        ground-truth inventory.csv rows, real MACs
#   lab.sh check <name>                            self-test of the lab (exit 1 on a failure)
#   lab.sh build                                   build or refresh the images only
#
# Environment (all optional):
#   LAB_UPSTREAM_PROXY  host:port of the HTTPS proxy on this host (default: from HTTPS_PROXY)
#   LAB_CA_FILE         CA bundle the proxy's TLS chains to (default /root/.ccr/ca-bundle.crt)
#   LAB_DISTRO_MODE     auto | native | fallback, for the Debian, Fedora and Arch images
#   LAB_DEBIAN_MIRROR, LAB_ARCH_MIRROR, LAB_REGISTRY   package mirrors and base-image registry
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_SRC="$(cd "$LAB_DIR/../.." && pwd)"                    # ops/network
STATE_ROOT="$LAB_DIR/state"
CACHE="$STATE_ROOT/.cache"
IMG=trimurti-lab                                          # image prefix and label key
LAB_PW=lab-pass-1                                         # test-only password of user gallery
REGISTRY="${LAB_REGISTRY:-mirror.gcr.io/library}"
DEBIAN_MIRROR="${LAB_DEBIAN_MIRROR:-https://deb.debian.org}"
ARCH_MIRROR="${LAB_ARCH_MIRROR:-https://geo.mirror.pkgbuild.com}"
FEDORA_PROBE="https://mirrors.fedoraproject.org/metalink?repo=fedora-41&arch=x86_64&protocol=https"

# host | last octet | image | inventory os | role | ssh_port | trimurti
HOSTS=(
  "admin|10|admin|linux|admin||yes"
  "ubuntu-desk|21|ubuntu-desk|linux|workstation|22|yes"
  "debian-pc|22|debian|linux|workstation|22|yes"
  "fedora-pc|23|fedora|linux|workstation|22|yes"
  "arch-pc|24|arch|linux|workstation|22|yes"
  "new-pc-2|25|ubuntu-nossh|linux|new|22|no"      # yes only once trimurti-join.md is done
  "nas|30|nas|nas|nas||no"
)
IMAGES=(admin ubuntu-desk ubuntu-nossh nas debian fedora arch)

if [ -t 2 ]; then C_B=$'\033[1;34m'; C_Y=$'\033[1;33m'; C_R=$'\033[1;31m'; C_0=$'\033[0m'
else C_B=""; C_Y=""; C_R=""; C_0=""; fi
say()  { printf '%s[lab]%s %s\n' "$C_B" "$C_0" "$*" >&2; }
warn() { printf '%s[lab] WARN%s %s\n' "$C_Y" "$C_0" "$*" >&2; }
die()  { printf '%s[lab] ERROR%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }

usage() { sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

check_name() {
  [[ "${1:-}" =~ ^[a-z0-9][a-z0-9-]{0,19}$ ]] || die "lab name must be 1-20 characters of a-z 0-9 - (got '${1:-}')"
}
check_octet() {
  [[ "${1:-}" =~ ^[0-9]{1,3}$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 254 ] \
    || die "octet must be 1-254 (got '${1:-}')"
}
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required on this host"; }
docker_ok() {
  need docker
  docker info >/dev/null 2>&1 || die "Docker is not running (start it: nohup dockerd >/tmp/dockerd.log 2>&1 &)"
}

# ------------------------------------------------------------------ lab variables
set_lab() {  # name [octet]
  NAME="$1"; STATE="$STATE_ROOT/$NAME"; NET="lab-$NAME"
  if [ -n "${2:-}" ]; then
    OCTET="$2"; PREFIX="192.168.$OCTET"; SUBNET="$PREFIX.0/24"; GW="$PREFIX.1"; BRIDGE="tlab$OCTET"
    NOPROXY="localhost,127.0.0.1,::1,$SUBNET"
  fi
}
load_lab() {  # name: from the state file, else from the Docker network
  check_name "$1"; set_lab "$1"
  if [ -f "$STATE/lab.env" ]; then
    local o; o="$(sed -n 's/^OCTET=//p' "$STATE/lab.env")"
    set_lab "$1" "$o"
  elif docker network inspect "$NET" >/dev/null 2>&1; then
    local sn; sn="$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' "$NET")"
    set_lab "$1" "$(printf '%s' "$sn" | cut -d. -f3)"
  else
    die "no lab named '$1' (nothing in $STATE and no Docker network $NET)"
  fi
}
host_field() {  # host field-number
  local s; for s in "${HOSTS[@]}"; do
    [ "${s%%|*}" = "$1" ] && { printf '%s' "$s" | cut -d'|' -f"$2"; return 0; }
  done
  return 1
}
cname() { printf 'lab-%s-%s' "$NAME" "$1"; }
label_of() { docker inspect -f "{{index .Config.Labels \"$IMG.$2\"}}" "$1" 2>/dev/null || true; }

upstream_proxy() {
  local p="${LAB_UPSTREAM_PROXY:-${HTTPS_PROXY:-${https_proxy:-}}}"
  p="${p#*://}"; p="${p%%/*}"; p="${p##*@}"
  printf '%s' "${p:-127.0.0.1:37749}"
}
cgroup_ns() {  # host: on a cgroup v1/hybrid host lab-init builds its own cgroup2 subtree
  if [ "$(stat -fc %T /sys/fs/cgroup 2>/dev/null || true)" = cgroup2fs ]; then echo private; else echo host; fi
}

tcp_open() { timeout 2 bash -c "exec 3<>/dev/tcp/$1/$2" >/dev/null 2>&1; }
is_listening() {  # ip port: a listening socket in this host's network namespace (no connect)
  local a b c d hex
  IFS=. read -r a b c d <<< "$1"
  hex="$(printf '%02X%02X%02X%02X:%04X' "$d" "$c" "$b" "$a" "$2")"
  awk -v want="$hex" 'NR > 1 && $2 == want && $4 == "0A" { found = 1 } END { exit !found }' /proc/net/tcp
}

# ------------------------------------------------------------------ images
prep_ca() {
  local src="${LAB_CA_FILE:-/root/.ccr/ca-bundle.crt}"
  [ -s "$src" ] || src=/etc/ssl/certs/ca-certificates.crt
  [ -s "$src" ] || die "no CA bundle found; set LAB_CA_FILE"
  mkdir -p "$CACHE/ca"
  cmp -s "$src" "$CACHE/ca/proxy-ca.crt" || cp "$src" "$CACHE/ca/proxy-ca.crt"
  CA_SRC="$src"
}

# native or fallback for debian|fedora|arch: are the distro mirrors reachable through the
# proxy? The answer is cached for 12 h so a mirror the egress policy denies is not asked on
# every run.
distro_mode() {
  local d="$1" url f r=fallback
  case "${LAB_DISTRO_MODE:-auto}" in native|fallback) echo "$LAB_DISTRO_MODE"; return ;; esac
  case "$d" in
    debian) url="$DEBIAN_MIRROR/debian/dists/bookworm/Release" ;;
    fedora) url="$FEDORA_PROBE" ;;
    arch)   url="$ARCH_MIRROR/core/os/x86_64/core.db" ;;
  esac
  f="$CACHE/probe-$d"
  if [ -n "$(find "$f" -mmin -720 2>/dev/null)" ] && [ "$(cut -d' ' -f2- "$f")" = "$url" ]; then
    cut -d' ' -f1 "$f"; return
  fi
  if curl -fsS -o /dev/null -m 15 --proxy "http://$(upstream_proxy)" --cacert "$CA_SRC" "$url" 2>/dev/null; then
    r=native
  fi
  printf '%s %s\n' "$r" "$url" > "$f"
  echo "$r"
}

build_target() {  # target tag
  local target="$1" tag="$2" log="$CACHE/build-$1.log" t0=$SECONDS up
  up="$(upstream_proxy)"
  if docker build --network host \
      --build-context "labca=$CACHE/ca" \
      --build-arg "https_proxy=http://$up" --build-arg "HTTPS_PROXY=http://$up" \
      --build-arg "REG=$REGISTRY" --build-arg "DEBIAN_MIRROR=$DEBIAN_MIRROR" \
      --build-arg "ARCH_MIRROR=$ARCH_MIRROR" \
      --target "$target" -t "$tag" "$LAB_DIR/images" >"$log" 2>&1; then
    say "image $tag ready (target $target, $((SECONDS - t0))s)"
  else
    warn "build of target $target failed; end of $log:"
    tail -n 30 "$log" >&2
    return 1
  fi
}

build_images() {
  mkdir -p "$CACHE"
  prep_ca
  local img mode
  for img in "${IMAGES[@]}"; do
    case "$img" in
      debian|fedora|arch)
        mode="$(distro_mode "$img")"
        if [ "$mode" = native ] && ! build_target "$img-native" "$IMG/$img"; then
          warn "$img: the native image failed to build; using the fallback image"
          mode=fallback
        fi
        if [ "$mode" = fallback ]; then
          build_target "$img-fallback" "$IMG/$img" || die "image $IMG/$img failed to build"
        fi
        ;;
      *)
        build_target "$img" "$IMG/$img" || die "image $IMG/$img failed to build"
        ;;
    esac
  done
}

# ------------------------------------------------------------------ network and helpers
check_network() {  # fail early when the subnet or bridge name is taken by something else
  if docker network inspect "$NET" >/dev/null 2>&1; then
    local sn; sn="$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' "$NET")"
    [ "$sn" = "$SUBNET" ] || die "network $NET exists with subnet $sn, not $SUBNET; run: lab.sh down $NAME"
    return 0
  fi
  local n other=""
  for n in $(docker network ls -q); do
    if docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$n" | grep -qw -- "$SUBNET"; then
      other="$(docker network inspect -f '{{.Name}}' "$n")"
    fi
  done
  [ -z "$other" ] || die "subnet $SUBNET is already used by Docker network '$other'; pick another octet"
  [ ! -e "/sys/class/net/$BRIDGE" ] || die "interface $BRIDGE already exists on this host; pick another octet"
}
ensure_network() {
  check_network
  docker network inspect "$NET" >/dev/null 2>&1 && return 0
  docker network create --driver bridge --subnet "$SUBNET" --gateway "$GW" \
    -o "com.docker.network.bridge.name=$BRIDGE" --label "$IMG=$NAME" "$NET" >/dev/null
}

proc_alive() {  # pidfile marker
  local pid; pid="$(cat "$1" 2>/dev/null || true)"
  [ -n "$pid" ] && [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q -- "$2 *$"
}
start_bg() {  # pidfile logfile ip port cmd...   (the marker trimurti-lab=<name> is appended)
  local pidf="$1" logf="$2" ip="$3" port="$4"
  shift 4
  if ! proc_alive "$pidf" "$IMG=$NAME"; then
    is_listening "$ip" "$port" && die "something else already listens on $ip:$port"
    nohup setsid "$@" "$IMG=$NAME" >>"$logf" 2>&1 </dev/null &
    echo $! > "$pidf"
  fi
  for _ in $(seq 1 50); do
    is_listening "$ip" "$port" && return 0
    proc_alive "$pidf" "$IMG=$NAME" || break
    sleep 0.1
  done
  tail -n 5 "$logf" >&2 || true
  die "$(basename "$2") did not start listening on $ip:$port"
}
stop_bg() {  # pidfile
  local pid; pid="$(cat "$1" 2>/dev/null || true)"
  if [ -n "$pid" ] && proc_alive "$1" "$IMG=$NAME"; then kill "$pid" 2>/dev/null || true; fi
}

copy_kit() {
  if [ -d "$STATE/kit" ]; then say "keeping the existing kit copy $STATE/kit"; return 0; fi
  rm -rf "$STATE/kit.tmp"; mkdir -p "$STATE/kit.tmp"
  tar -C "$KIT_SRC" --exclude=./test --exclude=./mcp/node_modules --exclude=./mcp/dist -cf - . \
    | tar -C "$STATE/kit.tmp" -xf -
  mv "$STATE/kit.tmp" "$STATE/kit"
  # uid 1000 is the user gallery in the admin container
  if [ "$(id -u)" -eq 0 ]; then chown -R 1000:1000 "$STATE/kit"; fi
}

run_host() {  # host
  local h="$1" c init image o args
  c="$(cname "$h")"; o="$(host_field "$h" 2)"; image="$IMG/$(host_field "$h" 3)"
  if docker inspect "$c" >/dev/null 2>&1; then
    if [ "$(docker inspect -f '{{.State.Running}}' "$c")" != true ]; then docker start "$c" >/dev/null; fi
    return 0
  fi
  init="$(docker image inspect -f "{{index .Config.Labels \"$IMG.init\"}}" "$image")"
  args=(-d --name "$c" --hostname "$h" --network "$NET" --ip "$PREFIX.$o"
        --label "$IMG=$NAME" --label "$IMG.host=$h"
        -e "LAB_PROXY=http://$GW:3128" -e "LAB_NO_PROXY=$NOPROXY" -e "LAB_CGROUP=$NAME/$h"
        -e "https_proxy=http://$GW:3128" -e "HTTPS_PROXY=http://$GW:3128"
        -e "no_proxy=$NOPROXY" -e "NO_PROXY=$NOPROXY"
        -e "NODE_EXTRA_CA_CERTS=/usr/local/share/lab/proxy-ca.crt")
  if [ "$init" = systemd ]; then
    args+=(--privileged "--cgroupns=$(cgroup_ns)" --stop-timeout 10
           --tmpfs "/run:rw,exec,nosuid,nodev,mode=755" --tmpfs "/run/lock:rw,noexec,nosuid,nodev"
           --tmpfs "/tmp:rw,exec,nosuid,nodev,mode=1777")
  else
    args+=(--init)
  fi
  case "$h" in
    admin)
      args+=(-v "$STATE/kit:/kit")
      if [ -d /opt/node22 ]; then args+=(-v /opt/node22:/opt/node22:ro); else warn "/opt/node22 not found: admin has no node"; fi
      ;;
    nas) args+=(--mac-address "$(printf '00:11:32:%02x:00:1e' "$OCTET")") ;;   # Synology OUI
  esac
  docker run "${args[@]}" "$image" >/dev/null
}

systemd_state() { docker exec "$1" systemctl is-system-running 2>/dev/null || true; }

wait_ready() {
  local s h c init ip st deadline
  for s in "${HOSTS[@]}"; do
    h="${s%%|*}"; c="$(cname "$h")"; ip="$PREFIX.$(host_field "$h" 2)"
    init="$(label_of "$c" init)"; deadline=$((SECONDS + 150))
    case "$init" in
      systemd)
        st=""
        while [ "$SECONDS" -lt "$deadline" ]; do
          st="$(docker exec "$c" timeout 30 systemctl is-system-running --wait 2>/dev/null || true)"
          case "$st" in running|degraded) break ;; esac
          sleep 1
        done
        if [ "$st" = running ]; then say "$h: systemd running"
        else
          warn "$h: systemd is '${st:-unreachable}'"
          docker exec "$c" systemctl --failed --no-legend 2>/dev/null | sed 's/^/      /' >&2 || true
        fi
        ;;
      sshd)
        until tcp_open "$ip" 22; do [ "$SECONDS" -lt "$deadline" ] || { warn "$h: sshd not answering"; break; }; sleep 1; done ;;
      nas)
        until tcp_open "$ip" 445 && tcp_open "$ip" 5000; do
          [ "$SECONDS" -lt "$deadline" ] || { warn "$h: SMB/DSM not answering"; break; }; sleep 1
        done ;;
      *) docker exec "$c" true ;;
    esac
  done
}

bridge_mac() { cat "/sys/class/net/$BRIDGE/address" 2>/dev/null || echo "?"; }
host_mac() {
  docker inspect -f "{{with index .NetworkSettings.Networks \"$NET\"}}{{.MacAddress}}{{end}}" "$1" 2>/dev/null || true
}

print_table() {
  local s h c ip st init sudo ssh fw tw
  fw=down; proc_alive "$STATE/fwd.pid" "$IMG=$NAME" && fw=up
  tw=down; proc_alive "$STATE/tripwire.pid" "$IMG=$NAME" && tw=up
  printf '%-12s %-15s %-18s %-17s %-7s %-9s %s\n' HOST IP MAC STATE SSH:22 SUDO NOTES
  printf '%-12s %-15s %-18s %-17s %-7s %-9s %s\n' router "$GW" "$(bridge_mac)" "proxy:$fw trip:$tw" trip - \
    "Docker bridge $BRIDGE = the router; HTTPS proxy on :3128; tripwire on :22 :23 (never log in)"
  for s in "${HOSTS[@]}"; do
    h="${s%%|*}"; c="$(cname "$h")"; ip="$PREFIX.$(host_field "$h" 2)"
    st="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
    init="$(label_of "$c" init)"; sudo="$(label_of "$c" sudo)"
    if [ "$st" = running ] && [ "$init" = systemd ]; then st="systemd:$(systemd_state "$c")"
    elif [ "$st" = running ]; then st="up ($init)"; fi
    ssh=closed; tcp_open "$ip" 22 && ssh=open
    printf '%-12s %-15s %-18s %-17s %-7s %-9s %s\n' "$h" "$ip" "$(host_mac "$c")" "$st" "$ssh" "${sudo:--}" \
      "$(label_of "$c" note)"
  done
}

cleanup_cgroups() {
  local root d
  root="$(awk '$3 == "cgroup2" { print $2; exit }' /proc/mounts)"
  [ -n "$root" ] || return 0
  d="$root/trimurti-lab/$NAME"
  for _ in 1 2 3 4 5; do
    [ -d "$d" ] || break
    find "$d" -depth -type d -exec rmdir {} + 2>/dev/null || true
    [ -d "$d" ] && sleep 1
  done
  rmdir "$root/trimurti-lab" 2>/dev/null || true
  [ ! -d "$d" ] || warn "could not remove cgroup $d"
}

# ------------------------------------------------------------------ commands
cmd_build() { docker_ok; need curl; build_images; }

cmd_up() {
  check_name "${1:-}"; check_octet "${2:-}"
  docker_ok; need python3; need curl; need setsid
  set_lab "$1" "$2"
  if [ -f "$STATE/lab.env" ]; then
    local was; was="$(sed -n 's/^OCTET=//p' "$STATE/lab.env")"
    [ "$was" = "$OCTET" ] || die "lab $NAME already exists on 192.168.$was.0/24; run: lab.sh down $NAME"
  fi
  check_network
  mkdir -p "$STATE"
  local up t0=$SECONDS s
  up="$(upstream_proxy)"
  tcp_open "${up%:*}" "${up##*:}" || warn "upstream proxy $up is not answering: hosts will have no internet"
  build_images
  ensure_network
  {
    printf 'NAME=%s\nOCTET=%s\nSUBNET=%s\nGATEWAY=%s\nNETWORK=%s\nBRIDGE=%s\n' "$NAME" "$OCTET" "$SUBNET" "$GW" "$NET" "$BRIDGE"
    printf 'UPSTREAM_PROXY=%s\nLAB_PROXY=http://%s:3128\nCGROUPNS=%s\n' "$up" "$GW" "$(cgroup_ns)"
  } > "$STATE/lab.env"
  if proc_alive "$STATE/fwd.pid" "$IMG=$NAME" \
     && ! tr '\0' ' ' < "/proc/$(cat "$STATE/fwd.pid")/cmdline" | grep -q -- " ${up%:*} ${up##*:} "; then
    say "the upstream proxy is now $up: restarting the forwarder"
    stop_bg "$STATE/fwd.pid"
    for _ in $(seq 1 30); do is_listening "$GW" 3128 || break; sleep 0.1; done
  fi
  start_bg "$STATE/fwd.pid" "$STATE/fwd.log" "$GW" 3128 python3 "$LAB_DIR/fwd.py" "$GW" 3128 "${up%:*}" "${up##*:}"
  start_bg "$STATE/tripwire.pid" "$STATE/tripwire.out" "$GW" 23 \
    python3 "$LAB_DIR/tripwire.py" "$GW" "$STATE/router-tripwire.log" 22 23
  is_listening "$GW" 22 || die "tripwire is not listening on $GW:22"
  copy_kit
  for s in "${HOSTS[@]}"; do run_host "${s%%|*}"; done
  wait_ready
  say "lab $NAME is up in $((SECONDS - t0))s: $SUBNET, gateway $GW"
  print_table
  cat <<EOF

  kit copy (mounted at /kit in admin): $STATE/kit
  router tripwire log:                 $STATE/router-tripwire.log
  shell on a host:                     $0 exec $NAME admin -u gallery
  ground-truth inventory:              $0 inventory $NAME
  self-test:                           $0 check $NAME
  lab user on every host: gallery / $LAB_PW (test only)
EOF
}

cmd_down() {
  check_name "${1:-}"; set_lab "$1"
  local ids s c left=0
  say "tearing down lab $NAME"
  stop_bg "$STATE/fwd.pid"; stop_bg "$STATE/tripwire.pid"
  pkill -f -- "(fwd|tripwire)\\.py .*$IMG=$NAME\$" 2>/dev/null || true
  if docker info >/dev/null 2>&1; then
    ids="$(docker ps -aq --filter "label=$IMG=$NAME")"
    for s in "${HOSTS[@]}"; do
      c="$(cname "${s%%|*}")"
      docker inspect "$c" >/dev/null 2>&1 && ids="$ids $(docker inspect -f '{{.Id}}' "$c")"
    done
    # shellcheck disable=SC2086  # word splitting of the id list is intended
    if [ -n "${ids// /}" ]; then docker rm -f $ids >/dev/null 2>&1 || true; fi
    if docker network inspect "$NET" >/dev/null 2>&1; then
      for c in $(docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$NET"); do
        docker network disconnect -f "$NET" "$c" >/dev/null 2>&1 || true
      done
      docker network rm "$NET" >/dev/null 2>&1 || true
    fi
  else
    warn "Docker is not running: containers and network could not be checked"
  fi
  cleanup_cgroups
  sleep 0.3
  rm -rf "$STATE"
  # verify
  if docker info >/dev/null 2>&1; then
    [ -z "$(docker ps -aq --filter "label=$IMG=$NAME")" ] || { warn "containers left behind"; left=1; }
    ! docker network inspect "$NET" >/dev/null 2>&1 || { warn "network $NET left behind"; left=1; }
  fi
  if pgrep -f -- "(fwd|tripwire)\\.py .*$IMG=$NAME\$" >/dev/null 2>&1; then warn "forwarder/tripwire still running"; left=1; fi
  [ ! -e "$STATE" ] || { warn "state directory left behind"; left=1; }
  [ "$left" = 0 ] || die "lab $NAME was not removed completely"
  say "lab $NAME removed (images are kept as build cache)"
}

cmd_status() {
  docker_ok
  if [ -z "${1:-}" ]; then
    local d n any=0
    printf '%-20s %-18s %s\n' LAB SUBNET CONTAINERS
    for d in "$STATE_ROOT"/*/; do
      [ -f "$d/lab.env" ] || continue
      n="$(basename "$d")"; any=1
      printf '%-20s %-18s %s running\n' "$n" "$(sed -n 's/^SUBNET=//p' "$d/lab.env")" \
        "$(docker ps -q --filter "label=$IMG=$n" | wc -l)"
    done
    for n in $(docker network ls --filter "label=$IMG" --format '{{.Name}}'); do
      [ -f "$STATE_ROOT/${n#lab-}/lab.env" ] || { printf '%-20s %-18s %s\n' "${n#lab-}" "?" "network without state (half-built?)"; any=1; }
    done
    [ "$any" = 1 ] || echo "(no labs)"
    return 0
  fi
  load_lab "$1"
  echo "lab $NAME: $SUBNET gateway $GW, network $NET, bridge $BRIDGE, state $STATE"
  print_table
  local log="$STATE/router-tripwire.log"
  if [ -f "$log" ]; then
    echo; echo "router tripwire: $(wc -l < "$log") connection(s) logged in $log"
    tail -n 5 "$log" | sed 's/^/  /'
  fi
}

cmd_exec() {
  load_lab "${1:-}"; local h="${2:-}" user="${LAB_EXEC_USER:-}" flags=(-i)
  host_field "$h" 1 >/dev/null || die "unknown host '$h' (hosts: $(printf '%s ' "${HOSTS[@]%%|*}"))"
  shift 2
  if [ "${1:-}" = -u ] || [ "${1:-}" = --user ]; then user="${2:-}"; shift 2; fi
  if [ -t 0 ] && [ -t 1 ]; then flags+=(-t); fi
  if [ -n "$user" ]; then flags+=(-u "$user"); fi
  if [ $# -eq 0 ]; then set -- bash -l; fi
  exec docker exec "${flags[@]}" "$(cname "$h")" "$@"
}

cmd_inventory() {
  docker_ok; load_lab "${1:-}"
  local s h o os role port tri c note
  echo "name,ip,mac,os,user,role,ssh_port,trimurti,notes"
  printf 'router,%s,%s,other,admin,router,,no,%s\n' "$GW" "$(bridge_mac)" \
    "lab gateway (Docker bridge $BRIDGE); HTTPS proxy on 3128; tripwire on 22 and 23 - never log in"
  for s in "${HOSTS[@]}"; do
    IFS='|' read -r h o _ os role port tri <<< "$s"
    c="$(cname "$h")"
    note="$(label_of "$c" note)"
    printf '%s,%s,%s,%s,gallery,%s,%s,%s,%s\n' "$h" "$PREFIX.$o" "$(host_mac "$c")" "$os" "$role" \
      "$port" "$tri" "${note//,/;}"
  done
}

cmd_check() {
  docker_ok; load_lab "${1:-}"
  local fails=0 s h c ip init sudo out log before after inv mac real admin
  admin="$(cname admin)"
  pass() { printf '  PASS  %s\n' "$*"; }
  fail() { printf '  FAIL  %s\n' "$*"; fails=$((fails + 1)); }
  ck() {  # description command [args...]: PASS when the command succeeds
    local d="$1"; shift
    if "$@"; then pass "$d"; else fail "$d"; fi
  }
  not() { ! "$@"; }
  local sshopts="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive"
  echo "lab $NAME self-test"

  for s in "${HOSTS[@]}"; do
    h="${s%%|*}"; c="$(cname "$h")"
    ck "$h: container running" [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ]
  done
  if proc_alive "$STATE/fwd.pid" "$IMG=$NAME" && is_listening "$GW" 3128; then
    pass "router: proxy forwarder on $GW:3128"; else fail "router: proxy forwarder on $GW:3128"; fi
  if proc_alive "$STATE/tripwire.pid" "$IMG=$NAME" && is_listening "$GW" 22 && is_listening "$GW" 23; then
    pass "router: tripwire listening on $GW:22 and $GW:23"; else fail "router: tripwire listening on $GW:22 and $GW:23"; fi

  # password SSH, the proxy in a non-interactive session, sudo behaviour
  for h in ubuntu-desk debian-pc fedora-pc arch-pc; do
    c="$(cname "$h")"; ip="$PREFIX.$(host_field "$h" 2)"; sudo="$(label_of "$c" sudo)"
    # shellcheck disable=SC2086  # $sshopts is a list of options
    out="$(docker exec "$admin" sshpass -p "$LAB_PW" ssh $sshopts "gallery@$ip" \
      'echo "user=$(id -un)"; curl -sS -o /dev/null -I -m 25 -w "curl=%{http_code} connect=%{http_connect}\n" https://registry.npmjs.org; if sudo -n true 2>/dev/null; then echo sudo=nopasswd; else echo sudo=password; fi' 2>&1 || true)"
    ck "$h: password SSH login as gallery" grep -q '^user=gallery$' <<< "$out"
    ck "$h: ssh gallery@$ip curl -I https://registry.npmjs.org via the proxy ($(grep '^curl=' <<< "$out" || echo 'no answer'))" \
      grep -q '^curl=200 connect=200$' <<< "$out"
    ck "$h: sudo is $sudo ($(grep '^sudo=' <<< "$out" || echo '?'))" grep -q "^sudo=$sudo\$" <<< "$out"
  done

  # init systems
  for s in "${HOSTS[@]}"; do
    h="${s%%|*}"; c="$(cname "$h")"; init="$(label_of "$c" init)"
    case "$init" in
      systemd)
        out="$(systemd_state "$c")"
        ck "$h: systemctl is-system-running = $out" [ "$out" = running ] ;;
      sshd)
        # shellcheck disable=SC2016  # expanded inside the container
        ck "$h: sshd runs under docker-init (this image has no systemd)" \
          docker exec "$c" sh -c 'test "$(cat /proc/1/comm)" = docker-init' ;;
    esac
  done

  # per-lab proxy settings on every Linux host
  for s in "${HOSTS[@]}"; do
    h="${s%%|*}"; c="$(cname "$h")"
    ck "$h: /etc/environment carries https_proxy=http://$GW:3128" \
      docker exec "$c" grep -qx "https_proxy=http://$GW:3128" /etc/environment
  done

  # package installs through the proxy on Ubuntu: over SSH with sudo, and locally on new-pc-2
  # shellcheck disable=SC2086
  ck "ubuntu-desk: sudo apt-get update over a non-interactive SSH session" \
    docker exec "$admin" sshpass -p "$LAB_PW" ssh $sshopts "gallery@$PREFIX.21" 'sudo -n apt-get -qq update >/dev/null 2>&1'
  ck "new-pc-2: sudo apt-get update locally (so enable-ssh-server.sh can install openssh-server)" \
    docker exec -u gallery "$(cname new-pc-2)" sh -c 'sudo -n apt-get -qq update >/dev/null 2>&1'
  if tcp_open "$PREFIX.25" 22 || docker exec "$(cname new-pc-2)" test -e /usr/sbin/sshd; then
    warn "new-pc-2 already has sshd (expected only after the kit installed it)"
  else
    pass "new-pc-2: no openssh-server yet, port 22 closed"
  fi

  # NAS
  ip="$PREFIX.30"
  out="$(docker exec "$admin" smbclient -L "//$ip" -U "gallery%$LAB_PW" -m SMB3 2>&1 || true)"
  ck "nas: smbclient -L //$ip -U gallery lists share 'gallery'" grep -Eq '^[[:space:]]+gallery[[:space:]]+Disk' <<< "$out"
  ck "nas: SMB1 refused" not docker exec "$admin" sh -c \
    "smbclient -L //$ip -U 'gallery%$LAB_PW' --option='client min protocol=NT1' -m NT1 >/dev/null 2>&1"
  ck "nas: guest access refused" not docker exec "$admin" sh -c "smbclient //$ip/gallery -N -c ls >/dev/null 2>&1"
  ck "nas: SMB signing mandatory (testparm: server signing = required)" \
    [ "$(docker exec "$(cname nas)" testparm -s --parameter-name='server signing' 2>/dev/null)" = required ]
  out="$(docker exec "$admin" curl -s -m 5 "http://$ip:5000/" | grep -o '<title>[^<]*</title>' || true)"
  ck "nas: http://$ip:5000/ shows $out" [ "$out" = "<title>Synology DiskStation</title>" ]
  out="$(docker exec "$admin" curl -sk -m 5 "https://$ip:5001/" | grep -o '<title>[^<]*</title>' || true)"
  ck "nas: https://$ip:5001/ shows $out" [ "$out" = "<title>Synology DiskStation</title>" ]
  ck "nas: no sshd (port 22 closed)" not tcp_open "$ip" 22

  # router tripwire, probed from this host: Docker masquerades the source to an address
  # outside the lab subnet, so a tester can tell these lines from the lab machines' ones
  log="$STATE/router-tripwire.log"; before="$(wc -l < "$log")"
  python3 - "$GW" <<'PY' || true
import socket, sys
gw = sys.argv[1]
for port, hello in ((22, b"SSH-2.0-lab-check\r\n"), (23, b"")):
    s = socket.socket()
    s.settimeout(4)
    s.bind((gw, 0))
    s.connect((gw, port))
    if hello:
        s.sendall(hello)
    try:
        s.recv(16)
    except OSError:
        pass
    s.close()
PY
  sleep 1; after="$(wc -l < "$log")"
  if [ "$((after - before))" -ge 2 ] && tail -n 2 "$log" | grep -q -- '-> 22 first-bytes="SSH-2.0-lab-check"' \
     && tail -n 2 "$log" | grep -q -- '-> 23$'; then
    pass "router: tripwire logged the self-test connections (source = this host):"
  else
    fail "router: tripwire did not log the self-test connections:"
  fi
  tail -n 2 "$log" | sed 's/^/          /'

  # ground-truth inventory against the interfaces themselves
  inv="$(cmd_inventory "$NAME")"
  for s in "${HOSTS[@]}"; do
    h="${s%%|*}"; c="$(cname "$h")"
    mac="$(awk -F, -v h="$h" '$1 == h { print $3 }' <<< "$inv")"
    real="$(docker exec "$c" cat /sys/class/net/eth0/address 2>/dev/null || true)"
    ck "inventory: $h MAC ${mac:-none} (eth0 has $real)" [ -n "$mac" ] && [ "$mac" = "$real" ]
  done
  mac="$(awk -F, '$1 == "router" { print $3 }' <<< "$inv")"
  real="$(docker exec "$admin" sh -c "ping -c1 -W1 $GW >/dev/null; ip neigh show $GW" | awk '{ print $5 }')"
  ck "inventory: router MAC $mac (admin's neighbour table has $real)" [ "$mac" = "$real" ]

  # admin machine
  ck "admin: kit copy at /kit, without test/" docker exec "$admin" sh -c 'test -f /kit/scripts/lib.sh && ! test -e /kit/test'
  out="$(docker exec -u gallery "$admin" node --version 2>/dev/null || true)"
  ck "admin: node ${out:-missing} on gallery's PATH" [ "${out#v22.}" != "$out" ]

  echo
  if [ "$fails" -eq 0 ]; then echo "all checks passed"; else echo "$fails check(s) failed"; return 1; fi
}

# ------------------------------------------------------------------ main
cmd="${1:-help}"; [ $# -gt 0 ] && shift
case "$cmd" in
  up)        [ $# -eq 2 ] || usage 2; cmd_up "$@" ;;
  down)      [ $# -eq 1 ] || usage 2; cmd_down "$1" ;;
  status)    cmd_status "${1:-}" ;;
  exec)      [ $# -ge 2 ] || usage 2; cmd_exec "$@" ;;
  inventory) [ $# -eq 1 ] || usage 2; cmd_inventory "$1" ;;
  check)     [ $# -eq 1 ] || usage 2; cmd_check "$1" ;;
  build)     cmd_build ;;
  help|-h|--help) usage 0 ;;
  *) usage 2 ;;
esac
