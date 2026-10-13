// Pure logic of the Maps personal heatmap (maps/heat-core.js, OSM
// upgrade wave 4): projection, packing, the grid renderer (each track
// counts once per square), colours, statistics per year / month, and
// "new ground". Plus the wiring of the worker and the page.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const HC = require(path.join(__dirname, "..", "maps/heat-core.js"));
const T = require(path.join(__dirname, "..", "maps/tracks-core.js"));

function line(n, lat0, lon0, dLat, dLon) {
  const s = [];
  for (let i = 0; i < n; i++) s.push([lat0 + i * dLat, lon0 + i * dLon, null, null]);
  return s;
}
function viewAt(lat, lon, z, w, h, cell) {
  const sc = 256 * 2 ** z;
  return { z, x0: HC.projX(lon, sc) - w / 2, y0: HC.projY(lat, sc) - h / 2, w, h, cell };
}

test("projection matches Web Mercator (Leaflet) at zoom 0 and 10", () => {
  assert.equal(HC.projX(0, 256), 128);
  assert.equal(HC.projY(0, 256), 128);
  assert.ok(Math.abs(HC.projX(180, 256) - 256) < 1e-9);
  assert.ok(Math.abs(HC.projY(85.05112878, 256)) < 1e-6);
  // Athens at z10, against the textbook formula
  const sc = 256 * 1024, la = 37.9838 * Math.PI / 180;
  assert.ok(Math.abs(HC.projX(23.7275, sc) - 203.7275 / 360 * sc) < 1e-6);
  const ref = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * sc;
  assert.ok(Math.abs(HC.projY(37.9838, sc) - ref) < 1e-6, String(HC.projY(37.9838, sc)));
  // clamped beyond the poles
  assert.equal(HC.projY(89, 256), HC.projY(86, 256));
});

test("pack: segment breaks as NaN pairs, bbox, optional simplify", () => {
  const tr = { segs: [line(5, 37.98, 23.72, 0.001, 0), [], line(3, 38.0, 23.8, 0, 0.001)] };
  const p = HC.pack(tr, null);
  assert.equal(p.pts.length, (5 + 1 + 3 + 1) * 2);
  assert.ok(Number.isNaN(p.pts[10]) && Number.isNaN(p.pts[11]));
  assert.deepEqual(p.bbox.map((v) => +v.toFixed(3)), [37.98, 23.72, 38.0, 23.802]);
  const s = HC.pack(tr, (seg) => T.simplifySeg(seg, 3));
  assert.equal(s.pts.length, (2 + 1 + 2 + 1) * 2, "straight lines keep their ends");
  assert.equal(HC.pack({ segs: [] }, null).bbox, null);
});

test("walk touches every square on the way, in both directions", () => {
  const got = [];
  HC.walk(0.5, 0.5, 4.5, 0.5, (x, y) => got.push(x + ":" + y));
  assert.deepEqual([...new Set(got)], ["0:0", "1:0", "2:0", "3:0", "4:0"]);
  const back = new Set();
  HC.walk(4.5, 3.5, 0.5, 0.5, (x, y) => back.add(x + ":" + y));
  assert.ok(back.has("4:3") && back.has("0:0"));
  const one = new Set();
  HC.walk(2.2, 2.2, 2.4, 2.3, (x, y) => one.add(x + ":" + y));
  assert.deepEqual([...one], ["2:2"]);
});

test("render: a square counts each track once; overlap shows as a higher count", () => {
  const e = new HC.Engine();
  const a = line(60, 37.98, 23.72, 0.0001, 0);
  e.add("a", HC.pack({ segs: [a] }, null), 1);
  e.add("b", HC.pack({ segs: [a.slice(0, 30)] }, null), 2);
  // zig-zag inside one square must not raise its count
  e.add("c", HC.pack({ segs: [[[37.981, 23.72], [37.98101, 23.72001], [37.981, 23.72], [37.98101, 23.72001]]] }, null), 3);
  const v = viewAt(37.983, 23.72, 16, 300, 300, 2);
  const r = e.render(["a", "b", "c"], v);
  assert.equal(r.gw, 150); assert.equal(r.gh, 150);
  assert.equal(r.drawn, 3);
  assert.equal(r.max, 3, "a + b + c meet at most 3 times in one square");
  const r2 = e.render(["a"], v);
  assert.equal(r2.max, 1);
  let coloured = 0;
  for (let i = 3; i < r2.rgba.length; i += 4) if (r2.rgba[i]) coloured++;
  assert.ok(coloured > 50 && coloured < 400, "a thin line of squares: " + coloured);
  // filter: only the ids asked for; off-screen tracks skipped
  e.add("far", HC.pack({ segs: [line(10, 40.6, 22.9, 0.001, 0)] }, null), 4);
  assert.equal(e.render(["far"], v).drawn, 0);
  assert.equal(e.render([], v).max, 0);
  e.remove("a");
  assert.deepEqual(e.ids(), ["b", "c", "far"]);
});

test("render: huge views are capped, cell size kept in range", () => {
  const e = new HC.Engine();
  e.add("a", HC.pack({ segs: [line(10, 0, 0, 0.1, 0.1)] }, null), 1);
  const r = e.render(["a"], { z: 3, x0: 0, y0: 0, w: 4000, h: 4000, cell: 1 });
  assert.ok(r.gw * r.gh <= HC.LIM.gridCells);
  const r2 = e.render(["a"], { z: 3, x0: 0, y0: 0, w: 100, h: 100, cell: 999 });
  assert.equal(r2.cell, HC.LIM.cell);
});

