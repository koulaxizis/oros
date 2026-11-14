// Forms W3 (FORMS-3): results summary, filter, export table and CSV.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const RS = require("../forms/results.js");

const W = { yes: "Yes", no: "No", other: (x) => "Other: " + x, otherName: "Other", time: "Time", wait: "Waiting list" };

const FORM = {
  id: "f1", title: "Survey",
  qs: [
    { id: "name", t: "text", label: "Name" },
    { id: "how", t: "choice", label: "How?", opts: [{ id: "a", label: "Pick-up" }, { id: "b", label: "Delivery" }], other: 1 },
    { id: "pets", t: "multi", label: "Pets", opts: [{ id: "c", label: "Cat" }, { id: "d", label: "Dog" }] },
    { id: "ok", t: "yesno", label: "Coming?" },
    { id: "sc", t: "scale", label: "Score", lo: 1, hi: 5 },
    { id: "num", t: "number", label: "Count" },
    { id: "g", t: "matrix", label: "Grid", rows: [{ id: "r1", label: "Food" }, { id: "r2", label: "Music" }],
      opts: [{ id: "x", label: "Good" }, { id: "y", label: "Bad" }] },
    { id: "info", t: "info", label: "Thanks" }
  ]
};
const ROWS = [
  { id: "k.1", at: 1000, a: { name: "=SUM(A1)", how: "a", pets: ["c", "d"], ok: "yes", sc: 5, num: 3, g: { r1: "x", r2: "y" } } },
  { id: "k.2", at: 2000, a: { name: "Bo; \"B\"", how: "_o", "how.o": "Drone", pets: ["c"], ok: "no", sc: 3, num: 4 } },
  { id: "k.3", at: 3000, a: { how: "b", ok: "yes", num: 3 }, w: 1 },
  { id: "k.4", at: 4000, a: {} }
];

test("summary: one item per asked question, counts and shares", () => {
  const s = RS.summary(FORM, ROWS, W);
  assert.deepEqual(s.map((x) => x.q), ["name", "how", "pets", "ok", "sc", "num", "g"]);   // no info block
  const by = Object.fromEntries(s.map((x) => [x.q, x]));
  assert.equal(by.how.kind, "bars");
  assert.equal(by.how.n, 3);
  assert.equal(by.how.of, 4);
  assert.deepEqual(by.how.bars.map((b) => [b.label, b.n]), [["Pick-up", 1], ["Delivery", 1], ["Other", 1]]);
  assert.equal(by.how.bars[0].pct, 33.3);
  // checkboxes: shares of the people who answered, may pass 100 in sum
  assert.deepEqual(by.pets.bars.map((b) => [b.n, b.pct]), [[2, 100], [1, 50]]);
  assert.deepEqual(by.ok.bars.map((b) => [b.label, b.n]), [["Yes", 2], ["No", 1]]);
  assert.equal(by.sc.bars.length, 5);
  assert.equal(by.sc.avg, 4);
  assert.equal(by.num.kind, "hist");
  assert.deepEqual([by.num.min, by.num.max, by.num.avg], [3, 4, 3.33]);
  assert.deepEqual(by.num.bars.map((b) => [b.label, b.n]), [["3", 2], ["4", 1]]);
  assert.equal(by.name.kind, "list");
  assert.deepEqual(by.name.texts.map((x) => x.text), ["Bo; \"B\"", "=SUM(A1)"]);   // newest first
  assert.equal(by.g.kind, "grid");
  assert.deepEqual(by.g.cols, ["Good", "Bad"]);
  assert.deepEqual(by.g.rows.map((r) => r.counts), [[1, 0], [0, 1]]);
  assert.equal(by.g.n, 1);
});

