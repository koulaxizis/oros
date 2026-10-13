// Connected services wave 6C: Raindrop.io (collections and bookmarks)
// → Bookmarks. The account (fixed host, one test token), the allowlist
// (app and relay copies: three GETs that read), the relay call,
// links/bookmarks.js reading pages and planning the import.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const M = require("../links/bookmarks.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

// made up at run time (a literal looks like a real key to secret scanners)
const KEY = ["1a2b3c4d", "5e6f", "7a8b", "9c0d", "1e2f3a4b5c6d"].join("-");

test("account: fixed host, one test token, Bookmarks", () => {
  const a = L.normAcct({ id: "acct000001", m: 5, p: "raindrop", name: "R", site: "ignored", ks: 0 });
  assert.equal(a.site, "");
  assert.deepEqual(L.PLATFORMS.raindrop.apps, ["bookmarks"]);
  assert.equal(L.checkKeys("raindrop", { key: KEY }).ok, true);
  assert.equal(L.checkKeys("raindrop", { key: "short-token" }).ok, false);
  assert.equal(L.checkKeys("raindrop", { key: KEY + "\r\nX-Evil: 1" }).ok, false);
  assert.equal(L.apiUrl("raindrop", a, "/collections"), "https://api.raindrop.io/rest/v1/collections");
  assert.deepEqual(L.authHeader("raindrop", { key: KEY }), ["Authorization", "Bearer " + KEY]);
  assert.deepEqual(L.probeReq("raindrop"), { m: "GET", path: "/collections" });
});

const CASES = [
  ["raindrop", M.req("raindrop", "collections"), ""],
  ["raindrop", M.req("raindrop", "children"), ""],
  ["raindrop", M.req("raindrop", "raindrops", 0), ""],
  ["raindrop", M.req("raindrop", "raindrops", 41), ""],
  ["raindrop", { m: "GET", path: "/raindrops/0?perpage=51&page=0" }, "query"],
  ["raindrop", { m: "GET", path: "/raindrops/0?perpage=50&page=0&search=x" }, "query"],
  ["raindrop", { m: "GET", path: "/collections?x=1" }, "query"],
  ["raindrop", { m: "GET", path: "/raindrops/-99?perpage=50&page=0" }, "path"],
  ["raindrop", { m: "GET", path: "/raindrop/123" }, "path"],
  ["raindrop", { m: "GET", path: "/user" }, "path"],
  ["raindrop", { m: "GET", path: "/backups" }, "path"],
  ["raindrop", { m: "POST", path: "/raindrop", body: { link: "https://x" } }, "path"],
  ["raindrop", { m: "DELETE", path: "/raindrop/1" }, "method"],
  ["raindrop", { m: "GET", path: "/collections", body: {} }, "body"]
];
test("allowlist: one case list, app and relay agree", () => {
  for (const [p, r, want] of CASES) {
    assert.equal(L.checkReq(p, r), want, "app " + r.m + " " + r.path);
    assert.equal(X.checkExtReq(p, r), want, "relay " + r.m + " " + r.path);
  }
});

test("relay: Raindrop's own host, Bearer, no host from the app; no key echoed", async () => {
  const b = (o) => Object.assign({ op: "ext", p: "raindrop", key: KEY, reqs: [L.probeReq("raindrop")] }, o || {});
  assert.equal(X.validExt(b()), "");
  assert.equal(X.validExt(b({ host: "evil.example.com" })), "host");
  assert.equal(X.validExt(b({ key: "nope" })), "key");
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response('{"result":true,"items":[]}', { status: 200 }); };
  const ORIGIN = "https://useoros.online";
  const res = await handle(new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.6.0.13" },
    body: JSON.stringify(b({ reqs: [M.req("raindrop", "raindrops", 2)] })) }), { ALLOWED_ORIGINS: ORIGIN }, null, Date.now(), f);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(calls[0].url, "https://api.raindrop.io/rest/v1/raindrops/0?perpage=50&page=2");
  assert.equal(calls[0].init.headers.Authorization, "Bearer " + KEY);
  assert.equal(JSON.stringify(json).indexOf(KEY), -1);
});

