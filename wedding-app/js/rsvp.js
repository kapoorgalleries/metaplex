/* RSVP form: submit a new response, or look up & update an existing one by email. */
(function () {
  "use strict";
  const form = document.getElementById("rsvpForm");
  const status = document.getElementById("rsvpStatus");
  const submitBtn = form.querySelector(".rsvp__submit");
  const conditionals = form.querySelectorAll("[data-when='yes']");
  const attendingSel = form.elements["attending"];
  const t = (k, fb) => (window.t ? window.t(k) : fb);

  let editing = false; // true once we've loaded an existing RSVP to update

  function syncConditionals() {
    const show = attendingSel.value === "yes";
    conditionals.forEach((el) => el.classList.toggle("show", show));
  }
  attendingSel.addEventListener("change", syncConditionals);

  /* ---------- Find / update an existing RSVP ---------- */
  const findToggle = document.getElementById("findToggle");
  const findPanel = document.getElementById("findPanel");
  const findBtn = document.getElementById("findBtn");
  const findEmail = document.getElementById("findEmail");
  const findStatus = document.getElementById("findStatus");

  findToggle.addEventListener("click", () => {
    findPanel.hidden = !findPanel.hidden;
    if (!findPanel.hidden) findEmail.focus();
  });

  function setSubmitLabel() {
    submitBtn.textContent = editing ? t("rs.update", "Update RSVP") : t("rs.send", "Send RSVP");
  }

  function prefill(r) {
    form.elements["name"].value = r.name || "";
    form.elements["email"].value = r.email || "";
    form.elements["attending"].value = r.attending || "";
    form.elements["guests"].value = r.guests || 1;
    form.elements["meal"].value = r.meal || "";
    form.elements["hotelBlock"].checked = !!r.hotelBlock;
    form.elements["note"].value = r.note || "";
    const set = new Set(r.events || []);
    form.querySelectorAll("input[name='events']").forEach((c) => (c.checked = set.has(c.value)));
    syncConditionals();
  }

  findBtn.addEventListener("click", async () => {
    const email = findEmail.value.trim();
    findStatus.className = "rsvp__status";
    if (!email) { findStatus.classList.add("err"); findStatus.textContent = t("rs.find.needEmail", "Enter your email."); return; }
    findStatus.textContent = t("rs.find.searching", "Searching…");
    try {
      const r = await fetch("/api/rsvp/mine?email=" + encodeURIComponent(email));
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Lookup failed.");
      if (!body.found) {
        findStatus.classList.add("err");
        findStatus.textContent = t("rs.find.none", "No RSVP found for that email — fill in the form below to respond.");
        editing = false;
        setSubmitLabel();
        return;
      }
      prefill(body.rsvp);
      editing = true;
      setSubmitLabel();
      findStatus.classList.add("ok");
      findStatus.textContent = t("rs.find.loaded", "Found it! Make your changes below, then update.");
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      findStatus.classList.add("err");
      findStatus.textContent = err.message;
    }
  });

  // If a guest edits the email after loading, we fall back to creating a new RSVP.
  form.elements["email"].addEventListener("input", () => {
    if (editing) { editing = false; setSubmitLabel(); }
  });

  /* ---------- Submit (create or update) ---------- */
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
      status.textContent = t("rs.fix", "Please fill in the highlighted fields.");
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
      website: form.elements["website"] ? form.elements["website"].value : "",
    };

    const firstName = data.name.split(" ")[0];
    const success = () => {
      status.classList.add("ok");
      if (editing) {
        status.textContent = t("rs.updated", "Updated! Thanks, {n} — your RSVP is all set.").replace("{n}", firstName);
      } else {
        status.textContent =
          data.attending === "yes"
            ? t("rs.okYes", "Thank you, {n}! We can't wait to celebrate with you. 🎉").replace("{n}", firstName)
            : t("rs.okNo", "Thank you for letting us know, {n}. You'll be missed! 💛").replace("{n}", firstName);
        form.reset();
        syncConditionals();
      }
    };

    const url = editing ? "/api/rsvp/update" : "/api/rsvp";
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || "Could not submit.");
      }
      success();
    } catch (err) {
      if (editing) {
        status.classList.add("err");
        status.textContent = err.message;
        return;
      }
      // New RSVP offline — keep a local copy so nothing is lost.
      try {
        const all = JSON.parse(localStorage.getItem("rsvps") || "[]");
        all.push({ ...data, submittedAt: new Date().toISOString() });
        localStorage.setItem("rsvps", JSON.stringify(all));
      } catch (_) {}
      success();
    }
  });

  // Keep the submit label correct if the language changes.
  document.getElementById("appbarLang") &&
    document.getElementById("appbarLang").addEventListener("click", () => setTimeout(setSubmitLabel, 0));
})();
