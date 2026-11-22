// Layout: working comfort (LY-N2): lengths in the document's unit,
// smart guides for equal gaps, the named undo history, changeable
// shortcuts (by key place, so a Greek keyboard works), the arrow-key
// step, and every string of the toolbar, History and Shortcuts dialogs
// in English, Greek and German.
// Run: node --test tests/layout-comfort.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const S = require(path.join(ROOT, "layout/smart.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MM = 72 / 25.4;

const LYJS = read("layout/layout.js");
const EL_AT = LYJS.indexOf('"home.new": "Νέο έγγραφο"');
function table(part) {
  const out = {}, re = /"([a-z][a-zA-Z0-9.]*)": "((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(part))) if (!(m[1] in out)) out[m[1]] = JSON.parse('"' + m[2] + '"');
  return out;
}
const EN = table(LYJS.slice(0, EL_AT)), EL = table(LYJS.slice(EL_AT));
const DE = table(read("i18n/de/layout.js"));

test("comfort: lengths in mm, pt and in", () => {
  assert.equal(S.fmt(10 * MM, "mm"), "10 mm");
  assert.equal(S.fmt(12.34 * MM, "mm"), "12.3 mm");
  assert.equal(S.fmt(36, "pt"), "36 pt");
  assert.equal(S.fmt(36, "in"), "0.5 in");
  assert.equal(S.fmt(-0.01, "mm"), "0 mm");
  assert.equal(S.fmt(72, "furlong"), "25.4 mm");
});

test("comfort: equal gaps in a row snap and are marked", () => {
  // two boxes 20 apart; a third dragged near 20 to the right of the second
  const a = { x: 0, y: 0, w: 50, h: 40 }, b = { x: 70, y: 0, w: 50, h: 40 };
  const g = S.spacing({ x: 143, y: 5, w: 50, h: 30 }, [a, b], "x", 4);
  assert.ok(g, "snaps");
  assert.equal(Math.round(g.d * 100) / 100, -3);
  assert.equal(g.gap, 20);
  assert.equal(g.marks.length, 2);
  assert.deepEqual(g.marks.map((m) => [m.a0, m.a1]), [[50, 70], [120, 140]]);
  // out of reach: no snap
  assert.equal(S.spacing({ x: 160, y: 5, w: 50, h: 30 }, [a, b], "x", 4), null);
  // to the left of the first one
  const l = S.spacing({ x: -68, y: 0, w: 50, h: 40 }, [a, b], "x", 4);
  assert.ok(l);
  assert.equal(l.d, -2);
  // between two: the middle, equal on both sides
  const c = { x: 200, y: 0, w: 50, h: 40 };
  const m = S.spacing({ x: 138, y: 0, w: 40, h: 40 }, [b, c], "x", 4);
  assert.ok(m);
  assert.equal(m.d + 138, 140);
  assert.equal(m.gap, 20);
  // a box in another row does not count
  assert.equal(S.spacing({ x: 143, y: 100, w: 50, h: 30 }, [a, b], "x", 4), null);
  // vertical: a column
  const v = S.spacing({ x: 0, y: 142, w: 50, h: 40 }, [{ x: 0, y: 0, w: 50, h: 40 }, { x: 0, y: 70, w: 50, h: 40 }], "y", 4);
  assert.ok(v);
  assert.equal(v.d, -2);
  assert.equal(S.spacing({ x: 0, y: 0, w: 10, h: 10 }, [], "x", 4), null);
});

test("comfort: undo steps get names", () => {
  const base = { name: "D", setup: { w: 100, unit: "mm" }, items: [{ id: "a", m: 1, x: 0, y: 0, w: 10, h: 10 }, { id: "b", m: 1, x: 20, y: 0, w: 10, h: 10 }], stories: [{ id: "s", m: 1, t: "x" }], pstyles: [{ id: "ps-body", m: 1, name: "Body", size: 10 }], cstyles: [], swatches: [], pages: [{ id: "p", m: 1 }], masters: [], guides: [] };
  const C = (f) => { const d = JSON.parse(JSON.stringify(base)); f(d); return d; };
  assert.deepEqual(S.describe(base, C((d) => { d.items[0].x = 5; d.items[0].m = 2; })), { k: "move", n: 1 });
  assert.deepEqual(S.describe(base, C((d) => { d.items.forEach((it) => { it.y = 3; }); })), { k: "move", n: 2 });
  assert.deepEqual(S.describe(base, C((d) => { d.items[0].x = -2; d.items[0].w = 12; })), { k: "resize", n: 1 });
  assert.deepEqual(S.describe(base, C((d) => { d.items[1].rot = 15; })), { k: "rotate", n: 1 });
  assert.deepEqual(S.describe(base, C((d) => { d.items[1].fill = "sw-red"; })), { k: "change", n: 1 });
  assert.deepEqual(S.describe(base, C((d) => { d.items.push({ id: "c", m: 3, x: 0, y: 0, w: 1, h: 1 }); d.stories.push({ id: "s2", m: 3 }); })), { k: "add", n: 1 });
  assert.deepEqual(S.describe(base, C((d) => { d.items = []; })), { k: "del", n: 2 });
  assert.deepEqual(S.describe(base, C((d) => { d.stories[0].t = "y"; })), { k: "text", n: 1 });
  assert.deepEqual(S.describe(base, C((d) => { d.pstyles[0].size = 11; })), { k: "style", n: 1, name: "Body" });
  assert.deepEqual(S.describe(base, C((d) => { d.setup.unit = "pt"; })), { k: "setup", n: 1 });
  assert.deepEqual(S.describe(base, C((d) => { d.guides.push({ id: "g", m: 1, o: "v", p: 3 }); })), { k: "guide", n: 1 });
  assert.equal(S.describe(base, C((d) => { d.pages.push({ id: "q", m: 2 }); d.setup.unit = "in"; })).k, "edit");
  assert.equal(S.describe(null, base).k, "edit");
  S.HIST_KEYS.forEach((k) => assert.ok(S.HIST_KEYS.indexOf(k) >= 0));
});

