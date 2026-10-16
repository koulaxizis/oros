// The .orosbudget file (Budget, phase 4b wave 3): every entry,
// category, limit, recurring entry, account, transfer, envelope, goal
// and rule through the shared kit (recordpkg.js) and bundle.js, the
// receipts in media/; opening adds only what is missing, with its ids.
// Bank profiles and tombstones never go in. Plus the app wiring (menu,
// "Open with", help).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "budget/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;

// budget.js's own model and CSV, cut out of the IIFE as tests/budget.test.js does
const src = read("budget/budget.js");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const APP = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { mergeBudget, emptyData, buildCsv };")();

const SHA = "a".repeat(64), SHA2 = "b".repeat(64);
function slice() {
  return {
    ver: 1,
    tx: [
      { id: "t1", m: NOW - 900, d: "2026-10-08", a: 1250, k: "o", c: "o-groc", n: "milk", ac: "acc1",
        rc: "20261008-t1-abcd.jpg 20261008-t1-efgh.pdf" },
      { id: "t2", m: NOW - 800, d: "2026-10-09", a: 300000, k: "i", c: "i-salary", n: "=HYPERLINK(\"x\")", src: "bank", ot: "PAYROLL", fit: "F1" },
      { id: "t3", m: NOW - 700, d: "2026-10-10", a: 999, k: "o", c: "own1", n: "cinema, popcorn", oc: "USD", oa: 1100 }
    ],
    cats: [{ id: "own1", m: NOW - 1000, k: "o", name: "Films", col: 3 }, { id: "o-groc", m: NOW - 1000, k: "o", name: "", col: 5 }],
    bud: [{ id: "o-groc", m: NOW - 990, a: 40000 }, { id: "all", m: NOW - 990, a: 150000 }],
    rec: [{ id: "r1", m: NOW - 980, k: "o", a: 70000, c: "o-home", n: "Rent", f: "m", s: "2026-01-01", e: "", nd: 2 }],
    acc: [{ id: "acc1", m: NOW - 970, n: "Card", o: -5000, col: 1, cur: "EUR" }],
    xfer: [{ id: "x1", m: NOW - 960, d: "2026-10-05", a: 2000, f: "acc1", t: "acc2", n: "" }],
    asg: [{ id: "202610-o-groc", m: NOW - 950, a: 40000, c: "o-groc", mk: "2026-10" }],
    goal: [{ id: "g1", m: NOW - 940, ac: "", col: 2, d: "2027-06-01", n: "Holiday", sv: 10000, t: 100000 }],
    prof: [{ id: "p1", m: NOW - 930, n: "My bank", sig: "camt:GR1601101250000000012300695", ac: "acc1" }],
    rule: [{ id: "u1", m: NOW - 920, c: "o-groc", hi: 0, k: "o", lo: 0, nt: "", py: "Lidl", q: "lidl" }],
    set: { m: NOW - 2000, cur: "EUR", env: true, envs: "2026-10" },
    tombs: { "tx:gone": NOW - 100, "cat:o-fun": NOW - 100 }
  };
}
function device() {
  // another device: its own entry, a category, and a deleted entry the file has
  return Object.assign(APP.emptyData(), {
    tx: [{ id: "mine", m: NOW - 50, d: "2026-10-01", a: 500, k: "o", c: "", n: "coffee" },
         { id: "t3", m: NOW - 10, d: "2026-10-10", a: 1000, k: "o", c: "", n: "my copy" }],
    set: { m: NOW - 5, cur: "EUR" },
    tombs: { "tx:t2": NOW - 20 }
  });
}

