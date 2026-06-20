# Priya &amp; Sanjay — Wedding App (2026)

A **phone app** for **Priya &amp; Sanjay**, October 17, 2026 · Udaipur, India.

It's an **installable PWA** (Progressive Web App): on a phone, open it in the browser and
choose **Add to Home Screen** — it then launches full-screen with its own icon, a native
**top app bar + bottom tab bar**, and works **offline** (app shell cached by a service
worker). No app store, no build step — just HTML/CSS/JS plus a tiny Node/Express backend
for the dynamic features.

**App tabs:** Home · Schedule · Photos · Guestbook · RSVP — with Our Story, Travel, Things
to Do, Wedding Party and FAQ in the **More** sheet (⋯).

Dynamic features (concierge, RSVP storage, guestbook, photo uploads, admin dashboard) are
served by the backend; the app still browses fine without it (those features degrade
gracefully).

## Quick start

### Static only (no concierge / photo uploads)

```bash
# Just open the file
open wedding-app/index.html        # macOS
xdg-open wedding-app/index.html    # Linux

# …or serve it (recommended; some browsers restrict file:// features)
cd wedding-app && python3 -m http.server 8080   # → http://localhost:8080
```

### Full app (concierge + photo sharing)

```bash
cd wedding-app/server
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # enables the concierge; omit to run without it
npm start                              # serves the whole site → http://localhost:8080
```

The server serves the static site **and** the API, so this one command runs everything.
Without `ANTHROPIC_API_KEY` the site and photo sharing still work — only the concierge
chat stays hidden.

## Features

- **Hero + live countdown** to the ceremony date.
- **Our Story** scroll-reveal timeline.
- **Events** — Mehndi &amp; Haldi, Sangeet, Ceremony, Reception, each with time, venue and dress code.
- **Add to calendar** — generates a downloadable `.ics` with all four events.
- **Travel &amp; Stay** — airport info, hotel room block, venue map links.
- **Installable + offline** — web app manifest (`manifest.json`), app icons (`icons/`), and
  a service worker (`sw.js`) that caches the app shell so it opens offline.
- **Mobile app chrome** — top app bar (back / title / More) and a bottom tab bar, rendered
  on every page by `js/site.js`.
- **Photos** — browse a shared gallery and upload your own from the weekend.
- **Guestbook** — guests leave public well-wishes (optionally screened by Claude).
- **RSVP** — saved to the backend; per-event selection, meal prefs, hotel-block, notes.
- **RSVP admin dashboard** (`admin.html`) — password-protected page with live headcounts,
  per-event tallies, the full response table, and CSV export.
- **Wedding concierge** — a Claude-powered chat bubble (on every screen) that answers guest
  questions from the wedding details. Appears only when the backend has an `ANTHROPIC_API_KEY`.
- **Find Your Seat** — guests look up their reception table by name (`/api/seating`); the
  admin assigns table numbers inline in the RSVPs tab.
- **Song requests** + **photo loves** + **live home stats** (PII-free guest count).
- **Push notifications** — guests opt into day-of reminders (🔔 in the More sheet); the
  admin can broadcast announcements. Auto-fires a reminder 2 hours before each event.
  Uses Web Push + VAPID (`web-push`); the public key is exposed at `/api/push/key` and a
  `push` handler lives in the service worker.
- **English / हिंदी** — a language toggle in the app bar localizes the whole app shell,
  the home screen, and every page header (choice persists in `localStorage`).
- **FAQ** accordion and a gift **registry** section.
- Fully **responsive** with `prefers-reduced-motion` support and iOS safe-area insets.

## Project structure

```
wedding-app/
├── index.html  schedule.html  story.html  travel.html  things-to-do.html
├── party.html  gallery.html   guestbook.html  rsvp.html  faq.html  admin.html
├── manifest.json     # PWA manifest (installable)
├── sw.js             # service worker (offline app shell)
├── icons/            # app icons (192 / 512 / maskable)
├── css/styles.css    # theme + app-shell layout (marigold / maroon / gold)
├── js/
│   ├── site.js       # app shell: top bar, bottom tabs, More sheet, PWA, concierge
│   ├── home.js       # countdown + .ics export
│   ├── gallery.js    # photo browse + upload + lightbox
│   ├── rsvp.js       # RSVP form → /api/rsvp
│   ├── guestbook.js  # guestbook → /api/guestbook
│   └── admin.js      # password-gated dashboard → /api/rsvp
├── server/           # Node/Express backend (concierge, RSVP, guestbook, photos, admin)
│   ├── server.js  storage.js  moderation.js  package.json
│   └── uploads/      # guest photos on the local backend (git-ignored)
└── README.md
```

