/* RSVP form: validate, POST to /api/rsvp (falls back to localStorage offline). */
(function () {
  "use strict";
  const form = document.getElementById("rsvpForm");
  const status = document.getElementById("rsvpStatus");
  const conditionals = form.querySelectorAll("[data-when='yes']");
  const attendingSel = form.elements["attending"];

  function syncConditionals() {
    const show = attendingSel.value === "yes";
    conditionals.forEach((el) => el.classList.toggle("show", show));
  }
  attendingSel.addEventListener("change", syncConditionals);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "";
    status.className = "rsvp__status";

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

    const data = {
      name: form.elements["name"].value.trim(),
      email: form.elements["email"].value.trim(),
      attending: form.elements["attending"].value,
      guests: form.elements["guests"].value,
      events: Array.from(form.querySelectorAll("input[name='events']:checked")).map((c) => c.value),
      meal: form.elements["meal"].value,
      hotelBlock: form.elements["hotelBlock"].checked,
      note: form.elements["note"].value.trim(),
    };

    const firstName = data.name.split(" ")[0];
    const success = () => {
      status.classList.add("ok");
      status.textContent =
        data.attending === "yes"
          ? `Thank you, ${firstName}! We can't wait to celebrate with you. 🎉`
          : `Thank you for letting us know, ${firstName}. You'll be missed! 💛`;
      form.reset();
      syncConditionals();
    };

    try {
      const r = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || "Could not submit.");
      }
      success();
    } catch (_) {
      // Offline / no backend — keep a local copy so nothing is lost.
      try {
        const all = JSON.parse(localStorage.getItem("rsvps") || "[]");
        all.push({ ...data, submittedAt: new Date().toISOString() });
        localStorage.setItem("rsvps", JSON.stringify(all));
      } catch (_) {}
      success();
    }
  });
})();
