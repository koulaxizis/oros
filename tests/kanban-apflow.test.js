// AP-FLOW: the Author Portal production flow from Kanban.
// The card group r (ap: the card shown to its creator), the column key
// ap (a step with its name and explanation), a mixed fleet with the
// 8.26.00 model (no group r), and the v2 plan sent to Revenue Splitter
// 1.21.0 (crm/rs.js part 2).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const M = require(path.join(__dirname, "..", "kanban/model.js"));
const OLD = require(path.join(__dirname, "fixtures", "kanban-model-8.26.00.js"));
const P = require(path.join(__dirname, "..", "crm/rs.js")).prod;

const NOW = Date.UTC(2026, 10, 21, 10, 0, 0);
const T0 = NOW - 3600e3;

function card(id, extra) {
  return Object.assign({ id, text: "Card " + id, notes: "", due: null, labels: [], subtasks: [], info: [], mtime: T0, pos: 0 }, extra || {});
}
function col(id, cards, extra) { return Object.assign({ id, name: id, mtime: T0, om: T0, pos: 0, cards }, extra || {}); }
function board(cols, id) { return { id: id || "b1", name: "B", archived: false, mtime: T0, om: T0, deleted: {}, labels: [], columns: cols }; }
function st(boards) { return { ver: 5, om: T0, boardDeleted: {}, boards }; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function canon(s) { return M.canonState(s, NOW); }
function k1(s) { return s.boards[0].columns[0].cards[0]; }
function edit(s, fn) { const x = clone(s); fn(k1(x)); return canon(x); }
function base() { return canon(st([board([col("todo", [card("k1")]), col("done", [])])])); }

test("column ap: only on, names and explanations, trimmed and capped", () => {
  assert.equal(M.colAp(null), null);
  assert.equal(M.colAp({ on: 0 }), null);
  assert.deepEqual(M.colAp({ on: true, n: "  Τυπογραφείο ", a: "x".repeat(700), junk: 1 }), { on: 1, n: "Τυπογραφείο", a: "x".repeat(600) });
  assert.deepEqual(M.colAp({ on: 0, a: "kept while off" }), { on: 0, a: "kept while off" });
  const s = canon(st([board([col("c1", [], { ap: { on: 1, n: "A\u0001B", bad: 2 } })])]));
  assert.deepEqual(s.boards[0].columns[0].ap, { on: 1, n: "A B" });
  const s2 = canon(st([board([col("c1", [], { ap: "nope" })])]));
  assert.equal(s2.boards[0].columns[0].ap, undefined);
});

test("card ap: 1 or 0 only, and its own field group r", () => {
  const s = edit(base(), (k) => { k.ap = 1; M.stampCard(k, ["r"], NOW - 1000); });
  assert.equal(k1(s).ap, 1);
  assert.equal(k1(s).fm.r, NOW - 1000);
  assert.equal(k1(canon(st([board([col("c", [card("k", { ap: "yes" })])])]))).ap, undefined);
});

test("a tick here and a text edit elsewhere both stay", () => {
  const s0 = base();
  const A = edit(s0, (k) => { k.ap = 1; M.stampCard(k, ["r"], NOW - 1000); });
  const B = edit(s0, (k) => { k.text = "Renamed"; M.stampCard(k, ["t"], NOW - 500); });
  const m1 = M.mergeKanbanStates(clone(A), clone(B), NOW), m2 = M.mergeKanbanStates(clone(B), clone(A), NOW);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2));
  assert.equal(k1(m1).ap, 1);
  assert.equal(k1(m1).text, "Renamed");
});

test("an explicit no (0) after a tick wins by its stamp", () => {
  const s0 = edit(base(), (k) => { k.ap = 1; M.stampCard(k, ["r"], NOW - 2000); });
  const A = edit(s0, (k) => { k.ap = 0; M.stampCard(k, ["r"], NOW - 500); });
  const B = edit(s0, (k) => { k.notes = "n"; M.stampCard(k, ["n"], NOW - 300); });
  const m = M.mergeKanbanStates(clone(A), clone(B), NOW);
  assert.equal(k1(m).ap, 0);
  assert.equal(k1(m).notes, "n");
});

