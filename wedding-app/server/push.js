/* =========================================================
   Web Push notifications for the wedding app.
   - VAPID keys: from env, else generated once and persisted.
   - Subscriptions stored as JSON; dead ones (404/410) pruned.
   - Day-of reminders: fires once per event, a lead time before.
   Degrades to a no-op if web-push isn't installed.
   ========================================================= */
"use strict";

const fs = require("fs");
const path = require("path");

let webpush = null;
try {
  webpush = require("web-push");
} catch (_) {
  webpush = null;
}

module.exports = function createPush(DATA_DIR) {
  const SUBS = path.join(DATA_DIR, "push-subs.json");
  const VAPID = path.join(DATA_DIR, "vapid.json");
  const SENT = path.join(DATA_DIR, "push-sent.json");

  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return d; } };
  const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

  const enabled = Boolean(webpush);
  let keys = null;

  if (enabled) {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    } else {
      keys = read(VAPID, null);
      if (!keys || !keys.publicKey) {
        keys = webpush.generateVAPIDKeys();
        write(VAPID, keys);
      }
    }
    const contact = process.env.VAPID_CONTACT || "mailto:sonal@sjsevents.com";
    webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey);
  }

  const subs = () => read(SUBS, []);
  const saveSubs = (list) => write(SUBS, list);

  async function sendOne(sub, payload) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      return "ok";
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) return "gone";
      return "fail";
    }
  }

  async function broadcast(payload) {
    if (!enabled) return { enabled: false, sent: 0, removed: 0 };
    const list = subs();
    const keep = [];
    let sent = 0;
    for (const s of list) {
      const r = await sendOne(s, payload);
      if (r === "gone") continue; // drop dead subscription
      keep.push(s);
      if (r === "ok") sent++;
    }
    saveSubs(keep);
    return { enabled: true, sent, removed: list.length - keep.length };
  }

  return {
    enabled,
    publicKey: () => (enabled ? keys.publicKey : null),
    count: () => subs().length,
    subscribe(sub) {
      if (!enabled || !sub || !sub.endpoint) return false;
      const list = subs();
      if (!list.find((s) => s.endpoint === sub.endpoint)) {
        list.push(sub);
        saveSubs(list);
      }
      return true;
    },
    unsubscribe(endpoint) {
      if (!endpoint) return;
      saveSubs(subs().filter((s) => s.endpoint !== endpoint));
    },
    broadcast,
    // Fire a reminder once per event, `leadMs` before it starts.
    initReminders(events, leadMs) {
      if (!enabled) return;
      const lead = leadMs || 2 * 60 * 60 * 1000; // default 2h
      const tick = async () => {
        const now = Date.now();
        const sent = read(SENT, {});
        for (const ev of events) {
          const start = Date.parse(ev.startISO);
          if (isNaN(start)) continue;
          const key = "rem-" + ev.key;
          if (!sent[key] && now >= start - lead && now < start) {
            await broadcast({
              title: `Starting soon: ${ev.title}`,
              body: `${ev.title} begins at ${ev.timeLabel} · ${ev.loc}`,
              url: "/schedule.html",
            });
            sent[key] = new Date().toISOString();
            write(SENT, sent);
          }
        }
      };
      const timer = setInterval(tick, 60 * 1000);
      if (timer.unref) timer.unref();
    },
  };
};