test("read: collections (system ones out), bookmarks page while full; trash and odd links out", () => {
  const c = M.read("raindrop", "collections", { result: true, items: [{ _id: 11, title: "Work" }, { _id: -1, title: "Unsorted" }, { _id: "x" }] }, 0);
  assert.deepEqual(c, { items: [{ xid: "11", name: "Work" }], next: -1 });
  const full = { result: true, items: Array.from({ length: 50 }, (_, i) => ({ _id: i + 1, link: "https://e.com/" + i, collection: { $id: 11 } })) };
  assert.equal(M.read("raindrop", "raindrops", full, 3).next, 4);
  const r = M.read("raindrop", "raindrops", { items: [
    { _id: 1, link: "https://a.com/x", title: "A <b>", note: "", excerpt: "From the page", tags: ["dev", "Dev", "x".repeat(40)], important: true, collection: { $id: 11 } },
    { _id: 2, link: "javascript:alert(1)", title: "bad" },
    { _id: 3, link: "https://t.com", collection: { $id: -99 } },
    { _id: 4, link: "https://u.com", note: "Mine\r\nline 2", collection: { $id: -1 } }
  ] }, 0);
  assert.equal(r.next, -1);
  assert.deepEqual(r.items.map((x) => x.xid), ["1", "4"]);
  assert.deepEqual(r.items[0], { xid: "1", url: "https://a.com/x", col: "11", title: "A <b>", note: "From the page", tags: ["dev", "x".repeat(32)], fav: true });
  assert.equal(r.items[1].col, "");
  assert.equal(r.items[1].note, "Mine\nline 2");
  assert.deepEqual(M.read("raindrop", "raindrops", { result: false, errorMessage: "x" }, 0), { items: [], next: -1 });
});

const dupe = (u) => u.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
function got() {
  return {
    collections: [{ xid: "11", name: "Work" }, { xid: "12", name: "Recipes" }],
    children: [{ xid: "13", name: "Fonts" }],
    raindrops: [
      { xid: "1", url: "https://a.com/x", col: "11", title: "A", note: "n", tags: ["dev"], fav: true },
      { xid: "2", url: "https://b.com", col: "13", title: "B", note: "", tags: [], fav: false },
      { xid: "3", url: "https://www.c.com/", col: "", title: "", note: "", tags: [], fav: false },
      { xid: "4", url: "https://d.com", col: "99", title: "D", note: "", tags: [], fav: false }
    ]
  };
}
test("plan: folders by name, Unsorted for the rest, links already here skipped, ids stable", () => {
  const st = { items: { k1: { id: "k1", url: "https://c.com", folderId: "unsorted" } },
               folders: { unsorted: { id: "unsorted", name: "unsorted" }, f1: { id: "f1", name: "work" } }, deleted: {} };
  const ctx = { p: "raindrop", acct: "acct000001", upd: true, revive: false, dupe };
  const pl = M.plan(st, got(), ctx);
  const fonts = L.extId("raindrop", "acct000001", "folder", "13");
  assert.deepEqual(pl.folders.add, [{ id: fonts, name: "Fonts" }]);         // "Work" → the existing "work"; Recipes unused
  assert.deepEqual(pl.items.add.map((a) => a.folderId), ["f1", fonts, "unsorted"]);
  assert.equal(pl.items.add[0].id, L.extId("raindrop", "acct000001", "bookmark", "1"));
  assert.equal(pl.items.add[0].fav, true);
  assert.equal(pl.here, 1);
  assert.deepEqual(M.count(pl), { add: 4, upd: 0 });
  assert.deepEqual(M.plan(st, got(), ctx), pl);                            // same input, same plan
});

test("plan again: update only title, note and added tags; deleted stays out unless asked", () => {
  const id = (x) => L.extId("raindrop", "acct000001", "bookmark", x);
  const st = {
    items: {
      [id("1")]: { id: id("1"), url: "https://a.com/x", title: "Old", note: "n", tags: ["mine"], folderId: "f1", fav: false },
      [id("2")]: { id: id("2"), url: "https://b.com", title: "B", note: "", tags: [], folderId: "unsorted" }
    },
    folders: { unsorted: { id: "unsorted", name: "unsorted" }, f1: { id: "f1", name: "Work" } },
    deleted: { [id("3")]: 1, [L.extId("raindrop", "acct000001", "folder", "13")]: 1 }
  };
  const g = got();
  g.raindrops[1].col = "13";
  let pl = M.plan(st, g, { p: "raindrop", acct: "acct000001", upd: true, revive: false, dupe });
  assert.deepEqual(pl.items.upd, [{ id: id("1"), f: { title: "A", tags: ["mine", "dev"] } }]);
  assert.equal(pl.same, 1);
  assert.equal(pl.gone, 1);                                                 // #3 deleted here
  assert.deepEqual(pl.items.add.map((a) => a.url), ["https://d.com"]);
  pl = M.plan(st, g, { p: "raindrop", acct: "acct000001", upd: false, revive: true, dupe });
  assert.deepEqual(pl.items.upd, []);
  assert.deepEqual(pl.items.add.map((a) => a.url), ["https://www.c.com/", "https://d.com"]);
  assert.equal(pl.items.add[0].title, "https://www.c.com/");                // no title → the link
});
