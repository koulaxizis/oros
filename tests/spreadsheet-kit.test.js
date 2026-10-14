// Spreadsheet Wave 2 pure logic (spreadsheet/sheetkit.js): ranges, the
// fill handle's series, the system clipboard (TSV / HTML tables from
// Excel, Sheets, Calc), conditional formatting, the chart data and SVG,
// and the normalisers of the synced chart / rule records.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const K = require(path.join(__dirname, "..", "spreadsheet/sheetkit.js"));
const fill = (raws, n, o) => K.fillSeries(raws, n, o).map((e) => (e.v !== undefined ? e.v : "#" + e.copy));

test("ranges: parse, print, whole columns / rows, bad input", () => {
  assert.deepEqual(K.parseRange("b3:a1"), { t: 0, b: 2, l: 0, r: 1 });
  assert.deepEqual(K.parseRange("$C$5"), { t: 4, b: 4, l: 2, r: 2 });
  assert.deepEqual(K.parseRange("A:B", 100, 26), { t: 0, b: 99, l: 0, r: 1 });
  assert.deepEqual(K.parseRange("2:3", 100, 26), { t: 1, b: 2, l: 0, r: 25 });
  assert.equal(K.parseRange("A0"), null);
  assert.equal(K.parseRange("A1:A10001"), null);
  assert.equal(K.parseRange("=A1"), null);
  assert.equal(K.rangeStr({ t: 0, b: 9, l: 1, r: 2 }), "B1:C10");
  assert.equal(K.rangeStr({ t: 4, b: 4, l: 0, r: 0 }), "A5");
});

test("ranges follow inserted / deleted rows and columns", () => {
  const g = K.parseRange("B2:C5");
  assert.equal(K.rangeStr(K.adjRange(g, "r", 0, 2)), "B4:C7");
  assert.equal(K.rangeStr(K.adjRange(g, "r", 3, 1)), "B2:C6");
  assert.equal(K.rangeStr(K.adjRange(g, "r", 2, -2)), "B2:C3");
  assert.equal(K.adjRange(g, "c", 1, -2), null);                  // B:C deleted
  assert.equal(K.rangeStr(K.adjRange(K.parseRange("A1:A10000"), "r", 0, 5)), "A6:A10000");  // capped
});

test("fill: numbers continue the trend, a single number repeats (Ctrl counts)", () => {
  assert.deepEqual(fill(["1", "2"], 3), ["3", "4", "5"]);
  assert.deepEqual(fill(["2", "4", "7"], 2), ["9.33333333333", "11.8333333333"]);
  assert.deepEqual(fill(["0.1", "0.2"], 2), ["0.3", "0.4"]);
  assert.deepEqual(fill(["5"], 2), ["#0", "#0"]);
  assert.deepEqual(fill(["5"], 2, { inc: true }), ["6", "7"]);
  assert.deepEqual(fill(["46309"], 2, { dates: [true] }), ["46310", "46311"]);  // a date shown as a date
  assert.deepEqual(fill(["1", "2", "3"], 2, { back: true }), ["0", "-1"]);       // upwards
});

test("fill: weekdays and months in English and Greek, case kept", () => {
  assert.deepEqual(fill(["Monday"], 3), ["Tuesday", "Wednesday", "Thursday"]);
  assert.deepEqual(fill(["Sat"], 2), ["Sun", "Mon"]);
  assert.deepEqual(fill(["Dec"], 1), ["Jan"]);
  assert.deepEqual(fill(["Jan", "Mar"], 2), ["May", "Jul"]);
  assert.deepEqual(fill(["Δευτέρα"], 2), ["Τρίτη", "Τετάρτη"]);
  assert.deepEqual(fill(["ΔΕΥΤΕΡΑ"], 1), ["ΤΡΙΤΗ"]);
  assert.deepEqual(fill(["Ιανουάριος"], 1), ["Φεβρουάριος"]);
  assert.deepEqual(fill(["Μαρ"], 2), ["Απρ", "Μαΐ"]);
  assert.deepEqual(fill(["Tuesday"], 1, { back: true }), ["Monday"]);
});

