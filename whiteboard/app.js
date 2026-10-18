// ============================================================
// orOS Whiteboard — the app inside the shell frame
// An endless board of sticky notes, text, shapes, arrows that join
// them, pen lines, pictures and frames. The data model, drawing and
// geometry live in core.js (WhiteboardCore); this file is the screen.
// Boot order (OROS_BIBLE.md Part VI "Boot sequence"):
//   load → applyI18n → wire → registerSync → inheritPalette →
//   watchPalette → render → take a pending deep link.
// Every change by the user is one call to commit(rows), which is one
// undo step: rows = { id: new object | null }. A drag shows its
// result through `draft` (screen only) and commits once at the end.
// The view (pan, zoom) and the chosen board are device-local prefs
// ("oros-whiteboard-prefs"), never synced.
// User text goes in with textContent (SVG <tspan>s, the editor's
// value); innerHTML only takes the fixed icon markup below.
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("whiteboard/app.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var APP_ID = "whiteboard";
  var STORAGE_KEY = "oros-whiteboard-data";
  var PREFS_KEY = "oros-whiteboard-prefs";
  var IMG_TOTAL = 2000000;                  // chars of all pictures together
  var SVGNS = "http://www.w3.org/2000/svg";
  var C = window.WhiteboardCore;

  // ---------- 1. Language (every string in English and Greek) ----------
  var STR = {
    en: {
      "app.name": "Whiteboard",
      "board.first": "My board", "board.untitled": "Untitled board", "board.new": "New board",
      "boards.title": "Boards", "boards.rename": "Rename", "boards.delete": "Delete board",
      "boards.name": "Name", "boards.create": "Create", "boards.save": "Save", "boards.none": "No boards yet.",
      "boards.count": "{n} items", "boards.delAsk": "Delete the board “{name}” and everything on it? This also deletes it on your other devices.",
      "boards.deleted": "Board deleted",
      "tool.select": "Select and move (V)", "tool.hand": "Move around (H)", "tool.note": "Sticky note (N)",
      "tool.text": "Text (T)", "tool.shape": "Shape (S)", "tool.arrow": "Arrow (A)", "tool.pen": "Pen (P)",
      "tool.frame": "Frame (F)",
      "btn.undo": "Undo (Ctrl+Z)", "btn.redo": "Redo (Ctrl+Y)", "btn.pic": "Add a picture", "btn.export": "Export",
      "btn.zoomIn": "Zoom in", "btn.zoomOut": "Zoom out", "btn.zoom100": "Zoom to 100%", "btn.fit": "Show everything",
      "ctx.color": "Colour", "ctx.shape": "Shape", "ctx.fill": "Fill", "ctx.head": "Arrow heads", "ctx.dash": "Dashed line",
      "ctx.smaller": "Smaller text", "ctx.bigger": "Bigger text", "ctx.width": "Line width", "ctx.edit": "Edit text",
      "ctx.front": "Bring to front", "ctx.back": "Send to back", "ctx.dup": "Duplicate (Ctrl+D)", "ctx.del": "Delete",
      "ctx.exportFrame": "Export this frame",
      "c.yellow": "Yellow", "c.orange": "Orange", "c.pink": "Pink", "c.red": "Red", "c.purple": "Purple",
      "c.blue": "Blue", "c.teal": "Teal", "c.green": "Green", "c.gray": "Grey", "c.ink": "Black",
      "shp.rect": "Rectangle", "shp.round": "Rounded rectangle", "shp.ellipse": "Ellipse", "shp.diamond": "Diamond",
      "shp.tri": "Triangle", "f.none": "No fill", "f.soft": "Light fill", "f.solid": "Full colour",
      "hd.end": "One head", "hd.both": "Two heads", "hd.none": "No head",
      "w.thin": "Thin", "w.mid": "Medium", "w.thick": "Thick", "w.marker": "Marker",
      "k.note": "Sticky note", "k.text": "Text", "k.shape": "Shape", "k.arrow": "Arrow", "k.pen": "Pen line",
      "k.image": "Picture", "k.frame": "Frame",
      "frame.name": "Frame", "edit.ph": "Write…",
      "hint.empty": "Pick a tool on the left, then tap the board. Drag an empty spot to move around; pinch or Ctrl + wheel to zoom.",
      "hint.arrow": "Drag from one object to another to join them.",
      "hint.pen": "Draw with your finger, pen or mouse. Choose Select (V) when you are done.",
      "board.label": "Board “{name}”, {n} items. Tab goes through them, Enter edits, arrow keys move.",
      "live.sel": "{kind} selected: {text}", "live.selN": "{n} items selected", "live.none": "Nothing selected",
      "exp.title": "Export", "exp.format": "Format", "exp.what": "What", "exp.all": "Whole board",
      "exp.sel": "Selection", "exp.frame": "This frame", "exp.bg": "Background", "exp.paper": "Paper", "exp.clear": "Transparent",
      "exp.save": "Save", "exp.files": "Save in Files", "close": "Close", "cancel": "Cancel",
      "exp.empty": "There is nothing on this board to export yet.",
      "toast.exported": "Exported", "toast.saved": "Saved in Files › Whiteboard",
      "toast.noFiles": "The Files app is not available here.", "toast.big": "Too big for a picture. Export a frame or a selection instead.",
      "toast.pdfFail": "The PDF could not be made.", "toast.picBad": "This picture could not be read.",
      "toast.picBudget": "The pictures on your boards have reached their limit. Remove a picture first.",
      "toast.undo": "Undo", "toast.deleted": "Deleted", "toast.nothingUndo": "Nothing to undo", "toast.nothingRedo": "Nothing to redo",
      "toast.limit": "This board is full (2000 items). Start a new board.",
      "full": "This device is out of storage space. The change was not saved.",
      "drop": "Drop pictures here"
    },
    el: {
      "app.name": "Πίνακας ιδεών",
      "board.first": "Ο πίνακάς μου", "board.untitled": "Πίνακας χωρίς όνομα", "board.new": "Νέος πίνακας",
      "boards.title": "Πίνακες", "boards.rename": "Μετονομασία", "boards.delete": "Διαγραφή πίνακα",
      "boards.name": "Όνομα", "boards.create": "Δημιουργία", "boards.save": "Αποθήκευση", "boards.none": "Δεν υπάρχουν πίνακες ακόμα.",
      "boards.count": "{n} στοιχεία", "boards.delAsk": "Να διαγραφεί ο πίνακας «{name}» και ό,τι έχει; Διαγράφεται και στις άλλες συσκευές σου.",
      "boards.deleted": "Ο πίνακας διαγράφηκε",
      "tool.select": "Επιλογή και μετακίνηση (V)", "tool.hand": "Μετακίνηση στον πίνακα (H)", "tool.note": "Αυτοκόλλητο (N)",
      "tool.text": "Κείμενο (T)", "tool.shape": "Σχήμα (S)", "tool.arrow": "Βέλος (A)", "tool.pen": "Μολύβι (P)",
      "tool.frame": "Πλαίσιο (F)",
      "btn.undo": "Αναίρεση (Ctrl+Z)", "btn.redo": "Επανάληψη (Ctrl+Y)", "btn.pic": "Προσθήκη εικόνας", "btn.export": "Εξαγωγή",
      "btn.zoomIn": "Μεγέθυνση", "btn.zoomOut": "Σμίκρυνση", "btn.zoom100": "Ζουμ στο 100%", "btn.fit": "Δείξε τα όλα",
      "ctx.color": "Χρώμα", "ctx.shape": "Σχήμα", "ctx.fill": "Γέμισμα", "ctx.head": "Αιχμές βέλους", "ctx.dash": "Διακεκομμένη γραμμή",
      "ctx.smaller": "Μικρότερο κείμενο", "ctx.bigger": "Μεγαλύτερο κείμενο", "ctx.width": "Πάχος γραμμής", "ctx.edit": "Επεξεργασία κειμένου",
      "ctx.front": "Μπροστά απ' όλα", "ctx.back": "Πίσω απ' όλα", "ctx.dup": "Διπλότυπο (Ctrl+D)", "ctx.del": "Διαγραφή",
      "ctx.exportFrame": "Εξαγωγή αυτού του πλαισίου",
      "c.yellow": "Κίτρινο", "c.orange": "Πορτοκαλί", "c.pink": "Ροζ", "c.red": "Κόκκινο", "c.purple": "Μωβ",
      "c.blue": "Μπλε", "c.teal": "Γαλαζοπράσινο", "c.green": "Πράσινο", "c.gray": "Γκρι", "c.ink": "Μαύρο",
      "shp.rect": "Ορθογώνιο", "shp.round": "Στρογγυλεμένο ορθογώνιο", "shp.ellipse": "Έλλειψη", "shp.diamond": "Ρόμβος",
      "shp.tri": "Τρίγωνο", "f.none": "Χωρίς γέμισμα", "f.soft": "Απαλό γέμισμα", "f.solid": "Γεμάτο χρώμα",
      "hd.end": "Μία αιχμή", "hd.both": "Δύο αιχμές", "hd.none": "Χωρίς αιχμή",
      "w.thin": "Λεπτό", "w.mid": "Μεσαίο", "w.thick": "Χοντρό", "w.marker": "Μαρκαδόρος",
      "k.note": "Αυτοκόλλητο", "k.text": "Κείμενο", "k.shape": "Σχήμα", "k.arrow": "Βέλος", "k.pen": "Γραμμή μολυβιού",
      "k.image": "Εικόνα", "k.frame": "Πλαίσιο",
      "frame.name": "Πλαίσιο", "edit.ph": "Γράψε…",
      "hint.empty": "Διάλεξε ένα εργαλείο αριστερά και πάτησε στον πίνακα. Σύρε ένα κενό σημείο για να κινηθείς· τσίμπημα ή Ctrl + ροδέλα για ζουμ.",
      "hint.arrow": "Σύρε από ένα αντικείμενο σε άλλο για να τα ενώσεις.",
      "hint.pen": "Ζωγράφισε με το δάχτυλο, τη γραφίδα ή το ποντίκι. Διάλεξε Επιλογή (V) όταν τελειώσεις.",
      "board.label": "Πίνακας «{name}», {n} στοιχεία. Το Tab περνά από το ένα στο άλλο, το Enter ανοίγει το κείμενο, τα βελάκια μετακινούν.",
      "live.sel": "Επιλέχθηκε {kind}: {text}", "live.selN": "Επιλέχθηκαν {n} στοιχεία", "live.none": "Δεν υπάρχει επιλογή",
      "exp.title": "Εξαγωγή", "exp.format": "Μορφή", "exp.what": "Τι", "exp.all": "Όλος ο πίνακας",
      "exp.sel": "Η επιλογή", "exp.frame": "Αυτό το πλαίσιο", "exp.bg": "Φόντο", "exp.paper": "Χαρτί", "exp.clear": "Διάφανο",
      "exp.save": "Αποθήκευση", "exp.files": "Αποθήκευση στα Αρχεία", "close": "Κλείσιμο", "cancel": "Άκυρο",
      "exp.empty": "Δεν υπάρχει ακόμα τίποτα σε αυτόν τον πίνακα για εξαγωγή.",
      "toast.exported": "Η εξαγωγή έγινε", "toast.saved": "Αποθηκεύτηκε στα Αρχεία › Whiteboard",
      "toast.noFiles": "Η εφαρμογή Αρχεία δεν είναι διαθέσιμη εδώ.", "toast.big": "Πολύ μεγάλο για εικόνα. Κάνε εξαγωγή ενός πλαισίου ή μιας επιλογής.",
      "toast.pdfFail": "Το PDF δεν φτιάχτηκε.", "toast.picBad": "Αυτή η εικόνα δεν διαβάστηκε.",
      "toast.picBudget": "Οι εικόνες στους πίνακές σου έφτασαν το όριο. Αφαίρεσε πρώτα μια εικόνα.",
      "toast.undo": "Αναίρεση", "toast.deleted": "Διαγράφηκε", "toast.nothingUndo": "Δεν υπάρχει κάτι για αναίρεση", "toast.nothingRedo": "Δεν υπάρχει κάτι για επανάληψη",
      "toast.limit": "Ο πίνακας γέμισε (2000 στοιχεία). Ξεκίνα νέο πίνακα.",
      "full": "Ο χώρος αποθήκευσης της συσκευής γέμισε. Η αλλαγή δεν αποθηκεύτηκε.",
      "drop": "Άφησε εδώ τις εικόνες"
    }
  };

  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  if (window.orosI18n) window.orosI18n.table(STR, APP_ID, LANG);   // other languages: translators' packs
  function t(k, vars) {
    var s = (STR[LANG] || STR.en)[k] || STR.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }

  // ---------- 2. Data: local first, then sync ----------
  var data = C.empty();
  var prefs = { board: "", views: {}, tool: "select", note: "yellow", shape: "rect", line: "ink", pen: "ink", sw: 3, bg: "paper", fmt: "png" };

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function load() {
    try { data = C.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch (e) { data = C.empty(); }
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") Object.keys(prefs).forEach(function (k) {
        if (p[k] !== undefined && typeof p[k] === typeof prefs[k]) prefs[k] = p[k];
      });
    } catch (e) { /* defaults */ }
    if (["select", "hand", "pen"].indexOf(prefs.tool) < 0) prefs.tool = "select";
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, C.serialize(data)); return true; }
    catch (e) { toast(t("full")); return false; }
  }
  var prefsTimer = 0;
  function savePrefs() {
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(function () {
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* not kept */ }
    }, 300);
  }

  // Every edit by the user ends here: write, then tell sync.
  function save(next) {
    var before = data;
    data = next;
    if (!persist()) { data = before; render(); return false; }
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    render();
    return true;
  }

  function sliceGet() { return C.normalize(data); }
  function sliceSet(incoming) {
    var merged = C.merge(data, incoming);
    if (C.serialize(merged) === C.serialize(data)) return;
    data = merged;
    persist();
    if (board ? !C.board(data, board) : !!firstBoard()) openBoard(firstBoard());
    sel = sel.filter(function (id) { return !!objById(id); });
    render();
  }

  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    try { api.registerSlice(APP_ID, sliceGet, sliceSet, STORAGE_KEY, C.merge); }   // 5 args, always
    catch (e) { /* engine busy: the next boot registers again */ }
  }

  // ---------- 3. Palette: follow the shell's theme and skin (G3) ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--panel-bg", "--border", "--danger"];
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

  // ---------- 4. Helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function ic(p) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>";
  }
  var ICONS = {
    select: ic('<path d="M5 3l6 16 2.2-6.8L20 10z"/>'),
    hand: ic('<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v7.5a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3.3 14a1.5 1.5 0 0 1 2.4-1.8L8 15"/>'),
    note: ic('<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>'),
    text: ic('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
    shape: ic('<rect x="3" y="3" width="10" height="10" rx="1"/><circle cx="16" cy="16" r="5"/>'),
    arrow: ic('<path d="M5 19L19 5M10 5h9v9"/>'),
    pen: ic('<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>'),
    frame: ic('<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>'),
    image: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>'),
    undo: ic('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    redo: ic('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
    exp: ic('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
    plus: ic('<path d="M12 5v14M5 12h14"/>'),
    minus: ic('<path d="M5 12h14"/>'),
    fit: ic('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
    trash: ic('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
    dup: ic('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
    front: ic('<rect x="9" y="9" width="11" height="11" rx="1" fill="currentColor"/><path d="M15 5V4H4v11h1"/>'),
    back: ic('<rect x="4" y="4" width="11" height="11" rx="1" fill="currentColor"/><path d="M19 9h1v11H9v-1"/>'),
    edit: ic('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    dash: ic('<path d="M3 12h4M10 12h4M17 12h4"/>'),
    big: ic('<path d="M4 18L9 6l5 12M6 14h6M17 8v6M14 11h6"/>'),
    small: ic('<path d="M4 18L9 6l5 12M6 14h6M14 11h6"/>'),
    width: ic('<path d="M4 6h16" stroke-width="1"/><path d="M4 12h16" stroke-width="2.5"/><path d="M4 18h16" stroke-width="4"/>'),
    caret: ic('<path d="M6 9l6 6 6-6"/>'),
    boards: ic('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    rename: ic('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    s_rect: ic('<rect x="4" y="6" width="16" height="12"/>'),
    s_round: ic('<rect x="4" y="6" width="16" height="12" rx="4"/>'),
    s_ellipse: ic('<ellipse cx="12" cy="12" rx="9" ry="6"/>'),
    s_diamond: ic('<path d="M12 3l9 9-9 9-9-9z"/>'),
    s_tri: ic('<path d="M12 4l9 16H3z"/>'),
    h_end: ic('<path d="M4 12h16M14 6l6 6-6 6"/>'),
    h_both: ic('<path d="M4 12h16M14 6l6 6-6 6M10 6l-6 6 6 6"/>'),
    h_none: ic('<path d="M4 12h16"/>'),
    f_none: ic('<rect x="4" y="5" width="16" height="14" rx="2"/>'),
    f_soft: ic('<rect x="4" y="5" width="16" height="14" rx="2" fill="currentColor" fill-opacity=".3"/>'),
    f_solid: ic('<rect x="4" y="5" width="16" height="14" rx="2" fill="currentColor"/>')
  };
  function iconBtn(cls, icon, lbl, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = ICONS[icon];                // static icon markup only
    b.setAttribute("aria-label", lbl);
    b.title = lbl;
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function textBtn(cls, lbl, fn) {
    var b = el("button", cls, lbl);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function setIcon(id, icon, lbl) {
    var b = $(id);
    b.innerHTML = ICONS[icon];                // static icon markup only
    b.setAttribute("aria-label", lbl);
    b.title = lbl;
  }

  var toastTimer = 0;
  function toast(msg, onUndo) {
    if (!onUndo) {
      try {
        var nt = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
        if (nt && typeof nt.transient === "function" && nt.transient({ ns: APP_ID, title: String(msg) })) return;
      } catch (e) { /* standalone */ }
    }
    var box = $("toast");
    box.textContent = "";
    box.appendChild(el("span", "", msg));
    if (onUndo) {
      var b = textBtn("toast-btn", t("toast.undo"), function () { box.classList.remove("show"); onUndo(); });
      box.appendChild(b);
    }
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 6000 : 3000);
  }
  function say(msg) { var l = $("live"); l.textContent = ""; setTimeout(function () { l.textContent = msg; }, 30); }

  // Text widths for wrapping, with the same font the board draws in.
  var mctx = null, mcache = {};
  function measure(s, fs) {
    var key = fs + "|" + s;
    if (mcache[key] !== undefined) return mcache[key];
    if (!mctx) { try { mctx = document.createElement("canvas").getContext("2d"); } catch (e) { mctx = null; } }
    var w;
    if (mctx) { mctx.font = fs + "px " + C.FONT; w = mctx.measureText(s).width; }
    else w = s.length * fs * 0.56;
    if (Object.keys(mcache).length > 4000) mcache = {};
    mcache[key] = w;
    return w;
  }

  // ---------- 5. State ----------
  var board = "";                  // current board id ("" = none yet)
  var view = { x: 0, y: 0, s: 1 }; // screen = world * s + (x, y)
  var sel = [];                    // selected ids
  var tool = "select";
  var draft = {};                  // id → object | null, screen only
  var gesture = null;
  var editing = null;              // { id, obj (new), fresh }
  var hist = {};                   // board id → { u: [], r: [] }
  var clip = null;                 // copied objects (this tab only)
  var MAX_OBJS = 2000;

  function firstBoard() {
    var list = C.boards(data);
    if (!list.length) return "";
    if (prefs.board && C.board(data, prefs.board)) return prefs.board;
    return list.slice().sort(function (a, b) { return b.m - a.m; })[0].id;
  }
  function objs() { return board ? C.objsOf(data, board) : []; }
  function objById(id) {
    for (var i = 0; i < data.objs.length; i++) if (data.objs[i].id === id && data.objs[i].b === board) return data.objs[i];
    return null;
  }
  function cur(id) { return Object.prototype.hasOwnProperty.call(draft, id) ? draft[id] : objById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function newId() { return C.uid(); }
  function H() { return hist[board] || (hist[board] = { u: [], r: [] }); }

  function openBoard(id) {
    if (board && view) { prefs.views[board] = { x: view.x, y: view.y, s: view.s }; }
    board = id || "";
    prefs.board = board;
    sel = [];
    draft = {};
    var v = board && prefs.views[board];
    if (v && typeof v.s === "number") view = { x: v.x, y: v.y, s: v.s };
    else { view = { x: 0, y: 0, s: 1 }; if (board) setTimeout(fit, 0); }
    savePrefs();
    render();
  }

  // The board on first use: made with the first object, so opening
  // the app on a new device never adds an empty board to sync.
  function ensureBoard() {
    if (board && C.board(data, board)) return true;
    var id = newId();
    if (!save(C.putBoard(data, id, t("board.first"), Date.now()))) return false;
    board = id;
    prefs.board = id;
    savePrefs();
    return true;
  }

  // One undo step. rows = { id: object | null }.
  function commit(rows, noHist) {
    var ids = Object.keys(rows);
    if (!ids.length) return false;
    if (!ensureBoard()) return false;
    var before = {}, adds = 0;
    ids.forEach(function (id) {
      var o = objById(id);
      before[id] = o ? clone(o) : null;
      if (!o && rows[id]) adds++;
      if (rows[id]) rows[id].b = board;
    });
    if (adds && objs().length + adds > MAX_OBJS) { toast(t("toast.limit")); return false; }
    if (!save(C.apply(data, rows, Date.now()))) return false;
    if (!noHist) {
      var h = H();
      h.u.push({ before: before, after: clone(rows) });
      if (h.u.length > 100) h.u.shift();
      h.r = [];
    }
    updateButtons();
    return true;
  }
  function undo() {
    var h = H(), step = h.u.pop();
    if (!step) { toast(t("toast.nothingUndo")); return; }
    endEdit(true);
    if (commit(clone(step.before), true)) h.r.push(step);
    sel = sel.filter(function (id) { return !!objById(id); });
    render();
  }
  function redo() {
    var h = H(), step = h.r.pop();
    if (!step) { toast(t("toast.nothingRedo")); return; }
    endEdit(true);
    if (commit(clone(step.after), true)) h.u.push(step);
    sel = sel.filter(function (id) { return !!objById(id); });
    render();
  }

  // ---------- 6. Drawing ----------
  var cache = {};                  // id → { key, node }
  function keyOf(nd) {
    return JSON.stringify(nd, function (k, v) { return k === "href" ? v.length + ":" + v.slice(-40) : v; });
  }
  function build(nd) {
    var e = document.createElementNS(SVGNS, nd.tag);
    Object.keys(nd.a).forEach(function (k) { e.setAttribute(k, nd.a[k]); });
    if (nd.text !== undefined) e.textContent = nd.text;
    (nd.kids || []).forEach(function (k) { e.appendChild(build(k)); });
    return e;
  }

  var raf = 0;
  function render() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; paint(); });
  }
  function paint() {
    var layer = $("objs"), list = objs();
    var nodes = C.scene(list, { measure: measure, live: true, draft: draft, frameName: t("frame.name") });
    var keep = {};
    nodes.forEach(function (nd, i) {
      var id = nd.a["data-id"], key = keyOf(nd), c = cache[id];
      if (!c || c.key !== key) {
        var e = build(nd);
        if (c && c.node.parentNode) c.node.parentNode.replaceChild(e, c.node);
        c = cache[id] = { key: key, node: e };
      }
      if (editing && editing.id === id) c.node.setAttribute("opacity", "0.25"); else c.node.removeAttribute("opacity");
      keep[id] = 1;
      if (layer.childNodes[i] !== c.node) layer.insertBefore(c.node, layer.childNodes[i] || null);
    });
    Object.keys(cache).forEach(function (id) {
      if (!keep[id]) { if (cache[id].node.parentNode) cache[id].node.parentNode.removeChild(cache[id].node); delete cache[id]; }
    });
    paintView();
    paintUi();
    renderCtx();
    renderTools();
    updateButtons();
    var b = board && C.board(data, board);
    $("board-name").textContent = b ? (b.name || t("board.untitled")) : t("app.name");
    var hint = $("hint");
    var msg = !list.length && !gesture ? t("hint.empty") : tool === "arrow" && !gesture ? t("hint.arrow") :
      tool === "pen" && !gesture && !list.length ? t("hint.pen") : "";
    hint.textContent = msg;
    hint.hidden = !msg;
    $("svg").setAttribute("aria-label", t("board.label", { name: b ? b.name || t("board.untitled") : t("app.name"), n: list.length }));
  }
  function paintView() {
    $("vp").setAttribute("transform", "translate(" + view.x + " " + view.y + ") scale(" + view.s + ")");
    $("zoom-pct").textContent = Math.round(view.s * 100) + "%";
    var g = Math.max(8, 24 * view.s);
    var st = $("stage").style;
    st.backgroundSize = g + "px " + g + "px";
    st.backgroundPosition = view.x + "px " + view.y + "px";
    if (editing) placeEditor();
  }

  function sv(tag, a) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); });
    return e;
  }
  // Selection outlines and handles, drawn at a steady size on screen.
  function paintUi() {
    var ui = $("ui");
    ui.textContent = "";
    var list = objs().map(function (o) { return cur(o.id); }).filter(Boolean);
    Object.keys(draft).forEach(function (id) { if (draft[id] && !objById(id)) list.push(draft[id]); });
    var m = C.index(list), px = 1 / view.s, hs = (isTouch ? 11 : 7) * px;
    sel.forEach(function (id) {
      var o = m[id];
      if (!o) return;
      if (o.k === "arrow") {
        var e = C.ends(o, m);
        if (sel.length === 1) {
          [["a", e.a], ["b", e.b]].forEach(function (p) {
            ui.appendChild(sv("circle", { cx: p[1].x, cy: p[1].y, r: hs, "class": "hd", "data-h": p[0], "stroke-width": 1.5 * px }));
          });
        } else {
          ui.appendChild(sv("path", { d: "M" + e.a.x + " " + e.a.y + "L" + e.b.x + " " + e.b.y, "class": "sel", "stroke-width": 6 * px }));
        }
        return;
      }
      var b = C.box(o, m, measure);
      ui.appendChild(sv("rect", { x: b.x - 4 * px, y: b.y - 4 * px, width: b.w + 8 * px, height: b.h + 8 * px,
        "class": "sel", "stroke-width": 1.5 * px, "stroke-dasharray": (5 * px) + " " + (4 * px) }));
      if (sel.length === 1 && !gesture) {
        var hx = b.x + b.w + 4 * px, hy = b.y + b.h + 4 * px;
        if (o.k === "frame") { hx = o.x + o.w; hy = o.y + o.h; }
        ui.appendChild(sv("rect", { x: hx - hs, y: hy - hs, width: hs * 2, height: hs * 2, rx: 2 * px, "class": "hd", "data-h": "se", "stroke-width": 1.5 * px }));
      }
    });
    if (gesture && gesture.type === "marquee" && gesture.rect) {
      var r = gesture.rect;
      ui.appendChild(sv("rect", { x: r.x, y: r.y, width: r.w, height: r.h, "class": "marq", "stroke-width": px }));
    }
    if (gesture && gesture.type === "end" && gesture.target) {
      var to = m[gesture.target];
      if (to) { var tb = C.box(to, m, measure); ui.appendChild(sv("rect", { x: tb.x - 6 * px, y: tb.y - 6 * px, width: tb.w + 12 * px, height: tb.h + 12 * px, rx: 6 * px, "class": "snap", "stroke-width": 2 * px })); }
    }
  }

  // ---------- 7. View ----------
  function stageRect() { return $("svg").getBoundingClientRect(); }
  function toWorld(cx, cy) {
    var r = stageRect();
    return { x: (cx - r.left - view.x) / view.s, y: (cy - r.top - view.y) / view.s };
  }
  function zoomAt(f, cx, cy) {
    var r = stageRect(), s = Math.max(0.1, Math.min(4, view.s * f));
    var sx = cx === undefined ? r.width / 2 : cx - r.left, sy = cy === undefined ? r.height / 2 : cy - r.top;
    view.x = sx - (sx - view.x) * (s / view.s);
    view.y = sy - (sy - view.y) * (s / view.s);
    view.s = s;
    viewChanged();
  }
  function viewChanged() {
    if (board) { prefs.views[board] = { x: Math.round(view.x), y: Math.round(view.y), s: Math.round(view.s * 1000) / 1000 }; savePrefs(); }
    paintView();
    paintUi();
  }
  function fit() {
    var r = stageRect(), b = C.bounds(objs(), measure, 40);
    if (!b) { view = { x: r.width / 2, y: r.height / 2, s: 1 }; viewChanged(); return; }
    var s = Math.max(0.1, Math.min(1.5, (r.width - 80) / b.w, (r.height - 120) / b.h));
    view.s = s;
    view.x = r.width / 2 - (b.x + b.w / 2) * s;
    view.y = r.height / 2 - (b.y + b.h / 2) * s;
    viewChanged();
  }
  // Brings an object into view (deep links, Tab).
  function reveal(id, center) {
    var o = objById(id);
    if (!o) return;
    var r = stageRect(), b = C.box(o, C.index(objs()), measure);
    var sx = b.x * view.s + view.x, sy = b.y * view.s + view.y;
    if (center || sx < 60 || sy < 60 || sx + b.w * view.s > r.width - 20 || sy + b.h * view.s > r.height - 60) {
      if (center && view.s < 0.6) view.s = 1;
      view.x = r.width / 2 - (b.x + b.w / 2) * view.s;
      view.y = r.height / 2 - (b.y + b.h / 2) * view.s;
      viewChanged();
    }
  }

  // ---------- 8. Pointer gestures ----------
  var isTouch = false;
  var pts = {};                    // pointerId → { x, y }
  var lastTap = { id: "", at: 0 };

  function hitId(target) {
    var n = target && target.closest ? target.closest("[data-id]") : null;
    return n ? n.getAttribute("data-id") : "";
  }
  function objAtPoint(cx, cy, skip) {
    var list = document.elementsFromPoint ? document.elementsFromPoint(cx, cy) : [document.elementFromPoint(cx, cy)];
    for (var i = 0; i < list.length; i++) {
      var id = hitId(list[i]);
      if (!id || id === skip) continue;
      var o = cur(id);
      if (o && o.k !== "arrow" && o.k !== "pen") return id;
    }
    return "";
  }

  function onDown(e) {
    if (e.button !== undefined && e.button > 1) return;
    isTouch = e.pointerType === "touch" || e.pointerType === "pen";
    closePop();
    if (editing) { endEdit(); }
    $("svg").focus({ preventScroll: true });
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { $("svg").setPointerCapture(e.pointerId); } catch (err) { /* old browser */ }
    var ids = Object.keys(pts);
    if (ids.length === 2) {                  // a second finger: pinch, and drop what the first one started
      cancelGesture();
      var a = pts[ids[0]], b = pts[ids[1]];
      gesture = { type: "pinch", d: dist(a, b), mid: mid(a, b), view: { x: view.x, y: view.y, s: view.s } };
      return;
    }
    if (ids.length > 2) return;
    e.preventDefault();
    var w = toWorld(e.clientX, e.clientY);
    var start = { cx: e.clientX, cy: e.clientY, w: w, at: Date.now(), moved: false };
    var handle = e.target && e.target.getAttribute ? e.target.getAttribute("data-h") : "";
    if (e.button === 1 || tool === "hand" || spaceDown) { gesture = Object.assign(start, { type: "pan", view: { x: view.x, y: view.y } }); return; }
    if (handle && sel.length === 1) {
      var o = objById(sel[0]);
      if (o && (handle === "a" || handle === "b")) { gesture = Object.assign(start, { type: "end", id: o.id, end: handle, orig: clone(o) }); return; }
      if (o && handle === "se") { gesture = Object.assign(start, { type: "resize", id: o.id, orig: clone(o) }); return; }
    }
    var id = hitId(e.target);
    if (tool === "select") {
      if (id) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          sel = sel.indexOf(id) >= 0 ? sel.filter(function (x) { return x !== id; }) : sel.concat([id]);
          announce();
          render();
          if (sel.indexOf(id) < 0) return;
        } else if (sel.indexOf(id) < 0) { sel = [id]; announce(); }
        gesture = Object.assign(start, { type: "move", ids: moveSet(sel), hit: id });
        render();
        return;
      }
      if (!e.shiftKey) { if (sel.length) { sel = []; announce(); } }
      gesture = isTouch && !e.shiftKey ? Object.assign(start, { type: "pan", view: { x: view.x, y: view.y } })
        : Object.assign(start, { type: "marquee", rect: null, base: e.shiftKey ? sel.slice() : [] });
      render();
      return;
    }
    if (tool === "note" || tool === "text") { gesture = Object.assign(start, { type: "tap", kind: tool }); return; }
    if (tool === "shape" || tool === "frame") {
      gesture = Object.assign(start, { type: "create", kind: tool, id: newId() });
      return;
    }
    if (tool === "arrow") {
      var from = objAtPoint(e.clientX, e.clientY, "");
      gesture = Object.assign(start, { type: "create", kind: "arrow", id: newId(), from: from });
      return;
    }
    if (tool === "pen") {
      gesture = Object.assign(start, { type: "pen", id: newId(), abs: [r1(w.x), r1(w.y)] });
      draft[gesture.id] = C.penFrom(gesture.abs, { id: gesture.id, b: board || "-", c: prefs.pen, sw: prefs.sw, z: zTop() });
      render();
    }
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)) || 1; }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function zTop() { return board ? C.zTop(data, board) : 1; }

  // What moves with a selection: frames carry what lies inside them.
  function moveSet(ids) {
    var list = objs(), out = {};
    ids.forEach(function (id) {
      out[id] = 1;
      var o = objById(id);
      if (o && o.k === "frame") C.inFrame(list, o, measure).forEach(function (x) { out[x.id] = 1; });
    });
    return Object.keys(out);
  }

  function onMove(e) {
    if (!pts[e.pointerId]) return;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var g = gesture;
    if (!g) return;
    if (g.type === "pinch") {
      var ids = Object.keys(pts);
      if (ids.length < 2) return;
      var a = pts[ids[0]], b = pts[ids[1]], m = mid(a, b), r = stageRect();
      var s = Math.max(0.1, Math.min(4, g.view.s * dist(a, b) / g.d));
      var wx = (g.mid.x - r.left - g.view.x) / g.view.s, wy = (g.mid.y - r.top - g.view.y) / g.view.s;
      view.s = s;
      view.x = m.x - r.left - wx * s;
      view.y = m.y - r.top - wy * s;
      viewChanged();
      return;
    }
    var dx = e.clientX - g.cx, dy = e.clientY - g.cy;
    if (!g.moved && Math.abs(dx) + Math.abs(dy) < (isTouch ? 8 : 4)) return;
    g.moved = true;
    var w = toWorld(e.clientX, e.clientY), wdx = w.x - g.w.x, wdy = w.y - g.w.y;
    if (g.type === "pan") {
      view.x = g.view.x + dx; view.y = g.view.y + dy;
      viewChanged();
      return;
    }
    if (g.type === "move") {
      draft = {};
      g.ids.forEach(function (id) { var o = objById(id); if (o) draft[id] = C.moved(o, wdx, wdy); });
    } else if (g.type === "resize") {
      var o0 = g.orig, nw = o0.w + wdx, nh = o0.h + wdy;
      if (o0.k === "image" || (o0.k === "pen" && e.shiftKey)) { var k = Math.max(nw / o0.w, nh / o0.h); nw = o0.w * k; nh = o0.h * k; }
      if (o0.k === "text") nh = o0.h;
      draft = {};
      draft[g.id] = C.resized(o0, Math.max(o0.k === "text" ? 40 : 16, nw), Math.max(16, nh));
    } else if (g.type === "end") {
      var ar = clone(g.orig), tgt = objAtPoint(e.clientX, e.clientY, "");
      if (g.end === "a") { ar.ax = r1(w.x); ar.ay = r1(w.y); ar.ao = ""; } else { ar.bx = r1(w.x); ar.by = r1(w.y); ar.bo = ""; }
      g.target = tgt && tgt !== (g.end === "a" ? ar.bo : ar.ao) ? tgt : "";
      draft = {};
      draft[g.id] = ar;
    } else if (g.type === "create") {
      draft = {};
      draft[g.id] = shapeFrom(g, w);
      if (g.kind === "arrow") g.target = objAtPoint(e.clientX, e.clientY, g.from) || "";
    } else if (g.type === "pen") {
      var last = g.abs.length - 2;
      if (Math.abs(w.x - g.abs[last]) + Math.abs(w.y - g.abs[last + 1]) < 1.5 / view.s) return;
      if (g.abs.length >= C.MAX_PTS * 4) return;
      g.abs.push(r1(w.x), r1(w.y));
      draft[g.id] = C.penFrom(g.abs, draft[g.id]);
    } else if (g.type === "marquee") {
      g.rect = { x: Math.min(g.w.x, w.x), y: Math.min(g.w.y, w.y), w: Math.abs(wdx), h: Math.abs(wdy) };
      var hit = C.inRect(objs(), g.rect, measure);
      sel = g.base.concat(hit.filter(function (id) { return g.base.indexOf(id) < 0; }));
    }
    render();
  }

  function shapeFrom(g, w) {
    if (g.kind === "arrow") {
      return { id: g.id, b: board || "-", k: "arrow", ax: r1(g.w.x), ay: r1(g.w.y), bx: r1(w.x), by: r1(w.y),
        ao: g.from || "", bo: "", hd: "end", c: prefs.line, z: zTop() };
    }
    var x = Math.min(g.w.x, w.x), y = Math.min(g.w.y, w.y), ww = Math.max(16, Math.abs(w.x - g.w.x)), hh = Math.max(16, Math.abs(w.y - g.w.y));
    if (g.kind === "frame") return { id: g.id, b: board || "-", k: "frame", x: r1(x), y: r1(y), w: r1(ww), h: r1(hh), tx: "", c: "gray", z: 0 };
    return { id: g.id, b: board || "-", k: "shape", shp: prefs.shape, f: "soft", c: prefs.line === "ink" ? "blue" : prefs.line,
      x: r1(x), y: r1(y), w: r1(ww), h: r1(hh), tx: "", z: zTop() };
  }

  function onUp(e) {
    if (!pts[e.pointerId]) return;
    delete pts[e.pointerId];
    var g = gesture;
    if (!g) return;
    if (g.type === "pinch") { if (!Object.keys(pts).length) gesture = null; return; }
    gesture = null;
    var w = toWorld(e.clientX, e.clientY), rows = {};
    if (g.type === "move") {
      if (g.moved) { Object.keys(draft).forEach(function (id) { rows[id] = draft[id]; }); draft = {}; commit(rows); }
      else {
        draft = {};
        var now = Date.now();
        if (lastTap.id === g.hit && now - lastTap.at < 400) { lastTap = { id: "", at: 0 }; startEdit(g.hit); }
        else lastTap = { id: g.hit, at: now };
      }
    } else if (g.type === "resize") {
      if (g.moved && draft[g.id]) { rows[g.id] = draft[g.id]; draft = {}; commit(rows); } else draft = {};
    } else if (g.type === "end") {
      var ar = draft[g.id];
      draft = {};
      if (g.moved && ar) {
        if (g.target) { if (g.end === "a") ar.ao = g.target; else ar.bo = g.target; }
        rows[g.id] = keepEnds(ar);
        commit(rows);
      }
    } else if (g.type === "tap") {
      if (!g.moved) addAt(g.kind, w);
    } else if (g.type === "create") {
      var o = draft[g.id];
      draft = {};
      if (g.kind === "arrow") {
        if (!g.moved || !o) { toast(t("hint.arrow")); render(); return; }
        if (g.target) o.bo = g.target;
        rows[g.id] = keepEnds(o);
        if (commit(rows)) { sel = [g.id]; setTool("select"); }
      } else {
        if (!g.moved) {
          o = shapeFrom(g, { x: g.w.x + (g.kind === "frame" ? 480 : 160), y: g.w.y + (g.kind === "frame" ? 320 : 110) });
          o.x -= o.w / 2; o.y -= o.h / 2;
        }
        rows[g.id] = o;
        if (commit(rows)) { sel = [g.id]; setTool("select"); if (g.kind === "shape" && !g.moved) startEdit(g.id); }
      }
    } else if (g.type === "pen") {
      var p = draft[g.id];
      delete draft[g.id];
      if (p) {
        var simple = C.simplify(g.abs, 0.6 / view.s);
        if (simple.length > C.MAX_PTS) simple = simple.slice(0, C.MAX_PTS);
        rows[g.id] = C.penFrom(simple, p);
        commit(rows);
      }
    } else if (g.type === "marquee") {
      announce();
    } else if (g.type === "pan") {
      if (!g.moved && tool === "select") {
        if (sel.length) { sel = []; announce(); }
        var at = Date.now();            // a double tap on an empty spot: a sticky note there
        if (isTouch && lastTap.id === "@" && at - lastTap.at < 400) { lastTap = { id: "", at: 0 }; addAt("note", w); }
        else lastTap = { id: "@", at: at };
      }
    }
    render();
  }

  // An arrow stuck to an object also keeps where it last pointed, so
  // it stays where it was if the object goes.
  function keepEnds(ar) {
    var m = C.index(objs().concat([ar]));
    var e = C.ends(ar, m);
    ar.ax = r1(e.a.x); ar.ay = r1(e.a.y); ar.bx = r1(e.b.x); ar.by = r1(e.b.y);
    if (ar.ao && ar.ao === ar.bo) ar.bo = "";
    return ar;
  }

  function cancelGesture() {
    if (gesture && gesture.type === "move" && gesture.moved) {
      var rows = {};
      Object.keys(draft).forEach(function (id) { rows[id] = draft[id]; });
      draft = {};
      commit(rows);
    }
    gesture = null;
    draft = {};
    render();
  }

  function addAt(kind, w) {
    var id = newId(), o;
    if (kind === "note") o = { id: id, b: board || "-", k: "note", x: r1(w.x - 100), y: r1(w.y - 100), w: 200, h: 200, tx: "", c: prefs.note, z: zTop() };
    else o = { id: id, b: board || "-", k: "text", x: r1(w.x), y: r1(w.y - 14), w: 280, h: 30, fs: 24, tx: "", c: prefs.line, z: zTop() };
    setTool("select");
    sel = [id];
    draft[id] = o;
    startEdit(id, true);
  }

  // ---------- 9. Text editor ----------
  function editable(o) { return o && (o.k === "note" || o.k === "text" || o.k === "shape" || o.k === "frame" || o.k === "arrow"); }
  function startEdit(id, fresh) {
    var o = cur(id);
    if (!editable(o)) return;
    endEdit();
    editing = { id: id, fresh: !!fresh, obj: clone(o) };
    var ed = $("editor");
    ed.value = o.tx || "";
    ed.placeholder = o.k === "frame" ? t("frame.name") : t("edit.ph");
    ed.maxLength = o.k === "frame" || o.k === "arrow" ? 120 : C.MAX_TEXT;
    ed.className = "ed-" + o.k;
    ed.hidden = false;
    placeEditor();
    ed.focus();
    ed.select();
    render();
  }
  function placeEditor() {
    var o = editing.obj, ed = $("editor"), s = view.s, st = ed.style, x, y, w, h, fs;
    if (o.k === "arrow") {
      var e = C.ends(o, C.index(objs())), mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2;
      w = 200; h = 34; fs = 14; x = mx - 100; y = my - 17;
    } else if (o.k === "frame") { x = o.x; y = o.y - 30; w = Math.max(160, o.w); h = 28; fs = 14; }
    else if (o.k === "text") { x = o.x; y = o.y; w = o.w; h = Math.max(o.fs * C.LH, C.textHeight(Object.assign({}, o, { tx: ed.value }), measure)) + 4; fs = o.fs; }
    else { x = o.x; y = o.y; w = o.w; h = o.h; fs = Math.min(24, Math.max(14, o.h / 8)); }
    st.left = (x * s + view.x) + "px";
    st.top = (y * s + view.y) + "px";
    st.width = Math.max(120, w * s) + "px";
    st.height = Math.max(28, h * s) + "px";
    st.fontSize = Math.max(11, fs * s) + "px";
    st.background = o.k === "note" ? C.COLORS[o.c][1] : "";
  }
  function endEdit(cancel) {
    if (!editing) return;
    var e = editing, ed = $("editor");
    editing = null;
    ed.hidden = true;
    delete draft[e.id];
    var o = clone(e.obj), was = objById(e.id);
    var text = ed.value.replace(/\r/g, "");
    if (o.k === "frame" || o.k === "arrow") text = text.replace(/\s+/g, " ").trim();
    if (!cancel) {
      if (o.k === "text" && !text.trim()) {
        if (was) { var del = {}; del[e.id] = null; commit(del); }
        sel = sel.filter(function (x) { return x !== e.id; });
      } else if (!was || text !== (was.tx || "")) {
        o.tx = text;
        if (o.k === "text") o.h = Math.round(C.textHeight(o, measure));
        var rows = {};
        rows[e.id] = o;
        commit(rows);
      }
    } else if (!was) sel = sel.filter(function (x) { return x !== e.id; });
    render();
    $("svg").focus({ preventScroll: true });
  }

  // ---------- 10. Toolbars ----------
  var TOOLS = ["select", "hand", "note", "text", "shape", "arrow", "pen", "frame"];
  function setTool(tl) {
    tool = tl;
    if (tl === "select" || tl === "hand" || tl === "pen") { prefs.tool = tl; savePrefs(); }
    if (tl !== "select") { sel = []; }
    $("svg").setAttribute("data-tool", tl);
    render();
  }
  function renderTools() {
    var bar = $("tools");
    if (!bar.childNodes.length) {
      TOOLS.forEach(function (tl) {
        var b = iconBtn("icon-btn", tl, t("tool." + tl), function () { setTool(tl); });
        b.dataset.tool = tl;
        bar.appendChild(b);
      });
    }
    [].forEach.call(bar.children, function (b) { b.setAttribute("aria-pressed", b.dataset.tool === tool ? "true" : "false"); });
  }

  // The bar above the board: for the selection, or for the tool's
  // next object when nothing is selected.
  var popOpen = null;
  function closePop() { if (popOpen) { popOpen.remove(); popOpen = null; } }
  function pop(anchor, items) {
    closePop();
    var p = el("div", "pop");
    p.setAttribute("role", "menu");
    items.forEach(function (it) { p.appendChild(it); });
    document.body.appendChild(p);
    var r = anchor.getBoundingClientRect(), pw = p.offsetWidth;
    p.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + "px";
    p.style.top = (r.bottom + 6) + "px";
    popOpen = p;
    var first = p.querySelector("button");
    if (first) first.focus();
  }
  function swatch(c, fn) {
    var b = el("button", "sw");
    b.type = "button";
    b.style.background = C.COLORS[c][0];
    b.setAttribute("aria-label", t("c." + c));
    b.title = t("c." + c);
    b.setAttribute("role", "menuitem");
    b.addEventListener("click", function () { closePop(); fn(c); });
    return b;
  }
  function choice(icon, lbl, fn) {
    var b = iconBtn("icon-btn", icon, lbl, function () { closePop(); fn(); });
    b.setAttribute("role", "menuitem");
    return b;
  }
  // Applies f(copy) to every selected object of the kinds given.
  function each(kinds, f) {
    var rows = {};
    sel.forEach(function (id) {
      var o = objById(id);
      if (!o || (kinds && kinds.indexOf(o.k) < 0)) return;
      var c = clone(o);
      if (f(c) !== false) rows[id] = c;
    });
    commit(rows);
  }
  var WIDTHS = [[2, "w.thin"], [3, "w.mid"], [6, "w.thick"], [12, "w.marker"]];

  function renderCtx() {
    var bar = $("ctx");
    if (gesture && gesture.moved) { bar.hidden = true; return; }
    bar.textContent = "";
    var list = sel.map(objById).filter(Boolean);
    var kinds = {};
    list.forEach(function (o) { kinds[o.k] = 1; });
    var add = function (b) { bar.appendChild(b); return b; };
    var colorOf = list.length ? list[0].c : tool === "note" ? prefs.note : tool === "pen" ? prefs.pen : prefs.line;
    function colorBtn(apply) {
      var b = el("button", "icon-btn sw-btn");
      b.type = "button";
      b.setAttribute("aria-label", t("ctx.color"));
      b.title = t("ctx.color");
      b.setAttribute("aria-haspopup", "menu");
      var dot = el("span", "dot");
      dot.style.background = C.COLORS[colorOf] ? C.COLORS[colorOf][0] : C.COLORS.ink[0];
      b.appendChild(dot);
      b.addEventListener("click", function () { pop(b, C.COLOR_KEYS.map(function (c) { return swatch(c, apply); })); });
      return add(b);
    }
    if (!list.length) {
      if (tool === "note") colorBtn(function (c) { prefs.note = c; savePrefs(); render(); });
      else if (tool === "pen") {
        colorBtn(function (c) { prefs.pen = c; savePrefs(); render(); });
        widthBtn(function (w) { prefs.sw = w; savePrefs(); });
      } else if (tool === "shape") {
        shapeBtn(prefs.shape, function (s) { prefs.shape = s; savePrefs(); render(); });
        colorBtn(function (c) { prefs.line = c; savePrefs(); render(); });
      } else if (tool === "text" || tool === "arrow") colorBtn(function (c) { prefs.line = c; savePrefs(); render(); });
      bar.hidden = !bar.childNodes.length;
      return;
    }
    if (!kinds.image || Object.keys(kinds).length > 1) {
      colorBtn(function (c) {
        each(null, function (o) { if (o.k === "image") return false; o.c = c; });
        if (kinds.note) prefs.note = c;
        if (kinds.pen) prefs.pen = c;
        if (kinds.text || kinds.arrow) prefs.line = c;
        savePrefs();
      });
    }
    if (kinds.shape) {
      var s0 = list.filter(function (o) { return o.k === "shape"; })[0];
      shapeBtn(s0.shp, function (s) { prefs.shape = s; savePrefs(); each(["shape"], function (o) { o.shp = s; }); });
      var fb = add(iconBtn("icon-btn", "f_" + s0.f, t("ctx.fill"), function () {
        pop(fb, C.FILLS.map(function (f) { return choice("f_" + f, t("f." + f), function () { each(["shape"], function (o) { o.f = f; }); }); }));
      }));
      fb.setAttribute("aria-haspopup", "menu");
    }
    if (kinds.arrow) {
      var a0 = list.filter(function (o) { return o.k === "arrow"; })[0];
      var hb = add(iconBtn("icon-btn", "h_" + a0.hd, t("ctx.head"), function () {
        pop(hb, C.HEADS.map(function (h) { return choice("h_" + h, t("hd." + h), function () { each(["arrow"], function (o) { o.hd = h; }); }); }));
      }));
      hb.setAttribute("aria-haspopup", "menu");
      var db = add(iconBtn("icon-btn", "dash", t("ctx.dash"), function () {
        var on = !a0.ds;
        each(["arrow"], function (o) { o.ds = on; });
      }));
      db.setAttribute("aria-pressed", a0.ds ? "true" : "false");
    }
    if (kinds.pen) widthBtn(function (w) { prefs.sw = w; savePrefs(); each(["pen"], function (o) { o.sw = w; }); });
    if (kinds.text) {
      add(iconBtn("icon-btn", "small", t("ctx.smaller"), function () { textSize(-1); }));
      add(iconBtn("icon-btn", "big", t("ctx.bigger"), function () { textSize(1); }));
    }
    if (list.length === 1 && editable(list[0])) add(iconBtn("icon-btn", "edit", t("ctx.edit"), function () { startEdit(list[0].id); }));
    add(el("span", "sep"));
    add(iconBtn("icon-btn", "front", t("ctx.front"), function () { var z = C.zTop(data, board); each(null, function (o) { o.z = z++; }); }));
    add(iconBtn("icon-btn", "back", t("ctx.back"), function () { var z = C.zBottom(data, board) - sel.length; each(null, function (o) { o.z = z++; }); }));
    add(iconBtn("icon-btn", "dup", t("ctx.dup"), duplicate));
    if (list.length === 1 && list[0].k === "frame") add(iconBtn("icon-btn", "exp", t("ctx.exportFrame"), function () { openExport("frame"); }));
    add(iconBtn("icon-btn del", "trash", t("ctx.del"), removeSel));
    bar.hidden = false;
  }
  function shapeBtn(cur0, fn) {
    var b = iconBtn("icon-btn", "s_" + cur0, t("ctx.shape"), function () {
      pop(b, C.SHAPES.map(function (s) { return choice("s_" + s, t("shp." + s), function () { fn(s); }); }));
    });
    b.setAttribute("aria-haspopup", "menu");
    $("ctx").appendChild(b);
  }
  function widthBtn(fn) {
    var b = iconBtn("icon-btn", "width", t("ctx.width"), function () {
      pop(b, WIDTHS.map(function (w) {
        var c = textBtn("pop-txt", t(w[1]), function () { closePop(); fn(w[0]); });
        c.setAttribute("role", "menuitem");
        return c;
      }));
    });
    b.setAttribute("aria-haspopup", "menu");
    $("ctx").appendChild(b);
  }
  var SIZES = [12, 16, 20, 24, 32, 40, 56, 72, 96, 128];
  function textSize(dir) {
    each(["text"], function (o) {
      var i = 0;
      while (i < SIZES.length - 1 && SIZES[i] < o.fs) i++;
      if (dir < 0 && SIZES[i] >= o.fs) i = Math.max(0, i - 1);
      else if (dir > 0 && SIZES[i] <= o.fs) i = Math.min(SIZES.length - 1, i + 1);
      o.fs = SIZES[i];
      o.h = Math.round(C.textHeight(o, measure));
    });
  }

  function updateButtons() {
    var h = H();
    $("undo-btn").disabled = !h.u.length;
    $("redo-btn").disabled = !h.r.length;
  }

  // ---------- 11. Edits on the selection ----------
  function removeSel() {
    if (!sel.length) return;
    var rows = {}, n = 0;
    sel.forEach(function (id) { if (objById(id)) { rows[id] = null; n++; } });
    // arrows stuck to a removed object stay where they were drawn
    objs().forEach(function (o) {
      if (o.k !== "arrow" || Object.prototype.hasOwnProperty.call(rows, o.id)) return;
      if (rows[o.ao] === null || rows[o.bo] === null) {
        var c = keepEnds(clone(o));
        if (rows[o.ao] === null) c.ao = "";
        if (rows[o.bo] === null) c.bo = "";
        rows[o.id] = c;
      }
    });
    if (!n) return;
    sel = [];
    if (commit(rows)) {
      var h = H(), step = h.u[h.u.length - 1];
      toast(t("toast.deleted"), function () { if (H() === h && h.u[h.u.length - 1] === step) undo(); });
    }
    announce();
  }
  function duplicate() {
    var list = sel.map(objById).filter(Boolean);
    if (!list.length) return;
    paste(list, 24);
  }
  function paste(list, off) {
    var cp = C.copies(list, newId, off, off, zTop()), rows = {};
    cp.forEach(function (o) { rows[o.id] = o; });
    if (commit(rows)) { sel = cp.map(function (o) { return o.id; }); announce(); render(); }
  }
  function nudge(dx, dy) {
    var ids = moveSet(sel), rows = {};
    ids.forEach(function (id) { var o = objById(id); if (o) rows[id] = C.moved(o, dx, dy); });
    commit(rows);
  }

  function announce() {
    if (!sel.length) { say(t("live.none")); return; }
    if (sel.length > 1) { say(t("live.selN", { n: sel.length })); return; }
    var o = objById(sel[0]);
    if (o) say(t("live.sel", { kind: t("k." + o.k), text: C.words(o).slice(0, 120) }));
  }

  // ---------- 12. Pictures ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function localPickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = accept;
      inp.hidden = true;
      inp.addEventListener("change", function () { var f = inp.files && inp.files[0]; inp.remove(); resolve(f || null); });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  var PIC_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";
  // Down to at most 1024 px and the size limit, as JPEG on white.
  function encodePicture(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        var out = null;
        try {
          var side = Math.min(1024, Math.max(im.naturalWidth, im.naturalHeight));
          for (var round = 0; round < 6 && !out; round++) {
            var k = side / Math.max(im.naturalWidth, im.naturalHeight);
            var cv = document.createElement("canvas");
            cv.width = Math.max(1, Math.round(im.naturalWidth * k));
            cv.height = Math.max(1, Math.round(im.naturalHeight * k));
            var g = cv.getContext("2d");
            g.fillStyle = "#ffffff";
            g.fillRect(0, 0, cv.width, cv.height);
            g.drawImage(im, 0, 0, cv.width, cv.height);
            [0.85, 0.7, 0.55].forEach(function (q) {
              if (out) return;
              var src = cv.toDataURL("image/jpeg", q);
              if (src.length <= C.IMG_LEN) out = { src: src, w: cv.width, h: cv.height };
            });
            side = Math.round(side * 0.75);
          }
        } catch (e) { out = null; }
        resolve(out);
      };
      im.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
  }
  function picBytes() {
    var n = 0;
    data.objs.forEach(function (o) { if (o.k === "image") n += o.src.length; });
    return n;
  }
  function addPictures(files, at) {
    var list = [].slice.call(files || []).filter(function (f) { return f && /^image\//.test(f.type || "image/"); });
    if (!list.length) return;
    var w = at || toWorld(stageRect().left + stageRect().width / 2, stageRect().top + stageRect().height / 2);
    var rows = {}, z = zTop(), off = 0;
    var next = function (i) {
      if (i >= list.length) {
        if (Object.keys(rows).length && commit(rows)) { sel = Object.keys(rows); setTool("select"); }
        return;
      }
      var f = list[i];
      if (f.size > 30 * 1024 * 1024) { toast(t("toast.picBad")); next(i + 1); return; }
      encodePicture(f).then(function (r) {
        if (!r) { toast(t("toast.picBad")); next(i + 1); return; }
        var used = picBytes();
        Object.keys(rows).forEach(function (id) { used += rows[id].src.length; });
        if (used + r.src.length > IMG_TOTAL) { toast(t("toast.picBudget")); next(list.length); return; }
        var k = Math.min(1, 400 / Math.max(r.w, r.h)), id = newId();
        rows[id] = { id: id, b: board || "-", k: "image", src: r.src, w: Math.round(r.w * k), h: Math.round(r.h * k),
          x: r1(w.x - r.w * k / 2 + off), y: r1(w.y - r.h * k / 2 + off), z: z++ };
        off += 24;
        next(i + 1);
      });
    };
    next(0);
  }
  function pickPicture() {
    var dlg = dialogHost();
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(PIC_ACCEPT) : localPickFile(PIC_ACCEPT);
    Promise.resolve(pick).then(function (f) { if (f) addPictures([f]); }, function () { toast(t("toast.picBad")); });
  }

  // ---------- 13. Dialogs: boards, export ----------
  function makeDialog(id, title) {
    var stale = $(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "wb-dlg";
    var h = el("div", "dlg-title", title);
    h.id = id + "-t";
    dlg.setAttribute("aria-labelledby", h.id);
    dlg.appendChild(h);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () { setTimeout(function () { dlg.remove(); }, 0); });
    return dlg;
  }
  function showDialog(dlg) {
    closePop();
    endEdit();
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function openBoards() {
    var dlg = makeDialog("wb-boards", t("boards.title"));
    var ul = el("ul", "board-list");
    var list = C.boards(data).slice().sort(function (a, b) { return (a.name || "").localeCompare(b.name || "") || (a.id < b.id ? -1 : 1); });
    if (!list.length) ul.appendChild(el("li", "dlg-sub", t("boards.none")));
    list.forEach(function (b) {
      var li = el("li", b.id === board ? "on" : "");
      var name = b.name || t("board.untitled");
      var open = textBtn("board-open", "", function () { dlg.close(); openBoard(b.id); });
      open.appendChild(el("span", "bn", name));
      open.appendChild(el("span", "bc", t("boards.count", { n: C.objsOf(data, b.id).length })));
      if (b.id === board) open.setAttribute("aria-current", "true");
      li.appendChild(open);
      li.appendChild(iconBtn("icon-btn", "rename", t("boards.rename"), function () { dlg.close(); nameBoard(b); }));
      li.appendChild(iconBtn("icon-btn del", "trash", t("boards.delete"), function () { dlg.close(); askDelete(b); }));
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn primary", t("board.new"), function () { dlg.close(); nameBoard(null); }));
    acts.appendChild(textBtn("dlg-btn", t("close"), function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }
  function nameBoard(b) {
    var dlg = makeDialog("wb-name", b ? t("boards.rename") : t("board.new"));
    var form = el("form");
    var lbl = el("label", "fld-lbl", t("boards.name"));
    var inp = el("input");
    inp.type = "text";
    inp.maxLength = 120;
    inp.id = "wb-name-in";
    lbl.htmlFor = inp.id;
    inp.value = b ? b.name : "";
    inp.placeholder = t("board.untitled");
    form.appendChild(lbl);
    form.appendChild(inp);
    var acts = el("div", "dlg-actions");
    var ok = textBtn("dlg-btn primary", b ? t("boards.save") : t("boards.create"));
    ok.type = "submit";
    acts.appendChild(ok);
    acts.appendChild(textBtn("dlg-btn", t("cancel"), function () { dlg.close(); }));
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = inp.value.replace(/\s+/g, " ").trim();
      dlg.close();
      if (b) { if (name !== b.name) save(C.putBoard(data, b.id, name, Date.now())); return; }
      var id = newId();
      if (save(C.putBoard(data, id, name || t("board.new"), Date.now()))) { openBoard(id); setTimeout(fit, 0); }
    });
    dlg.appendChild(form);
    showDialog(dlg);
    inp.focus();
    inp.select();
  }
  function askDelete(b) {
    var dlg = makeDialog("wb-del", t("boards.delete"));
    dlg.appendChild(el("p", "dlg-sub", t("boards.delAsk", { name: b.name || t("board.untitled") })));
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn danger", t("boards.delete"), function () {
      dlg.close();
      if (save(C.removeBoard(data, b.id, Date.now()))) {
        delete hist[b.id];
        delete prefs.views[b.id];
        if (b.id === board) openBoard(firstBoard());
        toast(t("boards.deleted"));
      }
    }));
    acts.appendChild(textBtn("dlg-btn", t("cancel"), function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  var FMT = {
    png: { ext: ".png", mime: "image/png", desc: "PNG" },
    svg: { ext: ".svg", mime: "image/svg+xml", desc: "SVG" },
    pdf: { ext: ".pdf", mime: "application/pdf", desc: "PDF" }
  };
  function makeAccept(f) { var a = {}; a[f.mime] = [f.ext]; return a; }   // R37: no computed keys
  function fileBase(name) {
    var s = String(name || "whiteboard").replace(/[\\\/:*?\x22<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim();
    return (s || "whiteboard").slice(0, 60);
  }

  // what: "all" | "sel" | "frame"
  function exportList(what) {
    var list = objs();
    if (what === "frame" && sel.length === 1) {
      var f = objById(sel[0]);
      if (f && f.k === "frame") return C.inFrame(list, f, measure);
    }
    if (what === "sel" && sel.length) {
      var keep = {};
      moveSet(sel).forEach(function (id) { keep[id] = 1; });
      return list.filter(function (o) { return keep[o.id]; });
    }
    return list;
  }
  function exportSvg(list, bg, title) {
    var r = C.bounds(list, measure, 32);
    if (!r) return null;
    return { svg: C.toSvg(C.scene(list, { measure: measure, frameName: t("frame.name") }), r, { title: title, bg: bg ? C.PAPER : "none" }), w: r.w, h: r.h };
  }
  function toPng(r, bg) {
    var scale = Math.min(2, 8192 / r.w, 8192 / r.h, Math.sqrt(40000000 / (r.w * r.h)));
    if (scale < 0.25) { toast(t("toast.big")); return Promise.resolve(null); }
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml;charset=utf-8" }));
      var im = new Image();
      im.onload = function () {
        try {
          var cv = document.createElement("canvas");
          cv.width = Math.round(r.w * scale);
          cv.height = Math.round(r.h * scale);
          var g = cv.getContext("2d");
          if (bg) { g.fillStyle = C.PAPER; g.fillRect(0, 0, cv.width, cv.height); }
          g.drawImage(im, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url);
          cv.toBlob(function (b) { if (!b) toast(t("toast.big")); resolve(b ? { blob: b, w: cv.width, h: cv.height } : null); }, "image/png");
        } catch (e) { URL.revokeObjectURL(url); toast(t("toast.big")); resolve(null); }
      };
      im.onerror = function () { URL.revokeObjectURL(url); toast(t("toast.big")); resolve(null); };
      im.src = url;
    });
  }
  var pdfLib = null;
  function loadPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (pdfLib) return pdfLib;
    pdfLib = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "../vendor/jspdf.umd.min.js";
      s.onload = function () { if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF); else reject(new Error("jspdf")); };
      s.onerror = function () { pdfLib = null; reject(new Error("jspdf")); };
      document.head.appendChild(s);
    });
    return pdfLib;
  }
  // A PDF page the size of the board (one CSS px = 0.75 pt), with the
  // board drawn as a picture at twice the screen size.
  function toPdf(r, title) {
    return Promise.all([loadPdf(), toPng(r, true)]).then(function (res) {
      var JsPDF = res[0], png = res[1];
      if (!png) return null;
      var k = Math.min(0.75, 14000 / r.w, 14000 / r.h), pw = r.w * k, ph = r.h * k;
      var doc = new JsPDF({ orientation: pw > ph ? "landscape" : "portrait", unit: "pt", format: [pw, ph], compress: true });
      doc.setProperties({ title: title, creator: "orOS Whiteboard" });
      return png.blob.arrayBuffer().then(function (ab) {
        doc.addImage(new Uint8Array(ab), "PNG", 0, 0, pw, ph, undefined, "FAST");
        return doc.output("blob");
      });
    }).catch(function (e) { console.error("[orOS] whiteboard: PDF failed", e); toast(t("toast.pdfFail")); return null; });
  }
  function buildExport(fmt, what, bg) {
    var b = C.board(data, board), title = b ? b.name || t("board.untitled") : t("app.name");
    var list = exportList(what);
    if (what === "frame" && list[0] && list[0].k === "frame" && list[0].tx) title = list[0].tx;
    var r = exportSvg(list, fmt === "pdf" ? true : bg, title);
    if (!r) { toast(t("exp.empty")); return Promise.resolve(null); }
    var name = fileBase(title) + FMT[fmt].ext;
    if (fmt === "svg") return Promise.resolve({ blob: new Blob([r.svg], { type: FMT.svg.mime }), name: name });
    if (fmt === "pdf") return toPdf(r, title).then(function (bl) { return bl ? { blob: bl, name: name } : null; });
    return toPng(r, bg).then(function (x) { return x ? { blob: x.blob, name: name } : null; });
  }
  function downloadBlob(blob, fileName, f) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ blob: blob, filename: fileName, mime: f.mime, types: [{ description: f.desc, accept: makeAccept(f) }] })
        .then(function (r) { if (r && r.ok) toast(t("toast.exported")); });
      return;                         // cancel (ok=false) = silent exit
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    toast(t("toast.exported"));
  }
  function saveToFiles(blob, name) {
    var fs = null;
    try { fs = window.parent && window.parent !== window ? window.parent.orosFS : null; } catch (e) { fs = null; }
    if (!fs || typeof fs.writeBlob !== "function") { toast(t("toast.noFiles")); return; }
    var dir = "/internal/Whiteboard";
    Promise.resolve(typeof fs.mkdir === "function" ? fs.mkdir(dir).catch(function () {}) : null)
      .then(function () { return fs.writeBlob(dir + "/" + name, blob); })
      .then(function () { toast(t("toast.saved")); }, function () { toast(t("toast.noFiles")); });
  }
  function openExport(what0) {
    if (!objs().length) { toast(t("exp.empty")); return; }
    var oneFrame = sel.length === 1 && objById(sel[0]) && objById(sel[0]).k === "frame";
    var what = what0 || (oneFrame ? "frame" : sel.length ? "sel" : "all");
    if (!FMT[prefs.fmt]) prefs.fmt = "png";
    var dlg = makeDialog("wb-export", t("exp.title"));
    function seg(lbl, opts, val, set) {
      var fs = el("fieldset", "seg-field");
      fs.appendChild(el("legend", "fld-lbl", lbl));
      var s = el("div", "seg");
      opts.forEach(function (op) {
        var b = textBtn("", op[1], function () {
          set(op[0]);
          [].forEach.call(s.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          sync();
        });
        b.setAttribute("aria-pressed", op[0] === val ? "true" : "false");
        s.appendChild(b);
      });
      fs.appendChild(s);
      return fs;
    }
    dlg.appendChild(seg(t("exp.format"), [["png", "PNG"], ["svg", "SVG"], ["pdf", "PDF"]], prefs.fmt, function (v) { prefs.fmt = v; savePrefs(); }));
    var whats = [["all", t("exp.all")]];
    if (sel.length) whats.push(oneFrame ? ["frame", t("exp.frame")] : ["sel", t("exp.sel")]);
    if (whats.length > 1) dlg.appendChild(seg(t("exp.what"), whats, what, function (v) { what = v; }));
    else what = "all";
    var bgF = seg(t("exp.bg"), [["paper", t("exp.paper")], ["clear", t("exp.clear")]], prefs.bg, function (v) { prefs.bg = v; savePrefs(); });
    dlg.appendChild(bgF);
    function sync() { bgF.hidden = prefs.fmt === "pdf"; }
    sync();
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(textBtn("dlg-btn primary", t("exp.save"), function () {
      var f = FMT[prefs.fmt];
      dlg.close();
      buildExport(prefs.fmt, what, prefs.bg !== "clear").then(function (x) { if (x) downloadBlob(x.blob, x.name, f); });
    }));
    acts.appendChild(textBtn("dlg-btn", t("exp.files"), function () {
      dlg.close();
      buildExport(prefs.fmt, what, prefs.bg !== "clear").then(function (x) { if (x) saveToFiles(x.blob, x.name); });
    }));
    acts.appendChild(textBtn("dlg-btn", t("close"), function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ---------- 14. Keyboard ----------
  var spaceDown = false;
  function inField(e) {
    var tag = e.target && e.target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable);
  }
  var KEY_TOOLS = { KeyV: "select", KeyH: "hand", KeyN: "note", KeyT: "text", KeyS: "shape", KeyA: "arrow", KeyP: "pen", KeyF: "frame" };
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]")) return;
      var mod = e.ctrlKey || e.metaKey;
      if (popOpen && e.code === "Escape") { e.preventDefault(); closePop(); return; }
      if (e.target === $("editor")) {
        if (e.code === "Escape" || (e.code === "Enter" && (mod || (editing && (editing.obj.k === "frame" || editing.obj.k === "arrow"))))) {
          e.preventDefault();
          endEdit();
        }
        return;
      }
      if (inField(e) || e.altKey) return;
      if (mod && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.code === "KeyY") { e.preventDefault(); redo(); return; }
      if (mod && e.code === "KeyA") { e.preventDefault(); setTool("select"); sel = objs().map(function (o) { return o.id; }); announce(); render(); return; }
      if (mod && e.code === "KeyD") { e.preventDefault(); duplicate(); return; }
      if (mod && (e.code === "KeyC" || e.code === "KeyX")) {
        if (!sel.length) return;
        clip = sel.map(objById).filter(Boolean).map(clone);
        if (e.code === "KeyX") removeSel();
        e.preventDefault();
        return;
      }
      if (mod) return;
      if (e.code === "Space" && (document.activeElement === $("svg") || document.activeElement === document.body)) { e.preventDefault(); spaceDown = true; return; }
      if (e.code === "Escape") {
        if (gesture) { cancelGesture(); return; }
        if (sel.length) { sel = []; announce(); render(); return; }
        if (tool !== "select") setTool("select");
        return;
      }
      if (e.code === "Delete" || e.code === "Backspace") { if (sel.length) { e.preventDefault(); removeSel(); } return; }
      if (e.code === "Enter" && sel.length === 1) { e.preventDefault(); startEdit(sel[0]); return; }
      if (e.code === "Tab" && document.activeElement === $("svg")) {
        var list = objs();
        if (!list.length) return;
        e.preventDefault();
        var i = sel.length === 1 ? list.map(function (o) { return o.id; }).indexOf(sel[0]) : -1;
        i = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
        sel = [list[i].id];
        reveal(sel[0]);
        announce();
        render();
        return;
      }
      var step = e.shiftKey ? 1 : 10;
      var arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[e.code] && sel.length) { e.preventDefault(); nudge(arrows[e.code][0], arrows[e.code][1]); return; }
      if (e.code === "Equal" || e.code === "NumpadAdd") { zoomAt(1.2); return; }
      if (e.code === "Minus" || e.code === "NumpadSubtract") { zoomAt(1 / 1.2); return; }
      if (e.code === "Digit0") { zoomAt(1 / view.s); return; }
      if (e.code === "Digit1") { fit(); return; }
      if (e.code === "KeyI") { pickPicture(); return; }
      if (KEY_TOOLS[e.code]) { setTool(KEY_TOOLS[e.code]); }
    });
    document.addEventListener("keyup", function (e) { if (e.code === "Space") spaceDown = false; });
    // Pasting: copied objects of this board, or a picture
    document.addEventListener("paste", function (e) {
      if (inField(e) || document.querySelector("dialog[open]")) return;
      var files = [];
      var items = e.clipboardData && e.clipboardData.items ? e.clipboardData.items : [];
      for (var i = 0; i < items.length; i++) if (items[i].kind === "file" && /^image\//.test(items[i].type)) files.push(items[i].getAsFile());
      if (files.length) { e.preventDefault(); addPictures(files); return; }
      if (clip && clip.length) { e.preventDefault(); paste(clip, 24); }
    });
  }

  // ---------- 15. Wiring ----------
  function applyI18n() {
    document.documentElement.lang = LANG;
    document.title = t("app.name") + " · orOS";
    setIcon("undo-btn", "undo", t("btn.undo"));
    setIcon("redo-btn", "redo", t("btn.redo"));
    setIcon("pic-btn", "image", t("btn.pic"));
    setIcon("export-btn", "exp", t("btn.export"));
    setIcon("zoom-in", "plus", t("btn.zoomIn"));
    setIcon("zoom-out", "minus", t("btn.zoomOut"));
    setIcon("fit-btn", "fit", t("btn.fit"));
    $("zoom-pct").title = t("btn.zoom100");
    $("zoom-pct").setAttribute("aria-label", t("btn.zoom100"));
    $("board-btn").title = t("boards.title");
    $("board-btn").insertAdjacentHTML("afterbegin", ICONS.boards);   // static icon markup only
    $("stage").setAttribute("data-drop", t("drop"));
  }

  function wire() {
    var svg = $("svg");
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", function (e) { delete pts[e.pointerId]; if (gesture && gesture.type !== "pinch") cancelGesture(); else if (!Object.keys(pts).length) gesture = null; });
    // Double tap / click on an object edits it (onUp); a mouse double
    // click on an empty spot adds a sticky note (touch: onUp too).
    svg.addEventListener("dblclick", function (e) {
      if (!isTouch && !hitId(e.target) && tool === "select" && !editing) addAt("note", toWorld(e.clientX, e.clientY));
    });
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.002)), e.clientX, e.clientY);
      else {
        var k = e.deltaMode ? 20 : 1;
        view.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
        view.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
        viewChanged();
      }
    }, { passive: false });
    svg.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    var stage = $("stage");
    stage.addEventListener("dragover", function (e) { e.preventDefault(); stage.classList.add("drop"); });
    stage.addEventListener("dragleave", function (e) { if (e.target === stage || e.target === svg) stage.classList.remove("drop"); });
    stage.addEventListener("drop", function (e) {
      e.preventDefault();
      stage.classList.remove("drop");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addPictures(e.dataTransfer.files, toWorld(e.clientX, e.clientY));
    });
    $("editor").addEventListener("blur", function () { if (editing) endEdit(); });
    $("editor").addEventListener("input", function () { if (editing && editing.obj.k === "text") placeEditor(); });
    $("board-btn").addEventListener("click", openBoards);
    $("undo-btn").addEventListener("click", undo);
    $("redo-btn").addEventListener("click", redo);
    $("pic-btn").addEventListener("click", pickPicture);
    $("export-btn").addEventListener("click", function () { openExport(); });
    $("zoom-in").addEventListener("click", function () { zoomAt(1.25); });
    $("zoom-out").addEventListener("click", function () { zoomAt(1 / 1.25); });
    $("zoom-pct").addEventListener("click", function () { zoomAt(1 / view.s); });
    $("fit-btn").addEventListener("click", fit);
    document.addEventListener("pointerdown", function (e) {
      if (popOpen && !popOpen.contains(e.target) && !e.target.closest("#ctx")) closePop();
    }, true);
    window.addEventListener("resize", function () { paintView(); });
    wireKeyboard();
  }

  // ---------- 16. Deep link: search hits and other apps ----------
  // target = { board, obj? }. Unknown ids are ignored.
  window.__orosOpenAt = function (target) {
    if (!target || typeof target.board !== "string" || !C.board(data, target.board)) return;
    if (editing || document.querySelector("dialog[open]")) return;
    if (target.board !== board) openBoard(target.board);
    if (typeof target.obj === "string" && objById(target.obj)) {
      setTool("select");
      sel = [target.obj];
      setTimeout(function () { reveal(target.obj, true); announce(); render(); }, 0);
    }
  };

  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 17. Boot (last, after every declaration) ----------
  function boot() {
    load();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    tool = prefs.tool;
    $("svg").setAttribute("data-tool", tool);
    openBoard(firstBoard());
    if (!board) { var r = stageRect(); view = { x: r.width / 2, y: r.height / 2, s: 1 }; }
    render();
    takePending();
  }
  boot();
})();
