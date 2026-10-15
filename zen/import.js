// ============================================================
// orOS Micro-Zen — import.js (pure logic: "Import sessions")
// Reads a file the person exported from a meditation app, as DATA
// only (nothing is run, nothing becomes HTML):
//   - Insight Timer  the sessions CSV: "Started At" (e.g. 10/15/2026
//                    07:12:33; day or month first, told from the
//                    data), "Duration" (H:MM:SS), "Preset", "Activity"
//                    (Meditation, Yoga…)
//   - any CSV        a date (or date-time, or a date and a time
//                    column) and minutes (or seconds, or a duration
//                    like 0:10:00), optional activity column
// Micro-Zen keeps totals per day, not single sessions (zen.js:
// rows: { id: { b, d: { day: [sessions, seconds, breaths] } } },
// one row per device, merged per row: the newer epoch b wins, equal
// epochs keep the larger of each counter). An import writes its own
// rows, one per source and month ("imp" + i|c + YYYYMM): the same
// file again (or on another device) gives the same counters, so
// nothing is counted twice; a longer export only grows them.
// Undo puts the days back as they were (zeros for days the import
// added) under a newer epoch, so every device takes the old values.
//   parseText(text, name)  → { source, sessions: [{ ts, day, sec,
//                              act }], acts: { name: n }, skip }
//                              or { error: "bad"|"empty"|"big" }
//   readBytes(bytes, name) → Promise of the same
//   plan(res, data, opts)  → per day what the import would add
//                              (opts.acts = { name: false } leaves an
//                              activity out; opts.now)
//   apply(data, pl)        → { rows, undo }: the import's rows (the
//                              caller merges them in), undo record
//   revert(data, undo, now)→ rows that put those days back
// Caps: file size, rows, days, duration of one session.
// Needs OrosImportKit (../importkit.js).
// UMD: window.OrosZenImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var K = (typeof module !== "undefined" && module.exports && typeof require === "function")
    ? require("../importkit.js") : root.OrosImportKit;

  var MAX_FILE = 20 * 1024 * 1024;
  var MAX_TEXT = 20 * 1024 * 1024;
  var MAX_ROWS = 100000;
  var MAX_DAYS = 6000;                  // ~16 years of days
  var MAX_SEC = 8 * 3600;               // one session
  var MIN_SEC = 10;
  var ROW_RE = /^[a-z0-9]{6,32}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function dayOf(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // ---------- 1. Values ----------
  // D/M/Y or M/D/Y, from the values themselves; when every date could
  // be either, the reading that keeps the rows in order
  function dateHint(vals) {
    var dmy = false, mdy = false;
    vals.forEach(function (v) {
      var m = /^\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/.exec(String(v === null || v === undefined ? "" : v));
      if (!m) return;
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    });
    if (dmy !== mdy) return dmy ? "dmy" : "mdy";
    var best = "", bestN = Infinity, tie = false;
    ["dmy", "mdy"].forEach(function (h) {
      var list = vals.slice(0, 3000).map(function (v) { return K.parseDate(K.clean(v, 80), h); }).filter(isFinite), up = 0, down = 0;
      for (var i = 1; i < list.length; i++) { if (list[i] < list[i - 1]) down++; else if (list[i] > list[i - 1]) up++; }
      var n = Math.min(up, down);
      if (n < bestN) { best = h; bestN = n; tie = false; } else if (n === bestN) tie = true;
    });
    return tie ? "" : best;
  }
  // seconds: "1:05:00" (h:mm:ss), "10:30" (m:ss), "1h 5m", "20 min",
  // a bare number in `unit` ("s" or minutes)
  function durSec(v, unit) {
    var s = K.clean(v, 60).toLowerCase(), m;
    if (!s) return NaN;
    m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(s);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
    m = /^(\d+):(\d{1,2})$/.exec(s);
    if (m) return +m[1] * 60 + +m[2];
    var tot = 0, any = false, re = /(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/g;
    while ((m = re.exec(s))) {
      var n = K.num(m[1]), u = m[2].charAt(0);
      tot += u === "h" ? n * 3600 : (u === "m" ? n * 60 : n);
      any = true;
    }
    if (any) return Math.round(tot);
    if (!/^[\d.,\s]+$/.test(s)) return NaN;
    var x = K.num(s);
    return isFinite(x) ? Math.round(unit === "s" ? x : x * 60) : NaN;
  }

  // ---------- 2. Parse ----------
  var DATE_COLS = ["Started At", "Start Time", "Started", "Start", "Date Time", "Datetime", "Timestamp", "Date", "Day", "When"];
  var TIME_COLS = ["Time", "Start time of day", "Clock"];
  var SEC_COLS = ["Seconds", "Secs", "Duration (s)", "Duration (sec)", "Duration (seconds)", "Duration Seconds"];
  var MIN_COLS = ["Minutes", "Mins", "Min", "Duration (min)", "Duration (minutes)", "Duration Minutes", "Duration", "Length", "Time (min)"];
  var ACT_COLS = ["Activity", "Type", "Category", "Kind", "Practice"];

  function parseText(text, name) {
    text = String(text === null || text === undefined ? "" : text);
    if (text.length > MAX_TEXT) return { error: "big" };
    var t0 = text.replace(/^\ufeff/, "").replace(/^\s+/, "");
    if (!t0) return { error: "empty" };
    var recs = K.csv(t0, { maxRows: MAX_ROWS }), head = recs.head;
    var insight = K.col(head, ["Started At"]) !== -1 && K.col(head, ["Duration"]) !== -1;
    var dc = K.col(head, DATE_COLS);
    var sc = K.col(head, SEC_COLS), mc = sc === -1 ? K.col(head, MIN_COLS) : -1;
    if (dc === -1 || (sc === -1 && mc === -1)) return { error: "bad" };
    var tc = K.col(head, TIME_COLS);
    if (tc === dc) tc = -1;
    var ac = K.col(head, ACT_COLS);
    var hint = dateHint(recs.rows.map(function (r) { return r[dc]; }));
    var out = { source: insight ? "insight" : "csv", sessions: [], acts: {}, skip: 0 };
    recs.rows.forEach(function (r) {
      var dv = K.clean(r[dc], 80);
      if (tc !== -1 && K.clean(r[tc], 20) && !/\d:\d/.test(dv)) dv += " " + K.clean(r[tc], 20);
      var ts = K.parseDate(dv, hint);
      var sec = sc !== -1 ? durSec(r[sc], "s") : durSec(r[mc], "m");
      if (!isFinite(ts) || ts < Date.UTC(1990, 0, 1) || !(sec >= MIN_SEC) || sec > MAX_SEC) { out.skip++; return; }
      var act = ac !== -1 ? K.clean(r[ac], 40) : "";
      out.sessions.push({ ts: ts, day: dayOf(ts), sec: Math.round(sec), act: act });
      out.acts[act] = (out.acts[act] || 0) + 1;
    });
    if (!out.sessions.length) return out.skip ? { error: "empty" } : { error: "empty" };
    return out;
  }
  function readBytes(bytes, name) {
    if (!bytes || bytes.length > MAX_FILE) return Promise.resolve({ error: "big" });
    if (K.isZip(bytes)) return Promise.resolve({ error: "bad" });
    var t;
    try { t = K.text(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
    return Promise.resolve(parseText(t, name));
  }

  // ---------- 3. Plan ----------
  function rowId(source, day) { return "imp" + (source === "insight" ? "i" : "c") + day.slice(0, 4) + day.slice(5, 7); }
  // data = zen.js data { br, rows }; → { days: [{ id, day, cell:
  // [sessions, seconds], dup }], add, dup, sessions, sec, from, to,
  // future }; cell = the day's imported totals (the chosen activities)
  function plan(res, data, opts) {
    opts = opts || {};
    var acts = opts.acts || {}, today = dayOf(opts.now || Date.now());
    var rows = (data && data.rows) || {}, per = {}, future = 0;
    (res.sessions || []).forEach(function (s) {
      if (acts[s.act] === false) return;
      if (s.day > today) { future++; return; }
      var c = per[s.day] || (per[s.day] = [0, 0]);
      c[0]++; c[1] += s.sec;
    });
    var out = { days: [], add: 0, dup: 0, sessions: 0, sec: 0, from: "", to: "", future: future };
    Object.keys(per).sort().slice(-MAX_DAYS).forEach(function (day) {
      var id = rowId(res.source, day), row = rows[id], cur = row && row.d && row.d[day];
      var c = per[day], dup = !!cur && cur[0] >= c[0] && cur[1] >= c[1];
      out.days.push({ id: id, day: day, cell: c, dup: dup });
      out.sessions += c[0];
      out.sec += c[1];
      if (dup) out.dup++; else out.add++;
      if (!out.from) out.from = day;
      out.to = day;
    });
    return out;
  }

  // ---------- 4. Apply + undo ----------
  function copyRow(r) {
    var d = {};
    Object.keys(r.d || {}).forEach(function (k) { d[k] = r.d[k].slice(); });
    return { b: r.b, d: d };
  }
  // → { rows: { id: row } to merge into data (newer counters only),
  //     undo: [{ id, day, before: cell|null }], sessions, sec }
  function apply(data, pl) {
    var rows = {}, undo = [], src = (data && data.rows) || {}, br = isInt(data && data.br) ? data.br : 0;
    var n = 0, sec = 0;
    pl.days.forEach(function (x) {
      if (x.dup || !ROW_RE.test(x.id) || !DAY_RE.test(x.day)) return;
      var row = rows[x.id] || (rows[x.id] = src[x.id] ? copyRow(src[x.id]) : { b: br, d: {} });
      var cur = row.d[x.day];
      if (cur && cur[0] >= x.cell[0] && cur[1] >= x.cell[1]) return;
      undo.push({ id: x.id, day: x.day, before: cur ? cur.slice() : null });
      var c0 = cur ? cur : [0, 0, 0];
      n += Math.max(0, x.cell[0] - c0[0]);
      sec += Math.max(0, x.cell[1] - c0[1]);
      row.d[x.day] = [Math.max(c0[0], x.cell[0]), Math.max(c0[1], x.cell[1]), c0[2] || 0];
    });
    Object.keys(rows).forEach(function (id) { if (!undo.some(function (u) { return u.id === id; })) delete rows[id]; });
    return { rows: rows, undo: undo, sessions: n, sec: sec };
  }
  // The touched rows as they are NOW, with each imported day put back
  // (a day the import added becomes [0, 0, 0]) under a newer epoch:
  // a newer b wins the merge outright, on every device.
  function revert(data, undo, now) {
    var rows = {}, src = (data && data.rows) || {};
    now = now || Date.now();
    undo.forEach(function (u) {
      if (!src[u.id]) return;
      var row = rows[u.id] || (rows[u.id] = copyRow(src[u.id]));
      row.b = Math.max(now, src[u.id].b + 1);
      row.d[u.day] = u.before ? u.before.slice() : [0, 0, 0];
    });
    return rows;
  }

  var API = {
    MAX_FILE: MAX_FILE, parseText: parseText, readBytes: readBytes, plan: plan, apply: apply, revert: revert,
    durSec: durSec, rowId: rowId
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosZenImport = API;
})(typeof self !== "undefined" ? self : this);
