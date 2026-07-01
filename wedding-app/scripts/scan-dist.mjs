#!/usr/bin/env node
/* =========================================================
   scan-dist.mjs — audit the built dist/ before it ships:
   no backend/tooling/secret files, no leaked credentials,
   and the service-worker shell matches the artifact exactly.
   ========================================================= */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const errors = [];
const fail = (m) => errors.push(m);

if (!fs.existsSync(DIST)) { console.error("✗ dist/ does not exist — run `npm run build` first."); process.exit(1); }

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = walk(DIST);
const relD = (p) => path.relative(DIST, p);

/* 1) No backend / tooling / private files may appear in the artifact. */
const FORBIDDEN = [
  /(^|\/)server(\/|$)/, /(^|\/)scripts(\/|$)/, /(^|\/)node_modules(\/|$)/,
  /(^|\/)data(\/|$)/, /(^|\/)uploads(\/|$)/,
  /(^|\/)package(-lock)?\.json$/, /(^|\/)yarn\.lock$/, /(^|\/)pnpm-lock\.yaml$/,
  /\.env(\.|$)/, /\.log$/, /\.md$/i, /(^|\/)\.gitignore$/, /\.(pem|key|p12|pfx)$/i,
  /migrations?\//i, /\.sql$/i, /\.(bak|dump)$/i,
];
for (const f of files) {
  const r = relD(f);
  for (const re of FORBIDDEN) if (re.test(r)) { fail(`forbidden file in dist: ${r}`); break; }
}

/* 2) No leaked secrets. (Public client config is fine; actual secrets are not.) */
const SECRETS = [
  { re: /-----BEGIN[A-Z ]*PRIVATE KEY-----/, what: "private key block" },
  { re: /\bsk-ant-[A-Za-z0-9_-]{8,}/, what: "Anthropic API key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, what: "AWS access key id" },
  { re: /\baws_secret_access_key\b/i, what: "AWS secret reference" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/, what: "JWT" },
  { re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?):\/\/[^\s"']+/i, what: "database connection URL" },
  { re: /\bservice_role\b/i, what: "service-role credential" },
  { re: /VAPID_PRIVATE_KEY|vapidPrivate/i, what: "VAPID private key" },
];
const textFiles = files.filter((f) => /\.(html|js|css|json|txt|xml|webmanifest)$/i.test(f));
for (const f of textFiles) {
  const txt = fs.readFileSync(f, "utf8");
  for (const s of SECRETS) if (s.re.test(txt)) fail(`possible ${s.what} in ${relD(f)}`);
}

/* 3) The service-worker shell must exactly match files present in the artifact. */
const sw = fs.existsSync(path.join(DIST, "sw.js")) ? fs.readFileSync(path.join(DIST, "sw.js"), "utf8") : "";
const shellM = sw.match(/const SHELL\s*=\s*\[([\s\S]*?)\]/);
if (!shellM) fail("sw.js missing from dist (or SHELL not found)");
else {
  const shell = (shellM[1].match(/"([^"]+)"/g) || []).map((q) => q.slice(1, -1));
  for (const asset of shell) if (!fs.existsSync(path.join(DIST, asset))) fail(`sw.js caches "${asset}" but it is not in dist/`);
}

if (errors.length) {
  console.error(`\n✗ dist scan failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):\n`);
  errors.forEach((e) => console.error("  • " + e));
  process.exit(1);
}
console.log(`✓ dist clean — ${files.length} files, no backend/tooling/secret files, SW shell matches the artifact.`);
