// Layout W14 (LY-W14): symbols. A symbol (setup.ext.sym) is a group of
// objects kept once; each placement is a group whose objects carry
// ext.sym {s, k}. Made from a selection, placed at any size, updated
// from one placement (every other one follows in its own box, keeping
// its ids and stories), detached, renamed, deleted (placements stay as
// plain objects); the `symbol` command, strings in EN/EL/DE, wiring.
// Synthetic documents only.
// Run: node --test tests/layout-w14b.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const M = require(path.join(ROOT, "designkit/model.js"));
const SY = require(path.join(ROOT, "layout/symbols.js"));

let seq = 0;
const idf = (p) => p + "-t" + (++seq);

function doc() {
  const d = M.newDoc({ name: "Σύμβολα", w: 300, h: 300, pages: 2, facing: 0 }, 1);
  const pg = M.pagesInOrder(d)[0];
  d.stories.push({ id: "st-a", m: 1, paras: [{ ps: "ps-body", runs: [{ t: "Σειρά" }] }] });
  d.items.push({ id: "it-a", m: 1, t: "rect", pg: pg.id, x: 40, y: 40, w: 100, h: 50, fill: "sw-yellow", z: 1 });
  d.items.push({ id: "it-b", m: 1, t: "text", pg: pg.id, x: 40, y: 90, w: 100, h: 30, story: "st-a", seq: 1, z: 2 });
  d.items.push({ id: "it-c", m: 1, t: "rect", pg: M.pagesInOrder(d)[1].id, x: 0, y: 0, w: 10, h: 10, z: 1 });
  return M.normDoc(d);
}

test("make: a selection on one page becomes a symbol and its first placement; checks", () => {
  const d = doc();
  assert.equal(SY.make(d, [], "x", 2, idf).err, "few");
  assert.equal(SY.make(d, ["it-a", "it-c"], "x", 2, idf).err, "page");
  const s = SY.make(d, ["it-a", "it-b"], "Λογότυπο", 2, idf);
  assert.ok(s.id && /^sy-/.test(s.id), JSON.stringify(s));
  assert.equal(s.w, 100); assert.equal(s.h, 80);
  const D = SY.def(s);
  assert.deepEqual(D.it.map((c) => [c.t, c.x, c.y]), [["rect", 0, 0], ["text", 0, 50]]);
  assert.ok(!("id" in D.it[0]) && !("pg" in D.it[0]) && !("story" in D.it[1]), "a definition keeps no ids, page or story");
  assert.equal(D.st[D.it[1].k][0].runs[0].t, "Σειρά");
  assert.equal(SY.list(d).length, 1);
  assert.equal(SY.make(d, ["it-c"], "λογότυπο", 3, idf).err, undefined, "names compare as written");
  assert.equal(SY.make(d, ["it-c"], "Λογότυπο", 3, idf).err, "name");
  const a = M.find(d.items, "it-a"), b = M.find(d.items, "it-b");
  assert.equal(a.grp, b.grp); assert.equal(a.ext.sym.s, s.id);
  assert.equal(SY.instances(d, s.id).length, 1);
  assert.equal(SY.groupOf(d, a).sym.id, s.id);
});

test("kept through normDoc: text, effects and the rest of setup.ext stay (normX depth and size)", () => {
  let d = doc();
  M.find(d.items, "it-a").ext = { fx: { sh: { x: 3, y: 3, b: 4, o: 50 } } };
  M.story(d, "st-a").paras = [{ ps: "ps-body", runs: [{ t: "Σειρά", b: 1 }, { t: " Νύχτα" }] }];
  d.setup.ext = Object.assign({}, d.setup.ext || {}, { pnStart: 3 });
  const s = SY.make(d, ["it-a", "it-b"], "Λογότυπο", 2, idf);
  assert.ok(!s.err);
  d = M.normDoc(JSON.parse(JSON.stringify(d)));
  assert.equal(d.setup.ext.pnStart, 3, "the rest of setup.ext kept");
  assert.equal(SY.list(d).length, 1);
  const D = SY.def(SY.list(d)[0]);
  assert.equal(D.it[0].ext.fx.sh.b, 4);
  assert.equal(D.st[D.it[1].k][0].runs[1].t, " Νύχτα");
  const made = SY.place(d, s.id, M.pagesInOrder(d)[1].id, 0, 0, 3, idf);
  d = M.normDoc(JSON.parse(JSON.stringify(d)));
  assert.equal(SY.instances(d, s.id).length, 2);
  assert.equal(M.find(d.items, made[0].id).ext.fx.sh.b, 4);
  // a definition that would not fit is refused, nothing written
  const big = doc();
  M.story(big, "st-a").paras = [{ ps: "ps-body", runs: [{ t: "α".repeat(3990) }] }];
  assert.equal(SY.make(big, ["it-a", "it-b"], "x", 2, idf).err, "big");
  assert.ok(!big.setup.ext || !big.setup.ext.sym);
});

