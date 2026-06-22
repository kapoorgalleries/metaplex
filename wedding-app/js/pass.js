/* Event Pass: look up an RSVP by email and render a personal, screenshot-able pass. */
(function () {
  "use strict";
  const t = (k, fb) => (window.t ? window.t(k) : fb);

  const emailInput = document.getElementById("passEmail");
  const btn = document.getElementById("passBtn");
  const status = document.getElementById("passStatus");
  const card = document.getElementById("passCard");

  // Calendar data keyed by the RSVP checkbox values (rsvp.html).
  const EVENTS = {
    "Mehndi & Haldi": { start: "20261016T053000Z", end: "20261016T080000Z", loc: "The Courtyard, Hotel Lakend, Udaipur" },
    Sangeet: { start: "20261016T133000Z", end: "20261016T180000Z", loc: "Grand Ballroom, Hotel Lakend, Udaipur" },
    Ceremony: { start: "20261017T113000Z", end: "20261017T143000Z", loc: "Lakeside Mandap, Lake Pichola, Udaipur" },
    Reception: { start: "20261017T150000Z", end: "20261017T190000Z", loc: "Terrace Gardens, Lake Pichola, Udaipur" },
  };
  const ALL = Object.keys(EVENTS);

  let myEvents = [];

  function setStatus(msg, kind) {
    status.textContent = msg || "";
    status.className = "rsvp__status" + (kind ? " " + kind : "");
  }

  function ics(names) {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PriyaSanjay2026//EN"];
    names.forEach((name, i) => {
      const ev = EVENTS[name];
      if (!ev) return;
      lines.push(
        "BEGIN:VEVENT", `UID:psw2026-pass-${i}@example.com`, `DTSTAMP:${ev.start}`,
        `DTSTART:${ev.start}`, `DTEND:${ev.end}`, `SUMMARY:Priya & Sanjay — ${name}`,
        `LOCATION:${ev.loc}`, "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function render(rsvp) {
    document.getElementById("passName").textContent = rsvp.name || t("pass.guest", "Guest");
    document.getElementById("passAdmits").textContent = rsvp.guests || 1;

    // Which events: the ones they ticked, else all celebrations.
    const picked = Array.isArray(rsvp.events) && rsvp.events.length ? rsvp.events : ALL;
    myEvents = picked.filter((e) => EVENTS[e]);
    if (!myEvents.length) myEvents = ALL;
    document.getElementById("passEventsLabel").textContent =
      Array.isArray(rsvp.events) && rsvp.events.length ? t("pass.events", "Your events") : t("pass.allevents", "All celebrations");

    const evWrap = document.getElementById("passEvents");
    evWrap.innerHTML = myEvents
      .map((e) => `<span class="pass__chip">${window.escapeHtml(e)}</span>`)
      .join("");

    const tableEl = document.getElementById("passTable");
    if (rsvp.table) tableEl.textContent = rsvp.table;
    else { tableEl.textContent = ""; tableEl.appendChild(Object.assign(document.createElement("em"), { textContent: t("pass.tablePending", "Assigned closer to the day"), className: "pass__pending" })); }

    card.hidden = false;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function lookup() {
    const email = emailInput.value.trim();
    if (!email) return setStatus(t("pass.needEmail", "Enter your email."), "err");
    setStatus(t("pass.searching", "Looking…"));
    try {
      const r = await fetch("/api/rsvp/mine?email=" + encodeURIComponent(email));
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || t("pass.err", "Something went wrong. Please try again."));
      if (!body.found) { card.hidden = true; return setStatus(t("pass.none", "We couldn't find an RSVP for that email. Have you RSVP'd yet?"), "err"); }
      if (body.rsvp.attending !== "yes") { card.hidden = true; return setStatus(t("pass.notyes", "Your RSVP is marked as not attending."), "err"); }
      setStatus("");
      try { localStorage.setItem("passEmail", email); } catch (_) {}
      render(body.rsvp);
    } catch (err) {
      setStatus(err.message, "err");
    }
  }

  btn.addEventListener("click", lookup);
  emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); lookup(); } });

  document.getElementById("passCal").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([ics(myEvents)], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "priya-sanjay-my-events.ics";
    a.click();
    URL.revokeObjectURL(url);
    if (window.toast) window.toast("Added to your calendar 🗓️", "ok");
  });

  // Prefill the email if we've seen it before; offer to load straight away.
  try {
    const saved = localStorage.getItem("passEmail");
    if (saved) emailInput.value = saved;
  } catch (_) {}
})();
