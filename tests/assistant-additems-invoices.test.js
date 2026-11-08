// Assistant / Gate: invoice drafts saved straight away (AS-ADD8,
// GATE-PAR P4, assistant/additems3.js). A draft is what Invoices'
// prefillNew + saveDraft would write (opening Invoices rewrites
// nothing), never issued (no number, no series), a known client is
// linked, an unknown one is only the draft's party, look-alike drafts
// start unticked, and Undo removes only a draft nobody changed.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../assistant/additems.js");
require("../assistant/additems3.js");
const core = require("../assistant/core.js");
const IC = require("../invoices/core.js");

const NOW = new Date(2026, 10, 8, 12, 0).getTime();
const CTX = { today: "2026-11-08", lang: "en" };
const clone = (x) => JSON.parse(JSON.stringify(x));
function items(list) { const n = A.normItems({ app: "invoices", items: list }, CTX); assert.equal(n.ok, true, n.err); return n.items; }
function err(list) { const n = A.normItems({ app: "invoices", items: list }, CTX); assert.equal(n.ok, false); return n.err; }
function base() {
  const d = IC.empty();
  d.prof = Object.assign({}, d.prof, { name: "Me", vat: 24, days: 15, cur: "EUR", terms: "IBAN GR00", m: 5 });
  d.clients.push(IC.normClient({ id: "cl-abc1", name: "Γλαρόλυκοι ΙΚΕ", afm: "123456789", doy: "Α' Αθηνών", m: 3 }));
  return IC.normalize(d);
}

test("invoices: a draft saved at once, as Invoices writes it; known client linked; never issued", () => {
  assert.ok(A.APP_IDS.includes("invoices"));
  assert.equal(A.storageKey("invoices"), "oros-invoices-data");
  const d = base();
  const it = items([{ client: "γλαρολυκοι ικε", lines: [{ text: "Editing", qty: 2, price: 45.5 }, { text: "Cover", qty: 1, price: 100, vat: 13 }], note: "Thanks" },
                    { client: "New Shop", tax_id: "999 888 777", lines: [{ text: "Books", qty: 10, price: 8 }], date: "2026-11-01", currency: "USD" }]);
  const p = A.plan("invoices", clone(d), it, CTX);
  assert.equal(p.ok, true, p.err);
  assert.equal(p.rows.length, 2);
  assert.ok(p.rows[0].fields.some((f) => f[0] === "amount" && f[1] === "225.84 EUR"));   // 191 net + 21.84 + 13
  assert.ok(p.rows[1].fields.some((f) => f[0] === "client" && /new$/.test(f[1])));
  const r = A.apply("invoices", clone(d), it, NOW, [false, false], CTX);
  assert.equal(r.ok, true, r.err);
  assert.equal(r.made.length, 2);
  assert.equal(JSON.stringify(IC.normalize(r.data)), JSON.stringify(r.data), "opening Invoices rewrites nothing");
  const a = IC.doc(r.data, r.made[0].id), b = IC.doc(r.data, r.made[1].id);
  assert.equal(a.st, "draft"); assert.equal(a.num, ""); assert.equal(a.seq, 0); assert.equal(a.ser, "");
  assert.equal(a.kind, "inv");
  assert.equal(a.cli, "cl-abc1");
  assert.equal(a.c.afm, "123456789");
  assert.equal(a.date, "2026-11-08"); assert.equal(a.due, "2026-11-23");
  assert.equal(a.terms, "IBAN GR00"); assert.equal(a.notes, "Thanks");
  assert.deepEqual(a.lines.map((l) => [l.d, l.q, l.p, l.vat]), [["Editing", 2, 4550, 24], ["Cover", 1, 10000, 13]]);
  assert.equal(b.cli, ""); assert.equal(b.c.name, "New Shop"); assert.equal(b.c.afm, "999888777");
  assert.equal(b.cur, "USD"); assert.equal(b.date, "2026-11-01");
  assert.equal(IC.live(r.data.clients).length, 1, "no client is made");
  assert.deepEqual(r.made[0].target, { invoice: a.id });
  // the same draft again is a look-alike (unticked)
  const p2 = A.plan("invoices", clone(r.data), it.slice(0, 1), CTX);
  assert.equal(p2.rows[0].dup.id, a.id);
  // Undo removes the drafts while unchanged
  const u = A.undo("invoices", clone(r.data), r.undo, NOW + 1000);
  assert.equal(u.ok, true, u.err);
  assert.equal(IC.live(u.data.docs).length, 0);
  assert.ok(u.data.docs.every((x) => x.del === 1 && x.m > NOW));
});

