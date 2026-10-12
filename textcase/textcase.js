// ============================================================
// orOS Case Converter — App logic (v1.0.0)
// Paste or type a text, pick a conversion, copy the result.
//   - Text (editable) and Result (live, read-only); "Use as text"
//     moves the result up to chain conversions
//   - four tabs of conversions: Basic (case), Greek (accents,
//     ELOT 743, Greeklish, mixed letters), Code (camelCase…),
//     Styles (Unicode bold, italic… and back to plain)
//   - Language: automatic or chosen (Greek, Turkish i, German ß)
//   - Selection only: converts the selected part of the text
//   - My words: words whose casing is always kept (synced)
// Data:
//   - synced slice "textcase" (oros-textcase-data): My words, LWW per
//     word + tombstones (textcase/core.js, R5, R17, R26)
//   - device-local (R10): oros-textcase-prefs (tab, conversion,
//     language, switches) and oros-textcase-draft (the text, up to
//     100,000 characters; never synced: it may be private)
// Deep link: __orosOpenAt("textcase", { text }) opens the app with
// that text (Text Tools and other apps).
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage: My words, prefs, draft
//   3. Converting
//   4. Text box: paste, clear, use, copy
//   5. Tabs + conversion chips
//   6. My words dialog
//   7. Toasts
//   8. Keyboard (Contract Β)
//   9. Sync slice + palette + deep link
//  10. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C        = window.TextCaseCore;
  var TAB_IDS  = ["basic", "greek", "code", "styles"];
  var DRAFT_MS = 500;
  var BIG      = 20000;   // longer texts convert after a short pause

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
      "app.name": "Case Converter",
      "f.src": "Text", "f.out": "Result", "f.lang": "Language", "f.word": "New word",
      "ph.src": "Type or paste text here…", "ph.out": "The result appears here.", "ph.word": "e.g. iPhone",
      "btn.paste": "Paste", "btn.clear": "Clear", "btn.use": "Use as text", "btn.copy": "Copy",
      "btn.words": "My words", "btn.close": "Close", "btn.add": "Add", "btn.remove": "Remove {w}",
      "tab.basic": "Basic", "tab.greek": "Greek", "tab.code": "Code", "tab.styles": "Styles",
      "aria.tabs": "Conversions",
      "opt.sel": "Selection only", "opt.keepGreek": "Keep Greek letters",
      "lang.auto": "Automatic", "lang.en": "English", "lang.el": "Ελληνικά", "lang.tr": "Türkçe", "lang.de": "Deutsch",
      "m.upper": "UPPERCASE", "m.lower": "lowercase", "m.sentence": "Sentence case", "m.title": "Title Case",
      "m.capital": "Capitalize Each Word", "m.toggle": "tOGGLE cASE", "m.alt": "aLtErNaTiNg",
      "m.noaccents": "Remove accents", "m.elot": "Greek → Latin (ELOT 743)", "m.greeklish": "Greeklish",
      "m.mixed": "Fix mixed letters",
      "m.bold": "Bold", "m.italic": "Italic", "m.bolditalic": "Bold italic", "m.sansbold": "Sans bold",
      "m.mono": "Monospace", "m.double": "Double-struck", "m.smallcaps": "Small caps", "m.wide": "Fullwidth",
      "m.circled": "Circled", "m.strike": "Strikethrough", "m.under": "Underline", "m.plain": "Plain text",
      "h.lower": "Capitals without accents cannot get their accents back (ΚΑΛΗΜΕΡΑ → καλημερα).",
      "h.words": "Words in My words keep their capitals.",
      "h.toggle": "Turns capitals into small letters and the other way round, handy after Caps Lock.",
      "h.noaccents": "Takes away accents and diaereses, in Greek and in other languages (café → cafe).",
      "h.elot": "ELOT 743, the way Greek names are written on passports.",
      "h.greeklish": "Casual Greeklish, as in messages.",
      "h.mixedN": "Fixed {n} words.", "h.mixed1": "Fixed 1 word.",
      "h.mixed0": "No words with mixed Greek and Latin letters.",
      "h.code": "Each line becomes one name. Greek is written in Latin letters unless you keep it.",
      "h.styles": "Many screen readers read these letters badly or not at all; keep them for short titles. Letters a style has no form for stay as they are.",
      "h.plain": "Turns letters from Styles back into plain text.",
      "h.selNone": "Select part of the text to convert only that.",
      "counts": "{c} · {w} · {l}",
      "n.c1": "1 character", "n.c": "{n} characters", "n.w1": "1 word", "n.w": "{n} words", "n.l1": "1 line", "n.l": "{n} lines",
      "words.title": "My words",
      "words.hint": "These words keep their capitals in Sentence case, Title Case and Capitalize Each Word. They follow you to your other devices.",
      "words.count": "{n} of {max}", "words.empty": "No words yet.",
      "toast.copied": "Copied", "toast.copyFail": "Could not copy: select the result and copy it yourself",
      "toast.pasteFail": "Paste with Ctrl+V, or long-press in the box",
      "toast.cleared": "Text cleared", "toast.used": "The result is now the text", "toast.replaced": "Text replaced",
      "toast.undo": "Undo",
      "toast.tooLong": "This text is too long to keep on this device. It stays while the app is open.",
      "toast.saveFail": "Could not save: storage is full",
      "toast.added": "Added to My words", "toast.same": "Already in My words",
      "toast.bad": "A word has 1 to 40 characters and no spaces", "toast.full": "My words is full ({max})",
      "toast.removed": "“{w}” removed"
    },
    el: {
      "app.name": "Κεφαλαία & πεζά",
      "f.src": "Κείμενο", "f.out": "Αποτέλεσμα", "f.lang": "Γλώσσα", "f.word": "Νέα λέξη",
      "ph.src": "Γράψε ή επικόλλησε κείμενο εδώ…", "ph.out": "Εδώ εμφανίζεται το αποτέλεσμα.", "ph.word": "π.χ. iPhone",
      "btn.paste": "Επικόλληση", "btn.clear": "Καθαρισμός", "btn.use": "Χρήση ως κείμενο", "btn.copy": "Αντιγραφή",
      "btn.words": "Οι λέξεις μου", "btn.close": "Κλείσιμο", "btn.add": "Προσθήκη", "btn.remove": "Αφαίρεση {w}",
      "tab.basic": "Βασικά", "tab.greek": "Ελληνικά", "tab.code": "Κώδικας", "tab.styles": "Στυλ",
      "aria.tabs": "Μετατροπές",
      "opt.sel": "Μόνο η επιλογή", "opt.keepGreek": "Να μείνουν ελληνικά",
      "lang.auto": "Αυτόματα", "lang.en": "English", "lang.el": "Ελληνικά", "lang.tr": "Türkçe", "lang.de": "Deutsch",
      "m.upper": "ΚΕΦΑΛΑΙΑ", "m.lower": "πεζά", "m.sentence": "Κεφαλαίο στην αρχή", "m.title": "Τίτλος",
      "m.capital": "Κάθε Λέξη Με Κεφαλαίο", "m.toggle": "αΝΤΙΣΤΡΟΦΗ", "m.alt": "εΝαΛλΑξ",
      "m.noaccents": "Χωρίς τόνους", "m.elot": "Λατινικά (ΕΛΟΤ 743)", "m.greeklish": "Greeklish",
      "m.mixed": "Διόρθωση μικτών γραμμάτων",
      "m.bold": "Έντονα", "m.italic": "Πλάγια", "m.bolditalic": "Έντονα πλάγια", "m.sansbold": "Έντονα sans",
      "m.mono": "Σταθερό πλάτος", "m.double": "Διπλή γραμμή", "m.smallcaps": "Μικρά κεφαλαία", "m.wide": "Πλατιά",
      "m.circled": "Σε κύκλο", "m.strike": "Διαγράμμιση", "m.under": "Υπογράμμιση", "m.plain": "Απλό κείμενο",
      "h.lower": "Τα κεφαλαία χωρίς τόνους δεν ξαναπαίρνουν τόνους (ΚΑΛΗΜΕΡΑ → καλημερα).",
      "h.words": "Οι λέξεις από το «Οι λέξεις μου» κρατούν τα κεφαλαία τους.",
      "h.toggle": "Κάνει τα κεφαλαία πεζά και τα πεζά κεφαλαία, χρήσιμο όταν έμεινε πατημένο το Caps Lock.",
      "h.noaccents": "Βγάζει τόνους και διαλυτικά, στα ελληνικά και σε άλλες γλώσσες (café → cafe).",
      "h.elot": "ΕΛΟΤ 743, όπως γράφονται τα ονόματα στα διαβατήρια.",
      "h.greeklish": "Πρόχειρα Greeklish, όπως στα μηνύματα.",
      "h.mixedN": "Διορθώθηκαν {n} λέξεις.", "h.mixed1": "Διορθώθηκε 1 λέξη.",
      "h.mixed0": "Δεν υπάρχουν λέξεις με ανακατεμένα ελληνικά και λατινικά γράμματα.",
      "h.code": "Κάθε γραμμή γίνεται ένα όνομα. Τα ελληνικά γράφονται με λατινικά, εκτός αν τα κρατήσεις.",
      "h.styles": "Πολλοί αναγνώστες οθόνης διαβάζουν αυτά τα γράμματα λάθος ή καθόλου· κράτησέ τα για σύντομους τίτλους. Όσα γράμματα δεν έχουν μορφή σε ένα στυλ μένουν όπως είναι.",
      "h.plain": "Κάνει τα γράμματα από τα Στυλ ξανά απλό κείμενο.",
      "h.selNone": "Επίλεξε ένα μέρος του κειμένου για να μετατραπεί μόνο αυτό.",
      "counts": "{c} · {w} · {l}",
      "n.c1": "1 χαρακτήρας", "n.c": "{n} χαρακτήρες", "n.w1": "1 λέξη", "n.w": "{n} λέξεις", "n.l1": "1 γραμμή", "n.l": "{n} γραμμές",
      "words.title": "Οι λέξεις μου",
      "words.hint": "Αυτές οι λέξεις κρατούν τα κεφαλαία τους στις μετατροπές «Κεφαλαίο στην αρχή», «Τίτλος» και «Κάθε Λέξη Με Κεφαλαίο». Σε ακολουθούν και στις άλλες συσκευές σου.",
      "words.count": "{n} από {max}", "words.empty": "Καμία λέξη ακόμα.",
      "toast.copied": "Αντιγράφηκε", "toast.copyFail": "Δεν έγινε αντιγραφή: επίλεξε το αποτέλεσμα και αντίγραψέ το εσύ",
      "toast.pasteFail": "Επικόλλησε με Ctrl+V ή με παρατεταμένο πάτημα στο πλαίσιο",
      "toast.cleared": "Το κείμενο καθαρίστηκε", "toast.used": "Το αποτέλεσμα έγινε κείμενο", "toast.replaced": "Το κείμενο αντικαταστάθηκε",
      "toast.undo": "Αναίρεση",
      "toast.tooLong": "Το κείμενο είναι πολύ μεγάλο για να μείνει στη συσκευή. Μένει όσο η εφαρμογή είναι ανοιχτή.",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.added": "Προστέθηκε στις λέξεις σου", "toast.same": "Υπάρχει ήδη στις λέξεις σου",
      "toast.bad": "Μια λέξη έχει από 1 έως 40 χαρακτήρες και χωρίς κενά", "toast.full": "Οι λέξεις σου είναι γεμάτες ({max})",
      "toast.removed": "Η λέξη «{w}» αφαιρέθηκε"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) { s = s.split("{" + k + "}").join(String(params[k])); });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function setLabel(btn, label) { btn.setAttribute("aria-label", label); btn.title = label; }
  function fmt(n) { try { return n.toLocaleString(LANG === "el" ? "el-GR" : "en-GB"); } catch (e) { return String(n); } }

  // ---------- 2. Storage: My words, prefs, draft ----------
  var data = null;
  var prefs = C.readPrefs(null);

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function load() { data = C.seeded(readJSON(C.DATA_KEY)); }
  function loadPrefs() { prefs = C.readPrefs(readJSON(C.PREFS_KEY)); }

  function saveData() {
    try {
      localStorage.setItem(C.DATA_KEY, JSON.stringify(data));
    } catch (e) {
      showToast(t("toast.saveFail"));
      return;
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function savePrefs() {
    try { localStorage.setItem(C.PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  var draftTimer = null, tooLongShown = false;
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, DRAFT_MS);
  }
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    var v = $("src").value;
    try {
      if (!v) { localStorage.removeItem(C.DRAFT_KEY); return; }
      if (v.length > C.MAX_DRAFT) {
        localStorage.removeItem(C.DRAFT_KEY);
        if (!tooLongShown) { tooLongShown = true; showToast(t("toast.tooLong")); }
        return;
      }
      localStorage.setItem(C.DRAFT_KEY, v);
    } catch (e) {
      if (!tooLongShown) { tooLongShown = true; showToast(t("toast.saveFail")); }
    }
  }
  function loadDraft() {
    try {
      var v = localStorage.getItem(C.DRAFT_KEY);
      if (typeof v === "string") $("src").value = v.slice(0, C.MAX_DRAFT);
    } catch (e) {}
  }

  // ---------- 3. Converting ----------
  var selStart = 0, selEnd = 0, lastRange = null, convTimer = null;

  function trackSel() {
    var s = $("src");
    selStart = s.selectionStart || 0;
    selEnd = s.selectionEnd || 0;
  }
  function hasSel() { return selEnd > selStart && selEnd <= $("src").value.length; }

  function opts() {
    return { lang: prefs.lang, words: data.words, keepGreek: prefs.keepGreek };
  }

  function convertSoon() {
    clearTimeout(convTimer);
    if ($("src").value.length > BIG) convTimer = setTimeout(convertNow, 200);
    else convertNow();
  }

  function convertNow() {
    clearTimeout(convTimer);
    var v = $("src").value, r;
    if (prefs.sel && hasSel()) r = C.convertRange(prefs.mode, v, selStart, selEnd, opts());
    else r = C.convert(prefs.mode, v, opts());
    lastRange = prefs.sel && hasSel() ? r : null;
    $("out").value = r.text;
    renderHint(r, v);
    renderCounts(v);
  }

  function renderHint(r, v) {
    var m = prefs.mode, h = "";
    if (m === "lower" && C.langOf(v, prefs.lang) === "el") h = t("h.lower");
    else if (m === "sentence" || m === "title" || m === "capital") h = t("h.words");
    else if (m === "toggle" || m === "noaccents" || m === "elot" || m === "greeklish" || m === "plain") h = t("h." + m);
    else if (m === "mixed") h = v ? (r.n === 1 ? t("h.mixed1") : (r.n ? t("h.mixedN", { n: fmt(r.n) }) : t("h.mixed0"))) : "";
    else if (C.TABS.code.indexOf(m) >= 0) h = t("h.code");
    else if (C.STYLES.indexOf(m) >= 0) h = t("h.styles");
    if (prefs.sel && !hasSel() && v) h = t("h.selNone") + (h ? " " + h : "");
    $("mode-hint").textContent = h;
  }

  function renderCounts(v) {
    if (!v) { $("counts").textContent = ""; return; }
    var c = C.counts(v);
    function n(k, v) { return v === 1 ? t("n." + k + "1") : t("n." + k, { n: fmt(v) }); }
    $("counts").textContent = t("counts", { c: n("c", c.chars), w: n("w", c.words), l: n("l", c.lines) });
  }

  // ---------- 4. Text box: paste, clear, use, copy ----------
  // Replaces the text with an Undo toast (when something is lost).
  function replaceText(next, toastKey, sel) {
    var src = $("src"), prev = src.value;
    if (next === prev) return;
    src.value = next;
    if (sel) { src.setSelectionRange(sel.start, sel.end); selStart = sel.start; selEnd = sel.end; }
    else { selStart = selEnd = 0; }
    saveDraft();
    convertNow();
    if (!prev) return;
    undoToast(t(toastKey), function () {
      src.value = prev;
      selStart = selEnd = 0;
      saveDraft();
      convertNow();
      src.focus();
    });
  }

  function onPaste() {
    var cb = navigator.clipboard;
    if (!cb || typeof cb.readText !== "function") { showToast(t("toast.pasteFail")); $("src").focus(); return; }
    cb.readText().then(function (txt) {
      if (typeof txt !== "string" || !txt) { showToast(t("toast.pasteFail")); return; }
      var src = $("src"), v = src.value;
      var a = src.selectionStart || 0, b = src.selectionEnd || 0;
      if (document.activeElement !== src) { a = v.length; b = v.length; }
      src.value = v.slice(0, a) + txt + v.slice(b);
      src.focus();
      src.setSelectionRange(a + txt.length, a + txt.length);
      trackSel();
      saveDraft();
      convertNow();
    }, function () { showToast(t("toast.pasteFail")); $("src").focus(); });
  }

  function onClear() {
    if (!$("src").value) { $("src").focus(); return; }
    replaceText("", "toast.cleared");
    $("src").focus();
  }

  function onUse() {
    var out = $("out").value;
    if (out === $("src").value) { $("src").focus(); return; }
    var r = lastRange;
    replaceText(out, "toast.used", r && r.start !== undefined ? { start: r.start, end: r.end } : null);
    $("src").focus();
  }

  function copyFallback() {
    var o = $("out");
    try {
      o.focus();
      o.select();
      return document.execCommand("copy");
    } catch (e) { return false; }
  }
  function onCopy() {
    var v = $("out").value;
    if (!v) { showToast(t("toast.copyFail")); return; }
    var cb = navigator.clipboard;
    if (cb && typeof cb.writeText === "function") {
      cb.writeText(v).then(function () { showToast(t("toast.copied")); },
        function () { showToast(t(copyFallback() ? "toast.copied" : "toast.copyFail")); });
    } else {
      showToast(t(copyFallback() ? "toast.copied" : "toast.copyFail"));
    }
  }

  // ---------- 5. Tabs + conversion chips ----------
  function tabOf(mode) {
    for (var i = 0; i < TAB_IDS.length; i++) if (C.TABS[TAB_IDS[i]].indexOf(mode) >= 0) return TAB_IDS[i];
    return "basic";
  }
  var CODE_LABEL = {
    camel: "camelCase", pascal: "PascalCase", snake: "snake_case", kebab: "kebab-case",
    constant: "CONSTANT_CASE", dot: "dot.case", path: "path/case", train: "Train-Case"
  };
  var STYLE_SAMPLE = {
    bold: "Bold", italic: "Italic", bolditalic: "Bold italic", sansbold: "Sans bold", mono: "Mono",
    double: "Double", smallcaps: "small caps", wide: "Wide", circled: "circled", strike: "Strike", under: "Underline"
  };
  function modeLabel(m) {
    if (CODE_LABEL[m]) return CODE_LABEL[m];
    if (STYLE_SAMPLE[m]) return C.stylize(STYLE_SAMPLE[m], m);
    return t("m." + m);
  }

  function showTab(tab, focus) {
    prefs.tab = C.TABS[tab] ? tab : "basic";
    TAB_IDS.forEach(function (k) {
      var b = $("tab-" + k), on = k === prefs.tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    if (C.TABS[prefs.tab].indexOf(prefs.mode) < 0) prefs.mode = C.TABS[prefs.tab][0];
    $("keep-greek-row").hidden = prefs.tab !== "code";
    renderChips();
    savePrefs();
    convertNow();
    if (focus) $("tab-" + prefs.tab).focus();
  }

  function renderChips() {
    var box = $("modes");
    box.textContent = "";
    C.TABS[prefs.tab].forEach(function (m) {
      var b = el("button", "chip", modeLabel(m));
      var on = m === prefs.mode;
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      b.setAttribute("data-mode", m);
      if (STYLE_SAMPLE[m] || CODE_LABEL[m]) setLabel(b, STYLE_SAMPLE[m] ? t("m." + m) : CODE_LABEL[m]);
      b.addEventListener("click", function () { pickMode(m); });
      box.appendChild(b);
    });
  }

  function pickMode(m, focus) {
    if (C.MODES.indexOf(m) < 0) return;
    prefs.mode = m;
    if (tabOf(m) !== prefs.tab) { showTab(tabOf(m)); }
    else { renderChips(); savePrefs(); convertNow(); }
    if (focus) {
      var b = $("modes").querySelector('[data-mode="' + m + '"]');
      if (b) b.focus();
    }
    live(t("f.out") + ": " + (STYLE_SAMPLE[m] ? t("m." + m) : modeLabel(m)));
  }

  function fillLangs() {
    var s = $("lang-sel");
    s.textContent = "";
    C.LANGS.forEach(function (l) {
      var o = el("option", "", t("lang." + l));
      o.value = l;
      if (l !== "auto") o.lang = l;
      s.appendChild(o);
    });
    s.value = prefs.lang;
  }

  // ---------- 6. My words dialog ----------
  var lastFocus = null;
  function openWords() {
    lastFocus = document.activeElement;
    renderWords();
    $("scrim").hidden = false;
    $("words").hidden = false;
    $("word-in").focus();
  }
  function closeWords() {
    $("scrim").hidden = true;
    $("words").hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function renderWords() {
    var ul = $("word-list");
    ul.textContent = "";
    var list = C.sortedForList(data, LANG);
    list.forEach(function (w) {
      var li = el("li", "word");
      li.appendChild(el("span", "word-text", w.w));
      var b = el("button", "icon-btn");
      b.type = "button";
      b.innerHTML = ICON.close;
      setLabel(b, t("btn.remove", { w: w.w }));
      b.addEventListener("click", function () { removeWord(w); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    $("words-empty").hidden = list.length > 0;
    $("words-count").textContent = t("words.count", { n: fmt(list.length), max: fmt(C.MAX_WORDS) });
  }

  function addWord(e) {
    if (e) e.preventDefault();
    var r = C.addWord(data, $("word-in").value, Date.now());
    if (!r.ok) {
      showToast(t("toast." + r.why, { max: fmt(C.MAX_WORDS) }));
      $("word-in").focus();
      return;
    }
    data = r.data;
    saveData();
    $("word-in").value = "";
    renderWords();
    convertNow();
    live(t("toast.added"));
    $("word-in").focus();
  }

  function removeWord(w) {
    data = C.removeWord(data, w.id, Date.now());
    saveData();
    renderWords();
    convertNow();
    $("word-in").focus();
    undoToast(t("toast.removed", { w: w.w }), function () {
      var r = C.addWord(data, w.w, Date.now());   // a newer edit resurrects (R17)
      if (!r.ok) return;
      data = r.data;
      saveData();
      if (!$("words").hidden) renderWords();
      convertNow();
    });
  }

  // ---------- 7. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "textcase", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    box.textContent = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 8. Keyboard ----------
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
      if (e.key === "Escape" && !$("words").hidden) { e.preventDefault(); closeWords(); return; }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && $("words").hidden) {
        e.preventDefault();
        convertNow();
        onCopy();
      }
    });
    $("tabs").addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : (e.key === "ArrowLeft" ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      var i = (TAB_IDS.indexOf(prefs.tab) + d + TAB_IDS.length) % TAB_IDS.length;
      showTab(TAB_IDS[i], true);
    });
    $("modes").addEventListener("keydown", function (e) {
      var d = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : ((e.key === "ArrowLeft" || e.key === "ArrowUp") ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      var list = C.TABS[prefs.tab], i = list.indexOf(prefs.mode);
      pickMode(list[(i + d + list.length) % list.length], true);
    });
  }

  // ---------- 9. Sync slice + palette + deep link ----------
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
    api.registerSlice("textcase", sliceGet, sliceSet, C.DATA_KEY, C.mergeWords);
  }

  function sliceGet() { return C.mergeWords(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.words)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeWords(incoming, incoming);
      localStorage.setItem(C.DATA_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    if (!$("words").hidden) renderWords();
    convertNow();
  }

  // Deep link: { text } opens the app with that text (Undo brings the
  // previous text back).
  function openTarget(target) {
    if (!target || typeof target !== "object" || typeof target.text !== "string") return;
    replaceText(target.text.slice(0, 1000000), "toast.replaced");
    $("src").focus();
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // ---------- 10. Wiring & boot ----------
  var ICON = {
    words: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V7l4-3 4 3v12"/><path d="M4 13h8"/><path d="M15 19v-6a3 3 0 0 1 6 0v6"/><path d="M15 16h6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    $("src").placeholder = t("ph.src");
    $("out").placeholder = t("ph.out");
    $("word-in").placeholder = t("ph.word");
    $("tabs").setAttribute("aria-label", t("aria.tabs"));
    $("words-btn").innerHTML = ICON.words; setLabel($("words-btn"), t("btn.words"));
    $("words-close").innerHTML = ICON.close; setLabel($("words-close"), t("btn.close"));
  }

  function wire() {
    var src = $("src");
    src.addEventListener("input", function () { trackSel(); saveDraftSoon(); convertSoon(); });
    ["select", "keyup", "mouseup", "touchend", "focus"].forEach(function (ev) {
      src.addEventListener(ev, function () {
        var a = selStart, b = selEnd;
        trackSel();
        if (prefs.sel && (a !== selStart || b !== selEnd)) convertSoon();
      });
    });
    document.addEventListener("selectionchange", function () {
      if (document.activeElement !== src) return;
      var a = selStart, b = selEnd;
      trackSel();
      if (prefs.sel && (a !== selStart || b !== selEnd)) convertSoon();
    });
    src.addEventListener("blur", saveDraft);
    $("paste-btn").addEventListener("click", onPaste);
    $("clear-btn").addEventListener("click", onClear);
    $("use-btn").addEventListener("click", onUse);
    $("copy-btn").addEventListener("click", onCopy);
    TAB_IDS.forEach(function (k) { $("tab-" + k).addEventListener("click", function () { showTab(k); }); });
    $("lang-sel").addEventListener("change", function () {
      prefs.lang = C.LANGS.indexOf($("lang-sel").value) >= 0 ? $("lang-sel").value : "auto";
      savePrefs();
      convertNow();
    });
    $("sel-on").addEventListener("change", function () { prefs.sel = $("sel-on").checked; savePrefs(); convertNow(); });
    $("keep-greek").addEventListener("change", function () { prefs.keepGreek = $("keep-greek").checked; savePrefs(); convertNow(); });
    $("words-btn").addEventListener("click", openWords);
    $("words-close").addEventListener("click", closeWords);
    $("scrim").addEventListener("click", closeWords);
    $("word-form").addEventListener("submit", addWord);
    window.addEventListener("pagehide", saveDraft);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") saveDraft();
    });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    fillLangs();
    $("sel-on").checked = prefs.sel;
    $("keep-greek").checked = prefs.keepGreek;
    loadDraft();
    wire();
    registerSync();
    watchPalette();
    showTab(tabOf(prefs.mode));
    var opened = false;
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("textcase");
        if (pending) { openTarget(pending); opened = true; }
      }
    } catch (e) {}
    if (!opened && !$("src").value) $("src").focus();
  }

  boot();
})();
