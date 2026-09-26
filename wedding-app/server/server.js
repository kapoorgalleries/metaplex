/* =========================================================
   Priya & Sanjay 2026 — wedding app backend
   - Serves the static site (../)
   - POST /api/concierge : Claude-powered guest Q&A
   - POST /api/photos    : guest photo uploads
   - GET  /api/photos    : list guest-submitted photos
   No build step: `npm install` then `npm start`.
   ========================================================= */
"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const { createStorage } = require("./storage");
const { moderatePhoto, moderateText, isEnabled: moderationEnabled } = require("./moderation");
const createPush = require("./push");

const app = express();
const PORT = process.env.PORT || 8080;

app.set("trust proxy", true); // honour X-Forwarded-For so rate limiting keys on the real client IP
app.use(express.json({ limit: "1mb" }));

/* ---------- Spam hardening: in-memory rate limiting + honeypot ---------- */
// Per-IP sliding window. In-memory is fine for a single-instance wedding app.
function rateLimit({ windowMs, max }) {
  const hits = new Map(); // ip -> [timestamps]
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || "unknown";
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: "You're doing that a bit too fast — please wait a moment and try again." });
    }
    recent.push(now);
    hits.set(ip, recent);
    // Opportunistic cleanup so the map can't grow without bound.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    }
    next();
  };
}

// Bots love to fill in every field; real forms hide a "website" trap.
// If it's filled, pretend everything went fine (so bots don't retry) but store nothing.
function honeypot(req, res, next) {
  if (req.body && typeof req.body.website === "string" && req.body.website.trim() !== "") {
    return res.status(200).json({ ok: true });
  }
  next();
}

// Generous limits — enough for a household filling things in, hostile to scripts.
const limitWrites = rateLimit({ windowMs: 60 * 1000, max: 12 });
const limitConcierge = rateLimit({ windowMs: 60 * 1000, max: 20 });

// ---------- Paths ----------
const SITE_ROOT = path.join(__dirname, ".."); // the wedding-app/ static site

// ---------- Simple JSON data store (RSVPs, guestbook) ----------
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
  } catch (_) {
    return [];
  }
}
function appendJson(name, entry) {
  const list = readJson(name);
  list.push(entry);
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(list, null, 2));
  return entry;
}
function writeJsonFile(name, list) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(list, null, 2));
}
const trimStr = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

// ---------- Photo storage (local disk by default; S3/R2 via env) ----------
const storage = createStorage();

// ---------- Static hosting ----------
app.use(express.static(SITE_ROOT));
if (storage.serveDir) {
  // Local backend: serve uploaded files. (S3/R2 serve from their own URL.)
  app.use("/uploads", express.static(storage.serveDir));
}

/* =========================================================
   Wedding concierge (Claude)
   ========================================================= */

