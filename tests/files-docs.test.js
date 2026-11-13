// Files › Documents, wave W1 (files/docs-core.js): DOCS v1 model,
// symmetric canonical merge, built-in types, suggestions for "keep
// until", moves, finding a file again by SHA-256, filters, export and
// import. Plus wiring checks of files/docs.js and files.js.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const D = require("../files/docs-core.js");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const T0 = Date.UTC(2026, 10, 13, 9, 0, 0);
const H1 = "a".repeat(64), H2 = "b".repeat(64);

function withDocs(list) {
  let s = D.norm(null);
  list.forEach((d, i) => { s = D.putDoc(s, d, T0 + i); });
  return s;
}

test("norm drops bad rows and keeps a canonical shape", () => {
  const s = D.norm({
    docs: [
      { id: "d-1", m: 5, p: "/internal/Documents/2026/a.pdf", t: " A ", tg: ["tg-b", "tg-a", "tg-a", "bad"], d: "2026-02-30", ex: "2027-01-01", amt: "12.345", cur: "EUR", h: H1 },
      { id: "d-2", m: 5, p: "/elsewhere/x.pdf" },
      { id: "x-3", m: 5, p: "/internal/y.pdf" },
      { id: "d-4", m: 0, p: "/internal/z.pdf" },
      { id: "d-5", m: 3, p: "/internal/../z.pdf" }
    ],
    tags: [{ id: "tg-a", m: 1, n: "Home" }, { id: "tg-b", m: 1, n: "" }],
    junk: 1
  });
  assert.equal(s.docs.length, 1);
  const d = s.docs[0];
  assert.deepEqual(d.tg, ["tg-a", "tg-b"]);
  assert.equal(d.t, "A");
  assert.equal(d.d, undefined, "an impossible date is dropped");
  assert.equal(d.ex, "2027-01-01");
  assert.equal(d.amt, 12.35);
  assert.equal(d.h, H1);
  assert.deepEqual(s.tags.map((t) => t.id), ["tg-a"]);
  assert.equal(s.junk, undefined);
  assert.equal(JSON.stringify(D.norm(s)), JSON.stringify(s), "idempotent");
});

