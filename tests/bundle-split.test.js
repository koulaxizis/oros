// The .orossplit file (Split, a record app): groups with their people,
// expenses, payments, repeating expenses and receipt photos through the
// shared kit (recordpkg.js) and bundle.js; opening adds only what is
// missing, with its ids, and "Update with newer versions" takes a
// friend's newer copies. The descriptor's record checks and CSV are
// compared with the app's own (split.js sections 2–5, cut out as
// tests/split.test.js does). Plus the app wiring (Save, Open, unzipped
// folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "split/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));

// split.js sections 1–5 (no DOM)
const src = read("split/split.js");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const S = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { mergeSplit, emptyData, buildCsv, csvCell, normExp, normRec, packGroup };")();

const G = "g1", H = "g2";
const A = G + ".a", Bb = G + ".b", C = G + ".c";
const PH = "20261008-g1-e1-abcd1234.jpg";
const KEY = "a".repeat(64) + ".jpg";
function slice() {
  return S.mergeSplit({
    ver: 1,
    groups: [{ id: G, m: NOW - 900, n: "Naxos", col: 2, cur: "EUR", arch: 0 },
             { id: H, m: NOW - 800, n: "Flat", col: 1, cur: "EUR", arch: 0 }],
    people: [{ id: A, m: NOW - 900, n: "Anna" }, { id: Bb, m: NOW - 900, n: "=Nikos" }, { id: C, m: NOW - 900, n: "Maria" },
             { id: H + ".x", m: NOW - 800, n: "Xenia" }, { id: H + ".y", m: NOW - 800, n: "Yannis" }],
    exp: [
      { id: G + ".e1", m: NOW - 700, t: "Dinner", a: 1000, d: "2026-10-08", c: "food", by: { [A]: 1000 }, mode: "eq",
        w: { [A]: 1, [Bb]: 1, [C]: 1 }, n: "taverna", ph: PH },
      { id: G + ".e2", m: NOW - 600, t: "=SUM(A1)", a: 5000, d: "2026-10-09", c: "stay", by: { [A]: 2000, [Bb]: 3000 }, mode: "ex",
        w: { [A]: 2500, [Bb]: 2500 }, n: "" },
      { id: H + ".r1", m: NOW - 500, t: "Rent", a: 60000, d: "2026-10-01", c: "bills", by: { [H + ".x"]: 60000 }, mode: "eq",
        w: { [H + ".x"]: 1, [H + ".y"]: 1 }, n: "", r: H + ".rule" }
    ],
    pay: [{ id: G + ".p1", m: NOW - 400, f: Bb, to: A, a: 333, d: "2026-10-10" }],
    rec: [{ id: H + ".rule", m: NOW - 500, t: "Rent", a: 60000, d: "2026-10-01", c: "bills", by: { [H + ".x"]: 60000 },
            mode: "eq", w: { [H + ".x"]: 1, [H + ".y"]: 1 }, n: "", f: "m" }],
    mine: [{ id: G, m: NOW - 900, v: A }],
    tombs: { "exp:g1.gone": NOW - 100, "grp:g9": NOW - 50 }
  }, null);
}
const ids = (list) => list.map((x) => x.id).sort();

