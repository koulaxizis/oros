// Layout W6 (LY-W6): Greek and composition. Polytonic hyphenation and
// capitals, the glyph check, Greek order, the paragraph composer,
// justification limits with letter spacing, optical margins, drop
// caps, balanced ragged lines, small caps and super/subscript, the
// loose/tight marks, and the strings in EN/EL/DE.
// Run: node --test tests/layout-w6.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

// i18n-inline-ok: Greek sample text for the typesetting tests
const TXT = "Η θάλασσα απλωνόταν ήσυχη κάτω από τον ουρανό, και οι ψαράδες γύριζαν αργά στο λιμάνι με τα δίχτυα τους γεμάτα. Κανείς δεν μιλούσε, γιατί η μέρα ήταν μεγάλη και η κούραση βαριά, όμως όλοι ήξεραν πως αύριο θα ξαναβγούν στο πέλαγος, όπως έκαναν οι πατέρες και οι παππούδες τους.";
const P = (x) => Object.assign({ id: "p", m: 1, name: "P", font: "serif", size: 10, lead: 12, align: "j" }, x);
function lay(ext, w, text, extra) {
  const st = { ps: [P(Object.assign({ ext: Object.assign({ hyph: 1 }, ext) }, extra || {}))], cs: [] };
  return T.layoutChain({ paras: [{ ps: "p", runs: [{ t: text || TXT }] }] }, [{ id: "a", w: w || 200, h: 3000 }], st).frames.a.lines;
}

test("polytonic: hyphenation by base letters, monotonic unchanged", () => {
  const cut = (w) => T.hyphenGreek(w).map((o, i, a) => w.slice(i ? a[i - 1] : 0, o)).concat([w.slice(T.hyphenGreek(w).slice(-1)[0] || 0)]).join("-");
  assert.equal(cut("ἄνθρωπος"), "ἄν-θρω-πος");
  assert.equal(cut("ψυχῇ"), "ψυ-χῇ");
  assert.equal(cut("προϊστάμενος"), "προ-ϊ-στά-με-νος", "a dialytika starts a syllable");
  assert.equal(cut("άνθρωπος"), "άν-θρω-πος");
  assert.deepEqual(T.hyphenGreek("ᾠδή"), []);
  // polytonic words break inside a paragraph too
  const ls = lay({}, 35, "ἄνθρωπος ἄνθρωπος ἄνθρωπος", { align: "l" });
  assert.ok(ls.some((l) => l.runs[l.runs.length - 1].t === "-"), "a hyphen at a line end");
});

test("polytonic capitals lose accents and breathings, keep the dialytika", () => {
  const st = { ps: [P({ align: "l", caps: 1 })], cs: [] };
  const L = T.layoutChain({ paras: [{ ps: "p", runs: [{ t: "Ἀθηναῖοι ἐν ᾠδῇ προϊστάμενος" }] }] }, [{ id: "a", w: 500, h: 50 }], st);
  assert.equal(L.frames.a.lines[0].runs.map((r) => r.t).join(" "), "ΑΘΗΝΑΙΟΙ ΕΝ ΩΙΔΗΙ ΠΡΟΪΣΤΑΜΕΝΟΣ");
});

test("glyph check: characters no font draws; the preflight names them", () => {
  assert.deepEqual(T.missingGlyphs("serif", "Αβγ abc ἄ ☃ ☃"), ["☃"]);
  assert.deepEqual(T.missingGlyphs("serif", "­​ \t"), []);
  const d = M.newDoc({ name: "G", w: 300, h: 300, pages: 1, facing: 0 }, 1000);
  const pg = M.pagesInOrder(d);
  d.stories.push({ id: "st-a", m: 1000, paras: [{ ps: "ps-body", runs: [{ t: "Snow ☃ here" }] }] });
  d.items.push({ id: "it-a", m: 1000, t: "text", pg: pg[0].id, x: 20, y: 20, w: 200, h: 60, story: "st-a", seq: 1, z: 1 });
  const doc = M.normDoc(d), pf = R.preflight(doc, R.computeLayout(doc), {});
  const g = pf.filter((x) => x.code === "glyph")[0];
  assert.ok(g && g.id === "it-a" && g.chars === "☃" && g.sev === "err");
});

