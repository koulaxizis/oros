// Whiteboard wave DG2: diagram connectors (whiteboard/core.js route,
// routeD, labelAt, portAt, headsOf, hdFor) — elbow and curved lines,
// sides to stick to, UML heads — and the Assistant's connect / style.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../whiteboard/core.js");
const OLD = require("./fixtures/whiteboard-core-6.29.js");
const CMD = require("../whiteboard/commands.js");

const shape = (id, x, y, extra) => Object.assign({ id, b: "b1", k: "shape", shp: "rect", f: "soft", c: "blue", x, y, w: 100, h: 60, tx: id, z: 1 }, extra || {});
const arrow = (id, ao, bo, extra) => Object.assign({ id, b: "b1", k: "arrow", c: "ink", z: 2, ax: 0, ay: 0, bx: 0, by: 0, ao, bo, hd: "end", ds: false, tx: "" }, extra || {});
const board = (rows, at) => C.apply(C.putBoard(C.empty(), "b1", "Flow", 100), rows, at || 200);
const byId = (d) => C.index(d.objs);

// every segment is horizontal or vertical
const rightAngles = (pts) => pts.slice(1).every((p, i) => p.x === pts[i].x || p.y === pts[i].y);
// a segment crosses the inside of a box
const crosses = (pts, b) => pts.slice(1).some((p, i) => {
  const q = pts[i];
  if (q.y === p.y) return q.y > b.y && q.y < b.y + b.h && Math.max(q.x, p.x) > b.x && Math.min(q.x, p.x) < b.x + b.w;
  return q.x > b.x && q.x < b.x + b.w && Math.max(q.y, p.y) > b.y && Math.min(q.y, p.y) < b.y + b.h;
});

test("route, sides and heads are kept, written only when set, bad values dropped", () => {
  const d = board({
    a: shape("a", 0, 0), b: shape("b", 400, 0),
    x1: arrow("x1", "a", "b", { rt: "elbow", ap: "r", bp: "l", ha: "dia", hb: "tri" }),
    x2: arrow("x2", "a", "b"),
    x3: arrow("x3", "a", "b", { rt: "zigzag", ap: "middle", ha: "<b>" }),
  });
  const m = byId(d);
  assert.deepEqual([m.x1.rt, m.x1.ap, m.x1.bp, m.x1.ha, m.x1.hb], ["elbow", "r", "l", "dia", "tri"]);
  ["rt", "ap", "bp", "ha", "hb"].forEach((k) => assert.equal(k in m.x2, false, "plain arrow has no " + k));
  // a bad value is not carried as an unknown field either
  ["rt", "ap", "ha"].forEach((k) => assert.equal(k in m.x3, false, "bad " + k));
});

test("a straight line is drawn as before; an elbow goes in right angles around the shape in between", () => {
  const rows = { a: shape("a", 0, 0), b: shape("b", 400, 0), mid: shape("mid", 180, -20, { h: 100 }) };
  rows.s = arrow("s", "a", "b");
  rows.e = arrow("e", "a", "b", { rt: "elbow" });
  const d = board(rows), m = byId(d);
  const old = OLD.ends(m.s, m), now = C.ends(m.s, m);
  assert.deepEqual(now, old, "straight ends unchanged from the older core");
  assert.equal(C.route(m.s, m).pts.length, 2);
  const r = C.route(m.e, m);
  assert.ok(rightAngles(r.pts), "right angles only: " + JSON.stringify(r.pts));
  assert.equal(crosses(r.pts, m.mid), false, "goes around the shape in between");
  assert.equal(crosses(r.pts, m.a), false);
  assert.equal(crosses(r.pts, m.b), false);
  assert.match(C.routeD(r), /^M[-\d. ]+(L[-\d. ]+)+$/);
  // deterministic: same answer twice
  assert.deepEqual(C.route(m.e, m), r);
});

