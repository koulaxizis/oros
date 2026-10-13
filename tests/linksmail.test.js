// Connected services wave 3: email marketing (MailerLite, Mailchimp,
// Brevo ↔ a Newsletter list). The accounts, the request allowlist (app
// and relay copies, one case list), the relay call to each fixed host,
// links/mail.js (pages, answers, the sync plan, the writes) and the
// Newsletter "plinks" collection.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const M = require("../links/mail.js");
const N = require("../newsletter/core.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

const ML_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI0In0.c2lnbmF0dXJl";
// made up at run time (a literal looks like a real key to secret scanners)
const MC_HEX = "0123456789abcdef".repeat(2);
const MC_KEY = MC_HEX + "-" + "us21";
const BV_KEY = "xkeysib-" + "a".repeat(64) + "-AbCdEf0123456789";

test("accounts: the three platforms, fixed hosts, key shapes", () => {
  for (const p of ["mlite", "mchimp", "brevo"]) {
    const a = L.normAcct({ id: "acct000001", m: 5, p, name: "N", site: "x", ks: 0 });
    assert.equal(a.site, "", p);
    assert.equal("env" in a || "vat" in a, false, p);
  }
  assert.equal(L.checkKeys("mlite", { key: ML_KEY }).ok, true);
  assert.equal(L.checkKeys("mchimp", { key: MC_KEY }).ok, true);
  assert.equal(L.checkKeys("mchimp", { key: MC_HEX }).ok, false);
  assert.equal(L.checkKeys("brevo", { key: BV_KEY }).ok, true);
  assert.equal(L.checkKeys("brevo", { key: "xsmtpsib-" + "a".repeat(64) }).ok, false);
  assert.equal(L.apiUrl("mlite", {}, "/groups?limit=1"), "https://connect.mailerlite.com/api/groups?limit=1");
  assert.equal(L.apiUrl("mchimp", {}, "/ping", { key: MC_KEY }), "https://us21.api.mailchimp.com/3.0/ping");
  assert.equal(L.apiUrl("brevo", {}, "/account"), "https://api.brevo.com/v3/account");
  assert.deepEqual(L.authHeader("mlite", { key: ML_KEY }), ["Authorization", "Bearer " + ML_KEY]);
  assert.deepEqual(L.authHeader("brevo", { key: BV_KEY }), ["api-key", BV_KEY]);
  assert.equal(L.authHeader("mchimp", { key: MC_KEY })[1], "Basic " + Buffer.from("oros:" + MC_KEY).toString("base64"));
  assert.equal(L.PLATFORMS.mchimp.relayOnly, true);
});

const ml = (n, extra) => ({ method: "POST", path: "api/subscribers", body: Object.assign({ email: "p" + n + "@ex.gr" }, extra || {}) });
const CASES = [
  // MailerLite
  ["mlite", { m: "GET", path: "/groups?limit=100&page=1" }, ""],
  ["mlite", { m: "GET", path: "/groups?limit=1001" }, "query"],
  ["mlite", { m: "GET", path: "/groups/123456789012/subscribers?filter[status]=active&limit=500&cursor=eyJpZCI6MX0" }, ""],
  ["mlite", { m: "GET", path: "/groups/123/subscribers?filter[status]=deleted" }, "query"],
  ["mlite", { m: "GET", path: "/subscribers" }, "path"],
  ["mlite", { m: "POST", path: "/batch", body: { requests: [ml(1, { groups: ["123"], fields: { name: "Άννα" } })] } }, ""],
  ["mlite", { m: "POST", path: "/batch", body: { requests: [ml(1, { status: "unsubscribed" })] } }, ""],
  ["mlite", { m: "POST", path: "/batch", body: { requests: [ml(1, { status: "active" })] } }, "body"],
  ["mlite", { m: "POST", path: "/batch", body: { requests: [ml(1, { resubscribe: true })] } }, "body"],
  ["mlite", { m: "POST", path: "/batch", body: { requests: [{ method: "DELETE", path: "api/subscribers", body: { email: "a@b.gr" } }] } }, "body"],
  ["mlite", { m: "POST", path: "/batch", body: { requests: [{ method: "POST", path: "api/groups", body: { email: "a@b.gr" } }] } }, "body"],
  ["mlite", { m: "POST", path: "/batch", body: { requests: Array.from({ length: 51 }, (_, i) => ml(i)) } }, "body"],
  ["mlite", { m: "POST", path: "/batch", body: { requests: [ml(1, { fields: { name: "x", company: "y" } })] } }, "body"],
  // Mailchimp
  ["mchimp", { m: "GET", path: "/ping" }, ""],
  ["mchimp", { m: "GET", path: "/lists?count=100&offset=0&fields=lists.id,lists.name,lists.stats.member_count,total_items" }, ""],
  ["mchimp", { m: "GET", path: "/lists?fields=lists" }, "query"],
  ["mchimp", { m: "GET", path: "/lists/abc123def0/members?count=500&offset=500&status=cleaned&fields=members.email_address,members.status,members.merge_fields,members.language,total_items" }, ""],
  ["mchimp", { m: "GET", path: "/lists/abc/members?since_last_changed=2026-10-13T10:00:00Z" }, ""],
  ["mchimp", { m: "GET", path: "/lists/abc/members?since_last_changed=2026-10-13T10:00:00+00:00" }, "query"],
  ["mchimp", { m: "POST", path: "/lists/abc", body: { members: [{ email_address: "a@b.gr", status: "subscribed" }], update_existing: false } }, ""],
  ["mchimp", { m: "POST", path: "/lists/abc", body: { members: [{ email_address: "a@b.gr", status: "subscribed" }], update_existing: true } }, "body"],
  ["mchimp", { m: "POST", path: "/lists/abc", body: { members: [{ email_address: "a@b.gr", status: "subscribed" }] } }, "body"],
  ["mchimp", { m: "POST", path: "/lists/abc", body: { members: [{ email_address: "a@b.gr", status: "unsubscribed" }], update_existing: true } }, ""],
  ["mchimp", { m: "POST", path: "/lists/abc", body: { members: [{ email_address: "a@b.gr", status: "pending" }], update_existing: false } }, "body"],
  ["mchimp", { m: "POST", path: "/lists/abc", body: { members: [{ email_address: "not an email", status: "unsubscribed" }], update_existing: true } }, "body"],
  ["mchimp", { m: "PUT", path: "/lists/abc/members/0123", body: { status: "subscribed" } }, "path"],
  ["mchimp", { m: "POST", path: "/lists/abc", body: { update_existing: true } }, "body"],
  // Brevo
  ["brevo", { m: "GET", path: "/account" }, ""],
  ["brevo", { m: "GET", path: "/contacts/lists?limit=50&offset=0" }, ""],
  ["brevo", { m: "GET", path: "/contacts/lists?limit=51" }, "query"],
  ["brevo", { m: "GET", path: "/contacts/lists/7/contacts?limit=500&offset=1000&modifiedSince=2026-10-13T10:00:00.000Z" }, ""],
  ["brevo", { m: "POST", path: "/contacts/import", body: { jsonBody: [{ email: "a@b.gr", attributes: { FIRSTNAME: "A" } }], listIds: [7], updateExistingContacts: false, emptyContactsAttributes: false } }, ""],
  ["brevo", { m: "POST", path: "/contacts/import", body: { jsonBody: [{ email: "a@b.gr", emailBlacklisted: false }], listIds: [7] } }, "body"],
  ["brevo", { m: "POST", path: "/contacts/import", body: { jsonBody: [{ email: "a@b.gr" }], listIds: [7, 8] } }, "body"],
  ["brevo", { m: "POST", path: "/contacts/lists/7/contacts/remove", body: { emails: ["a@b.gr"] } }, ""],
  ["brevo", { m: "POST", path: "/contacts/lists/7/contacts/remove", body: { all: true } }, "body"],
  ["brevo", { m: "PUT", path: "/contacts/a@b.gr", body: { emailBlacklisted: false } }, "path"]
];

test("allowlist: one case list, app and relay agree", () => {
  for (const [p, r, want] of CASES) {
    assert.equal(L.checkReq(p, r), want, "app " + p + " " + r.m + " " + r.path);
    assert.equal(X.checkExtReq(p, r), want, "relay " + p + " " + r.m + " " + r.path);
  }
});

// ---------- relay ----------
const ORIGIN = "https://useoros.online";
const ENV = { ALLOWED_ORIGINS: ORIGIN };
let ip = 20;
async function relay(body, f) {
  const r = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.9.0." + (ip++ % 250) }, body: JSON.stringify(body) });
  const res = await handle(r, ENV, null, Date.now(), f);
  return { status: res.status, json: await res.json() };
}
function mock(fn) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return fn ? fn(url, init) : new Response("{}", { status: 200 }); };
  f.calls = calls;
  return f;
}

