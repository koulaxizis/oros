// Pure logic of the Calculator (calculator/core.js): the expression
// parser (precedence, implicit multiplication, functions, angle
// units, decimal clean-up, formatting), units in expressions on
// the Unit Converter's engine, programmer BigInt maths, finance
// (VAT, percentages, loan, savings, CSV) and graph analysis; plus
// the wiring of the page (scripts, panes, help).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "calculator/core.js"));
const U = require(path.join(__dirname, "..", "units/core.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const ev = (s, env) => {
  const r = C.calc(s, Object.assign({ angle: "deg" }, env || {}));
  assert.ok(r.ok, `${s}: ${r.err} ${r.detail || ""}`);
  return C.formatNum(r.v);
};
const bad = (s, env) => {
  const r = C.calc(s, Object.assign({ angle: "deg" }, env || {}));
  assert.ok(!r.ok, `${s} should fail, gave ${r.v}`);
  return r.err;
};

test("precedence, associativity, unary minus, brackets", () => {
  assert.equal(ev("2+3*4"), "14");
  assert.equal(ev("(2+3)*4"), "20");
  assert.equal(ev("2^3^2"), "512");
  assert.equal(ev("-2^2"), "-4");
  assert.equal(ev("2^-1"), "0.5");
  assert.equal(ev("10-4-3"), "3");
  assert.equal(ev("100/10/5"), "2");
  assert.equal(ev("2*-3"), "-6");
  assert.equal(ev("((1+2)*(3+4))"), "21");
  assert.equal(ev("(1+2"), "3", "a missing ) at the end is closed");
  assert.equal(ev("7 mod 3"), "1");
  assert.equal(ev("-7 mod 3"), "2", "floored modulo");
  assert.equal(ev("2**10"), "1024");
  assert.equal(ev("6÷3×2−1"), "3", "display glyphs");
});

test("implicit multiplication", () => {
  assert.equal(ev("2π"), C.formatNum(2 * Math.PI));
  assert.equal(ev("3(4+1)"), "15");
  assert.equal(ev("(1+2)(3+4)"), "21");
  assert.equal(ev("(1+2)3"), "9");
  assert.equal(ev("2sqrt(9)"), "6");
  assert.equal(ev("2e"), C.formatNum(2 * Math.E));
  assert.equal(bad("2 3"), "syntax", "two numbers side by side are a typo");
  assert.equal(ev("2x", { allowX: true, x: 4 }), "8");
  assert.equal(ev("2pix", { allowX: true, x: 1, angle: "rad" }), C.formatNum(2 * Math.PI));
  assert.equal(ev("sinx", { allowX: true, x: 90 }), "1");
});

test("numbers: decimals, comma, groups, exponent, Ans, constants", () => {
  assert.equal(ev("0.1+0.2"), "0.3");
  assert.equal(ev("0.1+0.2-0.3"), "0");
  assert.equal(ev("1.1*3"), "3.3");
  assert.equal(ev("0.3/0.1"), "3");
  assert.equal(ev("floor(0.3/0.1)"), "3");
  assert.equal(ev("3,5+1"), "4.5", "comma as decimal mark");
  assert.equal(ev("1 000 × 2"), "2000", "the standard mode's grouped history");
  assert.equal(ev("1.5E3"), "1500");
  assert.equal(ev("2e3"), "2000");
  assert.equal(ev("1e-3"), "0.001");
  assert.equal(ev("Ans*2", { ans: 21 }), "42");
  assert.equal(ev("ans"), "0", "no answer yet counts as 0");
  assert.equal(ev("pi"), C.formatNum(Math.PI));
  assert.equal(ev("e"), C.formatNum(Math.E));
  const r = C.calc("rand", { rand: () => 0.25 });
  assert.equal(r.v, 0.25);
  assert.equal(C.calc("rand()", { rand: () => 0.5 }).v, 0.5);
});

test("functions and angle units", () => {
  assert.equal(ev("sin(30)"), "0.5");
  assert.equal(ev("sin 30"), "0.5");
  assert.equal(ev("cos(90)"), "0");
  assert.equal(ev("sin(180)"), "0");
  assert.equal(bad("tan(90)"), "domain");
  assert.equal(ev("asin(1)"), "90");
  assert.equal(ev("acos(0)", { angle: "grad" }), "100");
  assert.equal(ev("sin(pi)", { angle: "rad" }), "0");
  assert.equal(bad("tan(pi/2)", { angle: "rad" }), "domain");
  assert.equal(ev("sin(100)", { angle: "grad" }), "1");
  assert.equal(ev("atan(1)", { angle: "rad" }), C.formatNum(Math.PI / 4));
  assert.equal(ev("sinh(0)+cosh(0)+tanh(0)"), "1");
  assert.equal(ev("asinh(sinh(2))"), "2");
  assert.equal(ev("log(1000)"), "3");
  assert.equal(ev("log(8;2)"), "3");
  assert.equal(ev("ln(e)"), "1");
  assert.equal(ev("log2(1024)"), "10");
  assert.equal(ev("√16"), "4");
  assert.equal(ev("√(16)+∛27"), "7");
  assert.equal(ev("∛-8"), "-2");
  assert.equal(ev("root(32;5)"), "2");
  assert.equal(ev("root(-27;3)"), "-3");
  assert.equal(ev("3²+2³"), "17");
  assert.equal(ev("5!"), "120");
  assert.equal(ev("0!"), "1");
  assert.ok(Math.abs(C.calc("0.5!").v - Math.sqrt(Math.PI) / 2) < 1e-13);
  assert.equal(ev("abs(-3)+floor(2.7)+ceil(2.1)"), "8");
  assert.equal(ev("ncr(5;2)+npr(5;2)"), "30");
  assert.equal(ev("exp(0)"), "1");
  assert.equal(ev("(-8)^(1/3)"), "-2");
});

test("percent: of a number, and phone-style after + or −", () => {
  assert.equal(ev("50%"), "0.5");
  assert.equal(ev("200+10%"), "220");
  assert.equal(ev("200-10%"), "180");
  assert.equal(ev("200*10%"), "20");
});

test("errors carry a code", () => {
  assert.equal(bad("1/0"), "div0");
  assert.equal(bad("sqrt(-1)"), "domain");
  assert.equal(bad("ln(0)"), "domain");
  assert.equal(bad("asin(2)"), "domain");
  assert.equal(bad("(-1)!"), "domain");
  assert.equal(bad("171!"), "big");
  assert.equal(bad("1e400"), "big");
  assert.equal(bad("10^400"), "big");
  assert.equal(bad("foo"), "name");
  assert.equal(bad("x+1"), "name", "x only in the graph");
  assert.equal(bad("1+"), "end");
  assert.equal(bad("sin("), "end");
  assert.equal(bad("1+2)"), "paren");
  assert.equal(bad("root(8)"), "args");
  assert.equal(bad("2 # 3"), "char");
  assert.equal(bad(""), "empty");
  assert.equal(C.calc("foo").detail, "foo");
});

test("no eval: the source never reaches Function or eval", () => {
  const src = read("calculator/core.js");
  assert.ok(!/\beval\s*\(/.test(src));
  assert.ok(!/new Function|Function\s*\(/.test(src));
  assert.equal(bad("constructor"), "name");
  assert.equal(bad("__proto__"), "name");
});

test("formatNum: 15 digits, no noise, exponent for extremes", () => {
  assert.equal(C.formatNum(0.1 + 0.2), "0.3");
  assert.equal(C.formatNum(1 / 3), "0.333333333333333");
  assert.equal(C.formatNum(-0), "0");
  assert.equal(C.formatNum(1e-7), "0.0000001");
  assert.equal(C.formatNum(1.5e20), "1.5e20");
  assert.equal(C.formatNum(-2.5e-12), "-2.5e-12");
  assert.equal(C.formatNum(123456789012345678), "1.23456789012346e17");
  assert.equal(C.formatNum(Infinity), null);
  // what is shown can be typed back
  [1 / 3, 1.5e20, -2.5e-12, 1e-7, 12345.678].forEach((v) => {
    const r = C.calc(C.formatNum(v));
    assert.ok(r.ok && Math.abs(r.v - v) <= Math.abs(v) * 1e-14, String(v));
  });
});

test("units in expressions reuse the Unit Converter engine", () => {
  const rates = { base: "EUR", date: "2026-10-09", at: 1, src: "", rates: { USD: 1.1 } };
  const conv = (s, o) => C.unitConvert(s, U, Object.assign({ rates }, o || {}));
  let r = conv("3 ft to cm");
  assert.ok(r.ok); assert.equal(C.formatNum(r.v), "91.44"); assert.equal(r.sym, "cm");
  r = conv("100 km/h in m/s");
  assert.equal(C.formatNum(r.v), C.formatNum(100 / 3.6)); assert.equal(r.cat, "speed");
  r = conv("20 EUR to USD");
  assert.equal(C.formatNum(r.v), "22"); assert.equal(r.cat, "currency");
  assert.equal(C.formatNum(conv("5 in to cm").v), "12.7", "'in' is a join word and a unit");
  assert.equal(C.formatNum(conv("3ft to cm").v), "91.44");
  assert.equal(C.formatNum(conv("2*3 ft σε in").v), "72");
  assert.equal(C.formatNum(conv("ft → m").v), "0.3048", "no number means 1");
  assert.equal(C.formatNum(conv("100 C to F").v), "212");
  assert.equal(C.formatNum(conv("Ans km to mi", { env: { ans: 1.609344 } }).v), "1");
  assert.equal(conv("1 kg to m").err, "units_mismatch");
  assert.equal(conv("1 cup to g").err, "dens");
  assert.equal(conv("-5 K to C").err, "unit_belowZero");
  assert.equal(conv("-5 kg to lb").err, "unit_neg");
  assert.equal(C.unitConvert("20 EUR to USD", U, { rates: null }).err, "rates");
  assert.equal(conv("2+2"), null, "not a conversion");
  assert.equal(conv("sin(30)"), null);
  // the Calculator reads the Unit Converter's tables; it holds none of its own
  const src = read("calculator/core.js");
  assert.ok(!/0\.3048|1609\.344|0\.45359237/.test(src), "no copied unit factors");
});

test("programmer: bases, word sizes, bitwise operators", () => {
  const P = (s, base, bits) => { const r = C.progEval(s, base, bits); assert.ok(r.ok, `${s}: ${r.err}`); return r.v; };
  assert.equal(P("FF AND 0F", 16, 64), 15n);
  assert.equal(P("ff or 100", 16, 64), 0x1ffn);
  assert.equal(P("5 XOR 3", 10, 32), 6n);
  assert.equal(P("NOT 0", 10, 8), -1n);
  assert.equal(P("7 NAND 3", 10, 8), -4n);
  assert.equal(P("1 NOR 2", 10, 8), -4n);
  assert.equal(P("1 << 4 + 1", 10, 32), 32n, "+ binds tighter than <<");
  assert.equal(P("1 lsh 63", 10, 64), -(2n ** 63n));
  assert.equal(P("-128 >> 1", 10, 8), -64n, "arithmetic shift");
  assert.equal(P("255 + 1", 10, 8), 0n, "wraps at the word size");
  assert.equal(P("10 / 3", 10, 32), 3n);
  assert.equal(P("10 mod 3", 10, 32), 1n);
  assert.equal(P("0x10 + 0b11 + 0o7", 10, 32), 26n);
  assert.equal(P("(1+2)*3", 10, 16), 9n);
  assert.equal(C.progEval("5/0", 10, 32).err, "div0");
  assert.equal(C.progEval("G", 16, 8).err, "digit");
  assert.equal(C.progEval("8", 8, 8).err, "digit");
  assert.equal(C.progEval("2", 2, 8).err, "digit");
  assert.equal(C.progFormat(-1n, 16, 16), "FFFF");
  assert.equal(C.progFormat(-1n, 10, 16), "-1");
  assert.equal(C.progFormat(255n, 2, 8), "11111111");
  assert.equal(C.progFormat(-113n, 8, 8), "217");
  assert.equal(C.progGroup("11111111", 2), "1111 1111");
  assert.equal(C.progGroup("1234567", 10), "1 234 567");
  assert.equal(C.progGroup("-1234", 10), "-1 234");
  assert.equal(C.progToggleBit(15n, 7, 8), -113n);
  assert.equal(C.progBit(-1n, 63), true);
  assert.equal(C.progBit(2n, 0), false);
});

test("finance: numbers, VAT, percentages", () => {
  assert.equal(C.parseNum("1.234,56"), 1234.56);
  assert.equal(C.parseNum("1,234.56"), 1234.56);
  assert.equal(C.parseNum("12,5"), 12.5);
  assert.equal(C.parseNum(" 24 % "), 24);
  assert.ok(isNaN(C.parseNum("abc")));
  assert.ok(isNaN(C.parseNum("")));
  assert.deepEqual(C.vat(100, 24, "add"), { net: 100, vat: 24, gross: 124 });
  assert.deepEqual(C.vat(124, 24, "remove"), { net: 100, vat: 24, gross: 124 });
  assert.deepEqual(C.vat(10, 13, "add"), { net: 10, vat: 1.3, gross: 11.3 });
  assert.deepEqual(C.vat(10.6, 6, "remove"), { net: 10, vat: 0.6, gross: 10.6 });
  assert.equal(C.vat(100, -1, "add"), null);
  assert.deepEqual(C.pctChange(80, 100), { diff: 20, pct: 25 });
  assert.deepEqual(C.pctChange(100, 80), { diff: -20, pct: -20 });
  assert.equal(C.pctChange(0, 5).pct, null);
  assert.equal(C.pctOf(15, 80), 12);
  assert.equal(C.whatPct(30, 120), 25);
  assert.equal(C.whatPct(1, 0), null);
});

test("finance: loan amortisation and savings", () => {
  const L = C.loan(10000, 6, 12);
  assert.equal(L.payment, 860.66);
  assert.equal(L.rows.length, 12);
  assert.equal(L.rows[0].interest, 50);
  assert.equal(L.rows[11].balance, 0);
  const sumP = L.rows.reduce((a, r) => a + r.principal, 0);
  assert.ok(Math.abs(sumP - 10000) < 0.005, "principal repaid exactly");
  assert.equal(L.total, Math.round((L.interest + 10000) * 100) / 100);
  assert.equal(C.loan(1200, 0, 12).payment, 100);
  assert.equal(C.loan(0, 5, 12), null);
  assert.equal(C.loan(1000, 5, 12.5), null);
  const S = C.savings(1000, 100, 5, 10, "m");
  assert.equal(S.deposits, 13000);
  assert.equal(S.final, 17175.24);
  assert.equal(S.rows.length, 10);
  assert.equal(C.savings(1000, 0, 10, 2, "y").final, 1210);
  assert.equal(C.savings(0, 100, 0, 1, "m").final, 1200);
  assert.equal(C.savings(1000, 0, 5, 0, "m"), null);
  const csv = C.toCsv(["Month", "Note"], [[1, "a,b"], [2, '"q"'], [3, "=cmd"]]);
  assert.equal(csv, 'Month,Note\r\n1,"a,b"\r\n2,"""q"""\r\n3,\'=cmd');
});

test("graph helpers: grid steps, roots, extrema, poles, intersections", () => {
  assert.equal(C.niceStep(10, 8), 1);
  assert.equal(C.niceStep(0.37, 8), 0.05);
  assert.equal(C.niceStep(2000, 8), 200);
  let a = C.analyse(C.compile("x^2-2"), -5, 5, 400);
  assert.equal(a.roots.length, 2);
  assert.ok(Math.abs(a.roots[1] - Math.SQRT2) < 1e-12);
  assert.deepEqual(a.mins, [{ x: 0, y: -2 }]);
  a = C.analyse(C.compile("x^3-3x"), -5, 5, 400);
  assert.deepEqual(a.maxs, [{ x: -1, y: 2 }]);
  assert.deepEqual(a.mins, [{ x: 1, y: -2 }]);
  a = C.analyse(C.compile("1/x"), -5, 5, 400);
  assert.equal(a.roots.length, 0, "a pole is not a root");
  a = C.analyse(C.compile("tan(x)"), -5, 5, 400);
  assert.equal(a.roots.length, 3);
  assert.equal(a.mins.length + a.maxs.length, 0, "poles are not turning points");
  a = C.analyse(C.compile("sqrt(x)"), -5, 5, 400);
  assert.deepEqual(a.roots, [0]);
  const xs = C.intersections(C.compile("x"), C.compile("x^2"), -3, 3, 400).map((p) => p.x);
  assert.deepEqual(xs, [0, 1]);
  const deg = C.compile("sin(x)", { angle: "deg" });
  assert.equal(deg(90), 1);
  assert.ok(isNaN(C.compile("sqrt(x)")(-1)), "out of domain plots nothing");
  assert.throws(() => C.compile("x+"), (e) => e.calc === "end");
});

test("page wiring: scripts, panes, palette, help", () => {
  const html = read("calculator/index.html");
  const iU = html.indexOf("../units/core.js"), iC = html.indexOf('src="core.js'), iA = html.indexOf("calculator.js");
  assert.ok(iU > 0 && iC > iU && iA > iC, "units core, then calculator core, then the app");
  ["sci", "graph", "prog", "fin", "calc-modes", "sci-in", "graph-cv", "prog-bits", "ln-table"].forEach((id) =>
    assert.ok(html.includes(`id="${id}"`), id));
  const js = read("calculator/calculator.js");
  assert.ok(/function inheritPalette/.test(js) && /function watchPalette/.test(js), "palette contract kept");
  assert.ok(/registerSlice\("calculator", sliceGet, sliceSet, LS_KEY, mergeCalc\)/.test(js), "slice unchanged");
  assert.ok(!/innerHTML\s*=(?!\s*"";)/.test(js), "no innerHTML with data");
  // every key used in EN exists in EL
  const keys = (lng) => {
    const m = js.indexOf(lng + ": {"), body = js.slice(m, js.indexOf("\n    }", m));
    return new Set([...body.matchAll(/"(calc\.[a-z0-9_.]+)"\s*:/gi)].map((x) => x[1]));
  };
  const en = keys("en"), el = keys("el");
  en.forEach((k) => assert.ok(el.has(k), "EL misses " + k));
  for (const f of ["calculator/help.en.txt", "calculator/help.el.txt"]) {
    const h = read(f);
    assert.ok(!/no brackets|δεν έχει παρενθέσεις|χωρίς παρενθέσεις/i.test(h), f + ": the no-brackets limit is gone");
  }
});
