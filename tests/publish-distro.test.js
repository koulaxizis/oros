// Publishing wave M4: a music distributor's sales report (DistroKid or
// any CSV) into royalty statements (publish/distro.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../publish/core.js");
const R = require("../publish/royalty.js");
const D = require("../publish/distro.js");

const T = 1700000000000;
const DK_HEAD = ["Reporting Date", "Sale Month", "Store", "Artist", "Title", "ISRC", "UPC", "Quantity", "Team Percentage", "Song/Album", "Country of Sale", "Songwriter Royalties Withheld", "Earnings (USD)"];
function dk(rows) { return [DK_HEAD.join("\t")].concat(rows.map((r) => r.join("\t"))).join("\n") + "\n"; }

function pub() {
  let d = C.put(C.empty(), "titles", { id: "t1", t: "Night Songs", mt: { k: "album" },
    roy: [{ id: "r1", n: "Ann", pct: 50, base: "net", adv: 1 }, { id: "r2", n: "Bo", pct: 10, base: "list", k: "pb" }] }, T);
  d = C.put(d, "trk", { id: "k1", ti: "t1", no: 1, t: "Intro", isrc: "GR-A1B-26-00001" }, T);
  d = C.put(d, "trk", { id: "k2", ti: "t1", no: 2, t: "Sea", ver: "Radio Edit", isrc: "GRA1B2600002",
    sm: [{ n: "Ann", pct: 60 }, { n: "Cy", pct: 40 }] }, T);
  d = C.put(d, "med", { id: "m1", ti: "t1", k: "dig", upc: "036000291452" }, T);
  return d;
}

test("parse: tabs, commas, semicolons, quotes, BOM; data only", () => {
  const a = D.parse("﻿a,b,c\n1,\"x, \"\"y\"\"\",3\r\n\n4,5,=SUM(A1)\n");
  assert.equal(a.delim, ",");
  assert.deepEqual(a.rows, [["a", "b", "c"], ["1", "x, \"y\"", "3"], ["4", "5", "=SUM(A1)"]]);
  assert.equal(D.parse("a;b\n1;2").delim, ";");
  assert.equal(D.parse("a\tb\n1\t2").delim, "\t");
  assert.equal(D.parse("just one column\nx").err, "cols");
  assert.equal(D.parse("a,b\n").err, "empty");
  assert.equal(D.parse(42).err, "type");
  assert.equal(D.parse("a,b\n" + "x".repeat(600) + ",\u0001y").rows[1][0].length, 500);
  assert.equal(D.parse("a,b\n1,\u0001y").rows[1][1], "y");
});

test("numbers and months as reports write them", () => {
  assert.equal(D.number("1,234.56"), 1234.56);
  assert.equal(D.number("1.234,56"), 1234.56);
  assert.equal(D.number("0,5"), 0.5);
  assert.equal(D.number("0.00351"), 0.00351);
  assert.equal(D.number("(1.20)"), -1.2);
  assert.equal(D.number("-3"), -3);
  assert.equal(D.number("$4.10"), 4.1);
  assert.equal(D.number("1.2e-5"), 0.000012);
  assert.equal(D.number(""), 0);
  assert.ok(Number.isNaN(D.number("abc")));
  assert.equal(D.month("2026-08"), "2026-08");
  assert.equal(D.month("2026-08-15"), "2026-08");
  assert.equal(D.month("08/2026"), "2026-08");
  assert.equal(D.month("15/08/2026"), "2026-08");
  assert.equal(D.month("Aug 2026"), "2026-08");
  assert.equal(D.month("August, 2026"), "2026-08");
  assert.equal(D.month("2026/8"), "2026-08");
  assert.equal(D.month("13/2026"), "");
  assert.equal(D.month("soon"), "");
});

test("guess: the DistroKid header, a generic header, an Earnings (EUR) column", () => {
  const g = D.guess(DK_HEAD);
  assert.equal(g.preset, "distrokid");
  assert.equal(g.cur, "USD");
  assert.deepEqual([g.map.month, g.map.isrc, g.map.upc, g.map.qty, g.map.amt, g.map.store, g.map.country, g.map.cur],
                   [1, 5, 6, 7, 12, 2, 10, -1]);
  const h = D.guess(["Period", "Track ISRC", "EAN", "Streams", "Net Revenue", "Currency", "Track Title", "Service"]);
  assert.equal(h.preset, "");
  assert.deepEqual([h.map.month, h.map.isrc, h.map.upc, h.map.qty, h.map.amt, h.map.cur, h.map.title, h.map.store],
                   [0, 1, 2, 3, 4, 5, 6, 7]);
  const e = D.guess(["Month", "ISRC", "Earnings (EUR)"]);
  assert.equal(e.map.amt, 2);
  assert.equal(e.cur, "EUR");
});

