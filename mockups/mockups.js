// ============================================================
// orOS Mockups — App logic (v1.0.0)
// 3D book mockups: give the book's size, pages, paper and binding
// (paperback or hardcover, flaps / dust jacket, rounded spine,
// headband, ribbon), add the cover (front, back, spine, flaps or one
// full wrap), turn the camera, set placement, background and light,
// and save the picture (PNG / JPG / WebP, to the device, to
// Pictures, or into a new Atelier design).
// Data: synced slice "mockups" (oros-mockups-data, core.js);
// pictures on the orOS disk through designkit/assets.js (R30);
// project thumbnails cached on this device only (IndexedDB
// "oros-mockups-thumbs", never synced, rebuilt when missing).
// The 3D part (scene.js + vendor/three) is imported when the editor
// opens.
// Sections:
//   1. Constants, i18n, helpers
//   2. State + storage
//   3. Thumbnails (IndexedDB) + home
//   4. Stage (3D view), pictures, camera drag
//   5. The form (book, cover, scene, save)
//   6. Save the picture, Pictures, Atelier
//   7. Dialogs: more, ask
//   8. Sync slice, palette, deep link
//   9. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.MockCore;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app.name": "Mockups", "btn.new": "New mockup", "btn.more": "More", "btn.back": "All mockups",
      "empty": "No mockup yet. Make a 3D picture of your book: give its size and pages, add the cover, pick the angle and the background, and save it.",
      "btn.first": "Make a book mockup",
      "tab.book": "Book", "tab.cover": "Cover", "tab.scene": "Scene", "tab.out": "Save",
      "f.bind": "Binding", "bind.pb": "Paperback", "bind.hc": "Hardcover",
      "f.trim": "Size", "trim.custom": "My own size", "f.w": "Width", "f.h": "Height", "f.unit": "Unit", "unit.in": "inches",
      "f.pages": "Pages", "f.paper": "Paper", "f.cal": "One page (mm)",
      "paper.white": "White 80 g", "paper.cream": "Cream 90 g", "paper.color": "Colour pages", "paper.coated": "Coated (photo book)",
      "paper.bulky": "Thick, bulky", "paper.custom": "My own thickness",
      "f.spineIs": "Spine:", "spine.from": "{pages} pages × {cal} mm", "spine.hand": "typed by hand",
      "spine.block": "pages {b}", "f.spineOn": "Set the spine width by hand", "f.spine": "Spine width (mm)",
      "f.flaps": "Flaps (French flaps)", "f.flapsHc": "Dust jacket with flaps", "f.flapW": "Flap width",
      "f.round": "Rounded spine", "f.band": "Headband", "f.ribbon": "Ribbon bookmark",
      "aria.bandC": "Headband colour", "aria.ribC": "Ribbon colour",
      "f.cloth": "Cover under the jacket", "f.fin": "Finish", "fin.matte": "Matte", "fin.gloss": "Gloss", "fin.soft": "Soft-touch",
      "f.edge": "Page edges", "edge.white": "White", "edge.cream": "Cream", "edge.color": "Coloured (sprayed)",
      "f.edgeC": "Edge colour", "f.inC": "Inside of the cover",
      "f.mode": "Cover pictures", "mode.parts": "Front, back, spine", "mode.wrap": "One full wrap",
      "slot.front": "Front cover", "slot.back": "Back cover", "slot.spine": "Spine", "slot.flapF": "Front flap", "slot.flapB": "Back flap",
      "slot.wrap": "Full wrap (back + spine + front)", "slot.none": "No picture", "slot.missing": "Not on this device yet",
      "btn.choose": "Choose a picture", "btn.remove": "Remove",
      "wrap.info": "Make the wrap {w} × {h} mm, bleed included. From the left: {parts}.",
      "wrap.part": "{name} {mm} mm", "wrap.bleed": "bleed {mm} mm",
      "f.bleed": "Bleed around the wrap (mm)",
      "f.coverC": "Colour where there is no picture", "f.spTC": "Spine text colour", "f.spT": "Spine text (when there is no spine picture)",
      "cover.atelier": "Made your cover in Atelier? There, open More › Make a book mockup, and it comes here with its pages.",
      "f.place": "Placement", "place.stand": "Standing", "place.lie": "Lying", "place.lean": "Leaning",
      "f.turn": "Turn", "f.open": "Open the cover",
      "sec.cam": "Camera", "cam.hint": "Drag the picture to turn around the book; pinch or use the wheel to come closer.",
      "f.fov": "Perspective", "f.zoom": "Size in the picture", "f.dx": "Move left / right", "f.dy": "Move up / down",
      "view.front": "Front", "view.q1": "¾ spine side", "view.q2": "¾ page side", "view.spine": "Spine", "view.back": "Back",
      "view.top": "From above", "view.low": "Low angle",
      "sec.bg": "Background", "bg.none": "See-through", "bg.solid": "Colour", "bg.grad": "Gradient", "bg.photo": "Photo",
      "f.c1": "Colour", "f.c2": "Second colour", "f.ang": "Direction", "f.shadow": "Shadow", "aria.swatch": "Background {n}",
      "sec.light": "Light", "f.az": "From where", "f.el": "Height", "f.str": "Strength", "f.soft": "Softness", "f.warm": "Cool / warm",
      "f.nm": "Name of this mockup", "f.ratio": "Picture shape", "f.size": "Size", "f.fmt": "Format",
      "size.px": "{n} px (long side)",
      "out.info": "{w} × {h} px.", "out.clear": "The background stays see-through (PNG and WebP).",
      "out.jpgclear": "JPG has no see-through: the background turns white.", "out.max": "This device draws at most {n} px; the picture is made smaller.",
      "btn.save": "Save picture", "btn.pics": "Save to Pictures", "btn.atelier": "Open in Atelier",
      "more.title": "Mockup", "btn.dup": "Duplicate this mockup", "btn.resetCam": "Reset the camera and light", "btn.del": "Delete this mockup",
      "more.hint": "Your mockups follow you to every device through orOS sync, encrypted. Their pictures travel with your orOS disk.",
      "btn.cancel": "Cancel", "btn.delete": "Delete", "btn.close": "Close",
      "ask.del": "Delete the mockup \"{name}\"? This removes it from all your devices.",
      "untitled": "Book mockup", "copyOf": "(copy)", "sub.book": "{w} × {h} mm · {pages} pages · {bind}",
      "toast.saveFail": "Could not save on this device (storage full?)", "toast.full": "You have 200 mockups. Delete one first.",
      "toast.deleted": "Mockup deleted", "toast.dup": "Copy made", "toast.nofs": "Pictures need the orOS disk: open the app inside orOS.",
      "toast.badImg": "That file is not a picture orOS can read.", "toast.saved": "Picture saved",
      "toast.pics": "Saved in Pictures as {name}", "toast.picsFail": "Could not save in Pictures.",
      "toast.making": "Making the picture…", "toast.makeFail": "The picture could not be made on this device.",
      "toast.atelier": "Opened in Atelier as a new design.", "toast.noAtelier": "Atelier is not installed.",
      "toast.wrapShape": "This picture's shape does not match this book's wrap. Check the size, pages and bleed.",
      "toast.fromAtelier": "Cover from Atelier: check the size and the pages.",
      "nogl": "The 3D view needs WebGL, which this browser or device has switched off.",
      "loading": "Loading the 3D view…",
      "standalone": "Open Mockups inside orOS to keep pictures and sync."
    },
    el: {
      "app.name": "Μακέτες", "btn.new": "Νέα μακέτα", "btn.more": "Περισσότερα", "btn.back": "Όλες οι μακέτες",
      "empty": "Δεν υπάρχει ακόμα μακέτα. Φτιάξε μια τρισδιάστατη εικόνα του βιβλίου σου: δώσε μέγεθος και σελίδες, βάλε το εξώφυλλο, διάλεξε γωνία και φόντο και αποθήκευσέ τη.",
      "btn.first": "Φτιάξε μακέτα βιβλίου",
      "tab.book": "Βιβλίο", "tab.cover": "Εξώφυλλο", "tab.scene": "Σκηνή", "tab.out": "Αποθήκευση",
      "f.bind": "Βιβλιοδεσία", "bind.pb": "Χαρτόδετο", "bind.hc": "Σκληρόδετο",
      "f.trim": "Μέγεθος", "trim.custom": "Δικό μου μέγεθος", "f.w": "Πλάτος", "f.h": "Ύψος", "f.unit": "Μονάδα", "unit.in": "ίντσες",
      "f.pages": "Σελίδες", "f.paper": "Χαρτί", "f.cal": "Μία σελίδα (mm)",
      "paper.white": "Λευκό 80 γρ.", "paper.cream": "Κρεμ 90 γρ.", "paper.color": "Έγχρωμες σελίδες", "paper.coated": "Κουσέ (λεύκωμα)",
      "paper.bulky": "Χοντρό, αφράτο", "paper.custom": "Δικό μου πάχος",
      "f.spineIs": "Ράχη:", "spine.from": "{pages} σελίδες × {cal} mm", "spine.hand": "με το χέρι",
      "spine.block": "σελίδες {b}", "f.spineOn": "Ορίζω το πάχος της ράχης με το χέρι", "f.spine": "Πάχος ράχης (mm)",
      "f.flaps": "Αυτιά (γαλλικά αυτιά)", "f.flapsHc": "Κουβερτούρα με αυτιά", "f.flapW": "Πλάτος αυτιού",
      "f.round": "Στρογγυλή ράχη", "f.band": "Κεφαλάρι", "f.ribbon": "Κορδέλα σελιδοδείκτη",
      "aria.bandC": "Χρώμα κεφαλαριού", "aria.ribC": "Χρώμα κορδέλας",
      "f.cloth": "Εξώφυλλο κάτω από την κουβερτούρα", "f.fin": "Φινίρισμα", "fin.matte": "Ματ", "fin.gloss": "Γυαλιστερό", "fin.soft": "Soft-touch (βελούδινο)",
      "f.edge": "Ακμές σελίδων", "edge.white": "Λευκές", "edge.cream": "Κρεμ", "edge.color": "Χρωματιστές (βαμμένες)",
      "f.edgeC": "Χρώμα ακμών", "f.inC": "Εσωτερικό του εξωφύλλου",
      "f.mode": "Εικόνες εξωφύλλου", "mode.parts": "Εξώφυλλο, οπισθόφυλλο, ράχη", "mode.wrap": "Ένα ενιαίο εξώφυλλο",
      "slot.front": "Εξώφυλλο", "slot.back": "Οπισθόφυλλο", "slot.spine": "Ράχη", "slot.flapF": "Μπροστινό αυτί", "slot.flapB": "Πίσω αυτί",
      "slot.wrap": "Ενιαίο (οπισθόφυλλο + ράχη + εξώφυλλο)", "slot.none": "Χωρίς εικόνα", "slot.missing": "Δεν έχει έρθει ακόμα σε αυτή τη συσκευή",
      "btn.choose": "Διάλεξε εικόνα", "btn.remove": "Αφαίρεση",
      "wrap.info": "Φτιάξε το ενιαίο εξώφυλλο {w} × {h} mm μαζί με το bleed. Από αριστερά: {parts}.",
      "wrap.part": "{name} {mm} mm", "wrap.bleed": "bleed {mm} mm",
      "f.bleed": "Bleed γύρω από το ενιαίο (mm)",
      "f.coverC": "Χρώμα όπου δεν υπάρχει εικόνα", "f.spTC": "Χρώμα κειμένου ράχης", "f.spT": "Κείμενο ράχης (όταν δεν υπάρχει εικόνα ράχης)",
      "cover.atelier": "Έφτιαξες το εξώφυλλο στο Ατελιέ; Εκεί άνοιξε Περισσότερα › Φτιάξε μακέτα βιβλίου και έρχεται εδώ με τις σελίδες του.",
      "f.place": "Τοποθέτηση", "place.stand": "Όρθιο", "place.lie": "Ξαπλωμένο", "place.lean": "Ακουμπισμένο",
      "f.turn": "Περιστροφή", "f.open": "Άνοιγμα εξωφύλλου",
      "sec.cam": "Κάμερα", "cam.hint": "Σύρε την εικόνα για να γυρίσεις γύρω από το βιβλίο· τσίμπημα ή ροδέλα για να πλησιάσεις.",
      "f.fov": "Προοπτική", "f.zoom": "Μέγεθος στην εικόνα", "f.dx": "Μετακίνηση αριστερά / δεξιά", "f.dy": "Μετακίνηση πάνω / κάτω",
      "view.front": "Μπροστά", "view.q1": "¾ από τη ράχη", "view.q2": "¾ από τις σελίδες", "view.spine": "Ράχη", "view.back": "Πίσω",
      "view.top": "Από πάνω", "view.low": "Χαμηλή γωνία",
      "sec.bg": "Φόντο", "bg.none": "Διάφανο", "bg.solid": "Χρώμα", "bg.grad": "Διαβάθμιση", "bg.photo": "Φωτογραφία",
      "f.c1": "Χρώμα", "f.c2": "Δεύτερο χρώμα", "f.ang": "Κατεύθυνση", "f.shadow": "Σκιά", "aria.swatch": "Φόντο {n}",
      "sec.light": "Φως", "f.az": "Από πού", "f.el": "Ύψος", "f.str": "Ένταση", "f.soft": "Απαλότητα", "f.warm": "Ψυχρό / θερμό",
      "f.nm": "Όνομα αυτής της μακέτας", "f.ratio": "Σχήμα εικόνας", "f.size": "Μέγεθος", "f.fmt": "Μορφή",
      "size.px": "{n} px (μεγάλη πλευρά)",
      "out.info": "{w} × {h} px.", "out.clear": "Το φόντο μένει διάφανο (PNG και WebP).",
      "out.jpgclear": "Το JPG δεν έχει διαφάνεια: το φόντο γίνεται λευκό.", "out.max": "Αυτή η συσκευή ζωγραφίζει έως {n} px· η εικόνα βγαίνει μικρότερη.",
      "btn.save": "Αποθήκευση εικόνας", "btn.pics": "Αποθήκευση στις Εικόνες", "btn.atelier": "Άνοιγμα στο Ατελιέ",
      "more.title": "Μακέτα", "btn.dup": "Αντίγραφο αυτής της μακέτας", "btn.resetCam": "Επαναφορά κάμερας και φωτός", "btn.del": "Διαγραφή αυτής της μακέτας",
      "more.hint": "Οι μακέτες σου σε ακολουθούν σε κάθε συσκευή μέσω του sync του orOS, κρυπτογραφημένες. Οι εικόνες τους ταξιδεύουν με τον δίσκο του orOS.",
      "btn.cancel": "Άκυρο", "btn.delete": "Διαγραφή", "btn.close": "Κλείσιμο",
      "ask.del": "Διαγραφή της μακέτας «{name}»; Θα φύγει από όλες τις συσκευές σου.",
      "untitled": "Μακέτα βιβλίου", "copyOf": "(αντίγραφο)", "sub.book": "{w} × {h} mm · {pages} σελίδες · {bind}",
      "toast.saveFail": "Δεν έγινε αποθήκευση σε αυτή τη συσκευή (γέμισε ο χώρος;)", "toast.full": "Έχεις 200 μακέτες. Διάγραψε πρώτα μία.",
      "toast.deleted": "Η μακέτα διαγράφηκε", "toast.dup": "Έγινε αντίγραφο", "toast.nofs": "Οι εικόνες θέλουν τον δίσκο του orOS: άνοιξε την εφαρμογή μέσα από το orOS.",
      "toast.badImg": "Αυτό το αρχείο δεν είναι εικόνα που διαβάζει το orOS.", "toast.saved": "Η εικόνα αποθηκεύτηκε",
      "toast.pics": "Αποθηκεύτηκε στις Εικόνες ως {name}", "toast.picsFail": "Δεν έγινε αποθήκευση στις Εικόνες.",
      "toast.making": "Φτιάχνω την εικόνα…", "toast.makeFail": "Η εικόνα δεν μπόρεσε να γίνει σε αυτή τη συσκευή.",
      "toast.atelier": "Άνοιξε στο Ατελιέ ως νέο σχέδιο.", "toast.noAtelier": "Το Ατελιέ δεν είναι εγκατεστημένο.",
      "toast.wrapShape": "Το σχήμα αυτής της εικόνας δεν ταιριάζει με το ενιαίο εξώφυλλο του βιβλίου. Έλεγξε μέγεθος, σελίδες και bleed.",
      "toast.fromAtelier": "Εξώφυλλο από το Ατελιέ: έλεγξε το μέγεθος και τις σελίδες.",
      "nogl": "Η τρισδιάστατη προβολή θέλει WebGL, που είναι κλειστό σε αυτόν τον browser ή τη συσκευή.",
      "loading": "Φορτώνει η τρισδιάστατη προβολή…",
      "standalone": "Άνοιξε τις Μακέτες μέσα από το orOS για εικόνες και sync."
    }
  };
  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k] !== undefined) ? STRINGS[LANG][k] : (STRINGS.en[k] !== undefined ? STRINGS.en[k] : k);
    if (vars && typeof s === "string") s = s.replace(/\{(\w+)\}/g, function (m, n) { return vars[n] !== undefined ? vars[n] : m; });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function setLabel(btn, text) { btn.setAttribute("aria-label", text); btn.title = text; }
  function shell() {
    try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
  }
  function fsApi() {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; } catch (e) { return window.orosFS || null; }
  }
  function readJSON(key) {
    try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  function fmtNum(v, d) {
    var s = (+v).toFixed(d).replace(/\.?0+$/, "");
    return LANG === "el" ? s.replace(".", ",") : s;
  }
  function parseNum(s) {
    var n = parseFloat(String(s || "").replace(",", "."));
    return isFinite(n) ? n : NaN;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var ICON = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  var toastTimer = 0;
  function toast(msg) {
    var n = $("toast");
    n.textContent = msg;
    n.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.classList.remove("show"); }, 3600);
  }

  // ---------- 2. State + storage ----------
  var data = C.empty();
  var prefs = C.normPrefs(null);
  var cur = null;                    // the open project (normalized)
  var saveTimer = 0;

  function load() {
    try { data = C.parse(localStorage.getItem(C.DATA_KEY)); } catch (e) { data = C.empty(); }
    prefs = C.normPrefs(readJSON(C.PREFS_KEY));
  }
  function savePrefs() { try { localStorage.setItem(C.PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function storeData() {
    try { localStorage.setItem(C.DATA_KEY, JSON.stringify(data)); }
    catch (e) { toast(t("toast.saveFail")); return false; }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    return true;
  }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 500); }
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!cur) return;
    var old = C.byId(data, cur.id);
    if (old) {
      var a = clone(cur), b = clone(old);
      a.m = b.m = 0;
      if (C.canon(a) === C.canon(b)) return;
    }
    var r = C.put(data, cur, Date.now());
    if (!r.ok) { if (r.why === "full") toast(t("toast.full")); return; }
    data = r.data;
    cur.m = r.prj.m;
    storeData();
    thumbSoon();
  }
  function label(p) { return p.nm || t("untitled"); }
  function subOf(p) {
    return t("sub.book", { w: fmtNum(p.bk.w, 1), h: fmtNum(p.bk.h, 1), pages: p.bk.pages, bind: t("bind." + p.bk.bind) });
  }

  // ---------- 3. Thumbnails (IndexedDB) + home ----------
  var TDB = null;
  function tdb() {
    if (TDB) return TDB;
    TDB = new Promise(function (res) {
      try {
        var rq = indexedDB.open("oros-mockups-thumbs", 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("t"); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return TDB;
  }
  function tGet(id) {
    return tdb().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try {
          var rq = db.transaction("t").objectStore("t").get(id);
          rq.onsuccess = function () { res(rq.result || null); };
          rq.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    });
  }
  function tPut(id, val) {
    return tdb().then(function (db) {
      if (!db) return;
      try { db.transaction("t", "readwrite").objectStore("t").put(val, id); } catch (e) {}
    });
  }
  function tDel(id) {
    return tdb().then(function (db) {
      if (!db) return;
      try { db.transaction("t", "readwrite").objectStore("t").delete(id); } catch (e) {}
    });
  }
  var thumbTimer = 0;
  function thumbSoon() { clearTimeout(thumbTimer); thumbTimer = setTimeout(makeThumb, 1500); }
  function makeThumb() {
    clearTimeout(thumbTimer);
    thumbTimer = 0;
    if (!cur || !stage) return;
    var id = cur.id, m = cur.m;
    try {
      var snap = stage.snapshot(320, 400, false).canvas;
      snap.toBlob(function (b) { if (b) tPut(id, { m: m, blob: b }); }, "image/jpeg", 0.82);
    } catch (e) {}
  }

  var thumbUrls = [];
  function renderHome() {
    thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    thumbUrls = [];
    var grid = $("grid");
    grid.textContent = "";
    var list = data.prj.slice().sort(function (a, b) { return b.m - a.m; });
    $("empty-box").hidden = list.length > 0;
    var missing = [];
    list.forEach(function (p) {
      var li = el("li"), b = el("button", "prj");
      b.type = "button";
      var pic = el("span", "prj-pic"), ph = el("span", "ph");
      ph.style.background = p.art.c;
      pic.appendChild(ph);
      b.appendChild(pic);
      b.appendChild(el("span", "prj-name", label(p)));
      b.appendChild(el("span", "prj-sub", subOf(p)));
      b.addEventListener("click", function () { openPrj(p.id); });
      li.appendChild(b);
      grid.appendChild(li);
      tGet(p.id).then(function (v) {
        if (v && v.blob) {
          var u = URL.createObjectURL(v.blob), img = el("img");
          thumbUrls.push(u);
          img.src = u; img.alt = "";
          pic.textContent = ""; pic.appendChild(img);
        }
        if (!v || v.m !== p.m) missing.push({ p: p, pic: pic });
      });
    });
    // thumbnails made on another device are drawn here, one by one
    setTimeout(function () { if (!cur && missing.length) bgThumbs(missing); }, 400);
  }
  var bgBusy = false;
  function bgThumbs(list) {
    if (bgBusy) return;
    bgBusy = true;
    var host = el("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;height:400px;";
    document.body.appendChild(host);
    loadScene().then(function (mod) {
      var st = mod.createStage(host, C);
      st.resize(320, 400);
      var chain = Promise.resolve();
      list.forEach(function (it) {
        chain = chain.then(function () {
          if (cur) return;
          return picsFor(it.p).then(function (r) {
            st.set(it.p, r.imgs, r.bg);
            var cv = st.snapshot(320, 400, false).canvas;
            return new Promise(function (res) {
              cv.toBlob(function (b) {
                if (b) {
                  tPut(it.p.id, { m: it.p.m, blob: b });
                  var u = URL.createObjectURL(b), img = el("img");
                  thumbUrls.push(u); img.src = u; img.alt = "";
                  it.pic.textContent = ""; it.pic.appendChild(img);
                }
                res();
              }, "image/jpeg", 0.82);
            });
          });
        });
      });
      return chain.then(function () { st.destroy(); });
    }).catch(function () {}).then(function () { host.remove(); bgBusy = false; });
  }

  function showHome() {
    if (cur) { if (saveTimer) saveNow(); makeThumb(); }
    cur = null;
    prefs.cur = ""; savePrefs();
    $("home").hidden = false;
    $("editor").hidden = true;
    $("back-btn").hidden = true;
    $("more-btn").hidden = true;
    $("title-main").textContent = t("app.name");
    $("title-sub").textContent = "";
    renderHome();
  }
  function openPrj(id) {
    var p = C.byId(data, id);
    if (!p) { showHome(); return; }
    if (cur && saveTimer) saveNow();
    cur = clone(p);
    prefs.cur = id; savePrefs();
    $("home").hidden = true;
    $("editor").hidden = false;
    $("back-btn").hidden = false;
    $("more-btn").hidden = false;
    renderForm();
    showTab(prefs.tab);
    ensureStage().then(function () { layoutStage(); pushAll(); });
  }
  function newPrj(init) {
    var p = C.blank(C.newId(), Date.now());
    if (init) init(p);
    var r = C.put(data, p, Date.now());
    if (!r.ok) { if (r.why === "full") toast(t("toast.full")); return null; }
    data = r.data;
    storeData();
    openPrj(r.prj.id);
    return r.prj;
  }

  // ---------- 4. Stage (3D view), pictures, camera drag ----------
  var AS = window.orosDK && window.orosDK.assets;
  var stage = null, stageP = null, sceneMod = null;
  function loadScene() {
    if (sceneMod) return Promise.resolve(sceneMod);
    return import("./scene.js").then(function (m) { sceneMod = m; return m; });
  }
  function ensureStage() {
    if (stage) return Promise.resolve(stage);
    if (stageP) return stageP;
    var msg = $("stage-msg");
    msg.textContent = t("loading"); msg.hidden = false;
    stageP = loadScene().then(function (mod) {
      stage = mod.createStage($("stage"), C);
      msg.hidden = true;
      return stage;
    }).catch(function (e) {
      console.warn("[orOS Mockups] 3D view", e);
      msg.textContent = t("nogl"); msg.hidden = false;
      stageP = null;
      return Promise.reject(e);
    });
    return stageP;
  }
  // The picture's frame inside the stage, in the output's shape.
  function layoutStage() {
    if (!stage || !cur) return;
    var box = $("stage"), bw = box.clientWidth, bh = box.clientHeight;
    if (!bw || !bh) return;
    var r = C.ratioOf(cur.out.ratio), w = bw, h = Math.round(bw / r);
    if (h > bh) { h = bh; w = Math.round(bh * r); }
    var x = Math.round((bw - w) / 2), y = Math.round((bh - h) / 2);
    [].forEach.call(box.querySelectorAll("canvas"), function (c) {
      c.style.left = x + "px"; c.style.top = y + "px"; c.style.width = w + "px"; c.style.height = h + "px";
    });
    stage.resize(w, h);
  }

  var imgCache = {};                 // asset id → HTMLImageElement
  function loadImg(id) {
    if (!id) return Promise.resolve(null);
    if (imgCache[id]) return Promise.resolve(imgCache[id]);
    if (!AS) return Promise.resolve(null);
    return AS.load(id).then(function (img) { if (img) imgCache[id] = img; return img || null; }, function () { return null; });
  }
  function picsFor(p) {
    var imgs = {}, jobs = C.SLOTS.map(function (k) {
      return loadImg(p.art[k]).then(function (img) { if (img) imgs[k] = img; });
    });
    var bg = null;
    jobs.push(loadImg(p.sc.bg.img).then(function (img) { bg = img; }));
    return Promise.all(jobs).then(function () { return { imgs: imgs, bg: bg }; });
  }
  var pushSeq = 0;
  function pushAll() {
    if (!stage || !cur) return;
    var seq = ++pushSeq, p = clone(cur);
    picsFor(p).then(function (r) {
      if (seq !== pushSeq || !stage || !cur) return;
      stage.set(p, r.imgs, r.bg);
    });
  }
  function pushScene(rebuild) {
    if (!stage || !cur) return;
    if (rebuild) { pushAll(); return; }
    var sc = clone(cur.sc);
    loadImg(sc.bg.img).then(function (bg) { if (stage && cur) stage.scene(sc, bg, false); });
  }
  if (AS && typeof AS.onChange === "function") AS.onChange(function () {
    if (cur) { renderSlots(); pushAll(); }
  });

  // Drag to orbit, pinch / wheel to zoom, arrows on the keyboard.
  var ptrs = {}, pinch0 = 0, zoom0 = 1;
  function camChanged() {
    var c = cur.sc.cam;
    c.th = ((c.th + 540) % 360) - 180;
    cur.sc = C.normScene(cur.sc);
    renderCamFields();
    pushScene(false);
    saveSoon();
  }
  function wireStage() {
    var box = $("stage");
    box.addEventListener("pointerdown", function (e) {
      if (!cur) return;
      box.setPointerCapture(e.pointerId);
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; zoom0 = cur.sc.cam.zoom;
      }
      box.classList.add("drag");
    });
    box.addEventListener("pointermove", function (e) {
      var p = ptrs[e.pointerId];
      if (!p || !cur) return;
      var ids = Object.keys(ptrs);
      if (ids.length === 1) {
        cur.sc.cam.th -= (e.clientX - p.x) * 0.4;
        cur.sc.cam.ph += (e.clientY - p.y) * 0.3;
        p.x = e.clientX; p.y = e.clientY;
        camChanged();
      } else if (ids.length === 2) {
        p.x = e.clientX; p.y = e.clientY;
        var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        cur.sc.cam.zoom = zoom0 * d / pinch0;
        camChanged();
      }
    });
    function end(e) {
      delete ptrs[e.pointerId];
      if (!Object.keys(ptrs).length) box.classList.remove("drag");
    }
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
    box.addEventListener("wheel", function (e) {
      if (!cur) return;
      e.preventDefault();
      cur.sc.cam.zoom *= Math.exp(-e.deltaY * 0.0015);
      camChanged();
    }, { passive: false });
    box.addEventListener("keydown", function (e) {
      if (!cur || e.ctrlKey || e.metaKey || e.altKey) return;
      var c = cur.sc.cam, done = true;
      if (e.key === "ArrowLeft") c.th += 5;
      else if (e.key === "ArrowRight") c.th -= 5;
      else if (e.key === "ArrowUp") c.ph += 4;
      else if (e.key === "ArrowDown") c.ph -= 4;
      else if (e.key === "+" || e.key === "=") c.zoom *= 1.08;
      else if (e.key === "-") c.zoom /= 1.08;
      else done = false;
      if (done) { e.preventDefault(); camChanged(); }
    });
    if (typeof ResizeObserver === "function") new ResizeObserver(function () { layoutStage(); }).observe(box);
    else window.addEventListener("resize", layoutStage);
  }
  var VIEWS = [
    { k: "front", th: 0, ph: 6 }, { k: "q1", th: -28, ph: 12 }, { k: "q2", th: 30, ph: 12 },
    { k: "spine", th: -90, ph: 6 }, { k: "back", th: 180, ph: 6 }, { k: "top", th: 0, ph: 80 },
    { k: "low", th: -24, ph: 1, fov: 46 }
  ];
  function renderViews() {
    var box = $("views");
    box.textContent = "";
    box.setAttribute("aria-label", t("sec.cam"));
    VIEWS.forEach(function (v) {
      var b = el("button", null, t("view." + v.k));
      b.type = "button";
      b.addEventListener("click", function () {
        if (!cur) return;
        var c = cur.sc.cam;
        c.th = v.th; c.ph = v.ph; c.dx = 0; c.dy = 0;
        c.fov = v.fov || (c.fov > 40 ? 30 : c.fov);
        camChanged();
      });
      box.appendChild(b);
    });
  }

  // ---------- 5. The form ----------
  var tabs = ["book", "cover", "scene", "out"];
  function showTab(k) {
    if (tabs.indexOf(k) < 0) k = "book";
    tabs.forEach(function (x) {
      var on = x === k;
      $("pane-" + x).hidden = !on;
      $("tab-" + x).classList.toggle("on", on);
      $("tab-" + x).setAttribute("aria-selected", on ? "true" : "false");
      $("tab-" + x).tabIndex = on ? 0 : -1;
    });
    if (prefs.tab !== k) { prefs.tab = k; savePrefs(); }
  }
  function setVal(id, v) { var n = $(id); if (n && document.activeElement !== n && n.value !== String(v)) n.value = v; }
  function setChk(id, v) { var n = $(id); if (n) n.checked = !!v; }
  function setSeg(id, v) {
    [].forEach.call($(id).querySelectorAll("button"), function (b) {
      var on = b.getAttribute("data-v") === v;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  }
  function out(id, text) { $(id).textContent = text; }
  function unitVal(mm) { return cur.unit === "in" ? +(mm / C.MM_PER_IN).toFixed(3) : +(+mm).toFixed(1); }

  function renderForm() {
    if (!cur) return;
    var b = cur.bk, a = cur.art, s = cur.sc;
    $("title-main").textContent = label(cur);
    $("title-sub").textContent = subOf(cur);
    // book
    setSeg("bind", b.bind);
    setVal("f-trim", b.trim);
    setVal("f-unit", cur.unit);
    setVal("f-w", unitVal(b.w)); setVal("f-h", unitVal(b.h));
    setVal("f-pages", b.pages); setVal("r-pages", Math.min(1200, b.pages)); out("pages-out", b.pages);
    setVal("f-paper", b.paper);
    $("cal-box").hidden = b.paper !== "custom";
    setVal("f-cal", b.cal);
    var d = C.dims(b);
    out("spine-out", (cur.unit === "in" ? fmtNum(d.spineMm / C.MM_PER_IN, 3) + "″" : fmtNum(d.spineMm, 1) + " mm"));
    var cal = b.paper === "custom" ? b.cal : C.paperOf(b.paper).c;
    out("spine-sub", "(" + (b.spine ? t("spine.hand") : t("spine.from", { pages: b.pages, cal: fmtNum(cal, 4) })) +
      (b.bind === "hc" ? " · " + t("spine.block", { b: fmtNum(d.T, 1) + " mm" }) : "") + ")");
    setChk("f-spineOn", b.spine > 0);
    $("spine-box").hidden = !(b.spine > 0);
    setVal("f-spine", b.spine || +d.T.toFixed(1));
    setChk("f-flaps", b.flaps);
    $("flaps-lbl").textContent = t(b.bind === "hc" ? "f.flapsHc" : "f.flaps");
    $("flapw-box").hidden = !b.flaps;
    setVal("f-flapW", b.flapW); out("flapw-out", fmtNum(b.flapW, 0) + " mm");
    $("hc-box").hidden = b.bind !== "hc";
    setChk("f-round", b.round); setChk("f-band", b.band); setChk("f-ribbon", b.ribbon);
    setVal("f-bandC", b.bandC); setVal("f-ribC", b.ribC);
    $("cloth-box").hidden = !(b.bind === "hc" && b.flaps);
    setVal("f-clothC", b.clothC);
    setVal("f-fin", b.fin); setVal("f-edge", b.edge);
    $("edgec-box").hidden = b.edge !== "color";
    setVal("f-edgeC", b.edgeC); setVal("f-inC", b.inC);
    // cover
    setSeg("mode", a.mode);
    $("wrap-box").hidden = a.mode !== "wrap";
    setVal("f-bleed", a.bleed >= 0 ? a.bleed : d.bleed);
    setVal("f-coverC", a.c); setVal("f-spTC", a.spTC); setVal("f-spT", a.spT);
    renderSlots();
    renderWrapInfo();
    // scene
    setSeg("place", s.place);
    setVal("f-turn", s.turn); out("turn-out", s.turn + "°");
    setVal("f-open", s.open); out("open-out", s.open + "°");
    renderCamFields();
    setSeg("bgk", s.bg.k);
    $("bgc-box").hidden = s.bg.k === "none" || s.bg.k === "photo";
    $("c2-box").hidden = s.bg.k !== "grad";
    $("ang-box").hidden = s.bg.k !== "grad";
    $("photo-box").hidden = s.bg.k !== "photo";
    $("swatches").hidden = !(s.bg.k === "solid" || s.bg.k === "grad");
    setVal("f-c1", s.bg.c1); setVal("f-c2", s.bg.c2);
    setVal("f-ang", s.bg.ang); out("ang-out", s.bg.ang + "°");
    renderPhotoThumb();
    setVal("f-shadow", s.shadow); out("shadow-out", Math.round(s.shadow * 100) + "%");
    setVal("f-az", s.light.az); out("az-out", s.light.az + "°");
    setVal("f-el", s.light.el); out("el-out", s.light.el + "°");
    setVal("f-str", s.light.str); out("str-out", Math.round(s.light.str * 100) + "%");
    setVal("f-soft", s.light.soft); out("soft-out", Math.round(s.light.soft * 100) + "%");
    setVal("f-warm", s.light.warm); out("warm-out", (s.light.warm > 0 ? "+" : "") + Math.round(s.light.warm * 100));
    // out
    setVal("f-nm", cur.nm);
    $("f-nm").placeholder = t("untitled");
    setSeg("ratio", cur.out.ratio);
    setVal("f-size", String(cur.out.size));
    setVal("f-fmt", cur.out.fmt);
    renderOutInfo();
  }
  function renderCamFields() {
    var c = cur.sc.cam;
    setVal("f-fov", c.fov); out("fov-out", c.fov + "°");
    setVal("f-zoom", c.zoom); out("zoom-out", Math.round(c.zoom * 100) + "%");
    setVal("f-dx", c.dx); out("dx-out", Math.round(c.dx * 100));
    setVal("f-dy", c.dy); out("dy-out", Math.round(c.dy * 100));
  }
  function renderOutInfo() {
    var sz = C.outSize(cur.out), max = stage ? stage.MAX : 4096, lines = [];
    var k = Math.min(1, max / Math.max(sz.w, sz.h));
    lines.push(t("out.info", { w: Math.round(sz.w * k), h: Math.round(sz.h * k) }));
    if (k < 1) lines.push(t("out.max", { n: max }));
    if (cur.sc.bg.k === "none") lines.push(t(cur.out.fmt === "jpg" ? "out.jpgclear" : "out.clear"));
    out("out-info", lines.join(" "));
  }
  function renderWrapInfo() {
    var L = C.layout(cur.bk), d = C.dims(cur.bk), bl = cur.art.bleed >= 0 ? cur.art.bleed : d.bleed;
    var parts = [t("wrap.bleed", { mm: fmtNum(bl, 1) })];
    L.panels.forEach(function (p) { parts.push(t("wrap.part", { name: t("slot." + p.k), mm: fmtNum(p.w, 1) })); });
    parts.push(t("wrap.bleed", { mm: fmtNum(bl, 1) }));
    out("wrap-info", t("wrap.info", { w: fmtNum(L.total + 2 * bl, 1), h: fmtNum(L.h + 2 * bl, 1), parts: parts.join(" · ") }));
  }

  // Picture slots (cover tab).
  function slotsShown() {
    if (cur.art.mode === "wrap") return ["wrap"];
    return cur.bk.flaps ? ["front", "back", "spine", "flapF", "flapB"] : ["front", "back", "spine"];
  }
  function thumbInto(box, id) {
    box.textContent = "";
    if (!id) { box.textContent = t("slot.none"); return; }
    loadImg(id).then(function (img) {
      box.textContent = "";
      if (!img) { box.textContent = AS && AS.isMissing(id) ? "…" : t("slot.none"); box.title = t("slot.missing"); return; }
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k = Math.min(1, 112 / Math.max(iw, ih));
      var cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(iw * k)); cv.height = Math.max(1, Math.round(ih * k));
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      var im = el("img"); im.src = cv.toDataURL("image/png"); im.alt = "";
      box.appendChild(im);
    });
  }
  function renderSlots() {
    var ul = $("slots");
    ul.textContent = "";
    slotsShown().forEach(function (k) {
      var li = el("li", "slot"), th = el("span", "thumb");
      thumbInto(th, cur.art[k]);
      li.appendChild(th);
      li.appendChild(el("span", "slot-name", t("slot." + k)));
      var chips = el("span", "chips");
      var pickB = el("button", "chip small", t("btn.choose"));
      pickB.type = "button";
      pickB.addEventListener("click", function () { pickPicture(function (id, w, h) { setSlot(k, id, w, h); }); });
      chips.appendChild(pickB);
      if (cur.art[k]) {
        var del = el("button", "chip small", t("btn.remove"));
        del.type = "button";
        del.addEventListener("click", function () { setSlot(k, "", 0, 0); });
        chips.appendChild(del);
      }
      li.appendChild(chips);
      // drop a picture file on the slot
      li.addEventListener("dragover", function (e) { e.preventDefault(); li.classList.add("drop"); });
      li.addEventListener("dragleave", function () { li.classList.remove("drop"); });
      li.addEventListener("drop", function (e) {
        e.preventDefault(); li.classList.remove("drop");
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) importPicture(f, function (id, w, h) { setSlot(k, id, w, h); });
      });
      ul.appendChild(li);
    });
  }
  function setSlot(k, id, w, h) {
    change("art", function (p) { p.art[k] = id; });
    if (k === "wrap" && id && w && h) {
      var L = C.layout(cur.bk), d = C.dims(cur.bk), bl = cur.art.bleed >= 0 ? cur.art.bleed : d.bleed;
      var want = (L.total + 2 * bl) / (L.h + 2 * bl), got = w / h;
      if (Math.abs(got / want - 1) > 0.04) toast(t("toast.wrapShape"));
    }
  }
  function renderPhotoThumb() { thumbInto($("photo-thumb"), cur.sc.bg.img); $("photo-del").hidden = !cur.sc.bg.img; }

  // File → orOS disk → callback(id, w, h).
  function importPicture(f, done) {
    if (!AS || !fsApi()) { toast(t("toast.nofs")); return; }
    AS.importFile(f).then(function (r) { done(r.id, r.w, r.h); }, function (e) {
      toast(e && e.message === "nofs" ? t("toast.nofs") : t("toast.badImg"));
    });
  }
  function pickPicture(done) {
    var s = shell(), dlg = null;
    try { dlg = s && s.orosDialog; } catch (e) {}
    if (dlg && typeof dlg.openFile === "function") {
      dlg.openFile("image/*").then(function (f) { if (f) importPicture(f, done); });
      return;
    }
    var inp = $("file-in");
    inp.value = "";
    inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) importPicture(f, done); };
    inp.click();
  }

  // One change to the open project. kind: book | art | scene | out | name
  function change(kind, fn) {
    if (!cur) return;
    fn(cur);
    var n = C.normProject(cur);
    if (!n) return;
    cur = n;
    renderForm();
    if (kind === "book" || kind === "art") pushAll();
    else if (kind === "scene") pushScene(false);
    else if (kind === "out") layoutStage();
    if (kind === "scene" || kind === "out") renderOutInfo();
    saveSoon();
  }

  function fillSelects() {
    var tr = $("f-trim");
    C.TRIMS.forEach(function (x) {
      var o = el("option", null, x.n + " · " + fmtNum(x.w, 1) + " × " + fmtNum(x.h, 1) + " mm");
      o.value = x.k; tr.appendChild(o);
    });
    var oc = el("option", null, t("trim.custom")); oc.value = "custom"; tr.appendChild(oc);
    var pp = $("f-paper");
    C.PAPERS.forEach(function (x) {
      var o = el("option", null, t("paper." + x.k));
      o.value = x.k; pp.appendChild(o);
    });
    var sz = $("f-size");
    C.SIZES.forEach(function (n) { var o = el("option", null, t("size.px", { n: n })); o.value = String(n); sz.appendChild(o); });
    var ra = $("ratio");
    C.RATIOS.forEach(function (r) {
      var b = el("button", null, r); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("data-v", r);
      ra.appendChild(b);
    });
  }
  var SWATCHES = [["#f4f1ea", "#d9d2c3"], ["#eef1f5", "#c9d2de"], ["#ffffff", "#e9e9e9"], ["#1f2430", "#0d1016"],
                  ["#f6d6c8", "#e8a990"], ["#d7eadf", "#9cc5ae"], ["#fef3c7", "#f5c56a"], ["#e3dcf7", "#a998e0"]];
  function renderSwatches() {
    var box = $("swatches");
    box.setAttribute("aria-label", t("sec.bg"));
    SWATCHES.forEach(function (sw, i) {
      var b = el("button");
      b.type = "button";
      b.style.background = "linear-gradient(180deg," + sw[0] + "," + sw[1] + ")";
      setLabel(b, t("aria.swatch", { n: i + 1 }));
      b.addEventListener("click", function () {
        change("scene", function (p) { p.sc.bg.c1 = sw[0]; p.sc.bg.c2 = sw[1]; });
      });
      box.appendChild(b);
    });
  }

  function wireSeg(id, fn) {
    var box = $(id);
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]");
      if (b) fn(b.getAttribute("data-v"));
    });
    box.addEventListener("keydown", function (e) {
      var d = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : (e.key === "ArrowLeft" || e.key === "ArrowUp") ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var bs = [].slice.call(box.querySelectorAll("button[data-v]"));
      var i = bs.findIndex(function (b) { return b.getAttribute("aria-checked") === "true"; });
      var nb = bs[(i + d + bs.length) % bs.length];
      fn(nb.getAttribute("data-v"));
      nb.focus();
    });
  }
  function wireForm() {
    wireSeg("bind", function (v) { change("book", function (p) { p.bk.bind = v; }); });
    $("f-trim").addEventListener("change", function () {
      var tr = C.trimOf($("f-trim").value);
      change("book", function (p) { if (tr) { p.bk.w = tr.w; p.bk.h = tr.h; p.bk.trim = tr.k; } else p.bk.trim = "custom"; });
    });
    $("f-unit").addEventListener("change", function () { change("name", function (p) { p.unit = $("f-unit").value; }); });
    ["w", "h"].forEach(function (k) {
      $("f-" + k).addEventListener("change", function () {
        var v = parseNum($("f-" + k).value);
        if (!isFinite(v)) { renderForm(); return; }
        var mm = cur.unit === "in" ? v * C.MM_PER_IN : v;
        change("book", function (p) { p.bk[k] = mm; p.bk.trim = "custom"; });
        $("f-" + k).value = unitVal(cur.bk[k]);
      });
    });
    $("f-pages").addEventListener("change", function () {
      var v = parseNum($("f-pages").value);
      change("book", function (p) { if (isFinite(v)) p.bk.pages = Math.round(v); });
      $("f-pages").value = cur.bk.pages;
    });
    $("r-pages").addEventListener("input", function () { change("book", function (p) { p.bk.pages = +$("r-pages").value; }); });
    $("f-paper").addEventListener("change", function () { change("book", function (p) { p.bk.paper = $("f-paper").value; }); });
    $("f-cal").addEventListener("change", function () {
      var v = parseNum($("f-cal").value);
      change("book", function (p) { if (isFinite(v)) p.bk.cal = v; });
      $("f-cal").value = cur.bk.cal;
    });
    $("f-spineOn").addEventListener("change", function () {
      var on = $("f-spineOn").checked;
      change("book", function (p) { p.bk.spine = on ? +C.dims(p.bk).T.toFixed(1) : 0; });
    });
    $("f-spine").addEventListener("change", function () {
      var v = parseNum($("f-spine").value);
      change("book", function (p) { if (isFinite(v) && v >= 1) p.bk.spine = v; });
      $("f-spine").value = cur.bk.spine;
    });
    $("f-flaps").addEventListener("change", function () { change("book", function (p) { p.bk.flaps = $("f-flaps").checked ? 1 : 0; }); });
    $("f-flapW").addEventListener("input", function () { change("book", function (p) { p.bk.flapW = +$("f-flapW").value; }); });
    ["round", "band", "ribbon"].forEach(function (k) {
      $("f-" + k).addEventListener("change", function () { change("book", function (p) { p.bk[k] = $("f-" + k).checked ? 1 : 0; }); });
    });
    ["bandC", "ribC", "clothC", "edgeC", "inC"].forEach(function (k) {
      $("f-" + k).addEventListener("input", function () { change("book", function (p) { p.bk[k] = $("f-" + k).value; }); });
    });
    $("f-fin").addEventListener("change", function () { change("book", function (p) { p.bk.fin = $("f-fin").value; }); });
    $("f-edge").addEventListener("change", function () { change("book", function (p) { p.bk.edge = $("f-edge").value; }); });
    // cover
    wireSeg("mode", function (v) { change("art", function (p) { p.art.mode = v; }); });
    $("f-bleed").addEventListener("change", function () {
      var v = parseNum($("f-bleed").value);
      change("art", function (p) { if (isFinite(v)) p.art.bleed = Math.max(0, v); });
    });
    $("f-coverC").addEventListener("input", function () { change("art", function (p) { p.art.c = $("f-coverC").value; }); });
    $("f-spTC").addEventListener("input", function () { change("art", function (p) { p.art.spTC = $("f-spTC").value; }); });
    $("f-spT").addEventListener("input", function () { change("art", function (p) { p.art.spT = $("f-spT").value; }); });
    // scene
    wireSeg("place", function (v) {
      change("scene", function (p) {
        if (p.sc.place !== v && v === "lie" && p.sc.cam.ph < 35) p.sc.cam.ph = 55;
        if (p.sc.place !== v && v !== "lie" && p.sc.cam.ph > 50) p.sc.cam.ph = 12;
        p.sc.place = v;
      });
    });
    function rng(id, set) { $(id).addEventListener("input", function () { var v = +$(id).value; change("scene", function (p) { set(p.sc, v); }); }); }
    rng("f-turn", function (s, v) { s.turn = v; });
    rng("f-open", function (s, v) { s.open = v; });
    rng("f-fov", function (s, v) { s.cam.fov = v; });
    rng("f-zoom", function (s, v) { s.cam.zoom = v; });
    rng("f-dx", function (s, v) { s.cam.dx = v; });
    rng("f-dy", function (s, v) { s.cam.dy = v; });
    rng("f-ang", function (s, v) { s.bg.ang = v; });
    rng("f-shadow", function (s, v) { s.shadow = v; });
    rng("f-az", function (s, v) { s.light.az = v; });
    rng("f-el", function (s, v) { s.light.el = v; });
    rng("f-str", function (s, v) { s.light.str = v; });
    rng("f-soft", function (s, v) { s.light.soft = v; });
    rng("f-warm", function (s, v) { s.light.warm = v; });
    wireSeg("bgk", function (v) { change("scene", function (p) { p.sc.bg.k = v; }); if (v === "photo" && !cur.sc.bg.img) pickBgPhoto(); });
    $("f-c1").addEventListener("input", function () { change("scene", function (p) { p.sc.bg.c1 = $("f-c1").value; }); });
    $("f-c2").addEventListener("input", function () { change("scene", function (p) { p.sc.bg.c2 = $("f-c2").value; }); });
    $("photo-pick").addEventListener("click", pickBgPhoto);
    $("photo-del").addEventListener("click", function () { change("scene", function (p) { p.sc.bg.img = ""; }); });
    // out
    $("f-nm").addEventListener("input", function () { change("name", function (p) { p.nm = $("f-nm").value; }); });
    wireSeg("ratio", function (v) { change("out", function (p) { p.out.ratio = v; }); });
    $("f-size").addEventListener("change", function () { change("out", function (p) { p.out.size = +$("f-size").value; }); });
    $("f-fmt").addEventListener("change", function () { change("out", function (p) { p.out.fmt = $("f-fmt").value; }); });
    $("save-btn").addEventListener("click", savePicture);
    $("pics-btn").addEventListener("click", saveToPictures);
    $("atelier-btn").addEventListener("click", openInAtelier);
  }
  function pickBgPhoto() {
    pickPicture(function (id) { change("scene", function (p) { p.sc.bg.img = id; p.sc.bg.k = "photo"; }); });
  }

  // ---------- 6. Save the picture, Pictures, Atelier ----------
  var MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
  function fileBase() {
    var n = (cur.nm || t("untitled")).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    return n || "mockup";
  }
  // → Promise<Blob>
  function makeBlob(fmt) {
    if (!stage || !cur) return Promise.reject(new Error("nostage"));
    var sz = C.outSize(cur.out), clear = cur.sc.bg.k === "none";
    return new Promise(function (res, rej) {
      setTimeout(function () {
        try {
          var cv = stage.snapshot(sz.w, sz.h, false).canvas;
          if (fmt === "jpg" && clear) {
            var c2 = document.createElement("canvas"); c2.width = cv.width; c2.height = cv.height;
            var x = c2.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, c2.width, c2.height); x.drawImage(cv, 0, 0);
            cv = c2;
          }
          cv.toBlob(function (b) { if (b) res(b); else rej(new Error("encode")); }, MIME[fmt], fmt === "png" ? undefined : 0.92);
        } catch (e) { rej(e); }
      }, 30);
    });
  }
  function savePicture() {
    if (!cur) return;
    if (saveTimer) saveNow();
    var fmt = cur.out.fmt, name = fileBase() + "." + fmt;
    toast(t("toast.making"));
    makeBlob(fmt).then(function (blob) {
      var s = shell(), dlg = null;
      try { dlg = s && s.orosDialog; } catch (e) {}
      if (dlg && typeof dlg.saveFile === "function") {
        return dlg.saveFile({ blob: blob, filename: name, mime: MIME[fmt] }).then(function (r) { if (r && r.ok) toast(t("toast.saved")); });
      }
      var a = document.createElement("a"), u = URL.createObjectURL(blob);
      a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 40000);
      toast(t("toast.saved"));
    }, function () { toast(t("toast.makeFail")); });
  }
  function saveToPictures() {
    if (!cur) return;
    var F = fsApi();
    if (!F) { toast(t("toast.nofs")); return; }
    var fmt = cur.out.fmt, base = fileBase(), ext = "." + fmt;
    toast(t("toast.making"));
    makeBlob(fmt).then(function (blob) {
      function tryName(n) {
        var p = "/internal/Pictures/" + (n ? base + " (" + n + ")" : base) + ext;
        return F.stat(p).then(function () { return n < 99 ? tryName(n + 1) : Promise.reject(new Error("name")); }, function () { return p; });
      }
      return tryName(0).then(function (p) {
        return F.write(p, blob).then(function () { toast(t("toast.pics", { name: p.split("/").pop() })); });
      });
    }).catch(function () { toast(t("toast.picsFail")); });
  }
  // Bridge BR-MK-AT: the picture goes onto the orOS disk and Atelier
  // makes a new design of its size with it:
  // __orosOpenAt("atelier", { newPicture: { path, w, h, name } }).
  function openInAtelier() {
    var s = shell();
    if (!cur) return;
    if (!s || typeof s.__orosOpenAt !== "function") { toast(t("standalone")); return; }
    if (!AS || !fsApi()) { toast(t("toast.nofs")); return; }
    toast(t("toast.making"));
    makeBlob("png").then(function (blob) {
      var f;
      try { f = new File([blob], fileBase() + ".png", { type: "image/png" }); } catch (e) { f = blob; f.name = fileBase() + ".png"; }
      return AS.importFile(f).then(function (r) {
        s.__orosOpenAt("atelier", { newPicture: { path: AS.FOLDER + "/" + r.id, w: r.w, h: r.h, name: label(cur) } });
        toast(t("toast.atelier"));
      });
    }).catch(function () { toast(t("toast.makeFail")); });
  }

  // ---------- 7. Dialogs ----------
  var openDlg = null, lastFocus = null, askYes = null;
  function showDlg(id) {
    if (openDlg) hideDlg();
    lastFocus = document.activeElement;
    openDlg = $(id);
    $("scrim").hidden = false;
    openDlg.hidden = false;
    var f = openDlg.querySelector("button:not(.dlg-close)") || openDlg.querySelector("button");
    if (f) f.focus();
  }
  function hideDlg() {
    if (!openDlg) return;
    openDlg.hidden = true;
    $("scrim").hidden = true;
    openDlg = null;
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  function ask(text, yesLabel, fn) {
    $("ask-text").textContent = text;
    $("ask-yes").textContent = yesLabel;
    askYes = fn;
    showDlg("ask");
  }
  function duplicate() {
    hideDlg();
    if (!cur) return;
    if (saveTimer) saveNow();
    var src = clone(cur);
    newPrj(function (p) {
      p.bk = src.bk; p.art = src.art; p.sc = src.sc; p.out = src.out; p.unit = src.unit;
      p.nm = (label(src) + " " + t("copyOf")).slice(0, 80);
    });
    toast(t("toast.dup"));
  }
  function delPrj() {
    hideDlg();
    if (!cur) return;
    var id = cur.id;
    ask(t("ask.del", { name: label(cur) }), t("btn.delete"), function () {
      clearTimeout(saveTimer); saveTimer = 0;
      data = C.remove(data, id, Date.now());
      storeData();
      tDel(id);
      cur = null;
      showHome();
      toast(t("toast.deleted"));
    });
  }
  function resetCam() {
    hideDlg();
    var def = C.normScene({});
    change("scene", function (p) { p.sc.cam = def.cam; p.sc.light = def.light; p.sc.shadow = def.shadow; });
  }

  // ---------- 8. Sync slice, palette, deep link ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("mockups", sliceGet, sliceSet, C.DATA_KEY, C.merge);
  }
  function sliceGet() { return C.merge(data, null); }     // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.prj)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.merge(incoming, null);
      localStorage.setItem(C.DATA_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    if (cur && !saveTimer) {
      var p = C.byId(data, cur.id);
      if (!p) { showHome(); return; }
      if (p.m !== cur.m) { cur = clone(p); renderForm(); pushAll(); }
    } else if (!cur) renderHome();
  }
  // Deep links: { id } opens a mockup (search); { cover: {front, back,
  // spine, wrap, name, w, h} } makes a new one (Atelier, BR-AT-MK).
  function openTarget(target) {
    if (!target || typeof target !== "object") return false;
    if (target.cover) {
      var c = C.parseCover(target.cover);
      if (!c) return false;
      hideDlg();
      if (cur && saveTimer) saveNow();
      newPrj(function (p) {
        p.nm = c.name;
        if (c.w && c.h) { p.bk.w = c.w; p.bk.h = c.h; p.bk.trim = "custom"; }
        if (c.wrap) { p.art.mode = "wrap"; p.art.wrap = c.wrap; p.art.bleed = 0; }
        else { p.art.front = c.front; p.art.back = c.back; p.art.spine = c.spine; }
      });
      showTab("book");
      toast(t("toast.fromAtelier"));
      return true;
    }
    if (typeof target.id !== "string" || !C.byId(data, target.id)) return false;
    hideDlg();
    openPrj(target.id);
    return true;
  }
  window.__orosOpenAt = openTarget;

  // ---------- 9. Wiring & boot ----------
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app.name") + " · orOS";
    $("new-btn").innerHTML = ICON.plus; setLabel($("new-btn"), t("btn.new"));
    $("more-btn").innerHTML = ICON.more; setLabel($("more-btn"), t("btn.more"));
    $("back-btn").innerHTML = ICON.back; setLabel($("back-btn"), t("btn.back"));
    [].forEach.call(document.querySelectorAll(".dlg-close"), function (b) { b.innerHTML = ICON.close; setLabel(b, t("btn.close")); });
    $("f-bandC").setAttribute("aria-label", t("aria.bandC"));
    $("f-ribC").setAttribute("aria-label", t("aria.ribC"));
    $("tabs").setAttribute("aria-label", t("app.name"));
    $("stage").setAttribute("aria-label", t("cam.hint"));
  }
  function wire() {
    $("new-btn").addEventListener("click", function () { newPrj(); showTab("book"); });
    $("first-btn").addEventListener("click", function () { newPrj(); showTab("book"); });
    $("back-btn").addEventListener("click", showHome);
    $("more-btn").addEventListener("click", function () { showDlg("more"); });
    tabs.forEach(function (k) { $("tab-" + k).addEventListener("click", function () { showTab(k); }); });
    $("tabs").addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      var i = (tabs.indexOf(prefs.tab) + d + tabs.length) % tabs.length;
      showTab(tabs[i]); $("tab-" + tabs[i]).focus();
    });
    wireForm();
    wireStage();
    $("dup-btn").addEventListener("click", duplicate);
    $("del-btn").addEventListener("click", delPrj);
    $("reset-cam").addEventListener("click", resetCam);
    $("ask-no").addEventListener("click", hideDlg);
    $("ask-yes").addEventListener("click", function () { var f = askYes; askYes = null; hideDlg(); if (f) f(); });
    $("scrim").addEventListener("click", hideDlg);
    [].forEach.call(document.querySelectorAll(".dlg-close"), function (b) { b.addEventListener("click", hideDlg); });
    // Contract B: Ctrl+Alt+Shift belongs to the shell
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null; try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openDlg) { e.preventDefault(); hideDlg(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.shiftKey && e.code === "KeyS" && cur && !openDlg) { e.preventDefault(); savePicture(); }
    });
    window.addEventListener("pagehide", function () { if (saveTimer) saveNow(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && saveTimer) saveNow(); });
  }

  function boot() {
    load();
    fillSelects();
    applyI18n();
    renderViews();
    renderSwatches();
    inheritPalette();
    wire();
    registerSync();
    watchPalette();
    if (!shell()) toast(t("standalone"));
    var opened = false;
    try {
      var s = shell();
      if (s && typeof s.__orosTakeTarget === "function") {
        var pending = s.__orosTakeTarget("mockups");
        if (pending) opened = openTarget(pending);
      }
    } catch (e) {}
    if (!opened) {
      if (prefs.cur && C.byId(data, prefs.cur)) openPrj(prefs.cur);
      else showHome();
    }
    console.log("[orOS Mockups] v" + C.VERSION + " ready");
  }

  boot();
})();