test("sides: the line leaves and arrives where it is told, portAt finds a side from a drop point", () => {
  const d = board({ a: shape("a", 0, 0), b: shape("b", 300, 200), e: arrow("e", "a", "b", { rt: "elbow", ap: "b", bp: "t" }) });
  const m = byId(d), p = C.route(m.e, m).pts, s = p[0], e = p[p.length - 1];
  assert.equal(s.x, 50); assert.ok(s.y > 60, "leaves from the bottom");
  assert.equal(e.x, 350); assert.ok(e.y < 200, "arrives at the top");
  assert.equal(p[1].x, s.x, "first part goes straight down");
  assert.equal(p[p.length - 2].x, e.x, "last part comes straight down");
  const o = m.a;
  assert.equal(C.portAt(o, { x: 50, y: 2 }), "t");
  assert.equal(C.portAt(o, { x: 98, y: 30 }), "r");
  assert.equal(C.portAt(o, { x: 50, y: 59 }), "b");
  assert.equal(C.portAt(o, { x: 1, y: 30 }), "l");
  assert.equal(C.portAt(o, { x: 50, y: 30 }), "", "the middle is auto");
});

test("a curve is one cubic, its label sits on the line; free ends work too", () => {
  const d = board({ a: shape("a", 0, 0), b: shape("b", 400, 100), c: arrow("c", "a", "b", { rt: "curve" }), f: arrow("f", "", "", { rt: "elbow", ax: 0, ay: 300, bx: 200, by: 400 }) });
  const m = byId(d), r = C.route(m.c, m);
  assert.equal(r.pts.length, 2); assert.equal(r.c.length, 2);
  assert.match(C.routeD(r), /^M[-\d. ]+C[-\d. ]+$/);
  const mid = C.labelAt(m.c, m);
  assert.ok(mid.x > 100 && mid.x < 400 && mid.y > 0 && mid.y < 160, "label near the middle: " + JSON.stringify(mid));
  const fr = C.route(m.f, m).pts;
  assert.deepEqual(fr[0], { x: 0, y: 300 }); assert.deepEqual(fr[fr.length - 1], { x: 200, y: 400 });
  assert.ok(rightAngles(fr));
  // the box of a curve covers its bulge
  const bx = C.box(m.c, m);
  assert.ok(bx.w > 0 && bx.h > 0);
});

test("heads: older rows read from hd, hdFor keeps hd in step, the SVG draws UML heads", () => {
  assert.deepEqual(C.headsOf({ hd: "end" }), { a: "none", b: "arrow" });
  assert.deepEqual(C.headsOf({ hd: "both" }), { a: "arrow", b: "arrow" });
  assert.deepEqual(C.headsOf({ hd: "none" }), { a: "none", b: "none" });
  assert.deepEqual(C.headsOf({ hd: "end", ha: "dia", hb: "tri" }), { a: "dia", b: "tri" });
  assert.equal(C.hdFor("none", "tri"), "end");
  assert.equal(C.hdFor("dia", "none"), "both");
  assert.equal(C.hdFor("none", "none"), "none");
  const d = board({ a: shape("a", 0, 0), b: shape("b", 400, 0), x: arrow("x", "a", "b", { rt: "elbow", ha: "odia", hb: "tri", hd: "both", tx: "has <many>" }) });
  const svg = C.toSvg(C.scene(d.objs, {}), C.bounds(d.objs), {});
  assert.ok(svg.includes("has &lt;many&gt;") && !svg.includes("<many>"), "label escaped");
  const heads = svg.match(/<path d="M[^"]*Z" fill="#fbfaf7"/g) || [];
  assert.equal(heads.length, 2, "hollow triangle and hollow diamond are paper-filled");
  assert.ok(heads.some((h) => (h.match(/L/g) || []).length === 3), "a diamond has four corners");
});

test("an older device keeps the arrow and its ends; the newer device keeps the route (equal stamps)", () => {
  const rows = { a: shape("a", 0, 0), b: shape("b", 400, 0), x: arrow("x", "a", "b", { rt: "elbow", ap: "r", bp: "l", ha: "none", hb: "tri", hd: "end" }) };
  const newer = board(rows, 300);
  const older = OLD.merge(OLD.empty(), JSON.parse(JSON.stringify(newer)));
  const ox = older.objs.find((o) => o.id === "x");
  assert.equal(ox.ao, "a"); assert.equal(ox.bo, "b"); assert.equal(ox.hd, "end", "older device still draws an end head");
  const back = C.merge(newer, JSON.parse(JSON.stringify(older)));
  const bx = back.objs.find((o) => o.id === "x");
  assert.deepEqual([bx.rt, bx.ap, bx.bp, bx.hb], ["elbow", "r", "l", "tri"]);
  assert.deepEqual(C.merge(older, newer), back, "the merge is the same both ways");
});

