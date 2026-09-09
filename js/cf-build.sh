#!/usr/bin/env bash
#
# Cloudflare Workers Builds - build entrypoint for the `web` app.
#
# Invoked by the [build] section of wrangler.toml, which Workers Builds runs as
#     [custom build] Running: bash ./js/cf-build.sh
# ahead of the deploy. No dashboard Build command is needed; if one is set it
# runs this script a second time, which is harmless but slow -- leave it empty.
#
# It is also safe to run by hand from a clean checkout, from any directory:
#     bash js/cf-build.sh
#
# Produces: js/build/web   (index.html + static/{js,css,media})
#
set -euo pipefail

# Always operate from the directory this script lives in (the yarn workspace
# root), regardless of the caller's cwd.
cd "$(dirname "${BASH_SOURCE[0]}")"

# ---------------------------------------------------------------------------
# yarn must be 1.x, everywhere, including inside child processes.
#
# This workspace is yarn 1: js/yarn.lock is a "yarn lockfile v1" that yarn 4
# cannot consume, and lerna.json sets "npmClient": "yarn", so lerna shells out
# to whatever `yarn` it finds.
#
# The build image provides yarn through a corepack shim in the node binary's
# directory, and with no `packageManager` field that shim resolved to yarn 4.
# Simply putting a yarn 1 earlier on PATH is not enough: yarn 1's own `yarn run`
# prepends the node binary's directory to PATH for every script it launches, so
# `yarn bootstrap` -> lerna -> `yarn install --mutex ...` picked up yarn 4 and
# died with `Unsupported option name ("--mutex")`.
#
# Three layers, so no single mechanism has to hold:
#   1. package.json declares "packageManager": "yarn@1.22.22", so the corepack
#      shim itself resolves to yarn 1. This is the real fix.
#   2. If the yarn on PATH still is not 1.x (no corepack), install yarn 1 into a
#      temp prefix and put it first on PATH.
#   3. lerna is invoked by path below, not via `yarn run`, so the one child that
#      shells out to bare `yarn` never runs under a yarn-1-rewritten PATH.
# ---------------------------------------------------------------------------
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0   # let the shim fetch yarn 1 non-interactively

YARN_PIN="1.22.22"
if [ "$(yarn --version 2>/dev/null | cut -d. -f1)" != "1" ]; then
  echo "==> pinning yarn ${YARN_PIN} (found: $(yarn --version 2>/dev/null || echo 'no yarn on PATH'))"
  YARN_HOME="$(mktemp -d)"
  npm install --no-save --no-audit --no-fund --prefix "$YARN_HOME" "yarn@${YARN_PIN}" >/dev/null
  export PATH="${YARN_HOME}/node_modules/.bin:${PATH}"
fi

# Guard for layer 3's blind spot: whatever `yarn` sits next to `node` is what a
# `yarn run` child sees first. If it is still not 1.x, drop corepack's shim so
# the PATH pin wins there too; if that leaves a non-corepack yarn 4, say so.
NODE_BIN_DIR="$(dirname "$(command -v node)")"
if [ -e "$NODE_BIN_DIR/yarn" ] && [ "$("$NODE_BIN_DIR/yarn" --version 2>/dev/null | cut -d. -f1)" != "1" ]; then
  echo "==> yarn beside node is $("$NODE_BIN_DIR/yarn" --version 2>/dev/null); removing corepack shim"
  corepack disable yarn 2>/dev/null || true
  if [ -e "$NODE_BIN_DIR/yarn" ]; then
    echo "==> WARNING: $NODE_BIN_DIR/yarn is not corepack-managed and is not yarn 1; scripts launched via 'yarn run' may see it"
  fi
fi

# react-scripts 3.4.3 pulls webpack 4.42.0, which hashes modules with md4.
# OpenSSL 3 (Node >= 17) removed md4 from the default provider, so without this
# flag the build dies with:
#   Error: error:0308010C:digital envelope routines::unsupported
#   (ERR_OSSL_EVP_UNSUPPORTED) at webpack/lib/util/createHash.js
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--openssl-legacy-provider"

# create-react-app treats every ESLint warning as a fatal error when CI is
# truthy. Workers Builds sets CI=true and this app has ~50 pre-existing
# warnings, so the build would fail to compile. Must be exported, not just
# assigned -- a bare `CI=false && yarn build` never reaches the child process.
export CI=false

echo "==> node $(node -v) / yarn $(yarn --version) / NODE_OPTIONS=$NODE_OPTIONS"

# Workers Builds installs dependencies automatically only when it detects a
# lockfile at the configured Root directory, which is the repo root here and
# has none. So install explicitly; this also makes the script work standalone.
echo "==> yarn install"
yarn install --frozen-lockfile --network-timeout 600000

# Invoked by path, not `yarn bootstrap`: see layer 3 above.
echo "==> lerna link/bootstrap"
./node_modules/.bin/lerna link
./node_modules/.bin/lerna bootstrap

# @oyster/common's package.json main points at dist/lib/index.js, and its
# components import sibling .css files that only exist after build-css. Both
# steps are required before the web build, and a fresh checkout has neither.
echo "==> build @oyster/common"
(cd packages/common && yarn prepare && yarn build-css)

echo "==> build web"
(cd packages/web && yarn prestart && yarn build)

# craco.config.js rewrites paths.appBuild to ./../../build/web relative to
# packages/web, so the output is js/build/web -- NOT packages/web/build.
echo "==> output:"
ls -la build/web/index.html
du -sh build/web
