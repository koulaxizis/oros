// Connected services wave 4: CRM platforms (HubSpot, Pipedrive → CRM).
// The accounts, the request allowlist (app and relay copies, one case
// list), the relay call to each fixed host, links/crm.js (requests,
// answers, the import plan) and that CRM keeps its own fields.
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
const HS_KEY = ["pat", "eu1", "0123abcd-4567-89ef-0123-456789abcdef"].join("-");
const PD_KEY = "0123456789abcdef".repeat(3).slice(0, 40);

test("accounts: fixed hosts, key shapes, auth", () => {
  for (const p of ["hubspot", "pdrive"]) {
    const a = L.normAcct({ id: "acct000001", m: 5, p, name: "N", site: "x", ks: 0 });
    assert.equal(a.site, "", p);
    assert.deepEqual(L.PLATFORMS[p].apps, ["crm"]);
    assert.equal(L.checkReq(p, { m: "GET", path: L.PLATFORMS[p].probe }), "", p + " probe");
  }
  assert.equal(L.checkKeys("hubspot", { key: HS_KEY }).ok, true);
  assert.equal(L.checkKeys("hubspot", { key: "0123abcd-4567-89ef-0123-456789abcdef" }).ok, false);
  assert.equal(L.checkKeys("pdrive", { key: PD_KEY }).ok, true);
  assert.equal(L.checkKeys("pdrive", { key: PD_KEY.slice(1) }).ok, false);
  assert.equal(L.apiUrl("hubspot", {}, "/crm/v3/pipelines/deals"), "https://api.hubapi.com/crm/v3/pipelines/deals");
  assert.equal(L.apiUrl("pdrive", {}, "/stages?limit=1"), "https://api.pipedrive.com/api/v2/stages?limit=1");
  assert.deepEqual(L.authHeader("hubspot", { key: HS_KEY }), ["Authorization", "Bearer " + HS_KEY]);
  assert.deepEqual(L.authHeader("pdrive", { key: PD_KEY }), ["x-api-token", PD_KEY]);
  assert.equal(L.PLATFORMS.hubspot.relayOnly, true);
});

const HS_CO = "/crm/v3/objects/companies?limit=100&properties=name,domain,phone,address,city,zip,country,industry";
const CASES = [
  ["hubspot", { m: "GET", path: "/crm/v3/pipelines/deals" }, ""],
  ["hubspot", { m: "GET", path: HS_CO }, ""],
  ["hubspot", { m: "GET", path: HS_CO + "&after=MTAw" }, ""],
  ["hubspot", { m: "GET", path: "/crm/v3/objects/companies?limit=101" }, "query"],
  ["hubspot", { m: "GET", path: "/crm/v3/objects/companies?properties=name,hs_secret" }, "query"],
  ["hubspot", { m: "GET", path: "/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,email,phone,jobtitle&associations=companies" }, ""],
  ["hubspot", { m: "GET", path: "/crm/v3/objects/contacts?associations=deals" }, "query"],
  ["hubspot", { m: "GET", path: "/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage,pipeline,closedate,deal_currency_code,closed_lost_reason&associations=companies,contacts" }, ""],
  ["hubspot", { m: "GET", path: "/crm/v3/objects/tickets" }, "path"],
  ["hubspot", { m: "GET", path: "/crm/v3/objects/contacts/123" }, "path"],
  ["hubspot", { m: "POST", path: "/crm/v3/objects/contacts", body: { properties: { email: "a@b.gr" } } }, "path"],
  ["hubspot", { m: "GET", path: "/crm/v3/objects/companies?after=a%2Fb" }, "query"],
  ["pdrive", { m: "GET", path: "/stages?limit=500" }, ""],
  ["pdrive", { m: "GET", path: "/organizations?limit=500&cursor=eyJpZCI6MX0" }, ""],
  ["pdrive", { m: "GET", path: "/persons?limit=500&cursor=ab%2Bc%2Fd%3D%3D" }, ""],
  ["pdrive", { m: "GET", path: "/persons?cursor=ab%2Ec" }, "path"],
  ["pdrive", { m: "GET", path: "/persons?cursor=ab%2fc" }, "path"],
  ["pdrive", { m: "GET", path: "/persons?limit=501" }, "query"],
  ["pdrive", { m: "GET", path: "/deals?limit=500&status=open,won,lost" }, ""],
  ["pdrive", { m: "GET", path: "/deals?status=deleted" }, "query"],
  ["pdrive", { m: "GET", path: "/activities?limit=500&done=false" }, ""],
  ["pdrive", { m: "GET", path: "/activities?done=maybe" }, "query"],
  ["pdrive", { m: "GET", path: "/users" }, "path"],
  ["pdrive", { m: "PUT", path: "/deals", body: { status: "won" } }, "path"],
  ["pdrive", { m: "GET", path: "/persons/%2E%2E/users" }, "path"],
  // the %2B / %2F / %3D allowance is for these cursors only
  ["woo", { m: "GET", path: "/products?status=a%2Fb" }, "query"],
  ["mlite", { m: "GET", path: "/groups/1/subscribers?cursor=a%2Bb" }, "query"]
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
let ip = 60;
async function relay(body, f) {
  const r = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.8.0." + (ip++ % 250) }, body: JSON.stringify(body) });
  const res = await handle(r, ENV, null, Date.now(), f);
  return { status: res.status, json: await res.json() };
}
function mock() {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); };
  f.calls = calls;
  return f;
}

