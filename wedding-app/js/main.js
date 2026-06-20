/* =========================================================
   Priya & Sanjay 2026 — Wedding App behaviour
   Vanilla JS, no dependencies.
   ========================================================= */
(function () {
  "use strict";

  // The big day: Oct 17, 2026, 5:00 PM IST (UTC+5:30) → 11:30 UTC
  const WEDDING_DATE = new Date("2026-10-17T17:00:00+05:30");

  /* ---------- Navigation ---------- */
  const nav = document.getElementById("nav");
  const navToggle = document.getElementById("navToggle");
  const navLinks = document.getElementById("navLinks");

  window.addEventListener("scroll", () => {
    nav.classList.toggle("scrolled", window.scrollY > 30);
  });

  navToggle.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(open));
  });
  navLinks.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      navLinks.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    })
  );

  /* ---------- Countdown ---------- */
  const cd = {
    days: document.getElementById("cd-days"),
    hours: document.getElementById("cd-hours"),
    mins: document.getElementById("cd-mins"),
    secs: document.getElementById("cd-secs"),
  };
  function pad(n) { return String(n).padStart(2, "0"); }
  function tickCountdown() {
    const diff = WEDDING_DATE - new Date();
    if (diff <= 0) {
      cd.days.textContent = cd.hours.textContent = cd.mins.textContent = cd.secs.textContent = "00";
      document.querySelector(".hero__btn").textContent = "We're married! 🎉";
      return;
    }
    const s = Math.floor(diff / 1000);
    cd.days.textContent = Math.floor(s / 86400);
    cd.hours.textContent = pad(Math.floor((s % 86400) / 3600));
    cd.mins.textContent = pad(Math.floor((s % 3600) / 60));
    cd.secs.textContent = pad(s % 60);
  }
  tickCountdown();
  setInterval(tickCountdown, 1000);

  /* ---------- Reveal on scroll ---------- */
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("visible"); io.unobserve(e.target); }
    }),
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  /* ---------- Gallery + Lightbox ---------- */
  const galleryItems = [
    { label: "Diwali, where it started", c1: "#e8a33d", c2: "#6e1423" },
    { label: "Lake Pichola sunsets", c1: "#c25a6b", c2: "#4a0e18" },
    { label: "The proposal rooftop", c1: "#b8860b", c2: "#6e1423" },
    { label: "Road trips & roadside chai", c1: "#6e1423", c2: "#e8a33d" },
    { label: "Family, always", c1: "#4a0e18", c2: "#c25a6b" },
    { label: "Us, lately", c1: "#e8a33d", c2: "#b8860b" },
  ];
  const galleryEl = document.getElementById("galleryGrid");
  const lightbox = document.getElementById("lightbox");
  const lightboxStage = document.getElementById("lightboxStage");

  galleryItems.forEach((item) => {
    const tile = document.createElement("div");
    tile.className = "gallery__tile reveal";
    tile.style.background = `linear-gradient(150deg, ${item.c1}, ${item.c2})`;
    tile.textContent = item.label;
    tile.addEventListener("click", () => {
      lightboxStage.style.background = tile.style.background;
      lightboxStage.textContent = item.label;
      lightbox.classList.add("open");
      lightbox.setAttribute("aria-hidden", "false");
    });
    galleryEl.appendChild(tile);
    io.observe(tile);
  });

  function closeLightbox() {
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
  }
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  lightbox.querySelector(".lightbox__close").addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

  /* ---------- RSVP form ---------- */
  const form = document.getElementById("rsvpForm");
  const status = document.getElementById("rsvpStatus");
  const conditionals = form.querySelectorAll("[data-when='yes']");
  const attendingSel = form.elements["attending"];

  function syncConditionals() {
    const show = attendingSel.value === "yes";
    conditionals.forEach((el) => el.classList.toggle("show", show));
  }
  attendingSel.addEventListener("change", syncConditionals);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    status.textContent = "";
    status.className = "rsvp__status";

    // Validate required fields
    let firstInvalid = null;
    ["name", "email", "attending"].forEach((n) => {
      const field = form.elements[n];
      const ok = field.value.trim() !== "" && field.checkValidity();
      field.classList.toggle("invalid", !ok);
      if (!ok && !firstInvalid) firstInvalid = field;
    });
    if (firstInvalid) {
      status.textContent = "Please fill in the highlighted fields.";
      status.classList.add("err");
      firstInvalid.focus();
      return;
    }

    // Gather data
    const data = {
      name: form.elements["name"].value.trim(),
      email: form.elements["email"].value.trim(),
      attending: form.elements["attending"].value,
      guests: form.elements["guests"].value,
      events: Array.from(form.querySelectorAll("input[name='events']:checked")).map((c) => c.value),
      meal: form.elements["meal"].value,
      hotelBlock: form.elements["hotelBlock"].checked,
      note: form.elements["note"].value.trim(),
      submittedAt: new Date().toISOString(),
    };

    // Persist locally (swap this block for a fetch() to a backend / Formspree)
    try {
      const all = JSON.parse(localStorage.getItem("rsvps") || "[]");
      all.push(data);
      localStorage.setItem("rsvps", JSON.stringify(all));
    } catch (_) { /* storage may be unavailable; non-fatal */ }

    // TODO (backend hook): replace the try/catch above with —
    //   await fetch("https://formspree.io/f/XXXX", {
    //     method: "POST",
    //     headers: { "Content-Type": "application/json" },
    //     body: JSON.stringify(data),
    //   });

    status.classList.add("ok");
    status.textContent =
      data.attending === "yes"
        ? `Thank you, ${data.name.split(" ")[0]}! We can't wait to celebrate with you. 🎉`
        : `Thank you for letting us know, ${data.name.split(" ")[0]}. You'll be missed! 💛`;
    form.reset();
    syncConditionals();
  });

  /* ---------- Add-to-calendar (.ics download) ---------- */
  const calBtn = document.getElementById("addCalendar");
  const events = [
    { title: "Priya & Sanjay — Mehndi & Haldi", start: "20261016T053000Z", end: "20261016T080000Z", loc: "The Courtyard, Hotel Lakend, Udaipur" },
    { title: "Priya & Sanjay — Sangeet", start: "20261016T133000Z", end: "20261016T180000Z", loc: "Grand Ballroom, Hotel Lakend, Udaipur" },
    { title: "Priya & Sanjay — Wedding Ceremony", start: "20261017T113000Z", end: "20261017T143000Z", loc: "Lakeside Mandap, Lake Pichola, Udaipur" },
    { title: "Priya & Sanjay — Reception", start: "20261017T150000Z", end: "20261017T190000Z", loc: "Terrace Gardens, Lake Pichola, Udaipur" },
  ];
  function buildICS() {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PriyaSanjay2026//EN"];
    events.forEach((ev, i) => {
      lines.push(
        "BEGIN:VEVENT",
        `UID:psw2026-${i}@example.com`,
        `DTSTAMP:${ev.start}`,
        `DTSTART:${ev.start}`,
        `DTEND:${ev.end}`,
        `SUMMARY:${ev.title}`,
        `LOCATION:${ev.loc}`,
        "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }
  if (calBtn) {
    calBtn.addEventListener("click", () => {
      const blob = new Blob([buildICS()], { type: "text/calendar" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "priya-sanjay-2026.ics";
      a.click();
      URL.revokeObjectURL(url);
    });
  }
})();
