// Layout W16 (LY-W16): alternate layouts. An alternate is a document
// of its own made from an original in another size (pages fitted by
// retrim.js, text sizes in proportion when asked), its stories linked
// by a fingerprint of the original's paragraphs: status() says which
// changed there (and which also changed here), update() takes them and
// the styles and colours the original gained, one way only; unlink()
// makes it a plain document. Strings in EN/EL/DE, help, wiring.
// Synthetic documents only.
// Run: node --test tests/layout-w16.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const M = require(path.join(ROOT, "designkit/model.js"));
const ALT = require(path.join(ROOT, "layout/altlayout.js"));

function original() {
  const d = M.newDoc({ name: "Φυλλάδιο", w: 420, h: 595, pages: 1, facing: 0 }, 1);
  const pg = M.pagesInOrder(d)[0];
  d.stories.push({ id: "st-a", m: 1, paras: [{ ps: "ps-base", runs: [{ t: "Συναυλία στο λιμάνι" }] }] });
  d.stories.push({ id: "st-b", m: 1, paras: [{ ps: "ps-base", runs: [{ t: "Σάββατο, 21:00" }] }] });
  d.items.push({ id: "it-bg", m: 1, t: "rect", pg: pg.id, x: 0, y: 0, w: 420, h: 595, fill: "sw-yellow", z: 1 });
  d.items.push({ id: "it-a", m: 1, t: "text", pg: pg.id, x: 40, y: 60, w: 340, h: 80, story: "st-a", seq: 1, z: 2 });
  d.items.push({ id: "it-b", m: 1, t: "text", pg: pg.id, x: 40, y: 160, w: 340, h: 40, story: "st-b", seq: 1, z: 3 });
  d.setup.ext = { bk: { id: "bk-x", name: "Σειρά", n: 1 }, pub: "pb-1", lang: "el" };
  return M.normDoc(d);
}
function setText(d, id, txt, now) {
  const s = M.find(d.stories, id);
  s.paras = [{ ps: "ps-base", runs: [{ t: txt }] }];
  s.h = [s.m].concat(s.h || []); s.m = now;
}

test("make: a document of its own in the new size, linked to the original", () => {
  const src = original();
  const before = JSON.stringify(src);
  const alt = ALT.make(src, { w: 1080, h: 1080, label: "Τετράγωνο", text: "scale", now: 5 });
  assert.equal(JSON.stringify(src), before, "the original is untouched");
  assert.notEqual(alt.id, src.id);
  assert.equal(alt.setup.w, 1080); assert.equal(alt.setup.h, 1080);
  assert.equal(alt.name, "Φυλλάδιο · Τετράγωνο");
  const a = ALT.info(alt);
  assert.equal(a.src, src.id); assert.equal(a.n, "Τετράγωνο"); assert.ok(a.k > 1, "text sizes followed: " + a.k);
  // the background still runs to the edges
  const bg = M.find(alt.items, "it-bg");
  assert.deepEqual([bg.x, bg.y, bg.w, bg.h], [0, 0, 1080, 1080]);
  // the book, the Publishing title and the cover stay with the original
  assert.equal(alt.setup.ext.bk, undefined); assert.equal(alt.setup.ext.pub, undefined);
  assert.equal(alt.setup.ext.lang, "el");
  // its stories carry the original's fingerprint and survive normDoc
  const n = M.normDoc(JSON.parse(JSON.stringify(alt)));
  assert.equal(M.find(n.stories, "st-a").ext.alt, ALT.fp(M.find(src.stories, "st-a").paras));
  assert.deepEqual(ALT.status(n, src), { gone: false, out: [], both: [], styles: 0 });
  assert.equal(ALT.alternates([src, n], src.id).length, 1);
  assert.equal(ALT.alternates([src, n], n.id).length, 0);
  // text sizes not asked to follow
  assert.equal(ALT.info(ALT.make(src, { w: 1080, h: 1080, label: "x", now: 5 })).k, 1);
});

test("make: refuses a size outside a page and an empty label", () => {
  const src = original();
  assert.equal(ALT.make(src, { w: 10, h: 1080, label: "x" }).err, "size");
  assert.equal(ALT.make(src, { w: 1080, h: 99999, label: "x" }).err, "size");
  assert.equal(ALT.make(src, { w: 1080, h: 1080, label: "  " }).err, "label");
});

