// Function library of the orOS Spreadsheet (spreadsheet/functions.js):
// criteria, lookups with 2-D ranges, error handling, text, dates as
// Excel serials, finance, TEXT patterns, reference rewriting (copy,
// insert / delete), sort order, current region and the filter test.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const FX = require(path.join(__dirname, "..", "spreadsheet/functions.js"));

const cells = {};
const E = FX.engine({
  raw: (sid, r, c) => cells[sid + "|" + r + "|" + c] || "",
  sheetId: (name) => (name === "Data" ? "s2" : null),
  extent: (sid) => ({ rows: sid === "s2" ? 3 : 20, cols: 6 }),
  formulaCells: () => [],
  lang: "en",
  now: () => new Date(2026, 9, 14, 9, 30).getTime()
});
function put(sid, a1, v) {
  const m = a1.match(/^([A-Z]+)(\d+)$/);
  cells[sid + "|" + (+m[2] - 1) + "|" + FX.colFromName(m[1])] = v;
}
function table() {
  Object.keys(cells).forEach((k) => delete cells[k]);
  // A: name, B: qty, C: price, D: date (text), E: blank holes
  [["Name", "Qty", "Price", "Day"], ["apple", "5", "1.2", "2026-10-01"], ["pear", "7", "2", "2026-10-05"],
   ["banana", "2", "0.5", "2026-10-09"], ["apricot", "9", "3", "2026-10-12"], ["Pear", "1", "2.5", "2026-10-14"]]
    .forEach((row, r) => row.forEach((v, c) => { cells["s1|" + r + "|" + c] = v; }));
  put("s2", "A1", "x"); put("s2", "B1", "10"); put("s2", "A2", "y"); put("s2", "B2", "20");
  E.reset();
}
const f = (src, lang) => { E.reset(); return E.formula("s1", src); };
const near = (a, b, eps) => assert.ok(Math.abs(a - b) < (eps || 1e-9), a + " ≈ " + b);

test("conditional aggregates with criteria strings and wildcards", () => {
  table();
  assert.equal(f('=SUMIF(A2:A6,"p*",B2:B6)'), 8);          // pear + Pear (no case)
  assert.equal(f('=SUMIF(B2:B6,">4")'), 21);
  assert.equal(f('=COUNTIF(A2:A6,"<>pear")'), 3);
  assert.equal(f('=COUNTIF(A2:A6,"a?ple")'), 1);
  assert.equal(f('=COUNTIF(B:B,5)'), 1);
  assert.equal(f('=COUNTIFS(A2:A6,"a*",B2:B6,">5")'), 1);
  assert.equal(f('=SUMIFS(B2:B6,A2:A6,"*a*",C2:C6,"<=2")'), 14);
  near(f('=AVERAGEIF(A2:A6,"p*",C2:C6)'), 2.25);
  near(f('=AVERAGEIFS(C2:C6,B2:B6,">=5")'), (1.2 + 2 + 3) / 3);
  assert.equal(f('=AVERAGEIF(A2:A6,"zzz",B2:B6)'), "#DIV/0!");
  assert.equal(f('=COUNTBLANK(A1:F6)'), 12);
  assert.equal(f('=COUNTIF(F1:F6,"")'), 6);
  assert.equal(f('=MAXIFS(B2:B6,A2:A6,"p*")'), 7);
  assert.equal(f('=COUNTIF(D2:D6,">2026-10-08")'), 0);    // text dates compare as text, not >
});

