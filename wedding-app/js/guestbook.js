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

  function load() {
    fetch("/api/guestbook")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        // newest first
        if (Array.isArray(list)) list.slice().reverse().forEach((e) => addEntry(e, false));
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
    if (!name || !message) return setStatus("Please add your name and a message.", "err");
    setStatus("Signing…", "");
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
