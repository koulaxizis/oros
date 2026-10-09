// ============================================================
// orOS Password Generator — App logic (v1.0.0)
// Random passwords, PINs and Diceware passphrases, with their
// exact entropy, plus a strength auditor for any password.
//   - randomness: crypto.getRandomValues only (pwcore.js)
//   - everything runs on this device; nothing is sent, synced or
//     saved except the options below
//   - real-dice mode: type your own rolls, get the EFF words
// Data:
//   - no synced slice (nothing worth syncing, nothing secret kept)
//   - device-local (R10): oros-passwords-prefs (tab + options).
//     Generated and audited passwords are never stored.
// Sections:
//   1. Constants, i18n, helpers
//   2. Prefs
//   3. Generator: password / PIN / passphrase / real dice
//   4. Output + meter
//   5. Copy + clipboard clearing
//   6. Auditor
//   7. Tabs + options UI
//   8. Toasts
//   9. Keyboard (Contract Β)
//  10. Palette
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var PREFS_KEY   = "oros-passwords-prefs";
  var CLEAR_MS    = 30000;
  var AUDIT_DELAY = 120;
  var P = window.PwCore;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app": "Password Generator", "tab.pw": "Password", "tab.ph": "Passphrase", "tab.au": "Check",
      "mode.chars": "Characters", "mode.pin": "PIN",
      "len": "Length", "pinlen": "Digits", "words": "Words",
      "o.lower": "Lowercase (a–z)", "o.upper": "Uppercase (A–Z)", "o.digits": "Digits (0–9)",
      "o.symbols": "Symbols", "o.ambig": "Avoid look-alikes (0 O o 1 l I)",
      "o.custom": "Only these symbols",
      "o.customHint": "Leave empty for all symbols. Some sites accept only a few.",
      "o.clear": "Clear the clipboard 30 seconds after copying",
      "src.device": "This device", "src.dice": "Real dice",
      "p.list": "Word list", "p.large": "EFF large (7,776)", "p.short": "EFF short (1,296)",
      "p.sep": "Separator", "sep.space": "Space", "sep.dash": "Dash (-)", "sep.dot": "Dot (.)",
      "sep.under": "Underscore (_)",
      "p.caps": "Capitalize each word", "p.extra": "Add one digit or symbol",
      "dice.hint": "Roll {n} dice (or one die {n} times) and type the numbers in order, e.g. {ex}.",
      "dice.add": "Add word", "dice.undo": "Remove last", "dice.clear": "Start over",
      "dice.bad": "Type exactly {n} numbers from 1 to 6.",
      "dice.full": "Up to {n} words.",
      "dice.empty": "Your words will appear here.",
      "btn.regen": "New", "btn.regen.aria": "Generate a new one (Enter)",
      "btn.copy": "Copy", "btn.show": "Show", "btn.hide": "Hide",
      "m.exact": "{bits} bits, exact", "m.est": "≈ {bits} bits",
      "m.time": "A fast offline attack needs about {t} on average.",
      "s.0": "Very weak", "s.1": "Weak", "s.2": "Fair", "s.3": "Strong", "s.4": "Very strong",
      "a.label": "Password to check",
      "a.private": "Checked on this device only. It is not saved, synced or sent anywhere.",
      "a.times": "Time to crack (on average)",
      "a.online": "Online, rate-limited (100 / hour)",
      "a.slow": "Offline, slow hash (10 thousand / s)",
      "a.fast": "Offline, fast hash (10 billion / s)",
      "a.findings": "What makes it weaker", "a.none": "No known patterns found.",
      "a.method": "The estimate looks for common passwords, dictionary words, sequences, repeats, keyboard walks and dates. It cannot know personal facts (names, birthdays) unless they appear in those lists.",
      "f.common": "It is one of the most common passwords, or built from one.",
      "f.word": "It contains dictionary words. Words are guessed whole, not letter by letter.",
      "f.sequence": "It has a sequence such as abc or 1234.",
      "f.repeat": "It repeats characters or blocks (aaa, abcabc).",
      "f.keyboard": "It follows a row of the keyboard (qwerty, asdf).",
      "f.date": "It contains a date or year. Those are among the first things tried.",
      "f.short": "It is short. Every extra character helps.",
      "f.oneclass": "It uses only one kind of character.",
      "f.capfirst": "Only the first letter is uppercase, which everyone does.",
      "f.digitsend": "The digits are at the end, which everyone does.",
      "tip": "Tip: a passphrase of 6 random words is easy to remember and very strong.",
      "time.instant": "less than a second", "time.seconds": "{n} seconds", "time.minutes": "{n} minutes",
      "time.hours": "{n} hours", "time.days": "{n} days", "time.months": "{n} months",
      "time.years": "{n} years", "time.centuries": "centuries",
      "time.seconds1": "1 second", "time.minutes1": "1 minute", "time.hours1": "1 hour",
      "time.days1": "1 day", "time.months1": "1 month", "time.years1": "1 year", "time.centuries1": "a century",
      "toast.copied": "Copied", "toast.copyFail": "Could not copy",
      "toast.cleared": "Clipboard cleared",
      "err.crypto": "This browser has no secure random number generator, so no passwords can be made here.",
      "err.sets": "Choose at least one kind of character.",
      "about.local": "Everything happens on this device.",
      "about.eff": "Diceware word lists by the EFF,",
      "about.seclists": "Common passwords list from"
    },
    el: {
      "app": "Γεννήτρια κωδικών", "tab.pw": "Κωδικός", "tab.ph": "Φράση", "tab.au": "Έλεγχος",
      "mode.chars": "Χαρακτήρες", "mode.pin": "PIN",
      "len": "Μήκος", "pinlen": "Ψηφία", "words": "Λέξεις",
      "o.lower": "Πεζά (a–z)", "o.upper": "Κεφαλαία (A–Z)", "o.digits": "Ψηφία (0–9)",
      "o.symbols": "Σύμβολα", "o.ambig": "Χωρίς όμοιους χαρακτήρες (0 O o 1 l I)",
      "o.custom": "Μόνο αυτά τα σύμβολα",
      "o.customHint": "Άφησέ το κενό για όλα τα σύμβολα. Κάποιοι ιστότοποι δέχονται μόνο λίγα.",
      "o.clear": "Καθαρισμός προχείρου 30 δευτερόλεπτα μετά την αντιγραφή",
      "src.device": "Αυτή η συσκευή", "src.dice": "Πραγματικά ζάρια",
      "p.list": "Λίστα λέξεων", "p.large": "EFF μεγάλη (7.776)", "p.short": "EFF μικρή (1.296)",
      "p.sep": "Διαχωριστικό", "sep.space": "Κενό", "sep.dash": "Παύλα (-)", "sep.dot": "Τελεία (.)",
      "sep.under": "Κάτω παύλα (_)",
      "p.caps": "Κεφαλαίο σε κάθε λέξη", "p.extra": "Ένα ψηφίο ή σύμβολο επιπλέον",
      "dice.hint": "Ρίξε {n} ζάρια (ή ένα ζάρι {n} φορές) και γράψε τους αριθμούς με τη σειρά, π.χ. {ex}.",
      "dice.add": "Προσθήκη λέξης", "dice.undo": "Αφαίρεση τελευταίας", "dice.clear": "Από την αρχή",
      "dice.bad": "Γράψε ακριβώς {n} αριθμούς από το 1 ως το 6.",
      "dice.full": "Έως {n} λέξεις.",
      "dice.empty": "Οι λέξεις σου θα εμφανιστούν εδώ.",
      "btn.regen": "Νέος", "btn.regen.aria": "Δημιούργησε νέο (Enter)",
      "btn.copy": "Αντιγραφή", "btn.show": "Εμφάνιση", "btn.hide": "Απόκρυψη",
      "m.exact": "{bits} bits, ακριβώς", "m.est": "≈ {bits} bits",
      "m.time": "Μια γρήγορη offline επίθεση χρειάζεται κατά μέσο όρο {t}.",
      "s.0": "Πολύ αδύναμος", "s.1": "Αδύναμος", "s.2": "Μέτριος", "s.3": "Ισχυρός", "s.4": "Πολύ ισχυρός",
      "a.label": "Κωδικός για έλεγχο",
      "a.private": "Ελέγχεται μόνο σε αυτή τη συσκευή. Δεν αποθηκεύεται, δεν συγχρονίζεται, δεν στέλνεται πουθενά.",
      "a.times": "Χρόνος για να σπάσει (κατά μέσο όρο)",
      "a.online": "Online, με όριο (100 / ώρα)",
      "a.slow": "Offline, αργό hash (10 χιλιάδες / s)",
      "a.fast": "Offline, γρήγορο hash (10 δισεκατομμύρια / s)",
      "a.findings": "Τι τον αδυνατίζει", "a.none": "Δεν βρέθηκαν γνωστά μοτίβα.",
      "a.method": "Η εκτίμηση ψάχνει κοινούς κωδικούς, λέξεις λεξικού, ακολουθίες, επαναλήψεις, διαδρομές πληκτρολογίου και ημερομηνίες. Δεν ξέρει προσωπικά στοιχεία (ονόματα, γενέθλια) αν δεν υπάρχουν σε αυτές τις λίστες.",
      "f.common": "Είναι από τους πιο συνηθισμένους κωδικούς, ή φτιαγμένος από έναν τέτοιο.",
      "f.word": "Περιέχει λέξεις λεξικού. Οι λέξεις μαντεύονται ολόκληρες, όχι γράμμα γράμμα.",
      "f.sequence": "Έχει ακολουθία όπως abc ή 1234.",
      "f.repeat": "Επαναλαμβάνει χαρακτήρες ή κομμάτια (aaa, abcabc).",
      "f.keyboard": "Ακολουθεί μια σειρά του πληκτρολογίου (qwerty, asdf).",
      "f.date": "Περιέχει ημερομηνία ή χρονιά. Αυτά δοκιμάζονται από τα πρώτα.",
      "f.short": "Είναι μικρός. Κάθε χαρακτήρας παραπάνω βοηθά.",
      "f.oneclass": "Χρησιμοποιεί μόνο ένα είδος χαρακτήρων.",
      "f.capfirst": "Μόνο το πρώτο γράμμα είναι κεφαλαίο, όπως κάνουν όλοι.",
      "f.digitsend": "Τα ψηφία είναι στο τέλος, όπως κάνουν όλοι.",
      "tip": "Συμβουλή: μια φράση 6 τυχαίων λέξεων θυμάται εύκολα και είναι πολύ ισχυρή.",
      "time.instant": "λιγότερο από ένα δευτερόλεπτο", "time.seconds": "{n} δευτερόλεπτα", "time.minutes": "{n} λεπτά",
      "time.hours": "{n} ώρες", "time.days": "{n} ημέρες", "time.months": "{n} μήνες",
      "time.years": "{n} χρόνια", "time.centuries": "αιώνες",
      "time.seconds1": "1 δευτερόλεπτο", "time.minutes1": "1 λεπτό", "time.hours1": "1 ώρα",
      "time.days1": "1 ημέρα", "time.months1": "1 μήνα", "time.years1": "1 χρόνο", "time.centuries1": "έναν αιώνα",
      "toast.copied": "Αντιγράφηκε", "toast.copyFail": "Δεν έγινε αντιγραφή",
      "toast.cleared": "Το πρόχειρο καθαρίστηκε",
      "err.crypto": "Αυτός ο browser δεν έχει ασφαλή γεννήτρια τυχαίων αριθμών, οπότε δεν μπορούν να φτιαχτούν κωδικοί εδώ.",
      "err.sets": "Διάλεξε τουλάχιστον ένα είδος χαρακτήρων.",
      "about.local": "Όλα γίνονται σε αυτή τη συσκευή.",
      "about.eff": "Λίστες λέξεων Diceware από την EFF,",
      "about.seclists": "Λίστα κοινών κωδικών από το"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmtBits(b) {
    return (Math.round(b * 10) / 10).toLocaleString(LANG === "el" ? "el-GR" : "en-GB");
  }
  function fmtInt(n) { return n.toLocaleString(LANG === "el" ? "el-GR" : "en-GB"); }
  function timeText(h) {
    return t("time." + h.unit + (h.n === 1 ? "1" : ""), { n: fmtInt(h.n) });
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("passwords.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Prefs ----------
  var DEF_PREFS = {
    tab: "pw",
    pw: { mode: "chars", length: P.LEN_DEF, pin: P.PIN_DEF, lower: 1, upper: 1, digits: 1,
          symbols: 1, noAmbig: 0, custom: "" },
    ph: { src: "device", list: "large", words: P.WORDS_DEF, sep: "space", caps: 0, extra: 0 },
    clear: 1
  };
  var prefs = null;

  function bool(v, d) { return v === undefined ? d : (v ? 1 : 0); }
  function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
  function intIn(v, lo, hi, d) {
    return (typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi) ? v : d;
  }

  // Idempotent: anything unknown or out of range falls back to the default.
  function normPrefs(raw) {
    var r = raw && typeof raw === "object" ? raw : {};
    var pw = r.pw && typeof r.pw === "object" ? r.pw : {};
    var ph = r.ph && typeof r.ph === "object" ? r.ph : {};
    var D = DEF_PREFS;
    return {
      tab: oneOf(r.tab, ["pw", "ph", "au"], D.tab),
      pw: {
        mode: oneOf(pw.mode, ["chars", "pin"], D.pw.mode),
        length: intIn(pw.length, P.LEN_MIN, P.LEN_MAX, D.pw.length),
        pin: intIn(pw.pin, P.PIN_MIN, P.PIN_MAX, D.pw.pin),
        lower: bool(pw.lower, D.pw.lower), upper: bool(pw.upper, D.pw.upper),
        digits: bool(pw.digits, D.pw.digits), symbols: bool(pw.symbols, D.pw.symbols),
        noAmbig: bool(pw.noAmbig, D.pw.noAmbig),
        custom: P.normSymbols(pw.custom)
      },
      ph: {
        src: oneOf(ph.src, ["device", "dice"], D.ph.src),
        list: oneOf(ph.list, ["large", "short"], D.ph.list),
        words: intIn(ph.words, P.WORDS_MIN, P.WORDS_MAX, D.ph.words),
        sep: oneOf(ph.sep, ["space", "dash", "dot", "under"], D.ph.sep),
        caps: bool(ph.caps, D.ph.caps), extra: bool(ph.extra, D.ph.extra)
      },
      clear: bool(r.clear, D.clear)
    };
  }

  function loadPrefs() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) { raw = null; }
    prefs = normPrefs(raw);
  }
  var prefsTimer = null;
  function savePrefs() {
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(savePrefsNow, 300);
  }
  function savePrefsNow() {
    clearTimeout(prefsTimer);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* full: options only */ }
  }

  // ---------- 3. Generator ----------
  var ready = false;          // crypto + word lists present
  var current = null;         // { value, bits } shown now (memory only)
  var diceWords = [];         // words picked with real dice (memory only)

  function pwOpts() {
    var o = prefs.pw;
    return { length: o.length, lower: o.lower, upper: o.upper, digits: o.digits,
             symbols: o.symbols, noAmbig: o.noAmbig, custom: o.custom };
  }

  function generate() {
    if (!ready) return;
    var tab = prefs.tab;
    $("dice-err").hidden = true;
    try {
      if (tab === "pw") {
        current = prefs.pw.mode === "pin" ? P.genPin(prefs.pw.pin) : P.genPassword(pwOpts());
      } else if (tab === "ph") {
        current = prefs.ph.src === "dice" ? diceResult() : P.genPassphrase(prefs.ph);
      } else {
        return;
      }
    } catch (e) {
      current = null;
      if (e && e.message === "no-sets") showToast(t("err.sets"));
    }
    renderOut();
  }

  // Real dice: the words typed so far, joined like a generated phrase.
  // Entropy assumes fair dice: log2(list size) per word.
  function diceResult() {
    if (!diceWords.length) return null;
    var o = prefs.ph;
    var shown = diceWords.map(function (w) {
      return o.caps ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    });
    return { value: shown.join(P.SEPS[o.sep]),
             bits: diceWords.length * Math.log2(P.list(o.list).length) };
  }

  function diceAdd() {
    var n = P.diceCount(prefs.ph.list), inp = $("dice-in"), err = $("dice-err");
    if (diceWords.length >= P.WORDS_MAX) {
      err.textContent = t("dice.full", { n: P.WORDS_MAX });
      err.hidden = false;
      return;
    }
    var w = P.diceWord(inp.value, prefs.ph.list);
    if (!w) {
      err.textContent = t("dice.bad", { n: n });
      err.hidden = false;
      inp.focus();
      return;
    }
    err.hidden = true;
    diceWords.push(w);
    inp.value = "";
    inp.focus();
    renderDice();
    generate();
  }

  function renderDice() {
    var ol = $("dice-words");
    ol.textContent = "";
    if (!diceWords.length) {
      ol.appendChild(el("li", "empty", t("dice.empty")));
    } else {
      diceWords.forEach(function (w) { ol.appendChild(el("li", "", w)); });
    }
    $("dice-undo").disabled = !diceWords.length;
    $("dice-clear").disabled = !diceWords.length;
    var n = P.diceCount(prefs.ph.list);
    $("dice-hint").textContent = t("dice.hint", { n: n, ex: n === 5 ? "41526" : "3152" });
    $("dice-in").maxLength = n;
    $("dice-in").placeholder = n === 5 ? "41526" : "3152";
  }

  // ---------- 4. Output + meter ----------
  function renderOut() {
    var out = $("out");
    out.textContent = "";
    if (!current) {
      $("copy-btn").disabled = true;
      setMeter($("gen-meter"), null, true);
      if (prefs.tab === "ph" && prefs.ph.src === "dice") out.appendChild(el("span", "placeholder", t("dice.empty")));
      return;
    }
    $("copy-btn").disabled = false;
    // One span per run of the same class: letters, digits, symbols.
    var v = current.value, run = "", cls = null;
    function flush() { if (run) out.appendChild(el("span", "c-" + cls, run)); run = ""; }
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i), k = c === " " ? "sp" : P.charClass(c);
      if (k !== cls) { flush(); cls = k; }
      run += c;
    }
    flush();
    setMeter($("gen-meter"), { bits: current.bits, score: P.scoreOf(current.bits) }, true);
  }

  function setMeter(box, res, exact) {
    var fill = box.querySelector(".fill");
    var label = box.querySelector(".m-label"), bits = box.querySelector(".m-bits");
    var time = box.querySelector(".m-time");
    if (!res) {
      box.setAttribute("data-score", "");
      fill.style.width = "0";
      label.textContent = ""; bits.textContent = "";
      if (time) time.textContent = "";
      return;
    }
    box.setAttribute("data-score", String(res.score));
    fill.style.width = Math.max(6, Math.min(100, res.bits / 100 * 100)) + "%";
    label.textContent = t("s." + res.score);
    bits.textContent = t(exact ? "m.exact" : "m.est", { bits: fmtBits(res.bits) });
    if (time) {
      time.textContent = t("m.time", { t: timeText(P.humanTime(P.crackSeconds(res.bits, P.RATES.fast))) });
    }
  }

  // ---------- 5. Copy + clipboard clearing ----------
  // The clipboard is cleared only if this frame kept the focus the
  // whole time: then nothing else can have been copied meanwhile.
  // Best effort: a browser may refuse, and leaving the app stops it.
  var clearTimer = null, focusLost = false;

  function writeClip(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(false);
  }

  function copyCurrent() {
    if (!current) return;
    writeClip(current.value).then(function (ok) {
      showToast(t(ok ? "toast.copied" : "toast.copyFail"));
      clearTimeout(clearTimer);
      if (!ok || !prefs.clear) return;
      focusLost = false;
      clearTimer = setTimeout(function () {
        clearTimer = null;
        if (focusLost || !document.hasFocus()) return;
        writeClip("").then(function (done) { if (done) showToast(t("toast.cleared")); });
      }, CLEAR_MS);
    });
  }

  // ---------- 6. Auditor ----------
  var auditTimer = null;

  function runAudit() {
    clearTimeout(auditTimer);
    var v = $("au-in").value, box = $("au-result");
    var res = v ? P.audit(v) : null;
    if (!res) { box.hidden = true; return; }
    box.hidden = false;
    setMeter($("au-meter"), res, false);
    $("t-online").textContent = timeText(res.times.online);
    $("t-slow").textContent = timeText(res.times.slow);
    $("t-fast").textContent = timeText(res.times.fast);
    var ul = $("au-findings");
    ul.textContent = "";
    res.findings.forEach(function (f) { ul.appendChild(el("li", "", t("f." + f))); });
    if (res.score < 3) ul.appendChild(el("li", "tip", t("tip")));
    $("au-none").hidden = res.findings.length > 0 || res.score < 3;
    live(t("s." + res.score));
  }

  function clearAudit() {
    clearTimeout(auditTimer);
    $("au-in").value = "";
    $("au-in").type = "password";
    $("au-show").setAttribute("aria-pressed", "false");
    $("au-show").textContent = t("btn.show");
    $("au-result").hidden = true;
    $("au-findings").textContent = "";
  }

  // ---------- 7. Tabs + options UI ----------
  function setTab(tab) {
    if (prefs.tab === "au" && tab !== "au") clearAudit();
    prefs.tab = tab;
    savePrefs();
    renderTabs();
    if (tab === "au") { $("au-in").focus(); return; }
    generate();
  }

  function renderTabs() {
    var tab = prefs.tab;
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    $("gen").hidden = tab === "au";
    $("audit").hidden = tab !== "au";
    $("pw-opts").hidden = tab !== "pw";
    $("ph-opts").hidden = tab !== "ph";
    $("gen").setAttribute("aria-labelledby", tab === "ph" ? "tab-ph" : "tab-pw");
    renderOpts();
  }

  function setSeg(groupId, attr, value) {
    Array.prototype.forEach.call($(groupId).querySelectorAll("button"), function (b) {
      var on = b.getAttribute(attr) === value;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  }

  function setRange(rangeId, numId, lo, hi, v) {
    var r = $(rangeId), n = $(numId);
    r.min = n.min = lo; r.max = n.max = hi;
    r.value = n.value = v;
  }

  function renderOpts() {
    var o = prefs.pw, pin = o.mode === "pin";
    setSeg("pw-mode", "data-mode", o.mode);
    $("len-label").textContent = t(pin ? "pinlen" : "len");
    setRange("len-range", "len-num", pin ? P.PIN_MIN : P.LEN_MIN, pin ? P.PIN_MAX : P.LEN_MAX,
             pin ? o.pin : o.length);
    $("chars-only").hidden = pin;
    $("o-lower").checked = !!o.lower;
    $("o-upper").checked = !!o.upper;
    $("o-digits").checked = !!o.digits;
    $("o-symbols").checked = !!o.symbols;
    $("o-ambig").checked = !!o.noAmbig;
    $("o-custom").value = o.custom;
    $("o-custom").disabled = !o.symbols;

    var h = prefs.ph, dice = h.src === "dice";
    setSeg("ph-src", "data-src", h.src);
    $("ph-list").value = h.list;
    $("words-label").textContent = t("words");
    setRange("words-range", "words-num", P.WORDS_MIN, P.WORDS_MAX, h.words);
    $("words-row").hidden = dice;
    $("extra-label").hidden = dice;
    $("ph-sep").value = h.sep;
    $("ph-caps").checked = !!h.caps;
    $("ph-extra").checked = !!h.extra;
    $("dice-box").hidden = !dice;
    $("regen-btn").hidden = prefs.tab === "ph" && dice;
    if (dice) renderDice();

    $("o-clear").checked = !!prefs.clear;
  }

  function onOpt(fn) {
    return function (e) {
      fn(e);
      savePrefs();
      renderOpts();
      generate();
    };
  }

  function rangeHandler(e) {
    var v = parseInt(e.target.value, 10);
    if (!isFinite(v)) return;
    if (e.target.id === "len-range" || e.target.id === "len-num") {
      if (prefs.pw.mode === "pin") prefs.pw.pin = Math.min(P.PIN_MAX, Math.max(P.PIN_MIN, v));
      else prefs.pw.length = Math.min(P.LEN_MAX, Math.max(P.LEN_MIN, v));
    } else {
      prefs.ph.words = Math.min(P.WORDS_MAX, Math.max(P.WORDS_MIN, v));
    }
  }

  // Unticking the last kind of character is refused (the box stays on).
  function setCheck(key) {
    return function (e) {
      var o = prefs.pw, next = e.target.checked ? 1 : 0;
      if (!next && ["lower", "upper", "digits", "symbols"].filter(function (k) {
        return k !== key && o[k];
      }).length === 0) {
        e.target.checked = true;
        showToast(t("err.sets"));
        return;
      }
      o[key] = next;
    };
  }

  function applyI18n() {
    document.title = t("app") + " · orOS";
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("tab-pw").textContent = t("tab.pw");
    $("tab-ph").textContent = t("tab.ph");
    $("tab-au").textContent = t("tab.au");
    var modes = $("pw-mode").querySelectorAll("button");
    modes[0].textContent = t("mode.chars");
    modes[1].textContent = t("mode.pin");
    var srcs = $("ph-src").querySelectorAll("button");
    srcs[0].textContent = t("src.device");
    srcs[1].textContent = t("src.dice");
    $("ph-list").options[0].textContent = t("p.large");
    $("ph-list").options[1].textContent = t("p.short");
    var seps = $("ph-sep").options;
    seps[0].textContent = t("sep.space");
    seps[1].textContent = t("sep.dash");
    seps[2].textContent = t("sep.dot");
    seps[3].textContent = t("sep.under");
    $("regen-btn").textContent = t("btn.regen");
    $("regen-btn").setAttribute("aria-label", t("btn.regen.aria"));
    $("copy-btn").textContent = t("btn.copy");
    $("au-show").textContent = t("btn.show");
    $("dice-add").textContent = t("dice.add");
    $("dice-undo").textContent = t("dice.undo");
    $("dice-clear").textContent = t("dice.clear");
    $("o-custom").placeholder = P.SYMBOLS;
    $("no-crypto").textContent = t("err.crypto");
  }

  // ---------- 8. Toasts ----------
  var toastTimer = null;
  function showToast(text) {
    var box = $("toast");
    if (!box) return;
    box.textContent = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3000);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 9. Keyboard ----------
  function isField(tg) {
    var tag = tg && tg.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (prefs.tab === "au") return;
      var tg = e.target;
      // Ctrl/Cmd + C with nothing selected copies the shown password.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "c" || e.key === "C")) {
        var sel = window.getSelection && String(window.getSelection());
        if (!sel && !isField(tg)) { e.preventDefault(); copyCurrent(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isField(tg) || (tg && tg.tagName === "BUTTON")) return;
      if (e.key === "Enter" || e.key === " " || e.code === "Space") {
        if (prefs.tab === "ph" && prefs.ph.src === "dice") return;
        e.preventDefault();
        generate();
      }
    });
    // Arrow keys move between tabs and between segment buttons.
    function arrows(container, onPick) {
      container.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        var bs = Array.prototype.slice.call(container.querySelectorAll("button"));
        var i = bs.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        var n = bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
        onPick(n);
        n.focus();
      });
    }
    arrows($("tabs"), function (b) { setTab(b.getAttribute("data-tab")); });
    arrows($("pw-mode"), function (b) { b.click(); });
    arrows($("ph-src"), function (b) { b.click(); });
  }

  // ---------- 10. Palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

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
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  // ---------- 11. Wiring & boot ----------
  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
    });
    $("regen-btn").addEventListener("click", generate);
    $("copy-btn").addEventListener("click", copyCurrent);

    Array.prototype.forEach.call($("pw-mode").querySelectorAll("button"), function (b) {
      b.addEventListener("click", onOpt(function () { prefs.pw.mode = b.getAttribute("data-mode"); }));
    });
    Array.prototype.forEach.call($("ph-src").querySelectorAll("button"), function (b) {
      b.addEventListener("click", onOpt(function () { prefs.ph.src = b.getAttribute("data-src"); }));
    });
    ["len-range", "words-range"].forEach(function (id) {
      $(id).addEventListener("input", onOpt(rangeHandler));
    });
    ["len-num", "words-num"].forEach(function (id) {
      $(id).addEventListener("change", onOpt(rangeHandler));
    });
    $("o-lower").addEventListener("change", onOpt(setCheck("lower")));
    $("o-upper").addEventListener("change", onOpt(setCheck("upper")));
    $("o-digits").addEventListener("change", onOpt(setCheck("digits")));
    $("o-symbols").addEventListener("change", onOpt(setCheck("symbols")));
    $("o-ambig").addEventListener("change", onOpt(function (e) { prefs.pw.noAmbig = e.target.checked ? 1 : 0; }));
    // Custom symbols: keep only valid ones, applied when typing stops.
    $("o-custom").addEventListener("change", onOpt(function (e) { prefs.pw.custom = P.normSymbols(e.target.value); }));
    $("ph-list").addEventListener("change", onOpt(function (e) {
      prefs.ph.list = e.target.value === "short" ? "short" : "large";
      diceWords = [];      // dice codes differ per list
    }));
    $("ph-sep").addEventListener("change", onOpt(function (e) { prefs.ph.sep = e.target.value; }));
    $("ph-caps").addEventListener("change", onOpt(function (e) { prefs.ph.caps = e.target.checked ? 1 : 0; }));
    $("ph-extra").addEventListener("change", onOpt(function (e) { prefs.ph.extra = e.target.checked ? 1 : 0; }));
    $("o-clear").addEventListener("change", function (e) {
      prefs.clear = e.target.checked ? 1 : 0;
      if (!prefs.clear) clearTimeout(clearTimer);
      savePrefs();
    });

    $("dice-add").addEventListener("click", diceAdd);
    $("dice-in").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); diceAdd(); }
    });
    $("dice-undo").addEventListener("click", function () { diceWords.pop(); renderDice(); generate(); });
    $("dice-clear").addEventListener("click", function () { diceWords = []; renderDice(); generate(); });

    $("au-in").addEventListener("input", function () {
      clearTimeout(auditTimer);
      auditTimer = setTimeout(runAudit, AUDIT_DELAY);
    });
    $("au-show").addEventListener("click", function () {
      var inp = $("au-in"), show = inp.type === "password";
      inp.type = show ? "text" : "password";
      this.setAttribute("aria-pressed", show ? "true" : "false");
      this.textContent = t(show ? "btn.hide" : "btn.show");
      inp.focus();
    });

    window.addEventListener("blur", function () { focusLost = true; });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { focusLost = true; savePrefsNow(); }
    });
    window.addEventListener("pagehide", function () {
      savePrefsNow();
      clearAudit();
      current = null;
      diceWords = [];
    });
    wireKeyboard();
  }

  function boot() {
    loadPrefs();
    applyI18n();
    ready = !!(P && P.hasCrypto() && window.PW_WORDS);
    if (window.PW_WORDS) P.setLists(window.PW_WORDS);
    if (typeof window.PW_COMMON === "string") P.setCommon(window.PW_COMMON);
    if (!(P && P.hasCrypto())) {
      $("no-crypto").hidden = false;
      $("regen-btn").disabled = true;
    }
    wire();
    inheritPalette();
    watchPalette();
    renderTabs();
    generate();
  }

  boot();
})();