function settle(devices, remote) {
  let quiet = 0, rounds = 0, uploads = 0;
  while (quiet < devices.length && rounds < 40) {
    const d = devices[rounds % devices.length];
    rounds++;
    const merged = d.model.mergeKanbanStates(clone(d.local), clone(remote), NOW);
    d.local = merged;
    if (JSON.stringify(merged) !== JSON.stringify(remote)) { remote = merged; uploads++; quiet = 0; }
    else quiet++;
  }
  return { remote, uploads, settled: quiet >= devices.length };
}

test("mixed fleet: a tick here and a text edit on 8.26.00 converge, nothing lost", () => {
  const s0 = base();
  const neu = { model: M, local: edit(s0, (k) => { k.ap = 1; M.stampCard(k, ["r"], NOW - 1000); }) };
  const old = { model: OLD, local: OLD.canonState(clone(edit(s0, (k) => { k.text = "Old text"; OLD.stampCard(k, ["t"], NOW - 500); })), NOW) };
  [[old, neu], [neu, old]].forEach((order) => {
    const devs = order.map((d) => ({ model: d.model, local: clone(d.local) }));
    const r = settle(devs, s0);
    assert.ok(r.settled, "no endless uploads");
    assert.ok(r.uploads <= 4, "a few uploads (" + r.uploads + ")");
    assert.equal(k1(r.remote).ap, 1);
    assert.equal(k1(r.remote).text, "Old text");
    devs.forEach((d) => assert.equal(JSON.stringify(d.local), JSON.stringify(r.remote)));
  });
});

test("mixed fleet: a step column set here survives an older device (column key, newer header wins)", () => {
  const s0 = base();
  const x = clone(s0);
  x.boards[0].columns[1].ap = { on: 1, a: "Στο τυπογραφείο" };
  x.boards[0].columns[1].mtime = NOW - 800;
  const neu = { model: M, local: canon(x) };
  const old = { model: OLD, local: OLD.canonState(clone(edit(s0, (k) => { k.text = "T"; OLD.stampCard(k, ["t"], NOW - 400); })), NOW) };
  const r = settle([old, neu], s0);
  assert.ok(r.settled);
  assert.deepEqual(r.remote.boards[0].columns[1].ap, { on: 1, a: "Στο τυπογραφείο" });
});

// ---------- the v2 plan ----------
const TODAY = "2026-11-21";
function crmData() {
  return {
    cust: [{ id: "p1", name: "Maria" }, { id: "p2", name: "Nikos" }],
    rsl: [{ id: "p1", n: ["Μαρία Π."] }, { id: "p2", n: ["Νίκος Κ."] }],
    ix: [{ id: "p1", it: [{ k: "kb", r: "b1/c/k1" }, { k: "kb", r: "b1/c/k3" }] }],
    cset: { m: 1, pc: ["k2"] }
  };
}
function books(extraCols) {
  return {
    boards: [{ id: "b1", name: "Βιβλία", archived: false, columns: [
      { id: "c0", name: "Αναμονή", cards: [{ id: "k0", text: "Early", ap: 1 }] },
      { id: "c1", name: "Επιμέλεια", ap: { on: 1, a: "Ο επιμελητής διαβάζει" }, cards: [] },
      { id: "c2", name: "Teaser", cards: [{ id: "k1", text: "Βυθός", ap: 1, notes: "x\nΓια τον δημιουργό: Σύντομα!\n\nprivate" }] },
      { id: "c3", name: "ΤΥΠ", ap: { on: 1, n: "Τυπογραφείο", a: "Το βιβλίο σας εκτυπώνεται", ae: "Your book is being printed" },
        cards: [{ id: "k2", text: "Legacy" }, { id: "k3", text: "Said no", ap: 0 }] },
      { id: "c4", name: "Κυκλοφορία", ap: { on: 1 }, cards: [{ id: "k4", text: "Released", ap: 1 }] }
    ].concat(extraCols || []) },
    { id: "b2", name: "Other", archived: false, columns: [{ id: "x1", name: "X", cards: [{ id: "q1", text: "Q", ap: 1 }] }] }]
  };
}
const PUB = { titles: [{ id: "t1", t: "Βυθός", rel: "2027-01-10", ppl: [], fmts: [{ id: "f1", wp: { a: "shop1", id: 42 } }, { id: "f2", wp: { a: "other", id: 9 } }] },
                       { id: "t2", t: "Legacy", ppl: [{ r: "a", n: "Nikos", crm: "p2" }] }] };

