// Airwindows (https://github.com/airwindows/airwindows, MIT License, Chris
// Johnson) to Studio effect files: translates one plugin of the LinuxVST
// sources (Name.h, Name.cpp, NameProc.cpp) into plain JS ahead of time.
// Nothing is evaluated at run time; the output is a static file that
// registers globalThis.NULLFX[id] with the same interface the NULL JSFX
// runtime drives (studio/nullfx/runtime/null-fx.js: FX.create(R, H, G)
// → { init, slider, block, sample, setSlider, setHost, getHost }).
//
// The C++ is the narrow subset Airwindows plugins are written in: member
// scalars and fixed arrays, the constructor's resets, and
// processDoubleReplacing's per-sample loop. Types are tracked so the JS
// keeps C's arithmetic: int and uint32_t variables are truncated or
// wrapped on every store, int / int divides as integers, unsigned >> is a
// logical shift, float stores round to single precision. A construct this
// file does not know throws, so a plugin is either translated whole or
// not at all; tests/airfx.test.js checks every shipped file against the
// original compiled with g++ (null test, .github/airfx/null-test.js).
"use strict";

const fs = require("fs");
const path = require("path");

class Unsupported extends Error {}
function no(msg) { throw new Unsupported(msg); }

// ---------- Lexer ----------
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").replace(/^\s*#[^\n]*$/gm, " ");
}
const PUNCT = ["<<=", ">>=", "...", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "::"];
function lex(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    let m;
    const rest = src.slice(i, i + 64);
    if ((m = /^(0[xX][0-9a-fA-F]+|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)([fFlLuU]*)/.exec(rest))) {
      out.push({ t: "num", v: m[1], suf: m[2].toLowerCase() }); i += m[0].length; continue;
    }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) { out.push({ t: "id", v: m[0] }); i += m[0].length; continue; }
    if (c === '"') { const e = src.indexOf('"', i + 1); out.push({ t: "str", v: src.slice(i + 1, e) }); i = e + 1; continue; }
    if (c === "'") { const e = src.indexOf("'", i + 1); out.push({ t: "chr", v: src.slice(i + 1, e) }); i = e + 1; continue; }
    const p = PUNCT.find((x) => src.startsWith(x, i));
    if (p) { out.push({ t: "op", v: p }); i += p.length; continue; }
    out.push({ t: "op", v: c }); i++;
  }
  return out;
}

// ---------- Types ----------
const TYPES = {
  double: "d", float: "f", int: "i", long: "i", short: "i", bool: "b", char: "i",
  uint32_t: "u", int32_t: "i", VstInt32: "i", unsigned: "u", int64_t: "i", uint64_t: "u64", size_t: "u"
};
function isTypeStart(toks, k) {
  const t = toks[k];
  return t && t.t === "id" && (TYPES[t.v] || t.v === "const" || t.v === "static" || t.v === "signed" || t.v === "register");
}
// reads a type (possibly "long double", "unsigned int", "const double"); returns [kind, next index]
function readType(toks, k) {
  let words = [];
  while (toks[k] && toks[k].t === "id" && (TYPES[toks[k].v] || ["const", "static", "signed", "register"].indexOf(toks[k].v) >= 0)) words.push(toks[k++].v);
  words = words.filter((w) => ["const", "static", "register"].indexOf(w) < 0);
  let kind;
  if (words.indexOf("double") >= 0) kind = "d";
  else if (words.indexOf("float") >= 0) kind = "f";
  else if (words.indexOf("bool") >= 0) kind = "b";
  else if (words.indexOf("unsigned") >= 0 || words.indexOf("uint32_t") >= 0 || words.indexOf("size_t") >= 0) kind = "u";
  else if (words.indexOf("uint64_t") >= 0) no("uint64_t");
  else if (words.length) kind = "i";
  else no("type expected");
  if (words.filter((w) => w === "long").length > 1) kind = kind === "u" ? "u" : "i";
  return [kind, k];
}

