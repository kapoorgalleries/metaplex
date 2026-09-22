# Router tuning

Rules for this checklist:

- **Back up the router config first** (System / Administration → Backup). Again after.
- **One change at a time, then verify.** Each item below says how to verify and how to undo.
- Items marked **ASK** change how the LAN is addressed or secured. The session confirms with Sanjay before each, because a wrong one locks everyone out.
- **Firmware last**, at a quiet time, with the backup in hand.

The menus differ per make. Names below are generic; the router's manual maps them.

## 1. Access and hygiene

| Item | Why | Do | Verify | Undo |
|---|---|---|---|---|
| Admin password is unique and long | Default or reused passwords are the first thing tried from inside the LAN | Change it; store it in the password manager | Log out, log in | Change back (if the old one is still known) |
| Remote management / WAN access **off** | The admin page must not face the internet | Administration → Remote Management: disable. Also app/cloud management, unless the router is cloud-managed by design (eero, Google/Nest), where the app is the only admin path: keep it, with 2FA on that account | From a phone on mobile data, `https://<public-ip>` must time out | Re-enable |
| UPnP **off** unless something needs it | UPnP lets any LAN device open ports on the router | Advanced → UPnP: disable. What may complain: a game console (NAT type), Plex Remote Access (forward 32400 by hand instead), an IoT camera's remote view, a VoIP adapter. Forward the one port those need instead of leaving UPnP on | Router's UPnP table is empty after a day | Re-enable |
| SNMP **off** if the router offers it | Management protocol nobody here uses; another door | Administration → SNMP | Not listening on 161 | On |
| Scheduled weekly reboot, if offered | Clears leaked memory and stale state on consumer firmware (NSA guidance) | Administration → Reboot schedule: a quiet hour | Uptime resets weekly | Off |
| WPS **off** | WPS PIN is brute-forceable | Wireless → WPS: disable | The WPS light is off | Re-enable |
| NTP set, correct time zone | Logs and cert checks depend on it | Administration → Time | Time on the status page is right | n/a |
| Logging on, log level "warning" or above | Needed to see DHCP conflicts and drops | Administration → Log | Log page shows entries | Off |

## 2. Addressing (ASK before each)

| Item | Why | Do | Verify | Undo |
|---|---|---|---|---|
| **ASK** One subnet, /24 | Two subnets is the root of most "cannot see each other" complaints | LAN → IP: `192.168.1.1/24` (or keep the existing one if it is already a single /24) | netscan from two machines shows the same subnet and gateway | Restore the backup |
| **ASK** DHCP pool `.100`–`.199`, lease 24 h | Leaves `.2`–`.99` for reservations, `.200`+ for future statics | LAN → DHCP | New devices land in the pool | Old range |
| DHCP reservations for every `inventory.csv` row | IPs stop moving; SSH config and NAS mounts stay valid | LAN → DHCP → Address reservation: MAC from netscan → chosen IP (`.10`–`.99`) | `ipconfig /renew` or reconnect; netscan shows the reserved IPs | Delete the reservation |
| Local hostnames in DNS, where the router can | `ping nas`, `ssh studio-mac` work without hosts files | Only some routers do this. ASUS: LAN → DHCP Server, name each reservation and set a LAN Domain Name. UniFi: Settings → Routing → DNS, local hostnames, with the gateway as DHCP and DNS server. Synology SRM: on by default. Netgear, TP-Link, eero and Google/Nest **cannot**: use mDNS names (`nas.local`) and `scripts/ssh-config-gen.sh`, which needs no router support | `nslookup nas <router-ip>` answers, or `ping nas.local` | Off |
| **ASK** Router as DNS forwarder, upstream one provider's pair | Fast, consistent answers; the router still adds local names | WAN/Internet → DNS: manual. Pick one pair and do not mix providers or filtered with unfiltered: Quad9 `9.9.9.9` + `149.112.112.112` (blocks known-malicious domains), or Cloudflare `1.1.1.1` + `1.0.0.1` (unfiltered; `1.1.1.2` + `1.0.0.2` for malware blocking). LAN → DHCP: DNS server = router IP (or the Pi-hole if one exists) | `nslookup example.com` from a client shows the router as server and answers quickly | Automatic (ISP) |
| **ASK** IPv6: properly on or fully off | Half-on IPv6 causes slow first connects | WAN → IPv6: native/DHCPv6-PD if the ISP supports it, else disable. LAN → IPv6: match | https://test-ipv6.com scores 10/10 or reports "no IPv6", never "broken" | Previous setting |
| No port forwards unless used | Every forward is an open door | Advanced → Port forwarding: delete unknown entries. Keep a list of the ones kept and why | Table matches the list | Re-add |
| SIP ALG **off** | Breaks VoIP phones and some video calls | Advanced → NAT passthrough / ALG | Calls stop dropping | On |
| Hardware NAT / flow acceleration **on**; QoS **off** on a gigabit line | Smart queues disable NAT acceleration and cap throughput at a few hundred Mb/s | Advanced → QoS: off; NAT acceleration: on. Exception, a line under ~300 Mb/s where calls stutter when someone uploads (bufferbloat): turn on the router's smart queue and accept the cap: eero "Optimize for Conferencing and Gaming", ASUS Adaptive QoS (Cake on Merlin firmware), UniFi Smart Queues | Speed test at the line rate; for the exception, waveform.com/tools/bufferbloat grades A or B | Reverse |
| MTU auto (1500; PPPoE 1492) | Wrong MTU shows as some sites hanging | WAN → MTU | Don't-fragment ping of 1472 bytes passes (payload + 28 = MTU; use 1464 on PPPoE): Linux `ping -M do -s 1472 1.1.1.1`, macOS `ping -D -s 1472 1.1.1.1`, Windows `ping -f -l 1472 1.1.1.1` | Auto |