// The single source of truth the concierge may answer from.
const WEDDING_FACTS = `
COUPLE: Priya Mallikarjuna & Sanjay Kapoor ("Priya & Sanjay")
DATES: Friday, November 6 & Saturday, November 7, 2026, in New York City (an optional farewell brunch follows on Sunday, November 8)
RSVP DEADLINE: August 31, 2026
CONTACT: the couple's planners — sonal@sjsevents.com (cc ginny@sjsevents.com)

EVENTS:
- Haldi — Fri, Nov 6, 11:00 AM – 1:00 PM, Conrad New York Downtown (102 North End Avenue, New York, NY 10282). A bright morning of turmeric, music and blessings.
- Sangeet — Fri, Nov 6, 7:00 PM, The Lighthouse at Pier 61 (Chelsea Piers, Pier 61, W 23rd St & the Hudson, New York, NY 10011). An evening of music, dance, and performances from both families.
- Brunch — Sat, Nov 7, 10:00 AM, Conrad New York Downtown (102 North End Avenue, New York, NY 10282).
- Wedding Ceremony — Sat, Nov 7: Baraat 12:30 PM, Ceremony 1:30–3:30 PM, Conrad New York Downtown (102 North End Avenue, New York, NY 10282). The baraat and the mandap ceremony — the heart of the weekend.
- Reception — Sat, Nov 7: Cocktails 6:30 PM, Reception 7:30–11:30 PM, Hall des Lumières (49 Chambers Street, New York, NY 10007). Dinner, dancing, and a true celebration to close the weekend.
- Farewell Brunch — Sun, Nov 8, late morning (optional; details to follow).

ATTIRE:
- Indian festive attire is warmly encouraged across the weekend — please wear your most colourful outfits!
- Haldi — bright, easy colours you won't mind catching a little turmeric.
- Sangeet — colourful and celebratory — something you can dance in.
- Wedding Ceremony — traditional and festive; modest coverage is kindly appreciated. Please reserve red and ivory for the bride and groom.
- Reception — Indian traditional or black tie — bring a little sparkle for the dance floor.

TRAVEL & STAY:
- Room block at the Conrad New York Downtown (102 North End Avenue), an all-suite hotel in Battery Park City. Group rate from $409/night, rooms held Nov 5–8.
- Book with group code KMWED26 by October 6, 2026 to secure the group rate: https://book.passkey.com/go/KapoorMallikarjunaWedding
- All three celebration venues are in Manhattan: the Conrad and Hall des Lumières in Lower Manhattan, The Lighthouse at Pier 61 in Chelsea.

TRANSPORT:
- Shuttle service from the airport to the hotel will not be provided — guests are kindly asked to arrange their own transportation.
- Group transport between venues will run from the Conrad — timings to follow.

DINING:
- Wedding meals will be served buffet-style, with many vegetarian options available.
- Guests with nut allergies should notify a banquet server before approaching the buffet so the team can provide guidance regarding the available dishes.

GIFTS:
- Your love and blessings mean the world to us — your presence is the greatest gift of all. The couple gently requests no boxed or wrapped gifts.
- For those who wish to give, a gift may be sent by Zelle (see the Gifts & Blessings / registry page), or simply speak to the bride or groom.

FAQ:
- Plus-ones / party size: your invitation and RSVP reflect the seats reserved for you; if unsure, ask the planners.
- Children: the RSVP form asks how many of your party are children under 12 — they are counted within your reserved seats.
- Dress code: see ATTIRE above.
- The Sunday farewell brunch is optional; details to follow.
- For anything at all, email sonal@sjsevents.com (cc ginny@sjsevents.com).
`.trim();

const CONCIERGE_SYSTEM = `
You are the warm, helpful digital concierge for Priya & Sanjay's 2026 wedding app.
Answer guests' questions about the wedding using ONLY the facts provided below.
Be friendly and concise (2-4 sentences). Use a little warmth, not gushing.
If the answer isn't in the facts, say you're not sure and suggest emailing
sonal@sjsevents.com — do not invent details (no made-up times, prices, or policies).
Politely decline anything unrelated to the wedding.

WEDDING FACTS:
${WEDDING_FACTS}
`.trim();

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
const anthropic = hasApiKey ? new Anthropic() : null; // reads ANTHROPIC_API_KEY

app.get("/api/concierge", (_req, res) => {
  res.json({ available: hasApiKey });
});

app.post("/api/concierge", limitConcierge, async (req, res) => {
  if (!anthropic) {
    return res
      .status(503)
      .json({ error: "The concierge is offline (no ANTHROPIC_API_KEY configured)." });
  }

  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "Please include a message." });

  // Reconstruct a short conversation history (cap to recent turns).
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-10) : [];
  const messages = [];
  for (const turn of history) {
    if (turn && (turn.role === "user" || turn.role === "assistant") && turn.content) {
      messages.push({ role: turn.role, content: String(turn.content) });
    }
  }
  messages.push({ role: "user", content: message });

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system: CONCIERGE_SYSTEM,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return res.json({
        reply:
          "Sorry, I can't help with that one — but for anything about the wedding, email sonal@sjsevents.com.",
      });
    }

    const reply = response.content.find((b) => b.type === "text")?.text?.trim() || "";
    res.json({ reply });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "The concierge is a bit busy — please try again shortly." });
    }
    console.error("Concierge error:", err?.message || err);
    res.status(502).json({ error: "The concierge had a hiccup. Please try again." });
  }
});

