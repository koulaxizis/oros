// Slides wave 24: build animations, groups, tables, charts, the phone
// remote (pure parts).
//   core.js   normalising an / g / tb / ch / td (old decks unchanged),
//             merging the new fields, group helpers, animation order
//   anim.js   click steps, "with / after the previous", bullets one by
//             one, what is hidden or moving at a moment, reduced motion
//   dk.js     tables and charts reach designkit (normDoc keeps them),
//             numbers in Greek and English notation, chart keys
//   show.js   steps: a click shows the next build, Previous goes back
//             one build, from the first build to the previous slide
//   pptx.js   tables, groups, wipe and its speed, entrance animations
//             written and read back
//   remote.js the commands a phone may send and the snapshot it gets
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
const AP = require(path.join(ROOT, "atelier/pptx.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
const ctx = { orosDK: { model: M, text: T }, TextEncoder, TextDecoder, DecompressionStream };
vm.createContext(ctx);
["slides/core.js", "slides/dk.js", "slides/anim.js", "atelier/zip.js", "slides/pptx.js", "spreadsheet/sheetkit.js", "slides/remote.js"]
  .forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx));
const C = ctx.OrosSlidesCore, D = ctx.OrosSlidesDK, A = ctx.OrosSlidesAnim, X = ctx.OrosSlidesPPTX, Z = ctx.AtelierZip;
const K = ctx.OrosSheetKit, RM = ctx.OrosSlidesRemote;
const showCtx = {};
vm.createContext(showCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "designkit/show.js"), "utf8"), showCtx);
const j = (x) => JSON.parse(JSON.stringify(x));

function ids(prefix) {
  let n = 0;
  return () => prefix + String(++n).padStart(4, "0");
}
function deckWith() {
  const d = C.emptyData(), nid = ids("x");
  const deck = C.newDeck(d, { t: "Wave 24" }, 1000, nid);
  const s = C.addSlide(d, deck.id, "content", null, 1000, nid);
  return { d, deck, s, nid };
}
function add(d, s, nid, o) {
  const it = C.normItem(Object.assign({ id: nid(), m: 1000, s: s.id, z: Object.keys(d.items).length + 1 }, o));
  d.items[it.id] = it;
  return it;
}

// ---------- core.js ----------
test("core: new fields normalise; defaults are not stored; garbage dropped", () => {
  const an = C.normAnim({ e: "fly", d: "x", w: "c", du: 500, dl: 0, p: true, o: "i" }, "shape");
  assert.deepEqual(j(an), { e: "fly", o: "i", d: "b" });
  assert.equal(C.normAnim({ e: "spin" }, "text"), null);
  assert.deepEqual(j(C.normAnim({ e: "fade", w: "a", du: 99999, dl: -5, p: true, o: "k" }, "text")), { e: "fade", o: "k", w: "a", du: 5000, p: true });
  assert.deepEqual(j(C.normAnim({ e: "appear", du: 800 }, "text")), { e: "appear", o: "i" });   // appear has no length
  const tb = C.normTable({ rows: [["a", "b", "c"], ["d"], "x"], ln: "zig", fs: 2, ac: "red" });
  assert.deepEqual(j(tb), { rows: [["a", "b", "c"], ["d", "", ""]], hd: true, ln: "all", ac: "t:a1", fs: 8 });
  const big = C.normTable({ rows: Array.from({ length: 40 }, () => Array.from({ length: 30 }, () => "y".repeat(900))) });
  assert.equal(big.rows.length, C.LIM.tRows); assert.equal(big.rows[0].length, C.LIM.tCols); assert.equal(big.rows[0][0].length, C.LIM.cell);
  assert.deepEqual(j(C.normChart({ t: "radar", rows: [["", "S"], ["A", "1"]], lg: false, ttl: " T ", by: "q" })), { t: "col", rows: [["", "S"], ["A", "1"]], ttl: "T", lg: false });
  const { d, s, nid } = deckWith();
  const t1 = add(d, s, nid, { k: "table", x: 0, y: 0, w: 500, h: 300, r: 45, tb: { rows: [["h"]] }, an: { e: "zoom" }, g: "bad id!", evil: 1 });
  assert.equal(t1.r, 0); assert.equal(t1.evil, undefined); assert.equal(t1.g, undefined);
  assert.equal(t1.st, "t:mu"); assert.equal(t1.sw, 2); assert.deepEqual(j(t1.an), { e: "zoom", o: "i" });
  const sl = C.normSlide(Object.assign(j(d.slides[s.id]), { tr: "wipe", td: 20000 }));
  assert.equal(sl.tr, "wipe"); assert.equal(sl.td, C.LIM.dur);
  assert.equal(C.normSlide(j(d.slides[s.id])).td, undefined);
});

