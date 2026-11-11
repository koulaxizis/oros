// CRM 1.10 (CTR-ALL): contracts everywhere. The cx list (format,
// Publishing title, ended by agreement, what was done), the 90-day
// "ending soon" window, the follow-ups made for contracts that had
// none, the Publishing match, the Calendar day, the Revenue Splitter
// payload and its allowlist (app and relay agree), Today's rows.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../crm/core.js");
const L = require("../links/core.js");
const TODAY = require("../crm/today.js");

let X;
test.before(async () => { X = await import("../relay/ext.js"); });

function cust(id, name, extra) { return Object.assign({ id: id, m: 5, name: name, kind: "person", st: "active" }, extra || {}); }
function ctr(id, extra) { return Object.assign({ id: id, m: 10, cust: "aaaaaa1", t: "«Book» (Print)", rem: 5 }, extra || {}); }
const today = "2026-11-11";

test("cx rows: cleaned, kept only with their contract, merged both ways", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001"), ctr("ctr0002")], cx: [
    { id: "ctr0001", m: 20, ti: "tt1", fmt: "p", end: "2026-10-01", x9: 1,
      h: [{ d: "2026-10-01", k: "end", v: "2026-10-01", n: "  agreed \n " }, { d: "bad", k: "note" }, { d: "2026-09-01", k: "evil" }] },
    { id: "ctr0009", m: 20, fmt: "e" },            // its contract is gone
    { id: "ctr0002", m: 20, fmt: "x", ti: "bad id!" }
  ] });
  assert.deepEqual(d.cx, [
    { id: "ctr0001", m: 20, ti: "tt1", fmt: "p", end: "2026-10-01", h: [{ d: "2026-10-01", k: "end", v: "2026-10-01", n: "agreed" }] },
    { id: "ctr0002", m: 20 }
  ]);
  const a = { cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001")], cx: [{ id: "ctr0001", m: 20, fmt: "p" }] };
  const b = { cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001")], cx: [{ id: "ctr0001", m: 21, fmt: "e" }] };
  assert.deepEqual(C.merge(a, b), C.merge(b, a));
  assert.equal(C.merge(a, b).cx[0].fmt, "e");
  // a device before 1.10 sends no cx: the newer one keeps its own
  const old = { cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001", { m: 30 })] };
  assert.equal(C.merge(a, old).cx[0].fmt, "p");
  // deleting the contract takes its cx row with it (same id)
  assert.equal("cx" in C.norm(Object.assign({}, a, { tombs: { ctr0001: 50 } })), false);
  assert.equal("cx" in C.norm({ cust: [cust("aaaaaa1", "A")] }), false, "older data keeps its bytes");
});

test("state: ended by agreement, ended, 90 days before the end, running", () => {
  const x = { id: "ctr0001", m: 1, end: "2026-10-01" };
  assert.equal(C.SOON_DAYS, 90);
  assert.equal(C.ctrState(ctr("a", { to: "2027-12-31" }), today, x), "term");
  assert.equal(C.ctrState(ctr("a", { to: "2026-11-10" }), today), "ended");
  assert.equal(C.ctrState(ctr("a", { to: "2027-02-09" }), today), "soon", "exactly 90 days");
  assert.equal(C.ctrState(ctr("a", { to: "2027-02-10" }), today), "on");
  assert.equal(C.ctrState(ctr("a"), today), "on", "no end day");
});

test("format and book from the title, whole years, the fixed follow-up id", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001", { t: "«Τα χέρια μου» (Ψηφιακό)" }), ctr("ctr0002", { t: "Μακρινό τραγούδι (ΕΝΤΥΠΟ)" }), ctr("ctr0003", { t: "Rights" })],
                     cx: [{ id: "ctr0003", m: 3, fmt: "e" }] });
  assert.deepEqual(d.ctr.map((k) => C.ctrFmt(d, k)), ["e", "p", "e"]);
  assert.deepEqual(d.ctr.map((k) => C.ctrBook(k)), ["Τα χέρια μου", "Μακρινό τραγούδι", "Rights"]);
  assert.equal(C.addYears("2026-12-02", 3), "2029-12-02");
  assert.equal(C.addYears("2024-02-29", 5), "2029-02-28");
  assert.equal(C.ctrFupId("ctr0001"), "rctr0001");
});

test("cxRow: a patch and one more history entry; empty values leave", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001")], cx: [{ id: "ctr0001", m: 4, fmt: "p", end: "2026-10-01" }] });
  const r = C.cxRow(d, "ctr0001", { end: "" }, { d: today, k: "reopen" });
  assert.deepEqual(r, { id: "ctr0001", m: 4, fmt: "p", h: [{ d: today, k: "reopen" }] });
  assert.equal(C.cxRow(d, "ctr0001", null, { d: today, k: "nope" }).h, undefined, "an unknown kind is dropped");
});

