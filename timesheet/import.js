// ============================================================
// orOS Timesheet — import.js ("Import from another app", v1.0.0)
// Extends the Wave 5 import (core.importPlan: Toggl, Clockify,
// Harvest CSV) with two more trackers and Excel files. Pure: no DOM,
// no storage; timesheet.js runs the picker, the preview, the one
// write and the Undo.
//
// Sources (detected from the header row):
//   kimai  Kimai, Times › Export (CSV or Excel): Date, From, To,
//          Duration, Customer, Project, Activity, Description, User,
//          Rate, Hourly rate, Billable, Tags. Customer → client,
//          Activity → task, Hourly rate → project rate (only for a
//          project made here). No From / To: the Duration is laid
//          from 09:00 like Harvest.
//   tempo  Jira Tempo, Worklogs report › Export (CSV): Issue Key,
//          Issue summary, Hours, Work date, Username, Work Description,
//          Project Name / Key, Account Customer, Billed Hours. Task =
//          "KEY-12 Summary". A work date with a time starts there, a
//          bare day is laid from 09:00.
//   Anything else goes on to core.importPlan (an .xlsx turned into
//   CSV first, so an Excel Toggl / Clockify / Harvest export works).
//
// readBytes(bytes, name, getXlsx) → Promise<{ rows, text? } | { error:
//   "big" | "bad" | "lib" }> (an .xlsx through the vendored SheetJS,
//   getXlsx() → Promise<XLSX>, loaded only for a zip).
// planRows(rows, data, order, user) → the shape of core.importPlan
//   ({ source, order, ambiguous, rows, bad, fresh, dup, from, to, add })
//   plus users (names in the file) and user ("" = everyone), or null.
// planAny(read, data, order, user) → the above, else core.importPlan.
// undoInfo(plan) → { entries, projects, clients } (ids it adds);
// undo(data, info, now) → data: each of those rows becomes a tombstone
//   stamped now (imported rows carry m = 1, so the tombstone wins on
//   every device, and a later import of the same file keeps it deleted,
//   the Wave 5 rule).
// UMD: window.OrosTimesheetImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }
  function core() { return NODE ? require("./core.js") : root.orosTimesheetCore; }

  var MAX_FILE = 10 * 1024 * 1024;
  var MAX_ROWS = 20000;
  var MAX_SHEETS = 10;
  var HOUR = 3600000, DAY = 86400000;
  var ACCEPT = ".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  var SRC_NAME = { kimai: "Kimai", tempo: "Jira Tempo" };
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function str(v) { return v == null ? "" : (v instanceof Date ? "" : String(v)); }
  function low(v) { return str(v).trim().toLowerCase(); }
  function hid(prefix, s) { var K = kit(); return prefix + K.hash(s) + K.hash("~" + s); }

  // ---------- reading ----------
  function readBytes(bytes, name, getXlsx) {
    var K = kit();
    if (!bytes || bytes.length > MAX_FILE) return Promise.resolve({ error: "big" });
    if (K.isZip(bytes)) {
      if (!getXlsx) return Promise.resolve({ error: "bad" });
      return getXlsx().then(function (X) {
        var wb;
        try { wb = X.read(bytes, { type: "array", cellDates: true }); } catch (e) { return { error: "bad" }; }
        var best = null;
        (wb.SheetNames || []).slice(0, MAX_SHEETS).forEach(function (sn) {
          var aoa = X.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "", blankrows: false }).slice(0, MAX_ROWS + 1);
          if (!best || (!detect(best[0] || []) && detect(aoa[0] || []))) best = aoa;
        });
        return best && best.length ? { rows: best } : { error: "bad" };
      }, function () { return { error: "lib" }; });
    }
    var txt;
    try { txt = K.text(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
    if (!K.clean(txt)) return Promise.resolve({ error: "bad" });
    var t = K.csv(txt, { maxRows: MAX_ROWS });
    return Promise.resolve({ rows: [t.head].concat(t.rows), text: txt });
  }
  // A sheet back to CSV for core.importPlan: dates as ISO days, times
  // as HH:MM:SS (what the Wave 5 reader understands).
  function cellText(v) {
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return "";
      if (v.getFullYear() < 1901) return pad(v.getHours()) + ":" + pad(v.getMinutes()) + ":" + pad(v.getSeconds());
      var d = v.getFullYear() + "-" + pad(v.getMonth() + 1) + "-" + pad(v.getDate());
      return v.getHours() || v.getMinutes() ? d + " " + pad(v.getHours()) + ":" + pad(v.getMinutes()) : d;
    }
    return v == null ? "" : String(v);
  }
  function toCsv(rows) {
    return (rows || []).map(function (r) {
      return (r || []).map(function (v) {
        var s = cellText(v);
        return /[\x22,\n\r]/.test(s) ? '"' + s.replace(/\x22/g, '""') + '"' : s;
      }).join(",");
    }).join("\r\n");
  }

  // ---------- detection ----------
  var SIGS = [
    { id: "tempo", need: [["Issue Key", "Issue key"], ["Work date", "Work Date", "Date Started"], ["Hours", "Time Spent (h)"]] },
    { id: "kimai", need: ["Date", ["From", "Begin"], ["To", "End"], "Duration", ["Activity", "Customer"]] }
  ];
  function detect(head) {
    head = (head || []).map(function (h) { return kit().clean(str(h), 200); });
    return kit().detect(head, SIGS);
  }

  // ---------- dates and times ----------
  // [y, m, d] or null. ord: "dmy" | "mdy" for a/b/yyyy days.
  var DMY_RE = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})\b/;
  function validYmd(y, m, d) {
    var x = new Date(y, m - 1, d);
    return y >= 2000 && y < 2100 && x.getMonth() === m - 1 && x.getDate() === d ? [y, m, d] : null;
  }
  function dayParts(v, ord) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : validYmd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === "number" && v > 30000 && v < 80000) {      // an Excel day serial
      var x = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * DAY);
      return validYmd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
    }
    var s = str(v).trim(), p;
    if ((p = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/.exec(s))) return validYmd(+p[1], +p[2], +p[3]);
    // Jira: 05/Mar/24, 5-Mar-2024
    if ((p = /^(\d{1,2})[\/\-\s]([a-z]{3})[a-z]*\.?[\/\-\s](\d{2}|\d{4})\b/i.exec(s)) && MON[p[2].toLowerCase()]) {
      return validYmd(+p[3] < 100 ? 2000 + +p[3] : +p[3], MON[p[2].toLowerCase()], +p[1]);
    }
    if ((p = DMY_RE.exec(s))) {
      var y = +p[3] < 100 ? 2000 + +p[3] : +p[3];
      return ord === "mdy" ? validYmd(y, +p[1], +p[2]) : validYmd(y, +p[2], +p[1]);
    }
    var iso = kit().ymd(s);
    return iso ? validYmd(+iso.slice(0, 4), +iso.slice(5, 7), +iso.slice(8, 10)) : null;
  }
  // [h, m, s] from "09:30", "9:30 PM", "2024-03-05 09:30", a Date or
  // a day fraction; null when there is no time of day.
  function timeParts(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : [v.getHours(), v.getMinutes(), v.getSeconds()];
    if (typeof v === "number" && v >= 0 && v < 1) {
      var sec = Math.round(v * 86400);
      return [Math.floor(sec / 3600) % 24, Math.floor(sec / 60) % 60, sec % 60];
    }
    var p = /(?:^|[\sT])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap]\.?m\.?)?/i.exec(" " + str(v).trim());
    if (!p) return null;
    var h = +p[1], mi = +p[2], se = p[3] ? +p[3] : 0;
    if (p[4]) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (/^p/i.test(p[4]) ? 12 : 0);
    }
    return h > 23 || mi > 59 || se > 59 ? null : [h, mi, se];
  }
  function localTs(d, tm) {
    if (!d || !tm) return NaN;
    var x = new Date(d[0], d[1] - 1, d[2], tm[0], tm[1], tm[2]);
    return x.getDate() === d[2] ? x.getTime() : NaN;
  }
  // hours from "1:30", "1:30:00", "1.5", "1,5", a number, a Date (time)
  function hoursOf(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? NaN : v.getHours() + v.getMinutes() / 60 + v.getSeconds() / 3600;
    if (typeof v === "number") return v;
    var s = str(v).trim(), p = /^(\d{1,4}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (p) return +p[1] + +p[2] / 60 + (p[3] ? +p[3] / 3600 : 0);
    return kit().num(s);
  }
  // "dmy" / "mdy" when the file decides it, else ""
  function orderOf(values) {
    var dmy = false, mdy = false;
    values.forEach(function (v) {
      var p = DMY_RE.exec(str(v).trim());
      if (!p) return;
      if (+p[1] > 12) dmy = true;
      if (+p[2] > 12) mdy = true;
    });
    return dmy && !mdy ? "dmy" : (mdy && !dmy ? "mdy" : "");
  }
  function yesNo(v) {
    v = low(v);
    if (/^(yes|true|1|y|ναι|ja|oui|sí|si)$/.test(v)) return 1;
    if (/^(no|false|0|n|όχι|οχι|nein|non)$/.test(v)) return 0;
    return -1;
  }

  // ---------- plan ----------
  function recs(rows) {
    var head = (rows[0] || []).map(function (h) { return kit().clean(str(h), 200); });
    var out = [];
    for (var i = 1; i < rows.length && out.length < MAX_ROWS; i++) {
      var r = rows[i] || [], o = {}, any = false;
      head.forEach(function (h, j) {
        if (!h) return;
        var v = r[j] == null ? "" : r[j];
        o[h] = v;
        if (v instanceof Date || str(v).trim()) any = true;
      });
      if (any) out.push(o);
    }
    return { head: head, rows: out };
  }
  function raw(rec, names) { var v = kit().get(rec, names); return v == null ? "" : v; }
  function txt(rec, names, max) { return kit().clean(str(raw(rec, names)), max); }

  // The fields of one row, the same for both sources.
  function rowOf(src, r) {
    if (src === "kimai") {
      var tags = str(raw(r, ["Tags"])).split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean);
      return {
        day: raw(r, ["Date"]), from: raw(r, ["From", "Begin"]), to: raw(r, ["To", "End"]),
        hours: hoursOf(raw(r, ["Duration"])),
        client: txt(r, ["Customer"], 80), project: txt(r, ["Project"], 80),
        task: txt(r, ["Activity"], 80), note: txt(r, ["Description"], 500),
        user: txt(r, ["User", "Username", "User name", "Name"], 80),
        rate: kit().num(raw(r, ["Hourly rate", "Hourly Rate"])), bill: yesNo(raw(r, ["Billable"])),
        billed: yesNo(raw(r, ["Exported"])) === 1 ? 1 : 0, tags: tags
      };
    }
    var key = txt(r, ["Issue Key", "Issue key"], 30), sum = txt(r, ["Issue summary", "Issue Summary"], 80);
    var bh = kit().num(raw(r, ["Billed Hours", "Billable Hours"]));
    return {
      day: raw(r, ["Work date", "Work Date", "Date Started"]), from: raw(r, ["Work date", "Work Date", "Date Started"]), to: "",
      hours: hoursOf(raw(r, ["Hours", "Time Spent (h)"])),
      client: txt(r, ["Account Customer", "Customer"], 80),
      project: txt(r, ["Project Name", "Project"], 80) || txt(r, ["Project Key"], 80),
      task: kit().clean([key, sum].filter(Boolean).join(" "), 80),
      note: txt(r, ["Work Description", "Work description", "Comment"], 500),
      user: txt(r, ["Full name", "Full Name", "Username", "User", "Author"], 80),
      rate: NaN, bill: isFinite(bh) ? (bh > 0 ? 1 : 0) : -1, billed: 0, tags: []
    };
  }

  function planRows(rows, data, order, user) {
    var C = core();
    if (!rows || rows.length < 2) return null;
    var src = detect(rows[0]);
    if (!src) return null;
    var t = recs(rows), list = t.rows.map(function (r) { return rowOf(src, r); });
    var users = [], seenU = {};
    list.forEach(function (x) { if (x.user && !seenU[x.user]) { seenU[x.user] = true; users.push(x.user); } });
    user = user && seenU[user] ? user : "";
    var dates = list.map(function (x) { return x.day; });
    var found = orderOf(dates), ambiguous = !found && dates.some(function (v) { return DMY_RE.test(str(v).trim()); });
    var ord = found || (order === "mdy" ? "mdy" : "dmy");

    var clientsByName = {}, projectsByKey = {};
    C.live(data.clients).forEach(function (c) { clientsByName[c.name.toLowerCase()] = c; });
    C.live(data.projects).forEach(function (p) {
      var c = C.client(data, p.client);
      projectsByKey[(c ? c.name.toLowerCase() : "") + "\u0001" + p.name.toLowerCase()] = p;
    });
    var have = {};
    data.entries.forEach(function (x) { have[x.id] = x; });
    var add = { entries: [], projects: [], clients: [] }, seen = {};
    var newClients = {}, newProjects = {}, color = C.live(data.projects).length;
    var bad = 0, dup = 0, fresh = 0, other = 0, from = "", to = "", cursor = {};

    function clientId(name) {
      if (!name) return "";
      var k = name.toLowerCase();
      if (clientsByName[k]) return clientsByName[k].id;
      if (!newClients[k]) {
        newClients[k] = { id: hid("impc", src + "|" + k), name: name, rate: 0, m: 1 };
        add.clients.push(newClients[k]);
      }
      return newClients[k].id;
    }
    function projectId(name, cname, bill, rate) {
      if (!name) return "";
      var k = (cname ? cname.toLowerCase() : "") + "\u0001" + name.toLowerCase();
      if (projectsByKey[k]) return projectsByKey[k].id;
      var p = newProjects[k];
      if (!p) {
        p = newProjects[k] = { id: hid("impp", src + "|" + k), name: name, client: clientId(cname),
                               color: color++ % C.COLORS.length, rate: 0, bill: 0, arch: 0, m: 1, _any: false };
        add.projects.push(p);
      }
      if (bill !== 0) p._any = true;
      if (!p.rate && rate > 0) p.rate = rate;
      return p.id;
    }

    list.forEach(function (x) {
      if (user && x.user !== user) { other++; return; }
      var d = dayParts(x.day, ord);
      if (!d) { bad++; return; }
      var dk = d[0] + "-" + pad(d[1]) + "-" + pad(d[2]);
      var t1 = timeParts(x.from), t2 = timeParts(x.to), s, e, laid = false;
      // Tempo: a bare day ("2024-03-05 00:00") has no start time
      if (src === "tempo" && t1 && !t1[0] && !t1[1] && !t1[2]) t1 = null;
      if (t1 && t2) {
        s = localTs(d, t1);
        e = localTs(d, t2);
        if (isFinite(s) && isFinite(e) && e <= s) e += DAY;         // past midnight
      } else if (x.hours > 0 && x.hours <= 24) {
        if (t1) s = localTs(d, t1);
        else {
          laid = true;
          s = localTs(d, [9, 0, 0]) + (cursor[dk] || 0);
        }
        e = s + Math.round(x.hours * HOUR);
        if (laid) cursor[dk] = (cursor[dk] || 0) + (e - s);
      }
      if (!isFinite(s) || !isFinite(e) || e <= s || e - s > C.MAX_SPAN) { bad++; return; }
      var rate = Math.round(x.rate * 100);
      var pid = projectId(x.project, x.client, x.bill, C.inRange(rate, C.LIM.rate) ? rate : 0);
      // The id comes from what the row says (a laid-out row: its day and
      // hours + how many such rows came before), so a longer export of
      // the same days finds the same entries.
      var key = [src, laid ? dk + "\u0001" + x.hours : s + "\u0001" + e, x.user.toLowerCase(), x.client.toLowerCase(),
                 x.project.toLowerCase(), x.task.toLowerCase(), x.note].join("\u0001");
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) {
        if (!laid) return;                                        // the same row twice in one file
        key += "\u0001" + seen[key];
      }
      var id = hid("imp", key);
      var k1 = C.dayKeyOf(s), k2 = C.dayKeyOf(e - 1);
      if (!from || k1 < from) from = k1;
      if (!to || k2 > to) to = k2;
      if (have[id]) { dup++; return; }
      fresh++;
      var en = { id: id, p: pid, desc: x.note, s: s, e: e, billed: x.billed, m: 1 };
      if (x.task) en.task = x.task;
      if (x.tags.length) en.tags = x.tags;
      add.entries.push(en);
    });
    var used = {};
    add.entries.forEach(function (x) { used[x.p] = true; });
    add.projects = add.projects.filter(function (p) { return used[p.id]; }).map(function (p) {
      return { id: p.id, name: p.name, client: p.client, color: p.color, rate: p.rate, bill: p._any ? 1 : 0, arch: 0, m: 1 };
    });
    var usedC = {};
    add.projects.forEach(function (p) { usedC[p.client] = true; });
    add.clients = add.clients.filter(function (c) { return usedC[c.id]; });
    return {
      source: src, order: ord, ambiguous: ambiguous, rows: list.length, bad: bad, other: other,
      fresh: fresh, dup: dup, from: from, to: to, users: users, user: user,
      add: { ver: 1, clients: add.clients, projects: add.projects, entries: add.entries, prefs: data.prefs, pm: 0 }
    };
  }

  // A read file → the plan of whichever importer knows it, or null.
  function planAny(read, data, order, user) {
    if (!read || !read.rows) return null;
    var p = planRows(read.rows, data, order, user);
    if (p) return p;
    var text = typeof read.text === "string" ? read.text : toCsv(read.rows);
    return core().importPlan(text, data, order);
  }

  function undoInfo(plan) {
    function ids(l) { return (l || []).map(function (x) { return x.id; }); }
    return { entries: ids(plan.add.entries), projects: ids(plan.add.projects), clients: ids(plan.add.clients) };
  }
  // Each row the import added → a tombstone stamped now (the merge's
  // "newer m wins" carries it to every device). A project / client
  // that something else uses meanwhile is kept.
  function undo(data, info, now) {
    var C = core();
    now = Math.max(now || Date.now(), 2);
    var gone = {}, inUse = {};
    info.entries.forEach(function (id) { gone[id] = true; });
    var tombs = { ver: 1, clients: [], projects: [], entries: [], prefs: data.prefs, pm: 0 };
    data.entries.forEach(function (x) {
      if (gone[x.id] && !x.del) tombs.entries.push({ id: x.id, m: Math.max(now, x.m + 1), del: 1 });
      else if (!x.del) inUse[x.p] = true;
    });
    data.projects.forEach(function (p) {
      if (info.projects.indexOf(p.id) >= 0 && !p.del && !inUse[p.id]) tombs.projects.push({ id: p.id, m: Math.max(now, p.m + 1), del: 1 });
      else if (!p.del) inUse[p.client] = true;
    });
    data.clients.forEach(function (c) {
      if (info.clients.indexOf(c.id) >= 0 && !c.del && !inUse[c.id]) tombs.clients.push({ id: c.id, m: Math.max(now, c.m + 1), del: 1 });
    });
    return C.mergeTimesheet(data, tombs);
  }

  var API = {
    ACCEPT: ACCEPT, MAX_FILE: MAX_FILE, SRC_NAME: SRC_NAME,
    readBytes: readBytes, toCsv: toCsv, detect: detect,
    dayParts: dayParts, timeParts: timeParts, hoursOf: hoursOf,
    planRows: planRows, planAny: planAny, undoInfo: undoInfo, undo: undo
  };
  if (NODE) module.exports = API;
  else root.OrosTimesheetImport = API;
})(typeof self !== "undefined" ? self : this);
