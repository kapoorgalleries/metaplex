/* Priya & Sanjay 2026 — service worker (offline app shell) */
const CACHE = "psw-2026-v6";
const SHELL = [
  "index.html",
  "story.html",
  "schedule.html",
  "travel.html",
  "things-to-do.html",
  "party.html",
  "music.html",
  "registry.html",
  "gallery.html",
  "guestbook.html",
  "faq.html",
  "rsvp.html",
  "seating.html",
  "css/styles.css",
  "js/site.js",
  "js/home.js",
  "js/schedule.js",
  "js/gallery.js",
  "js/rsvp.js",
  "js/guestbook.js",
  "js/music.js",
  "js/seating.js",
  "js/now.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

/* ---- Push notifications ---- */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || "Priya & Sanjay";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) { w.navigate(url); return w.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache API writes
  const url = new URL(req.url);
  // Always go to network for the API; fall back to nothing.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req).catch(() => new Response("", { status: 503 })));
    return;
  }
  // Cache-first for the app shell, network fallback that fills the cache.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => cached)
    )
  );
});
