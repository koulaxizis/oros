// ============================================================
// orOS — smartbar.js (smart top bar, v1.7.0)
// ------------------------------------------------------------
// A shell component, like widgets.js: it runs IN the shell document
// and keeps its own device-local storage. shell.js calls attach() once
// at boot (not in a single app, not on a till-only device), tick()
// every second from its clock and refresh() when the language changes.
// A bundle without this file draws exactly what it drew before.
//
//   Chips the person ticks (event, focus, tasks, water, spent, till;
//   the other apps' cards in smartbar-apps.js), and live pills while a
//   timer, the stopwatch or a recording runs (smartbar-live.js). Each
//   shows only with something to say; money and event titles hide under
//   Sensitive work; a click opens its app (the event chip and the
//   shell's weather chip first open a peek panel, PEEK-1, v1.4.0: the
//   month + today's rows / the days ahead, with "Open Calendar /
//   Weather" inside). The "ai" card (AI-USE, v1.5.0): the Assistant's
//   tokens this month on the person's own keys and the free Tavily
//   searches left, never for local models. The "battery" card (BAT-1,
//   v1.6.0): percent and charging where the browser reports a battery;
//   a tap opens Quick settings. The "playing" card (NOWPLAY-1, v1.7.0):
//   what Music, Podcasts, Radio or the Sound Mixer plays; a tap opens a
//   peek with Previous / Play-Pause / Next. fitBar() folds the last chips
//   into #sb-more ("+N") before the date goes; on a phone (<= 600 px)
//   all fold. Full list: help/topics/appearance.en.txt "Smart top bar".
//
// Device-local (oros-smartbar, never synced: screens differ):
//   { v:1, list:["event",…] (order), look?, live:false? (no pills) }
// Reads only (the live pills' pause button excepted). Pure logic is
// unit-tested in node (tests/smartbar.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.7.0";
  var KEY = "oros-smartbar";
  var KINDS = ["event", "focus", "tasks", "water", "budget", "sales",
               "habits", "plants", "chores", "timer", "invoices", "trip", "kanban", "meal", "reading", "continue", "ai", "battery", "playing"];
  var MONEY = { budget: 1, sales: 1, invoices: 1 };
  // SB5: the cards of other apps live in smartbar-apps.js, loaded the
  // first time one of them is ticked (start-up stays as it was).
  var APPS = { habits: 1, plants: 1, chores: 1, timer: 1, invoices: 1, trip: 1, kanban: 1, meal: 1, reading: 1 };
  var LIVE = ["rec", "tmr", "sw"];          // SB-LIVE pills, in this order, before the chips
  var LOOKS = ["", "glass", "midnight", "solid"];   // SB3: "" = the classic bar
  var FOLD_W = 600;                         // ≤ this width: every chip folds into the button
  var SOON_MIN = 60;                       // countdown from this many minutes before
  var TODAY_MS = 120000;                   // the summary is rebuilt at most every 2 min
  var HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  var CONT_MS = 7200000;                   // CONT-1 W2: another device's item shows here for 2 h

  // ---------- 1. Model (pure) ----------
  function norm(v) {
    if (!v || typeof v !== "object" || !Array.isArray(v.list)) return null;
    var out = [];
    v.list.forEach(function (k) { if (KINDS.indexOf(k) !== -1 && out.indexOf(k) === -1) out.push(k); });
    var o = { v: 1, list: out };
    if (typeof v.look === "string" && v.look && LOOKS.indexOf(v.look) !== -1) o.look = v.look;
    if (v.live === false) o.live = false;
    return o;
  }
  function liveOf(stored) { return !(stored && stored.live === false); }
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
  // SB-LIVE: anything running? (raw text, so nothing loads before it does)
  function liveWanted(rawTimers, rawSw, rec) {
    return !!rec || /"st":"run"/.test(rawTimers || "") || /"run":true/.test(rawSw || "");
  }
  function rowOf(stored) { return (liveOf(stored) ? LIVE.slice() : []).concat(listOf(stored)); }
  function ymdOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  // PEEK-1: today's rows for the event peek: timed ones by time, then
  // the rest; never a sensitive app's row; at most `max`.
  //   rows   the summary's today rows; hidden { appId: true }
  function peekRows(rows, hidden, max) {
    var ok = (rows || []).filter(function (r) { return r && typeof r.title === "string" && r.title && !(hidden && hidden[r.app]) && r.kind !== "info"; });
    ok.sort(function (a, b) {
      var ma = mins(a.time), mb = mins(b.time);
      if (ma === null && mb === null) return 0;
      if (ma === null) return 1;
      if (mb === null) return -1;
      return ma - mb;
    });
    return ok.slice(0, max || 6);
  }
  // "24° / 15°", "24°" or "" (null temperatures left out).
  function hiLo(max, min) {
    var a = typeof max === "number" && isFinite(max) ? Math.round(max) + "°" : "";
    var b = typeof min === "number" && isFinite(min) ? Math.round(min) + "°" : "";
    return a && b ? a + " / " + b : (a || b);
  }

  // AI-USE (1.5.0): the Assistant's use this month on the person's own
  // keys, from its device-local prefs (oros-assistant-prefs): usage
  // { "YYYY-MM": { pid: { i, o, ws? } } } and srch { "YYYY-MM": { tavily } }.
  // Local models (on this computer or in the browser) never count.
  //   → { tok, ws, tav } | null when nothing was used this month
  var AI_LOCAL = { local: 1, webllm: 1, browser: 1 };
  var TAVILY_FREE = 1000;                  // Tavily's free searches a month
  function aiUsage(prefs, mk) {
    if (!prefs || typeof prefs !== "object") return null;
    var u = prefs.usage && prefs.usage[mk], s = prefs.srch && prefs.srch[mk];
    var tok = 0, ws = 0, tav = 0;
    if (u && typeof u === "object") Object.keys(u).forEach(function (pid) {
      var r = u[pid];
      if (AI_LOCAL[pid] || !r || typeof r !== "object") return;
      var n = function (v) { return typeof v === "number" && isFinite(v) && v > 0 ? v : 0; };
      tok += n(r.i) + n(r.o);
      ws += n(r.ws);
    });
    if (s && typeof s === "object" && typeof s.tavily === "number" && isFinite(s.tavily) && s.tavily > 0) tav = Math.floor(s.tavily);
    return tok || ws || tav ? { tok: Math.round(tok), ws: Math.round(ws), tav: tav } : null;
  }
  // 950 · 12.4k · 182k · 1.2M
  function compact(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    if (n < 1000) return String(n);
    if (n < 100000) return (Math.round(n / 100) / 10).toString().replace(/\.0$/, "") + "k";
    if (n < 1000000) return Math.round(n / 1000) + "k";
    return (Math.round(n / 100000) / 10).toString().replace(/\.0$/, "") + "M";
  }

  // BAT-1: what the battery card says, from navigator.getBattery()'s
  // { level 0–1, charging, chargingTime }. A computer on mains power
  // reports a full battery that charges in 0 s: no card then.
  //   → { pct, charging, low } | null
  var BAT_LOW = 20;
  function batteryCard(b) {
    if (!b || typeof b.level !== "number" || !isFinite(b.level) || b.level < 0 || b.level > 1) return null;
    var pct = Math.round(b.level * 100), charging = b.charging === true;
    if (pct === 100 && charging && b.chargingTime === 0) return null;
    return { pct: pct, charging: charging, low: !charging && pct <= BAT_LOW };
  }

  // NOWPLAY-1: the player for the card: the one that plays, else none.
  //   list = the shell's players [{ id, name, playing, title }]
  //   → { m, what, sub } | null (what = the title's first part)
  function playingOf(list) {
    var m = (Array.isArray(list) ? list : []).filter(function (x) { return x && x.playing; })[0];
    if (!m) return null;
    var parts = String(m.title || "").split(" · ");
    return { m: m, what: parts[0] || String(m.name || ""), sub: parts.slice(1).join(" · ") };
  }

  var model = { VER: VER, KEY: KEY, playingOf: playingOf, batteryCard: batteryCard, BAT_LOW: BAT_LOW, peekRows: peekRows, hiLo: hiLo, aiUsage: aiUsage, compact: compact, TAVILY_FREE: TAVILY_FREE, KINDS: KINDS, MONEY: MONEY, SOON_MIN: SOON_MIN,
                norm: norm, parse: parse, listOf: listOf, toggle: toggle, step: step, mins: mins,
                nextEvent: nextEvent, taskCount: taskCount, focusOf: focusOf, clock: clock,
                monthSpent: monthSpent, money: money, ymdOf: ymdOf, LOOKS: LOOKS, lookOf: lookOf, APPS: APPS,
                LIVE: LIVE, liveOf: liveOf, rowOf: rowOf, liveWanted: liveWanted };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  var doc = document;
  var host = null, box = null, chips = {}, more = null, pop = null;
  var todayCache = null, todayAt = 0, todayBusy = false, posLoad = 0;
  var apps = null, appsLoad = 0;     // SB5: smartbar-apps.js, once loaded
  var live = null, liveLoad = 0, recLive = null;   // SB-LIVE: smartbar-live.js; Capture's recording

  function t(k) { return typeof root.t === "function" ? root.t(k) : k; }
  function call(fn) { try { return fn(); } catch (e) { return undefined; } }
  function lang() { return call(function () { return host.lang(); }) || "en"; }
  function loc() { return call(function () { return root.orosI18n.locale(lang()); }) || (lang() === "el" ? "el-GR" : "en-GB"); }
  function appName(id) { return call(function () { return host.appName(id); }) || id; }
  function strict() { return !!call(function () { return host.strict(); }); }
  function stored() { try { return parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function list() { return listOf(stored()); }
  function row() { return rowOf(stored()); }
  function save(l, look, live) {
    var o = { v: 1, list: l }, cur = stored();
    var lk = look === undefined ? lookOf(cur) : look;
    if (lk) o.look = lk;
    if ((live === undefined ? liveOf(cur) : live) === false) o.live = false;
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
    playing: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
    battery: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5v3"/></svg>',
    ai: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M10 10h4v4h-4zM9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/></svg>',
    tasks: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12l3 3 5-6"/></svg>',
    continue: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="12" height="9" rx="1.5"/><rect x="15.5" y="9" width="6" height="11" rx="1.5"/><path d="M5 18h7M10.5 14.5l3 3-3 3"/></svg>',
    water: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
    budget: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M16 12.5h2M3 10h18"/></svg>',
    // Sparkles: "smart cards". Never a stack of squares, which is the
    // open-apps button (shell.js 10c) right beside it on a phone.
    more: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3l1.9 5.1L17 10l-5.1 1.9L10 17l-1.9-5.1L3 10l5.1-1.9z"/><path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z"/></svg>',
    sales: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16l-1.5 11h-13z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/></svg>'
  };

  var CSS = [
    "#sb-row { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }",
    "#sb-row[hidden], .sb-chip[hidden] { display: none !important; }",
    ".sb-chip { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; padding: 0 8px; background: transparent;",
    "  border: none; border-radius: 8px; color: var(--text); font: inherit; font-size: 12.5px; font-weight: 600;",
    "  font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; }",
    ".sb-chip:focus-visible { background: var(--accent-soft); outline: none; }",
    // Touch screens keep :hover on the last tapped button: hover only where it is real.
    "@media (hover: hover) { .sb-chip:hover { background: var(--accent-soft); } }",
    ".sb-chip svg { display: block; flex-shrink: 0; pointer-events: none; color: var(--accent); }",
    ".sb-chip .sb-v { pointer-events: none; }",
    ".sb-chip .sb-l { pointer-events: none; font-weight: 500; color: var(--text-dim); max-width: 16ch; overflow: hidden; text-overflow: ellipsis; }",
    ".sb-chip.sb-soon .sb-v { color: var(--accent); }",
    ".sb-chip.sb-txt .sb-v { max-width: 22ch; overflow: hidden; text-overflow: ellipsis; }",
    ".sb-chip.sb-now { background: var(--accent-soft); }",
    "#oros-bar.bar-tight .sb-chip { padding: 0 5px; }",
    "@media (max-width: 760px) { .sb-chip .sb-l { display: none; } }",
    "body.solo-mode #sb-row, body.till-mode #sb-row { display: none !important; }",
    // The fold button and its panel (the chips that are not in the bar).
    ".sb-chip.sb-more { gap: 3px; padding: 0 6px; }",
    ".sb-chip.sb-more .sb-v { font-size: 11.5px; }",
    "#oros-bar.bar-tight .sb-chip.sb-more { padding: 0 3px; gap: 2px; min-width: 32px; justify-content: center; }",
    ".sb-chip.sb-more[aria-expanded=\"true\"] { background: var(--accent-soft); }",
    "html.barwin .sb-chip.sb-more { display: none !important; }",
    "#sb-pop { position: fixed; z-index: 1200; top: calc(46px + env(safe-area-inset-top, 0px)); right: 8px; width: 340px;",
    "  max-height: calc(100dvh - 60px - env(safe-area-inset-top, 0px)); overflow: auto; box-sizing: border-box; padding: 8px;",
    "  background: var(--panel-bg, var(--bar-bg)); color: var(--text); border: 1px solid var(--border); border-radius: 18px;",
    "  box-shadow: 0 10px 34px var(--shadow, rgba(0,0,0,.4)); font-size: 14px; }",
    ".sb-card { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 6px 12px; box-sizing: border-box;",
    "  border: none; border-radius: 12px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }",
    ".sb-card + .sb-card { margin-top: 2px; }",
    ".sb-card:hover, .sb-card:focus-visible { background: var(--accent-soft); outline: none; }",
    ".sb-card svg { flex: none; color: var(--accent); width: 18px; height: 18px; }",
    ".sb-card .sb-ct { min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }",
    ".sb-card b { font-size: 14px; font-variant-numeric: tabular-nums; }",
    ".sb-card small { font-size: 12px; color: var(--text-dim); overflow-wrap: anywhere; }",
    ".sb-card.sb-soon b { color: var(--accent); }",
    "@media (max-width: 480px) { #sb-pop { left: 6px; right: 6px; width: auto; } }",
    // PEEK-1: the peek panel (same frame as #sb-pop)
    "#sb-peek { position: fixed; z-index: 1200; top: calc(46px + env(safe-area-inset-top, 0px)); right: 8px; width: 340px;",
    "  max-height: calc(100dvh - 60px - env(safe-area-inset-top, 0px)); overflow: auto; box-sizing: border-box; padding: 10px;",
    "  background: var(--panel-bg, var(--bar-bg)); color: var(--text); border: 1px solid var(--border); border-radius: 18px;",
    "  box-shadow: 0 10px 34px var(--shadow, rgba(0,0,0,.4)); font-size: 14px; }",
    "@media (max-width: 480px) { #sb-peek { left: 6px; right: 6px; width: auto; } }",
    ".pk-h { display: flex; align-items: center; gap: 10px; padding: 2px 6px 8px; }",
    ".pk-h svg { width: 30px; height: 30px; flex: none; color: var(--accent); }",
    ".pk-h b { font-size: 22px; font-variant-numeric: tabular-nums; }",
    ".pk-h small { display: block; color: var(--text-dim); font-size: 12px; overflow-wrap: anywhere; }",
    ".pk-day { display: grid; grid-template-columns: minmax(0, 1fr) 26px auto 44px; align-items: center; gap: 8px; min-height: 40px; padding: 0 6px;",
    "  border-radius: 10px; font-variant-numeric: tabular-nums; }",
    ".pk-day + .pk-day { border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }",
    ".pk-day svg { width: 22px; height: 22px; color: var(--accent); }",
    ".pk-day .pk-pop { color: var(--text-dim); font-size: 12px; text-align: right; }",
    ".pk-day .pk-d { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".pk-nav { display: flex; align-items: center; justify-content: space-between; padding: 0 2px 4px; font-weight: 700; }",
    ".pk-nav button { min-width: 44px; min-height: 40px; border: none; border-radius: 10px; background: transparent; color: var(--text); font: inherit; font-size: 18px; cursor: pointer; }",
    ".pk-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; font-variant-numeric: tabular-nums; }",
    ".pk-wd { font-size: 11px; color: var(--text-dim); padding: 2px 0; }",
    ".pk-grid button { min-height: 36px; border: none; border-radius: 9px; background: transparent; color: var(--text); font: inherit; font-size: 13px; cursor: pointer; padding: 0; }",
    ".pk-grid button.pk-out { color: var(--text-dim); opacity: .55; }",
    ".pk-grid button.pk-now { background: var(--accent); color: var(--accent-ink, var(--bg)); font-weight: 700; }",
    ".pk-sec { margin: 10px 6px 4px; font-size: 12px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: .04em; }",
    ".pk-row { display: flex; align-items: baseline; gap: 10px; width: 100%; min-height: 44px; padding: 6px; box-sizing: border-box; border: none;",
    "  border-radius: 10px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }",
    ".pk-row .pk-t { flex: none; width: 46px; color: var(--accent); font-variant-numeric: tabular-nums; font-size: 13px; }",
    ".pk-row .pk-w { min-width: 0; overflow-wrap: anywhere; }",
    ".pk-row .pk-a { margin-left: auto; flex: none; color: var(--text-dim); font-size: 12px; }",
    ".pk-empty { padding: 6px; color: var(--text-dim); font-size: 13px; }",
    ".pk-open { display: block; width: 100%; min-height: 44px; margin-top: 8px; border: 1px solid var(--border); border-radius: 12px;",
    "  background: transparent; color: var(--accent); font: inherit; font-weight: 700; cursor: pointer; }",
    ".pk-mt { font-size: 16px !important; overflow-wrap: anywhere; }",
    ".pk-ctl { display: flex; justify-content: center; gap: 14px; padding: 6px 0 2px; }",
    ".pk-mb { width: 48px; height: 48px; border: none; border-radius: 50%; background: transparent; color: var(--text); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }",
    ".pk-mb svg { width: 22px; height: 22px; }",
    ".pk-mb.pk-play { background: var(--accent); color: var(--accent-ink, var(--bg)); }",
    "#sb-peek .pk-mb.pk-play:hover, #sb-peek .pk-mb.pk-play:focus-visible { background: var(--accent); outline: 2px solid var(--text); outline-offset: 2px; }",
    "#sb-peek button:hover, #sb-peek button:focus-visible { background: var(--accent-soft); outline: none; }",
    "#sb-peek .pk-grid button.pk-now:hover, #sb-peek .pk-grid button.pk-now:focus-visible { background: var(--accent); outline: 2px solid var(--text); outline-offset: -2px; }",
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

  function isLive(kind) { return LIVE.indexOf(kind) !== -1; }
  // el: what the fit folds; btn: what opens the app (a live pill's el is its group)
  function makeChip(kind) {
    var b = doc.createElement("button");
    b.type = "button";
    b.className = "sb-chip";
    b.setAttribute("data-sb", kind);
    b.innerHTML = icon(kind);                          // fixed markup, never data
    var v = doc.createElement("span"); v.className = "sb-v";
    var l = doc.createElement("span"); l.className = "sb-l";
    b.appendChild(v); b.appendChild(l);
    b.addEventListener("click", function (e) { e.stopPropagation(); go(kind); });
    var c = { el: b, btn: b, v: v, l: l, key: "", go: null, stop: null, sb: null, icon: icon(kind) ? 1 : 0 };
    if (live && isLive(kind)) live.wrap(c, kind, halt);
    c.el.hidden = true;
    return c;
  }

  // ---------- The fold button and its panel ----------
  function folded() { return (root.innerWidth || 0) <= FOLD_W; }
  function makeMore() {
    var b = doc.createElement("button");
    b.type = "button";
    b.className = "sb-chip sb-more";
    b.innerHTML = IC.more;
    var v = doc.createElement("span"); v.className = "sb-v";
    b.appendChild(v);
    b.hidden = true;
    b.setAttribute("aria-haspopup", "dialog");
    b.setAttribute("aria-expanded", "false");
    b.addEventListener("click", function (e) { e.stopPropagation(); if (pop) closePop(true); else openPop(); });
    return { el: b, v: v };
  }
  // The chips the bar has no room for, that have something to say.
  function foldedKinds() {
    return Object.keys(chips).filter(function (k) { var c = chips[k]; return c.key !== "" && c.el.hasAttribute("data-sb-drop"); })
      .sort(function (a, b) { var r = row(); return r.indexOf(a) - r.indexOf(b); });
  }
  function paintMore() {
    if (!more) return;
    var ks = locked() ? [] : foldedKinds(), n = ks.length;
    var all = n && n === Object.keys(chips).filter(function (k) { return chips[k].key !== ""; }).length;
    var txt = n ? (all ? String(n) : "+" + n) : "";
    if (more.v.textContent !== txt) more.v.textContent = txt;
    var tip = t("sb.more.tip").replace("{n}", n);
    if (more.el.title !== tip) { more.el.title = tip; more.el.setAttribute("aria-label", tip); }
    if (more.el.hidden !== !n) more.el.hidden = !n;
    if (!n) closePop();
    else if (pop) fillPop(ks);
  }
  function fillPop(ks) {
    var sig = ks.map(function (k) { return k + "\u0001" + chips[k].key + "\u0001" + (chips[k].stop ? 1 : 0); }).join("\u0002");
    if (pop.getAttribute("data-sig") === sig) return;
    pop.setAttribute("data-sig", sig);
    var had = doc.activeElement && pop.contains(doc.activeElement) ? doc.activeElement.getAttribute("data-sb") : null;
    var hadStop = had && /sb-stop/.test(doc.activeElement.className);
    while (pop.firstChild) pop.removeChild(pop.firstChild);
    ks.forEach(function (k) {
      var c = chips[k], b = doc.createElement("button");
      b.type = "button";
      b.className = "sb-card" + (/\bsb-soon\b|\bsb-now\b/.test(c.btn.className) ? " sb-soon" : "");
      b.setAttribute("data-sb", k);
      b.innerHTML = icon(k);
      var box2 = doc.createElement("span"); box2.className = "sb-ct";
      var val = c.v.textContent + (c.l.textContent && !c.l.hidden ? " " + c.l.textContent : "");
      var tip = c.btn.title || "";
      if (tip.indexOf(c.v.textContent) === 0) tip = tip.slice(c.v.textContent.length).replace(/^[\s·:]+/, "");
      var v = doc.createElement("b"); v.textContent = val;      // textContent: never HTML
      var l = doc.createElement("small"); l.textContent = tip;
      box2.appendChild(v); box2.appendChild(l); b.appendChild(box2);
      b.addEventListener("click", function (e) { e.stopPropagation(); closePop(); go(k); });
      pop.appendChild(c.stop && live ? live.row(b, k, c, halt) : b);
    });
    var f = had && pop.querySelector((hadStop ? ".sb-stop" : ".sb-card") + '[data-sb="' + had + '"]');
    if (f) f.focus();
  }
  function onPopKey(e) { if (e.key === "Escape" && pop) { e.preventDefault(); closePop(true); } }
  function onPopDown(e) {
    if (!pop || pop.contains(e.target) || (more && more.el.contains(e.target))) return;
    closePop();
  }
  function openPop() {
    if (pop || !more) return;
    var ks = foldedKinds();
    if (!ks.length) return;
    pop = doc.createElement("div");
    pop.id = "sb-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", t("sb.more.title"));
    doc.body.appendChild(pop);
    more.el.setAttribute("aria-expanded", "true");
    doc.addEventListener("keydown", onPopKey, true);
    doc.addEventListener("mousedown", onPopDown, true);
    doc.addEventListener("touchstart", onPopDown, true);
    fillPop(ks);
    var first = pop.querySelector(".sb-card");
    if (first) first.focus();
  }
  function closePop(focusBtn) {
    if (!pop) return;
    pop.remove();
    pop = null;
    doc.removeEventListener("keydown", onPopKey, true);
    doc.removeEventListener("mousedown", onPopDown, true);
    doc.removeEventListener("touchstart", onPopDown, true);
    if (more) { more.el.setAttribute("aria-expanded", "false"); if (focusBtn) more.el.focus(); }
  }

  // BAT-1: navigator.getBattery() once, the first time the card is on.
  var bat = null, batAsked = false;
  function watchBattery() {
    if (batAsked) return;
    batAsked = true;
    var nav = root.navigator;
    if (!nav || typeof nav.getBattery !== "function") return;
    call(function () {
      nav.getBattery().then(function (b) {
        var up = function () {
          bat = { level: b.level, charging: b.charging, chargingTime: b.chargingTime };
          if (chips.battery) chips.battery.key = "";
          paint(false);
        };
        ["levelchange", "chargingchange", "chargingtimechange"].forEach(function (ev) { b.addEventListener(ev, up); });
        up();
      }, function () {});
    });
  }

  // ---------- PEEK-1: peek panels ----------
  // One panel at a time, under the bar like #sb-pop. The weather chip is
  // the shell's (#wx-chip); the event peek is the event chip's. Data is
  // painted with textContent; the icons are the shell's own static SVG.
  var peekEl = null, peekKind = "", peekFrom = null, peekAt = null;
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function pbtn(cls, text, fn, label) {
    var b = el("button", cls, text);
    b.type = "button";
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(e); });
    return b;
  }
  function onPeekKey(e) { if (e.key === "Escape" && peekEl) { e.preventDefault(); closePeek(true); } }
  function onPeekDown(e) {
    if (!peekEl || peekEl.contains(e.target) || (peekFrom && peekFrom.contains(e.target))) return;
    closePeek();
  }
  function closePeek(refocus) {
    if (!peekEl) return;
    peekEl.remove();
    peekEl = null;
    doc.removeEventListener("keydown", onPeekKey, true);
    doc.removeEventListener("mousedown", onPeekDown, true);
    doc.removeEventListener("touchstart", onPeekDown, true);
    var from = peekFrom;
    peekFrom = null; peekKind = "";
    if (from) { from.setAttribute("aria-expanded", "false"); if (refocus && doc.contains(from)) from.focus(); }
  }
  function openApp(id) { closePeek(); call(function () { host.open(id); }); }
  function fillWeather(p, w) {
    var l = loc();
    var h = el("div", "pk-h");
    var ic = el("span");
    ic.innerHTML = w.icon || "";                       // the shell's own static icon
    h.appendChild(ic);
    var tx = el("div");
    tx.appendChild(el("b", null, Math.round(w.temp) + "°"));
    tx.appendChild(el("small", null, w.place || ""));
    h.appendChild(tx);
    p.appendChild(h);
    var today = ymdOf(new Date());
    w.days.forEach(function (d) {
      var dt = new Date(+d.date.slice(0, 4), +d.date.slice(5, 7) - 1, +d.date.slice(8, 10));
      var name = d.date === today ? t("pk.today") : dt.toLocaleDateString(l, { weekday: "long" });
      var r = el("div", "pk-day");
      r.appendChild(el("span", "pk-d", name));
      var di = el("span");
      di.innerHTML = d.icon || "";                     // static icon
      di.setAttribute("aria-hidden", "true");
      r.appendChild(di);
      r.appendChild(el("span", null, hiLo(d.max, d.min)));
      r.appendChild(el("span", "pk-pop", typeof d.pop === "number" && d.pop >= 10 ? Math.round(d.pop) + "%" : ""));
      r.setAttribute("aria-label", name + ": " + hiLo(d.max, d.min) + (typeof d.pop === "number" && d.pop >= 10 ? ", " + t("pk.rain").replace("{n}", Math.round(d.pop)) : ""));
      p.appendChild(r);
    });
    p.appendChild(pbtn("pk-open", t("pk.open").replace("{app}", appName("weather") || "Weather"), function () { openApp("weather"); }));
  }
  function monthOf(y, m) {
    var W = root.orosWidgets && root.orosWidgets.model;
    return W && typeof W.monthGrid === "function" ? W.monthGrid(y, m) : [];
  }
  function fillEvent(p) {
    var now = new Date(), today = ymdOf(now), l = loc();
    if (!peekAt) peekAt = { y: now.getFullYear(), m: now.getMonth() };
    var nav = el("div", "pk-nav");
    var title = new Date(peekAt.y, peekAt.m, 1).toLocaleDateString(l, { month: "long", year: "numeric" });
    function shift(n) {
      var d = new Date(peekAt.y, peekAt.m + n, 1);
      peekAt = { y: d.getFullYear(), m: d.getMonth() };
      repaintPeek(n < 0 ? ".pk-prev" : ".pk-next");
    }
    nav.appendChild(pbtn("pk-prev", "‹", function () { shift(-1); }, t("wg.prev")));
    nav.appendChild(el("span", null, title));
    nav.appendChild(pbtn("pk-next", "›", function () { shift(1); }, t("wg.next")));
    p.appendChild(nav);
    var g = el("div", "pk-grid");
    for (var i = 0; i < 7; i++) {                     // 1 Jan 2024 is a Monday
      var wd = el("span", "pk-wd", new Date(2024, 0, 1 + i).toLocaleDateString(l, { weekday: "narrow" }));
      wd.setAttribute("aria-hidden", "true");
      g.appendChild(wd);
    }
    monthOf(peekAt.y, peekAt.m).forEach(function (week) {
      week.forEach(function (c) {
        var long = new Date(c.y, c.m, c.d).toLocaleDateString(l, { weekday: "long", day: "numeric", month: "long" });
        var b = pbtn((c.out ? "pk-out" : "") + (c.ymd === today ? " pk-now" : ""), c.d, function () {
          closePeek(); call(function () { host.openDay(c.ymd); });
        }, long);
        if (c.ymd === today) b.setAttribute("aria-current", "date");
        g.appendChild(b);
      });
    });
    p.appendChild(g);
    p.appendChild(el("div", "pk-sec", t("pk.today")));
    var res = todayCache, hidden = {};
    ((res && res.apps) || []).forEach(function (a) { if (a.sensitive) hidden[a.id] = true; });
    var rows = peekRows(res && res.groups && res.groups.today, hidden, 6);
    var st = strict();
    rows.forEach(function (r) {
      var what = st ? t("sb.event.hidden") : r.title, app = appName(r.app) || r.app;
      var b = pbtn("pk-row", null, function () {
        closePeek(); call(function () { root.orosToday.open(r.app, r.target); });
      }, (r.time ? r.time + " " : "") + what + " · " + app);
      b.appendChild(el("span", "pk-t", r.time || ""));
      b.appendChild(el("span", "pk-w", what));
      b.appendChild(el("span", "pk-a", app));
      p.appendChild(b);
    });
    if (!rows.length) p.appendChild(el("div", "pk-empty", t("pk.none")));
    p.appendChild(pbtn("pk-open", t("pk.open").replace("{app}", appName("calendar") || "Calendar"), function () { openApp("calendar"); }));
  }
  // NOWPLAY-1: what plays, with Previous / Play-Pause / Next and Open.
  var IC_PREV = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="2.5" height="14" rx="1"/><path d="M19 5.8v12.4a.8.8 0 0 1-1.2.7L9 12.7a.8.8 0 0 1 0-1.4l8.8-6.2a.8.8 0 0 1 1.2.7z"/></svg>';
  var IC_NEXT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="16.5" y="5" width="2.5" height="14" rx="1"/><path d="M5 5.8v12.4a.8.8 0 0 0 1.2.7l8.8-6.2a.8.8 0 0 0 0-1.4L6.2 5.1A.8.8 0 0 0 5 5.8z"/></svg>';
  var IC_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var IC_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  var mediaShown = null;               // the player the panel shows (kept while it pauses)
  function fillMedia(p) {
    var list = call(function () { return host.media(); }) || [];
    var m = null;
    if (mediaShown) list.forEach(function (x) { if (x && x.id === mediaShown) m = x; });
    if (!m) { var pl = playingOf(list); m = pl ? pl.m : null; }
    if (!m) return false;
    mediaShown = m.id;
    var parts = String(m.title || "").split(" · "), st = strict();
    var h = el("div", "pk-h");
    var tx = el("div");
    tx.appendChild(el("b", "pk-mt", st ? m.name : (parts[0] || m.name)));
    tx.appendChild(el("small", null, st ? "" : [parts.slice(1).join(" · "), m.name].filter(Boolean).join(" · ")));
    h.appendChild(tx);
    p.appendChild(h);
    var ctl = el("div", "pk-ctl");
    var again = function (sel) { setTimeout(function () { repaintPeek(sel); }, 250); };
    function cb(cls, ic, label, fn) { var b = pbtn(cls, null, fn, label); b.innerHTML = ic; ctl.appendChild(b); }   // static icons
    if (typeof m.prev === "function") cb("pk-mb pk-prev", IC_PREV, t("wg.media.prev") + " · " + m.name, function () { m.prev(); again(".pk-prev"); });
    cb("pk-mb pk-play", m.playing ? IC_PAUSE : IC_PLAY, t(m.playing ? "qs.pause" : "qs.play") + " · " + m.name, function () { m.toggle(); again(".pk-play"); });
    if (typeof m.next === "function") cb("pk-mb pk-next", IC_NEXT, t("wg.media.next") + " · " + m.name, function () { m.next(); again(".pk-next"); });
    p.appendChild(ctl);
    p.appendChild(pbtn("pk-open", t("pk.open").replace("{app}", m.name), function () { closePeek(); call(function () { m.open(); }); }));
    return true;
  }
  function repaintPeek(focusSel) {
    if (!peekEl) return;
    while (peekEl.firstChild) peekEl.removeChild(peekEl.firstChild);
    if (peekKind === "media") {
      if (!fillMedia(peekEl)) { closePeek(); return; }
    } else if (peekKind === "weather") {
      var w = call(function () { return host.weather(); });
      if (!w || !Array.isArray(w.days) || !w.days.length) { closePeek(); return; }
      fillWeather(peekEl, w);
    } else fillEvent(peekEl);
    var f = (focusSel && peekEl.querySelector(focusSel)) || peekEl.querySelector("button");
    if (f) f.focus();
  }
  // → true when a panel opened (or the same one closed); false when there
  // is nothing to show, so the caller opens the app as before.
  function peek(kind, from) {
    if (!host || (kind !== "weather" && kind !== "event" && kind !== "media") || locked()) return false;
    if (peekEl && peekKind === kind) { closePeek(true); return true; }
    closePeek();
    closePop();
    if (kind === "weather") {
      var w = call(function () { return host.weather(); });
      if (!w || !Array.isArray(w.days) || !w.days.length) return false;
    }
    if (kind === "media" && !playingOf(call(function () { return host.media(); }))) return false;
    peekKind = kind;
    peekAt = null;
    mediaShown = null;
    peekFrom = from || null;
    peekEl = el("div");
    peekEl.id = "sb-peek";
    peekEl.setAttribute("role", "dialog");
    peekEl.setAttribute("aria-label", kind === "weather" ? (appName("weather") || "Weather") : kind === "media" ? t("sb.k.playing") : (appName("calendar") || "Calendar"));
    doc.body.appendChild(peekEl);
    if (peekFrom) peekFrom.setAttribute("aria-expanded", "true");
    doc.addEventListener("keydown", onPeekKey, true);
    doc.addEventListener("mousedown", onPeekDown, true);
    doc.addEventListener("touchstart", onPeekDown, true);
    repaintPeek();
    return true;
  }

  function render() {
    if (!host) return;
    var bar = doc.querySelector("#oros-bar .bar-right");
    if (!bar) return;
    var l = row();
    if (!l.length) {
      closePop();
      if (box) { box.remove(); box = null; chips = {}; more = null; }
      call(function () { host.fit(); });
      return;
    }
    if (!box) {
      box = doc.createElement("div");
      box.id = "sb-row";
      bar.insertBefore(box, bar.firstChild);
      more = makeMore();
    }
    Object.keys(chips).forEach(function (k) { if (l.indexOf(k) === -1) { chips[k].el.remove(); delete chips[k]; } });
    l.forEach(function (k) {
      if (!chips[k]) chips[k] = makeChip(k);
      box.appendChild(chips[k].el);                    // list order
      chips[k].key = "";
      if (folded() && !isLive(k)) chips[k].el.setAttribute("data-sb-drop", "1");
    });
    box.appendChild(more.el);                          // always last
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
        go: function () { peek("event", chips.event && chips.event.btn); }   // PEEK-1
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
    // NOWPLAY-1: only while something plays; the title hides under
    // Sensitive work (the app's name stays).
    playing: function () {
      var p = playingOf(call(function () { return host.media(); }));
      if (!p) return null;
      var app = p.m.name || "", what = strict() ? app : p.what;
      return { v: what, l: strict() ? "" : app, cls: "sb-txt",
               tip: t("sb.play.tip").replace("{t}", what).replace("{app}", app),
               go: function () { peek("media", chips.playing && chips.playing.btn); } };
    },
    // BAT-1: the battery the browser reports, read once and then followed
    // through its own events (no polling).
    battery: function () {
      watchBattery();
      var c = batteryCard(bat);
      if (!c) return null;
      var state = t(c.charging ? "sb.bat.charging" : (c.low ? "sb.bat.low" : "sb.bat.label"));
      return { v: c.pct + "%", l: c.charging || c.low ? state : "", cls: c.low ? "sb-soon" : (c.charging ? "sb-now" : ""),
               tip: t("sb.bat.tip").replace("{n}", c.pct).replace("{s}", state),
               go: function () { call(function () { root.orosQS.open(); }); } };
    },
    // AI-USE: numbers only (never a prompt); hidden while the Assistant
    // is locked or hidden on this device.
    ai: function (now) {
      if (call(function () { return root.orosLock.apps.state("assistant"); })) return null;
      var u = aiUsage(readJSON("oros-assistant-prefs"), ymdOf(new Date(now)).slice(0, 7));
      if (!u) return null;
      var nf = function (x) { return call(function () { return x.toLocaleString(loc()); }) || String(x); };
      var near = u.tav >= TAVILY_FREE * 0.8;
      var srch = u.tav ? t("sb.ai.srch").replace("{n}", nf(u.tav)).replace("{max}", nf(TAVILY_FREE)) : "";
      var v = u.tok ? compact(u.tok) : nf(u.tav) + "/" + nf(TAVILY_FREE);
      var l = near && u.tok ? t("sb.ai.near").replace("{n}", nf(u.tav)).replace("{max}", nf(TAVILY_FREE)) : (u.tok ? t("sb.ai.label") : t("sb.ai.searches"));
      var tip = t("sb.ai.tip").replace("{app}", appName("assistant") || "Assistant").replace("{n}", nf(u.tok)) +
        (u.ws ? " · " + t("sb.ai.web").replace("{n}", nf(u.ws)) : "") + (srch ? " · " + srch : "");
      return { v: v, l: l, cls: near ? "sb-soon" : "", tip: tip, go: function () { host.open("assistant"); } };
    },
    tasks: function () {
      var g = todayCache && todayCache.groups;
      var n = taskCount(g);
      if (!n) return null;
      return { v: String(n), l: t(n === 1 ? "sb.tasks.one" : "sb.tasks.n"),
               tip: t("sb.tasks.tip").replace("{n}", n).replace("{app}", appName("today")), go: function () { host.open("today"); } };
    },
    // CONT-1 W2: the newest item of another device (shell orosContinueUi:
    // never the sensitive apps, nothing under Sensitive work), 2 h.
    continue: function (now) {
      var U = root.orosContinueUi;
      if (!U || strict()) return null;
      var it = (call(function () { return U.items(1); }) || [])[0];
      if (!it || now - it.at > CONT_MS) return null;
      return { v: it.title, l: "", cls: "sb-txt", tip: it.tip,
               go: function () { U.open(it.dev, it.app); } };
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

  // SB-LIVE pills: smartbar-live.js
  LIVE.forEach(function (k) {
    STATE[k] = function (now) {
      if (!live) {
        var tr = null, sr = null;
        try { tr = localStorage.getItem("oros-time-timers"); sr = localStorage.getItem("oros-time-sw"); } catch (e) {}
        if (liveWanted(tr, sr, recLive)) loadLive();
        return null;
      }
      return live.state(k, now);
    };
  });
  function loadLive() {
    if (liveLoad || live) return;
    liveLoad = 1;
    script("smartbar-live.js", function () {
      live = call(function () {
        return root.orosSmartBarLive.make({ t: t, call: call, appName: appName, clock: clock, readJSON: readJSON, host: hostFn,
          rec: function (v) { if (v !== undefined) recLive = v; return recLive; }, repaint: repaint });
      }) || null;
      if (!live) { liveLoad = 0; return; }
      LIVE.forEach(function (k) { if (chips[k]) { chips[k].el.remove(); delete chips[k]; } });
      render();
    }, function () { liveLoad = 0; });
  }
  Object.keys(APPS).forEach(function (k) {
    STATE[k] = function (now) {
      if (!apps) { loadApps(); return null; }
      return apps.state(k, now);
    };
  });
  // The other apps' cards: their own file, loaded once from the precache.
  // One of the bar's own files, once, from the precache.
  function script(src, ok, fail) {
    var s = doc.createElement("script");
    s.src = src + "?v=" + (call(function () { return host.version(); }) || "");
    s.onload = ok; s.onerror = fail;
    doc.head.appendChild(s);
  }
  function hostFn() { return host; }
  function repaint(kinds) { kinds.forEach(function (k) { if (chips[k]) chips[k].key = ""; }); paint(true); }
  function loadApps() {
    if (appsLoad || apps) return;
    appsLoad = 1;
    script("smartbar-apps.js", function () {
      apps = call(function () {
        return root.orosSmartBarApps.make({
          t: t, call: call, strict: strict, appName: appName, clock: clock, ymdOf: ymdOf, ttl: TODAY_MS,
          host: hostFn, kinds: function () { return Object.keys(chips); }, repaint: repaint
        });
      }) || null;
      if (!apps) { appsLoad = 0; return; }
      Object.keys(chips).forEach(function (k) { if (APPS[k] && !chips[k].icon) setIcon(chips[k], k); });
      paint(true);
    }, function () { appsLoad = 0; });
  }
  function icon(kind) { return IC[kind] || (apps && apps.icon(kind)) || (live && live.icon(kind)) || ""; }
  function setIcon(c, kind) {
    var svg = icon(kind);
    if (!svg) return;
    var old = c.btn.querySelector("svg");
    if (old) old.remove();
    c.btn.insertAdjacentHTML("afterbegin", svg);   // fixed markup, never data
    c.icon = 1;
  }

  function halt(kind) {
    var c = chips[kind];
    if (c && typeof c.halt === "function") call(c.halt);
    if (chips[kind]) chips[kind].key = "";
    paint(true);
  }

  // Stock's till rules come from its own file, loaded once from the
  // precache the first time the Till chip is on (like the QR encoder).
  function loadPos() {
    if (posLoad || root.OrosStockPosCore) return;
    posLoad = 1;
    script("stock/pos-core.js", function () { repaint(["sales"]); }, function () { posLoad = 0; });
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
  function locked() { return !!call(function () { return root.orosLock.isLocked(); }); }
  function paint(force) {
    if (!host || !box) return;
    // Behind the screen lock the chips go (the desktop bar window has no
    // lock screen over it).
    var lk = locked();
    if (box.hidden !== lk) { box.hidden = lk; force = true; call(function () { host.fit(); }); }
    if (lk) { closePop(); closePeek(); return; }
    refreshToday(false);
    var now = Date.now(), changed = false;
    Object.keys(chips).forEach(function (k) {
      var c = chips[k], s = call(function () { return STATE[k](now); }) || null;
      var key = s ? [s.v, s.l, s.cls, s.tip].join("\u0001") : "";
      c.go = s ? s.go : null;
      if (c.sb) live.paintStop(c, s);
      if (!force && key === c.key) return;
      if (s && c.sb && c.key === "" && c.el.hasAttribute("data-sb-drop")) changed = true;   // a new live pill: refit
      c.key = key;
      if (!s) { if (!c.el.hidden) { c.el.hidden = true; changed = true; } return; }
      if (c.v.textContent !== s.v) c.v.textContent = s.v;      // textContent: never HTML
      if (c.l.textContent !== (s.l || "")) c.l.textContent = s.l || "";
      c.l.hidden = !s.l;
      c.btn.className = "sb-chip" + (s.cls ? " " + s.cls : "");
      if (c.btn.title !== s.tip) { c.btn.title = s.tip; c.btn.setAttribute("aria-label", s.tip); }
      if (c.el.hidden && !c.el.hasAttribute("data-sb-drop")) { c.el.hidden = false; changed = true; }
    });
    paintMore();
    if (changed) call(function () { host.fit(); });
  }

  function attach(h) {
    if (host || !h) return;
    host = h;
    injectCss();
    applyLook();
    render();
    if (root.orosToday && root.orosToday.onChange) root.orosToday.onChange(function () { todayAt = 0; if (apps) apps.stale(); refreshToday(true); paint(false); });
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
      return { list: names, look: lookOf(stored()), looks: LOOKS.slice(), live: liveOf(stored()) };
    },
    setLive: function (on) {
      if (!host) return;
      save(list(), undefined, !!on);
    },
    // Screen Capture's recording { state() → { ms, paused }, stop() } | null, in memory
    live: function (kind, h) {
      if (kind !== "rec") return;
      recLive = h && typeof h.state === "function" && typeof h.stop === "function" ? h : null;
      if (chips.rec) chips.rec.key = "";
      paint(true);
    },
    // SB3: "" (classic), glass, midnight, solid; device-local like the chips
    setLook: function (look) {
      if (!host || LOOKS.indexOf(look) === -1) return;
      save(list(), look);
    },
    wants: function (kind) { return !!host && list().indexOf(kind) !== -1; },
    // PEEK-1: open the "weather" or "event" peek panel under `from`
    peek: function (kind, from) { return peek(kind, from); },
    set: function (kind, on) {
      if (!host || KINDS.indexOf(kind) === -1) return;
      save(toggle(list(), kind, !!on));
    },
    move: function (kind, dir) {
      if (!host || KINDS.indexOf(kind) === -1) return;
      save(step(list(), kind, dir));
    },
    // fitBar(): show every chip again before measuring …
    // On a phone every chip folds into the button at once.
    fitReset: function () {
      var f = folded(), keep = "";
      // on a phone the first live pill stays in the bar
      if (f) LIVE.some(function (k) { if (chips[k] && chips[k].key !== "") { keep = k; return true; } return false; });
      Object.keys(chips).forEach(function (k) {
        var c = chips[k];
        if (f && k !== keep) { c.el.setAttribute("data-sb-drop", "1"); c.el.hidden = true; return; }
        c.el.removeAttribute("data-sb-drop");
        c.el.hidden = c.key === "";
      });
      paintMore();
    },
    // … then fold the last shown chip, one at a time, while the bar does
    // not fit. keep = how many shown chips it leaves (the shell keeps the
    // first one until its last fit level). false = nothing left to hide.
    fitDrop: function (keep) {
      if (!box) return false;
      var shown = Array.prototype.filter.call(box.children, function (el) { return !el.hidden && !(more && el === more.el); });
      if (shown.length <= Math.max(0, keep || 0)) return false;
      var last = shown[shown.length - 1];
      last.hidden = true;
      last.setAttribute("data-sb-drop", "1");
      paintMore();
      return true;
    },
    refresh: function () {
      if (!host) return;
      todayAt = 0;
      if (apps) apps.stale();
      closePop();
      closePeek();
      Object.keys(chips).forEach(function (k) { chips[k].key = ""; });
      render();
    }
  };
  // A chosen look shows from the first paint, before the shell attaches.
  if (lookOf(stored())) { injectCss(); applyLook(); }
})(typeof window !== "undefined" ? window : globalThis);