// ---------- Parser (expressions: precedence climbing) ----------
class Parser {
  constructor(toks, consts) { this.toks = toks; this.k = 0; this.consts = consts || {}; }
  peek(o) { return this.toks[this.k + (o || 0)]; }
  is(v, o) { const t = this.peek(o); return t && (t.t === "op" || t.t === "id") && t.v === v; }
  eat(v) { if (!this.is(v)) no("expected " + v + " at " + this.where()); return this.toks[this.k++]; }
  where() { return this.toks.slice(this.k, this.k + 8).map((t) => t.v).join(" "); }
  expr() {
    let e = this.assign();
    while (this.is(",")) { this.k++; e = { n: "comma", a: e, b: this.assign() }; }
    return e;
  }
  assign() {
    const left = this.cond();
    const t = this.peek();
    if (t && t.t === "op" && ["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "^="].indexOf(t.v) >= 0) {
      this.k++;
      return { n: "assign", op: t.v, a: left, b: this.assign() };
    }
    return left;
  }
  cond() {
    const c = this.bin(0);
    if (this.is("?")) { this.k++; const a = this.assign(); this.eat(":"); const b = this.assign(); return { n: "cond", c, a, b }; }
    return c;
  }
  bin(level) {
    const LV = [["||"], ["&&"], ["|"], ["^"], ["&"], ["==", "!="], ["<", ">", "<=", ">="], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]];
    if (level >= LV.length) return this.unary();
    let a = this.bin(level + 1);
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== "op" || LV[level].indexOf(t.v) < 0) return a;
      this.k++;
      a = { n: "bin", op: t.v, a, b: this.bin(level + 1) };
    }
  }
  unary() {
    const t = this.peek();
    if (t && t.t === "op") {
      if (t.v === "-" || t.v === "+" || t.v === "!" || t.v === "~") { this.k++; return { n: "un", op: t.v, a: this.unary() }; }
      if (t.v === "++" || t.v === "--") { this.k++; return { n: "pre", op: t.v, a: this.unary() }; }
      if (t.v === "*") { this.k++; return { n: "deref", a: this.unary() }; }
      if (t.v === "(" && isTypeStart(this.toks, this.k + 1)) {
        const [kind, k2] = readType(this.toks, this.k + 1);
        if (this.toks[k2] && this.toks[k2].v === ")") { this.k = k2 + 1; return { n: "cast", kind, a: this.unary() }; }
      }
    }
    return this.postfix();
  }
  postfix() {
    let e = this.primary();
    for (;;) {
      if (this.is("[")) { this.k++; const i = this.expr(); this.eat("]"); e = { n: "index", a: e, i }; continue; }
      if (this.is("++") || this.is("--")) { e = { n: "post", op: this.toks[this.k++].v, a: e }; continue; }
      if (this.is("(") && e.n === "id") {
        this.k++;
        const args = [];
        while (!this.is(")")) { args.push(this.assign()); if (this.is(",")) this.k++; }
        this.eat(")");
        e = { n: "call", f: e.v, args };
        continue;
      }
      return e;
    }
  }
  primary() {
    const t = this.toks[this.k++];
    if (!t) no("unexpected end");
    if (t.t === "num") return { n: "num", v: t.v, suf: t.suf };
    if (t.t === "id") {
      if (t.v === "true") return { n: "num", v: "1", suf: "" };
      if (t.v === "false") return { n: "num", v: "0", suf: "" };
      if (TYPES[t.v] && this.is("(")) {        // functional cast: double(x), uint32_t(x)
        const [kind] = readType(this.toks, this.k - 1);
        this.k++; const a = this.expr(); this.eat(")");
        return { n: "cast", kind, a };
      }
      if (t.v in this.consts) return { n: "num", v: String(this.consts[t.v]), suf: "" };
      return { n: "id", v: t.v };
    }
    if (t.v === "(") { const e = this.expr(); this.eat(")"); return { n: "paren", a: e }; }
    no("unexpected " + t.v + " at " + this.where());
  }
  // ---------- Statements ----------
  block() {
    const list = [];
    this.eat("{");
    while (!this.is("}")) list.push(this.stmt());
    this.eat("}");
    return { n: "block", list };
  }
  decl() {
    const [kind, k2] = readType(this.toks, this.k);
    this.k = k2;
    const vars = [];
    for (;;) {
      if (this.is("*") || this.is("&")) no("pointer or reference");
      const name = this.toks[this.k++];
      if (!name || name.t !== "id") no("name expected at " + this.where());
      const dims = [];
      while (this.is("[")) { this.k++; dims.push(this.cexpr()); this.eat("]"); }
      let init = null;
      if (this.is("=")) { this.k++; if (this.is("{")) no("array initialiser"); init = this.assign(); }
      vars.push({ name: name.v, kind, dims, init });
      if (this.is(",")) { this.k++; continue; }
      break;
    }
    this.eat(";");
    return { n: "decl", vars };
  }
  cexpr() { const e = this.expr(); const v = constEval(e); if (v == null) no("array size not constant"); return v; }
  stmt() {
    const t = this.peek();
    if (!t) no("unexpected end");
    if (this.is("{")) return this.block();
    if (this.is(";")) { this.k++; return { n: "empty" }; }
    if (isTypeStart(this.toks, this.k) && !(this.peek(1) && this.peek(1).v === "(")) return this.decl();
    if (this.is("if")) {
      this.k++; this.eat("("); const c = this.expr(); this.eat(")");
      const a = this.stmt();
      let b = null;
      if (this.is("else")) { this.k++; b = this.stmt(); }
      return { n: "if", c, a, b };
    }
    if (this.is("while")) { this.k++; this.eat("("); const c = this.expr(); this.eat(")"); return { n: "while", c, body: this.stmt() }; }
    if (this.is("do")) {
      this.k++; const body = this.stmt(); this.eat("while"); this.eat("("); const c = this.expr(); this.eat(")"); this.eat(";");
      return { n: "do", c, body };
    }
    if (this.is("for")) {
      this.k++; this.eat("(");
      let init = null;
      if (isTypeStart(this.toks, this.k)) init = this.decl();
      else { if (!this.is(";")) init = { n: "expr", e: this.expr() }; this.eat(";"); }
      const c = this.is(";") ? null : this.expr(); this.eat(";");
      const step = this.is(")") ? null : this.expr(); this.eat(")");
      return { n: "for", init, c, step, body: this.stmt() };
    }
    if (this.is("switch")) {
      this.k++; this.eat("("); const e = this.expr(); this.eat(")"); this.eat("{");
      const cases = [];
      while (!this.is("}")) {
        if (this.is("case")) { this.k++; const v = this.cexpr(); this.eat(":"); cases.push({ v, body: [] }); continue; }
        if (this.is("default")) { this.k++; this.eat(":"); cases.push({ v: null, body: [] }); continue; }
        if (!cases.length) no("statement before case");
        cases[cases.length - 1].body.push(this.stmt());
      }
      this.eat("}");
      return { n: "switch", e, cases };
    }
    if (this.is("break")) { this.k++; this.eat(";"); return { n: "break" }; }
    if (this.is("continue")) { this.k++; this.eat(";"); return { n: "continue" }; }
    if (this.is("return")) { this.k++; if (!this.is(";")) no("return value"); this.eat(";"); return { n: "return" }; }
    if (this.is("goto")) no("goto");
    const e = this.expr();
    this.eat(";");
    return { n: "expr", e };
  }
}
function constEval(e) {
  switch (e.n) {
    case "num": return Number(e.v);
    case "paren": return constEval(e.a);
    case "un": { const a = constEval(e.a); return a == null ? null : e.op === "-" ? -a : e.op === "+" ? a : null; }
    case "bin": {
      const a = constEval(e.a), b = constEval(e.b);
      if (a == null || b == null) return null;
      return { "+": a + b, "-": a - b, "*": a * b, "/": Math.trunc(a / b) }[e.op];
    }
  }
  return null;
}

