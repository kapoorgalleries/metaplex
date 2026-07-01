/* Admin dashboard: password gate, stats, tabbed RSVPs/Guestbook/Songs, CSV export. */
(function () {
  "use strict";
  const gate = document.getElementById("adminGate");
  const panel = document.getElementById("adminPanel");
  const loginForm = document.getElementById("adminLogin");
  const pwInput = document.getElementById("adminPassword");
  const loginStatus = document.getElementById("adminStatus");
  const statsEl = document.getElementById("adminStats");
  const tabsEl = document.getElementById("adminTabs");
  const countEl = document.getElementById("tabCount");

  const EVENTS = ["Haldi", "Sangeet", "Ceremony", "Reception", "Farewell Brunch"];
  const esc = (v) => window.escapeHtml(v == null ? "" : v);
  let token = sessionStorage.getItem("adminToken") || "";
  let active = "rsvps";
  const data = { rsvps: [], guestbook: [], songs: [], photos: [] };

  const headers = () => ({ "x-admin-token": token });

  async function get(url) {
    const r = await fetch(url, { headers: headers() });
    if (r.status === 401) throw new Error("Wrong password.");
    if (r.status === 503) throw new Error("Dashboard isn't configured on the server (set ADMIN_PASSWORD).");
    if (!r.ok) throw new Error("Could not load data.");
    return r.json();
  }

  async function loadAll() {
    const [rsvps, guestbook, songs, photos] = await Promise.all([
      get("/api/rsvp"),
      get("/api/admin/guestbook"),
      get("/api/admin/songs"),
      fetch("/api/photos").then((r) => (r.ok ? r.json() : [])),
    ]);
    data.rsvps = rsvps;
    data.guestbook = guestbook;
    data.songs = songs;
    data.photos = Array.isArray(photos) ? photos : [];
  }

  function renderStats() {
    const accepting = data.rsvps.filter((x) => x.attending === "yes");
    const declining = data.rsvps.filter((x) => x.attending === "no");
    const heads = accepting.reduce((n, x) => n + (parseInt(x.guests, 10) || 1), 0);
    const perEvent = {};
    EVENTS.forEach((ev) => (perEvent[ev] = 0));
    accepting.forEach((x) => (x.events || []).forEach((ev) => { if (perEvent[ev] != null) perEvent[ev] += parseInt(x.guests, 10) || 1; }));
    const stats = [
      ["Responses", data.rsvps.length],
      ["Accepting", accepting.length],
      ["Declining", declining.length],
      ["Total guests", heads],
      ...EVENTS.map((ev) => [ev, perEvent[ev]]),
      ["Guestbook", data.guestbook.length],
      ["Song requests", data.songs.length],
      ["Photos", data.photos.length],
    ];
    statsEl.innerHTML = stats.map(([l, v]) => `<div class="admin__stat"><strong>${v}</strong><span>${esc(l)}</span></div>`).join("");
  }

  function when(v) { return v ? new Date(v).toLocaleString() : ""; }

  function renderTables() {
    document.querySelector("#tableRsvps tbody").innerHTML = data.rsvps.slice().reverse().map((x) => {
      const badge = x.attending === "yes" ? '<span class="badge badge--yes">Yes</span>' : '<span class="badge badge--no">No</span>';
      const table = x.attending === "yes"
        ? `<input class="admin__table-input" data-id="${esc(x.id)}" value="${esc(x.table || "")}" placeholder="—" />`
        : "";
      return `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${badge}</td><td>${esc(x.guests)}</td>
        <td>${esc((x.events || []).join(", "))}</td><td>${esc(x.meal)}</td><td>${x.hotelBlock ? "✓" : ""}</td>
        <td>${table}</td><td>${esc(x.note)}</td><td>${esc(when(x.submittedAt))}</td></tr>`;
    }).join("");
    document.querySelectorAll(".admin__table-input").forEach((inp) =>
      inp.addEventListener("change", () => saveTable(inp.dataset.id, inp.value.trim(), inp))
    );

    document.querySelector("#tableGuestbook tbody").innerHTML = data.guestbook.slice().reverse().map((x) =>
      `<tr><td>${esc(x.name)}</td><td style="white-space:normal">${esc(x.message)}</td><td>${esc(when(x.at))}</td></tr>`
    ).join("");

    document.querySelector("#tableSongs tbody").innerHTML = data.songs.slice().reverse().map((x) =>
      `<tr><td>${esc(x.song)}</td><td>${esc(x.artist)}</td><td>${esc(x.by)}</td><td>${esc(x.note)}</td><td>${esc(when(x.at))}</td></tr>`
    ).join("");

    renderPhotos();
    countEl.textContent = `${data[active].length} record${data[active].length === 1 ? "" : "s"}`;
  }

  async function saveTable(id, table, inp) {
    try {
      const r = await fetch(`/api/admin/rsvp/${encodeURIComponent(id)}/table`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ table }),
      });
      if (!r.ok) throw new Error("Save failed.");
      const entry = data.rsvps.find((x) => x.id === id);
      if (entry) entry.table = table;
      inp.classList.add("saved");
      setTimeout(() => inp.classList.remove("saved"), 900);
    } catch (e) {
      if (window.toast) window.toast(e.message, "err");
    }
  }

  const photosEl = document.getElementById("adminPhotos");
  function renderPhotos() {
    if (!data.photos.length) {
      photosEl.innerHTML = `<p class="guestbook__empty">No photos uploaded yet.</p>`;
      return;
    }
    photosEl.innerHTML = data.photos.slice().reverse().map((p) =>
      `<figure class="admin__photo">
        <img loading="lazy" src="${esc(p.url)}" alt="" />
        <figcaption>${esc(p.uploader || "A guest")} · ♥ ${esc(p.loves || 0)}</figcaption>
        <button class="admin__photo-del" data-id="${esc(p.id)}" aria-label="Delete photo">🗑</button>
      </figure>`
    ).join("");
    photosEl.querySelectorAll(".admin__photo-del").forEach((btn) =>
      btn.addEventListener("click", () => deletePhoto(btn.dataset.id))
    );
  }

  async function deletePhoto(id) {
    if (!confirm("Remove this photo from the gallery? This can't be undone.")) return;
    try {
      const r = await fetch(`/api/photos/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
      if (!r.ok) throw new Error("Delete failed.");
      data.photos = data.photos.filter((p) => p.id !== id);
      renderPhotos();
      renderStats();
      countEl.textContent = `${data.photos.length} record${data.photos.length === 1 ? "" : "s"}`;
      if (window.toast) window.toast("Photo removed", "ok");
    } catch (e) {
      if (window.toast) window.toast(e.message, "err");
    }
  }

  function showTab(tab) {
    active = tab;
    tabsEl.querySelectorAll(".admin__tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
    document.querySelectorAll(".admin__pane").forEach((p) => (p.hidden = p.dataset.tab !== tab));
    document.getElementById("exportCsv").style.display = tab === "photos" ? "none" : "";
    countEl.textContent = `${data[active].length} record${data[active].length === 1 ? "" : "s"}`;
  }
  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".admin__tab");
    if (btn) showTab(btn.dataset.tab);
  });

  const COLS = {
    rsvps: ["name", "email", "attending", "guests", "events", "meal", "hotelBlock", "table", "note", "submittedAt"],
    guestbook: ["name", "message", "at"],
    songs: ["song", "artist", "by", "note", "at"],
  };
  function toCsv(rows, cols) {
    const lines = rows.map((x) => cols.map((c) => {
      let v = x[c];
      if (Array.isArray(v)) v = v.join("; ");
      if (v == null) v = "";
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(","));
    return [cols.join(","), ...lines].join("\r\n");
  }

  document.getElementById("exportCsv").addEventListener("click", () => {
    const csv = toCsv(data[active], COLS[active]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active}-priya-sanjay-2026.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  /* ---------- Seating: auto-assign households into tables ---------- */
  const seatsInput = document.getElementById("seatsPerTable");
  const seatingSummary = document.getElementById("seatingSummary");

  function renderSeatingSummary() {
    const accepting = data.rsvps.filter((x) => x.attending === "yes");
    const assigned = accepting.filter((x) => x.table);
    const tables = {};
    accepting.forEach((x) => {
      if (!x.table) return;
      tables[x.table] = (tables[x.table] || 0) + (parseInt(x.guests, 10) || 1);
    });
    const tableCount = Object.keys(tables).length;
    seatingSummary.textContent = tableCount
      ? `${tableCount} table${tableCount === 1 ? "" : "s"} · ${assigned.length}/${accepting.length} households seated`
      : `${accepting.length} household${accepting.length === 1 ? "" : "s"} to seat`;
  }

  async function persistTables(updates) {
    // updates: [{id, table}] — save sequentially so we don't hammer the server.
    let ok = 0;
    for (const u of updates) {
      try {
        const r = await fetch(`/api/admin/rsvp/${encodeURIComponent(u.id)}/table`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers() },
          body: JSON.stringify({ table: u.table }),
        });
        if (r.ok) {
          ok++;
          const e = data.rsvps.find((x) => x.id === u.id);
          if (e) e.table = u.table;
        }
      } catch (_) {/* keep going */}
    }
    return ok;
  }

  async function autoAssign() {
    const seats = Math.max(2, Math.min(20, parseInt(seatsInput.value, 10) || 8));
    const households = data.rsvps
      .filter((x) => x.attending === "yes")
      .map((x) => ({ id: x.id, size: Math.max(1, parseInt(x.guests, 10) || 1) }))
      .sort((a, b) => b.size - a.size); // first-fit decreasing → fewer, fuller tables
    if (!households.length) return window.toast && window.toast("No accepting guests to seat yet.", "err");
    if (!confirm(`Auto-assign ${households.length} households into tables of ${seats}? This overwrites existing table numbers.`)) return;

    const tables = []; // each: remaining seats
    const updates = [];
    for (const h of households) {
      let idx = tables.findIndex((rem) => rem >= h.size);
      if (idx === -1) { tables.push(seats); idx = tables.length - 1; }
      tables[idx] -= h.size;
      updates.push({ id: h.id, table: String(idx + 1) });
    }
    if (window.toast) window.toast("Assigning tables…");
    const saved = await persistTables(updates);
    renderTables();
    renderSeatingSummary();
    if (window.toast) window.toast(`Seated ${saved} households across ${tables.length} tables ✓`, "ok");
  }

  async function clearTables() {
    const assigned = data.rsvps.filter((x) => x.attending === "yes" && x.table);
    if (!assigned.length) return window.toast && window.toast("No tables assigned yet.", "err");
    if (!confirm(`Clear table numbers for ${assigned.length} households?`)) return;
    const saved = await persistTables(assigned.map((x) => ({ id: x.id, table: "" })));
    renderTables();
    renderSeatingSummary();
    if (window.toast) window.toast(`Cleared ${saved} assignments`, "ok");
  }

  document.getElementById("autoAssignBtn").addEventListener("click", () => autoAssign());
  document.getElementById("clearTablesBtn").addEventListener("click", () => clearTables());

  /* ---------- Catering: dietary headcounts for the caterer ---------- */
  const mealSummaryEl = document.getElementById("mealSummary");

  function mealTally() {
    const accepting = data.rsvps.filter((x) => x.attending === "yes");
    const meals = {}; // label -> { households, heads }
    accepting.forEach((x) => {
      const label = (x.meal && x.meal.trim()) || "No preference";
      const heads = parseInt(x.guests, 10) || 1;
      if (!meals[label]) meals[label] = { households: 0, heads: 0 };
      meals[label].households += 1;
      meals[label].heads += heads;
    });
    const totalHeads = accepting.reduce((n, x) => n + (parseInt(x.guests, 10) || 1), 0);
    const hotel = accepting.filter((x) => x.hotelBlock).length;
    // Most specific diets first; "No preference" last.
    const order = Object.keys(meals).sort((a, b) => (a === "No preference" ? 1 : b === "No preference" ? -1 : a.localeCompare(b)));
    return { meals, order, totalHeads, hotel };
  }

  function renderCatering() {
    const { meals, order, totalHeads, hotel } = mealTally();
    if (!totalHeads) {
      mealSummaryEl.innerHTML = `<p style="color:var(--muted)">No accepting guests yet.</p>`;
      return;
    }
    const chips = order
      .map((label) => `<div class="admin__meal"><strong>${meals[label].heads}</strong><span>${esc(label)}</span><em>${meals[label].households} hh</em></div>`)
      .join("");
    mealSummaryEl.innerHTML =
      chips +
      `<div class="admin__meal admin__meal--total"><strong>${totalHeads}</strong><span>Total plates</span><em>${hotel} want hotel</em></div>`;
  }

  document.getElementById("exportMeals").addEventListener("click", () => {
    const { meals, order, totalHeads, hotel } = mealTally();
    const rows = [["Meal preference", "Households", "Guests (plates)"]];
    order.forEach((label) => rows.push([label, meals[label].households, meals[label].heads]));
    rows.push(["TOTAL", "", totalHeads]);
    rows.push(["Hotel-block requests", hotel, ""]);
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "catering-priya-sanjay-2026.csv";
    a.click();
    URL.revokeObjectURL(url);
  });

  async function refresh() {
    await loadAll();
    renderStats();
    renderTables();
    renderSeatingSummary();
    renderCatering();
  }
  document.getElementById("refreshBtn").addEventListener("click", () => refresh().catch((e) => window.toast && window.toast(e.message, "err")));

  // Announcements (push broadcast) — only shown if push is enabled server-side.
  const annForm = document.getElementById("announceForm");
  const annStatus = document.getElementById("annStatus");
  annForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("annTitle").value.trim();
    const body = document.getElementById("annBody").value.trim();
    if (!body) return;
    annStatus.textContent = "Sending…";
    annStatus.className = "rsvp__status";
    try {
      const r = await fetch("/api/admin/push/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ title, body }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Send failed.");
      annStatus.className = "rsvp__status ok";
      annStatus.textContent = `Sent to ${d.sent} device${d.sent === 1 ? "" : "s"}.`;
      annForm.reset();
    } catch (err) {
      annStatus.className = "rsvp__status err";
      annStatus.textContent = err.message;
    }
  });
  function maybeShowAnnounce() {
    fetch("/api/push/key")
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => { if (info && info.enabled) document.getElementById("announceCard").hidden = false; })
      .catch(() => {});
  }

  async function unlock() {
    loginStatus.textContent = "";
    try {
      await refresh();
      sessionStorage.setItem("adminToken", token);
      gate.hidden = true;
      panel.hidden = false;
      showTab("rsvps");
      maybeShowAnnounce();
    } catch (err) {
      token = "";
      sessionStorage.removeItem("adminToken");
      loginStatus.className = "rsvp__status err";
      loginStatus.textContent = err.message;
    }
  }
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    token = pwInput.value;
    unlock();
  });
  if (token) unlock();
})();
