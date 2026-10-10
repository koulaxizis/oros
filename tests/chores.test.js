// Pure logic of the Chore Wheel: dates and occurrences, the slice
// merge (sync slice "chores"), who gets each chore (in turn, away,
// hand-over, balanced, spin) and the stats.
// Run: node --test tests/
//
// The logic lives in chores/core.js, shared by the app, the shell's
// daily reminder and the Calendar feed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "chores/core.js"));

const NOW = Date.UTC(2026, 9, 8, 12);          // 2026-10-08, a Thursday
const D = C.ymdToDn;
function mem(id, order, extra) { return Object.assign({ id, m: 1, name: id.toUpperCase(), color: 0, icon: "", away: null, order, om: 0 }, extra || {}); }
function task(id, freq, extra) {
  return Object.assign({ id, m: 1, name: id, icon: "", freq, weight: 1, mode: "rr", who: [], start: "2026-10-05", off: 0 }, extra || {});
}
function state(members, tasks, done, set) {
  return C.mergeChores({ members, tasks, done: done || {}, set: set || {}, tombs: {} }, {}, NOW);
}
const A = "aaaaaa", B = "bbbbbb", Cc = "cccccc";

test("dates: round trip, weekday (0 = Monday), bad dates refused", () => {
  assert.equal(C.dnToYmd(D("2026-10-08")), "2026-10-08");
  assert.equal(C.dow(D("2026-10-05")), 0);          // Monday
  assert.equal(C.dow(D("2026-10-11")), 6);          // Sunday
  assert.equal(C.monday(D("2026-10-11")), D("2026-10-05"));
  assert.ok(isNaN(D("2026-02-30")));
  assert.ok(isNaN(D("08/10/2026")));
  assert.equal(D("2024-03-31") - D("2024-03-30"), 1);   // DST weekend: still one day
});

test("occurrences: daily, every N days, weekdays, weekly, monthly", () => {
  const d = task("tdaily", { k: "d" });
  assert.equal(C.occAt(d, D("2026-10-04")), null);
  assert.deepEqual(C.occAt(d, D("2026-10-07")), { a: D("2026-10-07"), b: D("2026-10-07"), k: 2, key: "tdaily|2026-10-07" });
  const n = task("tevery", { k: "n", n: 3 });
  const o = C.occAt(n, D("2026-10-09"));
  assert.equal(C.dnToYmd(o.a), "2026-10-08");
  assert.equal(C.dnToYmd(o.b), "2026-10-10");
  assert.equal(o.k, 1);
  const wd = task("tweekd", { k: "wd", d: [0, 3] });     // Mon + Thu
  assert.equal(C.occAt(wd, D("2026-10-07")), null);
  assert.equal(C.occAt(wd, D("2026-10-08")).k, 1);
  assert.equal(C.occAt(wd, D("2026-10-12")).k, 2);
  assert.equal(C.occAt(wd, D("2026-10-15")).k, 3);
  const w = task("tweekl", { k: "w" }, { start: "2026-10-08" });
  const ow = C.occAt(w, D("2026-10-14"));
  assert.equal(C.dnToYmd(ow.a), "2026-10-12");
  assert.equal(C.dnToYmd(ow.b), "2026-10-18");
  assert.equal(ow.k, 1);
  assert.equal(C.occAt(w, D("2026-10-05")).k, 0);       // the week of the start counts
  const mo = task("tmonth", { k: "mo" }, { start: "2026-11-20" });
  assert.equal(C.occAt(mo, D("2026-10-30")), null);
  const om = C.occAt(mo, D("2027-02-15"));
  assert.equal(C.dnToYmd(om.a), "2027-02-01");
  assert.equal(C.dnToYmd(om.b), "2027-02-28");
  assert.equal(om.k, 3);
  assert.equal(C.occsIn(d, D("2026-10-01"), D("2026-10-10")).length, 6);
  assert.equal(C.occsIn(wd, D("2026-10-05"), D("2026-10-18")).length, 4);
  assert.equal(C.dnToYmd(C.prevOcc(wd, D("2026-10-12")).a), "2026-10-08");
});

