/* Song requests: load + submit (Node mode). On the static shared deployment
   (Supabase mode) there is no /api — song requests are collected with the RSVP
   (p_song_request), so this page just points guests to the RSVP form. */
(function () {
  "use strict";
  const form = document.getElementById("songForm");
  const status = document.getElementById("songStatus");
  const list = document.getElementById("songList");
  const empty = document.getElementById("songEmpty");
  const viaRsvp = document.getElementById("songViaRsvp");
  let count = 0;

  if (window.Supa && window.Supa.enabled) {
    if (viaRsvp) viaRsvp.hidden = false;
    if (form) form.hidden = true;
    if (list) list.hidden = true;
    if (empty) empty.hidden = true;
    return;
  }

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "rsvp__status" + (kind ? " " + kind : "");
  }

  function addSong(s, prepend) {
    const node = document.createElement("div");
    node.className = "song";
    const meta = [s.artist, s.by ? `requested by ${s.by}` : ""].filter(Boolean).join(" · ");
    node.innerHTML =
      `<div class="song__note">🎵</div>` +
      `<div><div class="song__title">${window.escapeHtml(s.song)}</div>` +
      `<div class="song__meta">${window.escapeHtml(meta)}</div></div>`;
    if (prepend) list.insertBefore(node, list.firstChild);
    else list.appendChild(node);
    count++;
    if (empty) empty.hidden = count > 0;
  }

  fetch("/api/songs")
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => {
      if (Array.isArray(rows)) rows.slice().reverse().forEach((s) => addSong(s, false));
      if (empty) empty.hidden = count > 0;
    })
    .catch(() => { if (empty) empty.hidden = false; });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = {
      song: form.elements["song"].value.trim(),
      artist: form.elements["artist"].value.trim(),
      by: form.elements["by"].value.trim(),
      note: form.elements["note"].value.trim(),
      website: form.elements["website"] ? form.elements["website"].value : "",
    };
    if (!data.song) return setStatus("Please add a song title.", "err");
    setStatus("Adding…", "");
    fetch("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Could not add your song.");
        return body;
      })
      .then((s) => {
        addSong(s, true);
        form.reset();
        setStatus("", "");
        if (window.toast) window.toast("Added to the playlist 🎶", "ok");
      })
      .catch((err) => setStatus(err.message, "err"));
  });
})();
