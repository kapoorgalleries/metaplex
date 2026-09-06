#!/usr/bin/env bash
#
# Cloudflare Workers Builds - build entrypoint for the `web` app.
#
# Set this as the dashboard "Build command" (Settings > Build):
#     bash ./js/cf-build.sh
# with "Root directory" left at the repository root.
#
# Workers Builds does not honor the [build] section of a Wrangler config
# (documented at /workers/ci-cd/builds/configuration/), so the build command
# has to be set in the dashboard. This script is the whole build, so that is
# the only dashboard setting required.
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
# Pin yarn 1.x.
#
# The Workers Builds image ships yarn 4.9.1 by default, but this workspace is
# yarn 1: js/yarn.lock is a "yarn lockfile v1", which yarn 4 cannot consume
# without migrating it, and yarn 4 rejects --frozen-lockfile outright (renamed
# to --immutable in yarn 2).
#
# lerna.json sets "npmClient": "yarn", so lerna shells out to whatever `yarn`
# is on PATH. Pinning therefore has to happen on PATH, not just at the call
# sites below.
# ---------------------------------------------------------------------------
YARN_PIN="1.22.22"
if [ "$(yarn --version 2>/dev/null | cut -d. -f1)" != "1" ]; then
  echo "==> pinning yarn ${YARN_PIN} (found: $(yarn --version 2>/dev/null || echo 'no yarn on PATH'))"
  YARN_HOME="$(mktemp -d)"
  npm install --no-save --no-audit --no-fund --prefix "$YARN_HOME" "yarn@${YARN_PIN}" >/dev/null
  export PATH="${YARN_HOME}/node_modules/.bin:${PATH}"
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

echo "==> lerna link/bootstrap"
yarn bootstrap

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
