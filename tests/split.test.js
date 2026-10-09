// Pure logic of Split: amounts, the split of one expense (cents left
// over by a fixed rule), balances, settling up, the slice merge (sync
// slice "split", incl. a deleted group taking its children), the text
// summary, the CSV and the group file (which may only ever carry its
// own group).
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the constants and
// sections 2–5 are cut out of the source and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "split/split.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const S = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { MAX_CENTS, PCT_FULL, parseAmount, parsePart, parseShares, centsToInput, centsPlain, parseYmd," +
  " normExp, normPay, normGroup, normPerson, mergeSplit, emptyData, sharesOf, balancesOf, settleUp, groupTotal," +
  " summaryText, csvCell, buildCsv, packGroup, unpackGroup, changedCount, meOf };")();

const canon = (x) => JSON.stringify(x);
const G = "g1";
const A = G + ".a", B = G + ".b", C = G + ".c";
function D(parts) { return Object.assign(S.emptyData(), parts || {}); }
function grp(id, m, extra) { return Object.assign({ id, m, n: "Naxos", col: 2, cur: "EUR", arch: 0 }, extra || {}); }
function per(id, m, n) { return { id, m, n }; }
function ex(id, m, a, by, mode, w, extra) {
  return Object.assign({ id, m, t: "Dinner", a, d: "2026-10-08", c: "food", by, mode, w, n: "" }, extra || {});
}
function eq(id, a, payer, who, m) {
  const w = {};
  who.forEach((k) => { w[k] = 1; });
  return ex(id, m || 1, a, { [payer]: a }, "eq", w);
}
function base() {
  return D({ groups: [grp(G, 1)], people: [per(A, 1, "Anna"), per(B, 1, "Nikos"), per(C, 1, "Maria")] });
}
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

// ---------- amounts ----------
test("amounts: Greek and English ways of writing them, in cents", () => {
  const ok = { "12": 1200, "12,5": 1250, "12,50": 1250, "12.50": 1250, "1.234,56": 123456, "1,250": 125000, "€ 7": 700 };
  Object.keys(ok).forEach((s) => assert.equal(S.parseAmount(s), ok[s], s));
  ["", "0", "-5", "abc", "1,2,3", "12,345,6", null].forEach((s) => assert.equal(S.parseAmount(s), null, String(s)));
  assert.equal(S.parseAmount("1000000000,01"), null);
});

test("split fields: empty or zero is left out, percentages in hundredths", () => {
  assert.equal(S.parsePart(""), 0);
  assert.equal(S.parsePart("0"), 0);
  assert.equal(S.parsePart("0,00"), 0);
  assert.equal(S.parsePart("33,33"), 3333);
  assert.equal(S.parsePart("50 %"), 5000);
  assert.equal(S.parsePart("x"), null);
  assert.equal(S.parseShares(""), 0);
  assert.equal(S.parseShares("2"), 2);
  assert.equal(S.parseShares("1.5"), null);
  assert.equal(S.parseShares("1001"), null);
});

// ---------- one expense ----------
test("equal split: the leftover cents go to the largest remainders, ties by person id", () => {
  const x = eq(G + ".e1", 1000, A, [C, A, B]);
  assert.deepEqual(S.sharesOf(x), { [A]: 334, [B]: 333, [C]: 333 });
  const y = eq(G + ".e2", 1001, A, [A, B, C]);
  assert.deepEqual(S.sharesOf(y), { [A]: 334, [B]: 334, [C]: 333 });
  const z = eq(G + ".e3", 1, A, [A, B, C]);
  assert.deepEqual(S.sharesOf(z), { [A]: 1, [B]: 0, [C]: 0 });
});

test("shares and percentages: proportional, always adding up to the amount", () => {
  const sh = ex(G + ".e1", 1, 10000, { [A]: 10000 }, "sh", { [A]: 2, [B]: 1 });
  assert.deepEqual(S.sharesOf(sh), { [A]: 6667, [B]: 3333 });
  const pc = ex(G + ".e2", 1, 999, { [A]: 999 }, "pc", { [A]: 3333, [B]: 3333, [C]: 3334 });
  const out = S.sharesOf(pc);
  assert.equal(sum(out), 999);
  assert.deepEqual(out, { [A]: 333, [B]: 333, [C]: 333 });
  for (let a = 1; a < 400; a += 7) {
    const r = S.sharesOf(ex(G + ".x", 1, a, { [A]: a }, "sh", { [A]: 3, [B]: 5, [C]: 7 }));
    assert.equal(sum(r), a, "sum for " + a);
  }
  const exact = ex(G + ".e3", 1, 1500, { [A]: 1500 }, "ex", { [A]: 1000, [C]: 500 });
  assert.deepEqual(S.sharesOf(exact), { [A]: 1000, [C]: 500 });
});

