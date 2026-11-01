// Budget live bank connection, wave BK-2: budget/bankapi.js (pure),
// the Enable Banking allowlist (app links/core.js and relay
// relay/ext.js agree), the JWT key handling in links/host.js
// (PKCS#1 → PKCS#8, RS256 signature checked with the public key) and
// the "bnk" collection of budget.js (normalise + merge).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const K = require("../budget/bankapi.js");
const Bk = require("../budget/bank.js");
const L = require("../links/core.js");

let X;
test.before(async () => { X = await import("../relay/ext.js"); });

const SID = "11111111-2222-4333-8444-555555555555";
const UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const UID2 = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";

test("banks: cleaned, sorted, personal/business filter, consent days capped at 180", () => {
  const b = K.banks({ aspsps: [
    { name: "Piraeus Bank", country: "GR", psu_types: ["personal", "business"], maximum_consent_validity: 7776000 },
    { name: "Alpha Bank", country: "GR", psu_types: ["personal"], maximum_consent_validity: 99999999, beta: true },
    { name: "Biz Only", country: "GR", psu_types: ["business"] },
    { name: "Alpha Bank", country: "GR" },
    { name: "", country: "GR" }, { name: "X", country: "Greece" }, null
  ] }, "personal");
  assert.deepEqual(b.map((x) => [x.name, x.days, x.beta]), [["Alpha Bank", 180, true], ["Piraeus Bank", 90, false]]);
  assert.equal(K.banks({ aspsps: [{ name: "Biz Only", country: "GR", psu_types: ["business"] }] }, "business").length, 1);
  assert.deepEqual(K.banks(null), []);
});

test("auth body: passes the app and relay allowlists; a foreign redirect or extra key does not", () => {
  const state = K.newState(new Uint8Array(24).map((_, i) => i * 7));
  assert.match(state, /^[A-Za-z0-9_-]{24}$/);
  const body = K.authBody({ name: "Alpha Bank", country: "GR", days: 90 }, state, "personal", Date.UTC(2026, 10, 1));
  assert.equal(body.access.valid_until, "2027-01-30T00:00:00Z");
  assert.equal(body.redirect_url, "https://useoros.online/budget/bankback.html");
  const req = { m: "POST", path: "/auth", body };
  assert.equal(L.checkReq("ebank", req), "");
  assert.equal(X.checkExtReq("ebank", req), "");
  const bad = [
    Object.assign({}, body, { redirect_url: "https://evil.example/cb" }),
    Object.assign({}, body, { psu_type: "admin" }),
    Object.assign({}, body, { aspsp: { name: "A", country: "GR", extra: 1 } }),
    Object.assign({}, body, { state: "short" }),
    Object.assign({}, body, { payment: { amount: 1 } })
  ];
  bad.forEach((b) => {
    assert.equal(L.checkReq("ebank", { m: "POST", path: "/auth", body: b }), "body");
    assert.equal(X.checkExtReq("ebank", { m: "POST", path: "/auth", body: b }), "body");
  });
  const noState = Object.assign({}, body); delete noState.state;
  assert.equal(L.checkReq("ebank", { m: "POST", path: "/auth", body: noState }), "body");
  assert.equal(X.checkExtReq("ebank", { m: "POST", path: "/auth", body: noState }), "body");
});

