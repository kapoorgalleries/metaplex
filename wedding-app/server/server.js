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

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "1mb" }));

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
COUPLE: Priya & Sanjay
DATE: Saturday, October 17, 2026
PLACE: Udaipur, India ("City of Lakes")
RSVP DEADLINE: August 15, 2026 (one submission per household)
CONTACT: priyaandsanjay2026@example.com

EVENTS (three days of celebration):
- Mehndi & Haldi — Fri, Oct 16, 11:00 AM, The Courtyard, Hotel Lakend. Dress: bright florals & yellows.
- Sangeet — Fri, Oct 16, 7:00 PM, Grand Ballroom, Hotel Lakend. Dress: Indian festive / cocktail.
- Wedding Ceremony — Sat, Oct 17, 5:00 PM, Lakeside Mandap, Lake Pichola. Dress: traditional formal.
- Reception — Sat, Oct 17, 8:30 PM, Terrace Gardens, Lake Pichola. Dress: black-tie / formal.

TRAVEL & STAY:
- Nearest airport: Maharana Pratap Airport (UDR), ~25 min from venues. Many guests connect via Delhi (DEL) or Mumbai (BOM).
- Room block at Hotel Lakend, discounted with code PRIYASANJAY26, book before Sep 1, 2026.
- Shuttles run from partner hotels to every event.

FAQ:
- Plus-ones: the invitation notes seats reserved per household; ask in the RSVP note if unsure.
- Children: warmly welcome — include them in the guest count.
- Dress code: each event has its own (see above); when in doubt, lean festive and colourful.
- Transport: shuttles run from partner hotels to all events; schedules shared with confirmed guests.
- Gifts: presence is the only present needed; a registry and honeymoon fund are available on the site.
`.trim();

const CONCIERGE_SYSTEM = `
You are the warm, helpful digital concierge for Priya & Sanjay's 2026 wedding website.
Answer guests' questions about the wedding using ONLY the facts provided below.
Be friendly and concise (2-4 sentences). Use a little warmth, not gushing.
If the answer isn't in the facts, say you're not sure and suggest emailing
priyaandsanjay2026@example.com — do not invent details (no made-up times, prices, or policies).
Politely decline anything unrelated to the wedding.

WEDDING FACTS:
${WEDDING_FACTS}
`.trim();

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
const anthropic = hasApiKey ? new Anthropic() : null; // reads ANTHROPIC_API_KEY

app.get("/api/concierge", (_req, res) => {
  res.json({ available: hasApiKey });
});

app.post("/api/concierge", async (req, res) => {
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
          "Sorry, I can't help with that one — but for anything about the wedding, email priyaandsanjay2026@example.com.",
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

app.post("/api/photos", (req, res) => {
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
        url,
        uploader: trim(req.body.uploader, 80) || "A guest",
        caption,
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

/* =========================================================
   RSVP
   ========================================================= */
app.post("/api/rsvp", (req, res) => {
  const b = req.body || {};
  const name = trimStr(b.name, 120);
  const email = trimStr(b.email, 160);
  const attending = b.attending === "yes" || b.attending === "no" ? b.attending : "";
  if (!name || !email || !attending) {
    return res.status(400).json({ error: "Name, email and attendance are required." });
  }
  const entry = {
    name,
    email,
    attending,
    guests: Math.max(1, Math.min(20, parseInt(b.guests, 10) || 1)),
    events: Array.isArray(b.events) ? b.events.map((e) => trimStr(e, 60)).filter(Boolean).slice(0, 10) : [],
    meal: trimStr(b.meal, 40),
    hotelBlock: Boolean(b.hotelBlock),
    note: trimStr(b.note, 1000),
    submittedAt: new Date().toISOString(),
  };
  appendJson("rsvps.json", entry);
  res.status(201).json({ ok: true });
});

/* =========================================================
   Guestbook
   ========================================================= */
app.get("/api/guestbook", (_req, res) => {
  // Only expose public fields.
  res.json(readJson("guestbook.json").map((e) => ({ name: e.name, message: e.message, at: e.at })));
});

app.post("/api/guestbook", async (req, res) => {
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

app.post("/api/songs", async (req, res) => {
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

/* ========================================================= */

app.listen(PORT, () => {
  console.log(`Priya & Sanjay wedding app running at http://localhost:${PORT}`);
  console.log(hasApiKey ? "Concierge: enabled (Claude)" : "Concierge: disabled (set ANTHROPIC_API_KEY to enable)");
  console.log(`Photo storage: ${storage.kind}`);
  console.log(`Photo moderation: ${moderationEnabled(anthropic) ? "on (Claude vision)" : "off"}`);
  console.log(`Admin dashboard: ${ADMIN_PASSWORD ? "enabled (/admin.html)" : "disabled (set ADMIN_PASSWORD)"}`);
});
