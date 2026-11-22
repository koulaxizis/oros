// ============================================================
// orOS Layout — comments pinned on the page and the proof PDF
// (v1.0.0, LY-N5). A comment is a pin on a page (page.ext.cm, so each
// page syncs its own): { id, x, y (pt from the page's top left), t
// (≤ 500), by (≤ 40), at, ok (1 = resolved) }, at most 20 per page.
// More › Comments… shows the pins and a bar: Add (the next tap on a
// page places one), resolved ones shown or hidden, Proof PDF (the
// pages with every open comment as a PDF note, pdf-lib), Close. A pin
// opens its comment: change, resolve or reopen, delete (asks once in
// place). The Story Editor's tracked changes (track.js) go into the
// proof too, as notes beside their lines.
// Pure part: LY_COMMENTS (norm, list, annotate) / module.exports.
// ============================================================
(function (root) {
  "use strict";

  var MAX = 20, TXT = 500, ID = /^c[a-z0-9]{4,16}$/;

  function num(v, lo, hi) { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo; }
  function txt(v, n) { return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, n) : ""; }
  // a page's comments, clean
  function norm(list, w, h) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (c) {
      if (!c || typeof c !== "object" || !ID.test(c.id) || seen[c.id] || out.length >= MAX) return;
      var t = txt(c.t, TXT);
      if (!t) return;
      seen[c.id] = 1;
      var o = { id: c.id, x: Math.round(num(c.x, 0, w || 20000) * 10) / 10, y: Math.round(num(c.y, 0, h || 20000) * 10) / 10, t: t, by: txt(c.by, 40), at: Math.round(num(c.at, 0, 9e15)) };
      if (c.ok) o.ok = 1;
      out.push(o);
    });
    return out;
  }
  // every comment of a document, in page order: [{ pg, n (page number
  // from 1), c }]
  function list(doc, M) {
    var out = [];
    M.pagesInOrder(doc).forEach(function (p, i) {
      ((p.ext && p.ext.cm) || []).forEach(function (c) { out.push({ pg: p.id, n: i + 1, c: c }); });
    });
    return out;
  }
  // a PDF's pages get Text annotations (notes): items [{ page (0-based),
  // x, y (pt from the page's top left), t, by, at, color [r, g, b] }]
  function annotate(PDFLib, bytes, items, opts) {
    opts = opts || {};
    return PDFLib.PDFDocument.load(bytes, { updateMetadata: false }).then(function (pdf) {
      var ctx = pdf.context, pages = pdf.getPages(), n = 0;
      items.forEach(function (it) {
        var pg = pages[it.page];
        if (!pg) return;
        var H = pg.getHeight(), x = num(it.x, 0, pg.getWidth() - 18), y = H - num(it.y, 0, H);
        var d = new Date(it.at || 0), pad = function (v) { return (v < 10 ? "0" : "") + v; };
        var dict = {
          Type: "Annot", Subtype: "Text", Name: it.name || "Comment", Open: false,
          Rect: [x, Math.max(0, y - 18), x + 18, y],
          Contents: PDFLib.PDFHexString.fromText(String(it.t || "")),
          T: PDFLib.PDFHexString.fromText(String(it.by || "")),
          C: it.color || [1, 0.8, 0.2],
          F: 4
        };
        if (it.at) dict.M = PDFLib.PDFString.of("D:" + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z");
        var ref = ctx.register(ctx.obj(dict));
        var annots = pg.node.lookup(PDFLib.PDFName.of("Annots"));
        if (annots instanceof PDFLib.PDFArray) annots.push(ref);
        else pg.node.set(PDFLib.PDFName.of("Annots"), ctx.obj([ref]));
        n++;
      });
      if (opts.title) pdf.setTitle(opts.title);
      return pdf.save({ useObjectStreams: false }).then(function (b) { return { bytes: b, n: n }; });
    });
  }
  // the tracked changes of the laid-out text as proof notes: [{ page
  // index, x, y, t, by, at, kind }] (the line where each change starts)
  function changeNotes(doc, L, M, words) {
    var order = M.pagesInOrder(doc), idx = {}, out = [];
    order.forEach(function (p, i) { idx[p.id] = i; });
    (doc.stories || []).forEach(function (st) {
      var marks = [];
      (st.paras || []).forEach(function (p, pi) {
        var o = 0;
        (p.runs || []).forEach(function (r) {
          var k = r.ext && r.ext.del ? "del" : r.ext && r.ext.ins ? "ins" : "", n = r.f ? 1 : String(r.t || "").length;
          if (k) {
            var last = marks[marks.length - 1];
            if (last && last.k === k && last.p === pi && last.o1 === o) { last.t += r.t || ""; last.o1 = o + n; }
            else marks.push({ p: pi, o: o, o1: o + n, k: k, t: r.f ? "#" : String(r.t || ""), by: r.ext[k].by || "", at: r.ext[k].at || 0 });
          }
          o += n;
        });
      });
      if (!marks.length) return;
      var frames = doc.items.filter(function (it) { return it.t === "text" && it.story === st.id && L.frames[it.id] && idx[it.pg] !== undefined; });
      marks.forEach(function (m) {
        var best = null;
        frames.forEach(function (f) {
          L.frames[f.id].lines.forEach(function (ln) {
            if (ln.p !== m.p || ln.fn) return;
            var o0 = typeof ln.o0 === "number" ? ln.o0 : 0;
            if (o0 <= m.o && (!best || o0 >= best.o0)) best = { f: f, ln: ln, o0: o0 };
          });
        });
        if (!best) return;
        var x = best.f.x + best.f.w + 4, y = Math.max(best.f.y, best.f.y + best.ln.y - (best.ln.h || 12) * 0.8);
        out.push({ page: idx[best.f.pg], x: x, y: y, t: (m.k === "ins" ? words.ins : words.del) + ": " + m.t.slice(0, 400), by: m.by, at: m.at, kind: m.k, name: m.k === "ins" ? "Insert" : "Note", color: m.k === "ins" ? [0.2, 0.6, 0.3] : [0.85, 0.2, 0.2] });
      });
    });
    return out;
  }

  var api = { norm: norm, list: list, annotate: annotate, changeNotes: changeNotes, MAX: MAX, TXT: TXT };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.LY_COMMENTS = api;

  // ---------- browser ----------
  var LY = root.LY;
  if (!LY) return;
  var M = LY.M, t = LY.t, el = LY.el, $ = LY.$, ED = LY.ed;
  var S = { on: false, placing: false, hideOk: false, layer: null, bar: null };

  function newId() { return "c" + Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, "x") + (Date.now() % 1000); }
  function who() { return LY.track ? LY.track.who() : t("trk.me"); }
  function pageOf(id) { return M.find(LY.doc.pages, id); }
  function edit(pgId, fn) {
    LY.op(function (doc, now) {
      var p = M.find(doc.pages, pgId);
      if (!p) return false;
      var sz = M.pageSize(doc, p), cur = ((p.ext && p.ext.cm) || []).map(function (c) { return Object.assign({}, c); });
      if (fn(cur, now) === false) return false;
      var cm = norm(cur, sz.w, sz.h), x = Object.assign({}, p.ext || {});
      if (cm.length) x.cm = cm; else delete x.cm;
      if (Object.keys(x).length) p.ext = x; else delete p.ext;
      M.touch(p, now);
    });
  }

  function draw() {
    if (!S.layer) return;
    S.layer.innerHTML = "";
    if (!S.on || !LY.doc) return;
    var stage = $("stage"), cv = $("cv"), sr = stage.getBoundingClientRect(), cr = cv.getBoundingClientRect();
    var all = list(LY.doc, M), n = 0;
    all.forEach(function (x) {
      n++;
      if (x.c.ok && S.hideOk) return;
      var P = LY.pOf({ pg: x.pg });
      if (!P) return;
      var s = ED.toScreen(P.x + x.c.x, P.y + x.c.y);
      var b = el("button", "cm-pin" + (x.c.ok ? " ok" : ""), String(n));
      b.type = "button";
      b.style.left = Math.round(cr.left - sr.left + s[0]) + "px";
      b.style.top = Math.round(cr.top - sr.top + s[1]) + "px";
      b.title = x.c.t.slice(0, 200);
      b.setAttribute("aria-label", t("cm.pin", { n: n, p: x.n }) + ": " + x.c.t.slice(0, 120));
      b.addEventListener("click", function (e) { e.stopPropagation(); open(x.pg, x.c.id, n); });
      S.layer.appendChild(b);
    });
    if (S.bar) S.bar.querySelector(".cm-count").textContent = t("cm.count", { n: all.filter(function (x) { return !x.c.ok; }).length, d: all.filter(function (x) { return x.c.ok; }).length });
  }

  function textDlg(title, value, done, extra) {
    LY.openDialog(title, function (body, close) {
      var ta = el("textarea", "inp cm-txt");
      ta.maxLength = TXT; ta.rows = 5; ta.value = value || "";
      ta.setAttribute("aria-label", t("cm.text"));
      body.appendChild(ta);
      if (extra) extra(body, close);
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.cancel"), close));
      act.appendChild(LY.ui.btn(t("btn.ok"), function () { var v = txt(ta.value, TXT); if (!v) { ta.focus(); return; } close(); done(v); }, "primary"));
      body.appendChild(act);
      setTimeout(function () { ta.focus(); }, 0);
    });
  }
  function open(pgId, id, n) {
    var p = pageOf(pgId), c = p && ((p.ext && p.ext.cm) || []).filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    textDlg(t("cm.title", { n: n }), c.t, function (v) {
      edit(pgId, function (list) { var x = list.filter(function (y) { return y.id === id; })[0]; if (!x || x.t === v) return false; x.t = v; });
    }, function (body, close) {
      var d = new Date(c.at);
      body.appendChild(el("p", "hint", (c.by || "") + (c.at ? " · " + d.toLocaleString() : "") + (c.ok ? " · " + t("cm.resolved") : "")));
      var row = el("div", "pn-row wrap");
      row.appendChild(LY.ui.btn(t(c.ok ? "cm.reopen" : "cm.resolve"), function () {
        close();
        edit(pgId, function (list) { var x = list.filter(function (y) { return y.id === id; })[0]; if (!x) return false; if (x.ok) delete x.ok; else x.ok = 1; });
      }, "small"));
      var sure = false, del = LY.ui.btn(t("cm.delete"), function () {
        if (!sure) { sure = true; del.textContent = t("cm.deleteSure"); return; }
        close();
        edit(pgId, function (list) { var i = list.findIndex(function (y) { return y.id === id; }); if (i < 0) return false; list.splice(i, 1); });
      }, "small");
      row.appendChild(del);
      body.appendChild(row);
    });
  }
  function placeAt(e) {
    if (!S.placing) return;
    e.preventDefault(); e.stopPropagation();
    S.placing = false;
    S.bar && S.bar.classList.remove("placing");
    var cr = $("cv").getBoundingClientRect(), w = ED.toWorld(e.clientX - cr.left, e.clientY - cr.top), P = ED.pageAt(w[0], w[1], false);
    if (!P || P.master) { LY.toast(t("cm.noPage")); return; }
    var have = ((P.page.ext && P.page.ext.cm) || []).length;
    if (have >= MAX) { LY.toast(t("cm.full", { n: MAX })); return; }
    var x = w[0] - P.x, y = w[1] - P.y;
    textDlg(t("cm.new"), "", function (v) {
      edit(P.id, function (list) { list.push({ id: newId(), x: x, y: y, t: v, by: who(), at: Date.now() }); });
    });
  }

  // the proof: the pages as PDF, comments and tracked changes as notes
  function proof() {
    var doc = LY.doc;
    if (!doc) return;
    LY.flushStory && LY.flushStory();
    LY.toast(t("exp.working"));
    var order = M.pagesInOrder(doc), idx = {};
    order.forEach(function (p, i) { idx[p.id] = i; });
    var items = list(doc, M).filter(function (x) { return !x.c.ok; }).map(function (x) {
      return { page: idx[x.pg], x: x.c.x, y: x.c.y, t: x.c.t, by: x.c.by, at: x.c.at };
    });
    var L = ED.L || LY.R.computeLayout(doc);
    items = items.concat(changeNotes(doc, L, M, { ins: t("trk.ins"), del: t("trk.del") }));
    LY.io.pdfBlob(doc, { rgb: true, ppi: 150 }).then(function (blob) {
      return Promise.all([blob.arrayBuffer(), LY.io.script("../vendor/pdf-lib/pdf-lib.min.js", "PDFLib")]);
    }).then(function (r) {
      return annotate(r[1], new Uint8Array(r[0]), items, { title: doc.name });
    }).then(function (x) {
      return LY.io.saveBlob(new Blob([x.bytes], { type: "application/pdf" }), LY.io.fileName(doc, " (" + t("cm.proofFile") + ").pdf"), "application/pdf", "PDF", ".pdf").then(function (ok) {
        if (ok) LY.toast(t("cm.proofDone", { n: x.n }));
      });
    }).then(null, function (e) {
      try { console.error("[orOS] layout: proof PDF failed", e); } catch (x) {}
      LY.toast(t("exp.fail"));
    });
  }

  function show(on) {
    S.on = !!on;
    var stage = $("stage");
    if (!S.layer) {
      S.layer = el("div", "cm-layer");
      stage.appendChild(S.layer);
      $("cv").addEventListener("pointerdown", placeAt, true);
    }
    if (S.on && !S.bar) {
      var bar = S.bar = el("div", "cm-bar");
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", t("cm.bar"));
      bar.appendChild(el("span", "cm-count", ""));
      bar.appendChild(LY.ui.btn(t("cm.add"), function () { S.placing = !S.placing; bar.classList.toggle("placing", S.placing); if (S.placing) LY.toast(t("cm.tap")); }, "small primary"));
      var hide = LY.ui.btn(t("cm.hideOk"), function () { S.hideOk = !S.hideOk; hide.textContent = t(S.hideOk ? "cm.showOk" : "cm.hideOk"); draw(); }, "small");
      bar.appendChild(hide);
      bar.appendChild(LY.ui.btn(t("cm.proof"), proof, "small"));
      bar.appendChild(LY.ui.btn(t("btn.close"), function () { show(false); }, "small"));
      stage.appendChild(bar);
    }
    if (!S.on && S.bar) { S.bar.remove(); S.bar = null; S.placing = false; }
    draw();
  }

  LY.on("drawn", draw);
  LY.on("open", function () { show(false); });
  LY.comments = { show: show, on: function () { return S.on; }, proof: proof };
})(typeof window !== "undefined" ? window : this);