test("allowlist: read-only paths agree between app and relay; payments never", () => {
  const cases = [
    [{ m: "GET", path: "/application" }, ""],
    [{ m: "GET", path: "/aspsps?country=GR&psu_type=personal" }, ""],
    [{ m: "GET", path: "/aspsps?country=gr" }, "query"],
    [{ m: "POST", path: "/sessions", body: { code: "c0de-123" } }, ""],
    [{ m: "POST", path: "/sessions", body: { code: "a b" } }, "body"],
    [{ m: "GET", path: "/sessions/" + SID }, ""],
    [{ m: "GET", path: "/accounts/" + UID + "/balances" }, ""],
    [{ m: "GET", path: "/accounts/" + UID + "/transactions?date_from=2026-08-01" }, ""],
    [{ m: "GET", path: "/accounts/" + UID + "/transactions?date_from=2026-08-01&continuation_key=ab%2Fcd%3D" }, ""],
    [{ m: "GET", path: "/accounts/" + UID + "/transactions?date_from=2026-08-01&evil=1" }, "query"],
    [{ m: "GET", path: "/accounts/../payments" }, "path"],
    [{ m: "POST", path: "/payments", body: { a: 1 } }, "path"],
    [{ m: "GET", path: "/accounts/not-a-uuid/transactions" }, "path"],
    [{ m: "PUT", path: "/sessions/" + SID, body: { a: 1 } }, "path"]
  ];
  cases.forEach(([r, want]) => {
    assert.equal(L.checkReq("ebank", r), want, "app " + r.m + " " + r.path);
    assert.equal(X.checkExtReq("ebank", r), want, "relay " + r.m + " " + r.path);
  });
});

