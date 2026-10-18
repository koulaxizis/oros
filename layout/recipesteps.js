// ============================================================
// orOS Layout — recipesteps.js: the steps a Layout automation may use
// (wave A2, v1.0.0). The catalog for recipes/core.js (orosRecipes)
// and what the editing steps do; layout/recipes.js runs them.
//   text      find → repl in every story (cs = match case, word =
//             whole words only); a match may span several runs: the
//             replacement takes the first run's formatting
//   pstyle    paragraphs in style `from` ("" = any) get style `to`
//   master    pages (all / odd / even page numbers) get master `ms`
//             ("" = none)
//             styles and masters are named by id or by name (any
//             language, any case), so one recipe fits documents whose
//             own styles have other ids; a document without that style
//             or master is skipped
//   margins   top, bottom, inside, outside in mm
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

  var ID = { t: "str", max: 80 };
  var MM = { t: "num", lo: 0, hi: 500, def: 15, req: 1 };
  var CATALOG = {
    text: { kind: "doc", args: { find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 2000 }, cs: { t: "bool" }, word: { t: "bool" } } },
    pstyle: { kind: "doc", args: { from: ID, to: { t: "str", max: 80, req: 1 } } },
    master: { kind: "doc", args: { ms: ID, on: { t: "enum", v: ["all", "odd", "even"], def: "all" } } },
    margins: { kind: "doc", args: { t: MM, b: MM, i: MM, o: MM } },
    preflight: { kind: "check", args: { stop: { t: "bool", def: 1 } } },
    export: { kind: "out", args: { bleed: { t: "bool", def: 0 }, marks: { t: "bool", def: 0 }, spreads: { t: "bool", def: 0 }, q: { t: "enum", v: ["print", "screen"], def: "print" } } }
  };
  var ORDER = ["text", "pstyle", "master", "margins", "preflight", "export"];

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

  function apply(doc, st, now) {
    var n = 0;
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

  var api = { CATALOG: CATALOG, ORDER: ORDER, apply: apply, replacePara: replacePara, resolve: resolve, problems: problems };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LayoutRecipes = api;
})(typeof window !== "undefined" ? window : this);
