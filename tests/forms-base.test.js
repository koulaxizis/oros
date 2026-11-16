// Forms W4b (FORMS-4b): a form from a Base table and its answers back
// (Bible BASE-1 "Forms contract").
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../forms/engine.js");
const L = require("../forms/links.js");

const FT = { base: "b_1", table: "tLeads", name: "Leads", fields: [
  { id: "fName", name: "Name", type: "text", required: true },
  { id: "fNote", name: "Notes", type: "long" },
  { id: "fMail", name: "E-mail", type: "email" },
  { id: "fWeb", name: "Site", type: "url" },
  { id: "fTel", name: "Phone", type: "phone" },
  { id: "fAge", name: "Age", type: "number" },
  { id: "fPay", name: "Budget", type: "currency" },
  { id: "fPct", name: "Share", type: "percent" },
  { id: "fRate", name: "Rating", type: "rating", opts: { max: 7 } },
  { id: "fDay", name: "Day", type: "date", opts: { time: true } },
  { id: "fOk", name: "Agree", type: "check" },
  { id: "fKind", name: "Kind", type: "select", opts: { ch: [{ id: "c1", n: "Shop" }, { id: "c2", n: "Fair" }] } },
  { id: "fTags", name: "Tags", type: "multi", opts: ["Books", "Music"] },
  { id: "fSum", name: "Total", type: "formula" },
  { id: "fLink", name: "Orders", type: "link" },
  { id: "fAuto", name: "No", type: "auto" },
  { id: "fNew", name: "Future", type: "hologram" },
  { id: "bad id!", name: "Bad", type: "text" },
  { id: "fName", name: "Again", type: "text" },
  { id: "fEmpty", name: "Pick", type: "multi", opts: [] }
] };

function made() { return E.normForm(Object.assign({ id: "frm1" }, L.fromTable(FT))); }

test("fromTable: one question per askable field, unknown types skipped", () => {
  const f = made();
  assert.deepEqual(f.qs.map((q) => q.t), ["text", "para", "email", "text", "phone", "number", "number", "number", "stars", "date", "yesno", "choice", "multi"]);
  assert.deepEqual(f.qs.map((q) => q.label).slice(0, 2), ["Name", "Notes"]);
  assert.equal(f.qs[0].req, 1);
  assert.equal(f.qs[8].hi, 7);
  assert.deepEqual(f.qs[11].opts.map((o) => o.label), ["Shop", "Fair"]);
  assert.deepEqual(f.qs[12].opts.map((o) => o.label), ["Books", "Music"]);
  assert.equal(f.title, "Leads");
  const m = f.set.base.m;
  assert.equal(f.set.base.b, "b_1");
  assert.equal(f.set.base.t, "tLeads");
  assert.deepEqual(f.qs.map((q) => m[q.id]), ["fName", "fNote", "fMail", "fWeb", "fTel", "fAge", "fPay", "fPct", "fRate", "fDay", "fOk", "fKind", "fTags"]);
});

test("fromTable: refuses bad shapes", () => {
  assert.equal(L.fromTable(null), null);
  assert.equal(L.fromTable({ base: "b", table: "a b", fields: [{ id: "f", name: "N", type: "text" }] }), null);
  assert.equal(L.fromTable({ base: "b", table: "t", fields: [{ id: "f", name: "N", type: "formula" }] }), null);
  // a select without choices asks in words
  const s = L.fromTable({ base: "b", table: "t", fields: [{ id: "f", name: "N", type: "select" }] });
  assert.equal(s.qs[0].t, "text");
});

test("engine keeps set.base only valid and only for existing questions", () => {
  const f = made();
  const gone = E.normForm(Object.assign({}, f, { qs: f.qs.slice(1) }));
  assert.equal(gone.set.base.m[f.qs[0].id], undefined);
  assert.equal(Object.keys(gone.set.base.m).length, 12);
  assert.equal(E.normForm(Object.assign({}, f, { set: { base: { b: "x y", t: "t", m: f.set.base.m } } })).set.base, undefined);
  assert.equal(E.normForm(Object.assign({}, f, { set: { base: { b: "b", t: "t", m: {} } } })).set.base, undefined);
  const bad = {}; bad[f.qs[0].id] = "no good";
  assert.equal(E.normForm(Object.assign({}, f, { set: { base: { b: "b", t: "t", m: bad } } })).set.base, undefined);
});

