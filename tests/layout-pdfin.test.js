// orOS Layout — PDF import, pure part (layout/pdfin.js): text pieces
// → lines → blocks (frames) → a Layout document. The PDF.js part runs
// in the browser (shell harness).
// Run: node --test tests/layout-pdfin.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const P = require(path.join(ROOT, "layout/pdfin.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

// pieces as PDF.js gives them: one per text show, words or parts of lines
const piece = (s, x, y, size, o) => Object.assign({ s, x, y, w: T.measure("sans-r", s, size), size, rot: 0, fam: "sans", b: 0, i: 0 }, o || {});

test("pdf: pieces on one baseline join into a line, with spaces where there was a gap", () => {
  const ls = P.toLines([
    piece("Hello", 50, 100, 12), piece("world", 50 + T.measure("sans-r", "Hello ", 12), 100, 12),
    piece("bold", 130, 100.2, 12, { b: 1 }),
    piece("Next line", 50, 115, 12),
    piece("", 0, 0, 0, { eol: true }),
    piece("Big", 50, 160, 24)
  ]);
  assert.equal(ls.length, 3);
  assert.deepEqual(ls[0].runs.map((r) => [r.t, r.b]), [["Hello world", 0], [" bold", 1]]);
  assert.equal(ls[1].runs[0].t, "Next line");
  assert.equal(ls[2].size, 24);
  // control characters and soft hyphens go
  assert.equal(P.toLines([piece("a\u0001b­c", 0, 10, 10)])[0].runs[0].t, "abc");
});

test("pdf: stacked lines become one block; paragraphs and alignment are found", () => {
  const W = 200;
  const body = (k, s, x) => piece(s, x === undefined ? 40 : x, 300 + k * 14, 11, { w: x === undefined ? W : T.measure("sans-r", s, 11) });
  const lines = P.toLines([
    piece("Title centred", 140 - T.measure("sans-r", "Title centred", 20) / 2, 100, 20),
    body(0, "one full line of justified text"), body(1, "another full line of text here"),
    body(2, "end of paragraph.", 40), body(3, "Second paragraph full line text"), body(4, "last line.", 40),
    // a second column at the same height
    piece("Column two text", 300, 300, 11), piece("goes on here", 300, 314, 11)
  ]);
  const bs = P.toBlocks(lines);
  assert.equal(bs.length, 3);
  const [title, col1, col2] = bs;
  assert.equal(title.lines.length, 1);
  assert.equal(col1.lines.length, 5);
  assert.equal(col1.lead, 14);
  assert.equal(col1.align, "j");
  assert.deepEqual(col1.paras.map((p) => p.length), [3, 2]);
  assert.equal(col2.lines.length, 2);
  // a bigger gap after a paragraph's short last line: same frame, space after
  const g = (y, s, full) => piece(s, 40, y, 11, { w: full ? W : T.measure("sans-r", s, 11) });
  const gb = P.toBlocks(P.toLines([g(500, "a full line", 1), g(514, "a full line", 1), g(528, "short."), g(546, "next full", 1), g(560, "end.")]));
  assert.equal(gb.length, 1);
  assert.deepEqual([gb[0].lead, gb[0].sa, gb[0].paras.map((p) => p.length)], [14, 4, [3, 2]]);
  // one wide line over a short one is not "justified"
  const h = P.toBlocks(P.toLines([g(600, "Heading that", 0), g(614, "wraps")]));
  assert.equal(h[0].align, "l");
  // centred lines
  const c = P.toBlocks(P.toLines([
    piece("A short one", 100 - T.measure("sans-r", "A short one", 12) / 2, 50, 12),
    piece("a much longer centred line", 100 - T.measure("sans-r", "a much longer centred line", 12) / 2, 65, 12)
  ]));
  assert.equal(c.length, 1);
  assert.equal(c[0].align, "c");
});

test("pdf: blocks become text frames whose first baseline stays put", () => {
  const blocks = P.toBlocks(P.toLines([
    piece("Καλημέρα από το PDF", 60, 120, 18, { fam: "serif", color: [200, 20, 20] }),
    piece("Body text that wraps", 60, 200, 10), piece("over two lines here.", 60, 212, 10, { i: 1 }),
    piece("Rotated", 300, 400, 14, { rot: 90 })
  ]));
  const res = P.buildDoc([{ w: 420, h: 595, blocks, bg: { a: "a".repeat(64) + ".jpg", iw: 875, ih: 1240 } }, { w: 420, h: 595, blocks: [], bg: null }], { now: 7, name: "Affinity export" });
  const d = res.doc;
  assert.equal(d.name, "Affinity export");
  assert.deepEqual([d.setup.w, d.setup.h, d.pages.length], [420, 595, 2]);
  assert.equal(res.stats.frames, 3);
  const pg = M.pagesInOrder(d);
  const bg = d.items.find((i) => i.t === "img");
  assert.deepEqual([bg.pg, bg.x, bg.y, bg.w, bg.h, bg.lock, bg.iw], [pg[0].id, 0, 0, 420, 595, 1, 875]);
  assert.ok(d.items.filter((i) => i.t === "text").every((t) => t.z > bg.z), "text above the page picture");
  assert.equal(d.items.filter((i) => i.pg === pg[1].id).length, 0);
  // the title: serif, red, baseline at 120
  const L = R.computeLayout(d);
  const tf = d.items.find((i) => i.t === "text" && M.story(d, i.story).paras[0].runs[0].t.startsWith("Καλημέρα"));
  const ps = d.pstyles.find((p) => p.id === M.story(d, tf.story).paras[0].ps);
  assert.deepEqual([ps.font, ps.size], ["serif", 18]);
  assert.deepEqual(d.swatches.find((s) => s.id === ps.color).v, [200, 20, 20]);
  const ln = L.frames[tf.id].lines[0];
  assert.ok(Math.abs(tf.y + ln.y - 120) < 0.01, "first baseline at 120, got " + (tf.y + ln.y));
  assert.ok(Math.abs(tf.x + ln.runs[0].x - 60) < 0.01);
  assert.equal(L.overset[tf.story], undefined, "fits its frame");
  // the body: one paragraph joining both lines, italic run kept
  const body = d.items.find((i) => i.t === "text" && M.story(d, i.story).paras[0].runs[0].t.startsWith("Body"));
  const runs = M.story(d, body.story).paras[0].runs;
  assert.equal(runs.map((r) => r.t).join(""), "Body text that wraps over two lines here.");
  assert.equal(runs.find((r) => r.i).t, " over two lines here.");
  assert.equal(L.overset[body.story], undefined);
  // the rotated word keeps its rotation and its baseline start
  const rt = d.items.find((i) => i.t === "text" && i.rot === 90);
  const rl = L.frames[rt.id].lines[0], c = [rt.x + rt.w / 2, rt.y + rt.h / 2];
  const lx = rl.runs[0].x - rt.w / 2, ly = rl.y - rt.h / 2;    // frame-local → page (rotated 90°)
  assert.ok(Math.abs(c[0] - ly - 300) < 0.01 && Math.abs(c[1] + lx - 400) < 0.01, "rotated baseline start");
  assert.equal(JSON.stringify(M.normDoc(d)), JSON.stringify(d));
  assert.equal(P.buildDoc([], {}), null);
});
