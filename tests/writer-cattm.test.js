// Writer book translation, translation memory (writer/cattm.js and the
// memory part of writer/catstore.js, WR-CAT T2): keys and units, the
// per-device bucket files and their merge, exact and fuzzy matches,
// concordance, the word diff, TMX 1.4b in and out.
// Run: node --test tests/

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const TM = require("../writer/cattm.js");
const C = require("../writer/catcore.js");
const S = require("../writer/catstore.js");

function fakeFs() {
  const files = new Map();
  let clock = 1;
  const norm = p => p.replace(/\/+$/, "");
  const api = {
    files,
    writeText(p, t) { files.set(norm(p), { data: String(t), mtime: clock++ }); return Promise.resolve(); },
    write(p, b) { files.set(norm(p), { data: b, mtime: clock++ }); return Promise.resolve(); },
    readText(p) { const f = files.get(norm(p)); return f ? Promise.resolve(String(f.data)) : Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" })); },
    stat(p) { const f = files.get(norm(p)); return f ? Promise.resolve({ path: p, dir: false, size: String(f.data).length, mtime: f.mtime }) : Promise.reject(new Error("ENOENT")); },
    ls(dir) {
      dir = norm(dir) + "/";
      const seen = new Map();
      for (const k of files.keys()) {
        if (!k.startsWith(dir)) continue;
        const rest = k.slice(dir.length), i = rest.indexOf("/");
        seen.set(i < 0 ? rest : rest.slice(0, i), i >= 0);
      }
      return Promise.resolve([...seen].sort().map(([name, d]) => ({ name, dir: d })));
    },
    mv(a, b) {
      a = norm(a); b = norm(b);
      for (const k of [...files.keys()]) if (k === a || k.startsWith(a + "/")) { files.set(b + k.slice(a.length), files.get(k)); files.delete(k); }
      return Promise.resolve();
    },
    rm(p) { p = norm(p); for (const k of [...files.keys()]) if (k === p || k.startsWith(p + "/")) files.delete(k); return Promise.resolve(); }
  };
  return api;
}

function mapOf(list) {
  const o = {};
  list.forEach(([from, to, s, t, m]) => { o[TM.keyOf(from, to, s)] = [s, t, m || 1, 0]; });
  return o;
}

test("keys: base languages, whitespace does not matter, tags do", () => {
  const k = TM.keyOf("en-US", "el_GR", "Hello  world.");
  assert.match(k, /^en-el-[0-9a-f]{16}$/);
  assert.equal(k, TM.keyOf("en", "el", " Hello world. "));
  assert.notEqual(k, TM.keyOf("en", "el", "\u27E61\u27E7Hello\u27E6/1\u27E7 world."));
  assert.notEqual(k, TM.keyOf("en", "de", "Hello world."));
  assert.equal(TM.keyOf("en", "el", "  "), "");
  assert.deepEqual(TM.pairOf(k), { from: "en", to: "el" });
  assert.ok(TM.bucketOf(k) >= 0 && TM.bucketOf(k) < TM.BUCKETS);
});

test("units merge: newer stamp wins, a deletion is a unit too, bad ones are dropped", () => {
  const k = TM.keyOf("en", "el", "Yes.");
  const m = TM.mergeUnits([{ [k]: ["Yes.", "Ναι.", 5, 0] }, { [k]: ["Yes.", "Μάλιστα.", 7, 0], bad: ["x", "y", 9, 0] }, { [k]: ["Yes.", "", 6, 1] }]);
  assert.deepEqual(Object.keys(m), [k]);
  assert.deepEqual(m[k], ["Yes.", "Μάλιστα.", 7, 0]);
  assert.deepEqual(TM.mergeUnits([{ [k]: ["Yes.", "", 8, 1] }, m])[k], ["Yes.", "", 8, 1]);
  assert.equal(TM.cleanUnit(["a", "b", -1, 0]), null);
  assert.equal(TM.cleanUnit(["a", 3, 1, 0]), null);
  assert.deepEqual(TM.readUnitsFile({ v: 1, u: { [k]: ["Yes.", "Ναι.", 3, 0] } }, "deva01", TM.bucketOf(k) === 0 ? 1 : 0), {});
  assert.deepEqual(TM.unitsName("units-deva01-31.json"), { dev: "deva01", bucket: 31 });
  assert.equal(TM.unitsName("units-deva01-32.json"), null);
});

test("lookup: 100% exact, 99% same words, fuzzy from 70%, best first, one per translation", () => {
  const map = mapOf([
    ["en", "el", "The rain fell all night.", "Η βροχή έπεφτε όλη νύχτα.", 5],
    ["en", "el", "The rain fell all day.", "Η βροχή έπεφτε όλη μέρα.", 6],
    ["en", "el", "The rain fell all NIGHT.", "Η βροχή έπεφτε ΟΛΗ νύχτα.", 4],
    ["en", "el", "Nothing like it at all.", "Τίποτα τέτοιο.", 3],
    ["en", "de", "The rain fell all night.", "Es regnete die ganze Nacht.", 9]
  ]);
  const ix = new TM.Index([map], "en", "el");
  assert.equal(ix.size, 4);
  const r = ix.lookup("The rain fell all night.");
  assert.equal(r[0].score, 100);
  assert.equal(r[0].tgt, "Η βροχή έπεφτε όλη νύχτα.");
  assert.ok(r.some(x => x.score === 99), "same words, other case and no full stop");
  const f = ix.lookup("The rain fell all evening.");
  assert.equal(f[0].tgt === "Η βροχή έπεφτε όλη νύχτα." || f[0].tgt === "Η βροχή έπεφτε όλη μέρα.", true);
  assert.ok(f[0].score >= 70 && f[0].score < 99);
  assert.ok(f.every(x => x.tgt !== "Τίποτα τέτοιο."));
  assert.deepEqual(ix.lookup("Completely different words here."), []);
  // tags are not words: a tagged source still finds the plain one
  assert.ok(ix.lookup("The \u27E61\u27E7rain\u27E6/1\u27E7 fell all night.")[0].score >= 99);
  // a deleted unit is not offered
  const k = TM.keyOf("en", "el", "The rain fell all night.");
  const del = TM.mergeUnits([map, { [k]: ["The rain fell all night.", "", 99, 1] }]);
  assert.notEqual(new TM.Index([del], "en", "el").lookup("The rain fell all night.")[0].score, 100);
});

test("two memories: the newer copy of the same unit", () => {
  const a = mapOf([["en", "el", "Go.", "Πήγαινε.", 5]]), b = mapOf([["en", "el", "Go.", "Φύγε.", 8]]);
  assert.equal(new TM.Index([a, b], "en", "el").lookup("Go.")[0].tgt, "Φύγε.");
});

test("concordance: phrase in source or translation, accents ignored, newest first", () => {
  const ix = new TM.Index([mapOf([
    ["en", "el", "The old man and the sea.", "Ο γέρος και η θάλασσα.", 5],
    ["en", "el", "By the sea.", "Δίπλα στη θάλασσα.", 9],
    ["en", "el", "A tree.", "Ένα δέντρο.", 7]
  ])], "en", "el");
  assert.deepEqual(ix.concord("the sea").map(x => x.tgt), ["Δίπλα στη θάλασσα.", "Ο γέρος και η θάλασσα."]);
  assert.deepEqual(ix.concord("θαλασσα").length, 2);
  assert.deepEqual(ix.concord("ενα δεντρο").map(x => x.src), ["A tree."]);
  assert.deepEqual(ix.concord("x"), []);
});

test("diff marks the words that differ", () => {
  const d = TM.diff("The rain fell all evening.", "The rain fell all night.");
  assert.deepEqual(d.filter(x => x.op === 1).map(x => x.t.trim()), ["night"]);
  assert.deepEqual(d.filter(x => x.op === -1).map(x => x.t.trim()), ["evening"]);
  assert.equal(d.filter(x => x.op !== -1).map(x => x.t).join(""), "The rain fell all night.");
});

test("TMX: export and import keep pairs, tags, dates", () => {
  const map = mapOf([
    ["en", "el", "A \u27E61\u27E7bold\u27E6/1\u27E7 word\u27E62/\u27E7 & <more>.", "Μια \u27E61\u27E7έντονη\u27E6/1\u27E7 λέξη\u27E62/\u27E7 & <κι άλλα>.", Date.UTC(2026, 10, 13, 8, 0, 0)],
    ["en", "el", "Open \u27E61\u27E7only.", "Μόνο \u27E61\u27E7ανοιχτό.", Date.UTC(2026, 10, 13, 8, 0, 1)]
  ]);
  const x = TM.tmx(TM.unitsOf(map), { name: "Γλαρόλυκοι" });
  assert.match(x, /<tmx version="1.4">/);
  assert.match(x, /srclang="en"/);
  assert.match(x, /<bpt i="1" x="1"\/>bold<ept i="1"\/>/);
  assert.match(x, /<ph x="2"\/>/);
  assert.match(x, /<it pos="begin" x="1"\/>/);
  assert.match(x, /&amp; &lt;more&gt;/);
  assert.match(x, /changedate="20261113T080000Z"/);
  const r = TM.parseTmx(x);
  assert.equal(r.units.length, 2);
  const back = {};
  r.units.forEach(u => { back[TM.keyOf(u.from, u.to, u.src)] = [u.src, u.tgt, u.m, 0]; });
  assert.deepEqual(back, map);
});

test("TMX from other tools: header srclang, several targets, hi, ut, DTD and entities", () => {
  const x = `<?xml version="1.0"?>
<!DOCTYPE tmx SYSTEM "tmx14.dtd" [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<tmx version="1.4"><header srclang="en-US" datatype="rtf" segtype="sentence" o-tmf="x" adminlang="en" creationtool="T" creationtoolversion="1"/>
<body>
<tu tuid="1"><tuv xml:lang="en-US"><seg>Press <bpt i="1" x="5">{\b </bpt>Start<ept i="1">}</ept> now&xxe;.<ph x="9">{\tab}</ph></seg></tuv>
<tuv xml:lang="el-GR"><seg>Πάτα <bpt i="1" x="5">{\b </bpt>Έναρξη<ept i="1">}</ept> τώρα.<ph x="9">{\tab}</ph></seg></tuv>
<tuv lang="de"><seg><hi>Drücke</hi> <ut>{x}</ut>jetzt &#x2014; &amp;.</seg></tuv></tu>
<tu><tuv xml:lang="el"><seg>Μόνο ελληνικά</seg></tuv></tu>
<tu><tuv xml:lang="en"><seg>  </seg></tuv><tuv xml:lang="el"><seg>κενό</seg></tuv></tu>
</body></tmx>`;
  const r = TM.parseTmx(x);
  assert.equal(r.srclang, "en");
  assert.equal(r.total, 3);
  assert.equal(r.skipped, 2);
  assert.deepEqual(r.units.map(u => [u.from, u.to, u.src, u.tgt]), [
    ["en", "el", "Press \u27E61\u27E7Start\u27E6/1\u27E7 now&xxe;.\u27E62/\u27E7", "Πάτα \u27E61\u27E7Έναρξη\u27E6/1\u27E7 τώρα.\u27E62/\u27E7"],
    ["en", "de", "Press \u27E61\u27E7Start\u27E6/1\u27E7 now&xxe;.\u27E62/\u27E7", "Drücke jetzt \u2014 &."]
  ]);
  assert.equal(TM.parseTmx("<html></html>").err, "notmx");
});

test("store: memories per device, bucket files, rename, trash", async () => {
  const fs = fakeFs();
  let t = 1000;
  const A = new S.Store(fs, "deva01", () => t), B = new S.Store(fs, "devb02", () => t);
  const m = await A.createTm("Γλαρόλυκοι");
  assert.deepEqual((await B.listTms()).map(x => x.name), ["Γλαρόλυκοι"]);
  const k1 = TM.keyOf("en", "el", "One."), k2 = TM.keyOf("en", "el", "Two.");
  await A.saveUnits(m.id, { [k1]: ["One.", "Ένα.", 2000, 0] });
  await B.saveUnits(m.id, { [k1]: ["One.", "Μία.", 3000, 0], [k2]: ["Two.", "Δύο.", 3000, 0] });
  const names = [...fs.files.keys()].map(k => k.split("/").pop()).filter(n => n.startsWith("units-"));
  assert.ok(names.every(n => /^units-(deva01|devb02)-\d+\.json$/.test(n)));
  assert.ok(names.some(n => n.includes("deva01")) && names.some(n => n.includes("devb02")));
  const la = await A.loadTm(m.id);
  assert.equal(la.units[k1][1], "Μία.");
  assert.equal(la.units[k2][1], "Δύο.");
  const sig = await A.tmSig(m.id);
  assert.equal(sig, la.sig);
  t = 5000; await B.saveUnits(m.id, { [k2]: ["Two.", "Δυο.", 5000, 0] });
  assert.notEqual(await A.tmSig(m.id), sig);
  await A.renameTm(m.id, "Εκδόσεις");
  assert.deepEqual((await B.listTms()).map(x => x.name), ["Εκδόσεις"]);
  // a half-made memory (no tm.json) is not listed
  await fs.writeText(S.TMROOT + "/tmhalfmade1/units-deva01-0.json", "{}");
  assert.equal((await A.listTms()).length, 1);
  await A.trashTm(m.id);
  assert.deepEqual(await A.listTms(), []);
  const rec = [...fs.files.keys()].find(k => /^\/internal\/\.trash\/[^/]+\.json$/.test(k));
  assert.equal(JSON.parse(fs.files.get(rec).data).path, S.TMROOT + "/" + m.id);
});

test("project meta keeps the memory it writes to", async () => {
  const fs = fakeFs();
  let t = 1000;
  const A = new S.Store(fs, "deva01", () => t);
  const p = await A.create({ name: "X", from: "en", to: "el", src: "d", data: C.extract({ html: "<p>Hi.</p>" }, "en") });
  await A.saveMeta(p.id, { tm: "tmabcdef12" });
  t = 2000; await A.saveMeta(p.id, { name: "Y" });
  const o = await A.open(p.id);
  assert.equal(o.meta.tm, "tmabcdef12");
  assert.equal(o.meta.name, "Y");
});

test("Assistant / orOS Gate read: Writer's translations summary (WriterCommands.translations)", () => {
  const W = require("../writer/commands.js");
  const sum = {
    traaaaaa1: [45.5, 1000, "Book · EL", "en", "el", "d1", 455, Date.UTC(2026, 10, 13)],
    trbbbbbb2: [100, 20, "Other", "en", "de", "d2", 20, Date.UTC(2026, 10, 14)],
    trcccccc3: [10, 20],                     // a T1 summary: no name, not listed
    bad: [1, 1, "x", "en", "el", "d1", 1, 1]
  };
  const r = W.translations(sum, "d1");
  assert.deepEqual(r.map(x => x.name), ["Book · EL", "Other"]);
  assert.equal(r[0].of_this_document, true);
  assert.equal(r[0].percent_done, 45.5);
  assert.equal(r[0].words_done, 455);
  assert.equal(r[1].last_worked, "2026-11-14");
  assert.deepEqual(W.translations(null, "d1"), []);
});
