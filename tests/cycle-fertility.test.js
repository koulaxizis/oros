// Cycle wave 34 (cycle/core.js): flow per day with the old
// whole-period flow as the fallback, BBT parsing, the symptothermal
// fertile-window estimate (3-over-6 temperature rule, mucus peak,
// first-5-days and minus-8 rules) and the per-field sync helpers of
// the new day fields.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const CC = require(path.join(__dirname, "..", "cycle/core.js"));

function key(n) {                 // 2026-09-01 + n days
  const d = new Date(Date.UTC(2026, 8, 1 + n));
  return d.toISOString().slice(0, 10);
}
// one cycle starting 2026-09-01: low phase ~36.40, rise on cycle day 15
function cycleTemps(riseDay, third) {
  const obs = [];
  for (let i = 0; i < 24; i++) {
    let t = 3640 + (i % 3) * 3;                 // 36.40 / 36.43 / 36.46
    if (i + 1 >= riseDay) t = 3670;             // higher (+0.24)
    if (third !== undefined && i + 1 === riseDay + 2) t = third;
    obs.push({ k: key(i), bbt: t });
  }
  return obs;
}

test("parseBbt: comma or dot, °F converted, out of range refused", () => {
  assert.equal(CC.parseBbt("36,45"), 3645);
  assert.equal(CC.parseBbt("36.4"), 3640);
  assert.equal(CC.parseBbt(" 37.05 "), 3705);
  assert.equal(CC.parseBbt("97.7"), 3650);         // °F
  assert.equal(CC.parseBbt("33.9"), null);
  assert.equal(CC.parseBbt("45"), null);
  assert.equal(CC.parseBbt("abc"), null);
  assert.equal(CC.parseBbt(""), null);
  assert.equal(CC.parseBbt(null), null);
});

test("flow per day: own flow first, else the period's (old data unchanged)", () => {
  const p = { start: 1000, end: 5000, flow: 3 };
  assert.equal(CC.dayFlow({ fl: 1 }, p), 1);
  assert.equal(CC.dayFlow({}, p), 3);                // old data: the period's flow
  assert.equal(CC.dayFlow(null, p), 3);
  assert.equal(CC.dayFlow({ fl: 9 }, p), 3);
  assert.equal(CC.dayFlow({ fl: 2 }, null), 2);
  assert.equal(CC.dayFlow({}, null), 0);
  // bar colour: the most frequent day flow, tie → heavier; none → period's
  assert.equal(CC.periodFlow(p, []), 3);
  assert.equal(CC.periodFlow({ start: 0, end: 10, flow: 7 }, []), 2);
  const days = [{ day: 1000, fl: 3 }, { day: 2000, fl: 1 }, { day: 3000, fl: 1 }, { day: 9000, fl: 3 }];
  assert.equal(CC.periodFlow(p, days), 1);
  assert.equal(CC.periodFlow(p, [{ day: 1000, fl: 1 }, { day: 2000, fl: 2 }]), 2);
  assert.equal(CC.periodFlow({ start: 1000, end: null, flow: 2 }, [{ day: 9e9, fl: 1 }]), 1);   // ongoing
});

test("3-over-6: rise confirmed on the 3rd high when it is 0.20 °C over the coverline", () => {
  const obs = cycleTemps(15);
  const s = CC.tempShift(obs);
  assert.equal(s.first, key(14));
  assert.equal(s.cover, 3646);
  assert.equal(s.confirm, key(16));
});

test("3-over-6: a 3rd high under +0.20 needs a 4th higher reading", () => {
  const obs = cycleTemps(15, 3655);                  // only +0.09 over 36.46
  const s = CC.tempShift(obs);
  assert.equal(s.first, key(14));
  assert.equal(s.confirm, key(17));
  // with the 4th missing: not confirmed
  const cut = obs.filter((o) => o.k !== key(17));
  assert.equal(CC.tempShift(cut.slice(0, 17)), null);
});

test("3-over-6: highs must be on consecutive days; fewer than 6 lows → nothing", () => {
  const obs = cycleTemps(15).filter((o) => o.k !== key(15));   // a gap inside the 3 highs
  const s = CC.tempShift(obs);
  assert.notEqual(s && s.first, key(14));
  assert.equal(CC.tempShift(cycleTemps(15).slice(0, 8)), null);
  assert.equal(CC.tempShift([]), null);
  assert.equal(CC.tempShift([{ k: "bad", bbt: 3600 }, { k: key(1), bbt: 99 }]), null);
});

test("mucus peak: last best day before it drops, confirmed 3 days later", () => {
  const obs = [
    { k: key(7), cm: 2 }, { k: key(8), cm: 3 }, { k: key(9), cm: 4 }, { k: key(10), cm: 4 },
    { k: key(11), cm: 3 }, { k: key(12), cm: 1 }, { k: key(13), cm: 1 }
  ];
  const pk = CC.mucusPeak(obs, key(13));
  assert.equal(pk.peak, key(10));
  assert.equal(pk.confirm, key(13));
  assert.equal(CC.mucusPeak(obs, key(12)).confirm, null);          // not yet 3 days
  // quality back within 3 days and no drop after it yet → no peak yet
  const back = obs.slice(0, 5).concat([{ k: key(12), cm: 4 }]);
  assert.equal(CC.mucusPeak(back, key(14)), null);
  // a second, later peak wins
  const twice = obs.concat([{ k: key(14), cm: 4 }, { k: key(15), cm: 1 }]).filter((o) => o.k !== key(13));
  assert.equal(CC.mucusPeak(twice, key(20)).peak, key(14));
  assert.equal(CC.mucusPeak([{ k: key(3), cm: 2 }, { k: key(4), cm: 1 }], key(9)), null);   // no creamy / egg white
});

