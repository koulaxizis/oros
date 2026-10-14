// ============================================================
// orOS Assistant — changes to existing records (wave 48)
// ------------------------------------------------------------
// Pure logic, no DOM, no storage: the change_item tool of the
// Assistant. assistant.js reads the app's stored JSON, asks this file
// what the change would be (plan → a before → after diff the user
// confirms), then asks it again for the new JSON (apply) and writes
// it. Unit-tested in node (tests/assistant-edits.test.js).
//
// Rules (OROS_BIBLE.md "Assistant", wave 48):
//   - Only records the user already shared in this conversation: a
//     change names a ref (r3) that search_data / app_summary gave.
//     The model never gets more data from a change than "done" or
//     "not done and why".
//   - Nothing changes without the user's own press of "Apply" on the
//     diff card, whatever the app's permission says ("Always share"
//     covers reading, never changing).
//   - The write follows the app's own sync contract, field by field:
//       todo      per-field stamps it.fm / it.xf + it.mtime (TD-3,
//                 TD-14), tombstones state.deleted { id: ts }, keys
//                 sorted (TD-4)
//       calendar  whole-event LWW on ev.mtime, tombstones
//                 deleted [{ id, mtime }]
//       budget    tx LWW on x.m, tombstones tombs["tx:<id>"], tx
//                 sorted by id, tombs sorted (canonical JSON)
//       bookmarks items LWW on it.modified, tombstones deleted {id: ts},
//                 keys sorted (BM-1)
//     Every stamp is max(now, old + 1), so the change wins the merge
//     on every device. The Assistant is the running app, so the app
//     whose data changes is closed (one app frame): what it stores is
//     what the sync engine's closed-app proxy pushes.
//   - Things only the app can do well stay in the app and are refused
//     here with a plain reason: ticking a repeating task (the app
//     works out its next date), moving or deleting a repeating event
//     (this occurrence or the whole series), a Budget entry with
//     receipts or a foreign-currency amount, a recurring Budget entry,
//     a bookmark with a saved copy on the disk.
//   - Undo (undo()) puts back only what the change changed, with fresh
//     stamps, and only while the record still looks as the change
//     left it.
// Exposed as window.OrosAssistEdits (module.exports in node).
// ============================================================
(function (root) {
  "use strict";

  var ACTIONS = ["complete", "reopen", "reschedule", "update", "delete"];
  var APPS = {
    todo:      { key: "oros-todo-data",      actions: ["complete", "reopen", "reschedule", "update", "delete"] },
    calendar:  { key: "oros-calendar-data",  actions: ["reschedule", "update", "delete"] },
    budget:    { key: "oros-budget-data",    actions: ["reschedule", "update", "delete"] },
    bookmarks: { key: "oros-bookmarks-data", actions: ["update", "delete"] }
  };
  var APP_IDS = ["todo", "calendar", "budget", "bookmarks"];
  // What each app's update may set (the tool's argument names).
  var SETTABLE = {
    todo:      { title: 1, date: 1, note: 1 },
    calendar:  { title: 1, date: 1, start: 1, end: 1, location: 1, note: 1 },
    budget:    { amount: 1, date: 1, category: 1, note: 1 },
    bookmarks: { title: 1, note: 1 }
  };
  // The diff's fields, in the order the card shows them.
  var VIEW_ORDER = ["title", "kind", "done", "amount", "date", "due", "start", "end", "category", "location", "url", "note"];
  // Budget's ready categories by the names the model knows (same
  // table as core.js BUDGET_CATS).
  var BUDGET_CATS = {
    o: { groceries: "o-groc", "eating-out": "o-eat", bills: "o-bills", home: "o-home", transport: "o-trans",
         health: "o-health", fun: "o-fun", clothes: "o-cloth", gift: "o-gift", other: "o-other" },
    i: { salary: "i-salary", freelance: "i-free", gift: "i-gift", other: "i-other" }
  };
  var CAT_NAMES = ["groceries", "eating-out", "bills", "home", "transport", "health", "fun", "clothes", "gift", "salary", "freelance", "other"];
  var MAX_CENTS = 100000000000;

  var CTRL = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g;
  var ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function line(v, max) { return typeof v === "string" ? v.replace(CTRL, " ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  function para(v, max) { return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(CTRL, " ").trim().slice(0, max) : ""; }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function realDate(s) {
    var m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim()) : null;
    if (!m) return "";
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : "";
  }
  function hm(s) {
    var m = typeof s === "string" ? /^(\d{1,2}):(\d{2})$/.exec(s.trim()) : null;
    if (!m || +m[1] > 23 || +m[2] > 59) return "";
    return (m[1].length < 2 ? "0" : "") + m[1] + ":" + m[2];
  }
  function mins(s) { return +s.slice(0, 2) * 60 + +s.slice(3, 5); }
  function fromMins(n) { var h = Math.floor(n / 60), m = n % 60; return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
  function dayNum(s) { var p = s.split("-"); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function dayStr(n) { var d = new Date(n * 86400000); return d.toISOString().slice(0, 10); }
  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : NaN;
    if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return parseFloat(v);
    return NaN;
  }
  function stampAfter(now, prev) { return Math.max(Math.floor(now) || 0, (typeof prev === "number" && isFinite(prev) ? prev : 0) + 1); }
  function sortedObj(o) {
    var out = {};
    Object.keys(o || {}).sort(cmpStr).forEach(function (k) { out[k] = o[k]; });
    return out;
  }
  function bad(msg) { return { ok: false, err: msg }; }

  // ---------- 1. The tool's arguments ----------
  // args = the model's change_item input → { ok, ref, action, set } |
  // { ok: false, err }. Only the shape is checked here; what the app
  // takes is checked by plan().
  function normArgs(args) {
    if (!isObj(args)) return bad("The arguments must be an object.");
    var ref = String(args.ref == null ? "" : args.ref).replace(/^oros:/, "").trim();
    if (!/^r\d{1,5}$/.test(ref)) return bad("ref must be a ref that search_data or app_summary returned, e.g. r3.");
    var action = String(args.action || "");
    if (ACTIONS.indexOf(action) < 0) return bad("action must be one of: " + ACTIONS.join(", ") + ".");
    var set = {};
    if (has(args, "title") && args.title !== null && args.title !== undefined) {
      var ti = line(args.title, 300);
      if (!ti) return bad("title must not be empty.");
      set.title = ti;
    }
    if (has(args, "date") && args.date !== null && args.date !== undefined && args.date !== "") {
      var d = realDate(args.date);
      if (!d) return bad("date must be a real date as YYYY-MM-DD.");
      set.date = d;
    }
    ["start", "end"].forEach(function (k) {
      if (set.err || !has(args, k) || args[k] === null || args[k] === undefined || args[k] === "") return;
      var v = hm(args[k]);
      if (!v) set.err = k + " must be HH:MM (24h).";
      else set[k] = v;
    });
    if (set.err) return bad(set.err);
    if (has(args, "location") && typeof args.location === "string") set.location = line(args.location, 150);
    if (has(args, "note") && typeof args.note === "string") set.note = para(args.note, 1000);
    if (has(args, "amount") && args.amount !== null && args.amount !== undefined && args.amount !== "") {
      var a = num(args.amount);
      if (!(a > 0)) return bad("amount must be a number greater than 0.");
      var cents = Math.round(a * 100);
      if (cents <= 0 || cents > MAX_CENTS) return bad("amount is out of range.");
      set.amount = cents;
    }
    if (has(args, "category") && args.category !== null && args.category !== undefined && args.category !== "") {
      if (CAT_NAMES.indexOf(args.category) < 0) return bad("category must be one of: " + CAT_NAMES.join(", ") + ".");
      set.category = args.category;
    }
    var keys = Object.keys(set);
    if (action === "complete" || action === "reopen" || action === "delete") {
      if (keys.length) return bad(action + " takes only ref; leave out " + keys.join(", ") + ".");
    } else if (action === "reschedule") {
      if (!set.date && !set.start && !set.end) return bad("reschedule needs a new date (and, for an event, start / end).");
      var extra = keys.filter(function (k) { return k !== "date" && k !== "start" && k !== "end"; });
      if (extra.length) return bad("reschedule changes only date, start and end; use update for " + extra.join(", ") + ".");
    } else if (!keys.length) {
      return bad("update needs at least one field to change.");
    }
    return { ok: true, ref: ref, action: action, set: set };
  }

  // ---------- 2. The diff ----------
  // before / after: flat views { field: string | boolean }. → rows
  // [{ f, b, a }] of the fields that differ, in VIEW_ORDER; a delete
  // lists every field the record had, with a: null (gone).
  function buildDiff(before, after, del) {
    var rows = [];
    before = before || {};
    after = after || {};
    var keys = VIEW_ORDER.filter(function (k) { return has(before, k) || has(after, k); });
    Object.keys(before).concat(Object.keys(after)).forEach(function (k) {
      if (keys.indexOf(k) < 0) keys.push(k);
    });
    keys.forEach(function (k) {
      var b = has(before, k) ? before[k] : "", a = has(after, k) ? after[k] : "";
      if (del) {
        if (b !== "" && b !== false && b !== null) rows.push({ f: k, b: b, a: null });
        return;
      }
      if (b !== a) rows.push({ f: k, b: b, a: a });
    });
    return rows;
  }

  // ---------- 3. To-Do ----------
  var ITEM_FIELDS = ["text", "done", "due", "notes", "labels", "info", "recurrence"];
  var XF_FIELDS = ["prio", "subs", "so", "list"];
  function tdOldCode(it) {
    if (!isObj(it.fm)) return false;
    var mx = 0;
    ITEM_FIELDS.forEach(function (f) { var v = it.fm[f]; if (typeof v === "number" && v > mx) mx = v; });
    if (isObj(it.xf)) XF_FIELDS.forEach(function (f) { var w = it.xf[f]; if (typeof w === "number" && w > mx) mx = w; });
    return (it.mtime || 0) > mx;
  }
  function tdFieldStamp(it, f) {
    if (!isObj(it.fm) || tdOldCode(it)) return it.mtime || 0;
    return typeof it.fm[f] === "number" ? it.fm[f] : 0;
  }
  function tdEnsureFm(it) {
    var fm = {};
    ITEM_FIELDS.forEach(function (f) { fm[f] = tdFieldStamp(it, f); });
    it.fm = fm;
  }
  // todo.js touchField, with a stamp that is never older than the task.
  function tdTouch(it, f, now) {
    tdEnsureFm(it);
    var t = stampAfter(now, it.mtime);
    it.fm[f] = t;
    it.mtime = t;
  }
  function tdStampNewest(it, now, floor) {
    var t = stampAfter(now, Math.max(it.mtime || 0, floor || 0));
    it.fm = {};
    ITEM_FIELDS.forEach(function (f) { it.fm[f] = t; });
    it.mtime = t;
  }
  function tdFind(d, target) {
    if (!isObj(d) || !Array.isArray(d.lists) || !isObj(target) || typeof target.item !== "string") return null;
    var hit = null;
    d.lists.forEach(function (l, li) {
      if (!isObj(l) || !Array.isArray(l.items)) return;
      l.items.forEach(function (it, ii) {
        if (!isObj(it) || it.id !== target.item) return;
        // the list it names first; else where it moved to
        if (!hit || (l.id === target.list && hit.list.id !== target.list)) hit = { list: l, li: li, it: it, ii: ii };
      });
    });
    return hit;
  }
  function tdView(it) {
    return {
      title: typeof it.text === "string" ? it.text : "",
      done: !!it.done,
      due: realDate(it.due),
      note: typeof it.notes === "string" ? it.notes : ""
    };
  }

  function todoChange(d, target, ch, now) {
    var h = tdFind(d, target);
    if (!h) return bad("That task is no longer in To-Do.");
    var it = h.it, before = tdView(it);
    var title = before.title;
    if (ch.action === "delete") {
      var copy = clone(it);
      h.list.items.splice(h.ii, 1);
      if (!isObj(d.deleted)) d.deleted = {};
      d.deleted[it.id] = stampAfter(now, Math.max(d.deleted[it.id] || 0, it.mtime || 0));
      d.deleted = sortedObj(d.deleted);
      return { ok: true, title: title, before: before, after: null, del: true,
               undo: { t: "del", app: "todo", list: h.list.id, index: h.ii, item: copy } };
    }
    var next = {};
    if (ch.action === "complete") {
      if (it.done) return bad("That task is already done.");
      if (it.recurrence) return bad("That task repeats. Ticking it works out its next date, which only To-Do does: tell the user to tick it in To-Do.");
      next.done = true;
    } else if (ch.action === "reopen") {
      if (!it.done) return bad("That task is not done.");
      next.done = false;
    } else {
      var s = ch.set;
      if (s.start || s.end) return bad("A To-Do task has a date only, no start or end time.");
      if (has(s, "title")) next.text = s.title.slice(0, 300);
      if (has(s, "date")) next.due = s.date;
      if (has(s, "note")) next.notes = s.note;
      var notOk = Object.keys(s).filter(function (k) { return !SETTABLE.todo[k]; });
      if (notOk.length) return bad("A To-Do task has no " + notOk.join(", ") + ".");
    }
    var prev = {}, changed = [];
    Object.keys(next).forEach(function (k) {
      var cur = k === "done" ? !!it[k] : (typeof it[k] === "string" ? it[k] : "");
      if (cur === next[k]) return;
      prev[k] = has(it, k) ? clone(it[k]) : null;
      it[k] = next[k];
      tdTouch(it, k, now);
      changed.push(k);
    });
    if (!changed.length) return bad("Nothing would change: the task already looks like that.");
    var nextRaw = {};
    changed.forEach(function (k) { nextRaw[k] = clone(it[k]); });
    return { ok: true, title: title, before: before, after: tdView(it), del: false,
             undo: { t: "set", app: "todo", target: { list: h.list.id, item: it.id }, prev: prev, next: nextRaw } };
  }
  function todoUndo(d, u, now) {
    if (u.t === "del") {
      if (!isObj(u.item) || typeof u.item.id !== "string" || !ID_RE.test(u.item.id)) return bad("bad undo");
      if (tdFind(d, { item: u.item.id })) return bad("The task is back already.");
      var list = null;
      (Array.isArray(d.lists) ? d.lists : []).forEach(function (l) { if (isObj(l) && l.id === u.list && Array.isArray(l.items)) list = l; });
      if (!list) return bad("Its list is gone.");
      var it = clone(u.item);
      tdStampNewest(it, now, (isObj(d.deleted) && d.deleted[it.id]) || 0);
      var at = Math.max(0, Math.min(list.items.length, Math.floor(u.index) || 0));
      list.items.splice(at, 0, it);
      list.items.forEach(function (x, i) { if (isObj(x)) x.pos = i; });
      list.om = stampAfter(now, list.om);
      if (isObj(d.deleted)) { delete d.deleted[it.id]; d.deleted = sortedObj(d.deleted); }
      return { ok: true };
    }
    var h = tdFind(d, u.target);
    if (!h) return bad("That task is no longer in To-Do.");
    var keys = Object.keys(u.next || {}).filter(function (k) { return ITEM_FIELDS.indexOf(k) >= 0; });
    for (var i = 0; i < keys.length; i++) {
      if (JSON.stringify(h.it[keys[i]] === undefined ? null : h.it[keys[i]]) !== JSON.stringify(u.next[keys[i]])) {
        return bad("The task changed since; nothing was undone.");
      }
    }
    keys.forEach(function (k) {
      var v = u.prev ? u.prev[k] : null;
      if (v === null || v === undefined) delete h.it[k]; else h.it[k] = clone(v);
      tdTouch(h.it, k, now);
    });
    return { ok: true };
  }

  // ---------- 4. Calendar ----------
  function calFind(d, target) {
    if (!isObj(d) || !Array.isArray(d.events) || !isObj(target)) return null;
    var id = typeof target.id === "string" ? target.id : typeof target.ev === "string" ? target.ev : "";
    for (var i = 0; i < d.events.length; i++) if (isObj(d.events[i]) && d.events[i].id === id) return { ev: d.events[i], i: i };
    return null;
  }
  function calView(ev) {
    return {
      title: typeof ev.title === "string" ? ev.title : "",
      date: realDate(ev.date),
      start: hm(ev.start || ev.time || ""),
      end: hm(ev.end || ""),
      location: typeof ev.location === "string" ? ev.location : "",
      note: typeof ev.note === "string" ? ev.note : ""
    };
  }
  var CAL_RAW = ["date", "dateEnd", "start", "end", "title", "location", "note"];
  function calChange(d, target, ch, now) {
    var h = calFind(d, target);
    if (!h) return bad("That event is no longer in Calendar.");
    var ev = h.ev, before = calView(ev), title = before.title;
    var series = !!ev.recur;
    if (ch.action === "complete" || ch.action === "reopen") return bad("A calendar event can't be ticked off.");
    if (ch.action === "delete") {
      if (series) return bad("That event repeats. Deleting one occurrence or the whole series is done in Calendar: tell the user to open it there.");
      var copy = clone(ev);
      d.events.splice(h.i, 1);
      if (!Array.isArray(d.deleted)) d.deleted = [];
      d.deleted = d.deleted.filter(function (x) { return !(isObj(x) && x.id === ev.id); });
      d.deleted.push({ id: ev.id, mtime: stampAfter(now, ev.mtime) });
      return { ok: true, title: title, before: before, after: null, del: true,
               undo: { t: "del", app: "calendar", ev: copy } };
    }
    var s = ch.set;
    var notOk = Object.keys(s).filter(function (k) { return !SETTABLE.calendar[k]; });
    if (notOk.length) return bad("A calendar event has no " + notOk.join(", ") + ".");
    if (series && (s.date || s.start || s.end)) {
      return bad("That event repeats. Moving one occurrence or the whole series is done in Calendar: tell the user to open it there.");
    }
    var prev = {};
    CAL_RAW.forEach(function (k) { prev[k] = has(ev, k) ? clone(ev[k]) : null; });
    var nx = { date: ev.date, dateEnd: ev.dateEnd || null, start: before.start || null, end: before.end || null };
    if (s.date && s.date !== ev.date) {
      if (nx.dateEnd) nx.dateEnd = dayStr(dayNum(s.date) + (dayNum(nx.dateEnd) - dayNum(ev.date)));
      nx.date = s.date;
    }
    if (s.start) {
      if (!s.end && nx.start && nx.end && !nx.dateEnd) {
        var e2 = mins(s.start) + (mins(nx.end) - mins(nx.start));
        nx.end = e2 > mins(s.start) && e2 <= 1439 ? fromMins(e2) : null;
      }
      nx.start = s.start;
    }
    if (s.end) {
      if (!nx.start) return bad("The event has no start time; give start as well as end.");
      nx.end = s.end;
    }
    if (nx.start && nx.end && nx.end <= nx.start && !(nx.dateEnd && nx.dateEnd > nx.date)) {
      return bad("end must be after start.");
    }
    var changed = false;
    function put(k, v) {
      var cur = has(ev, k) ? ev[k] : null;
      if (k === "start" && cur === null && has(ev, "time")) cur = hm(ev.time) || null;
      if ((cur === undefined ? null : cur) === v) return;
      ev[k] = v;
      changed = true;
    }
    put("date", nx.date);
    put("dateEnd", nx.dateEnd);
    put("start", nx.start);
    put("end", nx.end);
    if (has(s, "title")) put("title", s.title.slice(0, 80));
    if (has(s, "location")) put("location", s.location);
    if (has(s, "note")) put("note", s.note.slice(0, 500));
    if (!changed) return bad("Nothing would change: the event already looks like that.");
    ev.mtime = stampAfter(now, ev.mtime);
    var next = {};
    CAL_RAW.forEach(function (k) { next[k] = has(ev, k) ? clone(ev[k]) : null; });
    return { ok: true, title: title, before: before, after: calView(ev), del: false,
             undo: { t: "set", app: "calendar", target: { id: ev.id }, prev: prev, next: next } };
  }
  function calUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.events)) return bad("Calendar has no events.");
    if (u.t === "del") {
      if (!isObj(u.ev) || typeof u.ev.id !== "string" || !ID_RE.test(u.ev.id)) return bad("bad undo");
      if (calFind(d, { id: u.ev.id })) return bad("The event is back already.");
      var ev = clone(u.ev), tomb = 0;
      (Array.isArray(d.deleted) ? d.deleted : []).forEach(function (x) { if (isObj(x) && x.id === ev.id && x.mtime > tomb) tomb = x.mtime; });
      ev.mtime = stampAfter(now, Math.max(ev.mtime || 0, tomb));
      d.events.push(ev);
      if (Array.isArray(d.deleted)) d.deleted = d.deleted.filter(function (x) { return !(isObj(x) && x.id === ev.id); });
      return { ok: true };
    }
    var h = calFind(d, u.target);
    if (!h) return bad("That event is no longer in Calendar.");
    for (var i = 0; i < CAL_RAW.length; i++) {
      var k = CAL_RAW[i], cur = has(h.ev, k) ? h.ev[k] : null;
      if (JSON.stringify(cur === undefined ? null : cur) !== JSON.stringify(u.next ? (u.next[k] === undefined ? null : u.next[k]) : null)) {
        return bad("The event changed since; nothing was undone.");
      }
    }
    CAL_RAW.forEach(function (k) {
      var v = u.prev ? u.prev[k] : null;
      if (v === null || v === undefined) { if (k === "title" || k === "location" || k === "note") h.ev[k] = ""; else h.ev[k] = null; }
      else h.ev[k] = clone(v);
    });
    h.ev.mtime = stampAfter(now, h.ev.mtime);
    return { ok: true };
  }

  // ---------- 5. Budget ----------
  function bgFind(d, target) {
    if (!isObj(d) || !Array.isArray(d.tx) || !isObj(target) || typeof target.tx !== "string") return null;
    for (var i = 0; i < d.tx.length; i++) if (isObj(d.tx[i]) && d.tx[i].id === target.tx) return { x: d.tx[i], i: i };
    return null;
  }
  function bgCat(d, id) {
    if (!id) return "";
    var k;
    for (k in BUDGET_CATS.o) if (BUDGET_CATS.o[k] === id) return "cat:" + k;
    for (k in BUDGET_CATS.i) if (BUDGET_CATS.i[k] === id) return "cat:" + k;
    var own = (Array.isArray(d.cats) ? d.cats : []).filter(function (c) { return isObj(c) && c.id === id; })[0];
    return own && typeof own.name === "string" && own.name ? own.name : id;
  }
  function bgView(d, x) {
    return {
      kind: x.k === "i" ? "income" : "expense",
      amount: typeof x.a === "number" ? (x.a / 100).toFixed(2) : "",
      date: realDate(x.d),
      category: bgCat(d, x.c),
      note: typeof x.n === "string" ? x.n : ""
    };
  }
  var BG_RAW = ["d", "a", "c", "n"];
  function budgetChange(d, target, ch, now) {
    if (isObj(target) && typeof target.rec === "string") return bad("That is a recurring entry; change it in Budget.");
    var h = bgFind(d, target);
    if (!h) return bad("That entry is no longer in Budget.");
    var x = h.x, before = bgView(d, x);
    var title = (x.n || "") || before.amount;
    if (ch.action === "complete" || ch.action === "reopen") return bad("A Budget entry can't be ticked off.");
    if (ch.action === "delete") {
      if (x.rc) return bad("That entry has receipts on the orOS disk; delete it in Budget.");
      var copy = clone(x);
      d.tx.splice(h.i, 1);
      if (!isObj(d.tombs)) d.tombs = {};
      var tk = "tx:" + x.id;
      d.tombs[tk] = stampAfter(now, Math.max(d.tombs[tk] || 0, x.m || 0));
      d.tombs = sortedObj(d.tombs);
      return { ok: true, title: title, before: before, after: null, del: true,
               undo: { t: "del", app: "budget", x: copy } };
    }
    var s = ch.set;
    var notOk = Object.keys(s).filter(function (k) { return !SETTABLE.budget[k]; });
    if (notOk.length) return bad("A Budget entry has no " + notOk.join(", ") + ".");
    var prev = {};
    BG_RAW.forEach(function (k) { prev[k] = has(x, k) ? clone(x[k]) : null; });
    var changed = false;
    if (has(s, "amount") && s.amount !== x.a) {
      if (x.oc) return bad("That entry was typed in another currency; change its amount in Budget.");
      x.a = s.amount; changed = true;
    }
    if (has(s, "date") && s.date !== x.d) { x.d = s.date; changed = true; }
    if (has(s, "category")) {
      var cid = BUDGET_CATS[x.k === "i" ? "i" : "o"][s.category];
      if (!cid) return bad("category " + s.category + " is not a category for " + (x.k === "i" ? "income" : "expenses") + ".");
      if (cid !== x.c) { x.c = cid; changed = true; }
    }
    if (has(s, "note")) {
      var n = line(s.note, 140);
      if (n !== (x.n || "")) { x.n = n; changed = true; }
    }
    if (!changed) return bad("Nothing would change: the entry already looks like that.");
    x.m = stampAfter(now, x.m);
    var next = {};
    BG_RAW.forEach(function (k) { next[k] = has(x, k) ? clone(x[k]) : null; });
    return { ok: true, title: title, before: before, after: bgView(d, x), del: false,
             undo: { t: "set", app: "budget", target: { tx: x.id }, prev: prev, next: next } };
  }
  function budgetUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.tx)) return bad("Budget has no entries.");
    if (u.t === "del") {
      if (!isObj(u.x) || typeof u.x.id !== "string" || !ID_RE.test(u.x.id)) return bad("bad undo");
      if (bgFind(d, { tx: u.x.id })) return bad("The entry is back already.");
      var x = clone(u.x), tk = "tx:" + x.id;
      x.m = stampAfter(now, Math.max(x.m || 0, (isObj(d.tombs) && d.tombs[tk]) || 0));
      if (isObj(d.tombs)) { delete d.tombs[tk]; d.tombs = sortedObj(d.tombs); }
      d.tx.push(x);
      d.tx.sort(function (p, q) { return cmpStr(String(p && p.id), String(q && q.id)); });
      return { ok: true };
    }
    var h = bgFind(d, u.target);
    if (!h) return bad("That entry is no longer in Budget.");
    for (var i = 0; i < BG_RAW.length; i++) {
      var k = BG_RAW[i], cur = has(h.x, k) ? h.x[k] : null;
      if (JSON.stringify(cur) !== JSON.stringify(u.next ? (u.next[k] === undefined ? null : u.next[k]) : null)) {
        return bad("The entry changed since; nothing was undone.");
      }
    }
    BG_RAW.forEach(function (k) {
      var v = u.prev ? u.prev[k] : null;
      if (v === null || v === undefined) h.x[k] = k === "a" ? h.x[k] : ""; else h.x[k] = clone(v);
    });
    h.x.m = stampAfter(now, h.x.m);
    return { ok: true };
  }

  // ---------- 6. Bookmarks ----------
  function bmFind(d, target) {
    if (!isObj(d) || !isObj(d.items) || !isObj(target) || typeof target.id !== "string") return null;
    return has(d.items, target.id) && isObj(d.items[target.id]) ? d.items[target.id] : null;
  }
  function bmView(it) {
    return {
      title: typeof it.title === "string" ? it.title : "",
      url: typeof it.url === "string" ? it.url : "",
      note: typeof it.note === "string" ? it.note : ""
    };
  }
  function bookmarksChange(d, target, ch, now) {
    var it = bmFind(d, target);
    if (!it) return bad("That bookmark is no longer in Bookmarks.");
    var before = bmView(it), title = before.title || before.url;
    if (ch.action !== "update" && ch.action !== "delete") return bad("A bookmark can only be renamed, have its note changed, or be deleted.");
    if (ch.action === "delete") {
      if (it.arch) return bad("That bookmark has a saved copy on the orOS disk; delete it in Bookmarks.");
      var copy = clone(it);
      var id = it.id;
      delete d.items[id];
      if (!isObj(d.deleted)) d.deleted = {};
      d.deleted[id] = stampAfter(now, Math.max(d.deleted[id] || 0, it.modified || 0));
      d.deleted = sortedObj(d.deleted);
      return { ok: true, title: title, before: before, after: null, del: true,
               undo: { t: "del", app: "bookmarks", item: copy } };
    }
    var s = ch.set;
    var notOk = Object.keys(s).filter(function (k) { return !SETTABLE.bookmarks[k]; });
    if (notOk.length) return bad("A bookmark has no " + notOk.join(", ") + ".");
    var prev = { title: it.title, note: it.note === undefined ? "" : it.note }, changed = false;
    if (has(s, "title") && s.title.slice(0, 256) !== it.title) { it.title = s.title.slice(0, 256); changed = true; }
    if (has(s, "note") && s.note.slice(0, 1024) !== (it.note || "")) { it.note = s.note.slice(0, 1024); changed = true; }
    if (!changed) return bad("Nothing would change: the bookmark already looks like that.");
    it.modified = stampAfter(now, it.modified);
    return { ok: true, title: title, before: before, after: bmView(it), del: false,
             undo: { t: "set", app: "bookmarks", target: { id: it.id }, prev: prev, next: { title: it.title, note: it.note } } };
  }
  function bookmarksUndo(d, u, now) {
    if (!isObj(d) || !isObj(d.items)) return bad("Bookmarks has no items.");
    if (u.t === "del") {
      if (!isObj(u.item) || typeof u.item.id !== "string" || !ID_RE.test(u.item.id)) return bad("bad undo");
      if (has(d.items, u.item.id)) return bad("The bookmark is back already.");
      var it = clone(u.item);
      it.modified = stampAfter(now, Math.max(it.modified || 0, (isObj(d.deleted) && d.deleted[it.id]) || 0));
      d.items[it.id] = it;
      d.items = sortedObj(d.items);
      if (isObj(d.deleted)) { delete d.deleted[it.id]; d.deleted = sortedObj(d.deleted); }
      return { ok: true };
    }
    var cur = bmFind(d, u.target);
    if (!cur) return bad("That bookmark is no longer in Bookmarks.");
    if (!u.next || cur.title !== u.next.title || (cur.note || "") !== (u.next.note || "")) return bad("The bookmark changed since; nothing was undone.");
    cur.title = String(u.prev && u.prev.title || cur.title);
    cur.note = String(u.prev && u.prev.note || "");
    cur.modified = stampAfter(now, cur.modified);
    return { ok: true };
  }

  var CHANGE = { todo: todoChange, calendar: calChange, budget: budgetChange, bookmarks: bookmarksChange };
  var UNDO = { todo: todoUndo, calendar: calUndo, budget: budgetUndo, bookmarks: bookmarksUndo };

  // ---------- 7. Plan, apply, undo ----------
  // data = the app's stored JSON (parsed), target = the ref's target,
  // ch = normArgs() result. Never touches `data`.
  // → { ok, app, title, rows, before, after, del } | { ok: false, err }
  function plan(appId, data, target, ch, now) {
    if (!has(APPS, appId)) return bad("This app's items can't be changed by the assistant. Changes work for: " + APP_IDS.join(", ") + ".");
    if (!ch || !ch.ok) return bad("bad change");
    if (APPS[appId].actions.indexOf(ch.action) < 0) {
      return bad(appId + " takes: " + APPS[appId].actions.join(", ") + ".");
    }
    var r = CHANGE[appId](clone(data) || {}, target, ch, now || 0);
    if (!r.ok) return r;
    return { ok: true, app: appId, title: r.title, before: r.before, after: r.after, del: r.del,
             rows: buildDiff(r.before, r.after, r.del) };
  }
  // The same change on the data as it is NOW. expect = plan().before:
  // a record that changed since the user saw the diff is left alone.
  // → { ok, data: new JSON, undo, rows } | { ok: false, err, conflict? }
  function apply(appId, data, target, ch, now, expect) {
    if (!has(APPS, appId)) return bad("unknown app");
    if (APPS[appId].actions.indexOf(ch.action) < 0) return bad("not allowed");
    var d = clone(data) || {};
    var r = CHANGE[appId](d, target, ch, now);
    if (!r.ok) return r;
    if (expect && JSON.stringify(r.before) !== JSON.stringify(expect)) {
      return { ok: false, conflict: true, err: "The item changed since the user saw the change; nothing was changed." };
    }
    return { ok: true, data: d, undo: r.undo, rows: buildDiff(r.before, r.after, r.del) };
  }
  // u = apply().undo (kept in memory by the Assistant, never from a
  // stored conversation). → { ok, data } | { ok: false, err }
  function undo(appId, data, u, now) {
    if (!has(APPS, appId) || !isObj(u) || u.app !== appId || (u.t !== "set" && u.t !== "del")) return bad("bad undo");
    var d = clone(data) || {};
    var r = UNDO[appId](d, u, now);
    if (!r.ok) return r;
    return { ok: true, data: d };
  }
  function storageKey(appId) { return has(APPS, appId) ? APPS[appId].key : ""; }
  // Which of the readable app ids take changes.
  function editableApps(ids) {
    return (Array.isArray(ids) ? ids : []).filter(function (id) { return has(APPS, id); });
  }

  var api = {
    ACTIONS: ACTIONS, APP_IDS: APP_IDS, VIEW_ORDER: VIEW_ORDER, CAT_NAMES: CAT_NAMES,
    normArgs: normArgs, buildDiff: buildDiff, plan: plan, apply: apply, undo: undo,
    storageKey: storageKey, editableApps: editableApps,
    actionsFor: function (appId) { return has(APPS, appId) ? APPS[appId].actions.slice() : []; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosAssistEdits = api;
})(typeof window !== "undefined" ? window : this);
