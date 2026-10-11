// ============================================================
// orOS Today — summary core (v1.0.0)
// ------------------------------------------------------------
// Pure logic, no DOM, no storage: the shell (today/host.js) and the
// Today app use it, node tests require it (tests/today.test.js).
//
// Provider contract (OROS_BIBLE.md "Today summary", BR-TODAY):
//   • Each app with something dated ships <app>/today.js and names it
//     in apps.json: "today": "today.js", or a list when the shell must
//     load another file of the app first: "today": ["core.js", "today.js"].
//     The shell loads those files the first time a summary is built.
//   • The file pushes ONE object onto window.orosTodayProviders:
//       { id: "<app id>",
//         keys: ["oros-<app>-data"],            // what it reads
//         collect: function (ctx) → [row] | Promise<[row]>,
//         open: function (target, win)          // optional
//       }
//     row = { id, due, time, title, text, kind, target }
//       due    "YYYY-MM-DD" | null (null = today, no date of its own)
//       time   "HH:MM" | null (24-hour)
//       title / text: PLAIN text (drawn with textContent only)
//       kind   "task" (can be late) | "event" (happens on its day)
//              | "info" (the line at the top: weather, name days…)
//       target small JSON value handed back to the app on open
//   • READ-ONLY: a provider never writes storage, never talks to sync,
//     never fetches. The date logic stays in the app's own core; the
//     provider only turns its answer into rows.
//   • ctx = { today, horizon, now, lang, readJSON(key), readRaw(key),
//     addDays, diff }.
//   • A provider that throws or answers later than TIMEOUT_MS is left
//     out of that summary; one app never breaks the summary.
// ============================================================
(function (root) {
  "use strict";

  var HORIZON     = 3;       // "Coming up": the next 3 days
  var PER_APP_MAX = 50;      // rows kept per app
  var TIMEOUT_MS  = 1000;    // slower providers are skipped
  var TITLE_LEN   = 160;
  var TEXT_LEN    = 240;
  var EMPTY_RETRY_MS = 30 * 60 * 1000;   // an empty day is checked again after 30 min
  var FAIL_GRACE_MS  = 2 * 60 * 1000;    // offline / failed sync: local data after 2 min
  var SYNC_WAIT_MS   = 10 * 60 * 1000;   // no sync answer at all: local data after 10 min
  var DEFAULT_HOUR   = 6;
  var MIN_HOUR = 0, MAX_HOUR = 12;
  var MAX_APPS = 200;

  // Apps the summary leaves out until the user switches them on in
  // the Today settings (sensitive, Chris 2026-10-11: "the user can
  // include them"). Every other app is in unless switched off.
  var DEFAULT_OFF = { cycle: 1, mood: 1 };

  var YMD_RE  = /^(\d{4})-(\d{2})-(\d{2})$/;
  var HM_RE   = /^([01]\d|2[0-3]):[0-5]\d$/;
  var ID_RE   = /^[a-z0-9][a-z0-9_-]{0,40}$/;
  var FILE_RE = /^[a-z0-9][a-z0-9_-]{0,40}\.js$/;
  var KINDS   = { task: 1, event: 1, info: 1 };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  // ---------- 1. Days ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(d) {
    d = d instanceof Date ? d : new Date(d);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function isYmd(s) {
    var m = typeof s === "string" && YMD_RE.exec(s);
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  // Whole days in UTC: no DST hour can shift a date.
  function dayNum(s) {
    var m = YMD_RE.exec(s);
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  }
  function fromDayNum(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function addDays(s, n) { return fromDayNum(dayNum(s) + n); }
  function diff(a, b) { return dayNum(b) - dayNum(a); }   // days from a to b

  // ---------- 2. Rows ----------
  function str(v, n) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
  }
  // A small JSON value only (deep links): anything else is dropped.
  function cleanTarget(t) {
    if (t === undefined || t === null) return null;
    try {
      var s = JSON.stringify(t);
      if (typeof s !== "string" || s.length > 500) return null;
      return JSON.parse(s);
    } catch (e) { return null; }
  }
  function cleanRow(r, app) {
    if (!isObj(r)) return null;
    var title = str(r.title, TITLE_LEN);
    if (!title) return null;
    var kind = typeof r.kind === "string" && has(KINDS, r.kind) ? r.kind : "task";
    var id = str(r.id, 120) || title;
    return {
      key: app + ":" + id,
      app: app,
      id: id,
      due: isYmd(r.due) ? r.due : null,
      time: typeof r.time === "string" && HM_RE.test(r.time) ? r.time : null,
      title: title,
      text: str(r.text, TEXT_LEN),
      kind: kind,
      target: cleanTarget(r.target)
    };
  }

  // ---------- 3. Groups ----------
  // rows (already clean, every app) → {
  //   info:    [row]               lines at the top
  //   overdue: [row]               tasks whose day passed
  //   today:   [row]               due today, or no day of their own
  //   soon:    [{ day, rows }]     the next `horizon` days, day by day
  // }
  // An event (a holiday, a trip day) whose day passed is not late: it
  // is gone. Anything later than the horizon is left out.
  function group(rows, today, horizon, order) {
    horizon = typeof horizon === "number" ? horizon : HORIZON;
    var pos = {};
    (order || []).forEach(function (id, i) { pos[id] = i; });
    var out = { info: [], overdue: [], today: [], soon: [] }, soon = {};
    (rows || []).forEach(function (r) {
      if (!r) return;
      var d = r.due ? diff(today, r.due) : 0;
      if (r.kind === "info") { if (d === 0) out.info.push(r); return; }
      if (d < 0) { if (r.kind === "task") out.overdue.push(r); return; }
      if (d === 0) { out.today.push(r); return; }
      if (d > horizon) return;
      (soon[r.due] || (soon[r.due] = [])).push(r);
    });
    function by(a, b) {
      // timed first (24-hour order), then all day; then app order; then title
      if (a.time !== b.time) {
        if (a.time === null) return 1;
        if (b.time === null) return -1;
        return cmpStr(a.time, b.time);
      }
      var pa = has(pos, a.app) ? pos[a.app] : 9999, pb = has(pos, b.app) ? pos[b.app] : 9999;
      return (pa - pb) || cmpStr(a.title.toLowerCase(), b.title.toLowerCase()) || cmpStr(a.key, b.key);
    }
    out.info.sort(by);
    out.overdue.sort(function (a, b) { return cmpStr(a.due, b.due) || by(a, b); });
    out.today.sort(by);
    Object.keys(soon).sort().forEach(function (day) {
      out.soon.push({ day: day, rows: soon[day].sort(by) });
    });
    return out;
  }
  function counts(g) {
    var n = 0;
    (g.soon || []).forEach(function (d) { n += d.rows.length; });
    return { overdue: (g.overdue || []).length, today: (g.today || []).length, soon: n };
  }
  // The daily notice speaks only when there is something for TODAY:
  // late tasks or today's own rows. Info lines and the next days alone
  // stay silent (the tab still shows them).
  function worthNotice(c) { return c.overdue + c.today > 0; }

  // Numbers only: a toast can show over another window, so no text of
  // any app (sensitive or not) goes into the notice.
  var NOTE = {
    en: { title: "Today", over: "{n} overdue", over1: "1 overdue", today: "{n} today", today1: "1 today",
          soon: "{n} coming up", soon1: "1 coming up" },
    el: { title: "Σήμερα", over: "{n} εκπρόθεσμα", over1: "1 εκπρόθεσμο", today: "{n} για σήμερα",
          today1: "1 για σήμερα", soon: "{n} έρχονται", soon1: "1 έρχεται" }
  };
  function noticeText(c, lang) {
    var w = NOTE[lang] || NOTE.en, parts = [];
    function one(n, k) { if (n) parts.push(n === 1 ? w[k + "1"] : w[k].replace("{n}", n)); }
    one(c.overdue, "over");
    one(c.today, "today");
    one(c.soon, "soon");
    return { title: w.title, body: parts.join(" · ") };
  }

  // ---------- 4. Running providers ----------
  function withTimeout(v, ms) {
    if (!v || typeof v.then !== "function") return Promise.resolve(v);
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms);
      v.then(function (x) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(x);
      }, function () {
        if (done) return;
        done = true; clearTimeout(timer); resolve(null);
      });
    });
  }
  // providers: window.orosTodayProviders; opts.enabled(id) → bool.
  // → Promise<{ rows: [row], apps: { id: total } }>
  function run(providers, ctx, opts) {
    opts = opts || {};
    var seen = {}, list = [];
    (providers || []).forEach(function (p) {
      if (!p || typeof p.id !== "string" || !ID_RE.test(p.id) || typeof p.collect !== "function") return;
      if (seen[p.id]) return;
      if (opts.enabled && !opts.enabled(p.id)) return;
      seen[p.id] = true;
      list.push(p);
    });
    return Promise.all(list.map(function (p) {
      var out;
      try { out = p.collect(ctx); } catch (e) { out = null; }
      return withTimeout(out, opts.timeoutMs || TIMEOUT_MS).then(function (arr) {
        if (!Array.isArray(arr)) return null;
        var rows = [], keys = {};
        for (var i = 0; i < arr.length && rows.length < PER_APP_MAX * 4; i++) {
          var r = cleanRow(arr[i], p.id);
          if (!r || keys[r.key]) continue;
          keys[r.key] = true;
          rows.push(r);
        }
        return { id: p.id, rows: rows };
      });
    })).then(function (res) {
      var rows = [], apps = {};
      res.forEach(function (x) {
        if (!x) return;
        apps[x.id] = x.rows.length;
        rows = rows.concat(x.rows);
      });
      return { rows: rows, apps: apps };
    });
  }
  // At most PER_APP_MAX rows of one app per group; the rest is a count.
  function trim(g) {
    function cut(list) {
      var n = {}, keep = [], more = {};
      list.forEach(function (r) {
        n[r.app] = (n[r.app] || 0) + 1;
        if (n[r.app] <= PER_APP_MAX) keep.push(r);
        else more[r.app] = (more[r.app] || 0) + 1;
      });
      return { rows: keep, more: more };
    }
    var o = cut(g.overdue), t = cut(g.today);
    return {
      info: g.info.slice(0, PER_APP_MAX),
      overdue: o.rows, overdueMore: o.more,
      today: t.rows, todayMore: t.more,
      soon: g.soon.map(function (d) { var c = cut(d.rows); return { day: d.day, rows: c.rows, more: c.more }; })
    };
  }

  // ---------- 5. Settings slice "today" (oros-today-data) ----------
  // { ver, on:{v,m}, hour:{v,m}, absorb:{v,m}, apps:{ id:{v,m} } }
  // Each field: newest m wins; a tie goes to the larger JSON (R5).
  // m = 0 means "the default, never touched". Canonical: fixed key
  // order, apps sorted by id (R26).
  var DATA_VER = 1;
  function okStamp(m) { return typeof m === "number" && isFinite(m) && m >= 0 && m <= 8.64e15 ? Math.floor(m) : 0; }
  function normField(f, check, def) {
    if (isObj(f) && check(f.v)) return { v: f.v, m: okStamp(f.m) };
    return { v: def, m: 0 };
  }
  function isBool(v) { return v === true || v === false; }
  function isHour(v) { return typeof v === "number" && v % 1 === 0 && v >= MIN_HOUR && v <= MAX_HOUR; }
  function normData(raw) {
    raw = isObj(raw) ? raw : {};
    var apps = {}, ids = [];
    if (isObj(raw.apps)) {
      Object.keys(raw.apps).forEach(function (id) {
        if (!ID_RE.test(id) || !isObj(raw.apps[id]) || !isBool(raw.apps[id].v)) return;
        ids.push(id);
      });
    }
    ids.sort(cmpStr).slice(0, MAX_APPS).forEach(function (id) {
      apps[id] = { v: raw.apps[id].v, m: okStamp(raw.apps[id].m) };
    });
    return {
      ver: DATA_VER,
      on: normField(raw.on, isBool, true),
      hour: normField(raw.hour, isHour, DEFAULT_HOUR),
      absorb: normField(raw.absorb, isBool, true),
      apps: apps
    };
  }
  function better(a, b) {
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return JSON.stringify(a.v) >= JSON.stringify(b.v) ? a : b;
  }
  function merge(a, b) {
    a = normData(a); b = normData(b);
    var apps = {}, ids = {};
    Object.keys(a.apps).concat(Object.keys(b.apps)).forEach(function (id) { ids[id] = true; });
    Object.keys(ids).sort(cmpStr).slice(0, MAX_APPS).forEach(function (id) {
      var x = a.apps[id], y = b.apps[id];
      var w = x && y ? better(x, y) : (x || y);
      apps[id] = { v: w.v, m: w.m };
    });
    function pick(n) { var w = better(a[n], b[n]); return { v: w.v, m: w.m }; }
    return { ver: DATA_VER, on: pick("on"), hour: pick("hour"), absorb: pick("absorb"), apps: apps };
  }
  // One real change, stamped at the change (R27). Same value → same data.
  function setField(data, name, value, now, appId) {
    var d = normData(data);
    var m = Math.max(okStamp(now), 1);
    if (name === "app") {
      if (!ID_RE.test(String(appId)) || !isBool(value)) return d;
      var cur = d.apps[appId];
      if (cur ? cur.v === value : value === appOnDefault(appId)) return d;
      d.apps[appId] = { v: value, m: cur ? Math.max(m, cur.m + 1) : m };
      return normData(d);
    }
    var check = name === "hour" ? isHour : isBool;
    if (!has(d, name) || name === "ver" || name === "apps" || !check(value)) return d;
    if (d[name].v === value) return d;
    d[name] = { v: value, m: Math.max(m, d[name].m + 1) };
    return d;
  }
  function appOnDefault(id) { return !has(DEFAULT_OFF, id); }
  function appOn(data, id) {
    var d = isObj(data) && isObj(data.apps) ? data.apps : {};
    if (has(d, id) && isObj(d[id]) && isBool(d[id].v)) return d[id].v;
    return appOnDefault(id);
  }

  // ---------- 6. When to build ----------
  // s = { on, hour, now (ms), last ("YYYY-MM-DD" | ""), settled,
  //       emptyAt (ms | 0), syncAt (ms | 0) }
  // → "skip" (nothing to do today), "wait" (not yet), "build".
  function decide(s) {
    var d = new Date(s.now), today = ymdOf(d);
    if (!s.on) return "skip";
    if (s.last === today) return "skip";
    if (d.getHours() < s.hour) return "wait";
    if (!s.settled) return "wait";
    if (s.emptyAt && ymdOf(new Date(s.emptyAt)) === today &&
        s.now - s.emptyAt < EMPTY_RETRY_MS && !(s.syncAt > s.emptyAt)) return "wait";
    return "build";
  }
  // Has this device's data caught up with the cloud? The summary is
  // built after the unlock AND the first merge, so a second device
  // never announces yesterday's state.
  // s = { connected, unlocked, online, now, bootAt, syncAt, failAt }
  function settled(s) {
    if (!s.connected) return true;              // no cloud sync: local data is all there is
    if (!s.unlocked) return false;              // locked: wait for the passphrase
    if (s.syncAt) return true;                  // a pull + merge finished
    if (s.failAt && s.now - s.failAt >= FAIL_GRACE_MS) return true;
    if (!s.online && s.now - s.bootAt >= FAIL_GRACE_MS) return true;
    return s.now - s.bootAt >= SYNC_WAIT_MS;    // the engine never answered
  }

  // ---------- 7. Text for the Assistant ----------
  var ASK = {
    en: "From my Today summary ({d}): {a} · {t}",
    el: "Από τη σύνοψη «Σήμερα» ({d}): {a} · {t}"
  };
  function askText(row, appName, day, lang) {
    var s = (ASK[lang] || ASK.en).replace("{d}", day).replace("{a}", str(appName, 60))
      .replace("{t}", row.title + (row.time ? " (" + row.time + ")" : "") + (row.text ? " — " + row.text : ""));
    return s.slice(0, 2000);
  }

  // Apps.json "today" field → the files to load, in order ("" = none).
  function todayFiles(app) {
    if (!app || app.type !== "internal" || typeof app.url !== "string" || !/^[a-z0-9_-]+\/$/.test(app.url)) return [];
    var f = app.today;
    var list = typeof f === "string" ? [f] : Array.isArray(f) ? f : [];
    if (!list.length || list.length > 4) return [];
    for (var i = 0; i < list.length; i++) if (typeof list[i] !== "string" || !FILE_RE.test(list[i])) return [];
    return list.map(function (x) { return app.url + x; });
  }

  var api = {
    HORIZON: HORIZON, PER_APP_MAX: PER_APP_MAX, TIMEOUT_MS: TIMEOUT_MS, DEFAULT_HOUR: DEFAULT_HOUR,
    MIN_HOUR: MIN_HOUR, MAX_HOUR: MAX_HOUR, EMPTY_RETRY_MS: EMPTY_RETRY_MS, FAIL_GRACE_MS: FAIL_GRACE_MS,
    SYNC_WAIT_MS: SYNC_WAIT_MS, DEFAULT_OFF: DEFAULT_OFF, DATA_VER: DATA_VER, ID_RE: ID_RE,
    ymdOf: ymdOf, isYmd: isYmd, addDays: addDays, diff: diff,
    cleanRow: cleanRow, group: group, trim: trim, counts: counts, worthNotice: worthNotice,
    noticeText: noticeText, run: run,
    normData: normData, merge: merge, setField: setField, appOn: appOn, appOnDefault: appOnDefault,
    decide: decide, settled: settled, askText: askText, todayFiles: todayFiles
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) {
    root.OrosTodayAgg = api;
    root.orosTodayProviders = root.orosTodayProviders || [];
  }
})(typeof window !== "undefined" ? window : globalThis);
