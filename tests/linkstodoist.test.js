// Connected services wave 6A: Todoist (projects and open tasks) → To-Do.
// The account (fixed host, one API token), the allowlist (app and relay
// copies: two GETs that read), the relay call, links/todo.js reading
// pages and planning the import.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const M = require("../links/todo.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

// made up at run time (a literal looks like a real key to secret scanners)
const KEY = ["0123456789", "abcdef0123", "456789abcd", "ef01234567"].join("");

test("account: fixed host, one 40-digit token, To-Do", () => {
  const a = L.normAcct({ id: "acct000001", m: 5, p: "todoist", name: "T", site: "ignored", ks: 0 });
  assert.equal(a.site, "");
  assert.deepEqual(L.PLATFORMS.todoist.apps, ["todo"]);
  assert.equal(L.checkKeys("todoist", { key: KEY }).ok, true);
  assert.equal(L.checkKeys("todoist", { key: KEY.slice(1) }).ok, false);
  assert.equal(L.checkKeys("todoist", { key: KEY.slice(1) + "g" }).ok, false);
  assert.equal(L.apiUrl("todoist", a, "/projects?limit=1"), "https://api.todoist.com/api/v1/projects?limit=1");
  assert.deepEqual(L.authHeader("todoist", { key: KEY }), ["Authorization", "Bearer " + KEY]);
  assert.deepEqual(L.probeReq("todoist"), { m: "GET", path: "/projects?limit=1" });
});

const CASES = [
  ["todoist", { m: "GET", path: "/projects?limit=1" }, ""],
  ["todoist", { m: "GET", path: "/projects?limit=200&cursor=YWJj%2Bd%2Fe%3D" }, ""],
  ["todoist", { m: "GET", path: "/tasks?limit=200" }, ""],
  ["todoist", { m: "GET", path: "/tasks?limit=201" }, "query"],
  ["todoist", { m: "GET", path: "/tasks?filter=today" }, "query"],
  ["todoist", { m: "GET", path: "/tasks?limit=5&cursor=a%20b" }, "path"],
  ["todoist", { m: "GET", path: "/tasks/123" }, "path"],
  ["todoist", { m: "GET", path: "/comments?task_id=1" }, "path"],
  ["todoist", { m: "GET", path: "/user" }, "path"],
  ["todoist", { m: "POST", path: "/tasks", body: { content: "x" } }, "path"],
  ["todoist", { m: "POST", path: "/tasks/123/close", body: { x: 1 } }, "path"],
  ["todoist", { m: "GET", path: "/tasks", body: {} }, "body"]
];
test("allowlist: one case list, app and relay agree", () => {
  for (const [p, r, want] of CASES) {
    assert.equal(L.checkReq(p, r), want, "app " + r.m + " " + r.path);
    assert.equal(X.checkExtReq(p, r), want, "relay " + r.m + " " + r.path);
  }
});

test("relay: Todoist's own host, Bearer, no host from the app; no key echoed", async () => {
  const b = (o) => Object.assign({ op: "ext", p: "todoist", key: KEY, reqs: [L.probeReq("todoist")] }, o || {});
  assert.equal(X.validExt(b()), "");
  assert.equal(X.validExt(b({ host: "evil.example.com" })), "host");
  assert.equal(X.validExt(b({ key: "nope" })), "key");
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response('{"results":[],"next_cursor":null}', { status: 200 }); };
  const ORIGIN = "https://useoros.online";
  const req = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.6.0.11" },
    body: JSON.stringify(b({ reqs: [M.req("todoist", "projects", ""), M.req("todoist", "tasks", "YWJj+/=")] })) });
  const res = await handle(req, { ALLOWED_ORIGINS: ORIGIN }, null, Date.now(), f);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.todoist.com/api/v1/projects?limit=200");
  assert.equal(calls[1].url, "https://api.todoist.com/api/v1/tasks?limit=200&cursor=YWJj%2B%2F%3D");
  assert.equal(calls[0].init.headers.Authorization, "Bearer " + KEY);
  assert.equal(JSON.stringify(json).indexOf(KEY), -1);
});

