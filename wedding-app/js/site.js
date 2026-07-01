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
    "title.party": { en: "Wedding Party", hi: "परिवार और मित्र" },
    "title.music": { en: "Song Requests", hi: "गानों की फ़रमाइश" },
    "title.seating": { en: "Find Your Seat", hi: "अपनी सीट खोजें" },
    "title.pass": { en: "Event Pass", hi: "इवेंट पास" },
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
    "more.pass": { en: "Event Pass", hi: "इवेंट पास" },
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
    "welcome.f5": { en: "🌐 Switch to हिंदी anytime", hi: "🌐 कभी भी English में बदलें" },
    "welcome.cta": { en: "Start exploring", hi: "शुरू करें" },
    "offline": { en: "You're offline — showing a saved copy.", hi: "आप ऑफ़लाइन हैं — सहेजी गई प्रति दिखाई जा रही है।" },
    "toast.backOnline": { en: "Back online ✓", hi: "फिर से ऑनलाइन ✓" },
    "toast.remindersOn": { en: "You'll get day-of reminders 🔔", hi: "आपको कार्यक्रम के दिन रिमाइंडर मिलेंगे 🔔" },
    "toast.remindersOff": { en: "Reminders turned off", hi: "रिमाइंडर बंद कर दिए गए" },
    "toast.notifBlocked": { en: "Notifications are blocked in your browser settings.", hi: "आपके ब्राउज़र में सूचनाएँ अवरुद्ध हैं।" },
    // Home
    "home.eyebrow": { en: "Together with their families", hi: "अपने परिवारों सहित" },
    "home.tag": { en: "are getting married", hi: "विवाह बंधन में बँध रहे हैं" },
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
    "explore.lede": { en: "Three days of celebration in the City of Lakes. Here's where to find what you need.", hi: "झीलों के शहर में तीन दिन का उत्सव। यहाँ आपको हर ज़रूरी जानकारी मिलेगी।" },
    "exp.story.d": { en: "How Priya & Sanjay got here.", hi: "प्रिया और संजय की कहानी।" },
    "exp.schedule.d": { en: "Haldi, Sangeet, Ceremony & Reception.", hi: "हल्दी, संगीत, विवाह और रिसेप्शन।" },
    "exp.travel.d": { en: "Airport, hotel block & shuttles.", hi: "हवाई अड्डा, होटल और शटल।" },
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
    "sub.registry.kicker": { en: "Gifts & blessings", hi: "उपहार और आशीर्वाद" },
    "sub.registry.intro": { en: "Your presence is the only present we need. If you wish to give, here are a few ways.", hi: "आपकी उपस्थिति ही हमारे लिए सबसे बड़ा उपहार है। यदि आप देना चाहें, तो ये कुछ तरीके हैं।" },
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
    "ev.reception": { en: "Reception", hi: "रिसेप्शन" },
    "ev.brunch": { en: "Farewell Brunch", hi: "विदाई ब्रंच" },
    "sch.brunch.when": { en: "Sun, Nov 8 · Late morning", hi: "रवि, 8 नवंबर · दोपहर से पहले" },
    "sch.brunch.where": { en: "Optional · details to follow", hi: "वैकल्पिक · विवरण शीघ्र" },
    "sch.brunch.desc": { en: "One last coffee together before everyone heads home.", hi: "सबके घर लौटने से पहले एक आख़िरी कॉफ़ी साथ में।" },
    "st.2019.t": { en: "Where it began — Long Island", hi: "शुरुआत — लॉन्ग आइलैंड" },
    "st.2019.p": { en: "We both grew up on Long Island, though our paths didn't cross until later. It started, as the best things do, fifteen years ago.", hi: "हम दोनों लॉन्ग आइलैंड में बड़े हुए, हालाँकि हमारी राहें बाद में मिलीं। सबसे अच्छी चीज़ों की तरह, इसकी शुरुआत पंद्रह साल पहले हुई।" },
    "st.2021.t": { en: "College — late-night study sessions", hi: "कॉलेज — देर रात की पढ़ाई" },
    "st.2021.p": { en: "We met in college. Little did we know that late-night study sessions for neuroscience would turn into a lifetime together.", hi: "हम कॉलेज में मिले। हमें कहाँ पता था कि न्यूरोसाइंस की देर रात की पढ़ाई जीवनभर के साथ में बदल जाएगी।" },
    "st.2025.t": { en: "The proposal — Mohonk Mountain House", hi: "प्रस्ताव — मोहॉन्क माउंटेन हाउस" },
    "st.2025.p": { en: "A decade later, Sanjay proposed on a snow-draped porch at Mohonk Mountain House in the Hudson Valley.", hi: "एक दशक बाद, संजय ने हडसन वैली के मोहॉन्क माउंटेन हाउस में बर्फ़ से ढके एक बरामदे पर प्रस्ताव रखा।" },
    "st.2026.t": { en: "2026 — New York City", hi: "2026 — न्यूयॉर्क शहर" },
    "st.2026.p": { en: "This November, we're bringing everyone we love to New York City to celebrate our next chapter the way it began — surrounded by warmth, good company, and no shortage of joy.", hi: "इस नवंबर, हम अपने सभी प्रियजनों को न्यूयॉर्क शहर ला रहे हैं ताकि अपने अगले अध्याय का जश्न वैसे ही मनाएँ जैसे इसकी शुरुआत हुई — गर्मजोशी, अच्छे साथ और भरपूर खुशी के बीच।" },
    "st.btn": { en: "See the schedule", hi: "कार्यक्रम देखें" },
    "faq.q1": { en: "What should I wear?", hi: "मुझे क्या पहनना चाहिए?" },
    "faq.a1": { en: "Indian festive attire is warmly encouraged across all events. The Haldi calls for something you don't mind getting a little yellow; the Sangeet is colourful and celebratory; the ceremony is traditional; the reception is formal. When in doubt, dress to celebrate.", hi: "सभी आयोजनों में भारतीय उत्सवी पहनावा का स्वागत है। हल्दी के लिए ऐसा कुछ जिस पर थोड़ी हल्दी लगे तो चलेगा; संगीत रंगीन और उत्सवी है; समारोह पारंपरिक है; रिसेप्शन औपचारिक है। संदेह हो तो उत्सव के अनुरूप पहनें।" },
    "faq.q2": { en: "Any colours to avoid?", hi: "किन रंगों से बचें?" },
    "faq.a2": { en: "Please wear your most colourful outfits! We just ask guests to avoid red, maroon, gold, white, and ivory, which are traditionally reserved for the couple.", hi: "कृपया अपने सबसे रंगीन कपड़े पहनें! हम बस अतिथियों से लाल, मैरून, सुनहरा, सफ़ेद और आइवरी से बचने का अनुरोध करते हैं, जो परंपरागत रूप से जोड़े के लिए आरक्षित हैं।" },
    "faq.q3": { en: "Can I bring a guest?", hi: "क्या मैं किसी को साथ ला सकता/सकती हूँ?" },
    "faq.a3": { en: "Your invitation and RSVP reflect the seats reserved for you. If you have a question about your party, please reach out and we'll be happy to help.", hi: "आपका निमंत्रण और RSVP आपके लिए आरक्षित सीटें दर्शाते हैं। यदि आपके समूह के बारे में कोई सवाल हो, तो संपर्क करें — हम मदद के लिए तैयार हैं।" },
    "faq.q4": { en: "What's the weather like?", hi: "मौसम कैसा रहेगा?" },
    "faq.a4": { en: "Early November in New York is crisp — generally 40–55°F (5–13°C). Bring a wrap or coat for the evenings.", hi: "नवंबर की शुरुआत में न्यूयॉर्क में ठंडक रहती है — आमतौर पर 40–55°F (5–13°C)। शाम के लिए शॉल या कोट साथ रखें।" },
    "faq.q5": { en: "Getting between venues?", hi: "स्थानों के बीच आना-जाना?" },
    "faq.a5": { en: "Everything is in Manhattan, a short ride apart. Taxis and rideshare are plentiful, and any shuttle details will be shared here closer to the date.", hi: "सब कुछ मैनहटन में है, थोड़ी ही दूरी पर। टैक्सी और राइडशेयर भरपूर हैं, और शटल संबंधी जानकारी तिथि के नज़दीक यहाँ साझा की जाएगी।" },
    "faq.q6": { en: "When should I RSVP, and who do I ask?", hi: "मैं कब तक RSVP करूँ, और किससे पूछूँ?" },
    "tv.fly.t": { en: "✈️ Flying in", hi: "✈️ हवाई यात्रा" },
    "tv.fly.p2": { en: "Fly into any of New York's three airports — JFK, LaGuardia (LGA), or Newark (EWR). All are an easy ride to Lower Manhattan.", hi: "न्यूयॉर्क के तीनों हवाई अड्डों — JFK, लागार्डिया (LGA), या नेवार्क (EWR) — में से किसी पर उतरें। सभी से लोअर मैनहटन आसानी से पहुँचा जा सकता है।" },
    "tv.stay.t": { en: "🏨 Where to stay", hi: "🏨 कहाँ ठहरें" },
    "tv.stay.p1": { en: "We've reserved a room block at the <strong>Conrad New York Downtown</strong> — our home base for the weekend, moments from the celebrations.", hi: "हमने <strong>कॉनराड न्यूयॉर्क डाउनटाउन</strong> में कमरों का ब्लॉक आरक्षित किया है — सप्ताहांत का हमारा ठिकाना, समारोहों से बस कुछ ही दूरी पर।" },
    "tv.stay.p2": { en: "Group rate from <strong>$409/night</strong>, rooms held <strong>Nov 5–8</strong>. Booking link &amp; group code to follow.", hi: "समूह दर <strong>$409/रात</strong> से, कमरे <strong>5–8 नवंबर</strong> तक आरक्षित। बुकिंग लिंक और ग्रुप कोड शीघ्र।" },
    "tv.stay.btn": { en: "View hotel", hi: "होटल देखें" },
    "tv.venue.t": { en: "📍 The venues", hi: "📍 स्थान" },
    "tv.venue.p": { en: "All three celebration venues are in Manhattan — the Conrad and Hall des Lumières in Lower Manhattan, The Lighthouse at Pier 61 in Chelsea.", hi: "तीनों समारोह स्थल मैनहटन में हैं — कॉनराड और हॉल दे लुमिएर लोअर मैनहटन में, द लाइटहाउस एट पियर 61 चेल्सी में।" },
    "tv.venue.btn": { en: "Open in Maps", hi: "मैप में खोलें" },
    "tv.around.t": { en: "🚕 Getting around", hi: "🚕 आना-जाना" },
    "tv.around.p": { en: "Everything is in Manhattan, a short ride apart. Taxis and rideshare are plentiful, and the subway is quick. Any shuttle details will be shared here closer to the date.", hi: "सब कुछ मैनहटन में है, थोड़ी ही दूरी पर। टैक्सी और राइडशेयर भरपूर हैं, और सबवे तेज़ है। शटल संबंधी जानकारी तिथि के नज़दीक यहाँ साझा की जाएगी।" },
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
    "pt.groomsmen.more": { en: "More of Sanjay's groomsmen will be announced soon.", hi: "संजय के और सखाओं की घोषणा जल्द की जाएगी।" },
    "pt.withlove": { en: "With love", hi: "स्नेह सहित" },
    "pt.memory": { en: "In loving memory", hi: "स्नेहमयी स्मृति में" },
    "pt.mob": { en: "Mother of the Bride", hi: "वधू की माता" },
    "pt.mog": { en: "Mother of the Groom", hi: "वर की माता" },
    "pt.gfog": { en: "Grandfather of the Groom", hi: "वर के दादा" },
    "pt.fob": { en: "Father of the Bride", hi: "वधू के पिता" },
    "pt.fog": { en: "Father of the Groom", hi: "वर के पिता" },
    "pt.gmog": { en: "Grandmother of the Groom", hi: "वर की दादी" },
    "sch.haldi.dress": { en: "<strong>Attire:</strong> Bright colours you don't mind getting a little turmeric on", hi: "<strong>पहनावा:</strong> चटख रंग जिन पर थोड़ी हल्दी लग जाए तो चलेगा" },
    "sch.haldi.desc": { en: "A bright morning of turmeric, music and blessings before the wedding.", hi: "विवाह से पहले हल्दी, संगीत और आशीर्वाद की एक उज्ज्वल सुबह।" },
    "sch.sangeet.dress": { en: "<strong>Attire:</strong> Colourful & celebratory", hi: "<strong>पहनावा:</strong> रंगीन और उत्सवी" },
    "sch.sangeet.desc": { en: "An evening of music and dance — family performances and a DJ late into the night.", hi: "संगीत और नृत्य की एक शाम — पारिवारिक प्रस्तुतियाँ और देर रात तक DJ।" },
    "sch.ceremony.dress": { en: "<strong>Attire:</strong> Traditional", hi: "<strong>पहनावा:</strong> पारंपरिक" },
    "sch.ceremony.desc": { en: "The wedding ceremony — our traditions, our vows, the heart of the weekend.", hi: "विवाह समारोह — हमारी परंपराएँ, हमारे वचन, सप्ताहांत का हृदय।" },
    "sch.reception.dress": { en: "<strong>Attire:</strong> Formal", hi: "<strong>पहनावा:</strong> औपचारिक" },
    "sch.reception.desc": { en: "Dinner, dancing and one last celebration to send us off into married life.", hi: "रात्रिभोज, नृत्य और एक आख़िरी उत्सव — हमें वैवाहिक जीवन में विदा करने के लिए।" },
    "sch.addcal": { en: "＋ Add weekend to calendar", hi: "＋ कैलेंडर में सप्ताहांत जोड़ें" },
    "sch.haldi.when": { en: "Fri, Nov 6 · Morning", hi: "शुक्र, 6 नवंबर · सुबह" },
    "sch.haldi.where": { en: "Conrad New York Downtown", hi: "कॉनराड न्यूयॉर्क डाउनटाउन" },
    "sch.sangeet.when": { en: "Fri, Nov 6 · 7:00 PM", hi: "शुक्र, 6 नवंबर · शाम 7:00" },
    "sch.sangeet.where": { en: "The Lighthouse at Pier 61", hi: "द लाइटहाउस, पियर 61" },
    "sch.ceremony.when": { en: "Sat, Nov 7 · Daytime", hi: "शनि, 7 नवंबर · दिन में" },
    "sch.ceremony.where": { en: "Conrad New York Downtown", hi: "कॉनराड न्यूयॉर्क डाउनटाउन" },
    "sch.reception.when": { en: "Sat, Nov 7 · Evening", hi: "शनि, 7 नवंबर · शाम" },
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
    "rs.no": { en: "Regretfully declines", hi: "सादर अस्वीकार" },
    "rs.guests": { en: "Number of guests (incl. you)", hi: "अतिथियों की संख्या (आप सहित)" },
    "rs.events": { en: "Which events will you join?", hi: "आप किन आयोजनों में शामिल होंगे?" },
    "rs.meal": { en: "Meal preference", hi: "भोजन की पसंद" },
    "rs.meal.none": { en: "No preference", hi: "कोई पसंद नहीं" },
    "rs.hotel": { en: "I'd like a room in the hotel block", hi: "मुझे होटल ब्लॉक में एक कमरा चाहिए" },
    "rs.note": { en: "Song request &amp; a note for the couple", hi: "गाने की फ़रमाइश और जोड़े के लिए संदेश" },
    "rs.note.ph": { en: "Anything you'd like us to know — dietary needs, a song to play, a message…", hi: "जो भी आप बताना चाहें — भोजन संबंधी ज़रूरतें, कोई गाना, कोई संदेश…" },
    "rs.send": { en: "Send RSVP", hi: "उपस्थिति भेजें" },
    "rs.gifts.t": { en: "Gifts &amp; blessings", hi: "उपहार और आशीर्वाद" },
    "rs.gifts.p": { en: "Your presence is the only present we need. If you wish to give, we've set up a registry and a honeymoon fund.", hi: "आपकी उपस्थिति ही हमारे लिए सबसे बड़ा उपहार है। यदि आप देना चाहें, तो हमने एक उपहार सूची और हनीमून फंड बनाया है।" },
    "rs.gifts.reg": { en: "View registry", hi: "उपहार सूची देखें" },
    "rs.gifts.hm": { en: "Honeymoon fund", hi: "हनीमून फंड" },
    "rg.reg.t": { en: "🎁 Registry", hi: "🎁 उपहार सूची" },
    "rg.reg.p": { en: "A curated list of things for our new home together — from the everyday to the occasional splurge.", hi: "हमारे नए घर के लिए चुनी हुई चीज़ों की सूची — रोज़मर्रा से लेकर कभी-कभार की विशेष चीज़ों तक।" },
    "rg.reg.btn": { en: "Open registry", hi: "उपहार सूची खोलें" },
    "rg.hm.t": { en: "🏝️ Honeymoon fund", hi: "🏝️ हनीमून फंड" },
    "rg.hm.p": { en: "Help us toward our honeymoon — a dinner, an excursion, or a night under the stars.", hi: "हमारे हनीमून में योगदान दें — एक रात्रिभोज, एक सैर, या तारों भरी एक रात।" },
    "rg.hm.btn": { en: "Contribute", hi: "योगदान करें" },
    "rg.ch.t": { en: "💝 Charity in our name", hi: "💝 हमारे नाम पर दान" },
    "rg.ch.p": { en: "Prefer to give back? Donate to a cause close to our hearts and we'll be just as touched.", hi: "कुछ लौटाना चाहते हैं? हमारे दिल के क़रीब किसी उद्देश्य के लिए दान करें — हम उतने ही भावुक होंगे।" },
    "rg.ch.btn": { en: "Learn more", hi: "और जानें" },
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
  };

  let lang = localStorage.getItem("lang") || "en";
  function t(key) {
    const e = DICT[key];
    if (!e) return key;
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

  const langBtn = document.getElementById("appbarLang");
  const updateLangBtn = () => {
    // Show the language you'll switch *to*, and announce it accessibly.
    langBtn.textContent = lang === "en" ? "हिं" : "EN";
    langBtn.setAttribute("lang", lang === "en" ? "hi" : "en");
    const label = lang === "en" ? "हिंदी में बदलें" : "Switch to English";
    langBtn.setAttribute("aria-label", label);
    langBtn.setAttribute("title", label);
  };
  updateLangBtn();
  langBtn.addEventListener("click", () => {
    lang = lang === "en" ? "hi" : "en";
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
