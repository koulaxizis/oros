// ============================================================
// orOS — smartbar.js (smart top bar, v1.3.0)
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
//   Live pills (SB-LIVE, v1.3.0), on by default, no tick needed: they
//   show only while something runs, at the start of the row.
//   • tmr   a Time timer (the one ending first, "+N" for the others),
//           time left; oros-time-timers.
//   • sw    the Time stopwatch, time so far; oros-time-sw.
//   • rec   a Screen Capture recording, registered in memory by the
//           Capture window (orosSmartBar.live): nothing stored, so a
//           closed window never leaves a pill behind.
//   Each has a stop button beside it: a timer and the stopwatch pause
//   through Time's own rules (time/clock-core.js, loaded once from the
//   precache; the timer's shell alarm is taken off), a recording stops
//   as with Capture's own Stop button. This is the one place the bar
//   writes another app's data, and only on that button.
//   A chip with nothing to say stays hidden. Money chips and event
//   titles are hidden while Sensitive work is on.
//   A click opens the place the chip comes from.
//   Fit: the shell's fitBar() asks fitDrop() to fold the last chips
//   before it hides the weekday or the date, so the bar never scrolls.
//   Folded chips are not lost: one button (#sb-more, "+N") at the end
//   of the row unfolds them all in a panel under the bar. On a phone
//   (≤ 600 px) every chip folds into that button; on a wide screen the
//   chips stay in the bar and only the ones that do not fit fold.
//
// Device-local (oros-smartbar, never synced: screens differ):
//   { v:1, list:["event","focus",…], live:false? }   order = list order
//   live:false = no live pills (absent = on).
//   Absent = none: the bar looks as before until the person adds one.
//
// Reads only. It never writes another app's data. Pure logic is
// unit-tested in node (tests/smartbar.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.3.0";
  var KEY = "oros-smartbar";
  var KINDS = ["event", "focus", "tasks", "water", "budget", "sales",
               "habits", "plants", "chores", "timer", "invoices", "trip", "kanban", "meal", "reading", "continue"];
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
  // SB-LIVE. The running Time timers (already normalised by Time's
  // timerNorm) → { tm, left: ms, more: how many others run } | null.
  function liveTimer(list, now) {
    var run = (Array.isArray(list) ? list : []).filter(function (x) {
      return x && x.st === "run" && typeof x.end === "number" && x.end > now;
    }).sort(function (a, b) { return a.end - b.end; });
    return run.length ? { tm: run[0], left: run[0].end - now, more: run.length - 1 } : null;
  }
  // The stopwatch (Time's swNorm) → { ms } while it runs, else null.
  function liveSw(sw, now) {
    if (!sw || sw.run !== true || typeof sw.start !== "number") return null;
    return { ms: Math.max(0, (+sw.base || 0) + Math.max(0, now - sw.start)) };
  }
  // A recording's numbers, as Capture reports them → { ms, paused } | null.
  function liveRec(r) {
    if (!r || typeof r.ms !== "number" || !isFinite(r.ms) || r.ms < 0) return null;
    return { ms: r.ms, paused: !!r.paused };
  }
  // The row: live pills first (only while on), then the chosen chips.
  function rowOf(stored) { return (liveOf(stored) ? LIVE.slice() : []).concat(listOf(stored)); }
  function ymdOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  var model = { VER: VER, KEY: KEY, KINDS: KINDS, MONEY: MONEY, SOON_MIN: SOON_MIN,
                norm: norm, parse: parse, listOf: listOf, toggle: toggle, step: step, mins: mins,
                nextEvent: nextEvent, taskCount: taskCount, focusOf: focusOf, clock: clock,
                monthSpent: monthSpent, money: money, ymdOf: ymdOf, LOOKS: LOOKS, lookOf: lookOf, APPS: APPS,
                LIVE: LIVE, liveOf: liveOf, liveTimer: liveTimer, liveSw: liveSw, liveRec: liveRec, rowOf: rowOf };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  var doc = document;
  var host = null, box = null, chips = {}, more = null, pop = null;
  var todayCache = null, todayAt = 0, todayBusy = false, posLoad = 0;
  var apps = null, appsLoad = 0;     // SB5: smartbar-apps.js, once loaded
  var clockLoad = 0, recLive = null;   // SB-LIVE: Time's clock-core.js; Capture's recording

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
    tasks: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12l3 3 5-6"/></svg>',
    continue: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="12" height="9" rx="1.5"/><rect x="15.5" y="9" width="6" height="11" rx="1.5"/><path d="M5 18h7M10.5 14.5l3 3-3 3"/></svg>',
    water: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
    budget: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M16 12.5h2M3 10h18"/></svg>',
    // Sparkles: "smart cards". Never a stack of squares, which is the
    // open-apps button (shell.js 10c) right beside it on a phone.
    more: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3l1.9 5.1L17 10l-5.1 1.9L10 17l-1.9-5.1L3 10l5.1-1.9z"/><path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z"/></svg>',
    sales: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16l-1.5 11h-13z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/></svg>',
    // SB-LIVE: hourglass (timer), stopwatch, the recording dot.
    tmr: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 21h12M7 3c0 5 10 6 10 9s-10 4-10 9M17 3c0 5-10 6-10 9s10 4 10 9"/></svg>',
    sw: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="7.5"/><path d="M12 14V10M10 2.5h4M12 2.5v4M18.5 6.5l1.5-1.5"/></svg>',
    rec: '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>',
    pause: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    stop: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
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
    ".sb-chip.sb-txt .sb-v { max-width: 22ch; overflow: hidden; text-overflow: ellipsis; }",
    ".sb-chip.sb-now { background: var(--accent-soft); }",
    "#oros-bar.bar-tight .sb-chip { padding: 0 5px; }",
    "@media (max-width: 760px) { .sb-chip .sb-l { display: none; } }",
    // SB-LIVE: a pill with its own stop button (two buttons, never nested).
    // The pill's colour is a 32 px band; its buttons keep their 44 px touch height.
    ".sb-live { position: relative; isolation: isolate; display: inline-flex; align-items: center; }",
    ".sb-live::before { content: \"\"; position: absolute; z-index: -1; left: 0; right: 0; top: 6px; bottom: 6px; border-radius: 999px;",
    "  background: var(--accent-soft); pointer-events: none; }",
    ".sb-live .sb-chip { border-radius: 999px; }",
    ".sb-live[hidden] { display: none !important; }",
    ".sb-live .sb-chip:hover, .sb-live .sb-chip:focus-visible { background: color-mix(in srgb, var(--accent) 22%, transparent); }",
    ".sb-stop { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; min-height: 44px; padding: 0;",
    "  border: none; border-radius: 8px; background: transparent; color: var(--text); cursor: pointer; }",
    ".sb-stop:hover, .sb-stop:focus-visible { background: color-mix(in srgb, var(--accent) 22%, transparent); outline: none; }",
    ".sb-stop svg { pointer-events: none; }",
    ".sb-chip.sb-rec svg, .sb-card.sb-rec svg { color: #e5484d; }",
    ".sb-card.sb-rec.sb-paused svg { color: var(--text-dim); }",
    ".sb-chip.sb-rec.sb-paused svg { color: var(--text-dim); }",
    "@media (prefers-reduced-motion: no-preference) { .sb-chip.sb-rec:not(.sb-paused) svg { animation: sb-blink 1.6s ease-in-out infinite; } }",
    "@keyframes sb-blink { 50% { opacity: .35; } }",
    "html[data-oros-motion=\"reduce\"] .sb-chip.sb-rec svg { animation: none !important; }",
    "#oros-bar.bar-tight .sb-stop { min-width: 26px; }",
    "#oros-bar.bar-tight .sb-live .sb-chip { padding: 0 3px 0 7px; gap: 4px; }",
    ".sb-cardrow { display: flex; align-items: center; gap: 4px; }",
    ".sb-cardrow + .sb-cardrow, .sb-cardrow + .sb-card, .sb-card + .sb-cardrow { margin-top: 2px; }",
    ".sb-cardrow .sb-card { flex: 1; min-width: 0; }",
    ".sb-cardrow .sb-stop { min-width: 48px; min-height: 48px; border-radius: 12px; }",
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
  // el: what the fit hides and folds; btn: the button that opens the app
  // (the same element, except for a live pill: el is its group with
  // the stop button beside it).
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
    if (isLive(kind)) {
      var g = doc.createElement("span");
      g.className = "sb-live";
      g.setAttribute("role", "group");
      g.setAttribute("data-sb", kind);
      b.removeAttribute("data-sb");
      g.appendChild(b);
      var sb = doc.createElement("button");
      sb.type = "button";
      sb.className = "sb-stop";
      sb.innerHTML = kind === "rec" ? IC.stop : IC.pause;   // fixed markup, never data
      sb.addEventListener("click", function (e) { e.stopPropagation(); halt(kind); });
      g.appendChild(sb);
      c.el = g; c.sb = sb;
    }
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
    var hadStop = had && doc.activeElement.classList.contains("sb-stop");
    while (pop.firstChild) pop.removeChild(pop.firstChild);
    ks.forEach(function (k) {
      var c = chips[k], b = doc.createElement("button");
      b.type = "button";
      b.className = "sb-card" + (/\bsb-soon\b|\bsb-now\b/.test(c.btn.className) ? " sb-soon" : "") +
        (/\bsb-rec\b/.test(c.btn.className) ? " sb-rec" + (/\bsb-paused\b/.test(c.btn.className) ? " sb-paused" : "") : "");
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
      if (!c.stop) { pop.appendChild(b); return; }
      // SB-LIVE: the card and its stop button side by side.
      var rw = doc.createElement("div"); rw.className = "sb-cardrow";
      var sb = doc.createElement("button");
      sb.type = "button"; sb.className = "sb-stop"; sb.setAttribute("data-sb", k);
      sb.innerHTML = k === "rec" ? IC.stop : IC.pause;   // fixed markup, never data
      sb.title = c.stopTip; sb.setAttribute("aria-label", c.stopTip);
      sb.addEventListener("click", function (e) { e.stopPropagation(); halt(k); });
      rw.appendChild(b); rw.appendChild(sb);
      pop.appendChild(rw);
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
    // SB-LIVE pills. Time's rules come from its own clock-core.js.
    tmr: function (now) {
      var CC = clockCore();
      if (!CC) return null;
      var lt = liveTimer(call(function () { return CC.timerNorm(readJSON("oros-time-timers")); }), now);
      if (!lt) return null;
      var name = lt.tm.name || t("sb.tmr.name"), left = clock(lt.left), id = lt.tm.id;
      return { v: left + (lt.more ? " +" + lt.more : ""), l: name, cls: "sb-soon",
               tip: t("sb.tmr.tip").replace("{n}", name).replace("{r}", left).replace("{app}", appName("time")),
               stop: t("sb.tmr.stop").replace("{n}", name),
               halt: function () { pauseTimer(id); }, go: function () { openTime("timer"); } };
    },
    sw: function (now) {
      var CC = clockCore();
      if (!CC) return null;
      var ls = liveSw(call(function () { return CC.swNorm(readJSON("oros-time-sw")); }), now);
      if (!ls) return null;
      var r = clock(ls.ms);
      return { v: r, l: t("sb.sw.label"), tip: t("sb.sw.tip").replace("{r}", r).replace("{app}", appName("time")),
               stop: t("sb.sw.stop"), halt: pauseSw, go: function () { openTime("stopwatch"); } };
    },
    rec: function () {
      var h = recLive;
      if (!h) return null;
      var lr = liveRec(call(function () { return h.state(); }));
      if (!lr) { recLive = null; return null; }               // the Capture window is gone
      var r = clock(lr.ms), app = appName("capture");
      return { v: lr.paused ? t("sb.rec.paused") + " " + r : r, l: "", cls: "sb-rec" + (lr.paused ? " sb-paused" : ""),
               tip: t(lr.paused ? "sb.rec.tip.p" : "sb.rec.tip").replace("{r}", r).replace("{app}", app),
               stop: t("sb.rec.stop"),
               halt: function () { call(function () { h.stop(); }); recLive = null; call(function () { host.open("capture"); }); paint(true); },
               go: function () { host.open("capture"); } };
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

  Object.keys(APPS).forEach(function (k) {
    STATE[k] = function (now) {
      if (!apps) { loadApps(); return null; }
      return apps.state(k, now);
    };
  });
  // The other apps' cards: their own file, loaded once from the precache.
  function loadApps() {
    if (appsLoad || apps) return;
    appsLoad = 1;
    var s = doc.createElement("script");
    s.src = "smartbar-apps.js?v=" + (call(function () { return host.version(); }) || "");
    s.onload = function () {
      apps = call(function () {
        return root.orosSmartBarApps.make({
          t: t, call: call, strict: strict, appName: appName, clock: clock, ymdOf: ymdOf, ttl: TODAY_MS,
          host: function () { return host; },
          kinds: function () { return Object.keys(chips); },
          repaint: function (kinds) { kinds.forEach(function (k) { if (chips[k]) chips[k].key = ""; }); paint(true); }
        });
      }) || null;
      if (!apps) { appsLoad = 0; return; }
      Object.keys(chips).forEach(function (k) { if (APPS[k] && !chips[k].icon) setIcon(chips[k], k); });
      paint(true);
    };
    s.onerror = function () { appsLoad = 0; };
    doc.head.appendChild(s);
  }
  function icon(kind) { return IC[kind] || (apps && apps.icon(kind)) || ""; }
  function setIcon(c, kind) {
    var svg = icon(kind);
    if (!svg) return;
    var old = c.el.querySelector("svg");
    if (old) old.remove();
    c.el.insertAdjacentHTML("afterbegin", svg);   // fixed markup, never data
    c.icon = 1;
  }

  // SB-LIVE: Time's clock rules (normalise, pause), loaded once from
  // the precache the first time a live pill is on.
  function clockCore() {
    if (root.OrosClockCore) return root.OrosClockCore;
    if (clockLoad) return null;
    clockLoad = 1;
    var s = doc.createElement("script");
    s.src = "time/clock-core.js?v=" + (call(function () { return host.version(); }) || "");
    s.onload = function () { ["tmr", "sw"].forEach(function (k) { if (chips[k]) chips[k].key = ""; }); paint(true); };
    s.onerror = function () { clockLoad = 0; };
    doc.head.appendChild(s);
    return null;
  }
  function openTime(pane) {
    if (call(function () { return host.barwin(); })) { host.open("time"); return; }
    if (typeof root.__orosOpenTime === "function") call(function () { root.__orosOpenTime(pane); });
    else call(function () { host.open("time"); });
  }
  // The stop buttons: pause the way Time's own Pause does (its storage
  // listener redraws an open Time window), the timer's alarm taken off.
  function writeKey(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { call(function () { host.toast(t("sb.savefail")); }); return false; }
  }
  function pauseTimer(id) {
    var CC = root.OrosClockCore;
    if (!CC) return;
    var now = Date.now(), list = CC.timerNorm(readJSON("oros-time-timers")), hit = false;
    list = list.map(function (tm) {
      if (tm.id !== id || tm.st !== "run") return tm;
      hit = true;
      if (tm.aid) { var aid = tm.aid; call(function () { root.orosAlarms.remove(aid); }); }
      var nx = CC.timerPause(tm, now);
      nx.aid = "";
      return nx;
    });
    if (hit) writeKey("oros-time-timers", list);
  }
  function pauseSw() {
    var CC = root.OrosClockCore;
    if (!CC) return;
    var sw = CC.swNorm(readJSON("oros-time-sw"));
    if (sw.run) writeKey("oros-time-sw", CC.swToggle(sw, Date.now()));
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
  function locked() { return !!call(function () { return root.orosLock.isLocked(); }); }
  function paint(force) {
    if (!host || !box) return;
    // Behind the screen lock the chips go (the desktop bar window has no
    // lock screen over it).
    var lk = locked();
    if (box.hidden !== lk) { box.hidden = lk; force = true; call(function () { host.fit(); }); }
    if (lk) { closePop(); return; }
    refreshToday(false);
    var now = Date.now(), changed = false;
    Object.keys(chips).forEach(function (k) {
      var c = chips[k], s = call(function () { return STATE[k](now); }) || null;
      var key = s ? [s.v, s.l, s.cls, s.tip].join("\u0001") : "";
      c.go = s ? s.go : null;
      c.halt = s ? s.halt : null;
      c.stop = s && s.halt && c.sb && !call(function () { return host.barwin(); }) ? 1 : 0;
      c.stopTip = s && s.stop || "";
      if (c.sb) {
        if (c.sb.hidden !== !c.stop) c.sb.hidden = !c.stop;
        if (c.sb.title !== c.stopTip) { c.sb.title = c.stopTip; c.sb.setAttribute("aria-label", c.stopTip); }
      }
      if (!force && key === c.key) return;
      // A live pill that just started: let the fit place it (on a phone
      // it is the one that stays in the bar).
      if (s && c.sb && c.key === "" && c.el.hasAttribute("data-sb-drop")) changed = true;
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
    // SB-LIVE: live pills on/off (device-local, on when absent)
    setLive: function (on) {
      if (!host) return;
      save(list(), undefined, !!on);
    },
    // Screen Capture registers its running recording: { state() → { ms,
    // paused }, stop() }, null when it ends. In memory only.
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
      // SB-LIVE: on a phone the first live pill stays in the bar.
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
      Object.keys(chips).forEach(function (k) { chips[k].key = ""; });
      render();
    }
  };
  // A chosen look shows from the first paint, before the shell attaches.
  if (lookOf(stored())) { injectCss(); applyLook(); }
})(typeof window !== "undefined" ? window : globalThis);