test("invoices: a draft changed or issued since is not undone", () => {
  const d = base();
  const r = A.apply("invoices", clone(d), items([{ client: "X", lines: [{ text: "A", qty: 1, price: 1 }] }]), NOW, null, CTX);
  const x = clone(r.data);
  const doc = x.docs.find((y) => y.id === r.made[0].id);
  doc.st = "issued"; doc.num = "1"; doc.seq = 1; doc.m = NOW + 50;
  const u = A.undo("invoices", IC.normalize(x), r.undo, NOW + 100);
  assert.equal(u.ok, false);
  assert.match(u.err, /changed or issued/);
});

test("invoices: bad input is refused with the reason; never opened = empty Invoices", () => {
  assert.match(err([{ client: "X" }]), /lines is required/);
  assert.match(err([{ lines: [{ text: "A", qty: 0, price: 1 }] }]), /qty must be more than 0/);
  assert.match(err([{ lines: [{ text: "A", qty: 1 }] }]), /price is required/);
  assert.match(err([{ lines: [{ text: "A", qty: 1, price: 1 }], currency: "euro" }]), /currency/);
  assert.match(err([{ lines: [{ text: "x".repeat(201), qty: 1, price: 1 }] }]), /200/);
  const p = A.plan("invoices", null, items([{ lines: [{ text: "A", qty: 1, price: 1 }] }]), CTX);
  assert.equal(p.ok, true);
  assert.equal(A.plan("invoices", { nope: 1 }, items([{ lines: [{ text: "A", qty: 1, price: 1 }] }]), CTX).ok, false);
});

test("invoices in create_items: the tool, the prompt, the Gate", () => {
  const t = core.toolsFor({ data: 1, creates: ["invoices"] }).find((x) => x.name === "create_items");
  assert.deepEqual(t.params.properties.app["enum"], ["invoices"]);
  ["client", "tax_id", "lines", "currency", "note", "date"].forEach((k) => assert.ok(t.params.properties.items.items.properties[k], k));
  assert.match(t.params.properties.app.description, /DRAFT/);
  const src = require("fs").readFileSync(require("path").join(__dirname, "../assistant/assistant.js"), "utf8");
  assert.match(src, /ADD3_IDS = \[[^\]]*"invoices"/);
  assert.match(src, /invoices: \["OrosInvoicesCore", "\.\.\/invoices\/core\.js"\]/);
});

// ---------- Quote Builder (AS-ADD8) ----------
const QC = require("../quote/core.js");
function qitems(list) { const n = A.normItems({ app: "quote", items: list }, CTX); assert.equal(n.ok, true, n.err); return n.items; }
function qbase() {
  return QC.canonState({ ver: 1, om: 10, deleted: {}, quotes: [{ id: "q1", num: "OFF-2026-004", clientId: "c1", status: "sent", date: "2026-10-01", dueDate: "", currency: "EUR",
    items: [], gDisc: 0, payment: "", notes: "", instalments: [], mtime: 10, pos: 0 }],
    clients: [{ id: "c1", name: "ACME", email: "", phone: "", address: "", taxId: "", mtime: 5, pos: 0 }], templates: [], payMethods: [] });
}

