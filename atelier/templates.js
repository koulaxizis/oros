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

  // tx(x, y, w, en, el, o) or tx(x, y, w, L(key), o)
  function tx(x, y, w, en, el, o) {
    if (en && typeof en === "object") { o = el; el = null; }
    var s = { k: "text", x: x, y: y, w: w, tx: el === null ? en : { en: en, el: el } };
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
    if (en && typeof en === "object") { o = el; el = null; }
    var p = { al: "c" };
    Object.keys(o || {}).forEach(function (k) { p[k] = o[k]; });
    return el === null ? tx((W - w) / 2, y, w, en, p) : tx((W - w) / 2, y, w, en, el, p);
  }

  var A4W = 210 * MM, A4H = 297 * MM, A5W = 148 * MM, A5H = 210 * MM;

  // ---------- Texts ----------
  // Every text of the templates, by key: "t.<id>" name, "t.<id>.tags"
  // search words, "t.<id>.<n>" text boxes, "tcat.<id>" categories. A pack
  // language (../i18n.js) adds its own; L(k) → { en, el (, <lang>) },
  // R(k) → table / chart rows (cells " | ", rows on lines).
  var I18N = typeof window !== "undefined" && window.orosI18n;
  var LANG = I18N ? I18N.lang() : "en";
  var PACK = LANG !== "en" && LANG !== "el" ? LANG : null;   // a pack language
  var SEP = " | ";
  function rowsOf(v) { return String(v).split("\n").map(function (r) { return r.split(SEP); }); }
  function sameShape(a, b) {
    return a.length === b.length && a.every(function (r, i) { return r.length === b[i].length; });
  }
  function strings(T) {
    if (I18N) I18N.table(T, "atelier", LANG);
    var P = PACK && T[PACK] ? T[PACK] : null;
    function L(k) {
      var o = { en: T.en[k], el: T.el[k] };
      if (P && P[k] != null) o[PACK] = P[k];
      return o;
    }
    function R(k) {
      var o = { en: rowsOf(T.en[k]), el: rowsOf(T.el[k]) };
      if (P && P[k] != null) { var r = rowsOf(P[k]); if (sameShape(r, o.en)) o[PACK] = r; }
      return o;
    }
    return { L: L, R: R };
  }
  var S = {
    en: {
      "t.quote": "Quote post",
      "t.sale": "Sale post",
      "t.event-story": "Event story",
      "t.announce": "Announcement",
      "t.thumb": "Video thumbnail",
      "t.slide-title": "Title slide",
      "t.poster": "Event poster",
      "t.cafe-flyer": "Café flyer",
      "t.invite": "Birthday invitation",
      "t.biz-card": "Business card",
      "t.certificate": "Certificate",
      "t.menu": "Taverna menu",
      "t.logo-badge": "Round logo",
      "t.banner": "Web banner",
      "t.quote.1": "The best way to predict the future is to create it.",
      "t.sale.1": "SUMMER",
      "t.sale.2": "SALE",
      "t.event-story.1": "LIVE MUSIC NIGHT",
      "t.event-story.2": "Friday 21:00 · Old Port",
      "t.event-story.3": "Free entry",
      "t.announce.1": "Big news!",
      "t.announce.2": "We are opening our new shop on 1 June. Come and celebrate with us.",
      "t.thumb.1": "10 TIPS",
      "t.thumb.2": "to work smarter",
      "t.slide-title.1": "Project title",
      "t.slide-title.2": "A short subtitle that says what this is about",
      "t.slide-title.3": "Your name · 2026",
      "t.poster.1": "SUMMER FESTIVAL",
      "t.poster.2": "Music · Food · Dance",
      "t.poster.3": "12–14 July · Central Square",
      "t.poster.4": "Free entry for everyone",
      "t.cafe-flyer.1": "The Little Café",
      "t.cafe-flyer.2": "Fresh coffee, homemade cakes and a quiet corner to read.",
      "t.cafe-flyer.3": "Open daily 8:00–20:00",
      "t.cafe-flyer.4": "12 Harbour Street",
      "t.invite.1": "You're invited!",
      "t.invite.2": "Maria turns 30",
      "t.invite.3": "Saturday 14 June, 19:00",
      "t.invite.4": "Garden of the Blue House",
      "t.invite.5": "RSVP 690 000 0000",
      "t.biz-card.1": "Eleni Papadopoulou",
      "t.biz-card.2": "Graphic designer",
      "t.certificate.1": "CERTIFICATE OF ACHIEVEMENT",
      "t.certificate.2": "This certificate is presented to",
      "t.certificate.3": "Name Surname",
      "t.certificate.4": "for completing the course with excellence.",
      "t.certificate.5": "Date",
      "t.certificate.6": "Signature",
      "t.menu.1": "To Steki",
      "t.menu.2": "STARTERS",
      "t.menu.3": "Tzatziki\nFava with capers\nGrilled halloumi",
      "t.menu.4": "4.50\n5.00\n6.50",
      "t.menu.5": "MAINS",
      "t.menu.6": "Moussaka\nGrilled octopus\nLamb with lemon potatoes\nGemista",
      "t.menu.7": "11.00\n16.00\n14.50\n9.50",
      "t.menu.8": "DESSERTS",
      "t.menu.9": "Yoghurt with honey\nGalaktoboureko",
      "t.menu.10": "4.00\n5.50",
      "t.menu.11": "Kalí órexi!",
      "t.logo-badge.1": "EST. 2026",
      "t.banner.1": "Build something beautiful",
      "t.banner.2": "Free and open tools that work offline.",
      "t.banner.3": "Get started",
      "tcat.social": "Social posts",
      "tcat.story": "Stories",
      "tcat.video": "Thumbnails",
      "tcat.pres": "Presentations",
      "tcat.poster": "Posters",
      "tcat.flyer": "Flyers",
      "tcat.biz": "Business cards",
      "tcat.invite": "Invitations & cards",
      "tcat.cv": "CVs",
      "tcat.cert": "Certificates",
      "tcat.menu": "Menus",
      "tcat.data": "Charts & tables",
      "tcat.brand": "Logos & banners",
      "t.quote.tags": "instagram inspiration motivation",
      "t.sale.tags": "discount offer shop instagram",
      "t.announce.tags": "facebook news opening shop",
      "t.event-story.tags": "instagram music concert party",
      "t.thumb.tags": "youtube video",
      "t.slide-title.tags": "slides deck cover",
      "t.poster.tags": "festival event summer",
      "t.cafe-flyer.tags": "coffee shop leaflet",
      "t.invite.tags": "birthday party",
      "t.biz-card.tags": "contact designer",
      "t.certificate.tags": "award diploma course",
      "t.menu.tags": "restaurant food taverna prices",
      "t.logo-badge.tags": "badge emblem",
      "t.banner.tags": "website header hero"
    },
    el: {
      "t.quote": "Ανάρτηση με απόφθεγμα",
      "t.sale": "Ανάρτηση προσφοράς",
      "t.event-story": "Story εκδήλωσης",
      "t.announce": "Ανακοίνωση",
      "t.thumb": "Μικρογραφία βίντεο",
      "t.slide-title": "Διαφάνεια τίτλου",
      "t.poster": "Αφίσα εκδήλωσης",
      "t.cafe-flyer": "Φυλλάδιο καφέ",
      "t.invite": "Πρόσκληση γενεθλίων",
      "t.biz-card": "Επαγγελματική κάρτα",
      "t.certificate": "Βεβαίωση",
      "t.menu": "Μενού ταβέρνας",
      "t.logo-badge": "Στρογγυλό λογότυπο",
      "t.banner": "Banner ιστοσελίδας",
      "t.quote.1": "Ο καλύτερος τρόπος να προβλέψεις το μέλλον είναι να το δημιουργήσεις.",
      "t.sale.1": "ΚΑΛΟΚΑΙΡΙΝΕΣ",
      "t.sale.2": "ΕΚΠΤΩΣΕΙΣ",
      "t.event-story.1": "ΒΡΑΔΙΑ ΖΩΝΤΑΝΗΣ ΜΟΥΣΙΚΗΣ",
      "t.event-story.2": "Παρασκευή 21:00 · Παλιό Λιμάνι",
      "t.event-story.3": "Ελεύθερη είσοδος",
      "t.announce.1": "Μεγάλα νέα!",
      "t.announce.2": "Ανοίγουμε το νέο μας κατάστημα την 1η Ιουνίου. Ελάτε να το γιορτάσουμε μαζί!",
      "t.thumb.1": "10 ΣΥΜΒΟΥΛΕΣ",
      "t.thumb.2": "για έξυπνη δουλειά",
      "t.slide-title.1": "Τίτλος έργου",
      "t.slide-title.2": "Ένας σύντομος υπότιτλος για το θέμα",
      "t.slide-title.3": "Το όνομά σου · 2026",
      "t.poster.1": "ΚΑΛΟΚΑΙΡΙΝΟ ΦΕΣΤΙΒΑΛ",
      "t.poster.2": "Μουσική · Φαγητό · Χορός",
      "t.poster.3": "12–14 Ιουλίου · Κεντρική Πλατεία",
      "t.poster.4": "Ελεύθερη είσοδος για όλους",
      "t.cafe-flyer.1": "Το Καφεδάκι",
      "t.cafe-flyer.2": "Φρέσκος καφές, σπιτικά γλυκά και μια ήσυχη γωνιά για διάβασμα.",
      "t.cafe-flyer.3": "Ανοιχτά καθημερινά 8:00–20:00",
      "t.cafe-flyer.4": "Οδός Λιμανιού 12",
      "t.invite.1": "Είσαι καλεσμένος!",
      "t.invite.2": "Η Μαρία κλείνει τα 30",
      "t.invite.3": "Σάββατο 14 Ιουνίου, 19:00",
      "t.invite.4": "Στον κήπο του Γαλάζιου Σπιτιού",
      "t.invite.5": "Επιβεβαίωση 690 000 0000",
      "t.biz-card.1": "Ελένη Παπαδοπούλου",
      "t.biz-card.2": "Γραφίστρια",
      "t.certificate.1": "ΒΕΒΑΙΩΣΗ ΕΠΙΤΕΥΞΗΣ",
      "t.certificate.2": "Η βεβαίωση αυτή απονέμεται στον/στην",
      "t.certificate.3": "Όνομα Επώνυμο",
      "t.certificate.4": "για την άριστη ολοκλήρωση του προγράμματος.",
      "t.certificate.5": "Ημερομηνία",
      "t.certificate.6": "Υπογραφή",
      "t.menu.1": "Το Στέκι",
      "t.menu.2": "ΟΡΕΚΤΙΚΑ",
      "t.menu.3": "Τζατζίκι\nΦάβα με κάπαρη\nΧαλούμι σχάρας",
      "t.menu.4": "4,50\n5,00\n6,50",
      "t.menu.5": "ΚΥΡΙΩΣ",
      "t.menu.6": "Μουσακάς\nΧταπόδι σχάρας\nΑρνί λεμονάτο με πατάτες\nΓεμιστά",
      "t.menu.7": "11,00\n16,00\n14,50\n9,50",
      "t.menu.8": "ΓΛΥΚΑ",
      "t.menu.9": "Γιαούρτι με μέλι\nΓαλακτομπούρεκο",
      "t.menu.10": "4,00\n5,50",
      "t.menu.11": "Καλή όρεξη!",
      "t.logo-badge.1": "ΑΠΟ ΤΟ 2026",
      "t.banner.1": "Φτιάξε κάτι όμορφο",
      "t.banner.2": "Ελεύθερα, ανοιχτά εργαλεία που δουλεύουν και χωρίς σύνδεση.",
      "t.banner.3": "Ξεκίνα",
      "tcat.social": "Αναρτήσεις",
      "tcat.story": "Stories",
      "tcat.video": "Μικρογραφίες",
      "tcat.pres": "Παρουσιάσεις",
      "tcat.poster": "Αφίσες",
      "tcat.flyer": "Φυλλάδια",
      "tcat.biz": "Επαγγελματικές κάρτες",
      "tcat.invite": "Προσκλήσεις & κάρτες",
      "tcat.cv": "Βιογραφικά",
      "tcat.cert": "Διπλώματα & βεβαιώσεις",
      "tcat.menu": "Μενού",
      "tcat.data": "Γραφήματα & πίνακες",
      "tcat.brand": "Λογότυπα & banner",
      "t.quote.tags": "instagram έμπνευση κίνητρο ρητό",
      "t.sale.tags": "έκπτωση προσφορά κατάστημα instagram",
      "t.announce.tags": "facebook νέα εγκαίνια κατάστημα",
      "t.event-story.tags": "instagram μουσική συναυλία πάρτι",
      "t.thumb.tags": "youtube βίντεο",
      "t.slide-title.tags": "διαφάνειες εξώφυλλο",
      "t.poster.tags": "φεστιβάλ εκδήλωση καλοκαίρι",
      "t.cafe-flyer.tags": "καφετέρια φέιγ βολάν",
      "t.invite.tags": "γενέθλια πάρτι",
      "t.biz-card.tags": "επικοινωνία γραφίστας",
      "t.certificate.tags": "βραβείο δίπλωμα σεμινάριο πιστοποιητικό",
      "t.menu.tags": "εστιατόριο φαγητό ταβέρνα τιμές",
      "t.logo-badge.tags": "σήμα έμβλημα",
      "t.banner.tags": "ιστοσελίδα κεφαλίδα"
    }
  };
  var L = strings(S).L;

  var LIST = [
    // ---------- Social ----------
    { id: "quote", preset: "ig-post", en: S.en["t.quote"], el: S.el["t.quote"], w: 1080, h: 1080, unit: "px",
      pages: [{ g: { a: "#1e3a5f", b: "#4a90a4", ang: 135 }, items: [
        ic("quote", 470, 150, 140, "#f4d35e", { sw: 1.5 }),
        ctx(1080, 340, 860, L("t.quote.1"),
          { font: "serif", i: 1, size: 64, fc: "#ffffff", lh: 125 }),
        ln(440, 760, 200, 0, "#f4d35e", 4),
        ctx(1080, 800, 700, "PETER DRUCKER", "PETER DRUCKER", { size: 30, tr: 200, fc: "#f4d35e", b: 1 })
      ] }] },
    { id: "sale", preset: "ig-post", en: S.en["t.sale"], el: S.el["t.sale"], w: 1080, h: 1080, unit: "px",
      pages: [{ bg: "#ffe8d6", items: [
        sh("circle", -180, -180, 620, 620, "#ff7b54", { op: 90 }),
        sh("circle", 760, 760, 480, 480, "#ffb26b", { op: 90 }),
        ctx(1080, 250, 900, L("t.sale.1"), { size: 120, b: 1, fc: "#3d2c8d", tr: 60 }),
        ctx(1080, 400, 900, L("t.sale.2"), { size: 150, b: 1, fc: "#3d2c8d", tfx: { type: "splice", color: "#ff7b54", off: 40 } }),
        sh("burst", 390, 610, 300, 300, "#3d2c8d"),
        ctx(1080, 705, 300, "-50%", "-50%", { size: 80, b: 1, fc: "#ffffff" }),
        ctx(1080, 960, 900, "shop.example.com", "shop.example.com", { size: 34, fc: "#3d2c8d" })
      ] }] },
    { id: "event-story", preset: "story", en: S.en["t.event-story"], el: S.el["t.event-story"], w: 1080, h: 1920, unit: "px",
      pages: [{ bg: "#14141f", items: [
        sh("arch", 140, 220, 800, 900, "#7b2cbf"),
        ic("music", 390, 420, 300, "#ffffff", { sw: 1.4 }),
        ctx(1080, 1180, 960, L("t.event-story.1"), { size: 92, b: 1, fc: "#e0aaff", tfx: { type: "neon", blur: 30 } }),
        ctx(1080, 1460, 900, L("t.event-story.2"), { size: 50, fc: "#c77dff" }),
        sh("rounded", 290, 1640, 500, 120, "#c77dff", { rd: 100 }),
        ctx(1080, 1672, 500, L("t.event-story.3"), { size: 44, b: 1, fc: "#14141f" })
      ] }] },
    { id: "announce", preset: "fb-post", en: S.en["t.announce"], el: S.el["t.announce"], w: 1200, h: 630, unit: "px",
      pages: [{ bg: "#fefae0", items: [
        sh("rect", 0, 0, 420, 630, "#283618"),
        ic("speakerphone", 110, 215, 200, "#fefae0", { sw: 1.5 }),
        tx(480, 140, 660, L("t.announce.1"), { size: 88, b: 1, fc: "#283618" }),
        tx(480, 280, 660, L("t.announce.2"),
          { size: 38, fc: "#606c38", lh: 135 })
      ] }] },
    // ---------- Video ----------
    { id: "thumb", preset: "yt-thumb", en: S.en["t.thumb"], el: S.el["t.thumb"], w: 1280, h: 720, unit: "px",
      pages: [{ g: { a: "#ff006e", b: "#fb5607", ang: 45 }, items: [
        sh("circle", 820, 120, 480, 480, "#ffbe0b"),
        ic("rocket", 920, 220, 280, "#3a0ca3", { sw: 1.6 }),
        tx(60, 140, 760, L("t.thumb.1"), { size: 130, b: 1, fc: "#ffffff", tfx: { type: "outline", color: "#3a0ca3", thick: 60 } }),
        tx(60, 330, 760, L("t.thumb.2"), { size: 72, b: 1, fc: "#ffbe0b", tfx: { type: "lift" } })
      ] }] },
    { id: "slide-title", preset: "slides", en: S.en["t.slide-title"], el: S.el["t.slide-title"], w: 1920, h: 1080, unit: "px",
      pages: [{ bg: "#f8f9fa", items: [
        sh("rect", 0, 820, 1920, 260, "#0b3954"),
        sh("rect", 160, 300, 16, 360, "#e63946"),
        tx(220, 290, 1400, L("t.slide-title.1"), { size: 120, b: 1, fc: "#0b3954" }),
        tx(220, 470, 1400, L("t.slide-title.2"), { size: 52, fc: "#495057" }),
        tx(220, 905, 1400, L("t.slide-title.3"), { size: 40, fc: "#ffffff" })
      ] }] },
    // ---------- Print ----------
    { id: "poster", preset: "poster-a4", en: S.en["t.poster"], el: S.el["t.poster"], w: A4W, h: A4H, unit: "mm",
      pages: [{ bg: "#003049", items: [
        sh("circle", 120, 90, 360, 360, "#fcbf49"),
        ic("sun", 200, 170, 200, "#d62828", { sw: 1.6 }),
        ctx(A4W, 480, 520, L("t.poster.1"), { size: 46, b: 1, fc: "#fcbf49", tr: 40 }),
        ctx(A4W, 590, 480, L("t.poster.2"), { size: 22, fc: "#eae2b7" }),
        ln(200, 650, 195, 0, "#fcbf49", 2),
        ctx(A4W, 680, 480, L("t.poster.3"), { size: 18, fc: "#ffffff", b: 1 }),
        ctx(A4W, 740, 480, L("t.poster.4"), { size: 14, fc: "#eae2b7", i: 1 })
      ] }] },
    { id: "cafe-flyer", preset: "flyer-a5", en: S.en["t.cafe-flyer"], el: S.el["t.cafe-flyer"], w: A5W, h: A5H, unit: "mm",
      pages: [{ bg: "#f5ebe0", items: [
        sh("drop", 150, 50, 120, 150, "#7f5539", { rot: 180 }),
        ic("coffee", 175, 95, 70, "#f5ebe0", { sw: 1.8 }),
        ctx(A5W, 225, 360, L("t.cafe-flyer.1"), { font: "serif", size: 40, b: 1, fc: "#7f5539" }),
        ctx(A5W, 290, 340, L("t.cafe-flyer.2"), { font: "serif", i: 1, size: 15, fc: "#5e503f", lh: 140 }),
        sh("rounded", 90, 400, 240, 70, "#7f5539", { rd: 60 }),
        ctx(A5W, 418, 240, L("t.cafe-flyer.3"), { size: 13, b: 1, fc: "#f5ebe0" }),
        ic("map-pin", 120, 510, 22, "#7f5539"),
        tx(150, 512, 220, L("t.cafe-flyer.4"), { size: 13, fc: "#5e503f" })
      ] }] },
    { id: "invite", preset: "invite", en: S.en["t.invite"], el: S.el["t.invite"], w: 127 * MM, h: 178 * MM, unit: "mm",
      pages: [{ bg: "#fff0f3", items: [
        ic("confetti", 30, 30, 60, "#ff4d6d"),
        ic("balloon", 270, 30, 60, "#ffb703"),
        ctx(127 * MM, 110, 300, L("t.invite.1"), { font: "serif", i: 1, size: 30, fc: "#c9184a", cv: 35 }),
        ctx(127 * MM, 200, 300, L("t.invite.2"), { size: 26, b: 1, fc: "#590d22" }),
        ic("cake", 150, 250, 60, "#ff4d6d", { sw: 1.6 }),
        ctx(127 * MM, 335, 300, L("t.invite.3"), { size: 15, fc: "#590d22", b: 1 }),
        ctx(127 * MM, 362, 300, L("t.invite.4"), { size: 13, fc: "#800f2f" }),
        ctx(127 * MM, 430, 300, L("t.invite.5"), { size: 11, tr: 120, fc: "#a4133c" })
      ] }] },
    { id: "biz-card", preset: "card-biz", en: S.en["t.biz-card"], el: S.el["t.biz-card"], w: 85 * MM, h: 55 * MM, unit: "mm",
      pages: [{ bg: "#ffffff", items: [
        sh("rect", 0, 0, 14, 55 * MM, "#2a9d8f"),
        tx(30, 30, 200, L("t.biz-card.1"), { size: 14, b: 1, fc: "#264653" }),
        tx(30, 50, 200, L("t.biz-card.2"), { size: 9, fc: "#2a9d8f", tr: 80, caps: 1 }),
        ic("phone", 30, 92, 10, "#264653"), tx(46, 92, 180, "+30 690 000 0000", "+30 690 000 0000", { size: 8, fc: "#264653" }),
        ic("mail", 30, 108, 10, "#264653"), tx(46, 108, 180, "eleni@example.com", "eleni@example.com", { size: 8, fc: "#264653" }),
        ic("world", 30, 124, 10, "#264653"), tx(46, 124, 180, "example.com", "example.com", { size: 8, fc: "#264653" })
      ] }, { bg: "#264653", items: [
        ic("palette", 95, 45, 50, "#e9c46a", { sw: 1.6 }),
        ctx(85 * MM, 105, 200, "ELENI DESIGN", "ELENI DESIGN", { size: 12, b: 1, tr: 300, fc: "#ffffff" })
      ] }] },
    { id: "certificate", preset: "certificate", en: S.en["t.certificate"], el: S.el["t.certificate"], w: A4H, h: A4W, unit: "mm",
      pages: [{ bg: "#fffdf7", items: [
        sh("rect", 24, 24, A4H - 48, A4W - 48, "", { sc: "#b08d57", sw: 3 }),
        sh("rect", 34, 34, A4H - 68, A4W - 68, "", { sc: "#b08d57", sw: 1 }),
        ic("award", A4H / 2 - 35, 60, 70, "#b08d57", { sw: 1.5 }),
        ctx(A4H, 145, 600, L("t.certificate.1"), { font: "serif", size: 28, b: 1, tr: 120, fc: "#3d3d3d" }),
        ctx(A4H, 205, 500, L("t.certificate.2"), { font: "serif", i: 1, size: 14, fc: "#6b6b6b" }),
        ctx(A4H, 240, 600, L("t.certificate.3"), { font: "serif", size: 40, i: 1, fc: "#b08d57" }),
        ln(A4H / 2 - 180, 300, 360, 0, "#b08d57", 1),
        ctx(A4H, 320, 520, L("t.certificate.4"), { font: "serif", size: 14, fc: "#3d3d3d" }),
        ln(120, 470, 180, 0, "#3d3d3d", 0.8), tx(120, 478, 180, L("t.certificate.5"), { al: "c", size: 11, fc: "#6b6b6b" }),
        ln(A4H - 300, 470, 180, 0, "#3d3d3d", 0.8), tx(A4H - 300, 478, 180, L("t.certificate.6"), { al: "c", size: 11, fc: "#6b6b6b" })
      ] }] },
    { id: "menu", preset: "menu", en: S.en["t.menu"], el: S.el["t.menu"], w: A4W, h: A4H, unit: "mm",
      pages: [{ bg: "#fdfcf8", items: [
        sh("rect", 0, 0, A4W, 150, "#1d3557"),
        ic("tools-kitchen-2", A4W / 2 - 22, 20, 44, "#f1faee"),
        ctx(A4W, 72, 500, L("t.menu.1"), { font: "serif", size: 40, b: 1, fc: "#f1faee" }),
        tx(60, 190, 475, L("t.menu.2"), { size: 16, b: 1, tr: 200, fc: "#e63946" }),
        tx(60, 220, 380, L("t.menu.3"), { font: "serif", size: 14, fc: "#1d3557", lh: 170 }),
        tx(440, 220, 95, L("t.menu.4"), { font: "serif", size: 14, al: "r", fc: "#1d3557", lh: 170 }),
        tx(60, 340, 475, L("t.menu.5"), { size: 16, b: 1, tr: 200, fc: "#e63946" }),
        tx(60, 370, 380, L("t.menu.6"), { font: "serif", size: 14, fc: "#1d3557", lh: 170 }),
        tx(440, 370, 95, L("t.menu.7"), { font: "serif", size: 14, al: "r", fc: "#1d3557", lh: 170 }),
        tx(60, 510, 475, L("t.menu.8"), { size: 16, b: 1, tr: 200, fc: "#e63946" }),
        tx(60, 540, 380, L("t.menu.9"), { font: "serif", size: 14, fc: "#1d3557", lh: 170 }),
        tx(440, 540, 95, L("t.menu.10"), { font: "serif", size: 14, al: "r", fc: "#1d3557", lh: 170 }),
        ln(60, 780, 475, 0, "#a8dadc", 1),
        ctx(A4W, 795, 475, L("t.menu.11"), { font: "serif", i: 1, size: 18, fc: "#457b9d" })
      ] }] },
    // ---------- Brand ----------
    { id: "logo-badge", preset: "logo", en: S.en["t.logo-badge"], el: S.el["t.logo-badge"], w: 500, h: 500, unit: "px",
      pages: [{ bg: "#ffffff", items: [
        sh("circle", 50, 50, 400, 400, "#2b2d42"),
        sh("circle", 75, 75, 350, 350, "", { sc: "#edf2f4", sw: 3 }),
        ic("leaf", 185, 165, 130, "#8ecae6", { sw: 1.6 }),
        ctx(500, 98, 300, "GREEN STUDIO", "GREEN STUDIO", { size: 34, b: 1, tr: 150, fc: "#edf2f4", cv: 45 }),
        ctx(500, 320, 260, L("t.logo-badge.1"), { size: 22, tr: 250, fc: "#8ecae6" })
      ] }] },
    { id: "banner", preset: "web-banner", en: S.en["t.banner"], el: S.el["t.banner"], w: 1920, h: 600, unit: "px",
      pages: [{ g: { a: "#0f2027", b: "#2c5364", ang: 0 }, items: [
        sh("hexagon", 1380, 80, 440, 440, "#00b4d8", { op: 35 }),
        sh("hexagon", 1500, 180, 260, 260, "#90e0ef", { op: 60 }),
        tx(140, 170, 1100, L("t.banner.1"), { size: 96, b: 1, fc: "#ffffff" }),
        tx(140, 320, 1000, L("t.banner.2"), { size: 40, fc: "#90e0ef" }),
        sh("rounded", 140, 430, 360, 90, "#00b4d8", { rd: 100 }),
        tx(140, 452, 360, L("t.banner.3"), { al: "c", size: 36, b: 1, fc: "#0f2027" })
      ] }] }
  ];

  // ---------- Library: categories + search ----------
  // [id, EN, EL] in display order (+ row[<lang>] for a pack language,
  // core.js AT.lbl3). Every template has one `cat`; `tags` { en, el }
  // are extra words for the search.
  var CATS = ["social", "story", "video", "pres", "poster", "flyer", "biz", "invite", "cv", "cert", "menu", "data", "brand"].map(function (id) {
    var o = L("tcat." + id), row = [id, o.en, o.el];
    if (PACK && o[PACK] != null) row[PACK] = o[PACK];
    return row;
  });
  var CAT_OF = {
    quote: "social", sale: "social", announce: "social", "event-story": "story", thumb: "video",
    "slide-title": "pres", poster: "poster", "cafe-flyer": "flyer", invite: "invite", "biz-card": "biz",
    certificate: "cert", menu: "menu", "logo-badge": "brand", banner: "brand"
  };
  LIST.forEach(function (tpl) {
    if (!tpl.cat) tpl.cat = CAT_OF[tpl.id] || "social";
    if (!tpl.tags && S.en["t." + tpl.id + ".tags"]) tpl.tags = L("t." + tpl.id + ".tags");
    if (PACK) tpl[PACK] = L("t." + tpl.id)[PACK];
  });

  // Case and accent free text for search ("Αφίσα" finds "αφισα").
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ς/g, "σ");
  }
  function catOf(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === id) return CATS[i];
    return null;
  }
  // Templates of a category ("" = all) whose names, category or tags
  // (English and Greek) hold every word of q, in list order.
  function match(list, cat, q) {
    var words = fold(q).split(/\s+/).filter(Boolean);
    return list.filter(function (tpl) {
      if (cat && tpl.cat !== cat) return false;
      if (!words.length) return true;
      var c = catOf(tpl.cat) || [];
      var pk = PACK || "en";   // a pack language's words too
      var hay = fold([tpl.en, tpl.el, tpl[pk], c[1], c[2], c[pk], tpl.tags ? tpl.tags.en : "", tpl.tags ? tpl.tags.el : "",
        tpl.tags ? tpl.tags[pk] : "", tpl.preset].join(" "));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }
  // Categories that have templates, in display order.
  function usedCats(list) {
    var has = {};
    list.forEach(function (tpl) { has[tpl.cat] = 1; });
    return CATS.filter(function (c) { return has[c[0]]; });
  }

  // The whole library as a sampler: one of each category in turn
  // (category order), so the first rows show every kind.
  function mix(list) {
    var by = {}, out = [];
    list.forEach(function (tpl) { (by[tpl.cat] = by[tpl.cat] || []).push(tpl); });
    var cats = usedCats(list).map(function (c) { return c[0]; });
    for (var i = 0; out.length < list.length; i++) {
      cats.forEach(function (c) { if (by[c][i]) out.push(by[c][i]); });
    }
    return out;
  }

  var TEMPLATES = {
    list: LIST, CATS: CATS, match: match, fold: fold, usedCats: usedCats, mix: mix,
    // building blocks for more template files (templates-more.js)
    h: { tx: tx, sh: sh, ic: ic, ln: ln, ctx: ctx, MM: MM, A4W: A4W, A4H: A4H, A5W: A5W, A5H: A5H, strings: strings, PACK: PACK }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = TEMPLATES;
  else root.ATELIER_TEMPLATES = TEMPLATES;
})(this);
