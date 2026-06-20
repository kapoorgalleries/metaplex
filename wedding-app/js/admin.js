/* Admin RSVP dashboard: password gate + stats + table + CSV export. */
(function () {
  "use strict";
  const gate = document.getElementById("adminGate");
  const panel = document.getElementById("adminPanel");
  const loginForm = document.getElementById("adminLogin");
  const pwInput = document.getElementById("adminPassword");
  const loginStatus = document.getElementById("adminStatus");
  const statsEl = document.getElementById("adminStats");
  const tbody = document.querySelector("#rsvpTable tbody");
  const countEl = document.getElementById("rsvpCount");

  let token = sessionStorage.getItem("adminToken") || "";
  let rows = [];

  const EVENTS = ["Mehndi & Haldi", "Sangeet", "Ceremony", "Reception"];

  function authHeaders() {
    return { "x-admin-token": token };
  }

  async function loadRsvps() {
    const r = await fetch("/api/rsvp", { headers: authHeaders() });
    if (r.status === 401) throw new Error("Wrong password.");
    if (r.status === 503) throw new Error("Dashboard isn't configured on the server (set ADMIN_PASSWORD).");
    if (!r.ok) throw new Error("Could not load RSVPs.");
    return r.json();
  }

  function render() {
    // Stats
    const attending = rows.filter((x) => x.attending === "yes");
    const declined = rows.filter((x) => x.attending === "no");
    const heads = attending.reduce((n, x) => n + (parseInt(x.guests, 10) || 1), 0);
    const perEvent = {};
    EVENTS.forEach((ev) => (perEvent[ev] = 0));
    attending.forEach((x) =>
      (x.events || []).forEach((ev) => {
        if (perEvent[ev] != null) perEvent[ev] += parseInt(x.guests, 10) || 1;
      })
    );
    const stats = [
      ["Responses", rows.length],
      ["Accepting", attending.length],
      ["Declining", declined.length],
      ["Total guests", heads],
      ...EVENTS.map((ev) => [ev, perEvent[ev]]),
    ];
    statsEl.innerHTML = stats
      .map(([label, val]) => `<div class="admin__stat"><strong>${val}</strong><span>${window.escapeHtml(label)}</span></div>`)
      .join("");

    // Table (newest first)
    tbody.innerHTML = rows
      .slice()
      .reverse()
      .map((x) => {
        const badge =
          x.attending === "yes"
            ? '<span class="badge badge--yes">Yes</span>'
            : '<span class="badge badge--no">No</span>';
        const when = x.submittedAt ? new Date(x.submittedAt).toLocaleString() : "";
        return `<tr>
          <td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${badge}</td>
          <td>${esc(x.guests)}</td><td>${esc((x.events || []).join(", "))}</td>
          <td>${esc(x.meal)}</td><td>${x.hotelBlock ? "✓" : ""}</td>
          <td>${esc(x.note)}</td><td>${esc(when)}</td>
        </tr>`;
      })
      .join("");
    countEl.textContent = `${rows.length} response${rows.length === 1 ? "" : "s"}`;
  }
  const esc = (v) => window.escapeHtml(v == null ? "" : v);

  function toCsv() {
    const cols = ["name", "email", "attending", "guests", "events", "meal", "hotelBlock", "note", "submittedAt"];
    const head = cols.join(",");
    const lines = rows.map((x) =>
      cols
        .map((c) => {
          let v = x[c];
          if (Array.isArray(v)) v = v.join("; ");
          if (v == null) v = "";
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(",")
    );
    return [head, ...lines].join("\r\n");
  }

  async function refresh() {
    rows = await loadRsvps();
    render();
  }

  async function unlock() {
    loginStatus.textContent = "";
    try {
      await refresh();
      sessionStorage.setItem("adminToken", token);
      gate.hidden = true;
      panel.hidden = false;
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

  document.getElementById("refreshBtn").addEventListener("click", () => refresh().catch((e) => alert(e.message)));
  document.getElementById("exportCsv").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([toCsv()], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "rsvps-priya-sanjay-2026.csv";
    a.click();
    URL.revokeObjectURL(url);
  });

  // If a token is already stored this session, try to resume.
  if (token) unlock();
})();
