# Simulated gallery LAN

A throwaway LAN in Docker for testing the Trimurti network kit (`ops/network`) before it meets real machines. One command starts a /24 with an admin machine, four Linux desktops, a fresh "new" PC without an SSH server, a Synology-like NAS and a router tripwire. Each lab gets its own copy of the kit, so tests never touch the repo.

## Run it

```bash
cd ops/network/test/lab
./lab.sh up smoke 90                 # 192.168.90.0/24; builds images the first time (~4 min), then ~15 s
./lab.sh check smoke                 # self-test, PASS/FAIL per item, exit 1 on any failure
./lab.sh exec smoke admin -u gallery # shell on the admin machine; the kit is at /kit
./lab.sh inventory smoke             # ground-truth inventory.csv rows with the real MACs
./lab.sh status [smoke]              # all labs, or one lab's host table and tripwire log
./lab.sh down smoke                  # removes containers, network, forwarder, tripwire, state
```

- `exec <name> <host> [-u USER] [cmd...]` wraps `docker exec -i` (adds `-t` on a terminal) and runs `bash -l` when no command is given. It reads stdin, so a kit script can be run on a host as a local user would run it: `./lab.sh exec smoke new-pc-2 -u gallery bash -s < state/smoke/kit/scripts/enable-ssh-server.sh`.
- `up` is idempotent: it keeps running containers and the existing kit copy. `down` works on a half-built lab and on one that does not exist. Several labs can run at once on different octets.
- Needs Docker, python3 and curl on the host. `LAB_UPSTREAM_PROXY` (default: taken from `HTTPS_PROXY`) and `LAB_CA_FILE` (default `/root/.ccr/ca-bundle.crt`) point at the HTTPS proxy and its CA.
- State lives in `state/<name>/`, which git ignores: `lab.env`, `kit/` (mounted at `/kit` in admin, owned by gallery), `router-tripwire.log`, and the forwarder and tripwire pid and log files. Build logs are in `state/.cache/`.

## Hosts

Every Linux host has the user `gallery` with password `lab-pass-1` (a test-only password).

| host | IP | system | SSH at start | sudo for gallery |
|---|---|---|---|---|
| router | .1 | the Docker bridge on the host. HTTPS proxy on :3128. Tripwire on :22 and :23 | tripwire only | never log in |
| admin | .10 | Ubuntu 24.04. Kit at `/kit`, node 22 (host `/opt/node22`, read-only). Has openssh-client, git, curl, smbclient, jq, nc and `sshpass`/`expect` (lab-only test drivers) | client only | asks for password |
| ubuntu-desk | .21 | Ubuntu 24.04, systemd 255, stock openssh-server (`ssh.socket`) | yes | no password |
| debian-pc | .22 | Debian 12, no systemd: sshd runs as the container's main process | yes | no password |
| fedora-pc | .23 | Fedora 41, no systemd: sshd runs as the container's main process | yes | no password |
| arch-pc | .24 | Arch Linux, systemd 261, `sshd.service` | yes | asks for password |
| new-pc-2 | .25 | Ubuntu 24.04, systemd 255, **no openssh-server** (`enable-ssh-server.sh` must install it) | no | no password |
| nas | .30 | Samba share `gallery` (gallery only, no guest, SMB2+ only, signing required, anonymous listing refused), DSM-like page "Synology DiskStation" on :5000 and :5001 (self-signed). MAC uses Synology's OUI 00:11:32 | no sshd | no shell |

Every host has `https_proxy`, `no_proxy` (the lab subnet) and `NODE_EXTRA_CA_CERTS` in `/etc/environment`. Non-interactive SSH sessions get these through pam_env. The proxy CA is in each system trust store. apt and dnf have the proxy in their config. sudo keeps these variables.

**Router tripwire.** Each connection to .1:22 or .1:23 appends `<UTC time> <src_ip>:<port> -> <port>` to `state/<name>/router-tripwire.log`. If the client sent data first, it also appends `first-bytes="..."`. So an SSH attempt shows `first-bytes="SSH-2.0-..."`, and a bare port probe (netscan) has no suffix. A source outside the lab subnet is the Docker host itself (`lab.sh check`).

## Limitations

- **Package mirrors.** This environment's egress policy denies the Debian, Fedora and Arch mirrors (and deb.nodesource.com) with 403. So debian-pc, fedora-pc and arch-pc are built from their official base images plus OpenSSH 9.6p1 built from source, and on Debian sudo 1.9.15p5 too. Those sources are the pristine upstream tarballs, fetched from the Ubuntu archive and checked against pinned SHA-256 sums. On those three hosts, `apt`/`dnf`/`pacman` fail with the proxy's 403. Only the Ubuntu hosts can install packages. `lab.sh` probes the mirrors (the result is cached for 12 h) and builds the `*-native` Dockerfile targets where the mirrors are reachable. Those targets could not be tested here. `LAB_DISTRO_MODE=native|fallback` forces a choice.
- **No systemd on debian-pc and fedora-pc**, because systemd cannot be installed there without the mirrors. `systemctl` and `journalctl` are missing, so `enable-ssh-server.sh` and `--harden` stop at `systemctl` on those two hosts.
- **Containers, not machines.** Every container shares the host kernel, so `uname -r` is the host's, and on Arch `update-all.sh` therefore always reports a reboot as needed. Other gaps:
  - rebooting stops the container;
  - no disks or SMART, so no Hulk drives;
  - no firewall;
  - no Windows or macOS hosts;
  - no DHCP server, Wi-Fi or double NAT;
  - one flat L2 segment;
  - the veth link reports 10000 Mb/s;
  - IPv6 is off;
  - no mDNS or NetBIOS names: Docker's DNS resolves only `lab-<name>-<host>`, not the short names.
- The systemd hosts run `--privileged`. On this cgroup-v1 host, `lab-init` gives systemd its own cgroup2 subtree, which systemd ≥ 256 requires. Units that would reach the host (udev, sysctl, binfmt, module loading, getty, fstrim) are masked. Package scripts that try to restart them print a harmless "Unit ... is masked".
- The router is only a bridge IP. It has no web UI and no DHCP or DNS settings to tune, and ports other than 22 and 23 are closed. The NAS has no DSM API, volumes, snapshots or SSH.
- **Internet.** Only HTTPS through the proxy works. Plain `http://` and hosts the policy denies fail. Tools that ignore `https_proxy` (such as Node's built-in fetch without `NODE_USE_ENV_PROXY=1`) get no internet. If the host's proxy port changes, run `up` again: it restarts the forwarder with the new port.
- **admin.** `/opt/node22` is the host's Node, read-only, with the host's global npm tools. Its `claude` link is dangling. `npm -g` needs a user prefix (the kit switches to `~/.npm-global` by itself). `sshpass` and `expect` exist only to drive tests. The admin has no sshd.
