// orOS Layout — book intake (layout/intake.js, LY-IN): the questions
// asked before an automatic layout, the book sheet, and what each
// answer does to the new book; the engine's "even page" start and
// sunk openings (designkit/text.js); what the house style learns of
// page numbers and scene breaks (layout/house.js). Synthetic books and
// manuscripts only.
// Run: node --test tests/layout-intake.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { book, words } = require("./layout-books.js");
const M = require(path.join(ROOT, "designkit/model.js"));
const T = require(path.join(ROOT, "designkit/text.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const H = require(path.join(ROOT, "layout/house.js"));
const A = require(path.join(ROOT, "layout/autolay.js"));
const I = require(path.join(ROOT, "layout/intake.js"));
const W = require(path.join(ROOT, "layout/wordin.js"));

const text = (p) => p.runs.map((r) => (r.f ? "#" : r.t)).join("");

function house(opt) {
  opt = Object.assign({ isbn: true, toc: true, pn: true }, opt || {});
  return H.learn([book("Ένα", 3, 11, opt), book("Δύο", 3, 11, opt)], { now: 5, name: "Prose" }).doc;
}
// a manuscript with a dedication, two parts, scene breaks and the
// acknowledgements before the first chapter
function manuscript() {
  let html = "<h1>Αφιέρωση</h1><p>Στη μητέρα μου</p><h1>Ευχαριστίες</h1><p>" + words(40, 1) + "</p>";
  for (let c = 0; c < 4; c++) {
    if (c === 0) html += "<h1>Μέρος πρώτο</h1>";
    if (c === 2) html += "<h1>Μέρος δεύτερο</h1>";
    html += "<h1>Κεφάλαιο " + (c + 1) + "</h1><p>" + words(80, c) + "</p><p>Είπε \"ναι\".</p>";
    for (let k = 0; k < 4; k++) html += "<p>" + words(90, c + k) + "</p>";
    html += "<p>***</p><p>" + words(60, c + 2) + "</p>";
  }
  return W.parse(html);
}
// where each paragraph of the body story starts: page number, at the top
function starts(d) {
  const L = R.computeLayout(d), order = M.pagesInOrder(d), first = M.firstNumber(d);
  const h = H.houseOf(d);
  const body = d.stories.find((s) => s.paras.some((p) => p.ps === h.roles.title && /^Κεφάλαιο/.test(text(p))));
  const at = {};
  M.chain(d, body.id).forEach((f) => (L.frames[f.id] || { lines: [] }).lines.forEach((ln, k) => {
    if (at[ln.p] === undefined) at[ln.p] = { no: order.findIndex((p) => p.id === f.pg) + first, idx: order.findIndex((p) => p.id === f.pg), top: k === 0, y: ln.y };
  }));
  return { body, at, L, order };
}

// ---------- the engine ----------
function chainDoc(paras, n) {
  const d = M.newDoc({ name: "x", pages: n }, 1);
  d.setup.facing = 1;
  d.pstyles.push({ id: "ps-b", m: 1, name: "b", base: "ps-base", size: 10, lead: 12 },
    { id: "ps-ev", m: 1, name: "even", base: "ps-b", ext: { brk: "even" } },
    { id: "ps-sk", m: 1, name: "sunk", base: "ps-b", ext: { brk: "page", sink: 100 } });
  d.stories.push({ id: "st-a", m: 1, paras });
  M.pagesInOrder(d).forEach((p, i) => d.items.push({ id: "it-" + i, m: 1, t: "text", pg: p.id, x: 40, y: 40, w: 300, h: 500, story: "st-a", seq: i + 1, z: 1 }));
  return M.normDoc(d);
}
test("text: a paragraph may start on an even page", () => {
  const d = chainDoc([{ ps: "ps-b", runs: [{ t: "one" }] }, { ps: "ps-ev", runs: [{ t: "two" }] }, { ps: "ps-ev", runs: [{ t: "three" }] }], 5);
  const L = R.computeLayout(d);
  const on = (p) => [0, 1, 2, 3, 4].find((i) => L.frames["it-" + i].lines.some((ln) => ln.p === p));
  assert.equal(on(0), 0);
  assert.equal(on(1), 1);   // page 2
  assert.equal(on(2), 3);   // page 4: page 3 is odd
  assert.equal(T.resolvePs(T.byId(d.pstyles), "ps-ev").brk, "even");
});
test("text: a sunk opening starts lower at the top of a page, not inside it", () => {
  const d = chainDoc([{ ps: "ps-sk", runs: [{ t: "one" }] }, { ps: "ps-sk", runs: [{ t: "two" }] }], 2);
  const L = R.computeLayout(d);
  const plain = chainDoc([{ ps: "ps-b", runs: [{ t: "one" }] }], 1), P = R.computeLayout(plain);
  assert.ok(Math.abs(L.frames["it-0"].lines[0].y - P.frames["it-0"].lines[0].y - 100) < 0.01);
  assert.ok(Math.abs(L.frames["it-1"].lines[0].y - P.frames["it-0"].lines[0].y - 100) < 0.01);
  assert.equal(T.resolvePs(T.byId(d.pstyles), "ps-sk").sink, 100);
});

// ---------- learning ----------
test("house: page numbers set page by page go onto a body master; where and hidden on openings; the scene break", () => {
  const d = house(), h = H.houseOf(d);
  const bp = M.pagesInOrder(d).find((p) => p.ext && p.ext.hs === "body");
  assert.equal(bp.ms, "ms-hsbody");
  const pn = H.pnItems(d, "ms-hsbody");
  assert.deepEqual(pn.map((it) => it.side).sort(), ["L", "R"]);
  assert.deepEqual(h.pn, { at: "footC", hide: 1 });
  assert.equal(h.sep, "* * *");
  // the front pages keep their master, without numbers
  M.pagesInOrder(d).filter((p) => p.ext && p.ext.hs === "front").forEach((p) => assert.notEqual(p.ms, "ms-hsbody"));
});

// ---------- the questions ----------
test("info: what the manuscript and the series hold", () => {
  const hs = house(), s = A.structure(manuscript(), {});
  const inf = I.info(hs, s.list, s.cut);
  assert.equal(inf.parts, 2);
  assert.equal(inf.seps, 4);
  assert.equal(inf.sepText, "***");
  assert.equal(inf.ded, "Στη μητέρα μου");
  assert.deepEqual(inf.sections, { thanks: 1 });
  assert.equal(inf.series.size, "140×210");
  assert.equal(inf.series.start, "odd");
  assert.equal(inf.series.first, "flush");
  assert.equal(inf.series.pn, "footC");
  assert.equal(inf.series.pnHide, "hide");
  assert.equal(inf.series.toc, "start");
  assert.equal(inf.series.fix, "on");
  assert.ok(inf.colophon);
  assert.ok(inf.pages.some((p) => p.toc));
  assert.equal(inf.series.ty.body.size, 11);
  // sections and parts by their titles, in Greek with or without accents and in English
  assert.equal(I.sectionOf({ role: "h1", runs: [{ t: "ΕΥΧΑΡΙΣΤΙΕΣ" }] }), "thanks");
  assert.equal(I.sectionOf({ role: "h1", runs: [{ t: "Acknowledgements" }] }), "thanks");
  assert.equal(I.sectionOf({ role: "p", runs: [{ t: "Ευχαριστίες" }] }), "");
  assert.ok(I.isPart({ role: "h1", runs: [{ t: "ΜΕΡΟΣ Β΄" }] }));
  assert.ok(!I.isPart({ role: "h1", runs: [{ t: "Μέρος της ζωής μας που χάθηκε για πάντα στη θάλασσα" }] }));
});

test("defaults: the series' saved answers, never a book's dedication", () => {
  const hs = house();
  assert.deepEqual(I.defaults(hs), { v: 1, a: {}, ty: {}, drop: [] });
  hs.setup.ext.house.answers = { a: { start: "even" }, ty: { body: { size: 12 } } };
  const d = I.defaults(hs);
  assert.deepEqual(d.a, { start: "even" });
  assert.deepEqual(d.ty, { body: { size: 12 } });
});

// ---------- the answers ----------
test("build with a sheet: every answer as the series keeps the series' layout, plus its parts and dedication", () => {
  const hs = house(), list = manuscript();
  const res = A.build(hs, list, { title: "Νέο" }, { now: 9, sheet: { v: 1, a: {}, ty: {}, drop: [] } });
  const d = res.doc, rep = res.report, h = H.houseOf(d);
  assert.equal(rep.sheet, 1);
  const { body, at } = starts(d);
  // chapters on odd pages at the top, sunk as the series is
  body.paras.forEach((p, i) => { if (p.ps === h.roles.title) { assert.equal(at[i].no % 2, 1, text(p)); assert.ok(at[i].top); } });
  // parts on a page of their own (odd), the chapter after it on a new page
  const parts = body.paras.map((p, i) => [p, i]).filter(([p]) => p.ps === "ps-hspart");
  assert.deepEqual(parts.map(([p]) => text(p)), ["Μέρος πρώτο", "Μέρος δεύτερο"]);
  parts.forEach(([, i]) => { assert.equal(at[i].no % 2, 1); assert.ok(at[i + 1].no > at[i].no); });
  // the scene breaks as the series has them
  assert.equal(body.paras.filter((p) => p.ps === "ps-hssep").map(text).join("|"), "* * *|* * *|* * *|* * *");
  // the dedication on a right-hand page of its own before the text, not in the text
  assert.ok(!body.paras.some((p) => /μητέρα|Αφιέρωση/.test(text(p))));
  const dedSt = d.stories.find((s) => s.paras.some((p) => p.ps === "ps-hsded"));
  const dedIt = d.items.find((it) => it.story === dedSt.id), order = M.pagesInOrder(d);
  assert.equal(order.findIndex((p) => p.id === dedIt.pg) % 2, 0);
  assert.equal(order.find((p) => p.id === dedIt.pg).ext.hs, "front");
  assert.equal(text(dedSt.paras[0]), "Στη μητέρα μου");
  // the contents list the parts and the chapters
  const toc = d.stories.find((s) => s.ext && s.ext.hs === "toc");
  const entries = toc.paras.slice(1).map(text).map((t) => t.replace(/\t\d+$/, ""));
  assert.deepEqual(entries, ["Ευχαριστίες", "Μέρος πρώτο", "Κεφάλαιο 1", "Κεφάλαιο 2", "Μέρος δεύτερο", "Κεφάλαιο 3", "Κεφάλαιο 4"]);
  // pages where a title opens or that are empty have no page numbers
  assert.ok(rep.bare > 0);
  const L = R.computeLayout(d);
  order.forEach((pg, idx) => {
    if (!pg.ext || pg.ext.hs !== "body") return;
    const lines = d.items.filter((it) => it.pg === pg.id && it.t === "text").reduce((n, it) => n + ((L.frames[it.id] || { lines: [] }).lines.length), 0);
    const opens = Object.keys(at).some((i) => at[i].idx === idx && at[i].top && (body.paras[i].ps === h.roles.title || /^ps-hs(part|open)$/.test(body.paras[i].ps)));
    assert.equal(pg.ms === "ms-hsopen", !lines || opens, "page " + (idx + 1));
  });
  assert.equal(H.pnItems(d, "ms-hsopen").length, 0);
  assert.equal(H.pnItems(d, "ms-hsbody").length, 2);
  assert.deepEqual(d.setup.ext.book.a, {});
});

test("build with a sheet: the answers change the book", () => {
  const hs = house(), list = manuscript();
  const sheet = {
    v: 1, drop: [],
    a: { size: "170x240", start: "even", parts: "chap", sink: "top", first: "indent", sep: "⁂", pn: "headOut", pnHide: "show", pnStart: 3, toc: "end", hyph: "off", widows: "on", fix: "off", atThanks: "back" },
    ty: { body: { fam: "sans", size: 12, lead: 17, align: "l" }, title: { caps: 1, b: 1 } },
    ded: "", motto: "Λίγα λόγια"
  };
  const res = A.build(hs, list, { title: "Νέο" }, { now: 9, sheet, names: { part: "Part" } });
  const d = res.doc, h = H.houseOf(d), u = d.setup;
  assert.ok(Math.abs(u.w - 170 * 72 / 25.4) < 0.01 && Math.abs(u.h - 240 * 72 / 25.4) < 0.01);
  assert.equal(M.firstNumber(d), 3);
  const { body, at, order } = starts(d);
  // chapters and parts (as chapters) on even pages, at the very top
  const titles = body.paras.map((p, i) => [p, i]).filter(([p]) => p.ps === h.roles.title);
  assert.equal(titles.length, 7);
  titles.forEach(([p, i]) => { assert.equal(at[i].no % 2, 0, text(p)); assert.ok(at[i].top); });
  assert.ok(!d.pstyles.some((s) => s.id === "ps-hspart"));
  const P = T.byId(d.pstyles);
  assert.equal(T.resolvePs(P, h.roles.title).sink, 0);
  assert.ok(T.resolvePs(P, h.roles.first).fi > 0);
  // the scene break, the thanks at the end, no dedication, the motto
  assert.equal(body.paras.filter((p) => p.ps === "ps-hssep").map(text).join(""), "⁂⁂⁂⁂");
  assert.equal(text(body.paras[0]), "Μέρος πρώτο");
  const thanks = body.paras.findIndex((p) => text(p) === "Ευχαριστίες");
  assert.ok(thanks > titles[titles.length - 2][1]);
  assert.equal(body.paras[thanks + 1].ps, "ps-hsthanks");
  assert.ok(!d.stories.some((s) => s.paras.some((p) => /μητέρα/.test(text(p)))));
  assert.ok(d.stories.some((s) => s.paras.some((p) => p.ps === "ps-hsded" && text(p) === "Λίγα λόγια")));
  assert.equal(d.setup.ext.book.ded, "");
  // the contents at the end, after the text
  const toc = d.stories.find((s) => s.ext && s.ext.hs === "toc");
  const tocPg = order.findIndex((p) => p.id === d.items.find((it) => it.story === toc.id).pg);
  assert.equal(order[tocPg].ext.hs, "back");
  assert.ok(tocPg > Math.max(...Object.values(at).map((x) => x.idx)));
  // page numbers at the head, outer edge, on every body page
  const pn = H.pnItems(d, order.find((p) => p.ext && p.ext.hs === "body").ms);
  assert.equal(pn.length, 2);
  pn.forEach((it) => {
    assert.ok(it.y < u.mt);
    if (it.side === "R") assert.ok(it.x + it.w / 2 > u.w / 2); else assert.ok(it.x + it.w / 2 < u.w / 2);
  });
  assert.ok(!order.some((p) => p.ms === "ms-hsopen"));
  // typography and text
  const b = T.resolvePs(P, h.roles.body);
  assert.equal(b.font, "sans"); assert.equal(b.size, 12); assert.equal(b.lead, 17); assert.equal(b.align, "l");
  assert.equal(b.hyph, 0); assert.equal(b.orph, 2);
  assert.equal(T.resolvePs(P, h.roles.first).size, 12);
  const t = T.resolvePs(P, h.roles.title);
  assert.equal(t.caps, 1); assert.equal(t.b, 1);
  assert.ok(body.paras.some((p) => text(p) === "Είπε \"ναι\"."));
  assert.equal(res.report.moved, 1);
});

test("build with a sheet: no contents, pages left out, a contents made where the house has none", () => {
  const hs = house(), list = manuscript();
  const st = A.structure(list, {}), inf = I.info(hs, st.list, st.cut);
  const colophonPage = inf.pages.find((p) => p.text.startsWith("©"));
  let d = A.build(hs, list, {}, { now: 9, sheet: { v: 1, a: { toc: "none" }, ty: {}, drop: [colophonPage.id] } }).doc;
  assert.ok(!d.stories.some((s) => s.ext && s.ext.hs === "toc"));
  assert.ok(!d.pages.some((p) => p.id === colophonPage.id));
  assert.ok(!d.stories.some((s) => s.paras.some((p) => /\{isbn\}|ISBN/.test(text(p)))));
  // a house without contents: the answer makes one, with its heading
  const bare = house({ toc: false });
  d = A.build(bare, list, {}, { now: 9, sheet: { v: 1, a: { toc: "start" }, ty: { toc: { size: 9 } }, drop: [] }, tocHead: "Περιεχόμενα" }).doc;
  const toc = d.stories.find((s) => s.ext && s.ext.hs === "toc");
  assert.equal(text(toc.paras[0]), "Περιεχόμενα");
  assert.equal(toc.paras.length, 1 + 7);
  assert.ok(toc.paras.slice(1).every((p) => p.ps === "ps-hstoc" && /\t\d+$/.test(text(p))));
  assert.equal(T.resolvePs(T.byId(d.pstyles), "ps-hstoc").size, 9);
  const order = M.pagesInOrder(d), tp = order.find((p) => p.id === d.items.find((it) => it.story === toc.id).pg);
  assert.equal(tp.ext.hs, "front");
  assert.deepEqual(R.computeLayout(d).overset[toc.id], undefined);
});

test("build without a sheet: unchanged by the intake", () => {
  const hs = house(), list = manuscript();
  const res = A.build(hs, list, {}, { now: 9 });
  assert.equal(res.report.sheet, undefined);
  assert.ok(!res.doc.pstyles.some((s) => /^ps-hs(part|sep|ded|open)$/.test(s.id)));
  assert.ok(!res.doc.stories.some((s) => s.paras.some((p) => /μητέρα/.test(text(p)))));
  assert.ok(res.doc.stories.some((s) => s.paras.some((p) => text(p) === "Ευχαριστίες")));
});

// ---------- pictures (wave Q2) ----------
const HEX = (c) => c.repeat(64) + ".jpg";
// a manuscript with pictures: one before the second chapter's text with
// an italic caption after it, one inside the third chapter
function picManuscript() {
  let html = "";
  for (let c = 0; c < 4; c++) {
    html += "<h1>Κεφάλαιο " + (c + 1) + "</h1>";
    if (c === 1) html += "<p><img src=\"data:image/jpeg;base64,AAAA\" alt=\"harbour.jpg\"></p><p><em>Το λιμάνι, νωρίς.</em></p>";
    html += "<p>" + words(80, c) + "</p>";
    for (let k = 0; k < 4; k++) {
      html += "<p>" + words(90, c + k) + "</p>";
      if (c === 2 && k === 1) html += "<p><img src=\"data:image/png;base64,BBBB\" alt=\"\"></p>";
    }
  }
  const list = W.parse(html, { pics: 1 });
  let k = 0;
  list.forEach((p) => { if (p.role === "img") { p.a = HEX(k ? "b" : "a"); p.nm = k ? "two.png" : "harbour.jpg"; p.iw = 800; p.ih = 600; k++; } });
  return list;
}
const imgs = (d) => d.items.filter((it) => it.t === "img");
const pageNo = (d, id) => M.pagesInOrder(d).findIndex((p) => p.id === id) + M.firstNumber(d);

test("wordin: pictures stay where they were only when asked, and leave no empty paragraph", () => {
  const html = "<p>Ένα</p><p><img src=\"data:image/png;base64,AA\" alt=\"Φάρος\"></p><p>Δύο</p>";
  assert.deepEqual(W.parse(html).map((p) => p.role), ["p1", "p", "p1"]);   // as before: the picture's paragraph, empty
  const l = W.parse(html, { pics: 1 });
  assert.deepEqual(l.map((p) => p.role), ["p1", "img", "p"]);
  assert.equal(l[1].alt, "Φάρος");
  assert.equal(l[1].src, "data:image/png;base64,AA");
});

test("pictures: each goes with the paragraph after it; an italic short line after it is its caption", () => {
  const px = I.pictures(picManuscript());
  assert.equal(px.pics.length, 2);
  assert.equal(px.pics[0].cap, "Το λιμάνι, νωρίς.");
  assert.equal(px.pics[1].cap, undefined);
  assert.ok(!px.list.some((p) => p.role === "img"));
  const cap = px.list.find((p) => p.capOf);
  assert.deepEqual(cap.pics, [0]);
  // as the series (the caption from the paragraph): the caption leaves the text
  const s = A.structure(px.list, {}), inf = I.info(house(), s.list, s.cut);
  assert.equal(inf.pics, 2);
  const mk = I.mark(s.list, { a: {} }, inf);
  assert.equal(mk.caps, 1);
  assert.ok(!mk.list.some((p) => p.runs.map((r) => r.t).join("") === "Το λιμάνι, νωρίς."));
  assert.deepEqual(mk.list.filter((p) => p.pics).map((p) => p.pics), [[0], [1]]);
  // the caption from the file name: the line stays text
  assert.equal(I.mark(s.list, { a: { capSrc: "file" } }, inf).caps, 0);
});

test("house: learns where the series puts its pictures", () => {
  const h = H.learn([book("Ένα", 3, 11, { isbn: true, toc: true, pn: true, photo: true }), book("Δύο", 3, 11, { isbn: true, toc: true, pn: true, photo: true })], { now: 5 });
  assert.deepEqual(H.houseOf(h.doc).pics, { at: "page", size: "text", cap: "below" });
});

test("pictures on a page of their own: before the chapter, facing its right-hand opening, with the caption", () => {
  const hs = house(), res = A.build(hs, picManuscript(), {}, { now: 9, sheet: { a: { picAt: "page" } } });
  const d = res.doc, h = H.houseOf(d), one = imgs(d).find((it) => it.a === HEX("a")), two = imgs(d).find((it) => it.a === HEX("b"));
  assert.equal(res.report.placed, 2);
  assert.equal(res.report.overset, false);
  const { body, at } = starts(d);
  const ch2 = body.paras.findIndex((p) => text(p) === "Κεφάλαιο 2");
  // the first picture on the even page right before chapter 2's odd opening
  assert.equal(pageNo(d, one.pg) % 2, 0);
  assert.equal(pageNo(d, one.pg) + 1, at[ch2].no);
  assert.equal(at[ch2].no % 2, 1);
  assert.ok(at[ch2].top);
  // every chapter still opens on a right-hand page at the top
  body.paras.forEach((p, i) => { if (p.ps === h.roles.title) { assert.equal(at[i].no % 2, 1, text(p)); assert.ok(at[i].top); } });
  // the caption below it, in the caption style; no number on the picture's page
  const cap = d.items.find((it) => it.t === "text" && it.pg === one.pg);
  const cst = d.stories.find((s) => s.id === cap.story);
  assert.equal(text(cst.paras[0]), "Το λιμάνι, νωρίς.");
  assert.equal(cst.paras[0].ps, "ps-hscap");
  assert.ok(cap.y > one.y + one.h);
  assert.equal(M.pagesInOrder(d).find((p) => p.id === one.pg).ms, "ms-hsopen");
  // within the text width, the picture's proportions
  assert.ok(Math.abs(one.w / one.h - 800 / 600) < 0.01);
  const m = M.margins(d, "L");
  assert.ok(one.x >= m.l - 0.01 && one.x + one.w <= d.setup.w - m.r + 0.01);
  // the second picture before the page its paragraph is on; no caption
  assert.ok(!d.items.some((it) => it.t === "text" && it.pg === two.pg));
  assert.ok(!body.paras.some((p) => text(p) === "Το λιμάνι, νωρίς."));
});

test("pictures before the text: at the top of the page, the title below; full-page pictures fill to the bleed", () => {
  const hs = house();
  let d = A.build(hs, picManuscript(), {}, { now: 9, sheet: { a: { picAt: "before", cap: "none" } } }).doc;
  const { body, at } = starts(d), one = imgs(d).find((it) => it.a === HEX("a"));
  const ch2 = body.paras.findIndex((p) => text(p) === "Κεφάλαιο 2");
  assert.equal(pageNo(d, one.pg), at[ch2].no);
  assert.equal(one.wrap, "box");
  assert.ok(Math.abs(one.y - d.setup.mt) < 0.01);
  const frame = d.items.find((it) => it.pg === one.pg && it.t === "text");
  assert.ok(frame.y + at[ch2].y > one.y + one.h, "the title starts below the picture");
  assert.equal(d.items.filter((it) => it.t === "text" && it.pg === one.pg).length, 1);
  // full page
  d = A.build(hs, picManuscript(), {}, { now: 9, sheet: { a: { picAt: "page", picSize: "page" } } }).doc;
  const f = imgs(d)[0], b = d.setup.bleed;
  assert.deepEqual([f.x, f.y, f.w, f.h].map((v) => Math.round(v * 100) / 100), [-b, -b, d.setup.w + 2 * b, d.setup.h + 2 * b].map((v) => Math.round(v * 100) / 100));
});

test("pictures one by one, and pictures from outside the manuscript", () => {
  const hs = house(), extra = [{ a: HEX("c"), nm: "boat.jpg", iw: 600, ih: 800 }, { a: HEX("d"), nm: "net.jpg", iw: 800, ih: 800 }];
  // the first left out, the second on a page; typed captions
  let res = A.build(hs, picManuscript(), {}, { now: 9, sheet: { a: { picAt: "each", capSrc: "typed" }, pics: [{ at: "out" }, { at: "page", cap: "Δίχτυα" }, {}, { cap: "Βάρκα" }] }, extra });
  let d = res.doc;
  assert.equal(res.report.placed, 3);
  assert.equal(res.report.pictures, 1);
  assert.ok(!imgs(d).some((it) => it.a === HEX("a")));
  const capOf = (it) => { const c = d.items.find((x) => x.t === "text" && x.pg === it.pg && x.story !== undefined && d.stories.find((s) => s.id === x.story).paras[0].ps === "ps-hscap"); return c ? text(d.stories.find((s) => s.id === c.story).paras[0]) : ""; };
  assert.equal(capOf(imgs(d).find((it) => it.a === HEX("b"))), "Δίχτυα");
  assert.equal(capOf(imgs(d).find((it) => it.a === HEX("d"))), "Βάρκα");
  // outside pictures at the end: after the last text page, before the back matter
  const order = M.pagesInOrder(d), boat = order.findIndex((p) => p.id === imgs(d).find((it) => it.a === HEX("c")).pg);
  const { at } = starts(d);
  assert.ok(boat > Math.max(...Object.values(at).map((x) => x.idx)));
  assert.equal(order[order.length - 1].ext.hs, "back");
  // after chapter 2: before chapter 3's opening, with its side kept
  res = A.build(hs, picManuscript(), {}, { now: 9, sheet: { a: { extraAt: "after1" } }, extra });
  d = res.doc;
  const s2 = starts(d), ch3 = s2.body.paras.findIndex((p) => text(p) === "Κεφάλαιο 3");
  const boatNo = pageNo(d, imgs(d).find((it) => it.a === HEX("c")).pg), netNo = pageNo(d, imgs(d).find((it) => it.a === HEX("d")).pg);
  assert.equal(netNo + 1, s2.at[ch3].no);
  assert.equal(boatNo + 1, netNo);
  assert.equal(s2.at[ch3].no % 2, 1);
  // the sheet keeps the answers, the pictures' own ones too
  assert.equal(d.setup.ext.book.a.extraAt, "after1");
});

// ---------- Q4: pictures in the flow, running heads (LY-RH) ----------
test("pictures in the text: where their paragraph starts, across the text width, the text going on below", () => {
  const hs = house(), res = A.build(hs, picManuscript(), {}, { now: 9, sheet: { a: { picAt: "flow", cap: "none" } } });
  const d = res.doc;
  assert.equal(res.report.placed, 2);
  assert.equal(res.report.overset, false);
  const { body, at, L } = starts(d), two = imgs(d).find((it) => it.a === HEX("b"));
  const frame = d.items.find((it) => it.pg === two.pg && it.t === "text" && it.story === body.id);
  assert.ok(frame, "on a page of the running text");
  assert.equal(two.wrap, "box");
  assert.equal(two.fit, "fit");
  assert.ok(Math.abs(two.x - frame.x) < 0.01 && Math.abs(two.w - frame.w) < 0.01, "the frame spans the text, no text beside it");
  // text above it on its page ends before it; the next paragraph starts below it
  const lines = (L.frames[frame.id] || { lines: [] }).lines;
  const above = lines.filter((ln) => frame.y + ln.y < two.y), below = lines.filter((ln) => frame.y + ln.y > two.y + two.h);
  assert.ok(above.length > 0, "inside the page's text, after the paragraph before it");
  assert.ok(lines.every((ln) => frame.y + ln.y + ln.d < two.y - 1 || frame.y + ln.y > two.y + two.h), "no line through the picture");
  assert.ok(below.length > 0 || above.length > 0);
  // the paragraph it belongs to starts after the last line above it
  if (above.length) {
    const last = above[above.length - 1], next = lines[lines.indexOf(last) + 1];
    if (next) assert.ok(frame.y + next.y > two.y + two.h, "the text goes on below the picture");
  }
  // every chapter still opens at the top of a right-hand page
  const h = H.houseOf(d);
  body.paras.forEach((p, i) => { if (p.ps === h.roles.title) { assert.equal(at[i].no % 2, 1, text(p)); assert.ok(at[i].top); } });
  assert.ok(I.PIC_AT.includes("flow") && I.QUESTIONS.find((q) => q.id === "picAt").v.includes("flow"));
});

test("running heads: the book's title left, the chapter's right, none on chapter openings; author and title; none", () => {
  const hs = house();
  let res = A.build(hs, manuscript(), { title: "Το βιβλίο", author: "Α. Β." }, { now: 9, sheet: { a: { rh: "titleChap", pn: "footC" } }, names: { rh: "Running head", rhL: "RH L", rhR: "RH R" } });
  let d = res.doc;
  const h = H.houseOf(d), heads = d.items.filter((it) => it.ext && it.ext.rh);
  assert.equal(heads.length, 2);
  assert.deepEqual(heads.map((it) => it.side).sort(), ["L", "R"]);
  const ms = heads[0].pg;
  assert.ok(heads.every((it) => it.pg === ms && it.y + it.h <= M.margins(d, it.side).t + 0.01), "in the head margin");
  const st = (it) => d.stories.find((s) => s.id === it.story);
  const left = heads.find((it) => it.side === "L"), right = heads.find((it) => it.side === "R");
  assert.equal(text(st(left).paras[0]), "Το βιβλίο");
  assert.equal(st(right).paras[0].runs[0].ext.fld, "sec");
  assert.equal(d.pstyles.find((s) => s.id === h.roles.title).ext.sec, 1);
  // what a right-hand page of chapter 2 shows: its chapter, on the
  // left-hand pages the book's title; never on an opening page
  const L = R.computeLayout(d), order = M.pagesInOrder(d), { body, at } = starts(d);
  const ch2 = body.paras.findIndex((p) => text(p) === "Κεφάλαιο 2"), ch3 = body.paras.findIndex((p) => text(p) === "Κεφάλαιο 3");
  const shows = (idx, it) => ((L.master[order[idx].id] || {})[it.id] || { lines: [] }).lines.map((ln) => ln.runs.map((r) => r.t).join("")).join("");   // words only, spaces are not runs
  let seenR = 0, seenL = 0;
  for (let i = at[ch2].idx + 1; i < at[ch3].idx; i++) {
    if (order[i].ms !== ms) continue;
    if (M.sideOf(d, i) === "R") { assert.equal(shows(i, right), "Κεφάλαιο 2"); seenR++; }   // the field is one piece
    else { assert.equal(shows(i, left), "Τοβιβλίο"); seenL++; }
  }
  assert.ok(seenR + seenL > 0, "chapter 2 has pages after its opening");
  assert.notEqual(order[at[ch2].idx].ms, ms, "the opening page has no running head");
  assert.ok(!d.items.some((it) => it.pg === order[at[ch2].idx].ms && it.ext && it.ext.rh));
  // an older orOS keeps the run's text (and its ext) through normalising
  const n = M.normDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(n.stories.find((s) => s.id === right.story).paras[0].runs[0], { t: "Το βιβλίο", ext: { fld: "sec" } });
  // author and title; a detail the book does not give stays empty
  d = A.build(hs, manuscript(), { title: "Το βιβλίο" }, { now: 9, sheet: { a: { rh: "authorTitle" } } }).doc;
  const hd = d.items.filter((it) => it.ext && it.ext.rh), tx = (side) => text(d.stories.find((s) => s.id === hd.find((it) => it.side === side).story).paras[0] || { runs: [] });
  assert.equal(tx("L"), "");
  assert.equal(tx("R"), "Το βιβλίο");
  // none: no heads; as in the series: the series' (none here)
  d = A.build(hs, manuscript(), {}, { now: 9, sheet: { a: { rh: "none" } } }).doc;
  assert.ok(!d.items.some((it) => it.ext && it.ext.rh));
  assert.equal(I.info(hs, manuscript(), []).series.rh, "none");
});

test("pictures: one in every chapter all go in, also after earlier ones pushed the text on", () => {
  let html = "";
  for (let c = 0; c < 4; c++) {
    html += "<h1>Κεφάλαιο " + (c + 1) + "</h1><p>" + words(80, c) + "</p>";
    for (let k = 0; k < 4; k++) { html += "<p>" + words(90, c + k) + "</p>"; if (k === 1) html += "<p><img src=\"data:image/png;base64,AAAA\" alt=\"p.jpg\"></p>"; }
  }
  for (const at of ["flow", "before", "page"]) {
    const list = W.parse(html, { pics: 1 });
    let k = 0;
    list.forEach((p) => { if (p.role === "img") { p.a = HEX("abcd"[k]); p.iw = 800; p.ih = 500; k++; } });
    const r = A.build(house(), list, {}, { now: 9, sheet: { a: { picAt: at } } });
    assert.equal(r.report.placed, 4, at);
    assert.equal(r.report.pictures, 0, at);
    assert.equal(r.report.overset, false, at);
  }
});
