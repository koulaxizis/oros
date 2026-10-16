// ============================================================
// orOS Timesheet — .oroshours file (timesheet/package.js,
// window.OrosTimesheetPackage). The descriptor of Timesheet for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every client, project and finished time entry in one orOS
// bundle; opening one ADDS what this device lacks, with its ids.
// Pure (no DOM, no storage), so the app and `node --test` run the
// same code.
//   DESC                     the kit descriptor; merge = core.js
//                            mergeTimesheet (pure, the sync slice's
//                            own: per id, newer m wins)
//   DESC.norm(data)          a file's data → the slice shape through
//                            core.js normalize (known fields only,
//                            typed, text cleaned and capped), at most
//                            LIM records per list
//   DESC.strip(state)        the slice → { ver, clients, projects,
//                            entries, prefs }: no tombstones (del), no
//                            prefs stamp (pm) and no RUNNING entry
//                            (e === 0): a running timer belongs to the
//                            device it runs on, so the file holds
//                            finished time only. Its device-local
//                            state (time away, "it's fine", the
//                            draft, the open tab and report filters)
//                            lives outside the slice and never comes in
//   DESC.tombIds(state)      the ids of the tombstones (del: 1)
//   DESC.previews(state, l)  hours.csv: core.js toCsv over every day
//                            of the file (its formula guard, ; and BOM)
//   kindOf(id, state)        "client" | "project" | "entry" | ""
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.orosTimesheetCore;
  var LIM = { clients: 5000, projects: 5000, entries: 200000 };
  var LISTS = ["clients", "projects", "entries"];

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function capped(v, n) { return Array.isArray(v) ? v.slice(0, n) : []; }

  function norm(data) {
    if (!isObj(data)) return null;
    // core.js's own merge with itself: every record through normClient /
    // normProject / normEntry (bad ids, times and fields dropped),
    // tombstones kept so strip and tombIds see them, sorted by id
    return C.normalize({
      ver: C.DATA_VER,
      clients: capped(data.clients, LIM.clients),
      projects: capped(data.projects, LIM.projects),
      entries: capped(data.entries, LIM.entries),
      prefs: isObj(data.prefs) ? data.prefs : null,
      pm: 0
    });
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    var keep = function (x) { return isObj(x) && !x.del; };
    return JSON.parse(JSON.stringify({
      ver: C.DATA_VER,
      clients: (Array.isArray(s.clients) ? s.clients : []).filter(keep),
      projects: (Array.isArray(s.projects) ? s.projects : []).filter(keep),
      entries: (Array.isArray(s.entries) ? s.entries : []).filter(function (x) { return keep(x) && x.e !== 0; }),
      prefs: C.normPrefs(s.prefs)
    }));
  }
  function tombIds(state) {
    var out = [];
    if (!isObj(state)) return out;
    LISTS.forEach(function (k) {
      (Array.isArray(state[k]) ? state[k] : []).forEach(function (x) {
        if (isObj(x) && x.del && typeof x.id === "string") out.push(x.id);
      });
    });
    return out;
  }

  // hours.csv: the report's CSV (toCsv) from the first to the last day
  // with time in the file.
  function previews(state, lang) {
    var d = norm(state);
    if (!d) return {};
    var lo = Infinity, hi = 0;
    d.entries.forEach(function (x) {
      if (x.del || x.e === 0) return;
      if (x.s < lo) lo = x.s;
      if (x.e > hi) hi = x.e;
    });
    if (!isFinite(lo) || !hi) return {};
    return { "hours.csv": C.toCsv(d, C.dayKeyOf(lo), C.dayKeyOf(hi), {}, hi, lang === "el" ? "el" : "en") };
  }

  // What an id names in a state (Undo tombstones it in that list).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, k = "";
    [["clients", "client"], ["projects", "project"], ["entries", "entry"]].forEach(function (p) {
      (Array.isArray(s[p[0]]) ? s[p[0]] : []).forEach(function (x) { if (!k && isObj(x) && x.id === id && !x.del) k = p[1]; });
    });
    return k;
  }

  var DESC = {
    app: "timesheet", title: "Timesheet", slice: "timesheet", ext: ".oroshours", mime: "application/x-oros-hours",
    colls: {
      clients: { shape: "array", id: "id", stamp: "m" },
      projects: { shape: "array", id: "id", stamp: "m" },
      entries: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (a, b) { return C.mergeTimesheet(a, b); }
  };

  var api = { DESC: DESC, kindOf: kindOf, LIM: LIM };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosTimesheetPackage = api;
})(this);
