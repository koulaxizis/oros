// ============================================================
// orOS Assistant — new items in the everyday trackers (AS-ADD6, wave 4)
// ------------------------------------------------------------
// create_items for Habits (habits), Workouts (finished workouts),
// Garage (services and renewals of a vehicle), Plant Care (plants),
// Pet Health Book (health records of a pet), Media Shelf (titles)
// and Publishing (titles the user publishes, AS-ADD7), registered into assistant/additems.js (extend), whose card, ticks,
// look-alikes and Undo stay the same. assistant.js loads this file
// (and the app's own core) the first time one of these apps gets new
// items. Pure: no DOM, no storage.
//
// Every new record is written as the app's own form writes it, in
// the app's canonical form, so opening the app rewrites nothing:
//   habits   habits.js addHabit: model.js normHabit, then canon
//   fitness  fitness.js logDialog: one finished workout (normWo
//            field order), with one done set of an outdoor activity;
//            wo sorted by id
//   garage   garage.js service / renewal editors (upsert), then
//            OrosGarageCore.merge
//   plants   plants.js editor (a ready species fills its care values
//            as picking it in the form does), then OrosPlantsCore.merge
//   petcare  petcare.js addRec: normRec, then OrosPetcareCore.merge
//   shelf    shelf.js editDialog: normItem field order, the history
//            entry of the status (start / done / drop), items and
//            sessions sorted by id
//   publish  publish/app.js newTitleDialog (+ the release plan of its
//            tick), every row through OrosPublishCore.put / normalize
//   invoices invoices.js prefillNew + saveDraft: a new invoice DRAFT
//            (AS-ADD8), through OrosInvoicesCore.normDoc / normalize;
//            never issued
//   quote    quote.js applyQuotePrefill + commitSave: a new quote in
//            status draft (AS-ADD8), through OrosQuoteCore.canonState
// A vehicle or a pet is named (its name, or a plate); with only one,
// it may be left out. Only the user's own book, garage and garden are
// written (a household's shared copy is changed in the app). A text
// longer than the app keeps is refused, never cut. Undo takes back
// only what the card made, while each record is unchanged and nothing
// was logged on it since.
// i18n-inline-ok: none (no UI text here)
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var A = root.OrosAssistAdd || (NODE ? require("./additems.js") : null);
  if (!A || typeof A.extend !== "function") return;
  var H = A.helpers;
  var has = H.has, isObj = H.isObj, clone = H.clone, one = H.one, cmpStr = H.cmpStr, bad = H.bad, stampAfter = H.stampAfter;
  var fold = H.fold, text1 = H.text1, textN = H.textN, dateOf = H.dateOf, names = H.names, preview = H.preview;

  var CORES = {
    habits: ["OrosHabitsModel", "../habits/model.js"], plants: ["OrosPlantsCore", "../plants/core.js"],
    petcare: ["OrosPetcareCore", "../petcare/core.js"], garage: ["OrosGarageCore", "../garage/core.js"]
  };
  function core(app) {
    var c = CORES[app];
    if (root[c[0]]) return root[c[0]];
    if (NODE) { try { var m = require(c[1]); return m[c[0]] || m; } catch (e) { return null; } }
    return null;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayOf(ts) { var t = new Date(ts); return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()); }
  function localTs(ymd, hm) { var p = ymd.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], +hm.slice(0, 2), +hm.slice(3, 5)).getTime(); }
  function todayOf(ctx, now) { return ctx && typeof ctx.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ctx.today) ? ctx.today : dayOf(now || Date.now()); }
  function empty(x, k) { return !has(x, k) || x[k] === null || x[k] === undefined || x[k] === ""; }
  function hmArg(x, k, w) {
    if (empty(x, k)) return { v: "" };
    var v = H.hm(String(x[k]));
    return v ? { v: v } : { err: w + k + " must be a time as HH:MM (24h)." };
  }
  function intArg(x, k, lo, hi, w) {
    if (empty(x, k)) return { v: null };
    var n = typeof x[k] === "number" ? x[k] : /^\s*\d+\s*$/.test(String(x[k])) ? +x[k] : NaN;
    if (!isFinite(n) || Math.floor(n) !== n || n < lo || n > hi) return { err: w + k + " must be a whole number from " + lo + " to " + hi + "." };
    return { v: n };
  }
  function numArg(x, k, lo, hi, w) {
    if (empty(x, k)) return { v: null };
    var n = typeof x[k] === "number" ? x[k] : /^\s*\d+(?:[.,]\d+)?\s*$/.test(String(x[k])) ? +String(x[k]).replace(",", ".") : NaN;
    if (!isFinite(n) || n < lo || n > hi) return { err: w + k + " must be a number from " + lo + " to " + hi + "." };
    return { v: n };
  }
  function cents(x, k, max, w) {
    var r = numArg(x, k, 0, max / 100, w);
    if (r.err || r.v === null) return r;
    return { v: Math.round(r.v * 100) };
  }
  function word(x, k) { return empty(x, k) ? "" : fold(String(x[k])); }
  function notOpened(name) {
    return bad(name + " has not been opened on this device yet, so there is nowhere to add to. Ask the user to open " + name + " once, then try again.");
  }
  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (isObj(list[i]) && list[i].id === id) return list[i];
    return null;
  }
  function sortById(list) { list.sort(function (a, b) { return cmpStr(a.id, b.id); }); }
  function rnd(n) { var s = ""; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }
  // The apps' own newId shape: time, then random (base 36).
  function newIdIn(now, taken) {
    for (;;) {
      var id = Math.floor(now).toString(36) + rnd(8);
      if (!taken[id]) { taken[id] = 1; return id; }
    }
  }
  function takenOf(d, lists) {
    var taken = {};
    lists.forEach(function (k) { (Array.isArray(d[k]) ? d[k] : []).forEach(function (x) { if (isObj(x)) taken[x.id] = 1; }); });
    Object.keys(isObj(d.tombs) ? d.tombs : {}).forEach(function (k) { taken[k.replace(/^[a-z]+:/, "")] = 1; });
    return taken;
  }
  function unchanged(x, saved) { return !x || JSON.stringify(x) === JSON.stringify(saved); }
  function room(have, add, max, what, name) {
    return have + add > max ? bad(name + " keeps " + max + " " + what + " and has " + have + "; add fewer.") : null;
  }

  // ---------- 1. Habits ----------
  // habits.js addHabit through model.js normHabit. days are Monday-first
  // (0 = Monday … 6 = Sunday) as the app's chips; per_week / per_month
  // make an X-times habit (no days); target (+ unit, at_most) a number
  // habit with a daily amount; remind_at a daily reminder.
  var HB_MAX = 1000;
  function normHabit(x, w) {
    var M = core("habits");
    if (!M) return { err: "Habits is not available." };
    var r = text1(x, "title", 200, w, "a habit's name");
    if (r.err) return r;
    if (!r.v) return { err: w + "title (the habit's name) is required." };
    var o = { name: r.v, days: [], per: null, num: null, rem: -1 };
    if (!empty(x, "days")) {
      if (!Array.isArray(x.days)) return { err: w + "days must be a list of weekdays, 0 = Monday … 6 = Sunday." };
      for (var i = 0; i < x.days.length; i++) {
        var dd = x.days[i];
        if (typeof dd !== "number" || Math.floor(dd) !== dd || dd < 0 || dd > 6) return { err: w + "days must be weekdays from 0 (Monday) to 6 (Sunday)." };
        if (o.days.indexOf(dd) < 0) o.days.push(dd);
      }
      o.days.sort();
    }
    var pw = intArg(x, "per_week", 1, 7, w);
    if (pw.err) return pw;
    var pm = intArg(x, "per_month", 1, 31, w);
    if (pm.err) return pm;
    if (pw.v !== null && pm.v !== null) return { err: w + "give per_week or per_month, not both." };
    if ((pw.v !== null || pm.v !== null) && o.days.length) return { err: w + "give days or a number of times per week / month, not both." };
    if (pw.v !== null) o.per = ["w", pw.v];
    if (pm.v !== null) o.per = ["m", pm.v];
    var tg = numArg(x, "target", 0.01, 10000000, w);
    if (tg.err) return tg;
    r = text1(x, "unit", 16, w, "a habit's unit");
    if (r.err) return r;
    if (r.v && tg.v === null) return { err: w + "a unit needs a target (the daily amount)." };
    if (tg.v !== null) o.num = { u: r.v, t: Math.round(tg.v * 100) / 100 || 0.01, c: x.at_most === true ? "le" : "ge", s: 1 };
    r = hmArg(x, "remind_at", w);
    if (r.err) return r;
    if (r.v) o.rem = (+r.v.slice(0, 2)) * 60 + (+r.v.slice(3));
    return { o: o, key: fold(o.name) };
  }
  function hbBase(d) { return d == null ? { ver: 2, habits: [], comps: [] } : d; }
  // Weekday names in the user's language (2024-01-01 was a Monday).
  function wdName(n, lang) {
    try { return new Date(Date.UTC(2024, 0, 1 + n)).toLocaleDateString(lang || "en", { weekday: "short", timeZone: "UTC" }); } catch (e) { return String(n); }
  }
  function hbPlan(d, items, ctx) {
    d = hbBase(d);
    if (!isObj(d) || !Array.isArray(d.habits) || !Array.isArray(d.comps)) return notOpened("Habits");
    var live = d.habits.filter(function (h) { return isObj(h) && !h.del; });
    var e = room(d.habits.length, items.length, HB_MAX, "habits", "Habits");
    if (e) return e;
    return { ok: true, rows: items.map(function (o) {
      var dup = null, f = [];
      live.forEach(function (h) { if (!dup && fold(h.name) === fold(o.name)) dup = { id: h.id, title: h.name, target: { habit: h.id } }; });
      if (o.per) f.push([o.per[0] === "w" ? "perweek" : "permonth", String(o.per[1])]);
      else if (o.days.length) f.push(["days", o.days.map(function (n) { return wdName(n, ctx && ctx.lang); }).join(", ")]);
      if (o.num) f.push(["target", (o.num.c === "le" ? "≤ " : "") + o.num.t + (o.num.u ? " " + o.num.u : "")]);
      if (o.rem >= 0) f.push(["reminder", pad(Math.floor(o.rem / 60)) + ":" + pad(o.rem % 60)]);
      return { title: o.name, fields: f, dup: dup };
    }) };
  }
  function hbApply(d, items, now, skip) {
    var M = core("habits");
    d = hbBase(d);
    var made = [], undo = { app: "habits", t: "new", items: [] }, s = stampAfter(now, 0), taken = takenOf(d, ["habits"]);
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var raw = { id: newIdIn(now, taken), name: o.name, icon: "check", color: M.COLORS[0], days: o.per ? [] : o.days, mtime: s, del: false };
      if (o.num) raw.num = o.num;
      if (o.per) raw.per = o.per;
      if (o.rem >= 0) raw.rem = o.rem;
      var h = M.normHabit(raw);
      d.habits.push(h);
      made.push({ i: i, id: h.id, title: h.name, target: { habit: h.id } });
    });
    d = M.canon(d);
    made.forEach(function (m) { undo.items.push({ id: m.id, x: clone(byId(d.habits, m.id)) }); });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function hbUndo(d, u, now) {
    var M = core("habits");
    if (!M || !isObj(d) || !Array.isArray(d.habits) || !Array.isArray(d.comps)) return bad("Habits has no habits.");
    for (var i = 0; i < u.items.length; i++) {
      if (!unchanged(byId(d.habits, u.items[i].id), u.items[i].x)) return bad("A new habit was changed since; nothing was undone.");
      var id = u.items[i].id;
      if (d.comps.some(function (c) { return isObj(c) && c.habitId === id; })) return bad("A new habit was ticked since; nothing was undone (delete it in Habits).");
    }
    u.items.forEach(function (it) {
      var h = byId(d.habits, it.id);
      if (h) { h.del = true; h.mtime = stampAfter(now, h.mtime); }
    });
    return { ok: true, data: M.canon(d) };
  }

  // ---------- 2. Workouts: a finished workout ----------
  // fitness.js logDialog: title, date (not after today), start, minutes,
  // note, and with an outdoor activity one done set of it (time, and
  // distance). Kept in step with fitness.js NAME_LEN / NOTE_LEN / MAX_D.
  var FT = { name: 60, note: 1000, maxD: 1000000, done: 1 };
  var FT_ACT = { run: "x-run", walk: "x-walk", bike: "x-bike", swim: "x-swim", row: "x-rowerg" };
  function normWorkout(x, w, ctx) {
    var r = text1(x, "title", FT.name, w, "a workout's title");
    if (r.err) return r;
    var o = { ti: r.v, act: "" };
    if (!empty(x, "activity")) {
      o.act = String(x.activity);
      if (!has(FT_ACT, o.act)) return { err: w + "activity must be one of " + Object.keys(FT_ACT).join(", ") + " (leave it out for anything else, and say what it was in title)." };
    }
    if (!o.ti && !o.act) return { err: w + "give a title (what the workout was) or an activity." };
    r = dateOf(x, "date", w);
    if (r.err) return r;
    o.d = r.v || todayOf(ctx);
    if (o.d > todayOf(ctx)) return { err: w + "a workout is logged once done: date can't be after today." };
    var mins = intArg(x, "minutes", 1, 1440, w);
    if (mins.err) return mins;
    if (mins.v === null) return { err: w + "minutes (how long it took) is required." };
    o.mins = mins.v;
    r = hmArg(x, "start", w);
    if (r.err) return r;
    if (!r.v) return { err: w + "start (HH:MM, when it began) is required." };
    o.st = localTs(o.d, r.v);
    var km = numArg(x, "distance_km", 0.001, FT.maxD / 1000, w);
    if (km.err) return km;
    if (km.v !== null && !o.act) return { err: w + "a distance needs the activity (run, walk, bike, swim or row)." };
    o.dist = km.v === null ? 0 : Math.round(km.v * 1000);
    r = textN(x, "note", FT.note, w, "a workout's note");
    if (r.err) return r;
    o.n = r.v;
    // No title: the app names it (its "Workout", and the activity's own
    // name in the user's language), as the form leaves it.
    return { o: o, key: o.st + "|" + fold(o.ti || o.act) };
  }
  function ftBase(d) { return d == null ? { ver: 1, ex: [], pg: [], wo: [], bm: [], set: null, tombs: {} } : d; }
  function ftPlan(d, items) {
    d = ftBase(d);
    if (!isObj(d) || !Array.isArray(d.wo)) return notOpened("Workouts");
    return { ok: true, rows: items.map(function (o) {
      var t = new Date(o.st), dup = null, f = [["date", o.d], ["start", pad(t.getHours()) + ":" + pad(t.getMinutes())], ["minutes", String(o.mins)]];
      d.wo.forEach(function (x) {
        if (!dup && isObj(x) && x.d === o.d && Math.abs((x.st || 0) - o.st) < 30 * 60000) dup = { id: x.id, title: x.ti || o.ti || o.act, target: x.id };
      });
      if (o.act) f.push(["activity", o.act]);
      if (o.dist) f.push(["distance", String(o.dist / 1000)]);
      if (o.n) f.push(["note", preview(o.n, 200)]);
      return { title: o.ti || o.act, fields: f, dup: dup };
    }) };
  }
  function ftApply(d, items, now, skip) {
    d = ftBase(d);
    if (!isObj(d.tombs)) d.tombs = {};
    var made = [], undo = { app: "fitness", t: "new", items: [] }, s = stampAfter(now, 0), taken = takenOf(d, ["wo"]);
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var w = { id: newIdIn(now, taken), m: s, d: o.d, st: o.st, en: o.st + o.mins * 60000, ti: o.ti, p: "", pd: "", n: o.n, x: [] };
      if (o.act) w.x.push({ e: FT_ACT[o.act], tr: 0, tr2: 0, rest: 0, s: [[0, 0, o.mins * 60, o.dist, FT.done]] });
      d.wo.push(w);
      made.push({ i: i, id: w.id, title: w.ti || o.act, target: w.id });
      undo.items.push({ id: w.id, x: clone(w) });
    });
    sortById(d.wo);
    return { ok: true, data: d, made: made, undo: undo };
  }
  function ftUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.wo)) return bad("Workouts has no workouts.");
    for (var i = 0; i < u.items.length; i++) {
      if (!unchanged(byId(d.wo, u.items[i].id), u.items[i].x)) return bad("A new workout was changed since; nothing was undone.");
    }
    if (!isObj(d.tombs)) d.tombs = {};
    u.items.forEach(function (it) {
      var w = byId(d.wo, it.id);
      if (!w) return;
      d.wo.splice(d.wo.indexOf(w), 1);
      var k = "wo:" + it.id;
      d.tombs[k] = Math.max(stampAfter(now, w.m), d.tombs[k] || 0);
    });
    var sorted = {};
    Object.keys(d.tombs).sort(cmpStr).forEach(function (k) { sorted[k] = d.tombs[k]; });
    d.tombs = sorted;
    return { ok: true, data: d };
  }

  // ---------- shared: the vehicle or pet a record is for ----------
  // By name (or a vehicle's plate), folded; with only one, it may be
  // left out. Gone pets (passed away / rehomed) and retired vehicles
  // take no new records here.
  function ownerOf(list, q, what, appName, label) {
    if (!q) {
      if (list.length === 1) return { hit: list[0] };
      return { err: list.length ? appName + " has " + list.length + " " + what + "s: say which one (" + list.map(label).join(", ") + ")."
                                : appName + " has no " + what + " yet; one is added in " + appName + " first." };
    }
    var f = fold(q), bare = function (s) { return fold(s).replace(/[\s\-.·]/g, ""); };
    var hits = list.filter(function (v) { return fold(v.name) === f || (v.plate && bare(v.plate) === bare(q)); });
    if (hits.length === 1) return { hit: hits[0] };
    if (hits.length > 1) return { err: "More than one " + what + " is called " + q + "; tell them apart by " + (what === "vehicle" ? "plate" : "name") + " in " + appName + "." };
    return { err: appName + " has no " + what + " called \"" + q + "\". " + (list.length ? "Its " + what + "s: " + list.map(label).join(", ") + "." : "It has none.") };
  }

  // ---------- 3. Garage: a service or a renewal ----------
  // record service: a service done on date (not after today), its item
  // picked from the title by the app's own item names (EN / EL), else
  // "Other" with the title as the first line of the note; km, cost,
  // shop. record renewal: something that expires on date (MOT / KTEO,
  // insurance, road tax…), its kind picked from the title the same
  // way (else "Other", the title its label); cost; repeats as the
  // app's default for that kind; reminders at the app's default days.
  function gItem(C, title, ids, names) {
    var f = fold(title), exact = "", best = "", len = 0;
    ids.forEach(function (id) {
      [id].concat(names[id] || []).forEach(function (n) {
        var k = fold(n);
        if (!k) return;
        if (k === f) exact = exact || id;
        else if (k.length >= 4 && f.indexOf(k) >= 0 && k.length > len && id !== "other") { best = id; len = k.length; }
      });
    });
    return { exact: exact, best: best };
  }
  function normGarage(x, w, ctx) {
    var C = core("garage");
    if (!C) return { err: "Garage is not available." };
    var rec = empty(x, "record") ? "service" : String(x.record);
    if (rec !== "service" && rec !== "renewal") return { err: w + "record must be service or renewal for garage." };
    var r = text1(x, "vehicle", C.NAME_LEN, w, "a vehicle's name");
    if (r.err) return r;
    var o = { rec: rec, vq: r.v };
    r = text1(x, "title", 80, w, "a Garage title");
    if (r.err) return r;
    o.title = r.v;
    r = dateOf(x, "date", w);
    if (r.err) return r;
    o.d = r.v;
    var c = cents(x, "amount", C.C_MAX, w);
    if (c.err) return c;
    o.c = c.v || 0;
    r = textN(x, "note", C.NOTES_LEN, w, "a Garage note");
    if (r.err) return r;
    o.n = r.v;
    if (rec === "service") {
      if (!o.d) o.d = todayOf(ctx);
      if (o.d > todayOf(ctx)) return { err: w + "a service is logged once done: date can't be after today (a service to come is a renewal or a plan in Garage)." };
      if (!o.title) return { err: w + "title (what was done, e.g. Oil change) is required." };
      var m = gItem(C, o.title, C.ITEM_IDS, C.ITEM_NAMES);
      o.item = m.exact || m.best || "other";
      if (!m.exact) {
        o.n = o.title + (o.n ? "\n" + o.n : "");
        if (o.n.length > C.NOTES_LEN) return { err: w + "title and note together have " + o.n.length + " characters; a Garage note keeps " + C.NOTES_LEN + "." };
      }
      var km = intArg(x, "km", 0, C.KM_MAX, w);
      if (km.err) return km;
      o.km = km.v;
      r = text1(x, "shop", C.SHORT_LEN, w, "a garage's name");
      if (r.err) return r;
      o.shop = r.v;
    } else {
      if (!o.d) return { err: w + "date (the day it expires) is required for a renewal." };
      if (!o.title) return { err: w + "title (e.g. Insurance, Road tax, MOT) is required." };
      var k = gItem(C, o.title, C.RENEWAL_IDS, C.RENEWAL_NAMES);
      o.kind = k.exact || k.best || "other";
      o.label = "";
      if (k.exact !== o.kind) {
        if (o.title.length > C.SHORT_LEN) return { err: w + "title has " + o.title.length + " characters; a renewal's label keeps " + C.SHORT_LEN + "." };
        o.label = o.title;
      }
    }
    return { o: o, key: rec + "|" + fold(o.vq) + "|" + o.d + "|" + fold(o.title) };
  }
  function gVehicles(d) {
    var tombs = isObj(d.tombs) ? d.tombs : {};
    return (Array.isArray(d.vehicles) ? d.vehicles : []).filter(function (v) {
      return isObj(v) && !(typeof tombs[v.id] === "number" && tombs[v.id] >= v.m) && !v.sold;
    });
  }
  function gResolve(d, items) {
    var vs = gVehicles(d), out = [];
    var label = function (v) { return v.name + (v.plate ? " (" + v.plate + ")" : ""); };
    for (var i = 0; i < items.length; i++) {
      var r = ownerOf(vs, items[i].vq, "vehicle", "Garage", label);
      if (r.err) return { err: "items[" + i + "]: " + r.err };
      out.push(r.hit);
    }
    return { res: out };
  }
  function gPlan(d, items, ctx) {
    var C = core("garage");
    if (!isObj(d) || !Array.isArray(d.vehicles)) return notOpened("Garage");
    var r = gResolve(d, items);
    if (r.err) return bad(r.err);
    return { ok: true, rows: items.map(function (o, i) {
      var v = r.res[i], dup = null, f = [["vehicle", v.name], ["record", o.rec]], lang = ctx && ctx.lang;
      if (o.rec === "service") {
        (d.service || []).forEach(function (s) {
          if (!dup && isObj(s) && s.v === v.id && s.d === o.d && (s.items || []).indexOf(o.item) >= 0) dup = { id: s.id, title: o.title, target: v.id };
        });
        f.push(["date", o.d], ["kind", C.itemName(o.item, lang)]);
        if (o.km !== null) f.push(["km", String(o.km)]);
        if (o.shop) f.push(["shop", o.shop]);
      } else {
        (d.renewals || []).forEach(function (s) {
          if (!dup && isObj(s) && s.v === v.id && s.kind === o.kind && (o.kind !== "other" || fold(s.label) === fold(o.label))) dup = { id: s.id, title: o.title, target: s.id };
        });
        f.push(["due", o.d], ["kind", C.renewalName(o.kind, lang)]);
      }
      if (o.c) f.push(["cost", H.money(o.c)]);
      if (o.n) f.push(["note", preview(o.n, 200)]);
      return { title: o.title, fields: f, dup: dup };
    }) };
  }
  function gApply(d, items, now, skip) {
    var C = core("garage"), r = gResolve(d, items);
    if (r.err) return bad(r.err);
    var made = [], undo = { app: "garage", t: "new", items: [] }, s = stampAfter(now, 0);
    var taken = takenOf(d, ["vehicles"].concat(C.LIST_KEYS));
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var v = r.res[i], id = newIdIn(now, taken), row, list;
      if (o.rec === "service") {
        list = "service";
        row = { id: id, m: s, v: v.id, d: o.d, km: o.km, items: [o.item], c: o.c, shop: o.shop, n: o.n, bud: 0 };
      } else {
        list = "renewals";
        row = { id: id, m: s, v: v.id, kind: o.kind, exp: o.d, every: C.RENEWALS[o.kind].every, label: o.label, c: o.c,
                prov: "", ref: "", warn: C.WARN_DEFAULT.slice(), n: o.n };
      }
      if (!Array.isArray(d[list])) d[list] = [];
      d[list].push(row);
      made.push({ i: i, id: id, title: o.title, target: list === "service" ? v.id : id, list: list });
    });
    d = C.merge(d, d, now);
    made.forEach(function (m) { undo.items.push({ list: m.list, id: m.id, x: clone(byId(d[m.list], m.id)) }); delete m.list; });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function gUndo(d, u, now) {
    var C = core("garage");
    if (!C || !isObj(d) || !Array.isArray(d.vehicles)) return bad("Garage has no records.");
    for (var i = 0; i < u.items.length; i++) {
      var list = Array.isArray(d[u.items[i].list]) ? d[u.items[i].list] : [];
      if (!unchanged(byId(list, u.items[i].id), u.items[i].x)) return bad("A new record was changed since; nothing was undone.");
    }
    if (!isObj(d.tombs)) d.tombs = {};
    u.items.forEach(function (it) {
      var list = Array.isArray(d[it.list]) ? d[it.list] : [], x = byId(list, it.id);
      if (!x) return;
      list.splice(list.indexOf(x), 1);
      d.tombs[it.id] = Math.max(stampAfter(now, x.m), d.tombs[it.id] || 0);
    });
    return { ok: true, data: C.merge(d, d, now) };
  }

  // ---------- 4. Plant Care: a plant ----------
  // plants.js editor: a ready species (its name in English or Greek, or
  // its id) fills the icon, indoors / outdoors and the care intervals as
  // picking it in the form does; any other species is the scientific
  // name. water_days wins over the species' interval (default 7). The
  // schedule starts today, as the form's "last watered" default.
  function plPreset(C, q) {
    var f = fold(q), hit = "";
    C.PRESET_IDS.forEach(function (id) {
      if (hit) return;
      var p = C.PRESETS[id];
      if (fold(id) === f) { hit = id; return; }
      Object.keys(p).forEach(function (k) { if (!hit && Array.isArray(p[k]) && fold(p[k][0]) === f) hit = id; });
    });
    return hit;
  }
  function normPlant(x, w) {
    var C = core("plants");
    if (!C) return { err: "Plant Care is not available." };
    var r = text1(x, "title", C.NAME_LEN, w, "a plant's name");
    if (r.err) return r;
    var o = { name: r.v, sp: "", sci: "" };
    r = text1(x, "species", C.SCI_LEN, w, "a species");
    if (r.err) return r;
    if (r.v) { o.sp = plPreset(C, r.v); if (!o.sp) o.sci = r.v; }
    if (!o.name && o.sp) o.name = C.PRESETS[o.sp].en[0];
    if (!o.name) return { err: w + "title (the plant's name) is required." };
    r = text1(x, "location", C.ROOM_LEN, w, "a plant's room");
    if (r.err) return r;
    o.room = r.v;
    var wd = intArg(x, "water_days", 1, C.KIND_MAX.w, w);
    if (wd.err) return wd;
    o.w = wd.v;
    r = textN(x, "note", C.NOTES_LEN, w, "a plant's notes");
    if (r.err) return r;
    o.notes = r.v;
    return { o: o, key: fold(o.name) + "|" + fold(o.room) };
  }
  function plBase(d) { var C = core("plants"); return d == null && C ? { ver: C.DATA_VER, plants: [], log: [], tombs: {} } : d; }
  function plLive(d) {
    var tombs = isObj(d.tombs) ? d.tombs : {};
    return d.plants.filter(function (p) { return isObj(p) && !(typeof tombs[p.id] === "number" && tombs[p.id] >= p.m); });
  }
  function plVals(C, o) {
    var pr = o.sp ? C.PRESETS[o.sp] : null;
    return { em: pr ? pr.em : "🪴", out: pr ? pr.out : 0, w: o.w !== null ? o.w : (pr ? pr.w : 7),
             ww: pr ? pr.ww : 0, f: pr ? pr.f : 0, mi: pr ? pr.mi : 0 };
  }
  function plPlan(d, items) {
    var C = core("plants");
    d = plBase(d);
    if (!isObj(d) || !Array.isArray(d.plants)) return notOpened("Plant Care");
    var e = room(plLive(d).length, items.length, C.MAX_PLANTS, "plants", "Plant Care");
    if (e) return e;
    return { ok: true, rows: items.map(function (o) {
      var dup = null, v = plVals(C, o), f = [];
      plLive(d).forEach(function (p) { if (!dup && fold(p.name) === fold(o.name) && fold(p.room) === fold(o.room)) dup = { id: p.id, title: p.name, target: p.id }; });
      if (o.sp) f.push(["species", C.PRESETS[o.sp].en[0]]);
      else if (o.sci) f.push(["species", o.sci]);
      if (o.room) f.push(["room", o.room]);
      f.push(["water", String(v.w)]);
      if (o.notes) f.push(["note", preview(o.notes, 200)]);
      return { title: o.name, fields: f, dup: dup };
    }) };
  }
  function plApply(d, items, now, skip, ctx) {
    var C = core("plants");
    d = plBase(d);
    var made = [], undo = { app: "plants", t: "new", items: [] }, s = stampAfter(now, 0), taken = takenOf(d, ["plants", "log"]), st = todayOf(ctx, now);
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var v = plVals(C, o);
      var p = { id: newIdIn(now, taken), m: s, st: st, sn: {}, name: o.name, sp: o.sp, room: o.room, sci: o.sci, out: v.out,
                em: v.em, w: v.w, ww: v.ww, f: v.f, mi: v.mi, r: 0, notes: o.notes };
      if (!p.sci) delete p.sci;
      d.plants.push(p);
      made.push({ i: i, id: p.id, title: p.name, target: p.id });
    });
    d = C.merge(d, d, now);
    made.forEach(function (m) { undo.items.push({ id: m.id, x: clone(byId(d.plants, m.id)) }); });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function plUndo(d, u, now) {
    var C = core("plants");
    if (!C || !isObj(d) || !Array.isArray(d.plants)) return bad("Plant Care has no plants.");
    for (var i = 0; i < u.items.length; i++) {
      var id = u.items[i].id;
      if (!unchanged(byId(d.plants, id), u.items[i].x)) return bad("A new plant was changed since; nothing was undone.");
      if ((d.log || []).some(function (l) { return isObj(l) && l.p === id; })) return bad("A new plant was watered or cared for since; nothing was undone (delete it in Plant Care).");
    }
    if (!isObj(d.tombs)) d.tombs = {};
    u.items.forEach(function (it) {
      var p = byId(d.plants, it.id);
      if (!p) return;
      d.plants.splice(d.plants.indexOf(p), 1);
      d.tombs[it.id] = Math.max(stampAfter(now, p.m), d.tombs[it.id] || 0);
    });
    return { ok: true, data: C.merge(d, d, now) };
  }

  // ---------- 5. Pet Health Book: a health record ----------
  // petcare.js addRec through normRec: record vaccine, deworm, visit,
  // medication or weight, on date (default today), for the pet named.
  var PC_KIND = { vaccine: "vacc", deworm: "deworm", visit: "visit", medication: "med", weight: "weight" };
  function normPet(x, w, ctx) {
    var C = core("petcare");
    if (!C) return { err: "Pet Health Book is not available." };
    var rec = empty(x, "record") ? "" : String(x.record);
    if (!has(PC_KIND, rec)) return { err: w + "record must be one of " + Object.keys(PC_KIND).join(", ") + " for petcare." };
    var k = PC_KIND[rec], o = { k: k, rec: rec };
    var r = text1(x, "pet", C.NAME_LEN, w, "a pet's name");
    if (r.err) return r;
    o.pq = r.v;
    r = dateOf(x, "date", w);
    if (r.err) return r;
    o.d = r.v || todayOf(ctx);
    r = textN(x, "note", C.REC_NOTES, w, "a health record's note");
    if (r.err) return r;
    o.nt = r.v;
    if (k === "weight") {
      var kg = numArg(x, "weight_kg", 0.001, 2000, w);
      if (kg.err) return kg;
      if (kg.v === null) return { err: w + "weight_kg is required for a weight." };
      o.g = Math.round(kg.v * 1000);
      if (!empty(x, "title")) return { err: w + "a weight has no title; put details in note." };
      o.title = (o.g / 1000) + " kg";
      return { o: o, key: k + "|" + fold(o.pq) + "|" + o.d };
    }
    r = text1(x, "title", C.TEXT_LEN, w, "a health record's title");
    if (r.err) return r;
    o.n = r.v;
    if ((k === "vacc" || k === "med") && !o.n) return { err: w + "title (the " + (k === "vacc" ? "vaccine" : "medicine") + "'s name) is required." };
    if (k === "vacc" || k === "deworm" || k === "visit") {
      r = dateOf(x, "next_due", w);
      if (r.err) return r;
      if (r.v && r.v <= o.d) return { err: w + "next_due must be after date." };
      o.nx = r.v;
    }
    if (k === "vacc" || k === "visit") {
      r = text1(x, "vet", C.TEXT_LEN, w, "a vet's name");
      if (r.err) return r;
      o.v = r.v;
    }
    if (k === "visit") {
      var c = cents(x, "amount", 100000000, w);
      if (c.err) return c;
      o.c = c.v || 0;
    }
    if (k === "med") {
      r = text1(x, "dose", C.TEXT_LEN, w, "a dose");
      if (r.err) return r;
      o.ds = r.v;
      r = dateOf(x, "until", w);
      if (r.err) return r;
      if (r.v && r.v < o.d) return { err: w + "until must be on or after date." };
      o.u = r.v;
    }
    o.title = o.n || rec;
    return { o: o, key: k + "|" + fold(o.pq) + "|" + o.d + "|" + fold(o.n) };
  }
  function pcPets(d) {
    var tombs = isObj(d.tombs) ? d.tombs : {};
    return (Array.isArray(d.pets) ? d.pets : []).filter(function (p) {
      return isObj(p) && !(typeof tombs[p.id] === "number" && tombs[p.id] >= p.m) && !p.gone;
    });
  }
  function pcResolve(d, items) {
    var ps = pcPets(d), out = [];
    for (var i = 0; i < items.length; i++) {
      var r = ownerOf(ps, items[i].pq, "pet", "Pet Health Book", function (p) { return p.name; });
      if (r.err) return { err: "items[" + i + "]: " + r.err };
      out.push(r.hit);
    }
    return { res: out };
  }
  function pcRow(o, petId, id, m) {
    var x = { id: id, p: petId, k: o.k, d: o.d, m: m, nt: o.nt };
    if (o.k === "weight") x.g = o.g;
    else {
      x.n = o.n;
      if (o.nx) x.nx = o.nx;
      if (o.v) x.v = o.v;
      if (o.k === "visit") x.c = o.c;
      if (o.k === "med") { x.ds = o.ds; if (o.u) x.u = o.u; }
    }
    return x;
  }
  function pcPlan(d, items) {
    var C = core("petcare");
    if (!isObj(d) || !Array.isArray(d.pets) || !Array.isArray(d.recs)) return notOpened("Pet Health Book");
    var r = pcResolve(d, items);
    if (r.err) return bad(r.err);
    var e = room(d.recs.length, items.length, C.MAX_RECS, "records", "Pet Health Book");
    if (e) return e;
    return { ok: true, rows: items.map(function (o, i) {
      var p = r.res[i], dup = null, f = [["pet", p.name], ["record", o.rec], ["date", o.d]];
      d.recs.forEach(function (x) {
        if (!dup && isObj(x) && x.p === p.id && x.k === o.k && x.d === o.d && fold(x.n || "") === fold(o.n || "")) dup = { id: x.id, title: o.title, target: { pet: p.id, rec: x.id } };
      });
      if (o.nx) f.push(["nextdue", o.nx]);
      if (o.v) f.push(["vet", o.v]);
      if (o.c) f.push(["cost", H.money(o.c)]);
      if (o.ds) f.push(["dose", o.ds]);
      if (o.u) f.push(["until", o.u]);
      if (o.nt) f.push(["note", preview(o.nt, 200)]);
      return { title: o.title, fields: f, dup: dup };
    }) };
  }
  function pcApply(d, items, now, skip) {
    var C = core("petcare"), r = pcResolve(d, items);
    if (r.err) return bad(r.err);
    var made = [], undo = { app: "petcare", t: "new", items: [] }, s = stampAfter(now, 0), taken = takenOf(d, ["pets", "recs"]);
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var x = C.normRec(pcRow(o, r.res[i].id, newIdIn(now, taken), s));
      if (!x) return;
      d.recs.push(x);
      made.push({ i: i, id: x.id, title: o.title, target: { pet: x.p, rec: x.id } });
    });
    d = C.merge(d, d, now);
    made.forEach(function (m) { undo.items.push({ id: m.id, x: clone(byId(d.recs, m.id)) }); });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function pcUndo(d, u, now) {
    var C = core("petcare");
    if (!C || !isObj(d) || !Array.isArray(d.recs)) return bad("Pet Health Book has no records.");
    for (var i = 0; i < u.items.length; i++) {
      if (!unchanged(byId(d.recs, u.items[i].id), u.items[i].x)) return bad("A new record was changed since; nothing was undone.");
    }
    if (!isObj(d.tombs)) d.tombs = {};
    u.items.forEach(function (it) {
      var x = byId(d.recs, it.id);
      if (!x) return;
      d.recs.splice(d.recs.indexOf(x), 1);
      d.tombs[it.id] = Math.max(stampAfter(now, x.m), d.tombs[it.id] || 0);
    });
    return { ok: true, data: C.merge(d, d, now) };
  }

  // ---------- 6. Media Shelf: a title ----------
  // shelf.js editDialog: normItem's field order, a cover colour picked
  // at random (as the form), the history entry of its status (start,
  // done or drop on today, as the form). Kept in step with shelf.js
  // TITLE_LEN / BY_LEN / PLAT_LEN / TAG_LEN / MAX_TAGS / MAX_ITEMS.
  var SH = { title: 200, by: 120, plat: 40, tag: 30, tags: 10, max: 5000, colors: 10 };
  var SH_TYPES = ["book", "film", "series", "album", "podcast", "game"];
  var SH_ST = { want: "want", now: "now", done: "done", dropped: "drop" };
  function normMedia(x, w) {
    var r = text1(x, "title", SH.title, w, "a title on the shelf");
    if (r.err) return r;
    if (!r.v) return { err: w + "title is required." };
    var o = { title: r.v };
    o.type = empty(x, "media") ? "book" : String(x.media);
    if (SH_TYPES.indexOf(o.type) < 0) return { err: w + "media must be one of " + SH_TYPES.join(", ") + "." };
    var st = empty(x, "status") ? "want" : String(x.status);
    if (!has(SH_ST, st)) return { err: w + "status must be want, now, done or dropped for shelf." };
    o.st = SH_ST[st];
    r = text1(x, "by", SH.by, w, "a creator's name");
    if (r.err) return r;
    o.by = r.v;
    var y = intArg(x, "year", 1, 9999, w);
    if (y.err) return y;
    o.year = y.v || 0;
    r = text1(x, "platform", SH.plat, w, "a platform");
    if (r.err) return r;
    if (r.v && o.type !== "game") return { err: w + "platform is for games only." };
    o.plat = r.v;
    r = names(x, "labels", SH.tags, SH.tag, w, "a title's tags");
    if (r.err) return r;
    o.tags = [];
    var seen = {};
    r.v.forEach(function (t) { t = t.replace(/,/g, ""); if (t && !seen[fold(t)]) { seen[fold(t)] = 1; o.tags.push(t); } });
    return { o: o, key: o.type + "|" + fold(o.title) + "|" + fold(o.by) };
  }
  function shBase(d) { return d == null ? { ver: 1, items: [], sess: [], goals: {}, tombs: {} } : d; }
  function shLive(d) {
    var tombs = isObj(d.tombs) ? d.tombs : {};
    return d.items.filter(function (it) { return isObj(it) && !(typeof tombs[it.id] === "number" && tombs[it.id] >= it.m); });
  }
  function shPlan(d, items) {
    d = shBase(d);
    if (!isObj(d) || !Array.isArray(d.items) || !Array.isArray(d.sess)) return notOpened("Media Shelf");
    var e = room(shLive(d).length, items.length, SH.max, "titles", "Media Shelf");
    if (e) return e;
    return { ok: true, rows: items.map(function (o) {
      var dup = null, f = [["media", o.type], ["status", o.st === "drop" ? "dropped" : o.st]];
      shLive(d).forEach(function (it) { if (!dup && it.type === o.type && fold(it.title) === fold(o.title)) dup = { id: it.id, title: it.title, target: { item: it.id } }; });
      if (o.by) f.push(["by", o.by]);
      if (o.year) f.push(["year", String(o.year)]);
      if (o.plat) f.push(["platform", o.plat]);
      if (o.tags.length) f.push(["labels", o.tags.join(", ")]);
      return { title: o.title, fields: f, dup: dup };
    }) };
  }
  function shApply(d, items, now, skip, ctx) {
    d = shBase(d);
    if (!isObj(d.tombs)) d.tombs = {};
    var made = [], undo = { app: "shelf", t: "new", items: [] }, s = stampAfter(now, 0), taken = takenOf(d, ["items", "sess"]), day = todayOf(ctx, now);
    var K = { now: "s", done: "d", drop: "x" };
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var it = { id: newIdIn(now, taken), m: s, a: s, type: o.type, title: o.title, by: o.by, year: o.year, size: 0,
                 fmt: o.type === "book" ? "p" : "", plat: o.type === "game" ? o.plat : "", st: o.st, prio: 0, rate: 0, fav: 0,
                 tags: o.tags, rev: "", src: "", col: Math.floor(Math.random() * SH.colors) };
      d.items.push(it);
      var ss = null;
      if (K[o.st]) { ss = { id: newIdIn(now, taken), m: s, it: it.id, k: K[o.st], d: day }; d.sess.push(ss); }
      made.push({ i: i, id: it.id, title: it.title, target: { item: it.id } });
      undo.items.push({ id: it.id, x: clone(it), sess: ss ? ss.id : "" });
    });
    sortById(d.items);
    sortById(d.sess);
    return { ok: true, data: d, made: made, undo: undo };
  }
  function shUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.items) || !Array.isArray(d.sess)) return bad("Media Shelf has no titles.");
    for (var i = 0; i < u.items.length; i++) {
      var it = u.items[i];
      if (!unchanged(byId(d.items, it.id), it.x)) return bad("A new title was changed since; nothing was undone.");
      if (d.sess.some(function (s) { return isObj(s) && s.it === it.id && s.id !== it.sess; })) return bad("Progress was logged on a new title since; nothing was undone (delete it in Media Shelf).");
    }
    if (!isObj(d.tombs)) d.tombs = {};
    u.items.forEach(function (it) {
      var x = byId(d.items, it.id);
      if (x) {
        d.items.splice(d.items.indexOf(x), 1);
        d.tombs[it.id] = Math.max(stampAfter(now, x.m), d.tombs[it.id] || 0);
      }
      var s = it.sess ? byId(d.sess, it.sess) : null;
      if (s) {
        d.sess.splice(d.sess.indexOf(s), 1);
        d.tombs[s.id] = Math.max(stampAfter(now, s.m), d.tombs[s.id] || 0);
      }
    });
    var sorted = {};
    Object.keys(d.tombs).sort(cmpStr).forEach(function (k) { sorted[k] = d.tombs[k]; });
    d.tombs = sorted;
    return { ok: true, data: d };
  }

  // ---------- 7. Publishing: titles the user publishes (AS-ADD7) ----------
  // publish/app.js newTitleDialog: a title with its people, release
  // date and the release plan counted back from it (C.makePlan, as the
  // form's tick), plus what a list of titles usually has (subtitle,
  // series, language, back-cover text, notes, formats with ISBN, price
  // and pages). Every row goes through OrosPublishCore's own cleaning
  // (C.put → cleanTitle), so opening Publishing rewrites nothing. An
  // ISBN that is not valid, or already on another title (or marked
  // used outside the app), is refused, never dropped.
  var PB = { title: 200, sub: 200, ser: 120, sn: 12, lang: 40, blurb: 4000, notes: 4000, name: 120, ppl: 12, fmts: 8, max: 5000 };
  var PB_ST = { idea: "idea", production: "prod", released: "out", out_of_print: "oop" };
  var PB_FMT = { paperback: "pb", hardback: "hb", ebook: "eb", audiobook: "ab", other: "ot" };
  // wave M1 (music releases): release_type, tracks and editions, as
  // Publishing's New title › Music and its Tracks / Editions sections
  var PB_MT = { single: "single", ep: "ep", album: "album", compilation: "comp" };
  var PB_MED = { digital: "dig", cd: "cd", vinyl: "vin", cassette: "cas", other: "ot" };
  var PB_TRK = 200;
  function durArg(x, k, w) {
    if (empty(x, k)) return { v: 0 };
    if (typeof x[k] === "number" && x[k] >= 0 && x[k] <= 36000 && Math.floor(x[k]) === x[k]) return { v: x[k] };
    var m = /^\s*(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\s*$/.exec(String(x[k]));
    if (m && +m[3] < 60) return { v: (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) };
    return { err: w + k + " must be the length as m:ss (e.g. 3:45) or whole seconds." };
  }
  function normMusic(x, o, w, C) {
    var rt = String(x.release_type);
    if (!has(PB_MT, rt)) return { err: w + "release_type must be single, ep, album or compilation." };
    if (Array.isArray(x.formats) && x.formats.length) return { err: w + "a music release has editions, not formats; give editions." };
    if (x.release_plan === true) return { err: w + "release_plan is for books for now; leave it out for a music release." };
    o.plan = false;
    o.fmts = [];
    o.mt = { k: PB_MT[rt] };
    var mx = [["label", "lbl", 120, "a label's name"], ["genre", "gen", 60, "a genre"], ["p_line", "pl", 200, "the \u2117 line"], ["c_line", "cl", 200, "the \u00a9 line"]];
    for (var i = 0; i < mx.length; i++) {
      var y = text1(x, mx[i][0], mx[i][2], w, mx[i][3]);
      if (y.err) return y;
      if (y.v) o.mt[mx[i][1]] = y.v;
    }
    var seen = {};
    var tl = empty(x, "tracks") ? [] : x.tracks;
    if (!Array.isArray(tl)) return { err: w + "tracks must be a list." };
    if (tl.length > PB_TRK) return { err: w + "a release keeps " + PB_TRK + " tracks in Publishing; give fewer." };
    o.trk = [];
    for (i = 0; i < tl.length; i++) {
      var tr = typeof tl[i] === "string" ? { title: tl[i] } : tl[i], tw = w + "tracks[" + i + "].";
      if (!isObj(tr)) return { err: w + "tracks[" + i + "] must be an object (or a title)." };
      var r = text1(tr, "title", 200, tw, "a track's title");
      if (r.err) return r;
      if (!r.v) return { err: tw + "title is required." };
      var to = { t: r.v, ver: "", art: "", isrc: "", dur: 0, lang: o.lang, ex: tr.explicit === true ? 1 : 0 };
      var tx = [["version", "ver", 120, "a version"], ["artist", "art", 200, "an artist"], ["language", "lang", 40, "a language"]];
      for (var j = 0; j < tx.length; j++) {
        var z = text1(tr, tx[j][0], tx[j][2], tw, tx[j][3]);
        if (z.err) return z;
        if (z.v) to[tx[j][1]] = z.v;
      }
      if (!empty(tr, "explicit") && typeof tr.explicit !== "boolean") return { err: tw + "explicit must be true or false." };
      if (!empty(tr, "isrc")) {
        var pi = C.parseIsrc(String(tr.isrc));
        if (!pi.ok) return { err: tw + "isrc " + String(tr.isrc).slice(0, 30) + " is not a valid ISRC (CC-XXX-YY-NNNNN). Leave it out when unsure; never make one up." };
        if (seen[pi.isrc]) return { err: tw + "isrc " + C.fmtIsrc(pi.isrc) + " is given twice." };
        seen[pi.isrc] = 1;
        to.isrc = pi.isrc;
      }
      var du = durArg(tr, "length", tw);
      if (du.err) return du;
      to.dur = du.v;
      o.trk.push(to);
    }
    var el = empty(x, "editions") ? [] : x.editions;
    if (!Array.isArray(el)) return { err: w + "editions must be a list." };
    if (el.length > PB.fmts) return { err: w + "a release keeps " + PB.fmts + " editions in Publishing; give fewer." };
    o.med = [];
    for (i = 0; i < el.length; i++) {
      var e = el[i], ew = w + "editions[" + i + "].";
      if (!isObj(e)) return { err: w + "editions[" + i + "] must be an object." };
      var k = empty(e, "edition") ? "digital" : String(e.edition);
      if (!has(PB_MED, k)) return { err: ew + "edition must be digital, cd, vinyl, cassette or other." };
      var eo = { k: PB_MED[k], upc: "", cat: "", price: 0, dist: "" };
      if (!empty(e, "upc")) {
        var pu = C.parseUpc(String(e.upc));
        if (!pu.ok) return { err: ew + "upc " + String(e.upc).slice(0, 30) + " is not a valid UPC (12 digits) or EAN (13 digits)" + (pu.why === "check" ? " (its check digit is wrong)" : pu.why === "isbn" ? " (it is an ISBN)" : "") + ". Leave it out when unsure; never make one up." };
        if (seen[C.upcKey(pu.upc)]) return { err: ew + "upc " + pu.upc + " is given twice." };
        seen[C.upcKey(pu.upc)] = 1;
        eo.upc = pu.upc;
      }
      var cz = text1(e, "catalogue_no", 40, ew, "a catalogue number");
      if (cz.err) return cz;
      eo.cat = cz.v;
      var dz = text1(e, "distributor", 80, ew, "a distributor's name");
      if (dz.err) return dz;
      eo.dist = dz.v;
      var p = numArg(e, "price", 0, 1e6, ew);
      if (p.err) return p;
      eo.price = p.v ? Math.round(p.v * 100) / 100 : 0;
      o.med.push(eo);
    }
    return null;
  }
  function pubCore() {
    if (root.OrosPublishCore) return root.OrosPublishCore;
    if (NODE) { try { return require("../publish/core.js"); } catch (e) { return null; } }
    return null;
  }
  function keyOf(map, v) { var k = ""; Object.keys(map).forEach(function (x) { if (map[x] === v) k = x; }); return k; }
  // "A, B; C" → ["A", "B", "C"] (or a list of names)
  function people(x, k, w) {
    if (empty(x, k)) return { v: [] };
    var raw = Array.isArray(x[k]) ? x[k] : typeof x[k] === "string" ? x[k].split(/[,;]/) : null;
    if (!raw) return { err: w + k + " must be text (names separated by commas)." };
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      if (typeof raw[i] !== "string") return { err: w + k + " must be text (names separated by commas)." };
      var n = H.one(raw[i]);
      if (!n) continue;
      if (n.length > PB.name) return { err: w + k + ": a name has " + n.length + " characters; Publishing keeps " + PB.name + "." };
      if (!out.some(function (o) { return fold(o) === fold(n); })) out.push(n);
    }
    return { v: out };
  }
  // The Woo shop of a product link (fmt.wp = { a, id }, as Publishing's
  // "Send to the shop" writes it): ctx.woo = the Connected services
  // WooCommerce accounts [{ id, name, site }]; shop = its name or
  // address, needed only when there are several.
  function wooAcct(x, w, ctx) {
    var list = ctx && Array.isArray(ctx.woo) ? ctx.woo.filter(function (a) { return isObj(a) && typeof a.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(a.id); }) : [];
    if (!list.length) return { err: w + "wc_id needs a WooCommerce shop in Settings › Connected services, and there is none on this device. Leave wc_id out, or ask the user to connect the shop first." };
    var names = list.map(function (a) { return a.name || a.site || a.id; });
    if (empty(x, "shop")) return list.length === 1 ? { v: list[0].id } : { err: w + "wc_id: the user has several shops (" + names.join(", ") + "); give shop." };
    var q = fold(String(x.shop)).replace(/^https?:\/\//, "").replace(/\/+$/, "").trim();
    var hit = list.filter(function (a) {
      var site = fold(String(a.site || "")).replace(/^https?:\/\//, "").replace(/\/+$/, "");
      return fold(String(a.name || "")) === q || (site && (site === q || site.replace(/^www\./, "") === q.replace(/^www\./, "")));
    });
    return hit.length === 1 ? { v: hit[0].id } : { err: w + "shop " + String(x.shop).slice(0, 80) + " is not one of the user's shops: " + names.join(", ") + "." };
  }
  function normPub(x, w, ctx) {
    var C = pubCore();
    if (!C) return { err: "Publishing is not available right now." };
    var r = text1(x, "title", PB.title, w, "a book's title");
    if (r.err) return r;
    if (!r.v) return { err: w + "title is required." };
    var o = { t: r.v };
    var tx = [["subtitle", "sub", PB.sub, "a subtitle"], ["series", "ser", PB.ser, "a series' name"], ["series_no", "sn", PB.sn, "a number in the series"],
              ["language", "lang", PB.lang, "a language"]];
    for (var i = 0; i < tx.length; i++) {
      var y = empty(x, tx[i][0]) ? { v: "" } : typeof x[tx[i][0]] === "number" ? { v: String(x[tx[i][0]]) } : text1(x, tx[i][0], tx[i][2], w, tx[i][3]);
      if (y.err) return y;
      if (y.v.length > tx[i][2]) return { err: w + tx[i][0] + " has " + y.v.length + " characters; " + tx[i][3] + " keeps " + tx[i][2] + "." };
      o[tx[i][1]] = y.v;
    }
    r = textN(x, "blurb", PB.blurb, w, "the back-cover text");
    if (r.err) return r;
    o.blurb = r.v;
    r = textN(x, "note", PB.notes, w, "a title's notes");
    if (r.err) return r;
    o.notes = r.v;
    var st = empty(x, "status") ? "idea" : String(x.status);
    if (!has(PB_ST, st)) return { err: w + "status must be idea, production, released or out_of_print for publish." };
    o.st = PB_ST[st];
    var d = dateOf(x, "date", w);
    if (d.err) return d;
    if (d.v && !C.okYmd(d.v)) return { err: w + "date must be a real date as YYYY-MM-DD." };
    o.rel = d.v;
    if (!empty(x, "release_plan") && typeof x.release_plan !== "boolean") return { err: w + "release_plan must be true or false." };
    if (x.release_plan === true && !o.rel) return { err: w + "release_plan needs date (the release date)." };
    // as the form's tick: on for a book still to come; a released or
    // out-of-print title gets none unless asked
    o.plan = !!o.rel && (x.release_plan === true || (x.release_plan !== false && (o.st === "idea" || o.st === "prod")));
    var ppl = [];
    var who = [["by", "a"], ["translator", "t"], ["illustrator", "i"], ["editor", "e"], ["cover_designer", "c"], ["narrator", "n"], ["other", "o"]];
    for (i = 0; i < who.length; i++) {
      var pr = people(x, who[i][0], w);
      if (pr.err) return pr;
      pr.v.forEach(function (n) { ppl.push({ r: who[i][1], n: n }); });
    }
    if (ppl.length > PB.ppl) return { err: w + "a title keeps " + PB.ppl + " people in Publishing; give fewer." };
    o.ppl = ppl;
    var fl = empty(x, "formats") ? [] : x.formats;
    if (!Array.isArray(fl)) return { err: w + "formats must be a list." };
    if (fl.length > PB.fmts) return { err: w + "a title keeps " + PB.fmts + " formats in Publishing; give fewer." };
    o.fmts = [];
    var isbns = {}, wcs = {};
    for (i = 0; i < fl.length; i++) {
      var f = fl[i], fw = w + "formats[" + i + "].";
      if (!isObj(f)) return { err: w + "formats[" + i + "] must be an object." };
      var k = empty(f, "format") ? "paperback" : String(f.format);
      if (!has(PB_FMT, k)) return { err: fw + "format must be paperback, hardback, ebook, audiobook or other." };
      var fo = { k: PB_FMT[k], isbn: "", price: 0, pages: 0 };
      if (!empty(f, "isbn")) {
        var pi = C.parseIsbn(String(f.isbn));
        if (!pi.ok) return { err: fw + "isbn " + String(f.isbn).slice(0, 30) + " is not a valid ISBN" + (pi.why === "check" ? " (its check digit is wrong)" : "") + ". Leave it out when unsure; never make one up." };
        if (isbns[pi.isbn]) return { err: fw + "isbn " + pi.isbn + " is given twice." };
        isbns[pi.isbn] = 1;
        fo.isbn = pi.isbn;
      }
      var p = numArg(f, "price", 0, 1e6, fw);
      if (p.err) return p;
      fo.price = p.v ? Math.round(p.v * 100) / 100 : 0;
      var pg = intArg(f, "pages", 1, 100000, fw);
      if (pg.err) return pg;
      fo.pages = pg.v || 0;
      // the shop product it already is (Publishing's "Send to the shop" link)
      var wc = intArg(f, "wc_id", 1, 1e12, fw);
      if (wc.err) return wc;
      if (wc.v) {
        var ac = wooAcct(x, w, ctx);
        if (ac.err) return ac;
        if (wcs[ac.v + "|" + wc.v]) return { err: fw + "wc_id " + wc.v + " is given twice." };
        wcs[ac.v + "|" + wc.v] = 1;
        fo.wp = { a: ac.v, id: wc.v };
      }
      o.fmts.push(fo);
    }
    if (!empty(x, "release_type")) {
      var me = normMusic(x, o, w, C);
      if (me) return me;
    } else if (["tracks", "editions", "label", "genre", "p_line", "c_line"].some(function (k) { return !empty(x, k); })) {
      return { err: w + "tracks, editions, label, genre, p_line and c_line are for a music release: give release_type too." };
    }
    var by = ppl.filter(function (q) { return q.r === "a"; }).map(function (q) { return fold(q.n); }).join(",");
    return { o: o, key: fold(o.t) + "|" + by };
  }
  function pbBase(d) {
    var C = pubCore();
    return d == null ? C.empty() : isObj(d) && (d.titles == null || Array.isArray(d.titles)) ? C.normalize(d) : null;
  }
  function pbPlan(d, items, ctx) {
    var C = pubCore();
    if (!C) return bad("Publishing is not available right now.");
    d = pbBase(d);
    if (!d) return notOpened("Publishing");
    var e = room(d.titles.length, items.length, PB.max, "titles", "Publishing");
    if (e) return e;
    var woo = ctx && Array.isArray(ctx.woo) ? ctx.woo : [];
    function shopName(id) { var a = woo.filter(function (x) { return isObj(x) && x.id === id; })[0]; return a ? String(a.name || a.site || "") : ""; }
    // a shop product already linked to a format of another title, or twice here
    var linked = {}, seenWp = {};
    d.titles.forEach(function (t) { t.fmts.forEach(function (f) { if (f.wp) linked[f.wp.a + "|" + f.wp.id] = t; }); });
    for (var q = 0; q < items.length; q++) {
      for (var r = 0; r < items[q].fmts.length; r++) {
        var wp = items[q].fmts[r].wp;
        if (!wp) continue;
        var kk = wp.a + "|" + wp.id;
        if (seenWp[kk] !== undefined && seenWp[kk] !== q) return bad("items[" + seenWp[kk] + "] and items[" + q + "] have the same shop product " + wp.id + "; each edition has its own.");
        seenWp[kk] = q;
        if (linked[kk] && fold(linked[kk].t) !== fold(items[q].t)) return bad("items[" + q + "]: shop product " + wp.id + " is already linked to \u201c" + linked[kk].t + "\u201d in Publishing. Check the number; nothing was added.");
      }
    }
    // music codes (wave M1): an ISRC or UPC/EAN already on another
    // release (or marked used elsewhere), or twice in this call
    var mused = C.usedCodes(d), mseen = {};
    for (var mi = 0; mi < items.length; mi++) {
      var codes = (items[mi].trk || []).map(function (x) { return x.isrc; }).concat((items[mi].med || []).map(function (x) { return x.upc ? C.upcKey(x.upc) : ""; }));
      for (var mj = 0; mj < codes.length; mj++) {
        var mc = codes[mj];
        if (!mc) continue;
        if (mseen[mc] !== undefined && mseen[mc] !== mi) return bad("items[" + mseen[mc] + "] and items[" + mi + "] have the same code " + mc + "; each track and edition needs its own.");
        mseen[mc] = mi;
        var mu = mused[mc] ? mused[mc][0] : null;
        if (!mu) continue;
        var mon = mu.x ? null : C.find(d, "titles", mu.title);
        return bad("items[" + mi + "]: code " + mc + " is already " + (mon ? "on \u201c" + mon.t + "\u201d" : "marked as used outside Publishing") + ". Check the code; nothing was added.");
      }
    }
    var used = C.used(d), seen = {};
    for (var i = 0; i < items.length; i++) {
      for (var j = 0; j < items[i].fmts.length; j++) {
        var n = items[i].fmts[j].isbn;
        if (!n) continue;
        if (seen[n] !== undefined) return bad("items[" + seen[n] + "] and items[" + i + "] have the same ISBN " + n + "; each book needs its own.");
        seen[n] = i;
        var u = used[n] ? used[n][0] : null;
        if (!u) continue;
        var on = u.x ? null : C.find(d, "titles", u.title);
        if (!on || fold(on.t) !== fold(items[i].t)) {
          return bad("items[" + i + "]: ISBN " + n + " is already " + (on ? "on \u201c" + on.t + "\u201d" : "marked as used outside Publishing") + ". Check the number; nothing was added.");
        }
      }
    }
    return { ok: true, rows: items.map(function (o) {
      var dup = null, f = [];
      d.titles.forEach(function (t) {
        if (dup || fold(t.t) !== fold(o.t)) return;
        var a1 = C.authors(t).map(fold), a2 = o.ppl.filter(function (q) { return q.r === "a"; }).map(function (q) { return fold(q.n); });
        if (!a1.length || !a2.length || a2.some(function (a) { return a1.indexOf(a) >= 0; })) dup = { id: t.id, title: t.t, target: { title: t.id } };
      });
      if (o.sub) f.push(["sub", o.sub]);
      var nm = { a: "by", t: "translator", i: "illustrator", e: "editor" };
      ["a", "t", "i", "e"].forEach(function (r) {
        var list = o.ppl.filter(function (q) { return q.r === r; }).map(function (q) { return q.n; });
        if (list.length) f.push([nm[r], list.join(", ")]);
      });
      if (o.ser) f.push(["series", o.ser + (o.sn ? " #" + o.sn : "")]);
      if (o.mt) {
        f.push(["mtype", keyOf(PB_MT, o.mt.k)]);
        if (o.mt.lbl) f.push(["label", o.mt.lbl]);
        if (o.mt.gen) f.push(["genre", o.mt.gen]);
      }
      f.push(["status", keyOf(PB_ST, o.st)]);
      if (o.rel) f.push([o.plan ? "rel" : "release", o.rel]);
      if (o.lang) f.push(["lang", o.lang]);
      o.fmts.forEach(function (x) {
        f.push(["format", keyOf(PB_FMT, x.k) + (x.price ? "|" + x.price.toFixed(2) + " " + d.set.cur : "")]);
        if (x.isbn) f.push(["isbn", C.hyphen(x.isbn, d.blocks)]);
        if (x.pages) f.push(["pages", String(x.pages)]);
        if (x.wp) f.push(["product", "#" + x.wp.id + (shopName(x.wp.a) ? " \u00b7 " + shopName(x.wp.a) : "")]);
      });
      (o.trk || []).forEach(function (x, n) {
        var mm = Math.floor(x.dur / 60), ss = x.dur % 60;
        f.push(["track", (n + 1) + ". " + x.t + (x.ver ? " (" + x.ver + ")" : "") + (x.dur ? " " + mm + ":" + (ss < 10 ? "0" : "") + ss : "") + (x.isrc ? " \u00b7 " + C.fmtIsrc(x.isrc) : "")]);
      });
      (o.med || []).forEach(function (x) {
        f.push(["format", keyOf(PB_MED, x.k) + (x.price ? "|" + x.price.toFixed(2) + " " + d.set.cur : "")]);
        if (x.upc) f.push(["upc", x.upc]);
      });
      if (o.blurb) f.push(["blurb", preview(o.blurb, 120)]);
      if (o.notes) f.push(["note", preview(o.notes, 120)]);
      return { title: o.t, fields: f, dup: dup };
    }) };
  }
  function pbApply(d, items, now, skip) {
    var C = pubCore();
    d = pbBase(d);
    var made = [], undo = { app: "publish", t: "new", items: [] }, taken = takenOf(d, C.LISTS), s = stampAfter(now, 0);
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var id = newIdIn(now, taken);
      var row = { id: id, t: o.t, sub: o.sub, ser: o.ser, sn: o.sn, st: o.st, rel: o.rel, lang: o.lang, ppl: o.ppl,
                  fmts: o.fmts.map(function (f) {
                    var r = { id: newIdIn(now, taken), k: f.k, isbn: f.isbn, price: f.price, pages: f.pages };
                    if (f.wp) r.wp = { a: f.wp.a, id: f.wp.id };
                    return r;
                  }),
                  blurb: o.blurb, notes: o.notes };
      if (o.plan) row.plan = C.makePlan(o.rel, [], function () { return newIdIn(now, taken); });
      if (o.mt) row.mt = clone(o.mt);
      d = C.put(d, "titles", row, s);
      (o.trk || []).forEach(function (x, n) {
        d = C.put(d, "trk", { id: newIdIn(now, taken), ti: id, no: n + 1, disc: 1, t: x.t, ver: x.ver, art: x.art, isrc: x.isrc, dur: x.dur, lang: x.lang, ex: x.ex }, s);
      });
      (o.med || []).forEach(function (x) {
        d = C.put(d, "med", { id: newIdIn(now, taken), ti: id, k: x.k, upc: x.upc, cat: x.cat, price: x.price, dist: x.dist }, s);
      });
      var t = C.find(d, "titles", id);
      made.push({ i: i, id: id, title: o.t, target: { title: id } });
      undo.items.push({ id: id, x: clone(t) });
    });
    return { ok: true, data: C.normalize(d), made: made, undo: undo };
  }
  function pbUndo(d, u, now) {
    var C = pubCore();
    if (!C || !isObj(d) || !Array.isArray(d.titles)) return bad("Publishing has no titles.");
    d = C.normalize(d);
    for (var i = 0; i < u.items.length; i++) {
      if (!unchanged(C.find(d, "titles", u.items[i].id), u.items[i].x)) return bad("A new title was changed in Publishing since; nothing was undone (delete it in Publishing).");
    }
    u.items.forEach(function (it) {
      var x = C.find(d, "titles", it.id);
      // a music release goes with its tracks and editions (wave M1)
      if (x) d = C.removeRelease(d, it.id, stampAfter(now, Math.max.apply(null, [x.m].concat(C.tracksOf(d, it.id).concat(C.editionsOf(d, it.id)).map(function (r) { return r.m; })))));
    });
    return { ok: true, data: C.normalize(d) };
  }

  // ---------- 8. Invoices: invoice drafts (AS-ADD8, GATE-PAR P4) ----------
  // invoices.js prefillNew + saveDraft: a NEW invoice DRAFT, saved at
  // once (never issued: a number, a series and the tax act are the
  // user's step in Invoices). The draft is blankDoc's shape with the
  // prefill's client and lines; ser "" lets the device that issues it
  // pick its own series (invoices.js renderEdSub / askIssue). A known
  // client (Invoices' own matchClient: tax id, then name) is linked; an
  // unknown one is written as the draft's party only, no client is
  // made. Every row goes through OrosInvoicesCore.normDoc and the data
  // through normalize, so opening Invoices rewrites nothing.
  var IV = { lines: 50, text: 200, qty: 100000, price: 10000000, client: 120, note: 2000 };
  function invCore() {
    if (root.OrosInvoicesCore) return root.OrosInvoicesCore;
    if (NODE) { try { return require("../invoices/core.js"); } catch (e) { return null; } }
    return null;
  }
  function normInv(x, w) {
    var C = invCore();
    if (!C) return { err: "Invoices is not available right now." };
    return normDraft(x, w, C.curOk);
  }
  // An invoice or quote draft: client, lines, currency, note, date.
  function normDraft(x, w, curOk) {
    var r = text1(x, "client", IV.client, w, "a client's name");
    if (r.err) return r;
    var o = { client: r.v };
    r = empty(x, "tax_id") ? { v: "" } : text1(x, "tax_id", 60, w, "a tax id");
    if (r.err) return r;
    o.afm = r.v.replace(/\s+/g, "");
    var src = x.lines;
    if (!Array.isArray(src) || !src.length) return { err: w + "lines is required: each line with text, qty and price." };
    if (src.length > IV.lines) return { err: w + "an invoice here takes at most " + IV.lines + " lines." };
    o.lines = [];
    for (var i = 0; i < src.length; i++) {
      var L = src[i], lw = w + "lines[" + i + "].";
      if (!isObj(L)) return { err: w + "lines[" + i + "] must be an object with text, qty and price." };
      var d = text1(L, "text", IV.text, lw, "a line's text");
      if (d.err) return d;
      if (!d.v) return { err: lw + "text is required." };
      var q = numArg(L, "qty", 0, IV.qty, lw);
      if (q.err) return q;
      if (!(q.v > 0)) return { err: lw + "qty must be more than 0." };
      var p = numArg(L, "price", 0, IV.price, lw);
      if (p.err) return p;
      if (p.v === null) return { err: lw + "price is required (in currency units, before VAT)." };
      var v = numArg(L, "vat", 0, 100, lw);
      if (v.err) return v;
      var line = { d: d.v, q: Math.round(q.v * 1000) / 1000, p: Math.round(p.v * 100) };
      if (v.v !== null) line.vat = Math.round(v.v * 100) / 100;
      o.lines.push(line);
    }
    o.cur = "";
    if (!empty(x, "currency")) {
      if (!curOk(String(x.currency))) return { err: w + "currency must be a 3-letter ISO code such as EUR." };
      o.cur = String(x.currency);
    }
    r = textN(x, "note", IV.note, w, "an invoice's notes");
    if (r.err) return r;
    o.notes = r.v;
    r = dateOf(x, "date", w);
    if (r.err) return r;
    o.date = r.v;
    return { o: o, key: fold(o.client) + "|" + JSON.stringify(o.lines) };
  }
  function ivBase(d) {
    var C = invCore();
    return d == null ? C.empty() : isObj(d) && Array.isArray(d.docs) && Array.isArray(d.clients) ? C.normalize(d) : null;
  }
  // The draft a row becomes (lines with the profile's VAT when not given).
  function ivDoc(C, d, o, today) {
    var p = d.prof, date = o.date || today;
    var cl = C.matchClient(d, { afm: o.afm, name: o.client });
    var x = {
      id: "", kind: "inv", st: "draft", ser: "", seq: 0, num: "", date: date,
      due: p.days ? C.addDays(date, p.days) : "", cur: o.cur || p.cur, cli: cl ? cl.id : "",
      c: cl ? C.partyOfClient(cl) : C.normParty({ name: o.client, afm: o.afm }),
      lines: o.lines.map(function (l) { return { code: "", d: l.d, q: l.q, unit: "", p: l.p, disc: 0, vat: l.vat !== undefined ? l.vat : p.vat }; }),
      gDisc: 0, wht: p.wht, exempt: "", terms: p.terms, notes: o.notes,
      ref: "", crm: cl && cl.crm ? cl.crm : "", mark: "", file: "", sent: "", plang: "", xnet: 0, xvat: 0, m: 1
    };
    return { x: x, cl: cl };
  }
  function ivSame(a, b) {
    if (a.lines.length !== b.lines.length) return false;
    return a.lines.every(function (l, i) { var m = b.lines[i]; return l.d === m.d && l.q === m.q && l.p === m.p; });
  }
  function ivPlan(d, items, ctx) {
    var C = invCore();
    if (!C) return bad("Invoices is not available right now.");
    d = ivBase(d);
    if (!d) return notOpened("Invoices");
    var today = todayOf(ctx), live = C.live(d.docs);
    var e = room(live.length, items.length, 20000, "documents", "Invoices");
    if (e) return e;
    return { ok: true, rows: items.map(function (o) {
      var r = ivDoc(C, d, o, today), x = r.x, f = [], dup = null;
      live.forEach(function (y) {
        if (dup || y.kind !== "inv" || y.st !== "draft" || fold(y.c.name) !== fold(x.c.name) || !ivSame(y, x)) return;
        dup = { id: y.id, title: y.c.name || x.c.name, target: { invoice: y.id } };
      });
      var cur = x.cur, tot = C.totals(x);
      if (x.c.name) f.push(["client", x.c.name + (r.cl ? "" : " · " + (ctx && ctx.lang === "el" ? "νέος" : "new"))]);
      f.push(["date", x.date]);
      x.lines.forEach(function (l) { f.push(["line", l.d + " · " + l.q + " × " + H.money(l.p) + " " + cur + " · " + l.vat + "%"]); });
      f.push(["amount", H.money(tot.total) + " " + cur]);
      if (x.notes) f.push(["note", preview(x.notes, 120)]);
      return { title: x.c.name || o.lines[0].d, fields: f, dup: dup };
    }) };
  }
  function ivApply(d, items, now, skip, ctx) {
    var C = invCore();
    d = ivBase(d);
    var today = todayOf(ctx, now), made = [], undo = { app: "invoices", t: "new", items: [] }, s = stampAfter(now, 0);
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var x = ivDoc(C, d, o, today).x, id;
      do { id = C.newId(); } while (C.anyId(d.docs, id));
      x.id = id;
      x.m = s;
      d.docs.push(C.normDoc(x));
      made.push({ i: i, id: id, title: x.c.name || o.lines[0].d, target: { invoice: id } });
    });
    d = C.normalize(d);
    made.forEach(function (m) { undo.items.push({ id: m.id, x: clone(C.anyId(d.docs, m.id)) }); });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function ivUndo(d, u, now) {
    var C = invCore();
    if (!C || !isObj(d) || !Array.isArray(d.docs)) return bad("Invoices has no documents.");
    d = C.normalize(d);
    for (var i = 0; i < u.items.length; i++) {
      var cur = C.anyId(d.docs, u.items[i].id);
      if (cur && !unchanged(cur, u.items[i].x)) return bad("A new invoice draft was changed or issued in Invoices since; nothing was undone (delete the draft in Invoices).");
    }
    d.docs = d.docs.map(function (x) {
      var it = u.items.filter(function (y) { return y.id === x.id; })[0];
      return it && !x.del ? { id: x.id, m: stampAfter(now, x.m), del: 1 } : x;
    });
    return { ok: true, data: C.normalize(d) };
  }

  // ---------- 9. Quote Builder: new quotes (AS-ADD8, GATE-PAR P4) ----------
  // quote.js applyQuotePrefill + commitSave: a NEW quote in status
  // draft with the next OFF-YYYY-NNN number of the year (nextNumber),
  // its lines as newItemObj (VAT 24 unless given), the client matched
  // by name (case ignored) or, unknown, made as quote.js's New client
  // with the name (and tax id). The data goes through
  // OrosQuoteCore.canonState (1.3, the app's own canonical form), so
  // opening Quote rewrites nothing. Undo removes the quote (and a client
  // it made, while no other quote uses it) while unchanged.
  function quoteCore() {
    if (root.OrosQuoteCore && root.OrosQuoteCore.canonState) return root.OrosQuoteCore;
    if (NODE) { try { return require("../quote/core.js"); } catch (e) { return null; } }
    return null;
  }
  function normQuote(x, w) {
    return normDraft(x, w, function (c) { return /^[A-Z]{3}$/.test(c); });
  }
  function qtBase(d) {
    var Q = quoteCore();
    if (d == null) return Q.canonState({ ver: Q.DATA_VER, om: 0, deleted: {}, quotes: [], clients: [], templates: [], payMethods: [] });
    return isObj(d) && Array.isArray(d.quotes) && Array.isArray(d.clients) && Array.isArray(d.templates) ? Q.canonState(d) : null;
  }
  function qtNum(d, year, n) {
    var re = /^OFF-(\d{4})-(\d+)$/, max = 0;
    d.quotes.forEach(function (q) { var m = re.exec(q.num || ""); if (m && +m[1] === year && +m[2] > max) max = +m[2]; });
    return "OFF-" + year + "-" + ("000" + (max + 1 + n)).slice(-3);
  }
  function qtClient(d, o) {
    var low = o.client.toLocaleLowerCase(), hit = null;
    if (!o.client) return null;
    d.clients.forEach(function (c) { if (!hit && String(c.name || "").trim().toLocaleLowerCase() === low) hit = c; });
    return hit;
  }
  function qtLines(o) {
    return o.lines.map(function (l) { return { code: "", desc: l.d, qty: l.q, price: l.p / 100, disc: 0, vat: l.vat !== undefined ? l.vat : 24 }; });
  }
  function qtTotal(lines) {
    var t = 0;
    lines.forEach(function (l) { var net = l.qty * l.price; t += net + net * l.vat / 100; });
    return Math.round(t * 100);
  }
  function qtPlan(d, items, ctx) {
    var Q = quoteCore();
    if (!Q) return bad("Quote is not available right now.");
    d = qtBase(d);
    if (!d) return notOpened("Quote");
    var e = room(d.quotes.length, items.length, 5000, "quotes", "Quote");
    if (e) return e;
    var year = +todayOf(ctx).slice(0, 4);
    return { ok: true, rows: items.map(function (o, i) {
      var cl = qtClient(d, o), ls = qtLines(o), cur = o.cur || "EUR", f = [], dup = null;
      d.quotes.forEach(function (q) {
        if (dup || q.status !== "draft" || (cl ? q.clientId !== cl.id : !!q.clientId) || q.items.length !== ls.length) return;
        if (q.items.every(function (it, k) { return it.desc === ls[k].desc && it.qty === ls[k].qty && it.price === ls[k].price; })) dup = { id: q.id, title: q.num, target: { quote: q.id } };
      });
      f.push(["num", qtNum(d, year, i)]);
      if (o.client) f.push(["client", o.client + (cl ? "" : " · " + (ctx && ctx.lang === "el" ? "νέος" : "new"))]);
      f.push(["date", o.date || todayOf(ctx)]);
      ls.forEach(function (l) { f.push(["line", l.desc + " · " + l.qty + " × " + l.price.toFixed(2) + " " + cur + " · " + l.vat + "%"]); });
      f.push(["amount", H.money(qtTotal(ls)) + " " + cur]);
      if (o.notes) f.push(["note", preview(o.notes, 120)]);
      return { title: o.client || o.lines[0].d, fields: f, dup: dup };
    }) };
  }
  function qtApply(d, items, now, skip, ctx) {
    var Q = quoteCore();
    d = qtBase(d);
    var today = todayOf(ctx, now), year = +today.slice(0, 4), s = stampAfter(now, d.om || 0);
    var taken = {}, made = [], undo = { app: "quote", t: "new", items: [] }, n = 0;
    ["quotes", "clients", "templates"].forEach(function (k) { d[k].forEach(function (x) { taken[x.id] = 1; }); });
    Object.keys(d.deleted).forEach(function (k) { taken[k] = 1; });
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var cl = qtClient(d, o), madeCl = "";
      if (!cl && o.client) {
        cl = { id: newIdIn(now, taken), name: o.client, email: "", phone: "", address: "", taxId: o.afm, mtime: s, pos: d.clients.length };
        d.clients.push(cl);
        madeCl = cl.id;
      }
      var q = { id: newIdIn(now, taken), num: qtNum(d, year, 0), clientId: cl ? cl.id : null, status: "draft", date: o.date || today,
                dueDate: "", currency: o.cur || "EUR", gDisc: 0, payment: "", notes: o.notes, instalments: [], mtime: s, pos: d.quotes.length };
      q.items = qtLines(o).map(function (l) { return { id: newIdIn(now, taken), code: l.code, desc: l.desc, qty: l.qty, price: l.price, disc: l.disc, vat: l.vat }; });
      d.quotes.push(q);
      n++;
      made.push({ i: i, id: q.id, title: q.num + (o.client ? " · " + o.client : ""), target: { quote: q.id }, cl: madeCl });
    });
    d.om = s;
    d = Q.canonState(d);
    made.forEach(function (m) {
      var q = d.quotes.filter(function (x) { return x.id === m.id; })[0], c = m.cl ? d.clients.filter(function (x) { return x.id === m.cl; })[0] : null;
      undo.items.push({ id: m.id, x: clone(q), cl: m.cl, cx: c ? clone(c) : null });
      delete m.cl;
    });
    return { ok: true, data: d, made: made, undo: undo };
  }
  function qtUndo(d, u, now) {
    var Q = quoteCore();
    if (!Q || !isObj(d) || !Array.isArray(d.quotes)) return bad("Quote has no quotes.");
    d = Q.canonState(d);
    var norm = function (x) { var y = clone(x); delete y.pos; return y; };
    var find = function (k, id) { return d[k].filter(function (x) { return x.id === id; })[0]; };
    for (var i = 0; i < u.items.length; i++) {
      var q = find("quotes", u.items[i].id);
      if (q && !unchanged(norm(q), norm(u.items[i].x))) return bad("A new quote was changed in Quote since; nothing was undone (delete it in Quote).");
    }
    var gone = {};
    u.items.forEach(function (it) { gone[it.id] = 1; });
    u.items.forEach(function (it) {
      var q = find("quotes", it.id);
      if (q) d.deleted[it.id] = stampAfter(now, Math.max(d.deleted[it.id] || 0, q.mtime || 0));
      var c = it.cl ? find("clients", it.cl) : null;
      var used = c && d.quotes.some(function (x) { return !gone[x.id] && x.clientId === c.id; });
      if (c && !used && unchanged(norm(c), norm(it.cx))) d.deleted[c.id] = stampAfter(now, Math.max(d.deleted[c.id] || 0, c.mtime || 0));
    });
    var dead = d.deleted;
    d.quotes = d.quotes.filter(function (x) { return !(dead[x.id] !== undefined && (x.mtime || 0) <= dead[x.id]); });
    d.clients = d.clients.filter(function (x) { return !(dead[x.id] !== undefined && (x.mtime || 0) <= dead[x.id]); });
    d.om = stampAfter(now, d.om || 0);
    return { ok: true, data: Q.canonState(d) };
  }

  // ---------- 10. Wiki: new articles (AS-ADD9, GATE-PAR P4 wave 2) ----------
  // wiki.js addArticles: an article { id, m, w, t, x, r, anc: [], alt:
  // [], s, c } through WikiCore.normArt, the data through merge(d,
  // null), and its first revision file on the orOS disk (revPath /
  // revFile, as Wiki writes it; res.disk, written after the data). A
  // title already in that wiki is refused (change it with change_item):
  // Wiki's links find an article by its title. The wiki is named, or
  // the only one; with none yet, the user opens Wiki once.
  function wikiCore() {
    if (root.WikiCore) return root.WikiCore;
    if (NODE) { try { return require("../wiki/core.js"); } catch (e) { return null; } }
    return null;
  }
  function normWikiArt(x, w) {
    var C = wikiCore();
    if (!C) return { err: "Wiki is not available right now." };
    if (!empty(x, "title") && typeof x.title !== "string") return { err: w + "title must be text." };
    var t = C.cleanTitle(x.title);
    if (!t) return { err: w + "title (the article's title) is required." };
    if (String(x.title).trim().length > 200) return { err: w + "title has more than 200 characters; Wiki keeps 200." };
    if (typeof x.text !== "string" || !x.text.trim()) return { err: w + "text (the article, in Wiki's Markdown) is required." };
    var tx = x.text.replace(/\r\n?/g, "\n");
    if (tx.length > C.MAX_TEXT) return { err: w + "text has " + tx.length + " characters; a Wiki article keeps " + C.MAX_TEXT + ". Split it into several articles." };
    var r = text1(x, "wiki", 80, w, "a wiki's name");
    if (r.err) return r;
    return { o: { t: t, x: tx, wiki: r.v }, key: fold(r.v) + "|" + C.fold(t) };
  }
  function wkBase(d) {
    var C = wikiCore();
    return d == null ? C.empty() : isObj(d) && Array.isArray(d.arts) && Array.isArray(d.wikis) ? C.merge(d, null) : null;
  }
  function wkWiki(C, d, name) {
    var ws = d.wikis;
    if (!ws.length) return { err: "Wiki has no wiki yet. Ask the user to open Wiki once." };
    if (!name) return ws.length === 1 ? { v: ws[0] } : { err: "wiki: the user has several wikis (" + ws.map(function (x) { return x.n || x.id; }).join(", ") + "); give wiki." };
    var hit = ws.filter(function (x) { return C.fold(x.n) === C.fold(name); });
    return hit.length ? { v: hit[0] } : { err: "wiki " + name + " is not one of the user's wikis: " + ws.map(function (x) { return x.n || x.id; }).join(", ") + "." };
  }
  function wkPlanOf(d, items) {
    var C = wikiCore(), out = [];
    var room0 = C.live(d).length;
    if (room0 + items.length > C.MAX_ARTS) return { err: "Wiki keeps " + C.MAX_ARTS + " articles and has " + room0 + "; add fewer." };
    for (var i = 0; i < items.length; i++) {
      var wr = wkWiki(C, d, items[i].wiki);
      if (wr.err) return { err: "items[" + i + "]: " + wr.err };
      var idx = C.titleIndex(d, wr.v.id), had = idx[C.fold(items[i].t)];
      if (had) return { err: "items[" + i + "]: " + (wr.v.n || "the wiki") + " already has an article “" + had.t + "”. Change it with change_item (find it with search_data in wiki), or give another title." };
      out.push(wr.v);
    }
    return { w: out };
  }
  function wkPlan(d, items) {
    var C = wikiCore();
    if (!C) return bad("Wiki is not available right now.");
    d = wkBase(d);
    if (!d) return notOpened("Wiki");
    var r = wkPlanOf(d, items);
    if (r.err) return bad(r.err);
    return { ok: true, rows: items.map(function (o, i) {
      var f = [];
      if (d.wikis.length > 1) f.push(["wiki", r.w[i].n]);
      f.push(["text", preview(C.snippet(o.x, 300) || o.x, 300)]);
      return { title: o.t, fields: f, dup: null };
    }) };
  }
  function wkApply(d, items, now, skip) {
    var C = wikiCore();
    d = wkBase(d);
    var r = wkPlanOf(d, items);
    if (r.err) return bad(r.err);
    var made = [], undo = { app: "wiki", t: "new", items: [] }, disk = [];
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var m = stampAfter(now + i, 0);
      var a = C.normArt({ id: C.uid("a"), m: m, w: r.w[i].id, t: o.t, x: o.x, r: C.uid("r"), anc: [], alt: [], c: m });
      d.arts.push(a);
      made.push({ i: i, id: a.id, title: a.t, target: { w: a.w, a: a.id } });
    });
    d = C.merge(d, null);
    made.forEach(function (m) {
      var a = C.byId(d, m.id);
      undo.items.push({ id: a.id, r: a.r });
      disk.push({ path: C.revPath(a.id, a.m, a.r), text: JSON.stringify(C.revFile(a, "", "")) });
    });
    return { ok: true, data: d, made: made, undo: undo, disk: disk };
  }
  function wkUndo(d, u, now) {
    var C = wikiCore();
    if (!C || !isObj(d) || !Array.isArray(d.arts)) return bad("Wiki has no articles.");
    d = C.merge(d, null);
    for (var i = 0; i < u.items.length; i++) {
      var a = C.byId(d, u.items[i].id);
      if (a && a.r !== u.items[i].r) return bad("A new article was changed in Wiki since; nothing was undone (delete it in Wiki).");
    }
    u.items.forEach(function (it) {
      var a = C.byId(d, it.id);
      if (a) d.tombs[a.id] = stampAfter(now, Math.max(d.tombs[a.id] || 0, a.m));
    });
    return { ok: true, data: C.merge(d, null) };
  }

  // ---------- 11. Flashcards: new notes (AS-ADD9, GATE-PAR P4 wave 2) ----------
  // The data is the Assistant's "disk:flashcards" copy (assistant.js
  // fcPrep): { slice, notes, own: { path, dev, items } }. A new note
  // goes into the Assistant's OWN notes file (its own device id, so one
  // writer per file still holds, FLASHCARDS v1), as Flashcards' Add
  // note: basic (front, back), rev (both: true, a reversed card too) or
  // cloze (text with {{c1::gaps}}, back = its extra), in a deck named
  // (else the default deck), with the user's tags. Undo writes a
  // deletion version of each note while unchanged.
  function fcCore() {
    if (root.FlashcardsCore) return root.FlashcardsCore;
    if (NODE) { try { return require("../flashcards/core.js"); } catch (e) { return null; } }
    return null;
  }
  function normCard(x, w) {
    var C = fcCore();
    if (!C) return { err: "Flashcards is not available right now." };
    var L = C.LIMITS.field, o = {};
    var sides = ["front", "back", "cloze"];
    for (var i = 0; i < sides.length; i++) {
      var k = sides[i];
      if (!empty(x, k) && typeof x[k] !== "string") return { err: w + k + " must be text." };
      o[k] = empty(x, k) ? "" : x[k].replace(/\r\n?/g, "\n").trim();
      if (o[k].length > L) return { err: w + k + " has " + o[k].length + " characters; a card side keeps " + L + "." };
    }
    if (o.cloze) {
      if (!C.clozeNums(o.cloze).length) return { err: w + "cloze needs at least one gap, like {{c1::word}}." };
      if (o.front) return { err: w + "give either cloze or front and back, not both." };
    } else if (!o.front || !o.back) return { err: w + "a card needs front and back (or cloze with {{c1::gaps}})." };
    if (!empty(x, "both") && typeof x.both !== "boolean") return { err: w + "both must be true or false." };
    o.both = x.both === true && !o.cloze;
    var r = text1(x, "deck", C.LIMITS.name, w, "a deck's name");
    if (r.err) return r;
    o.deck = r.v;
    r = names(x, "labels", C.LIMITS.tags, C.LIMITS.tag, w, "a tag");
    if (r.err) return r;
    o.tags = C.normTags(r.v);
    return { o: o, key: fold(o.cloze || o.front) + "|" + fold(o.back) };
  }
  function fcDeckOf(C, d, name) {
    var decks = C.normalize(d.slice).decks;
    if (!name) return { v: C.DEFAULT_DECK };
    var f = fold(name), hit = decks.filter(function (k) { return fold(k.n) === f; })[0];
    if (hit) return { v: hit.id };
    if (f === "default") return { v: C.DEFAULT_DECK };
    return { err: "Flashcards has no deck named “" + name + "”" + (decks.length ? " (its decks: " + decks.map(function (k) { return k.n; }).join(", ") + ")" : "") + ". New decks are made in Flashcards." };
  }
  function fcLive(d) {
    return (Array.isArray(d.notes) ? d.notes : []).filter(function (n) { return isObj(n) && !n.del; });
  }
  function fcPlanOf(C, d, items) {
    if (!isObj(d) || !isObj(d.slice)) return { err: "Flashcards has not been opened on this device yet. Ask the user to open Flashcards once." };
    if (!isObj(d.own) || typeof d.own.path !== "string" || !d.own.path) return { err: "The orOS disk is not reachable, so no Flashcards notes can be added now." };
    var have = fcLive(d).length;
    if (have + items.length > C.LIMITS.notes) return { err: "Flashcards keeps " + C.LIMITS.notes + " notes and has " + have + "; add fewer." };
    var dk = [];
    for (var i = 0; i < items.length; i++) {
      var r = fcDeckOf(C, d, items[i].deck);
      if (r.err) return { err: "items[" + i + "]: " + r.err };
      dk.push(r.v);
    }
    return { dk: dk };
  }
  function fcNoteOf(o, id, m, dk) {
    var n = { id: id, m: m, dk: dk, k: o.cloze ? "cloze" : o.both ? "rev" : "basic", tg: o.tags };
    n.f = o.cloze ? { x: o.cloze, e: o.back } : { q: o.front, a: o.back };
    return n;
  }
  function fcPlan(d, items) {
    var C = fcCore();
    if (!C) return bad("Flashcards is not available right now.");
    var r = fcPlanOf(C, d, items);
    if (r.err) return bad(r.err);
    var decks = C.normalize(d.slice).decks, live = fcLive(d);
    return { ok: true, rows: items.map(function (o, i) {
      var f = [], dup = null, q = o.cloze || o.front;
      live.forEach(function (n) {
        if (dup) return;
        var nq = n.k === "cloze" ? n.f.x : n.f.q;
        if (fold(nq) === fold(q)) dup = { id: n.id, title: nq.slice(0, 80), target: { note: n.id } };
      });
      var dn = decks.filter(function (k) { return k.id === r.dk[i]; })[0];
      if (dn) f.push(["deck", dn.n]);
      if (o.cloze) { if (o.back) f.push(["back", preview(o.back, 200)]); }
      else f.push(["back", preview(o.back, 200)]);
      if (o.both) f.push(["kind", "rev"]);
      if (o.tags.length) f.push(["labels", o.tags.join(", ")]);
      return { title: preview(q, 120), fields: f, dup: dup };
    }) };
  }
  function fcApply(d, items, now, skip) {
    var C = fcCore();
    var r = fcPlanOf(C, d, items);
    if (r.err) return bad(r.err);
    d = clone(d);
    var made = [], undo = { app: "flashcards", t: "new", items: [] }, vers = [], taken = {};
    fcLive(d).concat(d.own.items || []).forEach(function (n) { if (isObj(n)) taken[n.id] = 1; });
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var id;
      do { id = C.newId("n", now, rnd(8)); } while (taken[id]);
      taken[id] = 1;
      var n = C.normNote(fcNoteOf(o, id, stampAfter(now, 0), r.dk[i]));
      vers.push(n);
      made.push({ i: i, id: id, title: (o.cloze || o.front).slice(0, 80), target: { note: id } });
      undo.items.push({ id: id, x: clone(n) });
    });
    d.own.items = C.mergeNotes(d.own.items, vers);
    d.notes = C.mergeNotes(d.notes, vers);
    return { ok: true, data: d, made: made, undo: undo };
  }
  function fcUndo(d, u, now) {
    var C = fcCore();
    if (!C || !isObj(d) || !isObj(d.own) || !d.own.path) return bad("The orOS disk is not reachable; nothing was undone.");
    d = clone(d);
    var map = C.foldNotes({}, d.notes), dels = [];
    for (var i = 0; i < u.items.length; i++) {
      var n = map[u.items[i].id];
      if (n && !n.del && JSON.stringify(n) !== JSON.stringify(u.items[i].x)) return bad("A new note was changed in Flashcards since; nothing was undone (delete it in Flashcards).");
    }
    u.items.forEach(function (it) {
      var n = map[it.id];
      if (n && !n.del) dels.push({ id: it.id, m: stampAfter(now, n.m), del: 1 });
    });
    d.own.items = C.mergeNotes(d.own.items, dels);
    d.notes = C.mergeNotes(d.notes, dels);
    return { ok: true, data: d };
  }

  // ---------- 12. Split: a shared expense (AS-ADD9, GATE-PAR P4 wave 2) ----------
  // split.js normExp shape, split equally ("eq"): one payer (the user's
  // own person in the group when left out), shared by the people named
  // (all of the group when left out), in the group's currency. Only the
  // user's own groups are in oros-split-data (household groups live in
  // the household); an archived group takes nothing. The record is the
  // canonical form (keys in normExp's order, lists by id), so opening
  // Split rewrites nothing. Undo: a tombstone "exp:<id>" while unchanged.
  var SPL = { title: 60, note: 140, max: 100000000000, exp: 3000, people: 30 };
  var SPL_CATS = ["food", "groc", "stay", "trans", "bills", "fun", "other"];
  var SPL_CAT_NAMES = { food: ["food", "eating out", "restaurant", "φαγητό"], groc: ["groceries", "supermarket", "ψώνια"], stay: ["stay", "hotel", "accommodation", "rent", "διαμονή"],
                        trans: ["transport", "travel", "fuel", "taxi", "μεταφορά"], bills: ["bills", "utilities", "λογαριασμοί"], fun: ["fun", "entertainment", "διασκέδαση"], other: ["other", "άλλο"] };
  function normSplit(x, w) {
    var r = text1(x, "title", SPL.title, w, "an expense's title");
    if (r.err) return r;
    if (!r.v) return { err: w + "title (what was paid for) is required." };
    var o = { t: r.v.replace(/\s+/g, " ") };
    var a = cents(x, "amount", SPL.max, w);
    if (a.err) return a;
    if (!a.v) return { err: w + "amount (more than 0, in the group's currency) is required." };
    o.a = a.v;
    r = dateOf(x, "date", w);
    if (r.err) return r;
    o.d = r.v || "";
    o.c = "other";
    if (!empty(x, "category")) {
      var f = fold(String(x.category)), hit = "";
      SPL_CATS.forEach(function (c) { if (!hit && (fold(c) === f || SPL_CAT_NAMES[c].some(function (n) { return fold(n) === f; }))) hit = c; });
      if (!hit) return { err: w + "category for Split is one of: food, groceries, stay, transport, bills, fun, other." };
      o.c = hit;
    }
    r = text1(x, "note", SPL.note, w, "an expense's note");
    if (r.err) return r;
    o.n = r.v.replace(/\s+/g, " ");
    r = text1(x, "split_group", 40, w, "a Split group's name");
    if (r.err) return r;
    o.g = r.v;
    r = text1(x, "paid_by", 30, w, "a person's name");
    if (r.err) return r;
    o.by = r.v;
    r = names(x, "shared_by", SPL.people, 30, w, "a person's name");
    if (r.err) return r;
    o.sh = r.v;
    return { o: o, key: fold(o.t) + "|" + o.a };
  }
  function spLive(d, list, tomb) {
    var tombs = isObj(d.tombs) ? d.tombs : {};
    return (Array.isArray(d[list]) ? d[list] : []).filter(function (x) {
      return isObj(x) && typeof x.id === "string" && !(typeof tombs[tomb + ":" + x.id] === "number" && tombs[tomb + ":" + x.id] >= x.m);
    });
  }
  function spGid(id) { var i = id.indexOf("."); return i < 0 ? id : id.slice(0, i); }
  function spGroup(d, name) {
    var gs = spLive(d, "groups", "grp").filter(function (g) { return !g.arch; });
    if (!gs.length) return { err: "Split has no group yet (or only shared or archived ones). Groups are made in Split." };
    if (!name) {
      if (gs.length === 1) return { v: gs[0] };
      return { err: "Split has several groups (" + gs.map(function (g) { return g.n; }).join(", ") + "): give split_group." };
    }
    var f = fold(name), hit = gs.filter(function (g) { return fold(g.n) === f; })[0];
    return hit ? { v: hit } : { err: "Split has no group named “" + name + "” (its groups: " + gs.map(function (g) { return g.n; }).join(", ") + "). New groups are made in Split." };
  }
  function spResolve(d, items, ctx) {
    var out = [], count = {};
    (Array.isArray(d.exp) ? d.exp : []).concat(Array.isArray(d.pay) ? d.pay : []).forEach(function (x) { if (isObj(x) && typeof x.id === "string") count[spGid(x.id)] = (count[spGid(x.id)] || 0) + 1; });
    for (var i = 0; i < items.length; i++) {
      var o = items[i], w = "items[" + i + "]: ";
      var g = spGroup(d, o.g);
      if (g.err) return { err: w + g.err };
      g = g.v;
      var ppl = spLive(d, "people", "per").filter(function (p) { return spGid(p.id) === g.id; });
      if (!ppl.length) return { err: w + "the group " + g.n + " has nobody in it yet. People are added in Split." };
      var byName = function (n) { var f = fold(n); return ppl.filter(function (p) { return fold(p.n) === f; })[0] || null; };
      var payer = null;
      if (o.by) {
        payer = byName(o.by);
        if (!payer) return { err: w + "the group " + g.n + " has nobody named “" + o.by + "” (its people: " + ppl.map(function (p) { return p.n; }).join(", ") + ")." };
      } else {
        var me = (Array.isArray(d.mine) ? d.mine : []).filter(function (m) { return isObj(m) && m.id === g.id; })[0];
        payer = me && me.v ? ppl.filter(function (p) { return p.id === me.v; })[0] || null : null;
        if (!payer) return { err: w + "who paid? Give paid_by (the user has not said who they are in " + g.n + ")." };
      }
      var among = [];
      if (o.sh.length) {
        for (var j = 0; j < o.sh.length; j++) {
          var p = byName(o.sh[j]);
          if (!p) return { err: w + "the group " + g.n + " has nobody named “" + o.sh[j] + "” (its people: " + ppl.map(function (q) { return q.n; }).join(", ") + ")." };
          if (among.indexOf(p) < 0) among.push(p);
        }
      } else among = ppl.slice();
      count[g.id] = (count[g.id] || 0) + 1;
      if (count[g.id] > SPL.exp) return { err: w + "the group " + g.n + " keeps " + SPL.exp + " entries; add fewer." };
      var day = o.d || todayOf(ctx);
      var dup = null;
      spLive(d, "exp", "exp").forEach(function (x) {
        if (!dup && spGid(x.id) === g.id && x.d === day && x.a === o.a && fold(x.t) === fold(o.t)) dup = { id: x.id, title: x.t, target: { exp: x.id } };
      });
      out.push({ g: g, payer: payer, among: among, d: day, dup: dup });
    }
    return { res: out };
  }
  function spPlan(d, items, ctx) {
    if (!isObj(d) || !Array.isArray(d.groups)) return notOpened("Split");
    var r = spResolve(d, items, ctx);
    if (r.err) return bad(r.err);
    return { ok: true, rows: items.map(function (o, i) {
      var x = r.res[i];
      var f = [["group", x.g.n], ["amount", H.money(o.a) + " " + (x.g.cur || "EUR")], ["date", x.d], ["paid_by", x.payer.n],
               ["shared_by", x.among.map(function (p) { return p.n; }).join(", ")]];
      if (o.n) f.push(["note", o.n]);
      return { title: o.t, fields: f, dup: x.dup };
    }) };
  }
  function spApply(d, items, now, skip, ctx) {
    if (!isObj(d) || !Array.isArray(d.groups)) return notOpened("Split");
    var r = spResolve(d, items, ctx);
    if (r.err) return bad(r.err);
    d = clone(d);
    if (!Array.isArray(d.exp)) d.exp = [];
    if (!isObj(d.tombs)) d.tombs = {};
    var taken = {}, made = [], undo = { app: "split", t: "new", items: [] };
    d.exp.concat(d.pay || []).forEach(function (x) { if (isObj(x) && typeof x.id === "string") taken[x.id] = 1; });
    Object.keys(d.tombs).forEach(function (k) { taken[k.replace(/^[a-z]+:/, "")] = 1; });
    items.forEach(function (o, i) {
      if (skip && skip[i]) return;
      var x = r.res[i], id;
      do { id = x.g.id + "." + (Math.floor(now).toString(36) + rnd(4)).slice(0, 24); } while (taken[id]);
      taken[id] = 1;
      var by = {}, w = {};
      by[x.payer.id] = o.a;
      x.among.map(function (p) { return p.id; }).sort(cmpStr).forEach(function (pid) { w[pid] = 1; });
      // split.js normExp: id, m, t, a, d, c, by, mode, w, n
      var e = { id: id, m: stampAfter(now, 0), t: o.t, a: o.a, d: x.d, c: o.c, by: by, mode: "eq", w: w, n: o.n };
      d.exp.push(e);
      made.push({ i: i, id: id, title: o.t, target: { exp: id } });
      undo.items.push({ id: id, x: clone(e) });
    });
    sortById(d.exp);
    return { ok: true, data: d, made: made, undo: undo };
  }
  function spUndo(d, u, now) {
    if (!isObj(d) || !Array.isArray(d.exp)) return bad("Split has no expenses; nothing was undone.");
    d = clone(d);
    if (!isObj(d.tombs)) d.tombs = {};
    for (var i = 0; i < u.items.length; i++) {
      var x = byId(d.exp, u.items[i].id);
      if (x && !unchanged(x, u.items[i].x)) return bad("A new expense was changed in Split since; nothing was undone (delete it in Split).");
    }
    u.items.forEach(function (it) {
      var x = byId(d.exp, it.id);
      if (!x) return;
      d.tombs["exp:" + it.id] = stampAfter(now, x.m);
      d.exp = d.exp.filter(function (y) { return !(isObj(y) && y.id === it.id); });
    });
    return { ok: true, data: d };
  }

  A.extend({
    habits: { key: "oros-habits-data", name: "Habits", norm: normHabit, plan: hbPlan, apply: hbApply, undo: hbUndo },
    fitness: { key: "oros-fitness-data", name: "Workouts", norm: normWorkout, plan: ftPlan, apply: ftApply, undo: ftUndo },
    garage: { key: "oros-garage-data", name: "Garage", norm: normGarage, plan: gPlan, apply: gApply, undo: gUndo },
    plants: { key: "oros-plants-data", name: "Plant Care", norm: normPlant, plan: plPlan, apply: plApply, undo: plUndo },
    petcare: { key: "oros-petcare-data", name: "Pet Health Book", norm: normPet, plan: pcPlan, apply: pcApply, undo: pcUndo },
    shelf: { key: "oros-shelf-data", name: "Media Shelf", norm: normMedia, plan: shPlan, apply: shApply, undo: shUndo },
    publish: { key: "oros-publish-data", name: "Publishing", norm: normPub, plan: pbPlan, apply: pbApply, undo: pbUndo },
    invoices: { key: "oros-invoices-data", name: "Invoices", norm: normInv, plan: ivPlan, apply: ivApply, undo: ivUndo },
    quote: { key: "oros-quote-data", name: "Quote", norm: normQuote, plan: qtPlan, apply: qtApply, undo: qtUndo },
    wiki: { key: "oros-wiki-data", name: "Wiki", norm: normWikiArt, plan: wkPlan, apply: wkApply, undo: wkUndo },
    flashcards: { key: "disk:flashcards", name: "Flashcards", norm: normCard, plan: fcPlan, apply: fcApply, undo: fcUndo },
    split: { key: "oros-split-data", name: "Split", norm: normSplit, plan: spPlan, apply: spApply, undo: spUndo }
  });
  var api = { CORES: CORES, FT_ACT: FT_ACT, PC_KIND: PC_KIND, SH_TYPES: SH_TYPES, PB_ST: PB_ST, PB_FMT: PB_FMT };
  if (NODE) module.exports = api;
  if (root && root.document) root.OrosAssistAdd3 = api;
})(typeof window !== "undefined" ? window : this);
