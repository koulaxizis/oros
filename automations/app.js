// ============================================================
// orOS Automations — the app inside the shell frame (wave A1)
// The rules live in the shell (automations/host.js owns the synced
// slice and runs them on the clock): this page reads and saves them
// through window.parent.orosAutomations (R8, guarded). Opened with
// ?standalone the page keeps its rules in localStorage only and says
// that they run only inside orOS.
// User text goes in with textContent, never innerHTML.
// ============================================================
(function () {
  "use strict";

  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    console.log("automations/app.js v" + (m ? m[1] : "?") + " boot");
  })();

  var APP_ID = "automations";
  var STORAGE_KEY = "oros-automations-data";
  var C = window.OrosAutoCore;

  // ---------- 1. Language ----------
  var STR = {
    en: {
      "app.name": "Automations",
      "btn.new": "New rule", "btn.templates": "Ready-made", "btn.close": "Close", "btn.cancel": "Cancel",
      "btn.save": "Save", "btn.del": "Delete", "btn.test": "Try it now", "btn.addAct": "Add step",
      "btn.remove": "Remove step", "btn.do": "Open in {app}", "btn.use": "Use",
      "standalone": "Opened outside orOS: rules are saved, but they run only inside orOS.",
      "sec.rules": "My rules", "sec.log": "Recent runs on this device",
      "empty": "No rules yet. A rule says when something happens and what orOS does then. Start from a ready-made one or make your own.",
      "log.empty": "Nothing has run yet.",
      "tpl.title": "Ready-made rules", "tpl.hint": "Pick one: you can change it before you save it.",
      "ed.title": "Rule", "ed.new": "New rule",
      "f.name": "Name", "f.name.ph": "For example: Monday plan", "f.when": "When", "f.days": "Days",
      "f.md": "Day of the month", "f.date": "Date", "f.at": "Time", "f.do": "Then", "f.addAct": "Add a step",
      "f.on": "On",
      "w.day": "Every day or on some days", "w.month": "Every month", "w.year": "Every year", "w.once": "Once",
      "w.open": "When orOS opens (once a day)", "md.last": "The last day",
      "ed.safe": "A notice shows by itself. Every other step opens its app filled in, and nothing is saved there until you save it.",
      "ed.ph": "In texts, {date}, {weekday}, {month} and {year} become the day of the run.",
      "a.notify": "Show a notice", "a.todo": "Add tasks to To-Do", "a.event": "Add an event to Calendar",
      "a.note": "Write a note", "a.mail": "Write an e-mail", "a.budget": "Add to Budget", "a.open": "Open an app",
      "a.timer": "Start a timer", "a.ask": "Ask the Assistant",
      "x.text": "Text", "x.items": "Tasks, one per line", "x.newList": "In a new list named (optional)",
      "x.title": "Title", "x.off": "Days after the run", "x.start": "Start time (optional)", "x.to": "To (optional)",
      "x.subject": "Subject", "x.body": "Message", "x.kind": "Kind", "x.out": "Expense", "x.in": "Income",
      "x.amount": "Amount", "x.note": "Note", "x.app": "App", "x.min": "Minutes", "x.label": "Label",
      "x.question": "Question",
      "err.name": "Give the rule a name.", "err.acts": "Add at least one step and fill it in.",
      "err.date": "Pick a date.", "err.full": "This device is out of storage space. The change was not saved.",
      "saved": "Saved", "deleted": "Deleted", "undo": "Undo", "on": "On", "off": "Off",
      "next": "Next: {when}", "never": "Will not run again", "needs": "Needs {app}, which is not installed here",
      "run.notice": "Notice: {text}", "run.at": "Run of {when}", "run.none": "This rule has no other step.",
      "log.sent": "Ran", "log.late": "Ran late", "log.off": "Notices are off", "log.skip": "Skipped: an app is missing",
      "log.run": "You opened it", "gone": "This rule was deleted.",
      "conf.del": "Delete this rule?"
    },
    el: {
      "app.name": "Αυτοματισμοί",
      "btn.new": "Νέος κανόνας", "btn.templates": "Έτοιμοι", "btn.close": "Κλείσιμο", "btn.cancel": "Άκυρο",
      "btn.save": "Αποθήκευση", "btn.del": "Διαγραφή", "btn.test": "Δοκίμασέ το τώρα", "btn.addAct": "Προσθήκη βήματος",
      "btn.remove": "Αφαίρεση βήματος", "btn.do": "Άνοιγμα στο {app}", "btn.use": "Χρήση",
      "standalone": "Άνοιξε έξω από το orOS: οι κανόνες αποθηκεύονται, αλλά τρέχουν μόνο μέσα στο orOS.",
      "sec.rules": "Οι κανόνες μου", "sec.log": "Πρόσφατες εκτελέσεις σε αυτή τη συσκευή",
      "empty": "Δεν υπάρχουν κανόνες ακόμα. Ένας κανόνας λέει πότε συμβαίνει κάτι και τι κάνει τότε το orOS. Ξεκίνα από έναν έτοιμο ή φτιάξε τον δικό σου.",
      "log.empty": "Δεν έχει τρέξει τίποτα ακόμα.",
      "tpl.title": "Έτοιμοι κανόνες", "tpl.hint": "Διάλεξε έναν: μπορείς να τον αλλάξεις πριν τον αποθηκεύσεις.",
      "ed.title": "Κανόνας", "ed.new": "Νέος κανόνας",
      "f.name": "Όνομα", "f.name.ph": "Για παράδειγμα: Πρόγραμμα Δευτέρας", "f.when": "Πότε", "f.days": "Μέρες",
      "f.md": "Μέρα του μήνα", "f.date": "Ημερομηνία", "f.at": "Ώρα", "f.do": "Τότε", "f.addAct": "Πρόσθεσε βήμα",
      "f.on": "Ενεργός",
      "w.day": "Κάθε μέρα ή κάποιες μέρες", "w.month": "Κάθε μήνα", "w.year": "Κάθε χρόνο", "w.once": "Μία φορά",
      "w.open": "Όταν ανοίγει το orOS (μία φορά τη μέρα)", "md.last": "Η τελευταία μέρα",
      "ed.safe": "Η ειδοποίηση εμφανίζεται μόνη της. Κάθε άλλο βήμα ανοίγει την εφαρμογή του συμπληρωμένη και δεν αποθηκεύεται τίποτα εκεί πριν το αποθηκεύσεις εσύ.",
      "ed.ph": "Στα κείμενα, τα {date}, {weekday}, {month} και {year} γίνονται η μέρα της εκτέλεσης.",
      "a.notify": "Εμφάνιση ειδοποίησης", "a.todo": "Εργασίες στο To-Do", "a.event": "Γεγονός στο Ημερολόγιο",
      "a.note": "Νέα σημείωση", "a.mail": "Νέο e-mail", "a.budget": "Καταχώριση στον Προϋπολογισμό", "a.open": "Άνοιγμα εφαρμογής",
      "a.timer": "Έναρξη χρονομέτρου", "a.ask": "Ερώτηση στον Βοηθό",
      "x.text": "Κείμενο", "x.items": "Εργασίες, μία σε κάθε γραμμή", "x.newList": "Σε νέα λίστα με όνομα (προαιρετικό)",
      "x.title": "Τίτλος", "x.off": "Μέρες μετά την εκτέλεση", "x.start": "Ώρα έναρξης (προαιρετικό)", "x.to": "Προς (προαιρετικό)",
      "x.subject": "Θέμα", "x.body": "Μήνυμα", "x.kind": "Είδος", "x.out": "Έξοδο", "x.in": "Έσοδο",
      "x.amount": "Ποσό", "x.note": "Σημείωση", "x.app": "Εφαρμογή", "x.min": "Λεπτά", "x.label": "Ετικέτα",
      "x.question": "Ερώτηση",
      "err.name": "Δώσε ένα όνομα στον κανόνα.", "err.acts": "Πρόσθεσε τουλάχιστον ένα βήμα και συμπλήρωσέ το.",
      "err.date": "Διάλεξε ημερομηνία.", "err.full": "Ο χώρος αποθήκευσης της συσκευής γέμισε. Η αλλαγή δεν αποθηκεύτηκε.",
      "saved": "Αποθηκεύτηκε", "deleted": "Διαγράφηκε", "undo": "Αναίρεση", "on": "Ενεργός", "off": "Ανενεργός",
      "next": "Επόμενη: {when}", "never": "Δεν θα ξανατρέξει", "needs": "Χρειάζεται το {app}, που δεν είναι εγκατεστημένο εδώ",
      "run.notice": "Ειδοποίηση: {text}", "run.at": "Εκτέλεση της {when}", "run.none": "Αυτός ο κανόνας δεν έχει άλλο βήμα.",
      "log.sent": "Έτρεξε", "log.late": "Έτρεξε με καθυστέρηση", "log.off": "Οι ειδοποιήσεις είναι κλειστές", "log.skip": "Παραλείφθηκε: λείπει εφαρμογή",
      "log.run": "Το άνοιξες", "gone": "Αυτός ο κανόνας διαγράφηκε.",
      "conf.del": "Διαγραφή αυτού του κανόνα;"
    }
  };
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();
  var BASE = LANG;                                 // the core's words (a pack language too)
  if (window.orosI18n) { window.orosI18n.table(STR, APP_ID, LANG); window.orosI18n.table(C.STRINGS, APP_ID, LANG); }
  function t(k, o) {
    var s = (STR[LANG] && STR[LANG][k]) || STR.en[k] || k;
    return o ? s.replace(/\{(\w+)\}/g, function (all, n) { return o[n] !== undefined ? o[n] : all; }) : s;
  }
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) { n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria"))); });
    document.title = t("app.name") + " · orOS";
  }

  // ---------- 2. The shell side ----------
  function host() {
    try { var h = window.parent && window.parent !== window ? window.parent.orosAutomations : null; return h || null; }
    catch (e) { return null; }
  }
  function rules() {
    var h = host();
    if (h) { try { return C.normalize(h.rules()); } catch (e) {} }
    try { return C.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch (e) { return C.empty(); }
  }
  function save(next) {
    var h = host();
    if (h) return h.save(next) !== false;
    try { localStorage.setItem(STORAGE_KEY, C.serialize(next)); return true; } catch (e) { return false; }
  }
  function installed() {
    var h = host();
    if (h) { try { return h.installed(); } catch (e) {} }
    return [];
  }
  function appName(id) {
    var h = host();
    if (h) { try { return h.appName(id); } catch (e) {} }
    return id;
  }

  // ---------- 3. Palette (G3) ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--accent-ink", "--panel-bg", "--border", "--danger"];
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
  var toastTimer = 0;
  function toast(msg, undoFn) {
    var box = $("toast");
    box.textContent = msg;
    if (undoFn) {
      var b = el("button", "chip small", t("undo"));
      b.type = "button";
      b.addEventListener("click", function () { box.classList.remove("show"); undoFn(); });
      box.appendChild(document.createTextNode(" "));
      box.appendChild(b);
    }
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, undoFn ? 6000 : 3000);
  }
  function fmtTime(ms) {
    var d = new Date(ms);
    try {
      return d.toLocaleString(LANG, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch (e) { return d.toString(); }
  }
  function openDlg(d) { if (!d.open) d.showModal(); }
  function closeDlg(d) { if (d.open) d.close(); }

  // ---------- 5. List ----------
  function render() {
    var data = rules(), list = $("list"), apps = installed(), now = Date.now();
    list.textContent = "";
    data.rules.forEach(function (r) {
      var li = el("li", r.on ? "" : "off");
      li.dataset.id = r.id;
      var main = el("button", "rule");
      main.type = "button";
      main.appendChild(el("span", "name", r.name || C.whenText(r.when, BASE)));
      main.appendChild(el("span", "sub", C.whenText(r.when, BASE) + " → " +
        r["do"].map(function (a) { return a.a === "notify" ? t("a.notify").toLowerCase() : C.actText(a, BASE, appName); }).join(", ")));
      var missing = "";
      r["do"].forEach(function (a) { var n = C.needs(a); if (n && apps.length && apps.indexOf(n) < 0 && !missing) missing = n; });
      if (missing) main.appendChild(el("span", "sub warn", t("needs", { app: missing })));
      else if (r.on && r.when.t !== "open") {
        var nx = C.nextAt(r.when, now);
        main.appendChild(el("span", "sub dim", nx ? t("next", { when: fmtTime(nx) }) : t("never")));
      }
      main.addEventListener("click", function () { edit(r.id); });
      var swBox = el("label", "swbox");
      var sw = el("input");
      sw.type = "checkbox";
      sw.checked = r.on;
      sw.className = "switch";
      swBox.appendChild(sw);
      sw.setAttribute("aria-label", (r.name || "") + ": " + t("f.on"));
      sw.addEventListener("change", function () {
        if (!save(C.setOn(rules(), r.id, sw.checked, Date.now()))) toast(t("err.full"));
        render();
      });
      li.appendChild(main);
      li.appendChild(swBox);
      list.appendChild(li);
    });
    $("empty").hidden = data.rules.length > 0;
    renderLog();
  }
  function renderLog() {
    var h = host(), box = $("log"), items = [];
    if (h) { try { items = h.log(); } catch (e) { items = []; } }
    box.textContent = "";
    items.slice(0, 20).forEach(function (x) {
      var li = el("li");
      li.appendChild(el("span", "name", x.n || "—"));
      li.appendChild(el("span", "sub dim", fmtTime(x.at) + " · " + t("log." + (x.w || "sent"))));
      box.appendChild(li);
    });
    $("log-empty").hidden = items.length > 0;
  }

  // ---------- 6. Templates ----------
  function showTemplates() {
    var ul = $("tpl-list");
    ul.textContent = "";
    C.templates(BASE).forEach(function (tp) {
      var li = el("li");
      var b = el("button", "rule");
      b.type = "button";
      b.appendChild(el("span", "name", tp.name));
      b.appendChild(el("span", "sub", C.whenText(C.cleanWhen(tp.rule.when), BASE)));
      b.addEventListener("click", function () { closeDlg($("tpl-dlg")); edit(null, tp.rule); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    openDlg($("tpl-dlg"));
  }

  // ---------- 7. Editor ----------
  var editing = null;          // { id, acts: [action draft] }
  var WD_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function actionChoices() {
    var apps = installed();
    return C.ACTIONS.filter(function (a) {
      var need = a === "open" ? "" : C.needs({ a: a });
      return !need || !apps.length || apps.indexOf(need) >= 0;
    });
  }
  function openableApps() {
    return installed().filter(function (id) { return !C.BLOCKED_APPS[id] && id !== APP_ID; })
      .map(function (id) { return { id: id, name: appName(id) }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, LANG); });
  }
  function buildStatic() {
    var wd = $("wd-row");
    WD_ORDER.forEach(function (n) {
      var lab = el("label", "wdbox");
      var cb = el("input");
      cb.type = "checkbox";
      cb.value = String(n);
      lab.appendChild(cb);
      lab.appendChild(el("span", "", C.STRINGS[LANG] && C.STRINGS[LANG]["ws." + n] || C.STRINGS.en["ws." + n]));
      wd.appendChild(lab);
    });
    var md = $("f-md");
    for (var i = 1; i <= 31; i++) md.appendChild(new Option(String(i), String(i)));
    md.appendChild(new Option(t("md.last"), "-1"));
  }
  function fillAddSelect() {
    var sel = $("f-add");
    sel.textContent = "";
    actionChoices().forEach(function (a) { sel.appendChild(new Option(t("a." + a), a)); });
  }
  function showWhen() {
    var k = $("f-when").value;
    $("wd-row").hidden = k !== "day";
    $("md-row").hidden = k !== "month";
    $("date-row").hidden = k !== "year" && k !== "once";
    $("at-row").hidden = k === "open";
    $("f-at").required = k !== "open";
  }

  function edit(id, preset) {
    var r = id ? C.find(rules(), id) : null;
    var src = r || preset || { name: "", on: true, when: { t: "day", at: "09:00", wd: [] }, "do": [{ a: "notify", text: "" }] };
    editing = { id: r ? r.id : null, acts: JSON.parse(JSON.stringify(src["do"] || [])) };
    $("ed-h").textContent = r ? t("ed.title") : t("ed.new");
    $("f-name").value = src.name || "";
    var w = src.when || { t: "day" };
    $("f-when").value = w.t;
    $("f-at").value = w.at || "09:00";
    [].forEach.call($("wd-row").querySelectorAll("input"), function (cb) {
      cb.checked = Array.isArray(w.wd) && w.wd.indexOf(+cb.value) >= 0;
    });
    $("f-md").value = String(w.md || 1);
    var now = new Date();
    $("f-date").value = w.t === "once" ? w.date :
      w.t === "year" ? now.getFullYear() + "-" + w.date : C.ymdOf(Date.now());
    $("f-on").checked = src.on !== false;
    $("ed-del").hidden = !r;
    $("ed-err").hidden = true;
    fillAddSelect();
    showWhen();
    renderActs();
    openDlg($("ed-dlg"));
    $("f-name").focus();
  }

  function field(box, label, input) {
    var lab = el("label", "fld");
    lab.appendChild(el("span", "", label));
    lab.appendChild(input);
    box.appendChild(lab);
    return input;
  }
  function textIn(v, max, type) {
    var i = el("input");
    i.type = type || "text";
    if (max) i.maxLength = max;
    i.value = v === undefined || v === null ? "" : String(v);
    return i;
  }
  function area(v, max, rows) {
    var a = el("textarea");
    a.maxLength = max;
    a.rows = rows || 3;
    a.value = v || "";
    return a;
  }
  function renderActs() {
    var ul = $("acts");
    ul.textContent = "";
    editing.acts.forEach(function (a, i) {
      var li = el("li", "act");
      var head = el("div", "row");
      head.appendChild(el("strong", "grow", t("a." + a.a)));
      var rm = el("button", "chip small del", "×");
      rm.type = "button";
      rm.setAttribute("aria-label", t("btn.remove"));
      rm.addEventListener("click", function () { editing.acts.splice(i, 1); renderActs(); });
      head.appendChild(rm);
      li.appendChild(head);
      var set = function (k) { return function (ev) { a[k] = ev.target.value; }; };
      var inp;
      if (a.a === "notify") { inp = field(li, t("x.text"), area(a.text, 300, 2)); inp.addEventListener("input", set("text")); }
      else if (a.a === "todo") {
        inp = field(li, t("x.items"), area((a.items || []).join("\n"), 10000, 4));
        inp.addEventListener("input", function (ev) { a.items = ev.target.value.split("\n"); });
        inp = field(li, t("x.newList"), textIn(a.newList, 60)); inp.addEventListener("input", set("newList"));
      } else if (a.a === "event") {
        inp = field(li, t("x.title"), textIn(a.title, 200)); inp.addEventListener("input", set("title"));
        inp = field(li, t("x.off"), textIn(a.off || 0, 0, "number")); inp.min = "0"; inp.max = "365";
        inp.addEventListener("input", function (ev) { a.off = Math.floor(+ev.target.value) || 0; });
        inp = field(li, t("x.start"), textIn(a.start, 0, "time")); inp.addEventListener("input", set("start"));
      } else if (a.a === "note") {
        inp = field(li, t("x.title"), textIn(a.title, 120)); inp.addEventListener("input", set("title"));
        inp = field(li, t("x.text"), area(a.text, 2000, 4)); inp.addEventListener("input", set("text"));
      } else if (a.a === "mail") {
        inp = field(li, t("x.to"), textIn(a.to, 320, "email")); inp.addEventListener("input", set("to"));
        inp = field(li, t("x.subject"), textIn(a.subject, 200)); inp.addEventListener("input", set("subject"));
        inp = field(li, t("x.body"), area(a.body, 2000, 4)); inp.addEventListener("input", set("body"));
      } else if (a.a === "budget") {
        var k = el("select");
        k.appendChild(new Option(t("x.out"), "o"));
        k.appendChild(new Option(t("x.in"), "i"));
        k.value = a.k === "i" ? "i" : "o";
        field(li, t("x.kind"), k).addEventListener("change", set("k"));
        inp = field(li, t("x.amount"), textIn(a.amount ? (a.amount / 100).toFixed(2) : "", 0, "number"));
        inp.min = "0.01"; inp.step = "0.01"; inp.inputMode = "decimal";
        inp.addEventListener("input", function (ev) { a.amount = Math.round(parseFloat(String(ev.target.value).replace(",", ".")) * 100) || 0; });
        inp = field(li, t("x.note"), textIn(a.note, 200)); inp.addEventListener("input", set("note"));
      } else if (a.a === "open") {
        var s = el("select");
        openableApps().forEach(function (x) { s.appendChild(new Option(x.name, x.id)); });
        if (a.app && !s.querySelector('option[value="' + a.app.replace(/[^a-z0-9]/g, "") + '"]')) s.appendChild(new Option(a.app, a.app));
        if (a.app) s.value = a.app; else a.app = s.value;
        field(li, t("x.app"), s).addEventListener("change", set("app"));
      } else if (a.a === "timer") {
        inp = field(li, t("x.min"), textIn(a.min || 25, 0, "number")); inp.min = "1"; inp.max = "6000";
        inp.addEventListener("input", function (ev) { a.min = Math.floor(+ev.target.value) || 0; });
        inp = field(li, t("x.label"), textIn(a.label, 40)); inp.addEventListener("input", set("label"));
      } else if (a.a === "ask") {
        inp = field(li, t("x.question"), area(a.text, 2000, 3)); inp.addEventListener("input", set("text"));
      }
      ul.appendChild(li);
    });
  }

  function draft() {
    var k = $("f-when").value, at = $("f-at").value, when;
    if (k === "day") {
      when = { t: "day", at: at, wd: [].filter.call($("wd-row").querySelectorAll("input"), function (c) { return c.checked; })
        .map(function (c) { return +c.value; }) };
    } else if (k === "month") when = { t: "month", at: at, md: +$("f-md").value };
    else if (k === "year") when = { t: "year", at: at, date: String($("f-date").value).slice(5) };
    else if (k === "once") when = { t: "once", at: at, date: $("f-date").value };
    else when = { t: "open" };
    var r = { name: $("f-name").value.trim(), on: $("f-on").checked, when: when };
    if (editing.id) r.id = editing.id;
    r["do"] = editing.acts;
    return r;
  }
  function check(r) {
    if (!r.name) return t("err.name");
    if ((r.when.t === "year" || r.when.t === "once") && !C.cleanWhen(r.when)) return t("err.date");
    var bad = r["do"].some(function (a) { return !C.cleanAction(a); });
    if (!r["do"].length || bad) return t("err.acts");
    return "";
  }
  function onSave(ev) {
    ev.preventDefault();
    var r = draft(), err = check(r);
    if (err) { $("ed-err").textContent = err; $("ed-err").hidden = false; return; }
    var res = C.put(rules(), r, Date.now());
    if (!res.rule) { $("ed-err").textContent = t("err.acts"); $("ed-err").hidden = false; return; }
    if (!save(res.data)) { $("ed-err").textContent = t("err.full"); $("ed-err").hidden = false; return; }
    closeDlg($("ed-dlg"));
    render();
    toast(t("saved"));
  }
  function onDelete() {
    if (!editing || !editing.id) return;
    var before = rules(), id = editing.id;
    if (!save(C.remove(before, id, Date.now()))) { toast(t("err.full")); return; }
    closeDlg($("ed-dlg"));
    render();
    toast(t("deleted"), function () {
      var old = C.find(before, id);
      if (old) { save(C.put(rules(), old, Date.now()).data); render(); }
    });
  }
  function onTest() {
    var r = draft(), err = check(r);
    if (err) { $("ed-err").textContent = err; $("ed-err").hidden = false; return; }
    var clean = C.cleanRule({ id: editing.id || "try", m: 0, name: r.name, on: true, when: r.when, "do": r["do"] });
    if (!clean) return;
    closeDlg($("ed-dlg"));
    showRun(clean, "manual", Date.now());
  }

  // ---------- 8. A run: one button per step ----------
  function showRun(rule, key, at) {
    $("run-h").textContent = rule.name || C.whenText(rule.when, BASE);
    $("run-when").textContent = t("run.at", { when: fmtTime(at) });
    var ul = $("run-list"), h = host();
    ul.textContent = "";
    rule["do"].forEach(function (a) {
      var li = el("li", "act");
      if (a.a === "notify") { li.appendChild(el("span", "", t("run.notice", { text: C.fill(a.text, at, BASE) }))); ul.appendChild(li); return; }
      var app = C.needs(a);
      li.appendChild(el("span", "grow", C.actText(a, BASE, appName)));
      var b = el("button", "chip pri", t("btn.do", { app: appName(app) }));
      b.type = "button";
      b.disabled = !h;
      b.addEventListener("click", function () {
        if (h && h.runAction(a, at)) { if (rule.id !== "try") h.noteRun(rule.id, key, at); closeDlg($("run-dlg")); }
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    if (!C.pending(rule).length) ul.appendChild(el("li", "hint", t("run.none")));
    openDlg($("run-dlg"));
  }

  // ---------- 9. Deep link ----------
  // { run: { r, k, at } } from a notice with several steps;
  // { rule: id } from search.
  window.__orosOpenAt = function (target) {
    if (!target || typeof target !== "object") return;
    if (target.run && typeof target.run.r === "string") {
      var r = C.find(rules(), target.run.r);
      if (!r) { toast(t("gone")); return; }
      var at = typeof target.run.at === "number" && isFinite(target.run.at) ? target.run.at : Date.now();
      showRun(r, typeof target.run.k === "string" ? target.run.k.slice(0, 90) : "", at);
      return;
    }
    if (typeof target.rule === "string" && C.find(rules(), target.rule)) edit(target.rule);
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

  // ---------- 10. Wiring + boot ----------
  function wire() {
    $("new-btn").addEventListener("click", function () { edit(null); });
    $("tpl-btn").addEventListener("click", showTemplates);
    $("empty-tpl").addEventListener("click", showTemplates);
    $("f-when").addEventListener("change", showWhen);
    $("add-act").addEventListener("click", function () {
      if (editing.acts.length >= C.MAX_ACTIONS) return;
      var a = { a: $("f-add").value };
      if (a.a === "todo") a.items = [];
      editing.acts.push(a);
      renderActs();
    });
    $("ed-form").addEventListener("submit", onSave);
    $("ed-del").addEventListener("click", onDelete);
    $("ed-test").addEventListener("click", onTest);
    [].forEach.call(document.querySelectorAll("[data-close]"), function (b) {
      b.addEventListener("click", function () { closeDlg(b.closest("dialog")); });
    });
    var h = host();
    if (h && typeof h.onChange === "function") {
      var off = h.onChange(function () { render(); });
      window.addEventListener("pagehide", function () { try { off(); } catch (e) {} });
    }
  }
  function boot() {
    applyI18n();
    buildStatic();
    wire();
    inheritPalette();
    watchPalette();
    $("standalone").hidden = !!host();
    render();
    takePending();
  }
  boot();
})();
