// ============================================================
// orOS Layout — Find/Change and GREP (LY-W5, v1.0.0)
// Pure: works on a document's stories (paragraphs of runs), shared by
// the Find/Change dialog (findui.js), the GREP-style editor (panels.js,
// compile() checks a rule; designkit/text.js draws them) and the tests.
//   - compile(q): q { find, grep (JS regular expression, flags u),
//     cs (match case), word (whole word, letters of any script) } →
//     { re } or { error }. Text mode escapes the pattern.
//   - paraText(p): a paragraph's text; a field (page number) is U+FFFC.
//   - search(doc, q, opts): hits [{ sid, p, s, e, text }] in reading
//     order (stories by their first frame's page), at most opts.max
//     (default 2000); opts.sid limits it to one story, q.ps to
//     paragraphs of one style.
//   - expand(repl, m): the change text for one match: $& $1…$9 $$ and,
//     in GREP mode, \n \t.
//   - replace(para, s, e, text, fmt): splices a paragraph's runs; the
//     new text takes the format of the first character it replaces.
//   - change(doc, q, repl, opts): every hit changed in place (a story's
//     hits from the last to the first, so offsets hold); a hit over a
//     field is left; a new line in the change text starts a paragraph;
//     opts.ps sets the paragraph style of every paragraph with a hit,
//     opts.csTo puts a character style on the changed text, opts.keep
//     keeps the found text (format only), opts.only { sid, p, s } changes
//     just that hit; returns { n, stories }.
//   - normQueries(list): saved queries kept in Layout's preferences.
// ============================================================
(function (root) {
  "use strict";

  var FIELD = "￼", MAX_PAT = 500;

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"); }
  function compile(q) {
    q = q || {};
    var src = String(q.find || "");
    if (!src) return { error: "empty" };
    if (src.length > MAX_PAT) return { error: "long" };
    var pat = q.grep ? src : esc(src);
    if (q.word) pat = "(?<![\\p{L}\\p{N}_])(?:" + pat + ")(?![\\p{L}\\p{N}_])";
    try {
      var re = new RegExp(pat, "gu" + (q.cs ? "" : "i"));
      // a pattern that matches nothing at all ("" or a lone lookahead) would loop
      if (re.test("")) return { error: "empty" };
      re.lastIndex = 0;
      return { re: re };
    } catch (e) { return { error: "bad", msg: String(e.message || e).slice(0, 200) }; }
  }

  function runLen(r) { return r.f ? 1 : (r.t || "").length; }
  function paraText(p) { return (p.runs || []).map(function (r) { return r.f ? FIELD : r.t || ""; }).join(""); }

  // stories in reading order: by the page of their first frame, then the frame's place
  function storyOrder(doc) {
    var pos = {}, order = [], seen = {};
    (doc.pages || []).slice().sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); }).forEach(function (p, i) { pos[p.id] = i; });
    var frames = (doc.items || []).filter(function (it) { return it.t === "text" && it.story; });
    frames.sort(function (a, b) {
      var pa = pos[a.pg] === undefined ? 1e9 : pos[a.pg], pb = pos[b.pg] === undefined ? 1e9 : pos[b.pg];
      return pa - pb || (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0);
    });
    frames.forEach(function (f) { if (!seen[f.story]) { seen[f.story] = 1; order.push(f.story); } });
    (doc.stories || []).forEach(function (s) { if (!seen[s.id]) { seen[s.id] = 1; order.push(s.id); } });
    return order;
  }
  function storyById(doc, id) { var s = null; (doc.stories || []).forEach(function (x) { if (x.id === id) s = x; }); return s; }

  function search(doc, q, opts) {
    opts = opts || {};
    var c = compile(q), out = [], max = opts.max || 2000;
    if (c.error) return out;
    var ids = opts.sid ? [opts.sid] : storyOrder(doc);
    for (var k = 0; k < ids.length && out.length < max; k++) {
      var st = storyById(doc, ids[k]);
      if (!st) continue;
      for (var p = 0; p < st.paras.length && out.length < max; p++) {
        var para = st.paras[p];
        if (q.ps && para.ps !== q.ps) continue;
        var text = paraText(para), m;
        c.re.lastIndex = 0;
        while ((m = c.re.exec(text)) && out.length < max) {
          if (!m[0].length) { c.re.lastIndex++; continue; }
          out.push({ sid: st.id, p: p, s: m.index, e: m.index + m[0].length, text: m[0], m: Array.prototype.slice.call(m) });
        }
      }
    }
    return out;
  }

  function expand(repl, m, grep) {
    repl = String(repl || "");
    return repl.replace(/\$(\$|&|[1-9])|\\(n|t|\\)/g, function (all, d, e) {
      if (d === "$") return "$";
      if (d === "&") return m[0];
      if (d) return m[+d] === undefined ? "" : m[+d];
      if (!grep) return all;
      return e === "n" ? "\n" : e === "t" ? "\t" : "\\";
    });
  }

  function fmtOf(r) { var o = {}; ["cs", "b", "i", "u"].forEach(function (k) { if (r[k]) o[k] = r[k]; }); if (r.ext) o.ext = JSON.parse(JSON.stringify(r.ext)); return o; }
  // the run index at offset o, splitting a text run there
  function cut(p, o) {
    var pos = 0;
    for (var i = 0; i < p.runs.length; i++) {
      var r = p.runs[i], n = runLen(r);
      if (o === pos) return i;
      if (o < pos + n) {
        if (r.f) return i + 1;
        var a = Object.assign({}, r, { t: r.t.slice(0, o - pos) }), b = Object.assign({}, r, { t: r.t.slice(o - pos) });
        p.runs.splice(i, 1, a, b);
        return i + 1;
      }
      pos += n;
    }
    return p.runs.length;
  }
  function fmtAtOffset(p, o) {
    var pos = 0, last = null;
    for (var i = 0; i < p.runs.length; i++) {
      var r = p.runs[i], n = runLen(r);
      if (!r.f && o < pos + n) return fmtOf(r);
      if (!r.f) last = r;
      pos += n;
    }
    return last ? fmtOf(last) : {};
  }
  function replace(para, s, e, text, fmt) {
    fmt = fmt || fmtAtOffset(para, s);
    var i = cut(para, s), j = cut(para, e);
    para.runs.splice(i, j - i);
    if (text) para.runs.splice(i, 0, Object.assign({ t: text }, fmt));
  }

  // a paragraph's runs cut at offsets (ascending): one run list per new paragraph
  function splitAt(para, offs) {
    var out = [], runs = para.runs.slice(), prev = 0;
    offs.forEach(function (o) {
      var tmp = { runs: runs }, i = cut(tmp, o - prev);
      out.push(tmp.runs.slice(0, i));
      runs = tmp.runs.slice(i);
      prev = o;
    });
    out.push(runs);
    return out;
  }
  function change(doc, q, repl, opts) {
    opts = opts || {};
    var hits = search(doc, q, { sid: opts.sid, max: opts.max || 5000 }), byStory = {}, n = 0, stories = [];
    // opts.only { sid, p, s }: just that one hit (Change, one at a time)
    if (opts.only) hits = hits.filter(function (h) { return h.sid === opts.only.sid && h.p === opts.only.p && h.s === opts.only.s; });
    hits.forEach(function (h) { (byStory[h.sid] = byStory[h.sid] || []).push(h); });
    Object.keys(byStory).forEach(function (sid) {
      var st = storyById(doc, sid), list = byStory[sid], paras = {}, splits = {};
      for (var k = list.length - 1; k >= 0; k--) {
        var h = list[k], para = st.paras[h.p];
        // a hit over a field (page number) stays: the field is not text
        if (h.text.indexOf(FIELD) >= 0) continue;
        var fmt = fmtAtOffset(para, h.s);
        if (opts.csTo) fmt.cs = opts.csTo;
        var txt = opts.keep ? h.text : expand(repl, h.m, q.grep);
        // a new line in the change text (GREP \n) starts a paragraph there
        var sp = splits[h.p] = splits[h.p] || [], d = 0, own = [];
        if (q.grep && !opts.keep) {
          var bits = txt.split("\n");
          if (bits.length > 1) {
            txt = bits.join("");
            bits.slice(0, -1).forEach(function (b) { d += b.length; own.push(h.s + d); });
          }
        }
        var delta = txt.length - (h.e - h.s);
        for (var x = 0; x < sp.length; x++) sp[x] += delta;
        splits[h.p] = own.concat(sp);
        replace(para, h.s, h.e, txt, fmt);
        paras[h.p] = 1; n++;
      }
      // paragraphs from last to first, so the indexes hold
      Object.keys(paras).map(Number).sort(function (a, b) { return b - a; }).forEach(function (pi) {
        var para = st.paras[pi];
        if (opts.ps) para.ps = opts.ps;
        var offs = (splits[pi] || []).sort(function (a, b) { return a - b; });
        if (!offs.length) return;
        var out = [];
        splitAt(para, offs).forEach(function (runs) {
          var np = { ps: para.ps, runs: runs };
          if (para.ext) np.ext = JSON.parse(JSON.stringify(para.ext));
          out.push(np);
        });
        st.paras.splice.apply(st.paras, [pi, 1].concat(out));
      });
      if (Object.keys(paras).length) { stories.push(sid); if (opts.now) st.m = Math.max(opts.now, (st.m || 0) + 1); }
    });
    return { n: n, stories: stories };
  }

  function normQueries(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.slice(0, 30).forEach(function (q) {
      if (!q || typeof q !== "object" || typeof q.find !== "string" || !q.find || q.find.length > MAX_PAT) return;
      out.push({ name: String(q.name || q.find).slice(0, 60), find: q.find, change: typeof q.change === "string" ? q.change.slice(0, MAX_PAT) : "", grep: q.grep ? 1 : 0, cs: q.cs ? 1 : 0, word: q.word ? 1 : 0 });
    });
    return out;
  }

  // ready-made queries a book needs (GREP)
  var PRESETS = [
    { id: "dblspace", find: " {2,}", change: " ", grep: 1 },
    { id: "spacepunct", find: " +([,.;:·!»)])", change: "$1", grep: 1 },
    { id: "dash", find: " - ", change: " – ", grep: 1 },
    { id: "quotes", find: "\"([^\"]+)\"", change: "«$1»", grep: 1 },
    { id: "dots", find: "\\.\\.\\.", change: "…", grep: 1 },
    { id: "trail", find: " +$", change: "", grep: 1 }
  ];

  var api = { FIELD: FIELD, compile: compile, paraText: paraText, storyOrder: storyOrder, search: search, expand: expand, replace: replace, change: change, normQueries: normQueries, PRESETS: PRESETS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_FIND = api;
})(typeof window !== "undefined" ? window : this);
