// Connected services wave 6B: a Trello board or a GitHub repository's
// issues → Kanban. The accounts (Trello: API key + token; GitHub: a
// personal access token), the allowlist (app and relay copies: read-only
// GETs with fixed field lists), the relay call with Trello's two keys,
// links/kanban.js turning answers into a Trello-export-shaped board.
// Wave 6F: a Notion database → a board (lists from its Status/Select).
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const K = require("../links/kanban.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

// made up at run time (a literal looks like a real key to secret scanners)
const TKEY = ["0123456789abcdef", "0123456789abcdef"].join("");
const TTOK = ["ATTA", "a1b2c3d4".repeat(8), "F00DCAFE"].join("");
const GHPAT = ["github", "pat", "11ABCDEFG0" + "x".repeat(72)].join("_");
const GHP = ["ghp", "A1b2C3d4E5".repeat(3) + "f6G7h8"].join("_");
const BOARD = "5f0c1a2b3c4d5e6f7a8b9c0d";

test("accounts: Trello needs key and token, GitHub a personal access token; Kanban and To-Do", () => {
  assert.deepEqual(L.PLATFORMS.trello.apps, ["kanban"]);
  assert.deepEqual(L.PLATFORMS.github.apps, ["kanban", "todo"]);
  assert.equal(L.checkKeys("trello", { key: TKEY, token: TTOK }).ok, true);
  assert.deepEqual(L.checkKeys("trello", { key: TKEY }).bad, ["token"]);
  assert.deepEqual(L.checkKeys("trello", { key: "nope", token: TTOK }).bad, ["key"]);
  assert.equal(L.checkKeys("github", { key: GHPAT }).ok, true);
  assert.equal(L.checkKeys("github", { key: GHP }).ok, true);
  assert.equal(L.checkKeys("github", { key: "gho_" + "a".repeat(36) }).ok, false);       // an OAuth app token: not ours
  assert.deepEqual(L.authHeader("trello", { key: TKEY, token: TTOK }), ["Authorization", 'OAuth oauth_consumer_key="' + TKEY + '", oauth_token="' + TTOK + '"']);
  assert.deepEqual(L.authHeader("github", { key: GHPAT }), ["Authorization", "Bearer " + GHPAT]);
  assert.equal(L.apiUrl("trello", { p: "trello" }, "/members/me/boards"), "https://api.trello.com/1/members/me/boards");
  assert.equal(L.apiUrl("github", { p: "github" }, "/user/repos"), "https://api.github.com/user/repos");
});

const CASES = [
  ["trello", L.probeReq("trello"), ""],
  ["trello", K.boardReq("trello", BOARD), ""],
  ["trello", { m: "GET", path: "/boards/" + BOARD + "?fields=all" }, "query"],
  ["trello", { m: "GET", path: "/boards/" + BOARD + "/members" }, "path"],
  ["trello", { m: "GET", path: "/members/me" }, "path"],
  ["trello", { m: "GET", path: "/members/me/boards?filter=all&fields=name" }, "query"],
  ["trello", { m: "PUT", path: "/cards/" + BOARD, body: { name: "x" } }, "path"],
  ["trello", { m: "GET", path: "/boards/" + BOARD + "?key=abc" }, "query"],
  ["github", L.probeReq("github"), ""],
  ["github", K.listReq("github", 4), ""],
  ["github", K.boardReq("github", "octo-org/my.repo_2", 3), ""],
  ["github", { m: "GET", path: "/repos/o/r/issues?state=closed" }, "query"],
  ["github", { m: "GET", path: "/repos/o/r/issues?state=all&per_page=101" }, "query"],
  ["github", { m: "GET", path: "/repos/o/r/contents/secrets.txt" }, "path"],
  ["github", { m: "GET", path: "/repos/o/../issues" }, "path"],
  ["github", { m: "GET", path: "/user" }, "path"],
  ["github", { m: "GET", path: "/user/emails" }, "path"],
  ["github", { m: "POST", path: "/repos/o/r/issues", body: { title: "x" } }, "path"]
];
test("allowlist: one case list, app and relay agree", () => {
  for (const [p, r, want] of CASES) {
    assert.equal(L.checkReq(p, r), want, "app " + p + " " + r.m + " " + r.path);
    assert.equal(X.checkExtReq(p, r), want, "relay " + p + " " + r.m + " " + r.path);
  }
  assert.equal(K.boardReq("trello", "../me"), null);
  assert.equal(K.boardReq("github", "a/.."), null);
});

test("relay: Trello's host and both keys in the header, GitHub's API version; no key echoed", async () => {
  const b = (o) => Object.assign({ op: "ext", p: "trello", key: TKEY, token: TTOK, reqs: [L.probeReq("trello")] }, o || {});
  assert.equal(X.validExt(b()), "");
  assert.equal(X.validExt(b({ token: undefined })), "key");
  assert.equal(X.validExt(b({ host: "evil.example.com" })), "host");
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response("[]", { status: 200 }); };
  const ORIGIN = "https://useoros.online";
  const send = (body) => handle(new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.6.0.12" }, body: JSON.stringify(body) }),
    { ALLOWED_ORIGINS: ORIGIN }, null, Date.now(), f);
  let json = await (await send(b({ reqs: [K.boardReq("trello", BOARD)] }))).json();
  assert.equal(json.ok, true);
  assert.equal(calls[0].url, "https://api.trello.com/1/boards/" + BOARD + "?fields=name&lists=open&cards=open&labels=all&checklists=all&card_fields=name,desc,due,idList,idLabels,closed,pos&list_fields=name,closed,pos");
  assert.equal(calls[0].init.headers.Authorization, 'OAuth oauth_consumer_key="' + TKEY + '", oauth_token="' + TTOK + '"');
  assert.equal(JSON.stringify(json).indexOf(TTOK), -1);
  json = await (await send({ op: "ext", p: "github", key: GHPAT, reqs: [K.boardReq("github", "o/r", 1)] })).json();
  assert.equal(json.ok, true);
  assert.equal(calls[1].url, "https://api.github.com/repos/o/r/issues?state=all&per_page=100&page=1");
  assert.equal(calls[1].init.headers.Authorization, "Bearer " + GHPAT);
  assert.equal(calls[1].init.headers["X-GitHub-Api-Version"], "2022-11-28");
  assert.ok(/^orOS/.test(calls[1].init.headers["User-Agent"]));                   // GitHub refuses calls without one
  assert.equal(JSON.stringify(json).indexOf(GHPAT), -1);
});