const PROJECTS = [
  { id: "6Jf8VQXxpwv56VQ7", name: "Inbox", inbox_project: true, child_order: 0 },
  { id: "6X7rM8997g3RQmvh", name: "Δουλειά", child_order: 2 },
  { id: "6X7rfFVPjhvv84XG", name: "Empty", child_order: 1 },
  { id: "6X7rfEVP8hvv25ZQ", name: "Old", is_archived: true, child_order: 3 }
];
const TASKS = [
  { id: "6X7rM8997g3RQmvh1", project_id: "6X7rM8997g3RQmvh", content: "Προσφορά <b>Άλφα</b>", description: "Με ΦΠΑ\n\n\n\nκαι μεταφορικά", labels: ["Πελάτες", "urgent"], priority: 4, child_order: 2, due: { date: "2026-10-20", is_recurring: false, string: "Oct 20" } },
  { id: "6X7rM8997g3RQmvh2", project_id: "6X7rM8997g3RQmvh", content: "Τηλέφωνο λογιστή", description: "", labels: [], priority: 1, child_order: 1, due: { date: "2026-10-14T09:00:00", is_recurring: true, string: "every monday 9am" } },
  { id: "6X7rM8997g3RQmvh3", project_id: "6X7rM8997g3RQmvh", parent_id: "6X7rM8997g3RQmvh1", content: "Κόστος υλικών", labels: ["urgent"], priority: 2, child_order: 0 },
  { id: "6X7rM8997g3RQmvh4", project_id: "6Jf8VQXxpwv56VQ7", content: "Ψωμί", labels: [], priority: 1, child_order: 0 },
  { id: "6X7rM8997g3RQmvh5", project_id: "6Jf8VQXxpwv56VQ7", content: "Done already", checked: true },
  { id: "6X7rM8997g3RQmvh6", project_id: "6Jf8VQXxpwv56VQ7", content: "   ", labels: [] },
  { id: "bad id!", project_id: "6Jf8VQXxpwv56VQ7", content: "x" }
];
const empty = () => ({ lists: [{ id: "tdl-general", name: "General", items: [] }], labels: [{ id: "lb1", name: "URGENT", color: "#e06c75" }], deleted: {} });
const CTX = { p: "todoist", acct: "acct000001", upd: true, revive: false, prio: "Priority" };

test("pages: results and a cursor; a cursor that doesn't move or isn't one ends the reading", () => {
  for (const k of M.KINDS.todoist) for (const at of ["", "YWJj+/="]) assert.equal(L.checkReq("todoist", M.req("todoist", k, at)), "", k + " " + at);
  assert.equal(M.read("todoist", "tasks", { results: TASKS, next_cursor: "abc=" }, "").next, "abc=");
  assert.equal(M.read("todoist", "tasks", { results: [], next_cursor: "abc=" }, "abc=").next, "");
  assert.equal(M.read("todoist", "tasks", { results: [], next_cursor: "a b" }, "").next, "");
  assert.equal(M.read("todoist", "tasks", { results: [], next_cursor: null }, "x").next, "");
  assert.equal(M.read("todoist", "projects", PROJECTS, "").items.length, 3);         // an array: one last page; archived out
  assert.equal(M.read("todoist", "tasks", { results: TASKS }, "").items.length, 4);   // done, empty, bad id out
  assert.deepEqual(M.read("todoist", "tasks", "<html>", "").items, []);
});

test("plan: projects with open tasks become lists, subtasks after their parent, labels by name, priority", () => {
  const got = { projects: M.read("todoist", "projects", { results: PROJECTS }, "").items, tasks: M.read("todoist", "tasks", { results: TASKS }, "").items };
  const pl = M.plan(empty(), got, CTX);
  assert.deepEqual(pl.lists.add.map((l) => l.name), ["Inbox", "Δουλειά"]);          // Inbox first, Empty left out
  const work = pl.lists.add[1].id;
  assert.equal(work, L.extId("todoist", "acct000001", "list", "6X7rM8997g3RQmvh"));
  const tasks = pl.items.add.filter((a) => a.list === work);
  assert.deepEqual(tasks.map((x) => x.text), ["Τηλέφωνο λογιστή", "Προσφορά <b>Άλφα</b>", "Κόστος υλικών"]);
  const offer = tasks[1];
  assert.equal(offer.notes, "Με ΦΠΑ\n\nκαι μεταφορικά");
  assert.equal(offer.due, "2026-10-20");
  // priority → the task's own field (Todoist 4 = P1 … 1 = P4), no extra info any more
  assert.equal(offer.prio, 1);
  assert.deepEqual(offer.info, []);
  assert.equal(tasks[0].due, "2026-10-14");
  assert.equal(tasks[0].prio, 4);
  assert.deepEqual(tasks[0].info, []);
  assert.equal(tasks[2].prio, 3);
  assert.deepEqual(tasks[2].info, []);
  // "urgent" is the label already here (any case); "Πελάτες" is new, made once
  assert.deepEqual(pl.labels.add.map((l) => l.name), ["Πελάτες"]);
  assert.deepEqual(offer.labels, [pl.labels.add[0].id, "lb1"]);
  assert.deepEqual(tasks[2].labels, ["lb1"]);
  assert.equal(pl.rec, 1);
  assert.equal(pl.sub, 1);
  assert.deepEqual(M.count(pl), { add: 2 + 4, upd: 0 });
  // the same import on two devices: the same ids
  assert.deepEqual(M.plan(empty(), got, CTX), pl);
});

