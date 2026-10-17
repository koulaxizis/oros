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
//  11. Modes (2.0.0): Scientific, Graphing, Programmer, Finance;
//      pure logic in core.js (CalcCore), units via UnitsCore
// Mantras honored: offline first, mobile first, no external
// dependencies, full sync + snapshots + manual/auto export via
// the slice contract (zero shell changes needed).
// ============================================================
(function () {
  "use strict";

  var CALC_VER = "2.0.0";
  var LS_KEY = "oros-calculator-data";   // slice cache key (same as
                                         // radio/mood pattern)
  var HISTORY_MAX = 50;

  // ---------- 1. i18n ----------
  function lang() {
    // orosI18n (../i18n.js): the full language code, a pack language included.
    if (window.orosI18n) return window.orosI18n.lang();
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
      "calc.send": "Send to…",
      "calc.send.title": "Send the result to another app",
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
      "calc.saveFail": "Could not save: the browser storage is full.",
      "calc.modes": "Mode",
      "calc.mode.std": "Standard", "calc.mode.std.s": "Basic",
      "calc.mode.sci": "Scientific", "calc.mode.sci.s": "Sci",
      "calc.mode.graph": "Graphing", "calc.mode.graph.s": "Graph",
      "calc.mode.prog": "Programmer", "calc.mode.prog.s": "Prog",
      "calc.mode.fin": "Finance", "calc.mode.fin.s": "Money",
      "calc.kbd": "Type with the keyboard",
      "calc.sci.input": "Expression",
      "calc.2nd": "Second functions",
      "calc.angle": "Angle unit: degrees, radians or gradians",
      "calc.err.syntax": "Check the expression.",
      "calc.err.paren": "A bracket doesn't match.",
      "calc.err.name": "Unknown name: {x}",
      "calc.err.char": "Unknown symbol: {x}",
      "calc.err.domain": "Not defined for this value.",
      "calc.err.div0": "Cannot divide by zero.",
      "calc.err.big": "The number is too large.",
      "calc.err.end": "The expression is incomplete.",
      "calc.err.args": "Wrong number of values for {x}. Separate them with ;",
      "calc.err.digit": "{x} is not a digit in this base.",
      "calc.err.rates": "No exchange rates on this device yet. Getting them now…",
      "calc.err.rates_off": "No exchange rates on this device yet. Connect to the internet and try again.",
      "calc.err.dens": "Cups to grams needs an ingredient: use Unit Converter for that.",
      "calc.err.units_mismatch": "These units measure different things.",
      "calc.err.unit_neg": "This quantity can't be negative.",
      "calc.err.unit_belowZero": "That is below absolute zero.",
      "calc.err.unit_zero": "There is no result for zero.",
      "calc.err.unit_rate": "No exchange rate for this currency.",
      "calc.err.unit_unit": "Unknown unit.",
      "calc.rates.ok": "Exchange rates updated.",
      "calc.g.zin": "Zoom in",
      "calc.g.zout": "Zoom out",
      "calc.g.home": "Reset view",
      "calc.g.canvas": "Graph of the functions",
      "calc.g.hint": "Drag to move, pinch or scroll to zoom, tap a curve to trace it.",
      "calc.g.placeholder": "e.g. sin(x) or x^2 - 2",
      "calc.g.root": "root",
      "calc.g.min": "min",
      "calc.g.max": "max",
      "calc.g.none": "No roots, turning points or crossings in view.",
      "calc.p.bits": "Bits",
      "calc.p.keys": "Keys",
      "calc.p.word": "Word size",
      "calc.f.vat": "VAT", "calc.f.pct": "Percent", "calc.f.loan": "Loan", "calc.f.save": "Savings",
      "calc.f.amount": "Amount", "calc.f.rate": "VAT rate",
      "calc.f.vat.add": "Add VAT", "calc.f.vat.remove": "Remove VAT",
      "calc.f.net": "Net", "calc.f.vatamt": "VAT", "calc.f.gross": "Total",
      "calc.f.pct.change": "Percentage change", "calc.f.from": "From", "calc.f.to": "To",
      "calc.f.change": "Change", "calc.f.diff": "Difference",
      "calc.f.pct.of": "Percent of a number", "calc.f.of": "of", "calc.f.result": "Result",
      "calc.f.pct.what": "What percent is it?", "calc.f.part": "Part", "calc.f.whole": "Whole",
      "calc.f.principal": "Loan amount", "calc.f.apr": "Annual interest rate (%)",
      "calc.f.term": "Term", "calc.f.unit": "Unit", "calc.f.years": "Years", "calc.f.months": "Months",
      "calc.f.instal": "Monthly instalment", "calc.f.totalpaid": "Total paid", "calc.f.totint": "Total interest",
      "calc.f.csv": "Export CSV",
      "calc.f.start": "Starting amount", "calc.f.monthly": "Monthly deposit",
      "calc.f.comp": "Compounding", "calc.f.comp.m": "Monthly", "calc.f.comp.y": "Yearly",
      "calc.f.final": "Final balance", "calc.f.deposits": "Total deposits", "calc.f.earned": "Interest earned",
      "calc.f.col.month": "Month", "calc.f.col.year": "Year", "calc.f.col.pay": "Instalment",
      "calc.f.col.int": "Interest", "calc.f.col.prin": "Principal", "calc.f.col.bal": "Balance",
      "calc.f.col.dep": "Deposits",
      "calc.f.invalid": "Enter valid numbers.",
      "calc.f.exported": "Table exported to CSV.",
      "calc.f.nothing": "Fill in the fields first.",
      "calc.f.note.round": "Rounded to cents; the last instalment absorbs the difference.",
      "calc.f.note.yearly": "Yearly: deposits earn simple interest until the end of each year."
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
      "calc.send": "Αποστολή σε…",
      "calc.send.title": "Αποστολή του αποτελέσματος σε άλλη εφαρμογή",
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
      "calc.saveFail": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε.",
      "calc.modes": "Λειτουργία",
      "calc.mode.std": "Βασική", "calc.mode.std.s": "Βασική",
      "calc.mode.sci": "Επιστημονική", "calc.mode.sci.s": "Επιστ.",
      "calc.mode.graph": "Γραφήματα", "calc.mode.graph.s": "Γράφ.",
      "calc.mode.prog": "Προγραμματιστή", "calc.mode.prog.s": "Προγρ.",
      "calc.mode.fin": "Οικονομικά", "calc.mode.fin.s": "Οικον.",
      "calc.kbd": "Πληκτρολόγηση με το πληκτρολόγιο",
      "calc.sci.input": "Παράσταση",
      "calc.2nd": "Δεύτερες συναρτήσεις",
      "calc.angle": "Μονάδα γωνίας: μοίρες, ακτίνια ή βαθμοί grad",
      "calc.err.syntax": "Έλεγξε την παράσταση.",
      "calc.err.paren": "Μια παρένθεση δεν ταιριάζει.",
      "calc.err.name": "Άγνωστο όνομα: {x}",
      "calc.err.char": "Άγνωστο σύμβολο: {x}",
      "calc.err.domain": "Δεν ορίζεται για αυτή την τιμή.",
      "calc.err.div0": "Δεν γίνεται διαίρεση με το μηδέν.",
      "calc.err.big": "Ο αριθμός είναι πολύ μεγάλος.",
      "calc.err.end": "Η παράσταση είναι ημιτελής.",
      "calc.err.args": "Λάθος πλήθος τιμών για το {x}. Χώρισέ τες με ;",
      "calc.err.digit": "Το {x} δεν είναι ψηφίο σε αυτή τη βάση.",
      "calc.err.rates": "Δεν υπάρχουν ακόμα ισοτιμίες σε αυτή τη συσκευή. Τις φέρνω τώρα…",
      "calc.err.rates_off": "Δεν υπάρχουν ακόμα ισοτιμίες σε αυτή τη συσκευή. Σύνδεσε το ίντερνετ και ξαναδοκίμασε.",
      "calc.err.dens": "Για φλιτζάνια σε γραμμάρια χρειάζεται υλικό: χρησιμοποίησε τον Μετατροπέα μονάδων.",
      "calc.err.units_mismatch": "Αυτές οι μονάδες μετρούν διαφορετικά πράγματα.",
      "calc.err.unit_neg": "Αυτό το μέγεθος δεν μπορεί να είναι αρνητικό.",
      "calc.err.unit_belowZero": "Αυτό είναι κάτω από το απόλυτο μηδέν.",
      "calc.err.unit_zero": "Δεν υπάρχει αποτέλεσμα για το μηδέν.",
      "calc.err.unit_rate": "Δεν υπάρχει ισοτιμία για αυτό το νόμισμα.",
      "calc.err.unit_unit": "Άγνωστη μονάδα.",
      "calc.rates.ok": "Οι ισοτιμίες ενημερώθηκαν.",
      "calc.g.zin": "Μεγέθυνση",
      "calc.g.zout": "Σμίκρυνση",
      "calc.g.home": "Επαναφορά προβολής",
      "calc.g.canvas": "Γράφημα των συναρτήσεων",
      "calc.g.hint": "Σύρε για μετακίνηση, τσίμπησε ή κύλισε για ζουμ, πάτα μια καμπύλη για ανίχνευση.",
      "calc.g.placeholder": "π.χ. sin(x) ή x^2 - 2",
      "calc.g.root": "ρίζα",
      "calc.g.min": "ελάχ.",
      "calc.g.max": "μέγ.",
      "calc.g.none": "Καμία ρίζα, ακρότατο ή τομή στην προβολή.",
      "calc.p.bits": "Bit",
      "calc.p.keys": "Πλήκτρα",
      "calc.p.word": "Μέγεθος λέξης",
      "calc.f.vat": "ΦΠΑ", "calc.f.pct": "Ποσοστά", "calc.f.loan": "Δάνειο", "calc.f.save": "Αποταμίευση",
      "calc.f.amount": "Ποσό", "calc.f.rate": "Συντελεστής ΦΠΑ",
      "calc.f.vat.add": "Προσθήκη ΦΠΑ", "calc.f.vat.remove": "Αφαίρεση ΦΠΑ",
      "calc.f.net": "Καθαρό", "calc.f.vatamt": "ΦΠΑ", "calc.f.gross": "Σύνολο",
      "calc.f.pct.change": "Ποσοστιαία μεταβολή", "calc.f.from": "Από", "calc.f.to": "Σε",
      "calc.f.change": "Μεταβολή", "calc.f.diff": "Διαφορά",
      "calc.f.pct.of": "Ποσοστό αριθμού", "calc.f.of": "του", "calc.f.result": "Αποτέλεσμα",
      "calc.f.pct.what": "Τι ποσοστό είναι;", "calc.f.part": "Μέρος", "calc.f.whole": "Σύνολο",
      "calc.f.principal": "Ποσό δανείου", "calc.f.apr": "Ετήσιο επιτόκιο (%)",
      "calc.f.term": "Διάρκεια", "calc.f.unit": "Μονάδα", "calc.f.years": "Έτη", "calc.f.months": "Μήνες",
      "calc.f.instal": "Μηνιαία δόση", "calc.f.totalpaid": "Σύνολο πληρωμών", "calc.f.totint": "Σύνολο τόκων",
      "calc.f.csv": "Εξαγωγή CSV",
      "calc.f.start": "Αρχικό ποσό", "calc.f.monthly": "Μηνιαία κατάθεση",
      "calc.f.comp": "Ανατοκισμός", "calc.f.comp.m": "Μηνιαίος", "calc.f.comp.y": "Ετήσιος",
      "calc.f.final": "Τελικό υπόλοιπο", "calc.f.deposits": "Σύνολο καταθέσεων", "calc.f.earned": "Τόκοι",
      "calc.f.col.month": "Μήνας", "calc.f.col.year": "Έτος", "calc.f.col.pay": "Δόση",
      "calc.f.col.int": "Τόκος", "calc.f.col.prin": "Κεφάλαιο", "calc.f.col.bal": "Υπόλοιπο",
      "calc.f.col.dep": "Καταθέσεις",
      "calc.f.invalid": "Βάλε έγκυρους αριθμούς.",
      "calc.f.exported": "Ο πίνακας εξήχθη σε CSV.",
      "calc.f.nothing": "Συμπλήρωσε πρώτα τα πεδία.",
      "calc.f.note.round": "Στρογγυλοποίηση σε λεπτά· η τελευταία δόση απορροφά τη διαφορά.",
      "calc.f.note.yearly": "Ετήσιος: οι καταθέσεις παίρνουν απλό τόκο ως το τέλος κάθε έτους."
    }
  };

  // Troll pack — used ONLY when troll mode is on. These REPLACE
  // the display hint strings, so the app talks smack regardless of
  // whether the current result is right or wrong.
  var TROLL_STRINGS = {
    en: {
      "troll.calc.history": "Receipts of my crimes",
      "troll.calc.history.empty": "You haven't annoyed me yet.",
      "troll.calc.troll.hint": "Trust me. I'm a calculator.",
      "troll.toast.true": "Fine, take your correct answer. Nerd.",
      "troll.toast.false.1": "Math is hard. You understand, right?",
      "troll.toast.false.2": "I did the math. Probably. Mostly. Trust me.",
      "troll.toast.false.3": "That's the answer. Any other calculator would agree*.\n*terms apply",
      "troll.toast.false.4": "Rounded for your convenience. Generously.",
      "troll.toast.false.5": "Confidently calculated. Confidence is free.",
      "troll.welcome": "I'll take good care of you… my way."
    },
    el: {
      "troll.calc.history": "Αποδείξεις των εγκλημάτων μου",
      "troll.calc.history.empty": "Δεν με έχεις εκνευρίσει ακόμα.",
      "troll.calc.troll.hint": "Έμπισέ με. Είμαι αριθμομηχανή.",
      "troll.toast.true": "Πάλι καλά που το πήρες σωστό. Φροντισμένος/η.",
      "troll.toast.false.1": "Τα μαθηματικά είναι δύσκολα. Με καταλαβαίνεις, έτσι;",
      "troll.toast.false.2": "Το υπολόγισα. Πιθανόν. Κυρίως. Έμπισέ με.",
      "troll.toast.false.3": "Αυτή είναι η απάντηση. Οποιαδήποτε άλλη αριθμομηχανή θα συμφωνούσε*.\n*με όρους",
      "troll.toast.false.4": "Στρογγυλοποιήθηκε για την ευκολία σου. Γενναιόδωρα.",
      "troll.toast.false.5": "Υπολογίστηκε με σιγουριά. Η σιγουριά είναι δωρεάν.",
      "troll.welcome": "Θα σε φροντίσω… με τον δικό μου τρόπο."
    }
  };

  // A pack language: STRINGS[code] and TROLL_STRINGS[code] (pack "calculator").
  if (window.orosI18n) {
    window.orosI18n.table(STRINGS, "calculator", lang());
    window.orosI18n.table(TROLL_STRINGS, "calculator", lang());
  }
  function strs() { return STRINGS[lang()] || STRINGS.en; }
  function trolls() { return TROLL_STRINGS[lang()] || TROLL_STRINGS.en; }

  // Troll mode overrides a key with its "troll." twin when there is one.
  function t(key) {
    if (state.troll && trolls()["troll." + key]) {
      return trolls()["troll." + key];
    }
    return strs()[key] || STRINGS.en[key] || trolls()[key] || TROLL_STRINGS.en[key] || key;
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
    ui: null,                // modes and their view state — device-local (normUi)
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
      localStorage.setItem(PREFS_KEY, JSON.stringify({ panelWidth: state.panelWidth, ui: state.ui }));
    } catch (e) {}
  }
  var prefsTimer = null;
  function savePrefsSoon() {
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(savePrefs, 400);
  }

  // Device-local view state (R10): the mode, the angle units, the
  // graph's functions and view, programmer base / word size, the
  // finance tool and its fields. Never in the sync slice.
  var MODES = ["std", "sci", "graph", "prog", "fin"];
  var ANGLES = ["deg", "rad", "grad"];
  function defaultUi() {
    return {
      mode: "std", angle: "deg", second: false,
      graph: { fns: ["sin(x)", "", "", ""], angle: "rad", view: null },
      prog: { base: 10, bits: 64, view: "keys" },
      fin: { tool: "vat", vatMode: "add", vals: {} }
    };
  }
  function normUi(u) {
    var d = defaultUi();
    if (!u || typeof u !== "object") return d;
    if (MODES.indexOf(u.mode) >= 0) d.mode = u.mode;
    if (ANGLES.indexOf(u.angle) >= 0) d.angle = u.angle;
    d.second = u.second === true;
    var g = u.graph;
    if (g && typeof g === "object") {
      if (Array.isArray(g.fns)) {
        for (var i = 0; i < 4; i++) d.graph.fns[i] = typeof g.fns[i] === "string" ? g.fns[i].slice(0, 200) : "";
      }
      if (ANGLES.indexOf(g.angle) >= 0) d.graph.angle = g.angle;
      var v = g.view;
      if (v && isFinite(v.cx) && isFinite(v.cy) && v.ppu > 0 && isFinite(v.ppu)) d.graph.view = { cx: +v.cx, cy: +v.cy, ppu: +v.ppu };
    }
    var p = u.prog;
    if (p && typeof p === "object") {
      if ([2, 8, 10, 16].indexOf(p.base) >= 0) d.prog.base = p.base;
      if ([8, 16, 32, 64].indexOf(p.bits) >= 0) d.prog.bits = p.bits;
      if (p.view === "bits") d.prog.view = "bits";
    }
    var f = u.fin;
    if (f && typeof f === "object") {
      if (["vat", "pct", "loan", "save"].indexOf(f.tool) >= 0) d.fin.tool = f.tool;
      if (f.vatMode === "remove") d.fin.vatMode = "remove";
      if (f.vals && typeof f.vals === "object") {
        Object.keys(f.vals).forEach(function (k) {
          if (/^[a-z]{2,3}-[a-z]{2,6}$/.test(k) && typeof f.vals[k] === "string") d.fin.vals[k] = f.vals[k].slice(0, 40);
        });
      }
    }
    return d;
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
    state.ui = normUi(prefs && prefs.ui);
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
        // "91.44 cm" (a unit conversion) → the number only
        var num = String(state.history[i].res).split(" ")[0];
        if (!isFinite(parseFloat(num))) return;
        if (state.ui.mode === "sci") { sciUseValue(num); return; }
        saveUndoState();
        state.cur = num;
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
    var pack = trolls();
    var key;
    if (honest) {
      key = "troll.toast.true";
    } else {
      var pool = ["troll.toast.false.1", "troll.toast.false.2", "troll.toast.false.3",
                  "troll.toast.false.4", "troll.toast.false.5"];
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
      transientNote(t("calc.troll"), t("troll.welcome"));
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
    nodes = document.querySelectorAll("[data-i18n-title]");
    for (i = 0; i < nodes.length; i++) nodes[i].title = t(nodes[i].getAttribute("data-i18n-title"));
    nodes = document.querySelectorAll("[data-i18n-aria]");
    for (i = 0; i < nodes.length; i++) nodes[i].setAttribute("aria-label", t(nodes[i].getAttribute("data-i18n-aria")));
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
    saveCsv(rows.join("\r\n"), "oros-calculator-history.csv", t("calc.exported"));
  }

  // CSV text \u2192 file: the shell's save dialog, else a download.
  function saveCsv(text, filename, okMsg) {
    // UTF-8 BOM so Greek/expression text opens cleanly in Excel
    var blob = new Blob(["\uFEFF" + text],
      { type: "text/csv;charset=utf-8" });
    var done = function () {
      transientNote(okMsg, "");
    };
    var dlg = dialogHost();

    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({
        blob: blob,
        filename: filename,
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
      a.download = filename;
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
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^Digit[1-5]$/.test(e.code || "")) {
      setMode(MODES[parseInt(e.code.slice(5), 10) - 1], true);   // Alt+1…5, like Windows
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tg = e.target;
    // Typing in a field belongs to that field (expression lines,
    // graph functions, finance forms); the tab bars own their arrows.
    if (tg && tg.closest && tg.ownerDocument === document) {
      if (tg.closest("input, textarea, select, [contenteditable='true'], #graph-cv")) return;
      if (tg.closest("#calc-modes, #fin-tabs") &&
          /^(ArrowLeft|ArrowRight|Home|End|Enter| )$/.test(e.key)) return;
    }
    var mode = state.ui.mode;
    if (mode === "sci") { sciKey(e); return; }
    if (mode === "prog") { progKey(e); return; }
    if (mode !== "std") return;
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
    if (state.ui.mode !== "std") return;            // fields keep their own undo
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

  // ============================================================
  // 11. Modes: Standard · Scientific · Graphing · Programmer · Finance
  //     Pure logic lives in core.js (window.CalcCore); units come
  //     from the Unit Converter's own engine (window.UnitsCore).
  // ============================================================
  var CC = window.CalcCore;

  function tx(key, x) { return t(key).replace("{x}", x == null ? "" : String(x)); }
  function errText(code, detail) {
    var k = "calc.err." + code;
    var s = strs()[k] || STRINGS.en[k];
    return s ? tx(k, detail) : t("calc.err.syntax");
  }
  function coarse() {
    try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; }
  }
  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------- Mode switch ----------
  function setMode(m, user) {
    if (MODES.indexOf(m) < 0) m = "std";
    state.ui.mode = m;
    els.root.setAttribute("data-mode", m);
    var tabs = els.modes.querySelectorAll("[data-mode]");
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute("data-mode") === m;
      tabs[i].setAttribute("aria-selected", on ? "true" : "false");
      tabs[i].tabIndex = on ? 0 : -1;
    }
    els.sci.hidden = m !== "sci";
    els.graph.hidden = m !== "graph";
    els.prog.hidden = m !== "prog";
    els.fin.hidden = m !== "fin";
    if (els.sendBtn) els.sendBtn.hidden = !sendApi() || m === "graph" || m === "fin";
    savePrefs();
    if (m === "sci") { loadRates(); sciPreview(); if (user && !coarse()) els.sciIn.focus(); }
    if (m === "graph") { graphResize(); scheduleDraw(true); }
    if (m === "prog") { progUpdate(); if (user && !coarse()) els.progIn.focus(); }
    if (m === "fin") finShow(state.ui.fin.tool);
  }
  function wireModes() {
    els.modes.addEventListener("click", function (e) {
      var b = e.target.closest("[data-mode]");
      if (!b) return;
      setMode(b.getAttribute("data-mode"), true);
      // a pointer click leaves no focus behind, so Enter computes
      // instead of re-clicking the tab (keyboard users keep focus)
      if (e.detail > 0 && document.activeElement === b) b.blur();
    });
    els.modes.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
      var i = MODES.indexOf(state.ui.mode);
      if (e.key === "ArrowLeft") i = (i + MODES.length - 1) % MODES.length;
      else if (e.key === "ArrowRight") i = (i + 1) % MODES.length;
      else i = e.key === "Home" ? 0 : MODES.length - 1;
      setMode(MODES[i], false);
      els.modes.querySelector('[data-mode="' + MODES[i] + '"]').focus();
      e.preventDefault();
    });
  }

  // Inserts text at the caret of an <input> (or over its selection).
  // The caret of an unfocused line (keypad on a touch screen) is kept
  // by hand: browsers do not report it reliably once focus has left.
  // A value changed elsewhere (a result, AC) sends it to the end.
  function caretOf(input) {
    var v = input.value;
    if (document.activeElement === input && typeof input.selectionStart === "number") {
      return [input.selectionStart, input.selectionEnd];
    }
    if (input._caret && input._caretVal === v) return input._caret;
    return [v.length, v.length];
  }
  function keepCaret(input, c) {
    input._caret = [c, c];
    input._caretVal = input.value;
    try { input.setSelectionRange(c, c); } catch (e) {}
  }
  function trackCaret(input) {
    input.addEventListener("blur", function () {
      if (typeof input.selectionStart === "number") {
        input._caret = [input.selectionStart, input.selectionEnd];
        input._caretVal = input.value;
      }
    });
  }
  function insertAt(input, text) {
    var v = input.value, c = caretOf(input);
    input.value = v.slice(0, c[0]) + text + v.slice(c[1]);
    keepCaret(input, c[0] + text.length);
  }
  function backspaceAt(input) {
    var v = input.value, c = caretOf(input), s = c[0];
    if (s === c[1]) { if (s === 0) return; s -= 1; }
    input.value = v.slice(0, s) + v.slice(c[1]);
    keepCaret(input, s);
  }

  // ---------- Exchange rates (Unit Converter's stored copy) ----------
  var rates = null, ratesFetching = false;
  function loadRates() {
    var U = window.UnitsCore;
    if (!U) return null;
    try { rates = U.storedRates(JSON.parse(localStorage.getItem(U.RATES_KEY) || "null")); } catch (e) { rates = null; }
    return rates;
  }
  // Same sources and validation as Unit Converter (UnitsCore.RATES_URLS,
  // readRates); the result is stored in its key, so both apps share it.
  function fetchRates(done) {
    var U = window.UnitsCore;
    if (!U || ratesFetching || navigator.onLine === false || typeof fetch !== "function") { if (done) done(false); return; }
    ratesFetching = true;
    var urls = U.RATES_URLS.slice();
    function next() {
      var url = urls.shift();
      if (!url) { ratesFetching = false; if (done) done(false); return; }
      var ctl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
      fetch(url, { cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined })
        .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error("HTTP"); return r.json(); })
        .then(function (json) {
          var r = U.readRates(json, Date.now(), url);
          if (!r) throw new Error("bad");
          rates = r;
          try { localStorage.setItem(U.RATES_KEY, JSON.stringify(r)); } catch (e) {}
          ratesFetching = false;
          if (done) done(true);
        })
        .catch(function () { clearTimeout(timer); next(); });
    }
    next();
  }

  // ---------- Scientific ----------
  var sci = { fresh: false, hist: -1, draft: "" };
  // [label, action, 2nd label, 2nd action, class]
  //   ins:TEXT inserts · fn:NAME inserts "NAME(" · act:NAME runs
  var SCI_KEYS = [
    ["2nd", "act:2nd", null, null, "fn"], ["DEG", "act:angle", null, null, "fn"], ["Ans", "ins:Ans", null, null, "fn"],
    ["AC", "act:ac", null, null, "fn"], ["⌫", "act:back", null, null, "fn"],
    ["sin", "fn:sin", "sin⁻¹", "fn:asin", "fn"], ["cos", "fn:cos", "cos⁻¹", "fn:acos", "fn"], ["tan", "fn:tan", "tan⁻¹", "fn:atan", "fn"],
    ["ln", "fn:ln", "eˣ", "ins:e^(", "fn"], ["log", "fn:log", "10ˣ", "ins:10^(", "fn"],
    ["sinh", "fn:sinh", "sinh⁻¹", "fn:asinh", "fn"], ["cosh", "fn:cosh", "cosh⁻¹", "fn:acosh", "fn"], ["tanh", "fn:tanh", "tanh⁻¹", "fn:atanh", "fn"],
    ["log₂", "fn:log2", "2ˣ", "ins:2^(", "fn"], ["mod", "ins: mod ", null, null, "fn"],
    ["x²", "ins:²", "x³", "ins:³", "fn"], ["xʸ", "ins:^", null, null, "fn"], ["√", "ins:√(", null, null, "fn"],
    ["∛", "ins:∛(", null, null, "fn"], ["ʸ√x", "fn:root", null, null, "fn"],
    ["\u03c0", "ins:\u03c0", null, null, "fn"], ["e", "ins:e", null, null, "fn"], ["n!", "ins:!", null, null, "fn"],
    ["%", "ins:%", null, null, "fn"], ["EE", "ins:E", null, null, "fn"],
    ["(", "ins:(", null, null, "fn"], [")", "ins:)", null, null, "fn"], ["|x|", "fn:abs", null, null, "fn"],
    ["1/x", "act:inv", null, null, "fn"], ["÷", "ins:÷", null, null, "op"],
    ["⌊x⌋", "fn:floor", null, null, "fn"], ["7", "ins:7", null, null, "num"], ["8", "ins:8", null, null, "num"], ["9", "ins:9", null, null, "num"], ["×", "ins:×", null, null, "op"],
    ["⌈x⌉", "fn:ceil", null, null, "fn"], ["4", "ins:4", null, null, "num"], ["5", "ins:5", null, null, "num"], ["6", "ins:6", null, null, "num"], ["−", "ins:−", null, null, "op"],
    ["rand", "ins:rand", null, null, "fn"], ["1", "ins:1", null, null, "num"], ["2", "ins:2", null, null, "num"], ["3", "ins:3", null, null, "num"], ["+", "ins:+", null, null, "op"],
    ["±", "act:neg", null, null, "fn"], ["0", "ins:0", null, null, "num"], [".", "ins:.", null, null, "num"], ["=", "act:eq", null, null, "eq span2"]
  ];
  var SCI_ARIA = { "⌫": "calc.key.back" };

  function buildSciPad() {
    var frag = document.createDocumentFragment();
    SCI_KEYS.forEach(function (k, i) {
      var b = mk("button", "key " + k[4]);
      b.type = "button";
      b.setAttribute("data-i", i);
      if (SCI_ARIA[k[0]]) b.setAttribute("aria-label", t(SCI_ARIA[k[0]]));
      if (k[1] === "act:2nd") b.title = t("calc.2nd");
      if (k[1] === "act:angle") b.title = t("calc.angle");
      frag.appendChild(b);
    });
    els.sciPad.appendChild(frag);
    renderSciPad();
  }
  function renderSciPad() {
    var two = state.ui.second;
    var btns = els.sciPad.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var k = SCI_KEYS[+btns[i].getAttribute("data-i")];
      var lbl = (two && k[2]) ? k[2] : k[0];
      if (k[1] === "act:angle") lbl = state.ui.angle.toUpperCase();
      btns[i].textContent = lbl;
      if (k[1] === "act:2nd") {
        btns[i].classList.toggle("on", two);
        btns[i].setAttribute("aria-pressed", two ? "true" : "false");
      }
    }
  }

  function ansText() {
    var v = parseFloat(state.lastAnswer);
    return isFinite(v) ? state.lastAnswer : "0";
  }
  function sciEnv() {
    var a = parseFloat(state.lastAnswer);
    return { angle: state.ui.angle, ans: isFinite(a) ? a : 0 };
  }
  // A key that continues the shown result ("= 5" then "× 2").
  function continues(text) { return /^\s*(mod\b|[+\-−×÷*/^²³!%E])/.test(text); }

  // Evaluates the line: a unit conversion first, else an expression.
  function sciCompute(src) {
    var env = sciEnv();
    var U = window.UnitsCore;
    if (U) {
      var u = CC.unitConvert(src, U, { rates: rates, env: env });
      if (u) {
        if (!u.ok) return { ok: false, err: u.err };
        return { ok: true, v: u.v, sym: u.sym, cat: u.cat };
      }
    }
    var r = CC.calc(src, env);
    return r.ok ? { ok: true, v: r.v, sym: "" } : r;
  }
  function resultText(v, sym) {
    var s = fmtDisplay(CC.formatNum(v));
    return sym ? s + " " + sym : s;
  }

  function sciPreview() {
    var src = els.sciIn.value.trim();
    els.sciRes.classList.remove("error");
    if (sci.fresh) return;
    if (!src) { els.sciRes.textContent = "0"; els.sciRes.classList.add("preview"); return; }
    var r = sciCompute(src);
    els.sciRes.classList.add("preview");
    els.sciRes.textContent = r.ok ? resultText(r.v, r.sym) : "";
  }

  function sciShowError(code, detail) {
    els.sciRes.classList.remove("preview");
    els.sciRes.classList.add("error");
    els.sciRes.textContent = errText(code, detail);
  }

  function sciEval() {
    var src = els.sciIn.value.trim();
    if (!src) return;
    if (sci.fresh) { if (state.troll) trollToast(true); return; }
    var r = sciCompute(src);
    if (!r.ok) {
      if (r.err === "rates") {
        if (navigator.onLine === false) { sciShowError("rates_off"); return; }
        sciShowError("rates");
        fetchRates(function (ok) {
          if (!ok) { if (els.sciIn.value.trim() === src) sciShowError("rates_off"); return; }
          if (els.sciIn.value.trim() === src && !sci.fresh) sciEval();
        });
        return;
      }
      sciShowError(r.err, r.detail);
      return;
    }
    if (r.cat === "currency" && window.UnitsCore && window.UnitsCore.ratesStale(rates, Date.now())) {
      fetchRates(null);                          // refresh quietly for next time
    }
    var v = r.v, lied = false;
    if (state.troll && shouldLie()) {
      v = applyLie(v);
      lied = true;
      state.lastTrolled = true;
    } else if (state.troll) {
      state.lastTrolled = false;
    }
    var plain = CC.formatNum(v);
    var shown = r.sym ? plain + " " + r.sym : plain;
    state.history.unshift({ id: uid(), expr: src, res: shown, ts: Date.now(), lied: lied });
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
    persist(true);
    renderHistory();
    state.lastAnswer = plain;
    state.lastRes = plain;
    els.sciPrev.textContent = src + " =";
    els.sciRes.classList.remove("preview", "error");
    els.sciRes.textContent = resultText(v, r.sym);
    els.sciIn.value = plain;
    try { els.sciIn.setSelectionRange(plain.length, plain.length); } catch (e) {}
    sci.fresh = true;
    sci.hist = -1;
    if (state.troll) trollToast(!lied);
  }

  function sciStartTyping(text) {
    if (!sci.fresh) return;
    sci.fresh = false;
    if (!continues(text)) els.sciIn.value = "";
    var n = els.sciIn.value.length;
    try { els.sciIn.setSelectionRange(n, n); } catch (e) {}
  }
  function sciInsert(text) {
    sciStartTyping(text);
    insertAt(els.sciIn, text);
    sci.hist = -1;
    sciPreview();
  }
  // A history value: replaces a shown result, else goes in at the caret.
  function sciUseValue(num) {
    if (sci.fresh) { sci.fresh = false; els.sciIn.value = ""; }
    insertAt(els.sciIn, num);
    sciPreview();
  }

  function sciAction(a) {
    var inp = els.sciIn;
    if (a.indexOf("ins:") === 0) { sciInsert(a.slice(4)); return; }
    if (a.indexOf("fn:") === 0) { sciInsert(a.slice(3) + "("); return; }
    switch (a.slice(4)) {
      case "eq": sciEval(); return;
      case "ac":
        inp.value = ""; sci.fresh = false; els.sciPrev.textContent = ""; sciPreview(); return;
      case "back":
        if (sci.fresh) { sci.fresh = false; inp.value = ""; }
        else backspaceAt(inp);
        sciPreview(); return;
      case "2nd":
        state.ui.second = !state.ui.second; savePrefs(); renderSciPad(); return;
      case "angle":
        state.ui.angle = ANGLES[(ANGLES.indexOf(state.ui.angle) + 1) % 3];
        savePrefs(); renderSciPad(); sci.fresh = false; sciPreview(); return;
      case "inv": {
        var v = inp.value.trim();
        sci.fresh = false;
        inp.value = v ? "1/(" + v + ")" : "1/";
        sciPreview(); return;
      }
      case "neg": {
        var w = inp.value.trim();
        sci.fresh = false;
        if (/^-?[0-9.,]+(e[+\-]?[0-9]+)?$/i.test(w)) inp.value = w.charAt(0) === "-" ? w.slice(1) : "-" + w;
        else if (/^−\(.*\)$/.test(w)) inp.value = w.slice(2, -1);
        else inp.value = w ? "−(" + w + ")" : "−";
        sciPreview(); return;
      }
    }
  }

  function recallHistory(dir) {
    var list = state.history;
    if (!list.length) return;
    if (sci.hist === -1) sci.draft = els.sciIn.value;
    var n = sci.hist + dir;
    if (n < -1) n = -1;
    if (n >= list.length) n = list.length - 1;
    sci.hist = n;
    sci.fresh = false;
    els.sciIn.value = n === -1 ? sci.draft : list[n].expr;
    var len = els.sciIn.value.length;
    try { els.sciIn.setSelectionRange(len, len); } catch (e) {}
    sciPreview();
  }

  // Keys while the expression line has focus.
  function sciInputKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === "Enter" || k === "=") { e.preventDefault(); sciEval(); return; }
    if (k === "Escape") { if (els.sciIn.value) { e.preventDefault(); sciAction("act:ac"); } return; }
    if (k === "ArrowUp") { e.preventDefault(); recallHistory(1); return; }
    if (k === "ArrowDown") { e.preventDefault(); recallHistory(-1); return; }
    if (k && k.length === 1) sciStartTyping(k);
  }
  // Keys from elsewhere in the app (or routed from the shell).
  function sciKey(e) {
    var k = e.key;
    if (!k) return;
    if (k === "Enter" || k === "=") { sciEval(); e.preventDefault(); return; }
    if (k === "Backspace") { sciAction("act:back"); e.preventDefault(); return; }
    if (k === "Delete") { sciAction("act:ac"); e.preventDefault(); return; }
    if (k === "ArrowUp" || k === "ArrowDown") { recallHistory(k === "ArrowUp" ? 1 : -1); e.preventDefault(); return; }
    if (k.length === 1 && k !== " ") {
      sciInsert(k);
      if (!coarse()) els.sciIn.focus();
      e.preventDefault();
    }
  }

  function wireSci() {
    buildSciPad();
    els.sciPad.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var k = SCI_KEYS[+b.getAttribute("data-i")];
      var a = (state.ui.second && k[3]) ? k[3] : k[1];
      sciAction(a);
      if (a === "act:eq") flashKey(b);
      if (!coarse()) els.sciIn.focus(); else b.blur();
    });
    els.sciIn.addEventListener("keydown", sciInputKey);
    els.sciIn.addEventListener("input", function () { sci.fresh = false; sci.hist = -1; sciPreview(); });
    els.sciRes.addEventListener("click", function () {
      if (els.sciRes.classList.contains("error")) return;
      copyToClipboard(els.sciRes.textContent.replace(/ (?=\d)/g, ""));
    });
    wireKbdToggle(els.sciKbd, els.sciIn);
    trackCaret(els.sciIn);
  }
  function flashKey(b) {
    b.classList.add("flash");
    setTimeout(function () { b.classList.remove("flash"); }, 120);
  }
  // Touch screens: the line takes keypad input only (no soft
  // keyboard over the keys) until ⌨ asks for the keyboard.
  function wireKbdToggle(btn, input) {
    btn.addEventListener("click", function () {
      var on = input.getAttribute("inputmode") === "none";
      input.setAttribute("inputmode", on ? "text" : "none");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      input.blur();
      if (on) setTimeout(function () { input.focus(); }, 30);
    });
  }

  // ---------- Graphing ----------
  var G_COLORS = ["#e8590c", "#1c7ed6", "#2f9e44", "#ae3ec9"];
  var G_SUB = ["₁", "₂", "₃", "₄"];
  var G = { fns: [null, null, null, null], W: 0, H: 0, dpr: 1, poi: [], trace: null,
            ptrs: {}, drag: null, raf: 0, anaTimer: 0, viewTimer: 0, ro: null };

  function gView() {
    if (!state.ui.graph.view) state.ui.graph.view = { cx: 0, cy: 0, ppu: Math.max(10, (G.W || 400) / 20) };
    return state.ui.graph.view;
  }
  function buildGraphFns() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 4; i++) {
      var row = mk("div", "g-row");
      var sw = mk("span", "g-sw");
      sw.style.color = G_COLORS[i];
      var lab = mk("label", null, "y" + G_SUB[i] + " =");
      var inp = mk("input");
      inp.type = "text";
      inp.id = "g-fn-" + i;
      lab.htmlFor = inp.id;
      inp.setAttribute("autocomplete", "off");
      inp.setAttribute("autocapitalize", "off");
      inp.setAttribute("spellcheck", "false");
      inp.setAttribute("data-i", i);
      inp.placeholder = i === 0 ? t("calc.g.placeholder") : "";
      inp.value = state.ui.graph.fns[i];
      var er = mk("div", "g-err");
      er.hidden = true;
      er.id = "g-err-" + i;
      row.appendChild(sw); row.appendChild(lab); row.appendChild(inp);
      frag.appendChild(row);
      frag.appendChild(er);
    }
    els.graphFns.appendChild(frag);
    els.graphFns.addEventListener("input", function (e) {
      var i = e.target.getAttribute("data-i");
      if (i == null) return;
      state.ui.graph.fns[+i] = e.target.value.slice(0, 200);
      savePrefsSoon();
      compileGraph();
      G.trace = null;
      scheduleDraw(true);
    });
    compileGraph();
  }
  function compileGraph() {
    var env = { angle: state.ui.graph.angle };
    for (var i = 0; i < 4; i++) {
      var src = state.ui.graph.fns[i].trim().replace(/^y\s*=\s*/i, "");
      var inp = document.getElementById("g-fn-" + i), er = document.getElementById("g-err-" + i);
      G.fns[i] = null;
      var msg = "";
      if (src) {
        try { G.fns[i] = CC.compile(src, env); }
        catch (ex) { msg = errText(ex && ex.calc ? ex.calc : "syntax", ex && ex.detail); }
      }
      if (inp) inp.classList.toggle("bad", !!msg);
      if (er) { er.textContent = msg; er.hidden = !msg; }
    }
    els.gAngle.textContent = state.ui.graph.angle.toUpperCase();
  }
  function graphResize() {
    if (els.graph.hidden) return;
    var r = els.graphWrap.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    if (r.width < 10 || r.height < 10) return;
    G.W = r.width; G.H = r.height; G.dpr = dpr;
    els.graphCv.width = Math.round(r.width * dpr);
    els.graphCv.height = Math.round(r.height * dpr);
    gView();
  }
  function scheduleDraw(analyse) {
    if (els.graph.hidden) return;
    if (!G.raf) G.raf = requestAnimationFrame(function () { G.raf = 0; drawGraph(); });
    if (analyse) {
      clearTimeout(G.anaTimer);
      G.anaTimer = setTimeout(function () { analyseGraph(); drawGraph(); }, 180);
    }
  }
  function cssVar(name, fb) {
    var v = "";
    try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) {}
    return v || fb;
  }
  function toSx(x, v) { return (x - v.cx) * v.ppu + G.W / 2; }
  function toSy(y, v) { return G.H / 2 - (y - v.cy) * v.ppu; }
  function gNum(v) {
    if (!isFinite(v)) return "—";
    return fmtDisplay(CC.formatNum(Number(v.toPrecision(7))));
  }

  function drawGraph() {
    var cv = els.graphCv, ctx = cv.getContext("2d");
    if (!ctx || !G.W) return;
    var v = gView(), W = G.W, H = G.H;
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    ctx.fillStyle = cssVar("--panel-bg", "#1b1f27");
    ctx.fillRect(0, 0, W, H);
    var cGrid = cssVar("--border", "#2a2f3a"), cAxis = cssVar("--text-dim", "#9aa0a6");
    var x0 = v.cx - W / 2 / v.ppu, x1 = v.cx + W / 2 / v.ppu;
    var y0 = v.cy - H / 2 / v.ppu, y1 = v.cy + H / 2 / v.ppu;
    var step = CC.niceStep(x1 - x0, Math.max(4, W / 90));
    var k, s;
    ctx.lineWidth = 1;
    ctx.strokeStyle = cGrid;
    ctx.beginPath();
    for (k = Math.ceil(x0 / step); k <= Math.floor(x1 / step); k++) { s = Math.round(toSx(k * step, v)) + 0.5; ctx.moveTo(s, 0); ctx.lineTo(s, H); }
    for (k = Math.ceil(y0 / step); k <= Math.floor(y1 / step); k++) { s = Math.round(toSy(k * step, v)) + 0.5; ctx.moveTo(0, s); ctx.lineTo(W, s); }
    ctx.stroke();
    // axes
    var ax = toSy(0, v), ay = toSx(0, v);
    ctx.strokeStyle = cAxis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ax >= 0 && ax <= H) { ctx.moveTo(0, ax); ctx.lineTo(W, ax); }
    if (ay >= 0 && ay <= W) { ctx.moveTo(ay, 0); ctx.lineTo(ay, H); }
    ctx.stroke();
    // labels (kept on screen when an axis is off-screen)
    ctx.fillStyle = cAxis;
    ctx.font = "11px system-ui, sans-serif";
    var ly = Math.min(Math.max(ax + 13, 13), H - 18);
    ctx.textAlign = "center";
    for (k = Math.ceil(x0 / step); k <= Math.floor(x1 / step); k++) {
      var lsx = toSx(k * step, v);
      if (k === 0 || lsx < 14 || lsx > W - 14) continue;
      ctx.fillText(CC.formatNum(CC.clean(k * step)), lsx, ly);
    }
    var lx = Math.min(Math.max(ay - 4, 30), W - 4);
    ctx.textAlign = "right";
    for (k = Math.ceil(y0 / step); k <= Math.floor(y1 / step); k++) {
      var lsy = toSy(k * step, v);
      if (k === 0 || lsy < 10 || lsy > H - 6) continue;
      ctx.fillText(CC.formatNum(CC.clean(k * step)), lx, lsy + 4);
    }
    // curves
    for (var i = 0; i < 4; i++) {
      var f = G.fns[i];
      if (!f) continue;
      ctx.strokeStyle = G_COLORS[i];
      ctx.lineWidth = 2;
      ctx.beginPath();
      var psy = null;
      for (var px = 0; px <= W; px += 1) {
        var x = x0 + px / v.ppu, y = f(x);
        if (!isFinite(y)) { psy = null; continue; }
        var sy = toSy(y, v);
        var csy = Math.max(-4 * H, Math.min(5 * H, sy));
        if (psy === null) { ctx.moveTo(px, csy); psy = sy; continue; }
        var jump = false;
        if (Math.abs(sy - psy) > H / 2) {
          var ym = f(x - 0.5 / v.ppu);
          var msy = toSy(ym, v);
          jump = !isFinite(ym) || msy < Math.min(psy, sy) - 2 || msy > Math.max(psy, sy) + 2;
        }
        if (jump) ctx.moveTo(px, csy); else ctx.lineTo(px, csy);
        psy = sy;
      }
      ctx.stroke();
    }
    // points of interest
    G.poi.forEach(function (p) {
      var sx = toSx(p.x, v), sy = toSy(p.y, v);
      if (sx < -5 || sx > W + 5 || sy < -5 || sy > H + 5) return;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, 2 * Math.PI);
      ctx.fillStyle = cssVar("--panel-bg", "#1b1f27");
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = G_COLORS[p.i];
      ctx.stroke();
    });
    // trace
    if (G.trace) {
      var tsx = toSx(G.trace.x, v), tsy = toSy(G.trace.y, v);
      ctx.beginPath();
      ctx.arc(tsx, tsy, 5.5, 0, 2 * Math.PI);
      ctx.fillStyle = G_COLORS[G.trace.i];
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = cssVar("--text", "#fff");
      ctx.stroke();
      els.graphTrace.hidden = false;
      els.graphTrace.textContent = "y" + G_SUB[G.trace.i] + ": x = " + gNum(G.trace.x) + ", y = " + gNum(G.trace.y);
    } else {
      els.graphTrace.hidden = true;
    }
  }

  function analyseGraph() {
    G.poi = [];
    if (els.graph.hidden || !G.W) return;
    var v = gView();
    var x0 = v.cx - G.W / 2 / v.ppu, x1 = v.cx + G.W / 2 / v.ppu;
    var i, j;
    for (i = 0; i < 4; i++) {
      var f = G.fns[i];
      if (!f) continue;
      var a = CC.analyse(f, x0, x1, 300, 8);
      a.roots.forEach(function (x) { G.poi.push({ i: i, kind: "root", x: x, y: 0 }); });
      a.mins.forEach(function (p) { G.poi.push({ i: i, kind: "min", x: p.x, y: p.y }); });
      a.maxs.forEach(function (p) { G.poi.push({ i: i, kind: "max", x: p.x, y: p.y }); });
    }
    for (i = 0; i < 4; i++) {
      for (j = i + 1; j < 4; j++) {
        if (!G.fns[i] || !G.fns[j]) continue;
        CC.intersections(G.fns[i], G.fns[j], x0, x1, 300, 8).forEach(function (p) {
          G.poi.push({ i: i, j: j, kind: "cross", x: p.x, y: p.y });
        });
      }
    }
    renderPoi();
  }
  function renderPoi() {
    var ul = els.graphPoi;
    ul.textContent = "";
    var any = G.fns.some(function (f) { return !!f; });
    if (!any) return;
    if (!G.poi.length) { ul.appendChild(mk("li", "none", t("calc.g.none"))); return; }
    G.poi.slice(0, 40).forEach(function (p, n) {
      var li = mk("li");
      li.setAttribute("data-n", n);
      li.tabIndex = 0;
      var sw = mk("span", "g-sw"); sw.style.color = G_COLORS[p.i];
      li.appendChild(sw);
      var name = "y" + G_SUB[p.i];
      var txt;
      if (p.kind === "root") txt = name + " " + t("calc.g.root") + ": x = " + gNum(p.x);
      else if (p.kind === "cross") txt = name + " ∩ y" + G_SUB[p.j] + ": (" + gNum(p.x) + "; " + gNum(p.y) + ")";
      else txt = name + " " + t("calc.g." + p.kind) + ": (" + gNum(p.x) + "; " + gNum(p.y) + ")";
      li.appendChild(document.createTextNode(txt));
      ul.appendChild(li);
    });
  }

  function zoomAt(px, py, factor) {
    var v = gView();
    var mx = v.cx + (px - G.W / 2) / v.ppu, my = v.cy - (py - G.H / 2) / v.ppu;
    v.ppu = Math.min(1e9, Math.max(1e-6, v.ppu * factor));
    v.cx = mx - (px - G.W / 2) / v.ppu;
    v.cy = my + (py - G.H / 2) / v.ppu;
    viewChanged();
  }
  function panBy(dx, dy) {
    var v = gView();
    v.cx -= dx / v.ppu;
    v.cy += dy / v.ppu;
    viewChanged();
  }
  function viewChanged() {
    scheduleDraw(true);
    clearTimeout(G.viewTimer);
    G.viewTimer = setTimeout(savePrefs, 600);
  }
  function resetView() {
    state.ui.graph.view = null;
    gView();
    G.trace = null;
    viewChanged();
  }
  // Nearest curve to the pointer at that x.
  function traceAt(px, py) {
    var v = gView(), x = v.cx + (px - G.W / 2) / v.ppu, best = null;
    for (var i = 0; i < 4; i++) {
      if (!G.fns[i]) continue;
      var y = G.fns[i](x);
      if (!isFinite(y)) continue;
      var d = Math.abs(toSy(y, v) - py);
      if (!best || d < best.d) best = { i: i, x: x, y: y, d: d };
    }
    G.trace = best;
    scheduleDraw(false);
  }
  function localXY(e) {
    var r = els.graphCv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function wireGraph() {
    buildGraphFns();
    var cv = els.graphCv;
    var hint = document.getElementById("graph-hint");
    function hideHint() { if (hint) hint.hidden = true; }
    cv.addEventListener("wheel", hideHint, { passive: true });
    cv.addEventListener("pointerdown", function (e) {
      hideHint();
      var p = localXY(e);
      G.ptrs[e.pointerId] = p;
      try { cv.setPointerCapture(e.pointerId); } catch (er) {}
      var ids = Object.keys(G.ptrs);
      if (ids.length === 1) G.drag = { x: p.x, y: p.y, moved: false };
      else if (ids.length === 2) {
        var a = G.ptrs[ids[0]], b = G.ptrs[ids[1]];
        G.drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), moved: true };
      }
    });
    cv.addEventListener("pointermove", function (e) {
      var p = localXY(e);
      if (!G.ptrs[e.pointerId]) {
        if (e.pointerType === "mouse") traceAt(p.x, p.y);   // hover traces
        return;
      }
      var prev = G.ptrs[e.pointerId];
      G.ptrs[e.pointerId] = p;
      var ids = Object.keys(G.ptrs);
      if (ids.length === 1 && G.drag && !G.drag.pinch) {
        if (!G.drag.moved && Math.hypot(p.x - G.drag.x, p.y - G.drag.y) < 4) return;
        G.drag.moved = true;
        panBy(p.x - prev.x, p.y - prev.y);
      } else if (ids.length === 2 && G.drag && G.drag.pinch) {
        var a = G.ptrs[ids[0]], b = G.ptrs[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 0 && G.drag.pinch > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / G.drag.pinch);
        G.drag.pinch = d;
      }
    });
    function up(e) {
      var p = localXY(e);
      var had = G.ptrs[e.pointerId];
      delete G.ptrs[e.pointerId];
      if (had && G.drag && !G.drag.moved && !Object.keys(G.ptrs).length) traceAt(p.x, p.y);
      if (!Object.keys(G.ptrs).length) G.drag = null;
    }
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "mouse" && !G.ptrs[e.pointerId]) { G.trace = null; scheduleDraw(false); }
    });
    cv.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = localXY(e);
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(p.x, p.y, Math.exp(-dy * 0.0015));
    }, { passive: false });
    cv.addEventListener("keydown", function (e) {
      var k = e.key, done = true;
      if (k === "ArrowLeft") panBy(40, 0);
      else if (k === "ArrowRight") panBy(-40, 0);
      else if (k === "ArrowUp") panBy(0, 40);
      else if (k === "ArrowDown") panBy(0, -40);
      else if (k === "+" || k === "=") zoomAt(G.W / 2, G.H / 2, 1.5);
      else if (k === "-") zoomAt(G.W / 2, G.H / 2, 1 / 1.5);
      else if (k === "0" || k === "Home") resetView();
      else done = false;
      if (done) e.preventDefault();
    });
    document.getElementById("g-zin").addEventListener("click", function () { zoomAt(G.W / 2, G.H / 2, 1.5); });
    document.getElementById("g-zout").addEventListener("click", function () { zoomAt(G.W / 2, G.H / 2, 1 / 1.5); });
    document.getElementById("g-home").addEventListener("click", resetView);
    els.gAngle.title = t("calc.angle");
    els.gAngle.addEventListener("click", function () {
      state.ui.graph.angle = ANGLES[(ANGLES.indexOf(state.ui.graph.angle) + 1) % 3];
      savePrefs();
      compileGraph();
      G.trace = null;
      scheduleDraw(true);
    });
    function poiPick(e) {
      var li = e.target.closest("li[data-n]");
      if (!li) return;
      var p = G.poi[+li.getAttribute("data-n")];
      if (!p) return;
      G.trace = { i: p.i, x: p.x, y: p.y };
      var v = gView();
      var sx = toSx(p.x, v), sy = toSy(p.y, v);
      if (sx < 0 || sx > G.W || sy < 0 || sy > G.H) { v.cx = p.x; v.cy = p.y; viewChanged(); }
      scheduleDraw(false);
    }
    els.graphPoi.addEventListener("click", poiPick);
    els.graphPoi.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { poiPick(e); e.preventDefault(); } });
    if (typeof ResizeObserver === "function") {
      G.ro = new ResizeObserver(function () { graphResize(); scheduleDraw(true); });
      G.ro.observe(els.graphWrap);
    } else {
      window.addEventListener("resize", function () { graphResize(); scheduleDraw(true); });
    }
  }

  // ---------- Programmer ----------
  var P = { value: BigInt(0), fresh: false };
  var WORDS = { 64: "QWORD", 32: "DWORD", 16: "WORD", 8: "BYTE" };
  var PROG_KEYS = [
    ["AND", "ins: AND ", "fn"], ["OR", "ins: OR ", "fn"], ["XOR", "ins: XOR ", "fn"],
    ["NOT", "ins:NOT ", "fn"], ["NAND", "ins: NAND ", "fn"], ["NOR", "ins: NOR ", "fn"],
    ["«", "ins: << ", "fn"], ["»", "ins: >> ", "fn"], ["mod", "ins: mod ", "fn"],
    ["(", "ins:(", "fn"], [")", "ins:)", "fn"], ["⌫", "act:back", "fn"],
    ["A", "d:A", "num"], ["B", "d:B", "num"], ["7", "d:7", "num"], ["8", "d:8", "num"], ["9", "d:9", "num"], ["÷", "ins:÷", "op"],
    ["C", "d:C", "num"], ["D", "d:D", "num"], ["4", "d:4", "num"], ["5", "d:5", "num"], ["6", "d:6", "num"], ["×", "ins:×", "op"],
    ["E", "d:E", "num"], ["F", "d:F", "num"], ["1", "d:1", "num"], ["2", "d:2", "num"], ["3", "d:3", "num"], ["−", "ins:−", "op"],
    ["AC", "act:ac", "fn"], ["±", "act:neg", "fn"], ["0", "d:0", "num"], ["=", "act:eq", "eq span2"], ["+", "ins:+", "op"]
  ];
  function buildProgPad() {
    var frag = document.createDocumentFragment();
    PROG_KEYS.forEach(function (k, i) {
      var b = mk("button", "key " + k[2], k[0]);
      b.type = "button";
      b.setAttribute("data-i", i);
      if (k[0] === "⌫") b.setAttribute("aria-label", t("calc.key.back"));
      if (k[0] === "«") b.title = "Lsh";
      if (k[0] === "»") b.title = "Rsh";
      frag.appendChild(b);
    });
    els.progPad.appendChild(frag);
  }
  function progDigitOk(d, base) { return parseInt(d, 16) < base; }
  function renderProgPad() {
    var base = state.ui.prog.base;
    var btns = els.progPad.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var k = PROG_KEYS[+btns[i].getAttribute("data-i")];
      if (k[1].indexOf("d:") === 0) btns[i].disabled = !progDigitOk(k[1].slice(2), base);
    }
  }
  function buildProgBits() {
    var frag = document.createDocumentFragment();
    for (var g = 15; g >= 0; g--) {
      var grp = mk("div", "pbit-group");
      grp.setAttribute("data-g", g);
      var row = mk("div", "pbit-row");
      for (var b = 3; b >= 0; b--) {
        var bit = g * 4 + b;
        var btn = mk("button", "pbit", "0");
        btn.type = "button";
        btn.setAttribute("data-bit", bit);
        btn.setAttribute("aria-label", "bit " + bit);
        row.appendChild(btn);
      }
      grp.appendChild(row);
      grp.appendChild(mk("div", "pbit-idx", String(g * 4)));
      frag.appendChild(grp);
    }
    els.progBits.appendChild(frag);
  }
  function progUpdate() {
    var ui = state.ui.prog, src = els.progIn.value.trim();
    if (src) {
      var r = CC.progEval(src, ui.base, ui.bits);
      if (r.ok) P.value = r.v;
      els.progRes.classList.remove("error");
      els.progRes.classList.toggle("preview", !P.fresh);
      if (r.ok) els.progRes.textContent = CC.progGroup(CC.progFormat(P.value, ui.base, ui.bits), ui.base);
      else if (!P.fresh) els.progRes.textContent = "";
    } else {
      P.value = BigInt(0);
      els.progRes.classList.remove("error");
      els.progRes.classList.add("preview");
      els.progRes.textContent = "0";
    }
    renderProgBases();
  }
  function renderProgBases() {
    var ui = state.ui.prog;
    var rows = els.progBases.querySelectorAll(".prog-base");
    for (var i = 0; i < rows.length; i++) {
      var b = +rows[i].getAttribute("data-base");
      rows[i].setAttribute("aria-checked", b === ui.base ? "true" : "false");
      rows[i].querySelector(".pb-v").textContent = CC.progGroup(CC.progFormat(P.value, b, ui.bits), b);
    }
    els.progWord.textContent = WORDS[ui.bits];
    els.progWord.title = t("calc.p.word");
    var bitsOn = ui.view === "bits";
    els.progView.textContent = bitsOn ? t("calc.p.keys") : t("calc.p.bits");
    els.progView.setAttribute("aria-pressed", bitsOn ? "true" : "false");
    els.progBits.hidden = !bitsOn;
    els.progPad.hidden = bitsOn;
    if (bitsOn) {
      var groups = els.progBits.querySelectorAll(".pbit-group");
      for (var g = 0; g < groups.length; g++) groups[g].hidden = +groups[g].getAttribute("data-g") * 4 >= ui.bits;
      var cells = els.progBits.querySelectorAll(".pbit");
      for (var c = 0; c < cells.length; c++) {
        var one = CC.progBit(P.value, +cells[c].getAttribute("data-bit"));
        cells[c].textContent = one ? "1" : "0";
        cells[c].classList.toggle("one", one);
        cells[c].setAttribute("aria-pressed", one ? "true" : "false");
      }
    }
    renderProgPad();
  }
  function progSetValue(v) {
    var ui = state.ui.prog;
    P.value = BigInt.asIntN(ui.bits, v);
    els.progIn.value = CC.progFormat(P.value, ui.base, ui.bits);
    P.fresh = true;
    progUpdate();
  }
  function progEvalNow() {
    var ui = state.ui.prog, src = els.progIn.value.trim();
    if (!src) return;
    var r = CC.progEval(src, ui.base, ui.bits);
    if (!r.ok) {
      els.progRes.classList.remove("preview");
      els.progRes.classList.add("error");
      els.progRes.textContent = errText(r.err, r.detail);
      return;
    }
    progSetValue(r.v);
    els.progRes.classList.remove("preview");
  }
  function progContinues(text) { return /^\s*(and|or|xor|nand|nor|mod|<<|>>|[+\-−×÷*/%&|^])/i.test(text); }
  function progStartTyping(text) {
    if (!P.fresh) return;
    P.fresh = false;
    if (!progContinues(text)) els.progIn.value = "";
    var n = els.progIn.value.length;
    try { els.progIn.setSelectionRange(n, n); } catch (e) {}
  }
  function progAction(a) {
    var inp = els.progIn;
    if (a.indexOf("ins:") === 0 || a.indexOf("d:") === 0) {
      var text = a.slice(a.indexOf(":") + 1);
      progStartTyping(text);
      insertAt(inp, text);
      progUpdate();
      return;
    }
    switch (a.slice(4)) {
      case "eq": progEvalNow(); return;
      case "ac": inp.value = ""; P.fresh = false; progUpdate(); return;
      case "back":
        if (P.fresh) { P.fresh = false; inp.value = ""; } else backspaceAt(inp);
        progUpdate(); return;
      case "neg": {
        var w = inp.value.trim();
        P.fresh = false;
        if (!w) { insertAt(inp, "-"); progUpdate(); return; }
        var r = CC.progEval(w, state.ui.prog.base, state.ui.prog.bits);
        if (r.ok) progSetValue(-r.v);
        else { inp.value = "-(" + w + ")"; progUpdate(); }
        return;
      }
    }
  }
  function setProgBase(b) {
    var ui = state.ui.prog;
    if (b === ui.base) return;
    var src = els.progIn.value.trim();
    var r = src ? CC.progEval(src, ui.base, ui.bits) : null;
    ui.base = b;
    savePrefs();
    if (r && r.ok) progSetValue(r.v);
    else if (src) { els.progIn.value = ""; P.value = BigInt(0); progUpdate(); }
    else progUpdate();
  }
  function progInputKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === "Enter" || k === "=") { e.preventDefault(); progEvalNow(); return; }
    if (k === "Escape") { if (els.progIn.value) { e.preventDefault(); progAction("act:ac"); } return; }
    if (k && k.length === 1) progStartTyping(k);
  }
  function progKey(e) {
    var k = e.key;
    if (!k) return;
    if (k === "Enter" || k === "=") { progEvalNow(); e.preventDefault(); return; }
    if (k === "Backspace") { progAction("act:back"); e.preventDefault(); return; }
    if (k === "Delete") { progAction("act:ac"); e.preventDefault(); return; }
    if (k.length === 1 && k !== " ") {
      progAction("ins:" + k);
      if (!coarse()) els.progIn.focus();
      e.preventDefault();
    }
  }
  function wireProg() {
    buildProgPad();
    buildProgBits();
    els.progPad.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b || b.disabled) return;
      var a = PROG_KEYS[+b.getAttribute("data-i")][1];
      progAction(a);
      if (a === "act:eq") flashKey(b);
      if (!coarse()) els.progIn.focus(); else b.blur();
    });
    els.progBits.addEventListener("click", function (e) {
      var b = e.target.closest("[data-bit]");
      if (!b) return;
      var ui = state.ui.prog;
      progSetValue(CC.progToggleBit(P.value, +b.getAttribute("data-bit"), ui.bits));
    });
    els.progBases.addEventListener("click", function (e) {
      var b = e.target.closest("[data-base]");
      if (b) setProgBase(+b.getAttribute("data-base"));
    });
    els.progWord.addEventListener("click", function () {
      var ui = state.ui.prog;
      var order = [64, 32, 16, 8];
      ui.bits = order[(order.indexOf(ui.bits) + 1) % 4];
      savePrefs();
      if (els.progIn.value.trim()) progSetValue(P.value);
      else progUpdate();
    });
    els.progView.addEventListener("click", function () {
      var ui = state.ui.prog;
      ui.view = ui.view === "bits" ? "keys" : "bits";
      savePrefs();
      renderProgBases();
    });
    els.progIn.addEventListener("keydown", progInputKey);
    els.progIn.addEventListener("input", function () { P.fresh = false; progUpdate(); });
    els.progRes.addEventListener("click", function () {
      if (!els.progRes.classList.contains("error")) copyToClipboard(els.progRes.textContent.replace(/ /g, ""));
    });
    wireKbdToggle(els.progKbd, els.progIn);
    trackCaret(els.progIn);
  }

  // ---------- Finance ----------
  var FIN_IDS = ["vat-amt", "vat-rate", "pc-from", "pc-to", "po-p", "po-of", "pw-part", "pw-whole",
                 "ln-amt", "ln-rate", "ln-term", "ln-unit", "sv-start", "sv-month", "sv-rate", "sv-years", "sv-freq"];
  var finLast = { loan: null, save: null };

  function locale() { return window.orosI18n ? window.orosI18n.locale(lang()) : (lang() === "el" ? "el-GR" : "en-GB"); }
  function fmtMoney(v) {
    try { return new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v); }
    catch (e) { return v.toFixed(2); }
  }
  function fmtPlain(v, max) {
    try { return new Intl.NumberFormat(locale(), { maximumFractionDigits: max == null ? 4 : max }).format(v); }
    catch (e) { return String(v); }
  }
  function signed(s, v) { return v > 0 ? "+" + s : s; }
  function fv(id) { return CC.parseNum(document.getElementById(id).value); }
  function filled(ids) {
    for (var i = 0; i < ids.length; i++) if (!document.getElementById(ids[i]).value.trim()) return false;
    return true;
  }
  function outRows(dl, rows, note) {
    dl.textContent = "";
    rows.forEach(function (r) {
      dl.appendChild(mk("dt", null, r[0]));
      dl.appendChild(mk("dd", r[2] ? "big" : null, r[1]));
    });
    if (note) dl.appendChild(mk("div", "note", note));
  }
  function invalid(dl) { outRows(dl, [], t("calc.f.invalid")); }

  function finVat() {
    var dl = document.getElementById("vat-out");
    var rate = fv("vat-rate");
    var chips = document.querySelectorAll("#vat-chips [data-rate]");
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle("on", +chips[i].getAttribute("data-rate") === rate);
    var modeBtns = document.querySelectorAll("#vat-mode [data-vmode]");
    for (i = 0; i < modeBtns.length; i++) {
      modeBtns[i].setAttribute("aria-checked", modeBtns[i].getAttribute("data-vmode") === state.ui.fin.vatMode ? "true" : "false");
    }
    if (!filled(["vat-amt", "vat-rate"])) { dl.textContent = ""; return; }
    var r = CC.vat(fv("vat-amt"), rate, state.ui.fin.vatMode);
    if (!r) { invalid(dl); return; }
    var add = state.ui.fin.vatMode !== "remove";
    outRows(dl, [
      [t("calc.f.net"), fmtMoney(r.net), !add],
      [t("calc.f.vatamt") + " " + fmtPlain(rate, 2) + "%", fmtMoney(r.vat)],
      [t("calc.f.gross"), fmtMoney(r.gross), add]
    ]);
  }
  function finPct() {
    var dl = document.getElementById("pc-out");
    if (filled(["pc-from", "pc-to"])) {
      var c = CC.pctChange(fv("pc-from"), fv("pc-to"));
      if (!c) invalid(dl);
      else outRows(dl, [
        [t("calc.f.change"), c.pct == null ? "—" : signed(fmtPlain(c.pct, 2) + "%", c.pct), true],
        [t("calc.f.diff"), signed(fmtPlain(c.diff, 4), c.diff)]
      ]);
    } else dl.textContent = "";
    dl = document.getElementById("po-out");
    if (filled(["po-p", "po-of"])) {
      var o = CC.pctOf(fv("po-p"), fv("po-of"));
      if (o == null) invalid(dl); else outRows(dl, [[t("calc.f.result"), fmtPlain(o, 6), true]]);
    } else dl.textContent = "";
    dl = document.getElementById("pw-out");
    if (filled(["pw-part", "pw-whole"])) {
      var w = CC.whatPct(fv("pw-part"), fv("pw-whole"));
      if (w == null) invalid(dl); else outRows(dl, [[t("calc.f.result"), fmtPlain(w, 4) + "%", true]]);
    } else dl.textContent = "";
  }
  function fillTable(tbl, head, rows) {
    tbl.textContent = "";
    if (!rows.length) return;
    var thead = mk("thead"), tr = mk("tr");
    head.forEach(function (h) { tr.appendChild(mk("th", null, h)); });
    thead.appendChild(tr);
    tbl.appendChild(thead);
    var tb = mk("tbody");
    rows.forEach(function (r) {
      var row = mk("tr");
      r.forEach(function (c) { row.appendChild(mk("td", null, c)); });
      tb.appendChild(row);
    });
    tbl.appendChild(tb);
  }
  function finLoan() {
    var dl = document.getElementById("ln-out"), tbl = document.getElementById("ln-table");
    finLast.loan = null;
    if (!filled(["ln-amt", "ln-rate", "ln-term"])) { dl.textContent = ""; tbl.textContent = ""; return; }
    var term = fv("ln-term");
    var months = document.getElementById("ln-unit").value === "m" ? term : term * 12;
    var L = CC.loan(fv("ln-amt"), fv("ln-rate"), Math.round(months * 1e6) / 1e6);
    if (!L) { invalid(dl); tbl.textContent = ""; return; }
    finLast.loan = L;
    outRows(dl, [
      [t("calc.f.instal"), fmtMoney(L.payment), true],
      [t("calc.f.totalpaid"), fmtMoney(L.total)],
      [t("calc.f.totint"), fmtMoney(L.interest)]
    ], t("calc.f.note.round"));
    fillTable(tbl, [t("calc.f.col.month"), t("calc.f.col.pay"), t("calc.f.col.int"), t("calc.f.col.prin"), t("calc.f.col.bal")],
      L.rows.map(function (r) { return [String(r.n), fmtMoney(r.payment), fmtMoney(r.interest), fmtMoney(r.principal), fmtMoney(r.balance)]; }));
  }
  function finSave() {
    var dl = document.getElementById("sv-out"), tbl = document.getElementById("sv-table");
    finLast.save = null;
    if (!filled(["sv-rate", "sv-years"]) || (!document.getElementById("sv-start").value.trim() && !document.getElementById("sv-month").value.trim())) {
      dl.textContent = ""; tbl.textContent = ""; return;
    }
    var st = document.getElementById("sv-start").value.trim() ? fv("sv-start") : 0;
    var mo = document.getElementById("sv-month").value.trim() ? fv("sv-month") : 0;
    var freq = document.getElementById("sv-freq").value;
    var S = CC.savings(st, mo, fv("sv-rate"), fv("sv-years"), freq);
    if (!S) { invalid(dl); tbl.textContent = ""; return; }
    finLast.save = S;
    outRows(dl, [
      [t("calc.f.final"), fmtMoney(S.final), true],
      [t("calc.f.deposits"), fmtMoney(S.deposits)],
      [t("calc.f.earned"), fmtMoney(S.interest)]
    ], freq === "y" ? t("calc.f.note.yearly") : "");
    fillTable(tbl, [t("calc.f.col.year"), t("calc.f.col.dep"), t("calc.f.col.int"), t("calc.f.col.bal")],
      S.rows.map(function (r) { return [String(r.n), fmtMoney(r.deposits), fmtMoney(r.interest), fmtMoney(r.balance)]; }));
  }
  function finCompute(tool) {
    if (tool === "vat") finVat();
    else if (tool === "pct") finPct();
    else if (tool === "loan") finLoan();
    else if (tool === "save") finSave();
  }
  function finShow(tool) {
    state.ui.fin.tool = tool;
    var tabs = els.fin.querySelectorAll(".fin-tabs [data-tool]");
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute("data-tool") === tool;
      tabs[i].setAttribute("aria-selected", on ? "true" : "false");
      tabs[i].tabIndex = on ? 0 : -1;
    }
    var cards = els.fin.querySelectorAll(".fin-card");
    for (i = 0; i < cards.length; i++) cards[i].classList.toggle("on", cards[i].getAttribute("data-tool") === tool);
    finCompute(tool);
  }
  function exportFin(kind) {
    var c = CC.cents;
    if (kind === "loan") {
      var L = finLast.loan;
      if (!L) { transientNote(t("calc.title"), t("calc.f.nothing")); return; }
      saveCsv(CC.toCsv([t("calc.f.col.month"), t("calc.f.col.pay"), t("calc.f.col.int"), t("calc.f.col.prin"), t("calc.f.col.bal")],
        L.rows.map(function (r) { return [r.n, c(r.payment).toFixed(2), c(r.interest).toFixed(2), c(r.principal).toFixed(2), c(r.balance).toFixed(2)]; })),
        "oros-loan.csv", t("calc.f.exported"));
    } else {
      var S = finLast.save;
      if (!S) { transientNote(t("calc.title"), t("calc.f.nothing")); return; }
      saveCsv(CC.toCsv([t("calc.f.col.year"), t("calc.f.col.dep"), t("calc.f.col.int"), t("calc.f.col.bal")],
        S.rows.map(function (r) { return [r.n, c(r.deposits).toFixed(2), c(r.interest).toFixed(2), c(r.balance).toFixed(2)]; })),
        "oros-savings.csv", t("calc.f.exported"));
    }
  }
  function wireFin() {
    var vals = state.ui.fin.vals;
    FIN_IDS.forEach(function (id) {
      var n = document.getElementById(id);
      if (!n) return;
      if (typeof vals[id] === "string") n.value = vals[id];
      var ev = n.tagName === "SELECT" ? "change" : "input";
      n.addEventListener(ev, function () {
        state.ui.fin.vals[id] = n.value.slice(0, 40);
        savePrefsSoon();
        finCompute(state.ui.fin.tool);
      });
    });
    document.getElementById("fin-tabs").addEventListener("click", function (e) {
      var b = e.target.closest("[data-tool]");
      if (b) { finShow(b.getAttribute("data-tool")); savePrefs(); }
    });
    document.getElementById("fin-tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      var tools = ["vat", "pct", "loan", "save"];
      var i = tools.indexOf(state.ui.fin.tool) + (e.key === "ArrowRight" ? 1 : -1);
      i = (i + 4) % 4;
      finShow(tools[i]);
      savePrefs();
      els.fin.querySelector('.fin-tabs [data-tool="' + tools[i] + '"]').focus();
      e.preventDefault();
    });
    document.getElementById("vat-chips").addEventListener("click", function (e) {
      var b = e.target.closest("[data-rate]");
      if (!b) return;
      var inp = document.getElementById("vat-rate");
      inp.value = b.getAttribute("data-rate");
      state.ui.fin.vals["vat-rate"] = inp.value;
      savePrefsSoon();
      finVat();
    });
    document.getElementById("vat-mode").addEventListener("click", function (e) {
      var b = e.target.closest("[data-vmode]");
      if (!b) return;
      state.ui.fin.vatMode = b.getAttribute("data-vmode") === "remove" ? "remove" : "add";
      savePrefs();
      finVat();
    });
    document.getElementById("ln-csv").addEventListener("click", function () { exportFin("loan"); });
    document.getElementById("sv-csv").addEventListener("click", function () { exportFin("save"); });
  }

  // "Send to…" (shell send/, BR-SEND): the shown result, or
  // "expression = result" when one was just worked out, as text to
  // another app of this orOS. Hidden without the shell bridge.
  function sendApi() {
    try { return window.parent !== window && window.parent.orosSend ? window.parent.orosSend : null; }
    catch (e) { return null; }
  }
  function sendText() {
    var m = state.ui.mode, res, src;
    if (m === "sci") {
      if (els.sciRes.classList.contains("error")) return "";
      res = els.sciRes.textContent.trim();
      src = els.sciPrev.textContent.trim();
      if (/ =$/.test(src)) return src + " " + res;
      src = els.sciIn.value.trim();
      return src && res && src !== res ? src + " = " + res : res;
    }
    if (m === "prog") {
      if (els.progRes.classList.contains("error")) return "";
      res = els.progRes.textContent.trim();
      src = els.progIn.value.trim();
      return src && res && src !== res ? src + " = " + res : res;
    }
    res = els.res.textContent.trim();
    var h = state.history[0];
    if (state.op === null && state.fresh && h && h.res === state.cur) return h.expr + " = " + res;
    return res === "Error" ? "" : res;
  }
  function sendResult() {
    var api = sendApi(), text = sendText();
    if (!api || !text) return;
    api.open({ kind: "text", data: { title: t("calc.title"), text: text } });
  }

  function wireModesAll() {
    els.modes = document.getElementById("calc-modes");
    els.sci = document.getElementById("sci");
    els.sciIn = document.getElementById("sci-in");
    els.sciRes = document.getElementById("sci-res");
    els.sciPrev = document.getElementById("sci-prev");
    els.sciPad = document.getElementById("sci-pad");
    els.sciKbd = document.getElementById("sci-kbd");
    els.graph = document.getElementById("graph");
    els.graphFns = document.getElementById("graph-fns");
    els.graphWrap = document.getElementById("graph-wrap");
    els.graphCv = document.getElementById("graph-cv");
    els.graphTrace = document.getElementById("graph-trace");
    els.graphPoi = document.getElementById("graph-poi");
    els.gAngle = document.getElementById("g-angle");
    els.prog = document.getElementById("prog");
    els.progIn = document.getElementById("prog-in");
    els.progRes = document.getElementById("prog-res");
    els.progBases = document.getElementById("prog-bases");
    els.progPad = document.getElementById("prog-pad");
    els.progBits = document.getElementById("prog-bits");
    els.progWord = document.getElementById("prog-word");
    els.progView = document.getElementById("prog-view");
    els.progKbd = document.getElementById("prog-kbd");
    els.fin = document.getElementById("fin");
    els.sendBtn = document.getElementById("calc-send");
    els.sendBtn.addEventListener("click", sendResult);
    wireModes();
    wireSci();
    wireGraph();
    wireProg();
    wireFin();
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
    if (!state.ui) state.ui = normUi(null);
    wireUI();
    wireModesAll();
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
    setMode(state.ui.mode, false);
    // Single app (solo.js) icon shortcuts: { mode } → that mode.
    window.__orosOpenAt = function (t) {
      if (t && typeof t.mode === "string" && MODES.indexOf(t.mode) !== -1) setMode(t.mode, true);
    };
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function")
        window.__orosOpenAt(window.parent.__orosTakeTarget("calculator"));
    } catch (e) {}

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