// RS-CTR: CRM contracts in the shop's Revenue Splitter (1.14.2+).
// The allowlist (app and relay copies agree), the rs/v1 routes and the
// shop's contracts key (rsc_…), the contracts body CRM sends, the renewal
// requests it pulls (import plan, ids, closing) and the 1.10 contract
// fields of crm/core.js.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const C = require("../crm/core.js");
const RS = require("../crm/rs.js");

let X, handle;
test.before(async () => {
  X = await import("../relay/ext.js");
  ({ handle } = await import("../relay/core.js"));
});

const CK = "ck_" + "a".repeat(40), CS = "cs_" + "b".repeat(40);
const RK = "rsc_" + "k".repeat(32);

const item = (o) => Object.assign({ id: "ctr123456", ben: "Άννα Π.", title: "Το νησί", fmt: "print", from: "2025-01-01",
  to: "2027-01-01", state: "on", renewed: [] }, o);
const push = (contracts, o) => ({ m: "POST", path: "/rs/contracts", body: Object.assign({ v: 1, sent: "2026-11-11", contracts }, o) });

const CASES = [
  [{ m: "GET", path: "/rs/contracts" }, ""],
  [{ m: "GET", path: "/rs/contracts?ben=Anna" }, "query"],
  [push([item()]), ""],
  [push([]), ""],
  [push([item({ to: "", fmt: "", state: "ended_by_agreement", renewed: ["2026-01-01"] })]), ""],
  [push([item()], { v: 2 }), "body"],
  [push([item()], { sent: "11/11/2026" }), "body"],
  [push([item()], { extra: 1 }), "body"],
  [{ m: "POST", path: "/rs/contracts", body: { v: 1, contracts: [item()] } }, "body"],
  [push([item(), item()]), "body"],                                   // the same id twice
  [push([item({ id: "a b" })]), "body"],
  [push([item({ id: "x".repeat(65) })]), "body"],
  [push([item({ title: "" })]), "body"],
  [push([item({ title: "x".repeat(201) })]), "body"],
  [push([item({ title: "a\u0000b" })]), "body"],
  [push([item({ fmt: "audio" })]), "body"],
  [push([item({ state: "maybe" })]), "body"],
  [push([item({ from: "" })]), "body"],
  [push([item({ to: "2027-1-1" })]), "body"],
  [push([item({ renewed: Array.from({ length: 51 }, () => "2026-01-01") })]), "body"],
  [push([item({ note: "x" })]), "body"],
  [push([Object.assign(item(), { ben: undefined })].map((x) => { delete x.ben; return x; })), "body"],
  [push(Array.from({ length: 2001 }, (_, i) => item({ id: "c" + i }))), "body"],
  [{ m: "PUT", path: "/rs/contracts", body: { v: 1 } }, "path"],
  [{ m: "GET", path: "/rs/contract-requests" }, ""],
  [{ m: "GET", path: "/rs/contract-requests?state=new" }, ""],
  [{ m: "GET", path: "/rs/contract-requests?state=all" }, ""],
  [{ m: "GET", path: "/rs/contract-requests?state=old" }, "query"],
  [{ m: "POST", path: "/rs/contract-requests/17", body: { state: "oros" } }, ""],
  [{ m: "POST", path: "/rs/contract-requests/rq_A-9", body: { state: "closed" } }, ""],
  [{ m: "POST", path: "/rs/contract-requests/17", body: { state: "new" } }, "body"],
  [{ m: "POST", path: "/rs/contract-requests/17", body: { state: "oros", note: "x" } }, "body"],
  [{ m: "POST", path: "/rs/contract-requests/" + "x".repeat(65), body: { state: "oros" } }, "path"],
  [{ m: "POST", path: "/rs/contract-requests/a.b", body: { state: "oros" } }, "path"],
  [{ m: "POST", path: "/rs/contract-requests", body: { state: "oros" } }, "path"],
  [{ m: "GET", path: "/rs/contract-requests/17" }, "path"]
];