test("lookups keep the 2-D shape of ranges", () => {
  table();
  assert.equal(f('=VLOOKUP("banana",A2:C6,3,FALSE)'), 0.5);
  assert.equal(f('=VLOOKUP("kiwi",A2:C6,2,FALSE)'), "#N/A");
  assert.equal(f('=VLOOKUP("pear",A2:C6,4,FALSE)'), "#REF!");
  assert.equal(f('=HLOOKUP("Price",A1:D3,3,FALSE)'), 2);
  assert.equal(f('=INDEX(A1:D6,3,2)'), 7);
  assert.equal(f('=INDEX(B2:B6,4)'), 9);
  assert.equal(f('=SUM(INDEX(A1:C6,0,2))'), 24);
  assert.equal(f('=MATCH("apricot",A1:A6,0)'), 5);
  assert.equal(f('=MATCH(6,B2:B3,1)'), 1);
  assert.equal(f('=INDEX(C2:C6,MATCH("pear",A2:A6,0))'), 2);
  assert.equal(f('=XLOOKUP("apricot",A2:A6,C2:C6)'), 3);
  assert.equal(f('=XLOOKUP("kiwi",A2:A6,C2:C6,"none")'), "none");
  assert.equal(f('=XLOOKUP("pear",A2:A6,B2:B6,,0,-1)'), 1);   // search from the end
  assert.equal(f('=VLOOKUP(6,{1},1)'), "#ERROR!");             // array constants: not supported
  // approximate match in sorted data
  Object.keys(cells).forEach((k) => delete cells[k]);
  [[0, "F"], [50, "D"], [70, "B"], [90, "A"]].forEach((row, r) => { cells["s1|" + r + "|0"] = String(row[0]); cells["s1|" + r + "|1"] = row[1]; });
  assert.equal(f("=VLOOKUP(75,A1:B4,2)"), "B");
  assert.equal(f("=VLOOKUP(-1,A1:B4,2)"), "#N/A");
  assert.equal(f("=XLOOKUP(60,A1:A4,B1:B4,,-1)"), "D");
  assert.equal(f("=XLOOKUP(60,A1:A4,B1:B4,,1)"), "B");
  put("s2", "B1", "10"); put("s2", "B2", "20");
  assert.equal(f("=Data!B2+SUM(Data!B:B)"), 50);
  assert.equal(f("=ROWS(A1:B4)*10+COLUMNS(A1:B4)"), 42);
  assert.equal(f("=ROW(B3)+COLUMN(B3)"), 5);
});

test("error handling functions see errors instead of stopping", () => {
  table();
  assert.equal(f('=IFERROR(1/0,"x")'), "x");
  assert.equal(f('=IFERROR(VLOOKUP("kiwi",A2:B6,2,FALSE),0)'), 0);
  assert.equal(f('=IFNA(MATCH("kiwi",A2:A6,0),-1)'), -1);
  assert.equal(f('=IFNA(1/0,-1)'), "#DIV/0!");
  assert.equal(f("=ISERROR(1/0)"), true);
  assert.equal(f("=ISNA(NA())"), true);
  assert.equal(f("=ISERR(NA())"), false);
  assert.equal(f("=ISNUMBER(B2)"), true);
  assert.equal(f("=ISTEXT(A2)"), true);
  assert.equal(f("=ISBLANK(F1)"), true);
  assert.equal(f('=IF(B2>3,"big",1/0)'), "big");           // the unused branch is not an error
  assert.equal(f('=IFS(B2>9,"a",B2>4,"b",TRUE,"c")'), "b");
  assert.equal(f('=SWITCH(A3,"apple",1,"pear",2,0)'), 2);
  assert.equal(f('=SWITCH(A4,"apple",1,"pear",2)'), "#N/A");
  assert.equal(f("=SUM(B2:B6,1/0)"), "#DIV/0!");
  assert.equal(f("=CHOOSE(2,\"a\",\"b\",\"c\")"), "b");
});

test("text functions", () => {
  table();
  assert.equal(f('=LEN("Γειά σου")'), 8);
  assert.equal(f('=LEFT("abcdef",2)&RIGHT("abcdef")&MID("abcdef",3,2)'), "abfcd");
  assert.equal(f('=UPPER("ελλάδα")'), "ΕΛΛΆΔΑ");
  assert.equal(f('=PROPER("hello wORLD-wide")'), "Hello World-Wide");
  assert.equal(f('=TRIM("  a   b  ")'), "a b");
  assert.equal(f('=SUBSTITUTE("a-b-c","-","+")'), "a+b+c");
  assert.equal(f('=SUBSTITUTE("a-b-c","-","+",2)'), "a-b+c");
  assert.equal(f('=FIND("b","abcb")'), 2);
  assert.equal(f('=FIND("B","abcb")'), "#VALUE!");
  assert.equal(f('=SEARCH("B","abcb",3)'), 4);
  assert.equal(f('=SEARCH("b?b","abcb")'), 2);
  assert.equal(f('=VALUE("1,234.5")'), 1234.5);
  assert.equal(f('=VALUE("abc")'), "#VALUE!");
  assert.equal(f('=TEXTJOIN(", ",TRUE,A2:A4,F1,"end")'), "apple, pear, banana, end");
  assert.equal(f('=TEXTJOIN("-",FALSE,"a",F1,"b")'), "a--b");
  assert.equal(f('=REPT("ab",3)'), "ababab");
  assert.equal(f('=CONCAT(A2:A3,"!")'), "applepear!");
  assert.equal(f('=EXACT("a","A")'), false);
  assert.equal(f('=1/3&""'), "0.333333333333333");
});