test("put off: the follow-up day, and no longer 'needs a decision' until then", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001", { to: "2026-11-01" }), ctr("ctr0002", { to: "2026-12-02" })],
                     cx: [{ id: "ctr0001", m: 4, h: [{ d: today, k: "post", v: "2026-11-18" }] }] });
  const [a, b] = d.ctr;
  assert.equal(C.ctrSnooze(C.cxOf(d, "ctr0001"), today), "2026-11-18");
  assert.equal(C.ctrFupDay(a, C.cxOf(d, "ctr0001"), today), "2026-11-18");
  assert.equal(C.ctrFupDay(b, null, today), "2026-11-27", "5 days before the end");
  assert.equal(C.ctrFupDay(b, { end: "2026-11-01" }, today), "", "none once ended by agreement");
  assert.equal(C.ctrSnooze(C.cxOf(d, "ctr0001"), "2026-11-19"), "", "a put-off day that has passed");
  assert.deepEqual(C.ctrAll(d, today, "needs").map((r) => r.ctr.id), ["ctr0002"]);
  assert.deepEqual(C.ctrAll(d, "2026-11-19", "needs").map((r) => r.ctr.id), ["ctr0001", "ctr0002"]);
});

test("ctrHeal: contracts without a follow-up get one with a fixed id, once", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], fups: [{ id: "ffff0001", m: 3, cust: "aaaaaa1", d: "2026-11-20", text: "x" }], ctr: [
    ctr("ctr0001", { to: "2026-12-02" }),                       // made by orOS Gate: no follow-up
    ctr("ctr0002", { to: "2026-11-01" }),                       // ended: Today asks, no follow-up
    ctr("ctr0003", { to: "2027-01-31", fup: "ffff0001" }),      // has its own
    ctr("ctr0004"),                                             // no end
    ctr("ctr0005", { to: "2026-11-13", rem: 30 })               // reminder day passed: today
  ] });
  assert.deepEqual(C.ctrHeal(d, today).map((p) => [p.ctr.id, p.fup, p.d]), [["ctr0001", "rctr0001", "2026-11-27"], ["ctr0005", "rctr0005", today]]);
  // a second device that already wrote it: nothing left to do
  const healed = C.norm(Object.assign({}, d, { fups: d.fups.concat([{ id: "rctr0001", m: 9, cust: "aaaaaa1", d: "2026-11-27", text: "y" }]) }));
  assert.deepEqual(C.ctrHeal(healed, today).map((p) => p.ctr.id), ["ctr0005"]);
});

test("Publishing: the linked title, else the one with the same name", () => {
  const titles = [{ id: "tt1", t: "Μη φοβάσαι απόψε", ppl: [{ n: "Μαρία Π" }] }, { id: "tt2", t: "Άλλο", ppl: [] },
                  { id: "tt3", t: "Λάκυ", ppl: [{ n: "A" }] }, { id: "tt4", t: "Λάκυ", ppl: [{ n: "B" }] }];
  const d = C.norm({ cust: [cust("aaaaaa1", "A"), cust("aaaaaa2", "Zed")], ctr: [
    ctr("ctr0001", { t: "«Μη φοβάσαι απόψε» (Έντυπο)", to: "2026-12-02" }),
    ctr("ctr0002", { t: "«ΜΗ ΦΟΒΑΣΑΙ ΑΠΟΨΕ» (Ψηφιακό)", to: "2026-03-01" }),
    ctr("ctr0003", { t: "«Λάκυ» (Έντυπο)", to: "2027-01-01" }),     // two titles: by the partner's name (A)
    ctr("ctr0004", { t: "Something else", to: "2027-01-01", cust: "aaaaaa2" })
  ], cx: [{ id: "ctr0004", m: 2, ti: "tt2" }] });
  assert.deepEqual(C.ctrForTitle(d, titles[0], titles, today).map((r) => [r.ctr.id, r.fmt, r.st]), [["ctr0001", "p", "soon"], ["ctr0002", "e", "ended"]]);
  assert.deepEqual(C.ctrForTitle(d, titles[2], titles, today).map((r) => r.ctr.id), ["ctr0003"]);
  assert.deepEqual(C.ctrForTitle(d, titles[3], titles, today), []);
  assert.deepEqual(C.ctrForTitle(d, titles[1], titles, today).map((r) => r.ctr.id), ["ctr0004"]);
});