test("allowlist: links/core.js and relay/ext.js agree on every contracts case", () => {
  for (const [r, want] of CASES) {
    assert.equal(L.checkReq("woo", r), want, "app " + r.m + " " + r.path + " " + JSON.stringify(r.body || "").slice(0, 80));
    assert.equal(X.checkExtReq("woo", r), want, "relay " + r.m + " " + r.path);
  }
});

test("allowlist: the list may weigh at most 1 MB in UTF-8", () => {
  // 2000 rows of a long Greek title: under 2000 items, over 1 MB in bytes
  const big = push(Array.from({ length: 2000 }, (_, i) => item({ id: "c" + i, title: "Ω".repeat(200) })));
  assert.ok(JSON.stringify(big.body).length < 1000000 && L.utf8Len(JSON.stringify(big.body)) > 1000000);
  assert.equal(L.checkReq("woo", big), "body");
  assert.equal(X.checkExtReq("woo", big), "body");
  const ok = push(Array.from({ length: 2000 }, (_, i) => item({ id: "c" + i, title: "Τίτλος " + i })));
  assert.equal(L.checkReq("woo", ok), "");
  assert.equal(X.checkExtReq("woo", ok), "");
  assert.equal(L.utf8Len("aΩ€😀"), 1 + 2 + 3 + 4);
});

test("relay: a contracts list up to 256 KB goes alone through the relay; anything else keeps the 16 KB cap", () => {
  const ext = (reqs) => ({ op: "ext", p: "woo", host: "shop.example.gr", base: "", ...(reqs.every((r) => /^\/rs\/contract/.test(r.path)) ? { rsk: RK } : { ck: CK, cs: CS }), reqs });
  // a realistic long list: 2000 rows with long titles (~385 bytes each, ~770 KB)
  const rows = (n, t) => push(Array.from({ length: n }, (_, i) => item({ id: "c" + i, title: (t || "Τίτλος βιβλίου ") + i }))).body;
  const long = "Η μεγάλη ιστορία ενός μικρού νησιού στο Αιγαίο, τόμος πρώτος: ".repeat(3).slice(0, 190);
  const mid = { m: "POST", path: "/rs/contracts", body: JSON.stringify(rows(500)) };
  assert.ok(mid.body.length > 16 * 1024 && mid.body.length <= X.RS_RELAY_BYTES);
  assert.equal(X.validExt(ext([mid])), "");
  assert.ok(X.extCap(ext([mid])) >= 2 * X.RS_RELAY_BYTES);
  // over 256 KB: refused by the relay (Workers CPU), sent only straight to the shop
  const big = { m: "POST", path: "/rs/contracts", body: JSON.stringify(rows(2000, long)) };
  assert.ok(big.body.length > X.RS_RELAY_BYTES);
  assert.equal(X.validExt(ext([big])), "body");
  assert.equal(L.RS_RELAY_BYTES, X.RS_RELAY_BYTES);
  assert.equal(L.relayTooBig("woo", [{ m: "POST", path: "/rs/contracts", body: rows(2000, long) }]), true);
  assert.equal(L.relayTooBig("woo", [{ m: "POST", path: "/rs/contracts", body: rows(500) }]), false);
  assert.equal(L.relayTooBig("woo", [{ m: "GET", path: "/rs/contracts" }]), false);
  // the larger cap only alone in its call
  assert.equal(X.validExt(ext([mid, { m: "GET", path: "/rs/contracts" }])), "body");
  // the contracts routes never travel with other WooCommerce calls
  assert.equal(X.validExt({ op: "ext", p: "woo", host: "shop.example.gr", base: "", rsk: RK, ck: CK, cs: CS, reqs: [{ m: "GET", path: "/rs/contracts" }] }), "key");
  assert.equal(X.validExt({ op: "ext", p: "woo", host: "shop.example.gr", base: "", ck: CK, cs: CS, reqs: [{ m: "GET", path: "/rs/contracts" }] }), "key");
  assert.equal(X.validExt({ op: "ext", p: "woo", host: "shop.example.gr", base: "", rsk: RK, reqs: [{ m: "GET", path: "/rs/contracts" }, { m: "GET", path: "/products" }] }), "reqs");
  assert.equal(X.validExt({ op: "ext", p: "woo", host: "shop.example.gr", base: "", rsk: RK, ck: CK, cs: CS, reqs: [{ m: "GET", path: "/products" }] }), "key");
  assert.equal(X.validExt({ op: "ext", p: "woo", host: "shop.example.gr", base: "", rsk: "rsc_short", reqs: [{ m: "GET", path: "/rs/contracts" }] }), "key");
  // every other WooCommerce body keeps the default 16 KB
  const note = { m: "POST", path: "/orders/5/notes", body: JSON.stringify({ note: "x".repeat(20 * 1024) }) };
  assert.equal(X.validExt(ext([note])), "body");
  assert.equal(X.extCap(ext([note])), X.EXT_LIMITS.reqs * X.EXT_LIMITS.reqBytes * 2);
  assert.equal(X.extCap(ext([{ m: "GET", path: "/rs/contracts" }])), X.EXT_LIMITS.reqs * X.EXT_LIMITS.reqBytes * 2);
});

