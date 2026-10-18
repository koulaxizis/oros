"use strict";
// Automations: recipes/core.js (the synced list, checking steps) and
// atelier/recipesteps.js (Atelier's steps, Record).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const R = require(path.join(ROOT, "recipes/core.js"));
const S = require(path.join(ROOT, "atelier/recipesteps.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

function design() {
  const d = AX.newDesign({ name: "Summer sale", w: 1080, h: 1080 }, 1000);
  const pg = d.pages[0].id;
  AX.addItem(d, pg, { k: "text", tx: "Summer sale 2026", size: 60, x: 40, y: 40, w: 600, fc: "#FF0000" }, 1000);
  AX.addItem(d, pg, { k: "text", tx: "summer is here, SUMMERTIME", size: 30, x: 40, y: 300, w: 600, font: "serif" }, 1000);
  AX.addItem(d, pg, { k: "shape", shp: "star", fc: "#ff0000", sc: "#00ff00", x: 10, y: 10, w: 80, h: 80 }, 1000);
  AX.addItem(d, pg, { k: "photo", a: "a".repeat(64) + ".jpg", iw: 10, ih: 10, x: 0, y: 500, w: 200, h: 200 }, 1000);
  return M.normDoc(d);
}
const texts = (d) => d.items.filter((i) => i.ax && i.ax.k === "text").map((i) => i.ax.tx).sort();
const step = (s) => { const c = R.normStep(s, S.CATALOG); assert.ok(c, JSON.stringify(s)); return c; };

test("recipes: the list merges per recipe, newer wins, tombstones remove", () => {
  const a = { list: [{ id: "rc-aaaaaa", m: 5, app: "atelier", nm: "One", steps: [{ op: "text", find: "a", repl: "b" }], pos: 1 }] };
  const b = { list: [{ id: "rc-aaaaaa", m: 9, app: "atelier", nm: "One v2", steps: [], pos: 1 },
    { id: "rc-bbbbbb", m: 3, app: "layout", nm: "L", steps: [], pos: 2 }], dt: { "rc-bbbbbb": 3 } };
  const m = R.merge(a, b);
  assert.deepEqual(m.list.map((r) => r.nm), ["One v2"]);
  assert.deepEqual(R.merge(b, a), m);                 // order does not matter
  assert.deepEqual(R.merge(m), m);                    // canonical
  assert.equal(R.merge({ list: [{ id: "bad", m: 1, app: "atelier" }] }).list.length, 0);
  assert.equal(R.ofApp(R.merge(a, { list: b.list.slice(1) }), "layout").length, 1);
});

test("recipes: steps from a newer orOS are kept as they are, but never run", () => {
  const r = { id: "rc-cccccc", m: 2, app: "atelier", nm: "x", pos: 0,
    steps: [{ op: "text", find: "a", repl: "b", cs: 1, word: 0 }, { op: "warpText", amount: 3, opts: { zz: [1, 2] } }] };
  const kept = R.merge({ list: [r] }).list[0];
  assert.deepEqual(kept.steps[1], { amount: 3, op: "warpText", opts: { zz: [1, 2] } });
  const c = R.check(kept, S.CATALOG);
  assert.equal(c.steps.length, 1);
  assert.equal(c.skipped, 1);
  // not plain data: dropped from the list
  assert.equal(R.merge({ list: [Object.assign({}, r, { steps: [{ op: "x", f: NaN }] })] }).list[0].steps.length, 0);
});

test("recipes: arguments are checked against the catalog", () => {
  assert.equal(R.normStep({ op: "text", find: "" }, S.CATALOG), null);          // find is required
  assert.equal(R.normStep({ op: "color", from: "red", to: "#fff000" }, S.CATALOG), null);
  assert.equal(R.normStep({ op: "eval", code: "alert(1)" }, S.CATALOG), null);   // no such step
  assert.deepEqual(step({ op: "size", pct: 5000 }), { op: "size", pct: 1000 });
  assert.deepEqual(step({ op: "color", from: "#AABBCC", to: "#000000" }), { op: "color", from: "#aabbcc", to: "#000000" });
  assert.deepEqual(step({ op: "export", fmt: "exe" }), { op: "export", fmt: "png", scale: 1, dpi: 300 });
  assert.equal(R.normStep({ op: "resize", sizes: [] }, S.CATALOG), null);
  assert.deepEqual(step({ op: "resize", sizes: [{ w: 100, h: 50 }] }).sizes, [{ w: 100, h: 50, u: "px", p: "" }]);
});

test("atelier steps: replace text, case and whole words", () => {
  let d = design();
  S.apply(d, step({ op: "text", find: "summer", repl: "Autumn" }), { now: 2000 });
  assert.deepEqual(texts(d), ["Autumn sale 2026", "Autumn is here, AutumnTIME"].sort());
  d = design();
  S.apply(d, step({ op: "text", find: "summer", repl: "Autumn", word: 1 }), { now: 2000 });
  assert.deepEqual(texts(d), ["Autumn sale 2026", "Autumn is here, SUMMERTIME"].sort());
  d = design();
  const n = S.apply(d, step({ op: "text", find: "summer", repl: "Autumn", cs: 1 }), { now: 2000 });
  assert.equal(n, 1);
  assert.deepEqual(texts(d), ["Summer sale 2026", "Autumn is here, SUMMERTIME"].sort());
  // special characters are text, not a pattern
  d = design();
  assert.equal(S.apply(d, step({ op: "text", find: ".*", repl: "x" }), { now: 2000 }), 0);
});

test("atelier steps: colours, fonts, sizes, filters, centring; stamps only what changed", () => {
  const d = design();
  const before = JSON.parse(JSON.stringify(d));
  assert.equal(S.apply(d, step({ op: "color", from: "#ff0000", to: "#0000ff" }), { now: 3000 }), 2);
  assert.equal(d.items.filter((i) => i.ax.fc === "#0000ff").length, 2);
  assert.equal(S.apply(d, step({ op: "font", from: "serif", to: "mono" }), { now: 3000 }), 1);
  assert.equal(S.apply(d, step({ op: "font", from: "", to: "serif" }), { now: 3000 }), 2);
  const sizes = d.items.filter((i) => i.ax.k === "text").map((i) => i.ax.size);
  S.apply(d, step({ op: "size", pct: 150 }), { now: 3000 });
  assert.deepEqual(d.items.filter((i) => i.ax.k === "text").map((i) => i.ax.size), sizes.map((s) => s * 1.5));
  assert.equal(S.apply(d, step({ op: "filter", flt: "sepia" }), { now: 3000 }), 1);
  assert.equal(S.apply(d, step({ op: "center", what: "text" }), { now: 3000 }), 2);
  d.items.filter((i) => i.ax.k === "text").forEach((i) => assert.equal(i.x, (1080 - i.w) / 2));
  const bg = d.items.find((i) => i.ax.bg);
  assert.equal(bg.m, before.items.find((i) => i.id === bg.id).m);     // the background was not touched
  // the same recipe twice changes nothing more
  assert.equal(S.apply(d, step({ op: "color", from: "#ff0000", to: "#0000ff" }), { now: 4000 }), 0);
  assert.ok(M.normDoc(d));
});

test("atelier record: changed words, colours, fonts and sizes become steps", () => {
  const a = design(), b = JSON.parse(JSON.stringify(a));
  const t0 = b.items.find((i) => i.ax.tx === "Summer sale 2026");
  t0.ax.tx = "Autumn sale 2026";
  t0.ax.fc = "#123456";
  b.items.find((i) => i.ax.font === "serif").ax.font = "mono";
  b.items.filter((i) => i.ax.k === "text").forEach((i) => { i.ax.size *= 2; });
  b.items.find((i) => i.ax.k === "photo").ax.flt = "noir";
  const steps = S.learn(a, b);
  assert.deepEqual(steps, [
    { op: "text", find: "Summer", repl: "Autumn", cs: 1, word: 0 },
    { op: "color", from: "#ff0000", to: "#123456" },
    { op: "font", from: "serif", to: "mono" },
    { op: "size", pct: 200 },
    { op: "filter", flt: "noir" }
  ]);
  // replaying them on the original gives the same words and colours
  const c = JSON.parse(JSON.stringify(a));
  steps.forEach((s) => S.apply(c, step(s), { now: 5000 }));
  assert.equal(c.items.find((i) => i.id === t0.id).ax.tx, "Autumn sale 2026");
  assert.equal(S.learn(a, a).length, 0);
});

test("atelier record: a changed part of a word grows to the whole word", () => {
  assert.deepEqual(S.textChange("Summer sale", "Summers sale"), { find: "Summer", repl: "Summers" });
  assert.deepEqual(S.textChange("Καλοκαίρι 2026", "Καλοκαίρι 2027"), { find: "2026", repl: "2027" });
  assert.deepEqual(S.textChange("", "new"), null);
  assert.deepEqual(S.textChange("a b", "a  b"), { find: "b", repl: " b" });
});
