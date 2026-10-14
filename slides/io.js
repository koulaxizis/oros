// ============================================================
// orOS Slides — show and files (v1.0.0)
//   - the slide show: designkit/show.js, slides drawn by dk.js
//     (presenter view in a second window, rehearsal timings)
//   - PDF (designkit/pdf.js + jsPDF, loaded on first use): one slide
//     per page, vector text; or A4 pages with the speaker notes
//   - PNG of one slide
//   - .orosslides package: the deck + its pictures (base64) in one
//     JSON file; opened as a NEW deck (fresh ids), every picture
//     checked against its hash and decoded as an image first
//   - PowerPoint (.pptx): written and read by pptx.js (ZIP by
//     atelier/zip.js); an opened file is a NEW deck, its pictures
//     stored on the orOS disk like any picture added here
//   - pictures: designkit/assets.js (one file per picture, R30)
// All file I/O goes through orosDialog (R33).
// ============================================================
(function () {
  "use strict";

  var SL = window.SL, C = SL.C, t = SL.t;
  var A = SL.A, P = SL.P, R = SL.R, D = SL.D;
  var PKG_KIND = "oros-slides-package", PKG_VER = 1;
  var PKG_MAX = 300 * 1024 * 1024;

  function ED() { return SL.ed; }
  function deckName(d) {
    var n = String(d.t || "slides").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80);
    return n || "slides";
  }
  function today() { return SL.fmtDate(Date.now(), true); }

  function saveBlob(blob, name, mime, desc, ext) {
    var dlg = SL.dialogHost();
    var types = [{ description: desc, accept: {} }];
    types[0].accept[mime] = [ext];
    if (dlg && typeof dlg.saveFile === "function") {
      return dlg.saveFile({ blob: blob, filename: name, mime: mime, types: types }).then(function (r) { return !!(r && r.ok); });
    }
    // standalone (no shell): classic download
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
    return Promise.resolve(true);
  }
  function pickFile(accept) {
    var dlg = SL.dialogHost();
    if (dlg && typeof dlg.openFile === "function") return dlg.openFile(accept);
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept;
      inp.addEventListener("change", function () { resolve(inp.files && inp.files[0] || null); });
      inp.click();
    });
  }
  function toBlob(cv, type, q) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("encode")); }, type, q);
    });
  }

  // Pictures of a deck start loading early, so the show and the
  // thumbnails have them.
  function assetIds(data, deckId) {
    var ids = {};
    C.deckSlides(data, deckId).forEach(function (s) {
      C.slideItems(data, s.id).forEach(function (it) { if (it.k === "image" && it.img) ids[it.img.a] = 1; });
    });
    return Object.keys(ids).sort();
  }
  function preload() {
    if (!SL.deck) return;
    assetIds(SL.data(), SL.deck).forEach(function (id) { A.get(id); });
  }

  // ---------- Show ----------
  function present(opts) {
    opts = opts || {};
    if (!SL.deck) return;
    SL.emit("flush");
    var list = ED().slides();
    if (!list.length) return;
    if (list.every(function (s) { return s.hid; })) { SL.toast(t("show.allHidden")); return; }
    var d = SL.curDeck(), S = window.orosDK.show;
    var data = SL.data(), still = SL.reducedMotion();
    var plans = list.map(function (s) { return SL.animPlan(s.id); });
    function trDur(i) { return list[i] && list[i].td || 450; }
    // Effects that start by themselves wait for the transition to end.
    function since(i, t, step) {
      var ms = t * 1000;
      if (!step && list[i].tr && list[i].tr !== "none" && !still) ms -= trDur(i);
      return ms;
    }
    if (SL.showCtl && !SL.showCtl.state().closed) SL.showCtl.close();
    SL.showCtl = S.start({
      count: list.length,
      aspect: C.widthOf(d.as) / C.H,
      hidden: list.map(function (s) { return s.hid; }),
      startAt: Math.max(0, Math.min(list.length - 1, opts.from || 0)),
      lang: SL.LANG,
      presenter: !!opts.presenter,
      renderSlide: function (i, canvas, w, h, t, step) {
        if (t === undefined) SL.renderFrame(list[i].id, canvas, canvas.width, { step: step || 0 });
        else SL.renderFrame(list[i].id, canvas, canvas.width, { step: step || 0, t: since(i, t, step), still: still });
      },
      steps: function (i) { return plans[i] ? plans[i].clicks : 0; },
      live: function (i, t, step) {
        var pl = plans[i];
        if (!pl || still || !pl.steps[step || 0] || !pl.steps[step || 0].length) return false;
        return since(i, t, step) <= SL.Anim.stepEnd(pl, step || 0) + 40;
      },
      notes: function (i) { return list[i] ? data.slides[list[i].id] && data.slides[list[i].id].n || "" : ""; },
      title: function (i) { return list[i] ? C.slideTitle(data, list[i].id) || t("slide.n", { n: i + 1 }) : ""; },
      transition: function (i) { return list[i] ? list[i].tr : "none"; },
      duration: trDur,
      tools: SL.remote ? [{ text: t("rm.short"), label: t("rm.control"), fn: function () { SL.remote.host(); } }] : [],
      onChange: function (st) { if (SL.remote) SL.remote.showChanged(st, list, data); },
      onEnd: function (sum) {
        if (sum && sum.total > 5000) SL.toast(t("show.summary", { t: S.fmtElapsed(sum.total) }));
      }
    });
  }

  // ---------- PDF ----------
  var jspdfP = null;
  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (jspdfP) return jspdfP;
    jspdfP = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "../vendor/jspdf.umd.min.js";
      s.onload = function () { if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF); else reject(new Error("jspdf")); };
      s.onerror = function () { jspdfP = null; reject(new Error("jspdf")); };
      document.head.appendChild(s);
    });
    return jspdfP;
  }

  // The visible part of a picture, resampled to `ppi` (never up).
  function cropImage(it, ppi) {
    var crop = P.imageCrop(it);
    if (!crop) return Promise.resolve(null);
    return (SL.loadImage || A.load)(it.a).then(function (img) {
      if (!img) return null;
      var k = (img.naturalWidth || img.width) / (it.iw || 1);
      var src = { x: crop.src.x * k, y: crop.src.y * k, w: crop.src.w * k, h: crop.src.h * k };
      var cw = Math.max(1, Math.round(Math.min(src.w, crop.rect.w / 72 * ppi)));
      var ch = Math.max(1, Math.round(Math.min(src.h, crop.rect.h / 72 * ppi)));
      var cv = document.createElement("canvas");
      cv.width = cw; cv.height = ch;
      var png = /\.png$/.test(it.a);
      cv.getContext("2d").drawImage(img, src.x, src.y, src.w, src.h, 0, 0, cw, ch);
      return toBlob(cv, png ? "image/png" : "image/jpeg", 0.9).then(function (b) { return b.arrayBuffer(); }).then(function (ab) {
        return { data: new Uint8Array(ab), fmt: png ? "PNG" : "JPEG", rect: crop.rect, alias: it.id + "-" + ppi };
      });
    });
  }

  var exporting = false;
  function exportPdf(handout) {
    if (!SL.deck || exporting) return;
    SL.emit("flush");
    var d = SL.curDeck(), all = ED().slides();
    var shown = all.filter(function (s) { return !s.hid; });
    if (!shown.length) shown = all;
    if (!shown.length) return;
    exporting = true;
    SL.toast(t("exp.working"));
    var built = D.build(SL.data(), SL.deck, shown.map(function (s) { return s.id; }), { date: today(), handout: !!handout, lang: SL.LANG });
    if (SL.charts) SL.charts.register(built);
    var doc = built.doc, images = {}, JsPDF;
    loadJsPDF().then(function (J) {
      JsPDF = J;
      var chain = Promise.resolve();
      doc.items.forEach(function (it) {
        if (it.t !== "img" || !it.a) return;
        chain = chain.then(function () { return cropImage(it, handout ? 150 : 220); }).then(function (im) { if (im) images[it.id] = im; });
      });
      return chain;
    }).then(function () {
      var pdf = P.build(doc, { title: d.t || t("deck.untitled") }, { jsPDF: JsPDF, layout: R.computeLayout(doc), images: images });
      try { pdf.setProperties({ title: d.t || t("deck.untitled"), creator: "orOS Slides" }); } catch (e) {}
      return saveBlob(pdf.output("blob"), deckName(d) + (handout ? " (notes)" : "") + ".pdf", "application/pdf", "PDF", ".pdf");
    }).then(function (ok) {
      exporting = false;
      if (ok) SL.toast(t("exp.done"));
    }, function (e) {
      exporting = false;
      try { console.error("[orOS] slides: PDF export failed", e); } catch (x) {}
      SL.toast(t("exp.fail"));
    });
  }

  // ---------- PNG ----------
  function exportPng(slideId) {
    var s = SL.data().slides[slideId];
    if (!s) return;
    var ids = [];
    C.slideItems(SL.data(), slideId).forEach(function (it) { if (it.k === "image" && it.img) ids.push(it.img.a); });
    var waits = ids.map(function (id) { return A.load(id); });
    var b = SL.D.slideDoc(SL.data(), slideId, { lang: SL.LANG });
    SL.charts.register(b);
    Object.keys(b.charts || {}).forEach(function (k) { waits.push(SL.charts.load(k)); });
    Promise.all(waits).then(function () {
      var cv = SL.renderSlide(slideId, 1920);
      return toBlob(cv, "image/png");
    }).then(function (blob) {
      var n = ED().indexOf(slideId) + 1;
      return saveBlob(blob, deckName(SL.curDeck()) + " " + n + ".png", "image/png", "PNG", ".png");
    }).then(function (ok) { if (ok) SL.toast(t("exp.png")); }, function () { SL.toast(t("exp.fail")); });
  }

  // ---------- Packages ----------
  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result); resolve(s.slice(s.indexOf(",") + 1)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function b64ToBlob(b64, type) {
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: type });
  }

  function exportPackage(deckId) {
    if (SL.deck === deckId) SL.emit("flush");
    var data = SL.data(), d = data.decks[deckId];
    if (!d) return;
    var slides = C.deckSlides(data, deckId), items = [];
    slides.forEach(function (s) { items = items.concat(C.slideItems(data, s.id)); });
    var assets = {}, chain = Promise.resolve();
    assetIds(data, deckId).forEach(function (id) {
      chain = chain.then(function () { return A.blob(id); }).then(function (b) {
        if (b) return blobToB64(b).then(function (s) { assets[id] = s; });
      });
    });
    chain.then(function () {
      var pkg = { kind: PKG_KIND, ver: PKG_VER, deck: d, slides: slides, items: items, assets: assets };
      var blob = new Blob([JSON.stringify(pkg)], { type: "application/json" });
      return saveBlob(blob, deckName(d) + ".orosslides", "application/json", "orOS Slides", ".orosslides");
    }).then(function (ok) { if (ok) SL.toast(t("exp.pkgDone")); }, function () { SL.toast(t("exp.fail")); });
  }

  // A package as a NEW deck: every id is fresh, so it never overwrites
  // or brings back another deck; everything is normalized (core.js
  // drops what is not slides data).
  function readPackage(pkg, nw, newId) {
    if (!pkg || pkg.kind !== PKG_KIND || pkg.ver !== PKG_VER || !pkg.deck) return null;
    var src = { decks: {}, slides: {}, items: {} };
    var dk = C.normDeck(pkg.deck);
    if (!dk) return null;
    src.decks[dk.id] = dk;
    (Array.isArray(pkg.slides) ? pkg.slides : []).slice(0, C.LIM.slides).forEach(function (s) { s = C.normSlide(s); if (s && s.d === dk.id) src.slides[s.id] = s; });
    (Array.isArray(pkg.items) ? pkg.items : []).slice(0, C.LIM.slides * C.LIM.items).forEach(function (it) { it = C.normItem(it); if (it && src.slides[it.s]) src.items[it.id] = it; });
    var clean = C.canonical(src);
    var map = {};
    function fresh(id) { return map[id] || (map[id] = newId()); }
    var out = { deck: null, slides: [], items: [] };
    var d = JSON.parse(JSON.stringify(clean.decks[dk.id]));
    if (!d) return null;
    d.id = fresh(d.id); d.m = nw; d.c = nw; d.tm = nw;
    out.deck = d;
    C.deckSlides(clean, dk.id).forEach(function (s) {
      var x = JSON.parse(JSON.stringify(s));
      var old = x.id;
      x.id = fresh(old); x.d = d.id; x.m = nw; x.tm = nw; x.nb = 0; x.nm = x.n ? nw : 0;
      out.slides.push(x);
      C.slideItems(clean, old).forEach(function (it) {
        var y = JSON.parse(JSON.stringify(it));
        y.id = fresh(y.id); y.s = x.id; y.m = nw;
        if (y.k === "text") y.b = 0;
        out.items.push(y);
      });
    });
    return out;
  }
  SL.readPackage = readPackage;

  function importPackage() {
    pickFile(".orosslides,.pptx,application/json,.json," + X().MIME).then(openFile, function () { SL.toast(t("imp.bad")); });
  }
  // Also the way in for a file from the system's "Open with" (shell fileopen.js).
  // A .pptx (a ZIP) goes to openPptx, anything else is read as a package.
  function openFile(f) {
    return Promise.resolve(f).then(function (f) {
      if (!f) return;
      if (f.size > PKG_MAX) { SL.toast(t("imp.bad")); return; }
      return f.slice(0, 4).arrayBuffer().then(function (head) {
        if (X().isZip(new Uint8Array(head)) || /\.pptx$/i.test(f.name || "")) return openPptx(f);
        return openPackageFile(f);
      });
    }).then(null, function () { SL.toast(t("imp.bad")); });
  }
  function openPackageFile(f) {
    return Promise.resolve(f).then(function (f) {
      return f.text().then(function (txt) {
        var pkg = null;
        try { pkg = JSON.parse(txt); } catch (e) {}
        var probe = pkg ? readPackage(pkg, SL.now(), SL.newId) : null;
        if (!probe) { SL.toast(t("imp.bad")); return; }
        var assets = pkg.assets && typeof pkg.assets === "object" ? pkg.assets : {};
        var want = {};
        probe.items.forEach(function (it) { if (it.k === "image" && it.img) want[it.img.a] = 1; });
        var failed = 0, chain = Promise.resolve();
        Object.keys(want).forEach(function (id) {
          var b64 = assets[id];
          if (typeof b64 !== "string" || !A.ID_RE.test(id)) { failed++; return; }
          chain = chain.then(function () {
            return A.put(id, b64ToBlob(b64, /\.png$/.test(id) ? "image/png" : "image/jpeg"));
          }).then(null, function () { failed++; });
        });
        return chain.then(function () {
          var id = SL.addDeckData(function (dt, nw) {
            var p = readPackage(pkg, nw, SL.newId);
            if (!p) return null;
            dt.decks[p.deck.id] = p.deck;
            p.slides.forEach(function (s) { dt.slides[s.id] = s; });
            p.items.forEach(function (it) { dt.items[it.id] = it; });
            return p.deck.id;
          });
          if (id) {
            SL.openDeck(id);
            SL.toast(failed ? t("imp.imgFail", { n: failed }) : t("imp.done"));
          }
        });
      });
    }).then(null, function () { SL.toast(t("imp.bad")); });
  }

  // ---------- PowerPoint (.pptx) ----------
  // slides/pptx.js writes and reads; atelier/zip.js packs and unpacks.
  function X() { return window.OrosSlidesPPTX; }
  function promptTexts() {
    var o = {};
    C.ROLES.forEach(function (r) { o[r] = t("ph." + r); });
    return o;
  }
  var pptxBusy = false;
  function exportPptx(deckId) {
    if (pptxBusy) return;
    if (SL.deck === deckId) SL.emit("flush");
    var data = SL.data(), d = data.decks[deckId];
    if (!d) return;
    pptxBusy = true;
    var media = {}, chain = Promise.resolve();
    X().needs(data, deckId).forEach(function (id) {
      chain = chain.then(function () { return A.blob(id); }).then(function (b) {
        if (b) return b.arrayBuffer().then(function (ab) { media[id] = new Uint8Array(ab); });
      }).then(null, function () {});
    });
    // charts: their pictures, drawn by the Spreadsheet's chart engine
    var specs = X().charts(data, deckId, SL.LANG);
    Object.keys(specs).forEach(function (key) {
      chain = chain.then(function () {
        SL.charts.want(key, specs[key]);
        return SL.charts.load(key);
      }).then(function (cv) {
        if (!cv) return;
        return toBlob(cv, "image/png").then(function (b) { return b.arrayBuffer(); }).then(function (ab) { media[key] = new Uint8Array(ab); });
      }).then(null, function () {});
    });
    var res = null;
    chain.then(function () {
      res = X().write(SL.data(), deckId, media, { prompts: promptTexts(), lang: SL.LANG });
      var blob = new Blob([res.bytes], { type: X().MIME });
      return saveBlob(blob, deckName(d) + ".pptx", X().MIME, "PowerPoint", ".pptx");
    }).then(function (ok) {
      pptxBusy = false;
      if (ok) SL.toast(res.out.missing ? t("exp.pptxMissing", { n: res.out.missing }) : t("exp.pptxDone"));
    }, function (e) {
      pptxBusy = false;
      try { console.error("[orOS] slides: .pptx export failed", e); } catch (x) {}
      SL.toast(t("exp.fail"));
    });
  }

  // A .pptx as a NEW presentation: its pictures are stored on the orOS
  // disk like any picture added in Slides.
  function openPptx(f) {
    if (pptxBusy) return Promise.resolve();
    pptxBusy = true;
    SL.toast(t("imp.pptxWorking"));
    return f.arrayBuffer().then(function (ab) {
      var zip = window.AtelierZip.open(new Uint8Array(ab));
      return X().read(zip, { labels: {
        chart: t("note.chart"), table: t("note.table"), diagram: t("note.diagram"), media: t("note.media"), object: t("note.object")
      } }).then(function (plan) {
        if (!plan.title) plan.title = String(f.name || "").replace(/\.pptx$/i, "");
        var assets = {}, failed = 0, nofs = false, chain = Promise.resolve();
        Object.keys(plan.media).forEach(function (p) {
          chain = chain.then(function () {
            if (nofs) { failed++; return; }
            return zip.bytes(p, X().MAX_MEDIA).then(function (b) {
              if (!b) { failed++; return; }
              var file = new File([b], p.split("/").pop(), { type: X().mediaType(p) || "application/octet-stream" });
              return A.importFile(file).then(function (r) { assets[p] = r; });
            }).then(null, function (e) { if (e && e.message === "nofs") nofs = true; failed++; });
          });
        });
        return chain.then(function () {
          var lost = 0;
          var id = SL.addDeckData(function (dt, nw, newId) {
            var r = X().build(plan, assets, nw, newId);
            if (!r.deck || !r.slides.length) return null;
            dt.decks[r.deck.id] = r.deck;
            r.slides.forEach(function (s) { dt.slides[s.id] = s; });
            r.items.forEach(function (it) { dt.items[it.id] = it; });
            lost = plan.count.skipped + plan.count.unknown + r.missing + Math.max(0, plan.count.slides - r.slides.length);
            return r.deck.id;
          });
          pptxBusy = false;
          if (!id) { SL.toast(t("imp.bad")); return; }
          SL.openDeck(id);
          if (nofs) SL.toast(t("img.nofs"));
          else SL.toast(lost ? t("imp.pptxPartial", { n: lost }) : t("imp.done"));
        });
      });
    }).then(null, function (e) {
      pptxBusy = false;
      try { console.error("[orOS] slides: .pptx import failed", e); } catch (x) {}
      SL.toast(t("imp.bad"));
    });
  }

  // ---------- Pictures ----------
  // Into an image item (placeholder or replace), or a new picture
  // centred on the slide.
  function placeImage(itemId) {
    var slideId = ED().cur;
    pickFile("image/*").then(function (f) {
      if (!f) return;
      return A.importFile(f).then(function (res) {
        var img = { a: res.id, pw: res.w, ph: res.h, fit: "fill", ox: 0, oy: 0, zm: 100, alt: "" };
        var it = itemId ? SL.data().items[itemId] : null;
        if (it && it.k === "image") {
          ED().editItems([itemId], function (x) {
            var keepAlt = x.img && x.img.alt;
            x.img = img;
            if (keepAlt) x.img.alt = keepAlt;
            // a free picture takes the shape of the new one; a placeholder keeps its box
            if (!x.ph) { var cx = x.x + x.w / 2; x.w = Math.round(x.h * res.w / res.h); x.x = Math.round(cx - x.w / 2); }
          });
          ED().select([itemId]);
        } else {
          if (ED().cur !== slideId) return;
          var W = ED().W(), k = Math.min(W * 0.6 / res.w, C.H * 0.6 / res.h);
          var w = Math.max(10, Math.round(res.w * k)), h = Math.max(10, Math.round(res.h * k));
          ED().addItem({ k: "image", x: Math.round((W - w) / 2), y: Math.round((C.H - h) / 2), w: w, h: h, img: img });
        }
        SL.toast(t("img.placed"));
      }, function (e) {
        SL.toast(e && e.message === "nofs" ? t("img.nofs") : t("img.fail"));
      });
    });
  }

  SL.on("open", preload);
  SL.on("remote", preload);

  SL.io = {
    present: present, exportPdf: exportPdf, exportPng: exportPng,
    exportPackage: exportPackage, importPackage: importPackage, openFile: openFile, placeImage: placeImage,
    exportPptx: exportPptx
  };
})();