test("relay validation: no host from the caller, key shapes", () => {
  const b = (p, key, o) => Object.assign({ op: "ext", p, key, reqs: [{ m: "GET", path: L.PLATFORMS[p].probe }] }, o || {});
  assert.equal(X.validExt(b("mlite", ML_KEY)), "");
  assert.equal(X.validExt(b("mchimp", MC_KEY)), "");
  assert.equal(X.validExt(b("brevo", BV_KEY)), "");
  assert.equal(X.validExt(b("mlite", ML_KEY, { host: "evil.example" })), "host");
  assert.equal(X.validExt(b("mchimp", MC_KEY, { base: "/x" })), "host");
  assert.equal(X.validExt(b("brevo", BV_KEY, { env: "test" })), "host");
  assert.equal(X.validExt(b("mchimp", MC_KEY + ".evil.example")), "key");
  assert.equal(X.validExt(b("brevo", "short")), "key");
  // a big subscriber batch fits; 64 KB is the cap per request
  const big = { members: Array.from({ length: 250 }, (_, i) => ({ email_address: "person" + i + "@example.gr", status: "unsubscribed", merge_fields: { FNAME: "Όνομα Επώνυμο " + i } })), update_existing: true };
  assert.equal(X.validExt(b("mchimp", MC_KEY, { reqs: [{ m: "POST", path: "/lists/abc", body: JSON.stringify(big) }] })), "");
});

