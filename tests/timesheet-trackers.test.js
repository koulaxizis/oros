// Timesheet T5: Toggl Track, Clockify, Harvest and Kimai accounts
// (links/core.js platforms, the allowlist in the app and the relay,
// links/timesheet.js turning the answers into the tracker's own
// export), ActivityWatch exports as suggested entries, and the
// report as an .ics calendar.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const M = require("../links/timesheet.js");
const C = require("../timesheet/core.js");
const I = require("../timesheet/import.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

// made up at run time (a literal looks like a real key to secret scanners)
const TOGGL = ["0123456789", "abcdef0123", "456789abcd", "ef"].join("");
const CLOCKIFY = ["NzQ1ZjM4", "YWUtMjM0", "Ni00MzE2", "LWE5ZDQt"].join("");
const HARVEST = "1234567.pt." + ["AbCdEfGhIj", "KlMnOpQrSt", "UvWxYz0123", "456789"].join("");
const KIMAI = ["kimaitoken", "0123456789"].join("");
const WS = "0123456789abcdef01234567", UID = "abcdef0123456789abcdef01";

const empty = () => C.normalize({ ver: 1, clients: [], projects: [], entries: [], extras: [] });

test("accounts: fixed hosts, own tokens, Timesheet; Kimai at the person's own address", () => {
  for (const p of ["toggl", "clockify", "harvest", "kimai"]) assert.deepEqual(L.PLATFORMS[p].apps, ["timesheet"]);
  assert.equal(L.checkKeys("toggl", { key: TOGGL }).ok, true);
  assert.equal(L.checkKeys("toggl", { key: TOGGL + "0" }).ok, false);
  assert.equal(L.checkKeys("clockify", { key: CLOCKIFY }).ok, true);
  assert.equal(L.checkKeys("harvest", { key: HARVEST, token: "123456" }).ok, true);
  assert.equal(L.checkKeys("harvest", { key: HARVEST, token: "acme" }).ok, false);
  assert.equal(L.checkKeys("kimai", { key: KIMAI }).ok, true);
  assert.deepEqual(L.authHeader("toggl", { key: TOGGL }), ["Authorization", "Basic " + btoa(TOGGL + ":api_token")]);
  assert.deepEqual(L.authHeader("clockify", { key: CLOCKIFY }), ["X-Api-Key", CLOCKIFY]);
  assert.deepEqual(L.authHeader("harvest", { key: HARVEST, token: "123456" }), ["Authorization", "Bearer " + HARVEST]);
  assert.deepEqual(L.extraHeaders("harvest", {}, { key: HARVEST, token: "123456" }), { "Harvest-Account-Id": "123456" });
  assert.equal(L.apiUrl("kimai", { site: "https://time.example.com" }, "/version"), "https://time.example.com/api/version");
  assert.equal(L.apiUrl("toggl", {}, "/me"), "https://api.track.toggl.com/api/v9/me");
});

const CASES = [
  ["toggl", { m: "GET", path: "/me" }, ""],
  ["toggl", { m: "GET", path: "/me/projects" }, ""],
  ["toggl", { m: "GET", path: "/me/time_entries?start_date=2026-10-01&end_date=2026-11-01" }, ""],
  ["toggl", { m: "GET", path: "/me/time_entries?start_date=2026-10-01&meta=true" }, "query"],
  ["toggl", { m: "POST", path: "/workspaces/1/time_entries", body: {} }, "path"],
  ["clockify", { m: "GET", path: "/user" }, ""],
  ["clockify", { m: "GET", path: "/workspaces/" + WS + "/user/" + UID + "/time-entries?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z&page=1&page-size=1000&hydrated=true" }, ""],
  ["clockify", { m: "GET", path: "/workspaces/" + WS + "/user/" + UID + "/time-entries?page-size=5000" }, "query"],
  ["clockify", { m: "GET", path: "/workspaces/" + WS + "/time-entries" }, "path"],
  ["clockify", { m: "PUT", path: "/workspaces/" + WS + "/user/" + UID + "/time-entries", body: {} }, "path"],
  ["harvest", { m: "GET", path: "/users/me" }, ""],
  ["harvest", { m: "GET", path: "/time_entries?from=2026-10-01&to=2026-10-31&page=2&per_page=2000" }, ""],
  ["harvest", { m: "GET", path: "/time_entries?per_page=2001" }, "query"],
  ["harvest", { m: "GET", path: "/invoices" }, "path"],
  ["kimai", { m: "GET", path: "/version" }, ""],
  ["kimai", { m: "GET", path: "/timesheets?begin=2026-10-01T00:00:00&end=2026-10-31T23:59:59&size=500&page=1&full=true" }, ""],
  ["kimai", { m: "GET", path: "/timesheets?user=all" }, "query"],
  ["kimai", { m: "PATCH", path: "/timesheets/1" }, "method"],
  ["kimai", { m: "POST", path: "/timesheets", body: { project: 1 } }, "path"]
];
test("allowlist: read-only, one case list, app and relay agree", () => {
  for (const [p, r, want] of CASES) {
    assert.equal(L.checkReq(p, r), want, "app " + p + " " + r.m + " " + r.path);
    assert.equal(X.checkExtReq(p, r), want, "relay " + p + " " + r.m + " " + r.path);
  }
});

test("relay: Harvest's own host with the account header, no key echoed; Kimai at a checked host", async () => {
  assert.equal(X.validExt({ op: "ext", p: "harvest", key: HARVEST, token: "123456", reqs: [L.probeReq("harvest")] }), "");
  assert.equal(X.validExt({ op: "ext", p: "harvest", key: HARVEST, token: "123456", host: "evil.example.com", reqs: [L.probeReq("harvest")] }), "host");
  assert.equal(X.validExt({ op: "ext", p: "kimai", host: "localhost", base: "", key: KIMAI, reqs: [L.probeReq("kimai")] }), "host");
  assert.equal(X.validExt({ op: "ext", p: "kimai", host: "time.example.com", base: "", key: KIMAI, reqs: [L.probeReq("kimai")] }), "");
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response('{"time_entries":[],"next_page":null}', { status: 200 }); };
  const ORIGIN = "https://useoros.online";
  const req = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.6.0.12" },
    body: JSON.stringify({ op: "ext", p: "harvest", key: HARVEST, token: "123456", reqs: M.first("harvest", "2026-10-01", "2026-10-31") }) });
  const res = await handle(req, { ALLOWED_ORIGINS: ORIGIN }, null, Date.now(), f);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(calls[0].url, "https://api.harvestapp.com/v2/time_entries?from=2026-10-01&to=2026-10-31&page=1&per_page=2000");
  assert.equal(calls[0].init.headers.Authorization, "Bearer " + HARVEST);
  assert.equal(calls[0].init.headers["Harvest-Account-Id"], "123456");
  assert.equal(JSON.stringify(json).indexOf(HARVEST), -1);
});