test("lists: boards and repositories; archived repos out; GitHub pages while full", () => {
  assert.deepEqual(K.readList("trello", [{ id: BOARD, name: "Πελάτες" }, { id: "x", name: "bad" }]), { items: [{ id: BOARD, name: "Πελάτες" }], more: false });
  const full = Array.from({ length: 100 }, (_, i) => ({ full_name: "o/r" + i }));
  assert.equal(K.readList("github", full).more, true);
  assert.deepEqual(K.readList("github", [{ full_name: "o/a" }, { full_name: "o/b", archived: true }, { full_name: "bad name" }]).items, [{ id: "o/a", name: "o/a" }]);
  assert.deepEqual(K.readList("github", { message: "Bad credentials" }), { items: [], more: false });
});

test("Trello board → the export shape: lists and cards by position, only its own id", () => {
  const got = {
    id: BOARD, name: "Site Πελάτη",
    lists: [{ id: "l2", name: "Done", pos: 2 }, { id: "l1", name: "To do", pos: 1 }, { id: "l3", name: "Old", closed: true, pos: 3 }],
    cards: [{ id: "c2", name: "Second", idList: "l1", pos: 20, idLabels: ["lb1"] }, { id: "c1", name: "First <b>", desc: "a\r\nb", idList: "l1", pos: 10, due: "2026-10-20T10:00:00.000Z" }],
    labels: [{ id: "lb1", name: "urgent", color: "red" }],
    checklists: [{ idCard: "c1", checkItems: [{ id: "i1", name: "step", state: "complete" }] }]
  };
  const ex = K.toExport("trello", BOARD, got, {});
  assert.equal(ex.name, "Site Πελάτη");
  assert.deepEqual(ex.lists.map((l) => l.name), ["To do", "Done", "Old"]);
  assert.deepEqual(ex.cards.map((c) => c.name), ["First <b>", "Second"]);
  assert.equal(ex.cards[0].desc, "a\nb");
  assert.equal(ex.checklists[0].checkItems[0].state, "complete");
  assert.equal(K.toExport("trello", "5f0c1a2b3c4d5e6f7a8b9c0e", got, {}), null);     // an answer for another board
});