test("comfort: shortcuts by key place, changeable, never the reserved ones", () => {
  const map = S.keymap();
  assert.equal(map["tool.text"], "KeyT");
  assert.equal(map.undo, "Mod+KeyZ");
  assert.equal(S.lookup(map, "Mod+KeyD"), "dup");
  // a Greek keyboard sends e.key "τ" for the T key: the code still matches
  assert.equal(S.comboOf({ code: "KeyT", key: "τ" }), "KeyT");
  assert.equal(S.comboOf({ code: "KeyZ", ctrlKey: true, shiftKey: true }), "Mod+Shift+KeyZ");
  assert.equal(S.comboOf({ code: "KeyZ", metaKey: true }), "Mod+KeyZ");
  assert.equal(S.comboOf({ code: "Numpad0", ctrlKey: true }), "Mod+Digit0");
  assert.equal(S.comboOf({ code: "ShiftLeft", shiftKey: true }), null);
  // changing one: the default that had the same keys gives them up
  const mine = S.keymap({ dup: "KeyT" });
  assert.equal(mine.dup, "KeyT");
  assert.equal(mine["tool.text"], "");
  assert.equal(S.lookup(mine, "KeyT"), "dup");
  // what is saved is checked
  assert.deepEqual(S.normKeys({ dup: "Mod+KeyC", nope: "KeyQ", undo: 5, redo: "Mod+Shift+KeyY", lock: "" }), { redo: "Mod+Shift+KeyY", lock: "" });
  assert.deepEqual(S.normKeys(null), {});
  assert.equal(S.valid("Mod+KeyV"), false);
  assert.equal(S.valid("ArrowLeft"), false);
  assert.equal(S.valid("Mod+Alt+KeyZ"), true);
  assert.equal(S.valid("Mod+ShiftLeft"), false);
  assert.equal(S.label("Mod+Shift+BracketRight", false), "Ctrl+Shift+]");
  assert.equal(S.label("Mod+KeyZ", true), "⌘Z");
  assert.equal(S.label("", false), "");
  // ids are unique, every default is valid and taken once
  const ids = S.ACTIONS.map((a) => a[0]);
  assert.equal(new Set(ids).size, ids.length);
  const used = S.ACTIONS.map((a) => a[1]).filter(Boolean);
  assert.equal(new Set(used).size, used.length);
  used.forEach((c) => assert.ok(S.valid(c), c));
});

test("comfort: the arrow-key step follows the unit", () => {
  assert.ok(Math.abs(S.nudge("mm") - 0.5 * MM) < 1e-9);
  assert.equal(S.nudge("pt"), 1);
  assert.ok(Math.abs(S.nudge("in") - 3.6) < 1e-9);
  assert.ok(Math.abs(S.nudge("mm", 2) - 2 * MM) < 1e-9);
  assert.equal(S.nudge("pt", -1), 1);
  assert.equal(S.nudge("pt", 500), 1);
});

test("comfort: every string in English, Greek and German", () => {
  const src = read("layout/comfort.js") + read("layout/editor.js") + read("layout/panels.js");
  const keys = new Set();
  const re = /\bt\("([a-z][a-zA-Z0-9.]*)"(?! \+)/g;
  let m;
  while ((m = re.exec(src))) if (/^(cb|hist|keys|ka|ruler|more)\./.test(m[1])) keys.add(m[1]);
  S.ACTIONS.forEach((a) => keys.add("ka." + a[0]));
  S.HIST_KEYS.forEach((k) => keys.add("hist." + k));
  ["add", "del", "move", "resize", "rotate", "change", "style"].forEach((k) => keys.add("hist." + k + "N"));
  assert.ok(keys.size > 60);
  keys.forEach((k) => {
    assert.ok(EN[k], "EN " + k);
    assert.ok(EL[k], "EL " + k);
    assert.ok(DE[k], "DE " + k);
    // the placeholders match
    const ph = (s) => (s.match(/\{[a-z]+\}/g) || []).sort().join();
    assert.equal(ph(EL[k]), ph(EN[k]), "EL placeholders " + k);
    assert.equal(ph(DE[k]), ph(EN[k]), "DE placeholders " + k);
  });
});

test("comfort: wired into Layout", () => {
  const html = read("layout/index.html"), sw = read("sw.js");
  assert.ok(html.indexOf("smart.js") > 0 && html.indexOf("smart.js") < html.indexOf('"layout.js'), "smart.js before layout.js");
  assert.ok(html.indexOf("comfort.js") > html.indexOf("panels.js"), "comfort.js after panels.js");
  assert.ok(sw.includes('"layout/smart.js"') && sw.includes('"layout/comfort.js"'));
  assert.ok(LYJS.includes("LY.history = function"));
  assert.ok(LYJS.includes("LY.historyGo = function"));
});
