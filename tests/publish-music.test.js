// Publishing wave M1: music releases (publish/core.js): ISRC, UPC/EAN,
// prefixes, tracks and editions as their own lists, forward safety.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../publish/core.js");
const S = require("../publish/search.js");

const T = 1700000000000;
function base() {
  let d = C.put(C.empty(), "titles", { id: "t1", t: "Night Songs", mt: { k: "album", lbl: "Own Label", gen: "Folk", pl: "2026 Ann", cl: "2026 Ann" }, ppl: [{ r: "a", n: "Ann" }] }, T);
  d = C.put(d, "isrcb", { id: "p1", p: "gr a1b", note: "own" }, T);
  d = C.put(d, "upcb", { id: "u1", p: "520-1234", f: "ean" }, T);
  d = C.put(d, "upcb", { id: "u2", p: "123456", f: "upc" }, T);
  return d;
}

test("ISRC: any spelling → 12 characters; prefixes; next free per year", () => {
  assert.deepEqual(C.parseIsrc("isrc: gr-a1b-26-00001"), { ok: true, isrc: "GRA1B2600001", why: "" });
  assert.equal(C.parseIsrc("GR-A1B-26-0001").why, "len");
  assert.equal(C.parseIsrc("G1-A1B-26-00001").why, "shape");
  assert.equal(C.fmtIsrc("GRA1B2600001"), "GR-A1B-26-00001");
  assert.deepEqual(C.parseIsrcPrefix("gra1b"), { p: "GR-A1B", d: "GRA1B" });
  assert.equal(C.parseIsrcPrefix("GR-A1"), null);
  let d = base();
  assert.equal(C.find(d, "isrcb", "p1").p, "GR-A1B");
  assert.equal(C.nextIsrc(d, "p1", 2026), "GRA1B2600001");
  d = C.put(d, "trk", { id: "k1", ti: "t1", t: "Intro", isrc: "GR-A1B-26-00001" }, T);
  d = C.put(d, "codex", { id: "GRA1B2600002", note: "old single" }, T);
  assert.equal(C.nextIsrc(d, "p1", 2026), "GRA1B2600003");
  assert.equal(C.nextIsrc(d, "p1", 2027), "GRA1B2700001");
  assert.equal(C.nextIsrc(d, "p1", 2026, ["GRA1B2600003"]), "GRA1B2600004");
  assert.deepEqual(C.isrcUsage(d, "p1").rows.map((r) => r.code), ["GRA1B2600001", "GRA1B2600002"]);
});

test("UPC-A and EAN-13: check digit, ISBNs refused, GS1 prefixes and next free", () => {
  assert.equal(C.parseUpc("036000291452").ok, true);                 // a real UPC-A
  assert.equal(C.parseUpc("4006381333931").ok, true);                // a real EAN-13
  assert.equal(C.parseUpc("4006381333932").why, "check");
  assert.equal(C.parseUpc("9780306406157").why, "isbn");
  assert.equal(C.parseUpc("12345").why, "len");
  assert.equal(C.upcKey("036000291452"), "0036000291452");
  assert.equal(C.parseUpcPrefix("978123", "ean"), null);
  assert.equal(C.parseUpcPrefix("12345", "ean"), null);
  const d = base();
  assert.equal(C.nextUpc(d, "u1"), "5201234000001");
  assert.equal(C.nextUpc(d, "u2"), "123456000001");
  assert.equal(C.parseUpc(C.blockUpc(C.find(d, "upcb", "u2"), 77)).ok, true);
  const d2 = C.put(d, "med", { id: "m1", ti: "t1", k: "cd", upc: "123456000001" }, T);
  assert.equal(C.nextUpc(d2, "u2"), "123456000018");
  const u = C.upcUsage(d2, "u2");
  assert.equal(u.used, 1);
  assert.equal(u.free, u.size - 1);
  // the same code as UPC-A and as EAN-13 is one code
  const d3 = C.put(d2, "med", { id: "m2", ti: "t1", k: "vin", upc: "0123456000001" }, T);
  assert.deepEqual(C.codeClashes(d3).map((x) => [x.code, x.uses.length]), [["0123456000001", 2]]);
});

