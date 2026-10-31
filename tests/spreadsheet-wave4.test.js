// Spreadsheet wave 4 (functions): maths, statistics, dates, text,
// finance and lookup functions added 2026-10-31, array constants, and
// OFFSET / INDIRECT building references. Expected values are the
// results Excel documents for the same arguments.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const FX = require(path.join(__dirname, "..", "spreadsheet/functions.js"));

const cells = {};
const E = FX.engine({
  raw: (sid, r, c) => cells[sid + "|" + r + "|" + c] || "",
  sheetId: (name) => (name === "Data" ? "s2" : name === "s1" ? "s1" : null),
  extent: (sid) => ({ rows: sid === "s2" ? 3 : 10, cols: 6 }),
  formulaCells: () => [],
  lang: "en",
  now: () => Date.UTC(2026, 9, 31, 12)
});
function put(sid, a1, v) {
  const m = a1.match(/^([A-Z]+)(\d+)$/);
  cells[sid + "|" + (+m[2] - 1) + "|" + FX.colFromName(m[1])] = v;
}
const f = (src) => { E.reset(); return E.formula("s1", src); };
function near(src, want, eps) {
  const v = f(src);
  assert.equal(typeof v, "number", src + " -> " + v);
  assert.ok(Math.abs(v - want) <= (eps || Math.max(1e-6, Math.abs(want) * 1e-7)), src + " -> " + v + ", want " + want);
}

test("maths", () => {
  assert.equal(f("=GCD(24,36)"), 12);
  assert.equal(f("=LCM(5,2)"), 10);
  assert.equal(f("=GCD(-1,2)"), "#NUM!");
  assert.equal(f("=FACT(5)"), 120);
  assert.equal(f("=FACT(171)"), "#NUM!");
  assert.equal(f("=COMBIN(8,2)"), 28);
  assert.equal(f("=PERMUT(100,3)"), 970200);
  assert.equal(f("=MROUND(10,3)"), 9);
  assert.equal(f("=MROUND(-10,-3)"), -9);
  assert.equal(f("=MROUND(5,-2)"), "#NUM!");
  near("=MROUND(1.3,0.2)", 1.4);
  assert.equal(f("=EVEN(1.5)"), 2);
  assert.equal(f("=EVEN(-1)"), -2);
  assert.equal(f("=ODD(2)"), 3);
  assert.equal(f("=ODD(-1.5)"), -3);
  assert.equal(f("=ODD(0)"), 1);
  assert.equal(f("=QUOTIENT(-10,3)"), -3);
  assert.equal(f("=QUOTIENT(1,0)"), "#DIV/0!");
  near("=ATAN2(1,1)", Math.PI / 4);
  assert.equal(f("=ATAN2(0,0)"), "#DIV/0!");
  assert.equal(f("=ASIN(2)"), "#NUM!");
  near("=DEGREES(PI())", 180);
  near("=SIN(RADIANS(30))", 0.5);
  assert.equal(f("=CEILING.MATH(-5.5,2,-1)"), -6);
  assert.equal(f("=CEILING.MATH(-5.5,2)"), -4);
  assert.equal(f("=CEILING.MATH(24.3,5)"), 25);
  assert.equal(f("=FLOOR.MATH(-5.5,2,-1)"), -4);
  assert.equal(f("=FLOOR.MATH(-5.5)"), -6);
  assert.equal(f("=SUBTOTAL(9,{1,2,3})"), 6);
  assert.equal(f("=SUBTOTAL(101,{1,2,3})"), 2);
  assert.equal(f("=SUBTOTAL(12,{1,2,3})"), "#VALUE!");
});

