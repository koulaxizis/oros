// orOS Gate PEND-1 (Chris 2026-11-16): changes Claude asked for while
// orOS was closed show as made (relay/gate.js pendingOf, pendNote,
// cancelPlan, nudgeAt) and run later with the time Claude asked, never
// over an item changed after it (gate/gate.js queuedAt, lateIn,
// mapRefs, chgMerge keeping q and p).
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../gate/gate.js");
let R;
test.before(async () => { R = await import("../relay/gate.js"); });

const Q = (c) => c.repeat(16);

test("relay: pending adds get p- refs by item, changes know every app they touch", () => {
  const ix = [{ r: "r1", a: "crm", t: "X" }, { r: "r2", a: "todo", t: "Y" }];
  const rows = [
    { id: Q("b"), n: "change_item", a: { ref: "p-" + Q("a") + ".1", note: "n" }, t: 20, s: 2 },
    { id: Q("a"), n: "create_items", a: { app: "contacts", items: [{ first: "Άννα", last: "Π" }, { name: "Νίκος" }] }, t: 10, s: 1 },
    { id: Q("c"), n: "link_contact", a: { links: [{ customer: "r1", contact: "p-" + Q("a") + ".0" }] }, t: 30, s: 3 },
    { id: Q("d"), n: "budget_add", a: { entries: [] }, t: 40, s: 4 }
  ];
  const p = R.pendingOf(rows, ix);
  assert.deepEqual(p.creates.map((c) => [c.ref, c.app, c.title]), [["p-" + Q("a") + ".0", "contacts", "Άννα Π"], ["p-" + Q("a") + ".1", "contacts", "Νίκος"]]);
  assert.deepEqual(p.changes.map((c) => [c.id, c.app, c.apps]), [[Q("b"), "contacts", ["contacts"]], [Q("c"), "crm", ["crm", "contacts"]], [Q("d"), "budget", ["budget"]]]);
  const note = JSON.parse(R.pendNote(p, ["contacts"]).split("\n").pop());
  assert.equal(note.waiting_added.length, 2);
  assert.deepEqual(note.waiting_changes.map((x) => x.change_id), [Q("b"), Q("c")]);
  assert.equal(R.pendNote(p, ["notes"]), "", "nothing for an app without waiting changes");
  assert.equal(R.pendNote(R.pendingOf([], ix), null), "");
  assert.deepEqual(R.refsIn({ ref: "p-" + Q("a") + ".3", item: "p-bad.1", items: ["r4"] }), ["p-" + Q("a") + ".3", "r4"]);
});

test("relay: cancel takes back what names a cancelled add; last = the newest; unknown ids are not waiting", () => {
  const rows = [
    { id: Q("a"), n: "create_items", a: { app: "todo", items: [{ title: "t" }] }, t: 10 },
    { id: Q("b"), n: "change_item", a: { ref: "p-" + Q("a") + ".0" }, t: 20 },
    { id: Q("c"), n: "create_items", a: { app: "crm", items: [{ name: "c" }] }, t: 30 },
    { id: Q("e"), n: "link_items", a: { links: [{ customer: "p-" + Q("c") + ".0", item: "p-" + Q("a") + ".0" }] }, t: 40 }
  ];
  const p = R.pendingOf(rows, []);
  assert.deepEqual(R.cancelPlan(p, { ids: [Q("a")] }).ids.sort(), [Q("a"), Q("b"), Q("e")].sort());
  assert.deepEqual(R.cancelPlan(p, { ids: [Q("b")] }).ids, [Q("b")], "a change alone");
  assert.deepEqual(R.cancelPlan(p, { last: true }).ids, [Q("e")]);
  const x = R.cancelPlan(p, { ids: ["zz", Q("c")] });
  assert.deepEqual(x.other, ["zz"]);
  assert.deepEqual(x.ids.sort(), [Q("c"), Q("e")].sort());
});

test("relay: the daily reminder is due 6 h after the oldest waiting change, then a day after the last", () => {
  const H = 3600000;
  assert.equal(R.nudgeAt(new Map(), {}), 0);
  const q = new Map([["q:1", { t: 100 * H }], ["q:2", { t: 90 * H }]]);
  assert.equal(R.nudgeAt(q, {}), 96 * H);
  assert.equal(R.nudgeAt(q, { qn: 95 * H }), 119 * H);
  assert.equal(R.itemTitle({ text: "  x " }), "x");
  assert.equal(R.itemTitle({ company: "Γλαρόλυκοι" }), "Γλαρόλυκοι");
  assert.equal(R.itemTitle(null), "");
});

