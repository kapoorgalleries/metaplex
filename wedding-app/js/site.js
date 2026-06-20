/* =========================================================
   Priya & Sanjay 2026 — mobile app shell
   Renders the top app bar + bottom tab bar, the "More" sheet,
   the concierge, registers the service worker, and wires the
   install prompt. Injected into every page.
   ========================================================= */
(function () {
  "use strict";

  /* ---------- i18n (English / हिंदी) ---------- */
  const DICT = {
    // App bar titles (per page)
    "title.index": { en: "Priya & Sanjay", hi: "प्रिया और संजय" },
    "title.schedule": { en: "Schedule", hi: "कार्यक्रम" },
    "title.gallery": { en: "Photos", hi: "तस्वीरें" },
    "title.guestbook": { en: "Guestbook", hi: "शुभकामनाएँ" },
    "title.rsvp": { en: "RSVP", hi: "उपस्थिति" },
    "title.story": { en: "Our Story", hi: "हमारी कहानी" },
    "title.travel": { en: "Travel & Stay", hi: "यात्रा और ठहराव" },
    "title.things-to-do": { en: "Things to Do", hi: "घूमने की जगहें" },
    "title.party": { en: "Wedding Party", hi: "परिवार और मित्र" },
    "title.music": { en: "Song Requests", hi: "गानों की फ़रमाइश" },
    "title.seating": { en: "Find Your Seat", hi: "अपनी सीट खोजें" },
    "title.registry": { en: "Registry", hi: "उपहार सूची" },
    "title.faq": { en: "FAQ", hi: "सामान्य प्रश्न" },
    "title.admin": { en: "RSVP Dashboard", hi: "उपस्थिति डैशबोर्ड" },
    // Tabs
    "tab.home": { en: "Home", hi: "मुख्य" },
    "tab.schedule": { en: "Schedule", hi: "कार्यक्रम" },
    "tab.photos": { en: "Photos", hi: "तस्वीरें" },
    "tab.guestbook": { en: "Guestbook", hi: "शुभकामनाएँ" },
    "tab.rsvp": { en: "RSVP", hi: "उपस्थिति" },
    // More sheet
    "sheet.more": { en: "More", hi: "और" },
    "more.story": { en: "Our Story", hi: "हमारी कहानी" },
    "more.travel": { en: "Travel & Stay", hi: "यात्रा और ठहराव" },
    "more.things": { en: "Things to Do", hi: "घूमने की जगहें" },
    "more.party": { en: "Wedding Party", hi: "परिवार और मित्र" },
    "more.music": { en: "Song Requests", hi: "गानों की फ़रमाइश" },
    "more.seating": { en: "Find Your Seat", hi: "अपनी सीट खोजें" },
    "more.registry": { en: "Registry", hi: "उपहार सूची" },
    "more.faq": { en: "FAQ", hi: "सामान्य प्रश्न" },
    "action.share": { en: "Share this app", hi: "ऐप साझा करें" },
    "action.install": { en: "⬇ Add to Home Screen", hi: "⬇ होम स्क्रीन में जोड़ें" },
    "action.reminders": { en: "Get reminders", hi: "रिमाइंडर पाएँ" },
    "action.remindersOn": { en: "Reminders on ✓", hi: "रिमाइंडर चालू ✓" },
    "ios.hint": {
      en: "On iPhone: tap <strong>Share ⎋</strong> in Safari, then <strong>Add to Home Screen</strong>.",
      hi: "iPhone पर: Safari में <strong>Share ⎋</strong> दबाएँ, फिर <strong>Add to Home Screen</strong> चुनें।",
    },
    // Concierge
    "concierge.title": { en: "Wedding Concierge", hi: "विवाह सहायक" },
    "concierge.sub": { en: "Ask me anything about the weekend", hi: "इस सप्ताहांत के बारे में कुछ भी पूछें" },
    "concierge.ph": { en: "e.g. What should I wear to the Sangeet?", hi: "जैसे: संगीत में क्या पहनूँ?" },
    "concierge.greeting": {
      en: "Hi! I'm the wedding concierge 💐 Ask me about events, dress codes, travel, or anything else about Priya & Sanjay's weekend.",
      hi: "नमस्ते! मैं विवाह सहायक हूँ 💐 कार्यक्रम, पहनावा, यात्रा या प्रिया और संजय के सप्ताहांत के बारे में कुछ भी पूछें।",
    },
    "offline": { en: "You're offline — showing a saved copy.", hi: "आप ऑफ़लाइन हैं — सहेजी गई प्रति दिखाई जा रही है।" },
    "toast.backOnline": { en: "Back online ✓", hi: "फिर से ऑनलाइन ✓" },
    "toast.remindersOn": { en: "You'll get day-of reminders 🔔", hi: "आपको कार्यक्रम के दिन रिमाइंडर मिलेंगे 🔔" },
    "toast.remindersOff": { en: "Reminders turned off", hi: "रिमाइंडर बंद कर दिए गए" },
    "toast.notifBlocked": { en: "Notifications are blocked in your browser settings.", hi: "आपके ब्राउज़र में सूचनाएँ अवरुद्ध हैं।" },
    // Home
    "home.eyebrow": { en: "Together with their families", hi: "अपने परिवारों सहित" },
    "home.tag": { en: "are getting married", hi: "विवाह बंधन में बँध रहे हैं" },
    "home.saturday": { en: "Saturday", hi: "शनिवार" },
    "home.place": { en: "Udaipur, India", hi: "उदयपुर, भारत" },
    "home.rsvpBtn": { en: "RSVP by Aug 15", hi: "15 अगस्त तक उपस्थिति बताएँ" },
    "home.stats": { en: "💛 {n} guests celebrating with us", hi: "💛 {n} मेहमान हमारे साथ उत्सव मना रहे हैं" },
    "cd.days": { en: "Days", hi: "दिन" },
    "cd.hours": { en: "Hours", hi: "घंटे" },
    "cd.minutes": { en: "Minutes", hi: "मिनट" },
    "cd.seconds": { en: "Seconds", hi: "सेकंड" },
    "explore.kicker": { en: "Everything you need", hi: "आपके लिए सब कुछ" },
    "explore.title": { en: "Explore", hi: "जानें" },
    "explore.lede": { en: "Three days of celebration in the City of Lakes. Here's where to find what you need.", hi: "झीलों के शहर में तीन दिन का उत्सव। यहाँ आपको हर ज़रूरी जानकारी मिलेगी।" },
    "exp.story.d": { en: "How Priya & Sanjay got here.", hi: "प्रिया और संजय की कहानी।" },
    "exp.schedule.d": { en: "Mehndi, Sangeet, Ceremony & Reception.", hi: "मेहंदी, संगीत, विवाह और रिसेप्शन।" },
    "exp.travel.d": { en: "Airport, hotel block & shuttles.", hi: "हवाई अड्डा, होटल और शटल।" },
    "exp.things.d": { en: "Make a trip of it in Udaipur.", hi: "उदयपुर की सैर का आनंद लें।" },
    "exp.party.d": { en: "Meet the people by our side.", hi: "हमारे साथ खड़े अपनों से मिलें।" },
    "exp.photos.d": { en: "Browse & share your snaps.", hi: "तस्वीरें देखें और साझा करें।" },
    "exp.guestbook.d": { en: "Leave us a note.", hi: "हमें एक संदेश लिखें।" },
    "exp.rsvp.d": { en: "Let us know you're coming.", hi: "बताएँ कि आप आ रहे हैं।" },
    "teaser.kicker": { en: "How it began", hi: "शुरुआत कैसे हुई" },
    "teaser.title": { en: "A chance meeting in Mumbai", hi: "मुंबई में एक संयोगवश मुलाक़ात" },
    "teaser.lede": { en: "It started with spilled chai at a Diwali party in 2019 — and a rooftop proposal over Lake Pichola six years later. Read the whole story.", hi: "2019 की एक दिवाली पार्टी में गिरी चाय से शुरुआत हुई — और छह साल बाद पिछोला झील के ऊपर एक छत पर प्रस्ताव। पूरी कहानी पढ़ें।" },
    "teaser.btn": { en: "Read our story", hi: "हमारी कहानी पढ़ें" },
    // Page subheros (kicker + intro; title reuses title.*)
    "sub.story.kicker": { en: "How it began", hi: "शुरुआत कैसे हुई" },
    "sub.story.intro": { en: "Spilled chai, long-distance phone calls, and a rooftop \"yes\" over Lake Pichola.", hi: "गिरी हुई चाय, दूर से फ़ोन कॉल, और पिछोला झील के ऊपर एक छत पर कही गई \"हाँ\"।" },
    "sub.schedule.kicker": { en: "Three days of celebration", hi: "तीन दिन का उत्सव" },
    "sub.schedule.intro": { en: "Wear comfortable shoes, bring your dancing energy, and don't be shy with the buffet.", hi: "आरामदायक जूते पहनें, नाचने की ऊर्जा लाएँ, और दावत का भरपूर आनंद लें।" },
    "sub.travel.kicker": { en: "Getting there & staying", hi: "पहुँचना और ठहरना" },
    "sub.travel.intro": { en: "Udaipur, the City of Lakes — easy to reach and lovely to linger in.", hi: "उदयपुर, झीलों का शहर — पहुँचना आसान और ठहरना सुखद।" },
    "sub.things.kicker": { en: "Make a trip of it", hi: "सैर का आनंद लें" },
    "sub.things.intro": { en: "Coming early or staying on? A few of our favourite ways to enjoy Udaipur.", hi: "जल्दी आ रहे हैं या रुक रहे हैं? उदयपुर के आनंद के हमारे कुछ पसंदीदा तरीके।" },
    "sub.party.kicker": { en: "By our side", hi: "हमारे साथ" },
    "sub.party.intro": { en: "The friends and family helping us pull off the weekend (and keeping us calm).", hi: "इस सप्ताहांत को संभालने (और हमें शांत रखने) में मदद करने वाले मित्र और परिवार।" },
    "sub.music.kicker": { en: "Help us build the playlist", hi: "प्लेलिस्ट बनाने में मदद करें" },
    "sub.music.intro": { en: "What will get you on the dance floor? Add it to the DJ's list for the Sangeet & Reception.", hi: "कौन सा गाना आपको नाचने पर मजबूर कर देगा? इसे संगीत और रिसेप्शन के लिए DJ की सूची में जोड़ें।" },
    "sub.registry.kicker": { en: "Gifts & blessings", hi: "उपहार और आशीर्वाद" },
    "sub.registry.intro": { en: "Your presence is the only present we need. If you wish to give, here are a few ways.", hi: "आपकी उपस्थिति ही हमारे लिए सबसे बड़ा उपहार है। यदि आप देना चाहें, तो ये कुछ तरीके हैं।" },
    "sub.faq.kicker": { en: "Good to know", hi: "जानने योग्य" },
    "sub.faq.intro": { en: "Still have a question? Tap the 💬 concierge or email us — we're happy to help.", hi: "कोई सवाल है? 💬 सहायक दबाएँ या हमें ईमेल करें — हम मदद के लिए तैयार हैं।" },
    "sub.gallery.kicker": { en: "A shared album", hi: "साझा एल्बम" },
    "sub.gallery.intro": { en: "Captured a moment over the weekend? Share it here so everyone can relive it.", hi: "सप्ताहांत का कोई पल कैद किया? इसे यहाँ साझा करें ताकि सब उसे फिर से जी सकें।" },
    "sub.guestbook.kicker": { en: "Leave us a note", hi: "हमें संदेश लिखें" },
    "sub.guestbook.intro": { en: "Share a memory, a blessing, or a bit of advice for married life. We'll treasure every word.", hi: "कोई याद, आशीर्वाद, या वैवाहिक जीवन के लिए सलाह साझा करें। हम हर शब्द को संजोएँगे।" },
    "sub.rsvp.kicker": { en: "We can't wait to celebrate with you", hi: "हम आपके साथ उत्सव की प्रतीक्षा में हैं" },
    "sub.rsvp.intro": { en: "Kindly respond by <strong>August 15, 2026</strong>. One submission per household is perfect.", hi: "कृपया <strong>15 अगस्त 2026</strong> तक उत्तर दें। प्रति परिवार एक प्रतिक्रिया उत्तम है।" },
    "sub.seating.kicker": { en: "At the reception", hi: "रिसेप्शन में" },
    "sub.seating.intro": { en: "Enter your name to find your table for the reception dinner.", hi: "रिसेप्शन डिनर के लिए अपनी मेज़ खोजने हेतु अपना नाम दर्ज करें।" },
    // Seating page
    "seat.label": { en: "Your name", hi: "आपका नाम" },
    "seat.find": { en: "Find my table", hi: "मेरी मेज़ खोजें" },
    "seat.searching": { en: "Searching…", hi: "खोज रहे हैं…" },
    "seat.none": { en: "We couldn't find that name on the guest list. Double-check the spelling, or reach out to the couple.", hi: "हमें अतिथि सूची में यह नाम नहीं मिला। वर्तनी जाँचें, या जोड़े से संपर्क करें।" },
    "seat.table": { en: "Table", hi: "मेज़" },
    "seat.pending": { en: "You're on the list! Your table will be assigned closer to the day.", hi: "आप सूची में हैं! आपकी मेज़ कार्यक्रम के नज़दीक तय की जाएगी।" },
    "seat.err": { en: "Something went wrong. Please try again.", hi: "कुछ गड़बड़ हो गई। कृपया पुनः प्रयास करें।" },
  };

  let lang = localStorage.getItem("lang") || "en";
  function t(key) {
    const e = DICT[key];
    if (!e) return key;
    return e[lang] || e.en || key;
  }
  function applyI18n() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { const k = el.getAttribute("data-i18n"); if (k) el.textContent = t(k); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { const k = el.getAttribute("data-i18n-html"); if (k) el.innerHTML = t(k); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { const k = el.getAttribute("data-i18n-ph"); if (k) el.setAttribute("placeholder", t(k)); });
  }
  window.t = t;
  window.applyI18n = applyI18n;

  // Primary tabs (bottom bar)
  const TABS = [
    { href: "index.html", label: "Home", icon: "🏠", key: "tab.home" },
    { href: "schedule.html", label: "Schedule", icon: "🗓️", key: "tab.schedule" },
    { href: "gallery.html", label: "Photos", icon: "📸", key: "tab.photos" },
    { href: "guestbook.html", label: "Guestbook", icon: "✍️", key: "tab.guestbook" },
    { href: "rsvp.html", label: "RSVP", icon: "💌", key: "tab.rsvp" },
  ];
  // Secondary pages (More sheet)
  const MORE = [
    { href: "story.html", label: "Our Story", icon: "💞", key: "more.story" },
    { href: "travel.html", label: "Travel & Stay", icon: "✈️", key: "more.travel" },
    { href: "things-to-do.html", label: "Things to Do", icon: "🛕", key: "more.things" },
    { href: "party.html", label: "Wedding Party", icon: "💃", key: "more.party" },
    { href: "music.html", label: "Song Requests", icon: "🎵", key: "more.music" },
    { href: "seating.html", label: "Find Your Seat", icon: "🍽️", key: "more.seating" },
    { href: "registry.html", label: "Registry", icon: "🎁", key: "more.registry" },
    { href: "faq.html", label: "FAQ", icon: "❓", key: "more.faq" },
  ];
  const TITLES = {
    "index.html": "Priya & Sanjay",
    "schedule.html": "Schedule",
    "gallery.html": "Photos",
    "guestbook.html": "Guestbook",
    "rsvp.html": "RSVP",
    "story.html": "Our Story",
    "travel.html": "Travel & Stay",
    "things-to-do.html": "Things to Do",
    "party.html": "Wedding Party",
    "music.html": "Song Requests",
    "seating.html": "Find Your Seat",
    "registry.html": "Registry",
    "faq.html": "FAQ",
    "admin.html": "RSVP Dashboard",
  };

  const current = location.pathname.split("/").pop() || "index.html";
  const isTab = TABS.some((t) => t.href === current);
  document.body.classList.add("app");

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  window.escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Top app bar ---------- */
  const left = isTab
    ? `<span class="appbar__brand">P&nbsp;<i>&amp;</i>&nbsp;S</span>`
    : `<button class="appbar__back" id="appbarBack" aria-label="Back">‹</button>`;
  const titleKey = "title." + current.replace(/\.html$/, "");
  const appbar = el(`
    <header class="appbar">
      ${left}
      <h1 class="appbar__title" data-i18n="${DICT[titleKey] ? titleKey : ""}">${window.escapeHtml(TITLES[current] || "Priya & Sanjay")}</h1>
      <div class="appbar__actions">
        <button class="appbar__lang" id="appbarLang" aria-label="Switch language"></button>
        <button class="appbar__more" id="appbarMore" aria-label="More">⋯</button>
      </div>
    </header>`);
  const headerMount = document.getElementById("site-header");
  if (headerMount) headerMount.replaceWith(appbar);
  else document.body.insertBefore(appbar, document.body.firstChild);

  const backBtn = document.getElementById("appbarBack");
  if (backBtn)
    backBtn.addEventListener("click", () => (history.length > 1 ? history.back() : (location.href = "index.html")));

  const langBtn = document.getElementById("appbarLang");
  const updateLangBtn = () => (langBtn.textContent = lang === "en" ? "हिं" : "EN");
  updateLangBtn();
  langBtn.addEventListener("click", () => {
    lang = lang === "en" ? "hi" : "en";
    localStorage.setItem("lang", lang);
    applyI18n();
    updateLangBtn();
    if (typeof setReminderLabel === "function") setReminderLabel();
  });

  /* ---------- Bottom tab bar ---------- */
  const tabbar = el(`
    <nav class="tabbar" aria-label="Primary">
      ${TABS.map(
        (tb) =>
          `<a class="tab ${tb.href === current ? "is-active" : ""}" href="${tb.href}">
             <span class="tab__icon">${tb.icon}</span><span class="tab__label" data-i18n="${tb.key}">${tb.label}</span>
           </a>`
      ).join("")}
    </nav>`);
  document.body.appendChild(tabbar);

  // Remove any legacy footer mount (apps don't have page footers).
  const footerMount = document.getElementById("site-footer");
  if (footerMount) footerMount.remove();

  /* ---------- "More" bottom sheet ---------- */
  const sheet = el(`
    <div class="sheet" id="moreSheet" hidden>
      <div class="sheet__backdrop" id="sheetBackdrop"></div>
      <div class="sheet__panel" role="dialog" aria-label="More">
        <div class="sheet__grip"></div>
        <h2 class="sheet__title" data-i18n="sheet.more">More</h2>
        <div class="sheet__links">
          ${MORE.map(
            (m) => `<a class="sheet__link" href="${m.href}"><span>${m.icon}</span><span data-i18n="${m.key}">${m.label}</span></a>`
          ).join("")}
          <button class="sheet__link" id="shareBtn" type="button"><span>🔗</span><span data-i18n="action.share">Share this app</span></button>
          <button class="sheet__link" id="remindersBtn" type="button" hidden><span>🔔</span><span id="remindersLabel" data-i18n="action.reminders">Get reminders</span></button>
        </div>
        <button class="btn btn--outline btn--sm sheet__install" id="installBtn" data-i18n="action.install" hidden>⬇ Add to Home Screen</button>
        <p class="sheet__hint" id="iosHint" data-i18n-html="ios.hint" hidden>On iPhone: tap <strong>Share ⎋</strong> in Safari, then <strong>Add to Home Screen</strong>.</p>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  const moreBtn = document.getElementById("appbarMore");
  const openSheet = (open) => {
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.toggle("open", open));
    if (!open) setTimeout(() => (sheet.hidden = true), 250);
  };
  moreBtn.addEventListener("click", () => openSheet(!sheet.classList.contains("open")));
  document.getElementById("sheetBackdrop").addEventListener("click", () => openSheet(false));
  sheet.querySelectorAll(".sheet__link").forEach((a) => a.addEventListener("click", () => openSheet(false)));

  /* ---------- PWA: manifest, icons, service worker, install ---------- */
  function head(tag, attrs) {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    document.head.appendChild(n);
  }
  head("link", { rel: "manifest", href: "manifest.json" });
  head("meta", { name: "theme-color", content: "#6e1423" });
  head("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
  head("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" });
  head("meta", { name: "apple-mobile-web-app-title", content: "Priya & Sanjay" });
  head("link", { rel: "apple-touch-icon", href: "icons/icon-192.png" });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  let deferredPrompt = null;
  const installBtn = document.getElementById("installBtn");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
    openSheet(false);
  });

  // iOS Safari never fires beforeinstallprompt — show a hint instead.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  if (isIOS && !standalone) document.getElementById("iosHint").hidden = false;

  // Share the app (Web Share API → fallback to clipboard).
  const shareBtn = document.getElementById("shareBtn");
  shareBtn.addEventListener("click", async () => {
    const shareData = { title: "Priya & Sanjay 2026", text: "Join us for Priya & Sanjay's wedding!", url: location.origin + "/" };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        window.toast("Link copied to clipboard 🔗");
      }
      openSheet(false);
    } catch (_) {/* user cancelled */}
  });

  /* ---------- Push notifications (day-of reminders) ---------- */
  const remindersBtn = document.getElementById("remindersBtn");
  const remindersLabel = document.getElementById("remindersLabel");
  const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  let pushKey = null;
  async function setReminderLabel() {
    if (!pushSupported) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      remindersLabel.textContent = sub
        ? (window.t ? window.t("action.remindersOn") : "Reminders on ✓")
        : (window.t ? window.t("action.reminders") : "Get reminders");
    } catch (_) {}
  }

  if (pushSupported) {
    fetch("/api/push/key")
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (info && info.enabled && info.key) {
          pushKey = info.key;
          remindersBtn.hidden = false;
          setReminderLabel();
        }
      })
      .catch(() => {});

    remindersBtn.addEventListener("click", async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: existing.endpoint }),
          });
          await existing.unsubscribe();
          if (window.toast) window.toast(window.t ? window.t("toast.remindersOff") : "Reminders turned off");
        } else {
          const perm = await Notification.requestPermission();
          if (perm !== "granted") {
            if (window.toast) window.toast(window.t ? window.t("toast.notifBlocked") : "Notifications are blocked in your browser settings.", "err");
            return;
          }
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(pushKey),
          });
          await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sub),
          });
          if (window.toast) window.toast(window.t ? window.t("toast.remindersOn") : "You'll get day-of reminders 🔔", "ok");
        }
        setReminderLabel();
        openSheet(false);
      } catch (err) {
        if (window.toast) window.toast("Couldn't set up reminders on this device.", "err");
      }
    });
  }

  /* ---------- Scroll reveal ---------- */
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          io.unobserve(e.target);
        }
      }),
    { threshold: 0.1 }
  );
  document.querySelectorAll(".reveal").forEach((n) => io.observe(n));

  /* ---------- Toast ---------- */
  const toastEl = el(`<div class="toast" id="toast" role="status" aria-live="polite"></div>`);
  document.body.appendChild(toastEl);
  let toastTimer;
  window.toast = (msg, kind) => {
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (kind ? " toast--" + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.className = "toast"), 3200);
  };

  /* ---------- Offline banner ---------- */
  const offline = el(`<div class="offline-banner" id="offlineBanner" data-i18n="offline" hidden>You're offline — showing a saved copy.</div>`);
  document.body.appendChild(offline);
  const syncOnline = () => (offline.hidden = navigator.onLine);
  window.addEventListener("online", () => {
    syncOnline();
    if (window.toast) window.toast(t("toast.backOnline"), "ok");
  });
  window.addEventListener("offline", syncOnline);
  syncOnline();

  /* ---------- Concierge ---------- */
  injectConcierge();

  /* ---------- Apply translations once chrome + page DOM are present ---------- */
  applyI18n();

  function injectConcierge() {
    const fab = el(`<button class="concierge__fab" id="conciergeFab" aria-label="Ask the wedding concierge" hidden>💬</button>`);
    const panel = el(`
      <div class="concierge" id="conciergePanel" aria-hidden="true">
        <div class="concierge__head">
          <div><strong data-i18n="concierge.title">Wedding Concierge</strong><span data-i18n="concierge.sub">Ask me anything about the weekend</span></div>
          <button class="concierge__close" id="conciergeClose" aria-label="Close">&times;</button>
        </div>
        <div class="concierge__log" id="conciergeLog"></div>
        <form class="concierge__form" id="conciergeForm">
          <input type="text" id="conciergeInput" data-i18n-ph="concierge.ph" placeholder="e.g. What should I wear to the Sangeet?" autocomplete="off" />
          <button type="submit" aria-label="Send">→</button>
        </form>
      </div>`);
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    const log = panel.querySelector("#conciergeLog");
    const form = panel.querySelector("#conciergeForm");
    const input = panel.querySelector("#conciergeInput");
    const history = [];
    let greeted = false;

    fetch("/api/concierge")
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((info) => { if (info && info.available) fab.hidden = false; })
      .catch(() => {});

    function bubble(text, who) {
      const b = el(`<div class="concierge__bubble concierge__bubble--${who}"></div>`);
      b.textContent = text;
      log.appendChild(b);
      log.scrollTop = log.scrollHeight;
      return b;
    }
    function toggle(open) {
      panel.classList.toggle("open", open);
      panel.setAttribute("aria-hidden", String(!open));
      if (open && !greeted) {
        greeted = true;
        bubble(t("concierge.greeting"), "bot");
      }
      if (open) setTimeout(() => input.focus(), 50);
    }
    fab.addEventListener("click", () => toggle(!panel.classList.contains("open")));
    panel.querySelector("#conciergeClose").addEventListener("click", () => toggle(false));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const msg = input.value.trim();
      if (!msg) return;
      bubble(msg, "user");
      history.push({ role: "user", content: msg });
      input.value = "";
      const typing = bubble("…", "bot");
      typing.classList.add("concierge__bubble--typing");
      fetch("/api/concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history: history.slice(0, -1) }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error || "Sorry, something went wrong.");
          return body.reply || "";
        })
        .then((reply) => { typing.remove(); bubble(reply, "bot"); history.push({ role: "assistant", content: reply }); })
        .catch((err) => { typing.remove(); bubble(err.message, "bot"); });
    });
  }
})();
