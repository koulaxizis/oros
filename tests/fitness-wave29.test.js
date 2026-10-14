// Workouts wave 29: progression programs (5/3/1, GZCLP, Linear 5×5),
// superset / circuit sequencing (fitness/plan-core.js), outdoor GPS
// maths and GPX (fitness/gps-core.js over maps/tracks-core.js), the
// wger.de picture parsers (fitness/wger.js) and the new optional
// fields in the Workouts model (fitness.js section 3).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const P = require("../fitness/plan-core.js");
const G = require("../fitness/gps-core.js");
const W = require("../fitness/wger.js");
const MT = require("../maps/tracks-core.js");

const src = fs.readFileSync(path.join(__dirname, "..", "fitness/fitness.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const F = new Function("crypto",
  "var LANG = 'en';\n" +
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  var STRINGS", "  function newId(") +
  block("  // ---------- 2. Ready", "  // ---------- 4b.") +
  "\nreturn { STRINGS, normItem, normEntry, normWo, normPg, normPl, mergeFit, emptyData, recordsOf, entryStats };")(webcrypto);

const KG = 1000;
const SET = { incU: 2500, incL: 5000 };
const D = 1, WU = 2;

// Tick every set of an entry with the given reps (or keep the prescribed).
function doEntry(e, reps) {
  let k = 0;
  e.s.forEach((s) => {
    if (s[4] & WU) { s[4] |= D; return; }
    if (reps && reps[k] !== undefined) s[1] = reps[k];
    if (!(reps && reps[k] === null)) s[4] |= D;
    k++;
  });
  return e;
}
function woFor(plan, repsByPk) {
  const ses = P.session(plan);
  const x = ses.items.map((it) => doEntry(P.entryOf(it), repsByPk && repsByPk[it.pk]));
  return { id: "w1", pl: plan.id, pp: ses.pos, x };
}

// ---------- 5/3/1 ----------
test("5/3/1: weeks, percentages of the TM, warm-ups, + set, rounding", () => {
  const tm = { "x-squat": 140 * KG, "x-bench": 100 * KG, "x-deadlift": 180 * KG, "x-ohp": 60 * KG };
  const plan = { id: "p1", tp: "531", rd: 2500, k: 0, tm, sl: {}, fl: {} };
  let s = P.session(plan);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].e, "x-ohp");                     // day 1: press
  const sets = s.items[0].sets;
  assert.equal(sets.length, 6);                            // 3 warm-up + 3 work
  assert.deepEqual(sets.filter((x) => x.warm).map((x) => x.w), [25000, 30000, 35000]);  // 40/50/60% of 60 → 24, 30, 36 → 2.5 steps
  assert.deepEqual(sets.filter((x) => !x.warm).map((x) => [x.w, x.r, x.plus]), [[40000, 5, 0], [45000, 5, 0], [50000, 5, 1]]);
  // week 3, squat (k = 8 + 3)
  s = P.session(Object.assign({}, plan, { k: 11 }));
  assert.equal(s.items[0].e, "x-squat");
  assert.deepEqual(s.items[0].sets.filter((x) => !x.warm).map((x) => [x.w, x.r, x.plus]),
    [[105000, 5, 0], [120000, 3, 0], [132500, 1, 1]]);   // 75/85/95% of 140
  // deload week: no warm-up, no + set
  s = P.session(Object.assign({}, plan, { k: 12 }));
  assert.ok(s.items[0].sets.every((x) => !x.warm && !x.plus));
  assert.deepEqual(s.items[0].sets.map((x) => x.r), [5, 5, 5]);
  // Boring But Big
  s = P.session(Object.assign({}, plan, { bb: 1 }));
  assert.equal(s.items.length, 2);
  assert.equal(s.items[1].pk, "a:x-ohp");
  assert.deepEqual(s.items[1].sets.map((x) => [x.w, x.r]), Array(5).fill([30000, 10]));
  assert.equal(P.roundTo(61249, 2500), 60000);
  assert.equal(P.roundTo(61250, 2500), 62500);
  assert.equal(P.roundTo(0, 2500), 0);
});