test("device: the time Claude asked, within the box's 7 days and never after now", () => {
  const now = 1e12;
  assert.equal(D.queuedAt(now - 5000, now), now - 5000);
  assert.equal(D.queuedAt(now + 5000, now), now, "a clock ahead: now");
  assert.equal(D.queuedAt(now - 9 * 86400000, now), 0, "too old: none");
  assert.equal(D.queuedAt("x", now), 0);
});

test("device: an item changed at or after the time Claude asked is left alone (data before and after)", () => {
  const at = 1000;
  // Contacts without fm: the item's mtime
  const ct = (m, extra) => ({ ver: 1, contacts: [Object.assign({ id: "c1", given: "Anna", mtime: m }, extra || {})], deleted: [] });
  assert.equal(D.lateIn(ct(999), ct(1001, { jobTitle: "Editor" }), at), false);
  assert.equal(D.lateIn(ct(1000), ct(1001, { jobTitle: "Editor" }), at), true);
  // per-field fm: only the changed fields count
  const f = (fm, extra) => ct(1500, Object.assign({ fm }, extra || {}));
  assert.equal(D.lateIn(f({ given: 1500, note: 10 }), f({ given: 1500, note: 1501 }, { note: "x" }), at), false, "the owner changed another field");
  assert.equal(D.lateIn(f({ given: 1500, note: 1200 }), f({ given: 1500, note: 1501 }, { note: "x" }), at), true);
  // a list of unstamped values (phones) is a field of its item
  assert.equal(D.lateIn(ct(1200, { phones: [] }), ct(1201, { phones: [{ v: "69", type: "m" }] }), at), true);
  // an add (a new stamped child) never waits for an older edit, even with a container stamp
  const bud = (txs, m) => ({ m, tx: txs });
  assert.equal(D.lateIn(bud([{ id: "t1", m: 5000, n: "a" }], 5000), bud([{ id: "t1", m: 5000, n: "a" }, { id: "t2", m: 1001, n: "b" }], 5001), at), false);
  assert.equal(D.lateIn(bud([{ id: "t1", m: 5000, n: "a" }], 10), bud([{ id: "t1", m: 5001, n: "c" }], 10), at), true, "the entry itself");
  assert.equal(D.lateIn(bud([{ id: "t1", m: 900, n: "a" }, { id: "t0", m: 5000 }], 10), bud([{ id: "t0", m: 5000 }, { id: "t1", m: 1001, n: "c" }], 10), at), false, "matched by id, not place");
  // a removal: the removed item's stamp
  assert.equal(D.lateIn(bud([{ id: "t1", m: 2000 }], 1), bud([], 1), at), true);
  assert.equal(D.lateIn(bud([{ id: "t1", m: 900 }], 1), bud([], 1), at), false);
  // Kanban: a card inside a column inside a board; the column's own stamp does not count
  const kb = (cm, title, colm) => ({ boards: [{ id: "b1", mtime: colm, cols: [{ id: "k1", mtime: colm, cards: [{ id: "c1", mtime: cm, title }] }] }] });
  assert.equal(D.lateIn(kb(900, "a", 5000), kb(1001, "b", 5000), at), false);
  assert.equal(D.lateIn(kb(1100, "a", 5), kb(1101, "b", 5), at), true);
  assert.equal(D.lateIn(ct(5000), ct(5001, { note: "x" }), 0), false, "a live call: never");
});

test("device: p- refs are found and swapped where refsIn looks; the record keeps q and p", () => {
  const P = "p-" + Q("a") + ".0", P2 = "p-" + Q("a") + ".1";
  const a = { ref: "oros:" + P, links: [{ customer: "r1", contact: P2 }], items: [{ trip: P }], note: P };
  assert.deepEqual(D.pRefsIn(a), [P, P2]);
  const b = D.mapRefs(a, (r) => (r === P ? "r10" : "r11"));
  assert.deepEqual([b.ref, b.links[0].contact, b.links[0].customer, b.items[0].trip, b.note], ["r10", "r11", "r1", "r10", P], "free text stays as it is");
  assert.equal(a.ref, "oros:" + P, "the arguments are not changed in place");
  const rec = { app: "contacts", target: "c-1", title: "Άννα", id: "c-1" };
  const l = D.chgMerge([{ id: "abcd1", t: 5, app: "contacts", n: "create_items", k: 1, dv: "PC", q: Q("a"), p: { 0: rec, x: rec }, at: 4 }],
                       [{ id: "abcd1", t: 5, app: "contacts", n: "create_items", k: 1, dv: "PC" }]);
  assert.equal(l[0].q, Q("a"));
  assert.deepEqual(l[0].p, { 0: rec }, "only item indexes");
  assert.equal(l[0].at, 4);
});
