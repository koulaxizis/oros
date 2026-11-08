// ============================================================
// orOS To-Do — Today provider (v1.1.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-todo-data, never writes. What is due is
// todo/core.js (openDue), the same the shell reminder and the
// Calendar feed use. Rows: open tasks that are late, due today or due
// in the next days, with their list. Each row offers "Done", which
// opens To-Do and ticks the task there with the app's own tick (Undo
// in To-Do); Today itself never writes. Opens the task through To-Do's
// own deep link (__orosOpenAt: { list, item }).
// 1.1.0 (BR-TODAY-15): details (priority, steps, the note's first
// line), a tip for a task late a week or more, and "Tomorrow" for what
// is late or due today: To-Do's receiver { later: { list, item } }
// moves it with Undo.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-todo-data";

  // Details and suggestions (BR-TODAY-15): plain words of this file,
  // a pack language through orosI18n (i18n/<lang>/todo.js keys "td.*").
  var W = {
    en: { "td.prio": "Priority P{n}", "td.subs": "{d} of {n} steps done",
          "td.tipLate": "Late more than a week: give it a new date, or drop it if it no longer matters.",
          "td.tipSubs": "Start with the next open step: one small step makes the rest easier." },
    el: { "td.prio": "Προτεραιότητα P{n}", "td.subs": "{d} από {n} βήματα έγιναν",
          "td.tipLate": "Καθυστερεί πάνω από μια εβδομάδα: δώσ' της νέα ημερομηνία ή σβήσ' τη αν δεν μετράει πια.",
          "td.tipSubs": "Ξεκίνα από το επόμενο ανοιχτό βήμα: ένα μικρό βήμα κάνει τα υπόλοιπα πιο εύκολα." }
  };
  function words(lang) {
    var I = root.orosI18n;
    if (I && lang && !W[lang]) I.table(W, "todo", lang);
    return W[lang] || W.en;
  }
  function firstLine(s) {
    return typeof s === "string" ? s.split(/\r?\n/).filter(function (x) { return x.trim(); })[0] || "" : "";
  }

  var PROVIDER = {
    id: "todo",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosTodoCore, raw = ctx.readJSON(KEY);
      if (!C || !raw) return [];
      var w = words(ctx.lang);
      var last = ctx.addDays(ctx.today, ctx.horizon);
      return C.openDue(raw).filter(function (x) { return x.item.due <= last; }).map(function (x) {
        var it = x.item, more = [], tip = "", acts = [];
        var p = it.prio;
        if (p === 1 || p === 2 || p === 3) more.push(w["td.prio"].replace("{n}", p));
        var subs = Array.isArray(it.subs) ? it.subs.filter(function (s) { return s && typeof s === "object"; }) : [];
        var sd = subs.filter(function (s) { return s.done; }).length;
        if (subs.length) more.push(w["td.subs"].replace("{d}", sd).replace("{n}", subs.length));
        var note = firstLine(it.notes);
        if (note) more.push(note);
        var late = ctx.diff(it.due, ctx.today);          // > 0: days late
        if (late >= 7) tip = w["td.tipLate"];
        else if (subs.length && sd < subs.length && late >= 0) tip = w["td.tipSubs"];
        // "Tomorrow" for what is late or due today (To-Do moves it, with Undo)
        if (late >= 0) acts.push({ k: "later", target: { later: { list: x.list.id, item: it.id } } });
        return {
          id: x.list.id + "/" + it.id,
          due: it.due,
          title: typeof it.text === "string" ? it.text : "",
          text: typeof x.list.name === "string" ? x.list.name : "",
          kind: "task",
          target: { list: x.list.id, item: it.id },
          done: { list: x.list.id, item: it.id },
          more: more, tip: tip, acts: acts
        };
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
