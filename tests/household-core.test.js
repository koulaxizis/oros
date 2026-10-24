// Household shared documents and membership (household/core.js) and
// their encryption (household/crypto.js): the merge laws, stamps,
// apply / view / diffItems, the roster, the membership slice, and every
// sealed format round trip (wrong key, wrong place, wrong password fail).
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../household/core.js");
const X = require("../household/crypto.js");

const T0 = 1.7e12;
function rnd(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }
function randomDoc(r, by) {
  let d = H.empty("todo");
  const ids = ["a", "b", "c", "d", "e"];
  for (let i = 0; i < 12; i++) {
    const t = T0 + Math.floor(r() * 50);
    const id = ids[Math.floor(r() * ids.length)];
    if (r() < 0.2) d = H.apply(d, { del: [id] }, t, by);
    else d = H.apply(d, { set: { [id]: { text: "x" + Math.floor(r() * 4), done: r() < 0.5, o: Math.floor(r() * 3) } }, m: { name: "L" + Math.floor(r() * 3) } }, t, by);
  }
  return d;
}

test("merge is symmetric, idempotent and associative on random histories", () => {
  const r = rnd(7);
  for (let k = 0; k < 200; k++) {
    const a = randomDoc(r, "AAAAAAAAAAAAAAAAAAAAAA"), b = randomDoc(r, "BBBBBBBBBBBBBBBBBBBBBB"), c = randomDoc(r, "CCCCCCCCCCCCCCCCCCCCCC");
    assert.deepEqual(H.merge(a, b), H.merge(b, a));
    assert.deepEqual(H.merge(a, a), H.canon(a));
    assert.deepEqual(H.merge(H.merge(a, b), c), H.merge(a, H.merge(b, c)));
    const ab = H.merge(a, b);
    assert.deepEqual(H.merge(ab, a), ab);
    assert.deepEqual(H.clean(JSON.parse(JSON.stringify(ab))), ab);
  }
});

test("field by field: two people edit different fields of the same item", () => {
  let base = H.apply(null, { set: { milk: { text: "Milk", done: false } } }, T0, "p1");
  const mine = H.apply(base, { set: { milk: { done: true } } }, T0 + 5, "p1");
  const theirs = H.apply(base, { set: { milk: { text: "Milk 2L" } } }, T0 + 3, "p2");
  const v = H.view(H.merge(mine, theirs)).items[0];
  assert.equal(v.text, "Milk 2L");
  assert.equal(v.done, true);
  assert.equal(v._t, T0 + 5);
  assert.equal(v._by, "p1");
  // same stamp: the larger member id wins, both ways
  const x = H.apply(base, { set: { milk: { text: "A" } } }, T0 + 9, "p1");
  const y = H.apply(base, { set: { milk: { text: "B" } } }, T0 + 9, "p2");
  assert.equal(H.view(H.merge(x, y)).items[0].text, "B");
  assert.equal(H.view(H.merge(y, x)).items[0].text, "B");
});

test("delete beats older edits, a newer edit brings the item back with only its new fields", () => {
  const base = H.apply(null, { set: { a: { text: "Bread", notes: "brown" } } }, T0, "p1");
  const del = H.apply(base, { del: ["a"] }, T0 + 10, "p1");
  const oldEdit = H.apply(base, { set: { a: { notes: "white" } } }, T0 + 5, "p2");
  assert.equal(H.view(H.merge(del, oldEdit)).items.length, 0);
  const newEdit = H.apply(base, { set: { a: { notes: "rye" } } }, T0 + 20, "p2");
  const back = H.view(H.merge(del, newEdit)).items;
  assert.equal(back.length, 1);
  assert.equal(back[0].notes, "rye");
  assert.equal(back[0].text, undefined);
  // writing a deleted item again on this device
  const again = H.view(H.apply(del, { set: { a: { text: "Bread" } } }, T0 + 30, "p1")).items;
  assert.equal(again[0].text, "Bread");
  assert.equal(again[0].notes, undefined);
});

