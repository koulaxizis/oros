// ============================================================
// orOS Layout — House style (v1.0.0, LY-HS)
// A house style is learned from two or more earlier books (Layout
// documents: made here, opened from Scribus / InDesign, or rebuilt
// from a print PDF) and kept as a Layout document of its own, a
// template you open and change like any other, with its rules in
// setup.ext.house (R39):
//   { v: 1, from: n works, roles: { role: paragraph style id },
//     rules: [{ id, src: "works" | "greek" | "own", on: 1 | 0,
//               code + p (text from the app's strings) | t (own words),
//               a: { k: "style", role, set: { key: value } }
//                | { k: "fix", fix: "quotes" | "dash" | "ellipsis" | "spaces" }
//                | { k: "info" } }] }
// Roles: body, first (first paragraph, no indent), title, subtitle,
// center, quote, note. A role is found from how a paragraph look (its
// style with its first run's character style) is used: size against
// the body, length of its paragraphs, where they fall; not from names.
// A role whose look is not its style's own gets a style "ps-hs<role>"
// based on it.
//   - learn(docs, opts) → { doc, report }: the new house style document
//     (a copy of the work whose page setup most works share: its setup,
//     masters, styles and colours, the front and back matter pages, one
//     empty body page), with the rules from the works and the Greek
//     set, applied, and setup.ext.wmap (Word roles → styles, LY-WD).
//   - apply(doc): the "style" rules that are on into the role styles'
//     ext (hyph, orph, wid, kwn, brk) and fi; a rule turned off takes
//     its value back out. → number of styles changed.
//   - fixText(paras, rules) → { paras, n: { quotes, dash, ellipsis,
//     spaces } }: the "fix" rules that are on, on paragraphs of runs;
//     words are never changed.
// Pure (designkit only), testable under Node.
// Exposes LY_HOUSE (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M, T, R;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js"); R = require("../designkit/render.js");
  } else { M = root.orosDK.model; T = root.orosDK.text; R = root.orosDK.render; }

  var ROLES = ["body", "first", "title", "subtitle", "center", "quote", "note"];
  var MAX_EDGE = 16;
  // the book settings a "style" rule may set (LY-BK) and fi
  var SETS = { hyph: 1, orph: 1, wid: 1, kwn: 1, brk: 1, fi: 1 };

  // The Greek typographic set: written once, from the usual Greek
  // book rules, kept in the app.
  var GREEK = [
    { code: "gr.hyph", a: { k: "style", role: "body", set: { hyph: 1 } } },
    { code: "gr.orph", a: { k: "style", role: "body", set: { orph: 2 } } },
    { code: "gr.wid", a: { k: "style", role: "body", set: { wid: 2 } } },
    { code: "gr.kwnTitle", a: { k: "style", role: "title", set: { kwn: 1 } } },
    { code: "gr.kwnSub", a: { k: "style", role: "subtitle", set: { kwn: 1 } } },
    { code: "gr.hyphTitle", a: { k: "style", role: "title", set: { hyph: 0 } } },
    { code: "gr.hyphSub", a: { k: "style", role: "subtitle", set: { hyph: 0 } } },
    { code: "gr.quotes", a: { k: "fix", fix: "quotes" } },
    { code: "gr.dash", a: { k: "fix", fix: "dash" } },
    { code: "gr.ellipsis", a: { k: "fix", fix: "ellipsis" } },
    { code: "gr.spaces", a: { k: "fix", fix: "spaces" } }
  ];

  function r1(v) { return Math.round(v * 10) / 10; }
  function mode(list) {
    var n = {}, best = null;
    list.forEach(function (v) {
      var k = JSON.stringify(v);
      n[k] = (n[k] || 0) + 1;
      if (best === null || n[k] > n[best]) best = k;
    });
    return best === null ? null : { v: JSON.parse(best), n: n[best], all: n };
  }
  function textOf(p) { return (p.runs || []).map(function (r) { return r.t || ""; }).join(""); }

  // ---------- 1. One work: how its styles are used ----------
  // A paragraph's look: its paragraph style with the character style of
  // its first run (a Scribus or InDesign book often sets a title as the
  // body style with a larger, bold character style).
  // → { doc, setup, roles: { role: look key }, looks: { key: { ps, a,
  //     plain } }, use, open: [{ no, top, sink }], front: [pageId],
  //     back: [pageId], bodyMaster }
  function lookOf(p, psMap, csMap, looks) {
    var ps = T.resolvePs(psMap, p.ps), r = null;
    (p.runs || []).some(function (x) { if (!x.f && String(x.t || "").trim()) { r = x; return true; } return false; });
    var cs = r && r.cs && csMap[r.cs] ? T.resolveCs(csMap, r.cs) : {};
    var a = r ? T.runAttrs(ps, cs, r) : { size: ps.size, b: ps.b, i: ps.i, font: ps.font, fam: ps.fam };
    var key = p.ps + "|" + r1(a.size) + "|" + (a.b ? 1 : 0) + (a.i ? 1 : 0) + "|" + (a.fam || a.font);
    if (!looks[key]) {
      looks[key] = {
        ps: p.ps, plain: r1(a.size) === r1(ps.size) && !a.b === !ps.b && !a.i === !ps.i && (a.fam || a.font) === (ps.fam || ps.font),
        a: { size: a.size, b: a.b ? 1 : 0, i: a.i ? 1 : 0, font: a.font, fam: a.fam || "", align: ps.align, fi: ps.fi, li: ps.li, ri: ps.ri, lead: ps.lead }
      };
    }
    return key;
  }
  function study(doc) {
    var psMap = T.byId(doc.pstyles), csMap = T.byId(doc.cstyles), use = {}, seq = [], looks = {};
    var L = R.computeLayout(doc), pages = M.pagesInOrder(doc), first = M.firstNumber(doc);
    var pgIdx = {}, pageTop = {}, starts = {};
    pages.forEach(function (p, i) { pgIdx[p.id] = i; });
    // where each paragraph starts (page, top of its first line), and
    // the highest line on each page
    doc.stories.forEach(function (st) {
      var at = starts[st.id] = {};
      M.chain(doc, st.id).forEach(function (f) {
        var fr = L.frames[f.id];
        if (!fr || pgIdx[f.pg] === undefined) return;
        fr.lines.forEach(function (ln) {
          var y = f.y + ln.y - ln.h;
          // empty lines above a title are its sink, not text above it
          var blank = !ln.runs.some(function (r) { return String(r.t || "").trim(); });
          if (!blank && (pageTop[f.pg] === undefined || y < pageTop[f.pg])) pageTop[f.pg] = y;
          if (at[ln.p] === undefined) at[ln.p] = { pg: f.pg, y: y };
        });
      });
    });
    doc.stories.forEach(function (st) {
      if (!M.chain(doc, st.id).some(function (f) { return pgIdx[f.pg] !== undefined; })) return;
      st.paras.forEach(function (p, i) {
        var s = starts[st.id][i];
        var t = textOf(p);
        var lk = lookOf(p, psMap, csMap, looks);
        var u = use[lk] = use[lk] || { n: 0, chars: 0, short: 0 };
        if (t.trim()) { u.n++; u.chars += t.length; if (t.length <= 120) u.short++; }
        seq.push({ ps: lk, empty: !t.trim(), len: t.length, at: s ? pgIdx[s.pg] : -1, top: !!s && s.y <= pageTop[s.pg] + 0.5, y: s ? s.y : 0 });
      });
    });
    var res = { doc: doc, setup: doc.setup, use: use, looks: looks, roles: roles(looks, use, seq) };
    // where the titles start
    var title = res.roles.title;
    res.open = seq.filter(function (q) { return title && q.ps === title && !q.empty && q.at >= 0; })
      .map(function (q) { return { no: q.at + first, top: q.top, sink: q.y - doc.setup.mt }; });
    // front matter: the pages before the first title; back matter:
    // the pages after the last body paragraph
    var body = res.roles.body;
    var firstTitle = res.open.length ? res.open[0].no - first : -1;
    var lastBody = -1;
    seq.forEach(function (q) { if (q.ps === body && !q.empty && q.at > lastBody) lastBody = q.at; });
    res.front = firstTitle > 0 ? pages.slice(0, Math.min(firstTitle, MAX_EDGE)).map(function (p) { return p.id; }) : [];
    res.back = lastBody >= 0 && lastBody < pages.length - 1 ? pages.slice(Math.max(lastBody + 1, pages.length - MAX_EDGE)).map(function (p) { return p.id; }) : [];
    // the master most body pages use
    var ms = mode(seq.filter(function (q) { return q.ps === body && q.at >= 0; }).map(function (q) { return pages[q.at].ms || ""; }));
    res.bodyMaster = ms ? ms.v : "";
    return res;
  }
  // Roles from use: the body has the most characters; a title is
  // larger than the body (or bold where the body is not), short, and
  // the most used of those; and so on.
  function roles(looks, use, seq) {
    var ids = Object.keys(use).filter(function (id) { return use[id].n; });
    var A = {};
    ids.forEach(function (id) { A[id] = looks[id].a; });
    var out = {};
    var body = ids.slice().sort(function (a, b) { return use[b].chars - use[a].chars || (a < b ? -1 : 1); })[0];
    if (!body) return out;
    out.body = body;
    var bs = A[body].size;
    var big = ids.filter(function (id) { return id !== body && (A[id].size >= bs * 1.05 || (A[id].b && !A[body].b && A[id].size >= bs * 0.95)) && use[id].short >= use[id].n * 0.8; })
      .sort(function (a, b) { return use[b].n - use[a].n || A[b].size - A[a].size || (a < b ? -1 : 1); });
    if (big.length) out.title = big[0];
    // a subtitle: another large style, at least half the time right
    // after a title
    var afterTitle = {};
    for (var j = 1; out.title && j < seq.length; j++) {
      var q = j - 1;
      while (q >= 0 && seq[q].empty) q--;
      if (q >= 0 && seq[q].ps === out.title && !seq[j].empty) afterTitle[seq[j].ps] = (afterTitle[seq[j].ps] || 0) + 1;
    }
    out.subtitle = big.slice(1).filter(function (id) { return (afterTitle[id] || 0) >= use[id].n * 0.5; })
      .sort(function (a, b) { return use[b].n - use[a].n || A[b].size - A[a].size; })[0];
    // the first paragraph: a style at body size used on the first
    // paragraph after a title or subtitle
    var heads = {};
    if (out.title) heads[out.title] = 1;
    if (out.subtitle) heads[out.subtitle] = 1;
    var after = {};
    for (var i = 1; i < seq.length; i++) {
      var k = i - 1;
      while (k >= 0 && seq[k].empty) k--;
      if (k >= 0 && heads[seq[k].ps] && !seq[i].empty && !heads[seq[i].ps]) after[seq[i].ps] = (after[seq[i].ps] || 0) + 1;
    }
    var fp = Object.keys(after).filter(function (id) { return id !== body && Math.abs(A[id].size - bs) <= bs * 0.1; })
      .sort(function (a, b) { return after[b] - after[a]; })[0];
    if (fp && after[fp] >= 1) out.first = fp;
    var taken = {};
    Object.keys(out).forEach(function (r) { taken[out[r]] = 1; });
    function pick(test) {
      return ids.filter(function (id) { return !taken[id] && test(A[id], use[id]); })
        .sort(function (a, b) { return use[b].n - use[a].n || (a < b ? -1 : 1); })[0];
    }
    var near = function (a) { return Math.abs(a.size - bs) <= bs * 0.15; };
    out.center = pick(function (a) { return a.align === "c" && near(a); });
    if (out.center) taken[out.center] = 1;
    out.quote = pick(function (a) { return near(a) && a.li > 0 && (a.ri > 0 || a.i); });
    if (out.quote) taken[out.quote] = 1;
    out.note = pick(function (a) { return a.size < bs * 0.92; });
    Object.keys(out).forEach(function (r) { if (!out[r]) delete out[r]; });
    return out;
  }

  // ---------- 2. The rules the works share ----------
  function worksRules(S) {
    var rules = [], n = S.length;
    // where titles start: a new page in (nearly) every case, an odd one
    var opens = [], odd = 0, all = 0;
    S.forEach(function (s) { s.open.forEach(function (o) { all++; if (o.top) { opens.push(o); if (o.no % 2) odd++; } }); });
    if (all >= 2 && opens.length >= all * 0.8) {
      var isOdd = opens.length >= 2 && odd === opens.length;
      rules.push({ code: isOdd ? "w.titleOdd" : "w.titlePage", p: { n: opens.length, of: all }, a: { k: "style", role: "title", set: { brk: isOdd ? "odd" : "page" } } });
    }
    // the first paragraph without an indent
    var noInd = S.filter(function (s) {
      var b = s.roles.body && s.looks[s.roles.body].a, f = s.roles.first && s.looks[s.roles.first].a;
      return b && f && b.fi > 0 && f.fi === 0;
    }).length;
    if (noInd && noInd >= n * 0.5) rules.push({ code: "w.firstFlush", p: { n: noInd, of: n }, a: { k: "style", role: "first", set: { fi: 0 } } });
    // the space above a title (information, used by the automatic layout)
    var sinks = opens.map(function (o) { return o.sink; }).filter(function (v) { return v > 1; });
    if (sinks.length) {
      sinks.sort(function (a, b) { return a - b; });
      rules.push({ code: "w.sink", p: { mm: r1(sinks[sinks.length >> 1] * 25.4 / 72) }, a: { k: "info" } });
    }
    // what differs between the works
    var bodies = S.map(function (s) { var a = s.roles.body && s.looks[s.roles.body].a; return a ? r1(a.size) + "/" + r1(a.lead || a.size * 1.2) : null; })
      .filter(function (v) { return v; });
    var mb = mode(bodies);
    if (mb && Object.keys(mb.all).length > 1) rules.push({ code: "w.bodyDiff", p: { list: Object.keys(mb.all).map(function (k) { return JSON.parse(k) + " (" + mb.all[k] + ")"; }).join(", ") }, a: { k: "info" } });
    var sizes = mode(S.map(function (s) { return r1(s.setup.w * 25.4 / 72) + "×" + r1(s.setup.h * 25.4 / 72); }));
    if (sizes && Object.keys(sizes.all).length > 1) rules.push({ code: "w.sizeDiff", p: { list: Object.keys(sizes.all).map(function (k) { return JSON.parse(k) + " mm (" + sizes.all[k] + ")"; }).join(", ") }, a: { k: "info" } });
    return rules;
  }

  // ---------- 3. Learn ----------
  // docs: Layout documents (normalized); opts { now, name }.
  function learn(docs, opts) {
    opts = opts || {};
    var S = docs.map(study).filter(function (s) { return s.roles.body; });
    if (!S.length) return null;
    // the work whose page setup most works share (then: the most pages)
    var key = function (s) { var u = s.setup; return [r1(u.w), r1(u.h), r1(u.mt), r1(u.mb), r1(u.mi), r1(u.mo), u.cols, u.facing].join(","); };
    var common = mode(S.map(key)).v;
    var rep = S.filter(function (s) { return key(s) === common; })
      .sort(function (a, b) { return b.doc.pages.length - a.doc.pages.length; })[0];
    var d = M.copyDoc(rep.doc, opts.now);
    d.name = String(opts.name || rep.doc.name || "House style").slice(0, 120);
    // the pages: front and back matter, with one empty body page between
    var keep = {};
    rep.front.concat(rep.back).forEach(function (id) { keep[id] = 1; });
    var order = M.pagesInOrder(d), side = {};
    rep.front.forEach(function (id) { side[id] = "front"; });
    rep.back.forEach(function (id) { side[id] = "back"; });
    // stories that stay whole on the kept pages stay; others go
    var offKept = {};
    d.items.forEach(function (it) {
      if (it.t === "text" && !keep[it.pg] && !M.find(d.masters, it.pg)) offKept[it.story] = 1;
    });
    d.items = d.items.filter(function (it) {
      if (M.find(d.masters, it.pg)) return true;
      if (!keep[it.pg]) return false;
      return it.t !== "text" || !offKept[it.story];
    });
    var used = {};
    d.items.forEach(function (it) { if (it.story) used[it.story] = 1; });
    d.stories = d.stories.filter(function (st) { return used[st.id]; });
    d.guides = d.guides.filter(function (g) { return keep[g.pg] || M.find(d.masters, g.pg); });
    var kept = order.filter(function (p) { return keep[p.id]; });
    var lastFront = -1;
    kept.forEach(function (p, i) { if (side[p.id] === "front") lastFront = i; });
    var bodyPage = { id: M.newId("pg"), m: d.m, pos: 0, ms: rep.bodyMaster || (order[0] && order[0].ms) || "", ext: { hs: "body" } };
    kept.splice(lastFront + 1, 0, bodyPage);
    kept.forEach(function (p, i) {
      p.pos = i + 1;
      if (side[p.id]) { p.ext = p.ext || {}; p.ext.hs = side[p.id]; }
    });
    d.pages = kept;
    d.rec = [];
    // the house: roles of the work, rules from the works and the Greek set
    var rules = worksRules(S).map(function (r) { r.src = "works"; return r; })
      .concat(GREEK.map(function (r) { return { code: r.code, a: JSON.parse(JSON.stringify(r.a)), src: "greek" }; }));
    rules.forEach(function (r, i) { r.id = "r" + (i + 1); r.on = 1; });
    d.setup.ext = d.setup.ext || {};
    var ro = styleRoles(d, rep, opts.names || {}, opts.now);
    d.setup.ext.house = { v: 1, from: S.length, roles: ro, rules: rules };
    d.setup.ext.wmap = wmapOf(ro);
    apply(d);
    d = M.normDoc(d);
    var report = { works: S.length, skipped: docs.length - S.length, pages: d.pages.length, front: rep.front.length, back: rep.back.length, roles: Object.keys(ro).length, rules: rules.length, from: rep.doc.name || "" };
    return { doc: d, report: report };
  }

  // Each role gets a paragraph style of its own look: the style itself
  // where its paragraphs look like it, else a new style on it with the
  // look's size, weight and font ("Title", "Body"…: opts.names).
  function styleRoles(d, rep, names, now) {
    var out = {};
    Object.keys(rep.roles).forEach(function (role) {
      var lk = rep.looks[rep.roles[role]];
      if (lk.plain || !M.find(d.pstyles, lk.ps)) { out[role] = lk.ps; return; }
      var id = "ps-hs" + role, a = lk.a;
      var s = { id: id, m: stamp(now), name: String(names[role] || role).slice(0, 60), base: lk.ps, size: a.size, b: a.b, i: a.i, font: a.font };
      if (a.fam) s.ext = { fam: a.fam };
      d.pstyles = d.pstyles.filter(function (x) { return x.id !== id; }).concat([s]);
      out[role] = id;
    });
    return out;
  }
  function stamp(v) { return typeof v === "number" && v > 0 ? Math.floor(v) : 1; }

  // Word roles (layout/wordin.js) → the house's styles
  function wmapOf(ro) {
    var body = ro.body || "ps-base";
    return { h1: ro.title || body, h2: ro.subtitle || ro.title || body, h3: ro.subtitle || body, p1: ro.first || body, p: body, center: ro.center || body, quote: ro.quote || body, li: body };
  }

  function houseOf(doc) {
    var h = doc && doc.setup && doc.setup.ext && doc.setup.ext.house;
    return h && typeof h === "object" && Array.isArray(h.rules) ? h : null;
  }

  // ---------- 4. Apply ----------
  function apply(doc, now) {
    var h = houseOf(doc);
    if (!h) return 0;
    var changed = {}, want = {};
    h.rules.forEach(function (r) {
      var a = r.a;
      if (!a || a.k !== "style" || !a.set) return;
      var id = h.roles && h.roles[a.role];
      if (!id || !M.find(doc.pstyles, id)) return;
      Object.keys(a.set).forEach(function (k) {
        if (!SETS[k]) return;
        var w = want[id] = want[id] || {};
        if (r.on) w[k] = { v: a.set[k] };
        else if (!w[k]) w[k] = { off: a.set[k] };
      });
    });
    Object.keys(want).forEach(function (id) {
      var s = M.find(doc.pstyles, id), before = JSON.stringify(s);
      Object.keys(want[id]).forEach(function (k) {
        var w = want[id][k];
        if (k === "fi") {
          if (w.off === undefined) s.fi = w.v;
          return;
        }
        s.ext = s.ext || {};
        if (w.off === undefined) s.ext[k] = w.v;
        else if (s.ext[k] === w.off) delete s.ext[k];
      });
      if (s.ext && !Object.keys(s.ext).length) delete s.ext;
      if (JSON.stringify(s) !== before) { changed[id] = 1; if (now) s.m = now; }
    });
    return Object.keys(changed).length;
  }

  // ---------- 5. Text fixes ----------
  var OPENERS = /[\s(\[{—–\-\/«“]/;
  function fixQuotes(paras) {
    var n = 0;
    paras.forEach(function (p) {
      var depth = 0, prev = "";
      (p.runs || []).forEach(function (r) {
        if (r.f || typeof r.t !== "string") { prev = "x"; return; }
        var s = r.t, out = "";
        for (var i = 0; i < s.length; i++) {
          var c = s[i];
          if (c === "«") { depth++; out += c; prev = c; continue; }
          if (c === "»") { depth = Math.max(0, depth - 1); out += c; prev = c; continue; }
          if (c === "\"" || c === "“" || c === "”" || c === "„") {
            var open = c === "“" || c === "„" ? true : c === "”" ? false : (!prev || OPENERS.test(prev));
            var nc;
            if (open) { nc = depth === 0 ? "«" : "“"; depth++; }
            else { depth = Math.max(0, depth - 1); nc = depth === 0 ? "»" : "”"; }
            if (nc !== c) n++;
            out += nc; prev = nc; continue;
          }
          out += c; prev = c;
        }
        r.t = out;
      });
    });
    return n;
  }
  function fixRuns(paras, re, fn) {
    var n = 0;
    paras.forEach(function (p) {
      (p.runs || []).forEach(function (r, ri) {
        if (r.f || typeof r.t !== "string") return;
        r.t = r.t.replace(re, function (m) {
          var v = fn.apply(null, [ri].concat([].slice.call(arguments)));
          if (v !== m) n++;
          return v;
        });
      });
    });
    return n;
  }
  function fixText(paras, rules) {
    var on = {};
    (rules || []).forEach(function (r) { if (r.on && r.a && r.a.k === "fix") on[r.a.fix] = 1; });
    var out = JSON.parse(JSON.stringify(paras || [])), n = { quotes: 0, dash: 0, ellipsis: 0, spaces: 0 };
    if (on.spaces) n.spaces = fixRuns(out, / {2,}/g, function () { return " "; });
    if (on.ellipsis) n.ellipsis = fixRuns(out, /\.\.\.(?!\.)/g, function () { return "…"; });
    if (on.dash) {
      // a dialogue line: a hyphen or en dash opening the paragraph → em dash;
      // a hyphen between spaces → en dash
      n.dash = fixRuns(out, /^([-–])(?=\s)/, function (ri, m) { return ri === 0 ? "—" : m; });
      n.dash += fixRuns(out, / - /g, function () { return " – "; });
    }
    if (on.quotes) n.quotes = fixQuotes(out);
    return { paras: out, n: n };
  }

  var api = { ROLES: ROLES, GREEK: GREEK, study: study, learn: learn, apply: apply, fixText: fixText, houseOf: houseOf, wmapOf: wmapOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_HOUSE = api;
})(typeof window !== "undefined" ? window : this);
