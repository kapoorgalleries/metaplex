#!/usr/bin/env bash

set -e

source ci/rust-version.sh stable

# The prebuilt Solana v1.6.2 binaries that solana-version.sh installs are
# dynamically linked against OpenSSL 1.1:
#
#   $ ldd solana-release/bin/solana
#           libssl.so.1.1 => not found
#           libcrypto.so.1.1 => not found
#
# and so are cargo-build-bpf and solana-test-validator. Ubuntu 24.04 ships
# OpenSSL 3 only; libssl1.1 has no installation candidate in its archive, so
# the `apt-get install libssl1.1` that install-build-deps.sh used to do could
# not have worked on noble either. Take the package from the Ubuntu 20.04
# (focal) security pocket, pinned to the digest its Packages index publishes.
# It depends only on libc6 >= 2.25 and installs alongside libssl3.
if ! ldconfig -p | grep -q 'libssl\.so\.1\.1 '; then
  libssl_deb=libssl1.1_1.1.1f-1ubuntu2.24_amd64.deb
  libssl_url="https://security.ubuntu.com/ubuntu/pool/main/o/openssl/$libssl_deb"
  libssl_sha256=7cf39d70a639017d1dd7c8d36daa2258063608688e449fddf40ffdd46f992a78
  libssl_tmp=$(mktemp -d)
  echo "Installing $libssl_deb from $libssl_url"
  curl -sSfL --retry 3 "$libssl_url" -o "$libssl_tmp/$libssl_deb"
  echo "$libssl_sha256  $libssl_tmp/$libssl_deb" | sha256sum -c -
  sudo env DEBIAN_FRONTEND=noninteractive dpkg -i "$libssl_tmp/$libssl_deb"
  rm -rf "$libssl_tmp"
fi

source ci/solana-version.sh install

set -x

cargo --version
cargo install rustfilt || true
cargo install honggfuzz --version=0.5.52 --force || true

cargo +"$rust_stable" build-bpf --version