test("5/3/1: a cycle bumps the TMs; a missed + set takes 10% off that lift", () => {
  let plan = { id: "p1", tp: "531", rd: 2500, k: 0, tm: { "x-squat": 140000, "x-bench": 100000, "x-deadlift": 180000, "x-ohp": 60000 }, sl: {}, fl: {} };
  for (let i = 0; i < 16; i++) {
    const lift = P.DAYS531[i % 4];
    const pk = "m:" + lift;
    // in week 1 the bench + set gets 3 reps instead of 5
    const miss = i === 2 ? { [pk]: [5, 5, 3] } : null;
    const r = P.advance(plan, woFor(plan, miss), SET);
    assert.ok(r, "session " + i);
    if (i === 2) assert.deepEqual(r.notes.map((n) => n.what), ["miss"]);
    plan = r.plan;
  }
  assert.equal(plan.k, 16);
  assert.equal(plan.tm["x-squat"], 145000);        // lower +5
  assert.equal(plan.tm["x-deadlift"], 185000);
  assert.equal(plan.tm["x-ohp"], 62500);           // upper +2.5
  assert.equal(plan.tm["x-bench"], 90000);         // missed: −10%
  assert.deepEqual(plan.fl, {});
});

test("plans advance once: a stale or foreign workout changes nothing", () => {
  const plan = { id: "p1", tp: "lin", rd: 2500, k: 3, tm: {}, sl: P.initPlan("lin", { "x-squat": 100000, "x-bench": 60000, "x-row": 60000, "x-ohp": 40000, "x-deadlift": 120000 }, 2500), fl: {} };
  const wo = woFor(plan);
  assert.equal(P.advance(plan, Object.assign({}, wo, { pp: 2 }), SET), null);
  assert.equal(P.advance(plan, Object.assign({}, wo, { pl: "other" }), SET), null);
  const r = P.advance(plan, wo, SET);
  assert.equal(r.plan.k, 4);
  assert.equal(P.advance(r.plan, wo, SET), null);   // the same workout again
  // skip moves the position only
  const sk = P.skip(plan, SET);
  assert.equal(sk.k, 4);
  assert.deepEqual(sk.sl, plan.sl);
});