test("split: round trip through bundle.js; the file has no tombs, no `mine`", async () => {
  const st = slice();
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  const KEY = (await B.sha256(jpg)) + ".jpg";
  st.receipts = { [PH]: KEY, "20261008-g1-e9-zzzz9999.jpg": KEY, "bad.jpg": KEY };
  const o = K.pack(D, st, { title: "Split", lang: "en", now: NOW, files: [{ key: KEY, bytes: jpg }] });
  assert.equal(o.mime, "application/x-oros-split");
  assert.equal(o.generator, "orOS Split");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["exp", "groups", "pay", "people", "rec", "receipts", "ver"]);
  assert.deepEqual(o.content.data.receipts, { [PH]: KEY });           // only receipts an expense points at
  assert.deepEqual(o.preview.map((p) => p.name).sort(), ["01-flat.csv", "02-naxos.csv"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-split");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-split-package");
  assert.equal(r.content.data.tombs, undefined);
  assert.equal(r.content.data.mine, undefined);
  assert.deepEqual(r.content.data.exp, st.exp);
  assert.ok(r.media[KEY] && r.media[KEY].bytes.length === 6);
  // into a device with other data
  const other = S.mergeSplit({ groups: [{ id: "g3", m: 5, n: "Mine", col: 0, cur: "EUR", arch: 0 }],
    people: [{ id: "g3.me", m: 5, n: "Me" }], exp: [], pay: [], mine: [{ id: "g3", m: 5, v: "g3.me" }], tombs: {} }, null);
  const d = P.forLocal(() => other);
  const res = K.open(d, other, r.content, { now: NOW });
  assert.equal(res.report.added, 2 + 5 + 3 + 1 + 1);
  assert.equal(res.report.skipped, 0);
  const next = S.mergeSplit(res.next, res.next);
  assert.deepEqual(ids(next.groups), ["g1", "g2", "g3"]);
  assert.equal(next.exp.length, 3);
  assert.deepEqual(next.mine, other.mine);                            // who I am here stays mine
  assert.equal(next.receipts, undefined);
  assert.deepEqual(next.tombs, {});
  // every record the kit counted survives the app's own merge
  ["groups", "people", "exp", "pay", "rec"].forEach((k) => assert.deepEqual(ids(next[k]), ids(res.next[k]), k));
  // reopening the same file adds nothing
  const again = K.open(d, next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.updated, 0);
  assert.equal(again.report.skipped, 12);
});

test("split: a clash keeps the local record; update takes a friend's newer copy, never a deleted one", () => {
  const mine = slice();
  const theirs = slice();
  // the friend renamed the group, edited an expense and added one; an
  // older copy of a payment
  theirs.groups[0].n = "Naxos 2026"; theirs.groups[0].m = NOW - 10;
  const e1 = theirs.exp.find((x) => x.id === G + ".e1");
  e1.t = "Dinner at Maria's"; e1.m = NOW - 5;
  theirs.exp.push({ id: G + ".e3", m: NOW - 4, t: "Ferry", a: 900, d: "2026-10-11", c: "trans", by: { [C]: 900 }, mode: "eq",
                    w: { [A]: 1, [C]: 1 }, n: "" });
  theirs.pay[0].a = 999; theirs.pay[0].m = NOW - 1000;
  // here: expense e2 was deleted
  mine.exp = mine.exp.filter((x) => x.id !== G + ".e2");
  mine.tombs["exp:" + G + ".e2"] = NOW - 300;
  const file = K.pack(D, S.mergeSplit(theirs, null), { now: NOW }).content;
  const d = P.forLocal(() => mine);
  const add = K.open(d, mine, file, { now: NOW });
  assert.deepEqual(add.addedIds, [G + ".e3"]);
  assert.equal(add.report.updated, 0);
  const n1 = S.mergeSplit(add.next, add.next);
  assert.equal(n1.groups.find((g) => g.id === G).n, "Naxos");          // clash: local kept
  assert.equal(n1.exp.find((x) => x.id === G + ".e1").t, "Dinner");
  assert.ok(!n1.exp.find((x) => x.id === G + ".e2"));                  // deleted here: stays deleted
  const upd = K.open(d, mine, file, { now: NOW, update: true });
  assert.deepEqual(upd.updatedIds.sort(), [G, G + ".e1"].sort());
  const n2 = S.mergeSplit(upd.next, upd.next);
  assert.equal(n2.groups.find((g) => g.id === G).n, "Naxos 2026");
  assert.equal(n2.exp.find((x) => x.id === G + ".e1").t, "Dinner at Maria's");
  assert.equal(n2.pay[0].a, 333);                                      // the file's copy is older
  assert.ok(!n2.exp.find((x) => x.id === G + ".e2"));
  // a record brought back by a newer edit (tomb older than it) can still be updated
  const back = slice();
  back.tombs["exp:" + G + ".e1"] = NOW - 800;
  assert.ok(!P.DESC.tombIds(back).includes(G + ".e1"));
  const upd2 = K.open(P.forLocal(() => back), back, file, { now: NOW, update: true });
  assert.ok(upd2.updatedIds.includes(G + ".e1"));
});

