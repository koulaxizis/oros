// orOS designkit — book typesetting in paragraph styles (LY-BK,
// designkit/text.js): Greek hyphenation (ext.hyph), lines kept
// together at a column break (ext.orph, ext.wid), keep with next
// (ext.kwn) and where a paragraph starts (ext.brk). Synthetic text.
// Run: node --test tests/layout-book.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const split = (w) => { let s = "", f = 0; T.hyphenGreek(w).concat([w.length]).forEach((o) => { s += (s ? "-" : "") + w.slice(f, o); f = o; }); return s; };

test("Greek hyphenation follows the school rules, two letters on each side", () => {
  assert.equal(split("άνθρωπος"), "άν-θρω-πος");
  assert.equal(split("καλημέρα"), "κα-λη-μέ-ρα");
  assert.equal(split("θάλασσα"), "θά-λασ-σα");
  assert.equal(split("αυτοκίνητο"), "αυ-το-κί-νη-το");
  assert.equal(split("ευχαριστώ"), "ευ-χα-ρι-στώ");
  assert.equal(split("πεντάρα"), "πε-ντά-ρα");
  assert.equal(split("κοροϊδεύω"), "κο-ρο-ϊ-δεύω");
  assert.equal(split("ΘΑΛΑΣΣΑ"), "ΘΑ-ΛΑΣ-ΣΑ");
  // a vowel group stays whole; one letter never stands alone
  assert.equal(split("σχολείο"), "σχο-λείο");
  assert.equal(split("έντεκα"), "έντε-κα");
  // not Greek, or too short: nothing
  assert.deepEqual(T.hyphenGreek("window"), []);
  assert.equal(split("νερό"), "νε-ρό");
  assert.deepEqual(T.hyphenGreek("ναι"), []);
  assert.deepEqual(T.hyphenGreek("σε·"), []);
});

const P = (ext, o) => Object.assign({ id: "p", m: 1, name: "P", font: "serif", size: 10, lead: 15, align: "j", ext }, o || {});
const lay = (paras, frames, ps) => T.layoutChain({ paras }, frames, { ps: ps || [P()], cs: [] });
const ASC = T.ascent("serif-r", 10), DESC = T.descent("serif-r", 10);
// a frame with room for n lines
const hFor = (n) => ASC + 15 * (n - 1) + DESC + 1;
const words = "η θάλασσα ήταν ήσυχη εκείνο το βράδυ και οι γλάροι κοιμόνταν πάνω στην παλιά προβλήτα".split(" ");
const text = (n, k) => { const a = []; for (let i = 0; i < n; i++) a.push(words[(i * 7 + k) % words.length]); return a.join(" ") + "."; };

test("hyphenation: Greek words break with a hyphen that takes no character", () => {
  const t = text(40, 1), runs = [{ t }];
  const off = lay([{ ps: "p", runs }], [{ id: "a", w: 120, h: 900 }]).frames.a.lines;
  const on = lay([{ ps: "p", runs }], [{ id: "a", w: 120, h: 900 }], [P({ hyph: 1 })]).frames.a.lines;
  const ends = (ls) => ls.filter((l) => l.runs.length && l.runs[l.runs.length - 1].t === "-");
  assert.equal(ends(off).length, 0);
  assert.ok(ends(on).length > 0, "some lines end in a hyphen");
  assert.ok(on.length <= off.length);
  // the hyphen has no offsets; the text read back by offsets is the paragraph unchanged
  ends(on).forEach((l) => { const h = l.runs[l.runs.length - 1]; assert.equal(h.o, undefined); assert.equal(h.n, undefined); });
  const back = [];
  on.forEach((l) => l.runs.forEach((r) => { if (r.o !== undefined && !r.f) back.push([r.o, r.t]); }));
  const s = Array(t.length).fill(" ");
  back.forEach(([o, x]) => { for (let i = 0; i < x.length; i++) s[o + i] = x[i]; });
  assert.equal(s.join(""), t);
  // a soft hyphen typed in the text still works next to it
  const typed = lay([{ ps: "p", runs: [{ t: "πολυ­τελέστατο" }] }], [{ id: "a", w: 400, h: 100 }], [P({ hyph: 1 })]).frames.a.lines;
  assert.equal(typed.length, 1);
});

test("orphans: a paragraph with too few lines at a column's foot moves on whole", () => {
  const paras = [{ ps: "p", runs: [{ t: text(4, 0) }] }, { ps: "p", runs: [{ t: text(60, 2) }] }];
  const fr = () => [{ id: "a", w: 200, h: hFor(1 + 1) }, { id: "b", w: 200, h: 900 }];
  const n0 = lay([{ ps: "p", runs: [{ t: text(4, 0) }] }], [{ id: "a", w: 200, h: 900 }]).frames.a.lines.length;
  assert.equal(n0, 1, "the first paragraph is one line");
  const plain = lay(paras, fr());
  assert.equal(plain.frames.a.lines.filter((l) => l.p === 1).length, 1);
  const kept = lay(paras, fr(), [P({ orph: 2 })]);
  assert.equal(kept.frames.a.lines.filter((l) => l.p === 1).length, 0);
  assert.equal(kept.frames.b.lines[0].p, 1);
});

