// ============================================================
// orOS Water — .oroswater file (water/package.js,
// window.OrosWaterPackage). The descriptor of Water for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// every drink and every daily goal in one orOS bundle; opening one
// ADDS what this device lacks, with its ids. Pure (no DOM, no
// storage), so the app and `node --test` run the same code. Needs
// core.js (window.orosWaterCore; require("./core.js") under Node).
//   DESC                     the kit descriptor; merge = core.js
//                            mergeWater (pure: per id, newer m wins),
//                            which only ever sees the records the kit
//                            let through, so a clash keeps the local
//                            record (a goal is keyed by its day: the
//                            day's goal here stays as it is)
//   DESC.norm(data)          a file's data → { ver, sips, goals } with
//                            core.js's own record checks, drink times
//                            inside 1970…2100, capped counts
//   DESC.strip(state)        the slice → { ver, sips, goals }: no
//                            tombstones (deleted drinks), no settings
//                            (prefs, pm: glass sizes, unit, reminders
//                            and "Show in Habits" stay per device)
//   DESC.tombIds(state)      the ids of the deleted drinks
//   DESC.previews(state)     drinks.csv (core.js toCsv, the app's own
//                            "Export CSV": date, time, ml; numbers only)
//   kindOf(id, state)        "sip" | "goal" | ""
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.orosWaterCore;
  var LIM = { sips: 100000, goals: 5000 };
  var TS_MAX = 4102444800000;          // 2100-01-01: a drink time past it is junk

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: C.DATA_VER, sips: [], goals: [] };
    (Array.isArray(data.sips) ? data.sips : []).slice(0, LIM.sips).forEach(function (x) {
      var s = C.normSip(x);
      if (s && (s.del || s.ts < TS_MAX)) out.sips.push(s);
    });
    (Array.isArray(data.goals) ? data.goals : []).slice(0, LIM.goals).forEach(function (x) {
      var g = C.normGoal(x);
      if (g) out.goals.push(g);
    });
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    return JSON.parse(JSON.stringify({
      ver: C.DATA_VER,
      sips: (Array.isArray(s.sips) ? s.sips : []).filter(function (x) { return isObj(x) && !x.del; }),
      goals: Array.isArray(s.goals) ? s.goals : []
    }));
  }
  function tombIds(state) {
    var out = [];
    if (isObj(state) && Array.isArray(state.sips)) state.sips.forEach(function (x) { if (isObj(x) && x.del) out.push(x.id); });
    return out;
  }
  function previews(state) {
    return { "drinks.csv": C.toCsv({ sips: Array.isArray(state.sips) ? state.sips : [] }) };
  }

  // What an id names in a state (Undo handles each its own way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, k = "";
    (s.sips || []).forEach(function (x) { if (x && x.id === id) k = "sip"; });
    (s.goals || []).forEach(function (x) { if (x && x.id === id) k = "goal"; });
    return k;
  }

  var DESC = {
    app: "water", title: "Water", slice: "water", ext: ".oroswater", mime: "application/x-oros-water",
    colls: {
      sips: { shape: "array", id: "id", stamp: "m" },
      goals: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (local, remote) { return C.mergeWater(local, remote); }
  };

  var api = { DESC: DESC, kindOf: kindOf, LIM: LIM };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosWaterPackage = api;
})(this);
