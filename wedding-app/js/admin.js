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

  // The four RSVP events, exactly as stored by the site's RSVP form.
  const EVENTS = ["Haldi", "Sangeet", "Wedding Ceremony", "Reception"];
  const esc = (v) => window.escapeHtml(v == null ? "" : v);
  let token = sessionStorage.getItem("adminToken") || "";
  let active = "rsvps";
  const data = { rsvps: [], guestbook: [], songs: [], photos: [] };

  const headers = () => ({ "x-admin-token": token });

  /* =========================================================
     Supabase (shared-site) mode — when the app shares the
     website's data (window.Supa), the hosts dashboard speaks
     the site's RPC contract instead of the Node /api.
     The passcode lives in memory only — never persisted
     (site policy: never store the host passcode or guest
     phone numbers on the device).
     ========================================================= */
  if (window.Supa && window.Supa.enabled) {
    const supaPanel = document.getElementById("supaPanel");
    const summaryEl = document.getElementById("supaSummary");
    const pendingTitle = document.getElementById("supaPendingTitle");
    const pendingEl = document.getElementById("supaPending");
    const supaStatus = document.getElementById("supaStatus");

    // Re-word the gate for the site's passcode (not the Node password).
    const gateHeading = gate.querySelector("h3");
    if (gateHeading) gateHeading.textContent = "Enter the dashboard passcode";
    pwInput.placeholder = "Passcode";
    pwInput.setAttribute("autocomplete", "off");
    const loginBtn = loginForm.querySelector('button[type="submit"]');
    if (loginBtn) loginBtn.textContent = "Load";

    let pass = null;
    const sb = () => window.Supa.client();
    const h3 = (label, tag) =>
      `<h3 class="hd-h3">${label}${tag != null ? ` <span class="hd-tag">${esc(tag)}</span>` : ""}</h3>`;

    function renderSummary(d) {
      const perEvent = d.per_event || {};
      let H = "";

      H += `<div class="admin__stats">` + [
        [d.guests_invited, "Invited"],
        [d.rsvps_received, "Responded"],
        [d.guests_coming, "Guests coming"],
        [d.not_replied, "Not replied"],
      ].map(([n, l]) => `<div class="admin__stat"><strong>${esc(n == null ? "—" : n)}</strong><span>${l}</span></div>`).join("") + `</div>`;

      const issues = Array.isArray(d.party_issues) ? d.party_issues : [];
      if (issues.length) {
        H += h3("Invitation problems reported", issues.length);
        issues.forEach((pi) => {
          H += `<div class="hd-row hd-row--urgent"><div><strong>${esc(pi.household)}</strong>${pi.who ? " · " + esc(pi.who) : ""}</div>` +
            `<div>${esc(pi.message)}</div>` +
            `<div class="hd-sub">${esc(String(pi.at || "").slice(0, 16).replace("T", " "))}</div></div>`;
        });
      }

      const selfAdd = Array.isArray(d.self_review) ? d.self_review : [];
      if (selfAdd.length) {
        H += h3("Self-added — tick to approve", selfAdd.length);
        selfAdd.forEach((s) => {
          H += `<div class="hd-row hd-row--flex"><span>${esc(s.name)}</span>` +
            `<span class="hd-mini"><span class="hd-tag">${esc(s.at || "")}</span>` +
            `<button class="hd-approve" data-selfrev="${esc(s.id)}">✓ Approve</button></span></div>`;
        });
      }

      const reps = Array.isArray(d.rsvps) ? d.rsvps : [];
      H += h3("Who has replied", reps.length);
      if (reps.length) reps.forEach((r) => {
        const evs = (r.events || []).join(", ");
        const kids = r.children ? ` · ${esc(r.children)} under 12` : "";
        const extra = [];
        if (r.attending) {
          if (r.who) extra.push(`<strong>Coming:</strong> ${esc(r.who)}`);
          const miss = (r.names_missing == null) ? (r.who ? 0 : (r.count || 0)) : r.names_missing;
          if (miss > 0) extra.push(`<span class="hd-warn">` +
            (r.who ? `${esc(miss)} more not yet named` : `${esc(miss)} guest${miss == 1 ? "" : "s"} not yet named`) + `</span>`);
          if (r.names_over > 0) extra.push(`<span class="hd-warn">${esc(r.names_over)} more named than seats — check plus-ones</span>`);
        }
        if (r.email) extra.push(esc(r.email));
        if (r.address) extra.push("✉ " + esc(r.address));
        if (r.phone) extra.push(esc(r.phone));
        if (r.song) extra.push("♪ " + esc(r.song));
        if (r.note) extra.push("“" + esc(r.note) + "”");
        H += `<div class="hd-row"><div class="hd-row--flex"><span><strong>${esc(r.name)}</strong>` +
          (r.attending ? ` · ${r.count != null ? esc(r.count) + " " : ""}attending${kids}` : " · <em>regrets</em>") +
          `</span><span class="hd-tag">${esc(r.at || "")}</span></div>` +
          (r.attending && evs ? `<div class="hd-ev">${esc(evs)}</div>` : "") +
          (extra.length ? `<div class="hd-sub">${extra.join(" · ")}</div>` : "") + `</div>`;
      });
      else H += `<div class="hd-row">No replies yet.</div>`;

      H += h3("Headcount by event");
      EVENTS.forEach((e) => {
        H += `<div class="hd-row hd-row--flex"><span>${e}</span><span class="hd-tag">${esc(perEvent[e] || 0)} guests</span></div>`;
      });
      H += `<div class="hd-row hd-row--flex"><span>Children under 12</span><span class="hd-tag">${esc(d.children_coming || 0)} coming</span></div>`;

      const songs = Array.isArray(d.songs) ? d.songs : [];
      H += h3("Song requests", songs.length);
      if (songs.length) songs.forEach((s) => { H += `<div class="hd-row">${esc(s)}</div>`; });
      else H += `<div class="hd-row">None yet</div>`;

      const nr = Array.isArray(d.not_replied_list) ? d.not_replied_list : [];
      H += h3("Not yet replied", nr.length);
      nr.forEach((g) => {
        H += `<div class="hd-row hd-row--flex"><span>${esc(g.name)}</span><span class="hd-tag">${esc(g.code || "")}</span></div>`;
      });

      summaryEl.innerHTML = H;
      pendingTitle.innerHTML = `To approve <span class="hd-tag">${esc(d.pending_photos || 0)} photos · ${esc(d.pending_messages || 0)} notes</span>`;

      // Self-added review: real only once the server confirms it — the
      // passcode is checked in review_self_add, never in the browser.
      summaryEl.querySelectorAll("button[data-selfrev]").forEach((btn) =>
        btn.addEventListener("click", () => {
          btn.disabled = true;
          sb().then((cli) => cli && cli.rpc("review_self_add", { p_pass: pass, p_guest_id: btn.getAttribute("data-selfrev") }))
            .then((r) => {
              if (!r || r.error || !r.data || r.data.error || !r.data.ok) { btn.disabled = false; return; }
              const rowEl = btn.closest(".hd-row");
              if (rowEl) rowEl.remove();
              if (window.toast) window.toast("Approved ✓", "ok");
            })
            .catch(() => { btn.disabled = false; });
        })
      );
    }

    function loadSummary() {
      return sb().then((cli) => {
        if (!cli) throw new Error("Couldn't reach the server — check your connection and try again.");
        return cli.rpc("get_rsvp_summary", { p_pass: pass });
      }).then((r) => {
        // A transport/server error is not a wrong passcode — say so.
        if (r.error) throw new Error("Couldn't reach the server — check your connection and try again.");
        const d = r.data;
        if (!d || d.error) throw new Error("That passcode didn't work. After several tries the login pauses for a while.");
        renderSummary(d);
      });
    }

    function loadPending() {
      pendingEl.innerHTML = `<p style="color:var(--muted)">Loading…</p>`;
      sb().then((cli) => cli && cli.rpc("get_pending", { p_pass: pass })).then((r) => {
        if (!r || r.error || !r.data || r.data.error) {
          pendingEl.innerHTML = `<div class="hd-row">Couldn’t load the approvals queue — refresh to try again.</div>`;
          return;
        }
        const d = r.data;
        let H = "";
        const photos = Array.isArray(d.photos) ? d.photos : [];
        if (photos.length) {
          H += `<div class="hd-pgrid">` + photos.map((p) =>
            `<div class="hd-pcard"><img loading="lazy" src="${esc(window.Supa.photoUrl(p.path))}" alt="" />` +
            `<div class="hd-pa"><button class="hd-approve" data-kind="photo" data-act="approve" data-id="${esc(p.id)}">Approve</button>` +
            `<button class="hd-reject" data-kind="photo" data-act="reject" data-id="${esc(p.id)}">Reject</button></div></div>`
          ).join("") + `</div>`;
        }
        (Array.isArray(d.messages) ? d.messages : []).forEach((m) => {
          H += `<div class="hd-row hd-row--flex"><span><strong>${esc(m.name)}</strong>: ${esc(m.message)}</span>` +
            `<span class="hd-mini"><button class="hd-approve" data-kind="message" data-act="approve" data-id="${esc(m.id)}">Approve</button>` +
            `<button class="hd-reject" data-kind="message" data-act="reject" data-id="${esc(m.id)}">Reject</button></span></div>`;
        });
        pendingEl.innerHTML = H || `<div class="hd-row">Nothing waiting.</div>`;
        pendingEl.querySelectorAll("button[data-id]").forEach((b) =>
          b.addEventListener("click", () => {
            b.disabled = true;
            sb().then((cli) => cli && cli.rpc("moderate_item", {
              p_pass: pass,
              p_kind: b.getAttribute("data-kind"),
              p_id: b.getAttribute("data-id"),
              p_action: b.getAttribute("data-act"),
            })).then(() => { loadPending(); loadSummary().catch(() => {}); })
              .catch(() => { b.disabled = false; });
          })
        );
      }).catch(() => {
        pendingEl.innerHTML = `<div class="hd-row">Couldn’t load the approvals queue — refresh to try again.</div>`;
      });
    }

    /* Announcement banner: posts/clears the notice guests see. */
    const annFormS = document.getElementById("supaAnnForm");
    const annTextS = document.getElementById("supaAnnText");
    const annStatusS = document.getElementById("supaAnnStatus");
    const annClearS = document.getElementById("supaAnnClear");
    function annSay(msg, ok) {
      annStatusS.className = "rsvp__status" + (ok === true ? " ok" : ok === false ? " err" : "");
      annStatusS.textContent = msg;
    }
    function prefillAnnouncement() {
      sb().then((cli) => cli && cli.rpc("get_announcement")).then((r) => {
        const d = r && r.data;
        const msg = d && (d.message || (Array.isArray(d) && d[0] && d[0].message));
        if (msg) { annTextS.value = msg; annSay("Live now."); }
      }).catch(() => {});
    }
    annFormS.addEventListener("submit", (e) => {
      e.preventDefault();
      const m = annTextS.value.trim();
      if (!m) return annSay("Type a message first.", false);
      annSay("Posting…");
      sb().then((cli) => cli && cli.rpc("set_announcement", { p_pass: pass, p_message: m }))
        .then((r) => { (r && r.data && r.data.ok) ? annSay("Posted — live on the site.", true) : annSay("Error, try again.", false); })
        .catch(() => annSay("Error, try again.", false));
    });
    annClearS.addEventListener("click", () => {
      annSay("Clearing…");
      sb().then((cli) => cli && cli.rpc("clear_announcement", { p_pass: pass }))
        .then((r) => {
          if (r && r.data && r.data.ok) { annTextS.value = ""; annSay("Cleared.", true); }
          else annSay("Error.", false);
        })
        .catch(() => annSay("Error.", false));
    });

    function unlockSupa() {
      loginStatus.className = "rsvp__status";
      loginStatus.textContent = "Checking…";
      loadSummary().then(() => {
        loginStatus.textContent = "";
        gate.hidden = true;
        panel.hidden = true;
        supaPanel.hidden = false;
        loadPending();
        prefillAnnouncement();
      }).catch((err) => {
        pass = null;
        loginStatus.className = "rsvp__status err";
        loginStatus.textContent = err.message;
      });
    }
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      pass = pwInput.value.trim();
      if (!pass) return;
      unlockSupa();
    });
    document.getElementById("supaRefresh").addEventListener("click", () => {
      supaStatus.textContent = "Refreshing…";
      loadSummary()
        .then(() => { supaStatus.textContent = ""; loadPending(); })
        .catch((err) => { supaStatus.textContent = err.message; });
    });
    return; // The Node-mode wiring below is not used in Supabase mode.
  }

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
