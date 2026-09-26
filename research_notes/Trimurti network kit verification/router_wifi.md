# Router and Wi-Fi tuning: kit vs. current best practice (as of 2026-09-22, US/FCC)

Scope: `ops/network/checklists/router-tuning.md`, `ops/network/checklists/network-triage.md`, and the double-NAT + link-speed checks in `ops/network/scripts/netscan.sh`.

**Method note (read first).** Every direct fetch of a government or vendor page (cisa.gov, nsa.gov/media.defense.gov, consumer.ftc.gov, ncsc.gov.uk, support.apple.com, asus.com, kb.netgear.com, tp-link.com, help.ui.com, support.eero.com, quad9.net, developers.cloudflare.com, developers.google.com, rfc-editor.org, test-ipv6.com, ripe.net, nmap.org, openwrt.org, bufferbloat.net, wi-fi.org, docs.fcc.gov, learn.microsoft.com, support.plex.tv) was refused by this session's egress policy (403 on CONNECT). Only GitHub was reachable. So:
- "Source says" quotes below are taken from search-engine result snippets/summaries of those pages, not from the pages themselves. They are labelled **[snippet]**. Treat them as accurate to the gist, not guaranteed verbatim.
- The one item verified against primary source text is the nmap `broadcast-dhcp-discover` script (read from the nmap GitHub repository).
- Source class is tagged: **[Gov]**, **[Vendor]**, **[Standards]**, **[Secondary]** (press, forums, blogs). Where only secondary sources were found, it says so.
- Items I could not confirm at all are in each section's *Gaps*, not asserted.

Verdict legend used per item: **OK** (keep as is), **TWEAK** (keep, add the wording given), **FIX** (kit text is wrong or misleading; replace with the wording given), **ADD** (kit omits it).

---

## KQ1. Security hygiene (remote management, UPnP, WPS, admin password, firmware, logging, NTP)

### Takeaway
The kit's hygiene section matches FTC, CISA and NSA guidance item for item (remote management off, UPnP off, WPS off, unique admin password, firmware updates). Three things to add: an end-of-support check with replacement of EOL routers (FBI/NSA), a concrete "what breaks without UPnP" list (consoles' NAT type, Plex remote access, some IoT remote-viewing) with the manual-port-forward replacement, and the NSA's weekly-reboot/segmentation items. Logging and NTP had no government-source wording in my results; they are reasonable ops hygiene but unsourced.

### Cited Findings

