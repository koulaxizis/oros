// Mind Map wave 27 (mindmap/mm-core.js): node styles, boundaries /
// summaries ("frames"), the layout kinds (org chart, tree, timeline),
// keyboard targets per layout and the presentation steps.
// New data lives in new collections (styles, frames, layouts), so an
// older device that drops them loses nothing on newer ones.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const M = require(path.join(__dirname, "..", "mindmap/mm-core.js"));

const MAP = "map1";
const R = M.rootId(MAP);
function mp(id, m, sides) { return { id: id || MAP, m: m || 1, sides: sides || "both" }; }
function nd(id, parent, ord, extra) {
  return Object.assign({ id, m: 1, map: MAP, parent: parent === undefined ? R : parent, ord: ord || "V", text: id }, extra || {});
}
function sy(id, extra, m) { return Object.assign({ id, m: m || 1, map: MAP, shape: "", fill: "", border: "", size: "", bold: false }, extra || {}); }
function fr(id, nodes, extra, m) { return Object.assign({ id, m: m || 1, map: MAP, nodes, kind: "box", label: "", color: "" }, extra || {}); }
function ly(kind, m) { return { id: MAP, m: m || 1, map: MAP, kind }; }
function rnd(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function overlaps(lay) {
  const ids = lay.order, bad = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = lay.nodes[ids[i]], b = lay.nodes[ids[j]];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad.push([ids[i], ids[j]]);
  }
  return bad;
}
function inside(box, c) { return c.x >= box.x - 0.5 && c.y >= box.y - 0.5 && c.x + c.w <= box.x + box.w + 0.5 && c.y + c.h <= box.y + box.h + 0.5; }
function hits(box, c) { return c.x < box.x + box.w && box.x < c.x + c.w && c.y < box.y + box.h && box.y < c.y + c.h; }

// ---------- normalizers ----------
test("wave 27 normalizers: styles, frames and layouts are allow-listed", () => {
  assert.deepEqual(M.normStyle(sy("a", { shape: "pill", fill: "tint", border: "thick", size: "l", bold: true, evil: 1 })),
    { id: "a", m: 1, map: MAP, shape: "pill", fill: "tint", border: "thick", size: "l", bold: true });
  assert.deepEqual(M.normStyle(sy("a", { shape: "<svg>", fill: "url(x)", border: 3, size: "xl", bold: "yes" })),
    { id: "a", m: 1, map: MAP, shape: "", fill: "", border: "", size: "", bold: false });
  assert.equal(M.normStyle(sy("a", { map: "bad map" })), null);
  assert.ok(M.plainStyle(M.normStyle(sy("a"))));
  assert.ok(!M.plainStyle(M.normStyle(sy("a", { bold: true }))));

  const f = M.normFrame(fr("f1", ["b", "a", "a", R, "<x>", 5], { kind: "brace", label: "x\n‮y", color: "teal", extra: 1 }));
  assert.deepEqual(f, { id: "f1", m: 1, map: MAP, nodes: ["a", "b"], kind: "brace", label: "x y", color: "teal" });
  assert.equal(M.normFrame(fr("f1", [R])), null, "the centre is never framed; no members, no frame");
  assert.equal(M.normFrame(fr("f1", "a")), null);
  assert.equal(M.normFrame(fr("f1", ["a"], { kind: "circle", color: "#f00" })).kind, "box");
  assert.equal(M.normFrame(fr("f1", ["a"], { color: "#f00" })).color, "");
  assert.equal(M.normFrame(fr("f1", Array.from({ length: 80 }, (_, i) => "n" + i))).nodes.length, M.FRAME_NODES);
  assert.equal(M.normFrame(fr("f1", ["a"], { label: "z".repeat(900) })).label.length, M.LABEL_LEN);

  assert.deepEqual(M.normLayout(ly("org")), { id: MAP, m: 1, map: MAP, kind: "org" });
  assert.equal(M.normLayout(ly("spiral")).kind, "");
  assert.equal(M.normLayout({ id: MAP, m: 1, map: "other", kind: "org" }), null, "a layout row belongs to its own map");
});