test("fill: text dates, Item 1 / Q01 numbering, repeats and formulas", () => {
  assert.deepEqual(fill(["2026-12-31"], 2), ["2027-01-01", "2027-01-02"]);
  assert.deepEqual(fill(["30/12/2026", "31/12/2026"], 1), ["01/01/2027"]);
  assert.deepEqual(fill(["Item 1"], 3), ["Item 2", "Item 3", "Item 4"]);
  assert.deepEqual(fill(["Q01", "Q03"], 1), ["Q05"]);
  assert.deepEqual(fill(["a1", "x"], 4), ["a2", "#1", "a3", "#1"]);
  assert.deepEqual(fill(["=A1", "=A2"], 3), ["#0", "#1", "#0"]);
  assert.deepEqual(fill(["=A1", "x"], 3, { back: true }), ["#1", "#0", "#1"]);
  assert.deepEqual(fill(["red", "green"], 3), ["#0", "#1", "#0"]);
  assert.deepEqual(fill([""], 2), ["#0", "#0"]);
});

test("clipboard text: tabs and lines, quoted cells with tabs, line breaks and quotes", () => {
  const rows = [["a", "b\tc"], ['say "hi"', "1\n2"], ["", "x"]];
  const tsv = K.toTSV(rows);
  assert.equal(tsv, 'a\t"b\tc"\r\n"say ""hi"""\t"1\n2"\r\n\tx');
  assert.deepEqual(K.parseTSV(tsv), rows);
  assert.deepEqual(K.parseTSV("1\t2\r\n3\t4\r\n"), [["1", "2"], ["3", "4"]]);   // Excel's last line break
  assert.deepEqual(K.parseTSV("one line"), [["one line"]]);
});

test("clipboard HTML: Excel classes, Sheets styles, spans, entities; tags never kept", () => {
  const xl = '<html><head><style>.xl65{font-weight:700;background:#FFFF00} td{color:black}</style></head><body>' +
    '<table><tr><td class="xl65">Total &amp; sum</td><td colspan="2" style="text-align:center">a&lt;b</td></tr>' +
    '<tr><td><b>Bold</b></td><td>1<br>2</td><td><script>alert(1)</script>x</td></tr></table></body></html>';
  const t = K.parseHTMLTable(xl);
  assert.deepEqual(t.rows[0][0], { v: "Total & sum", f: { b: 1, bg: "#ffff00" } });
  assert.deepEqual(t.rows[0][1], { v: "a<b", f: { al: "c" } });
  assert.deepEqual(t.rows[0][2], { v: "" });
  assert.deepEqual(t.rows[1][0], { v: "Bold", f: { b: 1 } });
  assert.equal(t.rows[1][1].v, "1\n2");
  assert.equal(t.rows[1][2].v, "x");                                  // script content dropped
  assert.deepEqual(t.merges, [{ r: 0, c: 1, rs: 1, cs: 2 }]);
  const gs = '<google-sheets-html-origin><table><tbody><tr><td style="color:rgb(255,0,0);font-style:italic">r</td>' +
    '<td rowspan="2" style="background-color:#ffffff">w</td></tr><tr><td>z</td></tr></tbody></table>';
  const g = K.parseHTMLTable(gs);
  assert.deepEqual(g.rows[0][0], { v: "r", f: { i: 1, co: "#ff0000" } });
  assert.deepEqual(g.rows[0][1], { v: "w" });                         // white fill is no fill
  assert.deepEqual(g.rows[1][0], { v: "z" });
  assert.deepEqual(g.merges, [{ r: 0, c: 1, rs: 2, cs: 1 }]);
  assert.equal(K.parseHTMLTable("<p>no table</p>"), null);
  const out = K.toHTML([[{ s: "<b>", f: { b: 1, bg: "#fde68a" } }, { s: "x", rs: 1, cs: 2 }, { s: "", skip: true }]]);
  assert.match(out, /<td style="font-weight:bold;background-color:#fde68a">&lt;b&gt;<\/td><td colspan="2">x<\/td><\/tr>/);
});

test("pasted numbers: Greek and English thousands / decimals", () => {
  assert.equal(K.pasteValue("1.234,56", "el"), "1234.56");
  assert.equal(K.pasteValue("12,5", "el"), "12.5");
  assert.equal(K.pasteValue("1,234,567.5", "en"), "1234567.5");
  assert.equal(K.pasteValue("1,5", "en"), "1,5");
  assert.equal(K.pasteValue(" 42 ", "en"), "42");
  assert.equal(K.pasteValue("hello world", "en"), "hello world");
});

