// ============================================================
// orOS Cycle — import.js (pure logic: "Import from another app")
// Reads a file the person exported from another period tracker,
// as DATA only (nothing is run, nothing becomes HTML):
//   - drip.  Settings › Data › Export CSV: one row per day
//            (date, temperature.value/.exclude, bleeding.value 0–3
//            /.exclude, mucus.value 0–4/.exclude, note.value, …)
//   - Clue   Settings › Export data (.cluedata = JSON): an array of
//            days { day, period: light|medium|heavy|spotting, … },
//            older { data: [{ day, type: "period", value }] }, or
//            { measurements: [{ date, type, value: { option } }] }
//   - Flo    the JSON of a GDPR data request: any objects with a
//            period start/end date (operationalData › cycles …) and
//            day events of category "Period" (point_events_…)
//   - a CSV  one row per period (start [, end]) or one row per
//            bleeding day (date [, flow, temperature, mucus, note])
// A ZIP is opened and its .json / .cluedata / .csv entries read.
// Bleeding days become periods: days at most 2 apart (one unlogged
// day between them) belong to the same period. Spotting is not a
// period day and sets no flow.
//   parseText(text, name)  → { source, periods: [{ s, e|null }],
//                              days: { "YYYY-MM-DD": { fl, bbt, cm,
//                              note } } } or { error: "bad"|"empty" }
//   readBytes(bytes, name) → Promise of the same (ZIP aware)
//   plan(res, cur, opts)   → what an import would ADD to the current
//                            data { periods, days } (cycle.js state):
//                            new periods (overlaps skipped, nothing
//                            existing shortened or changed), day
//                            fields to fill (a value the person has,
//                            or has cleared, wins) and counts
// Stable ids: an imported period is "imp" + its start date (digits
// only — period ids never contain "-"), days use the app's own
// "d-YYYY-MM-DD" ids: importing the same file twice adds nothing.
// Caps: file size, rows, days, periods, JSON depth / nodes, note
// length. Needs OrosImportKit (../importkit.js); ZIP needs AtelierZip.
// UMD: window.OrosCycleImport in the browser, module.exports in Node.
// i18n-inline-ok: the Greek (and German) CSV header and flow / mucus words below are parser data, not UI text
// ============================================================
(function (root) {
  "use strict";

  var K = (typeof module !== "undefined" && module.exports && typeof require === "function")
    ? require("../importkit.js") : root.OrosImportKit;

  var MAX_FILE = 25 * 1024 * 1024;      // the file as picked
  var MAX_TEXT = 25 * 1024 * 1024;      // characters parsed
  var MAX_DAYS = 40000;                 // ~110 years of days
  var MAX_PERIODS = 3000;
  var MAX_NODES = 600000;               // JSON nodes walked (Flo)
  var MAX_DEPTH = 16;
  var MAX_NOTE = 1000;
  var MAX_ZIP_ENTRIES = 40;
  var MERGE_GAP = 2;                    // bleeding days ≤ 2 apart = one period
  var MAX_LEN = 20;                     // a "period" longer than this is not trusted
  var DAY_MS = 24 * 60 * 60 * 1000;
  var BBT_MIN = 3400, BBT_MAX = 4300;

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // ---------- 1. Day keys ----------
  // "YYYY-MM-DD" ↔ whole day numbers (UTC arithmetic: no DST)
  function kNum(k) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || "");
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : null;
  }
  function kOf(n) {
    var d = new Date(n * DAY_MS);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function localKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function localMs(k) {
    var p = k.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).getTime();
  }
  // a calendar date from any value: a leading ISO date is taken as
  // written (no time-zone shift), else the kit's parser
  function dkey(v, hint) {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "string") {
      var m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(v);
      if (m) {
        var k = m[1] + "-" + m[2] + "-" + m[3];
        return kOf(kNum(k)) === k && +m[1] >= 1900 ? k : "";
      }
    }
    if (typeof v !== "string" && typeof v !== "number") return "";
    var r = K.ymd(v, hint);
    return r && +r.slice(0, 4) >= 1900 ? r : "";
  }
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

  // ---------- 2. Values ----------
  // temperature → hundredths of °C (°F converted), or undefined
  function bbtOf(v) {
    if (v && typeof v === "object") v = v.value !== undefined ? v.value : v.temperature;
    var n = K.num(v);
    if (!isFinite(n)) return undefined;
    if (n >= 90 && n <= 110) n = (n - 32) * 5 / 9;
    var h = Math.round(n * 100);
    return h >= BBT_MIN && h <= BBT_MAX ? h : undefined;
  }
  function truthy(v) { return v === true || /^(true|1|yes|x)$/i.test(String(v === null || v === undefined ? "" : v).trim()); }
  // flow words / numbers → 1|2|3, 0 = explicitly none / spotting,
  // -1 = bleeding of unknown amount, null = nothing said
  var FLOW_WORDS = [
    [/^(spotting|spot|none|no|false|0|κηλίδες|σταγόνες|καμία|όχι|schmierblutung|keine|nein)$/, 0],
    [/^(very[ _-]?light|light|low|little|1|ελαφριά|ελαφρυά|λίγη|χαμηλή|leicht|schwach)$/, 1],
    [/^(medium|normal|moderate|regular|2|μέτρια|κανονική|μεσαία|mittel)$/, 2],
    [/^(heavy|high|very[ _-]?heavy|strong|3|έντονη|πολλή|βαριά|δυνατή|stark)$/, 3],
    [/^(yes|true|x|bleeding|period|ναι|ja)$/, -1]
  ];
  function flowOf(v) {
    if (v && typeof v === "object") v = v.option !== undefined ? v.option : v.value;
    var s = K.clean(v, 40).toLowerCase();
    if (!s) return null;
    for (var i = 0; i < FLOW_WORDS.length; i++) if (FLOW_WORDS[i][0].test(s)) return FLOW_WORDS[i][1];
    return null;
  }
  // mucus → 1 dry · 2 moist · 3 creamy/sticky · 4 egg white
  function cmOf(v) {
    if (Array.isArray(v)) {
      var best;
      v.forEach(function (x) { var c = cmOf(x); if (c !== undefined && (best === undefined || c > best)) best = c; });
      return best;
    }
    if (v && typeof v === "object") v = v.option !== undefined ? v.option : v.value;
    var s = K.clean(v, 40).toLowerCase().replace(/[ _-]+/g, " ");
    if (!s) return undefined;
    if (/^\d$/.test(s)) { var n = +s; return n >= 1 && n <= 4 ? n : undefined; }
    if (/egg|stretch|slippery|clear|ασπράδι|ελαστικ|eiweiß|spinnbar/.test(s)) return 4;
    if (/cream|sticky|lotion|κρεμώδ|κολλώδ|cremig|klebrig/.test(s)) return 3;
    if (/moist|wet|watery|υγρ|feucht|nass/.test(s)) return 2;
    if (/dry|none|nothing|ξηρ|trocken/.test(s)) return 1;
    return undefined;
  }

  // ---------- 3. Collecting ----------
  function collector(source) {
    var days = {}, n = 0, bleed = {}, periods = [];
    function day(k) {
      if (!k) return null;
      if (!days[k]) { if (n >= MAX_DAYS) return null; days[k] = {}; n++; }
      return days[k];
    }
    return {
      flow: function (k, f) {
        if (!k || f === null || f === 0 || f === undefined) return;
        var d = day(k);
        if (!d) return;
        bleed[k] = true;
        if (f >= 1 && f <= 3 && (d.fl === undefined || f > d.fl)) d.fl = f;
      },
      bbt: function (k, v) { var d = v !== undefined && day(k); if (d) d.bbt = v; },
      cm: function (k, v) { var d = v !== undefined && day(k); if (d && (d.cm === undefined || v > d.cm)) d.cm = v; },
      note: function (k, v) {
        var s = K.cleanText(v, MAX_NOTE);
        if (!s) return;
        var d = day(k);
        if (!d) return;
        d.note = d.note ? (d.note + "\n" + s).slice(0, MAX_NOTE) : s;
      },
      period: function (s, e) {
        if (!s || periods.length >= MAX_PERIODS) return;
        if (e && (kNum(e) < kNum(s) || kNum(e) - kNum(s) + 1 > MAX_LEN)) e = null;
        periods.push({ s: s, e: e || null });
      },
      done: function () {
        // bleeding days → periods
        var ks = Object.keys(bleed).map(kNum).sort(function (a, b) { return a - b; });
        var cur = null;
        ks.forEach(function (x) {
          if (cur && x - cur.b <= MERGE_GAP) { cur.b = x; return; }
          if (cur) periods.push({ s: kOf(cur.a), e: kOf(cur.b) });
          cur = { a: x, b: x };
        });
        if (cur) periods.push({ s: kOf(cur.a), e: kOf(cur.b) });
        // empty day objects (a spotting-only day) are dropped
        Object.keys(days).forEach(function (k) { if (!Object.keys(days[k]).length) delete days[k]; });
        if (!periods.length && !Object.keys(days).length) return { error: "empty", source: source };
        return { source: source, periods: mergeRanges(periods.slice(0, MAX_PERIODS)), days: days };
      }
    };
  }
  // overlapping ranges of the SAME file become one (an open end
  // stays open only for the last one)
  function mergeRanges(list) {
    var sorted = list.slice().sort(function (a, b) { return kNum(a.s) - kNum(b.s); }), out = [];
    sorted.forEach(function (p) {
      var last = out[out.length - 1];
      var lastEnd = last ? (last.e ? kNum(last.e) : kNum(last.s)) : null;
      if (last && kNum(p.s) <= lastEnd) {
        if (p.e && kNum(p.e) > lastEnd) last.e = p.e;
        return;
      }
      out.push({ s: p.s, e: p.e });
    });
    return out;
  }

  // ---------- 4. Parsers ----------
  function parseDrip(recs) {
    var c = collector("drip");
    recs.rows.forEach(function (r) {
      var k = dkey(K.get(r, ["date"]));
      if (!k) return;
      if (!truthy(K.get(r, ["bleeding.exclude"]))) {
        var b = K.num(K.get(r, ["bleeding.value"]));
        if (b >= 1 && b <= 3) c.flow(k, Math.round(b));          // 0 = spotting
      }
      if (!truthy(K.get(r, ["temperature.exclude"]))) c.bbt(k, bbtOf(K.get(r, ["temperature.value"])));
      if (!truthy(K.get(r, ["mucus.exclude"]))) {
        // drip's computed NFP value: 0 t (dry) · 1 Ø (nothing) · 2 f
        // (moist) · 3 S (creamy) · 4 S+ (egg white)
        var mv = K.get(r, ["mucus.value"]);
        var m = mv === "" ? NaN : K.num(mv);
        if (m >= 0 && m <= 4) c.cm(k, [1, 1, 2, 3, 4][Math.round(m)]);
      }
      c.note(k, K.get(r, ["note.value"]));
    });
    return c.done();
  }

  function parseClue(arr) {
    var c = collector("clue");
    arr.forEach(function (it) {
      if (!it || typeof it !== "object") return;
      var k = dkey(it.day !== undefined ? it.day : it.date);
      if (!k) return;
      if (typeof it.type === "string") {                        // { type, value }
        var ty = it.type.toLowerCase();
        if (ty === "period" || ty === "bleeding") c.flow(k, flowOf(it.value));
        else if (ty === "bbt" || ty === "temperature") c.bbt(k, bbtOf(it.value));
        else if (ty === "fluid" || ty === "discharge" || ty === "mucus") c.cm(k, cmOf(it.value));
        else if (ty === "notes" || ty === "note") c.note(k, typeof it.value === "string" ? it.value : "");
        return;
      }
      if (it.period !== undefined) c.flow(k, flowOf(it.period));
      if (it.bbt !== undefined) c.bbt(k, bbtOf(it.bbt));
      else if (it.temperature !== undefined) c.bbt(k, bbtOf(it.temperature));
      var dis = it.discharge !== undefined ? it.discharge : it.fluid;
      if (dis !== undefined) c.cm(k, cmOf(dis));
      var nt = it.notes !== undefined ? it.notes : it.note;
      if (typeof nt === "string") c.note(k, nt);
    });
    return c.done();
  }
  function clueArray(obj) {
    var arr = Array.isArray(obj) ? obj : (obj && typeof obj === "object" ? (obj.data || obj.measurements || obj.days) : null);
    if (!Array.isArray(arr) || !arr.length) return null;
    var hit = 0;
    for (var i = 0; i < arr.length && i < 200; i++) {
      var it = arr[i];
      if (it && typeof it === "object" && (it.day !== undefined || it.date !== undefined) &&
          (it.period !== undefined || typeof it.type === "string" || it.bbt !== undefined || it.discharge !== undefined || it.tags !== undefined)) hit++;
    }
    return hit ? arr : null;
  }

  // Flo: walk the whole JSON (capped), keep period ranges and
  // "Period" day events wherever they sit
  var START_KEYS = ["period_start_date", "periodStartDate", "period_start", "periodStart", "start_date", "startDate", "start"];
  var END_KEYS = ["period_end_date", "periodEndDate", "period_end", "periodEnd", "end_date", "endDate", "end"];
  var DATE_KEYS = ["date", "day", "start_date", "startDate", "event_date", "timestamp", "time", "created_at"];
  function first(o, keys) {
    for (var i = 0; i < keys.length; i++) if (Object.prototype.hasOwnProperty.call(o, keys[i]) && o[keys[i]] !== null && o[keys[i]] !== "") return keys[i];
    return "";
  }
  function parseFlo(obj) {
    var c = collector("flo"), nodes = 0;
    (function walk(node, ctx, depth) {
      if (++nodes > MAX_NODES || depth > MAX_DEPTH || !node || typeof node !== "object") return;
      if (Array.isArray(node)) { for (var i = 0; i < node.length && nodes <= MAX_NODES; i++) walk(node[i], ctx, depth + 1); return; }
      var sk = first(node, START_KEYS);
      var periodish = /period|cycle|menstru|bleed/i.test(ctx) || /period/i.test(sk);
      if (sk && periodish && !/predict|forecast|estimat/i.test(ctx)) {
        var s = dkey(node[sk]), ek = first(node, END_KEYS);
        if (s) c.period(s, ek ? dkey(node[ek]) : null);
      }
      var cat = node.category !== undefined ? node.category : (node.type !== undefined ? node.type : node.event_category);
      if (typeof cat === "string" && /^(period|menstruation|bleeding)$/i.test(cat.trim())) {
        var dk = first(node, DATE_KEYS);
        var k = dk ? dkey(node[dk]) : "";
        var sub = node.subcategory !== undefined ? node.subcategory : (node.value !== undefined ? node.value : node.intensity);
        var f = flowOf(sub);
        if (k) c.flow(k, f === null ? -1 : f);
      }
      Object.keys(node).forEach(function (key) {
        var v = node[key];
        if (v && typeof v === "object") walk(v, (ctx + "/" + key).slice(-300), depth + 1);
      });
    })(obj, "", 0);
    return c.done();
  }

  var GEN_START = ["start", "start date", "period start", "period start date", "started", "begin", "from", "first day", "αρχή", "έναρξη", "από", "beginn", "anfang", "von"];
  var GEN_END = ["end", "end date", "period end", "period end date", "ended", "finish", "to", "last day", "τέλος", "λήξη", "έως", "ende", "bis"];
  var GEN_DATE = ["date", "day", "bleeding day", "ημερομηνία", "ημέρα", "datum", "tag"];
  var GEN_FLOW = ["flow", "bleeding", "intensity", "period", "menstruation", "ροή", "αιμορραγία", "blutung", "stärke"];
  var GEN_BBT = ["bbt", "temperature", "temp", "basal body temperature", "θερμοκρασία", "temperatur", "basaltemperatur"];
  var GEN_CM = ["mucus", "cervical mucus", "discharge", "fluid", "βλέννα", "zervixschleim", "schleim"];
  var GEN_NOTE = ["note", "notes", "comment", "σημείωση", "σημειώσεις", "notiz", "notizen"];
  function parseGeneric(recs) {
    var c = collector("csv"), head = recs.head, rows = recs.rows;
    var sc = K.col(head, GEN_START);
    if (sc !== -1) {
      var ec = K.col(head, GEN_END);
      var hint = dateHint(rows.map(function (r) { return r[head[sc]]; }).concat(ec !== -1 ? rows.map(function (r) { return r[head[ec]]; }) : []));
      rows.forEach(function (r) {
        c.period(dkey(r[head[sc]], hint), ec !== -1 ? dkey(r[head[ec]], hint) : null);
      });
      return c.done();
    }
    var dc = K.col(head, GEN_DATE);
    if (dc === -1) return { error: "bad" };
    var fc = K.col(head, GEN_FLOW), bc = K.col(head, GEN_BBT), mc = K.col(head, GEN_CM), nc = K.col(head, GEN_NOTE);
    var onlyBleeding = bc === -1 && mc === -1 && nc === -1;     // a plain list of bleeding days
    var h2 = dateHint(rows.map(function (r) { return r[head[dc]]; }));
    rows.forEach(function (r) {
      var k = dkey(r[head[dc]], h2);
      if (!k) return;
      if (fc === -1) { if (onlyBleeding) c.flow(k, -1); }
      else {
        var raw = r[head[fc]], f = flowOf(raw);
        if (f === null && K.clean(raw, 5) === "" && onlyBleeding) f = -1;
        c.flow(k, f);
      }
      if (bc !== -1) c.bbt(k, bbtOf(r[head[bc]]));
      if (mc !== -1) c.cm(k, cmOf(r[head[mc]]));
      if (nc !== -1) c.note(k, r[head[nc]]);
    });
    return c.done();
  }

  // ---------- 5. Detect + read ----------
  function parseText(text, name) {
    text = String(text === null || text === undefined ? "" : text);
    if (text.length > MAX_TEXT) return { error: "big" };
    var t0 = text.replace(/^﻿/, "").replace(/^\s+/, "");
    if (!t0) return { error: "empty" };
    if (t0.charAt(0) === "{" || t0.charAt(0) === "[") {
      var obj = K.json(t0);
      if (obj === null) return { error: "bad" };
      var arr = clueArray(obj);
      if (arr) return parseClue(arr);
      var flo = parseFlo(obj);
      return flo.error ? { error: "bad" } : flo;
    }
    var recs = K.records(t0, { maxRows: MAX_DAYS });
    if (!recs.head.length || recs.head.length < 1) return { error: "bad" };
    if (K.col(recs.head, ["date"]) !== -1 &&
        (K.col(recs.head, ["bleeding.value"]) !== -1 || K.col(recs.head, ["temperature.value"]) !== -1)) return parseDrip(recs);
    return parseGeneric(recs);
  }

  // bytes: Uint8Array of the picked file
  function readBytes(bytes, name) {
    if (!bytes || bytes.length > MAX_FILE) return Promise.resolve({ error: "big" });
    if (!K.isZip(bytes)) {
      var txt;
      try { txt = K.text(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
      return Promise.resolve(parseText(txt, name));
    }
    var z;
    try { z = K.unzip(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
    var names = z.names.filter(function (n) {
      return /\.(json|cluedata|csv)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n);
    }).slice(0, MAX_ZIP_ENTRIES);
    var results = [];
    return names.reduce(function (p, n) {
      return p.then(function () {
        return z.text(n, MAX_TEXT).then(function (s) {
          var r = parseText(s, n);
          if (!r.error) results.push(r);
        }, function () {});
      });
    }, Promise.resolve()).then(function () {
      if (!results.length) return { error: names.length ? "empty" : "bad" };
      return combine(results);
    });
  }
  function combine(list) {
    var days = {}, periods = [];
    list.forEach(function (r) {
      periods = periods.concat(r.periods);
      Object.keys(r.days).forEach(function (k) {
        var d = days[k] || (days[k] = {}), x = r.days[k];
        ["fl", "bbt", "cm", "note"].forEach(function (f) { if (d[f] === undefined && x[f] !== undefined) d[f] = x[f]; });
      });
    });
    return { source: list[0].source, periods: mergeRanges(periods.slice(0, MAX_PERIODS)), days: days };
  }

  // ---------- 6. Plan against the current data ----------
  // cur = { periods: [{ id, start, end|null }], days: [{ id, day, fl,
  // bbt, cm, note, fm }] }; opts.today = "YYYY-MM-DD" (local).
  // → { add: [{ id, start, end, flow }], overlap, guessed, avg,
  //     fills: [{ id, key, day, isNew, set: { fl?, bbt?, cm?, note? } }],
  //     stats: { found, from, to, fl, bbt, cm, note, days } }
  function plan(res, cur, opts) {
    opts = opts || {};
    var today = opts.today || localKey(Date.now()), tn = kNum(today);
    var exist = ((cur && cur.periods) || []).filter(function (p) { return p && typeof p.start === "number"; })
      .map(function (p) {
        return { a: kNum(localKey(p.start)), b: typeof p.end === "number" ? kNum(localKey(p.end)) : Infinity, id: p.id };
      });
    var ip = mergeRanges((res.periods || []).filter(function (p) { return kNum(p.s) !== null && kNum(p.s) <= tn; })
      .map(function (p) { return { s: p.s, e: p.e && kNum(p.e) > tn ? null : p.e }; }));
    // average length: the file's ended periods, else the app's
    var lens = [];
    ip.forEach(function (p) { if (p.e) lens.push(kNum(p.e) - kNum(p.s) + 1); });
    if (!lens.length) exist.forEach(function (p) { if (isFinite(p.b)) lens.push(p.b - p.a + 1); });
    var avg = lens.length ? Math.max(1, Math.min(10, Math.round(lens.reduce(function (x, y) { return x + y; }, 0) / lens.length))) : 5;
    var guessed = 0;
    var starts = ip.map(function (p) { return kNum(p.s); }).concat(exist.map(function (p) { return p.a; }));
    var ranges = ip.map(function (p) {
      var a = kNum(p.s);
      if (p.e) return { a: a, b: kNum(p.e) };
      var next = Infinity;
      starts.forEach(function (x) { if (x > a && x < next) next = x; });
      if (next === Infinity && tn - a < avg + 3) return { a: a, b: Infinity };     // still going
      guessed++;
      return { a: a, b: Math.min(a + avg - 1, next - 1, tn) };
    });
    var add = [], overlap = 0, finals = exist.slice();
    ranges.forEach(function (r) {
      var hit = exist.some(function (p) { return r.a <= p.b && r.b >= p.a; });
      if (hit) { overlap++; return; }
      finals.push(r);
      add.push({
        id: "imp" + kOf(r.a).replace(/-/g, ""),
        start: localMs(kOf(r.a)),
        end: r.b === Infinity ? null : localMs(kOf(r.b)),
        a: r.a, b: r.b
      });
    });
    function inPeriod(n) { return finals.some(function (p) { return n >= p.a && n <= p.b; }); }
    var byId = {};
    ((cur && cur.days) || []).forEach(function (d) { if (d && d.id) byId[d.id] = d; });
    var fills = [], st = { found: ip.length, from: "", to: "", fl: 0, bbt: 0, cm: 0, note: 0, days: 0 };
    var keys = Object.keys(res.days || {}).filter(function (k) { return kNum(k) !== null && kNum(k) <= tn; }).sort();
    keys.forEach(function (k) {
      if (!st.from || k < st.from) st.from = k;
      if (!st.to || k > st.to) st.to = k;
    });
    ip.forEach(function (p) {
      if (!st.from || p.s < st.from) st.from = p.s;
      var e = p.e || p.s;
      if (!st.to || e > st.to) st.to = e;
    });
    keys.forEach(function (k) {
      var src = res.days[k], id = "d-" + k, rec = byId[id], set = {}, any = false;
      var fm = rec && rec.fm && typeof rec.fm === "object" ? rec.fm : null;
      function free(f) {                       // the person's value, or their clear, wins
        if (!rec) return true;
        return rec[f] === undefined && !(fm && typeof fm[f] === "number" && fm[f] > 0);
      }
      if (src.fl !== undefined && free("fl") && inPeriod(kNum(k))) { set.fl = src.fl; st.fl++; any = true; }
      if (src.bbt !== undefined && free("bbt")) { set.bbt = src.bbt; st.bbt++; any = true; }
      if (src.cm !== undefined && free("cm")) { set.cm = src.cm; st.cm++; any = true; }
      if (src.note && (!rec || (!rec.note && !(fm && fm.note > 0)))) { set.note = src.note; st.note++; any = true; }
      if (!any) return;
      st.days++;
      fills.push({ id: id, key: k, day: localMs(k), isNew: !rec, set: set });
    });
    add.forEach(function (p) {                 // the bar's flow: the most frequent day flow
      var n = [0, 0, 0, 0];
      for (var x = p.a; x <= Math.min(p.b, p.a + MAX_LEN); x++) {
        var d = res.days && res.days[kOf(x)];
        if (d && d.fl) n[d.fl]++;
      }
      var best = 2;
      if (n[1] + n[2] + n[3]) { best = 1; for (var f = 2; f <= 3; f++) if (n[f] >= n[best]) best = f; }
      p.flow = best;
      delete p.a; delete p.b;
    });
    return { add: add, overlap: overlap, guessed: guessed, avg: avg, fills: fills, stats: st };
  }

  var API = {
    MAX_FILE: MAX_FILE, parseText: parseText, readBytes: readBytes, plan: plan,
    flowOf: flowOf, cmOf: cmOf, bbtOf: bbtOf, dkey: dkey
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosCycleImport = API;
})(typeof self !== "undefined" ? self : this);
