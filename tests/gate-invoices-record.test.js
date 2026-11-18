// orOS Gate INV-EXT (7.52.00): invoices_record — documents issued
// elsewhere recorded in Invoices as kind "ext" (issued, never a draft,
// no orOS numbering), duplicates skipped by number or provider uid,
// clients matched or made, a payment that never goes to Budget by
// itself, a Budget area, invoice_list showing them, and undo.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global.window || {};
const G = require("../gate/gate.js");
const C = require("../invoices/core.js");
let R;
test.before(async () => { R = await import("../relay/gate.js"); });

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const budget = { ver: 1, tx: [], cats: [], acc: [], tombs: {}, set: { m: 0, cur: "EUR" },
  area: [{ id: "ar-pub", m: 1, col: 0, n: "Εκδόσεις", q: "" }, { id: "ar-snd", m: 1, col: 1, n: "Ηχοληψία", q: "" }] };
function base() {
  const d = C.empty();
  d.clients.push(C.normClient({ id: "cli-known", name: "Known Client S.A.", afm: "099999999", doy: "", job: "", addr: "", country: "", email: "", phone: "", note: "", m: 5 }));
  return C.normalize(d);
}
const DOC = { number: "ΤΠΥ0148", date: "2026-10-02", client: "Studio Example Ε.Π.Ε.", client_vat_id: "123456789",
  net: "600.00", vat: "144.00", withholding: "120.00", total_payable: "624.00",
  lines: [{ text: "Sound engineering", qty: 1, price: "600.00", vat_rate: 24 }],
  paid: { method: "bank", date: "2026-10-05" }, mark: "400001234567890", mydata_type: "2.1",
  provider_uid: "UID-1", auth_code: "AUTH-1", area: "Ηχοληψία", source: "timologisi.online" };

test("records an issued-elsewhere document: ext, issued, own number, totals, client, payment without Budget, extras", () => {
  const r = G.invoicesRecord(C, base(), budget, { documents: [DOC, { number: "TIM0128", date: "2026-01-08", client: "known client s.a.", net: "16.98", vat: "1.02" }] }, NOW);
  assert.equal(r.ok, true, r.err);
  assert.equal(r.ids.length, 2);
  assert.deepEqual(r.skipped, []);
  const d = r.data, x = C.anyId(d.docs, r.ids[0].id);
  assert.equal(x.kind, "ext");
  assert.equal(x.st, "issued");
  assert.equal(x.ser, "");
  assert.equal(x.seq, 0);
  assert.equal(x.num, "ΤΠΥ0148");
  assert.equal(x.xnet, 60000);
  assert.equal(x.xvat, 14400);
  assert.equal(x.wht, 20);
  assert.equal(C.totals(x).pay, 62400);
  assert.equal(x.c.afm, "123456789");
  assert.equal(x.dm, "ar-snd");
  assert.equal(x.xs, "timologisi.online");
  assert.equal(x.xu, "UID-1");
  assert.equal(x.xa, "AUTH-1");
  assert.equal(x.xt, "2.1");
  assert.equal(x.mark, "400001234567890");
  assert.equal(x.xl.length, 1);
  assert.equal(x.xl[0].p, 60000);
  // a new client was made; the second document found the known one by name
  const cl = C.live(d.clients);
  assert.equal(cl.length, 2);
  assert.equal(C.anyId(d.docs, r.ids[1].id).cli, "cli-known");
  // one payment of the whole amount, no ab: Budget's links never take it
  const pays = C.live(d.pays);
  assert.equal(pays.length, 1);
  assert.equal(pays[0].amt, 62400);
  assert.equal(pays[0].how, "bank");
  assert.equal(pays[0].ab, undefined);
  assert.equal(C.status(d, x, "2026-11-18"), "paid");
  assert.equal(C.status(d, C.anyId(d.docs, r.ids[1].id), "2026-11-18"), "unpaid");
  // opening Invoices rewrites nothing (canonical, R26)
  assert.deepEqual(C.normalize(JSON.parse(JSON.stringify(d))), d);
  // the lines and extras survive a merge both ways (R5)
  assert.deepEqual(C.mergeInvoices(d, base()), C.mergeInvoices(base(), d));
  assert.equal(C.anyId(C.mergeInvoices(base(), d).docs, r.ids[0].id).xl.length, 1);
});

test("duplicates by number or provider uid are skipped, not refused; nothing new = no data", () => {
  const r1 = G.invoicesRecord(C, base(), budget, { documents: [DOC] }, NOW);
  const again = G.invoicesRecord(C, r1.data, budget, { documents: [Object.assign({}, DOC, { number: "ΤΠΥ 0148" }), Object.assign({}, DOC, { number: "X1" })] }, NOW + 1000);
  assert.equal(again.ok, true);
  assert.equal(again.data, null);
  assert.equal(again.skipped.length, 2);
  const twice = G.invoicesRecord(C, base(), null, { documents: [{ number: "A1", date: "2026-01-01", client: "Z", net: "1", vat: "0" }, { number: "a1", date: "2026-01-02", client: "Z", net: "2", vat: "0" }] }, NOW);
  assert.equal(twice.ids.length, 1);
  assert.match(twice.skipped[0].why, /twice/);
});

