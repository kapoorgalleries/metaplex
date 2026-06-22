/* Schedule: per-event "Add to calendar" (.ics) + "Map" buttons. */
(function () {
  "use strict";
  const EVENTS = {
    mehndi: { title: "Mehndi & Haldi", start: "20261016T053000Z", end: "20261016T080000Z", loc: "The Courtyard, Hotel Lakend, Udaipur", map: "Hotel Lakend Udaipur" },
    sangeet: { title: "Sangeet", start: "20261016T133000Z", end: "20261016T180000Z", loc: "Grand Ballroom, Hotel Lakend, Udaipur", map: "Hotel Lakend Udaipur" },
    ceremony: { title: "Wedding Ceremony", start: "20261017T113000Z", end: "20261017T143000Z", loc: "Lakeside Mandap, Lake Pichola, Udaipur", map: "Lake Pichola Udaipur" },
    reception: { title: "Reception", start: "20261017T150000Z", end: "20261017T190000Z", loc: "Terrace Gardens, Lake Pichola, Udaipur", map: "Lake Pichola Udaipur" },
  };

  function ics(ev) {
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PriyaSanjay2026//EN", "BEGIN:VEVENT",
      `UID:psw2026-${ev.title.replace(/\s+/g, "")}@example.com`, `DTSTAMP:${ev.start}`,
      `DTSTART:${ev.start}`, `DTEND:${ev.end}`, `SUMMARY:Priya & Sanjay — ${ev.title}`,
      `LOCATION:${ev.loc}`, "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
  }

  document.querySelectorAll(".event-card__actions[data-ev]").forEach((box) => {
    const ev = EVENTS[box.getAttribute("data-ev")];
    if (!ev) return;

    const tr = (k, fb) => (window.t ? window.t(k) : fb);
    const cal = document.createElement("button");
    cal.className = "btn btn--outline";
    cal.setAttribute("data-i18n", "sch.cal");
    cal.textContent = tr("sch.cal", "＋ Calendar");
    cal.addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([ics(ev)], { type: "text/calendar" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ev.title.toLowerCase().replace(/\s+/g, "-")}.ics`;
      a.click();
      URL.revokeObjectURL(url);
      if (window.toast) window.toast(`${ev.title} added to calendar`, "ok");
    });

    const gcal = document.createElement("a");
    gcal.className = "btn btn--outline";
    gcal.target = "_blank";
    gcal.rel = "noopener";
    gcal.href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=" + encodeURIComponent(`Priya & Sanjay — ${ev.title}`) +
      "&dates=" + ev.start + "/" + ev.end +
      "&location=" + encodeURIComponent(ev.loc);
    gcal.setAttribute("data-i18n", "sch.gcal");
    gcal.textContent = tr("sch.gcal", "📅 Google");

    const map = document.createElement("a");
    map.className = "btn btn--outline";
    map.target = "_blank";
    map.rel = "noopener";
    map.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(ev.map);
    map.setAttribute("data-i18n", "sch.map");
    map.textContent = tr("sch.map", "📍 Map");

    box.appendChild(cal);
    box.appendChild(gcal);
    box.appendChild(map);
  });
})();