// ---------- merge ----------
function base(extra) {
  return Object.assign({ maps: [mp()], nodes: [nd(R, "", ""), nd("a", R, "A"), nd("b", R, "B"), nd("c", "a", "V")], tombs: {} }, extra || {});
}
test("wave 27 merge: union, LWW, a node's style and a map's layout leave with them", () => {
  const A = base({ styles: [sy("a", { shape: "pill" })], frames: [fr("f1", ["a", "b"])], layouts: [ly("org")] });
  const B = base({ styles: [sy("a", { shape: "hex" }, 2), sy("b", { bold: true })], layouts: [ly("tree", 2)] });
  const m = M.merge(A, B);
  assert.deepEqual(m, M.merge(B, A), "symmetric");
  assert.deepEqual(M.merge(m, m), m, "idempotent");
  assert.equal(m.styles.find((x) => x.id === "a").shape, "hex", "newer wins");
  assert.equal(m.styles.length, 2);
  assert.equal(m.frames.length, 1);
  assert.equal(m.layouts[0].kind, "tree");
  // a reset (all defaults, newer) wins over the older style elsewhere
  const reset = M.merge(m, { styles: [sy("a", {}, 5)] });
  assert.ok(M.plainStyle(reset.styles.find((x) => x.id === "a")));
  // deleting node a drops its style; the frame row stays (the app
  // tombstones it with its last member) and draws only what lives
  const del = M.merge(m, { tombs: { a: 10, c: 10 } });
  assert.ok(!del.styles.some((x) => x.id === "a"));
  assert.deepEqual(M.layout(M.resolve(del, MAP), {}).frames[0].nodes, ["b"]);
  const none = M.merge(del, { tombs: { b: 10 } });
  assert.equal(none.frames.length, 1);
  assert.equal(M.layout(M.resolve(none, MAP), {}).frames.length, 0, "no living member, nothing drawn");
  // a deleted frame stays deleted; a newer edit brings it back
  assert.equal(M.merge(m, { tombs: { f1: 3 } }).frames.length, 0);
  assert.equal(M.merge(m, { tombs: { f1: 3 }, frames: [fr("f1", ["a"], { label: "x" }, 4)] }).frames.length, 1);
  // deleting the map takes its layout row along
  const gone = M.merge(m, { tombs: { [MAP]: 10 } });
  assert.equal(gone.layouts.length, 0);
  assert.equal(gone.styles.length, 0);
  assert.equal(gone.frames.length, 0);
});

test("wave 27 merge: an older device that drops the new collections loses nothing", () => {
  const mine = M.merge(base({ styles: [sy("a", { shape: "ellipse" })], frames: [fr("f1", ["a"], { label: "L" })], layouts: [ly("time")] }), {});
  const old = { ver: 1, maps: mine.maps, nodes: mine.nodes, links: [], pos: [], imgs: [], tombs: mine.tombs };
  assert.deepEqual(M.merge(mine, old), mine);
  assert.deepEqual(M.merge(old, mine), mine);
  // and data from before wave 27 loads with empty new collections
  const pre = M.merge({ maps: [mp()], nodes: [nd(R, "", "")], tombs: {} }, {});
  assert.deepEqual([pre.styles, pre.frames, pre.layouts], [[], [], []]);
});

test("wave 27 merge fuzz: symmetric, idempotent, canonical", () => {
  const r = rnd(27);
  const pick = (a) => a[Math.floor(r() * a.length)];
  for (let round = 0; round < 60; round++) {
    const side = () => base({
      styles: Array.from({ length: 4 }, () => sy(pick(["a", "b", "c"]), { shape: pick(M.SHAPES), fill: pick(M.FILLS), bold: r() < 0.5 }, 1 + Math.floor(r() * 5))),
      frames: Array.from({ length: 3 }, () => fr(pick(["f1", "f2"]), [pick(["a", "b", "c"]), pick(["a", "b"])], { kind: pick(M.FRAME_KINDS), label: pick(["", "x", "y"]) }, 1 + Math.floor(r() * 5))),
      layouts: [ly(pick(M.LAYOUTS), 1 + Math.floor(r() * 5))],
      tombs: r() < 0.3 ? { [pick(["a", "b", "f1"])]: 1 + Math.floor(r() * 6) } : {}
    });
    const A = side(), B = side(), C = side();
    const ab = M.merge(A, B);
    assert.deepEqual(ab, M.merge(B, A));
    assert.deepEqual(M.merge(ab, ab), ab);
    assert.deepEqual(M.merge(M.merge(ab, C), {}), M.merge(A, M.merge(B, C)));
    assert.equal(JSON.stringify(M.merge(ab, {})), JSON.stringify(ab));
  }
});

