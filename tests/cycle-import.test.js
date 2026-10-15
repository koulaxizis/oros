// Cycle "Import from another app" (cycle/import.js): drip. CSV, Clue
// (.cluedata, old { data } shape), Flo GDPR JSON, generic CSV (one row
// per period or per bleeding day), ZIP, caps, and the plan against
// existing data (overlaps skipped, the person's values win, stable
// ids so a second import adds nothing).
// Fixtures: tests/fixtures/cycle/
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const I = require(path.join(__dirname, "..", "cycle/import.js"));
const Z = require(path.join(__dirname, "..", "atelier/zip.js"));
const FX = path.join(__dirname, "fixtures", "cycle");
const fx = (n) => fs.readFileSync(path.join(FX, n), "utf8");
const TODAY = "2026-10-15";
function ms(k) { const p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).getTime(); }

test("drip.: bleeding → flow + periods, temperature, mucus, notes, excludes", () => {
  const r = I.parseText(fx("drip.csv"), "drip.csv");
  assert.equal(r.source, "drip");
  // 06-07 is spotting (0); 07-04 joins 07-02 (one day between); 07-05 excluded
  assert.deepEqual(r.periods, [
    { s: "2026-06-03", e: "2026-06-06" },
    { s: "2026-07-01", e: "2026-07-04" },
    { s: "2026-07-29", e: "2026-07-31" }
  ]);
  assert.equal(r.days["2026-06-04"].fl, 3);
  assert.equal(r.days["2026-06-06"].fl, 1);
  assert.equal(r.days["2026-06-07"], undefined);           // spotting only → nothing
  assert.equal(r.days["2026-06-03"].bbt, 3645);
  assert.equal(r.days["2026-06-12"].bbt, undefined);       // excluded temperature
  assert.equal(r.days["2026-06-12"].cm, 1);                // t (dry)
  assert.equal(r.days["2026-06-14"].cm, 2);                // f
  assert.equal(r.days["2026-06-16"].cm, 4);                // S+
  assert.equal(r.days["2026-06-18"].cm, 1);                // Ø → dry
  assert.equal(r.days["2026-06-04"].note, "Cramps, stayed home <b>");   // plain text, shown with textContent
  assert.equal(r.days["2026-07-05"], undefined);
});

test("Clue .cluedata: period values → flow, spotting ignored, discharge, bbt", () => {
  const r = I.parseText(fx("clue.cluedata"), "x.cluedata");
  assert.equal(r.source, "clue");
  assert.deepEqual(r.periods, [{ s: "2026-05-02", e: "2026-05-04" }, { s: "2026-05-30", e: "2026-06-02" }]);
  assert.equal(r.days["2026-05-03"].fl, 3);
  assert.equal(r.days["2026-05-04"].fl, 1);
  assert.equal(r.days["2026-05-05"], undefined);
  assert.equal(r.days["2026-05-15"].cm, 4);
  assert.equal(r.days["2026-06-02"].bbt, 3660);
  assert.equal(r.days["2026-06-10"], undefined);
});

test("Clue old { data: [{ type, value }] } shape, °F temperature", () => {
  const r = I.parseText(fx("clue-old.json"), "clue.json");
  assert.equal(r.source, "clue");
  assert.deepEqual(r.periods, [{ s: "2025-11-01", e: "2025-11-03" }, { s: "2025-11-28", e: "2025-11-29" }]);
  assert.equal(r.days["2025-11-01"].fl, 3);
  assert.equal(r.days["2025-11-10"].bbt, 3650);
});

test("Flo GDPR JSON: cycles + Period day events, predictions skipped", () => {
  const r = I.parseText(fx("flo.json"), "flo.json");
  assert.equal(r.source, "flo");
  assert.deepEqual(r.periods, [
    { s: "2026-03-01", e: "2026-03-05" },
    { s: "2026-03-30", e: "2026-04-03" },
    { s: "2026-04-27", e: "2026-05-01" },
    { s: "2026-05-24", e: "2026-05-25" }                    // from the day events only
  ]);
  assert.equal(r.days["2026-03-02"].fl, 3);
  assert.equal(r.days["2026-03-05"].fl, 1);
  assert.equal(r.days["2026-03-03"], undefined);            // a Mood event
});

test("generic CSV: one row per period (D/M/Y sniffed, ; delimiter, open end)", () => {
  const r = I.parseText(fx("periods.csv"), "p.csv");
  assert.equal(r.source, "csv");
  assert.deepEqual(r.periods, [
    { s: "2026-01-05", e: "2026-01-09" },
    { s: "2026-02-02", e: null },
    { s: "2026-02-28", e: "2026-03-03" }
  ]);
  const pl = I.plan(r, { periods: [], days: [] }, { today: TODAY });
  assert.equal(pl.guessed, 1);
  assert.equal(pl.avg, 5);
  const feb = pl.add.find((p) => p.id === "imp20260202");
  assert.equal(feb.end, ms("2026-02-06"));                   // the file's average length
});

test("generic CSV: one row per bleeding day, with or without flow", () => {
  const r = I.parseText(fx("days.csv"), "d.csv");
  assert.deepEqual(r.periods, [{ s: "2026-08-01", e: "2026-08-04" }]);
  assert.equal(r.days["2026-08-01"].fl, 3);
  assert.equal(r.days["2026-08-01"].note, "first day");
  assert.equal(r.days["2026-08-20"], undefined);            // spotting
  const b = I.parseText(fx("bleeding-days.csv"), "b.csv");
  assert.deepEqual(b.periods, [{ s: "2026-09-01", e: "2026-09-03" }]);
  assert.equal(b.days["2026-09-01"], undefined);             // amount unknown: no day fields
});