test("quote: new quotes in Quote's canonical form, next OFF number, client matched or made; Undo", () => {
  assert.ok(A.APP_IDS.includes("quote"));
  assert.equal(A.storageKey("quote"), "oros-quote-data");
  const d = qbase();
  const it = qitems([{ client: "acme", lines: [{ text: "Design", qty: 3, price: 50 }] }, { client: "Beta", tax_id: "123", lines: [{ text: "Print", qty: 100, price: 1.2, vat: 6 }], currency: "GBP" }]);
  const p = A.plan("quote", clone(d), it, CTX);
  assert.equal(p.ok, true, p.err);
  assert.deepEqual(p.rows.map((r) => r.fields.find((f) => f[0] === "num")[1]), ["OFF-2026-005", "OFF-2026-006"]);
  assert.ok(p.rows[0].fields.some((f) => f[0] === "amount" && f[1] === "186.00 EUR"));
  const r = A.apply("quote", clone(d), it, NOW, [false, false], CTX);
  assert.equal(r.ok, true, r.err);
  assert.equal(JSON.stringify(QC.canonState(r.data)), JSON.stringify(r.data), "opening Quote rewrites nothing");
  assert.equal(JSON.stringify(QC.merge(r.data, r.data)), JSON.stringify(r.data));
  const [a, b] = r.made.map((m) => r.data.quotes.find((q) => q.id === m.id));
  assert.equal(a.num, "OFF-2026-005"); assert.equal(b.num, "OFF-2026-006");
  assert.equal(a.status, "draft"); assert.equal(a.clientId, "c1"); assert.equal(a.date, "2026-11-08");
  assert.deepEqual(a.items.map((x) => [x.desc, x.qty, x.price, x.vat]), [["Design", 3, 50, 24]]);
  const beta = r.data.clients.find((c) => c.name === "Beta");
  assert.ok(beta); assert.equal(beta.taxId, "123"); assert.equal(b.clientId, beta.id); assert.equal(b.currency, "GBP");
  assert.ok(r.data.om > 10);
  // the same quote again: a look-alike
  assert.equal(A.plan("quote", clone(r.data), it.slice(0, 1), CTX).rows[0].dup.id, a.id);
  // a merge with the old copy keeps them (another device)
  assert.equal(QC.merge(d, r.data).quotes.length, 3);
  const u = A.undo("quote", clone(r.data), r.undo, NOW + 1000);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.quotes.map((q) => q.id), ["q1"]);
  assert.deepEqual(u.data.clients.map((c) => c.id), ["c1"], "the client it made goes too");
  assert.equal(QC.merge(r.data, u.data).quotes.length, 1, "the deletion wins over the old copy");
});

test("quote: a quote changed since is not undone; never opened = empty Quote", () => {
  const r = A.apply("quote", null, qitems([{ lines: [{ text: "A", qty: 1, price: 1 }] }]), NOW, null, CTX);
  assert.equal(r.ok, true, r.err);
  assert.equal(r.data.quotes[0].num, "OFF-2026-001");
  const x = clone(r.data); x.quotes[0].status = "sent"; x.quotes[0].mtime = NOW + 5;
  const u = A.undo("quote", x, r.undo, NOW + 10);
  assert.equal(u.ok, false);
});

// ---------- Wiki (AS-ADD9) ----------
const WC = require("../wiki/core.js");
function witems(list) { const n = A.normItems({ app: "wiki", items: list }, CTX); assert.equal(n.ok, true, n.err); return n.items; }
test("wiki: new articles as Wiki writes them, with their first revision file; titles taken refused; Undo", () => {
  assert.ok(A.APP_IDS.includes("wiki"));
  const d = WC.merge({ ver: 1, wikis: [{ id: "wabcdef1", m: 5, n: "Garden", main: "" }], arts: [{ id: "aabcdef1", m: 6, w: "wabcdef1", t: "Tomatoes", x: "Sun.", r: "rabcdef1", anc: [], alt: [] }], tombs: {} }, null);
  assert.match(A.plan("wiki", clone(d), witems([{ title: "tomatoes", text: "x" }]), CTX).err, /already has an article/);
  const it = witems([{ title: "Basil", text: "Needs [[Tomatoes]] nearby." }, { title: "Mint", text: "Spreads." }]);
  const p = A.plan("wiki", clone(d), it, CTX);
  assert.equal(p.ok, true, p.err);
  const r = A.apply("wiki", clone(d), it, NOW, [false, false], CTX);
  assert.equal(r.ok, true, r.err);
  assert.equal(JSON.stringify(WC.merge(r.data, null)), JSON.stringify(r.data), "opening Wiki rewrites nothing");
  assert.equal(r.data.arts.length, 3);
  assert.equal(r.disk.length, 2);
  const a = WC.byId(r.data, r.made[0].id);
  assert.equal(a.t, "Basil"); assert.equal(a.w, "wabcdef1");
  assert.equal(r.disk[0].path, WC.revPath(a.id, a.m, a.r));
  assert.equal(WC.parseRevFile(r.disk[0].text).x, a.x);
  const u = A.undo("wiki", clone(r.data), r.undo, NOW + 1000);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.arts.map((x) => x.t), ["Tomatoes"]);
  assert.equal(WC.merge(r.data, u.data).arts.length, 1, "the deletion wins over the old copy");
  // several wikis: the wiki must be named
  const d2 = WC.merge(Object.assign(clone(d), { wikis: d.wikis.concat([{ id: "wabcdef2", m: 5, n: "Work", main: "" }]) }), null);
  assert.match(A.plan("wiki", d2, witems([{ title: "X", text: "y" }]), CTX).err, /several wikis/);
  assert.equal(A.plan("wiki", d2, witems([{ title: "X", text: "y", wiki: "work" }]), CTX).ok, true);
  assert.match(A.plan("wiki", null, witems([{ title: "X", text: "y" }]), CTX).err, /no wiki yet/);
});