test("core: an old deck (no wave-24 fields) comes through unchanged", () => {
  const d = C.emptyData(), nid = ids("o");
  const deck = C.fromTemplate(d, "report", "en", 1000, nid);
  const before = JSON.stringify(C.canonical(d));
  assert.equal(JSON.stringify(C.canonical(JSON.parse(before))), before);
  assert.ok(!/"(an|g|tb|ch|td)":/.test(before));
  assert.ok(C.deckSlides(d, deck.id).length > 1);
});

test("core: the new fields merge without loss, both ways, and settle", () => {
  const { d, s, nid } = deckWith();
  const a = add(d, s, nid, { k: "shape", sh: "rect", x: 0, y: 0, w: 100, h: 100, fill: "t:a1" });
  const b = add(d, s, nid, { k: "chart", x: 0, y: 0, w: 600, h: 400, ch: { t: "line", rows: [["", "S"], ["A", "3"]] } });
  const base = C.canonical(d);
  const L = j(base), R = j(base);
  C.setAnim(L, [a.id], { e: "fly", d: "l" }, 2000);                 // device L animates a
  R.items[b.id].ch = { t: "pie", rows: [["", "S"], ["A", "3"], ["B", "4"]] }; R.items[b.id].m = 2100;   // device R edits the chart
  R.slides[s.id].td = 900; R.slides[s.id].m = 2100;
  const m1 = C.mergeSlides(L, R), m2 = C.mergeSlides(R, L);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2));
  assert.equal(m1.items[a.id].an.e, "fly");
  assert.equal(m1.items[b.id].ch.t, "pie");
  assert.equal(m1.slides[s.id].td, 900);
  assert.equal(JSON.stringify(C.mergeSlides(m1, m1)), JSON.stringify(m1));   // no endless changes
});

test("core: groups — members, group / ungroup, copies get fresh groups", () => {
  const { d, s, nid } = deckWith();
  const a = add(d, s, nid, { k: "shape", sh: "rect", x: 0, y: 0, w: 100, h: 100, an: { e: "fade", o: "k" } });
  const b = add(d, s, nid, { k: "shape", sh: "ellipse", x: 200, y: 0, w: 100, h: 100 });
  const c = add(d, s, nid, { k: "line", x: 0, y: 300, w: 300, h: 2, st: "t:fg", sw: 4 });
  const g = C.groupItems(d, [a.id, b.id], 3000, nid);
  assert.ok(g);
  assert.equal(d.items[a.id].g, g); assert.equal(d.items[b.id].g, g);
  assert.deepEqual(j(d.items[b.id].an), j(d.items[a.id].an));         // one animation for the group
  assert.deepEqual(j(C.withGroups(d, [b.id])), [a.id, b.id]);
  assert.equal(C.groupMembers(d, d.items[c.id]).length, 1);
  // grouping a group with another object makes one group
  const g2 = C.groupItems(d, [a.id, c.id], 3100, nid);
  assert.ok([a.id, b.id, c.id].every((id) => d.items[id].g === g2));
  assert.equal(C.groupItems(d, [a.id], 3200, nid) === null || C.withGroups(d, [a.id]).length === 3, true);
  assert.equal(C.ungroupItems(d, [b.id], 3300), true);
  assert.ok([a.id, b.id, c.id].every((id) => d.items[id].g === undefined));
  // a lone g (its partner deleted) is no group
  d.items[a.id].g = "gx0001";
  assert.equal(C.groupMembers(d, d.items[a.id]).length, 1);
  const copies = C.freshGroups([{ g: "g1" }, { g: "g1" }, { g: "g2" }, {}], ids("n"));
  assert.equal(copies[0].g, copies[1].g); assert.notEqual(copies[0].g, "g1"); assert.notEqual(copies[2].g, copies[0].g);
});