test("normalize: bad entities dropped, fields clamped, ids sorted", () => {
  assert.equal(C.normMember({ id: "BAD", m: 1, name: "x" }), null);
  assert.equal(C.normMember({ id: A, m: 1, name: "   " }), null);
  const m = C.normMember({ id: A, m: 1, name: "  Ma   ria ", color: 99, order: -3, away: ["2026-10-10", "2026-10-01"], icon: "<b>" });
  assert.deepEqual(m, { id: A, m: 1, name: "Ma ria", color: 0, icon: "", away: null, order: 0, om: 0 });
  assert.equal(C.normTask(task(A, { k: "n", n: 1 })), null);
  assert.equal(C.normTask(task(A, { k: "wd", d: [] })), null);
  assert.equal(C.normTask(task(A, { k: "x" })), null);
  const tk = C.normTask(task(A, { k: "wd", d: [3, 0, 3, 9] }, { weight: 7, mode: "nope", who: [B, A, B, "X"] }));
  assert.deepEqual(tk.freq, { k: "wd", d: [0, 3] });
  assert.equal(tk.weight, 1);
  assert.equal(tk.mode, "rr");
  assert.deepEqual(tk.who, [A, B]);
});

test("merge: symmetric, canonical, idempotent (R5, R26)", () => {
  const x = { members: [mem(B, 1), mem(A, 0, { m: 5, name: "New" })], tasks: [task(A, { k: "d" })],
              done: { [A + "|2026-10-06"]: [1, A, 10] }, set: {}, tombs: { cccccc: 3 } };
  const y = { members: [mem(A, 0, { m: 4, name: "Old" })], tasks: [task(A, { k: "d" }, { m: 2, name: "later" })],
              done: { [A + "|2026-10-06"]: [0, "", 12], [A + "|2026-10-07"]: [2, "", 1] }, set: { [A + "|2026-10-08"]: [B, 1] }, tombs: {} };
  const xy = C.mergeChores(x, y, NOW), yx = C.mergeChores(y, x, NOW);
  assert.equal(JSON.stringify(xy), JSON.stringify(yx));
  assert.equal(JSON.stringify(C.mergeChores(xy, xy, NOW)), JSON.stringify(xy));
  assert.deepEqual(xy.members.map((m) => m.id), [A, B]);
  assert.equal(xy.members[0].name, "New");
  assert.equal(xy.tasks[0].name, "later");
  assert.deepEqual(xy.done[A + "|2026-10-06"], [0, "", 12]);       // the newer "not done" wins
  assert.deepEqual(Object.keys(xy.done), [A + "|2026-10-06", A + "|2026-10-07"]);
  // equal stamps: the larger canonical JSON, either way round
  const p = { members: [mem(A, 0, { name: "Ann" })] }, q = { members: [mem(A, 0, { name: "Bob" })] };
  assert.equal(C.mergeChores(p, q, NOW).members[0].name, C.mergeChores(q, p, NOW).members[0].name);
});

test("merge: moving a member on one phone keeps an edit made on another", () => {
  const edited = { members: [mem(A, 0, { m: 20, away: ["2026-10-08", "2026-10-09"] })] };
  const moved = { members: [mem(A, 3, { m: 1, om: 25 })] };
  const ab = C.mergeChores(edited, moved, NOW), ba = C.mergeChores(moved, edited, NOW);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.deepEqual(ab.members[0].away, ["2026-10-08", "2026-10-09"]);
  assert.equal(ab.members[0].order, 3);
  assert.equal(JSON.stringify(C.mergeChores(ab, ab, NOW)), JSON.stringify(ab));
  // a tombstone must outlive both stamps
  assert.equal(C.mergeChores(ab, { tombs: { [A]: 22 } }, NOW).members.length, 1);
  assert.equal(C.mergeChores(ab, { tombs: { [A]: 25 } }, NOW).members.length, 0);
});

test("merge: tombstones hide, delete wins ties, a newer edit resurrects (R17)", () => {
  const live = { members: [mem(A, 0, { m: 10 })] };
  assert.equal(C.mergeChores(live, { tombs: { [A]: 10 } }, NOW).members.length, 0);
  assert.equal(C.mergeChores(live, { tombs: { [A]: 9 } }, NOW).members.length, 1);
  const back = C.mergeChores({ members: [mem(A, 0, { m: 11 })] }, { tombs: { [A]: 10 } }, NOW);
  assert.equal(back.members.length, 1);
  assert.equal(back.tombs[A], 10);
});