test("budget: round trip through bundle.js; no tombstones, no bank profiles; receipts as media", async () => {
  const st = slice();
  st.rcs = { "20261008-t1-abcd.jpg": SHA + ".jpg", "20261008-t1-efgh.pdf": SHA2 + ".pdf", "20261008-zz-abcd.jpg": SHA + ".jpg" };
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const pdf = new Uint8Array(Buffer.from("%PDF-1.4 x"));
  const o = K.pack(D, st, { title: "Budget", lang: "en", now: NOW,
    files: [{ key: SHA + ".jpg", bytes: jpg }, { key: SHA2 + ".pdf", bytes: pdf }] });
  assert.equal(o.mime, "application/x-oros-budget");
  assert.equal(o.generator, "orOS Budget");
  const data = o.content.data;
  assert.deepEqual(Object.keys(data).sort(), ["acc", "asg", "bud", "cats", "goal", "rcs", "rec", "rule", "set", "tx", "ver", "xfer"]);
  assert.equal(data.prof, undefined);
  assert.equal(data.tombs, undefined);
  assert.ok(!JSON.stringify(o.content).includes("GR16"));               // no IBAN of a bank profile
  assert.deepEqual(data.rcs, { "20261008-t1-abcd.jpg": SHA + ".jpg", "20261008-t1-efgh.pdf": SHA2 + ".pdf" });
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-budget");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-budget-package");
  // media are re-keyed by their real hash; content.json follows
  const kj = Object.keys(r.media).find((k) => /\.jpg$/.test(k)), kp = Object.keys(r.media).find((k) => /\.pdf$/.test(k));
  assert.equal(r.content.data.rcs["20261008-t1-abcd.jpg"], kj);
  assert.equal(r.content.data.rcs["20261008-t1-efgh.pdf"], kp);
  assert.equal(r.media[kp].type, "application/pdf");
  // the preview is the app's CSV export
  const csv = o.preview.find((p) => p.name === "entries.csv").data;
  assert.equal(csv.split("\r\n")[0], "﻿Date,Type,Category,Amount,Currency,Note,Account");
  assert.equal(csv.split("\r\n")[1], "2026-10-08,Expense,Groceries,-12.50,EUR,milk,Card");
  assert.equal(csv.split("\r\n")[2], "2026-10-09,Income,Salary,3000.00,EUR,\"'=HYPERLINK(\"\"x\"\")\",");
  assert.equal(csv.split("\r\n")[3], "2026-10-10,Expense,Films,-9.99,EUR,\"cinema, popcorn\",");

  // into a device with other data
  const mine = device();
  const res = K.open(D, mine, r.content, { now: NOW });
  // t1 added, t2 deleted here, t3 already here; every other record added
  assert.deepEqual(res.report, { added: 11, skipped: 2, updated: 0 });
  assert.ok(res.addedIds.includes("t1") && !res.addedIds.includes("t2") && !res.addedIds.includes("t3"));
  const next = APP.mergeBudget(res.next, res.next);          // what budget.js's set hook does
  assert.deepEqual(next.tx.map((x) => x.id), ["mine", "t1", "t3"]);
  assert.equal(next.tx.find((x) => x.id === "t3").n, "my copy");        // a clash keeps the local record
  assert.deepEqual(next.tx.find((x) => x.id === "t1"), slice().tx[0]);
  assert.deepEqual(next.set, mine.set);                                   // settings stay
  assert.deepEqual(next.tombs, mine.tombs);
  assert.deepEqual(next.prof, []);
  assert.equal(next.rule[0].q, "lidl");
  assert.deepEqual(next.cats.map((c) => c.id), ["o-groc", "own1"]);
  // and again: nothing
  const again = K.open(D, next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(APP.mergeBudget(again.next, again.next), next);
});

test("budget: update takes the newer copy, a deleted one stays deleted, stamps are clamped", () => {
  const theirs = slice();
  theirs.tx[2].n = "changed later"; theirs.tx[2].m = NOW + 365 * 864e5;   // from the future
  const c = K.pack(D, theirs, { now: NOW }).content;
  const mine = device();
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["t3"]);
  const t3 = upd.next.tx.find((x) => x.id === "t3");
  assert.equal(t3.n, "changed later");
  assert.equal(t3.m, NOW + K.FUTURE);
  assert.ok(!upd.next.tx.some((x) => x.id === "t2"));
  assert.deepEqual(P.collOf("o-groc", upd.next), ["cats", "bud"]);          // a limit has its category's id
  assert.deepEqual(P.collOf("t1", upd.next), ["tx"]);
  assert.deepEqual(D.tombIds(mine).sort(), ["t2"]);
});

