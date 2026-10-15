// Wiki .oroswiki (wiki/io.js toPackage / fromPackage + bundle.js):
// one wiki = one bundle with its articles, parallel edits, history
// and pictures; opening makes a new wiki with fresh ids.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "wiki/core.js"));
const IO = require(path.join(ROOT, "wiki/io.js"));
const B = require(path.join(ROOT, "bundle.js"));
const MIME = "application/x-oros-wiki";

const PIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
function sample(picId) {
  return C.normData({
    ver: 1,
    wikis: [{ id: "wtest0001", m: 10, n: "Κήπος", main: "atest0001" }, { id: "wother001", m: 10, n: "Other", main: "" }],
    arts: [
      { id: "atest0001", m: 20, w: "wtest0001", t: "Αρχική", x: "See [[Ελιές]].\n[[File:" + picId + "|right|200px|Λεζάντα]]",
        r: "rtest0002", anc: ["rtest0001"], alt: [{ r: "rtest0009", m: 19, t: "Αρχική", x: "other device" }], s: "edit", c: 5 },
      { id: "atest0002", m: 15, w: "wtest0001", t: "Ελιές", x: "Olives.", r: "rtest0003", anc: [], alt: [], c: 6 },
      { id: "aother001", m: 15, w: "wother001", t: "Not mine", x: "x", r: "rother001", anc: [], alt: [] }
    ],
    tombs: {}
  });
}
const REVS = [
  { v: 1, a: "atest0001", w: "wtest0001", r: "rtest0001", p: "", m: 5, t: "Αρχική", x: "first [[File:" + "b".repeat(64) + ".jpg]]", s: "New article", dev: "Phone" },
  { v: 1, a: "atest0001", w: "wtest0001", r: "rtest0002", p: "rtest0001", m: 20, t: "Αρχική", x: "second", s: "edit", dev: "" },
  { v: 1, a: "aother001", w: "wother001", r: "rother001", p: "", m: 15, t: "Not mine", x: "x", s: "", dev: "" }
];

test("toPackage: only this wiki, history of its articles, every picture used", async () => {
  const pic = (await B.sha256(PIC)) + ".png";
  const p = IO.toPackage(sample(pic), "wtest0001", REVS);
  assert.equal(p.content.kind, "oros-wiki-package");
  assert.equal(p.content.ver, 1);
  assert.deepStrictEqual(p.content.wiki, { id: "wtest0001", m: 10, n: "Κήπος", main: "atest0001" });
  assert.deepStrictEqual(p.content.arts.map(a => a.id).sort(), ["atest0001", "atest0002"]);
  assert.equal(p.content.arts.find(a => a.id === "atest0001").alt[0].x, "other device");
  assert.deepStrictEqual(p.content.revs.map(r => r.r), ["rtest0001", "rtest0002"]);
  assert.deepStrictEqual(p.images, [pic, "b".repeat(64) + ".jpg"]);
  assert.equal(IO.toPackage(sample(pic), "wnothere1", REVS), null);
});

test("bundle round trip: fresh ids, history and parallel edits kept, picture renamed", async () => {
  const pic = (await B.sha256(PIC)) + ".png";
  const data = sample(pic);
  const p = IO.toPackage(data, "wtest0001", REVS);
  const arts = p.content.arts;
  const bytes = await B.write({ mime: MIME, app: "wiki", schema: "wiki/1", content: p.content,
    meta: { title: "Κήπος", language: "el", generator: "orOS Wiki" },
    media: { [pic]: PIC }, preview: IO.previewPages(arts) });
  assert.equal(B.sniff(bytes.subarray(0, 128)), MIME);
  const r = await B.read(bytes, { mime: MIME });
  assert.ok(r.media[pic]);
  assert.equal(r.meta.title, "Κήπος");
  let n = 0;
  const out = IO.fromPackage(r.content, { uid: (k) => k + "new" + String(++n).padStart(4, "0"), now: 1000,
    pics: { [pic]: "c".repeat(64) + ".png" } });
  assert.equal(out.cut, 0);
  assert.equal(out.wiki.n, "Κήπος");
  assert.ok(C.WIKI_RE.test(out.wiki.id) && out.wiki.id !== "wtest0001");
  const home = out.arts.find(a => a.t === "Αρχική");
  assert.equal(out.wiki.main, home.id);
  assert.ok(out.arts.every(a => a.w === out.wiki.id && !/test/.test(a.id) && !/test/.test(a.r)));
  assert.match(home.x, /\[\[File:c{64}\.png\|right\|200px\|Λεζάντα\]\]/);
  assert.equal(home.alt.length, 1);
  assert.equal(home.alt[0].x, "other device");
  assert.equal(home.anc.length, 1);
  // the revision chain follows the new ids
  assert.equal(out.revs.length, 2);
  const [r1, r2] = out.revs;
  assert.equal(r2.r, home.r);
  assert.equal(r2.p, r1.r);
  assert.equal(home.anc[0], r1.r);
  assert.equal(r1.a, home.id);
  assert.equal(r1.dev, "Phone");
  // the new wiki is valid in the slice next to the old one
  const merged = C.normData({ ver: 1, wikis: data.wikis.concat([out.wiki]), arts: data.arts.concat(out.arts), tombs: {} });
  assert.equal(merged.wikis.length, 3);
  assert.equal(merged.arts.length, 5);
  out.revs.forEach(v => assert.ok(C.parseRevFile(JSON.stringify(v))));
});

test("preview: one ASCII .md per article, pictures in ../media", async () => {
  const pic = (await B.sha256(PIC)) + ".png";
  const pages = IO.previewPages(IO.toPackage(sample(pic), "wtest0001", []).content.arts);
  assert.deepStrictEqual(pages.map(p => p.name).sort(), ["archiki.md", "elies.md"]);
  pages.forEach(p => assert.ok(B.safePath("preview/" + p.name)));
  const home = pages.find(p => p.name === "archiki.md").data;
  assert.match(home, /^# Αρχική/);
  assert.ok(home.includes("](../media/" + pic));
  const dup = IO.previewPages([{ t: "Ω" }, { t: "ω" }, { t: "!!" }]);
  assert.deepStrictEqual(dup.map(p => p.name), ["o.md", "o (2).md", "article.md"]);
});

test("fromPackage refuses other content and newer versions", () => {
  assert.throws(() => IO.fromPackage({ kind: "oros-notes-package", ver: 1 }), (e) => e.code === "content");
  assert.throws(() => IO.fromPackage(null), (e) => e.code === "content");
  assert.throws(() => IO.fromPackage({ kind: "oros-wiki-package", ver: 2 }), (e) => e.code === "newer");
  const out = IO.fromPackage({ kind: "oros-wiki-package", ver: 1, wiki: { n: "<b>x</b>" },
    arts: [{ id: "abadid", t: "x" }, { id: "agood0001", w: "wzzzzzz1", t: "  [x] ", x: 5 }, "junk"],
    revs: [{ a: "agood0001", r: "nope" }] }, { max: 5 });
  assert.equal(out.arts.length, 1);
  assert.equal(out.arts[0].t, "x");
  assert.equal(out.arts[0].x, "");
  assert.equal(out.revs.length, 0);
  const cut = IO.fromPackage({ kind: "oros-wiki-package", ver: 1,
    arts: [1, 2, 3].map(i => ({ id: "aart000" + i, w: "wzzzzzz1", t: "T" + i })) }, { max: 2 });
  assert.equal(cut.arts.length, 2);
  assert.equal(cut.cut, 1);
});
