// ============================================================
// orOS Layout — pdfout.js: a print PDF for the Assistant and orOS Gate
// (export_pdf, LY-PRO W1), loaded on first use.
//   __orosOpenAt("layout", { pdfOut: { key, chat, doc, preset, pages,
//                                      bleed, marks, spreads, down } })
// preset pdfx4 | print | screen. The request is checked again here.
// The named document opens, its PDF is built by designkit/pdf.js (bleed
// per side, the marks asked for), pdfx4 goes through designkit/pdfx.js
// (OutputIntent Coated FOGRA39, sRGB for RGB, XMP, embedded fonts
// only), preflight runs, the file goes to a free name in
// /internal/Layout/PDF/ and only numbers, boxes and check codes go
// back under `key` (never the book's text). The last report per
// document stays on this device (oros-layout-pdfout) for read_in_app.
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, t = LY.t;
  var MM = 25.4 / 72, LAST_KEY = "oros-layout-pdfout", LAST_MAX = 30;
  var PRESETS = { pdfx4: 1, print: 1, screen: 1 }, MARKS = ["crop", "bleed", "reg", "bars", "info"];
  var ICC = { cmyk: "../vendor/icc/ISOcoated_v2_eci.icc", srgb: "../vendor/icc/sRGB_IEC61966-2-1.icc" };

  function clean(v, n) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : ""; }
  // the request, checked again (assistant/core.js normPdf made it)
  function norm(rq) {
    var preset = PRESETS[rq.preset] ? rq.preset : "pdfx4";
    var pages = typeof rq.pages === "string" ? rq.pages.replace(/\s+/g, "").toLowerCase().slice(0, 60) : "";
    if (pages && !/^(all|odd|even|\d{1,4}(-\d{1,4})?(,\d{1,4}(-\d{1,4})?)*)$/.test(pages)) return null;
    var mk = {}, any = false, src = rq.marks && typeof rq.marks === "object" ? rq.marks : {};
    MARKS.forEach(function (k) { if (src[k]) { mk[k] = true; any = true; } });
    return { doc: clean(rq.doc, 200), preset: preset, pages: pages === "all" ? "" : pages, bleed: !!rq.bleed,
             marks: any ? mk : null, spreads: !!rq.spreads, down: rq.down !== 0,
             creep: Math.max(0, Math.min(5, Number(rq.creep) || 0)),
             out: (Array.isArray(rq.out) ? rq.out : typeof rq.out === "string" ? [rq.out] : []).filter(function (o) { return typeof o === "string" && o.trim() && o.length <= 1030; }).slice(0, 2) };
  }
  // the document by name: the same name first, else a part of it; the
  // newest one wins
  function docFor(want) {
    var live = LY.data().docs.filter(function (d) { return !d.del && !M.needsNewer(d); });
    want = want.toLowerCase();
    if (!want) return LY.doc && live.indexOf(LY.doc) !== -1 ? LY.doc : null;
    var eq = live.filter(function (d) { return LY.docTitle(d).toLowerCase() === want; });
    var part = eq.length ? eq : live.filter(function (d) { return LY.docTitle(d).toLowerCase().indexOf(want) !== -1; });
    return part.sort(function (a, b) { return M.maxM(b) - M.maxM(a); })[0] || null;
  }
  // "1-4,9" / "odd" / "even" / "" → page ids (positions from 1)
  function pageIds(doc, spec) {
    var order = M.pagesInOrder(doc), on = {};
    if (!spec) return order.map(function (p) { return p.id; });
    if (spec === "odd" || spec === "even") return order.filter(function (p, i) { return (i % 2 === 0) === (spec === "odd"); }).map(function (p) { return p.id; });
    spec.split(",").forEach(function (part) {
      var m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) return;
      var a = +m[1], b = m[2] ? +m[2] : a;
      if (b < a) { var x = a; a = b; b = x; }
      for (var i = a; i <= b && i <= order.length; i++) on[i] = 1;
    });
    return order.filter(function (p, i) { return on[i + 1]; }).map(function (p) { return p.id; });
  }

  var iccP = null;
  function profiles() {
    if (iccP) return iccP;
    function get(u) {
      return fetch(u).then(function (r) { if (!r.ok) throw new Error("icc"); return r.arrayBuffer(); }).then(function (ab) { return new Uint8Array(ab); });
    }
    iccP = Promise.all([get(ICC.cmyk), get(ICC.srgb)]).then(function (r) { return { icc: r[0], srgb: r[1] }; });
    iccP.then(null, function () { iccP = null; });
    return iccP;
  }
  function pdfxLib() {
    var lib = LY.io.script("../vendor/pdf-lib/pdf-lib.min.js", "PDFLib");
    var px = window.orosDK && window.orosDK.pdfx ? Promise.resolve(window.orosDK.pdfx) : new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "../designkit/pdfx.js";
      s.onload = function () { if (window.orosDK && window.orosDK.pdfx) res(window.orosDK.pdfx); else rej(new Error("pdfx")); };
      s.onerror = function () { rej(new Error("pdfx")); };
      document.head.appendChild(s);
    });
    return Promise.all([lib, px, profiles()]);
  }

  // The checks the person sees in Preflight, plus pictures that stop
  // at the trim and an empty ISBN (Publishing's print format) — pages
  // by position from 1; master items carry no page.
  function problems(doc, L) {
    var order = M.pagesInOrder(doc), pos = {}, out = [], seen = {};
    order.forEach(function (p, i) { pos[p.id] = i + 1; });
    LY.R.preflight(doc, L, { isMissing: LY.A.isMissing }).forEach(function (p) {
      seen[p.code + ":" + p.id] = 1;
      out.push({ sev: p.sev, code: p.code, id: p.id, page: pos[p.pg] || 0 });
    });
    var PRO = window.LayoutPro;
    if (PRO) PRO.noBleed(doc).forEach(function (p) { if (!seen["bleed:" + p.id]) out.push({ sev: "warn", code: "bleed", id: p.id, page: p.page }); });
    var O = window.LY_OUT, isbn = "";
    if (O) {
      var prof = O.list(doc).filter(function (p) { return p.k === "print"; })[0] || { k: "print" };
      try { isbn = O.edition(doc, prof, LY.publishData ? LY.publishData() : null).isbn || ""; } catch (e) { isbn = ""; }
    }
    if (!isbn) out.push({ sev: "warn", code: "isbnEmpty", page: 0 });
    return out;
  }
  function boxMm(b) { return b ? { w: Math.round((b[2] - b[0]) * MM * 10) / 10, h: Math.round((b[3] - b[1]) * MM * 10) / 10 } : null; }

  function keepLast(doc, rep) {
    try {
      var all = JSON.parse(localStorage.getItem(LAST_KEY) || "{}");
      if (!all || typeof all !== "object" || Array.isArray(all)) all = {};
      all[doc.id] = { at: Date.now(), rep: rep };
      var ids = Object.keys(all).sort(function (a, b) { return (all[b].at || 0) - (all[a].at || 0); });
      ids.slice(LAST_MAX).forEach(function (id) { delete all[id]; });
      localStorage.setItem(LAST_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  var busy = false;
  function make(doc, q) {
    var ids = pageIds(doc, q.pages);
    if (!ids.length) return Promise.reject(new Error("nopages"));
    var L = doc === LY.doc && LY.ed && LY.ed.L ? LY.ed.L : LY.R.computeLayout(doc);
    var stat = {}, print = q.preset !== "screen";
    var opts = { pages: ids, layout: L, spreads: !!(q.spreads && doc.setup.facing), bleed: print && q.bleed, marks: print ? q.marks : null,
                 ppi: !q.down ? 2400 : q.preset === "screen" ? 150 : 300, rgb: q.preset === "screen", imgStat: stat,
                 creep: print && q.creep ? q.creep * 72 / 25.4 : 0 };
    // the screen PDF: web and e-mail addresses are links (Chris 2026-11-18)
    if (!print && window.LY_OUT && window.LY_OUT.urlLinks) opts.links = window.LY_OUT.urlLinks(doc, L);
    var fontP = LY.T && LY.T.load ? Promise.resolve(LY.T.load(["sans-r"])).then(null, function () {}) : Promise.resolve();
    var libs = q.preset === "pdfx4" ? pdfxLib() : Promise.resolve(null);
    return Promise.all([fontP, libs]).then(function (r) {
      return LY.io.pdfDoc(doc, opts).then(function (pdf) { return { pdf: pdf, libs: r[1] }; });
    }).then(function (o) {
      var boxes = (o.pdf.orosBoxes || []).slice(), n = o.pdf.getNumberOfPages();
      var bytes = new Uint8Array(o.pdf.output("arraybuffer"));
      var base = { boxes: boxes, n: n, stat: stat, L: L };
      if (!o.libs) return Object.assign(base, { bytes: bytes, fx: [] });
      return o.libs[1].make(o.libs[0], bytes, { icc: o.libs[2].icc, srgb: o.libs[2].srgb, title: doc.name || LY.docTitle(doc) })
        .then(function (x) { return Object.assign(base, { bytes: x.bytes, fx: x.problems, intent: x.intent, pdfx: "PDF/X-4" }); });
    });
  }
  function save(doc, q, bytes) {
    var fs = LY.io.diskFs();
    if (!fs || typeof fs.writeBlob !== "function") return Promise.resolve("");
    var suffix = q.preset === "pdfx4" ? " (PDF-X-4).pdf" : q.preset === "screen" ? " (screen).pdf" : " (print).pdf";
    var dir = LY.io.PDF_DIR;
    return Promise.resolve(fs.mkdir ? fs.mkdir(dir) : null).then(null, function () {}).then(function () {
      return LY.io.freePdfPath(fs, LY.io.fileName(doc, suffix));
    }).then(function (p) {
      if (!p) return "";
      return Promise.resolve(fs.writeBlob(p, new Blob([bytes], { type: "application/pdf" }))).then(function () { return p; });
    }).then(null, function () { return ""; });
  }

  // LOCAL-1, GX-1: a copy in out (a local write folder the owner opened
  // and/or a folder of Claude's on the orOS disk); never replaces a file
  function saveOut(doc, q, bytes) {
    if (!q.out.length) return Promise.resolve({ saved: [], outFail: [] });
    var suffix = q.preset === "pdfx4" ? " - PDF-X-4.pdf" : q.preset === "screen" ? " - screen.pdf" : " - print.pdf";
    return LY.io.saveOut(q.out, LY.io.fileName(doc, suffix), new Blob([bytes], { type: "application/pdf" }), "export_pdf");
  }
  function run(rq, back) {
    var q = norm(rq || {});
    if (!q) { back({ failed: 1, why: "bad" }); return; }
    if (busy) { back({ failed: 1, why: "busy" }); return; }
    var doc = docFor(q.doc);
    if (!doc) { LY.toast(t("ep.noDoc")); back({ failed: 1, why: "noDoc" }); return; }
    busy = true;
    if (!LY.doc || LY.doc.id !== doc.id) { if (LY.doc) LY.goHome(); LY.openDoc(doc.id); }
    var done = function (rep) { busy = false; back(rep); };
    // after the editor has laid out the document it just opened
    setTimeout(function () {
      if (!LY.doc || LY.doc.id !== doc.id) { done({ failed: 1, why: "noDoc" }); return; }
      LY.flushStory && LY.flushStory();
      LY.toast(t("exp.working"));
      var d = LY.doc;
      make(d, q).then(function (res) {
        return Promise.all([save(d, q, res.bytes), saveOut(d, q, res.bytes)]).then(function (two) {
          var path = two[0], loc = two[1];
          var pf = problems(d, res.L);
          (res.fx || []).forEach(function (p) { pf.push({ sev: "err", code: p.code, page: p.page || 0 }); });
          var b0 = res.boxes[0] || null;
          var rep = { ok: 1, doc: LY.docTitle(d).slice(0, 120), preset: q.preset, path: path, bytes: res.bytes.length, pages: res.n,
                      trim: b0 ? boxMm(b0.trim) : null, bleedBox: b0 ? boxMm(b0.bleed) : null, problems: pf.slice(0, 80), down: res.stat.down || 0 };
          if (res.intent) rep.intent = res.intent;
          if (res.pdfx) rep.pdfx = res.pdfx;
          if (!path) rep.why = "noDisk";
          if (loc.saved.length) rep.saved = loc.saved;
          if (loc.outFail.length) rep.outFail = loc.outFail;
          keepLast(d, rep);
          LY.toast(path ? t("exp.sentAt", { path: path.slice("/internal/".length) }) : t("ep.noDisk"));
          done(rep);
        });
      }).then(null, function (e) {
        try { console.error("[orOS] layout: the Assistant's PDF failed", e); } catch (x) {}
        var np = e && e.message === "nopages";
        LY.toast(t(np ? "out.noPages" : "exp.fail"));
        done({ failed: 1, why: np ? "noPages" : "error" });
      });
    }, 300);
  }

  // The person's own PDF/X-4 (Export › Quality › PDF/X-4, LY-PORT-C):
  // a print PDF's bytes → Promise<{ bytes, problems, cmyk }>; o.cmyk
  // converts its colours to the print profile's CMYK.
  // LY-W9: o.x1a makes PDF/X-1a (all CMYK, pictures too); the
  // document's own printer profile when it has one (LY.proof), and in
  // CMYK the colours that overprint do so.
  function pdfx(doc, bytes, o) {
    o = o || {};
    var own = LY.proof ? LY.proof.profile(doc) : Promise.resolve(null);
    return Promise.all([pdfxLib(), own]).then(function (q) {
      var r = q[0], pr = q[1], x1a = !!o.x1a, opt = { icc: pr ? pr.icc : r[2].icc, srgb: r[2].srgb, title: doc.name || LY.docTitle(doc), cmyk: !!o.cmyk, x1a: x1a };
      if (pr) opt.cond = pr.cond;
      if (x1a) opt.decode = decodeJpeg;
      if ((x1a || o.cmyk) && LY.proof) opt.overprint = LY.proof.opFor(doc);
      return r[1].make(r[0], bytes, opt);
    });
  }
  // a JPEG's pixels → { w, h, data RGBA }
  function decodeJpeg(bytes) {
    var blob = new Blob([bytes], { type: "image/jpeg" });
    var get = typeof createImageBitmap === "function" ? createImageBitmap(blob) : new Promise(function (res, rej) {
      var u = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); res(im); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("jpeg")); };
      im.src = u;
    });
    return get.then(function (im) {
      var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      var cx = cv.getContext("2d");
      cx.drawImage(im, 0, 0);
      if (im.close) im.close();
      return { w: w, h: h, data: cx.getImageData(0, 0, w, h).data };
    });
  }
  window.LY_PDFOUT = { run: run, norm: norm, pdfx: pdfx };
})();
