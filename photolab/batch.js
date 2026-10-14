// ============================================================
// orOS Photo Lab — batch.js: batch processing (v1.0.0)
// File › Batch process… (and the Batch button on the projects
// screen): many photos at once, from the device or the orOS disk,
// camera RAW files too.
//   1. adjustments: none, the adjustment layers of the open picture
//      (visible ones, with their opacity; masks are left out) or a
//      Lightroom preset (.xmp, through xmp.js)
//   2. resize: long side, width, height or percent (never larger
//      unless asked)
//   3. watermark: a text or a picture, at one of nine places, with
//      its opacity
//   4. JPG / PNG / WebP with a quality, a file-name pattern
//   5. saved into a folder of Pictures on the orOS disk, or one ZIP
//      (atelier/zip.js writer, stored: pictures are compressed)
// One photo at a time: decoding and drawing by the browser, the
// adjustments in the worker (jobs.js "stack"), a pause between
// photos, so the app stays responsive; Stop ends it after the photo
// it is on. The pure part (sizes, names, watermark places, the
// adjustment stack) is batchcore.js.
// Settings stay on this device (prefs.batch); the photo list and the
// watermark picture are not kept.
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, B = PL.B, C = PL.C, st = PL.st, el = PL.el;
  var MAX_ITEMS = 2000;
  var ZIP_MAX = 1024 * 1024 * 1024;
  var FILE_MAX = 300 * 1024 * 1024;
  var PIC_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
  var ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,";
  function t(k, p) { return PL.t(k, p); }
  function canvas(w, h) { return PL.view.canvas(w, h); }
  function usable(name) { return PIC_RE.test(name) || PL.RAW.isRaw(name); }

  var items = [];                 // { name, file } | { name, path }
  var xmp = null;                 // { name, stack }
  var wmPic = null;               // { name, src: canvas, w, h }

  var FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  function prefs() { return (PL.prefs.batch = B.norm(PL.prefs.batch)); }

  // ---------- Picking ----------
  function addFiles(list) {
    var skipped = 0, before = items.length;
    (list || []).forEach(function (f) {
      if (!f || !usable(f.name || "")) { skipped++; return; }
      if (items.length >= MAX_ITEMS) { skipped++; return; }
      items.push({ name: f.name, file: f });
    });
    if (items.length >= MAX_ITEMS && items.length - before < (list || []).length) PL.toast(t("batch.max", { n: MAX_ITEMS }));
    else if (skipped) PL.toast(t("batch.skipped", { n: skipped }));
  }
  // A small browser of the orOS disk: folders, and pictures with a
  // tick each; ticks are kept while moving between folders.
  function diskPicker(done) {
    var fs = PL.fs();
    if (!fs) { PL.toast(t("msg.noDisk")); return; }
    var ROOT = "/internal", cwd = PL.io.PICTURES, gen = 0, picked = {}, order = [];
    var bar = el("div", "dk-bar");
    var up = el("button", "icon-btn small"); up.type = "button"; up.innerHTML = PL.ICON.up; PL.setLabel(up, t("batch.up"));
    var where = el("span", "dk-path");
    var all = el("button", "btn small ghost", t("batch.allHere")); all.type = "button";
    bar.appendChild(up); bar.appendChild(where); bar.appendChild(all);
    var list = el("ul", "dk-list");
    var count = el("p", "hint");
    var dlg = PL.dialog({
      title: t("batch.fromDisk"), ok: t("batch.addPicked"), body: [bar, list, count], wide: true,
      onOk: function () {
        var out = order.filter(function (p) { return picked[p]; });
        if (!out.length) { PL.toast(t("batch.noneTicked")); return false; }
        done(out);
      }
    });
    var here = [];
    function upd() { var n = order.filter(function (p) { return picked[p]; }).length; count.textContent = t("batch.ticked", { n: n }); }
    function tick(p, on) { if (on && !(p in picked)) order.push(p); picked[p] = on; }
    up.addEventListener("click", function () { if (cwd !== ROOT) go(cwd.replace(/\/[^\/]+$/, "") || ROOT); });
    all.addEventListener("click", function () {
      var on = here.some(function (p) { return !picked[p]; });
      here.forEach(function (p) { tick(p, on); });
      [].forEach.call(list.querySelectorAll("input[type=checkbox]"), function (c) { c.checked = on; });
      upd();
    });
    function go(path) {
      cwd = path;
      var my = ++gen;
      up.disabled = path === ROOT;
      where.textContent = path === ROOT ? "/" : path.slice(ROOT.length);
      list.textContent = "";
      here = [];
      list.appendChild(el("li", "hint", t("batch.loading")));
      Promise.resolve(typeof fs.ready === "function" ? fs.ready() : null).then(function () { return fs.ls(path); }).then(function (entries) {
        if (my !== gen) return;
        list.textContent = "";
        var rows = (entries || []).filter(function (en) { return en && typeof en.name === "string" && (en.dir || usable(en.name)); });
        rows.sort(function (a, b) { return (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || a.name.localeCompare(b.name); });
        if (!rows.length) list.appendChild(el("li", "hint", t("batch.emptyFolder")));
        rows.forEach(function (en) {
          var li = el("li"), p = path + "/" + en.name;
          if (en.dir) {
            var b = el("button", "dk-item dir"); b.type = "button";
            var ic = el("span", "dk-ic"); ic.innerHTML = FOLDER; b.appendChild(ic);
            b.appendChild(el("span", "dk-name", en.name));
            b.addEventListener("click", function () { go(p); });
            li.appendChild(b);
          } else {
            here.push(p);
            var c = PL.ui.check(en.name, !!picked[p]);
            c.classList.add("dk-item");
            c.input.addEventListener("change", function () { tick(p, c.input.checked); upd(); });
            li.appendChild(c);
          }
          list.appendChild(li);
        });
        all.hidden = !here.length;
      }, function () {
        if (my !== gen) return;
        if (path !== ROOT && path === PL.io.PICTURES) { go(ROOT); return; }
        list.textContent = "";
        list.appendChild(el("li", "hint", t("batch.emptyFolder")));
      });
    }
    upd();
    go(cwd);
    return dlg;
  }

  // ---------- The settings dialog ----------
  function sec(title) { var s = el("section", "bt-sec"); s.appendChild(el("h3", "bt-h", title)); return s; }
  function row(kids) { var r = el("div", "bt-row"); kids.forEach(function (k) { r.appendChild(k); }); return r; }
  function button(label, fn, cls) { var b = el("button", "btn small " + (cls || "")); b.type = "button"; b.textContent = label; b.addEventListener("click", fn); return b; }

  function open() {
    var P = prefs(), dlgHost = PL.io.dialogHost();
    var docStack = st.doc ? B.stackOf(st.doc.layers) : [];
    if (P.adj === "doc" && !docStack.length) P.adj = "none";

    // 1. Photos
    var s1 = sec(t("batch.photos"));
    var listEl = el("ul", "bt-list"), countEl = el("p", "hint");
    function renderList() {
      listEl.textContent = "";
      items.forEach(function (it, i) {
        var li = el("li");
        li.appendChild(el("span", "bt-name", it.name));
        var x = el("button", "icon-btn small"); x.type = "button"; x.innerHTML = PL.ICON.close;
        PL.setLabel(x, t("batch.remove", { name: it.name }));
        x.addEventListener("click", function () { items.splice(i, 1); renderList(); });
        li.appendChild(x);
        listEl.appendChild(li);
      });
      listEl.hidden = !items.length;
      countEl.textContent = items.length ? t("batch.count", { n: items.length }) : t("batch.none");
      example();
    }
    s1.appendChild(row([
      button(t("batch.fromDevice"), function () {
        if (!dlgHost || typeof dlgHost.openFiles !== "function") { PL.toast(t("msg.noDialogs")); return; }
        dlgHost.openFiles(ACCEPT + PL.io.RAW_ACCEPT).then(function (fl) { if (fl) { addFiles([].slice.call(fl)); renderList(); } });
      }),
      button(t("batch.fromDiskBtn"), function () {
        diskPicker(function (paths) {
          var before = items.length;
          paths.forEach(function (p) { if (items.length < MAX_ITEMS) items.push({ name: p.split("/").pop(), path: p }); });
          if (items.length - before < paths.length) PL.toast(t("batch.max", { n: MAX_ITEMS }));
          renderList();
        });
      }),
      button(t("batch.clear"), function () { items = []; renderList(); }, "ghost")
    ]));
    s1.appendChild(countEl); s1.appendChild(listEl);

    // 2. Adjustments
    var s2 = sec(t("batch.adjust"));
    var adjOpts = [["none", t("batch.adjNone")]];
    if (docStack.length) adjOpts.push(["doc", t("batch.adjDoc", { n: docStack.length })]);
    adjOpts.push(["xmp", t("batch.adjXmp")]);
    var adj = PL.ui.select(adjOpts, P.adj);
    var xmpBtn = button(t("batch.pickXmp"), pickXmp);
    var adjHint = el("p", "hint");
    function updAdj() {
      xmpBtn.hidden = adj.value !== "xmp";
      if (adj.value === "doc") adjHint.textContent = t("batch.adjDocHint") + (docStack.masked ? " " + t("batch.adjMasked") : "");
      else if (adj.value === "xmp") adjHint.textContent = xmp ? t("batch.xmpLoaded", { name: xmp.name, n: xmp.stack.length }) : t("batch.xmpNone");
      else adjHint.textContent = "";
      adjHint.hidden = !adjHint.textContent;
    }
    function pickXmp() {
      if (!dlgHost || typeof dlgHost.openFile !== "function") { PL.toast(t("msg.noDialogs")); return; }
      dlgHost.openFile(".xmp,application/rdf+xml").then(function (f) {
        if (!f) return;
        if (f.size > 2 * 1024 * 1024) { PL.toast(t("msg.xmpBad")); return; }
        return f.text().then(function (text) {
          var r;
          try { r = PL.XMP.parse(text); } catch (e) { PL.toast(t("msg.xmpBad")); return; }
          var name = r.name || f.name.replace(/\.xmp$/i, "");
          if (!r.layers.length) { PL.toast(t("msg.xmpEmpty", { name: name })); return; }
          xmp = { name: name, stack: B.stackFromXmp(r.layers) };
          updAdj();
        });
      }).catch(function () { PL.toast(t("msg.xmpBad")); });
    }
    adj.addEventListener("change", updAdj);
    s2.appendChild(row([PL.ui.field(t("batch.adjFrom"), adj), xmpBtn]));
    s2.appendChild(adjHint);

    // 3. Size
    var s3 = sec(t("batch.size"));
    var mode = PL.ui.select([["none", t("batch.rsNone")], ["long", t("batch.rsLong")], ["w", t("batch.rsW")], ["h", t("batch.rsH")], ["pct", t("batch.rsPct")]], P.rs.mode);
    var val = PL.ui.numIn(P.rs.v, 1, 8192);
    var valF = PL.ui.field(t("batch.rsPx"), val);
    var up = PL.ui.check(t("batch.rsUp"), P.rs.up);
    function updSize() {
      valF.hidden = mode.value === "none"; up.hidden = mode.value === "none";
      valF.querySelector(".fld-l").textContent = t(mode.value === "pct" ? "batch.rsPctV" : "batch.rsPx");
      val.max = mode.value === "pct" ? "400" : "8192";
    }
    mode.addEventListener("change", function () {
      val.value = mode.value === "pct" ? "50" : mode.value === "none" ? val.value : (+val.value > 400 ? val.value : "2048");
      updSize(); example();
    });
    val.addEventListener("input", example);
    s3.appendChild(row([PL.ui.field(t("batch.rsMode"), mode), valF]));
    s3.appendChild(up);

    // 4. Watermark
    var s4 = sec(t("batch.wm"));
    var kind = PL.ui.select([["none", t("batch.wmNone")], ["text", t("batch.wmText")], ["image", t("batch.wmImage")]], P.wm.kind);
    var text = PL.ui.textIn(P.wm.text, 200);
    var textF = PL.ui.field(t("batch.wmTextL"), text);
    var color = el("input"); color.type = "color"; color.value = P.wm.c;
    var colorF = PL.ui.field(t("batch.wmColor"), color);
    var picBtn = button(t("batch.wmPick"), pickWm);
    var picName = el("p", "hint");
    var size = PL.ui.range(t("batch.wmSize"), P.wm.size, 1, 100);
    var op = PL.ui.range(t("batch.wmOp"), P.wm.op, 5, 100);
    var pos = P.wm.pos, grid = el("div", "anchor-grid");
    B.POS.forEach(function (a) {
      var b = el("button", "anchor" + (a === pos ? " on" : ""));
      b.type = "button"; PL.setLabel(b, t("anchor." + a));
      b.setAttribute("aria-pressed", a === pos ? "true" : "false");
      b.addEventListener("click", function () {
        pos = a;
        [].forEach.call(grid.children, function (c) { c.classList.toggle("on", c === b); c.setAttribute("aria-pressed", c === b ? "true" : "false"); });
      });
      grid.appendChild(b);
    });
    var posF = PL.ui.field(t("batch.wmPos"), grid);
    function updWm() {
      var k = kind.value;
      textF.hidden = colorF.hidden = k !== "text";
      picBtn.hidden = picName.hidden = k !== "image";
      size.hidden = op.hidden = posF.hidden = k === "none";
      size.querySelector(".rng-top span").textContent = t(k === "image" ? "batch.wmSizeImg" : "batch.wmSize");
      picName.textContent = wmPic ? wmPic.name : t("batch.wmNoPic");
    }
    function pickWm() {
      if (!dlgHost || typeof dlgHost.openFile !== "function") { PL.toast(t("msg.noDialogs")); return; }
      dlgHost.openFile("image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg").then(function (f) {
        if (!f) return;
        return PL.io.decode(f).then(function (img) {
          var c = canvas(img.w, img.h);
          c.getContext("2d").putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
          wmPic = { name: f.name, src: c, w: img.w, h: img.h };
          updWm();
        }, function () { PL.toast(t("msg.notPicture")); });
      });
    }
    kind.addEventListener("change", updWm);
    s4.appendChild(PL.ui.field(t("batch.wmKind"), kind));
    s4.appendChild(row([textF, colorF]));
    s4.appendChild(row([picBtn, picName]));
    s4.appendChild(size); s4.appendChild(op); s4.appendChild(posF);

    // 5. Saving
    var s5 = sec(t("batch.out"));
    var fmt = PL.ui.select([["jpg", "JPG"], ["png", "PNG"], ["webp", "WebP"]], P.fmt);
    var q = PL.ui.range(t("f.quality"), P.q, 10, 100);
    var pattern = PL.ui.textIn(P.pattern, 120);
    var ex = el("p", "hint bt-ex");
    var dest = PL.ui.select([["disk", t("batch.toDisk")], ["zip", t("batch.toZip")]], P.dest);
    var folder = PL.ui.textIn(P.folder, 60);
    var folderF = PL.ui.field(t("batch.folder"), folder);
    function example() {
      var it = items[0] || { name: "IMG_0001.jpg" };
      var ext = fmt.value === "jpg" ? "jpg" : fmt.value;
      ex.textContent = t("batch.example", { name: B.fileName(pattern.value, { name: it.name, n: 1, date: new Date(), w: 0, h: 0 }).replace(/\b0\b/g, "…") + "." + ext });
    }
    function updOut() {
      q.hidden = fmt.value === "png";
      folderF.hidden = dest.value !== "disk";
      example();
    }
    fmt.addEventListener("change", updOut); dest.addEventListener("change", updOut); pattern.addEventListener("input", example);
    s5.appendChild(row([PL.ui.field(t("f.format"), fmt), PL.ui.field(t("batch.dest"), dest)]));
    s5.appendChild(q);
    s5.appendChild(PL.ui.field(t("batch.pattern"), pattern));
    s5.appendChild(el("p", "hint", t("batch.tokens")));
    s5.appendChild(ex);
    s5.appendChild(folderF);

    var dlg = PL.dialog({
      title: t("dlg.batch"), ok: t("batch.start"), wide: true,
      body: [el("p", "hint", t("batch.intro")), s1, s2, s3, s4, s5],
      onOk: function () {
        var cfg = B.norm({
          adj: adj.value, rs: { mode: mode.value, v: +val.value, up: up.input.checked },
          wm: { kind: kind.value, text: text.value, size: +size.input.value, c: color.value, pos: pos, op: +op.input.value },
          fmt: fmt.value, q: +q.input.value, pattern: pattern.value, dest: dest.value, folder: folder.value
        });
        PL.prefs.batch = cfg; PL.savePrefs();
        if (!items.length) { PL.toast(t("batch.none")); return false; }
        if (cfg.adj === "xmp" && !xmp) { PL.toast(t("batch.xmpNone")); return false; }
        if (cfg.wm.kind === "image" && !wmPic) { PL.toast(t("batch.wmNoPic")); return false; }
        if (cfg.wm.kind === "text" && !cfg.wm.text.trim()) cfg.wm.kind = "none";
        if (cfg.dest === "disk" && !PL.fs()) { PL.toast(t("msg.noDisk")); return false; }
        var stack = cfg.adj === "doc" ? docStack : cfg.adj === "xmp" ? xmp.stack : [];
        run(cfg, items.slice(), stack);
      }
    });
    renderList(); updAdj(); updSize(); updWm(); updOut();
    return dlg;
  }

  // ---------- Running ----------
  function pause() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function blobOf(it) {
    if (it.file) return Promise.resolve(it.file);
    var fs = PL.fs();
    if (!fs) return Promise.reject(new Error("nodisk"));
    return fs.read(it.path);
  }
  // Downscaling in halves first keeps the result sharp and clean.
  function drawScaled(src, sw, sh, tw, th) {
    var cur = src, cw = sw, ch = sh, tmp = [];
    while (cw / 2 >= tw * 1.0001 && ch / 2 >= th * 1.0001) {
      var nw = Math.max(tw, Math.round(cw / 2)), nh = Math.max(th, Math.round(ch / 2));
      var c = canvas(nw, nh), g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(cur, 0, 0, nw, nh);
      tmp.push(c); cur = c; cw = nw; ch = nh;
    }
    var out = canvas(tw, th), og = out.getContext("2d");
    og.imageSmoothingQuality = "high";
    og.drawImage(cur, 0, 0, tw, th);
    tmp.forEach(function (c) { c.width = c.height = 0; });
    return out;
  }
  // A photo → a canvas at its output size.
  function picture(blob, name, rs, signal) {
    if (blob.size > FILE_MAX) return Promise.reject(new Error("big"));
    if (PL.RAW.isRaw(name)) {
      var half = PL.phone || B.rawHalf(rs, 0, 0);
      return PL.RAW.decode(blob, { half: half, signal: signal }).then(function (r) {
        // what the camera made, when LibRaw developed at half size
        var full = half && r.via === "libraw" ? { w: r.w * 2, h: r.h * 2 } : { w: r.w, h: r.h };
        var tg = fitDevice(B.targetSize(full.w, full.h, rs));
        tg = { w: Math.min(tg.w, r.w), h: Math.min(tg.h, r.h) };
        var src = r.canvas;
        if (!src) { src = canvas(r.w, r.h); src.getContext("2d").putImageData(new ImageData(r.img.data, r.w, r.h), 0, 0); }
        var out = drawScaled(src, r.w, r.h, tg.w, tg.h);
        src.width = src.height = 0;
        return out;
      });
    }
    return PL.io.source(blob).then(function (s) {
      var tg = fitDevice(B.targetSize(s.w, s.h, rs));
      var out = drawScaled(s.src, s.w, s.h, tg.w, tg.h);
      s.done();
      return out;
    });
  }
  function fitDevice(sz) { var f = C.fitSize(sz.w, sz.h, PL.limits); return { w: f.w, h: f.h }; }
  function watermark(cv, wm) {
    if (wm.kind === "none") return;
    var W = cv.width, H = cv.height, g = cv.getContext("2d"), m = B.wmMargin(W, H);
    g.save();
    g.globalAlpha = wm.op / 100;
    if (wm.kind === "text") {
      var fs = B.wmFont(W, H, wm.size), line = wm.text.replace(/\s+/g, " ").trim();
      g.font = "600 " + fs + "px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
      g.textBaseline = "top";
      var tw = Math.ceil(g.measureText(line).width), th = Math.ceil(fs * 1.2);
      if (tw > W - 2 * m) {                                 // too long: smaller, so it fits
        fs = Math.max(6, Math.floor(fs * (W - 2 * m) / tw));
        g.font = "600 " + fs + "px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
        tw = Math.ceil(g.measureText(line).width); th = Math.ceil(fs * 1.2);
      }
      var p = B.wmPos(W, H, tw, th, wm.pos, m);
      g.shadowColor = "rgba(0, 0, 0, 0.45)"; g.shadowBlur = Math.max(1, fs / 8); g.shadowOffsetY = Math.max(1, fs / 24);
      g.fillStyle = wm.c;
      g.fillText(line, p.x, p.y + Math.round(fs * 0.1));
    } else if (wmPic) {
      var sz = B.wmImageSize(W, H, wmPic.w, wmPic.h, wm.size), q = B.wmPos(W, H, sz.w, sz.h, wm.pos, m);
      g.imageSmoothingQuality = "high";
      g.drawImage(wmPic.src, q.x, q.y, sz.w, sz.h);
    }
    g.restore();
  }
  function encode(cv, fmt, q) {
    var c = cv;
    if (fmt === "jpg") {                                     // JPEG has no transparency: white below
      c = canvas(cv.width, cv.height);
      var g = c.getContext("2d");
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(cv, 0, 0);
    }
    return new Promise(function (ok, fail) {
      c.toBlob(function (b) {
        if (c !== cv) c.width = c.height = 0;
        if (!b) { fail(new Error("encode")); return; }
        // A browser without a WebP encoder gives PNG.
        ok({ blob: b, ext: fmt === "webp" && b.type !== "image/webp" ? "png" : fmt });
      }, B.FORMATS[fmt], q / 100);
    });
  }
  function why(e) {
    var m = String(e && e.message || e || "");
    if (m === "big") return t("batch.errBig");
    if (m === "nodisk" || /NotFound|ENOENT/i.test(m)) return t("batch.errGone");
    if (m === "encode") return t("batch.errEncode");
    if (m === "zipfull") return t("batch.errZip");
    if (/quota|space|full/i.test(m)) return t("msg.diskFull");
    return t("batch.errRead");
  }

  function run(cfg, list, stack) {
    var fs = PL.fs(), stop = false, ok = 0, fails = [], zip = [], zipBytes = 0, taken = {};
    var folder = PL.io.PICTURES + "/" + cfg.folder, now = new Date();
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var bar = el("progress", "bt-bar"); bar.max = list.length; bar.value = 0;
    var line = el("p", "hint bt-line"), name = el("p", "bt-cur");
    line.setAttribute("aria-live", "polite");
    var prog = PL.dialog({
      title: t("batch.running"), ok: null, body: [bar, line, name],
      onOk: function () { halt(); return false; },
      onCancel: halt
    });
    prog.ok.textContent = t("batch.stop");
    function halt() { stop = true; if (ctl) ctl.abort(); line.textContent = t("batch.stopping"); }
    function show(i) {
      bar.value = i;
      line.textContent = t("batch.progress", { i: Math.min(i + 1, list.length), n: list.length });
      name.textContent = list[i] ? list[i].name : "";
    }
    var start = cfg.dest === "disk"
      ? fs.ls(folder).then(function (en) { (en || []).forEach(function (e) { taken[String(e.name).toLowerCase()] = 1; }); }, function () {})
      : Promise.resolve();
    function one(i) {
      if (stop || i >= list.length) return Promise.resolve();
      var it = list[i];
      show(i);
      return pause().then(function () { return blobOf(it); }).then(function (blob) {
        if (stop) throw new Error("stop");
        return picture(blob, it.name, cfg.rs, ctl && ctl.signal);
      }).then(function (cv) {
        if (stop) { cv.width = cv.height = 0; throw new Error("stop"); }
        var next = Promise.resolve(cv);
        if (stack.length) {
          next = next.then(function () {
            var g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height);
            return PL.job("stack", { img: { w: d.width, h: d.height, data: d.data }, stack: stack }).then(function (img) {
              g.putImageData(new ImageData(img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
              return cv;
            });
          });
        }
        return next.then(function () {
          watermark(cv, cfg.wm);
          var W = cv.width, H = cv.height;
          return encode(cv, cfg.fmt, cfg.q).then(function (r) {
            cv.width = cv.height = 0;
            var file = B.uniqueName(B.fileName(cfg.pattern, { name: it.name, n: i + 1, date: now, w: W, h: H }), r.ext, taken);
            if (cfg.dest === "disk") return fs.write(folder + "/" + file, r.blob);
            if (zipBytes + r.blob.size > ZIP_MAX) throw new Error("zipfull");
            return r.blob.arrayBuffer().then(function (ab) { zipBytes += ab.byteLength; zip.push({ name: file, data: new Uint8Array(ab) }); });
          });
        });
      }).then(function () { ok++; }, function (e) {
        if (stop || (e && e.message === "stop")) return;
        fails.push({ name: it.name, why: why(e) });
        if (e && e.message === "zipfull") stop = true;
      }).then(function () { return one(i + 1); });
    }
    start.then(function () { return one(0); }).then(function () {
      prog.close("ok");
      finish(cfg, list.length, ok, fails, zip, folder, stop);
    });
  }

  function finish(cfg, total, ok, fails, zip, folder, stopped) {
    var body = [el("p", "", t(stopped ? "batch.stopped" : "batch.done", { ok: ok, n: total }))];
    if (ok && cfg.dest === "disk") body.push(el("p", "hint", t("batch.savedIn", { path: t("batch.pictures") + " › " + cfg.folder })));
    if (fails.length) {
      body.push(el("p", "hint", t("batch.failed", { n: fails.length })));
      var ul = el("ul", "bt-list bt-fails");
      fails.forEach(function (f) { ul.appendChild(el("li", "", f.name + " — " + f.why)); });
      body.push(ul);
    }
    var extra = [];
    if (cfg.dest === "zip" && zip.length) {
      var save = el("button", "btn primary", t("batch.saveZip")); save.type = "button";
      save.addEventListener("click", function () {
        var host = PL.io.dialogHost();
        if (!host || typeof host.saveFile !== "function") { PL.toast(t("msg.noDialogs")); return; }
        var bytes;
        try { bytes = window.AtelierZip.write(zip, new Date()); } catch (e) { PL.toast(t("batch.errZip")); return; }
        host.saveFile({ blob: new Blob([bytes], { type: "application/zip" }), filename: "Photo Lab " + B.ymd(new Date()) + ".zip", mime: "application/zip",
                        types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }] })
          .then(function (r) { if (r && r.ok) PL.toast(t("msg.exported")); });
      });
      extra.push(save);
      body.push(el("p", "hint", t("batch.zipReady", { n: zip.length })));
    }
    PL.dialog({ title: t("dlg.batch"), ok: null, body: body, extra: extra });
    PL.live(t(stopped ? "batch.stopped" : "batch.done", { ok: ok, n: total }));
  }

  PL.batch = { open: open, addFiles: addFiles, items: function () { return items; } };
})();