// ---------- Flashcards (AS-ADD9) ----------
const FC = require("../flashcards/core.js");
function fitems(list) { const n = A.normItems({ app: "flashcards", items: list }, CTX); assert.equal(n.ok, true, n.err); return n.items; }
function fdata() {
  const slice = FC.addDeck(FC.normalize(null), "Greek", 5, { id: "dgreek1" });
  const old = { id: "nold0001", m: 7, k: "basic", dk: "d0", f: { q: "Hello", a: "Γεια" }, tg: [] };
  return { slice, notes: [old], own: { path: FC.NOTES_DIR + "/x.json", dev: "devabc", items: [] } };
}
test("flashcards: basic, reversed and cloze notes go into the Assistant's own notes file; Undo deletes them", () => {
  assert.ok(A.APP_IDS.includes("flashcards"));
  const it = fitems([
    { front: "Cat", back: "Γάτα", deck: "greek", labels: ["animals"] },
    { front: "Dog", back: "Σκύλος", both: true },
    { cloze: "{{c1::Athens}} is the capital of Greece", back: "Since 1834" }
  ]);
  const d = fdata();
  const p = A.plan("flashcards", clone(d), it, CTX);
  assert.equal(p.ok, true, p.err);
  assert.equal(p.rows.length, 3);
  const r = A.apply("flashcards", clone(d), it, NOW, [false, false, false], CTX);
  assert.equal(r.ok, true, r.err);
  assert.equal(r.data.own.items.length, 3);
  assert.equal(r.data.notes.length, 4);
  const byQ = (q) => r.data.own.items.find((n) => (n.f.q || n.f.x) === q);
  assert.equal(byQ("Cat").dk, "dgreek1"); assert.deepEqual(byQ("Cat").tg, ["animals"]);
  assert.equal(byQ("Dog").k, "rev"); assert.equal(byQ("Dog").dk, "d0");
  const cz = r.data.own.items.find((n) => n.k === "cloze");
  assert.equal(cz.f.e, "Since 1834");
  r.data.own.items.forEach((n) => assert.deepEqual(FC.normNote(n), n, "as Flashcards writes it"));
  const u = A.undo("flashcards", clone(r.data), r.undo, NOW + 1000);
  assert.equal(u.ok, true, u.err);
  assert.equal(FC.liveNotes(FC.foldNotes({}, u.data.notes)).length, 1);
  assert.ok(u.data.own.items.every((n) => n.del));
});
test("flashcards: unknown deck, bad cloze, no disk, never opened are refused; a changed note is not undone", () => {
  const d = fdata();
  assert.match(A.plan("flashcards", clone(d), fitems([{ front: "a", back: "b", deck: "French" }]), CTX).err, /no deck named/);
  assert.equal(A.normItems({ app: "flashcards", items: [{ cloze: "no gaps" }] }, CTX).ok, false);
  assert.equal(A.normItems({ app: "flashcards", items: [{ front: "only front" }] }, CTX).ok, false);
  assert.match(A.plan("flashcards", Object.assign(clone(d), { own: null }), fitems([{ front: "a", back: "b" }]), CTX).err, /disk is not reachable/);
  assert.match(A.plan("flashcards", null, fitems([{ front: "a", back: "b" }]), CTX).err, /has not been opened/);
  const p = A.plan("flashcards", clone(d), fitems([{ front: "hello", back: "x" }]), CTX);
  assert.ok(p.rows[0].dup, "same front = already there");
  const it = fitems([{ front: "Cat", back: "Γάτα" }]);
  const r = A.apply("flashcards", clone(d), it, NOW, [false], CTX);
  const n = r.data.notes.find((x) => x.f && x.f.q === "Cat");
  const ch = Object.assign(clone(n), { m: NOW + 50, f: { q: "Cat", a: "Γατούλα" } });
  const d3 = Object.assign(clone(r.data), { notes: FC.mergeNotes(r.data.notes, [ch]) });
  assert.match(A.undo("flashcards", d3, r.undo, NOW + 100).err, /changed in Flashcards/);
});
test("flashcards in create_items: fields in the tool, the store prepared before plan and undo", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../assistant/assistant.js"), "utf8");
  assert.match(src, /key === "disk:flashcards" \? fcPrep\(\)/);
  assert.match(src, /mem\.key === "disk:flashcards" \? fcPrep\(\)/);
});