test("colours: transparent at 0, rising alpha, red at the top", () => {
  assert.deepEqual(HC.color(0), [0, 0, 0, 0]);
  const lo = HC.color(0.1), hi = HC.color(1);
  assert.ok(lo[3] > 0 && lo[3] < hi[3]);
  assert.ok(hi[0] > 200 && hi[1] < 60);
  assert.deepEqual(HC.color(5), hi);
});

test("stats per year and month from index entries; filters; years list", () => {
  const E = [
    { id: "a", start: Date.UTC(2025, 11, 31, 22), dist: 5000, dur: 3600000, folder: "Hikes" },
    { id: "b", start: Date.UTC(2026, 0, 2), dist: 12000, dur: 7200000, folder: "" },
    { id: "c", start: Date.UTC(2026, 0, 20), dist: 3000, dur: 1800000, folder: "Hikes" },
    { id: "d", start: 0, dist: 1000, dur: 0, folder: "" }
  ];
  const s = HC.stats(E);
  assert.equal(s.dist, 21000); assert.equal(s.n, 4);
  assert.deepEqual(Object.keys(s.years).sort(), ["2025", "2026"]);
  assert.equal(s.years["2026"].dist, 15000);
  assert.equal(s.months["2026-01"].n, 2);
  assert.equal(s.months["2025-12"].dist, 5000);
  assert.deepEqual(HC.years(E), ["2026", "2025"]);
  assert.deepEqual(HC.filterEntries(E, { year: "2026" }).map((e) => e.id), ["b", "c"]);
  assert.deepEqual(HC.filterEntries(E, { folder: "Hikes" }).map((e) => e.id), ["a", "c"]);
  assert.deepEqual(HC.filterEntries(E, { year: "2026", folder: "Hikes" }).map((e) => e.id), ["c"]);
  assert.equal(HC.monthKey(0), "");
  assert.equal(HC.monthKey(Date.UTC(2026, 8, 1)), "2026-09");
});

test("new ground: first visit counts in date order, repeats add nothing", () => {
  const e = new HC.Engine();
  const a = line(101, 37.98, 23.72, 0.0001, 0);       // ~1.1 km north
  e.add("late", HC.pack({ segs: [a] }, null), Date.UTC(2026, 2, 1));
  e.add("early", HC.pack({ segs: [a.slice(0, 51)] }, null), Date.UTC(2026, 0, 1));
  const g = e.newGround(["late", "early"]);
  assert.ok(Math.abs(g.months["2026-01"] - 556) < 120, "first half ≈ 0.55 km: " + g.months["2026-01"]);
  assert.ok(Math.abs(g.total - 1112) < 150, "whole line ≈ 1.1 km: " + g.total);
  assert.ok(g.months["2026-03"] > 300 && g.months["2026-03"] < g.total);
  // the same track again adds nothing
  e.add("again", HC.pack({ segs: [a] }, null), Date.UTC(2026, 5, 1));
  const g2 = e.newGround(["late", "early", "again"]);
  assert.equal(g2.months["2026-06"], 0);
  assert.equal(g2.total, g.total);
  assert.equal(g2.squares, g.squares);
  assert.deepEqual(e.newGround([]), { months: {}, total: 0, squares: 0 });
});

test("wiring: worker imports the cores, page has a fallback, files precached, prefs device-local", () => {
  const w = fs.readFileSync(path.join(__dirname, "..", "maps/heat-worker.js"), "utf8");
  assert.match(w, /importScripts\("tracks-core\.js", "heat-core\.js"\)/);
  assert.match(w, /\[r\.rgba\.buffer\]/, "pixels are transferred, not copied");
  const ui = fs.readFileSync(path.join(__dirname, "..", "maps/heat.js"), "utf8");
  assert.match(ui, /new Worker\("heat-worker\.js"\)/);
  assert.match(ui, /new HC\.Engine\(\)/, "page fallback");
  assert.match(ui, /"https:\/\/gps\.tile\.openstreetmap\.org\/lines\/\{z\}\/\{x\}\/\{y\}\.png"/);
  assert.match(ui, /var PREF_KEY = "oros-maps-heat"/);
  assert.ok(!/registerSlice/.test(ui), "no new synced data");
  assert.ok(!/\.innerHTML\s*=\s*(?!\s|'<svg)/.test(ui), "innerHTML only for static icons");
  const html = fs.readFileSync(path.join(__dirname, "..", "maps/index.html"), "utf8");
  const order = ["tracks-core.js", "tracks.js", "heat-core.js", "heat.js"].map((f) => html.indexOf('src="' + f + "?v="));
  order.forEach((i) => assert.ok(i > 0));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  ["maps/heat-core.js", "maps/heat.js", "maps/heat-worker.js"].forEach((f) => assert.ok(sw.includes('"' + f + '"'), f));
  const tr = fs.readFileSync(path.join(__dirname, "..", "maps/tracks.js"), "utf8");
  assert.match(tr, /oros-maps-tracks-changed/);
});
