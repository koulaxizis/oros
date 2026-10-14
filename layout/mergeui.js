// ============================================================
// orOS Layout — mergeui.js: the Data merge dialog (v1.0.0)
// CSV file → a preview per row → one PDF (one card per page, or
// N-up on A4 / A3 / Letter with cut marks). The logic is in
// merge.js; this file reads the files, finds the pictures, draws the
// preview and writes the PDF in parts (so a long list keeps the
// window responsive).
//   - the CSV and the pictures are only read: nothing is stored in
//     the document or on the disk (pictures are decoded in memory,
//     at most PIC_SIDE pixels)
//   - pictures by file name: from a folder on the orOS disk
//     (searched three levels deep) and/or picked from the device
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, R = LY.R, P = LY.P, A = LY.A, t = LY.t, el = LY.el;
  var G = window.LY_MERGE;
  var ED = LY.ed;
  var MM = 72 / 25.4;
  var PIC_SIDE = 2400, PIC_EXT = /\.(jpe?g|png|webp|gif|bmp|svg|avif)$/i;
  var MAX_SCAN = 4000, CHUNK = 12;

  // session only (device-local UI state, R10)
  var prefs = { pages: "cur", mode: "one", sheet: "a4", gap: 4, marks: 1, folder: "/internal/Pictures" };
  var csv = null;                 // { name, head, rows, cut }
  var devicePics = {};            // fileKey → File
  var pics = {};                  // fileKey → { img, w, h } decoded, or null (failed)
  var diskIndex = null, diskFolder = "";   // fileKey → path

  function fsApi() {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; }
    catch (e) { return window.orosFS || null; }
  }

  function decode(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || 1200, h = img.naturalHeight || 1200, k = Math.min(1, PIC_SIDE / Math.max(w, h));
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        resolve({ img: cv, w: cv.width, h: cv.height, png: /png|gif|svg|webp/i.test(blob.type || "") });
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // orOS disk: file key → path, three folders deep.
  function scanDisk(folder) {
    var F = fsApi();
    if (!F || !folder) return Promise.resolve({});
    var out = {}, n = 0;
    function walk(path, depth) {
      if (depth > 3 || n > MAX_SCAN) return Promise.resolve();
      return F.ls(path).then(function (list) {
        var chain = Promise.resolve();
        (list || []).forEach(function (e) {
          if (++n > MAX_SCAN) return;
          var p = path.replace(/\/$/, "") + "/" + e.name;
          if (e.dir) chain = chain.then(function () { return walk(p, depth + 1); });
          else if (PIC_EXT.test(e.name)) { var k = G.fileKey(e.name); if (!out[k]) out[k] = p; }
        });
        return chain;
      }, function () {});
    }
    return walk(folder, 0).then(function () { return out; });
  }

  // Decode every picture the rows ask for that we can find.
  function loadPics(want) {
    var chain = Promise.resolve(), F = fsApi();
    Object.keys(want).forEach(function (k) {
      if (k in pics) return;
      var f = devicePics[k], path = diskIndex && diskIndex[k];
      if (!f && !path) return;
      chain = chain.then(function () {
        return (f ? Promise.resolve(f) : F.read(path)).then(decode, function () { return null; });
      }).then(function (d) { pics[k] = d; });
    });
    return chain;
  }
  function picMap() {
    var out = {};
    Object.keys(pics).forEach(function (k) { if (pics[k]) out[k] = { a: "mg:" + k, iw: pics[k].w, ih: pics[k].h }; });
    return out;
  }
  function getImage(a) { return a && a.indexOf("mg:") === 0 ? (pics[a.slice(3)] || {}).img || null : A.get(a); }

  function pageIds(doc) {
    var cur = ED.curPage(), order = M.pagesInOrder(doc);
    if (prefs.mode === "nup" || prefs.pages === "cur" || order.length < 2) return [cur ? cur.id : order[0].id];
    return order.map(function (p) { return p.id; });
  }
  function nupOpts() {
    return prefs.mode === "nup" ? { sheet: prefs.sheet, gap: Math.max(0, Math.min(50, +prefs.gap || 0)) * MM, margin: 10 * MM, marks: prefs.marks } : null;
  }

  // ---------- PDF ----------
  // the visible part of a picture, resampled to ppi (never up); one
  // copy per picture + crop, however many cards show it
  function cropImage(it, ppi, cache) {
    var crop = P.imageCrop(it);
    if (!crop) return Promise.resolve(null);
    var mg = it.a.indexOf("mg:") === 0;
    var src0 = mg ? Promise.resolve(getImage(it.a)) : A.load(it.a);
    return src0.then(function (img) {
      if (!img) return null;
      var k = (img.naturalWidth || img.width) / (it.iw || 1);
      var src = { x: crop.src.x * k, y: crop.src.y * k, w: crop.src.w * k, h: crop.src.h * k };
      var cw = Math.max(1, Math.round(Math.min(src.w, crop.rect.w / 72 * ppi)));
      var ch = Math.max(1, Math.round(Math.min(src.h, crop.rect.h / 72 * ppi)));
      var png = mg ? pics[it.a.slice(3)].png : /\.png$/.test(it.a);
      var key = [it.a, Math.round(src.x), Math.round(src.y), Math.round(src.w), Math.round(src.h), cw, ch].join("_");
      if (!cache[key]) {
        var cv = document.createElement("canvas");
        cv.width = cw; cv.height = ch;
        cv.getContext("2d").drawImage(img, src.x, src.y, src.w, src.h, 0, 0, cw, ch);
        cache[key] = new Promise(function (resolve, reject) {
          cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("encode")); }, png ? "image/png" : "image/jpeg", 0.9);
        }).then(function (b) { return b.arrayBuffer(); }).then(function (ab) {
          return { data: new Uint8Array(ab), fmt: png ? "PNG" : "JPEG", alias: "mg" + Object.keys(cache).length + "x" + cw + "x" + ch };
        });
      }
      return cache[key].then(function (im) { return { data: im.data, fmt: im.fmt, alias: im.alias, rect: crop.rect }; });
    });
  }

  var busy = false;
  function makePdf(doc, done) {
    if (busy) return;
    busy = true;
    var ids = pageIds(doc), nup = nupOpts(), rows = csv.rows, head = csv.head;
    var per = 1;
    if (nup) { var sh = G.bestSheet(nup.sheet, doc.setup.w, doc.setup.h, nup.gap, nup.margin); per = sh.g.cols * sh.g.rows; }
    var step = nup ? per * 4 : CHUNK, total = nup ? Math.ceil(rows.length / per) : rows.length * ids.length;
    var pdf = null, made = 0, cache = {}, missing = {}, over = 0, J;
    LY.toast(t("mg.working", { i: 1, n: total }));
    function part(i) {
      if (i >= rows.length) return Promise.resolve();
      var res = G.build(doc, ids, head, rows.slice(i, i + step), { now: LY.now(), images: picMap(), nup: nup });
      Object.keys(res.missing).forEach(function (k) { missing[k] = 1; });
      var L = R.computeLayout(res.doc), images = {}, chain = Promise.resolve();
      over += Object.keys(L.overset).length;
      res.doc.items.forEach(function (it) {
        if (it.t !== "img" || !it.a || it.hide) return;
        chain = chain.then(function () { return cropImage(it, 300, cache); }).then(function (im) { if (im) images[it.id] = im; });
      });
      return chain.then(function () {
        pdf = P.build(res.doc, { bleed: !nup && !!prefs.marks, marks: !nup && !!prefs.marks, title: doc.name },
          { jsPDF: J, layout: L, images: images, clip: nup ? res.clip : null, pdf: pdf });
        made += res.doc.pages.length;
        LY.toast(t("mg.working", { i: Math.min(made + 1, total), n: total }));
        // let the window breathe between parts
        return new Promise(function (r) { setTimeout(r, 0); });
      }).then(function () { return part(i + step); });
    }
    LY.io.loadJsPDF().then(function (JsPDF) {
      J = JsPDF;
      return part(0);
    }).then(function () {
      return LY.io.saveBlob(pdf.output("blob"), LY.io.fileName(doc, "-merge.pdf"), "application/pdf", "PDF", ".pdf");
    }).then(function (ok) {
      busy = false;
      var lost = Object.keys(missing).length;
      if (ok) LY.toast(t("mg.done", { n: made }) + (lost ? " " + t("mg.lost", { n: lost }) : "") + (over ? " " + t("mg.overN", { n: over }) : ""));
      if (done) done(ok);
    }, function (e) {
      busy = false;
      try { console.error("[orOS] layout: data merge failed", e); } catch (x) {}
      LY.toast(t("exp.fail"));
    });
  }

  // ---------- Dialog ----------
  function open() {
    var doc = LY.doc;
    if (!doc) return;
    LY.flushStory && LY.flushStory();
    var U = LY.ui, rec = 0, previewTimer = 0, scanP = null;
    LY.openDialog(t("mg.title"), function (body, close) {
      body.classList.add("mg-body");
      body.appendChild(el("p", "hint", t("mg.hint")));
      var fileRow = el("div", "pn-row"), fileInfo = el("p", "hint");
      var fieldsBox = el("div", "mg-fields");
      var optsBox = el("div", "mg-opts");
      var picsBox = el("div", "mg-pics");
      var prevHead = el("div", "mg-nav"), prevBox = el("div", "mg-prev");
      body.appendChild(fileRow); body.appendChild(fileInfo);
      body.appendChild(el("h3", "pn-h", t("mg.fields"))); body.appendChild(fieldsBox);
      body.appendChild(optsBox);
      body.appendChild(picsBox);
      body.appendChild(el("h3", "pn-h", t("mg.preview"))); body.appendChild(prevHead); body.appendChild(prevBox);
      var act = el("div", "dlg-actions");
      act.appendChild(U.btn(t("btn.close"), close));
      var go = U.btn(t("mg.go"), function () {
        if (!csv) { LY.toast(t("mg.need")); return; }
        ensurePics().then(function () { close(); makePdf(doc); });
      }, "primary");
      act.appendChild(go);
      body.appendChild(act);

      function drawFile() {
        fileRow.innerHTML = "";
        fileRow.appendChild(U.btn(csv ? t("mg.other") : t("mg.file"), pickCsv, csv ? "" : "primary"));
        fileInfo.textContent = csv ? t("mg.rows", { name: csv.name, n: csv.rows.length }) + (csv.cut ? " " + t("mg.cut", { n: csv.rows.length }) : "") : "";
        go.disabled = !csv;
      }
      function pickCsv() {
        LY.io.pickFile(".csv,.tsv,.txt,text/csv,text/plain").then(function (f) {
          if (!f) return;
          if (f.size > G.MAX_BYTES) { LY.toast(t("mg.big")); return; }
          return f.text().then(function (txt) {
            var r = G.parseCSV(txt);
            if (!r.rows.length) { LY.toast(t("mg.bad")); return; }
            csv = { name: String(f.name || "CSV").slice(0, 80), head: r.head, rows: r.rows, cut: r.cut };
            rec = 0;
            redraw();
          });
        }).then(null, function () { LY.toast(t("mg.bad")); });
      }
      function drawFields() {
        fieldsBox.innerHTML = "";
        var f = G.fieldsOf(doc, pageIds(doc));
        if (!f.text.length && !f.img.length) { fieldsBox.appendChild(el("p", "hint warn", t("mg.noFields"))); return; }
        var ul = el("ul", "mg-list");
        f.text.map(function (n) { return [n, false]; }).concat(f.img.map(function (n) { return [n, true]; })).forEach(function (x) {
          var li = el("li", "mg-field");
          li.appendChild(el("code", "", "{{" + x[0] + "}}"));
          if (x[1]) li.appendChild(el("span", "mg-tag", t("mg.img")));
          if (csv) {
            var ok = G.colOf(csv.head, x[0]) >= 0;
            li.appendChild(el("span", ok ? "mg-ok" : "mg-miss", ok ? t("mg.ok") : t("mg.missing")));
          }
          ul.appendChild(li);
        });
        fieldsBox.appendChild(ul);
      }
      function drawOpts() {
        optsBox.innerHTML = "";
        var order = M.pagesInOrder(doc);
        if (order.length > 1 && prefs.mode !== "nup") {
          optsBox.appendChild(U.field(t("mg.pages"), U.seg([["cur", t("mg.pg.cur")], ["all", t("mg.pg.all")]], prefs.pages, function (v) { prefs.pages = v; redraw(); })));
        }
        optsBox.appendChild(U.field(t("mg.mode"), U.seg([["one", t("mg.one")], ["nup", t("mg.nup")]], prefs.mode, function (v) { prefs.mode = v; redraw(); })));
        if (prefs.mode === "nup") {
          var g = el("div", "grid2");
          g.appendChild(U.field(t("mg.sheet"), U.select([["a4", "A4"], ["a3", "A3"], ["letter", t("mg.letter")]], prefs.sheet, function (v) { prefs.sheet = v; drawOpts(); })));
          var gap = el("input", "inp num");
          gap.type = "text"; gap.inputMode = "decimal"; gap.value = String(prefs.gap);
          gap.addEventListener("change", function () {
            var v = parseFloat(String(gap.value).replace(",", "."));
            prefs.gap = isFinite(v) ? Math.max(0, Math.min(50, v)) : prefs.gap;
            drawOpts();
          });
          g.appendChild(U.field(t("mg.gap"), gap));
          optsBox.appendChild(g);
          var n = nupOpts(), sh = G.bestSheet(n.sheet, doc.setup.w, doc.setup.h, n.gap, n.margin), per = sh.g.cols * sh.g.rows;
          optsBox.appendChild(el("p", "hint" + (per ? "" : " warn"), !per ? t("mg.none") : csv && csv.rows.length <= per ? t("mg.per1", { n: per }) : t("mg.per", { n: per, s: csv ? Math.ceil(csv.rows.length / per) : "–" })));
          if (order.length > 1) optsBox.appendChild(el("p", "hint", t("mg.nupPage")));
          go.disabled = !csv || !per;
        }
        optsBox.appendChild(U.check(t("exp.marks"), prefs.marks, function (v) { prefs.marks = v; }));
      }
      function drawPics() {
        picsBox.innerHTML = "";
        if (!G.fieldsOf(doc, pageIds(doc)).img.length) return;
        picsBox.appendChild(el("h3", "pn-h", t("mg.pics")));
        var inp = el("input", "inp");
        inp.type = "text"; inp.value = prefs.folder; inp.spellcheck = false; inp.autocomplete = "off";
        inp.addEventListener("change", function () { prefs.folder = inp.value.trim(); diskIndex = null; ensurePics().then(drawPicCount); });
        picsBox.appendChild(U.field(t("mg.folder"), inp));
        picsBox.appendChild(U.btn(t("mg.device"), function () {
          var dlg = LY.dialogHost();
          var p = dlg && typeof dlg.openFiles === "function" ? dlg.openFiles("image/*") : LY.io.pickFile("image/*").then(function (f) { return f ? [f] : null; });
          p.then(function (files) {
            (files || []).forEach(function (f) { var k = G.fileKey(f.name); if (k) { devicePics[k] = f; delete pics[k]; } });
            ensurePics().then(drawPicCount);
          });
        }, "block"));
        picsBox.appendChild(el("p", "hint mg-count"));
        drawPicCount();
      }
      function wanted() { return csv ? G.imageNames(doc, pageIds(doc), csv.head, csv.rows) : {}; }
      function drawPicCount() {
        var c = picsBox.querySelector(".mg-count");
        if (!c) return;
        var want = Object.keys(wanted());
        if (!want.length) { c.textContent = ""; return; }
        if (scanP) { c.textContent = t("mg.looking"); return; }
        var f = want.filter(function (k) { return pics[k]; }).length;
        c.textContent = t("mg.found", { f: f, n: want.length });
        c.classList.toggle("warn", f < want.length);
      }
      // index the folder (once per folder), then decode what is asked for
      function ensurePics() {
        var want = wanted();
        if (!Object.keys(want).length) return Promise.resolve();
        if (scanP) return scanP;
        var need = diskIndex === null || diskFolder !== prefs.folder;
        scanP = (need ? scanDisk(prefs.folder).then(function (idx) { diskIndex = idx; diskFolder = prefs.folder; }) : Promise.resolve())
          .then(function () { return loadPics(want); })
          .then(function () { scanP = null; }, function () { scanP = null; });
        drawPicCount();
        return scanP.then(function () { drawPicCount(); schedulePreview(); });
      }
      function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(drawPreview, 30); }
      function drawPreview() {
        prevHead.innerHTML = ""; prevBox.innerHTML = "";
        if (!csv) { prevBox.appendChild(el("p", "hint", t("mg.need"))); return; }
        var n = csv.rows.length;
        rec = Math.max(0, Math.min(n - 1, rec));
        var prev = U.btn("‹", function () { rec--; drawPreview(); }, "small"), next = U.btn("›", function () { rec++; drawPreview(); }, "small");
        prev.disabled = rec <= 0; next.disabled = rec >= n - 1;
        prev.setAttribute("aria-label", t("mg.prev")); next.setAttribute("aria-label", t("mg.next"));
        prevHead.appendChild(prev);
        prevHead.appendChild(el("span", "mg-rec", t("mg.rec", { i: rec + 1, n: n })));
        prevHead.appendChild(next);
        var ids = pageIds(doc);
        var res = G.build(doc, ids, csv.head, [csv.rows[rec]], { now: LY.now(), images: picMap() });
        var L = R.computeLayout(res.doc), box = Math.min(560, Math.max(200, body.clientWidth - 40));
        M.pagesInOrder(res.doc).forEach(function (pg) {
          var s = res.doc.setup, scale = Math.min(box / s.w, 320 / s.h) * Math.min(2, window.devicePixelRatio || 1);
          var cv = R.renderPage(res.doc, pg, L, scale, { getImage: getImage, background: "#fff" });
          cv.className = "mg-page";
          cv.style.width = Math.round(cv.width / Math.min(2, window.devicePixelRatio || 1)) + "px";
          prevBox.appendChild(cv);
        });
        if (Object.keys(L.overset).length) prevBox.appendChild(el("p", "hint warn mg-over", t("mg.over")));
      }
      function redraw() {
        drawFile(); drawFields(); drawOpts(); drawPics(); drawPreview();
        if (csv) ensurePics();
      }
      redraw();
    }, true);
  }

  LY.merge = { open: open };
})();
