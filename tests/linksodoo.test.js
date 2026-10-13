// Connected services wave 4D: Odoo (the person's own install or
// <name>.odoo.com, the JSON-2 API) → CRM (contacts and opportunities).
// The account (a site, an optional database, one API key), the
// allowlist (app and relay copies: only search_read with fixed bodies),
// the relay call with its database header, links/crm.js for it.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const M = require("../links/crm.js");
const C = require("../crm/core.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

// made up at run time (a literal looks like a real key to secret scanners)
const KEY = ["a1b2c3d4", "e5f6a7b8", "c9d0e1f2", "a3b4c5d6", "e7f8a9b0"].join("");

test("account: a site, an optional database, one key; addresses as pasted", () => {
  const a = L.normAcct({ id: "acct000001", m: 5, p: "odoo", name: "O", site: "https://acme.odoo.com/odoo/contacts", db: "acme-prod", ks: 0 });
  assert.equal(a.site, "https://acme.odoo.com");
  assert.equal(a.db, "acme-prod");
  assert.equal(L.normAcct({ id: "acct000001", m: 5, p: "odoo", name: "O", site: "erp.example.gr/web#action=1", ks: 0 }), null);
  assert.equal(L.normAcct({ id: "acct000001", m: 5, p: "odoo", name: "O", site: "erp.example.gr/web", ks: 0 }).site, "https://erp.example.gr");
  assert.equal(L.normAcct({ id: "acct000001", m: 5, p: "odoo", name: "O", site: "erp.example.gr/json/2", db: "bad db!", ks: 0 }).db, "");
  // other platforms keep their bytes: no db field
  assert.equal("db" in L.normAcct({ id: "acct000001", m: 5, p: "ininja", name: "I", site: "invoicing.co", db: "x", ks: 0 }), false);
  assert.deepEqual(L.PLATFORMS.odoo.apps, ["crm"]);
  assert.equal(L.checkKeys("odoo", { key: KEY }).ok, true);
  assert.equal(L.checkKeys("odoo", { key: "short" }).ok, false);
  assert.equal(L.apiUrl("odoo", { site: "https://erp.example.gr" }, "/res.partner/search_read"), "https://erp.example.gr/json/2/res.partner/search_read");
  assert.deepEqual(L.authHeader("odoo", { key: KEY }), ["Authorization", "Bearer " + KEY]);
  assert.deepEqual(L.extraHeaders("odoo", { db: "acme" }), { "X-Odoo-Database": "acme" });
  assert.deepEqual(L.extraHeaders("odoo", { db: "" }), {});
  assert.deepEqual(L.probeReq("ininja"), { m: "GET", path: "/clients?per_page=1" });
  assert.equal(L.checkReq("odoo", L.probeReq("odoo")), "");
});

const PT = M.req("odoo", "orgs", "").body, LD = M.req("odoo", "deals", "400").body;
const CASES = [
  ["odoo", { m: "POST", path: "/res.company/search_read", body: { fields: ["partner_id"], limit: 1 } }, ""],
  ["odoo", { m: "POST", path: "/res.partner/search_read", body: PT }, ""],
  ["odoo", { m: "POST", path: "/crm.lead/search_read", body: LD }, ""],
  ["odoo", { m: "POST", path: "/res.partner/search_read", body: Object.assign({}, PT, { fields: PT.fields.concat(["comment"]) }) }, "body"],
  ["odoo", { m: "POST", path: "/res.partner/search_read", body: Object.assign({}, PT, { domain: [] }) }, "body"],
  ["odoo", { m: "POST", path: "/res.partner/search_read", body: Object.assign({}, PT, { limit: 5000 }) }, "body"],
  ["odoo", { m: "POST", path: "/res.partner/search_read", body: Object.assign({}, PT, { context: { active_test: false } }) }, "body"],
  ["odoo", { m: "POST", path: "/res.partner/search_read", body: { limit: 5 } }, "body"],
  ["odoo", { m: "POST", path: "/crm.lead/search_read", body: { domain: LD.domain, limit: 5 } }, "body"],
  ["odoo", { m: "POST", path: "/res.company/search_read", body: { limit: 5 } }, "body"],
  ["odoo", { m: "POST", path: "/res.users/search_read", body: { fields: ["login"] } }, "path"],
  ["odoo", { m: "POST", path: "/res.partner/write", body: { ids: [1], vals: { name: "x" } } }, "path"],
  ["odoo", { m: "POST", path: "/res.partner/unlink", body: { ids: [1] } }, "path"],
  ["odoo", { m: "GET", path: "/res.partner/search_read" }, "path"]
];
test("allowlist: one case list, app and relay agree", () => {
  for (const [p, r, want] of CASES) {
    assert.equal(L.checkReq(p, r), want, "app " + r.m + " " + r.path);
    assert.equal(X.checkExtReq(p, r), want, "relay " + r.m + " " + r.path);
  }
});

test("relay: the person's host, the database header, reads side by side; no key echoed", async () => {
  const b = (o) => Object.assign({ op: "ext", p: "odoo", host: "erp.example.gr", base: "", key: KEY, reqs: [L.probeReq("odoo")] }, o || {});
  const asText = (r) => ({ m: r.m, path: r.path, body: JSON.stringify(r.body) });
  assert.equal(X.validExt(b({ reqs: [asText(L.probeReq("odoo"))] })), "");
  assert.equal(X.validExt(b({ reqs: [asText(L.probeReq("odoo"))], db: "acme" })), "");
  assert.equal(X.validExt(b({ reqs: [asText(L.probeReq("odoo"))], db: "../x" })), "db");
  assert.equal(X.validExt(b({ reqs: [asText(L.probeReq("odoo"))], host: "localhost" })), "host");
  // a database name only for Odoo
  assert.equal(X.validExt({ op: "ext", p: "ininja", host: "ninja.example.gr", base: "", key: "Ab12".repeat(16), db: "x", reqs: [{ m: "GET", path: "/statics" }] }), "db");
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response("[]", { status: 200 }); };
  const ORIGIN = "https://useoros.online";
  const req = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.6.0.10" },
    body: JSON.stringify(b({ db: "acme", reqs: [asText(M.req("odoo", "orgs", "")), asText(M.req("odoo", "deals", ""))] })) });
  const res = await handle(req, { ALLOWED_ORIGINS: ORIGIN }, null, Date.now(), f);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://erp.example.gr/json/2/res.partner/search_read");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer " + KEY);
  assert.equal(calls[0].init.headers["X-Odoo-Database"], "acme");
  assert.deepEqual(JSON.parse(calls[0].init.body), M.req("odoo", "orgs", "").body);
  assert.equal(JSON.stringify(json).indexOf(KEY), -1);
});

