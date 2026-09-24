# Trimurti network status

Fill this in during the Cowork session. It is the record of what was found and what was changed. `verify.sh` prints the machine table ready to paste.

## What Trimurti is

- [ ] tailnet   - [ ] naming/access convention   - [ ] workgroup/domain   - [ ] a server
Notes:

## Network

| Item | Before | After |
|---|---|---|
| ISP box mode (routing / bridge) | | |
| Router make, model, firmware | | |
| Subnet | | |
| DHCP servers seen (should be 1) | | |
| DHCP pool | | |
| DNS handed to clients | | |
| Double NAT (netscan) | | |
| Wi-Fi nodes in AP mode (list) | | |
| Rogue DHCP found | | |

Router decisions (each ASK item in `checklists/router-tuning.md`):

| Item | Decision | Date |
|---|---|---|
| | | |

DHCP reservations set (name → MAC → IP):

| name | MAC | IP |
|---|---|---|
| | | |

## Machines

Paste the latest `out/verify-*.md` table here and keep it current.

| host | ping | ssh key | claude | codex | gemini | node | os |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

Signed in (per machine: claude / codex / gemini):

| host | claude | codex | gemini | OS updated | rebooted | NAS share | in Trimurti |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## NAS

- Vendor / model / OS version:
- Reachable at (IP, reserved?):
- Volume state before / after:
- What was wrong:
- What was done:
- SSH enabled with key:  [ ]   2FA on admin:  [ ]   UPnP/QuickConnect off:  [ ]   snapshots:  [ ]   USB backup task:  [ ]

## Hulk drives

| serial | model | size | verdict | what was on it | data moved to | now used for |
|---|---|---|---|---|---|---|
| | | | | | | |

## Open items

- 