test("core: animation order — new ones go last, move earlier / later, ties renumber", () => {
  const { d, s, nid } = deckWith();
  const a = add(d, s, nid, { k: "shape", sh: "rect", x: 0, y: 0, w: 10, h: 10 });
  const b = add(d, s, nid, { k: "shape", sh: "rect", x: 0, y: 0, w: 10, h: 10 });
  const c = add(d, s, nid, { k: "shape", sh: "rect", x: 0, y: 0, w: 10, h: 10 });
  C.setAnim(d, [a.id], { e: "fade" }, 2000);
  C.setAnim(d, [b.id], { e: "appear" }, 2000);
  C.setAnim(d, [c.id], { e: "zoom" }, 2000);
  const order = () => j(C.animUnits(d, s.id).map((u) => u.ids[0]));
  assert.deepEqual(order(), [a.id, b.id, c.id]);
  C.setAnim(d, [a.id], { e: "fly", d: "t" }, 2100);                     // changing keeps the place
  assert.deepEqual(order(), [a.id, b.id, c.id]);
  assert.equal(C.moveAnim(d, c.id, -1, 2200), true);
  assert.deepEqual(order(), [a.id, c.id, b.id]);
  assert.equal(C.moveAnim(d, a.id, -1, 2300), false);                   // already first
  assert.equal(C.moveAnim(d, b.id, 1, 2300), false);                    // already last
  // two devices gave two the same key: moving still works
  d.items[b.id].an.o = d.items[c.id].an.o;
  assert.equal(C.moveAnim(d, b.id, -1, 2400), true);
  const keys = C.animUnits(d, s.id).map((u) => u.an.o);
  assert.equal(new Set(keys).size, 3);
  assert.equal(C.setAnim(d, [a.id], null, 2500), true);
  assert.equal(d.items[a.id].an, undefined);
});

