#!/usr/bin/env bash
#
# Cloudflare Workers Builds - build entrypoint for the `web` app.
#
# Invoked as the dashboard "Build command" (Settings > Build):
#     bash ./cf-build.sh
# with the dashboard "Root directory" set to `js`.
#
# It is also safe to run by hand from a clean checkout:
#     bash js/cf-build.sh
#
# Produces: js/build/web   (index.html + static/{js,css,media})
#
set -euo pipefail

# Always operate from the directory this script lives in (the yarn workspace root),
# regardless of the caller's cwd.
cd "$(dirname "${BASH_SOURCE[0]}")"

# react-scripts 3.4.3 pulls webpack 4.42.0, which hashes modules with md4.
# OpenSSL 3 (Node >= 17) removed md4 from the default provider, so without this
# flag the build dies with:
#   Error: error:0308010C:digital envelope routines::unsupported
#   (ERR_OSSL_EVP_UNSUPPORTED) at webpack/lib/util/createHash.js
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--openssl-legacy-provider"

# create-react-app treats every ESLint warning as a fatal error when CI is truthy.
# Workers Builds injects CI=true by default and this app has ~50 pre-existing
# warnings, so the build would fail to compile. Must be exported, not just assigned.
export CI=false

echo "==> node $(node -v) / yarn $(yarn -v) / NODE_OPTIONS=$NODE_OPTIONS"

# Workers Builds normally installs dependencies for us; run it anyway so the script
# is self-contained and works on a cold checkout. It is a no-op when already installed.
echo "==> yarn install"
yarn install --frozen-lockfile --network-timeout 600000

echo "==> lerna link/bootstrap"
yarn bootstrap

# @oyster/common's package.json main points at dist/lib/index.js, and its components
# import sibling .css files that only exist after build-css. Both steps are required
# before the web build, and a fresh checkout has neither.
echo "==> build @oyster/common"
cd packages/common
yarn prepare
yarn build-css
cd ../..

echo "==> build web"
cd packages/web
yarn prestart
yarn build
cd ../..

# craco.config.js rewrites paths.appBuild to ./../../build/web relative to
# packages/web, so the output is js/build/web -- NOT packages/web/build.
echo "==> output:"
ls -la build/web/index.html
du -sh build/web