test("every request the reader makes passes the allowlist", () => {
  const all = [];
  for (const p of M.PLATFORMS) all.push(...M.first(p, "2026-01-01", "2026-10-31").map((r) => [p, r]));
  const got = {};
  all.push(["clockify", M.next("clockify", "2026-01-01", "2026-10-31", got, [{ id: UID, activeWorkspace: WS }]).reqs[0]]);
  all.push(["harvest", M.next("harvest", "2026-01-01", "2026-10-31", {}, [{ time_entries: [], next_page: 3 }]).reqs[0]]);
  all.push(["kimai", M.next("kimai", "2026-01-01", "2026-10-31", {}, [new Array(500).fill({})]).reqs[0]]);
  for (const [p, r] of all) assert.equal(L.checkReq(p, r), "", p + " " + r.path);
  assert.deepEqual(M.first("toggl", "2026-10-31", "2026-10-01"), [], "From after To");
  assert.deepEqual(M.first("toggl", "2024-01-01", "2026-10-01"), [], "more than a year");
});

test("answers become the tracker's own export: same ids as importing that file", () => {
  const got = {};
  M.next("toggl", "2026-10-01", "2026-10-31", got, [[{ id: 1, name: "Site", client_id: 9 }], [{ id: 9, name: "Acme" }],
    [{ id: 5, project_id: 1, description: "Pages", start: "2026-10-05T07:00:00Z", stop: "2026-10-05T09:30:00Z", duration: 9000, billable: true, tags: ["web"] },
     { id: 6, start: "2026-10-06T07:00:00Z", stop: null, duration: -1 }]]);
  const tb = M.table("toggl", got);
  const plan = C.importPlan(tb.csv, empty(), "dmy");
  assert.equal(plan.source, "toggl");
  assert.equal(plan.fresh, 1, "a running entry is left out");
  assert.deepEqual(plan.add.projects.map((p) => p.name), ["Site"]);
  assert.deepEqual(plan.add.clients.map((c) => c.name), ["Acme"]);
  assert.equal(plan.add.entries[0].e - plan.add.entries[0].s, 150 * 60000);
  // the same entry from Toggl's own CSV export has the same id
  const d = new Date("2026-10-05T07:00:00Z"), e = new Date("2026-10-05T09:30:00Z");
  const p2 = (n) => String(n).padStart(2, "0");
  const day = (x) => x.getFullYear() + "-" + p2(x.getMonth() + 1) + "-" + p2(x.getDate());
  const tm = (x) => p2(x.getHours()) + ":" + p2(x.getMinutes()) + ":" + p2(x.getSeconds());
  const file = "Client,Project,Description,Billable,Start date,Start time,End date,End time,Tags\n" +
    ["Acme", "Site", "Pages", "Yes", day(d), tm(d), day(e), tm(e), "web"].join(",") + "\n";
  assert.equal(C.importPlan(file, empty(), "dmy").add.entries[0].id, plan.add.entries[0].id);

  const h = {};
  M.next("harvest", "2026-10-01", "2026-10-31", h, [{ time_entries: [{ spent_date: "2026-10-08", hours: 1.5, notes: "Call", client: { name: "Acme" },
    project: { name: "Site" }, task: { name: "PM" }, billable: true, is_billed: true, billable_rate: 50 }], next_page: null }]);
  const hp = C.importPlan(M.table("harvest", h).csv, empty(), "dmy");
  assert.equal(hp.source, "harvest");
  assert.deepEqual(hp.add.entries.map((x) => [x.desc, x.task, x.billed, (x.e - x.s) / 60000]), [["Call", "PM", 1, 90]]);
  assert.equal(hp.add.projects[0].rate, 5000);

  const k = {};
  M.next("kimai", "2026-10-01", "2026-10-31", k, [[{ begin: "2026-10-09T09:00:00+0300", end: "2026-10-09T11:15:00+0300", description: "Fix",
    tags: ["a"], exported: true, project: { name: "Site", customer: { name: "Acme" } }, activity: { name: "Dev" } }]]);
  const kp = I.planRows(M.table("kimai", k).rows, empty(), "dmy", "");
  assert.equal(kp.source, "kimai");
  assert.deepEqual(kp.add.entries.map((x) => [x.desc, x.task, x.billed, (x.e - x.s) / 60000]), [["Fix", "Dev", 1, 135]]);
});

