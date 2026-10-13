// Favourite groups (maps/fav-core.js, maps wave 10C): the "mapsfav"
// slice (strict records, LWW merge, tombs), which group a place is
// in, list sections, GPX of a group and waypoints back to places.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const FC = require(path.join(__dirname, "..", "maps", "fav-core.js"));
const T = require(path.join(__dirname, "..", "maps", "tracks-core.js"));
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const P1 = "p37.975200,23.730200", P2 = "p-33.000000,-70.100000";

test("normalize keeps only well-formed records", () => {
  const d = FC.normalize({
    groups: {
      gabcd1: { name: "  Cafés \n<b>", color: "#e06c75", m: 5 },
      gabcd2: { name: "", color: "#e06c75", m: 5 },          // no name
      gabcd3: { name: "x", color: "red", m: 5 },              // colour → first
      BAD: { name: "x", m: 5 },
      gabcd4: { name: "gone", m: 3 }
    },
    pins: { [P1]: { g: "gabcd1", m: 7 }, [P2]: { g: "nope!", m: 2 }, "p1,2": { g: "gabcd1", m: 1 }, x: {} },
    tombs: { gabcd4: 3, gabcd9: 10, BAD: 4 }
  });
  assert.deepEqual(Object.keys(d.groups), ["gabcd1", "gabcd3"]);
  assert.equal(d.groups.gabcd1.name, "Cafés b", "control chars and <> cleaned");
  assert.equal(d.groups.gabcd3.color, FC.COLORS[0]);
  assert.deepEqual(d.pins, { [P1]: { g: "gabcd1", m: 7 }, [P2]: { g: "", m: 2 } });
  assert.deepEqual(d.tombs, { gabcd4: 3, gabcd9: 10 });
  assert.deepEqual(FC.normalize(d), d, "idempotent");
  assert.deepEqual(FC.normalize(null), { ver: 1, groups: {}, pins: {}, tombs: {} });
  assert.match(FC.newId(1791900000000, 0.5), FC.GID_RE);
});

test("merge: LWW by m, equal m by canonical JSON, tombs win ties, symmetric", () => {
  const a = { groups: { gaaaa1: { name: "Work", color: FC.COLORS[1], m: 10 } }, pins: { [P1]: { g: "gaaaa1", m: 4 } } };
  const b = { groups: { gaaaa1: { name: "Office", color: FC.COLORS[1], m: 12 } }, pins: { [P1]: { g: "", m: 6 } } };
  const ab = FC.merge(a, b), ba = FC.merge(b, a);
  assert.deepEqual(ab, ba);
  assert.equal(ab.groups.gaaaa1.name, "Office");
  assert.equal(ab.pins[P1].g, "");
  const c = { tombs: { gaaaa1: 12 } };
  assert.equal(FC.merge(ab, c).groups.gaaaa1, undefined, "delete wins an equal m");
  const d = { groups: { gaaaa1: { name: "Back", color: FC.COLORS[2], m: 13 } } };
  assert.equal(FC.merge(FC.merge(ab, c), d).groups.gaaaa1.name, "Back", "a newer edit resurrects");
  const e1 = { groups: { gbbbb1: { name: "A", color: FC.COLORS[0], m: 9 } } };
  const e2 = { groups: { gbbbb1: { name: "B", color: FC.COLORS[0], m: 9 } } };
  assert.deepEqual(FC.merge(e1, e2), FC.merge(e2, e1), "tie decided the same way on both sides");
  // Random fuzz: merge is commutative, associative and idempotent
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ids = ["gaaaa1", "gaaaa2", "gaaaa3"], pids = [P1, P2];
  const rand = () => {
    const o = { groups: {}, pins: {}, tombs: {} };
    ids.forEach(id => { if (rnd() < 0.6) o.groups[id] = { name: "n" + Math.floor(rnd() * 3), color: FC.COLORS[Math.floor(rnd() * 8)], m: 1 + Math.floor(rnd() * 5) }; if (rnd() < 0.3) o.tombs[id] = 1 + Math.floor(rnd() * 5); });
    pids.forEach(id => { if (rnd() < 0.7) o.pins[id] = { g: rnd() < 0.3 ? "" : ids[Math.floor(rnd() * 3)], m: 1 + Math.floor(rnd() * 5) }; });
    return o;
  };
  for (let i = 0; i < 500; i++) {
    const x = rand(), y = rand(), z = rand();
    assert.deepEqual(FC.merge(x, y), FC.merge(y, x));
    assert.deepEqual(FC.merge(FC.merge(x, y), z), FC.merge(x, FC.merge(y, z)));
    assert.deepEqual(FC.merge(x, x), FC.normalize(x));
  }
});

