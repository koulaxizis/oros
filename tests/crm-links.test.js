// Partners across apps (BR-CRM-LINK): roles and links on a CRM
// record (crm/core.js 1.5) and the read-only matching of Stock,
// Timesheet, Invoices and Publishing records (crm/links.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "crm/core.js"));
const L = require(path.join(__dirname, "..", "crm/links.js"));
const S = require(path.join(__dirname, "..", "stock/core.js"));
const I = require(path.join(__dirname, "..", "invoices/core.js"));

function cust(id, name, extra) { return Object.assign({ id: id, m: 10, name: name }, extra || {}); }

function pt(id, extra) { return Object.assign({ id: id, m: 10 }, extra || {}); }

test("roles: customer only stores nothing, others are kept in a fixed order", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A"), cust("aaaaaa2", "B"), cust("aaaaaa3", "C")],
    pt: [pt("aaaaaa1", { roles: ["cust"] }), pt("aaaaaa2", { roles: ["assoc", "sup", "x"] }), pt("aaaaaa3", { roles: [] })] });
  // a row with nothing to say stays as { id, m } (1.7): dropping it let
  // another device's older roles or links come back
  assert.deepEqual(d.pt, [{ id: "aaaaaa1", m: 10 }, { id: "aaaaaa2", m: 10, roles: ["sup", "assoc"] }, { id: "aaaaaa3", m: 10 }]);
  assert.deepEqual(C.rolesOf(d, d.cust[0]), ["cust"]);
  assert.equal(C.hasRole(d, d.cust[1], "cust"), false);
  assert.equal(C.hasRole(d, d.cust[1], "sup"), true);
  assert.deepEqual(C.rolesRow(d, "aaaaaa2", ["cust"]), { id: "aaaaaa2", m: 10 });
  assert.deepEqual(C.rolesRow(d, "aaaaaa1", ["shop"]), { id: "aaaaaa1", m: 10, roles: ["shop"] });
});

test("data without partners keeps its bytes", () => {
  const raw = { cust: [cust("aaaaaa1", "A")] };
  const a = JSON.stringify(C.norm(raw));
  assert.equal(JSON.stringify(C.norm(JSON.parse(a))), a);
  assert.equal(a.indexOf("\"pt\""), -1);
});

test("a partner row follows its customer: tombstone and missing customer hide it", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], pt: [pt("aaaaaa1", { roles: ["sup"] }), pt("aaaaaa9", { roles: ["sup"] })] });
  assert.deepEqual(d.pt.map((p) => p.id), ["aaaaaa1"]);
  const gone = C.norm({ cust: [cust("aaaaaa1", "A")], pt: [pt("aaaaaa1", { roles: ["sup"] })], tombs: { aaaaaa1: 20 } });
  assert.equal(gone.pt, undefined);
});

test("links: bad ones drop, pub names fold, sorted and unique, capped", () => {
  const ln = ["sup:abc123", "wh:Q1", "pub:Μαρία   Παπά", "pub:μαρια παπα", "tsc:bad id", "zzz:1", 5, "inv:" + "x".repeat(61)];
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], pt: [pt("aaaaaa1", { ln: ln })] });
  assert.deepEqual(d.pt[0].ln, ["pub:μαρια παπα", "sup:abc123", "wh:Q1"]);
  const many = []; for (let i = 0; i < 40; i++) many.push("sup:s" + i);
  assert.equal(C.norm({ cust: [cust("aaaaaa1", "A")], pt: [pt("aaaaaa1", { ln: many })] }).pt[0].ln.length, C.LIMITS.links);
});

test("an older device that edits the customer (no pt) cannot strip roles or links", () => {
  const mine = { cust: [cust("aaaaaa1", "A", { m: 20 })], pt: [pt("aaaaaa1", { m: 20, roles: ["sup"], ln: ["sup:s1"] })] };
  const old = { cust: [cust("aaaaaa1", "A, renamed", { m: 30 })] };   // a 1.4 device's upload
  const ab = C.merge(mine, old), ba = C.merge(old, mine);
  assert.deepEqual(ab, ba);
  assert.equal(ab.cust[0].name, "A, renamed");
  assert.deepEqual(ab.pt[0].roles, ["sup"]);
  assert.deepEqual(ab.pt[0].ln, ["sup:s1"]);
  assert.deepEqual(C.merge(ab, ab), ab);
});

