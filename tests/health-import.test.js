// Health "Import from another app" (health/import.js): Withings CSVs
// and ZIP, OMRON connect CSV (D/M/Y and M/D/Y), Samsung Health ZIP of
// CSVs (metadata line, prefixed columns, UTC times, heart-rate samples
// → daily low), Apple Health export.xml (streamed, BP pairing, units,
// resting heart rate) bare and zipped (deflate, ZIP64), and the plan
// (stable ids, nothing twice, the person's own readings win).
// Fixtures: tests/fixtures/health/
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const I = require(path.join(__dirname, "..", "health/import.js"));
const C = require(path.join(__dirname, "..", "health/core.js"));
const FX = path.join(__dirname, "fixtures", "health");
const fx = (n) => fs.readFileSync(path.join(FX, n), "utf8");
const local = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h || 0, mi || 0).getTime();

// a small ZIP writer: deflated or stored entries, optional ZIP64 records
function makeZip(files, opt) {
  opt = opt || {};
  const parts = [], central = [];
  let off = 0;
  for (const [name, content] of files) {
    const raw = Buffer.from(content, "utf8");
    const data = opt.store ? raw : zlib.deflateRawSync(raw);
    const nm = Buffer.from(name, "utf8");
    const z = !!opt.zip64;
    const ex = z ? Buffer.alloc(28) : Buffer.alloc(0);
    if (z) { ex.writeUInt16LE(1, 0); ex.writeUInt16LE(24, 2); ex.writeBigUInt64LE(BigInt(raw.length), 4); ex.writeBigUInt64LE(BigInt(data.length), 12); ex.writeBigUInt64LE(BigInt(off), 20); }
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(z ? 45 : 20, 4); lh.writeUInt16LE(opt.store ? 0 : 8, 8);
    lh.writeUInt32LE(z ? 0xffffffff : data.length, 18); lh.writeUInt32LE(z ? 0xffffffff : raw.length, 22);
    lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nm, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(z ? 45 : 20, 4); ch.writeUInt16LE(z ? 45 : 20, 6); ch.writeUInt16LE(opt.store ? 0 : 8, 10);
    ch.writeUInt32LE(z ? 0xffffffff : data.length, 20); ch.writeUInt32LE(z ? 0xffffffff : raw.length, 24);
    ch.writeUInt16LE(nm.length, 28); ch.writeUInt16LE(ex.length, 30); ch.writeUInt32LE(z ? 0xffffffff : off, 42);
    central.push(ch, nm, ex);
    off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), tail = [];
  if (opt.zip64) {
    const e64 = Buffer.alloc(56);
    e64.writeUInt32LE(0x06064b50, 0); e64.writeBigUInt64LE(44n, 4); e64.writeUInt16LE(45, 12); e64.writeUInt16LE(45, 14);
    e64.writeBigUInt64LE(BigInt(files.length), 24); e64.writeBigUInt64LE(BigInt(files.length), 32);
    e64.writeBigUInt64LE(BigInt(cd.length), 40); e64.writeBigUInt64LE(BigInt(off), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(off + cd.length), 8); loc.writeUInt32LE(1, 16);
    tail.push(e64, loc);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opt.zip64 ? 0xffff : files.length, 8); eocd.writeUInt16LE(opt.zip64 ? 0xffff : files.length, 10);
  eocd.writeUInt32LE(opt.zip64 ? 0xffffffff : cd.length, 12); eocd.writeUInt32LE(opt.zip64 ? 0xffffffff : off, 16);
  return new Uint8Array(Buffer.concat(parts.concat([cd], tail, [eocd])));
}
function brief(r) { return r.items.map((x) => [x.t, x.v.join("/")]); }

test("Withings weight.csv: kg → grams, body composition counted, duplicates and nonsense dropped", () => {
  const r = I.parseText(fx("weight.csv"), "weight.csv");
  assert.equal(r.source, "withings");
  assert.deepEqual(brief(r), [["wt", "80400"], ["wt", "80100"]]);
  assert.equal(r.items[0].at, local(2026, 3, 1, 7, 12) + 33000);
  assert.equal(r.items[1].n, "after run <b>");            // text only; health.js shows it with textContent
  assert.equal(r.skip.comp, 1);
  assert.equal(r.skip.dup, 1);
  assert.equal(r.skip.bad, 1);                             // 900 kg
});

test("Withings weight in lb, bp.csv with heart rate as pulse", () => {
  const w = I.parseText(fx("weight-lb.csv"), "weight.csv");
  assert.deepEqual(brief(w), [["wt", "80014"]]);
  assert.equal(w.conv.lb, 1);
  const b = I.parseText(fx("bp.csv"), "bp.csv");
  assert.equal(b.source, "withings");
  assert.deepEqual(brief(b), [["bp", "128/82/72"], ["bp", "121/79/0"]]);
  assert.equal(b.items[1].n, "evening");
  assert.equal(b.skip.bad, 1);                             // diastolic above systolic
});

