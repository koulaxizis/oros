// CRM 1.11 (RIGHTS): what each contract grants. The rt list (template,
// grant, formats covered, eight rights with their share, territory,
// sell-off, CC, where the terms come from), its merge, the Gate's
// words (rtRow) and the Rights view's three flags (rightsBoard): sold
// with no running right, a right with no release, renewals ahead.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../crm/core.js");
const E = require("../assistant/edits.js");
const AS = require("../assistant/core.js");

function cust(id, name) { return { id: id, m: 5, name: name, kind: "person", st: "active" }; }
function ctr(id, extra) { return Object.assign({ id: id, m: 10, cust: "aaaaaa1", t: "«Book» (Print)", rem: 5 }, extra || {}); }
const today = "2026-11-18";

test("rt rows: cleaned, kept only with their contract, merged both ways", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001"), ctr("ctr0002")], rt: [
    { id: "ctr0001", m: 20, tpl: "D", grant: "excl", cov: ["e", "p", "x"], ter: "gr", ext: "agree", so: 3, cd: 30, cc: true, ccp: true, rev: true,
      src: "pdf", chk: "2026-11-18", note: " read \n ", x9: 1,
      r: { audio: { s: "granted", sh: "10%" }, transl: { s: "consent", sh: "<b>" }, evil: { s: "granted" }, merch: { s: "maybe" } } },
    { id: "ctr0009", m: 20, tpl: "A" },             // its contract is gone
    { id: "ctr0002", m: 20, tpl: "Z", so: 99, cc: "yes" }
  ] });
  assert.deepEqual(d.rt, [
    { id: "ctr0001", m: 20, tpl: "D", grant: "excl", cov: ["p", "e"], r: { audio: { s: "granted", sh: "10%" }, transl: { s: "consent" } },
      ter: "gr", ext: "agree", so: 3, cd: 30, cc: true, ccp: true, rev: true, src: "pdf", chk: "2026-11-18", note: "read" },
    { id: "ctr0002", m: 20 }
  ]);
  const a = { cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001")], rt: [{ id: "ctr0001", m: 20, tpl: "C" }] };
  const b = { cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001")], rt: [{ id: "ctr0001", m: 21, tpl: "D" }] };
  assert.deepEqual(C.merge(a, b), C.merge(b, a));
  assert.equal(C.merge(a, b).rt[0].tpl, "D");
  // a device before 1.11 sends no rt: the newer one keeps its own
  const old = { cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001", { m: 30 })] };
  assert.equal(C.merge(a, old).rt[0].tpl, "C");
  assert.equal(C.merge(C.merge(a, old), old).rt[0].tpl, "C", "idempotent");
  // a deleted contract takes its rights with it
  const gone = C.merge(a, { tombs: { ctr0001: 40 } });
  assert.equal(gone.rt, undefined);
  assert.equal(C.norm({ cust: [cust("aaaaaa1", "A")] }).rt, undefined, "no empty list is added");
});

test("rtRow: the Gate's words, merged into what is stored; errors name the key", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001")], rt: [{ id: "ctr0001", m: 20, tpl: "C", r: { audio: { s: "granted", sh: "10%" } } }] });
  const r = C.rtRow(d, "ctr0001", { grant: "all_economic", covers: ["print", "digital"], territory: "greece", extend: "not_mentioned",
    per_right: { adaptation: { status: "granted", share: "10%" }, merch: "consent" }, cc: true, source: "pdf", checked: "2026-11-18" });
  assert.deepEqual(r.row, { id: "ctr0001", m: 20, tpl: "C", grant: "all", cov: ["p", "e"],
    r: { audio: { s: "granted", sh: "10%" }, adapt: { s: "granted", sh: "10%" }, merch: { s: "consent" } }, ter: "gr", ext: "none", cc: true, src: "pdf", chk: "2026-11-18" });
  // null clears; 0 months = none
  const r2 = C.rtRow(d, "ctr0001", { template: null, per_right: { audio: null }, sell_off_months: 0 });
  assert.deepEqual(r2.row, { id: "ctr0001", m: 20 });
  assert.match(C.rtRow(d, "ctr0001", { grant: "most" }).err, /grant must be one of: all_economic/);
  assert.match(C.rtRow(d, "ctr0001", { colour: 1 }).err, /rights has no colour/);
  assert.match(C.rtRow(d, "ctr0001", { per_right: { tv: "granted" } }).err, /a right in per_right/);
  assert.match(C.rtRow(d, "ctr0001", { per_right: { audio: { status: "granted", share: "lots" } } }).err, /share must be like/);
  assert.match(C.rtRow(d, "ctr0009", { template: "A" }).err, /no longer in CRM/);
  // a new row starts at m 0: the caller stamps it
  const d2 = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001")] });
  assert.deepEqual(C.rtRow(d2, "ctr0001", { template: "A", source: "oral" }).row, { id: "ctr0001", m: 0, tpl: "A", src: "oral" });
});

