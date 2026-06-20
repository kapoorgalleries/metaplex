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

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "1mb" }));

// ---------- Paths ----------
const SITE_ROOT = path.join(__dirname, ".."); // the wedding-app/ static site
const UPLOAD_DIR = path.join(__dirname, "uploads");
const MANIFEST = path.join(UPLOAD_DIR, "manifest.json");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Static hosting ----------
app.use(express.static(SITE_ROOT));
app.use("/uploads", express.static(UPLOAD_DIR));

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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext || ".jpg"}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  },
});

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch (_) {
    return [];
  }
}
function writeManifest(list) {
  fs.writeFileSync(MANIFEST, JSON.stringify(list, null, 2));
}

app.get("/api/photos", (_req, res) => {
  res.json(readManifest());
});

app.post("/api/photos", (req, res) => {
  upload.single("photo")(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "That photo is over the 15 MB limit." : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: "Please choose a photo to upload." });

    const trim = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const entry = {
      id: path.parse(req.file.filename).name,
      url: `/uploads/${req.file.filename}`,
      uploader: trim(req.body.uploader, 80) || "A guest",
      caption: trim(req.body.caption, 200),
      uploadedAt: new Date().toISOString(),
    };

    const list = readManifest();
    list.push(entry);
    writeManifest(list);
    res.status(201).json(entry);
  });
});

/* ========================================================= */

app.listen(PORT, () => {
  console.log(`Priya & Sanjay wedding app running at http://localhost:${PORT}`);
  console.log(hasApiKey ? "Concierge: enabled (Claude)" : "Concierge: disabled (set ANTHROPIC_API_KEY to enable)");
});