test("apply only stamps what really changes; old deletions are dropped", () => {
  const a = H.apply(null, { set: { a: { text: "x", done: false } }, m: { name: "Home" } }, T0, "p1");
  assert.deepEqual(H.apply(a, { set: { a: { text: "x" } }, m: { name: "Home" } }, T0 + 1, "p1"), a);
  assert.throws(() => H.apply(a, {}, -1, "p1"));
  let d = H.apply(a, { del: ["a"] }, T0 + 1, "p1");
  assert.ok(d.dt.a);
  d = H.apply(d, { set: { b: { text: "y" } } }, T0 + 1 + H.TOMB_MS + 5, "p1");
  assert.equal(d.dt.a, undefined);
  assert.equal(H.clock(T0 + 100, T0), T0 + 101);
  assert.equal(H.clock(T0, T0 + 100), T0 + 100);
});

test("view orders by o then id; diffItems finds set and deleted fields", () => {
  const d = H.apply(null, { set: { b: { text: "B", o: 1 }, a: { text: "A", o: 2 }, c: { text: "C", o: 1 } } }, T0, "p1");
  assert.deepEqual(H.view(d).items.map((i) => i.id), ["b", "c", "a"]);
  const prev = { a: { text: "A", done: false }, b: { text: "B" } };
  const next = { a: { text: "A", done: true }, c: { text: "C" } };
  assert.deepEqual(H.diffItems(prev, next), { set: { a: { done: true }, c: { text: "C" } }, del: ["b"] });
  assert.equal(H.diffItems(prev, prev), null);
  assert.deepEqual(H.diffItems({ a: { x: 1 } }, { a: {} }, ["x"]), { set: { a: { x: null } }, del: [] });
});

test("clean drops hostile parts and keeps the rest", () => {
  const d = H.clean({
    kind: "todo<script>", m: { name: ["Home", T0, "p1"], "bad key": ["x", T0, "p1"], big: ["x".repeat(9000), T0, "p1"] },
    it: { ok: { text: ["hi", T0, "p1"], neg: ["x", -5, "p1"] }, "../x": { text: ["no", T0, "p1"] }, empty: {} },
    dt: { gone: T0, bad: "x" }
  }, "todo");
  assert.equal(d.kind, "todo");
  assert.deepEqual(Object.keys(d.m), ["name"]);
  assert.deepEqual(Object.keys(d.it), ["ok"]);
  assert.deepEqual(Object.keys(d.it.ok), ["text"]);
  assert.deepEqual(d.dt, { gone: T0 });
  assert.deepEqual(H.clean("nonsense").it, {});
});

test("roster: members, shared documents, invites; initials", () => {
  const MID = "MeMbEr0123456789abcdef";
  const d = H.apply(null, {
    m: { name: "Home" },
    set: { ["p:" + MID]: { n: "Eleni\u2028 K", c: 3, pub: "x".repeat(87), adm: true, j: T0 },
           "c:list1": { kind: "todo", t: "Shopping" },
           ["i:" + "a".repeat(64)]: { s: "s".repeat(43), exp: T0 + 1, n: 1, by: MID },
           "x:junk": { a: 1 } }
  }, T0, MID);
  const r = H.roster(d);
  assert.equal(r.name, "Home");
  assert.equal(r.members.length, 1);
  assert.equal(r.members[0].name, "Eleni K");
  assert.equal(r.members[0].admin, true);
  assert.equal(r.members[0].color, H.COLORS[3]);
  assert.deepEqual(r.docs.map((x) => [x.id, x.kind, x.title]), [["list1", "todo", "Shopping"]]);
  assert.equal(r.invites[0].ih, "a".repeat(64));
  assert.equal(H.initials("Eleni Kosta Papa"), "EP");
  assert.equal(H.initials(""), "?");
});

const PRIV = { kty: "EC", crv: "P-256", d: "d".repeat(43), x: "x".repeat(43), y: "y".repeat(43) };
const BOX = "BoXbOx0123456789abcdef";
function entry(o) {
  return Object.assign({ name: "Home", mid: "MMMMMMMMMMMMMMMMMMMMMM", pub: "p".repeat(87), priv: PRIV, keys: { 1: "k".repeat(43) }, adm: "", at: T0, m: T0 }, o);
}