test("checks: all or none, amounts, withholding, total, area, type, size", () => {
  const bad = (doc, re, b) => { const r = G.invoicesRecord(C, base(), b === undefined ? budget : b, { documents: [DOC, doc] }, NOW); assert.equal(r.ok, false); assert.match(r.err, re); };
  bad(Object.assign({}, DOC, { number: "" }), /number is required/);
  bad(Object.assign({}, DOC, { number: "N2", date: "02/10/2026" }), /date/);
  bad(Object.assign({}, DOC, { number: "N2", net: "abc" }), /net/);
  bad(Object.assign({}, DOC, { number: "N2", total_payable: "625.00" }), /total_payable/);
  bad(Object.assign({}, DOC, { number: "N2", withholding: "120.00", net: "0", vat: "0", total_payable: undefined }), /withholding/);
  bad(Object.assign({}, DOC, { number: "N2", area: "Nowhere" }), /no Budget area/);
  bad(Object.assign({}, DOC, { number: "N2" }), /Budget has no areas/, null);
  bad(Object.assign({}, DOC, { number: "N2", mydata_type: "ΤΠΥ" }), /mydata_type/);
  bad(Object.assign({}, DOC, { number: "N2", paid: { method: "cheque" } }), /paid must be/);
  assert.equal(G.invoicesRecord(C, base(), budget, { documents: [] }, NOW).ok, false);
  assert.equal(G.invoicesRecord(C, base(), budget, { documents: new Array(101).fill(DOC) }, NOW).ok, false);
  // an odd withholding on a small net still finds its 2-decimal rate
  const w = G.invoicesRecord(C, base(), null, { documents: [{ number: "W1", date: "2026-03-01", client: "Q", net: "82.00", vat: "19.68", withholding: "16.40", total_payable: "85.28" }] }, NOW);
  assert.equal(w.ok, true, w.err);
  assert.equal(C.totals(C.anyId(w.data.docs, w.ids[0].id)).pay, 8528);
});

test("invoice_list shows them with lines, area, source and provider fields", () => {
  const r = G.invoicesRecord(C, base(), budget, { documents: [DOC] }, NOW);
  const l = G.invoiceList(C, r.data, { from: "2026-01-01", to: "2026-12-31" }, "2026-11-18", budget);
  assert.equal(l.ok, true);
  const o = l.data.documents[0];
  assert.equal(o.kind, "issued elsewhere");
  assert.equal(o.number, "ΤΠΥ0148");
  assert.equal(o.status, "paid");
  assert.equal(o.withheld, "120.00");
  assert.equal(o.to_pay, "624.00");
  assert.equal(o.area, "Ηχοληψία");
  assert.equal(o.source, "timologisi.online");
  assert.equal(o.provider_uid, "UID-1");
  assert.equal(o.auth_code, "AUTH-1");
  assert.equal(o.mydata_type, "2.1");
  assert.deepEqual(o.lines, [{ text: "Sound engineering", qty: 1, price: "600.00", vat_rate: 24 }]);
  // without Budget (not readable) the area is left out, the rest stays
  assert.equal(G.invoiceList(C, r.data, { from: "2026-01-01", to: "2026-12-31" }, "2026-11-18").data.documents[0].area, undefined);
});

test("undo takes back what it made while unchanged; a client in other use stays", () => {
  const r = G.invoicesRecord(C, base(), budget, { documents: [DOC] }, NOW);
  const u = G.invoicesUndo(C, r.data, r.undo, NOW + 5000);
  assert.equal(u.ok, true);
  assert.equal(u.n, 1);
  assert.equal(C.live(u.data.docs).length, 0);
  assert.equal(C.live(u.data.pays).length, 0);
  assert.equal(C.live(u.data.clients).length, 1, "the made client goes, the known one stays");
  // changed since in Invoices: kept
  const d2 = JSON.parse(JSON.stringify(r.data));
  d2.docs.forEach((x) => { if (x.id === r.ids[0].id) { x.notes = "edited"; x.m = NOW + 100; } });
  const k = G.invoicesUndo(C, d2, r.undo, NOW + 5000);
  assert.equal(k.n, 0);
  assert.ok(k.kept >= 1);
});

test("wiring: own write of Invoices, queued with orOS closed, relay names it and its app", () => {
  assert.deepEqual(G.OWN_WRITES.invoices, ["invoices_record"]);
  assert.ok(G.QUEUED.indexOf("invoices_record") >= 0);
  assert.equal(G.WRITES.invoices, undefined, "Invoices stays an ACT app (change_item, create_items)");
  assert.ok(G.ACT.indexOf("invoices") >= 0);
  const t = R.TOOLS.find((x) => x.name === "invoices_record");
  assert.ok(t);
  assert.equal(t.annotations.readOnlyHint, false);
  assert.equal(t.inputSchema.properties.documents.maxItems, 100);
  assert.equal(R.pendApp("invoices_record", {}), "invoices");
});
