// Layout: SVG import (layout/svgin.js), e.g. pages exported from
// Affinity Publisher. The fixture mimics Affinity's SVG: a 300 dpi
// viewBox with no absolute size, a scaling group, style attributes,
// a userSpaceOnUse gradient with gradientTransform, a rotated rounded
// rectangle, text with tspans, a <use> of an embedded picture, a
// linked picture, plus a script and a foreignObject that must be
// ignored. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const S = require(path.join(ROOT, "layout/svgin.js"));
const SRC = fs.readFileSync(path.join(__dirname, "fixtures/layout-affinity.svg"), "utf8");
const near = (a, b, e) => Math.abs(a - b) < (e || 0.5);

test("svg: small parsers", () => {
  assert.equal(S.lenPt("72pt"), 72);
  assert.equal(S.lenPt("96px"), 72);
  assert.ok(near(S.lenPt("25.4mm"), 72, 0.01));
  assert.equal(S.lenPt("100%"), null);
  assert.deepEqual(S.colour("#f80"), [255, 136, 0]);
  assert.deepEqual(S.colour("rgb(10%, 20, 300)"), [26, 20, 255]);
  assert.equal(S.colour("none"), "none");
  assert.deepEqual(S.colour("url(#Grad_A)"), { url: "Grad_A" }, "ids keep their case");
  assert.deepEqual(S.transform("translate(10 20) scale(2)"), [2, 0, 0, 2, 10, 20]);
  assert.ok(near(S.guessScale(2480, 3508), 72 / 300, 1e-9), "A4 at 300 dpi");
  assert.equal(S.guessScale(500, 500), 1);
});

test("svg: an Affinity page becomes shapes, text frames and pictures", () => {
  const p = S.parse(SRC);
  assert.ok(near(p.w, 595.2, 1) && near(p.h, 841.9, 1), "A4 in pt");
  const grad = p.items.find((i) => i.gr);
  assert.equal(grad.t, "rect");
  assert.ok(near(grad.x, 50) && near(grad.w, 200));
  assert.ok(near(grad.gr.x1, 0, 0.01) && near(grad.gr.x2, 1, 0.01) && near(grad.gr.y1, 0.5, 0.01));
  assert.equal(grad.gr.st[1][2], 50, "stop-opacity");
  const ell = p.items.find((i) => i.t === "ell");
  assert.ok(near(ell.x, 350) && near(ell.w, 100) && near(ell.sw, 2, 0.01));
  const rr = p.items.find((i) => i.t === "rect" && i.rot);
  assert.ok(near(rr.rot, 30, 0.1) && near(rr.w, 100) && near(rr.r, 5), "rotated rounded rect stays a rect");
  const tri = p.items.find((i) => i.t === "path");
  assert.equal(tri.d, "M0 0L1 0L0.5 1Z");
  assert.equal(tri.op, 50, "fill-opacity");
  const line = p.items.find((i) => i.t === "line");
  assert.equal(line.dash, 1);
  assert.ok(near(line.w, 490));
  const imgs = p.items.filter((i) => i.t === "img");
  assert.equal(imgs.length, 2);
  assert.equal(p.images.length, 1, "the data: picture reached through <use>");
  assert.equal(p.linked, 1);
  assert.equal(imgs[1].nm, "cat.jpg");
  assert.deepEqual(p.pieces.map((x) => x.s), ["Hello ", "world, a second line.", "Centred"]);
  assert.equal(p.pieces[0].b, 1);
  assert.equal(p.pieces[0].fam, "serif");
  assert.ok(p.pieces[2].x < 300, "text-anchor middle moves the start left");
});

test("svg: the document, its swatches and picture slots", () => {
  const r = S.convert([S.parse(SRC), S.parse(SRC)], { now: 9, name: "Affinity" });
  const d = r.doc;
  assert.equal(r.stats.pages, 2);
  assert.equal(M.pagesInOrder(d).length, 2);
  assert.equal(r.images.length, 2);
  r.images.forEach((im) => assert.equal(M.find(d.items, im.item).t, "img"));
  const texts = d.items.filter((i) => i.t === "text");
  assert.equal(texts.length, 4, "two frames per page");
  const g = d.items.find((i) => i.gr);
  assert.ok(M.find(d.swatches, g.gr.st[0][1]), "stop colours are swatches");
  assert.ok(g.fill, "fallback fill");
  const zText = Math.min(...texts.map((i) => i.z)), zShapes = Math.max(...d.items.filter((i) => i.t !== "text" && i.pg === texts[0].pg).map((i) => i.z));
  assert.ok(zText > 0 && d.items.every((i) => M.normItem(i)), "every item is valid");
  void zShapes;
});

test("svg: hostile and broken input", () => {
  assert.equal(S.parse("not svg"), null);
  assert.equal(S.parse(""), null);
  // a <use> loop, a script, event handlers and a javascript: picture
  const evil = `<svg viewBox="0 0 100 100"><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/><rect width="10" height="10" fill="red" onclick="alert(1)"/></g>
    <script>alert(1)</script><image href="javascript:alert(1)" width="5" height="5"/><text>&lt;script&gt;x&lt;/script&gt;</text></svg>`;
  const p = S.parse(evil);
  assert.ok(p.items.length >= 1 && p.items.length < 10, "the loop stops");
  assert.ok(p.items.every((i) => !JSON.stringify(i).includes("alert")), "no handler or script text survives");
  assert.equal(p.images.length, 0, "only data: pictures are read");
  assert.equal(p.pieces[0].s, "<script>x</script>", "text stays text");
  const r = S.convert([p], { now: 1 });
  assert.ok(r.doc.stories.length >= 1);
});