test("relay: the contracts push reaches the shop through the whole relay", async () => {
  const body = push(Array.from({ length: 500 }, (_, i) => item({ id: "c" + i, title: "Τίτλος βιβλίου " + i }))).body;
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response("{\"saved\":500,\"skipped\":[]}", { status: 200 }); };
  const req = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: "https://useoros.online", "Content-Type": "application/json", "CF-Connecting-IP": "10.9.0.1" },
    body: JSON.stringify({ op: "ext", p: "woo", host: "shop.example.gr", base: "", rsk: RK, reqs: [{ m: "POST", path: "/rs/contracts", body: JSON.stringify(body) }] }) });
  const res = await handle(req, { ALLOWED_ORIGINS: "https://useoros.online" }, null, Date.now(), f);
  const j = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j));
  assert.equal(j.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://shop.example.gr/wp-json/rs/v1/contracts");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["X-RS-Key"], RK);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(JSON.parse(j.data.res[0].body).saved, 500);
});

test("keys: the contracts key is optional and has its own shape", () => {
  assert.deepEqual(L.checkKeys("woo", { ck: CK, cs: CS }), { ok: true, keys: { ck: CK, cs: CS }, bad: [] });
  assert.deepEqual(L.checkKeys("woo", { ck: CK, cs: CS, rsk: RK }).keys, { ck: CK, cs: CS, rsk: RK });
  assert.deepEqual(L.checkKeys("woo", { ck: CK, cs: CS, rsk: "ck_" + "a".repeat(40) }).bad, ["rsk"]);
  assert.deepEqual(L.checkKeys("woo", { rsk: RK }).bad, ["ck", "cs"]);
  // other platforms keep every key required
  assert.equal(L.checkKeys("brevo", {}).ok, false);
});

