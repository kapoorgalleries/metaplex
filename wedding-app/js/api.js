/* =========================================================
   Priya & Sanjay 2026 — backend-powered features
   Concierge chat + guest photo sharing.
   Degrades gracefully when the backend isn't running.
   ========================================================= */
(function () {
  "use strict";

  const galleryEl = document.getElementById("galleryGrid");

  /* ---------- Guest photos ---------- */
  function addGuestTile(photo) {
    if (!galleryEl) return;
    const tile = document.createElement("div");
    tile.className = "gallery__tile gallery__tile--photo visible";
    tile.style.backgroundImage = `url("${photo.url}")`;
    const cap = photo.caption || "";
    const who = photo.uploader ? `— ${photo.uploader}` : "";
    tile.innerHTML = `<span class="gallery__caption">${escapeHtml(cap)} ${escapeHtml(who)}</span>`;
    tile.addEventListener("click", () => openPhoto(photo));
    galleryEl.insertBefore(tile, galleryEl.firstChild);
  }

  function openPhoto(photo) {
    const lightbox = document.getElementById("lightbox");
    const stage = document.getElementById("lightboxStage");
    if (!lightbox || !stage) return;
    stage.style.background = `#2c1a16 url("${photo.url}") center/contain no-repeat`;
    stage.textContent = "";
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
  }

  function loadPhotos() {
    fetch("/api/photos")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (Array.isArray(list)) list.forEach(addGuestTile);
      })
      .catch(() => {/* backend not running; ignore */});
  }
  loadPhotos();

  const photoForm = document.getElementById("photoForm");
  const photoStatus = document.getElementById("photoStatus");
  if (photoForm) {
    photoForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fileInput = document.getElementById("photoInput");
      if (!fileInput.files || !fileInput.files[0]) {
        setStatus(photoStatus, "Please choose a photo first.", "err");
        return;
      }
      const data = new FormData(photoForm);
      setStatus(photoStatus, "Uploading…", "");
      fetch("/api/photos", { method: "POST", body: data })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error || "Upload failed.");
          return body;
        })
        .then((photo) => {
          addGuestTile(photo);
          photoForm.reset();
          setStatus(photoStatus, "Thank you! Your photo is now in the gallery. 💛", "ok");
        })
        .catch((err) => setStatus(photoStatus, err.message, "err"));
    });
  }

  /* ---------- Concierge chat ---------- */
  const fab = document.getElementById("conciergeFab");
  const panel = document.getElementById("conciergePanel");
  const closeBtn = document.getElementById("conciergeClose");
  const form = document.getElementById("conciergeForm");
  const input = document.getElementById("conciergeInput");
  const log = document.getElementById("conciergeLog");
  const history = [];

  // Only reveal the concierge if the backend says Claude is configured.
  fetch("/api/concierge")
    .then((r) => (r.ok ? r.json() : { available: false }))
    .then((info) => {
      if (info && info.available && fab) {
        fab.hidden = false;
        greet();
      }
    })
    .catch(() => {/* no backend; stay hidden */});

  function greet() {
    addBubble(
      "Hi! I'm the wedding concierge 💐 Ask me about events, dress codes, travel, or anything else about Priya & Sanjay's weekend.",
      "bot"
    );
  }

  function togglePanel(open) {
    if (!panel) return;
    panel.classList.toggle("open", open);
    panel.setAttribute("aria-hidden", String(!open));
    if (open) setTimeout(() => input && input.focus(), 50);
  }
  if (fab) fab.addEventListener("click", () => togglePanel(!panel.classList.contains("open")));
  if (closeBtn) closeBtn.addEventListener("click", () => togglePanel(false));

  function addBubble(text, who) {
    const b = document.createElement("div");
    b.className = `concierge__bubble concierge__bubble--${who}`;
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const msg = input.value.trim();
      if (!msg) return;
      addBubble(msg, "user");
      history.push({ role: "user", content: msg });
      input.value = "";
      const typing = addBubble("…", "bot");
      typing.classList.add("concierge__bubble--typing");

      fetch("/api/concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history: history.slice(0, -1) }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error || "Sorry, something went wrong.");
          return body.reply || "";
        })
        .then((reply) => {
          typing.remove();
          addBubble(reply, "bot");
          history.push({ role: "assistant", content: reply });
        })
        .catch((err) => {
          typing.remove();
          addBubble(err.message, "bot");
        });
    });
  }

  /* ---------- helpers ---------- */
  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg;
    el.className = "share__status" + (kind ? " " + kind : "");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
})();
