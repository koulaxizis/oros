// ============================================================
// orOS Layout — the book's index (v1.0.0, LY-W13). An index entry is
// a mark on the words it is about: run ext.ix { t (topic, ≤ 120), s
// (sub-topic, ≤ 120) } (t empty = the marked words themselves). The
// index is a story of its own (story ext.hs "idx"): its first
// paragraphs (a title) stay, the rest is made from the marks and the
// layout: topics sorted for the document's language (Greek without
// accents, Ι/Υ with dialytika as their letter), a letter heading per
// letter, sub-topics under their topic, page numbers as the pages
// show them (sections, roman numerals), runs of pages joined (3–5).
// setup.ext.ix { ps, sub, head (paragraph styles, "" = none), sep }.
// Pure part LY_INDEX (entries, build, update, markAll, unmark, cfg,
// place) / module.exports; the browser part is LY.bookIndex (the
// dialog in More › Index…, the entry dialog in the Story Editor).
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var M = node ? require("../designkit/model.js") : root.orosDK && root.orosDK.model;
  var R = function () { return node ? require("../designkit/render.js") : root.orosDK.render; };
  var MAX_T = 120;

  function txt(v, n) { return typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, n || MAX_T) : ""; }
  function runText(r) { return r.f ? "" : String(r.t || ""); }
  function fold(s) { return String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase(); }
  function cfg(doc) {
    var c = doc.setup.ext && doc.setup.ext.ix, ok = function (id) { return typeof id === "string" && M.find(doc.pstyles, id) ? id : ""; };
    c = c && typeof c === "object" ? c : {};
    return { ps: ok(c.ps), sub: ok(c.sub), head: c.head === "" ? "" : ok(c.head), heads: c.heads !== 0, sep: typeof c.sep === "string" && c.sep.length <= 8 && c.sep.indexOf("\n") < 0 ? c.sep : ", " };
  }
  function langOf(doc) {
    var l = doc.setup.ext && doc.setup.ext.lang;
    return typeof l === "string" && /^[a-z]{2}/.test(l) ? l.slice(0, 2) : "el";
  }

  // every mark: [{ t, s, sid, p, o, page (order index) | -1 }]
  function entries(doc, L) {
    L = L || R().computeLayout(doc);
    var order = M.pagesInOrder(doc), idx = {}, out = [];
    order.forEach(function (p, k) { idx[p.id] = k; });
    doc.stories.forEach(function (st) {
      if (st.ext && st.ext.hs) return;
      var lines = [];
      M.chain(doc, st.id).forEach(function (f) {
        if (idx[f.pg] === undefined) return;
        ((L.frames[f.id] || {}).lines || []).forEach(function (ln) { if (!ln.fn) lines.push({ ln: ln, page: idx[f.pg] }); });
      });
      (st.paras || []).forEach(function (para, pi) {
        var o = 0;
        (para.runs || []).forEach(function (r) {
          var n = r.f ? 1 : runText(r).length, x = r.ext && r.ext.ix;
          if (x && typeof x === "object" && !(r.ext.del)) {
            var t = txt(x.t) || txt(runText(r)), page = -1, bestO = -1;
            // the page of the line the mark starts on
            lines.forEach(function (l) {
              if (l.ln.p !== pi) return;
              var o0 = typeof l.ln.o0 === "number" ? l.ln.o0 : 0;
              if (o0 <= o && o0 >= bestO) { page = l.page; bestO = o0; }
            });
            if (t) out.push({ t: t, s: txt(x.s), sid: st.id, p: pi, o: o, page: page });
          }
          o += n;
        });
      });
    });
    return out;
  }

  // page labels in order → "3, 5–7, ix"
  function pagesText(nums, labels, sep) {
    var u = [];
    nums.slice().sort(function (a, b) { return a - b; }).forEach(function (n) { if (u.indexOf(n) < 0) u.push(n); });
    var parts = [], i = 0;
    while (i < u.length) {
      var j = i;
      // a run only through pages numbered in arabic figures, one after another
      while (j + 1 < u.length && u[j + 1] === u[j] + 1 && /^\d+$/.test(labels[u[j]]) && /^\d+$/.test(labels[u[j + 1]]) && +labels[u[j + 1]] === +labels[u[j]] + 1) j++;
      parts.push(j > i + 0 ? labels[u[i]] + "–" + labels[u[j]] : labels[u[i]]);
      i = j + 1;
    }
    return parts.join(sep);
  }
  // the letter a topic is filed under
  function letterOf(t) {
    var c = fold(t).replace(/^[^\p{L}\p{N}]+/u, "").charAt(0);
    if (!c) return "#";
    if (/\p{N}/u.test(c)) return "0–9";
    return c.toLocaleUpperCase();
  }

  // entries → index paragraphs
  function build(doc, list, opts) {
    opts = opts || {};
    var c = cfg(doc), lab = (M.pageLabels ? M.pageLabels(doc) : null), order = M.pagesInOrder(doc);
    var labels = order.map(function (p, k) { return lab ? String(lab[k].label) : String(k + M.firstNumber(doc)); });
    var coll = new Intl.Collator(langOf(doc), { sensitivity: "base", numeric: true });
    var topics = {}, keys = [];
    list.forEach(function (e) {
      if (e.page < 0) return;
      var k = fold(e.t);
      if (!topics[k]) { topics[k] = { t: e.t, pages: [], subs: {} }; keys.push(k); }
      var tp = topics[k];
      if (e.s) {
        var sk = fold(e.s);
        if (!tp.subs[sk]) tp.subs[sk] = { t: e.s, pages: [] };
        tp.subs[sk].pages.push(e.page);
      } else tp.pages.push(e.page);
    });
    keys.sort(function (a, b) { return coll.compare(topics[a].t, topics[b].t) || (a < b ? -1 : 1); });
    var out = [], last = null, ps = c.ps || "ps-body", sub = c.sub || ps;
    keys.forEach(function (k) {
      var tp = topics[k], L = letterOf(tp.t);
      if (c.heads && L !== last) { out.push({ ps: c.head || ps, runs: [{ t: L, b: c.head ? undefined : 1 }], ext: { ixg: 1 } }); last = L; }
      out.push({ ps: ps, runs: [{ t: tp.t + (tp.pages.length ? c.sep + pagesText(tp.pages, labels, ", ") : "") }], ext: { ixg: 1 } });
      Object.keys(tp.subs).sort(function (a, b) { return coll.compare(tp.subs[a].t, tp.subs[b].t); }).forEach(function (sk) {
        var s = tp.subs[sk];
        out.push({ ps: sub, runs: [{ t: (sub === ps ? " " : "") + s.t + c.sep + pagesText(s.pages, labels, ", ") }], ext: { ixg: 1 } });
      });
    });
    out.forEach(function (p) { p.runs.forEach(function (r) { if (r.b === undefined) delete r.b; }); });
    return { paras: out, topics: keys.length };
  }

  function idxStory(doc) { var s = null; doc.stories.forEach(function (x) { if (x.ext && x.ext.hs === "idx") s = x; }); return s; }
  // the index story made again from the marks; the paragraphs before
  // the first made one stay. Twice, as the index's own length can move
  // the pages. → { topics, marks } or null (no index story)
  function update(doc, now, L) {
    var st = idxStory(doc);
    if (!st) return null;
    var res = null;
    for (var k = 0; k < 2; k++) {
      var list = entries(doc, k ? null : L);
      res = build(doc, list);
      var keep = [];
      for (var i = 0; i < st.paras.length && !(st.paras[i].ext && st.paras[i].ext.ixg); i++) keep.push(st.paras[i]);
      st.paras = keep.concat(res.paras);
      if (!st.paras.length) st.paras = [{ ps: "ps-body", runs: [] }];
      res.marks = list.length;
    }
    M.touch(st, now);
    return { topics: res.topics, marks: res.marks };
  }
  // a new index story on a new last page (two columns, the margins),
  // with a title
  function place(doc, now, title, idf) {
    var nid = idf || M.newId, order = M.pagesInOrder(doc);
    if (order.length >= M.MAX_PAGES) return null;
    var like = order[order.length - 1];
    var pg = { id: nid("pg"), m: now, pos: (order.length + 1) * 1024, ms: like ? like.ms : "" };
    order.forEach(function (p, i) { if (p.pos !== (i + 1) * 1024) { p.pos = (i + 1) * 1024; M.touch(p, now); } });
    doc.pages = order.concat([pg]);
    var c = cfg(doc), mg = M.margins(doc, M.sideOf(doc, order.length)), u = doc.setup;
    var heads = ["ps-h1", "ps-h2"].filter(function (id) { return M.find(doc.pstyles, id); });
    var st = { id: nid("st"), m: now, h: [], ext: { hs: "idx" }, paras: [{ ps: heads[0] || c.ps || "ps-body", runs: [{ t: title }] }] };
    doc.stories.push(st);
    var z = 1;
    doc.items.forEach(function (it) { if (it.pg === pg.id) z = Math.max(z, (it.z || 0) + 1); });
    doc.items.push({ id: nid("it"), m: now, t: "text", pg: pg.id, side: "", x: mg.l, y: mg.t, w: Math.max(36, u.w - mg.l - mg.r), h: Math.max(36, u.h - mg.t - mg.b),
      rot: 0, z: z, fill: "", stroke: "", sw: 1, dash: 0, op: 100, r: 0, lock: 0, hide: 0, grp: "", wrap: "none", wo: 6, story: st.id, seq: 1024, cols: 2, gut: u.gut || 12, ins: 0, va: "t" });
    return st;
  }

  // every whole-word occurrence of each term (any case, any accents)
  // in the text stories gets a mark (topic t, sub s). → marks made
  function markAll(doc, terms, now, opts) {
    opts = opts || {};
    var made = 0;
    (terms || []).map(function (x) { return typeof x === "string" ? { w: x } : x; }).forEach(function (term) {
      var w = txt(term.w), wf = fold(w);
      if (!wf) return;
      doc.stories.forEach(function (st) {
        if (st.ext && st.ext.hs) return;
        var touched = false;
        st.paras.forEach(function (p) {
          // the plain text with each character's run, then the matches
          var chars = [], runs = p.runs || [];
          runs.forEach(function (r, ri) { if (r.f || (r.ext && (r.ext.fn || r.ext.xr || r.ext.fld || r.ext.sup || r.ext.del))) { chars.push(null); return; } for (var j = 0; j < r.t.length; j++) chars.push([ri, j]); });
          var s = chars.map(function (c) { return c ? fold(runs[c[0]].t.charAt(c[1])) : "\u0000"; }).join("");
          var hits = [], at = 0, k;
          while ((k = s.indexOf(wf, at)) >= 0) {
            var before = k ? s.charAt(k - 1) : "", after = s.charAt(k + wf.length);
            if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) hits.push(k);
            at = k + wf.length;
          }
          if (!hits.length) return;
          // cut the runs at each hit and mark the pieces inside
          var cuts = {};
          hits.forEach(function (h) { cuts[h] = 1; cuts[h + wf.length] = 1; });
          var out = [], pos = 0;
          runs.forEach(function (r) {
            if (r.f || (r.ext && (r.ext.fn || r.ext.xr || r.ext.fld || r.ext.sup || r.ext.del))) { out.push(r); pos += 1; return; }
            var start = 0;
            for (var j = 1; j <= r.t.length; j++) {
              if (j === r.t.length || cuts[pos + j]) {
                var piece = JSON.parse(JSON.stringify(r));
                piece.t = r.t.slice(start, j);
                var a = pos + start, inHit = hits.some(function (h) { return a >= h && a < h + wf.length; });
                if (inHit && !(r.ext && r.ext.ix)) {
                  // no topic given: the words as the text has them are the topic
                  var ix = {};
                  if (txt(term.t)) ix.t = txt(term.t);
                  if (txt(term.s)) ix.s = txt(term.s);
                  piece.ext = Object.assign({}, piece.ext || {}, { ix: ix });
                  made++;
                }
                out.push(piece);
                start = j;
              }
            }
            pos += r.t.length;
          });
          p.runs = out;
          touched = true;
        });
        if (touched) M.touch(st, now);
      });
    });
    return made;
  }
  // marks of a topic taken off (or all with no topic). → marks removed
  function unmark(doc, topic, now) {
    var n = 0, f = topic ? fold(topic) : null;
    doc.stories.forEach(function (st) {
      var hit = false;
      st.paras.forEach(function (p) {
        (p.runs || []).forEach(function (r) {
          if (!(r.ext && r.ext.ix)) return;
          if (f && fold(txt(r.ext.ix.t) || runText(r)) !== f) return;
          delete r.ext.ix;
          if (!Object.keys(r.ext).length) delete r.ext;
          n++; hit = true;
        });
      });
      if (hit) M.touch(st, now);
    });
    return n;
  }

  // "word", "word = Topic" or "word = Topic / Sub-topic"
  function parseTerm(line) {
    var m = String(line || "").split("=");
    var w = txt(m[0]);
    if (!w) return null;
    if (m.length < 2) return { w: w };
    var ts = m.slice(1).join("=").split("/");
    var o = { w: w, t: txt(ts[0]) };
    if (ts.length > 1) o.s = txt(ts.slice(1).join("/"));
    return o;
  }

  var api = { parseTerm: parseTerm, entries: entries, build: build, update: update, place: place, markAll: markAll, unmark: unmark, cfg: cfg, pagesText: pagesText, letterOf: letterOf, fold: fold, idxStory: idxStory };
  if (node) { module.exports = api; return; }
  root.LY_INDEX = api;

  // ---------- browser: LY.bookIndex ----------
  var LY = root.LY;
  if (!LY) return;
  var t = LY.t, el = LY.el;

  // the topic and sub-topic of a new mark (Story Editor)
  function entryDlg(words, done) {
    LY.openDialog(t("ix.entry"), function (body, close) {
      var ti = el("input", "inp"); ti.type = "text"; ti.maxLength = MAX_T; ti.value = txt(words);
      var si = el("input", "inp"); si.type = "text"; si.maxLength = MAX_T; si.placeholder = t("ix.subPh");
      body.appendChild(LY.ui.field(t("ix.topic"), ti, "block"));
      body.appendChild(LY.ui.field(t("ix.sub"), si, "block"));
      body.appendChild(el("p", "hint", t("ix.entryHint")));
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.cancel"), close));
      act.appendChild(LY.ui.btn(t("btn.ok"), function () {
        var tp = txt(ti.value), sb = txt(si.value);
        if (!tp) { ti.focus(); return; }
        close();
        var x = {};
        if (tp !== txt(words)) x.t = tp;
        if (sb) x.s = sb;
        done(x);
      }, "primary"));
      body.appendChild(act);
    });
  }

  // More › Index…
  function dialog() {
    var doc = LY.doc;
    if (!doc) return;
    LY.flushStory && LY.flushStory();
    var c = cfg(doc);
    LY.openDialog(t("ix.title"), function (body, close) {
      var listBox = el("div", "ix-list");
      body.appendChild(el("p", "hint", t("ix.hint")));
      body.appendChild(listBox);
      function draw() {
        listBox.innerHTML = "";
        var list = entries(LY.doc, LY.ed.L), by = {};
        list.forEach(function (e) { var k = fold(e.t); (by[k] = by[k] || { t: e.t, n: 0 }).n++; });
        var ks = Object.keys(by);
        if (!ks.length) { listBox.appendChild(el("p", "hint", t("ix.none"))); return; }
        var coll = new Intl.Collator(langOf(LY.doc), { sensitivity: "base" });
        ks.sort(function (a, b) { return coll.compare(by[a].t, by[b].t); }).forEach(function (k) {
          var row = el("div", "ix-row");
          row.appendChild(el("span", "ix-t", by[k].t));
          row.appendChild(el("span", "hint", t("ix.marks", { n: by[k].n })));
          var sure = false, rm = LY.ui.btn(t("ix.unmark"), function () {
            if (!sure) { sure = true; rm.textContent = t("ix.unmarkSure"); return; }
            var n = 0;
            LY.op(function (d, now) { n = unmark(d, by[k].t, now); if (!n) return false; });
            LY.toast(t("ix.unmarked", { n: n }));
            setTimeout(draw, 50);
          }, "small");
          row.appendChild(rm);
          listBox.appendChild(row);
        });
      }
      draw();
      var terms = el("textarea", "inp ix-terms");
      terms.rows = 4; terms.placeholder = t("ix.termsPh");
      body.appendChild(LY.ui.field(t("ix.terms"), terms, "block"));
      body.appendChild(LY.ui.btn(t("ix.markAll"), function () {
        var list = terms.value.split("\n").map(parseTerm).filter(Boolean).slice(0, 200);
        if (!list.length) { terms.focus(); return; }
        var n = 0;
        LY.op(function (d, now) { n = markAll(d, list, now); if (!n) return false; });
        LY.toast(t("ix.marked", { n: n }));
        terms.value = "";
        setTimeout(draw, 50);
      }, "small"));
      var pss = [["", t("ix.psDefault")]].concat(doc.pstyles.map(function (s) { return [s.id, LY.label(s.name)]; }));
      var row = el("div", "pn-row wrap");
      row.appendChild(LY.ui.field(t("ix.ps"), LY.ui.select(pss, c.ps, function (v) { c.ps = v; })));
      row.appendChild(LY.ui.field(t("ix.subPs"), LY.ui.select(pss, c.sub, function (v) { c.sub = v; })));
      row.appendChild(LY.ui.field(t("ix.headPs"), LY.ui.select(pss, c.head, function (v) { c.head = v; })));
      body.appendChild(row);
      body.appendChild(LY.ui.check(t("ix.heads"), c.heads, function (on) { c.heads = !!on; }));
      var has = !!idxStory(doc);
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.close"), close));
      act.appendChild(LY.ui.btn(t(has ? "ix.update" : "ix.make"), function () {
        close();
        make(c);
      }, "primary"));
      body.appendChild(act);
    }, true);
  }
  function make(c) {
    var res = null, made = false;
    LY.op(function (doc, now) {
      var x = Object.assign({}, doc.setup.ext || {});
      x.ix = { ps: c.ps || "", sub: c.sub || "", head: c.head || "", heads: c.heads ? 1 : 0, sep: c.sep || ", " };
      doc.setup.ext = x;
      doc.m = Math.max(now, (doc.m || 0) + 1);
      if (!idxStory(doc)) { if (!place(doc, now, t("ix.head"))) return false; made = true; }
      res = update(doc, now);
    });
    if (!res) { LY.toast(t("ix.fail")); return; }
    LY.toast(t(made ? "ix.madeToast" : "ix.updated", { n: res.topics }));
  }

  LY.bookIndex = { dialog: dialog, entryDlg: entryDlg, make: make };
})(typeof window !== "undefined" ? window : this);