// ---------- layouts ----------
function randomMap(r, n) {
  const ids = Array.from({ length: n }, (_, i) => "k" + i);
  const nodes = ids.map((id, i) => nd(id, i < 3 || r() < 0.3 ? R : ids[Math.floor(r() * i)], M.spread(5)[Math.floor(r() * 5)],
    { text: "word ".repeat(1 + Math.floor(r() * 20)).trim(), emoji: r() < 0.2 ? "🎯" : "", note: r() < 0.2 ? "n" : "" }));
  return { ids, nodes };
}
test("wave 27 layouts: org chart, tree and timeline never overlap, with shapes, sizes and frames", () => {
  const r = rnd(42);
  for (let round = 0; round < 150; round++) {
    const kind = M.LAYOUTS[round % 4];
    const { ids, nodes } = randomMap(r, 4 + Math.floor(r() * 50));
    const styles = ids.filter(() => r() < 0.4).map((id) => sy(id, { shape: M.SHAPES[Math.floor(r() * M.SHAPES.length)],
      size: M.SIZES[Math.floor(r() * 3)], bold: r() < 0.3, fill: M.FILLS[Math.floor(r() * 4)] }));
    const frames = ids.filter(() => r() < 0.15).map((id, i) => fr("f" + i, [id], { kind: r() < 0.5 ? "box" : "brace", label: r() < 0.5 ? "Group" : "" }));
    const d = M.merge({ maps: [mp(MAP, 1, round % 3 ? "both" : "right")], nodes: [nd(R, "", "", { text: "Centre", }), ...nodes],
                        styles, frames, layouts: [ly(kind)], tombs: {} }, {});
    const res = M.resolve(d, MAP);
    const fold = {};
    if (round % 5 === 0) ids.slice(0, 2).forEach((id) => { fold[id] = 1; });
    const lay = M.layout(res, { fold });
    assert.equal(lay.kind, kind);
    assert.deepEqual(overlaps(lay), [], kind + " round " + round);
    lay.order.forEach((id) => {
      const c = lay.nodes[id];
      assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= lay.w && c.y + c.h <= lay.h, "inside the drawing");
      if (kind === "org" && c.depth > 0) assert.ok(c.y >= lay.nodes[res.par[id]].y + lay.nodes[res.par[id]].h, "org: below the parent");
      if (kind === "tree" && c.depth > 0) assert.ok(c.x > lay.nodes[res.par[id]].x, "tree: indented");
      if (kind === "time" && c.depth === 1) assert.ok(Math.abs(c.cy - lay.nodes[R].cy) < 1, "time: on the line");
    });
    // every frame holds its members and all that is shown under them
    lay.frames.forEach((f) => {
      const box = f.kind === "brace" ? { x: f.x, y: f.y, w: f.w, h: f.h } : f;
      f.nodes.forEach((m) => M.subtree(res, m).forEach((x) => { if (lay.nodes[x]) assert.ok(inside(box, lay.nodes[x]), "frame holds " + x); }));
      assert.ok(f.lx >= 0 && f.ly >= 0 && f.lx + f.lw <= lay.w && f.ly + f.lh <= lay.h, "label inside the drawing");
    });
  }
});

test("wave 27 boundaries: a box around one branch keeps every other node out", () => {
  const r = rnd(5);
  for (let round = 0; round < 120; round++) {
    const kind = M.LAYOUTS[round % 4];
    const { ids, nodes } = randomMap(r, 6 + Math.floor(r() * 40));
    const pickId = ids[Math.floor(r() * ids.length)];
    const d = M.merge({ maps: [mp()], nodes: [nd(R, "", "", { text: "Centre" }), ...nodes],
                        frames: [fr("f1", [pickId], { label: r() < 0.5 ? "A label" : "" })], layouts: [ly(kind)], tombs: {} }, {});
    const res = M.resolve(d, MAP), lay = M.layout(res, {});
    const f = lay.frames[0], mine = new Set(M.subtree(res, pickId));
    assert.ok(f);
    lay.order.forEach((id) => {
      if (mine.has(id)) return;
      assert.ok(!hits(f, lay.nodes[id]), kind + ": " + id + " is outside the frame of " + pickId + " (round " + round + ")");
    });
  }
});

test("wave 27 boundaries: members on both sides of the centre are drawn in parts, never over the centre", () => {
  const nodes = [nd(R, "", ""), nd("a", R, "A"), nd("b", R, "B"), nd("c", R, "C"), nd("d", R, "D"), nd("a1", "a", "A")];
  const d = M.merge({ maps: [mp()], nodes, frames: [fr("f1", ["a", "d", "a1"], { label: "Both" })], tombs: {} }, {});
  const res = M.resolve(d, MAP), lay = M.layout(res, {});
  const parts = lay.frames.filter((f) => f.id === "f1");
  assert.equal(parts.length, 2, "a and d on two sides; a1 is inside a already");
  assert.equal(parts.filter((p) => p.label).length, 1, "one label");
  parts.forEach((p) => assert.ok(!hits(p, lay.nodes[R]), "the centre stays outside"));
});