// ---------- Code generation ----------
const MATH = {
  fabs: "Math.abs", abs: "Math.abs", fabsl: "Math.abs", sin: "Math.sin", cos: "Math.cos", tan: "Math.tan",
  asin: "Math.asin", acos: "Math.acos", atan: "Math.atan", atan2: "Math.atan2", sinh: "Math.sinh",
  cosh: "Math.cosh", tanh: "Math.tanh", exp: "Math.exp", log: "Math.log", log10: "Math.log10",
  log2: "Math.log2", sqrt: "Math.sqrt", pow: "Math.pow", floor: "Math.floor", ceil: "Math.ceil",
  fmin: "Math.min", fmax: "Math.max", sinl: "Math.sin", cosl: "Math.cos", sqrtl: "Math.sqrt", powl: "Math.pow",
  cbrt: "Math.cbrt", trunc: "Math.trunc", min: "Math.min", max: "Math.max"
};
const HELPERS = { fmod: "fmod", round: "cround", copysign: "copysign", sign: "csign", nearbyint: "rint", rint: "rint", lrint: "rint" };

class Gen {
  constructor(vars) { this.vars = vars; this.locals = [{}]; this.uses = {}; }
  scope() { this.locals.push({}); }
  unscope() { this.locals.pop(); }
  typeOf(name) {
    for (let i = this.locals.length - 1; i >= 0; i--) if (name in this.locals[i]) return this.locals[i][name];
    if (name in this.vars) return this.vars[name];
    return null;
  }
  // [code, kind] ; kind: d f i u b
  ex(e) {
    switch (e.n) {
      case "num": {
        let v = e.v;
        if (/^0[xX]/.test(v)) return [String(parseInt(v, 16)), parseInt(v, 16) > 0x7fffffff || e.suf.indexOf("u") >= 0 ? "u" : "i"];
        const isFloat = /[.eE]/.test(v) || e.suf === "f";
        if (e.suf.indexOf("f") >= 0 && isFloat) return ["Math.fround(" + v + ")", "f"];
        if (/^\./.test(v)) v = "0" + v;
        v = v.replace(/\.$/, ".0").replace(/\.([eE])/, ".0$1");
        return [v, isFloat ? "d" : (e.suf.indexOf("u") >= 0 ? "u" : "i")];
      }
      case "id": {
        if (e.v === "M_PI") return ["Math.PI", "d"];
        if (e.v === "UINT32_MAX") return ["4294967295", "u"];
        if (e.v === "INT32_MAX") return ["2147483647", "i"];
        const k = this.typeOf(e.v);
        if (!k) no("unknown name " + e.v);
        if (k.arr) no("array used as a value: " + e.v);
        return [this.name(e.v), k.kind];
      }
      case "paren": { const [c, k] = this.ex(e.a); return ["(" + c + ")", k]; }
      case "index": {
        if (e.a.n !== "id" && e.a.n !== "index") no("index of an expression");
        const base = this.lvBase(e);
        const [ic] = this.intEx(e.i);
        return [base.code + "[" + ic + "]", base.kind];
      }
      case "call": return this.call(e);
      case "cast": {
        const [c, k] = this.ex(e.a);
        if (e.kind === "d") return ["(" + c + ")", "d"];
        if (e.kind === "f") return ["Math.fround(" + c + ")", "f"];
        if (e.kind === "b") return ["((" + c + ") ? 1 : 0)", "b"];
        if (e.kind === "u") return ["((" + c + ") >>> 0)", "u"];
        return [k === "i" || k === "b" ? c : "((" + c + ") | 0)", "i"];
      }
      case "un": {
        const [c, k] = this.ex(e.a);
        if (e.op === "!") return ["(" + c + " ? 0 : 1)", "b"];
        if (e.op === "~") return [k === "u" ? "((~" + c + ") >>> 0)" : "(~" + c + ")", k === "u" ? "u" : "i"];
        if (e.op === "-" && k === "u") return ["((-" + c + ") >>> 0)", "u"];
        return ["(" + e.op + c + ")", k === "b" ? "i" : k];
      }
      case "bin": return this.bin(e);
      case "cond": {
        const [c] = this.ex(e.c), [a, ka] = this.ex(e.a), [b, kb] = this.ex(e.b);
        return ["(" + c + " ? " + a + " : " + b + ")", wider(ka, kb)];
      }
      case "assign": return this.assign(e);
      case "pre": case "post": {
        const lv = this.lv(e.a);
        if (lv.kind === "d" || lv.kind === "f" || lv.kind === "i") return [e.n === "pre" ? e.op + lv.code : lv.code + e.op, lv.kind];
        if (lv.kind === "u") {
          const d = e.op === "++" ? "+ 1" : "- 1";
          if (e.n === "pre") return ["(" + lv.code + " = (" + lv.code + " " + d + ") >>> 0)", "u"];
          return ["((" + lv.code + " = (" + lv.code + " " + d + ") >>> 0), (" + lv.code + " " + (e.op === "++" ? "- 1" : "+ 1") + ") >>> 0)", "u"];
        }
        no("++ on " + lv.kind);
      }
      case "comma": return ["(" + this.ex(e.a)[0] + ", " + this.ex(e.b)[0] + ")", this.ex(e.b)[1]];
      case "deref": no("pointer");
    }
    no("expression " + e.n);
  }
  intEx(e) { const [c, k] = this.ex(e); return [k === "i" || k === "u" || k === "b" ? c : "((" + c + ") | 0)", "i"]; }
  name(n) { return n; }
  lvBase(e) {
    if (e.n === "id") {
      const t = this.typeOf(e.v);
      if (!t) no("unknown name " + e.v);
      return { code: e.v, kind: t.kind, arr: t.arr };
    }
    if (e.n === "index") {
      const b = this.lvBase(e.a);
      if (e.a.n === "index") no("two-dimensional array");
      return b;
    }
    no("lvalue");
  }
  lv(e) {
    if (e.n === "paren") return this.lv(e.a);
    if (e.n === "id") {
      const t = this.typeOf(e.v);
      if (!t) no("unknown name " + e.v);
      if (t.arr) no("array assigned as a whole");
      if (t.param) no("parameter written: " + e.v);
      return { code: e.v, kind: t.kind };
    }
    if (e.n === "index") {
      const b = this.lvBase(e);
      const [ic] = this.intEx(e.i);
      return { code: b.code + "[" + ic + "]", kind: b.kind, typed: true };
    }
    no("lvalue " + e.n);
  }
  store(kind, code, typed) {
    // typed arrays convert by themselves (Float32Array rounds, Int32Array wraps)
    if (typed) return code;
    if (kind === "i") return "(" + code + ") | 0";
    if (kind === "u") return "(" + code + ") >>> 0";
    if (kind === "f") return "Math.fround(" + code + ")";
    if (kind === "b") return "(" + code + ") ? 1 : 0";
    return code;
  }
  assign(e) {
    const lv = this.lv(e.a);
    let rhs;
    if (e.op === "=") rhs = this.ex(e.b);
    else {
      const op = e.op.slice(0, -1);
      rhs = this.bin({ n: "bin", op, a: e.a, b: e.b });
    }
    let [c, k] = rhs;
    if ((lv.kind === "i" || lv.kind === "u" || lv.kind === "b") && k === "u" && lv.kind === "i") c = "(" + c + ")";
    const v = lv.typed && lv.kind === "u" ? "(" + c + ") >>> 0" : this.store(lv.kind, c, lv.typed);
    return ["(" + lv.code + " = " + v + ")", lv.kind];
  }
  bin(e) {
    const [a, ka] = this.ex(e.a), [b, kb] = this.ex(e.b);
    const op = e.op, isInt = (k) => k === "i" || k === "u" || k === "b";
    switch (op) {
      case "&&": case "||": return ["((" + a + " " + op + " " + b + ") ? 1 : 0)", "b"];
      case "==": case "!=": case "<": case ">": case "<=": case ">=": {
        const o = op === "==" ? "===" : op === "!=" ? "!==" : op;
        return ["(" + a + " " + o + " " + b + " ? 1 : 0)", "b"];
      }
      case "<<": {
        if (!isInt(ka) || !isInt(kb)) no("shift of a non-integer");
        return ka === "u" ? ["((" + a + " << " + b + ") >>> 0)", "u"] : ["(" + a + " << " + b + ")", "i"];
      }
      case ">>": {
        if (!isInt(ka) || !isInt(kb)) no("shift of a non-integer");
        return ka === "u" ? ["(" + a + " >>> " + b + ")", "u"] : ["(" + a + " >> " + b + ")", "i"];
      }
      case "&": case "|": case "^": {
        if (!isInt(ka) || !isInt(kb)) no("bit operation on a non-integer");
        return ka === "u" || kb === "u" ? ["((" + a + " " + op + " " + b + ") >>> 0)", "u"] : ["(" + a + " " + op + " " + b + ")", "i"];
      }
      case "%": {
        if (!isInt(ka) || !isInt(kb)) no("% on a non-integer");
        return ["(" + a + " % " + b + ")", ka === "u" && kb === "u" ? "u" : "i"];
      }
      case "/": {
        if (isInt(ka) && isInt(kb)) return ka === "u" || kb === "u" ? ["((" + a + " / " + b + ") >>> 0)", "u"] : ["((" + a + " / " + b + ") | 0)", "i"];
        return ["(" + a + " / " + b + ")", wider(ka, kb)];
      }
      case "+": case "-": case "*": {
        const k = wider(ka, kb);
        if (k === "u") return ["((" + (op === "*" ? "Math.imul(" + a + ", " + b + ")" : a + " " + op + " " + b) + ") >>> 0)", "u"];
        if (k === "i" && op === "*") return ["Math.imul(" + a + ", " + b + ")", "i"];
        if (k === "i") return ["((" + a + " " + op + " " + b + ") | 0)", "i"];
        return ["(" + a + " " + op + " " + b + ")", k];
      }
    }
    no("operator " + op);
  }
  call(e) {
    if (e.f === "getSampleRate") return ["srate", "d"];
    if (e.f === "rand") return ["crand()", "i"];
    const args = e.args.map((x) => this.ex(x));
    if (MATH[e.f]) {
      if ((e.f === "abs" || e.f === "min" || e.f === "max") && args.every((x) => x[1] === "i")) return [MATH[e.f] + "(" + args.map((x) => x[0]).join(", ") + ")", "i"];
      return [MATH[e.f] + "(" + args.map((x) => x[0]).join(", ") + ")", "d"];
    }
    if (HELPERS[e.f]) { this.uses[HELPERS[e.f]] = true; return [HELPERS[e.f] + "(" + args.map((x) => x[0]).join(", ") + ")", "d"]; }
    no("function " + e.f);
  }
  st(s, ind) {
    const I = "  ".repeat(ind);
    switch (s.n) {
      case "empty": return "";
      case "block": {
        this.scope();
        const body = s.list.map((x) => this.st(x, ind + 1)).filter(Boolean).join("\n");
        this.unscope();
        return I + "{\n" + body + "\n" + I + "}";
      }
      case "decl": {
        const scope = this.locals[this.locals.length - 1];
        return s.vars.map((v) => {
          if (v.dims.length) no("local array " + v.name);
          scope[v.name] = { kind: v.kind };
          const init = v.init ? this.store(v.kind, this.ex(v.init)[0], false) : "0";
          return I + "var " + v.name + " = " + init + ";";
        }).join("\n");
      }
      case "expr": return I + this.ex(s.e)[0] + ";";
      case "if": return I + "if (" + this.ex(s.c)[0] + ")\n" + this.sub(s.a, ind) + (s.b ? "\n" + I + "else\n" + this.sub(s.b, ind) : "");
      case "while": return I + "while (" + this.ex(s.c)[0] + ")\n" + this.sub(s.body, ind);
      case "do": return I + "do\n" + this.sub(s.body, ind) + "\n" + I + "while (" + this.ex(s.c)[0] + ");";
      case "for": {
        this.scope();
        let init = "";
        if (s.init && s.init.n === "decl") init = this.st(s.init, 0).replace(/;$/, "").trim().replace(/;\nvar /g, ", ");
        else if (s.init) init = this.ex(s.init.e)[0];
        const out = I + "for (" + init + "; " + (s.c ? this.ex(s.c)[0] : "") + "; " + (s.step ? this.ex(s.step)[0] : "") + ")\n" + this.sub(s.body, ind);
        this.unscope();
        return out;
      }
      case "switch": {
        const [c] = this.ex(s.e);
        return I + "switch (" + c + ") {\n" + s.cases.map((k) => I + (k.v == null ? "default:" : "case " + k.v + ":") + "\n" +
          k.body.map((x) => this.st(x, ind + 1)).filter(Boolean).join("\n")).join("\n") + "\n" + I + "}";
      }
      case "break": return I + "break;";
      case "continue": return I + "continue;";
      case "return": return I + "return;";
    }
    no("statement " + s.n);
  }
  sub(s, ind) { return s.n === "block" ? this.st(s, ind) : this.st(s, ind + 1); }
}
function wider(a, b) {
  if (a === "d" || b === "d") return "d";
  if (a === "f" || b === "f") return "f";
  if (a === "u" || b === "u") return "u";
  return "i";
}

