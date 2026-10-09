// Slides -> designkit (slides/dk.js): one page per slide, theme
// colours resolved, empty placeholders invisible, bullets with levels
// and numbering, shrink to fit checked against the real typesetter
// (Noto metrics), footer rules, the A4 handout with notes, a vector
// PDF smoke test; the .orosslides package reader (fresh ids, garbage
// dropped) and the app's EN/EL string coverage.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

// core.js + dk.js in one context with the designkit modules on it
const ctx = { orosDK: { model: M, text: T } };
vm.createContext(ctx);
["slides/core.js", "slides/dk.js"].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx));
const C = ctx.OrosSlidesCore, D = ctx.OrosSlidesDK;
const j = (x) => JSON.parse(JSON.stringify(x));

function ids(prefix) {
  let n = 0;
  return () => prefix + String(++n).padStart(4, "0");
}
function sample() {
  const d = C.emptyData(), nid = ids("x");
  const deck = C.fromTemplate(d, "report", "el", 1000, nid);
  return { d, deck, nid, slides: C.deckSlides(d, deck.id) };
}

test("dk: one designkit page per slide, every id valid, normDoc keeps everything", () => {
  const { d, deck, slides } = sample();
  const out = D.build(d, deck.id, slides.map((s) => s.id), {});
  assert.equal(out.doc.pages.length, slides.length);
  assert.equal(out.pages.length, slides.length);
  assert.deepEqual(j(out.pages.map((p) => p.slide)), j(slides.map((s) => s.id)));
  // normDoc drops anything invalid: nothing may be lost
  const again = M.normDoc(JSON.parse(JSON.stringify(out.doc)));
  assert.equal(again.items.length, out.doc.items.length);
  assert.equal(again.stories.length, out.doc.stories.length);
  // 16:9 = 960 x 540 pt
  assert.ok(Math.abs(out.doc.setup.w - 1778 * D.PT) < 0.01 && Math.abs(out.doc.setup.h - 540) < 0.01);
});

test("dk: theme colours resolve, a theme change recolours, empty placeholders draw nothing", () => {
  const { d, deck, nid } = sample();
  const s = C.addSlide(d, deck.id, "imgtext", null, 2000, nid);   // empty picture + body
  let out = D.build(d, deck.id, [s.id], {});
  const bg = out.doc.items.find((it) => it.z === -2);
  assert.equal(bg.fill, "sw-" + C.themeById("paper").c.bg.slice(1));
  // title, body (empty), picture (empty): only the background is drawn
  assert.equal(out.doc.items.length, 1);
  d.decks[deck.id].th = "dark";
  out = D.build(d, deck.id, [s.id], {});
  assert.equal(out.doc.items[0].fill, "sw-" + C.themeById("dark").c.bg.slice(1));
});

test("dk: bullets, levels, numbering and run colours reach the typesetter", () => {
  const { d, deck, slides } = sample();
  const body = C.placeholder(d, slides[2].id, "body");
  C.setItemParas(d, body.id, [
    { l: 0, ls: "n", r: [{ t: "one" }] },
    { l: 1, ls: "b", r: [{ t: "sub", c: "t:a1" }] },
    { l: 0, ls: "n", r: [{ t: "two", b: true }] },
    { l: 0, ls: "", r: [{ t: "plain" }] },
    { l: 0, ls: "n", r: [{ t: "again" }] }
  ], 3000);
  const out = D.build(d, deck.id, [slides[2].id], {});
  const st = out.doc.stories.find((x) => x.paras.some((p) => p.runs.some((r) => r.t === "sub")));
  const texts = st.paras.map((p) => p.runs.map((r) => r.t).join(""));
  assert.deepEqual(j(texts), ["1. one", "sub", "2. two", "plain", "1. again"], "numbering restarts after another paragraph");
  const ps = (id) => out.doc.pstyles.find((x) => x.id === id);
  assert.equal(ps(st.paras[1].ps).bul, 1);
  assert.ok(ps(st.paras[1].ps).li > 0 && ps(st.paras[1].ps).size < ps(st.paras[0].ps).size, "a deeper level is indented and smaller");
  const sub = st.paras[1].runs[0];
  assert.ok(sub.cs && out.doc.cstyles.find((c) => c.id === sub.cs).color === "sw-" + C.themeById("paper").c.a1.slice(1));
  const L = R.computeLayout(out.doc);
  assert.equal(Object.keys(L.overset).length, 0);
});

