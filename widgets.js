// ============================================================
// orOS — widgets.js (desktop widgets, v1.7.0)
// ------------------------------------------------------------
// A shell component, like launcher.js and qsettings.js: it runs IN the
// shell document and keeps its own device-local storage. shell.js calls
// attach() once at boot (not in a single app: no desktop) and refresh()
// when the language changes. A bundle without this file draws exactly
// what it drew before.
//
//   • Cards on the desktop: Clock (→ Time), Calendar (a month; a day →
//     that day in the Calendar), Today (late and today's items of the
//     Today summary; a row → its app), Weather (the top bar's weather;
//     → Weather), Playing (Play / Pause for the shell's sounds) and Sync
//     (its state, Sync now).
//   • Playing (WG-MEDIA-2, 1.4.0): the player that plays large, with its
//     cover (what it gave the Media Session), title, progress (Radio:
//     Live), Previous / Play-Pause / Next and a small light (vizkit.js
//     bars) that moves with the sound; "Hide the light" in the card's
//     menu (device-local oros-wg-light "0"). The light listens only
//     while the desktop shows and never restarts a stream. Since 1.7.0
//     (COVERTINT-1) it takes the cover's colours (the shell's mediaTint,
//     contrast checked there), none under high contrast or Sensitive work.
//   • First steps (START-1, 1.1.0): a few first things to do, each
//     ticked by itself from what the person has really done (a note, a
//     task, a wallpaper, an icon pack, sync, the Assistant, installing);
//     a row opens the place. Put on the desktop once for a new user
//     (firstRun, from the shell's first-run tour); "Hide" or the last
//     tick takes it away (on the day after "All done"). Device-local
//     oros-start: { v:1, done:[ids], all:"YYYY-MM-DD" }: a step once
//     done stays done; nothing else is kept and nothing is synced.
//   • Wide screens (≥ 760 px): a column at the right of the desktop;
//     the icon grid keeps clear of it (body.wg-col). Narrow screens and
//     phones: a row of cards at the top of the desktop that scrolls
//     sideways.
//   • Add, remove and order: the desktop menu's "Widgets…" (right-click
//     on the desktop), Settings › Appearance › Desktop widgets, or a
//     card's own menu (right-click, long press or its ⋯ button: Move up,
//     Move down, Remove). With a mouse a card's title drags it to
//     another place.
//   • Hidden while an app covers the desktop; nothing repaints then.
//   • Clock style (1.4.0): Automatic / Digits / LED dots (own glyphs).
//   • One widget gallery (GALLERY-1, 1.5.0): edit() opens a search, All /
//     Desktop / Top bar and a live preview of every desktop card and
//     every smart top bar card (smartbar.js preview()), with Add / Remove
//     and the order arrows. Settings and the desktop menu open it.
//   • Focus timer (FOCUS-W, 1.6.0): the Time app's Pomodoro on the
//     desktop: Focus / Break, Start / Pause / Resume, Skip, ±5 min. Same
//     record as Time (oros-time-pmrun) and the same engine alarm, so
//     Time, the smart bar's Focus card and this card always agree.
//
// oros-widgets (device-local; since LOOK-1 shared between computers by the
// shell's "look" slice, phones keep their own):
//   { v:1, list: ["clock","calendar",…] [, clock] }   order = list order
//   Absent = the default: clock, calendar, today, weather on a wide
//   screen that is not a phone; none on a phone or a narrow window.
//
// Pure logic (prefs, moves, the month grid) is unit-tested in node
// (tests/widgets.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.7.0";
  var KEY = "oros-widgets";
  var START_KEY = "oros-start";
  // First steps, in order. "install" only where the browser offers it
  // or orOS already runs installed.
  var STEPS = ["note", "task", "wall", "icons", "import", "sync", "phone", "assistant", "install"];
  var KINDS = ["start", "clock", "calendar", "today", "pomo", "weather", "media", "sync", "phone"];
  var DEFAULT = ["clock", "calendar", "today", "weather"];
  var WIDE = 760;

  // ---------- 1. Model (pure) ----------
  var CLOCK_STYLES = ["auto", "digits", "dots"];
  function norm(v) {
    if (!v || typeof v !== "object" || !Array.isArray(v.list)) return null;
    var out = [];
    v.list.forEach(function (k) { if (KINDS.indexOf(k) !== -1 && out.indexOf(k) === -1) out.push(k); });
    var r = { v: 1, list: out };
    if (v.clock === "digits" || v.clock === "dots") r.clock = v.clock;
    return r;
  }
  // SIGNAL-1: Automatic = dots with the Signal skin.
  function clockMode(st, skin) { return st === "digits" || st === "dots" ? st : (skin === "signal" ? "dots" : "digits"); }
  // 5×7 LED glyphs, 7 rows of 5 bits each, top first; the colon is 1 wide.
  var GLYPHS = {};
  "01110100011001110101110011000101110 00100011000010000100001000010001110 01110100010000100010001000100011111 11111000100010000010000011000101110 00010001100101010010111110001000010 11111100001111000001000011000101110 00110010001000011110100011000101110 11111000010001000100010000100001000 01110100011000101110100011000101110 01110100011000101111000010001001100"
    .split(" ").forEach(function (b, d) { GLYPHS[d] = b.match(/.{5}/g); });
  GLYPHS[":"] = "0010100".split("");
  // The dots of "21:07": { cols, cells:[{x, y, on}] }, a blank column between glyphs.
  function dotCells(text) {
    var cells = [], x = 0;
    String(text).split("").forEach(function (ch) {
      var g = GLYPHS[ch];
      if (!g) return;
      if (cells.length) x++;
      for (var y = 0; y < 7; y++) for (var i = 0; i < g[0].length; i++) cells.push({ x: x + i, y: y, on: g[y][i] === "1" });
      x += g[0].length;
    });
    return { cols: x, cells: cells };
  }
  function hhmm(d) { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function parse(raw) {
    try { return norm(JSON.parse(raw)); } catch (e) { return null; }
  }
  // The list in use: the stored one, else the default for this screen.
  function listOf(stored, wide, phone) {
    if (stored) return stored.list.slice();
    return wide && !phone ? DEFAULT.slice() : [];
  }
  function toggle(list, kind, on) {
    var out = list.filter(function (k) { return k !== kind; });
    if (on && KINDS.indexOf(kind) !== -1) {
      // A widget comes back at its place in KINDS among those shown.
      var at = out.length;
      for (var i = 0; i < out.length; i++) if (KINDS.indexOf(out[i]) > KINDS.indexOf(kind)) { at = i; break; }
      out.splice(at, 0, kind);
    }
    return out;
  }
  function move(list, kind, to) {
    var i = list.indexOf(kind);
    if (i === -1) return list.slice();
    var out = list.slice();
    out.splice(i, 1);
    to = Math.max(0, Math.min(out.length, to));
    out.splice(to, 0, kind);
    return out;
  }
  // A month as weeks of 7 cells, Monday first: { y, m, d, ymd, out }.
  function monthGrid(y, m) {
    var first = new Date(y, m, 1);
    var lead = (first.getDay() + 6) % 7;
    var start = new Date(y, m, 1 - lead);
    var weeks = [];
    for (var w = 0; w < 6; w++) {
      var row = [];
      for (var d = 0; d < 7; d++) {
        var c = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
        row.push({ y: c.getFullYear(), m: c.getMonth(), d: c.getDate(), ymd: ymdOf(c), out: c.getMonth() !== m });
      }
      weeks.push(row);
    }
    // Drop a last week that lies wholly in the next month.
    while (weeks.length && weeks[weeks.length - 1].every(function (c) { return c.out; })) weeks.pop();
    return weeks;
  }
  function ymdOf(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // First steps (pure). The stored record: the steps once done.
  function startNorm(v) {
    var out = { v: 1, done: [], all: "" };
    if (!v || typeof v !== "object") return out;
    if (Array.isArray(v.done)) v.done.forEach(function (k) { if (STEPS.indexOf(k) !== -1 && out.done.indexOf(k) === -1) out.done.push(k); });
    if (typeof v.all === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.all)) out.all = v.all;
    return out;
  }
  // facts: { note, task, wall, icons, import, sync, assistant: true|false,
  // install: true (installed) | false (can install) | "no" (cannot),
  // phone: true (the phone card is shown) | false | "no" (on a phone) }.
  // A step is done when its fact is true now or it was done before.
  function startRows(facts, rec) {
    facts = facts || {};
    var done = (rec && rec.done) || [];
    // "install" and "phone" only where they can be: true (done) or false
    // (to do); "no" or nothing leaves the step out.
    return STEPS.filter(function (k) { return (k !== "install" && k !== "phone") || facts[k] === true || facts[k] === false; })
      .map(function (k) { return { id: k, done: facts[k] === true || done.indexOf(k) !== -1 }; });
  }
  // What to keep after a paint: the newly done steps join the record;
  // the day everything is done is noted once.
  function startNext(rec, rows, ymd) {
    var out = startNorm(rec);
    rows.forEach(function (r) { if (r.done && out.done.indexOf(r.id) === -1) out.done.push(r.id); });
    if (rows.length && rows.every(function (r) { return r.done; }) && !out.all) out.all = ymd;
    return out;
  }
  // "All done" stays for the rest of that day; the card goes after.
  function startGone(rec, ymd) { return !!(rec && rec.all && rec.all < ymd); }
  // PHONE-1: the address the phone card shows. This orOS when it is a
  // real https site; otherwise (a file, localhost, the Portable or the
  // Live USB) the public one. Never anything but the address.
  function phoneUrlOf(loc) {
    var pub = "https://useoros.online/";
    if (!loc || loc.protocol !== "https:") return pub;
    var h = String(loc.hostname || "");
    if (!h || /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /\.(local|lan|internal)$/.test(h)) return pub;
    return "https://" + h + (loc.port ? ":" + loc.port : "") + String(loc.pathname || "/").replace(/[^/]*$/, "");
  }
  // A new user's first list: First steps, then this screen's default.
  function firstList(stored, wide, phone) {
    if (stored) return null;               // a list is set already: leave it
    return ["start"].concat(listOf(null, wide, phone));
  }

  // FOCUS-W: the Pomodoro leg shared with Time (oros-time-pmrun).
  // Stored forms: running { phase, end, alarmId, start, logged } ·
  // paused { phase, left, paused: 1 } · the next leg { phase, idle: 1 };
  // absent = Focus, not started. done = Focus legs finished here that
  // Time has not counted yet (Time adds them to its synced count and
  // writes the record again without them). Lengths come from Time
  // (pmWork / pmBreak minutes, 25 / 5 by default).
  var PM_KEY = "oros-time-pmrun";
  var PM_MIN = 60000, PM_MAX = 120 * 60000, PM_STEP = 5 * 60000;
  function pmNorm(r) {
    var out = { phase: "work", mode: "idle", done: 0 };
    if (!r || typeof r !== "object" || Array.isArray(r)) return out;
    out.phase = r.phase === "break" ? "break" : "work";
    if (typeof r.done === "number" && r.done >= 1 && r.done < 100) out.done = Math.floor(r.done);
    if (r.paused && typeof r.left === "number" && isFinite(r.left) && r.left > 0) {
      out.mode = "pause"; out.left = Math.min(PM_MAX, Math.round(r.left));
    } else if (!r.idle && typeof r.end === "number" && isFinite(r.end)) {
      out.mode = "run"; out.end = r.end;
      out.alarmId = typeof r.alarmId === "string" ? r.alarmId : "";
      out.start = typeof r.start === "number" && isFinite(r.start) ? r.start : 0;
      out.logged = r.logged ? 1 : 0;
    }
    return out;
  }
  function pmParse(raw) { try { return pmNorm(JSON.parse(raw)); } catch (e) { return pmNorm(null); } }
  // What Time keeps; null = remove the key (Focus, not started, nothing to count).
  function pmRecord(s) {
    var o;
    if (s.mode === "run") o = { phase: s.phase, end: s.end, alarmId: s.alarmId || null, start: s.start || 0, logged: s.logged ? 1 : 0 };
    else if (s.mode === "pause") o = { phase: s.phase, left: s.left, paused: 1 };
    else if (s.phase === "break" || s.done) o = { phase: s.phase, idle: 1 };
    else return null;
    if (s.done) o.done = s.done;
    return o;
  }
  function pmFlip(p) { return p === "work" ? "break" : "work"; }
  // A running leg whose end has passed is over: the other phase is next
  // and a Focus leg counts. Shown so at once; kept so on the next action.
  function pmSettle(s, now) {
    if (s.mode !== "run" || s.end > now) return s;
    return { phase: pmFlip(s.phase), mode: "idle", done: s.done + (s.phase === "work" ? 1 : 0) };
  }
  function pmLens(raw) {
    var d = null;
    try { d = JSON.parse(raw); } catch (e) {}
    var w = d && typeof d.pmWork === "number" && isFinite(d.pmWork) ? Math.min(120, Math.max(1, d.pmWork)) : 25;
    var b = d && typeof d.pmBreak === "number" && isFinite(d.pmBreak) ? Math.min(60, Math.max(1, d.pmBreak)) : 5;
    return { work: w * 60000, "break": b * 60000 };
  }
  function pmLeft(s, now, lens) {
    if (s.mode === "run") return Math.max(0, s.end - now);
    if (s.mode === "pause") return s.left;
    return lens[s.phase];
  }
  function pmStartOf(s, now, lens) {
    if (s.mode === "run") return s;
    return { phase: s.phase, mode: "run", end: now + (s.mode === "pause" ? s.left : lens[s.phase]), start: now, logged: 0, alarmId: "", done: s.done };
  }
  function pmPauseOf(s, now) {
    if (s.mode !== "run") return s;
    return { phase: s.phase, mode: "pause", left: Math.max(1000, s.end - now), done: s.done };
  }
  function pmSkipOf(s) { return { phase: pmFlip(s.phase), mode: "idle", done: s.done }; }
  // ±5 min on a running or paused leg, never under 1 min or over 2 h.
  function pmPlusOf(s, now, ms) {
    function clamp(v) { return Math.min(PM_MAX, Math.max(PM_MIN, v)); }
    if (s.mode === "run") return { phase: s.phase, mode: "run", end: now + clamp(s.end - now + ms), start: s.start, logged: s.logged, alarmId: s.alarmId, done: s.done };
    if (s.mode === "pause") return { phase: s.phase, mode: "pause", left: clamp(s.left + ms), done: s.done };
    return s;
  }
  // m:ss
  function pmClock(ms) {
    var sec = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  // GALLERY-1: search folds case, accents and final sigma ("καιρος"
  // finds "Καιρός"); every word must be in the name or the place.
  function fold(s) {
    s = String(s || "").toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ");   // i18n-inline-ok: Greek final sigma folds for search
  }
  function galMatchOf(it, q, f, placeName) {
    if (f !== "all" && f !== it.place) return false;
    q = fold(q).trim();
    if (!q) return true;
    var hay = fold(it.name + " " + (placeName || ""));
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }
  var PREVIEW_PAINT = ["clock", "calendar", "today", "pomo", "weather", "phone", "sync"];

  var model = { VER: VER, KINDS: KINDS, DEFAULT: DEFAULT, STEPS: STEPS, norm: norm, parse: parse, listOf: listOf,
                toggle: toggle, move: move, monthGrid: monthGrid, ymdOf: ymdOf,
                startNorm: startNorm, startRows: startRows, startNext: startNext, startGone: startGone, firstList: firstList,
                phoneUrlOf: phoneUrlOf, CLOCK_STYLES: CLOCK_STYLES, clockMode: clockMode, GLYPHS: GLYPHS,
                dotCells: dotCells, hhmm: hhmm, fold: fold, galMatchOf: galMatchOf, PREVIEW_PAINT: PREVIEW_PAINT,
                PM_KEY: PM_KEY, PM_STEP: PM_STEP, pmNorm: pmNorm, pmParse: pmParse, pmRecord: pmRecord, pmSettle: pmSettle, pmLens: pmLens,
                pmLeft: pmLeft, pmStartOf: pmStartOf, pmPauseOf: pmPauseOf, pmSkipOf: pmSkipOf, pmPlusOf: pmPlusOf, pmClock: pmClock };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  var doc = document;
  var host = null, box = null, cards = {}, timer = 0, calAt = null, todayCache = null, todayAt = 0, todayBusy = false;

  function t(k) { return typeof root.t === "function" ? root.t(k) : k; }
  function call(fn) { try { return fn(); } catch (e) { return undefined; } }
  function loc() { return call(function () { return root.orosI18n.locale(host.lang()); }) || undefined; }

  function stored() {
    try { return parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function startRead() {
    try { return startNorm(JSON.parse(localStorage.getItem(START_KEY) || "null")); } catch (e) { return startNorm(null); }
  }
  function startWrite(rec) {
    try { localStorage.setItem(START_KEY, JSON.stringify(rec)); } catch (e) {}
  }
  // Shown again by hand: a past "All done" no longer takes it away.
  function startReopen() {
    var rec = startRead();
    if (rec.all) { rec.all = ""; startWrite(rec); }
  }
  function phone() { return call(function () { return host.phone(); }) === true; }
  function wide() { return (root.innerWidth || 0) >= WIDE; }
  function list() { return listOf(stored(), wide(), phone()); }
  function clockStyle() { var s = stored(); return (s && s.clock) || "auto"; }
  function save(l, clock) {
    var rec = { v: 1, list: l };
    var c = clock === undefined ? clockStyle() : clock;
    if (c === "digits" || c === "dots") rec.clock = c;
    try { localStorage.setItem(KEY, JSON.stringify(rec)); }
    catch (e) { call(function () { host.toast(t("wg.savefail")); }); }
    render();
    call(function () { host.changed(); });
  }

  var CSS = [
    "#wg-col { position: absolute; top: calc(16px + var(--ld-st, 0px)); right: calc(16px + var(--ld-sr, 0px)); width: 300px; display: flex; flex-direction: column; gap: 12px;",
    "  z-index: 2; padding-bottom: calc(110px + var(--tb-h, 0px)); }",
    "body.wg-col #ld-desk { margin-right: calc(332px + var(--ld-sr, 0px)); }",
    "#wg-col.wg-strip { position: static; width: auto; flex-direction: row; align-items: flex-start; overflow-x: auto; padding: 12px 10px 4px;",
    "  scroll-snap-type: x proximity; scrollbar-width: thin; }",
    "#wg-col.wg-strip .wg-card { flex: 0 0 min(280px, 82vw); scroll-snap-align: start; }",
    ".wg-card { position: relative; border-radius: 18px; padding: 12px 14px; color: var(--text); box-sizing: border-box;",
    "  background: color-mix(in srgb, var(--panel-bg, var(--bg)) 86%, transparent); border: 1px solid var(--border);",
    "  box-shadow: 0 6px 22px var(--shadow, rgba(0,0,0,.3)); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }",
    "html[data-oros-contrast=\"high\"] .wg-card { background: var(--panel-bg, var(--bg)); backdrop-filter: none; }",
    ".wg-card.wg-drag { opacity: .45; }",
    ".wg-card.wg-over { outline: 2px dashed var(--accent); outline-offset: 2px; }",
    ".wg-head { display: flex; align-items: center; gap: 6px; margin: -2px -6px 6px 0; min-height: 28px; }",
    ".wg-head h2 { flex: 1; margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-dim); }",
    ".wg-card[draggable=\"true\"] .wg-head h2 { cursor: grab; }",
    ".wg-btn { border: none; background: transparent; color: var(--text); font: inherit; cursor: pointer; border-radius: 10px; }",
    ".wg-btn:hover, .wg-btn:focus-visible { background: var(--accent-soft); outline: none; }",
    ".wg-more { width: 32px; height: 32px; font-size: 18px; line-height: 1; color: var(--text-dim); }",
    ".wg-clock { display: block; width: 100%; text-align: left; padding: 2px 4px; }",
    ".wg-time { font-size: 44px; font-weight: 800; line-height: 1.05; letter-spacing: -1px; font-variant-numeric: tabular-nums; }",
    ".wg-dots { display: block; height: 44px; width: auto; max-width: 100%; margin: 2px 0 4px; color: var(--text); }",
    ".wg-dots .wg-off { opacity: .14; }",
    "html[data-oros-contrast=\"high\"] .wg-dots .wg-off { display: none; }",
    ".wg-menu button[aria-checked=\"true\"]::after { content: \" ✓\"; color: var(--accent); font-weight: 800; }",
    ".wg-date { font-size: 14px; color: var(--text-dim); margin-top: 2px; }",
    ".wg-cal-nav { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }",
    ".wg-cal-nav .wg-title { flex: 1; text-align: left; font-weight: 700; padding: 6px 6px; text-transform: capitalize; }",
    ".wg-cal-nav .wg-arrow { width: 36px; height: 36px; font-size: 18px; }",
    ".wg-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }",
    ".wg-grid .wg-wd { font-size: 11px; color: var(--text-dim); padding: 4px 0; text-transform: capitalize; }",
    ".wg-grid .wg-day { min-height: 32px; font-size: 13px; padding: 0; font-variant-numeric: tabular-nums; }",
    ".wg-grid .wg-day.wg-out { color: var(--text-dim); opacity: .6; }",
    ".wg-grid .wg-day.wg-now { background: var(--accent); color: var(--wg-on, #fff); font-weight: 800; border-radius: 50%; }",
    ".wg-list { display: flex; flex-direction: column; gap: 2px; }",
    ".wg-row { display: flex; align-items: baseline; gap: 8px; width: 100%; text-align: left; padding: 7px 6px; min-height: 40px; box-sizing: border-box; }",
    ".wg-row .wg-when { flex: none; width: 46px; font-size: 12px; color: var(--text-dim); font-variant-numeric: tabular-nums; }",
    ".wg-row .wg-when.wg-late { color: var(--danger, #e66); font-weight: 700; }",
    ".wg-row .wg-what { flex: 1; min-width: 0; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".wg-row .wg-app { flex: none; font-size: 11px; color: var(--text-dim); max-width: 34%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".wg-empty { color: var(--text-dim); font-size: 13px; padding: 6px; }",
    ".wg-foot { display: block; width: 100%; text-align: left; padding: 8px 6px 2px; font-size: 13px; color: var(--accent-hover, var(--accent)); }",
    ".wg-wx { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 4px; }",
    ".wg-wx svg { width: 48px; height: 48px; flex: none; }",
    ".wg-wx .wg-temp { font-size: 34px; font-weight: 800; line-height: 1; }",
    ".wg-wx .wg-place { font-size: 13px; color: var(--text-dim); }",
    ".wg-media { display: flex; align-items: center; gap: 8px; }",
    // WG-MEDIA-2: the big row of the player that plays
    ".wg-mbig { display: flex; flex-direction: column; gap: 8px; padding: 2px 2px 6px; }",
    // COVERTINT-1: the cover's colours, as a rounded panel
    ".wg-mbig.wg-tinted { background: var(--wg-tint-bg); color: var(--text); border-radius: 14px; padding: 10px; }",
    ".wg-mbig.wg-tinted button { color: var(--text); }",
    ".wg-mbig.wg-tinted .wg-play { background: var(--accent); color: var(--wg-on); }",
    ".wg-mbig.wg-tinted .wg-bar { background: rgba(255, 255, 255, 0.18); }",
    ".wg-mtop { display: flex; align-items: center; gap: 10px; min-width: 0; }",
    ".wg-cover { flex: none; width: 56px; height: 56px; border-radius: 10px; background: var(--accent-soft, rgba(127,127,127,.2)) center / cover no-repeat;",
    "  display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800; color: var(--accent); }",
    ".wg-cover-img .wg-cover-l { visibility: hidden; }",
    ".wg-mtitle { flex: 1; min-width: 0; flex-direction: column; align-items: flex-start; gap: 2px; padding: 4px 6px; }",
    ".wg-mtitle .wg-what { width: 100%; font-weight: 700; font-size: 14.5px; }",
    ".wg-mtitle .wg-app { max-width: 100%; font-size: 12.5px; }",
    ".wg-mprog .wg-bar { height: 4px; margin: 0; }",
    ".wg-mtime { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-dim); font-variant-numeric: tabular-nums; margin-top: 3px; }",
    ".wg-mlive { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }",
    ".wg-mlight { display: block; width: 100%; height: 40px; border-radius: 8px; }",
    ".wg-mctl { display: flex; align-items: center; justify-content: center; gap: 14px; }",
    ".wg-mbtn { width: 40px; height: 40px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; padding: 0; }",
    ".wg-mbtn svg { width: 20px; height: 20px; }",
    ".wg-mbig + .wg-media { border-top: 1px solid var(--border); padding-top: 6px; }",

    ".wg-media .wg-row { flex: 1; min-width: 0; flex-direction: column; align-items: flex-start; gap: 0; }",
    ".wg-media .wg-what { width: 100%; font-weight: 700; }",
    ".wg-play { width: 40px; height: 40px; flex: none; border-radius: 50%; background: var(--accent); color: var(--wg-on, #fff); display: inline-flex;",
    "  align-items: center; justify-content: center; }",
    ".wg-play:hover, .wg-play:focus-visible { background: var(--accent-hover, var(--accent)); }",
    ".wg-play svg { width: 18px; height: 18px; }",
    // FOCUS-W: the Focus timer
    ".wg-pm { display: flex; flex-direction: column; gap: 6px; }",
    ".wg-pm-go { display: flex; flex-direction: column; align-items: flex-start; padding: 2px 4px; width: 100%; text-align: left; }",
    ".wg-pm-ph { font-size: 13px; font-weight: 700; color: var(--accent-hover, var(--accent)); }",
    ".wg-pm-t { font-size: 40px; font-weight: 800; line-height: 1.05; letter-spacing: -1px; font-variant-numeric: tabular-nums; }",
    ".wg-pm-st { font-size: 12px; color: var(--text-dim); min-height: 15px; }",
    ".wg-pm-ctl { display: flex; align-items: center; gap: 6px; }",
    ".wg-pm-ctl .wg-btn { min-height: 40px; min-width: 40px; padding: 0 10px; border: 1px solid var(--border); font-size: 13px; }",
    ".wg-pm-ctl .wg-pm-main { flex: 1; background: var(--accent); color: var(--wg-on, #fff); border-color: var(--accent); font-weight: 700; }",
    ".wg-pm-ctl .wg-btn:disabled { opacity: .35; cursor: default; }",
    ".wg-sync { display: flex; align-items: center; gap: 10px; }",
    ".wg-sync .wg-what { flex: 1; font-size: 14px; }",
    ".wg-sync .wg-btn.wg-act { padding: 8px 12px; min-height: 40px; border: 1px solid var(--border); }",
    ".wg-phone { display: flex; align-items: center; gap: 12px; }",
    ".wg-qr { flex: none; width: 112px; height: 112px; border-radius: 8px; background: #fff; }",
    ".wg-qr-wait { flex: none; width: 112px; height: 112px; border-radius: 8px; background: var(--accent-soft, rgba(127,127,127,.2)); }",
    ".wg-phone-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }",
    ".wg-phone-txt .wg-what { font-size: 14px; font-weight: 700; }",
    ".wg-phone-url { font-size: 13px; color: var(--accent); overflow-wrap: anywhere; }",
    ".wg-phone-hint { font-size: 12px; color: var(--text-dim); line-height: 1.4; }",
    ".wg-phone .wg-btn.wg-act { padding: 6px 12px; min-height: 40px; border: 1px solid var(--border); }",
    ".wg-bar { height: 6px; border-radius: 3px; background: var(--accent-soft, rgba(127,127,127,.25)); overflow: hidden; margin: 0 6px 6px; }",
    ".wg-bar > span { display: block; height: 100%; background: var(--accent); border-radius: 3px; }",
    ".wg-step { align-items: center; }",
    ".wg-step .wg-chk { flex: none; width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border); box-sizing: border-box;",
    "  display: inline-flex; align-items: center; justify-content: center; }",
    ".wg-step .wg-chk svg { width: 14px; height: 14px; }",
    ".wg-step.wg-ok .wg-chk { background: var(--accent); border-color: var(--accent); color: var(--wg-on, #fff); }",
    ".wg-step.wg-ok .wg-what { color: var(--text-dim); }",
    ".wg-start-foot { display: flex; align-items: center; gap: 8px; padding: 6px 6px 0; }",
    ".wg-start-foot span { flex: 1; font-size: 12px; color: var(--text-dim); }",
    ".wg-start-foot .wg-btn { padding: 6px 10px; min-height: 36px; font-size: 13px; color: var(--text-dim); }",
    ".wg-alldone { font-size: 15px; font-weight: 700; color: var(--text); padding: 8px 6px; }",
    ".wg-menu { position: fixed; z-index: 1300; min-width: 180px; padding: 6px; border-radius: 12px; background: var(--panel-bg, var(--bg));",
    "  border: 1px solid var(--border); box-shadow: 0 8px 26px var(--shadow, rgba(0,0,0,.4)); }",
    ".wg-menu button { display: block; width: 100%; text-align: left; min-height: 40px; padding: 0 12px; }",
    "#wg-dlg { border: 1px solid var(--border); border-radius: 16px; background: var(--panel-bg, var(--bg)); color: var(--text);",
    "  padding: 16px; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px); box-sizing: border-box; display: flex; flex-direction: column; }",
    "#wg-dlg:not([open]) { display: none; }",
    "#wg-dlg::backdrop { background: rgba(0,0,0,.45); }",
    "#wg-dlg h2 { margin: 0 0 4px; font-size: 17px; }",
    "#wg-dlg p { margin: 0 0 10px; font-size: 13px; color: var(--text-dim); }",
    ".wg-pick { display: flex; align-items: center; gap: 8px; min-height: 44px; border-bottom: 1px solid var(--border); }",
    ".wg-pick label { flex: 1; display: flex; align-items: center; gap: 10px; cursor: pointer; }",
    ".wg-pick input { width: 18px; height: 18px; accent-color: var(--accent); }",
    ".wg-pick .wg-btn { width: 36px; height: 36px; }",
    ".wg-pick .wg-btn:disabled { opacity: .3; cursor: default; }",
    // GALLERY-1: search, All / Desktop / Top bar, one row per card with its preview
    ".wg-gal-q { width: 100%; box-sizing: border-box; min-height: 40px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--border);",
    "  background: var(--bg); color: var(--text); font: inherit; margin-bottom: 8px; }",
    ".wg-gal-seg { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }",
    ".wg-gal-seg .wg-btn { min-height: 36px; padding: 0 12px; border: 1px solid var(--border); border-radius: 999px; font-size: 13px; }",
    ".wg-gal-seg .wg-btn[aria-pressed=\"true\"] { background: var(--accent); color: var(--wg-on, #fff); border-color: var(--accent); }",
    ".wg-gal { overflow-y: auto; min-height: 0; flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 2px; }",
    ".wg-gi { display: flex; gap: 12px; align-items: center; padding: 8px; border: 1px solid var(--border); border-radius: 14px; }",
    ".wg-gi.wg-gon { border-color: var(--accent); }",
    ".wg-prev { flex: 0 0 180px; max-height: 120px; overflow: hidden; pointer-events: none; user-select: none; border-radius: 12px; }",
    ".wg-prev .wg-card { transform: scale(.6); transform-origin: top left; width: 300px; box-shadow: none; }",
    ".wg-prev-bar { display: flex; flex-direction: column; justify-content: center; gap: 4px; min-height: 56px; padding: 0 6px;",
    "  background: var(--panel-bg, var(--bg)); border: 1px solid var(--border); }",
    ".wg-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".wg-chip-ic svg { display: block; color: var(--accent); }",
    ".wg-prev-bar small { font-size: 11px; color: var(--text-dim); }",
    ".wg-gm { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }",
    ".wg-gn { font-weight: 700; }",
    ".wg-gt { font-size: 12px; color: var(--text-dim); }",
    ".wg-ga { display: flex; align-items: center; gap: 4px; margin-top: 4px; flex-wrap: wrap; }",
    ".wg-ga .wg-gadd { min-height: 36px; padding: 0 12px; border: 1px solid var(--border); font-size: 13px; }",
    ".wg-ga .wg-gadd[aria-pressed=\"true\"] { border-color: var(--accent); }",
    ".wg-ga .wg-btn:not(.wg-gadd) { width: 36px; height: 36px; }",
    ".wg-ga .wg-btn:disabled { opacity: .3; cursor: default; }",
    "@media (max-width: 480px) { .wg-gi { flex-direction: column; align-items: stretch; } .wg-prev { flex-basis: auto; max-height: 100px; } }",
    ".wg-dlg-foot { display: flex; justify-content: flex-end; margin-top: 12px; }",
    ".wg-dlg-foot .wg-btn { padding: 8px 16px; min-height: 40px; background: var(--accent); color: var(--wg-on, #fff); font-weight: 700; }"
  ].join("\n");

  var SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var IC_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var IC_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  var IC_PREV = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="2.5" height="14" rx="1"/><path d="M19 5.8v12.4a.8.8 0 0 1-1.2.7L9 12.7a.8.8 0 0 1 0-1.4l8.8-6.2a.8.8 0 0 1 1.2.7z"/></svg>';
  var IC_NEXT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="16.5" y="5" width="2.5" height="14" rx="1"/><path d="M5 5.8v12.4a.8.8 0 0 0 1.2.7l8.8-6.2a.8.8 0 0 0 0-1.4L6.2 5.1A.8.8 0 0 0 5 5.8z"/></svg>';
  var IC_UP = SV + '<path d="M18 15l-6-6-6 6"/></svg>';
  var IC_DOWN = SV + '<path d="M6 9l6 6 6-6"/></svg>';
  var IC_TICK = SV.replace('stroke-width="2"', 'stroke-width="3"') + '<path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  // First steps: the label of each step.
  var STEP_TEXT = {
    note: "wg.start.note", task: "wg.start.task", wall: "wg.start.wall", icons: "wg.start.icons", import: "wg.start.import",
    sync: "wg.start.sync", phone: "wg.start.phone", assistant: "wg.start.assistant", install: "wg.start.install"
  };

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(cls, text, fn, label) {
    var b = el("button", "wg-btn" + (cls ? " " + cls : ""), text);
    b.type = "button";
    if (label) { b.setAttribute("aria-label", label); b.title = label; }
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(e); });
    return b;
  }
  function nameOf(kind) { return t("wg." + kind); }
  // m:ss (h:mm:ss from an hour), for the Media card's progress.
  function clock(s) {
    s = Math.max(0, Math.floor(+s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x;
  }

  // WG-MEDIA-2: the Media card's little light. Device-local on / off
  // (oros-wg-light "0" = off; absent = on), from the card's menu.
  var LIGHT_KEY = "oros-wg-light";
  function mediaLightOn() {
    try { return root.localStorage.getItem(LIGHT_KEY) !== "0"; } catch (e) { return true; }
  }
  function mediaLightSet(on) {
    try { if (on) root.localStorage.removeItem(LIGHT_KEY); else root.localStorage.setItem(LIGHT_KEY, "0"); } catch (e) {}
    if (cards.media) { cards.media.key = ""; PAINT.media(cards.media); }
  }
  function mediaLightStart(c) {
    var L = host.mediaLight, mp = c.mp;
    if (!L || !mp || !mp.cv) return;
    call(function () {
      L.kit().then(function (V) {
        if (c.mp !== mp || !V) return;
        mp.v = V.create(mp.cv, {
          style: "bars",
          source: function () { return L.frame(); },
          playing: function () { return !!(c.mp && c.mp.playing); },
          colors: function () { return { a: getComputedStyle(doc.documentElement).getPropertyValue("--accent").trim(), bg: "transparent" }; },
          saver: function () { return doc.documentElement.getAttribute("data-oros-saver") === "1"; },
          paused: covered,
          soft: 0.8,
          rest: true
        });
        L.tap(mp.playing && !covered());
      }, function () {});
    });
  }
  function mediaLightStop(c) {
    if (c.mp && c.mp.v) { try { c.mp.v.destroy(); } catch (e) {} c.mp.v = null; }
    mediaLightRelease();
  }
  function mediaLightRelease() { if (host && host.mediaLight) call(function () { host.mediaLight.tap(false); }); }

  // ---------- 3. Layout ----------
  function covered() { return !!call(function () { return host.running(); }); }

  function render() {
    if (!host) return;
    var l = list();
    var desk = host.desktop;
    if (!l.length) {
      if (box) { box.remove(); box = null; }
      cards = {};
      doc.body.classList.remove("wg-col");
      return;
    }
    if (!box) {
      box = el("section");
      box.id = "wg-col";
      box.setAttribute("aria-label", t("wg.title"));
      wireDrag(box);
    }
    var strip = !wide();
    box.classList.toggle("wg-strip", strip);
    doc.body.classList.toggle("wg-col", !strip);
    // Narrow: the row sits at the top of the desktop, after the sticky
    // notes' row; wide: anywhere (absolute).
    var after = doc.getElementById("sn-strip");
    if (strip) {
      if (after && after.parentNode === desk) { if (after.nextSibling !== box) desk.insertBefore(box, after.nextSibling); }
      else if (desk.firstChild !== box) desk.insertBefore(box, desk.firstChild);
    } else if (box.parentNode !== desk) desk.appendChild(box);
    box.setAttribute("aria-label", t("wg.title"));
    var keep = {};
    l.forEach(function (kind) {
      var c = cards[kind] || makeCard(kind);
      keep[kind] = c;
      box.appendChild(c.node);          // appendChild moves: list order
    });
    Object.keys(cards).forEach(function (k) { if (!keep[k]) cards[k].node.remove(); });
    cards = keep;
    paintAll(true);
  }

  function makeCard(kind) {
    var node = el("article", "wg-card");
    node.setAttribute("data-wg", kind);
    node.setAttribute("aria-label", nameOf(kind));
    var head = el("div", "wg-head");
    var h = el("h2", null, nameOf(kind));
    head.appendChild(h);
    head.appendChild(btn("wg-more", "⋯", function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      cardMenu(kind, r.right - 180, r.bottom + 4);
    }, t("wg.menu").replace("{w}", nameOf(kind))));
    node.appendChild(head);
    var body = el("div", "wg-body");
    node.appendChild(body);
    node.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      e.stopPropagation();
      cardMenu(kind, e.clientX, e.clientY);
    });
    longPress(node, function (x, y) { cardMenu(kind, x, y); });
    return { node: node, head: h, body: body, kind: kind, key: "" };
  }

  // Long press (touch) on a card: its menu.
  function longPress(node, fn) {
    var tm = 0, x0 = 0, y0 = 0;
    node.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      x0 = e.clientX; y0 = e.clientY;
      clearTimeout(tm);
      tm = setTimeout(function () { tm = 0; fn(x0, y0); }, 550);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      node.addEventListener(ev, function () { clearTimeout(tm); });
    });
    node.addEventListener("pointermove", function (e) {
      if (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10) clearTimeout(tm);
    });
  }

  // Mouse: drag a card by its title to another place.
  function wireDrag(col) {
    var dragging = null;
    col.addEventListener("dragstart", function (e) {
      var c = e.target.closest && e.target.closest(".wg-card");
      if (!c) return;
      dragging = c.getAttribute("data-wg");
      c.classList.add("wg-drag");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragging); } catch (x) {}
    });
    col.addEventListener("dragover", function (e) {
      if (!dragging) return;
      var c = e.target.closest && e.target.closest(".wg-card");
      e.preventDefault();
      [].forEach.call(col.querySelectorAll(".wg-over"), function (n) { if (n !== c) n.classList.remove("wg-over"); });
      if (c && c.getAttribute("data-wg") !== dragging) c.classList.add("wg-over");
    });
    col.addEventListener("drop", function (e) {
      if (!dragging) return;
      e.preventDefault();
      var c = e.target.closest && e.target.closest(".wg-card");
      var l = list();
      if (c) save(move(l, dragging, l.indexOf(c.getAttribute("data-wg"))));
    });
    col.addEventListener("dragend", function () {
      dragging = null;
      [].forEach.call(col.querySelectorAll(".wg-drag, .wg-over"), function (n) { n.classList.remove("wg-drag", "wg-over"); });
    });
  }

  // ---------- 4. Menus and the picker ----------
  function closeMenu() {
    var m = doc.getElementById("wg-menu");
    if (m) m.remove();
    doc.removeEventListener("mousedown", onMenuDown, true);
  }
  function onMenuDown(e) {
    var m = doc.getElementById("wg-menu");
    if (m && !m.contains(e.target)) closeMenu();
  }
  function cardMenu(kind, x, y) {
    closeMenu();
    var l = list(), i = l.indexOf(kind);
    var m = el("div", "wg-menu");
    m.id = "wg-menu";
    m.setAttribute("role", "menu");
    var items = [];
    if (i > 0) items.push([t("wg.up"), function () { save(move(l, kind, i - 1)); }]);
    if (i < l.length - 1) items.push([t("wg.down"), function () { save(move(l, kind, i + 1)); }]);
    if (kind === "media" && host.mediaLight) {
      var lon = mediaLightOn();
      items.push([t(lon ? "wg.media.lightOff" : "wg.media.lightOn"), function () { mediaLightSet(!lon); }]);
    }
    items.push([t("wg.remove"), function () { save(toggle(l, kind, false)); }]);
    if (kind === "clock") {
      var cs = clockStyle();
      CLOCK_STYLES.forEach(function (st) {
        items.push([t("wg.clock." + st), function () { save(list(), st); }, cs === st]);
      });
    }
    items.push([t("wg.edit"), edit]);
    items.forEach(function (it) {
      var b = btn("", it[0], function () { closeMenu(); it[1](); });
      if (it.length > 2) { b.setAttribute("role", "menuitemradio"); b.setAttribute("aria-checked", it[2] ? "true" : "false"); }
      else b.setAttribute("role", "menuitem");
      m.appendChild(b);
    });
    m.addEventListener("keydown", function (e) {
      var bs = [].slice.call(m.querySelectorAll("button")), j = bs.indexOf(doc.activeElement);
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); bs[(j + 1) % bs.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); bs[(j - 1 + bs.length) % bs.length].focus(); }
    });
    doc.body.appendChild(m);
    var r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, root.innerWidth - r.width - 8)) + "px";
    m.style.top = Math.max(8, Math.min(y, root.innerHeight - r.height - 8)) + "px";
    doc.addEventListener("mousedown", onMenuDown, true);
    m.querySelector("button").focus();
  }

  // The picker: every widget with a tick, and up / down for the shown.
  function edit() {
    var d = doc.getElementById("wg-dlg");
    if (!d) {
      d = el("dialog");
      d.id = "wg-dlg";
      d.setAttribute("aria-labelledby", "wg-dlg-h");
      doc.body.appendChild(d);
      d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
    }
    paintPicker(d);
    if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute("open", ""); } }
  }
  // GALLERY-1 (1.5.0): one gallery for the desktop widgets and the smart
  // top bar's cards (smartbar.js, when it is attached): a search field,
  // All / Desktop / Top bar, a live preview of each (a painted copy of
  // the desktop card, inert; the bar card as it would show now), Add /
  // Remove, and the arrows that order what is on.
  var galQ = "", galF = "all";
  function bar() { var B = root.orosSmartBar; return B && typeof B.snapshot === "function" && B.snapshot() ? B : null; }
  function galItems() {
    var l = list(), out = [];
    l.concat(KINDS.filter(function (k) { return l.indexOf(k) === -1; })).forEach(function (k) {
      out.push({ place: "desk", id: k, name: nameOf(k), on: l.indexOf(k) !== -1, i: l.indexOf(k), n: l.length });
    });
    var B = bar(), snap = B ? B.snapshot() : null;
    if (snap) {
      var onIds = snap.list.filter(function (w) { return w.on; }).map(function (w) { return w.id; });
      snap.list.forEach(function (w) {
        out.push({ place: "bar", id: w.id, name: w.name, on: w.on, i: onIds.indexOf(w.id), n: onIds.length });
      });
    }
    return out;
  }
  function galMatch(it) {
    return galMatchOf(it, galQ, galF, t(it.place === "desk" ? "wg.gal.desk" : "wg.gal.bar"));
  }
  // A desktop card painted once, as a picture (inert: nothing in it
  // can be pressed or focused). Only cards whose painting reads and
  // never writes (PREVIEW_PAINT): Playing (its light must never start
  // from a preview) and First steps (it keeps its own record) show a
  // line instead.
  function deskPreview(kind) {
    var box2 = el("div", "wg-prev");
    box2.setAttribute("aria-hidden", "true");
    box2.inert = true;
    var node = el("article", "wg-card");
    node.setAttribute("data-wg", kind);
    var body = el("div", "wg-body");
    node.appendChild(body);
    if (PREVIEW_PAINT.indexOf(kind) === -1) body.appendChild(el("div", "wg-empty", t(kind === "media" ? "wg.media.none" : "wg.gal.startPv")));
    else call(function () { PAINT[kind]({ node: node, body: body, head: el("h2"), kind: kind, key: "" }, true); });
    box2.appendChild(node);
    return box2;
  }
  function barPreview(kind) {
    var box2 = el("div", "wg-prev wg-prev-bar");
    box2.setAttribute("aria-hidden", "true");
    var p = call(function () { return root.orosSmartBar.preview(kind); }) || {};
    var chip = el("span", "wg-chip");
    var ic = el("span", "wg-chip-ic");
    ic.innerHTML = p.icon || "";                       // smartbar.js's fixed icons
    chip.appendChild(ic);
    chip.appendChild(el("b", null, p.v || "—"));
    if (p.l) chip.appendChild(el("span", null, p.l));
    box2.appendChild(chip);
    if (!p.v) box2.appendChild(el("small", null, t("wg.gal.quiet")));
    return box2;
  }
  function galSet(it, on) {
    if (it.place === "desk") {
      if (it.id === "start" && on) startReopen();
      save(toggle(list(), it.id, on));
    } else call(function () { root.orosSmartBar.set(it.id, on); });
  }
  function galMove(it, dir) {
    if (it.place === "desk") save(move(list(), it.id, it.i + dir));
    else call(function () { root.orosSmartBar.move(it.id, dir); });
  }
  function paintPicker(d) {
    var keepFocus = doc.activeElement && d.contains(doc.activeElement) ? doc.activeElement.getAttribute("data-k") : null;
    d.textContent = "";
    var h = el("h2", null, t("wg.gal.title"));
    h.id = "wg-dlg-h";
    d.appendChild(h);
    d.appendChild(el("p", null, t("wg.gal.hint")));
    var q = el("input", "wg-gal-q");
    q.type = "search";
    q.value = galQ;
    q.placeholder = t("wg.gal.find");
    q.setAttribute("aria-label", t("wg.gal.find"));
    q.setAttribute("data-k", "q");
    q.addEventListener("input", function () { galQ = q.value.slice(0, 60); paintList(); });
    d.appendChild(q);
    var hasBar = !!bar();
    if (hasBar) {
      var seg = el("div", "wg-gal-seg");
      seg.setAttribute("role", "group");
      seg.setAttribute("aria-label", t("wg.gal.show"));
      [["all", "wg.gal.all"], ["desk", "wg.gal.desk"], ["bar", "wg.gal.bar"]].forEach(function (f) {
        var b = btn("", t(f[1]), function () { galF = f[0]; paintPicker(d); focusK(d, "f:" + f[0]); });
        b.setAttribute("aria-pressed", galF === f[0] ? "true" : "false");
        b.setAttribute("data-k", "f:" + f[0]);
        seg.appendChild(b);
      });
      d.appendChild(seg);
    } else galF = "all";
    var listEl = el("div", "wg-gal");
    d.appendChild(listEl);
    function paintList() {
      listEl.textContent = "";
      var items = galItems().filter(galMatch);
      items.forEach(function (it) {
        var k = (it.place === "desk" ? "wg:" : "sb:") + it.id;
        var row = el("div", "wg-gi" + (it.on ? " wg-gon" : ""));
        row.appendChild(it.place === "desk" ? deskPreview(it.id) : barPreview(it.id));
        var meta = el("div", "wg-gm");
        meta.appendChild(el("span", "wg-gn", it.name));
        meta.appendChild(el("span", "wg-gt", t(it.place === "desk" ? "wg.gal.desk" : "wg.gal.bar")));
        var acts = el("div", "wg-ga");
        var add = btn("wg-gadd", t(it.on ? "wg.gal.remove" : (it.place === "desk" ? "wg.gal.addDesk" : "wg.gal.addBar")), function () {
          galSet(it, !it.on); paintPicker(d); focusK(d, k);
        }, (it.on ? t("wg.gal.remove") : t(it.place === "desk" ? "wg.gal.addDesk" : "wg.gal.addBar")) + " · " + it.name);
        add.setAttribute("aria-pressed", it.on ? "true" : "false");
        add.setAttribute("data-k", k);
        acts.appendChild(add);
        if (it.on) {
          var up = btn("", "", function () { galMove(it, -1); paintPicker(d); focusK(d, "up:" + k); }, t("wg.up") + " · " + it.name);
          up.innerHTML = IC_UP;
          up.setAttribute("data-k", "up:" + k);
          up.disabled = it.i <= 0;
          var dn = btn("", "", function () { galMove(it, 1); paintPicker(d); focusK(d, "down:" + k); }, t("wg.down") + " · " + it.name);
          dn.innerHTML = IC_DOWN;
          dn.setAttribute("data-k", "down:" + k);
          dn.disabled = it.i >= it.n - 1;
          acts.appendChild(up);
          acts.appendChild(dn);
        }
        meta.appendChild(acts);
        row.appendChild(meta);
        listEl.appendChild(row);
      });
      if (!items.length) listEl.appendChild(el("div", "wg-empty", t("wg.gal.none")));
    }
    paintList();
    var foot = el("div", "wg-dlg-foot");
    foot.appendChild(btn("", t("wg.done"), function () { d.close(); }));
    d.appendChild(foot);
    if (keepFocus === "q") { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) {} }
  }
  function focusK(d, k) {
    var n = d.querySelector('[data-k="' + k + '"]');
    if (n && !n.disabled) n.focus();
    else { var c = d.querySelector('[data-k="wg:' + k.split(":")[1] + '"]'); if (c) c.focus(); }
  }

  // ---------- 5. The widgets ----------
  function paintAll(force) {
    if (box && covered() && !force) { mediaLightRelease(); return; }   // WG-MEDIA-2: no listening under an app
    if (!box || (covered() && !force)) return;
    var on = onAccent();
    if (on) box.style.setProperty("--wg-on", on);
    Object.keys(cards).forEach(function (k) {
      var c = cards[k];
      c.head.textContent = nameOf(k);
      c.node.draggable = !strip() && !!(root.matchMedia && root.matchMedia("(pointer: fine)").matches);
      call(function () { PAINT[k](c, force); });
    });
  }
  function strip() { return !!(box && box.classList.contains("wg-strip")); }
  function onAccent() {
    var Q = root.orosQS && root.orosQS.model;
    return Q && Q.onAccent ? Q.onAccent(getComputedStyle(doc.documentElement).getPropertyValue("--accent")) : "";
  }
  // SIGNAL-1: the time as LED dots, unlit ones faint (.wg-off).
  function dotSvg(text) {
    var d = dotCells(text);
    function sv(tag, at) { var n = doc.createElementNS("http://www.w3.org/2000/svg", tag); for (var k in at) n.setAttribute(k, at[k]); return n; }
    var s = sv("svg", { "class": "wg-dots", viewBox: "0 0 " + d.cols * 6 + " 42", "aria-hidden": "true", focusable: "false" });
    d.cells.forEach(function (c) {
      var a = { cx: c.x * 6 + 3, cy: c.y * 6 + 3, r: 2.3, fill: "currentColor" };
      if (!c.on) a["class"] = "wg-off";
      s.appendChild(sv("circle", a));
    });
    return s;
  }
  // Repaint a card's body only when what it shows changed.
  function fill(c, key, build) {
    if (c.key === key) return;
    c.key = key;
    c.body.textContent = "";
    build(c.body);
  }

  // FOCUS-W: read, change and keep the leg; the engine alarm (shell
  // orosAlarms, the one Time uses) rings at its end. Nothing else is
  // written: Time counts the finished Focus legs (done) when it opens.
  function pmNow(now) {
    var raw = null;
    try { raw = localStorage.getItem(PM_KEY); } catch (e) {}
    return pmSettle(pmParse(raw), now);
  }
  function pmLensNow() {
    var raw = null;
    try { raw = localStorage.getItem("oros-time-data"); } catch (e) {}
    return pmLens(raw);
  }
  function pmAct(what) {
    var A = root.orosAlarms, now = Date.now(), raw = null;
    try { raw = localStorage.getItem(PM_KEY); } catch (e) {}
    var was = pmParse(raw), s = pmSettle(was, now), next;
    if (what === "start") next = pmStartOf(s, now, pmLensNow());
    else if (what === "pause") next = pmPauseOf(s, now);
    else if (what === "skip") next = pmSkipOf(s);
    else next = pmPlusOf(s, now, what === "minus" ? -PM_STEP : PM_STEP);
    if (next === was) return;
    var id = "";
    if (next.mode === "run" && next.end !== was.end) {
      if (!A) return;
      id = call(function () { return A.add({ at: next.end, label: t(next.phase === "work" ? "wg.pomo.break" : "wg.pomo.work") }); });
      if (!id) return;                     // the engine said no: nothing changes
      next.alarmId = id;
    }
    if (was.mode === "run" && was.alarmId && was.alarmId !== next.alarmId && A) call(function () { A.remove(was.alarmId); });
    var rec = pmRecord(next);
    try { if (rec) localStorage.setItem(PM_KEY, JSON.stringify(rec)); else localStorage.removeItem(PM_KEY); } catch (e) {}
    if (cards.pomo) { cards.pomo.key = ""; PAINT.pomo(cards.pomo); }
  }

  var startFacts = null, startAt = 0;
  var PAINT = {
    // First steps (START-1). The facts are read again every 5 s at most
    // (Notes and To-Do are parsed for them), or at once when forced.
    start: function (c, force) {
      var S = host.start;
      var now = Date.now();
      if (!startFacts || force || now - startAt > 5000) {
        startFacts = (S && call(function () { return S.facts(); })) || {};
        startAt = now;
      }
      var ymd = ymdOf(new Date()), rec = startRead();
      if (startGone(rec, ymd)) {                       // "All done" was yesterday: the card goes
        setTimeout(function () { if (list().indexOf("start") !== -1) save(toggle(list(), "start", false)); }, 0);
        return;
      }
      var rows = startRows(startFacts, rec);
      var next = startNext(rec, rows, ymd);
      if (JSON.stringify(next) !== JSON.stringify(rec)) startWrite(next);
      var n = rows.filter(function (r) { return r.done; }).length;
      fill(c, JSON.stringify(rows) + host.lang(), function (b) {
        var hide = btn("", t("wg.start.hide"), function () { save(toggle(list(), "start", false)); });
        var foot = el("div", "wg-start-foot");
        if (n === rows.length) {
          b.appendChild(el("div", "wg-alldone", t("wg.start.all")));
        } else {
          var bar = el("div", "wg-bar");
          bar.setAttribute("aria-hidden", "true");
          var fillBar = el("span");
          fillBar.style.width = Math.round(100 * n / Math.max(1, rows.length)) + "%";
          bar.appendChild(fillBar);
          b.appendChild(bar);
          var listEl = el("div", "wg-list");
          rows.forEach(function (r) {
            var label = t(STEP_TEXT[r.id]);
            var row = btn("wg-row wg-step" + (r.done ? " wg-ok" : ""), null, function () {
              call(function () { S.go(r.id); });
              setTimeout(function () { startAt = 0; c.key = ""; if (cards.start) PAINT.start(cards.start, true); }, 400);
            }, label + (r.done ? " · " + t("wg.start.done") : ""));
            var chk = el("span", "wg-chk");
            if (r.done) chk.innerHTML = IC_TICK;      // static icon
            row.appendChild(chk);
            row.appendChild(el("span", "wg-what", label));
            listEl.appendChild(row);
          });
          b.appendChild(listEl);
          foot.appendChild(el("span", null, t("wg.start.count").replace("{n}", n).replace("{m}", rows.length)));
        }
        foot.appendChild(hide);
        b.appendChild(foot);
      });
    },
    clock: function (c) {
      var now = new Date(), l = loc();
      var time = now.toLocaleTimeString(l, { hour: "2-digit", minute: "2-digit", hour12: false });
      var date = now.toLocaleDateString(l, { weekday: "long", day: "numeric", month: "long" });
      var mode = clockMode(clockStyle(), doc.documentElement.getAttribute("data-skin"));
      fill(c, time + date + mode, function (b) {
        var go = btn("wg-clock", null, function () { host.open("time"); }, t("app.time") + " · " + time);
        if (mode === "dots") go.appendChild(dotSvg(hhmm(now)));
        else go.appendChild(el("div", "wg-time", time));
        go.appendChild(el("div", "wg-date", date));
        b.appendChild(go);
      });
    },
    calendar: function (c) {
      var now = new Date(), today = ymdOf(now);
      if (!calAt) calAt = { y: now.getFullYear(), m: now.getMonth() };
      var l = loc();
      fill(c, today + "|" + calAt.y + "-" + calAt.m + "|" + l, function (b) {
        var nav = el("div", "wg-cal-nav");
        var title = new Date(calAt.y, calAt.m, 1).toLocaleDateString(l, { month: "long", year: "numeric" });
        nav.appendChild(btn("wg-title", title, function () { host.open("calendar"); }, t("app.calendar") + " · " + title));
        nav.appendChild(btn("wg-arrow", "‹", function () { shiftMonth(c, -1); }, t("wg.prev")));
        nav.appendChild(btn("wg-arrow", "›", function () { shiftMonth(c, 1); }, t("wg.next")));
        b.appendChild(nav);
        var g = el("div", "wg-grid");
        g.setAttribute("role", "grid");
        for (var i = 0; i < 7; i++) {            // 1 Jan 2024 is a Monday
          var wd = new Date(2024, 0, 1 + i).toLocaleDateString(l, { weekday: "narrow" });
          var w = el("div", "wg-wd", wd);
          w.setAttribute("aria-hidden", "true");
          g.appendChild(w);
        }
        monthGrid(calAt.y, calAt.m).forEach(function (week) {
          week.forEach(function (cell) {
            var long = new Date(cell.y, cell.m, cell.d).toLocaleDateString(l, { weekday: "long", day: "numeric", month: "long" });
            var d = btn("wg-day" + (cell.out ? " wg-out" : "") + (cell.ymd === today ? " wg-now" : ""), String(cell.d),
              function () { host.openDay(cell.ymd); }, long);
            if (cell.ymd === today) d.setAttribute("aria-current", "date");
            g.appendChild(d);
          });
        });
        b.appendChild(g);
      });
    },
    today: function (c, force) {
      var now = Date.now();
      if (!todayBusy && (force || now - todayAt > 120000) && root.orosToday && root.orosToday.build) {
        todayBusy = true;
        root.orosToday.build().then(function (res) {
          todayBusy = false; todayAt = Date.now(); todayCache = res; c.key = ""; if (cards.today) PAINT.today(cards.today);
        }, function () { todayBusy = false; todayAt = Date.now(); });
      }
      var res = todayCache;
      if (!root.orosToday && root.orosLate && !root.orosLate.done) {   // BOOT-L1: today/host.js is on its way
        fill(c, "wait", function () {});
        return;
      }
      if (!root.orosToday) {
        fill(c, "none", function (b) { b.appendChild(el("div", "wg-empty", t("wg.today.none"))); });
        return;
      }
      var g = res && res.groups;
      var rows = g ? (g.overdue || []).map(function (r) { return { r: r, late: true }; })
        .concat((g.today || []).map(function (r) { return { r: r, late: false }; })) : [];
      var key = res ? JSON.stringify(rows.map(function (x) { return [x.r.key, x.r.title, x.r.time, x.late]; })) + host.lang() : "wait";
      fill(c, key, function (b) {
        if (!res) { b.appendChild(el("div", "wg-empty", "…")); return; }
        var names = {};
        (res.apps || []).forEach(function (a) { names[a.id] = call(function () { return host.appName(a.id); }) || a.name; });
        var listEl = el("div", "wg-list");
        rows.slice(0, 6).forEach(function (x) {
          var r = x.r;
          var row = btn("wg-row", null, function () { root.orosToday.open(r.app, r.target); },
            r.title + " · " + (names[r.app] || r.app) + (x.late ? " · " + t("wg.late") : ""));
          row.appendChild(el("span", "wg-when" + (x.late ? " wg-late" : ""), x.late ? t("wg.late") : (r.time || "")));
          row.appendChild(el("span", "wg-what", r.title));
          row.appendChild(el("span", "wg-app", names[r.app] || r.app));
          listEl.appendChild(row);
        });
        if (!rows.length) listEl.appendChild(el("div", "wg-empty", t("wg.today.empty")));
        b.appendChild(listEl);
        var more = rows.length > 6 ? t("wg.today.more").replace("{n}", rows.length - 6) : t("wg.today.open");
        b.appendChild(btn("wg-foot", more, function () { host.open("today"); }));
      });
    },
    weather: function (c) {
      var w = call(function () { return host.weather(); }) || null;
      var key = w ? [w.temp, w.icon, w.place, w.at, w.off].join("|") : "none";
      fill(c, key + host.lang(), function (b) {
        var go = btn("wg-wx", null, function () { host.open("weather"); }, t("app.weather"));
        if (w && !w.off && typeof w.temp === "number") {
          var ic = el("span");
          ic.innerHTML = w.icon || "";                 // the shell's own static icon
          go.appendChild(ic);
          var txt = el("div");
          txt.appendChild(el("div", "wg-temp", Math.round(w.temp) + "°"));
          txt.appendChild(el("div", "wg-place", w.place || ""));
          go.appendChild(txt);
          go.setAttribute("aria-label", t("app.weather") + " · " + (w.place || "") + " " + Math.round(w.temp) + "°");
        } else {
          go.appendChild(el("div", "wg-empty", t(w && w.off ? "wg.wx.off" : "wg.wx.none")));
        }
        b.appendChild(go);
      });
    },
    // WG-MEDIA-2: the player that plays (or the first one) large: its
    // cover, title, progress, Previous / Play-Pause / Next and a small
    // light that moves with the sound (vizkit.js, the wallpaper's rules:
    // passive listener, only while the desktop shows, still with reduced
    // motion, Energy saver or a low battery). The others stay as rows.
    // The body is rebuilt only when what it shows changes; the progress
    // and the cover are updated in place every second.
    media: function (c) {
      var list2 = call(function () { return host.media(); }) || [];
      var main = list2.filter(function (m) { return m.playing; })[0] || list2[0] || null;
      var rest = list2.filter(function (m) { return m !== main; }).slice(0, 2);
      var light = mediaLightOn() && !!host.mediaLight;
      var key = JSON.stringify(list2.map(function (m) { return [m.id, m.title, m.playing, !!m.next, !!m.prev, !!m.live, m.dur > 0]; })) + host.lang() + light;
      fill(c, key, function (b) {
        mediaLightStop(c);
        c.mp = null;
        if (!main) { b.appendChild(el("div", "wg-empty", t("wg.media.none"))); return; }
        var big = el("div", "wg-mbig");
        var top = el("div", "wg-mtop");
        var cov = el("div", "wg-cover");
        cov.setAttribute("aria-hidden", "true");
        cov.appendChild(el("span", "wg-cover-l", (main.title || main.name || "?").trim().charAt(0).toUpperCase()));
        top.appendChild(cov);
        var o = btn("wg-row wg-mtitle", null, function () { main.open(); }, main.name + " · " + (main.title || ""));
        var parts = String(main.title || "").split(" · ");
        o.appendChild(el("span", "wg-what", parts[0] || main.name));
        o.appendChild(el("span", "wg-app", parts.slice(1).join(" · ") || main.name));
        top.appendChild(o);
        big.appendChild(top);
        var pr = null, cur = null, len = null;
        if (main.live) big.appendChild(el("div", "wg-mlive", t("wg.media.live")));
        else if (main.dur > 0) {
          var pw = el("div", "wg-mprog");
          var bar = el("div", "wg-bar");
          pr = el("span");
          bar.appendChild(pr);
          pw.appendChild(bar);
          var tm = el("div", "wg-mtime");
          cur = el("span"); len = el("span");
          tm.appendChild(cur); tm.appendChild(len);
          pw.appendChild(tm);
          big.appendChild(pw);
        }
        var cv = null;
        if (light) {
          cv = el("canvas", "wg-mlight");
          cv.setAttribute("aria-hidden", "true");
          big.appendChild(cv);
        }
        var ctl = el("div", "wg-mctl");
        var again = function () { setTimeout(function () { c.key = ""; PAINT.media(c); }, 250); };
        if (main.prev) { var pv = btn("wg-mbtn", null, function () { main.prev(); again(); }, t("wg.media.prev") + " · " + main.name); pv.innerHTML = IC_PREV; ctl.appendChild(pv); }
        var p = btn("wg-play", null, function () { main.toggle(); again(); }, t(main.playing ? "qs.pause" : "qs.play") + " · " + main.name);
        p.innerHTML = main.playing ? IC_PAUSE : IC_PLAY;
        ctl.appendChild(p);
        if (main.next) { var nx = btn("wg-mbtn", null, function () { main.next(); again(); }, t("wg.media.next") + " · " + main.name); nx.innerHTML = IC_NEXT; ctl.appendChild(nx); }
        big.appendChild(ctl);
        b.appendChild(big);
        rest.forEach(function (m) {
          var rowEl = el("div", "wg-media");
          var o2 = btn("wg-row", null, function () { m.open(); }, m.name);
          o2.appendChild(el("span", "wg-what", m.name));
          o2.appendChild(el("span", "wg-app", m.title || ""));
          rowEl.appendChild(o2);
          var p2 = btn("wg-play", null, function () { m.toggle(); setTimeout(function () { c.key = ""; PAINT.media(c); }, 250); },
            t(m.playing ? "qs.pause" : "qs.play") + " · " + m.name);
          p2.innerHTML = m.playing ? IC_PAUSE : IC_PLAY;
          rowEl.appendChild(p2);
          b.appendChild(rowEl);
        });
        c.mp = { cov: cov, art: "", pr: pr, cur: cur, len: len, cv: cv, playing: !!main.playing, big: big, tint: "" };
        if (cv) mediaLightStart(c);
      });
      // In place, every paint: the cover once it is known, the progress.
      var mp = c.mp;
      if (!mp || !main) return;
      var art = String(call(function () { return host.mediaArt ? host.mediaArt(main.title) : ""; }) || "");
      if (art !== mp.art) {
        mp.art = art;
        mp.cov.style.backgroundImage = art ? 'url("' + art.replace(/["\\\n\r]/g, "") + '")' : "";
        mp.cov.classList.toggle("wg-cover-img", !!art);
      }
      // COVERTINT-1: the player takes the cover's colours (contrast checked in the shell)
      var tn = call(function () { return host.mediaTint ? host.mediaTint(main.title) : null; });
      tn = tn && typeof tn.bg === "string" ? tn : null;
      if ((tn ? tn.bg + tn.tint : "") !== mp.tint) {
        mp.tint = tn ? tn.bg + tn.tint : "";
        [["--wg-tint-bg", "bg"], ["--text", "ink"], ["--text-dim", "dim"], ["--accent", "tint"], ["--wg-on", "tintInk"], ["--accent-soft", "soft"], ["--border", "border"]].forEach(function (v) {
          if (tn) mp.big.style.setProperty(v[0], tn[v[1]]); else mp.big.style.removeProperty(v[0]);
        });
        mp.big.classList.toggle("wg-tinted", !!tn);
      }
      if (mp.pr) {
        var d = +main.dur || 0, at = Math.max(0, Math.min(d, +main.pos || 0));
        mp.pr.style.width = (d ? at / d * 100 : 0).toFixed(1) + "%";
        mp.cur.textContent = clock(at);
        mp.len.textContent = clock(d);
      }
      if (mp.v) {
        call(function () { host.mediaLight.tap(!!main.playing && !covered()); });
        if (main.playing && !covered()) mp.v.wake();
      }
    },

    // PHONE-1: the address of this orOS as a QR code (no secret in it)
    // and one line on sync. The shell gives the address and, once its
    // QR encoder (qr/qr-encode.js) is loaded, the dark modules.
    phone: function (c) {
      var url = String(call(function () { return host.phoneUrl(); }) || "");
      var q = call(function () { return host.qr(url); });
      fill(c, (q ? "q" : "-") + host.lang() + url, function (b) {
        var r = el("div", "wg-phone");
        r.appendChild(q ? qrSvg(q) : el("div", "wg-qr-wait"));
        var txt = el("div", "wg-phone-txt");
        txt.appendChild(el("span", "wg-what", t("wg.phone.scan")));
        txt.appendChild(el("span", "wg-phone-url", url.replace(/^https?:\/\//, "").replace(/\/$/, "")));
        txt.appendChild(el("span", "wg-phone-hint", t("wg.phone.sync")));
        txt.appendChild(btn("wg-act", t("qs.settings"), function () { host.settings("sync"); }));
        r.appendChild(txt);
        b.appendChild(r);
      });
    },
    // FOCUS-W: the time is set in place every second; the buttons are
    // built again only when the phase, the mode or the language changes.
    pomo: function (c) {
      var now = Date.now(), st = pmNow(now), lens = pmLensNow(), left = pmLeft(st, now, lens);
      var ph = t(st.phase === "break" ? "wg.pomo.break" : "wg.pomo.work");
      fill(c, st.phase + st.mode + host.lang(), function (b) {
        var w = el("div", "wg-pm");
        var go = btn("wg-pm-go", null, function () { host.open("time"); }, t("app.time"));
        go.appendChild(el("span", "wg-pm-ph", ph));
        var tm = el("span", "wg-pm-t");
        go.appendChild(tm);
        go.appendChild(el("span", "wg-pm-st", st.mode === "pause" ? t("wg.pomo.paused") : st.mode === "run" ? "" : t("wg.pomo.ready")));
        w.appendChild(go);
        var ctl = el("div", "wg-pm-ctl");
        var minus = btn(null, "−5", function () { pmAct("minus"); }, t("wg.pomo.minus"));
        var main = btn("wg-pm-main", t(st.mode === "run" ? "wg.pomo.pause" : st.mode === "pause" ? "wg.pomo.resume" : "wg.pomo.start"),
          function () { pmAct(st.mode === "run" ? "pause" : "start"); });
        var plus = btn(null, "+5", function () { pmAct("plus"); }, t("wg.pomo.plus"));
        var skip = btn(null, t("wg.pomo.skip"), function () { pmAct("skip"); },
          t("wg.pomo.skipTo").replace("{p}", t(st.phase === "work" ? "wg.pomo.break" : "wg.pomo.work")));
        minus.disabled = plus.disabled = st.mode === "idle";
        [minus, main, plus, skip].forEach(function (x) { ctl.appendChild(x); });
        w.appendChild(ctl);
        b.appendChild(w);
        c.pmT = tm;
        c.pmGo = go;
      });
      if (c.pmT) c.pmT.textContent = pmClock(left);
      if (c.pmGo) c.pmGo.setAttribute("aria-label", t("app.time") + " · " + ph + " " + pmClock(left));
    },
    sync: function (c) {
      var s = call(function () { return host.sync.state(); }) || "off";
      var Q = root.orosQS && root.orosQS.model;
      var label = t(Q ? Q.syncKey(s) : "qs.sync.off");
      fill(c, s + host.lang(), function (b) {
        var r = el("div", "wg-sync");
        r.appendChild(el("span", "wg-what", label));
        var off = s === "off" || s === "locked";
        r.appendChild(btn("wg-act", t(off ? "qs.settings" : "wg.sync.now"), function () {
          if (off) host.settings("sync"); else { host.sync.now(); setTimeout(function () { c.key = ""; PAINT.sync(c); }, 60); }
        }));
        b.appendChild(r);
      });
    }
  };
  // The QR as SVG: one path, a run of dark modules per "h" (no markup
  // from outside; the numbers come from the encoder). 4 modules of quiet
  // zone; dark on white in every theme, so any camera reads it.
  var SVGNS = "http://www.w3.org/2000/svg";
  function qrPath(mods) {
    var d = "";
    for (var y = 0; y < mods.length; y++) {
      var row = mods[y], x = 0;
      while (x < row.length) {
        if (!row[x]) { x++; continue; }
        var s = x;
        while (x < row.length && row[x]) x++;
        d += "M" + (s + 4) + " " + (y + 4) + "h" + (x - s) + "v1h-" + (x - s) + "z";
      }
    }
    return d;
  }
  function qrSvg(mods) {
    var n = mods.length + 8;
    var s = doc.createElementNS(SVGNS, "svg");
    s.setAttribute("class", "wg-qr");
    s.setAttribute("viewBox", "0 0 " + n + " " + n);
    s.setAttribute("role", "img");
    s.setAttribute("aria-label", t("wg.phone.qr"));
    s.setAttribute("shape-rendering", "crispEdges");
    var p = doc.createElementNS(SVGNS, "path");
    p.setAttribute("d", qrPath(mods));
    p.setAttribute("fill", "#000");
    s.appendChild(p);
    return s;
  }
  function shiftMonth(c, n) {
    var d = new Date(calAt.y, calAt.m + n, 1);
    calAt = { y: d.getFullYear(), m: d.getMonth() };
    PAINT.calendar(c);
    var b = c.body.querySelector(n < 0 ? ".wg-arrow" : ".wg-arrow:last-of-type");
    if (b) b.focus();
  }

  // ---------- 6. Attach ----------
  function injectCss() {
    if (doc.getElementById("wg-css")) return;
    var s = doc.createElement("style");
    s.id = "wg-css";
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  function attach(h) {
    if (host || !h || !h.desktop) return;
    host = h;
    injectCss();
    render();
    var rz = 0;
    root.addEventListener("resize", function () {
      clearTimeout(rz);
      rz = setTimeout(function () { var was = strip(); if (box && was === wide()) render(); else if (!box && list().length) render(); }, 150);
    });
    // Energy saver (qsettings.js 1.3.0): once a minute instead.
    var lastMin = -1;
    timer = setInterval(function () {
      var m = Math.floor(Date.now() / 60000);
      if (doc.documentElement.getAttribute("data-oros-saver") === "1" && m === lastMin) return;
      lastMin = m;
      paintAll(false);
    }, 1000);
    if (root.orosToday && root.orosToday.onChange) root.orosToday.onChange(function () { todayAt = 0; });
    // The desktop menu (quickmenu.js) lists "Widgets…".
    (root.__orosDeskItems = root.__orosDeskItems || []).push(function () {
      return [{ label: t("wg.edit"), run: edit }];
    });
  }

  root.orosWidgets = {
    VER: VER,
    model: model,
    attach: attach,
    edit: edit,
    // Settings › Appearance › Desktop widgets
    snapshot: function () {
      if (!host) return null;
      var l = list();
      return { list: KINDS.map(function (k) { return { id: k, name: nameOf(k), on: l.indexOf(k) !== -1 }; }) };
    },
    // Does a shown widget need this data (the shell fetches the weather for it)?
    wants: function (kind) { return !!host && list().indexOf(kind) !== -1; },
    set: function (kind, on) {
      if (!host || KINDS.indexOf(kind) === -1) return;
      if (kind === "start" && on) startReopen();
      save(toggle(list(), kind, !!on));
    },
    // START-1: a new user (the shell's first-run tour) gets First steps
    // on the desktop, before this screen's default cards. A device that
    // already has a widget list keeps it.
    firstRun: function () {
      if (!host) return;
      var l = firstList(stored(), wide(), phone());
      if (l) save(l);
    },
    // A step done somewhere the facts cannot see (the Assistant opened).
    did: function (step) {
      if (STEPS.indexOf(step) === -1) return;
      var rec = startRead();
      if (rec.done.indexOf(step) !== -1) return;
      rec.done.push(step);
      startWrite(rec);
      if (cards.start) { cards.start.key = ""; startAt = 0; }
    },
    refresh: function () { if (!host) return; Object.keys(cards).forEach(function (k) { cards[k].key = ""; }); render(); }
  };
})(typeof window !== "undefined" ? window : globalThis);
