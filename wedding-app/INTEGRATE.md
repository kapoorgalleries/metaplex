# Integrating the app with sanjaywedspriya.com

A practical guide for the couple / hosts: how to put the installable wedding app on the
same domain as the website, share one Supabase data source, and run the day-to-day
workflows (RSVPs, guestbook, photos, moderation, content updates).

---

## 1. Overview

You have **two pieces that live on one domain**:

| Piece | What it is | Where it lives |
|---|---|---|
| **Website** | Static wedding site at `https://sanjaywedspriya.com` (Pages origin `priyasanjay.pages.dev`) | Repo `kapoorgalleries/sb1-vuxiwzek`, branch **`wedding-site`** (NOT `main` — `main` is an unrelated project), hosted on **Cloudflare Pages**, backed by **Supabase** (project ref `xgsfrltjnigsglkxhmsq`). Deploys copy an **allowlist** of files via `scripts/build-pages.mjs`, and `_worker.js` passcode-gates the whole host. |
| **App** (this folder, `wedding-app/`) | Installable PWA — schedule, RSVP, guestbook, photo gallery, travel, FAQ, and more; works offline | Built to `wedding-app/dist/` by `npm run ci`; deployed under the website at `/app/` (recommended) or as its own Pages project |

> **Note:** the website currently installs **itself** as a PWA (its "The Guest App"
> section is an Add-to-home-screen button, not a link to this app). Deploying this
> richer app at `/app/` is additive — see Section 4 for linking it from the site.

When the app's **Supabase mode** is turned on (Section 5), both pieces read and write the
**same Supabase data**: one guestbook, one photo gallery, one RSVP list, one Hosts
Dashboard. A note posted in the app shows up in the website's dashboard and vice-versa.
The mode is **opt-in and OFF by default**, so nothing touches the live database until you
flip it on deliberately.

---

## 2. Deploy workflow — recommended: app at `/app`

Serve the app from the website's own Pages project so guests get one domain:
`https://sanjaywedspriya.com/app/`. The app already uses relative asset paths, so it
works unmodified under the subpath.

Three website-repo realities to respect (all handled by the steps below):

1. The site lives on branch **`wedding-site`** — never push app files to `main`.
2. `scripts/build-pages.mjs` copies an **explicit allowlist** into the deploy
   artifact — an `app/` directory ships only after you add `"app"` to that
   allowlist (with its file extensions).
3. `_worker.js` passcode-gates the host and returns **404 for any path whose file
   name looks sensitive** (`*.json`, `*.txt`, `*.xml`, `*.md`, …). That's why the
   app's manifest is named `manifest.webmanifest` and why `robots.txt` /
   `sitemap.xml` / `package.json` must be left out of the copied artifact.
   Guests who entered the passcode on the site are automatically unlocked for
   `/app/` too (the auth cookie is host-wide).