test("GitHub issues → two lists, cards with labels, milestone date and task lists; pull requests out", () => {
  const issues = [
    { id: 11, number: 7, title: "Crash on start", state: "open", body: "Steps:\r\n- [ ] reproduce\n- [x] log\n* [X] trace\nnot a task", labels: [{ id: 501, name: "bug" }, { id: 502, name: "p1" }], milestone: { due_on: "2026-11-01T07:00:00Z" } },
    { id: 12, number: 8, title: "Docs", state: "closed", body: null, labels: [{ id: 501, name: "bug" }] },
    { id: 13, number: 9, title: "A pull request", state: "open", pull_request: { url: "x" } },
    { id: 14, number: 10, title: "  ", state: "open" }
  ];
  assert.equal(K.readIssues(issues).items.length, 3);
  const ex = K.toExport("github", "Octo-Org/My.Repo", issues, { open: "Ανοιχτά", closed: "Κλειστά" });
  assert.equal(ex.id, "gh-octo-org-my-repo");
  assert.equal(ex.name, "Octo-Org/My.Repo");
  assert.deepEqual(ex.lists.map((l) => l.name), ["Ανοιχτά", "Κλειστά"]);
  assert.deepEqual(ex.cards.map((c) => c.name + "@" + c.idList), ["#7 Crash on start@gh-octo-org-my-repo-open", "#8 Docs@gh-octo-org-my-repo-closed"]);
  assert.deepEqual(ex.cards[0].idLabels, ["gh501", "gh502"]);
  assert.equal(ex.cards[0].due, "2026-11-01T07:00:00Z");
  assert.deepEqual(ex.labels.map((l) => l.name), ["bug", "p1"]);
  assert.deepEqual(ex.checklists, [{ idCard: "gh11", checkItems: [
    { id: "gh11-0", name: "reproduce", state: "incomplete" }, { id: "gh11-1", name: "log", state: "complete" }, { id: "gh11-2", name: "trace", state: "complete" }] }]);
  assert.equal(K.toExport("github", "../x", issues, {}), null);
});

const D1 = "11111111-2222-4333-8444-555555555555", CUR = "99999999-8888-4777-8666-555555555555";
const rt = (s) => [{ plain_text: s }];
test("Notion: databases listed by cursor, rows read by cursor; the same read-only requests as Spreadsheet", () => {
  assert.deepEqual(L.PLATFORMS.notion.apps, ["notes", "spreadsheet", "kanban"]);
  assert.equal(L.checkReq("notion", K.listReq("notion", 1, "")), "");
  assert.deepEqual(K.listReq("notion", 2, CUR).body.start_cursor, CUR);
  assert.equal(L.checkReq("notion", K.boardReq("notion", D1, 2, CUR)), "");
  assert.equal(K.boardReq("notion", "../x", 1, ""), null);
  const l = K.readList("notion", { has_more: true, next_cursor: CUR, results: [
    { object: "database", id: D1, title: rt("Έργα"), properties: { Name: { name: "Name", type: "title" } } },
    { object: "database", id: "nope", properties: {} }] });
  assert.deepEqual(l.items.map((x) => [x.id, x.name, Object.keys(x.props)]), [[D1, "Έργα", ["Name"]]]);
  assert.deepEqual([l.more, l.next], [true, CUR]);
  const r = K.readRows({ has_more: false, results: [{ object: "page", id: CUR }, { object: "page", id: D1, archived: true }] });
  assert.deepEqual([r.items.length, r.more], [1, false]);
});

