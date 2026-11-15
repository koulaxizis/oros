// orOS Base wave B3b: attachment fields (files on the orOS disk),
// gallery and form views, print (base/core.js; OROS_BIBLE.md Part VI
// "Base", B3b).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../base/core.js");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const NAMES = { field: "Name", grid: "Grid", cards: "Cards" };
const A1 = { id: "a1", name: "Cover.png", file: "k3j9x0aa.jpg", kind: "img", size: 2048 };
const A2 = { id: "a2", name: "Contract.pdf", file: "p0q9w8e7.pdf", kind: "pdf", size: 90000 };
function seed() {
  let d = C.addBase(C.empty(), "Books", 100, "b1");
  d = C.addTable(d, "b1", "Titles", 110, NAMES, { t: "t1", f: "fname", v1: "v1", v2: "v2" });
  d = C.addField(d, "t1", "Files", "file", {}, 120, "ffile");
  d = C.addField(d, "t1", "Scans", "file", {}, 121, "fscan");
  d = C.addRecord(d, "t1", { fname: "A", ffile: [A2, A1] }, 200, "r1").data;
  d = C.addRecord(d, "t1", { fname: "B", fscan: [A1] }, 210, "r2").data;
  d = C.addRecord(d, "t1", { fname: "C" }, 220, "r3").data;
  return d;
}
const rec = (d, id) => d.recs.find((r) => r.id === id);

test("an attachment value keeps names, never bytes, and drops what does not fit", () => {
  assert.ok(C.TYPES.includes("file"));
  const v = C.cleanFiles([A1, A1, { id: "x", name: "evil", file: "../../etc/passwd", kind: "img" },
    { id: "y", name: "<img src=x onerror=1>", file: "abc.exe", kind: "script", size: -5, data: "AAAA" }, "nope", null]);
  assert.equal(v.length, 2);
  assert.deepEqual(v[0], A1);
  assert.equal(v[1].kind, "file");
  assert.equal(v[1].size, 0);
  assert.equal(v[1].data, undefined);
  assert.equal(C.cleanFiles([]), undefined);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: "f" + i, name: "n" + i, file: "f" + i + ".jpg", kind: "img", size: 1 }));
  assert.equal(C.cleanFiles(many).length, C.MAX_ATT);
  assert.equal(C.attPath("k3j9x0aa.jpg"), "/internal/Base/Attachments/k3j9x0aa.jpg");
  assert.equal(C.attPath("../x.jpg"), null);
  assert.equal(C.attPath("A.JPG"), null);
});

test("attachments show as their names, filter, sort, export and merge per field", () => {
  const d = seed();
  const ix = C.index(d);
  const f = ix.fields.ffile;
  assert.equal(C.text(ix, rec(d, "r1"), f), "Contract.pdf, Cover.png");
  assert.equal(C.text(ix, rec(d, "r3"), f), "");
  const csv = C.toCsv(ix, ix.tbFields.t1, d.recs);
  assert.match(csv, /"Contract\.pdf, Cover\.png"/);
  assert.doesNotMatch(csv, /k3j9x0aa/);
  const view = C.putRow(d, "views", { id: "vq", tb: "t1", name: "q", kind: "grid", ord: 3, cfg: { filters: [{ f: "ffile", op: "has", v: "contract" }] } }, 300);
  const ix2 = C.index(view);
  assert.deepEqual(C.query(ix2, ix2.views.vq, { today: "2026-11-15" }).map((r) => r.id), ["r1"]);
  const a = C.setValues(d, "r1", { ffile: [A1] }, 400);
  const b = C.setValues(d, "r1", { fname: "A2" }, 410);
  const m = C.merge(a, b);
  assert.deepEqual(rec(m, "r1").v.ffile, [A1]);
  assert.equal(rec(m, "r1").v.fname, "A2");
  assert.equal(C.serialize(C.merge(a, b)), C.serialize(C.merge(b, a)));
});

test("usedFiles names every file a live record keeps; deleted records free theirs", () => {
  let d = seed();
  assert.deepEqual(Object.keys(C.usedFiles(d)).sort(), ["k3j9x0aa.jpg", "p0q9w8e7.pdf"]);
  d = C.remove(d, "r1", 500);
  assert.deepEqual(Object.keys(C.usedFiles(d)), ["k3j9x0aa.jpg"]);     // r2 still has it
  d = C.remove(d, "fscan", 510);
  assert.deepEqual(C.usedFiles(d), {});
  assert.deepEqual(C.usedFiles(C.empty()), {});
});

test("a field cannot be converted into or out of attachments without losing them, and text in a CSV never becomes a file", () => {
  const d = seed();
  const r = C.convert(d, "ffile", "text", {}, 600);
  assert.equal(rec(r.data, "r1").v.ffile, "Contract.pdf, Cover.png");
  const ix = C.index(d);
  assert.equal(C.fromText(ix.fields.ffile, "photo.jpg"), undefined);
  let e = C.addField(d, "t1", "Notes", "text", {}, 130, "fnote");
  e = C.setValues(e, "r1", { fnote: "x.jpg" }, 610);
  const r2 = C.convert(e, "fnote", "file", {}, 620);
  assert.equal(r2.lost, 1);
});

test("a gallery takes its cover from the first photo of cfg.by or the first attachment field", () => {
  let d = C.putRow(seed(), "views", { id: "vg", tb: "t1", name: "Gallery", kind: "gallery", ord: 3, cfg: {} }, 300);
  let ix = C.index(d);
  assert.equal(ix.views.vg.kind, "gallery");
  assert.equal(C.coverField(ix, ix.views.vg).id, "ffile");
  assert.deepEqual(C.coverOf(ix, rec(d, "r1"), ix.fields.ffile), A1);   // the PDF is skipped
  assert.equal(C.coverOf(ix, rec(d, "r2"), ix.fields.ffile), null);
  d = C.putRow(d, "views", { id: "vg", tb: "t1", name: "Gallery", kind: "gallery", ord: 3, cfg: { by: "fscan" } }, 310);
  ix = C.index(d);
  assert.equal(C.coverField(ix, ix.views.vg).id, "fscan");
  assert.deepEqual(C.coverOf(ix, rec(d, "r2"), ix.fields.fscan), A1);
  d = C.putRow(d, "views", { id: "vf", tb: "t1", name: "Form", kind: "form", ord: 4, cfg: {} }, 320);
  assert.equal(C.index(d).views.vf.kind, "form");
});

test("the app keeps files on the disk with textContent only and offers gallery, form and print", () => {
  const app = read("base/app.js");
  const sec = app.slice(app.indexOf("6c. Attachments, gallery, form, print"), app.indexOf("---------- 7. Record dialog"));
  assert.ok(sec.length > 1000);
  assert.doesNotMatch(sec, /innerHTML|insertAdjacentHTML|outerHTML|eval\(|new Function/);
  assert.match(sec, /C\.attPath\(name\)/);
  assert.match(sec, /"image\/jpeg", 0\.82/);           // photos redrawn: no EXIF
  assert.match(sec, /h !== "%PDF-"/);
  assert.match(sec, /setTimeout\(function \(\) \{\s*var used = C\.usedFiles\(data\)/);
  assert.match(app, /\["grid", "cards", "gallery", "kanban", "calendar", "form"\]/);
  assert.match(app, /menu\.print/);
  assert.match(read("base/app.css"), /@media print/);
  for (const k of ["type.file", "kind.gallery", "kind.form", "att.add", "form.submit", "menu.print"]) {
    assert.ok(read("i18n/de/base.js").includes('"' + k + '"'), "de " + k);
  }
});