test("many elbow lines stay quick (memo), and stay right-angled", () => {
  const rows = {};
  for (let i = 0; i < 120; i++) rows["s" + i] = shape("s" + i, (i % 12) * 160, Math.floor(i / 12) * 120);
  for (let i = 0; i < 119; i++) rows["e" + i] = arrow("e" + i, "s" + i, "s" + ((i * 7 + 13) % 120), { rt: "elbow" });
  const d = board(rows), m = byId(d);
  const t0 = Date.now();
  d.objs.filter((o) => o.k === "arrow").forEach((a) => assert.ok(rightAngles(C.route(a, m).pts), a.id));
  const first = Date.now() - t0, t1 = Date.now();
  d.objs.filter((o) => o.k === "arrow").forEach((a) => C.route(a, m));
  assert.ok(first < 4000, "first pass " + first + " ms");
  assert.ok(Date.now() - t1 < 200, "memo pass");
});

test("Assistant: connect and style take route and heads, ends resets them, the outline reports them", () => {
  assert.ok(CMD.CATALOG.connect.args.route.v.includes("elbow"));
  assert.ok(CMD.CATALOG.style.args.endhead.v.includes("tri"));
  const w = CMD.work(board({ a: shape("a", 0, 0), b: shape("b", 400, 0) }), "b1");
  let ids = 0;
  CMD.apply(w, { op: "connect", from: "a", to: "b", route: "elbow", starthead: "dia", endhead: "none" }, { now: 400, newId: () => "n" + ids++ });
  let x = C.objsOf(w.data, "b1").find((o) => o.id === "n0");
  assert.deepEqual([x.rt, x.ha, x.hb, x.hd], ["elbow", "dia", "none", "both"]);
  CMD.apply(w, { op: "style", ids: "n0", endhead: "tri", route: "curve" }, { now: 500 });
  x = C.objsOf(w.data, "b1").find((o) => o.id === "n0");
  assert.deepEqual([x.rt, x.ha, x.hb], ["curve", "dia", "tri"]);
  let out = CMD.outline(CMD.view(w.data).docs[0]).objects.find((o) => o.id === "n0");
  assert.deepEqual([out.route, out.starthead, out.endhead], ["curve", "dia", "tri"]);
  CMD.apply(w, { op: "style", ids: "n0", ends: "end", route: "line" }, { now: 600 });
  x = C.objsOf(w.data, "b1").find((o) => o.id === "n0");
  ["rt", "ap", "bp", "ha", "hb"].forEach((k) => assert.equal(k in x, false, k + " taken off"));
  assert.equal(x.hd, "end");
  assert.match(CMD.check([{ op: "style", ids: "n0", route: "zigzag" }]).err || "", /route/);
});

test("the app names every route and head in EN, EL and DE, and the help speaks of them", () => {
  const app = fs.readFileSync(path.join(__dirname, "../whiteboard/app.js"), "utf8");
  const de = fs.readFileSync(path.join(__dirname, "../i18n/de/whiteboard.js"), "utf8");
  const keys = C.ROUTES.map((r) => "rt." + r).concat(C.HEAD_STYLES.map((h) => "hs." + h), ["ctx.route", "ctx.headA", "ctx.headB"]);
  keys.forEach((k) => {
    assert.equal((app.match(new RegExp('"' + k.replace(/[.]/g, "\\.") + '":', "g")) || []).length, 2, "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  });
  ["en", "el"].forEach((l) => {
    const h = fs.readFileSync(path.join(__dirname, "../whiteboard/help." + l + ".txt"), "utf8");
    assert.match(h, l === "en" ? /Elbow/ : /Ορθογώνια/, "help " + l);
  });
});