test("dk: shrink to fit makes long text fit; switched off it reports overset", () => {
  const { d, deck, slides } = sample();
  const body = C.placeholder(d, slides[2].id, "body");
  const many = Array.from({ length: 24 }, (_, i) => ({ l: i % 2, ls: "b", r: [{ t: "Γραμμή κειμένου με αρκετές λέξεις " + i }] }));
  C.setItemParas(d, body.id, many, 3000);
  const th = C.themeById(d.decks[deck.id].th);
  const f = D.fitOf(d.items[body.id], th);
  assert.ok(f.k < 1 && f.k >= D.MIN_FIT && !f.over, JSON.stringify(f));
  let out = D.build(d, deck.id, [slides[2].id], {});
  assert.equal(Object.keys(R.computeLayout(out.doc).overset).length, 0, "the shrunk text fits in the layout pass too");
  d.items[body.id].fit = false;
  assert.equal(D.fitOf(d.items[body.id], th).over, true);
  out = D.build(d, deck.id, [slides[2].id], {});
  assert.equal(Object.keys(R.computeLayout(out.doc).overset).length, 1);
});

test("dk: footer number / date / text, the first slide only when asked", () => {
  const { d, deck, slides } = sample();
  d.decks[deck.id].ft = { n: true, d: true, x: "orOS", s1: false };
  function footTexts(sid) {
    const out = D.build(d, deck.id, [sid], { date: "09/10/2026" });
    return out.doc.stories.map((s) => s.paras.map((p) => p.runs.map((r) => r.t).join("")).join("|"))
      .filter((x) => x === "09/10/2026" || x === "orOS" || /^\d+$/.test(x)).sort();
  }
  assert.deepEqual(j(footTexts(slides[0].id)), []);
  assert.deepEqual(j(footTexts(slides[1].id)), ["09/10/2026", "2", "orOS"]);
  d.decks[deck.id].ft.s1 = true;
  assert.deepEqual(j(footTexts(slides[0].id)), ["09/10/2026", "1", "orOS"]);
});

test("dk: pictures keep their aspect (fill crops, fit letterboxes), lines straighten", () => {
  const it = { img: { pw: 2000, ph: 1000, fit: "fill", zm: 100, ox: 0, oy: 0 } };
  let g = D.imageGeom(it, 100, 100);
  assert.ok(Math.abs(2000 * g.isc - 200) < 1e-6 && Math.abs(g.ix + 50) < 1e-6 && Math.abs(g.iy) < 1e-6);
  it.img.ox = 100;
  g = D.imageGeom(it, 100, 100);
  assert.ok(Math.abs(g.ix + 100) < 1e-6, "offset 100 shows the right edge");
  it.img = { pw: 2000, ph: 1000, fit: "fit", zm: 100, ox: 0, oy: 0 };
  g = D.imageGeom(it, 100, 100);
  assert.ok(Math.abs(2000 * g.isc - 100) < 1e-6 && Math.abs(g.iy - 25) < 1e-6);

  const { d, deck, nid } = sample();
  const s = C.addSlide(d, deck.id, "blank", null, 2000, nid);
  const ln = C.normItem({ id: nid(), m: 2000, s: s.id, k: "line", x: 100, y: 500, w: 600, h: 2, st: "t:fg", sw: 6 });
  d.items[ln.id] = ln;
  const out = D.build(d, deck.id, [s.id], {});
  const line = out.doc.items.find((x) => x.t === "line");
  assert.equal(line.h, 0);
});

test("dk: handout = A4 portrait, the slide on top and its notes below", () => {
  const { d, deck, slides } = sample();
  C.setNotes(d, slides[1].id, "Πρώτη σημείωση\nΔεύτερη", 3000);
  const out = D.build(d, deck.id, [slides[1].id], { handout: true });
  assert.ok(Math.abs(out.doc.setup.w - 595.276) < 0.01 && Math.abs(out.doc.setup.h - 841.89) < 0.01);
  const notes = out.doc.stories.find((s) => s.paras.some((p) => p.runs.some((r) => r.t === "Πρώτη σημείωση")));
  assert.ok(notes);
  const frame = out.doc.items.find((it) => it.story === notes.id);
  const bg = out.doc.items.find((it) => it.z === -2);
  assert.ok(frame.y > bg.y + bg.h, "notes under the slide");
});

