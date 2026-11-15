// Whiteboard wave DG3: auto layout (tree / flow) and align / spread
// (whiteboard/core.js layout, align) and the Assistant's layout and
// align commands.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../whiteboard/core.js");
const CMD = require("../whiteboard/commands.js");

const shape = (id, x, y, w, h) => ({ id, b: "b1", k: "shape", shp: "rect", f: "soft", c: "blue", x, y, w: w || 100, h: h || 60, tx: id, z: 1 });
const arrow = (id, ao, bo, extra) => Object.assign({ id, b: "b1", k: "arrow", c: "ink", z: 2, ax: 0, ay: 0, bx: 0, by: 0, ao, bo, hd: "end", ds: false, tx: "" }, extra || {});
const after = (list, out) => C.index(list.map((o) => out[o.id] || o));
const cx = (o) => o.x + o.w / 2, cy = (o) => o.y + o.h / 2;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function noOverlaps(m, ids) {
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.equal(overlap(m[ids[i]], m[ids[j]]), false, ids[i] + " / " + ids[j]);
}

// an org chart drawn anyhow
const org = () => [shape("ceo", 500, 500), shape("cto", 10, 10), shape("cfo", 900, 40, 140), shape("dev", 300, 800), shape("ops", 50, 300),
  arrow("1", "ceo", "cto"), arrow("2", "ceo", "cfo"), arrow("3", "cto", "dev"), arrow("4", "cto", "ops")];

test("tree, top to bottom: parents centred over their children, one row per level, no overlaps, top-left kept", () => {
  const L = org(), out = C.layout(L, null, { kind: "tree", dir: "v" }), m = after(L, out);
  assert.equal(m.cto.y, m.cfo.y); assert.equal(m.ops.y, m.dev.y);
  assert.ok(m.ceo.y < m.cto.y && m.cto.y < m.dev.y);
  assert.equal(cx(m.ceo), (cx(m.cto) + cx(m.cfo)) / 2, "ceo over the middle of its first and last report");
  assert.ok(Math.abs(cx(m.cto) - (cx(m.ops) + cx(m.dev)) / 2) < 0.01, "cto over its team");
  assert.ok(m.ops.x < m.dev.x, "children keep their left-to-right order (ops was left of dev)");
  noOverlaps(m, ["ceo", "cto", "cfo", "dev", "ops"]);
  const minX = Math.min(...["ceo", "cto", "cfo", "dev", "ops"].map((id) => m[id].x)), minY = Math.min(...["ceo", "cto", "cfo", "dev", "ops"].map((id) => m[id].y));
  assert.deepEqual([minX, minY], [10, 10]);
  // arrows that follow have their kept ends brought up to date
  const e = C.ends(m["1"], m);
  assert.deepEqual([m["1"].ax, m["1"].ay, m["1"].bx, m["1"].by], [e.a.x, e.a.y, e.b.x, e.b.y].map((v) => Math.round(v * 100) / 100));
  // laid out twice: nothing more moves
  assert.deepEqual(C.layout(L.map((o) => out[o.id] || o), null, { kind: "tree", dir: "v" }), {});
});

test("left to right swaps the axes; auto picks a tree when each has one arrow in", () => {
  const L = org(), m = after(L, C.layout(L, null, { dir: "h" }));
  assert.equal(cx(m.cto), cx(m.cfo), "one column per level, centred in it");
  assert.ok(m.ceo.x < m.cto.x && m.cto.x < m.dev.x);
  assert.ok(Math.abs(cy(m.cto) - (cy(m.ops) + cy(m.dev)) / 2) < 0.01);
});

test("flow: layers by the longest way in, a loop back does not break it, fewer crossings", () => {
  const L = [shape("s", 0, 0), shape("a", 300, 100), shape("b", 0, 100), shape("j", 100, 300), shape("e", 0, 500),
    arrow("1", "s", "a"), arrow("2", "s", "b"), arrow("3", "a", "j"), arrow("4", "b", "j"), arrow("5", "j", "e"), arrow("6", "e", "s"), arrow("7", "s", "j")];
  const m = after(L, C.layout(L, null, {}));
  assert.ok(m.s.y < m.a.y && m.a.y === m.b.y && m.b.y < m.j.y && m.j.y < m.e.y, "s → a|b → j → e (s → j skips a layer)");
  assert.ok(m.b.x < m.a.x, "b was left of a");
  noOverlaps(m, ["s", "a", "b", "j", "e"]);
  // a pair joined both ways (a loop back): the first drawn arrow leads, whatever the ids
  const P = [shape("q", 0, 0), shape("p", 0, 200), Object.assign(arrow("z9", "q", "p"), { z: 1 }), Object.assign(arrow("a1", "p", "q"), { z: 2 })];
  const mp = after(P, C.layout(P, null, { kind: "flow" }));
  assert.ok(mp.q.y < mp.p.y, "q → p comes first");
  assert.deepEqual([C.layout(P.map((o) => o.k === "arrow" ? Object.assign({}, o, { rt: "elbow" }) : o), null, { kind: "flow" }).a1.ap], ["r"], "the loop back leaves from the side");
  // crossings: two parents in the wrong order get swapped
  const X = [shape("p", 0, 0), shape("q", 200, 0), shape("x", 0, 200), shape("y", 200, 200), arrow("1", "p", "y"), arrow("2", "q", "x"), arrow("3", "p", "x"), arrow("4", "q", "x")];
  const mx = after(X, C.layout(X, null, { kind: "flow" }));
  assert.ok(mx.p.x < mx.q.x);
  noOverlaps(mx, ["p", "q", "x", "y"]);
});