test("read → match → statements: DistroKid report, splits and terms", () => {
  const text = dk([
    ["2026-10-05", "2026-08", "Spotify", "Ann", "Intro", "GRA1B2600001", "036000291452", "1000", "100%", "Song", "GR", "0", "3.5"],
    ["2026-10-05", "2026-09", "Apple Music", "Ann", "Intro", "GR-A1B-26-00001", "", "200", "100%", "Song", "US", "0", "1.25"],
    ["2026-10-05", "2026-09", "Spotify", "Ann", "Sea", "GRA1B2600002", "", "500", "100%", "Song", "DE", "0", "2,00"],
    ["2026-10-05", "2026-09", "iTunes", "Ann", "Night Songs", "", "0036000291452", "1", "100%", "Album", "GR", "0", "6.99"],
    ["2026-10-05", "2026-09", "Spotify", "Zed", "Other Song", "USXXX2600009", "", "10", "100%", "Song", "GR", "0", "0.04"],
    ["2026-10-05", "", "Spotify", "Ann", "Intro", "GRA1B2600001", "", "5", "100%", "Song", "GR", "0", "0.01"],
  ]);
  const p = D.parse(text);
  const g = D.guess(p.rows[0]);
  const r = D.read(p.rows, g.map, { cur: g.cur });
  assert.equal(r.bad, 1);
  assert.equal(r.lines.length, 5);
  assert.equal(r.lines[0].amt, 350);
  const d = C.setCur(pub(), "USD", T);         // the advance is in USD here
  const m = D.match(d, r.lines);
  assert.equal(m.from, "2026-08-01");
  assert.equal(m.to, "2026-09-30");
  assert.deepEqual(m.curs, ["USD"]);
  assert.deepEqual(m.tracks.map((x) => [x.tk, x.q, Math.round(x.amt)]), [["k1", 1200, 475], ["k2", 500, 200]]);
  assert.deepEqual(m.tracks[0].stores, { Spotify: 350, "Apple Music": 125 });
  assert.deepEqual(m.releases.map((x) => [x.ti, Math.round(x.amt)]), [["t1", 699]]);
  assert.deepEqual(m.unmatched.map((x) => [x.isrc, x.title]), [["USXXX2600009", "Other Song"]]);

  const st = D.statements(d, m, { note: "DistroKid" });
  assert.deepEqual(st.map((s) => [s.n, s.cur, s.due]), [["Ann", "USD", 608], ["Cy", "USD", 80]]);
  const ann = st[0];
  // Intro and the album sale pay Ann's 50% term (advance 1.00 recouped
  // first); Sea pays her 60% master share; Bo's paperback term is not music
  assert.deepEqual(ann.rows.map((x) => [x.t, x.tr, x.b, x.pct, x.e, x.isrc || x.upc]), [
    ["Night Songs · Intro", "r1", 475, 50, 238, "GRA1B2600001"],
    ["Night Songs · Sea (Radio Edit)", "k2", 200, 60, 120, "GRA1B2600002"],
    ["Night Songs", "r1", 699, 50, 350, "036000291452"],
  ]);
  const rec = ann.rec.map((x) => [x.tr, x.adv, x.left, x.e, x.pay]);
  assert.deepEqual(rec, [["r1", 100, 100, 588, 488], ["k2", 0, 0, 120, 120]]);
  assert.equal(ann.due, 608);
  assert.equal(st[1].rows[0].e, 80);
  assert.equal(ann.overlap, false);
  assert.equal(ann.note, "DistroKid");
});

