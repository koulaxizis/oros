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
  function normPub(x, w) {
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
    var who = [["by", "a"], ["translator", "t"], ["illustrator", "i"], ["editor", "e"]];
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
    var isbns = {};
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
      o.fmts.push(fo);
    }
    var by = ppl.filter(function (q) { return q.r === "a"; }).map(function (q) { return fold(q.n); }).join(",");
    return { o: o, key: fold(o.t) + "|" + by };
  }
  function pbBase(d) {
    var C = pubCore();
    return d == null ? C.empty() : isObj(d) && (d.titles == null || Array.isArray(d.titles)) ? C.normalize(d) : null;
  }
  function pbPlan(d, items) {
    var C = pubCore();
    if (!C) return bad("Publishing is not available right now.");
    d = pbBase(d);
    if (!d) return notOpened("Publishing");
    var e = room(d.titles.length, items.length, PB.max, "titles", "Publishing");
    if (e) return e;
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
      f.push(["status", keyOf(PB_ST, o.st)]);
      if (o.rel) f.push([o.plan ? "rel" : "release", o.rel]);
      if (o.lang) f.push(["lang", o.lang]);
      o.fmts.forEach(function (x) {
        f.push(["format", keyOf(PB_FMT, x.k) + (x.price ? "|" + x.price.toFixed(2) + " " + d.set.cur : "")]);
        if (x.isbn) f.push(["isbn", C.hyphen(x.isbn, d.blocks)]);
        if (x.pages) f.push(["pages", String(x.pages)]);
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
                  fmts: o.fmts.map(function (f) { return { id: newIdIn(now, taken), k: f.k, isbn: f.isbn, price: f.price, pages: f.pages }; }),
                  blurb: o.blurb, notes: o.notes };
      if (o.plan) row.plan = C.makePlan(o.rel, [], function () { return newIdIn(now, taken); });
      d = C.put(d, "titles", row, s);
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
      if (x) d = C.remove(d, "titles", it.id, stampAfter(now, x.m));
    });
    return { ok: true, data: C.normalize(d) };
  }

  A.extend({
    habits: { key: "oros-habits-data", name: "Habits", norm: normHabit, plan: hbPlan, apply: hbApply, undo: hbUndo },
    fitness: { key: "oros-fitness-data", name: "Workouts", norm: normWorkout, plan: ftPlan, apply: ftApply, undo: ftUndo },
    garage: { key: "oros-garage-data", name: "Garage", norm: normGarage, plan: gPlan, apply: gApply, undo: gUndo },
    plants: { key: "oros-plants-data", name: "Plant Care", norm: normPlant, plan: plPlan, apply: plApply, undo: plUndo },
    petcare: { key: "oros-petcare-data", name: "Pet Health Book", norm: normPet, plan: pcPlan, apply: pcApply, undo: pcUndo },
    shelf: { key: "oros-shelf-data", name: "Media Shelf", norm: normMedia, plan: shPlan, apply: shApply, undo: shUndo },
    publish: { key: "oros-publish-data", name: "Publishing", norm: normPub, plan: pbPlan, apply: pbApply, undo: pbUndo }
  });
  var api = { CORES: CORES, FT_ACT: FT_ACT, PC_KIND: PC_KIND, SH_TYPES: SH_TYPES, PB_ST: PB_ST, PB_FMT: PB_FMT };
  if (NODE) module.exports = api;
  if (root && root.document) root.OrosAssistAdd3 = api;
})(typeof window !== "undefined" ? window : this);
