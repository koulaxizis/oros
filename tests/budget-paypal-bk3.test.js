// Budget wave BK-3: PayPal Business read live through the person's own
// REST app (Connected services "paypal"). The allowlist (app
// links/core.js and relay relay/ext.js agree), the relay's per-call
// token, budget/bankapi.js windows and items (the same ids as PayPal's
// activity file), and "bnk" rows of kind PayPal in budget.js.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const K = require("../budget/bankapi.js");
const Bk = require("../budget/bank.js");
const L = require("../links/core.js");

let X;
test.before(async () => { X = await import("../relay/ext.js"); });

const CID = "AQkquBDf1zctJOWGKWUEtKXm6qVhueUEMvXO_-MCI4DQQ4-LWvkDLIN2fGsd" + "abcdefghij";
const SEC = "EL1tVxAjhT7cJimnz5-Nsx9k2reTKSVfErNQF-CmrwJgxRtylkGTKlU4RvrX" + "klmnopqrst";
const NOW = Date.parse("2026-11-01T21:00:00Z");

test("allowlist: only transaction search, the same in app and relay; the probe passes", async () => {
  const w = K.ppWindows("2026-10-01", NOW)[0];
  const good = { m: "GET", path: K.ppPath(w, 2) };
  assert.equal(L.checkReq("paypal", good), "");
  assert.equal(L.checkReq("paypal", L.probeReq("paypal")), "");
  const bad = [
    { m: "POST", path: "/v1/reporting/transactions" },
    { m: "GET", path: "/v1/reporting/balances" },
    { m: "POST", path: "/v2/payments/captures/X/refund", body: {} },
    { m: "GET", path: "/v1/reporting/transactions?start_date=2026-10-01&end_date=2026-10-02" },
    { m: "GET", path: K.ppPath(w, 1).replace("page_size=500", "page_size=501") },
    { m: "GET", path: K.ppPath(w, 1) + "&transaction_id=X" },
    { m: "GET", path: K.ppPath(w, 1) + "&page=2" },
    { m: "GET", path: K.ppPath(w, 1001) },
    { m: "GET", path: K.ppPath({ s: "2026-08-01T00:00:00-0000", e: "2026-09-02T00:00:00-0000" }, 1) },
    { m: "GET", path: K.ppPath({ s: w.e, e: w.s }, 1) },
    { m: "GET", path: "/v1/reporting/transactions?page_size=1" }
  ];
  for (const r of bad) assert.notEqual(L.checkReq("paypal", r), "", r.m + " " + r.path);
  const base = { op: "ext", p: "paypal", key: CID, token: SEC };
  assert.equal(X.validExt(Object.assign({}, base, { reqs: [good] })), "");
  assert.equal(X.validExt(Object.assign({}, base, { reqs: [L.probeReq("paypal")] })), "");
  for (const r of bad) {
    const rr = { m: r.m, path: r.path };
    if (r.body) rr.body = JSON.stringify(r.body);
    assert.notEqual(X.validExt(Object.assign({}, base, { reqs: [rr] })), "", r.path);
  }
  assert.equal(X.validExt(Object.assign({}, base, { token: "short", reqs: [good] })), "key");
  assert.equal(X.validExt(Object.assign({}, base, { host: "evil.example", reqs: [good] })), "host");
  assert.equal(L.PLATFORMS.paypal.relayOnly, true);
  assert.equal(L.checkKeys("paypal", { key: CID, token: SEC }).ok, true);
  assert.equal(L.checkKeys("paypal", { key: CID }).ok, false);
});

function fakePayPal(tokenStatus) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    if (url === "https://api-m.paypal.com/v1/oauth2/token") {
      if (tokenStatus !== 200) return new Response('{"error":"invalid_client"}', { status: tokenStatus });
      return new Response(JSON.stringify({ access_token: "A21AAtokenTOKENtoken-_.x", token_type: "Bearer", expires_in: 32400 }), { status: 200 });
    }
    return new Response(JSON.stringify({ transaction_details: [], total_pages: 1, page: 1 }), { status: 200 });
  };
  f.calls = calls;
  return f;
}

