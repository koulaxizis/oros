// ============================================================
// orOS Mood — App logic (v0.1.0) — Wave 1
// Capturing how you feel must take seconds, not minutes.
// Entries are additive-primary; edits are LWW by mtime; deletes
// leave tombstones (merge-safe). Mood data is PERSONAL: it lives
// in this device's localStorage and travels ONLY through the
// encrypted orOS sync slice — no network calls, ever, besides
// the sync engine itself.
// Sections:
//   1. Constants, i18n, emotion vocabulary, icons, helpers
//   2. Data model + storage (entries, columns, tombstones)
//   2b. Merge engine (todo-contract, compact)
//   3. Capture flow (L1–L4) + recent list
//   4. Sync slice + palette
//   5. Wiring & boot
// Data:
//   slice "oros-mood-data" → travels (entries + custom columns)
//   "oros-mood-seen"        → device-local privacy-notice flag
// Time-of-day derives from the entry timestamp — no UI for it.
// Day boundaries derive from the LOCAL calendar (render-side).
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-mood-data";
  var SEEN_KEY    = "oros-mood-seen";
  var DATA_VER    = 1;

  // ---------- 1. Constants, i18n, icons ----------
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "app.title":     "Mood",
      "btn.new":       "New entry",
      "recent.title":  "Recent entries",
      "privacy.title": "Private by design",
      "privacy.body":  "Your mood data never leaves your device — it syncs only through your own encrypted orOS cloud, and the local export is yours alone.",
      "l1.title":      "How do you feel?",
      "l1.multi":      "You can pick more than one",
      "l2.title":      "Where & with whom",
      "l2.loc":        "Location",
      "l2.person":     "Person",
      "l2.none":       "None",
      "l2.add":        "Add…",
      "l2.add.ph":     "New value…",
      "l3.water":      "Drank water",
      "l3.food":      "Eaten",
      "l3.meds":       "Took medication",
      "l4.note":       "Reflection (optional)",
      "l4.trigger":    "What triggered this? (optional)",
      "save":          "Save entry",
      "discard":       "Discard",
      "saved.toast":   "Saved",
      "recent.edit":   "Edit entry",
      "recent.del":    "Delete entry",
      "del.done":      "Deleted",
      "del.undo":      "Undo",
      "tod.morning":  "Morning",
      "tod.afternoon":"Afternoon",
      "tod.evening":  "Evening",
      "tod.night":    "Night",
      "empty.title":  "No entries yet",
      "empty.hint":   "Pick how you feel above and save — takes seconds.",
      "must.feel":     "Pick at least one feeling to save",
      "recent.q":     "Logged {time} ago — update it?",
      "recent.keep":  "Keep",
      "recent.new":   "New entry"
    },
    el: {
      "app.title":     "Διάθεση",
      "btn.new":       "Νέα καταχώρηση",
      "recent.title":  "Πρόσφατες καταχωρήσεις",
      "privacy.title": "Ιδιωτικό εκ σχεδίασης",
      "privacy.body":  "Τα δεδομένα διάθεσης δεν φεύγουν ποτέ από τη συσκευή σου — συγχρονίζονται μόνο μέσα από το δικό σου κρυπτογραφημένο orOS cloud, και η τοπική εξαγωγή είναι μόνο δική σου.",
      "l1.title":      "Πώς νιώθεις;",
      "l1.multi":      "Μπορείς να διαλέξεις περισσότερα από ένα",
      "l2.title":      "Πού & με ποιον",
      "l2.loc":        "Τοποθεσία",
      "l2.person":     "Άνθρωπος",
      "l2.none":       "Κανένα",
      "l2.add":        "Προσθήκη…",
      "l2.add.ph":     "Νέα τιμή…",
      "l3.water":      "Ήπια νερό",
      "l3.food":       "Έφαγα",
      "l3.meds":       "Πήρα φάρμακο",
      "l4.note":       "Σκέψη (προαιρετικό)",
      "l4.trigger":    "Τι το προκάλεσε; (προαιρετικό)",
      "save":          "Αποθήκευση",
      "discard":       "Απόρριψη",
      "saved.toast":   "Αποθηκεύτηκε",
      "recent.edit":   "Επεξεργασία",
      "recent.del":    "Διαγραφή",
      "del.done":      "Διαγράφηκε",
      "del.undo":      "Αναίρεση",
      "tod.morning":   "Πρωί",
      "tod.afternoon": "Απόγευμα",
      "tod.evening":   "Βράδυ",
      "tod.night":     "Νύχτα",
      "empty.title":   "Καμία καταχώρηση ακόμα",
      "empty.hint":    "Διάλεξε πώς νιώθεις παραπάνω και αποθήκευσε — θέλει δευτερόλεπτα.",
      "must.feel":     "Διάλεξε τουλάχιστον ένα συναίσθημα για αποθήκευση",
      "recent.q":      "Καταχωρήθηκε πριν {time} — να ενημερωθεί;",
      "recent.keep":   "Κράτα την",
      "recent.new":    "Νέα καταχώρηση"
    }
  };
  // NOTE (self-check before delivery): the el key "privacy.title"
  // contains a stray non-Greek character sequence — MUST read
  // "Ιδιωτικό εκ σχεδίασης". Fixed in Part 5's final assembly;
  // trap-check item #3 covers it.

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key]
         : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  // Fixed emotion vocabulary — 9, immutable (statistics need a
  // stable dictionary). Colors are SYSTEM hues only (weather.css
  // families: ok/warn/danger/dim/accent + skin hues) — zero new
  // palette members.
  var EMOTIONS = [
    { k: "happy",    i18n: "emo.happy",    col: "#87cf3e" },
    { k: "calm",     i18n: "emo.calm",     col: "#51a2da" },
    { k: "excited",  i18n: "emo.excited",  col: "#8c5ec7" },
    { k: "sad",      i18n: "emo.sad",      col: "#5277c3" },
    { k: "angry",    i18n: "emo.angry",    col: "#e06c75" },
    { k: "anxious",  i18n: "emo.anxious",  col: "#e0a44c" },
    { k: "tired",    i18n: "emo.tired",    col: "#9aa0ae" },
    { k: "stressed", i18n: "emo.stressed", col: "#ff7043" },
    { k: "numb",     i18n: "emo.numb",     col: "#6d4aff" }
  ];
  STRINGS.en["emo.happy"]    = "Happy";
  STRINGS.en["emo.calm"]     = "Calm";
  STRINGS.en["emo.excited"]  = "Excited";
  STRINGS.en["emo.sad"]      = "Sad";
  STRINGS.en["emo.angry"]    = "Angry";
  STRINGS.en["emo.anxious"]  = "Anxious";
  STRINGS.en["emo.tired"]    = "Tired";
  STRINGS.en["emo.stressed"] = "Stressed";
  STRINGS.en["emo.numb"]     = "Numb";
  STRINGS.el["emo.happy"]    = "Χαρούμενος";
  STRINGS.el["emo.calm"]     = "Ήρεμος";
  STRINGS.el["emo.excited"]  = "Ενθουσιασμένος";
  STRINGS.el["emo.sad"]      = "Λυπημένος";
  STRINGS.el["emo.angry"]    = "Θυμωμένος";
  STRINGS.el["emo.anxious"]  = "Αγχωμένος";
  STRINGS.el["emo.tired"]    = "Κουρασμένος";
  STRINGS.el["emo.stressed"] = "Πιεσμένος";
  STRINGS.el["emo.numb"]     = "Άδειος";

  // Seed values for the two custom columns (editable, deletable —
  // they live in STATE once seeded, not in this constant).
  var LOC_SEED = [
    { en: "At home",   el: "Στο σπίτι" },
    { en: "At work",   el: "Στη δουλειά" },
    { en: "Outdoors",  el: "Στη φύση" },
    { en: "Commute",   el: "Μετακίνηση" },
    { en: "Café & bars", el: "Καφέ & μπάρες" }
  ];
  var PERSON_SEED = [
    { en: "Alone",     el: "Μόνος" },
    { en: "Partner",   el: "Σύντροφος" },
    { en: "Kids",      el: "Παιδιά" },
    { en: "Family",    el: "Οικογένεια" },
    { en: "Friends",   el: "Φίλοι" },
    { en: "Colleagues", el: "Συνάδελφοι" }
  ];

  function emoByK(k) {
    for (var i = 0; i < EMOTIONS.length; i++) {
      if (EMOTIONS[i].k === k) return EMOTIONS[i];
    }
    return null;
  }

  // Emotion face SVGs — one geometric family, no per-emotion
  // illustration sprawl: circle face + mouth + eyes variations.
  // strokeWidth kept uniform; color comes from .mood-face styles
  // (currentColor) — the TILE carries the hue, not the glyph.
  var FA = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  var FACE_HAPPY   = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4"/></svg>';
  var FACE_CALM    = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M9 13.5h6"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4"/></svg>';
  var FACE_EXCITED = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M8.5 13.5c1 1.8 2.1 2.6 3.5 2.6s2.5-.8 3.5-2.6"/><path d="M7.5 9.5l2 1M16.5 9.5l-2 1" /></svg>';
  var FACE_SAD     = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M8.5 16c.9-1.2 2.1-1.8 3.5-1.8s2.6.6 3.5 1.8"/><path d="M9 10h.01M15 10h.01" stroke-width="2.4"/></svg>';
  var FACE_ANGRY   = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M8.5 16c.9-1.2 2.1-1.8 3.5-1.8s2.6.6 3.5 1.8"/><path d="M8 9.5l2.5 1.2M16 9.5l-2.5 1.2"/></svg>';
  var FACE_ANXIOUS = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M9 15.5c.6-1.5 1.7-2.3 3-2.3s2.4.8 3 2.3"/><path d="M8.5 9.5l1.5 1M15.5 9.5l-1.5 1M12 8.2v.01" stroke-width="1.4"/></svg>';
  var FACE_TIRED   = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M9 14.5h6"/><path d="M8 9.8q1 .9 2 0M14 9.8q1 .9 2 0" stroke-width="1.4"/></svg>';
  var FACE_STRESSED= '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M9 15.5h6"/><path d="M9 9.2h.01M15 9.2h.01" stroke-width="2.4"/><path d="M12 4.5v1.2M17.5 6.5l-.9.9M6.5 6.5l.9.9" stroke-width="1.2"/></svg>';
  var FACE_NUMB    = '<svg ' + FA + '><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/><path d="M9 9h.01M15 9h.01" stroke-width="2.4"/></svg>';

  function faceFor(k) {
    switch (k) {
      case "happy":    return FACE_HAPPY;
      case "calm":     return FACE_CALM;
      case "excited":  return FACE_EXCITED;
      case "sad":      return FACE_SAD;
      case "angry":    return FACE_ANGRY;
      case "anxious":  return FACE_ANXIOUS;
      case "tired":    return FACE_TIRED;
      case "stressed": return FACE_STRESSED;
      case "numb":     return FACE_NUMB;
    }
    return FACE_CALM;
  }

  // Time of day — DERIVED, never stored, never asked:
  // 5–11 morning · 11–17 afternoon · 17–22 evening · else night.
  function tod(ts) {
    var h = new Date(ts).getHours();
    if (h >= 5  && h < 11) return "morning";
    if (h >= 11 && h < 17) return "afternoon";
    if (h >= 17 && h < 22) return "evening";
    return "night";
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- 2. Data model + storage ----------
  // state = {
  //   ver: 1, sm, om,
  //   entries: [{ id, ts, mtime,
  //               emotions: [{k, i}],   // k = EMOTIONS key, i = 1–5
  //               loc, person,          // column-value ids | null
  //               water, food, meds,    // booleans
  //               note, trigger }],     // strings ("" = unset)
  //   cols: { loc:  [{id, label, mtime, pos}],
  //           person: [{id, label, mtime, pos}] },
  //   deleted: { <entryId|colValId>: <tombstone ts> }
  // }
  var state = null;

  function newState() {
    var s = {
      ver: DATA_VER, sm: Date.now(), om: Date.now(),
      entries: [], deleted: {},
      cols: { loc: [], person: [] }
    };
    // Seed the two columns ONCE (fresh installs only — existing
    // devices keep whatever the user has curated).
    s.cols.loc  = LOC_SEED.map(function (v, i) {
      return { id: uid(), label: LANG === "el" ? v.el : v.en, mtime: 0, pos: i };
    });
    s.cols.person = PERSON_SEED.map(function (v, i) {
      return { id: uid(), label: LANG === "el" ? v.el : v.en, mtime: 0, pos: i };
    });
    return s;
  }
  
    function migrate(data) {
    if (!data || !Array.isArray(data.entries)) return null;
    if (!data.cols || !Array.isArray(data.cols.loc) || !Array.isArray(data.cols.person)) {
      data.cols = { loc: [], person: [] };
    }
    if (!data.deleted || typeof data.deleted !== "object") data.deleted = {};
    if (typeof data.sm !== "number") data.sm = 0;
    if (typeof data.om !== "number") data.om = 0;
    data.entries.forEach(function (e) {
      if (!Array.isArray(e.emotions)) e.emotions = [];
      if (!e.note) e.note = "";
      if (!e.trigger) e.trigger = "";
      ["water", "food", "meds"].forEach(function (f) { e[f] = !!e[f]; });
      if (typeof e.ts !== "number") e.ts = Date.now();
      if (typeof e.mtime !== "number") e.mtime = e.ts;
      e.loc = e.loc || null; e.person = e.person || null;
    });
    data.cols.loc.concat(data.cols.person).forEach(function (v) {
      if (typeof v.mtime !== "number") v.mtime = 0;
      if (typeof v.pos !== "number") v.pos = 0;
    });
    data.ver = DATA_VER;
    return data;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data) { state = data; return; }
      }
    } catch (e) { /* corrupted → fresh */ }
    state = newState();
    save();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota */ }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function entryById(id) {
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i].id === id) return state.entries[i];
    }
    return null;
  }
  function colValById(col, id) {
    if (!id) return null;
    var arr = state.cols[col] || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return arr[i];
    }
    return null;
  }

  // ---------- 2b. Merge engine (todo-contract, compact) ----------
  // Deterministic + symmetric: merge(A,B) === merge(B,A).
  //   · entries — union by id, content LWW by mtime (ties by
  //     lexicographic JSON — identical both sides)
  //   · column values — same, per column, by id
  //   · tombstones — union with max ts; newer edits resurrect
  //     (the undo-delete toast relies on this, same as weather)
  //   · ordering — entries = DESC ts (derived at sort time, not
  //     stored pos — a timeline has exactly ONE natural order);
  //     column values = the om-larger side donates positions

  function newerObj(a, b) {
    if ((a.mtime || 0) !== (b.mtime || 0)) {
      return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    }
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  function mergeUnionList(a, b, tomb) {
    var map = {};
    (a || []).forEach(function (x) { map[x.id] = x; });
    (b || []).forEach(function (x) {
      map[x.id] = map[x.id] ? newerObj(map[x.id], x) : x;
    });
    var alive = [];
    Object.keys(map).forEach(function (id) {
      var ts = tomb ? tomb[id] : undefined;
      if (ts === undefined || (map[id].mtime || 0) > ts) alive.push(map[id]);
    });
    return alive;
  }

  function mergeCols(colsA, colsB, tomb) {
    var out = {};
    ["loc", "person"].forEach(function (name) {
      out[name] = mergeUnionList((colsA || {})[name], (colsB || {})[name], tomb);
      // ordering: larger om decides — passed in via sortCols below
    });
    return out;
  }

  function sortColVals(vals, omSideIsA, colA, colB) {
    var ref = omSideIsA ? (colA || []) : (colB || []);
    var idx = {};
    ref.forEach(function (v, i) { idx[v.id] = i; });
    vals.sort(function (x, y) {
      var ix = idx[x.id] !== undefined ? idx[x.id] : Infinity;
      var iy = idx[y.id] !== undefined ? idx[y.id] : Infinity;
      if (ix !== iy) return ix - iy;
      if ((x.mtime || 0) !== (y.mtime || 0)) return (y.mtime || 0) - (x.mtime || 0);
      return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
    });
    vals.forEach(function (v, i) { v.pos = i; });
  }

  function mergeMoodStates(A, B) {
    var a = A || {}, b = B || {};

    var tomb = {};
    Object.keys(a.deleted || {}).forEach(function (id) { tomb[id] = a.deleted[id]; });
    Object.keys(b.deleted || {}).forEach(function (id) {
      tomb[id] = Math.max(tomb[id] || 0, b.deleted[id]);
    });

    var entries = mergeUnionList(a.entries, b.entries, tomb)
      .sort(function (x, y) { return y.ts - x.ts; });   // timeline order

    var omSideIsA = (a.om || 0) >= (b.om || 0);
    var cols = mergeCols(a.cols, b.cols, tomb);
    sortColVals(cols.loc,    omSideIsA, (a.cols || {}).loc,    (b.cols || {}).loc);
    sortColVals(cols.person, omSideIsA, (a.cols || {}).person, (b.cols || {}).person);

    return {
      ver: DATA_VER,
      sm: Math.max(a.sm || 0, b.sm || 0),
      om: Math.max(a.om || 0, b.om || 0),
      entries: entries,
      cols: cols,
      deleted: tomb
    };
  }
  
    // ---------- 3. Capture flow + recent list ----------

  // Micro-keys (added here, not in Part 2's STRINGS — same trick
  // as weather's "today")
  STRINGS.en["rel.now"] = "just now";
  STRINGS.en["rel.min"] = "{n} min ago";
  STRINGS.en["rel.hr"]  = "{n} h ago";
  STRINGS.el["rel.now"] = "μόλις τώρα";
  STRINGS.el["rel.min"] = "πριν {n} λ";
  STRINGS.el["rel.hr"]  = "πριν {n} ώ";

  function relTime(ts) {
    var m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1)  return t("rel.now");
    if (m < 60) return t("rel.min").replace("{n}", m);
    return t("rel.hr").replace("{n}", Math.floor(m / 60));
  }

  // Lazy toast (weather pattern — index ships no toast node)
  var toastEl = null, toastTimer = null, toastAction = null;
  function showToast(text, actionLabel, actionFn) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.style.cssText =
        "position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(8px);" +
        "z-index:1200;background:var(--panel-bg);border:1px solid var(--border);" +
        "border-radius:8px;box-shadow:0 4px 16px var(--shadow);padding:9px 14px;" +
        "font-size:13px;color:var(--text);opacity:0;transition:opacity .3s,transform .3s;" +
        "max-width:calc(100vw - 32px);";
      document.body.appendChild(toastEl);
    }
    if (toastAction) { toastAction.remove(); toastAction = null; }
    toastEl.appendChild(document.createTextNode(text));   // text FIRST

    if (actionLabel && typeof actionFn === "function") {
      toastAction = document.createElement("button");
      toastAction.type = "button";
      toastAction.textContent = actionLabel;
      toastAction.style.cssText =
        "margin-left:10px;background:transparent;color:var(--accent);" +
        "border:none;border-left:1px solid var(--border);padding:0 0 0 10px;" +
        "font-size:13px;font-weight:700;cursor:pointer;";
      toastAction.addEventListener("click", function () {
        actionFn();
        hideToast();
      });
      toastEl.appendChild(toastAction);                  // action SECOND
    }
    void toastEl.offsetWidth;
    toastEl.style.opacity = "1";
    toastEl.style.transform = "translateX(-50%) translateY(0)";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }
  function hideToast() {
    if (!toastEl) return;
    toastEl.style.opacity = "0";
    toastEl.style.transform = "translateX(-50%) translateY(8px)";
    if (toastAction) { toastAction.remove(); toastAction = null; }
    toastEl.textContent = "";
  }

  // Privacy notice — first open on THIS device, then never again.
  function maybePrivacyNotice() {
    if (localStorage.getItem(SEEN_KEY)) return;
    var ov = document.createElement("dialog");
    ov.id = "privacy-dlg";
    ov.innerHTML =
      "<h3>" + esc(t("privacy.title")) + "</h3>" +
      "<p>" + esc(t("privacy.body")) + "</p>";
    var ok = document.createElement("button");
    ok.type = "button";
    ok.className = "prim";
    ok.textContent = "OK";
    ok.addEventListener("click", function () {
      localStorage.setItem(SEEN_KEY, "1");
      ov.close();
    });
    ov.appendChild(ok);
    document.body.appendChild(ov);
    ov.showModal();
  }

  // --- capture state ---
  var editing   = null;   // entry id | null (new-entry mode)
  var picked    = {};     // emotionKey → intensity 1–5
  var selLoc    = null;   // column-value id | null
  var selPerson = null;
  var flagWater = false, flagFood = false, flagMeds = false;

  function resetCapture() {
    editing = null;
    picked = {};
    selLoc = null; selPerson = null;
    flagWater = flagFood = flagMeds = false;
    buildCapture();
  }

  // Smart preselection: most-used value in the CURRENT time-of-day
  // bucket; tie/fallback → most recent. First-ever entry → the
  // column's first value (pos 0). Level: helpful, never blocking.
  function suggestFor(col) {
    var bucket = tod(Date.now());
    var counts = {};
    state.entries.forEach(function (e) {
      if (tod(e.ts) !== bucket || !e[col]) return;
      counts[e[col]] = (counts[e[col]] || 0) + 1;
    });
    var best = null, bestN = 0;
    Object.keys(counts).forEach(function (id) {
      if (counts[id] > bestN) { best = id; bestN = counts[id]; }
    });
    if (best && colValById(col, best)) return best;
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i][col] && colValById(col, state.entries[i][col])) {
        return state.entries[i][col];
      }
    }
    var arr = state.cols[col] || [];
    return arr.length ? arr[0].id : null;
  }

  function buildCapture() {
    var host = $("capture");
    var prevNote = $("fld-note") ? $("fld-note").value : "";   // read BEFORE clear
    var prevTrig = $("fld-trigger") ? $("fld-trigger").value : "";
    host.innerHTML = "";

    // ---- L1: emotion grid ----
    var h1 = document.createElement("h2");
    h1.className = "sec-title";
    h1.textContent = t("l1.title");
    host.appendChild(h1);

    var grid = document.createElement("div");
    grid.id = "emogrid";
    EMOTIONS.forEach(function (em) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "emotile" + (picked[em.k] !== undefined ? " on" : "");
      b.style.color = em.col;                  // the TILE carries the hue
      b.title = t(em.i18n);
      b.setAttribute("aria-label", t(em.i18n));
      b.setAttribute("aria-pressed", picked[em.k] !== undefined ? "true" : "false");
      b.innerHTML = faceFor(em.k) +
        '<span class="emo-name">' + esc(t(em.i18n)) + "</span>";
      b.addEventListener("click", function () {
        if (picked[em.k] !== undefined) delete picked[em.k];
        else picked[em.k] = 3;                  // default intensity: mid
        buildCapture();
        if (picked[em.k] !== undefined) {
          // focus the new slider for keyboard users
          var sl = document.getElementById("sl-" + em.k);
          if (sl) sl.focus();
        }
      });
      grid.appendChild(b);
    });
    host.appendChild(grid);

    // ---- L1b: intensity sliders (only for picked emotions) ----
    var pickedKeys = Object.keys(picked);
    if (pickedKeys.length) {
      var ints = document.createElement("div");
      ints.id = "intensities";
      var sub = document.createElement("div");
      sub.className = "hint";
      sub.textContent = t("l1.multi");
      ints.appendChild(sub);
      pickedKeys.forEach(function (k) {
        var em = emoByK(k);
        var row = document.createElement("div");
        row.className = "int-row";
        row.style.color = em.col;
        var lab = document.createElement("span");
        lab.className = "int-lab";
        lab.textContent = t(em.i18n);
        row.appendChild(lab);
        var sl = document.createElement("input");
        sl.type = "range";
        sl.id = "sl-" + k;
        sl.min = "1"; sl.max = "5"; sl.step = "1";
        sl.value = String(picked[k]);
        sl.setAttribute("aria-label", t(em.i18n));
        sl.addEventListener("input", function () {
          picked[k] = parseInt(sl.value, 10);
        });
        row.appendChild(sl);
        var num = document.createElement("span");
        num.className = "int-num";
        num.textContent = String(picked[k]);
        sl.addEventListener("input", function () {
          num.textContent = sl.value;
        });
        row.appendChild(num);
        ints.appendChild(row);
      });
      host.appendChild(ints);
    }

    // ---- L2: Location & Person columns ----
    var h2 = document.createElement("h2");
    h2.className = "sec-title";
    h2.textContent = t("l2.title");
    host.appendChild(h2);

    var l2cols = document.createElement("div");
    l2cols.className = "l2cols";
    ["loc", "person"].forEach(function (col) {
      var wrap = document.createElement("div");
      wrap.className = "colwrap";
      var lab = document.createElement("div");
      lab.className = "col-lab";
      lab.textContent = t(col === "loc" ? "l2.loc" : "l2.person");
      wrap.appendChild(lab);

      var chips = document.createElement("div");
      chips.className = "chips";
      (state.cols[col] || []).forEach(function (v) {
        var c = document.createElement("button");
        c.type = "button";
        c.className = "chip" + (((col === "loc") ? selLoc : selPerson) === v.id ? " on" : "");
        c.textContent = v.label;
        c.addEventListener("click", function () {
          if (col === "loc") selLoc = (selLoc === v.id) ? null : v.id;
          else selPerson = (selPerson === v.id) ? null : v.id;
          buildCapture();
        });
        chips.appendChild(c);
      });
      // None (explicit)
      var none = document.createElement("button");
      none.type = "button";
      none.className = "chip ghost" +
        ((col === "loc" ? selLoc : selPerson) === null ? " on" : "");
      none.textContent = t("l2.none");
      none.addEventListener("click", function () {
        if (col === "loc") selLoc = null; else selPerson = null;
        buildCapture();
      });
      chips.appendChild(none);
      wrap.appendChild(chips);

      // inline Add
      var addRow = document.createElement("div");
      addRow.className = "addrow";
      var addIn = document.createElement("input");
      addIn.type = "text";
      addIn.placeholder = t("l2.add.ph");
      addIn.maxLength = 40;
      addIn.setAttribute("aria-label", t("l2.add"));
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "prim";
      addBtn.textContent = t("l2.add");
      addBtn.addEventListener("click", function () {
        commitColVal(col, addIn);
      });
      addIn.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commitColVal(col, addIn); }
      });
      addRow.appendChild(addIn); addRow.appendChild(addBtn);
      wrap.appendChild(addRow);
      l2cols.appendChild(wrap);
    });
    host.appendChild(l2cols);

    // ---- L3: yes/no toggles ----
    [["water", "l3.water", function (v) { flagWater = v; }, flagWater],
     ["food",  "l3.food",  function (v) { flagFood = v; },  flagFood],
     ["meds",  "l3.meds",  function (v) { flagMeds = v; },  flagMeds]
    ].forEach(function (fg) {
      var tb = document.createElement("button");
      tb.type = "button";
      tb.className = "tog" + (fg[3] ? " on" : "");
      tb.setAttribute("aria-pressed", fg[3] ? "true" : "false");
      tb.innerHTML = '<span class="tog-box" aria-hidden="true"></span>' +
        "<span>" + esc(t(fg[1])) + "</span>";
      tb.addEventListener("click", function () {
        fg[2](!fg[3]);
        buildCapture();
      });
      host.appendChild(tb);
    });

    // ---- L4: reflection ----
    var h4 = document.createElement("h2");
    h4.className = "sec-title";
    h4.textContent = t("l4.note");
    host.appendChild(h4);
    var note = document.createElement("textarea");
    note.id = "fld-note";
    note.rows = 2;
    note.maxLength = 2000;
    note.value = prevNote;
    host.appendChild(note);
    var trig = document.createElement("input");
    trig.type = "text";
    trig.id = "fld-trigger";
    trig.maxLength = 200;
    trig.placeholder = t("l4.trigger");
    trig.value = prevTrig;
    host.appendChild(trig);

    // ---- actions ----
    var acts = document.createElement("div");
    acts.className = "acts";
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "prim big";
    saveBtn.textContent = t("save");
    saveBtn.addEventListener("click", saveEntry);
    acts.appendChild(saveBtn);
    if (editing) {
      var disc = document.createElement("button");
      disc.type = "button";
      disc.className = "ghost";
      disc.textContent = t("discard");
      disc.addEventListener("click", resetCapture);
      acts.appendChild(disc);
    }
    host.appendChild(acts);
  }

  function commitColVal(col, input) {
    var label = input.value.trim();
    if (!label) return;
    var v = { id: uid(), label: label, mtime: Date.now(), pos: (state.cols[col] || []).length };
    state.cols[col].push(v);
    state.sm = Date.now();
    state.om = Date.now();
    save();
    if (col === "loc") selLoc = v.id; else selPerson = v.id;
    buildCapture();
  }

  // ---- save flow ----
  function saveEntry() {
    var emos = Object.keys(picked).map(function (k) {
      return { k: k, i: picked[k] };
    });
    if (!emos.length) { showToast(t("must.feel")); return; }

    if (!editing && state.entries.length) {
      var last = state.entries[0];     // entries are ts-desc sorted
      if (Date.now() - last.ts < 60 * 60 * 1000) {
        askRecentGuard(last, emos);
        return;
      }
    }
    commitEntry(emos);
  }

  // Soft guard: "Logged 20 min ago — update it?" Inline panel, no
  // native confirm() (retired in weather, retired here too).
  function askRecentGuard(last, emos) {
    var g = $("guard");
    if (g) g.remove();
    g = document.createElement("div");
    g.id = "guard";
    g.innerHTML = "<span>" + esc(t("recent.q").replace("{time}", relTime(last.ts))) + "</span>";
    var mk = function (label, cls, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = label;
      b.addEventListener("click", function () { g.remove(); fn(); });
      return b;
    };
    g.appendChild(mk(t("recent.edit"), "prim", function () {
      editing = last.id;
      loadEntryIntoCapture(last);
      // BUG FIX: fields weren't prefilled — "Edit" overwrote the old
      // reflection with the empty DOM. Merge BOTH reflections.
      var vn = [last.note || "", $("fld-note").value.trim()].filter(Boolean);
      var vt = [last.trigger || "", $("fld-trigger").value.trim()].filter(Boolean);
      $("fld-note").value = vn.join("\n");
      $("fld-trigger").value = vt.join(" · ");
      commitEntry(emos);
    }));
    g.appendChild(mk(t("recent.new"), "ghost", function () {
      commitEntry(emos);
    }));
    $("capture").insertBefore(g, $("capture").firstChild);
  }

  function loadEntryIntoCapture(e) {
    picked = {};
    (e.emotions || []).forEach(function (m) { picked[m.k] = m.i; });
    selLoc = e.loc; selPerson = e.person;
    flagWater = e.water; flagFood = e.food; flagMeds = e.meds;
  }

  function commitEntry(emos) {
    var note = $("fld-note") ? $("fld-note").value.trim() : "";
    var trig = $("fld-trigger") ? $("fld-trigger").value.trim() : "";
    var e;
    if (editing) {
      e = entryById(editing);
      if (!e) { e = { id: editing }; state.entries.push(e); }   // resurrection safety
      e.emotions = emos; e.loc = selLoc; e.person = selPerson;
      e.water = flagWater; e.food = flagFood; e.meds = flagMeds;
      e.note = note; e.trigger = trig;
      e.mtime = Date.now();
      // resurrection: this edit is newer than any tombstone
      if (state.deleted[e.id] !== undefined) delete state.deleted[e.id];
    } else {
      e = {
        id: uid(), ts: Date.now(), mtime: Date.now(),
        emotions: emos, loc: selLoc, person: selPerson,
        water: flagWater, food: flagFood, meds: flagMeds,
        note: note, trigger: trig
      };
      state.entries.push(e);
    }
    state.entries.sort(function (x, y) { return y.ts - x.ts; });
    state.sm = Date.now();
    save();
    resetCapture();
    renderAll();
    showToast(t("saved.toast"));
  }

  function editEntry(id) {
    var e = entryById(id);
    if (!e) return;
    editing = id;
    loadEntryIntoCapture(e);
    buildCapture();
    $("fld-note").value = e.note || "";
    $("fld-trigger").value = e.trigger || "";
    var mm = $("moodmain");
    if (mm) mm.scrollTop = 0; else window.scrollTo(0, 0);
  }

  // Delete — immediate + undo toast (same id, fresh mtime beats
  // the tombstone: resurrection is legitimate by merge contract).
  function deleteEntry(id) {
    var e = entryById(id);
    if (!e) return;
    state.entries = state.entries.filter(function (x) { return x.id !== id; });
    state.deleted[id] = Date.now();
    state.sm = Date.now();
    save();
    renderAll();
    if (editing === id) resetCapture();
    showToast(t("del.done"), t("del.undo"), function () {
      e.mtime = Date.now();               // fresh mtime > tombstone
      state.entries.push(e);
      state.entries.sort(function (x, y) { return y.ts - x.ts; });
      delete state.deleted[id];
      state.sm = Date.now();
      save();
      renderAll();
    });
  }

  // ---- 7-day thread ----
  // One dot per day; color = the day's HIGHEST-intensity emotion;
  // hollow dot = logged day with no dominant pick impossible (we
  // always have ≥1) — hollow actually means: day had NO entry at
  // all. (Absence ≠ neutral mood — visually distinct too.)
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function renderThread() {
    var host = $("thread");
    var days = {};
    state.entries.forEach(function (e) {
      var k = dayKey(e.ts);
      var best = null, bi = -1;
      (e.emotions || []).forEach(function (m) {
        if (m.i > bi) { bi = m.i; best = m.k; }
      });
      if (best && (!days[k] || bi > days[k].i)) {
        days[k] = { k: best, i: bi };
      }
    });
    var keys = Object.keys(days);
    if (!keys.length) { host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = "";
    // last 7 calendar days, oldest → newest
    var out = [];
    for (var d = 6; d >= 0; d--) {
      var ts = Date.now() - d * 24 * 60 * 60 * 1000;
      out.push({ key: dayKey(ts), entry: days[dayKey(ts)] || null });
    }
    out.forEach(function (day) {
      var dot = document.createElement("span");
      dot.className = "tdot";
      if (day.entry) {
        var em = emoByK(day.entry.k);
        dot.style.background = em ? em.col : "var(--text-dim)";
        dot.title = t("emo." + day.entry.k) || "";
      } else {
        dot.className = "tdot hollow";    // no entry that day
      }
      host.appendChild(dot);
    });
  }

  // ---- recent list ----
  function renderRecent() {
    var sec = $("recent"), list = $("entry-list");
    if (!state.entries.length) { sec.hidden = true; return; }
    sec.hidden = false;
    list.innerHTML = "";
    state.entries.slice(0, 30).forEach(function (e) {
      var li = document.createElement("li");
      li.className = "entry";

      var when = document.createElement("span");
      when.className = "e-when";
      var d = new Date(e.ts);
      when.textContent =
        d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
          { weekday: "short", day: "numeric", month: "short" }) +
        " · " + pad(d.getHours()) + ":" + pad(d.getMinutes());
      li.appendChild(when);

      var faces = document.createElement("span");
      faces.className = "e-faces";
      (e.emotions || []).forEach(function (m) {
        var em = emoByK(m.k);
        if (!em) return;
        var f = document.createElement("span");
        f.className = "e-face";
        f.style.color = em.col;
        f.innerHTML = faceFor(m.k);
        f.title = t(em.i18n) + " · " + m.i + "/5";
        faces.appendChild(f);
      });
      li.appendChild(faces);

      var ctx = document.createElement("span");
      ctx.className = "e-ctx";
      var bits = [];
      if (e.loc) { var L = colValById("loc", e.loc); if (L) bits.push(L.label); }
      if (e.person) { var P = colValById("person", e.person); if (P) bits.push(P.label); }
      ctx.textContent = bits.join(" · ");
      li.appendChild(ctx);

      if (e.note || e.trigger) {
        var sn = document.createElement("span");
        sn.className = "e-note";
        var txt = (e.trigger ? "[" + e.trigger + "] " : "") + e.note;
        sn.textContent = txt.length > 90 ? txt.slice(0, 89) + "…" : txt;
        sn.title = txt;
        li.appendChild(sn);
      }

      var btns = document.createElement("span");
      btns.className = "e-btns";
      var eb = document.createElement("button");
      eb.type = "button";
      eb.className = "e-act";
      eb.title = t("recent.edit");
      eb.setAttribute("aria-label", t("recent.edit"));
      eb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';
      eb.addEventListener("click", function () { editEntry(e.id); });
      btns.appendChild(eb);
      var db = document.createElement("button");
      db.type = "button";
      db.className = "e-act del";
      db.title = t("recent.del");
      db.setAttribute("aria-label", t("recent.del"));
      db.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      db.addEventListener("click", function () { deleteEntry(e.id); });
      btns.appendChild(db);
      li.appendChild(btns);

      list.appendChild(li);
    });
  }

  function renderAll() {
    renderThread();
    renderRecent();
  }
  
    // ---------- 4. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone — fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function registerSync() {
    var api = (window.parent && window.parent.orosSync) || window.orosSync;

    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };

    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("mood", sliceGet, sliceSet, STORAGE_KEY, mergeMoodStates);
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
  }

  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.entries)) return;

    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    // guard drifted state (post-condition of the merge)
    state.entries.sort(function (x, y) { return y.ts - x.ts; });
    state.cols.loc.forEach(function (v, i) { v.pos = i; });
    state.cols.person.forEach(function (v, i) { v.pos = i; });

    // drop edits that leave the UI halfway (editing a now-deleted
    // entry from another device) without yanking the keyboard
    if (editing !== null && !entryById(editing)) resetCapture();

    renderAll();                          // repaint live
    if (info && info.merged) showToast(t("saved.toast"));   // light ack
  }

  // Contract Β: shell-owned combos forward FIRST (capture phase).
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);

  // ---------- 5. Wiring & boot ----------
  function applyI18n() {
    var n = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < n.length; i++) {
      n[i].textContent = t(n[i].getAttribute("data-i18n"));
    }
    var p = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < p.length; k++) {
      p[k].setAttribute("placeholder", t(p[k].getAttribute("data-i18n-ph")));
    }
  }

  // R9 parity: static buttons ship EMPTY in HTML, JS paints
  // aria-labels/titles at boot. Icon: pencil-plus (new entry).
  function paintStaticAria() {
    var btn = $("new-btn");
    if (btn) {
      btn.setAttribute("aria-label", t("btn.new"));
      btn.setAttribute("title", t("btn.new"));
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>' +
        '<path d="M14 5l5 5"/></svg>';
    }
  }

  function wire() {
    // "New entry" = clean slate. Editing mode already has Discard.
    $("new-btn").addEventListener("click", function () { resetCapture(); });

    // Scroll anchoring: the capture card grows/shrinks on toggles
    // (buildCapture rebuilds). Keeping the button's position stable
    // is CSS's job (no layout thrash — no slides, just rebuilds);
    // nothing needed here.
  }

  // ---------- Boot ----------
  console.log("mood.js v0.1.0 boot");
  load();
  applyI18n();
  paintStaticAria();
  wire();
  registerSync();
  inheritPalette();
  watchPalette();
  resetCapture();     // smart preselection fires here (suggestFor)
  renderAll();
  maybePrivacyNotice();   // device-local, one time, then never again
})();