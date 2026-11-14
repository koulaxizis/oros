// Writer book translation, glossary and quality checks (writer/catqa.js
// and the glossary part of writer/catstore.js, WR-CAT T3): entries and
// their merge, finding terms (endings), every check, CSV and TBX in and
// out (a DTD and an external entity are never followed).
// Run: node --test tests/

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const QA = require("../writer/catqa.js");
const C = require("../writer/catcore.js");
const S = require("../writer/catstore.js");

function glMap(list) {
  const o = {};
  list.forEach(([term, tgt, note, forb, m]) => { o[QA.keyOf("en", "el", term)] = [term, tgt, note || "", forb || "", m || 1, 0]; });
  return o;
}
function memFs() {
  const files = new Map();
  let clock = 1;
  const norm = p => p.replace(/\/+$/, "");
  return {
    files,
    writeText(p, t) { files.set(norm(p), { data: String(t), mtime: clock++ }); return Promise.resolve(); },
    readText(p) { const f = files.get(norm(p)); return f ? Promise.resolve(String(f.data)) : Promise.reject(new Error("ENOENT")); },
    stat(p) { const f = files.get(norm(p)); return f ? Promise.resolve({ size: String(f.data).length, mtime: f.mtime }) : Promise.reject(new Error("ENOENT")); },
    ls(dir) {
      dir = norm(dir) + "/";
      const seen = new Map();
      for (const k of files.keys()) { if (!k.startsWith(dir)) continue; const r = k.slice(dir.length), i = r.indexOf("/"); seen.set(i < 0 ? r : r.slice(0, i), i >= 0); }
      return Promise.resolve([...seen].sort().map(([name, d]) => ({ name, dir: d })));
    },
    mv(a, b) { for (const k of [...files.keys()]) if (k === a || k.startsWith(a + "/")) { files.set(b + k.slice(a.length), files.get(k)); files.delete(k); } return Promise.resolve(); },
    rm(p) { files.delete(norm(p)); return Promise.resolve(); }
  };
}

test("entries: key of the folded term, clean, newer wins", () => {
  assert.equal(QA.keyOf("en", "el", "Sea"), QA.keyOf("en-GB", "el", " sea "));
  assert.equal(QA.keyOf("el", "en", "Θάλασσα"), QA.keyOf("el", "en", "θαλασσα"));
  const k = QA.keyOf("en", "el", "sea");
  const m = QA.mergeEntries([{ [k]: ["sea", "θάλασσα", "", "πέλαγος;  ", 5, 0] }, { [k]: ["sea", "θάλασσα", "noun", "", 7, 0] }]);
  assert.deepEqual(m[k], ["sea", "θάλασσα", "noun", "", 7, 0]);
  assert.deepEqual(QA.cleanEntry(["x", "y", "", "a ;b\nc", 3, 0])[3], "a; b; c");
  assert.equal(QA.cleanEntry([" ", "y", "", "", 3, 0]), null);
});

test("terms: whole words, phrases, endings up to 3 letters, longest first", () => {
  const T = new QA.Terms([glMap([["sea", "θάλασσα"], ["old man", "γέρος"], ["man", "άντρας"], ["Santiago", "Σαντιάγο"], ["seal", "φώκια"]])], "en", "el");
  assert.equal(T.size, 5);
  const hits = T.find("The old man and the sea. Santiagos seal.");
  assert.deepEqual(hits.map(h => h.e.term), ["old man", "sea", "Santiago", "seal"]);
  assert.deepEqual(T.find("Seaside, seas").map(h => h.e.term), []);   // a short term only as a whole word
  const G = new QA.Terms([{ [QA.keyOf("el", "en", "θάλασσα")]: ["θάλασσα", "sea", "", "", 1, 0] }], "el", "en");
  assert.equal(G.find("Της θάλασσας το χρώμα").length, 1);
});

test("check: term, forbidden, numbers, tags, spaces, punctuation, untranslated", () => {
  const src = C.extract({ html: "<p>The old man saw 1,200 fish at 3.50 a.m. on the sea.</p><p>He <b>slept</b>.</p><p>Santiago!</p><p>Is it true?</p>" }, "en");
  const T = new QA.Terms([glMap([["sea", "θάλασσα", "", "πέλαγος"], ["old man", "γέρος"]])], "en", "el");
  const o = { from: "en", to: "el" };
  const rows = {
    0: ["Ο γέρος είδε 1.200 ψάρια στις 3,50 τα ξημερώματα στο πέλαγος.", 2, 1],
    1: ["Κοιμήθηκε  βαθιά.", 2, 1],
    2: ["Santiago!", 2, 1],
    3: ["Είναι αλήθεια;", 2, 1]
  };
  const ks = i => QA.check(src, rows, i, T, o).map(x => x.k);
  assert.deepEqual(ks(0), ["term", "forb"]);              // sea → θάλασσα missing; πέλαγος forbidden; numbers match
  assert.deepEqual(ks(1), ["tag", "space"]);
  assert.deepEqual(ks(2), ["same"]);
  assert.deepEqual(ks(3), []);                             // the Greek question mark is a question mark
  rows[0] = ["Ο γέρος είδε 1.300 ψάρια στη θάλασσα", 2, 1];
  const p0 = QA.check(src, rows, 0, T, o);
  assert.deepEqual(p0.map(x => x.k), ["num", "punct"]);
  assert.equal(p0[0].a, "1200, 3.50");
  assert.deepEqual(QA.check(src, {}, 0, T, o), []);
});