test("relay: a token for the call (Basic Client ID:Secret), then Bearer; a refused app says 401", async () => {
  const req = { m: "GET", path: K.ppPath(K.ppWindows("2026-10-20", NOW)[0], 1) };
  const b = { op: "ext", p: "paypal", key: CID, token: SEC, reqs: [req] };
  const f = fakePayPal(200);
  const out = await X.runExt(b, f);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].init.method, "POST");
  assert.equal(f.calls[0].init.body, "grant_type=client_credentials");
  assert.equal(f.calls[0].init.headers.Authorization, "Basic " + Buffer.from(CID + ":" + SEC).toString("base64"));
  assert.ok(f.calls[1].url.startsWith("https://api-m.paypal.com/v1/reporting/transactions?start_date=2026-10-20T00:00:00-0000"));
  assert.equal(f.calls[1].init.headers.Authorization, "Bearer A21AAtokenTOKENtoken-_.x");
  assert.equal(out.res[0].status, 200);
  assert.ok(JSON.stringify(out).indexOf(SEC) < 0 && JSON.stringify(out).indexOf("A21AA") < 0, "no secret or token in the answer");
  const f2 = fakePayPal(401);
  const out2 = await X.runExt(b, f2);
  assert.equal(f2.calls.length, 1, "no request without a token");
  assert.deepEqual(out2.res, [{ status: 401, err: "auth" }], "a fixed code, never PayPal's body");
});

test("windows: ≤ 31 days each, up to a minute ago; nothing for a start in the future", () => {
  const w = K.ppWindows("2026-08-04", NOW);
  assert.deepEqual(w.map((x) => x.s), ["2026-08-04T00:00:00-0000", "2026-09-04T00:00:00-0000", "2026-10-05T00:00:00-0000"]);
  assert.equal(w[2].e, "2026-11-01T20:59:00-0000");
  assert.deepEqual(K.ppWindows("2026-11-02", NOW), []);
  assert.deepEqual(K.ppPage({ transaction_details: [1, 2], total_pages: 40 }), { list: [1, 2], pages: 10 });
});

function t(id, code, value, o) {
  o = o || {};
  return {
    transaction_info: Object.assign({
      transaction_id: id, transaction_event_code: code, transaction_initiation_date: o.d || "2026-10-28T09:00:00+0000",
      transaction_amount: { currency_code: o.cur || "EUR", value }, transaction_status: o.st || "S"
    }, o.fee ? { fee_amount: { currency_code: o.cur || "EUR", value: o.fee } } : {}, o.ref ? { paypal_reference_id: o.ref } : {}),
    payer_info: o.name ? { payer_name: { alternate_full_name: o.name } } : {},
    cart_info: o.item ? { item_details: [{ item_name: o.item }] } : {}
  };
}
const LIVE = [
  t("1AA", "T0006", "-12.00", { name: "Bandcamp", item: "Album" }),
  t("1AB", "T0700", "12.00"),
  t("2AA", "T0000", "-10.00", { cur: "USD", name: "Shop Ltd" }),
  t("2AB", "T0200", "10.00", { cur: "USD", ref: "2AA" }),
  t("2AC", "T0200", "-9.40", { ref: "2AA" }),
  t("3AA", "T0011", "50.00", { fee: "-1.70", name: "Client" }),
  t("4AA", "T1300", "-80.00", { name: "Hotel", st: "P" }),
  t("5AA", "T0006", "-5.00", { name: "Store", st: "P" }),
  t("6AA", "T0400", "-48.30"),
  t("7AA", "T1107", "4.00", { name: "Bandcamp" })
];