// ---------- GZCLP ----------
test("GZCLP: start weights, T1 stages and reset, T2 reset, T3 at 25 reps", () => {
  const tm = { "x-squat": 100000, "x-bench": 80000, "x-deadlift": 120000, "x-ohp": 50000 };
  const sl = P.initPlan("gzclp", tm, 2500);
  assert.equal(sl["t1:x-squat"].w, 85000);          // 85% of the 5RM
  assert.equal(sl["t2:x-bench"].w, 52500);          // 65% of 80 = 52 → 52.5
  assert.equal(sl["t3:x-pulldown"].w, 0);
  let plan = { id: "g", tp: "gzclp", rd: 2500, k: 0, tm, sl, fl: {} };
  let s = P.session(plan);
  assert.deepEqual(s.items.map((i) => i.pk), ["t1:x-squat", "t2:x-bench", "t3:x-pulldown"]);
  assert.equal(s.items[0].sets.length, 5);
  assert.ok(s.items[0].sets[4].plus && !s.items[1].sets[2].plus && s.items[2].sets[2].plus);
  assert.deepEqual(s.items[1].sets.map((x) => x.r), [10, 10, 10]);

  // A1 success on T1 and T2; T3 done with 40 kg and 25 reps on the last set
  let r = P.advance(plan, woFor(plan, { "t3:x-pulldown": [15, 15, 25] }), SET);
  // T3 had no weight: give it one through the entry (as the app prefills it)
  plan = r.plan;
  assert.equal(plan.sl["t1:x-squat"].w, 90000);
  assert.equal(plan.sl["t2:x-bench"].w, 55000);

  // T1 failure walks the stages at the same weight: squat is T1 again on day A1 (k = 4)
  plan.k = 4;
  const fail = (lv) => {
    const n = P.T1[lv][0];
    const reps = Array(n).fill(P.T1[lv][1]); reps[n - 1] = 0;  // last set missed
    return { "t1:x-squat": reps };
  };
  r = P.advance(plan, woFor(plan, fail(0)), SET); plan = r.plan;
  assert.deepEqual([plan.sl["t1:x-squat"].lv, plan.sl["t1:x-squat"].w], [1, 90000]);
  plan.k = 8;
  assert.deepEqual(P.session(plan).items[0].sets.map((x) => x.r), [2, 2, 2, 2, 2, 2]);
  r = P.advance(plan, woFor(plan, fail(1)), SET); plan = r.plan;
  assert.deepEqual([plan.sl["t1:x-squat"].lv, plan.sl["t1:x-squat"].w], [2, 90000]);
  plan.k = 12;
  r = P.advance(plan, woFor(plan, fail(2)), SET); plan = r.plan;
  assert.deepEqual([plan.sl["t1:x-squat"].lv, plan.sl["t1:x-squat"].w], [0, 77500]);   // 85% of 90 = 76.5 → 77.5
  assert.equal(r.notes.find((n) => n.pk === "t1:x-squat").what, "reset");

  // T2 bench (day A1): fail 3×10, 3×8, 3×6 → back to 3×10 at the last 3×10 weight + 3 upper steps
  let g = { id: "g", tp: "gzclp", rd: 2500, k: 0, tm, sl: P.initPlan("gzclp", tm, 2500), fl: {} };
  const t2fail = { "t2:x-bench": [10, 10, 4] };
  for (let i = 0; i < 3; i++) { g.k = i * 4; g = P.advance(g, woFor(g, t2fail), SET).plan; }
  assert.deepEqual([g.sl["t2:x-bench"].lv, g.sl["t2:x-bench"].w], [0, 52500 + 7500]);

  // T3: the weight used is kept; 25 reps on the + set adds an upper step
  let h = { id: "g", tp: "gzclp", rd: 2500, k: 0, tm, sl: P.initPlan("gzclp", tm, 2500), fl: {} };
  const wo = woFor(h, { "t3:x-pulldown": [15, 15, 18] });
  wo.x[2].s.forEach((x) => { x[0] = 40000; });
  h = P.advance(h, wo, SET).plan;
  assert.equal(h.sl["t3:x-pulldown"].w, 40000);
  h.k = 0;
  const wo2 = woFor(h, { "t3:x-pulldown": [15, 15, 26] });
  h = P.advance(h, wo2, SET).plan;
  assert.equal(h.sl["t3:x-pulldown"].w, 42500);
});