test("TEXT patterns", () => {
  assert.equal(f('=TEXT(1234.567,"0")'), "1235");
  assert.equal(f('=TEXT(1234.567,"0.00")'), "1234.57");
  assert.equal(f('=TEXT(1234567.891,"#,##0")'), "1,234,568");
  assert.equal(f('=TEXT(1234567.891,"#,##0.00")'), "1,234,567.89");
  assert.equal(f('=TEXT(0.256,"0%")'), "26%");
  assert.equal(f('=TEXT(0.256,"0.0%")'), "25.6%");
  assert.equal(f('=TEXT(-5,"0.00")'), "-5.00");
  assert.equal(f('=TEXT(5,"€ #,##0.00")'), "€ 5.00");
  assert.equal(f('=TEXT(7,"000")'), "007");
  assert.equal(f('=TEXT(DATE(2026,10,4),"dd/mm/yyyy")'), "04/10/2026");
  assert.equal(f('=TEXT(DATE(2026,10,4),"yyyy-mm-dd")'), "2026-10-04");
  assert.equal(f('=TEXT(DATE(2026,10,4),"d mmm yy")'), "4 Oct 26");
  assert.equal(f('=TEXT(DATE(2026,10,4),"dddd")'), "Sunday");
  assert.equal(f('=TEXT(TIME(14,5,9),"hh:mm:ss")'), "14:05:09");
  assert.equal(f('=TEXT("2026-10-14","dd.mm.yyyy")'), "14.10.2026");
  assert.equal(FX.textFormat(46309, "dddd d mmmm yyyy", "el"), "Τετάρτη 14 Οκτώβριος 2026");
});

test("dates are Excel serials (days since 1899-12-30)", () => {
  table();
  assert.equal(f("=DATE(2026,10,14)"), 46309);
  assert.equal(f("=DATE(1900,3,1)"), 61);
  assert.equal(f("=DATE(2026,13,1)"), f("=DATE(2027,1,1)"));
  assert.equal(f("=DATE(2026,3,0)"), f("=DATE(2026,2,28)"));
  assert.equal(f("=TODAY()"), 46309);
  near(f("=NOW()"), 46309 + 9.5 / 24, 1e-6);
  assert.equal(f("=YEAR(46309)*10000+MONTH(46309)*100+DAY(46309)"), 20261014);
  assert.equal(f('=YEAR("14/10/2026")'), 2026);              // day-first text dates
  assert.equal(f("=DAY(D3)"), 5);                            // text cell 2026-10-05
  assert.equal(f("=WEEKDAY(DATE(2026,10,14))"), 4);         // Wednesday, Sunday = 1
  assert.equal(f("=WEEKDAY(DATE(2026,10,14),2)"), 3);
  assert.equal(f("=DAYS(DATE(2026,12,25),DATE(2026,10,14))"), 72);
  assert.equal(f('=DATEDIF(DATE(1990,5,20),DATE(2026,10,14),"Y")'), 36);
  assert.equal(f('=DATEDIF(DATE(1990,5,20),DATE(2026,10,14),"YM")'), 4);
  assert.equal(f('=DATEDIF(DATE(1990,5,20),DATE(2026,10,14),"MD")'), 24);
  assert.equal(f('=DATEDIF(DATE(2026,1,31),DATE(2026,3,1),"M")'), 1);
  assert.equal(f('=DATEDIF(DATE(2026,2,1),DATE(2026,1,1),"D")'), "#NUM!");
  assert.equal(f("=EDATE(DATE(2026,1,31),1)"), f("=DATE(2026,2,28)"));
  assert.equal(f("=EOMONTH(DATE(2026,1,15),1)"), f("=DATE(2026,2,28)"));
  assert.equal(f("=EOMONTH(DATE(2026,1,15),-1)"), f("=DATE(2025,12,31)"));
  assert.equal(f("=NETWORKDAYS(DATE(2026,10,1),DATE(2026,10,31))"), 22);
  assert.equal(f("=NETWORKDAYS(DATE(2026,10,1),DATE(2026,10,31),DATE(2026,10,28))"), 21);
  assert.equal(f("=WORKDAY(DATE(2026,10,16),1)"), f("=DATE(2026,10,19)"));
  assert.equal(f('=DATEVALUE("2026-10-14")'), 46309);
  assert.equal(FX.dateStr(46309, "el"), "14/10/2026");
  assert.equal(FX.dateStr(46309, "en"), "2026-10-14");
  assert.equal(FX.parseDate("31/02/2026"), null);
  assert.equal(FX.autoDate("=TODAY()"), "d");
  assert.equal(FX.autoDate("=NOW()"), "dt");
  assert.equal(FX.autoDate("=TODAY()+1"), "d");
  assert.equal(FX.autoDate("=SUM(A1)"), null);
});