test("ActivityWatch: time at the computer → suggested entries named after the main window", () => {
  const T = (h, m) => new Date(2026, 9, 5, h, m).toISOString();
  const aw = { buckets: {
    "aw-watcher-afk_pc": { type: "afkstatus", events: [
      { timestamp: T(9, 0), duration: 1800, data: { status: "not-afk" } },
      { timestamp: T(9, 32), duration: 3600, data: { status: "not-afk" } },     // a 2-minute break: joined
      { timestamp: T(11, 0), duration: 300, data: { status: "not-afk" } },      // 5 minutes: too short
      { timestamp: T(10, 32), duration: 600, data: { status: "afk" } }] },
    "aw-watcher-window_pc": { type: "currentwindow", events: [
      { timestamp: T(9, 0), duration: 3000, data: { app: "Code", title: "site.js" } },
      { timestamp: T(9, 50), duration: 1200, data: { app: "Firefox", title: "Docs" } }] } } };
  const plan = C.awPlan(aw, empty());
  assert.equal(plan.source, "activitywatch");
  assert.deepEqual(plan.add.entries.map((x) => [x.desc, x.p, (x.e - x.s) / 60000]), [["Code · site.js", "", 92]]);
  assert.equal(C.awPlan(aw, C.mergeTimesheet(empty(), plan.add)).dup, 1, "the same export twice adds nothing");
  assert.equal(C.awPlan({ nope: 1 }, empty()), null);
  assert.match(I.ACCEPT, /\.json/);
});

test(".ics: ended entries of the report, UTC times, the entry id as UID, text escaped and folded", () => {
  const at = (d, h) => new Date(2026, 9, d, h).getTime();
  const d = C.normalize({ ver: 1, clients: [{ id: "cccccc1", name: "Acme, Inc", rate: 0, m: 1 }],
    projects: [{ id: "pppppp1", name: "Site", client: "cccccc1", m: 1 }],
    entries: [{ id: "eeeeee1", p: "pppppp1", desc: "Pages; header", s: at(5, 9), e: at(5, 11), billed: 0, m: 1, task: "x".repeat(120) },
              { id: "eeeeee2", p: "", desc: "running", s: at(5, 12), e: 0, billed: 0, m: 1 },
              { id: "eeeeee3", p: "", desc: "", s: at(20, 9), e: at(20, 10), billed: 0, m: 1 }], extras: [] });
  const ics = C.toIcs(d, "2026-10-01", "2026-10-10", {}, Date.UTC(2026, 10, 1), "en");
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1, "running and out-of-range entries left out");
  assert.match(ics, /UID:eeeeee1@timesheet\.useoros\.online/);
  assert.match(ics, new RegExp("DTSTART:" + new Date(at(5, 9)).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"));
  assert.match(ics, /SUMMARY:Site · Pages\\; header/);
  assert.match(ics, /DESCRIPTION:Acme\\, Inc\\nx+\r\n x+/);
  ics.split("\r\n").forEach((l) => assert.ok(Buffer.byteLength(l) <= 75, l));
});