test("summary: wide numbers go in ranges, long text lists are cut, empty input is safe", () => {
  const f = { id: "f", qs: [{ id: "n", t: "number", label: "N" }, { id: "t", t: "para", label: "T" }] };
  const rows = [];
  for (let i = 0; i < 120; i++) rows.push({ id: "k." + i, at: i, a: { n: i * 10, t: "x" + i } });
  const [n, t] = RS.summary(f, rows, W);
  assert.equal(n.bars.length, RS.BINS);
  assert.equal(n.bars.reduce((s, b) => s + b.n, 0), 120);
  assert.equal(n.bars[0].label, "0–149");
  assert.equal(t.texts.length, RS.LIST_MAX);
  assert.equal(t.more, 120 - RS.LIST_MAX);
  assert.equal(t.texts[0].text, "x119");
  assert.deepEqual(RS.summary(f, null, W).map((x) => x.n), [0, 0]);
  // answers that no longer fit the question (a removed option) do not count
  const s = RS.summary(FORM, [{ id: "k.9", at: 1, a: { how: "zz", sc: 9 } }], W);
  assert.equal(s.find((x) => x.q === "how").n, 0);
  assert.equal(s.find((x) => x.q === "sc").n, 0);
});

test("filter: by a choice, a checkbox, yes/no or a scale value; unknown filters keep all", () => {
  const ids = (r) => r.map((x) => x.id);
  assert.deepEqual(ids(RS.filter(FORM, ROWS, { q: "ok", v: "yes" })), ["k.1", "k.3"]);
  assert.deepEqual(ids(RS.filter(FORM, ROWS, { q: "pets", v: "d" })), ["k.1"]);
  assert.deepEqual(ids(RS.filter(FORM, ROWS, { q: "how", v: "_o" })), ["k.2"]);
  assert.deepEqual(ids(RS.filter(FORM, ROWS, { q: "sc", v: "3" })), ["k.2"]);
  assert.equal(RS.filter(FORM, ROWS, { q: "name", v: "x" }), ROWS);    // text: not filterable
  assert.equal(RS.filter(FORM, ROWS, null), ROWS);
  assert.deepEqual(RS.filterable(FORM, W).map((f) => f.q), ["how", "pets", "ok", "sc"]);
});

test("table and CSV: oldest first, one column per question and grid row, formula guard", () => {
  const tb = RS.table(FORM, ROWS, W);
  assert.deepEqual(tb[0], ["Time", "Waiting list", "Name", "How?", "Pets", "Coming?", "Score", "Count", "Grid – Food", "Grid – Music"]);
  assert.equal(tb.length, 5);
  assert.match(tb[1][0], /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.deepEqual(tb[1].slice(1), ["", "=SUM(A1)", "Pick-up", "Cat, Dog", "Yes", 5, 3, "Good", "Bad"]);
  assert.deepEqual(tb[2].slice(3, 4), ["Other: Drone"]);
  assert.equal(tb[3][1], "Yes");                     // on the waiting list
  assert.deepEqual(tb[4].slice(2), ["", "", "", "", "", "", "", ""]);
  // no waiting list → no such column
  assert.equal(RS.table(FORM, ROWS.slice(0, 2), W)[0][1], "Name");
  const csv = RS.csv(tb);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.endsWith("\r\n"));
  assert.ok(csv.includes(";'=SUM(A1);"));
  assert.ok(csv.includes(';"Bo; ""B""";'));
  assert.equal(RS.cell(-3), "-3");                    // numbers are not guarded
  assert.equal(RS.cell("-3"), "'-3");
  assert.equal(RS.cell("a\nb"), '"a\nb"');
});

test("wiring: the page loads results.js before app.js; strings in EN, EL and the German pack", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "forms/index.html"), "utf8");
  assert.ok(html.indexOf("results.js") > 0 && html.indexOf("results.js") < html.indexOf("app.js?"));
  const app = fs.readFileSync(path.join(root, "forms/app.js"), "utf8");
  const de = fs.readFileSync(path.join(root, "i18n/de/forms.js"), "utf8");
  for (const k of ["an.view.sum", "an.filter", "an.sheet", "an.csv", "res.answered", "res.multi", "res.col.time"]) {
    assert.ok(app.split('"' + k + '"').length - 1 >= 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '"'), k + " in DE");
  }
  assert.ok(!app.includes('"an.soon"'));
});