test("split: a group deleted here stays deleted, its people and expenses do not come back", () => {
  const mine = slice();
  mine.groups = mine.groups.filter((g) => g.id !== H);
  mine.tombs["grp:" + H] = NOW - 200;
  const here = S.mergeSplit(mine, mine);
  assert.ok(!here.people.some((p) => p.id.startsWith(H + ".")));
  const file = K.pack(D, slice(), { now: NOW }).content;
  const d = P.forLocal(() => here);
  const res = K.open(d, here, file, { now: NOW, update: true });
  assert.equal(res.report.added, 0);
  assert.equal(res.report.updated, 0);
  const next = S.mergeSplit(res.next, res.next);
  assert.deepEqual(next, here);
  // the plain DESC (no local view) would count them: forLocal matters
  assert.ok(K.open(D, here, file, { now: NOW }).report.added > 0);
});

test("split: tombs in the file are ignored, stamps clamped, children only of the file's groups", () => {
  const f = slice();
  f.tombs = { ["exp:" + G + ".e9"]: NOW - 9999 };
  f.exp.push({ id: "g7.e1", m: 1, t: "orphan", a: 100, d: "2026-01-01", c: "food", by: { "g7.a": 100 }, mode: "eq", w: { "g7.a": 1 }, n: "" });
  f.groups[0].m = NOW + 1e9;
  const res = K.open(D, S.emptyData(), { kind: "oros-split-package", ver: 1, data: f }, { now: NOW });
  assert.equal(res.next.groups.find((g) => g.id === G).m, NOW + K.FUTURE);
  assert.ok(!res.next.exp.find((x) => x.id === "g7.e1"));
  assert.deepEqual(res.next.tombs, {});
  // a file's tombs never hide or delete anything
  const f2 = slice();
  f2.tombs = { ["grp:" + G]: NOW, ["exp:" + G + ".e1"]: NOW };
  assert.ok(D.norm(f2).exp.find((x) => x.id === G + ".e1"));
  assert.ok(D.norm(f2).groups.find((x) => x.id === G));
});