// ---------- Linear ----------
test("Linear 5×5: up after a full session, three misses take 10% off", () => {
  const tm = { "x-squat": 100000, "x-bench": 60000, "x-row": 60000, "x-ohp": 40000, "x-deadlift": 120000 };
  let plan = { id: "l", tp: "lin", rd: 2500, k: 0, tm, sl: P.initPlan("lin", tm, 2500), fl: {} };
  assert.deepEqual(P.session(plan).items.map((i) => i.e), ["x-squat", "x-bench", "x-row"]);
  plan = P.advance(plan, woFor(plan), SET).plan;
  assert.equal(plan.sl["l:x-squat"].w, 105000);
  assert.equal(plan.sl["l:x-bench"].w, 62500);
  assert.deepEqual(P.session(plan).items.map((i) => i.e), ["x-squat", "x-ohp", "x-deadlift"]);
  assert.equal(P.session(plan).items[2].sets.length, 1);
  // squat misses three times in a row
  for (let i = 0; i < 3; i++) {
    const r = P.advance(plan, woFor(plan, { "l:x-squat": [5, 5, 5, 4, 3] }), SET);
    plan = r.plan;
    if (i < 2) assert.equal(r.notes.find((n) => n.e === "x-squat").what, "same");
    else assert.equal(r.notes.find((n) => n.e === "x-squat").what, "down");
  }
  assert.equal(plan.sl["l:x-squat"].w, 95000);       // 90% of 105 = 94.5 → 95
  assert.equal(plan.sl["l:x-squat"].f, 0);
  // an unticked set is a miss too; a lift not done at all stays as it is
  assert.equal(plan.k % 2, 0);                           // day A: squat, bench, row
  const before = JSON.stringify(plan.sl["l:x-bench"]);
  const wo = woFor(plan, { "l:x-squat": [5, 5, 5, 5, null] });
  wo.x.splice(1, 1);                                     // bench not done at all
  const r = P.advance(plan, wo, SET);
  assert.equal(r.notes.find((n) => n.e === "x-squat").what, "same");
  assert.equal(JSON.stringify(r.plan.sl["l:x-bench"]), before);
  assert.equal(r.plan.sl["l:x-row"].w, plan.sl["l:x-row"].w + 2500);
});

test("starting numbers from history", () => {
  assert.equal(P.suggestStart("531", 100000, 2500), 90000);
  assert.equal(P.suggestStart("gzclp", 100000, 2500), 85000);   // 5RM ≈ 85.7
  assert.equal(P.suggestStart("lin", 100000, 2500), 67500);     // 80% of 85.7 = 68.6 → 67.5
  assert.equal(P.suggestStart("531", 0, 2500), 0);
});

// ---------- supersets ----------
function E(n, ln, done) {
  return { e: "x" + n, rest: 60 + n, ln: ln ? 1 : 0, s: Array.from({ length: n }, (_, i) => [0, 0, 0, 0, done && done.includes(i) ? 1 : 0]) };
}
test("supersets: groups, round-by-round order, rest after the round", () => {
  // A (3 sets) single, B (3) + C (2) superset, D (2) single
  const list = [E(3), E(3, 1), E(2), E(2)];
  list[0].e = "A"; list[1].e = "B"; list[2].e = "C"; list[3].e = "D";
  assert.deepEqual(P.groupsOf(list), [[0, 0], [1, 2], [3, 3]]);
  assert.deepEqual(P.flowOrder(list), [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0], [1, 1], [2, 1], [1, 2], [3, 0], [3, 1]]);
  assert.deepEqual(P.nextAfter(list, 1, 0), [2, 0]);
  assert.equal(P.restAfter(list, 1, 0), false);       // C's set of this round is still to do
  assert.equal(P.restAfter(list, 2, 0), true);        // the round is over
  assert.equal(P.restAfter(list, 1, 2), true);        // C has no third set
  assert.equal(P.restAfter(list, 0, 1), true);        // a single exercise rests after each set
  assert.equal(P.groupRest(list, 1), list[2].rest);   // the last exercise's rest
  assert.deepEqual(P.roundOf(list, [1, 2]), { at: 1, of: 3 });
  list[1].s[0][4] = 1; list[2].s[0][4] = 1;
  assert.deepEqual(P.roundOf(list, [1, 2]), { at: 2, of: 3 });
  assert.deepEqual(P.nextUp(list), [0, 0]);
  list[0].s.forEach((s) => { s[4] = 1; });
  assert.deepEqual(P.nextUp(list), [1, 1]);
  // C's round-2 set already ticked: after B's round-2 set comes rest
  list[2].s[1][4] = 1;
  assert.equal(P.restAfter(list, 1, 1), true);
  assert.deepEqual(P.nextAfter(list, 1, 1), [1, 2]);
  // a link on the last entry is ignored; nothing left → null
  const one = [E(1, 1, [0])];
  assert.deepEqual(P.groupsOf(one), [[0, 0]]);
  assert.equal(P.nextAfter(one, 0, 0), null);
  // circuit of three
  const c = [E(2, 1), E(2, 1), E(2)];
  assert.deepEqual(P.groupsOf(c), [[0, 2]]);
  assert.deepEqual(P.flowOrder(c), [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]);
});