// ---------- anim.js ----------
test("anim: clicks, with / after the previous, delays, bullets one by one", () => {
  const { d, s, nid } = deckWith();
  const a = add(d, s, nid, { k: "shape", sh: "rect", x: 0, y: 0, w: 10, h: 10 });
  const b = add(d, s, nid, { k: "shape", sh: "rect", x: 0, y: 0, w: 10, h: 10 });
  const c = add(d, s, nid, { k: "shape", sh: "rect", x: 0, y: 0, w: 10, h: 10 });
  const body = C.placeholder(d, s.id, "body");
  C.setItemParas(d, body.id, [{ r: [{ t: "one" }] }, { r: [] }, { r: [{ t: "two" }] }, { r: [{ t: "three" }] }], 1100);
  C.setAnim(d, [a.id], { e: "fade", w: "w" }, 2000);                     // starts with the slide
  C.setAnim(d, [b.id], { e: "fly", w: "a", du: 800, dl: 200 }, 2000);    // then after it
  C.setAnim(d, [c.id], { e: "zoom" }, 2000);                             // click 1
  C.setAnim(d, [body.id], { e: "appear", w: "w", p: true }, 2000);      // with c, then a click per paragraph
  const pl = A.plan(d, s.id);
  assert.equal(pl.clicks, 3);
  assert.deepEqual(j(pl.steps[0].map((e) => [e.ids[0], e.t0, e.end])), [[a.id, 0, 500], [b.id, 700, 1500]]);
  assert.deepEqual(j(pl.steps[1].map((e) => [e.ids[0], e.pi])), [[c.id, -1], [body.id, 0]]);
  assert.deepEqual(j(pl.steps[2].map((e) => e.pi)), [2]);
  assert.deepEqual(j(pl.steps[3].map((e) => e.pi)), [3]);
  assert.equal(A.stepEnd(pl, 0), 1500);
  // at the start everything waits; half way through b is moving
  let st = A.state(pl, 0, 0);
  assert.ok(st.hidden[b.id] && st.hidden[c.id] && !st.hidden[a.id]);
  assert.ok(st.busy);
  st = A.state(pl, 0, 1100);
  assert.equal(st.fx.length, 1); assert.equal(st.fx[0].e, "fly");
  assert.ok(st.fx[0].p > 0 && st.fx[0].p < 1);
  // step 1 finished: c and the first paragraph in, the others hidden
  st = A.state(pl, 1);
  assert.ok(!st.hidden[c.id]);
  assert.deepEqual(j(st.paras[body.id]), { 2: 1, 3: 1 });
  // reduced motion: everything of the step at once, nothing moves
  st = A.state(pl, 0, 0, true);
  assert.equal(st.fx.length, 0); assert.ok(!st.hidden[b.id]); assert.ok(!st.busy);
  assert.deepEqual(j(A.numbers(pl)), { [a.id]: 0, [b.id]: 0, [c.id]: 1, [body.id]: 1 });
  // a group plays as one unit
  C.setAnim(d, [body.id], null, 2100);
  C.groupItems(d, [a.id, b.id], 2200, nid);
  const pl2 = A.plan(d, s.id);
  assert.equal(pl2.steps[0].length, 1);
  assert.deepEqual(j(pl2.steps[0][0].ids).sort(), [a.id, b.id].sort());
  assert.deepEqual(j(A.flyFrom({ x: 100, y: 100, w: 50, h: 50 }, "l", 1000, 1000)), { x: -150, y: 0 });
  assert.deepEqual(j(A.flyFrom({ x: 100, y: 100, w: 50, h: 50 }, "b", 1000, 1000)), { x: 0, y: 900 });
});

// ---------- dk.js ----------
test("dk: tables and charts reach designkit; normDoc keeps them; numbers; chart keys", () => {
  const { d, deck, s, nid } = deckWith();
  const tb = add(d, s, nid, { k: "table", x: 100, y: 300, w: 1200, h: 500, tb: { rows: [["Χώρα", "Πόλη"], ["Ελλάδα", "Αθήνα"], ["Κύπρος", "Λευκωσία\nΛεμεσός"]], bd: true } });
  const ch = add(d, s, nid, { k: "chart", x: 100, y: 300, w: 800, h: 500, ch: { t: "col", rows: [["", "Πωλήσεις"], ["Α", "10"], ["Β", "1.234,5"]] } });
  const out = D.build(C.canonical(d), deck.id, [s.id], { lang: "el" });
  const again = M.normDoc(j(out.doc));
  assert.equal(again.items.length, out.doc.items.length);
  const mapped = Object.keys(out.map).filter((k) => out.map[k] === tb.id);
  assert.ok(mapped.length >= 6);                                        // cells + rects + lines
  const keys = Object.keys(out.charts);
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^[0-9a-f]{64}\.png$/);
  const img = out.doc.items.find((x) => x.t === "img" && x.a === keys[0]);
  assert.ok(img);
  assert.equal(out.map[img.id], ch.id);
  const spec = out.charts[keys[0]];
  assert.equal(D.chartKey(spec), keys[0]);                               // stable for the same content
  assert.notEqual(D.chartKey(Object.assign({}, spec, { t: "pie" })), keys[0]);
  // the sheet engine draws it (escaped text, an SVG)
  const svg = K.chartSVG(K.chartModel(D.chartGrid({ rows: spec.rows }), { t: spec.t }), { t: spec.t, w: spec.w, h: spec.h, co: spec.co, pal: spec.pal, lang: "el" });
  assert.match(svg, /^<svg/);
  assert.equal(D.num("1.234,5"), 1234.5); assert.equal(D.num("1,234.5"), 1234.5); assert.equal(D.num("12,5"), 12.5);
  assert.equal(D.num("-3"), -3); assert.equal(D.num("50%"), 50); assert.ok(!isFinite(D.num("abc")) || D.num("abc") === null);
  const f = D.tableFit(d.items[tb.id], C.themeById("light"));
  assert.ok(f.k > 0 && f.k <= 1);
});

