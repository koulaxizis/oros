// Layout W8 (LY-W8): contents that follow a new page size (layout/
// retrim.js): edges, margins, the text area, centring, proportions,
// masters, guides, styles in proportion; house templates and house
// pages on any trim; strings in EN/EL/DE and the wiring.
// Run: node --test tests/layout-w8.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const RT = require(path.join(ROOT, "layout/retrim.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MM = 72 / 25.4;
const near = (a, b, e) => Math.abs(a - b) <= (e || 0.01);

// a 140×210 page, 15 mm margins all round, one page, not facing
function page() {
  const d = M.newDoc({ name: "W8", w: 140 * MM, h: 210 * MM, pages: 1, facing: 0 }, 1);
  Object.assign(d.setup, { mt: 15 * MM, mb: 15 * MM, mi: 15 * MM, mo: 15 * MM, bleed: 3 * MM });
  return { d, pg: M.pagesInOrder(d)[0] };
}
function item(d, pg, id, t, x, y, w, h, extra) {
  const it = Object.assign({ id, m: 1, t, pg: pg.id, x, y, w, h, z: 1 }, extra || {});
  if (t === "text") { it.story = "st-" + id; d.stories.push({ id: it.story, m: 1, paras: [{ ps: "ps-body", runs: [{ t: "x" }] }] }); }
  d.items.push(it);
  return it;
}
const S = (d, w, h, mg) => Object.assign(JSON.parse(JSON.stringify(d.setup)), { w: w * MM, h: h * MM }, mg || {});

test("retrim: the edges, the margins and the text area, as a designer would", () => {
  const { d, pg } = page();
  const W = d.setup.w, H = d.setup.h, m = 15 * MM;
  item(d, pg, "bg", "img", -3 * MM, -3 * MM, W + 6 * MM, H + 6 * MM);          // a picture in the bleed
  item(d, pg, "band", "rect", -3 * MM, 0, W + 6 * MM, 20 * MM);               // a band at the top
  item(d, pg, "body", "text", m, m, W - 2 * m, H - 2 * m);                     // the text area
  item(d, pg, "pn", "text", W / 2 - 10, H - m + 10, 20, 12);                  // page number in the foot margin, centred
  item(d, pg, "logo", "rect", W - m - 20 * MM, H - m - 20 * MM, 20 * MM, 20 * MM);   // a square in the text area's corner
  item(d, pg, "orn", "ell", W / 2 - 15, 100, 30, 30);                          // a centred ornament
  item(d, pg, "rule", "line", m, 120, 40 * MM, 0);
  d.guides = [{ id: "gd-1", m: 1, o: "v", p: m }, { id: "gd-2", m: 1, o: "h", p: H - m }];
  const to = S(d, 180, 250, RT.marginsFor(d.setup, 180 * MM, 250 * MM));
  const r = RT.retrim(d, to);
  const W2 = 180 * MM, H2 = 250 * MM, P = RT.pageOf(d.setup, "R");
  const g = (id) => d.items.find((it) => it.id === id);
  assert.equal(d.setup.w, W2);
  assert.ok(near(P.ml, 15 * MM * 180 / 140, 0.1) && near(P.mt, 15 * MM * 250 / 210, 0.1), "margins in proportion");
  assert.ok(near(g("bg").x, -3 * MM) && near(g("bg").x + g("bg").w, W2 + 3 * MM) && near(g("bg").y + g("bg").h, H2 + 3 * MM), "the bleed picture fills the new bleed");
  assert.ok(near(g("band").w, W2 + 6 * MM) && near(g("band").y, 0) && near(g("band").h, 20 * MM * (H2 - 2 * P.mt) / (H - 2 * m), 0.5), "the band keeps the top, takes the width");
  assert.ok(near(g("body").x, P.ml) && near(g("body").w, W2 - P.ml - P.mr) && near(g("body").h, H2 - P.mt - P.mb), "the text frame takes the text area");
  assert.ok(near(g("pn").x + g("pn").w / 2, W2 / 2, 0.01) && g("pn").y > H2 - P.mb && near(g("pn").w, 20 * (W2 - P.ml - P.mr) / (W - 2 * m), 0.01) && g("pn").y + g("pn").h <= H2 + 0.01, "the page number stays centred in the foot margin");
  assert.ok(near(g("logo").w, g("logo").h) && near(g("logo").x + g("logo").w, W2 - P.mr, 0.01) && near(g("logo").y + g("logo").h, H2 - P.mb, 0.01), "the square keeps its shape and the corner");
  assert.ok(near(g("orn").w, g("orn").h) && near(g("orn").x + g("orn").w / 2, W2 / 2, 0.01), "the ornament stays round and centred");
  assert.equal(g("rule").h, 0, "a line stays level");
  assert.ok(near(d.guides[0].p, P.ml) && near(d.guides[1].p, H2 - P.mb), "guides move with the text area");
  assert.equal(r.items, 7);
  // back again: where it started (within rounding)
  const back = S(d, 140, 210, { mt: m, mb: m, mi: m, mo: m });
  RT.retrim(d, back);
  assert.ok(near(g("body").w, W - 2 * m, 0.01) && near(g("pn").x, W / 2 - 10, 0.01), "the text area and the page number come back");
  assert.ok(near(g("logo").w, g("logo").h) && near(g("logo").x + g("logo").w, W - m, 0.01), "the square stays square in its corner (its size follows the narrower side, so it does not come back exactly)");
});

