/* Schedule: per-event "Add to calendar" (.ics) + "Map" buttons. */
(function () {
  "use strict";
  // Times are UTC instants for America/New_York (EST, UTC-5, in Nov 2026).
  const EVENTS = {
    haldi: { title: "Haldi", start: "20261106T160000Z", end: "20261106T180000Z", loc: "Conrad New York Downtown, 102 North End Ave, New York, NY 10282", map: "Conrad New York Downtown" },
    sangeet: { title: "Sangeet", start: "20261107T000000Z", end: "20261107T040000Z", loc: "The Lighthouse at Pier 61, Chelsea Piers, New York, NY 10011", map: "The Lighthouse at Pier 61 Chelsea Piers" },
    // The site lists no end time for Saturday brunch — the one-hour end is a calendar-export convenience.
    satbrunch: { title: "Brunch", start: "20261107T150000Z", end: "20261107T160000Z", loc: "Conrad New York Downtown, 102 North End Ave, New York, NY 10282", map: "Conrad New York Downtown" },
    ceremony: { title: "Wedding Ceremony", start: "20261107T173000Z", end: "20261107T203000Z", loc: "Conrad New York Downtown, 102 North End Ave, New York, NY 10282", map: "Conrad New York Downtown" },
    reception: { title: "Reception", start: "20261107T233000Z", end: "20261108T043000Z", loc: "Hall des Lumières, 49 Chambers Street, New York, NY 10007", map: "Hall des Lumieres 49 Chambers Street New York" },
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
