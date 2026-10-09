// Mind Map core (mindmap/mm-core.js): order keys, normalizers, the
// sync merge (slice "mindmap"), resolving orphans and parent loops
// the same way on every device, the strict JSON import, Markdown /
// OPML import + export (hostile files), the layout (no overlapping
// nodes) and the SVG export (no injectable markup).
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
function data(nodes, maps, tombs) {
  return M.merge({ maps: maps || [mp()], nodes: [nd(R, "", "")].concat(nodes || []), tombs: tombs || {} }, {});
}
function rnd(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
let seq = 0;
function newId() { return "n" + (++seq).toString(36).padStart(5, "0"); }

// ---------- order keys ----------
test("order keys: always a key strictly between, never ending in 0", () => {
  const r = rnd(7);
  let keys = [M.between("", null)];
  for (let i = 0; i < 3000; i++) {
    const at = Math.floor(r() * (keys.length + 1));
    const lo = at > 0 ? keys[at - 1] : "", hi = at < keys.length ? keys[at] : null;
    const k = M.between(lo, hi);
    assert.ok(k, "room between " + lo + " and " + hi);
    assert.ok(M.validOrd(k), k);
    assert.ok(k > lo && (hi === null || k < hi), lo + " < " + k + " < " + hi);
    keys.splice(at, 0, k);
  }
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] < keys[i]);
  // repeated inserts at the front: placeAt re-spaces before keys grow long
  let sibs = [{ id: "s0", ord: "V" }];
  for (let n = 1; n < 400; n++) {
    const p = M.placeAt(sibs, 0);
    if (p.respace) sibs = p.respace.map((x) => ({ id: x.id, ord: x.ord }));
    sibs.unshift({ id: "s" + n, ord: p.ord });
    sibs.forEach((x) => assert.ok(x.ord.length <= 40));
    for (let i = 1; i < sibs.length; i++) assert.ok(sibs[i - 1].ord < sibs[i].ord);
  }
  assert.equal(M.between("b", "b"), null);
  assert.equal(M.between("c", "b"), null);
  const sp = M.spread(1000);
  for (let i = 1; i < sp.length; i++) assert.ok(sp[i - 1] < sp[i] && M.validOrd(sp[i]));
});

test("placeAt: a key in the gap, or a re-spacing when the neighbours tie", () => {
  const sibs = [{ id: "a", ord: "A" }, { id: "b", ord: "B" }];
  const p = M.placeAt(sibs, 1);
  assert.ok(p.ord > "A" && p.ord < "B" && !p.respace);
  const tied = [{ id: "a", ord: "V" }, { id: "b", ord: "V" }];
  const q = M.placeAt(tied, 1);
  assert.equal(q.respace.length, 2);
  const all = [{ id: "a", ord: q.respace[0].ord }, { id: "x", ord: q.ord }, { id: "b", ord: q.respace[1].ord }];
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].ord < all[i].ord);
  assert.ok(M.placeAt([], 0).ord);
});

// ---------- normalizers ----------
test("normalizers: allow-list only, caps, enums, root fixed, no prototype keys", () => {
  const x = M.normNode({ id: "a1", m: 5, map: MAP, parent: R, ord: "V", text: "  hi\u202e\u0000 there \n\n\n\nyo ",
    emoji: "🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉", color: "red", note: "n", url: "javascript:alert(1)", done: "yes", evil: 1, __proto__: { x: 1 } });
  assert.deepEqual(Object.keys(x), ["id", "m", "map", "parent", "ord", "text", "emoji", "color", "note", "url", "done"]);
  assert.equal(x.text, "hi there\n\nyo");
  assert.equal(Array.from(x.emoji).length, 8);
  assert.equal(x.url, "");
  assert.equal(x.done, false);
  assert.equal(M.normNode({ id: "a1", m: 1, map: MAP, color: "#fff" }).color, "");
  assert.equal(M.normNode({ id: "a1", m: 1, map: MAP, url: "https://example.org/x?y=1" }).url, "https://example.org/x?y=1");
  assert.equal(M.normNode({ id: "a1", m: 1, map: MAP, url: "https://a.b/\"><script>" }).url, "");
  assert.equal(M.normNode({ id: "a1", m: 1, map: MAP, parent: "a1" }).parent, "");
  assert.equal(M.normNode({ id: "a1", m: 1, map: MAP, ord: "V0" }).ord, "");
  const root = M.normNode({ id: R, m: 1, map: MAP, parent: "zz", ord: "V" });
  assert.equal(root.parent, ""); assert.equal(root.ord, "");
  ["__proto__", "", "-a", "a".repeat(41), 5].forEach((id) => assert.equal(M.normNode({ id, m: 1, map: MAP }), null));
  assert.equal(M.normNode({ id: "a", m: -1, map: MAP }), null);
  assert.equal(M.normMap({ id: "a".repeat(37), m: 1 }), null);
  assert.equal(M.normMap({ id: "m", m: 1, sides: "up" }).sides, "both");
  assert.equal(M.cleanUrl("example.org/page"), "https://example.org/page");
  assert.equal(M.cleanUrl("data:text/html,x"), "");
});