test("v2: steps in column order, the last step before a plain column, only ticked cards", () => {
  const x = P.plan({ kanban: books(), crm: crmData(), publish: PUB, shopId: "shop1", firstShopId: "shop1", today: TODAY, chosen: crmData().cset.pc });
  assert.equal(x.body.v, 2);
  assert.deepEqual(x.body.flows, [{ id: "b1", steps: [
    { id: "c1", name: "Επιμέλεια", name_en: "", about: "Ο επιμελητής διαβάζει", about_en: "" },
    { id: "c3", name: "Τυπογραφείο", name_en: "", about: "Το βιβλίο σας εκτυπώνεται", about_en: "Your book is being printed" },
    { id: "c4", name: "Κυκλοφορία", name_en: "", about: "", about_en: "" }] }]);
  const byId = {};
  x.body.works.forEach((w) => { byId[w.id] = w; });
  // k1 sits in "Teaser" (not a step): the step before it, Επιμέλεια
  assert.equal(byId.k1.step, "c1");
  assert.equal(byId.k1.ben, "Μαρία Π.");
  assert.equal(byId.k1.note, "Σύντομα!");
  assert.equal(byId.k1.release, "2027-01-10");
  assert.deepEqual(byId.k1.products, [42]);
  // k2: CRM's older tick still counts; creator from Publishing
  assert.equal(byId.k2.step, "c3");
  assert.equal(byId.k2.ben, "Νίκος Κ.");
  // k3: an explicit no; q1: board without steps; k0: no step before it
  assert.equal(byId.k3, undefined);
  assert.equal(byId.q1, undefined);
  assert.deepEqual(x.left.find((l) => l.card === "k0"), { card: "k0", t: "Early", why: "nostep" });
  // k4: the last step, released (since = today) → goes; no creator → left
  assert.equal(x.left.find((l) => l.card === "k4").why, "noben");
  assert.deepEqual(x.at.k1, { step: "Επιμέλεια", i: 1, n: 3, who: ["Μαρία Π."] });
  // nothing internal: no column names that are not steps
  assert.ok(!JSON.stringify(x.body).includes("Teaser"));
  assert.ok(!JSON.stringify(x.body).includes("private"));
  assert.ok(!JSON.stringify(x.body).includes("ΤΥΠ"));
});

test("v2: a flow without works is not sent; old releases are left out", () => {
  const kb = books();
  kb.boards[0].columns.forEach((c) => { c.cards.forEach((k) => { k.ap = 0; }); });
  const x = P.plan({ kanban: kb, crm: crmData(), publish: PUB, shopId: "shop1", firstShopId: "shop1", today: TODAY });
  assert.deepEqual(x.body, { v: 2, sent: TODAY, flows: [], works: [] });
  const kb2 = books();
  kb2.boards[0].columns[4].cards = [{ id: "k1", text: "Βυθός", ap: 1 }];
  const pub = { titles: [{ id: "t1", t: "Βυθός", rel: "2026-09-01", ppl: [] }] };
  const y = P.plan({ kanban: kb2, crm: crmData(), publish: pub, shopId: "shop1", firstShopId: "shop1", today: TODAY });
  assert.equal(y.left.find((l) => l.card === "k1").why, "old");
});

test("without step columns the v1 plan is unchanged", () => {
  const kb = books();
  kb.boards[0].columns.forEach((c) => { delete c.ap; });
  const x = P.plan({ kanban: kb, board: "Βιβλία", crm: crmData(), publish: PUB, shopId: "shop1", firstShopId: "shop1", today: TODAY, chosen: ["k2"] });
  assert.equal(x.body.v, 1);
  assert.equal(P.sentKey(x.body), JSON.stringify(x.body.works));
});