test("budget: hostile content is cut down to the slice's shape", () => {
  const n = D.norm({
    tx: [{ id: "ok", m: 1, d: "2026-02-30", a: 5, k: "o" },                     // no such day
         { id: "ok2", m: 1, d: "2026-02-28", a: -5, k: "o" },                   // negative
         { id: "OK", m: 1, d: "2026-02-28", a: 5, k: "o" },                     // id case
         { id: "t9", m: 1, d: "2026-02-28", a: 5, k: "o", c: "../x", n: "a\u0000b", onclick: { x: 1 }, big: "x".repeat(600),
           rc: "20260228-t9-abcd.jpg 20260228-other-abcd.jpg ../../etc.jpg", __proto__x: 1 },
         { id: "t9", m: 2, d: "2026-02-28", a: 7, k: "o" }],                    // duplicate id
    cats: [{ id: "o-groc", m: 1, k: "i", name: "x" }, { id: "own", m: 1, k: "o", name: "" }, { id: "c2", m: 1, k: "o", name: "Pets", col: 99 }],
    rec: [{ id: "has-dash", m: 1, k: "o", a: 5, f: "m", s: "2026-01-01" }, { id: "r", m: 1, k: "o", a: 5, f: "d", s: "2026-01-01" }],
    asg: [{ id: "202610-x", m: 1, a: 5, c: "y", mk: "2026-10" }],
    rule: [{ id: "u", m: 1, k: "o", c: "o-groc", q: "" }],
    prof: [{ id: "p", m: 1, n: "bank", sig: "IBAN" }],
    rcs: { "20260228-t9-abcd.jpg": "c".repeat(64) + ".pdf", "nope.jpg": "d".repeat(64) + ".jpg" },
    set: { m: 1, cur: "XXX" }, tombs: { "tx:a": 1 }, evil: "<script>"
  });
  assert.deepEqual(n.tx, [{ id: "t9", m: 1, d: "2026-02-28", a: 5, k: "o", c: "", n: "a b", rc: "20260228-t9-abcd.jpg" }]);
  assert.deepEqual(n.cats, [{ id: "c2", m: 1, k: "o", name: "Pets", col: 8 }]);
  assert.deepEqual(n.rec, []);
  assert.deepEqual(n.asg, []);
  assert.deepEqual(n.rule, []);
  assert.equal(n.prof, undefined);
  assert.equal(n.evil, undefined);
  assert.equal(n.rcs, undefined);                         // a .jpg name never takes a .pdf key
  assert.deepEqual(n.set, { m: 1, cur: "EUR" });
  assert.equal(D.strip(n).tombs, undefined);
  assert.equal(D.norm("x"), null);
  assert.throws(() => K.open(D, device(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  // a file can never make an entry point at another entry's receipt
  assert.deepEqual(P.rcOf("20260228-t1-abcd.jpg 20260228-t10-abcd.jpg", "t1"), ["20260228-t1-abcd.jpg"]);
});

test("budget: the records the normaliser keeps are the ones budget.js's merge keeps", () => {
  const s = slice();
  const app = APP.mergeBudget(s, s), mine = D.norm(s);
  ["tx", "cats", "bud", "rec", "acc", "xfer", "asg", "goal", "rule", "set"].forEach((k) => {
    const sort = (l) => Array.isArray(l) ? l.slice().sort((a, b) => (a.id < b.id ? -1 : 1)) : l;
    assert.deepEqual(sort(mine[k]), sort(app[k]), k);
  });
});

test("budget: the preview CSV is budget.js's buildCsv (Greek: the Excel layout)", () => {
  const rows = [{ d: "2026-10-08", k: "o", cat: "Σούπερ μάρκετ", a: 1250, n: "-x; y", acc: "" }];
  const head = ["Ημερομηνία", "Τύπος", "Κατηγορία", "Ποσό", "Νόμισμα", "Σημείωση"];
  const kn = (k) => (k === "i" ? "Έσοδο" : "Έξοδο");
  for (const fmt of ["excel", "std"]) assert.equal(P.buildCsv(rows, fmt, "EUR", head, kn), APP.buildCsv(rows, fmt, "EUR", head, kn));
  const el = D.previews(D.strip(slice()), "el")["entries.csv"];
  assert.equal(el.split("\r\n")[1], "2026-10-08;Έξοδο;Σούπερ μάρκετ;-12,50;EUR;milk;Card");
  let seen = 0;
  P.useCsv(function () { seen++; return "x"; });
  assert.equal(D.previews(D.strip(slice()), "en")["entries.csv"], "x");
  P.useCsv(null);
  assert.equal(seen, 1);
  assert.deepEqual(D.previews({ tx: [] }, "en"), {});
});

test("budget: wiring (scripts, menu, Open with, receipts, help, file types)", () => {
  const html = read("budget/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "budget.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf("package.js") < html.indexOf('src="budget.js'));
  ["osave", "oopen", "ofolder"].forEach((k) => assert.ok(html.includes('data-act="' + k + '"'), k));
  const js = read("budget/budget.js");
  assert.match(js, /RP\.ui\(BPK\.DESC,/);
  assert.match(js, /BPK\.useCsv\(buildCsv\)/);
  assert.match(js, /if \(x\.openFile\) \{ if \(recFile\) recFile\.openTarget\(x\.openFile\); return; \}/);
  assert.match(js, /window\.__orosOpenAt = openTarget;/);
  assert.match(js, /__orosTakeTarget\("budget"\)/);
  assert.match(js, /encodeReceipt\(blob\)/);                  // receipts from a file: the attach checks
  assert.match(js, /tombstone\(TOMB_OF\[c\], id\)/);          // Undo through tombstones
  ["\"menu.osave\": \"orOS file (.orosbudget)\"", "\"menu.osave\": \"Αρχείο orOS (.orosbudget)\"",
   "\"menu.oopen\": \"Open orOS file…\"", "\"menu.oopen\": \"Άνοιγμα αρχείου orOS…\"",
   "\"menu.ofolder\": \"Unzipped orOS folder…\"", "\"menu.ofolder\": \"Αποσυμπιεσμένος φάκελος orOS…\""].forEach((s) => assert.ok(js.includes(s), s));
  const en = read("budget/help.en.txt"), el = read("budget/help.el.txt");
  for (const h of [en, el]) assert.ok(h.includes(".orosbudget"));
  assert.deepEqual(en.match(/^## /gm).length, el.match(/^## /gm).length);
  assert.deepEqual(F.appsFor(".orosbudget"), ["budget"]);
  assert.deepEqual(B.TYPES[".orosbudget"], { app: "budget", mime: "application/x-oros-budget" });
});
