// Connected services wave 4C: Invoice Ninja (the person's own install or
// invoicing.co) → CRM (clients) and Budget (payments). The account (a
// site + one token), the allowlist (app and relay copies), the relay
// call with its extra header, links/crm.js and links/pay.js for it.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const M = require("../links/crm.js");
const P = require("../links/pay.js");
const C = require("../crm/core.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

const TOKEN = "Ab12".repeat(16);

test("account: a site and a token; addresses as pasted", () => {
  const a = L.normAcct({ id: "acct000001", m: 5, p: "ininja", name: "IN", site: "https://invoicing.co/api/v1/", ks: 0 });
  assert.equal(a.site, "https://invoicing.co");
  assert.equal(L.normAcct({ id: "acct000001", m: 5, p: "ininja", name: "IN", site: "", ks: 0 }), null);
  assert.equal(L.normSite("http://ninja.example.gr"), null);
  assert.deepEqual(L.PLATFORMS.ininja.apps, ["crm", "budget"]);
  assert.equal(L.checkKeys("ininja", { key: TOKEN }).ok, true);
  assert.equal(L.checkKeys("ininja", { key: "short" }).ok, false);
  assert.equal(L.apiUrl("ininja", { site: "https://ninja.example.gr/billing" }, "/clients?per_page=1"), "https://ninja.example.gr/billing/api/v1/clients?per_page=1");
  assert.deepEqual(L.authHeader("ininja", { key: TOKEN }), ["X-API-TOKEN", TOKEN]);
  assert.deepEqual(L.extraHeaders("ininja"), { "X-Requested-With": "XMLHttpRequest" });
  assert.deepEqual(L.extraHeaders("woo"), {});
  assert.equal(L.checkReq("ininja", { m: "GET", path: L.PLATFORMS.ininja.probe }), "");
});

const CASES = [
  ["ininja", { m: "GET", path: "/statics" }, ""],
  ["ininja", { m: "GET", path: "/clients?per_page=100&page=3&status=active" }, ""],
  ["ininja", { m: "GET", path: "/clients?status=deleted" }, "query"],
  ["ininja", { m: "GET", path: "/clients?include=documents" }, "query"],
  ["ininja", { m: "GET", path: "/payments?per_page=100&page=1" }, ""],
  ["ininja", { m: "GET", path: "/invoices" }, "path"],
  ["ininja", { m: "GET", path: "/clients/abc" }, "path"],
  ["ininja", { m: "POST", path: "/clients", body: { name: "x" } }, "path"],
  ["ininja", { m: "PUT", path: "/payments", body: { amount: 1 } }, "path"]
];
test("allowlist: one case list, app and relay agree", () => {
  for (const [p, r, want] of CASES) {
    assert.equal(L.checkReq(p, r), want, "app " + r.m + " " + r.path);
    assert.equal(X.checkExtReq(p, r), want, "relay " + r.m + " " + r.path);
  }
});

test("relay: the person's host, base, token and the extra header; no key echoed", async () => {
  const b = (o) => Object.assign({ op: "ext", p: "ininja", host: "ninja.example.gr", base: "/billing", key: TOKEN, reqs: [{ m: "GET", path: "/statics" }] }, o || {});
  assert.equal(X.validExt(b()), "");
  assert.equal(X.validExt(b({ host: "localhost" })), "host");
  assert.equal(X.validExt(b({ host: "10.0.0.1" })), "host");
  assert.equal(X.validExt(b({ base: "/../x" })), "base");
  assert.equal(X.validExt(b({ key: "x" })), "key");
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); };
  const ORIGIN = "https://useoros.online";
  const req = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.6.0.9" },
    body: JSON.stringify(b({ reqs: [P.inReq("payments", 2)] })) });
  const res = await handle(req, { ALLOWED_ORIGINS: ORIGIN }, null, Date.now(), f);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(calls[0].url, "https://ninja.example.gr/billing/api/v1/payments?per_page=100&page=2");
  assert.equal(calls[0].init.headers["X-API-TOKEN"], TOKEN);
  assert.equal(calls[0].init.headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(JSON.stringify(json).indexOf(TOKEN), -1);
});

