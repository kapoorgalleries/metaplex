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
| Remote management / WAN access **off** | The admin page must not face the internet | Administration → Remote Management: disable. Also "cloud" management unless you use it | From a phone on mobile data, `https://<public-ip>` must time out | Re-enable |
| UPnP **off** unless something needs it | UPnP lets any LAN device open ports on the router | Advanced → UPnP: disable. List what stops working (game consoles, some VoIP) | Router's UPnP table is empty after a day | Re-enable |
| WPS **off** | WPS PIN is brute-forceable | Wireless → WPS: disable | The WPS light is off | Re-enable |
| NTP set, correct time zone | Logs and cert checks depend on it | Administration → Time | Time on the status page is right | n/a |
| Logging on, log level "warning" or above | Needed to see DHCP conflicts and drops | Administration → Log | Log page shows entries | Off |

## 2. Addressing (ASK before each)

| Item | Why | Do | Verify | Undo |
|---|---|---|---|---|
| **ASK** One subnet, /24 | Two subnets is the root of most "cannot see each other" complaints | LAN → IP: `192.168.1.1/24` (or keep the existing one if it is already a single /24) | netscan from two machines shows the same subnet and gateway | Restore the backup |
| **ASK** DHCP pool `.100`–`.199`, lease 24 h | Leaves `.2`–`.99` for reservations, `.200`+ for future statics | LAN → DHCP | New devices land in the pool | Old range |
| DHCP reservations for every `inventory.csv` row | IPs stop moving; SSH config and NAS mounts stay valid | LAN → DHCP → Address reservation: MAC from netscan → chosen IP (`.10`–`.99`) | `ipconfig /renew` or reconnect; netscan shows the reserved IPs | Delete the reservation |
| Local hostnames in DNS | `ping nas`, `ssh studio-mac` work without editing hosts files | LAN → DHCP/DNS: "register client names" / "local DNS" on. Set a hostname on each reservation | `nslookup nas <router-ip>` answers | Off |
| **ASK** Router as DNS resolver, upstream `1.1.1.1` + `9.9.9.9` | Fast, filtered upstream; still resolves local names | WAN/Internet → DNS: manual upstream; LAN → DHCP: DNS server = router IP (or the Pi-hole IP if one exists) | `nslookup example.com` from a client shows the router as server and answers quickly | Automatic (ISP) |
| **ASK** IPv6: properly on or fully off | Half-on IPv6 causes slow first connects | WAN → IPv6: native/DHCPv6-PD if the ISP supports it, else disable. LAN → IPv6: match | https://test-ipv6.com scores 10/10 or reports "no IPv6", never "broken" | Previous setting |
| No port forwards unless used | Every forward is an open door | Advanced → Port forwarding: delete unknown entries. Keep a list of the ones kept and why | Table matches the list | Re-add |
| SIP ALG **off** | Breaks VoIP phones and some video calls | Advanced → NAT passthrough / ALG | Calls stop dropping | On |
| Hardware NAT / flow acceleration **on**; QoS **off** | QoS on consumer routers caps throughput | Advanced → QoS: off unless VoIP needs priority; NAT acceleration: on | Speed test at the router's rated line rate | Reverse |
| MTU auto (1500; PPPoE 1492) | Wrong MTU shows as some sites hanging | WAN → MTU | `ping -M do -s 1472 1.1.1.1` (Linux) passes | Auto |

## 3. Wi-Fi (ASK for the security change)

| Item | Why | Do | Verify | Undo |
|---|---|---|---|---|
| **ASK** WPA2-AES (or WPA3/WPA2 mixed). No WEP, no TKIP | TKIP caps speed at 54 Mb/s and is broken | Wireless → Security | Old devices still join; if one cannot, keep WPA2/WPA3 mixed | Previous mode |
| 2.4 GHz: channel 1, 6 or 11, width 20 MHz | Auto often picks overlapping channels; 40 MHz on 2.4 GHz hurts neighbours and itself | Wireless → 2.4 GHz | Analyser app shows the least-used of the three | Auto |
| 5 GHz: 80 MHz, a non-DFS channel (36–48, 149–165 in the US) | DFS channels vacate when radar is heard: 1 min drops | Wireless → 5 GHz | No unexplained 1-minute outages | Auto |
| Transmit power: lower on APs that are close together | "Sticky client" problem: devices hold the far, strong AP | Wireless → Professional/Advanced: 50–75% on the near AP | Phones roam within a few seconds when walking between APs | 100% |
| Band steering / Smart Connect: keep only if roaming behaves | Some clients flap between bands | If devices drop, split into `Kapoor-2G` and `Kapoor-5G` | Devices stay put | Merge again |
| Guest / IoT SSID with client isolation, no LAN access | Keeps cameras, TVs, visitors off the machines and the NAS | Wireless → Guest network | A guest device cannot ping the NAS | Off |
| Client / AP isolation **off** on the main SSID | Isolation on the main SSID is why the NAS "vanishes" from Wi-Fi laptops | Wireless → Advanced | Wi-Fi laptop can ping a wired PC | On |
| Every satellite / extender / old router in **AP mode** | Otherwise it NATs and hands out its own IPs | Its own admin page → Operation mode: Access Point (bridge) | netscan sees a single gateway | Router mode |

## 4. Firmware (last)

1. Backup config (again). Note the current version.
2. Administration → Firmware update → check. Read the release notes for "factory reset required".
3. Update at a quiet time. Do not power-cycle while it flashes.
4. After reboot: netscan from two machines, `verify.sh`, NAS mount from one PC. If reservations vanished, restore the backup.

## 5. Record

Paste into `status.md` → Router: make/model, firmware before → after, every ASK item with the decision, and the reservation table (name → MAC → IP).
