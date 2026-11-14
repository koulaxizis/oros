// RS-PROD: the production stage for the Author Portal (crm/rs.js part 2,
// Revenue Splitter 1.18.0). Columns → phases exactly as Chris's table
// (2026-11-13), every part of the board, only the cards chosen in CRM,
// creators through CRM links or Publishing authors, the note for the
// creator only, and a body the allowlist takes.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const C = require("../crm/core.js");
const P = require("../crm/rs.js").prod;

const col = (id, name, cards) => ({ id, name, cards: cards || [] });
const card = (id, text, o) => Object.assign({ id, text, notes: "", mtime: 1000 }, o);
const DAY = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), 12);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// the real «Βιβλία» board's order (shortened), with its repeated names
const BOARD = { id: "bk", name: "Βιβλία", columns: [
  col("c1", "Αναμονή", [card("w1", "Ο Ψίθυρος")]),
  col("c2", "Mailing lists"),
  col("c3", "Επιμέλεια"),
  col("c4", "Soundtrack", [card("w4", "Ήχος")]),
  col("c5", "Θέση Υπό έκδοση", [card("mw811723ezycw", "Άνθρωποι που αξίζει να περιμένεις", {
    mtime: DAY("2026-11-10"), fm: { m: DAY("2026-11-10"), p: DAY("2026-11-10") },
    notes: "Εσωτερικό: να πάρω τηλέφωνο τον τυπογράφο.\nΓια τον δημιουργό: Η σελιδοποίηση προχωρά.\nΘα δεις δείγμα την Παρασκευή.\n\nΜην ξεχάσω το ISBN." })]),
  col("c6", "Teaser εξωφύλλου"),
  col("c7", "Δειγματισμός", [card("w7", "Η Κατερίνα και η Λαμπιτώ")]),
  col("c8", "Διορθώσεις"),
  col("c9", "Αποκάλυψη εξωφύλλου", [card("w9", "Άμμος")]),
  col("c10", "Παραγωγή"),
  col("c11", "Κυκλοφορία/eShop", [card("w11", "Νέο βιβλίο"), card("w12", "Παλιό βιβλίο")]),
  col("c12", "Καρτέλα συνεργάτη", [card("w13", "Συνέχεια")]),
  col("c13", "Εθνική βιβλιοθήκη"),
  col("c14", "Παρουσίαση εντός", [card("w14", "Ποιήματα Θανάτου")]),
  col("c15", "Παραγωγή audiobook", [card("w15", "Τα χέρια μου")]),
  col("c16", "Κυκλοφορία/eShop"),
  col("c17", "Εθνική βιβλιοθήκη", [card("w17", "Ακουστικό")])
] };
const KANBAN = { boards: [{ id: "tpl-x", name: "Βιβλία", columns: [] }, BOARD, { id: "m", name: "Μουσική", columns: [] }] };

function crm() {
  const cust = (id, name) => ({ id, m: 1, name, kind: "person", st: "active" });
  return C.norm({
    cust: [cust("cust000001", "Άννα Παππά"), cust("cust000002", "Νίκος Κ."), cust("cust000003", "Χωρίς RS")],
    rsl: [{ id: "cust000001", m: 1, n: ["Άννα Π."] }, { id: "cust000002", m: 1, n: ["Νίκος Κ."] }],
    ix: [{ id: "cust000001", m: 1, it: [{ k: "kb", r: "bk/c5/mw811723ezycw", t: "x" }, { k: "kb", r: "bk/c1/w7", t: "x" },
                                         { k: "kb", r: "bk/c3/w11", t: "x" }, { k: "kb", r: "bk/c3/w12", t: "x" },
                                         { k: "kb", r: "bk/c3/w13", t: "x" }, { k: "kb", r: "bk/c3/w14", t: "x" },
                                         { k: "kb", r: "bk/c3/w15", t: "x" }, { k: "kb", r: "bk/c3/w17", t: "x" }] },
         { id: "cust000002", m: 1, it: [{ k: "kb", r: "bk/c7/w7", t: "x" }] }]
  });
}
const PUB = { titles: [
  { id: "t1", t: "Άνθρωποι που αξίζει να ΠΕΡΙΜΕΝΕΙΣ", rel: "2026-12-01", ppl: [] },
  { id: "t2", t: "Άμμος", rel: "", ppl: [{ r: "a", n: "Νίκος", crm: "cust000002" }, { r: "i", n: "Άννα", crm: "cust000001" }] },
  { id: "t3", t: "Νέο βιβλίο", rel: "2026-11-01" },
  { id: "t4", t: "Παλιό βιβλίο", rel: "2026-09-01" },
  { id: "t5", t: "Ο Ψίθυρος", rel: "", ppl: [{ r: "a", n: "Χ", crm: "cust000003" }] }
] };
const ALL = ["w1", "w4", "mw811723ezycw", "w7", "w9", "w11", "w12", "w13", "w14", "w15", "w17"];
const base = (o) => Object.assign({ kanban: KANBAN, crm: crm(), publish: PUB, board: "ΒΙΒΛΙΑ", map: null, chosen: ALL,
  shopId: "shop1", firstShopId: "shop1", today: "2026-11-13", dayOf }, o);

