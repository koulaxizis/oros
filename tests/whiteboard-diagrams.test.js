// Whiteboard wave DG1: diagram symbols (whiteboard/core.js SYMS + GEO)
// and the forward-safe rows (unknown fields ride along, the fuller row
// wins equal stamps), checked against the 6.29.00 core as an older
// device (tests/fixtures/whiteboard-core-6.29.js).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../whiteboard/core.js");
const OLD = require("./fixtures/whiteboard-core-6.29.js");
const CMD = require("../whiteboard/commands.js");

const shape = (id, extra) => Object.assign({ id, b: "b1", k: "shape", shp: "rect", f: "soft", c: "blue", x: 0, y: 0, w: 160, h: 90, tx: "Pay", z: 1 }, extra || {});
const board = (rows, at) => C.apply(C.putBoard(C.empty(), "b1", "Flow", 100), rows, at || 200);
const flat = (nodes) => JSON.stringify(nodes);

test("a symbol is kept on its shape, with the nearest basic shape beside it", () => {
  const d = board({ s1: shape("s1", { sym: "decision", shp: "diamond" }), n1: { id: "n1", b: "b1", k: "note", x: 0, y: 0, w: 200, h: 200, z: 1, tx: "x", sym: "decision" } });
  const s1 = d.objs.find((o) => o.id === "s1"), n1 = d.objs.find((o) => o.id === "n1");
  assert.equal(s1.sym, "decision");
  assert.equal(s1.shp, "diamond");
  assert.equal("sym" in n1, false, "only shapes carry a symbol");
  // written only when set: a plain shape serializes as before
  assert.equal("sym" in board({ s2: shape("s2") }).objs[0], false);
  // a later version's symbol stays, and is drawn as its basic shape
  const later = board({ s3: shape("s3", { sym: "quantum-gate", shp: "ellipse" }) });
  assert.equal(later.objs[0].sym, "quantum-gate");
  assert.match(flat(C.scene(later.objs, {})), /"ellipse"/);
  // a bad name is not kept
  assert.equal("sym" in board({ s4: shape("s4", { sym: "<b>" }) }).objs[0], false);
});

test("every symbol has a drawing, a known group and a basic shape, and draws without gaps", () => {
  assert.deepEqual(Object.keys(C.GEO).sort(), C.SYM_IDS.slice().sort());
  C.SYM_IDS.forEach((id) => {
    const s = C.SYMS[id];
    assert.ok(C.SYM_GROUPS.includes(s[0]), id + " group");
    assert.ok(C.SHAPES.includes(s[1]), id + " basic shape");
    assert.ok(s[2] >= 8 && s[3] >= 8, id + " size");
    ["none", "soft", "solid"].forEach((f) => {
      const d = board({ s: shape("s", { sym: id, shp: s[1], w: s[2], h: s[3], f, tx: "Two words\nand more" }) });
      const nodes = C.scene(d.objs, { live: true }), j = flat(nodes);
      assert.doesNotMatch(j, /NaN|undefined|Infinity/, id + " " + f);
      const svg = C.toSvg(C.scene(d.objs, {}), C.bounds(d.objs), { bg: "#fff" });
      assert.match(svg, /^<svg [^>]+>.*<\/svg>$/);
    });
  });
});

test("a symbol's text is escaped in the SVG file, and a UML class gets compartments from its text", () => {
  const d = board({ c1: shape("c1", { sym: "class", w: 200, h: 160, tx: "Order <b>\n--\n+ id: int\n--\n+ pay()" }) });
  const svg = C.toSvg(C.scene(d.objs, {}), C.bounds(d.objs), {});
  assert.ok(svg.includes("Order &lt;b&gt;"));
  assert.ok(!svg.includes("<b>"));
  const lines = (svg.match(/<path d="M[^"]*" stroke="[^"]*" stroke-width="1.5"/g) || []).length;
  assert.equal(lines, 2, "a line under the name and one before the methods");
  assert.ok(svg.includes(">+ id: int<") && svg.includes(">+ pay()<"));
  const i = board({ i1: shape("i1", { sym: "interface", w: 200, h: 140, tx: "Payable" }) });
  assert.ok(C.toSvg(C.scene(i.objs, {}), C.bounds(i.objs), {}).includes("«interface»"));
});

test("fields of a later version ride along through merges and edits, bounded", () => {
  const raw = shape("s1", { zq: "elbow", wp: [10, 20, 30, 40], hs: true, zz: 3, Bad: 1, _x: 1, big: "x".repeat(501), obj: { a: 1 }, arr: [1, "a"] });
  const o = C.cleanObj(raw);
  assert.equal(o.zq, "elbow");
  assert.deepEqual(o.wp, [10, 20, 30, 40]);
  assert.equal(o.hs, true);
  assert.equal(o.zz, 3);
  ["Bad", "_x", "big", "obj", "arr"].forEach((k) => assert.equal(k in o, false, k));
  assert.deepEqual(C.cleanObj(o), o, "idempotent");
  const many = {};
  for (let i = 0; i < 30; i++) many["f" + String(i).padStart(2, "0")] = i;
  assert.equal(Object.keys(C.cleanObj(shape("s2", many))).filter((k) => /^f\d\d$/.test(k)).length, 16);
  // an edit by this version keeps them
  let d = board({ s1: raw });
  const moved = C.moved(d.objs[0], 10, 0);
  d = C.apply(d, { s1: moved }, 300);
  assert.equal(d.objs[0].zq, "elbow");
  assert.equal(d.objs[0].x, 10);
});

