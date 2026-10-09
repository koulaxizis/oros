// ============================================================
// orOS Atelier — starter templates (data only, v1.0.0)
// Hand-made for orOS: only shapes, text and the bundled icons
// (Tabler, MIT), so every template is free to use and works offline.
// Units: points (a screen design's px = pt; print sizes from mm).
// Item specs follow atelier/ax.js (k + ax fields + x, y, w, h, rot,
// op, sw). Text carries tx: { en, el }; its height is computed.
// ============================================================
(function (root) {
  "use strict";

  var MM = 72 / 25.4;

  function tx(x, y, w, en, el, o) {
    var s = { k: "text", x: x, y: y, w: w, tx: { en: en, el: el } };
    Object.keys(o || {}).forEach(function (k) { s[k] = o[k]; });
    return s;
  }
  function sh(shp, x, y, w, h, fc, o) {
    var s = { k: "shape", shp: shp, x: x, y: y, w: w, h: h, fc: fc };
    Object.keys(o || {}).forEach(function (k) { s[k] = o[k]; });
    return s;
  }
  function ic(ico, x, y, size, sc, o) {
    var s = { k: "icon", ico: ico, x: x, y: y, w: size, h: size, sc: sc, sw: 2 };
    Object.keys(o || {}).forEach(function (k) { s[k] = o[k]; });
    return s;
  }
  function ln(x, y, w, h, sc, sw, o) {
    var s = { k: "line", x: x, y: y, w: w, h: h, sc: sc, sw: sw };
    Object.keys(o || {}).forEach(function (k) { s[k] = o[k]; });
    return s;
  }
  // centred text across a width W
  function ctx(W, y, w, en, el, o) {
    var p = { al: "c" };
    Object.keys(o || {}).forEach(function (k) { p[k] = o[k]; });
    return tx((W - w) / 2, y, w, en, el, p);
  }

  var A4W = 210 * MM, A4H = 297 * MM, A5W = 148 * MM, A5H = 210 * MM;

  var LIST = [
    // ---------- Social ----------
    { id: "quote", preset: "ig-post", en: "Quote post", el: "Ανάρτηση με απόφθεγμα", w: 1080, h: 1080, unit: "px",
      pages: [{ g: { a: "#1e3a5f", b: "#4a90a4", ang: 135 }, items: [
        ic("quote", 470, 150, 140, "#f4d35e", { sw: 1.5 }),
        ctx(1080, 340, 860, "The best way to predict the future is to create it.", "Ο καλύτερος τρόπος να προβλέψεις το μέλλον είναι να το δημιουργήσεις.",
          { font: "serif", i: 1, size: 64, fc: "#ffffff", lh: 125 }),
        ln(440, 760, 200, 0, "#f4d35e", 4),
        ctx(1080, 800, 700, "PETER DRUCKER", "PETER DRUCKER", { size: 30, tr: 200, fc: "#f4d35e", b: 1 })
      ] }] },
    { id: "sale", preset: "ig-post", en: "Sale post", el: "Ανάρτηση προσφοράς", w: 1080, h: 1080, unit: "px",
      pages: [{ bg: "#ffe8d6", items: [
        sh("circle", -180, -180, 620, 620, "#ff7b54", { op: 90 }),
        sh("circle", 760, 760, 480, 480, "#ffb26b", { op: 90 }),
        ctx(1080, 250, 900, "SUMMER", "ΚΑΛΟΚΑΙΡΙΝΕΣ", { size: 120, b: 1, fc: "#3d2c8d", tr: 60 }),
        ctx(1080, 400, 900, "SALE", "ΕΚΠΤΩΣΕΙΣ", { size: 150, b: 1, fc: "#3d2c8d", tfx: { type: "splice", color: "#ff7b54", off: 40 } }),
        sh("burst", 390, 610, 300, 300, "#3d2c8d"),
        ctx(1080, 705, 300, "-50%", "-50%", { size: 80, b: 1, fc: "#ffffff" }),
        ctx(1080, 960, 900, "shop.example.com", "shop.example.com", { size: 34, fc: "#3d2c8d" })
      ] }] },
    { id: "event-story", preset: "story", en: "Event story", el: "Story εκδήλωσης", w: 1080, h: 1920, unit: "px",
      pages: [{ bg: "#14141f", items: [
        sh("arch", 140, 220, 800, 900, "#7b2cbf"),
        ic("music", 390, 420, 300, "#ffffff", { sw: 1.4 }),
        ctx(1080, 1180, 960, "LIVE MUSIC NIGHT", "ΒΡΑΔΙΑ ΖΩΝΤΑΝΗΣ ΜΟΥΣΙΚΗΣ", { size: 92, b: 1, fc: "#e0aaff", tfx: { type: "neon", blur: 30 } }),
        ctx(1080, 1460, 900, "Friday 21:00 · Old Port", "Παρασκευή 21:00 · Παλιό Λιμάνι", { size: 50, fc: "#c77dff" }),
        sh("rounded", 290, 1640, 500, 120, "#c77dff", { rd: 100 }),
        ctx(1080, 1672, 500, "Free entry", "Ελεύθερη είσοδος", { size: 44, b: 1, fc: "#14141f" })
      ] }] },
    { id: "announce", preset: "fb-post", en: "Announcement", el: "Ανακοίνωση", w: 1200, h: 630, unit: "px",
      pages: [{ bg: "#fefae0", items: [
        sh("rect", 0, 0, 420, 630, "#283618"),
        ic("speakerphone", 110, 215, 200, "#fefae0", { sw: 1.5 }),
        tx(480, 140, 660, "Big news!", "Μεγάλα νέα!", { size: 88, b: 1, fc: "#283618" }),
        tx(480, 280, 660, "We are opening our new shop on 1 June. Come and celebrate with us.", "Ανοίγουμε το νέο μας κατάστημα την 1η Ιουνίου. Ελάτε να το γιορτάσουμε μαζί!",
          { size: 38, fc: "#606c38", lh: 135 })
      ] }] },
    // ---------- Video ----------
    { id: "thumb", preset: "yt-thumb", en: "Video thumbnail", el: "Μικρογραφία βίντεο", w: 1280, h: 720, unit: "px",
      pages: [{ g: { a: "#ff006e", b: "#fb5607", ang: 45 }, items: [
        sh("circle", 820, 120, 480, 480, "#ffbe0b"),
        ic("rocket", 920, 220, 280, "#3a0ca3", { sw: 1.6 }),
        tx(60, 140, 760, "10 TIPS", "10 ΣΥΜΒΟΥΛΕΣ", { size: 130, b: 1, fc: "#ffffff", tfx: { type: "outline", color: "#3a0ca3", thick: 60 } }),
        tx(60, 330, 760, "to work smarter", "για έξυπνη δουλειά", { size: 72, b: 1, fc: "#ffbe0b", tfx: { type: "lift" } })
      ] }] },
    { id: "slide-title", preset: "slides", en: "Title slide", el: "Διαφάνεια τίτλου", w: 1920, h: 1080, unit: "px",
      pages: [{ bg: "#f8f9fa", items: [
        sh("rect", 0, 820, 1920, 260, "#0b3954"),
        sh("rect", 160, 300, 16, 360, "#e63946"),
        tx(220, 290, 1400, "Project title", "Τίτλος έργου", { size: 120, b: 1, fc: "#0b3954" }),
        tx(220, 470, 1400, "A short subtitle that says what this is about", "Ένας σύντομος υπότιτλος για το θέμα", { size: 52, fc: "#495057" }),
        tx(220, 905, 1400, "Your name · 2026", "Το όνομά σου · 2026", { size: 40, fc: "#ffffff" })
      ] }] },
    // ---------- Print ----------
    { id: "poster", preset: "poster-a4", en: "Event poster", el: "Αφίσα εκδήλωσης", w: A4W, h: A4H, unit: "mm",
      pages: [{ bg: "#003049", items: [
        sh("circle", 120, 90, 360, 360, "#fcbf49"),
        ic("sun", 200, 170, 200, "#d62828", { sw: 1.6 }),
        ctx(A4W, 480, 520, "SUMMER FESTIVAL", "ΚΑΛΟΚΑΙΡΙΝΟ ΦΕΣΤΙΒΑΛ", { size: 46, b: 1, fc: "#fcbf49", tr: 40 }),
        ctx(A4W, 590, 480, "Music · Food · Dance", "Μουσική · Φαγητό · Χορός", { size: 22, fc: "#eae2b7" }),
        ln(200, 650, 195, 0, "#fcbf49", 2),
        ctx(A4W, 680, 480, "12–14 July · Central Square", "12–14 Ιουλίου · Κεντρική Πλατεία", { size: 18, fc: "#ffffff", b: 1 }),
        ctx(A4W, 740, 480, "Free entry for everyone", "Ελεύθερη είσοδος για όλους", { size: 14, fc: "#eae2b7", i: 1 })
      ] }] },
    { id: "cafe-flyer", preset: "flyer-a5", en: "Café flyer", el: "Φυλλάδιο καφέ", w: A5W, h: A5H, unit: "mm",
      pages: [{ bg: "#f5ebe0", items: [
        sh("drop", 150, 50, 120, 150, "#7f5539", { rot: 180 }),
        ic("coffee", 175, 95, 70, "#f5ebe0", { sw: 1.8 }),
        ctx(A5W, 225, 360, "The Little Café", "Το Καφεδάκι", { font: "serif", size: 40, b: 1, fc: "#7f5539" }),
        ctx(A5W, 290, 340, "Fresh coffee, homemade cakes and a quiet corner to read.", "Φρέσκος καφές, σπιτικά γλυκά και μια ήσυχη γωνιά για διάβασμα.", { font: "serif", i: 1, size: 15, fc: "#5e503f", lh: 140 }),
        sh("rounded", 90, 400, 240, 70, "#7f5539", { rd: 60 }),
        ctx(A5W, 418, 240, "Open daily 8:00–20:00", "Ανοιχτά καθημερινά 8:00–20:00", { size: 13, b: 1, fc: "#f5ebe0" }),
        ic("map-pin", 120, 510, 22, "#7f5539"),
        tx(150, 512, 220, "12 Harbour Street", "Οδός Λιμανιού 12", { size: 13, fc: "#5e503f" })
      ] }] },
    { id: "invite", preset: "invite", en: "Birthday invitation", el: "Πρόσκληση γενεθλίων", w: 127 * MM, h: 178 * MM, unit: "mm",
      pages: [{ bg: "#fff0f3", items: [
        ic("confetti", 30, 30, 60, "#ff4d6d"),
        ic("balloon", 270, 30, 60, "#ffb703"),
        ctx(127 * MM, 110, 300, "You're invited!", "Είσαι καλεσμένος!", { font: "serif", i: 1, size: 30, fc: "#c9184a", cv: 35 }),
        ctx(127 * MM, 200, 300, "Maria turns 30", "Η Μαρία κλείνει τα 30", { size: 26, b: 1, fc: "#590d22" }),
        ic("cake", 150, 250, 60, "#ff4d6d", { sw: 1.6 }),
        ctx(127 * MM, 335, 300, "Saturday 14 June, 19:00", "Σάββατο 14 Ιουνίου, 19:00", { size: 15, fc: "#590d22", b: 1 }),
        ctx(127 * MM, 362, 300, "Garden of the Blue House", "Στον κήπο του Γαλάζιου Σπιτιού", { size: 13, fc: "#800f2f" }),
        ctx(127 * MM, 430, 300, "RSVP 690 000 0000", "Επιβεβαίωση 690 000 0000", { size: 11, tr: 120, fc: "#a4133c" })
      ] }] },
    { id: "biz-card", preset: "card-biz", en: "Business card", el: "Επαγγελματική κάρτα", w: 85 * MM, h: 55 * MM, unit: "mm",
      pages: [{ bg: "#ffffff", items: [
        sh("rect", 0, 0, 14, 55 * MM, "#2a9d8f"),
        tx(30, 30, 200, "Eleni Papadopoulou", "Ελένη Παπαδοπούλου", { size: 14, b: 1, fc: "#264653" }),
        tx(30, 50, 200, "Graphic designer", "Γραφίστρια", { size: 9, fc: "#2a9d8f", tr: 80, caps: 1 }),
        ic("phone", 30, 92, 10, "#264653"), tx(46, 92, 180, "+30 690 000 0000", "+30 690 000 0000", { size: 8, fc: "#264653" }),
        ic("mail", 30, 108, 10, "#264653"), tx(46, 108, 180, "eleni@example.com", "eleni@example.com", { size: 8, fc: "#264653" }),
        ic("world", 30, 124, 10, "#264653"), tx(46, 124, 180, "example.com", "example.com", { size: 8, fc: "#264653" })
      ] }, { bg: "#264653", items: [
        ic("palette", 95, 45, 50, "#e9c46a", { sw: 1.6 }),
        ctx(85 * MM, 105, 200, "ELENI DESIGN", "ELENI DESIGN", { size: 12, b: 1, tr: 300, fc: "#ffffff" })
      ] }] },
    { id: "certificate", preset: "certificate", en: "Certificate", el: "Βεβαίωση", w: A4H, h: A4W, unit: "mm",
      pages: [{ bg: "#fffdf7", items: [
        sh("rect", 24, 24, A4H - 48, A4W - 48, "", { sc: "#b08d57", sw: 3 }),
        sh("rect", 34, 34, A4H - 68, A4W - 68, "", { sc: "#b08d57", sw: 1 }),
        ic("award", A4H / 2 - 35, 60, 70, "#b08d57", { sw: 1.5 }),
        ctx(A4H, 145, 600, "CERTIFICATE OF ACHIEVEMENT", "ΒΕΒΑΙΩΣΗ ΕΠΙΤΕΥΞΗΣ", { font: "serif", size: 28, b: 1, tr: 120, fc: "#3d3d3d" }),
        ctx(A4H, 205, 500, "This certificate is presented to", "Η βεβαίωση αυτή απονέμεται στον/στην", { font: "serif", i: 1, size: 14, fc: "#6b6b6b" }),
        ctx(A4H, 240, 600, "Name Surname", "Όνομα Επώνυμο", { font: "serif", size: 40, i: 1, fc: "#b08d57" }),
        ln(A4H / 2 - 180, 300, 360, 0, "#b08d57", 1),
        ctx(A4H, 320, 520, "for completing the course with excellence.", "για την άριστη ολοκλήρωση του προγράμματος.", { font: "serif", size: 14, fc: "#3d3d3d" }),
        ln(120, 470, 180, 0, "#3d3d3d", 0.8), tx(120, 478, 180, "Date", "Ημερομηνία", { al: "c", size: 11, fc: "#6b6b6b" }),
        ln(A4H - 300, 470, 180, 0, "#3d3d3d", 0.8), tx(A4H - 300, 478, 180, "Signature", "Υπογραφή", { al: "c", size: 11, fc: "#6b6b6b" })
      ] }] },
    { id: "menu", preset: "menu", en: "Taverna menu", el: "Μενού ταβέρνας", w: A4W, h: A4H, unit: "mm",
      pages: [{ bg: "#fdfcf8", items: [
        sh("rect", 0, 0, A4W, 150, "#1d3557"),
        ic("tools-kitchen-2", A4W / 2 - 22, 20, 44, "#f1faee"),
        ctx(A4W, 72, 500, "To Steki", "Το Στέκι", { font: "serif", size: 40, b: 1, fc: "#f1faee" }),
        tx(60, 190, 475, "STARTERS", "ΟΡΕΚΤΙΚΑ", { size: 16, b: 1, tr: 200, fc: "#e63946" }),
        tx(60, 220, 380, "Tzatziki\nFava with capers\nGrilled halloumi", "Τζατζίκι\nΦάβα με κάπαρη\nΧαλούμι σχάρας", { font: "serif", size: 14, fc: "#1d3557", lh: 170 }),
        tx(440, 220, 95, "4.50\n5.00\n6.50", "4,50\n5,00\n6,50", { font: "serif", size: 14, al: "r", fc: "#1d3557", lh: 170 }),
        tx(60, 340, 475, "MAINS", "ΚΥΡΙΩΣ", { size: 16, b: 1, tr: 200, fc: "#e63946" }),
        tx(60, 370, 380, "Moussaka\nGrilled octopus\nLamb with lemon potatoes\nGemista", "Μουσακάς\nΧταπόδι σχάρας\nΑρνί λεμονάτο με πατάτες\nΓεμιστά", { font: "serif", size: 14, fc: "#1d3557", lh: 170 }),
        tx(440, 370, 95, "11.00\n16.00\n14.50\n9.50", "11,00\n16,00\n14,50\n9,50", { font: "serif", size: 14, al: "r", fc: "#1d3557", lh: 170 }),
        tx(60, 510, 475, "DESSERTS", "ΓΛΥΚΑ", { size: 16, b: 1, tr: 200, fc: "#e63946" }),
        tx(60, 540, 380, "Yoghurt with honey\nGalaktoboureko", "Γιαούρτι με μέλι\nΓαλακτομπούρεκο", { font: "serif", size: 14, fc: "#1d3557", lh: 170 }),
        tx(440, 540, 95, "4.00\n5.50", "4,00\n5,50", { font: "serif", size: 14, al: "r", fc: "#1d3557", lh: 170 }),
        ln(60, 780, 475, 0, "#a8dadc", 1),
        ctx(A4W, 795, 475, "Kalí órexi!", "Καλή όρεξη!", { font: "serif", i: 1, size: 18, fc: "#457b9d" })
      ] }] },
    // ---------- Brand ----------
    { id: "logo-badge", preset: "logo", en: "Round logo", el: "Στρογγυλό λογότυπο", w: 500, h: 500, unit: "px",
      pages: [{ bg: "#ffffff", items: [
        sh("circle", 50, 50, 400, 400, "#2b2d42"),
        sh("circle", 75, 75, 350, 350, "", { sc: "#edf2f4", sw: 3 }),
        ic("leaf", 185, 165, 130, "#8ecae6", { sw: 1.6 }),
        ctx(500, 98, 300, "GREEN STUDIO", "GREEN STUDIO", { size: 34, b: 1, tr: 150, fc: "#edf2f4", cv: 45 }),
        ctx(500, 320, 260, "EST. 2026", "ΑΠΟ ΤΟ 2026", { size: 22, tr: 250, fc: "#8ecae6" })
      ] }] },
    { id: "banner", preset: "web-banner", en: "Web banner", el: "Banner ιστοσελίδας", w: 1920, h: 600, unit: "px",
      pages: [{ g: { a: "#0f2027", b: "#2c5364", ang: 0 }, items: [
        sh("hexagon", 1380, 80, 440, 440, "#00b4d8", { op: 35 }),
        sh("hexagon", 1500, 180, 260, 260, "#90e0ef", { op: 60 }),
        tx(140, 170, 1100, "Build something beautiful", "Φτιάξε κάτι όμορφο", { size: 96, b: 1, fc: "#ffffff" }),
        tx(140, 320, 1000, "Free and open tools that work offline.", "Ελεύθερα, ανοιχτά εργαλεία που δουλεύουν και χωρίς σύνδεση.", { size: 40, fc: "#90e0ef" }),
        sh("rounded", 140, 430, 360, 90, "#00b4d8", { rd: 100 }),
        tx(140, 452, 360, "Get started", "Ξεκίνα", { al: "c", size: 36, b: 1, fc: "#0f2027" })
      ] }] }
  ];

  var TEMPLATES = { list: LIST };
  if (typeof module !== "undefined" && module.exports) module.exports = TEMPLATES;
  else root.ATELIER_TEMPLATES = TEMPLATES;
})(this);
