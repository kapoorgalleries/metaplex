# Priya &amp; Sanjay — Wedding App (2026)

A self-contained wedding website for **Priya &amp; Sanjay**, October 17, 2026 · Udaipur, India.
No build step, no dependencies — just open it in a browser.

## Quick start

```bash
# Option A — just open the file
open wedding-app/index.html        # macOS
xdg-open wedding-app/index.html    # Linux

# Option B — serve it (recommended; some browsers restrict file:// features)
cd wedding-app
python3 -m http.server 8080
# then visit http://localhost:8080
```

## Features

- **Hero + live countdown** to the ceremony date.
- **Our Story** scroll-reveal timeline.
- **Events** — Mehndi &amp; Haldi, Sangeet, Ceremony, Reception, each with time, venue and dress code.
- **Add to calendar** — generates a downloadable `.ics` with all four events.
- **Travel &amp; Stay** — airport info, hotel room block, venue map links.
- **Gallery** with a click-to-expand lightbox (placeholder tiles — drop in real photos).
- **RSVP form** — validation, per-event selection, meal preferences, hotel-block request and
  a song-request/note field. Saves submissions to `localStorage` by default.
- **FAQ** accordion and a gift **registry** section.
- Fully **responsive** with a mobile menu and `prefers-reduced-motion` support.

## Project structure

```
wedding-app/
├── index.html        # all markup / content
├── css/styles.css    # theme + layout (marigold / maroon / gold)
├── js/main.js         # countdown, reveal, gallery, RSVP, .ics export
├── assets/           # drop real photos / logo here
└── README.md
```

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
