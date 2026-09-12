/* =========================================================
   Shared Supabase client (Option A) — lets the app read/write
   the SAME data as the website (sanjaywedspriya.com), so a
   guestbook note or photo added in the app shows up in the
   couple's host dashboard and vice-versa.

   OPT-IN. Off by default so the app keeps using its own Node API
   until this is verified on a real deploy. Turn it on by either:
     • adding ?supa=1 to the URL, or
     • setting  window.SUPA_CONFIG = { enabled: true }  before this script.

   It matches the website's contract exactly:
     guestbook       → RPCs "list_guestbook" / "submit_guestbook" (approved-moderated)
     photo gallery   → storage bucket "guest-uploads" + table "gallery_photos"
                       ({storage_path, alt_text}, approved-moderated)
     RSVP            → RPCs lookup_guest_by_name / get_my_rsvp / submit_rsvp
   Public anon key only (RLS-protected) — never a service key.
   supabase-js is vendored (js/vendor/) like the website does, so the
   app never depends on a third-party CDN; esm.sh is a last-resort
   fallback only if the vendored file is missing.
   ========================================================= */
(function () {
  "use strict";
  var CFG = window.SUPA_CONFIG || {};
  var URL_ = CFG.url || "https://xgsfrltjnigsglkxhmsq.supabase.co";
  var ANON =
    CFG.anonKey ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhnc2ZybHRqbmlnc2dsa3hobXNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyODI3OTIsImV4cCI6MjA5Njg1ODc5Mn0.F6nVHkBmRDqZgFVOogSfXboc4MAox8hbUswZf5lLQwo";

  var flagged = false;
  try { flagged = new URLSearchParams(location.search).get("supa") === "1"; } catch (_) {}
  var enabled = CFG.enabled === true || flagged;

  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "js/vendor/supabase-js@2.js";
      s.onload = function () { resolve(window.supabase && window.supabase.createClient ? window.supabase : null); };
      s.onerror = function () {
        // Vendored copy missing (unusual) — fall back to the CDN module build.
        import("https://esm.sh/@supabase/supabase-js@2")
          .then(function (m) { resolve(m); }, function () { resolve(null); });
      };
      document.head.appendChild(s);
    });
  }

  var clientP = null;
  function client() {
    if (!enabled) return Promise.resolve(null);
    if (!clientP) {
      clientP = loadLib()
        .then(function (lib) { return lib ? lib.createClient(URL_, ANON, { auth: { persistSession: false } }) : null; })
        .catch(function (e) { console.error("Supabase load failed:", e); return null; });
    }
    return clientP;
  }

  window.Supa = {
    enabled: enabled,
    client: client,
    // Public URL for an uploaded photo's storage path (URL-encoded per segment, like the website).
    photoUrl: function (p) {
      return URL_ + "/storage/v1/object/public/guest-uploads/" + String(p).split("/").map(encodeURIComponent).join("/");
    },
  };
})();