test("OMRON connect: D/M/Y vs M/D/Y from the dates, AM/PM, flags, notes", () => {
  const a = I.parseText(fx("omron-dmy.csv"), "omron.csv");
  assert.equal(a.source, "omron");
  assert.deepEqual(brief(a), [["bp", "128/80/0"], ["bp", "135/85/68"], ["bp", "142/91/75"]]);
  assert.equal(a.items[1].at, local(2026, 10, 15, 7, 45));
  assert.equal(a.items[2].at, local(2026, 10, 16, 19, 50));
  assert.deepEqual(a.items[2].fl, ["ihb"]);
  assert.deepEqual(a.items[0].fl, ["mv"]);
  assert.equal(a.items[2].n, "stressed, coffee");
  const b = I.parseText(fx("omron-mdy.csv"), "omron.csv");
  assert.equal(b.items[0].at, local(2026, 10, 15, 7, 45));
  assert.deepEqual(b.items[0].fl, []);
});

test("Samsung Health single CSVs: metadata line, prefixed columns, UTC, mmol/L, daily low heart rate", () => {
  const w = I.parseText(fx("com.samsung.health.weight.20261001120000.csv"), "com.samsung.health.weight.20261001120000.csv");
  assert.equal(w.source, "samsung");
  assert.deepEqual(brief(w), [["wt", "72500"], ["wt", "72300"]]);
  assert.equal(w.items[0].at, Date.UTC(2026, 4, 1, 5, 30));
  assert.equal(w.skip.comp, 1);
  const b = I.parseText(fx("com.samsung.shealth.blood_pressure.20261001120000.csv"), "x.csv");
  assert.deepEqual(brief(b), [["bp", "118/76/64"]]);
  const g = I.parseText(fx("com.samsung.health.blood_glucose.20261001120000.csv"), "x.csv");
  assert.deepEqual(brief(g), [["gl", "991"]]);              // 5.5 mmol/L = 99.1 mg/dL
  assert.equal(g.conv.mmol, 1);
  const h = I.parseText(fx("com.samsung.shealth.tracker.heart_rate.20261001120000.csv"), "x.csv");
  assert.equal(h.skip.hrs, 4);
  assert.equal(h.hrDays, 2);
  assert.ok(h.items.every((x) => x.t === "hr"));
  assert.deepEqual(h.items.map((x) => x.v[0]).sort(), [58, 61]);
});

test("Apple export.xml text: types, units, BP pairs, resting HR wins over samples, height skipped", () => {
  const r = I.parseText(fx("export.xml"), "export.xml");
  assert.equal(r.source, "apple");
  assert.deepEqual(brief(r), [["wt", "74979"], ["wt", "75000"], ["hr", "57"], ["bp", "131/81/0"],
    ["gl", "973"], ["gl", "1320"], ["o2", "97"], ["tp", "3750"]]);
  assert.equal(r.items[3].at, Date.UTC(2026, 5, 3, 5, 0));   // +0300 honoured
  assert.equal(r.skip.height, 1);
  assert.equal(r.skip.half, 1);                              // lone systolic
  assert.equal(r.skip.hrs, 2);                               // samples not used: a resting value exists
  assert.equal(r.skip.dup, 1);
  assert.ok(r.conv.lb && r.conv.mmol && r.conv.f && r.conv.frac);
});

test("Apple: bare export.xml streamed in chunks (tags cut across chunk edges)", async () => {
  const filler = '<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-01-01 10:00:00 +0000" value="12"/>\n';
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="el_GR">\n';
  for (let i = 0; i < 400; i++) {
    xml += filler.repeat(37);
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    xml += '<Record type="HKQuantityTypeIdentifierBloodPressureSystolic" sourceName="Ω" unit="mmHg" startDate="' + d + ' 08:00:00 +0200" value="' + (120 + i % 9) + '"/>\n';
    xml += '<Record type="HKQuantityTypeIdentifierBloodPressureDiastolic" sourceName="Ω" unit="mmHg" startDate="' + d + ' 08:00:00 +0200" value="80"/>\n';
    xml += '<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="W" unit="count/min" startDate="' + d + ' 0' + (i % 2 ? 3 : 9) + ':00:00 +0200" value="' + (50 + i % 30) + '"/>\n';
  }
  xml += "</HealthData>\n";
  assert.ok(xml.length > 2 * 1024 * 1024);
  let progress = 0;
  const r = await I.readBlob(new Blob([xml]), "export.xml", (p) => { progress = p; });
  assert.equal(r.source, "apple");
  assert.equal(r.items.filter((x) => x.t === "bp").length, 400);
  assert.equal(r.items.filter((x) => x.t === "hr").length, r.hrDays);   // no resting values → daily lows
  assert.ok(r.hrDays >= 200 && r.hrDays <= 401);           // local days (time zone dependent)
  assert.equal(r.skip.hrs, 400);
  assert.ok(progress > 0);
});