test("normExp: payers and split must add up, people must belong to the group", () => {
  assert.ok(S.normExp(eq(G + ".e1", 1000, A, [A, B])));
  assert.equal(S.normExp(ex(G + ".e1", 1, 1000, { [A]: 900 }, "eq", { [A]: 1 })), null);        // payers ≠ amount
  assert.equal(S.normExp(ex(G + ".e1", 1, 1000, { [A]: 1000 }, "ex", { [A]: 400 })), null);      // exact ≠ amount
  assert.equal(S.normExp(ex(G + ".e1", 1, 1000, { [A]: 1000 }, "pc", { [A]: 5000 })), null);     // ≠ 100 %
  assert.equal(S.normExp(ex(G + ".e1", 1, 1000, { [A]: 1000 }, "eq", { [A]: 2 })), null);        // eq weight 1
  assert.equal(S.normExp(ex(G + ".e1", 1, 1000, { [A]: 1000 }, "eq", {})), null);                // nobody
  assert.equal(S.normExp(ex(G + ".e1", 1, 1000, { "g2.a": 1000 }, "eq", { [A]: 1 })), null);     // other group
  assert.equal(S.normExp(ex(G + ".e1", 1, 1000, { [A]: 1000 }, "zz", { [A]: 1 })), null);        // mode
  const n = S.normExp(ex(G + ".e1", 1, 1000, { [A]: 1000 }, "eq", { [B]: 1, [A]: 1 }, { c: "nope", t: " a\u0000b ", extra: 1 }));
  assert.equal(n.c, "other");
  assert.equal(n.t, "a b");
  assert.equal(n.extra, undefined);
  assert.deepEqual(Object.keys(n.w), [A, B]);   // canonical key order
});

// ---------- balances + settling up ----------
test("balances add up to zero; payments move them", () => {
  const d = base();
  d.exp = [eq(G + ".e1", 3000, A, [A, B, C]), eq(G + ".e2", 900, B, [B, C])];
  let r = S.balancesOf(d, G);
  assert.deepEqual([r[A].bal, r[B].bal, r[C].bal], [2000, -550, -1450]);
  assert.equal(r[A].bal + r[B].bal + r[C].bal, 0);
  assert.equal(r[A].paid, 3000);
  assert.equal(r[C].share, 1450);
  d.pay = [{ id: G + ".p1", m: 1, f: C, to: A, a: 1450, d: "2026-10-09" }];
  r = S.balancesOf(d, G);
  assert.deepEqual([r[A].bal, r[B].bal, r[C].bal], [550, -550, 0]);
});

test("settle up: fewest payments, deterministic, everyone ends at zero", () => {
  const rows = {
    p1: { id: "p1", bal: 5000 }, p2: { id: "p2", bal: -2000 }, p3: { id: "p3", bal: -2000 },
    p4: { id: "p4", bal: -1000 }, p5: { id: "p5", bal: 0 }
  };
  const out = S.settleUp(rows);
  assert.deepEqual(out, [{ f: "p2", to: "p1", a: 2000 }, { f: "p3", to: "p1", a: 2000 }, { f: "p4", to: "p1", a: 1000 }]);
  const two = S.settleUp({ x: { id: "x", bal: 700 }, y: { id: "y", bal: 300 }, z: { id: "z", bal: -1000 } });
  assert.deepEqual(two, [{ f: "z", to: "x", a: 700 }, { f: "z", to: "y", a: 300 }]);
  assert.deepEqual(S.settleUp({ x: { id: "x", bal: 0 } }), []);
  // Random groups: at most n − 1 payments and every balance cleared.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 50; k++) {
    const n = 2 + Math.floor(rnd() * 8), rr = {};
    let tot = 0;
    for (let i = 0; i < n - 1; i++) { const v = Math.floor(rnd() * 20000) - 10000; rr["q" + i] = { id: "q" + i, bal: v }; tot += v; }
    rr["q" + (n - 1)] = { id: "q" + (n - 1), bal: -tot };
    const pays = S.settleUp(rr);
    assert.ok(pays.length <= n - 1);
    const left = {};
    Object.keys(rr).forEach((x) => { left[x] = rr[x].bal; });
    pays.forEach((p) => { left[p.f] += p.a; left[p.to] -= p.a; assert.ok(p.a > 0); });
    Object.keys(left).forEach((x) => assert.equal(left[x], 0));
  }
});

