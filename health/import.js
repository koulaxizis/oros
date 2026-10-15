// ============================================================
// orOS Health — import.js ("Import from another app", v1.0.0)
// Reads measurements the person exported from another health app,
// as DATA only (nothing is run, nothing becomes HTML). Pure: no DOM,
// no storage; health.js runs the picker, the preview, the one write
// and the Undo.
//
// Sources (detected from zip entry names, CSV headers, XML):
//   withings  Health Mate › Download my data (a ZIP of CSVs) or one
//             CSV: weight.csv (Date, Weight (kg|lb), Fat mass, Bone
//             mass, Muscle mass, Hydration, Comments), bp.csv (Date,
//             Heart rate, Systolic, Diastolic, Comments), and CSVs
//             with Date + SpO2 / Temperature. Other files are skipped.
//   omron     OMRON connect CSV: Date, Time, Systolic (mmHg),
//             Diastolic (mmHg), Pulse (bpm), Irregular heartbeat
//             detected, Body movement, Notes. D/M/Y or M/D/Y is told
//             from the dates themselves.
//   samsung   Samsung Health › Download personal data (a ZIP of
//             CSVs, or one of them): com.samsung.health.weight.<ts>
//             .csv, com.samsung.shealth.blood_pressure…, …tracker.
//             heart_rate…, …blood_glucose (mmol/L), …oxygen_
//             saturation, …body_temperature. Line 1 is metadata, the
//             header comes next; columns may carry the file's prefix
//             ("com.samsung.health.weight.start_time"); start_time is
//             UTC.
//   apple     Apple Health › Export All Health Data: export.zip with
//             apple_health_export/export.xml (often hundreds of MB),
//             or the unzipped export.xml. The XML is never parsed as
//             a DOM: it streams through in chunks (Blob.stream, the
//             zip entry inflated as it streams) and a regex picks the
//             <Record type="HKQuantityTypeIdentifier…"> tags Health
//             can store. Systolic + diastolic with the same start
//             date and source become one blood pressure.
// Heart rate: Health keeps the resting heart rate. A source's own
// resting value (Apple RestingHeartRate) is taken as is; when a file
// has only heart-rate samples (Apple HeartRate, Samsung tracker),
// they fold into ONE reading per day: the day's lowest sample.
// Only Health's built-in kinds are read (blood pressure, weight,
// blood sugar, resting heart rate, temperature, SpO2); body
// composition and height are counted as skipped.
//
// readBlob(blob, name, onProgress) → Promise<result>; readBytes(bytes,
// name) → the same from a Uint8Array; parseText(text, name) → result
// (one CSV or a whole XML text, synchronous). Result:
//   { source, items: [{ t, at, v: [storage ints], n, fl: [flag] }],
//     skip: { comp, height, hrs, bad, dup, half, other }, conv: { lb,
//     mmol, f, frac }, hrDays } or { error: "bad"|"empty"|"big" }
//   fl: "ihb" irregular heartbeat, "mv" body movement (Omron)
// plan(res, data, max) → { add: [entry without m], have, per: { t: {
//   n, add } }, from, to, cut }: entries that are not in Health yet
//   (at most max, the most recent; cut = how many older ones not). Ids are
//   "imp-" + two hashes of type|time|values, so a second import of
//   the same file adds nothing; a reading the person typed with the
//   same kind, minute and values counts as already there.
// Caps: file / zip entry sizes, CSV files per zip, readings.
// Needs OrosImportKit (../importkit.js) and OrosHealthCore (core.js).
// UMD: window.OrosHealthImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }
  function core() { return NODE ? require("./core.js") : root.OrosHealthCore; }

  var MAX_FILE = 200 * 1024 * 1024;        // a ZIP / CSV read whole (not Apple's XML)
  var MAX_CSV = 40 * 1024 * 1024;          // inflated bytes of one CSV
  var MAX_XML = 6 * 1024 * 1024 * 1024;    // Apple export.xml streamed (bytes)
  var MAX_CD = 32 * 1024 * 1024;           // zip central directory
  var MAX_ZIP_CSV = 120;                   // CSVs read from one zip
  var MAX_ITEMS = 300000;                  // readings from one file
  var MAX_TAIL = 1024 * 1024;              // unfinished XML tag carried over
  var NOTE_LEN = 500;
  var SRC_TAG = { withings: "Withings", omron: "OMRON", samsung: "Samsung Health", apple: "Apple Health" };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function truthy(v) { return /^(true|yes|y|1|x|on|detected|ναι)$/i.test(String(v == null ? "" : v).trim()); }

  // ---------- 1. Collecting readings ----------
  // One collector per file: validates against Health's ranges (core
  // SPEC), drops exact duplicates (type + time + values), folds
  // heart-rate samples into daily lows.
  function collector() {
    var C = core();
    var c = { source: "", items: [], skip: { comp: 0, height: 0, hrs: 0, bad: 0, dup: 0, half: 0, other: 0 },
              conv: { lb: 0, mmol: 0, f: 0, frac: 0 }, hrDays: 0 };
    var seen = {}, hrLow = {}, restN = 0;
    c.add = function (t, at, v, n, fl) {
      var spec = C.SPEC[t];
      if (!spec || !isFinite(at) || at < 0 || at > 4102444800000) { c.skip.bad++; return; }
      var out = [];
      for (var i = 0; i < spec.length; i++) {
        var x = Math.round(+v[i]);
        var ok = isFinite(x) && x >= spec[i][0] && x <= spec[i][1];
        if (!ok && spec[i][2]) { c.skip.bad++; return; }
        out.push(ok ? x : 0);
      }
      if (t === "bp" && out[1] >= out[0]) { c.skip.bad++; return; }
      at = Math.round(at);
      var key = t + "|" + at + "|" + out.join(",");
      if (seen[key]) { c.skip.dup++; return; }
      if (c.items.length >= MAX_ITEMS) { c.skip.other++; return; }
      seen[key] = 1;
      c.items.push({ t: t, at: at, v: out, n: n ? kit().cleanText(n, NOTE_LEN) : "", fl: fl || [] });
    };
    c.rest = function (at, bpm) { restN++; c.add("hr", at, [bpm]); };
    c.sample = function (at, bpm) {
      c.skip.hrs++;
      if (!isFinite(at) || !(bpm >= 20 && bpm <= 250)) return;
      var k = ymdOf(at), cur = hrLow[k];
      if (!cur || bpm < cur.v) hrLow[k] = { v: bpm, at: at };
    };
    c.finish = function () {
      // the day's lowest sample, only when the file has no resting value
      if (!restN) {
        Object.keys(hrLow).sort().forEach(function (k) { c.hrDays++; c.add("hr", hrLow[k].at, [hrLow[k].v]); });
      }
      delete c.add; delete c.rest; delete c.sample; delete c.finish;
      if (!c.items.length) return { error: "empty", source: c.source, skip: c.skip };
      c.items.sort(function (a, b) { return a.at - b.at || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0); });
      return c;
    };
    return c;
  }

  // ---------- 2. Units ----------
  function grams(x, unit, c) {
    var u = String(unit || "kg").toLowerCase();
    if (/lb|pound/.test(u)) { c.conv.lb++; return x * 453.59237; }
    if (/^st/.test(u)) { c.conv.lb++; return x * 6350.29318; }
    if (/^g$/.test(u)) return x;
    return x * 1000;
  }
  function glucose(x, unit, c) {               // → tenths of mg/dL
    var u = String(unit || "").toLowerCase();
    if (/mmol/.test(u) || (!/mg/.test(u) && x > 0 && x < 35)) { c.conv.mmol++; return x * core().MGDL_PER_MMOL * 10; }
    return x * 10;
  }
  function celsius(x, unit, c) {               // → hundredths of °C
    var u = String(unit || "").toLowerCase();
    if (/f/.test(u) || x >= 80) { c.conv.f++; return (x - 32) * 5 / 9 * 100; }
    return x * 100;
  }
  function spo2(x, c) {
    if (x > 0 && x <= 1.0001) { c.conv.frac++; return x * 100; }
    return x;
  }

  // ---------- 3. CSV sources ----------
  // D/M/Y or M/D/Y, from the values themselves
  function dateHint(vals) {
    var dmy = false, mdy = false;
    vals.forEach(function (v) {
      var m = /^\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/.exec(String(v || ""));
      if (!m) return;
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    });
    return dmy && !mdy ? "dmy" : (mdy && !dmy ? "mdy" : "");
  }
  // Samsung writes UTC wall-clock times ("2023-10-04 07:12:00.000")
  function utcMs(s) {
    var K = kit(), v = K.clean(s, 60);
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(v);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return K.parseDate(v);
  }

  var SAMSUNG = [
    [/blood_pressure/i, "bp"], [/\.weight(\.|$)/i, "wt"], [/heart_rate/i, "hrs"], [/blood_glucose/i, "gl"],
    [/oxygen_saturation/i, "o2"], [/body_temperature/i, "tp"], [/\.height(\.|$)/i, "height"]
  ];
  function samsungKind(s) {
    for (var i = 0; i < SAMSUNG.length; i++) if (SAMSUNG[i][0].test(s)) return SAMSUNG[i][1];
    return "";
  }

  // one CSV into the collector; returns the source id or ""
  function readCsv(text, name, c) {
    var K = kit();
    text = String(text || "").replace(/^\ufeff/, "");
    var base = String(name || "").split("/").pop();
    var first = text.slice(0, Math.min(text.length, 400)).split(/\r?\n/)[0] || "";
    var meta = /^\s*com\.samsung\./i.test(first) ? first : "";
    if (meta || /^com\.samsung\./i.test(base)) {
      if (meta) text = text.slice(text.indexOf("\n") + 1);
      return samsung(K.records(text, { maxRows: MAX_ITEMS }), samsungKind(meta.split(",")[0] || base) || samsungKind(base), c) ? "samsung" : "";
    }
    var r = K.records(text, { maxRows: MAX_ITEMS }), h = r.head;
    var has = function (names) { return K.col(h, names) !== -1; };
    var sys = ["Systolic (mmHg)", "Systolic", "SYS", "Systolic pressure"], dia = ["Diastolic (mmHg)", "Diastolic", "DIA", "Diastolic pressure"];
    if (has(sys) && has(dia)) {
      if (has(["Time", "Measurement time"]) || has(["Pulse (bpm)", "Pulse", "Irregular heartbeat detected", "Body movement"])) { omron(r, c); return "omron"; }
      withingsBp(r, c);
      return "withings";
    }
    if (!has(["Date", "Datum", "Timestamp"])) return "";
    if (has(["Weight (kg)", "Weight (lb)", "Weight (lbs)", "Weight"])) { withingsWeight(r, c); return "withings"; }
    if (has(["SpO2", "SpO2 (%)", "Oxygen saturation", "Oxygen saturation (%)"]) ||
        has(["Temperature", "Body temperature", "Temperature (°C)", "Temperature (°F)", "Body temperature (°C)", "Body temperature (°F)"])) {
      withingsOther(r, c);
      return "withings";
    }
    if (has(["Height (m)", "Height (cm)", "Height", "Height (ft)"])) { c.skip.height += r.rows.length; return "withings"; }
    return "";
  }

  function headName(h, names) {            // the matching header text (for "(lb)")
    var i = kit().col(h, names);
    return i === -1 ? "" : h[i];
  }
  function withingsWeight(r, c) {
    var K = kit(), wh = headName(r.head, ["Weight (kg)", "Weight (lb)", "Weight (lbs)", "Weight"]);
    var unit = /lb/i.test(wh) ? "lb" : "kg";
    var comp = ["Fat mass (kg)", "Fat mass (lb)", "Fat mass", "Bone mass (kg)", "Bone mass (lb)", "Bone mass",
                "Muscle mass (kg)", "Muscle mass (lb)", "Muscle mass", "Hydration (kg)", "Hydration (lb)", "Hydration", "Fat Free Mass (kg)"];
    r.rows.forEach(function (o) {
      var at = K.parseDate(K.get(o, ["Date", "Datum", "Timestamp"]));
      var x = K.num(o[wh]);
      if (comp.some(function (k) { var s = K.get(o, [k]); return s !== "" && isFinite(K.num(s)); })) c.skip.comp++;
      if (!isFinite(x)) { if (String(o[wh] || "").trim()) c.skip.bad++; return; }
      c.add("wt", at, [grams(x, unit, c)], K.get(o, ["Comments", "Comment", "Notes"]));
    });
  }
  function withingsBp(r, c) {
    var K = kit();
    r.rows.forEach(function (o) {
      c.add("bp", K.parseDate(K.get(o, ["Date", "Datum", "Timestamp"])),
        [K.num(K.get(o, ["Systolic", "Systolic (mmHg)"])), K.num(K.get(o, ["Diastolic", "Diastolic (mmHg)"])),
         K.num(K.get(o, ["Heart rate", "Heart rate (bpm)", "Pulse"]))],
        K.get(o, ["Comments", "Comment", "Notes"]));
    });
  }
  function withingsOther(r, c) {
    var K = kit();
    var oh = headName(r.head, ["SpO2", "SpO2 (%)", "Oxygen saturation", "Oxygen saturation (%)"]);
    var th = headName(r.head, ["Body temperature (°C)", "Body temperature (°F)", "Temperature (°C)", "Temperature (°F)", "Body temperature", "Temperature"]);
    r.rows.forEach(function (o) {
      var at = K.parseDate(K.get(o, ["Date", "Datum", "Timestamp"])), note = K.get(o, ["Comments", "Comment", "Notes"]);
      var a = oh ? K.num(o[oh]) : NaN, b = th ? K.num(o[th]) : NaN;
      if (isFinite(a)) c.add("o2", at, [spo2(a, c)], note);
      if (isFinite(b)) c.add("tp", at, [celsius(b, /f\)?$/i.test(th) ? "f" : "c", c)], note);
    });
  }
  function omron(r, c) {
    var K = kit();
    var dates = r.rows.map(function (o) { return K.get(o, ["Date", "Measurement date", "Datum"]); });
    var hint = dateHint(dates);
    r.rows.forEach(function (o, i) {
      var tm = K.clean(K.get(o, ["Time", "Measurement time"]), 20);
      var d = K.clean(dates[i], 40);
      var at = K.parseDate(tm && !/\d:\d/.test(d) ? d + " " + tm : d, hint);
      var fl = [];
      if (truthy(K.get(o, ["Irregular heartbeat detected", "Irregular heartbeat", "IHB"]))) fl.push("ihb");
      if (truthy(K.get(o, ["Body movement", "Body movement detected", "Movement"]))) fl.push("mv");
      c.add("bp", at,
        [K.num(K.get(o, ["Systolic (mmHg)", "Systolic", "SYS"])), K.num(K.get(o, ["Diastolic (mmHg)", "Diastolic", "DIA"])),
         K.num(K.get(o, ["Pulse (bpm)", "Pulse", "PULSE"]))],
        K.get(o, ["Notes", "Note", "Comments"]), fl);
    });
  }
  function samsung(r, kind, c) {
    var K = kit();
    if (!kind) return false;
    // drop the file prefix of every column ("com.samsung.health.weight.start_time")
    var rows = r.rows.map(function (o) {
      var x = {};
      Object.keys(o).forEach(function (k) { x[k.replace(/^com\.samsung\.[a-z0-9_.]*\./i, "")] = o[k]; });
      return x;
    });
    if (kind === "height") { c.skip.height += rows.length; return true; }
    rows.forEach(function (o) {
      var at = utcMs(K.get(o, ["start_time", "create_time"]));
      var note = K.get(o, ["comment"]);
      if (kind === "wt") {
        var w = K.num(K.get(o, ["weight"]));
        if (["body_fat", "body_fat_mass", "skeletal_muscle", "skeletal_muscle_mass", "muscle_mass", "fat_free_mass", "total_body_water"]
            .some(function (k) { return isFinite(K.num(K.get(o, [k]))); })) c.skip.comp++;
        if (isFinite(w)) c.add("wt", at, [grams(w, "kg", c)], note);
      } else if (kind === "bp") {
        c.add("bp", at, [K.num(K.get(o, ["systolic"])), K.num(K.get(o, ["diastolic"])), K.num(K.get(o, ["pulse"]))], note);
      } else if (kind === "hrs") {
        var bpm = K.num(K.get(o, ["heart_rate"]));
        if (isFinite(bpm)) c.sample(at, bpm);
      } else if (kind === "gl") {
        var g = K.num(K.get(o, ["glucose"]));
        if (isFinite(g)) c.add("gl", at, [glucose(g, "mmol", c)], note);
      } else if (kind === "o2") {
        var s = K.num(K.get(o, ["spo2"]));
        if (isFinite(s)) c.add("o2", at, [spo2(s, c)], note);
      } else if (kind === "tp") {
        var tp = K.num(K.get(o, ["temperature"]));
        if (isFinite(tp)) c.add("tp", at, [celsius(tp, "c", c)], note);
      }
    });
    return true;
  }

  // ---------- 4. Apple Health export.xml (streamed) ----------
  var APPLE_RE = /<Record\s+type="HKQuantityTypeIdentifier(BodyMass|BloodPressureSystolic|BloodPressureDiastolic|RestingHeartRate|HeartRate|BloodGlucose|OxygenSaturation|BodyTemperature|Height)"[^>]*>/g;
  var ATTR_RE = /\s(unit|value|startDate|sourceName)="([^"]*)"/g;
  function appleScanner(c) {
    var K = kit(), tail = "", bpS = {}, bpD = {}, any = false;
    function attrs(tag) {
      var o = {}, m;
      ATTR_RE.lastIndex = 0;
      while ((m = ATTR_RE.exec(tag))) o[m[1]] = m[2];
      return o;
    }
    function one(type, tag) {
      any = true;
      if (type === "Height") { c.skip.height++; return; }
      var a = attrs(tag), x = K.num(a.value), at = K.parseDate(a.startDate);
      if (!isFinite(x) || !isFinite(at)) { c.skip.bad++; return; }
      if (type === "BodyMass") c.add("wt", at, [grams(x, a.unit, c)]);
      else if (type === "RestingHeartRate") c.rest(at, x);
      else if (type === "HeartRate") c.sample(at, x);
      else if (type === "BloodGlucose") c.add("gl", at, [glucose(x, a.unit, c)]);
      else if (type === "OxygenSaturation") c.add("o2", at, [spo2(x, c)]);
      else if (type === "BodyTemperature") c.add("tp", at, [celsius(x, a.unit, c)]);
      else {
        var k = a.startDate + "|" + (a.sourceName || "");
        (type === "BloodPressureSystolic" ? bpS : bpD)[k] = { at: at, v: x };
      }
    }
    function scan(text) {
      var m;
      APPLE_RE.lastIndex = 0;
      while ((m = APPLE_RE.exec(text))) one(m[1], m[0]);
    }
    return {
      push: function (chunk) {
        var s = tail + chunk, cut = s.lastIndexOf("<");
        if (cut < 0) { tail = ""; scan(s); return; }
        scan(s.slice(0, cut));
        tail = s.slice(cut);
        if (tail.length > MAX_TAIL) tail = "";
      },
      finish: function () {
        scan(tail);
        tail = "";
        Object.keys(bpS).forEach(function (k) {
          var d = bpD[k];
          if (!d) { c.skip.half++; return; }
          c.add("bp", bpS[k].at, [bpS[k].v, d.v, 0]);
          delete bpD[k];
        });
        c.skip.half += Object.keys(bpD).length;
        return any;
      }
    };
  }
  function looksApple(text) { return /<HealthData[\s>]|HKQuantityTypeIdentifier/.test(String(text).slice(0, 200000)); }

  // ---------- 5. Synchronous entry (one CSV or an XML text) ----------
  function parseText(text, name) {
    var c = collector();
    text = String(text == null ? "" : text);
    if (/\.xml$/i.test(name || "") || /^\s*<\?xml|^\s*<HealthData/.test(text.slice(0, 2000))) {
      if (!looksApple(text)) return { error: "bad" };
      var sc = appleScanner(c);
      sc.push(text);
      sc.finish();
      c.source = "apple";
      return c.finish();
    }
    var src = readCsv(text, name, c);
    if (!src) return { error: "bad" };
    c.source = src;
    return c.finish();
  }

  // ---------- 6. ZIP on a Blob (entries read lazily, streamed) ----------
  // Our own reader (atelier/zip.js wants the whole file in memory and
  // caps every entry at 80 MB; Apple's export.xml is often larger):
  // the central directory is read from the end of the file with
  // Blob.slice, one entry's compressed bytes stream through
  // DecompressionStream("deflate-raw"). ZIP64 sizes are understood.
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  function u64(b, o) { return u32(b, o) + u32(b, o + 4) * 4294967296; }
  function sliceBytes(blob, a, b) {
    return blob.slice(a, b).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }
  function zipEntries(blob) {
    var size = blob.size, from = Math.max(0, size - 65557);
    return sliceBytes(blob, from, size).then(function (tail) {
      var e = -1;
      for (var i = tail.length - 22; i >= 0; i--) {
        if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { e = i; break; }
      }
      if (e < 0) throw new Error("zip");
      var cnt = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
      var z64 = e >= 20 && u32(tail, e - 20) === 0x07064b50 ? u64(tail, e - 12) : -1;
      var next = z64 >= 0 && (cnt === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff)
        ? sliceBytes(blob, z64, z64 + 56).then(function (h) {
            if (u32(h, 0) !== 0x06064b50) throw new Error("zip");
            return { cnt: u64(h, 32), size: u64(h, 40), off: u64(h, 48) };
          })
        : Promise.resolve({ cnt: cnt, size: cdSize, off: cdOff });
      return next;
    }).then(function (d) {
      if (d.size > MAX_CD || d.off + d.size > size) throw new Error("zip");
      return sliceBytes(blob, d.off, d.off + d.size).then(function (cd) {
        var out = [], p = 0;
        for (var n = 0; n < d.cnt && p + 46 <= cd.length; n++) {
          if (u32(cd, p) !== 0x02014b50) throw new Error("zip");
          var flags = u16(cd, p + 8), method = u16(cd, p + 10);
          var csize = u32(cd, p + 20), usize = u32(cd, p + 24);
          var nlen = u16(cd, p + 28), xlen = u16(cd, p + 30), clen = u16(cd, p + 32), loc = u32(cd, p + 42);
          var name = new TextDecoder("utf-8").decode(cd.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, "/");
          // ZIP64 extra field: the 0xFFFFFFFF fields, in this order
          var x = p + 46 + nlen, xe = x + xlen;
          while (x + 4 <= xe) {
            var id = u16(cd, x), len = u16(cd, x + 2), q = x + 4;
            if (id === 1) {
              if (usize === 0xffffffff) { usize = u64(cd, q); q += 8; }
              if (csize === 0xffffffff) { csize = u64(cd, q); q += 8; }
              if (loc === 0xffffffff) { loc = u64(cd, q); }
            }
            x += 4 + len;
          }
          p = xe + clen;
          if (name.slice(-1) === "/" || flags & 1) continue;
          out.push({ name: name, method: method, csize: csize, size: usize, loc: loc });
        }
        return out;
      });
    });
  }
  function entryStream(blob, e) {
    return sliceBytes(blob, e.loc, e.loc + 30).then(function (h) {
      if (u32(h, 0) !== 0x04034b50) throw new Error("zip");
      var start = e.loc + 30 + u16(h, 26) + u16(h, 28);
      if (start + e.csize > blob.size) throw new Error("zip");
      var raw = blob.slice(start, start + e.csize).stream();
      if (e.method === 0) return raw;
      if (e.method !== 8 || typeof DecompressionStream !== "function") throw new Error("zip");
      return raw.pipeThrough(new DecompressionStream("deflate-raw"));
    });
  }
  // text chunks of a byte stream; onText(str) per chunk; stops at max
  function pumpText(stream, max, onText, onBytes) {
    var reader = stream.getReader(), dec = new TextDecoder("utf-8"), total = 0;
    function step() {
      return reader.read().then(function (r) {
        if (r.done) { onText(dec.decode()); return total; }
        total += r.value.length;
        if (total > max) { try { reader.cancel(); } catch (e) {} throw new Error("toobig"); }
        if (onBytes) onBytes(total);
        onText(dec.decode(r.value, { stream: true }));
        return step();
      });
    }
    return step();
  }
  function entryText(blob, e, max) {
    if (e.size > max) return Promise.reject(new Error("toobig"));
    var parts = [];
    return entryStream(blob, e).then(function (s) {
      return pumpText(s, max, function (t) { parts.push(t); });
    }).then(function () { return parts.join(""); });
  }
  function streamApple(stream, c, total, onProgress) {
    var sc = appleScanner(c), last = 0, step = Math.min(4 * 1024 * 1024, Math.max(65536, (total || 0) / 25));
    return pumpText(stream, MAX_XML, function (t) { sc.push(t); }, function (n) {
      if (onProgress && total && n - last > step) { last = n; onProgress(Math.min(0.99, n / total)); }
    }).then(function () { return sc.finish(); });
  }

  // ---------- 7. Asynchronous entry (any picked file) ----------
  function head(blob) {
    return sliceBytes(blob, 0, Math.min(blob.size, 4096));
  }
  function readBlob(blob, name, onProgress) {
    if (!blob || !blob.size) return Promise.resolve({ error: "empty" });
    var c = collector();
    return head(blob).then(function (h) {
      var zip = h.length > 4 && h[0] === 0x50 && h[1] === 0x4b && h[2] === 3 && h[3] === 4;
      var start = new TextDecoder("utf-8").decode(h);
      // Apple's export.xml, unzipped: streamed, never read whole
      if (!zip && (/\.xml$/i.test(name || "") || /^\ufeff?\s*<\?xml/.test(start))) {
        return streamApple(blob.stream(), c, blob.size, onProgress).then(function (any) {
          if (!any && !c.items.length) return { error: "bad" };
          c.source = "apple";
          return c.finish();
        });
      }
      if (blob.size > MAX_FILE) return { error: "big" };
      if (!zip) {
        return blob.arrayBuffer().then(function (buf) { return parseText(kit().text(new Uint8Array(buf)), name); });
      }
      return zipEntries(blob).then(function (list) {
        var xml = list.filter(function (e) { return /\.xml$/i.test(e.name) && !/cda/i.test(e.name.split("/").pop()); });
        xml.sort(function (a, b) {
          return (/(^|\/)export\.xml$/i.test(b.name) ? 1 : 0) - (/(^|\/)export\.xml$/i.test(a.name) ? 1 : 0) || b.size - a.size;
        });
        if (xml.length) {
          return entryStream(blob, xml[0]).then(function (s) { return streamApple(s, c, xml[0].size, onProgress); }).then(function (any) {
            if (!any && !c.items.length) return { error: "bad" };
            c.source = "apple";
            return c.finish();
          });
        }
        var csvs = list.filter(function (e) {
          var b = e.name.split("/").pop();
          return /\.csv$/i.test(b) && !/^raw_/i.test(b) && !/^__MACOSX/.test(e.name) &&
            (!/^com\.samsung\./i.test(b) || samsungKind(b));
        }).slice(0, MAX_ZIP_CSV);
        var src = {}, chain = Promise.resolve();
        csvs.forEach(function (e, i) {
          chain = chain.then(function () {
            if (onProgress) onProgress(i / csvs.length);
            return entryText(blob, e, MAX_CSV).then(function (text) {
              var s = readCsv(text, e.name, c);
              if (s) src[s] = (src[s] || 0) + 1;
            }, function () { c.skip.other++; });
          });
        });
        return chain.then(function () {
          var ids = Object.keys(src);
          if (!ids.length) return { error: "bad" };
          ids.sort(function (a, b) { return src[b] - src[a]; });
          c.source = ids[0];
          return c.finish();
        });
      });
    }).catch(function (e) {
      return { error: e && e.message === "toobig" ? "big" : "bad" };
    });
  }
  function readBytes(bytes, name, onProgress) {
    return readBlob(new Blob([bytes]), name, onProgress);
  }

  // ---------- 8. Plan against the current data ----------
  function idOf(x) {
    var K = kit(), s = x.t + "|" + x.at + "|" + x.v.join(",");
    return "imp-" + K.hash(s) + K.hash("#" + s);
  }
  function sameKey(t, at, v) { return t + "|" + Math.floor(at / 60000) + "|" + v[0] + "|" + (t === "bp" ? v[1] : ""); }
  function plan(res, data, max) {
    var have = {}, ids = {}, out = { add: [], have: 0, per: {}, from: 0, to: 0, cut: 0 };
    ((data && data.en) || []).forEach(function (e) { ids[e.id] = 1; have[sameKey(e.t, e.at, e.v)] = 1; });
    var tag = SRC_TAG[res.source] || "";
    (res.items || []).forEach(function (x) {
      var p = out.per[x.t] || (out.per[x.t] = { n: 0, add: 0 });
      p.n++;
      if (!out.from || x.at < out.from) out.from = x.at;
      if (x.at > out.to) out.to = x.at;
      var id = idOf(x), k = sameKey(x.t, x.at, x.v);
      if (ids[id] || have[k]) { out.have++; return; }
      have[k] = 1;
      p.add++;
      out.add.push({ id: id, t: x.t, at: x.at, v: x.v.slice(), c: 0, a: 0, p: 0, n: x.n || "", g: tag ? [tag] : [], fl: x.fl || [] });
    });
    // a cap on what one import may add (the data lives in localStorage):
    // the most recent readings are kept (items are sorted by time)
    if (max && out.add.length > max) {
      out.cut = out.add.length - max;
      out.add.splice(0, out.cut).forEach(function (e) { out.per[e.t].add--; });
    }
    return out;
  }

  var API = {
    MAX_FILE: MAX_FILE, MAX_ITEMS: MAX_ITEMS, SRC_TAG: SRC_TAG,
    parseText: parseText, readBlob: readBlob, readBytes: readBytes, plan: plan, idOf: idOf,
    zipEntries: zipEntries
  };
  if (NODE) module.exports = API;
  else root.OrosHealthImport = API;
})(typeof self !== "undefined" ? self : this);
