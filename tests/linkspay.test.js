// Connected services wave 4B: Stripe → Budget. The account (restricted
// keys only), the request allowlist (app and relay copies, one case
// list), the relay call, links/pay.js (requests, answers, the plan).
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const P = require("../links/pay.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

// made up at run time (a literal looks like a real key to secret scanners)
const RK = ["rk", "test", "51Abc" + "x".repeat(40)].join("_");
const SK = ["sk", "live", "51Abc" + "x".repeat(40)].join("_");

test("account: restricted keys only, fixed host, relay only", () => {
  const a = L.normAcct({ id: "acct000001", m: 5, p: "stripe", name: "S", site: "x", ks: 0 });
  assert.equal(a.site, "");
  assert.deepEqual(L.PLATFORMS.stripe.apps, ["budget"]);
  assert.equal(L.PLATFORMS.stripe.relayOnly, true);
  assert.equal(L.checkKeys("stripe", { key: RK }).ok, true);
  assert.equal(L.checkKeys("stripe", { key: SK }).ok, false);
  assert.equal(L.checkKeys("stripe", { key: RK.replace("rk_", "pk_") }).ok, false);
  assert.equal(L.apiUrl("stripe", {}, "/balance"), "https://api.stripe.com/v1/balance");
  assert.deepEqual(L.authHeader("stripe", { key: RK }), ["Authorization", "Bearer " + RK]);
});

const CASES = [
  ["stripe", { m: "GET", path: "/balance" }, ""],
  ["stripe", { m: "GET", path: "/balance_transactions?limit=100" }, ""],
  ["stripe", { m: "GET", path: "/balance_transactions?limit=100&created[gte]=1760000000&starting_after=txn_1AbC" }, ""],
  ["stripe", { m: "GET", path: "/balance_transactions?created[lt]=1760000000" }, ""],
  ["stripe", { m: "GET", path: "/balance_transactions?limit=101" }, "query"],
  ["stripe", { m: "GET", path: "/balance_transactions?starting_after=ch_1AbC" }, "query"],
  ["stripe", { m: "GET", path: "/balance_transactions?expand[]=data.source" }, "query"],
  ["stripe", { m: "GET", path: "/customers" }, "path"],
  ["stripe", { m: "GET", path: "/charges" }, "path"],
  ["stripe", { m: "POST", path: "/refunds", body: { charge: "ch_1" } }, "path"],
  ["stripe", { m: "POST", path: "/balance", body: { a: 1 } }, "path"]
];

test("allowlist: one case list, app and relay agree", () => {
  for (const [p, r, want] of CASES) {
    assert.equal(L.checkReq(p, r), want, "app " + r.m + " " + r.path);
    assert.equal(X.checkExtReq(p, r), want, "relay " + r.m + " " + r.path);
  }
});

test("relay: Stripe's host and auth, no host from the caller, key never echoed", async () => {
  const b = (key, o) => Object.assign({ op: "ext", p: "stripe", key, reqs: [{ m: "GET", path: "/balance" }] }, o || {});
  assert.equal(X.validExt(b(RK)), "");
  assert.equal(X.validExt(b(SK)), "key");
  assert.equal(X.validExt(b(RK, { host: "evil.example" })), "host");
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); };
  const ORIGIN = "https://useoros.online";
  const req = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.7.0.9" },
    body: JSON.stringify({ op: "ext", p: "stripe", key: RK, reqs: [P.req(1760000000, "txn_9")] }) });
  const res = await handle(req, { ALLOWED_ORIGINS: ORIGIN }, null, Date.now(), f);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(calls[0].url, "https://api.stripe.com/v1/balance_transactions?limit=100&created[gte]=1760000000&starting_after=txn_9");
  assert.equal(calls[0].init.headers.Authorization, "Bearer " + RK);
  assert.equal(JSON.stringify(json).indexOf(RK), -1);
});

