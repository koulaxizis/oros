// ============================================================
// orOS To-Do — pure model helpers (todo/model.js, v1.0.0)
// Wave "closer to Todoist": priorities, subtasks, smart lists, saved
// filters, sorting, "repeat after completion", moved-task merge.
// Pure: no DOM, no storage, never writes. todo/todo.js uses it; the
// tests load it with require (tests/todo-model.test.js).
//   prioOf(it)                   → 1..4 (P1 highest; absent = 4, none)
//   cleanSubs(arr)               → canonical subtasks [{ id, text, done, mtime }]
//   subCount(it)                 → { done, total }
//   mergeSubs(a, b, sa, sb)      → one subtask list: union by id, each
//                                  subtask from the side with the newer
//                                  mtime; order from the side with the
//                                  newer order stamp (sa / sb = xf.so)
//   dropDeadSubs(subs, tomb)     → without the tombstoned subtasks
//   dedupeMoved(lists, merge)    → a task found in several lists (moved
//                                  on one device, still in the old list
//                                  on another) stays only where it was
//                                  moved last (xf.list), content merged
//   SMART, smartMatch(id, it, today)
//   cleanFilter(f), filterMatch(f, it, ctx)
//   textMatch(it, q, labelName)  → search over text, notes, info,
//                                  label names and subtasks
//   sortRows(rows, mode)         → rows [{ item, list, i }] sorted
//   addDaysISO(iso, n), nextAfterDone(todayIso, rec)
// Exposes window.OrosTodoModel and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  var SUB_MAX = 100, SUB_TEXT = 300;

  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // ---------- Priority ----------
  function prioOf(it) {
    var p = it && it.prio;
    return (p === 1 || p === 2 || p === 3) ? p : 4;
  }

  // ---------- Subtasks ----------
  function cleanSub(s) {
    if (!isObj(s) || typeof s.id !== "string" || !s.id) return null;
    var text = typeof s.text === "string" ? s.text.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, SUB_TEXT) : "";
    return { id: s.id, text: text, done: !!s.done, mtime: num(s.mtime) };
  }
  function cleanSubs(arr) {
    var out = [], seen = {};
    (Array.isArray(arr) ? arr : []).forEach(function (s) {
      var c = cleanSub(s);
      if (!c || seen[c.id] || out.length >= SUB_MAX) return;
      seen[c.id] = 1;
      out.push(c);
    });
    return out;
  }
  function subCount(it) {
    var subs = it && Array.isArray(it.subs) ? it.subs : [], d = 0;
    subs.forEach(function (s) { if (s && s.done) d++; });
    return { done: d, total: subs.length };
  }
  function newerSub(x, y) {
    if (x.mtime !== y.mtime) return x.mtime > y.mtime ? x : y;
    return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
  }
  // Order reference: the newer order stamp; tie → the id sequences
  // compared element by element (the same rule as todo.js pickRef), so
  // both devices pick the same side.
  function seqOf(arr) { return arr.map(function (s) { return s.id; }); }
  function pickSeq(a, b, sa, sb) {
    if (sa !== sb) return sa > sb ? a : b;
    var ka = seqOf(a), kb = seqOf(b), n = Math.min(ka.length, kb.length);
    for (var i = 0; i < n; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i] ? a : b;
    return ka.length >= kb.length ? a : b;
  }
  function mergeSubs(a, b, sa, sb) {
    a = cleanSubs(a); b = cleanSubs(b);
    var map = {};
    a.forEach(function (s) { map[s.id] = s; });
    b.forEach(function (s) { map[s.id] = map[s.id] ? newerSub(map[s.id], s) : s; });
    var ref = pickSeq(a, b, num(sa), num(sb)), idx = {};
    ref.forEach(function (s, i) { idx[s.id] = i; });
    var out = Object.keys(map).map(function (id) { return map[id]; });
    out.sort(function (x, y) {
      var ix = idx[x.id] !== undefined ? idx[x.id] : Infinity;
      var iy = idx[y.id] !== undefined ? idx[y.id] : Infinity;
      if (ix !== iy) return ix - iy;
      if (x.mtime !== y.mtime) return x.mtime - y.mtime;
      return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
    });
    return out.slice(0, SUB_MAX).map(function (s) { return { id: s.id, text: s.text, done: s.done, mtime: s.mtime }; });
  }
  function dropDeadSubs(subs, tomb) {
    tomb = tomb || {};
    return cleanSubs(subs).filter(function (s) { return tomb[s.id] === undefined || s.mtime > tomb[s.id]; });
  }

  // ---------- Moved tasks ----------
  // lists: merged lists (each with items). A task id in more than one
  // list: the copy with the newest move stamp (xf.list) names the list,
  // tie → the greater list id; every copy's content is merged
  // (merge(x, y) = todo.js mergeItem) in list-id order, so the result
  // is the same on both devices. Returns new list objects where needed.
  function moveStamp(it) { return it && isObj(it.xf) ? num(it.xf.list) : 0; }
  function dedupeMoved(lists, merge) {
    var where = {}, dup = false;
    lists.forEach(function (l, li) {
      (l.items || []).forEach(function (it) {
        if (!it || typeof it.id !== "string") return;
        if (where[it.id]) dup = true;
        (where[it.id] = where[it.id] || []).push({ li: li, list: l, item: it });
      });
    });
    if (!dup) return lists;
    var drop = {}, put = {};
    Object.keys(where).forEach(function (id) {
      var c = where[id];
      if (c.length < 2) return;
      c.sort(function (x, y) { return x.list.id < y.list.id ? -1 : (x.list.id > y.list.id ? 1 : 0); });
      var win = c[0], merged = c[0].item;
      for (var i = 1; i < c.length; i++) {
        var s = moveStamp(c[i].item), w = moveStamp(win.item);
        if (s > w || (s === w && c[i].list.id > win.list.id)) win = c[i];
        merged = merge(merged, c[i].item);
      }
      c.forEach(function (x) { if (x !== win) (drop[x.li] = drop[x.li] || {})[id] = 1; });
      (put[win.li] = put[win.li] || {})[id] = merged;
    });
    return lists.map(function (l, li) {
      if (!drop[li] && !put[li]) return l;
      var c = {};
      Object.keys(l).forEach(function (k) { c[k] = l[k]; });
      c.items = (l.items || []).filter(function (it) { return !(drop[li] && drop[li][it.id]); })
        .map(function (it) { return put[li] && put[li][it.id] ? put[li][it.id] : it; });
      c.items = c.items.map(function (it, i) {
        if (it.pos === i) return it;
        var x = {};
        Object.keys(it).forEach(function (k) { x[k] = it[k]; });
        x.pos = i;
        return x;
      });
      return c;
    });
  }

  // ---------- Dates ----------
  function isoToDate(iso) {
    var m = YMD.exec(iso || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function dateToISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDaysISO(iso, n) {
    var d = isoToDate(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + n);
    return dateToISO(d);
  }
  // "Repeat after completion": the next date counts from the day the
  // task was ticked, whatever its due date was.
  function nextAfterDone(todayIso, rec) {
    var d = isoToDate(todayIso), every = Math.max(1, Math.floor(num(rec && rec.every)) || 1);
    if (!d) return todayIso;
    if (rec.unit === "day") d.setDate(d.getDate() + every);
    else if (rec.unit === "month") {
      var day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + every);
      var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));                  // 31 Jan + 1 month → 28/29 Feb
    } else d.setDate(d.getDate() + 7 * every);
    return dateToISO(d);
  }

  // ---------- Smart lists ----------
  var SMART = ["today", "week", "nodate", "p1"];
  function validDue(it) { return typeof it.due === "string" && YMD.test(it.due) ? it.due : ""; }
  function smartMatch(id, it, today) {
    var due = validDue(it);
    if (id === "today") return !!due && due <= today;
    if (id === "week") return !!due && due <= addDaysISO(today, 6);
    if (id === "nodate") return !due;
    if (id === "p1") return prioOf(it) === 1;
    return false;
  }

  // ---------- Saved filters ----------
  var DUES = ["", "overdue", "today", "week", "month", "none", "range"];
  function cleanFilter(f) {
    if (!isObj(f) || typeof f.id !== "string" || !f.id) return null;
    var str = function (v, n) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n) : ""; };
    var labels = [], prios = [];
    (Array.isArray(f.labels) ? f.labels : []).forEach(function (x) {
      if (typeof x === "string" && x && labels.indexOf(x) < 0 && labels.length < 50) labels.push(x);
    });
    (Array.isArray(f.prios) ? f.prios : []).forEach(function (p) {
      if ((p === 1 || p === 2 || p === 3 || p === 4) && prios.indexOf(p) < 0) prios.push(p);
    });
    prios.sort();
    var due = DUES.indexOf(f.due) >= 0 ? f.due : "";
    var from = typeof f.from === "string" && YMD.test(f.from) ? f.from : "";
    var to = typeof f.to === "string" && YMD.test(f.to) ? f.to : "";
    if (due !== "range") { from = ""; to = ""; }
    var out = { id: f.id, name: str(f.name, 40), labels: labels, prios: prios, due: due, from: from, to: to,
                text: str(f.text, 100), mtime: num(f.mtime), pos: num(f.pos) };
    if (typeof f.om === "number") out.om = f.om;
    return out;
  }
  function textMatch(it, q, labelName) {
    if (!q) return true;
    var has = function (s) { return typeof s === "string" && s.toLowerCase().indexOf(q) !== -1; };
    if (has(it.text) || has(it.notes)) return true;
    var info = Array.isArray(it.info) ? it.info : [];
    for (var i = 0; i < info.length; i++) if (info[i] && (has(info[i].label) || has(info[i].value))) return true;
    var lb = Array.isArray(it.labels) ? it.labels : [];
    for (var j = 0; j < lb.length; j++) if (labelName && has(labelName(lb[j]))) return true;
    var subs = Array.isArray(it.subs) ? it.subs : [];
    for (var k = 0; k < subs.length; k++) if (subs[k] && has(subs[k].text)) return true;
    return false;
  }
  // ctx: { today, labelName(id) }
  function filterMatch(f, it, ctx) {
    if (!f || !it) return false;
    if (f.labels && f.labels.length) {
      var lb = Array.isArray(it.labels) ? it.labels : [], any = false;
      for (var i = 0; i < f.labels.length; i++) if (lb.indexOf(f.labels[i]) !== -1) { any = true; break; }
      if (!any) return false;
    }
    if (f.prios && f.prios.length && f.prios.indexOf(prioOf(it)) === -1) return false;
    var due = validDue(it), today = ctx.today;
    switch (f.due) {
      case "overdue": if (!due || due >= today) return false; break;
      case "today": if (!due || due > today) return false; break;
      case "week": if (!due || due > addDaysISO(today, 6)) return false; break;
      case "month": if (!due || due > addDaysISO(today, 29)) return false; break;
      case "none": if (due) return false; break;
      case "range":
        if (!due) return false;
        if (f.from && due < f.from) return false;
        if (f.to && due > f.to) return false;
        break;
    }
    return textMatch(it, (f.text || "").toLowerCase(), ctx.labelName);
  }

  // ---------- Sorting ----------
  // mode: "manual" (stored order), "prio" (P1 first, then due date),
  // "due" (earliest first, no date last, then priority). Ticked tasks
  // go after the open ones in the sorted modes. Stable (row.i).
  function sortRows(rows, mode) {
    if (mode !== "prio" && mode !== "due") return rows.slice();
    var dueKey = function (it) { return validDue(it) || "9999-99-99"; };
    return rows.slice().sort(function (x, y) {
      var a = x.item, b = y.item;
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      var pa = prioOf(a), pb = prioOf(b), da = dueKey(a), db = dueKey(b);
      if (mode === "prio") {
        if (pa !== pb) return pa - pb;
        if (da !== db) return da < db ? -1 : 1;
      } else {
        if (da !== db) return da < db ? -1 : 1;
        if (pa !== pb) return pa - pb;
      }
      return x.i - y.i;
    });
  }

  var api = {
    SMART: SMART, DUES: DUES, SUB_MAX: SUB_MAX, SUB_TEXT: SUB_TEXT,
    prioOf: prioOf, cleanSubs: cleanSubs, subCount: subCount, mergeSubs: mergeSubs, dropDeadSubs: dropDeadSubs,
    dedupeMoved: dedupeMoved, addDaysISO: addDaysISO, nextAfterDone: nextAfterDone,
    smartMatch: smartMatch, cleanFilter: cleanFilter, filterMatch: filterMatch, textMatch: textMatch,
    sortRows: sortRows
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosTodoModel = api;
})(typeof window !== "undefined" ? window : globalThis);