test("merge: events older than 13 months are pruned the same way everywhere", () => {
  assert.equal(C.pruneBeforeYmd(NOW), "2025-09-01");
  const s = C.mergeChores({ done: { [A + "|2025-08-31"]: [1, A, 1], [A + "|2025-09-01"]: [1, A, 1] } }, {}, NOW);
  assert.deepEqual(Object.keys(s.done), [A + "|2025-09-01"]);
  // bad keys and values never get in
  const bad = C.mergeChores({ done: { "x|2026-10-01": [1, A, 1], [A + "|2026-13-01"]: [1, A, 1], [A + "|2026-10-01"]: [1, "", 1] },
                              set: { [A + "|2026-10-01"]: ["BAD", 1] } }, {}, NOW);
  assert.deepEqual(bad.done, {});
  assert.deepEqual(bad.set, {});
});

test("in turn: each period goes to the next member, in order", () => {
  const st = state([mem(B, 1), mem(A, 0), mem(Cc, 2)], [task("tdishes", { k: "d" })]);
  const ctx = C.makeCtx(st), tk = st.tasks[0];
  const who = [5, 6, 7, 8].map((d) => C.assignee(ctx, tk, C.occAt(tk, D("2026-10-0" + d))));
  assert.deepEqual(who, [A, B, Cc, A]);
});

test("in turn: chores made together start on different members", () => {
  const st = state([mem(A, 0), mem(B, 1), mem(Cc, 2)],
    [task("tone001", { k: "w" }), task("ttwo002", { k: "w" }, { off: 1 }), task("tthree3", { k: "w" }, { off: 2 })]);
  const ctx = C.makeCtx(st);
  const at = (n) => ["tone001", "ttwo002", "tthree3"].map((id) => { const tk = st.tasks.find((x) => x.id === id); return C.assignee(ctx, tk, C.occAt(tk, D(n))); });
  assert.deepEqual(at("2026-10-05"), [A, B, Cc]);
  assert.deepEqual(at("2026-10-12"), [B, Cc, A]);      // the wheel turns one step
});

test("in turn: an away member is skipped, the turn resumes after", () => {
  const st = state([mem(A, 0), mem(B, 1, { away: ["2026-10-06", "2026-10-06"] }), mem(Cc, 2)], [task("tdishes", { k: "d" })]);
  const ctx = C.makeCtx(st), tk = st.tasks[0];
  const who = [5, 6, 7, 8].map((d) => C.assignee(ctx, tk, C.occAt(tk, D("2026-10-0" + d))));
  assert.deepEqual(who, [A, Cc, Cc, A]);
  // everyone away: the turn stays as it is
  const all = state([mem(A, 0, { away: ["2026-10-01", "2026-10-30"] }), mem(B, 1, { away: ["2026-10-01", "2026-10-30"] })], [task("tdishes", { k: "d" })]);
  assert.equal(C.assignee(C.makeCtx(all), all.tasks[0], C.occAt(all.tasks[0], D("2026-10-06"))), B);
});

test("in turn: only the members who take part; a hand-over is for one period", () => {
  const tk = task("tlawnmo", { k: "w" }, { who: [A, Cc] });
  const st = state([mem(A, 0), mem(B, 1), mem(Cc, 2)], [tk], {}, { ["tlawnmo|2026-10-12"]: [B, 5] });
  const ctx = C.makeCtx(st), t0 = st.tasks[0];
  assert.equal(C.assignee(ctx, t0, C.occAt(t0, D("2026-10-05"))), A);
  assert.equal(C.assignee(ctx, t0, C.occAt(t0, D("2026-10-12"))), B);     // handed over
  assert.equal(C.assignee(ctx, t0, C.occAt(t0, D("2026-10-19"))), A);     // k = 2 → back in turn
  // "back to the turn" (empty hand-over) and a deleted member fall back to the turn
  const st2 = state([mem(A, 0), mem(Cc, 2)], [tk], {}, { ["tlawnmo|2026-10-12"]: ["", 6] });
  assert.equal(C.assignee(C.makeCtx(st2), st2.tasks[0], C.occAt(st2.tasks[0], D("2026-10-12"))), Cc);
  const st3 = state([mem(A, 0), mem(Cc, 2)], [tk], {}, { ["tlawnmo|2026-10-12"]: [B, 6] });
  assert.equal(C.assignee(C.makeCtx(st3), st3.tasks[0], C.occAt(st3.tasks[0], D("2026-10-12"))), Cc);
});

