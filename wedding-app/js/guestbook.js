/* Guestbook: load + post public well-wishes. */
(function () {
  "use strict";
  const form = document.getElementById("guestbookForm");
  const status = document.getElementById("guestbookStatus");
  const entries = document.getElementById("guestbookEntries");
  const empty = document.getElementById("guestbookEmpty");
  let count = 0;

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "rsvp__status" + (kind ? " " + kind : "");
  }

  function addEntry(entry, prepend) {
    const node = document.createElement("div");
    node.className = "guestbook__entry";
    node.innerHTML =
      `<p class="guestbook__msg">${window.escapeHtml(entry.message)}</p>` +
      `<p class="guestbook__by">— ${window.escapeHtml(entry.name || "A guest")}</p>`;
    if (prepend) entries.insertBefore(node, entries.firstChild);
    else entries.appendChild(node);
    count++;
    if (empty) empty.hidden = count > 0;
  }

  const useSupa = !!(window.Supa && window.Supa.enabled);

  function loadFailed() {
    const note = document.createElement("p");
    note.className = "guestbook__empty";
    note.textContent = window.t ? window.t("gb.loadfail") : "Guestbook notes couldn't load just now. You can still leave a message.";
    entries.appendChild(note);
  }

  function load() {
    if (useSupa) {
      window.Supa.client().then((sb) => {
        if (!sb) return loadFailed();
        // Matches the website: reads go through the list_guestbook RPC
        // (direct table access is revoked for anon).
        sb.rpc("list_guestbook").then((r) => {
          if (r.error || !Array.isArray(r.data)) return loadFailed();
          r.data.forEach((e) => addEntry(e, false));
          if (empty) empty.hidden = count > 0;
        });
      });
      return;
    }
    fetch("/api/guestbook")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (Array.isArray(list)) list.slice().reverse().forEach((e) => addEntry(e, false)); // newest first
        if (empty) empty.hidden = count > 0;
      })
      .catch(() => { if (empty) empty.hidden = false; });
  }
  load();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = form.elements["name"].value.trim();
    const message = form.elements["message"].value.trim();
    const website = form.elements["website"] ? form.elements["website"].value : "";
    if (website) return; // honeypot
    if (!name || !message) return setStatus("Please add your name and a message.", "err");
    setStatus("Signing…", "");

    if (useSupa) {
      // Matches the website: moderated write via the submit_guestbook RPC,
      // which validates lengths, rate-limits, and inserts approved=false.
      window.Supa.client().then((sb) => {
        if (!sb) return setStatus("Couldn't connect — please try again.", "err");
        sb.rpc("submit_guestbook", { p_name: name.slice(0, 80), p_message: message.slice(0, 600) }).then((r) => {
          // The RPC returns human-readable validation/rate-limit text — show it verbatim.
          if (r.error) return setStatus(r.error.message, "err");
          form.reset();
          setStatus(window.t ? window.t("gb.success") : "Thank you! Your note will appear once approved.", "ok");
        });
      });
      return;
    }

    fetch("/api/guestbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, message, website }),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Could not post your message.");
        return body;
      })
      .then((entry) => {
        addEntry(entry, true);
        form.reset();
        setStatus("Thank you for signing our guestbook! 💛", "ok");
      })
      .catch((err) => setStatus(err.message, "err"));
  });
})();
