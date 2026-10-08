// ============================================================
// calculator.js — orOS Calculator (full rewrite, feature wave 1)
// Structure:
//   1. i18n (EN/EL, lazy — normal + troll string packs)
//   2. Palette bridge (inheritPalette / watchPalette, mood.js
//      canonical pattern — CI requirement)
//   3. State + persistence (slice "calculator", LWW + tombstones)
//   4. Engine (standard calculator semantics, full keyboard)
//   5. Troll mode (teasing language ALWAYS, plausible lies,
//      never consecutive, 3 intensity levels)
//   6. Rendering (display, keypad, history)
//   7. Sync slice registration (parent orosSync, cache key)
//   8. Contract B forwarding (Ctrl+Alt+Shift shell shortcuts)
//   9. Extras: copy-to-clipboard, Ans, single-level undo,
//      drag-resizable history panel (persisted width)
//  10. Boot logs, wiring
// Mantras honored: offline first, mobile first, no external
// dependencies, full sync + snapshots + manual/auto export via
// the slice contract (zero shell changes needed).
// ============================================================
(function () {
  "use strict";

  var CALC_VER = "1.2.0";
  var LS_KEY = "oros-calculator-data";   // slice cache key (same as
                                         // radio/mood pattern)
  var HISTORY_MAX = 50;

  // ---------- 1. i18n ----------
  function lang() {
    // Shell doctrine: iframe apps read localStorage["oros-lang"]
    // directly (initPrefs writes it on every boot and toggle; the
    // shell re-opens the iframe on language change). Parent window
    // is a same-origin fallback only.
    if (localStorage.getItem("oros-lang") === "el") return "el";
    try {
      if (window.parent && window.parent.orosLang === "el") return "el";
    } catch (e) {}
    return "en";
  }

  var STRINGS = {
    en: {
      "calc.title": "Calculator",
      "calc.key.ac": "AC",
      "calc.key.back": "Backspace",
      "calc.key.ans": "Ans",
      "calc.history": "History",
      "calc.history.clear": "Clear",
      "calc.history.empty": "Nothing here yet.",
      "calc.troll": "Troll mode",
      "calc.troll.on": "On",
      "calc.troll.off": "Off",
      "calc.copy_hint": "Click to copy",
      "calc.undo": "Undone.",
      "calc.copied": "Copied to clipboard.",
      "calc.intensity": "Troll intensity",
      "calc.intensity.subtle": "Subtle",
      "calc.intensity.balanced": "Balanced",
      "calc.intensity.rampant": "Rampant",
      "calc.exported": "History exported to CSV.",
      "calc.history.empty_export": "History is empty.",
      "calc.mem.stored": "Stored in memory.",
      "calc.mem.recalled": "Recalled from memory.",
      "calc.mem.cleared": "Memory cleared.",
      "calc.mem.empty": "Memory is empty.",
      "calc.saveFail": "Could not save: the browser storage is full."
    },
    el: {
      "calc.title": "Αριθμομηχανή",
      "calc.key.ac": "AC",
      "calc.key.back": "Διαγραφή",
      "calc.key.ans": "Ans",
      "calc.history": "Ιστορικό",
      "calc.history.clear": "Καθαρισμός",
      "calc.history.empty": "Τίποτα εδώ ακόμα.",
      "calc.troll": "Λειτουργία πειράγματος",
      "calc.troll.on": "Ενεργό",
      "calc.troll.off": "Ανενεργό",
      "calc.copy_hint": "Κλικ για αντιγραφή",
      "calc.undo": "Αναίρεση πράξης.",
      "calc.copied": "Αντιγράφηκε στο πρόχειρο.",
      "calc.intensity": "Ένταση πειράγματος",
      "calc.intensity.subtle": "Ήπιο",
      "calc.intensity.balanced": "Ισορροπημένο",
      "calc.intensity.rampant": "Καταιγιστικό",
      "calc.exported": "Το ιστορικό εξήχθη σε CSV.",
      "calc.history.empty_export": "Το ιστορικό είναι κενό.",
      "calc.mem.stored": "Αποθηκεύτηκε στη μνήμη.",
      "calc.mem.recalled": "Ανακλήθηκε από τη μνήμη.",
      "calc.mem.cleared": "Η μνήμη καθαρίστηκε.",
      "calc.mem.empty": "Η μνήμη είναι κενή.",
      "calc.saveFail": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε."
    }
  };

  // Troll pack — used ONLY when troll mode is on. These REPLACE
  // the display hint strings, so the app talks smack regardless of
  // whether the current result is right or wrong.
  var TROLL_STRINGS = {
    en: {
      "calc.history": "Receipts of my crimes",
      "calc.history.empty": "You haven't annoyed me yet.",
      "calc.troll.hint": "Trust me. I'm a calculator.",
      "toast.true": "Fine, take your correct answer. Nerd.",
      "toast.false.1": "Math is hard. You understand, right?",
      "toast.false.2": "I did the math. Probably. Mostly. Trust me.",
      "toast.false.3": "That's the answer. Any other calculator would agree*.\n*terms apply",
      "toast.false.4": "Rounded for your convenience. Generously.",
      "toast.false.5": "Confidently calculated. Confidence is free."
    },
    el: {
      "calc.history": "Αποδείξεις των εγκλημάτων μου",
      "calc.history.empty": "Δεν με έχεις εκνευρίσει ακόμα.",
      "calc.troll.hint": "Έμπισέ με. Είμαι αριθμομηχανή.",
      "toast.true": "Πάλι καλά που το πήρες σωστό. Φροντισμένος/η.",
      "toast.false.1": "Τα μαθηματικά είναι δύσκολα. Με καταλαβαίνεις, έτσι;",
      "toast.false.2": "Το υπολόγισα. Πιθανόν. Κυρίως. Έμπισέ με.",
      "toast.false.3": "Αυτή είναι η απάντηση. Οποιαδήποτε άλλη αριθμομηχανή θα συμφωνούσε*.\n*με όρους",
      "toast.false.4": "Στρογγυλοποιήθηκε για την ευκολία σου. Γενναιόδωρα.",
      "toast.false.5": "Υπολογίστηκε με σιγουριά. Η σιγουριά είναι δωρεάν."
    }
  };

  function t(key) {
    if (state.troll && TROLL_STRINGS[lang()][key]) {
      return TROLL_STRINGS[lang()][key];
    }
    return STRINGS[lang()][key] || STRINGS.en[key] || key;
  }

  // ---------- 2. Palette bridge (mood.js canonical) ----------
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
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone — fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(function () {
        inheritPalette();
      }).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  // ---------- 3. State + persistence ----------
  var state = {
    troll: false,           // travels in the slice
    trollIntensity: 1,       // 0 subtle / 1 balanced / 2 rampant — slice
    mem: null,               // memory register (number or null) — slice
    sciOn: false,             // scientific row visible — slice
    sm: { mem: 0, sciOn: 0, troll: 0, trollIntensity: 0 },  // CA-2 stamps — slice
    history: [],             // [{id, expr, res, ts}] newest-first, cap 50
    deleted: {},             // tombstone map (id → ts) for merge
    panelWidth: 300,         // history panel width (wide layout) — device-local
    // --- transient (not persisted) ---
    cur: "0",                // current entry string
    acc: null,               // accumulated value
    op: null,                // pending operator
    fresh: true,             // true = next digit starts fresh
    lastTrolled: false,      // prevents consecutive troll lies
    lastAnswer: null,        // reused by Ans
    lastRes: "0",            // value offered by click-to-copy
    prev: null               // single-level undo snapshot
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // CA-1 (A2): the stored copy, the slice getter and the merge share
  // ONE canonical form (R26), so two devices that hold the same data
  // hold the same bytes and an idle sync uploads nothing.
  //   { ver:1, troll, trollIntensity, mem, sciOn,
  //     sm{ mem, sciOn, troll, trollIntensity },        // CA-2 stamps
  //     history[{ id, expr, res, ts, lied? }]           // ts DESC, id
  //     deleted{ id: ts } }                             // sorted keys
  // `panelWidth` left the slice: it is view state of one device and
  // lives in PREFS_KEY now (R10). Older devices keep their own width.
  var PREFS_KEY = "oros-calculator-prefs";       // device-local
  var BROKEN_KEY = "oros-calculator-data-broken"; // rescue copy (CA-5)
  var SETTINGS = ["mem", "sciOn", "troll", "trollIntensity"];
  var TOMB_KEEP = 30 * 86400000;   // tombstones kept 30 days of DATA time

  function validSetting(k, v) {
    if (k === "troll" || k === "sciOn") return typeof v === "boolean";
    if (k === "trollIntensity") return v === 0 || v === 1 || v === 2;
    if (k === "mem") return v === null || (typeof v === "number" && isFinite(v));
    return false;
  }
  var SETTING_DEFAULT = { mem: null, sciOn: false, troll: false, trollIntensity: 1 };

  function stampOf(n) {
    return (typeof n === "number" && isFinite(n) && n > 0) ? Math.floor(n) : 0;
  }

  function canonEntry(h) {
    if (!h || typeof h !== "object") return null;
    if (typeof h.id !== "string" || !h.id) return null;
    if (typeof h.expr !== "string" || typeof h.res !== "string") return null;
    if (typeof h.ts !== "number" || !isFinite(h.ts)) return null;
    var o = { id: h.id, expr: h.expr, res: h.res, ts: h.ts };
    if (h.lied === true) o.lied = true;
    return o;
  }

  function entryOrder(a, b) {
    if (a.ts !== b.ts) return b.ts - a.ts;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }

  // Canonical copy of any stored / remote / merged object. Pure: no
  // clock, no randomness, input never mutated. A side WITHOUT `sm`
  // (written by calculator.js 1.2.0 or older) counts as stamp 1 for
  // every valid setting it carries, so a setting changed on this
  // version (stamp = ms) wins and an untouched default (0) loses.
  function canonCalc(d) {
    if (!d || typeof d !== "object") d = {};
    var hasSm = d.sm && typeof d.sm === "object";
    var out = { ver: 1 };
    var sm = {};
    SETTINGS.forEach(function (k) {
      if (validSetting(k, d[k])) {
        out[k] = d[k];
        sm[k] = hasSm ? stampOf(d.sm[k]) : 1;
      } else {
        out[k] = SETTING_DEFAULT[k];
        sm[k] = 0;
      }
    });
    // fixed key order
    var o = { ver: 1, troll: out.troll, trollIntensity: out.trollIntensity,
              mem: out.mem, sciOn: out.sciOn,
              sm: { mem: sm.mem, sciOn: sm.sciOn, troll: sm.troll,
                    trollIntensity: sm.trollIntensity } };
    var del = {};
    if (d.deleted && typeof d.deleted === "object") {
      Object.keys(d.deleted).forEach(function (id) {
        var ts = d.deleted[id];
        if (typeof ts === "number" && isFinite(ts)) del[id] = ts;
      });
    }
    var seen = {};
    var hist = [];
    (Array.isArray(d.history) ? d.history : []).forEach(function (h) {
      var e = canonEntry(h);
      if (!e || del[e.id] !== undefined) return;
      var prev = seen[e.id];
      if (prev && !newerEntry(e, prev)) return;
      seen[e.id] = e;
    });
    Object.keys(seen).forEach(function (id) { hist.push(seen[id]); });
    hist.sort(entryOrder);
    if (hist.length > HISTORY_MAX) hist.length = HISTORY_MAX;
    // Tombstone pruning by DATA time (never the device clock): the
    // same rule runs in the getter and in the merge (R26, Part VI).
    var newest = 0;
    hist.forEach(function (h) { if (h.ts > newest) newest = h.ts; });
    Object.keys(del).forEach(function (id) { if (del[id] > newest) newest = del[id]; });
    SETTINGS.forEach(function (k) { if (o.sm[k] > newest) newest = o.sm[k]; });
    var keep = {};
    Object.keys(del).sort().forEach(function (id) {
      if (del[id] >= newest - TOMB_KEEP) keep[id] = del[id];
    });
    o.history = hist;
    o.deleted = keep;
    return o;
  }

  function newerEntry(a, b) {             // true when a beats b (R5)
    if (a.ts !== b.ts) return a.ts > b.ts;
    return JSON.stringify(a) > JSON.stringify(b);
  }

  // CA-1 merge (5th argument of registerSlice). Symmetric, idempotent:
  // settings per field by stamp (tie → greater JSON value), history
  // union by id, tombstones max-ts union (a tombstone always wins: a
  // history entry is never edited, so nothing can resurrect it).
  function mergeCalc(a, b) {
    var A = canonCalc(a), B = canonCalc(b);
    var m = { ver: 1, sm: {} };
    SETTINGS.forEach(function (k) {
      var sa = A.sm[k], sb = B.sm[k], pick;
      if (sa !== sb) pick = sa > sb ? A : B;
      else pick = JSON.stringify(A[k]) >= JSON.stringify(B[k]) ? A : B;
      m[k] = pick[k];
      m.sm[k] = pick.sm[k];
    });
    var del = {};
    [A.deleted, B.deleted].forEach(function (src) {
      Object.keys(src).forEach(function (id) {
        if (del[id] === undefined || src[id] > del[id]) del[id] = src[id];
      });
    });
    m.deleted = del;
    m.history = A.history.concat(B.history);
    return canonCalc(m);
  }

  function readLS() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_KEY));
      if (!raw || typeof raw !== "object") return null;
      return raw;
    } catch (e) { return null; }
  }

  function stateData() {
    var sm = state.sm || {};
    return canonCalc({
      troll: !!state.troll, trollIntensity: state.trollIntensity,
      mem: state.mem, sciOn: !!state.sciOn,
      sm: { mem: sm.mem, sciOn: sm.sciOn, troll: sm.troll,
            trollIntensity: sm.trollIntensity },
      history: state.history, deleted: state.deleted
    });
  }

  function takeData(d) {
    var c = canonCalc(d);
    state.troll = c.troll;
    state.trollIntensity = c.trollIntensity;
    state.mem = c.mem;
    state.sciOn = c.sciOn;
    state.sm = c.sm;
    state.history = c.history;
    state.deleted = c.deleted;
    return c;
  }

  // CA-2: a setting is stamped at the mutation site only (R27).
  function touchSetting(k) {
    if (!state.sm) state.sm = { mem: 0, sciOn: 0, troll: 0, trollIntensity: 0 };
    state.sm[k] = Date.now();
  }

  var saveFailNoted = false;
  function persist(notifyParent) {
    var c = takeData(stateData());
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(c));
    } catch (e) {
      if (!saveFailNoted) {             // R30: never swallow a failed write
        saveFailNoted = true;
        transientNote(t("calc.title"), t("calc.saveFail"));
      }
    }
    if (notifyParent) markDirty();
  }

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY));
      return (p && typeof p === "object") ? p : null;
    } catch (e) { return null; }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ panelWidth: state.panelWidth }));
    } catch (e) {}
  }

  function hydrate() {
    var rawStr = null;
    try { rawStr = localStorage.getItem(LS_KEY); } catch (e) {}
    var raw = readLS();
    if (rawStr && !raw) {
      // CA-5: unreadable stored data is copied aside before anything
      // can write over it (rescue backup before any reseed).
      try {
        if (!localStorage.getItem(BROKEN_KEY)) localStorage.setItem(BROKEN_KEY, rawStr);
      } catch (e) {}
    }
    var prefs = loadPrefs();
    var pw = prefs && prefs.panelWidth;
    if (typeof pw !== "number" && raw) pw = raw.panelWidth;   // first run: old synced field
    if (typeof pw === "number" && pw >= 200 && pw <= 500) state.panelWidth = pw;
    if (!raw) return;
    takeData(raw);
  }

  function markDirty() {
    try {
      var sync = window.parent.orosSync || window.orosSync;
      if (sync && typeof sync.markDirty === "function") sync.markDirty();
    } catch (e) {}
  }

  // orosDialog lives in the parent shell (same-origin iframe).
  // Standalone PWA mode -> null -> caller uses local fallback.
  function dialogHost() {
    try {
      return window.orosDialog || window.parent.orosDialog || null;
    } catch (e) { return null; }
  }

  // ---------- Unified notifications (transient only — this app
  // has no reminders, so nothing ever enters the inbox) ----------
  function transientNote(title, body) {
    try {
      var N = window.parent.orosNotifs || window.orosNotifs;
      if (N && typeof N.transient === "function") {
        N.transient({ ns: "calculator", title: title, body: body });
        return;
      }
    } catch (e) {}
    // Fallback: console (standalone or stale bundle)
    console.log("[calc]", title, "—", body);
  }

  // ---------- 4. Engine ----------
  var OPS = {
    add: function (a, b) { return a + b; },
    sub: function (a, b) { return a - b; },
    mul: function (a, b) { return a * b; },
    div: function (a, b) { return a / b; }
  };
  var OP_GLYPH = { add: "+", sub: "−", mul: "×", div: "÷" };

  function numToString(n) {
    if (!isFinite(n)) return "Error";
    // Strip float noise: 0.1+0.2 → 0.3
    var s = String(parseFloat(n.toPrecision(12)));
    return s;
  }

  function fmtDisplay(s) {
    // Group integer part with thin spaces (locale-friendly)
    if (s === "Error" || s === "-") return s;
    var neg = s.charAt(0) === "-";
    var body = neg ? s.slice(1) : s;
    var parts = body.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (neg ? "-" : "") + parts.join(".");
  }

  function computePending() {
    if (state.op === null || state.acc === null) return null;
    var b = parseFloat(state.cur);
    if (isNaN(b)) return null;
    var r = OPS[state.op](state.acc, b);
    if (!isFinite(r)) return "Error";
    return r;
  }

  // Was called but never defined in v1.0.0 (latent ReferenceError
  // on chained divide-by-zero). Now real: surface "Error" cleanly.
  function renderError() {
    state.cur = "Error";
    state.acc = null;
    state.op = null;
    state.fresh = true;
    render();
  }

  // Single-level undo: snapshot taken before every mutating press.
  function saveUndoState() {
    state.prev = {
      cur: state.cur,
      acc: state.acc,
      op: state.op,
      fresh: state.fresh,
      lastRes: state.lastRes
    };
  }

  function undoLast() {
    if (!state.prev) return false;
    state.cur = state.prev.cur;
    state.acc = state.prev.acc;
    state.op = state.prev.op;
    state.fresh = state.prev.fresh;
    state.lastRes = state.prev.lastRes;
    state.prev = null;
    render();
    return true;
  }

  function pressDigit(d) {
    saveUndoState();
    if (state.fresh) {
      state.cur = d;
      state.fresh = false;
    } else {
      if (state.cur.replace("-", "").replace(".", "").length >= 15) {
        state.prev = null;   // nothing mutated — drop the snapshot
        return;
      }
      if (d === ".") {
        if (state.cur.indexOf(".") !== -1) {
          state.prev = null;
          return;
        }
        state.cur = state.cur === "" ? "0." : state.cur + ".";
      } else {
        state.cur = state.cur === "0" ? d : state.cur + d;
      }
    }
    render();
  }

  function pressOp(op) {
    saveUndoState();
    if (state.op !== null && state.acc !== null && !state.fresh) {
      // Chain: 2 + 3 + → evaluate first
      var r = computePending();
      if (r === "Error") { renderError(); return; }
      state.acc = r;
      state.cur = numToString(r);
    } else {
      state.acc = parseFloat(state.cur);
      if (isNaN(state.acc)) state.acc = 0;
    }
    state.op = op;
    state.fresh = true;
    render();
  }

  function pressEq() {
    saveUndoState();
    if (state.op === null || state.acc === null) {
      // Bare "=" on a fresh number — troll still comments
      if (state.troll && state.cur !== "0") {
        trollToast(true);
      }
      return;
    }
    var a = state.acc;
    var op = state.op;
    var b = parseFloat(state.cur);
    if (isNaN(b)) b = 0;

    var exprStr = fmtDisplay(numToString(a)) + " " + OP_GLYPH[op] + " " +
                  fmtDisplay(String(b));

    var result = OPS[op](a, b);
    var shown = (isFinite(result)) ? numToString(result) : "Error";

    var lied = false;
    if (state.troll && isFinite(result) && shouldLie()) {
      shown = numToString(applyLie(result));
      lied = true;
      state.lastTrolled = true;
    } else if (state.troll) {
      state.lastTrolled = false;
    }

    // History entry (skip pure-error results)
    if (shown !== "Error") {
      state.history.unshift({
        id: uid(),
        expr: exprStr,
        res: shown,
        ts: Date.now(),
        lied: lied    // local-only annotation, merges fine (unused by
                      // other devices for decisions)
      });
      if (state.history.length > HISTORY_MAX) {
        state.history.length = HISTORY_MAX;
      }
      persist(true);
      renderHistory();
    }

    state.cur = shown;
    state.acc = null;
    state.op = null;
    state.fresh = true;
    state.lastAnswer = (shown === "Error") ? state.lastAnswer : shown;
    state.lastRes = shown;

    render();

    if (state.troll) trollToast(!lied);
  }

  function pressAc() {
    saveUndoState();
    state.cur = "0";
    state.acc = null;
    state.op = null;
    state.fresh = true;
    render();
  }

  function pressBack() {
    if (state.fresh) { pressAc(); return; }
    saveUndoState();
    state.cur = state.cur.slice(0, -1);
    if (state.cur === "" || state.cur === "-") state.cur = "0";
    render();
  }

  function pressSign() {
    if (state.cur === "0") return;
    saveUndoState();
    if (state.cur.charAt(0) === "-") state.cur = state.cur.slice(1);
    else state.cur = "-" + state.cur;
    render();
  }

  function pressPercent() {
    saveUndoState();
    // Binary %: reduces b relative to a (iOS/Android semantics):
    // 200 + 10% → 220 ; unary on fresh entry: 50% → 0.5
    if (state.op !== null && state.acc !== null && !state.fresh) {
      var b = parseFloat(state.cur);
      state.cur = numToString(state.acc * b / 100);
    } else {
      var v = parseFloat(state.cur);
      if (!isNaN(v)) state.cur = numToString(v / 100);
    }
    render();
  }

  // Memory register (M+ / MR / MC). Single value, slice-synced.
  function pressMc() {
    if (state.mem === null) {           // R28: say so instead of a silent no-op
      transientNote(t("calc.mem.empty"), "");
      return;
    }
    state.mem = null;
    touchSetting("mem");
    persist(true);
    transientNote(t("calc.mem.cleared"), "");
  }
  function pressMr() {
    if (state.mem === null) {
      transientNote(t("calc.mem.empty"), "");
      return;
    }
    saveUndoState();
    state.cur = numToString(state.mem);
    state.fresh = true;
    state.acc = null;
    state.op = null;
    render();
    transientNote(t("calc.mem.recalled"), "");
  }
  function pressMplus() {
    var v = parseFloat(state.cur);
    if (isNaN(v)) return;
    var nm = (state.mem === null) ? v : state.mem + v;
    if (!isFinite(nm)) return;          // JSON cannot carry Infinity
    state.mem = nm;
    touchSetting("mem");
    persist(true);
    transientNote(t("calc.mem.stored"), "");
  }

  // Scientific unary row (revealed by the fx toggle).
  function applyUnary(kind) {
    if (state.cur === "Error") return;
    var v = parseFloat(state.cur);
    if (isNaN(v)) return;
    saveUndoState();
    var r = null;
    if (kind === "sqrt") r = (v < 0) ? "Error" : Math.sqrt(v);
    else if (kind === "sqr") r = v * v;
    else if (kind === "inv") r = (v === 0) ? "Error" : 1 / v;
    if (r === null) return;
    if (r === "Error") { renderError(); return; }
    state.cur = numToString(r);
    render();
  }

  function toggleSciRow() {
    state.sciOn = !state.sciOn;
    touchSetting("sciOn");
    persist(true);
    if (state.sciOn) {
      els.root.setAttribute("data-sci", "on");
    } else {
      els.root.setAttribute("data-sci", "off");
    }
    var fx = document.querySelector('.key[data-k="fx"]');
    if (fx) fx.setAttribute("aria-pressed", state.sciOn ? "true" : "false");
  }

    function pressAns() {
    if (state.lastAnswer === null) return;
    saveUndoState();
    state.cur = state.lastAnswer;
    state.fresh = true;
    render();
  }

  function reuseHistory(id) {
    for (var i = 0; i < state.history.length; i++) {
      if (state.history[i].id === id) {
        saveUndoState();
        state.cur = state.history[i].res;
        state.fresh = true;
        state.acc = null;
        state.op = null;
        render();
        return;
      }
    }
  }

  function clearHistory() {
    if (!state.history.length) {        // R28: no silent no-op
      transientNote(t("calc.title"), t("calc.history.empty_export"));
      return;
    }
    var now = Date.now();
    state.history.forEach(function (h) {
      state.deleted[h.id] = now;   // tombstone — survives merge, travels
    });
    state.history = [];
    persist(true);
    renderHistory();
  }

  // ---------- 5. Troll logic ----------
  // Lie cadence by intensity, NEVER two consecutive lies.
  // If the last evaluation trolled, this one is honest.
  function shouldLie() {
    if (state.lastTrolled) return false;
    var probabilities = [0.16, 0.34, 0.66];  // subtle/balanced/rampant
    var prob = probabilities[state.trollIntensity] || 0.34;
    return Math.random() < prob;
  }

  // Plausible lie: relative error sized by intensity.
  function applyLie(result) {
    var magnitude = Math.abs(result);
    if (magnitude === 0) return result + (Math.random() < 0.5 ? 1 : -1);
    var magMult = (state.trollIntensity === 0) ? 0.02
                : (state.trollIntensity === 2) ? 0.08
                : 0.05;
    var pct = 0.01 + Math.random() * magMult;
    var sign = Math.random() < 0.5 ? 1 : -1;
    var lied = result + sign * pct * magnitude;
    // Round to a "believable" precision (never surgically identical)
    return parseFloat(lied.toPrecision(
      Math.max(2, String(Math.round(magnitude)).length + 1)));
  }

  // In troll mode, EVERY action gets commentary — even the honest
  // answers. Snark always; only the TRUTH varies.
  function trollToast(honest) {
    var pack = TROLL_STRINGS[lang()];
    var key;
    if (honest) {
      key = "toast.true";
    } else {
      var pool = ["toast.false.1", "toast.false.2", "toast.false.3",
                  "toast.false.4", "toast.false.5"];
      key = pool[Math.floor(Math.random() * pool.length)];
    }
    transientNote(pack[key], "");
  }

  function toggleTroll() {
    state.troll = !state.troll;
    touchSetting("troll");
    persist(true);
    render();
    if (state.troll) {
      transientNote(t("calc.troll"),
        lang() === "el"
          ? "Θα σε φροντίσω… με τον δικό μου τρόπο."
          : "I'll take good care of you… my way.");
    }
  }

  function setTrollIntensity(level) {
    var lvl = ((level % 3) + 3) % 3;   // clamp/cycle 0–2
    if (lvl === state.trollIntensity) return;
    state.trollIntensity = lvl;
    touchSetting("trollIntensity");
    persist(true);
    render();
    transientNote(t("calc.intensity"), t("calc.intensity." +
      ["subtle", "balanced", "rampant"][lvl]));
  }

  // ---------- 6. Rendering ----------
  var els = {};

  function render() {
    // Display
    els.expr.textContent = (state.op !== null && state.acc !== null)
      ? fmtDisplay(numToString(state.acc)) + " " + OP_GLYPH[state.op] +
        (state.fresh ? "" : " " + fmtDisplay(state.cur))
      : "";
    els.res.textContent = fmtDisplay(state.cur);

    // Tooltip: trolling hint or the copy affordance
    els.res.title = state.troll ? t("calc.troll.hint") : t("calc.copy_hint");

    // Troll flavor on the display itself
    if (state.troll) {
      els.root.setAttribute("data-troll", "on");
    } else {
      els.root.removeAttribute("data-troll");
    }

    // Toggle button state (+ intensity in the accessible label)
    els.trollToggle.setAttribute("aria-pressed", state.troll ? "true" : "false");
    els.trollState.textContent = state.troll ? t("calc.troll.on") : t("calc.troll.off");
    // Intensity dots: ●○○ / ●●○ / ●●● (visible only while troll is on)
    els.trollIntensity.textContent = state.troll
      ? ["●○○", "●●○", "●●●"][state.trollIntensity] || "●●○"
      : "";

    applyI18nText();
  }

  function applyI18nText() {
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      // #calc-res deliberately has NO data-i18n (its textContent is
      // the live result — i18n must never overwrite the number)
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
  }

  function renderHistory() {
    els.historyList.innerHTML = "";
    var frag = document.createDocumentFragment();
    state.history.forEach(function (h) {
      var li = document.createElement("li");
      li.dataset.id = h.id;
      // Negative-result feedback (subtle danger tint)
      if (typeof h.res === "string" && h.res.charAt(0) === "-") {
        li.classList.add("neg");
      }

      var expr = document.createElement("div");
      expr.className = "h-expr";
      expr.textContent = h.expr + " =";

      var res = document.createElement("div");
      res.className = "h-res";
      res.textContent = fmtDisplay(h.res);

      li.appendChild(expr);
      li.appendChild(res);
      li.addEventListener("click", function () {
        reuseHistory(this.dataset.id);
      });
      frag.appendChild(li);
    });
    els.historyList.appendChild(frag);
    els.historyEmpty.hidden = state.history.length > 0;
  }

  // ---------- Copy to clipboard ----------
  function copyToClipboard(text) {
    if (!text) return;
    var done = function () {
      transientNote(t("calc.copied"), "");
    };
    try {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        legacyCopy(text, done);
      });
    } catch (e) {
      legacyCopy(text, done);
    }
  }

  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* silent */ }
  }

  // ---------- CSV export of history ----------
  function exportHistory() {
    if (!state.history.length) {
      transientNote(t("calc.title"), t("calc.history.empty_export"));
      return;
    }
    var esc = function (s) {
      return '"' + String(s).replace(/"/g, '""') + '"';
    };
    var rows = [["timestamp", "expression", "result"].join(",")];
    // Oldest-first: natural reading order in spreadsheets
    state.history.slice().reverse().forEach(function (h) {
      rows.push([
        new Date(h.ts).toISOString(),
        esc(h.expr),
        esc(h.res)
      ].join(","));
    });
    // UTF-8 BOM so Greek/expression text opens cleanly in Excel
    var blob = new Blob(["\uFEFF" + rows.join("\r\n")],
      { type: "text/csv;charset=utf-8" });
    var done = function () {
      transientNote(t("calc.exported"), "");
    };
    var dlg = dialogHost();

    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({
        blob: blob,
        filename: "oros-calculator-history.csv",
        mime: "text/csv;charset=utf-8",
        types: [{ description: "CSV",
                  accept: { "text/csv": [".csv"] } }]
      }).then(function (r) { if (r && r.ok) done(); });
      return;                         // cancel (ok=false) = silent exit
    }

    // Standalone fallback — classic download (no shell present).
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "oros-calculator-history.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      done();
    } catch (e) {}
  }

  // ---------- Drag-resizable history panel (wide layout) ----------
  function initDragResize() {
    var panel = document.querySelector(".calc-history");
    if (!panel) return;

    var startX = null;
    var startWidth = null;
    var MIN_W = 200, MAX_W = 500;

    // The ::before handle sits OUTSIDE the border box (left:-4px,
    // width 8px) — hit-test by distance from the panel's left
    // edge instead of target element.
    panel.addEventListener("mousedown", function (e) {
      if (!window.matchMedia("(min-width: 880px)").matches) return;
      if (e.button !== 0) return;
      if (e.target.closest("li") || e.target.closest("#history-clear")) return;
      var rect = panel.getBoundingClientRect();
      if (e.clientX - rect.left > 12) return;   // only the handle strip

      startX = e.clientX;
      startWidth = panel.offsetWidth;
      panel.classList.add("resizing");
      document.body.style.cursor = "col-resize";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      e.preventDefault();
    });

    function onMove(e) {
      if (startX === null) return;
      // Panel is docked RIGHT of the keypad → dragging LEFT
      // grows it: newWidth = startWidth - delta
      var delta = e.clientX - startX;
      var w = Math.max(MIN_W, Math.min(MAX_W, startWidth - delta));
      panel.style.setProperty("--hist-w", w + "px");
    }

    function onUp() {
      if (startX !== null) {
        var w = parseInt(panel.style.getPropertyValue("--hist-w"), 10);
        if (w >= MIN_W && w <= MAX_W) {
          state.panelWidth = w;
          savePrefs();      // CA-3: device-local view state (R10)
        }
      }
      startX = null;
      startWidth = null;
      panel.classList.remove("resizing");
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
  }

  function restorePanelWidth() {
    var panel = document.querySelector(".calc-history");
    if (!panel) return;
    // CA-6: a CSS variable, used only by the wide (>= 880px) layout;
    // an inline width squeezed the stacked phone layout to 300 px.
    if (state.panelWidth >= 200 && state.panelWidth <= 500) {
      panel.style.setProperty("--hist-w", state.panelWidth + "px");
    }
  }

  // ---------- 7. Sync slice registration ----------
  function registerSlice() {
    try {
      var sync = window.parent.orosSync;
      if (!sync || typeof sync.registerSlice !== "function") return;
      sync.registerSlice("calculator", sliceGet, sliceSet, LS_KEY, mergeCalc);
      console.log("[calc] slice registered: calculator");
    } catch (e) {
      console.warn("[calc] slice registration skipped (standalone?)");
    }
  }

  // The getter is the canonical stored copy; null while this device
  // has never stored anything (a fresh device pushes nothing).
  function sliceGet() {
    var raw = readLS();
    return raw ? canonCalc(raw) : null;
  }

  // Pull-fed: no markDirty (R6); an echo of what is held changes nothing.
  function sliceSet(data) {
    if (!data || typeof data !== "object") return;
    var next = canonCalc(data);
    if (JSON.stringify(next) === JSON.stringify(stateData()) && readLS()) return;
    takeData(next);
    persist(false);
    render();
    renderHistory();
    els.root.setAttribute("data-sci", state.sciOn ? "on" : "off");
    var fx = document.querySelector('.key[data-k="fx"]');
    if (fx) fx.setAttribute("aria-pressed", state.sciOn ? "true" : "false");
  }

  // ---------- 7b. Parent keyboard routing ----------
  // When the calc iframe is open but focus sits on the shell
  // (right after opening, before the first click inside the
  // window), keydown events never reach this document. Browsers
  // deliver key events only to the focused browsing context, so
  // when the iframe DOES have focus the parent never fires —
  // this cannot double-handle anything.
  function wireParentKeyRouting() {
    var parentDoc;
    try { parentDoc = window.parent.document; } catch (e) { return; }
    if (!parentDoc || parentDoc === document) return;   // standalone
    // CA-4 (A16, A32): the listener belongs to THIS document. It is
    // removed when the app is closed (pagehide), and it checks that
    // its document is still the one shown: a closed calculator kept
    // computing from shell keystrokes and wrote its stale in-memory
    // state over the stored (and meanwhile synced) data. Reopening
    // stacked one more listener each time.
    function routed(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;   // shell territory
      if (!document.defaultView || !els.root || !els.root.isConnected) {
        drop();
        return;
      }
      if (e.defaultPrevented) return;
      // Escape belongs to the shell (it closes dialogs, menu, app).
      if (e.key === "Escape") return;
      // Never steal typing meant for shell inputs/modals
      var tgt = e.target;
      if (tgt && tgt.closest &&
          tgt.closest("input, textarea, select, [contenteditable='true'], dialog")) return;
      try { if (parentDoc.querySelector("dialog[open]")) return; } catch (e2) {}
      onKey(e);
    }
    function drop() {
      try { parentDoc.removeEventListener("keydown", routed); } catch (e) {}
    }
    parentDoc.addEventListener("keydown", routed);
    window.addEventListener("pagehide", drop);
  }

  // ---------- 8. Contract B forwarding ----------
  function wireShortcutForwarding() {
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey) {
        try {
          if (window.parent.orosShortcuts &&
              typeof window.parent.orosShortcuts.handle === "function") {
            if (window.parent.orosShortcuts.handle(e)) {
              e.preventDefault();
              e.stopPropagation();
            }
          }
        } catch (e2) {}
      }
    }, true);   // capture phase — shell combos never reach app logic
  }

  // ---------- 9. Keyboard (app-level) ----------
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    // NumLock OFF: e.key is "End"/"PageUp" etc. — recover the
    // numpad glyph from the physical key code so the numpad
    // works in both NumLock states.
    var NP = {
      Numpad0: "0", Numpad1: "1", Numpad2: "2", Numpad3: "3",
      Numpad4: "4", Numpad5: "5", Numpad6: "6", Numpad7: "7",
      Numpad8: "8", Numpad9: "9",
      NumpadAdd: "+", NumpadSubtract: "-", NumpadMultiply: "*",
      NumpadDivide: "/", NumpadDecimal: ".", NumpadEnter: "Enter"
    };
    if (e.code && NP[e.code]) k = NP[e.code];
    if (k >= "0" && k <= "9") { pressDigit(k); }
    else if (k === "." || k === ",") { pressDigit("."); }
    else if (k === "+") { pressOp("add"); }
    else if (k === "-") { pressOp("sub"); }
    else if (k === "*") { pressOp("mul"); }
    else if (k === "/") { pressOp("div"); e.preventDefault(); }
    else if (k === "Enter" || k === "=") {
      pressEq();
      flashEq();
      e.preventDefault();
    }
    else if (k === "Backspace") { pressBack(); e.preventDefault(); }
    else if (k === "Escape") { pressAc(); }
    else if (k === "%") { pressPercent(); }
    else if (k === "Delete") { pressAc(); }
    else if (k === "a" || k === "A") { pressAns(); }
  }

  // Ctrl+Z (no alt/shift — avoids any contract B combos)
  function onUndoKey(e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey &&
        e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (undoLast()) transientNote(t("calc.undo"), "");
    }
  }

  function flashEq() {
    var eq = document.querySelector('.key[data-k="eq"]');
    if (!eq) return;
    eq.classList.add("flash");
    setTimeout(function () { eq.classList.remove("flash"); }, 120);
  }

  // ---------- 10. Boot ----------
  function wireUI() {
    els.root = document.getElementById("calc-root");
    els.expr = document.getElementById("calc-expr");
    els.res = document.getElementById("calc-res");
    els.trollToggle = document.getElementById("troll-toggle");
    els.trollState = document.getElementById("troll-state");
    els.trollIntensity = document.getElementById("troll-intensity");

    // ⌫ keeps its glyph on screen; the label is translated here
    document.querySelector('.key[data-k="back"]').setAttribute(
      "aria-label", t("calc.key.back"));
    els.historyList = document.getElementById("calc-history");
    els.historyEmpty = document.getElementById("history-empty");
    els.pad = document.getElementById("calc-pad");

    // Keypad — single delegated handler, incl. Ans
    els.pad.addEventListener("click", function (e) {
      var btn = e.target.closest("button.key");
      if (!btn) return;
      var k = btn.dataset.k;
      if (OPS[k]) pressOp(k);
      else if (k === "eq") { pressEq(); flashEq(); }
      else if (k === "ac") pressAc();
      else if (k === "back") pressBack();
      else if (k === "sign") pressSign();
      else if (k === "pcnt") pressPercent();
      else if (k === "ans") pressAns();
      else if (k === "mc") pressMc();
      else if (k === "mr") pressMr();
      else if (k === "mplus") pressMplus();
      else if (k === "fx") toggleSciRow();
      else if (k === "sqrt" || k === "sqr" || k === "inv") applyUnary(k);
      else if (k === "dot") pressDigit(".");
      else pressDigit(k);
      // Drop focus so Enter/Space never re-fire the last key
      // (double evaluation on Enter, stuck key on Space)
      btn.blur();
    });

    // Display click = copy current result
    els.res.addEventListener("click", function () {
      copyToClipboard(state.lastRes);
    });

    // Troll toggle: click = on/off.
    // Right-click (contextmenu) = cycle intensity — deliberately NOT
    // dblclick, because a double click would flip the troll state
    // twice (on→off) before reaching the intensity handler.
    // Touch devices: long-press (500ms) = cycle intensity, since
    // they don't produce right-clicks. touchmove cancels the hold,
    // so scrolling never triggers it. If the hold fired, the
    // trailing click is swallowed so the toggle doesn't ALSO flip.
    var lpTimer = null;
    var lpFired = false;
    var touchActive = false;
    els.trollToggle.addEventListener("click", function () {
      if (lpFired) { lpFired = false; return; }
      toggleTroll();
    });
    els.trollToggle.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      // Some mobile browsers fire contextmenu after a long-press —
      // skip it so the cycle doesn't run twice.
      if (touchActive) return;
      setTrollIntensity(state.trollIntensity + 1);
    });
    els.trollToggle.addEventListener("touchstart", function () {
      touchActive = true;
      lpFired = false;
      lpTimer = setTimeout(function () {
        lpFired = true;
        setTrollIntensity(state.trollIntensity + 1);
      }, 500);
    }, { passive: true });
    els.trollToggle.addEventListener("touchend", function () {
      touchActive = false;
      clearTimeout(lpTimer);
    }, { passive: true });
    els.trollToggle.addEventListener("touchmove", function () {
      clearTimeout(lpTimer);
    }, { passive: true });

    document.getElementById("history-clear").addEventListener("click", clearHistory);
    document.getElementById("history-csv").addEventListener("click", exportHistory);

    document.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onUndoKey);
  }

  function boot() {
    // Greek upper case drops its accents only under lang="el".
    document.documentElement.setAttribute("lang", lang());
    inheritPalette();   // before first paint — correct contrast frame 1
    watchPalette();
    hydrate();
    wireUI();
    wireParentKeyRouting();
    wireShortcutForwarding();
    registerSlice();
    render();
    renderHistory();
    initDragResize();
    restorePanelWidth();
    els.root.setAttribute("data-sci", state.sciOn ? "on" : "off");
    var fxBtn = document.querySelector('.key[data-k="fx"]');
    if (fxBtn) fxBtn.setAttribute("aria-pressed", state.sciOn ? "true" : "false");

    console.log("[calc] calculator v" + CALC_VER + " booted — troll:" +
      (state.troll ? "on" : "off") +
      " intensity:" + state.trollIntensity +
      " history:" + state.history.length);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();