// Smart top bar (smartbar.js, SB1): the pure model, the shell wiring,
// the Settings card and the strings in every language.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require("../smartbar.js");
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
  assert.deepStrictEqual(src.match(/innerHTML = [^;]+;/g), ["innerHTML = IC[kind];"]);
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
    "sb.budget.label", "sb.budget.tip", "sb.sales.label", "sb.sales.tip", "sb.savefail"]);
  keys.forEach((k) => {
    assert.strictEqual(tr.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
  const src = read("smartbar.js");
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