test("toBase: the agreed value shapes, keys and empty answers left out", () => {
  const f = made(), q = f.qs, a = {};
  a[q[0].id] = "Maria"; a[q[1].id] = "line one\nline two"; a[q[2].id] = "m@x.gr"; a[q[3].id] = "https://x.gr";
  a[q[4].id] = "+30 690"; a[q[5].id] = 41; a[q[6].id] = "12.5"; a[q[8].id] = 6; a[q[9].id] = "2026-11-20";
  a[q[10].id] = "no"; a[q[11].id] = q[11].opts[1].id; a[q[12].id] = [q[12].opts[0].id, q[12].opts[1].id];
  a[q[7].id] = ""; // empty: left out
  const tg = L.toBase(f, [{ id: "abcdefghijklmnop.17", a }, { id: "not an id", a }]);
  assert.equal(tg.addRecords.base, "b_1");
  assert.equal(tg.addRecords.table, "tLeads");
  assert.equal(tg.addRecords.from, "forms");
  assert.equal(tg.addRecords.rows.length, 1);
  const r = tg.addRecords.rows[0];
  assert.equal(r.key, "frm:frm1:abcdefghijklmnop.17");
  assert.deepEqual(r.values, {
    fName: "Maria", fNote: "line one\nline two", fMail: "m@x.gr", fWeb: "https://x.gr", fTel: "+30 690",
    fAge: 41, fPay: 12.5, fRate: 6, fDay: "2026-11-20", fOk: false, fKind: "Fair", fTags: ["Books", "Music"]
  });
  const yes = {}; yes[q[10].id] = "yes";
  assert.deepEqual(L.toBase(f, [{ id: "abcdefghijklmnop.1", a: yes }]).addRecords.rows[0].values, { fOk: true });
  // a form not made from Base, or no rows → null
  assert.equal(L.toBase({ id: "x", qs: q }, [{ id: "abcdefghijklmnop.1", a }]), null);
  assert.equal(L.toBase(f, []), null);
});

test("toBase: at most one batch, Other as its text", () => {
  const f = E.normForm({ id: "f2", qs: [{ id: "c", t: "choice", label: "Pick", other: 1, opts: [{ id: "a", label: "A" }] }], set: { base: { b: "b", t: "t", m: { c: "fc" } } } });
  const rows = [];
  for (let i = 0; i < 600; i++) rows.push({ id: "abcdefghijklmnop." + i, a: { c: E.OTHER, "c.o": "Mine" } });
  const tg = L.toBase(f, rows);
  assert.equal(tg.addRecords.rows.length, L.BATCH);
  assert.equal(L.BATCH, 500);
  assert.deepEqual(tg.addRecords.rows[0].values, { fc: "Mine" });
});

test("the published form never carries set.base", () => {
  // share.js runs in the browser only; its defObj copies set and deletes base
  const src = fs.readFileSync(path.join(__dirname, "..", "forms", "share.js"), "utf8");
  assert.match(src, /var set = Object\.assign\(\{\}, f\.set\);\s*delete set\.base;[\s\S]*set: set \}/);
  // quiz.js pub keeps it (the owner's copy), share.js is the one that drops it
  const Q = require("../forms/quiz.js");
  assert.ok(Q.pub(made()).set.base);
});

test("app: Send to Base only for forms made from Base, strings in EN, EL and DE", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "forms", "app.js"), "utf8");
  assert.match(app, /cur\.set && cur\.set\.base\) bar2\.appendChild\(chip\(t\("bs\.send"\)/);
  assert.match(app, /LK\.fromTable\(tg\.fromTable\)/);
  const de = fs.readFileSync(path.join(__dirname, "..", "i18n", "de", "forms.js"), "utf8");
  ["bs.send", "bs.sent", "bs.more", "bs.allSent", "bs.made", "bs.none", "bs.hint"].forEach((k) => {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.indexOf('"' + k + '":') >= 0, k + " in DE");
  });
});
