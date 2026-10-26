// ============================================================
// orOS Assistant — edits2.js (wave A3: change_item in more apps)
// The changes the Assistant may propose in Notes, Timesheet,
// Invoices (a payment only), Chore Wheel, Meal Planner, Travel,
// Split, Garage, Pet care, Workouts and Library. Loaded by
// assistant.js the first time one of their items is changed (with
// the app's own core.js where it has one), and registered into
// assistant/edits.js (extend), whose plan / apply / undo / diff and
// card stay the same for every app.
// Every change is written as the app writes it: the app's own stamps
// (whole-record m, per-field f, Notes' content and structure clocks)
// and, where the app has a core, through that core's own merge, so
// the stored copy is already in the app's canonical form and opening
// the app uploads nothing. A text longer than the app keeps is
// refused, never cut. Nothing is deleted here.
// change(d, target, ch, now) works on d IN PLACE (a copy of the
// stored JSON) → { ok, title, before, after, del, undo } | { ok:false, err }
// undo(d, u, now) → { ok } | { ok:false, err }, also in place.
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var E = root.OrosAssistEdits || (NODE ? require("./edits.js") : null);
  if (!E) return;
  var H = E.helpers;
  var has = H.has, isObj = H.isObj, clone = H.clone, cmpStr = H.cmpStr, bad = H.bad, stampAfter = H.stampAfter;

  // The app's core (browser: loaded by assistant.js; node: required).
  var CORES = {
    timesheet: ["orosTimesheetCore", "../timesheet/core.js"], invoices: ["OrosInvoicesCore", "../invoices/core.js"],
    chores: ["OrosChoresCore", "../chores/core.js"], meals: ["OrosMealsCore", "../meals/core.js"],
    garage: ["OrosGarageCore", "../garage/core.js"], petcare: ["OrosPetcareCore", "../petcare/core.js"],
    library: ["LibCore", "../library/core.js"]
  };
  function core(app) {
    var c = CORES[app];
    if (root[c[0]]) return root[c[0]];
    if (NODE) { try { var m = require(c[1]); return m[c[0]] || m; } catch (e) { return null; } }
    return null;
  }
  // d becomes nd, in place (apply() hands d back as the new data).
  function adopt(d, nd) {
    Object.keys(d).forEach(function (k) { delete d[k]; });
    Object.keys(nd).forEach(function (k) { d[k] = nd[k]; });
  }
  function byId(list, id) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (isObj(list[i]) && list[i].id === id) return { x: list[i], i: i };
    return null;
  }
  function tooLong(what, v, max, app) {
    return typeof v === "string" && v.length > max ? bad(what + " is " + v.length + " characters; " + app + " keeps " + max + ".") : null;
  }
  function only(ch, keys, what) {
    var no = Object.keys(ch.set).filter(function (k) { return keys.indexOf(k) < 0; });
    return no.length ? bad(what + " has no " + no.join(", ") + " here (it takes " + keys.join(", ") + ").") : null;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hmOf(ts) { var t = new Date(ts); return pad(t.getHours()) + ":" + pad(t.getMinutes()); }
  function dayOf(ts) { var t = new Date(ts); return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()); }
  function localTs(ymd, hm) { var p = ymd.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], +hm.slice(0, 2), +hm.slice(3, 5)).getTime(); }
  function money(c, cur) { var s = String(Math.abs(c)); while (s.length < 3) s = "0" + s; return (c < 0 ? "-" : "") + s.slice(0, -2) + "." + s.slice(-2) + (cur ? " " + cur : ""); }
  function preview(s, n) { s = String(s || ""); return s.length > n ? "…" + s.slice(s.length - n) : s; }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function nothing(what) { return bad("Nothing would change: the " + what + " already looks like that."); }
  function pickNames(list, names, appName, where) {
    var out = [], miss = [];
    names.forEach(function (n) {
      var f = H.foldName(n), hit = null;
      list.forEach(function (l) { if (!hit && H.foldName(l.name) === f) hit = l; });
      if (!hit) miss.push(n); else if (out.indexOf(hit.id) < 0) out.push(hit.id);
    });
    if (miss.length) return { err: appName + " has no label named \"" + miss.join("\", \"") + "\"" + (where ? " in " + where : "") + ". " +
      (list.length ? "Its labels: " + list.map(function (l) { return l.name; }).join(", ") + "." : "It has none.") + " New labels are made in " + appName + "." };
    return { ids: out };
  }
  // Whole-record rows (m): undo puts the row back as it was, with a
  // newer stamp, only while it is still exactly what was written.
  function recUndo(listOf, norm) {
    return function (d, u, now) {
      var list = listOf(d, u), h = byId(list, u.next.id);
      if (!h || !same(h.x, u.next)) return bad("It changed since; nothing was undone.");
      var x = clone(u.prev);
      x.m = stampAfter(now, h.x.m);
      list[h.i] = x;
      if (norm) adopt(d, norm(d, now));
      return { ok: true };
    };
  }

  // ---------- 1. Notes (notes/notes.js NO-3: two clocks per page) ----------
  // A page: mtime (life), ct (title / text), st (pin, place, labels),
  // h = content stamps it descends from. A text change is a content
  // edit (the old ct goes into h, ct = mtime = now), a label change a
  // structure edit (st = mtime = now). Pages sorted by mtime, then id.
  var NT_KEYS = ["id", "nb", "parent", "title", "text", "mtime", "pos", "labels", "pinned", "ct", "st", "h", "hx", "cf"];
  var NT_TITLE = 200, NT_TEXT = 100000, NT_H = 60;
  function ntOld(p) { return typeof p.ct === "number" && typeof p.st === "number" && (p.mtime || 0) > Math.max(p.ct, p.st); }
  function ntCs(p) { return typeof p.ct !== "number" || ntOld(p) ? p.mtime || 0 : p.ct; }
  function ntSs(p) { return typeof p.st !== "number" || ntOld(p) ? p.mtime || 0 : p.st; }
  function ntCanon(p) {
    var o = {};
    NT_KEYS.forEach(function (k) { if (p[k] !== undefined) o[k] = p[k]; });
    Object.keys(p).sort().forEach(function (k) { if (o[k] === undefined && p[k] !== undefined) o[k] = p[k]; });
    return o;
  }
  function ntSort(d) {
    d.pages.sort(function (x, y) { return ((x.mtime || 0) - (y.mtime || 0)) || cmpStr(x.id, y.id); });
  }
  function ntFind(d, target) {
    if (!isObj(d) || !Array.isArray(d.pages) || !isObj(target) || typeof target.page !== "string") return null;
    var h = byId(d.pages, target.page), tombs = isObj(d.tombs) ? d.tombs : {};
    if (!h || (typeof tombs[h.x.id] === "number" && tombs[h.x.id] >= (h.x.mtime || 0))) return null;
    return h;
  }
  function ntLabels(d, nb) {
    var tombs = isObj(d.tombs) ? d.tombs : {};
    return (Array.isArray(d.labels) ? d.labels : []).filter(function (l) {
      return isObj(l) && l.nb === nb && typeof l.name === "string" && !(typeof tombs["lbl:" + l.id] === "number" && tombs["lbl:" + l.id] >= (l.mtime || 0));
    });
  }
  function ntView(d, p) {
    var names = ntLabels(d, p.nb).filter(function (l) { return (p.labels || []).indexOf(l.id) >= 0; }).map(function (l) { return l.name; }).sort();
    return { title: String(p.title || ""), labels: names.join(", "), text: preview(p.text, 400) };
  }
  function ntSet(p, title, text, labels, now) {
    var t = stampAfter(now, p.mtime);
    if (title !== null || text !== null) {
      var cs = ntCs(p), ss = ntSs(p);
      if (ntOld(p)) { delete p.h; delete p.hx; }
      var h = Array.isArray(p.h) ? p.h.slice() : [];
      if (h.indexOf(cs) < 0) h.push(cs);
      if (h.length > NT_H) { h = h.slice(h.length - NT_H); p.hx = 1; }
      p.h = h;
      p.st = ss;
      if (title !== null) p.title = title;
      if (text !== null) p.text = text;
      p.ct = t;
      if (p.cf) delete p.cf;
    } else p.ct = ntCs(p);
    if (labels !== null) { p.labels = labels.slice().sort(); p.st = t; }
    else if (title === null && text === null) p.st = ntSs(p);
    p.mtime = t;
    p.pinned = !!p.pinned;
  }
  function notesChange(d, target, ch, now) {
    var h = ntFind(d, target);
    if (!h) return bad("That page is no longer in Notes.");
    var e = only(ch, ["title", "text", "text_add", "label", "labels"], "A Notes page");
    if (e) return e;
    var s = ch.set, p = clone(h.x), before = ntView(d, h.x);
    var title = null, text = null, labels = null;
    if (has(s, "title")) { if ((e = tooLong("title", s.title, NT_TITLE, "a Notes title"))) return e; title = s.title; }
    if (has(s, "text")) text = s.text;
    if (has(s, "text_add")) {
      var cur = String(p.text || "");
      text = cur ? cur.replace(/\s+$/, "") + "\n\n" + s.text_add : s.text_add;
    }
    if (text !== null && (e = tooLong("The page's text", text, NT_TEXT, "a Notes page"))) return e;
    if (has(s, "labels") || has(s, "label")) {
      var list = ntLabels(d, p.nb), nbName = "";
      (Array.isArray(d.notebooks) ? d.notebooks : []).forEach(function (n) { if (isObj(n) && n.id === p.nb) nbName = n.name; });
      if (has(s, "label") && s.label === "") labels = [];
      else {
        var r = pickNames(list, has(s, "labels") ? s.labels : [s.label], "Notes", nbName ? "the notebook " + nbName : "");
        if (r.err) return bad(r.err);
        labels = has(s, "labels") ? r.ids : (p.labels || []).filter(function (id) { return r.ids.indexOf(id) < 0; }).concat(r.ids);
      }
    }
    if (title !== null && title === p.title) title = null;
    if (text !== null && text === (p.text || "")) text = null;
    if (labels !== null && same(labels.slice().sort(), (p.labels || []).slice().sort())) labels = null;
    if (title === null && text === null && labels === null) return nothing("page");
    ntSet(p, title, text, labels, now);
    d.pages[h.i] = ntCanon(p);
    ntSort(d);
    return { ok: true, title: before.title, before: before, after: ntView(d, p), del: false,
             undo: { t: "set", app: "notes", prev: clone(h.x), next: clone(d.pages.filter(function (x) { return x.id === p.id; })[0]) } };
  }
  function notesUndo(d, u, now) {
    var h = ntFind(d, { page: u.next.id });
    if (!h || !same(h.x, u.next)) return bad("The page changed since; nothing was undone.");
    var p = clone(h.x), prev = u.prev;
    var tChange = prev.title !== p.title || (prev.text || "") !== (p.text || "");
    var lChange = !same((prev.labels || []).slice().sort(), (p.labels || []).slice().sort());
    ntSet(p, tChange ? prev.title : null, tChange ? prev.text || "" : null, lChange ? prev.labels || [] : null, now);
    d.pages[h.i] = ntCanon(p);
    ntSort(d);
    return { ok: true };
  }

  // ---------- 2. Timesheet (timesheet/core.js) ----------
  // An entry { id, p, desc, s, e, billed, task?, tags?, m }: s / e are
  // instants (e = 0 while it runs), shown in local time. LWW on m.
  function tsLive(d, id) {
    var h = byId(d.entries, id);
    return h && !h.x.del ? h : null;
  }
  function tsView(x) {
    return { title: String(x.desc || ""), date: dayOf(x.s), start: hmOf(x.s), end: x.e ? hmOf(x.e) : "" };
  }
  function timesheetChange(d, target, ch, now) {
    var C = core("timesheet");
    if (!C) return bad("Timesheet is not available.");
    if (!isObj(target) || typeof target.entry !== "string") return bad("Only a Timesheet entry (a time worked) can be changed here.");
    var h = isObj(d) ? tsLive(d, target.entry) : null;
    if (!h) return bad("That entry is no longer in Timesheet.");
    var e = only(ch, ["title", "date", "start", "end"], "A Timesheet entry");
    if (e) return e;
    var s = ch.set, x = clone(h.x), before = tsView(h.x);
    if (has(s, "title")) { if ((e = tooLong("title", s.title, C.LIM.desc, "a Timesheet entry"))) return e; x.desc = s.title; }
    if (!x.e && (has(s, "date") || has(s, "end"))) return bad("That entry is still running: stop it in Timesheet first, then change its day or end.");
    var day = has(s, "date") ? s.date : dayOf(x.s);
    var start = has(s, "start") ? s.start : hmOf(x.s);
    var dur = x.e ? x.e - x.s : 0;
    x.s = localTs(day, start);
    if (x.e) {
      if (has(s, "end")) {
        x.e = localTs(day, s.end);
        if (x.e <= x.s) return bad("end must be after start (an entry past midnight is changed in Timesheet).");
      } else x.e = x.s + dur;
    }
    if (x.s > now && (has(s, "date") || has(s, "start"))) return bad("An entry can't start in the future.");
    var after = tsView(x);
    if (same(after, before)) return nothing("entry");
    x.m = stampAfter(now, h.x.m);
    d.entries[h.i] = x;
    adopt(d, C.mergeTimesheet(d, d));
    return { ok: true, title: before.title || before.date, before: before, after: after, del: false,
             undo: { t: "set", app: "timesheet", prev: clone(h.x), next: clone(byId(d.entries, x.id).x) } };
  }
  var timesheetUndo = recUndo(function (d) { return d.entries; }, function (d) { return core("timesheet").mergeTimesheet(d, d); });

  // ---------- 3. Invoices: a payment (invoices/core.js) ----------
  // "Paid" = a payment row { id, doc, date, amt, how, note, m } as the
  // app's Payment dialog adds it; totals and status are never stored.
  // Only an issued invoice, receipt or recorded invoice that still owes.
  function invView(C, d, doc) {
    var cur = doc.cur || "EUR";
    return { status: "inv:" + C.status(d, doc, ""), paid: money(C.paidOf(d, doc.id), cur), owed: money(Math.max(0, C.balance(d, doc)), cur) };
  }
  function invoicesChange(d, target, ch, now) {
    var C = core("invoices");
    if (!C) return bad("Invoices is not available.");
    if (!isObj(target) || typeof target.invoice !== "string") return bad("Only an invoice can be marked paid here.");
    var doc = isObj(d) && Array.isArray(d.docs) ? C.doc(d, target.invoice) : null;
    if (!doc) return bad("That invoice is no longer in Invoices.");
    if (ch.action !== "complete") return bad("An invoice can only be marked paid here (complete); everything else is done in Invoices.");
    if (!C.owes(doc)) return bad(doc.st === "draft" ? "That invoice is a draft: issue it in Invoices first." : "That document owes nothing (a proforma, a credit note or a void one).");
    var bal = C.balance(d, doc);
    if (bal <= 0) return bad("That invoice is already paid.");
    var s = ch.set, amt = has(s, "amount") ? s.amount : bal;
    if (amt > bal) return bad("amount " + money(amt) + " is more than what is owed (" + money(bal) + ").");
    var day = has(s, "date") ? s.date : H.localDay(now);
    if (day > H.localDay(now)) return bad("A payment can't be dated in the future.");
    var before = invView(C, d, doc), title = (doc.num || "") + (doc.c && doc.c.name ? " · " + doc.c.name : "");
    if (!Array.isArray(d.pays)) d.pays = [];
    var p = { id: C.newId(), doc: doc.id, date: day, amt: amt, how: s.how || "other", note: "", m: stampAfter(now, 0) };
    d.pays.push(p);
    adopt(d, C.normalize(d));
    var after = invView(C, d, C.doc(d, doc.id));
    after.paid += " (" + day + ")";
    return { ok: true, title: title || doc.id, before: before, after: after, del: false,
             undo: { t: "set", app: "invoices", prev: {}, next: clone(byId(d.pays, p.id).x) } };
  }
  function invoicesUndo(d, u, now) {
    var C = core("invoices"), h = byId(d.pays, u.next.id);
    if (!h || !same(h.x, u.next)) return bad("That payment changed since; nothing was undone.");
    d.pays[h.i] = { id: h.x.id, m: stampAfter(now, h.x.m), del: 1 };
    adopt(d, C.normalize(d));
    return { ok: true };
  }

  // ---------- 4. Chore Wheel (chores/core.js) ----------
  // Done = done["<task>|<day>"] = [1, member, m] for the occurrence of
  // today (or one still late, within the app's 7 days), by the member
  // the wheel gives it to, as ticking the row in the app does.
  function chFind(d, target) {
    if (!isObj(d) || !Array.isArray(d.tasks) || !isObj(target) || typeof target.task !== "string") return null;
    var h = byId(d.tasks, target.task), tombs = isObj(d.tombs) ? d.tombs : {};
    return h && !(typeof tombs[h.x.id] === "number" && tombs[h.x.id] >= h.x.m) ? h : null;
  }
  // Today's occurrence; without one, the last one while it is still
  // late (the app shows it for 7 days).
  function chOcc(C, d, task, n) {
    var o = C.occAt(task, n);
    if (o && o.a <= n) return o;
    var p = C.prevOcc(task, n);
    return p && p.b < n && p.b >= n - 7 ? p : null;
  }
  function choresChange(d, target, ch, now) {
    var C = core("chores");
    if (!C) return bad("Chore Wheel is not available.");
    var h = chFind(d, target);
    if (!h) return bad("That chore is no longer on the wheel.");
    if (!isObj(d.done)) d.done = {};
    if (!isObj(d.set)) d.set = {};
    var task = h.x, e;
    if (ch.action === "update") {
      if ((e = only(ch, ["title"], "A chore"))) return e;
      if ((e = tooLong("title", ch.set.title, C.TASK_LEN, "a chore's name"))) return e;
      if (ch.set.title === task.name) return nothing("chore");
      var x = clone(task);
      x.name = ch.set.title;
      x.m = stampAfter(now, Math.max(task.m, isObj(d.tombs) && typeof d.tombs[x.id] === "number" ? d.tombs[x.id] : 0));
      d.tasks[h.i] = x;
      adopt(d, C.mergeChores(d, d, now));
      return { ok: true, title: task.name, before: { title: task.name }, after: { title: x.name }, del: false,
               undo: { t: "set", app: "chores", kind: "task", prev: clone(task), next: clone(byId(d.tasks, x.id).x) } };
    }
    var n = C.localDn(new Date(now));
    var o = chOcc(C, d, task, n);
    if (!o) return bad("\"" + task.name + "\" is not due today.");
    var ctx = C.makeCtx(d), prev = d.done[o.key] || null, state = prev ? prev[0] : 0;
    var nameOf = function (id) { var mb = C.memberById(d, id); return mb ? mb.name : ""; };
    var before = { done: state === 1, by: state === 1 ? nameOf(prev[1]) : "", date: C.dnToYmd(o.a) };
    var val;
    if (ch.action === "complete") {
      if (state === 1) return bad("\"" + task.name + "\" is already done.");
      var by = C.assignee(ctx, task, o);
      if (!by) return bad("Nobody has \"" + task.name + "\" yet (spin the wheel in Chore Wheel first).");
      val = [1, by, Math.max(now, prev ? prev[2] + 1 : 0)];
    } else {
      if (state !== 1) return bad("\"" + task.name + "\" is not done.");
      val = [0, "", Math.max(now, prev[2] + 1)];
    }
    d.done[o.key] = val;
    adopt(d, C.mergeChores(d, d, now));
    var after = { done: val[0] === 1, by: val[0] === 1 ? nameOf(val[1]) : "", date: before.date };
    return { ok: true, title: task.name + (before.date !== C.dnToYmd(n) ? " (" + before.date + ")" : ""), before: before, after: after, del: false,
             undo: { t: "set", app: "chores", kind: "done", key: o.key, prev: prev ? { v: prev } : {}, next: { v: d.done[o.key] } } };
  }
  function choresUndo(d, u, now) {
    var C = core("chores");
    if (u.kind === "task") return recUndo(function (dd) { return dd.tasks; }, function (dd) { return C.mergeChores(dd, dd, now); })(d, u, now);
    var cur = isObj(d.done) ? d.done[u.key] : null;
    if (!cur || !same(cur, u.next.v)) return bad("It changed since; nothing was undone.");
    var p = u.prev.v || [0, "", 0];
    d.done[u.key] = [p[0], p[1], Math.max(now, cur[2] + 1)];
    adopt(d, C.mergeChores(d, d, now));
    return { ok: true };
  }

  // ---------- 5. Meal Planner: a recipe (meals/core.js) ----------
  function mlView(r) { return { title: r.t, servings: String(r.sv), note: r.no || "" }; }
  function mealsChange(d, target, ch, now) {
    var C = core("meals");
    if (!C) return bad("Meal Planner is not available.");
    if (!isObj(target) || typeof target.recipe !== "string") return bad("Only a recipe can be changed here (the week's plan is changed in Meal Planner).");
    var h = isObj(d) ? byId(d.rc, target.recipe) : null, tombs = isObj(d && d.tombs) ? d.tombs : {};
    if (!h || (typeof tombs[h.x.id] === "number" && tombs[h.x.id] >= h.x.m)) return bad("That recipe is no longer in Meal Planner.");
    var e = only(ch, ["title", "note", "servings"], "A recipe");
    if (e) return e;
    var s = ch.set, x = clone(h.x), before = mlView(h.x);
    if (has(s, "title")) { if ((e = tooLong("title", s.title, C.LIM.title, "a recipe's title"))) return e; x.t = s.title; }
    if (has(s, "note")) { if ((e = tooLong("note", s.note, C.LIM.notes, "a recipe's notes"))) return e; x.no = s.note; }
    if (has(s, "servings")) {
      if (s.servings < 1 || s.servings > C.LIM.servings) return bad("servings must be 1-" + C.LIM.servings + ".");
      x.sv = s.servings;
    }
    var after = mlView(x);
    if (same(after, before)) return nothing("recipe");
    x.m = stampAfter(now, Math.max(h.x.m, tombs[h.x.id] || 0));
    d.rc[h.i] = x;
    adopt(d, C.mergeMeals(d, d));
    return { ok: true, title: before.title, before: before, after: after, del: false,
             undo: { t: "set", app: "meals", prev: clone(h.x), next: clone(byId(d.rc, x.id).x) } };
  }
  var mealsUndo = recUndo(function (d) { return d.rc; }, function (d) { return core("meals").mergeMeals(d, d); });

  // ---------- 6. Travel (travel/travel.js: one stamp per field) ----------
  // A trip's head, a packing item or an itinerary entry: each changed
  // field gets f[field] = max(now, f[field] + 1), as setField does.
  var TV = { name: 80, notes: 20000, item: 80, inote: 300, title: 100, place: 150, pnote: 1000 };
  function tvLife(e) { var m = 0; Object.keys(e.f || {}).forEach(function (k) { if (e.f[k] > m) m = e.f[k]; }); return m; }
  function tvFind(d, target) {
    if (!isObj(d) || !Array.isArray(d.trips) || !isObj(target) || typeof target.trip !== "string") return null;
    var tombs = isObj(d.tombs) ? d.tombs : {}, t = byId(d.trips, target.trip);
    if (!t || (typeof tombs[t.x.id] === "number" && tombs[t.x.id] >= tvLife(t.x))) return null;
    if (!target.tab) return { trip: t.x, e: t.x, kind: "trip" };
    var list = target.tab === "pack" ? t.x.pack : target.tab === "plan" ? t.x.plan : null;
    var it = list && typeof target.item === "string" ? byId(list, target.item) : null;
    if (!it || (typeof tombs[it.x.id] === "number" && tombs[it.x.id] >= tvLife(it.x))) return null;
    return { trip: t.x, e: it.x, kind: target.tab };
  }
  function tvView(kind, e) {
    if (kind === "trip") return { title: e.name, date: e.start || "", end: e.end || "", note: preview(e.notes, 400) };
    if (kind === "pack") return { title: e.name, done: !!e.done, note: e.note || "" };
    return { title: e.title, date: e.day || "", start: e.t1 || "", end: e.t2 || "", location: e.place || "", note: e.note || "" };
  }
  function tvPut(e, k, v, now) {
    if (same(e[k], v)) return;
    e[k] = v;
    e.f[k] = Math.max(Math.floor(now), (e.f[k] || 0) + 1);
  }
  function travelChange(d, target, ch, now) {
    var h = tvFind(d, target);
    if (!h) return bad("That is no longer in Travel.");
    var e = h.e, before = tvView(h.kind, e), s = ch.set, err, a = ch.action;
    var prev = clone(e);
    if (h.kind === "trip") {
      if (a === "complete" || a === "reopen") return bad("A trip can't be ticked; tick its packing items.");
      if ((err = only(ch, ["title", "date", "end_date", "note"], "A trip"))) return err;
      if (has(s, "title") && (err = tooLong("title", s.title, TV.name, "a trip's name"))) return err;
      var st = has(s, "date") ? s.date : e.start, en = has(s, "end_date") ? s.end_date : e.end;
      if (st && en && en < st) return bad("The trip can't end before it starts.");
      if (has(s, "title")) tvPut(e, "name", s.title, now);
      if (has(s, "date")) tvPut(e, "start", s.date, now);
      if (has(s, "end_date")) tvPut(e, "end", s.end_date, now);
      if (has(s, "note") && (err = tooLong("note", s.note, TV.notes, "a trip's notes"))) return err;
      if (has(s, "note")) tvPut(e, "notes", s.note, now);
    } else if (h.kind === "pack") {
      if (a === "reschedule") return bad("A packing item has no date.");
      if (a === "complete" || a === "reopen") {
        if (!!e.done === (a === "complete")) return bad(a === "complete" ? "That is already packed." : "That is not packed.");
        tvPut(e, "done", a === "complete", now);
      } else {
        if ((err = only(ch, ["title", "note"], "A packing item"))) return err;
        if (has(s, "title") && (err = tooLong("title", s.title, TV.item, "a packing item"))) return err;
        if (has(s, "note") && (err = tooLong("note", s.note, TV.inote, "a packing item's note"))) return err;
        if (has(s, "title")) tvPut(e, "name", s.title, now);
        if (has(s, "note")) tvPut(e, "note", s.note, now);
      }
    } else {
      if (a === "complete" || a === "reopen") return bad("An itinerary entry can't be ticked.");
      if ((err = only(ch, ["title", "date", "start", "end", "location", "note"], "An itinerary entry"))) return err;
      if (has(s, "title") && (err = tooLong("title", s.title, TV.title, "an itinerary entry"))) return err;
      if (has(s, "location") && (err = tooLong("location", s.location, TV.place, "a place"))) return err;
      if (has(s, "note") && (err = tooLong("note", s.note, TV.pnote, "an itinerary note"))) return err;
      if (has(s, "title")) tvPut(e, "title", s.title, now);
      if (has(s, "date")) tvPut(e, "day", s.date, now);
      if (has(s, "start")) tvPut(e, "t1", s.start, now);
      if (has(s, "end")) tvPut(e, "t2", s.end, now);
      if (has(s, "location")) tvPut(e, "place", s.location, now);
      if (has(s, "note")) tvPut(e, "note", s.note, now);
    }
    var after = tvView(h.kind, e);
    if (same(after, before)) return nothing("item");
    return { ok: true, title: before.title, before: before, after: after, del: false,
             undo: { t: "set", app: "travel", target: clone(target), prev: prev, next: clone(e) } };
  }
  function travelUndo(d, u, now) {
    var h = tvFind(d, u.target);
    if (!h || !same(h.e, u.next)) return bad("It changed since; nothing was undone.");
    Object.keys(u.prev.f || {}).forEach(function (k) { if (!same(h.e[k], u.prev[k])) tvPut(h.e, k, clone(u.prev[k]), now); });
    return { ok: true };
  }

  // ---------- 7. Split: an expense (split/split.js) ----------
  // Whole-record LWW on m; ids "<group>.<own>", tombstones "exp:<id>".
  // The amount changes only for an expense split equally that one
  // person paid in the group's currency (anything else in Split).
  var SP = { title: 60, note: 140 };
  function spView(d, x) {
    var g = byId(d.groups, x.id.split(".")[0]);
    return { title: x.t || "", amount: money(x.a, g ? g.x.cur : ""), date: x.d, note: x.n || "" };
  }
  function splitChange(d, target, ch, now) {
    if (!isObj(target) || typeof target.exp !== "string") return bad("Only an expense can be changed here.");
    var h = isObj(d) ? byId(d.exp, target.exp) : null, tombs = isObj(d && d.tombs) ? d.tombs : {};
    if (!h || (typeof tombs["exp:" + h.x.id] === "number" && tombs["exp:" + h.x.id] >= h.x.m)) return bad("That expense is no longer in Split.");
    var e = only(ch, ["title", "amount", "date", "note"], "An expense");
    if (e) return e;
    var s = ch.set, x = clone(h.x), before = spView(d, h.x);
    if (has(s, "title")) { if ((e = tooLong("title", s.title, SP.title, "an expense's title"))) return e; x.t = s.title; }
    if (has(s, "note")) { if ((e = tooLong("note", s.note, SP.note, "an expense's note"))) return e; x.n = s.note.replace(/\s*\n\s*/g, " "); }
    if (has(s, "date")) x.d = s.date;
    if (has(s, "amount") && s.amount !== x.a) {
      var payers = Object.keys(x.by || {});
      if (x.mode !== "eq" || x.fx || x.it || payers.length !== 1) return bad("This expense is split in another way (or paid by several, or in another currency): change its amount in Split.");
      x.a = s.amount;
      x.by[payers[0]] = s.amount;
    }
    var after = spView(d, x);
    if (same(after, before)) return nothing("expense");
    x.m = stampAfter(now, Math.max(h.x.m, tombs["exp:" + x.id] || 0));
    d.exp[h.i] = x;
    return { ok: true, title: before.title, before: before, after: after, del: false,
             undo: { t: "set", app: "split", prev: clone(h.x), next: clone(x) } };
  }
  var splitUndo = recUndo(function (d) { return d.exp; }, null);

  // ---------- 8. Garage: a vehicle (garage/core.js) ----------
  // Name and notes on the vehicle row; the odometer as a new reading
  // (an odo row of today), as the app's "Odometer" entry adds it.
  function gaView(C, d, v) {
    var km = C.currentKm(d, v.id);
    return { title: v.name, km: km ? String(km) : "", note: v.notes || "" };
  }
  function garageChange(d, target, ch, now) {
    var C = core("garage");
    if (!C) return bad("Garage is not available.");
    var h = isObj(d) && typeof target === "string" ? byId(d.vehicles, target) : null, tombs = isObj(d && d.tombs) ? d.tombs : {};
    if (!h || (typeof tombs[h.x.id] === "number" && tombs[h.x.id] >= h.x.m)) return bad("Only a vehicle can be changed here (its name, notes or odometer); that one is not a vehicle in Garage.");
    var e = only(ch, ["title", "note", "km"], "A vehicle");
    if (e) return e;
    var s = ch.set, v = clone(h.x), before = gaView(C, d, h.x), odo = null;
    if (has(s, "title")) { if ((e = tooLong("title", s.title, C.NAME_LEN, "a vehicle's name"))) return e; v.name = s.title; }
    if (has(s, "note")) { if ((e = tooLong("note", s.note, C.NOTES_LEN, "a vehicle's notes"))) return e; v.notes = s.note; }
    if (has(s, "km")) {
      var cur = C.currentKm(d, v.id) || 0;
      if (s.km > C.KM_MAX) return bad("km is out of range.");
      if (s.km < cur) return bad("The odometer already shows " + cur + " km; a lower reading is entered in Garage (a new odometer).");
      if (s.km > cur) {
        if (!Array.isArray(d.odo)) d.odo = [];
        var id = "";
        while (!id || byId(d.odo, id) || tombs[id]) id = Math.floor(now).toString(36) + Math.random().toString(36).slice(2, 8);
        odo = { id: id, m: stampAfter(now, 0), v: v.id, d: H.localDay(now), km: s.km };
        d.odo.push(odo);
      }
    }
    if (!same(v, h.x)) { v.m = stampAfter(now, Math.max(h.x.m, tombs[v.id] || 0)); d.vehicles[h.i] = v; }
    adopt(d, C.merge(d, d, now));
    var after = gaView(C, d, byId(d.vehicles, v.id).x);
    if (same(after, before)) return nothing("vehicle");
    return { ok: true, title: before.title, before: before, after: after, del: false,
             undo: { t: "set", app: "garage", prev: clone(h.x), next: clone(byId(d.vehicles, v.id).x), odo: odo ? clone(byId(d.odo, odo.id).x) : null } };
  }
  function garageUndo(d, u, now) {
    var C = core("garage"), h = byId(d.vehicles, u.next.id);
    if (!h || !same(h.x, u.next)) return bad("The vehicle changed since; nothing was undone.");
    var o = u.odo ? byId(d.odo, u.odo.id) : null;
    if (u.odo && (!o || !same(o.x, u.odo))) return bad("That reading changed since; nothing was undone.");
    if (!same(u.prev, u.next)) { var v = clone(u.prev); v.m = stampAfter(now, h.x.m); d.vehicles[h.i] = v; }
    if (o) {
      if (!isObj(d.tombs)) d.tombs = {};
      d.tombs[o.x.id] = stampAfter(now, o.x.m);
    }
    adopt(d, C.merge(d, d, now));
    return { ok: true };
  }

  // ---------- 9. Pet care: a health record (petcare/core.js) ----------
  var PC_NX = ["vacc", "deworm", "visit"];
  function pcView(r) { return { title: r.n || r.k, date: r.d, next: r.nx || "", note: r.nt || "" }; }
  function petcareChange(d, target, ch, now) {
    var C = core("petcare");
    if (!C) return bad("Pet care is not available.");
    if (!isObj(target) || typeof target.rec !== "string") return bad("Only a health record can be changed here (a pet's details are changed in Pet care).");
    var h = isObj(d) ? byId(d.recs, target.rec) : null, tombs = isObj(d && d.tombs) ? d.tombs : {};
    if (!h || (typeof tombs[h.x.id] === "number" && tombs[h.x.id] >= h.x.m)) return bad("That record is no longer in Pet care.");
    var e = only(ch, ["date", "next", "note"], "A health record");
    if (e) return e;
    var s = ch.set, r = clone(h.x), before = pcView(h.x);
    if (has(s, "note")) { if ((e = tooLong("note", s.note, 500, "a record's notes"))) return e; r.nt = s.note; }
    if (has(s, "date")) r.d = s.date;
    if (has(s, "next")) {
      if (PC_NX.indexOf(r.k) < 0) return bad("This kind of record has no next date.");
      r.nx = s.next;
    }
    if (r.nx && r.nx <= r.d) return bad("The next date must be after the record's day (" + r.d + ").");
    var after = pcView(r);
    if (same(after, before)) return nothing("record");
    r.m = stampAfter(now, Math.max(h.x.m, tombs[r.id] || 0));
    d.recs[h.i] = r;
    adopt(d, C.merge(d, d, now));
    return { ok: true, title: before.title, before: before, after: after, del: false,
             undo: { t: "set", app: "petcare", prev: clone(h.x), next: clone(byId(d.recs, r.id).x) } };
  }
  var petcareUndo = recUndo(function (d) { return d.recs; }, function (d, now) { return core("petcare").merge(d, d, now); });

  // ---------- 10. Workouts: a finished workout (fitness/fitness.js) ----------
  // Whole-record LWW on m, tombstones "wo:<id>".
  var FT = { title: 60, note: 1000 };
  function ftView(w) { return { title: w.ti || "", date: w.d, note: w.n || "" }; }
  function fitnessChange(d, target, ch, now) {
    var h = isObj(d) && typeof target === "string" ? byId(d.wo, target) : null, tombs = isObj(d && d.tombs) ? d.tombs : {};
    if (!h || (typeof tombs["wo:" + h.x.id] === "number" && tombs["wo:" + h.x.id] >= h.x.m)) return bad("Only a workout can be changed here; that one is no longer in Workouts.");
    var e = only(ch, ["title", "note"], "A workout");
    if (e) return e;
    var s = ch.set, w = clone(h.x), before = ftView(h.x);
    if (has(s, "title")) { if ((e = tooLong("title", s.title, FT.title, "a workout's name"))) return e; w.ti = s.title; }
    if (has(s, "note")) { if ((e = tooLong("note", s.note, FT.note, "a workout's notes"))) return e; w.n = s.note; }
    var after = ftView(w);
    if (same(after, before)) return nothing("workout");
    w.m = stampAfter(now, Math.max(h.x.m, tombs["wo:" + w.id] || 0));
    d.wo[h.i] = w;
    return { ok: true, title: before.title || before.date, before: before, after: after, del: false,
             undo: { t: "set", app: "fitness", prev: clone(h.x), next: clone(w) } };
  }
  var fitnessUndo = recUndo(function (d) { return d.wo; }, null);

  // ---------- 11. Library: a book (library/core.js) ----------
  // Finished = fin (the day), as "Mark as finished" sets it; title,
  // author (by) and tags. Whole-record LWW on m.
  function lbView(b) { return { title: b.title, author: b.by || "", labels: (b.tags || []).join(", "), done: !!b.fin }; }
  function libraryChange(d, target, ch, now) {
    var C = core("library");
    if (!C) return bad("Library is not available.");
    if (!isObj(target) || typeof target.book !== "string") return bad("Only a book can be changed here.");
    var h = isObj(d) ? byId(d.books, target.book) : null, tombs = isObj(d && d.tombs) ? d.tombs : {};
    if (!h || (typeof tombs[h.x.id] === "number" && tombs[h.x.id] >= h.x.m)) return bad("That book is no longer in Library.");
    var b = clone(h.x), before = lbView(h.x), s = ch.set, e;
    if (ch.action === "complete") { if (b.fin) return bad("That book is already marked finished."); b.fin = H.localDay(now); }
    else if (ch.action === "reopen") { if (!b.fin) return bad("That book is not marked finished."); delete b.fin; }
    else {
      if ((e = only(ch, ["title", "author", "label", "labels"], "A book"))) return e;
      if (has(s, "title")) { if ((e = tooLong("title", s.title, 200, "a book's title"))) return e; b.title = s.title; }
      if (has(s, "author")) { if ((e = tooLong("author", s.author, 120, "an author's name"))) return e; if (s.author) b.by = s.author; else delete b.by; }
      if (has(s, "labels") || has(s, "label")) {
        var tags = has(s, "labels") ? s.labels : s.label === "" ? [] : (b.tags || []).concat([s.label]);
        var out = [];
        for (var i = 0; i < tags.length; i++) {
          if ((e = tooLong("tag", tags[i], 30, "a tag"))) return e;
          if (out.every(function (x) { return H.foldName(x) !== H.foldName(tags[i]); })) out.push(tags[i]);
        }
        if (out.length > 10) return bad("A book keeps 10 tags.");
        if (out.length) b.tags = out; else delete b.tags;
      }
    }
    b.m = stampAfter(now, Math.max(h.x.m, tombs[b.id] || 0));
    d.books[h.i] = b;
    adopt(d, C.mergeLibrary(d, d));
    var nb = byId(d.books, b.id).x, after = lbView(nb);
    if (same(after, before)) return nothing("book");
    return { ok: true, title: before.title, before: before, after: after, del: false,
             undo: { t: "set", app: "library", prev: clone(h.x), next: clone(nb) } };
  }
  var libraryUndo = recUndo(function (d) { return d.books; }, function (d) { return core("library").mergeLibrary(d, d); });

  var MODS = {
    notes:     { settable: { title: 1, text: 1, text_add: 1, label: 1, labels: 1 }, change: notesChange, undo: notesUndo },
    timesheet: { settable: { title: 1, date: 1, start: 1, end: 1 }, change: timesheetChange, undo: timesheetUndo },
    invoices:  { settable: { amount: 1, date: 1, how: 1 }, change: invoicesChange, undo: invoicesUndo },
    chores:    { settable: { title: 1 }, change: choresChange, undo: choresUndo },
    meals:     { settable: { title: 1, note: 1, servings: 1 }, change: mealsChange, undo: mealsUndo },
    travel:    { settable: { title: 1, date: 1, end_date: 1, start: 1, end: 1, location: 1, note: 1 }, change: travelChange, undo: travelUndo },
    split:     { settable: { title: 1, amount: 1, date: 1, note: 1 }, change: splitChange, undo: splitUndo },
    garage:    { settable: { title: 1, note: 1, km: 1 }, change: garageChange, undo: garageUndo },
    petcare:   { settable: { date: 1, next: 1, note: 1 }, change: petcareChange, undo: petcareUndo },
    fitness:   { settable: { title: 1, note: 1 }, change: fitnessChange, undo: fitnessUndo },
    library:   { settable: { title: 1, author: 1, label: 1, labels: 1 }, change: libraryChange, undo: libraryUndo }
  };
  E.extend(MODS);
  var api = { MODS: MODS };
  if (NODE) module.exports = api;
  else root.OrosAssistEdits2 = api;
})(typeof window !== "undefined" ? window : this);
