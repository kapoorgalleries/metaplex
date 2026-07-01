/* "Happening now / Up next" — a live day-of banner driven by the schedule.
   Renders into #nowBanner if present. Pass ?now=<ISO> to preview a moment. */
(function () {
  "use strict";
  const mount = document.getElementById("nowBanner");
  if (!mount) return;

  const EVENTS = [
    { key: "haldi", titleKey: "ev.haldi", title: "Haldi", start: "2026-11-06T15:00:00Z", end: "2026-11-06T17:00:00Z" },
    { key: "sangeet", titleKey: "ev.sangeet", title: "Sangeet", start: "2026-11-07T00:00:00Z", end: "2026-11-07T04:00:00Z" },
    { key: "ceremony", titleKey: "ev.ceremony", title: "Wedding Ceremony", start: "2026-11-07T21:00:00Z", end: "2026-11-07T23:00:00Z" },
    { key: "reception", titleKey: "ev.reception", title: "Reception", start: "2026-11-08T00:00:00Z", end: "2026-11-08T04:00:00Z" },
  ].map((e) => ({ ...e, s: Date.parse(e.start), e2: Date.parse(e.end) }));

  const t = (k, fb) => (window.t ? window.t(k) : fb);
  const override = new URLSearchParams(location.search).get("now");

  function rel(ms) {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return t("now.inMin", "in {n} min").replace("{n}", mins);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h < 24) return t("now.inHM", "in {h}h {m}m").replace("{h}", h).replace("{m}", m);
    return t("now.tomorrow", "tomorrow");
  }

  function render() {
    const now = override ? Date.parse(override) : Date.now();
    const first = EVENTS[0].s;
    const last = EVENTS[EVENTS.length - 1].e2;
    // Only show within the wedding window (12h before → 2h after).
    if (now < first - 12 * 3600e3 || now > last + 2 * 3600e3) {
      mount.hidden = true;
      return;
    }
    let label, name, live = false;
    const current = EVENTS.find((e) => now >= e.s && now < e.e2);
    if (current) {
      label = t("now.happening", "Happening now");
      name = t(current.titleKey, current.title);
      live = true;
    } else {
      const next = EVENTS.find((e) => e.s > now);
      if (next) {
        label = t("now.upnext", "Up next") + " · " + rel(next.s - now);
        name = t(next.titleKey, next.title);
      } else {
        mount.innerHTML = `<div class="nowbar nowbar--done">${t("now.wrap", "That's a wrap — thank you for celebrating with us 💛")}</div>`;
        mount.hidden = false;
        return;
      }
    }
    mount.innerHTML =
      `<a class="nowbar${live ? " nowbar--live" : ""}" href="schedule.html">` +
      `<span class="nowbar__label">${live ? "🔴 " : ""}${window.escapeHtml(label)}</span>` +
      `<span class="nowbar__name">${window.escapeHtml(name)}</span></a>`;
    mount.hidden = false;
  }

  render();
  // Re-render every minute and when language changes.
  setInterval(render, 60000);
  window.renderNowBar = render;
})();