test("widows: the column before gives lines so at least wid lines go on", () => {
  const para = { ps: "p", runs: [{ t: text(60, 3) }] };
  const all = lay([para], [{ id: "a", w: 200, h: 900 }]).frames.a.lines.length;
  assert.ok(all > 4);
  const fr = () => [{ id: "a", w: 200, h: hFor(all - 1) }, { id: "b", w: 200, h: 900 }];
  const plain = lay([para], fr());
  assert.equal(plain.frames.b.lines.length, 1);
  const kept = lay([para], fr(), [P({ wid: 2, orph: 2 })]);
  assert.equal(kept.frames.b.lines.length, 2);
  assert.equal(kept.frames.a.lines.length, all - 2);
  assert.equal(kept.overset, false);
});

test("keep with next: a heading never ends a column alone", () => {
  const ps = [P(), P({ kwn: 1 }, { id: "h", size: 14, lead: 18, align: "c" })];
  const paras = [{ ps: "p", runs: [{ t: text(4, 0) }] }, { ps: "h", runs: [{ t: "Δεύτερο" }] }, { ps: "p", runs: [{ t: text(30, 4) }] }];
  const fr = () => [{ id: "a", w: 200, h: hFor(1) + 18 + 2 }, { id: "b", w: 200, h: 900 }];
  const plain = lay(paras, fr(), [P(), P({}, { id: "h", size: 14, lead: 18, align: "c" })]);
  assert.ok(plain.frames.a.lines.some((l) => l.p === 1), "without it the heading stays at the foot");
  const kept = lay(paras, fr(), ps);
  assert.ok(!kept.frames.a.lines.some((l) => l.p === 1));
  assert.equal(kept.frames.b.lines[0].p, 1);
});

test("a paragraph starts on a new page or an odd page; not at the start of the story", () => {
  // five frames: pages 1, 1 (second column), 2, 3, 4
  const fr = () => [
    { id: "a", w: 200, h: 900, ctx: { pg: "p1", no: 1 } }, { id: "a2", w: 200, h: 900, ctx: { pg: "p1", no: 1 } },
    { id: "b", w: 200, h: 900, ctx: { pg: "p2", no: 2 } }, { id: "c", w: 200, h: 900, ctx: { pg: "p3", no: 3 } }, { id: "d", w: 200, h: 900, ctx: { pg: "p4", no: 4 } }];
  const ps = [P(), P({ brk: "page" }, { id: "pg" }), P({ brk: "odd" }, { id: "od" }), P({ brk: "col" }, { id: "cl" })];
  const r = lay([{ ps: "pg", runs: [{ t: "Α" }] }, { ps: "p", runs: [{ t: "ένα" }] }, { ps: "cl", runs: [{ t: "δύο" }] }, { ps: "pg", runs: [{ t: "τρία" }] }, { ps: "od", runs: [{ t: "τέσσερα" }] }], fr(), ps);
  const where = (p) => Object.keys(r.frames).find((id) => r.frames[id].lines.some((l) => l.p === p));
  assert.deepEqual([0, 1, 2, 3, 4].map(where), ["a", "a", "a2", "b", "c"]);
  // odd after page 3: page 4 is even, so no frame is left → overset
  const r2 = lay([{ ps: "p", runs: [{ t: "ένα" }] }, { ps: "pg", runs: [{ t: "δύο" }] }, { ps: "od", runs: [{ t: "τρία" }] }, { ps: "od", runs: [{ t: "τέσσερα" }] }], fr(), ps);
  assert.equal(r2.overset, true);
  // without page context (Atelier, a master view) a break never loops
  const r3 = lay([{ ps: "p", runs: [{ t: "ένα" }] }, { ps: "pg", runs: [{ t: "δύο" }] }], [{ id: "x", w: 200, h: 900 }], ps);
  assert.equal(r3.overset, false);
});

test("the settings live in the style's ext, inherit, and survive normalizing", () => {
  const doc = M.newDoc({ name: "B", w: 400, h: 600, pages: 1 }, 1);
  doc.pstyles.push({ id: "ps-x", m: 1, name: "X", base: "ps-base", ext: { hyph: 1, orph: 2, wid: 3, kwn: 1, brk: "odd" } });
  doc.pstyles.push({ id: "ps-y", m: 1, name: "Y", base: "ps-x", ext: { brk: "nope", orph: 40 } });
  const nd = M.normDoc(doc);
  const y = T.resolvePs(T.byId(nd.pstyles), "ps-y");
  assert.deepEqual([y.hyph, y.orph, y.wid, y.kwn, y.brk], [1, 9, 3, 1, ""]);
  assert.deepEqual(M.find(nd.pstyles, "ps-x").ext, { hyph: 1, orph: 2, wid: 3, kwn: 1, brk: "odd" });
  const base = T.resolvePs(T.byId(nd.pstyles), "ps-base");
  assert.equal(base.hyph, undefined, "off unless a style turns it on");
});
