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

  const loved = new Set(JSON.parse(localStorage.getItem("lovedPhotos") || "[]"));
  function rememberLove(id) {
    loved.add(id);
    localStorage.setItem("lovedPhotos", JSON.stringify([...loved]));
  }

  function addTile(photo, prepend) {
    const tile = document.createElement("div");
    tile.className = "gallery__tile gallery__tile--photo visible";
    tile.style.backgroundImage = `url("${photo.url}")`;
    const cap = photo.caption || "";
    const who = photo.uploader ? `— ${photo.uploader}` : "";
    const isLoved = loved.has(photo.id);
    tile.innerHTML =
      `<button class="gallery__love${isLoved ? " is-loved" : ""}" aria-label="Love this photo">` +
      `<span class="gallery__heart">♥</span><span class="gallery__loves">${photo.loves || 0}</span></button>` +
      `<span class="gallery__caption">${window.escapeHtml(cap)} ${window.escapeHtml(who)}</span>`;
    tile.addEventListener("click", () => openPhoto(photo));

    const loveBtn = tile.querySelector(".gallery__love");
    const lovesEl = tile.querySelector(".gallery__loves");
    loveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (loved.has(photo.id)) return;
      rememberLove(photo.id);
      loveBtn.classList.add("is-loved");
      lovesEl.textContent = (photo.loves || 0) + 1; // optimistic
      fetch(`/api/photos/${encodeURIComponent(photo.id)}/love`, { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) { photo.loves = d.loves; lovesEl.textContent = d.loves; } })
        .catch(() => {});
    });

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
  const fileInput = document.getElementById("photoInput");
  const cameraBtn = document.getElementById("cameraBtn");
  const cameraInput = document.getElementById("cameraInput");
  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "share__status" + (kind ? " " + kind : "");
  }

  function upload(file) {
    if (!file) return setStatus("Please choose a photo first.", "err");
    const data = new FormData();
    data.append("uploader", form.elements["uploader"].value);
    data.append("caption", form.elements["caption"].value);
    data.append("photo", file);
    setStatus("Uploading…", "");
    fetch("/api/photos", { method: "POST", body: data })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Upload failed.");
        return body;
      })
      .then((photo) => {
        addTile(photo, true);
        form.reset();
        setStatus("", "");
        if (window.toast) window.toast("Your photo is in the gallery 💛", "ok");
      })
      .catch((err) => setStatus(err.message, "err"));
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    upload(fileInput.files && fileInput.files[0]);
  });
  cameraBtn.addEventListener("click", () => cameraInput.click());
  cameraInput.addEventListener("change", () => upload(cameraInput.files && cameraInput.files[0]));
})();