// ---------- model ----------
test("model: new optional fields survive the merge; old rows keep their canonical JSON", () => {
  const old = { id: "w1", m: 5, d: "2026-10-05", st: 1, en: 3600001, ti: "W", p: "", pd: "", n: "",
                x: [{ e: "x-bench", tr: 5, tr2: 0, rest: 90, s: [[60000, 5, 0, 0, 1]] }] };
  assert.equal(JSON.stringify(F.normWo(old)), JSON.stringify(old));
  const pg = { id: "p", m: 1, n: "P", days: [{ id: "d1", n: "", wd: [], it: [{ e: "x-bench", s: 3, r: 5, r2: 0, t: 0, w: 0, rest: 0 }] }] };
  assert.equal(JSON.stringify(F.normPg(pg)), JSON.stringify(pg));
  const d0 = Object.assign(F.emptyData(), { wo: [old] });
  assert.ok(!("pl" in F.mergeFit(d0, d0)));          // no "pl" key until a program exists

  const neu = JSON.parse(JSON.stringify(old));
  neu.m = 6; neu.pl = "plan1"; neu.pp = 7;
  neu.x[0].ln = 1; neu.x[0].pk = "t1:x-bench"; neu.x[0].pr = [3, 3, 3]; neu.x[0].am = 1;
  neu.g = { a: "run", ps: 0, sg: [G.encSeg([[37.9, 23.7, null, 1000], [37.901, 23.7, null, 61000]], 1000)] };
  const m = F.mergeFit(d0, Object.assign(F.emptyData(), { wo: [neu] }));
  const w = m.wo[0];
  assert.equal(w.pl, "plan1"); assert.equal(w.pp, 7);
  assert.deepEqual([w.x[0].ln, w.x[0].pk, w.x[0].pr, w.x[0].am], [1, "t1:x-bench", [3, 3, 3], 1]);
  assert.equal(w.g.a, "run"); assert.equal(w.g.sg.length, 1);
  assert.deepEqual(F.mergeFit(m, m), m);              // idempotent
  // hostile values are dropped
  const bad = F.normWo(Object.assign({}, neu, { pl: "<x>", g: { a: "fly", sg: [] }, x: [{ e: "x-bench", pk: "zz:1", ln: "yes", s: [] }] }));
  assert.ok(!("pl" in bad) && !("g" in bad));
  assert.ok(!("pk" in bad.x[0]));
  assert.equal(bad.x[0].ln, 1);
  assert.equal(F.normWo(Object.assign({}, neu, { g: { a: "run", sg: ["ok", "bad seg ☃", 5] } })).g.sg.length, 1);
  // program items keep ln
  const it = F.normItem({ e: "x-bench", s: 3, r: 5, ln: 1 });
  assert.equal(it.ln, 1);
});

