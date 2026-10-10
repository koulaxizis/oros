// ============================================================
// designkit/templates.js: starter documents for Layout
// (owner: Layout). Each template builds a normal document (model
// v1) with its own styles, frames and placeholder text in the
// user's language; images are empty frames to fill with Place.
// Exposes orosDK.templates (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var M;
  if (typeof module !== "undefined" && module.exports) M = require("./model.js");
  else M = root.orosDK.model;

  var MM = 72 / 25.4;

  // Placeholder copy, {en, el}.
  var TX = {
    lorem: {
      en: "Start typing here. Every frame of this template is yours to change: open the Story Editor, pick a paragraph style and the text reflows on its own across the threaded frames.",
      el: "Γράψε εδώ. Κάθε πλαίσιο του προτύπου αλλάζει όπως θέλεις: άνοιξε τον επεξεργαστή κειμένου, διάλεξε στυλ παραγράφου και το κείμενο ξαναρέει μόνο του στα συνδεδεμένα πλαίσια."
    },
    lorem2: {
      en: "Keep paragraphs short and let the headings guide the eye. Swap the empty image frames for your own photos with Place image; the preflight badge in the status bar tells you when an image is too small for print.",
      el: "Κράτα τις παραγράφους σύντομες και άφησε τους τίτλους να οδηγούν το μάτι. Βάλε τις δικές σου φωτογραφίες στα άδεια πλαίσια εικόνας με «Τοποθέτηση εικόνας»· ο προέλεγχος στη γραμμή κατάστασης σού λέει πότε μια εικόνα είναι μικρή για εκτύπωση."
    },
    event: { en: "Summer Festival", el: "Καλοκαιρινό Φεστιβάλ" },
    eventSub: { en: "Music · Food · Friends", el: "Μουσική · Φαγητό · Φίλοι" },
    when: { en: "Saturday 12 July · 19:00 · Central Square", el: "Σάββατο 12 Ιουλίου · 19:00 · Κεντρική Πλατεία" },
    free: { en: "Free entry", el: "Ελεύθερη είσοδος" },
    news: { en: "The Neighbourhood News", el: "Τα Νέα της Γειτονιάς" },
    issue: { en: "Issue 1 · Autumn", el: "Τεύχος 1 · Φθινόπωρο" },
    story1: { en: "A new park for everyone", el: "Ένα νέο πάρκο για όλους" },
    caption: { en: "Caption: who, what, where.", el: "Λεζάντα: ποιος, τι, πού." },
    name: { en: "Alex Papadopoulos", el: "Αλέξης Παπαδόπουλος" },
    role: { en: "Graphic Designer", el: "Γραφίστας" },
    contact: { en: "+30 210 000 0000\nalex@example.com\nexample.com", el: "+30 210 000 0000\nalex@example.com\nexample.com" },
    poster: { en: "The Big Exhibition", el: "Η Μεγάλη Έκθεση" },
    posterSub: { en: "Paintings, prints and photographs by local artists", el: "Ζωγραφική, χαρακτική και φωτογραφία από τοπικούς καλλιτέχνες" },
    posterWhen: { en: "1–30 June\nTown Hall Gallery\nOpen daily 10:00–20:00", el: "1–30 Ιουνίου\nΠινακοθήκη Δημαρχείου\nΚαθημερινά 10:00–20:00" },
    tri: [
      { en: "Inside flap", el: "Εσωτερικό πτερύγιο" },
      { en: "Back cover", el: "Οπισθόφυλλο" },
      { en: "Our Studio", el: "Το Εργαστήριό μας" },
      { en: "Who we are", el: "Ποιοι είμαστε" },
      { en: "What we do", el: "Τι κάνουμε" },
      { en: "Find us", el: "Βρες μας" }
    ],
    post: { en: "Big news!", el: "Μεγάλα νέα!" },
    postSub: { en: "Something new is coming. Stay tuned.", el: "Έρχεται κάτι καινούργιο. Μείνε συντονισμένος." },
    handle: { en: "@yourname", el: "@toonomasou" },
    book: { en: "My Booklet", el: "Το Βιβλιαράκι μου" },
    author: { en: "Author name", el: "Όνομα συγγραφέα" },
    chapter: { en: "Chapter One", el: "Κεφάλαιο Πρώτο" }
  };

  // ---------- builder ----------
  function Doc(setup, name, now, opts) {
    var doc = M.newDoc({
      name: name, w: setup.w, h: setup.h, unit: setup.unit || "mm", bleed: setup.bleed, mt: setup.mt, mb: setup.mb,
      mi: setup.mi, mo: setup.mo, cols: setup.cols || 1, gut: setup.gut, facing: setup.facing, preset: setup.preset, pages: setup.pages
    }, now);
    this.doc = doc; this.now = now; this.z = 0; this.lang = opts.lang;
    this.pages = M.pagesInOrder(doc);
  }
  Doc.prototype.tx = function (k) { return k[this.lang === "el" ? "el" : "en"]; };
  Doc.prototype.base = function (pg, t, x, y, w, h, extra) {
    var it = { id: M.newId("it"), m: this.now, t: t, pg: pg, x: x, y: y, w: w, h: h, z: ++this.z * 1024 };
    Object.keys(extra || {}).forEach(function (k) { it[k] = extra[k]; });
    this.doc.items.push(it);
    return it;
  };
  Doc.prototype.rect = function (pg, x, y, w, h, fill, extra) {
    extra = extra || {}; extra.fill = fill; extra.sw = 0;
    return this.base(pg, "rect", x, y, w, h, extra);
  };
  Doc.prototype.img = function (pg, x, y, w, h, extra) { return this.base(pg, "img", x, y, w, h, extra); };
  // paras: [[styleId, text or [runs]], ...]; returns the frame.
  Doc.prototype.text = function (pg, x, y, w, h, paras, extra) {
    var st = { id: M.newId("st"), m: this.now, h: [], paras: [] }, self = this;
    paras.forEach(function (p) {
      var c = p[1];
      if (Array.isArray(c)) { st.paras.push({ ps: p[0], runs: c }); return; }
      String(typeof c === "object" ? self.tx(c) : c).split("\n").forEach(function (line) {
        st.paras.push({ ps: p[0], runs: [{ t: line }] });
      });
    });
    this.doc.stories.push(st);
    extra = extra || {}; extra.story = st.id; extra.seq = 1024;
    return this.base(pg, "text", x, y, w, h, extra);
  };
  // A second frame in the same thread.
  Doc.prototype.cont = function (prev, pg, x, y, w, h, extra) {
    extra = extra || {}; extra.story = prev.story; extra.seq = prev.seq + 1024;
    return this.base(pg, "text", x, y, w, h, extra);
  };
  Doc.prototype.style = function (id, name, props) {
    var s = { id: id, m: this.now, name: name };
    Object.keys(props).forEach(function (k) { s[k] = props[k]; });
    this.doc.pstyles.push(s);
  };
  Doc.prototype.swatch = function (id, name, v) {
    this.doc.swatches.push({ id: id, m: this.now, name: name, mode: "cmyk", v: v });
  };
  Doc.prototype.done = function () { return M.normDoc(this.doc); };

  function nm(en, el) { return { en: en, el: el }; }

  // ---------- the templates ----------
  var LIST = [
    { id: "flyer", name: nm("A5 flyer", "Φέιγ βολάν A5"), build: function (o) {
      var a5 = M.preset("a5"), b = 3 * MM;
      var D = new Doc({ w: a5.w, h: a5.h, bleed: b, mt: 12 * MM, mb: 12 * MM, mi: 12 * MM, mo: 12 * MM, preset: "a5" }, o.name, o.now, o);
      D.swatch("sw-acc", nm("Accent", "Έμφαση"), [0, 70, 90, 0]);
      D.style("ps-disp", nm("Display", "Προβολή"), { base: "ps-h1", size: 32, lead: 34, color: "sw-paper", sa: 4 });
      D.style("ps-lead", nm("Lead", "Εισαγωγή"), { base: "ps-base", font: "sans", size: 14, lead: 18, color: "sw-paper" });
      D.style("ps-small", nm("Flyer text", "Κείμενο φέιγ βολάν"), { base: "ps-lead", size: 10.5, lead: 14 });
      var W = a5.w, H = a5.h, m = 12 * MM, pg = D.pages[0].id;
      D.img(pg, -b, -b, W + 2 * b, H * 0.5 + b);
      D.rect(pg, -b, H * 0.5, W + 2 * b, H * 0.5 + b, "sw-acc");
      D.text(pg, m, H * 0.5 + m, W - 2 * m, 100, [["ps-disp", TX.event], ["ps-lead", TX.eventSub]]);
      D.text(pg, m, H * 0.5 + m + 104, W - 2 * m, H * 0.5 - 2 * m - 144, [["ps-small", TX.lorem]]);
      D.text(pg, m, H - m - 36, W - 2 * m, 36, [["ps-lead", [{ t: D.tx(TX.when), b: 1 }]]]);
      return D.done();
    } },
    { id: "newsletter", name: nm("A4 newsletter, 3 columns", "Ενημερωτικό A4, 3 στήλες"), build: function (o) {
      var a4 = M.preset("a4"), m = 15 * MM, g = 5 * MM;
      var D = new Doc({ w: a4.w, h: a4.h, bleed: 3 * MM, mt: m, mb: m, mi: m, mo: m, cols: 3, gut: g, preset: "a4", pages: 2 }, o.name, o.now, o);
      D.style("ps-mast", nm("Masthead", "Τίτλος εντύπου"), { base: "ps-h1", font: "serif", size: 34, lead: 38, sa: 2 });
      D.style("ps-kick", nm("Issue line", "Γραμμή τεύχους"), { base: "ps-base", font: "sans", size: 9, lead: 12, caps: 1, track: 80, color: "sw-gray" });
      var W = a4.w, H = a4.h, cw = (W - 2 * m - 2 * g) / 3;
      D.text("ms-a", m, H - m + 12, W - 2 * m, 14, [["ps-cap", [{ t: D.tx(TX.news) + " · " }, { f: "pn" }]]], { va: "b" });
      var p1 = D.pages[0].id, p2 = D.pages[1].id;
      D.text(p1, m, m, W - 2 * m, 60, [["ps-mast", TX.news], ["ps-kick", TX.issue]]);
      D.base(p1, "line", m, m + 66, W - 2 * m, 0, { stroke: "sw-black", sw: 1.5 });
      var top = m + 80;
      D.img(p1, m, top, cw * 2 + g, 200, { wrap: "box", wo: 8 });
      D.text(p1, m, top + 212, cw * 2 + g, 18, [["ps-cap", TX.caption]], { wrap: "box", wo: 6 });
      var body = [["ps-h2", TX.story1]];
      for (var i = 0; i < 6; i++) body.push(["ps-body", i % 2 ? TX.lorem2 : TX.lorem]);
      var f1 = D.text(p1, m, top, W - 2 * m, H - top - m, body, { cols: 3, gut: g });
      D.cont(f1, p2, m, m, W - 2 * m, H - 2 * m, { cols: 3, gut: g });
      return D.done();
    } },
    { id: "card", name: nm("Business card", "Επαγγελματική κάρτα"), build: function (o) {
      var c = M.preset("card"), m = 5 * MM, b = 2 * MM;
      var D = new Doc({ w: c.w, h: c.h, bleed: b, mt: m, mb: m, mi: m, mo: m, preset: "card", pages: 2 }, o.name, o.now, o);
      D.style("ps-name", nm("Name", "Όνομα"), { base: "ps-h1", size: 13, lead: 15, sa: 1 });
      D.style("ps-role", nm("Role", "Ιδιότητα"), { base: "ps-base", font: "sans", size: 7.5, lead: 9, color: "sw-blue", sa: 6 });
      D.style("ps-info", nm("Contact", "Επικοινωνία"), { base: "ps-base", font: "sans", size: 7, lead: 9 });
      D.style("ps-logo", nm("Logo", "Λογότυπο"), { base: "ps-h1", size: 18, lead: 20, align: "c", color: "sw-paper" });
      var W = c.w, H = c.h, p1 = D.pages[0].id, p2 = D.pages[1].id;
      D.rect(p1, -b, -b, 4 * MM + b, H + 2 * b, "sw-blue");
      D.text(p1, m + 4 * MM, m, W - 2 * m - 4 * MM, 30, [["ps-name", TX.name], ["ps-role", TX.role]]);
      D.text(p1, m + 4 * MM, H - m - 30, W - 2 * m - 4 * MM, 30, [["ps-info", TX.contact]], { va: "b" });
      D.rect(p2, -b, -b, W + 2 * b, H + 2 * b, "sw-blue");
      D.text(p2, m, m, W - 2 * m, H - 2 * m, [["ps-logo", TX.name]], { va: "c" });
      return D.done();
    } },
    { id: "poster", name: nm("A3 poster", "Αφίσα A3"), build: function (o) {
      var a3 = M.preset("a3"), m = 20 * MM, b = 3 * MM;
      var D = new Doc({ w: a3.w, h: a3.h, bleed: b, mt: m, mb: m, mi: m, mo: m, preset: "a3" }, o.name, o.now, o);
      D.style("ps-huge", nm("Poster title", "Τίτλος αφίσας"), { base: "ps-h1", size: 72, lead: 74, sa: 12 });
      D.style("ps-sub", nm("Poster subtitle", "Υπότιτλος αφίσας"), { base: "ps-base", font: "sans", size: 20, lead: 26 });
      D.style("ps-info", nm("Details", "Λεπτομέρειες"), { base: "ps-base", font: "sans", b: 1, size: 18, lead: 24, align: "r" });
      var W = a3.w, H = a3.h, pg = D.pages[0].id;
      D.rect(pg, -b, -b, W + 2 * b, H + 2 * b, "sw-yellow");
      D.img(pg, m, m, W - 2 * m, H * 0.55);
      D.text(pg, m, m + H * 0.55 + 20, W - 2 * m, 170, [["ps-huge", TX.poster], ["ps-sub", TX.posterSub]]);
      D.text(pg, m, H - m - 80, W - 2 * m, 80, [["ps-info", TX.posterWhen]], { va: "b" });
      return D.done();
    } },
    { id: "trifold", name: nm("A4 trifold brochure", "Τρίπτυχο A4"), build: function (o) {
      var a4 = M.preset("a4"), m = 10 * MM, g = 2 * m, b = 3 * MM;
      var W = a4.h, H = a4.w;
      var D = new Doc({ w: W, h: H, bleed: b, mt: m, mb: m, mi: m, mo: m, cols: 3, gut: g, preset: "a4", pages: 2 }, o.name, o.now, o);
      var pw = (W - 2 * m - 2 * g) / 3;
      D.doc.guides.push({ id: M.newId("gd"), m: o.now, pg: "ms-a", o: "v", p: W / 3 });
      D.doc.guides.push({ id: M.newId("gd"), m: o.now, pg: "ms-a", o: "v", p: 2 * W / 3 });
      D.style("ps-cover", nm("Cover title", "Τίτλος εξωφύλλου"), { base: "ps-h1", size: 26, lead: 30, color: "sw-paper" });
      [D.pages[0].id, D.pages[1].id].forEach(function (pg, side) {
        for (var k = 0; k < 3; k++) {
          var x = m + k * (pw + g), n = side * 3 + k;
          if (side === 0 && k === 2) {
            D.rect(pg, W * 2 / 3, -b, W / 3 + b, H + 2 * b, "sw-blue");
            D.img(pg, x, m, pw, H * 0.45);
            D.text(pg, x, m + H * 0.45 + 12, pw, H * 0.55 - 2 * m - 12, [["ps-cover", TX.tri[2]], ["ps-lead", TX.eventSub]]);
            continue;
          }
          D.text(pg, x, m, pw, H - 2 * m, [["ps-h2", TX.tri[n]], ["ps-body", TX.lorem], ["ps-body", TX.lorem2]]);
        }
      });
      D.style("ps-lead", nm("Lead", "Εισαγωγή"), { base: "ps-base", font: "sans", size: 12, lead: 16, color: "sw-paper" });
      return D.done();
    } },
    { id: "post", name: nm("Social post 1080 × 1080", "Ανάρτηση 1080 × 1080"), build: function (o) {
      var s = M.preset("square"), m = 72;
      var D = new Doc({ w: s.w, h: s.h, unit: "pt", bleed: 0, mt: m, mb: m, mi: m, mo: m, preset: "square" }, o.name, o.now, o);
      D.swatch("sw-acc", nm("Accent", "Έμφαση"), [70, 0, 30, 0]);
      D.style("ps-big", nm("Headline", "Κεντρικός τίτλος"), { base: "ps-h1", size: 120, lead: 120, color: "sw-paper", sa: 24 });
      D.style("ps-sub", nm("Subline", "Υπότιτλος"), { base: "ps-base", font: "sans", size: 44, lead: 54, color: "sw-paper" });
      D.style("ps-tag", nm("Handle", "Λογαριασμός"), { base: "ps-base", font: "sans", b: 1, size: 32, lead: 36, color: "sw-paper", align: "r" });
      var W = s.w, H = s.h, pg = D.pages[0].id;
      D.rect(pg, 0, 0, W, H, "sw-acc");
      D.rect(pg, m, m, 120, 16, "sw-paper");
      D.text(pg, m, m + 60, W - 2 * m, H - 2 * m - 160, [["ps-big", TX.post], ["ps-sub", TX.postSub]], { va: "c" });
      D.text(pg, m, H - m - 56, W - 2 * m, 56, [["ps-tag", TX.handle]], { va: "b" });
      return D.done();
    } },
    { id: "booklet", name: nm("A5 booklet with master pages", "Βιβλιαράκι A5 με master"), build: function (o) {
      var a5 = M.preset("a5"), m = 15 * MM, mi = 18 * MM;
      var D = new Doc({ w: a5.w, h: a5.h, bleed: 3 * MM, mt: m, mb: m + 6, mi: mi, mo: m, facing: 1, preset: "a5", pages: 8 }, o.name, o.now, o);
      D.style("ps-title", nm("Book title", "Τίτλος βιβλίου"), { base: "ps-h1", font: "serif", size: 30, lead: 34, align: "c", sa: 12 });
      D.style("ps-auth", nm("Author", "Συγγραφέας"), { base: "ps-base", font: "sans", size: 12, lead: 16, align: "c", caps: 1, track: 60 });
      D.style("ps-folio", nm("Folio", "Αρίθμηση"), { base: "ps-cap", i: 0, align: "c" });
      var W = a5.w, H = a5.h;
      // master A: page number on both sides, running head
      ["L", "R"].forEach(function (sd) {
        var l = sd === "L" ? m : mi;
        D.text("ms-a", l, H - m + 4, W - m - mi, 12, [["ps-folio", [{ f: "pn" }]]], { side: sd });
        D.text("ms-a", l, m - 22, W - m - mi, 12, [["ps-folio", TX.book]], { side: sd });
      });
      var pages = D.pages;
      // the cover has no master
      pages[0].ms = "";
      D.text(pages[0].id, mi, H * 0.3, W - m - mi, 120, [["ps-title", TX.book], ["ps-auth", TX.author]]);
      var prev = null;
      for (var i = 1; i < pages.length; i++) {
        var sd = M.sideOf(D.doc, i), x = sd === "L" ? m : mi;
        if (!prev) {
          var paras = [["ps-h1", TX.chapter]];
          for (var k = 0; k < 14; k++) paras.push(["ps-body", k % 2 ? TX.lorem2 : TX.lorem]);
          prev = D.text(pages[i].id, x, m, W - m - mi, H - 2 * m - 6, paras);
        } else prev = D.cont(prev, pages[i].id, x, m, W - m - mi, H - 2 * m - 6);
      }
      return D.done();
    } }
  ];

  // opts: { lang "en"|"el", now, name }
  function build(id, opts) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) {
      var o = { lang: opts.lang === "el" ? "el" : "en", now: opts.now, name: opts.name || M.label(LIST[i].name, opts.lang) };
      return LIST[i].build(o);
    }
    return null;
  }

  var api = { LIST: LIST.map(function (t) { return { id: t.id, name: t.name }; }), build: build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.templates = api; }
})(typeof window !== "undefined" ? window : this);