test("clients → CRM: contacts as people, VAT ID, pages; matched by VAT ID", () => {
  for (const at of ["", "2"]) assert.equal(L.checkReq("ininja", M.req("ininja", "orgs", at)), "");
  const r = M.read("ininja", "orgs", { data: [
    { id: "Wpmbk5ezJn", name: "Άλφα ΑΕ", vat_number: "EL 094019245", phone: "210", website: "alfa.gr", address1: "Οδός 1", city: "Αθήνα", postal_code: "10431",
      contacts: [{ id: "c1", first_name: "Μαρία", last_name: "Κ.", email: "M@alfa.gr", phone: "69" }] },
    { id: "Xy", name: "", contacts: [{ id: "c2", first_name: "Solo", email: "solo@x.gr" }] },
    { id: "Del", name: "Gone", is_deleted: true }],
    meta: { pagination: { current_page: 1, total_pages: 3 } } });
  assert.equal(r.next, "2");
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].afm, "094019245");
  assert.equal(r.items[1].name, "Solo");
  const crm = C.empty();
  crm.cust.push({ id: "local000001", m: 1, name: "Παλιό όνομα", kind: "co", st: "active", afm: "094019245" });
  const pl = M.plan(C, C.norm(crm), { orgs: r.items }, { p: "ininja", acct: "acct000001", src: "Invoice Ninja", now: 1, upd: true, revive: false });
  assert.equal(pl.here, 1);                                  // same ΑΦΜ: used, not added
  assert.equal(pl.cust.add.length, 1);
  assert.deepEqual(pl.cust.add[0].people, [{ c: "", n: "Solo", email: "solo@x.gr" }]);
  // first import of Άλφα into an empty CRM: people and ΑΦΜ come in
  const p2 = M.plan(C, C.empty(), { orgs: r.items }, { p: "ininja", acct: "acct000001", src: "Invoice Ninja", now: 1, upd: true, revive: false });
  const alfa = p2.cust.add.find((c) => c.name === "Άλφα ΑΕ");
  assert.equal(alfa.afm, "094019245");
  assert.equal(alfa.addr, "Οδός 1, 10431 Αθήνα");
  assert.deepEqual(alfa.people, [{ c: "", n: "Μαρία Κ.", phone: "69", email: "m@alfa.gr" }]);
});

test("payments → Budget: net of refunds, from a date, currency by /statics, ids per account", () => {
  const curs = P.inCurrencies({ currencies: [{ id: "1", code: "USD" }, { id: "3", code: "EUR" }, { id: "x", code: "bad" }] });
  assert.deepEqual(curs, { 1: "USD", 3: "EUR" });
  const r = P.inRead({ data: [
    { id: "p1", amount: 120.5, refunded: 20, date: "2026-10-01", status_id: "5", currency_id: "3", number: "0007", transaction_reference: "Bank" },
    { id: "p2", amount: 50, refunded: 50, date: "2026-10-02", status_id: "6", currency_id: "3" },
    { id: "p3", amount: 70, refunded: 0, date: "2026-10-03", status_id: "1", currency_id: "3" },
    { id: "p4", amount: 80, refunded: 0, date: "2026-08-01", status_id: "4", currency_id: "3" },
    { id: "p5", amount: 90, refunded: 0, date: "2026-10-04", status_id: "4", currency_id: "1" },
    { id: "p6", amount: 10, refunded: 0, date: "2026-10-04", status_id: "4", currency_id: "3", is_deleted: true }],
    meta: { pagination: { current_page: 2, total_pages: 2 } } }, curs, "2026-09-01");
  assert.equal(r.next, 0);
  assert.deepEqual(r.items.map((x) => [x.xid, x.amount, x.cur]), [["p1", 10050, "EUR"], ["p5", 9000, "USD"]]);
  const pl = P.plan({ tx: [], tombs: {}, cur: "EUR" }, r.items, { p: "ininja", acct: "acct000002", src: "Invoice Ninja", feeNote: "fee", catIn: "i-free", catOut: "o-bills", ac: "" });
  assert.equal(pl.add.length, 1);
  assert.deepEqual(pl.add[0], { id: L.extId("ininja", "acct000002", "txn", "p1"), d: "2026-10-01", a: 10050, k: "i", c: "i-free", n: "Invoice Ninja · #0007 · Bank" });
  assert.equal(pl.otherCur, 1);
  assert.equal(L.checkReq("ininja", P.inReq("statics")), "");
  assert.equal(L.checkReq("ininja", P.inReq("payments", 7)), "");
});