test("rtStatus: an entry wins, else what the grant implies", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001"), ctr("ctr0002"), ctr("ctr0003")], rt: [
    { id: "ctr0001", m: 20, grant: "all", r: { audio: { s: "granted" } } },
    { id: "ctr0002", m: 20, grant: "free" }
  ] });
  const k = (id) => C.byId(d.ctr, id);
  assert.equal(C.rtStatus(d, k("ctr0001"), "print"), "granted");
  assert.equal(C.rtStatus(d, k("ctr0001"), "ebook"), "none", "a print contract does not grant the e-book");
  assert.equal(C.rtStatus(d, k("ctr0001"), "audio"), "granted");
  assert.equal(C.rtStatus(d, k("ctr0001"), "merch"), "");
  assert.equal(C.rtStatus(d, k("ctr0002"), "ebook"), "free");
  assert.equal(C.rtStatus(d, k("ctr0002"), "print"), "none");
  assert.equal(C.rtStatus(d, k("ctr0003"), "print"), "", "nothing recorded");
  assert.deepEqual(C.rtCovers(d, k("ctr0003")), ["p"], "the contract's own format");
});

function title(id, t, fmts) { return { id: id, t: t, ppl: [], fmts: fmts }; }

test("rightsBoard: sold with no running right, free under CC, rights with no release, renewals", () => {
  const titles = [
    title("t1", "Ended Print", [{ k: "pb", price: 14, wp: { a: "shop1", id: 101 } }]),
    title("t2", "Free Pdf", [{ k: "eb", price: 0, wp: { a: "shop1", id: 102 } }]),
    title("t3", "Unified", [{ k: "pb", price: 12, wp: { a: "shop1", id: 103 } }]),
    title("t4", "Covered Both", [{ k: "pb", price: 10, wp: { a: "shop1", id: 104 } }, { k: "eb", price: 0, wp: { a: "shop1", id: 105 } }]),
    title("t5", "Sell Off", [{ k: "pb", price: 9, wp: { a: "shop1", id: 106 } }]),
    title("t6", "Ended By Agreement", [{ k: "pb", price: 16, wp: { a: "shop1", id: 107 } }]),
    title("t7", "Free Audio", [{ k: "ab", price: 0, wp: { a: "shop1", id: 108 } }])
  ];
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [
    ctr("ctr0001", { t: "«Ended Print» (Print)", to: "2026-09-01" }),
    ctr("ctr0002", { t: "«Free Pdf» (Digital)", to: "2026-03-09" }),
    ctr("ctr0003", { t: "«Unified»", to: "2026-12-02" }),
    ctr("ctr0004", { t: "«Covered Both» (Print)", to: "2028-09-07" }),
    ctr("ctr0005", { t: "«Sell Off»", to: "2026-10-01" }),
    ctr("ctr0006", { t: "«Ended By Agreement» (Print)", to: "2028-01-01" }),
    ctr("ctr0007", { t: "«Free Audio» (Digital)", to: "2027-02-10" }),
    ctr("ctr0008", { t: "«No Such Title»", to: "2027-05-01" })
  ], cx: [{ id: "ctr0006", m: 20, end: "2026-01-20" }], rt: [
    { id: "ctr0002", m: 20, tpl: "A", grant: "free", cc: true },
    { id: "ctr0003", m: 20, tpl: "C", grant: "all", cov: ["p", "e"], r: { audio: { s: "granted", sh: "10%" } } },
    { id: "ctr0004", m: 20, tpl: "B", grant: "all", cov: ["p", "e"] },
    { id: "ctr0005", m: 20, tpl: "D", grant: "excl", cov: ["p", "e"], so: 3 },
    { id: "ctr0007", m: 20, tpl: "A", grant: "free", r: { audio: { s: "consent" } } }
  ] });
  const b = C.rightsBoard(d, today, titles);
  assert.deepEqual(b.sold.map((x) => [x.ti, x.f, x.price, x.ctr]), [["t6", "p", 16, "ctr0006"], ["t1", "p", 14, "ctr0001"]]);
  assert.deepEqual(b.freeCc.map((x) => [x.ti, x.f, x.wp]), [["t2", "e", 102]]);
  // the unified contract grants e-book and audio, Publishing has only print;
  // the sell-off one ended (no e-book flag), the free-only one never had them
  assert.deepEqual(b.unreleased.map((x) => [x.ti, x.f]), [["t3", "a"], ["t3", "e"]].sort((p, q) => (p[1] < q[1] ? -1 : 1)));
  assert.deepEqual(b.renew.map((x) => x.info.ctr.id), ["ctr0003", "ctr0007"]);
  assert.equal(b.unlinked, 1);
  assert.equal(b.unfilled, 3);
  const t3 = b.titles.find((x) => x.ti === "t3");
  assert.equal(t3.best.ebook, "granted");
  assert.equal(t3.best.audio, "granted");
  assert.equal(t3.best.merch, "");
  // the sell-off months run out: the print is flagged then
  const later = C.rightsBoard(d, "2027-01-02", titles);
  assert.ok(later.sold.some((x) => x.ti === "t5"));
  assert.ok(!b.sold.some((x) => x.ti === "t5"), "still in its 3 months");
});

