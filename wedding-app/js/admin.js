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

  const EVENTS = ["Mehndi & Haldi", "Sangeet", "Ceremony", "Reception"];
  const esc = (v) => window.escapeHtml(v == null ? "" : v);
  let token = sessionStorage.getItem("adminToken") || "";
  let active = "rsvps";
  const data = { rsvps: [], guestbook: [], songs: [] };

  const headers = () => ({ "x-admin-token": token });

  async function get(url) {
    const r = await fetch(url, { headers: headers() });
    if (r.status === 401) throw new Error("Wrong password.");
    if (r.status === 503) throw new Error("Dashboard isn't configured on the server (set ADMIN_PASSWORD).");
    if (!r.ok) throw new Error("Could not load data.");
    return r.json();
  }

  async function loadAll() {
    const [rsvps, guestbook, songs] = await Promise.all([
      get("/api/rsvp"),
      get("/api/admin/guestbook"),
      get("/api/admin/songs"),
    ]);
    data.rsvps = rsvps;
    data.guestbook = guestbook;
    data.songs = songs;
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
    ];
    statsEl.innerHTML = stats.map(([l, v]) => `<div class="admin__stat"><strong>${v}</strong><span>${esc(l)}</span></div>`).join("");
  }

  function when(v) { return v ? new Date(v).toLocaleString() : ""; }

  function renderTables() {
    document.querySelector("#tableRsvps tbody").innerHTML = data.rsvps.slice().reverse().map((x) => {
      const badge = x.attending === "yes" ? '<span class="badge badge--yes">Yes</span>' : '<span class="badge badge--no">No</span>';
      return `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${badge}</td><td>${esc(x.guests)}</td>
        <td>${esc((x.events || []).join(", "))}</td><td>${esc(x.meal)}</td><td>${x.hotelBlock ? "✓" : ""}</td>
        <td>${esc(x.note)}</td><td>${esc(when(x.submittedAt))}</td></tr>`;
    }).join("");

    document.querySelector("#tableGuestbook tbody").innerHTML = data.guestbook.slice().reverse().map((x) =>
      `<tr><td>${esc(x.name)}</td><td style="white-space:normal">${esc(x.message)}</td><td>${esc(when(x.at))}</td></tr>`
    ).join("");

    document.querySelector("#tableSongs tbody").innerHTML = data.songs.slice().reverse().map((x) =>
      `<tr><td>${esc(x.song)}</td><td>${esc(x.artist)}</td><td>${esc(x.by)}</td><td>${esc(x.note)}</td><td>${esc(when(x.at))}</td></tr>`
    ).join("");

    countEl.textContent = `${data[active].length} record${data[active].length === 1 ? "" : "s"}`;
  }

  function showTab(tab) {
    active = tab;
    tabsEl.querySelectorAll(".admin__tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
    document.querySelectorAll("table.admin__table").forEach((t) => (t.closest(".table-wrap").hidden = t.dataset.tab !== tab));
    countEl.textContent = `${data[active].length} record${data[active].length === 1 ? "" : "s"}`;
  }
  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".admin__tab");
    if (btn) showTab(btn.dataset.tab);
  });

  const COLS = {
    rsvps: ["name", "email", "attending", "guests", "events", "meal", "hotelBlock", "note", "submittedAt"],
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

  async function refresh() {
    await loadAll();
    renderStats();
    renderTables();
  }
  document.getElementById("refreshBtn").addEventListener("click", () => refresh().catch((e) => window.toast && window.toast(e.message, "err")));

  async function unlock() {
    loginStatus.textContent = "";
    try {
      await refresh();
      sessionStorage.setItem("adminToken", token);
      gate.hidden = true;
      panel.hidden = false;
      showTab("rsvps");
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
