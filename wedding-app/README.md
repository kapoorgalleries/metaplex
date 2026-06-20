# Priya &amp; Sanjay — Wedding App (2026)

A wedding website for **Priya &amp; Sanjay**, October 17, 2026 · Udaipur, India.

The site itself is a **build-free static app** (HTML/CSS/JS). Two optional features —
a **Claude-powered wedding concierge** and **guest photo sharing** — are served by a
tiny Node/Express backend. The static site works on its own; those two features simply
stay hidden / inert when the backend isn't running.

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
- **Gallery** with a click-to-expand lightbox (placeholder tiles — drop in real photos).
- **Wedding concierge** — a Claude-powered chat widget that answers guest questions
  (events, dress codes, travel, FAQ) from the wedding details. Appears only when the
  backend is running with an `ANTHROPIC_API_KEY`.
- **Guest photo sharing** — guests upload photos from the weekend; they appear in the
  gallery for everyone. Stored under `server/uploads/`.
- **RSVP form** — validation, per-event selection, meal preferences, hotel-block request and
  a song-request/note field. Saves submissions to `localStorage` by default.
- **FAQ** accordion and a gift **registry** section.
- Fully **responsive** with a mobile menu and `prefers-reduced-motion` support.

## Project structure

```
wedding-app/
├── index.html        # all markup / content
├── css/styles.css    # theme + layout (marigold / maroon / gold)
├── js/main.js        # countdown, reveal, gallery, RSVP, .ics export
├── js/api.js         # concierge chat + guest photo sharing (talks to the backend)
├── assets/           # drop real photos / logo here
├── server/           # optional Node/Express backend
│   ├── server.js     # static hosting + /api/concierge (Claude) + /api/photos
│   ├── package.json
│   └── uploads/      # guest-submitted photos (git-ignored)
└── README.md
```

## The backend

A minimal Express server (`server/server.js`) that:

- **Serves the static site** — so the whole app runs from one process.
- **`POST /api/concierge`** — proxies guest questions to Claude (`claude-opus-4-8`) via the
  official `@anthropic-ai/sdk`. The system prompt pins it to the wedding facts so it won't
  invent details, and falls back to the contact email when it doesn't know. The API key
  stays server-side and is never exposed to the browser.
- **`GET/POST /api/photos`** — lists and accepts guest photo uploads (`multer`, images only,
  15 MB cap), stored on disk under `server/uploads/`.

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
| `ANTHROPIC_API_KEY` | Enables the concierge **and** photo moderation |
| `PHOTO_MODERATION=off` | Turn moderation off even when the key is set |
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
