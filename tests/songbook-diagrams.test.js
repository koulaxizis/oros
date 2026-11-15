// Lyric Sync Songbook S4: chord diagrams (guitar, ukulele, piano) found
// from the chord's name, their drawing, and the PDF strip.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const D = require("../lyricsync/diagrams.js");
const H = require("../lyricsync/chords.js");
const P = require("../lyricsync/sheetpdf.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const g = (c) => D.shape("guitar", c).frets.map((f) => (f < 0 ? "x" : f)).join("");
const u = (c) => D.shape("ukulele", c).frets.join("");

test("diagrams: the notes of a chord come from its name", () => {
  const n = (c) => { const x = D.notes(c); return x.need.concat(x.opt).sort((a, b) => a - b); };
  assert.deepStrictEqual(n("C"), [0, 4, 7]);
  assert.deepStrictEqual(n("Am"), [0, 4, 9]);
  assert.deepStrictEqual(n("G7"), [2, 5, 7, 11]);
  assert.deepStrictEqual(n("Cmaj7"), [0, 4, 7, 11]);
  assert.deepStrictEqual(n("Bdim"), [2, 5, 11]);
  assert.deepStrictEqual(n("Caug"), [0, 4, 8]);
  assert.deepStrictEqual(n("Dsus4"), [2, 7, 9]);
  assert.deepStrictEqual(n("Am7b5"), [0, 3, 7, 9]);
  assert.deepStrictEqual(n("Cadd9"), [0, 2, 4, 7]);
  assert.strictEqual(D.notes("D/F#").bass, 6);
  assert.strictEqual(D.notes("N.C."), null);
  assert.strictEqual(D.notes("Hm"), null);
});

test("diagrams: guitar finds the shapes players know for the common chords", () => {
  const want = { C: "x32010", G: "320003", D: "xx0232", A: "x02220", E: "022100", Am: "x02210", Em: "022000", Dm: "xx0231",
    F: "133211", Bm: "x24432", E7: "020100", D7: "xx0212", Cmaj7: "x32000", Am7: "x02010", "G/B": "x20003", Dsus2: "xx0230" };
  Object.keys(want).forEach((c) => assert.strictEqual(g(c), want[c], c));
});

test("diagrams: ukulele (G C E A) shapes for the common chords", () => {
  const want = { C: "0003", G: "0232", Am: "2000", F: "2010", D: "2220", A: "2100", C7: "0001", G7: "0212" };
  Object.keys(want).forEach((c) => assert.strictEqual(u(c), want[c], c));
});

test("diagrams: every chord of every key has a playable shape on both", () => {
  const roots = ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"];
  const quals = ["", "m", "7", "m7", "maj7", "sus2", "sus4", "dim", "aug", "6", "m6", "9", "add9", "7sus4", "m7b5", "dim7", "13", "7#9"];
  const T = D.TUNINGS;
  roots.forEach((r) => quals.forEach((q) => {
    const c = r + q;
    ["guitar", "ukulele"].forEach((inst) => {
      const s = D.shape(inst, c);
      assert.ok(s, inst + " " + c);
      const fr = s.frets.filter((f) => f > 0);
      if (fr.length) assert.ok(Math.max(...fr) - Math.min(...fr) < 4, "span " + inst + " " + c);
      const have = new Set();
      let low = Infinity;
      s.frets.forEach((f, i) => { if (f >= 0) { const m = T[inst][i] + f; have.add(m % 12); low = Math.min(low, m); } });
      const N = D.notes(c);
      const need = inst === "guitar" ? N.need.slice(0, 5) : N.need.filter((x) => x !== N.root).slice(0, 4);
      need.filter((x) => !(inst === "guitar" && N.need.length > 5 && x === (N.root + 7) % 12)).forEach((x) => {
        if (inst === "guitar" && N.need.length > 5) return;
        assert.ok(have.has(x), inst + " " + c + " has " + x);
      });
      if (inst === "guitar") assert.strictEqual(low % 12, N.bass, "bass lowest " + c);
    });
  }));
});

test("diagrams: drawing, left-handed mirror, piano keys", () => {
  const d = D.draw(D.shape("guitar", "C"), false), l = D.draw(D.shape("guitar", "C"), true);
  const xs = (dr) => dr.items.filter((x) => x.k === "dot" && x.fill).map((x) => x.x).sort((a, b) => a - b);
  assert.deepStrictEqual(xs(l), xs(d).map((x) => d.w - x).sort((a, b) => a - b), "mirrored");
  assert.ok(d.items.some((x) => x.k === "text" && x.t === "×"), "the muted string is marked");
  assert.ok(D.draw(D.shape("guitar", "F"), false).items.some((x) => x.k === "box"), "barre");
  const pn = D.shape("piano", "D/F#");
  assert.deepStrictEqual(pn.keys, [14, 18, 21]);
  assert.strictEqual(pn.bass, 6);
  const pd = D.draw(pn);
  assert.strictEqual(pd.items.filter((x) => x.k === "dot").length, 4);
  assert.strictEqual(D.draw(null), null);
  assert.deepStrictEqual(D.chordsOf(["Am", "F", "Am", "N.C.", "C"]), ["Am", "F", "C"]);
});

test("pdf layout: the diagram strip sits under the title, before the words", () => {
  const r = H.parseSheet("Am      F\nΣε θυμάμαι\nC  G\nλα");
  const song = { name: "Song", ln: r.lines, xo: r.xo };
  const measure = (t, f, s) => String(t).length * s * 0.5;
  const L = P.layout([song], { measure, diagram: (c) => D.draw(D.shape("guitar", c)), allChords: H.allChords, chordsOf: D.chordsOf });
  const dg = L.pages[0].items.filter((x) => x.dg);
  assert.deepStrictEqual(dg.map((x) => x.name), ["Am", "F", "C", "G"]);
  const words = L.pages[0].items.find((x) => x.t === "Σε θυμάμαι");
  assert.ok(dg.every((x) => x.y < words.y), "diagrams first");
  const none = P.layout([song], { measure });
  assert.ok(!none.pages[0].items.some((x) => x.dg));
});

test("app wiring: diagrams on this device only, drawn as SVG nodes, strings", () => {
  const html = read("lyricsync/index.html");
  assert.ok(html.indexOf('src="diagrams.js') > html.indexOf('src="sets.js') && html.indexOf('src="diagrams.js') < html.indexOf('src="sheetpdf.js'));
  const app = read("lyricsync/app.js");
  assert.ok(/createElementNS\(SVGNS, "svg"\)/.test(app) && !/innerHTML/.test(app));
  assert.ok(!/fetch\(/.test(read("lyricsync/diagrams.js")), "no download");
  const de = read("i18n/de/lyricsync.js");
  ["dg.label", "dg.guitar", "dg.lefty", "dg.notes", "pdf.dg"].forEach((k) => {
    assert.strictEqual((app.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  });
});
