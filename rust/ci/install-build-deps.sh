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
# libssl1.1 is gone from Ubuntu entirely (noble ships OpenSSL 3). Nothing in
# rust/Cargo.lock links against OpenSSL -- there is no openssl-sys in the
# dependency tree -- so it is dropped rather than replaced. libssl-dev is kept
# because it is cheap and anything added later will expect it.
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