test("membership: keys are the union, tombstones win over older entries", () => {
  const a = { v: 1, hh: { [BOX]: entry({ keys: { 1: "k".repeat(43) } }) }, tomb: {} };
  const b = { v: 1, hh: { [BOX]: entry({ keys: { 1: "k".repeat(43), 2: "K".repeat(43) }, adm: "A".repeat(43), m: T0 + 5 }) }, tomb: {} };
  const ab = H.mergeMembership(a, b);
  assert.deepEqual(ab, H.mergeMembership(b, a));
  assert.deepEqual(H.mergeMembership(ab, ab), ab);
  assert.deepEqual(Object.keys(ab.hh[BOX].keys), ["1", "2"]);
  assert.equal(ab.hh[BOX].epoch, 2);
  assert.equal(ab.hh[BOX].adm, "A".repeat(43));
  const left = H.mergeMembership(ab, { v: 1, hh: {}, tomb: { [BOX]: T0 + 6 } });
  assert.deepEqual(left.hh, {});
  const rejoin = H.mergeMembership(left, { v: 1, hh: { [BOX]: entry({ mid: "NNNNNNNNNNNNNNNNNNNNNN", m: T0 + 9 }) }, tomb: {} });
  assert.equal(rejoin.hh[BOX].mid, "NNNNNNNNNNNNNNNNNNNNNN");
  // two devices joined on their own: the smaller member id stays
  const x = { hh: { [BOX]: entry({ mid: "ZZZZZZZZZZZZZZZZZZZZZZ" }) } }, y = { hh: { [BOX]: entry({ mid: "AAAAAAAAAAAAAAAAAAAAAA" }) } };
  assert.equal(H.mergeMembership(x, y).hh[BOX].mid, "AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(H.mergeMembership(y, x).hh[BOX].mid, "AAAAAAAAAAAAAAAAAAAAAA");
  assert.deepEqual(H.cleanMembership({ hh: { [BOX]: entry({ priv: { kty: "RSA" } }) } }).hh, {});
});

test("crypto: documents seal and open, any change or wrong place fails", async () => {
  const K = X.newKey(), doc = H.apply(null, { set: { a: { text: "Γάλα ".repeat(50) } } }, T0, "p1");
  const bytes = await X.seal(K, 3, BOX, "list1", doc);
  assert.equal(X.epochOf(bytes), 3);
  assert.deepEqual(await X.open({ 3: K }, BOX, "list1", bytes), doc);
  await assert.rejects(X.open({ 2: K }, BOX, "list1", bytes));
  await assert.rejects(X.open({ 3: X.newKey() }, BOX, "list1", bytes));
  await assert.rejects(X.open({ 3: K }, BOX, "list2", bytes));
  const bad = bytes.slice(); bad[bad.length - 1] ^= 1;
  await assert.rejects(X.open({ 3: K }, BOX, "list1", bad));
  const w1 = await X.writeToken(K), w2 = await X.writeToken(K);
  assert.equal(w1, w2);
  assert.match(w1, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(w1, await X.writeToken(X.newKey()));
});

test("crypto: answers and envelopes open only with the member's private key", async () => {
  const m = await X.newMemberKey(), other = await X.newMemberKey();
  assert.match(m.pub, /^[A-Za-z0-9_-]{87}$/);
  const sealed = await X.wrap(m.pub, BOX, { keys: { 1: "k".repeat(43) } });
  assert.deepEqual(await X.unwrap(m.priv, BOX, sealed), { keys: { 1: "k".repeat(43) } });
  await assert.rejects(X.unwrap(other.priv, BOX, sealed));
  await assert.rejects(X.unwrap(m.priv, "AnotherBox0123456789ab", sealed));
  const I = X.rand(32);
  const req = await X.inviteSeal(I, BOX, { n: "Νίκος" });
  assert.deepEqual(await X.inviteOpen(I, BOX, req), { n: "Νίκος" });
  await assert.rejects(X.inviteOpen(X.rand(32), BOX, req));
});

test("crypto: invite codes with and without a password", async () => {
  X._setIter(1000);
  try {
    const I = X.rand(32);
    const c1 = await X.makeCode(BOX, I);
    assert.deepEqual(X.parseCode("https://useoros.online/share/#" + c1), { box: BOX, secret: I, locked: false });
    const c2 = await X.makeCode(BOX, I, "πάσσγουορντ");
    const p = X.parseCode("look: https://useoros.online/share/#" + c2 + " ok");
    assert.equal(p.locked, true);
    assert.deepEqual(await X.unlock(p, "πάσσγουορντ"), { box: BOX, secret: I, locked: false });
    await assert.rejects(X.unlock(p, "wrong"));
    assert.equal(X.parseCode("h1.short.x"), null);
    assert.equal(X.parseCode("xh1." + BOX + "." + I), null);
  } finally { X._setIter(600000); }
});