test("layout leaves frames, pictures, drawings and objects outside the pick alone; elbow lines face the next layer", () => {
  const L = org().concat([
    { id: "fr", b: "b1", k: "frame", x: -100, y: -100, w: 2000, h: 2000, tx: "Org", z: 0 },
    { id: "img", b: "b1", k: "image", x: 700, y: 700, w: 100, h: 100, src: "data:image/png;base64,AAAA", z: 3 },
    arrow("5", "cfo", "img"),
  ]);
  L[5] = arrow("1", "ceo", "cto", { rt: "elbow" });
  const out = C.layout(L, null, { kind: "tree" });
  assert.equal("fr" in out, false); assert.equal("img" in out, false);
  assert.deepEqual([out["1"].ap, out["1"].bp], ["b", "t"]);
  const some = C.layout(L, ["cto", "dev", "ops"], { kind: "tree" });
  assert.equal("ceo" in some, false); assert.equal("cfo" in some, false);
  assert.deepEqual(C.layout(L, ["ceo"], {}), {}, "one object: nothing to lay out");
});

test("align and spread: edges and centres line up, gaps come out equal, first and last stay", () => {
  const L = [shape("a", 0, 0, 100, 40), shape("b", 37, 120, 60, 80), shape("c", 400, 50, 120, 30), arrow("x", "a", "c")];
  let m = after(L, C.align(L, ["a", "b", "c"], "l"));
  assert.deepEqual([m.a.x, m.b.x, m.c.x], [0, 0, 0]);
  m = after(L, C.align(L, ["a", "b", "c"], "r"));
  assert.deepEqual([m.a.x + m.a.w, m.b.x + m.b.w, m.c.x + m.c.w], [520, 520, 520]);
  m = after(L, C.align(L, ["a", "b", "c"], "m"));
  assert.deepEqual([cy(m.a), cy(m.b), cy(m.c)], [100, 100, 100]);
  m = after(L, C.align(L, ["a", "b", "c"], "c"));
  assert.deepEqual([cx(m.a), cx(m.b), cx(m.c)], [260, 260, 260]);
  assert.ok("x" in C.align(L, ["a", "c"], "t"), "the arrow follows");
  m = after(L, C.align(L, ["a", "b", "c"], "", "h"));
  assert.equal(m.a.x, 0); assert.equal(m.c.x, 400);
  assert.equal(m.b.x - (m.a.x + m.a.w), m.c.x - (m.b.x + m.b.w));
  assert.deepEqual(C.align(L, ["a", "c"], "", "h"), {}, "spreading needs three");
  assert.deepEqual(C.align(L, ["a", "b"], "zz"), {});
});

test("Assistant: layout and align, default all objects, bad values refused, one card", () => {
  ["layout", "align"].forEach((op) => assert.match(CMD.GUIDE, new RegExp("^" + op + ": ", "m")));
  assert.match(CMD.check([{ op: "align" }]).err, /give edge or dist/);
  assert.match(CMD.check([{ op: "align", edge: "l" }]).err, /pick the objects/);
  assert.match(CMD.check([{ op: "layout", kind: "spiral" }]).err, /kind/);
  const d = C.apply(C.putBoard(C.empty(), "b1", "Org", 100), C.index(org()), 200);
  const w = CMD.work(d, "b1");
  assert.ok(CMD.check([{ op: "layout", kind: "tree" }]).ok);
  CMD.apply(w, { op: "layout", kind: "tree", dir: "v" }, { now: 300 });
  const m = C.index(C.objsOf(w.data, "b1"));
  assert.equal(m.cto.y, m.cfo.y);
  CMD.apply(w, { op: "align", ids: "cto,cfo,dev", edge: "l" }, { now: 400 });
  const m2 = C.index(C.objsOf(w.data, "b1"));
  assert.equal(m2.cto.x, m2.cfo.x); assert.equal(m2.cfo.x, m2.dev.x);
});

test("the app names every layout, edge and spread in EN, EL and DE; the Assistant card names them; help speaks of them", () => {
  const app = fs.readFileSync(path.join(__dirname, "../whiteboard/app.js"), "utf8");
  const de = fs.readFileSync(path.join(__dirname, "../i18n/de/whiteboard.js"), "utf8");
  const keys = ["m.lay", "ctx.lay", "ctx.align", "lay.tree.v", "lay.tree.h", "lay.flow.v", "lay.flow.h", "lay.same"]
    .concat(C.ALIGN_EDGES.map((e) => "al." + e), C.SPREAD_DIRS.map((d) => "sp." + d));
  keys.forEach((k) => {
    assert.equal((app.match(new RegExp('"' + k.replace(/[.]/g, "\\.") + '":', "g")) || []).length, 2, "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  });
  const as = fs.readFileSync(path.join(__dirname, "../assistant/assistant.js"), "utf8");
  const deAs = fs.readFileSync(path.join(__dirname, "../i18n/de/assistant.js"), "utf8");
  ["ed.op.layout.whiteboard", "ed.op.align.whiteboard", "ed.f.kind.whiteboard", "ed.v.kind.tree.whiteboard", "ed.v.kind.flow.whiteboard", "ed.f.dir.whiteboard"].forEach((k) => {
    assert.equal((as.match(new RegExp('"' + k.replace(/[.]/g, "\\.") + '":', "g")) || []).length, 2, "EN + EL " + k);
    assert.ok(deAs.includes('"' + k + '":'), "DE " + k);
  });
  ["en", "el"].forEach((l) => {
    const h = fs.readFileSync(path.join(__dirname, "../whiteboard/help." + l + ".txt"), "utf8");
    assert.match(h, l === "en" ? /## Lay out and align/ : /## Τακτοποίηση και στοίχιση/, "help " + l);
  });
});