// ---------- merge ----------
test("merge: LWW per id, tombstones win ties, symmetric, idempotent, canonical", () => {
  const a = base(), b = base();
  a.exp = [eq(G + ".e1", 1000, A, [A, B], 5)];
  b.exp = [eq(G + ".e1", 2000, B, [A, B], 7), eq(G + ".e2", 500, C, [C, A], 3)];
  const ab = S.mergeSplit(a, b), ba = S.mergeSplit(b, a);
  assert.equal(canon(ab), canon(ba));
  assert.equal(canon(S.mergeSplit(ab, ab)), canon(ab));
  assert.equal(ab.exp.length, 2);
  assert.equal(ab.exp[0].a, 2000);
  const del = base();
  del.tombs = { ["exp:" + G + ".e1"]: 7 };
  const m = S.mergeSplit(ab, del);
  assert.deepEqual(m.exp.map((x) => x.id), [G + ".e2"]);
  const newer = base();
  newer.exp = [eq(G + ".e1", 3000, A, [A], 8)];
  assert.equal(S.mergeSplit(m, newer).exp.length, 2);   // a newer edit comes back
  // Garbage in, nothing out
  const junk = { groups: [{ id: "BAD" }, null, 5], people: "x", exp: [{}], tombs: { "foo:1": 3, "exp:x": -1 } };
  assert.equal(canon(S.mergeSplit(junk, null)), canon(S.emptyData()));
});

test("merge: a deleted group takes its people, expenses, payments and `mine` with it", () => {
  const a = base();
  a.exp = [eq(G + ".e1", 1000, A, [A, B], 2)];
  a.pay = [{ id: G + ".p1", m: 2, f: B, to: A, a: 500, d: "2026-10-09" }];
  a.mine = [{ id: G, m: 2, v: A }];
  a.groups.push(grp("g2", 1, { n: "Flat" }));
  a.people.push(per("g2.x", 1, "Kostas"));
  const del = D({ tombs: { "grp:g1": 10 } });
  const m = S.mergeSplit(a, del);
  assert.deepEqual(m.groups.map((g) => g.id), ["g2"]);
  assert.deepEqual(m.people.map((p) => p.id), ["g2.x"]);
  assert.equal(m.exp.length + m.pay.length + m.mine.length, 0);
  assert.equal(canon(S.mergeSplit(del, a)), canon(m));
  // An expense added on another device after the delete goes too
  const late = base();
  late.exp = [eq(G + ".e9", 100, A, [A], 50)];
  assert.equal(S.mergeSplit(m, late).exp.length, 0);
  // The group edited after the delete comes back with every child still around
  const back = S.mergeSplit(m, Object.assign(base(), { groups: [grp(G, 11)], exp: [eq(G + ".e1", 1000, A, [A, B], 2)] }));
  assert.ok(back.groups.some((g) => g.id === G));
  assert.equal(back.exp.length, 1);
  assert.equal(back.people.filter((p) => p.id.startsWith("g1.")).length, 3);
});

test("mine: who I am is LWW per group and must be a person of that group", () => {
  const a = D({ mine: [{ id: G, m: 3, v: A }] }), b = D({ mine: [{ id: G, m: 5, v: B }] });
  assert.equal(S.meOf(S.mergeSplit(a, b), G), B);
  assert.equal(S.mergeSplit(D({ mine: [{ id: G, m: 1, v: "g2.a" }] }), null).mine[0].v, "");
});

// ---------- summary + CSV ----------
test("summary text: who pays whom, balances, total", () => {
  const d = base();
  d.exp = [eq(G + ".e1", 3000, A, [A, B, C])];
  const names = { [A]: "Anna", [B]: "Nikos", [C]: "Maria" };
  const tr = (k, p) => k + (p ? JSON.stringify(p) : "");
  const txt = S.summaryText(d, G, tr, (id) => names[id], (c) => (c / 100).toFixed(2));
  const lines = txt.split("\n");
  assert.equal(lines[0], "Naxos");
  assert.equal(lines[1], 'sh.total{"a":"30.00"}');
  assert.ok(lines.includes("• Maria → Anna: 10.00"));
  assert.ok(lines.includes("• Nikos → Anna: 10.00"));
  assert.ok(lines.includes("• Anna: +20.00"));
  assert.ok(lines.includes("• Maria: −10.00"));
});

