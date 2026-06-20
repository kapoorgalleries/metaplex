/* =========================================================
   Light moderation for guest photo uploads.
   Uses Claude vision to decide whether a photo + caption is
   appropriate to publish on a family wedding website.
   Active only when an Anthropic client is available AND
   PHOTO_MODERATION is not "off". Fails OPEN (allows) on errors
   or unsupported image types so a hiccup never blocks guests.
   ========================================================= */
"use strict";

// Image types Claude vision accepts. Others (e.g. HEIC) skip moderation.
const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const MODERATION_SYSTEM = `
You are a content moderator for a public family wedding photo gallery.
Decide whether the supplied image (and its optional caption) is appropriate to publish.
ALLOW ordinary event photos: people, venues, food, decor, candid and posed shots, scenery.
BLOCK only: nudity or sexual content, graphic violence or gore, hateful or harassing
content, illegal content, or obvious spam/advertising unrelated to a wedding.
When uncertain, allow. Keep the reason to one short sentence.
`.trim();

const SCHEMA = {
  type: "object",
  properties: {
    allowed: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["allowed", "reason"],
  additionalProperties: false,
};

function isEnabled(anthropic) {
  return Boolean(anthropic) && process.env.PHOTO_MODERATION !== "off";
}

async function moderatePhoto(anthropic, { buffer, mediaType, caption }) {
  // Disabled, or an image type vision can't read → allow.
  if (!isEnabled(anthropic) || !VISION_TYPES.has(mediaType)) {
    return { allowed: true, reason: "moderation skipped" };
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 256,
      system: MODERATION_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") },
            },
            {
              type: "text",
              text: `Caption: ${caption ? JSON.stringify(caption) : "(none)"}. Is this appropriate to publish?`,
            },
          ],
        },
      ],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });

    // A safety refusal on the moderation call itself → treat as not allowed.
    if (response.stop_reason === "refusal") {
      return { allowed: false, reason: "Flagged by content review." };
    }

    const text = response.content.find((b) => b.type === "text")?.text || "{}";
    const verdict = JSON.parse(text);
    return {
      allowed: verdict.allowed !== false,
      reason: typeof verdict.reason === "string" ? verdict.reason : "",
    };
  } catch (err) {
    // Fail open — never block an upload because moderation errored.
    console.error("Moderation error (allowing upload):", err?.message || err);
    return { allowed: true, reason: "moderation unavailable" };
  }
}

module.exports = { moderatePhoto, isEnabled };
