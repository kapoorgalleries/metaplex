#!/usr/bin/env node
/* =========================================================
   build.mjs — produce a clean, deterministic deploy artifact
   at wedding-app/dist/ containing ONLY the deployable static
   frontend (no server, tooling, secrets, or local data).
   Zero dependencies; Node built-ins only.
   ========================================================= */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

// Explicit allow-list of what ships. Anything not listed is excluded by default.
const INCLUDE_DIRS = ["css", "js", "icons", "assets"];
const INCLUDE_FILES = ["manifest.webmanifest", "sw.js", "robots.txt"];
// Everything else (server/, scripts/, data/, uploads/, package*.json, README.md,
// DEPLOY.md, .gitignore, .env*, *.log, node_modules/, dist/) is intentionally omitted.

let fileCount = 0;
const byExt = {};

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src).sort()) {
    // Never copy stray secrets/logs even if they land inside an included dir.
    if (/\.(env|log|pem|key)$/i.test(name) || name === ".DS_Store") continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  fileCount++;
  const ext = (path.extname(src).slice(1) || "other").toLowerCase();
  byExt[ext] = (byExt[ext] || 0) + 1;
}

// 1) Clean stale output.
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 2) All top-level HTML pages.
for (const name of fs.readdirSync(ROOT).sort()) {
  if (name.endsWith(".html")) copyFile(path.join(ROOT, name), path.join(DIST, name));
}
// 3) Whitelisted directories + files.
for (const dir of INCLUDE_DIRS) {
  const s = path.join(ROOT, dir);
  if (fs.existsSync(s)) copyDir(s, path.join(DIST, dir));
}
for (const file of INCLUDE_FILES) {
  const s = path.join(ROOT, file);
  if (fs.existsSync(s)) copyFile(s, path.join(DIST, file));
}

const summary = Object.entries(byExt).sort().map(([k, v]) => `${v} ${k}`).join(", ");
console.log(`✓ Built dist/ — ${fileCount} files (${summary}).`);