/* =========================================================
   Guest photo uploads
   ========================================================= */

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"]);
const EXT_FOR_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
};

// Buffer the file in memory so it can be moderated before it's persisted
// (and so the same code path works for local disk and S3/R2).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  },
});

const trim = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

app.get("/api/photos", async (_req, res) => {
  try {
    res.json(await storage.readManifest());
  } catch (err) {
    console.error("readManifest error:", err?.message || err);
    res.status(502).json({ error: "Couldn't load photos." });
  }
});

app.post("/api/photos", limitWrites, (req, res) => {
  upload.single("photo")(req, res, async (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "That photo is over the 15 MB limit." : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: "Please choose a photo to upload." });

    const caption = trim(req.body.caption, 200);

    try {
      // Light moderation (no-op unless enabled — see moderation.js).
      const verdict = await moderatePhoto(anthropic, {
        buffer: req.file.buffer,
        mediaType: req.file.mimetype,
        caption,
      });
      if (!verdict.allowed) {
        return res.status(422).json({
          error: "Thanks! This photo wasn't approved for the public gallery. Please try a different one.",
        });
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const key = `${id}${EXT_FOR_TYPE[req.file.mimetype] || ".jpg"}`;
      const { url } = await storage.save({
        buffer: req.file.buffer,
        key,
        contentType: req.file.mimetype,
      });

      const entry = {
        id,
        key,
        url,
        uploader: trim(req.body.uploader, 80) || "A guest",
        caption,
        loves: 0,
        comments: [],
        uploadedAt: new Date().toISOString(),
      };
      await storage.appendManifest(entry);
      res.status(201).json(entry);
    } catch (e) {
      console.error("Photo upload error:", e?.message || e);
      res.status(502).json({ error: "Upload failed. Please try again." });
    }
  });
});

// Add a comment to a photo (public, moderated, rate-limited, honeypot-trapped).
app.post("/api/photos/:id/comments", limitWrites, honeypot, async (req, res) => {
  const name = trim(req.body && req.body.name, 80) || "A guest";
  const text = trim(req.body && req.body.text, 300);
  if (!text) return res.status(400).json({ error: "Please write a comment." });

  try {
    const verdict = await moderateText(anthropic, text);
    if (!verdict.allowed) {
      return res.status(422).json({ error: "Thanks! That comment wasn't approved for the public gallery." });
    }
  } catch (_) {/* fail open */}

  try {
    const list = await storage.readManifest();
    const entry = list.find((p) => p.id === req.params.id);
    if (!entry) return res.status(404).json({ error: "Photo not found." });
    const comment = {
      id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      text,
      at: new Date().toISOString(),
    };
    entry.comments = Array.isArray(entry.comments) ? entry.comments : [];
    entry.comments.push(comment);
    if (entry.comments.length > 300) entry.comments = entry.comments.slice(-300);
    await storage.writeManifest(list);
    res.status(201).json(comment);
  } catch (e) {
    console.error("Comment error:", e?.message || e);
    res.status(502).json({ error: "Could not post that comment." });
  }
});

// Heart a photo (no auth — simple engagement; client de-dupes per device).
app.post("/api/photos/:id/love", async (req, res) => {
  try {
    const list = await storage.readManifest();
    const entry = list.find((p) => p.id === req.params.id);
    if (!entry) return res.status(404).json({ error: "Photo not found." });
    entry.loves = (entry.loves || 0) + 1;
    await storage.writeManifest(list);
    res.json({ id: entry.id, loves: entry.loves });
  } catch (e) {
    console.error("Love error:", e?.message || e);
    res.status(502).json({ error: "Could not record that." });
  }
});

