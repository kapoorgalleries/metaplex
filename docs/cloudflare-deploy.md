# Deploying the web app to Cloudflare Workers

The `web` app (`js/packages/web`) deploys to Cloudflare Workers as a static
assets Worker. All of the configuration lives in this repo.

## No dashboard build command

The `[build]` section of `wrangler.toml` drives the build. Workers Builds runs
it before the deploy — its log shows:

```
[custom build] Running: bash ./js/cf-build.sh
```

Cloudflare's own
[docs](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
say the hosted runner does not honor custom builds. In practice it does, and
the log above (build `5d91b1f9`, 2026-09-07) is the evidence. So:

- Leave **Settings → Build → Build command** empty. If it is set to the same
  script, the build runs twice per deploy: once from the dashboard, once from
  `[build]`. Correct, but slow.
- Leave **Root directory** at the repository root and **Deploy command** at its
  default `npx wrangler deploy`.

If there is no Wrangler config at all, wrangler falls back to guessing and
reports:

```
✘ [ERROR] Could not detect a directory containing static files
          (e.g. html, css and js) for the project
```

## What the repo provides

| File | Role |
| --- | --- |
| `wrangler.toml` | Assets-only Worker config. Must be at the repo root, since that is where the runner looks. |
| `js/cf-build.sh` | The entire build. Safe to run by hand from any directory. |
| `.node-version` | Pins Node 22. The build image defaults to Node 24; 22 is what this build is verified on and is preinstalled. |

## Things that will bite you

- **Expect a few minutes per build.** On Cloudflare, `yarn install` takes
  about 70 seconds from a cold cache and the webpack build about 30. Enabling
  **Build cache** cuts subsequent runs further.
- **yarn must be 1.x, in every process.** `js/yarn.lock` is a v1 lockfile and
  `lerna.json` sets `"npmClient": "yarn"`, so lerna shells out to bare `yarn`.
  The build image provides yarn through a corepack shim beside the `node`
  binary, and yarn 1's own `yarn run` prepends that directory to `PATH` for
  every script it launches — so a yarn 1 placed earlier on `PATH` is bypassed
  inside `yarn bootstrap`, and lerna got yarn 4 and died on `--mutex`.
  Three things handle it, and each is load-bearing: `js/package.json` declares
  `"packageManager": "yarn@1.22.22"` so the shim itself becomes yarn 1;
  `cf-build.sh` pins yarn 1 onto `PATH` for images without corepack; and lerna
  is invoked by path rather than through `yarn run`. Do not "simplify" any of
  these away.
- **`CI` must be false during the build.** Workers Builds sets `CI=true`, and
  create-react-app turns this app's ~50 pre-existing ESLint warnings into fatal
  errors. `cf-build.sh` exports `CI=false`.
- **Node ≥ 17 needs `--openssl-legacy-provider`.** webpack 4 hashes modules
  with md4, which OpenSSL 3 dropped from its default provider. `cf-build.sh`
  exports it.
- **`not_found_handling` is `"none"`, deliberately.** The app uses `HashRouter`
  and `"homepage": "."`, so assets are referenced relatively. An SPA fallback
  would serve `index.html` for `/a/b` and the browser would then resolve
  `./static/…` against `/a/`, 404-ing every asset.

## Store configuration

The deployed site renders "Store has not been configured" until
`REACT_APP_STORE_OWNER_ADDRESS_ADDRESS` is set. It is baked in at build time,
so it must be set *before* the build — either in `js/packages/web/.env` /
`.env.production`, or as a build variable in the dashboard.