test("wave 27 shapes: room for the text inside, sizes scale, folded org badge below", () => {
  const d = M.merge(base({ styles: [sy("a", { shape: "diamond" }), sy("b", { size: "l", bold: true }), sy("c", { size: "s" })] }), {});
  const res = M.resolve(d, MAP), lay = M.layout(res, {});
  const a = lay.nodes.a, b = lay.nodes.b, c = lay.nodes.c;
  assert.ok(a.ex > 0 && a.ey > 0, "a diamond leaves room on all sides");
  assert.ok(b.sty.font > M.layout(M.resolve(M.merge(base(), {}), MAP), {}).nodes.b.sty.font);
  assert.equal(b.sty.weight, 800);
  assert.ok(c.sty.font < 14);
  const org = M.layout(M.resolve(M.merge(base({ layouts: [ly("org")] }), {}), MAP), { fold: { a: 1 } });
  assert.equal(org.nodes.a.flow, "d");
  assert.ok(org.nodes.a.folded);
  const svg = M.toSvg(M.scene(M.resolve(M.merge(base({ layouts: [ly("org")] }), {}), MAP), org, {}), {});
  assert.ok(/<circle cx="[\d.]+" cy="[\d.]+"/.test(svg));
});

// ---------- keyboard ----------
test("wave 27 navTarget: arrows follow each layout", () => {
  const nodes = [nd(R, "", ""), nd("a", R, "A"), nd("b", R, "B"), nd("a1", "a", "A"), nd("a2", "a", "B"), nd("b1", "b", "A")];
  function lay(kind, fold) {
    const res = M.resolve(M.merge({ maps: [mp(MAP, 1, "right")], nodes, layouts: [ly(kind)], tombs: {} }, {}), MAP);
    return [res, M.layout(res, { fold: fold || {} })];
  }
  let [res, L] = lay("org");
  assert.deepEqual(M.navTarget(res, L, R, "down"), { id: "a" });
  assert.deepEqual(M.navTarget(res, L, "a", "right"), { id: "b" });
  assert.deepEqual(M.navTarget(res, L, "a2", "left"), { id: "a1" });
  assert.deepEqual(M.navTarget(res, L, "a1", "up"), { id: "a" });
  assert.equal(M.navTarget(res, L, "b", "right"), null);
  [res, L] = lay("tree");
  assert.deepEqual(M.navTarget(res, L, R, "down"), { id: "a" });
  assert.deepEqual(M.navTarget(res, L, "a2", "down"), { id: "b" }, "next row");
  assert.deepEqual(M.navTarget(res, L, "b", "up"), { id: "a2" });
  assert.deepEqual(M.navTarget(res, L, "a", "right"), { id: "a1" });
  assert.deepEqual(M.navTarget(res, L, "a1", "left"), { id: "a" });
  [res, L] = lay("tree", { a: 1 });
  assert.deepEqual(M.navTarget(res, L, "a", "right"), { unfold: "a" });
  [res, L] = lay("time");
  assert.deepEqual(M.navTarget(res, L, R, "right"), { id: "a" });
  assert.deepEqual(M.navTarget(res, L, "a", "right"), { id: "b" });
  assert.deepEqual(M.navTarget(res, L, "a", "left"), { id: R });
  assert.deepEqual(M.navTarget(res, L, "a", "down"), { id: "a1" });
  assert.deepEqual(M.navTarget(res, L, "a2", "down"), null, "rows stay in their main branch");
  assert.deepEqual(M.navTarget(res, L, "a1", "up"), { id: "a" });
  [res, L] = lay("");
  assert.deepEqual(M.navTarget(res, L, R, "right").id.charAt(0), "a".charAt(0));
  assert.deepEqual(M.navTarget(res, L, "a", "down"), { id: "b" });
  assert.deepEqual(M.navTarget(res, L, "a", "left"), { id: R });
});