test("columnPhases: exactly the table, unnamed columns keep the phase before them, repeated names the same phase", () => {
  const ph = P.columnPhases(BOARD, null).map((c) => [c.name, c.phase]);
  assert.deepEqual(ph, [["Αναμονή", 1], ["Mailing lists", 1], ["Επιμέλεια", 2], ["Soundtrack", 2], ["Θέση Υπό έκδοση", 4],
    ["Teaser εξωφύλλου", 3], ["Δειγματισμός", 5], ["Διορθώσεις", 5], ["Αποκάλυψη εξωφύλλου", 3], ["Παραγωγή", 6],
    ["Κυκλοφορία/eShop", 7], ["Καρτέλα συνεργάτη", 7], ["Εθνική βιβλιοθήκη", 6], ["Παρουσίαση εντός", 6],
    ["Παραγωγή audiobook", 6], ["Κυκλοφορία/eShop", 7], ["Εθνική βιβλιοθήκη", 6]]);
  // the person's map wins; 0 = no phase of its own (keeps the one before)
  const own = P.columnPhases(BOARD, { [P.fold("Παραγωγή audiobook")]: 2, [P.fold("Αποκάλυψη εξωφύλλου")]: 0 });
  assert.equal(own[8].phase, 5);
  assert.equal(own[14].phase, 2);
  // a board starting with unnamed columns: no phase until the first named one
  assert.equal(P.columnPhases({ columns: [col("a", "Ιδέες"), col("b", "Επιμέλεια")] }, null)[0].phase, 0);
});

test("noteOf: only the text after «Για τον δημιουργό:» up to the next empty line", () => {
  assert.equal(P.noteOf(BOARD.columns[4].cards[0].notes), "Η σελιδοποίηση προχωρά.\nΘα δεις δείγμα την Παρασκευή.");
  assert.equal(P.noteOf("For the creator: Proofs <b>soon</b>."), "Proofs b soon /b .");
  assert.equal(P.noteOf("ΓΙΑ ΤΟΝ ΔΗΜΙΟΥΡΓΌ:\nΚείμενο"), "Κείμενο");
  assert.equal(P.noteOf("Σημειώσεις χωρίς γραμμή για τον δημιουργό"), "");
  assert.equal(P.noteOf(""), "");
  assert.ok(P.noteOf("Για τον δημιουργό: " + "λέξη ".repeat(400)).length <= 1000);
});

test("plan: the chosen cards with phase, since, release and note; creators through CRM or Publishing", () => {
  const x = P.plan(base());
  const by = {};
  x.body.works.forEach((w) => { by[w.id] = w; });
  assert.equal(x.board.id, "bk");
  assert.deepEqual(by.mw811723ezycw, { id: "mw811723ezycw", ben: "Άννα Π.", title: "Άνθρωποι που αξίζει να περιμένεις", phase: 4,
    since: "2026-11-10", release: "2026-12-01", note: "Η σελιδοποίηση προχωρά.\nΘα δεις δείγμα την Παρασκευή." });
  // a card linked to two partners: one row each, "-1", "-2" in name order
  assert.deepEqual([by["w7-1"].ben, by["w7-2"].ben], ["Άννα Π.", "Νίκος Κ."]);
  assert.equal(by.w7, undefined);
  // not linked in CRM: the Publishing title's authors (only role "a")
  assert.deepEqual([by.w9.ben, by.w9.phase, by.w9.release], ["Νίκος Κ.", 3, ""]);
  // no column move stamp: since = sent
  assert.equal(by.w9.since, "2026-11-13");
  // released 12 days ago: phase 7; 73 days ago: left as old
  assert.equal(by.w11.phase, 7);
  assert.equal(by.w12, undefined);
  assert.ok(x.left.some((l) => l.card === "w12" && l.why === "old"));
  // phase 7 after release with no release day: since (today) counts
  assert.equal(by.w13.phase, 7);
  // the audiobook part counts too (Chris: "Όλα")
  assert.equal(by.w15.phase, 6);
  assert.equal(by.w17.phase, 6);
  // no creator (no link; Publishing author without an RS name)
  assert.ok(x.left.some((l) => l.card === "w1" && l.why === "noben"));
  assert.ok(x.left.some((l) => l.card === "w4" && l.why === "noben"));
  // ids sorted, the allowlist takes the body
  const ids = x.body.works.map((w) => w.id);
  assert.deepEqual(ids, ids.slice().sort());
  assert.equal(L.checkReq("woo", P.req(x.body)), "");
  assert.deepEqual(Object.keys(x.body), ["v", "sent", "works"]);
});

