// ============================================================
// orOS Mood — vocab.js (pure logic, no DOM) — wave 30
// Custom feelings and activities, goals, year in pixels.
// Loaded by mood/index.html BEFORE mood.js and by the tests
// (tests/mood-vocab.test.js) through module.exports.
//
// Data (optional top-level keys of oros-mood-data, written only
// once the user customises something — an untouched install keeps
// the exact old shape, so devices still on the previous mood.js
// never see a new key they would drop on every merge):
//   vocab: {
//     emo: [def], act: [def],        // per item, LWW by mtime
//     eo: {ids, m}, ao: {ids, m},    // order of each list, LWW by m
//     rs?: ms                        // factory reset: older items gone
//   }
//   def  = { id, mtime, lab?, no?, ic?, col?, hid?, pos? }
//     id   built-in key ("happy", "water", …) or "c-" + uid (custom)
//     lab  label (built-in: overrides the translation; habits: the
//          "yes" side), no = the "no" side of a built-in habit pair
//     ic   emoji (a short string), col = "#rrggbb" (custom feelings)
//     hid  hidden from Capture (entries keep it; stats still count)
//     pos  custom feeling counts as positive (momentum, recap)
//   goals: [ { id, act, n, per: "w"|"m", mtime, x? } ]
//     act = built-in habit field or custom activity id; x = deleted
//     (soft delete keeps the item, so a stale copy can never bring
//     it back; LWW by mtime)
// Entries gain an optional `acts: [customActivityId]` (sorted).
// Nothing is ever removed from the vocabulary: a feeling or an
// activity can only be hidden, so old entries keep their meaning.
// ============================================================
(function (root) {
  "use strict";

  var LAB_MAX = 40;
  var IC_MAX = 16;                 // a few code units: one emoji, flags, ZWJ
  var GOALS_MAX = 24;
  var COL_RE = /^#[0-9a-f]{6}$/i;
  var ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
  var CUSTOM_COLORS = ["#87cf3e", "#51a2da", "#8c5ec7", "#e0a44c", "#e06c75",
                       "#ff7043", "#26a69a", "#ec6fb4", "#9aa0ae"];

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function cmpStr(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function str(v, max) {
    if (typeof v !== "string") return "";
    v = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    try { v = v.normalize("NFC"); } catch (e) {}
    return Array.from(v).slice(0, max).join("");
  }
  // An icon is one short, non-letter, non-markup string (an emoji).
  function cleanIcon(v) {
    var s = str(v, 8);
    if (!s || s.length > IC_MAX) return "";
    if (/[<>&"'`\\]/.test(s)) return "";
    return s;
  }

  // ---------- definitions ----------
  function normDef(d) {
    if (!d || typeof d !== "object" || typeof d.id !== "string" || !ID_RE.test(d.id)) return null;
    var o = { id: d.id, mtime: isNum(d.mtime) && d.mtime > 0 ? Math.floor(d.mtime) : 0 };
    var lab = str(d.lab, LAB_MAX); if (lab) o.lab = lab;
    var no = str(d.no, LAB_MAX); if (no) o.no = no;
    var ic = cleanIcon(d.ic); if (ic) o.ic = ic;
    if (typeof d.col === "string" && COL_RE.test(d.col)) o.col = d.col.toLowerCase();
    if (d.hid === true) o.hid = true;
    if (d.pos === true) o.pos = true;
    return o;
  }
  function isCustomId(id) { return typeof id === "string" && /^c-[a-z0-9]{4,30}$/.test(id); }

  function newer(a, b) {
    if (a.mtime !== b.mtime) return a.mtime > b.mtime ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;        // same pick on both sides
  }
  // Union by id, newest version wins; canonical order = id order.
  function mergeDefs(A, B) {
    var map = {};
    [A, B].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (raw) {
        var d = normDef(raw);
        if (!d) return;
        map[d.id] = map[d.id] ? newer(map[d.id], d) : d;
      });
    });
    return Object.keys(map).sort(cmpStr).map(function (k) { return map[k]; });
  }
  function normOrd(o) {
    if (!o || typeof o !== "object" || !Array.isArray(o.ids)) return null;
    var seen = {}, ids = [];
    o.ids.forEach(function (id) {
      if (typeof id === "string" && ID_RE.test(id) && !seen[id]) { seen[id] = 1; ids.push(id); }
    });
    return { ids: ids, m: isNum(o.m) && o.m > 0 ? Math.floor(o.m) : 0 };
  }
  function mergeOrd(A, B) {
    var a = normOrd(A), b = normOrd(B);
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  // The whole vocabulary; null when there is nothing to keep (an
  // untouched install never grows the key).
  // rs = the factory reset's time: every definition and order made at
  // or before it is gone on every device (max of both sides).
  function mergeVocab(A, B) {
    var a = A && typeof A === "object" ? A : {}, b = B && typeof B === "object" ? B : {};
    var out = {}, any = false;
    var rs = Math.max(isNum(a.rs) && a.rs > 0 ? Math.floor(a.rs) : 0, isNum(b.rs) && b.rs > 0 ? Math.floor(b.rs) : 0);
    var after = function (d) { return d.mtime > rs; };
    var emo = mergeDefs(a.emo, b.emo).filter(after), act = mergeDefs(a.act, b.act).filter(after);
    if (emo.length) { out.emo = emo; any = true; }
    if (act.length) { out.act = act; any = true; }
    var eo = mergeOrd(a.eo, b.eo), ao = mergeOrd(a.ao, b.ao);
    if (eo && eo.m > rs) { out.eo = eo; any = true; }
    if (ao && ao.m > rs) { out.ao = ao; any = true; }
    if (rs) { out.rs = rs; any = true; }
    return any ? out : null;
  }
  function defMap(list) {
    var m = {};
    (list || []).forEach(function (d) { if (d && d.id) m[d.id] = d; });
    return m;
  }

  // Display order of a list: the saved order first (only ids that
  // exist), then built-ins not in it (their default order), then
  // custom items not in it (by id: ids start with the time).
  function orderIds(builtinIds, defs, ord) {
    var known = {}, out = [], seen = {};
    builtinIds.forEach(function (id) { known[id] = 1; });
    (defs || []).forEach(function (d) { if (d && isCustomId(d.id)) known[d.id] = 1; });
    ((ord && ord.ids) || []).forEach(function (id) {
      if (known[id] && !seen[id]) { seen[id] = 1; out.push(id); }
    });
    builtinIds.forEach(function (id) { if (!seen[id]) { seen[id] = 1; out.push(id); } });
    (defs || []).map(function (d) { return d && d.id; }).filter(function (id) {
      return isCustomId(id) && !seen[id];
    }).sort(cmpStr).forEach(function (id) { seen[id] = 1; out.push(id); });
    return out;
  }
  // Move one id up (-1) or down (+1) in an order; returns a new array.
  function moveId(ids, id, d) {
    var a = ids.slice(), i = a.indexOf(id), j = i + d;
    if (i < 0 || j < 0 || j >= a.length) return a;
    a[i] = a[j]; a[j] = id;
    return a;
  }

  // ---------- goals ----------
  function normGoal(g) {
    if (!g || typeof g !== "object" || typeof g.id !== "string" || !ID_RE.test(g.id)) return null;
    if (typeof g.act !== "string" || !ID_RE.test(g.act)) return null;
    var per = g.per === "m" ? "m" : "w";
    var n = isNum(g.n) ? Math.round(g.n) : 1;
    n = Math.max(1, Math.min(per === "m" ? 31 : 7, n));
    var o = { id: g.id, act: g.act, n: n, per: per, mtime: isNum(g.mtime) && g.mtime > 0 ? Math.floor(g.mtime) : 0 };
    if (g.x === true || g.x === 1) o.x = 1;
    return o;
  }
  function mergeGoals(A, B) {
    var map = {};
    [A, B].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (raw) {
        var g = normGoal(raw);
        if (!g) return;
        map[g.id] = map[g.id] ? newer(map[g.id], g) : g;
      });
    });
    var out = Object.keys(map).sort(cmpStr).map(function (k) { return map[k]; });
    return out.length ? out : null;
  }
  function liveGoals(list) { return (list || []).filter(function (g) { return g && !g.x; }); }

  // ---------- days ----------
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }
  // The period a goal counts in, as local day keys [from, to].
  // Weeks start on Monday.
  function periodOf(per, now, back) {
    var d = new Date(now);
    d.setHours(12, 0, 0, 0);
    back = back || 0;
    if (per === "m") {
      var f = new Date(d.getFullYear(), d.getMonth() - back, 1, 12);
      var l = new Date(f.getFullYear(), f.getMonth() + 1, 0, 12);
      return { from: dayKey(f.getTime()), to: dayKey(l.getTime()), days: l.getDate() };
    }
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * back);
    var e = new Date(d.getTime()); e.setDate(e.getDate() + 6);
    return { from: dayKey(d.getTime()), to: dayKey(e.getTime()), days: 7 };
  }
  // Did this entry mark the activity? Built-in habit: "yes";
  // custom activity: listed in acts.
  function marks(e, act) {
    if (!e) return false;
    if (isCustomId(act)) return Array.isArray(e.acts) && e.acts.indexOf(act) >= 0;
    return e[act] === "yes";
  }
  // Distinct days with the activity in one period.
  function countIn(entries, act, from, to) {
    var days = {};
    (entries || []).forEach(function (e) {
      if (!e || !isNum(e.ts) || !marks(e, act)) return;
      var k = dayKey(e.ts);
      if (k >= from && k <= to) days[k] = 1;
    });
    return Object.keys(days).length;
  }
  // Progress of a goal now, plus how many of the `hist` periods before
  // this one reached it.
  function goalProgress(entries, goal, now, hist) {
    var g = normGoal(goal);
    if (!g) return null;
    var p = periodOf(g.per, now, 0);
    var done = countIn(entries, g.act, p.from, p.to);
    var met = 0, past = [];
    for (var i = 1; i <= (hist || 0); i++) {
      var q = periodOf(g.per, now, i), c = countIn(entries, g.act, q.from, q.to);
      past.push(c);
      if (c >= g.n) met++;
    }
    return { done: done, n: g.n, ok: done >= g.n, from: p.from, to: p.to,
             pct: Math.min(100, Math.round(done / g.n * 100)), met: met, past: past };
  }

  // ---------- year in pixels ----------
  // One colour per day: the strongest feeling of the day (tie → the
  // first one met, entries newest first). { "YYYY-MM-DD": {k, i} }
  function yearPixels(entries, year) {
    var out = {}, pre = String(year) + "-";
    (entries || []).forEach(function (e) {
      if (!e || !isNum(e.ts)) return;
      var k = dayKey(e.ts);
      if (k.indexOf(pre) !== 0) return;
      (Array.isArray(e.emotions) ? e.emotions : []).forEach(function (m) {
        if (!m || typeof m.k !== "string") return;
        var i = isNum(m.i) ? m.i : 0;
        if (!out[k] || i > out[k].i) out[k] = { k: m.k, i: i };
      });
    });
    return out;
  }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysIn(y, m) { return new Date(y, m, 0).getDate(); }      // m 1-12
  function yearsWithData(entries, thisYear) {
    var seen = {};
    seen[thisYear] = 1;
    (entries || []).forEach(function (e) { if (e && isNum(e.ts)) seen[new Date(e.ts).getFullYear()] = 1; });
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  }

  // Entries' custom activities, sorted, without duplicates; null when none.
  function normActs(v) {
    if (!Array.isArray(v)) return null;
    var seen = {}, out = [];
    v.forEach(function (id) { if (isCustomId(id) && !seen[id]) { seen[id] = 1; out.push(id); } });
    out.sort(cmpStr);
    return out.length ? out : null;
  }

  var API = {
    LAB_MAX: LAB_MAX, GOALS_MAX: GOALS_MAX, CUSTOM_COLORS: CUSTOM_COLORS.slice(),
    str: str, cleanIcon: cleanIcon, normDef: normDef, isCustomId: isCustomId,
    mergeDefs: mergeDefs, normOrd: normOrd, mergeOrd: mergeOrd, mergeVocab: mergeVocab,
    defMap: defMap, orderIds: orderIds, moveId: moveId,
    normGoal: normGoal, mergeGoals: mergeGoals, liveGoals: liveGoals,
    dayKey: dayKey, periodOf: periodOf, marks: marks, countIn: countIn, goalProgress: goalProgress,
    yearPixels: yearPixels, isLeap: isLeap, daysIn: daysIn, yearsWithData: yearsWithData,
    normActs: normActs
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosMoodVocab = API;
})(typeof window !== "undefined" ? window : globalThis);
