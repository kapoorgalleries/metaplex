#!/usr/bin/env node
/* =========================================================
   Wedding app "build" = validate the static site + server so
   the repo's CI can gate it like any other build target.
   Pure Node built-ins; no dependencies. Exit 1 on any failure.
   ========================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const rel = (p) => path.relative(ROOT, p);
const errors = [];
const fail = (msg) => errors.push(msg);

function walk(dir, filter, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "data" || name === "uploads" || name === ".git") continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

/* 1) Every JS file must parse. */
const jsFiles = walk(ROOT, (f) => f.endsWith(".js") && !f.includes("scripts/validate.js"));
for (const f of jsFiles) {
  try {
    execFileSync("node", ["--check", f], { stdio: "pipe" });
  } catch (e) {
    fail(`JS syntax error in ${rel(f)}:\n${(e.stderr || e.message).toString().trim()}`);
  }
}

/* 2) Every JSON file must parse. */
for (const f of walk(ROOT, (f) => f.endsWith(".json"))) {
  try {
    JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    fail(`Invalid JSON in ${rel(f)}: ${e.message}`);
  }
}

/* 3) Every HTML page must have a doctype and a <title>. */
const htmlFiles = walk(ROOT, (f) => f.endsWith(".html"));
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, "utf8");
  if (!/^\s*<!doctype html>/i.test(html)) fail(`${rel(f)} is missing <!DOCTYPE html>`);
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(`${rel(f)} is missing a non-empty <title>`);
}

/* 4) styles.css must exist and be substantial — guards the .gitignore
      regression where the stylesheet was excluded and the app shipped unstyled. */
const cssPath = path.join(ROOT, "css", "styles.css");
if (!fs.existsSync(cssPath)) fail("css/styles.css is missing");
else if (fs.statSync(cssPath).size < 2000) fail("css/styles.css is suspiciously small — did it get stripped?");

/* 5) Every file the service worker promises to cache must exist. */
const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const shellMatch = sw.match(/const SHELL\s*=\s*\[([\s\S]*?)\]/);
if (!shellMatch) fail("Could not find the SHELL list in sw.js");
else {
  const shell = shellMatch[1].match(/"([^"]+)"/g) || [];
  for (const q of shell) {
    const asset = q.slice(1, -1);
    if (!fs.existsSync(path.join(ROOT, asset))) fail(`sw.js caches "${asset}" but that file does not exist`);
  }
}

/* 6) Core PWA assets present. */
for (const asset of ["manifest.json", "robots.txt", "sitemap.xml", "assets/og.png", "icons/icon-192.png", "icons/icon-512.png"]) {
  if (!fs.existsSync(path.join(ROOT, asset))) fail(`Missing required asset: ${asset}`);
}

/* ---- Report ---- */
if (errors.length) {
  console.error(`\n✗ Wedding app validation failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):\n`);
  errors.forEach((e) => console.error("  • " + e));
  process.exit(1);
}
console.log(
  `✓ Wedding app OK — ${jsFiles.length} JS, ${htmlFiles.length} HTML pages, CSS + service-worker shell + PWA assets all present and valid.`
);