test("conditional formatting: value rules, top / bottom, duplicates, scales, bars", () => {
  const vals = [1, 5, 10, 5, "a", null, "A"];
  const st = (k, x) => K.cfStats(Object.assign({ k }, x), vals);
  assert.deepEqual(K.cfStyle({ k: "gt", a: "4", st: { bg: "#f8c4c4" } }, 5, {}), { bg: "#f8c4c4", co: "#1a1a1a" });
  assert.equal(K.cfStyle({ k: "gt", a: "4", st: { bg: "#f8c4c4" } }, 4, {}), null);
  assert.ok(K.cfStyle({ k: "bt", a: "10", b: "5", st: { b: 1 } }, 7, {}).b);
  assert.ok(K.cfStyle({ k: "eq", a: "abc", st: { b: 1 } }, "ABC", {}));
  assert.ok(K.cfStyle({ k: "tx", a: "pa", st: { b: 1 } }, "unpaid", {}));
  assert.ok(K.cfStyle({ k: "lt", a: "2026-10-14", st: { b: 1 } }, 46300, {}));   // a date as the value
  const top = st("top", { n: 2 });
  assert.ok(K.cfStyle({ k: "top", n: 2, st: { b: 1 } }, 10, top));
  assert.ok(K.cfStyle({ k: "top", n: 2, st: { b: 1 } }, 5, top));
  assert.equal(K.cfStyle({ k: "top", n: 2, st: { b: 1 } }, 1, top), null);
  assert.ok(K.cfStyle({ k: "bot", n: 1, st: { b: 1 } }, 1, st("bot", { n: 1 })));
  const dup = st("dup");
  assert.ok(K.cfStyle({ k: "dup", st: { b: 1 } }, 5, dup));
  assert.ok(K.cfStyle({ k: "dup", st: { b: 1 } }, "a", dup));        // text, without case
  assert.equal(K.cfStyle({ k: "dup", st: { b: 1 } }, 10, dup), null);
  const cs = st("cs");
  assert.equal(K.cfStyle({ k: "cs", cs: ["#000000", "#ffffff"] }, 1, cs).bg, "#000000");
  assert.equal(K.cfStyle({ k: "cs", cs: ["#000000", "#ffffff"] }, 10, cs).bg, "#ffffff");
  assert.equal(K.cfStyle({ k: "cs", cs: ["#ff0000", "#00ff00", "#0000ff"] }, 5, cs).bg, "#00ff00");  // the median
  assert.equal(K.cfStyle({ k: "cs", cs: ["#000000", "#ffffff"] }, "a", cs), null);
  assert.equal(K.cfStyle({ k: "db", db: "#2a78d6" }, 5, st("db")).bar, 0.5);
  assert.equal(K.cfStyle({ k: "gt", a: "1", st: { b: 1 } }, null, {}), null);    // blank cells never match
});

test("synced records: chart and rule normalisers are canonical fixed points", () => {
  const ch = K.normChart({ id: "c1", sid: "s-main", mtime: 5, t: "pie", src: "a1:b4", ttl: "T\u0007itle", lg: 0,
    co: ["#ABC", "nope", "#112233", ""], at: { r: 3, c: 1, x: 900, y: -5 }, w: 99999, h: 1, junk: 1 });
  assert.deepEqual(ch, { id: "c1", sid: "s-main", mtime: 5, t: "pie", src: "A1:B4", ttl: "T itle", lg: 0,
    co: ["#aabbcc", "", "#112233"], at: { r: 3, c: 1, x: 400, y: 0 }, w: 2000, h: 120 });
  assert.deepEqual(K.normChart(ch), ch);
  assert.equal(K.normChart({ id: "bad id!", sid: "s" }), null);
  assert.equal(K.normChart({ id: "c", sid: "s", t: "3d" }).t, "col");
  const r = K.normCf({ id: "r1", sid: "s-main", mtime: 7, pos: 2, rg: "c2:b9", k: "gt", a: "10", b: "x", n: 5, st: { bg: "#F8C4C4", co: "red" } });
  assert.deepEqual(r, { id: "r1", sid: "s-main", mtime: 7, pos: 2, rg: "B2:C9", k: "gt", a: "10", st: { bg: "#f8c4c4" } });
  assert.deepEqual(K.normCf(r), r);
  assert.deepEqual(K.normCf({ id: "r2", sid: "s", rg: "A1", k: "cs", cs: ["#fff"] }).cs, ["#e34948", "#1baf7a"]);
  assert.deepEqual(K.normCf({ id: "r3", sid: "s", rg: "A1", k: "top", n: 0 }).n, 1);
  assert.equal(K.normCf({ id: "r4", sid: "s", rg: "nope", k: "gt" }), null);
  assert.equal(K.normCf({ id: "r5", sid: "s", rg: "A1", k: "formula" }), null);
});