test("dk: a vector PDF, one page per slide, fonts embedded", () => {
  global.window = global.window || global;
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const { d, deck, slides } = sample();
  const out = D.build(d, deck.id, slides.map((s) => s.id), { date: "x" });
  const pdf = P.build(out.doc, { title: "t" }, { jsPDF });
  assert.equal(pdf.getNumberOfPages(), slides.length);
  const raw = Buffer.from(pdf.output("arraybuffer")).toString("latin1");
  assert.ok(raw.startsWith("%PDF-") && /FontFile2/.test(raw));
});

// ---------- package reader (io.js) ----------
test("package: opened as a new deck with fresh ids; foreign or broken entries dropped", () => {
  const src = fs.readFileSync(path.join(ROOT, "slides/io.js"), "utf8");
  const i = src.indexOf("  function readPackage("), k = src.indexOf("\n  SL.readPackage", i);
  const readPackage = new Function("C", "PKG_KIND", "PKG_VER", src.slice(i, k) + "\nreturn readPackage;")(C, "oros-slides-package", 1);
  const { d, deck, slides } = sample();
  const items = [];
  slides.forEach((s) => items.push(...C.slideItems(d, s.id)));
  const pkg = j({ kind: "oros-slides-package", ver: 1, deck: d.decks[deck.id], slides: slides, items: items });
  pkg.items.push({ id: "evil-1", m: 1, s: slides[0].id, k: "script", src: "javascript:alert(1)" });
  pkg.slides.push({ id: "other-1", m: 1, d: "another-deck", p: "z" });
  const p = readPackage(pkg, 9000, ids("n"));
  assert.equal(p.slides.length, slides.length);
  assert.equal(p.items.length, items.length);
  assert.notEqual(p.deck.id, deck.id);
  const old = new Set([deck.id, ...slides.map((s) => s.id), ...items.map((x) => x.id)]);
  assert.ok(p.slides.every((s) => !old.has(s.id) && s.d === p.deck.id && s.m === 9000));
  assert.ok(p.items.every((x) => !old.has(x.id) && p.slides.some((s) => s.id === x.s)));
  assert.equal(readPackage({ kind: "something-else", ver: 1, deck: pkg.deck }, 1, ids("q")), null);
  // the result merges into a store as a normal, canonical deck
  const store = C.emptyData();
  store.decks[p.deck.id] = p.deck;
  p.slides.forEach((s) => { store.slides[s.id] = s; });
  p.items.forEach((x) => { store.items[x.id] = x; });
  const canon = C.canonical(store);
  assert.equal(C.deckSlides(canon, p.deck.id).length, slides.length);
  assert.equal(C.formatOutline(canon, p.deck.id), C.formatOutline(d, deck.id));
});

// ---------- strings ----------
test("i18n: every key the app uses exists in English and Greek", () => {
  const src = fs.readFileSync(path.join(ROOT, "slides/app.js"), "utf8");
  const i = src.indexOf("  var STRINGS = {"), k = src.indexOf("\n  };\n", i);
  const STRINGS = new Function("return " + src.slice(i + "  var STRINGS = ".length, k + 4).replace(/;\s*$/, ""))();
  const en = Object.keys(STRINGS.en).sort(), el = Object.keys(STRINGS.el).sort();
  assert.deepEqual(el, en, "same keys in both languages");
  const used = new Set();
  ["app.js", "editor.js", "text.js", "panels.js", "io.js", "index.html"].forEach((f) => {
    const s = fs.readFileSync(path.join(ROOT, "slides", f), "utf8");
    for (const m of s.matchAll(/\bt\("([a-zA-Z0-9.]+)"/g)) used.add(m[1]);
    for (const m of s.matchAll(/data-i18n="([a-zA-Z0-9.]+)"/g)) used.add(m[1]);
  });
  // keys built at run time
  C.ROLES.forEach((r) => used.add("ph." + r));
  C.TRANSITIONS.forEach((x) => used.add("tr." + x));
  ["slide", "sorter", "outline"].forEach((v) => used.add("view." + v));
  ["bg", "fg", "mu", "sf", "a1", "a2", "a3"].forEach((r) => used.add("col." + r));
  ["l", "c", "r", "j"].forEach((x) => used.add("al." + x));
  ["t", "m", "b"].forEach((x) => used.add("va." + x));
  ["al", "ac", "ar", "at", "am", "ab"].forEach((x) => used.add("pn." + x));
  const missing = [...used].filter((x) => !x.endsWith(".") && !(x in STRINGS.en));
  assert.deepEqual(missing, []);
});