test("retrim: facing pages keep their inside and outside; masters too; turned objects; text sizes when asked", () => {
  const d = M.newDoc({ name: "F", w: 140 * MM, h: 210 * MM, pages: 3, facing: 1 }, 1);
  Object.assign(d.setup, { mt: 15 * MM, mb: 20 * MM, mi: 20 * MM, mo: 12 * MM });
  const pgs = M.pagesInOrder(d), W = d.setup.w, H = d.setup.h;
  const sideOf = (i) => M.sideOf(d, i);
  const li = pgs.findIndex((p, i) => sideOf(i) === "L");
  // a running head on the outside of a left page, in the head margin
  item(d, pgs[li], "rh", "text", 12 * MM, 5 * MM, 40 * MM, 6 * MM);
  // a master item for right pages, in the outer foot corner
  const ms = d.masters[0];
  d.items.push({ id: "it-mpn", m: 1, t: "text", pg: ms.id, side: "R", x: W - 12 * MM - 10 * MM, y: H - 12 * MM, w: 10 * MM, h: 5 * MM, story: "st-mpn", z: 1 });
  d.stories.push({ id: "st-mpn", m: 1, paras: [{ ps: "ps-base", runs: [{ f: "pn" }] }] });
  item(d, pgs[0], "tilt", "rect", 100, 200, 40, 20, { rot: 30 });
  const ps = d.pstyles.find((s) => s.id === "ps-body"), size0 = ps.size || 0;
  const to = S(d, 170, 240, RT.marginsFor(d.setup, 170 * MM, 240 * MM));
  const r = RT.retrim(d, to, { text: "scale", now: 9 });
  const W2 = d.setup.w, L = RT.pageOf(d.setup, "L"), R = RT.pageOf(d.setup, "R");
  const g = (id) => d.items.find((it) => it.id === id);
  assert.ok(near(g("rh").x, L.ml, 0.01), "left page: the outside margin stays its left edge");
  assert.ok(g("rh").y + g("rh").h <= L.mt + 0.01, "still in the head margin");
  assert.ok(near(g("it-mpn").x + g("it-mpn").w, W2 - 12 * MM * 170 / 140, 0.1), "the master's number keeps the outer corner");
  assert.ok(near(g("tilt").w / g("tilt").h, 2, 0.001), "a turned object keeps its shape");
  assert.ok(r.k > 1);
  if (size0) assert.ok(near(ps.size, Math.round(size0 * r.k * 10) / 10, 0.05) && ps.m === 9, "the style's size in proportion");
  assert.ok(M.normDoc(d), "still a valid document");
});

test("house pages and house templates fit any trim (pro.js, intake.js use retrim)", () => {
  assert.match(read("layout/pro.js"), /RT\.mapRect\(/);
  assert.match(read("layout/intake.js"), /RT\.retrim\(d, nu\)/);
  const html = read("layout/index.html"), sw = read("sw.js");
  assert.match(html, /src="retrim\.js\?v=/);
  assert.ok(html.indexOf("retrim.js") < html.indexOf("intake.js") && html.indexOf("retrim.js") < html.indexOf("pro.js"), "loaded before its users");
  assert.ok(sw.includes('"layout/retrim.js"'));
  assert.match(read("layout/panels.js"), /RT\.retrim\(doc, ns,/);
});

test("W8: strings in EN/EL/DE, help", () => {
  const LYJS = read("layout/layout.js"), at = LYJS.indexOf('"home.new": "Νέο έγγραφο"');
  const de = read("i18n/de/layout.js");
  ["setup.fitH", "setup.fit", "setup.fitText", "setup.fitHint"].forEach((k) => {
    assert.ok(LYJS.slice(0, at).includes('"' + k + '": '), "EN " + k);
    assert.ok(LYJS.slice(at).includes('"' + k + '": '), "EL " + k);
    assert.ok(de.includes('"' + k + '": '), "DE " + k);
  });
  assert.match(read("layout/help.en.txt"), /## A new page size/);
  assert.match(read("layout/help.el.txt"), /## Νέο μέγεθος σελίδας/);
  assert.match(read("i18n/de/help/layout.txt"), /## Neues Seitenformat/);
});