test("statements: fb survives cleanStmt and recompute; overlap flagged; currencies kept apart", () => {
  const d0 = pub();
  const lines = [
    { ym: "2026-09", isrc: "GRA1B2600002", upc: "", q: 3, amt: 1000.4, cur: "EUR", title: "", artist: "", store: "", country: "" },
    { ym: "2026-09", isrc: "GRA1B2600002", upc: "", q: 1, amt: 300, cur: "USD", title: "", artist: "", store: "", country: "" },
  ];
  const m = D.match(d0, lines);
  const st = D.statements(d0, m);
  assert.deepEqual(st.map((s) => [s.n, s.cur]), [["Ann", "EUR"], ["Ann", "USD"], ["Cy", "EUR"], ["Cy", "USD"]]);
  const s = Object.assign({}, st[0], { id: "s1" });
  delete s.overlap;
  const d = C.put(d0, "stmts", s, T);
  const kept = C.find(d, "stmts", "s1");
  assert.equal(kept.rows[0].fb, 1000);
  assert.equal(kept.rows[0].isrc, "GRA1B2600002");
  // the unit base rounds; recompute keeps what came in
  assert.equal(R.recompute(kept, d).rows[0].b, 1000);
  assert.equal(R.recompute(kept, d).rows[0].e, 600);
  // a report for the same months again shows the overlap
  assert.equal(D.statements(d, m)[0].overlap, true);
  assert.equal(D.statements(d, m)[1].overlap, false);
});

test("a statement row without fb is computed as before", () => {
  const st = R.recompute({ id: "", n: "Ann", from: "2026-01-01", to: "2026-06-30", cur: "EUR", rows: [
    { ti: "t1", tr: "r1", t: "X", k: "", isbn: "", q: 10, base: "net", u: 150, b: 0, pct: 10, e: 0 }], rec: [] }, pub());
  assert.equal(st.rows[0].b, 1500);
});

test("links: an unmatched line linked to a track; learn() gives the track its ISRC", () => {
  let d = pub();
  d = C.put(d, "trk", { id: "k3", ti: "t1", no: 3, t: "Coda" }, T);
  const lines = [{ ym: "2026-09", isrc: "GRA1B2600003", upc: "", q: 7, amt: 70, cur: "USD", title: "Coda", artist: "", store: "", country: "" }];
  const m0 = D.match(d, lines);
  assert.equal(m0.unmatched[0].key, "GRA1B2600003");
  const m = D.match(d, lines, { GRA1B2600003: "k3" });
  assert.equal(m.unmatched.length, 0);
  assert.deepEqual(m.tracks.map((x) => x.tk), ["k3"]);
  assert.deepEqual(D.learn(d, m), [{ id: "k3", isrc: "GRA1B2600003" }]);
  // a deleted release is never matched
  assert.equal(D.match(C.remove(d, "titles", "t1", T + 1), lines, { GRA1B2600003: "k3" }).unmatched.length, 1);
});

test("an advance is in the publisher's currency: a USD report doesn't recoup a EUR advance", () => {
  const d = pub();
  const lines = [{ ym: "2026-09", isrc: "GRA1B2600001", upc: "", q: 1, amt: 400, cur: "USD", title: "", artist: "", store: "", country: "" },
                 { ym: "2026-09", isrc: "GRA1B2600001", upc: "", q: 1, amt: 400, cur: "EUR", title: "", artist: "", store: "", country: "" }];
  const st = D.statements(d, D.match(d, lines));
  const eur = st.find((s) => s.cur === "EUR"), usd = st.find((s) => s.cur === "USD");
  assert.equal(eur.rec[0].adv, 100);
  assert.equal(eur.due, 100);
  assert.equal(usd.rec[0].adv, 0);
  assert.equal(usd.due, 200);
  // issued USD statements don't count towards the EUR advance either
  const d2 = C.put(d, "stmts", Object.assign({}, usd, { id: "s9", from: "2026-01-01", to: "2026-01-31", overlap: undefined }), T);
  assert.equal(R.recompute(Object.assign({}, eur, { from: "2026-09-01" }), d2).due, 100);
});

test("sheetRows: a spreadsheet's values become clean rows (dates, numbers, no objects)", () => {
  const r = D.sheetRows([["Month", "ISRC", "Earnings (EUR)"], [new Date(Date.UTC(2026, 8, 1)), "GRA1B2600001", 0.4321], [null, "", ""], [{ f: "=1+1" }, "x\u0001", Infinity]]);
  assert.deepEqual(r.rows, [["Month", "ISRC", "Earnings (EUR)"], ["2026-09-01", "GRA1B2600001", "0.4321"], ["", "x", ""]]);
  assert.equal(D.sheetRows([["a"]]).err, "empty");
  assert.equal(D.sheetRows("no").err, "type");
  const g = D.guess(r.rows[0]);
  const lines = D.read(r.rows, g.map, { cur: g.cur }).lines;
  assert.deepEqual(lines.map((l) => [l.ym, l.cur, l.amt]), [["2026-09", "EUR", 43.21]]);
});