test("relay: no host from the caller, each platform's host and auth, key never echoed", async () => {
  const b = (p, key, o) => Object.assign({ op: "ext", p, key, reqs: [{ m: "GET", path: L.PLATFORMS[p].probe }] }, o || {});
  assert.equal(X.validExt(b("hubspot", HS_KEY)), "");
  assert.equal(X.validExt(b("pdrive", PD_KEY)), "");
  assert.equal(X.validExt(b("hubspot", HS_KEY, { host: "evil.example" })), "host");
  assert.equal(X.validExt(b("pdrive", PD_KEY, { base: "/x" })), "host");
  assert.equal(X.validExt(b("pdrive", "nope")), "key");
  let f = mock();
  let r = await relay({ op: "ext", p: "hubspot", key: HS_KEY, reqs: [{ m: "GET", path: HS_CO + "&after=200" }] }, f);
  assert.equal(r.json.ok, true);
  assert.equal(f.calls[0].url, "https://api.hubapi.com" + HS_CO + "&after=200");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer " + HS_KEY);
  assert.equal(f.calls[0].init.method, "GET");
  assert.equal(JSON.stringify(r.json).indexOf(HS_KEY), -1);
  f = mock();
  r = await relay({ op: "ext", p: "pdrive", key: PD_KEY, reqs: [{ m: "GET", path: "/persons?limit=500&cursor=ab%2Bc%3D" }] }, f);
  assert.equal(r.json.ok, true);
  assert.equal(f.calls[0].url, "https://api.pipedrive.com/api/v2/persons?limit=500&cursor=ab%2Bc%3D");
  assert.equal(f.calls[0].init.headers["x-api-token"], PD_KEY);
  assert.equal(JSON.stringify(r.json).indexOf(PD_KEY), -1);
  f = mock();
  r = await relay({ op: "ext", p: "hubspot", key: HS_KEY, reqs: [{ m: "POST", path: "/crm/v3/objects/contacts", body: "{\"a\":1}" }] }, f);
  assert.equal(r.status, 400);
  assert.equal(f.calls.length, 0);
});

// ---------- links/crm.js: requests and answers ----------
test("requests: every kind and page passes the allowlist", () => {
  for (const p of M.PLATFORMS) for (const k of M.KINDS[p]) {
    assert.equal(L.checkReq(p, M.req(p, k, "")), "", p + " " + k);
    if (!(p === "hubspot" && k === "stages")) {
      const at = p === "hubspot" ? "MTAw" : p === "ininja" ? "2" : "eyJpZCI6+/x==";
      assert.equal(L.checkReq(p, M.req(p, k, at)), "", p + " " + k + " page 2");
    }
  }
  assert.match(M.req("pdrive", "acts", "").path, /done=false/);
});