const cell = (v) => (typeof v === "number" ? { n: v, s: String(v) } : { n: null, s: v || "" });
const grid = (rows) => rows.map((r) => r.map(cell));

test("chart data: headings, categories, series by columns or rows", () => {
  const g = grid([["", "Q1", "Q2"], ["Ann", 10, 14], ["Bob", 7, null]]);
  const m = K.chartModel(g, {});
  assert.deepEqual(m.cats, ["Ann", "Bob"]);
  assert.deepEqual(m.series, [{ name: "Q1", vals: [10, 7] }, { name: "Q2", vals: [14, null] }]);
  assert.equal(m.by, "c");
  const r = K.chartModel(g, { by: "r" });
  assert.deepEqual(r.cats, ["Q1", "Q2"]);
  assert.deepEqual(r.series.map((s) => s.name), ["Ann", "Bob"]);
  const plain = K.chartModel(grid([[3], [4], [5]]), {});
  assert.deepEqual(plain.cats, ["1", "2", "3"]);
  assert.deepEqual(plain.series, [{ name: "", vals: [3, 4, 5] }]);
  const sc = K.chartModel(grid([["x", "y"], [1, 2], [3, 5]]), { t: "scatter" });
  assert.equal(sc.xnum, true);
  assert.deepEqual(sc.xs, [1, 3]);
  const wide = K.chartModel(grid([["a", "b", "c", "d"], [1, 2, 3, 4]]), {});
  assert.equal(wide.by, "r");                                          // more columns than rows
});

test("chart SVG: every type renders, text is escaped, one value axis, legend for 2+ series", () => {
  const m = K.chartModel(grid([["", "<b>Q1</b>", "Q2"], ["<script>x</script>", 10, -3], ["B", 7, 4]]), {});
  K.CHART_TYPES.forEach((t) => {
    const s = K.chartSVG(m, { t, w: 400, h: 260, ttl: 'Sales "2026" <i>', lg: 1, lang: "el", pal: { bg: "#ffffff", text: "#111111", dim: "#555555", grid: "#dddddd" } });
    assert.match(s, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.ok(!/<script|<b>|<i>/.test(s), t + " leaks markup");
    assert.match(s, /Sales &quot;2026&quot; &lt;i&gt;/);
    assert.ok((s.match(/<svg/g) || []).length === 1);
  });
  const col = K.chartSVG(m, { t: "col", w: 400, h: 260, lg: 1 });
  assert.match(col, /&lt;b&gt;Q1&lt;\/b&gt;/);                       // legend entry, escaped
  assert.equal((col.match(/<path d="M[^"]*Q/g) || []).length, 4);    // 4 bars with rounded ends
  const one = K.chartSVG(K.chartModel(grid([[1], [2]]), {}), { t: "col", w: 300, h: 200, lg: 1 });
  assert.ok(!/<rect x="[\d.]+" y="[\d.]+" width="10" height="10"/.test(one), "no legend for a single series");
  assert.match(K.chartSVG({ cats: [], series: [] }, { w: 200, h: 150, empty: "No data" }), /No data/);
  const pie = K.pieSlices({ vals: [5, 4, 3, 2, 1, 1, 1, 1, 1, 1] }, "abcdefghij".split(""), "Other");
  assert.equal(pie.length, 8);
  assert.deepEqual(pie[pie.length - 1], { name: "Other", v: 3 });
});

test("clean axis ticks and short numbers", () => {
  assert.deepEqual(K.niceScale(0, 95, 5).ticks, [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(K.niceScale(-3, 10, 4).ticks, [-5, 0, 5, 10]);
  assert.deepEqual(K.niceScale(5, 5, 4).ticks.slice(0, 2), [0, 2]);
  assert.equal(K.fmtNum(12500, "en"), "12.5K");
  assert.equal(K.fmtNum(2.5, "el"), "2,5");
  assert.equal(K.fmtNum(3e6, "en"), "3M");
});

test("colours: hex forms, ink on a fill, mixing", () => {
  assert.equal(K.hex("#ABC"), "#aabbcc");
  assert.equal(K.hex("rgb(255, 0, 16)"), "#ff0010");
  assert.equal(K.hex("rgba(0,0,0,0)"), null);
  assert.equal(K.hex("javascript:1"), null);
  assert.equal(K.inkOn("#fde68a"), "#1a1a1a");
  assert.equal(K.inkOn("#2a78d6"), "#f4f4f4");
  assert.equal(K.mix("#000000", "#ffffff", 0.5), "#808080");
});