test("relay: a Mailchimp batch without members is a 400, never a crash", async () => {
  const f = mock();
  const r = await relay({ op: "ext", p: "mchimp", key: MC_KEY, reqs: [{ m: "POST", path: "/lists/abc", body: JSON.stringify({ update_existing: true }) }] }, f);
  assert.equal(r.status, 400);
  assert.equal(r.json.ok, false);
  assert.equal(f.calls.length, 0);
});

test("relay call: each platform's host, path and auth; key never echoed", async () => {
  const f = mock();
  let r = await relay({ op: "ext", p: "mlite", key: ML_KEY, reqs: [{ m: "GET", path: "/groups/42/subscribers?filter[status]=active&limit=500" }] }, f);
  assert.equal(r.json.ok, true);
  assert.equal(f.calls[0].url, "https://connect.mailerlite.com/api/groups/42/subscribers?filter[status]=active&limit=500");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer " + ML_KEY);
  assert.equal(JSON.stringify(r.json).indexOf(ML_KEY), -1);
  const g = mock();
  r = await relay({ op: "ext", p: "mchimp", key: MC_KEY, reqs: [{ m: "GET", path: "/ping" }] }, g);
  assert.equal(g.calls[0].url, "https://us21.api.mailchimp.com/3.0/ping");
  assert.equal(g.calls[0].init.headers.Authorization, "Basic " + Buffer.from("oros:" + MC_KEY).toString("base64"));
  const h = mock();
  const body = { emails: ["a@b.gr"] };
  r = await relay({ op: "ext", p: "brevo", key: BV_KEY, reqs: [{ m: "POST", path: "/contacts/lists/7/contacts/remove", body: JSON.stringify(body) }] }, h);
  assert.equal(h.calls[0].url, "https://api.brevo.com/v3/contacts/lists/7/contacts/remove");
  assert.equal(h.calls[0].init.headers["api-key"], BV_KEY);
  assert.deepEqual(JSON.parse(h.calls[0].init.body), body);
});