test("HubSpot answers: stages, companies, contacts, deals, pages", () => {
  const st = M.read("hubspot", "stages", { results: [{ id: "default", stages: [
    { id: "appointmentscheduled", metadata: { isClosed: "false", probability: "0.2" } },
    { id: "closedwon", metadata: { isClosed: "true", probability: "1.0" } },
    { id: "closedlost", metadata: { isClosed: "true", probability: "0.0" } }] }] });
  assert.deepEqual(st.items, [
    { xid: "appointmentscheduled", prob: 20, closed: "" },
    { xid: "closedwon", prob: 100, closed: "won" },
    { xid: "closedlost", prob: 0, closed: "lost" }]);
  assert.equal(st.next, "");
  const co = M.read("hubspot", "orgs", { results: [
    { id: "11", properties: { name: "Ακμή <b>ΑΕ</b>", domain: "akmi.gr", phone: "210 1234567", address: "Οδός 1", zip: "10431", city: "Αθήνα", country: "Greece", industry: "RETAIL" } },
    { id: "12", properties: { name: "" } }], paging: { next: { after: "100" } } });
  assert.equal(co.items.length, 1);
  assert.equal(co.items[0].name, "Ακμή <b>ΑΕ</b>");           // plain text: shown with textContent
  assert.equal(co.items[0].web, "https://akmi.gr");
  assert.equal(co.items[0].addr, "Οδός 1, 10431 Αθήνα");
  assert.equal(co.next, "100");
  const ct = M.read("hubspot", "people", { results: [
    { id: "21", properties: { firstname: "Άννα", lastname: "Π.", email: "ANNA@akmi.gr", jobtitle: "CEO" }, associations: { companies: { results: [{ id: "11", type: "contact_to_company" }] } } },
    { id: "22", properties: { email: "solo@x.gr" } }] });
  assert.deepEqual(ct.items[0], { xid: "21", name: "Άννα Π.", email: "anna@akmi.gr", phone: "", role: "CEO", org: "11" });
  assert.equal(ct.items[1].name, "solo@x.gr");
  const dl = M.read("hubspot", "deals", { results: [{ id: "31", properties: { dealname: "Site", amount: "1200.5", dealstage: "closedwon", closedate: "2026-09-01T10:00:00.000Z", deal_currency_code: "eur" },
    associations: { companies: { results: [{ id: "11" }] } } }] });
  assert.equal(dl.items[0].val, 120050);
  assert.equal(dl.items[0].cur, "EUR");
  assert.equal(dl.items[0].cd, "2026-09-01");
  assert.equal(dl.items[0].org, "11");
});

test("Pipedrive answers: v2 shapes, cursors, primary e-mail", () => {
  const pe = M.read("pdrive", "people", { data: [{ id: 5, name: "Νίκος", emails: [{ value: "n@x.gr", primary: false }, { value: "N2@x.gr", primary: true }], phones: [{ value: "69 1" }], org_id: 7 }],
    additional_data: { next_cursor: "eyJpZCI6+/x==" } });
  assert.deepEqual(pe.items[0], { xid: "5", name: "Νίκος", email: "n2@x.gr", phone: "69 1", role: "", org: "7" });
  assert.equal(pe.next, "eyJpZCI6+/x==");
  assert.equal(M.read("pdrive", "people", { data: [], additional_data: { next_cursor: null } }).next, "");
  assert.equal(M.read("pdrive", "people", { data: [], additional_data: { next_cursor: "bad cursor" } }).next, "");
  const og = M.read("pdrive", "orgs", { data: [{ id: 7, name: "Βήτα ΙΚΕ", address: { value: "Λεωφ. 5, Πάτρα", country: "Greece" } }] });
  assert.equal(og.items[0].addr, "Λεωφ. 5, Πάτρα");
  const dl = M.read("pdrive", "deals", { data: [
    { id: 9, title: "Lost one", value: 300, currency: "EUR", status: "lost", lost_time: "2026-08-02 10:00:00", lost_reason: "Price", org_id: 7 },
    { id: 10, title: "Open", value: 50, currency: "USD", status: "open", stage_id: 3, expected_close_date: "2026-11-30", person_id: 5 }] });
  assert.equal(dl.items[0].cd, "2026-08-02");
  assert.equal(dl.items[0].why, "Price");
  assert.equal(dl.items[1].close, "2026-11-30");
  const ac = M.read("pdrive", "acts", { data: [
    { id: 40, subject: "Call back", due_date: "2026-10-20", due_time: "09:30:00", done: false, deal_id: 10 },
    { id: 41, subject: "Done one", due_date: "2026-10-01", done: true },
    { id: 42, subject: "No date", due_date: null }] });
  assert.deepEqual(ac.items, [{ xid: "40", text: "Call back", d: "2026-10-20", t: "09:30", deal: "10", org: "", person: "" }]);
});