test("statistics", () => {
  near("=CORREL({3,2,4,5,6},{9,7,12,15,17})", 0.997054486);
  near("=PEARSON({3,2,4,5,6},{9,7,12,15,17})", 0.997054486);
  near("=SLOPE({2,3,9,1,8,7,5},{6,5,11,7,5,4,4})", 0.305555556);
  near("=INTERCEPT({2,3,9,1,8},{6,5,11,7,5})", 0.0483871);
  near("=RSQ({2,3,9,1,8,7,5},{6,5,11,7,5,4,4})", 0.05795019);
  near("=FORECAST(30,{6,7,9,15,21},{20,28,31,38,40})", 10.607253);
  near("=FORECAST.LINEAR(30,{6,7,9,15,21},{20,28,31,38,40})", 10.607253);
  assert.equal(f("=SLOPE({1,2},{1,2,3})"), "#N/A");
  assert.equal(f("=SLOPE({1},{1})"), "#DIV/0!");
  near("=GEOMEAN(4,5,8,7,11,4,3)", 5.476986969);
  near("=HARMEAN(4,5,8,7,11,4,3)", 5.028375962);
  assert.equal(f("=GEOMEAN(1,-1)"), "#NUM!");
  near("=NORM.S.DIST(1,TRUE)", 0.841344746068543, 1e-12);
  near("=NORM.S.DIST(-1.96,TRUE)", 0.0249978951482204, 1e-12);
  near("=NORM.DIST(42,40,1.5,TRUE)", 0.9087888);
  near("=NORM.DIST(42,40,1.5,FALSE)", 0.10934005);
  near("=NORM.S.INV(0.975)", 1.95996398454005, 1e-9);
  near("=NORM.INV(0.908789,40,1.5)", 42.000002);
  assert.equal(f("=NORM.S.INV(1)"), "#NUM!");
  near("=STANDARDIZE(42,40,1.5)", 1.333333333);
  put("s1", "A1", "5"); put("s1", "A2", "x"); put("s1", "A3", "TRUE");
  near("=AVERAGEA(A1:A3)", 2);              // 5 + 0 + 1
  assert.equal(f("=AVERAGE(A1:A3)"), 5);
  assert.equal(f("=MINA(A1:A3)"), 0);
  assert.equal(f("=MAXA(A1:A3)"), 5);
  Object.keys(cells).forEach((k) => delete cells[k]);
});

test("dates", () => {
  near("=YEARFRAC(DATE(2012,1,1),DATE(2012,7,30))", 0.58055556);
  near("=YEARFRAC(DATE(2012,1,1),DATE(2012,7,30),1)", 0.57650273);
  near("=YEARFRAC(DATE(2012,1,1),DATE(2012,7,30),3)", 0.57808219);
  near("=YEARFRAC(DATE(2012,7,30),DATE(2012,1,1),2)", 211 / 360);
  assert.equal(f("=DAYS360(DATE(2011,1,30),DATE(2011,12,31))"), 330);
  assert.equal(f("=DAYS360(DATE(2011,1,1),DATE(2011,12,31))"), 360);
  assert.equal(f("=DAYS360(DATE(2011,1,1),DATE(2011,12,31),TRUE)"), 359);
  assert.equal(f("=WEEKNUM(DATE(2012,3,9))"), 10);
  assert.equal(f("=WEEKNUM(DATE(2012,3,9),2)"), 11);
  assert.equal(f("=WEEKNUM(DATE(2021,1,1),21)"), 53);
  assert.equal(f("=ISOWEEKNUM(DATE(2012,3,9))"), 10);
  assert.equal(f("=ISOWEEKNUM(DATE(2026,12,31))"), 53);
  assert.equal(f("=NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,1,31))"), 22);
  assert.equal(f('=NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,2,1),7,{"2006-01-02","2006-01-16"})'), 22);
  assert.equal(f('=NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,2,1),"0010001",{"2006-01-02","2006-01-16"})'), 20);
  assert.equal(f("=NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,1,31),1)"), f("=NETWORKDAYS(DATE(2006,1,1),DATE(2006,1,31))"));
  assert.equal(f('=NETWORKDAYS.INTL(1,9,"1111111")'), "#VALUE!");
  assert.equal(f("=WORKDAY.INTL(DATE(2012,1,1),30,0)"), "#NUM!");
  assert.equal(f("=WORKDAY.INTL(DATE(2012,1,1),90,11)"), 41013);
  assert.equal(f("=WORKDAY.INTL(DATE(2012,1,1),30,17)"), 40944);
  near('=TIMEVALUE("2:24 AM")', 0.1);
  near('=TIMEVALUE("14:30")', 14.5 / 24);
  near('=TIMEVALUE("2026-10-31 18:00")', 0.75);
  assert.equal(f('=TIMEVALUE("soon")'), "#VALUE!");
  assert.equal(FX.autoDate("=WORKDAY.INTL(A1,3)"), "d");
});