/* =========================================================
   Push notifications
   ========================================================= */
const push = createPush(DATA_DIR);

// Day-of reminders (UTC start times; 2 hours before each event).
// Times are US Eastern (EST = UTC-5 in November); startISO is the event start in UTC.
push.initReminders([
  { key: "haldi", title: "Haldi", startISO: "2026-11-06T16:00:00Z", timeLabel: "11:00 AM", loc: "Conrad New York Downtown" },
  { key: "sangeet", title: "Sangeet", startISO: "2026-11-07T00:00:00Z", timeLabel: "7:00 PM", loc: "The Lighthouse at Pier 61" },
  { key: "satbrunch", title: "Brunch", startISO: "2026-11-07T15:00:00Z", timeLabel: "10:00 AM", loc: "Conrad New York Downtown" },
  { key: "ceremony", title: "Wedding Ceremony", startISO: "2026-11-07T17:30:00Z", timeLabel: "12:30 PM", loc: "Conrad New York Downtown" },
  { key: "reception", title: "Reception", startISO: "2026-11-07T23:30:00Z", timeLabel: "6:30 PM", loc: "Hall des Lumières" },
]);

app.get("/api/push/key", (_req, res) => res.json({ enabled: push.enabled, key: push.publicKey() }));

app.post("/api/push/subscribe", (req, res) => {
  const ok = push.subscribe(req.body);
  res.status(ok ? 201 : 503).json({ ok });
});

app.post("/api/push/unsubscribe", (req, res) => {
  if (req.body && req.body.endpoint) push.unsubscribe(req.body.endpoint);
  res.json({ ok: true });
});

// Admin broadcast (e.g. day-of announcements).
app.post("/api/admin/push/broadcast", requireAdmin, async (req, res) => {
  const title = trimStr(req.body && req.body.title, 80) || "Priya & Sanjay";
  const body = trimStr(req.body && req.body.body, 200);
  if (!body) return res.status(400).json({ error: "Message is required." });
  const result = await push.broadcast({ title, body, url: "/" });
  res.json(result);
});

/* =========================================================
   Public aggregate stats (no PII)
   ========================================================= */
app.get("/api/stats", async (_req, res) => {
  const rsvps = readJson("rsvps.json");
  const accepting = rsvps.filter((x) => x.attending === "yes");
  const guests = accepting.reduce((n, x) => n + (parseInt(x.guests, 10) || 1), 0);
  let photos = 0;
  try {
    photos = (await storage.readManifest()).length;
  } catch (_) {}
  res.json({
    households: accepting.length,
    guests,
    photos,
    songs: readJson("songs.json").length,
    messages: readJson("guestbook.json").length,
  });
});

/* =========================================================
   RSVP
   ========================================================= */
app.post("/api/rsvp", limitWrites, honeypot, (req, res) => {
  const b = req.body || {};
  const name = trimStr(b.name, 120);
  const email = trimStr(b.email, 160);
  const attending = b.attending === "yes" || b.attending === "no" ? b.attending : "";
  if (!name || !email || !attending) {
    return res.status(400).json({ error: "Name, email and attendance are required." });
  }
  const entry = {
    id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name,
    email,
    attending,
    phone: trimStr(b.phone, 40),
    guests: Math.max(1, Math.min(12, parseInt(b.guests, 10) || 1)),
    children_under_12: Math.max(0, Math.min(12, parseInt(b.children_under_12, 10) || 0)),
    events: Array.isArray(b.events) ? b.events.map((e) => trimStr(e, 60)).filter(Boolean).slice(0, 10) : [],
    attendee_names: trimStr(b.attendee_names, 600),
    mailing_address: trimStr(b.mailing_address, 500),
    song: trimStr(b.song, 160),
    note: trimStr(b.note, 1200),
    party_issue: trimStr(b.party_issue, 1000),
    table: "",
    submittedAt: new Date().toISOString(),
  };
  appendJson("rsvps.json", entry);
  res.status(201).json({ ok: true });
});

