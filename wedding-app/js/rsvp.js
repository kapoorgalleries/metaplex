/* RSVP form.
   - Default (Node API): open form; submit a new response or update by email.
   - Supabase mode (window.Supa.enabled): the website's invitation-gated flow —
     find your invitation by name (lookup_guest_by_name) → confirm it's you →
     scoped form (party cap, your allowed events, prefilled via get_my_rsvp)
     → submit_rsvp (upsert by guest, 12-arg contract). */
(function () {
  "use strict";
  const form = document.getElementById("rsvpForm");
  const status = document.getElementById("rsvpStatus");
  const submitBtn = form.querySelector(".rsvp__submit");
  const attendingSel = form.elements["attending"];
  const conditionals = form.querySelectorAll("[data-when='yes']");
  // Fall back to the given English when a DICT key is missing (window.t
  // returns the key itself in that case).
  const t = (k, fb) => {
    const v = window.t ? window.t(k) : null;
    return v == null || v === k ? (fb == null ? k : fb) : v;
  };
  const clampInt = (v, lo, hi) => {
    let n = parseInt(v, 10);
    if (isNaN(n)) n = lo;
    return Math.min(hi, Math.max(lo, n));
  };

  function syncConditionals() {
    const show = attendingSel.value === "yes";
    const declining = attendingSel.value === "no";
    conditionals.forEach((el) => el.classList.toggle("show", show));
    // The postal address is asked either way, but only required when attending —
    // someone sending regrets may leave an address for a card, yet must never be
    // stopped at the door for one.
    const addr = form.elements["mailing_address"];
    if (addr) { if (declining) addr.removeAttribute("required"); else addr.setAttribute("required", ""); }
    const addrOpt = document.getElementById("addrOpt");
    const hintYes = document.getElementById("addrHintYes");
    const hintNo = document.getElementById("addrHintNo");
    if (addrOpt) addrOpt.hidden = !declining;
    if (hintYes) hintYes.hidden = declining;
    if (hintNo) hintNo.hidden = !declining;
  }
  attendingSel.addEventListener("change", syncConditionals);
  syncConditionals();

  // "Is someone missing from your invitation?" — hidden until clicked.
  const partyIssueOpen = document.getElementById("partyIssueOpen");
  const partyIssueBox = document.getElementById("partyIssueBox");
  if (partyIssueOpen && partyIssueBox) {
    partyIssueOpen.addEventListener("click", () => {
      partyIssueBox.hidden = false;
      partyIssueOpen.style.display = "none";
      const ta = document.getElementById("partyIssueText");
      if (ta) ta.focus();
    });
  }
  const partyIssueText = () => {
    const ta = document.getElementById("partyIssueText");
    return ta ? (ta.value || "").trim() : "";
  };

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
    if (form.elements["phone"]) form.elements["phone"].value = r.phone || "";
    form.elements["attending"].value = r.attending || "";
    form.elements["guests"].value = String(r.guests || 1);
    if (form.elements["children_under_12"]) form.elements["children_under_12"].value = String(r.children_under_12 || 0);
    if (form.elements["attendee_names"]) form.elements["attendee_names"].value = r.attendee_names || "";
    if (form.elements["mailing_address"]) form.elements["mailing_address"].value = r.mailing_address || "";
    if (form.elements["song"]) form.elements["song"].value = r.song || "";
    form.elements["note"].value = r.note || "";
    const set = new Set(r.events || []);
    form.querySelectorAll("input[name='events']").forEach((c) => (c.checked = set.has(c.value)));
    syncConditionals();
  }
  findBtn.addEventListener("click", async () => {
    const email = findEmail.value.trim();
    findStatus.className = "rsvp__status";
    if (!email) { findStatus.classList.add("err"); findStatus.textContent = t("rs.find.needEmail", "Enter your email."); return; }
    findStatus.textContent = t("rs.searching", "Searching…");
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
    const attendingYes = form.elements["attending"].value === "yes";
    const phoneVal = form.elements["phone"] ? form.elements["phone"].value.trim().slice(0, 40) : "";
    if (attendingYes) {
      const digits = phoneVal.replace(/\D/g, "");
      if (digits && digits.length < 7) { status.classList.add("err"); status.textContent = t("rs.phone.err", "Please enter a phone number we can reach you on."); return; }
    }
    const guestsVal = clampInt(form.elements["guests"].value, 1, 10);
    const childrenVal = form.elements["children_under_12"] ? clampInt(form.elements["children_under_12"].value || 0, 0, 12) : 0;
    if (attendingYes && childrenVal > guestsVal) {
      status.classList.add("err");
      status.textContent = t("rs.children.err", "Please include your little ones in your party number — the count of children under 12 can't be more than your party size.");
      return;
    }
    const data = {
      name: form.elements["name"].value.trim().slice(0, 120),
      email: form.elements["email"].value.trim().slice(0, 254),
      phone: phoneVal,
      attending: form.elements["attending"].value,
      guests: guestsVal,
      children_under_12: attendingYes ? childrenVal : 0,
      events: Array.from(form.querySelectorAll("input[name='events']:checked")).map((c) => c.value),
      attendee_names: form.elements["attendee_names"] ? form.elements["attendee_names"].value.trim().slice(0, 600) : "",
      mailing_address: form.elements["mailing_address"] ? form.elements["mailing_address"].value.trim().slice(0, 500) : "",
      song: form.elements["song"] ? form.elements["song"].value.trim().slice(0, 160) : "",
      note: form.elements["note"].value.trim().slice(0, 1200),
      party_issue: partyIssueText().slice(0, 1000),
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
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        status.classList.add("err");
        status.textContent = body.error || t("rs.err.save", "We couldn't save your RSVP just now. Please try again.");
        return;
      }
      success();
    } catch (err) {
      // Network failure: keep a local draft so nothing typed is lost, but
      // never claim success for an RSVP that reached no one.
      try {
        const all = JSON.parse(localStorage.getItem("rsvps") || "[]");
        all.push({ ...data, submittedAt: new Date().toISOString() });
        localStorage.setItem("rsvps", JSON.stringify(all));
      } catch (_) {}
      status.classList.add("err");
      status.textContent = t("rs.err.server", "Could not reach the server — please try again in a moment.");
    }
  });
  document.getElementById("appbarLang") &&
    document.getElementById("appbarLang").addEventListener("click", () => setTimeout(setSubmitLabel, 0));

  /* ============================================================
     Supabase path — the website's invitation-gated RSVP
     ============================================================ */
  function setupSupabase() {
    const rf = document.getElementById("rsvpFind"); if (rf) rf.hidden = true; // email finder n/a here
    const applyI18nSafe = () => { if (window.applyI18n) window.applyI18n(); };

    form.style.display = "none";

    // Step 1: find your invitation by name.
    const gate = document.createElement("div");
    gate.className = "rsvp-find";
    gate.innerHTML =
      '<div class="rsvp-find__panel" style="display:grid">' +
      '<label class="field"><span data-i18n="rs.gate.label">Find your invitation — the name on your invite</span>' +
      '<input type="text" id="gateName" autocomplete="name" maxlength="120" enterkeyhint="go" /></label>' +
      '<button type="button" class="btn btn--solid btn--sm" id="gateBtn" data-i18n="rs.gate.btn">Find my invitation</button>' +
      '<p class="rsvp__status" id="gateStatus" role="status" aria-live="polite"></p></div>';
    form.parentNode.insertBefore(gate, form);
    const gateName = gate.querySelector("#gateName");
    const gateBtn = gate.querySelector("#gateBtn");
    const gateStatus = gate.querySelector("#gateStatus");

    // Step 1.5: confirm identity (or pick between similar households).
    const confirmBox = document.createElement("div");
    confirmBox.className = "rsvp-find rsvp-confirm";
    confirmBox.hidden = true;
    confirmBox.innerHTML =
      '<div class="rsvp-find__panel">' +
      '<h3 id="gcTitle" data-i18n="rs.confirm.t">Is this you?</h3>' +
      '<p id="gcSingle"><span data-i18n="rs.confirm.found">We found an invitation for</span> <strong id="gcName"></strong>.</p>' +
      '<div id="gcChoices" hidden></div>' +
      '<div class="rsvp-confirm__actions">' +
      '<button type="button" class="btn btn--solid btn--sm" id="gcContinue" data-i18n="rs.confirm.yes">Yes, continue</button>' +
      '<button type="button" class="btn btn--outline btn--sm" id="gcBack" data-i18n="rs.confirm.no">Not you? Search again</button>' +
      "</div></div>";
    form.parentNode.insertBefore(confirmBox, form);
    const gcTitle = confirmBox.querySelector("#gcTitle");
    const gcSingle = confirmBox.querySelector("#gcSingle");
    const gcName = confirmBox.querySelector("#gcName");
    const gcChoices = confirmBox.querySelector("#gcChoices");
    const gcContinue = confirmBox.querySelector("#gcContinue");
    const gcBack = confirmBox.querySelector("#gcBack");
    applyI18nSafe();

    const guestsSel = form.elements["guests"];
    const childrenSel = form.elements["children_under_12"];
    const checks = form.querySelector(".checks");
    let guest = null;
    let partyMax = 10;

    // Once the guest starts filling the form, a late-arriving prefill must not
    // overwrite what they typed nor flip their attend/decline choice.
    const touched = {};
    form.addEventListener("input", (e) => { if (e.target && e.target.name) touched[e.target.name] = true; });
    form.addEventListener("change", (e) => { if (e.target && e.target.name) touched[e.target.name] = true; });

    const EV_KEYS = { "Haldi": "ev.haldi", "Sangeet": "ev.sangeet", "Wedding Ceremony": "ev.ceremony", "Reception": "ev.reception" };
    function rebuildEvents(selected) {
      const set = new Set(selected || []);
      checks.innerHTML = (guest && guest.allowed_events || []).map((ev) => {
        const key = EV_KEYS[ev];
        return '<label><input type="checkbox" name="events" value="' + ev.replace(/"/g, "&quot;") + '"' +
          (set.has(ev) ? " checked" : "") + " /> <span" + (key ? ' data-i18n="' + key + '"' : "") + ">" +
          window.escapeHtml(ev) + "</span></label>";
      }).join("");
      applyI18nSafe();
    }
    function fillNum(sel, from, to, def) {
      if (!sel) return;
      sel.innerHTML = "";
      for (let i = from; i <= to; i++) {
        const op = document.createElement("option");
        op.value = String(i); op.textContent = String(i);
        if (i === def) op.selected = true;
        sel.appendChild(op);
      }
    }

    function prefillRsvp(d) {
      if (!d) return;
      const setv = (name, val) => {
        if (touched[name]) return;
        const el = form.elements[name];
        if (el && val != null && val !== "") el.value = val;
      };
      if (!touched["attending"]) attendingSel.value = d.attending === false ? "no" : "yes";
      setv("name", d.full_name);
      setv("email", d.email);
      setv("phone", d.phone);
      setv("mailing_address", d.mailing_address);
      if (d.attending !== false) {
        if (!touched["guests"] && d.guest_count) guestsSel.value = String(d.guest_count);
        if (!touched["children_under_12"] && d.children_under_12 != null) childrenSel.value = String(d.children_under_12);
      }
      if (!touched["events"]) rebuildEvents(d.events || []);
      setv("attendee_names", d.attendee_names);
      setv("song", d.song_request);
      setv("note", d.notes);
      submitBtn.textContent = t("rs.update", "Update RSVP");
      syncConditionals();
    }

    function applyGuest(g) {
      partyMax = Math.min(12, Math.max(1, parseInt(g.max_party_size, 10) || 2));
      fillNum(guestsSel, 1, partyMax, 1);
      fillNum(childrenSel, 0, partyMax, 0);
      form.elements["name"].value = g.primary_guest_name || "";
      rebuildEvents([]);
      submitBtn.textContent = t("rs.send", "Send RSVP");
      // Prefill a prior response — fire-and-forget with a stale guard.
      (async () => {
        const sb = await window.Supa.client();
        if (!sb) return;
        let r = null;
        try { r = await sb.rpc("get_my_rsvp", { p_guest_id: g.id }); } catch (_) { return; }
        if (!guest || guest.id !== g.id) return; // guest picked a different household since
        if (r && !r.error && r.data) prefillRsvp(r.data);
      })();
    }

    function revealForm() {
      confirmBox.hidden = true;
      gate.style.display = "none";
      form.style.display = "";
      syncConditionals();
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function showConfirm(g) {
      gcTitle.setAttribute("data-i18n", "rs.confirm.t");
      gcTitle.textContent = t("rs.confirm.t", "Is this you?");
      gcSingle.hidden = false;
      gcName.textContent = g.primary_guest_name || "";
      gcChoices.hidden = true; gcChoices.innerHTML = "";
      gcContinue.style.display = "";
      gate.style.display = "none";
      confirmBox.hidden = false;
      applyI18nSafe();
      gcContinue.focus();
    }
    function showChoices(rows) {
      gcTitle.setAttribute("data-i18n", "rs.confirm.which");
      gcTitle.textContent = t("rs.confirm.which", "Which invitation is yours?");
      gcSingle.hidden = true;
      gcContinue.style.display = "none";
      gcChoices.innerHTML = ""; gcChoices.hidden = false;
      rows.forEach((row) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = row.primary_guest_name || "";
        b.addEventListener("click", () => {
          guest = row;
          applyGuest(guest);
          revealForm();
          form.elements["email"].focus();
        });
        gcChoices.appendChild(b);
      });
      gate.style.display = "none";
      confirmBox.hidden = false;
      applyI18nSafe();
      const fb = gcChoices.querySelector("button");
      if (fb) fb.focus();
    }
    gcContinue.addEventListener("click", () => {
      if (!guest) return;
      applyGuest(guest);
      revealForm();
      form.elements["email"].focus();
    });
    gcBack.addEventListener("click", () => {
      guest = null;
      confirmBox.hidden = true;
      gate.style.display = "";
      gateStatus.className = "rsvp__status";
      gateStatus.textContent = "";
      gateName.value = "";
      gateName.focus();
    });

    function gateErr(msg) {
      gateStatus.className = "rsvp__status err";
      gateStatus.textContent = msg;
    }
    function showNotFound() {
      gateStatus.className = "rsvp__status err";
      gateStatus.textContent = "";
      const msg = t("rs.err.notfound", "We couldn't find an invitation under that name. Please check the spelling — use the name as it appears on your invitation, or email us and we'll find you.");
      // Link the closing "email us and we'll find you." clause (after the final
      // or/या/ಅಥವಾ) to the couple's invitation-help address, like the website.
      const m = msg.match(/^([\s\S]*(?:\bor\s|या\s|ಅಥವಾ\s))([\s\S]+)$/);
      const a = document.createElement("a");
      a.href = "mailto:sanjay@kapoors.com?subject=" + encodeURIComponent("Help finding my wedding invitation");
      if (m) {
        gateStatus.appendChild(document.createTextNode(m[1]));
        a.textContent = m[2];
      } else {
        a.textContent = msg;
      }
      gateStatus.appendChild(a);
    }

    // Groom-side self-registration is deliberately invisible — there is NO
    // button. A guest texted the code types it in the name box; only a
    // server-validated code reveals the name field. A plain wrong name sees
    // nothing but the ordinary not-found message.
    function enterSelfAdd(code, sb) {
      gateStatus.className = "rsvp__status";
      gateStatus.textContent = "";
      const box = document.createElement("span");
      box.className = "selfadd";
      const p = document.createElement("span");
      p.textContent = t("rs.selfadd.ready", "You're all set — enter your name to RSVP.");
      const inp = document.createElement("input");
      inp.type = "text"; inp.autocomplete = "name"; inp.maxLength = 120;
      inp.placeholder = t("rs.selfadd.ph", "Your full name");
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "btn btn--solid btn--sm";
      btn.textContent = t("rs.selfadd.btn", "Continue →");
      const go = async () => {
        const nm = (inp.value || "").trim().replace(/\s+/g, " ");
        if (nm.length < 2) { inp.focus(); return; }
        btn.disabled = true;
        let r = null;
        try { r = await sb.rpc("add_myself_groom", { p_name: nm, p_code: code }); } catch (_) { r = { error: {} }; }
        btn.disabled = false;
        const d = r && !r.error ? r.data : null;
        if (!d || !d.id) {
          const em = (r && r.error && r.error.message) || "";
          gateErr(r && r.error && r.error.code === "P0001" && em && em.length <= 200
            ? em : t("rs.err.save", "We couldn't save your RSVP just now. Please try again."));
          return;
        }
        guest = { id: d.id, primary_guest_name: d.primary_guest_name, max_party_size: d.max_party_size, allowed_events: d.allowed_events };
        applyGuest(guest);
        revealForm();
        form.elements["name"].value = d.primary_guest_name || nm;
        form.elements["email"].focus();
      };
      btn.addEventListener("click", go);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      box.appendChild(p); box.appendChild(inp); box.appendChild(btn);
      gateStatus.appendChild(box);
      inp.focus();
    }

    async function doLookup() {
      const name = (gateName.value || "").trim().replace(/\s+/g, " ");
      gateStatus.className = "rsvp__status";
      gateStatus.textContent = "";
      if (!name) { gateErr(t("rs.gate.needname", "Please enter your name to continue.")); return; }
      if (name.length < 3) { gateErr("Please enter your name as it appears on your invitation."); return; }
      gateBtn.disabled = true;
      gateStatus.textContent = t("rs.searching", "Searching…");
      const sb = await window.Supa.client();
      if (!sb) { gateBtn.disabled = false; gateErr(t("rs.err.server", "Could not reach the server — please try again in a moment.")); return; }
      let r = null;
      try { r = await sb.rpc("lookup_guest_by_name", { p_name: name }); } catch (_) { r = { error: {} }; }
      gateBtn.disabled = false;
      // A transport/server error is NOT "you are not invited" — say "try
      // again", never "no match", when the network hiccups.
      if (r && r.error) {
        gateErr(t("rs.err.lookup", "We're having trouble reaching the guest list — please check your connection and try again in a moment."));
        return;
      }
      const rows = r && Array.isArray(r.data) ? r.data : [];
      if (!rows.length) {
        // The value may be a self-registration code texted to an unlisted
        // groom-side guest; only a server-validated code reveals the self-add
        // form. Anything else is an ordinary no-match.
        let unlocked = false;
        try {
          const u = await sb.rpc("self_add_unlock", { p_code: name });
          unlocked = !!(u && u.data && u.data.ok);
        } catch (_) {}
        gateStatus.className = "rsvp__status";
        gateStatus.textContent = "";
        if (unlocked) enterSelfAdd(name, sb);
        else showNotFound();
        return;
      }
      if (rows.length === 1) { guest = rows[0]; showConfirm(guest); }
      else showChoices(rows);
    }
    gateBtn.addEventListener("click", doLookup);
    gateName.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doLookup(); } });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = ""; status.className = "rsvp__status";
      if (form.elements["website"] && form.elements["website"].value) return; // honeypot
      if (!guest) { status.classList.add("err"); status.textContent = "Please find your invitation first."; return; }
      const av = attendingSel.value;
      if (av !== "yes" && av !== "no") { status.classList.add("err"); status.textContent = "Please tell us whether you can attend."; attendingSel.focus(); return; }
      const attending = av === "yes";
      const name = form.elements["name"].value.trim().replace(/\s+/g, " ");
      const email = form.elements["email"].value.trim();
      if (name.length < 2) { status.classList.add("err"); status.textContent = "Please enter your name as it appears on your invitation."; return; }
      if (!email) { status.classList.add("err"); status.textContent = "Please enter your name and email."; return; }
      const events = Array.from(form.querySelectorAll("input[name='events']:checked")).map((c) => c.value);
      if (attending && !events.length) { status.classList.add("err"); status.textContent = "Please choose at least one event you will be attending, or let us know you can't make it."; return; }
      const phone = form.elements["phone"] ? form.elements["phone"].value.trim() : "";
      if (attending) {
        const digits = phone.replace(/\D/g, "");
        if (digits && digits.length < 7) { status.classList.add("err"); status.textContent = t("rs.phone.err", "Please enter a phone number we can reach you on."); return; }
      }
      const addrEl = form.elements["mailing_address"];
      const address = addrEl ? addrEl.value.trim() : "";
      // Address is required when attending; a regret never blocks on it.
      if (addrEl) addrEl.classList.toggle("invalid", attending && !address);
      if (attending && !address) { status.classList.add("err"); status.textContent = t("rs.fix", "Please fill in the highlighted fields."); addrEl.focus(); return; }
      const params = {
        p_guest_id: guest.id,
        p_full_name: name.slice(0, 120),
        p_email: email.slice(0, 254),
        p_phone: phone.slice(0, 40) || null,
        p_attending: attending,
        p_guest_count: attending ? clampInt(form.elements["guests"].value, 1, partyMax) : 0,
        p_children_under_12: attending ? clampInt(form.elements["children_under_12"].value || 0, 0, 12) : 0,
        p_events: attending ? events : [],
        p_song_request: (form.elements["song"] ? form.elements["song"].value.trim().slice(0, 160) : "") || null,
        p_notes: form.elements["note"].value.trim().slice(0, 1200) || null,
        p_attendee_names: attending ? (form.elements["attendee_names"].value.trim().slice(0, 600) || null) : null,
        p_mailing_address: address.slice(0, 500) || null,
      };
      if (attending && params.p_children_under_12 > params.p_guest_count) {
        status.classList.add("err");
        status.textContent = t("rs.children.err", "Please include your little ones in your party number — the count of children under 12 can't be more than your party size.");
        return;
      }
      submitBtn.disabled = true;
      const orig = submitBtn.textContent;
      submitBtn.textContent = t("rs.sending", "Sending…");
      const sb = await window.Supa.client();
      if (!sb) {
        submitBtn.disabled = false; submitBtn.textContent = orig;
        status.classList.add("err");
        status.textContent = t("rs.err.server", "Could not reach the server — please try again in a moment.");
        return;
      }
      // Fire-and-forget, never awaited: a missing seat is worth knowing about
      // even if the RSVP itself then fails, and a failure here must never
      // block the reply.
      const issueMsg = partyIssueText();
      if (issueMsg) {
        try {
          sb.rpc("report_party_issue", { p_guest_id: guest.id, p_name: params.p_full_name, p_message: issueMsg.slice(0, 1000) })
            .then(function () {}, function () {});
        } catch (_) {}
      }
      let r = null;
      try { r = await sb.rpc("submit_rsvp", params); } catch (_) { r = { error: {} }; }
      submitBtn.disabled = false; submitBtn.textContent = orig;
      if (r && r.error) {
        const em = r.error.message || "";
        status.classList.add("err");
        status.textContent = r.error.code === "P0001" && em && em.length <= 200
          ? em : t("rs.err.save", "We couldn't save your RSVP just now. Please try again.");
        return;
      }
      // Confirmation email — fire-and-forget, only if this client build
      // exposes the edge-functions API.
      try {
        if (sb.functions && typeof sb.functions.invoke === "function") {
          sb.functions.invoke("rsvp-email", { body: { mode: "confirm", guest_id: guest.id } });
        }
      } catch (_) {}
      status.classList.add("ok");
      const firstName = name.split(" ")[0];
      status.textContent = attending
        ? t("rs.okYes", "Thank you, {n}! We can't wait to celebrate with you. 🎉").replace("{n}", firstName)
        : t("rs.okNo", "Thank you for letting us know, {n}. You'll be missed! 💛").replace("{n}", firstName);
    });
  }
})();
