# Network triage

## What "sorted" means (the end state)

- One box routes, NATs, serves DHCP and DNS: **the router**. The ISP modem or gateway is in bridge or passthrough mode (AT&T calls it IP Passthrough). If the ISP box cannot bridge, its Wi-Fi is off and the router's WAN address sits in its DMZ; that is still double NAT, only a working one.
- Every other Wi-Fi box (mesh satellites, extenders, the old router) is in **AP / bridge mode**: no NAT, no DHCP of its own.
- One flat subnet, a /24 such as `192.168.1.0/24`.
- DHCP: pool `.100`–`.199`, lease 24 h. **A reservation for every named machine** in `inventory.csv` (use `.10`–`.99`), keyed by MAC, so IPs never move again.
- DNS handed to clients = the router; the router forwards to one provider's pair (Quad9 `9.9.9.9` + `149.112.112.112`, or Cloudflare `1.1.1.1` + `1.0.0.1`), or to the Pi-hole if one exists. Reserved hosts resolve by name where the router can do that (ASUS, UniFi, Synology), and by `.local` mDNS names plus `ssh-config-gen.sh` everywhere else.
- Every Windows machine on the **Private** network profile. Every machine answers ping and SSH from every other; PCs and the NAS answer SMB.
- Wired where it matters: NAS, desktops, AP backhaul. Links negotiate at 1 Gb/s, not 100 Mb/s.

`scripts/netscan.sh` (or `.ps1`) measures most of this; it pings the router but never port-probes it. Run it on two different machines: if they report different subnets or gateways, that is the mess.

Fixes marked **ASK** change the router, the modem or another box, or restart machines: Sanjay's yes first, one change at a time, with `router-tuning.md`'s backup and undo.

## Symptom → cause → check → fix

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| Some devices cannot see others; the NAS or printer "sometimes" disappears | Two subnets or two DHCP servers: ISP gateway *and* router, or a mesh node left in router mode | Run netscan on two machines. Do they show different gateways or third octets? A stuck device on `169.254.x.x` got no DHCP at all | **ASK** Put the extra box in bridge/AP mode (or DMZ the router in the modem). Power-cycle clients afterwards |
| **Double NAT**: netscan says `DOUBLE NAT likely` or `possible double NAT` (or `double-NAT check inconclusive`); port forwards, VPN, VoIP or console gaming misbehave | Modem routes and router routes. `possible` means hop 2 is in 10/8 or 172.16/12, which can also be an ISP that numbers its own network privately | Definitive check: the router's status page WAN IP against https://api.ipify.org. Equal → single NAT. WAN IP in 10/8, 172.16/12 or 192.168/16 → double NAT (the modem routes). WAN IP in 100.64–100.127 → the ISP's carrier-grade NAT | **ASK** Bridge mode or IP Passthrough on the modem (ISP support page has the steps). If not possible, DMZ the router's WAN IP in the modem and disable the modem's Wi-Fi |
| netscan says **ISP CGNAT** | The ISP shares one public address across customers (RFC 6598) | WAN IP on the router in 100.64.0.0/10 | Nothing on the LAN causes it. Inbound port forwards and some VPNs cannot work; ask the ISP for a public IP if that matters. Everything else in this kit is unaffected |
| "IP address conflict" pop-ups; one host drops when another boots | Static IPs set inside the DHCP pool | Router DHCP page: pool range vs. the statics on the NAS/printer/PCs | **ASK** Move the pool, or better, convert every static into a reservation and set the device back to DHCP |
| `ping 192.168.1.20` works, `ping nas` does not | Router does not serve local names (Netgear, TP-Link, eero and Google/Nest never do); or mDNS is blocked by client isolation | `nslookup nas <router-ip>`; try `nas.local` | **ASK** On ASUS, UniFi or Synology routers, turn on local hostnames (router-tuning.md §2). On the others, use `nas.local` and run `ssh-config-gen.sh` so `ssh nas` works regardless. Disable AP or client isolation on the main SSID either way |
| A Windows PC browses fine but nobody can ping it or reach its shares (SSH may still work) | Public network profile: Windows hides the machine and its built-in ping and file-sharing rules are Private-only | `Get-NetConnectionProfile` | `Set-NetConnectionProfile -InterfaceIndex N -NetworkCategory Private`. `enable-ssh-server.ps1` does this for the LAN interface only (the one with the default route); other Public interfaces stay as they are. Ping also needs `Set-NetFirewallRule -Name FPS-ICMP4-ERQ-In -Enabled True` |
| Copies to the NAS crawl; a wired desktop feels like Wi-Fi | 100 Mb/s link (damaged cable, bad port), or a Wi-Fi backhaul | netscan prints the link speed; switch port LEDs (amber usually = 100 Mb); NAS network page | Replace the cable (Cat5e or better, no kinks), try another switch port; wire the AP backhaul |
| Wi-Fi drops, roaming stalls, devices stick to the far AP | Channel overlap, DFS radar hits, band steering flapping, transmit power too high, no roaming assistance | Router Wi-Fi page; a Wi-Fi analyser app on a phone | **ASK** 2.4 GHz: fixed channel 1, 6 or 11 at 20 MHz. 5 GHz: 80 MHz on a non-DFS channel. Turn on 802.11k/v. Lower power on the nearer AP. Use 6 GHz if the router has it. If "Smart Connect" flaps, give the bands separate SSIDs |
| Everything dies at once for a minute, at random | Cable loop (two cables between the same switches), failing switch or its PSU | All switch LEDs blinking hard together = loop. Router log | Find and pull the loop; replace the switch |
| Internet fine, but Finder / Explorer "Network" is empty | Discovery (mDNS, NetBIOS, WS-Discovery) blocked or off. SMB itself is usually fine | `nc -z nas 445` open? Then it is discovery only | Windows: services `fdPHost` and `FDResPub` → Automatic; macOS: Finder → Go → Connect to Server → `smb://nas.local`. **ASK** Turn off client isolation on the router |
| Some sites hang for seconds, then load | Half-configured IPv6 | `ip -6 route` / `ifconfig`; open https://test-ipv6.com | **ASK** Either native IPv6 from the ISP, configured properly, or IPv6 off on the router. Not half |
| Devices get an IP from the wrong range after a reboot | A rogue DHCP server (old router, a mesh node, a PC running a VM bridge) | `sudo nmap --script broadcast-dhcp-discover --script-args timeout=10s` on Linux/macOS with nmap installed (root needed). Every responder is listed; only the router should answer. Windows: `ipconfig /all` on two machines must show the same "DHCP Server" address | **ASK** Bridge the extra box, or unplug it |

## Order of work

1. **ASK** Topology: modem → router → switch/APs. One router. Everything else bridged.
2. **ASK** DHCP and subnet: one server, one /24, pool `.100`–`.199`.
3. **ASK** Reservations for every row in `inventory.csv`. Renew the clients' leases (a reboot only with a yes).
4. **ASK** DNS: router as forwarder to one provider's pair; local names on where the router supports it, `.local` names plus `ssh-config-gen.sh` where it does not.
5. Windows LAN interfaces to Private (`enable-ssh-server.ps1` switches the one with the default route).
6. Cables and link speeds.
7. **ASK** Wi-Fi channels and power.

Re-run netscan after each step. Keep the before and after CSVs in `out/`; note what changed in `status.md`.