test("merge is symmetric, canonical and idempotent (R5, R26)", () => {
  const a = withDocs([{ id: "d-1", p: "/internal/a.pdf", t: "A" }, { id: "d-2", p: "/internal/b.pdf", t: "B" }]);
  let b = D.putDoc(a, Object.assign({}, D.getDoc(a, "d-1"), { t: "A edited" }), T0 + 100);
  b = D.dropDoc(b, "d-2", T0 + 100);
  const ab = D.merge(a, b), ba = D.merge(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(JSON.stringify(D.merge(ab, ab)), JSON.stringify(ab));
  assert.equal(JSON.stringify(D.norm(ab)), JSON.stringify(ab));
  assert.equal(D.getDoc(ab, "d-1").t, "A edited");
  assert.equal(D.getDoc(ab, "d-2"), null, "the removal wins over the older row");
  // Same stamp on two devices: the larger JSON wins on both.
  const x = D.norm({ docs: [{ id: "d-9", m: 50, p: "/internal/q.pdf", t: "x" }] });
  const y = D.norm({ docs: [{ id: "d-9", m: 50, p: "/internal/q.pdf", t: "y" }] });
  assert.equal(JSON.stringify(D.merge(x, y)), JSON.stringify(D.merge(y, x)));
});

test("a newer edit brings a removed row back everywhere (R17)", () => {
  let s = withDocs([{ id: "d-1", p: "/internal/a.pdf", t: "A" }]);
  const removed = D.dropDoc(s, "d-1", T0 + 10);
  const back = D.putDoc(removed, { id: "d-1", p: "/internal/a.pdf", t: "A again", tg: [], ln: [] }, T0 + 10);
  assert.ok(D.getDoc(back, "d-1"));
  assert.ok(D.getDoc(back, "d-1").m > removed.tombs["d-1"]);
  assert.ok(D.getDoc(D.merge(removed, back), "d-1"), "the other device's tombstone does not hide it");
});

test("only a real change stamps (R27)", () => {
  const s = withDocs([{ id: "d-1", p: "/internal/a.pdf", t: "A" }]);
  const same = D.putDoc(s, Object.assign({}, D.getDoc(s, "d-1")), T0 + 999);
  assert.equal(same, s);
});

test("built-in types are code; own edits and removals sync", () => {
  let s = D.norm(null);
  assert.deepEqual(s.types, [], "nothing stored for built-ins (R16)");
  assert.equal(D.types(s, "en")[0].name, "Receipt", "English without the view's strings");
  D.setNames((id) => ({ "ty-receipt": "Apodeixi" })[id] || "");
  const el = D.types(s, "el");
  assert.equal(el[0].id, "ty-receipt");
  assert.equal(el[0].name, "Apodeixi", "the view's string table names built-ins");
  assert.equal(el[1].name, "Invoice", "English fallback");
  D.setNames(null);
  s = D.putType(s, { id: "ty-receipt", kY: 7 }, T0);
  assert.equal(D.typeOf(s, "ty-receipt", "en").name, "Receipt", "settings only: the name stays translated");
  assert.equal(D.typeOf(s, "ty-receipt", "en").kY, 7);
  assert.equal(D.types(s, "en").find((t) => t.id === "ty-medical").pv, true);
  s = D.putType(s, { id: "ty-tax", n: "Taxes", kY: 10 }, T0);
  assert.equal(D.typeOf(s, "ty-tax", "el").name, "Taxes");
  assert.equal(D.typeOf(s, "ty-tax", "en").kY, 10);
  s = D.dropType(s, "ty-bank", T0 + 1);
  assert.equal(D.typeOf(s, "ty-bank", "en"), null);
  s = D.putType(s, { id: "ty-own1", n: "Recipes" }, T0 + 2);
  const names = D.types(s, "en").map((t) => t.name);
  assert.equal(names[names.length - 1], "Recipes");
});

test("removing a tag, sender or type leaves the documents that named them", () => {
  let s = D.norm(null);
  let r = D.ensureTag(s, "Σπίτι", T0, "x1"); s = r.state; const tg = r.id;
  r = D.ensureTag(s, "σπιτι", T0, "x2");
  assert.equal(r.id, tg, "the same tag by folded name");
  r = D.ensureCorr(s, "ΔΕΗ", T0, "c1"); s = r.state; const co = r.id;
  s = D.putDoc(s, { id: "d-1", p: "/internal/a.pdf", t: "A", tg: [tg], co: co, ty: "ty-bill" }, T0 + 1);
  s = D.dropTag(s, tg, T0 + 2);
  s = D.dropCorr(s, co, T0 + 3);
  s = D.dropType(s, "ty-bill", T0 + 4);
  const d = D.getDoc(s, "d-1");
  assert.deepEqual(d.tg, []);
  assert.equal(d.co, undefined);
  assert.equal(d.ty, undefined);
});

test("suggested keep-until dates follow the type (suggestion only)", () => {
  const s = D.norm(null);
  const ty = (id) => D.typeOf(s, id, "en");
  assert.equal(D.suggestKeep(ty("ty-invoice"), { d: "2026-03-15" }, "2026-11-13"), "2031-03-15");
  assert.equal(D.suggestKeep(ty("ty-invoice"), {}, "2026-11-13"), "2031-11-13");
  assert.equal(D.suggestKeep(ty("ty-warranty"), { ex: "2028-06-01" }, "2026-11-13"), "2028-06-01");
  assert.equal(D.suggestKeep(ty("ty-warranty"), {}, "2026-11-13"), "");
  assert.equal(D.suggestKeep(ty("ty-medical"), {}, "2026-11-13"), "forever");
  assert.equal(D.suggestKeep(ty("ty-other"), {}, "2026-11-13"), "");
  assert.equal(D.addYears("2024-02-29", 1), "2025-02-28");
});

test("adding files: once per file, never from the Trash", () => {
  let r = D.addFiles(D.norm(null), [
    { p: "/internal/Scans/Λογαριασμός_ΔΕΗ.pdf", mtime: Date.UTC(2026, 0, 5, 12), h: H1 },
    { p: "/internal/.trash/x/a.pdf" },
    { p: "/internal/Scans/Λογαριασμός_ΔΕΗ.pdf" }
  ], T0, "r");
  assert.equal(r.added.length, 1);
  const d = r.state.docs[0];
  assert.equal(d.t, "Λογαριασμός ΔΕΗ");
  assert.equal(d.d, "2026-01-05");
  assert.equal(d.h, H1);
  assert.ok(D.isDocument(r.state, "/internal/Scans/Λογαριασμός_ΔΕΗ.pdf"));
  assert.ok(D.isDocument(r.state, "/internal/Other/copy.pdf", H1), "found by hash");
  assert.ok(D.isDocument(D.norm(null), "/internal/Documents/2026/x.jpg"), "the Documents folder counts");
  assert.ok(!D.isDocument(r.state, "/internal/Pictures/cat.jpg", H2));
  assert.equal(D.addDir(T0), "/internal/Documents/2026");
});

test("moves in Files carry documents; other moves are found by SHA-256", () => {
  let s = withDocs([
    { id: "d-1", p: "/internal/Scans/a.pdf", t: "A", h: H1 },
    { id: "d-2", p: "/internal/Scans/sub/b.pdf", t: "B", h: H2 },
    { id: "d-3", p: "/internal/Scansx/c.pdf", t: "C" }
  ]);
  s = D.carry(s, "/internal/Scans", "/internal/Paper", T0 + 50);
  assert.equal(D.getDoc(s, "d-1").p, "/internal/Paper/a.pdf");
  assert.equal(D.getDoc(s, "d-2").p, "/internal/Paper/sub/b.pdf");
  assert.equal(D.getDoc(s, "d-3").p, "/internal/Scansx/c.pdf", "a sibling with the same prefix stays");
  const r = D.relocate(s, [
    { p: "/internal/Elsewhere/a renamed.pdf", h: H1 },
    { p: "/internal/Paper/sub/b.pdf", h: H2 },
    { p: "/internal/.trash/z/a.pdf", h: H1 }
  ], T0 + 60);
  assert.equal(r.moved, 1);
  assert.equal(D.getDoc(r.state, "d-1").p, "/internal/Elsewhere/a renamed.pdf");
  assert.equal(D.getDoc(r.state, "d-2").p, "/internal/Paper/sub/b.pdf");
});

test("filters: type, tag, year, expiring soon, keep passed, text with accents", () => {
  let s = D.norm(null);
  let r = D.ensureTag(s, "Αυτοκίνητο", T0, "t1"); s = r.state; const car = r.id;
  r = D.ensureCorr(s, "Interamerican", T0, "c1"); s = r.state; const ins = r.id;
  s = D.putDoc(s, { id: "d-1", p: "/internal/a.pdf", t: "Ασφάλεια αυτοκινήτου", ty: "ty-insurance", tg: [car], co: ins, d: "2026-01-10", ex: "2026-12-01" }, T0);
  s = D.putDoc(s, { id: "d-2", p: "/internal/b.pdf", t: "Παλιό τιμολόγιο", ty: "ty-invoice", d: "2019-05-01", kp: "2024-05-01" }, T0);
  s = D.putDoc(s, { id: "d-3", p: "/internal/c.pdf", t: "Untitled scan" }, T0);
  const today = "2026-11-13";
  assert.deepEqual(D.filter(s, {}, today, "el").map((d) => d.id), ["d-1", "d-2", "d-3"]);
  assert.deepEqual(D.filter(s, { ty: "ty-invoice" }, today, "el").map((d) => d.id), ["d-2"]);
  assert.deepEqual(D.filter(s, { tg: car }, today, "el").map((d) => d.id), ["d-1"]);
  assert.deepEqual(D.filter(s, { year: "2019" }, today, "el").map((d) => d.id), ["d-2"]);
  assert.deepEqual(D.filter(s, { flag: "soon" }, today, "el").map((d) => d.id), ["d-1"]);
  assert.deepEqual(D.filter(s, { flag: "keep" }, today, "el").map((d) => d.id), ["d-2"]);
  assert.deepEqual(D.filter(s, { flag: "untyped" }, today, "el").map((d) => d.id), ["d-3"]);
  assert.deepEqual(D.filter(s, { text: "ασφαλεια INTERAMERICAN" }, today, "el").map((d) => d.id), ["d-1"]);
  assert.deepEqual(D.filter(s, { text: "τιμολογιο" }, today, "el").map((d) => d.id), ["d-2"], "the type's name is searched too");
  assert.deepEqual(D.filter(s, { text: "ρεύμα" }, today, "el", (d) => d.id === "d-3" ? "Λογαριασμός ρεύματος" : "").map((d) => d.id), ["d-3"]);
  assert.deepEqual(D.years(s), ["2026", "2019"]);
  assert.deepEqual(D.counts(s, today), { all: 3, soon: 1, keep: 1, untyped: 1 });
});

test("private documents: Medical, ID, or linked to Health", () => {
  const s = withDocs([
    { id: "d-1", p: "/internal/a.pdf", ty: "ty-medical" },
    { id: "d-2", p: "/internal/b.pdf", ty: "ty-id" },
    { id: "d-3", p: "/internal/c.pdf", ln: [{ a: "health", r: { id: "x" } }] },
    { id: "d-4", p: "/internal/d.pdf", ty: "ty-receipt" }
  ]);
  assert.deepEqual(s.docs.filter((d) => D.isPrivate(s, d)).map((d) => d.id), ["d-1", "d-2", "d-3"]);
});

test("export and import: round trip by name, ids kept, nothing doubled", () => {
  let s = D.norm(null);
  let r = D.ensureTag(s, "Home", T0, "t1"); s = r.state; const tg = r.id;
  s = D.putType(s, { id: "ty-own1", n: "Recipes", kY: 2 }, T0);
  s = D.putDoc(s, { id: "d-1", p: "/internal/Documents/2026/a.pdf", t: "=A", ty: "ty-own1", tg: [tg], d: "2026-01-01", amt: 9.5, cur: "EUR" }, T0);
  const json = D.exportJson(s, s.docs, "en", T0);
  assert.equal(json.format, "oros-documents");
  assert.equal(json.docs[0].f, "Documents/2026/a.pdf");
  assert.equal(json.docs[0].p, undefined);
  const csv = D.exportCsv(s, s.docs, "en", ["Title", "Type", "Tags", "From", "Date", "Amount", "Currency", "Expires", "Keep until", "File", "Note"]);
  assert.match(csv, /^﻿Title,Type/);
  assert.match(csv, /'=A,Recipes,Home,,2026-01-01,9.5,EUR/, "no formulas in the CSV");

  // Another device with its own "home" tag and a "recipes" type.
  let other = D.ensureTag(D.norm(null), "home", T0, "o1").state;
  other = D.putType(other, { id: "ty-zz", n: "recipes" }, T0);
  const place = (f) => "/internal/Imported/" + f;
  const im = D.importJson(other, json, place, T0 + 5, "en");
  assert.equal(im.added, 1);
  const d = D.getDoc(im.state, "d-1");
  assert.equal(d.p, "/internal/Imported/Documents/2026/a.pdf");
  assert.equal(d.tg[0], other.tags[0].id, "joined the existing tag");
  assert.equal(d.ty, "ty-zz", "joined the existing type by name");
  const again = D.importJson(im.state, json, place, T0 + 9, "en");
  assert.equal(again.added, 0);
  assert.equal(again.state.docs.length, 1);
  assert.equal(D.importJson(other, { format: "nope" }, place, T0, "en").error, "format");
});

test("wiring: Files loads the archive, registers the place, carries moves", () => {
  const html = read("files/index.html");
  assert.ok(!/<script[^>]+docs(-core)?\.js/.test(html), "Documents is not in the first open (budget)");
  const js = read("files/files.js");
  assert.match(js, /DOCS_SCRIPTS = \["docs-core\.js", "docs\.js"\]/, "core before the view, on demand");
  assert.match(js, /function loadDocs\(/);
  assert.match(js, /"docs\.css\?v="/, "its styles load with it");
  assert.ok(!/#doc-bar|\.doc-row/.test(read("files/files.css")), "Documents styles stay out of files.css");
  assert.match(js, /docsStandIn\(\)/, "a node shows before the scripts load");
  assert.match(js, /OrosFilesDocs/);
  assert.match(js, /function places\(\)/);
  assert.match(js, /docsCarry\(/);
  const v = read("files/docs.js");
  assert.match(v, /registerSlice\(\s*CORE\.SLICE/);
  assert.match(v, /doc-mode/);
  (v.match(/innerHTML\s*=\s*[^;]+;/g) || []).forEach((a) => {
    const rhs = a.replace(/^innerHTML\s*=\s*/, "").replace(/;$/, "");
    assert.match(rhs, /^(""|svg|ICON\.\w+|b\.icon|IMG_EXT\.indexOf\(extOf\(d\.p\)\) !== -1 \? ICON\.\w+ : ICON\.\w+)$/, "only constant icons go in through innerHTML: " + a);
  });
  assert.ok(!/\balert\(|\bconfirm\(|\bprompt\(/.test(v), "no native dialogs (R14)");
});

test("strings: EN, EL and DE carry every Documents key", () => {
  const v = read("files/docs.js");
  const block = (lang) => {
    const m = new RegExp(lang + ": \\{([\\s\\S]*?)\\n    \\}").exec(v.slice(v.indexOf("var STRINGS")));
    return m ? m[1] : "";
  };
  const keys = (s) => (s.match(/"(doc\.[a-zA-Z0-9.]+)"\s*:/g) || []).map((k) => k.replace(/["\s:]/g, "")).sort();
  const en = keys(block("en")), el = keys(block("el"));
  assert.ok(en.length > 40);
  assert.deepEqual(el, en);
  const de = read("i18n/de/files.js");
  en.forEach((k) => assert.ok(de.indexOf('"' + k + '"') !== -1, "de " + k));
});
