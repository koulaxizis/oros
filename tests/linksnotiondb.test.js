// Connected services wave 6E: Notion databases (shared with the user's
// own integration) → Spreadsheet. The allowlist (app and relay copies:
// a search that lists databases, a database's rows with no filter or
// sort), the relay call, links/sheets.js reading databases and rows,
// the cell values (never a formula) and the plan.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const S = require("../links/sheets.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

// made up at run time (a literal looks like a real key to secret scanners)
const KEY = ["ntn", "A1b2C3d4E5f6".repeat(4)].join("_");
const D1 = "11111111-2222-4333-8444-555555555555", D2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CUR = "99999999-8888-4777-8666-555555555555";

const CASES = [
  ["notion", S.searchReq(""), ""],
  ["notion", S.searchReq(CUR), ""],
  ["notion", S.queryReq(D1, ""), ""],
  ["notion", S.queryReq(D1.replace(/-/g, ""), CUR), ""],
  ["notion", { m: "POST", path: "/search", body: { filter: { property: "object", value: "database" }, page_size: 100, query: "x" } }, "body"],
  ["notion", { m: "POST", path: "/search", body: { filter: { property: "object", value: ["page", "database"] }, page_size: 100 } }, "body"],
  ["notion", { m: "POST", path: "/databases/" + D1 + "/query", body: { page_size: 100, filter: { property: "Done", checkbox: { equals: true } } } }, "body"],
  ["notion", { m: "POST", path: "/databases/" + D1 + "/query", body: { page_size: 100, sorts: [] } }, "body"],
  ["notion", { m: "POST", path: "/databases/" + D1 + "/query", body: { page_size: 101 } }, "body"],
  ["notion", { m: "POST", path: "/databases/" + D1 + "/query", body: { start_cursor: "abc" } }, "body"],
  ["notion", { m: "POST", path: "/databases/" + D1 + "/query" }, "body"],
  ["notion", { m: "POST", path: "/databases/../query", body: { page_size: 10 } }, "path"],
  ["notion", { m: "GET", path: "/databases/" + D1 }, "path"],
  ["notion", { m: "POST", path: "/databases", body: { parent: {} } }, "path"],
  ["notion", { m: "PUT", path: "/databases/" + D1, body: { title: [] } }, "path"],
  ["notion", { m: "POST", path: "/pages", body: { parent: { database_id: D1 } } }, "path"]
];
test("allowlist: databases listed and read, nothing filtered, sorted or written; app and relay agree", () => {
  for (const [p, r, want] of CASES) {
    assert.equal(L.checkReq(p, r), want, "app " + r.m + " " + r.path + " " + JSON.stringify(r.body || ""));
    assert.equal(X.checkExtReq(p, r), want, "relay " + r.m + " " + r.path + " " + JSON.stringify(r.body || ""));
  }
  assert.equal(S.queryReq("../users", ""), null);
  assert.deepEqual(S.queryReq(D1, "nope").body, { page_size: 100, start_cursor: "" });
  assert.equal(L.checkReq("notion", S.queryReq(D1, "nope")), "body");                 // a bad cursor never goes out
});

test("relay: the query body as is, Notion-Version; no key echoed", async () => {
  const wire = (r) => ({ m: r.m, path: r.path, body: JSON.stringify(r.body) });
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response('{"object":"list","results":[],"has_more":false}', { status: 200 }); };
  const ORIGIN = "https://useoros.online";
  const res = await handle(new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.6.0.15" },
    body: JSON.stringify({ op: "ext", p: "notion", key: KEY, reqs: [wire(S.searchReq("")), wire(S.queryReq(D1, CUR))] }) }),
    { ALLOWED_ORIGINS: ORIGIN }, null, Date.now(), f);
  const json = await res.json();
  assert.equal(json.ok, true);
  const s = calls.find((c) => /search$/.test(c.url)), q = calls.find((c) => /query$/.test(c.url));
  assert.deepEqual(JSON.parse(s.init.body), { filter: { property: "object", value: "database" }, page_size: 100 });
  assert.equal(q.url, "https://api.notion.com/v1/databases/" + D1 + "/query");
  assert.equal(q.init.method, "POST");
  assert.deepEqual(JSON.parse(q.init.body), { page_size: 100, start_cursor: CUR });
  assert.equal(q.init.headers["Notion-Version"], "2022-06-28");
  assert.equal(JSON.stringify(json).indexOf(KEY), -1);
});

test("search: databases with their columns, the title column first; trash and odd ids out", () => {
  const r = S.readSearch({ has_more: true, next_cursor: CUR, results: [
    { object: "database", id: D1, title: [{ plain_text: "Πελάτες" }, { plain_text: " 2026" }],
      properties: { Status: { id: "a", name: "Status", type: "status" }, Name: { id: "title", name: "Name", type: "title" }, Ποσό: { id: "b", name: "Ποσό", type: "number" } } },
    { object: "database", id: D2.replace(/-/g, ""), title: [], properties: { Title: { name: "Title", type: "title" } } },
    { object: "database", id: CUR, in_trash: true, properties: {} },
    { object: "page", id: CUR },
    { object: "database", id: "nope", properties: {} }
  ] });
  assert.deepEqual(r.dbs.map((d) => [d.xid, d.title, d.cols.map((c) => c.name + ":" + c.type)]), [
    [D1, "Πελάτες 2026", ["Name:title", "Status:status", "Ποσό:number"]],
    [D2, "", ["Title:title"]]]);
  assert.equal(r.next, CUR);
});