test("Notion database → board: lists from Status options, labels from Multi-select, due from Date, other properties as notes", () => {
  const db = { id: D1, name: "Έργα", props: {
    Name: { name: "Name", type: "title" },
    Status: { name: "Status", type: "status", status: { options: [{ id: "s1", name: "To do", color: "red" }, { id: "s2", name: "Done", color: "green" }] } },
    Tags: { name: "Tags", type: "multi_select", multi_select: { options: [{ id: "t1", name: "web", color: "blue" }, { id: "t%2", name: "brown one", color: "brown" }] } },
    Due: { name: "Due", type: "date" }, Ποσό: { name: "Ποσό", type: "number" }, Done: { name: "Done", type: "checkbox" } } };
  const page = (n, p) => ({ object: "page", id: "00000000-0000-4000-8000-00000000000" + n, url: "https://www.notion.so/x-" + n, properties: p });
  const rows = [
    page(1, { Name: { type: "title", title: rt("Site <b>") }, Status: { type: "status", status: { name: "Done" } }, Tags: { type: "multi_select", multi_select: [{ name: "web" }, { name: "web" }] },
              Due: { type: "date", date: { start: "2026-11-01T10:00:00.000+02:00" } }, Ποσό: { type: "number", number: 300 }, Done: { type: "checkbox", checkbox: true } }),
    page(2, { Name: { type: "title", title: [] }, Status: { type: "status", status: null } }),
    page(3, { Name: { type: "title", title: rt("Νέα") }, Status: { type: "status", status: { name: "Later" } } })
  ];
  const ex = K.toExport("notion", D1, { db, rows }, { none: "Χωρίς κατάσταση", untitled: "Χωρίς τίτλο" });
  const bid = "nt-" + D1.replace(/-/g, "");
  assert.equal(ex.id, bid);
  assert.equal(ex.name, "Έργα");
  assert.deepEqual(ex.lists.map((l) => l.name), ["To do", "Done", "Later", "Χωρίς κατάσταση"]);
  assert.deepEqual(ex.labels.map((l) => [l.name, l.color]), [["web", "blue"], ["brown one", "orange"]]);
  assert.ok(ex.labels.every((l) => /^[\w-]+$/.test(l.id)));
  const [a, b, c] = ex.cards;
  assert.deepEqual([a.name, a.idList, a.idLabels, a.due], ["Site <b>", bid + "-o-s2", [bid + "-l-t1"], "2026-11-01T10:00:00.000+02:00"]);
  assert.equal(a.desc, "Ποσό: 300\nDone: TRUE\nhttps://www.notion.so/x-1");
  assert.deepEqual([b.name, b.idList], ["Χωρίς τίτλο", bid + "-none"]);
  assert.equal(c.idList, ex.lists[2].id);
  assert.equal(K.toExport("notion", D1, { db: Object.assign({}, db, { id: CUR }), rows }, {}), null);     // rows of another database
  // no Status or Select: one list
  const flat = K.toExport("notion", D1, { db: { id: D1, name: "", props: { T: { name: "T", type: "title" } } }, rows: [page(4, { T: { type: "title", title: rt("x") } })] }, { all: "Κάρτες" });
  assert.deepEqual([flat.name, flat.lists.map((l) => l.name), flat.cards.length], ["Notion", ["Κάρτες"], 1]);
});
