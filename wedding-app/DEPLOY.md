# Deploying the wedding app

The wedding app is **two independently-deployable pieces**:

| Piece | What it is | Artifact | Where it runs |
|---|---|---|---|
| **Frontend** | Static PWA (HTML/CSS/JS, service worker, manifest, icons) | `wedding-app/dist/` (produced by `npm run build`) | Any static host — Cloudflare Pages, Netlify, S3+CDN, or the Node server below |
| **Backend** | Node/Express API (`wedding-app/server/`) | the `server/` source | A **Node host** — it is a conventional long-running server |

CI builds and uploads the **frontend artifact** (`dist/`). The backend is deployed separately.

## The frontend expects the API at the same origin

The frontend calls the API with **root-relative** paths (`/api/rsvp`, `/api/concierge`,
`/api/photos`, `/api/push/*`, `/api/stats`, `/api/seating`, `/api/rsvp/mine`). So in
production the API must answer on the **same origin** as the static site. That gives two
supported topologies:

### Option A — One origin, one process (simplest; matches the code today)

`server/server.js` serves **both** the static site *and* the API from one Express process.
Run it on a Node host (Render, Railway, Fly.io, a container, or a VPS):

```bash
cd wedding-app
npm run setup          # npm ci in server/
# set secrets in the host's environment (see below)
npm start              # serves the site + API on $PORT (default 8080)
```

Point your domain at that host. Nothing else is required — `/` and `/api/*` are same-origin
because they are the same server. This is the canonical deployment for this codebase.

### Option B — Static on Cloudflare Pages + API on a Node host

Deploy `dist/` to Cloudflare Pages (static) and host the Node API elsewhere. Because the
frontend uses relative `/api/*`, you must make `/api/*` resolve to the API from the Pages
origin — e.g. a **Pages Function / Worker route that proxies `/api/*`** to the API host.
(The alternative — pointing the frontend at an absolute API URL — would mean editing the
`fetch("/api/…")` calls; that rewrite is intentionally **not** done here so the same-origin
model keeps working.)

> **Cloudflare caveat (important & honest):** a conventional persistent Node/Express server
> does **not** run on vanilla Cloudflare Pages. Running the backend *on Cloudflare* would
> mean re-implementing it as **Pages Functions / Workers** — and because Workers have no
> filesystem, the current disk-backed storage (local `server/uploads/` + JSON in
> `server/data/`) would have to move to **R2** (photos — already supported via env) and
> **KV/D1** (RSVPs, guestbook, songs, push subscriptions). That is a separate migration and
> is **not** part of this build. Until then, host the backend on a Node runtime (Option A/B).

## Storage in production

- **Photos**: local disk by default; set `PHOTO_S3_BUCKET` (+ `PHOTO_PUBLIC_BASE_URL`, and
  R2/S3 creds) to use S3/Cloudflare R2 instead — no code change (see `server/storage.js`).
- **RSVPs / guestbook / songs / push subs**: JSON files under `server/data/` (git-ignored).
  Fine for a single persistent Node host with a disk; **not** durable on ephemeral/serverless
  hosts — move these to a database/KV before deploying to one.

## Secrets (set in the host env — never committed, never in `dist/`)

| Variable | Enables |
|---|---|
| `ANTHROPIC_API_KEY` | Claude concierge **and** photo/guestbook moderation |
| `ADMIN_PASSWORD` | the admin dashboard (`/admin.html`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push (auto-generated to `server/data/vapid.json` if unset) |
| `PHOTO_S3_BUCKET` / `PHOTO_PUBLIC_BASE_URL` / `PHOTO_S3_*` | S3/R2 photo storage |

The **frontend contains no secrets** — the CI `scan` step fails the build if a private key,
API key, JWT, database URL, or service-role credential ever appears in `dist/`. The Web Push
**public** key is fetched at runtime from `/api/push/key`; only the private key is a secret,
and it stays server-side.

## What CI proves (and what it doesn't)

- **Proven**: the static site builds to a clean `dist/`, contains no backend/tooling/secret
  files, every service-worker-cached asset ships, pages/assets/404-route serve over HTTP,
  all JS parses, and the API **boots** and answers its secret-free endpoints.
- **Not proven by CI** (needs a secret-provisioned environment): concierge answers, photo
  **moderation**, push **delivery**, and S3/R2 uploads. Test those in a staging environment
  with real credentials before relying on them.
