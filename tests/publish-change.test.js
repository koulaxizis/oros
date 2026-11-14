// PB-CHG (Chris 2026-11-08): change_item on an existing Publishing
// title (assistant/edits4.js): fields, people per role, editions by
// ISBN or kind (added when none matches, never removed), royalty terms
// as a whole list, through publish/core.js put. Undo restores it.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../assistant/edits.js");
const E4 = require("../assistant/edits4.js");
const C = require("../publish/core.js");

const NOW = 1790000000000;
function ok(args) { const r = E.normArgs(Object.assign({ ref: "r1", action: "update" }, args)); assert.equal(r.ok, true, r.err); return r; }
function data() {
  let d = C.empty();
  d = C.put(d, "titles", { id: "t1", t: "Ψίθυρος", st: "out", ppl: [{ r: "a", n: "Γαντζούδης", crm: "c1" }],
                           fmts: [{ id: "f1", k: "pb", isbn: "9786185775643", price: 15, pages: 120 }] }, NOW - 1000);
  d = C.put(d, "titles", { id: "t2", t: "Άλλο", fmts: [{ id: "f2", k: "pb", isbn: "9786185321000" }] }, NOW - 1000);
  return JSON.parse(JSON.stringify(d));
}
const T = { title: "t1" };
function run(d, args) {
  const ch = ok(args);
  const p = E.plan("publish", d, T, ch, NOW);
  if (!p.ok) return p;
  const a = E.apply("publish", d, T, ch, NOW, p.before);
  assert.equal(a.ok, true, a.err);
  return Object.assign(a, { plan: p });
}
const title = (d) => C.find(C.normalize(d), "titles", "t1");

test("publish is a change_item app", () => {
  assert.ok(E.APP_IDS.includes("publish"));
  assert.equal(E.storageKey("publish"), "oros-publish-data");
  assert.deepEqual(E.actionsFor("publish"), ["update"]);
  assert.ok(E4.MODS.publish);
});

