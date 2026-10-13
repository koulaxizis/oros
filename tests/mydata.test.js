// Connected services wave 2: timologisi.online (myDATA through a
// certified provider). The Invoices document → SendInvoices mapping
// (links/mydata.js), the answers, the provider's place in the accounts
// slice and the request allowlist (app and relay copies), and the relay
// "ext" call against a mocked provider.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../links/mydata.js");
const L = require("../links/core.js");
const I = require("../invoices/core.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

const TODAY = "2026-10-13";
const SELLER = { name: "ΔΟΚΙΜΗ ΙΚΕ", trade: "Δοκιμή", job: "Υπηρεσίες πληροφορικής", afm: "123456789", doy: "Α' Αθηνών",
                 addr: "Ερμού 12\n10563 Αθήνα", country: "Ελλάδα", phone: "2100000000", email: "a@b.gr", web: "", iban: "GR16 0110 1250 0000 0001 2300 695" };
const CLIENT = { name: "ΠΕΛΑΤΗΣ ΑΕ", job: "Εμπόριο", afm: "EL987654324", doy: "Ζωγράφου", addr: "Οδός Πελάτη 10, 15772 Ζωγράφου", country: "Ελλάδα" };
function doc(o) {
  return Object.assign({ id: "d1", kind: "inv", st: "issued", cur: "EUR", date: TODAY, wht: 0, gDisc: 0, exempt: "", notes: "", terms: "",
    lines: [{ code: "A1", d: "Συντήρηση", q: 1, unit: "τεμ", p: 10000, disc: 0, vat: 24 }] }, o);
}
function input(d, o) {
  return Object.assign({ doc: d, totals: I.totals(d), seller: SELLER, client: CLIENT, vat: "123456789", series: "INV-2026", aa: "42",
    today: TODAY, type: "2.1", nature: "s", cc: "GR", pay: 5, lang: "el", EU: I.EU }, o);
}
function sum(xs) { return Math.round(xs.reduce((a, b) => a + Math.round(b * 100), 0)); }

test("parseAddr: street + number, postal code + city in any common order", () => {
  assert.deepEqual(M.parseAddr("Ερμού 12\n10563 Αθήνα"), { street: "Ερμού", number: "12", pc: "10563", city: "Αθήνα" });
  assert.deepEqual(M.parseAddr("Ερμού 12, 105 63 Αθήνα"), { street: "Ερμού", number: "12", pc: "10563", city: "Αθήνα" });
  assert.deepEqual(M.parseAddr("Λ. Κηφισίας 100-102, Μαρούσι 15125"), { street: "Λ. Κηφισίας", number: "100-102", pc: "15125", city: "Μαρούσι" });
  assert.deepEqual(M.parseAddr("Hauptstraße 5\n10115 Berlin\nDeutschland"), { street: "Hauptstraße", number: "5", pc: "10115", city: "Berlin" });
  assert.equal(M.parseAddr("Αθήνα"), null);
  assert.equal(M.parseAddr(""), null);
});

test("autoType + classOf: retail, Greek / EU / other businesses, credit notes", () => {
  assert.equal(M.autoType("rcpt", "", "g"), "11.1");
  assert.equal(M.autoType("rcpt", "", "s"), "11.2");
  assert.equal(M.autoType("inv", "GR", "g", "", "", I.EU), "1.1");
  assert.equal(M.autoType("inv", "DE", "s", "", "", I.EU), "2.2");
  assert.equal(M.autoType("inv", "US", "g", "", "", I.EU), "1.3");
  assert.equal(M.autoType("cred", "", "g", "11.1"), "11.4");
  assert.equal(M.autoType("cred", "GR", "g", "1.1", "400001930000001"), "5.1");
  assert.equal(M.autoType("cred", "GR", "g", "", ""), "5.2");
  assert.deepEqual(M.classOf("11.2", "", "s"), { classificationType: "E3_561_003", classificationCategory: "category1_3" });
  assert.deepEqual(M.classOf("1.2", "DE", "g", I.EU), { classificationType: "E3_561_005", classificationCategory: "category1_1" });
  assert.deepEqual(M.classOf("5.2", "US", "g", I.EU), { classificationType: "E3_561_006", classificationCategory: "category1_1" });
});

test("share: whole cents, exact total, stable", () => {
  for (let n = 0; n < 300; n++) {
    const w = Array.from({ length: 1 + (n % 7) }, (_, i) => (n * 37 + i * 101) % 997);
    const t = (n * 7919) % 100000;
    const s = M.share(t, w);
    assert.equal(s.reduce((a, b) => a + b, 0), t);
    s.forEach((v) => assert.ok(Number.isInteger(v) && v >= 0));
  }
  assert.deepEqual(M.share(100, [1, 1, 1]), [34, 33, 33]);
});

test("build 2.1: lines add up to orOS's totals to the cent (discounts, global discount, two rates)", () => {
  const d = doc({ gDisc: 7.5, lines: [
    { code: "", d: "Α", q: 3, unit: "", p: 333, disc: 10, vat: 24 },
    { code: "", d: "Β", q: 1.5, unit: "kg", p: 1999, disc: 0, vat: 24 },
    { code: "", d: "Γ", q: 7, unit: "", p: 145, disc: 3, vat: 13 }
  ] });
  const T = I.totals(d);
  const r = M.build(input(d));
  assert.equal(r.ok, true, JSON.stringify(r.errs));
  const inv = r.body.invoice[0];
  const det = inv.invoiceDetails;
  assert.equal(sum(det.map((x) => x.netValue)), T.net);
  assert.equal(sum(det.map((x) => x.vatAmount)), T.vat);
  assert.equal(Math.round(inv.invoiceSummary.totalNetValue * 100), T.net);
  assert.equal(Math.round(inv.invoiceSummary.totalVatAmount * 100), T.vat);
  assert.equal(Math.round(inv.invoiceSummary.totalGrossValue * 100), T.pay);
  assert.equal(Math.round(inv.paymentMethods[0].amount * 100), T.pay);
  det.forEach((x) => assert.equal(x.incomeClassification[0].amount, x.netValue));
  assert.equal(sum(inv.invoiceSummary.incomeClassification.map((x) => x.amount)), T.net);
  assert.deepEqual(det.map((x) => x.vatCategory), [1, 1, 2]);
  assert.equal(det[1].measurementUnit, 2);
  // Greek counterpart: no name (AADE 219/220), plain ΑΦΜ, address kept
  assert.deepEqual(inv.counterpart, { vatNumber: "987654324", country: "GR", branch: 0,
    address: { street: "Οδός Πελάτη", number: "10", postalCode: "15772", city: "Ζωγράφου" } });
  assert.equal(inv.issuer.vatNumber, "123456789");
  const pi = inv.providerAdditionalInvoiceDetails;
  assert.equal(pi.issuer.addressPostalCode, "10563");
  assert.equal(pi.issuer.name, "ΔΟΚΙΜΗ ΙΚΕ (Δοκιμή)");
  assert.equal(pi.additionalDetails.documentLabel, "Τιμολόγιο Παροχής Υπηρεσιών");
  assert.equal(pi.additionalDetails.paymentMethodInvoiceLabel, "Επί πιστώσει");
  // the request passes the allowlist on both sides
  const req = { m: "POST", path: "/SendInvoices", body: r.body };
  assert.equal(L.checkReq("tol", req), "");
  assert.equal(X.checkExtReq("tol", req), "");
});

test("build 1.1 with withholding: gross = net + VAT − withheld, document-level tax", () => {
  const d = doc({ wht: 20 });
  const r = M.build(input(d, { type: "1.1", nature: "g", whtCat: 3 }));
  assert.equal(r.ok, true, JSON.stringify(r.errs));
  const inv = r.body.invoice[0];
  assert.equal(inv.invoiceSummary.totalWithheldAmount, 20);
  assert.equal(inv.invoiceSummary.totalGrossValue, 104);
  assert.equal(inv.paymentMethods[0].amount, 104);
  assert.deepEqual(inv.taxesTotals[0], { taxType: 1, taxCategory: 3, underlyingValue: 100, taxAmount: 20, taxTypeLabel: "Παρακράτηση φόρου 20%" });
  // a category of another rate is refused
  assert.deepEqual(M.build(input(d, { type: "1.1", whtCat: 7 })).errs, ["wht"]);
});

test("build 11.1 retail: no counterpart; 0 % needs an exemption reason", () => {
  const d = doc({ kind: "rcpt", lines: [{ code: "", d: "Βιβλίο", q: 2, unit: "", p: 1500, disc: 0, vat: 0 }] });
  assert.deepEqual(M.build(input(d, { type: "11.1", nature: "g", pay: 3 })).errs, ["exempt"]);
  const r = M.build(input(d, { type: "11.1", nature: "g", pay: 3, exCat: 27 }));
  assert.equal(r.ok, true, JSON.stringify(r.errs));
  const inv = r.body.invoice[0];
  assert.equal(inv.counterpart, undefined);
  assert.equal(inv.invoiceDetails[0].vatCategory, 7);
  assert.equal(inv.invoiceDetails[0].vatExemptionCategory, 27);
  assert.equal(inv.invoiceDetails[0].incomeClassification[0].classificationType, "E3_561_003");
  assert.equal(inv.paymentMethods[0].type, 3);
});

test("build 5.1: correlated with the original's ΜΑΡΚ as a number", () => {
  const d = doc({ kind: "cred" });
  assert.deepEqual(M.build(input(d, { type: "5.1" })).errs, ["ref"]);
  const r = M.build(input(d, { type: "5.1", ref: { mark: "400001930000001", label: "Τιμολόγιο INV-2026-0001" } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.body.invoice[0].invoiceHeader.correlatedInvoices, [400001930000001]);
  assert.equal(r.body.invoice[0].invoiceHeader.correlatedInvoicesLabel, "Τιμολόγιο INV-2026-0001");
});

test("build refuses what myDATA would reject, before any call", () => {
  const e = (d, o) => M.build(input(d, o)).errs;
  assert.deepEqual(e(doc({ date: "2026-10-12" })), ["date"]);
  assert.deepEqual(e(doc({ cur: "USD" })), ["cur"]);
  assert.deepEqual(e(doc({ lines: [{ d: "x", q: 1, p: 100, disc: 0, vat: 23 }] })), ["rate"]);
  assert.deepEqual(e(doc(), { vat: "111111111" }), ["afm"]);
  assert.deepEqual(e(doc(), { seller: Object.assign({}, SELLER, { addr: "Αθήνα" }) }), ["saddr"]);
  assert.deepEqual(e(doc(), { seller: Object.assign({}, SELLER, { doy: "" }) }), ["sdoy"]);
  assert.deepEqual(e(doc(), { client: Object.assign({}, CLIENT, { afm: "" }) }), ["cafm"]);
  assert.deepEqual(e(doc(), { client: Object.assign({}, CLIENT, { afm: "123456789" }) }), ["self"]);
  assert.deepEqual(e(doc(), { type: "2.2", cc: "DE", client: { name: "GmbH", afm: "DE123456789", addr: "Berlin" } }), ["caddr"]);
  assert.deepEqual(e(doc(), { series: "ΤΙΜ" }), ["num"]);
  // a foreign business: name + address, VAT without its country prefix
  const r = M.build(input(doc(), { type: "2.2", cc: "DE", client: { name: "Muster GmbH", afm: "DE123456789", addr: "Hauptstraße 5\n10115 Berlin" } }));
  assert.equal(r.ok, true, JSON.stringify(r.errs));
  assert.deepEqual(r.body.invoice[0].counterpart, { vatNumber: "123456789", country: "DE", branch: 0, name: "Muster GmbH",
    address: { street: "Hauptstraße", number: "5", postalCode: "10115", city: "Berlin" } });
  assert.equal(r.body.invoice[0].invoiceDetails[0].incomeClassification[0].classificationType, "E3_561_005");
});

test("parseSend: success, offline, duplicate (228), AADE and provider refusals, wrong key", () => {
  const ok = M.parseSend(200, { response: [{ index: 1, statusCode: "Success", invoiceUid: "C10262E0AE13C6AFD7DD2C980900BB0DF266D9C5",
    invoiceMark: 400001939576037, authenticationCode: "1D0F38488D532D3BB715408E01283D39E8D56A3A",
    invoiceUrl: "https://provider.timologisi.online/api/v1/Provider/GetInvoicePdf/671899191d6d0b3d947bc4bb.pdf", errors: null }] });
  assert.deepEqual(ok, { st: "ok", mark: "400001939576037", uid: "C10262E0AE13C6AFD7DD2C980900BB0DF266D9C5",
    auth: "1D0F38488D532D3BB715408E01283D39E8D56A3A", url: "https://provider.timologisi.online/api/v1/Provider/GetInvoicePdf/671899191d6d0b3d947bc4bb.pdf", errs: [] });
  assert.equal(M.parseSend(200, { response: [{ statusCode: "Offline", invoiceMark: 0, invoiceUid: "C10262E0AE13C6AFD7DD2C980900BB0DF266D9C5" }] }).st, "offline");
  const dup = M.parseSend(200, { response: [{ statusCode: "ValidationError", invoiceMark: 0, errors: [{ error: [{ code: "228",
    message: "The UID: C10262E0AE13C6AFD7DD2C980900BB0DF266D9C5 is invalid . It has already been sent for another invoice (MARK:400001939576037 , AUTHENTICATION_CODE:1D0F38488D532D3BB715408E01283D39E8D56A3A)" }] }] }] });
  assert.equal(dup.st, "dup");
  assert.equal(dup.mark, "400001939576037");
  const rej = M.parseSend(200, { response: [{ statusCode: "ValidationError", invoiceMark: 0, errors: [{ error: [{ code: "203", message: "Gross value" }] }] }] });
  assert.equal(rej.st, "rejected");
  assert.deepEqual(rej.errs, [{ code: "203", message: "Gross value" }]);
  assert.equal(M.parseSend(200, { response: [{ statusCode: "TechnicalError" }] }).st, "tech");
  const bad = M.parseSend(400, { errors: ["The sum of the payment methods amount must be equal to the total gross value of the invoices."] });
  assert.equal(bad.st, "bad");
  assert.equal(bad.errs.length, 1);
  assert.equal(M.parseSend(401, null).st, "auth");
  // a PDF link elsewhere is not kept
  assert.equal(M.parseSend(200, { response: [{ statusCode: "Success", invoiceMark: 1, invoiceUrl: "https://evil.example/x.pdf" }] }).url, "");
});

test("findSent: same type, series, number and gross; the row with a ΜΑΡΚ wins", () => {
  const row = (mark) => ({ uid: "15B0B6AEB08979B44EE68110CD734458F22ED6DE", mark, authenticationCode: "904E2E03B5C4B0B0826BB2B8375F61E5F73118AD",
    invoiceHeader: { series: "INV-2026", aa: "42", issueDate: TODAY + "T00:00:00Z", invoiceType: "2.1" },
    invoiceSummary: { totalNetValue: 100, totalVatAmount: 24, totalGrossValue: 124 },
    pdfUrl: "https://provider-dev.timologisi.online/api/v1/Provider/GetInvoicePdf/671893b51d6d0b3d947bc4b9.pdf" });
  const want = { type: "2.1", series: "INV-2026", aa: "42", gross: 12400 };
  assert.equal(M.findSent({ providerTransmittedDocs: [row(0), row(400001939575310)] }, want).mark, "400001939575310");
  assert.equal(M.findSent({ providerTransmittedDocs: [row(0)] }, want).mark, "");
  assert.equal(M.findSent({ providerTransmittedDocs: [row(1)] }, Object.assign({}, want, { gross: 12401 })), null);
  assert.equal(M.findSent(null, want), null);
});

test("seriesOf: Latin, no spaces, Greek capitals that look Latin mapped", () => {
  assert.equal(M.seriesOf("INV", 2026, 1), "INV-2026");
  assert.equal(M.seriesOf("ΤΙΜ", 2026, 0), "TIM");
  assert.equal(M.seriesOf("Α Β", 2026, 1), "A-B-2026");
  assert.equal(M.seriesOf("", 2026, 0), "0");
});

// ---------- accounts + allowlist ----------
const KEY = "nvs_" + "A1b2C3d4".repeat(4);
test("accounts: timologisi.online rows keep env + ΑΦΜ; WooCommerce rows keep their bytes", () => {
  const t = L.normAcct({ id: "tttt1111", m: 5, p: "tol", name: "", env: "test", vat: "123456789", ks: 0, s: "", sm: 0, d: 0, site: "x" });
  assert.deepEqual(Object.keys(t), ["id", "m", "p", "name", "site", "env", "vat", "ks", "s", "sm", "d"]);
  assert.equal(t.site, "");
  assert.equal(t.name, "timologisi.online");
  assert.equal(L.normAcct(Object.assign({}, t, { env: "prod" })), null);
  assert.equal(L.normAcct(Object.assign({}, t, { vat: "12345678" })), null);
  const w = L.normAcct({ id: "wwww1111", m: 5, p: "woo", name: "S", site: "shop.example.gr", env: "test", vat: "123456789", ks: 0, s: "", sm: 0, d: 0 });
  assert.deepEqual(Object.keys(w), ["id", "m", "p", "name", "site", "ks", "s", "sm", "d"]);
  assert.equal(L.checkKeys("tol", { key: KEY }).ok, true);
  assert.equal(L.checkKeys("tol", { key: "short" }).ok, false);
  assert.equal(L.checkKeys("tol", { key: KEY + "\r\nX: 1" }).ok, false);
  assert.equal(L.apiUrl("tol", t, "/GetCreditsBalance"), "https://provider-dev.timologisi.online/api/v1/Provider/GetCreditsBalance");
  assert.equal(L.apiUrl("tol", Object.assign({}, t, { env: "live" }), "/X"), "https://provider.timologisi.online/api/v1/Provider/X");
});

const TOL_CASES = [
  [{ m: "GET", path: "/GetCreditsBalance" }, ""],
  [{ m: "GET", path: "/RequestTransmittedDocs?issuerVatNumber=123456789&issuedFrom=2026-10-13&issuedTo=2026-10-13&series=INV-2026&aa=42" }, ""],
  [{ m: "GET", path: "/RequestTransmittedDocs?issuerVatNumber=123456789&uid=15B0B6AEB08979B44EE68110CD734458F22ED6DE" }, ""],
  [{ m: "GET", path: "/RequestTransmittedDocs?issuerVatNumber=1234" }, "query"],
  [{ m: "GET", path: "/RequestTransmittedDocs?series=%CE%A4" }, "path"],
  [{ m: "GET", path: "/GetInvoicePdf/abc.pdf" }, "path"],
  [{ m: "POST", path: "/CancelDeliveryNote", body: { mark: "1" } }, "path"],
  [{ m: "POST", path: "/SendInvoices", body: { invoice: [{ issuer: { vatNumber: "123456789" }, invoiceHeader: { invoiceType: "11.1" } }] } }, ""],
  [{ m: "POST", path: "/SendInvoices", body: { invoice: [{ issuer: { vatNumber: "123456789" }, invoiceHeader: { invoiceType: "8.6" } }] } }, "body"],
  [{ m: "POST", path: "/SendInvoices", body: { invoice: [{ issuer: { vatNumber: "123456789" }, invoiceHeader: { invoiceType: "11.1" }, uid: "X" }] } }, "body"],
  [{ m: "POST", path: "/SendInvoices", body: { invoice: [] } }, "body"],
  [{ m: "POST", path: "/SendInvoices", body: { invoice: [{}, {}] } }, "body"],
  [{ m: "POST", path: "/SendInvoices", body: { invoice: [{ issuer: { vatNumber: "123456789" }, invoiceHeader: { invoiceType: "11.1" } }], extra: 1 } }, "body"],
  [{ m: "POST", path: "/SendInvoices?skipSignature=false", body: { invoice: [{ issuer: { vatNumber: "123456789" }, invoiceHeader: { invoiceType: "11.1" } }] } }, "query"],
  [{ m: "POST", path: "/SendInvoices", body: { invoice: [{ issuer: { vatNumber: "123456789" }, invoiceHeader: { invoiceType: "11.1" }, invoiceDetails: ["x".repeat(70000)] }] } }, "body"]
];
test("checkReq (app) and checkExtReq (relay) agree on every timologisi.online case", () => {
  for (const [r, want] of TOL_CASES) {
    assert.equal(L.checkReq("tol", r), want, "app " + r.m + " " + r.path);
    assert.equal(X.checkExtReq("tol", r), want, "relay " + r.m + " " + r.path);
  }
});

// ---------- relay ----------
const ORIGIN = "https://useoros.online";
const ENV = { ALLOWED_ORIGINS: ORIGIN };
let ip = 100;
async function relay(body, f) {
  const r = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.8.0." + (ip++ % 250) }, body: JSON.stringify(body) });
  const res = await handle(r, ENV, null, Date.now(), f);
  return { status: res.status, json: await res.json() };
}
function mock(fn) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return fn ? fn(url, init) : new Response("{\"creditsBalance\":10}", { status: 200 }); };
  f.calls = calls;
  return f;
}
const tol = (o) => Object.assign({ op: "ext", p: "tol", env: "test", key: KEY, reqs: [{ m: "GET", path: "/GetCreditsBalance" }] }, o);

test("relay validation: environment instead of a host, key shape, body size", () => {
  assert.equal(X.validExt(tol({})), "");
  assert.equal(X.validExt(tol({ env: "live" })), "");
  assert.equal(X.validExt(tol({ env: "prod" })), "host");
  assert.equal(X.validExt(tol({ host: "evil.example" })), "host");
  assert.equal(X.validExt(tol({ key: "x" })), "key");
  const body = JSON.stringify({ invoice: [{ issuer: { vatNumber: "123456789" }, invoiceHeader: { invoiceType: "11.1" } }] });
  assert.equal(X.validExt(tol({ reqs: [{ m: "POST", path: "/SendInvoices", body }] })), "");
  assert.equal(X.validExt(tol({ reqs: [{ m: "POST", path: "/SendInvoices", body: body.slice(0, -1) }] })), "body");
});

test("relay: an invoice travels alone; a request never sent says skipped, not timeout", async () => {
  const body = JSON.stringify({ invoice: [{ issuer: { vatNumber: "123456789" }, invoiceHeader: { invoiceType: "11.1" } }] });
  const send = { m: "POST", path: "/SendInvoices", body };
  const get = { m: "GET", path: "/GetCreditsBalance" };
  assert.equal(X.validExt(tol({ reqs: [send, send] })), "reqs");
  assert.equal(X.validExt(tol({ reqs: [get, send] })), "reqs");
  assert.equal(X.validExt(tol({ reqs: [get, get] })), "");
  // the call's time is already gone when the requests would start
  let t = 0;
  const f = mock();
  const out = await X.runExt(tol({ reqs: [get, get] }), f, () => { t += 100000; return t; });
  assert.deepEqual(out.res || out, [{ err: "skipped" }, { err: "skipped" }]);
  assert.equal(f.calls.length, 0);
});

test("relay call: fixed host per environment, API-KEY header, key never echoed", async () => {
  const f = mock();
  const r = await relay(tol({ reqs: [{ m: "GET", path: "/GetCreditsBalance" }] }), f);
  assert.equal(r.json.ok, true);
  assert.equal(f.calls[0].url, "https://provider-dev.timologisi.online/api/v1/Provider/GetCreditsBalance");
  assert.equal(f.calls[0].init.headers["API-KEY"], KEY);
  assert.equal(f.calls[0].init.redirect, "manual");
  assert.equal(JSON.stringify(r.json).indexOf(KEY), -1);
  const g = mock();
  await relay(tol({ env: "live" }), g);
  assert.equal(g.calls[0].url, "https://provider.timologisi.online/api/v1/Provider/GetCreditsBalance");
  // a real document body goes through unchanged
  const d = doc({});
  const b = M.build(input(d)).body;
  const h = mock(() => new Response("{\"response\":[{\"statusCode\":\"Success\",\"invoiceMark\":1}]}", { status: 200 }));
  const s = await relay(tol({ reqs: [{ m: "POST", path: "/SendInvoices", body: JSON.stringify(b) }] }), h);
  assert.equal(s.json.ok, true);
  assert.deepEqual(JSON.parse(h.calls[0].init.body), b);
  assert.equal(h.calls[0].init.headers["Content-Type"], "application/json");
});