// ---------- merge ----------
function randomState(r, base) {
  const d = JSON.parse(JSON.stringify(base));
  const ids = ["a", "b", "c", "d", "e", "f"];
  ids.forEach((id) => {
    const x = r();
    if (x < 0.25) return;
    if (x < 0.35) { d.tombs[id] = Math.floor(r() * 20); return; }
    d.nodes.push(nd(id, r() < 0.5 ? R : ids[Math.floor(r() * ids.length)], M.spread(6)[Math.floor(r() * 6)],
      { m: Math.floor(r() * 20), text: id + Math.floor(r() * 3), done: r() < 0.3 }));
  });
  if (r() < 0.1) d.tombs[MAP] = Math.floor(r() * 3);
  return d;
}

test("merge: symmetric, idempotent, associative, canonical (fuzz)", () => {
  const r = rnd(42);
  const base = { maps: [mp()], nodes: [nd(R, "", "")], tombs: {} };
  for (let i = 0; i < 4000; i++) {
    const a = randomState(r, base), b = randomState(r, base), c = randomState(r, base);
    const ab = M.merge(a, b), ba = M.merge(b, a);
    assert.equal(JSON.stringify(ab), JSON.stringify(ba));
    assert.equal(JSON.stringify(M.merge(ab, ab)), JSON.stringify(ab));
    assert.equal(JSON.stringify(M.merge(M.merge(a, b), c)), JSON.stringify(M.merge(a, M.merge(b, c))));
    assert.equal(JSON.stringify(M.merge(JSON.parse(JSON.stringify(ab)), {})), JSON.stringify(ab));
  }
});

test("merge: newer edit wins, delete wins a tie, newer edit resurrects, map delete drops its nodes", () => {
  const a = data([nd("x", R, "V", { m: 5, text: "old" })]);
  const b = data([nd("x", R, "V", { m: 6, text: "new" })]);
  assert.equal(M.merge(a, b).nodes.find((n) => n.id === "x").text, "new");
  assert.ok(!M.merge(a, { tombs: { x: 5 } }).nodes.some((n) => n.id === "x"));
  assert.ok(M.merge(a, { tombs: { x: 4 } }).nodes.some((n) => n.id === "x"));
  const gone = M.merge(a, { tombs: { [MAP]: 9 } });
  assert.equal(gone.maps.length, 0);
  assert.equal(gone.nodes.length, 0);
});

test("merge: two devices adding children to the same node keep both", () => {
  const base = data([nd("p")]);
  const a = M.merge(base, { nodes: [nd("c1", "p", M.between("", null), { m: 10 })] });
  const b = M.merge(base, { nodes: [nd("c2", "p", M.between("", null), { m: 11 })] });
  const R1 = M.resolve(M.merge(a, b), MAP);
  assert.deepEqual(R1.kids.p.slice().sort(), ["c1", "c2"]);
});

// ---------- resolve ----------
test("resolve: a parent loop from two devices is broken the same way on both", () => {
  const base = data([nd("x"), nd("y")]);
  const devA = M.merge(base, { nodes: [nd("x", "y", "V", { m: 10 })] });     // x under y
  const devB = M.merge(base, { nodes: [nd("y", "x", "V", { m: 10 })] });     // y under x
  const m1 = M.merge(devA, devB), m2 = M.merge(devB, devA);
  const r1 = M.resolve(m1, MAP), r2 = M.resolve(m2, MAP);
  assert.deepEqual(r1.kids, r2.kids);
  assert.ok(r1.rec.x && !r1.rec.y);             // smallest id hangs from the centre
  assert.deepEqual(r1.kids[R], ["x"]);
  assert.deepEqual(r1.kids.x, ["y"]);
  assert.equal(M.subtree(r1, R).length, 3);       // nothing lost
});