test("change_item rights: a contract's ref, CRM's own row, a card row per term, Undo", () => {
  globalThis.OrosCrmCore = C;
  try {
    const NOW = 1790000000000;
    const d = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001", { t: "«Book»", to: "2027-01-01" })] });
    const target = { cust: "aaaaaa1", ctr: "ctr0001" };
    assert.match(E.normArgs({ ref: "r1", action: "update", rights: [] }).err, /rights must be an object/);
    const ch = E.normArgs({ ref: "r1", action: "update", rights: { template: "C", grant: "all_economic", covers: ["print", "digital"],
      per_right: { audio: { status: "granted", share: "10%" } }, cc: true, checked: "2026-11-18" } });
    assert.equal(ch.ok, true, ch.err);
    const p = E.plan("crm", d, target, ch, NOW);
    assert.equal(p.ok, true, p.err);
    assert.deepEqual(p.rows, [{ f: "rtpl", b: "", a: "C" }, { f: "rtgrant", b: "", a: "grant.all" }, { f: "rtcovers", b: "", a: "cov.p cov.e" },
      { f: "rtaudio", b: "", a: "st.granted 10%" }, { f: "rtcc", b: "", a: "cc.yes" }, { f: "rtchecked", b: "", a: "2026-11-18" }]);
    const a = E.apply("crm", d, target, ch, NOW, p.before);
    assert.equal(a.ok, true, a.err);
    assert.deepEqual(a.data.rt, [{ id: "ctr0001", m: NOW, tpl: "C", grant: "all", cov: ["p", "e"], r: { audio: { s: "granted", sh: "10%" } }, cc: true, chk: "2026-11-18" }]);
    assert.equal(JSON.stringify(C.norm(JSON.parse(JSON.stringify(a.data)))), JSON.stringify(a.data), "same bytes as CRM's norm");
    // the same again: nothing would change; with another field: refused
    assert.match(E.plan("crm", a.data, target, ch, NOW + 1).err, /Nothing would change/);
    const both = E.normArgs({ ref: "r1", action: "update", rights: { template: "D" }, note: "x" });
    assert.match(E.plan("crm", a.data, target, both, NOW + 1).err, /alone/);
    // a customer's ref can't take rights; a bad word names the key
    assert.match(E.plan("crm", d, { cust: "aaaaaa1" }, ch, NOW).err, /belong to a contract/);
    const badW = E.normArgs({ ref: "r1", action: "update", rights: { territory: "europe" } });
    assert.match(E.plan("crm", d, target, badW, NOW).err, /territory must be one of/);
    // Undo takes it back to an empty row (nothing recorded)
    const u = E.undo("crm", a.data, a.undo, NOW + 10);
    assert.equal(u.ok, true, u.err);
    assert.deepEqual(u.data.rt, [{ id: "ctr0001", m: NOW + 10 }]);
    assert.equal(C.rightsBoard(C.norm(u.data), today, []).unfilled, 1);
  } finally {
    delete globalThis.OrosCrmCore;
  }
  // the Gate and the Assistant offer the field
  const tool = AS.TOOLS ? AS.TOOLS.find((x) => x.name === "change_item") : null;
  if (tool) assert.ok(tool.params.properties.rights, "change_item has rights");
});

test("CRM search: a contract's hit carries its id, so its rights can be changed", () => {
  const P = require("../crm/search.js");
  const store = { "oros-crm-data": C.norm({ cust: [cust("aaaaaa1", "Alpha")], ctr: [ctr("ctr0001", { t: "«Book» (Print)" })] }) };
  const hits = P.search({ q: "book", words: ["book"], fold: C.fold, lang: "en", code: "en", readJSON: (k) => store[k] || null });
  assert.deepEqual(hits.find((h) => h.id === "ctr0001").target, { cust: "aaaaaa1", ctr: "ctr0001" });
});