test("limits: newest groups and pins kept", () => {
  const groups = {};
  for (let i = 0; i < FC.LIM.groups + 5; i++) groups["gzzzz" + String(i).padStart(3, "0")] = { name: "g" + i, m: 1 + i };
  const d = FC.normalize({ groups });
  assert.equal(Object.keys(d.groups).length, FC.LIM.groups);
  assert.ok(!d.groups.gzzzz000, "the oldest went");
});

test("group of a place, order, find by name, sections", () => {
  const d = FC.normalize({
    groups: { gaaaa1: { name: "Ψαροταβέρνες", color: FC.COLORS[1], m: 2 }, gaaaa2: { name: "archaia", color: FC.COLORS[2], m: 2 } },
    pins: { [P1]: { g: "gaaaa1", m: 3 }, [P2]: { g: "gdead1", m: 3 } }
  });
  assert.equal(FC.groupOf(d, P1), "gaaaa1");
  assert.equal(FC.groupOf(d, P2), "", "deleted group → no group");
  assert.equal(FC.groupOf(d, "p0.000000,0.000000"), "");
  assert.deepEqual(FC.order(d, "en"), ["gaaaa2", "gaaaa1"]);
  assert.deepEqual(FC.order(d, "el"), ["gaaaa1", "gaaaa2"], "Greek letters first in Greek");
  assert.equal(FC.findByName(d, "ΨΑΡΟΤΑΒΕΡΝΕΣ", "el"), "gaaaa1", "case and accents ignored");
  assert.equal(FC.findByName(d, "nothing", "el"), "");
  const places = [
    { id: P2, name: "b", lat: -33, lon: -70.1, mtime: 5 },
    { id: P1, name: "a", lat: 37.9752, lon: 23.7302, mtime: 9 },
    { id: "p1.000000,1.000000", name: "c", lat: 1, lon: 1, mtime: 1 }
  ];
  const s = FC.sections(d, places, "en");
  assert.deepEqual(s.map(x => x.g), ["gaaaa2", "gaaaa1", ""]);
  assert.deepEqual(s[0].places, [], "empty groups listed too");
  assert.deepEqual(s[1].places.map(p => p.name), ["a"]);
  assert.deepEqual(s[2].places.map(p => p.name), ["c", "b"], "oldest first");
});

test("GPX of a group and its waypoints back to places", () => {
  const gpx = FC.toGpx("Cafés & <bars>", [
    { name: "Κάβα \"Νο 1\"", sub: "Ermou 5", lat: 37.9752, lon: 23.7302 },
    { name: "x", lat: "bad", lon: 1 }
  ]);
  assert.match(gpx, /<name>Cafés &amp; bars<\/name>/);
  assert.match(gpx, /<type>Cafés &amp; bars<\/type>/);
  assert.ok(!/<bars>/.test(gpx));
  const tr = T.parseAny(gpx, "x.gpx");
  assert.equal(tr.segs.length, 0);
  assert.equal(tr.wpts.length, 1);
  assert.equal(tr.wpts[0].name, "Κάβα \"Νο 1\"");
  const back = FC.fromWpts(tr.wpts.concat([{ lat: 37.9752, lon: 23.7302, name: "dup" }, { lat: 99, lon: 0 }, null]));
  assert.deepEqual(back, [{ lat: 37.9752, lon: 23.7302, name: "Κάβα \"Νο 1\"", sub: "" }], "dupes, bad points dropped");
  assert.equal(FC.fromWpts([{ lat: 1, lon: 1 }])[0].name, "?");
  assert.equal(FC.fromWpts(Array.from({ length: 20 }, (_, i) => ({ lat: i, lon: i })), 5).length, 5);
});

test("wiring: scripts, precache, hooks in maps.js and tracks.js, slice", () => {
  const html = read("maps/index.html");
  assert.ok(html.indexOf('src="tracks-core.js') < html.indexOf('src="fav.js'));
  assert.ok(html.indexOf("fav-core.js") < html.indexOf('src="fav.js'));
  const sw = read("sw.js");
  assert.match(sw, /"maps\/fav-core\.js"/);
  assert.match(sw, /"maps\/fav\.js"/);
  const mj = read("maps/maps.js");
  assert.match(mj, /window\.__orosMapsFav/);
  assert.match(mj, /refreshPlaces:/);
  assert.match(mj, /addPlaces:/);
  assert.match(read("maps/tracks.js"), /__orosMapsFav\.importWpts/);
  const fj = read("maps/fav.js");
  assert.match(fj, /registerSlice\("mapsfav", sliceGet, sliceSet, DATA_KEY, FC\.merge\)/);
  assert.ok(!/innerHTML\s*=\s*[^'"I;]*name/i.test(fj), "names never through innerHTML");
  assert.ok(!/window\.confirm|[^.]confirm\(/.test(fj), "no native confirm (R14)");
});