test("keys and routes: the contracts routes go to rs/v1 with only the contracts key", () => {
  const both = { ck: CK, cs: CS, rsk: RK }, one = { ck: CK, cs: CS };
  const R = { ck: CK, cs: CS };
  for (const r of [push([item()]), { m: "POST", path: "/rs/contract-requests/17", body: { state: "oros" } },
                   { m: "GET", path: "/rs/contracts" }, { m: "GET", path: "/rs/contract-requests?state=new" }]) {
    assert.deepEqual(L.keysFor("woo", both, [r]), { rsk: RK });
    assert.deepEqual(L.keysFor("woo", one, [r]), {});
    assert.equal(L.rsCall("woo", [r]), "all");
  }
  assert.deepEqual(L.keysFor("woo", both, [{ m: "PUT", path: "/products/5", body: { stock_quantity: 1 } }]), R);
  assert.deepEqual(L.keysFor("woo", both, [{ m: "GET", path: "/rs/balances" }]), R);
  assert.equal(L.rsCall("woo", [{ m: "GET", path: "/rs/contracts" }, { m: "GET", path: "/rs/balances" }]), "mixed");
  assert.equal(L.rsCall("woo", [{ m: "GET", path: "/rs/report" }]), "none");
  assert.equal(L.apiUrl("woo", "https://shop.example.gr", "/rs/contracts"), "https://shop.example.gr/wp-json/rs/v1/contracts");
  assert.equal(L.apiUrl("woo", "https://shop.example.gr", "/rs/contract-requests/17"), "https://shop.example.gr/wp-json/rs/v1/contract-requests/17");
  assert.equal(L.apiUrl("woo", "https://shop.example.gr", "/rs/balances"), "https://shop.example.gr/wp-json/wc/v3/rs/balances");
  assert.deepEqual(L.authHeader("woo", { rsk: RK }), ["X-RS-Key", RK]);
  assert.equal(L.authHeader("woo", R)[0], "Authorization");
  const k = { key: "x" };
  assert.equal(L.keysFor("brevo", k, [{ m: "GET", path: "/account" }]), k);
});

test("renewals (1.14.2): each renewal's day, the end before it and the new end", () => {
  const ok = item({ renewals: [{ on: "2026-11-11", prev_to: "2026-12-31", to: "2029-12-31" }] });
  assert.equal(L.checkReq("woo", push([ok])), "");
  assert.equal(X.checkExtReq("woo", push([ok])), "");
  for (const bad of [[{ on: "2026-11-11", prev_to: "2026-12-31" }], [{ on: "2026-11-11", prev_to: "2026-12-31", to: "x" }],
                     [{ on: "2026-11-11", prev_to: "2026-12-31", to: "2029-12-31", who: "me" }], "2026-11-11",
                     Array.from({ length: 51 }, () => ({ on: "2026-11-11", prev_to: "2026-12-31", to: "2029-12-31" }))]) {
    assert.equal(L.checkReq("woo", push([item({ renewals: bad })])), "body");
    assert.equal(X.checkExtReq("woo", push([item({ renewals: bad })])), "body");
  }
  // CRM sends them from the renew entries of the contract's history
  const d = C.norm({ ver: 1, cust: [{ id: "custanna1", m: 1, name: "Άννα" }], rsl: [{ id: "custanna1", m: 1, n: ["Άννα Π."] }],
    ctr: [{ id: "ctra00001", m: 2, cust: "custanna1", t: "Το νησί", from: "2020-01-01", to: "2029-12-31" }],
    cx: [{ id: "ctra00001", m: 2, h: [{ d: "2026-11-11", k: "renew", v: "2029-12-31", p: "2026-12-31" }, { d: "2026-11-11", k: "note", v: "x" }] }] });
  const row = C.portalPlan(d, "2026-11-11").body.contracts[0];
  assert.deepEqual(row.renewals, [{ on: "2026-11-11", prev_to: "2026-12-31", to: "2029-12-31" }]);
  assert.deepEqual(row.renewed, ["2026-12-31"]);
  assert.equal(L.checkReq("woo", push([row])), "");
});

// ---------- crm/rs.js: what CRM sends and pulls ----------
const SHOP = "shopaaaa1", OTHER = "shopbbbb2";
function crm(extra) {
  return C.norm(Object.assign({
    ver: 1,
    cust: [{ id: "custanna1", m: 1, name: "Άννα" }, { id: "custbob01", m: 1, name: "Bob" }, { id: "custcara1", m: 1, name: "Cara" }, { id: "custdan01", m: 1, name: "Dan" }],
    rsl: [{ id: "custanna1", m: 1, a: SHOP, n: ["Άννα Π.", "Anna P."] }, { id: "custbob01", m: 1, n: ["Bob B."] }, { id: "custdan01", m: 1, a: OTHER, n: ["Dan D."] }],
    ctr: [
      { id: "ctra00001", m: 1, cust: "custanna1", t: "Το νησί", from: "2025-01-01", to: "2027-06-01" },
      { id: "ctra00002", m: 1, cust: "custanna1", t: "E-book", from: "2025-01-01", to: "2026-12-31" },
      { id: "ctra00003", m: 1, cust: "custanna1", t: "Παλιό", from: "2020-01-01", to: "2026-01-01" },
      { id: "ctrb00001", m: 1, cust: "custbob01", t: "Open", from: "2024-01-01" },
      { id: "ctrb00002", m: 1, cust: "custbob01", t: "No start" },
      { id: "ctrc00001", m: 1, cust: "custcara1", t: "Unlinked", from: "2024-01-01" },
      { id: "ctrd00001", m: 1, cust: "custdan01", t: "Other shop", from: "2024-01-01" }
    ]
  }, extra || {}));
}

