// Micro-Zen "Import sessions" (zen/import.js): Insight Timer sessions
// CSV (month-first or day-first dates told from the data, H:MM:SS
// durations, activities), a generic date + minutes CSV, the plan per
// day, and apply / revert against Zen's per-row, max-merged counters:
// a second import adds nothing, a longer export only grows the days,
// another device importing the same file counts nothing twice, and
// Undo (a newer epoch) brings every device back to the old totals.
// Fixtures are built inline from the documented export shapes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const I = require(path.join(__dirname, "..", "zen/import.js"));
const NOW = new Date(2026, 9, 15, 12, 0).getTime();

// zen.js's merge, as specified there: per row the newer epoch wins,
// equal epochs keep the larger of each counter; rows older than br go.
function mergeZen(a, b) {
  const br = Math.max(a.br || 0, b.br || 0), rows = {};
  [a.rows || {}, b.rows || {}].forEach((m) => Object.keys(m).forEach((id) => {
    const r = m[id];
    if (r.b < br) return;
    const cur = rows[id];
    if (!cur || r.b > cur.b) { rows[id] = JSON.parse(JSON.stringify(r)); return; }
    if (r.b < cur.b) return;
    Object.keys(r.d).forEach((k) => {
      const c = cur.d[k], x = r.d[k];
      cur.d[k] = c ? [Math.max(c[0], x[0]), Math.max(c[1], x[1]), Math.max(c[2], x[2])] : x.slice();
    });
  }));
  return { ver: 1, br, rows };
}
function totals(data) {
  const out = {};
  Object.values(data.rows).forEach((r) => Object.keys(r.d).forEach((k) => {
    const c = out[k] || (out[k] = [0, 0]);
    c[0] += r.d[k][0]; c[1] += r.d[k][1];
  }));
  Object.keys(out).forEach((k) => { if (!out[k][0] && !out[k][1]) delete out[k]; });
  return out;
}
function importInto(data, res, opts) {
  const pl = I.plan(res, data, Object.assign({ now: NOW }, opts));
  const a = I.apply(data, pl);
  return { data: mergeZen(data, { br: data.br, rows: a.rows }), a, pl };
}

const INSIGHT = [
  "Started At,Duration,Preset,Activity",
  "10/14/2026 07:12:33,0:10:00,Morning,Meditation",
  "10/14/2026 21:40:00,0:05:30,,Meditation",
  "10/13/2026 07:05:10,0:20:00,,Yoga",
  "10/02/2026 06:59:00,0:15:00,,Meditation",
  "10/02/2026 22:00:00,0:00:04,,Meditation",
  "12/01/2026 07:00:00,0:10:00,,Meditation"
].join("\n");

test("Insight Timer: sessions, M/D/Y from the data, activities, too-short skipped", () => {
  const r = I.parseText(INSIGHT, "insight.csv");
  assert.equal(r.source, "insight");
  assert.equal(r.sessions.length, 5);
  assert.equal(r.skip, 1);
  assert.equal(r.sessions[0].day, "2026-10-14");
  assert.equal(r.sessions[0].ts, new Date(2026, 9, 14, 7, 12, 33).getTime());
  assert.equal(r.sessions[1].sec, 330);
  assert.equal(r.sessions[3].day, "2026-10-02");       // not 10 February
  assert.deepEqual(r.acts, { Meditation: 4, Yoga: 1 });
});

test("Insight Timer: day-first dates when the data says so", () => {
  const r = I.parseText("Started At,Duration,Preset,Activity\n15/10/2026 07:00:00,0:10:00,,Meditation\n02/10/2026 07:00:00,0:10:00,,Meditation\n", "x.csv");
  assert.deepEqual(r.sessions.map((s) => s.day), ["2026-10-15", "2026-10-02"]);
});

test("plan: per day totals, future days left out, activities filtered", () => {
  const r = I.parseText(INSIGHT, "insight.csv");
  const empty = { ver: 1, br: 0, rows: {} };
  let pl = I.plan(r, empty, { now: NOW });
  assert.equal(pl.future, 1);
  assert.deepEqual(pl.days.map((d) => [d.id, d.day, d.cell]), [
    ["impi202610", "2026-10-02", [1, 900]],
    ["impi202610", "2026-10-13", [1, 1200]],
    ["impi202610", "2026-10-14", [2, 930]]
  ]);
  assert.equal(pl.sessions, 4);
  pl = I.plan(r, empty, { now: NOW, acts: { Yoga: false } });
  assert.equal(pl.days.length, 2);
  assert.equal(pl.sec, 1830);
  assert.ok(I.rowId("insight", "2026-10-02").match(/^[a-z0-9]{6,32}$/));
});

