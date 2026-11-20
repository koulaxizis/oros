// Hiking and cycling, wave H3 (Discover › Trails): the area query, the
// routes in view, one route's ways joined into lines, and the wiring
// (the tab Discover takes from trails-tab.js, strings, help).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const TC = require(path.join(__dirname, "..", "maps", "trails-core.js"));
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("area query: numbers only, small views only", () => {
  assert.equal(TC.areaQuery(37.9, 23.6, 38, 23.8),
    '[out:json][timeout:25];rel[type=route][route~"^(hiking|foot|walking|bicycle|mtb)$"](37.90000,23.60000,38.00000,23.80000);out tags center 200;');
  assert.equal(TC.areaQuery(37, 22, 40, 23), "", "wider than 2° asks nothing");
  assert.equal(TC.areaQuery(38, 23, 37, 24), "");
  assert.equal(TC.areaQuery("1);out;(", 23, 38, 24), "");
  assert.equal(TC.geomQuery(11), "[out:json][timeout:25];rel(11);out tags geom;");
  assert.equal(TC.geomQuery("11"), "");
  assert.equal(TC.geomQuery(1.5), "");
  assert.equal(TC.osmRelLink(11), "https://www.openstreetmap.org/relation/11");
});

test("routes in view: nearest first, only trail routes with a middle", () => {
  const rel = (id, tags, c) => ({ type: "relation", id, tags: Object.assign({ type: "route" }, tags), center: c });
  const list = TC.areaRoutes({ elements: [
    rel(2, { route: "bicycle", name: "Far", from: "A\u0000B" }, { lat: 38.1, lon: 23 }),
    rel(1, { route: "hiking", ref: "M1", roundtrip: "yes", to: "x".repeat(200) }, { lat: 38.001, lon: 23 }),
    rel(3, { route: "bus" }, { lat: 38, lon: 23 }),
    rel(4, { route: "mtb" }, null),
    rel(1, { route: "hiking" }, { lat: 38, lon: 23 })
  ] }, { lat: 38, lon: 23 });
  assert.deepEqual(list.map(r => r.id), [1, 2]);
  assert.equal(list[0].d, 111);
  assert.equal(list[0].round, true);
  assert.equal(list[0].to.length, 80);
  assert.equal(list[1].from, "A B");
  assert.equal(list[1].kind, "bike");
  assert.deepEqual(TC.areaRoutes(null, null), []);
});

test("ways that share an end become one line", () => {
  const c = TC.chain([[[0, 0], [0, 1]], [[0, 2], [0, 1]], [[0, 3], [0, 2]], [[5, 5], [5, 6]], [[0, -1], [0, 0]]]);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].l, [[0, -1], [0, 0], [0, 1], [0, 2], [0, 3]]);
  assert.ok(Math.abs(c[0].m - 4 * 111195) < 50);
  assert.deepEqual(c[1].l, [[5, 5], [5, 6]]);
});

test("one route: parts, length, bounds, ends, text and links checked", () => {
  const w = (pts, role) => ({ type: "way", ref: 1, role: role || "", geometry: pts.map(p => ({ lat: p[0], lon: p[1] })) });
  const j = { elements: [{ type: "relation", id: 11, tags: { type: "route", route: "hiking", name: "Ridge", from: "Village", to: "Peak",
      description: "Old\u0007 path", operator: "Club", website: "javascript:alert(1)" },
    members: [w([[38, 23.70], [38, 23.73]]), w([[38, 23.76], [38, 23.73]]), w([[38, 23.8], [38, 23.81]], "platform"),
      { type: "node", ref: 5, role: "guidepost", lat: 38, lon: 23.7 }, w([[38, 23.9]]), w([[38.05, 23.70], [38.05, 23.71]], "alternative")] }] };
  const tr = TC.trailOf(j, 11);
  assert.equal(tr.parts.length, 2, "platform and one-point ways dropped");
  assert.deepEqual(tr.start, [38, 23.70]);
  assert.deepEqual(tr.end, [38, 23.76]);
  assert.ok(tr.m > 6000 && tr.m < 6200, tr.m);
  assert.deepEqual(tr.bounds, [[38, 23.70], [38.05, 23.76]]);
  assert.equal(tr.info.from, "Village");
  assert.equal(tr.desc, "Old path");
  assert.equal(tr.op, "Club");
  assert.equal(tr.site, "", "only https links");
  assert.equal(TC.trailOf(j, 12), null);
  assert.equal(TC.trailOf({ elements: [{ type: "relation", id: 9, tags: { route: "hiking" }, members: [] }] }, 9), null);
  j.elements[0].tags.website = "https://club.example/m1";
  assert.equal(TC.trailOf(j, 11).site, "https://club.example/m1");
});

test("wiring: Discover tab, elevation, strings in EN, EL and DE, help", () => {
  const html = read("maps/index.html");
  assert.ok(html.indexOf('src="discover.js') < html.indexOf('src="trails-tab.js'));
  assert.ok(html.indexOf('src="trails.js') < html.indexOf('src="trails-tab.js'));
  const disc = read("maps/discover.js");
  assert.match(disc, /function addTab\(def\)/);
  assert.match(disc, /wantTab/, "a saved added tab comes back");
  assert.match(read("maps/planner.js"), /H\.elevationOf = function/);
  const ui = read("maps/trails-tab.js");
  assert.doesNotMatch(ui, /innerHTML\s*=/);
  assert.match(ui, /D\.addTab\(\{ id: "trails", pos: 1/);
  const vm = require("vm");
  const m = ui.match(/var STR = (\{[\s\S]*?\n  \});/);
  assert.ok(m, "STR table found");
  const STR = vm.runInNewContext("(" + m[1] + ")", {});
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.el).sort(), "EN and EL have the same keys");
  ["all", "foot", "bike", "mtb"].forEach(k => assert.ok(STR.en["trt.f." + k] && STR.el["trt.f." + k]));
  const de = read("i18n/de/maps.js");
  Object.keys(STR.en).forEach(k => assert.ok(de.indexOf('"' + k + '"') >= 0, "de " + k));
  assert.match(read("maps/help.en.txt"), /Discover › `Trails`/);
  assert.match(read("maps/help.el.txt"), /`Μονοπάτια`/);
  assert.match(read("i18n/de/help/maps.txt"), /`Touren`/);
});
