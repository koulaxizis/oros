// ============================================================
// calculator/core.js — orOS Calculator, pure logic (no DOM)
// i18n-inline-ok: math symbols (π τ φ) and the Greek function names ημ συν εφ the parser accepts (data, no UI text)
//   1. Expression engine (scientific + graphing): own tokenizer
//      and recursive-descent parser (no eval / Function),
//      operator precedence, implicit multiplication, functions,
//      deg / rad / grad, decimal clean-up, number formatting.
//   2. Units in expressions ("3 ft to cm") on top of the Unit
//      Converter's own engine (units/core.js, UnitsCore): its
//      tables, aliases and convert() are reused, never copied.
//   3. Programmer: BigInt expressions in HEX / DEC / OCT / BIN
//      with a word size of 8 / 16 / 32 / 64 bits.
//   4. Finance: VAT, percentage change, loan amortisation,
//      compound savings, CSV.
//   5. Graph helpers: grid steps, roots, extrema, intersections.
//   6. Troll mode quips: picks the line that goes with a result;
//      the result itself is never touched.
// UMD: module.exports in Node (tests), window.CalcCore in a browser.
// ============================================================
(function (root) {
  "use strict";

  function err(code, extra) {
    var e = new Error(code);
    e.calc = code;
    if (extra) e.detail = extra;
    return e;
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  // 15 significant digits: hides binary noise (0.1 + 0.2, 0.3 / 0.1).
  function clean(v) {
    if (!isNum(v) || v === 0) return v;
    return Number(v.toPrecision(15));
  }

  // a ± b rounded to the precision of the larger operand, so a
  // cancellation leaves no residue: 0.1 + 0.2 - 0.3 = 0, not 5.6e-17.
  function addR(a, b) {
    var r = a + b;
    if (!isNum(r)) return r;
    var scale = Math.max(Math.abs(a), Math.abs(b));
    if (scale === 0 || r === 0) return r;
    var mag = Math.floor(Math.log(scale) / Math.LN10);
    var digits = 14 - mag;
    if (digits <= 0) return clean(r);
    if (digits > 100) return r;
    var s = r.toFixed(digits);
    var out = Number(s);
    return out === 0 ? 0 : clean(out);
  }

  // ---------- 1. Expression engine ----------
  var FN1 = {
    sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1,
    sinh: 1, cosh: 1, tanh: 1, asinh: 1, acosh: 1, atanh: 1,
    ln: 1, log2: 1, log10: 1, exp: 1, sqrt: 1, cbrt: 1,
    abs: 1, floor: 1, ceil: 1, round: 1, trunc: 1, sign: 1, fact: 1
  };
  var FN2 = { root: 1, ncr: 1, npr: 1, mod: 1, max: 1, min: 1 };
  var FNV = { log: [1, 2] };            // variable arity
  var ALIAS = {
    "arcsin": "asin", "arccos": "acos", "arctan": "atan",
    "sqr": "sqrt", "lg": "log10", "ld": "log2", "lb": "log2",
    "pi": "pi", "π": "pi", "random": "rand", "abs": "abs",
    "ημ": "sin", "συν": "cos", "εφ": "tan"
  };
  var CONST = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2 };

  function isFnName(n) { return FN1[n] || FN2[n] || FNV[n]; }
  function knownName(n, allowX) {
    if (ALIAS[n]) n = ALIAS[n];
    if (isFnName(n) || CONST[n] !== undefined || n === "ans" || n === "rand") return n;
    if (allowX && n === "x") return n;
    return null;
  }

  // Characters normalised before tokenizing.
  var CHAR_MAP = {
    "−": "-", "–": "-", "×": "*", "·": "*", "∙": "*", "⋅": "*", "÷": "/", "∶": "/",
    "π": " pi ", "τ": " tau ", "φ": " phi ", "（": "(", "）": ")", "⁻": "-"
  };

  // src → tokens [{ t: "num"|"id"|"op", v, p }]
  function tokenize(src, allowX) {
    var s = String(src == null ? "" : src);
    var out = [];
    var i = 0, n = s.length;
    function push(t, v, p) { out.push({ t: t, v: v, p: p }); }
    while (i < n) {
      var c = s.charAt(i);
      if (CHAR_MAP[c] !== undefined) {
        var rep = CHAR_MAP[c];
        if (rep.trim() === "pi" || rep.trim() === "tau" || rep.trim() === "phi") { push("id", rep.trim(), i); i++; continue; }
        c = rep;
      }
      if (/\s/.test(c) || c === " " || c === " ") { i++; continue; }
      // number: digits with "." or "," as the decimal mark; groups of
      // three after a space or a thin space ("1 000"); exponent E.
      if (/[0-9]/.test(c) || ((c === "." || c === ",") && /[0-9]/.test(s.charAt(i + 1)))) {
        var st = i, txt = "", dot = false;
        while (i < n) {
          var d = s.charAt(i);
          if (/[0-9]/.test(d)) { txt += d; i++; continue; }
          if ((d === "." || d === ",") && !dot && /[0-9]/.test(s.charAt(i + 1) || "") ) { txt += "."; dot = true; i++; continue; }
          if ((d === "." || d === ",") && !dot && txt) { txt += "."; dot = true; i++; continue; }
          if (!dot && (d === " " || d === "\u2009" || d === "\u202f") &&
              /^[0-9]{1,3}(_[0-9]{3})*$/.test(txt) && /^[0-9]{3}(?![0-9])/.test(s.slice(i + 1))) {
            txt += "_"; i++; continue;           // "1 000": a thousands group
          }
          break;
        }
        // exponent
        var m = /^[eE]([+\-]?)([0-9]+)/.exec(s.slice(i));
        if (m && !(m[1] === "" && /[a-zA-Z]/.test(s.charAt(i + 1 + m[2].length) || ""))) {
          txt += "e" + m[1] + m[2];
          i += m[0].length;
        }
        var v = Number(txt.replace(/_/g, ""));
        if (!isFinite(v)) throw err("big");
        push("num", v, st);
        continue;
      }
      if (/[A-Za-z_Ͱ-Ͽ]/.test(c)) {
        var st2 = i, w = "";
        while (i < n && /[A-Za-z0-9_Ͱ-Ͽ]/.test(s.charAt(i))) { w += s.charAt(i); i++; }
        var lw = w.toLowerCase();
        if (lw === "mod") { push("op", "mod", st2); continue; }
        var k = knownName(lw, allowX);
        if (k) { push("id", k, st2); continue; }
        // Unknown word: split it into known names ("2pix", "sinx").
        var parts = splitName(lw, allowX);
        if (!parts) throw err("name", w);
        parts.forEach(function (pn) { push(pn === "mod" ? "op" : "id", pn, st2); });
        continue;
      }
      if (c === "*" && s.charAt(i + 1) === "*") { push("op", "^", i); i += 2; continue; }
      if (c === "√") { push("op", "√", i); i++; continue; }
      if (c === "∛") { push("op", "∛", i); i++; continue; }
      if (c === "²") { push("op", "²", i); i++; continue; }
      if (c === "³") { push("op", "³", i); i++; continue; }
      if ("+-*/^()!%;".indexOf(c) >= 0) { push("op", c, i); i++; continue; }
      if (c === "|") throw err("syntax", i);
      throw err("char", c);
    }
    return out;
  }

  // Longest-known-name split; null when a piece is unknown.
  function splitName(w, allowX) {
    var names = ["asinh", "acosh", "atanh", "arcsin", "arccos", "arctan", "log10", "log2", "floor", "trunc", "round",
                 "sinh", "cosh", "tanh", "asin", "acos", "atan", "sqrt", "cbrt", "ceil", "sign", "fact", "rand", "root",
                 "sin", "cos", "tan", "exp", "abs", "log", "ans", "mod", "ncr", "npr", "max", "min", "tau", "phi",
                 "ln", "pi", "e"];
    if (allowX) names.push("x");
    var out = [], i = 0;
    while (i < w.length) {
      var hit = null;
      for (var k = 0; k < names.length; k++) {
        if (w.indexOf(names[k], i) === i && (!hit || names[k].length > hit.length)) hit = names[k];
      }
      if (!hit) return null;
      out.push(ALIAS[hit] || hit);
      i += hit.length;
    }
    return out;
  }

  // Recursive-descent parser → AST.
  //   sum    := term (("+"|"-") term)*      a + b% = a·(1 + b/100)
  //   term   := unary (("*"|"/"|"mod"|implicit) unary)*
  //   unary  := ("-"|"+") unary | power
  //   power  := postfix ("^" unary)?        right-associative; -2^2 = -4
  //   postfix:= primary ("!"|"%"|"²"|"³")*
  //   primary:= number | name | fn "(" args ")" | fn operand | "(" sum ")" | √ / ∛ operand
  function parse(src, opts) {
    opts = opts || {};
    var toks = tokenize(src, !!opts.allowX);
    if (!toks.length) throw err("empty");
    var pos = 0;
    function peek() { return toks[pos]; }
    function isOp(v) { var tk = toks[pos]; return tk && tk.t === "op" && tk.v === v; }
    function next() { return toks[pos++]; }

    function sum() {
      var left = term();
      while (isOp("+") || isOp("-")) {
        var op = next().v;
        var right = term();
        if (right.k === "pct") left = { k: "pctadd", op: op, a: left, b: right.a };
        else left = { k: "bin", op: op, a: left, b: right };
      }
      return left;
    }
    function startsPrimary(tk) {
      if (!tk) return false;
      if (tk.t === "id" || tk.t === "num") return true;
      return tk.t === "op" && (tk.v === "(" || tk.v === "√" || tk.v === "∛");
    }
    function term() {
      var left = unary();
      for (;;) {
        if (isOp("*") || isOp("/") || isOp("mod")) {
          var op = next().v;
          left = { k: "bin", op: op, a: left, b: unary() };
          continue;
        }
        var tk = peek();
        if (startsPrimary(tk)) {
          var prev = toks[pos - 1];
          // "2 3" is a typo, not 6; "(1+2)3" and "2π" multiply.
          if (tk.t === "num" && !(prev.t === "op" && (prev.v === ")" || prev.v === "!" || prev.v === "²" || prev.v === "³" || prev.v === "%"))) {
            throw err("syntax", tk.p);
          }
          left = { k: "bin", op: "*", a: left, b: power() };
          continue;
        }
        return left;
      }
    }
    function unary() {
      if (isOp("-")) { next(); return { k: "neg", a: unary() }; }
      if (isOp("+")) { next(); return unary(); }
      return power();
    }
    function power() {
      var base = postfix();
      if (isOp("^")) { next(); return { k: "bin", op: "^", a: base, b: unary() }; }
      return base;
    }
    function postfix() {
      var node = primary();
      for (;;) {
        if (isOp("!")) { next(); node = { k: "fn", f: "fact", args: [node] }; continue; }
        if (isOp("%")) { next(); node = { k: "pct", a: node }; continue; }
        if (isOp("²")) { next(); node = { k: "bin", op: "^", a: node, b: { k: "num", v: 2 } }; continue; }
        if (isOp("³")) { next(); node = { k: "bin", op: "^", a: node, b: { k: "num", v: 3 } }; continue; }
        return node;
      }
    }
    function operand() {
      // fn without brackets: "sin 30", "√2", "sin -30"
      if (isOp("-")) { next(); return { k: "neg", a: operand() }; }
      return power();
    }
    function primary() {
      var tk = next();
      if (!tk) throw err("end");
      if (tk.t === "num") return { k: "num", v: tk.v };
      if (tk.t === "op") {
        if (tk.v === "(") {
          var e = sum();
          if (isOp(")")) next();
          else if (pos < toks.length) throw err("paren", toks[pos].p);
          return e;                     // a missing ")" at the end is closed for you
        }
        if (tk.v === "√") return { k: "fn", f: "sqrt", args: [operand()] };
        if (tk.v === "∛") return { k: "fn", f: "cbrt", args: [operand()] };
        if (tk.v === ")") throw err("paren", tk.p);
        throw err("syntax", tk.p);
      }
      var name = tk.v;
      if (CONST[name] !== undefined) return { k: "num", v: CONST[name], c: name };
      if (name === "ans") return { k: "ans" };
      if (name === "x") return { k: "x" };
      if (name === "rand") {
        if (isOp("(") && toks[pos + 1] && toks[pos + 1].t === "op" && toks[pos + 1].v === ")") pos += 2;
        return { k: "rand" };
      }
      // function
      var args = [];
      if (isOp("(")) {
        next();
        if (isOp(")")) { next(); }
        else {
          args.push(sum());
          while (isOp(";")) { next(); args.push(sum()); }
          if (isOp(")")) next();
          else if (pos < toks.length) throw err("paren", toks[pos].p);
        }
      } else {
        if (pos >= toks.length) throw err("end");
        args.push(operand());
      }
      var ar = FN1[name] ? [1, 1] : FN2[name] ? [2, 2] : FNV[name];
      if (args.length < ar[0] || args.length > ar[1]) throw err("args", name);
      return { k: "fn", f: name, args: args };
    }

    var ast = sum();
    if (pos < toks.length) {
      var tk = toks[pos];
      throw err(tk.t === "op" && tk.v === ")" ? "paren" : "syntax", tk.p);
    }
    return ast;
  }

  var ANG = { deg: Math.PI / 180, rad: 1, grad: Math.PI / 200 };
  var ANG_FULL = { deg: 360, rad: 2 * Math.PI, grad: 400 };

  function factorial(n) {
    n = clean(n);
    if (n < 0 && n === Math.floor(n)) throw err("domain");
    if (n === Math.floor(n)) {
      if (n > 170) throw err("big");
      var r = 1;
      for (var i = 2; i <= n; i++) r *= i;
      return r;
    }
    return gamma(n + 1);
  }
  // Lanczos approximation (g = 7, n = 9), reflection for x < 0.5.
  var LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
            -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
            1.5056327351493116e-7];
  function gamma(x) {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    x -= 1;
    var a = LG[0], t = x + 7.5;
    for (var i = 1; i < 9; i++) a += LG[i] / (x + i);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
  }

  function trig(f, v, angle) {
    var unit = ANG[angle] || 1;
    if (angle !== "rad") {
      // exact zeros at the multiples of 90° (100 grad)
      var full = ANG_FULL[angle], q = full / 4;
      var red = ((clean(v) % full) + full) % full;
      if (red % q === 0) {
        var k = red / q;   // 0..3
        if (f === "sin") return [0, 1, 0, -1][k];
        if (f === "cos") return [1, 0, -1, 0][k];
        if (f === "tan") { if (k % 2) throw err("domain"); return 0; }
      }
    }
    var x = v * unit, r;
    if (f === "sin") r = Math.sin(x);
    else if (f === "cos") r = Math.cos(x);
    else {
      if (Math.abs(Math.cos(x)) < 1e-15) throw err("domain");
      r = Math.tan(x);
    }
    if (Math.abs(r) < 1e-15) r = 0;
    return r;
  }

  function ncr(n, r) {
    n = clean(n); r = clean(r);
    if (n !== Math.floor(n) || r !== Math.floor(r) || n < 0 || r < 0) throw err("domain");
    if (r > n) return 0;
    if (r > n - r) r = n - r;
    var out = 1;
    for (var i = 1; i <= r; i++) out = out * (n - r + i) / i;
    return Math.round(out);
  }
  function npr(n, r) {
    n = clean(n); r = clean(r);
    if (n !== Math.floor(n) || r !== Math.floor(r) || n < 0 || r < 0) throw err("domain");
    if (r > n) return 0;
    var out = 1;
    for (var i = 0; i < r; i++) out *= (n - i);
    return out;
  }

  function nthRoot(x, n) {
    n = clean(n);
    if (n === 0) throw err("domain");
    if (x < 0) {
      if (n === Math.floor(n) && Math.abs(n) % 2 === 1) return -Math.pow(-x, 1 / n);
      throw err("domain");
    }
    var r = Math.pow(x, 1 / n);
    var rr = Math.round(r);
    if (rr !== 0 && Math.abs(Math.pow(rr, n) - x) <= Math.abs(x) * 1e-15) return rr;   // ⁵√32 = 2, not 2.0000000000000004
    return r;
  }

  function fmod(a, b) {
    a = clean(a); b = clean(b);
    if (b === 0) throw err("div0");
    var r = a - b * Math.floor(a / b);
    return clean(r);
  }

  function powR(a, b) {
    if (a < 0 && b !== Math.floor(b)) {
      // (-8)^(1/3): an odd root of a negative number is real
      var inv = 1 / b, ri = Math.round(inv);
      if (Math.abs(inv - ri) < 1e-9 && Math.abs(ri) % 2 === 1) return -Math.pow(-a, b);
      throw err("domain");
    }
    if (a === 0 && b < 0) throw err("div0");
    return Math.pow(a, b);
  }

  function callFn(f, a, env) {
    var angle = env.angle || "rad";
    var x = a[0];
    switch (f) {
      case "sin": case "cos": case "tan": return trig(f, x, angle);
      case "asin": case "acos":
        if (x < -1 || x > 1) throw err("domain");
        return (f === "asin" ? Math.asin(x) : Math.acos(x)) / (ANG[angle] || 1);
      case "atan": return Math.atan(x) / (ANG[angle] || 1);
      case "sinh": return Math.sinh(x);
      case "cosh": return Math.cosh(x);
      case "tanh": return Math.tanh(x);
      case "asinh": return Math.asinh(x);
      case "acosh": if (x < 1) throw err("domain"); return Math.acosh(x);
      case "atanh": if (x <= -1 || x >= 1) throw err("domain"); return Math.atanh(x);
      case "ln": if (x <= 0) throw err("domain"); return Math.log(x);
      case "log10": if (x <= 0) throw err("domain"); return exact10(x);
      case "log":
        if (x <= 0) throw err("domain");
        if (a.length === 1) return exact10(x);
        if (a[1] <= 0 || a[1] === 1) throw err("domain");
        return clean(Math.log(x) / Math.log(a[1]));
      case "log2": if (x <= 0) throw err("domain"); return Math.log2(x);
      case "exp": return Math.exp(x);
      case "sqrt": if (x < 0) throw err("domain"); return Math.sqrt(x);
      case "cbrt": return Math.cbrt(x);
      case "root": return nthRoot(x, a[1]);
      case "abs": return Math.abs(x);
      case "floor": return Math.floor(clean(x));
      case "ceil": return Math.ceil(clean(x));
      case "round": return Math.round(clean(x));
      case "trunc": return Math.trunc(clean(x));
      case "sign": return Math.sign(x);
      case "fact": return factorial(x);
      case "ncr": return ncr(x, a[1]);
      case "npr": return npr(x, a[1]);
      case "mod": return fmod(x, a[1]);
      case "max": return Math.max(x, a[1]);
      case "min": return Math.min(x, a[1]);
    }
    throw err("name", f);
  }
  function exact10(x) {
    var r = Math.log10(x), rr = Math.round(r);
    return Math.abs(r - rr) < 1e-14 ? rr : r;
  }

  function evaluate(node, env) {
    env = env || {};
    switch (node.k) {
      case "num": return node.v;
      case "ans": return isNum(env.ans) ? env.ans : 0;
      case "x": return isNum(env.x) ? env.x : NaN;
      case "rand": return (env.rand || Math.random)();
      case "neg": return -evaluate(node.a, env);
      case "pct": return evaluate(node.a, env) / 100;
      case "pctadd": {
        var base = evaluate(node.a, env), p = evaluate(node.b, env);
        var delta = clean(base * p / 100);
        return node.op === "+" ? addR(base, delta) : addR(base, -delta);
      }
      case "fn": {
        var args = node.args.map(function (n) { return evaluate(n, env); });
        return callFn(node.f, args, env);
      }
      case "bin": {
        var a = evaluate(node.a, env), b = evaluate(node.b, env);
        switch (node.op) {
          case "+": return addR(a, b);
          case "-": return addR(a, -b);
          case "*": return a * b;
          case "/": if (b === 0) throw err("div0"); return a / b;
          case "mod": return fmod(a, b);
          case "^": return powR(a, b);
        }
      }
    }
    throw err("syntax");
  }

  // One-shot: { ok: true, v } or { ok: false, err: code, detail }
  function calc(src, env) {
    env = env || {};
    try {
      var ast = parse(src, { allowX: !!env.allowX });
      var v = evaluate(ast, env);
      if (typeof v !== "number" || isNaN(v)) return { ok: false, err: "domain" };
      if (!isFinite(v)) return { ok: false, err: "big" };
      return { ok: true, v: v === 0 ? 0 : v };
    } catch (e) {
      if (e && e.calc) return { ok: false, err: e.calc, detail: e.detail };
      return { ok: false, err: "syntax" };
    }
  }

  // Compiled function of x for graphing: returns NaN instead of throwing.
  function compile(src, env) {
    var ast = parse(src, { allowX: true });
    var e = { angle: (env && env.angle) || "rad", ans: env && env.ans, rand: env && env.rand, x: 0 };
    return function (x) {
      e.x = x;
      try { var v = evaluate(ast, e); return typeof v === "number" ? v : NaN; }
      catch (er) { return NaN; }
    };
  }

  // Number → plain text: 15 significant digits, no binary noise,
  // exponent "1.5e20" for very large or very small magnitudes.
  function formatNum(v) {
    if (!isNum(v)) return null;
    if (v === 0) return "0";
    var a = Math.abs(v);
    if (a >= 1e16 || a < 1e-9) {
      var s = v.toExponential(14);
      var m = /^(-?\d)(?:\.(\d*?))?0*e([+\-]\d+)$/.exec(s);
      if (!m) return s;
      var mant = m[1] + (m[2] ? "." + m[2] : "");
      var ex = parseInt(m[3], 10);
      if (mant === "10" || mant === "-10") { mant = mant.charAt(0) === "-" ? "-1" : "1"; ex += 1; }
      return mant + "e" + ex;
    }
    var c = clean(v);
    if (Math.abs(c) >= 1e-6) return String(c);
    var digits = Math.min(100, 14 - Math.floor(Math.log(Math.abs(c)) / Math.LN10));
    return c.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
  }

  // ---------- 2. Units in expressions ----------
  // "3 ft to cm", "100 km/h in m/s", "20 EUR σε USD", "ft to m".
  // U is the Unit Converter's engine (UnitsCore). Returns null when
  // the text is not a conversion, else { ok, v, sym, cat, from, to,
  // expr } or { ok:false, err }.
  var JOIN_RE = /\s(?:to|in|into|as|σε)(?=\s)|->|→|⇒/g;
  var aiCache = { key: null, idx: null };
  function unitIndex(U, rates) {
    var key = rates ? (rates.date + "|" + rates.at + "|" + Object.keys(rates.rates || {}).length) : "-";
    if (aiCache.key === key && aiCache.U === U) return aiCache.idx;
    var idx = {};
    U.CATS.forEach(function (c) {
      U.unitsOf(c.id, rates).forEach(function (u) {
        U.aliasesOf(u).forEach(function (al) {
          if (!idx[al]) idx[al] = [];
          idx[al].push({ cat: c.id, id: u.id, sym: u.sym });
        });
      });
    });
    aiCache = { key: key, U: U, idx: idx };
    return idx;
  }
  function catOrder(U) {
    var ids = U.CATS.map(function (c) { return c.id; });
    var k = ids.indexOf("cooking");
    if (k >= 0) { ids.splice(k, 1); ids.push("cooking"); }   // "oz" is a weight first
    return ids;
  }
  function looksLikeCurrency(s) { return /^[a-z]{3}$/.test(s) && !/^(kmh|mph|fps|kwh|bar|psi|atm|cal|btu|min|day|sec|deg|rad|mpg|lbs|ozt|cup|tsp|gal|mil)$/.test(s); }

  function unitConvert(src, U, opts) {
    if (!U || typeof U.convert !== "function") return null;
    opts = opts || {};
    var f = U.fold(src);
    if (!f) return null;
    var joins = [], m;
    JOIN_RE.lastIndex = 0;
    while ((m = JOIN_RE.exec(f))) joins.push({ at: m.index, end: m.index + m[0].length });
    if (!joins.length) return null;
    var idx = unitIndex(U, opts.rates);
    var order = catOrder(U);
    var firstErr = null;
    for (var j = joins.length - 1; j >= 0; j--) {
      var left = f.slice(0, joins[j].at).trim();
      var right = f.slice(joins[j].end).trim();
      if (!left || !right) continue;
      var toRefs = idx[right];
      if (!toRefs) {
        if (!firstErr && looksLikeCurrency(right)) firstErr = "rates";
        continue;
      }
      // the longest unit at the end of the left side
      for (var p = 0; p < left.length; p++) {
        if (p > 0 && !/[\s0-9).]/.test(left.charAt(p - 1))) continue;
        var uTxt = left.slice(p).trim();
        var fromRefs = idx[uTxt];
        if (!fromRefs) continue;
        var exprTxt = left.slice(0, p).trim();
        var val = 1;
        if (exprTxt) {
          var r = opts.evalNumber ? opts.evalNumber(exprTxt) : calc(exprTxt, opts.env);
          if (!r.ok) { if (!firstErr) firstErr = r.err; continue; }
          val = r.v;
        }
        for (var o = 0; o < order.length; o++) {
          var ca = pick(fromRefs, order[o]), cb = pick(toRefs, order[o]);
          if (!ca || !cb) continue;
          if (U.needsDensity && U.needsDensity(order[o], ca.id, cb.id)) { if (!firstErr) firstErr = "dens"; continue; }
          var res = U.convert(order[o], ca.id, cb.id, val, { rates: opts.rates });
          if (!res.ok) return { ok: false, err: "unit_" + res.err };
          return { ok: true, v: res.v, sym: cb.sym, fromSym: ca.sym, cat: order[o], from: ca.id, to: cb.id, value: val };
        }
        if (!firstErr) firstErr = "units_mismatch";
      }
    }
    if (firstErr === "rates" && !(opts.rates && opts.rates.rates)) return { ok: false, err: "rates" };
    if (firstErr === "rates") return null;
    return firstErr ? { ok: false, err: firstErr } : null;
  }
  function pick(refs, catId) {
    for (var i = 0; i < refs.length; i++) if (refs[i].cat === catId) return refs[i];
    return null;
  }

  // ---------- 3. Programmer (BigInt) ----------
  var PROG_WORDS = { and: "&", or: "|", xor: "^", not: "~", nand: "nand", nor: "nor", mod: "%", lsh: "<<", rsh: ">>" };
  var BASES = { 2: 1, 8: 1, 10: 1, 16: 1 };
  var DIGITS = "0123456789abcdef";

  function parseBig(txt, base) {
    txt = txt.toLowerCase();
    if (!txt) throw err("syntax");
    var B = BigInt(base), v = BigInt(0);
    for (var i = 0; i < txt.length; i++) {
      var d = DIGITS.indexOf(txt.charAt(i));
      if (d < 0 || d >= base) throw err("digit", txt.charAt(i));
      v = v * B + BigInt(d);
    }
    return v;
  }

  function progTokenize(src, base) {
    var s = String(src == null ? "" : src).replace(/[−–]/g, "-").replace(/×/g, "*").replace(/÷/g, "/")
      .replace(/«/g, "<<").replace(/»/g, ">>");
    var out = [], i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      var two = s.substr(i, 2);
      if (two === "<<" || two === ">>") { out.push({ t: "op", v: two }); i += 2; continue; }
      if ("+-*/%&|^~()".indexOf(c) >= 0) { out.push({ t: "op", v: c }); i++; continue; }
      if (/[0-9A-Za-z_]/.test(c)) {
        var w = "";
        while (i < s.length && /[0-9A-Za-z_]/.test(s.charAt(i))) { w += s.charAt(i); i++; }
        var lw = w.toLowerCase().replace(/_/g, "");
        if (PROG_WORDS[lw]) { out.push({ t: "op", v: PROG_WORDS[lw] }); continue; }
        var b = base, body = lw;
        var pm = /^0([xbo])(.+)$/.exec(lw);
        if (pm) { b = pm[1] === "x" ? 16 : pm[1] === "b" ? 2 : 8; body = pm[2]; }
        out.push({ t: "num", v: parseBig(body, b) });
        continue;
      }
      throw err("char", c);
    }
    return out;
  }

  // Precedence (low → high): | nor, ^, & nand, << >>, + -, * / %, unary - ~ not
  function progEval(src, base, bits) {
    if (!BASES[base]) base = 10;
    if ([8, 16, 32, 64].indexOf(bits) < 0) bits = 64;
    try {
      var toks = progTokenize(src, base);
      if (!toks.length) return { ok: false, err: "empty" };
      var pos = 0;
      var W = function (v) { return BigInt.asIntN(bits, v); };
      var isOp = function (v) { var t = toks[pos]; return t && t.t === "op" && t.v === v; };
      var lvl = [["|", "nor"], ["^"], ["&", "nand"], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]];
      var bin = function (op, a, b) {
        switch (op) {
          case "|": return W(a | b);
          case "nor": return W(~(a | b));
          case "^": return W(a ^ b);
          case "&": return W(a & b);
          case "nand": return W(~(a & b));
          case "<<": if (b < BigInt(0)) throw err("domain"); return W(b >= BigInt(bits) ? BigInt(0) : a << b);
          case ">>": if (b < BigInt(0)) throw err("domain"); return W(b >= BigInt(bits) ? (a < BigInt(0) ? BigInt(-1) : BigInt(0)) : a >> b);
          case "+": return W(a + b);
          case "-": return W(a - b);
          case "*": return W(a * b);
          case "/": if (b === BigInt(0)) throw err("div0"); return W(a / b);
          case "%": if (b === BigInt(0)) throw err("div0"); return W(a % b);
        }
        throw err("syntax");
      };
      var level = function (l) {
        if (l >= lvl.length) return unary();
        var left = level(l + 1);
        for (;;) {
          var t = toks[pos];
          if (!t || t.t !== "op" || lvl[l].indexOf(t.v) < 0) return left;
          pos++;
          left = bin(t.v, left, level(l + 1));
        }
      };
      var unary = function () {
        if (isOp("-")) { pos++; return W(-unary()); }
        if (isOp("+")) { pos++; return unary(); }
        if (isOp("~")) { pos++; return W(~unary()); }
        var t = toks[pos++];
        if (!t) throw err("end");
        if (t.t === "num") return W(t.v);
        if (t.v === "(") {
          var v = level(0);
          if (isOp(")")) pos++;
          else if (pos < toks.length) throw err("paren");
          return v;
        }
        throw err("syntax");
      };
      var v = level(0);
      if (pos < toks.length) throw err("syntax");
      return { ok: true, v: v };
    } catch (e) {
      if (e && e.calc) return { ok: false, err: e.calc, detail: e.detail };
      return { ok: false, err: "syntax" };
    }
  }

  // Signed decimal in DEC; two's complement digits in the others.
  function progFormat(v, base, bits) {
    if (base === 10) return BigInt.asIntN(bits, v).toString(10);
    return BigInt.asUintN(bits, v).toString(base).toUpperCase();
  }
  // Display grouping: HEX / BIN in fours, OCT / DEC in threes.
  function progGroup(s, base) {
    var neg = s.charAt(0) === "-";
    if (neg) s = s.slice(1);
    var g = (base === 16 || base === 2) ? 4 : 3;
    var out = "";
    for (var i = s.length; i > 0; i -= g) out = s.slice(Math.max(0, i - g), i) + (out ? " " + out : "");
    return (neg ? "-" : "") + out;
  }
  function progToggleBit(v, bit, bits) {
    return BigInt.asIntN(bits, v ^ (BigInt(1) << BigInt(bit)));
  }
  function progBit(v, bit) {
    return ((BigInt.asUintN(64, v) >> BigInt(bit)) & BigInt(1)) === BigInt(1);
  }

  // ---------- 4. Finance ----------
  // "1.234,56", "1,234.56", "12,5", "12.5" → number (NaN if not one)
  function parseNum(s) {
    s = String(s == null ? "" : s).replace(/[\s   €$%]/g, "").replace(/[−–]/g, "-");
    if (!s) return NaN;
    var lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) {
      if (lc > ld) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (lc >= 0) {
      if ((s.match(/,/g) || []).length > 1) s = s.replace(/,/g, "");
      else s = s.replace(",", ".");
    } else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return Number(s);
  }
  function cents(v) { return Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }

  // VAT: mode "add" (amount is net) or "remove" (amount is gross).
  function vat(amount, ratePct, mode) {
    if (!isNum(amount) || !isNum(ratePct) || ratePct < 0) return null;
    var net, tax, gross;
    if (mode === "remove") {
      gross = amount;
      net = cents(amount / (1 + ratePct / 100));
      tax = cents(gross - net);
    } else {
      net = amount;
      tax = cents(amount * ratePct / 100);
      gross = cents(net + tax);
    }
    return { net: net, vat: tax, gross: gross };
  }

  function pctChange(from, to) {
    if (!isNum(from) || !isNum(to)) return null;
    var diff = addR(to, -from);
    return { diff: diff, pct: from === 0 ? null : clean(diff / Math.abs(from) * 100) };
  }
  function pctOf(p, of) { return isNum(p) && isNum(of) ? clean(p * of / 100) : null; }
  function whatPct(part, whole) { return isNum(part) && isNum(whole) && whole !== 0 ? clean(part / whole * 100) : null; }

  // Fixed-rate loan, monthly instalments, rounded to cents like a bank
  // statement; the last instalment absorbs the rounding.
  function loan(principal, ratePct, months) {
    if (!isNum(principal) || principal <= 0 || !isNum(ratePct) || ratePct < 0 ||
        !isNum(months) || months < 1 || months > 1200 || Math.floor(months) !== months) return null;
    var i = ratePct / 100 / 12;
    var pay = i === 0 ? principal / months : principal * i / (1 - Math.pow(1 + i, -months));
    pay = cents(pay);
    var bal = principal, rows = [], totI = 0, totP = 0;
    for (var m = 1; m <= months; m++) {
      var int = cents(bal * i);
      var p = m === months ? cents(bal + int) : pay;
      var prin = cents(p - int);
      if (prin > bal && m < months) { prin = bal; p = cents(prin + int); }
      bal = cents(bal - prin);
      totI = cents(totI + int); totP = cents(totP + p);
      rows.push({ n: m, payment: p, interest: int, principal: prin, balance: bal });
      if (bal <= 0) break;
    }
    return { payment: pay, total: totP, interest: totI, rows: rows };
  }

  // Savings: start amount, a deposit at the end of every month,
  // interest compounded monthly ("m") or yearly ("y"; deposits earn
  // simple interest inside the year). One row per year.
  function savings(start, monthly, ratePct, years, freq) {
    if (!isNum(start) || start < 0 || !isNum(monthly) || monthly < 0 || !isNum(ratePct) || ratePct < 0 ||
        !isNum(years) || years < 1 || years > 100 || Math.floor(years) !== years) return null;
    var r = ratePct / 100, bal = start, dep = start, rows = [];
    for (var y = 1; y <= years; y++) {
      var startBal = bal, yInt = 0;
      if (freq === "y") {
        yInt = startBal * r;
        for (var m = 1; m <= 12; m++) yInt += monthly * r * (12 - m) / 12;
        bal = startBal + monthly * 12 + yInt;
      } else {
        for (var mm = 1; mm <= 12; mm++) {
          var it = bal * r / 12;
          yInt += it;
          bal = bal + it + monthly;
        }
      }
      dep += monthly * 12;
      rows.push({ n: y, deposits: cents(dep), interest: cents(yInt), balance: cents(bal) });
    }
    bal = cents(bal);
    return { final: bal, deposits: cents(dep), interest: cents(bal - dep), rows: rows };
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;   // no formulas in spreadsheets
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(header, rows) {
    var lines = [header.map(csvCell).join(",")];
    rows.forEach(function (r) { lines.push(r.map(csvCell).join(",")); });
    return lines.join("\r\n");
  }

  // ---------- 5. Graph helpers ----------
  // A "nice" grid step (1, 2, 5 × 10^k) for about `target` lines.
  function niceStep(span, target) {
    if (!(span > 0)) return 1;
    var raw = span / (target || 8);
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var n = raw / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
  }

  function bisect(f, a, b, fa) {
    for (var k = 0; k < 60; k++) {
      var mid = (a + b) / 2, fm = f(mid);
      if (!isNum(fm)) return NaN;
      if (fm === 0) return mid;
      if ((fm < 0) === (fa < 0)) { a = mid; fa = fm; } else b = mid;
    }
    return (a + b) / 2;
  }
  function golden(f, a, b, wantMax) {
    var g = (Math.sqrt(5) - 1) / 2, c = b - g * (b - a), d = a + g * (b - a);
    var sgn = wantMax ? -1 : 1;
    var fc = sgn * f(c), fd = sgn * f(d);
    for (var k = 0; k < 80; k++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = sgn * f(c); }
      else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = sgn * f(d); }
    }
    return (a + b) / 2;
  }

  // Roots and local extrema of f on [x0, x1] from n samples.
  // Sign changes at poles (1/x) are rejected; plateaus are skipped.
  function analyse(f, x0, x1, n, maxEach) {
    n = n || 400; maxEach = maxEach || 20;
    var xs = [], ys = [], dx = (x1 - x0) / n, i;
    for (i = 0; i <= n; i++) { var x = x0 + i * dx; xs.push(x); ys.push(f(x)); }
    var roots = [], mins = [], maxs = [];
    var tolY = 1e-7;
    for (i = 0; i < n && roots.length < maxEach; i++) {
      var a = ys[i], b = ys[i + 1];
      if (!isNum(a) || !isNum(b)) continue;
      if (a === 0) { pushUnique(roots, xs[i], dx); continue; }
      if ((a < 0) !== (b < 0) && b !== 0) {
        var r = bisect(f, xs[i], xs[i + 1], a);
        var fr = f(r);
        // a pole (1/x, tan) changes sign too, but |f| stays large there
        if (isNum(r) && isNum(fr) && Math.abs(fr) <= tolY * Math.max(1, Math.abs(a), Math.abs(b))) {
          pushUnique(roots, snap(r, 1e-11 * Math.max(1, Math.abs(r))), dx);
        }
      }
    }
    if (n >= 2 && isNum(ys[n]) && ys[n] === 0) pushUnique(roots, xs[n], dx);
    for (i = 1; i < n; i++) {
      var y0 = ys[i - 1], y1 = ys[i], y2 = ys[i + 1];
      if (!isNum(y0) || !isNum(y1) || !isNum(y2)) continue;
      if (y1 > y0 && y1 > y2 && maxs.length < maxEach) {
        var xm = snap(golden(f, xs[i - 1], xs[i + 1], true), Math.abs(dx) * 1e-4), ym = f(xm);
        // a pole between samples is not a maximum: the refined value
        // must stay close to what the samples promised
        if (isNum(ym) && Math.abs(ym - y1) <= 2 * (Math.abs(y1 - y0) + Math.abs(y1 - y2))) maxs.push({ x: xm, y: ym });
      } else if (y1 < y0 && y1 < y2 && mins.length < maxEach) {
        var xn = snap(golden(f, xs[i - 1], xs[i + 1], false), Math.abs(dx) * 1e-4), yn = f(xn);
        if (isNum(yn) && Math.abs(yn - y1) <= 2 * (Math.abs(y1 - y0) + Math.abs(y1 - y2))) mins.push({ x: xn, y: yn });
      }
    }
    return { roots: roots, mins: mins, maxs: maxs };
  }
  function pushUnique(list, x, dx) {
    for (var i = 0; i < list.length; i++) if (Math.abs(list[i] - x) < Math.abs(dx) / 2) return;
    list.push(x);
  }
  // Snap results that are a hair off a round value (1.9999999 → 2,
  // 7e-8 → 0); anything else keeps its full precision.
  function snap(x, tol) {
    tol = Math.abs(tol);
    if (Math.abs(x) < tol) return 0;
    for (var p = 1; p <= 8; p++) {
      var c = Number(x.toPrecision(p));
      if (Math.abs(c - x) < tol) return c;
    }
    return x;
  }

  function intersections(f, g, x0, x1, n, maxEach) {
    var h = function (x) { var a = f(x), b = g(x); return isNum(a) && isNum(b) ? a - b : NaN; };
    return analyse(h, x0, x1, n, maxEach).roots.map(function (x) { return { x: x, y: f(x) }; });
  }

  // ---------- 6. Troll mode quips ----------
  // Troll mode always shows the correct result (Chris 2026-10-22);
  // only the line beside it is picked here. ctx: { v (the result),
  // a, b, op (Standard), expr (Scientific source), unit, err, bare }.
  // level: 0 subtle (gentle pool), 1 balanced (+ cheeky), 2 rampant
  // (+ roast). A line about the result itself wins over the pools;
  // the same key never comes twice in a row. Returns a pack key.
  var QUIP_POOLS = [
    ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"],
    ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"],
    ["r1", "r2", "r3", "r4", "r5", "r6"]
  ];
  var TRIG_RE = /sin|cos|tan|ημ|συν|εφ/i;
  function quipSpecial(ctx) {
    if (ctx.err) return "err";
    if (ctx.bare) return "bare";
    var v = ctx.v;
    if (!isNum(v)) return null;
    if (ctx.op && isNum(ctx.b) &&
        (((ctx.op === "add" || ctx.op === "sub") && ctx.b === 0) ||
         ((ctx.op === "mul" || ctx.op === "div") && ctx.b === 1))) return "same";
    if (v === 42) return "42";
    if (ctx.unit) return "units";
    if (v === 0) return "zero";
    if (ctx.op && ctx.op !== "div" && [ctx.a, ctx.b].every(function (n) {
      return isNum(n) && n === Math.floor(n) && n >= 0 && n <= 10;
    })) return "easy";
    if (ctx.expr && TRIG_RE.test(ctx.expr)) return "trig";
    var abs = Math.abs(v);
    if (abs >= 111 && abs < 1e15 && abs === Math.floor(abs) &&
        /^(\d)\1{2,}$/.test(String(abs))) return "rep";
    if (abs >= 1e9) return "big";
    if (v < 0) return "neg";
    var dec = String(clean(v)).split(".")[1];
    if (dec && dec.indexOf("e") === -1 && dec.length >= 4) return "dec";
    return null;
  }
  function trollQuip(ctx, level, last, rnd) {
    rnd = rnd || Math.random;
    var sp = quipSpecial(ctx || {});
    if (sp && "troll.q." + sp !== last) return "troll.q." + sp;
    var lvl = (level === 0 || level === 2) ? level : 1;
    var pool = [];
    for (var i = 0; i <= lvl; i++) pool = pool.concat(QUIP_POOLS[i]);
    pool = pool.map(function (k) { return "troll.q." + k; })
      .filter(function (k) { return k !== last; });
    return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
  }
  // Every key trollQuip can return (the string packs must hold them all).
  function trollQuipKeys() {
    var out = ["err", "bare", "same", "42", "units", "zero", "easy", "trig", "rep", "big", "neg", "dec"];
    QUIP_POOLS.forEach(function (p) { out = out.concat(p); });
    return out.map(function (k) { return "troll.q." + k; });
  }

  var API = {
    clean: clean, addR: addR, tokenize: tokenize, parse: parse, evaluate: evaluate, calc: calc, compile: compile,
    formatNum: formatNum, gamma: gamma, factorial: factorial,
    unitConvert: unitConvert,
    progEval: progEval, progFormat: progFormat, progGroup: progGroup, progToggleBit: progToggleBit, progBit: progBit,
    parseNum: parseNum, cents: cents, vat: vat, pctChange: pctChange, pctOf: pctOf, whatPct: whatPct,
    loan: loan, savings: savings, toCsv: toCsv,
    niceStep: niceStep, analyse: analyse, intersections: intersections,
    trollQuip: trollQuip, trollQuipKeys: trollQuipKeys
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.CalcCore = API;
})(typeof window !== "undefined" ? window : globalThis);
