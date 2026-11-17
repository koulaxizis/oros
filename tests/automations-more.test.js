// BR-EV-2 (gap review proposal 6, 2026-11-17): new Automations events
// (Forms, Billing, Kanban, Stock, Scanner & PDF, Transfer) and the tap
// steps card (Kanban), crm (CRM) and record (Base).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../automations/core.js");
const A = require("../assistant/core.js");
const IC = require("../invoices/core.js");
const CRM = require("../crm/core.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const NEW = ["forms.answer", "invoices.paid", "invoices.overdue", "kanban.done", "stock.low", "scanpdf.signed", "transfer.received"];
const APP = { "forms.answer": "forms", "invoices.paid": "invoices", "invoices.overdue": "invoices", "kanban.done": "kanban",
              "stock.low": "stock", "scanpdf.signed": "scanpdf", "transfer.received": "transfer" };

test("the new events are BR-EV events of their apps, with words in EN, EL and DE", () => {
  const de = read("i18n/de/automations.js");
  NEW.forEach((ev) => {
    assert.ok(C.EVENTS.includes(ev), ev);
    assert.equal(C.EVENT_APP[ev], APP[ev], ev);
    assert.ok(C.STRINGS.en["ev." + ev] && C.STRINGS.el["ev." + ev], ev + " EN/EL");
    assert.ok(de.includes('"ev.' + ev + '":'), ev + " DE");
    assert.ok(C.cleanWhen({ t: "event", ev: ev, word: "acme" }), ev + " clean");
  });
  ["act.card", "act.crm", "act.record"].concat(["form-answer", "invoice-paid", "invoice-overdue", "stock-low", "card-done", "signed-in", "transfer-in"]
    .reduce((a, id) => a.concat(["tpl." + id]), [])).forEach((k) => {
    assert.ok(C.STRINGS.en[k] && C.STRINGS.el[k], k + " EN/EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  });
  const app = read("automations/app.js");
  ["a.card", "a.crm", "a.record", "x.board", "x.column", "x.crmKind", "x.crmWho", "x.table", "x.recName", "x.tapHint",
   "k.call", "k.mail", "k.meet", "k.msg", "k.note"].forEach((k) => {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k + " EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  });
});

test("a rule follows a new event once per signal key, with its word", () => {
  const rule = C.cleanRule({ id: "r1", m: 1, name: "Paid", on: true, when: { t: "event", ev: "invoices.paid", word: "acme" },
    "do": [{ a: "notify", text: "{text}" }] });
  const sig = { kind: "event", name: "invoices.paid", key: "invoices:d1:paid:p1", text: "INV-1 · ACME Ltd · 120,00 €" };
  const k = C.matches(rule, sig, Date.now());
  assert.match(k, /^r1@s/);
  assert.equal(C.matches(rule, Object.assign({}, sig), Date.now()), k, "same key on every device");
  assert.equal(C.matches(rule, Object.assign({}, sig, { text: "INV-2 · Other" }), Date.now()), null);
  assert.equal(C.matches(rule, Object.assign({}, sig, { name: "invoices.overdue" }), Date.now()), null);
});

test("card, crm and record are tap steps that open the app prefilled (AUTO-2)", () => {
  const card = C.cleanAction({ a: "card", title: " New: {text} ", board: "Sales", column: "To do", note: "from a form", junk: 1 });
  assert.deepEqual(card, { a: "card", title: "New: {text}", board: "Sales", column: "To do", note: "from a form" });
  assert.equal(C.cleanAction({ a: "card" }), null);
  const crm = C.cleanAction({ a: "crm", text: "Paid: {text}", k: "bogus", who: "ACME" });
  assert.deepEqual(crm, { a: "crm", text: "Paid: {text}", k: "note", who: "ACME" });
  assert.equal(C.cleanAction({ a: "crm", text: "  " }), null);
  const rec = C.cleanAction({ a: "record", text: "Order {text}", table: "Orders" });
  assert.deepEqual(rec, { a: "record", text: "Order {text}", table: "Orders" });
  assert.equal(C.cleanAction({ a: "record" }), null);

  const at = new Date(2026, 10, 17, 10, 0).getTime();
  assert.deepEqual(C.call(card, at, "en", "Automations", "INV-1"),
    { fn: "openAt", app: "kanban", arg: { asNew: { title: "New: INV-1", board: "Sales", column: "To do", note: "from a form" } } });
  assert.deepEqual(C.call(crm, at, "en", "Automations", "INV-1 · ACME"),
    { fn: "openAt", app: "crm", arg: { autoLog: { text: "Paid: INV-1 · ACME", k: "note", from: "Automations", who: "ACME" } } });
  assert.deepEqual(C.call(rec, at, "en", "Automations", "42"),
    { fn: "openAt", app: "base", arg: { newRecord: { text: "Order 42", from: "Automations", table: "Orders" } } });
  assert.equal(C.needs(card), "kanban");
  assert.equal(C.needs(crm), "crm");
  assert.equal(C.needs(rec), "base");
  const r = C.cleanRule({ id: "r2", m: 1, name: "x", on: true, when: { t: "event", ev: "forms.answer" }, "do": [card, crm, rec] });
  assert.equal(C.pending(r).length, 3);
  assert.ok(!C.runnable(r, ["kanban", "crm"]));
  assert.ok(C.runnable(r, ["kanban", "crm", "base"]));
  assert.equal(C.actText(card, "el"), "νέα κάρτα στο Kanban");
});

test("the new ready-made rules are valid in every language", () => {
  ["en", "el"].forEach((l) => {
    C.templates(l).forEach((tp) => assert.ok(C.cleanRule(Object.assign({ id: "t" }, tp.rule)), tp.id + " " + l));
  });
  const paid = C.fromTemplate("invoice-paid", "en");
  assert.equal(paid.when.ev, "invoices.paid");
  assert.deepEqual(paid["do"][1], { a: "crm", k: "note", text: "Paid: {text}" });
  assert.equal(C.fromTemplate("signed-in", "el")["do"][1].a, "card");
});

test("invoices.overdue: only issued documents 1-7 days past due that still owe", () => {
  const line = { q: 1, p: 10000, disc: 0, vat: 24 };
  const doc = (id, due, extra) => Object.assign({ id: id, kind: "inv", st: "issued", num: "A-" + id, cur: "EUR", due: due, lines: [line], c: { name: "ACME" } }, extra || {});
  const data = { docs: [doc("1", "2026-11-14"), doc("2", "2026-11-01"), doc("3", "2026-11-16"), doc("4", "2026-11-20"),
                        doc("5", "2026-11-15", { st: "draft" }), doc("6", "2026-11-15")],
                 pays: [{ id: "p6", doc: "6", date: "2026-11-10", amt: 12400, how: "bank", m: 1 }], clients: [] };
  const list = C.overdueList(IC, data, "2026-11-17");
  assert.deepEqual(list.map((x) => x.key), ["invoices:1:over:2026-11-14", "invoices:3:over:2026-11-16"]);
  assert.equal(list[0].late, 3);
  assert.equal(list[0].bal, 12400);
  assert.equal(list[0].party, "ACME");
  assert.deepEqual(C.overdueList(null, data, "2026-11-17"), []);
  assert.deepEqual(C.overdueList(IC, null, "2026-11-17"), []);
});

test("CRM: autoLog prefill and the customer it guesses", () => {
  const d = { cust: [{ id: "a", name: "Acme Ltd", email: "pay@acme.gr" }, { id: "b", name: "Παπαδόπουλος" }, { id: "c", name: "Ac" }] };
  assert.equal(CRM.autoLog({ text: "" }), null);
  assert.deepEqual(CRM.autoLog({ text: "Hi", k: "call" }), { text: "Hi", k: "call", who: "" });
  assert.equal(CRM.autoLog({ text: "Hi", k: "x" }).k, "note");
  assert.equal(CRM.autoLogCust(d, CRM.autoLog({ text: "anything", who: "acme ltd" })).id, "a");
  assert.equal(CRM.autoLogCust(d, CRM.autoLog({ text: "mail from pay@acme.gr today" })).id, "a");
  assert.equal(CRM.autoLogCust(d, CRM.autoLog({ text: "A-1 · ΠΑΠΑΔΟΠΟΥΛΟΣ · 10 €" })).id, "b");
  assert.equal(CRM.autoLogCust(d, CRM.autoLog({ text: "nobody here" })), null);
  const crm = read("crm/crm.js");
  assert.match(crm, /if \(x\.autoLog\) return autoLogTo\(x\.autoLog\);/);
  assert.match(crm, /logEditor\(null, cid, \{ k: n\.k, at: Date\.now\(\), text: n\.text \}\)/);
});

test("Kanban: which column is a done column", () => {
  const T = require("../kanban/tools.js");
  const b = { columns: [{ id: "c1" }, { id: "c2" }, { id: "c3" }] };
  assert.ok(T.isDoneCol(b, "c3"));
  assert.ok(!T.isDoneCol(b, "c2"));
  b.columns[1].auto = { done: true };
  assert.ok(T.isDoneCol(b, "c2"));
  assert.ok(!T.isDoneCol(b, "c3"));
  assert.ok(!T.isDoneCol({ columns: [{ id: "only" }] }, "only"));
});

test("the apps give the signals, only for what happened on this device", () => {
  const forms = read("forms/app.js");
  assert.match(forms, /ev\.emit\("forms\.answer", "forms:" \+ fid \+ ":" \+ aid, title\)/);
  assert.match(forms, /if \(fresh\.length\) answerEvents\(id, title, fresh\);/);
  const inv = read("invoices/invoices.js");
  assert.match(inv, /ev\.emit\("invoices\.paid", "invoices:" \+ d\.id \+ ":paid:" \+ payId, said\)/);
  assert.equal(inv.split("paidEvent(").length - 1, 3, "defined once, called from addPayment and the payment editor");
  const kb = read("kanban/kanban.js");
  assert.match(kb, /if \(T\.isDoneCol\(board, colId\)\) doneEvent\(board, col, cardId\);/);
  assert.match(kb, /ev\.emit\("kanban\.done", "kanban:" \+ cardId/);
  const sh = read("shell.js");
  assert.match(sh, /if \(!baseline\) stockLowEvents\(data, low, st\.fresh\);/);
  assert.match(sh, /E\.emit\("stock\.low", "stock:" \+ id \+ ":" \+ last/);
  const sp = read("scanpdf/scanpdf.js");
  assert.match(sp, /if \(got\.st === "signed"\) signedEvent\(it, got\);/);
  assert.match(sp, /ev\.emit\("scanpdf\.signed", "scanpdf:" \+ it\.id, said\)/);
  const tr = read("transfer/app.js");
  assert.match(tr, /root\.orosEvents\.emit\("transfer\.received", "transfer:" \+ item\.id, said\)/);
  const host = read("automations/host.js");
  assert.match(host, /C\.overdueList\(root\.OrosInvoicesCore, readJSON\("oros-invoices-data"\), C\.ymdOf\(now\)\)/);
  assert.match(host, /local\.sk\.indexOf\(rk\) >= 0/);
  const base = read("base/app.js");
  assert.match(base, /if \(tg\.newRecord\) \{ closeAllDialogs\(\); autoRecord\(tg\.newRecord\); return; \}/);
  ["ar.title", "ar.table", "ar.text", "ar.add", "ar.none"].forEach((k) => {
    assert.equal(base.split('"' + k + '":').length - 1, 2, k + " EN and EL");
    assert.ok(read("i18n/de/base.js").includes('"' + k + '":'), k + " DE");
  });
});

test("Assistant and Gate: propose_rule knows the new events and steps", () => {
  const all = () => true;
  const tool = A.toolsFor({ rules: true }).find((t) => t.name === "propose_rule");
  NEW.forEach((ev) => assert.ok(tool.params.properties.when.properties.event.enum.includes(ev), ev));
  ["card", "crm", "record"].forEach((s) => assert.ok(tool.params.properties.steps.items.properties.do.enum.includes(s), s));
  const r = A.normRule({ name: "Signed", when: { type: "event", event: "scanpdf.signed" },
    steps: [{ do: "card", title: "{text}", board: "Contracts", column: "Done" }, { do: "crm", text: "Signed: {text}", kind: "mail", customer: "ACME" },
            { do: "record", text: "{text}", table: "Contracts" }] }, all);
  assert.ok(r.ok, r.err);
  assert.deepEqual(r.rule["do"], [{ a: "card", title: "{text}", board: "Contracts", column: "Done" },
    { a: "crm", text: "Signed: {text}", k: "mail", who: "ACME" }, { a: "record", text: "{text}", table: "Contracts" }]);
  const miss = A.normRule({ when: { type: "event", event: "stock.low" }, steps: [{ do: "record", text: "x" }] }, (id) => id !== "base");
  assert.match(miss.err, /base/);
  assert.match(A.normRule({ when: { type: "event", event: "kanban.done", app: "passwords" }, steps: [{ do: "notify", text: "x" }] }, all).err, /Passwords/);
});