test("plan again: updates only Todoist's fields, keeps what To-Do added, respects deletions", () => {
  const got = { projects: M.read("todoist", "projects", { results: PROJECTS }, "").items, tasks: M.read("todoist", "tasks", { results: TASKS }, "").items };
  const first = M.plan(empty(), got, CTX);
  // apply the first plan the way todo.js does (enough for planning)
  const st = empty();
  first.labels.add.forEach((l) => st.labels.push({ id: l.id, name: l.name }));
  first.lists.add.forEach((l) => st.lists.push({ id: l.id, name: l.name, items: [] }));
  first.items.add.forEach((a) => st.lists.find((l) => l.id === a.list).items.push(Object.assign({ id: a.id, text: a.text, done: false, due: a.due, notes: a.notes, labels: a.labels.slice(), info: a.info.slice() }, a.prio < 4 ? { prio: a.prio } : {})));
  assert.deepEqual(M.count(M.plan(st, got, CTX)), { add: 0, upd: 0 });
  assert.equal(M.plan(st, got, CTX).same, 4);
  // here: ticked, a label and a note field of its own, and the priority
  // extra-info field an earlier import left (it stays as it is)
  const work = st.lists[2];
  const offer = work.items.find((i) => i.text.startsWith("Προσφορά"));
  offer.done = true;
  offer.labels.push("mine");
  offer.info = [{ id: "x1", label: "Πελάτης", value: "Άλφα" }, { id: M.PRIO_ID, label: "Προτ.", value: "P1" }];
  work.name = "Work (renamed here)";
  // there: new text, P2, no due date, the description gone
  const t2 = JSON.parse(JSON.stringify(TASKS));
  Object.assign(t2[0], { content: "Προσφορά Άλφα v2", priority: 3, due: null, description: "" });
  const got2 = { projects: got.projects, tasks: M.read("todoist", "tasks", { results: t2 }, "").items };
  const pl = M.plan(st, got2, CTX);
  assert.equal(pl.lists.upd.length, 1);
  assert.equal(pl.items.upd.length, 1);
  const u = pl.items.upd[0];
  assert.equal(u.id, offer.id);
  assert.deepEqual(Object.keys(u.f).sort(), ["due", "notes", "prio", "text"]);
  assert.equal(u.f.text, "Προσφορά Άλφα v2");
  assert.equal(u.f.due, null);
  assert.equal(u.f.prio, 2);
  assert.equal("info" in u.f, false);         // the old priority field is never rewritten
  assert.equal("done" in u.f, false);
  // a task imported before priorities existed (extra info only, no prio):
  // an update fills the priority and leaves the extra info alone
  const legacy = JSON.parse(JSON.stringify(st));
  const lo = legacy.lists[2].items.find((i) => i.text.startsWith("Προσφορά"));
  delete lo.prio;
  lo.info = [{ id: M.PRIO_ID, label: "Priority", value: "P1" }];
  const ul = M.plan(legacy, got, CTX).items.upd;
  assert.equal(ul.length, 1);
  assert.deepEqual(ul[0].f, { prio: 1 });
  // without "update": nothing changes
  assert.deepEqual(M.count(M.plan(st, got2, Object.assign({}, CTX, { upd: false }))), { add: 0, upd: 0 });
  // deleted here: the task and the list stay out unless asked
  const del = JSON.parse(JSON.stringify(st));
  const bread = del.lists[1].items[0];
  del.lists[1].items = [];
  del.deleted[bread.id] = 5;
  const gone = M.plan(del, got, CTX);
  assert.equal(gone.gone, 1);
  assert.equal(gone.items.add.length, 0);
  assert.equal(M.plan(del, got, Object.assign({}, CTX, { revive: true })).items.add.length, 1);
  const noList = empty();
  noList.deleted[first.lists.add[1].id] = 5;
  const p3 = M.plan(noList, got, CTX);
  assert.deepEqual(p3.lists.add.map((l) => l.name), ["Inbox"]);
  assert.equal(p3.gone, 3);
  // a task whose text is already open in its list is not doubled
  const dup = empty();
  dup.lists.push({ id: first.lists.add[0].id, name: "Inbox", items: [{ id: "mine1", text: "ψωμί ", done: false }] });
  const p4 = M.plan(dup, got, CTX);
  assert.equal(p4.here, 1);
  assert.equal(p4.items.add.filter((a) => a.list === first.lists.add[0].id).length, 0);
});
