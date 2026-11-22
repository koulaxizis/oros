// ============================================================
// orOS Layout — epubout.js: an EPUB for the Assistant and orOS Gate
// (export_epub, AS-EPUB; LY-EPUB wave L7 E4), loaded on first use.
//   __orosOpenAt("layout", { epubOut: { key, chat, doc?, title?,
//                                       edition?, layout?, ready? } })
// The request is checked again here. The named document (or the newest
// one linked to a live Publishing title of that name) opens, its EPUB
// edition (by name, else the first; layout overrides fx on a copy) is
// made and checked, a copy goes to /internal/Layout/EPUB/, the usual
// report shows on the screen and only its numbers and check codes go
// back under `key` (never the book's text).
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, t = LY.t;

  // export_epub (LY-EPUB E4): the request is checked again here.
  var EP_LAYOUT = { reflowable: 0, fixed: 1, pictures: 2 };
  function epubDocFor(rq) {
    var live = LY.data().docs.filter(function (d) { return !d.del && !M.needsNewer(d); });
    var want = typeof rq.doc === "string" ? rq.doc.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 200) : "";
    if (want) {
      var eq = live.filter(function (d) { return LY.docTitle(d).toLowerCase() === want; });
      var part = eq.length ? eq : live.filter(function (d) { return LY.docTitle(d).toLowerCase().indexOf(want) !== -1; });
      return part.sort(function (a, b) { return M.maxM(b) - M.maxM(a); })[0] || null;
    }
    var tname = typeof rq.title === "string" ? rq.title.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 200) : "";
    var pd = LY.publishData && LY.publishData(), tombs = pd && pd.tombs || {};
    if (!tname || !pd || !Array.isArray(pd.titles)) return null;
    var ids = {};
    pd.titles.forEach(function (x) {
      if (x && typeof x.id === "string" && !(tombs[x.id] >= x.m) && String(x.t || "").replace(/\s+/g, " ").trim().toLowerCase() === tname) ids[x.id] = 1;
    });
    return live.filter(function (d) { return d.setup && d.setup.ext && ids[d.setup.ext.pub]; })
      .sort(function (a, b) { return M.maxM(b) - M.maxM(a); })[0] || null;
  }
  function epubProfFor(doc, rq) {
    var list = window.LY_OUT ? window.LY_OUT.list(doc).filter(function (p) { return p.k === "epub"; }) : [];
    var want = typeof rq.edition === "string" ? rq.edition.trim().toLowerCase().slice(0, 60) : "";
    var prof = want ? list.filter(function (p) { return String(p.n || "").toLowerCase() === want; })[0] : list[0];
    if (!prof) return null;
    prof = JSON.parse(JSON.stringify(prof));
    if (Object.prototype.hasOwnProperty.call(EP_LAYOUT, rq.layout)) {
      if (EP_LAYOUT[rq.layout]) prof.fx = EP_LAYOUT[rq.layout]; else delete prof.fx;
    }
    return prof;
  }
  // The numbers of a made EPUB for the Assistant (no text of the book).
  function epubSummary(res, prof, doc, ready) {
    var rep = res.report, chk = res.check, info = chk.info || {};
    var codes = function (l) { return l.map(function (r) { return String(r.c || "").slice(0, 20); }).slice(0, 50); };
    var cov = res.cover, pub = res.pub;
    var hasIsbn = /^urn:isbn:/.test(info.uid || "");
    return {
      ok: 1, doc: LY.docTitle(doc).slice(0, 120), edition: String(prof.n || "").slice(0, 60),
      layout: prof.fx === 2 ? "pictures" : prof.fx === 1 ? "fixed" : "reflowable",
      path: res.path || "", bytes: res.bytes.length,
      chapters: rep.chapters || 0, pages: rep.pages || 0, headings: rep.headings || 0, images: rep.images || 0,
      noAlt: (rep.noAlt || []).map(function (x) { return x.page; }).slice(0, 50),
      overset: rep.overset || 0, shapes: rep.shapes || 0, rotated: rep.rotated || 0,
      fontsMissing: (rep.fonts || []).filter(function (f) { return !f.ok; }).length,
      fontsObfuscated: (rep.fonts || []).filter(function (f) { return f.ok && f.obf; }).length,
      errors: codes(chk.errors), warnings: codes(chk.warnings),
      isbn: hasIsbn ? info.uid.slice(9) : "", lang: typeof info.lang === "string" ? info.lang.slice(0, 35) : "",
      cover: cov ? (cov.h && (cov.h < 1600 || cov.w < 1000) ? "small" : "ok") : "none",
      isbnBad: !hasIsbn && res.ed && res.ed.isbn && window.LY_EPUB && !window.LY_EPUB.isbnOk(res.ed.isbn) ? 1 : 0,
      publishing: pub ? 1 : 0, ready: ready
    };
  }
  var epubBusy = false;
  function run(rq, back) {
    if (epubBusy) { back({ failed: 1, why: "busy" }); return; }
    var doc = epubDocFor(rq);
    if (!doc) { LY.toast(t("ep.noDoc")); back({ failed: 1, why: "noDoc" }); return; }
    var prof = epubProfFor(doc, rq);
    if (!prof) { LY.toast(t("ep.fail")); back({ failed: 1, why: "noEdition" }); return; }
    epubBusy = true;
    if (!LY.doc || LY.doc.id !== doc.id) { if (LY.doc) LY.goHome(); LY.openDoc(doc.id); }
    var done = function (rep) { epubBusy = false; back(rep); };
    // after the editor has laid out the document it just opened
    setTimeout(function () {
      if (!LY.doc || LY.doc.id !== doc.id) { done({ failed: 1, why: "noDoc" }); return; }
      LY.flushStory && LY.flushStory();
      LY.toast(t("ep.working"));
      LY.io.epubOf(LY.doc, prof).then(function (res) {
        return LY.io.previewEpub(Object.assign(res, { quiet: true })).then(function () {
          var errs = res.check.errors.length, eb = res.pub && res.ed && res.ed.fmt && res.ed.fmt.k === "eb";
          var ready = rq.ready === 1 ? (!res.path ? "noDisk" : errs ? "errors" : !eb ? "noFormat" : "yes") : "";
          LY.panels.epubReport(res, prof);
          var sum = epubSummary(res, prof, LY.doc, ready), d = LY.doc;
          if (ready === "yes") LY.panels.epubMarkReady(res);
          // GX-1: a copy in out (a local write folder and/or Claude's folders)
          return LY.io.saveOut(rq.out, LY.io.fileName(d, ".epub"), new Blob([res.bytes], { type: "application/epub+zip" }), "export_epub").then(function (o) {
            if (o.saved.length) sum.saved = o.saved;
            if (o.outFail.length) sum.outFail = o.outFail;
            done(sum);
          });
        });
      }).then(null, function (e) {
        try { console.error("[orOS] layout: the Assistant's EPUB failed", e); } catch (x) {}
        LY.toast(t(e && e.message === "nopages" ? "out.noPages" : "ep.fail"));
        done({ failed: 1, why: e && e.message === "nopages" ? "noPages" : "error" });
      });
    }, 300);
  }

  window.LY_EPUBOUT = { run: run };
})();