test("Apple export.zip: deflated entry streamed, export_cda.xml ignored; ZIP64 records understood", async () => {
  const files = [["apple_health_export/export_cda.xml", "<?xml version=\"1.0\"?><ClinicalDocument/>"],
                 ["apple_health_export/export.xml", fx("export.xml")],
                 ["apple_health_export/workout-routes/route_1.gpx", "<gpx/>"]];
  const r = await I.readBytes(makeZip(files), "export.zip");
  assert.equal(r.source, "apple");
  assert.equal(r.items.length, 8);
  const z = await I.readBytes(makeZip(files, { zip64: true }), "export.zip");
  assert.equal(z.source, "apple");
  assert.equal(z.items.length, 8);
});

test("Withings and Samsung ZIPs: the right CSVs, other files ignored", async () => {
  const w = await I.readBytes(makeZip([["weight.csv", fx("weight.csv")], ["bp.csv", fx("bp.csv")],
    ["raw_tracker_steps.csv", "start,duration,value\n"], ["activities.csv", "Date,Steps\n2026-01-01,100\n"]], { store: true }), "data_DOE.zip");
  assert.equal(w.source, "withings");
  assert.equal(w.items.filter((x) => x.t === "wt").length, 2);
  assert.equal(w.items.filter((x) => x.t === "bp").length, 2);
  const dir = "samsunghealth_doe_20261001120000/";
  const s = await I.readBytes(makeZip([
    [dir + "com.samsung.health.weight.20261001120000.csv", fx("com.samsung.health.weight.20261001120000.csv")],
    [dir + "com.samsung.shealth.blood_pressure.20261001120000.csv", fx("com.samsung.shealth.blood_pressure.20261001120000.csv")],
    [dir + "com.samsung.shealth.tracker.heart_rate.20261001120000.csv", fx("com.samsung.shealth.tracker.heart_rate.20261001120000.csv")],
    [dir + "com.samsung.shealth.exercise.20261001120000.csv", "com.samsung.shealth.exercise,1,1\nstart_time,duration\n"],
    [dir + "jsons/com.samsung.health.weight/x.json", "{}"]]), "samsung.zip");
  assert.equal(s.source, "samsung");
  assert.deepEqual(s.items.map((x) => x.t).sort(), ["bp", "hr", "hr", "wt", "wt"]);
});

test("unknown or empty files are refused", async () => {
  assert.equal(I.parseText("a,b\n1,2\n", "x.csv").error, "bad");
  assert.equal(I.parseText("<?xml version=\"1.0\"?><foo/>", "x.xml").error, "bad");
  assert.equal((await I.readBytes(new Uint8Array(0), "x.csv")).error, "empty");
  assert.equal((await I.readBytes(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]), "x.zip")).error, "bad");
  assert.equal(I.parseText("Date,Weight (kg)\n2026-01-01,\n", "weight.csv").error, "empty");
});

test("plan: stable ids, valid entries, nothing twice, the person's own reading counts as there", () => {
  const r = I.parseText(fx("export.xml"), "export.xml");
  const data = C.emptyData();
  // the person typed the 2 June weight themselves (same minute, same value)
  data.en.push(C.normEntry({ id: "own1", m: 1, t: "wt", at: Date.UTC(2026, 5, 2, 4, 0, 20), v: [75000] }));
  const p = I.plan(r, data);
  assert.equal(p.add.length, 7);
  assert.equal(p.have, 1);
  assert.deepEqual(p.per.wt, { n: 2, add: 1 });
  assert.equal(p.from, r.items[0].at);
  p.add.forEach((e) => {
    assert.match(e.id, /^imp-[a-z0-9]+$/);
    assert.ok(e.id.length <= 40);
    assert.deepEqual(e.g, ["Apple Health"]);
    const n = C.normEntry(Object.assign({}, e, { m: 5 }));
    assert.ok(n, e.t);
    assert.deepEqual(n.v, e.v);
  });
  // same file again → same ids
  const again = I.plan(I.parseText(fx("export.xml"), "export.xml"), data);
  assert.deepEqual(again.add.map((e) => e.id), p.add.map((e) => e.id));
  // after the import, nothing is left to add
  p.add.forEach((e) => data.en.push(C.normEntry(Object.assign({}, e, { m: 5 }))));
  const third = I.plan(r, data);
  assert.equal(third.add.length, 0);
  assert.equal(third.have, 8);
});

test("plan: a cap keeps the most recent readings", () => {
  const r = I.parseText(fx("export.xml"), "export.xml");
  const p = I.plan(r, C.emptyData(), 3);
  assert.equal(p.cut, 5);
  assert.deepEqual(p.add.map((e) => e.t), ["gl", "o2", "tp"]);
  assert.equal(p.per.wt.add, 0);
  assert.equal(p.per.gl.add, 1);
});
