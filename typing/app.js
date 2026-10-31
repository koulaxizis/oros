// ============================================================
// orOS Typing Tutor: the app inside the shell frame
// Boot order (OROS_BIBLE.md Part VI "Boot sequence"):
//   load → applyI18n → wire → registerSync → inheritPalette →
//   watchPalette → render → take a pending deep link.
// Input: a hidden textarea read through `input` / `compositionend`
// (never keydown alone), so dead keys (Greek tonos, dialytika) and
// phone keyboards give the final character. `keydown` only lights the
// physical key and notices a system keyboard in another language.
// User text: none in wave 1; lesson text goes in with textContent.
// ============================================================
(function () {
  "use strict";

  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    console.log("typing/app.js v" + (m ? m[1] : "?") + " boot");
  })();

  var APP_ID = "typing";
  var STORAGE_KEY = "oros-typing-data";
  var PREFS_KEY = "oros-typing-prefs";      // device-local {snd, osk}
  var DEV_KEY = "oros-typing-dev";          // device-local id of this device's rows
  var C = window.TypingCore, K = window.TypingLayouts, CO = window.TypingCourse;

  // ---------- 1. Language ----------
  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app.name": "Typing Tutor",
      "btn.back": "Back", "btn.stats": "Statistics", "btn.set": "Settings", "btn.restart": "Start again",
      "btn.test": "Speed test", "btn.home": "Lessons", "btn.again": "Again", "btn.next": "Next lesson",
      "btn.cancel": "Cancel", "btn.done": "Done", "btn.continue": "Continue: lesson {n}",
      "btn.start": "Start lesson 1", "btn.review": "Practise again",
      "today.min": "{n} of {g} minutes today", "today.done": "Goal reached: {n} minutes today",
      "streak": "{n} days in a row", "streak.one": "1 day in a row", "streak.none": "Practise a little every day.",
      "lay.hint": "Lessons for the {name} keyboard. Switch your computer's keyboard to the same language.",
      "grp.home": "Home row", "grp.top": "Top row", "grp.bottom": "Bottom row", "grp.more": "Capitals, numbers and signs",
      "les": "Lesson {n}", "les.review": "Review", "les.shift": "Capitals (Shift)", "les.final": "Final text",
      "les.stars": "{n} of 3 stars", "les.nostars": "Not done yet",
      "u.wpm": "wpm", "u.acc": "accuracy", "u.time": "time",
      "run.focus": "Click here and start typing",
      "run.test": "Speed test: {n} min",
      "run.next": "Next key: {k}, {f}",
      "run.space": "space",
      "f.lp": "left little finger", "f.lr": "left ring finger", "f.lm": "left middle finger", "f.li": "left index finger",
      "f.ri": "right index finger", "f.rm": "right middle finger", "f.rr": "right ring finger", "f.rp": "right little finger",
      "f.th": "thumb",
      "ban.layout": "Your keyboard is typing {got}, but this lesson is {want}. Switch the keyboard language (Windows: Win+Space, Linux: Super+Space, Android: Ctrl+Space).",
      "ban.phone": "Touch typing needs a real keyboard. Connect one, or practise with the screen keyboard.",
      "ban.phoneBtn": "Use the screen keyboard",
      "res.lesson": "Lesson {n} done", "res.test": "Speed test done",
      "res.0": "Below 90% accuracy. Slow down a little and try again.",
      "res.1": "Well done. For two stars: 95% accuracy and 15 wpm.",
      "res.2": "Very good. For three stars: 98% accuracy and 25 wpm.",
      "res.3": "Excellent!",
      "res.best": "A new best for this test.",
      "res.keys": "Keys that went wrong: {k}",
      "test.title": "Speed test", "test.hint": "Type common words for a while. Speed counts five characters as one word.",
      "test.1": "1 minute", "test.2": "2 minutes", "test.5": "5 minutes",
      "st.today": "Today", "st.streak": "Days in a row", "st.total": "All practice", "st.avg": "Speed, last 7 days",
      "st.best": "Best speed tests", "st.days": "Last 14 days", "st.keys": "Your keys",
      "st.keysHint": "Red keys go wrong more often, grey keys have no data yet.",
      "st.none": "Not yet", "st.min": "{n} min", "st.h": "{h} h {m} min",
      "st.weak": "{k}: {p}% wrong", "st.noWeak": "No key goes wrong often. Well done.",
      "st.day": "{d}: {m} min, {w} wpm",
      "set.title": "Settings", "set.lay": "Keyboard", "set.hint": "Key hints", "set.err": "Mistakes",
      "set.goal": "Daily goal (minutes)", "set.fs": "Text size", "set.device": "This device only",
      "set.snd": "Key sounds", "set.osk": "Use the screen keyboard (phones without a keyboard)",
      "set.reset": "Reset progress",
      "hint.auto": "When I hesitate", "hint.on": "Always", "hint.off": "Never (no keyboard)",
      "err.stop": "Stop until it is right", "err.go": "Go on, Backspace fixes",
      "fs.1": "Small", "fs.2": "Medium", "fs.3": "Large",
      "conf.reset": "Reset all lessons, statistics and records on every device? This cannot be undone.",
      "conf.resetBtn": "Reset", "toast.reset": "Progress reset",
      "full": "This device is out of storage space. The result was not saved."
    },
    el: {
      "app.name": "Τυφλό σύστημα",
      "btn.back": "Πίσω", "btn.stats": "Στατιστικά", "btn.set": "Ρυθμίσεις", "btn.restart": "Από την αρχή",
      "btn.test": "Τεστ ταχύτητας", "btn.home": "Μαθήματα", "btn.again": "Ξανά", "btn.next": "Επόμενο μάθημα",
      "btn.cancel": "Άκυρο", "btn.done": "Έτοιμο", "btn.continue": "Συνέχεια: μάθημα {n}",
      "btn.start": "Ξεκίνα το μάθημα 1", "btn.review": "Εξάσκηση ξανά",
      "today.min": "{n} από {g} λεπτά σήμερα", "today.done": "Ο στόχος έπιασε: {n} λεπτά σήμερα",
      "streak": "{n} μέρες στη σειρά", "streak.one": "1 μέρα στη σειρά", "streak.none": "Λίγη εξάσκηση κάθε μέρα κάνει τη διαφορά.",
      "lay.hint": "Μαθήματα για πληκτρολόγιο {name}. Γύρισε και το πληκτρολόγιο του υπολογιστή στην ίδια γλώσσα.",
      "grp.home": "Μεσαία σειρά", "grp.top": "Πάνω σειρά", "grp.bottom": "Κάτω σειρά", "grp.more": "Κεφαλαία, αριθμοί και σύμβολα",
      "les": "Μάθημα {n}", "les.review": "Επανάληψη", "les.shift": "Κεφαλαία (Shift)", "les.final": "Τελικό κείμενο",
      "les.stars": "{n} από 3 αστέρια", "les.nostars": "Δεν έγινε ακόμα",
      "u.wpm": "λ/λ", "u.acc": "ακρίβεια", "u.time": "χρόνος",
      "run.focus": "Πάτησε εδώ και άρχισε να γράφεις",
      "run.test": "Τεστ ταχύτητας: {n} λεπ.",
      "run.next": "Επόμενο πλήκτρο: {k}, {f}",
      "run.space": "διάστημα",
      "f.lp": "αριστερό μικρό δάχτυλο", "f.lr": "αριστερός παράμεσος", "f.lm": "αριστερός μέσος", "f.li": "αριστερός δείκτης",
      "f.ri": "δεξιός δείκτης", "f.rm": "δεξιός μέσος", "f.rr": "δεξιός παράμεσος", "f.rp": "δεξί μικρό δάχτυλο",
      "f.th": "αντίχειρας",
      "ban.layout": "Το πληκτρολόγιό σου γράφει {got}, ενώ το μάθημα είναι {want}. Άλλαξε τη γλώσσα του πληκτρολογίου (Windows: Win+Space ή Alt+Shift, Linux: Super+Space, Android: Ctrl+Space).",
      "ban.phone": "Το τυφλό σύστημα θέλει κανονικό πληκτρολόγιο. Σύνδεσε ένα ή κάνε εξάσκηση με το πληκτρολόγιο της οθόνης.",
      "ban.phoneBtn": "Πληκτρολόγιο οθόνης",
      "res.lesson": "Το μάθημα {n} τελείωσε", "res.test": "Το τεστ ταχύτητας τελείωσε",
      "res.0": "Ακρίβεια κάτω από 90%. Πήγαινε λίγο πιο αργά και δοκίμασε ξανά.",
      "res.1": "Μπράβο. Για δύο αστέρια: ακρίβεια 95% και 15 λ/λ.",
      "res.2": "Πολύ καλά. Για τρία αστέρια: ακρίβεια 98% και 25 λ/λ.",
      "res.3": "Εξαιρετικά!",
      "res.best": "Νέο ρεκόρ σε αυτό το τεστ.",
      "res.keys": "Πλήκτρα με λάθη: {k}",
      "test.title": "Τεστ ταχύτητας", "test.hint": "Γράψε συνηθισμένες λέξεις για λίγη ώρα. Η ταχύτητα μετράει πέντε χαρακτήρες για μία λέξη.",
      "test.1": "1 λεπτό", "test.2": "2 λεπτά", "test.5": "5 λεπτά",
      "st.today": "Σήμερα", "st.streak": "Μέρες στη σειρά", "st.total": "Συνολική εξάσκηση", "st.avg": "Ταχύτητα, τελευταίες 7 μέρες",
      "st.best": "Καλύτερα τεστ ταχύτητας", "st.days": "Τελευταίες 14 μέρες", "st.keys": "Τα πλήκτρα σου",
      "st.keysHint": "Τα κόκκινα πλήκτρα έχουν περισσότερα λάθη, τα γκρι δεν έχουν ακόμα στοιχεία.",
      "st.none": "Όχι ακόμα", "st.min": "{n} λεπ.", "st.h": "{h} ώ. {m} λεπ.",
      "st.weak": "{k}: {p}% λάθη", "st.noWeak": "Κανένα πλήκτρο δεν έχει συχνά λάθη. Μπράβο.",
      "st.day": "{d}: {m} λεπ., {w} λ/λ",
      "set.title": "Ρυθμίσεις", "set.lay": "Πληκτρολόγιο", "set.hint": "Βοήθεια πλήκτρων", "set.err": "Λάθη",
      "set.goal": "Ημερήσιος στόχος (λεπτά)", "set.fs": "Μέγεθος κειμένου", "set.device": "Μόνο σε αυτή τη συσκευή",
      "set.snd": "Ήχοι πλήκτρων", "set.osk": "Πληκτρολόγιο οθόνης (κινητά χωρίς πληκτρολόγιο)",
      "set.reset": "Μηδενισμός προόδου",
      "hint.auto": "Όταν διστάζω", "hint.on": "Πάντα", "hint.off": "Ποτέ (χωρίς πληκτρολόγιο)",
      "err.stop": "Σταματάω μέχρι να το βρω", "err.go": "Συνεχίζω, διορθώνω με Backspace",
      "fs.1": "Μικρό", "fs.2": "Μεσαίο", "fs.3": "Μεγάλο",
      "conf.reset": "Να μηδενιστούν όλα τα μαθήματα, τα στατιστικά και τα ρεκόρ σε όλες τις συσκευές; Δεν αναιρείται.",
      "conf.resetBtn": "Μηδενισμός", "toast.reset": "Η πρόοδος μηδενίστηκε",
      "full": "Ο χώρος αποθήκευσης της συσκευής γέμισε. Το αποτέλεσμα δεν αποθηκεύτηκε."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, APP_ID, LANG);

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) Object.keys(params).forEach(function (k) { s = s.split("{" + k + "}").join(String(params[k])); });
    return s;
  }
  var LOC = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
  function fmtNum(n) { try { return Number(n).toLocaleString(LOC); } catch (e) { return String(n); } }

  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app.name") + " · orOS";
  }

  // ---------- 2. Data: local first, then sync ----------
  var data = C.empty();
  var prefs = { snd: false, osk: false };
  var DEV = "";

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function load() {
    try { data = C.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch (e) { data = C.empty(); }
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") { prefs.snd = p.snd === true; prefs.osk = p.osk === true; }
    } catch (e) { /* defaults */ }
    try {
      DEV = localStorage.getItem(DEV_KEY) || "";
      if (!/^[a-z0-9]{1,12}$/.test(DEV)) {
        DEV = Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, "") || "d1";
        localStorage.setItem(DEV_KEY, DEV);
      }
    } catch (e) { DEV = DEV || "d1"; }
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, C.serialize(data)); return true; }
    catch (e) { toast(t("full")); return false; }
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* full */ } }
  function save(next) {
    data = next;
    if (!persist()) return;
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
  }
  function sliceGet() { return C.normalize(data); }
  function sliceSet(incoming) {
    var merged = C.merge(data, incoming);
    if (C.serialize(merged) === C.serialize(data)) return;
    data = merged;
    persist();
    if (!run) render();
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    try { api.registerSlice(APP_ID, sliceGet, sliceSet, STORAGE_KEY, C.merge); }
    catch (e) { /* the next boot registers again */ }
  }

  // The layout in use: the saved one, else the app language's.
  function lay() {
    if (data.set.lay) return data.set.lay;
    var base = String(LANG).slice(0, 2);
    return base === "el" ? "el" : base === "de" ? "de" : "en";
  }

  // ---------- 3. Palette (G3) ----------
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
  var ICON = {
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    stats: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    set: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    restart: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>'
  };
  function iconBtn(id, icon, label) {
    var b = $(id);
    b.innerHTML = ICON[icon];   // fixed markup written here, never user text
    b.setAttribute("aria-label", label);
    b.title = label;
  }

  var toastTimer = 0;
  function toast(msg) {
    var box = $("toast");
    box.textContent = msg;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3000);
  }
  function mmss(msTime) {
    var s = Math.max(0, Math.round(msTime / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function lessonNo(id) { return CO.indexOf(id) + 1; }
  function lessonTitle(id) {
    var L = CO.lesson(id);
    if (!L) return "";
    var name = L.fin ? t("les.final") : L.r ? t("les.review") : L.shift ? t("les.shift") : CO.label(lay(), id);
    return t("les", { n: lessonNo(id) }) + " · " + name;
  }
  function showLabel(ch) { return ch === " " ? t("run.space") : ch; }

  // ---------- 5. Screens ----------
  var screen = "home";
  function show(name) {
    screen = name;
    ["home", "run", "stats"].forEach(function (s) { $(s).hidden = s !== name; });
    $("back-btn").hidden = name === "home";
    $("lay-sel").hidden = name !== "home";
    $("stats-btn").hidden = name === "stats";
    document.body.setAttribute("data-screen", name);
  }
  function goHome() {
    stopRun();
    show("home");
    render();
  }

  // Home
  function nextLesson() {
    var ls = CO.lessons(), L = lay();
    for (var i = 0; i < ls.length; i++) {
      var p = C.progress(data, L, ls[i].id);
      if (!p || p.s < 1) return ls[i].id;
    }
    return "";
  }
  function renderHome() {
    var L = lay(), now = Date.now();
    var today = C.todayMs(data, now), goal = data.set.goal;
    var mins = Math.floor(today / 60000);
    $("today-min").textContent = mins >= goal ? t("today.done", { n: mins }) : t("today.min", { n: mins, g: goal });
    var st = C.streak(data, now);
    $("today-streak").textContent = st > 1 ? t("streak", { n: st }) : st === 1 ? t("streak.one") : t("streak.none");
    var frac = Math.min(1, today / (goal * 60000)), circ = 2 * Math.PI * 19;
    $("ring-fg").setAttribute("stroke-dasharray", (circ * frac).toFixed(1) + " " + circ.toFixed(1));
    var nx = nextLesson();
    var go = $("go-btn");
    go.textContent = !nx ? t("btn.review") : nx === "h1" && !C.progress(data, L, "h1") ? t("btn.start") : t("btn.continue", { n: lessonNo(nx) });
    go.dataset.lesson = nx || "f1";
    $("lay-hint").textContent = t("lay.hint", { name: K.get(L).name });

    var box = $("course");
    box.textContent = "";
    CO.GROUPS.forEach(function (g) {
      box.appendChild(el("h2", "grp", t("grp." + g)));
      var grid = el("div", "lessons");
      CO.lessons().filter(function (x) { return x.g === g; }).forEach(function (x) {
        var p = C.progress(data, L, x.id), s = p ? p.s : 0;
        var b = el("button", "lesson" + (x.id === nx ? " next" : "") + (s ? " done" : ""));
        b.type = "button";
        b.dataset.lesson = x.id;
        b.appendChild(el("span", "l-no", String(lessonNo(x.id))));
        var nm = x.fin ? t("les.final") : x.r ? t("les.review") : x.shift ? t("les.shift") : CO.label(L, x.id);
        b.appendChild(el("span", "l-keys" + (x.r || x.shift || x.fin ? " l-word" : ""), nm));
        var stars = el("span", "l-stars", "★★★".slice(0, s) + "☆☆☆".slice(0, 3 - s));
        b.appendChild(stars);
        b.setAttribute("aria-label", t("les", { n: lessonNo(x.id) }) + ", " + nm + ", " + (s ? t("les.stars", { n: s }) : t("les.nostars")));
        if (p && p.w) b.title = p.w + " " + t("u.wpm") + " · " + p.a + "%";
        grid.appendChild(b);
      });
      box.appendChild(grid);
    });
  }

  function render() {
    fillLaySelect($("lay-sel"));
    document.documentElement.setAttribute("data-fs", String(data.set.fs));
    if (screen === "home") renderHome();
    else if (screen === "stats") renderStats();
  }
  function fillLaySelect(sel) {
    var cur = lay();
    sel.textContent = "";
    K.LAYOUT_IDS.forEach(function (id) {
      var o = el("option", "", K.get(id).name);
      o.value = id;
      sel.appendChild(o);
    });
    sel.value = cur;
  }

  // ---------- 6. The screen keyboard ----------
  // Extra keys drawn for the shape only (they type nothing in a lesson).
  var EXTRA = {
    Backspace: "⌫", Tab: "⇥", CapsLock: "⇪", Enter: "↵", ShiftLeft: "⇧", ShiftRight: "⇧", Space: ""
  };
  // Key widths in key units.
  function rowsFor(L) {
    var R = K.get(L).rows, iso = K.get(L).iso;
    var r0 = R[0].map(function (c) { return [c, 1]; }).concat([["Backspace", 2]]);
    var r1 = [["Tab", 1.5]].concat(R[1].map(function (c) { return [c, c === "Backslash" ? 1.5 : 1]; }));
    if (iso) r1.push(["Enter", 1.5]);
    var r2 = [["CapsLock", 1.75]].concat(R[2].map(function (c) { return [c, 1]; }));
    r2.push(["Enter", iso ? 1.25 : 2.25]);
    var r3 = R[3].map(function (c) { return [c, c === "ShiftLeft" ? (iso ? 1.25 : 2.25) : c === "ShiftRight" ? 2.75 : 1]; });
    var r4 = [["Space", 6.25]];
    return [r0, r1, r2, r3, r4];
  }
  function buildKeyboard(box, L, small) {
    box.textContent = "";
    box.setAttribute("data-lay", L);
    rowsFor(L).forEach(function (row, ri) {
      var r = el("div", "k-row" + (ri === 4 ? " k-space" : ""));
      row.forEach(function (k) {
        var code = k[0], cap = K.cap(L, code);
        var key = el("div", "key");
        key.style.flexGrow = String(k[1]);
        key.dataset.code = code;
        var f = K.fingerOf(code);
        if (f) key.classList.add("f-" + f);
        else key.classList.add("k-mute");
        if (code === "KeyF" || code === "KeyJ") key.classList.add("bump");
        if (cap) {
          var lo = cap[0], hi = cap[1];
          var isLetter = lo && hi && lo !== hi && lo.toUpperCase() === hi;
          // the final sigma keeps its own shape (its capital is Σ, like the S key)
          if (isLetter) key.appendChild(el("span", "k-main", lo === "\u03c2" ? lo : hi));
          else {
            if (!small && hi) key.appendChild(el("span", "k-hi", hi));
            key.appendChild(el("span", "k-main", lo || ""));
          }
        } else if (EXTRA[code] !== undefined) {
          key.appendChild(el("span", "k-main", EXTRA[code]));
        }
        r.appendChild(key);
      });
      box.appendChild(r);
    });
  }
  function buildHands() {
    var box = $("hands");
    box.textContent = "";
    [["lp", "lr", "lm", "li", "th"], ["th", "ri", "rm", "rr", "rp"]].forEach(function (hand, h) {
      var hd = el("div", "hand " + (h ? "right" : "left"));
      hand.forEach(function (f) {
        var d = el("div", "finger f-" + f);
        d.dataset.f = f;
        hd.appendChild(d);
      });
      box.appendChild(hd);
    });
  }
  function lightKeys(strokes) {
    [].forEach.call(document.querySelectorAll("#kbd .key.next, #hands .finger.next"), function (n) { n.classList.remove("next"); });
    if (!strokes) return;
    strokes.forEach(function (s) {
      var k = document.querySelector('#kbd .key[data-code="' + s.code + '"]');
      if (k) k.classList.add("next");
      var f = K.fingerOf(s.code);
      [].forEach.call(document.querySelectorAll('#hands .finger[data-f="' + f + '"]'), function (n) {
        n.classList.add("next");
      });
      if (s.shift) {
        var sh = K.shiftFor(s.code);
        var sk = document.querySelector('#kbd .key[data-code="' + sh + '"]');
        if (sk) sk.classList.add("next");
        var sf = document.querySelector('#hands .finger[data-f="' + K.fingerOf(sh) + '"]');
        if (sf) sf.classList.add("next");
      }
    });
  }
  function pressFlash(code, bad) {
    var k = document.querySelector('#kbd .key[data-code="' + code + '"]');
    if (!k) return;
    var cls = bad ? "bad" : "hit";
    k.classList.add(cls);
    setTimeout(function () { k.classList.remove(cls); }, 160);
  }

  // ---------- 7. A run (lesson or speed test) ----------
  // run = { kind "lesson"|"test", id, min, text [chars], pos, marks [0 todo,1 right,2 fixed,3 wrong],
  //         errHere, chars, errors, keys {ch:[r,w,ms]}, t0, last, active ms, done }
  var run = null, tick = 0, hintTimer = 0, deadPending = false, mismatch = 0, sawKey = false;

  function startLesson(id) {
    if (!CO.lesson(id)) return;
    var seed = (Date.now() % 100000) + 1;
    beginRun({ kind: "lesson", id: id, text: CO.build(lay(), id, seed) });
  }
  function startTest(min) {
    var n = min === 5 ? 600 : min === 2 ? 260 : 140;
    beginRun({ kind: "test", min: min, text: CO.testText(lay(), (Date.now() % 100000) + 1, n) });
  }
  function beginRun(o) {
    closeDialogs();
    stopRun();
    run = {
      kind: o.kind, id: o.id || "", min: o.min || 0, text: Array.from(o.text.normalize("NFC")),
      pos: 0, marks: [], errHere: false, chars: 0, errors: 0, keys: {}, t0: 0, last: 0, active: 0, done: false
    };
    run.marks = run.text.map(function () { return 0; });
    show("run");
    $("run-name").textContent = run.kind === "test" ? t("run.test", { n: run.min }) : lessonTitle(run.id);
    var L = lay();
    buildKeyboard($("kbd"), L, false);
    buildHands();
    var hideKbd = data.set.hint === "off";
    $("kbd-wrap").hidden = hideKbd;
    drawText();
    updateMeters();
    mismatch = 0;
    hideBanner();
    if (!sawKey && !prefs.osk && coarse()) showBanner(t("ban.phone"), t("ban.phoneBtn"), function () {
      prefs.osk = true; savePrefs(); applyOsk(); hideBanner(); focusCap();
    });
    checkSystemLayout();
    applyOsk();
    focusCap();
    scheduleHint();
  }
  function stopRun() {
    clearInterval(tick); tick = 0;
    clearTimeout(hintTimer);
    run = null;
    lightKeys(null);
  }
  function coarse() { try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; } }
  function applyOsk() { $("cap").setAttribute("inputmode", prefs.osk ? "text" : "none"); }
  function focusCap() { try { $("cap").focus({ preventScroll: true }); } catch (e) { /* ok */ } }

  function drawText() {
    var box = $("text-in");
    box.textContent = "";
    var frag = document.createDocumentFragment();
    run.text.forEach(function (ch, i) {
      var s = el("span", "ch", ch);
      if (ch === " ") s.classList.add("sp");
      s.dataset.i = String(i);
      frag.appendChild(s);
    });
    box.appendChild(frag);
    paintPos();
  }
  function spanAt(i) { return $("text-in").children[i] || null; }
  function paintPos() {
    var cur = document.querySelector("#text-in .ch.cur");
    if (cur) cur.classList.remove("cur", "err");
    if (!run || run.pos >= run.text.length) return;
    var s = spanAt(run.pos);
    if (!s) return;
    s.classList.add("cur");
    if (run.errHere) s.classList.add("err");
    // keep the current line second from the top
    var view = $("text-view"), lh = s.offsetHeight || 30;
    var top = s.offsetTop - lh * 1.1;
    $("text-in").style.transform = "translateY(" + (-Math.max(0, top)) + "px)";
    if (view) view.setAttribute("data-pos", String(run.pos));
  }
  function markSpan(i) {
    var s = spanAt(i);
    if (!s) return;
    s.classList.remove("ok", "fix", "bad");
    var m = run.marks[i];
    if (m === 1) s.classList.add("ok");
    else if (m === 2) s.classList.add("fix");
    else if (m === 3) s.classList.add("bad");
  }

  function expected() { return run && run.pos < run.text.length ? run.text[run.pos] : ""; }
  function strokesNow() {
    var ch = expected();
    if (!ch) return null;
    var st = K.strokes(lay(), ch);
    if (!st) return null;
    if (deadPending && st.length > 1) return st.slice(1);
    return st;
  }
  function scheduleHint() {
    clearTimeout(hintTimer);
    if (!run || run.done) return;
    var mode = data.set.hint;
    if (mode === "off") { lightKeys(null); return; }
    if (mode === "on" || run.errHere || run.pos === 0 && run.kind === "lesson" && !run.t0) { lightKeys(strokesNow()); }
    else {
      lightKeys(null);
      hintTimer = setTimeout(function () { if (run) lightKeys(strokesNow()); }, 1500);
    }
    var ch = expected(), st = strokesNow();
    if (ch && st) $("live").textContent = t("run.next", { k: showLabel(ch), f: t("f." + K.fingerOf(st[st.length - 1].code)) });
  }

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function startClock() {
    if (run.t0) return;
    run.t0 = now();
    run.last = run.t0;
    tick = setInterval(onTick, 250);
  }
  function onTick() {
    if (!run || run.done) return;
    updateMeters();
    if (run.kind === "test" && now() - run.t0 >= run.min * 60000) finish();
  }
  function elapsed() {
    if (!run || !run.t0) return 0;
    return run.kind === "test" ? Math.min(now() - run.t0, run.min * 60000) : run.active;
  }
  function updateMeters() {
    if (!run) return;
    var ms = elapsed();
    $("m-wpm").textContent = String(C.wpm(run.chars, ms));
    $("m-acc").textContent = String(C.accuracy(run.chars, run.errors));
    $("m-time").textContent = run.kind === "test" ? mmss(run.min * 60000 - ms) : mmss(ms);
    var pct = run.kind === "test" ? (ms / (run.min * 60000)) : (run.pos / Math.max(1, run.text.length));
    $("run-fill").style.width = Math.round(100 * Math.min(1, pct)) + "%";
    $("run-bar").setAttribute("aria-valuenow", String(Math.round(100 * Math.min(1, pct))));
  }
  function keyStat(ch) { return run.keys[ch] || (run.keys[ch] = [0, 0, 0]); }

  // One typed character.
  function typeChar(ch) {
    if (!run || run.done || run.pos >= run.text.length) return;
    if (ch === "\n" || ch === "\r" || ch === "\t") return;
    startClock();
    var want = run.text[run.pos], tm = now();
    var gap = Math.min(5000, tm - run.last);   // a pause longer than 5 s does not count
    if (ch === want) {
      run.active += gap;
      run.last = tm;
      var ks = keyStat(want);
      ks[0]++; ks[2] += Math.round(gap);
      run.marks[run.pos] = run.errHere ? 2 : 1;
      run.chars++;
      markSpan(run.pos);
      var st = K.strokes(lay(), want);
      if (st) pressFlash(st[st.length - 1].code, false);
      click(false);
      run.errHere = false;
      run.pos++;
      if (run.pos >= run.text.length) { paintPos(); finish(); return; }
    } else {
      run.errors++;
      keyStat(want)[1]++;
      click(true);
      if (data.set.err === "go") {
        run.active += gap;
        run.last = tm;
        run.marks[run.pos] = 3;
        markSpan(run.pos);
        run.errHere = false;
        run.pos++;
        if (run.pos >= run.text.length) { paintPos(); finish(); return; }
      } else {
        run.errHere = true;
      }
    }
    paintPos();
    updateMeters();
    scheduleHint();
  }
  function backspace() {
    if (!run || run.done || data.set.err !== "go" || run.pos === 0) return;
    var i = run.pos - 1;
    if (run.marks[i] === 1 || run.marks[i] === 2) run.chars--;
    run.marks[i] = 0;
    markSpan(i);
    run.pos = i;
    paintPos();
    updateMeters();
    scheduleHint();
  }

  function finish() {
    if (!run || run.done) return;
    run.done = true;
    clearInterval(tick); tick = 0;
    clearTimeout(hintTimer);
    lightKeys(null);
    var ms = elapsed();
    if (run.kind === "lesson") ms = Math.max(ms, 1000);
    var L = lay(), rec = { lay: L, chars: run.chars, errors: run.errors, ms: ms, keys: run.keys };
    if (run.kind === "lesson") rec.lesson = run.id; else rec.test = run.min;
    var before = run.kind === "test" ? (data.best[L + "|" + run.min] || null) : null;
    if (run.chars > 0) save(C.record(data, rec, Date.now(), DEV));
    showResult(rec, before);
  }

  // Sound (device-local, off by default): a short tick, a low tone for a mistake.
  var actx = null;
  function click(bad) {
    if (!prefs.snd) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = bad ? "square" : "triangle";
      o.frequency.value = bad ? 140 : 1200;
      g.gain.setValueAtTime(bad ? 0.05 : 0.04, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + (bad ? 0.12 : 0.03));
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + (bad ? 0.13 : 0.04));
    } catch (e) { /* no audio */ }
  }

  // ---------- 8. Keyboard language checks ----------
  function langName(id) { return K.get(id).name; }
  function showBanner(text, btnText, onBtn) {
    $("banner-txt").textContent = text;
    var b = $("banner-btn");
    b.hidden = !btnText;
    b.textContent = btnText || "";
    b.onclick = onBtn || null;
    $("banner").hidden = false;
  }
  function hideBanner() { $("banner").hidden = true; }
  function layoutWarn(got) {
    showBanner(t("ban.layout", { got: langName(got), want: langName(lay()) }));
  }
  // Chromium can tell the system layout before the first key.
  function checkSystemLayout() {
    try {
      var kb = navigator.keyboard;
      if (!kb || typeof kb.getLayoutMap !== "function") return;
      kb.getLayoutMap().then(function (map) {
        if (!run) return;
        var g = K.guess("KeyA", map.get("KeyA"), false) || K.guess("KeyY", map.get("KeyY"), false);
        // "a" on KeyA fits en and de: tell them apart by KeyY
        if (g !== "el") g = K.guess("KeyY", map.get("KeyY"), false) || g;
        if (g && g !== lay()) layoutWarn(g);
      }).catch(function () { /* not allowed in this frame */ });
    } catch (e) { /* no API */ }
  }

  function onKeyDown(e) {
    if (!run) return;
    sawKey = true;
    if (!$("banner").hidden && $("banner-btn").textContent === t("ban.phoneBtn")) hideBanner();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Escape") { e.preventDefault(); goHome(); return; }
    if (e.code === "Backspace") { e.preventDefault(); backspace(); return; }
    if (e.code === "Enter" || e.code === "Tab") { e.preventDefault(); return; }
    if (e.key === "Dead") { deadPending = true; scheduleHint(); return; }
    if (typeof e.key === "string" && Array.from(e.key).length === 1) {
      // a press that fits other layouts but not this one counts; three
      // in a row show the banner, a press that fits this one clears it
      var fit = K.fits(e.code, e.key, e.shiftKey);
      if (fit.length && fit.indexOf(lay()) < 0) { if (++mismatch >= 3) layoutWarn(fit[0]); }
      else if (fit.length) { if (mismatch >= 3) hideBanner(); mismatch = 0; }
    }
  }
  function flushCap() {
    var cap = $("cap"), v = cap.value;
    if (!v) return;
    cap.value = "";
    deadPending = false;
    Array.from(v.normalize("NFC")).forEach(typeChar);
  }

  // ---------- 9. Result ----------
  function showResult(rec, before) {
    var w = C.wpm(rec.chars, rec.ms), a = C.accuracy(rec.chars, rec.errors);
    var isTest = !!rec.test;
    $("res-title").textContent = isTest ? t("res.test") : t("res.lesson", { n: lessonNo(rec.lesson) });
    var s = C.stars(w, a);
    $("res-stars").textContent = isTest ? "" : "★★★".slice(0, s) + "☆☆☆".slice(0, 3 - s);
    $("res-stars").hidden = isTest;
    $("res-wpm").textContent = String(w);
    $("res-acc").textContent = a + "%";
    $("res-time").textContent = mmss(rec.ms);
    var note = isTest ? "" : t("res." + s);
    if (isTest && rec.chars > 0 && (!before || w > before.w)) note = t("res.best");
    $("res-note").textContent = note;
    var bad = Object.keys(rec.keys).filter(function (c) { return rec.keys[c][1] > 0; })
      .sort(function (x, y) { return rec.keys[y][1] - rec.keys[x][1]; }).slice(0, 5).map(showLabel);
    $("res-keys").textContent = bad.length ? t("res.keys", { k: bad.join("  ") }) : "";
    var idx = isTest ? -1 : CO.indexOf(rec.lesson), ls = CO.lessons();
    var nxt = $("res-next");
    nxt.hidden = isTest || idx < 0 || idx >= ls.length - 1;
    nxt.dataset.lesson = !nxt.hidden ? ls[idx + 1].id : "";
    $("res-again").dataset.lesson = isTest ? "" : rec.lesson;
    $("res-again").dataset.min = isTest ? String(rec.test) : "";
    openDialog("dlg-result", (s >= 1 && !nxt.hidden) ? nxt : $("res-again"));
  }

  // ---------- 10. Statistics ----------
  function fmtDay(ymd) {
    var d = new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
    try { return d.toLocaleDateString(LOC, { weekday: "short", day: "numeric", month: "short" }); }
    catch (e) { return ymd; }
  }
  function fmtTotal(ms) {
    var m = Math.round(ms / 60000);
    return m >= 60 ? t("st.h", { h: Math.floor(m / 60), m: m % 60 }) : t("st.min", { n: m });
  }
  function tile(box, label, value) {
    var d = el("div", "tile");
    d.appendChild(el("b", "", value));
    d.appendChild(el("span", "", label));
    box.appendChild(d);
  }
  function renderStats() {
    var L = lay(), nowT = Date.now(), hist = C.history(data);
    var tiles = $("tiles");
    tiles.textContent = "";
    tile(tiles, t("st.today"), fmtTotal(C.todayMs(data, nowT)));
    tile(tiles, t("st.streak"), String(C.streak(data, nowT)));
    tile(tiles, t("st.total"), fmtTotal(hist.reduce(function (s, h) { return s + h.ms; }, 0)));
    var cut = C.ymd(nowT - 6 * 864e5), wk = hist.filter(function (h) { return h.day >= cut; });
    var wch = wk.reduce(function (s, h) { return s + h.ch; }, 0), wms = wk.reduce(function (s, h) { return s + h.ms; }, 0);
    tile(tiles, t("st.avg"), wms ? C.wpm(wch, wms) + " " + t("u.wpm") : t("st.none"));

    var best = $("best");
    best.textContent = "";
    [1, 2, 5].forEach(function (m) {
      var b = data.best[L + "|" + m];
      tile(best, t("test." + m), b ? b.w + " " + t("u.wpm") + " · " + b.a + "%" : t("st.none"));
    });

    var days = $("days");
    days.textContent = "";
    var byDay = {};
    hist.forEach(function (h) { byDay[h.day] = h; });
    var list = [], maxMs = 1;
    for (var i = 13; i >= 0; i--) {
      var d = C.ymd(nowT - i * 864e5), h = byDay[d] || { day: d, ms: 0, ch: 0 };
      list.push(h);
      maxMs = Math.max(maxMs, h.ms);
    }
    list.forEach(function (h) {
      var col = el("div", "day");
      var bar = el("div", "bar");
      bar.style.height = Math.round(100 * h.ms / maxMs) + "%";
      col.appendChild(bar);
      col.appendChild(el("span", "dl", fmtDay(h.day).replace(/,.*$/, "").slice(0, 3)));
      var label = t("st.day", { d: fmtDay(h.day), m: Math.round(h.ms / 60000), w: h.ms ? C.wpm(h.ch, h.ms) : 0 });
      col.title = label;
      col.setAttribute("aria-label", label);
      col.setAttribute("role", "img");
      days.appendChild(col);
    });

    // key heatmap: error share per key (all characters typed with it)
    var ks = C.keyStats(data, L), per = {};
    Object.keys(ks).forEach(function (ch) {
      var st = K.strokes(L, ch);
      if (!st) return;
      var code = st[st.length - 1].code, o = per[code] || (per[code] = { r: 0, w: 0 });
      o.r += ks[ch].r; o.w += ks[ch].w;
    });
    var heat = $("heat");
    buildKeyboard(heat, L, true);
    [].forEach.call(heat.querySelectorAll(".key"), function (k) {
      var o = per[k.dataset.code];
      k.className = k.className.replace(/\bf-\w+/g, "");
      if (!o || o.r + o.w < 5) { k.classList.add("h-none"); return; }
      var p = o.w / (o.r + o.w);
      k.classList.add(p >= 0.12 ? "h-3" : p >= 0.06 ? "h-2" : p >= 0.02 ? "h-1" : "h-0");
    });
    var weak = $("weak");
    weak.textContent = "";
    var rows = Object.keys(ks).filter(function (c) { return ks[c].r + ks[c].w >= 10 && ks[c].w > 0; })
      .map(function (c) { return { c: c, p: ks[c].w / (ks[c].r + ks[c].w) }; })
      .filter(function (x) { return x.p >= 0.04; })
      .sort(function (a, b) { return b.p - a.p; }).slice(0, 6);
    if (!rows.length) weak.appendChild(el("li", "hint", t("st.noWeak")));
    rows.forEach(function (x) { weak.appendChild(el("li", "", t("st.weak", { k: showLabel(x.c), p: Math.round(100 * x.p) }))); });
  }

  // ---------- 11. Dialogs ----------
  var lastFocus = null;
  function openDialog(id, focusEl) {
    lastFocus = document.activeElement;
    $("veil").hidden = false;
    [].forEach.call(document.querySelectorAll("#veil .dlg"), function (d) { d.hidden = d.id !== id; });
    var f = focusEl || $(id).querySelector("button, select, input");
    if (f) setTimeout(function () { f.focus(); }, 0);
  }
  function closeDialogs() {
    $("veil").hidden = true;
    [].forEach.call(document.querySelectorAll("#veil .dlg"), function (d) { d.hidden = true; });
  }
  function confirmBox(text, okText, onOk) {
    $("conf-txt").textContent = text;
    $("conf-yes").textContent = okText;
    $("conf-yes").onclick = function () { closeDialogs(); onOk(); };
    openDialog("dlg-confirm", $("conf-no"));
  }
  function openSettings() {
    fillLaySelect($("s-lay"));
    $("s-hint").value = data.set.hint;
    $("s-err").value = data.set.err;
    $("s-goal").value = String(data.set.goal);
    $("s-fs").value = String(data.set.fs);
    $("s-snd").checked = prefs.snd;
    $("s-osk").checked = prefs.osk;
    openDialog("dlg-set");
  }
  function setPref(patch) {
    save(C.setPrefs(data, patch, Date.now()));
    render();
  }

  // ---------- 12. Wiring ----------
  function wire() {
    iconBtn("back-btn", "back", t("btn.back"));
    iconBtn("stats-btn", "stats", t("btn.stats"));
    iconBtn("set-btn", "set", t("btn.set"));
    iconBtn("restart-btn", "restart", t("btn.restart"));

    $("back-btn").addEventListener("click", goHome);
    $("stats-btn").addEventListener("click", function () { stopRun(); show("stats"); renderStats(); });
    $("set-btn").addEventListener("click", openSettings);
    $("lay-sel").addEventListener("change", function () { setPref({ lay: this.value }); });
    $("go-btn").addEventListener("click", function () { startLesson(this.dataset.lesson); });
    $("test-btn").addEventListener("click", function () { openDialog("dlg-test"); });
    $("course").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".lesson");
      if (b) startLesson(b.dataset.lesson);
    });
    [].forEach.call(document.querySelectorAll("#dlg-test [data-min]"), function (b) {
      b.addEventListener("click", function () { startTest(+b.dataset.min); });
    });
    [].forEach.call(document.querySelectorAll(".dlg-close"), function (b) {
      b.addEventListener("click", function () { closeDialogs(); if (run) focusCap(); });
    });
    $("conf-no").addEventListener("click", closeDialogs);
    $("restart-btn").addEventListener("click", function () {
      if (!run) return;
      if (run.kind === "test") startTest(run.min); else startLesson(run.id);
    });
    $("res-home").addEventListener("click", function () { closeDialogs(); goHome(); });
    $("res-again").addEventListener("click", function () {
      if (this.dataset.min) startTest(+this.dataset.min); else startLesson(this.dataset.lesson);
    });
    $("res-next").addEventListener("click", function () { startLesson(this.dataset.lesson); });

    // settings
    $("s-lay").addEventListener("change", function () { setPref({ lay: this.value }); });
    $("s-hint").addEventListener("change", function () { setPref({ hint: this.value }); });
    $("s-err").addEventListener("change", function () { setPref({ err: this.value }); });
    $("s-fs").addEventListener("change", function () { setPref({ fs: +this.value }); });
    $("s-goal").addEventListener("change", function () {
      var v = Math.round(+this.value);
      if (v >= 1 && v <= 120) setPref({ goal: v }); else this.value = String(data.set.goal);
    });
    $("s-snd").addEventListener("change", function () { prefs.snd = this.checked; savePrefs(); });
    $("s-osk").addEventListener("change", function () { prefs.osk = this.checked; savePrefs(); applyOsk(); });
    $("s-reset").addEventListener("click", function () {
      confirmBox(t("conf.reset"), t("conf.resetBtn"), function () {
        save(C.resetProgress(data, Date.now()));
        toast(t("toast.reset"));
        render();
      });
    });

    // typing
    var cap = $("cap");
    var composing = false;
    cap.addEventListener("compositionstart", function () { composing = true; });
    cap.addEventListener("compositionend", function () { composing = false; flushCap(); });
    cap.addEventListener("input", function (e) { if (!composing && !e.isComposing) flushCap(); });
    cap.addEventListener("keydown", onKeyDown);
    cap.addEventListener("blur", function () { if (run && !run.done && $("veil").hidden) $("focus-veil").hidden = false; });
    cap.addEventListener("focus", function () { $("focus-veil").hidden = true; });
    $("board").addEventListener("pointerdown", function (e) { if (run) { e.preventDefault(); focusCap(); } });

    // Contract Β: Ctrl+Alt+Shift belongs to the shell.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null; try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // App keys (e.code)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.altKey && e.shiftKey) return;
      if (!$("veil").hidden) {
        if (e.code === "Escape") {
          e.preventDefault();
          var resOpen = !$("dlg-result").hidden;
          closeDialogs();
          if (resOpen) goHome(); else if (run) focusCap();
        }
        return;
      }
      if (e.target === $("cap")) return;
      if (screen === "run" && run && !e.ctrlKey && !e.metaKey && !e.altKey && e.code !== "Tab") {
        // a key while the field lost focus: take it back and let the key through
        focusCap();
      } else if (screen !== "home" && e.code === "Escape") { e.preventDefault(); goHome(); }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden" && run && run.kind === "test" && !run.done && run.t0) finish();
    });
  }

  // ---------- 13. Deep link: {lesson} | {test: 1|2|5} | {stats: 1} ----------
  window.__orosOpenAt = function (target) {
    if (!target || typeof target !== "object") return;
    if (typeof target.lesson === "string" && CO.lesson(target.lesson)) startLesson(target.lesson);
    else if ([1, 2, 5].indexOf(target.test) >= 0) startTest(target.test);
    else if (target.stats) { stopRun(); show("stats"); renderStats(); }
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

  // ---------- 14. Boot ----------
  function boot() {
    load();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    show("home");
    render();
    takePending();
  }
  boot();
})();
