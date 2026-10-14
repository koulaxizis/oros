// ============================================================
// orOS Atelier — more templates for the library (data only, v1.0.0)
// Hand-made for orOS with shapes, text, the bundled icons (Tabler,
// MIT), tables and charts: free to use, offline, no image files (the
// previews are drawn on the fly). Same building blocks and units as
// templates.js; each entry has a category (`cat`) and search words
// (`tags`, English + Greek). Tables and charts carry their rows (and
// a chart its title) as { en, el }.
// ============================================================
(function (root) {
  "use strict";

  var TPL = typeof module !== "undefined" && module.exports ? require("./templates.js") : root.ATELIER_TEMPLATES;
  var H = TPL.h, tx = H.tx, sh = H.sh, ic = H.ic, ln = H.ln, ctx = H.ctx, MM = H.MM;
  var A4W = H.A4W, A4H = H.A4H, A5W = H.A5W, A5H = H.A5H;
  var BW = 85 * MM, BH = 55 * MM, IW = 127 * MM, IH = 178 * MM, PW = 148 * MM, PH = 105 * MM;
  var A3W = 297 * MM, A3H = 420 * MM;

  function mix(s, o) { Object.keys(o || {}).forEach(function (k) { s[k] = o[k]; }); return s; }
  function table(x, y, w, h, tb, o) { return mix({ k: "table", x: x, y: y, w: w, h: h, tb: tb, sw: 1 }, o); }
  function chart(x, y, w, h, ch, o) { return mix({ k: "chart", x: x, y: y, w: w, h: h, ch: ch }, o); }
  function T(id, cat, preset, en, el, w, h, unit, tags, pages) {
    return { id: id, cat: cat, preset: preset, en: en, el: el, w: w, h: h, unit: unit, tags: { en: tags[0], el: tags[1] }, pages: pages };
  }

  var MORE = [
    // ---------- Social posts ----------
    T("new-product", "social", "ig-post", "New product", "Νέο προϊόν", 1080, 1080, "px", ["instagram shop launch price", "instagram κατάστημα λανσάρισμα τιμή"], [{ bg: "#f1f5f9", items: [
      sh("circle", 520, 260, 640, 640, "#fde68a"),
      ic("shopping-bag", 640, 380, 400, "#92400e", { sw: 1.2 }),
      sh("rounded", 80, 110, 200, 66, "#0f172a", { rd: 100 }),
      tx(80, 124, 200, "NEW IN", "ΝΕΟ", { al: "c", size: 30, b: 1, fc: "#ffffff", tr: 150 }),
      tx(80, 240, 520, "Meet the\nlinen tote", "Γνώρισε τη\nλινή τσάντα", { size: 86, b: 1, fc: "#0f172a", lh: 105 }),
      tx(80, 500, 440, "Handmade, light and strong. Ready for every day.", "Χειροποίητη, ελαφριά και γερή. Για κάθε μέρα.", { size: 34, fc: "#475569", lh: 135 }),
      tx(80, 760, 400, "€29", "29 €", { size: 110, b: 1, fc: "#b45309" }),
      tx(80, 930, 600, "shop.example.com", "shop.example.com", { size: 30, fc: "#475569" })
    ] }]),
    T("tips-list", "social", "ig-portrait", "Five tips", "Πέντε συμβουλές", 1080, 1350, "px", ["instagram list advice sleep carousel", "instagram λίστα συμβουλές ύπνος"], [{ bg: "#0b132b", items: [
      ic("moon-stars", 80, 90, 110, "#ffd166", { sw: 1.4 }),
      tx(80, 230, 920, "5 tips for\nbetter sleep", "5 συμβουλές για\nκαλύτερο ύπνο", { size: 84, b: 1, fc: "#ffffff", lh: 105 }),
      sh("circle", 80, 520, 90, 90, "#ffd166"), tx(80, 540, 90, "1", "1", { al: "c", size: 44, b: 1, fc: "#0b132b" }),
      tx(200, 540, 800, "Same bedtime every night", "Ίδια ώρα ύπνου κάθε βράδυ", { size: 40, fc: "#e0e1dd" }),
      sh("circle", 80, 670, 90, 90, "#ffd166"), tx(80, 690, 90, "2", "2", { al: "c", size: 44, b: 1, fc: "#0b132b" }),
      tx(200, 690, 800, "No screens one hour before", "Χωρίς οθόνες μία ώρα πριν", { size: 40, fc: "#e0e1dd" }),
      sh("circle", 80, 820, 90, 90, "#ffd166"), tx(80, 840, 90, "3", "3", { al: "c", size: 44, b: 1, fc: "#0b132b" }),
      tx(200, 840, 800, "A cool, dark room", "Δροσερό, σκοτεινό δωμάτιο", { size: 40, fc: "#e0e1dd" }),
      sh("circle", 80, 970, 90, 90, "#ffd166"), tx(80, 990, 90, "4", "4", { al: "c", size: 44, b: 1, fc: "#0b132b" }),
      tx(200, 990, 800, "Light dinner, no late coffee", "Ελαφρύ βραδινό, όχι αργά καφές", { size: 40, fc: "#e0e1dd" }),
      sh("circle", 80, 1120, 90, 90, "#ffd166"), tx(80, 1140, 90, "5", "5", { al: "c", size: 44, b: 1, fc: "#0b132b" }),
      tx(200, 1140, 800, "Ten minutes of reading", "Δέκα λεπτά διάβασμα", { size: 40, fc: "#e0e1dd" })
    ] }]),
    T("testimonial", "social", "ig-post", "Customer review", "Κριτική πελάτη", 1080, 1080, "px", ["instagram testimonial quote stars review", "instagram μαρτυρία αστέρια κριτική"], [{ bg: "#fff7ed", items: [
      sh("rounded", 80, 80, 920, 920, "#ffffff", { rd: 12 }),
      ic("quote", 140, 140, 120, "#fb923c", { sw: 1.4 }),
      tx(140, 300, 800, "“The best coffee in town and the friendliest people. We come back every week.”", "«Ο καλύτερος καφές της πόλης και οι πιο φιλικοί άνθρωποι. Ερχόμαστε κάθε εβδομάδα.»", { font: "serif", size: 54, fc: "#431407", lh: 130 }),
      ic("star", 140, 760, 56, "#f59e0b", { fc: "#f59e0b" }), ic("star", 210, 760, 56, "#f59e0b", { fc: "#f59e0b" }),
      ic("star", 280, 760, 56, "#f59e0b", { fc: "#f59e0b" }), ic("star", 350, 760, 56, "#f59e0b", { fc: "#f59e0b" }),
      ic("star", 420, 760, 56, "#f59e0b", { fc: "#f59e0b" }),
      tx(140, 850, 800, "Anna K., customer", "Άννα Κ., πελάτισσα", { size: 34, b: 1, fc: "#9a3412" })
    ] }]),
    T("giveaway", "social", "ig-post", "Giveaway", "Διαγωνισμός", 1080, 1080, "px", ["instagram contest prize win", "instagram δώρο έπαθλο κέρδισε"], [{ g: { a: "#7c3aed", b: "#db2777", ang: 135 }, items: [
      ic("gift", 440, 80, 200, "#ffffff", { sw: 1.3 }),
      ctx(1080, 320, 940, "GIVEAWAY", "ΔΙΑΓΩΝΙΣΜΟΣ", { size: 110, b: 1, fc: "#ffffff", tfx: { type: "lift" } }),
      ctx(1080, 480, 860, "Win a weekend for two by the sea", "Κέρδισε ένα διήμερο για δύο δίπλα στη θάλασσα", { size: 46, fc: "#fde68a", lh: 120 }),
      sh("rounded", 190, 640, 700, 250, "#ffffff", { rd: 20, op: 92 }),
      tx(250, 672, 600, "1   Follow us\n2   Like this post\n3   Tag a friend", "1   Ακολούθησέ μας\n2   Κάνε like\n3   Αναφέρε έναν φίλο", { size: 40, b: 1, fc: "#4c1d95", lh: 140 }),
      ctx(1080, 960, 860, "Winner announced on Friday", "Ο νικητής ανακοινώνεται την Παρασκευή", { size: 32, i: 1, fc: "#ffffff" })
    ] }]),
    // ---------- Stories ----------
    T("story-sale", "story", "story", "Sale story", "Story εκπτώσεων", 1080, 1920, "px", ["instagram discount weekend shop", "instagram έκπτωση σαββατοκύριακο"], [{ bg: "#111827", items: [
      sh("circle", 140, 300, 800, 800, "#f43f5e"),
      ctx(1080, 540, 800, "-30%", "-30%", { size: 250, b: 1, fc: "#ffffff" }),
      ctx(1080, 860, 700, "on everything", "σε όλα", { size: 60, fc: "#ffe4e6" }),
      ctx(1080, 1220, 940, "WEEKEND SALE", "ΕΚΠΤΩΣΕΙΣ ΔΙΗΜΕΡΟΥ", { size: 80, b: 1, fc: "#ffffff", tr: 60 }),
      ctx(1080, 1400, 800, "Saturday and Sunday only", "Μόνο Σάββατο και Κυριακή", { size: 46, fc: "#9ca3af" }),
      ic("arrow-up", 500, 1620, 80, "#f43f5e", { sw: 2 }),
      ctx(1080, 1730, 600, "Shop now", "Αγόρασε τώρα", { size: 44, b: 1, fc: "#ffffff" })
    ] }]),
    T("story-question", "story", "story", "Questions story", "Story ερωτήσεων", 1080, 1920, "px", ["instagram ask me anything q&a", "instagram ρώτα με ερωτήσεις"], [{ g: { a: "#06b6d4", b: "#3b82f6", ang: 160 }, items: [
      ctx(1080, 330, 900, "Ask me\nanything", "Ρώτα με\nό,τι θες", { size: 130, b: 1, fc: "#ffffff", lh: 100 }),
      sh("rounded", 120, 760, 840, 420, "#ffffff", { rd: 14 }),
      ic("message-circle", 470, 820, 140, "#3b82f6", { sw: 1.6 }),
      ctx(1080, 1020, 700, "Type your question…", "Γράψε την ερώτησή σου…", { size: 46, fc: "#94a3b8" }),
      ctx(1080, 1390, 860, "Answers live on Friday", "Απαντήσεις σε live την Παρασκευή", { size: 48, fc: "#ffffff" }),
      ctx(1080, 1700, 600, "@yourname", "@yourname", { size: 40, b: 1, fc: "#e0f2fe" })
    ] }]),
    T("story-recipe", "story", "story", "Recipe story", "Story συνταγής", 1080, 1920, "px", ["instagram food cooking salad", "instagram φαγητό μαγειρική σαλάτα"], [{ bg: "#fefae0", items: [
      sh("circle", 290, 150, 500, 500, "#ccd5ae"),
      ic("salad", 390, 250, 300, "#386641", { sw: 1.3 }),
      ctx(1080, 730, 900, "Greek salad\nin 5 minutes", "Χωριάτικη\nσε 5 λεπτά", { font: "serif", b: 1, size: 100, fc: "#283618", lh: 105 }),
      sh("rounded", 120, 1060, 840, 600, "#ffffff", { rd: 8 }),
      tx(180, 1110, 720, "YOU NEED", "ΘΑ ΧΡΕΙΑΣΤΕΙΣ", { size: 36, b: 1, tr: 200, fc: "#bc6c25" }),
      tx(180, 1180, 720, "2 tomatoes\n1 cucumber\nhalf an onion\nfeta, olives, oregano\nolive oil", "2 ντομάτες\n1 αγγούρι\nμισό κρεμμύδι\nφέτα, ελιές, ρίγανη\nελαιόλαδο", { size: 44, fc: "#283618", lh: 150 }),
      ctx(1080, 1740, 800, "Save it for later", "Αποθήκευσέ το για μετά", { size: 40, i: 1, fc: "#606c38" })
    ] }]),
    // ---------- Thumbnails ----------
    T("thumb-vlog", "video", "yt-thumb", "Travel vlog thumbnail", "Μικρογραφία ταξιδιωτικού vlog", 1280, 720, "px", ["youtube video travel", "youtube βίντεο ταξίδι"], [{ bg: "#0f172a", items: [
      sh("rounded", 700, 90, 520, 540, "#38bdf8", { rd: 8, rot: 4 }),
      ic("mountain", 800, 200, 320, "#0f172a", { sw: 1.4, rot: 4 }),
      sh("rounded", 60, 70, 200, 76, "#ef4444", { rd: 30 }),
      tx(60, 84, 200, "VLOG", "VLOG", { al: "c", size: 44, b: 1, fc: "#ffffff", tr: 100 }),
      tx(60, 200, 600, "MY FIRST\nTRIP TO CRETE", "ΤΟ ΠΡΩΤΟ ΜΟΥ\nΤΑΞΙΔΙ ΣΤΗΝ ΚΡΗΤΗ", { size: 72, b: 1, fc: "#ffffff", lh: 100 }),
      tx(60, 470, 600, "Beaches, villages and the best food", "Παραλίες, χωριά και το καλύτερο φαγητό", { size: 36, fc: "#94a3b8", lh: 125 })
    ] }]),
    // ---------- Presentations ----------
    T("pres-pitch", "pres", "slides", "Project presentation", "Παρουσίαση έργου", 1920, 1080, "px", ["slides deck chart agenda pitch", "διαφάνειες γράφημα ατζέντα"], [
      { bg: "#0b1f3a", items: [
        sh("rect", 0, 0, 24, 1080, "#f5a524"),
        tx(160, 340, 1500, "Project Aurora", "Έργο Αυγή", { size: 130, b: 1, fc: "#ffffff" }),
        tx(160, 540, 1400, "A clear plan for the next 12 months", "Ένα καθαρό σχέδιο για τους επόμενους 12 μήνες", { size: 54, fc: "#9fb3c8" }),
        tx(160, 900, 1100, "Team name · March 2026", "Όνομα ομάδας · Μάρτιος 2026", { size: 36, fc: "#f5a524" })
      ] },
      { bg: "#ffffff", items: [
        tx(160, 110, 1600, "Agenda", "Ατζέντα", { size: 90, b: 1, fc: "#0b1f3a" }),
        ln(160, 250, 200, 0, "#f5a524", 8),
        tx(160, 330, 140, "01", "01", { size: 64, b: 1, fc: "#f5a524" }), tx(330, 342, 1300, "Where we are", "Πού βρισκόμαστε", { size: 52, fc: "#0b1f3a" }),
        tx(160, 480, 140, "02", "02", { size: 64, b: 1, fc: "#f5a524" }), tx(330, 492, 1300, "What we learned", "Τι μάθαμε", { size: 52, fc: "#0b1f3a" }),
        tx(160, 630, 140, "03", "03", { size: 64, b: 1, fc: "#f5a524" }), tx(330, 642, 1300, "The plan", "Το σχέδιο", { size: 52, fc: "#0b1f3a" }),
        tx(160, 780, 140, "04", "04", { size: 64, b: 1, fc: "#f5a524" }), tx(330, 792, 1300, "Next steps", "Επόμενα βήματα", { size: 52, fc: "#0b1f3a" })
      ] },
      { bg: "#ffffff", items: [
        tx(160, 90, 1600, "Growth in 2025", "Ανάπτυξη το 2025", { size: 80, b: 1, fc: "#0b1f3a" }),
        chart(160, 250, 1000, 700, { t: "col", rows: {
          en: [["", "2024", "2025"], ["Q1", "12", "18"], ["Q2", "15", "22"], ["Q3", "14", "27"], ["Q4", "19", "34"]],
          el: [["", "2024", "2025"], ["Α΄ τρίμ.", "12", "18"], ["Β΄ τρίμ.", "15", "22"], ["Γ΄ τρίμ.", "14", "27"], ["Δ΄ τρίμ.", "19", "34"]] },
          co: ["#9fb3c8", "#f5a524"] }, { size: 26 }),
        tx(1240, 320, 540, "Sales grew every quarter, with the best result in Q4.", "Οι πωλήσεις αυξήθηκαν κάθε τρίμηνο, με ρεκόρ στο 4ο.", { size: 44, fc: "#334155", lh: 135 }),
        tx(1240, 720, 540, "+42%", "+42%", { size: 140, b: 1, fc: "#f5a524" })
      ] }
    ]),
    T("pres-minimal", "pres", "slides", "Minimal presentation", "Λιτή παρουσίαση", 1920, 1080, "px", ["slides deck workshop ideas", "διαφάνειες εργαστήριο ιδέες"], [
      { bg: "#f7f4ef", items: [
        sh("circle", 1300, -200, 900, 900, "#e8d5c4"),
        tx(160, 380, 1100, "Design that\nspeaks clearly", "Σχεδιασμός που\nμιλά καθαρά", { font: "serif", size: 120, fc: "#2d2a26", lh: 105 }),
        tx(160, 760, 900, "Workshop · Athens", "Εργαστήριο · Αθήνα", { size: 40, tr: 100, caps: 1, fc: "#8a7968" })
      ] },
      { bg: "#f7f4ef", items: [
        tx(160, 130, 1600, "Three ideas", "Τρεις ιδέες", { font: "serif", size: 90, fc: "#2d2a26" }),
        sh("circle", 160, 360, 120, 120, "#e8d5c4"), ic("bulb", 190, 390, 60, "#2d2a26", { sw: 1.6 }),
        tx(160, 520, 480, "Less, but better", "Λιγότερα, αλλά καλύτερα", { size: 46, b: 1, fc: "#2d2a26" }),
        tx(160, 600, 480, "Every element earns its place.", "Κάθε στοιχείο κερδίζει τη θέση του.", { size: 34, fc: "#5c544b", lh: 140 }),
        sh("circle", 720, 360, 120, 120, "#e8d5c4"), ic("target", 750, 390, 60, "#2d2a26", { sw: 1.6 }),
        tx(720, 520, 480, "One goal per page", "Ένας στόχος ανά σελίδα", { size: 46, b: 1, fc: "#2d2a26" }),
        tx(720, 600, 480, "Say one thing and say it well.", "Πες ένα πράγμα και πες το καλά.", { size: 34, fc: "#5c544b", lh: 140 }),
        sh("circle", 1280, 360, 120, 120, "#e8d5c4"), ic("heart", 1310, 390, 60, "#2d2a26", { sw: 1.6 }),
        tx(1280, 520, 480, "Make it human", "Κάν' το ανθρώπινο", { size: 46, b: 1, fc: "#2d2a26" }),
        tx(1280, 600, 480, "Write the way you speak.", "Γράψε όπως μιλάς.", { size: 34, fc: "#5c544b", lh: 140 })
      ] }
    ]),
    // ---------- Posters ----------
    T("poster-concert", "poster", "poster-a3", "Concert poster", "Αφίσα συναυλίας", A3W, A3H, "mm", ["music jazz night event", "μουσική τζαζ βραδιά εκδήλωση"], [{ bg: "#18181b", items: [
      sh("circle", 120, 140, 600, 600, "#f59e0b", { op: 90 }),
      sh("circle", 300, 330, 420, 420, "#e11d48", { op: 85 }),
      ic("music", 330, 360, 240, "#18181b", { sw: 1.5 }),
      ctx(A3W, 800, 760, "JAZZ NIGHT", "ΒΡΑΔΙΑ ΤΖΑΖ", { size: 96, b: 1, fc: "#ffffff", tr: 40 }),
      ctx(A3W, 930, 720, "Live quartet · Friday 18 October · 21:00", "Ζωντανό κουαρτέτο · Παρασκευή 18 Οκτωβρίου · 21:00", { size: 26, fc: "#f59e0b" }),
      ln(A3W / 2 - 100, 1000, 200, 0, "#e11d48", 3),
      ctx(A3W, 1030, 720, "The Old Warehouse · Tickets €10", "Η Παλιά Αποθήκη · Εισιτήριο 10 €", { size: 24, fc: "#d4d4d8" })
    ] }]),
    T("poster-workshop", "poster", "poster-a4", "Workshop poster", "Αφίσα εργαστηρίου", A4W, A4H, "mm", ["class course painting event", "μάθημα σεμινάριο ζωγραφική εκδήλωση"], [{ bg: "#ecfeff", items: [
      sh("rect", 0, 0, A4W, 320, "#155e75"),
      ic("brush", 60, 60, 70, "#a5f3fc", { sw: 1.6 }),
      tx(60, 150, 480, "Watercolour\nworkshop", "Εργαστήρι\nακουαρέλας", { font: "serif", size: 54, b: 1, fc: "#ffffff", lh: 105 }),
      tx(60, 370, 475, "Learn to paint landscapes in one relaxed afternoon. All materials included.", "Μάθε να ζωγραφίζεις τοπία σε ένα χαλαρό απόγευμα. Όλα τα υλικά περιλαμβάνονται.", { size: 17, fc: "#164e63", lh: 145 }),
      ic("calendar", 60, 520, 24, "#0e7490"), tx(100, 522, 440, "Saturday 9 November", "Σάββατο 9 Νοεμβρίου", { size: 17, b: 1, fc: "#164e63" }),
      ic("clock", 60, 570, 24, "#0e7490"), tx(100, 572, 440, "17:00–20:00", "17:00–20:00", { size: 17, b: 1, fc: "#164e63" }),
      ic("map-pin", 60, 620, 24, "#0e7490"), tx(100, 622, 440, "Town Library, 2nd floor", "Δημοτική Βιβλιοθήκη, 2ος όροφος", { size: 17, b: 1, fc: "#164e63" }),
      sh("rounded", 60, 700, 475, 80, "#155e75", { rd: 50 }),
      tx(60, 726, 475, "Book your seat: 210 000 0000", "Κράτηση θέσης: 210 000 0000", { al: "c", size: 20, b: 1, fc: "#ffffff" })
    ] }]),
    T("poster-quote", "poster", "poster-a3", "Quote poster", "Αφίσα με ρητό", A3W, A3H, "mm", ["typography wall art minimal", "τυπογραφία τοίχος λιτό"], [{ bg: "#f5f0e6", items: [
      tx(80, 160, 300, "“", "«", { font: "serif", size: 300, fc: "#c2410c" }),
      tx(90, 480, 660, "Simplicity is the ultimate sophistication.", "Η απλότητα είναι η ύψιστη μορφή φινέτσας.", { font: "serif", size: 76, fc: "#1c1917", lh: 115 }),
      ln(90, 900, 120, 0, "#c2410c", 4),
      tx(90, 930, 660, "LEONARDO DA VINCI", "ΛΕΟΝΑΡΝΤΟ ΝΤΑ ΒΙΝΤΣΙ", { size: 24, b: 1, tr: 300, fc: "#57534e" })
    ] }]),
    // ---------- Flyers ----------
    T("flyer-gym", "flyer", "flyer-a5", "Gym flyer", "Φυλλάδιο γυμναστηρίου", A5W, A5H, "mm", ["fitness sport offer leaflet", "γυμναστική άθληση προσφορά φέιγ βολάν"], [{ bg: "#111111", items: [
      sh("rect", 0, 0, A5W, 250, "#facc15"),
      ic("barbell", 30, 40, 80, "#111111", { sw: 1.8 }),
      tx(30, 135, 360, "GET STRONG", "ΓΙΝΕ ΔΥΝΑΤΟΣ", { size: 44, b: 1, fc: "#111111", tr: 20 }),
      tx(30, 290, 360, "First month free", "Ο πρώτος μήνας δωρεάν", { size: 26, b: 1, fc: "#facc15" }),
      tx(30, 340, 360, "Personal plan, small groups and an open gym from 6:00 to 23:00.", "Προσωπικό πρόγραμμα, μικρές ομάδες και ανοιχτό γυμναστήριο από τις 6:00 ως τις 23:00.", { size: 14, fc: "#e5e5e5", lh: 150 }),
      ln(30, 450, 360, 0, "#facc15", 1.5),
      tx(30, 470, 360, "Iron Club · 5 Stadium Street", "Iron Club · Οδός Σταδίου 5", { size: 13, b: 1, fc: "#ffffff" }),
      tx(30, 495, 360, "ironclub.example.com · 210 000 0000", "ironclub.example.com · 210 000 0000", { size: 12, fc: "#a3a3a3" })
    ] }]),
    T("flyer-cleaning", "flyer", "flyer-a5", "Services flyer", "Φυλλάδιο υπηρεσιών", A5W, A5H, "mm", ["cleaning home business leaflet", "καθαρισμός σπίτι επιχείρηση φέιγ βολάν"], [{ bg: "#ffffff", items: [
      sh("circle", -120, -160, 420, 420, "#bfdbfe"),
      sh("circle", 250, -100, 260, 260, "#dbeafe"),
      ic("sparkles", 40, 40, 60, "#1d4ed8", { sw: 1.6 }),
      tx(40, 185, 340, "Sparkling\nhome cleaning", "Λαμπερό\nκαθάρισμα σπιτιού", { size: 34, b: 1, fc: "#1e3a8a", lh: 110 }),
      ic("check", 40, 300, 20, "#16a34a", { sw: 2.4 }), tx(70, 301, 300, "Kitchens and bathrooms", "Κουζίνες και μπάνια", { size: 15, fc: "#1e293b" }),
      ic("check", 40, 336, 20, "#16a34a", { sw: 2.4 }), tx(70, 337, 300, "Windows and balconies", "Τζάμια και μπαλκόνια", { size: 15, fc: "#1e293b" }),
      ic("check", 40, 372, 20, "#16a34a", { sw: 2.4 }), tx(70, 373, 300, "Eco-friendly products", "Οικολογικά προϊόντα", { size: 15, fc: "#1e293b" }),
      ic("check", 40, 408, 20, "#16a34a", { sw: 2.4 }), tx(70, 409, 300, "Booking the same week", "Ραντεβού μέσα στην εβδομάδα", { size: 15, fc: "#1e293b" }),
      sh("burst", 280, 425, 120, 120, "#f97316"),
      tx(280, 462, 120, "from\n€40", "από\n40 €", { al: "c", size: 18, b: 1, fc: "#ffffff", lh: 110 }),
      tx(40, 525, 340, "Call 690 000 0000", "Κάλεσε 690 000 0000", { size: 18, b: 1, fc: "#1d4ed8" })
    ] }]),
    T("flyer-rent", "flyer", "flyer-a5", "Flat for rent", "Ενοικιάζεται διαμέρισμα", A5W, A5H, "mm", ["real estate house home table", "ακίνητα σπίτι ενοίκιο πίνακας"], [{ bg: "#f8fafc", items: [
      sh("rect", 0, 0, A5W, 90, "#0f766e"),
      tx(30, 30, 360, "FOR RENT", "ΕΝΟΙΚΙΑΖΕΤΑΙ", { size: 30, b: 1, fc: "#ffffff", tr: 150 }),
      sh("rounded", 30, 120, 360, 200, "#ccfbf1", { rd: 8 }),
      ic("home", 150, 150, 120, "#0f766e", { sw: 1.4 }),
      tx(30, 345, 360, "Bright flat near the park", "Φωτεινό διαμέρισμα κοντά στο πάρκο", { size: 20, b: 1, fc: "#134e4a" }),
      table(30, 385, 360, 128, { rows: {
        en: [["Size", "85 m²"], ["Bedrooms", "2"], ["Floor", "3rd, with lift"], ["Rent", "€650 a month"]],
        el: [["Εμβαδόν", "85 τ.μ."], ["Υπνοδωμάτια", "2"], ["Όροφος", "3ος, με ασανσέρ"], ["Ενοίκιο", "650 € τον μήνα"]] },
        hd: 0, hc: 1, ln: "h" }, { size: 13, fc: "#134e4a", sc: "#99f6e4" }),
      tx(30, 535, 360, "Viewings: 690 000 0000", "Επισκέψεις: 690 000 0000", { size: 15, b: 1, fc: "#0f766e" })
    ] }]),
    // ---------- Business cards ----------
    T("biz-dark", "biz", "card-biz", "Dark business card", "Σκούρα επαγγελματική κάρτα", BW, BH, "mm", ["architect gold elegant", "αρχιτέκτονας χρυσό κομψή"], [
      { bg: "#111827", items: [
        tx(20, 34, 200, "Nikos Georgiou", "Νίκος Γεωργίου", { font: "serif", size: 16, fc: "#fbbf24" }),
        tx(20, 58, 200, "Architect", "Αρχιτέκτονας", { size: 8, caps: 1, tr: 200, fc: "#9ca3af" }),
        ln(20, 82, 40, 0, "#fbbf24", 1),
        tx(20, 94, 200, "+30 690 000 0000\nnikos@example.com\nAthens · Greece", "+30 690 000 0000\nnikos@example.com\nΑθήνα · Ελλάδα", { size: 7.5, fc: "#e5e7eb", lh: 150 })
      ] },
      { bg: "#fbbf24", items: [
        ic("building", BW / 2 - 25, 38, 50, "#111827", { sw: 1.4 }),
        ctx(BW, 100, 200, "GEORGIOU STUDIO", "GEORGIOU STUDIO", { size: 9, b: 1, tr: 300, fc: "#111827" })
      ] }
    ]),
    T("biz-minimal", "biz", "card-biz", "Minimal business card", "Λιτή επαγγελματική κάρτα", BW, BH, "mm", ["photographer simple white", "φωτογράφος απλή λευκή"], [{ bg: "#ffffff", items: [
      ctx(BW, 42, 210, "Sofia Ioannou", "Σοφία Ιωάννου", { size: 15, fc: "#111111" }),
      ctx(BW, 64, 210, "Photographer", "Φωτογράφος", { font: "serif", i: 1, size: 9, fc: "#6b7280" }),
      ln(BW / 2 - 15, 88, 30, 0, "#111111", 0.8),
      ctx(BW, 100, 220, "sofia.example.com · 690 000 0000", "sofia.example.com · 690 000 0000", { size: 7, fc: "#374151" })
    ] }]),
    T("biz-colour", "biz", "card-biz", "Colourful business card", "Πολύχρωμη επαγγελματική κάρτα", BW, BH, "mm", ["yoga teacher gradient", "γιόγκα δασκάλα διαβάθμιση"], [{ g: { a: "#f97316", b: "#db2777", ang: 120 }, items: [
      sh("circle", 165, -40, 120, 120, "#ffffff", { op: 15 }),
      tx(20, 28, 200, "Dimitra Lazarou", "Δήμητρα Λαζάρου", { size: 15, b: 1, fc: "#ffffff" }),
      tx(20, 50, 200, "Yoga teacher", "Δασκάλα γιόγκα", { size: 9, fc: "#ffedd5" }),
      ic("yoga", 20, 76, 26, "#ffffff", { sw: 1.6 }),
      tx(20, 116, 210, "690 000 0000 · @dimitra.yoga", "690 000 0000 · @dimitra.yoga", { size: 7.5, fc: "#ffffff" })
    ] }]),
    // ---------- Invitations & cards ----------
    T("wedding", "invite", "invite", "Wedding invitation", "Προσκλητήριο γάμου", IW, IH, "mm", ["marriage ceremony elegant", "γάμος τελετή κομψό"], [{ bg: "#fbf8f3", items: [
      ic("leaf", IW / 2 - 30, 40, 60, "#a3b18a", { sw: 1.3 }),
      ctx(IW, 118, 300, "Together with their families", "Μαζί με τις οικογένειές τους", { size: 10, caps: 1, tr: 200, fc: "#6b705c" }),
      ctx(IW, 148, 320, "Eleni", "Ελένη", { font: "serif", i: 1, size: 40, fc: "#3a5a40" }),
      ctx(IW, 200, 300, "&", "&", { font: "serif", size: 24, fc: "#a3b18a" }),
      ctx(IW, 230, 320, "Giorgos", "Γιώργος", { font: "serif", i: 1, size: 40, fc: "#3a5a40" }),
      ctx(IW, 300, 300, "invite you to their wedding", "σας προσκαλούν στον γάμο τους", { font: "serif", size: 13, fc: "#344e41" }),
      ln(IW / 2 - 40, 340, 80, 0, "#a3b18a", 1),
      ctx(IW, 360, 310, "Sunday 6 September 2026 · 18:30", "Κυριακή 6 Σεπτεμβρίου 2026 · 18:30", { size: 11, b: 1, fc: "#344e41" }),
      ctx(IW, 384, 310, "Church of St. Nicholas, Nafplio", "Ιερός Ναός Αγίου Νικολάου, Ναύπλιο", { size: 10, fc: "#6b705c" }),
      ctx(IW, 450, 300, "Please reply by 1 August", "Παρακαλούμε επιβεβαιώστε έως 1 Αυγούστου", { size: 9, i: 1, fc: "#6b705c" })
    ] }]),
    T("christening", "invite", "invite", "Christening invitation", "Προσκλητήριο βάπτισης", IW, IH, "mm", ["baptism baby boy church", "βάπτιση μωρό εκκλησία"], [{ bg: "#eef6fb", items: [
      ic("star", 40, 40, 18, "#f2c14e", { fc: "#f2c14e" }), ic("star", 300, 70, 14, "#f2c14e", { fc: "#f2c14e" }),
      ic("sailboat", IW / 2 - 35, 40, 70, "#5b8db8", { sw: 1.3 }),
      ctx(IW, 130, 300, "Our little one's christening", "Η βάπτιση του μικρού μας", { font: "serif", i: 1, size: 18, fc: "#5b8db8" }),
      ctx(IW, 172, 300, "Alexandros", "Αλέξανδρος", { font: "serif", size: 36, b: 1, fc: "#1f3b57" }),
      ctx(IW, 240, 280, "We would love you to share this day with us.", "Θα χαρούμε πολύ να μοιραστείτε αυτή τη μέρα μαζί μας.", { size: 11, fc: "#3d5a73", lh: 140 }),
      sh("rounded", 50, 305, IW - 100, 92, "#ffffff", { rd: 20 }),
      ctx(IW, 322, 240, "Saturday 20 June · 12:00\nChurch of St. George", "Σάββατο 20 Ιουνίου · 12:00\nΙερός Ναός Αγίου Γεωργίου", { size: 11, b: 1, fc: "#1f3b57", lh: 150 }),
      ctx(IW, 425, 300, "Reception to follow at Seaside Hall", "Ακολουθεί δεξίωση στην αίθουσα «Θάλασσα»", { size: 10, fc: "#3d5a73" })
    ] }]),
    T("thank-you", "invite", "card-post", "Thank-you card", "Ευχαριστήρια κάρτα", PW, PH, "mm", ["postcard gratitude gift", "καρτ ποστάλ ευγνωμοσύνη δώρο"], [{ bg: "#fff1e6", items: [
      sh("circle", 270, 40, 220, 220, "#fde2e4"),
      ic("flower", 320, 90, 120, "#e5989b", { sw: 1.3 }),
      tx(40, 80, 260, "Thank you", "Ευχαριστώ", { font: "serif", i: 1, size: 44, fc: "#6d6875" }),
      tx(40, 160, 230, "for being part of our day and for your lovely gift.", "που ήσουν μέρος της μέρας μας και για το υπέροχο δώρο.", { size: 12, fc: "#6d6875", lh: 145 }),
      tx(40, 240, 230, "With love, Maria & Kostas", "Με αγάπη, Μαρία & Κώστας", { font: "serif", i: 1, size: 12, fc: "#b5838d" })
    ] }]),
    // ---------- CVs ----------
    T("cv-classic", "cv", "cv", "Classic CV", "Κλασικό βιογραφικό", A4W, A4H, "mm", ["resume job application", "βιογραφικό αίτηση εργασία"], [{ bg: "#ffffff", items: [
      tx(50, 50, 495, "Katerina Nikolaou", "Κατερίνα Νικολάου", { font: "serif", size: 32, b: 1, fc: "#1f2937" }),
      tx(50, 94, 495, "Marketing manager", "Υπεύθυνη μάρκετινγκ", { size: 13, caps: 1, tr: 150, fc: "#6b7280" }),
      tx(50, 120, 495, "katerina@example.com · +30 690 000 0000 · Thessaloniki", "katerina@example.com · +30 690 000 0000 · Θεσσαλονίκη", { size: 9.5, fc: "#374151" }),
      ln(50, 146, 495, 0, "#1f2937", 1.2),
      tx(50, 166, 495, "PROFILE", "ΠΡΟΦΙΛ", { size: 11, b: 1, tr: 200, fc: "#9a3412" }),
      tx(50, 186, 495, "Eight years in brand and digital marketing. I plan campaigns, lead small teams and measure what works.", "Οκτώ χρόνια στο brand και στο ψηφιακό μάρκετινγκ. Σχεδιάζω καμπάνιες, συντονίζω μικρές ομάδες και μετρώ τι αποδίδει.", { size: 10.5, fc: "#374151", lh: 145 }),
      tx(50, 250, 495, "EXPERIENCE", "ΕΜΠΕΙΡΙΑ", { size: 11, b: 1, tr: 200, fc: "#9a3412" }),
      tx(50, 272, 360, "Marketing manager · Olive & Co.", "Υπεύθυνη μάρκετινγκ · Olive & Co.", { size: 11, b: 1, fc: "#1f2937" }),
      tx(410, 273, 135, "2021 – today", "2021 – σήμερα", { al: "r", size: 9.5, fc: "#6b7280" }),
      tx(50, 290, 495, "Led the relaunch of the brand; online sales grew 40% in two years.", "Ηγήθηκα του νέου λανσαρίσματος· οι online πωλήσεις αυξήθηκαν 40% σε δύο χρόνια.", { size: 10, fc: "#374151", lh: 140 }),
      tx(50, 330, 360, "Digital specialist · Blue Agency", "Ειδικός ψηφιακών μέσων · Blue Agency", { size: 11, b: 1, fc: "#1f2937" }),
      tx(410, 331, 135, "2017 – 2021", "2017 – 2021", { al: "r", size: 9.5, fc: "#6b7280" }),
      tx(50, 348, 495, "Social media, newsletters and paid ads for 20 clients.", "Social media, newsletters και διαφήμιση για 20 πελάτες.", { size: 10, fc: "#374151", lh: 140 }),
      tx(50, 400, 495, "EDUCATION", "ΣΠΟΥΔΕΣ", { size: 11, b: 1, tr: 200, fc: "#9a3412" }),
      tx(50, 422, 400, "MSc Marketing · University of Macedonia", "MSc Μάρκετινγκ · Πανεπιστήμιο Μακεδονίας", { size: 11, b: 1, fc: "#1f2937" }),
      tx(455, 423, 90, "2016", "2016", { al: "r", size: 9.5, fc: "#6b7280" }),
      tx(50, 446, 400, "BA Economics · Aristotle University", "Πτυχίο Οικονομικών · ΑΠΘ", { size: 11, b: 1, fc: "#1f2937" }),
      tx(455, 447, 90, "2014", "2014", { al: "r", size: 9.5, fc: "#6b7280" }),
      tx(50, 500, 495, "SKILLS", "ΔΕΞΙΟΤΗΤΕΣ", { size: 11, b: 1, tr: 200, fc: "#9a3412" }),
      tx(50, 520, 495, "Strategy · Copywriting · Analytics · Team leadership · English (C2) · French (B2)", "Στρατηγική · Κειμενογραφία · Αναλύσεις · Ηγεσία ομάδας · Αγγλικά (C2) · Γαλλικά (B2)", { size: 10.5, fc: "#374151", lh: 150 })
    ] }]),
    T("cv-modern", "cv", "cv", "Modern CV", "Μοντέρνο βιογραφικό", A4W, A4H, "mm", ["resume sidebar developer", "βιογραφικό πλαϊνή στήλη προγραμματιστής"], [{ bg: "#ffffff", items: [
      sh("rect", 0, 0, 200, A4H, "#1e3a5f"),
      sh("circle", 40, 50, 120, 120, "#a7c4e2"), ic("user", 70, 80, 60, "#1e3a5f", { sw: 1.5 }),
      tx(25, 200, 160, "CONTACT", "ΕΠΙΚΟΙΝΩΝΙΑ", { size: 10, b: 1, tr: 200, fc: "#a7c4e2" }),
      tx(25, 222, 165, "+30 690 000 0000\nyannis@example.com\nlinkedin.com/in/yannis\nPatras", "+30 690 000 0000\nyannis@example.com\nlinkedin.com/in/yannis\nΠάτρα", { size: 8.5, fc: "#ffffff", lh: 160 }),
      tx(25, 320, 160, "SKILLS", "ΔΕΞΙΟΤΗΤΕΣ", { size: 10, b: 1, tr: 200, fc: "#a7c4e2" }),
      tx(25, 342, 165, "JavaScript\nPython\nSQL\nCloud services\nTesting", "JavaScript\nPython\nSQL\nΥπηρεσίες cloud\nΈλεγχος κώδικα", { size: 9, fc: "#ffffff", lh: 170 }),
      tx(25, 470, 160, "LANGUAGES", "ΓΛΩΣΣΕΣ", { size: 10, b: 1, tr: 200, fc: "#a7c4e2" }),
      tx(25, 492, 165, "Greek (native)\nEnglish (C1)\nGerman (B1)", "Ελληνικά (μητρική)\nΑγγλικά (C1)\nΓερμανικά (B1)", { size: 9, fc: "#ffffff", lh: 170 }),
      tx(230, 50, 330, "Yannis Petrou", "Γιάννης Πέτρου", { size: 30, b: 1, fc: "#1e3a5f" }),
      tx(230, 92, 330, "Software developer", "Προγραμματιστής", { size: 13, fc: "#4a6fa5" }),
      tx(230, 140, 330, "ABOUT ME", "ΣΧΕΤΙΚΑ ΜΕ ΕΜΕΝΑ", { size: 11, b: 1, tr: 200, fc: "#1e3a5f" }),
      tx(230, 160, 330, "I build web apps that are fast, clear and easy to use. I like small teams and clean code.", "Φτιάχνω web εφαρμογές γρήγορες, καθαρές και εύκολες. Μου αρέσουν οι μικρές ομάδες και ο καθαρός κώδικας.", { size: 10, fc: "#334155", lh: 145 }),
      tx(230, 240, 330, "EXPERIENCE", "ΕΜΠΕΙΡΙΑ", { size: 11, b: 1, tr: 200, fc: "#1e3a5f" }),
      tx(230, 262, 330, "Senior developer · Northwind", "Senior προγραμματιστής · Northwind", { size: 11, b: 1, fc: "#0f172a" }),
      tx(230, 279, 330, "2022 – today", "2022 – σήμερα", { size: 9, fc: "#64748b" }),
      tx(230, 294, 330, "Lead of the booking platform used by 2 million people a year.", "Υπεύθυνος της πλατφόρμας κρατήσεων με 2 εκατομμύρια χρήστες τον χρόνο.", { size: 10, fc: "#334155", lh: 140 }),
      tx(230, 340, 330, "Developer · Seaside Labs", "Προγραμματιστής · Seaside Labs", { size: 11, b: 1, fc: "#0f172a" }),
      tx(230, 357, 330, "2018 – 2022", "2018 – 2022", { size: 9, fc: "#64748b" }),
      tx(230, 372, 330, "Mobile and web apps for tourism and retail.", "Εφαρμογές κινητού και web για τουρισμό και λιανική.", { size: 10, fc: "#334155", lh: 140 }),
      tx(230, 430, 330, "EDUCATION", "ΣΠΟΥΔΕΣ", { size: 11, b: 1, tr: 200, fc: "#1e3a5f" }),
      tx(230, 452, 330, "BSc Computer Science · University of Patras", "Πτυχίο Πληροφορικής · Πανεπιστήμιο Πατρών", { size: 11, b: 1, fc: "#0f172a" }),
      tx(230, 486, 330, "2014 – 2018", "2014 – 2018", { size: 9, fc: "#64748b" })
    ] }]),
    T("cv-creative", "cv", "cv", "Creative CV", "Δημιουργικό βιογραφικό", A4W, A4H, "mm", ["resume designer illustrator chart skills", "βιογραφικό σχεδιάστρια εικονογράφος γράφημα"], [{ bg: "#fffdf7", items: [
      sh("rect", 0, 0, A4W, 190, "#fde68a"),
      sh("circle", 470, -60, 220, 220, "#f59e0b", { op: 80 }),
      tx(50, 56, 400, "Maria Vlachou", "Μαρία Βλάχου", { size: 34, b: 1, fc: "#292524" }),
      tx(50, 104, 400, "Illustrator & designer", "Εικονογράφος & σχεδιάστρια", { size: 14, fc: "#57534e" }),
      tx(50, 132, 400, "maria.example.com · 690 000 0000", "maria.example.com · 690 000 0000", { size: 9.5, fc: "#57534e" }),
      tx(50, 220, 250, "PROFILE", "ΠΡΟΦΙΛ", { size: 11, b: 1, tr: 200, fc: "#b45309" }),
      tx(50, 240, 250, "I draw books, posters and brands with colour and humour. Ten years freelance.", "Εικονογραφώ βιβλία, αφίσες και brands με χρώμα και χιούμορ. Δέκα χρόνια ελεύθερη επαγγελματίας.", { size: 10, fc: "#44403c", lh: 145 }),
      tx(50, 330, 250, "EXPERIENCE", "ΕΜΠΕΙΡΙΑ", { size: 11, b: 1, tr: 200, fc: "#b45309" }),
      tx(50, 350, 250, "Freelance illustrator\n2016 – today", "Ελεύθερη εικονογράφος\n2016 – σήμερα", { size: 10, b: 1, fc: "#292524", lh: 140 }),
      tx(50, 385, 250, "24 picture books, 3 museum campaigns.", "24 εικονογραφημένα βιβλία, 3 καμπάνιες μουσείων.", { size: 10, fc: "#44403c", lh: 140 }),
      tx(50, 425, 250, "Designer · Paper Studio\n2013 – 2016", "Σχεδιάστρια · Paper Studio\n2013 – 2016", { size: 10, b: 1, fc: "#292524", lh: 140 }),
      tx(50, 460, 250, "Packaging and labels for food brands.", "Συσκευασίες και ετικέτες για τρόφιμα.", { size: 10, fc: "#44403c", lh: 140 }),
      tx(50, 520, 250, "EDUCATION", "ΣΠΟΥΔΕΣ", { size: 11, b: 1, tr: 200, fc: "#b45309" }),
      tx(50, 540, 250, "School of Fine Arts, Athens\n2009 – 2013", "Ανωτάτη Σχολή Καλών Τεχνών\n2009 – 2013", { size: 10, fc: "#44403c", lh: 140 }),
      tx(330, 220, 215, "SKILLS", "ΔΕΞΙΟΤΗΤΕΣ", { size: 11, b: 1, tr: 200, fc: "#b45309" }),
      chart(325, 238, 220, 190, { t: "bar", lg: 0, co: ["#f59e0b"], rows: {
        en: [["", "Level"], ["Drawing", "95"], ["Branding", "85"], ["Layout", "80"], ["Animation", "60"]],
        el: [["", "Επίπεδο"], ["Σχέδιο", "95"], ["Branding", "85"], ["Σελιδοποίηση", "80"], ["Κίνηση", "60"]] } }, { size: 8 }),
      tx(330, 460, 215, "CLIENTS", "ΠΕΛΑΤΕΣ", { size: 11, b: 1, tr: 200, fc: "#b45309" }),
      tx(330, 480, 215, "Publishers, museums, cafés and small brands.", "Εκδότες, μουσεία, καφέ και μικρές επιχειρήσεις.", { size: 10, fc: "#44403c", lh: 145 })
    ] }]),
    // ---------- Certificates ----------
    T("cert-award", "cert", "certificate", "Award certificate", "Βεβαίωση βράβευσης", A4H, A4W, "mm", ["employee of the year prize gold", "βραβείο χρονιάς έπαινος χρυσό"], [{ bg: "#0f172a", items: [
      sh("rect", 30, 30, A4H - 60, A4W - 60, "", { sc: "#d4af37", sw: 2 }),
      ic("trophy", A4H / 2 - 35, 60, 70, "#d4af37", { sw: 1.4 }),
      ctx(A4H, 150, 700, "EMPLOYEE OF THE YEAR", "ΕΡΓΑΖΟΜΕΝΟΣ ΤΗΣ ΧΡΟΝΙΑΣ", { font: "serif", size: 30, b: 1, tr: 150, fc: "#d4af37" }),
      ctx(A4H, 210, 600, "is awarded to", "απονέμεται στον/στην", { font: "serif", i: 1, size: 14, fc: "#cbd5e1" }),
      ctx(A4H, 240, 650, "Name Surname", "Όνομα Επώνυμο", { font: "serif", i: 1, size: 44, fc: "#ffffff" }),
      ctx(A4H, 325, 560, "for outstanding work, kindness and team spirit in 2026.", "για την εξαιρετική δουλειά, την ευγένεια και το ομαδικό πνεύμα το 2026.", { size: 13, fc: "#cbd5e1", lh: 140 }),
      sh("burst", A4H / 2 - 40, 420, 80, 80, "#d4af37"),
      ic("star", A4H / 2 - 15, 445, 30, "#0f172a", { fc: "#0f172a" }),
      ln(150, 470, 180, 0, "#d4af37", 0.8), tx(150, 478, 180, "Date", "Ημερομηνία", { al: "c", size: 10, fc: "#94a3b8" }),
      ln(A4H - 330, 470, 180, 0, "#d4af37", 0.8), tx(A4H - 330, 478, 180, "Director", "Διεύθυνση", { al: "c", size: 10, fc: "#94a3b8" })
    ] }]),
    T("cert-attendance", "cert", "certificate", "Certificate of attendance", "Βεβαίωση παρακολούθησης", A4H, A4W, "mm", ["seminar training course diploma", "σεμινάριο εκπαίδευση πιστοποιητικό"], [{ bg: "#ffffff", items: [
      sh("rect", 0, 0, 120, A4W, "#2563eb"),
      ic("certificate", 30, 40, 60, "#ffffff", { sw: 1.4 }),
      tx(170, 90, 620, "CERTIFICATE OF ATTENDANCE", "ΒΕΒΑΙΩΣΗ ΠΑΡΑΚΟΛΟΥΘΗΣΗΣ", { size: 26, b: 1, tr: 120, fc: "#1e3a8a" }),
      tx(170, 150, 600, "This is to certify that", "Βεβαιώνεται ότι ο/η", { size: 13, fc: "#475569" }),
      tx(170, 178, 620, "Name Surname", "Όνομα Επώνυμο", { font: "serif", size: 40, b: 1, fc: "#0f172a" }),
      ln(170, 245, 400, 0, "#2563eb", 2),
      tx(170, 265, 600, "attended the seminar “First aid at work” (8 hours) on 12 March 2026.", "παρακολούθησε το σεμινάριο «Πρώτες βοήθειες στην εργασία» (8 ώρες) στις 12 Μαρτίου 2026.", { size: 14, fc: "#334155", lh: 145 }),
      ln(170, 470, 200, 0, "#334155", 0.8), tx(170, 478, 200, "Trainer", "Εκπαιδευτής", { al: "c", size: 10, fc: "#64748b" }),
      ln(560, 470, 200, 0, "#334155", 0.8), tx(560, 478, 200, "Organiser", "Φορέας", { al: "c", size: 10, fc: "#64748b" })
    ] }]),
    // ---------- Menus ----------
    T("menu-cafe", "menu", "menu", "Café price list", "Τιμοκατάλογος καφέ", A4W, A4H, "mm", ["coffee sweets prices table", "καφές γλυκά τιμές πίνακας"], [{ bg: "#fffbf5", items: [
      ic("coffee", A4W / 2 - 28, 40, 56, "#7c4a2d", { sw: 1.5 }),
      ctx(A4W, 105, 500, "Café Aroma", "Καφέ Άρωμα", { font: "serif", size: 40, b: 1, fc: "#3f2a1d" }),
      ctx(A4W, 160, 500, "COFFEE · TEA · SWEETS", "ΚΑΦΕΣ · ΤΣΑΪ · ΓΛΥΚΑ", { size: 11, tr: 300, fc: "#a47148" }),
      tx(60, 220, 475, "COFFEE", "ΚΑΦΕΣ", { size: 15, b: 1, tr: 200, fc: "#a47148" }),
      table(60, 248, 475, 200, { rows: {
        en: [["Espresso", "2.00"], ["Freddo espresso", "3.00"], ["Cappuccino", "3.20"], ["Greek coffee", "2.50"], ["Filter coffee", "2.80"]],
        el: [["Εσπρέσο", "2,00"], ["Φρέντο εσπρέσο", "3,00"], ["Καπουτσίνο", "3,20"], ["Ελληνικός", "2,50"], ["Φίλτρου", "2,80"]] },
        hd: 0, ln: "h", cw: [5, 1] }, { font: "serif", size: 14, fc: "#3f2a1d", sc: "#e7d7c1", sw: 0.8 }),
      tx(60, 490, 475, "SWEETS", "ΓΛΥΚΑ", { size: 15, b: 1, tr: 200, fc: "#a47148" }),
      table(60, 518, 475, 160, { rows: {
        en: [["Chocolate cake", "4.50"], ["Cheesecake", "4.80"], ["Baklava", "3.50"], ["Ice cream (2 scoops)", "3.00"]],
        el: [["Κέικ σοκολάτας", "4,50"], ["Τσιζκέικ", "4,80"], ["Μπακλαβάς", "3,50"], ["Παγωτό (2 μπάλες)", "3,00"]] },
        hd: 0, ln: "h", cw: [5, 1] }, { font: "serif", size: 14, fc: "#3f2a1d", sc: "#e7d7c1", sw: 0.8 }),
      ctx(A4W, 760, 475, "Prices in euro, VAT included", "Τιμές σε ευρώ, με ΦΠΑ", { size: 10, i: 1, fc: "#a47148" })
    ] }]),
    T("menu-dinner", "menu", "menu", "Dinner menu", "Μενού δείπνου", A4W, A4H, "mm", ["restaurant evening courses elegant", "εστιατόριο βραδινό πιάτα κομψό"], [{ bg: "#1b1b1b", items: [
      sh("rect", 30, 30, A4W - 60, A4H - 60, "", { sc: "#c9a227", sw: 1 }),
      ctx(A4W, 80, 450, "DINNER MENU", "ΜΕΝΟΥ ΔΕΙΠΝΟΥ", { font: "serif", size: 30, tr: 200, fc: "#c9a227" }),
      ctx(A4W, 125, 400, "Saturday, 7 December", "Σάββατο, 7 Δεκεμβρίου", { font: "serif", i: 1, size: 13, fc: "#d6d3d1" }),
      ctx(A4W, 200, 400, "TO START", "ΓΙΑ ΑΡΧΗ", { size: 11, b: 1, tr: 300, fc: "#c9a227" }),
      ctx(A4W, 228, 420, "Beetroot salad with goat cheese", "Σαλάτα παντζάρι με κατσικίσιο τυρί", { font: "serif", size: 18, fc: "#ffffff" }),
      ctx(A4W, 258, 400, "walnuts, honey and thyme", "καρύδια, μέλι και θυμάρι", { font: "serif", i: 1, size: 11, fc: "#a8a29e" }),
      ln(A4W / 2 - 20, 310, 40, 0, "#c9a227", 0.8),
      ctx(A4W, 360, 400, "MAIN", "ΚΥΡΙΩΣ", { size: 11, b: 1, tr: 300, fc: "#c9a227" }),
      ctx(A4W, 388, 420, "Slow-cooked lamb", "Αργοψημένο αρνί", { font: "serif", size: 18, fc: "#ffffff" }),
      ctx(A4W, 418, 400, "lemon potatoes and wild greens", "λεμονάτες πατάτες και χόρτα", { font: "serif", i: 1, size: 11, fc: "#a8a29e" }),
      ln(A4W / 2 - 20, 470, 40, 0, "#c9a227", 0.8),
      ctx(A4W, 520, 400, "DESSERT", "ΕΠΙΔΟΡΠΙΟ", { size: 11, b: 1, tr: 300, fc: "#c9a227" }),
      ctx(A4W, 548, 420, "Orange pie", "Πορτοκαλόπιτα", { font: "serif", size: 18, fc: "#ffffff" }),
      ctx(A4W, 578, 400, "with vanilla ice cream", "με παγωτό βανίλια", { font: "serif", i: 1, size: 11, fc: "#a8a29e" }),
      ctx(A4W, 720, 420, "€45 per person · wine pairing €20", "45 € το άτομο · συνοδευτικά κρασιά 20 €", { size: 11, fc: "#d6d3d1" })
    ] }]),
    // ---------- Charts & tables ----------
    T("report", "data", "poster-a4", "Monthly report", "Μηνιαία αναφορά", A4W, A4H, "mm", ["sales dashboard chart table kpi", "πωλήσεις γράφημα πίνακας δείκτες"], [{ bg: "#ffffff", items: [
      sh("rect", 0, 0, A4W, 110, "#1e293b"),
      tx(40, 38, 360, "Monthly report", "Μηνιαία αναφορά", { size: 26, b: 1, fc: "#ffffff" }),
      tx(400, 46, 155, "October 2026", "Οκτώβριος 2026", { al: "r", size: 12, fc: "#94a3b8" }),
      sh("rounded", 40, 140, 160, 90, "#f1f5f9", { rd: 20 }),
      tx(55, 156, 135, "Sales", "Πωλήσεις", { size: 10, fc: "#64748b" }), tx(55, 176, 135, "€48.2k", "48,2 χιλ. €", { size: 22, b: 1, fc: "#0f172a" }),
      sh("rounded", 218, 140, 160, 90, "#f1f5f9", { rd: 20 }),
      tx(233, 156, 135, "Orders", "Παραγγελίες", { size: 10, fc: "#64748b" }), tx(233, 176, 135, "1,284", "1.284", { size: 22, b: 1, fc: "#0f172a" }),
      sh("rounded", 396, 140, 160, 90, "#f1f5f9", { rd: 20 }),
      tx(411, 156, 135, "New customers", "Νέοι πελάτες", { size: 10, fc: "#64748b" }), tx(411, 176, 135, "312", "312", { size: 22, b: 1, fc: "#0f172a" }),
      chart(40, 255, 515, 245, { t: "line", ttl: { en: "Sales (thousand €)", el: "Πωλήσεις (χιλ. €)" }, co: ["#94a3b8", "#2563eb"], rows: {
        en: [["", "2025", "2026"], ["Jan", "30", "34"], ["Feb", "28", "36"], ["Mar", "33", "39"], ["Apr", "35", "41"], ["May", "38", "44"], ["Jun", "41", "48"]],
        el: [["", "2025", "2026"], ["Ιαν", "30", "34"], ["Φεβ", "28", "36"], ["Μάρ", "33", "39"], ["Απρ", "35", "41"], ["Μάι", "38", "44"], ["Ιούν", "41", "48"]] } }, { size: 9 }),
      tx(40, 525, 300, "Top products", "Κορυφαία προϊόντα", { size: 13, b: 1, fc: "#0f172a" }),
      table(40, 550, 300, 150, { rows: {
        en: [["Product", "Units", "Revenue"], ["Linen tote", "420", "€12.2k"], ["Mug set", "380", "€7.6k"], ["Notebook", "310", "€4.3k"], ["Candle", "270", "€5.1k"]],
        el: [["Προϊόν", "Τεμάχια", "Έσοδα"], ["Λινή τσάντα", "420", "12,2 χιλ. €"], ["Σετ κούπες", "380", "7,6 χιλ. €"], ["Σημειωματάριο", "310", "4,3 χιλ. €"], ["Κερί", "270", "5,1 χιλ. €"]] },
        bd: 1, ln: "h", ac: "#1e293b", cw: [20, 10, 13] }, { size: 10, sw: 0.6 }),
      chart(360, 520, 195, 190, { t: "donut", ttl: { en: "Where we sell", el: "Πού πουλάμε" }, rows: {
        en: [["", "Share"], ["Online", "58"], ["Shop", "30"], ["Markets", "12"]],
        el: [["", "Μερίδιο"], ["Online", "58"], ["Κατάστημα", "30"], ["Αγορές", "12"]] } }, { size: 8 }),
      tx(40, 735, 515, "Notes: October was our best month so far. Online orders keep growing.", "Σημειώσεις: Ο Οκτώβριος ήταν ο καλύτερος μήνας ως τώρα. Οι online παραγγελίες συνεχίζουν να αυξάνονται.", { size: 10, i: 1, fc: "#475569", lh: 140 })
    ] }]),
    T("infographic", "data", "pin", "Infographic", "Infographic", 1000, 1500, "px", ["pie chart facts day hours", "γράφημα πίτα στοιχεία μέρα ώρες"], [{ bg: "#fef3c7", items: [
      ctx(1000, 70, 860, "A day in\n24 hours", "Μια μέρα\nσε 24 ώρες", { size: 80, b: 1, fc: "#78350f", lh: 100 }),
      chart(150, 290, 700, 540, { t: "pie", co: ["#78350f", "#b45309", "#f59e0b", "#fbbf24", "#fcd34d", "#65a30d"], rows: {
        en: [["", "Hours"], ["Sleep", "8"], ["Work", "8"], ["Family & friends", "3"], ["Meals", "2"], ["Screens", "2"], ["Exercise", "1"]],
        el: [["", "Ώρες"], ["Ύπνος", "8"], ["Δουλειά", "8"], ["Οικογένεια & φίλοι", "3"], ["Φαγητό", "2"], ["Οθόνες", "2"], ["Άσκηση", "1"]] } }, { size: 22 }),
      sh("circle", 80, 900, 110, 110, "#f59e0b"), ic("moon", 105, 925, 60, "#ffffff", { sw: 1.8 }),
      tx(230, 905, 690, "8 hours of sleep", "8 ώρες ύπνος", { size: 46, b: 1, fc: "#78350f" }),
      tx(230, 965, 690, "a third of the day", "το ένα τρίτο της μέρας", { size: 28, fc: "#92400e" }),
      sh("circle", 80, 1050, 110, 110, "#b45309"), ic("briefcase", 105, 1075, 60, "#ffffff", { sw: 1.8 }),
      tx(230, 1055, 690, "8 hours of work", "8 ώρες δουλειά", { size: 46, b: 1, fc: "#78350f" }),
      tx(230, 1115, 690, "with breaks for coffee", "με διαλείμματα για καφέ", { size: 28, fc: "#92400e" }),
      sh("circle", 80, 1200, 110, 110, "#65a30d"), ic("run", 105, 1225, 60, "#ffffff", { sw: 1.8 }),
      tx(230, 1205, 690, "1 hour of exercise", "1 ώρα άσκηση", { size: 46, b: 1, fc: "#78350f" }),
      tx(230, 1265, 690, "a walk counts too", "μετράει και ένα περπάτημα", { size: 28, fc: "#92400e" }),
      ctx(1000, 1400, 800, "Example figures for one day", "Ενδεικτικά στοιχεία για μία μέρα", { size: 26, i: 1, fc: "#92400e" })
    ] }]),
    T("price-list", "data", "ig-portrait", "Price list", "Τιμοκατάλογος", 1080, 1350, "px", ["salon hair services table instagram", "κομμωτήριο υπηρεσίες πίνακας instagram"], [{ bg: "#fdf2f8", items: [
      ic("scissors", 470, 70, 140, "#9d174d", { sw: 1.3 }),
      ctx(1080, 240, 940, "Salon Bella\nprice list", "Κομμωτήριο Bella\nτιμοκατάλογος", { font: "serif", size: 72, b: 1, fc: "#831843", lh: 110 }),
      table(120, 480, 840, 600, { rows: {
        en: [["Service", "Price"], ["Women's cut", "€25"], ["Men's cut", "€15"], ["Blow-dry", "€15"], ["Colour", "from €40"], ["Highlights", "from €55"], ["Hair treatment", "€20"]],
        el: [["Υπηρεσία", "Τιμή"], ["Γυναικείο κούρεμα", "25 €"], ["Ανδρικό κούρεμα", "15 €"], ["Χτένισμα", "15 €"], ["Βαφή", "από 40 €"], ["Ανταύγειες", "από 55 €"], ["Θεραπεία μαλλιών", "20 €"]] },
        bd: 1, ln: "h", ac: "#9d174d", bf: "#fce7f3", cw: [3, 2] }, { size: 36, fc: "#500724", sc: "#f9a8d4", sw: 1.5 }),
      ctx(1080, 1160, 900, "Book: 210 000 0000 · Tue–Sat 9:00–20:00", "Ραντεβού: 210 000 0000 · Τρί–Σάβ 9:00–20:00", { size: 32, fc: "#9d174d" })
    ] }]),
    T("timetable", "data", "poster-a4", "Weekly timetable", "Εβδομαδιαίο πρόγραμμα", A4W, A4H, "mm", ["schedule classes table week yoga", "πρόγραμμα μαθήματα πίνακας εβδομάδα γιόγκα"], [{ bg: "#f0fdf4", items: [
      tx(40, 50, 515, "Weekly classes", "Εβδομαδιαίο πρόγραμμα", { size: 30, b: 1, fc: "#14532d" }),
      tx(40, 95, 515, "Green Studio · yoga and pilates", "Green Studio · γιόγκα και πιλάτες", { size: 13, fc: "#15803d" }),
      table(40, 140, 515, 520, { rows: {
        en: [["", "Mon", "Tue", "Wed", "Thu", "Fri"], ["9:00", "Yoga", "Pilates", "Yoga", "Pilates", "Yoga"], ["11:00", "Stretch", "—", "Stretch", "—", "Stretch"], ["18:00", "Pilates", "Yoga", "Pilates", "Yoga", "Pilates"], ["19:30", "Yoga flow", "Core", "Yoga flow", "Core", "—"], ["21:00", "Relax", "—", "Relax", "—", "—"]],
        el: [["", "Δευ", "Τρί", "Τετ", "Πέμ", "Παρ"], ["9:00", "Γιόγκα", "Πιλάτες", "Γιόγκα", "Πιλάτες", "Γιόγκα"], ["11:00", "Διατάσεις", "—", "Διατάσεις", "—", "Διατάσεις"], ["18:00", "Πιλάτες", "Γιόγκα", "Πιλάτες", "Γιόγκα", "Πιλάτες"], ["19:30", "Yoga flow", "Κορμός", "Yoga flow", "Κορμός", "—"], ["21:00", "Χαλάρωση", "—", "Χαλάρωση", "—", "—"]] },
        hc: 1, bd: 1, ac: "#15803d", bf: "#dcfce7" }, { size: 12, al: "c", sc: "#bbf7d0" }),
      ic("yoga", 40, 700, 50, "#15803d", { sw: 1.5 }),
      tx(105, 706, 450, "Book your class in the app or at the desk. Your first class is free.", "Κλείσε μάθημα στην εφαρμογή ή στη ρεσεψιόν. Το πρώτο μάθημα είναι δωρεάν.", { size: 12, fc: "#14532d", lh: 145 })
    ] }]),
    // ---------- Logos & banners ----------
    T("logo-mono", "brand", "logo", "Monogram logo", "Λογότυπο μονόγραμμα", 500, 500, "px", ["initials brand restaurant", "αρχικά επωνυμία εστιατόριο"], [{ bg: "#ffffff", items: [
      sh("hexagon", 125, 90, 250, 250, "#0f172a"),
      tx(125, 160, 250, "AK", "AK", { al: "c", font: "serif", size: 100, b: 1, fc: "#ffffff" }),
      ctx(500, 370, 420, "ATHENA KITCHEN", "ATHENA KITCHEN", { size: 26, b: 1, tr: 200, fc: "#0f172a" }),
      ctx(500, 412, 400, "home cooking", "σπιτική κουζίνα", { font: "serif", i: 1, size: 18, fc: "#64748b" })
    ] }]),
    T("email-header", "brand", "email-head", "Newsletter header", "Κεφαλίδα newsletter", 600, 200, "px", ["email newsletter banner", "email ενημερωτικό banner"], [{ g: { a: "#4f46e5", b: "#06b6d4", ang: 90 }, items: [
      tx(30, 50, 390, "Spring newsletter", "Ανοιξιάτικο ενημερωτικό", { size: 30, b: 1, fc: "#ffffff" }),
      tx(30, 100, 390, "News, events and a little gift inside", "Νέα, εκδηλώσεις και ένα μικρό δώρο", { size: 14, fc: "#e0e7ff" }),
      ic("mail", 450, 45, 110, "#ffffff", { sw: 1.3 })
    ] }]),
    T("li-banner", "brand", "li-banner", "LinkedIn banner", "Banner για LinkedIn", 1584, 396, "px", ["profile cover professional", "προφίλ εξώφυλλο επαγγελματικό"], [{ bg: "#0f172a", items: [
      sh("circle", 1300, 200, 400, 400, "#1e3a8a"),
      sh("circle", 1420, -80, 260, 260, "#0369a1", { op: 70 }),
      tx(560, 110, 860, "Helping small businesses grow online", "Βοηθώ μικρές επιχειρήσεις να μεγαλώσουν online", { size: 46, b: 1, fc: "#ffffff", lh: 115 }),
      tx(560, 240, 860, "Web design · SEO · Content", "Ιστοσελίδες · SEO · Περιεχόμενο", { size: 28, fc: "#38bdf8" })
    ] }])
  ];

  MORE.forEach(function (tpl) { TPL.list.push(tpl); });
  if (typeof module !== "undefined" && module.exports) module.exports = TPL;
})(this);