// ---------- One plugin ----------
// Reads the plugin's three files; returns { id, name, params, js } or throws Unsupported.
function translate(dir, name, opts) {
  opts = opts || {};
  const h = strip(fs.readFileSync(path.join(dir, name + ".h"), "utf8"));
  const cpp = strip(fs.readFileSync(path.join(dir, name + ".cpp"), "utf8"));
  const proc = strip(fs.readFileSync(path.join(dir, name + "Proc.cpp"), "utf8"));

  // enum constants (kParamA = 0, … and any other enum in the header)
  const consts = {};
  (h.match(/enum\s*\{[^}]*\}/g) || []).forEach((en) => {
    let n = 0;
    en.replace(/enum\s*\{|\}/g, "").split(",").map((x) => x.trim()).filter(Boolean).forEach((item) => {
      const m = /^([A-Za-z_]\w*)\s*(?:=\s*([^,]+))?$/.exec(item);
      if (!m) no("enum item " + item);
      if (m[2] != null) { const v = constEval(new Parser(lex(m[2]), consts).expr()); if (v == null) no("enum value " + item); n = v; }
      consts[m[1]] = n++;
    });
  });
  (h.match(/const\s+int\s+\w+\s*=\s*[^;]+;/g) || []).forEach((c) => {
    const m = /const\s+int\s+(\w+)\s*=\s*([^;]+);/.exec(c);
    const v = constEval(new Parser(lex(m[2]), consts).expr());
    if (v != null) consts[m[1]] = v;
  });
  const nParams = consts.kNumParameters;
  if (!(nParams >= 0) || nParams > 26) no("parameters");

  // the class body after "private:"
  const cls = h.slice(h.indexOf("private:") + 8);
  const body = cls.slice(0, cls.lastIndexOf("}"));
  const vars = {};
  const PARAMS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, nParams).split("");
  const state = [];
  {
    const toks = lex(body.replace(/char\s+_programName[^;]*;/, "").replace(/std::set\s*<[^;]*;/, ""));
    const p = new Parser(toks, consts);
    while (p.k < toks.length) {
      if (p.is(";")) { p.k++; continue; }
      if (!isTypeStart(toks, p.k)) no("member " + p.where());
      const d = p.decl();
      d.vars.forEach((v) => {
        if (v.init) no("member initialiser");
        if (v.dims.length > 1) no("two-dimensional member " + v.name);
        if (PARAMS.indexOf(v.name) >= 0) { vars[v.name] = { kind: v.kind, param: true }; return; }
        vars[v.name] = { kind: v.kind, arr: v.dims.length ? v.dims[0] : 0 };
        state.push(v.name);
      });
    }
  }
  PARAMS.forEach((p) => { if (!vars[p]) no("parameter " + p + " not declared"); });

  // names and defaults
  const names = {};
  const nm = /void\s+\w+::getParameterName[\s\S]*?\{([\s\S]*?)\n\}/.exec(cpp);
  if (nm) nm[1].replace(/case\s+kParam([A-Z])\s*:\s*vst_strncpy\s*\(\s*text\s*,\s*"([^"]*)"/g, (_, p, n) => { names[p] = n; });
  const ctor = new RegExp(name + "::" + name + "\\s*\\([^)]*\\)\\s*:[^{]*\\{([\\s\\S]*?)\\n\\}").exec(cpp);
  if (!ctor) no("constructor");
  const ctorBody = ctor[1].split("\n").filter((l) => !/(_canDo|setNumInputs|setNumOutputs|setUniqueID|canProcessReplacing|canDoubleReplacing|programsAreChunks|vst_strncpy|setInitialDelay)/.test(l)).join("\n");
  const defaults = {};
  const ctorToks = lex(ctorBody);
  const cp = new Parser(ctorToks, consts);
  const ctorStmts = [];
  while (cp.k < ctorToks.length) {
    const s = cp.stmt();
    if (s.n === "expr" && s.e.n === "assign" && s.e.op === "=" && s.e.a.n === "id" && PARAMS.indexOf(s.e.a.v) >= 0) {
      const v = constEval(s.e.b);
      if (v == null) no("default of " + s.e.a.v);
      defaults[s.e.a.v] = v;
      continue;
    }
    ctorStmts.push(s);
  }

  // processDoubleReplacing
  const pm = /void\s+\w+::processDoubleReplacing\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/.exec(proc);
  if (!pm) no("processDoubleReplacing");
  let pbody = pm[1];
  // the buffer pointers: double* in1 = inputs[0]; (any names)
  const ptr = {};
  pbody = pbody.replace(/double\s*\*\s*(\w+)\s*=\s*(inputs|outputs)\[([01])\]\s*;/g, (_, n, io, ch) => {
    ptr[n] = (io === "inputs" ? "__in" : "__out") + (ch === "0" ? "L" : "R");
    return "";
  });
  if (Object.keys(ptr).length !== 4) no("buffer pointers");
  const loop = /while\s*\(\s*--sampleFrames\s*>=\s*0\s*\)/.exec(pbody);
  if (!loop) no("sample loop");
  let head = pbody.slice(0, loop.index), tail = pbody.slice(loop.index + loop[0].length);
  if (/sampleFrames/.test(tail)) no("sampleFrames used in the loop");
  Object.keys(ptr).forEach((n) => {
    const re = (x) => new RegExp(x.replace(/N/g, n), "g");
    tail = tail.replace(re("\\*\\s*N\\s*\\+\\+\\s*;"), "").replace(re("\\bN\\s*\\+\\+\\s*;"), "")
      .replace(re("\\*\\s*N\\b"), ptr[n] + "[__frame]");
    if (re("\\bN\\b").test(head) || re("\\bN\\b").test(tail)) no("other use of " + n);
  });
  pbody = head + "for (__frame = 0; __frame < sampleFrames; __frame++)" + tail;
  if (/\b(inputs|outputs)\b/.test(pbody)) no("other use of the buffers");

  const g = new Gen(Object.assign({}, vars, {
    __frame: { kind: "i" }, sampleFrames: { kind: "i" },
    __inL: { kind: "d", arr: 1 }, __inR: { kind: "d", arr: 1 }, __outL: { kind: "d", arr: 1 }, __outR: { kind: "d", arr: 1 }
  }));
  const ptoks = lex("{" + pbody + "}");
  const pp = new Parser(ptoks, consts);
  const procAst = pp.block();
  if (pp.k !== ptoks.length) no("text after the process function");
  const procJs = g.st(procAst, 1);
  const initJs = ctorStmts.map((s) => g.st(s, 1)).filter(Boolean).join("\n");

  const id = "aw_" + name.toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/.test(id)) no("id");
  const params = PARAMS.map((p, i) => ({ i: i + 1, v: p, name: names[p] || p, def: defaults[p] != null ? defaults[p] : 0.5 }));
  return { id, name, params, js: emit(id, name, params, vars, state, initJs, procJs, g.uses, opts) };
}

