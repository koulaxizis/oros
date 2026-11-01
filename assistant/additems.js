// ============================================================
// orOS Assistant — new items in the everyday apps (AS-ADD2, wave A1)
// ------------------------------------------------------------
// Pure logic, no DOM, no storage: create_items for To-Do, Calendar,
// Budget, Notes, Bookmarks and Kanban, the twin of create.js (which
// keeps Contacts and CRM). assistant.js loads this file the first time
// one of these apps gets new items, reads the app's stored JSON, asks
// plan() for one row per item (a tick each, on one card), then apply()
// for the new JSON and writes it. Unit-tested in node
// (tests/assistant-additems.test.js).
//
// Rules (OROS_BIBLE.md "Assistant", AS-ADD2):
//   - Nothing is written without the user's own press of "Add".
//   - New items only: nothing already there is changed. One that looks
//     like an item already there starts unticked (Bookmarks: the same
//     address can't be added twice, as in the app).
//   - The app must have been opened on this device once (its data is
//     there), and the user's own lists, notebooks, folders, boards,
//     columns, labels and categories are used, never made up; the one
//     exception is a To-Do list, which is made when none has the name.
//   - The app's limits: a longer text is refused, never cut (an app
//     would cut it and upload the cut copy).
//   - The write is the app's own shape and stamps:
//       todo       todo.js freshItem + stampItemNewest (it.fm every
//                  field, TD-3; prio / subs in it.xf, TD-14), canonItem
//                  key order, at the end of its list (pos renumbered,
//                  l.om stamped, as an import); a new list as freshList
//                  (fm name/cycle), state.om stamped
//       calendar   calendar.js sanitizeEvent shape, whole-event LWW on
//                  mtime, events sorted by id (mergeCalendars)
//       budget     budget.js normTx shape { id, m, d, a, k, c, n }, m
//                  after any tombstone "tx:<id>", tx sorted by id
//       notes      notes.js insertPage (ct = st = mtime, pos after the
//                  notebook's top pages, labels sorted)
//       bookmarks  bookmarks.js sanitizeItem shape (as quickAdd), items
//                  and the tombstone map in sorted key order (BM-1)
//       kanban     kanban.js newCardObj (fm = every group, K1), on top
//                  of its column in the order given (as "Send to an
//                  app"), col.om stamped, the board in model.js
//                  canonState order
//     Stamps are max(now, old + 1), as in edits.js.
//   - Undo takes back only what the card made, and only while each
//     item still has the stamp it was made with; all or nothing.
// Exposed as window.OrosAssistAdd (module.exports in node).
// i18n-inline-ok: Greek letter folding, Greek seed names of labels, categories and folders for matching (data, no UI text)
// ============================================================
(function (root) {
  "use strict";

  var APPS = {
    todo:      { key: "oros-todo-data",      name: "To-Do" },
    calendar:  { key: "oros-calendar-data",  name: "Calendar" },
    budget:    { key: "oros-budget-data",    name: "Budget" },
    notes:     { key: "oros-notes-data",     name: "Notes" },
    bookmarks: { key: "oros-bookmarks-data", name: "Bookmarks" },
    kanban:    { key: "oros-kanban-data",    name: "Kanban" },
    // Wave A2: CRM's history, follow-ups and deals (a customer's ref each)
    crm_activity: { key: "oros-crm-data", name: "CRM" },
    crm_followup: { key: "oros-crm-data", name: "CRM" },
    crm_deal:     { key: "oros-crm-data", name: "CRM" }
  };
  var APP_IDS = ["todo", "calendar", "budget", "notes", "bookmarks", "kanban", "crm_activity", "crm_followup", "crm_deal"];
  var CRM_IDS = ["crm_activity", "crm_followup", "crm_deal"];
  var MAX_ITEMS = 100;
  // The apps' own limits.
  var LIM = {
    tdText: 300, tdNote: 1000, tdList: 60, tdSubs: 100, tdSub: 300,      // todo/model.js SUB_MAX, SUB_TEXT
    calTitle: 80, calNote: 500, calLoc: 150,                             // calendar.js sanitizeEvent
    bgNote: 140,                                                         // budget.js NOTE_LEN
    ntTitle: 200, ntText: 100000,
    bmTitle: 256, bmNote: 1024, bmTags: 12, bmTag: 32,                   // bookmarks.js sanitizeItem
    kbText: 500, kbNote: 20000, kbSubs: 50, kbSub: 200,                  // kanban/tools.js MAX
    actText: 2000, actWho: 80, fupText: 300, dealTitle: 120, dealNote: 2000, dealWhy: 200   // crm/core.js normAct / normFup / normDeal
  };
  var ACT_KINDS = ["call", "mail", "meet", "msg", "note"];              // crm/core.js ACT_KINDS
  var DEAL_STAGES = ["new", "contact", "proposal", "nego", "won", "lost"];
  var CRM_VAL_MAX = 99999999999;
  var CRM_LIMITS = { deals: 5000, acts: 20000, fups: 10000 };
  var REMIND = [5, 15, 30, 60, 1440, 4320, 7200];                       // calendar.js REMIND_PRESETS
  var MAX_CENTS = 100000000000;                                         // budget.js MAX_CENTS
  var BUDGET_CATS = {
    o: { groceries: "o-groc", "eating-out": "o-eat", bills: "o-bills", home: "o-home", transport: "o-trans",
         health: "o-health", fun: "o-fun", clothes: "o-cloth", gift: "o-gift", other: "o-other" },
    i: { salary: "i-salary", freelance: "i-free", gift: "i-gift", other: "i-other" }
  };
  // budget.js SEED_NAMES: a ready category also answers to its name.
  var BUDGET_SEED_NAMES = {
    "o-groc": ["Groceries", "Σούπερ μάρκετ"], "o-eat": ["Eating out", "Φαγητό έξω"], "o-bills": ["Bills", "Λογαριασμοί"],
    "o-home": ["Rent & home", "Ενοίκιο & σπίτι"], "o-trans": ["Transport", "Μεταφορές"], "o-health": ["Health", "Υγεία"],
    "o-fun": ["Entertainment", "Ψυχαγωγία"], "o-cloth": ["Clothing", "Ρούχα"], "o-gift": ["Gifts", "Δώρα"], "o-other": ["Other", "Άλλα"],
    "i-salary": ["Salary", "Μισθός"], "i-free": ["Freelance", "Ελεύθερο επάγγελμα"], "i-gift": ["Gifts", "Δώρα"], "i-other": ["Other", "Άλλα"]
  };
  // calendar.js SEED_NAMES: untouched seed labels (mtime 0) are shown
  // translated, so either name finds them.
  var CAL_SEEDS = {
    "lbl-personal": ["Personal", "Προσωπικό"], "lbl-work": ["Work", "Εργασία"], "lbl-family": ["Family", "Οικογένεια"]
  };
  var BM_ROOT = "unsorted";
  var BM_ROOT_NAMES = ["Unsorted", "Αταξινόμητα", "Unsortiert"];
  var BM_ROOT_SHOW = { en: 0, el: 1, de: 2 };
  var NT_SEED = "nb-default";
  var NT_SEED_NAMES = { en: "Notes", el: "Σημειώσεις", de: "Notizen" };
  // todo.js ITEM_FIELDS / XF_FIELDS / canonItem key order
  var TD_FIELDS = ["text", "done", "due", "notes", "labels", "info", "recurrence"];
  var TD_KEYS = ["id", "text", "done", "due", "notes", "labels", "info", "recurrence", "mtime", "om", "pos"];
  var TD_LIST_KEYS = ["id", "name", "mtime", "om", "pos", "recurrence", "lastReset", "nextReset", "items", "fm"];
  // kanban/model.js
  var KB_GROUPS = ["a", "c", "d", "k", "l", "n", "p", "s", "t", "x"];
  var KB_CARD_KEYS = ["id", "text", "notes", "due", "labels", "subtasks", "info", "mtime", "pos"];
  var KB_COL_KEYS = ["id", "name", "mtime", "om", "pos", "cards"];
  var KB_BOARD_KEYS = ["id", "name", "archived", "color", "mtime", "om", "pos", "deleted", "labels", "columns"];

  var CTRL = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g;
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function one(v) { return typeof v === "string" ? v.replace(CTRL, " ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() : ""; }
  function para(v) { return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(CTRL, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : ""; }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function bad(msg) { return { ok: false, err: msg }; }
  function stampAfter(now, prev) { return Math.max(Math.floor(now) || 0, (typeof prev === "number" && isFinite(prev) ? prev : 0) + 1); }
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
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
  function sortedObj(o) {
    var out = {};
    Object.keys(o || {}).sort(cmpStr).forEach(function (k) { out[k] = o[k]; });
    return out;
  }
  function ordered(obj, keys) {
    var out = {};
    keys.forEach(function (k) { if (obj[k] !== undefined) out[k] = obj[k]; });
    Object.keys(obj).sort(cmpStr).forEach(function (k) { if (keys.indexOf(k) < 0 && obj[k] !== undefined) out[k] = obj[k]; });
    return out;
  }
  function rnd(n) { var s = ""; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }
  function uid(now, taken, prefix) {
    for (var i = 0; i < 50; i++) {
      var id = (prefix || "") + Math.floor(now).toString(36) + rnd(5);
      if (!taken[id]) { taken[id] = 1; return id; }
    }
    return (prefix || "") + Math.floor(now).toString(36) + rnd(12);
  }
  // A text the app keeps up to max characters: longer is refused.
  function text1(x, k, max, where, what) {
    if (!has(x, k) || x[k] === null || x[k] === undefined || x[k] === "") return { v: "" };
    if (typeof x[k] !== "string") return { err: where + k + " must be text." };
    var v = one(x[k]);
    if (v.length > max) return { err: where + k + " has " + v.length + " characters; " + what + " keeps " + max + ". Make it shorter." };
    return { v: v };
  }
  function textN(x, k, max, where, what) {
    if (!has(x, k) || x[k] === null || x[k] === undefined || x[k] === "") return { v: "" };
    if (typeof x[k] !== "string") return { err: where + k + " must be text." };
    var v = para(x[k]);
    if (v.length > max) return { err: where + k + " has " + v.length + " characters; " + what + " keeps " + max + ". Make it shorter or split it." };
    return { v: v };
  }
  function dateOf(x, k, where) {
    if (!has(x, k) || x[k] === null || x[k] === undefined || x[k] === "") return { v: "" };
    var d = realDate(String(x[k]));
    return d ? { v: d } : { err: where + k + " must be a real date as YYYY-MM-DD." };
  }
  // A list of short names (labels, tags, subtasks).
  function names(x, k, maxN, maxLen, where, what) {
    if (!has(x, k) || x[k] === null || x[k] === undefined) return { v: [] };
    var a = Array.isArray(x[k]) ? x[k] : [x[k]], out = [];
    for (var i = 0; i < a.length; i++) {
      var s = one(typeof a[i] === "string" ? a[i] : "");
      if (!s) continue;
      if (s.length > maxLen) return { err: where + k + "[" + i + "] has " + s.length + " characters; " + what + " keeps " + maxLen + "." };
      if (out.indexOf(s) < 0) out.push(s);
    }
    if (out.length > maxN) return { err: where + k + " has " + out.length + " entries; " + what + " keeps " + maxN + "." };
    return { v: out };
  }
  // name → the one entry of list [{ id, names: [...] }] it means, or null.
  function pick(list, name) {
    var f = fold(name), hit = null;
    list.forEach(function (l) { if (!hit && l.names.some(function (n) { return fold(n) === f; })) hit = l; });
    return hit;
  }
  function missing(appName, what, list, miss, where) {
    return appName + " has no " + what + " named \"" + miss.join("\", \"") + "\". " +
      (list.length ? "Its " + what + "s: " + list.map(function (l) { return l.names[0]; }).join(", ") + ". " : "It has none. ") +
      "New " + what + "s are made in " + appName + (where ? " (" + where + ")" : "") + ": tell the user, or leave it out.";
  }
  function preview(s, n) { s = one(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function money(cents) { var s = String(Math.abs(cents)); while (s.length < 3) s = "0" + s; return s.slice(0, -2) + "." + s.slice(-2); }

  // ---------- 1. The tool's items, per app ----------
  function normTodo(x, w) {
    var ti = text1(x, "title", LIM.tdText, w, "To-Do");
    if (ti.err) return ti;
    if (!ti.v) return { err: w + "title (the task) is required." };
    var o = { title: ti.v };
    var r = textN(x, "note", LIM.tdNote, w, "a task's note");
    if (r.err) return r;
    o.note = r.v;
    r = dateOf(x, "date", w);
    if (r.err) return r;
    o.date = r.v;
    r = text1(x, "list", LIM.tdList, w, "a list's name");
    if (r.err) return r;
    o.list = r.v;
    o.prio = 0;
    if (has(x, "priority") && x.priority !== null && x.priority !== undefined && x.priority !== "") {
      var p = String(x.priority).replace(/^p/i, "");
      if (!/^[1-4]$/.test(p)) return { err: w + "priority must be 1, 2, 3 or 4 (P1 is the most urgent)." };
      o.prio = +p === 4 ? 0 : +p;
    }
    r = names(x, "labels", 20, 24, w, "To-Do");
    if (r.err) return r;
    o.labels = r.v;
    r = names(x, "subtasks", LIM.tdSubs, LIM.tdSub, w, "a task");
    if (r.err) return r;
    o.subtasks = r.v;
    return { o: o, key: fold(o.list) + "|" + fold(o.title) };
  }
  function normCal(x, w) {
    var ti = text1(x, "title", LIM.calTitle, w, "Calendar");
    if (ti.err) return ti;
    if (!ti.v) return { err: w + "title is required." };
    var o = { title: ti.v };
    var r = dateOf(x, "date", w);
    if (r.err) return r;
    if (!r.v) return { err: w + "date is required (YYYY-MM-DD)." };
    o.date = r.v;
    r = dateOf(x, "end_date", w);
    if (r.err) return r;
    if (r.v && r.v < o.date) return { err: w + "end_date is before date." };
    o.dateEnd = r.v && r.v !== o.date ? r.v : "";
    o.start = o.end = "";
    if (has(x, "start") && x.start) { o.start = hm(String(x.start)); if (!o.start) return { err: w + "start must be HH:MM (24h)." }; }
    if (has(x, "end") && x.end) { o.end = hm(String(x.end)); if (!o.end) return { err: w + "end must be HH:MM (24h)." }; }
    if (o.end && !o.start) return { err: w + "end needs a start time." };
    if (o.start && o.end && o.end <= o.start && !o.dateEnd) return { err: w + "end is not after start (give end_date for an event that runs past midnight)." };
    r = text1(x, "location", LIM.calLoc, w, "Calendar");
    if (r.err) return r;
    o.location = r.v;
    r = textN(x, "note", LIM.calNote, w, "an event's note");
    if (r.err) return r;
    o.note = r.v;
    var lb = has(x, "label") && x.label ? x.label : (Array.isArray(x.labels) && x.labels.length ? x.labels[0] : "");
    if (Array.isArray(x.labels) && x.labels.length > 1) return { err: w + "an event has one label only." };
    o.label = one(typeof lb === "string" ? lb : "");
    o.remind = null;
    if (has(x, "reminder") && x.reminder !== null && x.reminder !== undefined && x.reminder !== "") {
      var mi = +x.reminder;
      if (REMIND.indexOf(mi) < 0) return { err: w + "reminder must be minutes before: " + REMIND.join(", ") + "." };
      o.remind = mi;
    }
    return { o: o, key: o.date + "|" + o.start + "|" + fold(o.title) };
  }
  function normBudget(x, w) {
    var k = has(x, "entry") && x.entry ? String(x.entry) : "expense";
    if (k !== "expense" && k !== "income") return { err: w + "entry must be expense or income." };
    var o = { k: k === "income" ? "i" : "o" };
    var a = typeof x.amount === "number" ? x.amount : (typeof x.amount === "string" && /^\s*\d+(\.\d+)?\s*$/.test(x.amount) ? parseFloat(x.amount) : NaN);
    if (!(a > 0) || !isFinite(a)) return { err: w + "amount must be a number greater than 0, e.g. 12.5." };
    o.a = Math.round(a * 100);
    if (o.a <= 0 || o.a > MAX_CENTS) return { err: w + "amount is out of range." };
    var r = dateOf(x, "date", w);
    if (r.err) return r;
    o.d = r.v;
    r = text1(x, "category", 30, w, "a category's name");
    if (r.err) return r;
    o.cat = r.v;
    r = text1(x, "note", LIM.bgNote, w, "an entry's note");
    if (r.err) return r;
    o.n = r.v;
    return { o: o, key: o.d + "|" + o.a + "|" + o.k + "|" + fold(o.n) };
  }
  function normNotes(x, w) {
    var ti = text1(x, "title", LIM.ntTitle, w, "a note's title");
    if (ti.err) return ti;
    if (!ti.v) return { err: w + "title is required." };
    var o = { title: ti.v };
    var r = textN(x, "text", LIM.ntText, w, "a note");
    if (r.err) return r;
    o.text = r.v;
    r = text1(x, "notebook", 64, w, "a notebook's name");
    if (r.err) return r;
    o.nb = r.v;
    r = names(x, "labels", 20, 40, w, "Notes");
    if (r.err) return r;
    o.labels = r.v;
    return { o: o, key: fold(o.nb) + "|" + fold(o.title) };
  }
  function normBookmark(x, w, ctx) {
    var bm = ctx && ctx.bm;
    if (!bm || typeof bm.normUrl !== "function") return { err: "Bookmarks is not ready." };
    var raw = typeof x.url === "string" ? x.url.trim() : "";
    if (!raw) return { err: w + "url is required." };
    var u = bm.normUrl(raw);
    if (!u || u.length > 2048) return { err: w + "url must be an http(s) address." };
    var o = { url: u };
    var r = text1(x, "title", LIM.bmTitle, w, "Bookmarks");
    if (r.err) return r;
    o.title = r.v;
    r = text1(x, "note", LIM.bmNote, w, "a bookmark's note");
    if (r.err) return r;
    o.note = r.v;
    r = text1(x, "folder", 64, w, "a folder's name");
    if (r.err) return r;
    o.folder = r.v;
    r = names(x, "labels", LIM.bmTags, LIM.bmTag, w, "a bookmark");
    if (r.err) return r;
    o.tags = r.v;
    return { o: o, key: bm.dupeKey(u) };
  }
  function normKanban(x, w) {
    var ti = text1(x, "title", LIM.kbText, w, "a Kanban card");
    if (ti.err) return ti;
    if (!ti.v) return { err: w + "title is required." };
    var o = { title: ti.v };
    var r = textN(x, "note", LIM.kbNote, w, "a card's notes");
    if (r.err) return r;
    o.note = r.v;
    r = dateOf(x, "date", w);
    if (r.err) return r;
    o.due = r.v;
    r = text1(x, "board", 120, w, "a board's name");
    if (r.err) return r;
    o.board = r.v;
    r = text1(x, "column", 120, w, "a column's name");
    if (r.err) return r;
    o.column = r.v;
    r = names(x, "labels", 20, 40, w, "Kanban");
    if (r.err) return r;
    o.labels = r.v;
    r = names(x, "subtasks", LIM.kbSubs, LIM.kbSub, w, "a card");
    if (r.err) return r;
    o.subtasks = r.v;
    return { o: o, key: fold(o.board) + "|" + fold(o.title) };
  }
  // CRM records: customer = a CRM customer's ref (assistant.js turns it
  // into o.cust before plan()), deal = a deal's ref (→ o.deal).
  function crmRefs(x, w, o, dealOk) {
    var cu = one(typeof x.customer === "string" ? x.customer : "").replace(/^oros:/, "");
    if (!/^r\d{1,5}$/.test(cu)) return w + "customer must be the ref of a CRM customer (e.g. r4) from search_data or create_items.";
    o.customer = cu;
    o.deal = "";
    if (dealOk && has(x, "deal") && x.deal) {
      var dl = one(String(x.deal)).replace(/^oros:/, "");
      if (!/^r\d{1,5}$/.test(dl)) return w + "deal must be the ref of a CRM deal from search_data or create_items.";
      o.deal = dl;
    }
    return "";
  }
  function normAct(x, w) {
    var o = {}, e = crmRefs(x, w, o, true);
    if (e) return { err: e };
    var k = has(x, "channel") && x.channel ? String(x.channel) : "note";
    if (ACT_KINDS.indexOf(k) < 0) return { err: w + "channel must be one of: " + ACT_KINDS.join(", ") + "." };
    o.k = k;
    var r = textN(x, "note", LIM.actText, w, "an entry of a customer's history");
    if (r.err) return r;
    if (!r.v) return { err: w + "note (what happened, what was said) is required." };
    o.text = r.v;
    r = dateOf(x, "date", w);
    if (r.err) return r;
    o.date = r.v;
    o.time = "";
    if (has(x, "start") && x.start) { o.time = hm(String(x.start)); if (!o.time) return { err: w + "start must be HH:MM (24h)." }; }
    r = text1(x, "who", LIM.actWho, w, "CRM");
    if (r.err) return r;
    o.who = r.v;
    return { o: o, key: o.customer + "|" + o.date + "|" + o.k + "|" + fold(o.text) };
  }
  function normFup(x, w) {
    var o = {}, e = crmRefs(x, w, o, true);
    if (e) return { err: e };
    var r = text1(x, "title", LIM.fupText, w, "a follow-up");
    if (r.err) return r;
    if (!r.v) return { err: w + "title (what to do) is required." };
    o.text = r.v;
    r = dateOf(x, "date", w);
    if (r.err) return r;
    if (!r.v) return { err: w + "date (when) is required." };
    o.d = r.v;
    o.t = "";
    if (has(x, "start") && x.start) { o.t = hm(String(x.start)); if (!o.t) return { err: w + "start must be HH:MM (24h)." }; }
    return { o: o, key: o.customer + "|" + o.d + "|" + fold(o.text) };
  }
  function normDeal(x, w) {
    var o = {}, e = crmRefs(x, w, o, false);
    if (e) return { err: e };
    var r = text1(x, "title", LIM.dealTitle, w, "a deal's title");
    if (r.err) return r;
    if (!r.v) return { err: w + "title is required." };
    o.title = r.v;
    o.val = 0;
    if (has(x, "amount") && x.amount !== null && x.amount !== undefined && x.amount !== "") {
      var a = typeof x.amount === "number" ? x.amount : (typeof x.amount === "string" && /^\s*\d+(\.\d+)?\s*$/.test(x.amount) ? parseFloat(x.amount) : NaN);
      if (!(a >= 0) || !isFinite(a) || Math.round(a * 100) > CRM_VAL_MAX) return { err: w + "amount must be a number, e.g. 1500." };
      o.val = Math.round(a * 100);
    }
    r = text1(x, "stage", 30, w, "a stage's name");
    if (r.err) return r;
    o.stage = r.v;
    r = dateOf(x, "date", w);
    if (r.err) return r;
    o.close = r.v;
    o.prob = null;
    if (has(x, "probability") && x.probability !== null && x.probability !== undefined && x.probability !== "") {
      var pb = +x.probability;
      if (!(pb >= 0 && pb <= 100) || Math.round(pb) !== pb) return { err: w + "probability must be a whole number 0-100." };
      o.prob = pb;
    }
    r = textN(x, "note", LIM.dealNote, w, "a deal's note");
    if (r.err) return r;
    o.note = r.v;
    r = text1(x, "reason", LIM.dealWhy, w, "a lost deal's reason");
    if (r.err) return r;
    o.why = r.v;
    return { o: o, key: o.customer + "|" + fold(o.title) };
  }
  var NORM = { todo: normTodo, calendar: normCal, budget: normBudget, notes: normNotes, bookmarks: normBookmark, kanban: normKanban,
               crm_activity: normAct, crm_followup: normFup, crm_deal: normDeal };

  // args = the model's create_items input → { ok, app, items } | { ok: false, err }
  function normItems(args, ctx) {
    if (!isObj(args)) return bad("The arguments must be an object.");
    var app = String(args.app || "");
    if (!has(APPS, app)) return bad("app must be one of: " + APP_IDS.join(", ") + ".");
    var list = Array.isArray(args.items) ? args.items : [];
    if (!list.length) return bad("items is empty.");
    if (list.length > MAX_ITEMS) return bad("At most " + MAX_ITEMS + " items at a time.");
    var out = [], keys = {};
    for (var i = 0; i < list.length; i++) {
      var where = "items[" + i + "]: ";
      if (!isObj(list[i])) return bad(where + "each item must be an object.");
      var r = NORM[app](list[i], where, ctx);
      if (r.err) return bad(r.err);
      if (has(keys, r.key)) return bad("items[" + keys[r.key] + "] and items[" + i + "] are the same; give each one once.");
      keys[r.key] = i;
      out.push(r.o);
    }
    return { ok: true, app: app, items: out };
  }

  function needData(appId, d, list) {
    if (!isObj(d) || (list && !Array.isArray(d[list])) || (!list && !isObj(d.items))) {
      return bad(APPS[appId].name + " has not been opened on this device yet, so there is nowhere to add to. Ask the user to open " + APPS[appId].name + " once, then try again.");
    }
    return null;
  }

  // ---------- 2. To-Do ----------
  function tdLists(d) {
    return d.lists.filter(function (l) { return isObj(l) && typeof l.id === "string" && Array.isArray(l.items) && typeof l.name === "string"; });
  }
  function tdLabels(d) {
    var dead = isObj(d.deleted) ? d.deleted : {};
    return (Array.isArray(d.labels) ? d.labels : []).filter(function (l) {
      return isObj(l) && typeof l.id === "string" && typeof l.name === "string" && !(typeof dead[l.id] === "number" && dead[l.id] >= (l.mtime || 0));
    }).map(function (l) { return { id: l.id, names: [l.name] }; });
  }
  function tdDefault(d) {
    var ls = tdLists(d);
    var act = ls.filter(function (l) { return l.id === d.activeList; })[0];
    if (act) return act;
    return ls.slice().sort(function (a, b) { return ((a.pos || 0) - (b.pos || 0)) || cmpStr(a.id, b.id); })[0] || null;
  }
  // → { list | newName, labelIds, dup } per item, or { err }
  function tdResolve(d, items) {
    var ls = tdLists(d), lbls = tdLabels(d), out = [];
    for (var i = 0; i < items.length; i++) {
      var o = items[i], list = null;
      if (o.list) list = pick(ls.map(function (l) { return { id: l.id, names: [l.name], l: l }; }), o.list);
      else list = { l: tdDefault(d) };
      var miss = [], ids = [];
      o.labels.forEach(function (n) { var l = pick(lbls, n); if (!l) miss.push(n); else if (ids.indexOf(l.id) < 0) ids.push(l.id); });
      if (miss.length) return { err: "items[" + i + "]: " + missing("To-Do", "label", lbls, miss, "a task's Labels") };
      var L = list ? list.l : null, dup = null;
      if (!o.list && !L) return { err: "To-Do has no lists. Ask the user to open To-Do once." };
      if (L) L.items.forEach(function (it) {
        if (!dup && isObj(it) && !it.done && typeof it.text === "string" && fold(it.text) === fold(o.title)) dup = { id: it.id, title: it.text, target: { list: L.id, item: it.id } };
      });
      out.push({ list: L, newName: L ? "" : o.list, labelIds: ids.sort(cmpStr), dup: dup });
    }
    return { res: out };
  }
  function tdPlan(d, items) {
    var e = needData("todo", d, "lists");
    if (e) return e;
    var r = tdResolve(d, items);
    if (r.err) return bad(r.err);
    return { ok: true, rows: items.map(function (o, i) {
      var x = r.res[i], f = [["inlist", x.list ? x.list.name : x.newName]];
      if (o.date) f.push(["due", o.date]);
      if (o.prio) f.push(["priority", "P" + o.prio]);
      if (o.labels.length) f.push(["labels", o.labels.join(", ")]);
      if (o.subtasks.length) f.push(["subtasks", o.subtasks.join(" · ")]);
      if (o.note) f.push(["note", preview(o.note, 200)]);
      var row = { title: o.title, fields: f, dup: x.dup };
      if (!x.list) row.hint = { k: "newList", name: x.newName };
      return row;
    }) };
  }
  function tdApply(d, items, now, skip) {
    var r = tdResolve(d, items);
    if (r.err) return bad(r.err);
    var taken = {}, made = [], undo = { app: "todo", t: "new", items: [], lists: [] }, touched = {}, newLists = {};
    d.lists.forEach(function (l) {
      if (!isObj(l)) return;
      taken[l.id] = 1;
      (Array.isArray(l.items) ? l.items : []).forEach(function (it) { if (isObj(it)) taken[it.id] = 1; });
    });
    Object.keys(isObj(d.deleted) ? d.deleted : {}).forEach(function (id) { taken[id] = 1; });
    var s = stampAfter(now, 0);
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var x = r.res[i], L = x.list;
      if (!L) {
        var nk = fold(x.newName);
        L = newLists[nk];
        if (!L) {
          // todo.js freshList + stampListNewest, after the other lists
          L = { id: uid(now, taken), name: x.newName, mtime: s, om: 0, pos: d.lists.length, recurrence: null,
                lastReset: null, nextReset: null, items: [], fm: { name: s, cycle: s } };
          d.lists.push(L);
          newLists[nk] = L;
          d.om = stampAfter(now, d.om);
          undo.lists.push({ id: L.id, m: s });
        }
      }
      // todo.js freshItem + stampItemNewest; prio and subs in xf (TD-14)
      var it = { id: uid(now, taken), text: o.title, done: false, due: o.date || null, notes: o.note, labels: x.labelIds.slice(),
                 info: [], recurrence: null, mtime: s, om: 0, pos: 0 };
      var xf = {};
      if (o.prio) { it.prio = o.prio; xf.prio = s; }
      if (o.subtasks.length) {
        it.subs = o.subtasks.map(function (t) { return { id: uid(now, taken), text: t, done: false, mtime: s }; });
        xf.subs = s;
      }
      if (Object.keys(xf).length) it.xf = xf;
      var fm = {};
      TD_FIELDS.forEach(function (f) { fm[f] = s; });
      it.fm = fm;
      it = ordered(it, TD_KEYS);
      delete it.fm;
      it.fm = fm;
      L.items.push(it);
      touched[L.id] = L;
      made.push({ i: i, id: it.id, title: it.text, target: { list: L.id, item: it.id } });
      undo.items.push({ id: it.id, m: s });
    });
    Object.keys(touched).forEach(function (id) {
      var L = touched[id];
      L.items.forEach(function (it, k) { if (isObj(it)) it.pos = k; });
      L.om = stampAfter(now, L.om);
    });
    d.lists = d.lists.map(function (l) { return isObj(l) && newLists[fold(l.name)] === l ? ordered(l, TD_LIST_KEYS) : l; });
    if (isObj(d.deleted)) d.deleted = sortedObj(d.deleted);
    return { ok: true, data: d, made: made, undo: undo };
  }
  function tdUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.lists)) return bad("To-Do has no lists.");
    var where = {};
    d.lists.forEach(function (l) {
      if (isObj(l) && Array.isArray(l.items)) l.items.forEach(function (it, k) { if (isObj(it)) where[it.id] = { l: l, it: it }; });
    });
    for (var i = 0; i < u.items.length; i++) {
      var h = where[u.items[i].id];
      if (h && h.it.mtime !== u.items[i].m) return bad("A new task was changed since; nothing was undone.");
    }
    if (!isObj(d.deleted)) d.deleted = {};
    u.items.forEach(function (x) {
      var h = where[x.id];
      if (!h) return;
      h.l.items.splice(h.l.items.indexOf(h.it), 1);
      h.l.items.forEach(function (it, k) { if (isObj(it)) it.pos = k; });
      d.deleted[x.id] = stampAfter(now, Math.max(d.deleted[x.id] || 0, h.it.mtime || 0));
    });
    (u.lists || []).forEach(function (x) {
      var at = -1;
      d.lists.forEach(function (l, k) { if (isObj(l) && l.id === x.id) at = k; });
      if (at < 0) return;
      var l = d.lists[at];
      if (l.items.length || l.mtime !== x.m) return;     // kept: someone uses it now
      d.lists.splice(at, 1);
      d.lists.forEach(function (q, k) { if (isObj(q)) q.pos = k; });
      d.deleted[x.id] = stampAfter(now, Math.max(d.deleted[x.id] || 0, l.mtime || 0));
      d.om = stampAfter(now, d.om);
    });
    d.deleted = sortedObj(d.deleted);
    return { ok: true, data: d };
  }

  // ---------- 3. Calendar ----------
  function calLabels(d, lang) {
    var dead = {};
    (Array.isArray(d.deleted) ? d.deleted : []).forEach(function (x) { if (isObj(x) && typeof x.id === "string") dead[x.id] = Math.max(dead[x.id] || 0, x.mtime || 0); });
    return (Array.isArray(d.labels) ? d.labels : []).filter(function (l) {
      return isObj(l) && typeof l.id === "string" && l.id && typeof l.name === "string" && !(has(dead, l.id) && dead[l.id] >= (l.mtime || 0));
    }).map(function (l) {
      var seed = l.mtime === 0 && has(CAL_SEEDS, l.id);
      return { id: l.id, names: seed ? CAL_SEEDS[l.id] : [l.name], show: seed ? CAL_SEEDS[l.id][lang === "el" ? 1 : 0] : l.name };
    });
  }
  function calResolve(d, items, ctx) {
    var lbls = calLabels(d, ctx && ctx.lang), out = [];
    for (var i = 0; i < items.length; i++) {
      var o = items[i], lid = null;
      if (o.label) {
        var l = pick(lbls, o.label);
        if (!l) return { err: "items[" + i + "]: " + missing("Calendar", "label", lbls, [o.label], "") };
        lid = l.id;
      }
      var dup = null;
      d.events.forEach(function (ev) {
        if (dup || !isObj(ev) || ev.date !== o.date || fold(ev.title) !== fold(o.title)) return;
        var st = ev.start || ev.time || "";
        if (o.start && st && st !== o.start) return;
        dup = { id: ev.id, title: ev.title, target: { id: ev.id, date: ev.date } };
      });
      out.push({ labelId: lid, dup: dup, labelName: lid ? pick(lbls, o.label).show : "" });
    }
    return { res: out };
  }
  function calPlan(d, items, ctx) {
    var e = needData("calendar", d, "events");
    if (e) return e;
    var r = calResolve(d, items, ctx);
    if (r.err) return bad(r.err);
    return { ok: true, rows: items.map(function (o, i) {
      var x = r.res[i], f = [["date", o.dateEnd ? o.date + " – " + o.dateEnd : o.date]];
      if (o.start) f.push(["start", o.end ? o.start + "–" + o.end : o.start]);
      if (o.location) f.push(["location", o.location]);
      if (x.labelName) f.push(["label", x.labelName]);
      if (o.remind) f.push(["reminder", o.remind]);
      if (o.note) f.push(["note", preview(o.note, 200)]);
      return { title: o.title, fields: f, dup: x.dup };
    }) };
  }
  function calApply(d, items, now, skip, ctx) {
    var r = calResolve(d, items, ctx);
    if (r.err) return bad(r.err);
    var taken = {}, made = [], undo = { app: "calendar", t: "new", items: [] }, s = stampAfter(now, 0);
    d.events.forEach(function (ev) { if (isObj(ev)) taken[ev.id] = 1; });
    (Array.isArray(d.deleted) ? d.deleted : []).forEach(function (x) { if (isObj(x)) taken[x.id] = 1; });
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      // calendar.js sanitizeEvent key order; one-off events only
      var ev = { id: uid(now, taken), date: o.date, dateEnd: o.dateEnd || null, start: o.start || null, end: o.end || null,
                 title: o.title, note: o.note, location: o.location, labelId: r.res[i].labelId, recur: null,
                 remindMin: o.remind, mtime: s };
      d.events.push(ev);
      made.push({ i: i, id: ev.id, title: ev.title, target: { id: ev.id, date: ev.date } });
      undo.items.push({ id: ev.id, m: s });
    });
    d.events.sort(function (a, b) { return cmpStr(String(a && a.id), String(b && b.id)); });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function calUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.events)) return bad("Calendar has no events.");
    var at = {};
    d.events.forEach(function (ev, k) { if (isObj(ev)) at[ev.id] = ev; });
    for (var i = 0; i < u.items.length; i++) {
      var ev = at[u.items[i].id];
      if (ev && ev.mtime !== u.items[i].m) return bad("A new event was changed since; nothing was undone.");
    }
    if (!Array.isArray(d.deleted)) d.deleted = [];
    u.items.forEach(function (x) {
      var ev = at[x.id];
      if (!ev) return;
      d.events.splice(d.events.indexOf(ev), 1);
      d.deleted = d.deleted.filter(function (t) { return !(isObj(t) && t.id === x.id); });
      d.deleted.push({ id: x.id, mtime: stampAfter(now, ev.mtime) });
    });
    d.deleted.sort(function (a, b) { return cmpStr(String(a && a.id), String(b && b.id)); });
    return { ok: true, data: d };
  }

  // ---------- 4. Budget ----------
  // Budget stores nothing before its first entry: then it starts from
  // budget.js emptyData(), as its own first commit does.
  function bgEmpty() {
    return { ver: 1, tx: [], cats: [], bud: [], rec: [], acc: [], xfer: [], asg: [], goal: [], prof: [], rule: [], bnk: [], set: { m: 0, cur: "EUR" }, tombs: {} };
  }
  function bgCats(d, k, lang) {
    var tombs = isObj(d.tombs) ? d.tombs : {}, stored = {}, out = [];
    (Array.isArray(d.cats) ? d.cats : []).forEach(function (c) { if (isObj(c) && typeof c.id === "string") stored[c.id] = c; });
    Object.keys(BUDGET_CATS[k]).forEach(function (key) {
      var id = BUDGET_CATS[k][key];
      if (has(tombs, "cat:" + id) && !stored[id]) return;      // the user removed it
      var nm = stored[id] && stored[id].name ? [stored[id].name] : [];
      out.push({ id: id, names: nm.concat(BUDGET_SEED_NAMES[id], [key]), show: nm[0] || BUDGET_SEED_NAMES[id][lang === "el" ? 1 : 0] });
    });
    Object.keys(stored).forEach(function (id) {
      var c = stored[id];
      if (has(BUDGET_SEED_NAMES, id) || c.k !== k || typeof c.name !== "string" || !c.name) return;
      if (has(tombs, "cat:" + id) && tombs["cat:" + id] >= (c.m || 0)) return;
      out.push({ id: id, names: [c.name], show: c.name });
    });
    return out;
  }
  function bgResolve(d, items, ctx) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var o = items[i], c = "", cname = "";
      if (o.cat) {
        var cats = bgCats(d, o.k, ctx && ctx.lang), hit = pick(cats, o.cat);
        if (!hit) return { err: "items[" + i + "]: " + missing("Budget", (o.k === "i" ? "income" : "expense") + " category", cats, [o.cat], "Categories") };
        c = hit.id;
        cname = hit.show;
      }
      var day = o.d || (ctx && realDate(ctx.today)) || "";
      if (!day) return { err: "items[" + i + "]: date is required (YYYY-MM-DD)." };
      var dup = null;
      d.tx.forEach(function (x) {
        if (!dup && isObj(x) && x.d === day && x.a === o.a && x.k === o.k) dup = { id: "t:" + x.id, title: (x.n || money(x.a)), target: { tx: x.id } };
      });
      out.push({ c: c, cname: cname, d: day, dup: dup });
    }
    return { res: out };
  }
  function bgPlan(d, items, ctx) {
    if (d === null || d === undefined) d = bgEmpty();
    var e = needData("budget", d, "tx");
    if (e) return e;
    var r = bgResolve(d, items, ctx);
    if (r.err) return bad(r.err);
    var cur = isObj(d.set) && typeof d.set.cur === "string" ? d.set.cur : "";
    return { ok: true, rows: items.map(function (o, i) {
      var x = r.res[i], f = [["kind", o.k === "i" ? "income" : "expense"], ["amount", money(o.a) + (cur ? " " + cur : "")], ["date", x.d]];
      if (x.cname) f.push(["category", x.cname]);
      return { title: o.n || money(o.a) + (cur ? " " + cur : ""), fields: f, dup: x.dup };
    }) };
  }
  function bgApply(d, items, now, skip, ctx) {
    if (d === null || d === undefined) d = bgEmpty();
    var r = bgResolve(d, items, ctx);
    if (r.err) return bad(r.err);
    var taken = {}, made = [], undo = { app: "budget", t: "new", items: [] };
    if (!isObj(d.tombs)) d.tombs = {};
    d.tx.forEach(function (x) { if (isObj(x)) taken[x.id] = 1; });
    Object.keys(d.tombs).forEach(function (k) { if (k.indexOf("tx:") === 0) taken[k.slice(3)] = 1; });
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var id = uid(now, taken);
      // budget.js normTx shape
      var x = { id: id, m: stampAfter(now, d.tombs["tx:" + id] || 0), d: r.res[i].d, a: o.a, k: o.k, c: r.res[i].c, n: o.n };
      d.tx.push(x);
      made.push({ i: i, id: id, title: o.n || money(o.a), target: { tx: id }, sid: "t:" + id });
      undo.items.push({ id: id, m: x.m });
    });
    d.tx.sort(function (p, q) { return cmpStr(String(p && p.id), String(q && q.id)); });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function bgUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.tx)) return bad("Budget has no entries.");
    var at = {};
    d.tx.forEach(function (x) { if (isObj(x)) at[x.id] = x; });
    for (var i = 0; i < u.items.length; i++) {
      var x = at[u.items[i].id];
      if (x && x.m !== u.items[i].m) return bad("A new entry was changed since; nothing was undone.");
    }
    if (!isObj(d.tombs)) d.tombs = {};
    u.items.forEach(function (y) {
      var x = at[y.id];
      if (!x) return;
      d.tx.splice(d.tx.indexOf(x), 1);
      d.tombs["tx:" + y.id] = stampAfter(now, Math.max(d.tombs["tx:" + y.id] || 0, x.m || 0));
    });
    d.tombs = sortedObj(d.tombs);
    return { ok: true, data: d };
  }

  // ---------- 5. Notes ----------
  function ntBooks(d) {
    return (Array.isArray(d.notebooks) ? d.notebooks : []).filter(function (n) { return isObj(n) && typeof n.id === "string" && typeof n.name === "string" && n.name.trim(); })
      .sort(function (a, b) { return ((a.pos || 0) - (b.pos || 0)) || cmpStr(a.id, b.id); });
  }
  function ntResolve(d, items, ctx) {
    var books = ntBooks(d).map(function (n) { return { id: n.id, names: [n.name], n: n }; }), out = [];
    for (var i = 0; i < items.length; i++) {
      var o = items[i], nb = null, seed = false;
      if (o.nb) {
        var hit = pick(books, o.nb);
        if (!hit) return { err: "items[" + i + "]: " + missing("Notes", "notebook", books, [o.nb], "") };
        nb = hit.n;
      } else if (books.length) nb = books[0].n;
      else { nb = { id: NT_SEED, name: NT_SEED_NAMES[ctx && has(NT_SEED_NAMES, ctx.lang) ? ctx.lang : "en"], mtime: 0, pos: 0 }; seed = true; }
      var lbls = (Array.isArray(d.labels) ? d.labels : []).filter(function (l) { return isObj(l) && l.nb === nb.id && typeof l.name === "string"; })
        .map(function (l) { return { id: l.id, names: [l.name] }; });
      var miss = [], ids = [];
      o.labels.forEach(function (n) { var l = pick(lbls, n); if (!l) miss.push(n); else if (ids.indexOf(l.id) < 0) ids.push(l.id); });
      if (miss.length) return { err: "items[" + i + "]: " + missing("Notes", "label", lbls, miss, "notebook " + nb.name) };
      var dup = null;
      d.pages.forEach(function (p) {
        if (!dup && isObj(p) && p.nb === nb.id && fold(p.title) === fold(o.title)) dup = { id: p.id, title: p.title, target: { page: p.id, nb: p.nb } };
      });
      out.push({ nb: nb, seed: seed, labelIds: ids.sort(cmpStr), dup: dup });
    }
    return { res: out };
  }
  function ntPlan(d, items, ctx) {
    var e = needData("notes", d, "pages");
    if (e) return e;
    var r = ntResolve(d, items, ctx);
    if (r.err) return bad(r.err);
    return { ok: true, rows: items.map(function (o, i) {
      var x = r.res[i], f = [["notebook", x.nb.name]];
      if (o.labels.length) f.push(["labels", o.labels.join(", ")]);
      if (o.text) f.push(["note", preview(o.text, 200)]);
      return { title: o.title, fields: f, dup: x.dup };
    }) };
  }
  function ntApply(d, items, now, skip, ctx) {
    var r = ntResolve(d, items, ctx);
    if (r.err) return bad(r.err);
    var taken = {}, made = [], undo = { app: "notes", t: "new", items: [] }, s = stampAfter(now, 0);
    if (!isObj(d.tombs)) d.tombs = {};
    if (!Array.isArray(d.notebooks)) d.notebooks = [];
    d.pages.forEach(function (p) { if (isObj(p)) taken[p.id] = 1; });
    Object.keys(d.tombs).forEach(function (k) { taken[k] = 1; });
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var nb = r.res[i].nb;
      if (r.res[i].seed && !d.notebooks.some(function (n) { return isObj(n) && n.id === nb.id; })) d.notebooks.push(clone(nb));
      // notes.js insertPage: after the notebook's top pages
      var maxPos = 0;
      d.pages.forEach(function (q) { if (isObj(q) && q.nb === nb.id && q.parent === null && q.pos > maxPos) maxPos = q.pos; });
      var p = { id: uid(now, taken, "p"), nb: nb.id, parent: null, title: o.title, text: o.text, mtime: s, pos: maxPos + 1,
                labels: r.res[i].labelIds.slice(), pinned: false, ct: s, st: s };
      d.pages.push(p);
      made.push({ i: i, id: p.id, title: p.title, target: { page: p.id, nb: p.nb } });
      undo.items.push({ id: p.id, m: s });
    });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function ntUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.pages)) return bad("Notes has no pages.");
    var at = {};
    d.pages.forEach(function (p) { if (isObj(p)) at[p.id] = p; });
    for (var i = 0; i < u.items.length; i++) {
      var p = at[u.items[i].id];
      if (p && (p.mtime !== u.items[i].m || d.pages.some(function (q) { return isObj(q) && q.parent === p.id; }))) {
        return bad("A new note was changed since; nothing was undone.");
      }
    }
    if (!isObj(d.tombs)) d.tombs = {};
    u.items.forEach(function (x) {
      var p = at[x.id];
      if (!p) return;
      d.pages.splice(d.pages.indexOf(p), 1);
      d.tombs[x.id] = stampAfter(now, Math.max(d.tombs[x.id] || 0, p.mtime || 0));
    });
    d.tombs = sortedObj(d.tombs);
    return { ok: true, data: d };
  }

  // ---------- 6. Bookmarks ----------
  function bmFolders(d) {
    var fs = isObj(d.folders) ? d.folders : {};
    return Object.keys(fs).filter(function (id) { return isObj(fs[id]) && typeof fs[id].name === "string"; }).map(function (id) {
      return { id: id, names: id === BM_ROOT ? BM_ROOT_NAMES : [fs[id].name] };
    });
  }
  function bmResolve(d, items, ctx) {
    var fl = bmFolders(d), out = [], bm = ctx && ctx.bm;
    if (!bm || typeof bm.dupeKey !== "function") return { err: "Bookmarks is not ready." };
    var byKey = {};
    Object.keys(d.items).forEach(function (id) { var it = d.items[id]; if (isObj(it) && typeof it.url === "string") byKey[bm.dupeKey(it.url)] = it; });
    for (var i = 0; i < items.length; i++) {
      var o = items[i], fid = BM_ROOT, fname = BM_ROOT_NAMES[(ctx && BM_ROOT_SHOW[ctx.lang]) || 0];
      if (o.folder) {
        var hit = pick(fl, o.folder);
        if (!hit) return { err: "items[" + i + "]: " + missing("Bookmarks", "folder", fl, [o.folder], "") };
        fid = hit.id;
        fname = hit.id === BM_ROOT ? fname : hit.names[0];
      }
      var same = byKey[bm.dupeKey(o.url)];
      out.push({ fid: fid, fname: fname, same: same ? { id: same.id, title: same.title || same.url, target: { id: same.id } } : null });
    }
    return { res: out };
  }
  function bmPlan(d, items, ctx) {
    var e = needData("bookmarks", d, null);
    if (e) return e;
    var r = bmResolve(d, items, ctx);
    if (r.err) return bad(r.err);
    return { ok: true, rows: items.map(function (o, i) {
      var x = r.res[i], f = [["url", o.url], ["folder", x.fname]];
      if (o.tags.length) f.push(["labels", o.tags.join(", ")]);
      if (o.note) f.push(["note", preview(o.note, 200)]);
      // The same address can't be there twice (bookmarks.js quickAdd).
      return { title: o.title || o.url, fields: f, dup: x.same, same: !!x.same };
    }) };
  }
  function bmApply(d, items, now, skip, ctx) {
    var r = bmResolve(d, items, ctx);
    if (r.err) return bad(r.err);
    var taken = {}, made = [], undo = { app: "bookmarks", t: "new", items: [] }, s = stampAfter(now, 0);
    if (!isObj(d.deleted)) d.deleted = {};
    Object.keys(d.items).forEach(function (id) { taken[id] = 1; });
    Object.keys(d.deleted).forEach(function (id) { taken[id] = 1; });
    items.forEach(function (o, i) {
      if ((skip && skip[i]) || r.res[i].same) return;
      // bookmarks.js sanitizeItem shape, as quickAdd stores it
      var it = { id: uid(now, taken, "bm-"), url: o.url, title: o.title || o.url, note: o.note, folderId: r.res[i].fid, tags: o.tags.slice(),
                 status: "ok", visits: 0, lastVisit: 0, fav: false, pos: null, added: s, modified: s };
      d.items[it.id] = it;
      made.push({ i: i, id: it.id, title: it.title, target: { id: it.id } });
      undo.items.push({ id: it.id, m: s });
    });
    d.items = sortedObj(d.items);
    d.deleted = sortedObj(d.deleted);
    return { ok: true, data: d, made: made, undo: undo };
  }
  function bmUndo(d, u, now) {
    if (!isObj(d) || !isObj(d.items)) return bad("Bookmarks has no bookmarks.");
    for (var i = 0; i < u.items.length; i++) {
      var it = d.items[u.items[i].id];
      if (isObj(it) && it.modified !== u.items[i].m) return bad("A new bookmark was changed since; nothing was undone.");
    }
    if (!isObj(d.deleted)) d.deleted = {};
    u.items.forEach(function (x) {
      var it = d.items[x.id];
      if (!isObj(it)) return;
      delete d.items[x.id];
      d.deleted[x.id] = stampAfter(now, Math.max(d.deleted[x.id] || 0, it.modified || 0));
    });
    d.deleted = sortedObj(d.deleted);
    return { ok: true, data: d };
  }

  // ---------- 7. Kanban ----------
  function kbLive(d) {
    var gone = isObj(d.boardDeleted) ? d.boardDeleted : {};
    return d.boards.filter(function (b) {
      return isObj(b) && typeof b.id === "string" && b.id.indexOf("tpl-") !== 0 && !b.archived && Array.isArray(b.columns) &&
        !(typeof gone[b.id] === "number" && gone[b.id] >= (b.mtime || 0));
    });
  }
  function kbResolve(d, items) {
    var boards = kbLive(d).map(function (b) { return { id: b.id, names: [String(b.name || "")], b: b }; }), out = [];
    for (var i = 0; i < items.length; i++) {
      var o = items[i], b;
      if (o.board) {
        var hb = pick(boards, o.board);
        if (!hb) return { err: "items[" + i + "]: " + missing("Kanban", "board", boards, [o.board], "") };
        b = hb.b;
      } else {
        if (!boards.length) return { err: "Kanban has no open boards. Ask the user to make one in Kanban." };
        b = boards[0].b;
      }
      var cols = b.columns.filter(function (c) { return isObj(c) && Array.isArray(c.cards); });
      if (!cols.length) return { err: "items[" + i + "]: the board " + b.name + " has no columns. Ask the user to add one in Kanban." };
      var col = cols[0];
      if (o.column) {
        var hits = cols.filter(function (c) { return fold(c.name) === fold(o.column); });
        if (!hits.length) return { err: "items[" + i + "]: " + missing("Kanban", "column", cols.map(function (c) { return { id: c.id, names: [String(c.name || "")] }; }), [o.column], "board " + b.name) };
        if (hits.length > 1) return { err: "items[" + i + "]: the board " + b.name + " has more than one column called " + o.column + "; ask the user which one." };
        col = hits[0];
      }
      var lbls = (Array.isArray(b.labels) ? b.labels : []).filter(function (l) { return isObj(l) && typeof l.id === "string" && typeof l.name === "string"; })
        .map(function (l) { return { id: l.id, names: [l.name] }; });
      var miss = [], ids = [];
      o.labels.forEach(function (n) { var l = pick(lbls, n); if (!l) miss.push(n); else if (ids.indexOf(l.id) < 0) ids.push(l.id); });
      if (miss.length) return { err: "items[" + i + "]: " + missing("Kanban", "label", lbls, miss, "board " + b.name) };
      var dup = null;
      cols.forEach(function (c) {
        c.cards.forEach(function (k) {
          if (!dup && isObj(k) && fold(k.text) === fold(o.title)) dup = { id: k.id, title: k.text, target: { board: b.id, col: c.id, card: k.id } };
        });
      });
      out.push({ b: b, col: col, labelIds: ids, dup: dup });
    }
    return { res: out };
  }
  function kbPlan(d, items) {
    var e = needData("kanban", d, "boards");
    if (e) return e;
    var r = kbResolve(d, items);
    if (r.err) return bad(r.err);
    return { ok: true, rows: items.map(function (o, i) {
      var x = r.res[i], f = [["board", String(x.b.name || "")], ["column", String(x.col.name || "")]];
      if (o.due) f.push(["due", o.due]);
      if (o.labels.length) f.push(["labels", o.labels.join(", ")]);
      if (o.subtasks.length) f.push(["subtasks", o.subtasks.join(" · ")]);
      if (o.note) f.push(["note", preview(o.note, 200)]);
      return { title: o.title, fields: f, dup: x.dup };
    }) };
  }
  // The board as model.js canonState writes it (key order, pos, sorted maps).
  function kbCanon(b) {
    b.deleted = sortedObj(isObj(b.deleted) ? b.deleted : {});
    b.columns = b.columns.map(function (col, ci) {
      if (!isObj(col)) return col;
      col.pos = ci;
      col.cards = (Array.isArray(col.cards) ? col.cards : []).map(function (c, ki) {
        if (!isObj(c)) return c;
        c.pos = ki;
        if (isObj(c.fm)) c.fm = sortedObj(c.fm);
        return ordered(c, KB_CARD_KEYS);
      });
      return ordered(col, KB_COL_KEYS);
    });
    return ordered(b, KB_BOARD_KEYS);
  }
  function kbApply(d, items, now, skip) {
    var r = kbResolve(d, items);
    if (r.err) return bad(r.err);
    var taken = {}, made = [], undo = { app: "kanban", t: "new", items: [] }, s = stampAfter(now, 0), add = {};
    d.boards.forEach(function (b) {
      if (!isObj(b)) return;
      (Array.isArray(b.columns) ? b.columns : []).forEach(function (c) {
        if (isObj(c) && Array.isArray(c.cards)) c.cards.forEach(function (k) { if (isObj(k)) taken[k.id] = 1; });
      });
      Object.keys(isObj(b.deleted) ? b.deleted : {}).forEach(function (id) { taken[id] = 1; });
    });
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var x = r.res[i];
      // kanban.js newCardObj: every field group stamped (K1)
      var fm = {};
      KB_GROUPS.concat(["m"]).sort(cmpStr).forEach(function (g) { fm[g] = s; });
      var card = { id: uid(now, taken), text: o.title, notes: o.note, due: o.due || null, labels: x.labelIds.slice(),
                   subtasks: o.subtasks.map(function (t) { return { id: uid(now, taken), text: t, completed: false, m: s }; }),
                   info: [], mtime: s, pos: 0, fm: fm };
      var k = x.b.id + "|" + x.col.id;
      if (!add[k]) add[k] = { b: x.b, col: x.col, cards: [] };
      add[k].cards.push(card);
      made.push({ i: i, id: card.id, title: card.text, target: { board: x.b.id, col: x.col.id, card: card.id } });
      undo.items.push({ board: x.b.id, id: card.id, m: s });
    });
    var touched = {};
    Object.keys(add).forEach(function (k) {
      var a = add[k];
      // on top, in the order given (kanban.js addCardsDialog)
      a.col.cards = a.cards.concat(a.col.cards);
      a.col.om = stampAfter(now, a.col.om);
      touched[a.b.id] = 1;
    });
    d.boards = d.boards.map(function (b) { return isObj(b) && touched[b.id] ? kbCanon(b) : b; });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function kbUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.boards)) return bad("Kanban has no boards.");
    function find(x) {
      var hit = null;
      d.boards.forEach(function (b) {
        if (!isObj(b) || b.id !== x.board || !Array.isArray(b.columns)) return;
        b.columns.forEach(function (c) {
          if (isObj(c) && Array.isArray(c.cards)) c.cards.forEach(function (k) { if (isObj(k) && k.id === x.id) hit = { b: b, col: c, card: k }; });
        });
      });
      return hit;
    }
    for (var i = 0; i < u.items.length; i++) {
      var h = find(u.items[i]);
      if (h && h.card.mtime !== u.items[i].m) return bad("A new card was changed since; nothing was undone.");
    }
    var touched = {};
    u.items.forEach(function (x) {
      var h = find(x);
      if (!h) return;
      h.col.cards.splice(h.col.cards.indexOf(h.card), 1);
      if (!isObj(h.b.deleted)) h.b.deleted = {};
      h.b.deleted[x.id] = stampAfter(now, Math.max(h.b.deleted[x.id] || 0, h.card.mtime || 0));
      touched[h.b.id] = 1;
    });
    d.boards = d.boards.map(function (b) { return isObj(b) && touched[b.id] ? kbCanon(b) : b; });
    return { ok: true, data: d };
  }

  // ---------- 8. CRM: history, follow-ups, deals (wave A2) ----------
  // crm/core.js rows: whole-record LWW on m, tombs[id], lists sorted by
  // id; the result goes through CRM's own norm() (ctx.crm), as CRM's
  // commit does. A deal's value is in CRM's currency (prefs.cur).
  var CRM_LIST = { crm_activity: "acts", crm_followup: "fups", crm_deal: "deals" };
  function crmAlive(d, list, id) {
    var tombs = isObj(d.tombs) ? d.tombs : {};
    var hit = null;
    (Array.isArray(d[list]) ? d[list] : []).forEach(function (x) {
      if (isObj(x) && x.id === id && !(typeof tombs[id] === "number" && tombs[id] >= (x.m || 0))) hit = x;
    });
    return hit;
  }
  // CRM's built-in stage labels (crm/crm.js, i18n/de/crm.js "stage.*"),
  // so "Πρόταση" or "proposal" finds the stage the board shows.
  var STAGE_NAMES = {
    "new": ["New", "Νέα", "Neu"], contact: ["Contacted", "Επικοινωνία", "Kontaktiert"],
    proposal: ["Proposal", "Πρόταση", "Angebot"], nego: ["Negotiation", "Διαπραγμάτευση", "Verhandlung"],
    won: ["Won", "Κερδήθηκε", "Gewonnen"], lost: ["Lost", "Χάθηκε", "Verloren"]
  };
  function stageShow(id, lang) {
    var n = STAGE_NAMES[id];
    return n ? n[lang === "el" ? 1 : lang === "de" ? 2 : 0] : id;
  }
  function crmStages(d, ctx) {
    var C = ctx && ctx.crm, out = [], lang = ctx && ctx.lang;
    var list = C && typeof C.stages === "function" ? C.stages(d) : ["new", "contact", "proposal", "nego"].map(function (id) { return { id: id, name: "", open: true }; });
    list.forEach(function (st) {
      out.push({ id: st.id, names: (st.name ? [st.name] : []).concat(STAGE_NAMES[st.id] || [], [st.id]), show: st.name || stageShow(st.id, lang) });
    });
    ["won", "lost"].forEach(function (id) { if (!out.some(function (x) { return x.id === id; })) out.push({ id: id, names: STAGE_NAMES[id].concat([id]), show: stageShow(id, lang) }); });
    return out;
  }
  function localAt(ymd, time, now) {
    var t = new Date(now);
    if (!ymd) return Math.floor(now);
    var p = ymd.split("-"), h = 12, mi = 0;
    if (time) { h = +time.slice(0, 2); mi = +time.slice(3, 5); }
    else {
      var today = t.getFullYear() + "-" + (t.getMonth() < 9 ? "0" : "") + (t.getMonth() + 1) + "-" + (t.getDate() < 10 ? "0" : "") + t.getDate();
      if (ymd === today) return Math.floor(now);
    }
    return new Date(+p[0], +p[1] - 1, +p[2], h, mi).getTime();
  }
  function crmResolve(appId, d, items, ctx) {
    var out = [], stg = appId === "crm_deal" ? crmStages(d, ctx) : null;
    for (var i = 0; i < items.length; i++) {
      var o = items[i], w = "items[" + i + "]: ";
      var cu = typeof o.cust === "string" ? crmAlive(d, "cust", o.cust) : null;
      if (!cu) return { err: w + "that customer is no longer in CRM." };
      var deal = null;
      if (o.deal) {
        deal = typeof o.dealId === "string" ? crmAlive(d, "deals", o.dealId) : null;
        if (!deal) return { err: w + "that deal is no longer in CRM." };
        if (deal.cust !== cu.id) return { err: w + "that deal is with another customer." };
      }
      var x = { cust: cu, deal: deal, dup: null };
      if (appId === "crm_activity") {
        d.acts.forEach(function (a) {
          if (x.dup || !isObj(a) || a.cust !== cu.id || a.k !== o.k || fold(a.text) !== fold(o.text)) return;
          x.dup = { id: a.id, title: preview(a.text, 80), target: { act: a.id } };
        });
      } else if (appId === "crm_followup") {
        d.fups.forEach(function (f) {
          if (!x.dup && isObj(f) && f.cust === cu.id && !f.done && f.d === o.d && fold(f.text) === fold(o.text)) x.dup = { id: f.id, title: f.text, target: { fup: f.id } };
        });
      } else {
        var stage = "new", show = "new";
        if (o.stage) {
          var hs = pick(stg, o.stage);
          if (!hs) return { err: w + missing("CRM", "stage", stg.map(function (z) { return { id: z.id, names: [z.show] }; }), [o.stage], "Pipeline") };
          stage = hs.id; show = hs.show;
        } else {
          var first = stg.filter(function (z) { return z.id !== "won" && z.id !== "lost"; })[0];
          if (first) { stage = first.id; show = first.show; }
        }
        x.stage = stage; x.stageShow = show;
        d.deals.forEach(function (dl) {
          if (!x.dup && isObj(dl) && dl.cust === cu.id && dl.stage !== "won" && dl.stage !== "lost" && fold(dl.title) === fold(o.title)) x.dup = { id: dl.id, title: dl.title, target: { deal: dl.id } };
        });
      }
      out.push(x);
    }
    var list = CRM_LIST[appId], lim = CRM_LIMITS[list];
    if ((Array.isArray(d[list]) ? d[list].length : 0) + items.length > lim) return { err: "CRM keeps " + lim + " of these; there is no room for " + items.length + " more." };
    return { res: out };
  }
  function crmNeed(d) {
    if (!isObj(d) || !Array.isArray(d.cust)) return bad("CRM has not been opened on this device yet. Ask the user to open CRM once.");
    ["deals", "acts", "fups"].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    if (!isObj(d.tombs)) d.tombs = {};
    return null;
  }
  function crmPlanOf(appId) {
    return function (d, items, ctx) {
      d = clone(d);
      var e = crmNeed(d);
      if (e) return e;
      var r = crmResolve(appId, d, items, ctx);
      if (r.err) return bad(r.err);
      var cur = isObj(d.prefs) && typeof d.prefs.cur === "string" ? d.prefs.cur : "EUR";
      return { ok: true, rows: items.map(function (o, i) {
        var x = r.res[i], f = [["customer", x.cust.name]];
        if (appId === "crm_activity") {
          f.push(["channel", o.k]);
          if (o.date) f.push(["date", o.date + (o.time ? " " + o.time : "")]);
          if (o.who) f.push(["who", o.who]);
          if (x.deal) f.push(["deal", x.deal.title]);
          return { title: preview(o.text, 120), fields: f, dup: x.dup };
        }
        if (appId === "crm_followup") {
          f.push(["date", o.d + (o.t ? " " + o.t : "")]);
          if (x.deal) f.push(["deal", x.deal.title]);
          return { title: o.text, fields: f, dup: x.dup };
        }
        f.push(["stage", x.stageShow]);
        if (o.val) f.push(["amount", money(o.val) + " " + cur]);
        if (o.close) f.push(["close", o.close]);
        if (o.prob !== null) f.push(["probability", o.prob + "%"]);
        if (o.why && x.stage === "lost") f.push(["reason", o.why]);
        if (o.note) f.push(["note", preview(o.note, 200)]);
        return { title: o.title, fields: f, dup: x.dup };
      }) };
    };
  }
  function crmNewId(now, taken) {
    for (var i = 0; i < 50; i++) {
      var id = Math.floor(now).toString(36) + rnd(8).toLowerCase();
      if (!taken[id]) { taken[id] = 1; return id; }
    }
    return Math.floor(now).toString(36) + rnd(16).toLowerCase();
  }
  function crmApplyOf(appId) {
    return function (d, items, now, skip, ctx) {
      var e = crmNeed(d);
      if (e) return e;
      var r = crmResolve(appId, d, items, ctx);
      if (r.err) return bad(r.err);
      var list = CRM_LIST[appId], taken = {}, made = [], undo = { app: appId, t: "new", items: [] };
      ["cust", "deals", "acts", "fups"].forEach(function (k) { (Array.isArray(d[k]) ? d[k] : []).forEach(function (x) { if (isObj(x)) taken[x.id] = 1; }); });
      Object.keys(d.tombs).forEach(function (id) { taken[id] = 1; });
      items.forEach(function (o, i) {
        if (skip && skip[i]) return;
        var x = r.res[i], id = crmNewId(now, taken), m = stampAfter(now, d.tombs[id] || 0), row;
        if (appId === "crm_activity") {
          row = { id: id, m: m, cust: x.cust.id, k: o.k, at: localAt(o.date, o.time, now), text: o.text };
          if (x.deal) row.deal = x.deal.id;
          if (o.who) row.who = o.who;
          made.push({ i: i, id: id, title: preview(o.text, 80), target: { act: id } });
        } else if (appId === "crm_followup") {
          row = { id: id, m: m, cust: x.cust.id, d: o.d, text: o.text };
          if (o.t) row.t = o.t;
          if (x.deal) row.deal = x.deal.id;
          made.push({ i: i, id: id, title: o.text, target: { fup: id } });
        } else {
          row = { id: id, m: m, cust: x.cust.id, title: o.title, val: o.val, stage: x.stage };
          if (o.prob !== null) row.prob = o.prob;
          if (o.close) row.close = o.close;
          if (x.stage === "won" || x.stage === "lost") row.cd = (ctx && realDate(ctx.today)) || "";
          if (!row.cd) delete row.cd;
          if (o.why && x.stage === "lost") row.why = o.why;
          if (o.note) row.note = o.note;
          row.ct = Math.floor(now);
          made.push({ i: i, id: id, title: o.title, target: { deal: id } });
        }
        d[list].push(row);
        undo.items.push({ id: id, m: m });
      });
      d[list].sort(function (a, b) { return cmpStr(String(a && a.id), String(b && b.id)); });
      var C = ctx && ctx.crm;
      return { ok: true, data: C && typeof C.norm === "function" ? C.norm(d) : d, made: made, undo: undo };
    };
  }
  function crmUndoOf(appId) {
    return function (d, u, now) {
      if (!isObj(d) || !Array.isArray(d[CRM_LIST[appId]])) return bad("CRM has none of these.");
      var list = CRM_LIST[appId], at = {};
      d[list].forEach(function (x) { if (isObj(x)) at[x.id] = x; });
      for (var i = 0; i < u.items.length; i++) {
        var x = at[u.items[i].id];
        if (!x) continue;
        if (x.m !== u.items[i].m) return bad("A new record was changed since; nothing was undone.");
        if (appId === "crm_deal" && ["acts", "fups", "ctr"].some(function (k) { return (Array.isArray(d[k]) ? d[k] : []).some(function (y) { return isObj(y) && y.deal === x.id; }); })) {
          return bad("A new deal has history or follow-ups since; nothing was undone.");
        }
      }
      if (!isObj(d.tombs)) d.tombs = {};
      u.items.forEach(function (y) {
        var x = at[y.id];
        if (!x) return;
        d[list].splice(d[list].indexOf(x), 1);
        d.tombs[y.id] = stampAfter(now, Math.max(d.tombs[y.id] || 0, x.m || 0));
      });
      d.tombs = sortedObj(d.tombs);
      return { ok: true, data: d };
    };
  }

  // ---------- 9. API ----------
  var PLAN = { todo: tdPlan, calendar: calPlan, budget: bgPlan, notes: ntPlan, bookmarks: bmPlan, kanban: kbPlan };
  var APPLY = { todo: tdApply, calendar: calApply, budget: bgApply, notes: ntApply, bookmarks: bmApply, kanban: kbApply };
  var UNDO = { todo: tdUndo, calendar: calUndo, budget: bgUndo, notes: ntUndo, bookmarks: bmUndo, kanban: kbUndo };
  CRM_IDS.forEach(function (id) { PLAN[id] = crmPlanOf(id); APPLY[id] = crmApplyOf(id); UNDO[id] = crmUndoOf(id); });
  // ctx = { today: the device's YYYY-MM-DD, lang, bm: OrosBookmarksCore }
  // → { ok, rows: [{ title, fields: [[field, value]], dup?, same?, hint? }] }
  function plan(appId, data, items, ctx) {
    if (!has(APPS, appId)) return bad("unknown app");
    return PLAN[appId](data, items, ctx);
  }
  // skip[i] = the user unticked item i. → { ok, data, made: [{ i, id,
  // title, target, sid? }], undo }
  function apply(appId, data, items, now, skip, ctx) {
    var p = plan(appId, data, items, ctx);
    if (!p.ok) return p;
    return APPLY[appId](clone(data), items, now, skip, ctx);
  }
  function undo(appId, data, u, now) {
    if (!has(APPS, appId) || !isObj(u) || u.app !== appId || u.t !== "new" || !Array.isArray(u.items)) return bad("bad undo");
    return UNDO[appId](clone(data), u, now);
  }
  function storageKey(appId) { return has(APPS, appId) ? APPS[appId].key : ""; }
  // Wave A4 (assistant/additems2.js): more apps register here, each
  // { key, name, norm, plan, apply, undo }, with the same rules.
  function extend(mods) {
    Object.keys(mods).forEach(function (id) {
      var m = mods[id];
      APPS[id] = { key: m.key, name: m.name };
      NORM[id] = m.norm; PLAN[id] = m.plan; APPLY[id] = m.apply; UNDO[id] = m.undo;
      if (APP_IDS.indexOf(id) < 0) APP_IDS.push(id);
    });
  }
  // Shared with additems2.js.
  var helpers = {
    has: has, isObj: isObj, clone: clone, one: one, para: para, cmpStr: cmpStr, bad: bad, stampAfter: stampAfter,
    fold: fold, realDate: realDate, hm: hm, sortedObj: sortedObj, uid: uid, text1: text1, textN: textN, dateOf: dateOf,
    names: names, pick: pick, missing: missing, preview: preview, money: money
  };

  var api = {
    APP_IDS: APP_IDS, CRM_IDS: CRM_IDS, MAX_ITEMS: MAX_ITEMS, LIM: LIM, REMIND: REMIND, ACT_KINDS: ACT_KINDS,
    normItems: normItems, plan: plan, apply: apply, undo: undo, storageKey: storageKey, extend: extend, helpers: helpers
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosAssistAdd = api;
})(typeof window !== "undefined" ? window : this);