test("portalPlan: one shop's linked partners, the exact name, open-ended too; left out with a reason", () => {
  const x = C.portalPlan(crm(), "2026-11-11", SHOP, SHOP);
  assert.equal(x.body.v, 1);
  assert.equal(x.body.sent, "2026-11-11");
  assert.deepEqual(x.body.contracts.map((c) => [c.id, c.ben, c.to, c.state]), [
    ["ctra00001", "Anna P.", "2027-06-01", "on"],
    ["ctra00002", "Anna P.", "2026-12-31", "soon"],
    ["ctra00003", "Anna P.", "2026-01-01", "ended"],
    ["ctrb00001", "Bob B.", "", "on"]               // open-ended; a link without a shop counts for the first shop
  ]);
  assert.deepEqual(x.left.map((l) => [l.id, l.why]), [["ctrb00002", "nofrom"], ["ctrc00001", "nolink"]]);
  // what the app builds is what both allowlists let through
  assert.equal(L.checkReq("woo", RS.reqPushCtr(x.body)), "");
  assert.equal(X.checkExtReq("woo", RS.reqPushCtr(x.body)), "");
  assert.deepEqual(C.portalPlan(crm(), "2026-11-11", OTHER, SHOP).body.contracts.map((c) => c.id), ["ctrd00001"]);
  // a title with < > still goes (the allowlist refuses them, so they are taken out)
  const d = crm();
  d.ctr[0].t = "A <b> B";
  const y = C.portalPlan(C.norm(d), "2026-11-11", SHOP, SHOP);
  assert.equal(L.checkReq("woo", RS.reqPushCtr(y.body)), "");
  // deleted contracts and partners stay out; same data, same body
  const g = crm();
  g.tombs.ctra00001 = 9;
  g.tombs.custbob01 = 9;
  assert.deepEqual(C.portalPlan(C.norm(g), "2026-11-11", SHOP, SHOP).body.contracts.map((c) => c.id), ["ctra00002", "ctra00003"]);
  assert.equal(JSON.stringify(C.portalPlan(crm(), "2026-11-11", SHOP, SHOP)), JSON.stringify(C.portalPlan(crm(), "2026-11-11", SHOP, SHOP)));
});

test("parseSaved and parseRequests read only what they expect", () => {
  assert.deepEqual(RS.parseSaved({ saved: 3, skipped: [{ id: "x1", why: "unknown_beneficiary" }, { id: "x2", why: "<b>" }, null] }),
    { saved: 3, skipped: [{ id: "x1", why: "unknown_beneficiary" }, { id: "x2", why: "bad_item" }] });
  assert.equal(RS.parseSaved({ code: "rest_no_route" }), null);
  assert.equal(RS.parseSaved(null), null);
  const r = RS.parseRequests({ requests: [
    { id: 17, contract_id: "ctra00001", ben: "Άννα Π.", title: "Το νησί", at: "2026-11-10T09:00:00+02:00", note: "Γεια\r\nσας\u0007", state: "new" },
    { id: "bad id", contract_id: "x" },
    { id: "rq_2", contract_id: 5, ben: "Bob B.", title: "x".repeat(300), at: "nope", note: "n".repeat(900), state: "weird" }
  ] });
  assert.deepEqual(r[0], { id: "17", ctr: "ctra00001", ben: "Άννα Π.", title: "Το νησί", at: Date.parse("2026-11-10T07:00:00Z"), note: "Γεια\nσας", state: "new" });
  assert.equal(r.length, 2);
  assert.equal(r[1].ctr, "");
  assert.equal(r[1].title.length, 200);
  assert.equal(r[1].note.length, 500);
  assert.equal(r[1].at, 0);
  assert.equal(r[1].state, "new");
  assert.equal(RS.parseRequests({}), null);
  assert.deepEqual(RS.REQ_RQ_NEW, { m: "GET", path: "/rs/contract-requests?state=new" });
  assert.equal(L.checkReq("woo", RS.REQ_RQ_NEW), "");
  assert.equal(L.checkReq("woo", RS.REQ_RQ_OROS), "");
  assert.equal(L.checkReq("woo", RS.REQ_CTR), "");
  assert.equal(L.checkReq("woo", RS.reqMark("17", "oros")), "");
  assert.equal(L.checkReq("woo", RS.reqMark("17", "closed")), "");
});