test("model: progression programs merge LWW with tombstones", () => {
  const a = { id: "plan1", m: 10, n: "", tp: "531", rd: 2500, bb: 0, k: 3, tm: { "x-squat": 100000 }, sl: {}, fl: { "x-squat": 1 } };
  const b = Object.assign({}, a, { m: 12, k: 4, fl: {} });
  const A = Object.assign(F.emptyData(), { pl: [a] }), B = Object.assign(F.emptyData(), { pl: [b] });
  assert.deepEqual(F.mergeFit(A, B), F.mergeFit(B, A));
  assert.equal(F.mergeFit(A, B).pl[0].k, 4);
  const T = Object.assign(F.emptyData(), { tombs: { "pl:plan1": 12 } });
  assert.ok(!("pl" in F.mergeFit(B, T)));               // a tomb ≥ m wins
  assert.equal(F.mergeFit(B, T).tombs["pl:plan1"], 12);
  assert.equal(F.normPl(Object.assign({}, a, { tp: "x" })), null);
  const n = F.normPl(Object.assign({}, a, { rd: -1, sl: { "t1:x-squat": { w: 5, lv: 9 }, "bad key": {} }, tm: { "x-squat": -5 } }));
  assert.equal(n.rd, 2500);
  assert.deepEqual(n.sl, { "t1:x-squat": { w: 5, lv: 0, b: 0, f: 0 } });
  assert.deepEqual(n.tm, { "x-squat": 0 });
  // every new string exists in both languages
  assert.deepEqual(Object.keys(F.STRINGS.en).sort(), Object.keys(F.STRINGS.el).sort());
});

// ---------- GPS ----------
test("gps: compact segments round-trip; garbage is refused", () => {
  const t0 = Date.UTC(2026, 9, 14, 7, 0, 0);
  const pts = [[37.975123, 23.734456, null, t0], [37.975901, 23.735002, null, t0 + 5000], [37.974, 23.73, null, t0 + 61000]];
  const s = G.encSeg(pts, t0);
  assert.match(s, /^[\x3f-\x7e]+$/);
  assert.deepEqual(G.decSeg(s, t0), pts);
  assert.deepEqual(G.decInts(G.encInt(-123456789) + G.encInt(0) + G.encInt(99)), [-123456789, 0, 99]);
  assert.deepEqual(G.decSeg("??", t0), []);            // not a whole triple
  assert.equal(G.normGps({ a: "swim", sg: [] }), null);
  assert.deepEqual(G.normGps({ a: "ride", ps: 1, sg: [s, 7, "a b"] }), { a: "ride", ps: 1, sg: [s] });
});

// A straight line north: 0.009° of latitude ≈ 1000.75 m
function line(t0, kmh, km, stepS) {
  const pts = [], mPerS = kmh / 3.6, dLat = 0.009 / 1000.754;
  for (let t = 0; t * mPerS <= km * 1000 + 1e-9; t += stepS) pts.push([40 + t * mPerS * dLat, 22, null, t0 + t * 1000]);
  return pts;
}
test("gps: distance, time, pace, speed and splits per km and mile", () => {
  const t0 = Date.UTC(2026, 9, 14, 7, 0, 0);
  const seg = line(t0, 12, 2.5, 5);                     // 12 km/h → 5:00 /km
  const st = G.statsOf([seg]);
  assert.ok(Math.abs(st.dist - 2500) <= 3, st.dist);
  assert.equal(st.time, 750);
  assert.ok(Math.abs(G.pace(st.time, st.dist, 1000) - 300) < 1);
  assert.ok(Math.abs(G.speed(st.time, st.dist, 1000) - 12) < 0.05);
  assert.equal(G.pace(0, 100, 1000), 0);
  const sp = G.splits([seg], 1000);
  assert.equal(sp.length, 3);
  assert.deepEqual(sp.slice(0, 2).map((x) => [x.n, x.d, x.full]), [[1, 1000, true], [2, 1000, true]]);
  assert.ok(Math.abs(sp[0].t - 300) <= 1 && Math.abs(sp[1].t - 300) <= 1);
  assert.ok(!sp[2].full && Math.abs(sp[2].d - 500) <= 3 && Math.abs(sp[2].t - 150) <= 1);
  const mi = G.splits([seg], 1609.344);
  assert.equal(mi.length, 2);
  assert.ok(Math.abs(mi[0].t - 483) <= 1);              // 1.609 km at 5:00 /km
  // a pause: two segments, the gap counts neither in time nor in distance
  const a = line(t0, 12, 1, 5), b = line(t0 + 3600000, 12, 1, 5).map((p) => [p[0] + 0.05, p[1], null, p[3]]);
  const two = G.statsOf([a, b]);
  assert.ok(Math.abs(two.dist - 2000) <= 3);
  assert.equal(two.time, 600);
  const sp2 = G.splits([a, b], 1000);
  assert.ok(Math.abs(sp2[1].t - 300) <= 2, JSON.stringify(sp2));
  // the noise filter is Maps' own
  assert.equal(G.accept(null, { lat: 40, lon: 22, acc: 80, t: t0 }), null);
  assert.ok(G.accept(null, { lat: 40, lon: 22, acc: 5, t: t0 }));
});

