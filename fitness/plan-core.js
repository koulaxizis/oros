// ============================================================
// orOS Workouts — plan-core.js (pure, no DOM, v1.0.0)
// 1. Progression programs (templates that compute each session):
//      "531"   Wendler 5/3/1: 4 days (press, deadlift, bench, squat),
//              weeks 5s / 3s / 5-3-1 / deload, last set "+" (as many
//              reps as possible), percentages of the training max (TM).
//              After the 4-week cycle every TM goes up one step (upper
//              body: Settings "Step, upper body", lower: "Step, lower
//              body"); a lift whose "+" set missed its reps in the
//              cycle goes down 10% instead. Optional "Boring But Big"
//              5 × 10 at 50%.
//      "gzclp" GZCLP: 4 days A1 B1 A2 B2, tiers T1 / T2 / T3.
//              T1 5×3+ → 6×2+ → 10×1+ (a failed session moves to the
//              next stage at the same weight; failing 10×1 starts again
//              at 5×3 with 85% of the weight). T2 3×10 → 3×8 → 3×6
//              (failing 3×6 starts again at 3×10 with the last 3×10
//              weight + 3 upper steps). T3 3×15+: up one upper step when
//              the last set reaches 25 reps. T1 starts at 85% and T2 at
//              65% of the 5-rep max the user gives; T3 starts with the
//              weight used the first time.
//      "lin"   Linear 5×5 (A / B): every lift goes up one step after a
//              session with all sets at 5 reps; three failed sessions
//              in a row on a lift take it down 10%.
//    Weights are integers in grams, rounded to the plan's plate step.
//    A plan advances only by the workout started at its current
//    position (wo.pp === plan.k), so a workout counts once.
// 2. Supersets and circuits: entries / program items with ln = 1 are
//    linked to the next one. A group is run round by round (set 1 of
//    each exercise, then set 2 …) and rests after the round.
// window.OrosFitnessPlan (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var F_DONE = 1, F_WARM = 2;
  var TPLS = ["531", "gzclp", "lin"];
  var LIFT_IDS = ["x-squat", "x-bench", "x-deadlift", "x-ohp", "x-row"];
  var LOWER = { "x-squat": 1, "x-deadlift": 1 };

  // Lifts that need a starting number from the user, per template.
  var LIFTS = {
    "531":  ["x-squat", "x-bench", "x-deadlift", "x-ohp"],
    gzclp:  ["x-squat", "x-bench", "x-deadlift", "x-ohp"],
    lin:    ["x-squat", "x-bench", "x-deadlift", "x-ohp", "x-row"]
  };
  // How many sessions one turn of the template has (for "Week 2 · Day 3").
  var CYCLE = { "531": 16, gzclp: 4, lin: 2 };

  // ---------- helpers ----------
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function roundTo(g, rd) {
    if (!(g > 0)) return 0;
    if (!(rd > 0)) return Math.round(g);
    return Math.round(g / rd) * rd;
  }
  function stepOf(exId, set) { return LOWER[exId] ? set.incL : set.incU; }
  function isDone(s) { return (s[4] & F_DONE) === F_DONE; }
  function isWarm(s) { return (s[4] & F_WARM) === F_WARM; }

  // ---------- 1a. templates ----------
  // 5/3/1: [percent, reps, plus]
  var W531 = [
    [[65, 5], [75, 5], [85, 5, 1]],
    [[70, 3], [80, 3], [90, 3, 1]],
    [[75, 5], [85, 3], [95, 1, 1]],
    [[40, 5], [50, 5], [60, 5]]
  ];
  var WARM531 = [[40, 5], [50, 5], [60, 3]];
  var DAYS531 = ["x-ohp", "x-deadlift", "x-bench", "x-squat"];

  var DAYSG = [
    [["t1", "x-squat"], ["t2", "x-bench"], ["t3", "x-pulldown"]],
    [["t1", "x-ohp"], ["t2", "x-deadlift"], ["t3", "x-dbrow"]],
    [["t1", "x-bench"], ["t2", "x-squat"], ["t3", "x-pulldown"]],
    [["t1", "x-deadlift"], ["t2", "x-ohp"], ["t3", "x-dbrow"]]
  ];
  var T1 = [[5, 3], [6, 2], [10, 1]];
  var T2 = [[3, 10], [3, 8], [3, 6]];
  var T3_UP = 25;
  var DAYS_G_NAME = ["A1", "B1", "A2", "B2"];

  var DAYSL = [
    [["x-squat", 5, 5], ["x-bench", 5, 5], ["x-row", 5, 5]],
    [["x-squat", 5, 5], ["x-ohp", 5, 5], ["x-deadlift", 1, 5]]
  ];
  var DAYS_L_NAME = ["A", "B"];

  // A new plan's slots from the user's numbers (tm: { liftId: grams }).
  // 5/3/1 keeps the TMs; GZCLP and Linear turn them into slot weights.
  function initPlan(tp, tm, rd) {
    var sl = {};
    if (tp === "gzclp") {
      DAYSG.forEach(function (day) {
        day.forEach(function (x) {
          var k = x[0] + ":" + x[1];
          if (sl[k]) return;
          var base = tm[x[1]] || 0;
          var w = x[0] === "t1" ? roundTo(base * 0.85, rd) : x[0] === "t2" ? roundTo(base * 0.65, rd) : 0;
          sl[k] = { w: w, lv: 0, b: w, f: 0 };
        });
      });
    } else if (tp === "lin") {
      DAYSL.forEach(function (day) {
        day.forEach(function (x) {
          var k = "l:" + x[0];
          if (!sl[k]) sl[k] = { w: roundTo(tm[x[0]] || 0, rd), lv: 0, b: 0, f: 0 };
        });
      });
    }
    return sl;
  }

  // Where a plan stands: { cyc, wk, day, dayName } (all 0-based but
  // dayName, which is the template's own label or the lift id).
  function position(plan) {
    var k = plan.k || 0;
    if (plan.tp === "531") {
      return { cyc: Math.floor(k / 16), wk: Math.floor((k % 16) / 4), day: k % 4, lift: DAYS531[k % 4] };
    }
    if (plan.tp === "gzclp") return { cyc: Math.floor(k / 4), wk: 0, day: k % 4, dayName: DAYS_G_NAME[k % 4] };
    return { cyc: Math.floor(k / 2), wk: 0, day: k % 2, dayName: DAYS_L_NAME[k % 2] };
  }

  // The session at the plan's position:
  // { pos, items: [{ e, pk, rest, sets: [{ w, r, warm, plus }] }] }
  function session(plan) {
    var p = position(plan), rd = plan.rd, items = [];
    if (plan.tp === "531") {
      var lift = p.lift, tm = (plan.tm && plan.tm[lift]) || 0, sets = [];
      if (p.wk < 3) WARM531.forEach(function (x) { sets.push({ w: roundTo(tm * x[0] / 100, rd), r: x[1], warm: 1, plus: 0 }); });
      W531[p.wk].forEach(function (x) { sets.push({ w: roundTo(tm * x[0] / 100, rd), r: x[1], warm: 0, plus: x[2] ? 1 : 0 }); });
      items.push({ e: lift, pk: "m:" + lift, rest: 180, sets: sets });
      if (plan.bb && p.wk < 3) {
        var bb = [];
        for (var i = 0; i < 5; i++) bb.push({ w: roundTo(tm * 0.5, rd), r: 10, warm: 0, plus: 0 });
        items.push({ e: lift, pk: "a:" + lift, rest: 90, sets: bb });
      }
    } else if (plan.tp === "gzclp") {
      DAYSG[p.day].forEach(function (x) {
        var k = x[0] + ":" + x[1], s = (plan.sl && plan.sl[k]) || { w: 0, lv: 0 }, sets = [], n, r, j;
        if (x[0] === "t1") { n = T1[s.lv][0]; r = T1[s.lv][1]; }
        else if (x[0] === "t2") { n = T2[s.lv][0]; r = T2[s.lv][1]; }
        else { n = 3; r = 15; }
        for (j = 0; j < n; j++) sets.push({ w: s.w, r: r, warm: 0, plus: x[0] !== "t2" && j === n - 1 ? 1 : 0 });
        items.push({ e: x[1], pk: k, rest: x[0] === "t1" ? 180 : x[0] === "t2" ? 120 : 60, sets: sets });
      });
    } else {
      DAYSL[p.day].forEach(function (x) {
        var k = "l:" + x[0], s = (plan.sl && plan.sl[k]) || { w: 0 }, sets = [];
        for (var j = 0; j < x[1]; j++) sets.push({ w: s.w, r: x[2], warm: 0, plus: 0 });
        items.push({ e: x[0], pk: k, rest: x[0] === "x-deadlift" ? 180 : 150, sets: sets });
      });
    }
    return { pos: plan.k || 0, p: p, items: items };
  }

  // A workout entry from a session item (the shape fitness.js stores):
  // { e, tr, tr2, rest, ln, pk, pr, am, s: [[w, r, t, dist, flags]] }
  function entryOf(item) {
    var pr = [], am = 0, s = [];
    item.sets.forEach(function (x) {
      s.push([x.w, x.r, 0, 0, x.warm ? F_WARM : 0]);
      if (!x.warm) { pr.push(x.r); if (x.plus) am = 1; }
    });
    var last = item.sets[item.sets.length - 1];
    return { e: item.e, tr: last ? last.r : 0, tr2: 0, rest: item.rest, ln: 0, pk: item.pk, pr: pr, am: am, s: s };
  }

  // What the user did in a plan entry: working sets done, in order.
  // { done: [[w, r]], ok: every prescribed set done with its reps,
  //   plusR: reps of the last ("+") set or -1 }
  function resultOf(entry) {
    var work = entry.s.filter(function (s) { return !isWarm(s); });
    var done = work.filter(isDone).map(function (s) { return [s[0], s[1]]; });
    var pr = entry.pr || [], ok = done.length >= pr.length && done.length > 0;
    for (var i = 0; i < pr.length && ok; i++) if (!work[i] || !isDone(work[i]) || work[i][1] < pr[i]) ok = false;
    var lastW = work.length ? work[work.length - 1] : null;
    return { done: done, ok: ok, plusR: lastW && isDone(lastW) ? lastW[1] : -1 };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // A finished workout moves its plan on. Returns null when the workout
  // is not this plan's current session, else
  // { plan: the new plan (m untouched), notes: [{ e, pk, what, w }] }
  //   what: "up" | "same" | "stage" | "reset" | "down" | "tmUp" | "tmDown"
  function advance(plan, wo, set) {
    if (!plan || !wo || wo.pl !== plan.id || wo.pp !== (plan.k || 0)) return null;
    var np = clone(plan), notes = [], rd = np.rd;
    np.sl = np.sl || {}; np.tm = np.tm || {}; np.fl = np.fl || {};
    var byKey = {};
    (wo.x || []).forEach(function (e) { if (e.pk && !byKey[e.pk]) byKey[e.pk] = e; });
    var ses = session(plan);
    ses.items.forEach(function (it) {
      var e = byKey[it.pk];
      if (!e) return;
      var res = resultOf(e);
      if (!res.done.length) return;
      var tier = it.pk.slice(0, it.pk.indexOf(":")), s = np.sl[it.pk];
      if (plan.tp === "531") {
        if (tier === "m") {
          var plusMiss = ses.items[0].sets.some(function (x) { return x.plus; }) && (res.plusR < 0 || !res.ok);
          if (plusMiss) { np.fl[it.e] = 1; notes.push({ e: it.e, pk: it.pk, what: "miss", w: np.tm[it.e] || 0 }); }
        }
        return;
      }
      if (!s) return;
      var step = stepOf(it.e, set);
      if (tier === "t1") {
        if (res.ok) { s.w = roundTo(s.w + step, rd); notes.push({ e: it.e, pk: it.pk, what: "up", w: s.w }); }
        else if (s.lv < 2) { s.lv++; notes.push({ e: it.e, pk: it.pk, what: "stage", w: s.w, lv: s.lv }); }
        else { s.lv = 0; s.w = roundTo(s.w * 0.85, rd); notes.push({ e: it.e, pk: it.pk, what: "reset", w: s.w, lv: 0 }); }
      } else if (tier === "t2") {
        if (s.lv === 0) s.b = s.w;
        if (res.ok) { s.w = roundTo(s.w + step, rd); notes.push({ e: it.e, pk: it.pk, what: "up", w: s.w }); }
        else if (s.lv < 2) { s.lv++; notes.push({ e: it.e, pk: it.pk, what: "stage", w: s.w, lv: s.lv }); }
        else { s.lv = 0; s.w = roundTo((s.b || s.w) + 3 * set.incU, rd); notes.push({ e: it.e, pk: it.pk, what: "reset", w: s.w, lv: 0 }); }
        if (s.lv === 0) s.b = s.w;
      } else if (tier === "t3") {
        var used = 0;
        res.done.forEach(function (d) { used = Math.max(used, d[0]); });
        if (used > 0) s.w = used;
        if (res.plusR >= T3_UP) { s.w = roundTo(s.w + set.incU, rd); notes.push({ e: it.e, pk: it.pk, what: "up", w: s.w }); }
        else notes.push({ e: it.e, pk: it.pk, what: "same", w: s.w });
      } else if (tier === "l") {
        if (res.ok) { s.f = 0; s.w = roundTo(s.w + step, rd); notes.push({ e: it.e, pk: it.pk, what: "up", w: s.w }); }
        else {
          s.f = (s.f || 0) + 1;
          if (s.f >= 3) { s.f = 0; s.w = roundTo(s.w * 0.9, rd); notes.push({ e: it.e, pk: it.pk, what: "down", w: s.w }); }
          else notes.push({ e: it.e, pk: it.pk, what: "same", w: s.w, f: s.f });
        }
      }
    });
    np.k = (plan.k || 0) + 1;
    if (plan.tp === "531" && np.k % 16 === 0) {
      LIFTS["531"].forEach(function (lift) {
        var tm = np.tm[lift] || 0;
        if (!tm) return;
        if (np.fl[lift]) { np.tm[lift] = roundTo(tm * 0.9, rd); notes.push({ e: lift, pk: "m:" + lift, what: "tmDown", w: np.tm[lift] }); }
        else { np.tm[lift] = roundTo(tm + stepOf(lift, set), rd); notes.push({ e: lift, pk: "m:" + lift, what: "tmUp", w: np.tm[lift] }); }
      });
      np.fl = {};
    }
    return { plan: np, notes: notes };
  }

  // Skipping a session: the position moves on, nothing else changes
  // (5/3/1 still bumps the TMs when a cycle ends, as a finished one would).
  function skip(plan, set) {
    var np = clone(plan);
    np.k = (plan.k || 0) + 1;
    np.fl = np.fl || {};
    if (plan.tp === "531" && np.k % 16 === 0) {
      LIFTS["531"].forEach(function (lift) {
        var tm = (np.tm && np.tm[lift]) || 0;
        if (tm) np.tm[lift] = np.fl[lift] ? roundTo(tm * 0.9, np.rd) : roundTo(tm + stepOf(lift, set), np.rd);
      });
      np.fl = {};
    }
    return np;
  }

  // Starting numbers from the user's history: best estimated 1RM per lift
  // (Epley, already computed by the caller) → the number the template asks.
  function suggestStart(tp, e1, rd) {
    if (!(e1 > 0)) return 0;
    if (tp === "531") return roundTo(e1 * 0.9, rd);              // training max
    var rm5 = e1 / (1 + 5 / 30);                                  // a 5-rep max
    return tp === "gzclp" ? roundTo(rm5, rd) : roundTo(rm5 * 0.8, rd);
  }

  // ---------- 2. supersets and circuits ----------
  // [[firstIndex, lastIndex], ...] of consecutive linked entries.
  function groupsOf(list) {
    var out = [], start = 0;
    for (var i = 0; i < list.length; i++) {
      if (!(list[i] && list[i].ln) || i === list.length - 1) { out.push([start, i]); start = i + 1; }
    }
    return out;
  }
  function groupAt(list, ei) {
    var gs = groupsOf(list);
    for (var i = 0; i < gs.length; i++) if (ei >= gs[i][0] && ei <= gs[i][1]) return gs[i];
    return [ei, ei];
  }
  // Every set in the order it is done: a single exercise set after set,
  // a group round by round. [[entryIndex, setIndex], ...]
  function flowOrder(list) {
    var out = [];
    groupsOf(list).forEach(function (g) {
      if (g[0] === g[1]) { list[g[0]].s.forEach(function (_, si) { out.push([g[0], si]); }); return; }
      var max = 0, i;
      for (i = g[0]; i <= g[1]; i++) max = Math.max(max, list[i].s.length);
      for (var r = 0; r < max; r++) for (i = g[0]; i <= g[1]; i++) if (list[i].s[r]) out.push([i, r]);
    });
    return out;
  }
  // The next set not done after [ei, si] in flow order (then from the
  // top), or null.
  function nextAfter(list, ei, si) {
    var order = flowOrder(list), at = -1, i;
    for (i = 0; i < order.length; i++) if (order[i][0] === ei && order[i][1] === si) { at = i; break; }
    for (i = at + 1; i < order.length; i++) if (!isDone(list[order[i][0]].s[order[i][1]])) return order[i];
    for (i = 0; i <= at && i < order.length; i++) if (!isDone(list[order[i][0]].s[order[i][1]])) return order[i];
    return null;
  }
  function nextUp(list) {
    var order = flowOrder(list);
    for (var i = 0; i < order.length; i++) if (!isDone(list[order[i][0]].s[order[i][1]])) return order[i];
    return null;
  }
  // After ticking [ei, si]: rest unless another exercise of the same
  // group still has its set of this round to do.
  function restAfter(list, ei, si) {
    var g = groupAt(list, ei);
    for (var i = ei + 1; i <= g[1]; i++) {
      var s = list[i].s[si];
      if (s && !isDone(s)) return false;
    }
    return true;
  }
  // Rest after a round: the last exercise's rest in the group.
  function groupRest(list, ei) {
    var g = groupAt(list, ei);
    return (list[g[1]] && list[g[1]].rest) || 0;
  }
  // Round shown on a group: the first round with a set not done (1-based),
  // and the number of rounds.
  function roundOf(list, g) {
    var max = 0, i, r;
    for (i = g[0]; i <= g[1]; i++) max = Math.max(max, list[i].s.length);
    for (r = 0; r < max; r++) {
      for (i = g[0]; i <= g[1]; i++) if (list[i].s[r] && !isDone(list[i].s[r])) return { at: r + 1, of: max };
    }
    return { at: max, of: max };
  }

  var api = {
    TPLS: TPLS, LIFTS: LIFTS, LIFT_IDS: LIFT_IDS, CYCLE: CYCLE, W531: W531, T1: T1, T2: T2, T3_UP: T3_UP,
    DAYS531: DAYS531, DAYSG: DAYSG, DAYSL: DAYSL,
    roundTo: roundTo, initPlan: initPlan, position: position, session: session, entryOf: entryOf,
    resultOf: resultOf, advance: advance, skip: skip, suggestStart: suggestStart,
    groupsOf: groupsOf, groupAt: groupAt, flowOrder: flowOrder, nextAfter: nextAfter, nextUp: nextUp,
    restAfter: restAfter, groupRest: groupRest, roundOf: roundOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosFitnessPlan = api;
})(typeof window !== "undefined" ? window : globalThis);