test("linkMove: one record belongs to one partner; unlink everywhere", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A"), cust("aaaaaa2", "B")], pt: [pt("aaaaaa1", { roles: ["sup"], ln: ["sup:s1"] })] });
  const rows = C.linkMove(d, "aaaaaa2", "sup:s1");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((r) => r.id === "aaaaaa1"), { id: "aaaaaa1", m: 10, roles: ["sup"] });
  assert.deepEqual(rows.find((r) => r.id === "aaaaaa2"), { id: "aaaaaa2", ln: ["sup:s1"] });
  assert.equal(d.pt[0].ln[0], "sup:s1", "the data passed in is not changed");
  assert.equal(C.linkOwner(d, "sup:s1").id, "aaaaaa1");
  assert.deepEqual(C.linkMove(d, "", "sup:s1").map((r) => r.id), ["aaaaaa1"]);
  assert.deepEqual(C.linkMove(d, "aaaaaa1", "sup:s1"), [], "already there: nothing to save");
  assert.deepEqual(C.linkMove(d, "aaaaaa1", "bad"), []);
  assert.deepEqual(C.linkMove(d, "nobody1", "sup:s2"), [], "no such customer");
});

function stockData() {
  return S.merge({
    sups: [{ id: "sup0001", m: 5, name: "Paper Ltd", person: "Nikos", vatno: "EL094019245", email: "Sales@Paper.example", tel: "210" }],
    whs: [{ id: "wh00001", m: 5, name: "Bookshop Athens" }, { id: "wh00002", m: 5, name: "Store room" }],
    cons: [{ id: "wh00001", m: 5, on: 1, disc: 30, every: 3, who: "Athens Books SA" }]
  }, null, 1e12);
}

test("candidates: suppliers, consignment shops only, Timesheet, Invoices without crm, Publishing people", () => {
  const ts = { clients: [{ id: "tsc0001", m: 1, name: "Studio K" }, { id: "tsc0002", m: 2, del: 1 }] };
  const inv = { clients: [{ id: "cli0001", m: 1, name: "Shop X", afm: "094019245" }, { id: "cli0002", m: 1, name: "Has CRM", crm: "aaaaaa1" }] };
  const pub = { titles: [
    { id: "t1", t: "Book 1", ppl: [{ r: "a", n: "Μαρία Παπά" }, { r: "t", n: "Linked", crm: "aaaaaa1" }] },
    { id: "t2", t: "Book 2", ppl: [{ r: "a", n: "μαρια  παπα" }] }
  ] };
  const cands = L.candidates({ stock: stockData(), ts: ts, inv: inv, pub: pub }, { stock: S });
  assert.deepEqual(cands.map((c) => c.key), ["sup:sup0001", "wh:wh00001", "tsc:tsc0001", "inv:cli0001", "pub:μαρια παπα"]);
  assert.equal(cands[1].name, "Athens Books SA");
  assert.equal(cands[1].sub, "Bookshop Athens");
  assert.equal(cands[4].n, 2, "the same person on two titles is one candidate");
  assert.deepEqual(L.candidates({}, {}), []);
});

test("suggest: ΑΦΜ before email before name; linked and ambiguous ones stay out", () => {
  const d = C.norm({ cust: [
    cust("aaaaaa1", "Paper", { afm: "094019245" }),
    cust("aaaaaa2", "Studio K"), cust("aaaaaa3", "Studio K"),
    cust("aaaaaa4", "Other", { email: "x@y.example" })
  ], pt: [pt("aaaaaa4", { ln: ["wh:wh00001"] })] });
  const cands = [
    { key: "sup:sup0001", k: "sup", name: "Paper Ltd", afm: "EL094019245" },
    { key: "tsc:tsc0001", k: "tsc", name: "studio k" },
    { key: "wh:wh00001", k: "wh", name: "Other" },
    { key: "inv:cli0009", k: "inv", name: "Nobody", email: "X@Y.example" },
    { key: "inv:cli0010", k: "inv", name: "Fresh" }
  ];
  const r = L.suggest(d, cands);
  assert.deepEqual(r.pairs.map((p) => [p.cand.key, p.cust.id, p.why]),
    [["sup:sup0001", "aaaaaa1", "afm"], ["inv:cli0009", "aaaaaa4", "email"]]);
  assert.deepEqual(r.loose.map((c) => c.key), ["tsc:tsc0001", "inv:cli0010"]);
});