test("items: the activity file's rules (fees, conversions, holds, pending, own bank)", () => {
  const it = K.ppItems(LIVE, "EUR");
  const by = Object.fromEntries(it.map((x) => [x.fit, x]));
  assert.equal(it.length, 8, "conversions fold into their payment");
  assert.deepEqual([by["1AA"].amt, by["1AA"].d, by["1AA"].text, by["1AA"].err], [-1200, "2026-10-28", "Bandcamp · Album", undefined]);
  assert.equal(by["1AB"].err, "xfer");
  assert.deepEqual([by["2AA"].amt, by["2AA"].cur, by["2AA"].err], [-940, "EUR", undefined]);
  assert.equal(by["3AA"].amt, 4830, "net of PayPal's fee");
  assert.equal(by["4AA"].err, "memo");
  assert.equal(by["5AA"].err, "pending");
  assert.equal(by["6AA"].err, "xfer");
  assert.equal(by["7AA"].amt, 400, "a refund comes in");
  assert.equal(K.ppKind("T0200"), "conv");
  assert.equal(K.ppKind("T1501"), "memo");
  assert.equal(K.ppKind("T0403"), "xfer");
  assert.equal(K.ppKind("T0006"), "");
  assert.equal(K.ppKind("bad"), "");
  assert.deepEqual(K.ppItems(null, "EUR"), []);
});

const PP_HEAD = '"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","From Email Address","To Email Address","Transaction ID","Item Title","Reference Txn ID","Balance","Balance Impact"';
test("the live reading and the activity file land on the same entries: nothing twice", () => {
  const text = [PP_HEAD,
    '"28/10/2026","10:00:00","CET","Bandcamp","Express Checkout Payment","Completed","EUR","-12.00","0.00","-12.00","me@x","b@x","1AA","Album","","0.00","Debit"',
    '"30/10/2026","09:00:00","CET","Client","Mobile Payment","Completed","EUR","50.00","-1.70","48.30","c@x","me@x","3AA","","","48.30","Credit"'].join("\n");
  const rows = Bk.parseCsv(text, Bk.guessSep(text));
  const hd = Bk.findHeader(rows);
  const fileItems = Bk.paypalItems(rows, hd.start, Bk.paypalMap(rows[hd.header]), "EUR");
  const fromFile = Bk.entries(Bk.plan(fileItems, { ac: "pp", cur: "EUR", pp: true }), "pp", true);
  const tx = fromFile.map((x) => Object.assign({ m: 1 }, x));
  const live = Bk.plan(K.uniqueFits(K.ppItems(LIVE, "EUR")), { ac: "pp", cur: "EUR", pp: true, tx });
  const by = Object.fromEntries(live.map((r) => [r.fit, r]));
  assert.equal(by["1AA"].st, "same");
  assert.equal(by["3AA"].st, "same");
  const add = Bk.entries(live, "pp", true);
  assert.deepEqual(add.map((x) => x.fit).sort(), ["2AA", "7AA"]);
  assert.ok(add.every((x) => x.pp === 1));
  // read again: nothing new
  const tx2 = tx.concat(add.map((x) => Object.assign({ m: 2 }, x)));
  assert.equal(Bk.entries(Bk.plan(K.ppItems(LIVE, "EUR"), { ac: "pp", cur: "EUR", pp: true, tx: tx2 }), "pp", true).length, 0);
});

