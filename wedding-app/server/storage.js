/* =========================================================
   Pluggable photo storage for the wedding app.
   - Default: local disk (server/uploads/)
   - S3-compatible: AWS S3 OR Cloudflare R2, selected by env vars
   Both backends expose the same async interface so server.js
   doesn't care which one is active.
   ========================================================= */
"use strict";

const path = require("path");
const fs = require("fs");

const MANIFEST_KEY = "manifest.json";

/* ---------- Local disk backend (default) ---------- */
function localStorage() {
  const UPLOAD_DIR = path.join(__dirname, "uploads");
  const MANIFEST = path.join(UPLOAD_DIR, MANIFEST_KEY);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  return {
    kind: "local",
    serveDir: UPLOAD_DIR, // server.js mounts this at /uploads
    async save({ buffer, key }) {
      fs.writeFileSync(path.join(UPLOAD_DIR, key), buffer);
      return { url: `/uploads/${key}` };
    },
    async readManifest() {
      try {
        return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
      } catch (_) {
        return [];
      }
    },
    async appendManifest(entry) {
      const list = await this.readManifest();
      list.push(entry);
      fs.writeFileSync(MANIFEST, JSON.stringify(list, null, 2));
      return entry;
    },
    async writeManifest(list) {
      fs.writeFileSync(MANIFEST, JSON.stringify(list, null, 2));
    },
    async remove(key) {
      try {
        fs.unlinkSync(path.join(UPLOAD_DIR, key));
      } catch (_) {/* already gone */}
    },
  };
}

/* ---------- S3 / R2 backend ---------- */
// Activated when PHOTO_S3_BUCKET is set. Works with AWS S3 (omit endpoint)
// or Cloudflare R2 (set PHOTO_S3_ENDPOINT to the R2 S3 API endpoint).
function s3Storage() {
  // Lazily required so the dependency is only needed when this backend is used.
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

  const Bucket = process.env.PHOTO_S3_BUCKET;
  const endpoint = process.env.PHOTO_S3_ENDPOINT || undefined; // R2: https://<acct>.r2.cloudflarestorage.com
  const region = process.env.PHOTO_S3_REGION || "auto"; // R2 uses "auto"
  const publicBase = (process.env.PHOTO_PUBLIC_BASE_URL || "").replace(/\/$/, "");

  if (!publicBase) {
    throw new Error(
      "PHOTO_PUBLIC_BASE_URL is required when PHOTO_S3_BUCKET is set " +
        "(the public URL base where uploaded photos are served)."
    );
  }

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: Boolean(endpoint), // path-style for R2 / custom endpoints
    credentials:
      process.env.PHOTO_S3_ACCESS_KEY_ID && process.env.PHOTO_S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.PHOTO_S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.PHOTO_S3_SECRET_ACCESS_KEY,
          }
        : undefined, // fall back to the default AWS credential chain
  });

  async function getObjectText(Key) {
    try {
      const out = await client.send(new GetObjectCommand({ Bucket, Key }));
      return await streamToString(out.Body);
    } catch (err) {
      if (err && (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404)) return null;
      throw err;
    }
  }

  return {
    kind: endpoint ? "r2" : "s3",
    serveDir: null, // objects are served from publicBase, not by this app
    async save({ buffer, key, contentType }) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: buffer, ContentType: contentType })
      );
      return { url: `${publicBase}/${key}` };
    },
    async readManifest() {
      const text = await getObjectText(MANIFEST_KEY);
      if (!text) return [];
      try {
        return JSON.parse(text);
      } catch (_) {
        return [];
      }
    },
    async appendManifest(entry) {
      const list = await this.readManifest();
      list.push(entry);
      await this.writeManifest(list);
      return entry;
    },
    async writeManifest(list) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: MANIFEST_KEY,
          Body: JSON.stringify(list, null, 2),
          ContentType: "application/json",
        })
      );
    },
    async remove(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
      } catch (_) {/* already gone */}
    },
  };
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function createStorage() {
  return process.env.PHOTO_S3_BUCKET ? s3Storage() : localStorage();
}

module.exports = { createStorage };