test("plan: nothing is sent that was not chosen; no board, no day or another shop sends nothing", () => {
  assert.deepEqual(P.plan(base({ chosen: [] })).body.works, []);
  assert.deepEqual(P.plan(base({ chosen: ["mw811723ezycw"] })).body.works.map((w) => w.id), ["mw811723ezycw"]);
  assert.equal(P.plan(base({ board: "" })).board, null);
  assert.deepEqual(P.plan(base({ board: "Άλλος" })).body.works, []);
  assert.deepEqual(P.plan(base({ today: "" })).body.works, []);
  // the partners are linked to the first shop; shop2 is another one
  const x = P.plan(base({ shopId: "shop2" }));
  assert.equal(x.body.works.length, 0);
  assert.ok(x.left.every((l) => l.why === "noben" || l.why === "old"));
});

test("plan: a deleted partner, an archived board, a title with <> and the 500-row limit", () => {
  const d = crm();
  d.tombs.cust000002 = 5;
  assert.ok(!P.plan(base({ crm: d })).body.works.some((w) => w.ben === "Νίκος Κ."));
  const arch = { boards: [Object.assign({}, BOARD, { archived: true })] };
  assert.equal(P.plan(base({ kanban: arch })).board, null);
  const many = { boards: [{ id: "bk", name: "Βιβλία", columns: [col("c1", "Επιμέλεια",
    Array.from({ length: 520 }, (_, i) => card("n" + String(i).padStart(3, "0"), "Τίτλος <" + i + ">")))] }] };
  const ix = crm();
  ix.ix = [{ id: "cust000001", m: 2, it: Array.from({ length: 50 }, (_, i) => ({ k: "kb", r: "bk/c1/n" + String(i).padStart(3, "0"), t: "x" })) }];
  const pub = { titles: Array.from({ length: 520 }, (_, i) => ({ id: "p" + i, t: "Τίτλος <" + i + ">", ppl: [{ r: "a", n: "Ά", crm: "cust000001" }] })) };
  const x = P.plan(base({ kanban: many, crm: ix, publish: pub, chosen: many.boards[0].columns[0].cards.map((c) => c.id) }));
  assert.equal(x.body.works.length, 500);
  assert.equal(x.left.filter((l) => l.why === "max").length, 20);
  assert.equal(x.body.works[0].title, "Τίτλος 0");
  assert.equal(L.checkReq("woo", P.req(x.body)), "");
});

test("parseSaved and the CRM settings that carry the board, the map and the choice", () => {
  assert.deepEqual(P.parseSaved({ saved: 3, skipped: [{ id: "w1", why: "unknown_ben" }, { id: "w2", why: "weird" }] }),
    { saved: 3, skipped: [{ id: "w1", why: "unknown_ben" }, { id: "w2", why: "not_an_object" }] });
  assert.equal(P.parseSaved({ ok: 1 }), null);
  const cs = C.normCset({ m: 5, pb: "Βιβλία", pm: { [P.fold("Soundtrack")]: 3, bad: 9 }, pc: ["w2", "w1", "w1", "a b"] });
  assert.deepEqual(cs, { m: 5, pb: "Βιβλία", pm: { soundtrack: 3 }, pc: ["w1", "w2"] });
  // the settings survive a merge with an older copy
  const a = C.norm({ cset: cs }), b = C.norm({ cset: { m: 1, lbl: "x" } });
  assert.deepEqual(C.merge(a, b).cset, cs);
});
