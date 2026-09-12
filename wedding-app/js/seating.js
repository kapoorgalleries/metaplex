/* Find Your Seat: look up a guest's table by name. */
(function () {
  "use strict";
  const form = document.getElementById("seatForm");
  const result = document.getElementById("seatResult");
  const t = (k, fallback) => (window.t ? window.t(k) : fallback);

  function card(html) { result.innerHTML = `<div class="seat__card">${html}</div>`; }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = form.elements["q"].value.trim();
    if (!q) return;
    // Shared-site (Supabase) mode has no /api seating lookup — tables are
    // assigned closer to the day, so show the friendly pending note.
    if (window.Supa && window.Supa.enabled) {
      card(`<p class="seat__pending">${t("seat.pending", "You're on the list! Your table will be assigned closer to the day.")}</p>`);
      return;
    }
    result.innerHTML = `<p class="seat__searching">${t("seat.searching", "Searching…")}</p>`;
    fetch("/api/seating?q=" + encodeURIComponent(q))
      .then((r) => (r.ok ? r.json() : { matches: [] }))
      .then((d) => {
        const matches = (d.matches || []);
        if (!matches.length) {
          card(`<p class="seat__none">${t("seat.none", "We couldn't find that name on the guest list. Double-check the spelling, or reach out to the couple.")}</p>`);
          return;
        }
        result.innerHTML = matches
          .map((m) => {
            const seated = m.table
              ? `<div class="seat__table"><span class="seat__num">${window.escapeHtml(m.table)}</span><span class="seat__tlabel">${t("seat.table", "Table")}</span></div>`
              : `<p class="seat__pending">${t("seat.pending", "You're on the list! Your table will be assigned closer to the day.")}</p>`;
            return `<div class="seat__card"><p class="seat__name">${window.escapeHtml(m.name)}</p>${seated}</div>`;
          })
          .join("");
      })
      .catch(() => card(`<p class="seat__none">${t("seat.err", "Something went wrong. Please try again.")}</p>`));
  });
})();
