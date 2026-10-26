// ============================================================
// orOS Assistant — new items in more apps (AS-ADD5, wave A4)
// ------------------------------------------------------------
// create_items for Timesheet (time entries), Meal Planner (recipes),
// Travel (itinerary entries and packing items of a trip) and Sticky
// Notes, registered into assistant/additems.js (extend), whose card,
// ticks, look-alikes and Undo stay the same. assistant.js loads this
// file (and the app's own core) the first time one of these apps gets
// new items. Pure: no DOM, no storage; Sticky Notes are written by
// the shell's own host (stickies/host.js is their only writer).
//
// Every new record is written as the app writes it, in the app's
// canonical form, so opening the app rewrites nothing:
//   timesheet  addEntry { id, p, desc, s, e, billed: 0, task?, tags?, m }
//              through mergeTimesheet (lists sorted by id)
//   meals      putRecipe: normRecipe, ingredients read by the app's
//              own parseIngLine, through mergeMeals
//   travel     newEntry / newItem: every field with its own stamp f,
//              a plan entry at the end of its day (nextPos), lists
//              sorted by id, old tombstones pruned as mergeTravel does
//   stickies   StickiesCore.create (+ setRing for a reminder)
// A text longer than the app keeps is refused, never cut. Undo takes
// back only what the card made, while each record is unchanged.
// i18n-inline-ok: none (no UI text here)
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var A = root.OrosAssistAdd || (NODE ? require("./additems.js") : null);
  if (!A || typeof A.extend !== "function") return;
  var H = A.helpers;
  var has = H.has, isObj = H.isObj, clone = H.clone, one = H.one, cmpStr = H.cmpStr, bad = H.bad, stampAfter = H.stampAfter;
  var fold = H.fold, text1 = H.text1, textN = H.textN, dateOf = H.dateOf, names = H.names, pick = H.pick, preview = H.preview;

  var CORES = {
    timesheet: ["orosTimesheetCore", "../timesheet/core.js"], meals: ["OrosMealsCore", "../meals/core.js"],
    stickies: ["StickiesCore", "../stickies/core.js"]
  };
  function core(app) {
    var c = CORES[app];
    if (root[c[0]]) return root[c[0]];
    if (NODE) { try { var m = require(c[1]); return m[c[0]] || m; } catch (e) { return null; } }
    return null;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function localTs(ymd, hm) { var p = ymd.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], +hm.slice(0, 2), +hm.slice(3, 5)).getTime(); }
  function hmOf(ts) { var t = new Date(ts); return pad(t.getHours()) + ":" + pad(t.getMinutes()); }
  function dayOf(ts) { var t = new Date(ts); return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()); }
  function hmArg(x, k, w) {
    if (!has(x, k) || x[k] === null || x[k] === undefined || x[k] === "") return { v: "" };
    var v = H.hm(String(x[k]));
    return v ? { v: v } : { err: w + k + " must be a time as HH:MM (24h)." };
  }
  function intArg(x, k, lo, hi, w) {
    if (!has(x, k) || x[k] === null || x[k] === undefined || x[k] === "") return { v: null };
    var n = typeof x[k] === "number" ? x[k] : /^\s*\d+\s*$/.test(String(x[k])) ? +x[k] : NaN;
    if (!isFinite(n) || Math.floor(n) !== n || n < lo || n > hi) return { err: w + k + " must be a whole number from " + lo + " to " + hi + "." };
    return { v: n };
  }
  function notOpened(name) {
    return bad(name + " has not been opened on this device yet, so there is nowhere to add to. Ask the user to open " + name + " once, then try again.");
  }
  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (isObj(list[i]) && list[i].id === id) return list[i];
    return null;
  }
  // A list (of the item's lines) the app keeps up to maxN lines of maxLen.
  function lines(x, k, maxN, maxLen, w, what) {
    if (!has(x, k) || x[k] === null || x[k] === undefined) return { v: [] };
    var a = Array.isArray(x[k]) ? x[k] : String(x[k]).split(/\n+/), out = [];
    for (var i = 0; i < a.length; i++) {
      if (typeof a[i] !== "string") return { err: w + k + "[" + i + "] must be text." };
      var s = one(a[i]);
      if (!s) continue;
      if (s.length > maxLen) return { err: w + k + "[" + i + "] has " + s.length + " characters; " + what + " keeps " + maxLen + ". Make it shorter or split it." };
      out.push(s);
    }
    if (out.length > maxN) return { err: w + k + " has " + out.length + " lines; " + what + " keeps " + maxN + "." };
    return { v: out };
  }

  // ---------- 1. Timesheet: time worked ----------
  // timesheet.js addEntry; start and end in local time (as the
  // dialog), or start and minutes. A running timer is started in the
  // app, never here.
  var TS_MAX_MIN = 24 * 60;
  function normTs(x, w) {
    var C = core("timesheet");
    if (!C) return { err: "Timesheet is not available." };
    var r = text1(x, "title", C.LIM.desc, w, "a Timesheet entry");
    if (r.err) return r;
    var o = { desc: r.v };
    r = dateOf(x, "date", w);
    if (r.err) return r;
    if (!r.v) return { err: w + "date is required (YYYY-MM-DD)." };
    o.date = r.v;
    r = hmArg(x, "start", w);
    if (r.err) return r;
    if (!r.v) return { err: w + "start is required (HH:MM)." };
    o.start = r.v;
    r = hmArg(x, "end", w);
    if (r.err) return r;
    var mins = intArg(x, "minutes", 1, TS_MAX_MIN, w);
    if (mins.err) return mins;
    if (!r.v && mins.v === null) return { err: w + "end (HH:MM) or minutes is required." };
    o.s = localTs(o.date, o.start);
    if (r.v) {
      o.e = localTs(o.date, r.v);
      if (o.e <= o.s) return { err: w + "end must be after start; for time past midnight give minutes instead." };
      if (mins.v !== null && mins.v !== Math.round((o.e - o.s) / 60000)) return { err: w + "end and minutes don't agree; give one of them." };
    } else o.e = o.s + mins.v * 60000;
    r = text1(x, "project", C.LIM.name, w, "a project's name");
    if (r.err) return r;
    o.project = r.v;
    r = text1(x, "task", C.LIM.task, w, "a task");
    if (r.err) return r;
    o.task = r.v;
    r = names(x, "labels", C.LIM.tags, C.LIM.tag, w, "a Timesheet entry's tags");
    if (r.err) return r;
    o.tags = C.normTags ? C.normTags(r.v) : r.v;
    if (!o.desc && !o.project) return { err: w + "give a title (what was done) or a project." };
    return { o: o, key: fold(o.project) + "|" + o.s + "|" + o.e };
  }
  function tsResolve(d, items) {
    var projects = (Array.isArray(d.projects) ? d.projects : []).filter(function (p) { return isObj(p) && !p.del && typeof p.name === "string"; });
    var list = projects.map(function (p) { return { id: p.id, names: [p.name], p: p }; }), out = [];
    for (var i = 0; i < items.length; i++) {
      var o = items[i], p = null;
      if (o.project) {
        var hit = pick(list, o.project);
        if (!hit) return { err: "items[" + i + "]: " + H.missing("Timesheet", "project", list.filter(function (l) { return !l.p.arch; }), [o.project], "Projects") };
        if (hit.p.arch) return { err: "items[" + i + "]: the project " + hit.p.name + " is archived; bring it back in Timesheet first." };
        p = hit.p;
      }
      var pid = p ? p.id : "", dup = null;
      d.entries.forEach(function (x) {
        if (!dup && isObj(x) && !x.del && x.p === pid && x.s === o.s && x.e === o.e) dup = { id: x.id, title: x.desc || (p ? p.name : ""), target: { entry: x.id } };
      });
      out.push({ p: p, dup: dup });
    }
    return { res: out };
  }
  // Nothing stored yet (the app saves only on a change): its empty data.
  function tsBase(d) { var C = core("timesheet"); return d == null && C ? C.empty() : d; }
  function tsPlan(d, items) {
    d = tsBase(d);
    if (!isObj(d) || !Array.isArray(d.entries) || !Array.isArray(d.projects)) return notOpened("Timesheet");
    var r = tsResolve(d, items);
    if (r.err) return bad(r.err);
    return { ok: true, rows: items.map(function (o, i) {
      var x = r.res[i], f = [["date", dayOf(o.s)], ["start", hmOf(o.s)], ["end", (dayOf(o.e) !== dayOf(o.s) ? dayOf(o.e) + " " : "") + hmOf(o.e)],
                               ["minutes", String(Math.round((o.e - o.s) / 60000))]];
      if (x.p) f.push(["project", x.p.name]);
      if (o.task) f.push(["task", o.task]);
      if (o.tags.length) f.push(["labels", o.tags.join(", ")]);
      return { title: o.desc || x.p.name, fields: f, dup: x.dup };
    }) };
  }
  function tsApply(d, items, now, skip) {
    d = tsBase(d);
    var C = core("timesheet"), r = tsResolve(d, items);
    if (r.err) return bad(r.err);
    var made = [], undo = { app: "timesheet", t: "new", items: [] }, s = stampAfter(now, 0), ids = [];
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var id;
      do { id = C.newId(); } while (byId(d.entries, id) || ids.indexOf(id) >= 0);
      ids.push(id);
      var x = { id: id, p: r.res[i].p ? r.res[i].p.id : "", desc: o.desc, s: o.s, e: o.e, billed: 0, m: s };
      if (o.task) x.task = o.task;
      if (o.tags.length) x.tags = o.tags.slice();
      d.entries.push(x);
      made.push({ i: i, id: id, title: o.desc || r.res[i].p.name, target: { entry: id } });
    });
    d = C.mergeTimesheet(d, d);
    ids.forEach(function (id) { undo.items.push({ id: id, x: clone(byId(d.entries, id)) }); });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function tsUndo(d, u, now) {
    var C = core("timesheet");
    if (!C || !isObj(d) || !Array.isArray(d.entries)) return bad("Timesheet has no entries.");
    for (var i = 0; i < u.items.length; i++) {
      var x = byId(d.entries, u.items[i].id);
      if (x && JSON.stringify(x) !== JSON.stringify(u.items[i].x)) return bad("A new entry was changed since; nothing was undone.");
    }
    u.items.forEach(function (it) {
      var x = byId(d.entries, it.id);
      if (x) d.entries[d.entries.indexOf(x)] = { id: x.id, m: stampAfter(now, x.m), del: 1 };
    });
    return { ok: true, data: C.mergeTimesheet(d, d) };
  }

  // ---------- 2. Meal Planner: a recipe ----------
  // meals.js putRecipe: normRecipe; the ingredient lines are read by
  // the app's own parser ("200 g flour, sifted").
  function normRecipe(x, w) {
    var C = core("meals");
    if (!C) return { err: "Meal Planner is not available." };
    var L = C.LIM;
    var r = text1(x, "title", L.title, w, "a recipe's title");
    if (r.err) return r;
    if (!r.v) return { err: w + "title is required." };
    var o = { t: r.v };
    var sv = intArg(x, "servings", 1, L.servings, w);
    if (sv.err) return sv;
    o.sv = sv.v === null ? 4 : sv.v;
    var pt = intArg(x, "prep_minutes", 0, L.minutes, w);
    if (pt.err) return pt;
    var ct = intArg(x, "cook_minutes", 0, L.minutes, w);
    if (ct.err) return ct;
    o.pt = pt.v || 0;
    o.ct = ct.v || 0;
    r = lines(x, "ingredients", L.ings, 300, w, "a recipe");
    if (r.err) return r;
    o.ig = [];
    for (var i = 0; i < r.v.length; i++) {
      var ig = C.parseIngLine(r.v[i], "");
      if (!ig || !ig.n) return { err: w + "ingredients[" + i + "] has no ingredient in it." };
      // The parser caps the name and the note: at the cap, it may have
      // cut, so the line is refused instead.
      if (ig.n.length >= L.ingName) return { err: w + "ingredients[" + i + "]: the ingredient's name must be under " + L.ingName + " characters (put details after a comma)." };
      if (ig.x && ig.x.length >= L.ingNote) return { err: w + "ingredients[" + i + "]: the note after the comma must be under " + L.ingNote + " characters." };
      o.ig.push(ig);
    }
    r = lines(x, "steps", L.steps, L.step, w, "a recipe");
    if (r.err) return r;
    o.st = r.v;
    r = textN(x, "note", L.notes, w, "a recipe's notes");
    if (r.err) return r;
    o.no = r.v;
    r = names(x, "labels", L.tags, L.tag, w, "a recipe's tags");
    if (r.err) return r;
    o.tg = r.v;
    r = text1(x, "url", L.src, w, "a recipe's source");
    if (r.err) return r;
    o.src = r.v;
    return { o: o, key: fold(o.t) };
  }
  function mlBase(d) { var C = core("meals"); return d == null && C ? C.mergeMeals(C.emptyData(), null) : d; }
  function mlPlan(d, items, ctx) {
    var C = core("meals");
    d = mlBase(d);
    if (!isObj(d) || !Array.isArray(d.rc) || !isObj(d.tombs)) return notOpened("Meal Planner");
    if (d.rc.length + items.length > C.LIM.recipes) return bad("Meal Planner keeps " + C.LIM.recipes + " recipes and has " + d.rc.length + "; add fewer.");
    var all = C.allRecipes(d, ctx && ctx.lang === "el" ? "el" : "en");
    return { ok: true, rows: items.map(function (o) {
      var dup = null;
      all.forEach(function (r) { if (!dup && fold(r.t) === fold(o.t)) dup = { id: r.id, title: r.t, target: { recipe: r.id } }; });
      var f = [["servings", String(o.sv)]];
      if (o.pt || o.ct) f.push(["minutes", String(o.pt + o.ct)]);
      if (o.ig.length) f.push(["ingredients", o.ig.map(function (g) { return C.ingToLine ? C.ingToLine(g) : g.n; }).join(" · ")]);
      if (o.st.length) f.push(["steps", String(o.st.length)]);
      if (o.no) f.push(["note", preview(o.no, 200)]);
      return { title: o.t, fields: f, dup: dup };
    }) };
  }
  function mlApply(d, items, now, skip) {
    d = mlBase(d);
    var C = core("meals"), made = [], undo = { app: "meals", t: "new", items: [] }, s = stampAfter(now, 0), ids = [];
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var id;
      do { id = "r" + Math.floor(now).toString(36) + Math.random().toString(36).slice(2, 8); } while (byId(d.rc, id) || has(d.tombs, id) || ids.indexOf(id) >= 0);
      ids.push(id);
      var x = C.normRecipe({ id: id, m: s, t: o.t, e: "", c: "", sv: o.sv, pt: o.pt, ct: o.ct, dt: [], tg: o.tg, ig: o.ig, st: o.st,
                             no: o.no, src: o.src, fv: 0 });
      d.rc.push(x);
      made.push({ i: i, id: id, title: x.t, target: { recipe: id } });
    });
    d = C.mergeMeals(d, d);
    ids.forEach(function (id) { undo.items.push({ id: id, x: clone(byId(d.rc, id)) }); });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function mlUndo(d, u, now) {
    var C = core("meals");
    if (!C || !isObj(d) || !Array.isArray(d.rc)) return bad("Meal Planner has no recipes.");
    for (var i = 0; i < u.items.length; i++) {
      var x = byId(d.rc, u.items[i].id);
      if (x && JSON.stringify(x) !== JSON.stringify(u.items[i].x)) return bad("A new recipe was changed since; nothing was undone.");
    }
    if (!isObj(d.tombs)) d.tombs = {};
    u.items.forEach(function (it) {
      var x = byId(d.rc, it.id);
      if (!x) return;
      d.rc.splice(d.rc.indexOf(x), 1);
      d.tombs[it.id] = Math.max(d.tombs[it.id] || 0, stampAfter(now, x.m));
    });
    return { ok: true, data: C.mergeMeals(d, d) };
  }

  // ---------- 3. Travel: itinerary entries and packing items ----------
  // travel.js newEntry / newItem (every field stamped), on a trip the
  // model found (its ref). Kept in step with travel.js NORM / LEN.
  var TV = { title: 100, place: 150, pnote: 1000, item: 80, inote: 300, person: 30, plan: 300, pack: 500, qty: 99 };
  var TV_KINDS = ["flight", "train", "bus", "ferry", "car", "rental", "stay", "ticket", "activity", "food", "other"];
  var TV_GROUPS = ["clothes", "toilet", "health", "tech", "docs", "baby", "gear", "food", "misc", "before"];
  var TV_SEEDS = ["tpl-basic", "tpl-before", "tpl-beach", "tpl-city", "tpl-business", "tpl-hiking", "tpl-ski", "tpl-baby", "tpl-carryon", "tpl-road"];
  var TV_TOMB_TTL = 180 * 86400000;
  var PLAN_F = ["kind", "title", "day", "t1", "day2", "t2", "place", "from", "to", "ref", "note", "pos",
                "num", "prov", "cost", "ccur", "geo", "geo0"];
  var PACK_F = ["name", "qty", "rule", "grp", "who", "note", "done"];
  function tvLife(e) { var m = 0; Object.keys(e.f || {}).forEach(function (k) { if (e.f[k] > m) m = e.f[k]; }); return m; }
  function tvTrip(d, id) {
    if (!isObj(d) || !Array.isArray(d.trips)) return null;
    var t = byId(d.trips, id), tombs = isObj(d.tombs) ? d.tombs : {};
    return t && !(typeof tombs[id] === "number" && tombs[id] >= tvLife(t)) ? t : null;
  }
  // mergeTravel's pruning: tombstones older than the newest stamp in
  // the data by 180 days go (a hidden ready template's stays).
  function tvPrune(d) {
    var newest = 0;
    function seen(s) { if (typeof s === "number" && s > newest) newest = s; }
    (d.trips || []).forEach(function (t) {
      seen(tvLife(t));
      ["pack", "plan", "docs", "spend", "jrnl"].forEach(function (k) { (t[k] || []).forEach(function (e) { seen(tvLife(e)); }); });
    });
    (d.tpls || []).forEach(function (t) { if (isObj(t)) seen(t.m); });
    var tombs = isObj(d.tombs) ? d.tombs : {}, out = {};
    Object.keys(tombs).forEach(function (id) { seen(tombs[id]); });
    Object.keys(tombs).sort(cmpStr).forEach(function (id) {
      if (tombs[id] < newest - TV_TOMB_TTL && TV_SEEDS.indexOf(id) < 0) return;
      out[id] = tombs[id];
    });
    d.tombs = out;
  }
  function tvId(d, now, taken) {
    for (;;) {
      var id = Math.floor(now).toString(36) + Math.random().toString(36).slice(2, 9);
      if (!taken[id] && !has(d.tombs || {}, id)) { taken[id] = 1; return id; }
    }
  }
  function normTvPlan(x, w) {
    var r = text1(x, "title", TV.title, w, "an itinerary entry");
    if (r.err) return r;
    if (!r.v) return { err: w + "title is required." };
    var o = { title: r.v, trip: one(String(x.trip || "")) };
    if (!o.trip) return { err: w + "trip is required: the trip's ref from search_data." };
    o.kind = has(x, "type") && x.type ? String(x.type) : "activity";
    if (TV_KINDS.indexOf(o.kind) < 0) return { err: w + "type must be one of " + TV_KINDS.join(", ") + "." };
    r = dateOf(x, "date", w);
    if (r.err) return r;
    o.day = r.v;
    r = hmArg(x, "start", w);
    if (r.err) return r;
    o.t1 = r.v;
    r = dateOf(x, "end_date", w);
    if (r.err) return r;
    o.day2 = r.v;
    r = hmArg(x, "end", w);
    if (r.err) return r;
    o.t2 = r.v;
    if (o.day2 && (!o.day || o.day2 < o.day)) return { err: w + "end_date must be on or after date." };
    r = text1(x, "location", TV.place, w, "a place");
    if (r.err) return r;
    o.place = r.v;
    r = textN(x, "note", TV.pnote, w, "an itinerary entry's note");
    if (r.err) return r;
    o.note = r.v;
    return { o: o, key: o.trip + "|" + o.day + "|" + o.t1 + "|" + fold(o.title) };
  }
  function normTvPack(x, w) {
    var r = text1(x, "title", TV.item, w, "a packing item");
    if (r.err) return r;
    if (!r.v) return { err: w + "title is required." };
    var o = { name: r.v, trip: one(String(x.trip || "")) };
    if (!o.trip) return { err: w + "trip is required: the trip's ref from search_data." };
    var q = intArg(x, "qty", 1, TV.qty, w);
    if (q.err) return q;
    o.qty = q.v || 1;
    o.grp = "@misc";
    if (has(x, "group") && x.group) {
      if (TV_GROUPS.indexOf(String(x.group)) < 0) return { err: w + "group must be one of " + TV_GROUPS.join(", ") + "." };
      o.grp = "@" + x.group;
    }
    r = text1(x, "who", TV.person, w, "a traveller's name");
    if (r.err) return r;
    o.who = r.v;
    r = text1(x, "note", TV.inote, w, "a packing item's note");
    if (r.err) return r;
    o.note = r.v;
    return { o: o, key: o.trip + "|" + fold(o.name) };
  }
  function tvPlanOf(kind) {
    return function (d, items) {
      if (!isObj(d) || !Array.isArray(d.trips)) return notOpened("Travel");
      var n = {};
      for (var i = 0; i < items.length; i++) {
        var t = tvTrip(d, items[i].tripId);
        if (!t) return bad("items[" + i + "]: that trip is no longer in Travel.");
        n[t.id] = (n[t.id] || 0) + 1;
        var max = kind === "plan" ? TV.plan : TV.pack, have = (t[kind] || []).length;
        if (have + n[t.id] > max) return bad("The trip " + t.name + " keeps " + max + (kind === "plan" ? " itinerary entries" : " packing items") + " and has " + have + "; add fewer.");
      }
      return { ok: true, rows: items.map(function (o) {
        var t = tvTrip(d, o.tripId), dup = null, f = [["trip", t.name]];
        (t[kind] || []).forEach(function (e) {
          if (dup) return;
          if (kind === "plan" ? (e.day === o.day && e.t1 === o.t1 && fold(e.title) === fold(o.title)) : fold(e.name) === fold(o.name)) {
            dup = { id: e.id, title: kind === "plan" ? e.title : e.name, target: { trip: t.id, tab: kind, item: e.id } };
          }
        });
        if (kind === "plan") {
          f.push(["kind", o.kind]);
          if (o.day) f.push(["date", o.day + (o.day2 && o.day2 !== o.day ? " – " + o.day2 : "")]);
          if (o.t1) f.push(["start", o.t1]);
          if (o.t2) f.push(["end", o.t2]);
          if (o.place) f.push(["location", o.place]);
        } else {
          if (o.qty > 1) f.push(["qty", String(o.qty)]);
          f.push(["group", o.grp.slice(1) || o.grp]);
          if (o.who) f.push(["who", o.who]);
        }
        if (o.note) f.push(["note", preview(o.note, 200)]);
        return { title: kind === "plan" ? o.title : o.name, fields: f, dup: dup };
      }) };
    };
  }
  function tvApplyOf(kind) {
    return function (d, items, now, skip) {
      var made = [], undo = { app: kind === "plan" ? "travel_plan" : "travel_pack", t: "new", items: [] }, s = stampAfter(now, 0), taken = {};
      if (!isObj(d.tombs)) d.tombs = {};
      d.trips.forEach(function (t) { taken[t.id] = 1; ["pack", "plan", "docs", "spend", "jrnl"].forEach(function (k) { (t[k] || []).forEach(function (e) { taken[e.id] = 1; }); }); });
      items.forEach(function (o, i) {
        if (skip && skip[i]) return;
        var t = tvTrip(d, o.tripId), e = { id: tvId(d, now, taken) }, f = {}, vals;
        if (kind === "plan") {
          var pos = -1;
          t.plan.forEach(function (p) { if (p.day === o.day && p.pos > pos) pos = p.pos; });
          vals = { kind: o.kind, title: o.title, day: o.day, t1: o.t1, day2: o.day2, t2: o.t2, place: o.place, from: "", to: "", ref: "",
                   note: o.note, pos: pos + 1, num: "", prov: "", cost: 0, ccur: "", geo: null, geo0: null };
        } else vals = { name: o.name, qty: o.qty, rule: null, grp: o.grp, who: o.who, note: o.note, done: false };
        (kind === "plan" ? PLAN_F : PACK_F).forEach(function (k) { e[k] = vals[k]; f[k] = s; });
        e.f = f;
        t[kind].push(e);
        t[kind].sort(function (a, b) { return cmpStr(a.id, b.id); });
        made.push({ i: i, id: e.id, title: kind === "plan" ? e.title : e.name, target: { trip: t.id, tab: kind, item: e.id } });
        undo.items.push({ trip: t.id, id: e.id, x: clone(e) });
      });
      tvPrune(d);
      return { ok: true, data: d, made: made, undo: undo };
    };
  }
  function tvUndoOf(kind) {
    return function (d, u, now) {
      if (!isObj(d) || !Array.isArray(d.trips)) return bad("Travel has no trips.");
      var hits = [];
      for (var i = 0; i < u.items.length; i++) {
        var t = tvTrip(d, u.items[i].trip), e = t ? byId(t[kind] || [], u.items[i].id) : null;
        if (e && JSON.stringify(e) !== JSON.stringify(u.items[i].x)) return bad("A new item was changed since; nothing was undone.");
        if (e) hits.push({ t: t, e: e });
      }
      if (!isObj(d.tombs)) d.tombs = {};
      hits.forEach(function (h) {
        h.t[kind].splice(h.t[kind].indexOf(h.e), 1);
        d.tombs[h.e.id] = Math.max(d.tombs[h.e.id] || 0, stampAfter(now, tvLife(h.e)));
      });
      tvPrune(d);
      return { ok: true, data: d };
    };
  }

  // ---------- 4. Sticky Notes ----------
  // StickiesCore.create (text, colour) and setRing (a reminder at a
  // day and time); the shell's host writes them (addFromFile).
  function normSticky(x, w) {
    var C = core("stickies");
    if (!C) return { err: "Sticky Notes is not available." };
    if (typeof x.text !== "string" || !x.text.trim()) return { err: w + "text is required." };
    var t = C.cleanText(x.text + "");
    var n = Array.from(x.text.replace(/\r\n?/g, "\n").replace(/\s+$/, "")).length;
    if (n > C.MAX_LEN) return { err: w + "text has " + n + " characters; a sticky note keeps " + C.MAX_LEN + ". Make it shorter or split it." };
    var o = { text: t.replace(/^\s+/, ""), color: "" };
    if (has(x, "color") && x.color) {
      if (C.COLORS.indexOf(String(x.color)) < 0) return { err: w + "color must be one of " + C.COLORS.join(", ") + "." };
      o.color = String(x.color);
    }
    var r = dateOf(x, "date", w);
    if (r.err) return r;
    var h = hmArg(x, "start", w);
    if (h.err) return h;
    if (h.v && !r.v) return { err: w + "a reminder needs date as well as start." };
    o.at = r.v ? localTs(r.v, h.v || "09:00") : 0;
    return { o: o, key: fold(o.text) };
  }
  function snPlan(d, items, ctx, now) {
    var C = core("stickies");
    if (!isObj(d) || !Array.isArray(d.notes)) return notOpened("Sticky Notes");
    var live = C.live(d).length;
    if (live + items.length > C.MAX_NOTES) return bad("Sticky Notes keeps " + C.MAX_NOTES + " notes on the desktop and has " + live + "; add fewer, or the user clears some first.");
    var t = now || Date.now();
    for (var i = 0; i < items.length; i++) if (items[i].at && items[i].at <= t) return bad("items[" + i + "]: the reminder is in the past.");
    return { ok: true, rows: items.map(function (o) {
      var dup = null, f = [];
      C.live(d).forEach(function (n) { if (!dup && fold(n.text) === fold(o.text)) dup = { id: n.id, title: C.firstLine(n.text), target: { note: n.id } }; });
      if (o.color) f.push(["color", o.color]);
      if (o.at) f.push(["reminder", dayOf(o.at) + " " + hmOf(o.at)]);
      f.push(["text", preview(o.text, 200)]);
      return { title: preview(o.text.split("\n")[0], 60), fields: f, dup: dup };
    }) };
  }
  function snApply(d, items, now, skip, ctx) {
    var C = core("stickies"), made = [], undo = { app: "stickies", t: "new", items: [] }, ids = [];
    var color = ctx && ctx.stickyColor && C.COLORS.indexOf(ctx.stickyColor) >= 0 ? ctx.stickyColor : C.COLORS[0];
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var r = C.create(d, { text: o.text, color: o.color || color }, now);
      if (r.full) return;
      d = r.data;
      if (o.at) d = C.setRing(d, r.id, o.at, now);
      ids.push(r.id);
      made.push({ i: i, id: r.id, title: preview(o.text.split("\n")[0], 60), target: { note: r.id } });
    });
    if (made.length < items.filter(function (o, i) { return !(skip && skip[i]); }).length) return bad("Sticky Notes is full (" + C.MAX_NOTES + " notes).");
    ids.forEach(function (id) { undo.items.push({ id: id, x: clone(C.find(d, id)) }); });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function snUndo(d, u, now) {
    var C = core("stickies");
    if (!C || !isObj(d) || !Array.isArray(d.notes)) return bad("Sticky Notes has no notes.");
    for (var i = 0; i < u.items.length; i++) {
      var n = C.find(d, u.items[i].id);
      if (n && JSON.stringify(n) !== JSON.stringify(u.items[i].x)) return bad("A new note was changed since; nothing was undone.");
    }
    u.items.forEach(function (it) { d = C.remove(d, it.id, now); });
    return { ok: true, data: d, ids: u.items.map(function (it) { return it.id; }) };
  }

  A.extend({
    timesheet: { key: "oros-timesheet-data", name: "Timesheet", norm: normTs, plan: tsPlan, apply: tsApply, undo: tsUndo },
    meals: { key: "oros-meals-data", name: "Meal Planner", norm: normRecipe, plan: mlPlan, apply: mlApply, undo: mlUndo },
    travel_plan: { key: "oros-travel-data", name: "Travel", norm: normTvPlan, plan: tvPlanOf("plan"), apply: tvApplyOf("plan"), undo: tvUndoOf("plan") },
    travel_pack: { key: "oros-travel-data", name: "Travel", norm: normTvPack, plan: tvPlanOf("pack"), apply: tvApplyOf("pack"), undo: tvUndoOf("pack") },
    stickies: { key: "oros-stickies-data", name: "Sticky Notes", norm: normSticky, plan: snPlan, apply: snApply, undo: snUndo }
  });
  var api = { CORES: CORES, TV_KINDS: TV_KINDS, TV_GROUPS: TV_GROUPS, tvPrune: tvPrune };
  if (NODE) module.exports = api;
  if (root && root.document) root.OrosAssistAdd2 = api;
})(typeof window !== "undefined" ? window : this);