test("text", () => {
  const s = '"Little red riding hood\'s red hood"';
  assert.equal(f("=TEXTBEFORE(" + s + ',"hood")'), "Little red riding ");
  assert.equal(f("=TEXTBEFORE(" + s + ',"red",2)'), "Little red riding hood's ");
  assert.equal(f("=TEXTBEFORE(" + s + ',"red",-2)'), "Little ");
  assert.equal(f("=TEXTBEFORE(" + s + ',"Red",,1)'), "Little ");
  assert.equal(f("=TEXTAFTER(" + s + ',"red",2)'), " hood");
  assert.equal(f("=TEXTAFTER(" + s + ',"basket")'), "#N/A");
  assert.equal(f("=TEXTAFTER(" + s + ',"basket",,,,"-")'), "-");
  assert.equal(f('=TEXTBEFORE("a-b","x",,,1)'), "a-b");
  assert.equal(f('=TEXTAFTER("a-b_c",{"_","-"})'), "b_c");
  assert.equal(f('=TEXTBEFORE("abc","b",0)'), "#VALUE!");
  assert.equal(f('=CLEAN(CHAR(9)&"x"&CHAR(10))'), "x");
  assert.equal(f('=UNICODE("α")'), 945);
  assert.equal(f("=UNICHAR(945)"), "α");
  assert.equal(f("=UNICHAR(0)"), "#VALUE!");
  near('=NUMBERVALUE("2.500,27",",",".")', 2500.27);
  near('=NUMBERVALUE("3.5%")', 0.035);
  assert.equal(f('=NUMBERVALUE("1.2.3")'), "#VALUE!");
  assert.equal(f("=FIXED(1234.567,1)"), "1,234.6");
  assert.equal(f("=FIXED(-1234.567,-1)"), "-1,230");
  assert.equal(f("=FIXED(44.332,2,TRUE)"), "44.33");
  assert.equal(f("=T(5)"), "");
  assert.equal(f('=T("x")'), "x");
  assert.equal(f("=N(TRUE)"), 1);
  assert.equal(f('=N("7")'), 0);
  assert.equal(f("=N(1/0)"), "#DIV/0!");
});

test("finance", () => {
  near("=IPMT(0.1/12,1,36,8000)", -66.6666667);
  near("=IPMT(0.1,3,3,8000)", -292.4471299);
  near("=PPMT(0.1/12,1,24,2000)", -75.62318601);
  near("=PPMT(0.08,10,10,200000)", -27598.05346);
  assert.equal(f("=IPMT(0.1,4,3,8000)"), "#NUM!");
  near("=CUMIPMT(0.09/12,360,125000,13,24,0)", -11135.23213);
  near("=CUMIPMT(0.09/12,360,125000,1,1,0)", -937.5);
  near("=CUMPRINC(0.09/12,360,125000,13,24,0)", -934.1071234);
  near("=CUMPRINC(0.09/12,360,125000,1,1,0)", -68.27827118);
  assert.equal(f("=CUMIPMT(0.09/12,360,125000,13,24,2)"), "#NUM!");
  near("=RATE(48,-200,8000)", 0.007701472);
  near("=RATE(48,-200,8000)*12", 0.09241767);
  near("=IRR({-70000,12000,15000,18000,21000,26000})", 0.086630948);
  near("=IRR({-70000,12000,15000,18000,21000})", -0.021244848);
  near("=IRR({-70000,12000,15000},-0.1)", -0.443506941);
  assert.equal(f("=IRR({1,2,3})"), "#NUM!");
  near("=MIRR({-120000,39000,30000,21000,37000,46000},0.1,0.12)", 0.126094);
  near("=XNPV(0.09,{-10000,2750,4250,3250,2750},{39448,39508,39751,39859,39904})", 2086.647602);
  near("=XIRR({-10000,2750,4250,3250,2750},{39448,39508,39751,39859,39904})", 0.373362535);
  assert.equal(f("=XIRR({-1,2},{5,1})"), "#NUM!");
  assert.equal(f("=SLN(30000,7500,10)"), 2250);
  near("=SYD(30000,7500,10,10)", 409.0909091);
  near("=DDB(2400,300,10*365,1)", 1.315068493);
  near("=DDB(2400,300,10*12,1,2)", 40);
  assert.equal(f("=DDB(2400,300,10,1,2)"), 480);
  near("=DDB(2400,300,10,10)", 22.1225472);
  near("=DB(1000000,100000,6,1,7)", 186083.3333);
  near("=DB(1000000,100000,6,2,7)", 259639.4167);
  near("=DB(1000000,100000,6,7,7)", 15845.09831);
  assert.equal(f("=DB(1000000,100000,6,8,7)"), "#NUM!");
  near("=EFFECT(0.0525,4)", 0.053542667);
  near("=NOMINAL(0.053543,4)", 0.05250032);
});

