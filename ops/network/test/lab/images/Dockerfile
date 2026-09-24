# syntax=docker/dockerfile:1
#
# Images for the simulated gallery LAN. ../lab.sh builds one --target per host type and
# tags it trimurti-lab/<name>. Build inputs:
#   - named build context "labca": a directory holding proxy-ca.crt, the CA bundle of the
#     TLS-intercepting HTTPS proxy (lab.sh copies it from the host);
#   - https_proxy / HTTPS_PROXY build args (predefined ARGs: they reach RUN, not the image);
#   - builds run with --network host so RUN can reach the host's proxy on 127.0.0.1.
# Per-lab settings (proxy address, no_proxy) are applied at container start by lab-init.
#
# Debian 12, Fedora 41 and Arch each have a "native" target (packages from the distro
# mirrors) and a "fallback" target for networks where those mirrors are unreachable: the
# base image's own packages plus OpenSSH (and sudo on Debian) built from pristine upstream
# tarballs that are fetched from the Ubuntu archive. lab.sh picks one per distro.

ARG REG=mirror.gcr.io/library
ARG DEBIAN_MIRROR=https://deb.debian.org
ARG ARCH_MIRROR=https://geo.mirror.pkgbuild.com

############################################################################ Ubuntu 24.04
FROM ${REG}/ubuntu:24.04 AS ubuntu-base
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=labca proxy-ca.crt /usr/local/share/lab/proxy-ca.crt
RUN set -eu; \
    sed -i 's#http://#https://#g' /etc/apt/sources.list.d/ubuntu.sources; \
    ca=/usr/local/share/lab/proxy-ca.crt; \
    apt-get -o Acquire::https::CAInfo=$ca update -qq; \
    apt-get -o Acquire::https::CAInfo=$ca install -y -qq --no-install-recommends \
      ca-certificates curl sudo iproute2 iputils-ping procps less vim-tiny bash-completion >/dev/null; \
    userdel -r ubuntu 2>/dev/null || true
COPY files/scripts/lab-ca-install files/scripts/lab-user-setup files/scripts/lab-systemd-prep /usr/local/sbin/
RUN set -eu; lab-ca-install

# ---------------------------------------------------------------- admin machine (.10)
FROM ubuntu-base AS admin
# sshpass and expect are test drivers only: a real admin machine does not have them.
RUN set -eu; apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends \
      openssh-client git netcat-openbsd smbclient jq bsdextrautils file sshpass expect >/dev/null; \
    lab-user-setup sudo password; \
    sed -i 's#^PATH="#PATH="/opt/node22/bin:#' /etc/environment
ENV PATH=/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LAB_INIT=cmd
LABEL trimurti-lab.init=cmd trimurti-lab.sudo=password trimurti-lab.note="admin machine; kit at /kit; node 22 from /opt/node22 (read-only); sshpass+expect are lab-only"
COPY files/scripts/lab-init /usr/local/sbin/
ENTRYPOINT ["/usr/local/sbin/lab-init"]
CMD ["sleep", "infinity"]

# ---------------------------------------------------------------- Ubuntu desktops (systemd)
FROM ubuntu-base AS ubuntu-systemd
RUN set -eu; apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends systemd systemd-sysv dbus libpam-systemd >/dev/null; \
    lab-systemd-prep; \
    lab-user-setup sudo nopasswd
ENV container=docker LAB_INIT=systemd
STOPSIGNAL SIGRTMIN+3

# new-pc-2 (.25): no openssh-server; the kit's enable-ssh-server.sh has to install it
FROM ubuntu-systemd AS ubuntu-nossh
RUN set -eu; apt-get update -qq; apt-get install -y -qq --no-install-recommends openssh-client >/dev/null
LABEL trimurti-lab.init=systemd trimurti-lab.sudo=nopasswd trimurti-lab.note="Ubuntu 24.04; systemd; openssh-server NOT installed"
COPY files/scripts/lab-init /usr/local/sbin/
ENTRYPOINT ["/usr/local/sbin/lab-init"]

# ubuntu-desk (.21): stock Ubuntu openssh-server (socket-activated, as Ubuntu ships it)
FROM ubuntu-systemd AS ubuntu-desk
RUN set -eu; apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends openssh-server openssh-client >/dev/null; \
    rm -f /etc/ssh/ssh_host_*
LABEL trimurti-lab.init=systemd trimurti-lab.sudo=nopasswd trimurti-lab.note="Ubuntu 24.04; systemd; stock openssh-server (ssh.socket)"
COPY files/scripts/lab-init /usr/local/sbin/
ENTRYPOINT ["/usr/local/sbin/lab-init"]

