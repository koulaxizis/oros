// Family Tree .orostree bundle (familytree/ft-core.js section 12:
// packTree / unpackTree / treePhotos, written and read by bundle.js):
// one tree with its photos in media/, opened again as a NEW tree with
// fresh ids, every person and family kept.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const B = require(path.join(__dirname, "..", "bundle.js"));
const F = require(path.join(__dirname, "..", "familytree/ft-core.js"));

const NOW = new Date(2026, 9, 15, 10, 0, 0).getTime();
const MIME = "application/x-oros-tree";
// a 1×1 PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function sample() {
  return F.merge({
    trees: [{ id: "T1", m: 5, name: "Παππούδες / grandparents", home: "P1" },
            { id: "T2", m: 5, name: "Other", home: "" }],
    people: [
      { id: "P1", m: 6, tree: "T1", given: "Γιώργος", family: "Παπαδόπουλος", sex: "m",
        birth: { d: "1920-03-15", q: "", place: "Αθήνα" }, death: { d: "1990", q: "abt", place: "" },
        note: "Line one\nline two", photo: PNG, contact: "C1", parents: [] },
      { id: "P2", m: 6, tree: "T1", given: "Maria", family: "Papa", birthName: "Ioannou", sex: "f",
        birth: { d: "1925", q: "bef", place: "" }, parents: [] },
      { id: "P3", m: 7, tree: "T1", given: "Kid", sex: "x", parents: [{ u: "U1", kind: "adopted" }] },
      { id: "Q1", m: 7, tree: "T2", given: "Elsewhere" }
    ],
    unions: [{ id: "U1", m: 8, tree: "T1", a: "P1", b: "P2", kind: "married",
               start: { d: "1948-06", q: "" }, end: { d: "", q: "" } }],
    tombs: { gone1: 3 }
  }, {});
}
async function pack(d, treeId) {
  const keys = {}, media = {};
  for (const ph of F.treePhotos(d, treeId)) {
    const k = (await B.sha256(ph.bytes)) + "." + ph.ext;
    keys[ph.pid] = k; media[k] = ph.bytes;
  }
  return B.write({
    mime: MIME, app: "familytree", schema: "familytree/1",
    content: F.packTree(d, treeId, keys, "P3"),
    meta: { title: "Παππούδες / grandparents", modified: NOW, id: treeId, language: "el", generator: "orOS Family Tree" },
    media, preview: [{ name: "tree.ged", data: F.exportGedcom(d, treeId, {}), type: "text/plain" }], date: new Date(NOW)
  });
}
function counter() { let n = 0; return () => "new" + (++n); }