**1.1 Admin password unique and long**
- Kit says: "Admin password is unique and long — Default or reused passwords are the first thing tried from inside the LAN — Change it; store it in the password manager."
- FTC [Gov][snippet]: "Change your router's default settings, including the default administrative username, password, and network name to something unique. Don't use login names or passwords with your name, address, or router brand." — [FTC: How To Secure Your Home Wi-Fi Network](https://consumer.ftc.gov/articles/how-secure-your-home-wi-fi-network)
- FBI 2025 flash coverage [Secondary, reporting Gov]: FBI "urging consumers and businesses to replace unsupported routers with newer models, disable remote access features, install all security patches and use strong, special passwords." — [GovTech on FBI advisory](https://www.govtech.com/security/outdated-internet-routers-a-cybersecurity-risk-fbi-says)
- Verdict: **OK**. Optional TWEAK: add "also change the default SSID" (NSA: "change the default SSID to something unique" — [NSA press release](https://www.nsa.gov/Press-Room/Press-Releases-Statements/Press-Release-View/Article/3304674/nsa-releases-best-practices-for-securing-your-home-network/) [Gov][snippet]).

**1.2 Remote management / WAN access off**
- Kit says: "Remote management / WAN access **off** — The admin page must not face the internet — Administration → Remote Management: disable. Also 'cloud' management unless you use it — Verify: From a phone on mobile data, `https://<public-ip>` must time out."
- CISA [Gov][snippet]: "disabling remote management because most routers offer the option to view and modify their settings over the internet, and turning this feature off guards against unauthorized individuals accessing and changing your router's configuration." — [CISA Home Network Security](https://www.cisa.gov/news-events/news/home-network-security)
- FTC [Gov][snippet]: "Turn off 'remote management,' Wi-Fi Protected Setup (WPS), and Universal Plug and Play (UPnP) features." — [FTC](https://consumer.ftc.gov/articles/how-secure-your-home-wi-fi-network)
- NSA CSI Feb 2023 [Gov][snippet]: "limiting administration to internal network only by disabling the ability to make remote changes from the router and disabling Universal Plug-n-Play (UPnP)." — [NSA CSI summary via CSIAC](https://csiac.dtic.mil/articles/nsa-releases-best-practices-for-securing-your-home-network/); primary PDF: [NSA CSI PDF](https://media.defense.gov/2023/Feb/22/2003165170/-1/-1/0/CSI_BEST_PRACTICES_FOR_SECURING_YOUR_HOME_NETWORK.PDF)
- Verdict: **TWEAK**. The "cloud management" clause is not achievable on app-managed systems (eero, Google Nest Wifi) which are cloud-managed by design; eero's advanced features are all set in the app ([eero: What advanced features does eero support?](https://support.eero.com/hc/en-us/articles/207613326-What-advanced-features-does-eero-support) [Vendor]). Suggested text: "Administration → Remote Management (a.k.a. 'Web Access from WAN', 'Remote Access'): disable. Vendor cloud apps (ASUS Router app, Netgear Nighthawk app, TP-Link Tether) can stay if used; eero / Google Nest are cloud-managed only and have no WAN admin page to disable."

**1.3 UPnP off**
- Kit says: "UPnP **off** unless something needs it — UPnP lets any LAN device open ports on the router — List what stops working (game consoles, some VoIP) — Verify: Router's UPnP table is empty after a day."
- CISA [Gov][snippet]: "disable UPnP unless you have a specific need for it. While UPnP allows you to easily connect smart devices to your Wi-Fi network, threat actors can use UPnP to spread malware to devices in your network and control them remotely. In some cases, you may need to enable UPnP to initially add your device to the network, but you should disable UPnP after doing so." — [CISA](https://www.cisa.gov/news-events/news/home-network-security)
- What breaks — Plex [Vendor][snippet]: "The server will attempt to automatically configure a connection through your router using UPnP or NAT-PMP first"; manual port forward is the alternative. — [Plex: Remote Access](https://support.plex.tv/articles/200289506-remote-access/)
- What breaks — consoles [Secondary][snippet]: "When UPnP is disabled or unavailable, players often see error messages like 'NAT (Network Address Translation) Type: Strict' or 'UPnP Not Successful'"; "UPnP is the simplest method for achieving an Open Network Address Translation (NAT) type on your Xbox". — [Yahoo Tech](https://tech.yahoo.com/cybersecurity/articles/upnp-xbox-enabled-221500215.html)
- What breaks — IoT remote viewing [Vendor blog][snippet]: "disabling UPnP can break remote access to these devices, meaning you may not be able to check your camera feed or adjust your thermostat when you are away from home." — [TP-Link blog: What is UPnP](https://www.tp-link.com/us/blog/2531/what-is-upnp-and-should-you-enable-it-on-your-router-/)
- Verdict: **TWEAK**. Replace the "List what stops working" cell with: "Expect: Xbox/PlayStation report NAT type Moderate/Strict; Plex Remote Access falls back to 'not available' (fix: manual forward TCP 32400 to the Plex host); some cameras/thermostats lose app access from outside; some VoIP ATAs. Replace each with a manual port forward or leave off." (Plex's port 32400 is general knowledge; the Plex page cited says manual forwarding is supported but the snippet did not show the port number — see Gaps.)

**1.4 WPS off**
- Kit says: "WPS **off** — WPS PIN is brute-forceable."
- CISA [Gov][snippet]: "disabling Wi-Fi Protected Setup (WPS) because this setting increases the likelihood that a threat actor could gain unauthorized access to your Wi-Fi network. WPS's PIN-based pairing method has a well-documented brute-force flaw — its 8-digit PIN can be cracked in hours because of how the protocol validates the PIN in two halves." — [CISA](https://www.cisa.gov/news-events/news/home-network-security); FTC same — [FTC](https://consumer.ftc.gov/articles/how-secure-your-home-wi-fi-network)
- Verdict: **OK**.

**1.5 Firmware (kit section 4, "last")**
- Kit says: "**Firmware last**, at a quiet time, with the backup in hand" and the four-step procedure.
- FTC [Gov][snippet]: "If your router doesn't have WPA2 or WPA3 options, try updating your router software, and if those options still aren't available, consider getting a new router." — [FTC](https://consumer.ftc.gov/articles/how-secure-your-home-wi-fi-network)
- NSA [Gov][snippet]: "securing routing devices and keeping those up to date"; "schedule weekly reboots of your routing device, smartphones, and computers. Regular reboots help to remove implants". — [NSA press release](https://www.nsa.gov/Press-Room/Press-Releases-Statements/Press-Release-View/Article/3304674/nsa-releases-best-practices-for-securing-your-home-network/)
- FBI, May 7 2025 flash (as reported) [Secondary reporting Gov][snippet]: "Routers dated 2010 or earlier likely no longer receive software updates issued by the manufacturer and could be compromised by cyber actors exploiting known vulnerabilities"; models named include Linksys E1200, E2500, E1000, E4200, E1500, E300, E3200, WRT320N, E1550, WRT610N, E100, Cisco M10, WRT310N; malware "TheMoon". — [GovTech](https://www.govtech.com/security/outdated-internet-routers-a-cybersecurity-risk-fbi-says); [Cybernews](https://cybernews.com/security/fbi-urges-replacing-old-linksys-other-routers/)
- NCSC (UK) Small Business Guide [Gov][snippet]: "Schedule regular manual checks on updates"; separate NCSC advisory on edge routers notes "hostile actors accessing network devices using legitimate Simple Network Management Protocol (SNMP) credentials". — [NCSC Small Business Guide](https://www.ncsc.gov.uk/collection/small-business-guide); [NCSC edge router advisory](https://www.ncsc.gov.uk/information/uk-internet-edge-router-devices-advisory)
- Verdict: **ADD** two steps to section 4: "0. Check the model's end-of-support status on the vendor's EOL page. If it is EOL (no firmware since ~2 years, or vendor lists it as end-of-life), plan replacement rather than tuning; the FBI's May 2025 flash names Linksys E-series/WRT-series and Cisco M10 as actively exploited." and "5. Turn on automatic firmware updates if the router offers them (ASUS: Administration → Firmware Upgrade → Auto Firmware Upgrade; Netgear/TP-Link/eero/Google: on by default)." Also ADD to section 1: "Disable SNMP if present (NCSC)." Ordering ("firmware last") is the kit's own operational choice; no source prescribes an order.

**1.6 Logging on, NTP set**
- Kit says: "NTP set, correct time zone — Logs and cert checks depend on it"; "Logging on, log level 'warning' or above".
- No government or vendor wording found in results (see Gaps). Verdict: **OK** as ops hygiene; unsourced.

**1.7 Items the kit's hygiene section omits (ADD)**
- Weekly reboot (NSA, above). Suggested row: "Scheduled reboot weekly (Administration → Reboot schedule, where offered) — NSA: helps clear non-persistent implants."
- Segmentation (NSA) [Gov][snippet]: "separate your private WLAN, guest WLAN and IoT network to prevent direct communication between potentially insecure devices." — [Ikarus summary of NSA CSI](https://www.ikarussecurity.com/en/security-news-en/nsa-guide-to-secure-home-networks/) [Secondary summarising Gov]. The kit already has this in the Wi-Fi section (guest/IoT SSID); no change needed beyond a cross-reference.

### Inferences
- The kit's "Verify" for remote management (phone on mobile data to `https://<public-ip>`) is valid only when not behind CGNAT; behind CGNAT the public IP is shared and the test is meaningless (see KQ4).
- "Firmware last" is defensible because a firmware update can reset settings; the kit already tells the operator to re-check reservations afterward.

### Gaps
- I could not fetch the NSA CSI PDF or CISA page to give verbatim wording; the quotes above are snippet-level.
- No authoritative source found for router log levels or NTP as a checklist item.
- Plex's manual port (32400) was not in the snippet; it is in the Plex Remote Access article (blocked from fetch).
- NCSC guidance is generic (patching, passwords, firewall); it does not enumerate router features like UPnP/WPS.

---

## KQ2. Addressing: DHCP, reservations, local hostnames, DNS upstreams, IPv6, MTU, SIP ALG, QoS/NAT acceleration

### Takeaway
Reservations/pool/lease and IPv6/MTU items are sound. Two real fixes: (a) the DNS row calls `1.1.1.1 + 9.9.9.9` a "filtered upstream" — 1.1.1.1 is unfiltered and mixing a filtering resolver with a non-filtering one gives inconsistent results (Quad9 explicitly says not to mix); use one provider's pair (9.9.9.9/149.112.112.112 or 1.1.1.2/1.0.0.2). (b) "Local hostnames in DNS" is not a feature on Netgear, TP-Link Archer, eero or Google Nest; only ASUS, UniFi and Synology SRM do it, each under a different name; the fallback is mDNS `.local` and the kit's own `ssh-config-gen.sh`. QoS needs nuance (KQ5).

### Cited Findings

**2.1 One /24 subnet; DHCP pool `.100`–`.199`, lease 24 h; reservations for every inventory row**
- Kit says: "**ASK** One subnet, /24"; "**ASK** DHCP pool `.100`–`.199`, lease 24 h — Leaves `.2`–`.99` for reservations, `.200`+ for future statics"; "DHCP reservations for every `inventory.csv` row — IPs stop moving".
- Lease time [Secondary][snippet]: "For a home network, the default 24 hours (1440 minutes or 86400 seconds) is fine. Many consumer routers default to 24 hours"; "For guest networks and hotspots, you want a short lease time. Hotspots an hour max, while for Office guest networks 8 hours will work fine." — [LazyAdmin: DHCP lease time](https://lazyadmin.nl/home-network/dhcp-lease-time/); [RouterHax](https://routerhax.com/dhcp-lease-time-explained/)
- Reservation mechanics, Netgear [Vendor][snippet]: "ADVANCED > Setup > LAN Setup. In the Address Reservation section click Add"; "The address you reserved is not assigned to your computer until the next time the computer contacts the router's DHCP server. To assign the reserved address, reboot the computer, or access its IP configuration to force a DHCP release and renew." — [Netgear KB 25722](https://kb.netgear.com/25722/How-do-I-reserve-an-IP-address-on-my-NETGEAR-router)
- TP-Link [Vendor][snippet]: "Advanced > Network > DHCP Server > Address Reservation ... the PC will always receive the same IP address each time it connects to the DHCP server." — [TP-Link FAQ 182](https://www.tp-link.com/us/support/faq/182/)
- ASUS [Vendor]: feature is "Manually Assigned IP around the DHCP list" under LAN → DHCP Server ("Enable Manual Assignment"). — [ASUS FAQ 1000906](https://www.asus.com/us/support/faq/1000906/); [ASUS FAQ 1011703 DHCP server](https://www.asus.com/support/faq/1011703/)
- eero [Vendor][snippet]: "eero supports IP reservations and port forwarding rules" (app: Network settings → Reservations & port forwarding). — [eero advanced features](https://support.eero.com/hc/en-us/articles/207613326-What-advanced-features-does-eero-support)
- Google Nest Wifi [Vendor][snippet]: "open the Google Home app, tap Home → Wifi → Network settings → Advanced Networking, tap DHCP IP reservations → Add IP reservations". — [Google Nest Help 6274660](https://support.google.com/googlenest/answer/6274660)
- Synology SRM [Vendor][snippet]: "Network Center > Local Network > DHCP Reservation, where you can specify a client's MAC address, hostname, and the IP address". — [Synology SRM help](https://kb.synology.com/en-nz/SRM/help/SRM/NetworkCenter/lan_network_dhcp?version=1_3)
- Verdict: **OK**. TWEAK the Verify cell: "`ipconfig /release && ipconfig /renew` (Windows) / reconnect Wi-Fi (Mac) — the reservation only takes effect at the next DHCP request (Netgear KB)." ADD a per-vendor name list (see 2.2 table) so the operator can find the menu.

**2.2 Local hostnames in DNS**
- Kit says: "Local hostnames in DNS — `ping nas`, `ssh studio-mac` work without editing hosts files — LAN → DHCP/DNS: 'register client names' / 'local DNS' on. Set a hostname on each reservation — Verify: `nslookup nas <router-ip>` answers." Triage: "Enable 'DHCP client names in DNS' / local DNS on the router".
- ASUS [Secondary describing vendor behaviour][snippet]: "The router's dnsmasq can resolve local hostnames (e.g., printer.mylan, where mylan is the Domain Name set previously)"; "By default, the router advertises its own LAN IP as the DNS server if 'Advertise router's IP in addition to user-specified DNS' is enabled ... disabling this option may prevent local hostname resolution"; "using DHCP reservations on the router ensures hostname resolution works, since the client will still make a DHCP request and dnsmasq will give it the same IP each time." — [Vaughan Hilts](https://vaughanhilts.me/2020/04/20/how-does-my-router-resolve-hostnames-on-my-local-network.html); [Unfinished Bitness](https://unfinishedbitness.info/2015/05/26/asuswrt-finalized-setup/)
- UniFi [Vendor][snippet]: feature "UniFi DNS Records and Local Hostnames": "assign a simple local hostname to a known client device ... directly from the Client Devices page, which is essentially a shortcut for creating a Host (A) record"; "These hostnames are stored in the Gateway's DNS cache and only resolve for clients using the Gateway as their DNS server"; "you need to have a default domain configured in Settings > Networks, edit LAN ... set something in the Domain Name field"; "The DHCP client-provided client-hostname is what's registered as its hostname in DNS. For this to work, you need to be using the gateway for your DHCP server." — [Ubiquiti Help: UniFi DNS Records and Local Hostnames](https://help.ui.com/hc/en-us/articles/15179064940439-UniFi-DNS-Records-and-Local-Hostnames); "New in UniFi Network 8.2 is the option to add local DNS entries" — [LazyAdmin](https://lazyadmin.nl/home-network/unifi-local-and-server-dns-settings/) [Secondary]
- Netgear consumer routers [Secondary: vendor community][snippet]: "When a DNS query occurs, a Netgear router will forward the query to a real DNS server rather than resolving local hostnames directly"; "Many users have requested the ability to enable resolution of local device hostnames" — [Netgear Community: Local DNS resolution](https://community.netgear.com/t5/Nighthawk-Pro-Gaming-DumaOS-3-0/Local-DNS-resolution/td-p/2031207); [Can't resolve hostnames with R7800](https://community.netgear.com/t5/Nighthawk-Wi-Fi-5-AC-Routers/Can-t-resolve-hostnames-with-R7800/td-p/1045166)
- TP-Link Archer [Secondary: vendor community][snippet]: "the Archer AX10 doesn't support resolving the local hostnames of the client devices, and the DNS does not resolve locally connected device names. There is no option to make it as a DNS and assign names for the connected device". — [TP-Link Community topic 500282](https://community.tp-link.com/en/home/forum/topic/500282)
- eero [Vendor][snippet]: only "Local DNS caching" exists ("speeds up page loads by storing website address information at the network level"; "not available on eero networks that are in bridge mode or have eero Plus features active"); no local hostname records feature appears in eero's advanced-features list. — [eero: What is Local DNS caching?](https://support.eero.com/hc/en-us/articles/46052784608667-What-is-Local-DNS-caching); [eero advanced features](https://support.eero.com/hc/en-us/articles/207613326-What-advanced-features-does-eero-support)
- Google Nest Wifi: no local-hostname feature surfaced in results (Gap).
- Synology SRM [Secondary][snippet]: "Synology SRM uses dnsmasq for both DHCP and DNS, meaning that host names are implicitly registered in DNS whenever they request a DHCP lease. However, after installing the DNS server, SRM uses named (BIND) ... host names are not implicitly registered". — [Roger's Blog](https://blog.differentpla.net/blog/2021/12/19/srm-dns/)
- Verdict: **FIX**. Replace the Do cell with a vendor table:
  - ASUS: automatic (dnsmasq). LAN → DHCP Server: set "Domain Name" (e.g. `lan`), keep "Advertise router's IP in addition to user-specified DNS" = Yes, and give each Manual Assignment a Host Name. Names resolve as `nas` and `nas.lan`.
  - Ubiquiti UniFi: Settings → Networks → LAN → Domain Name (required); gateway must be DHCP and DNS. Per-client hostname on the Client Devices page, or Settings → Routing → DNS → Local DNS Records (Network 8.2+).
  - Synology SRM: Network Center → Local Network → DHCP Reservation has a Hostname field; automatic while the DNS Server package is *not* installed.
  - Netgear (Nighthawk/Orbi), TP-Link Archer/Deco, eero, Google Nest Wifi: **no local hostname resolution**. Use mDNS (`nas.local`, works for Mac/Linux/Synology/QNAP and Windows 10+), and run `ssh-config-gen.sh` so `ssh nas` works regardless.
  - Verify: `nslookup nas <router-ip>` and `nslookup nas.<domain> <router-ip>`; if both fail on a vendor listed as unsupported, that is expected — try `ping nas.local`.

**2.3 Router as DNS resolver, upstream `1.1.1.1` + `9.9.9.9`**
- Kit says: "**ASK** Router as DNS resolver, upstream `1.1.1.1` + `9.9.9.9` — Fast, filtered upstream; still resolves local names".
- Cloudflare [Vendor][snippet]: "1.1.1.1 for Families has two default options: one that blocks malware and the other that blocks malware and adult content ... For malware blocking only use Primary DNS: 1.1.1.2 and Secondary DNS: 1.0.0.2. For malware and adult content use Primary DNS: 1.1.1.3 and Secondary DNS: 1.0.0.3"; "When a queried domain is classified as malicious, Cloudflare returns the address 0.0.0.0". — [Cloudflare docs: Set up 1.1.1.1](https://developers.cloudflare.com/1.1.1.1/setup/); [Cloudflare blog: Introducing 1.1.1.1 for Families](https://blog.cloudflare.com/introducing-1-1-1-1-for-families/). Plain 1.1.1.1: "Cloudflare's default resolver does not filter anything, so blocking is opt-in through separate addresses." — [Security Boulevard comparison](https://securityboulevard.com/2026/07/quad9-vs-cloudflare-which-dns-resolver-is-more-secure-and-private/) [Secondary]
- Quad9 [Vendor][snippet]: "The primary Quad9 addresses [9.9.9.9 and 149.112.112.112] provide a domain blocklist from 19 different malware/threat providers and DNSSEC validation"; 9.9.9.10 / 149.112.112.10 = "no blocklist" (unsecured); "You should use only one set of addresses – secure or unsecured – as mixing them in your configuration may lead to your system being exposed without the security enhancements"; "DNSSEC validation is enabled on all resolver addresses as of June 15, 2026." — [Quad9 service addresses](https://quad9.net/service/service-addresses-and-features/); [Quad9 blog: DNSSEC on all endpoints](https://quad9.net/news/blog/quad9-enables-dnssec-on-all-service-endpoints/)
- Google [Vendor page; Secondary snippet]: "Google Public DNS (8.8.8.8) ... does no content filtering of any kind." — [5Gstore comparison](https://5gstore.com/blog/2026/09/17/public-dns-providers-speed-security-compared/); official: [Google Public DNS: using](https://developers.google.com/speed/public-dns/docs/using)
- Verdict: **FIX**. New row text: "**ASK** Router forwards DNS to one provider's pair. Filtered (blocks known-malware domains): Quad9 `9.9.9.9` + `149.112.112.112` (DNSSEC-validating) or Cloudflare `1.1.1.2` + `1.0.0.2`. Unfiltered: `1.1.1.1` + `1.0.0.1`, or Google `8.8.8.8` + `8.8.4.4`. Do not mix a filtering and a non-filtering provider as primary/secondary: routers alternate between them, so blocking becomes random (Quad9's own warning). If a Pi-hole exists, LAN DHCP → DNS = Pi-hole, and the Pi-hole forwards upstream. Verify: `nslookup example.com` from a client shows the router (or Pi-hole) as server; `nslookup -type=txt whoami.cloudflare 1.1.1.1`-style checks are optional." Terminology: the router is a forwarder/cache, not a recursive resolver — say "DNS forwarder".

**2.4 IPv6: properly on or fully off; test-ipv6.com**
- Kit says: "**ASK** IPv6: properly on or fully off — Half-on IPv6 causes slow first connects — WAN → IPv6: native/DHCPv6-PD if the ISP supports it, else disable — Verify: https://test-ipv6.com scores 10/10 or reports 'no IPv6', never 'broken'." Triage: "Some sites hang for seconds, then load — Half-configured IPv6".
- test-ipv6 / RIPE-631 [Standards body doc][snippet]: "When test-ipv6.com reports 'broken IPv6,' it means IPv6 network connectivity somewhere between the user and the website is broken. IPv6 connections are timing out instead of succeeding (or failing fast to IPv4)"; "'slow' ... means connections to the test-ipv6.com site that should have been fast took over five seconds"; "IPv6 MTU issues are typically caused by ICMPv6 filtering, where small requests were fast but large requests were slow (and/or timed out)"; helpdesk code "112 for 'IPv4 plus broken IPv6'". — [RIPE-631: IPv6 Troubleshooting for Residential ISP Helpdesks](https://www.ripe.net/publications/docs/ripe-631/); [test-ipv6.com/broken.html](https://test-ipv6.com/broken.html)
- Verdict: **OK**. TWEAK Verify: "Note the helpdesk code on the result page (e.g. 112 = IPv4 plus broken IPv6). 'Slow' with a working small-packet test usually means the router or firewall is dropping ICMPv6 (PMTU) — do not filter ICMPv6."

**2.5 MTU auto (1500; PPPoE 1492) and the DF ping test**
- Kit says: "MTU auto (1500; PPPoE 1492) — Wrong MTU shows as some sites hanging — Verify: `ping -M do -s 1472 1.1.1.1` (Linux) passes".
- TP-Link [Vendor][snippet]: "For PPPoE, your Max MTU should be no more than 1492 to allow space for the 8 byte PPPoE 'wrapper'"; Windows test uses `ping -f -l <size>` starting at 1472 and "add 28 bytes (20 for the IP header and 8 for the ICMP header) to get your optimal MTU". — [TP-Link FAQ 190](https://www.tp-link.com/us/support/faq/190/)
- macOS [Secondary][snippet]: "`ping -D -s 1472 google.com`. -D is the 'Don't Fragment' flag (equivalent to `-f` in Windows)". — [andrewbaker.ninja](https://andrewbaker.ninja/2023/05/24/how-to-find-and-set-the-optimal-mtu-on-mac-macos/); Windows `ping /f /l 1472` — [OneUptime MTU test](https://oneuptime.com/blog/post/2026-03-20-test-mtu-ping-df-flag/view) [Secondary]
- Verdict: **TWEAK**. Verify cell: "Linux `ping -M do -s 1472 1.1.1.1`; macOS `ping -D -s 1472 1.1.1.1`; Windows `ping -f -l 1472 1.1.1.1`. On PPPoE test 1464 (1492 − 28). If it says 'needs to be fragmented', lower by 8 until it passes and set MTU = size + 28."

**2.6 SIP ALG off**
- Kit says: "SIP ALG **off** — Breaks VoIP phones and some video calls — Advanced → NAT passthrough / ALG — Verify: Calls stop dropping".
- Netgear [Vendor][snippet]: "By default NETGEAR routers have SIP ALG turned ON. To disable it ... ADVANCED, then Setup, then WAN Setup, select the option to Disable SIP ALG". — [Netgear KB 30796](https://kb.netgear.com/30796/How-do-I-disable-SIP-ALG-on-my-NETGEAR-device-using-the-router-web-interface)
- Symptoms [Secondary][snippet]: "one-way audio, phones that randomly lose registration, failed call transfers, and calls that connect but have no audio"; "calls connect but disconnect after a set interval, typically 30 to 60 seconds"; names: "SIP ALG, SIP Transformations, SIP Helper, SIP Inspection, VoIP passthrough". — [Nextiva](https://www.nextiva.com/blog/disable-sip-alg.html); [SonicWall KB](https://www.sonicwall.com/support/knowledge-base/how-and-when-to-disable-sip-alg/kA1VN0000000FTk0AM)
- Verdict: **TWEAK** Verify: "Two-way audio on a test call in both directions; phones keep registration; no drops at ~30–60 s." Add menu names: ASUS WAN → NAT Passthrough → SIP Passthrough; Netgear ADVANCED → Setup → WAN Setup → Disable SIP ALG; TP-Link Advanced → NAT Forwarding → ALG.

**2.7 No port forwards unless used**
- Kit: "Every forward is an open door". Consistent with FTC/CISA/NSA (disable unneeded features). Verdict: **OK**.

### Inferences
- Pool `.100`–`.199` (100 addresses) with 24 h leases is ample for a home/small office; guest SSIDs usually have their own pool on consumer routers so no separate lease setting is needed. No vendor source prescribes pool sizing (Gap).
- For vendors without local DNS, the kit's `ssh-config-gen.sh` plus reservations already deliver the `ssh nas` outcome; the checklist should say so instead of implying a router setting exists.

### Gaps
- Google Nest Wifi local hostname resolution: no result either way; assume none.
- Cloudflare/Quad9/Google pages could not be fetched; IPv6 addresses and DoH/DoT endpoints not captured (Cloudflare `2606:4700:4700::1111`, Quad9 `2620:fe::fe`, Google `2001:4860:4860::8888` are well-known but unverified here).
- No official source for DHCP pool sizing or lease time; only secondary consensus (24 h home, 1–8 h guest).
- FCC/vendor wording for MTU beyond TP-Link's FAQ was not captured.

---

## KQ3. Wi-Fi: channels/width, DFS, 6 GHz, band steering, transmit power, 802.11k/v/r, guest isolation, AP isolation, WPA3/TKIP/WEP

### Takeaway
2.4 GHz 1/6/11 @ 20 MHz and 5 GHz 80 MHz on non-DFS 36–48 / 149–165 are correct for the US; DFS behaviour is more specific than "1-minute drops" (60 s CAC, 10 min on 120/124/128, 30-min non-occupancy). The kit omits 6 GHz (Wi-Fi 6E/7: WPA3 mandatory, pick a PSC primary channel, 160 MHz is fine there) and 802.11k/v/r. Security row should lead with WPA3-Personal, then WPA2/WPA3 transition, with a named list of devices that break in transition mode and the new Wi-Fi Alliance "Compatibility Mode".

### Cited Findings

**3.1 Security mode: WPA2-AES or WPA3/WPA2 mixed; no WEP/TKIP**
- Kit says: "**ASK** WPA2-AES (or WPA3/WPA2 mixed). No WEP, no TKIP — TKIP caps speed at 54 Mb/s and is broken — Verify: Old devices still join; if one cannot, keep WPA2/WPA3 mixed".
- Apple [Vendor][snippet]: "Set to WPA3 Personal for better security, or set to WPA2/WPA3 Transitional for compatibility with older devices"; "WEP and TKIP security settings are not recommended". — [Apple: Recommended settings for Wi-Fi routers and access points (102766)](https://support.apple.com/en-us/102766)
- NSA [Gov][snippet]: "Implement WPA3 or WPA2 on your wireless network". — [NSA press release](https://www.nsa.gov/Press-Room/Press-Releases-Statements/Press-Release-View/Article/3304674/nsa-releases-best-practices-for-securing-your-home-network/)
- Wi-Fi Alliance, Nov 2024 [Standards][snippet]: "newer compatibility mode mitigates network connection issues encountered by older, uncertified client devices in the presence of a network configured for WPA3-Personal transition mode and ensures that all clients can connect to the network." — [Wi-Fi Alliance: Driving widespread adoption of WPA3 (PDF)](https://www.wi-fi.org/system/files/WPA3_Deployment_Options_Highlights_20241125.pdf)
- Devices that break in transition mode [Secondary][snippet]: "older Nest cameras and thermostats, older smart-TV firmware, older e-readers, and the original Nintendo Switch and Switch Lite, which support WPA2-AES but not WPA3"; "older Apple devices reported to have issues even in transition mode include iPads (2010-2013), iPad Mini (2012-2015), iPod Touches, iPhones 5, 5S, 6, & 6 Plus and earlier, and Macs earlier than 2013". — [shiftctrl.net](https://shiftctrl.net/articles/wpa2-wpa3-transition-mode); [Wifizoo](https://wifizoo.org/2023/01/30/when-you-should-use-wpa3-transition-mode/)
- 6 GHz requires WPA3 [Vendor/Standards][snippet]: "The Wi-Fi Alliance requires WPA3 security certification for Wi-Fi 6E devices that will operate in the 6 GHz band"; "Existing SSID deployments using WPA2-Enterprise (802.1X) or WPA2-Personal security modes cannot be enabled for 6 GHz"; "Wi-Fi 6E also requires Protected Management Frame (PMF) in both AP and Clients." — [Cisco: Wi-Fi 6E WLAN Layer 2 Security](https://www.cisco.com/c/en/us/support/docs/wireless/catalyst-9800-series-wireless-controllers/220712-configure-and-verify-wi-fi-6e-wlan-layer.html); [Aruba Wi-Fi 6E planning](https://arubanetworking.hpe.com/techdocs/aos/wifi-design-deploy/generations/wifi6e/plan-deploy/)
- Verdict: **FIX** (ordering and detail). New row: "**ASK** Main SSID: WPA3-Personal if every client supports it; otherwise WPA2/WPA3-Personal transition (Apple's recommendation; some 2024+ firmware offers 'WPA3 Compatibility Mode', prefer it over plain transition). IoT/guest SSID: WPA2-Personal AES only if any device fails. Never WEP, WPA(1), 'WPA/WPA2 mixed', or TKIP. 6 GHz radios only run WPA3 (no WPA2 option exists). Verify: every device reconnects; known offenders in transition mode: original Nintendo Switch/Switch Lite, older Nest cams/thermostats, iPhone 6 and earlier, pre-2013 Macs — move those to the WPA2-only IoT SSID. Undo: previous mode." (The "54 Mb/s TKIP cap" claim was not confirmed in results — see Gaps; drop the number or keep it as "TKIP disables 802.11n/ac rates".)

**3.2 2.4 GHz: channel 1/6/11, width 20 MHz**
- Kit says: "2.4 GHz: channel 1, 6 or 11, width 20 MHz — Auto often picks overlapping channels; 40 MHz on 2.4 GHz hurts neighbours and itself".
- Sources: Apple 102766 covers channel width per band (page blocked; see Gaps). No contradicting source found; this is long-standing consensus. Verdict: **OK** (unsourced beyond Apple's page title in results).

**3.3 5 GHz: 80 MHz on a non-DFS channel (36–48, 149–165); DFS vacates on radar**
- Kit says: "5 GHz: 80 MHz, a non-DFS channel (36–48, 149–165 in the US) — DFS channels vacate when radar is heard: 1 min drops".
- FCC rules [Gov][snippet]: "U-NII devices operating in the 5.25-5.35 GHz and 5.47-5.725 GHz bands shall employ a DFS radar detection mechanism"; CAC "in the United States typically lasts 60 seconds"; "channels near Terminal Doppler Weather Radar frequencies (specifically channels 120, 124, and 128) require a 10-minute CAC"; "A channel that has been flagged as containing a radar system ... is subject to a non-occupancy period of at least 30 minutes"; "When radar is detected, APs must immediately vacate the channel". — [FCC 06-96](https://docs.fcc.gov/public/attachments/FCC-06-96A1.pdf); [Federal Register 2014-22677](https://www.govinfo.gov/content/pkg/FR-2014-09-24/pdf/2014-22677.pdf); [Cisco: Radar detection in DFS channels](https://www.cisco.com/c/en/us/support/docs/wireless-mobility/80211/213882-radar-detection-in-dynamic-frequency-sel.html); [Cisco Meraki DFS](https://documentation.meraki.com/MR/Radio_Settings/Dynamic_Frequency_Selection_(DFS))
- Non-DFS list [Secondary][snippet]: "Non-DFS channels include 36-48, while channels 52-64 require Dynamic Frequency Selection"; "The 5 GHz band supports two contiguous 160 MHz blocks — channel 50 (covering channels 36–64) and channel 114 (covering channels 100–128), and both 160 MHz blocks include DFS channels." — [networklessons](https://networklessons.com/wireless/wi-fi-5-ghz-frequency-bands-and-channels); [Keenetic: 160 MHz channels](https://help.keenetic.com/hc/en-us/articles/360012060379-Available-channels-on-the-5-GHz-Wireless-network); [TP-Link FAQ 4309](https://www.tp-link.com/us/support/faq/4309/) [Vendor]
- U-NII-4 [Gov + Secondary][snippet]: "the 5.850-5.925 GHz frequency band ... U-NII-4 was approved for unlicensed use on May 3, 2021, effective July 2, 2021"; "three more 20MHz channels, including 169, 173, and 177"; "This new 160MHz channel [149–177] is the only one that does not use DFS." — [FCC 20-164](https://docs.fcc.gov/public/attachments/FCC-20-164A1.pdf); [Dong Knows Tech: U-NII-4](https://dongknows.com/5-9ghz-wi-fi-6-explained-how-unii-4-can-be-exciting/); [The Packetologist](https://www.thepacketologist.com/2021/10/no-love-unii4/)
- Verdict: **TWEAK**. Why cell: "DFS channels (52–64, 100–144) must listen 60 s before use (10 min on 120/124/128) and must leave for 30 min if radar is heard, so a radar hit means a channel change plus up to 60 s of silence if the new channel is also DFS. Non-DFS 80 MHz choices in the US: 36–48 or 149–161 (165 is a lone 20 MHz channel; 169–177 exist since 2021 but few clients support them). 160 MHz on 5 GHz always needs DFS unless the router and clients support 149–177 — leave at 80 MHz." Verify cell stays.

**3.4 6 GHz (Wi-Fi 6E/7) — omitted by the kit**
- Netgear [Vendor][snippet]: PSCs are "specific channels designated for beacon and discovery purposes"; "PSCs are spaced 80 MHz apart, so a client would only need to scan 15 channels instead of 59. The full list of 6 GHz PSC channels is 5, 21, 37, 53, 69, 85, 101, 117, 133, 149, 165, 181, 197, 213, and 229." — [Netgear KB 000063519](https://kb.netgear.com/000063519/What-are-Preferred-Scanning-Channels-in-the-6-GHz-band)
- Cisco [Vendor][snippet]: "When deploying 6 GHz access points, the primary channel of each AP should be a PSC channel"; "Each 160 MHz channel contains two PSC channels"; "if 80 or 160 MHz channel width is selected, the beacons are automatically transmitted over PSC channels." — [Cisco: Wi-Fi 6E band operations](https://www.cisco.com/c/en/us/support/docs/wireless/catalyst-9166-series-access-points/220526-configure-and-verify-wi-fi-6e-band-opera.html); [SmallNetBuilder: Wi-Fi 6E basics](https://www.smallnetbuilder.com/basics/wireless-basics/wi-fi-6e-the-basics/) [Secondary]
- Wi-Fi 7 MLO [Vendor][snippet]: "MLO requires that you have a Wi-Fi 7 router and Wi-Fi 7 device"; TP-Link: "Advanced → Wireless → Wireless Settings, locate the MLO Network Section, enable 'MLO Network,' and select which Wi-Fi bands"; ASUS: "If MLO is enabled on an AiMesh Primary router, a node without MLO will not broadcast 6GHz WiFi"; suggestion "set IoT network the same SSID and password as used now and set Wi-Fi 7 SSID as a new SSID to ensure compatibility". — [ASUS FAQ 1053342](https://www.asus.com/us/support/faq/1053342/); [eero: What is MLO?](https://support.eero.com/hc/en-us/articles/28280371079707-Wi-Fi-7-Multi-Link-Operation-MLO); [UniFi MLO](https://help.ui.com/hc/en-us/articles/25656226682775-Multi-Link-Operation-MLO-in-UniFi-Network); [TP-Link community MLO](https://community.tp-link.com/us/home/forum/topic/854206)
- Verdict: **ADD** row: "6 GHz (if the router has it): WPA3 only (no choice); channel width 160 MHz is fine (no DFS on 6 GHz); if the channel is set by hand, pick a PSC (5, 21, 37, 53, 69, 85, 101, 117, 133, 149, 165, 181, 197, 213, 229) so clients find it quickly. Wi-Fi 7 'MLO' SSIDs are separate on ASUS/TP-Link: enable only if there are Wi-Fi 7 clients, and keep the ordinary SSID for everything else. Verify: a 6E phone shows a 6 GHz link in Wi-Fi details."

**3.5 Transmit power lower on close APs (sticky clients)**
- Kit says: "Transmit power: lower on APs that are close together — 'Sticky client' problem — Wireless → Professional/Advanced: 50–75% on the near AP — Verify: Phones roam within a few seconds".
- Ubiquiti [Vendor][snippet]: "The Minimum RSSI value is set individually on each AP and indicates the minimum signal level required for a client to remain connected ... prevents a device from getting 'stuck' connected to the initial AP at a weaker signal strength"; starting value "-75 dBm". — [Ubiquiti: Understanding and Implementing Minimum RSSI](https://help.ui.com/hc/en-us/articles/221321728-Understanding-and-Implementing-Minimum-RSSI)
- UniFi practice [Secondary][snippet]: "overlap cells 15–20% by lowering TX power instead of maxing it"; "ensure 2.4GHz transmit power is around the 17dBm mark, while keeping 5GHz down at around 14dBm for proper roaming between bands"; "Most clients will hold onto an access point down to -80 dBm or worse". — [Demarc Networks](https://demarcnetworks.com/guides/unifi-wifi-roaming); [itman.ae](https://itman.ae/2025/07/02/how-unifi-handles-seamless-roaming/)
- Verdict: **OK**, TWEAK Do cell: "ASUS: Wireless → Professional → Tx power adjustment; Netgear: Advanced → Wireless Settings → Transmit Power Control; UniFi: Radios → Transmit Power Medium/Low and optionally Minimum RSSI −75 dBm; TP-Link/eero/Google: not exposed (eero/Google manage it themselves)."

**3.6 Band steering / Smart Connect**
- Kit says: "Band steering / Smart Connect: keep only if roaming behaves — Some clients flap between bands — If devices drop, split into `Kapoor-2G` and `Kapoor-5G`".
- Netgear [Vendor][snippet]: "With Smart Connect enabled, a router broadcasts a single SSID for both the 2.4 GHz band and 5 GHz band, and the router automatically selects the best WiFi band for each device." — [Netgear KB 25346](https://kb.netgear.com/25346/What-is-Smart-Connect-and-how-do-I-enable-or-disable-it-on-my-Nighthawk-router); ASUS Smart Connect FAQ — [ASUS/ROG FAQ 1012132](https://rog.asus.com/us/support/faq/1012132/)
- Community consensus [Secondary][snippet]: "Some dumb devices don't work well with smart connect (will refuse to connect)"; "most devices prefer the 5Ghz band by default, so band steering usually isn't needed"; "Most people around will recommend separate SSIDs on Asus routers." — [SNBForums: How useful is Asus's Smart Connect?](https://www.snbforums.com/threads/how-useful-is-asuss-smart-connect.82024/); [SNBForums: Smart connect vs same SSID](https://www.snbforums.com/threads/smart-connect-vs-same-ssid.66534/)
- Verdict: **OK**. TWEAK: "eero and Google Nest Wifi always band-steer and cannot split bands; ASUS/Netgear/TP-Link can. Old 2.4 GHz-only IoT that will not join a steered SSID is the usual reason to split (or to put IoT on its own 2.4 GHz-only guest SSID)."

**3.7 802.11k/v/r fast roaming — omitted by the kit**
- Microsoft [Vendor][snippet]: "802.11k allows clients to request a neighbor report ... candidates for roaming"; 802.11v "initiate roaming for sub-optimal connections"; "802.11r protocol defines a fast roaming mechanism that allows clients to complete pre-authentication with a candidate AP before roaming". — [Microsoft Learn: Fast roaming with 802.11k, 802.11v, and 802.11r](https://learn.microsoft.com/en-us/windows-hardware/drivers/network/fast-roaming-with-802-11k--802-11v--and-802-11r); [Cisco Meraki 802.11k/r overview](https://documentation.meraki.com/MR/Wi-Fi_Basics_and_Best_Practices/802.11k_and_802.11r_Overview)
- TP-Link [Vendor][snippet]: "In Advanced Settings, check the box to enable 802.11r". — [TP-Link FAQ 4118](https://www.tp-link.com/us/support/faq/4118/)
- ASUS [Vendor + Secondary][snippet]: official "Roaming Assistant" FAQ — [ASUS FAQ 1036730](https://www.asus.com/support/faq/1036730/); community: "The primary roaming mechanics on AiMesh is roaming assistant (roamast), which disassociates a client based on signal ... AiMesh does not actually use 802.11v to steer clients"; "When asked which of its routers support 802.11k, v or r, ASUS replied that its routers support only proprietary roaming methods." — [SNBForums: Roaming Assistant, AiMesh, 802.11k/v](https://www.snbforums.com/threads/roaming-assistant-aimesh-and-802-11k-and-802-11v.77496/); [SmallNetBuilder: How To Fix Wi-Fi Roaming](https://www.smallnetbuilder.com/basics/wireless-basics/how-to-fix-wi-fi-roaming/)
- Keenetic [Vendor][snippet], conflicting claim: "Use WPA2 only for fast roaming, as WPA3 is incompatible with 802.11r fast roaming on most devices." — [Keenetic: Wi-Fi seamless roaming](https://help.keenetic.com/hc/en-us/articles/360000862539-Wi-Fi-seamless-roaming). This is one vendor's statement; Cisco/Meraki documents FT with WPA3 (FT-SAE) — treat as unresolved (Gaps).
- Verdict: **ADD** row: "Roaming assist: turn on 802.11k and 802.11v where offered (UniFi: WLAN → 'BSS Transition'; TP-Link: 'Fast Roaming'/802.11r toggle; ASUS: Wireless → Professional → 'Roaming Assistant' with RSSI −70 dBm, its 802.11k/v are proprietary-ish; Netgear Orbi/eero/Google: built in, nothing to set). Enable 802.11r only after k/v, and only if every client still connects — some older clients refuse an SSID with 802.11r. Verify: walk between APs on a phone; the BSSID changes without the call dropping."

**3.8 Guest / IoT SSID with client isolation, no LAN access**
- Kit says: "Guest / IoT SSID with client isolation, no LAN access — Keeps cameras, TVs, visitors off the machines and the NAS — Verify: A guest device cannot ping the NAS".
- NSA [Gov][snippet]: "separate your private WLAN, guest WLAN and IoT network to prevent direct communication between potentially insecure devices". — [Ikarus summary of NSA CSI](https://www.ikarussecurity.com/en/security-news-en/nsa-guide-to-secure-home-networks/)
- UniFi [Vendor][snippet]: "Client Isolation blocks communication within a single Access Point—even on the same VLAN—making it ideal for guest networks and IoT security. ACLs are ideal for restricting inter-VLAN communication". — [Ubiquiti: Implementing Network and Client Isolation](https://help.ui.com/hc/en-us/articles/18965560820247-Implementing-Network-and-Client-Isolation-in-UniFi)
- ASUS [Vendor + Secondary][snippet]: "Guest Network Pro → IoT Network ... isolating these devices on a separate network"; community caveat: "the 'IoT Network' preset does not create a VLAN, and users can ping all the devices from main subnet" on some firmware. — [ASUS FAQ 1053540](https://www.asus.com/us/support/faq/1053540/); [SNBForums: Understanding Guest Network Pro IoT](https://www.snbforums.com/threads/understanding-guest-network-pro-iot.86916/)
- Verdict: **OK**. TWEAK: "Feature names: ASUS 'Guest Network Pro → IoT Network' (3.0.0.6 firmware) or classic 'Guest Network' with 'Access Intranet = Off'; Netgear 'Guest Network' + 'Allow guests to see each other and access my local network' unticked; TP-Link 'Guest Network' + 'Allow guests to access my local network' off; eero 'Guest network' (isolated by default); UniFi: separate Network/VLAN with 'Network Isolation' + Client Device Isolation on the WLAN. Casting (Chromecast/AirPlay) from a phone on the main SSID to a TV on the IoT SSID will not work by design — decide per device."

**3.9 Client / AP isolation off on the main SSID**
- Kit says: "Client / AP isolation **off** on the main SSID — Isolation on the main SSID is why the NAS 'vanishes' from Wi-Fi laptops — Verify: Wi-Fi laptop can ping a wired PC". Triage: "mDNS is blocked by client isolation".
- [Secondary][snippet]: AP isolation "disrupts services that depend on wireless client-to-client communication or multicast/broadcast traffic, including local file sharing between wireless devices, media casting applications such as Chromecast and AirPlay (which rely on mDNS/Bonjour for device discovery)"; "If AP isolation is enabled on the SSID Chromecast uses, your phone can't 'see' the Chromecast even though both have internet." — [whizz-experts: Chromecast not discovering](https://whizz-experts.com/support/smart-devices/chromecast-not-discovering-devices/); [Cisco community: Bonjour and isolation](https://community.cisco.com/t5/wireless/bonjour-gateway-airplay-airserver-random-disconnects/td-p/2392841)
- Verdict: **OK**. TWEAK the Verify: "Wi-Fi laptop can ping a wired PC *and* another Wi-Fi laptop (AP isolation only blocks wireless-to-wireless on many routers, so the wired test alone can pass)."

**3.10 Every satellite / extender / old router in AP mode**
- Kit says: "Every satellite / extender / old router in **AP mode** — Otherwise it NATs and hands out its own IPs — Verify: netscan sees a single gateway".
- eero [Vendor][snippet]: in bridge mode "you lose access to ... IP reservations and port forwarding, Local DNS caching, Smart Queue Management (SQM), Thread, Upstream IPv6, Custom DNS, UPnP" and eero Plus "Advanced security, Ad Blocking, Content Filters". — [eero: What features do I lose in bridge mode?](https://support.eero.com/hc/en-us/articles/115000825206-What-features-do-I-lose-if-I-put-my-eeros-in-bridge-mode); [eero: What is bridge mode?](https://support.eero.com/hc/en-us/articles/208276903-What-is-bridge-mode)
- Wired backhaul [Vendor blog][snippet]: "A wired connection between nodes is especially helpful for real-time and high-bandwidth activities such as video calls and gaming"; "use Cat6 or higher Ethernet cables". — [eero blog: Ethernet backhaul](https://eero.com/blog/articles/ethernet-backhaul-mesh-wifi); [TechRadar: wired backhaul](https://www.techradar.com/news/what-is-wired-backhaul-and-should-your-mesh-network-be-using-it) [Secondary]
- Verdict: **TWEAK**. "Satellites that belong to the same mesh system (Orbi satellites, eero nodes, Deco units, AiMesh nodes) already bridge to their primary — nothing to set. What must be switched is any *separate* router-class box: an old router reused as an AP (Operation mode → Access Point), a standalone range extender, or a whole mesh system placed behind another router (eero → 'Bridge mode', Google → 'Bridge mode', Deco → 'Access Point mode'). Note the cost: eero in bridge mode loses reservations, SQM, custom DNS and eero Plus filtering, so if eero is the mesh, make eero the router and bridge the ISP box instead. Prefer wired (Ethernet) backhaul for satellites; Cat5e/6."

### Inferences
- Because 6 GHz mandates WPA3 and cannot carry WPA2, a router set to "WPA2/WPA3 transition" on a shared tri-band SSID is effectively WPA3-only on 6 GHz and transition on 2.4/5 GHz; the kit's Verify (old devices still join) remains valid.
- The kit's "1 min drops" is right when the AP moves to another DFS channel (60 s CAC) and wrong when it moves to a non-DFS channel (seconds). The non-occupancy of 30 minutes explains why the router does not come back to the original channel quickly.

### Gaps
- Apple 102766 could not be fetched: its specific rows on channel width (20 MHz on 2.4 GHz), DHCP lease time, hidden SSID, MAC filtering, auto firmware update and "same SSID on all bands" are not quoted here; only the WPA3/transitional and WEP/TKIP lines were confirmed by snippet.
- "TKIP caps speed at 54 Mb/s": not confirmed in results (802.11n/ac data rates are disabled with TKIP per the 802.11 spec, which is a stronger statement, but I have no fetched source).
- FCC channel move time (10 s) not captured in snippets; only CAC and non-occupancy periods were.
- Whether 802.11r works with WPA3 on consumer gear: Keenetic says no on "most devices"; enterprise docs describe FT-SAE. Unresolved for consumer routers.
- Ubiquiti's exact "BSS Transition"/"Fast Roaming" toggle names come from memory of the UniFi UI; the help article was blocked.

---

## KQ4. Topology: bridge vs DMZ/IP Passthrough, double-NAT detection, CGNAT (netscan.sh)

### Takeaway
The triage's end-state (ISP box bridged, else DMZ) is right but should name "IP Passthrough" (AT&T) and say plainly that DMZ leaves double NAT in place. `netscan.sh` counts 100.64.0.0/10 as private in `is_private`, so a CGNAT ISP produces a false "DOUBLE NAT" verdict; RFC 6598 space is not RFC 1918 and bridging the modem cannot fix it. The definitive test is comparing the router's WAN IP with the public IP.

### Cited Findings

**4.1 Bridge mode vs DMZ**
- Kit says (triage): "The ISP modem or gateway is in bridge or passthrough mode. If the ISP box cannot bridge, its Wi-Fi is off and the router's WAN address sits in its DMZ"; table: "Bridge mode on the modem (ISP support page has the steps). If not possible, DMZ the router's WAN IP in the modem and disable the modem's Wi-Fi".
- Xfinity [Vendor][snippet]: "Xfinity Bridge Mode turns your Xfinity Gateway (modem/router combo) into just a modem, disabling its routing, Wi-Fi, and DHCP functions"; "select Gateway > At a Glance and next to Bridge Mode, click Enable"; "Only one device can be connected to the gateway while in Bridge Mode". — [Xfinity: Use Bridge Mode](https://www.xfinity.com/support/articles/wireless-gateway-enable-disable-bridge-mode)
- AT&T [Secondary describing vendor][snippet]: "AT&T fiber gateways do not offer a traditional bridge mode. The equivalent is IP Passthrough, which hands the gateway's public IP directly to your router." — [modemguides](https://www.modemguides.com/blogs/modemguides-blog/how-to-put-isp-gateway-into-bridge-mode)
- DMZ ≠ bridge [Secondary][snippet]: "DMZ off the ISP router is nowhere near bridge mode — bridge is just a switch effectively, while DMZ is still using routing and NAT"; "Using DMZ is still double NAT — it's just serial NAT with an explicit forwarding rule." — [Level1Techs](https://forum.level1techs.com/t/real-world-bridge-mode-vs-dmz-differences-aka-is-double-nat-even-a-problem-with-dmz/147899); [OneUptime: Double NAT](https://oneuptime.com/blog/post/2026-03-20-double-nat-problems/view)
- Verdict: **TWEAK**. Triage end-state: "The ISP box is in Bridge mode (Xfinity/Spectrum/most cable), or 'IP Passthrough' (AT&T BGW/Pace fiber gateways, which have no bridge mode), or 'Passthrough/PPPoE bridge' (DSL/fiber ONT+router combos). Only if none exists: modem Wi-Fi off, its DHCP left on, and the router's WAN IP set as the modem's DMZ host — this still leaves two NATs (netscan will keep reporting DOUBLE NAT); it just makes inbound reach the router. In Xfinity bridge mode only one device (the router) may be plugged into the gateway."

**4.2 Double-NAT detection in `netscan.sh` and the CGNAT caveat**
- Kit says (`netscan.sh` §2): `is_private` returns true for `10.*`, `192.168.*`, `172.16–31.*` **and `100.64–127.*`**; `traceroute -n -m 3 -w 1 -q 1 1.1.1.1`; "if PRIV -ge 2 → warn 'DOUBLE NAT: the first $PRIV hops are private addresses'". Triage: "netscan says **DOUBLE NAT** ... Log into the modem: does it have a LAN IP range and DHCP of its own?"
- RFC 6598 [Standards][snippet]: "Shared Address Space is distinct from RFC 1918 private address space because it is intended for use on Service Provider networks"; "This Shared Address Space avoids conflicts with private addresses (RFC 1918) that may be in use on the customer side of the CGN, and must not be routed on the public Internet"; "100.64.0.0/10 is not RFC 1918 - should not be used in enterprise or home networks." — [RFC 6598 (datatracker)](https://datatracker.ietf.org/doc/html/rfc6598); [ipSpace on RFC 6598](https://blog.ipspace.net/2013/08/can-i-use-shared-rfc-6598-ipv4-address/) [Secondary]
- Detection [Secondary][snippet]: "If your router's WAN IPv4 is in 100.64.0.0/10, you're behind CGNAT. If it differs from your external IPv4, you're behind upstream NAT (CGNAT or double NAT)"; "traceroute showing 100.64.x.x as an early hop strongly suggests CGNAT"; "a router WAN of 192.168.100.2 is the range ISP modem-routers typically hand out, so the usual cause is a second router in front of your own"; "Some carriers use private RFC 1918 addressing for their CGNAT links rather than 100.64.0.0/10, which makes the link look like ordinary home-side double-NAT from inside the home." — [OneUptime: Detect CGNAT](https://oneuptime.com/blog/post/2026-03-20-detect-cgnat/view); [shiftctrl: Double-NAT on UniFi, bridge mode, IP passthrough, CGNAT](https://shiftctrl.net/articles/unifi-double-nat-bridge-mode)
- Verdict: **FIX** in `netscan.sh`: split the classification. Suggested logic and text: keep `is_private` for RFC 1918 only; add `is_cgnat` for `100.64.0.0/10`. Then: if hop 2 (or 3) is RFC 1918 → `warn "DOUBLE NAT likely: hop N is $h (RFC 1918). Confirm on the router's status page: WAN IP private = second router in front (bridge it). Some ISPs use 10.x internally, so a public WAN IP on the router means this is a false alarm."`; if any early hop or the WAN IP is in 100.64/10 → `warn "CGNAT: hop N is $h (100.64.0.0/10, RFC 6598 shared space). This is the ISP's NAT, not a box in the house — bridging the modem will not remove it; inbound port forwards will not work; ask the ISP for a public/static IP or use IPv6/Tailscale."`; else `ok "single NAT"`. Triage table row: add the CGNAT branch: "If netscan says CGNAT (100.64.x.x hop) there is nothing to bridge; the modem check will show a public-looking WAN IP in 100.64–127.x — that is the ISP." Definitive check to add to Verify: "Router status page WAN IP equals the address shown by `curl -s https://api.ipify.org` (or any 'what is my IP' site) → single NAT."

**4.3 Link-speed check in `netscan.sh`**
- Kit says: macOS `networksetup -getmedia` "Active" line, Linux `/sys/class/net/$IFACE/speed` → warn on `*100Mb*|100baseT*|*"100baseTX"*`: "link is 100 Mb/s ... bad cable or a 100 Mb switch port. Gigabit expected." Triage: "amber usually = 100 Mb".
- No external source needed for the pattern logic; reviewed by reading: "1000Mb/s" and "2500Mb/s" do not match `*100Mb*` (no false positive); Wi-Fi interfaces yield empty/-1 and are skipped. Verdict: **OK**. TWEAK triage text: "LED colour codes are vendor-specific (Netgear/TP-Link unmanaged switches: green = 1 Gb, amber = 10/100 on many models, but check the switch label)." (LED convention is general knowledge, unsourced.)

### Inferences
- With the current code, a household behind CGNAT will be told to "bridge the modem", waste time, and then find the modem already bridged. The fix is a two-class message, not a different traceroute.
- `-m 3` is enough: the router is hop 1; a second in-home NAT is hop 2; CGNAT usually shows at hop 2–3.

### Gaps
- RFC 6598's exact sentences could not be pulled from rfc-editor.org; quotes are snippet-level from datatracker/secondary mirrors.
- AT&T's own IP Passthrough KB was not fetched (only a secondary description); the feature name "IP Passthrough" is consistent across sources.

---

## KQ5. QoS, SQM/bufferbloat, hardware NAT acceleration, SIP ALG

### Takeaway
The kit's blanket "QoS off, NAT acceleration on" is right for gigabit lines and wrong for slower lines with video-call/gaming latency complaints: SQM (fq_codel/CAKE) is the fix for bufferbloat, is shipped as eero's "Optimize for Conferencing and Gaming (SQM)", ASUS "Adaptive QoS"/Merlin "Cake", UniFi "Smart Queues", and it necessarily disables hardware NAT acceleration, capping WAN throughput (ASUS: roughly 200–400 Mb/s on many models; eero Pro gen2 ~500 Mb/s). Rule: test bufferbloat first; enable SQM only when the line rate is below what the router can shape.

### Cited Findings
- Kit says: "Hardware NAT / flow acceleration **on**; QoS **off** — QoS on consumer routers caps throughput — Advanced → QoS: off unless VoIP needs priority; NAT acceleration: on — Verify: Speed test at the router's rated line rate".
- ASUS [Vendor][snippet]: "For the QoS Bandwidth Limiter to function correctly, the NAT Acceleration function will be turned off. QoS Bandwidth Limiter and NAT Acceleration are functions that cannot work at the same time." — [ASUS FAQ 1013333](https://www.asus.com/support/faq/1013333/)
- Throughput cost [Secondary][snippet]: "Traditional QoS is NAT acceleration incompatible and depending on your router model WAN-LAN throughput will be cut down to 200-400Mbps range"; "Many routers will not pass much over 200mbps with it off but can do 1gbit with it on." — [SNBForums: Adaptive QoS and HW acceleration](https://www.snbforums.com/threads/adaptive-qos-and-hw-acceleration.94162/); [Tom's Hardware forum](https://forums.tomshardware.com/threads/qos-quality-of-service-questions-on-an-asus-rt%E2%80%91ac3200-does-qos-actually-work.2972726/)
- Why SQM [Secondary + paper][snippet]: "NAT acceleration is great for speedtests, but it doesn't prevent bufferbloat under load"; "Hardware NAT acceleration or flow offloading must be DISABLED ... hardware offload bypasses the CPU-driven CAKE path"; "CPU power determines the max bandwidth you can handle with SQM on, and typically a consumer router won't be able to do cake or fq_codel SQM on a Gigabit connection"; CAKE "incorporating bandwidth shaping, per-flow and per-host fairness, DiffServ awareness, and optional TCP ACK filtering". — [SNBForums: RT-AX86U Pro + CAKE results](https://www.snbforums.com/threads/endgame-bufferbloat-results-rt-ax86u-pro-cake-sqm-0ms-active-latency.97000/); [linkspeed.co.uk: How to fix bufferbloat](https://www.linkspeed.co.uk/troubleshooting-guides/how-to-fix-bufferbloat.php); [Piece of CAKE (arXiv)](https://arxiv.org/pdf/1804.07617)
- eero [Vendor + community][snippet]: "'Optimize for Conferencing and Gaming,' formerly known as Smart Queue Management (SQM), intelligently shapes how wifi traffic is queued to reduce latency"; "The eero pro gen2 only supports up to 500mbps for optimize for conference and gaming." — [eero community: SQM](https://community.eero.com/t/35hg7l5/sqm-or-optimize-for-conference-and-gaming); feature listed under eero advanced settings — [eero: Advanced networking settings](https://support.eero.com/hc/en-us/articles/360036385311-What-are-the-Advanced-networking-settings)
- SIP ALG: see KQ2 item 2.6 (Netgear KB 30796; symptoms one-way audio, lost registration, 30–60 s drops).
- Verdict: **FIX** the row: "QoS: off by default; NAT/flow acceleration on. Exception — bufferbloat: if video calls stutter while someone uploads/downloads, run a bufferbloat test (e.g. Waveform's) with the line idle vs loaded. Grade C or worse and a line ≤ ~300–500 Mb/s → enable the router's SQM (eero: 'Optimize for Conferencing and Gaming (SQM)'; ASUS: 'Adaptive QoS' or, on Merlin, 'Cake'; UniFi: 'Smart Queues'; Netgear: 'Dynamic QoS') with the bandwidth set to ~85–95% of measured speed. This turns hardware NAT acceleration off (ASUS states they cannot coexist) and caps throughput to what the CPU can shape (often 200–500 Mb/s). Gigabit line → leave QoS off. Verify: bufferbloat grade A/B under load and speed test still near the line rate. Undo: QoS off, acceleration on."

### Inferences
- The kit's Verify ("speed test at rated line rate") should be paired with a loaded-latency test; a fast speed test says nothing about bufferbloat.
- eero and Google Nest have no separate "NAT acceleration" toggle; the trade-off is hidden inside the SQM checkbox.

### Gaps
- bufferbloat.net and the OpenWrt SQM page (the canonical guidance on setting 85–95% of measured rate, and link-layer overhead for PPPoE/DOCSIS) could not be fetched; the percentage rule is from memory of those pages and from the SNB thread's "aggressive undershoot" practice — mark as unverified.
- The Waveform bufferbloat test URL was not captured in a snippet (well known: waveform.com/tools/bufferbloat) — unverified here.

---

## KQ6. Rogue DHCP detection and Windows network profile

### Takeaway
`sudo nmap --script broadcast-dhcp-discover` is the right tool: verified from the script source, it needs root, waits 10 s by default, uses MAC DE:AD:C0:DE:CA:FE, and prints "Response N of M" for every answering server. Windows Public vs Private is correctly described; the cmdlet the kit uses is the documented one.

### Cited Findings
- Kit says (triage): "`sudo nmap --script broadcast-dhcp-discover` on Linux/macOS with nmap installed. Every responder is listed; only the router should answer"; "Every Windows machine on the **Private** network profile"; "`Set-NetConnectionProfile -InterfaceIndex N -NetworkCategory Private`".
- nmap script, **verified from source** [Primary]: "Sends a DHCP request to the broadcast address (255.255.255.255) and reports the results. By default, the script uses a static MAC address (DE:AD:CO:DE:CA:FE)"; "If no response has been received before the timeout has been reached (default 10 seconds) the script will abort execution"; "@args broadcast-dhcp-discover.timeout time in seconds to wait for a response (default: 10s)"; "The script needs to be run as a privileged user, typically root"; output format "Response 1 of 1" (numbered per responding server). — [nmap/scripts/broadcast-dhcp-discover.nse (GitHub)](https://github.com/nmap/nmap/blob/master/scripts/broadcast-dhcp-discover.nse); doc page [nmap NSEDoc](https://nmap.org/nsedoc/scripts/broadcast-dhcp-discover.html)
- Windows profiles [Vendor doc + Secondary][snippet]: "Network discovery is turned off by default for public networks and turned on by default for private networks"; Public: "A public profile disables file and printer sharing ... Incoming connections are blocked or limited"; Private: "Your PC is discoverable by other devices, file and printer sharing works, and Windows Firewall rules are less restrictive." — [4sysops](https://4sysops.com/archives/change-windows-network-profiles-between-public-and-private/); [MCSI Library](https://library.mosse-institute.com/articles/2023/08/public-vs-private-network/public-vs-private-network.html)
- Cmdlet [Vendor][snippet]: "Set-NetConnectionProfile changes the network category of a connection profile"; NetworkCategory "Public, Private, or DomainAuthenticated"; example "Get-NetConnectionProfile -NetworkCategory Public | Set-NetConnectionProfile -NetworkCategory Private". — [Microsoft Learn: Set-NetConnectionProfile](https://learn.microsoft.com/en-us/powershell/module/netconnection/set-netconnectionprofile)
- Verdict: **OK**. TWEAK the nmap line: "Run it twice or with `--script-args broadcast-dhcp-discover.timeout=20`; a rogue server may answer slower than the router. Expect exactly one 'Response 1 of 1' whose Server Identifier is the router. Windows has no equivalent one-liner: compare `ipconfig /all` → 'DHCP Server' on two PCs; if they differ, there are two servers."

### Inferences
- Because the script uses a fixed fake MAC, it does not consume a lease per run on most servers (the source says the static MAC is used "to prevent scope exhaustion" per NSEDoc summary).

### Gaps
- Microsoft's own page on Public/Private profiles could not be fetched; wording comes from the PowerShell doc snippet and secondary explainers.

---

## KQ7. Items the kit omits (DoH/DoT, router ad blocking, VLANs, Wi-Fi 7 MLO, NTP, config backup, EOL, reboot)

### Takeaway
Worth adding as optional rows: encrypted DNS at the router (ASUS "DNS Privacy Protocol" = DoT; UniFi "Encrypted DNS", formerly "DNS Shield", DoH only; eero only via eero Plus/custom DNS), a note that Apple devices warn when a network blocks encrypted DNS, VLAN/IoT-network names on prosumer gear, MLO guidance (KQ3.4), config-backup menu paths, EOL check and weekly reboot (KQ1). NTP and backup are already in the kit.

### Cited Findings
- Encrypted DNS, ASUS [Vendor]: FAQ "Does ASUS router support DNS over TLS (DNS Privacy Protocol)? How to set up?" — [ASUS FAQ 1051428](https://www.asus.com/support/faq/1051428/) (setting lives under WAN → Internet Connection → DNS → "DNS Privacy Protocol: DoT").
- Encrypted DNS, UniFi [Community][snippet]: "UniFi's DNS Shield/Encrypted DNS feature supports DoH only and has no support for DoT"; "Ubiquiti recently added a Custom option ... allowing users to configure any DoH service, including ... NextDNS and ControlD." — [Ubiquiti community: Encrypted DNS (formerly DNS Shield)](https://community.ui.com/questions/fd06cee3-60a3-45be-bb07-a052baeb3cb0)
- Encrypted DNS, eero [Vendor][snippet]: "Eero's built-in filtering (Eero Secure) uses its own DNS, and you need to disable Eero Secure to use alternative DNS services". — [eero: custom DNS](https://support.eero.com/hc/en-us/articles/360059988432-How-do-I-set-up-custom-DNS-servers-with-eero); Apple warns when "your network is blocking encrypted DNS traffic" — [Apple 102766](https://support.apple.com/en-us/102766) [Vendor][snippet]
- Router ad blocking [Vendor][snippet]: eero Plus features include "Advanced security, Ad Blocking, Content Filters" (lost in bridge mode). — [eero bridge-mode features](https://support.eero.com/hc/en-us/articles/115000825206-What-features-do-I-lose-if-I-put-my-eeros-in-bridge-mode)
- VLAN/IoT on prosumer gear: see KQ3.8 (UniFi Network/Client Isolation help; ASUS Guest Network Pro IoT).
- Config backup [Vendor][snippet]: ASUS "Administration > Restore/Save/Upload Setting ... 'Save setting' to download your current config file. The file downloads as a .CFG file"; Netgear "Advanced > Administration > Backup Settings, then click Back Up ... saved to your computer in a .cfg file"; on restore "you might need to reconnect your WiFi devices". — [ASUS FAQ 1001376](https://www.asus.com/support/faq/1001376/); [Netgear KB 19952](https://kb.netgear.com/19952/How-do-I-back-up-or-restore-the-settings-configured-on-my-NETGEAR-router)
- Wi-Fi 7 MLO: see KQ3.4.
- Verdict: **ADD** an "Optional" block to router-tuning.md:
  - "Encrypted DNS at the router (optional): ASUS WAN → DNS → 'DNS Privacy Protocol: DoT' with the same provider chosen above; UniFi Settings → Security (or Routing → DNS) → 'Encrypted DNS' (DoH; 'Custom' for NextDNS/ControlD); eero/Google/Netgear/TP-Link consumer: not available (eero Secure/Plus uses its own). Skip if a Pi-hole is the LAN DNS — encrypt on the Pi-hole instead. Verify: Apple devices stop showing the 'blocking encrypted DNS' warning; `nslookup` still resolves."
  - "Backup file names: ASUS Administration → Restore/Save/Upload Setting (.cfg); Netgear ADVANCED → Administration → Backup Settings (.cfg); TP-Link Advanced → System → Backup & Restore; UniFi Settings → System → Backups; eero/Google: none (settings are in the cloud account). Backup files usually restore only onto the same model/firmware line."
  - EOL check and weekly reboot: text in KQ1.5/1.7.

### Inferences
- The kit's Pi-hole clause interacts with DoH: browsers or devices using their own DoH bypass a Pi-hole; the note above prevents a later "ad blocking stopped working" ticket.

### Gaps
- Google Nest Wifi / TP-Link consumer DoH support: not surfaced; treated as unavailable.
- Synology SRM "Threat Prevention"/"Safe Access" and TP-Link "HomeShield" ad/threat blocking not researched (out of scope for the kit as written).
- No authoritative statement found that router .cfg backups are firmware-version-specific (vendor pages blocked); stated as inference.

---

## Consolidated list of edits for the kit (for the report writer)

router-tuning.md
1. §1 Remote management: soften "cloud management" (eero/Google are cloud-only). [TWEAK]
2. §1 UPnP: name what breaks (console NAT type, Plex Remote Access → forward 32400, IoT remote view, VoIP ATA). [TWEAK]
3. §1 add rows: SNMP off if present; weekly scheduled reboot (NSA). [ADD]
4. §2 Reservations: verify wording (release/renew). Add vendor menu names. [TWEAK]
5. §2 Local hostnames: replace with vendor table; state Netgear/TP-Link/eero/Google cannot; fall back to mDNS + ssh-config-gen. [FIX]
6. §2 DNS upstream: one provider's pair; 1.1.1.1 is unfiltered; do not mix filtered/unfiltered; say "forwarder". [FIX]
7. §2 IPv6: add helpdesk code and ICMPv6 note. [TWEAK]
8. §2 MTU: macOS `-D`, Windows `-f -l`, PPPoE test size 1464, +28 rule. [TWEAK]
9. §2 SIP ALG: vendor menu names, better verify. [TWEAK]
10. §2 QoS/NAT acceleration: bufferbloat exception with SQM names and the throughput cost. [FIX]
11. §3 Security: WPA3-Personal first, transition second, Compatibility Mode where offered, 6 GHz WPA3-only, named legacy offenders; drop or reword the "54 Mb/s" claim. [FIX]
12. §3 5 GHz: precise DFS timings, non-DFS 80 MHz sets, 160 MHz needs DFS. [TWEAK]
13. §3 add 6 GHz / PSC / MLO row. [ADD]
14. §3 add 802.11k/v/r row. [ADD]
15. §3 Transmit power / band steering / guest / isolation: vendor names and the wireless-to-wireless verify. [TWEAK]
16. §3 AP mode: same-system satellites already bridge; only separate router-class boxes need AP/bridge; eero bridge-mode cost; prefer wired backhaul. [TWEAK]
17. §4 Firmware: EOL check first, auto-update on. [ADD]
18. New "Optional" block: encrypted DNS, backup menu paths. [ADD]

network-triage.md
19. End state: "Bridge, or IP Passthrough (AT&T), or DMZ as last resort (still double NAT)". [TWEAK]
20. Double-NAT row: add CGNAT branch and the WAN-IP-vs-public-IP check. [FIX]
21. `ping nas` row: say which vendors cannot resolve names; `nas.local` first on those. [TWEAK]
22. Wi-Fi row: add "turn on 802.11k/v; 6 GHz if available". [TWEAK]
23. Rogue DHCP row: timeout arg, Windows `ipconfig /all` comparison. [TWEAK]

netscan.sh
24. Split `is_private` (RFC 1918) from `is_cgnat` (100.64.0.0/10); two distinct warnings; suggest the WAN-IP check in the message. [FIX]
25. Link-speed check: no change needed (pattern verified against 1000/2500 Mb/s strings). [OK]
