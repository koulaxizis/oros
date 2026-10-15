// Workouts "Import workouts" (fitness/import.js): FitNotes and JEFIT
// CSV (through fitness.js buildImport, as the app does), TCX, GPX, a
// Garmin FIT file written byte by byte here (definition + data
// messages, a big-endian definition, developer fields, a compressed
// timestamp header, CRC), .gz and a bulk zip; the activity merge plan
// (stable ids, re-import adds nothing, the user's workouts win,
// deleted ones stay deleted unless revived, Undo through tombstones).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { webcrypto } = require("crypto");

const ROOT = path.join(__dirname, "..");
const X = require(path.join(ROOT, "fitness/import.js"));
const G = require(path.join(ROOT, "fitness/gps-core.js"));
const Z = require(path.join(ROOT, "atelier/zip.js"));
globalThis.OrosFitnessGps = G;

// fitness.js sections 1–4 (as in fitness.test.js): parseImport,
// buildImport, mergeFit.
const src = fs.readFileSync(path.join(ROOT, "fitness/fitness.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const F = new Function("crypto",
  "var LANG = 'en';\n" +
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  var STRINGS", "  function newId(") +
  block("  // ---------- 2. Ready", "  // ---------- 5. Storage") +
  "\nreturn { parseImport, buildImport, mergeFit, emptyData };")(webcrypto);

const enc = (s) => new TextEncoder().encode(s);
const file = (name, data) => ({ name, bytes: typeof data === "string" ? enc(data) : data });

// ---------- fixtures ----------
const FITNOTES =
  "Date,Exercise,Category,Weight (kg),Reps,Distance,Distance Unit,Time,Comment\n" +
  "2024-03-01,Flat Barbell Bench Press,Chest,80.0,8,,,,felt strong\n" +
  "2024-03-01,Flat Barbell Bench Press,Chest,80.0,7,,,,\n" +
  "2024-03-01,Treadmill,Cardio,,,2.5,km,0:15:00,\n" +
  "2024-03-03,Plank,Abs,,,,,0:01:30,\n" +
  "2024-03-03,Zercher Squat,Legs,60,5,,,,\n" +
  "not a date,Ghost,Legs,1,1,,,,\n";

const JEFIT =
  "### WORKOUT SESSIONS ###\n" +
  "_id,mydate,starttime,endtime,total_time\n" +
  "7,2024-04-02,1712044800,1712048400,3600\n" +
  "\n" +
  "### EXERCISE LOGS ###\n" +
  "_id,mydate,eid,ename,logs,belongsession\n" +
  "1,2024-04-02,12,Barbell Squat,\"100x5,100x5,105x3\",7\n" +
  "2,2024-04-02,401,,\"20x12,20 x 10\",7\n" +
  "3,2024-04-05,13,Pull Up,\"0x8,x6\",\n" +
  "\n" +
  "### CUSTOM EXERCISES ###\n" +
  "_id,name,bodypart\n" +
  "401,Cable Wood Chop,abs\n";

const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
 <Activities>
  <Activity Sport="Running">
   <Id>2024-05-01T06:00:00Z</Id>
   <Lap StartTime="2024-05-01T06:00:00Z">
    <TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>2000</DistanceMeters><Calories>150</Calories>
    <AverageHeartRateBpm><Value>140</Value></AverageHeartRateBpm>
    <Track>
     <Trackpoint><Time>2024-05-01T06:00:00Z</Time><Position><LatitudeDegrees>37.9700</LatitudeDegrees><LongitudeDegrees>23.7200</LongitudeDegrees></Position><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
     <Trackpoint><Time>2024-05-01T06:05:00Z</Time><Position><LatitudeDegrees>37.9790</LatitudeDegrees><LongitudeDegrees>23.7200</LongitudeDegrees></Position></Trackpoint>
     <Trackpoint><Time>2024-05-01T06:10:00Z</Time><Position><LatitudeDegrees>37.9880</LatitudeDegrees><LongitudeDegrees>23.7200</LongitudeDegrees></Position></Trackpoint>
    </Track>
   </Lap>
  </Activity>
  <Activity Sport="Other">
   <Id>2024-05-02T18:00:00Z</Id>
   <Lap StartTime="2024-05-02T18:00:00Z"><TotalTimeSeconds>1800</TotalTimeSeconds><Calories>200</Calories></Lap>
  </Activity>
 </Activities>
</TrainingCenterDatabase>`;

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="StravaGPX"><trk><name>Morning Ride &amp; coffee</name><type>1</type><trkseg>
<trkpt lat="38.0" lon="23.7"><time>2024-06-01T07:00:00Z</time></trkpt>
<trkpt lat="38.01" lon="23.7"><time>2024-06-01T07:03:00Z</time></trkpt>
<trkpt lat="38.02" lon="23.7"><time>2024-06-01T07:06:00Z</time></trkpt>
</trkseg></trk></gpx>`;

// A FIT file written by hand: header (14 bytes, its own CRC), a record
// definition (little-endian, with one developer field), three records
// (the third with a compressed timestamp header), a session
// definition (big-endian) and a session, then the file CRC.
const FIT_EPOCH = 631065600;
const T0 = Date.UTC(2024, 6, 1, 5, 0, 0) / 1000 - FIT_EPOCH;      // 2024-07-01 05:00 UTC
const semi = (deg) => Math.round(deg * 2147483648 / 180);
function buildFit(opts) {
  opts = opts || {};
  const body = [];
  const u8 = (v) => body.push(v & 0xff);
  const u16le = (v) => { u8(v); u8(v >> 8); };
  const u32le = (v) => { u16le(v & 0xffff); u16le((v >>> 16) & 0xffff); };
  const u16be = (v) => { u8(v >> 8); u8(v); };
  const u32be = (v) => { u16be((v >>> 16) & 0xffff); u16be(v & 0xffff); };
  // definition: local 0, record (20), with developer data flag
  u8(0x40 | 0x20); u8(0); u8(0); u16le(20); u8(5);
  [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [5, 4, 0x86], [3, 1, 0x02]].forEach((f) => f.forEach(u8));
  u8(1); [0, 1, 0].forEach(u8);                         // one developer field, 1 byte
  const rec = (ts, lat, lon, dist, hr) => { u32le(ts); u32le(semi(lat)); u32le(semi(lon)); u32le(dist); u8(hr); u8(0x55); };
  u8(0x00); rec(T0, 37.97, 23.72, 0, 130);
  u8(0x00); rec(T0 + 300, 37.98, 23.72, 111200, 150);
  // compressed timestamp header: local 0, offset = (T0 + 310) & 31
  u8(0x80 | (0 << 5) | ((T0 + 310) & 0x1f));
  u32le(0xffffffff);                                    // invalid timestamp field: the header's time is used
  u32le(semi(37.99)); u32le(semi(23.72)); u32le(222400); u8(160); u8(0x55);
  // definition: local 1, session (18), big-endian
  u8(0x41); u8(0); u8(1); u16be(18); u8(8);
  [[253, 4, 0x86], [2, 4, 0x86], [5, 1, 0x00], [7, 4, 0x86], [8, 4, 0x86], [9, 4, 0x86], [11, 2, 0x84], [16, 1, 0x02]]
    .forEach((f) => f.forEach(u8));
  u8(0x01); u32be(T0 + 320); u32be(T0); u8(opts.sport == null ? 1 : opts.sport); u32be(320000); u32be(310000);
  u32be(222400); u16be(95); u8(148);
  const head = [14, 0x20, 0x08, 0x08, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0];
  head[4] = body.length & 0xff; head[5] = (body.length >> 8) & 0xff;
  const hb = Uint8Array.from(head);
  const hc = X.crc16(hb, 0, 12);
  hb[12] = hc & 0xff; hb[13] = hc >> 8;
  const all = new Uint8Array(14 + body.length + 2);
  all.set(hb, 0); all.set(body, 14);
  const c = X.crc16(all, 0, 14 + body.length);
  all[14 + body.length] = c & 0xff; all[15 + body.length] = c >> 8;
  return all;
}

// ---------- FitNotes / JEFIT ----------
test("fitnotes: rows by date, units, time, distance, comments", async () => {
  const res = await X.parse(file("FitNotes_Export.csv", FITNOTES), { sets: F.parseImport });
  assert.equal(res.kind, "sets");
  const p = res.parsed;
  assert.equal(p.src, "fitnotes");
  assert.equal(p.unitKnown, true);
  assert.equal(p.rows.length, 5);
  const run = p.rows.find((r) => r.ex === "Treadmill");
  assert.equal(run.dist, 2500); assert.equal(run.t, 900); assert.equal(run.du, "m");
  assert.equal(p.rows.find((r) => r.ex === "Plank").t, 90);
  assert.equal(p.rows[0].wu, "kg"); assert.equal(p.rows[0].exNote, "felt strong");
  const plan = F.buildImport(F.emptyData(), p, "kg", 1000);
  assert.equal(plan.wo.length, 2);                      // two dates
  assert.equal(plan.sets, 5);
  assert.deepEqual([plan.from, plan.to], ["2024-03-01", "2024-03-03"]);
  const bench = plan.wo[0].x[0];
  assert.equal(bench.s[0][0], 80000); assert.equal(bench.s[0][1], 8);
  assert.ok(plan.newNames.includes("Zercher Squat"));
  // lbs header
  const lb = X.parseFitNotes(FITNOTES.replace("Weight (kg)", "Weight (lbs)"));
  assert.equal(lb.rows[0].wu, "lb");
  assert.equal(F.buildImport(F.emptyData(), lb, "kg", 1).wo[0].x[0].s[0][0], Math.round(80 * 453.59237));
});

test("fitnotes: re-import adds nothing; deleted stays deleted unless revived", () => {
  const p = X.parseFitNotes(FITNOTES);
  let d = F.emptyData();
  const plan = F.buildImport(d, p, "kg", 1000);
  d = F.mergeFit(d, { wo: plan.wo, ex: plan.ex });
  const again = F.buildImport(d, p, "kg", 2000);
  assert.equal(again.wo.length, 0); assert.equal(again.skipped, 2);
  // Undo / delete: a newer tombstone
  const id = plan.wo[0].id;
  d = F.mergeFit(d, { tombs: { ["wo:" + id]: 5000 } });
  assert.equal(d.wo.length, 1);
  const third = F.buildImport(d, p, "kg", 3000);
  assert.equal(third.wo.length, 0); assert.equal(third.gone, 1);
  const rev = F.buildImport(d, p, "kg", 3000, true);
  assert.equal(rev.wo.length, 1); assert.equal(rev.wo[0].m, 5001);
  d = F.mergeFit(d, { wo: rev.wo });
  assert.equal(d.wo.length, 2);
});

test("jefit: sections, sessions, eid names, 'weight x reps' logs, unit unknown", async () => {
  const res = await X.parse(file("jefit.csv", JEFIT), { sets: F.parseImport });
  assert.equal(res.kind, "sets");
  const p = res.parsed;
  assert.equal(p.src, "jefit");
  assert.equal(p.unitKnown, false);
  assert.equal(p.rows.length, 7);
  const chop = p.rows.filter((r) => r.ex === "Cable Wood Chop");
  assert.deepEqual(chop.map((r) => [r.w, r.r]), [[20, 12], [20, 10]]);
  const sq = p.rows.filter((r) => r.ex === "Barbell Squat");
  assert.equal(sq[0].start, 1712044800000); assert.equal(sq[0].end, 1712048400000);
  assert.deepEqual(p.rows.filter((r) => r.ex === "Pull Up").map((r) => [r.w, r.r]), [[0, 8], [0, 6]]);
  const plan = F.buildImport(F.emptyData(), p, "lb", 1);
  assert.equal(plan.wo.length, 2);
  assert.equal(plan.wo[0].en - plan.wo[0].st, 3600000);
  assert.equal(plan.wo[0].x[0].s[0][0], Math.round(100 * 453.59237));
  assert.equal(plan.wo[0].x[0].e, "x-squat");          // matched a ready exercise
  // tolerant: no header rows, junk
  assert.equal(X.parseJefit("### NOTHING\n"), null);
  assert.equal(X.parseJefit("a,b\n1,2"), null);
});

test("strong csv still goes through the same entry point", async () => {
  const strong = "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes\n" +
    "2024-01-02 08:00:00,Push,45m,Bench Press (Barbell),1,60,8,0,0,,\n";
  const res = await X.parse(file("strong.csv", strong), { sets: F.parseImport });
  assert.equal(res.kind, "sets"); assert.equal(res.parsed.src, "strong");
  assert.equal(await X.parse(file("x.csv", "a,b\n1,2\n"), { sets: F.parseImport }), null);
});

// ---------- activities ----------
test("tcx: sport, laps, track, heart rate, notes", () => {
  const acts = X.parseTcx(TCX);
  assert.equal(acts.length, 2);
  const r = acts[0];
  assert.equal(r.a, "run"); assert.equal(r.ex, "x-run"); assert.equal(r.src, "tcx");
  assert.equal(r.start, Date.UTC(2024, 4, 1, 6)); assert.equal(r.time, 600); assert.equal(r.dist, 2000);
  assert.equal(r.cal, 150); assert.equal(r.hr, 140);
  assert.equal(r.segs.length, 1); assert.equal(r.segs[0].length, 3);
  const o = acts[1];
  assert.equal(o.a, ""); assert.equal(o.ex, ""); assert.equal(o.sport, "Other"); assert.equal(o.time, 1800);
  assert.equal(o.end - o.start, 1800000);
});

test("gpx: Strava type, name, distance from the track", () => {
  const a = X.parseGpx(GPX)[0];
  assert.equal(a.a, "ride"); assert.equal(a.title, "Morning Ride & coffee");
  assert.equal(a.time, 360); assert.ok(Math.abs(a.dist - 2224) < 10, String(a.dist));
  assert.deepEqual(X.parseGpx("<gpx><trk><trkseg><trkpt lat='1' lon='2'/></trkseg></trk></gpx>"), []);   // no times
});

test("fit: header + CRC, definitions LE/BE, developer field, compressed timestamp", () => {
  const b = buildFit();
  const f = X.decodeFit(b);
  assert.equal(f.crcOk, true);
  assert.equal(f.records.length, 3);
  assert.equal(f.records[2][253], T0 + 310);            // from the compressed header
  assert.equal(f.records[1][3], 150);
  assert.equal(f.sessions.length, 1);
  assert.equal(f.sessions[0][2], T0); assert.equal(f.sessions[0][9], 222400);
  const a = X.parseFit(b)[0];
  assert.equal(a.src, "fit"); assert.equal(a.a, "run");
  assert.equal(a.start, (T0 + FIT_EPOCH) * 1000);
  assert.equal(a.end - a.start, 320000); assert.equal(a.time, 310);
  assert.equal(a.dist, 2224); assert.equal(a.cal, 95); assert.equal(a.hr, 148);
  assert.equal(a.segs[0].length, 3);
  assert.ok(Math.abs(a.segs[0][2][0] - 37.99) < 1e-6);
  assert.equal(a.segs[0][2][3], (T0 + 310 + FIT_EPOCH) * 1000);
  // other sports
  assert.equal(X.parseFit(buildFit({ sport: 2 }))[0].a, "ride");
  assert.equal(X.parseFit(buildFit({ sport: 5 }))[0].ex, "x-swim");
  assert.equal(X.parseFit(buildFit({ sport: 10 }))[0].ex, "");
  // a flipped byte: CRC reported, nothing thrown
  const bad = b.slice(); bad[40] ^= 0xff;
  assert.equal(X.decodeFit(bad).crcOk, false);
  // cut short, junk, empty
  assert.doesNotThrow(() => X.parseFit(b.slice(0, 60)));
  assert.deepEqual(X.parseFit(b.slice(0, 20)), []);
  assert.equal(X.decodeFit(enc("hello world, not a fit")), null);
  for (let n = 0; n < 200; n++) {                       // random noise after a valid header
    const r = b.slice(); for (let i = 14; i < r.length; i++) if ((i * 31 + n) % 7 === 0) r[i] = (i * n) & 0xff;
    assert.doesNotThrow(() => X.parseFit(r));
  }
});

test("parse: .fit, .gz, a bulk zip with nested zip, unreadable files counted", async () => {
  const one = await X.parse(file("123.fit", buildFit()));
  assert.equal(one.kind, "acts"); assert.equal(one.src, "fit"); assert.equal(one.acts.length, 1);
  const gz = await X.parse(file("a.tcx.gz", zlib.gzipSync(Buffer.from(TCX))));
  assert.equal(gz.src, "tcx"); assert.equal(gz.acts.length, 2);
  const inner = Z.write([{ name: "UploadedFiles_0-_Part1/7.fit", data: buildFit({ sport: 2 }) }]);
  const zip = Z.write([
    { name: "activities/1.fit", data: buildFit() },
    { name: "activities/2.tcx", data: TCX },
    { name: "activities/3.gpx.gz", data: new Uint8Array(zlib.gzipSync(Buffer.from(GPX))) },
    { name: "activities/4.gpx", data: "<gpx></gpx>" },
    { name: "activities.csv", data: "a,b\n" },
    { name: "DI_CONNECT/uploads.zip", data: inner }
  ]);
  const res = await X.parse(file("export.zip", zip));
  assert.equal(res.kind, "acts"); assert.equal(res.src, "zip");
  assert.equal(res.files, 5); assert.equal(res.bad, 1);
  assert.equal(res.acts.length, 5);                     // fit + 2 tcx + gpx + nested fit
  assert.equal(await X.parse(file("x.zip", Z.write([{ name: "a.txt", data: "x" }]))), null);
});

test("buildActs: workout shape, route, dedupe, user's workouts win, revive, undo-safe", () => {
  const acts = X.parseTcx(TCX).concat(X.parseFit(buildFit()), X.parseGpx(GPX));
  const label = (k) => ({ "gps.run": "Run", "gps.ride": "Ride", "gps.walk": "Walk" })[k];
  let d = F.emptyData();
  // a workout recorded here at the GPX ride's start + 20 s
  d.wo.push({ id: "mine1", m: 1, d: "2024-06-01", st: Date.UTC(2024, 5, 1, 7, 0, 20), en: Date.UTC(2024, 5, 1, 8), ti: "", p: "", pd: "", n: "", x: [] });
  d = F.mergeFit(d, d);
  const plan = X.buildActs(d, acts.concat(X.parseFit(buildFit())), { now: 1e12, label: label, note: (a) => a.cal + " kcal" });
  assert.equal(plan.wo.length, 3);                      // tcx run, tcx other, fit run (the fit twice → once)
  assert.equal(plan.skipped, 1);                        // the ride is already here
  assert.equal(plan.routes, 2);
  assert.deepEqual(plan.kinds, { run: 2, other: 1 });
  const run = plan.wo.find((w) => w.st === Date.UTC(2024, 4, 1, 6));
  assert.match(run.id, /^imp-[a-z0-9]+$/);
  assert.equal(run.ti, "Run"); assert.equal(run.n, "150 kcal");
  assert.deepEqual(run.x, [{ e: "x-run", tr: 0, tr2: 0, rest: 0, s: [[0, 0, 600, 2000, 1]] }]);
  assert.equal(run.g.a, "run");
  assert.equal(G.segsOf(run.g, run.st)[0].length >= 2, true);
  const other = plan.wo.find((w) => !w.x.length);
  assert.equal(other.ti, "Other"); assert.equal(other.en - other.st, 1800000);
  // merges cleanly; ids stable; re-import adds nothing
  d = F.mergeFit(d, { wo: plan.wo });
  assert.equal(d.wo.length, 4);
  assert.ok(d.wo.find((w) => w.id === run.id).g, "route kept through normWo");
  const again = X.buildActs(d, acts, { now: 2e12 });
  assert.equal(again.wo.length, 0); assert.equal(again.skipped, 4);
  // undo = newer tombstones: gone from view and from re-import, unless revived
  const tombs = {};
  plan.wo.forEach((w) => { tombs["wo:" + w.id] = Math.max(w.m, 1e12 + 5); });
  d = F.mergeFit(d, { tombs });
  assert.equal(d.wo.length, 1);
  const back = X.buildActs(d, acts, { now: 1e12 });
  assert.equal(back.wo.length, 0); assert.equal(back.gone, 3);
  const rev = X.buildActs(d, acts, { now: 1e12, revive: true });
  assert.equal(rev.wo.length, 3);
  d = F.mergeFit(d, { wo: rev.wo });
  assert.equal(d.wo.length, 4);
});

test("buildActs: route budget leaves long tracks without a route", () => {
  const seg = [];
  for (let i = 0; i < 30000; i++) seg.push([37 + Math.sin(i) * 0.01 + i * 1e-5, 23 + Math.cos(i * 1.7) * 0.01, null, Date.UTC(2024, 0, 1) + i * 1000]);
  const acts = [];
  for (let k = 0; k < 40; k++) acts.push({ key: "act|" + k, src: "gpx", sport: "running", a: "run", ex: "x-run", title: "",
    start: Date.UTC(2024, 0, 1 + k), end: Date.UTC(2024, 0, 1 + k) + 3e6, time: 3000, dist: 10000, cal: 0, hr: 0,
    segs: [seg.map((p) => [p[0], p[1], null, p[3] + k * 86400000])] });
  const plan = X.buildActs(F.emptyData(), acts, { now: 1 });
  assert.equal(plan.wo.length, 40);
  assert.ok(plan.noRoute > 0, "some without a route");
  let chars = 0;
  plan.wo.forEach((w) => { if (w.g) w.g.sg.forEach((s) => { chars += s.length; }); });
  assert.ok(chars <= X.ROUTE_BUDGET);
});