/* =========================================================
   Find Your Seat — public lookup by name
   ========================================================= */
app.get("/api/seating", (req, res) => {
  const q = trimStr(req.query.q, 80).toLowerCase();
  if (!q) return res.status(400).json({ error: "Enter your name to search." });
  const matches = readJson("rsvps.json")
    .filter((r) => r.attending === "yes" && (r.name || "").toLowerCase().includes(q))
    .map((r) => ({ name: r.name, table: r.table || "" }));
  res.json({ matches });
});

/* =========================================================
   My RSVP — guest self-service lookup & update by email
   ========================================================= */
app.get("/api/rsvp/mine", (req, res) => {
  const email = trimStr(req.query.email, 160).toLowerCase();
  if (!email) return res.status(400).json({ error: "Enter your email." });
  const list = readJson("rsvps.json").filter((r) => (r.email || "").toLowerCase() === email);
  if (!list.length) return res.json({ found: false });
  const r = list[list.length - 1];
  res.json({
    found: true,
    rsvp: {
      name: r.name,
      email: r.email,
      attending: r.attending,
      guests: r.guests,
      events: r.events || [],
      meal: r.meal || "",
      hotelBlock: Boolean(r.hotelBlock),
      note: r.note || "",
      table: r.table || "",
    },
  });
});

app.post("/api/rsvp/update", limitWrites, honeypot, (req, res) => {
  const b = req.body || {};
  const email = trimStr(b.email, 160).toLowerCase();
  if (!email) return res.status(400).json({ error: "Email is required." });
  const list = readJson("rsvps.json");
  let idx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if ((list[i].email || "").toLowerCase() === email) { idx = i; break; }
  }
  if (idx < 0) return res.status(404).json({ error: "No RSVP found for that email. Please submit a new one." });
  const e = list[idx];
  if (b.name != null && trimStr(b.name, 120)) e.name = trimStr(b.name, 120);
  if (b.attending === "yes" || b.attending === "no") e.attending = b.attending;
  e.guests = Math.max(1, Math.min(12, parseInt(b.guests, 10) || e.guests || 1));
  e.children_under_12 = Math.max(0, Math.min(12, parseInt(b.children_under_12, 10) || 0));
  e.events = Array.isArray(b.events) ? b.events.map((x) => trimStr(x, 60)).filter(Boolean).slice(0, 10) : e.events;
  e.phone = trimStr(b.phone, 40);
  e.attendee_names = trimStr(b.attendee_names, 600);
  e.mailing_address = trimStr(b.mailing_address, 500);
  e.song = trimStr(b.song, 160);
  e.note = trimStr(b.note, 1200);
  e.party_issue = trimStr(b.party_issue, 1000);
  e.updatedAt = new Date().toISOString();
  writeJsonFile("rsvps.json", list);
  res.json({ ok: true });
});

/* =========================================================
   Guestbook
   ========================================================= */
app.get("/api/guestbook", (_req, res) => {
  // Only expose public fields.
  res.json(readJson("guestbook.json").map((e) => ({ name: e.name, message: e.message, at: e.at })));
});

app.post("/api/guestbook", limitWrites, honeypot, async (req, res) => {
  const name = trimStr(req.body && req.body.name, 80);
  const message = trimStr(req.body && req.body.message, 600);
  if (!name || !message) return res.status(400).json({ error: "Please add your name and a message." });

  try {
    const verdict = await moderateText(anthropic, message);
    if (!verdict.allowed) {
      return res.status(422).json({ error: "Thanks! That message wasn't approved for the public guestbook." });
    }
  } catch (_) {/* fail open */}

  const entry = { name, message, at: new Date().toISOString() };
  appendJson("guestbook.json", entry);
  res.status(201).json({ name: entry.name, message: entry.message, at: entry.at });
});

/* =========================================================
   Song requests (for the DJ)
   ========================================================= */
