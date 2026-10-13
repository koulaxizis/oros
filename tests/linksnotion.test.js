// Connected services wave 6D: Notion (pages shared with the user's own
// integration) → Notes. The account (fixed host, one secret, always via
// the relay), the allowlist (app and relay copies: a search that lists
// pages, a block's children), the relay call, links/notes.js reading
// pages and blocks, the page text and the plan.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const M = require("../links/notes.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

// made up at run time (a literal looks like a real key to secret scanners)
const KEY = ["ntn", "A1b2C3d4E5f6".repeat(4)].join("_");
const OLD = ["secret", "Z9y8X7w6V5".repeat(4) + "abc"].join("_");
const P1 = "11111111-2222-4333-8444-555555555555", P2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CUR = "99999999-8888-4777-8666-555555555555";

test("account: fixed host, one secret, Notes and Spreadsheet, always through the relay", () => {
  assert.deepEqual(L.PLATFORMS.notion.apps, ["notes", "spreadsheet"]);
  assert.equal(L.PLATFORMS.notion.relayOnly, true);
  assert.equal(L.checkKeys("notion", { key: KEY }).ok, true);
  assert.equal(L.checkKeys("notion", { key: OLD }).ok, true);
  assert.equal(L.checkKeys("notion", { key: "ntn_short" }).ok, false);
  assert.equal(L.checkKeys("notion", { key: KEY + "\r\nX: 1" }).ok, false);
  assert.deepEqual(L.authHeader("notion", { key: KEY }), ["Authorization", "Bearer " + KEY]);
  assert.equal(L.checkReq("notion", L.probeReq("notion")), "");
});

const CASES = [
  ["notion", M.searchReq(""), ""],
  ["notion", M.searchReq(CUR), ""],
  ["notion", M.blocksReq(P1, ""), ""],
  ["notion", M.blocksReq(P1.replace(/-/g, ""), CUR), ""],
  ["notion", { m: "POST", path: "/search", body: { page_size: 100 } }, "body"],                                    // no filter: databases too
  ["notion", { m: "POST", path: "/search", body: { filter: { property: "object", value: "user" }, page_size: 10 } }, "body"],
  ["notion", { m: "POST", path: "/search", body: { filter: M.SEARCH_FILTER, page_size: 101 } }, "body"],
  ["notion", { m: "POST", path: "/search", body: { filter: M.SEARCH_FILTER, query: "x" } }, "body"],
  ["notion", { m: "POST", path: "/search", body: { filter: M.SEARCH_FILTER, start_cursor: "abc" } }, "body"],
  ["notion", { m: "GET", path: "/blocks/" + P1 + "/children?page_size=100&filter=x" }, "query"],
  ["notion", { m: "GET", path: "/blocks/" + P1 }, "path"],
  ["notion", { m: "GET", path: "/pages/" + P1 }, "path"],
  ["notion", { m: "GET", path: "/users" }, "path"],
  ["notion", { m: "POST", path: "/pages", body: { parent: {} } }, "path"],
  ["notion", { m: "PUT", path: "/blocks/" + P1 + "/children", body: { children: [] } }, "path"],
  ["notion", { m: "POST", path: "/databases/" + P1 + "/query", body: { page_size: 10, filter: {} } }, "body"]   // rows: wave 6E, tests/linksnotiondb.test.js
];
test("allowlist: one case list, app and relay agree", () => {
  for (const [p, r, want] of CASES) {
    assert.equal(L.checkReq(p, r), want, "app " + r.m + " " + r.path + " " + JSON.stringify(r.body || ""));
    assert.equal(X.checkExtReq(p, r), want, "relay " + r.m + " " + r.path + " " + JSON.stringify(r.body || ""));
  }
  assert.equal(M.blocksReq("../users", ""), null);
});

