// Connected services wave 6G: the open GitHub issues assigned to the
// token's owner → To-Do. The allowlist (app and relay copies: one more
// GET, fixed filter and state), links/todo.js reading pages of issues and
// planning one list per repository.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const M = require("../links/todo.js");

let X;
test.before(async () => { X = await import("../relay/ext.js"); });

test("account: GitHub serves Kanban and To-Do", () => {
  assert.deepEqual(L.PLATFORMS.github.apps, ["kanban", "todo"]);
  assert.deepEqual(M.KINDS.github, ["tasks"]);
});

const CASES = [
  ["github", M.req("github", "tasks", ""), ""],
  ["github", M.req("github", "tasks", "3"), ""],
  ["github", { m: "GET", path: "/issues?filter=all&state=open&per_page=100&page=1" }, "query"],
  ["github", { m: "GET", path: "/issues?filter=assigned&state=all&per_page=100&page=1" }, "query"],
  ["github", { m: "GET", path: "/issues?filter=assigned&state=open&per_page=100&page=1&labels=x" }, "query"],
  ["github", { m: "GET", path: "/user/issues?filter=assigned" }, "path"],
  ["github", { m: "POST", path: "/issues", body: { title: "x" } }, "path"]
];
test("allowlist: only the assigned, open issues; app and relay agree", () => {
  assert.equal(M.req("github", "tasks", "").path, "/issues?filter=assigned&state=open&per_page=100&page=1");
  assert.equal(M.req("github", "tasks", "../x").path, "/issues?filter=assigned&state=open&per_page=100&page=1");
  for (const [p, r, want] of CASES) {
    assert.equal(L.checkReq(p, r), want, "app " + r.path);
    assert.equal(X.checkExtReq(p, r), want, "relay " + r.path);
  }
});

const issue = (id, n, repo, o) => Object.assign({ id, number: n, title: "Issue " + n, state: "open", repository: { full_name: repo },
  html_url: "https://github.com/" + repo + "/issues/" + n, labels: [] }, o || {});
test("read: open issues, pull requests and odd repositories out; the next page while a page is full", () => {
  const r = M.read("github", "tasks", [
    issue(1, 7, "chris/oros", { body: "Steps\r\n1. open", labels: [{ name: "bug" }, { name: "Bug" }], milestone: { due_on: "2026-11-01T07:00:00Z" } }),
    issue(2, 8, "chris/oros", { pull_request: { url: "x" } }),
    issue(3, 9, "chris/oros", { state: "closed" }),
    issue(4, 1, "bad repo"),
    issue(5, 2, "chris/..")
  ], "");
  assert.deepEqual(r.items.map((t) => [t.xid, t.pid, t.text, t.labels, t.due]), [["1", "chris/oros", "#7 Issue 7", ["bug"], "2026-11-01"]]);
  assert.equal(r.items[0].notes, "Steps\n1. open\n\nhttps://github.com/chris/oros/issues/7");
  assert.equal(r.next, "");
  const full = Array.from({ length: 100 }, (_, i) => issue(100 + i, i, "o/r"));
  assert.equal(M.read("github", "tasks", full, "").next, "2");
  assert.equal(M.read("github", "tasks", full, "2").next, "3");
  assert.deepEqual(M.read("github", "tasks", { message: "Bad credentials" }, ""), { items: [], next: "" });
});

test("plan: one list per repository in name order, ids stable; again only new ones", () => {
  const got = { tasks: M.read("github", "tasks", [issue(1, 7, "zeta/app"), issue(2, 3, "Alpha/site"), issue(3, 4, "zeta/app")], "").items };
  const ctx = { p: "github", acct: "acct000002", upd: true, revive: false, prio: "Priority" };
  const pl = M.plan({ lists: [], labels: [], deleted: {} }, got, ctx);
  assert.deepEqual(pl.lists.add.map((l) => l.name), ["Alpha/site", "zeta/app"]);
  assert.deepEqual(pl.items.add.map((a) => a.text), ["#3 Issue 3", "#4 Issue 4", "#7 Issue 7"]);
  assert.equal(pl.items.add[0].list, L.extId("github", "acct000002", "list", "Alpha/site"));
  assert.deepEqual(M.count(pl), { add: 5, upd: 0 });
  // To-Do after the import, then a new issue there
  const lists = pl.lists.add.map((l) => ({ id: l.id, name: l.name, items: pl.items.add.filter((a) => a.list === l.id).map((a) => ({ id: a.id, text: a.text, notes: a.notes, due: a.due, labels: [], info: [] })) }));
  got.tasks.push(M.read("github", "tasks", [issue(4, 9, "zeta/app")], "").items[0]);
  const again = M.plan({ lists, labels: [], deleted: {} }, got, ctx);
  assert.deepEqual([again.lists.add.length, again.items.add.map((a) => a.text), again.items.upd.length, again.same], [0, ["#9 Issue 9"], 0, 3]);
});