// ---------- links/mail.js ----------
test("groups: requests pass the allowlist, answers read", () => {
  for (const p of M.PLATFORMS) {
    for (const n of [0, 3]) assert.equal(L.checkReq(p, M.groupsReq(p, n)), "", p + " page " + n);
  }
  let r = M.readGroups("mlite", { data: [{ id: "123", name: "Πελάτες", active_count: 12 }, { id: "x<b>", name: "bad" }], meta: { last_page: 3 } }, 0);
  assert.deepEqual(r, { items: [{ id: "123", name: "Πελάτες", n: 12 }], next: 1 });
  r = M.readGroups("mchimp", { lists: [{ id: "abc123", name: "Main", stats: { member_count: 5 } }], total_items: 1 }, 0);
  assert.deepEqual(r, { items: [{ id: "abc123", name: "Main", n: 5 }], next: -1 });
  r = M.readGroups("brevo", { lists: [{ id: 7, name: "Λίστα", uniqueSubscribers: 9 }], count: 120 }, 1);
  assert.deepEqual(r, { items: [{ id: "7", name: "Λίστα", n: 9 }], next: 2 });
  assert.deepEqual(M.readGroups("brevo", null, 0), { items: [], next: -1 });
});

test("members: pages, statuses, names, the end", () => {
  for (const p of M.PLATFORMS) for (const part of M.PARTS[p]) {
    assert.equal(L.checkReq(p, M.membersReq(p, p === "mchimp" ? "abc" : "42", part, p === "mlite" ? "" : 0)), "", p + " " + part);
  }
  assert.equal(L.checkReq("mlite", M.membersReq("mlite", "42", "active", "eyJpZCI6MX0")), "");
  assert.equal(M.membersReq("mlite", "42", "deleted", ""), null);
  let r = M.readMembers("mlite", "42", "bounced",
    { data: [{ email: "A@B.gr", status: "bounced", fields: { name: "Άννα", last_name: "Π." } }, { email: "bad" }], meta: { next_cursor: "abc" } }, "");
  assert.deepEqual(r, { people: [{ email: "a@b.gr", name: "Άννα Π.", lang: "", st: "bounce" }], next: "abc" });
  assert.equal(M.readMembers("mlite", "42", "active", { data: [], meta: { next_cursor: null } }, "abc").next, null);
  r = M.readMembers("mchimp", "abc", "cleaned", { members: [{ email_address: "c@d.gr", status: "cleaned", merge_fields: { FNAME: "C" }, language: "el" }], total_items: 501 }, 0);
  assert.deepEqual(r, { people: [{ email: "c@d.gr", name: "C", lang: "el", st: "bounce" }], next: 500 });
  r = M.readMembers("brevo", "7", "all", { contacts: [
    { email: "on@x.gr", attributes: { FIRSTNAME: "On" }, listUnsubscribed: [] },
    { email: "left@x.gr", listUnsubscribed: [7] },
    { email: "black@x.gr", emailBlacklisted: true }], count: 3 }, 0);
  assert.deepEqual(r.people.map((x) => x.st), ["on", "off", "off"]);
  assert.equal(r.next, null);
});

test("plan: someone who left is never brought back; unsubscribes go both ways", () => {
  const local = [
    { id: "s1", email: "both@x.gr", st: "on" },
    { id: "s2", email: "lefthere@x.gr", st: "off" },
    { id: "s3", email: "leftthere@x.gr", st: "on" },
    { id: "s4", email: "onlyhere@x.gr", st: "on", name: "Here" },
    { id: "s5", email: "pending@x.gr", st: "pend" },
    { id: "s6", email: "bounced@x.gr", st: "bounce" }
  ];
  const remote = [
    { email: "both@x.gr", st: "on" },
    { email: "lefthere@x.gr", st: "on" },
    { email: "leftthere@x.gr", st: "off" },
    { email: "pending@x.gr", st: "spam" },
    { email: "onlythere@x.gr", st: "on", name: "There" },
    { email: "gone@x.gr", st: "on" },
    { email: "bounced@x.gr", st: "off" },
    { email: "dup@x.gr", st: "on" }, { email: "dup@x.gr", st: "bounce" }
  ];
  const supp = (e) => e === "gone@x.gr";
  const p = M.plan(local, remote, { pull: true, push: true, supp });
  assert.deepEqual(p.offHere, [{ id: "s3", st: "off" }, { id: "s5", st: "spam" }]);
  assert.deepEqual(p.offThere, ["gone@x.gr", "lefthere@x.gr"]);
  assert.deepEqual(p.add.map((x) => x.email), ["onlythere@x.gr"]);
  assert.deepEqual(p.send, [{ email: "onlyhere@x.gr", name: "Here", lang: "" }]);
  const q = M.plan(local, remote, { pull: false, push: false, supp });
  assert.deepEqual([q.add.length, q.send.length, q.offHere.length, q.offThere.length], [0, 0, 2, 2]);
});