test("checkAll adds another translation of the same source", () => {
  const src = C.extract({ html: "<p>Yes.</p><p>Yes.</p><p>No.</p>" }, "en");
  const all = QA.checkAll(src, { 0: ["Ναι.", 2, 1], 1: ["Μάλιστα.", 2, 1], 2: ["Όχι.", 1, 1] }, null, { from: "en", to: "el" });
  assert.deepEqual(all, [{ i: 1, list: [{ k: "cons", a: "1" }] }]);
});

test("CSV: delimiter, quotes, header names or column order, formula cells kept as text", () => {
  const a = QA.parseCsv('﻿el;en;note\r\n"θάλασσα";sea;"a ""big"" one"\r\nγέρος;old man;\r\n', "en", "el");
  assert.deepEqual(a.entries, [
    { term: "sea", tgt: "θάλασσα", note: 'a "big" one', forb: [] },
    { term: "old man", tgt: "γέρος", note: "", forb: [] }
  ]);
  const b = QA.parseCsv("sea\tθάλασσα\tnoun\tπέλαγος; πόντος\n", "en", "el");
  assert.deepEqual(b.entries[0], { term: "sea", tgt: "θάλασσα", note: "noun", forb: ["πέλαγος", "πόντος"] });
  const out = QA.csv([{ term: "=SUM(A1)", tgt: "x, y", note: "", forb: ["a", "b"] }], "en", "el");
  assert.equal(out, '﻿en,el,note,forbidden\r\n\'=SUM(A1),"x, y",,"a; b"\r\n');
  assert.deepEqual(QA.parseCsv(out, "en", "el").entries[0].tgt, "x, y");
});

test("TBX: round trip, TBX v3, deprecated terms become forbidden, no DTD", () => {
  const list = [{ term: "sea", tgt: "θάλασσα", note: "salt <water>", forb: ["πέλαγος"] }, { term: "old man", tgt: "γέρος", note: "", forb: [] }];
  const x = QA.tbx(list, "en", "el");
  assert.match(x, /<martif type="TBX-Basic"/);
  assert.match(x, /deprecatedTerm-admn-sts/);
  assert.deepEqual(QA.parseTbx(x, "en", "el").entries, list);
  const v3 = `<?xml version="1.0"?><!DOCTYPE tbx [<!ENTITY e SYSTEM "file:///etc/passwd">]>
<tbx type="TBX-Core" style="dca" xml:lang="en"><text><body>
<conceptEntry id="1"><langSec xml:lang="en-US"><termSec><term>ship&e;</term></termSec></langSec>
<langSec xml:lang="el"><termSec><term>πλοίο</term></termSec><termSec><term>καράβι</term><termNote type="administrativeStatus">supersededTerm-admn-sts</termNote></termSec></langSec></conceptEntry>
<conceptEntry id="2"><langSec xml:lang="el"><termSec><term>μόνο</term></termSec></langSec></conceptEntry>
</body></text></tbx>`;
  const r = QA.parseTbx(v3, "en", "el");
  assert.deepEqual(r.entries, [{ term: "ship&e;", tgt: "πλοίο", note: "", forb: ["καράβι"] }]);
  assert.equal(r.skipped, 1);
  assert.equal(QA.parseTbx("<html/>", "en", "el").err, "notbx");
});

test("store: glossaries per device, rename, trash; project meta keeps its glossary", async () => {
  const fs = memFs();
  let t = 1000;
  const A = new S.Store(fs, "deva01", () => t), B = new S.Store(fs, "devb02", () => t);
  const g = await A.createGl("Ο γέρος και η θάλασσα");
  const k = QA.keyOf("en", "el", "sea");
  await A.saveEntries(g.id, { [k]: ["sea", "θάλασσα", "", "", 2000, 0] });
  t = 3000; await B.saveEntries(g.id, { [k]: ["sea", "θάλασσα", "noun", "πέλαγος", 3000, 0] });
  const l = await A.loadGl(g.id);
  assert.deepEqual(l.entries[k], ["sea", "θάλασσα", "noun", "πέλαγος", 3000, 0]);
  assert.ok([...fs.files.keys()].some(n => /\/entries-devb02-\d+\.json$/.test(n)));
  assert.equal(await A.glSig(g.id), l.sig);
  await B.renameGl(g.id, "Χέμινγουεϊ");
  assert.deepEqual((await A.listGls()).map(x => x.name), ["Χέμινγουεϊ"]);
  const p = await A.create({ name: "X", from: "en", to: "el", src: "d", data: C.extract({ html: "<p>Hi.</p>" }, "en") });
  await A.saveMeta(p.id, { gl: g.id });
  assert.equal((await A.open(p.id)).meta.gl, g.id);
  await A.trashGl(g.id);
  assert.deepEqual(await A.listGls(), []);
});
