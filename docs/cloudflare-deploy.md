# Deploying the web app to Cloudflare Workers

The `web` app (`js/packages/web`) deploys to Cloudflare Workers as a static
assets Worker. Almost all of the configuration lives in this repo; exactly one
setting does not, and it is the one that is easy to miss.

## The one dashboard setting

**Settings → Build → Build command** must be:

```
bash ./js/cf-build.sh
```

Leave **Root directory** at the repository root and **Deploy command** at its
default `npx wrangler deploy`.

This cannot be committed. Workers Builds
[does not honor](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
the `[build]` section of a Wrangler configuration file, so a build command set
in `wrangler.toml` is silently ignored by the hosted runner. The `[build]`
section in `wrangler.toml` is kept anyway, because plain `npx wrangler deploy`
*does* honor it — it makes a manual deploy a single command.

Without the build command set, the build fails with:

```
✘ [ERROR] The directory specified by the "assets.directory" field in your
          configuration file does not exist
```

because nothing produced `js/build/web`.

If there is no Wrangler config at all, the failure looks different and more
confusing — wrangler falls back to guessing and reports:

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

- **The first build takes 10–15 minutes**, almost all of it `yarn install`.
  That is normal for this dependency tree, not a hang. Enabling **Build cache**
  cuts subsequent runs substantially.
- **yarn must be 1.x.** The build image ships yarn 4, but `js/yarn.lock` is a
  v1 lockfile and `lerna.json` sets `"npmClient": "yarn"`, so lerna shells out
  to whatever `yarn` is on `PATH`. `cf-build.sh` pins yarn 1.22.22 onto `PATH`
  itself, so this is handled — do not "simplify" that away.
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
