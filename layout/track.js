// ============================================================
// orOS Layout — track changes (v1.0.0, LY-W12 review). With
// setup.ext.trk on, every save of a story's text (Story Editor or
// typing in the frame) is compared with the text before it: typed
// text is marked as an insertion (run ext.ins { by, at }), removed
// text stays in the story as a deletion (run ext.del { by, at }) that
// text.js never sets. Formatting and paragraph breaks are not
// tracked. Accept or reject one by one in a range, or all; a deletion
// can only go by accepting or rejecting it.
// Pure part (LY_TRACK / module.exports): mark(old, new, who, now,
// positions) → { paras, pos }, accept / reject(paras, range|null) →
// { paras, n }, count(paras) → { ins, del, by[] }, list(paras).
// Browser part: LY.track (the toggle, the reviewer's name, accept /
// reject in the Story Editor).
// ============================================================
(function (root) {
  "use strict";

  var CELLS = 4000000;

  function atomic(r) { return !!(r.f || (r.ext && (r.ext.fn || r.ext.xr || r.ext.fld || r.ext.sup))); }
  function lenOf(r) { return r.f ? 1 : String(r.t || "").length; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  // a run without its text and its review marks
  function attrsOf(r) {
    var o = {};
    Object.keys(r).forEach(function (k) { if (k !== "t") o[k] = r[k]; });
    if (o.ext) {
      var e = {};
      Object.keys(o.ext).forEach(function (k) { if (k !== "ins" && k !== "del") e[k] = o.ext[k]; });
      if (Object.keys(e).length) o.ext = e; else delete o.ext;
    }
    return o;
  }

  // paragraphs → tokens: c (a word, spaces or a character), a (an atom run), d (a
  // deletion run, one piece), p (the break before a paragraph)
  function tokens(paras) {
    var out = [];
    paras.forEach(function (p, i) {
      out.push({ k: "p", para: p, i: i });
      (p.runs || []).forEach(function (r) {
        if (r.ext && r.ext.del) { out.push({ k: "d", run: r, n: lenOf(r), key: JSON.stringify(r) }); return; }
        if (atomic(r)) { out.push({ k: "a", run: r, n: lenOf(r), key: JSON.stringify(attrsOf(r)) + (r.t || "") }); return; }
        // text by words: a word, a run of spaces, or one other character
        var t = String(r.t || ""), at = attrsOf(r), ins = r.ext && r.ext.ins ? r.ext.ins : null, re = /[\p{L}\p{M}\p{N}]+|\s+|[^]/gu, m;
        while ((m = re.exec(t))) out.push({ k: "c", ch: m[0], at: at, ins: ins, n: m[0].length });
      });
    });
    return out;
  }
  function same(a, b) {
    if (a.k !== b.k) return false;
    if (a.k === "c") return a.ch === b.ch;
    if (a.k === "p") return true;
    return a.key === b.key;
  }

  // the edit script: [["=", oi, ni] | ["-", oi] | ["+", ni]], deletions
  // before insertions in a hunk
  function script(A, B) {
    var a0 = 0, n = A.length, m = B.length;
    while (a0 < n && a0 < m && same(A[a0], B[a0])) a0++;
    var ea = n, eb = m;
    while (ea > a0 && eb > a0 && same(A[ea - 1], B[eb - 1])) { ea--; eb--; }
    var ops = [], i, j;
    for (i = 0; i < a0; i++) ops.push(["=", i, i]);
    var N = ea - a0, Mm = eb - a0;
    if (N * Mm > CELLS || !N || !Mm) {
      for (i = a0; i < ea; i++) ops.push(["-", i]);
      for (j = a0; j < eb; j++) ops.push(["+", j]);
    } else {
      var L = [];
      for (i = 0; i <= N; i++) L.push(new Uint32Array(Mm + 1));
      for (i = N - 1; i >= 0; i--) for (j = Mm - 1; j >= 0; j--)
        L[i][j] = same(A[a0 + i], B[a0 + j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      i = 0; j = 0;
      var del = [], ins = [];
      function flushHunk() { del.forEach(function (x) { ops.push(x); }); ins.forEach(function (x) { ops.push(x); }); del = []; ins = []; }
      while (i < N || j < Mm) {
        if (i < N && j < Mm && same(A[a0 + i], B[a0 + j])) { flushHunk(); ops.push(["=", a0 + i, a0 + j]); i++; j++; }
        else if (j < Mm && (i >= N || L[i][j + 1] >= L[i + 1][j])) { ins.push(["+", a0 + j]); j++; }
        else { del.push(["-", a0 + i]); i++; }
      }
      flushHunk();
    }
    for (i = ea, j = eb; i < n; i++, j++) ops.push(["=", i, j]);
    return ops;
  }

  // (p, o) → [the token it is in or before, the offset in it]
  function tokIndex(T, pos) {
    var pi = -1, o = 0;
    for (var k = 0; k < T.length; k++) {
      var tk = T[k];
      if (tk.k === "p") { if (pi === pos.p) return [k, 0]; pi++; o = 0; continue; }
      if (pi === pos.p && o >= pos.o) return [k, 0];
      if (pi === pos.p && o + tk.n > pos.o) return tk.k === "c" ? [k, pos.o - o] : [k + 1, 0];
      o += tk.n;
    }
    return [T.length, 0];
  }
  // token index → (p, o)
  function posOf(T, k) {
    var pi = -1, o = 0;
    for (var i = 0; i < Math.min(k, T.length); i++) { if (T[i].k === "p") { pi++; o = 0; } else o += T[i].n; }
    return { p: Math.max(0, pi), o: o };
  }

  // tokens → paragraphs
  function build(T) {
    var paras = [], cur = null, txt = null;
    function endTxt() { txt = null; }
    T.forEach(function (tk) {
      if (tk.k === "p") {
        var p = {};
        Object.keys(tk.para).forEach(function (k) { if (k !== "runs") p[k] = tk.para[k]; });
        p.runs = []; paras.push(p); cur = p; endTxt(); return;
      }
      if (tk.k === "a" || tk.k === "d") { cur.runs.push(clone(tk.run)); endTxt(); return; }
      var key = JSON.stringify(tk.at) + "|" + JSON.stringify(tk.ins || null) + "|" + JSON.stringify(tk.del || null);
      if (txt && txt.key === key) { txt.run.t += tk.ch; return; }
      var r = clone(tk.at);
      r.t = tk.ch;
      if (tk.ins || tk.del) {
        r.ext = Object.assign({}, r.ext || {});
        if (tk.ins) r.ext.ins = tk.ins;
        if (tk.del) r.ext.del = tk.del;
      }
      cur.runs.push(r);
      txt = { key: key, run: r };
    });
    return paras;
  }

  // the new text, marked against the old; pos: positions in the new
  // paragraphs, given back where they are in the result
  function mark(oldParas, newParas, who, now, pos) {
    var A = tokens(oldParas || []), B = tokens(newParas || []), ops = script(A, B);
    var stamp = { by: String(who || "").slice(0, 40), at: Math.round(now || 0) }, out = [], at = {};
    var hasP = false;
    ops.forEach(function (op) {
      if (op[0] === "=") {
        var e = B[op[2]], was = A[op[1]];
        at[op[2]] = out.length;
        // unchanged text keeps the mark it had (an editor may drop it)
        if (e.k === "c" && (e.ins || null) !== (was.ins || null)) e = { k: "c", ch: e.ch, at: e.at, ins: was.ins, n: e.n };
        out.push(e);
        if (e.k === "p") hasP = true;
        return;
      }
      if (op[0] === "+") {
        var b = B[op[1]];
        at[op[1]] = out.length;
        if (b.k === "p") { out.push(b); hasP = true; return; }
        if (b.k === "c") { out.push(b.ins ? b : { k: "c", ch: b.ch, at: b.at, ins: stamp, n: b.n }); return; }
        if (b.k === "a") {
          var r = clone(b.run);
          if (!(r.ext && r.ext.ins)) r.ext = Object.assign({}, r.ext || {}, { ins: stamp });
          out.push({ k: "a", run: r, n: b.n }); return;
        }
        out.push(b); return;   // a deletion typed back: as it was
      }
      var a = A[op[1]];
      if (a.k === "p") return;                // a join: not tracked
      if (a.k === "d") { out.push(a); return; }   // a deletion stays until accepted or rejected
      if (a.k === "c") { if (!a.ins) out.push({ k: "c", ch: a.ch, at: a.at, del: stamp, n: a.n }); return; }
      if (a.run.ext && a.run.ext.ins) return;
      var dr = clone(a.run);
      dr.ext = Object.assign({}, dr.ext || {}, { del: stamp });
      out.push({ k: "d", run: dr, n: lenOf(dr) });
    });
    if (!hasP || out[0].k !== "p") out.unshift({ k: "p", para: (newParas && newParas[0]) || { ps: "ps-body" } });
    var paras = build(out);
    var res = { paras: paras };
    if (pos) res.pos = pos.map(function (p) {
      var ko = tokIndex(B, p), k = ko[0], oi = k >= B.length ? out.length : at[k];
      var r = posOf(out, oi === undefined ? out.length : oi);
      if (oi !== undefined && out[oi] && out[oi].k === "c") r.o += ko[1];
      return r;
    });
    return res;
  }

  // a run's change: "ins" | "del" | ""
  function kindOf(r) { return r.ext && r.ext.del ? "del" : r.ext && r.ext.ins ? "ins" : ""; }
  function inRange(range, p, o0, o1) {
    if (!range) return true;
    var a = range.a, b = range.b;
    if (p < a.p || p > b.p) return false;
    if (p === a.p && o1 <= a.o && !(a.p === b.p && a.o === b.o && o1 === a.o)) return false;
    if (p === b.p && o0 >= b.o && !(a.p === b.p && a.o === b.o && o0 === b.o)) return false;
    return true;
  }
  // accept (keep = true) or reject the changes that touch range (or all)
  function settle(paras, range, keep) {
    var n = 0;
    var out = paras.map(function (p, pi) {
      var o = 0, runs = [];
      (p.runs || []).forEach(function (r) {
        var k = kindOf(r), len = lenOf(r), hit = k && inRange(range, pi, o, o + len);
        o += len;
        if (!hit) { runs.push(r); return; }
        n++;
        var goes = (k === "ins") !== keep;   // reject an insertion, accept a deletion
        if (goes) return;
        var c = clone(r);
        delete c.ext.ins; delete c.ext.del;
        if (!Object.keys(c.ext).length) delete c.ext;
        runs.push(c);
      });
      var q = {};
      Object.keys(p).forEach(function (k) { q[k] = p[k]; });
      q.runs = runs;
      return q;
    });
    return { paras: out, n: n };
  }
  function accept(paras, range) { return settle(paras, range, true); }
  function reject(paras, range) { return settle(paras, range, false); }
  // [{ p, o, k, t, by, at }]
  function list(paras) {
    var out = [];
    (paras || []).forEach(function (p, pi) {
      var o = 0;
      (p.runs || []).forEach(function (r) {
        var k = kindOf(r);
        if (k) {
          var m = r.ext[k], last = out[out.length - 1];
          if (last && last.k === k && last.p === pi && last.o + last.n === o && last.by === m.by) { last.t += r.t || ""; last.n += lenOf(r); }
          else out.push({ p: pi, o: o, n: lenOf(r), k: k, t: r.f ? "#" : String(r.t || ""), by: String(m.by || ""), at: m.at || 0 });
        }
        o += lenOf(r);
      });
    });
    return out;
  }
  function count(paras) {
    var c = { ins: 0, del: 0, by: [] };
    list(paras).forEach(function (x) { c[x.k]++; if (x.by && c.by.indexOf(x.by) < 0) c.by.push(x.by); });
    return c;
  }
  // any change left in the text
  function hasMarks(paras) { return (paras || []).some(function (p) { return (p.runs || []).some(function (r) { return !!kindOf(r); }); }); }

  var api = { mark: mark, accept: accept, reject: reject, list: list, count: count, hasMarks: hasMarks, tokens: tokens, script: script };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.LY_TRACK = api;

  // ---------- browser: LY.track ----------
  var LY = root.LY;
  if (!LY) return;
  var t = LY.t;
  function on() { var x = LY.doc && LY.doc.setup.ext; return !!(x && x.trk); }
  function who() { return String(LY.prefs.revName || "").trim().slice(0, 40) || t("trk.me"); }
  function setOn(v) {
    LY.op(function (doc, now) {
      var x = Object.assign({}, doc.setup.ext || {});
      if (!!x.trk === !!v) return false;
      if (v) x.trk = 1; else delete x.trk;
      doc.setup.ext = x;
      doc.m = Math.max(now, (doc.m || 0) + 1);
    });
    LY.toast(t(v ? "trk.onToast" : "trk.offToast"));
  }
  function askName(done) {
    LY.prompt(t("trk.name"), LY.prefs.revName || "", function (v) {
      v = String(v || "").trim().slice(0, 40);
      if (v) LY.prefs.revName = v; else delete LY.prefs.revName;
      LY.savePrefs();
      if (done) done();
    });
  }
  // the menu items for the Story Editor (settle(fn, all) applies to the
  // selection or the whole story there, untracked)
  function menu(settle, paras) {
    var c = count(paras || []);
    return [
      { label: t(on() ? "trk.turnOff" : "trk.turnOn"), fn: function () { setOn(!on()); } },
      { label: t("trk.acceptSel"), fn: function () { settle(accept, false); } },
      { label: t("trk.rejectSel"), fn: function () { settle(reject, false); } },
      { label: t("trk.acceptAll", { n: c.ins + c.del }), fn: function () { settle(accept, true); } },
      { label: t("trk.rejectAll", { n: c.ins + c.del }), fn: function () { settle(reject, true); } },
      { label: t("trk.nameMenu", { name: who() }), fn: function () { askName(); } }
    ];
  }
  LY.track = {
    on: on, setOn: setOn, who: who, menu: menu,
    mark: function (oldP, newP, pos) { return mark(oldP, newP, who(), Date.now(), pos); }
  };
})(typeof window !== "undefined" ? window : this);
