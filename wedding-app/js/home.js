/* Home page: countdown + add-to-calendar (.ics) */
(function () {
  "use strict";
  const WEDDING_DATE = new Date("2026-10-17T17:00:00+05:30");
  const cd = {
    days: document.getElementById("cd-days"),
    hours: document.getElementById("cd-hours"),
    mins: document.getElementById("cd-mins"),
    secs: document.getElementById("cd-secs"),
  };
  const pad = (n) => String(n).padStart(2, "0");
  function tick() {
    if (!cd.days) return;
    const diff = WEDDING_DATE - new Date();
    if (diff <= 0) {
      cd.days.textContent = cd.hours.textContent = cd.mins.textContent = cd.secs.textContent = "00";
      return;
    }
    const s = Math.floor(diff / 1000);
    cd.days.textContent = Math.floor(s / 86400);
    cd.hours.textContent = pad(Math.floor((s % 86400) / 3600));
    cd.mins.textContent = pad(Math.floor((s % 3600) / 60));
    cd.secs.textContent = pad(s % 60);
  }
  tick();
  setInterval(tick, 1000);

  const events = [
    { title: "Priya & Sanjay — Mehndi & Haldi", start: "20261016T053000Z", end: "20261016T080000Z", loc: "The Courtyard, Hotel Lakend, Udaipur" },
    { title: "Priya & Sanjay — Sangeet", start: "20261016T133000Z", end: "20261016T180000Z", loc: "Grand Ballroom, Hotel Lakend, Udaipur" },
    { title: "Priya & Sanjay — Wedding Ceremony", start: "20261017T113000Z", end: "20261017T143000Z", loc: "Lakeside Mandap, Lake Pichola, Udaipur" },
    { title: "Priya & Sanjay — Reception", start: "20261017T150000Z", end: "20261017T190000Z", loc: "Terrace Gardens, Lake Pichola, Udaipur" },
  ];
  function ics() {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PriyaSanjay2026//EN"];
    events.forEach((ev, i) => {
      lines.push("BEGIN:VEVENT", `UID:psw2026-${i}@example.com`, `DTSTAMP:${ev.start}`, `DTSTART:${ev.start}`, `DTEND:${ev.end}`, `SUMMARY:${ev.title}`, `LOCATION:${ev.loc}`, "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }
  // Live, PII-free guest count.
  const statsEl = document.getElementById("heroStats");
  if (statsEl) {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s && s.guests > 0) {
          const tpl = window.t ? window.t("home.stats") : "💛 {n} guests celebrating with us";
          statsEl.textContent = tpl.replace("{n}", s.guests);
          statsEl.hidden = false;
        }
      })
      .catch(() => {});
  }

  const btn = document.getElementById("addCalendar");
  if (btn)
    btn.addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([ics()], { type: "text/calendar" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "priya-sanjay-2026.ics";
      a.click();
      URL.revokeObjectURL(url);
    });
})();