# ---------------------------------------------------------------- NAS (.30)
FROM ubuntu-base AS nas
RUN set -eu; apt-get update -qq; apt-get install -y -qq --no-install-recommends samba python3 openssl >/dev/null
COPY files/nas/smb.conf /etc/samba/smb.conf
COPY files/nas/dsm.py files/nas/index.html /usr/local/lib/lab-nas/
RUN set -eu; \
    useradd -m -s /bin/false gallery; \
    echo 'gallery:lab-pass-1' | chpasswd; \
    printf 'lab-pass-1\nlab-pass-1\n' | smbpasswd -s -a gallery >/dev/null; \
    mkdir -p /srv/gallery/Exhibitions /srv/gallery/Scans; \
    echo 'Simulated NAS share of the trimurti lab. Test data only.' > /srv/gallery/README.txt; \
    echo 'Spring 2026: lab placeholder' > /srv/gallery/Exhibitions/spring-2026.txt; \
    chown -R gallery:gallery /srv/gallery; \
    testparm -s >/dev/null 2>&1
ENV LAB_INIT=nas
LABEL trimurti-lab.init=nas trimurti-lab.sudo=none trimurti-lab.note="Synology-like: SMB share gallery (SMB2+ only; signing mandatory; no guest); DSM page on 5000/5001; no sshd"
COPY files/scripts/lab-init /usr/local/sbin/
ENTRYPOINT ["/usr/local/sbin/lab-init"]

############################################################################ upstream builds
# OpenSSH and sudo from the pristine upstream tarballs (the .orig.tar.gz files in the Ubuntu
# archive are byte-identical to the upstream releases; the SHA-256 below are upstream's).
# Built on Ubuntu 22.04 (glibc 2.35) so the binaries run on Debian 12, Fedora 41 and Arch.
# libcrypto, libcrypt and zlib are linked statically: only libc and libpam stay dynamic,
# because Fedora and Arch ship libcrypt.so.2 where Ubuntu 22.04 links libcrypt.so.1.
FROM ${REG}/ubuntu:22.04 AS srcbuild
ARG OPENSSH_VERSION=9.6p1
ARG OPENSSH_SHA256=910211c07255a8c5ad654391b40ee59800710dd8119dd5362de09385aa7a777c
ARG SUDO_VERSION=1.9.15p5
ARG SUDO_SHA256=558d10b9a1991fb3b9fa7fa7b07ec4405b7aefb5b3cb0b0871dbc81e3a88e558
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=labca proxy-ca.crt /usr/local/share/lab/proxy-ca.crt
RUN set -eu; \
    sed -i 's#http://#https://#g' /etc/apt/sources.list; \
    ca=/usr/local/share/lab/proxy-ca.crt; \
    apt-get -o Acquire::https::CAInfo=$ca update -qq; \
    apt-get -o Acquire::https::CAInfo=$ca install -y -qq --no-install-recommends \
      build-essential libpam0g-dev libssl-dev zlib1g-dev libcrypt-dev curl ca-certificates >/dev/null; \
    m="$(gcc -print-multiarch)"; \
    test -f /usr/lib/$m/libcrypto.a; test -f /usr/lib/$m/libcrypt.a; test -f /usr/lib/$m/libz.a; \
    rm -f /usr/lib/$m/libcrypto.so /usr/lib/$m/libssl.so /usr/lib/$m/libcrypt.so /usr/lib/$m/libz.so
WORKDIR /src
RUN set -eu; \
    pool=https://archive.ubuntu.com/ubuntu/pool/main; \
    curl -fsSL --cacert /usr/local/share/lab/proxy-ca.crt -o openssh.tgz "$pool/o/openssh/openssh_${OPENSSH_VERSION}.orig.tar.gz"; \
    echo "$OPENSSH_SHA256  openssh.tgz" | sha256sum -c - >/dev/null; \
    tar xzf openssh.tgz; cd "openssh-$OPENSSH_VERSION"; \
    ./configure --prefix=/usr --sysconfdir=/etc/ssh --libexecdir=/usr/lib/openssh \
      --with-privsep-path=/run/sshd --with-privsep-user=sshd --with-pid-dir=/run --with-pam \
      --with-default-path=/usr/local/bin:/usr/bin:/bin \
      --with-superuser-path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin >/dev/null; \
    make -j"$(nproc)" >/dev/null 2>&1; \
    make install-nokeys DESTDIR=/out/openssh >/dev/null; \
    rm -f /out/openssh/etc/ssh/sshd_config; rm -rf /out/openssh/run; \
    if ldd /out/openssh/usr/sbin/sshd | grep -E 'libcrypto|libcrypt\.so|libz\.so'; then exit 1; fi; \
    tar -C /out/openssh -cf /out/openssh.tar .