**Step 1 — turn on Supabase mode before building** (so the deployed app shares the
website's data). In `wedding-app/js/supa.js`, change the `enabled` line so the default is
on:

```js
// js/supa.js — before:
var enabled = CFG.enabled === true || flagged;
// after:
var enabled = CFG.enabled !== false || flagged;
```

(Alternatively leave the code as-is and add
`<script>window.SUPA_CONFIG = { enabled: true };</script>` **before** the `js/supa.js`
script tag in each page — but flipping the default in one file is simpler.)

**Step 2 — build the deploy artifact** here in this repo:

```bash
cd wedding-app
npm ci
npm run ci        # validate → build → scan → smoke; output in wedding-app/dist/
```

**Step 3 — copy the CONTENTS of `dist/` into the website repo** at `app/` (repo
root of the **`wedding-site`** branch — the site has no `public/` directory), and
drop the files the site's worker would 404 anyway:

```bash
# from the parent directory that holds both repos
cd sb1-vuxiwzek && git checkout wedding-site && cd ..
rm -rf sb1-vuxiwzek/app
mkdir -p sb1-vuxiwzek/app
cp -r metaplex/wedding-app/dist/. sb1-vuxiwzek/app/
rm -f sb1-vuxiwzek/app/robots.txt sb1-vuxiwzek/app/package.json sb1-vuxiwzek/app/package-lock.json
```

**Step 4 — allowlist `app/` in the site's deploy script** (one-time). In
`sb1-vuxiwzek/scripts/build-pages.mjs`, add the `app` directory to the copied
trees (alongside `img/` and `vendor/`), permitting these extensions:
`.html .css .js .webmanifest .png .jpg .jpeg .webp .avif .svg .mp3 .ico`.
Then commit & push the website repo — Cloudflare Pages auto-builds on push:

```bash
cd sb1-vuxiwzek
git add app scripts/build-pages.mjs
git commit -m "Add installable wedding app at /app"
git push origin wedding-site
```

**Step 5 — verify.** After the Pages build finishes, the app is live at:

```
https://sanjaywedspriya.com/app/
```

(You'll pass the site's passcode gate first if your browser hasn't already.)

Open it on a phone, check "Add to Home Screen" works, and run the Supabase verification
in Section 5.

Notes:
- When nested under `/app/`, a bad URL falls through to the **website's** root 404 page
  (Cloudflare Pages serves the site's own 404 for the whole origin) — that's fine. At a
  standalone root deploy, the app's own `404.html` still works because all its links are
  relative.
- Repeat Steps 2–3 + the push whenever you change app content (see Section 8) — the
  allowlist edit in Step 4 is one-time.

---

## 3. Deploy workflow — alternative: separate Cloudflare Pages project

If you'd rather not touch the website repo, give the app its **own** Pages project:

1. Put the build output somewhere Pages can see — either a dedicated repo, or a
   `wedding-app-dist` branch containing only the contents of `dist/`:

   ```bash
   cd wedding-app
   npm run ci
   # example: publish dist/ to a dist branch
   git checkout --orphan wedding-app-dist
   git rm -rf . && cp -r dist/. . && rm -rf dist
   git add -A && git commit -m "App build"
   git push origin wedding-app-dist
   ```

2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**,
   pick that repo/branch, set **Build command: (none)** and **Build output directory: /**
   (the files are already built).

3. You get a second origin like `https://priya-sanjay-app.pages.dev`. Optionally add a
   custom subdomain (e.g. `app.<your-domain>`) under the project's **Custom domains**.

4. Link to it from the website (Section 4).

**Trade-off:** the app runs on a **separate origin**. That's fine for data — Supabase is
shared and called directly from the browser — but there is **no Node backend** on Pages,
so the app **must** have Supabase mode enabled (Step 1 of Section 2), otherwise RSVP /
guestbook / photos would try to call `/api/*` endpoints that don't exist there.
Concierge and Push also won't work here (Section 10).

---

## 4. Homepage link

**Current site behavior:** the website's "The Guest App" section installs the *site
itself* as a PWA (`Add to home screen →` on `#app` — its code notes "this site IS the
app"). It links nowhere external, so deploying this app will NOT surface it to guests
until you add a link.

If/when you want to point guests at this richer app, add this to the website's
homepage (e.g. inside the `#app` section). Style-neutral — inherits the site's own
styles, or restyle the `<a>` however you like:

```html
<!-- Link to the wedding app -->
<a href="/app/" rel="noopener"
   style="display:inline-block;padding:0.75rem 1.5rem;border:1px solid currentColor;
          border-radius:999px;text-decoration:none;font-weight:500;">
  Open the app — RSVP, schedule &amp; more
</a>
```

If you chose the separate-project route (Section 3), point `href` at that origin
instead, e.g. `href="https://priya-sanjay-app.pages.dev/"` or
`href="https://app.sanjaywedspriya.com/"`.

---

## 5. Turn on shared data (Supabase) + verify

**How it's wired.** `js/supa.js` holds the website's Supabase URL and **public anon key**
(RLS-protected; never a service key). It is OFF by default. It turns on when any of these
is true:

- the URL has `?supa=1` (per-visit override — great for testing), or
- a page sets `window.SUPA_CONFIG = { enabled: true }` before `js/supa.js` loads, or
- you flip the `enabled` default in `js/supa.js` (the permanent switch — Section 2 Step 1).

**Nothing writes to the live database until one of those is true.** Verify on a preview
before flipping the permanent switch:

1. Deploy (or open a Cloudflare Pages **preview deployment** of) the app **without**
   changing the flag, then append `?supa=1`:

   ```
   https://<preview>.pages.dev/app/guestbook.html?supa=1
   https://<preview>.pages.dev/app/rsvp.html?supa=1
   ```

2. **Guestbook test:** post a note (e.g. name `Test — delete me`). It should be accepted
   and NOT appear publicly yet (it's moderated).

3. **RSVP test:** on the RSVP page, search for a **real invitation name** from the guest
   list (the flow is `lookup_guest_by_name` → `get_my_rsvp` → `submit_rsvp`). Pick events
   among `Haldi`, `Sangeet`, `Wedding Ceremony`, `Reception`, keep the party size within
   that guest's `max_party_size`, and submit.

4. **Confirm in the Hosts Dashboard** on the website: the guestbook note should be
   sitting in **pending moderation**, and the RSVP should appear in the RSVP summary.
   Approve-or-reject the test note, and (if you used a real guest) re-submit their real
   answer or note the test.

5. Once that round-trip works, make it permanent: set the flag on (Section 2 Step 1),
   rebuild, recopy, push.

---

## 6. Guest workflows

What a guest does in the app, and where the data goes (with Supabase mode on):

- **RSVP** (`rsvp.html`): the guest types their name as it appears on the invitation →
  the app calls `lookup_guest_by_name(p_name)` to find their invitation →
  `get_my_rsvp(p_guest_id)` prefills any earlier answer → the guest picks events
  (`Haldi`, `Sangeet`, `Wedding Ceremony`, `Reception`) and a party size (capped at their
  `max_party_size`) → `submit_rsvp(...)` saves it. A decline sends no events. The result
  is immediately visible to the hosts (Section 7). RSVP is invitation-gated: names not on
  the guest list can't submit.

- **Guestbook** (`guestbook.html`): the guest posts `{name, message}` into the
  `guestbook` table. The row arrives with `approved=false`, so it is **pending** and not
  shown publicly. Once a host approves it, it appears in the guestbook on both the app
  and the website.

- **Photos** (`gallery.html`): the guest's photo uploads to the `guest-uploads` storage
  bucket, and a `{storage_path, alt_text}` row is inserted into `gallery_photos` —
  also `approved=false` until a host approves it, after which it shows in the shared
  gallery.

Everything else in the app (schedule, story, travel, FAQ, music, things-to-do, the
installable pass) is static content and needs no backend at all.

---

## 7. Host / moderation workflow

You moderate **in the website's existing Hosts Dashboard** — the app adds no new admin
surface, because both pieces use the same Supabase tables and RPCs:

- **Pending items:** guestbook notes and photos arrive with `approved=false`. The
  dashboard's pending queue (backed by the `get_pending` RPC) lists them; approve or
  reject each with `moderate_item`. Approved items become visible to everyone, in the app
  and on the website.
- **RSVPs:** submissions from the app land in the same tables the website's RSVP uses,
  so they appear in the dashboard's RSVP summary (`get_rsvp_summary`) alongside
  website submissions — one combined headcount.
- **Announcements:** the dashboard's announcements work as before; the app shares the
  same data source.

There is nothing app-specific to learn: if you can moderate the website, you can
moderate the app.

---

## 8. Content-update workflow

To change dates, venues, the story, FAQ answers, schedule details, etc.:

1. Edit the strings in **`js/site.js`** — the i18n `DICT` holds the translated/shared
   copy — and the relevant **`*.html`** page(s) for page-specific markup.
2. Rebuild and verify:

   ```bash
   cd wedding-app
   npm run ci
   ```

3. Recopy the artifact into the website repo (branch `wedding-site`) and push
   (same as Section 2, Step 3):

   ```bash
   rm -rf sb1-vuxiwzek/app
   mkdir -p sb1-vuxiwzek/app
   cp -r metaplex/wedding-app/dist/. sb1-vuxiwzek/app/
   rm -f sb1-vuxiwzek/app/robots.txt sb1-vuxiwzek/app/package.json sb1-vuxiwzek/app/package-lock.json
   cd sb1-vuxiwzek && git add app && git commit -m "Update app content" && git push origin wedding-site
   ```

Cloudflare Pages redeploys automatically. The service worker picks up the new build on
guests' next visit.

If you run the optional Node backend, the **concierge's facts** (what the Claude-powered
helper knows about the wedding) live in **`server/server.js`** — update them there and
redeploy the server separately (see `DEPLOY.md`).

---

## 9. Build & CI workflow

Local, from `wedding-app/` (Node ≥ 18):

```bash
npm ci          # install (uses package-lock.json)
npm run ci      # full pipeline: validate → build → scan → smoke
```

Or run the stages individually:

```bash
npm run validate   # scripts/validate-build.mjs — source checks
npm run build      # scripts/build.mjs — produces dist/
npm run scan       # scripts/scan-dist.mjs — checks the artifact
npm run smoke      # scripts/smoke.mjs — boots and probes the result
```

`wedding-app/dist/` is the deploy artifact — always ship what `npm run ci` produced,
never hand-edited files.

**GitHub Actions:** `.github/workflows/wedding-app.yml` (at the repo root) runs the same
pipeline on pull requests and **uploads the exact `dist/` artifact**, so you can also
download a known-good build straight from a green PR run instead of building locally.

---

## 10. Concierge & Push (server-only) workflow

Two features are **optional** and need a server — they do **not** run on pure static
hosting like `/app` on Cloudflare Pages:

- **Concierge** (the Claude-powered Q&A helper) — needs `POST /api/concierge` and an
  Anthropic API key kept server-side.
- **Web Push** (announcement notifications) — needs `/api/push/*` endpoints and a VAPID
  private key kept server-side.

Options, briefly:

1. **Run the Node backend** (`wedding-app/server/`) on a Node host — Render, Railway,
   Fly.io, a VPS — as documented in **`DEPLOY.md`**, and route `/api/*` from the Pages
   origin to it (e.g. a Pages Function/Worker proxy, also covered in `DEPLOY.md`).
2. **Port them to Supabase Edge Functions** on the shared project
   (`xgsfrltjnigsglkxhmsq`) — the concierge and push handlers are small and self-
   contained; secrets live in the function's environment.
3. **Skip them.** Everything else — RSVP, guestbook, photos, all content — works fine
   with just Supabase mode on. Guests simply won't see the concierge or get push
   notifications.

---

## 11. Safety / rollback

- **Supabase mode is opt-in and OFF by default.** A freshly built app writes nothing to
  the production database until you enable the flag (Section 5). Test with `?supa=1` on
  a preview first.
- **The anon key is public by design** and protected by Row Level Security; the app never
  ships a service key. Moderation means nothing guest-submitted is publicly visible until
  a host approves it.
- **To roll back the app entirely:** delete `public/app/` from the website repo and push
  (the site itself is untouched), or — for the separate-project route — delete/disable
  that Pages project or just remove the homepage link.
- **To roll back data sharing only:** set the `enabled` default in `js/supa.js` back to
  off, rebuild, recopy, push. Existing rows in Supabase are unaffected; the app just
  stops reading/writing them.
- Cloudflare Pages keeps previous deployments — you can also instantly re-promote the
  last good deployment from the Pages dashboard.
