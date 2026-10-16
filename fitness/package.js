// ============================================================
// orOS Workouts — .orosworkouts file (fitness/package.js,
// window.OrosFitnessPackage). The descriptor of Workouts for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): own exercises, programs, progression programs, finished
// workouts (with their routes) and body measurements in one orOS
// bundle; opening one ADDS what this device lacks, with its ids.
// Pure (no DOM, no storage), so the app and `node --test` run the
// same code. Uses gps-core.js for the routes (window.OrosFitnessGps;
// require("./gps-core.js") under Node); without it a route is dropped.
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; fitness.js then runs the
//                            result through its own mergeFit + save +
//                            sync, which normalises every row again)
//   DESC.norm(data)          a file's data → { ver, ex, pg, wo, bm,
//                            pl? } with the shape checks of fitness.js
//                            section 3 (its normalisers live inside the
//                            app's closure), known fields only, typed
//                            and capped
//   DESC.strip(state)        the slice → { ver, ex, pg, wo, bm, pl? }:
//                            no tombstones (tombs), no settings (set:
//                            units, steps, rest, "Show in Habits" stay
//                            per device), no running workout (en = 0)
//   DESC.tombIds(state)      the ids named in state.tombs ("<coll>:<id>")
//   DESC.previews(state, l)  workouts.md (readable) and workouts.csv
//                            (one row per done set, metric, with a
//                            formula guard)
//   withNames(nameOf)        DESC whose previews name exercises with
//                            nameOf(id) (the app's ready names, in its
//                            language); the plain DESC uses the file's
//                            own exercise names, else the id
//   kindOf(id, state)        "wo" | "pg" | "pl" | "ex" | "bm" | ""
// Data (fitness.js section 3): weights in grams, distances in metres,
// lengths in millimetres, times in seconds; every row has id + m.
// ============================================================
(function (root) {
  "use strict";

  var G = (root && root.OrosFitnessGps) || null;
  if (!G && typeof require === "function") { try { G = require("./gps-core.js"); } catch (e) { G = null; } }

  var LIM = { ex: 2000, pg: 500, wo: 50000, bm: 20000, pl: 100 };
  var NAME_LEN = 60, NOTE_LEN = 1000, MAX_SETS = 30, MAX_ITEMS = 40, MAX_DAYS = 14;
  var MAX_W = 2000000, MAX_R = 10000, MAX_T = 7 * 24 * 3600, MAX_D = 1000000, MAX_MM = 5000;
  var KINDS = ["wr", "r", "t", "dt"];
  var GROUPS = ["chest", "back", "shoulders", "biceps", "triceps", "legs", "glutes", "core", "cardio", "full"];
  var TPLS = ["531", "gzclp", "lin"];
  var COLLS = ["ex", "pg", "wo", "bm", "pl"];
  var ID_RE = /^[a-z0-9-]{1,40}$/;
  var DAYID_RE = /^[a-z0-9]{1,12}$/;
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var PK_RE = /^(m|a|t1|t2|t3|l):[a-z0-9-]{1,40}$/;
  var SLOT_RE = /^(t1|t2|t3|l):[a-z0-9-]{1,40}$/;
  var F_DONE = 1, F_WARM = 2;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clampInt(v, lo, hi) { return isInt(v) && v >= lo && v <= hi ? v : 0; }
  function okId(v) { return typeof v === "string" && ID_RE.test(v); }
  function stamp(x) { return isInt(x.m) && x.m >= 0; }
  function normStr(s, max) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function normNote(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").slice(0, NOTE_LEN);
  }

  // ---------- the shape checks of fitness.js section 3 ----------
  // An exercise without a name is a ready one the user hid or edited
  // (ids "x-…"); fitness.js's own normEx checks it against its list.
  function normEx(x) {
    if (!isObj(x) || !okId(x.id) || !stamp(x)) return null;
    var n = normStr(x.n, NAME_LEN);
    if (!n && x.id.indexOf("x-") !== 0) return null;
    return { id: x.id, m: x.m, n: n, g: GROUPS.indexOf(x.g) >= 0 ? x.g : "full",
             k: KINDS.indexOf(x.k) >= 0 ? x.k : "wr", h: x.h ? 1 : 0 };
  }
  function normItem(x) {
    if (!isObj(x) || !okId(x.e)) return null;
    var r = clampInt(x.r, 0, MAX_R), r2 = clampInt(x.r2, 0, MAX_R);
    if (r2 && r2 <= r) r2 = 0;
    var v = { e: x.e, s: clampInt(x.s, 1, MAX_SETS) || 1, r: r, r2: r2, t: clampInt(x.t, 0, MAX_T),
              w: clampInt(x.w, 0, MAX_W), rest: clampInt(x.rest, 0, 3600) };
    if (x.ln) v.ln = 1;
    return v;
  }
  function normWd(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (d) {
      if (isInt(d) && d >= 0 && d <= 6 && !seen[d]) { seen[d] = 1; out.push(d); }
    });
    return out.sort();
  }
  function normDay(x) {
    if (!isObj(x) || typeof x.id !== "string" || !DAYID_RE.test(x.id)) return null;
    var it = [];
    (Array.isArray(x.it) ? x.it : []).forEach(function (i) {
      var v = normItem(i);
      if (v && it.length < MAX_ITEMS) it.push(v);
    });
    return { id: x.id, n: normStr(x.n, NAME_LEN), wd: normWd(x.wd), it: it };
  }
  function normPg(x) {
    if (!isObj(x) || !okId(x.id) || !stamp(x)) return null;
    var n = normStr(x.n, NAME_LEN);
    if (!n) return null;
    var seen = {}, days = [];
    (Array.isArray(x.days) ? x.days : []).forEach(function (d) {
      var v = normDay(d);
      if (v && !seen[v.id] && days.length < MAX_DAYS) { seen[v.id] = 1; days.push(v); }
    });
    return { id: x.id, m: x.m, n: n, days: days };
  }
  function normSet(s) {
    if (!Array.isArray(s)) return null;
    return [clampInt(s[0], 0, MAX_W), clampInt(s[1], 0, MAX_R), clampInt(s[2], 0, MAX_T),
            clampInt(s[3], 0, MAX_D), clampInt(s[4], 0, 3)];
  }
  function normEntry(x) {
    if (!isObj(x) || !okId(x.e)) return null;
    var s = [];
    (Array.isArray(x.s) ? x.s : []).forEach(function (r) {
      var v = normSet(r);
      if (v && s.length < MAX_SETS) s.push(v);
    });
    var tr = clampInt(x.tr, 0, MAX_R), tr2 = clampInt(x.tr2, 0, MAX_R);
    if (tr2 && tr2 <= tr) tr2 = 0;
    var v = { e: x.e, tr: tr, tr2: tr2, rest: clampInt(x.rest, 0, 3600), s: s };
    if (x.ln) v.ln = 1;
    if (typeof x.pk === "string" && PK_RE.test(x.pk)) {
      v.pk = x.pk;
      v.pr = (Array.isArray(x.pr) ? x.pr : []).slice(0, MAX_SETS).map(function (n) { return clampInt(n, 0, MAX_R); });
      if (x.am) v.am = 1;
    }
    return v;
  }
  function normWo(x) {
    if (!isObj(x) || !okId(x.id) || !stamp(x)) return null;
    if (typeof x.d !== "string" || !YMD_RE.test(x.d) || !isInt(x.st) || x.st < 0) return null;
    var xs = [];
    (Array.isArray(x.x) ? x.x : []).forEach(function (e) {
      var v = normEntry(e);
      if (v && xs.length < MAX_ITEMS) xs.push(v);
    });
    var v = { id: x.id, m: x.m, d: x.d, st: x.st, en: isInt(x.en) && x.en >= x.st ? x.en : 0,
              ti: normStr(x.ti, NAME_LEN),
              p: okId(x.p) ? x.p : "",
              pd: typeof x.pd === "string" && DAYID_RE.test(x.pd) ? x.pd : "",
              n: normNote(x.n), x: xs };
    if (okId(x.pl)) { v.pl = x.pl; v.pp = clampInt(x.pp, 0, 1000000); }
    if (x.g && G && typeof G.normGps === "function") { var g = G.normGps(x.g); if (g) v.g = g; }
    return v;
  }
  function normPl(x) {
    if (!isObj(x) || !okId(x.id) || !stamp(x) || TPLS.indexOf(x.tp) < 0) return null;
    var tm = {}, sl = {}, fl = {}, n = 0;
    if (isObj(x.tm)) Object.keys(x.tm).sort().forEach(function (k) {
      if (ID_RE.test(k) && n++ < 20) tm[k] = clampInt(x.tm[k], 0, MAX_W);
    });
    n = 0;
    if (isObj(x.sl)) Object.keys(x.sl).sort().forEach(function (k) {
      var s = x.sl[k];
      if (!SLOT_RE.test(k) || !isObj(s) || n++ >= 30) return;
      sl[k] = { w: clampInt(s.w, 0, MAX_W), lv: clampInt(s.lv, 0, 2), b: clampInt(s.b, 0, MAX_W), f: clampInt(s.f, 0, 9) };
    });
    n = 0;
    if (isObj(x.fl)) Object.keys(x.fl).sort().forEach(function (k) {
      if (ID_RE.test(k) && x.fl[k] && n++ < 20) fl[k] = 1;
    });
    return { id: x.id, m: x.m, n: normStr(x.n, NAME_LEN), tp: x.tp, rd: clampInt(x.rd, 1, 100000) || 2500,
             bb: x.bb ? 1 : 0, k: clampInt(x.k, 0, 1000000), tm: tm, sl: sl, fl: fl };
  }
  function normBm(x) {
    if (!isObj(x) || typeof x.id !== "string" || !YMD_RE.test(x.id) || !stamp(x)) return null;
    var v = { id: x.id, m: x.m, w: clampInt(x.w, 0, 1000000), wa: clampInt(x.wa, 0, MAX_MM),
              ch: clampInt(x.ch, 0, MAX_MM), ar: clampInt(x.ar, 0, MAX_MM) };
    return (v.w || v.wa || v.ch || v.ar) ? v : null;
  }
  var NORM = { ex: normEx, pg: normPg, wo: normWo, bm: normBm, pl: normPl };

  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: 1 };
    COLLS.forEach(function (c) {
      var rows = [], seen = {};
      (Array.isArray(data[c]) ? data[c] : []).slice(0, LIM[c]).forEach(function (raw) {
        var x = NORM[c](raw);
        if (x && !seen[x.id]) { seen[x.id] = 1; rows.push(x); }
      });
      if (c !== "pl" || rows.length) out[c] = rows;
    });
    if (isObj(data.tombs)) out.tombs = data.tombs;        // strip and tombIds see it, then it goes
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {}, out = { ver: 1 };
    COLLS.forEach(function (c) {
      var rows = Array.isArray(s[c]) ? s[c] : [];
      // a workout still running belongs to the device it runs on
      if (c === "wo") rows = rows.filter(function (w) { return isObj(w) && typeof w.en === "number" && w.en > 0; });
      if (c !== "pl" || rows.length) out[c] = rows;
    });
    return JSON.parse(JSON.stringify(out));
  }
  function tombIds(state) {
    var out = [];
    if (isObj(state) && isObj(state.tombs)) Object.keys(state.tombs).forEach(function (k) {
      var i = k.indexOf(":");
      if (i > 0 && COLLS.indexOf(k.slice(0, i)) >= 0) out.push(k.slice(i + 1));
    });
    return out;
  }

  // ---------- previews ----------
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function md(v) { return String(v == null ? "" : v).replace(/[\r\n]+/g, " ").replace(/([\\`*_\[\]<>#|])/g, "\\$1"); }
  function round(v, dec) { var p = Math.pow(10, dec); return String(Math.round(v * p) / p); }
  function hhmm(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function makePreviews(nameOf) {
    return function (state, lang) {
      var el = lang === "el", own = {};
      (state.ex || []).forEach(function (x) { if (x && x.n) own[x.id] = x.n; });
      function name(id) {
        var n = "";
        try { n = typeof nameOf === "function" ? nameOf(id) : ""; } catch (e) { n = ""; }
        return n || own[id] || id;
      }
      var L = el ? { t: "Προπονήσεις", b: "Μετρήσεις σώματος", w: "Βάρος", wa: "Μέση", ch: "Στήθος", ar: "Χέρι", warm: "προθ.", none: "—" }
                 : { t: "Workouts", b: "Body measurements", w: "Weight", wa: "Waist", ch: "Chest", ar: "Arm", warm: "warm-up", none: "—" };
      var out = ["# " + L.t, ""];
      var csv = [["date", "workout", "exercise", "set", "warm_up", "weight_kg", "reps", "time_s", "distance_km", "note"].join(",")];
      (state.wo || []).slice().sort(function (a, b) { return a.st - b.st; }).forEach(function (w) {
        var mins = w.en > w.st ? Math.round((w.en - w.st) / 60000) : 0;
        out.push("## " + w.d + " · " + md(w.ti || L.none) + (mins ? " (" + mins + " min)" : ""), "");
        if (w.n) out.push(md(w.n), "");
        (w.x || []).forEach(function (e) {
          var sets = [], k = 0;
          (e.s || []).forEach(function (s) {
            if ((s[4] & F_DONE) !== F_DONE) return;
            k++;
            var parts = [];
            if (s[0]) parts.push(round(s[0] / 1000, 2) + " kg");
            if (s[1]) parts.push("× " + s[1]);
            if (s[3]) parts.push(round(s[3] / 1000, 3) + " km");
            if (s[2]) parts.push(hhmm(s[2]));
            sets.push(parts.join(" ") + ((s[4] & F_WARM) ? " (" + L.warm + ")" : ""));
            csv.push([w.d, w.ti, name(e.e), k, (s[4] & F_WARM) ? "yes" : "",
                      s[0] ? round(s[0] / 1000, 2) : "", s[1] || "", s[2] || "",
                      s[3] ? round(s[3] / 1000, 3) : "", k === 1 ? w.n : ""].map(csvCell).join(","));
          });
          if (sets.length) out.push("- " + md(name(e.e)) + ": " + sets.join(", "));
        });
        out.push("");
      });
      var bm = (state.bm || []).slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
      if (bm.length) {
        out.push("## " + L.b, "", "| | " + L.w + " (kg) | " + L.wa + " (cm) | " + L.ch + " (cm) | " + L.ar + " (cm) |", "|---|---|---|---|---|");
        bm.forEach(function (b) {
          out.push("| " + b.id + " | " + (b.w ? round(b.w / 1000, 2) : "") + " | " + (b.wa ? round(b.wa / 10, 1) : "") +
                   " | " + (b.ch ? round(b.ch / 10, 1) : "") + " | " + (b.ar ? round(b.ar / 10, 1) : "") + " |");
        });
        out.push("");
      }
      return { "workouts.md": out.join("\n"), "workouts.csv": csv.join("\r\n") + "\r\n" };
    };
  }

  // What an id names in a state (Undo removes each from its collection).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, order = ["wo", "pg", "pl", "ex", "bm"];
    for (var i = 0; i < order.length; i++) {
      var c = order[i], list = Array.isArray(s[c]) ? s[c] : [];
      for (var j = 0; j < list.length; j++) if (list[j] && list[j].id === id) return c;
    }
    return "";
  }

  var DESC = {
    app: "fitness", title: "Workouts", slice: "fitness", ext: ".orosworkouts", mime: "application/x-oros-workouts",
    colls: {
      ex: { shape: "array", id: "id", stamp: "m" },
      pg: { shape: "array", id: "id", stamp: "m" },
      wo: { shape: "array", id: "id", stamp: "m" },
      bm: { shape: "array", id: "id", stamp: "m" },
      pl: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: makePreviews(null)
  };
  function withNames(nameOf) {
    var d = {};
    Object.keys(DESC).forEach(function (k) { d[k] = DESC[k]; });
    d.previews = makePreviews(nameOf);
    return d;
  }

  var api = { DESC: DESC, withNames: withNames, kindOf: kindOf, LIM: LIM };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosFitnessPackage = api;
})(typeof window !== "undefined" ? window : this);