test("gps: GPX through Maps' writer, thinning, preview projection", () => {
  const t0 = Date.UTC(2026, 9, 14, 7, 0, 0);
  const seg = line(t0, 10, 1, 2);
  const text = G.gpx("Run <morning> & co", [seg]);
  assert.match(text, /creator="orOS Workouts"/);
  assert.match(text, /<name>Run &lt;morning&gt; &amp; co<\/name>/);
  const back = MT.parseGpx(text);
  assert.equal(back.segs[0].length, seg.length);
  assert.equal(back.segs[0][0][3], t0);
  const thin = G.thin([seg], 2);
  assert.equal(thin[0].length, 2);                      // a straight line keeps its ends
  const pr = G.project([seg], 320, 200, 10);
  assert.equal(pr.paths.length, 1);
  assert.ok(pr.start[1] > pr.end[1]);                   // north is up
  assert.equal(G.project([], 320, 200), null);
});

// ---------- wger ----------
test("wger: search answer and attribution parsing, only https addresses", () => {
  const search = { suggestions: [
    { value: "Bench Press Narrow Grip", data: { id: 9, base_id: 90, name: "Bench Press Narrow Grip", image: "/media/exercise-images/90/a.png" } },
    { value: "Bench Press", data: { id: 73, base_id: 192, name: "Bench Press", image: "/media/exercise-images/192/Bench-press-1.png" } },
    { value: "Bench Press Dumbbell", data: { id: 75, base_id: 97, name: "Bench Press Dumbbell", image: null } }
  ] };
  assert.deepEqual(W.pickSuggestion(search, "Bench press"),
    { id: 192, name: "Bench Press", image: "https://wger.de/media/exercise-images/192/Bench-press-1.png" });
  assert.equal(W.pickSuggestion({ suggestions: [{ data: { base_id: 1, image: "javascript:alert(1)" } }] }, "x"), null);
  assert.equal(W.pickSuggestion(null, "x"), null);
  const img = "https://wger.de/media/exercise-images/192/Bench-press-1.png";
  const info = { id: 192, license: { id: 2, full_name: "Creative Commons Attribution Share Alike 4", short_name: "CC-BY-SA 4", url: "https://creativecommons.org/licenses/by-sa/4.0/deed.en" },
    images: [{ image: "https://wger.de/media/other.png", is_main: true, license: 2, license_author: "Someone" },
             { image: img, is_main: false, license: 2, license_author: "Everkinetic", license_author_url: "javascript:x" }] };
  const a = W.parseInfo(info, img, 192);
  assert.equal(a.author, "Everkinetic");
  assert.equal(a.authorUrl, "");                        // not https → dropped
  assert.equal(a.license, "CC-BY-SA 4");
  assert.equal(a.licenseUrl, "https://creativecommons.org/licenses/by-sa/4.0/deed.en");
  assert.equal(a.page, "https://wger.de/en/exercise/192/view-base");
  const none = W.parseInfo(null, img, 5);
  assert.equal(none.license, "CC BY-SA 4.0");
  assert.equal(W.absUrl("//evil.example/x.png"), "");
  assert.equal(W.absUrl("https://evil.example/x.png"), "");
  assert.equal(W.safeUrl("https://a.example/x\"y"), "");
});