test("relay: Notion's host, Bearer, Notion-Version; the search body as is; no key echoed", async () => {
  // the app's host sends a request body as JSON text
  const wire = (r) => (r.body ? { m: r.m, path: r.path, body: JSON.stringify(r.body) } : r);
  const b = (o) => Object.assign({ op: "ext", p: "notion", key: KEY, reqs: [wire(M.searchReq(""))] }, o || {});
  assert.equal(X.validExt(b()), "");
  assert.equal(X.validExt(b({ host: "evil.example.com" })), "host");
  assert.equal(X.validExt(b({ key: "nope" })), "key");
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response('{"object":"list","results":[],"has_more":false}', { status: 200 }); };
  const ORIGIN = "https://useoros.online";
  const res = await handle(new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.6.0.14" },
    body: JSON.stringify(b({ reqs: [wire(M.searchReq(CUR)), M.blocksReq(P1, "")] })) }), { ALLOWED_ORIGINS: ORIGIN }, null, Date.now(), f);
  const json = await res.json();
  assert.equal(json.ok, true);
  const s = calls.find((c) => /search$/.test(c.url)), g = calls.find((c) => /children/.test(c.url));
  assert.equal(s.url, "https://api.notion.com/v1/search");
  assert.equal(s.init.method, "POST");
  assert.deepEqual(JSON.parse(s.init.body), { filter: { property: "object", value: "page" }, page_size: 100, start_cursor: CUR });
  assert.equal(g.url, "https://api.notion.com/v1/blocks/" + P1 + "/children?page_size=100");
  assert.equal(s.init.headers.Authorization, "Bearer " + KEY);
  assert.equal(s.init.headers["Notion-Version"], "2022-06-28");
  assert.equal(JSON.stringify(json).indexOf(KEY), -1);
});

test("search: pages with their title and parent; database rows, trash and odd ids out", () => {
  const r = M.readSearch({ object: "list", has_more: true, next_cursor: CUR, results: [
    { object: "page", id: P1, parent: { type: "workspace", workspace: true }, properties: { title: { type: "title", title: [{ plain_text: "Πρό" }, { plain_text: "χειρα" }] } } },
    { object: "page", id: P2.replace(/-/g, ""), parent: { type: "page_id", page_id: P1 }, properties: { Name: { type: "title", title: [] } } },
    { object: "page", id: CUR, parent: { type: "database_id", database_id: P1 }, properties: {} },
    { object: "page", id: "33333333-2222-4333-8444-555555555555", in_trash: true, parent: { type: "workspace" } },
    { object: "database", id: "44444444-2222-4333-8444-555555555555" },
    { object: "page", id: "not-an-id" }
  ] });
  assert.deepEqual(r, { pages: [{ xid: P1, title: "Πρόχειρα", parent: "" }, { xid: P2, title: "", parent: P1 }], next: CUR });
  assert.equal(M.readSearch({ results: [], has_more: true, next_cursor: "nope" }).next, "");
});