test("fields, release date, status and people; a CRM link stays", () => {
  const d = data();
  const r = run(d, { date: "2026-12-01", status: "production", subtitle: "Ποιήματα", language: "Greek", keywords: "ποίηση",
                     by: "Γαντζούδης, Β. Βασάλος", editor: "Στάμου", bio: "Γεννήθηκε…" });
  const t = title(r.data);
  assert.equal(t.rel, "2026-12-01");
  assert.equal(t.st, "prod");
  assert.equal(t.sub, "Ποιήματα");
  assert.deepEqual(t.ppl.filter((p) => p.r === "a"), [{ r: "a", n: "Γαντζούδης", crm: "c1" }, { r: "a", n: "Β. Βασάλος" }]);
  assert.deepEqual(t.ppl.filter((p) => p.r === "e").map((p) => p.n), ["Στάμου"]);
  assert.ok(t.m > NOW - 1000);
  const f = r.rows.map((x) => x.f);
  ["release", "status", "sub", "lang", "kw", "by", "editor", "bio"].forEach((k) => assert.ok(f.includes(k), k));
  const u = E.undo("publish", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(title(u.data).rel, "");
  assert.equal(title(u.data).st, "out");
});

test("editions: by ISBN, by kind, a new one; dimensions and weight", () => {
  const d = data();
  const r = run(d, { formats: [
    { isbn: "978-618-57756-4-3", width: 140, height: 210, spine: 9.5, weight: 180, binding: "Paperback, sewn", price: 15.9 },
    { format: "ebook", price: 6.99 }
  ] });
  const t = title(r.data);
  assert.equal(t.fmts.length, 2);
  const pb = t.fmts.find((f) => f.id === "f1");
  assert.deepEqual([pb.w, pb.h, pb.sp, pb.wt, pb.bind, pb.price, pb.pages], [140, 210, 9.5, 180, "Paperback, sewn", 15.9, 120]);
  assert.equal(t.fmts.find((f) => f.k === "eb").price, 6.99);
  // the only paperback, by kind
  const r2 = run(r.data, { formats: [{ format: "paperback", pages: 128 }] });
  assert.equal(title(r2.data).fmts.find((f) => f.id === "f1").pages, 128);
});

test("refused: another title's ISBN, a bad ISBN, wc_id without a shop, unknown fields", () => {
  const d = data();
  let p = E.plan("publish", d, T, ok({ formats: [{ format: "hardback", isbn: "9786185321000" }] }), NOW);
  assert.equal(p.ok, false);
  assert.match(p.err, /Άλλο/);
  p = E.plan("publish", d, T, ok({ formats: [{ isbn: "9786185775644" }] }), NOW);
  assert.match(p.err, /check digit/);
  E4.setCache("woo", []);
  p = E.plan("publish", d, T, ok({ formats: [{ isbn: "9786185775643", wc_id: 81145 }] }), NOW);
  assert.match(p.err, /Connected services/);
  p = E.plan("publish", d, T, ok({ formats: [{ isbn: "9786185775643", print_run: 500 }] }), NOW);
  assert.match(p.err, /print_run/);
  p = E.plan("publish", d, T, ok({ status: "now" }), NOW);
  assert.equal(p.ok, false);
  p = E.plan("publish", d, T, ok({ phone: "2101234567" }), NOW);
  assert.equal(p.ok, false);
  p = E.plan("publish", d, T, ok({ date: "2026-12-01" }), NOW);
  assert.equal(p.ok, true);
  p = E.plan("shelf", { items: [] }, { item: "x" }, ok({ status: "released" }), NOW);
  assert.equal(p.ok, false);
});

test("wc_id with one connected shop links the edition", () => {
  E4.setCache("woo", [{ id: "w1", name: "glarolykoi", site: "https://glarolykoi.net" }]);
  const r = run(data(), { formats: [{ isbn: "9786185775643", wc_id: 81145 }] });
  assert.deepEqual(title(r.data).fmts[0].wp, { a: "w1", id: 81145 });
  E4.setCache("woo", []);
});

test("royalty terms replace the list; a kept term keeps its id", () => {
  const r = run(data(), { royalties: [{ name: "Γαντζούδης", percent: 10 }, { name: "Στάμου", percent: 5, base: "net", format: "ebook", advance: 100 }] });
  const roy = title(r.data).roy;
  assert.equal(roy.length, 2);
  assert.deepEqual(roy.map((x) => [x.n, x.pct, x.base, x.k, x.adv]), [["Γαντζούδης", 10, "list", "", 0], ["Στάμου", 5, "net", "eb", 100]].sort((a, b) => 0));
  const id = roy.find((x) => x.n === "Γαντζούδης").id;
  const r2 = run(r.data, { royalties: [{ name: "Γαντζούδης", percent: 12 }] });
  assert.deepEqual(title(r2.data).roy.map((x) => [x.id, x.pct]), [[id, 12]]);
  assert.equal(E.plan("publish", r2.data, T, ok({ royalties: [{ name: "X", percent: 120 }] }), NOW).ok, false);
});

test("nothing to change is refused", () => {
  const p = E.plan("publish", data(), T, ok({ language: "" }), NOW);
  assert.equal(p.ok, false);
  assert.match(p.err, /Nothing would change/);
});

test("refs past r99999 are accepted (KB-SUB 2026-11-12)", () => {
  assert.equal(E.normArgs({ ref: "r133506", action: "update", status: "released" }).ok, true);
  assert.equal(E.normArgs({ ref: "r1335060000", action: "update", status: "released" }).ok, false);
});

// PB-MUS wave M2: a music release's fields, tracks (by ISRC, else
// title) with credits and splits, and editions (by UPC, else kind).
function music() {
  let d = C.empty();
  d = C.put(d, "titles", { id: "m1", t: "Νυχτερινά", st: "prod", mt: { k: "ep", lbl: "Γλαρόλυκοι" }, ppl: [{ r: "a", n: "Nox" }], fmts: [] }, NOW - 1000);
  d = C.put(d, "trk", { id: "k1", ti: "m1", no: 1, t: "Πρώτο", isrc: "GRA1B2600001", dur: 200,
                        sw: [{ n: "Nox", pct: 100, crm: "cust000001" }] }, NOW - 1000);
  d = C.put(d, "trk", { id: "k2", ti: "m1", no: 2, t: "Δεύτερο" }, NOW - 1000);
  d = C.put(d, "med", { id: "e1", ti: "m1", k: "dig", upc: "" }, NOW - 1000);
  d = C.put(d, "titles", { id: "m2", t: "Άλλη", mt: { k: "single" }, fmts: [] }, NOW - 1000);
  d = C.put(d, "trk", { id: "k9", ti: "m2", no: 1, t: "Ξένο", isrc: "GRA1B2600009" }, NOW - 1000);
  d = C.put(d, "med", { id: "e9", ti: "m2", k: "dig", upc: "036000291452" }, NOW - 1000);
  return JSON.parse(JSON.stringify(d));
}
const MT = { title: "m1" };
function runM(d, args) {
  const ch = ok(args);
  const p = E.plan("publish", d, MT, ch, NOW);
  if (!p.ok) return p;
  const a = E.apply("publish", d, MT, ch, NOW, p.before);
  assert.equal(a.ok, true, a.err);
  return Object.assign(a, { plan: p });
}

test("music: release fields, tracks by ISRC and title, a new track, credits and splits; undo takes it all back", () => {
  const d = music();
  const r = runM(d, {
    release_type: "album", genre: "Ambient", record_label: "", p_line: "2026 Nox",
    tracks: [
      { isrc: "GR-A1B-26-00001", length: "3:45", writers: [{ name: "Nox", share: 50 }, { name: "Mira", share: "50%", society: "AEPI", ipi: "00123456789" }],
        credits: [{ role: "producer", name: "Mira" }, { role: "musician", name: "Ari", instrument: "cello" }] },
      { title: "δεύτερο", isrc: "GRA1B2600002", explicit: true, masters: [{ name: "Γλαρόλυκοι", share: 100 }] },
      { title: "Τρίτο", version: "Radio edit", length: 180 }
    ],
    editions: [{ edition: "digital", upc: "012345678905", distributor: "DistroKid" }, { edition: "vinyl", catalogue_no: "GL-001", price: 25 }]
  });
  const nd = C.normalize(r.data), t = C.find(nd, "titles", "m1");
  assert.deepEqual(t.mt, { k: "album", gen: "Ambient", pl: "2026 Nox" });
  const tr = C.tracksOf(nd, "m1");
  assert.equal(tr.length, 3);
  assert.equal(tr[0].dur, 225);
  assert.deepEqual(tr[0].sw, [{ n: "Nox", pct: 50, crm: "cust000001" }, { n: "Mira", pct: 50, soc: "AEPI", ipi: "00123456789" }]);
  assert.deepEqual(tr[0].cr, [{ r: "prod", n: "Mira" }, { r: "mus", n: "Ari", ins: "cello" }]);
  assert.equal(tr[1].isrc, "GRA1B2600002");
  assert.equal(tr[1].ex, 1);
  assert.deepEqual(tr[2].t + "|" + tr[2].ver + "|" + tr[2].no + "|" + tr[2].dur, "Τρίτο|Radio edit|3|180");
  const ed = C.editionsOf(nd, "m1");
  assert.equal(ed.length, 2);
  assert.equal(ed[0].id, "e1");
  assert.equal(ed[0].upc, "012345678905");
  assert.equal(ed[1].k, "vin");
  const f = r.rows.map((x) => x.f);
  ["mtype", "label", "genre", "pline", "track", "format"].forEach((k) => assert.ok(f.includes(k), k));
  const u = E.undo("publish", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  const ud = C.normalize(u.data);
  assert.deepEqual(C.find(ud, "titles", "m1").mt, { k: "ep", lbl: "Γλαρόλυκοι" });
  assert.equal(C.tracksOf(ud, "m1").length, 2);
  assert.equal(C.tracksOf(ud, "m1")[0].dur, 200);
  assert.deepEqual(C.tracksOf(ud, "m1")[0].sw, [{ n: "Nox", pct: 100, crm: "cust000001" }]);
  assert.equal(C.editionsOf(ud, "m1").length, 1);
  assert.equal(C.editionsOf(ud, "m1")[0].upc, "");
});

test("music: refused codes, shares, formats on a release and music fields on a book", () => {
  const d = music();
  const no = (args, re, tgt) => {
    const p = E.plan("publish", d, tgt || MT, ok(args), NOW);
    assert.equal(p.ok, false, JSON.stringify(args));
    assert.match(p.err, re);
  };
  no({ tracks: [{ title: "Δεύτερο", isrc: "GRA1B2600009" }] }, /Άλλη/);
  no({ tracks: [{ title: "Πρώτο", isrc: "GRA1B2600003" }] }, /already has ISRC/);
  no({ tracks: [{ isrc: "GRA1B26" }] }, /not a valid ISRC/);
  no({ tracks: [{ isrc: "GRA1B2600077" }] }, /give title/);
  no({ tracks: [{ title: "Πρώτο", writers: [{ name: "A", share: 60 }, { name: "B", share: 30 }] }] }, /add up to 90%/);
  no({ editions: [{ upc: "036000291452" }] }, /Άλλη/);
  no({ editions: [{ upc: "036000291453" }] }, /check digit/);
  no({ formats: [{ format: "paperback" }] }, /editions, not formats/);
  no({ tracks: [{ title: "X", bpm: 120 }] }, /has no bpm/);
  let b = C.put(C.empty(), "titles", { id: "t1", t: "Βιβλίο", fmts: [] }, NOW - 1000);
  const p = E.plan("publish", JSON.parse(JSON.stringify(b)), T, ok({ tracks: [{ title: "X" }] }), NOW);
  assert.equal(p.ok, false);
  assert.match(p.err, /is a book/);
});

test("music: undo refused when a track changed since", () => {
  const d = music();
  const r = runM(d, { tracks: [{ title: "Δεύτερο", length: "2:00" }] });
  const later = C.put(C.normalize(r.data), "trk", Object.assign({}, C.find(C.normalize(r.data), "trk", "k2"), { t: "Αλλαγή" }), NOW + 5);
  const u = E.undo("publish", JSON.parse(JSON.stringify(later)), r.undo, NOW + 10);
  assert.equal(u.ok, false);
  assert.match(u.err, /changed since/);
});