const PARTNERS = [
  { id: 1, name: "My Company", is_company: true, parent_id: false, type: "contact", email: false, phone: false, website: false, street: false, street2: false, zip: false, city: false, country_id: false, vat: "EL999999999", function: false },
  { id: 3, name: "Staff Member", is_company: false, parent_id: [1, "My Company"], type: "contact" },
  { id: 10, name: "Άλφα ΑΕ", is_company: true, parent_id: false, type: "contact", email: "Info@alfa.gr", phone: "210 1", website: "alfa.gr", street: "Οδός 1", street2: false, zip: "10431", city: "Αθήνα", country_id: [85, "Greece"], vat: "EL094019245", function: false },
  { id: 11, name: "Μαρία Κ.", is_company: false, parent_id: [10, "Άλφα ΑΕ"], type: "contact", email: "maria@alfa.gr", phone: "69", function: "CEO" },
  { id: 12, name: "Άλφα, Τιμολόγηση", is_company: false, parent_id: [10, "Άλφα ΑΕ"], type: "invoice", email: "bill@alfa.gr" },
  { id: 20, name: "Solo Πελάτης", is_company: false, parent_id: false, type: "contact", email: "solo@x.gr", phone: false, vat: false },
  { id: 30, name: "Βήτα ΙΚΕ", is_company: true, parent_id: false, type: "contact", vat: "801234567" }
];
const LEADS = [
  { id: 100, name: "Νέο site", partner_id: [11, "Άλφα ΑΕ, Μαρία Κ."], expected_revenue: 2500, probability: 70, active: true, date_deadline: "2026-11-30", date_closed: false, lost_reason_id: false, company_currency: [1, "EUR"] },
  { id: 101, name: "Συντήρηση", partner_id: [20, "Solo Πελάτης"], expected_revenue: 900, probability: 100, active: true, date_deadline: false, date_closed: "2026-10-01 10:00:00", lost_reason_id: false, company_currency: [1, "EUR"] },
  { id: 102, name: "Χαμένο", partner_id: [30, "Βήτα ΙΚΕ"], expected_revenue: 400, probability: 0, active: false, date_deadline: false, date_closed: "2026-09-10 09:00:00", lost_reason_id: [2, "Πολύ ακριβό"], company_currency: [1, "EUR"] },
  { id: 103, name: "Χωρίς πελάτη", partner_id: false, expected_revenue: 0, probability: 10, active: true, company_currency: [1, "EUR"] }
];