test("Calendar: the end day, not the ended by agreement", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "A")], ctr: [ctr("ctr0001", { to: "2026-12-02" }), ctr("ctr0002", { to: "2026-12-02" })],
                     cx: [{ id: "ctr0002", m: 2, end: "2026-11-01" }] });
  assert.deepEqual(C.ctrEndsOn(d, "2026-12-02").map((k) => k.id), ["ctr0001"]);
  assert.deepEqual(C.ctrEndsOn(d, "2026-12-03"), []);
});

test("Revenue Splitter payload: names, titles, days, states; passes both allowlists", () => {
  const d = C.norm({ cust: [cust("aaaaaa1", "Ελένη Ζερβάκου (Helena Zelin)"), cust("aaaaaa2", "B")],
    rsl: [{ id: "aaaaaa1", m: 2, a: "shop1", n: ["Έλενα Ζελίν"] }],
    ctr: [ctr("ctr0001", { t: "«Book» (Print)", from: "2021-12-02", to: "2026-12-02", note: "private", val: 500 }),
          ctr("ctr0002", { t: "«Book» (Digital)", to: "2029-03-01", cust: "aaaaaa2" }), ctr("ctr0003", { t: "No end" })],
    cx: [{ id: "ctr0002", m: 2, h: [{ d: today, k: "renew", v: "2029-03-01", p: "2026-03-01" }] }] });
  const p = C.portalPayload(d, today);
  assert.deepEqual(p, { v: 1, sent: today, contracts: [
    { id: "ctr0001", ben: "Έλενα Ζελίν", title: "Book", fmt: "print", from: "2021-12-02", to: "2026-12-02", state: "soon", renewed: [] },
    { id: "ctr0002", ben: "B", title: "Book", fmt: "ebook", from: "", to: "2029-03-01", state: "on", renewed: ["2026-03-01"] }
  ] });
  assert.equal(JSON.stringify(p).indexOf("private"), -1, "no note leaves");
  const req = { m: "POST", path: "/rs/contracts", body: p };
  const cases = [
    [req, ""],
    [{ m: "GET", path: "/rs/contracts" }, ""],
    [{ m: "POST", path: "/rs/contracts", body: { v: 1, sent: today, contracts: [] } }, ""],
    [{ m: "POST", path: "/rs/contracts", body: { v: 2, sent: today, contracts: [] } }, "body"],
    [{ m: "POST", path: "/rs/contracts", body: Object.assign({}, p, { contracts: [Object.assign({}, p.contracts[0], { note: "x" })] }) }, "body"],
    [{ m: "POST", path: "/rs/contracts", body: Object.assign({}, p, { contracts: [Object.assign({}, p.contracts[0], { state: "gone" })] }) }, "body"],
    [{ m: "POST", path: "/rs/contracts", body: Object.assign({}, p, { contracts: [Object.assign({}, p.contracts[0], { title: "<b>x</b>" })] }) }, "body"],
    [{ m: "PUT", path: "/rs/contracts", body: p }, "path"],
    [{ m: "GET", path: "/rs/contracts?ben=x" }, "query"]
  ];
  for (const [r, want] of cases) {
    assert.equal(L.checkReq("woo", r), want, "app " + r.m + " " + r.path);
    assert.equal(X.checkExtReq("woo", r), want, "relay " + r.m + " " + r.path);
  }
});

test("Today: one line for the contracts that need a decision; a contract's follow-up gets its actions", () => {
  const raw = { cust: [cust("aaaaaa1", "Ann", { email: "a@example.gr" })],
    fups: [{ id: "rctr0001", m: 3, cust: "aaaaaa1", d: "2026-11-11", text: "Contract ends" }],
    ctr: [ctr("ctr0001", { to: "2026-11-16", fup: "rctr0001" }), ctr("ctr0002", { t: "Old", to: "2026-03-01" }), ctr("ctr0003", { t: "Far", to: "2030-01-01" })] };
  const ctx = { today: today, horizon: 3, now: Date.parse("2026-11-11T09:00:00"), lang: "en", readJSON: (k) => (k === "oros-crm-data" ? raw : null), readRaw: () => null };
  const rows = TODAY.collect(ctx);
  const fup = rows.find((r) => r.id === "rctr0001");
  assert.deepEqual(fup.acts.map((a) => [a.k, a.target["do"]]), [["renew", "renew"], ["putoff", "post"], ["email", "mail"]]);
  const info = rows.find((r) => r.id === "ctrs");
  assert.equal(info.kind, "info");
  assert.equal(info.title, "Contracts that need a decision: 2");
  assert.deepEqual(info.target, { ctrs: "needs" });
  assert.deepEqual(info.more.slice(0, 2), ["1 ended", "1 end within 90 days"]);
});
