// Baby wave 34 (baby/core.js): pump sessions with a duration (kept as
// the event's end, which older builds already keep) and the milk stash
// (bags: amount, day pumped, fridge / freezer, use-by, use oldest first),
// including its sync and that a slice without bags keeps its bytes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "baby/core.js"));

const KID = "kid0001";
function base() {
  return C.normalize({ kids: [{ id: KID, n: "Ada", b: "2026-06-01", m: 1 }], ev: [] });
}
function bag(id, extra) {
  return Object.assign({ id, m: 10, ml: 120, d: "2026-10-10", w: "f", u: "2026-10-14" }, extra || {});
}

test("pump: side, amount and duration (end − start) survive normalize", () => {
  const ts = new Date(2026, 9, 14, 9, 0).getTime();
  const e = C.normEv({ id: "pump0001", k: KID, t: "pump", ts, e: ts + 25 * 60000, ml: 140, sd: "l", m: 5 });
  assert.equal(e.e - e.ts, 25 * 60000);
  assert.equal(e.sd, "l");
  const noLen = C.normEv({ id: "pump0002", k: KID, t: "pump", ts, ml: 90, m: 5 });
  assert.equal(noLen.e, undefined);
  assert.equal(noLen.sd, "b");
  assert.deepEqual(C.LIM.pumpMin, [1, 180]);
  const csv = C.toCsv(C.normalize({ kids: [{ id: KID, n: "Ada", b: "2026-06-01", m: 1 }], ev: [e] }));
  assert.ok(/,pump,.*,25,/.test(csv));
});

test("use-by: fridge 4 days, freezer 6 months (month end clamped)", () => {
  assert.equal(C.useBy("2026-10-10", "f"), "2026-10-14");
  assert.equal(C.useBy("2026-10-10", "z"), "2027-04-10");
  assert.equal(C.useBy("2026-08-31", "z"), "2027-02-28");
  assert.equal(C.addMonths("2027-12-31", 2), "2028-02-29");
});

test("normSt: strict, used / thrown-away state, tombstones", () => {
  assert.equal(C.normSt(bag("bag00001", { w: "x" })), null);
  assert.equal(C.normSt(bag("bag00001", { ml: 0 })), null);
  assert.equal(C.normSt(bag("bag00001", { d: "2026-02-30" })), null);
  assert.equal(C.normSt(bag("BAD")), null);
  const used = C.normSt(bag("bag00001", { s: "u", sd: "2026-10-12", tx: " left\u0000 side ", extra: 1 }));
  assert.deepEqual(used, { id: "bag00001", ml: 120, d: "2026-10-10", w: "f", u: "2026-10-14", s: "u", sd: "2026-10-12", tx: "left side", m: 10 });
  assert.ok(!("s" in C.normSt(bag("bag00001", { s: "?" }))));
  assert.deepEqual(C.normSt({ id: "bag00001", m: 11, del: 1 }), { id: "bag00001", m: 11, del: 1 });
});

test("stash order: fridge first, earliest use-by, oldest pumped; totals; next bag", () => {
  const d = base();
  d.st = [
    bag("bag00001", { w: "z", d: "2026-08-01", u: "2027-02-01", ml: 150 }),
    bag("bag00002", { d: "2026-10-12", u: "2026-10-16" }),
    bag("bag00003", { d: "2026-10-11", u: "2026-10-15", ml: 90 }),
    bag("bag00004", { w: "z", d: "2026-07-20", u: "2027-01-20", ml: 200 }),
    bag("bag00005", { d: "2026-10-05", u: "2026-10-09" }),             // expired
    bag("bag00006", { s: "u", sd: "2026-10-13" })                       // used
  ];
  const today = "2026-10-14";
  const order = C.stashBags(d, today).map((x) => x.bag.id);
  assert.deepEqual(order, ["bag00005", "bag00003", "bag00002", "bag00004", "bag00001"]);
  assert.equal(C.stashBags(d, today)[0].expired, true);
  assert.equal(C.stashBags(d, today)[1].soon, true);                     // use by tomorrow
  assert.equal(C.nextBag(d, today).id, "bag00003");
  const tot = C.stashTotals(d, today);
  assert.deepEqual(tot, { f: { n: 2, ml: 210 }, z: { n: 2, ml: 350 }, expired: 1 });
  assert.deepEqual(C.stashDone(d).map((b) => b.id), ["bag00006"]);
  assert.equal(C.nextBag(base(), today), null);
});

test("thaw: to the fridge, use within a day, never later than before", () => {
  const z = C.normSt(bag("bag00001", { w: "z", d: "2026-08-01", u: "2027-02-01" }));
  const th = C.thaw(z, "2026-10-14");
  assert.equal(th.w, "f");
  assert.equal(th.th, "2026-10-14");
  assert.equal(th.u, "2026-10-15");
  assert.equal(z.w, "z");                                            // the input is untouched
  const late = C.thaw(C.normSt(bag("bag00002", { w: "z", u: "2026-10-14" })), "2026-10-14");
  assert.equal(late.u, "2026-10-14");
  assert.ok(C.normSt(th));
});

test("stash sync: per bag LWW, tombstone, symmetric; no bags → no key (old bytes)", () => {
  const plain = base();
  assert.ok(!("st" in plain));
  assert.equal(JSON.stringify(C.normalize(plain)), JSON.stringify(plain));
  const a = base(), b = base();
  a.st = [bag("bag00001", { m: 20, s: "u", sd: "2026-10-13" }), bag("bag00002")];
  b.st = [bag("bag00001", { m: 15 }), { id: "bag00002", m: 30, del: 1 }, bag("bag00003", { w: "z", u: "2027-04-10" })];
  const ab = C.mergeBaby(a, b), ba = C.mergeBaby(b, a);
  assert.deepEqual(ab, ba);
  assert.equal(ab.st.length, 3);
  assert.equal(ab.st[0].s, "u");
  assert.equal(ab.st[1].del, 1);
  assert.equal(ab.st[2].w, "z");
  assert.deepEqual(C.mergeBaby(ab, ab), ab);
  // an older build hands back the slice without "st": nothing is lost
  const old = JSON.parse(JSON.stringify(ab));
  delete old.st;
  assert.deepEqual(C.mergeBaby(ab, old), ab);
  // key order: st before prefs
  const keys = Object.keys(ab);
  assert.ok(keys.indexOf("st") === keys.indexOf("mk") + 1 && keys.indexOf("prefs") === keys.indexOf("st") + 1);
});