test("lookup, references and array constants", () => {
  Object.keys(cells).forEach((k) => delete cells[k]);
  put("s1", "A1", "1"); put("s1", "A2", "2"); put("s1", "A3", "3");
  put("s1", "B1", "10"); put("s1", "B2", "20"); put("s1", "B3", "30");
  put("s2", "A1", "x"); put("s2", "B1", "7");
  assert.equal(f("=XMATCH(4,{5,4,3})"), 2);
  assert.equal(f("=XMATCH(4.5,{5,4,3},1)"), 1);
  assert.equal(f("=XMATCH(4.5,{3,4,5},-1)"), 2);
  assert.equal(f('=XMATCH("b*",{"a","bc","bd"},2,-1)'), 3);
  assert.equal(f("=XMATCH(9,{1,2})"), "#N/A");
  assert.equal(f('=LOOKUP(4.19,{4.14,4.19,5.17},{"r","o","y"})'), "o");
  assert.equal(f('=LOOKUP(5,{1,2,3;"a","b","c"})'), "c");
  assert.equal(f("=LOOKUP(2.5,A1:A3,B1:B3)"), 20);
  assert.equal(f("=LOOKUP(0,A1:A3,B1:B3)"), "#N/A");
  assert.equal(f("=ADDRESS(2,3)"), "$C$2");
  assert.equal(f("=ADDRESS(2,3,2)"), "C$2");
  assert.equal(f("=ADDRESS(2,3,2,FALSE)"), "R2C[3]");
  assert.equal(f('=ADDRESS(2,3,1,FALSE,"[Book1]Sheet1")'), "'[Book1]Sheet1'!R2C3");
  assert.equal(f('=ADDRESS(2,3,1,TRUE,"My sheet")'), "'My sheet'!$C$2");
  assert.equal(f('=ADDRESS(2,3,4,TRUE,"Data")'), "Data!C2");
  assert.equal(f("=SUM(OFFSET(A1,1,0,2,2))"), 55);
  assert.equal(f("=OFFSET(A1,2,1)"), 30);
  assert.equal(f("=OFFSET(B3,-2,-1,-2)"), "#REF!");
  assert.equal(f("=ROWS(OFFSET(A1:B3,0,0,,1))"), 3);
  assert.equal(f("=OFFSET(A1,0,0,0)"), "#REF!");
  assert.equal(f('=INDIRECT("B2")'), 20);
  assert.equal(f('=SUM(INDIRECT("A1:"&"A3"))'), 6);
  assert.equal(f('=INDIRECT("Data!B1")'), 7);
  assert.equal(f('=ROW(INDIRECT("B3"))'), 3);
  assert.equal(f('=INDIRECT("nonsense")'), "#REF!");
  assert.equal(f('=INDIRECT("R1C1",FALSE)'), "#REF!");
  assert.equal(f('=INDIRECT("Nope!A1")'), "#REF!");
  assert.equal(f('=SUM(OFFSET(INDIRECT("A1"),0,1,3))'), 60);
  assert.equal(f("=SUM({1,2;3,4})"), 10);
  assert.equal(f("=INDEX({1,2;3,4},2,1)"), 3);
  assert.equal(f("=SUM({1,-2,+3})"), 2);
  assert.equal(f('=COUNTA({"a",TRUE,#N/A})'), 3);
  assert.equal(f("={1,2;3}"), "#ERROR!");
  assert.equal(f("={1,A1}"), "#ERROR!");
  assert.equal(f("={}"), "#ERROR!");
  assert.equal(f("=SUMPRODUCT({1,2,3},{4,5,6})"), 32);
  // braces are not references: copying a formula leaves them alone
  assert.equal(FX.shiftFormula("=SUM({1,2})+A1", 1, 1), "=SUM({1,2})+B2");
  Object.keys(cells).forEach((k) => delete cells[k]);
});

test("every function has a one-line help in English and Greek", () => {
  const missing = FX.names().filter((n) => !FX.HELP.en[n] || !FX.HELP.el[n]);
  assert.deepEqual(missing, []);
  assert.ok(FX.names().length >= 210);
});
