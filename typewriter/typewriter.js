// ============================================================
// orOS Typewriter — App logic (v1.0.0)
// Write on a sheet of paper that rolls up like on a real typewriter.
//   - typewriter mode (on at first): nothing is erased; a backspace
//     strikes the letter with an X, and you only type forwards
//   - the line you type on stays in the middle of the screen
//   - letters with slightly uneven ink (the same letter in the same
//     place always looks the same)
//   - key, bell and carriage-return sounds made with Web Audio (off at first)
//   - pages (synced), word count, optional word goal, full screen
//   - copy, .txt download and print; paper: orOS, white, cream, night
// The text is a real <textarea> (accessible, works with every keyboard
// and IME); the inked letters are drawn in a layer under it.
// Data:
//   - synced slice "typewriter" (oros-typewriter-data): the pages, LWW
//     per page + tombstones (R5, R17, R26)
//   - device-local (R10): oros-typewriter-prefs (mode, sound, paper,
//     open page, side panel)
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Pages
//   4. The paper (ink layer, caret line, counts)
//   5. Typing (typewriter mode)
//   6. Sounds
//   7. Panel: pages list, page fields, paper, export
//   8. Toasts
//   9. Keyboard (Contract Β) + full screen
//  10. Sync slice + palette
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C           = window.TypewriterCore;
  var STORAGE_KEY = "oros-typewriter-data";
  var PREFS_KEY   = "oros-typewriter-prefs";
  var MAX_PAGES   = 200;
  var PAPERS      = ["auto", "white", "cream", "night"];
  var SAVE_MS     = 600;
  var BELL_LEFT   = 6;                // the bell rings this many letters before the margin

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
      "app.name": "Typewriter",
      "untitled": "New page", "text.label": "Your page",
      "words.one": "{n} word", "words": "{n} words", "words.goal": "{n} / {g} words",
      "btn.pages": "Pages", "btn.closePanel": "Close",
      "mode.on": "Typewriter mode: on (nothing is erased)", "mode.off": "Typewriter mode: off (normal editing)",
      "sound.on": "Sound: on", "sound.off": "Sound: off",
      "fs.on": "Full screen", "fs.off": "Leave full screen",
      "sec.pages": "Pages", "btn.new": "New page",
      "sec.page": "This page", "f.title": "Title", "f.title.ph": "Untitled", "f.goal": "Word goal", "f.goal.ph": "None",
      "sec.paper": "Paper", "paper.auto": "orOS", "paper.white": "White", "paper.cream": "Cream", "paper.night": "Night",
      "sec.export": "Take it with you", "btn.copy": "Copy text", "btn.txt": "Download .txt", "btn.print": "Print",
      "export.hint": "Copy and download leave out the struck letters; print shows the page as it is.",
      "pages.empty": "Your pages appear here. They follow you to all your devices.",
      "item.delete": "Delete page", "item.open": "Open",
      "toast.deleted": "Page deleted", "toast.undo": "Undo", "toast.copied": "Copied",
      "toast.copyFail": "Could not copy", "toast.saved": "Saved", "toast.empty": "This page is empty",
      "toast.full": "This page is full", "toast.pagesFull": "You have {n} pages, the most there can be",
      "toast.saveFail": "Could not save: storage is full",
      "goal.done": "Goal reached",
      "hint.mode": "Typewriter mode: a backspace strikes the letter instead of erasing it."
    },
    el: {
      "app.name": "Γραφομηχανή",
      "untitled": "Νέα σελίδα", "text.label": "Η σελίδα σου",
      "words.one": "{n} λέξη", "words": "{n} λέξεις", "words.goal": "{n} / {g} λέξεις",
      "btn.pages": "Σελίδες", "btn.closePanel": "Κλείσιμο",
      "mode.on": "Λειτουργία γραφομηχανής: ανοιχτή (τίποτα δεν σβήνεται)", "mode.off": "Λειτουργία γραφομηχανής: κλειστή (κανονική επεξεργασία)",
      "sound.on": "Ήχος: ανοιχτός", "sound.off": "Ήχος: κλειστός",
      "fs.on": "Πλήρης οθόνη", "fs.off": "Έξοδος από πλήρη οθόνη",
      "sec.pages": "Σελίδες", "btn.new": "Νέα σελίδα",
      "sec.page": "Αυτή η σελίδα", "f.title": "Τίτλος", "f.title.ph": "Χωρίς τίτλο", "f.goal": "Στόχος λέξεων", "f.goal.ph": "Κανένας",
      "sec.paper": "Χαρτί", "paper.auto": "orOS", "paper.white": "Λευκό", "paper.cream": "Κρεμ", "paper.night": "Νύχτα",
      "sec.export": "Πάρ' το μαζί σου", "btn.copy": "Αντιγραφή κειμένου", "btn.txt": "Λήψη .txt", "btn.print": "Εκτύπωση",
      "export.hint": "Η αντιγραφή και η λήψη αφήνουν έξω τα σβησμένα γράμματα· η εκτύπωση δείχνει τη σελίδα όπως είναι.",
      "pages.empty": "Οι σελίδες σου εμφανίζονται εδώ. Σε ακολουθούν σε όλες τις συσκευές σου.",
      "item.delete": "Διαγραφή σελίδας", "item.open": "Άνοιγμα",
      "toast.deleted": "Η σελίδα διαγράφηκε", "toast.undo": "Αναίρεση", "toast.copied": "Αντιγράφηκε",
      "toast.copyFail": "Δεν έγινε αντιγραφή", "toast.saved": "Αποθηκεύτηκε", "toast.empty": "Η σελίδα είναι άδεια",
      "toast.full": "Η σελίδα γέμισε", "toast.pagesFull": "Έχεις {n} σελίδες, όσες χωράνε",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "goal.done": "Ο στόχος έπιασε",
      "hint.mode": "Λειτουργία γραφομηχανής: το Backspace διαγράφει το γράμμα με X αντί να το σβήσει."
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
  function wordsLabel(n, goal) {
    if (goal) return t("words.goal", { n: n, g: goal });
    return t(n === 1 ? "words.one" : "words", { n: n });
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("typewriter.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = { ver: 1, pages: [], tombs: {} };
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.pages)) {
          data = C.mergeTypewriter(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] typewriter: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: 1, pages: [], tombs: {} };
  }

  var saveFailShown = false, saveTimer = null;
  function save() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.saveFail")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_MS);
  }
  function flush() { if (saveTimer) save(); }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      mode: p.mode !== false,                         // typewriter mode on at first
      sound: p.sound === true,
      paper: PAPERS.indexOf(p.paper) >= 0 ? p.paper : "auto",
      cur: typeof p.cur === "string" ? p.cur : "",
      panel: p.panel !== false
    };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 3. Pages ----------
  var cur = null;            // the open page, or null for a fresh sheet not saved yet

  function newPageObj() {
    return { id: C.newId(Math.random), m: Date.now(), title: "", text: "", goal: 0 };
  }
  // The open sheet becomes a stored page the first time something is written.
  function ensurePage() {
    if (cur) return cur;
    if (data.pages.length >= MAX_PAGES) { showToast(t("toast.pagesFull", { n: MAX_PAGES })); return null; }
    cur = newPageObj();
    data.pages.push(cur);
    prefs.cur = cur.id; savePrefs();
    return cur;
  }
  function touch(p) { p.m = Math.max(Date.now(), (data.tombs[p.id] || 0) + 1, p.m + 1); }

  function openPage(p) {
    flush();
    cur = p || null;
    prefs.cur = cur ? cur.id : ""; savePrefs();
    committed = cur ? cur.text : "";
    ta.value = committed;
    inkCache = [];
    renderPaper();
    renderFields();
    renderList();
    caretToEnd();
    centerCaret(true);
    closePanelOnPhone();
  }
  function newPage() {
    flush();
    if (cur && !cur.text && !cur.title) { ta.focus(); closePanelOnPhone(); return; }   // already a blank sheet
    openPage(null);
    ta.focus();
  }
  function deletePage(id) {
    var p = C.findPage(data, id);
    if (!p) return;
    var snap = JSON.parse(JSON.stringify(p)), tombs = {};
    tombs[id] = Math.max(Date.now(), p.m);
    data = C.mergeTypewriter(data, { pages: [], tombs: tombs });
    save();
    if (cur && cur.id === id) {
      var rest = C.newestFirst(data.pages);
      openPage(rest[0] || null);
    } else { renderList(); }
    undoToast(t("toast.deleted"), function () {
      snap.m = Math.max(Date.now(), (data.tombs[snap.id] || 0) + 1);   // R17
      data = C.mergeTypewriter(data, { pages: [snap], tombs: {} });
      save();
      openPage(C.findPage(data, snap.id));
    });
  }

  // ---------- 4. The paper ----------
  var ta = null, ink = null, committed = "", inkCache = [];

  // One span per line, rebuilt only when that line changed. Struck
  // letters (letter + U+0336) get an X typed over them.
  function lineNode(line, idx) {
    var span = el("span", "ln"), seed = (cur ? cur.id : "new") + ":" + idx;
    var chars = Array.from(line), buf = "";
    function flushBuf() { if (buf) { span.appendChild(document.createTextNode(buf)); buf = ""; } }
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i];
      if (c === " ") { buf += c; continue; }
      if (c === C.STRIKE) { buf += c; continue; }          // stray stroke: keep the width
      flushBuf();
      var struck = chars[i + 1] === C.STRIKE;
      var s = el("span", "k i" + C.inkOf(seed, i, c) + (struck ? " x" : ""), struck ? c + C.STRIKE : c);
      if (struck) i++;
      span.appendChild(s);
    }
    flushBuf();
    return span;
  }

  function renderPaper() {
    var text = ta.value, lines = text.split("\n");
    var kids = ink.childNodes;
    // Layout: [line span, "\n", line span, "\n", …, line span, end marker]
    var nodes = [];
    for (var i = 0; i < lines.length; i++) {
      var node = inkCache[i] && inkCache[i].s === lines[i] ? inkCache[i].n : lineNode(lines[i], i);
      inkCache[i] = { s: lines[i], n: node };
      nodes.push(node);
    }
    inkCache.length = lines.length;
    var want = [];
    nodes.forEach(function (n, k) { if (k) want.push("\n"); want.push(n); });
    // Rebuild only from the first difference (typing changes the end).
    var j = 0, kept = 0;
    for (; j < want.length && j < kids.length; j++) {
      var w = want[j], k2 = kids[j];
      if (typeof w === "string" ? !(k2.nodeType === 3 && k2.nodeValue === "\n") : k2 !== w) break;
      kept++;
    }
    while (ink.childNodes.length > kept) ink.removeChild(ink.lastChild);
    for (; j < want.length; j++) {
      ink.appendChild(typeof want[j] === "string" ? document.createTextNode("\n") : want[j]);
    }
    var end = el("span", "end", "​");                 // keeps a trailing empty line tall
    end.id = "end";
    ink.appendChild(end);
    renderCounts();
  }

  function renderCounts() {
    var n = C.wordCount(ta.value), goal = cur ? cur.goal : 0;
    $("words").textContent = wordsLabel(n, goal);
    var bar = $("goal-bar");
    bar.hidden = !goal;
    if (goal) {
      var f = Math.min(1, n / goal);
      $("goal-fill").style.width = (f * 100).toFixed(1) + "%";
      bar.classList.toggle("done", f >= 1);
      bar.setAttribute("aria-valuenow", String(Math.min(n, goal)));
      bar.setAttribute("aria-valuemax", String(goal));
      if (f >= 1 && !goalTold[cur.id]) { goalTold[cur.id] = 1; if (lastAdded) live(t("goal.done")); }
    }
    $("title-view").textContent = cur ? C.displayTitle(cur, t("untitled")) : t("untitled");
  }
  var goalTold = {};

  function caretToEnd() {
    var n = ta.value.length;
    try { ta.setSelectionRange(n, n); } catch (e) {}
  }
  // The line being typed stays in the middle of the screen.
  function centerCaret(instant) {
    var desk = $("desk"), endN = $("end");
    if (!desk || !endN) return;
    var y;
    if (prefs.mode || ta.selectionStart >= ta.value.length) {
      y = endN.getBoundingClientRect().top - desk.getBoundingClientRect().top + desk.scrollTop;
    } else return;                                       // free mode, caret inside: the browser keeps it in view
    var top = Math.max(0, y - desk.clientHeight / 2 + 16);
    if (Math.abs(desk.scrollTop - top) >= 2) desk.scrollTop = top;   // the platen moves a line at a time
    if (!instant) requestAnimationFrame(function () { centerCaret(true); });   // after the browser shows the caret
  }

  // ---------- 5. Typing ----------
  var composing = false, lastAdded = "", fullTold = false;

  function commit(text) {
    var p = ensurePage();
    if (!p) { ta.value = committed; renderPaper(); return; }
    var clean = C.cleanText(text);
    if (clean.length < text.length && !fullTold) { fullTold = true; showToast(t("toast.full")); }
    if (clean !== ta.value) { ta.value = clean; if (prefs.mode) caretToEnd(); }
    if (clean === p.text) { renderPaper(); return; }
    var before = committed;
    committed = clean;
    p.text = clean;
    touch(p);
    saveSoon();
    renderPaper();
    centerCaret(false);
    sounds(before, clean);
    renderListSoon();
  }

  function onInput(e) {
    if (composing || (e && e.isComposing)) { renderPaper(); centerCaret(false); return; }
    if (prefs.mode) {
      var v = C.typewriterEdit(committed, ta.value);
      if (v !== ta.value) ta.value = v;
      caretToEnd();
      commit(v);
    } else {
      commit(ta.value);
    }
  }

  // Typewriter mode: the carriage only moves forwards.
  function holdCaret() {
    if (!prefs.mode || composing) return;
    var n = ta.value.length;
    if (ta.selectionStart !== n || ta.selectionEnd !== n) caretToEnd();
  }
  var BACK_KEYS = { ArrowLeft: 1, ArrowUp: 1, Home: 1, PageUp: 1 };
  function onKeyDown(e) {
    if (!prefs.mode || composing || e.isComposing) return;
    if (BACK_KEYS[e.key] || ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A"))) {
      e.preventDefault();
    }
  }

  // ---------- 6. Sounds (Web Audio, made on the spot) ----------
  var actx = null, noiseBuf = null;
  function audio() {
    if (!prefs.sound) return null;
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        actx = new AC();
        noiseBuf = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.3), actx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (actx.state === "suspended") actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function noise(a, at, dur, freq, q, vol) {
    var src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noiseBuf;
    bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bp); bp.connect(g); g.connect(a.destination);
    src.start(at, Math.random() * 0.2, dur + 0.02);
  }
  function tone(a, at, freq, dur, vol, type) {
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(a.destination);
    o.start(at); o.stop(at + dur + 0.02);
  }
  function soundKey() {
    var a = audio(); if (!a) return;
    var at = a.currentTime;
    noise(a, at, 0.035, 2200 + Math.random() * 1400, 1.4, 0.35);
    tone(a, at, 110 + Math.random() * 30, 0.05, 0.25, "triangle");
  }
  function soundBell() {
    var a = audio(); if (!a) return;
    var at = a.currentTime + 0.02;
    tone(a, at, 2093, 1.1, 0.12);
    tone(a, at, 3136, 0.7, 0.06);
  }
  function soundReturn() {
    var a = audio(); if (!a) return;
    var at = a.currentTime;
    for (var i = 0; i < 7; i++) noise(a, at + i * 0.035, 0.02, 3000, 2, 0.18);
    noise(a, at + 0.27, 0.08, 600, 0.8, 0.5);
    tone(a, at + 0.27, 90, 0.12, 0.35, "triangle");
  }
  function sounds(before, after) {
    var grew = after.length > before.length && after.indexOf(before) === 0;
    lastAdded = grew ? after.slice(before.length) : "";
    if (!prefs.sound) return;
    if (lastAdded.indexOf("\n") >= 0) { soundReturn(); return; }
    soundKey();
    var cols = columns();
    if (cols > BELL_LEFT * 2) {
      var c0 = C.column(before), c1 = C.column(after), mark = cols - BELL_LEFT;
      if (c0 < mark && c1 >= mark) soundBell();
    }
  }
  // Letters that fit on one line of the paper.
  function columns() {
    var probe = $("probe");
    var w = probe ? probe.getBoundingClientRect().width / 10 : 0;
    return w > 0 ? Math.floor(ink.clientWidth / w) : 0;
  }

  // ---------- 7. Panel ----------
  var listTimer = null;
  function renderListSoon() {
    clearTimeout(listTimer);
    listTimer = setTimeout(renderList, 700);
  }
  function renderList() {
    clearTimeout(listTimer);
    var host = $("pages"), list = C.newestFirst(data.pages);
    host.innerHTML = "";
    $("pages-empty").hidden = list.length > 0;
    $("pages-count").textContent = list.length ? String(list.length) : "";
    list.forEach(function (p) {
      var li = el("li", "row"), on = !!(cur && cur.id === p.id);
      if (on) li.classList.add("on");
      var open = el("button", "row-open");
      open.type = "button";
      var title = C.displayTitle(p, t("untitled"));
      if (on) open.setAttribute("aria-current", "true");
      open.appendChild(el("span", "row-title", title));
      open.appendChild(el("span", "row-desc", wordsLabel(C.wordCount(p.text), 0) + " · " + dateLabel(p.m)));
      open.addEventListener("click", function () { if (!cur || cur.id !== p.id) openPage(C.findPage(data, p.id)); else closePanelOnPhone(); });
      li.appendChild(open);
      var d = el("button", "icon-btn del-btn");
      d.type = "button";
      d.innerHTML = ICON.del;
      setLabel(d, t("item.delete") + ": " + title);
      d.addEventListener("click", function () { deletePage(p.id); });
      li.appendChild(d);
      host.appendChild(li);
    });
  }
  function dateLabel(ms) {
    try {
      var d = new Date(ms), now = new Date();
      var sameDay = d.toDateString() === now.toDateString();
      return sameDay ? d.toLocaleTimeString(LANG === "el" ? "el-GR" : "en-GB", { hour: "2-digit", minute: "2-digit" })
                     : d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "short" });
    } catch (e) { return ""; }
  }

  function renderFields() {
    var ti = $("title-in"), gi = $("goal-in");
    if (document.activeElement !== ti) ti.value = cur ? cur.title : "";
    if (document.activeElement !== gi) gi.value = cur && cur.goal ? String(cur.goal) : "";
    renderCounts();
  }
  function onTitle() {
    var v = $("title-in").value;
    if (!cur && !v.trim()) return;
    var p = ensurePage(); if (!p) return;
    p.title = C.normPage({ id: p.id, m: 0, title: v }).title;
    touch(p); saveSoon(); renderCounts(); renderListSoon();
  }
  function onGoal() {
    var raw = $("goal-in").value.trim(), n = raw ? parseInt(raw, 10) : 0;
    if (!isFinite(n) || n < 0) n = 0;
    n = Math.min(n, C.MAX_GOAL);
    if (!cur && !n) return;
    var p = ensurePage(); if (!p) return;
    if (p.goal === n) return;
    p.goal = n; touch(p); saveSoon(); renderCounts(); renderListSoon();
  }

  function renderPaperChips() {
    var host = $("papers");
    host.innerHTML = "";
    PAPERS.forEach(function (v) {
      var b = el("button", "chip", t("paper." + v));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", v === prefs.paper ? "true" : "false");
      if (v === prefs.paper) b.classList.add("on");
      b.addEventListener("click", function () {
        prefs.paper = v; savePrefs(); applyPaper(); renderPaperChips();
      });
      host.appendChild(b);
    });
  }
  function applyPaper() { document.body.setAttribute("data-paper", prefs.paper); }

  function renderToggles() {
    var mb = $("mode-btn"), sb = $("sound-btn");
    mb.setAttribute("aria-pressed", prefs.mode ? "true" : "false");
    setLabel(mb, prefs.mode ? t("mode.on") : t("mode.off"));
    sb.innerHTML = prefs.sound ? ICON.soundOn : ICON.soundOff;
    sb.setAttribute("aria-pressed", prefs.sound ? "true" : "false");
    setLabel(sb, prefs.sound ? t("sound.on") : t("sound.off"));
    document.body.classList.toggle("tw-mode", prefs.mode);
  }
  function toggleMode() {
    prefs.mode = !prefs.mode; savePrefs(); renderToggles();
    live(prefs.mode ? t("mode.on") : t("mode.off"));
    if (prefs.mode) { committed = ta.value; caretToEnd(); centerCaret(false); }
    ta.focus();
  }
  function toggleSound() {
    prefs.sound = !prefs.sound; savePrefs(); renderToggles();
    if (prefs.sound) soundKey();
  }

  // Panel: always there on a wide screen (can be hidden), a drawer on a phone.
  function phone() { return window.matchMedia("(max-width: 760px)").matches; }
  function setPanel(open) {
    document.body.classList.toggle("panel-open", open);
    $("pages-btn").setAttribute("aria-expanded", open ? "true" : "false");
    $("scrim").hidden = !(open && phone());
    if (!phone()) { prefs.panel = open; savePrefs(); }
  }
  function togglePanel() {
    var open = !document.body.classList.contains("panel-open");
    setPanel(open);
    if (open && phone()) { var first = $("panel").querySelector("button"); if (first) first.focus(); }
  }
  function closePanelOnPhone() { if (phone() && document.body.classList.contains("panel-open")) setPanel(false); }

  // Export: the kept text (struck letters left out).
  function exportText() { return C.keptText(ta.value).replace(/[ \t]+$/gm, ""); }
  function copyText() {
    var s = exportText();
    if (!s.trim()) { showToast(t("toast.empty")); return; }
    var done = function () { showToast(t("toast.copied")); }, fail = function () { showToast(t("toast.copyFail")); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(s).then(done, fail); return; }
    } catch (e) {}
    fail();
  }
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function downloadTxt() {
    var s = exportText();
    if (!s.trim()) { showToast(t("toast.empty")); return; }
    var blob = new Blob([s.replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" });
    var name = C.fileName(cur ? C.displayTitle(cur, "") : "");
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ blob: blob, filename: name, mime: "text/plain",
                     types: [{ description: "Text", accept: { "text/plain": [".txt"] } }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.saved")); });
      return;                       // cancel (ok=false) = silent exit
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(t("toast.saved"));
  }
  function printPage() {
    if (!ta.value.trim()) { showToast(t("toast.empty")); return; }
    try { window.print(); } catch (e) {}
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "typewriter", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    box.innerHTML = "";
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

  // ---------- 9. Keyboard + full screen ----------
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
      if (e.key === "Escape" && phone() && document.body.classList.contains("panel-open")) {
        e.preventDefault(); setPanel(false); $("pages-btn").focus();
      }
    });
  }

  // Full screen is asked for on the app's own window frame, so the
  // page fills the screen without the shell around it.
  function fsDoc() { try { return window.frameElement ? window.parent.document : document; } catch (e) { return document; } }
  function fsOn() { var d = fsDoc(); return !!(d.fullscreenElement || d.webkitFullscreenElement); }
  function toggleFs() {
    var d = fsDoc();
    try {
      if (fsOn()) {
        var x = d.exitFullscreen || d.webkitExitFullscreen;
        var p1 = x && x.call(d); if (p1 && p1.catch) p1.catch(function () {});
      } else {
        var node = window.frameElement || document.documentElement;
        var f = node.requestFullscreen || node.webkitRequestFullscreen;
        var p2 = f && f.call(node); if (p2 && p2.catch) p2.catch(function () {});
      }
    } catch (e) {}
  }
  function renderFs() {
    var b = $("fs-btn"), on = fsOn();
    b.innerHTML = on ? ICON.fsOff : ICON.fsOn;
    setLabel(b, on ? t("fs.off") : t("fs.on"));
    b.setAttribute("aria-pressed", on ? "true" : "false");
    setTimeout(function () { centerCaret(true); }, 120);
  }

  // ---------- 10. Sync slice + palette ----------
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
    api.registerSlice("typewriter", sliceGet, sliceSet, STORAGE_KEY, C.mergeTypewriter);
  }

  function sliceGet() { flush(); return C.mergeTypewriter(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.pages)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeTypewriter(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast on merge
    var id = cur ? cur.id : "", fresh = id ? C.findPage(data, id) : null;
    if (id && !fresh) {                              // deleted on another device
      cur = null; openPage(C.newestFirst(data.pages)[0] || null); return;
    }
    if (fresh) {
      cur = fresh;
      if (fresh.text !== ta.value && !composing) {
        var atEnd = ta.selectionStart >= ta.value.length;
        ta.value = committed = fresh.text;
        renderPaper();
        if (atEnd || prefs.mode) caretToEnd();
      }
    }
    renderFields(); renderList();
  }

  // ---------- 11. Wiring & boot ----------
  var ICON = {
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h9a2 2 0 0 1 2 2v13"/><rect x="4" y="7" width="12" height="14" rx="2"/></svg>',
    mode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="9" rx="2"/><path d="M7 11V6h10v5"/><path d="M7 15h.01M10 15h.01M13 15h.01M16 15h.01M9 18h6"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M16 9l5 5M21 9l-5 5"/></svg>',
    fsOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    fsOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
  };

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) {
      n.placeholder = t(n.getAttribute("data-i18n-ph"));
    });
    document.title = t("app.name") + " · orOS";
    $("pages-btn").innerHTML = ICON.pages; setLabel($("pages-btn"), t("btn.pages"));
    $("mode-btn").innerHTML = ICON.mode;
    $("close-panel").innerHTML = ICON.del; setLabel($("close-panel"), t("btn.closePanel"));
    $("new-btn").insertAdjacentHTML("afterbegin", ICON.plus);
    ta.setAttribute("aria-label", t("text.label"));
  }

  function wire() {
    ta.addEventListener("input", onInput);
    ta.addEventListener("compositionstart", function () { composing = true; });
    ta.addEventListener("compositionend", function () { composing = false; setTimeout(function () { onInput(null); }, 0); });
    ta.addEventListener("keydown", onKeyDown);
    ["select", "click", "keyup", "focus", "mouseup"].forEach(function (ev) { ta.addEventListener(ev, holdCaret); });
    document.addEventListener("selectionchange", function () { if (document.activeElement === ta) holdCaret(); });
    $("paper").addEventListener("click", function (e) { if (e.target !== ta) ta.focus(); });
    $("mode-btn").addEventListener("click", toggleMode);
    $("sound-btn").addEventListener("click", toggleSound);
    $("fs-btn").addEventListener("click", toggleFs);
    $("pages-btn").addEventListener("click", togglePanel);
    $("close-panel").addEventListener("click", function () { setPanel(false); $("pages-btn").focus(); });
    $("scrim").addEventListener("click", function () { setPanel(false); });
    $("new-btn").addEventListener("click", newPage);
    $("title-in").addEventListener("input", onTitle);
    $("goal-in").addEventListener("input", onGoal);
    $("copy-btn").addEventListener("click", copyText);
    $("txt-btn").addEventListener("click", downloadTxt);
    $("print-btn").addEventListener("click", printPage);
    var d = fsDoc();
    d.addEventListener("fullscreenchange", renderFs);
    d.addEventListener("webkitfullscreenchange", renderFs);
    window.addEventListener("resize", function () { centerCaret(true); });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
    wireKeyboard();
  }

  function boot() {
    ta = $("text");
    ink = $("ink");
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    applyPaper();
    renderToggles();
    renderPaperChips();
    renderFs();
    wire();
    registerSync();
    watchPalette();
    var start = (prefs.cur && C.findPage(data, prefs.cur)) || C.newestFirst(data.pages)[0] || null;
    setPanel(!phone() && prefs.panel);
    openPage(start);
    setTimeout(function () { try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); } centerCaret(true); }, 60);
  }

  boot();
})();