test("CSV: formula guard, Greek and standard formats", () => {
  assert.equal(S.csvCell("=SUM(A1)", ","), "'=SUM(A1)");
  assert.equal(S.csvCell('a"b,c', ","), '"a""b,c"');
  const el = S.buildCsv(["Ημ.", "Ποσό"], [["2026-10-08", 1250]], "excel");
  assert.equal(el, "﻿Ημ.;Ποσό\r\n2026-10-08;12,50\r\n");
  const en = S.buildCsv(["Date", "Amount"], [["2026-10-08", 1250]], "std");
  assert.equal(en, "﻿Date,Amount\r\n2026-10-08,12.50\r\n");
});

// ---------- group file ----------
test("group file: carries its group only, never `mine`, round-trips by merge", () => {
  const d = base();
  d.exp = [eq(G + ".e1", 1000, A, [A, B], 2)];
  d.mine = [{ id: G, m: 2, v: A }];
  d.groups.push(grp("g2", 1, { n: "Flat" }));
  d.people.push(per("g2.x", 1, "Kostas"));
  d.tombs = { ["exp:" + G + ".old"]: 4, "exp:g2.zz": 4, "grp:g9": 4 };
  const md = S.mergeSplit(d, null);
  const file = JSON.parse(JSON.stringify(S.packGroup(md, G)));
  assert.equal(file.app, "oros-split-group");
  assert.deepEqual(file.data.groups.map((g) => g.id), [G]);
  assert.deepEqual(file.data.mine, []);
  assert.deepEqual(Object.keys(file.data.tombs), ["exp:" + G + ".old"]);
  const pk = S.unpackGroup(file);
  assert.equal(pk.gid, G);
  // A friend joins, adds an expense, sends it back: joins, nothing doubles
  const friend = S.mergeSplit(S.emptyData(), pk.data);
  friend.exp.push(eq(G + ".f1", 600, B, [A, B, C], 9));
  const back = S.unpackGroup(JSON.parse(JSON.stringify(S.packGroup(S.mergeSplit(friend, null), G))));
  const mine2 = S.mergeSplit(md, back.data);
  assert.deepEqual(mine2.exp.map((x) => x.id), [G + ".e1", G + ".f1"]);
  assert.equal(S.meOf(mine2, G), A);                       // my "me" untouched
  assert.equal(canon(S.mergeSplit(mine2, back.data)), canon(mine2));   // again: no change
  assert.equal(S.changedCount(mine2, S.mergeSplit(mine2, back.data)), 0);
});

test("group file: a hostile file cannot touch other groups or smuggle markup", () => {
  const evil = {
    app: "oros-split-group",
    data: {
      groups: [grp(G, 9, { n: "<img src=x onerror=alert(1)>" })],
      people: [per(A, 9, "<script>x</script>"), per("g2.x", 99, "Hijack")],
      exp: [eq("g2.e1", 100, "g2.x", ["g2.x"], 99), ex(G + ".e1", 9, 100, { [A]: 100 }, "eq", { [A]: 1 }, { "__proto__": { polluted: 1 } })],
      pay: [{ id: "g2.p", m: 99, f: "g2.x", to: "g2.y", a: 5, d: "2026-01-01" }],
      mine: [{ id: "g2", m: 99, v: "g2.x" }, { id: G, m: 99, v: A }],
      tombs: { "grp:g2": 999, "exp:g2.e1": 999, ["exp:" + G + ".e1"]: 1 }
    }
  };
  const pk = S.unpackGroup(evil);
  assert.equal(pk.gid, G);
  assert.deepEqual(pk.data.people.map((p) => p.id), [A]);
  assert.deepEqual(pk.data.exp.map((x) => x.id), [G + ".e1"]);
  assert.deepEqual(pk.data.pay, []);
  assert.deepEqual(pk.data.mine, []);
  assert.deepEqual(Object.keys(pk.data.tombs), ["exp:" + G + ".e1"]);
  assert.equal(({}).polluted, undefined);
  // Names are kept as plain text (the app only ever sets textContent)
  assert.equal(pk.data.groups[0].n, "<img src=x onerror=alert(1)>");
  const mineD = S.mergeSplit(Object.assign(S.emptyData(), { groups: [grp("g2", 1)], people: [per("g2.x", 1, "Kostas")] }), pk.data);
  assert.ok(mineD.groups.some((g) => g.id === "g2"));
  assert.equal(mineD.people.find((p) => p.id === "g2.x").n, "Kostas");
  // Not a group file, or two groups in one
  assert.equal(S.unpackGroup({ app: "oros-split", data: {} }), null);
  assert.equal(S.unpackGroup({ app: "oros-split-group", data: { groups: [grp("a1", 1), grp("a2", 1)] } }), null);
  assert.equal(S.unpackGroup(null), null);
  assert.equal(S.unpackGroup({ app: "oros-split-group", data: { groups: [{ id: G, m: 1, n: "" }] } }), null);
});
