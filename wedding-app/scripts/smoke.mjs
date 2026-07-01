#!/usr/bin/env node
/* =========================================================
   smoke.mjs — serve the built dist/ over real HTTP and verify
   the STATIC site: pages return 200, assets load, JS parses,
   the 404 route works, and no shell asset is missing.
   NOTE: this proves the static build only. Dynamic features
   (RSVP, concierge, photos, push, email) require the Node API
   and are covered by backend integration tests, not here.
   ========================================================= */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
if (!fs.existsSync(DIST)) { console.error("✗ dist/ missing — run `npm run build` first."); process.exit(1); }

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };
const failures = [];

/* 0) Every shipped JS file must parse. */
function walk(dir, out = []) { for (const n of fs.readdirSync(dir)) { const f = path.join(dir, n); fs.statSync(f).isDirectory() ? walk(f, out) : out.push(f); } return out; }
const jsFiles = walk(DIST).filter((f) => f.endsWith(".js"));
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { failures.push(`JS syntax error in dist/${path.relative(DIST, f)}`); }
}

/* Minimal static server that mirrors Cloudflare Pages / the app's 404 behavior. */
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(DIST, path.normalize(p));
  if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } else {
    const nf = path.join(DIST, "404.html");
    res.writeHead(404, { "content-type": "text/html" });
    res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : "Not found");
  }
});

const swShell = (() => {
  const m = fs.readFileSync(path.join(DIST, "sw.js"), "utf8").match(/const SHELL\s*=\s*\[([\s\S]*?)\]/);
  return m ? (m[1].match(/"([^"]+)"/g) || []).map((q) => q.slice(1, -1)) : [];
})();

const PAGES = ["/", "/index.html", "/schedule.html", "/rsvp.html", "/pass.html", "/gallery.html", "/guestbook.html", "/story.html", "/admin.html"];
const ASSETS = ["/manifest.json", "/sw.js", "/css/styles.css", "/robots.txt", "/sitemap.xml"];

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
let ok = 0;

async function expect(pathname, code, bodyIncludes) {
  const res = await fetch(base + pathname);
  const body = bodyIncludes ? await res.text() : "";
  if (res.status !== code) return failures.push(`${pathname} → ${res.status}, expected ${code}`);
  if (bodyIncludes && !body.includes(bodyIncludes)) return failures.push(`${pathname} body missing "${bodyIncludes}"`);
  ok++;
}

for (const p of PAGES) await expect(p, 200);
for (const a of ASSETS) await expect(a, 200);
for (const s of swShell) await expect("/" + s, 200);           // no missing shell assets
await expect("/definitely-not-a-real-page", 404, "wandered off"); // styled 404 route

// A CSS sanity check (guards an empty/stripped stylesheet).
const css = await (await fetch(base + "/css/styles.css")).text();
if (css.length < 2000) failures.push("css/styles.css served but suspiciously small");

server.close();

if (failures.length) {
  console.error(`\n✗ Smoke test failed (${failures.length}):\n`);
  failures.forEach((f) => console.error("  • " + f));
  process.exit(1);
}
console.log(`✓ Static smoke test passed — ${ok} routes 200 (${PAGES.length} pages, ${ASSETS.length} assets, ${swShell.length} shell files), 404 route OK, ${jsFiles.length} JS parse.`);
console.log("  ↳ Not covered here (need the Node API): RSVP, concierge, photos, push, email. See DEPLOY.md.");
