// The .orosworkouts file (Workouts, fitness/): own exercises, programs,
// progression programs, finished workouts and body measurements
// through the shared kit (recordpkg.js) and bundle.js; opening adds
// only what is missing, with its ids. Plus the app wiring (Save, Open,
// unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "fitness/package.js"));
const GPS = require(path.join(ROOT, "fitness/gps-core.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const H = 3600000;

// The app's own mergeFit (fitness.js section 3, cut out of the IIFE as
// tests/fitness.test.js does): what the app's set hook runs the result
// through.
const src = read("fitness/fitness.js");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const APP = new Function("OrosFitnessGps",
  "var LANG = 'en'; var window = { OrosFitnessGps: OrosFitnessGps };\n" +
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr", "  function newId(") +
  block("  // ---------- 2. Ready", "  // ---------- 4. Numbers") +
  "\nreturn { mergeFit, emptyData };")(GPS);

function slice() {
  const t0 = NOW - 8 * H;
  const seg = GPS.encSeg([[37.975, 23.735, null, t0], [37.976, 23.736, null, t0 + 60000], [37.977, 23.737, null, t0 + 120000]], t0);
  return {
    ver: 1,
    ex: [{ id: "my-sled", m: NOW - 9000, n: "Sled push", g: "legs", k: "wr", h: 0 },
         { id: "x-bench", m: NOW - 8900, n: "", g: "chest", k: "wr", h: 1 }],
    pg: [{ id: "pg-ppl", m: NOW - 8000, n: "Push", days: [{ id: "d1", n: "Push", wd: [0, 3], it: [{ e: "x-bench", s: 3, r: 5, r2: 8, t: 0, w: 60000, rest: 120 }] }] }],
    wo: [
      { id: "wo-a", m: NOW - 7000, d: "2027-01-10", st: NOW - 10 * H, en: NOW - 9 * H, ti: "=Push day", p: "pg-ppl", pd: "d1", n: "felt good",
        x: [{ e: "x-bench", tr: 5, tr2: 8, rest: 120, s: [[40000, 10, 0, 0, 3], [60000, 5, 0, 0, 1], [62500, 3, 0, 0, 0]] },
            { e: "my-sled", tr: 0, tr2: 0, rest: 0, s: [[100000, 6, 0, 0, 1]] }] },
      { id: "wo-run", m: NOW - 6000, d: "2027-01-11", st: NOW - 8 * H, en: NOW - 8 * H + 1800000, ti: "Run", p: "", pd: "", n: "",
        x: [{ e: "x-run", tr: 0, tr2: 0, rest: 0, s: [[0, 0, 1800, 5000, 1]] }], g: { a: "run", ps: 0, sg: [seg] } },
      { id: "wo-live", m: NOW - 100, d: "2027-01-12", st: NOW - 200, en: 0, ti: "Now", p: "", pd: "", n: "", x: [] }
    ],
    bm: [{ id: "2027-01-10", m: NOW - 5000, w: 80500, wa: 850, ch: 0, ar: 0 }],
    pl: [{ id: "pl-531", m: NOW - 4000, n: "5/3/1", tp: "531", rd: 2500, bb: 1, k: 3, tm: { "x-squat": 120000 }, sl: {}, fl: {} }],
    set: { m: NOW - 3000, wu: "lb", du: "mi", incU: 2500, incL: 5000, rest: 90, hb: 0 },
    tombs: { "wo:wo-gone": NOW - 50, "bm:2027-01-01": NOW - 40 }
  };
}
function device() {
  // another device: its own workout, its own settings, a deleted record
  return APP.mergeFit({
    ver: 1, ex: [], pg: [], bm: [],
    wo: [{ id: "wo-mine", m: NOW - 500, d: "2027-01-09", st: NOW - 20 * H, en: NOW - 19 * H, ti: "Mine", p: "", pd: "", n: "", x: [] }],
    set: { m: NOW - 10, wu: "kg", du: "km", incU: 1250, incL: 2500, rest: 60, hb: 1 },
    tombs: { "wo:wo-old": NOW - 900 }
  }, null);
}

test("fitness: round trip through bundle.js; no tombstones, settings or running workout in the file", async () => {
  const o = K.pack(D, slice(), { title: "Workouts", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-workouts");
  assert.equal(o.generator, "orOS Workouts");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["bm", "ex", "pg", "pl", "ver", "wo"]);
  assert.deepEqual(o.content.data.wo.map((w) => w.id), ["wo-a", "wo-run"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-workouts");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-fitness-package");
  assert.equal(slice().wo[1].g.sg[0].length > 5, true);
  assert.deepEqual(r.content.data.wo[1].g, slice().wo[1].g);          // the route comes along
  // previews: Markdown and CSV (done sets only, formula guard, metric)
  const md = o.preview.find((p) => p.name === "workouts.md").data;
  assert.match(md, /^# Workouts\n\n## 2027-01-10 · =Push day \(60 min\)\n\nfelt good\n\n- x-bench: 40 kg × 10 \(warm-up\), 60 kg × 5\n- Sled push: 100 kg × 6/);
  assert.match(md, /## Body measurements[\s\S]*\| 2027-01-10 \| 80\.5 \| 85 \| {2}\| {2}\|/);
  const csv = o.preview.find((p) => p.name === "workouts.csv").data;
  assert.match(csv, /^date,workout,exercise,set,warm_up,weight_kg,reps,time_s,distance_km,note\r\n2027-01-10,'=Push day,x-bench,1,yes,40,10,,,felt good\r\n2027-01-10,'=Push day,x-bench,2,,60,5,,,\r\n/);
  assert.match(csv, /2027-01-11,Run,x-run,1,,,,1800,5,\r\n$/);
  // the app names the ready exercises
  const named = P.withNames((id) => ({ "x-bench": "Bench press", "x-run": "Running" })[id] || "");
  const md2 = K.pack(named, slice(), { lang: "en", now: NOW }).preview.find((p) => p.name === "workouts.md").data;
  assert.match(md2, /- Bench press: 40 kg/);
  // into a device with other data
  const local = device();
  const res = K.open(D, local, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 7, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(), ["2027-01-10", "my-sled", "pg-ppl", "pl-531", "wo-a", "wo-run", "x-bench"]);
  const next = APP.mergeFit(res.next, res.next);                       // the app's set hook
  assert.deepEqual(next.wo.map((w) => w.id), ["wo-a", "wo-mine", "wo-run"]);
  assert.deepEqual(next.set, local.set);                                // this device's settings stay
  assert.deepEqual(next.tombs, local.tombs);
  assert.deepEqual(next.wo.find((w) => w.id === "wo-run").g, slice().wo[1].g);
  assert.equal(next.pl[0].tm["x-squat"], 120000);
  // and again: nothing
  const again = K.open(D, next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(APP.mergeFit(again.next, again.next), next);
  assert.equal(P.kindOf("wo-a", next), "wo");
  assert.equal(P.kindOf("2027-01-10", next), "bm");
  assert.equal(P.kindOf("pl-531", next), "pl");
  assert.equal(P.kindOf("my-sled", next), "ex");
  assert.equal(P.kindOf("nope", next), "");
});

test("fitness: a clash keeps the local record, a deleted one stays deleted, update takes newer", () => {
  const theirs = slice();
  theirs.wo[0].ti = "changed there"; theirs.wo[0].m = NOW - 1;
  theirs.bm[0].w = 99000; theirs.bm[0].m = NOW - 1;
  theirs.wo.push({ id: "wo-old", m: NOW - 1, d: "2027-01-01", st: NOW - 30 * H, en: NOW - 29 * H, ti: "deleted here", p: "", pd: "", n: "", x: [] });
  const mine = APP.mergeFit(Object.assign(slice(), { tombs: { "wo:wo-old": NOW - 900 } }), null);
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.equal(res.report.added, 0);
  const next = APP.mergeFit(res.next, res.next);
  assert.equal(next.wo.find((w) => w.id === "wo-a").ti, "=Push day");
  assert.equal(next.bm[0].w, 80500);
  assert.ok(!next.wo.some((w) => w.id === "wo-old"));
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.slice().sort(), ["2027-01-10", "wo-a"]);
  const n2 = APP.mergeFit(upd.next, upd.next);
  assert.equal(n2.wo.find((w) => w.id === "wo-a").ti, "changed there");
  assert.equal(n2.bm[0].w, 99000);
  assert.ok(!n2.wo.some((w) => w.id === "wo-old"));
  // a tombstone in the file never deletes anything here
  const t = { kind: "oros-fitness-package", ver: 1, data: { ver: 1, ex: [], pg: [], bm: [], wo: [], tombs: { "wo:wo-a": NOW } } };
  assert.deepEqual(K.open(D, mine, t, { now: NOW }).next.wo, mine.wo);
});

test("fitness: hostile content is cut down; stamps clamped", () => {
  const evil = {
    kind: "oros-fitness-package", ver: 1, data: {
      ex: [{ id: "ev", m: NOW, n: "<img src=x onerror=alert(1)>\u0000" + "x".repeat(500), g: "evil", k: "zz", onclick: "x" },
           { id: "BAD ID", m: 1, n: "x" }, { id: "nameless", m: 1 }, { id: "__proto__", m: 1, n: "p" }],
      pg: [{ id: "pg1", m: 1, n: "P", days: [{ id: "d!", it: [] }, { id: "d1", wd: [9, 1, 1, "x"], it: [{ e: "x-squat", s: 999, r: 5, r2: 3, w: -1 }, "junk"] }] }],
      wo: [{ id: "w1", m: NOW + 1e12, d: "2027-01-10", st: 5, en: 10, ti: "t", n: "a\u0001b\nc", x: [{ e: "x-squat", s: [[1e12, 5, 0, 0, 7], "junk"], pk: "zz", evil: 1 }], g: { a: "fly", sg: ["<script>"] }, __proto__: { polluted: 1 } },
           { id: "w2", m: 1, d: "tomorrow", st: 1 },
           { id: "w3", m: 1, d: "2027-01-11", st: 5, en: 1, x: [] }],      // "still running": not taken
      bm: [{ id: "not-a-day", m: 1, w: 1 }, { id: "2027-01-02", m: 1, w: 0 }, { id: "2027-01-03", m: 1, w: -5, wa: 9e9, ar: 300 }],
      pl: [{ id: "pl1", m: 1, tp: "evil" }],
      set: { m: NOW, wu: "lb" }, prefs: { x: 1 }
    }
  };
  const res = K.open(D, APP.emptyData(), evil, { now: NOW });
  const n = res.next;
  assert.deepEqual(n.ex.map((x) => x.id), ["ev"]);
  assert.equal(n.ex[0].n.length, 60);
  assert.ok(!/[\u0000]/.test(n.ex[0].n));
  assert.deepEqual([n.ex[0].g, n.ex[0].k, n.ex[0].onclick], ["full", "wr", undefined]);
  assert.deepEqual(n.pg[0].days, [{ id: "d1", n: "", wd: [1], it: [{ e: "x-squat", s: 1, r: 5, r2: 0, t: 0, w: 0, rest: 0 }] }]);
  assert.equal(n.wo.length, 1);
  const w = n.wo[0];
  assert.equal(w.m, NOW + 5 * 60 * 1000);                              // clamped to now + 5 min
  assert.equal(w.en, 10);
  assert.equal(w.n, "ab\nc");
  assert.deepEqual(w.x, [{ e: "x-squat", tr: 0, tr2: 0, rest: 0, s: [[0, 5, 0, 0, 0]] }]);
  assert.equal(w.g, undefined);
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(n.bm.map((b) => b.id), ["2027-01-03"]);
  assert.deepEqual([n.bm[0].w, n.bm[0].wa, n.bm[0].ar], [0, 0, 300]);
  assert.equal(n.pl, undefined);
  assert.equal(n.set, null);                                           // settings never come from a file
  assert.equal(n.prefs, undefined);
  assert.equal(D.norm("x"), null);
  assert.throws(() => K.open(D, APP.emptyData(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
});

test("fitness: wiring (scripts, buttons, Open with, help, file types)", () => {
  const html = read("fitness/index.html");
  ["../bundle.js?v=2.52.00", "../recordpkg.js?v=2.52.00", "package.js?v=2.52.00", "fitness.js?v=2.52.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s + '"'), s));
  assert.ok(html.indexOf("gps-core.js") < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="fitness.js'));
  const js = read("fitness/fitness.js");
  assert.match(js, /RP\.ui\(FPK\.withNames\(/);
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  assert.match(js, /removeRow\(c, id\)/);
  ["fit-osave", "fit-oopen", "fit-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.match(js, /"set\.osave": "orOS file \(\.orosworkouts\)"/);
  assert.match(js, /"set\.osave": "Αρχείο orOS \(\.orosworkouts\)"/);
  assert.equal((js.match(/window\.__orosOpenAt =/g) || []).length, 1);
  for (const f of ["fitness/help.en.txt", "fitness/help.el.txt"]) assert.ok(read(f).includes(".orosworkouts"), f);
  assert.deepEqual(F.appsFor(".orosworkouts"), ["fitness"]);
  assert.deepEqual(B.TYPES[".orosworkouts"], { app: "fitness", mime: "application/x-oros-workouts" });
});