app.get("/api/songs", (_req, res) => {
  res.json(readJson("songs.json").map((s) => ({ song: s.song, artist: s.artist, by: s.by, at: s.at })));
});

app.post("/api/songs", limitWrites, honeypot, async (req, res) => {
  const b = req.body || {};
  const song = trimStr(b.song, 120);
  const artist = trimStr(b.artist, 120);
  const by = trimStr(b.by, 80);
  const note = trimStr(b.note, 200);
  if (!song) return res.status(400).json({ error: "Please add a song title." });

  try {
    const verdict = await moderateText(anthropic, `${song} — ${artist}. ${note}`);
    if (!verdict.allowed) return res.status(422).json({ error: "That request wasn't approved. Try another song." });
  } catch (_) {/* fail open */}

  const entry = { song, artist, by, note, at: new Date().toISOString() };
  appendJson("songs.json", entry);
  res.status(201).json({ song: entry.song, artist: entry.artist, by: entry.by, at: entry.at });
});

/* =========================================================
   Admin (RSVP dashboard) — protected by ADMIN_PASSWORD
   ========================================================= */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: "Admin dashboard is not configured (set ADMIN_PASSWORD)." });
  }
  const token = req.get("x-admin-token") || "";
  if (token !== ADMIN_PASSWORD) return res.status(401).json({ error: "Wrong password." });
  next();
}

app.get("/api/rsvp", requireAdmin, (_req, res) => {
  res.json(readJson("rsvps.json"));
});
app.get("/api/admin/guestbook", requireAdmin, (_req, res) => {
  res.json(readJson("guestbook.json"));
});
app.get("/api/admin/songs", requireAdmin, (_req, res) => {
  res.json(readJson("songs.json"));
});

// Assign / clear a table number for an RSVP (seating).
app.post("/api/admin/rsvp/:id/table", requireAdmin, (req, res) => {
  const list = readJson("rsvps.json");
  const entry = list.find((r) => r.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "RSVP not found." });
  entry.table = trimStr(req.body && req.body.table, 20);
  writeJsonFile("rsvps.json", list);
  res.json({ id: entry.id, table: entry.table });
});

// Remove an inappropriate photo (moderation).
app.delete("/api/photos/:id", requireAdmin, async (req, res) => {
  try {
    const list = await storage.readManifest();
    const entry = list.find((p) => p.id === req.params.id);
    if (!entry) return res.status(404).json({ error: "Photo not found." });
    if (entry.key) await storage.remove(entry.key);
    await storage.writeManifest(list.filter((p) => p.id !== entry.id));
    res.json({ ok: true });
  } catch (e) {
    console.error("Photo delete error:", e?.message || e);
    res.status(502).json({ error: "Could not delete the photo." });
  }
});

/* =========================================================
   Fallbacks
   ========================================================= */
// Unknown API route → JSON 404 (don't serve HTML to fetch() callers).
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// Any other unmatched GET → the styled 404 page (mirrors Cloudflare Pages).
app.use((req, res) => {
  if (req.method === "GET" && req.accepts("html")) {
    return res.status(404).sendFile(path.join(SITE_ROOT, "404.html"));
  }
  res.status(404).json({ error: "Not found." });
});

/* ========================================================= */

app.listen(PORT, () => {
  console.log(`Priya & Sanjay wedding app running at http://localhost:${PORT}`);
  console.log(hasApiKey ? "Concierge: enabled (Claude)" : "Concierge: disabled (set ANTHROPIC_API_KEY to enable)");
  console.log(`Photo storage: ${storage.kind}`);
  console.log(`Photo moderation: ${moderationEnabled(anthropic) ? "on (Claude vision)" : "off"}`);
  console.log(`Admin dashboard: ${ADMIN_PASSWORD ? "enabled (/admin.html)" : "disabled (set ADMIN_PASSWORD)"}`);
  console.log(`Push notifications: ${push.enabled ? "enabled" : "disabled (web-push not installed)"}`);
});