test("apply: own rows only, max-merged; a second import adds nothing; Undo is sync-safe", () => {
  const r = I.parseText(INSIGHT, "insight.csv");
  const mine = { ver: 1, br: 0, rows: { dev0000001: { b: 0, d: { "2026-10-14": [1, 60, 6] } } } };
  const before = totals(mine);
  const first = importInto(mine, r);
  assert.deepEqual(first.data.rows.dev0000001, mine.rows.dev0000001);       // the person's own row untouched
  assert.deepEqual(totals(first.data)["2026-10-14"], [3, 990]);
  assert.equal(first.a.sessions, 4);
  // again: nothing new
  const again = I.plan(r, first.data, { now: NOW });
  assert.equal(again.add, 0);
  assert.equal(again.dup, 3);
  assert.deepEqual(I.apply(first.data, again).rows, {});
  // a second device imports the same file on its own: no double count
  const other = importInto({ ver: 1, br: 0, rows: {} }, r).data;
  assert.deepEqual(totals(mergeZen(first.data, other)), totals(first.data));
  // Undo on the first device, then both devices merge: totals as before
  const rv = I.revert(first.data, first.a.undo, NOW + 5);
  assert.ok(rv.impi202610.b > first.data.rows.impi202610.b);
  const undone = mergeZen(first.data, { br: 0, rows: rv });
  assert.deepEqual(totals(undone), before);
  assert.deepEqual(totals(mergeZen(undone, other)), before);
  assert.deepEqual(totals(mergeZen(other, undone)), before);
  // and importing again after Undo brings it back
  const back = importInto(undone, r);
  assert.deepEqual(totals(back.data), totals(first.data));
});

test("a longer export only grows the days; the person's reset (br) drops old imports", () => {
  const short = I.parseText("Started At,Duration,Preset,Activity\n10/14/2026 07:12:33,0:10:00,,Meditation\n", "a.csv");
  const long = I.parseText(INSIGHT, "b.csv");
  const one = importInto({ ver: 1, br: 0, rows: {} }, short).data;
  const two = importInto(one, long);
  assert.deepEqual(totals(two.data)["2026-10-14"], [2, 930]);
  assert.equal(two.a.undo.find((u) => u.day === "2026-10-14").before[0], 1);
  const reset = mergeZen(two.data, { br: NOW, rows: {} });
  assert.deepEqual(totals(reset), {});
  const pl = I.plan(long, reset, { now: NOW });
  const rows = I.apply(reset, pl).rows;
  assert.equal(rows.impi202610.b, NOW);                 // a new row lives in the new epoch
});

test("generic CSV: date + minutes, seconds, date and time columns", () => {
  let r = I.parseText("date,minutes\n2026-10-01,12\n2026-10-03,5.5\n2026-10-04,abc\n", "log.csv");
  assert.equal(r.source, "csv");
  assert.deepEqual(r.sessions.map((s) => [s.day, s.sec]), [["2026-10-01", 720], ["2026-10-03", 330]]);
  assert.equal(r.skip, 1);
  assert.equal(I.rowId(r.source, "2026-10-01"), "impc202610");
  r = I.parseText("Date;Time;Seconds\n03.10.2026;21:30;600\n", "x.csv");
  assert.equal(r.sessions[0].sec, 600);
  assert.equal(r.sessions[0].ts, new Date(2026, 9, 3, 21, 30).getTime());
  r = I.parseText("day,duration\n2026-10-05,1h 5m\n2026-10-06,10:30\n", "x.csv");
  assert.deepEqual(r.sessions.map((s) => s.sec), [3900, 630]);
});

test("errors and caps", async () => {
  assert.deepEqual(I.parseText("", "x.csv"), { error: "empty" });
  assert.deepEqual(I.parseText("name,colour\nx,y\n", "x.csv"), { error: "bad" });
  assert.deepEqual(I.parseText("date,minutes\n2026-10-01,0\n", "x.csv"), { error: "empty" });
  assert.deepEqual(I.parseText("date,minutes\n2026-10-01,900\n", "x.csv"), { error: "empty" });   // 15 h: not a session
  assert.deepEqual(await I.readBytes(new Uint8Array(I.MAX_FILE + 1), "x.csv"), { error: "big" });
  const r = I.parseText("Started At,Duration,Preset,Activity\n10/14/2026 07:12:33,0:10:00,,<b>" + "x".repeat(200) + "\n", "x.csv");
  assert.ok(r.sessions[0].act.length <= 40);
});