test("maths, statistics and finance", () => {
  table();
  assert.equal(f("=ROUND(2.345,2)"), 2.35);
  assert.equal(f("=ROUND(-2.5,0)"), -3);
  assert.equal(f("=ROUND(1234,-2)"), 1200);
  assert.equal(f("=ROUNDUP(1.21,1)"), 1.3);
  assert.equal(f("=ROUNDUP(-1.21,1)"), -1.3);
  assert.equal(f("=ROUNDDOWN(1.29,1)"), 1.2);
  assert.equal(f("=INT(-1.5)"), -2);
  assert.equal(f("=MOD(-3,2)"), 1);
  assert.equal(f("=MOD(5,0)"), "#DIV/0!");
  assert.equal(f("=POWER(2,10)"), 1024);
  assert.equal(f("=SQRT(-1)"), "#NUM!");
  assert.equal(f("=PRODUCT(B2:B4)"), 70);
  assert.equal(f("=MEDIAN(B2:B6)"), 5);
  assert.equal(f("=MODE(1,2,2,3,3)"), 2);
  near(f("=STDEV.S(B2:B6)"), Math.sqrt(11.2), 1e-9);   // 5 7 2 9 1: mean 4.8, squares 44.8
  near(f("=STDEV(B2:B6)"), Math.sqrt(11.2), 1e-9);
  near(f("=STDEV.P(B2:B6)"), Math.sqrt(8.96), 1e-9);
  near(f("=VAR(B2:B6)"), 11.2, 1e-9);
  near(f("=VAR.P(B2:B6)"), 8.96, 1e-9);
  assert.equal(f("=LARGE(B2:B6,2)"), 7);
  assert.equal(f("=SMALL(B2:B6,2)"), 2);
  assert.equal(f("=RANK(7,B2:B6)"), 2);
  assert.equal(f("=RANK(7,B2:B6,1)"), 4);
  assert.equal(f("=COUNT(A1:C6)"), 10);
  assert.equal(f("=COUNTA(A1:C6)"), 18);
  assert.equal(f("=AVERAGE(B1:B10)"), 4.8);
  const r = f("=RANDBETWEEN(3,5)");
  assert.ok(r >= 3 && r <= 5 && Number.isInteger(r));
  near(f("=PMT(0.05/12,360,200000)"), -1073.6432460242797, 1e-6);
  near(f("=PMT(0,10,1000)"), -100, 1e-9);
  near(f("=FV(0.05/12,120,-100)"), 15528.227944566, 1e-6);
  near(f("=PV(0.05/12,120,-100)"), 9428.135032823, 1e-6);
  near(f("=NPER(0.01,-100,1000)"), 10.588644, 1e-5);
  assert.equal(f("=SUMPRODUCT(B2:B3,C2:C3)"), 20);
  assert.equal(f("=SUM(B2:B3*C2:C3)"), 20);
});

