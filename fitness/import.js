// ============================================================
// orOS Workouts — import.js ("Import workouts", v1.0.0)
// Reads files exported from other training apps and watches. Pure:
// no DOM, no storage; fitness.js runs the picker, the preview, the
// one write and the Undo. Strong / Hevy CSV stay in fitness.js
// (section 4b) and are passed in as opts.sets, so one entry point
// reads every source.
//
// Sources (detected from the bytes, the XML root, the CSV headers):
//   fitnotes  FitNotes CSV: Date, Exercise, Category, Weight (kg|lbs),
//             Reps, Distance, Distance Unit, Time, Comment. One row per
//             set; one workout per date.
//   jefit     JEFIT CSV: sections "### NAME" each with its own header
//             row. Logs (mydate, ename | eid → exercise section,
//             belongsession → session start / end) hold the sets as
//             "60x10,65x8". Units are not in the file.
//   fit       Garmin FIT (binary): session (18) and record (20)
//             messages; definition + data messages, compressed
//             timestamp headers, developer fields skipped, chained
//             files, 16 local types; CRC checked and reported.
//   tcx       Training Center XML: Activity Sport, laps (time,
//             distance, calories, heart rate), Track / Trackpoint.
//   gpx       GPX tracks (maps/tracks-core.js reads them), <type>.
//   zip       many .fit / .tcx / .gpx (also .gz, one nested zip
//             level): Garmin and Strava bulk exports.
//
// parse({ name, bytes }, { sets }) → Promise<result | null>
//   { kind: "sets", parsed }  rows in fitness.js parseImport's shape
//                             (buildImport there matches exercises)
//   { kind: "acts", src, files, bad, acts: [act] }
//   act = { key, src, sport, a ("run"|"walk"|"ride"|""), ex, title,
//           start, end (ms), time (s), dist (m), cal, hr, segs }
//   segs: [[[lat, lon, null, ms], ...], ...] as gps-core.js uses
// buildActs(data, acts, opts) → { wo[], skipped, gone, routes,
//   noRoute, kinds{}, from, to } workouts ready for mergeFit, ids
//   "imp-" + hash(start second): the same activity from another file
//   (FIT and GPX of one run) is one workout; a workout already here
//   within a minute of it (recorded live, Health Connect) is skipped;
//   a deleted one comes back only with opts.revive.
// UMD: window.OrosFitnessImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }
  function tracks() { return NODE ? require("../maps/tracks-core.js") : root.OrosMapsTracks; }
  function gps() { return NODE ? require("./gps-core.js") : root.OrosFitnessGps; }

  var MAX_FILE = 250 * 1024 * 1024;  // a picked file (a bulk zip)
  var MAX_ENTRY = 30 * 1024 * 1024;  // one activity file, inflated
  var MAX_ENTRIES = 5000;            // zip entries looked at
  var MAX_ACTS = 3000;               // activities from one import
  var MAX_ROWS = 100000;             // sets from one CSV
  var MAX_RECS = 200000;             // FIT records per file
  var MAX_PTS = 40000;               // route points per activity
  var ROUTE_BUDGET = 1500000;        // encoded route characters per import
  var ROUTE_ONE = 60000;             // one route; thinned harder above it
  var NAME_LEN = 60, NOTE_LEN = 200;
  var FIT_EPOCH = 631065600;         // 1989-12-31T00:00:00Z in Unix seconds
  var T_MIN = Date.UTC(1990, 0, 1);
  var F_DONE = 1;
  var ACT_EX = { run: "x-run", walk: "x-walk", ride: "x-bike", swim: "x-swim", row: "x-rowerg" };
  var ACCEPT = ".csv,.txt,.fit,.tcx,.gpx,.zip,.gz,text/csv,application/zip,application/gpx+xml";

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function low(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
  function okTime(ms) { return isNum(ms) && ms >= T_MIN && ms <= Date.now() + 86400000; }
  function idOf(key) { var K = kit(); return "imp-" + K.hash(key) + K.hash("~" + key); }

  // ---------- sports ----------
  // A sport name (any source) → our kind. FIT's enum is turned into a
  // name first (profile: 1 running, 2 cycling, 5 swimming, 11 walking,
  // 15 rowing, 17 hiking…).
  var FIT_SPORT = { 0: "generic", 1: "running", 2: "cycling", 4: "fitness equipment", 5: "swimming",
    6: "basketball", 7: "soccer", 8: "tennis", 10: "training", 11: "walking", 12: "cross country skiing",
    13: "alpine skiing", 14: "snowboarding", 15: "rowing", 16: "mountaineering", 17: "hiking",
    19: "paddling", 21: "e-biking", 37: "stand up paddleboarding", 41: "kayaking", 43: "golf" };
  function kindOf(sport) {
    var s = low(sport);
    if (/swim/.test(s)) return "swim";
    if (/row/.test(s)) return "row";
    if (/run|jog/.test(s)) return "run";
    if (/walk|hik|trek/.test(s)) return "walk";
    if (/cycl|bik|ride|biking/.test(s)) return "ride";
    return "";
  }
  function sportLabel(s) {
    s = kit().clean(String(s || "").replace(/[_-]+/g, " "), NAME_LEN);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }
  function mkAct(src, sport, start, end, time, dist, cal, hr, segs, title) {
    if (!okTime(start)) return null;
    var k = kindOf(sport);
    end = isNum(end) && end >= start ? end : start;
    time = isNum(time) && time > 0 ? Math.round(time) : Math.round((end - start) / 1000);
    var a = k === "run" || k === "walk" || k === "ride" ? k : "";
    return {
      key: "act|" + Math.round(start / 1000), src: src, sport: sportLabel(sport), a: a, ex: ACT_EX[k] || "",
      title: kit().clean(title || "", NAME_LEN), start: Math.round(start), end: Math.round(end),
      time: Math.max(0, time), dist: isNum(dist) && dist > 0 ? Math.round(dist) : 0,
      cal: isNum(cal) && cal > 0 && cal < 50000 ? Math.round(cal) : 0,
      hr: isNum(hr) && hr > 20 && hr < 260 ? Math.round(hr) : 0,
      segs: segs || []
    };
  }
  function segsDist(segs) {
    var MT = tracks(), d = 0;
    segs.forEach(function (s) { for (var i = 1; i < s.length; i++) d += MT.distM(s[i - 1][0], s[i - 1][1], s[i][0], s[i][1]); });
    return d;
  }

  // ---------- FIT (binary) ----------
  var CRC_T = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
               0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
  function crc16(b, from, to, crc) {
    crc = crc || 0;
    for (var i = from; i < to; i++) {
      var x = b[i], t = CRC_T[crc & 0xF];
      crc = ((crc >> 4) & 0x0FFF) ^ t ^ CRC_T[x & 0xF];
      t = CRC_T[crc & 0xF];
      crc = ((crc >> 4) & 0x0FFF) ^ t ^ CRC_T[(x >> 4) & 0xF];
    }
    return crc;
  }
  function isFit(b) {
    return !!b && b.length >= 12 && (b[0] === 12 || b[0] === 14) &&
      b[8] === 0x2E && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54;   // ".FIT"
  }
  // One value of a field; arrays give their first element. null =
  // the format's "invalid" value or a type we do not need.
  var BASE = { 0: [1, "u8", 0xFF], 1: [1, "s8", 0x7F], 2: [1, "u8", 0xFF], 3: [2, "s16", 0x7FFF],
    4: [2, "u16", 0xFFFF], 5: [4, "s32", 0x7FFFFFFF], 6: [4, "u32", 0xFFFFFFFF], 8: [4, "f32", null],
    9: [8, "f64", null], 10: [1, "u8", 0], 11: [2, "u16", 0], 12: [4, "u32", 0], 13: [1, "u8", 0xFF] };
  function readVal(dv, o, size, bt, le) {
    var t = BASE[bt & 0x1F];
    if (!t || size < t[0]) return null;
    var v;
    switch (t[1]) {
      case "u8": v = dv.getUint8(o); break;
      case "s8": v = dv.getInt8(o); break;
      case "u16": v = dv.getUint16(o, le); break;
      case "s16": v = dv.getInt16(o, le); break;
      case "u32": v = dv.getUint32(o, le); break;
      case "s32": v = dv.getInt32(o, le); break;
      case "f32": v = dv.getFloat32(o, le); return isFinite(v) ? v : null;
      case "f64": v = dv.getFloat64(o, le); return isFinite(v) ? v : null;
    }
    return v === t[2] ? null : v;
  }
  // bytes → { sessions: [{ field: value }], records: [...], crcOk }
  // or null. Stops quietly at the first thing it cannot read, so a
  // file cut short still gives what came before.
  function decodeFit(b) {
    if (!isFit(b)) return null;
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    var sessions = [], records = [], crcOk = true, p = 0, files = 0;
    while (p + 12 <= b.length && isFit(b.subarray(p, p + 12)) && files++ < 50) {
      var hs = b[p], size = dv.getUint32(p + 4, true);
      var end = Math.min(p + hs + size, b.length);
      if (end + 2 <= b.length) crcOk = crcOk && crc16(b, p, end) === dv.getUint16(end, true);
      else crcOk = false;
      var defs = {}, lastTs = 0, q = p + hs;
      while (q < end) {
        var h = b[q++], def, local, ts = null;
        if (h & 0x80) {                                  // compressed timestamp header
          local = (h >> 5) & 3;
          var off = h & 0x1F;
          ts = (lastTs & ~0x1F) + off;
          if (off < (lastTs & 0x1F)) ts += 0x20;
          ts = ts >>> 0;
          lastTs = ts;
        } else local = h & 0x0F;
        if (!(h & 0x80) && (h & 0x40)) {                 // definition message
          if (q + 5 > end) break;
          var le = b[q + 1] === 0, nf = b[q + 4];
          var g = le ? dv.getUint16(q + 2, true) : dv.getUint16(q + 2, false);
          q += 5;
          if (q + nf * 3 > end) { q = end; break; }
          var fields = [], total = 0;
          for (var i = 0; i < nf; i++) {
            fields.push([b[q], b[q + 1], b[q + 2]]);
            total += b[q + 1];
            q += 3;
          }
          var dev = 0;
          if (h & 0x20) {                                // developer fields: sizes only
            if (q >= end) break;
            var nd = b[q++];
            if (q + nd * 3 > end) { q = end; break; }
            for (var j = 0; j < nd; j++) { dev += b[q + 1]; q += 3; }
          }
          defs[local] = { g: g, le: le, fields: fields, size: total + dev };
          continue;
        }
        def = defs[local];
        if (!def || q + def.size > end) break;
        var msg = {}, o = q;
        if (def.g === 18 || def.g === 20) {
          for (var k = 0; k < def.fields.length; k++) {
            var f = def.fields[k];
            msg[f[0]] = readVal(dv, o, f[1], f[2], def.le);
            o += f[1];
          }
        } else {
          // other messages: only the timestamp, to follow compressed headers
          for (var k2 = 0; k2 < def.fields.length; k2++) {
            if (def.fields[k2][0] === 253) msg[253] = readVal(dv, o, def.fields[k2][1], def.fields[k2][2], def.le);
            o += def.fields[k2][1];
          }
        }
        q += def.size;
        if (msg[253] != null) lastTs = msg[253];
        else if (ts != null) msg[253] = ts;
        if (def.g === 18 && sessions.length < 100) sessions.push(msg);
        else if (def.g === 20 && records.length < MAX_RECS) records.push(msg);
      }
      p = end + 2;
    }
    return { sessions: sessions, records: records, crcOk: crcOk };
  }
  function fitMs(v) { return isNum(v) ? (v + FIT_EPOCH) * 1000 : NaN; }
  var SEMI = 180 / 2147483648;
  // records → route points between two instants (a pause > 5 min starts a new segment)
  function fitSegs(records, from, to) {
    var segs = [], seg = [], last = 0, n = 0;
    records.forEach(function (r) {
      var t = fitMs(r[253]);
      if (!okTime(t) || t < from || t > to || r[0] == null || r[1] == null || n >= MAX_PTS) return;
      var lat = r[0] * SEMI, lon = r[1] * SEMI;
      if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) || (lat === 0 && lon === 0)) return;
      if (seg.length && t - last > 300000) { segs.push(seg); seg = []; }
      seg.push([Math.round(lat * 1e7) / 1e7, Math.round(lon * 1e7) / 1e7, null, t]);
      last = t; n++;
    });
    if (seg.length) segs.push(seg);
    return segs.filter(function (s) { return s.length > 1; });
  }
  function hrAvg(records, from, to) {
    var s = 0, n = 0;
    records.forEach(function (r) {
      var t = fitMs(r[253]);
      if (r[3] != null && t >= from && t <= to) { s += r[3]; n++; }
    });
    return n ? s / n : 0;
  }
  // bytes → [act]
  function parseFit(b) {
    var f = decodeFit(b);
    if (!f) return [];
    var out = [], recs = f.records;
    var sess = f.sessions.filter(function (s) { return okTime(fitMs(s[2])) || okTime(fitMs(s[253])); });
    sess.forEach(function (s) {
      var elapsed = isNum(s[7]) ? s[7] / 1000 : NaN, timer = isNum(s[8]) ? s[8] / 1000 : NaN;
      var start = fitMs(s[2]), endTs = fitMs(s[253]);
      if (!okTime(start)) start = isNum(elapsed) ? endTs - elapsed * 1000 : endTs;
      var end = isNum(elapsed) ? start + elapsed * 1000 : (okTime(endTs) ? endTs : start);
      var segs = fitSegs(recs, start - 1000, end + 1000);
      var dist = isNum(s[9]) ? s[9] / 100 : segsDist(segs);
      var hr = s[16] != null ? s[16] : hrAvg(recs, start, end);
      var sport = FIT_SPORT[s[5]] != null ? FIT_SPORT[s[5]] : "";
      var a = mkAct("fit", sport, start, end, isNum(timer) ? timer : elapsed, dist, s[11], hr, segs, "");
      if (a) out.push(a);
    });
    if (!out.length && recs.length) {        // no session message: the records alone
      var ts = recs.map(function (r) { return fitMs(r[253]); }).filter(okTime);
      if (ts.length > 1) {
        var st = Math.min.apply(null, ts), en = Math.max.apply(null, ts), segs2 = fitSegs(recs, st, en), dmax = 0;
        recs.forEach(function (r) { if (isNum(r[5]) && r[5] / 100 > dmax) dmax = r[5] / 100; });
        var x = mkAct("fit", "", st, en, 0, dmax || segsDist(segs2), 0, hrAvg(recs, st, en), segs2, "");
        if (x) out.push(x);
      }
    }
    return out;
  }

  // ---------- TCX (XML) ----------
  function blocks(text, tag) {
    var re = new RegExp("<(?:[\\w-]+:)?" + tag + "\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?" + tag + "\\s*>)", "g");
    var out = [], m;
    while ((m = re.exec(text))) out.push({ attrs: m[1] || "", inner: m[2] || "" });
    return out;
  }
  function child(inner, tag) {
    var m = new RegExp("<(?:[\\w-]+:)?" + tag + "\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?" + tag + "\\s*>").exec(inner || "");
    return m ? tracks().decodeXml(m[1]).trim() : null;
  }
  function attrOf(attrs, name) {
    var m = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')").exec(attrs || "");
    return m ? (m[2] !== undefined ? m[2] : m[3]) : "";
  }
  function xnum(s) { var v = s == null ? NaN : parseFloat(s); return isFinite(v) ? v : NaN; }
  function parseTcx(text) {
    var MT = tracks(), out = [];
    blocks(text, "Activity").forEach(function (act) {
      if (out.length >= MAX_ACTS) return;
      var laps = blocks(act.inner, "Lap"), start = NaN, end = NaN, time = 0, dist = 0, cal = 0, hrS = 0, hrT = 0;
      var segs = [], n = 0;
      laps.forEach(function (lap) {
        var head = lap.inner.replace(/<(?:[\w-]+:)?Track\b[\s\S]*$/, "");    // the lap's own fields
        var ls = MT.parseTime(attrOf(lap.attrs, "StartTime")), lt = xnum(child(head, "TotalTimeSeconds"));
        var ld = xnum(child(head, "DistanceMeters")), lc = xnum(child(head, "Calories"));
        var avg = blocks(head, "AverageHeartRateBpm")[0], lh = avg ? xnum(child(avg.inner, "Value")) : NaN;
        if (ls && !(start <= ls)) start = ls;
        if (lt > 0) { time += lt; if (ls) end = Math.max(isNum(end) ? end : 0, ls + lt * 1000); }
        if (ld > 0) dist += ld;
        if (lc > 0) cal += lc;
        if (lh > 0 && lt > 0) { hrS += lh * lt; hrT += lt; }
        blocks(lap.inner, "Track").forEach(function (tr) {
          var seg = [];
          blocks(tr.inner, "Trackpoint").forEach(function (tp) {
            var t = MT.parseTime(child(tp.inner, "Time"));
            if (t && !(start <= t)) start = t;
            if (t && !(end >= t)) end = t;
            var pos = blocks(tp.inner, "Position")[0];
            if (!pos || !t || n >= MAX_PTS) return;
            var lat = xnum(child(pos.inner, "LatitudeDegrees")), lon = xnum(child(pos.inner, "LongitudeDegrees"));
            if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return;
            seg.push([lat, lon, null, t]);
            n++;
            if (!hrT) {
              var hb = blocks(tp.inner, "HeartRateBpm")[0], v = hb ? xnum(child(hb.inner, "Value")) : NaN;
              if (v > 0) { seg.hs = (seg.hs || 0) + v; seg.hn = (seg.hn || 0) + 1; }
            }
          });
          if (seg.length > 1) segs.push(seg);
        });
      });
      if (!hrT) segs.forEach(function (s) { if (s.hn) { hrS += s.hs; hrT += s.hn; } });
      if (!dist && segs.length) dist = segsDist(segs);
      var id = MT.parseTime(child(act.inner, "Id"));
      if (!isNum(start) && id) start = id;
      var notes = child(act.inner.replace(/<(?:[\w-]+:)?Lap\b[\s\S]*$/, ""), "Notes");
      var a = mkAct("tcx", attrOf(act.attrs, "Sport"), start, end, time, dist, cal, hrT ? hrS / hrT : 0, segs, notes);
      if (a) out.push(a);
    });
    return out;
  }

  // ---------- GPX (tracks-core.js) ----------
  function parseGpxAct(text) {
    var MT = tracks(), tr;
    try { tr = MT.parseGpx(text); } catch (e) { return []; }
    var segs = [], n = 0;
    tr.segs.forEach(function (s) {
      var seg = s.filter(function (p) { return p[3] != null; }).slice(0, Math.max(0, MAX_PTS - n))
        .map(function (p) { return [p[0], p[1], null, p[3]]; });
      n += seg.length;
      if (seg.length > 1) segs.push(seg);
    });
    if (!segs.length) return [];                 // a route without times has no date
    var start = segs[0][0][3], last = segs[segs.length - 1], end = last[last.length - 1][3];
    var trk = blocks(text, "trk")[0], type = trk ? child(trk.inner.replace(/<(?:[\w-]+:)?trkseg\b[\s\S]*$/, ""), "type") : "";
    // Strava's numeric <type>: 1 ride, 4 hike, 9 run, 10 walk
    var STRAVA = { 1: "cycling", 4: "hiking", 9: "running", 10: "walking" };
    if (/^\d+$/.test(type || "")) type = STRAVA[type] || "";
    var a = mkAct("gpx", type || "", start, end, 0, segsDist(segs), 0, 0, segs, tr.name);
    return a ? [a] : [];
  }

  // ---------- FitNotes CSV ----------
  function secsOf(v) {
    var s = kit().clean(v, 20), m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
    if (m) return m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
    var n = kit().num(s);
    return n > 0 ? Math.round(n) : 0;
  }
  function metres(v, unit) {
    var n = kit().num(v);
    if (!(n > 0)) return 0;
    var u = low(unit).replace(/[^a-z]/g, "");
    if (u === "km" || u === "kms" || u === "kilometres" || u === "kilometers") return n * 1000;
    if (u === "mi" || u === "mile" || u === "miles") return n * 1609.344;
    if (u === "ft" || u === "feet") return n * 0.3048;
    if (u === "yd" || u === "yards") return n * 0.9144;
    return n;                                            // m (FitNotes' default)
  }
  function parseFitNotes(text) {
    var K = kit(), t = K.csv(text);
    var head = t.head, c = function (n) { return K.col(head, n); };
    var cDate = c(["Date"]), cEx = c(["Exercise", "Exercise Name"]), cCat = c(["Category"]);
    if (cDate < 0 || cEx < 0 || cCat < 0 || c(["Reps"]) < 0) return null;
    var cKg = c(["Weight (kg)", "Weight kg", "Weight (kgs)"]), cLb = c(["Weight (lbs)", "Weight (lb)", "Weight lbs"]);
    var cW = c(["Weight"]), cWu = c(["Weight Unit", "Unit"]), cR = c(["Reps"]);
    var cD = c(["Distance"]), cDu = c(["Distance Unit"]), cT = c(["Time", "Duration"]), cN = c(["Comment", "Notes"]);
    var rows = [], known = true;
    t.rows.slice(0, MAX_ROWS).forEach(function (r) {
      var g = function (i) { return i >= 0 && r[i] != null ? String(r[i]) : ""; };
      var day = K.ymd(g(cDate)), ex = K.clean(g(cEx), NAME_LEN);
      if (!day || !ex) return;
      var wu = cKg >= 0 ? "kg" : cLb >= 0 ? "lb" : "", w;
      if (wu) w = K.num(g(wu === "kg" ? cKg : cLb));
      else {
        w = K.num(g(cW));
        var u = low(g(cWu));
        wu = /^kg/.test(u) ? "kg" : /^lb/.test(u) ? "lb" : "";
      }
      w = w > 0 ? w : 0;
      if (w && !wu) known = false;
      var reps = Math.round(Math.max(0, K.num(g(cR)) || 0)), dist = metres(g(cD), g(cDu)), secs = secsOf(g(cT));
      if (!w && !reps && !dist && !secs) return;
      var p = day.split("-"), start = new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0).getTime();
      rows.push({ key: "fitnotes|" + day, start: start, end: start, title: "", note: "", ex: ex,
                  exNote: K.clean(g(cN), NOTE_LEN), warm: false, w: w, wu: wu, r: reps, t: secs, dist: dist, du: "m" });
    });
    return rows.length ? { src: "fitnotes", unitKnown: known, rows: rows } : null;
  }

  // ---------- JEFIT CSV ----------
  // "### NAME" lines split the file; each section is a CSV of its own.
  function jefitSections(text) {
    var out = [], cur = null;
    String(text).replace(/^\ufeff/, "").split(/\r\n?|\n/).forEach(function (line) {
      var m = /^\s*#{2,}\s*(.*?)\s*#*\s*$/.exec(line);
      if (m && /^\s*###/.test(line)) { cur = { name: low(m[1]), lines: [] }; out.push(cur); return; }
      if (cur && line.trim()) cur.lines.push(line);
    });
    return out.map(function (s) {
      var t = kit().csv(s.lines.join("\n"));
      return { name: s.name, head: t.head, rows: t.rows };
    }).filter(function (s) { return s.head.length; });
  }
  // "60x10,65 x 8,x12" → [[weight, reps]]
  function jefitSets(s) {
    var out = [];
    String(s || "").split(/[,;|]/).forEach(function (part) {
      var m = /^\s*([\d.]*)\s*[x×*]\s*(\d+)/i.exec(part);
      if (!m) return;
      var w = parseFloat(m[1]) || 0, r = +m[2];
      if (w > 0 || r > 0) out.push([w, r]);
    });
    return out;
  }
  function parseJefit(text) {
    if (!/^\s*\ufeff?\s*###/m.test(String(text).slice(0, 4000))) return null;
    var K = kit(), secs = jefitSections(text);
    var names = {}, sess = {}, logs = null;
    secs.forEach(function (s) {
      var c = function (n) { return K.col(s.head, n); };
      var cLogs = c(["logs", "log", "sets"]), cDate = c(["mydate", "date"]);
      if (cLogs >= 0 && cDate >= 0) { if (!logs) logs = s; return; }
      var cId = c(["_id", "eid", "id", "exerciseid"]), cName = c(["name", "ename", "exercisename", "exercise name"]);
      if (cId >= 0 && cName >= 0 && /exercise|custom/.test(s.name)) {
        s.rows.forEach(function (r) { var nm = K.clean(r[cName], NAME_LEN); if (nm && r[cId] != null) names[String(r[cId]).trim()] = nm; });
        return;
      }
      var cSt = c(["starttime", "start_time", "start"]);
      if (cId >= 0 && (cSt >= 0 || cDate >= 0) && /session|workout/.test(s.name)) {
        var cEn = c(["endtime", "end_time", "end"]), cTot = c(["total_time", "totaltime", "duration"]);
        s.rows.forEach(function (r) {
          var st = cSt >= 0 ? K.parseDate(K.clean(r[cSt], 40)) : NaN;
          if (!okTime(st) && cDate >= 0) st = K.parseDate(K.clean(r[cDate], 40));
          if (!okTime(st)) return;
          var en = cEn >= 0 ? K.parseDate(K.clean(r[cEn], 40)) : NaN, tot = cTot >= 0 ? K.num(r[cTot]) : NaN;
          if (!(en >= st) && tot > 0) en = st + tot * 1000;
          sess[String(r[cId]).trim()] = { st: st, en: en >= st ? en : st };
        });
      }
    });
    if (!logs) return null;
    var c = function (n) { return K.col(logs.head, n); };
    var cDate = c(["mydate", "date"]), cName = c(["ename", "exercisename", "exercise name", "exercise", "name"]);
    var cEid = c(["eid", "exerciseid"]), cSess = c(["belongsession", "sessionid", "session"]), cLogs = c(["logs", "log", "sets"]);
    var rows = [];
    logs.rows.slice(0, MAX_ROWS).forEach(function (r) {
      var day = K.ymd(K.clean(r[cDate], 40));
      var ex = cName >= 0 ? K.clean(r[cName], NAME_LEN) : "";
      if (!ex && cEid >= 0) ex = names[String(r[cEid] == null ? "" : r[cEid]).trim()] || "";
      var sid = cSess >= 0 ? String(r[cSess] == null ? "" : r[cSess]).trim() : "", s = sid && sess[sid];
      if (!day && s) day = K.ymd(s.st);
      if (!day || !ex) return;
      var p = day.split("-"), start = s ? s.st : new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0).getTime();
      jefitSets(r[cLogs]).forEach(function (st) {
        if (rows.length >= MAX_ROWS) return;
        rows.push({ key: "jefit|" + (s ? "s" + sid : day), start: start, end: s ? s.en : start, title: "", note: "", ex: ex,
                    exNote: "", warm: false, w: st[0], wu: "", r: st[1], t: 0, dist: 0, du: "m" });
      });
    });
    return rows.length ? { src: "jefit", unitKnown: !rows.some(function (x) { return x.w > 0; }), rows: rows } : null;
  }

  // ---------- files ----------
  function gunzip(bytes, max) {
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("inflate"));
    var ds = new DecompressionStream("gzip"), w = ds.writable.getWriter();
    w.write(bytes).then(null, function () {});
    w.close().then(null, function () {});
    var rd = ds.readable.getReader(), parts = [], total = 0;
    function pump() {
      return rd.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), o = 0;
          parts.forEach(function (c) { out.set(c, o); o += c.length; });
          return out;
        }
        total += r.value.length;
        if (total > max) { try { rd.cancel(); } catch (e) {} throw new Error("toobig"); }
        parts.push(r.value);
        return pump();
      });
    }
    return pump();
  }
  function isGz(b) { return !!b && b.length > 2 && b[0] === 0x1f && b[1] === 0x8b; }
  // One activity file (bytes) → [act]
  function actsOf(name, bytes) {
    if (isFit(bytes)) return parseFit(bytes);
    var head = kit().text(bytes.subarray(0, 2000));
    if (/<(?:[\w-]+:)?TrainingCenterDatabase\b/.test(head) || /\.tcx$/i.test(name)) return parseTcx(kit().text(bytes));
    if (/<(?:[\w-]+:)?gpx\b/.test(head) || /\.gpx$/i.test(name)) return parseGpxAct(kit().text(bytes));
    return [];
  }
  var ACT_NAME = /\.(fit|tcx|gpx)(\.gz)?$/i;
  // A zip: every activity file in it (and in zips inside it, one level).
  function fromZip(bytes, depth, res) {
    var z;
    try { z = kit().unzip(bytes); } catch (e) { res.bad++; return Promise.resolve(); }
    var list = z.names.slice(0, MAX_ENTRIES);
    var i = 0;
    function next() {
      if (i >= list.length || res.acts.length >= MAX_ACTS) return Promise.resolve();
      var n = list[i++];
      if (/(^|\/)(__MACOSX|\.)/.test(n)) return next();
      var isAct = ACT_NAME.test(n), isZipN = /\.zip$/i.test(n) && depth < 1;
      if (!isAct && !isZipN) return next();
      if (z.size(n) > (isZipN ? MAX_FILE : MAX_ENTRY)) { res.bad++; return next(); }
      return z.bytes(n, isZipN ? MAX_FILE : MAX_ENTRY).then(function (b) {
        if (!b) return null;
        if (isZipN) return fromZip(b, depth + 1, res);
        return (isGz(b) ? gunzip(b, MAX_ENTRY) : Promise.resolve(b)).then(function (raw) {
          res.files++;
          var got = actsOf(n.replace(/\.gz$/i, ""), raw);
          if (!got.length) res.bad++;
          got.forEach(function (a) { if (res.acts.length < MAX_ACTS) res.acts.push(a); });
        });
      }).then(null, function () { res.bad++; }).then(next);
    }
    return next();
  }
  // { name, bytes } → Promise<result | null>; opts.sets(text) is
  // fitness.js's Strong / Hevy reader (tried first on CSV text).
  function parse(file, opts) {
    opts = opts || {};
    var K = kit(), name = String(file && file.name || ""), bytes = file && file.bytes;
    if (!bytes || !bytes.length) return Promise.resolve(null);
    if (isGz(bytes)) {
      return gunzip(bytes, MAX_ENTRY).then(function (b) { return parse({ name: name.replace(/\.gz$/i, ""), bytes: b }, opts); });
    }
    if (K.isZip(bytes)) {
      var res = { kind: "acts", src: "zip", files: 0, bad: 0, acts: [] };
      return fromZip(bytes, 0, res).then(function () { return res.acts.length ? res : null; });
    }
    if (isFit(bytes)) {
      var fa = parseFit(bytes);
      return Promise.resolve(fa.length ? { kind: "acts", src: "fit", files: 1, bad: 0, acts: fa } : null);
    }
    var text = K.text(bytes), head = text.slice(0, 2000);
    if (/<(?:[\w-]+:)?(TrainingCenterDatabase|gpx)\b/.test(head) || /\.(tcx|gpx)$/i.test(name)) {
      var xa = actsOf(name, bytes), src = /TrainingCenterDatabase/.test(head) || /\.tcx$/i.test(name) ? "tcx" : "gpx";
      return Promise.resolve(xa.length ? { kind: "acts", src: src, files: 1, bad: 0, acts: xa } : null);
    }
    var parsed = null;
    if (typeof opts.sets === "function") { try { parsed = opts.sets(text); } catch (e) { parsed = null; } }
    if (!parsed) parsed = parseJefit(text) || parseFitNotes(text);
    return Promise.resolve(parsed ? { kind: "sets", parsed: parsed } : null);
  }

  // ---------- merge plan ----------
  // data: the Workouts data (fitness.js shape); acts from parse();
  // opts: { now, revive, label(key) → text for "gps.run" etc.,
  //         note(act) → note text }.
  function buildActs(d, acts, opts) {
    opts = opts || {};
    var G = gps(), now = opts.now || Date.now(), tombs = d.tombs || {};
    var have = {}, starts = [];
    (d.wo || []).forEach(function (w) { have[w.id] = 1; starts.push(w.st); });
    starts.sort(function (a, b) { return a - b; });
    function near(t) {                    // a workout here starting within a minute
      var lo = 0, hi = starts.length - 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (Math.abs(starts[mid] - t) < 60000) return true;
        if (starts[mid] < t) lo = mid + 1; else hi = mid - 1;
      }
      return false;
    }
    // one per start second; the copy with a route wins
    var byKey = {}, order = [];
    acts.forEach(function (a) {
      var o = byKey[a.key];
      if (!o) { byKey[a.key] = a; order.push(a.key); return; }
      if (!o.segs.length && a.segs.length) byKey[a.key] = a;
    });
    var wo = [], skipped = 0, gone = 0, routes = 0, noRoute = 0, budget = ROUTE_BUDGET, kinds = {}, from = "", to = "";
    order.sort(function (a, b) { return byKey[a].start - byKey[b].start; });
    order.forEach(function (k) {
      var a = byKey[k], id = idOf(k), tk = "wo:" + id;
      if (have[id]) { skipped++; return; }
      if (tk in tombs) { gone++; if (!opts.revive) return; }
      else if (near(a.start)) { skipped++; return; }
      var m = Math.max(now, (tombs[tk] || 0) + 1);
      var x = a.ex ? [{ e: a.ex, tr: 0, tr2: 0, rest: 0, s: [[0, 0, Math.min(a.time, 7 * 86400), Math.min(a.dist, 1000000), F_DONE]] }] : [];
      var w = { id: id, m: m, d: ymd(a.start), st: a.start, en: Math.max(a.start, a.end, a.start + a.time * 1000),
                ti: a.title || (a.a && opts.label ? opts.label("gps." + a.a) : "") || (a.ex ? "" : a.sport),
                p: "", pd: "", n: opts.note ? opts.note(a) : "", x: x };
      if (a.a && a.segs.length && G) {
        var sg = encRoute(G, a.segs, a.start);
        if (sg && sg.chars <= budget) { w.g = { a: a.a, ps: 0, sg: sg.list }; budget -= sg.chars; routes++; }
        else noRoute++;
      }
      kinds[a.a || (a.ex === "x-swim" ? "swim" : "other")] = (kinds[a.a || (a.ex === "x-swim" ? "swim" : "other")] || 0) + 1;
      if (!from || w.d < from) from = w.d;
      if (!to || w.d > to) to = w.d;
      wo.push(w);
    });
    return { wo: wo, skipped: skipped, gone: gone, routes: routes, noRoute: noRoute, kinds: kinds, from: from, to: to };
  }
  // Thinned (3 m, then 10 m when long) and encoded as gps-core.js stores it.
  function encRoute(G, segs, t0) {
    var tol = [3, 10, 25];
    for (var i = 0; i < tol.length; i++) {
      var list = G.thin(segs, tol[i]).filter(function (s) { return s.length > 1; }).slice(0, 60)
        .map(function (s) { return G.encSeg(s, t0); });
      var chars = 0;
      list.forEach(function (s) { chars += s.length; });
      if (chars <= ROUTE_ONE || i === tol.length - 1) return chars <= ROUTE_ONE * 2 && list.length ? { list: list, chars: chars } : null;
    }
    return null;
  }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(ms) { var d = new Date(ms); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }

  var API = {
    ACCEPT: ACCEPT, MAX_FILE: MAX_FILE, ROUTE_BUDGET: ROUTE_BUDGET,
    parse: parse, parseFitNotes: parseFitNotes, parseJefit: parseJefit, parseTcx: parseTcx,
    parseGpx: parseGpxAct, parseFit: parseFit, decodeFit: decodeFit, crc16: crc16,
    kindOf: kindOf, buildActs: buildActs, idOf: idOf
  };
  if (NODE) module.exports = API;
  else root.OrosFitnessImport = API;
})(typeof self !== "undefined" ? self : this);
