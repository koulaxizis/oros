// ============================================================
// orOS Habits — .oroshabits file (habits/package.js,
// window.OrosHabitsPackage). The descriptor of Habits for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// every habit and its days (ticks, amounts, skips, notes) in one orOS
// bundle; opening one ADDS what this device lacks, with its ids. Pure
// (no DOM, no storage), so the app and `node --test` run the same
// code. The rows are checked by the app's own model.js (normHabit,
// normComp) and merged by its own sync merge (mergeData).
//   DESC                     the kit descriptor (merge: model.js
//                            mergeData, pure; only the records the kit
//                            lets through reach it, so a day already
//                            here keeps its local values)
//   DESC.norm(data)          a file's data → { ver, habits, comps }:
//                            known fields only, typed and capped; a
//                            day's id must be "<habitId>|<date>"; no
//                            stamp more than 5 minutes in the future
//   DESC.strip(state)        the slice → { ver, habits, comps }: no
//                            deleted habits (del), no days of a habit
//                            that is not in the file, no empty days,
//                            no Steps setting (set)
//   DESC.tombIds(state)      the ids of the deleted habits
//   DESC.previews(state, l)  habits.md (readable) and checkins.csv
//   forLocal(getLocal)       DESC whose norm also drops the days of a
//                            habit deleted on this device (the app's
//                            ui() uses it; the kit keeps that habit
//                            deleted, so its days must not come back)
//   kindOf(id, state)        "habit" | "comp" | ""
// Data (core.js, v2): habit { id, name, icon, color, days, mtime, del,
// num?, per?, rem? }; comp { id: "<habitId>|<ymd>", habitId, date,
// mtime, del (= not ticked), v?: { <device>: [n, m] }, sk?: [0|1, m],
// nt?: [text, m] }.
// ============================================================
(function (root) {
  "use strict";

  var M = root && root.OrosHabitsModel;
  if (!M && typeof require === "function") M = require("./model.js");

  var LIM = { habits: 1000, comps: 100000 };
  var FUTURE = 5 * 60 * 1000;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function line(v) { return String(v).replace(/[\u0000-\u001f\u007f]/g, " "); }
  function text(v) { return String(v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " "); }
  function okId(v) { return typeof v === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v); }

  // the stamps inside a day (value shares, skip, note), which the kit's
  // clamp does not reach: at most now + 5 minutes
  function clampIn(c, lim) {
    if (c.v) Object.keys(c.v).forEach(function (k) { if (c.v[k][1] > lim) c.v[k][1] = lim; });
    if (c.sk && c.sk[1] > lim) c.sk[1] = lim;
    if (c.nt && c.nt[1] > lim) c.nt[1] = lim;
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var lim = Date.now() + FUTURE;
    var out = { ver: M.DATA_VER, habits: [], comps: [] }, seenH = {}, seenC = {};
    (Array.isArray(data.habits) ? data.habits : []).slice(0, LIM.habits * 2).forEach(function (raw) {
      if (!isObj(raw) || !okId(raw.id) || seenH[raw.id] || out.habits.length >= LIM.habits) return;
      var h = M.normHabit(raw);
      if (!h) return;
      h.name = line(h.name).trim();
      if (!h.name && !h.del) return;
      if (h.num) h.num.u = line(h.num.u);
      seenH[h.id] = 1;
      out.habits.push(h);
    });
    (Array.isArray(data.comps) ? data.comps : []).slice(0, LIM.comps * 2).forEach(function (raw) {
      if (!isObj(raw) || seenC[raw.id] || out.comps.length >= LIM.comps) return;
      var c = M.normComp(raw);
      if (!c || !okId(c.habitId) || c.id !== c.habitId + "|" + c.date) return;
      if (c.nt) c.nt[0] = text(c.nt[0]);
      clampIn(c, lim);
      seenC[c.id] = 1;
      out.comps.push(c);
    });
    return out;
  }

  function empty(c) { return c.del && !c.v && !(c.sk && c.sk[0] === 1) && !(c.nt && c.nt[0]); }
  function strip(state) {
    var s = isObj(state) ? state : {}, live = {};
    var habits = (Array.isArray(s.habits) ? s.habits : []).filter(function (h) {
      if (!isObj(h) || h.del) return false;
      live[h.id] = 1;
      return true;
    });
    var comps = (Array.isArray(s.comps) ? s.comps : []).filter(function (c) {
      return isObj(c) && live[c.habitId] === 1 && !empty(c);
    });
    return JSON.parse(JSON.stringify({ ver: M.DATA_VER, habits: habits, comps: comps }));
  }
  function tombIds(state) {
    var out = [];
    if (isObj(state) && Array.isArray(state.habits)) state.habits.forEach(function (h) { if (isObj(h) && h.del) out.push(h.id); });
    return out;
  }

  // ---------- previews ----------
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? '"' + (/^[=+\-@\t]/.test(s) ? "'" : "") + s.replace(/"/g, '""') + '"' : s;
  }
  function sum(c) {
    var s = 0;
    if (c.v) Object.keys(c.v).forEach(function (k) { s += c.v[k][0]; });
    return Math.round(s * 100) / 100;
  }
  function dayDone(h, c) {
    if (!h.num) return !c.del;
    if (!c.v) return false;
    return h.num.c === "le" ? sum(c) <= h.num.t : sum(c) >= h.num.t;
  }
  var WD = { en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], el: ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"] };
  function previews(state, lang) {
    var el = lang === "el", byId = {}, count = {};
    var habits = (state.habits || []).slice().sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    habits.forEach(function (h) { byId[h.id] = h; count[h.id] = 0; });
    var comps = (state.comps || []).filter(function (c) { return byId[c.habitId]; }).sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : (a.habitId < b.habitId ? -1 : 1));
    });
    var csv = [["date", "habit", "done", "value", "unit", "skipped", "note"].join(",")];
    comps.forEach(function (c) {
      var h = byId[c.habitId], done = dayDone(h, c);
      if (done) count[h.id]++;
      csv.push([c.date, h.name, done ? "yes" : "no", h.num && c.v ? sum(c) : "", h.num ? h.num.u : "",
                c.sk && c.sk[0] === 1 ? "yes" : "", c.nt ? c.nt[0] : ""].map(csvCell).join(","));
    });
    var md = ["# " + (el ? "Συνήθειες" : "Habits"), ""];
    habits.forEach(function (h) {
      var bits = [];
      if (h.per) bits.push(h.per[1] + "× / " + (h.per[0] === "w" ? (el ? "εβδομάδα" : "week") : (el ? "μήνα" : "month")));
      else if (!h.days.length) bits.push(el ? "οποιαδήποτε μέρα" : "any day");
      else if (h.days.length === 7) bits.push(el ? "κάθε μέρα" : "every day");
      else bits.push(h.days.map(function (d) { return WD[el ? "el" : "en"][d]; }).join(", "));
      if (h.num) bits.push((h.num.c === "le" ? "≤ " : "≥ ") + h.num.t + (h.num.u ? " " + h.num.u : ""));
      bits.push((el ? "ολοκληρώσεις: " : "check-offs: ") + count[h.id]);
      md.push("- " + h.name.replace(/\s+/g, " ") + " (" + bits.join(" · ") + ")");
    });
    return { "habits.md": md.join("\n") + "\n", "checkins.csv": csv.join("\r\n") + "\r\n" };
  }

  // What an id names in a state (Undo removes each the right way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {};
    if ((s.habits || []).some(function (h) { return h.id === id; })) return "habit";
    if ((s.comps || []).some(function (c) { return c.id === id; })) return "comp";
    return "";
  }

  var DESC = {
    app: "habits", title: "Habits", slice: "habits", ext: ".oroshabits", mime: "application/x-oros-habits",
    colls: {
      habits: { shape: "array", id: "id", stamp: "mtime" },
      comps: { shape: "array", id: "id", stamp: "mtime" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (local, remote) { return M.mergeData(local, remote); }
  };

  function forLocal(getLocal) {
    var d = {};
    Object.keys(DESC).forEach(function (k) { d[k] = DESC[k]; });
    d.norm = function (data) {
      var out = norm(data), dead = {};
      if (!out) return out;
      tombIds(getLocal()).forEach(function (id) { dead[id] = 1; });
      out.comps = out.comps.filter(function (c) { return dead[c.habitId] !== 1; });
      return out;
    };
    return d;
  }

  var api = { DESC: DESC, forLocal: forLocal, kindOf: kindOf, LIM: LIM };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosHabitsPackage = api;
})(typeof window !== "undefined" ? window : this);
