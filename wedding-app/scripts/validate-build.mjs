#!/usr/bin/env node
/* =========================================================
   validate-build.mjs — validate the wedding app SOURCE
   (the deployable frontend) before building a dist.
   Zero dependencies; Node built-ins only. Exit 1 on failure.
   ========================================================= */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.relative(ROOT, p);
const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// Directories that are NOT part of the deployable frontend.
const SKIP_DIRS = new Set(["server", "scripts", "node_modules", "dist", "data", "uploads", ".git"]);

function walk(dir, filter, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/* ---- Expected static pages (all must be present) ---- */
const EXPECTED_PAGES = [
  "index.html", "story.html", "schedule.html", "travel.html", "things-to-do.html",
  "party.html", "music.html", "seating.html", "pass.html", "registry.html",
  "gallery.html", "guestbook.html", "faq.html", "rsvp.html", "admin.html", "404.html",
];
for (const p of EXPECTED_PAGES) if (!exists(p)) fail(`Missing expected page: ${p}`);

/* ---- Per-page checks: doctype, title, and referenced local assets exist ---- */
const htmlFiles = walk(ROOT, (f) => f.endsWith(".html"));
const isExternal = (u) => /^(https?:)?\/\//i.test(u) || /^(data:|mailto:|tel:|javascript:|#)/i.test(u);
let cssRefs = 0, jsRefs = 0, assetRefs = 0;

for (const f of htmlFiles) {
  const html = fs.readFileSync(f, "utf8");
  const name = rel(f);
  if (!/^\s*<!doctype html>/i.test(html)) fail(`${name}: missing <!DOCTYPE html>`);
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(`${name}: missing a non-empty <title>`);

  // Every href/src that points at a local file must resolve to a real file.
  const refs = [...html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
  for (const ref of refs) {
    if (isExternal(ref)) continue;
    const clean = ref.split("#")[0].split("?")[0];
    if (!clean) continue;
    // Resolve root-absolute ("/css/..") against ROOT, else relative to the page's dir.
    const target = clean.startsWith("/")
      ? path.join(ROOT, clean)
      : path.resolve(path.dirname(f), clean);
    const kind = /\.css$/i.test(clean) ? "css" : /\.js$/i.test(clean) ? "js" : "asset";
    if (kind === "css") cssRefs++; else if (kind === "js") jsRefs++; else assetRefs++;
    if (!fs.existsSync(target)) fail(`${name}: broken ${kind} reference "${ref}" (no file at ${rel(target)})`);
  }
}

/* ---- No accidental local-development paths in shipped frontend ---- */
const DEV_PATTERNS = [
  /https?:\/\/localhost/i, /https?:\/\/127\.0\.0\.1/i, /\bfile:\/\//i,
  /\/Users\/[a-z]/i, /\/home\/[a-z]/i, /localhost:\d{2,5}/i, /127\.0\.0\.1:\d{2,5}/i,
];
const frontendText = walk(ROOT, (f) => /\.(html|css|js|json|webmanifest)$/i.test(f));
for (const f of frontendText) {
  const txt = fs.readFileSync(f, "utf8");
  for (const re of DEV_PATTERNS) {
    const m = txt.match(re);
    if (m) fail(`${rel(f)}: contains a local-development path "${m[0]}"`);
  }
}

/* ---- Service worker shell: every cached file must exist ---- */
const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const shellM = sw.match(/const SHELL\s*=\s*\[([\s\S]*?)\]/);
if (!shellM) fail("sw.js: could not find the SHELL array");
else {
  const shell = (shellM[1].match(/"([^"]+)"/g) || []).map((q) => q.slice(1, -1));
  for (const asset of shell) if (!exists(asset)) fail(`sw.js caches "${asset}" but that file is missing`);
  // Every expected page should be in the offline shell (except admin — private).
  for (const p of EXPECTED_PAGES) {
    if (p === "admin.html") continue;
    if (!shell.includes(p)) warn(`sw.js shell does not cache "${p}" (page won't work offline)`);
  }
}

/* ---- Service worker registration path is correct ---- */
const site = fs.readFileSync(path.join(ROOT, "js", "site.js"), "utf8");
if (!/serviceWorker\s*\.\s*register\(\s*["']sw\.js["']/.test(site))
  fail('js/site.js: service worker is not registered with register("sw.js")');

/* ---- manifest.json: valid JSON + required fields + icons exist ---- */
try {
  const mani = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  for (const k of ["name", "start_url", "display", "icons"]) if (!(k in mani)) fail(`manifest.json: missing "${k}"`);
  if (!Array.isArray(mani.icons) || !mani.icons.length) fail("manifest.json: no icons declared");
  for (const ic of mani.icons || []) if (ic.src && !exists(ic.src)) fail(`manifest.json: icon "${ic.src}" is missing`);
} catch (e) {
  fail(`manifest.json: invalid JSON — ${e.message}`);
}

/* ---- Required PWA icons ---- */
for (const ic of ["icons/icon-192.png", "icons/icon-512.png"]) if (!exists(ic)) fail(`Missing PWA icon: ${ic}`);

/* ---- Every JS file must parse ---- */
const jsFiles = walk(ROOT, (f) => f.endsWith(".js"));
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { fail(`JS syntax error in ${rel(f)}: ${(e.stderr || e.message).toString().trim()}`); }
}

/* ---- Report ---- */
for (const w of warnings) console.warn("  ! " + w);
if (errors.length) {
  console.error(`\n✗ Source validation failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):\n`);
  errors.forEach((e) => console.error("  • " + e));
  process.exit(1);
}
console.log(
  `✓ Source valid — ${EXPECTED_PAGES.length} pages, ${jsFiles.length} JS, ${cssRefs} CSS refs, ` +
  `${jsRefs} JS refs, ${assetRefs} asset refs resolved; SW shell, manifest, icons OK.`
);