test("balanced: the fewest points over the last 4 weeks; same-day load counts", () => {
  const heavy = task("theavyx", { k: "d" }, { weight: 3 });
  const b1 = task("tbal001", { k: "d" }, { mode: "bal", start: "2026-10-08", weight: 2 });
  const b2 = task("tbal002", { k: "d" }, { mode: "bal", start: "2026-10-08", weight: 2 });
  const st = state([mem(A, 0), mem(B, 1)], [heavy, b1, b2], { ["theavyx|2026-10-06"]: [1, A, 1] });
  const ctx = C.makeCtx(st);
  const t1 = st.tasks.find((x) => x.id === "tbal001"), t2 = st.tasks.find((x) => x.id === "tbal002");
  const o1 = C.occAt(t1, D("2026-10-08")), o2 = C.occAt(t2, D("2026-10-08"));
  assert.equal(C.assignee(ctx, t1, o1), B);        // A has 3 points, B none
  assert.equal(C.assignee(ctx, t2, o2), B);        // B now has 2 < 3
  // the same answer on any device: the order of the arrays does not matter
  const again = C.mergeChores(JSON.parse(JSON.stringify(st)), {}, NOW);
  assert.equal(C.assignee(C.makeCtx(again), t2, o2), B);
});

test("spin: nobody until spun; the stored result is the assignee", () => {
  const sp = task("tspin01", { k: "w" }, { mode: "spin" });
  const st = state([mem(A, 0), mem(B, 1)], [sp]);
  const o = C.occAt(st.tasks[0], D("2026-10-08"));
  assert.equal(C.assignee(C.makeCtx(st), st.tasks[0], o), null);
  const st2 = state([mem(A, 0), mem(B, 1)], [sp], {}, { [o.key]: [B, 9] });
  assert.equal(C.assignee(C.makeCtx(st2), st2.tasks[0], o), B);
  // two phones spun at once: both settle on the later spin
  const x = { set: { [o.key]: [A, 10] } }, y = { set: { [o.key]: [B, 11] } };
  assert.deepEqual(C.mergeChores(x, y, NOW).set[o.key], [B, 11]);
  assert.deepEqual(C.mergeChores(y, x, NOW).set[o.key], [B, 11]);
});

test("today: current chores plus last week's unfinished ones (late)", () => {
  const d = task("tdishes", { k: "d" }), w = task("tweekly", { k: "w" }, { start: "2026-09-28" });
  const st = state([mem(A, 0), mem(B, 1)], [d, w], { ["tdishes|2026-10-06"]: [1, A, 1] });
  const rows = C.dayRows(C.makeCtx(st), D("2026-10-08"));
  const keys = rows.map((r) => r.o.key + (r.late ? " late" : "")).sort();
  assert.deepEqual(keys, ["tdishes|2026-10-07 late", "tdishes|2026-10-08", "tweekly|2026-09-28 late", "tweekly|2026-10-05"]);
});

test("stats: points by who did it, misses by who had it", () => {
  const d = task("tdishes", { k: "d" }, { weight: 2 });
  const st = state([mem(A, 0), mem(B, 1)], [d], {
    ["tdishes|2026-10-05"]: [1, A, 1],     // A's turn, done by A
    ["tdishes|2026-10-06"]: [1, A, 1],     // B's turn, done by A
    ["tdishes|2026-10-07"]: [2, "", 1]     // A's turn, skipped
  });
  const s = C.statsFor(C.makeCtx(st), D("2026-10-05"), D("2026-10-11"), D("2026-10-10"));
  // A's turns: 05 done, 07 skipped, 09 missed; B's: 06 (done by A), 08 missed, 10 still today
  assert.deepEqual(s[A], { pts: 4, done: 2, missed: 1 });
  assert.deepEqual(s[B], { pts: 0, done: 0, missed: 1 });
});