test("requests pass the allowlist; answers read; pages follow has_more", () => {
  assert.equal(L.checkReq("stripe", P.req(0, "")), "");
  assert.equal(L.checkReq("stripe", P.req(1760000000, "txn_1AbC")), "");
  const r = P.read({ data: [
    { id: "txn_1", type: "charge", amount: 10000, fee: 320, currency: "eur", created: 1760000000, description: "Order #12" },
    { id: "bad", type: "charge", amount: 1, currency: "eur", created: 1 },
    { id: "txn_2", type: "payout", amount: -9680, fee: 0, currency: "eur", created: 1760086400 }], has_more: true });
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0], { xid: "txn_1", type: "charge", amount: 10000, fee: 320, cur: "EUR", at: 1760000000, desc: "Order #12" });
  assert.equal(r.next, "txn_2");
  assert.equal(P.read({ data: [], has_more: false }).next, "");
});

const CTX = { acct: "acct000001", src: "Stripe", feeNote: "Stripe fee", catIn: "i-free", catOut: "o-bills", ac: "" };
function items() {
  return P.read({ data: [
    { id: "txn_c", type: "charge", amount: 10000, fee: 320, currency: "eur", created: 1760000000, description: "Order #12" },
    { id: "txn_r", type: "refund", amount: -2500, fee: 0, currency: "eur", created: 1760000000, description: null },
    { id: "txn_f", type: "stripe_fee", amount: -150, fee: 0, currency: "eur", created: 1760000000, description: "Billing" },
    { id: "txn_d", type: "adjustment", amount: 700, fee: 0, currency: "eur", created: 1760000000 },
    { id: "txn_p", type: "payout", amount: -9000, fee: 0, currency: "eur", created: 1760000000 },
    { id: "txn_u", type: "charge", amount: 5000, fee: 175, currency: "usd", created: 1760000000 },
    { id: "txn_j", type: "charge", amount: 1200, fee: 0, currency: "jpy", created: 1760000000 }] }).items;
}

test("plan: income gross, fee and refunds as expenses, payouts and other currencies out", () => {
  const pl = P.plan({ tx: [], tombs: {}, cur: "EUR" }, items(), CTX);
  const row = (kind, x) => pl.add.find((e) => e.id === L.extId("stripe", "acct000001", kind, x));
  assert.deepEqual(Object.assign({}, row("txn", "txn_c"), { d: "" }), { id: L.extId("stripe", "acct000001", "txn", "txn_c"), d: "", a: 10000, k: "i", c: "i-free", n: "Order #12" });
  assert.equal(row("fee", "txn_c").a, 320);
  assert.equal(row("fee", "txn_c").k, "o");
  assert.equal(row("fee", "txn_c").n, "Stripe fee · Order #12");
  assert.equal(row("txn", "txn_r").a, 2500);
  assert.equal(row("txn", "txn_r").n, "Stripe · refund");
  assert.equal(row("txn", "txn_f").k, "o");
  assert.equal(row("txn", "txn_d").k, "i");
  assert.equal(pl.add.length, 5);
  assert.equal(pl.skip, 1);
  assert.equal(pl.otherCur, 2);
  assert.match(pl.add[0].d, /^\d{4}-\d{2}-\d{2}$/);
  // JPY is counted in whole yen by Stripe
  const jp = P.plan({ tx: [], tombs: {}, cur: "JPY" }, items(), CTX);
  assert.equal(jp.add[0].a, 120000);
});

test("plan: a second import adds nothing; deleted here stays deleted; account set", () => {
  const first = P.plan({ tx: [], tombs: {}, cur: "EUR" }, items(), Object.assign({}, CTX, { ac: "bank1" }));
  assert.ok(first.add.every((e) => e.ac === "bank1"));
  const tx = first.add.slice(1).map((e) => Object.assign({ m: 1 }, e));
  const tombs = { ["tx:" + first.add[0].id]: 5 };
  const again = P.plan({ tx, tombs, cur: "EUR" }, items(), CTX);
  assert.equal(again.add.length, 0);
  assert.equal(again.same, 4);
  assert.equal(again.gone, 1);
});
