// ============================================================
// orOS — widgets.js (desktop widgets, v1.1.0)
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
//
// Device-local (oros-widgets, never synced: screens differ per device):
//   { v:1, list: ["clock","calendar",…] }   order = list order
//   Absent = the default: clock, calendar, today, weather on a wide
//   screen that is not a phone; none on a phone or a narrow window.
//
// Pure logic (prefs, moves, the month grid) is unit-tested in node
// (tests/widgets.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.1.0";
  var KEY = "oros-widgets";
  var START_KEY = "oros-start";
  // First steps, in order. "install" only where the browser offers it
  // or orOS already runs installed.
  var STEPS = ["note", "task", "wall", "icons", "sync", "assistant", "install"];
  var KINDS = ["start", "clock", "calendar", "today", "weather", "media", "sync"];
  var DEFAULT = ["clock", "calendar", "today", "weather"];
  var WIDE = 760;

  // ---------- 1. Model (pure) ----------
  function norm(v) {
    if (!v || typeof v !== "object" || !Array.isArray(v.list)) return null;
    var out = [];
    v.list.forEach(function (k) { if (KINDS.indexOf(k) !== -1 && out.indexOf(k) === -1) out.push(k); });
    return { v: 1, list: out };
  }
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
  // facts: { note, task, wall, icons, sync, assistant: true|false,
  // install: true (installed) | false (can install) | "no" (cannot) }.
  // A step is done when its fact is true now or it was done before.
  function startRows(facts, rec) {
    facts = facts || {};
    var done = (rec && rec.done) || [];
    return STEPS.filter(function (k) { return k !== "install" || facts.install === true || facts.install === false; })
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
  // A new user's first list: First steps, then this screen's default.
  function firstList(stored, wide, phone) {
    if (stored) return null;               // a list is set already: leave it
    return ["start"].concat(listOf(null, wide, phone));
  }

  var model = { VER: VER, KINDS: KINDS, DEFAULT: DEFAULT, STEPS: STEPS, norm: norm, parse: parse, listOf: listOf,
                toggle: toggle, move: move, monthGrid: monthGrid, ymdOf: ymdOf,
                startNorm: startNorm, startRows: startRows, startNext: startNext, startGone: startGone, firstList: firstList };
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
  function save(l) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, list: l })); }
    catch (e) { call(function () { host.toast(t("wg.savefail")); }); }
    render();
    call(function () { host.changed(); });
  }

  var CSS = [
    "#wg-col { position: absolute; top: 16px; right: 16px; width: 300px; display: flex; flex-direction: column; gap: 12px;",
    "  z-index: 2; padding-bottom: calc(110px + var(--tb-h, 0px)); }",
    "body.wg-col #ld-desk { margin-right: 332px; }",
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
    ".wg-media .wg-row { flex: 1; min-width: 0; flex-direction: column; align-items: flex-start; gap: 0; }",
    ".wg-media .wg-what { width: 100%; font-weight: 700; }",
    ".wg-play { width: 40px; height: 40px; flex: none; border-radius: 50%; background: var(--accent); color: var(--wg-on, #fff); display: inline-flex;",
    "  align-items: center; justify-content: center; }",
    ".wg-play:hover, .wg-play:focus-visible { background: var(--accent-hover, var(--accent)); }",
    ".wg-play svg { width: 18px; height: 18px; }",
    ".wg-sync { display: flex; align-items: center; gap: 10px; }",
    ".wg-sync .wg-what { flex: 1; font-size: 14px; }",
    ".wg-sync .wg-btn.wg-act { padding: 8px 12px; min-height: 40px; border: 1px solid var(--border); }",
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
    "  padding: 16px; width: min(380px, calc(100vw - 32px)); box-sizing: border-box; }",
    "#wg-dlg::backdrop { background: rgba(0,0,0,.45); }",
    "#wg-dlg h2 { margin: 0 0 4px; font-size: 17px; }",
    "#wg-dlg p { margin: 0 0 10px; font-size: 13px; color: var(--text-dim); }",
    ".wg-pick { display: flex; align-items: center; gap: 8px; min-height: 44px; border-bottom: 1px solid var(--border); }",
    ".wg-pick label { flex: 1; display: flex; align-items: center; gap: 10px; cursor: pointer; }",
    ".wg-pick input { width: 18px; height: 18px; accent-color: var(--accent); }",
    ".wg-pick .wg-btn { width: 36px; height: 36px; }",
    ".wg-pick .wg-btn:disabled { opacity: .3; cursor: default; }",
    ".wg-dlg-foot { display: flex; justify-content: flex-end; margin-top: 12px; }",
    ".wg-dlg-foot .wg-btn { padding: 8px 16px; min-height: 40px; background: var(--accent); color: var(--wg-on, #fff); font-weight: 700; }"
  ].join("\n");

  var SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var IC_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var IC_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  var IC_UP = SV + '<path d="M18 15l-6-6-6 6"/></svg>';
  var IC_DOWN = SV + '<path d="M6 9l6 6 6-6"/></svg>';
  var IC_TICK = SV.replace('stroke-width="2"', 'stroke-width="3"') + '<path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  // First steps: the label of each step.
  var STEP_TEXT = {
    note: "wg.start.note", task: "wg.start.task", wall: "wg.start.wall", icons: "wg.start.icons",
    sync: "wg.start.sync", assistant: "wg.start.assistant", install: "wg.start.install"
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
    items.push([t("wg.remove"), function () { save(toggle(l, kind, false)); }]);
    items.push([t("wg.edit"), edit]);
    items.forEach(function (it) {
      var b = btn("", it[0], function () { closeMenu(); it[1](); });
      b.setAttribute("role", "menuitem");
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
  function paintPicker(d) {
    var l = list();
    d.textContent = "";
    var h = el("h2", null, t("wg.title"));
    h.id = "wg-dlg-h";
    d.appendChild(h);
    d.appendChild(el("p", null, t("wg.hint")));
    var order = l.concat(KINDS.filter(function (k) { return l.indexOf(k) === -1; }));
    order.forEach(function (kind) {
      var on = l.indexOf(kind) !== -1, i = l.indexOf(kind);
      var row = el("div", "wg-pick");
      var lab = el("label");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = on;
      cb.setAttribute("data-k", "wg:" + kind);
      cb.addEventListener("change", function () {
        if (kind === "start" && cb.checked) startReopen();
        save(toggle(list(), kind, cb.checked)); paintPicker(d); focusK(d, "wg:" + kind);
      });
      lab.appendChild(cb);
      lab.appendChild(el("span", null, nameOf(kind)));
      row.appendChild(lab);
      var up = btn("", "", function () { save(move(list(), kind, i - 1)); paintPicker(d); focusK(d, "up:" + kind); }, t("wg.up") + " · " + nameOf(kind));
      up.innerHTML = IC_UP;
      up.setAttribute("data-k", "up:" + kind);
      up.disabled = !on || i === 0;
      var dn = btn("", "", function () { save(move(list(), kind, i + 1)); paintPicker(d); focusK(d, "down:" + kind); }, t("wg.down") + " · " + nameOf(kind));
      dn.innerHTML = IC_DOWN;
      dn.setAttribute("data-k", "down:" + kind);
      dn.disabled = !on || i === l.length - 1;
      row.appendChild(up);
      row.appendChild(dn);
      d.appendChild(row);
    });
    var foot = el("div", "wg-dlg-foot");
    foot.appendChild(btn("", t("wg.done"), function () { d.close(); }));
    d.appendChild(foot);
  }
  function focusK(d, k) {
    var n = d.querySelector('[data-k="' + k + '"]');
    if (n && !n.disabled) n.focus();
    else { var c = d.querySelector('[data-k="wg:' + k.split(":")[1] + '"]'); if (c) c.focus(); }
  }

  // ---------- 5. The widgets ----------
  function paintAll(force) {
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
  // Repaint a card's body only when what it shows changed.
  function fill(c, key, build) {
    if (c.key === key) return;
    c.key = key;
    c.body.textContent = "";
    build(c.body);
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
      fill(c, time + date, function (b) {
        var go = btn("wg-clock", null, function () { host.open("time"); }, t("app.time"));
        go.appendChild(el("div", "wg-time", time));
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
    media: function (c) {
      var list2 = call(function () { return host.media(); }) || [];
      var key = JSON.stringify(list2.map(function (m) { return [m.id, m.title, m.playing]; })) + host.lang();
      fill(c, key, function (b) {
        if (!list2.length) { b.appendChild(el("div", "wg-empty", t("wg.media.none"))); return; }
        list2.slice(0, 3).forEach(function (m) {
          var rowEl = el("div", "wg-media");
          var o = btn("wg-row", null, function () { m.open(); }, m.name);
          o.appendChild(el("span", "wg-what", m.name));
          o.appendChild(el("span", "wg-app", m.title || ""));
          rowEl.appendChild(o);
          var p = btn("wg-play", null, function () { m.toggle(); setTimeout(function () { c.key = ""; PAINT.media(c); }, 250); },
            t(m.playing ? "qs.pause" : "qs.play") + " · " + m.name);
          p.innerHTML = m.playing ? IC_PAUSE : IC_PLAY;
          rowEl.appendChild(p);
          b.appendChild(rowEl);
        });
      });
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
    timer = setInterval(function () { paintAll(false); }, 1000);
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