test("Greek order: accents, breathings, case and final sigma set aside", () => {
  // i18n-inline-ok: Greek words to sort
  const got = ["Ωμέγα", "άλφα", "Αλφάβητο", "ἀρετή", "βήτα", "έλα", "Ελένη", "10 κεφ.", "2 κεφ."].sort(T.collate);
  assert.deepEqual(got, ["2 κεφ.", "10 κεφ.", "άλφα", "Αλφάβητο", "ἀρετή", "βήτα", "έλα", "Ελένη", "Ωμέγα"]);
  assert.equal(T.sortKey("Ἄλφας"), "αλφασ");
});

test("paragraph composer: no looser than line by line, same text, same frame", () => {
  const text = TXT + " " + TXT + " " + TXT;
  [220, 260, 300].forEach((w) => {
    const a = lay({ ws: [80, 133] }, w, text), b = lay({ ws: [80, 133], comp: "p" }, w, text);
    const ws = (ls) => ls.filter((l) => l.ws).map((l) => l.ws);
    const rms = (v) => Math.sqrt(v.reduce((s, x) => s + (x - 100) * (x - 100), 0) / v.length);
    assert.ok(Math.max(...ws(b)) <= Math.max(...ws(a)), w + ": the loosest line is no looser");
    assert.ok(rms(ws(b)) <= rms(ws(a)) + 0.5, w + ": spacing as even or more");
    const words = (ls) => ls.map((l) => l.runs.map((r) => r.t).join("")).join("").replace(/-/g, "");
    assert.equal(words(b), words(a), "every letter is still there");
  });
  // tabs: the line-by-line composer takes over
  const st = { ps: [P({ ext: { comp: "p" } })], cs: [] };
  const L = T.layoutChain({ paras: [{ ps: "p", runs: [{ t: "a\tb " + TXT }] }] }, [{ id: "a", w: 200, h: 900 }], st);
  assert.ok(L.frames.a.lines.length > 3);
});

test("justification limits: spaces to their max, then letter spacing; loose lines marked", () => {
  const plain = lay({}, 180), lim = lay({ ws: [90, 110], ls: 30 }, 180);
  assert.ok(lim.some((l) => l.runs.some((r) => r.track > 0)), "letter spacing added");
  lim.forEach((l) => l.runs.forEach((r) => assert.ok(r.track <= 30.001, "never past its max")));
  assert.ok(plain.every((l) => l.runs.every((r) => !r.track)), "no limits, no letter spacing");
  assert.ok(lay({}, 150).some((l) => l.hj === 1), "a line past 133 % is loose");
  // shrinking spaces lets a line take one more word
  const tight = lay({ ws: [60, 133] }, 200), wide = lay({ ws: [100, 133] }, 200);
  assert.ok(tight.length <= wide.length);
  assert.ok(tight.some((l) => l.ws < 100), "a line with narrower spaces");
});

test("optical margins: punctuation hangs past the edges", () => {
  const ls = lay({ opt: 1 }, 200, "«Ναι», είπε. " + TXT);
  assert.ok(ls[0].runs[0].x < 0, "the opening guillemet hangs left");
  const right = ls.filter((l) => /[.,-]$/.test(l.runs[l.runs.length - 1].t)).filter((l) => l !== ls[ls.length - 1]);
  assert.ok(right.length);
  right.forEach((l) => { const r = l.runs[l.runs.length - 1]; assert.ok(r.x + r.w > 200.01, "hangs right: " + r.t); });
  assert.ok(lay({}, 200, "«Ναι», είπε. " + TXT)[0].runs[0].x >= 0);
});

test("drop cap: big letters through n lines, the lines beside them make room", () => {
  const ls = lay({ dc: { n: 3, c: 1 } }, 200);
  const cap = ls[0].runs[0];
  assert.equal(cap.t, "Η");
  assert.equal(cap.dc, 1);
  assert.ok(cap.size > 30);
  assert.ok(Math.abs(cap.y - (ls[0].y + 24)) < 0.01, "its baseline on the third line's");
  assert.equal(cap.o, 0);
  assert.equal(ls[0].o0, 0, "the caret finds it");
  assert.ok(ls[1].runs[0].x > cap.w && ls[2].runs[0].x > cap.w, "lines 2 and 3 indented");
  assert.equal(Math.round(ls[3].runs[0].x), 0, "line 4 is not");
  // a short paragraph: the next one starts below the cap
  const st = { ps: [P({ ext: { dc: { n: 3, c: 2 } } }), P({ id: "q" })], cs: [] };
  const L = T.layoutChain({ paras: [{ ps: "p", runs: [{ t: "Μία γραμμή." }] }, { ps: "q", runs: [{ t: "Μετά." }] }] }, [{ id: "a", w: 300, h: 300 }], st);
  const lsx = L.frames.a.lines;
  assert.equal(lsx[0].runs[0].t, "Μί");
  assert.ok(lsx[1].y >= lsx[0].y + 24 + 12 - 0.01, "the next paragraph below the cap");
  // the style keeps it checked
  const ps = T.resolvePs({ a: { id: "a", ext: { dc: { n: 30, c: 0 } } } }, "a");
  assert.equal(ps.dc, null, "no letters, no drop cap");
});