test("importPlan: by contract, then by beneficiary name; same ids everywhere; known ones not again", () => {
  const reqs = RS.parseRequests({ requests: [
    { id: 1, contract_id: "ctra00002", ben: "Anna P.", title: "E-book", at: "2026-11-10T09:00:00Z", note: "", state: "new" },
    { id: 2, contract_id: "gone", ben: "Bob B.", title: "Open", at: "2026-11-10T09:00:00Z", note: "", state: "new" },
    { id: 3, contract_id: "gone", ben: "Nobody", title: "?", at: "2026-11-10T09:00:00Z", note: "", state: "new" },
    { id: 4, contract_id: "", ben: "Dan D.", title: "x", at: "2026-11-10T09:00:00Z", note: "", state: "new" }
  ] });
  const x = RS.importPlan(crm(), SHOP, SHOP, reqs);
  assert.deepEqual(x.plan.map((p) => [p.req.id, p.cust.id, p.ctr ? p.ctr.id : "", p.have]),
    [["1", "custanna1", "ctra00002", false], ["2", "custbob01", "", false]]);
  // Nobody is unknown; Dan is another shop's beneficiary
  assert.deepEqual(x.left.map((q) => q.id), ["3", "4"]);
  const ids = RS.rqIds(SHOP, "1");
  assert.deepEqual(ids, RS.rqIds(SHOP, "1"));
  assert.notDeepEqual(ids, RS.rqIds(OTHER, "1"));
  assert.match(ids.fup, C.ID_RE);
  assert.match(ids.act, C.ID_RE);
  // once its follow-up is in CRM (or was deleted), a request is not imported again
  const d = crm({ fups: [{ id: ids.fup, m: 2, cust: "custanna1", d: "2026-11-11", text: "Renewal request: E-book" }] });
  assert.equal(C.byId(d.fups, ids.fup).id, ids.fup);
  assert.equal(RS.importPlan(d, SHOP, SHOP, reqs).plan[0].have, true);
  const d2 = crm();
  d2.tombs[ids.fup] = 5;
  assert.equal(RS.importPlan(d2, SHOP, SHOP, reqs).plan[0].have, true);
});

test("closeList: a request in orOS closes when its follow-up is done or deleted", () => {
  const a = RS.rqIds(SHOP, "1"), b = RS.rqIds(SHOP, "2"), c = RS.rqIds(SHOP, "3");
  const d = crm({ fups: [
    { id: a.fup, m: 2, cust: "custanna1", d: "2026-11-11", text: "x", done: "2026-11-11" },
    { id: b.fup, m: 2, cust: "custanna1", d: "2026-11-11", text: "y" }
  ] });
  d.tombs[c.fup] = 7;
  const reqs = ["1", "2", "3", "4"].map((id) => ({ id, state: "oros" })).concat([{ id: "1", state: "new" }]);
  assert.deepEqual(RS.closeList(C.norm(d), SHOP, reqs), ["1", "3"]);
});