test("sentKey of v2 changes with a step's explanation", () => {
  const a = P.plan({ kanban: books(), crm: crmData(), publish: PUB, shopId: "shop1", firstShopId: "shop1", today: TODAY });
  const kb = books();
  kb.boards[0].columns[1].ap.a = "Νέο κείμενο";
  const b = P.plan({ kanban: kb, crm: crmData(), publish: PUB, shopId: "shop1", firstShopId: "shop1", today: TODAY });
  assert.notEqual(P.sentKey(a.body), P.sentKey(b.body));
  assert.deepEqual(P.parseSaved({ saved: 1, skipped: [{ id: "k1", why: "bad_step" }] }).skipped, [{ id: "k1", why: "bad_step" }]);
});

test("explanations never carry markup", () => {
  const kb = books();
  kb.boards[0].columns[1].ap.a = "<img src=x onerror=alert(1)> ok";
  const x = P.plan({ kanban: kb, crm: crmData(), publish: PUB, shopId: "shop1", firstShopId: "shop1", today: TODAY });
  assert.ok(!/[<>]/.test(JSON.stringify(x.body.flows)));
});

// ---------- the allowlist (app and relay copies agree) ----------
const L = require(path.join(__dirname, "..", "links/core.js"));
let X;
test.before(async () => { X = await import("../relay/ext.js"); });
const step = (o) => Object.assign({ id: "c1", name: "Τυπογραφείο", name_en: "", about: "Το βιβλίο σας εκτυπώνεται.", about_en: "" }, o);
const w2 = (o) => Object.assign({ id: "k1", ben: "Μαρία Π.", title: "Βυθός", flow: "b1", step: "c1", since: "2026-11-20", release: "", note: "", products: [42] }, o);
const p2 = (b) => ({ m: "POST", path: "/rs/production", body: Object.assign({ v: 2, sent: TODAY, flows: [{ id: "b1", steps: [step()] }], works: [w2()] }, b) });
const CASES2 = [
  [p2({}), ""],
  [p2({ works: [] , flows: [] }), ""],
  [p2({ flows: undefined }), "body"],
  [p2({ works: [w2({ step: "zz" })] }), "body"],
  [p2({ works: [w2({ flow: "b9" })] }), "body"],
  [p2({ works: [w2({ phase: 3 })] }), "body"],
  [p2({ works: [w2({ products: [0] })] }), "body"],
  [p2({ works: [w2({ products: [1, 2, 3, 4, 5, 6] })] }), "body"],
  [p2({ flows: [{ id: "b1", steps: [step({ about: "<script>" })] }] }), "body"],
  [p2({ flows: [{ id: "b1", steps: [step({ name: "" })] }] }), "body"],
  [p2({ flows: [{ id: "b1", steps: [] }] , works: [] }), "body"],
  [p2({ flows: [{ id: "b1", steps: [step(), step()] }] }), "body"],
  [p2({ flows: [{ id: "b1", steps: [step()] }, { id: "b1", steps: [step()] }] }), "body"],
  [p2({ v: 3 }), "body"],
  [{ m: "POST", path: "/rs/production", body: { v: 1, sent: TODAY, works: [w2()] } }, "body"],
  [{ m: "POST", path: "/rs/production", body: { v: 1, sent: TODAY, works: [], flows: [] } }, "body"],
  [{ m: "POST", path: "/rs/production", body: { v: 1, sent: TODAY, works: [{ id: "k1", ben: "A", title: "T", phase: 3, since: TODAY, release: "", note: "" }] } }, ""],
  [{ m: "POST", path: "/rs/contracts", body: { v: 2, sent: TODAY, contracts: [] } }, "body"]
];
test("allowlist v2: links/core.js and relay/ext.js agree", () => {
  for (const [r, want] of CASES2) {
    assert.equal(L.checkReq("woo", r), want, "app " + JSON.stringify(r.body).slice(0, 120));
    assert.equal(X.checkExtReq("woo", r), want, "relay " + JSON.stringify(r.body).slice(0, 120));
  }
});
test("allowlist v2: the plan's own body passes", () => {
  const x = P.plan({ kanban: books(), crm: crmData(), publish: PUB, shopId: "shop1", firstShopId: "shop1", today: TODAY, chosen: ["k2"] });
  const r = P.req(x.body);
  assert.equal(L.checkReq("woo", r), "");
  assert.equal(X.checkExtReq("woo", r), "");
});
