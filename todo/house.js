// ============================================================
// orOS To-Do — lists shared with a household (pure, no DOM; BR-HH)
// A shared list lives in a household document (household/engine.js),
// never in "oros-todo-data": todo.js builds it into its state as a
// list with the id "tdh-<document id>" and hands every edit back as
// plain changes. Personal parts stay out of the household: labels
// (each person has their own), and the stamps todo.js keeps for its
// own merge (the household merge stamps field by field itself).
//   project(list)       → { m: { t, rec, last, next }, items: { id: fields } }
//   build(view, docId, keep) → a todo.js list (keep: the list now on
//                          screen, whose labels stay on its tasks)
//   copyOf(view, docId) → a personal list "tdc-<document id>" with the
//                          same task ids and stamps, so every device of
//                          the person makes the very same copy
// Fields of a task: text, done, due, notes, info, recurrence, prio,
// subs, o (its place in the list). Absent values are null, so a list
// built from a document projects back to exactly that document
// (no endless uploads).
// Exposes window.OrosTodoHouse and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var PREFIX = "tdh-", COPY = "tdc-";
  var FIELDS = ["text", "done", "due", "notes", "info", "recurrence", "prio", "subs", "o"];
  var YMD = /^\d{4}-\d{2}-\d{2}$/;

  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function cleanInfo(a) {
    return (Array.isArray(a) ? a : []).slice(0, 30).filter(function (f) { return f && typeof f === "object"; })
      .map(function (f) { return { label: str(f.label, 100), value: str(f.value, 1000) }; });
  }
  function cleanRec(r) {
    if (!r || typeof r !== "object" || ["day", "week", "month"].indexOf(r.unit) < 0) return null;
    var out = { every: Math.max(1, Math.min(365, Math.floor(+r.every) || 1)), unit: r.unit };
    if (typeof r.weekday === "number" && r.weekday >= 0 && r.weekday <= 6) out.weekday = Math.floor(r.weekday);
    if (r.after === true) out.after = true;
    return out;
  }
  function cleanSubs(a) {
    if (!Array.isArray(a) || !a.length) return null;
    var out = [], seen = {};
    a.slice(0, 100).forEach(function (s) {
      if (!s || typeof s.id !== "string" || !s.id || seen[s.id]) return;
      seen[s.id] = 1;
      out.push({ id: s.id.slice(0, 40), text: str(s.text, 300).replace(/[\u0000-\u001f\u007f]/g, " "), done: !!s.done, mtime: typeof s.mtime === "number" && isFinite(s.mtime) ? s.mtime : 0 });
    });
    return out.length ? out : null;
  }
  function fieldsOf(it, i) {
    return {
      text: str(it.text, 1000),
      done: it.done === true,
      due: typeof it.due === "string" && YMD.test(it.due) ? it.due : null,
      notes: str(it.notes, 20000) || null,
      info: cleanInfo(it.info).length ? cleanInfo(it.info) : null,
      recurrence: cleanRec(it.recurrence),
      prio: it.prio === 1 || it.prio === 2 || it.prio === 3 ? it.prio : null,
      subs: cleanSubs(it.subs),
      o: i
    };
  }

  function project(list) {
    var items = {};
    (list.items || []).forEach(function (it, i) {
      if (it && typeof it.id === "string" && /^[A-Za-z0-9_:-]{1,72}$/.test(it.id)) items[it.id] = fieldsOf(it, i);
    });
    return {
      m: { t: str(list.name, 80), rec: cleanRec(list.recurrence),
           last: typeof list.lastReset === "string" && YMD.test(list.lastReset) ? list.lastReset : null,
           next: typeof list.nextReset === "string" && YMD.test(list.nextReset) ? list.nextReset : null },
      items: items
    };
  }

  function taskOf(v, i, keepItem) {
    var f = fieldsOf(v, i), t = v._t || 0;
    var it = { id: v.id, text: f.text, done: f.done, due: f.due, notes: f.notes || "",
               labels: keepItem && Array.isArray(keepItem.labels) ? keepItem.labels.slice() : [],
               info: f.info || [], recurrence: f.recurrence, mtime: t, om: 0, pos: i,
               fm: { text: t, done: t, due: t, notes: t, labels: t, info: t, recurrence: t } };
    if (f.prio) it.prio = f.prio;
    if (f.subs) it.subs = f.subs;
    return it;
  }
  function headOf(view, id, items) {
    var m = view.m || {}, t = 0;
    items.forEach(function (it) { if (it.mtime > t) t = it.mtime; });
    return { id: id, name: str(m.t, 80) || "?", mtime: t, om: 0, pos: 0,
             recurrence: cleanRec(m.rec), lastReset: typeof m.last === "string" && YMD.test(m.last) ? m.last : null,
             nextReset: typeof m.next === "string" && YMD.test(m.next) ? m.next : null,
             items: items, fm: { name: t, cycle: t } };
  }
  function build(view, docId, keep) {
    var old = {};
    ((keep && keep.items) || []).forEach(function (it) { old[it.id] = it; });
    var items = (view.items || []).map(function (v, i) {
      var it = taskOf(v, i, old[v.id]);
      it.hhBy = typeof v._by === "string" ? v._by : "";
      return it;
    });
    return headOf(view, PREFIX + docId, items);
  }
  function copyOf(view, docId) {
    var items = (view.items || []).map(function (v, i) { return taskOf(v, i, null); });
    return headOf(view, COPY + docId, items);
  }
  function isShared(id) { return typeof id === "string" && id.indexOf(PREFIX) === 0; }
  function docOf(id) { return isShared(id) ? id.slice(PREFIX.length) : ""; }

  var api = { PREFIX: PREFIX, COPY: COPY, FIELDS: FIELDS, project: project, build: build, copyOf: copyOf, isShared: isShared, docOf: docOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosTodoHouse = api;
})(typeof window !== "undefined" ? window : globalThis);
