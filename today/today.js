// ============================================================
// orOS Today — App logic (v1.0.0)
// The summary of the day, from every app that has something dated:
// late tasks, today's rows, the next 3 days, and a top line
// (weather, holidays, name days).
//   - builds NOTHING itself: window.parent.orosToday.build() (the
//     shell's today/host.js) gathers the apps' today.js providers;
//     this file only draws the answer
//   - read-only: a row opens its item in its own app; "Ask the
//     Assistant" only pre-fills the Assistant's box
//     (__orosOpenAt("assistant", { ask })): nothing is sent until the
//     user presses Send. The button shows only where the Assistant's
//     own permission for that app is not "never" (assistant/core.js
//     permFor; NEVER_APPS untouched)
//   - settings (on/off, start hour, apps, quiet morning reminders)
//     are the shell's synced slice "today", written through
//     orosToday.setSetting
//   - no storage of its own; open/closed groups live in
//     sessionStorage "oros-today-ui" (R10)
//   - text is set with textContent only; the only markup written is
//     the app's own static SVG icons and the shell's app icons
// Sections:
//   1. Constants, i18n, helpers
//   2. Drawing
//   3. Assistant button
//   4. Settings dialog
//   5. Keyboard (Contract Β) + palette
//   6. Wiring & boot
// ============================================================
(function () {
  "use strict";

  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    console.log("today.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 1. Constants, i18n, helpers ----------
  var UI_KEY = "oros-today-ui";
  function parentWin() {
    try { return (window.parent && window.parent !== window) ? window.parent : null; }
    catch (e) { return null; }
  }
  function appLang() {
    try {
      var p = parentWin();
      if (p && (p.orosLang === "el" || p.orosLang === "en")) return p.orosLang;
      return localStorage.getItem("oros-lang") === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var I18N = {
    en: {
      app: "Today", refresh: "Refresh", settings: "Settings", close: "Close",
      overdue: "Overdue", today: "Today", soon: "Coming up", tomorrow: "Tomorrow",
      late1: "1 day late", lateN: "{n} days late", allDay: "all day",
      more: "and {n} more in {app}",
      empty: "Nothing for today", emptySoon: "Nothing in the next days either.",
      emptyNext: "Have a look below at what is coming up.",
      off: "The daily summary is off. Turn it on in Settings (the gear button).",
      oldNote: "That notice was for {d}. Here is today.",
      noShell: "Open Today inside orOS to see your day.",
      ask: "Ask the Assistant about this", done: "Done (opens the app)", asked: "Opened in the Assistant. Nothing is sent until you press Send.",
      "s.title": "Today settings",
      "s.on": "Daily summary", "s.onHint": "One notice a day when something is late or due today.",
      "s.hour": "From", "s.hourHint": "The notice comes on the first open of orOS after this time.",
      "s.absorb": "Quiet the morning reminders the summary covers",
      "s.absorbHint": "Plants, chores, pet care, garage, to-dos, quotes, name days and the weather briefing stay quiet once the summary has come. Reminders at a set time still ring.",
      "s.apps": "Apps in the summary", "s.sens": "sensitive",
      "s.sensHint": "Sensitive apps are off until you switch them on.",
      "s.none": "No app gives the summary anything yet.",
      "s.fail": "Could not save. Storage may be full."
    },
    el: {
      app: "Σήμερα", refresh: "Ανανέωση", settings: "Ρυθμίσεις", close: "Κλείσιμο",
      overdue: "Εκπρόθεσμα", today: "Σήμερα", soon: "Έρχονται", tomorrow: "Αύριο",
      late1: "1 μέρα καθυστέρηση", lateN: "{n} μέρες καθυστέρηση", allDay: "όλη μέρα",
      more: "και {n} ακόμα στο «{app}»",
      empty: "Τίποτα για σήμερα", emptySoon: "Ούτε τις επόμενες μέρες.",
      emptyNext: "Δες παρακάτω τι έρχεται.",
      off: "Η ημερήσια σύνοψη είναι κλειστή. Άνοιξέ τη από τις Ρυθμίσεις (το γρανάζι).",
      oldNote: "Η ειδοποίηση ήταν για τις {d}. Εδώ είναι το σήμερα.",
      noShell: "Άνοιξε το «Σήμερα» μέσα από το orOS για να δεις τη μέρα σου.",
      ask: "Ρώτα τον Βοηθό γι' αυτό", done: "Έγινε (ανοίγει την εφαρμογή)", asked: "Άνοιξε στον Βοηθό. Τίποτα δεν στέλνεται πριν πατήσεις Αποστολή.",
      "s.title": "Ρυθμίσεις «Σήμερα»",
      "s.on": "Ημερήσια σύνοψη", "s.onHint": "Μία ειδοποίηση τη μέρα, όταν κάτι έχει καθυστερήσει ή λήγει σήμερα.",
      "s.hour": "Από", "s.hourHint": "Η ειδοποίηση έρχεται στο πρώτο άνοιγμα του orOS μετά από αυτή την ώρα.",
      "s.absorb": "Σίγαση των πρωινών υπενθυμίσεων που καλύπτει η σύνοψη",
      "s.absorbHint": "Φυτά, δουλειές, κατοικίδια, γκαράζ, εργασίες, προσφορές, γιορτές και ο πρωινός καιρός σωπαίνουν όταν έχει έρθει η σύνοψη. Οι υπενθυμίσεις με συγκεκριμένη ώρα χτυπούν κανονικά.",
      "s.apps": "Εφαρμογές στη σύνοψη", "s.sens": "ευαίσθητη",
      "s.sensHint": "Οι ευαίσθητες εφαρμογές είναι κλειστές μέχρι να τις ανοίξεις.",
      "s.none": "Καμία εφαρμογή δεν δίνει ακόμη κάτι στη σύνοψη.",
      "s.fail": "Δεν αποθηκεύτηκε. Ίσως είναι γεμάτος ο χώρος."
    }
  };
  function t(k, vars) {
    var s = (I18N[LANG] && I18N[LANG][k]) || I18N.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  var SVG = {
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    chev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/><path d="M13 7.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    dot: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>'
  };

  function host() { var p = parentWin(); try { return p && p.orosToday ? p.orosToday : null; } catch (e) { return null; } }
  function env() { var p = parentWin(); try { return p && p.orosTodayEnv ? p.orosTodayEnv : null; } catch (e) { return null; } }

  function dateLong(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    if (!m) return "";
    var d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    try {
      return d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
        { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return ymd; }
  }
  function dayName(ymd, today) {
    var A = parentWin() && parentWin().OrosTodayAgg;
    if (A && A.diff(today, ymd) === 1) return t("tomorrow");
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    if (!m) return ymd;
    var d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    try {
      return d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
    } catch (e) { return ymd; }
  }

  var ui = (function () {
    try { return JSON.parse(sessionStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; }
  })();
  function saveUi() { try { sessionStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) {} }

  var toastTimer = null;
  function toast(msg) {
    var n = $("toast");
    n.textContent = msg;
    n.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.hidden = true; }, 4000);
  }

  // ---------- 2. Drawing ----------
  var last = null, oldDay = "", seq = 0, assist = null;

  function refresh() {
    var H = host(), my = ++seq;
    if (!H) { renderNoShell(); return; }
    H.build().then(function (res) {
      if (my !== seq) return;
      last = res;
      assist = assistState(res);
      render();
    }, function () {});
  }

  function renderNoShell() {
    var main = $("main");
    main.textContent = "";
    main.appendChild(el("div", "empty", t("noShell")));
    $("set-btn").disabled = true;
    $("refresh-btn").disabled = true;
  }

  function appInfo(id) {
    var list = last ? last.apps : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return { id: id, name: id, sensitive: false };
  }
  function iconFor(id) {
    var E = env(), s = "";
    try { s = E ? E.icon(id) : ""; } catch (e) {}
    var n = el("span", "ico");
    n.innerHTML = s || SVG.dot;          // the shell's own static icon, never data
    return n;
  }

  function render() {
    var res = last, main = $("main");
    main.textContent = "";
    $("date").textContent = dateLong(res.today);
    var H = host(), set = H ? H.settings() : null;
    if (oldDay && oldDay !== res.today) {
      main.appendChild(el("div", "note", t("oldNote", { d: dateLong(oldDay) })));
    }
    if (set && !set.on.v) main.appendChild(el("div", "note", t("off")));
    var g = res.groups;
    if (g.info.length) {
      var top = el("ul", "top");
      g.info.forEach(function (r) {
        var li = el("li");
        var b = el("button", "top-open");          // a top line opens its app too
        b.type = "button";
        b.appendChild(iconFor(r.app));
        b.appendChild(el("span", "txt", r.title + (r.text ? " · " + r.text : "")));
        b.addEventListener("click", function () {
          var H = host();
          if (H) H.open(r.app, r.target);
        });
        li.appendChild(b);
        top.appendChild(li);
      });
      main.appendChild(top);
    }
    var cols = el("div");
    cols.id = "cols";
    var any = g.overdue.length + g.today.length;
    if (g.overdue.length) cols.appendChild(group("overdue", t("overdue"), [{ rows: g.overdue, more: g.overdueMore }], "late", res.today));
    if (g.today.length) cols.appendChild(group("today", t("today"), [{ rows: g.today, more: g.todayMore }], "", res.today));
    if (!any) {
      var e = el("div", "empty wide");
      e.appendChild(el("strong", "", t("empty")));
      e.appendChild(document.createTextNode(g.soon.length ? t("emptyNext") : t("emptySoon")));
      cols.appendChild(e);
    }
    if (g.soon.length) {
      var days = g.soon.map(function (d) { return { head: dayName(d.day, res.today), rows: d.rows, more: d.more }; });
      cols.appendChild(group("soon", t("soon"), days, "", res.today));
    }
    main.appendChild(cols);
  }

  function group(id, title, parts, cls, today) {
    var box = el("section", "group" + (cls ? " " + cls : ""));
    var n = 0;
    parts.forEach(function (p) { n += p.rows.length; });
    var open = ui[id] !== false;
    var head = el("button", "group-head");
    head.type = "button";
    head.setAttribute("aria-expanded", open ? "true" : "false");
    var chev = el("span", "chev");
    chev.innerHTML = SVG.chev;
    head.appendChild(chev);
    head.appendChild(el("span", "", title));
    head.appendChild(el("span", "count", String(n)));
    box.appendChild(head);
    var body = el("div");
    body.hidden = !open;
    parts.forEach(function (p) {
      if (p.head) body.appendChild(el("div", "day-head", p.head));
      var ul = el("ul", "rows");
      p.rows.forEach(function (r) { ul.appendChild(rowEl(r, id, today)); });
      body.appendChild(ul);
      Object.keys(p.more || {}).forEach(function (app) {
        body.appendChild(el("div", "more", t("more", { n: p.more[app], app: appInfo(app).name })));
      });
    });
    box.appendChild(body);
    head.addEventListener("click", function () {
      var o = body.hidden;
      body.hidden = !o;
      head.setAttribute("aria-expanded", o ? "true" : "false");
      ui[id] = o;
      saveUi();
    });
    return box;
  }

  function rowEl(r, groupId, today) {
    var A = parentWin() && parentWin().OrosTodayAgg;
    var info = appInfo(r.app);
    var li = el("li", "row");
    var b = el("button", "open");
    b.type = "button";
    if (r.time) b.appendChild(el("span", "time", r.time));
    b.appendChild(iconFor(r.app));
    var tx = el("span", "txt");
    tx.appendChild(el("span", "r-title", r.title));
    var meta = el("span", "r-meta");
    if (groupId === "overdue" && r.due && A) {
      var n = A.diff(r.due, today);
      meta.appendChild(el("span", "late", n === 1 ? t("late1") : t("lateN", { n: n })));
      meta.appendChild(document.createTextNode(" · "));
    }
    meta.appendChild(document.createTextNode(info.name + (r.text ? " · " + r.text : "")));
    tx.appendChild(meta);
    b.appendChild(tx);
    b.addEventListener("click", function () {
      var H = host();
      if (H) H.open(r.app, r.target);
    });
    li.appendChild(b);
    if (r.done && r.kind === "task") {
      var dn = el("button", "ask done-btn");
      dn.type = "button";
      dn.innerHTML = SVG.check;
      dn.title = t("done");
      dn.setAttribute("aria-label", t("done") + ": " + r.title);
      dn.addEventListener("click", function () {
        var H = host();
        if (H && typeof H.done === "function") H.done(r.app, r.done);
      });
      li.appendChild(dn);
    }
    if (canAsk(info)) {
      var a = el("button", "ask");
      a.type = "button";
      a.innerHTML = SVG.ask;
      a.title = t("ask");
      a.setAttribute("aria-label", t("ask") + ": " + r.title);
      a.addEventListener("click", function () { askAssistant(r, info); });
      li.appendChild(a);
    }
    return li;
  }

  // ---------- 3. Assistant button ----------
  // Shown only when the Assistant is installed and set up, and its
  // permission for the row's app is "ask" or "always". "never" (the
  // default of a sensitive app) and "off" (NEVER_APPS: mail,
  // passwords) hide it.
  function assistState(res) {
    var C = window.OrosAssistCore, E = env();
    if (!C || !E) return null;
    var apps = [];
    try { apps = E.apps(); } catch (e) { return null; }
    var installed = apps.some(function (a) { return a.id === "assistant"; });
    if (!installed) return null;
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem("oros-assistant-data")); } catch (e) {}
    var data = C.mergeAssist(raw, raw);
    if (!data.set || !data.set.prov) return null;          // not set up yet
    return { C: C, data: data, today: res.today };
  }
  function canAsk(info) {
    if (!assist) return false;
    var p = assist.C.permFor(assist.data, { id: info.id, sensitive: !!info.sensitive });
    return p === "ask" || p === "always";
  }
  function askAssistant(r, info) {
    var H = host(), p = parentWin();
    if (!H || !p || typeof p.__orosOpenAt !== "function") return;
    var text = H.askText(r, info.name, dateLong(assist ? assist.today : ""), LANG);
    p.__orosOpenAt("assistant", { ask: text });
    toast(t("asked"));
  }

  // ---------- 4. Settings dialog ----------
  function settingsDialog() {
    var H = host();
    if (!H) return;
    var body = $("set-body");
    body.textContent = "";
    var s = H.settings();
    function save(name, v, id) {
      if (!H.setSetting(name, v, id)) toast(t("s.fail"));
      refresh();
    }
    function check(label, hint, value, onChange) {
      var row = el("div", "set-row");
      var lab = el("label");
      var box = el("input");
      box.type = "checkbox";
      box.checked = !!value;
      var uid = "c" + Math.random().toString(36).slice(2, 8);
      box.id = uid;
      lab.htmlFor = uid;
      lab.appendChild(document.createTextNode(label));
      if (hint) lab.appendChild(el("span", "hint", hint));
      box.addEventListener("change", function () { onChange(box.checked); });
      row.appendChild(lab);
      row.appendChild(box);
      return row;
    }
    body.appendChild(check(t("s.on"), t("s.onHint"), s.on.v, function (v) { save("on", v); }));
    var hr = el("div", "set-row");
    var hl = el("label");
    hl.htmlFor = "set-hour";
    hl.appendChild(document.createTextNode(t("s.hour")));
    hl.appendChild(el("span", "hint", t("s.hourHint")));
    var sel = el("select");
    sel.id = "set-hour";
    for (var h = 0; h <= 12; h++) {
      var o = el("option", "", (h < 10 ? "0" : "") + h + ":00");
      o.value = String(h);
      if (h === s.hour.v) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", function () { save("hour", +sel.value); });
    hr.appendChild(hl);
    hr.appendChild(sel);
    body.appendChild(hr);
    body.appendChild(check(t("s.absorb"), t("s.absorbHint"), s.absorb.v, function (v) { save("absorb", v); }));
    body.appendChild(el("div", "set-sub", t("s.apps")));
    var apps = last ? last.apps : [];
    if (!apps.length) body.appendChild(el("div", "set-row", t("s.none")));
    var anySens = false;
    apps.forEach(function (a) {
      if (a.sensitive) anySens = true;
      var row = check(a.name, "", a.on, function (v) { save("app", v, a.id); });
      if (a.sensitive) row.querySelector("label").insertBefore(el("span", "tag", t("s.sens")), row.querySelector("label").childNodes[1] || null);
      body.appendChild(row);
    });
    if (anySens) body.appendChild(el("div", "set-row hint", t("s.sensHint")));
    $("set-dlg").showModal();
  }

  // ---------- 5. Keyboard (Contract Β) + palette ----------
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
  }

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

  // ---------- 6. Wiring & boot ----------
  // Deep link: { day: "YYYY-MM-DD" } from the daily notice. The tab is
  // always today, built afresh; an older notice gets a one-line note.
  function takeTarget(tg) {
    oldDay = tg && typeof tg.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(tg.day) ? tg.day : "";
    refresh();
  }
  window.__orosOpenAt = takeTarget;

  function boot() {
    document.documentElement.lang = LANG;
    document.title = t("app") + " · orOS";
    $("title").textContent = t("app");
    function iconBtn(id, svg, label) {
      var b = $(id);
      b.innerHTML = svg;
      b.setAttribute("aria-label", label);
      b.title = label;
    }
    iconBtn("refresh-btn", SVG.refresh, t("refresh"));
    iconBtn("set-btn", SVG.gear, t("settings"));
    $("set-title").textContent = t("s.title");
    $("set-close").textContent = t("close");
    $("refresh-btn").addEventListener("click", refresh);
    $("set-btn").addEventListener("click", settingsDialog);
    inheritPalette();
    watchPalette();
    wireKeyboard();
    var tg = null, p = parentWin();
    try { if (p && typeof p.__orosTakeTarget === "function") tg = p.__orosTakeTarget("today"); } catch (e) {}
    var H = host();
    if (H) {
      var off = H.onChange(function () { if (!document.querySelector("dialog[open]")) refresh(); });
      window.addEventListener("pagehide", off);
    }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
    // A new day while the tab stays open.
    var A = p && p.OrosTodayAgg, lastDay = A ? A.ymdOf(new Date()) : "";
    setInterval(function () {
      if (!A) return;
      var d = A.ymdOf(new Date());
      if (d !== lastDay) { lastDay = d; oldDay = ""; refresh(); }
    }, 30000);
    takeTarget(tg);
  }

  boot();
})();