test("reference rewriting: copy shift, insert and delete", () => {
  assert.equal(FX.shiftFormula("=A1+$B$2+B$3+$C4", 1, 1), "=B2+$B$2+C$3+$C5");
  assert.equal(FX.shiftFormula('=SUM(A1:B2)&"A1"', 2, 0), '=SUM(A3:B4)&"A1"');
  assert.equal(FX.shiftFormula("=Data!A1+'My sheet'!B2", 1, 0), "=Data!A2+'My sheet'!B3");
  assert.equal(FX.shiftFormula("=A1", -1, 0), "=#REF!");
  assert.equal(FX.shiftFormula("=SUM(A:A)", 5, 1), "=SUM(B:B)");
  const here = (n) => n === null;
  assert.equal(FX.adjustFormula("=A1+A5+SUM(A2:A10)+$A$7", here, "r", 3, 2), "=A1+A7+SUM(A2:A12)+$A$9");
  assert.equal(FX.adjustFormula("=A1+A5+SUM(A2:A10)", here, "r", 4, -1), "=A1+#REF!+SUM(A2:A9)");
  assert.equal(FX.adjustFormula("=SUM(A3:A4)", here, "r", 2, -2), "=SUM(#REF!)");
  assert.equal(FX.adjustFormula("=SUM(A2:A6)", here, "r", 0, -3), "=SUM(A1:A3)");
  assert.equal(FX.adjustFormula("=B1+SUM(C:D)+Other!B1", here, "c", 1, 1), "=C1+SUM(D:E)+Other!B1");
  assert.equal(FX.adjustFormula("=B1+SUM(C:D)", here, "c", 1, -1), "=#REF!+SUM(B:C)");
  assert.equal(FX.adjustFormula("=Data!A5", (n) => n === "Data", "r", 0, 1), "=Data!A6");
  assert.equal(FX.adjustFormula("=SUM(A:A)", here, "r", 0, 5), "=SUM(A:A)");
});

test("sort order, current region, filter test", () => {
  const vals = [3, "b", null, "A", true, 10, "", "a10", "a9", "#N/A"];
  const asc = FX.sortOrder(vals, false, "en").map((i) => vals[i]);
  assert.deepEqual(asc, [3, 10, "A", "a9", "a10", "b", true, "#N/A", null, ""]);
  const desc = FX.sortOrder(vals, true, "en").map((i) => vals[i]);
  assert.deepEqual(desc.slice(-2), [null, ""]);          // blanks last both ways
  assert.equal(desc[0], "#N/A");
  // stable for ties
  assert.deepEqual(FX.sortOrder(["x", "X", "x"], false, "en"), [0, 1, 2]);
  const grid = new Set(["1,1", "1,2", "2,1", "3,1", "3,2", "6,1"]);
  const has = (r, c) => grid.has(r + "," + c);
  assert.deepEqual(FX.region(has, 2, 1, 100, 26), { t: 1, b: 3, l: 1, r: 2 });
  assert.equal(FX.region(has, 10, 10, 100, 26), null);
  assert.deepEqual(FX.region(has, 6, 1, 100, 26), { t: 6, b: 6, l: 1, r: 1 });
  const spec = { cols: { 0: { ex: ["pear", ""] }, 1: { q: "re" } } };
  const row = (a, b) => (c) => (c === 0 ? a : b);
  assert.equal(FX.filterPass(spec, row("apple", "red")), true);
  assert.equal(FX.filterPass(spec, row("pear", "red")), false);
  assert.equal(FX.filterPass(spec, row("", "Green")), false);
  assert.equal(FX.filterPass(spec, row("kiwi", "GREEN")), true);
  assert.equal(FX.filterPass(spec, row("kiwi", "blue")), false);
});

test("every function has a one-line help in English and Greek", () => {
  const missing = [];
  FX.names().forEach((n) => {
    const base = n.replace(/\.[A-Z]+$/, "");
    if (!(FX.HELP.en[n] || FX.HELP.en[base]) || !(FX.HELP.el[n] || FX.HELP.el[base])) missing.push(n);
  });
  assert.deepEqual(missing, []);
  assert.ok(FX.names().length >= 100, "functions: " + FX.names().length);
});