test("blocks → text: headings, lists, to-dos, code, quotes, tables, nesting; child pages and Notion's file links out", () => {
  const rt = (s) => [{ plain_text: s }];
  const blk = (id, type, v, extra) => Object.assign({ object: "block", id: "00000000-0000-4000-8000-" + String(id).padStart(12, "0"), type, [type]: v }, extra || {});
  const r = M.readBlocks({ has_more: false, results: [
    blk(1, "heading_1", { rich_text: rt("Τίτλος") }),
    blk(2, "paragraph", { rich_text: rt("Κείμενο <b>") }),
    blk(3, "bulleted_list_item", { rich_text: rt("ένα") }, { has_children: true }),
    blk(4, "numbered_list_item", { rich_text: rt("α") }),
    blk(5, "numbered_list_item", { rich_text: rt("β") }),
    blk(6, "to_do", { rich_text: rt("έγινε"), checked: true }),
    blk(7, "code", { rich_text: rt("let x = 1;\nx++;"), language: "javascript" }),
    blk(8, "quote", { rich_text: rt("παράθεμα") }),
    blk(9, "divider", {}),
    blk(10, "child_page", { title: "Υποσελίδα" }),
    blk(11, "image", { type: "file", file: { url: "https://s3.example/x?sig=1" }, caption: [] }),
    blk(12, "image", { type: "external", external: { url: "https://img.example/a.png" }, caption: rt("λογότυπο") }),
    blk(13, "table", { table_width: 2 }, { has_children: true }),
    blk(14, "bookmark", { url: "javascript:alert(1)" })
  ] });
  const b = r.blocks;
  assert.equal(b.length, 13);
  assert.equal(b[2].more, true);
  b[2].kids = M.readBlocks({ results: [blk(20, "bulleted_list_item", { rich_text: rt("μέσα") })] }).blocks;
  b.find((x) => x.type === "table").kids = M.readBlocks({ results: [blk(30, "table_row", { cells: [rt("A"), rt("B")] }), blk(31, "table_row", { cells: [rt("1"), rt("2")] })] }).blocks;
  assert.equal(M.toText(b), [
    "# Τίτλος", "Κείμενο <b>", "- ένα", "  - μέσα", "1. α", "2. β", "- [x] έγινε",
    "```javascript", "let x = 1;", "x++;", "```", "> παράθεμα", "---", "[Image]", "[Image] λογότυπο https://img.example/a.png", "A | B", "1 | 2"
  ].join("\n"));
});

function st() {
  return { notebooks: [{ id: "nb-default", name: "Notes", mtime: 0, pos: 0 }], pages: [], tombs: {} };
}
const ctx = (o) => Object.assign({ p: "notion", acct: "acct000001", name: "Notion", untitled: "Untitled", upd: false, revive: false }, o || {});
const got = () => ({ pages: [
  { xid: P2, title: "", parent: P1, text: "child" },
  { xid: P1, title: "Πρόχειρα", parent: "", text: "root" },
  { xid: CUR, title: "Orphan", parent: "77777777-2222-4333-8444-555555555555", text: "" }
] });
test("plan: one Notion notebook, parents before children, untitled named, ids stable", () => {
  const pl = M.plan(st(), got(), ctx());
  const id = (x) => L.extId("notion", "acct000001", "page", x);
  assert.deepEqual(pl.notebook, { id: pl.nb, name: "Notion" });
  assert.deepEqual(pl.pages.add.map((a) => [a.id, a.parent, a.title, a.pos]), [
    [id(P1), null, "Πρόχειρα", 1], [id(P2), id(P1), "Untitled", 1], [id(CUR), null, "Orphan", 2]]);
  assert.deepEqual(M.count(pl), { add: 4, upd: 0 });
  assert.deepEqual(M.plan(st(), got(), ctx()), pl);
});

test("plan again: unchanged by default, replaced only when asked; deleted stays out unless asked", () => {
  const first = M.plan(st(), got(), ctx());
  const s = st();
  s.notebooks.push({ id: first.nb, name: "Notion", mtime: 1, pos: 1 });
  first.pages.add.forEach((a) => s.pages.push({ id: a.id, nb: first.nb, parent: a.parent, title: a.title, text: a.text }));
  const gone = s.pages.pop();
  s.tombs[gone.id] = 5;
  const g = got();
  g.pages[1].text = "root, edited there";
  let pl = M.plan(s, g, ctx());
  assert.equal(pl.notebook, null);
  assert.deepEqual([pl.pages.add.length, pl.pages.upd.length, pl.same, pl.gone], [0, 0, 2, 1]);
  pl = M.plan(s, g, ctx({ upd: true, revive: true }));
  assert.deepEqual(pl.pages.upd.map((u) => u.text), ["root, edited there"]);
  assert.deepEqual(pl.pages.add.map((a) => a.title), ["Orphan"]);
  // the whole notebook deleted here: nothing comes unless asked
  const s2 = st();
  s2.tombs["nb:" + first.nb] = 9;
  assert.equal(M.plan(s2, got(), ctx()).gone, 3);
  assert.equal(M.plan(s2, got(), ctx({ revive: true })).pages.add.length, 3);
});