// ---------- the plan ----------
const NOW = Date.UTC(2026, 9, 13, 12);
function got() {
  return {
    stages: [{ xid: "3", prob: 40, closed: "" }],
    orgs: [{ xid: "7", name: "Βήτα ΙΚΕ", phone: "", email: "", web: "", addr: "Πάτρα", country: "", job: "" },
           { xid: "8", name: "Already Here", phone: "", email: "", web: "", addr: "", country: "", job: "" }],
    people: [{ xid: "5", name: "Νίκος", email: "n@x.gr", phone: "69", role: "CEO", org: "7" },
             { xid: "6", name: "Solo", email: "solo@x.gr", phone: "", role: "", org: "" }],
    deals: [{ xid: "9", title: "Lost one", val: 30000, cur: "EUR", status: "lost", stage: "", prob: null, close: "", cd: "2026-08-02", why: "Price", org: "7", person: "" },
            { xid: "10", title: "Open", val: 5000, cur: "USD", status: "open", stage: "3", prob: null, close: "2026-11-30", cd: "", why: "", org: "", person: "5" },
            { xid: "11", title: "Here's deal", val: 100, cur: "", status: "won", stage: "", prob: null, close: "", cd: "", why: "", org: "8", person: "" },
            { xid: "12", title: "Orphan", val: 0, cur: "", status: "open", stage: "", prob: null, close: "", cd: "", why: "", org: "99", person: "" }],
    acts: [{ xid: "40", text: "Call back", d: "2026-10-20", t: "09:30", deal: "10", org: "", person: "" }]
  };
}
function base() {
  const d = C.empty();
  d.cust.push({ id: "local000001", m: 1, name: "already here", kind: "co", st: "active", note: "mine" });
  return C.norm(d);
}
const CTX = { p: "pdrive", acct: "acct000001", src: "Pipedrive", now: NOW, upd: true, revive: false };
// what crm.js applyRows does, without the DOM
function apply(d, pl) {
  let m = NOW;
  for (const k of ["cust", "deals", "fups"]) {
    for (const r of pl[k].add) { d[k].push(Object.assign({}, r, { m: ++m })); delete d.tombs[r.id]; }
    for (const u of pl[k].upd) { const i = d[k].findIndex((x) => x.id === u.row.id); d[k][i] = Object.assign({}, u.row, { m: ++m }); }
  }
  return C.norm(d);
}

test("plan: new companies with their people, a lone contact, deals, follow-ups", () => {
  const d = base();
  const pl = M.plan(C, d, got(), CTX);
  assert.equal(pl.cust.add.length, 2);                        // Βήτα + Solo (Already Here is matched)
  assert.equal(pl.here, 1);
  const beta = pl.cust.add.find((c) => c.name === "Βήτα ΙΚΕ");
  assert.equal(beta.id, L.extId("pdrive", "acct000001", "org", "7"));
  assert.deepEqual(beta.people, [{ c: "", n: "Νίκος", role: "CEO", phone: "69", email: "n@x.gr" }]);
  assert.equal(beta.st, "lead");
  assert.equal(beta.src, "Pipedrive");
  assert.equal(pl.cust.add.find((c) => c.name === "Solo").kind, "person");
  const lost = pl.deals.add.find((x) => x.title === "Lost one");
  assert.equal(lost.stage, "lost");
  assert.equal(lost.why, "Price");
  assert.equal(lost.val, 30000);
  const open = pl.deals.add.find((x) => x.title === "Open");
  assert.equal(open.cust, beta.id);                            // the person's company
  assert.equal(open.stage, "proposal");                        // 40 % → proposal
  assert.equal(open.val, 0);                                   // USD, CRM is in EUR
  assert.match(open.note, /50\.00 USD/);
  assert.equal(pl.otherCur, 1);
  assert.equal(pl.deals.add.find((x) => x.title === "Here's deal").cust, "local000001");
  assert.equal(pl.noCust, 1);
  assert.deepEqual(pl.fups.add[0], { id: L.extId("pdrive", "acct000001", "act", "40"), cust: beta.id, d: "2026-10-20", text: "Call back", t: "09:30", deal: open.id });
  // the customer already here is used, never changed
  assert.equal(pl.cust.upd.length, 0);
});