// ---------- presentation ----------
test("wave 27 presentation: centre first, branches depth first, folds are one step, views fit", () => {
  const nodes = [nd(R, "", ""), nd("a", R, "A"), nd("b", R, "B"), nd("a1", "a", "A"), nd("a2", "a", "B"), nd("b1", "b", "A"), nd("b11", "b1", "A")];
  const res = M.resolve(M.merge({ maps: [mp()], nodes, tombs: {} }, {}), MAP);
  assert.deepEqual(M.presentSteps(res, {}), [R, "a", "a1", "a2", "b", "b1", "b11"]);
  assert.deepEqual(M.presentSteps(res, { b1: 1 }), [R, "a", "a1", "a2", "b", "b1"]);
  assert.deepEqual(M.presentSteps(res, { [R]: 1 }).length, 7, "the centre is never folded");
  const lay = M.layout(res, {}), steps = M.presentSteps(res, {});
  for (let i = 0; i <= steps.length; i++) {
    const v = M.presentView(res, lay, steps, i);
    assert.ok(v.w > 0 && v.h > 0);
    if (i < steps.length) assert.ok(inside(v, lay.nodes[steps[i]]), "step " + i + " shows its node");
  }
  // the camera holds still within one main branch
  assert.deepEqual(M.presentView(res, lay, steps, 1), M.presentView(res, lay, steps, 3));
  assert.deepEqual(M.presentView(res, lay, steps, steps.length), { x: 0, y: 0, w: lay.w, h: lay.h });
  // scene: only what was revealed is drawn
  const sc = M.scene(res, lay, { only: { [R]: 1, a: 1 }, cur: "a", keep: { [R]: 1, a: 1 } });
  const drawn = sc.items.filter((it) => it.a && it.a["data-id"]).map((it) => it.a["data-id"]);
  assert.deepEqual(drawn.sort(), [R, "a"].sort());
  assert.ok(sc.items.some((it) => /mm-cur/.test(it.cls || "")));
  assert.equal(sc.items.filter((it) => it.cls && it.cls.indexOf("mm-edge") === 0).length, 1);
});

// ---------- SVG ----------
test("wave 27 SVG: shapes, fills and frames stay on the allow-list; labels escaped; readable text", () => {
  const evil = '</text><script>alert(1)</script>';
  const d = M.merge(base({
    styles: M.SHAPES.slice(1).map((s, i) => sy(i % 2 ? "a" : "b", { shape: s, fill: "solid", border: "dashed" })),
    frames: [fr("f1", ["a"], { label: evil }), fr("f2", ["b"], { kind: "brace", label: evil })]
  }), {});
  ["", "org", "tree", "time"].forEach((kind) => {
    d.layouts = [ly(kind)];
    const res = M.resolve(M.merge(d, {}), MAP), lay = M.layout(res, {});
    const svg = M.toSvg(M.scene(res, lay, { pal: { panel: "#123456", text: "#fff", accent: "#d4af37" }, selFrame: "f1" }), {});
    assert.ok(!/<script/i.test(svg));
    assert.ok(/&lt;\/text&gt;&lt;script&gt;/.test(svg));
    const tags = svg.match(/<([a-zA-Z]+)/g).map((t) => t.slice(1));
    tags.forEach((t) => assert.ok(t === "svg" || t === "title" || M.TAGS[t], t));
    const attrs = (svg.match(/\s([a-zA-Z-]+)="/g) || []).map((a) => a.trim().slice(0, -2));
    attrs.forEach((a) => assert.ok(M.ATTRS[a] || ["xmlns", "width", "height", "viewBox", "font-family", "version", "encoding"].includes(a), a));
    assert.ok(!/data-frame/.test(svg), "no data attributes in files");
  });
  assert.equal(M.onColor("#ecc75f"), "#1f2328");
  assert.equal(M.onColor("#6d4aff"), "#ffffff");
  assert.equal(M.onColor("rgb(20, 20, 20)"), "#ffffff");
  assert.equal(M.mix("#ffffff", "#000000", 0.5), "#808080");
  assert.equal(M.mix("#ffffff", "var(--x)", 0.5), "#ffffff");
});

// ---------- JSON ----------
test("wave 27 JSON: styles, frames and layouts travel in exports and backups", () => {
  const d = M.merge(base({ styles: [sy("a", { shape: "pill" })], frames: [fr("f1", ["a", "b"], { label: "G" })], layouts: [ly("org")] }), {});
  const one = M.parseImport(M.exportData(d, MAP, "2026-10-14"), { maps: [] });
  assert.ok(one.ok);
  assert.deepEqual([one.data.styles, one.data.frames, one.data.layouts], [d.styles, d.frames, d.layouts]);
  const all = M.parseImport(M.exportData(d, null, "x"), {});
  assert.deepEqual(all.data, d);
  // hostile rows are dropped and counted
  const raw = JSON.parse(M.exportData(d, null, "x"));
  raw.frames.push({ id: "f9", m: 1, map: MAP, nodes: "a" });
  raw.styles.push({ id: "<b>", m: 1, map: MAP });
  raw.layouts.push({ id: "zz", m: 1, map: "yy", kind: "org" });
  const r = M.parseImport(JSON.stringify(raw), {});
  assert.ok(r.ok);
  assert.equal(r.stats.dropped, 3);
  assert.deepEqual(r.data, d);
});