test("bad and empty files are refused, never throw", () => {
  assert.equal(I.parseText("", "x").error, "empty");
  assert.equal(I.parseText("{not json", "x").error, "bad");
  assert.equal(I.parseText('{"hello":"world"}', "x").error, "bad");
  assert.equal(I.parseText("name,amount\nA,1\n", "x").error, "bad");
  assert.equal(I.parseText("date,flow\nnot a date,heavy\n", "x").error, "empty");
  assert.equal(I.parseText("x".repeat(26 * 1024 * 1024), "x").error, "big");
});

test("deeply nested JSON is capped, not a stack overflow", () => {
  let s = "";
  for (let i = 0; i < 5000; i++) s += '{"a":';
  s += "1" + "}".repeat(5000);
  const r = I.parseText(s, "x.json");
  assert.ok(r.error);
});

test("plan: overlaps skipped, existing periods untouched, the person's day values win", () => {
  const r = I.parseText(fx("drip.csv"), "drip.csv");
  const cur = {
    periods: [{ id: "abc", start: ms("2026-07-02"), end: ms("2026-07-03"), flow: 2 }],
    days: [
      { id: "d-2026-06-04", day: ms("2026-06-04"), fl: 1, note: "mine", fm: { sym: 1, meds: 0, note: 5, fl: 5 } },
      { id: "d-2026-06-14", day: ms("2026-06-14"), note: "", fm: { sym: 0, meds: 0, note: 0, cm: 9 } }   // cm cleared by the person
    ]
  };
  const pl = I.plan(r, cur, { today: TODAY });
  assert.equal(pl.overlap, 1);
  assert.deepEqual(pl.add.map((p) => p.id), ["imp20260603", "imp20260729"]);
  assert.equal(pl.add[0].start, ms("2026-06-03"));
  assert.equal(pl.add[0].end, ms("2026-06-06"));
  assert.equal(pl.add[0].flow, 2);                         // 2,3,2,1 → most frequent
  const f = (k) => pl.fills.find((x) => x.key === k);
  assert.equal(f("2026-06-04").set.fl, undefined);          // the person's flow wins
  assert.equal(f("2026-06-04").set.note, undefined);        // and their note
  assert.equal(f("2026-06-04").set.bbt, 3640);
  assert.equal(f("2026-06-04").isNew, false);
  assert.equal(f("2026-06-14").set.cm, undefined);          // a clear is a choice too
  assert.equal(f("2026-07-02").set.fl, 3);                  // inside the existing period
  assert.equal(pl.stats.from, "2026-06-03");
  assert.equal(pl.stats.to, "2026-07-31");
});

test("plan: flow outside any period is not written; future dates dropped", () => {
  const r = { source: "csv", periods: [{ s: "2026-10-20", e: "2026-10-24" }],
              days: { "2026-01-01": { fl: 2 }, "2026-10-21": { fl: 3, bbt: 3650 } } };
  const pl = I.plan(r, { periods: [], days: [] }, { today: TODAY });
  assert.equal(pl.add.length, 0);
  assert.equal(pl.fills.length, 0);
});

test("plan: a recent open period stays ongoing; an older one gets an end", () => {
  const r = { source: "csv", periods: [{ s: "2026-10-13", e: null }], days: {} };
  const pl = I.plan(r, { periods: [], days: [] }, { today: TODAY });
  assert.equal(pl.add[0].end, null);
  assert.equal(pl.guessed, 0);
  const pl2 = I.plan(r, { periods: [{ id: "x", start: ms("2026-10-14"), end: null }], days: [] }, { today: TODAY });
  assert.equal(pl2.add[0].end, ms("2026-10-13"));            // ends before the next start
});

test("re-import adds nothing (stable ids, same dates)", () => {
  const r = I.parseText(fx("flo.json"), "flo.json");
  const pl = I.plan(r, { periods: [], days: [] }, { today: TODAY });
  assert.equal(pl.add.length, 4);
  const cur = {
    periods: pl.add.map((p) => ({ id: p.id, start: p.start, end: p.end, flow: p.flow })),
    days: pl.fills.map((x) => Object.assign({ id: x.id, day: x.day, note: x.set.note || "",
      fm: { sym: 0, meds: 0, note: x.set.note ? 1 : 0, fl: 1 } }, x.set))
  };
  const again = I.plan(r, cur, { today: TODAY });
  assert.equal(again.add.length, 0);
  assert.equal(again.fills.length, 0);
  assert.equal(again.overlap, 4);
});

test("ZIP: .cluedata inside a ZIP is read", async () => {
  const zip = Z.write([{ name: "ClueBackup/export.cluedata", data: new TextEncoder().encode(fx("clue.cluedata")) },
                       { name: "readme.txt", data: new TextEncoder().encode("hi") }]);
  const r = await I.readBytes(zip, "clue.zip");
  assert.equal(r.source, "clue");
  assert.equal(r.periods.length, 2);
  const bad = await I.readBytes(Z.write([{ name: "a.txt", data: new TextEncoder().encode("x") }]), "a.zip");
  assert.equal(bad.error, "bad");
});

test("plain bytes with a BOM; values helpers", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf].concat(Array.from(new TextEncoder().encode(fx("days.csv")))));
  const r = await I.readBytes(bytes, "d.csv");
  assert.equal(r.source, "csv");
  assert.equal(I.flowOf("Heavy"), 3);
  assert.equal(I.flowOf("έντονη"), 3);
  assert.equal(I.flowOf("spotting"), 0);
  assert.equal(I.cmOf("egg_white"), 4);
  assert.equal(I.cmOf("sticky"), 3);
  assert.equal(I.bbtOf("36,7"), 3670);
  assert.equal(I.bbtOf("45"), undefined);
});