test("plan: a second import changes nothing; a change there updates only the platform's fields", () => {
  let d = apply(base(), M.plan(C, base(), got(), CTX));
  let pl = M.plan(C, d, got(), CTX);
  assert.deepEqual(M.count(pl), { add: 0, upd: 0 });
  // the person adds own things here
  const id = L.extId("pdrive", "acct000001", "org", "7");
  const i = d.cust.findIndex((c) => c.id === id);
  d.cust[i] = Object.assign({}, d.cust[i], { st: "active", note: "VIP", star: 1, m: NOW + 100 });
  const fi = d.fups.findIndex((f) => f.text === "Call back");
  d.fups[fi] = Object.assign({}, d.fups[fi], { done: "2026-10-14", m: NOW + 101 });
  d = C.norm(d);
  const g = got();
  g.orgs[0].addr = "Λεωφ. 5, Πάτρα";
  g.acts[0].text = "Call back (moved)";
  pl = M.plan(C, d, g, CTX);
  assert.equal(pl.cust.upd.length, 1);
  const row = pl.cust.upd[0].row;
  assert.equal(row.addr, "Λεωφ. 5, Πάτρα");
  assert.equal(row.st, "active");
  assert.equal(row.note, "VIP");
  assert.equal(row.star, 1);
  assert.equal(pl.fups.upd[0].row.done, "2026-10-14");           // done here stays done
  // updates off: nothing changes
  assert.deepEqual(M.count(M.plan(C, d, g, Object.assign({}, CTX, { upd: false }))), { add: 0, upd: 0 });
});

test("plan: deleted here stays deleted unless asked; ids are the same on every device", () => {
  let d = apply(base(), M.plan(C, base(), got(), CTX));
  const id = L.extId("pdrive", "acct000001", "person", "6");
  d.tombs[id] = NOW + 500;
  d = C.norm(d);
  assert.equal(d.cust.some((c) => c.id === id), false);
  let pl = M.plan(C, d, got(), CTX);
  assert.equal(pl.gone, 1);
  assert.equal(pl.cust.add.length, 0);
  pl = M.plan(C, d, got(), Object.assign({}, CTX, { revive: true }));
  assert.equal(pl.cust.add.length, 1);
  assert.equal(pl.cust.add[0].id, id);
  // two devices importing the same account land on the same rows
  const a = apply(base(), M.plan(C, base(), got(), CTX));
  const b = apply(base(), M.plan(C, base(), got(), CTX));
  assert.equal(JSON.stringify(C.merge(a, b).cust.map((c) => c.id)), JSON.stringify(a.cust.map((c) => c.id)));
});

test("plan: HubSpot closed stages are won / lost, CRM's limits hold", () => {
  const g = {
    stages: [{ xid: "closedwon", prob: 100, closed: "won" }, { xid: "s1", prob: 80, closed: "" }],
    orgs: [{ xid: "1", name: "Gamma", phone: "", email: "", web: "", addr: "", country: "", job: "" }],
    people: [],
    deals: [{ xid: "d1", title: "Won", val: 100, cur: "EUR", status: "", stage: "closedwon", prob: null, close: "2026-01-01", cd: "2026-01-01", why: "", org: "1", person: "" },
            { xid: "d2", title: "Nego", val: 100, cur: "EUR", status: "", stage: "s1", prob: null, close: "2026-12-01", cd: "2026-12-01", why: "", org: "1", person: "" }]
  };
  const ctx = Object.assign({}, CTX, { p: "hubspot", src: "HubSpot" });
  const pl = M.plan(C, C.empty(), g, ctx);
  assert.equal(pl.cust.add[0].st, "active");                   // it has a won deal
  assert.deepEqual(pl.deals.add.map((x) => [x.stage, x.cd || "", x.close || ""]), [["won", "2026-01-01", ""], ["nego", "", "2026-12-01"]]);
  const full = C.empty();
  for (let n = 0; n < C.LIMITS.cust; n++) full.cust.push({ id: "c" + String(n).padStart(6, "0"), m: 1, name: "C" + n, kind: "co", st: "lead" });
  const p2 = M.plan(C, C.norm(full), g, ctx);
  assert.equal(p2.cust.add.length, 0);
  assert.equal(p2.over, 1);
  assert.equal(p2.noCust, 2);
});
