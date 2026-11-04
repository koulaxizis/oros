// ============================================================
// orOS Connected services — links/timesheet.js (pure, v1.0.0)
// Time trackers into Timesheet (Timesheet T5): Toggl Track, Clockify,
// Harvest and Kimai, read-only, each with the person's own token
// (links/core.js PLATFORMS and the allowlist; the shell's orosLinks
// makes the calls, this file never sees a key).
//
// The answers become the same table the tracker's own export has
// (Toggl / Clockify / Harvest CSV, Kimai's export rows), so the
// import goes through Timesheet's file import unchanged: the same
// entry ids as importing that export by hand, so an account read and
// a CSV of the same time never count twice, and the Wave 5 rules hold
// (adds only, deleted stays deleted, Undo).
//
//   PLATFORMS                        the four platform ids
//   first(p, from, to)               → the first requests ([] when none)
//   next(p, from, to, got, answers)  → { reqs } (more to ask) | { done: true }
//       got: what was read so far (the module's own state object)
//   table(p, got)                    → { csv } (Toggl, Clockify, Harvest) | { rows } (Kimai)
//   count(got)                       → entries read
// from / to: "YYYY-MM-DD" days, local; at most MAX_DAYS apart.
// UMD: window.OrosLinksTimesheet in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var PLATFORMS = ["toggl", "clockify", "harvest", "kimai"];
  var MAX_DAYS = 366, MAX_ENTRIES = 20000, MAX_PAGES = 40;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function str(v) { return v == null ? "" : String(v); }
  function clean(v, max) { return str(v).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
  function addDays(key, n) {
    var p = key.split("-"), d = new Date(+p[0], +p[1] - 1, +p[2] + n);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function localStart(key) { var p = key.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function isoZ(d) {
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + "T" +
           pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) + "Z";
  }
  function okRange(from, to) {
    if (!DAY_RE.test(from || "") || !DAY_RE.test(to || "") || from > to) return false;
    return (localStart(to) - localStart(from)) / 86400000 <= MAX_DAYS;
  }
  // Local day and time of an ISO timestamp: ["2026-10-05", "09:30:00"] or null.
  function local(iso) {
    var d = new Date(str(iso));
    if (!isFinite(d.getTime())) return null;
    return [d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()),
            pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())];
  }
  function cell(v) {
    var s = str(v);
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(rows) { return rows.map(function (r) { return r.map(cell).join(";"); }).join("\r\n") + "\r\n"; }
  function yes(v) { return v ? "Yes" : "No"; }

  // ---------- requests ----------
  function first(p, from, to) {
    if (PLATFORMS.indexOf(p) < 0 || !okRange(from, to)) return [];
    if (p === "toggl") {
      // end_date is exclusive
      return [{ m: "GET", path: "/me/projects" }, { m: "GET", path: "/me/clients" },
              { m: "GET", path: "/me/time_entries?start_date=" + from + "&end_date=" + addDays(to, 1) }];
    }
    if (p === "clockify") return [{ m: "GET", path: "/user" }];
    if (p === "harvest") return [harvestReq(from, to, 1)];
    return [kimaiReq(from, to, 1)];
  }
  function harvestReq(from, to, page) {
    return { m: "GET", path: "/time_entries?from=" + from + "&to=" + to + "&page=" + page + "&per_page=2000" };
  }
  function kimaiReq(from, to, page) {
    return { m: "GET", path: "/timesheets?begin=" + from + "T00:00:00&end=" + to + "T23:59:59&size=500&page=" + page + "&full=true" };
  }
  function clockifyReq(got, from, to, page) {
    return { m: "GET", path: "/workspaces/" + got.ws + "/user/" + got.uid + "/time-entries?start=" + isoZ(localStart(from)) +
             "&end=" + isoZ(localStart(addDays(to, 1))) + "&page=" + page + "&page-size=1000&hydrated=true" };
  }
  function arr(v) { return Array.isArray(v) ? v : []; }
  // answers: the data of the last requests, in order.
  function next(p, from, to, got, answers) {
    got.items = got.items || [];
    got.pages = (got.pages || 0) + 1;
    var full = function () { return got.items.length >= MAX_ENTRIES || got.pages >= MAX_PAGES; };
    if (p === "toggl") {
      got.projects = arr(answers[0]);
      got.clients = arr(answers[1]);
      got.items = arr(answers[2]).slice(0, MAX_ENTRIES);
      return { done: true };
    }
    if (p === "clockify") {
      if (!got.uid) {
        var u = answers[0] || {};
        var ws = /^[0-9a-f]{24}$/.test(str(u.activeWorkspace)) ? u.activeWorkspace : u.defaultWorkspace;
        if (!/^[0-9a-f]{24}$/.test(str(u.id)) || !/^[0-9a-f]{24}$/.test(str(ws))) return { done: true, bad: true };
        got.uid = u.id;
        got.ws = ws;
        got.page = 1;
        return { reqs: [clockifyReq(got, from, to, 1)] };
      }
      var list = arr(answers[0]);
      got.items = got.items.concat(list);
      if (list.length < 1000 || full()) return { done: true };
      got.page++;
      return { reqs: [clockifyReq(got, from, to, got.page)] };
    }
    if (p === "harvest") {
      var a = answers[0] || {};
      got.items = got.items.concat(arr(a.time_entries));
      if (!a.next_page || full()) return { done: true };
      return { reqs: [harvestReq(from, to, +a.next_page)] };
    }
    var k = arr(answers[0]);
    got.items = got.items.concat(k);
    got.page = (got.page || 1) + 1;
    if (k.length < 500 || full()) return { done: true };
    return { reqs: [kimaiReq(from, to, got.page)] };
  }
  function count(got) { return got && got.items ? got.items.length : 0; }

  // ---------- the tracker's own export ----------
  function togglTable(got) {
    var pj = {}, cl = {};
    arr(got.clients).forEach(function (c) { if (c && c.id != null) cl[c.id] = clean(c.name, 80); });
    arr(got.projects).forEach(function (x) { if (x && x.id != null) pj[x.id] = { name: clean(x.name, 80), client: cl[x.client_id] || "" }; });
    var rows = [["Client", "Project", "Description", "Billable", "Start date", "Start time", "End date", "End time", "Tags"]];
    got.items.forEach(function (e) {
      if (!e || !e.stop || (e.duration != null && e.duration < 0)) return;      // still running
      var s = local(e.start), x = local(e.stop);
      if (!s || !x) return;
      var p = pj[e.project_id] || { name: "", client: "" };
      rows.push([p.client, p.name, clean(e.description, 500), yes(e.billable), s[0], s[1], x[0], x[1],
                 arr(e.tags).map(function (t) { return clean(t, 30); }).join(", ")]);
    });
    return { csv: csv(rows) };
  }
  function clockifyTable(got) {
    var rows = [["Project", "Client", "Description", "Task", "Tags", "Billable", "Start Date", "Start Time", "End Date", "End Time", "Duration (decimal)"]];
    got.items.forEach(function (e) {
      var ti = e && e.timeInterval;
      if (!ti || !ti.end) return;
      var s = local(ti.start), x = local(ti.end);
      if (!s || !x) return;
      var pr = e.project || {};
      var h = (new Date(ti.end) - new Date(ti.start)) / 3600000;
      rows.push([clean(pr.name, 80), clean(pr.clientName, 80), clean(e.description, 500), clean(e.task && e.task.name, 80),
                 arr(e.tags).map(function (t) { return clean(t && t.name, 30); }).join(", "), yes(e.billable),
                 s[0], s[1], x[0], x[1], h.toFixed(2)]);
    });
    return { csv: csv(rows) };
  }
  function harvestTable(got) {
    var rows = [["Date", "Client", "Project", "Task", "Notes", "Hours", "Billable?", "Invoiced?", "Billable Rate"]];
    got.items.forEach(function (e) {
      if (!e || e.is_running || !DAY_RE.test(str(e.spent_date)) || !(e.hours > 0)) return;
      rows.push([e.spent_date, clean(e.client && e.client.name, 80), clean(e.project && e.project.name, 80),
                 clean(e.task && e.task.name, 80), clean(e.notes, 500), String(e.hours), yes(e.billable), yes(e.is_billed),
                 e.billable_rate > 0 ? String(e.billable_rate) : ""]);
    });
    return { csv: csv(rows) };
  }
  function kimaiTable(got) {
    var rows = [["Date", "From", "To", "Duration", "Customer", "Project", "Activity", "Description", "Billable", "Exported", "Tags", "Hourly rate"]];
    got.items.forEach(function (e) {
      if (!e || !e.end) return;
      var s = local(e.begin), x = local(e.end);
      if (!s || !x) return;
      var pr = e.project && typeof e.project === "object" ? e.project : {};
      var cu = pr.customer && typeof pr.customer === "object" ? pr.customer : {};
      var ac = e.activity && typeof e.activity === "object" ? e.activity : {};
      var secs = Math.max(0, Math.round((new Date(e.end) - new Date(e.begin)) / 1000));
      rows.push([s[0], s[1].slice(0, 5), x[1].slice(0, 5), Math.floor(secs / 3600) + ":" + pad(Math.floor(secs / 60) % 60),
                 clean(cu.name, 80), clean(pr.name, 80), clean(ac.name, 80), clean(e.description, 500),
                 e.billable === false ? "No" : "Yes", e.exported ? "Yes" : "No",
                 arr(e.tags).map(function (t) { return clean(t, 30); }).join(", "), e.hourlyRate > 0 ? String(e.hourlyRate) : ""]);
    });
    return { rows: rows };
  }
  function table(p, got) {
    got = got || { items: [] };
    got.items = arr(got.items);
    if (p === "toggl") return togglTable(got);
    if (p === "clockify") return clockifyTable(got);
    if (p === "harvest") return harvestTable(got);
    return kimaiTable(got);
  }

  var api = { PLATFORMS: PLATFORMS, MAX_DAYS: MAX_DAYS, first: first, next: next, table: table, count: count, okRange: okRange };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksTimesheet = api;
})(typeof window !== "undefined" ? window : this);