test("place: at its own size or scaled, a new group with its own story; limits", () => {
  const d = doc();
  const s = SY.make(d, ["it-a", "it-b"], "Λογότυπο", 2, idf);
  const pg2 = M.pagesInOrder(d)[1];
  const made = SY.place(d, s.id, pg2.id, 10, 20, 3, idf, 50);
  assert.equal(made.length, 2);
  assert.deepEqual(made.map((it) => [it.x, it.y, it.w, it.h]), [[10, 20, 50, 25], [10, 45, 50, 15]]);
  assert.ok(made[0].grp && made[0].grp === made[1].grp && made[0].grp !== M.find(d.items, "it-a").grp);
  assert.notEqual(made[1].story, "st-a");
  assert.equal(M.story(d, made[1].story).paras[0].runs[0].t, "Σειρά");
  assert.equal(SY.instances(d, "Λογότυπο").length, 2, "found by name too");
  assert.deepEqual(SY.place(d, "nope", pg2.id, 0, 0, 4, idf), []);
  assert.ok(JSON.stringify(SY.list(d)).length <= SY.MAX_BYTES);
});

test("update from one placement: every other placement follows in its own box, keeping ids and stories", () => {
  const d = doc();
  const s = SY.make(d, ["it-a", "it-b"], "Λογότυπο", 2, idf);
  const pg2 = M.pagesInOrder(d)[1];
  const made = SY.place(d, s.id, pg2.id, 10, 20, 3, idf, 50);
  const keepIds = made.map((it) => it.id), keepStory = made[1].story;
  // the first placement changes: a wider rectangle in another colour, new text
  const a = M.find(d.items, "it-a");
  a.w = 200; a.fill = "sw-black";
  M.story(d, "st-a").paras = [{ ps: "ps-body", runs: [{ t: "Νέα σειρά" }] }];
  assert.equal(SY.redefine(d, "it-a", 4, idf), 2);
  const s2 = SY.find(d, s.id);
  assert.equal(s2.w, 200);
  const other = SY.instances(d, s.id).filter((x) => x.pg === pg2.id)[0];
  assert.deepEqual(other.items.map((it) => it.id).sort(), keepIds.slice().sort(), "ids kept");
  const r = other.items.filter((it) => it.t === "rect")[0], tx = other.items.filter((it) => it.t === "text")[0];
  assert.equal(r.fill, "sw-black");
  assert.equal(r.x, 10); assert.equal(r.w, 100, "the placement keeps its scale (half): 200 × 0.5");
  assert.equal(r.h, 25);
  assert.equal(tx.story, keepStory, "its story kept");
  assert.equal(M.story(d, keepStory).paras[0].runs[0].t, "Νέα σειρά");
  assert.equal(d.stories.filter((st) => st.paras && JSON.stringify(st.paras).includes("Νέα σειρά")).length, 2, "no stray stories");
});

test("update: an object gone from the definition goes from every placement (tombstoned)", () => {
  const d = doc();
  const s = SY.make(d, ["it-a", "it-b"], "Λογότυπο", 2, idf);
  const made = SY.place(d, s.id, M.pagesInOrder(d)[1].id, 10, 20, 3, idf);
  const gone = made.filter((it) => it.t === "text")[0];
  d.items = d.items.filter((it) => it.id !== "it-b");
  assert.equal(SY.redefine(d, "it-a", 4, idf), 2);
  assert.ok(!M.find(d.items, gone.id));
  assert.ok(d.tombs[gone.id] >= 4);
  assert.ok(!d.stories.some((st) => st.id === gone.story), "its story too");
});