test("contacts and opportunities → CRM: companies with people, own company out, deals by state; pages by offset", () => {
  const own = M.read("odoo", "own", [{ id: 1, partner_id: [1, "My Company"] }], "");
  assert.deepEqual(own, { items: [{ xid: "1" }], next: "" });
  const full = Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i, name: "P" + i, is_company: false, parent_id: false, type: "contact" }));
  assert.equal(M.read("odoo", "orgs", full, "200").next, "400");
  assert.equal(M.read("odoo", "orgs", PARTNERS, "200").next, "");
  for (const at of ["", "200"]) for (const k of M.KINDS.odoo) assert.equal(L.checkReq("odoo", M.req("odoo", k, at)), "", k + " " + at);
  const got = { own: own.items, orgs: M.read("odoo", "orgs", PARTNERS, "").items, deals: M.read("odoo", "deals", LEADS, "").items };
  const pl = M.plan(C, C.empty(), got, { p: "odoo", acct: "acct000001", src: "Odoo", now: 1, upd: true, revive: false });
  const names = pl.cust.add.map((c) => c.name).sort();
  assert.deepEqual(names, ["Solo Πελάτης", "Άλφα ΑΕ", "Βήτα ΙΚΕ"].sort());
  const alfa = pl.cust.add.find((c) => c.name === "Άλφα ΑΕ");
  assert.equal(alfa.afm, "094019245");
  assert.equal(alfa.web, "https://alfa.gr");
  assert.equal(alfa.email, "info@alfa.gr");
  assert.equal(alfa.addr, "Οδός 1, 10431 Αθήνα");
  assert.equal(alfa.country, "Greece");
  assert.deepEqual(alfa.people, [{ c: "", n: "Μαρία Κ.", role: "CEO", phone: "69", email: "maria@alfa.gr" }]);
  assert.equal(pl.cust.add.find((c) => c.name === "Solo Πελάτης").st, "active");     // a won deal
  const deal = (t) => pl.deals.add.find((d) => d.title === t);
  assert.equal(deal("Νέο site").cust, alfa.id);                // a contact's deal belongs to the company
  assert.equal(deal("Νέο site").stage, "nego");
  assert.equal(deal("Νέο site").val, 250000);
  assert.equal(deal("Νέο site").close, "2026-11-30");
  assert.equal(deal("Συντήρηση").stage, "won");
  assert.equal(deal("Συντήρηση").cd, "2026-10-01");
  assert.equal(deal("Χαμένο").stage, "lost");
  assert.equal(deal("Χαμένο").why, "Πολύ ακριβό");
  assert.equal(pl.noCust, 1);
  // a customer already here with the same ΑΦΜ is used
  const crm = C.empty();
  crm.cust.push({ id: "local000001", m: 1, name: "Άλλο όνομα", kind: "co", st: "active", afm: "801234567" });
  const p2 = M.plan(C, C.norm(crm), got, { p: "odoo", acct: "acct000001", src: "Odoo", now: 1, upd: true, revive: false });
  assert.equal(p2.here, 1);
  assert.equal(p2.deals.add.find((d) => d.title === "Χαμένο").cust, "local000001");
});
