// Lyric Sync, Songbook S1: chords in the song (lyricsync/chords.js and
// the new optional fields in core.js / formats.js).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../lyricsync/core.js");
const H = require("../lyricsync/chords.js");
const F = require("../lyricsync/formats.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
let n = 0;
const rand = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
// A song made from a sheet, as the app does it.
const noIds = (p) => JSON.stringify(Object.assign({}, p, { ln: p.ln.map((l) => Object.assign({}, l, { id: "" })) }));
const fromSheet = (text, extra) => {
  const r = H.parseSheet(text, {});
  return C.cleanProject(Object.assign({ id: "s1", mtime: 5, xo: r.xo,
    ln: C.relyricLines([], r.lines, rand, true) }, r.meta, extra || {}));
};

const UG = [
  "[Intro]",
  "Am   F   C   G",
  "",
  "[Verse 1]",
  "Am          F",
  "Σε θυμάμαι κάθε βράδυ",
  "C              G",
  "κάτω απ' τ' αστέρια",
  "",
  "[Chorus]",
  "F       G      Am",
  "Λα λα λα, αγάπη μου",
  "{c: x2}",
  "",
  "Outro:",
  "| Am | F | C |"
].join("\n");

test("chord names: a strict grammar, so words are never chords", () => {
  for (const ok of ["Am", "C", "F#m7", "Bbmaj7#11", "Am7b5", "C6/9", "D/F#", "E7/G#", "Csus4", "G7(b9)", "Cadd9", "N.C.", "Bdim", "C+", "Ebm"]) assert.ok(C.isChord(ok), ok);
  for (const no of ["Be", "Do", "Am I", "H", "Cx", "", "A".repeat(17), "Am/", "c", "Hello"]) assert.ok(!C.isChord(no), no);
  assert.equal(H.norm("Λα-"), "Am");
  assert.equal(H.norm("Σολ#7"), "G#7");
  assert.equal(H.norm("Ρε/Φα#"), "D/F#");
  assert.equal(H.norm("Ντό"), "C");
  assert.equal(H.norm("λα"), "", "sung la la la stays words");
  assert.equal(H.norm("A♯"), "A#");
  assert.equal(H.norm("nc"), "N.C.");
});

test("names for the screen: C D E stored, Ντο Ρε Μι shown on request", () => {
  assert.equal(H.show("Am7", true), "Λαm7");
  assert.equal(H.show("D/F#", true), "Ρε/Φα#");
  assert.equal(H.show("Bb", true), "Σιb");
  assert.equal(H.show("Am7", false), "Am7");
  assert.equal(H.show("N.C.", true), "N.C.");
});

test("chords over the words: columns, sections, labels, chord rows", () => {
  const r = H.parseSheet(UG, {});
  assert.deepEqual(r.lines.map((l) => l.t), ["Σε θυμάμαι κάθε βράδυ", "κάτω απ' τ' αστέρια", "Λα λα λα, αγάπη μου"]);
  assert.deepEqual(r.lines[0].c, [[0, "Am"], [12, "F"]]);
  assert.equal(r.lines[0].k, "v");
  assert.equal(r.lines[0].p, 1, "the verse after the intro is a new verse");
  assert.deepEqual(r.lines[0].x.map((x) => x.m ? "#" + x.t : x.c.map((c) => c[1]).join(" ")), ["#Intro", "Am F C G"]);
  assert.equal(r.lines[2].k, "c");
  assert.deepEqual(r.lines[2].c, [[0, "F"], [8, "G"], [15, "Am"]]);
  assert.deepEqual(r.xo.map((x) => x.t), ["x2", "Outro", "| | | |"]);
  assert.equal(H.rowPlain(r.xo[2], false), "| Am | F | C |");
  assert.equal(H.rowPlain(r.xo[2], true), "| Λαm | Φα | Ντο |");
});

test("ChordPro: inline chords, directives, tabs, Greek names", () => {
  const text = [
    "{title: Το τραγούδι}", "{artist: Κάποιος}", "{key: Am}", "{capo: 2}", "{tempo: 96}", "{time: 6/8}", "# a note for the file only",
    "{start_of_verse}", "[Am]Σε θυ[F]μάμαι", "[C]κάτω[G]", "{end_of_verse}", "",
    "{soc}", "[Λα-]Έλα [Ρε7]εδώ", "{eoc}",
    "{sot}", "e|--0--1--|", "B|--1-----|", "{eot}",
    "{new_song}", "{title: Second}", "[C]never read"
  ].join("\n");
  const r = H.parseSheet(text, {});
  assert.deepEqual(r.meta, { name: "Το τραγούδι", ar: "Κάποιος", key: "Am", capo: 2, bpm: 96, ts: "6/8" });
  assert.deepEqual(r.lines.map((l) => [l.t, l.k || "", l.p]), [["Σε θυμάμαι", "v", 0], ["κάτω", "", 0], ["Έλα εδώ", "c", 1]]);
  assert.deepEqual(r.lines[1].c, [[0, "C"], [4, "G"]], "a chord at the end of the line");
  assert.deepEqual(r.lines[2].c, [[0, "Am"], [4, "D7"]], "Greek names become C D E");
  assert.deepEqual(r.xo, [{ t: "e|--0--1--|", tb: 1 }, { t: "B|--1-----|", tb: 1 }]);
  assert.ok(!r.lines.some((l) => /never/.test(l.t)), "only the first song of a bundle");
  // [Chorus] is a label, not a chord; a bracket in a sung line stays text
  const r2 = H.parseSheet("[Chorus]\nI [sing] [Am]loud\n", {});
  assert.equal(r2.lines[0].k, "c");
  assert.equal(r2.lines[0].t, "I [sing] loud");
  assert.deepEqual(r2.lines[0].c, [[9, "Am"]]);
});

test("the editor text and the ChordPro file read back to the same song", () => {
  const p = fromSheet(UG, { key: "Am", capo: 3 });
  for (const lang of ["en", "el"]) {
    const back = fromSheet(H.toEditor(p, lang), { key: "Am", capo: 3 });
    assert.equal(noIds(back), noIds(p), "editor " + lang);
  }
  const file = H.toChordPro(p);
  assert.match(file, /^\{key: Am\}$/m);
  assert.match(file, /^\{start_of_chorus\}$/m);
  assert.match(file, /^\{end_of_chorus\}$/m);
  const r = F.parse("song.cho", file);
  assert.equal(r.kind, "chordpro");
  assert.equal(r.key, "Am");
  assert.equal(r.capo, 3);
  const back = C.cleanProject(Object.assign({ id: "s1", mtime: 5, xo: r.xo, key: r.key, capo: r.capo,
    ln: C.relyricLines([], r.lines, rand, true) }));
  assert.equal(noIds(back), noIds(p), "file");
  // and the whole song through our JSON
  const j = F.parse("x.json", F.toJson(p));
  assert.deepEqual(j.lines.map((l) => l.c || null), p.ln.map((l) => l.c || null));
  assert.equal(j.key, "Am");
  assert.equal(JSON.stringify(j.xo), JSON.stringify(p.xo));
});

test("the timing exports never carry chords", () => {
  const p = fromSheet(UG);
  const lines = p.ln.map((l, i) => Object.assign({}, l, { s: 1000 * (i + 1) }));
  const timed = Object.assign({}, p, { ln: lines });
  for (const k of ["lrc", "srt", "vtt", "ttml", "ass", "txt"]) {
    const out = F.EXPORTS[k].fn(timed);
    assert.ok(!/\bAm\b|\[F\]|Intro|Outro/.test(out), k + " has no chords or rows");
  }
  assert.equal(C.toText(timed.ln), "Σε θυμάμαι κάθε βράδυ\nκάτω απ' τ' αστέρια\n\nΛα λα λα, αγάπη μου");
  assert.ok(C.issues(timed.ln, 0).every((x) => x.code !== "label"), "sections are not label lines");
});

test("chords over the words as plain text: aligned, spaced when they touch", () => {
  const p = C.cleanProject({ id: "s", mtime: 1, key: "G", ln: [{ id: "a", t: "Hi there", s: null, e: null, c: [[0, "Am7"], [1, "D"], [3, "G"]] }] });
  const out = H.toChordsText(p, {}).split("\n");
  assert.equal(out[0], "Key: G");
  assert.equal(out[2], "Am7 D G");
  assert.equal(out[3], "H   i there");
  assert.equal(H.toChordsText(p, { solfege: true, lang: "el", words: { key: "Τόνος" } }).split("\n")[0], "Τόνος: Σολ");
});

test("transpose: every chord and the key, sharps or flats by the key", () => {
  assert.equal(H.transpose("Am7", 2, false), "Bm7");
  assert.equal(H.transpose("D/F#", -2, false), "C/E");
  assert.equal(H.transpose("C6/9", 1, true), "Db6/9");
  assert.equal(H.transpose("N.C.", 3, false), "N.C.");
  assert.equal(H.keyAfter("Am", 1), "Bbm");
  assert.equal(H.keyAfter("C", 6), "F#");
  assert.equal(H.keyAfter("E", -11), "F");
  for (let k = 0; k < 12; k++) {
    assert.equal(H.keyAfter(H.keyAfter("G", k), -k), "G", "G there and back by " + k);
  }
  const p = fromSheet(UG, { key: "Am" });
  const t = H.transposeSong(p, 1);
  assert.equal(t.key, "Bbm");
  assert.deepEqual(t.ln[0].c, [[0, "Bbm"], [12, "Gb"]]);
  assert.deepEqual(t.ln[0].x[1].c.map((x) => x[1]), ["Bbm", "Gb", "Db", "Ab"]);
  assert.deepEqual(t.xo[2].c.map((x) => x[1]), ["Bbm", "Gb", "Db"]);
  const back = H.transposeSong(Object.assign({}, p, t), -1);
  assert.deepEqual(back.ln.map((l) => l.c), p.ln.map((l) => l.c), "and back");
  // with no key, the chords decide
  assert.ok(H.flatsFor("", ["Bb", "Eb", "F"]));
  assert.ok(!H.flatsFor("", ["F#m", "C#", "A"]));
  assert.ok(H.flatsFor("Dm", null));
});

test("suggestions: the song's chords first, then the key's", () => {
  const p = fromSheet("[Em]a [C]b\n", { key: "G" });
  const s = H.suggest(p);
  assert.deepEqual(s.slice(0, 2), ["Em", "C"]);
  assert.ok(["G", "Am", "Bm", "D", "F#dim", "D7"].every((x) => s.includes(x)));
  assert.ok(H.suggest({ ln: [] }).includes("C"));
});

test("cells: a piece at every chord and word; setChord puts and takes off", () => {
  const l = { t: "Σε θυμάμαι", c: [[0, "Am"], [10, "E7"]] };
  assert.deepEqual(H.cells(l).map((x) => [x.a, x.b, x.ch.join(","), x.word]), [[0, 3, "Am", true], [3, 10, "", true], [10, 10, "E7", false]]);
  const l2 = H.setChord(l, 3, "F");
  assert.deepEqual(l2.c, [[0, "Am"], [3, "F"], [10, "E7"]]);
  assert.deepEqual(H.setChord(l2, 0, "").c, [[3, "F"], [10, "E7"]]);
  assert.equal(H.setChord({ t: "x", c: [[0, "C"]] }, 0, "").c, undefined);
});

test("data: chords are checked, never repaired, and sync stays symmetric", () => {
  const base = { id: "a", t: "Hello there", s: null, e: null };
  const keep = (c) => C.cleanProject({ id: "s", mtime: 1, ln: [Object.assign({}, base, { c })] }).ln[0].c;
  assert.deepEqual(keep([[0, "C"], [6, "G"]]), [[0, "C"], [6, "G"]]);
  assert.equal(keep([[6, "G"], [0, "C"]]), undefined, "going back drops them all");
  assert.equal(keep([[0, "<b>"]]), undefined, "not a chord");
  assert.equal(keep([[99, "C"]]), undefined, "past the end");
  assert.equal(keep([[0.5, "C"]]), undefined);
  assert.equal(keep(new Array(33).fill([0, "C"])), undefined, "at most 32");
  const p = C.cleanProject({ id: "s", mtime: 1, key: "Hm", capo: 12, bpm: 10, ts: "5/3", xo: [{ t: "", m: 1 }, { t: "x".repeat(300), m: 1 }, { t: "a", tb: 1, m: 1 }],
    ln: [Object.assign({}, base, { k: "z", x: [{ t: "Intro", m: 1, k: "c", p: 1 }, null, { t: "  e|--0--| \t", tb: 1 }] })] });
  assert.equal(p.key, undefined); assert.equal(p.capo, undefined); assert.equal(p.bpm, undefined); assert.equal(p.ts, undefined);
  assert.deepEqual(p.xo.map((r) => [r.t.length, !!r.m, !!r.tb]), [[200, true, false], [1, true, false]]);
  assert.equal(p.ln[0].k, undefined);
  assert.deepEqual(p.ln[0].x, [{ t: "Intro", m: 1, p: 1, k: "c" }, { t: "  e|--0--|", tb: 1 }]);
  // merge laws with chords
  const A = { ver: 1, items: [fromSheet(UG, { key: "Am" })], tombs: {} };
  const B = { ver: 1, items: [Object.assign(fromSheet(UG, { key: "C" }), { mtime: 6 })], tombs: {} };
  assert.equal(C.serialize(C.merge(A, B)), C.serialize(C.merge(B, A)));
  assert.equal(C.serialize(C.merge(A, A)), C.serialize(A));
  // an old build that never knew chords drops them on its copy (same
  // mtime): the longer copy wins the tie, so the chords come back
  const old = JSON.parse(JSON.stringify(A));
  old.items[0].ln.forEach((l) => { delete l.c; delete l.k; delete l.x; delete l.q; });
  delete old.items[0].xo; delete old.items[0].key;
  assert.equal(C.serialize(C.merge(old, A)), C.serialize(A));
  assert.equal(C.serialize(C.merge(A, old)), C.serialize(A));
});

test("plain editor: chords stay on unchanged lines and on a line fixed in place", () => {
  const p = fromSheet("[Am]one line\n[F]two lnie\n[C]three\n");
  const out = C.relyric(p.ln, "one line\ntwo line\nthree\nfour", rand);
  assert.deepEqual(out.map((l) => l.c || null), [[[0, "Am"]], [[0, "F"]], [[0, "C"]], null]);
  // a line that changed among others that moved keeps nothing it cannot place
  const out2 = C.relyric(p.ln, "zero\none line", rand);
  assert.deepEqual(out2.map((l) => l.c || null), [null, [[0, "Am"]]]);
  // chords past a shortened line move to its end
  const q = fromSheet("long words here[G]\n");
  assert.deepEqual(C.relyric(q.ln, "short", rand)[0].c, [[5, "G"]]);
});

test("formats: ChordPro and chord sheets are found by name and by content", () => {
  assert.equal(F.kindOf("a.cho", ""), "chordpro");
  assert.equal(F.kindOf("a.chopro", ""), "chordpro");
  assert.equal(F.kindOf("a.chordpro", ""), "chordpro");
  assert.equal(F.kindOf("a.crd", ""), "chordpro");
  assert.equal(F.kindOf("a.txt", "{title: x}\nla"), "chordpro");
  assert.equal(F.kindOf("a.txt", "Am  F\nwords"), "chordpro");
  assert.equal(F.kindOf("a.txt", "[Chorus]\nA\nwords"), "txt", "a label and a lone A are not a chord sheet");
  assert.equal(F.kindOf("a.txt", "[00:01.00]x"), "lrc");
  assert.equal(F.EXPORTS.cho.ext, ".cho");
  assert.ok(F.EXPORTS.cho.chords && F.EXPORTS.chtxt.chords);
});

test("app wiring: chords.js loads before formats.js, files open here, names stay text", () => {
  const html = read("lyricsync/index.html");
  const at = (f) => html.indexOf('src="' + f);
  assert.ok(at("core.js") < at("chords.js") && at("chords.js") < at("formats.js"), "load order");
  const fo = read("fileopen.js");
  assert.ok(/app: "lyricsync"[\s\S]{0,400}"application\/x-chordpro": \[".cho", ".chopro", ".chordpro", ".crd"\]/.test(fo), "fileopen.js");
  const man = read("manifest.webmanifest");
  assert.ok(man.includes('"application/x-chordpro":[".cho",".chopro",".chordpro",".crd"]'), "manifest file handler");
  const app = read("lyricsync/app.js");
  assert.ok(!/innerHTML/.test(app), "chords and words only through textContent");
  const sw = read("sw.js");
  assert.ok(sw.includes("./lyricsync/chords.js"), "precached");
});
