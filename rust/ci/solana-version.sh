#
# This file maintains the solana versions for use by CI.
#
# Obtain the environment variables without any automatic updating:
#   $ source ci/solana-version.sh
#
# Obtain the environment variables and install update:
#   $ source ci/solana-version.sh install

# Then to access the solana version:
#   $ echo "$solana_version"
#

if [[ -n $SOLANA_VERSION ]]; then
  solana_version="$SOLANA_VERSION"
else
  solana_version=v1.6.2
fi

export solana_version="$solana_version"
export solana_docker_image=solanalabs/solana:"$solana_version"
export PATH="$HOME"/.local/share/solana/install/active_release/bin:"$PATH"

# SHA-256 of solana-release-x86_64-unknown-linux-gnu.tar.bz2 for each version
# this repo has been built against. The install below refuses to run without
# a checksum for the requested version: set SOLANA_RELEASE_SHA256 alongside
# SOLANA_VERSION when moving to a version that is not listed here.
solana_release_sha256() {
  case $1 in
  v1.6.2) echo e979bdf252d8b6cdb1a58b03c4d70692bd9368062223d9105b3e0cbb7419e2b5 ;;
  *) echo "${SOLANA_RELEASE_SHA256:-}" ;;
  esac
}

# Install the pinned release from its GitHub release asset.
#
# This used to be `sh -c "$(curl -sSfL https://release.solana.com/$v/install)"`.
# That host no longer completes a TLS handshake -- two CI runs fourteen hours
# apart (2026-09-06 13:36 UTC and 2026-09-07 03:37 UTC) both died with
# `curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL`, leaving `solana` absent
# and the build step skipped. The installer it served did nothing that needs
# that host: it fetched the release tarball from GitHub and unpacked it under
# ~/.local/share/solana/install. So this does the same, from the release asset
# that is still published, and verifies the download against the checksum
# above instead of trusting whatever a download host chooses to serve.
#
# The tarball is kept under ~/.cache/solana/<version>/, which the workflow
# already caches under the key solana-<version>, so a warm runner does not
# download the 285 MB archive at all. The unpack target is the directory the
# original installer used, so the PATH line above and the $GITHUB_PATH line in
# the workflow are unchanged.
#
# The 1.6.x binaries link OpenSSL 1.1 (libssl.so.1.1, libcrypto.so.1.1), which
# Ubuntu 24.04 no longer ships. install-build-deps.sh provides it; the
# `solana --version` at the end is the first command that would fail without it.
solana_install_release() {
  local version=$1
  local asset=solana-release-x86_64-unknown-linux-gnu.tar.bz2
  local url=https://github.com/solana-labs/solana/releases/download/$version/$asset
  local cache_dir=$HOME/.cache/solana/$version
  local tarball=$cache_dir/$asset
  local dest=$HOME/.local/share/solana/install/active_release
  local sha256
  sha256=$(solana_release_sha256 "$version")

  if [[ -z $sha256 ]]; then
    echo "solana-version.sh: no SHA-256 pinned for $version; set SOLANA_RELEASE_SHA256" >&2
    return 1
  fi

  mkdir -p "$cache_dir"

  # A cached tarball is only trusted if it still matches the checksum; a
  # partial or corrupted cache entry is discarded and fetched again.
  if [[ -f $tarball ]] && ! echo "$sha256  $tarball" | sha256sum --check --status; then
    echo "solana-version.sh: cached $asset does not match its checksum, refetching" >&2
    rm -f "$tarball"
  fi

  if [[ ! -f $tarball ]]; then
    echo "solana-version.sh: downloading $url" >&2
    curl -sSfL --retry 5 --retry-delay 5 -o "$tarball.part" "$url" || {
      rm -f "$tarball.part"
      return 1
    }
    mv "$tarball.part" "$tarball"
  fi

  echo "$sha256  $tarball" | sha256sum --check || {
    echo "solana-version.sh: checksum mismatch for $asset ($version); refusing to install" >&2
    rm -f "$tarball"
    return 1
  }

  rm -rf "$dest"
  mkdir -p "$dest"
  tar --extract --bzip2 --file "$tarball" --directory "$dest" --strip-components 1
}

if [[ -n $1 ]]; then
  case $1 in
  install)
    if solana_install_release "$solana_version"; then
      solana --version
    else
      echo "solana-version.sh: install of $solana_version failed" >&2
      false
    fi
    ;;
  *)
    echo "$0: Note: ignoring unknown argument: $1" >&2
    ;;
  esac
fi