// ---------- Split (AS-ADD9) ----------
const SPsrc = require("fs").readFileSync(require("path").join(__dirname, "../split/split.js"), "utf8");
function spBlock(from, to) { const i = SPsrc.indexOf(from), j = SPsrc.indexOf(to, i); assert.ok(i >= 0 && j >= 0, from); return SPsrc.slice(i, j); }
const SPm = new Function(spBlock("  var STORAGE_KEY", "  // ---------- 1.") + spBlock("  function cmpStr(", "  function newId(") +
  spBlock("  // ---------- 2. Money", "  // ---------- 6. Storage") + "\nreturn { mergeSplit, balancesOf, emptyData };")();
function sitems(list) { const n = A.normItems({ app: "split", items: list }, CTX); assert.equal(n.ok, true, n.err); return n.items; }
function sdata() {
  return SPm.mergeSplit({ ver: 1, groups: [{ id: "g1", m: 1, n: "Naxos", col: 2, cur: "EUR", arch: 0 }, { id: "g2", m: 1, n: "Old", col: 0, cur: "EUR", arch: 1 }],
    people: [{ id: "g1.a", m: 1, n: "Anna" }, { id: "g1.b", m: 1, n: "Nikos" }, { id: "g1.c", m: 1, n: "Maria" }],
    exp: [], pay: [], mine: [{ id: "g1", m: 1, v: "g1.a" }], tombs: {} }, null);
}
test("split: an expense split equally, in Split's canonical form; payer = me by default; Undo tombstones it", () => {
  assert.ok(A.APP_IDS.includes("split"));
  const d = sdata();
  const it = sitems([{ title: "Dinner", amount: 60, date: "2026-11-08", category: "food" },
                     { title: "Taxi", amount: 10.01, paid_by: "nikos", shared_by: ["Anna", "Nikos"], split_group: "naxos" }]);
  const p = A.plan("split", clone(d), it, CTX);
  assert.equal(p.ok, true, p.err);
  const r = A.apply("split", clone(d), it, NOW, [false, false], CTX);
  assert.equal(r.ok, true, r.err);
  assert.equal(JSON.stringify(SPm.mergeSplit(r.data, r.data)), JSON.stringify(r.data), "opening Split rewrites nothing");
  const e1 = r.data.exp.find((x) => x.t === "Dinner"), e2 = r.data.exp.find((x) => x.t === "Taxi");
  assert.deepEqual(e1.by, { "g1.a": 6000 }); assert.deepEqual(e1.w, { "g1.a": 1, "g1.b": 1, "g1.c": 1 }); assert.equal(e1.c, "food");
  assert.deepEqual(e2.by, { "g1.b": 1001 }); assert.deepEqual(e2.w, { "g1.a": 1, "g1.b": 1 }); assert.equal(e2.c, "other");
  const u = A.undo("split", clone(r.data), r.undo, NOW + 1000);
  assert.equal(u.ok, true, u.err);
  assert.equal(SPm.mergeSplit(r.data, u.data).exp.length, 0, "the deletion wins over the old copy");
  const ch = clone(r.data); ch.exp.find((x) => x.t === "Taxi").t = "Taxi home";
  assert.match(A.undo("split", ch, r.undo, NOW + 1000).err, /changed in Split/);
});
test("split: unknown group or person, archived group, no 'me', never opened are refused", () => {
  const d = sdata();
  assert.match(A.plan("split", clone(d), sitems([{ title: "x", amount: 1, split_group: "Old" }]), CTX).err, /no group named/);
  assert.match(A.plan("split", clone(d), sitems([{ title: "x", amount: 1, paid_by: "Zoe" }]), CTX).err, /nobody named/);
  assert.match(A.plan("split", clone(d), sitems([{ title: "x", amount: 1, shared_by: ["Anna", "Zoe"] }]), CTX).err, /nobody named/);
  const d2 = clone(d); d2.mine = [];
  assert.match(A.plan("split", d2, sitems([{ title: "x", amount: 1 }]), CTX).err, /who paid/);
  assert.equal(A.normItems({ app: "split", items: [{ title: "x" }] }, CTX).ok, false);
  assert.equal(A.normItems({ app: "split", items: [{ title: "x", amount: 2, category: "cars" }] }, CTX).ok, false);
  assert.equal(A.plan("split", null, sitems([{ title: "x", amount: 1 }]), CTX).ok, false);
});