test("resolve: a child added under a node deleted elsewhere is recovered, not lost", () => {
  const base = data([nd("p"), nd("q", "p")]);
  const devA = M.merge(base, { tombs: { p: 20, q: 20 } });
  const devB = M.merge(base, { nodes: [nd("new", "q", "V", { m: 21, text: "keep me" })] });
  const m = M.merge(devA, devB);
  const r = M.resolve(m, MAP);
  assert.ok(r.rec.new);
  assert.deepEqual(r.kids[R], ["new"]);
  assert.equal(r.N.new.text, "keep me");
});

test("resolve: long chains, many loops, missing root: every node reachable exactly once", () => {
  const r = rnd(3);
  for (let round = 0; round < 200; round++) {
    const ids = Array.from({ length: 30 }, (_, i) => "k" + i);
    const nodes = ids.map((id) => nd(id, r() < 0.15 ? "gone" : (r() < 0.2 ? R : ids[Math.floor(r() * ids.length)]),
      M.spread(4)[Math.floor(r() * 4)]));
    const d = round % 5 === 0
      ? M.merge({ maps: [mp()], nodes, tombs: {} }, {})        // no root row: placeholder
      : data(nodes);
    const res = M.resolve(d, MAP);
    const all = M.subtree(res, R);
    assert.equal(all.length, ids.length + 1);
    assert.equal(new Set(all).size, all.length);
    if (round % 5 === 0) assert.ok(res.root.virtual);
  }
  // a 20 000 deep chain does not blow the stack
  const chain = Array.from({ length: 20000 }, (_, i) => nd("c" + i, i ? "c" + (i - 1) : R, "V"));
  const big = M.resolve(data(chain), MAP);
  assert.equal(M.subtree(big, R).length, 20001);
  assert.equal(M.depthOf(big, "c19999"), 20000);
  const lay = M.layout(big, { fold: {} });
  assert.equal(lay.order.length, 20001);
});

test("resolve helpers: isInside, branchOf, ordering by key then id", () => {
  const d = data([nd("a", R, "A"), nd("b", R, "B"), nd("a1", "a", "V"), nd("a2", "a", "V"), nd("a11", "a1", "V")]);
  const res = M.resolve(d, MAP);
  assert.deepEqual(res.kids[R], ["a", "b"]);
  assert.deepEqual(res.kids.a, ["a1", "a2"]);
  assert.ok(M.isInside(res, "a", "a11"));
  assert.ok(!M.isInside(res, "a1", "b"));
  assert.equal(M.branchOf(res, "a11"), "a");
  assert.equal(M.branchOf(res, R), null);
});

// ---------- JSON import / export ----------
test("JSON: round trip, strict format, hostile rows dropped, import is a merge", () => {
  const d = data([nd("a", R, "A", { note: "n", url: "https://x.org" }), nd("b", "a", "V")]);
  const txt = M.exportData(d, MAP, "2026-10-09T00:00:00Z");
  const back = M.parseImport(txt, M.emptyData());
  assert.ok(back.ok);
  assert.equal(JSON.stringify(M.merge(back.data, {})), JSON.stringify(M.merge(d, {})));
  assert.equal(M.parseImport("{", null).err, "json");
  assert.equal(M.parseImport(JSON.stringify({ app: "familytree", format: 1, maps: [], nodes: [] })).err, "format");
  assert.equal(M.parseImport("x".repeat(M.IMPORT_MAX + 1)).err, "size");
  const hostile = M.parseImport(JSON.stringify({ app: "mindmap", format: 1, maps: [mp()], nodes: [
    { id: "__proto__", m: 1, map: MAP }, { id: "ok", m: 1, map: MAP, parent: R, ord: "V", text: "<img src=x onerror=alert(1)>" },
    { id: "z", m: 1, map: "nowhere" }, "str", null] }), M.emptyData());
  assert.ok(hostile.ok);
  assert.equal(hostile.stats.dropped, 4);
  assert.equal(hostile.data.nodes[0].text, "<img src=x onerror=alert(1)>");   // inert text, drawn with textContent
  // restore is a merge: a newer local edit is kept
  const local = M.merge(d, { nodes: [nd("a", R, "A", { m: 50, text: "newer" })] });
  const merged = M.merge(local, back.data);
  assert.equal(merged.nodes.find((n) => n.id === "a").text, "newer");
});

