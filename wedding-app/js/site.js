/* =========================================================
   Priya & Sanjay 2026 — mobile app shell
   Renders the top app bar + bottom tab bar, the "More" sheet,
   the concierge, registers the service worker, and wires the
   install prompt. Injected into every page.
   ========================================================= */
(function () {
  "use strict";

  /* ---------- Launch splash (mount ASAP, once per session) ---------- */
  (function launchSplash() {
    try {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; // decorative — skip
      if (sessionStorage.getItem("splashed")) return; // already shown this session
      sessionStorage.setItem("splashed", "1");
    } catch (_) { return; }
    const s = document.createElement("div");
    s.className = "splash";
    s.id = "splash";
    s.setAttribute("role", "img");
    s.setAttribute("aria-label", "Priya and Sanjay — November 6 and 7, 2026, New York City");
    s.innerHTML =
      '<div class="splash__dots" aria-hidden="true"></div>' +
      '<div class="splash__inner">' +
      '<div class="splash__ring"><span class="splash__diya">🪔</span></div>' +
      '<div class="splash__names">Priya <i>&amp;</i> Sanjay</div>' +
      '<div class="splash__date">November 6 &amp; 7, 2026 · New York City</div>' +
      '<div class="splash__rule"></div>' +
      "</div>";
    (document.body || document.documentElement).appendChild(s);
    window.__splashActive = true;
    let hidden = false;
    const done = () => {
      if (hidden) return;
      hidden = true;
      s.classList.add("hide");
      window.__splashActive = false;
      document.dispatchEvent(new Event("splash:done"));
      setTimeout(() => s.remove(), 650);
    };
    s.addEventListener("click", done); // tap to skip
    setTimeout(done, 1900);
  })();

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
    "title.party": { en: "Wedding Party", hi: "हमारे साथी" },
    "title.music": { en: "Song Requests", hi: "गानों की फ़रमाइश" },
    "title.seating": { en: "Find Your Seat", hi: "अपनी सीट खोजें" },
    "title.pass": { en: "Event Pass", hi: "इवेंट पास" },
    "title.registry": { en: "Gifts & Blessings", hi: "उपहार एवं आशीर्वाद" },
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
    "more.party": { en: "Wedding Party", hi: "हमारे साथी" },
    "more.music": { en: "Song Requests", hi: "गानों की फ़रमाइश" },
    "more.seating": { en: "Find Your Seat", hi: "अपनी सीट खोजें" },
    "more.pass": { en: "Event Pass", hi: "इवेंट पास" },
    "more.registry": { en: "Gifts & Blessings", hi: "उपहार एवं आशीर्वाद" },
    "more.faq": { en: "FAQ", hi: "सामान्य प्रश्न" },
    "action.share": { en: "Share this app", hi: "ऐप साझा करें" },
    "action.install": { en: "⬇ Add to Home Screen", hi: "⬇ होम स्क्रीन में जोड़ें" },
    "action.reminders": { en: "Get reminders", hi: "रिमाइंडर पाएँ" },
    "action.remindersOn": { en: "Reminders on ✓", hi: "रिमाइंडर चालू ✓" },
    "action.song": { en: "Play our song", hi: "हमारा गीत बजाएँ" },
    "action.songPause": { en: "Pause our song", hi: "गाना रोकें" },
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
    "concierge.chip.dress": { en: "What should I wear?", hi: "मुझे क्या पहनना चाहिए?" },
    "concierge.chip.travel": { en: "How do I get there?", hi: "वहाँ कैसे पहुँचूँ?" },
    "concierge.chip.schedule": { en: "What's the schedule?", hi: "कार्यक्रम क्या है?" },
    "concierge.chip.kids": { en: "Can I bring my kids?", hi: "क्या मैं बच्चों को ला सकता/सकती हूँ?" },
    "a11y.skip": { en: "Skip to content", hi: "सामग्री पर जाएँ" },
    "welcome.title": { en: "Welcome 🪔", hi: "स्वागत है 🪔" },
    "welcome.sub": { en: "Everything for Priya & Sanjay's weekend, in your pocket.", hi: "प्रिया और संजय के सप्ताहांत की हर बात, आपकी जेब में।" },
    "welcome.f1": { en: "💌 RSVP — and update it anytime", hi: "💌 उपस्थिति दर्ज करें — और कभी भी बदलें" },
    "welcome.f2": { en: "📸 Share photos & leave comments", hi: "📸 तस्वीरें साझा करें और टिप्पणी करें" },
    "welcome.f3": { en: "💬 Ask the concierge anything", hi: "💬 सहायक से कुछ भी पूछें" },
    "welcome.f4": { en: "🔔 Turn on day-of reminders", hi: "🔔 कार्यक्रम के दिन के रिमाइंडर चालू करें" },
    "welcome.f5": { en: "🌐 Read it in हिंदी or ಕನ್ನಡ anytime", hi: "🌐 कभी भी English या ಕನ್ನಡ में पढ़ें" },
    "welcome.cta": { en: "Start exploring", hi: "शुरू करें" },
    "offline": { en: "You're offline — showing a saved copy.", hi: "आप ऑफ़लाइन हैं — सहेजी गई प्रति दिखाई जा रही है।" },
    "toast.backOnline": { en: "Back online ✓", hi: "फिर से ऑनलाइन ✓" },
    "toast.remindersOn": { en: "You'll get day-of reminders 🔔", hi: "आपको कार्यक्रम के दिन रिमाइंडर मिलेंगे 🔔" },
    "toast.remindersOff": { en: "Reminders turned off", hi: "रिमाइंडर बंद कर दिए गए" },
    "toast.notifBlocked": { en: "Notifications are blocked in your browser settings.", hi: "आपके ब्राउज़र में सूचनाएँ अवरुद्ध हैं।" },
    // Home
    "home.eyebrow": { en: "Together with their families", hi: "अपने परिवारों के साथ" },
    "home.tag": { en: "are getting married", hi: "विवाह के बंधन में बँध रहे हैं" },
    "home.saturday": { en: "Friday & Saturday", hi: "शुक्रवार और शनिवार" },
    "home.place": { en: "New York City", hi: "न्यूयॉर्क शहर" },
    "home.rsvpBtn": { en: "RSVP by Aug 31", hi: "31 अगस्त तक उपस्थिति बताएँ" },
    "home.stats": { en: "💛 {n} guests celebrating with us", hi: "💛 {n} मेहमान हमारे साथ उत्सव मना रहे हैं" },
    "cd.days": { en: "Days", hi: "दिन" },
    "cd.hours": { en: "Hours", hi: "घंटे" },
    "cd.minutes": { en: "Minutes", hi: "मिनट" },
    "cd.seconds": { en: "Seconds", hi: "सेकंड" },
    "explore.kicker": { en: "Everything you need", hi: "आपके लिए सब कुछ" },
    "explore.title": { en: "Explore", hi: "जानें" },
    "explore.lede": { en: "The wedding is November 6 & 7 in New York City, with an optional farewell brunch on Sunday. Here's where to find what you need.", hi: "शादी New York City में 6 और 7 नवंबर को है, रविवार को एक वैकल्पिक विदाई ब्रंच के साथ। यहाँ आपको हर ज़रूरी जानकारी मिलेगी।" },
    "exp.story.d": { en: "How Priya & Sanjay got here.", hi: "प्रिया और संजय की कहानी।" },
    "exp.schedule.d": { en: "Haldi, Sangeet, Ceremony & Reception.", hi: "हल्दी, संगीत, विवाह और रिसेप्शन।" },
    "exp.travel.d": { en: "Airport, hotel block & getting around.", hi: "हवाई अड्डा, होटल ब्लॉक और आना-जाना।" },
    "exp.things.d": { en: "Make a trip of it in New York.", hi: "न्यूयॉर्क की सैर का आनंद लें।" },
    "exp.party.d": { en: "Meet the people by our side.", hi: "हमारे साथ खड़े अपनों से मिलें।" },
    "exp.photos.d": { en: "Browse & share your snaps.", hi: "तस्वीरें देखें और साझा करें।" },
    "exp.guestbook.d": { en: "Leave us a note.", hi: "हमें एक संदेश लिखें।" },
    "exp.rsvp.d": { en: "Let us know you're coming.", hi: "बताएँ कि आप आ रहे हैं।" },
    "teaser.kicker": { en: "How it began", hi: "शुरुआत कैसे हुई" },
    "teaser.title": { en: "It started on Long Island", hi: "शुरुआत लॉन्ग आइलैंड में हुई" },
    "teaser.lede": { en: "Two Long Island kids who met in college over late-night neuroscience — and a snowy proposal at Mohonk Mountain House a decade later. Read the whole story.", hi: "लॉन्ग आइलैंड के दो बच्चे जो कॉलेज में देर रात न्यूरोसाइंस पढ़ते हुए मिले — और एक दशक बाद मोहॉन्क माउंटेन हाउस में बर्फ़ के बीच प्रस्ताव। पूरी कहानी पढ़ें।" },
    "teaser.btn": { en: "Read our story", hi: "हमारी कहानी पढ़ें" },
    // Page subheros (kicker + intro; title reuses title.*)
    "sub.story.kicker": { en: "How it began", hi: "शुरुआत कैसे हुई" },
    "sub.story.intro": { en: "Long Island beginnings, late-night study sessions, and a snowy \"yes\" in the Hudson Valley.", hi: "लॉन्ग आइलैंड की शुरुआत, देर रात की पढ़ाई, और हडसन वैली में बर्फ़ के बीच कही गई \"हाँ\"।" },
    "sub.schedule.kicker": { en: "The wedding weekend", hi: "विवाह सप्ताहांत" },
    "sub.schedule.intro": { en: "Two days in New York City — bring your most colourful outfits and your dancing energy.", hi: "न्यूयॉर्क शहर में दो दिन — अपने सबसे रंगीन कपड़े और नाचने की ऊर्जा लाएँ।" },
    "sub.travel.kicker": { en: "Getting there & staying", hi: "पहुँचना और ठहरना" },
    "sub.travel.intro": { en: "It all happens in Manhattan — easy to reach, with a room block at the Conrad.", hi: "सब कुछ मैनहटन में — पहुँचना आसान, कॉनराड में कमरों का ब्लॉक।" },
    "sub.things.kicker": { en: "Make a trip of it", hi: "सैर का आनंद लें" },
    "sub.things.intro": { en: "Coming early or staying on? A few of our favourite ways to enjoy New York.", hi: "जल्दी आ रहे हैं या रुक रहे हैं? न्यूयॉर्क के आनंद के हमारे कुछ पसंदीदा तरीके।" },
    "sub.party.kicker": { en: "By our side", hi: "हमारे साथ" },
    "sub.party.intro": { en: "The dearest friends and family standing beside us this weekend.", hi: "इस सप्ताहांत हमारे साथ खड़े हमारे सबसे प्रिय मित्र और परिवार।" },
    "sub.music.kicker": { en: "Help us build the playlist", hi: "प्लेलिस्ट बनाने में मदद करें" },
    "sub.music.intro": { en: "What will get you on the dance floor? Add it to the DJ's list for the Sangeet & Reception.", hi: "कौन सा गाना आपको नाचने पर मजबूर कर देगा? इसे संगीत और रिसेप्शन के लिए DJ की सूची में जोड़ें।" },
    "sub.registry.kicker": { en: "With Gratitude", hi: "कृतज्ञता के साथ" },
    "sub.registry.intro": { en: "Your love and blessings mean the world to us.", hi: "आपका प्यार और आशीर्वाद हमारे लिए सब कुछ है।" },
    "sub.faq.kicker": { en: "Good to know", hi: "जानने योग्य" },
    "sub.faq.intro": { en: "Still have a question? Tap the 💬 concierge or email us — we're happy to help.", hi: "कोई सवाल है? 💬 सहायक दबाएँ या हमें ईमेल करें — हम मदद के लिए तैयार हैं।" },
    "sub.gallery.kicker": { en: "A shared album", hi: "साझा एल्बम" },
    "sub.gallery.intro": { en: "Captured a moment over the weekend? Share it here so everyone can relive it.", hi: "सप्ताहांत का कोई पल कैद किया? इसे यहाँ साझा करें ताकि सब उसे फिर से जी सकें।" },
    "sub.guestbook.kicker": { en: "Leave us a note", hi: "हमें संदेश लिखें" },
    "sub.guestbook.intro": { en: "Share a memory, a blessing, or a bit of advice for married life. We'll treasure every word.", hi: "कोई याद, आशीर्वाद, या वैवाहिक जीवन के लिए सलाह साझा करें। हम हर शब्द को संजोएँगे।" },
    "sub.rsvp.kicker": { en: "We can't wait to celebrate with you", hi: "हम आपके साथ उत्सव की प्रतीक्षा में हैं" },
    "sub.rsvp.intro": { en: "Kindly respond by <strong>August 31, 2026</strong>. One submission per household is perfect.", hi: "कृपया <strong>31 अगस्त 2026</strong> तक उत्तर दें। प्रति परिवार एक प्रतिक्रिया उत्तम है।" },
    "sub.seating.kicker": { en: "At the reception", hi: "रिसेप्शन में" },
    "sub.seating.intro": { en: "Enter your name to find your table for the reception dinner.", hi: "रिसेप्शन डिनर के लिए अपनी मेज़ खोजने हेतु अपना नाम दर्ज करें।" },
    // Event Pass
    "sub.pass.kicker": { en: "Your digital pass", hi: "आपका डिजिटल पास" },
    "sub.pass.intro": { en: "Pull up your personal pass — your events, table, and a quick add-to-calendar.", hi: "अपना निजी पास देखें — आपके कार्यक्रम, मेज़, और कैलेंडर में जोड़ने का आसान तरीका।" },
    "pass.label": { en: "The email you RSVP'd with", hi: "वह ईमेल जिससे आपने उपस्थिति दर्ज की" },
    "pass.find": { en: "Get my pass", hi: "मेरा पास पाएँ" },
    "pass.searching": { en: "Looking…", hi: "खोज रहे हैं…" },
    "pass.none": { en: "We couldn't find an RSVP for that email. Have you RSVP'd yet?", hi: "उस ईमेल के लिए कोई उपस्थिति नहीं मिली। क्या आपने उपस्थिति दर्ज की है?" },
    "pass.notyes": { en: "Your RSVP is marked as not attending. Update it on the RSVP page if that's changed.", hi: "आपकी उपस्थिति 'नहीं आ रहे' के रूप में दर्ज है। यदि बदला हो तो RSVP पृष्ठ पर अपडेट करें।" },
    "pass.needEmail": { en: "Enter your email.", hi: "अपना ईमेल दर्ज करें।" },
    "pass.err": { en: "Something went wrong. Please try again.", hi: "कुछ गड़बड़ हुई। कृपया पुनः प्रयास करें।" },
    "pass.admits": { en: "Admits", hi: "प्रवेश" },
    "pass.events": { en: "Your events", hi: "आपके कार्यक्रम" },
    "pass.allevents": { en: "All celebrations", hi: "सभी समारोह" },
    "pass.table": { en: "Table", hi: "मेज़" },
    "pass.tablePending": { en: "Assigned closer to the day", hi: "कार्यक्रम के नज़दीक तय होगी" },
    "pass.addcal": { en: "＋ Add my events to calendar", hi: "＋ मेरे कार्यक्रम कैलेंडर में जोड़ें" },
    "pass.savehint": { en: "Tip: screenshot this pass to keep it handy.", hi: "सुझाव: इस पास का स्क्रीनशॉट लेकर सहेज लें।" },
    "pass.guest": { en: "Guest", hi: "अतिथि" },
    // Seating page
    "seat.label": { en: "Your name", hi: "आपका नाम" },
    "seat.find": { en: "Find my table", hi: "मेरी मेज़ खोजें" },
    "seat.searching": { en: "Searching…", hi: "खोज रहे हैं…" },
    "seat.none": { en: "We couldn't find that name on the guest list. Double-check the spelling, or reach out to the couple.", hi: "हमें अतिथि सूची में यह नाम नहीं मिला। वर्तनी जाँचें, या जोड़े से संपर्क करें।" },
    "seat.table": { en: "Table", hi: "मेज़" },
    "seat.pending": { en: "You're on the list! Your table will be assigned closer to the day.", hi: "आप सूची में हैं! आपकी मेज़ कार्यक्रम के नज़दीक तय की जाएगी।" },
    "seat.err": { en: "Something went wrong. Please try again.", hi: "कुछ गड़बड़ हो गई। कृपया पुनः प्रयास करें।" },
    // Day-of "now" banner
    "now.happening": { en: "Happening now", hi: "अभी चल रहा है" },
    "now.upnext": { en: "Up next", hi: "अगला" },
    "now.inMin": { en: "in {n} min", hi: "{n} मिनट में" },
    "now.inHM": { en: "in {h}h {m}m", hi: "{h} घं {m} मि में" },
    "now.tomorrow": { en: "tomorrow", hi: "कल" },
    "now.wrap": { en: "That's a wrap — thank you for celebrating with us 💛", hi: "समापन — हमारे साथ उत्सव मनाने के लिए धन्यवाद 💛" },
    "ev.haldi": { en: "Haldi", hi: "हल्दी" },
    "ev.sangeet": { en: "Sangeet", hi: "संगीत" },
    "ev.ceremony": { en: "Wedding Ceremony", hi: "विवाह समारोह" },
    "ev.reception": { en: "Reception", hi: "स्वागत समारोह" },
    "ev.brunch": { en: "Farewell Brunch", hi: "विदाई ब्रंच" },
    "sch.brunch.when": { en: "Sun, Nov 8 · Late morning", hi: "रवि, 8 नवंबर · दोपहर से पहले" },
    "sch.brunch.where": { en: "Optional · details to follow", hi: "वैकल्पिक · विवरण जल्द ही" },
    "sch.brunch.desc": { en: "One last coffee together before everyone heads home.", hi: "सबके घर लौटने से पहले एक आख़िरी कॉफ़ी साथ में।" },
    "st.2019.t": { en: "Where it began — Long Island", hi: "शुरुआत — लॉन्ग आइलैंड" },
    "st.2019.p": { en: "We both grew up on Long Island, though our paths didn't cross until later. It started, as the best things do, fifteen years ago.", hi: "हम दोनों लॉन्ग आइलैंड में बड़े हुए, हालाँकि हमारी राहें बाद में मिलीं। सबसे अच्छी चीज़ों की तरह, इसकी शुरुआत पंद्रह साल पहले हुई।" },
    "st.2021.t": { en: "College — late-night study sessions", hi: "कॉलेज — देर रात की पढ़ाई" },
    "st.2021.p": { en: "We met in college. Little did we know that late-night study sessions for neuroscience would turn into a lifetime together.", hi: "हम कॉलेज में मिले। हमें कहाँ पता था कि न्यूरोसाइंस की देर रात की पढ़ाई जीवनभर के साथ में बदल जाएगी।" },
    "st.2025.t": { en: "The proposal — Mohonk Mountain House", hi: "प्रस्ताव — मोहॉन्क माउंटेन हाउस" },
    "st.2025.p": { en: "A decade later, Sanjay proposed on a snow-draped porch at Mohonk Mountain House in the Hudson Valley.", hi: "एक दशक बाद, संजय ने हडसन वैली के मोहॉन्क माउंटेन हाउस में बर्फ़ से ढके एक बरामदे पर प्रस्ताव रखा।" },
    "st.2026.t": { en: "2026 — New York City", hi: "2026 — न्यूयॉर्क शहर" },
    "st.2026.p": { en: "This November, we're bringing everyone we love to New York City to celebrate our next chapter the way it began — surrounded by warmth, good company, and no shortage of joy.", hi: "इस नवंबर, हम अपने सभी प्रियजनों को New York City ले आ रहे हैं, ताकि अपने जीवन के अगले अध्याय का जश्न वैसे ही मना सकें जैसे यह शुरू हुआ था: अपनेपन की गर्माहट, अच्छे साथ और भरपूर खुशियों के बीच।" },
    "st.btn": { en: "See the schedule", hi: "कार्यक्रम देखें" },
    "faq.q1": { en: "What should I wear?", hi: "मुझे क्या पहनना चाहिए?" },
    "faq.a1": { en: "Indian festive attire is warmly encouraged across all events. The Haldi calls for something you don't mind getting a little yellow; the Sangeet is colourful and celebratory; the ceremony is traditional; the reception is Indian traditional or black tie. When in doubt, dress to celebrate.", hi: "सभी आयोजनों में भारतीय उत्सवी पहनावे का स्वागत है। हल्दी के लिए ऐसा कुछ जिस पर थोड़ी हल्दी लगे तो चलेगा; संगीत रंगीन और उत्सवी है; समारोह पारंपरिक है; रिसेप्शन भारतीय पारंपरिक या ब्लैक टाई है। संदेह हो तो उत्सव के अनुरूप पहनें।" },
    "faq.q2": { en: "Any colours to avoid?", hi: "कौन-से रंग न पहनें?" },
    "faq.a2": { en: "Please refer to each event on the Schedule to see which colours/outfits are recommended.", hi: "कृपया कार्यक्रम पृष्ठ पर प्रत्येक आयोजन को देखें कि कौन-से रंग/परिधान सुझाए गए हैं।" },
    "faq.q3": { en: "Can I bring a guest?", hi: "क्या मैं किसी अतिथि को ला सकता/सकती हूँ?" },
    "faq.a3": { en: "Your invitation and RSVP reflect the seats reserved for you. If you have a question about your party, please reach out and we'll be happy to help.", hi: "आपका निमंत्रण और उपस्थिति की पुष्टि आपके लिए आरक्षित स्थानों को दर्शाते हैं। यदि आपके समूह को लेकर कोई प्रश्न हो, तो कृपया संपर्क करें, हमें मदद करके खुशी होगी।" },
    "faq.q4": { en: "What's the weather like?", hi: "मौसम कैसा रहेगा?" },
    "faq.a4": { en: "Early November in New York is crisp — generally 40–55°F (5–13°C). Bring a wrap or coat for the evenings.", hi: "New York में November की शुरुआत में मौसम ठंडा-सुहावना रहता है — आमतौर पर 40–55°F (5–13°C)। शाम के लिए एक शॉल या कोट साथ लाएँ।" },
    "faq.q5": { en: "Getting between venues?", hi: "स्थलों के बीच आना-जाना?" },
    "faq.a5": { en: "Everything is in Manhattan, a short ride apart. Taxis and rideshare are plentiful. Please note that shuttle service from the airport to the hotel will not be provided — we kindly ask guests to arrange their own transportation. Group transport between venues is separate, and those details will follow.", hi: "सब कुछ Manhattan में ही है, थोड़ी ही दूरी पर। टैक्सियाँ और राइडशेयर भरपूर हैं। कृपया ध्यान दें कि हवाई अड्डे से होटल तक शटल सेवा उपलब्ध नहीं होगी — हम विनम्रतापूर्वक अनुरोध करते हैं कि अतिथि अपने आवागमन की व्यवस्था स्वयं करें। स्थलों के बीच समूह परिवहन अलग है, और उसकी जानकारी बाद में दी जाएगी।" },
    "faq.q6": { en: "When should I RSVP, and who do I ask?", hi: "मैं कब तक RSVP करूँ, और किससे पूछूँ?" },
    "faq.a6": { en: "Kindly RSVP by <strong>August 31, 2026</strong> on the RSVP page. For anything at all, email our planners at <a href='mailto:sonal@sjsevents.com?cc=ginny@sjsevents.com'>sonal@sjsevents.com</a> (cc <a href='mailto:ginny@sjsevents.com'>ginny@sjsevents.com</a>) — they're handling every detail and will take wonderful care of you.", hi: "कृपया <strong>31 अगस्त 2026</strong> तक RSVP पृष्ठ से उत्तर दें। किसी भी बात के लिए हमारे आयोजकों को <a href='mailto:sonal@sjsevents.com?cc=ginny@sjsevents.com'>sonal@sjsevents.com</a> (cc <a href='mailto:ginny@sjsevents.com'>ginny@sjsevents.com</a>) पर ईमेल करें — वे हर विवरण का ध्यान रख रहे हैं और आपकी बेहतरीन देखभाल करेंगे।" },
    "tv.fly.t": { en: "✈️ Flying in", hi: "✈️ विमान से आगमन" },
    "tv.fly.p2": { en: "Fly into any of New York's three airports — JFK, LaGuardia (LGA), or Newark (EWR). All serve Manhattan — allow 45–75 minutes by car, depending on traffic.", hi: "न्यूयॉर्क के तीनों हवाई अड्डों — JFK, लागार्डिया (LGA), या नेवार्क (EWR) — में से किसी पर उतरें। सभी Manhattan पहुँचाते हैं — यातायात के अनुसार कार से 45–75 मिनट का समय रखें।" },
    "tv.stay.t": { en: "🏨 Where to stay", hi: "🏨 कहाँ ठहरें" },
    "tv.stay.p1": { en: "We've reserved a room block at the <strong>Conrad New York Downtown</strong> — our home base for the weekend, moments from the celebrations.", hi: "हमने <strong>कॉनराड न्यूयॉर्क डाउनटाउन</strong> में कमरों का ब्लॉक आरक्षित किया है — सप्ताहांत का हमारा ठिकाना, समारोहों से बस कुछ ही दूरी पर।" },
    "tv.stay.p2": { en: "Group rate from <strong>$409/night</strong>, rooms held <strong>Nov 5–8</strong>. Book with group code <strong>KMWED26</strong> by <strong>October 6, 2026</strong>.", hi: "समूह दर <strong>$409/रात</strong> से, कमरे <strong>5–8 नवंबर</strong> तक आरक्षित। ग्रुप कोड <strong>KMWED26</strong> के साथ <strong>6 अक्टूबर 2026</strong> तक बुक करें।" },
    "tv.stay.btn": { en: "View hotel", hi: "होटल देखें" },
    "tv.venue.t": { en: "📍 The venues", hi: "📍 स्थान" },
    "tv.venue.p": { en: "All three celebration venues are in Manhattan — the Conrad and Hall des Lumières in Lower Manhattan, The Lighthouse at Pier 61 in Chelsea.", hi: "तीनों समारोह स्थल मैनहटन में हैं — कॉनराड और हॉल दे लुमिएर लोअर मैनहटन में, द लाइटहाउस एट पियर 61 चेल्सी में।" },
    "tv.venue.btn": { en: "Open in Maps", hi: "मैप में खोलें" },
    "tv.around.t": { en: "🚕 Getting around", hi: "🚕 आना-जाना" },
    "tv.around.p": { en: "A few notes to make the weekend easy. Please note that airport-to-hotel shuttle service will not be provided — we kindly ask guests to arrange their own transportation. Group transport between venues will run from the Conrad — timings will appear here closer to November.", hi: "सप्ताहांत को आसान बनाने के लिए कुछ बातें। कृपया ध्यान दें कि हवाई अड्डे से होटल तक शटल सेवा उपलब्ध नहीं होगी — हम विनम्रतापूर्वक अनुरोध करते हैं कि अतिथि अपने आवागमन की व्यवस्था स्वयं करें। स्थलों के बीच समूह परिवहन कॉनराड से चलेगा — समय की जानकारी नवंबर के नज़दीक यहाँ दिखेगी।" },
    "tv.btn": { en: "Things to do in New York", hi: "न्यूयॉर्क में घूमने की जगहें" },
    "td.t1": { en: "The classic", hi: "क्लासिक" },
    "td.h1": { en: "Central Park", hi: "सेंट्रल पार्क" },
    "td.p1": { en: "The green heart of Manhattan — perfect for an autumn stroll among the changing leaves.", hi: "मैनहटन का हरा-भरा हृदय — पतझड़ के बदलते पत्तों के बीच टहलने के लिए एकदम सही।" },
    "td.t2": { en: "Culture", hi: "संस्कृति" },
    "td.h2": { en: "World-class museums", hi: "विश्वस्तरीय संग्रहालय" },
    "td.p2": { en: "The Met, MoMA and the Natural History Museum are all a short ride away — a rainy-day dream.", hi: "द मेट, MoMA और प्राकृतिक इतिहास संग्रहालय सब पास ही हैं — बरसात के दिन का सपना।" },
    "td.t3": { en: "Views", hi: "नज़ारे" },
    "td.h3": { en: "Skyline views", hi: "स्काईलाइन के नज़ारे" },
    "td.p3": { en: "Top of the Rock, the Empire State, or the Edge for the skyline; or the Staten Island Ferry (free!) past the Statue of Liberty.", hi: "स्काईलाइन के लिए टॉप ऑफ़ द रॉक, एम्पायर स्टेट या एज; या स्टैच्यू ऑफ़ लिबर्टी के पास से स्टेटन आइलैंड फ़ेरी (मुफ़्त!)।" },
    "td.t4": { en: "Wander", hi: "सैर" },
    "td.h4": { en: "The High Line &amp; Chelsea", hi: "द हाई लाइन और चेल्सी" },
    "td.p4": { en: "A garden walkway above the streets, ending near Chelsea Market and The Lighthouse at Pier 61.", hi: "सड़कों के ऊपर बना एक बग़ीचा-पथ, जो चेल्सी मार्केट और द लाइटहाउस एट पियर 61 के पास समाप्त होता है।" },
    "td.t5": { en: "Nearby", hi: "पास में" },
    "td.h5": { en: "Battery Park &amp; the harbor", hi: "बैटरी पार्क और बंदरगाह" },
    "td.p5": { en: "Right by the Conrad — waterfront paths, the harbor, and ferries to the Statue of Liberty and Ellis Island.", hi: "कॉनराड के ठीक पास — तटवर्ती रास्ते, बंदरगाह, और स्टैच्यू ऑफ़ लिबर्टी व एलिस आइलैंड के लिए फ़ेरी।" },
    "td.t6": { en: "Eat", hi: "भोजन" },
    "td.h6": { en: "Eat your way through NYC", hi: "न्यूयॉर्क का ज़ायका" },
    "td.p6": { en: "A bagel and a slice, dumplings in Chinatown, or a Broadway show with dinner. Ask the concierge for picks!", hi: "एक बेगल और पिज़्ज़ा स्लाइस, चाइनाटाउन में डम्पलिंग, या डिनर के साथ ब्रॉडवे शो। सुझाव के लिए सहायक से पूछें!" },
    "td.tip": { en: "Tip: tap the 💬 concierge any time for personalised recommendations.", hi: "सुझाव: व्यक्तिगत सिफ़ारिशों के लिए कभी भी 💬 सहायक दबाएँ।" },
    "pt.bridesmaids": { en: "The Bridesmaids", hi: "सखियाँ" },
    "pt.groomsmen": { en: "The Groomsmen", hi: "सखा" },
    "pt.withlove": { en: "With love", hi: "सप्रेम" },
    "pt.memory": { en: "In Loving Memory", hi: "स्नेहमयी स्मृति में" },
    "pt.mob": { en: "Mother of the Bride", hi: "वधू की माता" },
    "pt.mog": { en: "Mother of the Groom", hi: "वर की माता" },
    "pt.gfog": { en: "Grandfather of the Groom", hi: "वर के दादा" },
    "pt.fob": { en: "Father of the Bride", hi: "वधू के पिता" },
    "pt.fog": { en: "Father of the Groom", hi: "वर के पिता" },
    "pt.gmog": { en: "Grandmother of the Groom", hi: "वर की दादी" },
    "sch.haldi.dress": { en: "<strong>Attire:</strong> Bright, easy colours you won't mind catching a little turmeric", hi: "<strong>पहनावा:</strong> चटख, सहज रंग जिन पर थोड़ी हल्दी लग जाए तो चलेगा" },
    "sch.haldi.desc": { en: "A bright morning of turmeric, music, and blessings before the wedding.", hi: "विवाह से पहले हल्दी, संगीत और आशीर्वादों से भरी एक उज्ज्वल सुबह।" },
    "sch.sangeet.dress": { en: "<strong>Attire:</strong> Colourful and celebratory — something you can dance in", hi: "<strong>पहनावा:</strong> रंगीन और उत्सवी — ऐसा कुछ जिसमें आप नाच सकें" },
    "sch.sangeet.desc": { en: "An evening of music, dance, and performances from both families.", hi: "दोनों परिवारों के संगीत, नृत्य और प्रस्तुतियों से सजी एक शाम।" },
    "sch.ceremony.dress": { en: "<strong>Attire:</strong> Traditional and festive; modest coverage is kindly appreciated", hi: "<strong>पहनावा:</strong> पारंपरिक और उत्सवी; शालीन परिधान का सादर अनुरोध है" },
    "sch.ceremony.desc": { en: "The baraat and the mandap ceremony — the heart of the weekend.", hi: "बारात और मंडप की रस्म — इस सप्ताहांत का सबसे ख़ास पल।" },
    "sch.reception.dress": { en: "<strong>Attire:</strong> Indian traditional or black tie — bring a little sparkle for the dance floor", hi: "<strong>पहनावा:</strong> भारतीय पारंपरिक या ब्लैक टाई — डांस फ़्लोर के लिए थोड़ी चमक साथ लाएँ" },
    "sch.reception.desc": { en: "Dinner, dancing, and a true celebration to close the weekend.", hi: "रात्रिभोज, नृत्य और सप्ताहांत के समापन का एक सच्चा जश्न।" },
    "sch.addcal": { en: "＋ Add weekend to calendar", hi: "＋ कैलेंडर में सप्ताहांत जोड़ें" },
    "sch.haldi.when": { en: "Fri, Nov 6 · 11:00 AM – 1:00 PM", hi: "शुक्र, 6 नवंबर · 11:00 AM – 1:00 PM" },
    "sch.haldi.where": { en: "Conrad New York Downtown", hi: "कॉनराड न्यूयॉर्क डाउनटाउन" },
    "sch.sangeet.when": { en: "Fri, Nov 6 · 7:00 PM", hi: "शुक्र, 6 नवंबर · शाम 7:00" },
    "sch.sangeet.where": { en: "The Lighthouse at Pier 61", hi: "द लाइटहाउस, पियर 61" },
    "sch.ceremony.when": { en: "Sat, Nov 7<br>Baraat · 12:30 PM<br>Ceremony · 1:30–3:30 PM", hi: "शनि, 7 नवंबर<br>बारात · 12:30 PM<br>विवाह · 1:30–3:30 PM" },
    "sch.ceremony.where": { en: "Conrad New York Downtown", hi: "कॉनराड न्यूयॉर्क डाउनटाउन" },
    "sch.reception.when": { en: "Sat, Nov 7<br>Cocktails · 6:30 PM<br>Reception · 7:30–11:30 PM", hi: "शनि, 7 नवंबर<br>कॉकटेल · 6:30 PM<br>रिसेप्शन · 7:30–11:30 PM" },
    "sch.reception.where": { en: "Hall des Lumières", hi: "हॉल दे लुमिएर" },
    "sch.cal": { en: "＋ Calendar", hi: "＋ कैलेंडर" },
    "sch.gcal": { en: "📅 Google", hi: "📅 गूगल" },
    "sch.map": { en: "📍 Map", hi: "📍 नक्शा" },
    "ph.share.t": { en: "📸 Share your photos", hi: "📸 अपनी तस्वीरें साझा करें" },
    "ph.share.p": { en: "Add a snap from any of the events — it'll appear in the gallery below.", hi: "किसी भी आयोजन की तस्वीर जोड़ें — यह नीचे गैलरी में दिखाई देगी।" },
    "ph.share.name": { en: "Your name (optional)", hi: "आपका नाम (वैकल्पिक)" },
    "ph.share.cap": { en: "Caption (optional)", hi: "कैप्शन (वैकल्पिक)" },
    "ph.share.upload": { en: "Upload photo", hi: "तस्वीर अपलोड करें" },
    "ph.share.cam": { en: "📷 Take a photo", hi: "📷 फ़ोटो लें" },
    "ph.empty": { en: "No photos yet — be the first to share one!", hi: "अभी कोई तस्वीर नहीं — पहले साझा करने वाले बनें!" },
    "ph.cmt.none": { en: "No comments yet — say something kind!", hi: "अभी कोई टिप्पणी नहीं — कुछ अच्छा लिखें!" },
    "ph.cmt.name": { en: "Your name", hi: "आपका नाम" },
    "ph.cmt.ph": { en: "Add a comment…", hi: "एक टिप्पणी जोड़ें…" },
    "ph.cmt.posting": { en: "Posting…", hi: "भेजा जा रहा है…" },
    "ph.cmt.need": { en: "Write a comment first.", hi: "पहले एक टिप्पणी लिखें।" },
    "ph.cmt.guest": { en: "A guest", hi: "एक अतिथि" },
    "gb.name": { en: "Your name <em>*</em>", hi: "आपका नाम <em>*</em>" },
    "gb.msg": { en: "Your message <em>*</em>", hi: "आपका संदेश <em>*</em>" },
    "gb.ph": { en: "Wishing you a lifetime of love and laughter…", hi: "आपको जीवनभर प्यार और हँसी की शुभकामनाएँ…" },
    "gb.sign": { en: "Sign the guestbook", hi: "शुभकामना लिखें" },
    "gb.empty": { en: "No messages yet — be the first to sign! ✍️", hi: "अभी कोई संदेश नहीं — पहले लिखने वाले बनें! ✍️" },
    "mu.song": { en: "Song <em>*</em>", hi: "गाना <em>*</em>" },
    "mu.artist": { en: "Artist", hi: "कलाकार" },
    "mu.name": { en: "Your name", hi: "आपका नाम" },
    "mu.ded": { en: "Dedication (optional)", hi: "समर्पण (वैकल्पिक)" },
    "mu.song.ph": { en: "e.g. Kala Chashma", hi: "जैसे: काला चश्मा" },
    "mu.artist.ph": { en: "e.g. Amar Arshi", hi: "जैसे: अमर अरशी" },
    "mu.ded.ph": { en: "For the bride & groom!", hi: "दूल्हा-दुल्हन के लिए!" },
    "mu.add": { en: "Add to the playlist", hi: "प्लेलिस्ट में जोड़ें" },
    "mu.empty": { en: "No requests yet — get the party started! 🎶", hi: "अभी कोई फ़रमाइश नहीं — महफ़िल शुरू करें! 🎶" },
    "rs.name": { en: "Full name <em>*</em>", hi: "पूरा नाम <em>*</em>" },
    "rs.email": { en: "Email <em>*</em>", hi: "ईमेल <em>*</em>" },
    "rs.attend": { en: "Will you attend? <em>*</em>", hi: "क्या आप आएँगे? <em>*</em>" },
    "rs.choose": { en: "Please choose…", hi: "कृपया चुनें…" },
    "rs.yes": { en: "Joyfully accepts", hi: "सहर्ष स्वीकार" },
    "rs.no": { en: "Regretfully declines", hi: "सखेद अस्वीकार" },
    "rs.guests": { en: "Number in your party", hi: "आपके समूह में सदस्यों की संख्या" },
    "rs.events": { en: "Which events will you join?", hi: "आप किन आयोजनों में शामिल होंगे?" },
    "rs.song": { en: "A song to get you on the dance floor", hi: "एक ऐसा गीत जो आपको डांस फ़्लोर पर ले आए" },
    "rs.song.ph": { en: "Optional — a song we should play", hi: "वैकल्पिक — कोई गाना जो हम बजाएँ" },
    "rs.note": { en: "A note for the couple", hi: "वर-वधू के लिए एक संदेश" },
    "rs.note.ph": { en: "Anything you'd like us to know — a message, dietary needs…", hi: "जो भी आप बताना चाहें — कोई संदेश, भोजन संबंधी ज़रूरतें…" },
    "rs.send": { en: "Send RSVP", hi: "उपस्थिति भेजें" },
    "rs.gifts.t": { en: "Gifts &amp; blessings", hi: "उपहार और आशीर्वाद" },
    "rs.gifts.p": { en: "For those who wish to give, a gift may be sent by Zelle.", hi: "जो उपहार देना चाहें, वे Zelle के माध्यम से भेज सकते हैं।" },
    "rg.ty.t": { en: "Thank you", hi: "धन्यवाद" },
    "rg.ty.p": { en: "However you choose to celebrate with us — being there, a kind note, or a gift — we're endlessly grateful. 💛", hi: "आप हमारे साथ चाहे जैसे भी उत्सव मनाएँ — उपस्थित रहकर, एक स्नेहभरे संदेश से, या उपहार से — हम असीम आभारी हैं। 💛" },
    "rs.find.toggle": { en: "Already responded? Update your RSVP →", hi: "पहले से जवाब दिया? अपनी उपस्थिति बदलें →" },
    "rs.find.label": { en: "The email you RSVP'd with", hi: "वह ईमेल जिससे आपने उपस्थिति दर्ज की थी" },
    "rs.find.btn": { en: "Find my RSVP", hi: "मेरी उपस्थिति खोजें" },
    "rs.find.searching": { en: "Searching…", hi: "खोज रहे हैं…" },
    "rs.find.none": { en: "No RSVP found for that email — fill in the form below to respond.", hi: "उस ईमेल के लिए कोई उपस्थिति नहीं मिली — जवाब देने के लिए नीचे फ़ॉर्म भरें।" },
    "rs.find.loaded": { en: "Found it! Make your changes below, then update.", hi: "मिल गई! नीचे बदलाव करें, फिर अपडेट करें।" },
    "rs.find.needEmail": { en: "Enter your email.", hi: "अपना ईमेल दर्ज करें।" },
    "rs.update": { en: "Update RSVP", hi: "उपस्थिति अपडेट करें" },
    "rs.updated": { en: "Updated! Thanks, {n} — your RSVP is all set.", hi: "अपडेट हो गया! धन्यवाद, {n} — आपकी उपस्थिति दर्ज है।" },
    "rs.okYes": { en: "Thank you, {n}! We can't wait to celebrate with you. 🎉", hi: "धन्यवाद, {n}! हम आपके साथ उत्सव की प्रतीक्षा में हैं। 🎉" },
    "rs.okNo": { en: "Thank you for letting us know, {n}. You'll be missed! 💛", hi: "बताने के लिए धन्यवाद, {n}। आपकी कमी खलेगी! 💛" },
    "rs.fix": { en: "Please fill in the highlighted fields.", hi: "कृपया चिह्नित फ़ील्ड भरें।" },
    "ev.satbrunch": { en: "Brunch", hi: "ब्रंच" },
    "sch.satbrunch.when": { en: "Sat, Nov 7 · 10:00 AM", hi: "शनि, 7 नवंबर · 10:00 AM" },
    "sch.satbrunch.where": { en: "Conrad New York Downtown", hi: "कॉनराड न्यूयॉर्क डाउनटाउन" },
    "inv.overline": { en: "The Invitation", hi: "निमंत्रण" },
    "inv.title": { en: "A November Wedding in New York", hi: "New York में नवंबर का एक विवाह" },
    "inv.p": { en: "Together with our families, we invite you to celebrate our wedding weekend. Nothing would mean more than having you with us.", hi: "अपने परिवारों के साथ, हम आपको अपने विवाह-सप्ताहांत के उत्सव में सादर आमंत्रित करते हैं। आपका साथ होना हमारे लिए सबसे बड़ी खुशी होगी।" },
    "vn.kicker": { en: "With Thanks", hi: "धन्यवाद सहित" },
    "vn.title": { en: "The Team Behind the Weekend", hi: "इस सप्ताहांत के पीछे की टीम" },
    "vn.lede": { en: "The wonderful people bringing our celebration to life.", hi: "वे अद्भुत लोग जो हमारे समारोह को जीवंत बना रहे हैं।" },
    "pt.memory.note": { en: "Though they cannot celebrate beside us, their love and memories remain part of this journey.", hi: "यद्यपि वे हमारे साथ इस उत्सव में सम्मिलित नहीं हो सकते, उनका प्रेम और उनकी स्मृतियाँ इस यात्रा का अभिन्न हिस्सा हैं।" },
    "pt.uog": { en: "Uncle of the Groom", hi: "वर के चाचा" },
    "pt.role.friendg": { en: "Friend of the Groom", hi: "वर के मित्र" },
    "pt.role.childfriendg": { en: "Childhood Friend of the Groom", hi: "वर के बचपन के मित्र" },
    "pt.role.cousing": { en: "Cousin of the Groom", hi: "वर के कज़िन" },
    "pt.role.cousinb": { en: "Cousin of the Bride", hi: "वधू के कज़िन" },
    "pt.role.bilg": { en: "Brother-in-law of the Groom", hi: "वर के बहनोई" },
    "faq.q7": { en: "Where should I stay?", hi: "कहाँ ठहरें?" },
    "faq.a7": { en: "We've reserved a block of rooms at the Conrad New York Downtown, our home base for the weekend. Book from the <a href='travel.html'>Travel & Stay</a> page using group code <strong>KMWED26</strong>, and reserve by <strong>October 6, 2026</strong> to secure the group rate.", hi: "हमने कॉनराड न्यूयॉर्क डाउनटाउन में कमरों का एक ब्लॉक आरक्षित किया है — सप्ताहांत का हमारा ठिकाना। <a href='travel.html'>यात्रा और ठहराव</a> पृष्ठ से ग्रुप कोड <strong>KMWED26</strong> के साथ बुक करें, और समूह दर पाने के लिए <strong>6 अक्टूबर 2026</strong> तक आरक्षण करें।" },
    "faq.q8": { en: "Will there be vegetarian food?", hi: "क्या शाकाहारी भोजन होगा?" },
    "faq.a8": { en: "Our wedding meals will be served buffet-style, with many vegetarian options available. Guests with nut allergies should notify a banquet server before approaching the buffet so the team can provide guidance regarding the available dishes.", hi: "हमारे विवाह के भोजन बुफ़े शैली में परोसे जाएँगे, जिसमें कई शाकाहारी विकल्प उपलब्ध होंगे। नट्स से एलर्जी वाले अतिथि कृपया बुफ़े पर जाने से पहले बैंक्वेट सर्वर को सूचित करें, ताकि वे उपलब्ध व्यंजनों के बारे में मार्गदर्शन दे सकें।" },
    "faq.q9": { en: "Can I take photos during the ceremony?", hi: "क्या मैं समारोह के दौरान फ़ोटो ले सकता/सकती हूँ?" },
    "faq.a9": { en: "Yes, we'd love that! During a few sacred moments we may gently ask for phones down so everyone can simply be present — our photographers will capture every part to share with you afterwards.", hi: "हाँ, हमें बहुत खुशी होगी! कुछ पवित्र क्षणों के दौरान हम धीरे से फ़ोन नीचे रखने का अनुरोध कर सकते हैं ताकि हर कोई बस उस पल में मौजूद रहे — हमारे फ़ोटोग्राफ़र हर पल को कैद करेंगे और बाद में आपके साथ साझा करेंगे।" },
    "tv.stay.book": { en: "Reserve your room →", hi: "अपना कमरा आरक्षित करें →" },
    "rg.zelle.p": { en: "For those who wish to give, a gift may be sent by Zelle.", hi: "जो उपहार देना चाहें, वे Zelle के माध्यम से भेज सकते हैं।" },
    "rg.zelle.btn": { en: "Click here for Zelle", hi: "Zelle के लिए यहाँ क्लिक करें" },
    "rg.zelle.hint": { en: "Or simply speak to the bride or groom, who will gladly help.", hi: "या फिर वर-वधू से बात करें, वे सहर्ष सहायता करेंगे।" },
    "rg.zelle.modal.t": { en: "Send a gift", hi: "उपहार भेजें" },
    "rg.zelle.scan": { en: "Scan with your banking app.", hi: "अपने बैंकिंग ऐप से स्कैन करें।" },
    "rs.gifts.btn": { en: "Gifts & Blessings", hi: "उपहार एवं आशीर्वाद" },
    "rs.phone": { en: "Phone (optional)", hi: "फ़ोन (वैकल्पिक)" },
    "rs.phone.consent": { en: "By sharing your number you agree to receive wedding-related texts from us. Reply STOP anytime to opt out.", hi: "अपना नंबर साझा करके आप हमसे विवाह-संबंधी संदेश प्राप्त करने के लिए सहमत होते हैं। बंद करने के लिए कभी भी STOP का उत्तर दें।" },
    "rs.phone.err": { en: "Please enter a phone number we can reach you on.", hi: "कृपया एक फ़ोन नंबर दर्ज करें जिस पर हम आपसे संपर्क कर सकें।" },
    "rs.attendees": { en: "Who is coming? Please list everyone by name", hi: "कौन-कौन आ रहे हैं? कृपया सभी के नाम लिखें" },
    "rs.attendees.help": { en: "If only some of your household can make it, just name those who can. This is how we seat everyone — without names we only have a number.", hi: "यदि आपके परिवार से कुछ ही लोग आ सकते हैं, तो कृपया उन्हीं के नाम लिखें। इन्हीं नामों से हम सबके बैठने की व्यवस्था करते हैं — नामों के बिना हमारे पास केवल संख्या रहती है।" },
    "rs.attendees.ph": { en: "e.g. Andrew Fried, Sarah Fried, Emma Fried", hi: "जैसे: Andrew Fried, Sarah Fried, Emma Fried" },
    "rs.children": { en: "How many are children under 12?", hi: "इनमें 12 वर्ष से छोटे बच्चे कितने हैं?" },
    "rs.children.note": { en: "(included in your party number)", hi: "(आपकी पार्टी संख्या में शामिल)" },
    "rs.children.help": { en: "Little ones are warmly welcome — knowing how many are joining helps us plan their seats and meals.", hi: "नन्हे मेहमानों का हार्दिक स्वागत है — कितने आ रहे हैं यह जानने से हमें उनके लिए बैठने और भोजन की व्यवस्था करने में मदद मिलती है।" },
    "rs.children.err": { en: "Please include your little ones in your party number — the count of children under 12 can't be more than your party size.", hi: "कृपया नन्हे मेहमानों को अपनी पार्टी संख्या में शामिल करें — 12 वर्ष से छोटे बच्चों की संख्या आपकी पार्टी संख्या से अधिक नहीं हो सकती।" },
    "rs.address": { en: "Postal address", hi: "डाक पता" },
    "rs.address.opt": { en: "(optional)", hi: "(वैकल्पिक)" },
    "rs.address.help.yes": { en: "So we can send you a thank-you and anything else that should arrive by post.", hi: "ताकि हम आपको धन्यवाद-पत्र और डाक से भेजी जाने वाली अन्य चीज़ें भेज सकें।" },
    "rs.address.help.no": { en: "Only if you would like a card from us — leave it blank if you would rather not.", hi: "केवल तभी जब आप हमसे एक कार्ड चाहते हों — नहीं तो इसे खाली छोड़ दें।" },
    "rs.address.ph": { en: "Street, city, state / country, postcode", hi: "सड़क, शहर, राज्य / देश, पिनकोड" },
    "rs.missing.link": { en: "Is someone missing from your invitation?", hi: "क्या आपके निमंत्रण में कोई छूट गया है?" },
    "rs.missing.label": { en: "Who should be included?", hi: "किन्हें शामिल किया जाना चाहिए?" },
    "rs.missing.ph": { en: "e.g. my fiancée is not listed", hi: "जैसे: मेरी मंगेतर सूची में नहीं है" },
    "rs.missing.help": { en: "Send your reply anyway — we will correct the numbers and confirm with you.", hi: "फिर भी अपना उत्तर भेज दें — हम संख्या ठीक कर देंगे और आपसे पुष्टि करेंगे।" },
    "rs.dining.t": { en: "Dining", hi: "भोजन" },
    "rs.dining.p": { en: "Our wedding meals will be served buffet-style, with many vegetarian options available. Guests with nut allergies should notify a banquet server before approaching the buffet so the team can provide guidance regarding the available dishes.", hi: "हमारे विवाह के भोजन बुफ़े शैली में परोसे जाएँगे, जिसमें कई शाकाहारी विकल्प उपलब्ध होंगे। नट्स से एलर्जी वाले अतिथि कृपया बुफ़े पर जाने से पहले बैंक्वेट सर्वर को सूचित करें, ताकि वे उपलब्ध व्यंजनों के बारे में मार्गदर्शन दे सकें।" },
    "rs.confirm.t": { en: "Is this you?", hi: "क्या यह आप हैं?" },
    "rs.confirm.found": { en: "We found an invitation for", hi: "हमें इनके लिए निमंत्रण मिला" },
    "rs.confirm.yes": { en: "Yes, continue", hi: "हाँ, आगे बढ़ें" },
    "rs.confirm.no": { en: "Not you? Search again", hi: "आप नहीं? फिर से खोजें" },
    "rs.confirm.which": { en: "Which invitation is yours?", hi: "इनमें से आपका निमंत्रण कौन-सा है?" },
    "rs.gate.label": { en: "Find your invitation — the name on your invite", hi: "अपना निमंत्रण खोजें — वही नाम जो आपके निमंत्रण पर है" },
    "rs.gate.btn": { en: "Find my invitation", hi: "मेरा निमंत्रण खोजें" },
    "rs.gate.needname": { en: "Please enter your name to continue.", hi: "आगे बढ़ने के लिए कृपया अपना नाम दर्ज करें।" },
    "rs.searching": { en: "Searching…", hi: "खोज रहे हैं…" },
    "rs.sending": { en: "Sending…", hi: "भेज रहे हैं…" },
    "rs.err.lookup": { en: "We're having trouble reaching the guest list — please check your connection and try again in a moment.", hi: "हमें अतिथि सूची तक पहुँचने में समस्या हो रही है — कृपया अपना कनेक्शन जाँचें और थोड़ी देर में फिर प्रयास करें।" },
    "rs.err.notfound": { en: "We couldn't find an invitation under that name. Please check the spelling — use the name as it appears on your invitation, or email us and we'll find you.", hi: "हमें इस नाम से कोई निमंत्रण नहीं मिला। कृपया वर्तनी जाँचें — वही नाम लिखें जो आपके निमंत्रण पर है, या हमें ईमेल करें और हम आपको ढूँढ लेंगे।" },
    "rs.err.server": { en: "Could not reach the server — please try again in a moment.", hi: "सर्वर तक नहीं पहुँच सके — कृपया थोड़ी देर में फिर प्रयास करें।" },
    "rs.err.save": { en: "We couldn't save your RSVP just now. Please try again.", hi: "हम अभी आपका उत्तर सहेज नहीं सके। कृपया फिर प्रयास करें।" },
    "rs.selfadd.ready": { en: "You're all set — enter your name to RSVP.", hi: "आप तैयार हैं — RSVP करने के लिए अपना नाम दर्ज करें।" },
    "rs.selfadd.ph": { en: "Your full name", hi: "आपका पूरा नाम" },
    "rs.selfadd.btn": { en: "Continue →", hi: "जारी रखें →" },
    "gal.moments.kicker": { en: "Moments Together", hi: "साथ बिताए पल" },
    "gal.moments.t": { en: "A Few of Our Favourites", hi: "हमारे कुछ पसंदीदा पल" },
    "gal.moments.lede": { en: "Tap any photo to view it full-screen.", hi: "किसी भी तस्वीर को पूरी स्क्रीन पर देखने के लिए टैप करें।" },
    "gb.success": { en: "Thank you! Your note will appear once approved.", hi: "धन्यवाद! स्वीकृति के बाद आपका संदेश दिखाई देगा।" },
    "gb.loadfail": { en: "Guestbook notes couldn't load just now. You can still leave a message.", hi: "शुभकामना संदेश अभी लोड नहीं हो सके। आप फिर भी संदेश छोड़ सकते हैं।" },
    "mu.viaRsvp": { en: "Song requests are collected with your RSVP — add a song to get you on the dance floor when you reply, and the DJ will see it.", hi: "गानों की फ़रमाइश आपकी RSVP के साथ ली जाती है — जवाब देते समय अपना गाना जोड़ें, DJ उसे देख लेंगे।" },
    "mu.goRsvp": { en: "Go to RSVP", hi: "RSVP पर जाएँ" },
    "more.privacy": { en: "Privacy Policy", hi: "गोपनीयता नीति" },
    "more.terms": { en: "SMS Terms", hi: "SMS शर्तें" },
    "ann.dismiss": { en: "Dismiss announcement", hi: "घोषणा हटाएँ" },
  };

  /* ---------- Kannada (ಕನ್ನಡ) overlay ---------- */
  const KN = {"title.index":"Priya & Sanjay","title.schedule":"ವೇಳಾಪಟ್ಟಿ","title.gallery":"ಫೋಟೋಗಳು","title.guestbook":"ಅತಿಥಿ ಪುಸ್ತಕ","title.rsvp":"RSVP","title.story":"ನಮ್ಮ ಕಥೆ","title.travel":"ಪ್ರಯಾಣ ಮತ್ತು ವಸತಿ","title.things-to-do":"ಮಾಡಬಹುದಾದ ಸಂಗತಿಗಳು","title.party":"ನಮ್ಮ ಆಪ್ತರು","title.music":"ಹಾಡಿನ ವಿನಂತಿಗಳು","title.seating":"ನಿಮ್ಮ ಆಸನ ಹುಡುಕಿ","title.pass":"ಈವೆಂಟ್ ಪಾಸ್","title.registry":"ಉಡುಗೊರೆ ಮತ್ತು ಆಶೀರ್ವಾದ","title.faq":"ಪದೇಪದೇ ಕೇಳುವ ಪ್ರಶ್ನೆಗಳು","title.admin":"RSVP ಡ್ಯಾಶ್‌ಬೋರ್ಡ್","tab.home":"ಮುಖಪುಟ","tab.schedule":"ವೇಳಾಪಟ್ಟಿ","tab.photos":"ಫೋಟೋಗಳು","tab.guestbook":"ಅತಿಥಿ ಪುಸ್ತಕ","tab.rsvp":"RSVP","sheet.more":"ಇನ್ನಷ್ಟು","more.story":"ನಮ್ಮ ಕಥೆ","more.travel":"ಪ್ರಯಾಣ ಮತ್ತು ವಸತಿ","more.things":"ಮಾಡಬಹುದಾದ ಸಂಗತಿಗಳು","more.party":"ನಮ್ಮ ಆಪ್ತರು","more.music":"ಹಾಡಿನ ವಿನಂತಿಗಳು","more.seating":"ನಿಮ್ಮ ಆಸನ ಹುಡುಕಿ","more.pass":"ಈವೆಂಟ್ ಪಾಸ್","more.registry":"ಉಡುಗೊರೆ ಮತ್ತು ಆಶೀರ್ವಾದ","more.faq":"ಪದೇಪದೇ ಕೇಳುವ ಪ್ರಶ್ನೆಗಳು","action.share":"ಈ ಆ್ಯಪ್ ಹಂಚಿಕೊಳ್ಳಿ","action.install":"⬇ ಹೋಮ್ ಸ್ಕ್ರೀನ್‌ಗೆ ಸೇರಿಸಿ","action.reminders":"ಜ್ಞಾಪನೆಗಳನ್ನು ಪಡೆಯಿರಿ","action.remindersOn":"ಜ್ಞಾಪನೆಗಳು ಆನ್ ಆಗಿವೆ ✓","concierge.title":"ವಿವಾಹ ಕನ್‌ಸಿಯರ್ಜ್","concierge.sub":"ವಾರಾಂತ್ಯದ ಬಗ್ಗೆ ಏನು ಬೇಕಾದರೂ ನನ್ನನ್ನು ಕೇಳಿ","concierge.ph":"ಉದಾ. ಸಂಗೀತಕ್ಕೆ ನಾನು ಏನನ್ನು ಧರಿಸಬೇಕು?","concierge.chip.dress":"ನಾನು ಏನನ್ನು ಧರಿಸಬೇಕು?","concierge.chip.travel":"ನಾನು ಅಲ್ಲಿಗೆ ಹೇಗೆ ತಲುಪುವುದು?","concierge.chip.schedule":"ವೇಳಾಪಟ್ಟಿ ಏನು?","concierge.chip.kids":"ನನ್ನ ಮಕ್ಕಳನ್ನು ಕರೆತರಬಹುದೇ?","a11y.skip":"ವಿಷಯಕ್ಕೆ ತೆರಳಿ","welcome.title":"ಸ್ವಾಗತ 🪔","welcome.sub":"Priya & Sanjay ಅವರ ವಾರಾಂತ್ಯದ ಎಲ್ಲವೂ, ನಿಮ್ಮ ಜೇಬಿನಲ್ಲಿ.","welcome.f1":"💌 RSVP ಮಾಡಿ — ಮತ್ತು ಯಾವಾಗ ಬೇಕಾದರೂ ಬದಲಿಸಿ","welcome.f2":"📸 ಫೋಟೋಗಳನ್ನು ಹಂಚಿಕೊಳ್ಳಿ ಮತ್ತು ಪ್ರತಿಕ್ರಿಯೆ ನೀಡಿ","welcome.f3":"💬 ಕನ್‌ಸಿಯರ್ಜ್‌ಗೆ ಏನು ಬೇಕಾದರೂ ಕೇಳಿ","welcome.f4":"🔔 ಆ ದಿನದ ಜ್ಞಾಪನೆಗಳನ್ನು ಆನ್ ಮಾಡಿ","welcome.f5":"🌐 ಯಾವಾಗ ಬೇಕಾದರೂ हिंदी ಗೆ ಬದಲಿಸಿ","welcome.cta":"ಅನ್ವೇಷಣೆ ಆರಂಭಿಸಿ","offline":"ನೀವು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿದ್ದೀರಿ — ಉಳಿಸಿದ ಪ್ರತಿ ತೋರಿಸಲಾಗುತ್ತಿದೆ.","toast.backOnline":"ಮತ್ತೆ ಆನ್‌ಲೈನ್ ✓","toast.remindersOn":"ನಿಮಗೆ ಆ ದಿನದ ಜ್ಞಾಪನೆಗಳು ಸಿಗುತ್ತವೆ 🔔","toast.remindersOff":"ಜ್ಞಾಪನೆಗಳನ್ನು ಆಫ್ ಮಾಡಲಾಗಿದೆ","toast.notifBlocked":"ನಿಮ್ಮ ಬ್ರೌಸರ್ ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ ಅಧಿಸೂಚನೆಗಳನ್ನು ನಿರ್ಬಂಧಿಸಲಾಗಿದೆ.","home.eyebrow":"ತಮ್ಮ ಕುಟುಂಬಗಳ ಸಮೇತ","home.tag":"ವಿವಾಹ ಬಂಧನದಲ್ಲಿ ಬೆಸೆದುಕೊಳ್ಳುತ್ತಿದ್ದಾರೆ","home.saturday":"ಶುಕ್ರವಾರ ಮತ್ತು ಶನಿವಾರ","home.place":"New York City","home.rsvpBtn":"Aug 31 ರೊಳಗೆ RSVP ಮಾಡಿ","home.stats":"💛 {n} ಅತಿಥಿಗಳು ನಮ್ಮೊಂದಿಗೆ ಸಂಭ್ರಮಿಸುತ್ತಿದ್ದಾರೆ","cd.days":"ದಿನಗಳು","cd.hours":"ಗಂಟೆಗಳು","cd.minutes":"ನಿಮಿಷಗಳು","cd.seconds":"ಸೆಕೆಂಡುಗಳು","explore.kicker":"ನಿಮಗೆ ಬೇಕಾದ ಎಲ್ಲವೂ","explore.title":"ಅನ್ವೇಷಿಸಿ","explore.lede":"ಮದುವೆ New York City ಯಲ್ಲಿ ನವೆಂಬರ್ 6 ಮತ್ತು 7 ರಂದು, ಭಾನುವಾರ ಒಂದು ಐಚ್ಛಿಕ ವಿದಾಯ ಬ್ರಂಚ್‌ನೊಂದಿಗೆ. ನಿಮಗೆ ಬೇಕಾದ್ದನ್ನು ಎಲ್ಲಿ ಕಾಣಬಹುದು ಎಂಬುದು ಇಲ್ಲಿದೆ.","exp.story.d":"Priya & Sanjay ಇಲ್ಲಿಯವರೆಗೆ ಹೇಗೆ ಬಂದರು.","exp.schedule.d":"ಹಲ್ದಿ, ಸಂಗೀತ, ಸಮಾರಂಭ ಮತ್ತು ಸ್ವಾಗತ ಸಮಾರಂಭ.","exp.travel.d":"ವಿಮಾನ ನಿಲ್ದಾಣ, ಹೋಟೆಲ್ ಬ್ಲಾಕ್ ಮತ್ತು ಓಡಾಟ.","exp.things.d":"New York ನಲ್ಲಿ ಇದನ್ನೊಂದು ಪ್ರವಾಸವಾಗಿಸಿಕೊಳ್ಳಿ.","exp.party.d":"ನಮ್ಮ ಜೊತೆ ನಿಲ್ಲುವವರನ್ನು ಭೇಟಿಯಾಗಿ.","exp.photos.d":"ನಿಮ್ಮ ಫೋಟೋಗಳನ್ನು ನೋಡಿ ಮತ್ತು ಹಂಚಿಕೊಳ್ಳಿ.","exp.guestbook.d":"ನಮಗೊಂದು ಬರಹ ಬಿಡಿ.","exp.rsvp.d":"ನೀವು ಬರುತ್ತಿರುವುದನ್ನು ನಮಗೆ ತಿಳಿಸಿ.","teaser.kicker":"ಅದು ಹೇಗೆ ಆರಂಭವಾಯಿತು","teaser.title":"ಇದು Long Island ನಲ್ಲಿ ಆರಂಭವಾಯಿತು","teaser.lede":"ಕಾಲೇಜಿನಲ್ಲಿ ತಡರಾತ್ರಿಯ ನರವಿಜ್ಞಾನದ ನಡುವೆ ಭೇಟಿಯಾದ Long Island ನ ಇಬ್ಬರು ಮಕ್ಕಳು — ಮತ್ತು ಒಂದು ದಶಕದ ನಂತರ Mohonk Mountain House ನಲ್ಲಿ ಹಿಮಮಯ ವಿವಾಹ ಪ್ರಸ್ತಾಪ. ಪೂರ್ಣ ಕಥೆಯನ್ನು ಓದಿ.","teaser.btn":"ನಮ್ಮ ಕಥೆ ಓದಿ","sub.story.kicker":"ಅದು ಹೇಗೆ ಆರಂಭವಾಯಿತು","sub.story.intro":"Long Island ನ ಆರಂಭ, ತಡರಾತ್ರಿಯ ಅಧ್ಯಯನಗಳು ಮತ್ತು Hudson Valley ನಲ್ಲಿ ಒಂದು ಹಿಮಮಯ \"ಹೌದು\".","sub.schedule.kicker":"ವಿವಾಹದ ವಾರಾಂತ್ಯ","sub.schedule.intro":"New York City ಯಲ್ಲಿ ಎರಡು ದಿನಗಳು — ನಿಮ್ಮ ಅತ್ಯಂತ ವರ್ಣಮಯ ಉಡುಪುಗಳನ್ನು ಮತ್ತು ನಿಮ್ಮ ನೃತ್ಯದ ಉತ್ಸಾಹವನ್ನು ತನ್ನಿ.","sub.travel.kicker":"ಅಲ್ಲಿಗೆ ತಲುಪುವುದು ಮತ್ತು ತಂಗುವುದು","sub.travel.intro":"ಎಲ್ಲವೂ Manhattan ನಲ್ಲಿ ನಡೆಯುತ್ತದೆ — ಸುಲಭವಾಗಿ ತಲುಪಬಹುದು, Conrad ನಲ್ಲಿ ಕಾಯ್ದಿರಿಸಿದ ಕೋಣೆಗಳೊಂದಿಗೆ.","sub.things.kicker":"ಇದನ್ನೊಂದು ಪ್ರವಾಸವಾಗಿಸಿಕೊಳ್ಳಿ","sub.things.intro":"ಬೇಗ ಬರುತ್ತಿದ್ದೀರಾ ಅಥವಾ ಉಳಿಯುತ್ತಿದ್ದೀರಾ? New York ಅನ್ನು ಆನಂದಿಸಲು ನಮ್ಮ ಕೆಲವು ನೆಚ್ಚಿನ ದಾರಿಗಳು.","sub.party.kicker":"ನಮ್ಮ ಜೊತೆಯಲ್ಲಿ","sub.party.intro":"ಈ ವಾರಾಂತ್ಯ ನಮ್ಮ ಪಕ್ಕದಲ್ಲಿ ನಿಲ್ಲುವ ಅತ್ಯಂತ ಪ್ರೀತಿಯ ಸ್ನೇಹಿತರು ಮತ್ತು ಕುಟುಂಬದವರು.","sub.music.kicker":"ಪ್ಲೇಲಿಸ್ಟ್ ರೂಪಿಸಲು ನಮಗೆ ಸಹಾಯ ಮಾಡಿ","sub.music.intro":"ಯಾವುದು ನಿಮ್ಮನ್ನು ನೃತ್ಯ ವೇದಿಕೆಗೆ ಕರೆತರುತ್ತದೆ? ಸಂಗೀತ ಮತ್ತು ಸ್ವಾಗತ ಸಮಾರಂಭಕ್ಕಾಗಿ ಅದನ್ನು DJ ಪಟ್ಟಿಗೆ ಸೇರಿಸಿ.","sub.registry.kicker":"ಕೃತಜ್ಞತೆಯೊಂದಿಗೆ","sub.registry.intro":"ನಿಮ್ಮ ಪ್ರೀತಿ ಮತ್ತು ಆಶೀರ್ವಾದವೇ ನಮಗೆ ಎಲ್ಲವೂ.","sub.faq.kicker":"ತಿಳಿದಿರಬೇಕಾದದ್ದು","sub.faq.intro":"ಇನ್ನೂ ಪ್ರಶ್ನೆ ಇದೆಯೇ? 💬 ಕನ್‌ಸಿಯರ್ಜ್ ಟ್ಯಾಪ್ ಮಾಡಿ ಅಥವಾ ನಮಗೆ ಇಮೇಲ್ ಮಾಡಿ — ಸಹಾಯ ಮಾಡಲು ನಮಗೆ ಸಂತೋಷ.","sub.gallery.kicker":"ಒಂದು ಹಂಚಿದ ಆಲ್ಬಮ್","sub.gallery.intro":"ವಾರಾಂತ್ಯದಲ್ಲಿ ಒಂದು ಕ್ಷಣ ಸೆರೆಹಿಡಿದಿರಾ? ಎಲ್ಲರೂ ಅದನ್ನು ಮತ್ತೆ ಸವಿಯುವಂತೆ ಇಲ್ಲಿ ಹಂಚಿಕೊಳ್ಳಿ.","sub.guestbook.kicker":"ನಮಗೊಂದು ಬರಹ ಬಿಡಿ","sub.guestbook.intro":"ಒಂದು ನೆನಪು, ಒಂದು ಆಶೀರ್ವಾದ ಅಥವಾ ವೈವಾಹಿಕ ಜೀವನಕ್ಕೊಂದು ಸಲಹೆಯನ್ನು ಹಂಚಿಕೊಳ್ಳಿ. ಪ್ರತಿಯೊಂದು ಪದವನ್ನೂ ನಾವು ಜೋಪಾನವಾಗಿ ಇಡುತ್ತೇವೆ.","sub.rsvp.kicker":"ನಿಮ್ಮೊಂದಿಗೆ ಸಂಭ್ರಮಿಸಲು ನಾವು ಕಾತುರದಿಂದ ಕಾಯುತ್ತಿದ್ದೇವೆ","sub.rsvp.intro":"ದಯವಿಟ್ಟು <strong>August 31, 2026</strong> ರೊಳಗೆ ಪ್ರತಿಕ್ರಿಯಿಸಿ. ಪ್ರತಿ ಮನೆಗೆ ಒಂದು ಸಲ್ಲಿಕೆ ಸಾಕು.","sub.seating.kicker":"ಸ್ವಾಗತ ಸಮಾರಂಭದಲ್ಲಿ","sub.seating.intro":"ಸ್ವಾಗತ ಸಮಾರಂಭದ ಭೋಜನಕ್ಕೆ ನಿಮ್ಮ ಟೇಬಲ್ ಹುಡುಕಲು ನಿಮ್ಮ ಹೆಸರನ್ನು ನಮೂದಿಸಿ.","sub.pass.kicker":"ನಿಮ್ಮ ಡಿಜಿಟಲ್ ಪಾಸ್","sub.pass.intro":"ನಿಮ್ಮ ವೈಯಕ್ತಿಕ ಪಾಸ್ ಅನ್ನು ತೆರೆಯಿರಿ — ನಿಮ್ಮ ಸಮಾರಂಭಗಳು, ಟೇಬಲ್ ಮತ್ತು ಕ್ಯಾಲೆಂಡರ್‌ಗೆ ಸೇರಿಸಲು ಒಂದು ತ್ವರಿತ ಆಯ್ಕೆ.","pass.label":"ನೀವು RSVP ಮಾಡಿದ ಇಮೇಲ್","pass.find":"ನನ್ನ ಪಾಸ್ ಪಡೆಯಿರಿ","pass.searching":"ಹುಡುಕಲಾಗುತ್ತಿದೆ…","pass.none":"ಆ ಇಮೇಲ್‌ಗೆ ನಮಗೆ RSVP ಸಿಗಲಿಲ್ಲ. ನೀವು ಈಗಾಗಲೇ RSVP ಮಾಡಿದ್ದೀರಾ?","pass.notyes":"ನಿಮ್ಮ RSVP ಹಾಜರಾಗುತ್ತಿಲ್ಲ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ. ಅದು ಬದಲಾಗಿದ್ದರೆ RSVP ಪುಟದಲ್ಲಿ ನವೀಕರಿಸಿ.","pass.needEmail":"ನಿಮ್ಮ ಇಮೇಲ್ ನಮೂದಿಸಿ.","pass.err":"ಏನೋ ತಪ್ಪಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.","pass.admits":"ಪ್ರವೇಶ","pass.events":"ನಿಮ್ಮ ಸಮಾರಂಭಗಳು","pass.allevents":"ಎಲ್ಲಾ ಸಂಭ್ರಮಗಳು","pass.table":"ಟೇಬಲ್","pass.tablePending":"ದಿನ ಹತ್ತಿರವಾದಂತೆ ನಿಗದಿಪಡಿಸಲಾಗುವುದು","pass.addcal":"＋ ನನ್ನ ಸಮಾರಂಭಗಳನ್ನು ಕ್ಯಾಲೆಂಡರ್‌ಗೆ ಸೇರಿಸಿ","pass.savehint":"ಸಲಹೆ: ಈ ಪಾಸ್ ಅನ್ನು ಕೈಗೆಟುಕುವಂತೆ ಇಟ್ಟುಕೊಳ್ಳಲು ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ತೆಗೆಯಿರಿ.","pass.guest":"ಅತಿಥಿ","seat.label":"ನಿಮ್ಮ ಹೆಸರು","seat.find":"ನನ್ನ ಟೇಬಲ್ ಹುಡುಕಿ","seat.searching":"ಹುಡುಕುತ್ತಿದೆ…","seat.none":"ಅತಿಥಿ ಪಟ್ಟಿಯಲ್ಲಿ ಆ ಹೆಸರು ನಮಗೆ ಸಿಗಲಿಲ್ಲ. ಕಾಗುಣಿತವನ್ನು ಮತ್ತೊಮ್ಮೆ ಪರಿಶೀಲಿಸಿ, ಅಥವಾ ವಧು-ವರರನ್ನು ಸಂಪರ್ಕಿಸಿ.","seat.table":"ಟೇಬಲ್","seat.pending":"ನೀವು ಪಟ್ಟಿಯಲ್ಲಿದ್ದೀರಿ! ದಿನ ಹತ್ತಿರವಾದಂತೆ ನಿಮ್ಮ ಟೇಬಲ್ ನಿಗದಿಪಡಿಸಲಾಗುವುದು.","seat.err":"ಏನೋ ತಪ್ಪಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.","now.happening":"ಈಗ ನಡೆಯುತ್ತಿದೆ","now.upnext":"ಮುಂದೆ","now.inMin":"{n} ನಿಮಿಷಗಳಲ್ಲಿ","now.inHM":"{h}ಗಂ {m}ನಿ ನಲ್ಲಿ","now.tomorrow":"ನಾಳೆ","now.wrap":"ಇಷ್ಟಕ್ಕೇ ಮುಗಿಯಿತು — ನಮ್ಮೊಂದಿಗೆ ಸಂಭ್ರಮಿಸಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು 💛","ev.haldi":"ಹಲ್ದಿ","ev.sangeet":"ಸಂಗೀತ","ev.ceremony":"ವಿವಾಹ ಸಮಾರಂಭ","ev.reception":"ಸ್ವಾಗತ ಸಮಾರಂಭ","ev.brunch":"ವಿದಾಯ ಬ್ರಂಚ್","sch.brunch.when":"ಭಾನುವಾರ, Nov 8 · ತಡ ಬೆಳಿಗ್ಗೆ","sch.brunch.where":"ಐಚ್ಛಿಕ · ವಿವರಗಳು ಶೀಘ್ರದಲ್ಲೇ","sch.brunch.desc":"ಎಲ್ಲರೂ ಮನೆಗೆ ಹೊರಡುವ ಮುನ್ನ ಜೊತೆಯಾಗಿ ಒಂದು ಕೊನೆಯ ಕಾಫಿ.","st.2019.t":"ಎಲ್ಲಿ ಆರಂಭವಾಯಿತು — Long Island","st.2019.p":"ನಾವಿಬ್ಬರೂ Long Island ನಲ್ಲಿ ಬೆಳೆದೆವು, ಆದರೂ ನಮ್ಮ ದಾರಿಗಳು ಸಂಧಿಸಿದ್ದು ನಂತರವೇ. ಅತ್ಯುತ್ತಮ ಸಂಗತಿಗಳು ಆರಂಭವಾಗುವಂತೆ, ಇದೂ ಹದಿನೈದು ವರ್ಷಗಳ ಹಿಂದೆ ಆರಂಭವಾಯಿತು.","st.2021.t":"ಕಾಲೇಜು — ತಡರಾತ್ರಿಯ ಅಧ್ಯಯನಗಳು","st.2021.p":"ನಾವು ಕಾಲೇಜಿನಲ್ಲಿ ಭೇಟಿಯಾದೆವು. ನರವಿಜ್ಞಾನದ ತಡರಾತ್ರಿಯ ಅಧ್ಯಯನಗಳು ಒಂದು ಜೀವನಪರ್ಯಂತದ ಜೊತೆಯಾಗಿ ಬದಲಾಗುತ್ತವೆ ಎಂದು ಆಗ ನಮಗೆ ತಿಳಿದಿರಲಿಲ್ಲ.","st.2025.t":"ವಿವಾಹ ಪ್ರಸ್ತಾಪ — Mohonk Mountain House","st.2025.p":"ಒಂದು ದಶಕದ ನಂತರ, Hudson Valley ನ Mohonk Mountain House ನ ಹಿಮ ಹೊದ್ದ ಜಗುಲಿಯಲ್ಲಿ Sanjay ವಿವಾಹ ಪ್ರಸ್ತಾಪ ಮಾಡಿದರು.","st.2026.t":"2026 — New York City","st.2026.p":"ಈ ನವೆಂಬರ್‌ನಲ್ಲಿ, ನಮ್ಮ ಬದುಕಿನ ಮುಂದಿನ ಅಧ್ಯಾಯವನ್ನು ಅದು ಆರಂಭವಾದ ರೀತಿಯಲ್ಲೇ — ಪ್ರೀತಿಯ ಬೆಚ್ಚನೆಯ ಭಾವ, ಒಳ್ಳೆಯ ಸಂಗ ಮತ್ತು ಸಮೃದ್ಧ ಸಂತೋಷದ ನಡುವೆ — ಆಚರಿಸಲು ನಾವು ನಮ್ಮ ಎಲ್ಲ ಪ್ರೀತಿಪಾತ್ರರನ್ನು New York City ಗೆ ಕರೆತರುತ್ತಿದ್ದೇವೆ.","st.btn":"ವೇಳಾಪಟ್ಟಿ ನೋಡಿ","faq.q1":"ನಾನು ಏನನ್ನು ಧರಿಸಬೇಕು?","faq.a1":"ಎಲ್ಲಾ ಕಾರ್ಯಕ್ರಮಗಳಲ್ಲಿ ಭಾರತೀಯ ಹಬ್ಬದ ಉಡುಗೆಯನ್ನು ಹೃತ್ಪೂರ್ವಕವಾಗಿ ಪ್ರೋತ್ಸಾಹಿಸಲಾಗುತ್ತದೆ. ಹಲ್ದಿಗೆ ಸ್ವಲ್ಪ ಅರಿಶಿನ ತಾಗಿದರೂ ಪರವಾಗಿಲ್ಲದ ಉಡುಗೆ; ಸಂಗೀತವು ಬಣ್ಣಬಣ್ಣದ ಮತ್ತು ಸಂಭ್ರಮದ; ವಿವಾಹವು ಸಾಂಪ್ರದಾಯಿಕ; ಸ್ವಾಗತ ಸಮಾರಂಭವು ಭಾರತೀಯ ಸಾಂಪ್ರದಾಯಿಕ ಅಥವಾ ಬ್ಲ್ಯಾಕ್ ಟೈ. ಸಂದೇಹವಿದ್ದರೆ, ಸಂಭ್ರಮಕ್ಕೆ ತಕ್ಕಂತೆ ಧರಿಸಿ.","faq.q2":"ಯಾವ ಬಣ್ಣಗಳನ್ನು ತಪ್ಪಿಸಬೇಕು?","faq.a2":"ಯಾವ ಬಣ್ಣಗಳು/ಉಡುಪುಗಳನ್ನು ಶಿಫಾರಸು ಮಾಡಲಾಗಿದೆ ಎಂದು ನೋಡಲು ದಯವಿಟ್ಟು ವೇಳಾಪಟ್ಟಿ ಪುಟದಲ್ಲಿ ಪ್ರತಿ ಕಾರ್ಯಕ್ರಮವನ್ನು ನೋಡಿ.","faq.q3":"ನಾನು ಒಬ್ಬ ಅತಿಥಿಯನ್ನು ಕರೆತರಬಹುದೇ?","faq.a3":"ನಿಮ್ಮ ಆಮಂತ್ರಣ ಮತ್ತು RSVP ನಿಮಗಾಗಿ ಕಾಯ್ದಿರಿಸಿದ ಆಸನಗಳನ್ನು ಸೂಚಿಸುತ್ತವೆ. ನಿಮ್ಮ ಗುಂಪಿನ ಬಗ್ಗೆ ಪ್ರಶ್ನೆಯಿದ್ದರೆ, ದಯವಿಟ್ಟು ಸಂಪರ್ಕಿಸಿ, ಸಹಾಯ ಮಾಡಲು ನಮಗೆ ಸಂತೋಷ.","faq.q4":"ಹವಾಮಾನ ಹೇಗಿರುತ್ತದೆ?","faq.a4":"New York ನಲ್ಲಿ November ಆರಂಭದಲ್ಲಿ ಹವಾಮಾನ ತಂಪಾಗಿರುತ್ತದೆ — ಸಾಮಾನ್ಯವಾಗಿ 40–55°F (5–13°C). ಸಂಜೆಗಾಗಿ ಒಂದು ಶಾಲು ಅಥವಾ ಕೋಟ್ ತನ್ನಿ.","faq.q5":"ಸ್ಥಳಗಳ ನಡುವೆ ಓಡಾಟ?","faq.a5":"ಎಲ್ಲವೂ Manhattan ನಲ್ಲಿಯೇ ಇದೆ, ಸ್ವಲ್ಪ ದೂರದಲ್ಲಷ್ಟೇ. ಟ್ಯಾಕ್ಸಿ ಮತ್ತು ರೈಡ್‌ಶೇರ್ ಧಾರಾಳವಾಗಿ ಲಭ್ಯ. ವಿಮಾನ ನಿಲ್ದಾಣದಿಂದ ಹೋಟೆಲ್‌ಗೆ ಶಟಲ್ ಸೇವೆ ಇರುವುದಿಲ್ಲ — ಅತಿಥಿಗಳು ತಮ್ಮ ಪ್ರಯಾಣದ ವ್ಯವಸ್ಥೆಯನ್ನು ತಾವೇ ಮಾಡಿಕೊಳ್ಳಬೇಕೆಂದು ವಿನಮ್ರವಾಗಿ ಕೋರುತ್ತೇವೆ. ಸ್ಥಳಗಳ ನಡುವಿನ ಗುಂಪು ಸಾರಿಗೆ ಪ್ರತ್ಯೇಕವಾಗಿದ್ದು, ಆ ವಿವರಗಳು ನಂತರ ಬರಲಿವೆ.","faq.q6":"ನಾನು ಯಾವಾಗ RSVP ಮಾಡಬೇಕು, ಮತ್ತು ಯಾರನ್ನು ಕೇಳಬೇಕು?","tv.fly.t":"✈️ ವಿಮಾನದಲ್ಲಿ ಆಗಮನ","tv.fly.p2":"ನ್ಯೂಯಾರ್ಕ್‌ನ ಮೂರು ವಿಮಾನ ನಿಲ್ದಾಣಗಳಲ್ಲಿ — JFK, LaGuardia (LGA), ಅಥವಾ Newark (EWR) — ಯಾವುದಕ್ಕಾದರೂ ಬನ್ನಿ. ಎಲ್ಲವೂ Manhattan ತಲುಪಿಸುತ್ತವೆ — ಸಂಚಾರ ಅವಲಂಬಿಸಿ ಕಾರಿನಲ್ಲಿ 45–75 ನಿಮಿಷ ಇಟ್ಟುಕೊಳ್ಳಿ.","tv.stay.t":"🏨 ಎಲ್ಲಿ ತಂಗಬೇಕು","tv.stay.p1":"ನಾವು <strong>Conrad New York Downtown</strong> ನಲ್ಲಿ ಕೋಣೆಗಳನ್ನು ಕಾಯ್ದಿರಿಸಿದ್ದೇವೆ — ಈ ವಾರಾಂತ್ಯದ ನಮ್ಮ ನೆಲೆ, ಸಂಭ್ರಮಗಳಿಂದ ಕೆಲವೇ ಕ್ಷಣಗಳ ದೂರದಲ್ಲಿ.","tv.stay.p2":"ಗುಂಪು ದರ <strong>$409/ರಾತ್ರಿ</strong> ಯಿಂದ, ಕೊಠಡಿಗಳು <strong>Nov 5–8</strong> ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ. ಗುಂಪು ಕೋಡ್ <strong>KMWED26</strong> ಬಳಸಿ <strong>ಅಕ್ಟೋಬರ್ 6, 2026</strong> ರೊಳಗೆ ಬುಕ್ ಮಾಡಿ.","tv.stay.btn":"ಹೋಟೆಲ್ ನೋಡಿ","tv.venue.t":"📍 ಸ್ಥಳಗಳು","tv.venue.p":"ಮೂರೂ ಸಂಭ್ರಮದ ಸ್ಥಳಗಳು Manhattan ನಲ್ಲಿವೆ — Conrad ಮತ್ತು Hall des Lumières ಲೋವರ್ ಮ್ಯಾನ್‌ಹ್ಯಾಟನ್‌ನಲ್ಲಿ, The Lighthouse at Pier 61 ಚೆಲ್ಸಿಯಲ್ಲಿ.","tv.venue.btn":"Maps ನಲ್ಲಿ ತೆರೆಯಿರಿ","tv.around.t":"🚕 ಓಡಾಟ","tv.around.p":"ವಾರಾಂತ್ಯವನ್ನು ಸುಲಭಗೊಳಿಸಲು ಕೆಲವು ಸೂಚನೆಗಳು. ವಿಮಾನ ನಿಲ್ದಾಣದಿಂದ ಹೋಟೆಲ್‌ಗೆ ಶಟಲ್ ಸೇವೆ ಇರುವುದಿಲ್ಲ — ಅತಿಥಿಗಳು ತಮ್ಮ ಪ್ರಯಾಣದ ವ್ಯವಸ್ಥೆಯನ್ನು ತಾವೇ ಮಾಡಿಕೊಳ್ಳಬೇಕೆಂದು ವಿನಮ್ರವಾಗಿ ಕೋರುತ್ತೇವೆ. ಸ್ಥಳಗಳ ನಡುವಿನ ಗುಂಪು ಸಾರಿಗೆ ಕಾನ್ರಾಡ್‌ನಿಂದ ಇರುತ್ತದೆ — ಸಮಯದ ವಿವರ ನವೆಂಬರ್ ಹತ್ತಿರವಾದಂತೆ ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ.","tv.btn":"New York ನಲ್ಲಿ ಮಾಡಬಹುದಾದ ಸಂಗತಿಗಳು","td.t1":"ಶ್ರೇಷ್ಠ ತಾಣ","td.h1":"Central Park","td.p1":"Manhattan ನ ಹಸಿರು ಹೃದಯ — ಬಣ್ಣ ಬದಲಿಸುವ ಎಲೆಗಳ ನಡುವೆ ಶರತ್ಕಾಲದ ವಿಹಾರಕ್ಕೆ ಪರಿಪೂರ್ಣ.","td.t2":"ಸಂಸ್ಕೃತಿ","td.h2":"ವಿಶ್ವ ದರ್ಜೆಯ ವಸ್ತುಸಂಗ್ರಹಾಲಯಗಳು","td.p2":"The Met, MoMA ಮತ್ತು Natural History Museum ಎಲ್ಲವೂ ಸ್ವಲ್ಪ ದೂರದಲ್ಲಿವೆ — ಮಳೆಯ ದಿನದ ಕನಸು.","td.t3":"ದೃಶ್ಯಗಳು","td.h3":"ಆಕಾಶರೇಖೆಯ ದೃಶ್ಯಗಳು","td.p3":"ಆಕಾಶರೇಖೆಗಾಗಿ Top of the Rock, Empire State ಅಥವಾ Edge; ಅಥವಾ Statue of Liberty ದಾಟಿ ಸಾಗುವ Staten Island Ferry (ಉಚಿತ!).","td.t4":"ಸುತ್ತಾಟ","td.h4":"The High Line &amp; Chelsea","td.p4":"ಬೀದಿಗಳ ಮೇಲಿನ ಒಂದು ಉದ್ಯಾನ ನಡಿಗೆದಾರಿ, Chelsea Market ಮತ್ತು The Lighthouse at Pier 61 ಬಳಿ ಮುಗಿಯುತ್ತದೆ.","td.t5":"ಹತ್ತಿರದಲ್ಲಿ","td.h5":"Battery Park &amp; ಬಂದರು","td.p5":"Conrad ನ ಸಮೀಪದಲ್ಲೇ — ದಡದ ದಾರಿಗಳು, ಬಂದರು ಮತ್ತು Statue of Liberty ಹಾಗೂ Ellis Island ಗೆ ದೋಣಿಗಳು.","td.t6":"ಊಟ","td.h6":"NYC ಯಲ್ಲಿ ಇಷ್ಟಪಟ್ಟು ತಿನ್ನಿ","td.p6":"ಒಂದು ಬೇಗಲ್ ಮತ್ತು ಒಂದು ಸ್ಲೈಸ್, Chinatown ನಲ್ಲಿ ಡಂಪ್ಲಿಂಗ್ಸ್, ಅಥವಾ ಭೋಜನದೊಂದಿಗೆ ಒಂದು Broadway ಪ್ರದರ್ಶನ. ಆಯ್ಕೆಗಳಿಗಾಗಿ ಕನ್‌ಸಿಯರ್ಜ್‌ಗೆ ಕೇಳಿ!","td.tip":"ಸಲಹೆ: ವೈಯಕ್ತಿಕ ಶಿಫಾರಸುಗಳಿಗಾಗಿ ಯಾವಾಗ ಬೇಕಾದರೂ 💬 ಕನ್‌ಸಿಯರ್ಜ್ ಟ್ಯಾಪ್ ಮಾಡಿ.","pt.bridesmaids":"ವಧುವಿನ ಗೆಳತಿಯರು","pt.groomsmen":"ವರನ ಗೆಳೆಯರು","pt.withlove":"ಪ್ರೀತಿಯಿಂದ","pt.memory":"ಪ್ರೀತಿಯ ನೆನಪಿನಲ್ಲಿ","pt.mob":"ವಧುವಿನ ತಾಯಿ","pt.mog":"ವರನ ತಾಯಿ","pt.gfog":"ವರನ ಅಜ್ಜ","pt.fob":"ವಧುವಿನ ತಂದೆ","pt.fog":"ವರನ ತಂದೆ","pt.gmog":"ವರನ ಅಜ್ಜಿ","sch.haldi.dress":"<strong>ಉಡುಗೆ:</strong> ಸ್ವಲ್ಪ ಅರಿಶಿನ ತಾಗಿದರೂ ಬೇಸರವಾಗದ ಪ್ರಕಾಶಮಾನ, ಸುಲಭ ಬಣ್ಣಗಳು","sch.haldi.desc":"ವಿವಾಹಕ್ಕೆ ಮುನ್ನ ಅರಿಶಿನ, ಸಂಗೀತ ಮತ್ತು ಆಶೀರ್ವಾದಗಳಿಂದ ಕೂಡಿದ ಪ್ರಕಾಶಮಾನ ಮುಂಜಾವು.","sch.sangeet.dress":"<strong>ಉಡುಗೆ:</strong> ಬಣ್ಣಬಣ್ಣದ ಮತ್ತು ಸಂಭ್ರಮದ — ನೀವು ನರ್ತಿಸಬಹುದಾದ ಉಡುಗೆ","sch.sangeet.desc":"ಎರಡೂ ಕುಟುಂಬಗಳ ಸಂಗೀತ, ನೃತ್ಯ ಮತ್ತು ಪ್ರದರ್ಶನಗಳಿಂದ ತುಂಬಿದ ಒಂದು ಸಂಜೆ.","sch.ceremony.dress":"<strong>ಉಡುಗೆ:</strong> ಸಾಂಪ್ರದಾಯಿಕ ಮತ್ತು ಹಬ್ಬದ ಉಡುಗೆ; ಸಭ್ಯ ಉಡುಪನ್ನು ವಿನಮ್ರವಾಗಿ ಕೋರುತ್ತೇವೆ","sch.ceremony.desc":"ಬಾರಾತ್ ಮತ್ತು ಮಂಟಪದ ವಿಧಿ — ಈ ವಾರಾಂತ್ಯದ ಹೃದಯಭಾಗ.","sch.reception.dress":"<strong>ಉಡುಗೆ:</strong> ಭಾರತೀಯ ಸಾಂಪ್ರದಾಯಿಕ ಅಥವಾ ಬ್ಲ್ಯಾಕ್ ಟೈ — ನೃತ್ಯ ವೇದಿಕೆಗೆ ಸ್ವಲ್ಪ ಹೊಳಪು ತನ್ನಿ","sch.reception.desc":"ಭೋಜನ, ನೃತ್ಯ ಮತ್ತು ವಾರಾಂತ್ಯವನ್ನು ಮುಗಿಸುವ ನಿಜವಾದ ಸಂಭ್ರಮ.","sch.addcal":"＋ ವಾರಾಂತ್ಯವನ್ನು ಕ್ಯಾಲೆಂಡರ್‌ಗೆ ಸೇರಿಸಿ","sch.haldi.when":"ಶುಕ್ರವಾರ, Nov 6 · 11:00 AM – 1:00 PM","sch.haldi.where":"Conrad New York Downtown","sch.sangeet.when":"ಶುಕ್ರವಾರ, Nov 6 · 7:00 PM","sch.sangeet.where":"The Lighthouse at Pier 61","sch.ceremony.when":"ಶನಿವಾರ, Nov 7<br>ಬಾರಾತ್ · 12:30 PM<br>ವಿವಾಹ · 1:30–3:30 PM","sch.ceremony.where":"Conrad New York Downtown","sch.reception.when":"ಶನಿವಾರ, Nov 7<br>ಕಾಕ್‌ಟೇಲ್ · 6:30 PM<br>ಸ್ವಾಗತ ಸಮಾರಂಭ · 7:30–11:30 PM","sch.reception.where":"Hall des Lumières","sch.cal":"＋ ಕ್ಯಾಲೆಂಡರ್","sch.gcal":"📅 Google","sch.map":"📍 ನಕ್ಷೆ","ph.share.t":"📸 ನಿಮ್ಮ ಫೋಟೋಗಳನ್ನು ಹಂಚಿಕೊಳ್ಳಿ","ph.share.p":"ಯಾವುದೇ ಸಮಾರಂಭದ ಒಂದು ಫೋಟೋ ಸೇರಿಸಿ — ಅದು ಕೆಳಗಿನ ಗ್ಯಾಲರಿಯಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ.","ph.share.name":"ನಿಮ್ಮ ಹೆಸರು (ಐಚ್ಛಿಕ)","ph.share.cap":"ಶೀರ್ಷಿಕೆ (ಐಚ್ಛಿಕ)","ph.share.upload":"ಫೋಟೋ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ","ph.share.cam":"📷 ಒಂದು ಫೋಟೋ ತೆಗೆಯಿರಿ","ph.empty":"ಇನ್ನೂ ಯಾವುದೇ ಫೋಟೋ ಇಲ್ಲ — ಮೊದಲಿಗರಾಗಿ ಒಂದನ್ನು ಹಂಚಿಕೊಳ್ಳಿ!","ph.cmt.none":"ಇನ್ನೂ ಯಾವುದೇ ಪ್ರತಿಕ್ರಿಯೆ ಇಲ್ಲ — ಪ್ರೀತಿಯ ಮಾತೊಂದನ್ನು ಹೇಳಿ!","ph.cmt.name":"ನಿಮ್ಮ ಹೆಸರು","ph.cmt.ph":"ಒಂದು ಪ್ರತಿಕ್ರಿಯೆ ಸೇರಿಸಿ…","ph.cmt.posting":"ಪೋಸ್ಟ್ ಮಾಡಲಾಗುತ್ತಿದೆ…","ph.cmt.need":"ಮೊದಲು ಒಂದು ಪ್ರತಿಕ್ರಿಯೆ ಬರೆಯಿರಿ.","ph.cmt.guest":"ಒಬ್ಬ ಅತಿಥಿ","gb.name":"ನಿಮ್ಮ ಹೆಸರು <em>*</em>","gb.msg":"ನಿಮ್ಮ ಸಂದೇಶ <em>*</em>","gb.ph":"ಜೀವನಪೂರ್ತಿ ಪ್ರೀತಿ ಮತ್ತು ನಗುವನ್ನು ಹಾರೈಸುತ್ತೇನೆ…","gb.sign":"ಅತಿಥಿ ಪುಸ್ತಕದಲ್ಲಿ ಬರೆಯಿರಿ","gb.empty":"ಇನ್ನೂ ಯಾವುದೇ ಸಂದೇಶ ಇಲ್ಲ — ಮೊದಲಿಗರಾಗಿ ಬರೆಯಿರಿ! ✍️","mu.song":"ಹಾಡು <em>*</em>","mu.artist":"ಕಲಾವಿದ","mu.name":"ನಿಮ್ಮ ಹೆಸರು","mu.ded":"ಸಮರ್ಪಣೆ (ಐಚ್ಛಿಕ)","mu.song.ph":"ಉದಾ. Kala Chashma","mu.artist.ph":"ಉದಾ. Amar Arshi","mu.ded.ph":"ವಧು-ವರರಿಗಾಗಿ!","mu.add":"ಪ್ಲೇಲಿಸ್ಟ್‌ಗೆ ಸೇರಿಸಿ","mu.empty":"ಇನ್ನೂ ಯಾವುದೇ ವಿನಂತಿ ಇಲ್ಲ — ಸಂಭ್ರಮ ಆರಂಭಿಸಿ! 🎶","rs.name":"ಪೂರ್ಣ ಹೆಸರು <em>*</em>","rs.email":"ಇಮೇಲ್ <em>*</em>","rs.attend":"ನೀವು ಹಾಜರಾಗುತ್ತೀರಾ? <em>*</em>","rs.choose":"ದಯವಿಟ್ಟು ಆಯ್ಕೆಮಾಡಿ…","rs.yes":"ಸಂತೋಷದಿಂದ ಸ್ವೀಕರಿಸುತ್ತೇನೆ","rs.no":"ವಿಷಾದದಿಂದ ನಿರಾಕರಿಸುತ್ತೇನೆ","rs.guests":"ನಿಮ್ಮ ಗುಂಪಿನಲ್ಲಿರುವವರ ಸಂಖ್ಯೆ","rs.events":"ನೀವು ಯಾವ ಸಮಾರಂಭಗಳಲ್ಲಿ ಭಾಗವಹಿಸುತ್ತೀರಿ?","rs.note":"ವಧು-ವರರಿಗೆ ಒಂದು ಸಂದೇಶ","rs.note.ph":"ನಾವು ತಿಳಿದಿರಬೇಕಾದ ಯಾವುದಾದರೂ — ಒಂದು ಸಂದೇಶ, ಆಹಾರದ ಅಗತ್ಯಗಳು…","rs.send":"RSVP ಕಳುಹಿಸಿ","rs.gifts.t":"ಉಡುಗೊರೆಗಳು &amp; ಆಶೀರ್ವಾದಗಳು","rs.gifts.p":"ಉಡುಗೊರೆ ನೀಡಲು ಬಯಸುವವರು Zelle ಮೂಲಕ ಕಳುಹಿಸಬಹುದು.","rg.ty.t":"ಧನ್ಯವಾದಗಳು","rg.ty.p":"ನೀವು ನಮ್ಮೊಂದಿಗೆ ಹೇಗೇ ಸಂಭ್ರಮಿಸಿದರೂ — ಅಲ್ಲಿ ಇರುವ ಮೂಲಕ, ಒಂದು ಪ್ರೀತಿಯ ಬರಹದ ಮೂಲಕ, ಅಥವಾ ಒಂದು ಉಡುಗೊರೆಯ ಮೂಲಕ — ನಾವು ಅಪಾರವಾಗಿ ಕೃತಜ್ಞರಾಗಿದ್ದೇವೆ. 💛","rs.find.toggle":"ಈಗಾಗಲೇ ಪ್ರತಿಕ್ರಿಯಿಸಿದ್ದೀರಾ? ನಿಮ್ಮ RSVP ನವೀಕರಿಸಿ →","rs.find.label":"ನೀವು RSVP ಮಾಡಿದ ಇಮೇಲ್","rs.find.btn":"ನನ್ನ RSVP ಹುಡುಕಿ","rs.find.searching":"ಹುಡುಕುತ್ತಿದೆ…","rs.find.none":"ಆ ಇಮೇಲ್‌ಗೆ ಯಾವುದೇ RSVP ಸಿಗಲಿಲ್ಲ — ಪ್ರತಿಕ್ರಿಯಿಸಲು ಕೆಳಗಿನ ಫಾರ್ಮ್ ಭರ್ತಿ ಮಾಡಿ.","rs.find.loaded":"ಸಿಕ್ಕಿತು! ಕೆಳಗೆ ನಿಮ್ಮ ಬದಲಾವಣೆಗಳನ್ನು ಮಾಡಿ, ನಂತರ ನವೀಕರಿಸಿ.","rs.find.needEmail":"ನಿಮ್ಮ ಇಮೇಲ್ ನಮೂದಿಸಿ.","rs.update":"RSVP ನವೀಕರಿಸಿ","rs.updated":"ನವೀಕರಿಸಲಾಗಿದೆ! ಧನ್ಯವಾದಗಳು, {n} — ನಿಮ್ಮ RSVP ಸಿದ್ಧವಾಗಿದೆ.","rs.okYes":"ಧನ್ಯವಾದಗಳು, {n}! ನಿಮ್ಮೊಂದಿಗೆ ಸಂಭ್ರಮಿಸಲು ನಾವು ಕಾತುರದಿಂದ ಕಾಯುತ್ತಿದ್ದೇವೆ. 🎉","rs.okNo":"ತಿಳಿಸಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು, {n}. ನಿಮ್ಮ ಕೊರತೆ ನಮಗೆ ಕಾಡುತ್ತದೆ! 💛","rs.fix":"ದಯವಿಟ್ಟು ಗುರುತಿಸಿದ ಕ್ಷೇತ್ರಗಳನ್ನು ಭರ್ತಿ ಮಾಡಿ.","ios.hint":"iPhone ನಲ್ಲಿ: Safari ಯಲ್ಲಿ <strong>Share ⎋</strong> ಟ್ಯಾಪ್ ಮಾಡಿ, ನಂತರ <strong>Add to Home Screen</strong>.","concierge.greeting":"ನಮಸ್ಕಾರ! ನಾನು ವಿವಾಹ ಕನ್‌ಸಿಯರ್ಜ್ 💐 ಸಮಾರಂಭಗಳು, ಉಡುಗೆ ನಿಯಮಗಳು, ಪ್ರಯಾಣ, ಅಥವಾ Priya & Sanjay ಅವರ ವಾರಾಂತ್ಯದ ಬಗ್ಗೆ ಇನ್ನೇನನ್ನಾದರೂ ನನ್ನನ್ನು ಕೇಳಿ.","rs.song":"ನಿಮ್ಮನ್ನು ನೃತ್ಯ ವೇದಿಕೆಗೆ ಕರೆತರುವ ಒಂದು ಹಾಡು","rs.song.ph":"ಐಚ್ಛಿಕ — ನಾವು ಪ್ಲೇ ಮಾಡಬೇಕಾದ ಒಂದು ಹಾಡು","ev.satbrunch":"ಬ್ರಂಚ್","sch.satbrunch.when":"ಶನಿವಾರ, Nov 7 · 10:00 AM","sch.satbrunch.where":"ಕಾನ್ರಾಡ್ ನ್ಯೂಯಾರ್ಕ್ ಡೌನ್‌ಟೌನ್","inv.overline":"ಆಮಂತ್ರಣ","inv.title":"New York ನಲ್ಲಿ ನವೆಂಬರ್‌ನ ಒಂದು ವಿವಾಹ","inv.p":"ನಮ್ಮ ಕುಟುಂಬಗಳೊಂದಿಗೆ, ನಮ್ಮ ಮದುವೆಯ ವಾರಾಂತ್ಯದ ಸಂಭ್ರಮಕ್ಕೆ ನಿಮ್ಮನ್ನು ಆದರದಿಂದ ಆಹ್ವಾನಿಸುತ್ತೇವೆ. ನೀವು ನಮ್ಮೊಂದಿಗಿರುವುದೇ ನಮಗೆ ಅತ್ಯಂತ ಸಂತೋಷ.","vn.kicker":"ಧನ್ಯವಾದಗಳೊಂದಿಗೆ","vn.title":"ಈ ವಾರಾಂತ್ಯದ ಹಿಂದಿನ ತಂಡ","vn.lede":"ನಮ್ಮ ಸಂಭ್ರಮವನ್ನು ಜೀವಂತಗೊಳಿಸುತ್ತಿರುವ ಅದ್ಭುತ ಜನರು.","pt.memory.note":"ಅವರು ನಮ್ಮೊಂದಿಗೆ ಈ ಸಂಭ್ರಮದಲ್ಲಿ ಇರಲು ಸಾಧ್ಯವಿಲ್ಲದಿದ್ದರೂ, ಅವರ ಪ್ರೀತಿ ಮತ್ತು ನೆನಪುಗಳು ಈ ಪಯಣದ ಭಾಗವಾಗಿಯೇ ಇರುತ್ತವೆ.","pt.uog":"ವರನ ಚಿಕ್ಕಪ್ಪ","pt.role.friendg":"ವರನ ಸ್ನೇಹಿತ","pt.role.childfriendg":"ವರನ ಬಾಲ್ಯ ಸ್ನೇಹಿತ","pt.role.cousing":"ವರನ ಸೋದರಸಂಬಂಧಿ","pt.role.cousinb":"ವಧುವಿನ ಸೋದರಸಂಬಂಧಿ","pt.role.bilg":"ವರನ ಭಾವ","faq.q7":"ಎಲ್ಲಿ ತಂಗಬೇಕು?","faq.a7":"ನಾವು ಕಾನ್ರಾಡ್ ನ್ಯೂಯಾರ್ಕ್ ಡೌನ್‌ಟೌನ್‌ನಲ್ಲಿ ಕೊಠಡಿಗಳ ಬ್ಲಾಕ್ ಕಾಯ್ದಿರಿಸಿದ್ದೇವೆ — ವಾರಾಂತ್ಯದ ನಮ್ಮ ನೆಲೆ. <a href='travel.html'>ಪ್ರಯಾಣ ಮತ್ತು ವಸತಿ</a> ಪುಟದಿಂದ ಗುಂಪು ಕೋಡ್ <strong>KMWED26</strong> ಬಳಸಿ ಬುಕ್ ಮಾಡಿ, ಗುಂಪು ದರ ಪಡೆಯಲು <strong>ಅಕ್ಟೋಬರ್ 6, 2026</strong> ರೊಳಗೆ ಕಾಯ್ದಿರಿಸಿ.","faq.q8":"ಸಸ್ಯಾಹಾರಿ ಆಹಾರ ಇರುತ್ತದೆಯೇ?","faq.a8":"ನಮ್ಮ ಮದುವೆಯ ಊಟವನ್ನು ಬುಫೆ ಶೈಲಿಯಲ್ಲಿ ಬಡಿಸಲಾಗುತ್ತದೆ, ಹಲವು ಸಸ್ಯಾಹಾರಿ ಆಯ್ಕೆಗಳು ಲಭ್ಯವಿರುತ್ತವೆ. ನಟ್ಸ್ ಅಲರ್ಜಿ ಇರುವ ಅತಿಥಿಗಳು ಬುಫೆಗೆ ಸಮೀಪಿಸುವ ಮೊದಲು ಬ್ಯಾಂಕ್ವೆಟ್ ಸರ್ವರ್‌ಗೆ ತಿಳಿಸಬೇಕು, ಆಗ ತಂಡವು ಲಭ್ಯ ಭಕ್ಷ್ಯಗಳ ಬಗ್ಗೆ ಮಾರ್ಗದರ್ಶನ ನೀಡುತ್ತದೆ.","faq.q9":"ಸಮಾರಂಭದ ಸಮಯದಲ್ಲಿ ನಾನು ಫೋಟೋ ತೆಗೆಯಬಹುದೇ?","faq.a9":"ಹೌದು, ನಮಗೆ ತುಂಬಾ ಸಂತೋಷ! ಕೆಲವು ಪವಿತ್ರ ಕ್ಷಣಗಳಲ್ಲಿ ಎಲ್ಲರೂ ಆ ಕ್ಷಣದಲ್ಲಿ ಇರಲೆಂದು ಫೋನ್‌ಗಳನ್ನು ಕೆಳಗಿಡಲು ನಾವು ಮೃದುವಾಗಿ ಕೇಳಬಹುದು — ನಮ್ಮ ಫೋಟೋಗ್ರಾಫರ್‌ಗಳು ಪ್ರತಿ ಕ್ಷಣವನ್ನೂ ಸೆರೆಹಿಡಿದು ನಂತರ ನಿಮ್ಮೊಂದಿಗೆ ಹಂಚಿಕೊಳ್ಳುತ್ತಾರೆ.","tv.stay.book":"ನಿಮ್ಮ ಕೊಠಡಿಯನ್ನು ಕಾಯ್ದಿರಿಸಿ →","rg.zelle.p":"ಉಡುಗೊರೆ ನೀಡಲು ಬಯಸುವವರು Zelle ಮೂಲಕ ಕಳುಹಿಸಬಹುದು.","rg.zelle.btn":"Zelle ಗಾಗಿ ಇಲ್ಲಿ ಕ್ಲಿಕ್ ಮಾಡಿ","rg.zelle.hint":"ಅಥವಾ ವಧು-ವರರೊಂದಿಗೆ ಮಾತನಾಡಿ, ಅವರು ಸಂತೋಷದಿಂದ ಸಹಾಯ ಮಾಡುತ್ತಾರೆ.","rg.zelle.modal.t":"ಉಡುಗೊರೆ ಕಳುಹಿಸಿ","rg.zelle.scan":"ನಿಮ್ಮ ಬ್ಯಾಂಕಿಂಗ್ ಆ್ಯಪ್‌ನಿಂದ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.","rs.gifts.btn":"ಉಡುಗೊರೆ ಮತ್ತು ಆಶೀರ್ವಾದ","rs.phone":"ದೂರವಾಣಿ (ಐಚ್ಛಿಕ)","rs.phone.consent":"ನಿಮ್ಮ ಸಂಖ್ಯೆಯನ್ನು ಹಂಚಿಕೊಳ್ಳುವ ಮೂಲಕ ನಮ್ಮಿಂದ ಮದುವೆ-ಸಂಬಂಧಿತ ಸಂದೇಶಗಳನ್ನು ಸ್ವೀಕರಿಸಲು ನೀವು ಒಪ್ಪುತ್ತೀರಿ. ನಿಲ್ಲಿಸಲು ಯಾವಾಗ ಬೇಕಾದರೂ STOP ಎಂದು ಉತ್ತರಿಸಿ.","rs.phone.err":"ದಯವಿಟ್ಟು ನಾವು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸಬಹುದಾದ ಫೋನ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.","rs.attendees":"ಯಾರು ಬರುತ್ತಿದ್ದಾರೆ? ದಯವಿಟ್ಟು ಎಲ್ಲರ ಹೆಸರುಗಳನ್ನು ಬರೆಯಿರಿ","rs.attendees.help":"ನಿಮ್ಮ ಮನೆಯಿಂದ ಕೆಲವರು ಮಾತ್ರ ಬರಲು ಸಾಧ್ಯವಾದರೆ, ಬರುವವರ ಹೆಸರುಗಳನ್ನು ಮಾತ್ರ ಬರೆಯಿರಿ. ಇದೇ ಆಧಾರದ ಮೇಲೆ ನಾವು ಆಸನ ವ್ಯವಸ್ಥೆ ಮಾಡುತ್ತೇವೆ — ಹೆಸರುಗಳಿಲ್ಲದಿದ್ದರೆ ನಮ್ಮ ಬಳಿ ಕೇವಲ ಸಂಖ್ಯೆ ಇರುತ್ತದೆ.","rs.attendees.ph":"ಉದಾ: Andrew Fried, Sarah Fried, Emma Fried","rs.children":"ಇವರಲ್ಲಿ 12 ವರ್ಷದೊಳಗಿನ ಮಕ್ಕಳು ಎಷ್ಟು?","rs.children.note":"(ನಿಮ್ಮ ಪಾರ್ಟಿ ಸಂಖ್ಯೆಯಲ್ಲಿ ಸೇರಿವೆ)","rs.children.help":"ಪುಟ್ಟ ಅತಿಥಿಗಳಿಗೆ ಹೃತ್ಪೂರ್ವಕ ಸ್ವಾಗತ — ಎಷ್ಟು ಮಂದಿ ಬರುತ್ತಿದ್ದಾರೆ ಎಂದು ತಿಳಿದರೆ ಅವರ ಆಸನ ಮತ್ತು ಊಟದ ವ್ಯವಸ್ಥೆ ಮಾಡಲು ನಮಗೆ ಸಹಾಯವಾಗುತ್ತದೆ.","rs.children.err":"ದಯವಿಟ್ಟು ಪುಟ್ಟ ಮಕ್ಕಳನ್ನು ನಿಮ್ಮ ಪಾರ್ಟಿ ಸಂಖ್ಯೆಯಲ್ಲಿ ಸೇರಿಸಿ — 12 ವರ್ಷದೊಳಗಿನ ಮಕ್ಕಳ ಸಂಖ್ಯೆ ನಿಮ್ಮ ಪಾರ್ಟಿ ಗಾತ್ರಕ್ಕಿಂತ ಹೆಚ್ಚಿರಲು ಸಾಧ್ಯವಿಲ್ಲ.","rs.address":"ಅಂಚೆ ವಿಳಾಸ","rs.address.opt":"(ಐಚ್ಛಿಕ)","rs.address.help.yes":"ಇದರಿಂದ ನಾವು ನಿಮಗೆ ಧನ್ಯವಾದ ಪತ್ರ ಹಾಗೂ ಅಂಚೆಯ ಮೂಲಕ ಕಳುಹಿಸಬೇಕಾದ ಇತರ ವಸ್ತುಗಳನ್ನು ಕಳುಹಿಸಬಹುದು.","rs.address.help.no":"ನಮ್ಮಿಂದ ಕಾರ್ಡ್ ಬಯಸಿದರೆ ಮಾತ್ರ — ಇಲ್ಲವಾದರೆ ಖಾಲಿ ಬಿಡಿರಿ.","rs.address.ph":"ರಸ್ತೆ, ನಗರ, ರಾಜ್ಯ / ದೇಶ, ಪಿನ್ ಕೋಡ್","rs.missing.link":"ನಿಮ್ಮ ಆಮಂತ್ರಣದಲ್ಲಿ ಯಾರಾದರೂ ಬಿಟ್ಟುಹೋಗಿದ್ದಾರೆಯೇ?","rs.missing.label":"ಯಾರನ್ನು ಸೇರಿಸಬೇಕು?","rs.missing.ph":"ಉದಾ: ನನ್ನ ನಿಶ್ಚಿತ ವಧು ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ","rs.missing.help":"ಹೇಗಿದ್ದರೂ ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಕಳುಹಿಸಿ — ನಾವು ಸಂಖ್ಯೆಯನ್ನು ಸರಿಪಡಿಸಿ ನಿಮ್ಮೊಂದಿಗೆ ಖಚಿತಪಡಿಸುತ್ತೇವೆ.","rs.dining.t":"ಊಟ","rs.dining.p":"ನಮ್ಮ ಮದುವೆಯ ಊಟವನ್ನು ಬುಫೆ ಶೈಲಿಯಲ್ಲಿ ಬಡಿಸಲಾಗುತ್ತದೆ, ಹಲವು ಸಸ್ಯಾಹಾರಿ ಆಯ್ಕೆಗಳು ಲಭ್ಯವಿರುತ್ತವೆ. ನಟ್ಸ್ ಅಲರ್ಜಿ ಇರುವ ಅತಿಥಿಗಳು ಬುಫೆಗೆ ಸಮೀಪಿಸುವ ಮೊದಲು ಬ್ಯಾಂಕ್ವೆಟ್ ಸರ್ವರ್‌ಗೆ ತಿಳಿಸಬೇಕು, ಆಗ ತಂಡವು ಲಭ್ಯ ಭಕ್ಷ್ಯಗಳ ಬಗ್ಗೆ ಮಾರ್ಗದರ್ಶನ ನೀಡುತ್ತದೆ.","rs.confirm.t":"ಇದು ನೀವೇನಾ?","rs.confirm.found":"ನಮಗೆ ಇವರಿಗಾಗಿ ಆಮಂತ್ರಣ ಸಿಕ್ಕಿತು","rs.confirm.yes":"ಹೌದು, ಮುಂದುವರಿಯಿರಿ","rs.confirm.no":"ನೀವಲ್ಲವೇ? ಮತ್ತೆ ಹುಡುಕಿ","rs.confirm.which":"ಇವುಗಳಲ್ಲಿ ನಿಮ್ಮ ಆಮಂತ್ರಣ ಯಾವುದು?","rs.gate.label":"ನಿಮ್ಮ ಆಮಂತ್ರಣ ಹುಡುಕಿ — ಆಮಂತ್ರಣದಲ್ಲಿರುವ ಹೆಸರು","rs.gate.btn":"ನನ್ನ ಆಮಂತ್ರಣ ಹುಡುಕಿ","rs.gate.needname":"ಮುಂದುವರಿಯಲು ದಯವಿಟ್ಟು ನಿಮ್ಮ ಹೆಸರನ್ನು ನಮೂದಿಸಿ.","rs.searching":"ಹುಡುಕುತ್ತಿದೆ…","rs.sending":"ಕಳುಹಿಸುತ್ತಿದೆ…","rs.err.lookup":"ಅತಿಥಿ ಪಟ್ಟಿಯನ್ನು ತಲುಪಲು ನಮಗೆ ತೊಂದರೆಯಾಗುತ್ತಿದೆ — ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸಂಪರ್ಕ ಪರಿಶೀಲಿಸಿ ಕ್ಷಣದಲ್ಲಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.","rs.err.notfound":"ಆ ಹೆಸರಿನಲ್ಲಿ ನಮಗೆ ಆಮಂತ್ರಣ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕಾಗುಣಿತ ಪರಿಶೀಲಿಸಿ — ನಿಮ್ಮ ಆಮಂತ್ರಣದಲ್ಲಿರುವಂತೆಯೇ ಹೆಸರನ್ನು ಬಳಸಿ, ಅಥವಾ ನಮಗೆ ಇಮೇಲ್ ಮಾಡಿ, ನಾವು ನಿಮ್ಮನ್ನು ಹುಡುಕುತ್ತೇವೆ.","rs.err.server":"ಸರ್ವರ್ ತಲುಪಲಾಗಲಿಲ್ಲ — ದಯವಿಟ್ಟು ಕ್ಷಣದಲ್ಲಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.","rs.err.save":"ಇದೀಗ ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಉಳಿಸಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.","rs.selfadd.ready":"ನೀವು ಸಿದ್ಧ — RSVP ಮಾಡಲು ನಿಮ್ಮ ಹೆಸರನ್ನು ನಮೂದಿಸಿ.","rs.selfadd.ph":"ನಿಮ್ಮ ಪೂರ್ಣ ಹೆಸರು","rs.selfadd.btn":"ಮುಂದುವರಿಸಿ →","gal.moments.kicker":"ಒಟ್ಟಿಗೆ ಕಳೆದ ಕ್ಷಣಗಳು","gal.moments.t":"ನಮ್ಮ ಕೆಲವು ನೆಚ್ಚಿನವು","gal.moments.lede":"ಪೂರ್ಣ ಪರದೆಯಲ್ಲಿ ನೋಡಲು ಯಾವುದೇ ಫೋಟೋ ಟ್ಯಾಪ್ ಮಾಡಿ.","gb.success":"ಧನ್ಯವಾದಗಳು! ಅನುಮೋದನೆಯ ನಂತರ ನಿಮ್ಮ ಸಂದೇಶ ಕಾಣಿಸುತ್ತದೆ.","gb.loadfail":"ಅತಿಥಿ ಪುಸ್ತಕದ ಸಂದೇಶಗಳು ಇದೀಗ ಲೋಡ್ ಆಗಲಿಲ್ಲ. ನೀವು ಇನ್ನೂ ಸಂದೇಶ ಬಿಡಬಹುದು.","mu.viaRsvp":"ಹಾಡಿನ ವಿನಂತಿಗಳನ್ನು ನಿಮ್ಮ RSVP ಜೊತೆ ಸಂಗ್ರಹಿಸಲಾಗುತ್ತದೆ — ಉತ್ತರಿಸುವಾಗ ನಿಮ್ಮ ಹಾಡನ್ನು ಸೇರಿಸಿ, DJ ಅದನ್ನು ನೋಡುತ್ತಾರೆ.","mu.goRsvp":"RSVP ಗೆ ಹೋಗಿ","more.privacy":"ಗೌಪ್ಯತಾ ನೀತಿ","more.terms":"SMS ನಿಯಮಗಳು","ann.dismiss":"ಪ್ರಕಟಣೆ ಮುಚ್ಚಿರಿ","action.song":"ನಮ್ಮ ಹಾಡನ್ನು ಪ್ಲೇ ಮಾಡಿ","action.songPause":"ಹಾಡು ನಿಲ್ಲಿಸಿ","faq.a6":"ದಯವಿಟ್ಟು <strong>ಆಗಸ್ಟ್ 31, 2026</strong> ರೊಳಗೆ RSVP ಪುಟದ ಮೂಲಕ ಉತ್ತರಿಸಿ. ಯಾವುದೇ ವಿಷಯಕ್ಕೂ ನಮ್ಮ ಯೋಜಕರಿಗೆ <a href='mailto:sonal@sjsevents.com?cc=ginny@sjsevents.com'>sonal@sjsevents.com</a> (cc <a href='mailto:ginny@sjsevents.com'>ginny@sjsevents.com</a>) ಗೆ ಇಮೇಲ್ ಮಾಡಿ — ಅವರು ಪ್ರತಿಯೊಂದು ವಿವರವನ್ನೂ ನಿಭಾಯಿಸುತ್ತಿದ್ದಾರೆ ಮತ್ತು ನಿಮ್ಮ ಅತ್ಯುತ್ತಮ ಕಾಳಜಿ ವಹಿಸುತ್ತಾರೆ."};
  const LANGS = ["en", "hi", "kn"];
  let lang = localStorage.getItem("lang") || "en";
  if (LANGS.indexOf(lang) === -1) lang = "en";
  function t(key) {
    const e = DICT[key];
    if (!e) return key;
    // Kannada lives in a separate overlay (KN); Hindi/English live on the entry.
    if (lang === "kn") return (typeof KN !== "undefined" && KN[key]) || e.en || key;
    return e[lang] || e.en || key;
  }
  // textContent doesn't decode entities, but our dict values were extracted from
  // HTML and may contain &amp; etc. Decode for the text/placeholder branches.
  function decodeEntities(s) {
    return String(s)
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
  }
  function applyI18n() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { const k = el.getAttribute("data-i18n"); if (k) el.textContent = decodeEntities(t(k)); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { const k = el.getAttribute("data-i18n-html"); if (k) el.innerHTML = t(k); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { const k = el.getAttribute("data-i18n-ph"); if (k) el.setAttribute("placeholder", decodeEntities(t(k))); });
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
    { href: "pass.html", label: "Event Pass", icon: "🎟️", key: "more.pass" },
    { href: "registry.html", label: "Gifts & Blessings", icon: "🎁", key: "more.registry" },
    { href: "faq.html", label: "FAQ", icon: "❓", key: "more.faq" },
    // Policy pages live on the website (shared host) — required alongside SMS consent.
    { href: "https://sanjaywedspriya.com/privacy.html", label: "Privacy Policy", icon: "🔒", key: "more.privacy" },
    { href: "https://sanjaywedspriya.com/terms.html", label: "SMS Terms", icon: "📱", key: "more.terms" },
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
    "pass.html": "Event Pass",
    "registry.html": "Registry",
    "faq.html": "FAQ",
    "admin.html": "RSVP Dashboard",
  };

  const current = location.pathname.split("/").pop() || "index.html";
  const isTab = TABS.some((t) => t.href === current);
  document.body.classList.add("app");

  // Skip link → keyboard/screen-reader users can jump past the chrome.
  const mainEl = document.querySelector("main");
  if (mainEl && !mainEl.id) mainEl.id = "main";
  const skip = document.createElement("a");
  skip.className = "skip-link";
  skip.href = "#" + (mainEl ? mainEl.id : "main");
  skip.setAttribute("data-i18n", "a11y.skip");
  skip.textContent = "Skip to content";
  document.body.insertBefore(skip, document.body.firstChild);

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

  // 3-way language cycle: English → हिंदी → ಕನ್ನಡ → English.
  const NEXT_LANG = { en: "hi", hi: "kn", kn: "en" };
  const LANG_GLYPH = { en: "EN", hi: "हिं", kn: "ಕ" };        // glyph for the language you'll switch TO
  const LANG_SWITCH_LABEL = { en: "Switch to English", hi: "हिंदी में बदलें", kn: "ಕನ್ನಡಕ್ಕೆ ಬದಲಿಸಿ" };
  const langBtn = document.getElementById("appbarLang");
  const updateLangBtn = () => {
    // Show the language you'll switch *to*, and announce it accessibly.
    const next = NEXT_LANG[lang];
    langBtn.textContent = LANG_GLYPH[next];
    langBtn.setAttribute("lang", next === "en" ? "en" : next);
    const label = LANG_SWITCH_LABEL[next];
    langBtn.setAttribute("aria-label", label);
    langBtn.setAttribute("title", label);
  };
  updateLangBtn();
  langBtn.addEventListener("click", () => {
    lang = NEXT_LANG[lang];
    localStorage.setItem("lang", lang);
    applyI18n();
    updateLangBtn();
    if (typeof setReminderLabel === "function") setReminderLabel();
    if (typeof window.renderNowBar === "function") window.renderNowBar();
  });

  /* ---------- Bottom tab bar ---------- */
  const tabbar = el(`
    <nav class="tabbar" aria-label="Primary">
      ${TABS.map(
        (tb) =>
          `<a class="tab ${tb.href === current ? "is-active" : ""}" href="${tb.href}"${tb.href === current ? ' aria-current="page"' : ""}>
             <span class="tab__icon" aria-hidden="true">${tb.icon}</span><span class="tab__label" data-i18n="${tb.key}">${tb.label}</span>
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
            (m) => `<a class="sheet__link" href="${m.href}"${/^https?:/.test(m.href) ? ' target="_blank" rel="noopener"' : ""}><span>${m.icon}</span><span data-i18n="${m.key}">${m.label}</span></a>`
          ).join("")}
          <button class="sheet__link" id="songBtn" type="button" aria-pressed="false"><span>🎶</span><span id="songLabel" data-i18n="action.song">Play our song</span></button>
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
  head("link", { rel: "manifest", href: "manifest.webmanifest" });
  head("meta", { name: "theme-color", content: "#7A1F23" });
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
    // Share the app's own base URL (works at root or under /app/), not the origin root.
    const shareData = { title: "Priya & Sanjay 2026", text: "Join us for Priya & Sanjay's wedding!", url: new URL("index.html", location.href).href };
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

  /* ---------- "Play our song" (same track as the website) ----------
     The site plays song.mp3 ("Surrender" — Niraj Chag & Melissa Baten) behind
     an explicit toggle; same here. User-initiated only, loops, never precached. */
  const songBtn = document.getElementById("songBtn");
  let bgMusic = null;
  songBtn.addEventListener("click", () => {
    if (!bgMusic) {
      bgMusic = document.createElement("audio");
      bgMusic.loop = true;
      bgMusic.preload = "none";
      bgMusic.src = "assets/song.mp3";
      document.body.appendChild(bgMusic);
    }
    const label = document.getElementById("songLabel");
    if (bgMusic.paused) {
      bgMusic.play().catch(() => {});
      songBtn.setAttribute("aria-pressed", "true");
      label.textContent = window.t ? window.t("action.songPause") : "Pause our song";
    } else {
      bgMusic.pause();
      songBtn.setAttribute("aria-pressed", "false");
      label.textContent = window.t ? window.t("action.song") : "Play our song";
    }
  });

  /* ---------- Announcement banner (shared with the website) ----------
     Mirrors the site's #annBar: hosts post a notice from the dashboard
     (set_announcement) and every guest sees it until they dismiss that
     exact message (localStorage "annDismiss" — a NEW message shows again).
     Only active in Supabase mode; js/supa.js is injected if the page
     doesn't already load it. */
  function initAnnouncement() {
    if (!(window.Supa && window.Supa.enabled)) return;
    window.Supa.client().then((sb) => {
      if (!sb) return;
      return sb.rpc("get_announcement").then((r) => {
        if (!r || r.error) return;
        const d = r.data;
        const msg = d && (d.message || (Array.isArray(d) && d[0] && d[0].message));
        if (!msg) return;
        let dismissed = null;
        try { dismissed = localStorage.getItem("annDismiss"); } catch (_) {}
        if (dismissed === msg) return;
        const bar = document.createElement("div");
        bar.className = "annbar";
        bar.setAttribute("role", "status");
        bar.setAttribute("aria-live", "polite");
        bar.style.cssText = "display:flex;align-items:center;gap:0.75rem;background:#7A1F23;color:#FBF7EF;padding:0.6rem 1rem;font-size:0.95rem;";
        const span = document.createElement("span");
        span.style.flex = "1";
        span.textContent = msg;
        const x = document.createElement("button");
        x.type = "button";
        x.textContent = "×";
        x.setAttribute("aria-label", (window.t ? window.t("ann.dismiss") : "Dismiss announcement"));
        x.style.cssText = "background:none;border:none;color:inherit;font-size:1.3rem;line-height:1;cursor:pointer;padding:0 0.25rem;";
        x.addEventListener("click", () => {
          try { localStorage.setItem("annDismiss", msg); } catch (_) {}
          bar.remove();
        });
        bar.appendChild(span);
        bar.appendChild(x);
        const mainN = document.querySelector("main");
        if (mainN) mainN.insertBefore(bar, mainN.firstChild);
        else document.body.insertBefore(bar, document.body.firstChild);
      });
    }).catch(() => {});
  }
  if (window.Supa) {
    initAnnouncement();
  } else if (!document.querySelector('script[src$="js/supa.js"]')) {
    const supaScript = document.createElement("script");
    supaScript.src = "js/supa.js";
    supaScript.onload = initAnnouncement;
    document.head.appendChild(supaScript);
  }

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
  // Stagger reveals that share a parent (e.g. card grids) so they cascade in.
  document.querySelectorAll(".reveal").forEach((n) => {
    const sibs = n.parentElement
      ? Array.prototype.filter.call(n.parentElement.children, (c) => c.classList.contains("reveal"))
      : [n];
    const idx = sibs.indexOf(n);
    if (idx > 0) n.style.transitionDelay = Math.min(idx, 6) * 80 + "ms";
    io.observe(n);
  });

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

  /* ---------- First-visit welcome ---------- */
  injectWelcome();

  /* ---------- Apply translations once chrome + page DOM are present ---------- */
  applyI18n();

  function injectWelcome() {
    if (localStorage.getItem("welcomed")) return;
    const w = el(`
      <div class="sheet welcome" id="welcomeSheet" hidden>
        <div class="sheet__backdrop" id="welcomeBackdrop"></div>
        <div class="sheet__panel" role="dialog" aria-label="Welcome" aria-modal="true">
          <div class="sheet__grip"></div>
          <h2 class="welcome__title" data-i18n="welcome.title">Welcome 🪔</h2>
          <p class="welcome__sub" data-i18n="welcome.sub">Everything for Priya & Sanjay's weekend, in your pocket.</p>
          <ul class="welcome__list">
            <li data-i18n="welcome.f1">💌 RSVP — and update it anytime</li>
            <li data-i18n="welcome.f2">📸 Share photos & leave comments</li>
            <li data-i18n="welcome.f3">💬 Ask the concierge anything</li>
            <li data-i18n="welcome.f4">🔔 Turn on day-of reminders</li>
            <li data-i18n="welcome.f5">🌐 Switch to हिंदी anytime</li>
          </ul>
          <button class="btn btn--solid welcome__cta" id="welcomeCta" data-i18n="welcome.cta">Start exploring</button>
        </div>
      </div>`);
    document.body.appendChild(w);
    const openW = (open) => {
      w.hidden = false;
      requestAnimationFrame(() => w.classList.toggle("open", open));
      if (!open) setTimeout(() => (w.hidden = true), 250);
    };
    const dismiss = () => { localStorage.setItem("welcomed", "1"); openW(false); };
    w.querySelector("#welcomeCta").addEventListener("click", dismiss);
    w.querySelector("#welcomeBackdrop").addEventListener("click", dismiss);
    // If the launch splash is playing, wait until it dissolves; else show shortly after load.
    if (window.__splashActive) document.addEventListener("splash:done", () => setTimeout(() => openW(true), 350), { once: true });
    else setTimeout(() => openW(true), 650);
  }

  function injectConcierge() {
    const fab = el(`<button class="concierge__fab" id="conciergeFab" aria-label="Ask the wedding concierge" hidden>💬</button>`);
    const panel = el(`
      <div class="concierge" id="conciergePanel" aria-hidden="true">
        <div class="concierge__head">
          <div><strong data-i18n="concierge.title">Wedding Concierge</strong><span data-i18n="concierge.sub">Ask me anything about the weekend</span></div>
          <button class="concierge__close" id="conciergeClose" aria-label="Close">&times;</button>
        </div>
        <div class="concierge__log" id="conciergeLog"></div>
        <div class="concierge__chips" id="conciergeChips">
          <button type="button" class="concierge__chip" data-q="concierge.chip.dress" data-i18n="concierge.chip.dress">What should I wear?</button>
          <button type="button" class="concierge__chip" data-q="concierge.chip.travel" data-i18n="concierge.chip.travel">How do I get there?</button>
          <button type="button" class="concierge__chip" data-q="concierge.chip.schedule" data-i18n="concierge.chip.schedule">What's the schedule?</button>
          <button type="button" class="concierge__chip" data-q="concierge.chip.kids" data-i18n="concierge.chip.kids">Can I bring my kids?</button>
        </div>
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
    const chips = panel.querySelector("#conciergeChips");
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

    function send(msg) {
      msg = (msg || "").trim();
      if (!msg) return;
      if (chips) chips.hidden = true; // hide suggestions once the chat starts
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
    }

    form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
    if (chips)
      chips.querySelectorAll(".concierge__chip").forEach((c) =>
        c.addEventListener("click", () => send(window.t ? window.t(c.getAttribute("data-q")) : c.textContent))
      );
  }
})();