test("photoToBytes: a stored data URI → its bytes, nothing else", () => {
  const b = F.photoToBytes(PNG);
  assert.equal(b.ext, "png");
  assert.equal(b.type, "image/png");
  assert.deepEqual([...b.bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(F.photoToBytes("data:image/svg+xml;base64,AAAA"), null);
  assert.equal(F.photoToBytes(""), null);
});

test("packTree: one tree only, photo → media key, no tombstones, source untouched", () => {
  const d = sample();
  const c = F.packTree(d, "T1", { P1: "a".repeat(64) + ".png" }, "P3");
  assert.equal(c.kind, "oros-familytree-package");
  assert.equal(c.ver, 1);
  assert.equal(c.tree.id, "T1");
  assert.equal(c.people.length, 3);
  assert.equal(c.unions.length, 1);
  assert.equal(c.focus, "P3");
  assert.equal(c.tombs, undefined);
  const p1 = c.people.find(p => p.id === "P1");
  assert.equal(p1.photo, "a".repeat(64) + ".png");
  assert.ok(!JSON.stringify(c).includes("base64"), "no base64 in content.json");
  assert.equal(d.people.find(p => p.id === "P1").photo, PNG);
  assert.equal(F.packTree(d, "nope", {}), null);
  assert.equal(F.packTree(d, "T1", {}, "Q1").focus, "", "focus outside the tree is dropped");
  assert.ok(F.isPackage(c));
  assert.ok(!F.isPackage({ kind: "oros-familytree-package", tree: {}, people: "x", unions: [] }));
});

test("save → open: a bundle, then a NEW tree with fresh ids, every field, the photo bytes", async () => {
  const d = sample();
  const bytes = await pack(d, "T1");
  assert.equal(B.sniff(bytes.subarray(0, 128)), MIME);
  const r = await B.read(bytes, { mime: MIME });
  assert.equal(r.app, "familytree");
  assert.equal(r.meta.title, "Παππούδες / grandparents");
  assert.equal(Object.keys(r.media).length, 1);
  const key = Object.keys(r.media)[0];
  assert.match(key, /^[0-9a-f]{64}\.png$/);

  const u = F.unpackTree(r.content, r.media, d, { now: NOW, newId: counter() });
  assert.equal(u.ok, true);
  assert.equal(u.data.trees.length, 1);
  const tr = u.data.trees[0];
  assert.ok(!["T1", "T2"].includes(tr.id));
  assert.equal(tr.name, "Παππούδες / grandparents");
  assert.equal(u.data.people.length, 3);
  assert.equal(u.data.unions.length, 1);
  assert.equal(u.stats.dropped, 0);
  assert.equal(u.stats.refs, 0);
  const old = new Set(["P1", "P2", "P3", "U1", "Q1"]);
  u.data.people.concat(u.data.unions).forEach(x => {
    assert.ok(!old.has(x.id), "fresh id " + x.id);
    assert.equal(x.tree, tr.id);
    assert.equal(x.m, NOW);
  });
  const by = n => u.data.people.find(p => p.given === n);
  const g = by("Γιώργος"), m = by("Maria"), k = by("Kid"), un = u.data.unions[0];
  assert.equal(tr.home, g.id);
  assert.equal(g.family, "Παπαδόπουλος");
  assert.deepEqual(g.birth, { d: "1920-03-15", q: "", place: "Αθήνα" });
  assert.deepEqual(g.death, { d: "1990", q: "abt", place: "" });
  assert.equal(g.dead, true);
  assert.equal(g.note, "Line one\nline two");
  assert.equal(g.contact, "C1");
  assert.equal(g.photo, "", "the app redraws the photo from its bytes");
  assert.equal(m.birthName, "Ioannou");
  assert.deepEqual(m.birth, { d: "1925", q: "bef", place: "" });
  assert.equal(un.a, g.id);
  assert.equal(un.b, m.id);
  assert.equal(un.kind, "married");
  assert.deepEqual(un.start, { d: "1948-06", q: "" });
  assert.deepEqual(k.parents, [{ u: un.id, kind: "adopted" }]);
  assert.equal(u.focus, k.id);
  assert.deepEqual(Object.keys(u.photos), [g.id]);
  assert.equal(u.photos[g.id].type, "image/png");
  assert.deepEqual([...u.photos[g.id].bytes], [...F.photoToBytes(PNG).bytes]);

  // merging it in leaves the original tree as it was
  const after = F.merge(d, u.data);
  assert.equal(after.trees.length, 3);
  assert.deepEqual(after.people.filter(p => p.tree === "T1"), d.people.filter(p => p.tree === "T1"));

  // opening it twice makes two trees
  const u2 = F.unpackTree(r.content, r.media, after, { now: NOW, newId: (() => { let n = 100; return () => "x" + (++n); })() });
  assert.equal(u2.ok, true);
  assert.notEqual(u2.data.trees[0].id, tr.id);
});

test("preview/tree.ged is the app's own GEDCOM export, and it reads back", async () => {
  const d = sample();
  const bytes = await pack(d, "T1");
  assert.ok(Buffer.from(bytes).includes(Buffer.from("preview/tree.ged")));
  const ged = F.exportGedcom(d, "T1", {});
  assert.match(ged, /^0 HEAD/);
  const back = F.parseGedcom(ged, F.emptyData(), { name: "x", now: NOW, newId: counter() });
  assert.equal(back.ok, true);
  assert.equal(back.data.people.length, 3);
});

test("unpackTree: hostile or broken content is cut, never trusted", () => {
  const nid = counter();
  assert.equal(F.unpackTree(null, {}, null, { newId: nid }).err, "format");
  assert.equal(F.unpackTree({ kind: "x" }, {}, null, { newId: nid }).err, "format");
  assert.equal(F.unpackTree({ kind: "oros-familytree-package", ver: 2, tree: {}, people: [], unions: [] }, {}, null, { newId: nid }).err, "newer");
  const c = {
    kind: "oros-familytree-package", ver: 1,
    tree: { id: "T1", m: 1, name: "", home: "ghost" },
    people: [
      { id: "P1", m: 1, tree: "T1", given: "A‮B", photo: "nokey.jpg", parents: [{ u: "missing" }] },
      { id: "P1", m: 1, tree: "T1", given: "dup" },
      { id: "__proto__", m: 1, tree: "T1" },
      { id: "P9", m: 1, tree: "OTHER" },
      { id: "P2", m: 1, tree: "T1", given: "Pic", photo: "k.svg" },
      "junk"
    ],
    unions: [{ id: "U1", m: 1, tree: "T1", a: "P1", b: "ghost", kind: "weird" }],
    focus: "ghost"
  };
  const media = { "k.svg": { bytes: new Uint8Array([60, 115, 118, 103]), type: "image/svg+xml" } };
  const u = F.unpackTree(c, media, null, { now: NOW, newId: nid, name: "From file" });
  assert.equal(u.ok, true);
  assert.equal(u.data.trees[0].name, "From file", "no name in the file → the file name");
  assert.equal(u.data.trees[0].home, "");
  assert.equal(u.data.people.length, 2);
  assert.equal(u.stats.dropped, 4);
  assert.ok(u.stats.refs >= 2);
  const p = u.data.people.find(x => x.given === "AB");
  assert.ok(p, "bidi override stripped");
  assert.deepEqual(p.parents, []);
  assert.equal(u.data.unions[0].b, "");
  assert.equal(u.data.unions[0].kind, "unknown");
  assert.deepEqual(u.photos, {}, "an SVG is never a photo");
  assert.equal(u.focus, "");
});