function arrType(kind) { return kind === "f" ? "Float32Array" : kind === "i" || kind === "b" ? "Int32Array" : kind === "u" ? "Uint32Array" : "Float64Array"; }

function emit(id, name, params, vars, state, initJs, procJs, uses, opts) {
  const meta = {
    id, name, desc: "Airwindows " + name, category: "Airwindows",
    tags: "airwindows " + (opts.tags || ""),
    sliders: params.map((p) => ({ i: p.i, name: p.name, def: Math.round(p.def * 1000) / 1000, min: 0, max: 1, inc: 0.001 })),
    inPins: ["Left", "Right"], outPins: ["Left", "Right"], usesRand: false, usesFile: false
  };
  const L = [];
  L.push("// Generated by .github/airfx/cpp2js.js from Airwindows " + name + " (LinuxVST). Do not edit: run `node .github/airfx/build.js`.");
  L.push("// Airwindows " + name + " by Chris Johnson • https://www.airwindows.com • MIT License (studio/airfx/LICENSE.md)");
  L.push("(function (g) {");
  L.push("\"use strict\";");
  L.push("var FX = " + JSON.stringify(meta) + ";");
  L.push("FX.live = [];");
  L.push("FX.create = function () {");
  L.push("var srate = 44100, sampleFrames = 0, __frame = 0, __inL, __inR, __outL, __outR, __fixed = 0, __pm = 1;");
  // rand() seeds the plugin's noise: a Park-Miller sequence (repeatable, so an export
  // sounds the same each time); the null test fixes it to the value its harness uses
  L.push("function crand() { if (__fixed) return __fixed; __pm = (__pm * 16807) % 2147483647; return __pm; }");
  if (uses.fmod) L.push("function fmod(a, b) { return a % b; }");
  if (uses.cround) L.push("function cround(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }");
  if (uses.copysign) L.push("function copysign(a, b) { a = Math.abs(a); return (b < 0 || Object.is(b, -0)) ? -a : a; }");
  if (uses.rint) L.push("function rint(x) { var r = Math.round(x); return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r; }");
  if (uses.csign) no("sign");
  params.forEach((p) => L.push("var " + p.v + " = Math.fround(" + p.def + ");"));
  state.forEach((s) => {
    const v = vars[s];
    L.push("var " + s + " = " + (v.arr ? "new " + arrType(v.kind) + "(" + v.arr + ")" : "0") + ";");
  });
  L.push("function reset() {");
  state.forEach((s) => { if (vars[s].arr) L.push("  " + s + ".fill(0);"); else L.push("  " + s + " = 0;"); });
  L.push(initJs);
  L.push("}");
  L.push("function process() {");
  L.push(procJs);
  L.push("}");
  L.push("var host = { srate: 44100, samplesblock: 128 };");
  L.push("var inst = {");
  L.push("  FX: FX,");
  L.push("  init: function () { srate = host.srate || 44100; reset(); },");
  L.push("  slider: function () {},");
  L.push("  block: function () {},");
  L.push("  sample: function (ins, outs, n, nin) {");
  L.push("    srate = host.srate || 44100;");
  L.push("    __inL = ins[0]; __inR = nin > 1 ? ins[1] : ins[0]; __outL = outs[0]; __outR = outs[1]; sampleFrames = n;");
  L.push("    process();");
  L.push("  },");
  L.push("  setSlider: function (i, v) { v = +v; if (!(v === v)) return; v = Math.fround(v < 0 ? 0 : v > 1 ? 1 : v); switch (i) { " +
    params.map((p) => "case " + p.i + ": " + p.v + " = v; break;").join(" ") + " } },");
  L.push("  getSlider: function (i) { switch (i) { " + params.map((p) => "case " + p.i + ": return " + p.v + ";").join(" ") + " } return 0; },");
  L.push("  setHost: function (k, v) { host[k] = v; },");
  L.push("  getHost: function (k) { return k === \"pdc_delay\" || k === \"ext_noinit\" ? 0 : (host[k] || 0); },");
  L.push("  getLive: function (out) { return out; },");
  L.push("  getVar: function () { return 0; },");
  L.push("  setVar: function () {},");
  L.push("  seed: function (s) { __fixed = s >>> 0; }");
  L.push("};");
  L.push("return inst;");
  L.push("};");
  L.push("(g.NULLFX || (g.NULLFX = {}))[FX.id] = FX;");
  L.push("})(typeof globalThis !== \"undefined\" ? globalThis : this);");
  return L.join("\n") + "\n";
}

module.exports = { translate, Unsupported, lex, Parser, Gen };
