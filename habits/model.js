// ============================================================
// orOS Habits — model.js (data shape, merge, writes; v2.0.0)
// The pure data layer of the Habits app: normalize on load, the sync
// merge, the canonical form and the per-day writes. No DOM, no
// storage. habits.js uses window.OrosHabitsModel; the tests load it
// through module.exports (tests/habits-core.test.js).
//
// Schema: see habits/core.js (v2). Merge rules:
//   habits  LWW per row by mtime; equal mtime → tombstone, then the
//           row with more fields (an older orOS strips num / per / rem
//           without a new stamp), then the larger JSON (HB-10). An
//           edit newer than a tombstone resurrects (R17).
//   comps   merged FIELD BY FIELD, so a value, a skip and a note made
//           on two devices for the same day all survive:
//             tick (mtime, del)  LWW, equal → not ticked
//             v                  per device share, newer m wins (the
//                                day value is the sum of the shares)
//             sk, nt             LWW by their own stamp
//   set     one record (Steps row on/off + goal), newer m wins.
// Canonical form (getter and merge alike, HB-11): rows sorted by id,
// fixed key order, empty completion rows older than 30 days before the
// newest stamp in the data pruned (HB-3).
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER = 2;
  var COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf",
                "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];
  var ICON_KEYS = ["check", "star", "heart", "fire", "book", "music", "bulb", "target",
                   "sun", "moon", "trophy", "leaf", "coffee", "dumbbell", "bed", "run"];
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var DEV_RE = /^[a-z0-9]{4,40}$/;
  var MAX_NUM = 10000000, UNIT_LEN = 16, NOTE_LEN = 200, NAME_LEN = 200;
  var STEPS_GOAL = 8000;
  var PRUNE_MS = 30 * 24 * 60 * 60 * 1000;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function stampOk(v) { return isInt(v) && v >= 0; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function numOk(v) { return typeof v === "number" && isFinite(v) && Math.abs(v) <= MAX_NUM; }
  function cmpStr(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // ---------- rows (strict: invalid → null, no volatile defaults) ----------
  function normDays(list) {
    var days = [], seen = {};
    if (Array.isArray(list)) {
      for (var i = 0; i < list.length; i++) {
        var dy = list[i];
        if (typeof dy === "number" && dy >= 0 && dy <= 6 && isInt(dy) && !seen[dy]) { seen[dy] = true; days.push(dy); }
      }
      days.sort();
    }
    return days;
  }
  function normNum(x) {
    if (!x || typeof x !== "object") return null;
    if (!(typeof x.t === "number" && isFinite(x.t) && x.t > 0 && x.t <= MAX_NUM)) return null;
    var s = typeof x.s === "number" && isFinite(x.s) && x.s > 0 && x.s <= MAX_NUM ? round2(x.s) : 1;
    return {
      u: typeof x.u === "string" ? x.u.replace(/\s+/g, " ").trim().slice(0, UNIT_LEN) : "",
      t: round2(x.t) || 0.01,
      c: x.c === "le" ? "le" : "ge",
      s: s || 1
    };
  }
  function normPer(p) {
    if (!Array.isArray(p) || (p[0] !== "w" && p[0] !== "m")) return null;
    var max = p[0] === "w" ? 7 : 31;
    return isInt(p[1]) && p[1] >= 1 && p[1] <= max ? [p[0], p[1]] : null;
  }
  // Assistant entry card (BR-W8-6, prefill only): the shell's
  // { asNew: { name, days?, perWeek?, perMonth?, target?, unit?, cmp?,
  // reminder?, from? } } → the values the new-habit dialog opens with,
  // or null without a name. days are Monday-first 0–6 (as the chips);
  // perWeek / perMonth win over days (as normHabit); target or unit
  // make it a number habit (an absent target stays blank for the user
  // to fill); reminder is "HH:MM". Unknown or bad fields are dropped.
  function asNew(x) {
    if (!x || typeof x !== "object") return null;
    function line(v, n) {
      return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
    }
    var name = line(x.name, NAME_LEN);
    if (!name) return null;
    var per = isInt(x.perWeek) ? normPer(["w", x.perWeek]) : (isInt(x.perMonth) ? normPer(["m", x.perMonth]) : null);
    var t = typeof x.target === "number" && isFinite(x.target) && x.target > 0 && x.target <= MAX_NUM ? round2(x.target) || 0.01 : 0;
    var u = line(x.unit, UNIT_LEN);
    var rm = typeof x.reminder === "string" && /^(\d{1,2}):(\d{2})$/.exec(x.reminder.trim());
    return {
      name: name,
      days: per ? [] : normDays(x.days),
      per: per,
      num: t || u ? { t: t, u: u, c: x.cmp === "le" ? "le" : "ge" } : null,
      rem: rm && +rm[1] < 24 && +rm[2] < 60 ? (+rm[1]) * 60 + (+rm[2]) : -1
    };
  }
  function normHabit(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !raw.id) return null;
    if (typeof raw.name !== "string") return null;
    if (!raw.name && !raw.del) return null;               // HB-11: nameless living garbage
    if (!(typeof raw.mtime === "number" && isFinite(raw.mtime))) return null;
    var per = normPer(raw.per);
    var h = {
      id: raw.id,
      name: raw.name.slice(0, NAME_LEN),
      icon: ICON_KEYS.indexOf(raw.icon) !== -1 ? raw.icon : "check",
      color: COLORS.indexOf(raw.color) !== -1 ? raw.color : COLORS[0],
      days: per ? [] : normDays(raw.days),
      mtime: raw.mtime,
      del: !!raw.del
    };
    var num = normNum(raw.num);
    if (num) h.num = num;
    if (per) h.per = per;
    if (isInt(raw.rem) && raw.rem >= 0 && raw.rem <= 1439) h.rem = raw.rem;
    return h;
  }
  function normShares(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    var keys = Object.keys(v).filter(function (k) {
      var e = v[k];
      return DEV_RE.test(k) && Array.isArray(e) && numOk(e[0]) && stampOk(e[1]);
    }).sort(cmpStr);
    if (!keys.length) return null;
    var out = {};
    keys.forEach(function (k) { out[k] = [round2(v[k][0]), v[k][1]]; });
    return out;
  }
  function normComp(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !raw.id) return null;
    if (typeof raw.habitId !== "string" || !raw.habitId) return null;
    if (!(typeof raw.date === "string" && YMD_RE.test(raw.date))) return null;
    if (!(typeof raw.mtime === "number" && isFinite(raw.mtime))) return null;
    var c = { id: raw.id, habitId: raw.habitId, date: raw.date, mtime: raw.mtime, del: !!raw.del };
    var v = normShares(raw.v);
    if (v) c.v = v;
    if (Array.isArray(raw.sk) && stampOk(raw.sk[1])) c.sk = [raw.sk[0] === 1 ? 1 : 0, raw.sk[1]];
    if (Array.isArray(raw.nt) && typeof raw.nt[0] === "string" && stampOk(raw.nt[1])) {
      c.nt = [raw.nt[0].replace(/\r\n?/g, "\n").trim().slice(0, NOTE_LEN), raw.nt[1]];
    }
    return c;
  }
  function normSet(x) {
    if (!x || typeof x !== "object" || !stampOk(x.m)) return null;
    return {
      st: x.st === 0 ? 0 : 1,
      sg: isInt(x.sg) && x.sg >= 100 && x.sg <= 200000 ? x.sg : STEPS_GOAL,
      m: x.m
    };
  }

  // ---------- local load (fills defaults for rows of older shape) ----------
  function normalize(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (!Array.isArray(obj.habits) || !Array.isArray(obj.comps)) return null;
    var seenH = {}, habits = [], seenC = {}, comps = [];
    obj.habits.forEach(function (raw) {
      if (!raw || typeof raw !== "object") return;
      var x = Object.assign({}, raw);
      if (typeof x.id !== "string" || !x.id) x.id = uid();
      if (typeof x.name !== "string") x.name = "";
      if (!(typeof x.mtime === "number" && isFinite(x.mtime))) x.mtime = Date.now();
      var h = normHabit(x);
      if (!h || seenH[h.id]) return;
      seenH[h.id] = true;
      habits.push(h);
    });
    obj.comps.forEach(function (raw) {
      if (!raw || typeof raw !== "object") return;
      var x = Object.assign({}, raw);
      if (!(typeof x.mtime === "number" && isFinite(x.mtime))) x.mtime = Date.now();
      var c = normComp(x);
      if (!c || seenC[c.id]) return;
      seenC[c.id] = true;
      comps.push(c);
    });
    var out = { ver: DATA_VER, habits: habits, comps: comps };
    var set = normSet(obj.set);
    if (set) out.set = set;
    return out;
  }

  // ---------- merge ----------
  function jsonGE(a, b) { return JSON.stringify(a) >= JSON.stringify(b); }
  function pickHabit(l, r) {
    if (l.mtime !== r.mtime) return l.mtime > r.mtime ? l : r;
    if (l.del !== r.del) return l.del ? l : r;          // tie → tombstone
    // a device on an older version drops num / per / rem but keeps the
    // stamp: at equal stamps the richer row wins (removing a field on
    // purpose always moves the stamp)
    var kl = Object.keys(l).length, kr = Object.keys(r).length;
    if (kl !== kr) return kl > kr ? l : r;
    return jsonGE(l, r) ? l : r;                       // HB-10
  }
  function pickStamp(a, b) {                           // [value, m] pairs
    if (!a) return b;
    if (!b) return a;
    if (a[1] !== b[1]) return a[1] > b[1] ? a : b;
    return jsonGE(a, b) ? a : b;
  }
  function mergeComp(l, r) {
    var tick = l.mtime !== r.mtime ? (l.mtime > r.mtime ? l : r) : (l.del !== r.del ? (l.del ? l : r) : l);
    var c = { id: l.id, habitId: l.habitId, date: l.date, mtime: tick.mtime, del: tick.del };
    var v = {}, any = false, keys = {};
    [l.v, r.v].forEach(function (s) { if (s) Object.keys(s).forEach(function (k) { keys[k] = 1; }); });
    Object.keys(keys).sort(cmpStr).forEach(function (k) {
      v[k] = pickStamp(l.v && l.v[k], r.v && r.v[k]);
      any = true;
    });
    if (any) c.v = v;
    var sk = pickStamp(l.sk, r.sk);
    if (sk) c.sk = sk;
    var nt = pickStamp(l.nt, r.nt);
    if (nt) c.nt = nt;
    return c;
  }
  function mergeRows(localArr, remoteArr, norm, combine) {
    var map = {};
    [remoteArr, localArr].forEach(function (arr) {
      (Array.isArray(arr) ? arr : []).forEach(function (raw) {
        var x = norm(raw);
        if (!x) return;
        map[x.id] = map[x.id] ? combine(x, map[x.id]) : x;
      });
    });
    return Object.keys(map).sort(cmpStr).map(function (k) { return map[k]; });
  }
  function mergeData(local, remote) {
    if (!local || !remote) return remote || local || null;
    var out = {
      ver: Math.max(local.ver || 1, remote.ver || 1, DATA_VER),
      habits: mergeRows(local.habits, remote.habits, normHabit, pickHabit),
      comps: mergeRows(local.comps, remote.comps, normComp, mergeComp)
    };
    var sl = normSet(local.set), sr = normSet(remote.set);
    var set = sl && sr ? (sl.m !== sr.m ? (sl.m > sr.m ? sl : sr) : (jsonGE(sl, sr) ? sl : sr)) : (sl || sr);
    if (set) out.set = set;
    return canon(out);
  }

  // ---------- canonical form ----------
  function compStamp(c) {
    var m = c.mtime;
    if (c.v) for (var k in c.v) if (c.v[k][1] > m) m = c.v[k][1];
    if (c.sk && c.sk[1] > m) m = c.sk[1];
    if (c.nt && c.nt[1] > m) m = c.nt[1];
    return m;
  }
  function compEmpty(c) {
    return c.del && !c.v && !(c.sk && c.sk[0] === 1) && !(c.nt && c.nt[0]);
  }
  function byId(a, b) { return cmpStr(a.id, b.id); }
  function canon(d) {
    var hs = (d.habits || []).slice().sort(byId);
    var cs = (d.comps || []).slice().sort(byId);
    var maxM = 0, i;
    for (i = 0; i < cs.length; i++) { var st = compStamp(cs[i]); if (st > maxM) maxM = st; }
    var cutoff = maxM - PRUNE_MS, comps = [];
    for (i = 0; i < cs.length; i++) {
      if (compEmpty(cs[i]) && compStamp(cs[i]) < cutoff) continue;
      comps.push(cs[i]);
    }
    var out = { ver: d.ver || DATA_VER, habits: hs, comps: comps };
    if (d.set) out.set = d.set;
    return JSON.parse(JSON.stringify(out));
  }

  // ---------- writes (on the live db; the caller saves) ----------
  function nextStamp(old, now) { return Math.max(now, (old || 0) + 1); }
  function compFor(db, habitId, ymd) {
    var id = habitId + "|" + ymd;
    for (var i = 0; i < db.comps.length; i++) if (db.comps[i].id === id) return db.comps[i];
    var c = { id: id, habitId: habitId, date: ymd, mtime: 0, del: true };
    db.comps.push(c);
    return c;
  }
  // yes / no tick; done=true/false sets, undefined toggles
  function setTick(db, habitId, ymd, done, now) {
    var c = compFor(db, habitId, ymd);
    var want = done === undefined ? c.del : !!done;
    if (want === !c.del) return c;
    c.del = !want;
    c.mtime = nextStamp(c.mtime, now);
    if (want && c.sk && c.sk[0] === 1) c.sk = [0, nextStamp(c.sk[1], now)];   // done un-skips
    return c;
  }
  function othersSum(c, dev) {
    var s = 0;
    if (c.v) for (var k in c.v) if (k !== dev) s += c.v[k][0];
    return s;
  }
  // set the day's total: this device's share becomes total − others
  function setValue(db, habitId, ymd, dev, total, now) {
    if (!DEV_RE.test(dev) || !numOk(total)) return null;
    var c = compFor(db, habitId, ymd);
    var own = round2(total - othersSum(c, dev));
    var old = c.v && c.v[dev];
    if (old && old[0] === own) return c;
    if (!c.v) c.v = {};
    c.v[dev] = [own, nextStamp(old && old[1], now)];
    var sorted = {};
    Object.keys(c.v).sort(cmpStr).forEach(function (k) { sorted[k] = c.v[k]; });
    c.v = sorted;
    return c;
  }
  function addValue(db, habitId, ymd, dev, delta, now) {
    var c = compFor(db, habitId, ymd);
    var cur = 0;
    if (c.v) for (var k in c.v) cur += c.v[k][0];
    return setValue(db, habitId, ymd, dev, Math.max(0, round2(cur + delta)), now);
  }
  function setSkip(db, habitId, ymd, on, now) {
    var c = compFor(db, habitId, ymd);
    var cur = c.sk && c.sk[0] === 1;
    if (cur === !!on) return c;
    c.sk = [on ? 1 : 0, nextStamp(c.sk && c.sk[1], now)];
    if (on && !c.del) { c.del = true; c.mtime = nextStamp(c.mtime, now); }   // a skip un-ticks
    return c;
  }
  function setNote(db, habitId, ymd, text, now) {
    var t = typeof text === "string" ? text.replace(/\r\n?/g, "\n").trim().slice(0, NOTE_LEN) : "";
    var c = compFor(db, habitId, ymd);
    var cur = c.nt ? c.nt[0] : "";
    if (cur === t) return c;
    c.nt = [t, nextStamp(c.nt && c.nt[1], now)];
    return c;
  }
  function setSettings(db, patch, now) {
    var cur = db.set || { st: 1, sg: STEPS_GOAL, m: 0 };
    var next = { st: "st" in patch ? (patch.st ? 1 : 0) : cur.st,
                 sg: "sg" in patch ? patch.sg : cur.sg, m: nextStamp(cur.m, now) };
    next = normSet(next);
    if (next && (next.st !== cur.st || next.sg !== cur.sg || !db.set)) db.set = next;
    return db.set;
  }
  function settingsOf(d) { return normSet(d && d.set) || { st: 1, sg: STEPS_GOAL, m: 0 }; }

  var API = {
    DATA_VER: DATA_VER, COLORS: COLORS, ICON_KEYS: ICON_KEYS, STEPS_GOAL: STEPS_GOAL,
    NOTE_LEN: NOTE_LEN, UNIT_LEN: UNIT_LEN, MAX_NUM: MAX_NUM, DEV_RE: DEV_RE,
    uid: uid, asNew: asNew, normHabit: normHabit, normComp: normComp, normSet: normSet, normNum: normNum, normPer: normPer,
    normalize: normalize, mergeData: mergeData, mergeComp: mergeComp, canon: canon,
    compFor: compFor, setTick: setTick, setValue: setValue, addValue: addValue,
    setSkip: setSkip, setNote: setNote, setSettings: setSettings, settingsOf: settingsOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosHabitsModel = API;
})(typeof window !== "undefined" ? window : globalThis);