test("writes: chunked, every request passes the allowlist (app and relay)", () => {
  const people = Array.from({ length: 260 }, (_, i) => ({ email: "p" + i + "@ex.gr", name: i % 2 ? "Όνομα " + i : "", lang: "el" }));
  for (const p of M.PLATFORMS) {
    const g = p === "mchimp" ? "abc" : "42";
    const adds = M.pushReqs(p, g, people), offs = M.unsubReqs(p, g, people.map((x) => x.email));
    assert.equal(adds.length, Math.ceil(260 / M.CHUNK[p]), p);
    for (const r of adds.concat(offs)) {
      assert.equal(L.checkReq(p, r), "", p + " " + r.path);
      assert.equal(X.checkExtReq(p, r), "", "relay " + p + " " + r.path);
      assert.ok(JSON.stringify(r.body).length < 64 * 1024, p + " body size");
    }
  }
  const mc = M.pushReqs("mchimp", "abc", people.slice(0, 1))[0];
  assert.equal(mc.body.update_existing, false);
  assert.deepEqual(mc.body.members[0], { email_address: "p0@ex.gr", status: "subscribed", language: "el" });
  const ml = M.unsubReqs("mlite", "42", ["a@b.gr"])[0];
  assert.deepEqual(ml.body.requests[0], { method: "POST", path: "api/subscribers", body: { email: "a@b.gr", status: "unsubscribed" } });
  assert.deepEqual(M.pushReqs("brevo", "x<", people), []);
  assert.deepEqual(M.readWrite("mlite", 50, { status: 200, data: { failed: 2 } }), { ok: 48, failed: 2 });
  assert.deepEqual(M.readWrite("mchimp", 3, { status: 200, data: { errors: [{ error: "x@y.gr is already a list member" }, { error: "invalid" }] } }), { ok: 2, failed: 1 });
  assert.deepEqual(M.readWrite("brevo", 5, { status: 0, err: "timeout" }), { ok: 0, failed: 5 });
});

// ---------- Newsletter plinks ----------
test("newsletter plinks: left out while empty, merged LWW, gone with their list", () => {
  const base = { lists: [{ id: "lst1", m: 1, name: "A" }] };
  assert.equal("plinks" in N.normalize(base), false);
  const id = N.plinkId("lst1", "acct000001", "42");
  assert.equal(id, N.plinkId("lst1", "acct000001", "42"));
  const a = Object.assign({}, base, { plinks: [{ id, m: 5, list: "lst1", acct: "acct000001", p: "mlite", grp: "42", gname: "G", last: 0 }] });
  const b = Object.assign({}, base, { plinks: [{ id, m: 9, list: "lst1", acct: "acct000001", p: "mlite", grp: "42", gname: "G", last: 9 }] });
  const ab = N.mergeNewsletter(a, b), ba = N.mergeNewsletter(b, a);
  assert.deepEqual(ab, ba);
  assert.equal(ab.plinks[0].last, 9);
  // an older copy without plinks keeps them on merge (union)
  assert.equal(N.mergeNewsletter(a, base).plinks.length, 1);
  // bad rows dropped; a deleted list takes its links along
  assert.equal(N.normalize(Object.assign({}, base, { plinks: [{ id, m: 1, list: "lst1", acct: "acct000001", p: "woo", grp: "42" }] })).plinks, undefined);
  assert.equal(N.normalize({ lists: [{ id: "lst1", m: 2, del: 1 }], plinks: a.plinks }).plinks, undefined);
  // a subscriber that came from a platform keeps its source
  assert.equal(N.normSub({ id: "s1", m: 1, list: "lst1", email: "a@b.gr", src: "platform" }).src, "platform");
});