test("rows → cells: every common property type as plain text; never a formula", () => {
  const cols = [
    { name: "Name", key: "Name", type: "title" }, { name: "Ποσό", key: "Ποσό", type: "number" },
    { name: "Tags", key: "Tags", type: "multi_select" }, { name: "When", key: "When", type: "date" },
    { name: "Done", key: "Done", type: "checkbox" }, { name: "Status", key: "Status", type: "status" },
    { name: "Formula", key: "Formula", type: "formula" }, { name: "Links", key: "Links", type: "relation" },
    { name: "ID", key: "ID", type: "unique_id" }, { name: "Missing", key: "Missing", type: "url" }
  ];
  const r = S.readRows({ has_more: false, results: [
    { object: "page", id: D1, properties: {
      Name: { type: "title", title: [{ plain_text: "=HYPERLINK(\"http://x\")" }] },
      Ποσό: { type: "number", number: 12.5 },
      Tags: { type: "multi_select", multi_select: [{ name: "α" }, { name: "β" }] },
      When: { type: "date", date: { start: "2026-10-13T09:30:00.000+03:00", end: "2026-10-14" } },
      Done: { type: "checkbox", checkbox: true },
      Status: { type: "status", status: { name: "In progress" } },
      Formula: { type: "formula", formula: { type: "number", number: -3 } },
      Links: { type: "relation", relation: [{ id: D2 }, { id: CUR }] },
      ID: { type: "unique_id", unique_id: { prefix: "TSK", number: 7 } } } },
    { object: "page", id: D2, archived: true, properties: {} },
    { object: "page", id: CUR, properties: { Name: { type: "title", title: [{ plain_text: "line\none" }] }, Done: { type: "checkbox", checkbox: false } } }
  ] }, cols);
  assert.equal(r.rows.length, 2);
  const t = S.table({ cols, rows: r.rows });
  assert.deepEqual(t[0], ["Name", "Ποσό", "Tags", "When", "Done", "Status", "Formula", "Links", "ID", "Missing"]);
  assert.deepEqual(t[1], ["'=HYPERLINK(\"http://x\")", "12.5", "α, β", "2026-10-13 09:30 → 2026-10-14", "TRUE", "In progress", "-3", "2", "TSK-7"]);
  assert.deepEqual(t[2], ["line one", "", "", "", "FALSE"]);
  assert.equal(S.cell("+1 555"), "'+1 555");
  assert.equal(S.cell("@me"), "'@me");
});

const ctx = (o) => Object.assign({ p: "notion", acct: "acct000001", untitled: "Untitled", upd: false, revive: false }, o || {});
const got = () => ({ dbs: [
  { xid: D1, title: "Πελάτες: 2026/Q4 [old]", cols: [{ name: "Name", key: "Name" }], rows: [["Άννα"], ["Βασίλης"]] },
  { xid: D2, title: "", cols: [{ name: "Name", key: "Name" }], rows: [] }
] });
test("plan: one sheet per database, safe names, ids stable; again: unchanged, replaced only when asked; deleted stays out", () => {
  const id = (x) => L.extId("notion", "acct000001", "sheet", x);
  const pl = S.plan({ sheets: {}, deleted: {} }, got(), ctx());
  assert.deepEqual(pl.add.map((a) => [a.id, a.name, a.rows]), [
    [id(D1), "Πελάτες 2026 Q4 old", [["Name"], ["Άννα"], ["Βασίλης"]]], [id(D2), "Untitled", [["Name"]]]]);
  assert.ok(/^[\w-]+$/.test(pl.add[0].id));                                          // a valid Spreadsheet sheet id
  assert.deepEqual(S.count(pl), { add: 2, upd: 0 });
  const st = { sheets: { [id(D1)]: [["Name", ""], ["Άννα"], ["Βασίλης"], []] }, deleted: { [id(D2)]: 5 } };
  let p2 = S.plan(st, got(), ctx());
  assert.deepEqual([p2.add.length, p2.upd.length, p2.same, p2.gone], [0, 0, 1, 1]);
  const g = got();
  g.dbs[0].rows.push(["Γιώργος"]);
  assert.deepEqual(S.plan(st, g, ctx()).upd, []);
  p2 = S.plan(st, g, ctx({ upd: true, revive: true }));
  assert.deepEqual(p2.upd, [{ id: id(D1), rows: [["Name"], ["Άννα"], ["Βασίλης"], ["Γιώργος"]] }]);
  assert.deepEqual(p2.add.map((a) => a.id), [id(D2)]);
  const big = { xid: D1, title: "x", cols: [{ name: "n", key: "n" }], rows: Array.from({ length: 700 }, (_, i) => ["r" + i]) };
  assert.equal(S.table(big).length, 500);                                              // Spreadsheet's largest sheet
});
