// orOS Layout — house style (layout/house.js, LY-HS): learned from
// earlier books, kept as a Layout document with its rules; the Greek
// typographic set; text fixes that never change words. Synthetic
// books only.
// Run: node --test tests/layout-house.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const H = require(path.join(ROOT, "layout/house.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const { book } = require("./layout-books.js");

test("study: roles from use, titles on new odd pages, front and back matter", () => {
  const s = H.study(book("One", 3, 11));
  const ps = Object.fromEntries(Object.entries(s.roles).map(([r, k]) => [r, s.looks[k].ps]));
  assert.deepEqual(ps, { body: "ps-tb", title: "ps-tt", first: "ps-tf", center: "ps-sc", note: "ps-nt" });
  assert.ok(Object.values(s.roles).every((k) => s.looks[k].plain));
  assert.equal(s.open.length, 3);
  assert.ok(s.open.every((o) => o.top && o.no % 2 === 1), JSON.stringify(s.open));
  assert.equal(s.front.length, 2);
  assert.equal(s.back.length, 1);
});

test("study: a title set apart only by its spacing is a title; front matter ends where running text begins", () => {
  // a rebuilt PDF gives the first title its own style for its spacing
  const a = book("One", 3, 11);
  a.pstyles.push({ id: "ps-tt2", m: 1, name: "Story title +30", base: "ps-tt", sb: 30 });
  a.stories.find((st) => st.id === "st-c0").paras[0].ps = "ps-tt2";
  const s = H.study(M.normDoc(a));
  assert.equal(s.looks[s.roles.title].ps, "ps-tt");
  assert.equal(s.open.length, 3);
  assert.equal(s.front.length, 2);
  // a first chapter with no title at all: the front matter still ends at its text
  const b = book("Two", 3, 11);
  b.stories.find((st) => st.id === "st-c0").paras.shift();
  const t = H.study(M.normDoc(b));
  assert.equal(t.open.length, 2);
  assert.equal(t.front.length, 2);
});

test("learn: a house style document with the works' rules and the Greek set, applied", () => {
  const a = book("One", 3, 11), b = book("Two", 2, 11), c = book("Three", 2, 10.5);
  const res = H.learn([a, b, c], { now: 5, name: "Prose" });
  const d = res.doc, h = H.houseOf(d);
  assert.equal(d.name, "Prose");
  assert.equal(res.report.works, 3);
  assert.equal(h.from, 3);
  assert.equal(h.roles.title, "ps-tt");
  const codes = h.rules.map((r) => r.code);
  assert.ok(codes.includes("w.titleOdd"), codes.join());
  assert.ok(codes.includes("w.firstFlush"));
  assert.ok(codes.includes("w.bodyDiff"), "one book has another body size");
  H.GREEK.forEach((g) => assert.ok(codes.includes(g.code)));
  // the rules are in the styles
  const ps = (id) => M.find(d.pstyles, id);
  assert.equal(ps("ps-tt").ext.brk, "odd");
  assert.equal(ps("ps-tt").ext.kwn, 1);
  assert.equal(ps("ps-tb").ext.hyph, 1);
  assert.equal(ps("ps-tb").ext.orph, 2);
  assert.equal(ps("ps-tb").ext.wid, 2);
  // the pages: front matter, one empty body page, back matter
  const pages = M.pagesInOrder(d);
  assert.deepEqual(pages.map((p) => p.ext && p.ext.hs), ["front", "front", "body", "back"]);
  assert.equal(M.itemsOn(d, pages[2].id).length, 0);
  assert.equal(d.stories.length, 2);
  // Word placement maps to the house's styles (LY-WD)
  assert.deepEqual(d.setup.ext.wmap, { h1: "ps-tt", h2: "ps-tt", h3: "ps-tb", p1: "ps-tf", p: "ps-tb", center: "ps-sc", quote: "ps-tb", li: "ps-tb" });
  // a document Layout keeps as it is
  assert.deepEqual(M.normDoc(JSON.parse(JSON.stringify(d))), d);
  // the works themselves are untouched
  assert.equal(M.find(a.pstyles, "ps-tb").ext, undefined);
});

