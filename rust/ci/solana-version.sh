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

if [[ -n $1 ]]; then
  case $1 in
  install)
    # Install the pinned release straight from its GitHub release page.
    #
    # This used to bootstrap through https://release.solana.com/$version/install,
    # a shell wrapper that downloads solana-install-init from GitHub, which
    # then downloads the release tarball from GitHub: for an explicit version
    # like v1.6.2, solana-install never reads release.solana.com at all
    # (install/src/command.rs, github_release_download_url -- the host is used
    # only for the edge/beta/stable channels). On PR #7's run the wrapper fetch
    # died in the TLS handshake (curl 35) and took the job with it. Fetching
    # the tarball directly drops that host, drops the installer's
    # unauthenticated api.github.com "is there a newer release" query, which
    # is rate-limited on shared runner IPs, and lets the download be pinned to
    # a digest, which solana-install does not do on this path.
    #
    # The layout matches what solana-install creates, so the PATH entry above
    # and the workflow's GITHUB_PATH line keep working:
    #   $HOME/.local/share/solana/install/releases/$version/solana-release/
    #   $HOME/.local/share/solana/install/active_release -> that directory
    #
    # The v1.6.2 release publishes no digest. The pin below is the sha256 of
    # the tarball as GitHub served it on 2026-09-07; the version.yml inside it
    # names the commit the v1.6.2 tag points at, which is checked after
    # extraction. So the pin catches corruption or substitution from now on,
    # not before.
    solana_release_root="${SOLANA_DOWNLOAD_ROOT:-https://github.com/solana-labs/solana/releases/download}"
    solana_release_target=x86_64-unknown-linux-gnu
    case $solana_version in
    v1.6.2)
      solana_release_sha256=e979bdf252d8b6cdb1a58b03c4d70692bd9368062223d9105b3e0cbb7419e2b5
      solana_release_commit=03b21f2e9d2eab604421c71fa8eb5faf26e30cc4
      ;;
    *)
      solana_release_sha256="$SOLANA_RELEASE_SHA256"
      solana_release_commit="$SOLANA_RELEASE_COMMIT"
      ;;
    esac
    if [[ -z $solana_release_sha256 || -z $solana_release_commit ]]; then
      echo "solana-version.sh: no pinned digest for $solana_version;" \
        "set SOLANA_RELEASE_SHA256 and SOLANA_RELEASE_COMMIT" >&2
      return 1 2>/dev/null || exit 1
    fi

    solana_install_dir="$HOME/.local/share/solana/install"
    solana_release_dir="$solana_install_dir/releases/$solana_version"
    solana_release_tarball="solana-release-$solana_release_target.tar.bz2"
    solana_release_url="$solana_release_root/$solana_version/$solana_release_tarball"

    if ! grep -qs "^commit: $solana_release_commit\$" "$solana_release_dir/solana-release/version.yml"; then
      rm -rf "$solana_release_dir"
      mkdir -p "$solana_release_dir"

      solana_curl_status=0
      curl -sSfL --retry 3 "$solana_release_url" -o "$solana_release_dir/$solana_release_tarball" \
        || solana_curl_status=$?
      if [[ $solana_curl_status -ne 0 ]]; then
        echo "solana-version.sh: could not download the Solana $solana_version release" >&2
        echo "solana-version.sh:   url:       $solana_release_url" >&2
        echo "solana-version.sh:   curl exit: $solana_curl_status" >&2
        rm -rf "$solana_release_dir"
        return 1 2>/dev/null || exit 1
      fi

      solana_release_actual_sha256=$(sha256sum "$solana_release_dir/$solana_release_tarball" | cut -d' ' -f1)
      if [[ $solana_release_actual_sha256 != "$solana_release_sha256" ]]; then
        echo "solana-version.sh: $solana_release_tarball does not match its pinned digest" >&2
        echo "solana-version.sh:   url:      $solana_release_url" >&2
        echo "solana-version.sh:   expected: $solana_release_sha256" >&2
        echo "solana-version.sh:   actual:   $solana_release_actual_sha256" >&2
        rm -rf "$solana_release_dir"
        return 1 2>/dev/null || exit 1
      fi

      solana_tar_status=0
      tar -xjf "$solana_release_dir/$solana_release_tarball" -C "$solana_release_dir" \
        || solana_tar_status=$?
      if [[ $solana_tar_status -ne 0 ]]; then
        echo "solana-version.sh: could not extract $solana_release_tarball (tar exit $solana_tar_status)" >&2
        rm -rf "$solana_release_dir"
        return 1 2>/dev/null || exit 1
      fi
      rm -f "$solana_release_dir/$solana_release_tarball"

      if ! grep -qs "^commit: $solana_release_commit\$" "$solana_release_dir/solana-release/version.yml"; then
        echo "solana-version.sh: extracted release is not built from commit $solana_release_commit:" >&2
        cat "$solana_release_dir/solana-release/version.yml" >&2
        rm -rf "$solana_release_dir"
        return 1 2>/dev/null || exit 1
      fi
    fi
    ln -sfn "$solana_release_dir/solana-release" "$solana_install_dir/active_release"

    # The 2021 binaries are dynamically linked, and on Ubuntu 24.04 they want
    # libssl.so.1.1 and libcrypto.so.1.1, which noble does not ship;
    # install-program-deps.sh provides them. Name the missing library instead
    # of letting `solana --version` die with the loader's exit 127.
    solana_missing_libs=$(
      for solana_bin in solana cargo-build-bpf cargo-test-bpf; do
        ldd "$solana_install_dir/active_release/bin/$solana_bin" 2>/dev/null | awk '/not found/ {print $1}'
      done | sort -u
    )
    if [[ -n $solana_missing_libs ]]; then
      echo "solana-version.sh: the $solana_version binaries need shared libraries this host lacks:" >&2
      echo "$solana_missing_libs" | sed 's/^/solana-version.sh:   /' >&2
      return 1 2>/dev/null || exit 1
    fi

    solana_version_output=$(solana --version)
    echo "$solana_version_output"
    if ! grep -q "src:${solana_release_commit:0:7}" <<<"$solana_version_output"; then
      echo "solana-version.sh: installed solana does not report commit ${solana_release_commit:0:7}" >&2
      return 1 2>/dev/null || exit 1
    fi
    ;;
  *)
    echo "$0: Note: ignoring unknown argument: $1" >&2
    ;;
  esac
fi
