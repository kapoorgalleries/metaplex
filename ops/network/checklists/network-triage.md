# Network triage

## What "sorted" means (the end state)

- One box routes, NATs, serves DHCP and DNS: **the router**. The ISP modem or gateway is in bridge or passthrough mode. If the ISP box cannot bridge, its Wi-Fi is off and the router's WAN address sits in its DMZ.
- Every other Wi-Fi box (mesh satellites, extenders, the old router) is in **AP / bridge mode**: no NAT, no DHCP of its own.
- One flat subnet, a /24 such as `192.168.1.0/24`.
- DHCP: pool `.100`–`.199`, lease 24 h. **A reservation for every named machine** in `inventory.csv` (use `.10`–`.99`), keyed by MAC, so IPs never move again.
- DNS handed to clients = the router; the router forwards to `1.1.1.1` and `9.9.9.9` (or the Pi-hole, if one exists). Reserved hosts resolve by name.
- Every Windows machine on the **Private** network profile. Every machine answers ping and SSH from every other; PCs and the NAS answer SMB.
- Wired where it matters: NAS, desktops, AP backhaul. Links negotiate at 1 Gb/s, not 100 Mb/s.

`scripts/netscan.sh` (or `.ps1`) measures most of this. Run it on two different machines: if they report different subnets or gateways, that is the mess.

## Symptom → cause → check → fix

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| Some devices cannot see others; the NAS or printer "sometimes" disappears | Two subnets or two DHCP servers: ISP gateway *and* router, or a mesh node left in router mode | Run netscan on two machines. Do they show different gateways or third octets? A stuck device on `169.254.x.x` got no DHCP at all | Put the extra box in bridge/AP mode (or DMZ the router in the modem). Power-cycle clients afterwards |
| netscan says **DOUBLE NAT**; port forwards, VPN, VoIP or console gaming misbehave | Modem routes and router routes | Log into the modem: does it have a LAN IP range and DHCP of its own? | Bridge mode on the modem (ISP support page has the steps). If not possible, DMZ the router's WAN IP in the modem and disable the modem's Wi-Fi |
| "IP address conflict" pop-ups; one host drops when another boots | Static IPs set inside the DHCP pool | Router DHCP page: pool range vs. the statics on the NAS/printer/PCs | Move the pool, or better, convert every static into a reservation and set the device back to DHCP |
| `ping 192.168.1.20` works, `ping nas` does not | Router does not serve local names; or mDNS is blocked by client isolation | `nslookup nas <router-ip>`; try `nas.local` | Enable "DHCP client names in DNS" / local DNS on the router; disable AP or client isolation on the main SSID; and run `ssh-config-gen.sh` so `ssh nas` works regardless |
| A Windows PC browses fine but nobody can ping, SSH or SMB into it | Public network profile | `Get-NetConnectionProfile` | `Set-NetConnectionProfile -InterfaceIndex N -NetworkCategory Private` (`enable-ssh-server.ps1` does this) |
| Copies to the NAS crawl; a wired desktop feels like Wi-Fi | 100 Mb/s link (damaged cable, bad port), or a Wi-Fi backhaul | netscan prints the link speed; switch port LEDs (amber usually = 100 Mb); NAS network page | Replace the cable (Cat5e or better, no kinks), try another switch port; wire the AP backhaul |
| Wi-Fi drops, roaming stalls, devices stick to the far AP | Channel overlap, band steering flapping, transmit power too high | Router Wi-Fi page; a Wi-Fi analyser app on a phone | 2.4 GHz: fixed channel 1, 6 or 11 at 20 MHz. 5 GHz: 80 MHz, non-DFS channel. Lower power on the nearer AP. If "Smart Connect" flaps, give the bands separate SSIDs |
| Everything dies at once for a minute, at random | Cable loop (two cables between the same switches), failing switch or its PSU | All switch LEDs blinking hard together = loop. Router log | Find and pull the loop; replace the switch |
| Internet fine, but Finder / Explorer "Network" is empty | Discovery (mDNS, NetBIOS, WS-Discovery) blocked or off. SMB itself is usually fine | `nc -z nas 445` open? Then it is discovery only | Windows: services `fdPHost` and `FDResPub` → Automatic; macOS: Finder → Go → Connect to Server → `smb://nas.local`. Turn off client isolation |
| Some sites hang for seconds, then load | Half-configured IPv6 | `ip -6 route` / `ifconfig`; open https://test-ipv6.com | Either native IPv6 from the ISP, configured properly, or IPv6 off on the router. Not half |
| Devices get an IP from the wrong range after a reboot | A rogue DHCP server (old router, a mesh node, a PC running a VM bridge) | `sudo nmap --script broadcast-dhcp-discover` on Linux/macOS with nmap installed. Every responder is listed; only the router should answer | Bridge the extra box, or unplug it |

## Order of work

1. Topology: modem → router → switch/APs. One router. Everything else bridged.
2. DHCP and subnet: one server, one /24, pool `.100`–`.199`.
3. Reservations for every row in `inventory.csv`. Reboot or renew the clients.
4. DNS: router as resolver, forwarding upstream; local names on.
5. Windows profiles to Private (`enable-ssh-server.ps1` does it).
6. Cables and link speeds.
7. Wi-Fi channels and power.

Re-run netscan after each step. Keep the before and after CSVs in `out/`; note what changed in `status.md`.