test("apply: a rule turned off takes its value back out; on again puts it back", () => {
  const d = H.learn([book("One", 2, 11), book("Two", 2, 11)], { now: 5 }).doc, h = H.houseOf(d);
  const odd = h.rules.find((r) => r.code === "w.titleOdd");
  odd.on = 0;
  assert.equal(H.apply(d, 9), 1);
  const tt = M.find(d.pstyles, "ps-tt");
  assert.equal(tt.ext.brk, undefined);
  assert.equal(tt.ext.kwn, 1);
  assert.equal(tt.m, 9);
  odd.on = 1;
  H.apply(d, 10);
  assert.equal(M.find(d.pstyles, "ps-tt").ext.brk, "odd");
  assert.equal(H.apply(d, 11), 0, "nothing left to change");
});

test("learn: a title set as body text with a bold, larger character style gets a Title style of its own", () => {
  const mk = (name) => {
    const d = book(name, 3, 11);
    d.cstyles.push({ id: "cs-big", m: 1, name: "Big", size: 13, b: 1 });
    d.stories.forEach((st) => st.paras.forEach((p) => { if (p.ps === "ps-tt") { p.ps = "ps-sc"; p.runs = p.runs.map((r) => Object.assign({}, r, { cs: "cs-big" })); } }));
    return M.normDoc(d);
  };
  const d = H.learn([mk("One"), mk("Two")], { now: 5, names: { title: "Title" } }).doc, h = H.houseOf(d);
  assert.equal(h.roles.title, "ps-hstitle");
  const tt = M.find(d.pstyles, "ps-hstitle");
  assert.deepEqual([tt.name, tt.base, tt.size, tt.b], ["Title", "ps-sc", 13, 1]);
  assert.equal(tt.ext.brk, "odd");
  assert.equal(tt.ext.hyph, 0);
  assert.equal(h.roles.center, "ps-sc");
});

test("learn: works with no text give nothing", () => {
  assert.equal(H.learn([M.newDoc({ name: "E", pages: 1 }, 1)], { now: 1 }), null);
});

test("fixText: Greek quotes, dashes, ellipses and spaces; the words stay", () => {
  const rules = H.GREEK.map((g, i) => ({ id: "r" + i, on: 1, a: g.a }));
  const paras = [
    { ps: "p", runs: [{ t: "- Πού πας; είπε \"ο \"μικρός\" γλάρος\"..." }] },
    { ps: "p", runs: [{ t: "Δύο  κενά - και " }, { t: "\"πλάγια\"", i: 1 }, { t: " εδώ." }] },
    { ps: "p", runs: [{ t: "Ήδη «σωστά» και “μέσα”." }] }
  ];
  const before = JSON.stringify(paras);
  const r = H.fixText(paras, rules);
  assert.equal(JSON.stringify(paras), before, "the input is not changed");
  const t = r.paras.map((p) => p.runs.map((x) => x.t).join(""));
  assert.deepEqual(t, ["— Πού πας; είπε «ο “μικρός” γλάρος»…", "Δύο κενά – και «πλάγια» εδώ.", "Ήδη «σωστά» και «μέσα»."]);
  assert.equal(r.paras[1].runs[1].i, 1);
  assert.deepEqual(r.n, { quotes: 8, dash: 2, ellipsis: 1, spaces: 1 });
  const letters = (s) => s.replace(/[^\p{L}]/gu, "");
  assert.deepEqual(t.map(letters), paras.map((p) => letters(p.runs.map((x) => x.t).join(""))));
  // rules off: nothing changes
  assert.deepEqual(H.fixText(paras, rules.map((x) => Object.assign({}, x, { on: 0 }))).paras, paras);
});

test("wiring: More › House style; both files load in Layout and are cached offline", () => {
  const html = fs.readFileSync(path.join(ROOT, "layout/index.html"), "utf8");
  assert.ok(html.indexOf('src="house.js') > html.indexOf('src="io.js') && html.indexOf('src="houseui.js') > html.indexOf('src="house.js'));
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.ok(sw.includes('"layout/house.js",') && sw.includes('"layout/houseui.js",'));
  assert.match(fs.readFileSync(path.join(ROOT, "layout/panels.js"), "utf8"), /t\("more\.house"\), fn: function \(\) \{ LY\.house\.open\(\); \}/);
  // every rule code has its text in EN and EL
  const ly = fs.readFileSync(path.join(ROOT, "layout/layout.js"), "utf8");
  ["w.titlePage", "w.titleOdd", "w.firstFlush", "w.sink", "w.bodyDiff", "w.sizeDiff"].concat(H.GREEK.map((g) => g.code)).forEach((c) => {
    assert.equal(ly.split('"hr.' + c + '"').length - 1, 2, c);
  });
});