## 3. Wi-Fi (ASK for the security change)

| Item | Why | Do | Verify | Undo |
|---|---|---|---|---|
| **ASK** WPA3-Personal, or WPA2/WPA3 transition mode if an old device refuses WPA3. Never WEP or TKIP | WEP and TKIP are broken; WPA3 is the current standard and 6 GHz is WPA3-only by rule | Wireless → Security. Usual WPA3 refusers: old printers, older IoT, pre-2019 Intel Wi-Fi drivers; keep transition mode (or the "Compatibility Mode" some routers offer) while any is in use | Every device rejoins; a device that cannot is the reason to stay in transition mode | Previous mode |
| 2.4 GHz: channel 1, 6 or 11, width 20 MHz | Auto often picks overlapping channels; 40 MHz on 2.4 GHz hurts neighbours and itself | Wireless → 2.4 GHz | Analyser app shows the least-used of the three | Auto |
| 5 GHz: 80 MHz, a non-DFS channel (36–48 or 149–165 in the US) | DFS channels (52–144) must listen for radar for 60 s before use (10 min on 120–128) and vacate for 30 min when they hear any: unexplained drops. 160 MHz on 5 GHz always takes in DFS channels | Wireless → 5 GHz: channel 36 or 149, width 80 MHz | No unexplained 1-minute outages | Auto |
| 6 GHz (Wi-Fi 6E/7): on if the router and the laptops support it | Empty band, no DFS, wide channels | Same SSID and password as 5 GHz, WPA3, a PSC channel (5, 21, 37, 53, 69, 85, 101, 117, 133, 149, 165, 181, 197, 213, 229), 160 MHz. Wi-Fi 7 MLO on only if every client behaves | 6E clients show a 6 GHz link | Off |
| 802.11k/v on (802.11r optional) | Tells phones and laptops when and where to roam, so they leave the far AP promptly | Wireless → Professional/Advanced (ASUS bundles part of this as "Roaming Assistant"). Turn 802.11r off if one old device keeps dropping | Walking between APs, a phone switches within seconds | Off |
| Transmit power: lower on APs that are close together | "Sticky client" problem: devices hold the far, strong AP | Wireless → Professional/Advanced: 50–75% on the near AP | Phones roam within a few seconds when walking between APs | 100% |
| Band steering / Smart Connect: keep only if roaming behaves | Some clients flap between bands | If devices drop, split into `Kapoor-2G` and `Kapoor-5G` | Devices stay put | Merge again |
| Guest / IoT SSID with client isolation, no LAN access | Keeps cameras, TVs, visitors off the machines and the NAS | Wireless → Guest network | A guest device cannot ping the NAS | Off |
| Client / AP isolation **off** on the main SSID | Isolation on the main SSID is why the NAS "vanishes" from Wi-Fi laptops | Wireless → Advanced | Wi-Fi laptop can ping a wired PC | On |
| Every separate router-class box (old router, standalone extender) in **AP mode** | Otherwise it NATs and hands out its own IPs. Satellites of the same mesh system already bridge to their primary; leave them alone | Its own admin page → Operation mode: Access Point (bridge). Wire the backhaul where possible | netscan sees a single gateway | Router mode |

## 4. Firmware (last)

0. Is the model still supported? Look up its end-of-life status on the vendor's support page. An EOL router gets no security fixes and is a known hijack target (FBI warning, May 2025): replace it instead of tuning it. If it is supported, turn on automatic firmware updates where the router offers them.
1. Backup config (again). Note the current version.
2. Administration → Firmware update → check. Read the release notes for "factory reset required".
3. Update at a quiet time. Do not power-cycle while it flashes.
4. After reboot: netscan from two machines, `verify.sh`, NAS mount from one PC. If reservations vanished, restore the backup.

## Optional

- Encrypted upstream DNS, if the router supports it: ASUS "DNS Privacy Protocol" (DNS-over-TLS), UniFi "Encrypted DNS" (DNS-over-HTTPS), eero and Google/Nest through their apps. Same provider pair as above.
- Where the config backup lives: ASUS Administration → Restore/Save/Upload Setting; Netgear Advanced → Administration → Backup Settings; TP-Link System Tools → Backup & Restore; UniFi Settings → System → Backups; eero and Google/Nest have no file backup, so screenshot each settings page instead.

## 5. Record

Paste into `status.md` → Router: make/model, firmware before → after, every ASK item with the decision, and the reservation table (name → MAC → IP).