test("forCust: matches first, shows the current owner, hides own links", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "Paper"), cust("aaaaaa2", "B")],
    pt: [pt("aaaaaa1", { ln: ["tsc:tsc0001"] }), pt("aaaaaa2", { ln: ["inv:cli0001"] })] });
  const cands = [
    { key: "inv:cli0001", k: "inv", name: "Zeta" },
    { key: "sup:sup0001", k: "sup", name: "paper" },
    { key: "tsc:tsc0001", k: "tsc", name: "Paper" }
  ];
  const r = L.forCust(d, d.cust[0], cands);
  assert.deepEqual(r.map((x) => x.cand.key), ["sup:sup0001", "inv:cli0001"]);
  assert.equal(r[0].why, "name");
  assert.equal(r[1].owner.id, "aaaaaa2");
});

test("linked: names from the candidates, gone ones flagged, Publishing ids count", () => {
  const pub = { titles: [{ id: "t1", t: "B", ppl: [{ r: "a", n: "Me", crm: "aaaaaa1" }] }, { id: "t2", t: "A", ppl: [{ r: "t", n: "Μαρία Παπά" }] }] };
  const d = C.norm({ cust: [cust("aaaaaa1", "Me")], pt: [pt("aaaaaa1", { ln: ["sup:sup0001", "sup:gone01", "pub:μαρια παπα", "pub:nobody"] })] });
  const rows = L.linked(d, d.cust[0], [{ key: "sup:sup0001", k: "sup", name: "Paper" }], pub);
  const by = (k) => rows.find((r) => r.key === k);
  assert.equal(by("sup:sup0001").name, "Paper");
  assert.equal(by("sup:gone01").gone, true);
  assert.equal(by("pub:μαρια παπα").gone, false);
  assert.equal(by("pub:nobody").gone, true);
  assert.equal(rows.filter((r) => r.auto).length, 1);
  assert.deepEqual(L.pubTitles(pub, "aaaaaa1", ["pub:μαρια παπα"]).map((x) => x.t), ["A", "B"]);
});

test("newCust: role from the kind, a valid CRM row that keeps its link", () => {
  const row = L.newCust({ key: "wh:wh00001", k: "wh", name: "Athens Books SA" }, "bbbbbb1", 1000);
  const d = C.norm({ cust: [row.cust], pt: [row.pt] });
  assert.equal(d.cust.length, 1);
  assert.deepEqual(d.pt[0].roles, ["shop"]);
  assert.deepEqual(d.pt[0].ln, ["wh:wh00001"]);
  const p = L.newCust({ key: "pub:x", k: "pub", name: "X", email: "x@y" }, "bbbbbb2", 1000);
  assert.equal(C.norm({ cust: [p.cust] }).cust[0].kind, "person");
  assert.deepEqual(p.pt.roles, ["auth"]);
  assert.equal("roles" in L.newCust({ key: "tsc:t1", k: "tsc", name: "T" }, "bbbbbb3", 1000).pt, false);
});

test("Invoices byCrm: linked clients count, but never one that names another customer", () => {
  const data = I.normalize({ ver: 1, clients: [
    { id: "cli0001", m: 1, name: "Linked here" },
    { id: "cli0002", m: 1, name: "Other's", crm: "zzzzzz9" }
  ], docs: [
    { id: "doc0001", m: 1, kind: "ext", st: "issued", num: "A1", date: "2026-10-01", cur: "EUR", cli: "cli0001", lines: [{ d: "x", q: 1, p: 1000, vat: 0 }] },
    { id: "doc0002", m: 1, kind: "ext", st: "issued", num: "A2", date: "2026-10-01", cur: "EUR", cli: "cli0002", lines: [{ d: "x", q: 1, p: 1000, vat: 0 }] }
  ] });
  assert.equal(I.byCrm(data, "aaaaaa1", "2026-10-25").rows.length, 0);
  assert.deepEqual(I.byCrm(data, "aaaaaa1", "2026-10-25", ["cli0001", "cli0002"]).rows.map((r) => r.id), ["doc0001"]);
});