// ---------- Markdown / outline ----------
test("outline: Markdown headings, bullets, tasks, indents; round trip", () => {
  const md = "# Project\n\n- Goals\n  - Ship\n  - [x] Test\n- Risks\n\t- Time\n* Other\n";
  const p = M.parseOutline(md, "fallback");
  assert.ok(p.ok);
  assert.equal(p.tree.text, "Project");
  assert.deepEqual(p.tree.kids.map((k) => k.text), ["Goals", "Risks", "Other"]);
  assert.deepEqual(p.tree.kids[0].kids.map((k) => [k.text, k.done]), [["Ship", false], ["Test", true]]);
  assert.equal(p.tree.kids[1].kids[0].text, "Time");
  const rows = M.treeToRows(p.tree, newId, 100);
  const d = M.merge({ maps: [rows.map], nodes: rows.nodes, tombs: {} }, {});
  const res = M.resolve(d, rows.map.id);
  const out = M.toOutline(res);
  assert.equal(out, "# Project\n- Goals\n  - Ship\n  - [x] Test\n- Risks\n  - Time\n- Other\n");
  const again = M.parseOutline(out, "x");
  assert.deepEqual(again.tree, p.tree);
  // several top items → the fallback title becomes the centre
  const flat = M.parseOutline("one\ntwo\n  two-a\nthree", "My list");
  assert.equal(flat.tree.text, "My list");
  assert.ok(flat.tree.fallback);
  assert.deepEqual(flat.tree.kids.map((k) => k.text), ["one", "two", "three"]);
  assert.equal(M.parseOutline("\n\n  \n", "x").ok, false);
  // pasting under a node: the fallback root is not added, its items are
  const under = M.treeToRows(flat.tree, newId, 5, { map: MAP, parent: "p", keys: ["A", "B", "C"] });
  assert.equal(under.map, null);
  assert.deepEqual(under.nodes.filter((n) => n.parent === "p").map((n) => [n.text, n.ord]), [["one", "A"], ["two", "B"], ["three", "C"]]);
});

// ---------- OPML ----------
test("OPML: round trip with notes; hostile XML is inert", () => {
  const d = data([nd("a", R, "A", { text: "A & <b>", note: "line1\nline2" }), nd("b", "a", "V", { done: true }), nd("c", R, "B")]);
  const res = M.resolve(d, MAP);
  const x = M.toOpml(res, null, "now");
  assert.ok(!/<b>/.test(x));
  const p = M.parseOpml(x, "f");
  assert.ok(p.ok);
  assert.equal(p.tree.text, "map1-r");
  assert.equal(p.tree.kids[0].text, "A & <b>");
  assert.equal(p.tree.kids[0].note, "line1\nline2");
  assert.equal(p.tree.kids[0].kids[0].done, true);
  const multi = M.parseOpml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]>' +
    '<opml version="2.0"><head><title>Feeds &amp; more</title></head><body><!-- c -->' +
    '<outline text="&b; one"/><outline title="two"><outline text="&#x41;&#0;&#xD800;"/></outline></body></opml>', "f");
  assert.ok(multi.ok);
  assert.equal(multi.tree.text, "Feeds & more");
  assert.equal(multi.tree.kids[0].text, "one");                 // custom entity never expands
  assert.equal(multi.tree.kids[1].kids[0].text, "A");
  assert.equal(M.parseOpml("<opml><body><outline text='x'></body></opml>", "f").ok, false);   // unbalanced
  assert.equal(M.parseOpml("<html><body/></html>", "f").ok, false);
  let deep = "";
  for (let i = 0; i < 300; i++) deep += '<outline text="d">';
  assert.equal(M.parseOpml("<opml><body>" + deep + "</body></opml>", "f").ok, false);      // too deep
});

