/* RSVP form.
   - Default (Node API): open form; submit a new response or update by email.
   - Supabase mode (window.Supa.enabled): the website's invitation-gated flow —
     find your invitation by name (lookup_guest_by_name) → scoped form
     (max party size, your allowed events) → submit_rsvp (upsert by guest). */
(function () {
  "use strict";
  const form = document.getElementById("rsvpForm");
  const status = document.getElementById("rsvpStatus");
  const submitBtn = form.querySelector(".rsvp__submit");
  const attendingSel = form.elements["attending"];
  const conditionals = form.querySelectorAll("[data-when='yes']");
  const t = (k, fb) => (window.t ? window.t(k) : fb);

  function syncConditionals() {
    const show = attendingSel.value === "yes";
    conditionals.forEach((el) => el.classList.toggle("show", show));
  }
  attendingSel.addEventListener("change", syncConditionals);

  const useSupa = !!(window.Supa && window.Supa.enabled);
  if (useSupa) { setupSupabase(); return; }

  /* ============================================================
     Node API path (open RSVP + find/update by email)
     ============================================================ */
  let editing = false;
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
        editing = false; setSubmitLabel(); return;
      }
      prefill(body.rsvp); editing = true; setSubmitLabel();
      findStatus.classList.add("ok");
      findStatus.textContent = t("rs.find.loaded", "Found it! Make your changes below, then update.");
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) { findStatus.classList.add("err"); findStatus.textContent = err.message; }
  });
  form.elements["email"].addEventListener("input", () => { if (editing) { editing = false; setSubmitLabel(); } });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = ""; status.className = "rsvp__status";
    let firstInvalid = null;
    ["name", "email", "attending"].forEach((n) => {
      const field = form.elements[n];
      const ok = field.value.trim() !== "" && field.checkValidity();
      field.classList.toggle("invalid", !ok);
      if (!ok && !firstInvalid) firstInvalid = field;
    });
    if (firstInvalid) { status.textContent = t("rs.fix", "Please fill in the highlighted fields."); status.classList.add("err"); firstInvalid.focus(); return; }
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
      if (editing) status.textContent = t("rs.updated", "Updated! Thanks, {n} — your RSVP is all set.").replace("{n}", firstName);
      else {
        status.textContent = data.attending === "yes"
          ? t("rs.okYes", "Thank you, {n}! We can't wait to celebrate with you. 🎉").replace("{n}", firstName)
          : t("rs.okNo", "Thank you for letting us know, {n}. You'll be missed! 💛").replace("{n}", firstName);
        form.reset(); syncConditionals();
      }
    };
    const url = editing ? "/api/rsvp/update" : "/api/rsvp";
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!r.ok) { const body = await r.json().catch(() => ({})); throw new Error(body.error || "Could not submit."); }
      success();
    } catch (err) {
      if (editing) { status.classList.add("err"); status.textContent = err.message; return; }
      try { const all = JSON.parse(localStorage.getItem("rsvps") || "[]"); all.push({ ...data, submittedAt: new Date().toISOString() }); localStorage.setItem("rsvps", JSON.stringify(all)); } catch (_) {}
      success();
    }
  });
  document.getElementById("appbarLang") &&
    document.getElementById("appbarLang").addEventListener("click", () => setTimeout(setSubmitLabel, 0));

  /* ============================================================
     Supabase path — the website's invitation-gated RSVP
     ============================================================ */
  function setupSupabase() {
    const rf = document.getElementById("rsvpFind"); if (rf) rf.hidden = true; // email finder n/a here
    // Fields not in submit_rsvp: hide meal & hotel block.
    [form.elements["meal"], form.elements["hotelBlock"]].forEach((el) => {
      if (el) { const f = el.closest(".field"); if (f) f.style.display = "none"; }
    });
    // Add a phone field (submit_rsvp accepts it) after email.
    const emailField = form.elements["email"].closest(".field");
    const phoneWrap = document.createElement("label");
    phoneWrap.className = "field";
    phoneWrap.innerHTML = '<span>Phone (optional)</span><input type="tel" name="phone" autocomplete="tel" />';
    if (emailField && emailField.parentNode) emailField.parentNode.insertBefore(phoneWrap, emailField.nextSibling);

    form.style.display = "none";

    const gate = document.createElement("div");
    gate.className = "rsvp-find";
    gate.innerHTML =
      '<div class="rsvp-find__panel" style="display:grid">' +
      '<label class="field"><span>Find your invitation — the name on your invite</span>' +
      '<input type="text" id="gateName" autocomplete="name" /></label>' +
      '<button type="button" class="btn btn--solid btn--sm" id="gateBtn">Find my invitation</button>' +
      '<p class="rsvp__status" id="gateStatus" role="status" aria-live="polite"></p></div>';
    form.parentNode.insertBefore(gate, form);
    const gateName = gate.querySelector("#gateName");
    const gateBtn = gate.querySelector("#gateBtn");
    const gateStatus = gate.querySelector("#gateStatus");

    const guestsInput = form.elements["guests"];
    const checks = form.querySelector(".checks");
    let guest = null;

    function rebuildEvents(selected) {
      const set = new Set(selected || []);
      checks.innerHTML = (guest.allowed_events || []).map((ev) =>
        '<label><input type="checkbox" name="events" value="' + ev.replace(/"/g, "&quot;") + '"' +
        (set.has(ev) ? " checked" : "") + " /> " + window.escapeHtml(ev) + "</label>"
      ).join("");
    }

    gateBtn.addEventListener("click", async () => {
      const name = gateName.value.trim();
      gateStatus.className = "rsvp__status";
      if (!name) { gateStatus.classList.add("err"); gateStatus.textContent = "Please enter your name."; return; }
      gateStatus.textContent = t("rs.find.searching", "Searching…");
      const sb = await window.Supa.client();
      if (!sb) { gateStatus.classList.add("err"); gateStatus.textContent = "Couldn't connect — please try again."; return; }
      const r = await sb.rpc("lookup_guest_by_name", { p_name: name });
      const rows = r && !r.error && Array.isArray(r.data) ? r.data : [];
      if (!rows.length) {
        gateStatus.classList.add("err");
        gateStatus.textContent = "We couldn't find your invitation under that name. Try the name on your invitation, or email sonal@sjsevents.com.";
        return;
      }
      guest = rows[0];
      form.elements["name"].value = guest.primary_guest_name || "";
      if (guest.max_party_size) { guestsInput.max = guest.max_party_size; if (+guestsInput.value > guest.max_party_size) guestsInput.value = guest.max_party_size; }
      rebuildEvents([]);
      const mine = await sb.rpc("get_my_rsvp", { p_guest_id: guest.id });
      if (mine && !mine.error && mine.data) {
        const d = mine.data;
        form.elements["name"].value = d.full_name || guest.primary_guest_name || "";
        form.elements["email"].value = d.email || "";
        if (form.elements["phone"]) form.elements["phone"].value = d.phone || "";
        attendingSel.value = d.attending ? "yes" : "no";
        guestsInput.value = d.guest_count || 1;
        form.elements["note"].value = d.notes || "";
        rebuildEvents(d.events || []);
        submitBtn.textContent = t("rs.update", "Update RSVP");
      }
      gate.style.display = "none";
      form.style.display = "";
      syncConditionals();
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = ""; status.className = "rsvp__status";
      if (form.elements["website"] && form.elements["website"].value) return; // honeypot
      if (!guest) { status.classList.add("err"); status.textContent = "Please find your invitation first."; return; }
      const av = attendingSel.value;
      if (av !== "yes" && av !== "no") { status.classList.add("err"); status.textContent = "Please tell us whether you can attend."; attendingSel.focus(); return; }
      const name = form.elements["name"].value.trim();
      const email = form.elements["email"].value.trim();
      if (!name || !email) { status.classList.add("err"); status.textContent = "Please enter your name and email."; return; }
      const attending = av === "yes";
      const events = Array.from(form.querySelectorAll("input[name='events']:checked")).map((c) => c.value);
      if (attending && !events.length) { status.classList.add("err"); status.textContent = "Please choose at least one event from your invitation."; return; }
      const params = {
        p_guest_id: guest.id,
        p_full_name: name,
        p_email: email,
        p_phone: form.elements["phone"] ? form.elements["phone"].value.trim() : "",
        p_attending: attending,
        p_guest_count: attending ? Math.max(1, parseInt(guestsInput.value, 10) || 1) : 0,
        p_events: attending ? events : [],
        p_song_request: "",
        p_notes: form.elements["note"].value.trim(),
      };
      submitBtn.disabled = true;
      const orig = submitBtn.textContent;
      submitBtn.textContent = t("rs.find.searching", "Sending…");
      const sb = await window.Supa.client();
      const r = sb ? await sb.rpc("submit_rsvp", params) : { error: { message: "Couldn't connect — please try again." } };
      submitBtn.disabled = false; submitBtn.textContent = orig;
      if (r.error) { status.classList.add("err"); status.textContent = r.error.message || "Could not submit — please try again."; return; }
      status.classList.add("ok");
      const firstName = name.split(" ")[0];
      status.textContent = attending
        ? t("rs.okYes", "Thank you, {n}! We can't wait to celebrate with you. 🎉").replace("{n}", firstName)
        : t("rs.okNo", "Thank you for letting us know, {n}. You'll be missed! 💛").replace("{n}", firstName);
    });
  }
})();
