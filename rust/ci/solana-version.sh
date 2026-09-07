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
    # Download the installer to a file and check the transfer before running
    # anything. This used to be
    #
    #   sh -c "$(curl -sSfL https://release.solana.com/$solana_version/install)"
    #
    # which hides a failed download: when curl fails its stdout is empty, so
    # the substitution yields "" and `sh -c ""` exits 0 -- invisible to the
    # caller's `set -e`. The job then died one line later on
    # `solana: command not found`, exit 127, naming the wrong cause and
    # leaving curl's own error as the only clue.
    solana_installer_url="https://release.solana.com/$solana_version/install"
    solana_installer=$(mktemp)
    solana_curl_status=0
    curl -sSfL --retry 3 "$solana_installer_url" -o "$solana_installer" || solana_curl_status=$?
    if [[ $solana_curl_status -ne 0 ]]; then
      echo "solana-version.sh: could not download the Solana $solana_version installer" >&2
      echo "solana-version.sh:   url:       $solana_installer_url" >&2
      echo "solana-version.sh:   curl exit: $solana_curl_status" >&2
      rm -f "$solana_installer"
      return 1 2>/dev/null || exit 1
    fi
    if [[ ! -s $solana_installer ]] || ! head -n1 "$solana_installer" | grep -q '^#!.*sh'; then
      echo "solana-version.sh: $solana_installer_url did not return a shell script:" >&2
      head -c 300 "$solana_installer" >&2
      echo >&2
      rm -f "$solana_installer"
      return 1 2>/dev/null || exit 1
    fi
    sh "$solana_installer"
    rm -f "$solana_installer"
    solana --version
    ;;
  *)
    echo "$0: Note: ignoring unknown argument: $1" >&2
    ;;
  esac
fi