// ---------- layout ----------
function overlaps(lay) {
  const ids = lay.order, bad = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = lay.nodes[ids[i]], b = lay.nodes[ids[j]];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad.push([ids[i], ids[j]]);
  }
  return bad;
}
test("layout: random maps never overlap, both sides and right only, folds hide", () => {
  const r = rnd(11);
  for (let round = 0; round < 120; round++) {
    const ids = Array.from({ length: 5 + Math.floor(r() * 60) }, (_, i) => "k" + i);
    const nodes = ids.map((id, i) => nd(id, i < 3 || r() < 0.3 ? R : ids[Math.floor(r() * i)], M.spread(5)[Math.floor(r() * 5)],
      { text: "word ".repeat(1 + Math.floor(r() * 30)).trim(), emoji: r() < 0.2 ? "🎯" : "", note: r() < 0.2 ? "n" : "" }));
    const sides = round % 2 ? "right" : "both";
    const d = M.merge({ maps: [mp(MAP, 1, sides)], nodes: [nd(R, "", "", { text: "Centre" })].concat(nodes), tombs: {} }, {});
    const res = M.resolve(d, MAP);
    const fold = {};
    if (round % 3 === 0) ids.slice(0, 3).forEach((id) => { fold[id] = 1; });
    const lay = M.layout(res, { fold });
    assert.deepEqual(overlaps(lay), [], "round " + round);
    lay.order.forEach((id) => {
      const c = lay.nodes[id];
      assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= lay.w && c.y + c.h <= lay.h, "inside the drawing");
      if (sides === "right" && c.depth > 0) assert.equal(c.side, "r");
      if (c.depth > 1) assert.equal(c.side, lay.nodes[res.par[id]].side);
    });
    if (round % 3 === 0) {
      ids.slice(0, 3).forEach((id) => {
        if (!res.kids[id].length) return;
        assert.ok(lay.nodes[id].folded);
        assert.equal(lay.nodes[id].hidden, M.subtree(res, id).length - 1);
        res.kids[id].forEach((k) => assert.ok(!lay.nodes[k]));
      });
    }
  }
});

test("layout: wrap keeps every line within the width and caps the lines", () => {
  const sty = { font: 14, weight: 400, max: 240 };
  const lines = M.wrap("a ".repeat(300) + "Supercalifragilisticexpialidocious".repeat(4), sty, M.estimate);
  lines.forEach((l) => assert.ok(M.estimate(l.replace(/…$/, ""), 14) <= 240 + 1, l));
  assert.ok(lines.length <= 12);
  assert.deepEqual(M.wrap("one\ntwo", sty, M.estimate), ["one", "two"]);
});

// ---------- scene + SVG ----------
test("SVG export: user text is escaped, colours validated, no scripts or handlers", () => {
  const evil = '</text><script>alert(1)</script><g onload="x">';
  const d = data([nd("a", R, "A", { text: evil, emoji: "<b>", url: "https://x.org", note: "n" })]);
  d.nodes[0].text = evil;
  const res = M.resolve(d, MAP);
  const lay = M.layout(res, {});
  const sc = M.scene(res, lay, { pal: { accent: "red;background:url(javascript:x)", panel: "#123456", text: "#fff" } });
  const svg = M.toSvg(sc, { title: evil, bg: "#ffffff" });
  assert.ok(!/<script/i.test(svg));
  assert.ok(!/onload=/i.test(svg.replace(/&quot;/g, "")) || !/<g onload/.test(svg));
  assert.ok(!/<g onload/.test(svg));
  assert.ok(!/javascript:/i.test(svg));
  assert.ok(/fill="#123456"/.test(svg));
  assert.ok(/&lt;\/text&gt;&lt;script&gt;/.test(svg));
  // every tag and attribute is on the allow-list
  const tags = svg.match(/<([a-zA-Z]+)/g).map((t) => t.slice(1));
  tags.forEach((t) => assert.ok(t === "svg" || t === "title" || M.TAGS[t], t));
  const attrs = (svg.match(/\s([a-zA-Z-]+)="/g) || []).map((a) => a.trim().slice(0, -2));
  attrs.forEach((a) => assert.ok(M.ATTRS[a] || ["xmlns", "width", "height", "viewBox", "font-family", "version", "encoding"].includes(a), a));
});

// ---------- example ----------
test("example map: fixed ids, two devices get one map, valid rows", () => {
  const a = M.exampleRows("en", 10), b = M.exampleRows("el", 12);
  assert.ok(a.nodes.every(Boolean));
  const da = M.merge({ maps: [a.map], nodes: a.nodes, tombs: {} }, {});
  const db = M.merge({ maps: [b.map], nodes: b.nodes, tombs: {} }, {});
  const m = M.merge(da, db);
  assert.equal(m.maps.length, 1);
  assert.equal(m.nodes.length, a.nodes.length);
  assert.equal(M.resolve(m, M.EXAMPLE_ID).root.text, "Σχέδιο ταξιδιού");
});
