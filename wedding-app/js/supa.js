/* =========================================================
   Shared Supabase client (Option A) — lets the app read/write
   the SAME data as the website (priyasanjay.pages.dev), so a
   guestbook note or photo added in the app shows up in the
   couple's host dashboard and vice-versa.

   OPT-IN. Off by default so the app keeps using its own Node API
   until this is verified on a real deploy. Turn it on by either:
     • adding ?supa=1 to the URL, or
     • setting  window.SUPA_CONFIG = { enabled: true }  before this script.

   It matches the website's contract exactly:
     guestbook       → table "guestbook" ({name, message}, approved-moderated)
     photo gallery   → storage bucket "guest-uploads" + table "gallery_photos"
                       ({storage_path, alt_text}, approved-moderated)
   Public anon key only (RLS-protected) — never a service key.
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

  var clientP = null;
  function client() {
    if (!enabled) return Promise.resolve(null);
    if (!clientP) {
      // Load supabase-js v2 (same major the website uses) as an ES module.
      clientP = import("https://esm.sh/@supabase/supabase-js@2")
        .then(function (m) { return m.createClient(URL_, ANON, { auth: { persistSession: false } }); })
        .catch(function (e) { console.error("Supabase load failed:", e); return null; });
    }
    return clientP;
  }

  window.Supa = {
    enabled: enabled,
    client: client,
    // Public URL for an uploaded photo's storage path.
    photoUrl: function (p) { return URL_ + "/storage/v1/object/public/guest-uploads/" + p; },
  };
})();