## The backend

A minimal Express server (`server/server.js`) that serves the app and the API from one
process:

- **`POST /api/concierge`** — proxies guest questions to Claude (`claude-opus-4-8`) via the
  official `@anthropic-ai/sdk`, pinned to the wedding facts. The API key stays server-side.
- **`GET/POST /api/photos`** — list + accept guest photo uploads (`multer`, images only, 15 MB).
- **`POST /api/rsvp`** — store an RSVP; **`GET /api/rsvp`** (admin-only) returns all of them.
- **`GET/POST /api/guestbook`** — public well-wishes (optionally screened by Claude).
- **Admin dashboard** (`admin.html`) — gated by `ADMIN_PASSWORD`; sends it as an
  `x-admin-token` header to read RSVPs, with stats + CSV export computed client-side.

> RSVPs and guestbook entries are stored as JSON under `server/data/` (git-ignored). For
> production you'd point these at a database; the read/write helpers in `server.js` are the
> single place to swap.

### Photo storage (local disk → S3 / Cloudflare R2)

Photo storage is pluggable (`server/storage.js`). With no extra config it uses **local disk**
(`server/uploads/`). Set `PHOTO_S3_BUCKET` to switch to an **S3-compatible bucket** — AWS S3
or Cloudflare R2 — with no code changes:

```bash
# Cloudflare R2 example
export PHOTO_S3_BUCKET=priya-sanjay-photos
export PHOTO_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # omit for AWS S3
export PHOTO_S3_REGION=auto                                           # "auto" for R2
export PHOTO_PUBLIC_BASE_URL=https://photos.yourwedding.com           # where objects are served
export PHOTO_S3_ACCESS_KEY_ID=...        # or use the default AWS credential chain
export PHOTO_S3_SECRET_ACCESS_KEY=...
npm start
```

The uploaded object and a `manifest.json` index both live in the bucket; the photo `url`
returned to the gallery is `PHOTO_PUBLIC_BASE_URL/<key>`.

### Photo moderation (light, Claude vision)

When the concierge is enabled (`ANTHROPIC_API_KEY` set), every upload is screened with Claude
vision before it's published — it blocks nudity, graphic violence, hateful content, and obvious
spam, and allows ordinary event photos. It **fails open** (a moderation error never blocks a
guest) and skips image types vision can't read (e.g. HEIC). Disable it with `PHOTO_MODERATION=off`.

| Env var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the concierge **and** photo/guestbook moderation |
| `ADMIN_PASSWORD` | Enables the RSVP admin dashboard (`/admin.html`) |
| `PHOTO_MODERATION=off` | Turn moderation off even when the key is set |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keys (auto-generated to `server/data/vapid.json` if unset) |
| `VAPID_CONTACT` | `mailto:` contact for push (default placeholder) |
| `PHOTO_S3_BUCKET` | Switch photo storage to S3/R2 (else local disk) |
| `PHOTO_S3_ENDPOINT` | R2 (or custom) S3 endpoint; omit for AWS S3 |
| `PHOTO_S3_REGION` | Bucket region (`auto` for R2) |
| `PHOTO_PUBLIC_BASE_URL` | Public URL base where bucket objects are served |
| `PHOTO_S3_ACCESS_KEY_ID` / `PHOTO_S3_SECRET_ACCESS_KEY` | Bucket credentials (optional; falls back to the AWS default chain) |

## Customizing

| What | Where |
|------|-------|
| Names, dates, venues, copy | `index.html` |
| Countdown target date | `WEDDING_DATE` in `js/main.js` |
| Calendar event times | `events[]` in `js/main.js` |
| Gallery photos | replace `.gallery__tile` gradients with `<img>` in `js/main.js` / `index.html` |
| Colours &amp; fonts | CSS variables in `:root` (`css/styles.css`) |
| Registry / honeymoon-fund links | the `.registry__links` anchors in `index.html` |

## Wiring up a real RSVP backend

Submissions are stored in the browser's `localStorage` by default so the app works
offline with zero setup. To collect responses centrally, replace the `localStorage`
block in `js/main.js` (clearly marked with a `TODO (backend hook)` comment) with a
`fetch()` to a form endpoint such as [Formspree](https://formspree.io), Google Forms,
or your own API. The `data` object is already assembled and ready to POST as JSON.

## Notes

This app is intentionally framework-free for portability and longevity — it will keep
working long after the wedding with no dependency upgrades. Photos and copy are
placeholders; swap in the real details before sharing.
