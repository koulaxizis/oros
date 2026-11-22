// Smart top bar (smartbar.js, SB1): the pure model, the shell wiring,
// the Settings card and the strings in every language.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require("../smartbar.js");
const A = require("../smartbar-apps.js");
const L = require("../smartbar-live.js");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("prefs: unknown and repeated kinds are dropped, absent means no chip", () => {
  assert.deepStrictEqual(M.parse('{"v":1,"list":["event","bogus","event","sales"]}'), { v: 1, list: ["event", "sales"] });
  assert.strictEqual(M.parse("not json"), null);
  assert.strictEqual(M.parse('{"v":1}'), null);
  assert.deepStrictEqual(M.listOf(null), []);
});

test("toggle adds at the end, removes, and refuses unknown kinds", () => {
  assert.deepStrictEqual(M.toggle(["event"], "water", true), ["event", "water"]);
  assert.deepStrictEqual(M.toggle(["event", "water"], "event", false), ["water"]);
  assert.deepStrictEqual(M.toggle(["event"], "event", true), ["event"]);
  assert.deepStrictEqual(M.toggle(["event"], "nope", true), ["event"]);
});

test("step moves one place and stops at the ends", () => {
  assert.deepStrictEqual(M.step(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepStrictEqual(M.step(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  assert.deepStrictEqual(M.step(["a", "b"], "a", -1), ["a", "b"]);
  assert.deepStrictEqual(M.step(["a", "b"], "b", 1), ["a", "b"]);
  assert.deepStrictEqual(M.step(["a"], "x", 1), ["a"]);
});

test("nextEvent: a running row wins, then the first ahead; past, untimed, info and hidden apps skip", () => {
  const rows = [
    { app: "calendar", time: "09:00", end: "10:00", title: "Past", kind: "event" },
    { app: "todo", time: null, title: "Untimed", kind: "task" },
    { app: "health", time: "11:00", title: "Doctor", kind: "event" },
    { app: "calendar", time: "12:30", end: null, title: "Lunch", kind: "event" },
    { app: "today", time: "11:05", title: "Info", kind: "info" },
    { app: "calendar", time: "13:00", end: "14:00", title: "Review", kind: "event" }
  ];
  const hidden = { health: true };
  let ev = M.nextEvent(rows, 11 * 60, hidden);
  assert.strictEqual(ev.row.title, "Lunch");
  assert.strictEqual(ev.left, 90);
  assert.strictEqual(ev.now, false);
  ev = M.nextEvent(rows, 13 * 60 + 20, hidden);
  assert.strictEqual(ev.row.title, "Review");
  assert.strictEqual(ev.now, true);
  assert.strictEqual(M.nextEvent(rows, 14 * 60, hidden), null);
  // without the hidden map the Health row would show: the shell always passes it
  assert.strictEqual(M.nextEvent(rows, 10 * 60 + 30, {}).row.title, "Doctor");
  assert.strictEqual(M.nextEvent(null, 0), null);
});

test("taskCount: tasks only, plus the late rows folded away", () => {
  const g = {
    overdue: [{ kind: "task" }, { kind: "task" }],
    today: [{ kind: "task" }, { kind: "event" }],
    overdueMore: { todo: 3 }
  };
  assert.strictEqual(M.taskCount(g), 6);
  assert.strictEqual(M.taskCount(null), 0);
});

test("focusOf reads the Time app's Pomodoro leg", () => {
  const now = 1700000000000;
  assert.deepStrictEqual(M.focusOf(JSON.stringify({ phase: "work", end: now + 60000 }), now), { phase: "work", left: 60000 });
  assert.strictEqual(M.focusOf(JSON.stringify({ phase: "break", end: now + 1000 }), now).phase, "break");
  assert.strictEqual(M.focusOf(JSON.stringify({ phase: "work", end: now - 1 }), now), null);
  assert.strictEqual(M.focusOf(JSON.stringify({ phase: "work", end: now + 7 * 3600000 }), now), null);
  assert.strictEqual(M.focusOf("{bad", now), null);
  assert.strictEqual(M.clock(65000), "1:05");
  assert.strictEqual(M.clock(1500), "0:02");
  assert.strictEqual(M.clock(3600000 + 61000), "1:01:01");
});

test("monthSpent: this month's expenses, deleted rows and income left out", () => {
  const data = {
    set: { cur: "EUR" },
    tx: [
      { id: "a", m: 5, d: "2026-11-02", a: 1250, k: "o" },
      { id: "b", m: 5, d: "2026-11-03", a: 9999, k: "i" },
      { id: "c", m: 5, d: "2026-10-30", a: 500, k: "o" },
      { id: "d", m: 5, d: "2026-11-10", a: 750, k: "o" },
      { id: "e", m: 5, d: "2026-11-11", a: 100, k: "o" }
    ],
    tombs: { "tx:e": 6 }
  };
  assert.deepStrictEqual(M.monthSpent(data, "2026-11"), { cents: 2000, cur: "EUR", n: 2 });
  assert.strictEqual(M.monthSpent({ tx: [] }, "2026-11"), null);
  assert.strictEqual(M.monthSpent(null, "2026-11"), null);
  assert.strictEqual(M.monthSpent({ tx: [{ id: "x", m: 1, d: "2026-11-01", a: 100, k: "o" }], set: { cur: "bad" } }, "2026-11").cur, "EUR");
});

test("money drops the cents from 1,000 up", () => {
  assert.strictEqual(M.money(3150, "EUR", "en-GB"), "€31.50");
  assert.strictEqual(M.money(124000, "EUR", "en-GB"), "€1,240");
});

test("shell wiring: loaded after widgets.js, attached outside a single app, fit hook, settings bridge", () => {
  const html = read("index.html");
  const iw = html.indexOf('<script src="widgets.js'), is = html.indexOf('<script src="smartbar.js'), ish = html.indexOf('<script src="shell.js');
  assert.ok(iw > 0 && is > iw && ish > is, "smartbar.js loads after widgets.js and before shell.js");
  const sh = read("shell.js");
  assert.match(sh, /window\.orosSmartBar && !SOLO\) \{\s*window\.orosSmartBar\.attach\(/);
  assert.match(sh, /strict: function \(\) \{ return !!strictLevelNow\(\); \}/);
  assert.match(sh, /SB\.fitReset\(\)/);
  assert.match(sh, /lvl === 2 && SB\) \{ while \(SB\.fitDrop\(1\)\)/);
  assert.match(sh, /lvl >= max\) \{ if \(SB\) \{ while \(SB\.fitDrop\(0\)\)/);
  assert.match(sh, /\/\^smartbar:\/\.test\(name\)/);
  assert.match(sh, /\/\^smartbar-move:\/\.test\(name\)/);
  assert.match(sh, /smartbar: !SOLO && window\.orosSmartBar/);
  assert.match(sh, /tickSafe\("smartbarTick"/);
  const src = read("smartbar.js");
  // chip text goes in through textContent only; innerHTML is for the fixed icons
  // PEEK-1: the peek panels add the shell's own weather icons (wxIconFor / wxDayIcon, static SVG)
  assert.deepStrictEqual(src.match(/innerHTML = [^;]+;/g), ["innerHTML = icon(kind);", "innerHTML = IC.more;", "innerHTML = icon(k);",
    'innerHTML = w.icon || "";', 'innerHTML = d.icon || "";']);
  assert.match(sh, /icon: wxDayIcon\(r\.code\)/);
  assert.match(src, /if \(strict\(\)\) return null;[\s\S]*if \(strict\(\)\) return null;/);
});

test("Settings: card, search row, scope, and strings in EN, EL and DE", () => {
  const set = read("settings/settings.js");
  assert.match(set, /if \(s\.smartbar\) \{/);
  assert.match(set, /set\("smartbar:" \+ w\.id, cb\.checked\)/);
  const C = require("../settings/core.js");
  assert.strictEqual(C.scopeOf("smartbar"), "device");
  const core = read("settings/core.js");
  assert.match(core, /\["smartbar", "appearance", "sb\.title", null, null, "smartbar"\]/);
  const de = read("i18n/de/settings.js");
  ["sb.title", "sb.hint", "sb.money", "sb.left", "sb.right", "w.smartbar"].forEach((k) => {
    assert.strictEqual(core.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
});

test("shell strings for every chip in EN, EL and DE", () => {
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  const keys = M.KINDS.map((k) => "sb.k." + k).concat(["sb.event.now", "sb.event.in", "sb.event.short", "sb.event.hidden", "sb.event.tip",
    "sb.focus.work", "sb.focus.break", "sb.focus.tip", "sb.tasks.one", "sb.tasks.n", "sb.tasks.tip", "sb.water.tip",
    "sb.budget.label", "sb.budget.tip", "sb.sales.label", "sb.sales.tip", "sb.savefail", "sb.more.tip", "sb.more.title",
    "sb.habits.label", "sb.plants.label", "sb.chores.label", "sb.kanban.label", "sb.invoices.label", "sb.list.tip", "sb.list.more",
    "sb.invoices.tip", "sb.trip.today", "sb.trip.tomorrow", "sb.trip.in", "sb.trip.tip", "sb.timer.tip",
    "sb.habits.one", "sb.plants.one", "sb.chores.one", "sb.kanban.one", "sb.invoices.one",
    "sb.tmr.name", "sb.tmr.tip", "sb.tmr.stop", "sb.sw.label", "sb.sw.tip", "sb.sw.stop", "sb.rec.paused", "sb.rec.tip", "sb.rec.tip.p", "sb.rec.stop",
    "sb.ai.label", "sb.ai.searches", "sb.ai.near", "sb.ai.tip", "sb.ai.web", "sb.ai.srch"]);
  keys.forEach((k) => {
    assert.strictEqual(tr.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
  const src = read("smartbar.js") + read("smartbar-live.js");
  (src.match(/t\("sb\.[a-z.]+"\)/g) || []).forEach((m) => {
    const k = m.slice(3, -2);
    assert.ok(keys.indexOf(k) !== -1 || k === "sb.k.", "string " + k + " is listed");
  });
});

test("SB3 looks: kept only when known, never under high contrast, wired to Settings", () => {
  assert.deepStrictEqual(M.parse('{"v":1,"list":["event"],"look":"glass"}'), { v: 1, list: ["event"], look: "glass" });
  assert.deepStrictEqual(M.parse('{"v":1,"list":[],"look":"neon"}'), { v: 1, list: [] });
  assert.deepStrictEqual(M.parse('{"v":1,"list":[],"look":""}'), { v: 1, list: [] });
  assert.strictEqual(M.lookOf(null), "");
  assert.strictEqual(M.lookOf({ v: 1, list: [], look: "midnight" }), "midnight");
  assert.deepStrictEqual(M.LOOKS, ["", "glass", "midnight", "solid"]);
  const src = read("smartbar.js");
  // every look rule is scoped away from high contrast
  src.split("\n").filter((l) => /html\[data-oros-bar/.test(l) && !/prefers-reduced-transparency/.test(l))
    .forEach((l) => assert.match(l, /:not\(\[data-oros-contrast=\\"high\\"\]\)/, l));
  assert.match(src, /if \(lookOf\(stored\(\)\)\) \{ injectCss\(\); applyLook\(\); \}/);
  assert.match(read("shell.js"), /name === "smartbar-look"\) \{[\s\S]{0,200}setLook\(String\(value \|\| ""\)\)/);
  const set = read("settings/settings.js"), core = read("settings/core.js"), de = read("i18n/de/settings.js");
  assert.match(set, /set\("smartbar-look", v\)/);
  ["sb.look", "sb.look.classic", "sb.look.glass", "sb.look.midnight", "sb.look.solid", "sb.look.hint"].forEach((k) => {
    assert.strictEqual(core.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
});

test("SB4 bar window: only the bar, its title kept, apps open in the main window", () => {
  const sh = read("shell.js"), css = read("style.css"), src = read("smartbar.js");
  assert.match(sh, /if \(h !== "#bar-win" \|\| window\.top !== window\) return;/);
  assert.match(sh, /document\.title = "orOS bar";/);
  assert.match(sh, /if \(BARWIN && barwinOpen\(id\)\) return;/);
  assert.match(sh, /if \(BARWIN\) return;\s+\/\/ SB4: the launcher finds the bar window by its title/);
  // the main window answers only well-formed asks, never in the bar or a single app
  assert.match(sh, /if \(BARWIN \|\| SOLO \|\| !d \|\| d\.t !== "open" \|\| typeof d\.at !== "number"\) return;/);
  assert.match(sh, /if \(d\.id && !BAR_APP_RE\.test\(String\(d\.id\)\)\) return;/);
  assert.match(sh, /fetch\("\/__oros-open"[^)]*\)[^;]*method: "POST", headers: \{ "X-Oros-Bar": "1" \}/);
  assert.match(css, /html\.barwin body > \*:not\(#oros-bar\) \{ display: none !important; \}/);
  // every open path hands over (chips go through __orosOpenAt and openApp), only on a tap,
  // with the chip's target; nothing renames the bar window
  assert.match(sh, /if \(BARWIN\) \{ if \(app && app\.id && barwinTapped\(\)\) barwinOpen\(app\.id\); return; \}/);
  assert.match(sh, /if \(BARWIN\) \{ if \(barwinTapped\(\)\) barwinOpen\(appId, t\); return; \}/);
  assert.match(sh, /document\.title = BARWIN \? "orOS bar" : "orOS";/);
  assert.match(sh, /window\.__orosOpenAt\(String\(d\.id\), d\.target\)/);
  // behind the screen lock the chips go (no lock screen over the bar window)
  assert.match(src, /var lk = locked\(\);\s+if \(box\.hidden !== lk\)/);
});

test("fold: chips that do not fit, and every chip on a phone, go behind one button that unfolds them", () => {
  const src = read("smartbar.js");
  assert.match(src, /var FOLD_W = 600;/);
  assert.match(src, /function folded\(\) \{ return \(root\.innerWidth \|\| 0\) <= FOLD_W; \}/);
  // fitDrop never folds the button itself, and the button stays last in the row
  assert.match(src, /!el\.hidden && !\(more && el === more\.el\)/);
  assert.match(src, /box\.appendChild\(more\.el\);\s+\/\/ always last/);
  // the panel draws chip text through textContent only and closes on Escape and outside taps
  const fill = src.slice(src.indexOf("function fillPop"), src.indexOf("function onPopKey"));
  assert.deepStrictEqual(fill.match(/innerHTML = [^;]+;/g), ["innerHTML = icon(k);"], "only fixed icons go through innerHTML");
  assert.match(fill, /v\.textContent = val;/);
  assert.match(src, /e\.key === "Escape" && pop/);
  assert.match(src, /addEventListener\("touchstart", onPopDown, true\)/);
  // behind the lock nothing unfolds; the desktop bar window has no room for a panel
  assert.match(src, /if \(lk\) \{ closePop\(\); closePeek\(\); return; \}/);
  assert.match(src, /html\.barwin \.sb-chip\.sb-more \{ display: none !important; \}/);
});

test("SB5 agendaCard: counts, the next trip, today's lines and the running timer", () => {
  const T = "2026-11-16";
  const rows = [
    { app: "x", id: "a", title: "Water the fern", kind: "task", due: "2026-11-15" },
    { app: "x", id: "b", title: "Feed", kind: "task", due: T },
    { app: "x", id: "c", title: "Later", kind: "task", due: "2026-11-18" },
    { app: "x", id: "d", title: "Note", kind: "info", due: T },
    { app: "x", id: "e", title: "Starts", kind: "event", due: T }
  ];
  assert.deepStrictEqual(A.agendaCard("plants", rows, T), { n: 2, first: rows[0] });
  assert.strictEqual(A.agendaCard("kanban", rows, T).n, 3);                 // + the card that starts today
  assert.deepStrictEqual(A.agendaCard("invoices", rows, T), { n: 1, first: rows[0] });   // late only
  assert.strictEqual(A.agendaCard("invoices", [{ title: "Rec", kind: "task", due: null }], T), null);
  assert.strictEqual(A.agendaCard("habits", [], T), null);
  const trips = [
    { title: "Lisbon day 2", kind: "event", due: "2026-11-20", target: { trip: "t1", tab: "plan" } },
    { title: "Lisbon", kind: "event", due: "2026-11-19", target: { trip: "t1", tab: "" } },
    { title: "Rome", kind: "event", due: "2026-12-01", target: { trip: "t2", tab: "" } }
  ];
  const tr = A.agendaCard("trip", trips, T);
  assert.strictEqual(tr.days, 3);
  assert.strictEqual(tr.row.title, "Lisbon");
  assert.strictEqual(A.agendaCard("meal", rows, T).row.title, "Note");
  assert.strictEqual(A.agendaCard("timer", rows, T), null);                 // only the "run" line
  assert.strictEqual(A.agendaCard("timer", [{ id: "run", title: "Since 09:00", kind: "info" }], T).row.id, "run");
  assert.strictEqual(A.agendaCard("plants", rows, "bad"), null);
  assert.strictEqual(A.dayGap("2026-03-28", "2026-03-30"), 2);              // DST-safe
  // every new card names a real app and is a known kind
  Object.keys(A.AGENDA).forEach((k) => {
    assert.ok(M.KINDS.includes(k), k);
    assert.ok(fs.existsSync(path.join(ROOT, A.AGENDA[k][0], "today.js")), A.AGENDA[k][0] + " has a Today provider");
  });
  assert.ok(M.MONEY.invoices, "invoices hide under Sensitive work");
  assert.deepStrictEqual(Object.keys(M.APPS).sort(), A.KINDS.slice().sort(), "smartbar.js knows which kinds load smartbar-apps.js");
});

// SB-LIVE (v1.3.0): live pills for Time timers, the stopwatch and a Screen Capture recording.
test("SB-LIVE prefs: live pills on when absent, off kept, row puts them first", () => {
  assert.strictEqual(M.liveOf(null), true);
  assert.strictEqual(M.liveOf(M.parse('{"v":1,"list":["event"]}')), true);
  const off = M.parse('{"v":1,"list":["event"],"live":false}');
  assert.deepStrictEqual(off, { v: 1, list: ["event"], live: false });
  assert.strictEqual(M.liveOf(off), false);
  assert.deepStrictEqual(M.parse('{"v":1,"list":[],"live":"no"}'), { v: 1, list: [] });
  assert.deepStrictEqual(M.rowOf(null), ["rec", "tmr", "sw"]);
  assert.deepStrictEqual(M.rowOf(M.parse('{"v":1,"list":["water"]}')), ["rec", "tmr", "sw", "water"]);
  assert.deepStrictEqual(M.rowOf(off), ["event"]);
  // live kinds are never kinds the person ticks
  M.LIVE.forEach((k) => assert.strictEqual(M.KINDS.indexOf(k), -1, k));
});

test("SB-LIVE model: the timer ending first, the stopwatch while it runs, the recording", () => {
  const CC = require("../time/clock-core.js");
  const now = 1e12;
  const list = CC.timerNorm([
    { id: "aaaa1", name: "Pasta", dur: 600000, end: now + 300000, st: "run" },
    { id: "aaaa2", name: "Tea", dur: 240000, end: now + 120000, st: "run" },
    { id: "aaaa3", name: "Bread", dur: 60000, left: 60000, st: "pause" },
    { id: "aaaa4", name: "Old", dur: 60000, end: now - 1000, st: "run" }
  ]);
  const lt = L.liveTimer(list, now);
  assert.strictEqual(lt.tm.name, "Tea");
  assert.strictEqual(lt.left, 120000);
  assert.strictEqual(lt.more, 1);
  assert.strictEqual(L.liveTimer(CC.timerNorm([{ id: "aaaa3", dur: 60000, st: "pause" }]), now), null);
  assert.strictEqual(L.liveTimer(null, now), null);
  assert.deepStrictEqual(L.liveSw(CC.swNorm({ run: true, start: now - 65000, base: 5000, laps: [] }), now), { ms: 70000 });
  assert.strictEqual(L.liveSw(CC.swNorm({ run: false, base: 5000 }), now), null);
  assert.strictEqual(L.liveSw(null, now), null);
  assert.deepStrictEqual(L.liveRec({ ms: 41000, paused: false }), { ms: 41000, paused: false });
  assert.deepStrictEqual(L.liveRec({ ms: 41000, paused: 1 }), { ms: 41000, paused: true });
  assert.strictEqual(L.liveRec(null), null);
  assert.strictEqual(L.liveRec({ ms: NaN }), null);
  assert.strictEqual(M.clock(70000), "1:10");
});

test("SB-LIVE loads only when something runs", () => {
  assert.strictEqual(M.liveWanted(null, null, null), false);
  assert.strictEqual(M.liveWanted('[{"id":"a","st":"pause"}]', '{"run":false,"start":0}', null), false);
  assert.strictEqual(M.liveWanted('[{"id":"a","st":"run"}]', null, null), true);
  assert.strictEqual(M.liveWanted(null, '{"run":true,"start":5}', null), true);
  assert.strictEqual(M.liveWanted(null, null, { state() {}, stop() {} }), true);
  const sb = read("smartbar.js");
  assert.match(sb, /if \(liveWanted\(tr, sr, recLive\)\) loadLive\(\);/);
  assert.match(sb, /script\("smartbar-live\.js", function/);
  assert.doesNotMatch(sb, /clock-core\.js/, "Time's rules load with smartbar-live.js, never at start-up");
});

test("SB-LIVE wiring: Time's own pause rules, the alarm taken off, Capture in memory, Settings switch", () => {
  const src = read("smartbar-live.js"), sb = read("smartbar.js");
  assert.deepStrictEqual(src.match(/innerHTML = [^;]+;/g), ["innerHTML = stopIcon(kind);"], "only fixed icons go through innerHTML");
  assert.match(src, /s\.src = "time\/clock-core\.js\?v="/);
  assert.match(src, /root\.orosAlarms\.remove\(aid\)[\s\S]{0,120}CC\.timerPause\(tm, now\)/);
  assert.match(src, /CC\.swToggle\(sw, Date\.now\(\)\)/);
  // a stop button is its own button beside the pill, never inside it, and never in the bar window
  assert.match(src, /g\.appendChild\(c\.btn\);[\s\S]{0,200}g\.appendChild\(c\.sb\);/);
  assert.match(src, /c\.stop = s && s\.halt && !call\(function \(\) \{ return host\(\)\.barwin\(\); \}\)/);
  // on a phone the first live pill stays in the bar
  assert.match(sb, /if \(f && k !== keep\)/);
  // the recording dot blinks only when motion is welcome
  assert.match(src, /prefers-reduced-motion: no-preference\) \{ \.sb-chip\.sb-rec/);
  assert.match(src, /data-oros-motion=\\"reduce\\"\] \.sb-chip\.sb-rec svg \{ animation: none/);
  const cap = read("capture/app.js");
  assert.match(cap, /B\.live\("rec", r \? \{/);
  assert.match(cap, /rec = null;\s+barLive\(null\);/);
  assert.match(cap, /addEventListener\("pagehide", function \(\) \{ barLive\(null\); \}\)/);
  assert.doesNotMatch(cap, /localStorage\.setItem\("oros-capture/);
  const sh = read("shell.js");
  assert.match(sh, /name === "smartbar-live"\) \{[\s\S]{0,200}setLive\(!!value\)/);
  assert.match(sh, /barwin: function \(\) \{ return BARWIN; \}/);
  assert.match(read("settings/settings.js"), /set\("smartbar-live", v\)/);
  const core = read("settings/core.js"), de = read("i18n/de/settings.js");
  ["sb.live", "sb.live.hint"].forEach((k) => {
    assert.strictEqual(core.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
  // the stopwatch and timer files Time keeps stay what the bar reads
  const tm = read("time/time.js");
  assert.match(tm, /var TMR_KEY = "oros-time-timers";/);
  assert.match(tm, /var SW_KEY = "oros-time-sw";/);
  assert.match(tm, /if \(ev\.key === TMR_KEY\) \{ tmrLoad\(\); tmrRender\(\); \}/);
});

// PEEK-1 (smartbar 1.4.0): peek panels from the weather chip and the event chip.
test("PEEK-1 peekRows: timed rows by time, untimed after, no sensitive app, no info rows, at most max", () => {
  const rows = [
    { app: "todo", title: "Buy milk", kind: "task" },
    { app: "calendar", title: "Dentist", time: "15:00", kind: "event" },
    { app: "calendar", title: "Standup", time: "09:30", kind: "event" },
    { app: "diary", title: "Secret", time: "08:00", kind: "event" },
    { app: "weather", title: "Sunny", kind: "info" },
    { app: "calendar", title: "", time: "10:00", kind: "event" },
    null
  ];
  const out = M.peekRows(rows, { diary: true }, 6).map((r) => r.title);
  assert.deepStrictEqual(out, ["Standup", "Dentist", "Buy milk"]);
  assert.strictEqual(M.peekRows(rows, {}, 2).length, 2);
  assert.deepStrictEqual(M.peekRows(null), []);
});

test("PEEK-1 hiLo: max / min, one side, nothing", () => {
  assert.strictEqual(M.hiLo(23.6, 14.2), "24° / 14°");
  assert.strictEqual(M.hiLo(23.6, null), "24°");
  assert.strictEqual(M.hiLo(null, -0.4), "0°");
  assert.strictEqual(M.hiLo(null, null), "");
});

test("PEEK-1 wiring: the weather chip peeks first, the shell keeps 7 days, panel safety", () => {
  const sh = read("shell.js"), src = read("smartbar.js");
  assert.match(sh, /SB\.peek\("weather", chip\)\) return;/);
  assert.match(sh, /daily: wxDailyOf\(d\.daily\)/);
  assert.match(sh, /daily: wxDailyRows\(p\.daily\)/);
  assert.match(sh, /weather: function \(\) \{ return wxPeekData\(\); \}/);
  assert.match(src, /go: function \(\) \{ peek\("event", chips\.event && chips\.event\.btn\); \}/);
  // Escape and outside taps close it; nothing behind the lock; titles hide under Sensitive work
  assert.match(src, /e\.key === "Escape" && peekEl/);
  assert.match(src, /addEventListener\("touchstart", onPeekDown, true\)/);
  assert.match(src, /locked\(\)\) return false;/);
  assert.match(src, /var what = st \? t\("sb\.event\.hidden"\) : r\.title/);
  ["pk.today", "pk.open", "pk.rain", "pk.none"].forEach((k) => {
    assert.ok(read("translations.js").split('"' + k + '"').length === 3, k + " EN + EL");
    assert.ok(read("i18n/de/shell.js").includes('"' + k + '"'), k + " DE");
  });
});

// AI-USE (smartbar 1.5.0): the Assistant's use this month on the person's own keys.
test("AI-USE aiUsage: own keys only, local models never, Tavily searches, nothing = null", () => {
  const prefs = { usage: {
    "2026-11": { anthropic: { i: 1200, o: 300, ws: 2 }, openai: { i: 50, o: 50 }, local: { i: 99999, o: 99999 }, webllm: { i: 5, o: 5 }, browser: { i: 1, o: 1 }, bad: null },
    "2026-10": { anthropic: { i: 7, o: 7 } } },
    srch: { "2026-11": { tavily: 812 } } };
  assert.deepStrictEqual(M.aiUsage(prefs, "2026-11"), { tok: 1600, ws: 2, tav: 812 });
  assert.deepStrictEqual(M.aiUsage(prefs, "2026-10"), { tok: 14, ws: 0, tav: 0 });
  assert.strictEqual(M.aiUsage(prefs, "2026-09"), null);
  assert.strictEqual(M.aiUsage({ usage: { "2026-11": { local: { i: 9, o: 9 } } } }, "2026-11"), null);
  assert.strictEqual(M.aiUsage(null, "2026-11"), null);
  assert.deepStrictEqual(M.aiUsage({ srch: { "2026-11": { tavily: 3 } } }, "2026-11"), { tok: 0, ws: 0, tav: 3 });
  assert.strictEqual(M.TAVILY_FREE, 1000);
});

test("AI-USE compact numbers and wiring", () => {
  assert.deepStrictEqual([0, 950, 12400, 12000, 182345, 1234567, 2000000].map(M.compact), ["0", "950", "12.4k", "12k", "182k", "1.2M", "2M"]);
  assert.ok(M.KINDS.includes("ai"));
  const src = read("smartbar.js"), as = read("assistant/assistant.js");
  assert.match(src, /orosLock\.apps\.state\("assistant"\)/);          // hidden while the Assistant is locked
  assert.match(as, /addSearch\(src\);/);                               // one answered search counted
  assert.match(as, /if \(p\.srch && typeof p\.srch === "object"\) prefs\.srch = p\.srch;/);
  assert.doesNotMatch(as.slice(as.indexOf("function addSearch"), as.indexOf("function provName")), /\bq\b|query/);
});