test("status and update: the original's texts, one way, with a warning when both changed", () => {
  const src = original();
  const alt = ALT.make(src, { w: 1080, h: 1080, label: "Post", text: "scale", now: 5 });
  setText(src, "st-a", "Συναυλία στην προκυμαία", 10);
  setText(src, "st-b", "Κυριακή, 20:00", 10);
  setText(alt, "st-b", "Σάββατο 9 μ.μ.", 11);           // changed here too
  let st = ALT.status(alt, src);
  assert.deepEqual(st.out.slice().sort(), ["st-a", "st-b"]);
  assert.deepEqual(st.both, ["st-b"]);
  // the alternate's own frame change stays
  M.find(alt.items, "it-a").x = 77;
  const res = ALT.update(alt, src, 20);
  assert.deepEqual(res, { stories: 2, styles: 0 });
  assert.equal(M.find(alt.stories, "st-a").paras[0].runs[0].t, "Συναυλία στην προκυμαία");
  assert.equal(M.find(alt.stories, "st-b").paras[0].runs[0].t, "Κυριακή, 20:00");
  assert.equal(M.find(alt.items, "it-a").x, 77);
  assert.ok(M.find(alt.stories, "st-a").m >= 20);
  assert.deepEqual(ALT.status(alt, src).out, []);
  // nothing flows back to the original
  assert.equal(M.find(src.stories, "st-a").paras[0].runs[0].t, "Συναυλία στην προκυμαία");
  // a story made in the alternate is not linked
  alt.stories.push({ id: "st-new", m: 21, paras: [{ ps: "ps-base", runs: [{ t: "μόνο εδώ" }] }] });
  assert.deepEqual(ALT.update(alt, src, 22), { stories: 0, styles: 0 });
  // only the asked stories
  setText(src, "st-a", "Α", 30); setText(src, "st-b", "Β", 30);
  assert.equal(ALT.update(alt, src, 31, ["st-b"]).stories, 1);
  assert.deepEqual(ALT.status(alt, src).out, ["st-a"]);
});

test("update: styles and colours the original gained are added, text sizes scaled", () => {
  const src = original();
  const alt = ALT.make(src, { w: 840, h: 1190, label: "A3", text: "scale", now: 5 });
  const k = ALT.info(alt).k;
  src.pstyles.push({ id: "ps-xhead", m: 9, name: "Τίτλος αφίσας", size: 20 });
  src.swatches.push({ id: "sw-xsea", m: 9, name: "Θάλασσα", c: [0, 80, 160] });
  assert.equal(ALT.status(alt, src).styles, 2);
  const res = ALT.update(alt, src, 12);
  assert.equal(res.styles, 2);
  assert.equal(M.find(alt.pstyles, "ps-xhead").size, Math.round(20 * k * 10) / 10);
  assert.ok(M.find(alt.swatches, "sw-xsea"));
  const n = M.normDoc(JSON.parse(JSON.stringify(alt)));
  assert.ok(M.find(n.pstyles, "ps-xhead") && M.find(n.swatches, "sw-xsea"));
  assert.equal(ALT.status(n, src).styles, 0);
});

test("gone original, unlink, merge with another device", () => {
  const src = original();
  const alt = ALT.make(src, { w: 1080, h: 1080, label: "Post", now: 5 });
  assert.equal(ALT.status(alt, null).gone, true);
  assert.equal(ALT.update(alt, null, 9).stories, 0);
  // two devices: one unlinks, the other keeps it; the newer setup wins
  const other = JSON.parse(JSON.stringify(alt));
  assert.equal(ALT.unlink(alt, 10), true);
  assert.equal(ALT.info(alt), null);
  assert.ok(alt.stories.every((s) => !s.ext || s.ext.alt === undefined));
  assert.equal(ALT.unlink(alt, 11), false);
  const merged = M.mergeDoc(M.normDoc(alt), M.normDoc(other));
  assert.equal(ALT.info(merged), null);
  // an alternate of an alternate follows the one it was made from
  const alt2 = ALT.make(M.normDoc(other), { w: 600, h: 600, label: "Μικρό", now: 12 });
  assert.equal(ALT.info(alt2).src, other.id);
});

test("strings in EN, EL and DE; help; wiring", () => {
  const keys = ["more.alt", "alt.title", "alt.hint", "alt.of", "alt.gone", "alt.out", "alt.current", "alt.both", "alt.update", "alt.updated",
    "alt.openSrc", "alt.unlink", "alt.unlinkSure", "alt.unlinked", "alt.list", "alt.stale", "alt.open", "alt.new", "alt.label", "alt.turn",
    "alt.text", "alt.make", "alt.made", "alt.errLabel", "alt.errSize"];
  const L = read("layout/layout.js"), DE = read("i18n/de/layout.js"), src = read("layout/altlayout.js");
  keys.forEach((k) => {
    const re = new RegExp('"' + k.replace(".", "\\.") + '": "');
    assert.equal((L.match(new RegExp(re.source, "g")) || []).length, 2, k + " in EN and EL");
    assert.ok(re.test(DE), k + " in DE");
  });
  (src.match(/t\("(alt\.[a-zA-Z]+)"/g) || []).forEach((m) => assert.ok(keys.includes(m.slice(3, -1)), m));
  assert.ok(read("layout/help.en.txt").includes("## Alternate layouts\n"));
  assert.ok(read("layout/help.el.txt").includes("## Εναλλακτικές διατάξεις\n"));
  assert.ok(read("i18n/de/help/layout.txt").includes("## Alternative Layouts\n"));
  const idx = read("layout/index.html");
  assert.ok(idx.indexOf("retrim.js") < idx.indexOf("altlayout.js"), "retrim.js loads first");
  assert.ok(read("sw.js").includes('"layout/altlayout.js"'));
  assert.ok(read("layout/panels.js").includes('t("more.alt")'));
});
