// ============================================================
// orOS Baby — .orosbaby file (baby/package.js,
// window.OrosBabyPackage). The descriptor of Baby for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// every child, log entry, measurement, milestone / vaccine / doctor
// visit and milk-stash bag in one orOS bundle; opening one ADDS what
// this device lacks, with its ids. Pure (no DOM, no storage), so the
// app and `node --test` run the same code. Needs core.js
// (window.orosBabyCore; require("./core.js") under Node).
//   DESC                     the kit descriptor; merge = core.js
//                            mergeBaby (pure: per id, newer m wins),
//                            which only ever sees the records the kit
//                            let through, so a clash keeps the local
//                            record (a ticked seed milestone has the
//                            id kid + "x" + key: the one here stays)
//   DESC.norm(data)          a file's data → { ver, kids, ev, gr, mk,
//                            st } with core.js's own record checks,
//                            times inside 1970…2100, capped counts
//   DESC.strip(state)        the slice → { ver, kids, ev, gr, mk, st }:
//                            no tombstones, no running timers (a feed
//                            or sleep without an end is this moment on
//                            one device, not a record to move), no
//                            units (prefs, pm stay as they are here);
//                            reminders live outside the slice
//   DESC.tombIds(state)      the ids of every tombstone
//   DESC.previews(state)     log.csv and growth.csv (core.js toCsv and
//                            growthCsv, the app's own CSV exports,
//                            with their formula guard)
//   kindOf(id, state)        "kid" | "ev" | "gr" | "mk" | "st" | ""
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.orosBabyCore;
  var LIM = { kids: 50, ev: 200000, gr: 5000, mk: 5000, st: 5000 };
  var COLLS = ["kids", "ev", "gr", "mk", "st"];
  var TS_MAX = 4102444800000;          // 2100-01-01: an event time past it is junk

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  // core.js's checks per record (normalize = mergeBaby(x, x): typed,
  // fixed key order, one record per id, sorted), on capped lists
  function norm(data) {
    if (!isObj(data)) return null;
    var cut = {};
    COLLS.forEach(function (f) { cut[f] = (Array.isArray(data[f]) ? data[f] : []).slice(0, LIM[f]); });
    cut.ev = cut.ev.filter(function (x) { return !isObj(x) || x.del || !(x.ts >= TS_MAX); });
    var n = C.normalize(cut);
    var out = { ver: C.DATA_VER };
    COLLS.forEach(function (f) { out[f] = Array.isArray(n[f]) ? n[f] : []; });
    return out;
  }
  function runningTimer(x) { return !!C.TIMED[x.t] && x.e === undefined; }
  function strip(state) {
    var s = isObj(state) ? state : {}, out = { ver: C.DATA_VER };
    COLLS.forEach(function (f) {
      out[f] = (Array.isArray(s[f]) ? s[f] : []).filter(function (x) {
        return isObj(x) && !x.del && !(f === "ev" && runningTimer(x));
      });
    });
    return JSON.parse(JSON.stringify(out));
  }
  function tombIds(state) {
    var out = [];
    if (!isObj(state)) return out;
    COLLS.forEach(function (f) {
      (Array.isArray(state[f]) ? state[f] : []).forEach(function (x) { if (isObj(x) && x.del) out.push(x.id); });
    });
    return out;
  }
  function previews(state) {
    var d = { kids: state.kids || [], ev: state.ev || [], gr: state.gr || [] };
    return { "log.csv": C.toCsv(d), "growth.csv": C.growthCsv(d) };
  }

  // What an id names in a state (Undo tombstones it in that list).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, k = "";
    COLLS.forEach(function (f) {
      (Array.isArray(s[f]) ? s[f] : []).forEach(function (x) { if (x && x.id === id) k = f === "kids" ? "kid" : f; });
    });
    return k;
  }

  var DESC = {
    app: "baby", title: "Baby", slice: "baby", ext: ".orosbaby", mime: "application/x-oros-baby",
    colls: {
      kids: { shape: "array", id: "id", stamp: "m" },
      ev: { shape: "array", id: "id", stamp: "m" },
      gr: { shape: "array", id: "id", stamp: "m" },
      mk: { shape: "array", id: "id", stamp: "m" },
      st: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (local, remote) { return C.mergeBaby(local, remote); }
  };

  var api = { DESC: DESC, kindOf: kindOf, LIM: LIM };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosBabyPackage = api;
})(this);