RUN set -eu; \
    pool=https://archive.ubuntu.com/ubuntu/pool/main; \
    curl -fsSL --cacert /usr/local/share/lab/proxy-ca.crt -o sudo.tgz "$pool/s/sudo/sudo_${SUDO_VERSION}.orig.tar.gz"; \
    echo "$SUDO_SHA256  sudo.tgz" | sha256sum -c - >/dev/null; \
    tar xzf sudo.tgz; cd "sudo-$SUDO_VERSION"; \
    ./configure --prefix=/usr --libexecdir=/usr/libexec --sysconfdir=/etc --with-pam --with-pam-login \
      --with-rundir=/run/sudo --with-vardir=/var/lib/sudo --with-logfac=authpriv --with-env-editor \
      --with-editor=/usr/bin/editor:/usr/bin/vi --without-sendmail --disable-nls \
      --with-secure-path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin >/dev/null; \
    make -j"$(nproc)" >/dev/null 2>&1; \
    make install DESTDIR=/out/sudo >/dev/null; \
    rm -rf /out/sudo/usr/share/doc /out/sudo/run /out/sudo/etc/sudoers; \
    tar -C /out/sudo -cf /out/sudo.tar .

############################################################################ Debian 12
FROM ${REG}/buildpack-deps:bookworm-curl AS debian-base
ENV DEBIAN_FRONTEND=noninteractive container=docker
COPY --from=labca proxy-ca.crt /usr/local/share/lab/proxy-ca.crt
COPY files/scripts/lab-ca-install files/scripts/lab-user-setup files/scripts/lab-systemd-prep files/scripts/lab-openssh-install /usr/local/sbin/
RUN set -eu; lab-ca-install

FROM debian-base AS debian-native
ARG DEBIAN_MIRROR
RUN set -eu; \
    sed -i "s#http://deb.debian.org#${DEBIAN_MIRROR}#g" /etc/apt/sources.list.d/debian.sources; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends systemd systemd-sysv dbus libpam-systemd \
      openssh-server openssh-client sudo iproute2 iputils-ping procps less vim-tiny >/dev/null; \
    rm -f /etc/ssh/ssh_host_*; \
    lab-systemd-prep; \
    lab-user-setup sudo nopasswd
ENV LAB_INIT=systemd
STOPSIGNAL SIGRTMIN+3
LABEL trimurti-lab.init=systemd trimurti-lab.sudo=nopasswd trimurti-lab.note="Debian 12; systemd; distro openssh-server"
COPY files/scripts/lab-init /usr/local/sbin/
ENTRYPOINT ["/usr/local/sbin/lab-init"]

FROM debian-base AS debian-fallback
RUN set -eu; sed -i 's#http://deb.debian.org#https://deb.debian.org#g' /etc/apt/sources.list.d/debian.sources
COPY --from=srcbuild /out/openssh.tar /out/sudo.tar /tmp/lab/
COPY files/openssh/ /tmp/lab/openssh/
COPY files/pam/ /tmp/lab/pam/
COPY files/sudo/ /tmp/lab/sudo/
RUN set -eu; \
    tar -C / --keep-directory-symlink --no-overwrite-dir -xf /tmp/lab/sudo.tar; \
    install -m 0440 /tmp/lab/sudo/sudoers-debian /etc/sudoers; \
    install -m 0644 /tmp/lab/pam/sudo-debian /etc/pam.d/sudo; \
    install -m 0644 /tmp/lab/pam/sudo-i-debian /etc/pam.d/sudo-i; \
    mkdir -p /etc/sudoers.d /var/lib/sudo; chmod 0750 /etc/sudoers.d; \
    lab-openssh-install debian; \
    lab-user-setup sudo nopasswd; \
    rm -rf /tmp/lab
ENV LAB_INIT=sshd
LABEL trimurti-lab.init=sshd trimurti-lab.sudo=nopasswd trimurti-lab.note="Debian 12; no systemd (sshd is PID 1); OpenSSH+sudo built from upstream source: Debian mirrors unreachable"
COPY files/scripts/lab-init /usr/local/sbin/
ENTRYPOINT ["/usr/local/sbin/lab-init"]