test("detach, rename, delete", () => {
  const d = doc();
  const s = SY.make(d, ["it-a", "it-b"], "Λογότυπο", 2, idf);
  SY.place(d, s.id, M.pagesInOrder(d)[1].id, 0, 0, 3, idf);
  assert.equal(SY.detach(d, "it-a", 4), 2);
  assert.ok(!M.find(d.items, "it-a").ext || !M.find(d.items, "it-a").ext.sym);
  assert.equal(SY.instances(d, s.id).length, 1);
  assert.equal(SY.rename(d, s.id, "Σήμα", 5), 1);
  assert.equal(SY.find(d, "Σήμα").id, s.id);
  assert.equal(SY.rename(d, "Σήμα", "", 6), 0);
  assert.equal(SY.remove(d, "Σήμα", 7), 3);
  assert.equal(SY.list(d).length, 0);
  assert.ok(!d.items.some((it) => it.ext && it.ext.sym), "placements are plain objects");
  assert.ok(!d.setup.ext || !d.setup.ext.sym);
  assert.equal(M.normDoc(d).items.length, d.items.length);
});

test("symbol command: checked, make, place in mm (centred by default), update, delete", () => {
  const C = require(path.join(ROOT, "layout/commands.js"));
  assert.equal(C.check([{ op: "symbol", act: "place" }]).ok, false, "needs a name");
  let d = doc();
  const run = (st, now) => { const c = C.check([Object.assign({ op: "symbol" }, st)]); assert.equal(c.ok, true, c.err); return C.apply(d, c.steps[0], { now: now, idf: idf }); };
  assert.equal(run({ act: "make", name: "Λογότυπο", frame: "it-a, it-b" }, 2), 2);
  assert.equal(run({ act: "place", name: "Λογότυπο", page: 2 }, 3), 2);
  const placed = SY.instances(d, "Λογότυπο").filter((x) => x.pg === M.pagesInOrder(d)[1].id)[0];
  const b = SY.box(placed.items), ps = M.pageSize(d, M.pagesInOrder(d)[1]);
  assert.ok(Math.abs(b.x - (ps.w - 100) / 2) < 1e-6 && Math.abs(b.y - (ps.h - 80) / 2) < 1e-6, "centred");
  assert.equal(run({ act: "place", name: "Λογότυπο", page: 2, x: 10, y: 10, w: 20 }, 4), 2);
  M.find(d.items, "it-a").fill = "sw-black";
  assert.equal(run({ act: "update", name: "Λογότυπο", frame: "it-a" }, 5), 3);
  assert.equal(run({ act: "place", name: "nope", page: 1 }, 6), 0);
  assert.equal(run({ act: "delete", name: "Λογότυπο" }, 7), 7);
  d = doc();
  assert.equal(run({ act: "make", name: "x", frame: "it-a,it-c" }, 2), 0, "two pages: nothing");
});

test("wiring: More › Symbols…, scripts, strings and help in EN/EL/DE", () => {
  const pn = read("layout/panels.js");
  assert.ok(/LY\.symbols\.dialog\(\)/.test(pn));
  assert.ok(/<script src="symbols\.js\?v=/.test(read("layout/index.html")));
  assert.ok(/<script src="\.\.\/layout\/symbols\.js\?v=/.test(read("assistant/index.html")));
  assert.ok(read("sw.js").includes('"layout/symbols.js"'));
  const src = read("layout/symbols.js"), lay = read("layout/layout.js"), de = read("i18n/de/layout.js");
  const keys = Array.from(new Set((src.match(/"sym\.[a-zA-Z]+"/g) || []).map((m) => m.slice(1, -1)))).concat(["more.symbols"]);
  assert.ok(keys.length >= 20, String(keys.length));
  keys.forEach((k) => {
    assert.equal((lay.match(new RegExp('"' + k.replace(/\./g, "\\.") + '": "', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '": "'), k + " DE");
  });
  assert.ok(read("layout/help.en.txt").includes("## Symbols\n"));
  assert.ok(read("layout/help.el.txt").includes("## Σύμβολα\n"));
  assert.ok(read("i18n/de/help/layout.txt").includes("## Symbole\n"));
});