test("relay: only a JWT travels, never a PEM; no host from the caller", () => {
  const jwt = "eyJhbGciOiJSUzI1NiJ9" + "." + "eyJpc3MiOiJlbmFibGViYW5raW5nLmNvbSJ9" + "." + "c2lnbmF0dXJlLXNpZ25hdHVyZQ";
  const ok = { op: "ext", p: "ebank", key: jwt, reqs: [{ m: "GET", path: "/application" }] };
  assert.equal(X.validExt(ok), "");
  assert.equal(X.validExt(Object.assign({}, ok, { key: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----" })), "key");
  assert.equal(X.validExt(Object.assign({}, ok, { host: "evil.example" })), "host");
  assert.equal(X.validExt(Object.assign({}, ok, { reqs: [{ m: "POST", path: "/sessions", body: JSON.stringify({ code: "x" }) }] })), "");
  // the app's keys: application id + PEM, checked before they are sealed
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  assert.equal(L.checkKeys("ebank", { app: "0b1c2d3e-0000-4000-8000-000000000001", pem }).ok, true);
  assert.equal(L.checkKeys("ebank", { app: "nope", pem }).ok, false);
  assert.equal(L.authHeader("ebank", { jwt })[1], "Bearer " + jwt);
  assert.equal(L.PLATFORMS.ebank.ownUi, "budget");
});

test("host.js: PKCS#1 and PKCS#8 keys sign an RS256 JWT the public key verifies", async () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "links/host.js"), "utf8");
  const i = src.indexOf("  function b64urlBytes("), j = src.indexOf("  // The keys a call uses:");
  assert.ok(i > 0 && j > i);
  const H = new Function("crypto", "btoa", "atob", "TextEncoder", "err",
    src.slice(i, j) + "\nreturn { ebJwt: ebJwt, pkcs1to8: pkcs1to8 };")(
    globalThis.crypto, globalThis.btoa, globalThis.atob, globalThis.TextEncoder, (c) => Object.assign(new Error(c), { code: c }));
  const app = "0b1c2d3e-0000-4000-8000-000000000001";
  for (const type of ["pkcs8", "pkcs1"]) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type, format: "pem" });
    const jwt = await H.ebJwt("acct" + type, { app, pem });
    const [h, b, s] = jwt.split(".");
    const head = JSON.parse(Buffer.from(h, "base64url").toString());
    const body = JSON.parse(Buffer.from(b, "base64url").toString());
    assert.deepEqual(head, { typ: "JWT", alg: "RS256", kid: app });
    assert.equal(body.iss, "enablebanking.com");
    assert.equal(body.aud, "api.enablebanking.com");
    assert.equal(body.exp - body.iat, 3600);
    assert.ok(crypto.verify("RSA-SHA256", Buffer.from(h + "." + b), publicKey, Buffer.from(s, "base64url")), type);
    assert.equal(await H.ebJwt("acct" + type, { app, pem }), jwt, "cached while valid");
  }
  await assert.rejects(H.ebJwt("bad", { app, pem: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" }), (e) => e.code === "keys");
});

test("session: accounts with uid, hash, last four, currency", () => {
  const s = K.session({ session_id: SID, access: { valid_until: "2027-04-30T10:00:00+00:00" }, accounts: [
    { uid: UID, identification_hash: "h1", name: "Τρεχούμενος", account_id: { iban: "GR16 0110 1250 0000 0001 2300 695" }, currency: "EUR" },
    { uid: UID2, product: "Card", account_id: { other: { identification: "4111111111111111" } }, currency: "EUR" },
    { uid: "bad" }
  ] });
  assert.equal(s.sid, SID);
  assert.equal(s.vu, Date.parse("2027-04-30T10:00:00Z"));
  assert.deepEqual(s.accts.map((a) => [a.uid, a.ih, a.name, a.ib, a.cur]), [[UID, "h1", "Τρεχούμενος", "0695", "EUR"], [UID2, "", "Card", "1111", "EUR"]]);
  assert.equal(K.session({ session_id: "x" }), null);
});

const TX = { transactions: [
  { entry_reference: "E1", transaction_amount: { currency: "EUR", amount: "12.50" }, credit_debit_indicator: "DBIT", status: "BOOK",
    booking_date: "2026-10-30", creditor: { name: "ΣΚΛΑΒΕΝΙΤΗΣ" }, remittance_information: ["POS 1234"] },
  { transaction_id: "T2", transaction_amount: { currency: "EUR", amount: "1250.00" }, credit_debit_indicator: "CRDT", status: "BOOK",
    value_date: "2026-10-31", debtor: { name: "ACME ΑΕ" }, remittance_information: ["Μισθός Οκτωβρίου"] },
  { entry_reference: "E3", transaction_amount: { currency: "EUR", amount: "5.00" }, credit_debit_indicator: "DBIT", status: "PDNG",
    booking_date: "2026-11-01", creditor: { name: "Cafe" } },
  { entry_reference: "E1", transaction_amount: { currency: "EUR", amount: "12.50" }, credit_debit_indicator: "DBIT", status: "BOOK",
    booking_date: "2026-10-30", creditor: { name: "ΣΚΛΑΒΕΝΙΤΗΣ" } },
  { transaction_amount: { currency: "EUR", amount: "abc" }, credit_debit_indicator: "DBIT", booking_date: "2026-10-30" },
  { transaction_amount: { currency: "USD", amount: "3.00" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-10-29", note: "Github" }
] };

test("transactions → items → plan: booked only, signs, repeated reference, other currency, idempotent", () => {
  const it = K.uniqueFits(K.items(TX));
  assert.deepEqual(it.map((x) => [x.d, x.amt, x.fit, x.err || ""]), [
    ["2026-10-30", -1250, "E1", ""], ["2026-10-31", 125000, "T2", ""], ["2026-11-01", -500, "E3", "pending"],
    ["2026-10-30", -1250, "", ""], ["2026-10-30", null, "", "amount"], ["2026-10-29", -300, "", ""]]);
  assert.equal(it[0].text, "ΣΚΛΑΒΕΝΙΤΗΣ · POS 1234");
  assert.equal(it[1].text, "ACME ΑΕ · Μισθός Οκτωβρίου");
  assert.equal(it[5].text, "Github");
  const plan = Bk.plan(it, { ac: "alpha", cur: "EUR" });
  assert.deepEqual(plan.map((r) => r.st), ["new", "new", "skip", "new", "skip", "skip"]);
  const ent = Bk.entries(plan, "alpha").map((x) => Object.assign({ m: 1 }, x));
  assert.equal(ent.length, 3);
  // the next refresh overlaps a week: nothing twice
  const again = Bk.plan(K.uniqueFits(K.items(TX)), { ac: "alpha", cur: "EUR", tx: ent });
  assert.equal(Bk.entries(again, "alpha").length, 0);
  assert.equal(K.lastBooked(it), "2026-10-31");
});

test("fetch window, consent days, refresh pace", () => {
  const now = Date.UTC(2026, 10, 1, 12);
  assert.equal(K.fromDate(null, now), "2026-08-04");
  assert.equal(K.fromDate({ lf: "2026-10-30" }, now), "2026-10-23");
  assert.equal(K.fromDate({ lf: "2026-01-01" }, now), "2026-08-04", "never further back than the first window");
  assert.equal(K.fromDate({ lf: "2027-01-01" }, now), "2026-11-01", "never in the future");
  assert.equal(K.daysLeft({ vu: now + 10 * 86400000 }, now), 10);
  assert.equal(K.needsRenew({ vu: now + 10 * 86400000 }, now), false);
  assert.equal(K.needsRenew({ vu: now + 3 * 86400000 }, now), true);
  assert.equal(K.needsRenew({ vu: now - 1 }, now), true);
  assert.equal(K.needsRenew({ vu: 0 }, now), false);
  assert.equal(K.due(0, now), true);
  assert.equal(K.due(now - 5 * 3600000, now), false);
  assert.equal(K.due(now - 6 * 3600000, now), true);
});

test("renewed consent finds the same rows (hash, else bank + last four + currency)", () => {
  const rows = [
    { id: "r1", bk: "Alpha Bank", cty: "GR", ih: "h1", ib: "0695", cu: "EUR" },
    { id: "r2", bk: "Alpha Bank", cty: "GR", ih: "", ib: "1111", cu: "EUR" }
  ];
  const bank = { name: "Alpha Bank", country: "GR" };
  assert.equal(K.matchLink(rows, bank, { ih: "h1", ib: "9999" }).id, "r1");
  assert.equal(K.matchLink(rows, bank, { ih: "", ib: "1111", cur: "EUR" }).id, "r2");
  assert.equal(K.matchLink(rows, bank, { ih: "h9", ib: "0695", cur: "EUR" }), null, "another hash is another account");
  assert.equal(K.matchLink(rows, { name: "Piraeus Bank", country: "GR" }, { ih: "h1" }), null);
});

// ---------- budget.js: the "bnk" collection ----------
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

test("bnk rows: normalised, LWW merge, tombstones, kept by an older shape", () => {
  const row = { id: "k1", m: 5, ac: "acc1", bk: "Alpha Bank", cty: "GR", cu: "EUR", ib: "0695", ih: "h1", la: "abcd1234ef", lf: "2026-10-31",
                nm: "Τρεχούμενος", ps: "personal", sid: SID, uid: UID, vu: 1800000000000 };
  assert.deepEqual(BJ.normBnk(row), row);
  assert.deepEqual(Object.keys(BJ.normBnk(row)), ["id", "m", "ac", "bk", "cty", "cu", "ib", "ih", "la", "lf", "nm", "ps", "sid", "uid", "vu"]);
  assert.equal(BJ.normBnk(Object.assign({}, row, { sid: "x" })), null);
  assert.equal(BJ.normBnk(Object.assign({}, row, { la: "Bad!" })), null);
  assert.equal(BJ.normBnk(Object.assign({}, row, { ib: "GR160110" })).ib, "");
  const a = BJ.emptyData(), b = BJ.emptyData();
  a.bnk = [row];
  b.bnk = [Object.assign({}, row, { m: 9, ac: "acc2" })];
  const m1 = BJ.mergeBudget(a, b), m2 = BJ.mergeBudget(b, a);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2));
  assert.equal(m1.bnk[0].ac, "acc2");
  const c = BJ.emptyData();
  c.tombs["bnk:k1"] = 10;
  assert.equal(BJ.mergeBudget(m1, c).bnk.length, 0);
  assert.ok(JSON.stringify(Object.keys(BJ.mergeBudget(a, BJ.emptyData()))).indexOf("bnk") > 0);
});
