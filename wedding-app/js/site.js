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
    "concierge.chip.dress": { en: "What should I wear?", hi: "मुझे क्या पहनना चाहिए?" },
    "concierge.chip.travel": { en: "How do I get to Udaipur?", hi: "उदयपुर कैसे पहुँचूँ?" },
    "concierge.chip.schedule": { en: "What's the schedule?", hi: "कार्यक्रम क्या है?" },
    "concierge.chip.kids": { en: "Can I bring my kids?", hi: "क्या मैं बच्चों को ला सकता/सकती हूँ?" },
    "a11y.skip": { en: "Skip to content", hi: "सामग्री पर जाएँ" },
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
    // Day-of "now" banner
    "now.happening": { en: "Happening now", hi: "अभी चल रहा है" },
    "now.upnext": { en: "Up next", hi: "अगला" },
    "now.inMin": { en: "in {n} min", hi: "{n} मिनट में" },
    "now.inHM": { en: "in {h}h {m}m", hi: "{h} घं {m} मि में" },
    "now.tomorrow": { en: "tomorrow", hi: "कल" },
    "now.wrap": { en: "That's a wrap — thank you for celebrating with us 💛", hi: "समापन — हमारे साथ उत्सव मनाने के लिए धन्यवाद 💛" },
    "ev.mehndi": { en: "Mehndi & Haldi", hi: "मेहंदी और हल्दी" },
    "ev.sangeet": { en: "Sangeet", hi: "संगीत" },
    "ev.ceremony": { en: "Wedding Ceremony", hi: "विवाह समारोह" },
    "ev.reception": { en: "Reception", hi: "रिसेप्शन" },
    "st.2019.t": { en: "2019 — A chance meeting", hi: "2019 — एक संयोगवश मुलाक़ात" },
    "st.2019.p": { en: "We were seated next to each other at a friend's Diwali party in Mumbai. Sanjay spilled chai on Priya's dupatta within the first ten minutes. She forgave him by dessert.", hi: "हम मुंबई में एक मित्र की दिवाली पार्टी में अगल-बगल बैठे थे। पहले दस मिनट में ही संजय ने प्रिया के दुपट्टे पर चाय गिरा दी। मिठाई आते-आते उसने माफ़ कर दिया।" },
    "st.2021.t": { en: "2021 — Long distance &amp; longer phone calls", hi: "2021 — दूरी और लंबी फ़ोन कॉल" },
    "st.2021.p": { en: "Two cities, three time zones over the years, and a shared spreadsheet of restaurants we wanted to try. We made it work, one video call at a time.", hi: "दो शहर, सालों में तीन समय-क्षेत्र, और रेस्तराँओं की एक साझा सूची जहाँ हम जाना चाहते थे। एक-एक वीडियो कॉल से हमने इसे निभाया।" },
    "st.2025.t": { en: "2025 — The proposal", hi: "2025 — प्रस्ताव" },
    "st.2025.p": { en: "On a rooftop in Udaipur overlooking Lake Pichola, Sanjay finally asked. Priya said yes before he finished the sentence.", hi: "उदयपुर में पिछोला झील के सामने एक छत पर, संजय ने आख़िरकार पूछा। प्रिया ने वाक्य पूरा होने से पहले ही हाँ कह दिया।" },
    "st.2026.t": { en: "2026 — Forever begins", hi: "2026 — हमेशा की शुरुआत" },
    "st.2026.p": { en: "And now we'd love for you to join us as we tie the knot, dance until our feet hurt, and start the next chapter — together.", hi: "और अब हम चाहते हैं कि आप हमारे साथ जुड़ें — जब हम विवाह बंधन में बँधें, पैर दुखने तक नाचें, और अगला अध्याय साथ मिलकर शुरू करें।" },
    "st.btn": { en: "See the schedule", hi: "कार्यक्रम देखें" },
    "faq.q1": { en: "Can I bring a plus-one?", hi: "क्या मैं किसी को साथ ला सकता/सकती हूँ?" },
    "faq.a1": { en: "Your invitation will note how many seats are reserved for your household. If you're unsure, just ask us in the RSVP note and we'll sort it out.", hi: "आपके निमंत्रण में बताया जाएगा कि आपके परिवार के लिए कितनी सीटें आरक्षित हैं। यदि निश्चित न हों, तो RSVP के नोट में हमसे पूछें — हम व्यवस्था कर देंगे।" },
    "faq.q2": { en: "Are children welcome?", hi: "क्या बच्चे आमंत्रित हैं?" },
    "faq.a2": { en: "Absolutely — we love little ones. Please include them in your guest count so we can plan seating and meals.", hi: "बिलकुल — हमें बच्चे बहुत पसंद हैं। कृपया उन्हें अपनी अतिथि संख्या में शामिल करें ताकि हम बैठक और भोजन की योजना बना सकें।" },
    "faq.q3": { en: "What should I wear?", hi: "मुझे क्या पहनना चाहिए?" },
    "faq.a3": { en: "Each event has its own dress code (see the Schedule). When in doubt, lean festive and colourful — it's an Indian wedding!", hi: "हर आयोजन का अपना ड्रेस कोड है (कार्यक्रम देखें)। संदेह हो तो उत्सवी और रंगीन पहनें — यह एक भारतीय विवाह है!" },
    "faq.q4": { en: "Will there be transport between events?", hi: "क्या आयोजनों के बीच परिवहन होगा?" },
    "faq.a4": { en: "Yes. Shuttles will run from the partner hotels to every event. Schedules will be shared with confirmed guests closer to the date.", hi: "हाँ। साझेदार होटलों से हर आयोजन तक शटल चलेंगी। समय-सारणी तिथि के नज़दीक पुष्ट अतिथियों के साथ साझा की जाएगी।" },
    "faq.q5": { en: "What's the best way to reach Udaipur?", hi: "उदयपुर पहुँचने का सबसे अच्छा तरीका क्या है?" },
    "faq.a5": { en: "Fly into Maharana Pratap Airport (UDR), usually via Delhi or Mumbai. See the Travel page for details.", hi: "महाराणा प्रताप हवाई अड्डे (UDR) तक उड़ान भरें, आमतौर पर दिल्ली या मुंबई होते हुए। विवरण के लिए यात्रा पृष्ठ देखें।" },
    "faq.q6": { en: "How do I reach the couple?", hi: "मैं जोड़े तक कैसे पहुँचूँ?" },
    "tv.fly.t": { en: "✈️ Flying in", hi: "✈️ हवाई यात्रा" },
    "tv.fly.p2": { en: "We'll arrange shuttles from partner hotels to all events.", hi: "हम साझेदार होटलों से सभी आयोजनों तक शटल की व्यवस्था करेंगे।" },
    "tv.stay.t": { en: "🏨 Where to stay", hi: "🏨 कहाँ ठहरें" },
    "tv.stay.btn": { en: "Request a room", hi: "कमरा अनुरोध करें" },
    "tv.venue.t": { en: "📍 The venues", hi: "📍 स्थान" },
    "tv.venue.p": { en: "All celebrations are within Udaipur. Map &amp; directions for each venue will be shared with confirmed guests.", hi: "सभी समारोह उदयपुर में हैं। हर स्थान का नक्शा और दिशा-निर्देश पुष्ट अतिथियों के साथ साझा किए जाएँगे।" },
    "tv.venue.btn": { en: "Open in Maps", hi: "मैप में खोलें" },
    "tv.around.t": { en: "🚐 Getting around", hi: "🚐 आना-जाना" },
    "tv.around.p": { en: "Shuttles run from the partner hotels to every event. Schedules are shared with confirmed guests closer to the date. Taxis and auto-rickshaws are plentiful for free time.", hi: "साझेदार होटलों से हर आयोजन तक शटल चलती हैं। समय-सारणी तिथि के नज़दीक पुष्ट अतिथियों को दी जाती है। खाली समय के लिए टैक्सी और ऑटो-रिक्शा भरपूर उपलब्ध हैं।" },
    "tv.btn": { en: "Things to do in Udaipur", hi: "उदयपुर में घूमने की जगहें" },
    "td.t1": { en: "Landmark", hi: "धरोहर" },
    "td.h1": { en: "City Palace", hi: "सिटी पैलेस" },
    "td.p1": { en: "A sprawling lakeside palace complex with courtyards, museums and sweeping views over Lake Pichola.", hi: "झील किनारे फैला एक विशाल महल परिसर — आँगन, संग्रहालय और पिछोला झील के मनोरम दृश्य।" },
    "td.t2": { en: "On the water", hi: "झील पर" },
    "td.h2": { en: "Lake Pichola boat ride", hi: "पिछोला झील नौका विहार" },
    "td.p2": { en: "Take a sunset boat to Jag Mandir island — the same water our ceremony overlooks.", hi: "सूर्यास्त के समय जग मंदिर द्वीप तक नाव लें — वही जल जिसके सामने हमारा समारोह है।" },
    "td.t3": { en: "Views", hi: "नज़ारे" },
    "td.h3": { en: "Sajjangarh (Monsoon Palace)", hi: "सज्जनगढ़ (मानसून पैलेस)" },
    "td.p3": { en: "Perched on a hilltop for the best panorama of the city and surrounding Aravalli hills.", hi: "एक पहाड़ी की चोटी पर — शहर और आसपास की अरावली पहाड़ियों का बेहतरीन नज़ारा।" },
    "td.t4": { en: "Wander", hi: "सैर" },
    "td.h4": { en: "Old City &amp; Bagore Ki Haveli", hi: "पुराना शहर और बागोर की हवेली" },
    "td.p4": { en: "Narrow lanes, artisan shops, and a restored haveli with an evening folk-dance show.", hi: "सँकरी गलियाँ, दस्तकारी की दुकानें, और शाम के लोक-नृत्य शो वाली एक पुनर्निर्मित हवेली।" },
    "td.t5": { en: "Garden", hi: "उद्यान" },
    "td.h5": { en: "Saheliyon Ki Bari", hi: "सहेलियों की बाड़ी" },
    "td.p5": { en: "The \"garden of the maidens\" — fountains, lotus pools and marble pavilions. A calm morning stop.", hi: "“सहेलियों का बगीचा” — फव्वारे, कमल के तालाब और संगमरमर के मंडप। एक शांत सुबह की जगह।" },
    "td.t6": { en: "Eat", hi: "भोजन" },
    "td.h6": { en: "Rooftop dinners", hi: "छत पर रात्रिभोज" },
    "td.p6": { en: "Udaipur's rooftop restaurants serve Rajasthani thali with a lake view. Ask the concierge for picks!", hi: "उदयपुर के छत वाले रेस्तराँ झील के नज़ारे के साथ राजस्थानी थाली परोसते हैं। सुझाव के लिए सहायक से पूछें!" },
    "td.tip": { en: "Tip: tap the 💬 concierge any time for personalised recommendations.", hi: "सुझाव: व्यक्तिगत सिफ़ारिशों के लिए कभी भी 💬 सहायक दबाएँ।" },
    "pt.teamP": { en: "Team Priya", hi: "टीम प्रिया" },
    "pt.teamS": { en: "Team Sanjay", hi: "टीम संजय" },
    "pt.moh": { en: "Maid of Honour", hi: "मुख्य सखी" },
    "pt.ananya": { en: "Priya's sister and lifelong partner-in-crime. In charge of the Sangeet choreography.", hi: "प्रिया की बहन और जीवनभर की साथी। संगीत की कोरियोग्राफ़ी की ज़िम्मेदार।" },
    "pt.meera": { en: "College roommate, travel buddy, and keeper of the emergency safety pins.", hi: "कॉलेज की रूममेट, यात्रा-साथी, और इमरजेंसी सेफ़्टी पिनों की रखवाली।" },
    "pt.neha": { en: "The calm one. Will have tissues and snacks at all times.", hi: "शांत स्वभाव वाली। हर समय टिश्यू और नाश्ता साथ रखेंगी।" },
    "pt.bestman": { en: "Best Man", hi: "मुख्य सखा" },
    "pt.rohan": { en: "Sanjay's brother. Toast-giver, baraat-DJ liaison, and chief hype man.", hi: "संजय का भाई। टोस्ट देने वाला, बारात-DJ का संयोजक, और मुख्य उत्साहवर्धक।" },
    "pt.vikram": { en: "Friend since school. Will get the dance floor going whether you like it or not.", hi: "स्कूल से दोस्त। चाहे आप चाहें या न चाहें, डांस फ़्लोर ज़रूर जमा देगा।" },
    "pt.karan": { en: "The planner. If something runs on time this weekend, thank Karan.", hi: "योजनाकार। इस सप्ताहांत कुछ समय पर हुआ, तो करण को धन्यवाद दें।" },
    "pt.bridesmaid": { en: "Bridesmaid", hi: "सखी" },
    "pt.groomsman": { en: "Groomsman", hi: "सखा" },
    "sch.mehndi.dress": { en: "<strong>Dress code:</strong> Bright florals &amp; yellows", hi: "<strong>ड्रेस कोड:</strong> चटख फूल और पीले रंग" },
    "sch.mehndi.desc": { en: "Henna, turmeric, music and brunch. An intimate, colourful kick-off to the weekend.", hi: "मेहंदी, हल्दी, संगीत और ब्रंच। सप्ताहांत की एक आत्मीय, रंगीन शुरुआत।" },
    "sch.sangeet.dress": { en: "<strong>Dress code:</strong> Indian festive / cocktail", hi: "<strong>ड्रेस कोड:</strong> भारतीय उत्सवी / कॉकटेल" },
    "sch.sangeet.desc": { en: "An evening of choreographed chaos — family performances, a live DJ, and a dance floor that stays open late.", hi: "नियोजित धमाल की एक शाम — पारिवारिक प्रस्तुतियाँ, लाइव DJ, और देर रात तक खुला डांस फ़्लोर।" },
    "sch.ceremony.dress": { en: "<strong>Dress code:</strong> Traditional formal", hi: "<strong>ड्रेस कोड:</strong> पारंपरिक औपचारिक" },
    "sch.ceremony.desc": { en: "The main event — the baraat, the pheras, and the vows, all at golden hour by the water.", hi: "मुख्य आयोजन — बारात, फेरे और वचन, सब कुछ झील किनारे सुनहरे समय में।" },
    "sch.reception.dress": { en: "<strong>Dress code:</strong> Black-tie / formal", hi: "<strong>ड्रेस कोड:</strong> ब्लैक-टाई / औपचारिक" },
    "sch.reception.desc": { en: "Dinner, drinks, toasts and one last dance to send us off into married life.", hi: "रात्रिभोज, पेय, टोस्ट और एक आख़िरी नृत्य — हमें वैवाहिक जीवन में विदा करने के लिए।" },
    "sch.addcal": { en: "＋ Add weekend to calendar", hi: "＋ कैलेंडर में सप्ताहांत जोड़ें" },
    "sch.mehndi.when": { en: "Fri, Oct 16 · 11:00 AM", hi: "शुक्र, 16 अक्टूबर · सुबह 11:00" },
    "sch.mehndi.where": { en: "The Courtyard, Hotel Lakend", hi: "द कोर्टयार्ड, होटल लेकएंड" },
    "sch.sangeet.when": { en: "Fri, Oct 16 · 7:00 PM", hi: "शुक्र, 16 अक्टूबर · शाम 7:00" },
    "sch.sangeet.where": { en: "Grand Ballroom, Hotel Lakend", hi: "ग्रैंड बॉलरूम, होटल लेकएंड" },
    "sch.ceremony.when": { en: "Sat, Oct 17 · 5:00 PM", hi: "शनि, 17 अक्टूबर · शाम 5:00" },
    "sch.ceremony.where": { en: "Lakeside Mandap, Lake Pichola", hi: "लेकसाइड मंडप, पिछोला झील" },
    "sch.reception.when": { en: "Sat, Oct 17 · 8:30 PM", hi: "शनि, 17 अक्टूबर · रात 8:30" },
    "sch.reception.where": { en: "Terrace Gardens, Lake Pichola", hi: "टेरेस गार्डन, पिछोला झील" },
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
        <div class="concierge__chips" id="conciergeChips">
          <button type="button" class="concierge__chip" data-q="concierge.chip.dress" data-i18n="concierge.chip.dress">What should I wear?</button>
          <button type="button" class="concierge__chip" data-q="concierge.chip.travel" data-i18n="concierge.chip.travel">How do I get to Udaipur?</button>
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
