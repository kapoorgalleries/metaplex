#!/usr/bin/env bash

set -e

source ci/rust-version.sh stable
source ci/solana-version.sh install

set -x

cargo --version

# `cargo install rustfilt` used to run here under `|| true`. It has never
# succeeded on the pinned cargo 1.50.0: rustfilt is unpinned, so it resolves to
# 0.2.1, whose dependency tree now declares `edition = "2021"` -- which cargo
# 1.50 cannot parse ("this version of Cargo is older than the `2021` edition").
# `--locked` does not help; rustfilt's own lockfile pulls the same crates. It
# cost ~100 s of crates.io index update per run to fail.
#
# Nothing in this pipeline needs it. rustfilt is used by exactly one thing in
# the BPF SDK, sdk/bpf/scripts/dump.sh, which cargo-build-bpf spawns only when
# passed --dump. Neither cargo-build-test.sh nor the workflow passes it, and
# the disassembly dump.sh produces is a debugging aid, not a build output.
# Restore this line (pinned to a version cargo 1.50 can build) if --dump is
# ever wanted in CI.
cargo install honggfuzz --version=0.5.52 --force || true

cargo +"$rust_stable" build-bpf --version