const src = fs.readFileSync(path.join(__dirname, "..", "budget/budget.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const BJ = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { normBnk, mergeBudget, emptyData };")();

test("bnk rows of kind PayPal: no bank session, canonical keys, merge", () => {
  const row = { id: "p1", m: 3, ac: "acc1", bk: "PayPal", la: "abcd1234ef", lf: "2026-10-31", nm: "Shop", src: "pp" };
  assert.deepEqual(BJ.normBnk(row), row);
  assert.deepEqual(Object.keys(BJ.normBnk(Object.assign({}, row, { bk: "Other", sid: "x", cty: "GR" }))).slice(0, 8),
                   ["id", "m", "ac", "bk", "la", "lf", "nm", "src"]);
  assert.equal(BJ.normBnk(Object.assign({}, row, { bk: "Other" })).bk, "PayPal");
  assert.equal(BJ.normBnk(Object.assign({}, row, { la: "Bad!" })), null);
  // without src it is a bank row, and needs a session
  assert.equal(BJ.normBnk(Object.assign({}, row, { src: undefined })), null);
  const a = BJ.emptyData(), b = BJ.emptyData();
  a.bnk = [row];
  b.bnk = [Object.assign({}, row, { m: 4, lf: "2026-11-01" })];
  const m1 = BJ.mergeBudget(a, b);
  assert.equal(JSON.stringify(m1), JSON.stringify(BJ.mergeBudget(b, a)));
  assert.equal(m1.bnk[0].lf, "2026-11-01");
});

test("Enable Banking writes travel alone (once), in the app and the relay", () => {
  const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJlbmFibGViYW5raW5nLmNvbSJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
  const w = { m: "POST", path: "/sessions", body: JSON.stringify({ code: "abc" }) };
  assert.equal(L.PLATFORMS.ebank.once, true);
  assert.equal(X.validExt({ op: "ext", p: "ebank", key: jwt, reqs: [w] }), "");
  assert.equal(X.validExt({ op: "ext", p: "ebank", key: jwt, reqs: [w, { m: "GET", path: "/application" }] }), "reqs");
});

test("learned categories (BK-4): most often for the same merchant, rules win, rerun fills the rest", () => {
  const tx = [
    { id: "a1", k: "o", a: 500, d: "2026-10-01", c: "o-groc", ot: "LIDL HELLAS 123", n: "LIDL HELLAS 123", src: "bank" },
    { id: "a2", k: "o", a: 700, d: "2026-10-05", c: "o-groc", n: "Lidl Hellas" },
    { id: "a3", k: "o", a: 900, d: "2026-10-09", c: "o-home", ot: "LIDL HELLAS 9", n: "x", src: "bank" },
    { id: "a4", k: "i", a: 900, d: "2026-10-09", c: "i-other", n: "LIDL HELLAS refund" },
    { id: "a5", k: "o", a: 300, d: "2026-10-10", c: "", ot: "LIDL HELLAS 77", n: "LIDL HELLAS 77", src: "bank" }
  ];
  const m = Bk.learnMap(tx);
  assert.equal(Bk.learned(m, "o", "LIDL HELLAS 555"), "o-groc", "2 against 1");
  assert.equal(Bk.learned(m, "i", "LIDL HELLAS 555"), "i-other", "per kind");
  assert.equal(Bk.learned(m, "o", "Unknown shop"), "");
  const p = Bk.plan([{ line: 1, d: "2026-10-20", amt: -400, text: "LIDL HELLAS 9001", fit: "Z1" }], { tx, ac: "", cur: "EUR" });
  assert.deepEqual([p[0].c, p[0].learn], ["o-groc", 1]);
  const rules = [{ id: "r1", m: 1, k: "o", c: "o-eat", q: "lidl", lo: 0, hi: 0 }];
  const p2 = Bk.plan([{ line: 1, d: "2026-10-20", amt: -400, text: "LIDL HELLAS 9001", fit: "Z1" }], { tx, ac: "", cur: "EUR", rules });
  assert.deepEqual([p2[0].c, p2[0].learn], ["o-eat", undefined], "a rule wins");
  assert.deepEqual(Bk.rerun(tx, [], true), [{ id: "a5", c: "o-groc", n: "LIDL HELLAS 77" }]);
  assert.deepEqual(Bk.rerun(tx, []), []);
  // a tie goes to the newest
  const tie = Bk.learnMap([{ k: "o", c: "x1", d: "2026-01-01", n: "Cafe Nero" }, { k: "o", c: "x2", d: "2026-02-01", n: "Cafe Nero" }]);
  assert.equal(Bk.learned(tie, "o", "CAFE NERO 2"), "x2");
});
