// ============================================================
// orOS Layout — recipesteps.js: the steps a Layout automation may use
// (wave A2, v1.0.0). The catalog for recipes/core.js (orosRecipes)
// and what the editing steps do; layout/recipes.js runs them.
//   text      find → repl in every story (cs = match case, word =
//             whole words only); a match may span several runs: the
//             replacement takes the first run's formatting
//   pstyle    paragraphs in style `from` ("" = any) get style `to`
//   style     the paragraph style `name` itself changes: size and
//             leading in pt, font family, alignment, tracking; 0 / ""
//             leaves a field as it is (AS-RB: "make the body 10.5 pt")
//   master    pages (all / odd / even page numbers) get master `ms`
//             ("" = none)
//             styles and masters are named by id or by name (any
//             language, any case), so one recipe fits documents whose
//             own styles have other ids; a document without that style
//             or master is skipped
//   margins   top, bottom, inside, outside in mm
//   pages     n new pages at the end, before or after page position
//             `page`; flow: text that does not fit runs on into them
//   delpages  pages from position `first` to `last` go, with what is on
//             them (tombstones, so the deletion syncs)
//   numbering the first page number: set to n, or shift by n
//   bleed     the bleed in mm
//   fit       text that does not fit runs on into new pages after its
//             last frame, as many as it needs
//   grey      the pictures on `pages` become black and white (async:
//             the run makes greyscale copies first, ctx.grey maps them)
//   imgfit    the pictures on `pages`: fit | fill their frame
//             `pages` everywhere: "" (all), "odd", "even" or positions
//             like "3-10,12" (1 = the document's first page)
//   preflight count the problems (designkit render.preflight); with
//             stop, a document with errors is not exported
//   export    a PDF of each document (bleed, crop marks, spreads,
//             print 300 ppi / screen 150 ppi pictures), saved in Files
// apply(doc, step, now) edits a copy in place and returns how many
// things changed; the same recipe twice changes nothing more.
// Pure: no DOM. Exposes window.LayoutRecipes (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var M;
  if (typeof module !== "undefined" && module.exports) M = require("../designkit/model.js");
  else M = root.orosDK.model;
  // the text layout, only for pages and fit (flow)
  function render() {
    if (typeof module !== "undefined" && module.exports) return require("../designkit/render.js");
    return root.orosDK.render;
  }

  var ID = { t: "str", max: 80 };
  var PAGES = { t: "str", max: 60 };
  var ONOFF = { t: "enum", v: ["", "on", "off"], def: "" }, PT = { t: "num", lo: -1, hi: 1000, def: -1 };
  var MM = { t: "num", lo: 0, hi: 500, def: 15, req: 1 };
  var CATALOG = {
    text: { kind: "doc", args: { find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 2000 }, cs: { t: "bool" }, word: { t: "bool" } } },
    pstyle: { kind: "doc", args: { from: ID, to: { t: "str", max: 80, req: 1 } } },
    style: { kind: "doc", args: { name: { t: "str", max: 80, req: 1 }, size: { t: "num", lo: 0, hi: 400, def: 0 }, lead: { t: "num", lo: 0, hi: 500, def: 0 },
      font: { t: "enum", v: ["", "serif", "sans", "mono"], def: "" }, align: { t: "enum", v: ["", "l", "c", "r", "j"], def: "" }, track: { t: "num", lo: -500, hi: 2000, def: 0 },
      bold: ONOFF, ital: ONOFF, caps: ONOFF, sb: PT, sa: PT, fi: PT, brk: { t: "enum", v: ["", "any", "col", "page", "odd", "even"], def: "" }, hyph: ONOFF } },
    master: { kind: "doc", args: { ms: ID, on: { t: "enum", v: ["all", "odd", "even"], def: "all" } } },
    margins: { kind: "doc", args: { t: MM, b: MM, i: MM, o: MM } },
    pages: { kind: "doc", args: { n: { t: "int", lo: 1, hi: 500, def: 1, req: 1 }, at: { t: "enum", v: ["end", "before", "after"], def: "end" },
      page: { t: "int", lo: 0, hi: 9999, def: 0 }, flow: { t: "bool", def: 1 } } },
    delpages: { kind: "doc", args: { first: { t: "int", lo: 1, hi: 9999, def: 1, req: 1 }, last: { t: "int", lo: 0, hi: 9999, def: 0 } } },
    numbering: { kind: "doc", args: { mode: { t: "enum", v: ["set", "shift"], def: "set" }, n: { t: "int", lo: -9999, hi: 9999, def: 1, req: 1 } } },
    bleed: { kind: "doc", args: { mm: { t: "num", lo: 0, hi: 25, def: 3, req: 1 } } },
    fit: { kind: "doc", args: {} },
    grey: { kind: "async", args: { pages: PAGES } },
    imgfit: { kind: "doc", args: { mode: { t: "enum", v: ["fit", "fill"], def: "fit" }, pages: PAGES } },
    preflight: { kind: "check", args: { stop: { t: "bool", def: 1 } } },
    export: { kind: "out", args: { bleed: { t: "bool", def: 0 }, marks: { t: "bool", def: 0 }, spreads: { t: "bool", def: 0 }, q: { t: "enum", v: ["print", "screen"], def: "print" } } }
  };
  var ORDER = ["text", "pstyle", "style", "master", "margins", "pages", "delpages", "fit", "numbering", "bleed", "grey", "imgfit", "preflight", "export"];

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function finder(st) {
    var src = esc(st.find);
    if (st.word) src = "(?<![\\p{L}\\p{N}_])" + src + "(?![\\p{L}\\p{N}_])";
    return new RegExp(src, "gu" + (st.cs ? "" : "i"));
  }

  // Replace in one paragraph. Runs with text (`t`) next to each other
  // are searched as one string; a field run (page number) splits it.
  function replacePara(p, rx, repl) {
    var n = 0, runs = p.runs || [], i = 0;
    while (i < runs.length) {
      if (typeof runs[i].t !== "string") { i++; continue; }
      var j = i, s = "", starts = [];
      while (j < runs.length && typeof runs[j].t === "string") { starts.push(s.length); s += runs[j].t; j++; }
      var hits = [];
      rx.lastIndex = 0;
      var m;
      while ((m = rx.exec(s))) {
        if (!m[0].length) { rx.lastIndex++; continue; }
        hits.push([m.index, m.index + m[0].length]);
      }
      // from the end, so earlier offsets stay right
      for (var h = hits.length - 1; h >= 0; h--) {
        var a = hits[h][0], b = hits[h][1], first = -1;
        for (var k = i; k < j; k++) {
          var r = runs[k], rs = starts[k - i], re = rs + r.t.length;
          if (re <= a || rs >= b) { if (rs >= b) break; continue; }
          var x0 = Math.max(a, rs) - rs, x1 = Math.min(b, re) - rs;
          if (first < 0) { r.t = r.t.slice(0, x0) + repl + r.t.slice(x1); first = k; }
          else r.t = r.t.slice(0, x0) + r.t.slice(x1);
        }
        n++;
      }
      i = j;
    }
    if (n) p.runs = runs.filter(function (r) { return typeof r.t !== "string" || r.t.length; });
    return n;
  }

  // a style / master by id, or else by name (string or { en, el })
  function resolve(list, v) {
    if (!v) return null;
    var hit = M.find(list || [], v);
    if (hit) return hit;
    var want = String(v).trim().toLocaleLowerCase();
    (list || []).forEach(function (e) {
      if (hit) return;
      var n = e.name, names = n && typeof n === "object" ? Object.keys(n).map(function (k) { return n[k]; }) : [n];
      names.forEach(function (x) { if (!hit && typeof x === "string" && x.trim().toLocaleLowerCase() === want) hit = e; });
    });
    return hit;
  }

  function touchStory(st, now) {
    st.h = [st.m].concat(st.h || []).slice(0, 20);
    M.touch(st, now);
  }

  // ---------- Pages (Q5) ----------
  // "" | "all" | "odd" | "even" | "3-10,12" → a test on the 1-based
  // position; null when the text says nothing usable
  function pageTest(v) {
    var s = String(v || "").replace(/\s+/g, "").toLowerCase();
    if (!s || s === "all") return function () { return true; };
    if (s === "odd") return function (k) { return k % 2 === 1; };
    if (s === "even") return function (k) { return k % 2 === 0; };
    var parts = s.split(","), rs = [];
    for (var i = 0; i < parts.length; i++) {
      var m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(parts[i]);
      if (!m) return null;
      var a = +m[1], b = m[2] ? +m[2] : a;
      rs.push([Math.min(a, b), Math.max(a, b)]);
    }
    return function (k) { return rs.some(function (r) { return k >= r[0] && k <= r[1]; }); };
  }
  function tomb(doc, id, now) { doc.tombs[id] = Math.max(now, doc.tombs[id] || 0); }
  function renumber(order) { order.forEach(function (p, i) { p.pos = (i + 1) * 1024; }); }
  // a text frame filling page pg's margins (the document's columns)
  function frameOn(doc, pg, idx, now) {
    var m = M.margins(doc, M.sideOf(doc, idx)), u = doc.setup;
    return { id: M.newId("it"), m: now, t: "text", pg: pg.id, x: m.l, y: m.t, w: Math.max(10, u.w - m.l - m.r), h: Math.max(10, u.h - m.t - m.b),
      cols: u.cols, gut: u.gut, story: "", seq: 0, z: 1 };
  }
  // n new pages at order index `at` (like the page before them)
  function addPagesAt(doc, at, n, now) {
    var order = M.pagesInOrder(doc), like = order[Math.max(0, at - 1)] || order[0], made = [];
    n = Math.min(n, M.MAX_PAGES - order.length);
    for (var i = 0; i < n; i++) {
      var pg = { id: M.newId("pg"), m: now, pos: 0, ms: like ? like.ms : "" };
      if (like && like.ext && like.ext.hs) pg.ext = { hs: like.ext.hs };
      made.push(pg);
    }
    order.splice.apply(order, [at, 0].concat(made));
    order.forEach(function (p, i) { if (p.pos !== (i + 1) * 1024) { p.pos = (i + 1) * 1024; M.touch(p, now); } });
    doc.pages = order;
    return made;
  }
  // the stories that do not fit, each with its last frame's page index
  function overset(doc) {
    var L = render().computeLayout(M.normDoc(JSON.parse(JSON.stringify(doc)))), order = M.pagesInOrder(doc), out = [];
    Object.keys(L.overset || {}).forEach(function (sid) {
      if (!L.overset[sid]) return;
      var ch = M.chain(doc, sid), last = ch[ch.length - 1];
      if (!last) return;
      var idx = -1;
      order.forEach(function (p, i) { if (p.id === last.pg) idx = i; });
      if (idx >= 0) out.push({ sid: sid, last: last, idx: idx, L: L });
    });
    return out.sort(function (a, b) { return a.idx - b.idx; });
  }
  // chain frames on these pages to story sid (after its last frame)
  function chainOn(doc, sid, last, pages, now) {
    var order = M.pagesInOrder(doc), seq = last.seq;
    pages.forEach(function (pg) {
      var f = frameOn(doc, pg, order.indexOf(pg), now);
      seq += 1024;
      f.story = sid; f.seq = seq;
      doc.items.push(f);
    });
  }
  // text that does not fit runs on into new pages after its last frame
  // → pages added. Pages are added in batches from what has fit so far,
  // then the empty ones at the end of the batch go again.
  function fitAll(doc, now) {
    var added = 0;
    for (var guard = 0; guard < 40; guard++) {
      var os = overset(doc);
      if (!os.length) break;
      var o = os[0], st = M.find(doc.stories, o.sid), ch = M.chain(doc, o.sid);
      var lastP = -1, total = 0, placed = 0;
      ch.forEach(function (f) { ((o.L.frames[f.id] || {}).lines || []).forEach(function (ln) { if (ln.p > lastP) lastP = ln.p; }); });
      (st.paras || []).forEach(function (p, i) {
        var k = (p.runs || []).reduce(function (a, r) { return a + (typeof r.t === "string" ? r.t.length : 1); }, 0) + 1;
        total += k; if (i < lastP) placed += k;
      });
      var per = placed > 0 ? placed / Math.max(1, ch.length) : 0;
      var want = per > 0 ? Math.ceil((total - placed) / per * 1.1) + 1 : 2;
      want = Math.max(1, Math.min(want, M.MAX_PAGES - doc.pages.length));
      if (!want) break;
      var made = addPagesAt(doc, o.idx + 1, want, now);
      if (!made.length) break;
      chainOn(doc, o.sid, o.last, made, now);
      added += made.length;
      // the new pages left empty go again
      var L = render().computeLayout(M.normDoc(JSON.parse(JSON.stringify(doc))));
      if (!L.overset[o.sid]) {
        var gone = {};
        for (var i = made.length - 1; i > 0; i--) {
          var f = doc.items.filter(function (it) { return it.pg === made[i].id; })[0];
          if (f && !((L.frames[f.id] || {}).lines || []).length) gone[made[i].id] = f.id; else break;
        }
        Object.keys(gone).forEach(function (pid) {
          doc.pages = doc.pages.filter(function (p) { return p.id !== pid; });
          doc.items = doc.items.filter(function (it) { return it.id !== gone[pid]; });
          added--;
        });
        renumber(M.pagesInOrder(doc));
      }
    }
    return added;
  }

  // ctx: { grey: { asset id: its greyscale copy's id } } for "grey"
  function apply(doc, st, now, ctx) {
    var n = 0, order, test;
    switch (st.op) {
      case "text":
        var rx = finder(st);
        (doc.stories || []).forEach(function (s) {
          var k = 0;
          (s.paras || []).forEach(function (p) { k += replacePara(p, rx, st.repl); });
          if (k) { touchStory(s, now); n += k; }
        });
        break;
      case "pstyle":
        var to = resolve(doc.pstyles, st.to), from = st.from ? resolve(doc.pstyles, st.from) : null;
        if (!to || (st.from && !from)) return 0;
        (doc.stories || []).forEach(function (s) {
          var k = 0;
          (s.paras || []).forEach(function (p) {
            var cur = p.ps || "ps-base";
            if ((!from || cur === from.id) && cur !== to.id) { p.ps = to.id; k++; }
          });
          if (k) { touchStory(s, now); n += k; }
        });
        break;
      case "style":
        var ps = resolve(doc.pstyles, st.name), set = {};
        if (!ps) return 0;
        if (st.size) set.size = st.size;
        if (st.lead) set.lead = st.lead;
        if (st.font) set.font = st.font;
        if (st.align) set.align = st.align;
        if (st.track) set.track = st.track;
        [["bold", "b"], ["ital", "i"], ["caps", "caps"]].forEach(function (kv) { var v = st[kv[0]]; if (v === "on" || v === "off") set[kv[1]] = v === "on" ? 1 : 0; });
        ["sb", "sa", "fi"].forEach(function (k) { if (typeof st[k] === "number" && st[k] >= 0) set[k] = st[k]; });
        Object.keys(set).forEach(function (k) { if (ps[k] !== set[k]) { ps[k] = set[k]; n = 1; } });
        // book typesetting (LY-BK, in the style's ext)
        var bx = {};
        if (st.brk) bx.brk = st.brk === "any" ? "" : st.brk;
        if (st.hyph === "on" || st.hyph === "off") bx.hyph = st.hyph === "on" ? 1 : 0;
        Object.keys(bx).forEach(function (k) {
          ps.ext = ps.ext || {};
          if (ps.ext[k] !== bx[k]) { ps.ext[k] = bx[k]; n = 1; }
        });
        if (n) M.touch(ps, now);
        break;
      case "master":
        var ms = st.ms ? resolve(doc.masters, st.ms) : null, msId = ms ? ms.id : "";
        if (st.ms && !ms) return 0;
        M.pagesInOrder(doc).forEach(function (pg, idx) {
          var num = idx + 1;
          if (st.on === "odd" && num % 2 !== 1) return;
          if (st.on === "even" && num % 2 !== 0) return;
          if ((pg.ms || "") !== msId) { pg.ms = msId; M.touch(pg, now); n++; }
        });
        break;
      case "margins":
        var s0 = doc.setup, want = { mt: st.t, mb: st.b, mi: st.i, mo: st.o }, any = false;
        Object.keys(want).forEach(function (k) {
          var v = Math.round(M.fromUnit(want[k], "mm") * 100) / 100;
          if (Math.abs((s0[k] || 0) - v) > 0.01) { s0[k] = v; any = true; }
        });
        if (any) { doc.setup = M.normSetup(s0); n = 1; }
        break;
      case "pages":
        order = M.pagesInOrder(doc);
        var at = st.at === "end" || !st.page ? order.length : Math.max(0, Math.min(order.length, st.at === "before" ? st.page - 1 : st.page));
        var made = addPagesAt(doc, at, st.n, now);
        n = made.length;
        if (n && st.flow) {
          // the story that does not fit and ends just before the new pages
          var os = overset(doc).filter(function (o) { return o.idx < at; }).pop();
          if (os) chainOn(doc, os.sid, os.last, made, now);
        }
        break;
      case "delpages":
        order = M.pagesInOrder(doc);
        var a = st.first, b = st.last || st.first, lo = Math.min(a, b), hi = Math.min(Math.max(a, b), order.length), gone = {};
        if (lo > order.length || hi - lo + 1 >= order.length) return 0;   // a document keeps one page
        for (var k = lo; k <= hi; k++) gone[order[k - 1].id] = 1;
        doc.pages = doc.pages.filter(function (p) { if (gone[p.id]) { tomb(doc, p.id, now); n++; return false; } return true; });
        doc.items = doc.items.filter(function (it) { if (gone[it.pg]) { tomb(doc, it.id, now); return false; } return true; });
        doc.stories = doc.stories.filter(function (s) {
          if (doc.items.some(function (it) { return it.t === "text" && it.story === s.id; })) return true;
          tomb(doc, s.id, now);
          return false;
        });
        doc.guides = (doc.guides || []).filter(function (g) { if (gone[g.pg]) { tomb(doc, g.id, now); return false; } return true; });
        renumber(M.pagesInOrder(doc));
        break;
      case "numbering":
        var first = M.firstNumber(doc), want2 = Math.max(0, Math.min(9999, st.mode === "shift" ? first + st.n : st.n));
        if (want2 !== first) {
          doc.setup.ext = doc.setup.ext || {};
          doc.setup.ext.pnStart = want2;
          n = 1;
        }
        break;
      case "bleed":
        var bl = Math.round(M.fromUnit(st.mm, "mm") * 1000) / 1000;
        if (Math.abs((doc.setup.bleed || 0) - bl) > 0.001) { doc.setup.bleed = bl; doc.setup = M.normSetup(doc.setup); n = 1; }
        break;
      case "fit":
        n = fitAll(doc, now);
        break;
      case "grey":
      case "imgfit":
        test = pageTest(st.pages);
        if (!test) return 0;
        order = M.pagesInOrder(doc);
        var on = {};
        order.forEach(function (p, i) { if (test(i + 1)) on[p.id] = 1; });
        doc.items.forEach(function (it) {
          if (it.t !== "img" || !on[it.pg] || !it.a) return;
          if (st.op === "grey") {
            var g = ctx && ctx.grey && ctx.grey[it.a];
            if (g && g !== it.a) { it.a = g; M.touch(it, now); n++; }
          } else if (it.fit !== st.mode) { it.fit = st.mode; it.ix = 0; it.iy = 0; it.isc = 1; M.touch(it, now); n++; }
        });
        break;
    }
    if (n) doc.m = Math.max(now, (doc.m || 0) + 1);
    return n;
  }

  // Preflight errors / warnings of a document (R = designkit render).
  function problems(doc, R, isMissing) {
    var list = R.preflight(doc, R.computeLayout(doc), { isMissing: isMissing || function () { return false; } }) || [];
    var err = 0, warn = 0;
    list.forEach(function (p) { if (p.sev === "err") err++; else warn++; });
    return { err: err, warn: warn };
  }

  // the pictures (asset ids) a "grey" step would change
  function greyAssets(doc, st) {
    var test = pageTest(st.pages), on = {}, out = [];
    if (!test) return out;
    M.pagesInOrder(doc).forEach(function (p, i) { if (test(i + 1)) on[p.id] = 1; });
    doc.items.forEach(function (it) { if (it.t === "img" && on[it.pg] && it.a && out.indexOf(it.a) < 0) out.push(it.a); });
    return out;
  }

  var api = { CATALOG: CATALOG, ORDER: ORDER, apply: apply, replacePara: replacePara, resolve: resolve, problems: problems, pageTest: pageTest, greyAssets: greyAssets };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LayoutRecipes = api;
})(typeof window !== "undefined" ? window : this);