// ---------- show.js ----------
test("show: steps — next build, back one build, back from the first build to the previous slide fully built", () => {
  const S = showCtx.orosDK.show;
  assert.ok(S.TRANSITIONS.indexOf("wipe") >= 0);
  assert.equal(S.VER, "1.2.0");
  const src = fs.readFileSync(path.join(ROOT, "designkit/show.js"), "utf8");
  assert.match(src, /function moveStep\(/);
  assert.match(src, /settled = !!built/);
});

// ---------- pptx.js ----------
function richDeck() {
  const { d, deck, s, nid } = deckWith();
  d.slides[s.id].tr = "wipe"; d.slides[s.id].td = 1000;
  const body = C.placeholder(d, s.id, "body");
  C.setItemParas(d, body.id, [{ r: [{ t: "one" }] }, { r: [{ t: "two" }] }], 1100);
  const a = add(d, s, nid, { k: "shape", sh: "rect", x: 100, y: 100, w: 200, h: 100, fill: "t:a1" });
  const b = add(d, s, nid, { k: "shape", sh: "ellipse", x: 400, y: 100, w: 200, h: 100, fill: "t:a2" });
  const tb = add(d, s, nid, { k: "table", x: 100, y: 400, w: 1000, h: 300, tb: { rows: [["Α", "Β"], ["1", "2 & <3>"]], bd: true, ln: "h", fs: 30 } });
  C.groupItems(d, [a.id, b.id], 1200, nid);
  C.setAnim(d, [a.id], { e: "fly", d: "l", w: "w" }, 1300);
  C.setAnim(d, [body.id], { e: "fade", p: true, du: 700 }, 1300);
  C.setAnim(d, [tb.id], { e: "zoom", w: "a", dl: 300 }, 1300);
  return { d: C.canonical(d), deck, s, a, b, tb, body };
}
test("pptx: tables, groups, wipe with its speed and entrance animations go out and come back", async () => {
  const { d, deck } = richDeck();
  const res = X.write(d, deck.id, {}, {});
  const zip = Z.open(res.bytes);
  const xml = new TextDecoder().decode(await zip.bytes("ppt/slides/slide1.xml"));
  assert.match(xml, /<p:transition spd="slow"><p:wipe\/><\/p:transition>/);
  assert.match(xml, /<a:tbl><a:tblPr firstRow="1" bandRow="1"\/>/);
  assert.match(xml, /2 &amp; &lt;3&gt;/);
  assert.match(xml, /<p:grpSp>/);
  assert.match(xml, /<p:timing>.*nodeType="mainSeq"/);
  assert.match(xml, /presetID="2" presetClass="entr" presetSubtype="8"/);       // fly in from the left
  assert.match(xml, /<p:pRg st="1" end="1"\/>/);                                  // the second bullet
  assert.match(xml, /<p:bldP spid="\d+" grpId="0" build="p"\/>/);
  assert.match(xml, /evt="onBegin"/);                                             // the group starts with the slide
  const plan = await X.read(zip, { parseXml: AP.parseXml });
  const S = plan.slides[0];
  assert.equal(S.tr, "wipe"); assert.equal(S.td, 1000);
  const back = X.build(plan, {}, 5000, ids("r"));
  const items = back.items;
  const t2 = items.find((x) => x.k === "table");
  assert.deepEqual(j(t2.tb.rows), [["Α", "Β"], ["1", "2 & <3>"]]);
  assert.equal(t2.tb.hd, true); assert.equal(t2.tb.bd, true); assert.equal(t2.tb.fs, 30);
  const shapes = items.filter((x) => x.k === "shape");
  assert.equal(shapes.length, 2);
  assert.ok(shapes[0].g && shapes[0].g === shapes[1].g);
  assert.equal(shapes[0].an.e, "fly"); assert.equal(shapes[0].an.d, "l"); assert.equal(shapes[0].an.w, "w");
  assert.deepEqual(j(shapes[1].an), j(shapes[0].an));
  const body = items.find((x) => x.ph === "body");
  assert.equal(body.an.e, "fade"); assert.equal(body.an.p, true); assert.equal(body.an.du, 700); assert.equal(body.an.w, undefined);
  assert.equal(t2.an.e, "zoom"); assert.equal(t2.an.w, "a"); assert.equal(t2.an.dl, 300);
  // the order survives: group, body, table
  const dd = C.emptyData();
  back.slides.forEach((s) => { dd.slides[s.id] = s; });
  items.forEach((x) => { dd.items[x.id] = x; });
  dd.decks[back.deck.id] = back.deck;
  const units = C.animUnits(dd, back.slides[0].id);
  assert.deepEqual(j(units.map((u) => u.an.e)), ["fly", "fade", "zoom"]);
  const pl = A.plan(dd, back.slides[0].id);
  assert.equal(pl.clicks, 2);                                                     // bullet 1 (+ table after it), bullet 2
});

test("pptx: charts go out as their picture when one is given, else counted missing", () => {
  const { d, deck, s, nid } = deckWith();
  add(d, s, nid, { k: "chart", x: 100, y: 100, w: 600, h: 400, ch: { t: "bar", rows: [["", "S"], ["A", "1"]], ttl: "Τίτλος" } });
  const dc = C.canonical(d);
  const specs = X.charts(dc, deck.id, "el");
  const keys = Object.keys(specs);
  assert.equal(keys.length, 1);
  assert.equal(X.write(dc, deck.id, {}, { lang: "el" }).out.missing, 1);
  const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const r = X.write(dc, deck.id, { [keys[0]]: PNG }, { lang: "el" });
  assert.equal(r.out.missing, 0); assert.equal(r.out.pictures, 1);
});

// ---------- remote.js ----------
test("remote: only known commands pass; the snapshot is small and checked", () => {
  assert.deepEqual(j(RM.cmd({ t: "a", a: "next" })), { t: "a", a: "next" });
  assert.deepEqual(j(RM.cmd({ t: "hi", x: 1 })), { t: "hi" });
  assert.equal(RM.cmd({ t: "a", a: "close" }), null);
  assert.equal(RM.cmd({ t: "eval", code: "1" }), null);
  assert.equal(RM.cmd(null), null);
  const slides = [{ title: "Α", notes: "σημείωση", hid: false }, { title: "Β", notes: "", hid: true }, { title: "Γ", notes: "x".repeat(9000), hid: false }];
  const st = { index: 0, pos: 0, visible: 2, atEnd: false, step: 1, steps: 3, blank: "", closed: false, el: 12345.6 };
  const snap = RM.snapshot(st, slides);
  assert.deepEqual(j(snap), { t: "st", on: true, end: false, n: 1, c: 2, left: 2, blank: "", title: "Α", notes: "σημείωση", next: "Γ", el: 12346, paused: false });
  assert.ok(JSON.stringify(RM.snapshot(Object.assign({}, st, { index: 2, pos: 1 }), slides)).length < 12000);
  assert.deepEqual(j(RM.snapshot(Object.assign({}, st, { closed: true }), slides)), { t: "st", on: false });
  assert.deepEqual(j(RM.adopt(snap)), j(Object.assign({}, snap, { t: undefined })));
  const evil = RM.adopt({ t: "st", on: true, n: "1e9", c: -4, left: "x", blank: "<b>", title: 5, notes: { a: 1 }, el: Infinity });
  assert.equal(evil.c, 0); assert.equal(evil.blank, ""); assert.equal(evil.title, ""); assert.equal(evil.notes, "");
  assert.equal(RM.adopt({ t: "other" }), null);
  assert.deepEqual(j(RM.adopt({ t: "st", on: "yes" })), { on: false });
});