test("fertile window: double check (later of temperature and mucus), rules for the start", () => {
  const temps = cycleTemps(15);
  const mucus = { 8: 2, 9: 3, 10: 4, 11: 4, 12: 4, 13: 3, 14: 1, 15: 1, 16: 1, 17: 1 };
  const obs = temps.map((o, i) => (mucus[i] ? Object.assign({}, o, { cm: mucus[i] }) : o));
  const f = CC.fertility(key(0), obs, [], key(23));
  assert.equal(f.method, "st");
  assert.equal(f.start, key(5));                     // cycle day 6 (first-5-days rule)…
  assert.equal(f.startRule, "5");
  assert.equal(f.peak, key(12));
  assert.equal(f.peakConfirm, key(15));
  assert.equal(f.tempConfirm, key(16));
  assert.equal(f.end, key(16));                      // the later of the two
  assert.equal(f.shiftDay, 15);
  // mucus felt earlier than day 6 opens the window earlier
  const early = obs.map((o, i) => (i === 3 ? Object.assign({}, o, { cm: 2 }) : o));
  const g = CC.fertility(key(0), early, [], key(23));
  assert.equal(g.start, key(3));
  assert.equal(g.startRule, "cm");
  // minus-8 with 12 earlier cycles: earliest rise day 13 → day 5
  const h = CC.fertility(key(0), temps, [15, 14, 16, 13, 15, 15, 14, 16, 15, 14, 15, 17], key(23));
  assert.equal(h.start, key(4));
  assert.equal(h.startRule, "m8");
  assert.equal(h.method, "t");
  assert.equal(h.end, key(16));                      // temperature only
});

test("fertile window: open while not confirmed; nothing logged; bad start", () => {
  const temps = cycleTemps(15).slice(0, 15);         // rise not yet confirmed
  const f = CC.fertility(key(0), temps, [], key(14));
  assert.equal(f.end, null);
  assert.equal(f.shift, null);
  // temperature confirmed but the mucus peak is still pending → open
  const obs = cycleTemps(15).map((o, i) => (i === 20 ? Object.assign({}, o, { cm: 4 }) : (i === 21 ? Object.assign({}, o, { cm: 1 }) : o)));
  assert.equal(CC.fertility(key(0), obs, [], key(22)).end, null);
  const none = CC.fertility(key(0), [], [], key(3));
  assert.equal(none.method, "");
  assert.equal(none.end, null);
  assert.equal(CC.fertility("nope", [], [], key(3)), null);
});

test("day sync helpers: each new field by its own stamp, clears win, old days untouched", () => {
  // x set flow at 200, y set bbt at 300 (both field-stamped days)
  const x = { mtime: 200, fl: 3, fm: { sym: 100, meds: 0, note: 0, fl: 200 } };
  const y = { mtime: 300, bbt: 3650, fm: { sym: 100, meds: 0, note: 0, bbt: 300 } };
  const ab = CC.mergeExtras(x, true, y, true), ba = CC.mergeExtras(y, true, x, true);
  assert.deepEqual(ab, ba);
  assert.equal(ab.fl.v, 3);
  assert.equal(ab.bbt.v, 3650);
  assert.equal(ab.cm.v, undefined);
  assert.equal(ab.cm.s, 0);
  // a clear (stamp, no value) newer than the value wins
  const cleared = { mtime: 400, fm: { sym: 0, meds: 0, note: 0, fl: 400 } };
  assert.equal(CC.mergeExtras(x, true, cleared, true).fl.v, undefined);
  assert.equal(CC.mergeExtras(x, true, cleared, true).fl.s, 400);
  // a whole-day (old build) day speaks with its mtime
  const old = { mtime: 500, fl: 1 };
  assert.equal(CC.mergeExtras(x, true, old, false).fl.v, 1);
  // a copy without the field and without its stamp never erases it
  const stripped = { mtime: 250, fm: { sym: 250, meds: 0, note: 0 } };
  assert.equal(CC.mergeExtras(x, true, stripped, true).fl.v, 3);
  // ownExtras / putExtras: nothing for a day that never had them
  const plain = { mtime: 10, fm: { sym: 10, meds: 0, note: 0 } };
  const o = { fm: {} };
  CC.putExtras(o, CC.ownExtras(plain, true));
  assert.deepEqual(o, { fm: {} });
  const o2 = { fm: {} };
  CC.putExtras(o2, CC.ownExtras({ mtime: 200, fl: 2, cm: 9, fm: { fl: 200 } }, true));
  assert.deepEqual(o2, { fl: 2, fm: { fl: 200 } });
  assert.equal(CC.extraMax({ sym: 900, fl: 20, bbt: 70 }), 70);
  assert.ok(CC.validExtra("bbt", 3650) && !CC.validExtra("bbt", 36.5) && !CC.validExtra("cm", 0));
});