test("an older device that drops the symbol never takes it from a newer device (equal stamps)", () => {
  const mine = board({ s1: shape("s1", { sym: "database", zq: "elbow" }) });
  // the older device merges what it pulled and pushes it back, stripped, same stamp
  const theirs = OLD.merge(OLD.empty(), JSON.parse(C.serialize(mine)));
  assert.equal("sym" in theirs.objs[0], false, "the 6.29 core drops it");
  assert.equal(theirs.objs[0].m, mine.objs[0].m);
  const a = C.merge(mine, theirs), b = C.merge(theirs, mine);
  assert.equal(C.serialize(a), C.serialize(b), "symmetric");
  assert.equal(a.objs[0].sym, "database");
  assert.equal(a.objs[0].zq, "elbow");
  // the old device still shows a plain shape with the same text
  assert.equal(theirs.objs[0].shp, "rect");
  assert.equal(theirs.objs[0].tx, "Pay");
  // a newer edit on the older device wins as usual (its stamp is newer)
  const edited = OLD.apply(theirs, { s1: Object.assign({}, theirs.objs[0], { tx: "Pay now" }) }, 999999);
  const c = C.merge(mine, edited);
  assert.equal(c.objs[0].tx, "Pay now");
  assert.equal("sym" in c.objs[0], false);
});

test("the fuller-row rule is one total order: merges of three copies agree in any order", () => {
  const base = shape("s1", { m: 500 });
  const rows = [C.cleanObj(base), C.cleanObj(Object.assign({}, base, { sym: "data" })),
    C.cleanObj(Object.assign({}, base, { tx: "Payx" })), C.cleanObj(Object.assign({}, base, { sym: "data", zq: "elbow" }))];
  rows.forEach((r) => { r.m = 500; });
  const docs = rows.map((r) => ({ ver: 1, boards: [{ id: "b1", name: "F", m: 100 }], objs: [r], tombs: {} }));
  const perms = [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1], [1, 3, 0, 2]];
  const out = perms.map((p) => C.serialize(p.reduce((acc, i) => C.merge(acc, docs[i]), C.empty())));
  out.forEach((s) => assert.equal(s, out[0]));
  assert.equal(JSON.parse(out[0]).objs[0].zq, "elbow", "the row with the most fields");
});

test("Assistant: add and style take a symbol, the outline names it", () => {
  assert.ok(CMD.CATALOG.add.args.shape.v.includes("decision"));
  assert.match(CMD.GUIDE, /diagram symbol .*\bdecision\b/);
  const w = CMD.work(board({ s1: shape("s1") }), "b1");
  let ids = 0;
  CMD.apply(w, { op: "add", what: "shape", shape: "database", text: "Orders" }, { now: 400, newId: () => "n" + ids++ });
  const added = C.objsOf(w.data, "b1").find((o) => o.id === "n0");
  assert.equal(added.sym, "database");
  assert.equal(added.shp, "rect");
  assert.equal(added.w, C.SYMS.database[2]);
  CMD.apply(w, { op: "style", ids: "s1", shape: "decision" }, { now: 500 });
  let s1 = C.objsOf(w.data, "b1").find((o) => o.id === "s1");
  assert.equal(s1.sym, "decision");
  assert.equal(s1.shp, "diamond");
  CMD.apply(w, { op: "style", ids: "s1", shape: "round" }, { now: 600 });
  s1 = C.objsOf(w.data, "b1").find((o) => o.id === "s1");
  assert.equal("sym" in s1, false, "a basic shape takes the symbol off");
  const out = CMD.outline(CMD.view(w.data).docs[0]);
  assert.equal(out.objects.find((o) => o.id === "n0").shape, "database");
});

test("the app names every symbol and group in EN, EL and DE, and the help speaks of the library", () => {
  const app = fs.readFileSync(path.join(__dirname, "../whiteboard/app.js"), "utf8");
  const de = fs.readFileSync(path.join(__dirname, "../i18n/de/whiteboard.js"), "utf8");
  const keys = C.SYM_IDS.map((id) => "sym." + id).concat(C.SYM_GROUPS.map((g) => "lib.g." + g),
    ["m.lib", "lib.title", "lib.search", "lib.none", "lib.how", "lib.howChange", "lib.added", "ctx.lib", "lib.classTx", "lib.ifaceTx"]);
  keys.forEach((k) => {
    assert.equal((app.match(new RegExp('"' + k.replace(/[.]/g, "\\.") + '":', "g")) || []).length, 2, "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  });
  ["en", "el"].forEach((l) => {
    const h = fs.readFileSync(path.join(__dirname, "../whiteboard/help." + l + ".txt"), "utf8");
    assert.match(h, l === "en" ? /Diagram shapes/ : /Σχήματα διαγραμμάτων/, "help " + l);
  });
});