test("tracks and editions: cleaned rows, order, run time, gaps, search", () => {
  let d = base();
  ["Intro", "Night Song", "Dawn"].forEach((t, i) => { d = C.put(d, "trk", { id: "k" + (i + 1), ti: "t1", no: i + 1, t, dur: [65, 225, 250][i] }, T); });
  assert.equal(C.put(d, "trk", { id: "kx", ti: "t1", t: "" }, T).trk.length, 3);        // a track needs its title
  assert.equal(C.put(d, "trk", { id: "kx", t: "No release" }, T).trk.length, 3);       // and its release
  assert.deepEqual(C.tracksOf(d, "t1").map((r) => r.t), ["Intro", "Night Song", "Dawn"]);
  assert.equal(C.runTime(d, "t1"), 540);
  d = C.orderTracks(d, "t1", ["k3", "k1", "k2"], T + 1);
  assert.deepEqual(C.tracksOf(d, "t1").map((r) => [r.no, r.t]), [[1, "Dawn"], [2, "Intro"], [3, "Night Song"]]);
  const t = C.find(d, "titles", "t1");
  assert.equal(C.isMusic(t), true);
  assert.deepEqual(C.gaps(t, d), ["isrc", "ed", "rel", "cov"]);
  d = C.put(d, "med", { id: "m1", ti: "t1", k: "dig" }, T);
  assert.deepEqual(C.gaps(t, d), ["isrc", "upc", "rel", "cov"]);
  d = C.put(d, "trk", Object.assign({}, C.find(d, "trk", "k1"), { isrc: "GRA1B2600001" }), T + 2);
  assert.equal(C.list(d, { q: "GR-A1B-26" }).length, 1);
  assert.equal(C.list(d, { q: "gra1b2600001" }).length, 1);
  assert.equal(C.list(d, { q: "night song" }).length, 1);
  assert.equal(C.list(d, { kind: "book" }).length, 0);
  assert.equal(C.list(d, { kind: "mus" }).length, 1);
  // a book keeps its own gaps
  assert.deepEqual(C.gaps(C.cleanTitle ? null : { t: "B", ppl: [], fmts: [], blurb: "", rel: "", cov: "" }, d), ["author", "fmt", "blurb", "rel", "cov"]);
  // the menu search finds it by a track, an ISRC or a UPC
  d = C.put(d, "med", { id: "m1", ti: "t1", k: "dig", upc: "5201234000001" }, T + 3);
  const hit = S.search({ readJSON: () => JSON.parse(C.serialize(d)) })[0];
  assert.match(hit.text, /GR-A1B-26-00001/);
  assert.match(hit.text, /5201234000001/);
  assert.match(hit.text, /Night Song/);
});

test("removeRelease takes the title, its tracks and editions; merge stays symmetric", () => {
  let d = base();
  d = C.put(d, "trk", { id: "k1", ti: "t1", t: "Intro" }, T);
  d = C.put(d, "med", { id: "m1", ti: "t1", k: "cd" }, T);
  const gone = C.removeRelease(d, "t1", T + 10);
  assert.deepEqual([gone.titles.length, gone.trk.length, gone.med.length], [0, 0, 0]);
  assert.equal(C.serialize(C.merge(d, gone)), C.serialize(C.merge(gone, d)));
  assert.equal(C.serialize(C.merge(d, gone)), C.serialize(gone));
  assert.equal(C.serialize(C.merge(d, d)), C.serialize(d));
});

test("forward safe: an older Publishing (lists it does not know) keeps tracks, editions and prefixes", () => {
  let d = base();
  d = C.put(d, "trk", { id: "k1", ti: "t1", t: "Intro", isrc: "GRA1B2600001", dur: 65, cr: [{ r: "comp", n: "Ann" }] }, T);
  d = C.put(d, "med", { id: "m1", ti: "t1", k: "cd", upc: "5201234000001" }, T);
  assert.deepEqual(C.find(d, "trk", "k1").cr, [{ r: "comp", n: "Ann" }]);    // a later field rides along
  // an older core: same code without the new lists in LISTS
  const fs = require("fs"), path = require("path"), vm = require("vm");
  const src = fs.readFileSync(path.join(__dirname, "..", "publish", "core.js"), "utf8")
    .replace('"posts", "trk", "med", "isrcb", "upcb", "codex"]', '"posts"]');
  assert.notEqual(src.indexOf('var LISTS = ["titles", "blocks", "isbnx", "stmts", "subs", "posts"];'), -1);
  const box = { module: { exports: {} } };
  box.globalThis = box;
  vm.runInNewContext(src, Object.assign(box, { require }));
  const OLD = box.module.exports;
  const viaOld = OLD.normalize(JSON.parse(C.serialize(d)));
  assert.equal(C.serialize(C.normalize(viaOld)), C.serialize(d));
  assert.deepEqual(JSON.parse(JSON.stringify(viaOld.titles[0].mt)), d.titles[0].mt);
  assert.equal(viaOld.trk.length, 1);
  assert.equal(viaOld.med.length, 1);
});

test("barcode for a release code: UPC or EAN over the bars", () => {
  const svg = C.barcodeSvg(C.upcKey("123456000001"), [], { label: "UPC", code: "123456000001" });
  assert.match(svg, />UPC 123456000001</);
  assert.match(C.barcodeSvg("5201234000001", [], { label: "EAN", code: "5201234000001" }), />EAN 5201234000001</);
  assert.equal(C.barcodeSvg("5201234000002", [], { label: "EAN" }), "");
});
