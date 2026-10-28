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

  var M, T, R, H, I;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js"); R = require("../designkit/render.js"); H = require("./house.js"); I = require("./intake.js");
  } else { M = root.orosDK.model; T = root.orosDK.text; R = root.orosDK.render; H = root.LY_HOUSE; I = root.LY_INTAKE; }

  // i18n-inline-ok: the Greek names a template may give its fields, data
  var FIELDS = {
    title: ["title", "τίτλος"], subtitle: ["subtitle", "υπότιτλος"], author: ["author", "συγγραφέας"],
    isbn: ["isbn"], year: ["year", "έτος"], publisher: ["publisher", "εκδότης"], editor: ["editor", "επιμέλεια"]
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
    var out = [], guessed = 0, dropped = 0, front = 0, cut = [];
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
        var was = p;
        p = { role: "h1", runs: p.runs.map(function (r) { var o = { t: r.t }; if (r.i) o.i = 1; if (r.u) o.u = 1; return o; }), guessed: 1 };
        if (was.pics) p.pics = was.pics;
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
        cut = out.slice(0, start);
        cut.forEach(function (p) { if (p.guessed) guessed--; if (p.runs.length) front++; });
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
    firstAgain(keep);
    return { list: keep, guessed: guessed, dropped: dropped, front: front, cut: cut };
  }
  // the first paragraph after a title, again
  function firstAgain(list) {
    list.forEach(function (p, i) {
      if (p.role === "p1" && i && list[i - 1].runs.length && !/^h/.test(list[i - 1].role)) p.role = "p";
      if (p.role === "p" && i && /^h/.test(list[i - 1].role)) p.role = "p1";
    });
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
  // (paragraphs in the title style, the styles of parts and of the
  // chapter after a part, LY-IN) and their pages. Its first entry
  // gives the look: its paragraph style, the text between title and
  // number, its runs' attributes. → entries, or -1 when there is none.
  function toc(d, L) {
    var h = H.houseOf(d), title = h && h.roles && h.roles.title;
    var st = null, heads = {}, book = d.setup.ext && d.setup.ext.book;
    d.stories.forEach(function (s) { if (s.ext && s.ext.hs === "toc") st = s; });
    if (!st || !title) return -1;
    heads[title] = 1;
    if (M.find(d.pstyles, "ps-hsopen")) heads["ps-hsopen"] = 1;
    ((book && Array.isArray(book.partPs)) ? book.partPs : []).forEach(function (id) { heads[id] = 1; });
    L = L || R.computeLayout(d);
    var tpl = null;
    st.paras.some(function (p) { var m = TOC_TAIL.exec(textOf(p)); if (m) { tpl = { p: p, sep: m[1] }; return true; } return false; });
    var plain = st.paras.filter(function (p) { return !TOC_TAIL.test(textOf(p)); });
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
        if (!heads[p.ps] || !textOf(p).trim() || at[k] === undefined) return;
        entries.push({ t: textOf(p).replace(/\s+/g, " ").trim(), no: at[k] + first, k: at[k] });
      });
    });
    entries.sort(function (a, b) { return a.k - b.k; });
    var ps = tpl ? tpl.p.ps : (plain[0] && plain[0].ps) || "ps-base", sep = tpl ? tpl.sep : "\t";
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

  // ---------- 5b. Pictures (LY-IN) ----------
  // Each picture goes where the sheet says: "page" a page of its own
  // before the page its paragraph is on (a chapter opening on a right-
  // or left-hand page keeps its side: an empty page before it takes the
  // picture, else an empty page and the picture's page go in), "before"
  // at the top of that page with the text below it (wrap), "out" not at
  // all. picSize "text" fits the text area, "page" fills the page to the
  // bleed. A caption (ps-hscap) goes below or above. Pictures from
  // outside the manuscript (extra) go after chapter n ("after<n>") or
  // after the text ("end"), each on a page of its own. Then body pages
  // are added until the text fits again.
  var CAP_H = 3;   // lines a caption frame is made for
  function bodyPages(d) { return M.pagesInOrder(d).filter(function (p) { return p.ext && p.ext.hs === "body"; }); }
  function insertPages(d, before, pages) {
    var order = M.pagesInOrder(d), at = before ? order.indexOf(before) : order.length;
    if (at < 0) at = order.length;
    order.splice.apply(order, [at, 0].concat(pages));
    order.forEach(function (p, i) { p.pos = (i + 1) * 1024; });
    d.pages = order;
  }
  function capText(pic, k, sheet) {
    var src = I.ans(sheet, "capSrc"), own = sheet.pics && sheet.pics[k] && sheet.pics[k].cap;
    if (src === "typed") return own || "";
    if (src === "file") return own || String(pic.alt || pic.nm || "").replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 300);
    return own || pic.cap || "";
  }
  function addCap(d, pg, box, text, where, now, wrap) {
    var ps = M.find(d.pstyles, "ps-hscap") ? "ps-hscap" : "ps-base", r = T.resolvePs(T.byId(d.pstyles), ps);
    var h = (r.lead > 0 ? r.lead : r.size * 1.2) * CAP_H + 2, sid = M.newId("st");
    d.stories.push({ id: sid, m: now, paras: [{ ps: ps, runs: [{ t: text }] }] });
    var it = { id: M.newId("it"), m: now, t: "text", pg: pg.id, x: box.x, y: where === "above" ? box.y - h - 4 : box.y + box.h + 4, w: box.w, h: h, story: sid, seq: 1, z: 3, va: where === "above" ? "b" : "t" };
    if (wrap) { it.wrap = "box"; it.wo = 6; }
    d.items.push(it);
    return h + 4;
  }
  function addImg(d, pg, pic, box, now, wrap) {
    var it = { id: M.newId("it"), m: now, t: "img", pg: pg.id, x: box.x, y: box.y, w: box.w, h: box.h, a: pic.a, nm: String(pic.nm || "").slice(0, 120), iw: pic.iw, ih: pic.ih, fit: "fit", z: 2 };
    if (wrap) { it.wrap = "box"; it.wo = 8; }
    d.items.push(it);
  }
  // a picture on a page of its own
  function picPage(d, pg, pic, text, sheet, side, now) {
    var u = d.setup, m = M.margins(d, side), full = I.ans(sheet, "picSize") === "page" || (I.ans(sheet, "picSize") === "s" && (H.houseOf(d).pics || {}).size === "page");
    var where = capWhere(d, sheet), capH = text && where !== "none" ? (function () { var r = T.resolvePs(T.byId(d.pstyles), M.find(d.pstyles, "ps-hscap") ? "ps-hscap" : "ps-base"); return (r.lead > 0 ? r.lead : r.size * 1.2) * CAP_H + 6; })() : 0;
    var box;
    if (full) {
      var b = u.bleed || 0;
      box = { x: -b, y: -b, w: u.w + 2 * b, h: u.h + 2 * b };
    } else {
      var aw = u.w - m.l - m.r, ah = u.h - m.t - m.b - capH, k = Math.min(aw / pic.iw, ah / pic.ih);
      var w = pic.iw * k, h = pic.ih * k;
      box = { x: m.l + (aw - w) / 2, y: m.t + (where === "above" ? capH : 0) + (ah - h) / 2, w: w, h: h };
    }
    addImg(d, pg, pic, box, now, false);
    if (capH) {
      var cb = full ? { x: m.l, y: u.h - m.b - capH, w: u.w - m.l - m.r, h: 0 } : box;
      addCap(d, pg, full ? { x: cb.x, y: cb.y - 4, w: cb.w, h: 0 } : cb, text, full ? "below" : where, now, false);
    }
  }
  function capWhere(d, sheet) {
    var c = I.ans(sheet, "cap");
    return c === "s" ? ((H.houseOf(d).pics || {}).cap || "below") : c;
  }
  // the first line of paragraph pi of the story → { pg, top, ps }
  function lineOf(d, L, sid, pi) {
    var hit = null;
    M.chain(d, sid).some(function (f) {
      var lines = (L.frames[f.id] || { lines: [] }).lines;
      for (var k = 0; k < lines.length; k++) if (lines[k].p === pi) { hit = { pg: M.find(d.pages, f.pg), top: k === 0 }; return true; }
      return false;
    });
    return hit;
  }
  // the paragraph whose first line opens a page (else null)
  function firstOn(d, L, sid, pg) {
    var f = M.chain(d, sid).filter(function (x) { return x.pg === pg.id; })[0];
    var ln = f && (L.frames[f.id] || { lines: [] }).lines[0];
    if (!ln) return null;
    var before = false;
    M.chain(d, sid).some(function (x) {
      if (x === f) return true;
      if ((L.frames[x.id] || { lines: [] }).lines.some(function (l) { return l.p === ln.p; })) before = true;
      return false;
    });
    return before ? null : ln.p;
  }
  // add body pages (frames chained) after the last body page until the story fits
  function grow(d, sid, now) {
    for (var pass = 0; pass < MAX_PASSES; pass++) {
      var L = R.computeLayout(d);
      if (!L.overset[sid]) return { doc: d, L: L, overset: false };
      var ch = M.chain(d, sid), last = ch[ch.length - 1], body = bodyPages(d);
      var lastPg = body[body.length - 1], order = M.pagesInOrder(d), add = Math.max(2, Math.ceil(body.length * 0.05));
      var ms = (body.filter(function (p) { return !p.ext.pic; }).pop() || lastPg).ms;
      if (order.length + add > M.MAX_PAGES) break;
      var after = order[order.indexOf(lastPg) + 1] || null, pages = [];
      for (var i = 0; i < add; i++) pages.push({ id: M.newId("pg"), m: now, pos: 0, ms: ms, ext: { hs: "body" } });
      insertPages(d, after, pages);
      var o2 = M.pagesInOrder(d);
      pages.forEach(function (p, k) {
        var f = frameFor(d, p, o2.indexOf(p));
        f.story = sid; f.seq = (last ? last.seq : 0) + (k + 1) * 1024; f.m = now;
        d.items.push(f);
      });
      d = M.normDoc(d);
    }
    var L2 = R.computeLayout(d);
    return { doc: d, L: L2, overset: !!L2.overset[sid] };
  }
  // the body pages after the last one with text go (pages added to fit)
  function trimEnd(d, sid) {
    var L = R.computeLayout(d), body = bodyPages(d), gone = {};
    for (var i = body.length - 1; i > 0; i--) {
      var p = body[i];
      if (p.ext.pic || d.items.some(function (it) { return it.pg === p.id && (it.t !== "text" || it.story !== sid || (L.frames[it.id] || { lines: [] }).lines.length); })) break;
      gone[p.id] = 1;
    }
    if (!Object.keys(gone).length) return d;
    d.pages = d.pages.filter(function (p) { return !gone[p.id]; });
    d.items = d.items.filter(function (it) { return !gone[it.pg]; });
    return M.normDoc(d);
  }
  function placePics(d, sid, picsAt, pics, extra, sheet, now) {
    var placed = 0, out = 0, at = I.ans(sheet, "picAt"), series = H.houseOf(d).pics || {};
    if (at === "s") at = series.at || "page";
    var modeOf = function (k) {
      var own = at === "each" && sheet.pics && sheet.pics[k] && sheet.pics[k].at;
      var m = own && own !== "s" ? own : at === "each" ? series.at || "page" : at;
      return m;
    };
    // anchors in reading order; extra pictures before chapter n + 1 or at the end
    var jobs = Object.keys(picsAt).map(Number).sort(function (a, b) { return a - b; }).map(function (pi) { return { pi: pi, ks: picsAt[pi] }; });
    var ex = I.ans(sheet, "extraAt"), nW = pics.length;
    if (extra.length) {
      var st = M.find(d.stories, sid), h = H.houseOf(d), heads = {}, titles = [];
      [h.roles.title, "ps-hspart", "ps-hsopen"].forEach(function (id) { if (id) heads[id] = 1; });
      st.paras.forEach(function (p, i) { if (heads[p.ps]) titles.push(i); });
      var n = /^after(\d+)$/.exec(ex), ti = n ? +n[1] + 1 : -1;
      var ks = extra.map(function (x, k) { return nW + k; });
      if (ti > 0 && ti < titles.length) jobs.push({ pi: titles[ti], ks: ks, page: 1 });
      else jobs.push({ end: 1, ks: ks, page: 1 });
      jobs.sort(function (a, b) { return (a.end ? 1e9 : a.pi) - (b.end ? 1e9 : b.pi); });
    }
    var all = pics.concat(extra);
    jobs.forEach(function (job) {
      // the text must fit before pictures go after it
      if (job.end) d = trimEnd(grow(d, sid, now).doc, sid);
      var L = R.computeLayout(d), hit = job.end ? null : lineOf(d, L, sid, job.pi);
      if (!job.end && !hit) { out += job.ks.length; return; }
      var own = [], topOff = 0;
      job.ks.forEach(function (k) {
        var pic = all[k], mode = job.page ? "page" : modeOf(k);
        if (!pic || !pic.a || !pic.iw || !pic.ih || mode === "out") { out++; return; }
        var text = capText(pic, k, sheet);
        if (mode !== "before") { own.push({ pic: pic, text: text }); return; }
        // at the top of the paragraph's page, the text below it
        var idx = M.pagesInOrder(d).indexOf(hit.pg), side = d.setup.facing ? M.sideOf(d, idx) : "R", m = M.margins(d, side), u = d.setup;
        var aw = u.w - m.l - m.r, ah = (u.h - m.t - m.b) * 0.6, kk = Math.min(aw / pic.iw, ah / pic.ih), w = pic.iw * kk, hh = pic.ih * kk;
        var where = capWhere(d, sheet), y0 = m.t + topOff;
        var box = { x: m.l + (aw - w) / 2, y: y0, w: w, h: hh };
        if (text && where === "above") { var ch0 = addCap(d, hit.pg, { x: m.l, y: y0, w: aw, h: -4 }, text, "below", now, true); box.y += ch0; topOff += ch0; }
        addImg(d, hit.pg, pic, box, now, true);
        topOff += hh + 8;
        if (text && where === "below") topOff += addCap(d, hit.pg, { x: m.l, y: box.y, w: aw, h: hh }, text, "below", now, true);
        placed++;
      });
      if (!own.length) { d = M.normDoc(d); return; }
      // pages of their own: before the paragraph's page, or after the text
      var o = M.pagesInOrder(d), body = bodyPages(d), lastText = null;
      if (job.end) body.forEach(function (p) { if (d.items.some(function (it) { return it.pg === p.id && it.story === sid && (L.frames[it.id] || { lines: [] }).lines.length; })) lastText = p; });
      var anchor = job.end ? o[o.indexOf(lastText || body[body.length - 1]) + 1] || null : hit.pg;
      var ai = anchor ? o.indexOf(anchor) : o.length, prev = ai > 0 ? o[ai - 1] : null;
      var newPage = function () { return { id: M.newId("pg"), m: now, pos: 0, ms: (anchor || prev || {}).ms || "", ext: { hs: "body", pic: 1 } }; };
      // a chapter opening on a right- or left-hand page keeps its side
      // (the paragraph that opens the anchor's page starts on one): an
      // empty page right before it takes the last picture, and an empty
      // page fills an odd count
      var opener = job.end ? null : firstOn(d, L, sid, anchor);
      var stp = opener !== null && T.resolvePs(T.byId(d.pstyles), M.find(d.stories, sid).paras[opener].ps);
      var keepSide = !!stp && (stp.brk === "odd" || stp.brk === "even") && !!d.setup.facing;
      var prevEmpty = keepSide && prev && prev.ext && prev.ext.hs === "body" && !prev.ext.pic &&
        !d.items.some(function (it) { return it.pg === prev.id && it.t === "text" && (L.frames[it.id] || { lines: [] }).lines.length; });
      var slots = [], add = [];
      own.forEach(function () { var p = newPage(); slots.push(p); add.push(p); });
      if (prevEmpty) {
        add.pop(); slots.pop();
        d.items = d.items.filter(function (it) { return !(it.pg === prev.id && it.story === sid); });
        prev.ext.pic = 1;
        slots.push(prev);
      }
      if (keepSide && add.length % 2) { var blank = newPage(); delete blank.ext.pic; add.unshift(blank); }
      if (add.length) insertPages(d, prevEmpty ? prev : anchor, add);
      var o2 = M.pagesInOrder(d);
      own.forEach(function (x, k) {
        var ti = o2.indexOf(slots[k]);
        picPage(d, slots[k], x.pic, x.text, sheet, d.setup.facing ? M.sideOf(d, ti) : "R", now);
        placed++;
      });
      d = M.normDoc(d);
    });
    var g = grow(d, sid, now);
    return { doc: g.overset ? g.doc : trimEnd(g.doc, sid), placed: placed, out: out, overset: g.overset };
  }

  // ---------- Build ----------
  // house: a house style document; list: wordin paragraphs; meta: the
  // book's details; opts { now, name, pictures (found in the file),
  // sheet (the book sheet, layout/intake.js), names (the new styles'
  // names), tocHead (a new contents' heading) }
  function build(house, list, meta, opts) {
    opts = opts || {};
    meta = meta || {};
    if (!H.houseOf(house)) return null;
    var now = opts.now || 1;
    // pictures (wordin "img" entries) go with the paragraph after them
    var px = I ? I.pictures(list || []) : { list: list || [], pics: [] };
    var s = structure(px.list, opts), mk = null;
    // the book sheet: the manuscript's parts and sections, the house
    // style with the answers
    if (opts.sheet && I) {
      var inf = I.info(house, s.list, s.cut);
      mk = I.mark(s.list, opts.sheet, inf);
      s.list = mk.list;
      firstAgain(s.list);
      house = I.prepare(house, opts.sheet, inf, { now: now, names: opts.names, tocHead: opts.tocHead, extra: (opts.extra || []).length });
    }
    var h = H.houseOf(house);
    var d = M.copyDoc(house, now);
    d.name = String(meta.title || opts.name || d.name).slice(0, 120);
    var filled = fillFields(d, meta);
    var map = H.wmapOf(h.roles), have = {};
    d.pstyles.forEach(function (x) { have[x.id] = 1; });
    var noStyle = {};
    var picsAt = {};
    s.list.forEach(function (p, i) { if (p.pics && p.pics.length) picsAt[i] = p.pics; });
    var paras = s.list.map(function (p) {
      if (p.ps && have[p.ps]) return { ps: p.ps, runs: p.runs };
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
    var L = fl.L, pr = null;
    // the pictures, as the sheet says (LY-IN)
    if (mk && (px.pics.length || (opts.extra || []).length)) {
      pr = placePics(d, st.id, picsAt, px.pics, opts.extra || [], I.clean(opts.sheet), now);
      d = pr.doc; L = R.computeLayout(d);
    }
    var n = toc(d, L), bare = I ? I.finish(d, L) : 0;
    if (n >= 0 || bare) { d = M.normDoc(d); L = R.computeLayout(d); }
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
    var titles = fx.paras.filter(function (p) { return p.ps === h.roles.title || p.ps === "ps-hsopen"; }).length;
    var report = {
      pages: d.pages.length, body: fl.pages, titles: titles, guessed: s.guessed, dropped: s.dropped, front: s.front, fixes: fx.n,
      fields: filled, toc: n, noStyle: noStyle, pictures: opts.pictures || 0, check: check
    };
    if (mk) { report.sheet = 1; report.moved = mk.moved; report.left = mk.dropped; report.bare = bare; report.caps = mk.caps; }
    if (pr) { report.pictures = pr.out; report.placed = pr.placed; report.overset = pr.overset; }
    return { doc: d, report: report };
  }

  var api = { FIELDS: FIELDS, build: build, structure: structure, fillFields: fillFields, toc: toc, flow: flow };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_AUTO = api;
})(typeof window !== "undefined" ? window : this);