test("balanced ragged lines: a heading's lines come out even", () => {
  const H = "Η θάλασσα απλωνόταν ήσυχη κάτω από τον ουρανό του Αιγαίου";
  const ends = (ls) => ls.map((l) => { const r = l.runs[l.runs.length - 1]; return r.x + r.w; });
  const a = lay({ hyph: 0 }, 330, H, { align: "c", size: 14, lead: 17 }), b = lay({ hyph: 0, bal: 1 }, 330, H, { align: "c", size: 14, lead: 17 });
  assert.equal(a.length, 2);
  assert.equal(b.length, 2, "no extra line");
  const wa = a.map((l) => l.runs[l.runs.length - 1].x + l.runs[l.runs.length - 1].w - l.runs[0].x);
  const wb = b.map((l) => l.runs[l.runs.length - 1].x + l.runs[l.runs.length - 1].w - l.runs[0].x);
  assert.ok(Math.abs(wb[0] - wb[1]) < Math.abs(wa[0] - wa[1]), wb + " vs " + wa);
  assert.ok(ends(b).length === 2);
  // body text with the composer, ragged: never more lines, no more hyphens
  const hy = (ls) => ls.filter((l) => l.runs[l.runs.length - 1].t === "-").length;
  const c = lay({}, 220, TXT + " " + TXT, { align: "l" }), d = lay({ comp: "p" }, 220, TXT + " " + TXT, { align: "l" });
  assert.ok(d.length <= c.length + 1);
  assert.ok(hy(d) <= hy(c));
});

test("small caps and super/subscript from character styles", () => {
  const st = { ps: [P({ align: "l" })], cs: [{ id: "c", m: 1, name: "c", ext: { sc: 1 } }, { id: "s", m: 1, name: "s", ext: { pos: "sup" } }, { id: "b", m: 1, name: "b", ext: { pos: "sub" } }] };
  const L = T.layoutChain({ paras: [{ ps: "p", runs: [{ t: "Ναι Αθήνα", cs: "c" }, { t: " x" }, { t: "2", cs: "s" }, { t: "3", cs: "b" }] }] }, [{ id: "a", w: 300, h: 100 }], st);
  const rs = L.frames.a.lines[0].runs;
  assert.deepEqual(rs.map((r) => r.t), ["Ν", "ΑΙ", "Α", "ΘΗΝΑ", "x", "2", "3"]);
  assert.ok(rs[1].size < 10 && rs[0].size === 10, "lower case as smaller capitals");
  assert.equal(rs[1].o, 1);
  assert.ok(rs[5].y < rs[4].y && rs[5].size < 10, "superscript raised");
  assert.ok(rs[6].y > rs[4].y, "subscript lowered");
});

test("W6: strings in EN/EL/DE, the style dialog and help", () => {
  const LYJS = read("layout/layout.js"), at = LYJS.indexOf('"home.new": "Νέο έγγραφο"');
  const de = read("i18n/de/layout.js");
  ["pf.glyph", "more.hjOn", "more.hjOff", "hj.on", "hj.off", "sty.sc", "sty.posSup", "sty.posSub", "sty.comp", "sty.composer", "sty.compP", "sty.compS", "sty.wsMin", "sty.wsMax", "sty.lsMax", "sty.dcN", "sty.dcC", "sty.opt", "sty.bal", "sty.compHint"].forEach((k) => {
    assert.ok(LYJS.slice(0, at).includes('"' + k + '": '), "EN " + k);
    assert.ok(LYJS.slice(at).includes('"' + k + '": '), "EL " + k);
    assert.ok(de.includes('"' + k + '": '), "DE " + k);
  });
  const pn = read("layout/panels.js");
  assert.match(pn, /function compEditor\(st\)/);
  assert.match(read("layout/editor.js"), /LY\.prefs\.hjShow === 1/);
  assert.match(read("layout/help.en.txt"), /## Greek and composition/);
  assert.match(read("layout/help.el.txt"), /## Ελληνικά και στοιχειοθεσία/);
  assert.match(read("i18n/de/help/layout.txt"), /## Griechisch und Satz/);
});
