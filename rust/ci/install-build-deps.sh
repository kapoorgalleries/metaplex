#!/usr/bin/env bash
#
# Build dependencies for the Rust programs, on the ubuntu-latest runner.
#
# ubuntu-latest is Ubuntu 24.04 "noble". This script used to add an LLVM apt
# repository built for bionic (18.04) and install clang-7 and libssl1.1, none
# of which exist on noble. Both CI jobs died here:
#
#   E: Package 'clang-7' has no installation candidate
#   Process completed with exit code 100.
#
# The bionic repository is still alive and still resolves, so it was never the
# problem -- the packages simply are not published for noble. noble ships
# clang 14 through 20 in its own archive, so no third-party repository is
# needed at all now.
#
# libssl1.1 is gone from Ubuntu's archive for noble (it ships OpenSSL 3), and
# nothing in rust/Cargo.lock links against OpenSSL -- there is no openssl-sys
# in the dependency tree. It is still required, though: the prebuilt Solana
# v1.6.2 toolchain that solana-version.sh installs (solana, cargo-build-bpf,
# cargo-test-bpf, ...) was linked against libssl.so.1.1 and libcrypto.so.1.1
# in 2021, and without them every one of those binaries fails to start. The
# package is installed below from Ubuntu's focal security pocket, pinned to
# one exact build and verified by checksum. libssl-dev is kept because it is
# cheap and anything added later will expect it.
#
# binutils-dev and libunwind-dev are here for honggfuzz, which
# install-program-deps.sh builds. libudev-dev is for the Solana client crates.
# Neither is needed by the clippy job, which runs this script but not
# install-program-deps.sh.

set -ex

sudo apt-get update

# Installed as one transaction so that an unsatisfiable package names every
# failure at once, instead of stopping at the first and hiding the rest.
#
# --allow-unauthenticated is gone with the third-party repository that needed
# it; everything below comes from the signed Ubuntu archive.
sudo apt-get install -y \
  clang \
  openssl \
  libssl-dev \
  libudev-dev \
  binutils-dev \
  libunwind-dev

clang --version

# OpenSSL 1.1 runtime for the prebuilt Solana toolchain (see header). The
# package has no dependencies beyond libc6 and debconf, both present on every
# Ubuntu runner, so a plain dpkg -i is enough. Skipped when the library is
# already registered, so re-running this script is harmless.
if ! ldconfig -p | grep -q 'libssl\.so\.1\.1 '; then
  libssl_deb=libssl1.1_1.1.1f-1ubuntu2.24_amd64.deb
  libssl_url=https://security.ubuntu.com/ubuntu/pool/main/o/openssl/$libssl_deb
  libssl_sha256=7cf39d70a639017d1dd7c8d36daa2258063608688e449fddf40ffdd46f992a78
  libssl_tmp=$(mktemp -d)
  curl -sSfL --retry 5 --retry-delay 5 -o "$libssl_tmp/$libssl_deb" "$libssl_url"
  echo "$libssl_sha256  $libssl_tmp/$libssl_deb" | sha256sum --check
  sudo DEBIAN_FRONTEND=noninteractive dpkg -i "$libssl_tmp/$libssl_deb"
  rm -rf "$libssl_tmp"
fi

ldconfig -p | grep 'libssl\.so\.1\.1 '
