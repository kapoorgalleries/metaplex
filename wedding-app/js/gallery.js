/* Photos page: load + submit guest photos, with a lightbox. */
(function () {
  "use strict";
  const grid = document.getElementById("galleryGrid");
  const empty = document.getElementById("galleryEmpty");
  const lightbox = document.getElementById("lightbox");
  const stage = document.getElementById("lightboxStage");
  const capEl = document.getElementById("lightboxCap");
  const commentsEl = document.getElementById("lightboxComments");
  const commentForm = document.getElementById("commentForm");
  const commentName = document.getElementById("commentName");
  const commentText = document.getElementById("commentText");
  const commentStatus = document.getElementById("commentStatus");
  const tr = (k, fb) => (window.t ? window.t(k) : fb);
  let count = 0;
  let activePhoto = null;

  // Option A: when sharing the website's Supabase, photos are just image + caption
  // (moderated) — the schema has no comments/loves, so hide that UI.
  const useSupa = !!(window.Supa && window.Supa.enabled);
  if (useSupa && commentForm) commentForm.hidden = true;

  function renderComments(photo) {
    const list = Array.isArray(photo.comments) ? photo.comments : [];
    if (!list.length) {
      commentsEl.innerHTML = `<p class="lightbox__nocmt">${tr("ph.cmt.none", "No comments yet — say something kind!")}</p>`;
      return;
    }
    commentsEl.innerHTML = list
      .map(
        (c) =>
          `<div class="lightbox__cmt"><span class="lightbox__cmt-by">${window.escapeHtml(c.name || "A guest")}</span>` +
          `<span class="lightbox__cmt-text">${window.escapeHtml(c.text)}</span></div>`
      )
      .join("");
    commentsEl.scrollTop = commentsEl.scrollHeight;
  }

  function openPhoto(photo) {
    activePhoto = photo;
    stage.style.background = `#2c1a16 url("${photo.url}") center/contain no-repeat`;
    stage.textContent = "";
    const cap = photo.caption || "";
    const who = photo.uploader ? `— ${photo.uploader}` : "";
    capEl.textContent = `${cap} ${who}`.trim();
    capEl.hidden = !capEl.textContent;
    commentStatus.textContent = "";
    commentStatus.className = "lightbox__cstatus";
    const curated = !!photo.curated;
    if (useSupa || curated) { commentsEl.innerHTML = ""; commentsEl.hidden = true; }
    else { commentsEl.hidden = false; renderComments(photo); }
    if (!useSupa && commentForm) commentForm.hidden = curated;
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
  }
  function closeLightbox() {
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
    activePhoto = null;
  }
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  // Curated "Moments Together" tiles open in the same lightbox (the href is the
  // no-JS fallback).
  document.querySelectorAll("#momentsGrid .moments__tile").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openPhoto({ url: a.getAttribute("href"), caption: "", curated: true });
    });
  });
  lightbox.querySelector(".lightbox__close").addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && lightbox.classList.contains("open")) closeLightbox(); });

  commentForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activePhoto) return;
    const text = commentText.value.trim();
    if (!text) { commentStatus.textContent = tr("ph.cmt.need", "Write a comment first."); commentStatus.className = "lightbox__cstatus err"; return; }
    const payload = {
      name: commentName.value.trim() || (window.t ? window.t("ph.cmt.guest") : "A guest"),
      text,
      website: commentForm.elements["website"] ? commentForm.elements["website"].value : "",
    };
    commentStatus.textContent = tr("ph.cmt.posting", "Posting…");
    commentStatus.className = "lightbox__cstatus";
    const photo = activePhoto;
    fetch(`/api/photos/${encodeURIComponent(photo.id)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Could not post that comment.");
        return body;
      })
      .then((comment) => {
        photo.comments = Array.isArray(photo.comments) ? photo.comments : [];
        photo.comments.push(comment);
        if (activePhoto === photo) renderComments(photo);
        updateTileCommentCount(photo);
        commentText.value = "";
        commentStatus.textContent = "";
      })
      .catch((err) => { commentStatus.textContent = err.message; commentStatus.className = "lightbox__cstatus err"; });
  });

  function updateTileCommentCount(photo) {
    const el = grid.querySelector(`.gallery__cmtcount[data-id="${photo.id}"]`);
    const n = (photo.comments || []).length;
    if (el) { el.textContent = n; el.hidden = n === 0; }
  }

  // Lazy-load tile background images so a large album doesn't fetch everything at once.
  const lazyIO =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries, obs) =>
            entries.forEach((e) => {
              if (!e.isIntersecting) return;
              const t = e.target;
              if (t.dataset.bg) { t.style.backgroundImage = `url("${t.dataset.bg}")`; delete t.dataset.bg; t.classList.add("is-loaded"); }
              obs.unobserve(t);
            }),
          { rootMargin: "300px" }
        )
      : null;

  const loved = new Set(JSON.parse(localStorage.getItem("lovedPhotos") || "[]"));
  function rememberLove(id) {
    loved.add(id);
    localStorage.setItem("lovedPhotos", JSON.stringify([...loved]));
  }

  function addTile(photo, prepend) {
    const tile = document.createElement("div");
    tile.className = "gallery__tile gallery__tile--photo visible";
    // New uploads (prepend) are at the top and visible, so load now; otherwise lazy-load.
    if (prepend || !lazyIO) { tile.style.backgroundImage = `url("${photo.url}")`; tile.classList.add("is-loaded"); }
    else tile.dataset.bg = photo.url;
    const cap = photo.caption || "";
    const who = photo.uploader ? `— ${photo.uploader}` : "";
    const isLoved = loved.has(photo.id);
    const nComments = (photo.comments || []).length;
    const engagement = useSupa
      ? ""
      : `<button class="gallery__love${isLoved ? " is-loved" : ""}" aria-label="Love this photo">` +
        `<span class="gallery__heart">♥</span><span class="gallery__loves">${photo.loves || 0}</span></button>` +
        `<span class="gallery__cmtbadge" title="Comments">💬 <span class="gallery__cmtcount" data-id="${photo.id}"${nComments ? "" : " hidden"}>${nComments}</span></span>`;
    tile.innerHTML =
      engagement +
      `<span class="gallery__caption">${window.escapeHtml(cap)} ${window.escapeHtml(who)}</span>`;
    tile.addEventListener("click", () => openPhoto(photo));

    if (!useSupa) {
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
    }

    if (prepend) grid.insertBefore(tile, grid.firstChild);
    else grid.appendChild(tile);
    if (tile.dataset.bg && lazyIO) lazyIO.observe(tile);
    count++;
    if (empty) empty.hidden = count > 0;
  }

  function loadPhotos() {
    if (useSupa) {
      window.Supa.client().then((sb) => {
        if (!sb) { if (empty) empty.hidden = false; return; }
        sb.from("gallery_photos").select("storage_path,alt_text").eq("approved", true).order("created_at", { ascending: false })
          .then((r) => {
            if (r.error || !Array.isArray(r.data)) { if (empty) empty.hidden = false; return; }
            r.data.forEach((p) => { if (p.storage_path) addTile({ url: window.Supa.photoUrl(p.storage_path), caption: p.alt_text || "" }, false); });
            if (empty) empty.hidden = count > 0;
          });
      });
      return;
    }
    fetch("/api/photos")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (Array.isArray(list)) list.forEach((p) => addTile(p, false));
        if (empty) empty.hidden = count > 0;
      })
      .catch(() => { if (empty) empty.hidden = false; });
  }
  loadPhotos();

  const form = document.getElementById("photoForm");
  const status = document.getElementById("photoStatus");
  const fileInput = document.getElementById("photoInput");
  const cameraBtn = document.getElementById("cameraBtn");
  const cameraInput = document.getElementById("cameraInput");
  // The shared Supabase schema stores no captions, so hide the caption field there.
  if (useSupa && form.elements["caption"]) form.elements["caption"].hidden = true;
  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "share__status" + (kind ? " " + kind : "");
  }

  function upload(file) {
    if (!file) return setStatus("Please choose a photo first.", "err");
    // Same rules as the website: type/extension allowlist + 8 MB cap.
    const okType = /^image\/(jpeg|png|webp|avif|gif|heic|heif)$/i.test(file.type || "") ||
      /\.(jpe?g|png|webp|avif|gif|heic|heif)$/i.test(file.name || "");
    if (!okType) return setStatus("Please choose a JPEG, PNG, WebP, AVIF, GIF, or HEIC image.", "err");
    if (file.size > 8 * 1024 * 1024) return setStatus("Please choose an image under 8 MB.", "err");

    if (useSupa) {
      // Matches the website: upload to the guest-uploads bucket, then a moderated row.
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const rand = Math.random().toString(36).slice(2);
      const path = Date.now() + "-" + rand + "." + ext;
      setStatus("Uploading…", "");
      window.Supa.client().then((sb) => {
        if (!sb) return setStatus("Couldn't connect — please try again.", "err");
        sb.storage.from("guest-uploads").upload(path, file, { contentType: file.type }).then((u) => {
          if (u.error) return setStatus("Upload failed — please try again.", "err");
          // Matches the website: alt_text is always "Guest photo" — no captions stored.
          sb.from("gallery_photos").insert({ storage_path: path, alt_text: "Guest photo" }).then((i) => {
            if (i.error) { sb.storage.from("guest-uploads").remove([path]).catch(() => {}); return setStatus("Upload failed — please try again.", "err"); }
            form.reset();
            setStatus("Thank you! Your photo will appear once it's approved. 💛", "ok");
          });
        });
      });
      return;
    }

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
