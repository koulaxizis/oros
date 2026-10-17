// ============================================================
// orOS Baby — import.js (pure logic: "Import from another app")
// Reads a file the person exported from another baby tracker, as
// DATA only (nothing is run, nothing becomes HTML):
//   - Huckleberry  CSV: Type, Start, End, Duration, Start Condition,
//                  Start Location, End Condition, Notes (Type Feed,
//                  Sleep, Diaper, Pump, Growth, Medicine, Solids…;
//                  a feed's Start Location says breast or bottle, its
//                  conditions the side times "00:10L" or the amount;
//                  a diaper's condition pee / poo / both)
//   - Baby Buddy   CSV or JSON per model (feeding, sleep,
//                  diaperchange, weight, height, head circumference,
//                  temperature, tummy time, pumping, note), told apart
//                  by their columns / keys; a Django dump ([{ model,
//                  fields }]) or the API's { results: […] } too
//   - Baby Tracker (Nighp) one CSV per activity (Nursing, Formula,
//                  Pumped, Pump, Sleep, Diaper, Growth, Medicine,
//                  Temperature…) with Baby, Time, …; a ZIP of them
// Everything maps onto Baby's own kinds (core.js TYPES + growth);
// kinds Baby does not keep (potty, activities, milestones…) are
// counted by name and left out.
//   parseText(text, name, opts) → { source, items, babies: { name: n },
//                                   skip: { label: n }, units } or
//                                   { error: "bad"|"empty"|"big" }
//   readBytes(bytes, name, opts) → Promise of the same (ZIP aware)
//   plan(res, data, opts)        → the records an import would ADD for
//                                   one child (opts.kid, opts.baby =
//                                   the baby named in the file)
// opts.prefs (the app's units) guide values that carry no unit
// (Baby Buddy keeps none): lb / fl oz users get lb, in and oz.
// Stable ids: "imp" + two hashes of the child id and the entry's
// own values (Baby ids are [a-z0-9] only, so no "-"): importing the
// same file twice adds nothing; an entry the child already has at
// the same minute (logged by hand) is left out too.
// Caps: file size, characters, entries, ZIP entries, JSON nodes,
// text length. Needs OrosImportKit (../importkit.js) and the Baby
// core (core.js); a ZIP needs AtelierZip.
// UMD: window.OrosBabyImport in the browser, module.exports in Node.
// i18n-inline-ok: Greek side / nappy / head words for the import parsers (data, no UI text)
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var K = NODE ? require("../importkit.js") : root.OrosImportKit;
  var C = NODE ? require("./core.js") : root.orosBabyCore;

  var MAX_FILE = 30 * 1024 * 1024;      // the file as picked
  var MAX_TEXT = 30 * 1024 * 1024;      // characters parsed
  var MAX_ITEMS = 60000;                // entries kept from one file
  var MAX_ZIP_ENTRIES = 60;
  var MAX_NODES = 400000;               // JSON nodes walked
  var MAX_TX = 200;
  var SAME_MS = 60000;                  // same kind within a minute = already here
  var DAY_MS = 86400000;
  var OZ_ML = 29.5735, LB_G = 453.592, OZ_G = 28.3495;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function low(v) { return K.clean(v, 400).toLowerCase(); }
  function txt(v) { return K.clean(v, MAX_TX); }
  function bump(o, k, n) { o[k] = (o[k] || 0) + (n || 1); }

  // ---------- 1. Values ----------
  // D/M/Y or M/D/Y, from the values themselves
  function dateHint(vals) {
    var dmy = false, mdy = false;
    vals.forEach(function (v) {
      var m = /^\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/.exec(String(v === null || v === undefined ? "" : v));
      if (!m) return;
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    });
    return dmy && !mdy ? "dmy" : (mdy && !dmy ? "mdy" : "");
  }
  // when every date could be either: the file's hint (all files of a
  // ZIP), else the reading that keeps the rows in order
  function orderHint(vals) {
    var best = "", bestN = Infinity, tie = false;
    ["dmy", "mdy"].forEach(function (h) {
      var list = vals.map(function (v) { return K.parseDate(K.clean(v, 80), h); }).filter(isFinite), up = 0, down = 0;
      for (var i = 1; i < list.length; i++) { if (list[i] < list[i - 1]) down++; else if (list[i] > list[i - 1]) up++; }
      var n = Math.min(up, down);
      if (n < bestN) { best = h; bestN = n; tie = false; } else if (n === bestN) tie = true;
    });
    return tie ? "" : best;
  }
  function hintFor(vals, o) {
    return dateHint(vals) || (o && o.hint) || orderHint(vals.slice(0, 2000));
  }
  // every N/N/N date in a text, for a hint across files
  function textHint(list) {
    var vals = [];
    list.forEach(function (t) {
      var m, re = /(?:^|[^\d\/.])(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})(?![\d\/])/g, n = 0;
      while ((m = re.exec(t)) && n++ < 5000) vals.push(m[1]);
    });
    return dateHint(vals);
  }
  function tsOf(v, hint) {
    if (v === null || v === undefined || v === "") return NaN;
    var ms = K.parseDate(typeof v === "number" ? v : K.clean(v, 80), hint);
    return isFinite(ms) && ms > Date.UTC(1990, 0, 1) ? ms : NaN;
  }
  function dayOf(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  // "1:20:05", "00:20" (h:mm), "1h 20m", "20 min", "45s", 20 (unit)
  function durSec(v, unit) {
    if (v === null || v === undefined || v === "") return NaN;
    var s = low(v), m;
    if (!s) return NaN;
    m = /^(\d+):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?$/.exec(s);
    if (m) return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 3600 + +m[2] * 60;
    var tot = 0, any = false, re = /(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/g;
    while ((m = re.exec(s))) {
      var n = K.num(m[1]), u = m[2].charAt(0);
      tot += u === "h" ? n * 3600 : (u === "m" ? n * 60 : n);
      any = true;
    }
    if (any) return Math.round(tot);
    var x = K.num(s);
    if (!isFinite(x) || !/^[\d.,\s]+$/.test(s)) return NaN;
    return Math.round(unit === "s" ? x : (unit === "h" ? x * 3600 : x * 60));
  }
  // a volume in ml: "120 ml", "4 oz", "4", unit for a bare number
  function mlOf(v, unit) {
    var s = low(v), m = /(\d+(?:[.,]\d+)?)\s*(ml|cc|fl\.?\s*oz|oz|ounces?)?/.exec(s);
    if (!m) return NaN;
    var n = K.num(m[1]);
    if (!isFinite(n) || n <= 0) return NaN;
    var oz = m[2] ? /oz|ounce/.test(m[2]) : unit === "oz";
    return Math.round(oz ? n * OZ_ML : n);
  }
  // the first volume WITH a unit in any of the texts
  function mlIn(list) {
    for (var i = 0; i < list.length; i++) {
      if (/\d\s*(ml|cc|oz|ounce)/.test(low(list[i]))) return mlOf(list[i], "ml");
    }
    return NaN;
  }
  // the sum of all volumes with a unit (a pump's left + right)
  function mlSum(list) {
    var tot = 0, any = false;
    list.forEach(function (x) {
      var s = low(x), m, re = /(\d+(?:[.,]\d+)?)\s*(ml|cc|fl\.?\s*oz|oz|ounces?)/g;
      while ((m = re.exec(s))) { tot += mlOf(m[0], "ml"); any = true; }
    });
    return any ? tot : NaN;
  }
  // grams: "3.5 kg", "3500 g", "7 lb 8 oz", "7.5 lbs", bare (unit)
  function gramsOf(v, unit) {
    var s = low(v), m;
    if (!s) return NaN;
    m = /(\d+(?:[.,]\d+)?)\s*(?:lbs?|pounds?)\s*(?:(\d+(?:[.,]\d+)?)\s*(?:oz|ounces?))?/.exec(s);
    if (m) return Math.round(K.num(m[1]) * LB_G + (m[2] ? K.num(m[2]) * OZ_G : 0));
    m = /(\d+(?:[.,]\d+)?)\s*(kg|kilo\w*|g|gr|grams?|oz|ounces?)\b/.exec(s);
    if (m) {
      var n = K.num(m[1]), u = m[2];
      return Math.round(/^k/.test(u) ? n * 1000 : (/^o/.test(u) ? n * OZ_G : n));
    }
    var x = K.num(s);
    if (!isFinite(x) || x <= 0) return NaN;
    if (x > 300) return Math.round(x);                       // already grams
    return Math.round(unit === "lb" ? x * LB_G : x * 1000);
  }
  // millimetres: "50 cm", "20 in", '20"', "500 mm", bare (unit)
  function mmOf(v, unit) {
    var s = low(v), m;
    if (!s) return NaN;
    m = /(\d+(?:[.,]\d+)?)\s*(cm|mm|in|inch\w*|"|”)/.exec(s);
    if (m) {
      var n = K.num(m[1]), u = m[2];
      return Math.round(u === "cm" ? n * 10 : (u === "mm" ? n : n * 25.4));
    }
    var x = K.num(s);
    if (!isFinite(x) || x <= 0) return NaN;
    return Math.round(unit === "in" ? x * 25.4 : x * 10);
  }
  // tenths of °C (°F converted)
  function tempOf(v) {
    var n = K.num(v);
    if (!isFinite(n)) return NaN;
    if (n > 45) n = (n - 32) * 5 / 9;
    return Math.round(n * 10);
  }
  function truthy(v) { return v === true || v === 1 || /^(true|yes|y|1|x|t)$/i.test(K.clean(v, 10)); }

  // ---------- 2. Items ----------
  // An item is one Baby entry before it has a child: { t, ts, e?,
  // ls?, rs?, sd?, ml?, x?, v?, tx?, b } or growth { t: "growth", d,
  // g?, l?, h?, b }; b = the baby named in the file ("" = none).
  function collector(source) {
    var items = [], babies = {}, skip = {}, units = {};
    return {
      add: function (it, baby) {
        if (items.length >= MAX_ITEMS) return;
        if (it.t === "growth") {
          ["g", "l", "h"].forEach(function (f) { if (!isFinite(it[f])) delete it[f]; });
          if (it.g === undefined && it.l === undefined && it.h === undefined) { bump(skip, "bad"); return; }
        }
        it.b = K.clean(baby, 60);
        if (it.tx !== undefined) it.tx = txt(it.tx);
        if (!it.tx) delete it.tx;
        items.push(it);
        bump(babies, it.b);
      },
      skip: function (label) { bump(skip, K.clean(label, 40) || "?"); },
      unit: function (k, v) { units[k] = v; },
      done: function () {
        return items.length || Object.keys(skip).length
          ? { source: source, items: items, babies: babies, skip: skip, units: units }
          : { error: "empty" };
      }
    };
  }
  // ts + end / duration → a timed item, or a reason it can't be one
  function span(c, it, end, dur, label) {
    if (!isFinite(it.ts)) { c.skip("bad"); return null; }
    var e = isFinite(end) && end >= it.ts ? end : (isFinite(dur) && dur >= 0 ? it.ts + dur * 1000 : NaN);
    if (!isFinite(e)) { c.skip(label || "noend"); return null; }
    if (e - it.ts > DAY_MS) { c.skip("long"); return null; }
    it.e = e;
    return it;
  }
  // breast seconds per side from texts like "00:10L", "10m R", "L 5"
  function sideSecs(list) {
    var o = { l: 0, r: 0, any: false };
    list.forEach(function (x) {
      var s = K.clean(x, 200), m, re = /(\d{1,2}:\d{2}(?::\d{2})?|\d+(?:[.,]\d+)?\s*(?:m|min|mins|minutes)?)\s*(L|R|left|right)\b/gi;
      while ((m = re.exec(s))) {
        var sec = durSec(m[1].replace(/\s+/g, ""), "m");
        if (!isFinite(sec)) continue;
        o[m[2].charAt(0).toLowerCase()] += sec;
        o.any = true;
      }
    });
    return o;
  }
  function sideWord(s) {
    s = low(s);
    if (/\bboth\b|\bl\s*[+&\/]\s*r\b|\bb\b/.test(s)) return "b";
    if (/\bleft\b|\bl\b|αριστερ/.test(s)) return "l";
    if (/\bright\b|\br\b|δεξ/.test(s)) return "r";
    return "";
  }
  // a breast feed from its total and side (both: split; unknown: left)
  function breast(it, total, side) {
    total = Math.max(0, Math.round(total || 0));
    if (side === "r") { it.ls = 0; it.rs = total; it.sd = "r"; }
    else if (side === "b") { it.ls = Math.floor(total / 2); it.rs = total - it.ls; it.sd = "l"; }
    else { it.ls = total; it.rs = 0; it.sd = "l"; }
    return it;
  }
  function diaperKind(s) {
    s = low(s);
    var wet = /pee|wet|urine|βρεγμ|τσίσ|τσισ/.test(s), dirty = /poo|poop|dirty|bm\b|stool|solid|κακ/.test(s);
    if (/both|mixed|mix\b/.test(s)) return "wd";
    if (wet && dirty) return "wd";
    if (dirty) return "d";
    if (wet) return "w";
    return "";
  }

  // ---------- 3. Huckleberry ----------
  function parseHuckleberry(recs, o) {
    var c = collector("huckleberry");
    var hint = hintFor(recs.rows.map(function (r) { return K.get(r, ["Start", "Start Time"]); }), o);
    recs.rows.forEach(function (r) {
      var type = K.clean(K.get(r, ["Type"]), 40), ty = type.toLowerCase();
      var sc = K.get(r, ["Start Condition"]), sl = K.get(r, ["Start Location"]), ec = K.get(r, ["End Condition"]);
      var nt = K.get(r, ["Notes", "Note"]), baby = K.get(r, ["Child", "Baby", "Name"]);
      var ts = tsOf(K.get(r, ["Start", "Start Time", "Time"]), hint);
      var end = tsOf(K.get(r, ["End", "End Time"]), hint);
      var dur = durSec(K.get(r, ["Duration"]), "m");
      var all = [sc, sl, ec];
      if (!ty) return;
      if (!isFinite(ts)) { c.skip("bad"); return; }
      var it = { ts: ts, tx: nt }, ml;
      if (/feed|nurs|breast|bottle/.test(ty)) {
        if (/solid/.test(low(sl))) { it.t = "solid"; it.x = "y"; it.tx = [sc, nt].filter(Boolean).join(" · "); c.add(it, baby); return; }
        if (/bottle/.test(ty) || /bottle/.test(low(sl + " " + sc))) {
          ml = mlIn([ec, sc, sl, nt]);
          if (!isFinite(ml)) { c.skip("noamount"); return; }
          it.t = "bottle"; it.ml = ml;
          it.x = /formula/.test(low(all.join(" ") + " " + ty)) ? "fm" : "bm";
          c.add(it, baby);
          return;
        }
        it.t = "feed";
        var ss = sideSecs([sc, ec]);
        if (ss.any) { it.ls = ss.l; it.rs = ss.r; it.sd = ss.r > ss.l ? "r" : "l"; }
        var total = ss.any ? ss.l + ss.r : (isFinite(end) && end > ts ? (end - ts) / 1000 : dur);
        if (!ss.any) breast(it, isFinite(total) ? total : 0, sideWord(all.join(" ")));
        if (!span(c, it, end, isFinite(dur) ? dur : (it.ls + it.rs))) return;
        c.add(it, baby);
        return;
      }
      if (/sleep|nap/.test(ty)) {
        it.t = "sleep";
        if (span(c, it, end, dur)) c.add(it, baby);
        return;
      }
      if (/diaper|nappy|change/.test(ty)) {
        var k = diaperKind([ec, sc, sl].join(" "));
        if (!k) { c.skip(/dry/.test(low(all.join(" "))) ? "dry" : "bad"); return; }
        it.t = "diaper"; it.x = k;
        c.add(it, baby);
        return;
      }
      if (/pump/.test(ty)) {
        ml = mlSum([sc, ec, sl]);
        if (!isFinite(ml)) { c.skip("noamount"); return; }
        it.t = "pump"; it.ml = ml; it.sd = sideWord(all.join(" ")) || "b";
        if (isFinite(end) && end > ts) it.e = end; else if (dur > 0) it.e = ts + dur * 1000;
        c.add(it, baby);
        return;
      }
      if (/growth|measure|weight|height|length/.test(ty)) {
        var g = { t: "growth", d: dayOf(ts) }, lens = [];
        [sc, sl, ec].forEach(function (x) {
          var s = low(x);
          if (!s) return;
          if (/\d\s*(kg|kilo|g\b|gr|lb|pound)/.test(s) && g.g === undefined) g.g = gramsOf(s, "kg");
          else if (/\d\s*(cm|mm|in\b|inch|"|”)/.test(s)) lens.push({ v: mmOf(s, "cm"), head: /head|κεφ/.test(s) });
        });
        lens.forEach(function (x, i) {
          if (x.head || (i > 0 && g.h === undefined)) { if (g.h === undefined) g.h = x.v; }
          else if (g.l === undefined) g.l = x.v;
        });
        if (g.g === undefined && g.l === undefined && g.h === undefined) { c.skip("bad"); return; }
        c.add(g, baby);
        return;
      }
      if (/medic|vitamin|drug/.test(ty)) {
        it.t = "med";
        it.tx = [sc, ec].filter(Boolean).join(" ") || txt(nt) || type;
        if (nt && it.tx !== txt(nt)) it.tx += " · " + txt(nt);
        c.add(it, baby);
        return;
      }
      if (/solid|food/.test(ty)) { it.t = "solid"; it.x = "y"; it.tx = [sc, nt].filter(Boolean).join(" · "); c.add(it, baby); return; }
      if (/temp/.test(ty)) {
        var v = tempOf((/\d/.test(sc) ? sc : ec) || nt);
        if (!isFinite(v)) { c.skip("bad"); return; }
        it.t = "temp"; it.v = v;
        c.add(it, baby);
        return;
      }
      if (/bath/.test(ty)) {
        it.t = "bath";
        if (isFinite(end) && end > ts) it.e = end; else if (dur > 0) it.e = ts + dur * 1000;
        c.add(it, baby);
        return;
      }
      if (/tummy/.test(ty)) {
        var mins = Math.round((isFinite(end) && end > ts ? (end - ts) / 1000 : dur) / 60);
        if (!(mins >= 1)) { c.skip("bad"); return; }
        it.t = "tummy"; it.v = Math.min(180, mins);
        c.add(it, baby);
        return;
      }
      if (/note|diary|journal/.test(ty)) {
        it.t = "note"; it.tx = [sc, nt].filter(Boolean).join(" · ");
        if (!txt(it.tx)) { c.skip("bad"); return; }
        c.add(it, baby);
        return;
      }
      c.skip(type);
    });
    return c.done();
  }

  // ---------- 4. Baby Buddy ----------
  // one model's records → items; o.units from the app's prefs
  var BB_SIGS = [
    { id: "feeding", need: ["start", "method"] },
    { id: "diaperchange", need: ["wet", "solid"] },
    { id: "tummytime", need: ["start", "milestone"] },
    { id: "headcircumference", need: [["head_circumference", "head circumference", "headcircumference"]] },
    { id: "weight", need: ["weight"] },
    { id: "height", need: ["height"] },
    { id: "bmi", need: ["bmi"] },
    { id: "temperature", need: ["temperature"] },
    { id: "pumping", need: ["amount"] },
    { id: "sleep", need: ["start", "end"] },
    { id: "note", need: ["note"] }
  ];
  var BB_KNOWN = { feeding: 1, sleep: 1, diaperchange: 1, tummytime: 1, temperature: 1, pumping: 1, note: 1,
    weight: 1, height: 1, headcircumference: 1 };
  function bbModel(head, name) {
    var n = low(name).replace(/[^a-z]/g, "");
    var id = K.detect(head, BB_SIGS);
    if (id === "sleep" && /tummy/.test(n)) return "tummytime";
    if (id === "pumping" && K.col(head, ["method"]) !== -1) return "feeding";
    return id;
  }
  function bbItems(c, model, rows, o, names) {
    var hint = hintFor(rows.map(function (r) { return K.get(r, ["start", "time", "date"]); }), o);
    var lbs = o.wu === "lb", oz = o.vu === "oz";
    function baby(r) {
      var v = K.get(r, ["child", "child_name", "child__first_name", "baby"]);
      if (v && typeof v === "object") v = [v.first_name, v.last_name].filter(Boolean).join(" ");
      var s = K.clean(v, 60);
      return names && names[s] ? names[s] : s;
    }
    function len(vals, metric) {
      // metric: cm unless the values can only be inches (all tiny)
      var max = 0;
      vals.forEach(function (v) { var n = K.num(v); if (n > max) max = n; });
      return (!metric && max < 45) || max < 25 ? "in" : "cm";
    }
    var lenUnit = "cm";
    if (model === "height") lenUnit = len(rows.map(function (r) { return K.get(r, ["height"]); }), !lbs);
    if (model === "headcircumference") lenUnit = len(rows.map(function (r) { return K.get(r, ["head_circumference", "head circumference", "headcircumference"]); }), !lbs);
    if (model === "weight") c.unit("w", lbs ? "lb" : "kg");
    if (model === "height" || model === "headcircumference") c.unit("l", lenUnit);
    if (model === "feeding" || model === "pumping") c.unit("v", oz ? "oz" : "ml");
    rows.forEach(function (r) {
      var b = baby(r), nt = K.get(r, ["notes", "note"]);
      var ts = tsOf(K.get(r, ["start", "time", "date"]), hint), end = tsOf(K.get(r, ["end"]), hint);
      var it = { ts: ts, tx: typeof nt === "string" ? nt : "" }, ml;
      if (!BB_KNOWN[model]) { c.skip(model); return; }
      if (model !== "weight" && model !== "height" && model !== "headcircumference" && !isFinite(ts)) { c.skip("bad"); return; }
      switch (model) {
        case "feeding":
          var ty = low(K.get(r, ["type"])), me = low(K.get(r, ["method"]));
          if (/solid/.test(ty) || /parent|self/.test(me)) { it.t = "solid"; it.x = "y"; c.add(it, b); return; }
          if (/bottle/.test(me)) {
            ml = mlOf(K.get(r, ["amount"]), oz ? "oz" : "ml");
            if (!isFinite(ml)) { c.skip("noamount"); return; }
            it.t = "bottle"; it.ml = ml; it.x = /formula/.test(ty) ? "fm" : "bm";
            c.add(it, b);
            return;
          }
          it.t = "feed";
          if (!span(c, it, end, durSec(K.get(r, ["duration"]), "m"))) return;
          breast(it, (it.e - it.ts) / 1000, /both/.test(me) ? "b" : (/right/.test(me) ? "r" : "l"));
          c.add(it, b);
          return;
        case "sleep":
          it.t = "sleep";
          if (span(c, it, end, durSec(K.get(r, ["duration"]), "m"))) c.add(it, b);
          return;
        case "diaperchange":
          var w = truthy(K.get(r, ["wet"])), s = truthy(K.get(r, ["solid"]));
          if (!w && !s) { c.skip("dry"); return; }
          it.t = "diaper"; it.x = w && s ? "wd" : (s ? "d" : "w");
          var col = K.clean(K.get(r, ["color", "colour"]), 30);
          if (col) it.tx = [col, it.tx].filter(Boolean).join(" · ");
          c.add(it, b);
          return;
        case "tummytime":
          var e2 = isFinite(end) && end > ts ? end : NaN, d2 = durSec(K.get(r, ["duration"]), "m");
          var mins = Math.round((isFinite(e2) ? (e2 - ts) / 1000 : d2) / 60);
          if (!(mins >= 1)) { c.skip("bad"); return; }
          it.t = "tummy"; it.v = Math.min(180, mins);
          var mi = K.clean(K.get(r, ["milestone"]), 100);
          if (mi) it.tx = mi;
          c.add(it, b);
          return;
        case "temperature":
          var tv = tempOf(K.get(r, ["temperature"]));
          if (!isFinite(tv)) { c.skip("bad"); return; }
          it.t = "temp"; it.v = tv;
          c.add(it, b);
          return;
        case "pumping":
          ml = mlOf(K.get(r, ["amount"]), oz ? "oz" : "ml");
          if (!isFinite(ml)) { c.skip("noamount"); return; }
          it.t = "pump"; it.ml = ml; it.sd = "b";
          if (isFinite(end) && end > ts) it.e = end;
          c.add(it, b);
          return;
        case "note":
          it.t = "note"; it.tx = K.get(r, ["note"]);
          if (!txt(it.tx)) { c.skip("bad"); return; }
          c.add(it, b);
          return;
        case "weight": case "height": case "headcircumference":
          var day = K.get(r, ["date", "time"]), dk = /^\d{4}-\d{2}-\d{2}/.test(String(day)) ? String(day).slice(0, 10) : (isFinite(ts) ? dayOf(ts) : "");
          if (!dk || !C.validDay(dk)) { c.skip("bad"); return; }
          var g = { t: "growth", d: dk };
          if (model === "weight") g.g = gramsOf(K.get(r, ["weight"]), lbs ? "lb" : "kg");
          else if (model === "height") g.l = mmOf(K.get(r, ["height"]), lenUnit);
          else g.h = mmOf(K.get(r, ["head_circumference", "head circumference", "headcircumference"]), lenUnit);
          c.add(g, b);
          return;
        default:
          c.skip(model);
      }
    });
  }
  // Django dump / API / plain arrays → { model: [records] } (+ child names)
  function bbJson(obj, name) {
    var groups = {}, names = {}, nodes = 0;
    function addRow(model, rec) {
      if (!model || !rec || typeof rec !== "object" || Array.isArray(rec)) return;
      if (++nodes > MAX_NODES) return;
      (groups[model] = groups[model] || []).push(rec);
    }
    function list(arr, hintName) {
      arr.forEach(function (x) {
        if (!x || typeof x !== "object") return;
        if (typeof x.model === "string" && x.fields && typeof x.fields === "object") {
          var m = x.model.split(".").pop().toLowerCase().replace(/[^a-z]/g, "");
          if (m === "child") {
            var nm = [x.fields.first_name, x.fields.last_name].filter(Boolean).join(" ");
            if (nm) names[String(x.pk)] = K.clean(nm, 60);
            return;
          }
          addRow(m, x.fields);
          return;
        }
        var id = bbModel(Object.keys(x), hintName);
        if (id) addRow(id, x);
      });
    }
    if (Array.isArray(obj)) list(obj, name);
    else if (obj && typeof obj === "object") {
      if (Array.isArray(obj.results)) list(obj.results, name);
      else Object.keys(obj).slice(0, 60).forEach(function (k) { if (Array.isArray(obj[k])) list(obj[k], k); });
    }
    return { groups: groups, names: names };
  }

  // ---------- 5. Baby Tracker (Nighp) ----------
  // the activity from the file name, else from the columns
  function nighpKind(head, name) {
    var base = K.clean(String(name || "").split("/").pop(), 60).replace(/\.csv$/i, ""), n = base.toLowerCase();
    if (/nursing|breast/.test(n)) return "nursing";
    if (/formula/.test(n)) return "formula";
    if (/pumped/.test(n)) return "pumped";
    if (/pump/.test(n)) return "pump";
    if (/sleep/.test(n)) return "sleep";
    if (/diaper|nappy/.test(n)) return "diaper";
    if (/growth/.test(n)) return "growth";
    if (/medic/.test(n)) return "med";
    if (/temp/.test(n)) return "temp";
    if (/bath/.test(n)) return "bath";
    if (/tummy/.test(n)) return "tummy";
    if (/solid|food|supplement|other.?feed/.test(n)) return "solid";
    if (/note|diary/.test(n)) return "note";
    if (n && !/export|baby.?tracker|data/.test(n)) return "?" + base;
    if (K.col(head, ["Start Side", "Left Duration", "Left duration (min)", "Left Duration (min)"]) !== -1) return "nursing";
    if (K.col(head, ["Status"]) !== -1) return "diaper";
    if (K.col(head, ["Weight", "Height", "Head Size", "Head"]) !== -1) return "growth";
    if (K.col(head, ["Temperature"]) !== -1) return "temp";
    if (K.col(head, ["Medicine", "Medicine Name", "Medication"]) !== -1) return "med";
    if (K.col(head, ["Food", "Food Type"]) !== -1) return "solid";
    if (K.col(head, ["Left Amount", "Right Amount"]) !== -1) return "pump";
    return "";
  }
  // a column's unit from its header: "Amount (oz)", "Weight (lb)"
  function headUnit(head, names, re) {
    var i = K.col(head, names);
    if (i === -1) {
      for (var j = 0; j < head.length; j++) {
        var h = low(head[j]);
        if (names.some(function (n) { return h.indexOf(low(n)) === 0; })) { i = j; break; }
      }
    }
    if (i === -1) return { key: "", unit: "" };
    var m = re.exec(low(head[i]));
    return { key: head[i], unit: m ? m[1] : "" };
  }
  function parseNighp(recs, name, o) {
    var c = collector("babytracker"), head = recs.head;
    var kind = nighpKind(head, name);
    if (!kind) return { error: "bad" };
    if (kind.charAt(0) === "?") {
      recs.rows.forEach(function () { c.skip(kind.slice(1).replace(/[_-]+/g, " ")); });
      return c.done();
    }
    var hint = hintFor(recs.rows.map(function (r) { return K.get(r, ["Time", "Date", "Start Time"]); }), o);
    var amt = headUnit(head, ["Amount", "Total Amount", "Total"], /\((ml|oz)\)/);
    var dur = headUnit(head, ["Duration", "Total Duration"], /\((min|hr|h|s|sec)\w*\)/);
    var wt = headUnit(head, ["Weight"], /\((kg|lb|g)\w*\)/), ht = headUnit(head, ["Height", "Length"], /\((cm|in)\w*\)/);
    var hd = headUnit(head, ["Head Size", "Head", "Head Circumference"], /\((cm|in)\w*\)/);
    var vu = amt.unit || (o.vu === "oz" ? "oz" : "ml");
    var du = dur.unit ? dur.unit.charAt(0) : "m";
    recs.rows.forEach(function (r) {
      var b = K.get(r, ["Baby", "Baby Name", "Child"]), nt = K.get(r, ["Note", "Notes"]);
      var ts = tsOf(K.get(r, ["Time", "Date", "Start Time"]), hint);
      if (!isFinite(ts)) { c.skip("bad"); return; }
      var it = { ts: ts, tx: nt }, ml, d;
      switch (kind) {
        case "nursing":
          var ls = durSec(K.get(r, ["Left Duration (min)", "Left duration", "Left Duration", "Left"]), "m");
          var rs = durSec(K.get(r, ["Right Duration (min)", "Right duration", "Right Duration", "Right"]), "m");
          var tot = durSec(dur.key ? r[dur.key] : "", du);
          it.t = "feed";
          if (isFinite(ls) || isFinite(rs)) {
            it.ls = isFinite(ls) ? ls : 0; it.rs = isFinite(rs) ? rs : 0;
            var st = sideWord(K.get(r, ["Start Side", "Side"]));
            it.sd = st === "r" || st === "l" ? st : (it.rs > it.ls ? "r" : "l");
          } else breast(it, isFinite(tot) ? tot : 0, sideWord(K.get(r, ["Start Side", "Side"])));
          if (span(c, it, NaN, isFinite(tot) ? tot : it.ls + it.rs)) c.add(it, b);
          return;
        case "formula": case "pumped":
          ml = mlOf(amt.key ? r[amt.key] : "", vu);
          if (!isFinite(ml)) { c.skip("noamount"); return; }
          it.t = "bottle"; it.ml = ml; it.x = kind === "formula" ? "fm" : "bm";
          c.add(it, b);
          return;
        case "pump":
          var la = mlOf(K.get(r, ["Left Amount", "Left Amount (ml)", "Left Amount (oz)", "Left"]), vu);
          var ra = mlOf(K.get(r, ["Right Amount", "Right Amount (ml)", "Right Amount (oz)", "Right"]), vu);
          ml = amt.key ? mlOf(r[amt.key], vu) : NaN;
          if (!isFinite(ml)) ml = (isFinite(la) ? la : 0) + (isFinite(ra) ? ra : 0);
          if (!(ml > 0)) { c.skip("noamount"); return; }
          it.t = "pump"; it.ml = ml;
          it.sd = isFinite(la) && la > 0 && !(ra > 0) ? "l" : (isFinite(ra) && ra > 0 && !(la > 0) ? "r" : "b");
          d = durSec(dur.key ? r[dur.key] : "", du);
          if (d > 0) it.e = ts + d * 1000;
          c.add(it, b);
          return;
        case "sleep":
          it.t = "sleep";
          if (span(c, it, tsOf(K.get(r, ["End Time", "End"]), hint), durSec(dur.key ? r[dur.key] : "", du))) c.add(it, b);
          return;
        case "diaper":
          var k = diaperKind(K.get(r, ["Status", "Type", "Diaper"]));
          if (!k) { c.skip(/dry/i.test(K.get(r, ["Status", "Type"])) ? "dry" : "bad"); return; }
          it.t = "diaper"; it.x = k;
          c.add(it, b);
          return;
        case "growth":
          var g = { t: "growth", d: dayOf(ts) };
          if (wt.key && K.clean(r[wt.key])) g.g = gramsOf(r[wt.key], wt.unit === "lb" ? "lb" : (o.wu === "lb" && !wt.unit ? "lb" : "kg"));
          if (ht.key && K.clean(r[ht.key])) g.l = mmOf(r[ht.key], ht.unit || (o.wu === "lb" ? "in" : "cm"));
          if (hd.key && K.clean(r[hd.key])) g.h = mmOf(r[hd.key], hd.unit || (o.wu === "lb" ? "in" : "cm"));
          ["g", "l", "h"].forEach(function (f) { if (!isFinite(g[f])) delete g[f]; });
          if (g.g === undefined && g.l === undefined && g.h === undefined) { c.skip("bad"); return; }
          c.add(g, b);
          return;
        case "med":
          it.t = "med";
          it.tx = [K.get(r, ["Medicine Name", "Medicine", "Medication", "Name"]), K.get(r, ["Amount", "Dose"])]
            .map(function (x) { return K.clean(x, 80); }).filter(Boolean).join(" ") || K.clean(nt, MAX_TX) || "Medicine";
          if (nt && it.tx.indexOf(K.clean(nt, 80)) === -1) it.tx += " · " + K.clean(nt, 80);
          c.add(it, b);
          return;
        case "temp":
          var tv = tempOf(K.get(r, ["Temperature", "Temp"]));
          if (!isFinite(tv)) { c.skip("bad"); return; }
          it.t = "temp"; it.v = tv;
          c.add(it, b);
          return;
        case "bath":
          it.t = "bath";
          d = durSec(dur.key ? r[dur.key] : "", du);
          if (d > 0) it.e = ts + d * 1000;
          c.add(it, b);
          return;
        case "tummy":
          d = durSec(dur.key ? r[dur.key] : "", du);
          if (!(d >= 60)) { c.skip("bad"); return; }
          it.t = "tummy"; it.v = Math.min(180, Math.round(d / 60));
          c.add(it, b);
          return;
        case "solid":
          it.t = "solid"; it.x = "y";
          it.tx = [K.get(r, ["Food", "Food Type", "Name"]), nt].map(function (x) { return K.clean(x, 100); }).filter(Boolean).join(" · ");
          c.add(it, b);
          return;
        case "note":
          it.t = "note"; it.tx = nt || K.get(r, ["Text", "Diary"]);
          if (!txt(it.tx)) { c.skip("bad"); return; }
          c.add(it, b);
          return;
      }
    });
    return c.done();
  }

  // ---------- 6. Detect + read ----------
  function parseText(text, name, opts) {
    var p = (opts && opts.prefs) || {};
    var o = { wu: p.wu, vu: p.vu, hint: opts && opts.hint };
    text = String(text === null || text === undefined ? "" : text);
    if (text.length > MAX_TEXT) return { error: "big" };
    var t0 = text.replace(/^﻿/, "").replace(/^\s+/, "");
    if (!t0) return { error: "empty" };
    if (t0.charAt(0) === "{" || t0.charAt(0) === "[") {
      var obj = K.json(t0);
      if (obj === null) return { error: "bad" };
      var j = bbJson(obj, name), models = Object.keys(j.groups);
      if (!models.length) return { error: "bad" };
      var cj = collector("babybuddy");
      models.forEach(function (m) { bbItems(cj, m, j.groups[m], o, j.names); });
      return cj.done();
    }
    var recs = K.records(t0, { maxRows: MAX_ITEMS });
    var head = recs.head;
    if (!head.length) return { error: "bad" };
    var bb = K.col(head, ["child", "method"]) !== -1;
    if (K.col(head, ["Type"]) !== -1 && K.col(head, ["Start", "Start Time"]) !== -1 &&
        (K.col(head, ["Start Condition", "End Condition", "Start Location"]) !== -1 ||
         (!bb && K.col(head, ["Duration", "End"]) !== -1))) return parseHuckleberry(recs, o);
    if (K.col(head, ["Baby", "Baby Name"]) !== -1 && K.col(head, ["Time", "Date"]) !== -1) return parseNighp(recs, name, o);
    // a Baby Tracker file without its Baby column, known by its name
    var nk = nighpKind([], name);
    if (!bb && K.col(head, ["Time"]) !== -1 && nk && nk.charAt(0) !== "?") return parseNighp(recs, name, o);
    var model = bbModel(head, name);
    if (model) {
      var c = collector("babybuddy");
      bbItems(c, model, recs.rows, o, null);
      return c.done();
    }
    return { error: "bad" };
  }

  // bytes: Uint8Array of the picked file
  function readBytes(bytes, name, opts) {
    if (!bytes || bytes.length > MAX_FILE) return Promise.resolve({ error: "big" });
    if (!K.isZip(bytes)) {
      var t;
      try { t = K.text(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
      return Promise.resolve(parseText(t, name, opts));
    }
    var z;
    try { z = K.unzip(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
    var names = z.names.filter(function (n) {
      return /\.(csv|json)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n);
    }).slice(0, MAX_ZIP_ENTRIES);
    var texts = [], total = 0;
    return names.reduce(function (p, n) {
      return p.then(function () {
        if (total > MAX_TEXT) return null;
        return z.text(n, MAX_TEXT).then(function (s) {
          total += s ? s.length : 0;
          if (s) texts.push({ n: n, s: s });
        }, function () {});
      });
    }, Promise.resolve()).then(function () {
      var o2 = { prefs: opts && opts.prefs, hint: textHint(texts.map(function (x) { return x.s; })) };
      var results = [];
      texts.forEach(function (x) {
        var r = parseText(x.s, x.n, o2);
        if (!r.error) results.push(r);
      });
      if (!results.length) return { error: names.length ? "empty" : "bad" };
      return combine(results);
    });
  }
  function combine(list) {
    var out = { source: list[0].source, items: [], babies: {}, skip: {}, units: {} }, src = {};
    list.forEach(function (r) {
      bump(src, r.source, r.items.length + 1);
      r.items.forEach(function (it) { if (out.items.length < MAX_ITEMS) { out.items.push(it); bump(out.babies, it.b); } });
      Object.keys(r.skip).forEach(function (k) { bump(out.skip, k, r.skip[k]); });
      Object.keys(r.units).forEach(function (k) { out.units[k] = r.units[k]; });
    });
    Object.keys(src).forEach(function (s) { if (src[s] > src[out.source]) out.source = s; });
    return out;
  }

  // ---------- 7. Plan against the current data ----------
  // A stable id from the child and the entry's own values.
  function idOf(kid, key) {
    var a = K.hash(kid + "\n" + key), b = K.hash(key + "\n" + kid + "#");
    return "imp" + ("0000000" + a).slice(-7) + ("0000000" + b).slice(-7);
  }
  function keyOf(it) {
    return [it.t, it.ts, it.e || "", it.ls || "", it.rs || "", it.ml || "", it.x || "", it.v || "", it.tx || ""].join("|");
  }
  // The baby of the file to import by default: the one named like
  // the child, else the one with the most entries.
  function pickBaby(res, kidName) {
    var names = Object.keys(res.babies || {}), want = low(kidName);
    if (names.length <= 1) return names[0] || "";
    for (var i = 0; i < names.length; i++) if (low(names[i]) === want || low(names[i]).split(" ")[0] === want.split(" ")[0] && want) return names[i];
    return names.sort(function (x, y) { return res.babies[y] - res.babies[x] || (x < y ? -1 : 1); })[0];
  }
  // data = the app's model (core.js); opts = { kid, baby, now }.
  // → { ev: [records], gr: [records], kinds: { t: { add, dup } },
  //     from, to (ms), skip: { label: n }, dup, total }
  // Records come out normalised (core.js), stamped opts.now; nothing
  // here changes data.
  function plan(res, data, opts) {
    opts = opts || {};
    var kid = opts.kid, now = opts.now || Date.now(), m = now;
    var baby = opts.baby === undefined ? pickBaby(res, "") : opts.baby;
    var out = { ev: [], gr: [], kinds: {}, from: 0, to: 0, skip: {}, dup: 0, total: 0 };
    Object.keys(res.skip || {}).forEach(function (k) { out.skip[k] = res.skip[k]; });
    var evById = {}, mine = {}, grDay = {};
    (data.ev || []).forEach(function (e) {
      evById[e.id] = e;
      if (!e.del && e.k === kid) (mine[e.t] = mine[e.t] || []).push(e.ts);
    });
    var grById = {};
    (data.gr || []).forEach(function (g) {
      grById[g.id] = g;
      if (g.del || g.k !== kid) return;
      var d = grDay[g.d] = grDay[g.d] || {};
      ["g", "l", "h"].forEach(function (f) { if (g[f] !== undefined) d[f] = 1; });
    });
    Object.keys(mine).forEach(function (t) { mine[t].sort(function (a, b) { return a - b; }); });
    function near(t, ts) {
      var list = mine[t];
      if (!list) return false;
      var lo = 0, hi = list.length - 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (Math.abs(list[mid] - ts) < SAME_MS) return true;
        if (list[mid] < ts) lo = mid + 1; else hi = mid - 1;
      }
      return false;
    }
    function kind(t) { return out.kinds[t] = out.kinds[t] || { add: 0, dup: 0 }; }
    function span(ts) {
      if (!out.from || ts < out.from) out.from = ts;
      if (!out.to || ts > out.to) out.to = ts;
    }
    var seen = {}, grNew = {};
    (res.items || []).forEach(function (it) {
      if ((it.b || "") !== (baby || "") && baby !== null) return;
      out.total++;
      if (it.t === "growth") {
        var d = grNew[it.d] = grNew[it.d] || {};
        ["g", "l", "h"].forEach(function (f) { if (isFinite(it[f]) && d[f] === undefined) d[f] = it[f]; });
        return;
      }
      if (it.ts > now) { bump(out.skip, "future"); return; }
      var id = idOf(kid, keyOf(it));
      if (seen[id]) return;
      seen[id] = 1;
      var cur = evById[id];
      if ((cur && !cur.del) || near(it.t, it.ts)) { kind(it.t).dup++; out.dup++; span(it.ts); return; }
      var rec = { id: id, k: kid, t: it.t, ts: it.ts };
      ["e", "ls", "rs", "sd", "ml", "x", "v", "tx"].forEach(function (f) { if (it[f] !== undefined) rec[f] = it[f]; });
      rec.m = cur ? Math.max(m, cur.m + 1) : m;          // an undone import comes back
      var n = C.normEv(rec);
      if (!n || n.del || (C.TIMED[n.t] && n.e === undefined)) { bump(out.skip, "bad"); return; }
      out.ev.push(n);
      kind(it.t).add++;
      span(it.ts);
    });
    var today = dayOf(now);
    Object.keys(grNew).sort().forEach(function (day) {
      var src = grNew[day], have = grDay[day] || {}, rec = { id: idOf(kid, "gr|" + day), k: kid, d: day }, any = false;
      if (day > today) { bump(out.skip, "future"); return; }
      var cur = grById[rec.id];
      ["g", "l", "h"].forEach(function (f) {
        if (src[f] === undefined) return;
        if (have[f] || (cur && !cur.del)) return;
        rec[f] = src[f];
        any = true;
      });
      var ms = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)).getTime();
      span(ms);
      if (!any) { kind("growth").dup++; out.dup++; return; }
      rec.m = cur ? Math.max(m, cur.m + 1) : m;
      var n = C.normGr(rec);
      if (!n || n.del) { bump(out.skip, "bad"); return; }
      out.gr.push(n);
      kind("growth").add++;
    });
    return out;
  }

  var API = {
    MAX_FILE: MAX_FILE, parseText: parseText, readBytes: readBytes, plan: plan, pickBaby: pickBaby,
    durSec: durSec, mlOf: mlOf, gramsOf: gramsOf, mmOf: mmOf, idOf: idOf
  };
  if (NODE) module.exports = API;
  else root.OrosBabyImport = API;
})(typeof self !== "undefined" ? self : this);
