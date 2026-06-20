/* Photos page: load + submit guest photos, with a lightbox. */
(function () {
  "use strict";
  const grid = document.getElementById("galleryGrid");
  const empty = document.getElementById("galleryEmpty");
  const lightbox = document.getElementById("lightbox");
  const stage = document.getElementById("lightboxStage");
  let count = 0;

  function openPhoto(photo) {
    stage.style.background = `#2c1a16 url("${photo.url}") center/contain no-repeat`;
    stage.textContent = "";
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
  }
  function closeLightbox() {
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
  }
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  lightbox.querySelector(".lightbox__close").addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

  function addTile(photo, prepend) {
    const tile = document.createElement("div");
    tile.className = "gallery__tile gallery__tile--photo visible";
    tile.style.backgroundImage = `url("${photo.url}")`;
    const cap = photo.caption || "";
    const who = photo.uploader ? `— ${photo.uploader}` : "";
    tile.innerHTML = `<span class="gallery__caption">${window.escapeHtml(cap)} ${window.escapeHtml(who)}</span>`;
    tile.addEventListener("click", () => openPhoto(photo));
    if (prepend) grid.insertBefore(tile, grid.firstChild);
    else grid.appendChild(tile);
    count++;
    if (empty) empty.hidden = count > 0;
  }

  fetch("/api/photos")
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => {
      if (Array.isArray(list)) list.forEach((p) => addTile(p, false));
      if (empty) empty.hidden = count > 0;
    })
    .catch(() => { if (empty) empty.hidden = false; });

  const form = document.getElementById("photoForm");
  const status = document.getElementById("photoStatus");
  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "share__status" + (kind ? " " + kind : "");
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fileInput = document.getElementById("photoInput");
    if (!fileInput.files || !fileInput.files[0]) return setStatus("Please choose a photo first.", "err");
    setStatus("Uploading…", "");
    fetch("/api/photos", { method: "POST", body: new FormData(form) })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Upload failed.");
        return body;
      })
      .then((photo) => {
        addTile(photo, true);
        form.reset();
        setStatus("Thank you! Your photo is now in the gallery. 💛", "ok");
      })
      .catch((err) => setStatus(err.message, "err"));
  });
})();
