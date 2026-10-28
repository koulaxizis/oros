// ============================================================
// orOS Layout — Automatic layout in a house style (v1.0.0, LY-AUTO)
// A manuscript (Writer's reader → layout/wordin.js paragraphs with
// roles) becomes a first layout of a new book in a house style
// (layout/house.js):
//   1. the house style document is copied (its setup, masters, styles,
//      front and back matter, rules);
//   2. the fields {title} {subtitle} {author} {isbn} {year} {publisher}
//      (or {τίτλος} {υπότιτλος} {συγγραφέας} {έτος} {εκδότης}) in its
//      stories are filled from the book's details;
//   3. roles: a short, all-bold paragraph after an empty one or at the
//      start is taken as a title (counted as guessed); empty paragraphs
//      next to titles and at the ends go; each role takes the house's
//      style (setup.ext.wmap), a role the house has no style for takes
//      the body's (counted for the check list); the house's text fixes
//      (quotes, dashes…) run, words never change;
//   4. the text flows from the house's body page through as many pages
//      as it needs (one frame per page inside the margins, the house's
//      columns and body master), titles on new or odd pages as the
//      styles say; the back matter follows;
//   5. the contents (a story marked ext.hs "toc") are made from the
//      titles and the pages they landed on (toc(), also "Update
//      contents" later);
//   6. a report: pages, titles (guessed), fixes, fields filled, what to
//      check (overset, a role without a style, pictures not placed).
// Pure (designkit + house.js), testable under Node.
// Exposes LY_AUTO (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M, T, R, H;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js"); R = require("../designkit/render.js"); H = require("./house.js");
  } else { M = root.orosDK.model; T = root.orosDK.text; R = root.orosDK.render; H = root.LY_HOUSE; }

  // i18n-inline-ok: the Greek names a template may give its fields, data
  var FIELDS = {
    title: ["title", "τίτλος"], subtitle: ["subtitle", "υπότιτλος"], author: ["author", "συγγραφέας"],
    isbn: ["isbn"], year: ["year", "έτος"], publisher: ["publisher", "εκδότης"]
  };
  var MAX_PASSES = 12, GUESS_LEN = 80, FRONT_MAX = 40;
  var TOC_TAIL = /(\t|\s{2,}|\.{3,}|…+|\s)(\d{1,4})\s*$/;

  function textOf(p) { return (p.runs || []).map(function (r) { return r.t || ""; }).join(""); }

  // ---------- 2. Fields ----------
  function fillFields(d, meta) {
    var n = 0, alias = {};
    Object.keys(FIELDS).forEach(function (k) { FIELDS[k].forEach(function (a) { alias[a] = k; }); });
    var re = /\{([^{}\s]{2,12})\}/g;
    d.stories.forEach(function (st) {
      st.paras.forEach(function (p) {
        (p.runs || []).forEach(function (r) {
          if (typeof r.t !== "string" || r.t.indexOf("{") < 0) return;
          r.t = r.t.replace(re, function (m, name) {
            var k = alias[name.toLocaleLowerCase()];
            if (!k || meta[k] === undefined || meta[k] === null || meta[k] === "") return m;
            n++;
            return String(meta[k]).slice(0, 400);
          });
        });
      });
    });
    return n;
  }

  // ---------- 3. Roles ----------
  // list: [{ role, runs }] (layout/wordin.js parse). A manuscript often
  // marks a title only by its look: a short line all in bold after an
  // empty one, or a short centred line after three or more empty ones
  // (pushed to a new page by hand). The manuscript's own front matter
  // (the few short lines before the first title that running text
  // follows) is left out unless opts.keepFront: the house's is used.
  function structure(list, opts) {
    opts = opts || {};
    var out = [], guessed = 0, dropped = 0, front = 0;
    list.forEach(function (p, i) {
      var t = textOf(p).trim(), empties = 0;
      for (var k = i - 1; k >= 0 && !list[k].runs.length; k--) empties++;
      var bold = p.runs.length && p.runs.every(function (r) { return r.b || !String(r.t).trim(); });
      // a line of stars or dots between scenes is never a title
      var words = t.toUpperCase() !== t.toLowerCase() || /\d/.test(t);
      var short = t && words && t.length <= GUESS_LEN && i < list.length - 1;
      var asTitle = /^(p|p1|center)$/.test(p.role) && short &&
        ((bold && (empties || !i)) || (p.role === "center" && empties >= 3));
      if (asTitle) {
        p = { role: "h1", runs: p.runs.map(function (r) { var o = { t: r.t }; if (r.i) o.i = 1; if (r.u) o.u = 1; return o; }), guessed: 1 };
        guessed++;
      }
      out.push(p);
    });
    if (!opts.keepFront) {
      var start = -1;
      out.some(function (p, i) {
        if (!/^h/.test(p.role)) return false;
        // running text up to the next title (short paragraphs count too)
        for (var k = i + 1, chars = 0; k < out.length && !/^h/.test(out[k].role); k++) {
          chars += textOf(out[k]).length;
          if (chars > 200) { start = i; return true; }
        }
        return false;
      });
      // front matter is a few short lines; running text before the first
      // title is the book's own and stays
      var before = out.slice(0, Math.max(0, start)).filter(function (p) { return p.runs.length; });
      if (before.length > FRONT_MAX || before.some(function (p) { return textOf(p).length > 400; })) start = -1;
      if (start > 0) {
        out.slice(0, start).forEach(function (p) { if (p.guessed) guessed--; if (p.runs.length) front++; });
        out = out.slice(start);
      }
    }
    // empty paragraphs at the ends and next to titles go
    var keep = out.filter(function (p, i) {
      if (p.runs.length) return true;
      var a = null, b = null, k;
      for (k = i - 1; k >= 0; k--) if (out[k].runs.length) { a = out[k]; break; }
      for (k = i + 1; k < out.length; k++) if (out[k].runs.length) { b = out[k]; break; }
      var head = function (x) { return x && /^h/.test(x.role); };
      if (!a || !b || head(a) || head(b)) { dropped++; return false; }
      return true;
    });
    // two empty paragraphs in a row: one
    keep = keep.filter(function (p, i) { if (p.runs.length || !i || keep[i - 1].runs.length) return true; dropped++; return false; });
    // the first paragraph after a title, again
    keep.forEach(function (p, i) {
      if (p.role === "p1" && i && keep[i - 1].runs.length && !/^h/.test(keep[i - 1].role)) p.role = "p";
      if (p.role === "p" && i && /^h/.test(keep[i - 1].role)) p.role = "p1";
    });
    return { list: keep, guessed: guessed, dropped: dropped, front: front };
  }

  // ---------- 4. Flow ----------
  function frameFor(d, pg, idx) {
    var m = M.margins(d, M.sideOf(d, idx)), s = d.setup;
    return { id: M.newId("it"), m: d.m, t: "text", pg: pg.id, x: m.l, y: m.t, w: Math.max(10, s.w - m.l - m.r), h: Math.max(10, s.h - m.t - m.b), cols: s.cols, gut: s.gut, story: "", seq: 0, z: 1 };
  }
  // the document with n body pages: front, body × n, back
  function withBody(base, n, sid, now) {
    var d = JSON.parse(JSON.stringify(base));
    var order = M.pagesInOrder(d), bodyAt = -1;
    order.forEach(function (p, i) { if (p.ext && p.ext.hs === "body" && bodyAt < 0) bodyAt = i; });
    if (bodyAt < 0) bodyAt = order.length;
    var first = order[bodyAt], pages = order.slice(0, bodyAt), body = [];
    for (var i = 0; i < n; i++) {
      body.push(i === 0 && first ? first : { id: M.newId("pg"), m: now, pos: 0, ms: first ? first.ms : (order[0] && order[0].ms) || "", ext: { hs: "body" } });
    }
    pages = pages.concat(body, order.slice(bodyAt + (first ? 1 : 0)));
    pages.forEach(function (p, i) { p.pos = (i + 1) * 1024; });
    d.pages = pages;
    body.forEach(function (p, k) {
      var f = frameFor(d, p, pages.indexOf(p));
      f.story = sid; f.seq = (k + 1) * 1024; f.m = now;
      d.items.push(f);
    });
    return M.normDoc(d);
  }
  // pages to flow the story: grow from an estimate until it fits, then
  // drop the empty pages at the end
  function flow(base, sid, now) {
    var st = M.find(base.stories, sid), total = 0;
    st.paras.forEach(function (p) { total += textOf(p).length + 1; });
    var n = 1, d = null, L = null, passes = 0;
    while (passes++ < MAX_PASSES) {
      d = withBody(base, n, sid, now);
      L = R.computeLayout(d);
      if (!L.overset[sid]) break;
      // the characters placed so far → the pages it needs
      var lastP = -1;
      M.chain(d, sid).forEach(function (f) { (L.frames[f.id] || { lines: [] }).lines.forEach(function (ln) { if (ln.p > lastP) lastP = ln.p; }); });
      var placed = 0;
      st.paras.forEach(function (p, i) { if (i < lastP) placed += textOf(p).length + 1; });
      var want = placed > 0 ? Math.ceil(n * total / placed * 1.05) + 1 : n * 2;
      n = Math.min(M.MAX_PAGES - base.pages.length, Math.max(n + 1, want));
      if (n <= 0) break;
    }
    // trim: the body pages after the last one with text
    var ch = M.chain(d, sid), used = 0;
    ch.forEach(function (f, k) { if ((L.frames[f.id] || { lines: [] }).lines.length) used = k + 1; });
    if (used && used < ch.length) { d = withBody(base, used, sid, now); L = R.computeLayout(d); }
    return { doc: d, L: L, pages: used || n, overset: !!L.overset[sid] };
  }

  // ---------- 5. Contents ----------
  // The contents story (ext.hs "toc") made again from the titles
  // (paragraphs in the title style) and their pages. Its first entry
  // gives the look: its paragraph style, the text between title and
  // number, its runs' attributes. → entries, or -1 when there is none.
  function toc(d, L) {
    var h = H.houseOf(d), title = h && h.roles && h.roles.title;
    var st = null;
    d.stories.forEach(function (s) { if (s.ext && s.ext.hs === "toc") st = s; });
    if (!st || !title) return -1;
    L = L || R.computeLayout(d);
    var tpl = null;
    st.paras.some(function (p) { var m = TOC_TAIL.exec(textOf(p)); if (m) { tpl = { p: p, sep: m[1] }; return true; } return false; });
    var heads = st.paras.filter(function (p) { return !TOC_TAIL.test(textOf(p)); });
    // the heading of the contents ("Contents") stays above the entries
    var before = [];
    for (var i = 0; i < st.paras.length && !TOC_TAIL.test(textOf(st.paras[i])); i++) before.push(st.paras[i]);
    var order = M.pagesInOrder(d), first = M.firstNumber(d), pgIdx = {};
    order.forEach(function (p, k) { pgIdx[p.id] = k; });
    var entries = [];
    d.stories.forEach(function (s) {
      if (s.id === st.id || (s.ext && s.ext.hs)) return;
      var at = {};
      M.chain(d, s.id).forEach(function (f) {
        if (pgIdx[f.pg] === undefined) return;
        (L.frames[f.id] || { lines: [] }).lines.forEach(function (ln) { if (at[ln.p] === undefined) at[ln.p] = pgIdx[f.pg]; });
      });
      s.paras.forEach(function (p, k) {
        if (p.ps !== title || !textOf(p).trim() || at[k] === undefined) return;
        entries.push({ t: textOf(p).replace(/\s+/g, " ").trim(), no: at[k] + first, k: at[k] });
      });
    });
    entries.sort(function (a, b) { return a.k - b.k; });
    var ps = tpl ? tpl.p.ps : (heads[0] && heads[0].ps) || "ps-base", sep = tpl ? tpl.sep : "\t";
    var attrs = {};
    if (tpl && tpl.p.runs[0]) Object.keys(tpl.p.runs[0]).forEach(function (k) { if (k !== "t" && k !== "f") attrs[k] = tpl.p.runs[0][k]; });
    st.paras = before.concat(entries.map(function (e) {
      var r = { t: e.t + sep + e.no };
      Object.keys(attrs).forEach(function (k) { r[k] = attrs[k]; });
      return { ps: ps, runs: [r] };
    }));
    if (!st.paras.length) st.paras = [{ ps: ps, runs: [] }];
    return entries.length;
  }

  // ---------- Build ----------
  // house: a house style document; list: wordin paragraphs; meta: the
  // book's details; opts { now, name, pictures (found in the file) }
  function build(house, list, meta, opts) {
    opts = opts || {};
    meta = meta || {};
    var h = H.houseOf(house);
    if (!h) return null;
    var now = opts.now || 1;
    var d = M.copyDoc(house, now);
    d.name = String(meta.title || opts.name || d.name).slice(0, 120);
    var filled = fillFields(d, meta);
    var s = structure(list || [], opts);
    var map = H.wmapOf(h.roles), have = {};
    d.pstyles.forEach(function (x) { have[x.id] = 1; });
    var noStyle = {};
    var paras = s.list.map(function (p) {
      var id = map[p.role];
      var own = { h1: "title", h2: "subtitle", p1: "first", center: "center", quote: "quote" }[p.role];
      if (own && !h.roles[own] && p.runs.length) noStyle[p.role] = (noStyle[p.role] || 0) + 1;
      return { ps: have[id] ? id : (have[map.p] ? map.p : "ps-base"), runs: p.runs };
    });
    var fx = H.fixText(paras, h.rules);
    var st = { id: M.newId("st"), m: now, h: [], paras: fx.paras.length ? fx.paras : [{ ps: map.p, runs: [] }] };
    d.stories.push(st);
    d = M.normDoc(d);
    var fl = flow(d, st.id, now);
    d = fl.doc;
    var L = fl.L, n = toc(d, L);
    if (n >= 0) { d = M.normDoc(d); L = R.computeLayout(d); }
    // pages to check: stories overset here that were not already in
    // the house style (the contents too long, a field filled with a
    // long title, the text longer than the pages allow)
    var check = [], was = R.computeLayout(house).overset;
    var order = M.pagesInOrder(d);
    Object.keys(L.overset).forEach(function (sid) {
      if (!L.overset[sid] || was[sid]) return;
      var ch = M.chain(d, sid), last = ch[ch.length - 1];
      if (last) check.push({ page: order.map(function (p) { return p.id; }).indexOf(last.pg) + 1, why: sid === st.id ? "overset" : "oversetOther", id: last.id });
    });
    var titles = fx.paras.filter(function (p) { return p.ps === h.roles.title; }).length;
    var report = {
      pages: d.pages.length, body: fl.pages, titles: titles, guessed: s.guessed, dropped: s.dropped, front: s.front, fixes: fx.n,
      fields: filled, toc: n, noStyle: noStyle, pictures: opts.pictures || 0, check: check
    };
    return { doc: d, report: report };
  }

  var api = { FIELDS: FIELDS, build: build, structure: structure, fillFields: fillFields, toc: toc, flow: flow };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_AUTO = api;
})(typeof window !== "undefined" ? window : this);