test("split: the normaliser cuts hostile content down, the same as the app's", () => {
  const huge = "x".repeat(5000);
  const raw = {
    groups: [{ id: G, m: 1, n: huge + "\u0000<script>", col: 99, cur: "XXX", arch: "yes", evil: 1 },
             { id: "BAD ID", m: 1, n: "x" }, { id: "g5", m: -1, n: "neg" }, { id: "g6", m: 1, n: "   " },
             { id: "__proto__", m: 1, n: "p" }],
    people: [{ id: A, m: 1, n: "Anna\nB" }, { id: "g1.zz", m: 1, n: "" }],
    exp: [
      { id: G + ".ok", m: 1, t: huge, a: 300, d: "2026-02-28", c: "nope", by: { [A]: 300 }, mode: "eq", w: { [A]: 1, [Bb]: 1 }, n: huge,
        ph: "../../etc/passwd", r: G + ".ok", fx: { c: "USD", a: 1, r: 1 } },
      { id: G + ".fx", m: 1, t: "fx", a: 925, d: "2026-02-01", c: "food", by: { [A]: 925 }, mode: "eq", w: { [A]: 1 }, n: "",
        fx: { c: "USD", a: 1000, r: 0.925, s: "ecb", d: "2026-01-31" } },
      { id: G + ".it", m: 1, t: "it", a: 1200, d: "2026-02-01", c: "food", by: { [A]: 1200 }, mode: "ex", w: { [A]: 720, [Bb]: 480 }, n: "",
        it: { l: [{ n: "a", a: 600, p: [A] }, { n: "b", a: 400, p: [Bb] }], x: 200, tp: 0 } },
      { id: G + ".bad1", m: 1, t: "", a: 300, d: "2026-02-30", c: "food", by: { [A]: 300 }, mode: "eq", w: { [A]: 1 }, n: "" },
      { id: G + ".bad2", m: 1, t: "", a: 300, d: "2026-02-01", c: "food", by: { [A]: 200 }, mode: "eq", w: { [A]: 1 }, n: "" },
      { id: G + ".bad3", m: 1, t: "", a: 300, d: "2026-02-01", c: "food", by: { "g9.a": 300 }, mode: "eq", w: { [A]: 1 }, n: "" },
      { id: G + ".bad4", m: 1, t: "", a: 1e15, d: "2026-02-01", c: "food", by: { [A]: 1e15 }, mode: "eq", w: { [A]: 1 }, n: "" },
      { id: G + ".bad5", m: 1, t: "", a: 300, d: "2026-02-01", c: "food", by: { [A]: 300 }, mode: "pc", w: { [A]: 5000 }, n: "" },
      "junk", null, [1, 2]
    ],
    pay: [{ id: G + ".p", m: 1, f: A, to: A, a: 5, d: "2026-01-01" }, { id: G + ".q", m: 1, f: A, to: Bb, a: 5, d: "2026-01-01" }],
    rec: [{ id: G + ".rr", m: 1, t: "r", a: 100, d: "2026-01-31", c: "food", by: { [A]: 100 }, mode: "eq", w: { [A]: 1 }, n: "",
            f: "m", u: "2025-01-01", ph: "20260131-g1-rr-abcd.jpg" },
          { id: G + ".rx", m: 1, t: "r", a: 100, d: "2026-01-31", c: "food", by: { [A]: 100 }, mode: "eq", w: { [A]: 1 }, n: "", f: "d" }],
    mine: [{ id: G, m: 1, v: A }],
    receipts: { "x.jpg": KEY, [PH]: "not-a-key", __proto__: KEY },
    settings: { token: "secret" }
  };
  const ours = D.norm(clone(raw));
  const app = S.mergeSplit(clone(raw), null);
  const byId = (l) => (l || []).slice().sort((x, y) => (x.id < y.id ? -1 : 1));
  ["groups", "people", "exp", "pay", "rec"].forEach((k) => assert.deepEqual(byId(ours[k]), byId(app[k]), k));
  assert.equal(ours.groups[0].n.length, 40);
  assert.equal(ours.exp.find((x) => x.id === G + ".ok").ph, undefined);
  assert.ok(ours.exp.find((x) => x.id === G + ".fx").fx);
  assert.ok(ours.exp.find((x) => x.id === G + ".it").it);
  assert.equal(ours.receipts, undefined);
  assert.equal(ours.mine, undefined);
  assert.equal(ours.settings, undefined);
  assert.equal(D.norm("x"), null);
  // children of a group the file does not have, a second copy of an id
  const odd = D.norm({ groups: [{ id: G, m: 1, n: "G" }], people: [{ id: A, m: 1, n: "first" }, { id: A, m: 2, n: "dup" },
                                                                     { id: "g9.a", m: 1, n: "other group" }] });
  assert.deepEqual(odd.people, [{ id: A, m: 1, n: "first" }]);
  assert.throws(() => K.open(D, null, { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  // the app's limits per group
  const many = { groups: [{ id: G, m: 1, n: "G" }], people: [], exp: [] };
  for (let i = 0; i < 40; i++) many.people.push({ id: G + ".p" + i, m: 1, n: "P" + i });
  for (let i = 0; i < 3100; i++) many.exp.push({ id: G + ".e" + i, m: 1, t: "", a: 1, d: "2026-01-01", c: "food", by: { [G + ".p0"]: 1 }, mode: "eq", w: { [G + ".p0"]: 1 }, n: "" });
  const capped = D.norm(many);
  assert.equal(capped.people.length, P.LIM.people);
  assert.equal(capped.exp.length, P.LIM.entries);
});

test("split: previews: one CSV per group, the app's buildCsv with its formula guard", () => {
  const st = slice();
  const en = D.previews(st, "en"), el = D.previews(st, "el");
  const csv = en["02-naxos.csv"];
  assert.ok(csv.startsWith("﻿Date,Type,What for,Category,Amount,Currency,Paid by,Share: =Nikos,Share: Anna,Share: Maria,Note,"));
  const lines = csv.split("\r\n");
  assert.equal(lines[1], "2026-10-08,Expense,Dinner,Food & drinks,10.00,EUR,Anna,3.33,3.34,3.33,taverna,,,");
  assert.equal(lines[2], "2026-10-09,Expense,'=SUM(A1),Accommodation,50.00,EUR,\"Anna 20, =Nikos 30\",25.00,25.00,,,,,");
  assert.equal(lines[3], "2026-10-10,Payment,'=Nikos → Anna,,3.33,EUR,'=Nikos,,,,,,,");
  // the same bytes as split.js buildCsv for the same rows
  const head = ["a", "=b"], rows = [["x;y", 1250, "-1"], ["\"q\"", 5, ""]];
  ["std", "excel"].forEach((f) => assert.equal(P.buildCsv(head, rows, f), S.buildCsv(head, rows, f), f));
  // Greek: Greek Excel's format, Greek headings
  assert.ok(el["02-naxos.csv"].startsWith("﻿Ημερομηνία;Τύπος;Για τι;"));
  assert.ok(el["02-naxos.csv"].includes(";10,00;EUR;"));
});

test("split: a group's file holds only that group", () => {
  const one = P.groupSlice(slice(), H);
  assert.deepEqual(ids(one.groups), [H]);
  assert.ok(one.people.every((p) => p.id.startsWith(H + ".")));
  assert.ok(one.exp.every((p) => p.id.startsWith(H + ".")));
  assert.equal(one.rec.length, 1);
  assert.equal(one.mine, undefined);
  const o = K.pack(D, one, { now: NOW });
  assert.deepEqual(o.preview.map((p) => p.name), ["01-flat.csv"]);
  assert.equal(o.content.data.exp.length, 1);
  assert.equal(P.kindOf(H, slice()), "group");
  assert.equal(P.kindOf(H + ".rule", slice()), "rec");
  assert.equal(P.kindOf(G + ".p1", slice()), "pay");
  assert.equal(P.kindOf("nope", slice()), "");
});

test("split: wiring (scripts, menu, Open with, Undo, receipts, help, file types)", () => {
  const html = read("split/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "split.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf("package.js?") && html.indexOf("package.js?") < html.indexOf('src="split.js'));
  const js = read("split/split.js");
  assert.match(js, /RP\.ui\(SPK\.forLocal\(recAll\), recHooks\(recAll\)\)/);
  assert.match(js, /if \(tg && tg\.openFile\) \{ if \(recFile\) recFile\.openTarget\(tg\.openFile\); return; \}/);
  assert.match(js, /window\.__orosOpenAt = openSearchTarget;/);
  assert.match(js, /__orosTakeTarget\("split"\)/);
  assert.match(js, /deleteIds: function/);
  assert.match(js, /tombstone\(c\[1\], id\)/);                 // Undo through the app's own tombstones
  assert.match(js, /encodePhoto\(item\.blob/);                 // a receipt is re-drawn like a picked one
  ["menu.osave", "menu.osaveG", "menu.oopen", "menu.ofolder"].forEach((k) =>
    assert.equal(js.split('"' + k + '":').length, 3, k));       // EN and EL
  for (const f of ["split/help.en.txt", "split/help.el.txt"]) assert.ok(read(f).includes(".orossplit"), f);
  assert.deepEqual(F.appsFor(".orossplit"), ["split"]);
  assert.deepEqual(B.TYPES[".orossplit"], { app: "split", mime: "application/x-oros-split" });
});
