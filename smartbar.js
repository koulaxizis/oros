// ============================================================
// orOS — smartbar.js (smart top bar, v1.0.0)
// ------------------------------------------------------------
// A shell component, like widgets.js: it runs IN the shell document
// and keeps its own device-local storage. shell.js calls attach() once
// at boot (not in a single app, not on a till-only device), tick()
// every second from its clock and refresh() when the language changes.
// A bundle without this file draws exactly what it drew before.
//
//   Live chips in the top bar, each one the person switches on:
//   • Next event   the next timed row of today's summary (Calendar,
//                  Travel, …) with a countdown from 60 minutes before;
//                  "Now" while it runs. Rows of apps kept out of search
//                  (Health, Cycle, One-Sentence Diary, …) never reach the bar.
//   • Focus        the Time app's Pomodoro leg while it runs (focus or
//                  break, minutes left), from oros-time-pmrun.
//   • Tasks        late and today's tasks of the summary.
//   • Water        today's water against the goal (water/core.js).
//   • Spent        this month's expenses in Budget.
//   • Till         today's till sales in Stock (stock/pos-core.js,
//                  loaded the first time this chip is on).
//   A chip with nothing to say stays hidden. Money chips and event
//   titles are hidden while Sensitive work is on.
//   A click opens the place the chip comes from.
//   Fit: the shell's fitBar() asks fitDrop() to hide the last chips
//   before it hides the weekday or the date, so the bar never scrolls.
//
// Device-local (oros-smartbar, never synced: screens differ):
//   { v:1, list:["event","focus",…] }   order = list order
//   Absent = none: the bar looks as before until the person adds one.
//
// Reads only. It never writes another app's data. Pure logic is
// unit-tested in node (tests/smartbar.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.1.0";
  var KEY = "oros-smartbar";
  var KINDS = ["event", "focus", "tasks", "water", "budget", "sales"];
  var MONEY = { budget: 1, sales: 1 };
  var LOOKS = ["", "glass", "midnight", "solid"];   // SB3: "" = the classic bar
  var SOON_MIN = 60;                       // countdown from this many minutes before
  var TODAY_MS = 120000;                   // the summary is rebuilt at most every 2 min
  var HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

  // ---------- 1. Model (pure) ----------
  function norm(v) {
    if (!v || typeof v !== "object" || !Array.isArray(v.list)) return null;
    var out = [];
    v.list.forEach(function (k) { if (KINDS.indexOf(k) !== -1 && out.indexOf(k) === -1) out.push(k); });
    var o = { v: 1, list: out };
    if (typeof v.look === "string" && v.look && LOOKS.indexOf(v.look) !== -1) o.look = v.look;
    return o;
  }
  function lookOf(stored) { return stored && stored.look || ""; }
  function parse(raw) {
    try { return norm(JSON.parse(raw)); } catch (e) { return null; }
  }
  function listOf(stored) { return stored ? stored.list.slice() : []; }
  // A chip switched on goes to the end; off takes it out.
  function toggle(list, kind, on) {
    var out = list.filter(function (k) { return k !== kind; });
    if (on && KINDS.indexOf(kind) !== -1) out.push(kind);
    return out;
  }
  // Move a chip one place left (-1) or right (+1).
  function step(list, kind, dir) {
    var i = list.indexOf(kind), j = i + (dir < 0 ? -1 : 1);
    if (i === -1 || j < 0 || j >= list.length) return list.slice();
    var out = list.slice();
    out[i] = out[j]; out[j] = kind;
    return out;
  }
  function mins(hm) { var m = HM_RE.exec(hm || ""); return m ? +m[1] * 60 + +m[2] : null; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // The next timed row of today: one still running (time ≤ now < end)
  // or the first one ahead. Rows of sensitive apps are skipped.
  //   rows   today's rows of the summary (each { app, time, end, title, kind })
  //   nowMin minutes since midnight
  //   hidden { appId: true } for apps kept out of the bar
  // → { row, start, end, now: bool, left: minutes to start } | null
  function nextEvent(rows, nowMin, hidden) {
    var best = null;
    (rows || []).forEach(function (r) {
      if (!r || r.kind === "info" || (hidden && hidden[r.app])) return;
      var s = mins(r.time);
      if (s === null) return;
      var e = mins(r.end);
      var running = e !== null ? (s <= nowMin && nowMin < e) : (s <= nowMin && nowMin < s + 1);
      if (!running && s < nowMin) return;
      var cand = { row: r, start: s, end: e, now: running, left: Math.max(0, s - nowMin) };
      if (!best || (cand.now && !best.now) || (cand.now === best.now && cand.start < best.start)) best = cand;
    });
    return best;
  }
  // Late tasks + today's tasks (+ the rows the summary folded away).
  function taskCount(g) {
    if (!g) return 0;
    var n = 0;
    (g.overdue || []).forEach(function (r) { if (r && r.kind === "task") n++; });
    (g.today || []).forEach(function (r) { if (r && r.kind === "task") n++; });
    var more = g.overdueMore || {};
    Object.keys(more).forEach(function (k) { n += +more[k] || 0; });
    return n;
  }
  // The Pomodoro leg (oros-time-pmrun) → { phase, left: ms } | null.
  function focusOf(raw, now) {
    var r = null;
    try { r = JSON.parse(raw); } catch (e) { return null; }
    if (!r || typeof r !== "object" || typeof r.end !== "number" || !isFinite(r.end)) return null;
    var left = r.end - now;
    if (left <= 0 || left > 6 * 3600000) return null;   // over, or not a Pomodoro leg
    return { phase: r.phase === "break" ? "break" : "work", left: left };
  }
  // mm:ss (h:mm:ss over an hour) of a span in ms, counting up to the next second.
  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ":" + pad(m) : String(m)) + ":" + pad(s % 60);
  }
  // This month's expenses in Budget's data, in cents. Deleted entries
  // (a tomb at or after the row's m) do not count.
  //   → { cents, cur, n } | null when Budget has no entries
  function monthSpent(data, ym) {
    if (!data || typeof data !== "object" || !Array.isArray(data.tx)) return null;
    var tombs = data.tombs && typeof data.tombs === "object" ? data.tombs : {};
    var cents = 0, n = 0, any = false;
    data.tx.forEach(function (x) {
      if (!x || typeof x !== "object" || typeof x.a !== "number" || !isFinite(x.a)) return;
      var tb = tombs["tx:" + x.id];
      if (typeof tb === "number" && tb >= (x.m || 0)) return;
      any = true;
      if (x.k !== "o" || typeof x.d !== "string" || x.d.slice(0, 7) !== ym) return;
      cents += Math.round(x.a); n++;
    });
    if (!any) return null;
    var cur = data.set && typeof data.set.cur === "string" && /^[A-Z]{3}$/.test(data.set.cur) ? data.set.cur : "EUR";
    return { cents: cents, cur: cur, n: n };
  }
  // Money for the bar: whole units from 1,000 up ("€1,240"), cents below.
  function money(cents, cur, locale) {
    var big = Math.abs(cents) >= 100000;
    try {
      return new Intl.NumberFormat(locale || "en-GB", { style: "currency", currency: cur,
        minimumFractionDigits: big ? 0 : 2, maximumFractionDigits: big ? 0 : 2 }).format(cents / 100);
    } catch (e) {
      return (cents / 100).toFixed(big ? 0 : 2) + " " + cur;
    }
  }
  function ymdOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  var model = { VER: VER, KEY: KEY, KINDS: KINDS, MONEY: MONEY, SOON_MIN: SOON_MIN,
                norm: norm, parse: parse, listOf: listOf, toggle: toggle, step: step, mins: mins,
                nextEvent: nextEvent, taskCount: taskCount, focusOf: focusOf, clock: clock,
                monthSpent: monthSpent, money: money, ymdOf: ymdOf, LOOKS: LOOKS, lookOf: lookOf };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  var doc = document;
  var host = null, box = null, chips = {};
  var todayCache = null, todayAt = 0, todayBusy = false, posLoad = 0;

  function t(k) { return typeof root.t === "function" ? root.t(k) : k; }
  function call(fn) { try { return fn(); } catch (e) { return undefined; } }
  function lang() { return call(function () { return host.lang(); }) || "en"; }
  function loc() { return call(function () { return root.orosI18n.locale(lang()); }) || (lang() === "el" ? "el-GR" : "en-GB"); }
  function appName(id) { return call(function () { return host.appName(id); }) || id; }
  function strict() { return !!call(function () { return host.strict(); }); }
  function stored() { try { return parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function list() { return listOf(stored()); }
  function save(l, look) {
    var o = { v: 1, list: l };
    var lk = look === undefined ? lookOf(stored()) : look;
    if (lk) o.look = lk;
    try { localStorage.setItem(KEY, JSON.stringify(o)); }
    catch (e) { call(function () { host.toast(t("sb.savefail")); }); }
    applyLook();
    render();
    call(function () { host.changed(); });
  }
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }

  // Icons: fixed markup, never data.
  var IC = {
    event: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    focus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2.5h4"/></svg>',
    tasks: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12l3 3 5-6"/></svg>',
    water: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
    budget: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M16 12.5h2M3 10h18"/></svg>',
    sales: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16l-1.5 11h-13z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/></svg>'
  };

  var CSS = [
    "#sb-row { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }",
    "#sb-row[hidden], .sb-chip[hidden] { display: none !important; }",
    ".sb-chip { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; padding: 0 8px; background: transparent;",
    "  border: none; border-radius: 8px; color: var(--text); font: inherit; font-size: 12.5px; font-weight: 600;",
    "  font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; }",
    ".sb-chip:hover, .sb-chip:focus-visible { background: var(--accent-soft); outline: none; }",
    ".sb-chip svg { display: block; flex-shrink: 0; pointer-events: none; color: var(--accent); }",
    ".sb-chip .sb-v { pointer-events: none; }",
    ".sb-chip .sb-l { pointer-events: none; font-weight: 500; color: var(--text-dim); max-width: 16ch; overflow: hidden; text-overflow: ellipsis; }",
    ".sb-chip.sb-soon .sb-v { color: var(--accent); }",
    ".sb-chip.sb-now { background: var(--accent-soft); }",
    "#oros-bar.bar-tight .sb-chip { padding: 0 5px; }",
    "@media (max-width: 760px) { .sb-chip .sb-l { display: none; } }",
    "body.solo-mode #sb-row, body.till-mode #sb-row { display: none !important; }",
    // SB3 looks: the bar floats as a rounded pill inside its own 40 px
    // (nothing below moves). Never under high contrast.
    "html[data-oros-bar]:not([data-oros-contrast=\"high\"]) #oros-bar { background: transparent; border-bottom-color: transparent; box-shadow: none;",
    "  backdrop-filter: none; -webkit-backdrop-filter: none; }",
    "html[data-oros-bar]:not([data-oros-contrast=\"high\"]) #oros-bar::before { content: \"\"; position: absolute; z-index: -1; pointer-events: none;",
    "  left: 4px; right: 4px; top: calc(env(safe-area-inset-top, 0px) + 3px); bottom: 3px; border-radius: 14px; border: 1px solid var(--border); }",
    "html[data-oros-bar=\"glass\"]:not([data-oros-contrast=\"high\"]) #oros-bar::before { background: color-mix(in srgb, var(--bar-bg) 58%, transparent);",
    "  backdrop-filter: blur(18px) saturate(1.5); -webkit-backdrop-filter: blur(18px) saturate(1.5);",
    "  border-color: color-mix(in srgb, var(--text) 16%, transparent); box-shadow: 0 6px 20px var(--shadow), inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent); }",
    "html[data-oros-bar=\"midnight\"]:not([data-oros-contrast=\"high\"]) #oros-bar { --text: #e9edf5; --text-dim: #a3adbd; --accent-soft: rgba(255, 255, 255, 0.09); color: #e9edf5; }",
    "html[data-oros-bar=\"midnight\"]:not([data-oros-contrast=\"high\"]) #oros-bar::before { background: rgba(10, 13, 20, 0.94);",
    "  border-color: rgba(255, 255, 255, 0.08); box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35); }",
    "html[data-oros-bar=\"solid\"]:not([data-oros-contrast=\"high\"]) #oros-bar::before { background: var(--panel-bg); box-shadow: 0 2px 10px var(--shadow); }",
    "@media (prefers-reduced-transparency: reduce) { html[data-oros-bar=\"glass\"] #oros-bar::before { background: var(--panel-bg); backdrop-filter: none; -webkit-backdrop-filter: none; } }"
  ].join("\n");

  function applyLook() {
    var lk = lookOf(stored()), h = doc.documentElement;
    if (lk) h.setAttribute("data-oros-bar", lk); else h.removeAttribute("data-oros-bar");
  }

  function injectCss() {
    if (doc.getElementById("sb-css")) return;
    var s = doc.createElement("style");
    s.id = "sb-css";
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  function makeChip(kind) {
    var b = doc.createElement("button");
    b.type = "button";
    b.className = "sb-chip";
    b.setAttribute("data-sb", kind);
    b.innerHTML = IC[kind];
    var v = doc.createElement("span"); v.className = "sb-v";
    var l = doc.createElement("span"); l.className = "sb-l";
    b.appendChild(v); b.appendChild(l);
    b.hidden = true;
    b.addEventListener("click", function (e) { e.stopPropagation(); go(kind); });
    return { el: b, v: v, l: l, key: "", go: null };
  }

  function render() {
    if (!host) return;
    var bar = doc.querySelector("#oros-bar .bar-right");
    if (!bar) return;
    var l = list();
    if (!l.length) {
      if (box) { box.remove(); box = null; chips = {}; }
      call(function () { host.fit(); });
      return;
    }
    if (!box) {
      box = doc.createElement("div");
      box.id = "sb-row";
      bar.insertBefore(box, bar.firstChild);
    }
    Object.keys(chips).forEach(function (k) { if (l.indexOf(k) === -1) { chips[k].el.remove(); delete chips[k]; } });
    l.forEach(function (k) {
      if (!chips[k]) chips[k] = makeChip(k);
      box.appendChild(chips[k].el);                    // list order
      chips[k].key = "";
    });
    paint(true);
  }

  // One chip: { v (value), l (label beside it on wide screens),
  // tip (plain text title), cls, go } or null (hidden).
  var STATE = {
    event: function (now) {
      var g = todayCache && todayCache.groups;
      if (!g) return null;
      var hidden = {};
      (todayCache.apps || []).forEach(function (a) { if (a.sensitive) hidden[a.id] = true; });
      var d = new Date(now), nowMin = d.getHours() * 60 + d.getMinutes();
      var ev = nextEvent(g.today, nowMin, hidden);
      if (!ev) return null;
      var r = ev.row, title = strict() ? t("sb.event.hidden") : r.title;
      var narrow = (root.innerWidth || 0) <= 480;          // a phone: "20′" instead of "in 20 min"
      var v = ev.now ? t("sb.event.now") : (ev.left <= SOON_MIN ? t(narrow ? "sb.event.short" : "sb.event.in").replace("{n}", Math.max(1, ev.left)) : r.time);
      var app = appName(r.app);
      return {
        v: v, l: title, cls: ev.now ? "sb-now" : (ev.left <= SOON_MIN ? "sb-soon" : ""),
        tip: t("sb.event.tip").replace("{t}", title).replace("{h}", r.time + (r.end ? "–" + r.end : "")).replace("{app}", app),
        go: function () { if (root.orosToday && root.orosToday.open) root.orosToday.open(r.app, r.target); }
      };
    },
    focus: function (now) {
      var raw = null;
      try { raw = localStorage.getItem("oros-time-pmrun"); } catch (e) {}
      var f = raw ? focusOf(raw, now) : null;
      if (!f) return null;
      var ph = t(f.phase === "break" ? "sb.focus.break" : "sb.focus.work"), left = clock(f.left);
      return { v: left, l: ph, cls: f.phase === "work" ? "sb-soon" : "",
               tip: t("sb.focus.tip").replace("{p}", ph).replace("{r}", left).replace("{app}", appName("time")), go: function () { host.open("time"); } };
    },
    tasks: function () {
      var g = todayCache && todayCache.groups;
      var n = taskCount(g);
      if (!n) return null;
      return { v: String(n), l: t(n === 1 ? "sb.tasks.one" : "sb.tasks.n"),
               tip: t("sb.tasks.tip").replace("{n}", n).replace("{app}", appName("today")), go: function () { host.open("today"); } };
    },
    water: function (now) {
      var C = root.orosWaterCore;
      if (!C) return null;
      var data = null;
      try { data = C.parse(localStorage.getItem(C.STORAGE_KEY)); } catch (e) {}
      if (!data || !C.hasAny(data)) return null;
      var day = ymdOf(new Date(now));                 // water/core.js dayKey: the same YYYY-MM-DD
      var tot = C.dayTotal(data, day), goal = C.goalFor(data, day), L = lang();
      var a = C.amount(tot, data.prefs, L), gl = C.fmtAmount(goal, data.prefs, L);
      return { v: a + " / " + gl, l: "", cls: goal && tot >= goal ? "sb-soon" : "",
               tip: t("sb.water.tip").replace("{a}", C.fmtAmount(tot, data.prefs, L)).replace("{g}", gl).replace("{app}", appName("water")),
               go: function () { host.open("water"); } };
    },
    budget: function (now) {
      if (strict()) return null;
      var s = monthSpent(readJSON("oros-budget-data"), ymdOf(new Date(now)).slice(0, 7));
      if (!s) return null;
      var a = money(s.cents, s.cur, loc());
      return { v: a, l: t("sb.budget.label"), tip: t("sb.budget.tip").replace("{a}", a).replace("{n}", s.n).replace("{app}", appName("budget")),
               go: function () { host.open("budget"); } };
    },
    sales: function (now) {
      if (strict()) return null;
      var P = root.OrosStockPosCore;
      if (!P) { loadPos(); return null; }
      var data = readJSON("oros-stock-data");
      if (!data || !Array.isArray(data.sales)) return null;
      var rep = call(function () { return P.zReport(data, ymdOf(new Date(now))); });
      if (!rep || !rep.n) return null;
      var cur = data.settings && typeof data.settings.cur === "string" && /^[A-Z]{3}$/.test(data.settings.cur) ? data.settings.cur : "EUR";
      var a = money(rep.g, cur, loc());
      return { v: a, l: t("sb.sales.label"), tip: t("sb.sales.tip").replace("{a}", a).replace("{n}", rep.n).replace("{app}", appName("stock")),
               go: function () { host.open("stock"); } };
    }
  };

  // Stock's till rules come from its own file, loaded once from the
  // precache the first time the Till chip is on (like the QR encoder).
  function loadPos() {
    if (posLoad || root.OrosStockPosCore) return;
    posLoad = 1;
    var s = doc.createElement("script");
    s.src = "stock/pos-core.js?v=" + (call(function () { return host.version(); }) || "");
    s.onload = function () { if (chips.sales) { chips.sales.key = ""; paint(true); } };
    s.onerror = function () { posLoad = 0; };
    doc.head.appendChild(s);
  }

  function wantsToday() { return !!(chips.event || chips.tasks); }
  function refreshToday(force) {
    var now = Date.now();
    if (todayBusy || !wantsToday() || !(root.orosToday && root.orosToday.build)) return;
    if (!force && todayCache && now - todayAt < TODAY_MS) return;
    todayBusy = true;
    root.orosToday.build().then(function (res) {
      todayBusy = false; todayAt = Date.now(); todayCache = res; paint(true);
    }, function () { todayBusy = false; todayAt = Date.now(); });
  }

  function go(kind) {
    var c = chips[kind];
    if (c && typeof c.go === "function") call(c.go);
  }

  // Paint every chip whose text changed. A chip the fit hid
  // (data-sb-drop) stays hidden until the shell fits the bar again; the
  // bar's ResizeObserver runs that fit whenever a chip changes width.
  function paint(force) {
    if (!host || !box) return;
    refreshToday(false);
    var now = Date.now(), changed = false;
    Object.keys(chips).forEach(function (k) {
      var c = chips[k], s = call(function () { return STATE[k](now); }) || null;
      var key = s ? [s.v, s.l, s.cls, s.tip].join("\u0001") : "";
      c.go = s ? s.go : null;
      if (!force && key === c.key) return;
      c.key = key;
      if (!s) { if (!c.el.hidden) { c.el.hidden = true; changed = true; } return; }
      if (c.v.textContent !== s.v) c.v.textContent = s.v;      // textContent: never HTML
      if (c.l.textContent !== (s.l || "")) c.l.textContent = s.l || "";
      c.l.hidden = !s.l;
      c.el.className = "sb-chip" + (s.cls ? " " + s.cls : "");
      if (c.el.title !== s.tip) { c.el.title = s.tip; c.el.setAttribute("aria-label", s.tip); }
      if (c.el.hidden && !c.el.hasAttribute("data-sb-drop")) { c.el.hidden = false; changed = true; }
    });
    if (changed) call(function () { host.fit(); });
  }

  function attach(h) {
    if (host || !h) return;
    host = h;
    injectCss();
    applyLook();
    render();
    if (root.orosToday && root.orosToday.onChange) root.orosToday.onChange(function () { todayAt = 0; refreshToday(true); });
  }

  root.orosSmartBar = {
    VER: VER,
    model: model,
    attach: attach,
    tick: function () { paint(false); },
    // Settings › Appearance › Top bar
    snapshot: function () {
      if (!host) return null;
      var l = list();
      var names = KINDS.map(function (k) { return { id: k, name: t("sb.k." + k), on: l.indexOf(k) !== -1, money: !!MONEY[k] }; });
      names.sort(function (a, b) {
        var ia = l.indexOf(a.id), ib = l.indexOf(b.id);
        if (ia === -1 && ib === -1) return KINDS.indexOf(a.id) - KINDS.indexOf(b.id);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
      return { list: names, look: lookOf(stored()), looks: LOOKS.slice() };
    },
    // SB3: "" (classic), glass, midnight, solid; device-local like the chips
    setLook: function (look) {
      if (!host || LOOKS.indexOf(look) === -1) return;
      save(list(), look);
    },
    wants: function (kind) { return !!host && list().indexOf(kind) !== -1; },
    set: function (kind, on) {
      if (!host || KINDS.indexOf(kind) === -1) return;
      save(toggle(list(), kind, !!on));
    },
    move: function (kind, dir) {
      if (!host || KINDS.indexOf(kind) === -1) return;
      save(step(list(), kind, dir));
    },
    // fitBar(): show every chip again before measuring …
    fitReset: function () {
      Object.keys(chips).forEach(function (k) {
        var c = chips[k];
        c.el.removeAttribute("data-sb-drop");
        c.el.hidden = c.key === "";
      });
    },
    // … then hide the last shown chip, one at a time, while the bar does
    // not fit. keep = how many shown chips it leaves (the shell keeps the
    // first one until its last fit level). false = nothing left to hide.
    fitDrop: function (keep) {
      if (!box) return false;
      var shown = Array.prototype.filter.call(box.children, function (el) { return !el.hidden; });
      if (shown.length <= Math.max(0, keep || 0)) return false;
      var last = shown[shown.length - 1];
      last.hidden = true;
      last.setAttribute("data-sb-drop", "1");
      return true;
    },
    refresh: function () {
      if (!host) return;
      todayAt = 0;
      Object.keys(chips).forEach(function (k) { chips[k].key = ""; });
      render();
    }
  };
  // A chosen look shows from the first paint, before the shell attaches.
  if (lookOf(stored())) { injectCss(); applyLook(); }
})(typeof window !== "undefined" ? window : globalThis);
