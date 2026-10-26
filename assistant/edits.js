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
//     Phase 4 wave 2 (each section below says its app's contract):
//       contacts  per-field stamps c.fm + c.mtime (CT-PF, merge.js
//                 restamp), tombstones deleted [{ id, mtime }]
//       kanban    card field groups c.fm + p/om order stamps, column
//                 arrival rules as tools.js applyArrival, tombstones
//                 board.deleted, canonical order as model.js canonState
//       shelf     items / sessions LWW on m, tombstones by id, sorted
//       habits    model.js setTick on today's local date
//       plants    a water log entry as logTask, tombstones, sorted
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

  var ACTIONS = ["complete", "reopen", "reschedule", "update", "move", "delete"];
  // Media Shelf statuses by the names the model knows.
  var STATUS_NAMES = ["want", "now", "done", "dropped"];
  var APPS = {
    todo:      { key: "oros-todo-data",      actions: ["complete", "reopen", "reschedule", "update", "delete"] },
    calendar:  { key: "oros-calendar-data",  actions: ["reschedule", "update", "delete"] },
    budget:    { key: "oros-budget-data",    actions: ["reschedule", "update", "delete"] },
    bookmarks: { key: "oros-bookmarks-data", actions: ["update", "delete"] },
    // Phase 4 wave 2
    contacts:  { key: "oros-contacts-data",  actions: ["update", "delete"] },
    // Wave CF2: a CRM customer's details (deleting one takes its deals
    // and history with it, so that stays in CRM).
    crm:       { key: "oros-crm-data",       actions: ["update"] },
    kanban:    { key: "oros-kanban-data",    actions: ["reschedule", "update", "move", "delete"] },
    shelf:     { key: "oros-shelf-data",     actions: ["update", "delete"] },
    habits:    { key: "oros-habits-data",    actions: ["complete", "reopen", "update"] },
    plants:    { key: "oros-plants-data",    actions: ["complete", "update"] }
  };
  var APP_IDS = ["todo", "calendar", "budget", "bookmarks", "contacts", "crm", "kanban", "shelf", "habits", "plants"];
  // What each app's update may set (the tool's argument names).
  // Notes arrive whole (up to NOTE_IN); each app refuses a note past
  // its own limit instead of cutting it. Contacts: CT-N2K, 2,000.
  var NOTE_IN = 5000, CT_NOTE = 2000;
  var SETTABLE = {
    todo:      { title: 1, date: 1, note: 1, label: 1, labels: 1, priority: 1 },
    calendar:  { title: 1, date: 1, start: 1, end: 1, location: 1, note: 1, label: 1, labels: 1 },
    budget:    { amount: 1, date: 1, category: 1, note: 1 },
    bookmarks: { title: 1, note: 1, label: 1, labels: 1 },
    contacts:  { title: 1, org: 1, phone: 1, email: 1, date: 1, note: 1, label: 1, labels: 1,
                 // wave CF1: contacts from any document
                 nickname: 1, job_title: 1, address: 1, address_replace: 1, website: 1,
                 old_phone: 1, old_email: 1, old_website: 1, note_add: 1 },
    crm:       { title: 1, nickname: 1, job_title: 1, tax_id: 1, tax_office: 1, phone: 1, old_phone: 1, email: 1, old_email: 1,
                 website: 1, old_website: 1, address: 1, address_replace: 1, note: 1, note_add: 1 },
    kanban:    { title: 1, date: 1, note: 1, label: 1, labels: 1 },
    shelf:     { title: 1, note: 1, status: 1 },
    habits:    { title: 1 },
    plants:    { title: 1, note: 1 }
  };
  // The diff's fields, in the order the card shows them.
  var VIEW_ORDER = ["title", "nickname", "column", "kind", "status", "done", "watered", "org", "job", "vat", "taxoffice", "phone", "email", "address", "website", "birthday", "amount", "date", "due", "start", "end", "category", "location", "label", "priority", "url", "labels", "subtasks", "position", "note"];
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
    if (has(args, "note") && typeof args.note === "string") set.note = para(args.note, NOTE_IN);
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
    // Phase 4 wave 2 fields (Contacts, Kanban, Media Shelf).
    if (has(args, "org") && typeof args.org === "string") set.org = line(args.org, 80);
    if (has(args, "phone") && args.phone !== null && args.phone !== undefined && args.phone !== "") {
      var ph = line(args.phone, 40);
      if (!/\d/.test(ph)) return bad("phone must contain digits.");
      set.phone = ph;
    }
    if (has(args, "email") && args.email !== null && args.email !== undefined && args.email !== "") {
      var em = line(args.email, 120);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return bad("email must be an e-mail address.");
      set.email = em;
    }
    // Wave CF1 (Contacts from any document): more of a contact card.
    if (has(args, "nickname") && typeof args.nickname === "string") set.nickname = line(args.nickname, 60);
    if (has(args, "job_title") && typeof args.job_title === "string") set.job_title = line(args.job_title, 80);
    if (has(args, "address") && args.address !== null && args.address !== undefined && args.address !== "") {
      var ad = typeof args.address === "string" ? { street: args.address } : args.address;
      if (!isObj(ad)) return bad("address must be an object { street, city, zip, region, country, type }.");
      var ao = {};
      [["street", 120], ["city", 60], ["zip", 20], ["region", 60], ["country", 60]].forEach(function (f) { ao[f[0]] = line(ad[f[0]], f[1]); });
      if (!ao.street && !ao.city && !ao.zip && !ao.region && !ao.country) return bad("address must not be empty.");
      if (has(ad, "type") && ad.type !== "" && ["home", "work", "other"].indexOf(ad.type) < 0) return bad("address type must be home, work or other.");
      ao.type = ad.type || "home";
      set.address = ao;
    }
    if (has(args, "address_replace") && args.address_replace === true) {
      if (!set.address) return bad("address_replace goes with address.");
      set.address_replace = true;
    }
    if (has(args, "website") && args.website !== null && args.website !== undefined && args.website !== "") {
      var wb = line(args.website, 300);
      if (!/^(https?:\/\/)?[^\s\/.]+(\.[^\s\/.]+)+(\/\S*)?$/i.test(wb)) return bad("website must be a web address, e.g. example.com.");
      set.website = wb;
    }
    var olds = [["old_phone", "phone", 40], ["old_email", "email", 120], ["old_website", "website", 300]];
    for (var oi = 0; oi < olds.length; oi++) {
      var ok = olds[oi][0];
      if (!has(args, ok) || args[ok] === null || args[ok] === undefined || args[ok] === "") continue;
      if (!has(set, olds[oi][1])) return bad(ok + " goes with " + olds[oi][1] + " (the new value that takes its place).");
      set[ok] = line(args[ok], olds[oi][2]);
    }
    if (has(args, "tax_id") && typeof args.tax_id === "string" && args.tax_id.trim()) {
      var tx = line(args.tax_id, 20).replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z0-9.\-]+$/.test(tx)) return bad("tax_id must be letters and digits, e.g. 123456789 or EL123456789.");
      set.tax_id = tx;
    }
    if (has(args, "tax_office") && typeof args.tax_office === "string") set.tax_office = line(args.tax_office, 60);
    if (has(args, "note_add") && typeof args.note_add === "string" && args.note_add.trim()) {
      if (has(set, "note")) return bad("give note (replaces) or note_add (adds), not both.");
      set.note_add = para(args.note_add, NOTE_IN);
    }
    if (has(args, "column") && args.column !== null && args.column !== undefined && args.column !== "") {
      var co = line(args.column, 120);
      if (!co) return bad("column must not be empty.");
      set.column = co;
    }
    // Labels (AS-LBL): label = one label's name (Calendar: THE label;
    // the other apps: add it), "none" / "" takes them all off; labels =
    // the whole new list of names (replaces; [] takes them all off).
    if (has(args, "label") && typeof args.label === "string") {
      var lb = line(args.label, 40);
      set.label = /^(none|no label)$/i.test(lb) ? "" : lb;
    }
    if (has(args, "labels") && args.labels !== null && args.labels !== undefined) {
      if (!Array.isArray(args.labels)) return bad("labels must be a list of label names.");
      if (args.labels.length > 20) return bad("labels takes at most 20 names.");
      var lbs = [];
      args.labels.forEach(function (x) {
        var n = line(typeof x === "string" ? x : "", 40);
        if (n && !lbs.some(function (y) { return foldName(y) === foldName(n); })) lbs.push(n);
      });
      if (has(set, "label")) return bad("give label or labels, not both.");
      set.labels = lbs;
    }
    if (has(args, "priority") && args.priority !== null && args.priority !== undefined && args.priority !== "") {
      var pr = typeof args.priority === "number" ? args.priority : parseInt(String(args.priority).replace(/^p/i, ""), 10);
      if (!(pr >= 1 && pr <= 4) || Math.floor(pr) !== pr) return bad("priority must be 1 (urgent), 2, 3 or 4 (none).");
      set.priority = pr;
    }
    if (has(args, "status") && args.status !== null && args.status !== undefined && args.status !== "") {
      if (STATUS_NAMES.indexOf(args.status) < 0) return bad("status must be one of: " + STATUS_NAMES.join(", ") + ".");
      set.status = args.status;
    }
    var keys = Object.keys(set);
    if (action === "move") {
      if (!set.column) return bad("move needs the column to move the card to.");
      if (keys.length > 1) return bad("move changes only the column; use update for the rest.");
      return { ok: true, ref: ref, action: action, set: set };
    }
    if (set.column) return bad("column is only for move.");
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
  // todo.js touchXf (prio, subs, …): fm spelled out first.
  function tdTouchXf(it, f, now) {
    tdEnsureFm(it);
    var t = stampAfter(now, it.mtime), xf = {};
    XF_FIELDS.forEach(function (k) { if (isObj(it.xf) && typeof it.xf[k] === "number") xf[k] = it.xf[k]; });
    xf[f] = t;
    it.xf = xf;
    it.mtime = t;
  }
  // The user's To-Do labels (state.labels, a tombstone hides one).
  function tdLabels(d) {
    var dead = isObj(d.deleted) ? d.deleted : {};
    return (Array.isArray(d.labels) ? d.labels : []).filter(function (l) {
      return isObj(l) && typeof l.id === "string" && typeof l.name === "string" && !(typeof dead[l.id] === "number" && dead[l.id] >= (l.mtime || 0));
    }).map(function (l) { return { id: l.id, names: [l.name] }; });
  }
  function tdLabelNames(d, ids) {
    var ls = tdLabels(d);
    return (Array.isArray(ids) ? ids : []).map(function (id) {
      var l = ls.filter(function (x) { return x.id === id; })[0];
      return l ? l.names[0] : "";
    }).filter(Boolean).join(", ");
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
  function tdView(it, d) {
    return {
      title: typeof it.text === "string" ? it.text : "",
      done: !!it.done,
      due: realDate(it.due),
      priority: it.prio === 1 || it.prio === 2 || it.prio === 3 ? "P" + it.prio : "",
      labels: tdLabelNames(d, it.labels),
      note: typeof it.notes === "string" ? it.notes : ""
    };
  }

  function todoChange(d, target, ch, now) {
    var h = tdFind(d, target);
    if (!h) return bad("That task is no longer in To-Do.");
    var it = h.it, before = tdView(it, d);
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
      if (has(s, "label") || has(s, "labels")) {
        var nl = newLabelIds(tdLabels(d), Array.isArray(it.labels) ? it.labels : [], s, "To-Do", "To-Do (a task's Labels)");
        if (nl.err) return bad(nl.err);
        next.labels = nl.ids;
      }
      if (has(s, "priority")) next.prio = s.priority;
    }
    var prev = {}, changed = [];
    Object.keys(next).forEach(function (k) {
      var cur = k === "done" ? !!it[k] : k === "labels" ? (Array.isArray(it.labels) ? it.labels : []) :
                k === "prio" ? (it.prio === 1 || it.prio === 2 || it.prio === 3 ? it.prio : 4) : (typeof it[k] === "string" ? it[k] : "");
      if (JSON.stringify(cur) === JSON.stringify(next[k])) return;
      prev[k] = has(it, k) ? clone(it[k]) : null;
      if (k === "prio") {
        if (next[k] === 4) delete it.prio; else it.prio = next[k];
        tdTouchXf(it, "prio", now);
      } else {
        it[k] = next[k];
        tdTouch(it, k, now);
      }
      changed.push(k);
    });
    if (!changed.length) return bad("Nothing would change: the task already looks like that.");
    var nextRaw = {};
    changed.forEach(function (k) { nextRaw[k] = has(it, k) ? clone(it[k]) : null; });
    return { ok: true, title: title, before: before, after: tdView(it, d), del: false,
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
    var keys = Object.keys(u.next || {}).filter(function (k) { return ITEM_FIELDS.indexOf(k) >= 0 || k === "prio"; });
    for (var i = 0; i < keys.length; i++) {
      if (JSON.stringify(h.it[keys[i]] === undefined ? null : h.it[keys[i]]) !== JSON.stringify(u.next[keys[i]] === undefined ? null : u.next[keys[i]])) {
        return bad("The task changed since; nothing was undone.");
      }
    }
    keys.forEach(function (k) {
      var v = u.prev ? u.prev[k] : null;
      if (v === null || v === undefined) delete h.it[k]; else h.it[k] = clone(v);
      if (k === "prio") tdTouchXf(h.it, k, now); else tdTouch(h.it, k, now);
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
  // The label an event shows: one of the user's own labels
  // (calendar.js state.labels). Untouched seeds (mtime 0) are stored
  // with their English name and shown translated (calendar.js
  // SEED_NAMES), so either name finds them. An id that names no label
  // (a removed one) shows as no label, as in Calendar.
  var CAL_SEEDS = {
    en: { "cal.lbl-personal": "Personal", "cal.lbl-work": "Work", "cal.lbl-family": "Family" },
    el: { "cal.lbl-personal": "Προσωπικό", "cal.lbl-work": "Εργασία", "cal.lbl-family": "Οικογένεια" }
  };
  function foldName(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  // The seed labels (Calendar, Contacts) answer to their name in every
  // language: an exact name wins, then a seed's other name.
  function seedGroup(name) {
    var f = foldName(name), g = -1;
    ["cal.lbl-personal", "cal.lbl-work", "cal.lbl-family"].forEach(function (k, i) {
      if (foldName(CAL_SEEDS.en[k]) === f || foldName(CAL_SEEDS.el[k]) === f) g = i;
    });
    return g;
  }
  // list = [{ id, names: [..] }] → the entry a name means, or null.
  function pickLabel(list, name) {
    var f = foldName(name), hit = null;
    list.forEach(function (l) { if (!hit && l.names.some(function (n) { return foldName(n) === f; })) hit = l; });
    if (hit) return hit;
    var g = seedGroup(name);
    if (g < 0) return null;
    list.forEach(function (l) { if (!hit && l.names.some(function (n) { return seedGroup(n) === g; })) hit = l; });
    return hit;
  }
  // The label ids a change leaves on an item: s.labels replaces, s.label
  // adds one ("" = none at all). → { ids } | { err }
  function newLabelIds(list, cur, s, appName, where) {
    var names = has(s, "labels") ? s.labels : (s.label ? [s.label] : []);
    var ids = has(s, "labels") || !s.label ? [] : cur.slice(), miss = [];
    names.forEach(function (n) {
      var l = pickLabel(list, n);
      if (!l) miss.push(n);
      else if (ids.indexOf(l.id) < 0) ids.push(l.id);
    });
    if (miss.length) {
      return { err: appName + " has no label named \"" + miss.join("\", \"") + "\". " +
        (list.length ? "Its labels: " + list.map(function (l) { return l.names.join(" / "); }).join(", ") + ". " : "It has no labels. ") +
        "New labels are made in " + where + ": tell the user." };
    }
    return { ids: ids };
  }
  function calLabels(d) {
    return (Array.isArray(d.labels) ? d.labels : []).filter(function (l) {
      return isObj(l) && typeof l.id === "string" && l.id && typeof l.name === "string";
    });
  }
  function calLabelNames(l) {
    return l.mtime === 0 && has(CAL_SEEDS.en, "cal." + l.id) ? [CAL_SEEDS.en["cal." + l.id], CAL_SEEDS.el["cal." + l.id]] : [l.name];
  }
  function calLabelName(d, id) {
    if (typeof id !== "string" || !id) return "";
    var l = calLabels(d).filter(function (x) { return x.id === id; })[0];
    return l ? calLabelNames(l).join(" / ") : "";
  }
  function calFindLabel(d, name) {
    var hit = pickLabel(calLabels(d).map(function (l) { return { id: l.id, names: calLabelNames(l), l: l }; }), name);
    return hit ? hit.l : null;
  }
  function calView(ev, d) {
    return {
      title: typeof ev.title === "string" ? ev.title : "",
      date: realDate(ev.date),
      start: hm(ev.start || ev.time || ""),
      end: hm(ev.end || ""),
      location: typeof ev.location === "string" ? ev.location : "",
      label: calLabelName(d, ev.labelId),
      note: typeof ev.note === "string" ? ev.note : ""
    };
  }
  var CAL_RAW = ["date", "dateEnd", "start", "end", "title", "location", "labelId", "note"];
  function calChange(d, target, ch, now) {
    var h = calFind(d, target);
    if (!h) return bad("That event is no longer in Calendar.");
    var ev = h.ev, before = calView(ev, d), title = before.title;
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
    if (has(s, "labels")) {
      if (s.labels.length > 1) return bad("A calendar event has one label; give label with one name.");
      s = clone(s);
      s.label = s.labels[0] || "";
      delete s.labels;
    }
    if (has(s, "label")) {
      var lb = s.label ? calFindLabel(d, s.label) : null;
      if (s.label && !lb) {
        var names = calLabels(d).map(function (l) { return calLabelNames(l).join(" / "); });
        return bad("Calendar has no label named \"" + s.label + "\". " +
          (names.length ? "Its labels: " + names.join(", ") + ". " : "It has no labels. ") +
          "New labels are made in Calendar (Manage labels): tell the user.");
      }
      put("labelId", lb ? lb.id : null);
    }
    if (!changed) return bad("Nothing would change: the event already looks like that.");
    ev.mtime = stampAfter(now, ev.mtime);
    var next = {};
    CAL_RAW.forEach(function (k) { next[k] = has(ev, k) ? clone(ev[k]) : null; });
    return { ok: true, title: title, before: before, after: calView(ev, d), del: false,
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
      if (v === null || v === undefined) { if (k === "title" || k === "location" || k === "note") h.ev[k] = ""; else if (k === "labelId" && !has(h.ev, k)) return; else h.ev[k] = null; }
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
  function bmTags(it) { return Array.isArray(it.tags) ? it.tags.filter(function (x) { return typeof x === "string"; }) : []; }
  function bmView(it) {
    return {
      title: typeof it.title === "string" ? it.title : "",
      url: typeof it.url === "string" ? it.url : "",
      labels: bmTags(it).join(", "),
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
    var prev = { title: it.title, note: it.note === undefined ? "" : it.note, tags: bmTags(it) }, changed = false;
    if (has(s, "title") && s.title.slice(0, 256) !== it.title) { it.title = s.title.slice(0, 256); changed = true; }
    if (has(s, "note") && s.note.slice(0, 1024) !== (it.note || "")) { it.note = s.note.slice(0, 1024); changed = true; }
    // Tags are free words (bookmarks.js sanitizeItem: 12 at most, 32
    // characters each): label adds one (an existing tag keeps its
    // spelling), labels sets the whole list, none takes them all off.
    if (has(s, "label") || has(s, "labels")) {
      var tags = has(s, "labels") ? [] : (s.label ? bmTags(it).slice() : []);
      (has(s, "labels") ? s.labels : (s.label ? [s.label] : [])).forEach(function (n) {
        var tg = n.slice(0, 32), old = bmTags(it).filter(function (x) { return foldName(x) === foldName(tg); })[0];
        if (!tags.some(function (x) { return foldName(x) === foldName(tg); })) tags.push(old || tg);
      });
      if (tags.length > 12) return bad("A bookmark takes at most 12 tags.");
      if (JSON.stringify(tags) !== JSON.stringify(bmTags(it))) { it.tags = tags; changed = true; }
    }
    if (!changed) return bad("Nothing would change: the bookmark already looks like that.");
    it.modified = stampAfter(now, it.modified);
    return { ok: true, title: title, before: before, after: bmView(it), del: false,
             undo: { t: "set", app: "bookmarks", target: { id: it.id }, prev: prev, next: { title: it.title, note: it.note, tags: bmTags(it) } } };
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
    if (!u.next || cur.title !== u.next.title || (cur.note || "") !== (u.next.note || "") ||
        (Array.isArray(u.next.tags) && JSON.stringify(bmTags(cur)) !== JSON.stringify(u.next.tags))) return bad("The bookmark changed since; nothing was undone.");
    cur.title = String(u.prev && u.prev.title || cur.title);
    cur.note = String(u.prev && u.prev.note || "");
    if (u.prev && Array.isArray(u.prev.tags)) cur.tags = clone(u.prev.tags);
    cur.modified = stampAfter(now, cur.modified);
    return { ok: true };
  }

  // ---------- 7. Contacts ----------
  // oros-contacts-data { ver, labels, contacts: [c], deleted: [{ id, mtime }] }.
  // Per-field stamps c.fm + c.mtime (CT-PF, contacts/merge.js): the
  // app stamps every changed field in saveState → merge.restamp; the
  // Assistant writes with the app closed, so it stamps here the same
  // way (ctRestamp = merge.js restamp). Life against a tombstone is
  // decided by c.mtime > deleted[].mtime (contacts.js mergeContacts).
  // phone / email ADD a value the contact doesn't have yet; nothing is
  // ever taken away from the lists. date = the birthday.
  // A delete goes through like the app's own: the phone bridge
  // (BR-PHONE) mirrors the whole slice, so the contact leaves the
  // phone's "orOS" account on the next snapshot, exactly as when it
  // is deleted in Contacts; Undo brings it back there too.
  var CT_OLD = ["given", "middle", "family", "nickname", "org", "jobTitle",
    "phones", "emails", "addresses", "websites", "im", "events", "relations",
    "labelIds", "starred", "note", "avatar"];
  var CT_NEW = ["keep", "seen"];
  var CT_FIELDS = CT_OLD.concat(CT_NEW);
  var CT_STAMPS = CT_FIELDS.concat(["log"]);
  // what this adapter may change (and Undo puts back)
  var CT_RAW = ["given", "middle", "family", "nickname", "org", "jobTitle", "phones", "emails", "addresses", "websites", "events", "labelIds", "note"];
  function ctNum(v) { return typeof v === "number" && isFinite(v); }
  function ctJ(v) { return JSON.stringify(v === undefined ? null : v); }
  function ctMaxStamp(c) {
    var mx = 0;
    if (isObj(c.fm)) CT_STAMPS.forEach(function (f) { if (ctNum(c.fm[f]) && c.fm[f] > mx) mx = c.fm[f]; });
    return mx;
  }
  function ctOldCode(c) { return isObj(c.fm) && (c.mtime || 0) > ctMaxStamp(c); }
  function ctFieldStamp(c, f) {
    if (CT_NEW.indexOf(f) !== -1 || f === "log") {
      if (f !== "log" && !has(c, f)) return -1;
      return (isObj(c.fm) && ctNum(c.fm[f])) ? c.fm[f] : 0;
    }
    if (!isObj(c.fm) || ctOldCode(c)) return c.mtime || 0;
    return ctNum(c.fm[f]) ? c.fm[f] : 0;
  }
  // merge.js restamp(prev, cur, now) for a cur whose mtime the caller
  // left as it was: the changed fields get one stamp newer than every
  // stamp of prev, the others keep theirs.
  function ctRestamp(prev, cur, now) {
    var changed = CT_FIELDS.filter(function (f) { return ctJ(prev[f]) !== ctJ(cur[f]) || has(prev, f) !== has(cur, f); });
    if (!changed.length) return false;
    var fm = {};
    CT_STAMPS.forEach(function (f) {
      var st = ctFieldStamp(prev, f);
      if (st >= 0 && (f !== "log" || st > 0)) fm[f] = st;
    });
    var s = stampAfter(now, Math.max(prev.mtime || 0, ctMaxStamp(prev)));
    changed.forEach(function (f) { fm[f] = s; });
    CT_NEW.forEach(function (f) { if (!has(cur, f)) delete fm[f]; });
    cur.fm = fm;
    cur.mtime = s;
    return true;
  }
  // merge.js restamp(null, cur): a contact put back whole speaks with
  // one stamp for every field it has.
  function ctStampAll(c, s) {
    var fm = {};
    CT_FIELDS.forEach(function (f) { if (CT_NEW.indexOf(f) === -1 || has(c, f)) fm[f] = s; });
    if ((Array.isArray(c.log) && c.log.length) || (isObj(c.logDel) && Object.keys(c.logDel).length)) fm.log = s;
    c.mtime = s;
    c.fm = fm;
  }
  function ctTomb(d, id) {
    var t = -1;
    (Array.isArray(d.deleted) ? d.deleted : []).forEach(function (x) { if (isObj(x) && x.id === id && ctNum(x.mtime) && x.mtime > t) t = x.mtime; });
    return t;
  }
  function ctFind(d, target) {
    if (!isObj(d) || !Array.isArray(d.contacts)) return null;
    var id = typeof target === "string" ? target : (isObj(target) && typeof target.id === "string" ? target.id : "");
    if (!id) return null;
    for (var i = 0; i < d.contacts.length; i++) {
      var c = d.contacts[i];
      if (isObj(c) && c.id === id) {
        var t = ctTomb(d, id);
        if (t >= 0 && !((c.mtime || 0) > t)) return null;      // dead by its tombstone
        return { c: c, i: i };
      }
    }
    return null;
  }
  function ctStr(v) { return typeof v === "string" ? v.trim() : ""; }
  function ctName(c) {
    var n = [ctStr(c.given), ctStr(c.middle), ctStr(c.family)].filter(Boolean).join(" ");
    return n || ctStr(c.nickname) || ctStr(c.org);
  }
  function ctVals(arr) {
    return (Array.isArray(arr) ? arr : []).map(function (x) { return isObj(x) ? ctStr(x.v) : ""; }).filter(Boolean);
  }
  function ctBday(c) {
    var ev = (Array.isArray(c.events) ? c.events : []).filter(function (e) { return isObj(e) && e.type === "birthday" && typeof e.day === "string"; })[0];
    if (!ev) return "";
    return (typeof ev.year === "number" ? String(ev.year) : "-") + "-" + ev.day;
  }
  // The user's contact labels (contacts.js state.labels; untouched
  // seeds are stored in the device's language, either name finds them).
  function ctLabels(d) {
    return (Array.isArray(d.labels) ? d.labels : []).filter(function (l) {
      return isObj(l) && typeof l.id === "string" && typeof l.name === "string";
    }).map(function (l) {
      var k = "cal." + l.id;
      return { id: l.id, names: l.mtime === 0 && has(CAL_SEEDS.en, k) ? [l.name, CAL_SEEDS.en[k], CAL_SEEDS.el[k]].filter(function (n, i, a) { return a.indexOf(n) === i; }) : [l.name] };
    });
  }
  function ctView(c, d) {
    var ls = ctLabels(d);
    return {
      title: ctName(c),
      nickname: ctStr(c.nickname),
      org: ctStr(c.org),
      job: ctStr(c.jobTitle),
      phone: ctVals(c.phones).join(", "),
      email: ctVals(c.emails).join(", "),
      address: (Array.isArray(c.addresses) ? c.addresses : []).map(ctAddrLine).filter(Boolean).join(" · "),
      website: ctVals(c.websites).join(", "),
      birthday: ctBday(c),
      labels: (Array.isArray(c.labelIds) ? c.labelIds : []).map(function (id) {
        var l = ls.filter(function (x) { return x.id === id; })[0];
        return l ? l.names[0] : "";
      }).filter(Boolean).join(", "),
      note: typeof c.note === "string" ? c.note : ""
    };
  }
  function ctAddrLine(a) {
    if (!isObj(a)) return "";
    var place = [ctStr(a.zip), ctStr(a.city)].filter(Boolean).join(" ");
    return [ctStr(a.street), place, ctStr(a.region), ctStr(a.country)].filter(Boolean).join(", ");
  }
  function ctWeb(v) { return String(v || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, ""); }
  // Replace the value matching `old` in a { v, type } list (its type
  // stays), or add `nv` when there is no `old`; a value already there
  // is not added twice. → the new list | null (old not found)
  function ctPut(list, nv, old, same, type) {
    var out = (Array.isArray(list) ? list : []).map(clone);
    if (old) {
      var at = -1;
      out.forEach(function (x, i) { if (at < 0 && isObj(x) && same(ctStr(x.v), old)) at = i; });
      if (at < 0) return null;
      out[at] = { v: nv, type: out[at].type || type };
      return out.filter(function (x, i) { return i === at || !(isObj(x) && same(ctStr(x.v), nv)); });
    }
    if (out.some(function (x) { return isObj(x) && same(ctStr(x.v), nv); })) return out;
    return out.concat([{ v: nv, type: type }]);
  }
  function ctDigits(s) { return String(s || "").replace(/\D+/g, ""); }
  // "+30 69…" and "69…" are the same number (8+ digits in common at the end)
  function ctSamePhone(a, b) {
    var x = ctDigits(a), y = ctDigits(b);
    if (!x || !y) return false;
    if (x === y) return true;
    var lo = x.length < y.length ? x : y, hi = lo === x ? y : x;
    return lo.length >= 8 && hi.slice(-lo.length) === lo;
  }
  // contacts.js sanitizeContact event order: type, then day
  function ctEvSort(a, b) { return a.type < b.type ? -1 : (a.type > b.type ? 1 : (a.day < b.day ? -1 : 1)); }

  function contactsChange(d, target, ch, now) {
    var h = ctFind(d, target);
    if (!h) return bad("That contact is no longer in Contacts.");
    var c = h.c, before = ctView(c, d), title = before.title || before.phone || before.email;
    if (ch.action !== "update" && ch.action !== "delete") return bad("A contact can only be updated or deleted.");
    if (ch.action === "delete") {
      var copy = clone(c);
      d.contacts.splice(h.i, 1);
      var tm = stampAfter(now, Math.max(c.mtime || 0, ctMaxStamp(c), ctTomb(d, c.id)));
      d.deleted = (Array.isArray(d.deleted) ? d.deleted : []).filter(function (x) { return !(isObj(x) && x.id === c.id); });
      d.deleted.push({ id: c.id, mtime: tm });
      return { ok: true, title: title, before: before, after: null, del: true,
               undo: { t: "del", app: "contacts", index: h.i, c: copy } };
    }
    var s = ch.set;
    var notOk = Object.keys(s).filter(function (k) { return !SETTABLE.contacts[k]; });
    if (notOk.length) return bad("A contact has no " + notOk.join(", ") + " here (date is the birthday).");
    var prev = clone(c);
    if (has(s, "title") && s.title !== before.title) {
      var w = s.title.split(" ").filter(Boolean), g, m = "", f = "";
      if (w.length === 1) g = w[0];
      else if (w.length >= 3 && ctStr(c.middle)) { g = w[0]; f = w[w.length - 1]; m = w.slice(1, -1).join(" "); }
      else { f = w.pop(); g = w.join(" "); }
      if (g.length > 60 || m.length > 60 || f.length > 60) return bad("That name is too long for Contacts (60 characters per part).");
      c.given = g; c.middle = m; c.family = f;
    }
    if (has(s, "org")) c.org = s.org.slice(0, 80);
    if (!ctName(c)) return bad("A contact needs a name or a company; it would have neither.");
    if (has(s, "nickname")) c.nickname = s.nickname.slice(0, 60);
    if (has(s, "job_title")) c.jobTitle = s.job_title.slice(0, 80);
    var back = function (msg) { CT_RAW.forEach(function (k) { if (has(prev, k)) c[k] = prev[k]; else delete c[k]; }); return bad(msg); };
    var lists = [["phone", "phones", 40, "mobile", ctSamePhone, "number"],
                 ["email", "emails", 120, "home", function (a, b) { return a.toLowerCase() === b.toLowerCase(); }, "e-mail"],
                 ["website", "websites", 300, "home", function (a, b) { return ctWeb(a) === ctWeb(b); }, "website"]];
    for (var li = 0; li < lists.length; li++) {
      var L = lists[li];
      if (!has(s, L[0])) continue;
      var nl2 = ctPut(c[L[1]], s[L[0]].slice(0, L[2]), s["old_" + L[0]] || "", L[4], L[3]);
      if (!nl2) return back("old_" + L[0] + " " + s["old_" + L[0]] + " is not one of the contact's " + L[5] + "s; to add a " + L[5] + ", leave old_" + L[0] + " out.");
      if (ctJ(nl2) !== ctJ(c[L[1]])) c[L[1]] = nl2;
    }
    if (has(s, "address")) {
      var na = s.address, adds = (Array.isArray(c.addresses) ? c.addresses : []).map(clone), key = ctAddrLine(na).toLowerCase();
      if (!adds.some(function (x) { return ctAddrLine(x).toLowerCase() === key; })) {
        var at = -1;
        if (s.address_replace) {
          adds.forEach(function (x, i) { if (at < 0 && isObj(x) && x.type === na.type) at = i; });
          if (at < 0 && adds.length === 1) at = 0;
        }
        var row = { street: na.street, city: na.city, zip: na.zip, region: na.region, country: na.country, type: na.type };
        if (at >= 0) adds[at] = row; else adds.push(row);
        c.addresses = adds;
      }
    }
    if (has(s, "date")) {
      var y = +s.date.slice(0, 4), day = s.date.slice(5);
      if (y < 1850 || y > 2200) return bad("A birthday year must be between 1850 and 2200.");
      var evs = (Array.isArray(c.events) ? c.events : []).map(clone), done = false;
      evs.forEach(function (e) {
        if (done || !isObj(e) || e.type !== "birthday") return;
        e.day = day; e.year = y; done = true;
      });
      if (!done) evs.push({ day: day, year: y, type: "birthday", label: "" });
      if (ctJ(evs) !== ctJ(c.events)) c.events = evs.sort(ctEvSort);
    }
    if (has(s, "note")) {
      if (s.note.length > CT_NOTE) return back("The note is " + s.note.length + " characters; Contacts keeps " + CT_NOTE + ". Shorten it; nothing is cut for you.");
      c.note = s.note;
    }
    if (has(s, "note_add")) {
      var old = typeof c.note === "string" ? c.note.trim() : "", add = s.note_add.trim();
      if (old.indexOf(add) < 0) {
        var nn = old ? old + "\n" + add : add;
        if (nn.length > CT_NOTE) return back("The note would be " + nn.length + " characters; Contacts keeps " + CT_NOTE + ". Shorten note_add (" + Math.max(0, CT_NOTE - old.length - (old ? 1 : 0)) + " characters are free) or rewrite the whole note with note.");
        c.note = nn;
      }
    }
    if (has(s, "label") || has(s, "labels")) {
      var nl = newLabelIds(ctLabels(d), Array.isArray(c.labelIds) ? c.labelIds : [], s, "Contacts", "Contacts (Labels)");
      if (nl.err) { CT_RAW.forEach(function (k) { if (has(prev, k)) c[k] = prev[k]; else delete c[k]; }); return bad(nl.err); }
      var sorted = nl.ids.slice().sort();          // contacts.js sanitizeContact
      if (ctJ(sorted) !== ctJ(Array.isArray(c.labelIds) ? c.labelIds : [])) c.labelIds = sorted;
    }
    if (!ctRestamp(prev, c, now)) {
      CT_RAW.forEach(function (k) { if (has(prev, k)) c[k] = prev[k]; else delete c[k]; });
      return bad("Nothing would change: the contact already looks like that.");
    }
    var p = {}, n = {};
    CT_RAW.forEach(function (k) {
      if (ctJ(prev[k]) === ctJ(c[k])) return;
      p[k] = has(prev, k) ? clone(prev[k]) : null;
      n[k] = clone(c[k]);
    });
    return { ok: true, title: title, before: before, after: ctView(c, d), del: false,
             undo: { t: "set", app: "contacts", target: c.id, prev: p, next: n } };
  }
  function contactsUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.contacts)) return bad("Contacts has no contacts.");
    if (u.t === "del") {
      if (!isObj(u.c) || typeof u.c.id !== "string" || !ID_RE.test(u.c.id)) return bad("bad undo");
      for (var j = 0; j < d.contacts.length; j++) if (isObj(d.contacts[j]) && d.contacts[j].id === u.c.id) return bad("The contact is back already.");
      var c = clone(u.c);
      ctStampAll(c, stampAfter(now, Math.max(c.mtime || 0, ctMaxStamp(c), ctTomb(d, c.id))));
      var at = Math.max(0, Math.min(d.contacts.length, Math.floor(u.index) || 0));
      d.contacts.splice(at, 0, c);
      if (Array.isArray(d.deleted)) d.deleted = d.deleted.filter(function (x) { return !(isObj(x) && x.id === c.id); });
      return { ok: true };
    }
    var h = ctFind(d, u.target);
    if (!h) return bad("That contact is no longer in Contacts.");
    var keys = Object.keys(u.next || {}).filter(function (k) { return CT_RAW.indexOf(k) >= 0; });
    for (var i = 0; i < keys.length; i++) {
      if (ctJ(h.c[keys[i]]) !== ctJ(u.next[keys[i]])) return bad("The contact changed since; nothing was undone.");
    }
    var prev = clone(h.c);
    keys.forEach(function (k) {
      var v = u.prev ? u.prev[k] : null;
      if (v === null || v === undefined) delete h.c[k]; else h.c[k] = clone(v);
    });
    ctRestamp(prev, h.c, now);
    return { ok: true };
  }

  // ---------- 7. Kanban ----------
  // kanban/model.js (K1): per-field card stamps card.fm (groups t text,
  // n notes, d due, p column, …; fm.m = the card's mtime, else the card
  // counts as an older whole-card write), stampCard = max(now, mtime + 1);
  // tombstones per board deleted { cardId: ts } (a card is alive while
  // mtime > ts); the column order stamp col.om; the stored copy is the
  // canonical form (canonState: CARD/COL/BOARD key order, pos numbered,
  // fm and tombstone keys sorted). A Kanban card has no done flag.
  var KB_GROUPS = ["a", "c", "d", "k", "l", "n", "p", "s", "t", "x"];
  var KB_CARD_KEYS = ["id", "text", "notes", "due", "labels", "subtasks", "info", "mtime", "pos"];
  var KB_COL_KEYS = ["id", "name", "mtime", "om", "pos", "cards"];
  var KB_BOARD_KEYS = ["id", "name", "archived", "color", "mtime", "om", "pos", "deleted", "labels", "columns"];
  function kbOrder(obj, keys) {
    var out = {};
    keys.forEach(function (k) { if (obj[k] !== undefined) out[k] = obj[k]; });
    Object.keys(obj).sort().forEach(function (k) { if (keys.indexOf(k) < 0 && obj[k] !== undefined) out[k] = obj[k]; });
    return out;
  }
  // The board as canonState writes it (only key order, pos, sorted maps).
  function kbCanon(d, bi) {
    var b = d.boards[bi];
    b.deleted = sortedObj(isObj(b.deleted) ? b.deleted : {});
    b.columns = b.columns.map(function (col, ci) {
      if (!isObj(col)) return col;
      col.pos = ci;
      col.cards = (Array.isArray(col.cards) ? col.cards : []).map(function (c, ki) {
        if (!isObj(c)) return c;
        c.pos = ki;
        if (isObj(c.fm)) c.fm = sortedObj(c.fm);
        return kbOrder(c, KB_CARD_KEYS);
      });
      return kbOrder(col, KB_COL_KEYS);
    });
    d.boards[bi] = kbOrder(b, KB_BOARD_KEYS);
  }
  function kbFmValid(c) { return isObj(c.fm) && typeof c.fm.m === "number" && c.fm.m === (c.mtime || 0); }
  // model.js stampCard: an older card gets its fm first (every group at
  // its old mtime), then the edited groups (null = all) take the stamp.
  function kbStamp(c, groups, now, floor) {
    var t = stampAfter(now, Math.max(c.mtime || 0, floor || 0));
    if (!kbFmValid(c) || !groups) {
      var base = groups ? (c.mtime || 0) : t;
      c.fm = {};
      KB_GROUPS.forEach(function (g) { c.fm[g] = base; });
    }
    (groups || []).forEach(function (g) { c.fm[g] = t; });
    c.mtime = t;
    c.fm.m = t;
    return t;
  }
  function kbBoard(d, id) {
    if (!isObj(d) || !Array.isArray(d.boards) || typeof id !== "string") return -1;
    for (var i = 0; i < d.boards.length; i++) {
      var b = d.boards[i];
      if (isObj(b) && b.id === id && Array.isArray(b.columns)) return i;
    }
    return -1;
  }
  // The card by id anywhere on its board (it may have moved column).
  function kbFind(d, target) {
    if (!isObj(target) || typeof target.card !== "string") return null;
    var bi = kbBoard(d, target.board);
    if (bi < 0) return null;
    var b = d.boards[bi];
    for (var ci = 0; ci < b.columns.length; ci++) {
      var col = b.columns[ci];
      if (!isObj(col) || !Array.isArray(col.cards)) continue;
      for (var ki = 0; ki < col.cards.length; ki++) {
        if (isObj(col.cards[ki]) && col.cards[ki].id === target.card) return { bi: bi, b: b, ci: ci, col: col, ki: ki, card: col.cards[ki] };
      }
    }
    return null;
  }
  function kbName(v) { return line(typeof v === "string" ? v : "", 1000); }
  function kbArr(a) { return Array.isArray(a) ? a : []; }
  function kbLabel(b, id) {
    var ls = kbArr(b.labels);
    for (var i = 0; i < ls.length; i++) if (isObj(ls[i]) && ls[i].id === id) return ls[i];
    return null;
  }
  // pos = also where the card sits in its column (only for a move).
  function kbView(b, col, c, pos) {
    var subs = kbArr(c.subtasks).filter(isObj);
    var v = {
      title: typeof c.text === "string" ? c.text : "",
      column: kbName(col.name),
      due: realDate(c.due),
      labels: kbArr(c.labels).map(function (id) { var l = kbLabel(b, id); return l ? kbName(l.name) : ""; }).filter(Boolean).join(", "),
      subtasks: subs.length ? subs.filter(function (x) { return x.completed; }).length + "/" + subs.length : "",
      note: typeof c.notes === "string" ? c.notes : ""
    };
    if (pos) v.position = (col.cards.indexOf(c) + 1) + "/" + col.cards.length;
    return v;
  }
  function kbLocalDay(now) {
    var t = new Date(now), m = t.getMonth() + 1, d = t.getDate();
    return t.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
  }
  // kanban/tools.js applyArrival, the same rules in the same order and
  // with the same stamps: the card has just arrived at the end of col.
  // → the raw fields it changed (for undo).
  function kbArrival(b, col, c, now) {
    var auto = isObj(col.auto) ? col.auto : null, did = {};
    if (!auto) return did;
    if (auto.done && kbArr(c.subtasks).some(function (x) { return x && !x.completed; })) {
      var at = kbStamp(c, ["s"], now);
      c.subtasks.forEach(function (x) { if (x && !x.completed) { x.completed = true; x.m = at; } });
      did.subtasks = 1;
    }
    var today = kbLocalDay(now);
    if (auto.today && c.due !== today) { c.due = today; kbStamp(c, ["d"], now); did.due = 1; }
    if (auto.label && kbLabel(b, auto.label) && kbArr(c.labels).indexOf(auto.label) < 0) {
      c.labels = kbArr(c.labels).concat([auto.label]);
      kbStamp(c, ["l"], now);
      did.labels = 1;
    }
    var i = col.cards.indexOf(c);
    if (auto.top && i > 0) {
      col.cards.splice(i, 1);
      col.cards.unshift(c);
      col.om = Math.max(now, (col.om || 0) + 1);
    }
    return did;
  }
  function kbNoM(list) {
    return kbArr(list).map(function (x) { if (!isObj(x)) return x; var y = clone(x); delete y.m; return y; });
  }
  function kbRaw(h) {
    return { text: h.card.text, notes: h.card.notes, due: h.card.due === undefined ? null : h.card.due, col: h.col.id,
             labels: clone(kbArr(h.card.labels)), subtasks: clone(kbArr(h.card.subtasks)) };
  }

  function kanbanChange(d, target, ch, now) {
    var h = kbFind(d, target);
    if (!h) return bad("That card is no longer in Kanban.");
    var b = h.b, card = h.card, before = kbView(b, h.col, card, ch.action === "move"), title = before.title;
    if (b.archived || (typeof b.id === "string" && b.id.indexOf("tpl-") === 0)) return bad("That card's board is archived; change it in Kanban.");
    if (isObj(d.boardDeleted) && typeof d.boardDeleted[b.id] === "number" && d.boardDeleted[b.id] >= (b.mtime || 0)) return bad("That card's board was deleted.");
    if (ch.action === "complete" || ch.action === "reopen") return bad("A Kanban card has no done mark; move it to another column instead.");
    if (ch.action === "delete") {
      if (Array.isArray(card.att) && card.att.length) return bad("That card has attachments on the orOS disk; delete it in Kanban.");
      var copy = clone(card);
      h.col.cards.splice(h.ki, 1);
      if (!isObj(b.deleted)) b.deleted = {};
      b.deleted[card.id] = stampAfter(now, Math.max(b.deleted[card.id] || 0, card.mtime || 0));
      kbCanon(d, h.bi);
      return { ok: true, title: title, before: before, after: null, del: true,
               undo: { t: "del", app: "kanban", board: b.id, col: h.col.id, index: h.ki, card: copy } };
    }
    var prev = kbRaw(h), idx = h.ki;
    if (ch.action === "move") {
      var want = ch.set.column.toLowerCase();
      var hits = b.columns.filter(function (c) { return isObj(c) && Array.isArray(c.cards) && kbName(c.name).toLowerCase() === want; });
      var names = b.columns.filter(isObj).map(function (c) { return kbName(c.name); }).join(", ");
      if (!hits.length) return bad("The board " + kbName(b.name) + " has no column " + ch.set.column + ". Its columns: " + names + ".");
      if (hits.length > 1) return bad("The board " + kbName(b.name) + " has more than one column called " + ch.set.column + "; move the card in Kanban.");
      var dest = hits[0];
      if (dest === h.col) return bad("The card is already in " + kbName(dest.name) + ".");
      // kanban.js moveCardTo: to the end of the column, column stamp p,
      // both columns' order stamp om, then the column's arrival rules.
      h.col.cards.splice(h.ki, 1);
      dest.cards.push(card);
      kbStamp(card, ["p"], now);
      h.col.om = stampAfter(now, h.col.om);
      dest.om = stampAfter(now, dest.om);
      var did = kbArrival(b, dest, card, now);
      var nxt = { col: dest.id }, pv0 = { col: prev.col };
      if (did.subtasks) { nxt.subtasks = kbNoM(card.subtasks); pv0.subtasks = prev.subtasks; }
      if (did.due) { nxt.due = card.due; pv0.due = prev.due; }
      if (did.labels) { nxt.labels = clone(card.labels); pv0.labels = prev.labels; }
      kbCanon(d, h.bi);
      var h2 = kbFind(d, { board: b.id, card: card.id });
      return { ok: true, title: title, before: before, after: kbView(h2.b, h2.col, h2.card, true), del: false,
               undo: { t: "set", app: "kanban", target: { board: b.id, card: card.id }, index: idx, prev: pv0, next: nxt } };
    }
    var s = ch.set;
    if (s.start || s.end) return bad("A Kanban card has a due date only, no start or end time.");
    var notOk = Object.keys(s).filter(function (k) { return !SETTABLE.kanban[k]; });
    if (notOk.length) return bad("A Kanban card has no " + notOk.join(", ") + ".");
    var groups = [], next = {};
    if (has(s, "title") && s.title.slice(0, 500) !== card.text) { card.text = s.title.slice(0, 500); groups.push("t"); next.text = card.text; }
    if (has(s, "note") && s.note !== (typeof card.notes === "string" ? card.notes : "")) { card.notes = s.note; groups.push("n"); next.notes = card.notes; }
    if (has(s, "date") && s.date !== card.due) { card.due = s.date; groups.push("d"); next.due = card.due; }
    if (has(s, "label") || has(s, "labels")) {
      var bl = kbArr(b.labels).filter(function (l) { return isObj(l) && typeof l.id === "string" && typeof l.name === "string"; })
        .map(function (l) { return { id: l.id, names: [kbName(l.name)] }; });
      var nl = newLabelIds(bl, kbArr(card.labels), s, "The board " + kbName(b.name), "Kanban (the board's labels)");
      if (nl.err) return bad(nl.err);
      if (JSON.stringify(nl.ids) !== JSON.stringify(kbArr(card.labels))) { card.labels = nl.ids; groups.push("l"); next.labels = clone(nl.ids); }
    }
    if (!groups.length) return bad("Nothing would change: the card already looks like that.");
    kbStamp(card, groups, now);
    kbCanon(d, h.bi);
    var h3 = kbFind(d, { board: b.id, card: card.id });
    var p2 = {};
    Object.keys(next).forEach(function (k) { p2[k] = prev[k] === undefined ? null : prev[k]; });
    return { ok: true, title: title, before: before, after: kbView(h3.b, h3.col, h3.card), del: false,
             undo: { t: "set", app: "kanban", target: { board: b.id, card: card.id }, prev: p2, next: next } };
  }
  function kanbanUndo(d, u, now) {
    if (u.t === "del") {
      if (!isObj(u.card) || typeof u.card.id !== "string" || !ID_RE.test(u.card.id)) return bad("bad undo");
      var bi = kbBoard(d, u.board);
      if (bi < 0) return bad("Its board is gone.");
      if (kbFind(d, { board: u.board, card: u.card.id })) return bad("The card is back already.");
      var b = d.boards[bi], col = null;
      b.columns.forEach(function (c) { if (isObj(c) && c.id === u.col && Array.isArray(c.cards)) col = c; });
      if (!col) return bad("Its column is gone.");
      var c = clone(u.card);
      // kanban.js undo of a delete: every field group stamped anew.
      kbStamp(c, null, now, (isObj(b.deleted) && b.deleted[c.id]) || 0);
      var at = Math.max(0, Math.min(col.cards.length, Math.floor(u.index) || 0));
      col.cards.splice(at, 0, c);
      col.om = stampAfter(now, col.om);
      if (isObj(b.deleted)) delete b.deleted[c.id];
      kbCanon(d, bi);
      return { ok: true };
    }
    var h = kbFind(d, u.target);
    if (!h) return bad("That card is no longer in Kanban.");
    var cur = kbRaw(h), nx = isObj(u.next) ? u.next : {}, pv = isObj(u.prev) ? u.prev : {};
    cur.subtasks = kbNoM(cur.subtasks);
    var keys = Object.keys(nx).filter(function (k) { return ["text", "notes", "due", "col", "labels", "subtasks"].indexOf(k) >= 0; });
    for (var i = 0; i < keys.length; i++) {
      if (JSON.stringify(cur[keys[i]] === undefined ? null : cur[keys[i]]) !== JSON.stringify(nx[keys[i]])) return bad("The card changed since; nothing was undone.");
    }
    var groups = [];
    if (has(nx, "col")) {
      var back = null;
      h.b.columns.forEach(function (c) { if (isObj(c) && c.id === pv.col && Array.isArray(c.cards)) back = c; });
      if (!back) return bad("Its old column is gone.");
      h.col.cards.splice(h.ki, 1);
      back.cards.splice(Math.max(0, Math.min(back.cards.length, Math.floor(u.index) || 0)), 0, h.card);
      h.col.om = stampAfter(now, h.col.om);
      back.om = stampAfter(now, back.om);
      groups.push("p");
    }
    if (has(nx, "text")) { h.card.text = typeof pv.text === "string" ? pv.text : ""; groups.push("t"); }
    if (has(nx, "notes")) { h.card.notes = typeof pv.notes === "string" ? pv.notes : ""; groups.push("n"); }
    if (has(nx, "due")) { h.card.due = typeof pv.due === "string" && pv.due ? pv.due : null; groups.push("d"); }
    if (has(nx, "labels")) { h.card.labels = clone(kbArr(pv.labels)); groups.push("l"); }
    if (has(nx, "subtasks")) groups.push("s");
    if (!groups.length) return bad("bad undo");
    var st = kbStamp(h.card, groups, now);
    // subtasks merge per item on its m: the put-back items carry the new stamp
    if (has(nx, "subtasks")) h.card.subtasks = clone(kbArr(pv.subtasks)).map(function (x) { if (isObj(x)) x.m = st; return x; });
    kbCanon(d, h.bi);
    return { ok: true };
  }

  // ---------- Media Shelf ----------
  // oros-shelf-data = { ver, items[] by id, sess[] by id, goals, tombs
  // { id: ts } } (shelf.js section 2–3, mergeShelf). Items LWW on it.m,
  // sessions (the status / progress log) LWW on s.m, tombstones shared
  // by items and sessions, max-merged; a tombstone at or after m hides
  // the row, a newer m resurrects (R17). Canonical: items and sess
  // sorted by id, tombs sorted. A status change logs what setStatus
  // logs: now → a start "s"; done → the missing pages as "p" (when the
  // type has progress and a size) and a finish "d" dated today (the
  // finished date); dropped → "x". Undo tombstones those sessions,
  // as the app's own Undo does.
  var SH_ST = { want: "want", now: "now", done: "done", dropped: "drop" };
  var SH_ST_NAME = { want: "want", now: "now", done: "done", drop: "dropped" };
  var SH_KIND = { book: "book", film: "film", series: "series", album: "music", podcast: "podcast", game: "game" };
  var SH_ID = /^[a-z0-9]{6,40}$/;
  function shYmd(now) {
    var d = new Date(now), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function shTombs(d) { return isObj(d.tombs) ? d.tombs : {}; }
  function shLive(d, x) {
    var tb = shTombs(d)[x.id];
    return !(typeof tb === "number" && tb >= (Number(x.m) || 0));
  }
  function shFind(d, target) {
    if (!isObj(d) || !Array.isArray(d.items) || !isObj(target) || typeof target.item !== "string") return null;
    for (var i = 0; i < d.items.length; i++) {
      var it = d.items[i];
      if (isObj(it) && it.id === target.item && shLive(d, it)) return { it: it, i: i };
    }
    return null;
  }
  function shView(it) {
    return {
      title: typeof it.title === "string" ? it.title : "",
      kind: SH_KIND[it.type] || "",
      status: SH_ST_NAME[it.st] || "want",
      note: typeof it.rev === "string" ? it.rev : ""
    };
  }
  function shSessOf(d, id) {
    return (Array.isArray(d.sess) ? d.sess : []).filter(function (s) { return isObj(s) && s.it === id && shLive(d, s); })
      .sort(function (x, y) { return cmpStr(String(x.d), String(y.d)) || ((x.m || 0) - (y.m || 0)) || cmpStr(String(x.id), String(y.id)); });
  }
  // shelf.js progressOf: the highest page of the current run.
  function shProgress(list) {
    var at = 0, v = 0;
    list.forEach(function (s, i) { if (s.k === "s") at = i; });
    list.slice(at).forEach(function (s) { if (s.k === "p" && typeof s.v === "number" && s.v > v) v = s.v; });
    return v;
  }
  function shNewId(d, t, k, itemId) {
    var used = {};
    (Array.isArray(d.sess) ? d.sess : []).forEach(function (s) { if (isObj(s)) used[s.id] = 1; });
    Object.keys(shTombs(d)).forEach(function (id) { used[id] = 1; });
    var base = t.toString(36) + k + itemId.slice(0, 16), id = base, n = 0;
    while (used[id]) id = base + (++n);
    return id;
  }
  function shSortRows(d) {
    var by = function (p, q) { return cmpStr(String(p && p.id), String(q && q.id)); };
    if (Array.isArray(d.items)) d.items.sort(by);
    if (Array.isArray(d.sess)) d.sess.sort(by);
    d.tombs = sortedObj(shTombs(d));
  }
  function shTomb(d, x, now) {
    if (!isObj(d.tombs)) d.tombs = {};
    d.tombs[x.id] = stampAfter(now, Math.max(d.tombs[x.id] || 0, x.m || 0));
  }

  function shelfChange(d, target, ch, now) {
    var h = shFind(d, target);
    if (!h) return bad("That title is no longer on the Media Shelf.");
    var it = h.it, before = shView(it), title = before.title;
    if (ch.action === "delete") {
      var copy = clone(it), ss = shSessOf(d, it.id).map(clone);
      var gone = {};
      ss.forEach(function (s) { gone[s.id] = 1; });
      d.items.splice(h.i, 1);
      shTomb(d, it, now);
      ss.forEach(function (s) { shTomb(d, s, now); });
      if (Array.isArray(d.sess)) d.sess = d.sess.filter(function (s) { return !(isObj(s) && gone[s.id]); });
      shSortRows(d);
      return { ok: true, title: title, before: before, after: null, del: true,
               undo: { t: "del", app: "shelf", item: copy, sess: ss } };
    }
    if (ch.action !== "update") return bad("A Media Shelf title takes update (status, title, note) or delete.");
    var s = ch.set;
    var notOk = Object.keys(s).filter(function (k) { return !SETTABLE.shelf[k]; });
    if (notOk.length) return bad("A Media Shelf title has no " + notOk.join(", ") + ".");
    var prev = { title: it.title, st: it.st, rev: typeof it.rev === "string" ? it.rev : "" }, changed = false, added = [];
    if (has(s, "title")) {
      var ti = line(s.title, 200);
      if (ti && ti !== it.title) { it.title = ti; changed = true; }
    }
    if (has(s, "note")) {
      var rv = s.note.replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
      if (rv !== prev.rev) { it.rev = rv; changed = true; }
    }
    var st = has(s, "status") ? SH_ST[s.status] : "";
    if (st && st !== it.st) {
      var t = Math.floor(now) || 0, day = shYmd(t);
      if (!Array.isArray(d.sess)) d.sess = [];
      var log = function (k, v) {
        var x = { id: shNewId(d, t, k, it.id), m: t, it: it.id, k: k, d: day };
        if (k === "p") x.v = v;
        d.sess.push(x);
        added.push(x.id);
      };
      if (st === "now") log("s");
      if (st === "done") {
        var prog = it.type === "book" || it.type === "series" || it.type === "podcast" || it.type === "game";
        if (prog && typeof it.size === "number" && it.size > 0 && shProgress(shSessOf(d, it.id)) < it.size) log("p", it.size);
        log("d");
      }
      if (st === "drop") log("x");
      it.st = st;
      changed = true;
    }
    if (!changed) return bad("Nothing would change: the title already looks like that.");
    it.m = stampAfter(now, it.m);
    shSortRows(d);
    return { ok: true, title: title, before: before, after: shView(it), del: false,
             undo: { t: "set", app: "shelf", target: { item: it.id }, prev: prev,
                     next: { title: it.title, st: it.st, rev: it.rev }, sess: added } };
  }
  function shelfUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.items)) return bad("The Media Shelf is empty.");
    if (u.t === "del") {
      if (!isObj(u.item) || typeof u.item.id !== "string" || !SH_ID.test(u.item.id)) return bad("bad undo");
      if (shFind(d, { item: u.item.id })) return bad("The title is back already.");
      // shelf.js deleteItem's Undo: a newer m resurrects past the
      // tombstones, which stay (they may already have travelled).
      var tb = shTombs(d);
      d.items = d.items.filter(function (x) { return !(isObj(x) && x.id === u.item.id); });
      var it = clone(u.item);
      it.m = stampAfter(now, Math.max(it.m || 0, tb[it.id] || 0));
      d.items.push(it);
      if (!Array.isArray(d.sess)) d.sess = [];
      (Array.isArray(u.sess) ? u.sess : []).forEach(function (s0) {
        if (!isObj(s0) || typeof s0.id !== "string" || !SH_ID.test(s0.id)) return;
        var s = clone(s0);
        d.sess = d.sess.filter(function (x) { return !(isObj(x) && x.id === s.id); });
        s.m = stampAfter(now, Math.max(s.m || 0, tb[s.id] || 0));
        d.sess.push(s);
      });
      shSortRows(d);
      return { ok: true };
    }
    var h = shFind(d, u.target);
    if (!h) return bad("That title is no longer on the Media Shelf.");
    var cur = h.it, nx = u.next || {};
    if (cur.title !== nx.title || cur.st !== nx.st || (cur.rev || "") !== (nx.rev || "")) {
      return bad("The title changed since; nothing was undone.");
    }
    var p = u.prev || {};
    if (typeof p.title === "string" && p.title) cur.title = p.title;
    if (has(SH_ST_NAME, p.st)) cur.st = p.st;
    cur.rev = typeof p.rev === "string" ? p.rev : "";
    var drop = {};
    (Array.isArray(u.sess) ? u.sess : []).forEach(function (id) { drop[id] = 1; });
    (Array.isArray(d.sess) ? d.sess : []).forEach(function (s) { if (isObj(s) && drop[s.id]) shTomb(d, s, now); });
    if (Array.isArray(d.sess)) d.sess = d.sess.filter(function (s) { return !(isObj(s) && drop[s.id]); });
    cur.m = stampAfter(now, cur.m);
    shSortRows(d);
    return { ok: true };
  }

  // ---------- Habits ----------
  // oros-habits-data v2 = { ver, habits[], comps[], set? } (habits/
  // model.js). Habits LWW per row on h.mtime (a delete is h.del = true
  // with a new mtime, never done here). Day ticks are comps
  // { id: "<habitId>|<ymd>", habitId, date, mtime, del, v?, sk?, nt? }
  // merged field by field: the tick (mtime, del) LWW, equal → not
  // ticked; sk / nt LWW on their own stamps. complete / reopen are
  // model.js setTick(db, id, today, true / false, now): a missing row
  // is pushed as { mtime: 0, del: true } first (compFor), a tick
  // un-skips the day. Today = the local day of `now`, as the app's
  // todayKey(). A number habit is filled in Habits (its value is a
  // per-device share), so it is not ticked here.
  var HB_DAY = /^\d{4}-\d{2}-\d{2}$/;
  function hbYmd(now) {
    var d = new Date(now), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function hbIsNum(h) { return isObj(h.num) && typeof h.num.t === "number" && h.num.t > 0; }
  function hbFind(d, target) {
    if (!isObj(d) || !Array.isArray(d.habits) || !isObj(target) || typeof target.habit !== "string") return null;
    for (var i = 0; i < d.habits.length; i++) {
      var h = d.habits[i];
      if (isObj(h) && h.id === target.habit && !h.del) return h;
    }
    return null;
  }
  function hbComp(d, id, day) {
    var cid = id + "|" + day, cs = Array.isArray(d.comps) ? d.comps : [];
    for (var i = 0; i < cs.length; i++) if (isObj(cs[i]) && cs[i].id === cid) return cs[i];
    return null;
  }
  function hbView(d, h, day) {
    var v = { title: typeof h.name === "string" ? h.name : "", date: day };
    if (!hbIsNum(h)) { var c = hbComp(d, h.id, day); v.done = !!(c && !c.del); }
    return v;
  }
  function hbTick(c) { return { mtime: c.mtime, del: !!c.del, sk: c.sk ? clone(c.sk) : null }; }

  function habitsChange(d, target, ch, now) {
    var h = hbFind(d, target);
    if (!h) return bad("That habit is no longer in Habits.");
    var day = hbYmd(now), before = hbView(d, h, day), title = before.title;
    if (ch.action === "delete") return bad("Deleting a habit removes its whole history; delete it in Habits.");
    if (ch.action === "complete" || ch.action === "reopen") {
      if (hbIsNum(h)) return bad("That habit counts an amount: open Habits to enter how much.");
      var want = ch.action === "complete";
      if (before.done === want) return bad(want ? "That habit is already ticked for today." : "That habit is not ticked for today.");
      var c = hbComp(d, h.id, day), made = !c;
      if (!c) {
        c = { id: h.id + "|" + day, habitId: h.id, date: day, mtime: 0, del: true };
        if (!Array.isArray(d.comps)) d.comps = [];
        d.comps.push(c);
      }
      var prev = made ? null : hbTick(c);
      c.del = !want;
      c.mtime = stampAfter(now, c.mtime);
      if (want && c.sk && c.sk[0] === 1) c.sk = [0, stampAfter(now, c.sk[1])];   // done un-skips
      return { ok: true, title: title, before: before, after: hbView(d, h, day), del: false,
               undo: { t: "set", app: "habits", target: { habit: h.id }, day: day, prev: prev, next: hbTick(c) } };
    }
    if (ch.action !== "update") return bad("A habit can be ticked for today, unticked, or renamed.");
    var s = ch.set;
    if (has(s, "note")) return bad("Habits keeps notes per day, not per habit: add it to the day in Habits.");
    var notOk = Object.keys(s).filter(function (k) { return !SETTABLE.habits[k]; });
    if (notOk.length) return bad("A habit has no " + notOk.join(", ") + ".");
    var nm = has(s, "title") ? s.title.slice(0, 200) : h.name;
    if (nm === h.name) return bad("Nothing would change: the habit already looks like that.");
    var old = h.name;
    h.name = nm;
    h.mtime = stampAfter(now, h.mtime);
    return { ok: true, title: title, before: before, after: hbView(d, h, day), del: false,
             undo: { t: "set", app: "habits", target: { habit: h.id }, prev: { name: old }, next: { name: nm } } };
  }
  function habitsUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.habits)) return bad("Habits has no habits.");
    if (u.t !== "set") return bad("bad undo");
    var h = hbFind(d, u.target);
    if (!h) return bad("That habit is no longer in Habits.");
    if (typeof u.day === "string") {
      if (!HB_DAY.test(u.day)) return bad("bad undo");
      var c = hbComp(d, h.id, u.day);
      if (!c || JSON.stringify(hbTick(c)) !== JSON.stringify(u.next)) return bad("The day changed since; nothing was undone.");
      // Fresh stamps: the undone tick must beat the applied one on
      // every device (a row that was new stays as an unticked row).
      var p = u.prev;
      c.del = p ? !!p.del : true;
      c.mtime = stampAfter(now, c.mtime);
      if (p && p.sk && c.sk && p.sk[0] !== c.sk[0]) c.sk = [p.sk[0] === 1 ? 1 : 0, stampAfter(now, c.sk[1])];
      return { ok: true };
    }
    if (!isObj(u.next) || h.name !== u.next.name) return bad("The habit changed since; nothing was undone.");
    if (!isObj(u.prev) || typeof u.prev.name !== "string" || !u.prev.name) return bad("bad undo");
    h.name = u.prev.name;
    h.mtime = stampAfter(now, h.mtime);
    return { ok: true };
  }

  // ---------- Plant Care ----------
  // oros-plants-data = { ver: 1, plants[] by id, log[] by id, tombs
  // { id: ts } } (plants/core.js merge). Plants LWW on p.m, log entries
  // { id, p, k, d, s, m } LWW per id, tombstones max-merged and shared
  // by plants and entries; a tombstone at or after m hides the row.
  // Canonical: plants and log sorted by id, tombs sorted. "Watered
  // today" is plants.js logTask([water], false): one entry { k:
  // "water", d: today, s: 0, m: now } and the water postponement
  // (sn.water) cleared with a new p.m. The next due day is never
  // stored (core.js nextDue derives it from st, the log and sn).
  // Undo = a tombstone on the entry + the old postponement back.
  // Today = the local day of `now`, as todayYmd().
  var PL_ID = /^[a-z0-9]{6,40}$/;
  function plYmd(now) {
    var d = new Date(now), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function plTombs(d) { return isObj(d.tombs) ? d.tombs : {}; }
  function plLive(d, x) {
    var tb = plTombs(d)[x.id];
    return !(typeof tb === "number" && tb >= (Number(x.m) || 0));
  }
  function plFind(d, target) {
    var id = typeof target === "string" ? target : isObj(target) && typeof target.id === "string" ? target.id : "";
    if (!isObj(d) || !Array.isArray(d.plants) || !id) return null;
    for (var i = 0; i < d.plants.length; i++) {
      var p = d.plants[i];
      if (isObj(p) && p.id === id && plLive(d, p)) return p;
    }
    return null;
  }
  function plWater(d, id) {
    return (Array.isArray(d.log) ? d.log : []).filter(function (x) {
      return isObj(x) && x.p === id && x.k === "water" && x.s !== 1 && plLive(d, x);
    });
  }
  function plView(d, p) {
    var last = "";
    plWater(d, p.id).forEach(function (x) { if (realDate(x.d) && x.d > last) last = x.d; });
    return {
      title: typeof p.name === "string" ? p.name : "",
      watered: last,
      note: typeof p.notes === "string" ? p.notes : ""
    };
  }
  function plSort(d) {
    var by = function (a, b) { return cmpStr(String(a && a.id), String(b && b.id)); };
    if (Array.isArray(d.plants)) d.plants.sort(by);
    if (Array.isArray(d.log)) d.log.sort(by);
    d.tombs = sortedObj(plTombs(d));
  }
  function plantsChange(d, target, ch, now) {
    var p = plFind(d, target);
    if (!p) return bad("That plant is no longer in Plant Care.");
    var before = plView(d, p), title = before.title;
    if (ch.action === "delete") return bad("Deleting a plant removes its care history; delete it in Plant Care.");
    if (ch.action === "reopen") return bad("To take a watering back, remove it from the plant's history in Plant Care.");
    if (ch.action === "complete") {
      var t = Math.floor(now) || 0, day = plYmd(t);
      if (plWater(d, p.id).some(function (x) { return x.d === day; })) return bad("That plant was already watered today.");
      var used = {};
      (Array.isArray(d.log) ? d.log : []).forEach(function (x) { if (isObj(x)) used[x.id] = 1; });
      Object.keys(plTombs(d)).forEach(function (k) { used[k] = 1; });
      var base = t.toString(36) + "w" + p.id.slice(0, 16), id = base, n = 0;
      while (used[id]) id = base + (++n);
      if (!Array.isArray(d.log)) d.log = [];
      d.log.push({ id: id, p: p.id, k: "water", d: day, s: 0, m: t });
      var oldSn = isObj(p.sn) && typeof p.sn.water === "string" ? p.sn.water : null;
      if (oldSn) { delete p.sn.water; p.m = stampAfter(now, p.m); }
      plSort(d);
      return { ok: true, title: title, before: before, after: plView(d, p), del: false,
               undo: { t: "set", app: "plants", target: { id: p.id }, entry: id, sn: oldSn } };
    }
    if (ch.action !== "update") return bad("A plant can be marked watered today, renamed, or have its notes changed.");
    var s = ch.set;
    var notOk = Object.keys(s).filter(function (k) { return !SETTABLE.plants[k]; });
    if (notOk.length) return bad("A plant has no " + notOk.join(", ") + ".");
    var prev = { name: p.name, notes: typeof p.notes === "string" ? p.notes : "" }, changed = false;
    if (has(s, "title")) {
      var nm = line(s.title, 40);
      if (nm && nm !== p.name) { p.name = nm; changed = true; }
    }
    if (has(s, "note")) {
      var nt = s.note.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 500);
      if (nt !== prev.notes) { p.notes = nt; changed = true; }
    }
    if (!changed) return bad("Nothing would change: the plant already looks like that.");
    p.m = stampAfter(now, p.m);
    return { ok: true, title: title, before: before, after: plView(d, p), del: false,
             undo: { t: "set", app: "plants", target: { id: p.id }, prev: prev, next: { name: p.name, notes: p.notes } } };
  }
  function plantsUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.plants) || u.t !== "set") return bad("bad undo");
    var p = plFind(d, u.target);
    if (!p) return bad("That plant is no longer in Plant Care.");
    if (typeof u.entry === "string") {
      if (!PL_ID.test(u.entry)) return bad("bad undo");
      var x = (Array.isArray(d.log) ? d.log : []).filter(function (e) { return isObj(e) && e.id === u.entry && plLive(d, e); })[0];
      if (!x) return bad("That watering is no longer in the plant's history.");
      if (!isObj(d.tombs)) d.tombs = {};
      d.tombs[x.id] = stampAfter(now, Math.max(d.tombs[x.id] || 0, x.m || 0));
      d.log = d.log.filter(function (e) { return !(isObj(e) && e.id === u.entry); });
      if (typeof u.sn === "string" && realDate(u.sn)) {
        var sn = isObj(p.sn) ? p.sn : {}, out = {};
        sn.water = u.sn;
        ["water", "fert", "mist", "repot"].forEach(function (k) { if (has(sn, k)) out[k] = sn[k]; });   // core.js KINDS order
        p.sn = out;
        p.m = stampAfter(now, p.m);
      }
      plSort(d);
      return { ok: true };
    }
    if (!isObj(u.next) || p.name !== u.next.name || (p.notes || "") !== (u.next.notes || "")) {
      return bad("The plant changed since; nothing was undone.");
    }
    if (isObj(u.prev) && typeof u.prev.name === "string" && u.prev.name) p.name = u.prev.name;
    p.notes = isObj(u.prev) && typeof u.prev.notes === "string" ? u.prev.notes : "";
    p.m = stampAfter(now, p.m);
    return { ok: true };
  }

  // ---------- 6b. CRM (wave CF2) ----------
  // oros-crm-data { ver, cust: [c], deals, acts, fups, tags, stg, prefs,
  // tombs: { id: deletedAt } } (crm/core.js): every row is whole-record
  // LWW on c.m, alive while c.m > tombs[id]; rows sorted by id; a
  // customer's keys in normCust order, empty values left out. Only a
  // customer's details change here. Single fields (phone, e-mail, web,
  // address) are filled when empty; one that already holds something
  // else is replaced only with old_* (or address_replace), so nothing
  // the user typed is lost by a guess. Bank details or a bio have no
  // field: they go in the note (note_add).
  var CRM_KEYS = ["id", "m", "name", "kind", "st", "alias", "afm", "doy", "job", "addr", "country", "phone", "email",
                  "web", "src", "note", "star", "ct", "tags", "people"];
  function crmText(v, max, multi) {
    if (typeof v !== "string") return "";
    var t = v.replace(/\r\n?/g, "\n");
    t = multi ? t.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u2028\u2029]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
              : t.replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    return t.slice(0, max);
  }
  function crmFind(d, target) {
    if (!isObj(d) || !Array.isArray(d.cust) || !isObj(target) || typeof target.cust !== "string") return null;
    var tombs = isObj(d.tombs) ? d.tombs : {};
    for (var i = 0; i < d.cust.length; i++) {
      var c = d.cust[i];
      if (isObj(c) && c.id === target.cust) {
        if (typeof tombs[c.id] === "number" && tombs[c.id] >= (c.m || 0)) return null;
        return { c: c, i: i };
      }
    }
    return null;
  }
  function crmView(c) {
    return { title: crmText(c.name, 120), nickname: crmText(c.alias, 80), job: crmText(c.job, 80), vat: crmText(c.afm, 20),
             taxoffice: crmText(c.doy, 60), phone: crmText(c.phone, 40), email: crmText(c.email, 120),
             address: [crmText(c.addr, 200), crmText(c.country, 60)].filter(Boolean).join(", "),
             website: crmText(c.web, 300), note: crmText(c.note, 2000, true) };
  }
  function crmOrder(c) {
    var o = {};
    CRM_KEYS.forEach(function (k) { if (has(c, k) && c[k] !== "" && c[k] !== null && c[k] !== undefined) o[k] = c[k]; });
    Object.keys(c).forEach(function (k) { if (!has(o, k) && CRM_KEYS.indexOf(k) < 0) o[k] = c[k]; });
    return o;
  }
  // Greek ΑΦΜ check digit (crm/core.js validAfm)
  function afmOk(v) {
    v = String(v || "").replace(/^(EL|GR)/i, "");
    if (!/^\d{9}$/.test(v) || v === "000000000") return false;
    var sum = 0;
    for (var i = 0; i < 8; i++) sum += (+v.charAt(i)) * Math.pow(2, 8 - i);
    return (sum % 11) % 10 === +v.charAt(8);
  }
  function crmChange(d, target, ch, now) {
    var h = crmFind(d, target);
    if (!h) return bad(isObj(target) && target.cust ? "That customer is no longer in CRM." : "Only a CRM customer's details can be changed here (not deals, activities or follow-ups).");
    if (ch.action !== "update") return bad("A CRM customer can only be updated here; delete it in CRM.");
    var c = clone(h.c), before = crmView(h.c), s = ch.set;
    var notOk = Object.keys(s).filter(function (k) { return !SETTABLE.crm[k]; });
    if (notOk.length) return bad("A CRM customer has no " + notOk.join(", ") + " here (bank details or a bio go in note_add).");
    if (has(s, "title")) { var nm = crmText(s.title, 120); if (!nm) return bad("A customer needs a name."); c.name = nm; }
    if (has(s, "nickname")) c.alias = crmText(s.nickname, 80);
    if (has(s, "job_title")) c.job = crmText(s.job_title, 80);
    if (has(s, "tax_office")) c.doy = crmText(s.tax_office, 60);
    if (has(s, "tax_id")) {
      var gr = !c.country || /^(gr|greece|ελλάδα|ελλαδα|hellas)$/i.test(String(c.country).trim());
      if (gr && /^((EL|GR)?)\d{9}$/i.test(s.tax_id) && !afmOk(s.tax_id)) return bad("tax_id " + s.tax_id + " fails the Greek check digit: read it again from the document.");
      c.afm = s.tax_id;
    }
    var singles = [["phone", "phone", 40, function (a, b) { return ctSamePhone(a, b); }],
                   ["email", "email", 120, function (a, b) { return a.toLowerCase() === b.toLowerCase(); }],
                   ["website", "web", 300, function (a, b) { return ctWeb(a) === ctWeb(b); }]];
    for (var i = 0; i < singles.length; i++) {
      var S = singles[i];
      if (!has(s, S[0])) continue;
      var cur = crmText(c[S[1]], S[2]), nv = crmText(s[S[0]], S[2]), old = s["old_" + S[0]];
      if (cur && S[3](cur, nv)) continue;
      if (cur && !old) return bad("The customer already has " + S[0] + " " + cur + "; to replace it pass old_" + S[0] + " (only when the document says it changed).");
      if (old && !(cur && S[3](cur, old))) return bad("old_" + S[0] + " " + old + " is not the customer's " + S[0] + (cur ? " (" + cur + ")" : " (none)") + ".");
      c[S[1]] = nv;
    }
    if (has(s, "address")) {
      var a = s.address, line1 = [a.street, [a.zip, a.city].filter(Boolean).join(" "), a.region].filter(Boolean).join(", ").slice(0, 200);
      var curA = crmText(c.addr, 200);
      if (line1 && line1.toLowerCase() !== curA.toLowerCase()) {
        if (curA && !s.address_replace) return bad("The customer already has the address " + curA + "; pass address_replace: true to replace it.");
        c.addr = line1;
      }
      if (a.country && (!c.country || s.address_replace)) c.country = crmText(a.country, 60);
    }
    if (has(s, "note")) {
      var nw = crmText(s.note, NOTE_IN, true);
      if (nw.length > 2000) return bad("The note is " + nw.length + " characters; CRM keeps 2000. Shorten it; nothing is cut for you.");
      c.note = nw;
    }
    if (has(s, "note_add")) {
      var on = crmText(c.note, 2000, true), add = crmText(s.note_add, NOTE_IN, true);
      if (on.indexOf(add) < 0) {
        var nn = on ? on + "\n" + add : add;
        if (nn.length > 2000) return bad("The note would be " + nn.length + " characters; CRM keeps 2000. Shorten note_add or rewrite the note with note.");
        c.note = nn;
      }
    }
    var after = crmView(c);
    if (JSON.stringify(after) === JSON.stringify(before)) return bad("Nothing would change: the customer already looks like that.");
    c.m = stampAfter(now, Math.max(h.c.m || 0, isObj(d.tombs) && typeof d.tombs[c.id] === "number" ? d.tombs[c.id] : 0));
    var prev = h.c;
    c = crmOrder(c);
    d.cust[h.i] = c;
    return { ok: true, title: before.title, before: before, after: after, del: false,
             undo: { t: "set", app: "crm", target: { cust: c.id }, prev: clone(prev), next: clone(c) } };
  }
  function crmUndo(d, u, now) {
    if (u.t !== "set" || !isObj(u.prev) || !isObj(u.next)) return bad("bad undo");
    var h = crmFind(d, u.target);
    if (!h) return bad("That customer is no longer in CRM.");
    if (JSON.stringify(h.c) !== JSON.stringify(u.next)) return bad("The customer changed since; nothing was undone.");
    var c = clone(u.prev);
    c.m = stampAfter(now, h.c.m);
    d.cust[h.i] = crmOrder(c);
    return { ok: true };
  }

  var CHANGE = { todo: todoChange, calendar: calChange, budget: budgetChange, bookmarks: bookmarksChange,
                 contacts: contactsChange, crm: crmChange, kanban: kanbanChange, shelf: shelfChange, habits: habitsChange, plants: plantsChange };
  var UNDO = { todo: todoUndo, calendar: calUndo, budget: budgetUndo, bookmarks: bookmarksUndo,
               contacts: contactsUndo, crm: crmUndo, kanban: kanbanUndo, shelf: shelfUndo, habits: habitsUndo, plants: plantsUndo };

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
  // Ticks on the card (wave CF1): which change_item arguments make
  // each diff row, so the user can leave a row out. Contacts only.
  var ROW_KEYS = {
    contacts: { title: ["title"], nickname: ["nickname"], org: ["org"], job: ["job_title"],
                phone: ["phone", "old_phone"], email: ["email", "old_email"], address: ["address", "address_replace"],
                website: ["website", "old_website"], birthday: ["date"], labels: ["label", "labels"], note: ["note", "note_add"] },
    crm: { title: ["title"], nickname: ["nickname"], job: ["job_title"], vat: ["tax_id"], taxoffice: ["tax_office"],
           phone: ["phone", "old_phone"], email: ["email", "old_email"], address: ["address", "address_replace"],
           website: ["website", "old_website"], note: ["note", "note_add"] }
  };
  function canTick(appId, rows) {
    var m = ROW_KEYS[appId];
    return !!m && Array.isArray(rows) && rows.length > 0 && rows.every(function (r) { return r && has(m, r.f); });
  }
  // ch (normArgs) without the rows the user left out → ch | null (nothing left)
  function without(appId, ch, offRows) {
    var m = ROW_KEYS[appId];
    if (!m || !ch || !ch.ok) return ch;
    var set = clone(ch.set);
    (offRows || []).forEach(function (f) { (m[f] || []).forEach(function (k) { delete set[k]; }); });
    if (!Object.keys(set).length) return null;
    return { ok: true, ref: ch.ref, action: ch.action, set: set };
  }
  function storageKey(appId) { return has(APPS, appId) ? APPS[appId].key : ""; }
  // Which of the readable app ids take changes.
  function editableApps(ids) {
    return (Array.isArray(ids) ? ids : []).filter(function (id) { return has(APPS, id); });
  }

  var api = {
    ACTIONS: ACTIONS, APP_IDS: APP_IDS, VIEW_ORDER: VIEW_ORDER, CAT_NAMES: CAT_NAMES,
    normArgs: normArgs, buildDiff: buildDiff, plan: plan, apply: apply, undo: undo,
    storageKey: storageKey, editableApps: editableApps, canTick: canTick, without: without,
    actionsFor: function (appId) { return has(APPS, appId) ? APPS[appId].actions.slice() : []; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosAssistEdits = api;
})(typeof window !== "undefined" ? window : this);