test("streak: days back without a missed chore", () => {
  const d = task("tdishes", { k: "d" }, { start: "2026-10-01" });
  const done = {};
  ["01", "02", "03", "04", "05", "06", "07"].forEach((x) => { done["tdishes|2026-10-" + x] = [1, A, 1]; });
  const st = state([mem(A, 0)], [d], done);
  assert.equal(C.streakOf(C.makeCtx(st), A, D("2026-10-08")), 7);       // today still open
  done["tdishes|2026-10-08"] = [1, A, 1];
  const st2 = state([mem(A, 0)], [d], done);
  assert.equal(C.streakOf(C.makeCtx(st2), A, D("2026-10-08")), 8);
  delete done["tdishes|2026-10-04"];
  const st3 = state([mem(A, 0)], [d], done);
  assert.equal(C.streakOf(C.makeCtx(st3), A, D("2026-10-08")), 4);     // 05, 06, 07 + today
});

test("ready sets: valid chores", () => {
  assert.deepEqual(C.SET_IDS, ["kitchen", "clean", "pet", "home"]);
  C.SET_IDS.forEach((id) => {
    C.SETS[id].forEach((x, i) => {
      ["en", "el"].forEach((l) => {
        const tk = C.normTask({ id: "tsetabc", m: 1, name: x[l], icon: x.icon, freq: x.freq, weight: x.weight, mode: "rr", who: [], start: "2026-10-08" });
        assert.ok(tk, id + " " + i + " " + l);
        assert.equal(tk.name, x[l]);
        assert.equal(tk.icon, x.icon);
      });
    });
  });
});

test("readPrefs: me + reminder hour, bad values fall back", () => {
  assert.deepEqual(C.readPrefs(null), { me: "", rh: 9 });
  assert.deepEqual(C.readPrefs({ me: A, rh: 7 }), { me: A, rh: 7 });
  assert.deepEqual(C.readPrefs({ me: A, rh: -1 }), { me: A, rh: -1 });     // off
  assert.deepEqual(C.readPrefs({ me: "<x>", rh: 24 }), { me: "", rh: 9 });
  assert.deepEqual(C.readPrefs({ me: 5, rh: "8" }), { me: "", rh: 9 });
});

test("summary: only my open chores today, late ones counted apart", () => {
  const d = task("tdishes", { k: "d" }, { start: "2026-10-05" });
  const w = task("tbins", { k: "w", d: [0] }, { start: "2026-10-05", name: "bins" });
  const st = state([mem(A, 0)], [d, w], {});
  const s = C.summary(st, D("2026-10-08"), A);
  assert.deepEqual(s.names, ["tdishes"]);
  assert.ok(s.late >= 1);                                           // missed days still open
  assert.deepEqual(C.summary(st, D("2026-10-08"), ""), { names: [], late: 0 });
  assert.deepEqual(C.summary(st, D("2026-10-08"), B), { names: [], late: 0 });   // not a member
  const done = {}; done["tdishes|2026-10-08"] = [1, A, 1];
  assert.deepEqual(C.summary(state([mem(A, 0)], [d], done), D("2026-10-08"), A).names, []);
});

test("feedRows: chores starting that day, filtered to me, sorted", () => {
  const d = task("tdishes", { k: "d" }, { start: "2026-10-05", name: "dishes" });
  const t2 = task("tcooking", { k: "d" }, { start: "2026-10-05", name: "cook", off: 1 });
  const st = state([mem(A, 0), mem(B, 1)], [d, t2], {});
  const all = C.feedRows(st, D("2026-10-08"), "");
  assert.deepEqual(all.map((r) => r.task.name), ["cook", "dishes"]);
  assert.notEqual(all[0].who, all[1].who);
  all.forEach((r) => { assert.equal(r.key.split("|")[1], "2026-10-08"); assert.ok(r.name); });
  const mine = C.feedRows(st, D("2026-10-08"), A);
  assert.ok(mine.length === 1 && mine[0].who === A);
  assert.deepEqual(C.feedRows(st, D("2026-10-04"), ""), []);        // before start
});