############################################################################ Fedora 41
FROM ${REG}/fedora:41 AS fedora-base
ENV container=docker
COPY --from=labca proxy-ca.crt /usr/local/share/lab/proxy-ca.crt
COPY files/scripts/lab-ca-install files/scripts/lab-user-setup files/scripts/lab-systemd-prep files/scripts/lab-openssh-install /usr/local/sbin/
RUN set -eu; lab-ca-install

FROM fedora-base AS fedora-native
RUN set -eu; \
    sed -i 's#^\(metalink=.*\)$#\1\&protocol=https#' /etc/yum.repos.d/*.repo; \
    dnf -y -q install systemd openssh-server openssh-clients sudo util-linux iproute iputils procps-ng \
      hostname passwd less >/dev/null; \
    rm -f /etc/ssh/ssh_host_*; \
    systemctl enable sshd.service; \
    lab-systemd-prep; \
    lab-user-setup wheel nopasswd
ENV LAB_INIT=systemd
STOPSIGNAL SIGRTMIN+3
LABEL trimurti-lab.init=systemd trimurti-lab.sudo=nopasswd trimurti-lab.note="Fedora 41; systemd; distro openssh-server"
COPY files/scripts/lab-init /usr/local/sbin/
ENTRYPOINT ["/usr/local/sbin/lab-init"]

FROM fedora-base AS fedora-fallback
RUN set -eu; sed -i 's#^\(metalink=.*\)$#\1\&protocol=https#' /etc/yum.repos.d/*.repo
COPY --from=srcbuild /out/openssh.tar /tmp/lab/
COPY files/openssh/ /tmp/lab/openssh/
COPY files/pam/ /tmp/lab/pam/
RUN set -eu; \
    lab-openssh-install fedora; \
    lab-user-setup wheel nopasswd; \
    rm -rf /tmp/lab
ENV LAB_INIT=sshd
LABEL trimurti-lab.init=sshd trimurti-lab.sudo=nopasswd trimurti-lab.note="Fedora 41; no systemd (sshd is PID 1); distro sudo; OpenSSH built from upstream source: Fedora mirrors unreachable"
COPY files/scripts/lab-init /usr/local/sbin/
ENTRYPOINT ["/usr/local/sbin/lab-init"]

############################################################################ Arch Linux
# base-devel: the base image plus the base-devel group, which brings the distro's sudo.
FROM ${REG}/archlinux:base-devel AS arch-base
ENV container=docker
COPY --from=labca proxy-ca.crt /usr/local/share/lab/proxy-ca.crt
COPY files/scripts/lab-ca-install files/scripts/lab-user-setup files/scripts/lab-systemd-prep files/scripts/lab-openssh-install /usr/local/sbin/
RUN set -eu; lab-ca-install

FROM arch-base AS arch-native
ARG ARCH_MIRROR
RUN set -eu; \
    printf 'Server = %s/$repo/os/$arch\n' "$ARCH_MIRROR" > /etc/pacman.d/mirrorlist; \
    pacman -Syu --noconfirm --needed openssh inetutils >/dev/null; \
    rm -f /etc/ssh/ssh_host_*; \
    systemctl enable sshd.service; \
    lab-systemd-prep; \
    lab-user-setup wheel password
ENV LAB_INIT=systemd
STOPSIGNAL SIGRTMIN+3
LABEL trimurti-lab.init=systemd trimurti-lab.sudo=password trimurti-lab.note="Arch Linux; systemd; distro openssh; sudo asks for the password"
COPY files/scripts/lab-init /usr/local/sbin/
ENTRYPOINT ["/usr/local/sbin/lab-init"]

FROM arch-base AS arch-fallback
COPY --from=srcbuild /out/openssh.tar /tmp/lab/
COPY files/openssh/ /tmp/lab/openssh/
COPY files/pam/ /tmp/lab/pam/
RUN set -eu; \
    lab-openssh-install arch; \
    systemctl enable sshd.service; \
    lab-systemd-prep; \
    lab-user-setup wheel password; \
    rm -rf /tmp/lab
ENV LAB_INIT=systemd
STOPSIGNAL SIGRTMIN+3
LABEL trimurti-lab.init=systemd trimurti-lab.sudo=password trimurti-lab.note="Arch Linux; systemd; distro sudo (asks for the password); OpenSSH built from upstream source: Arch mirrors unreachable"
COPY files/scripts/lab-init /usr/local/sbin/
ENTRYPOINT ["/usr/local/sbin/lab-init"]
