// ============================================================
// orOS Atelier — magic.js: Magic eraser and Magic grab (v1.0.0)
//   - Magic eraser: paint over something in a photo; it is filled
//     from what is around it (inpaint.js). Paint and erase as often
//     as needed, then "Use this": the photo keeps its box and crop.
//   - Magic grab: the main subject (cutout.js) becomes an element of
//     its own on top, and the hole it leaves in the photo is filled.
// Both run on this device; the picture is not sent anywhere. The
// first time they download the tools once (about 40 MB with the
// background tool's runtime); then they work offline.
// One undoable step each.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, t = AT.t, el = AT.el, ED = AT.ed, M = AT.M, A = AT.A;
  var CUT = window.AtelierCutout, INP = window.AtelierInpaint, R = window.orosDK.render;
  var WORK = 2048;                              // longest side the tools work at

  var STR = {
    en: {
      "mg.eraseHint": "Paint over what should go, then tap “Erase”. Paint again to erase more.",
      "mg.brush": "Brush size", "mg.clear": "Clear", "mg.erase": "Erase", "mg.use": "Use this",
      "mg.need": "Runs on this device: the picture is not sent anywhere. The first time, Atelier downloads the tool (about {mb} MB); after that it works offline.",
      "mg.load": "Downloading the tool… {p}%", "mg.run": "Filling in…", "mg.paint": "Paint over something first.",
      "mg.done": "Erased", "mg.fail": "That did not work ({why}).",
      "mg.grabHint": "The main subject becomes an element of its own that you can move, resize or delete, and the photo behind it is filled in.",
      "mg.grabGo": "Grab the subject", "mg.grabRun": "Finding the subject…", "mg.grabFill": "Filling the background…",
      "mg.grabbed": "The subject is now its own element: drag it anywhere.",
      "mg.grabNone": "No clear subject was found in this photo.", "mg.video": "Not for videos.", "mg.pick": "Select a photo on the page first."
    },
    el: {
      "mg.eraseHint": "Βάψε πάνω σε ό,τι πρέπει να φύγει και πάτα «Σβήσιμο». Βάψε ξανά για να σβήσεις κι άλλο.",
      "mg.brush": "Μέγεθος πινέλου", "mg.clear": "Καθαρισμός", "mg.erase": "Σβήσιμο", "mg.use": "Χρήση",
      "mg.need": "Γίνεται σε αυτή τη συσκευή: η εικόνα δεν στέλνεται πουθενά. Την πρώτη φορά το Ατελιέ κατεβάζει το εργαλείο (περίπου {mb} MB)· μετά δουλεύει και χωρίς σύνδεση.",
      "mg.load": "Λήψη του εργαλείου… {p}%", "mg.run": "Γέμισμα…", "mg.paint": "Βάψε πρώτα πάνω σε κάτι.",
      "mg.done": "Σβήστηκε", "mg.fail": "Δεν έγινε ({why}).",
      "mg.grabHint": "Το κύριο θέμα γίνεται ξεχωριστό στοιχείο που μπορείς να μετακινήσεις, να αλλάξεις μέγεθος ή να σβήσεις, και η φωτογραφία πίσω του γεμίζει.",
      "mg.grabGo": "Πιάσε το θέμα", "mg.grabRun": "Βρίσκω το θέμα…", "mg.grabFill": "Γεμίζω το φόντο…",
      "mg.grabbed": "Το θέμα είναι τώρα ξεχωριστό στοιχείο: σύρε το όπου θέλεις.",
      "mg.grabNone": "Δεν βρέθηκε καθαρό θέμα σε αυτή τη φωτογραφία.", "mg.video": "Όχι για βίντεο.", "mg.pick": "Διάλεξε πρώτα μια φωτογραφία στη σελίδα."
    }
  };
  // into Atelier's strings; a pack language gets its lines (core.js AT.addStrings)
  AT.addStrings(STR);

  function photo(id) {
    var it = AT.doc && M.find(AT.doc.items, id);
    if (!it || !it.ax || it.ax.k !== "photo" || !it.a) { AT.toast(t("mg.pick")); return null; }
    if (it.ax.vid) { AT.toast(t("mg.video")); return null; }
    return it;
  }
  function why(e) { return String(e && e.message || e).slice(0, 120); }
  function canvasOf(img) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var k = Math.min(1, WORK / Math.max(w, h)), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  function hasAlpha(cv) {
    var d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data;
    for (var i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
    return false;
  }
  // canvas → an asset on the orOS disk → { id, w, h }
  function store(cv, name, png) {
    return new Promise(function (resolve, reject) {
      var type = png ? "image/png" : "image/jpeg";
      cv.toBlob(function (blob) {
        if (!blob) { reject(new Error(png ? "PNG" : "JPEG")); return; }
        A.importFile(new File([blob], name + (png ? ".png" : ".jpg"), { type: type })).then(function (r) {
          AT.noteUpload(r.id); resolve(r);
        }, function (e) { reject(e && e.message === "nofs" ? new Error(t("img.nofs")) : e); });
      }, type, 0.92);
    });
  }
  function baseName(it) { return (it.nm || "picture").replace(/\.[a-z0-9]+$/i, ""); }

  // The picture with a paint layer on top (pointer: mouse, pen,
  // finger) and a brush size. → { show(cv), painted(), clear(),
  // mask(w, h) → Uint8 (255 = painted, grown a little), busy(on) }
  function painter(body, work) {
    var stage = el("div", "mg-stage ai-checker");
    var maxW = Math.min(560, (window.innerWidth || 400) - 64), maxH = Math.min(440, (window.innerHeight || 600) * 0.45);
    var k = Math.min(maxW / work.width, maxH / work.height, 1);
    var vw = Math.max(1, Math.round(work.width * k)), vh = Math.max(1, Math.round(work.height * k));
    var view = el("canvas", "mg-view"), paint = el("canvas", "mg-paint");
    view.width = paint.width = vw; view.height = paint.height = vh;
    stage.style.width = vw + "px"; stage.style.aspectRatio = vw + " / " + vh;
    stage.appendChild(view); stage.appendChild(paint);
    body.appendChild(stage);
    function show(cv) { var g = view.getContext("2d"); g.clearRect(0, 0, vw, vh); g.drawImage(cv, 0, 0, vw, vh); }
    show(work);
    var size = Math.max(6, Math.round(Math.min(vw, vh) / 14));
    var bl = el("label", "fld mg-brush");
    bl.appendChild(el("span", "fld-lbl", t("mg.brush")));
    var rng = el("input", "rng"); rng.type = "range"; rng.min = "4"; rng.max = String(Math.max(20, Math.round(Math.min(vw, vh) / 4))); rng.value = String(size);
    rng.setAttribute("aria-label", t("mg.brush"));
    rng.addEventListener("input", function () { size = Number(rng.value); });
    bl.appendChild(rng);
    body.appendChild(bl);
    var pg = paint.getContext("2d"), down = false, last = null, painted = false, busy = false;
    pg.fillStyle = pg.strokeStyle = "rgba(255,64,96,0.55)"; pg.lineCap = pg.lineJoin = "round";
    function pos(e) { var b = paint.getBoundingClientRect(); return { x: (e.clientX - b.left) * vw / b.width, y: (e.clientY - b.top) * vh / b.height }; }
    function dot(p) {
      pg.lineWidth = size;
      pg.beginPath();
      if (last) { pg.moveTo(last.x, last.y); pg.lineTo(p.x, p.y); pg.stroke(); }
      pg.beginPath(); pg.arc(p.x, p.y, size / 2, 0, Math.PI * 2); pg.fill();
      last = p; painted = true;
    }
    paint.addEventListener("pointerdown", function (e) {
      if (busy) return;
      down = true; last = null; paint.setPointerCapture(e.pointerId); dot(pos(e)); e.preventDefault();
    });
    paint.addEventListener("pointermove", function (e) { if (down) { dot(pos(e)); e.preventDefault(); } });
    function up() { down = false; last = null; }
    paint.addEventListener("pointerup", up); paint.addEventListener("pointercancel", up);
    return {
      show: show,
      painted: function () { return painted; },
      clear: function () { pg.clearRect(0, 0, vw, vh); painted = false; },
      busy: function (on) { busy = !!on; },
      // the painted strokes at w × h → the mask
      mask: function (w, h) {
        var mc = document.createElement("canvas"); mc.width = w; mc.height = h;
        var mg = mc.getContext("2d", { willReadFrequently: true });
        mg.drawImage(paint, 0, 0, w, h);
        var md = mg.getImageData(0, 0, w, h).data, hole = new Uint8ClampedArray(w * h);
        for (var i = 0; i < hole.length; i++) hole[i] = md[i * 4 + 3] > 20 ? 255 : 0;
        return INP.grow(hole, w, h, Math.max(2, Math.round(Math.max(w, h) / 300)));
      }
    };
  }

  // ---------- Magic eraser ----------
  function erase(id) {
    var it = photo(id);
    if (!it) return;
    Promise.all([INP.ready(), A.load(it.a)]).then(function (r) {
      var have = r[0], img = r[1];
      if (!img) { AT.toast(t("ep.missing")); return; }
      var work = canvasOf(img), alpha = hasAlpha(work), changed = false;
      var dlg = AT.$("dlg"), ctl = new AbortController();
      AT.openDialog(t("ai.erase"), function (body, close) {
        body.appendChild(el("p", "hint", t("mg.eraseHint")));
        var needP = have ? null : body.appendChild(el("p", "hint", t("mg.need", { mb: INP.APPROX_MB })));
        var pt = painter(body, work);
        var stat = el("p", "hint ai-stat");
        body.appendChild(stat);
        var act = el("div", "dlg-actions");
        var c = el("button", "btn", t("btn.cancel")); c.type = "button";
        var clr = el("button", "btn", t("mg.clear")); clr.type = "button";
        var go = el("button", "btn", t("mg.erase")); go.type = "button";
        var use = el("button", "btn primary", t("mg.use")); use.type = "button"; use.disabled = true;
        act.appendChild(c); act.appendChild(clr); act.appendChild(go); act.appendChild(use);
        body.appendChild(act);
        c.addEventListener("click", close);
        clr.addEventListener("click", function () { pt.clear(); stat.textContent = ""; });

        go.addEventListener("click", function () {
          if (!pt.painted()) { stat.textContent = t("mg.paint"); return; }
          var hole = pt.mask(work.width, work.height);
          pt.busy(true); go.disabled = clr.disabled = use.disabled = true;
          stat.textContent = have ? t("mg.run") : t("mg.load", { p: 0 });
          INP.fill(work, hole, {
            signal: ctl.signal,
            onProgress: function (p) { if (!have) stat.textContent = t("mg.load", { p: Math.round(p * 100) }); },
            onRun: function () { stat.textContent = t("mg.run"); }
          }).then(function (out) {
            if (ctl.signal.aborted) return;
            have = true; if (needP) needP.hidden = true;
            work = out; changed = true; pt.show(work);
            pt.clear();
            stat.textContent = "";
          }, function (e) {
            if (!ctl.signal.aborted) stat.textContent = t("mg.fail", { why: why(e) });
          }).then(function () { pt.busy(false); go.disabled = clr.disabled = false; use.disabled = !changed; });
        });

        use.addEventListener("click", function () {
          if (!changed) return;
          use.disabled = go.disabled = true;
          store(work, baseName(it) + "-erased", alpha).then(function (r) {
            close();
            var ok = AT.editItems([id], function (x) {
              // same shape: the crop stays (drawn size iw × isc), see editpic.js
              if (x.fit === "custom" && x.iw > 0) x.isc = x.isc * x.iw / r.w;
              x.a = r.id; x.iw = r.w; x.ih = r.h;
            });
            if (ok) AT.toast(t("mg.done"), t("btn.undo"), AT.undo);
          }, function (e) { stat.textContent = t("mg.fail", { why: why(e) }); use.disabled = go.disabled = false; });
        });
      }, true);
      dlg.addEventListener("close", function () { ctl.abort(); }, { once: true });
    });
  }

  // ---------- Magic grab ----------
  // Where a part of the picture (px box in a w × h copy) lands on the
  // page, clipped to the photo's frame → { x, y, w, h, sx, sy, sw, sh }
  // (sx… = the part of the copy that is inside), or null.
  function placeOf(it, box, w, h) {
    var r = R.imageRect(it);
    var lx = r.x + box.x / w * r.w, ly = r.y + box.y / h * r.h, lw = box.w / w * r.w, lh = box.h / h * r.h;
    var x0 = Math.max(0, lx), y0 = Math.max(0, ly), x1 = Math.min(it.w, lx + lw), y1 = Math.min(it.h, ly + lh);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    var kx = w / r.w, ky = h / r.h;
    var sx = box.x + (x0 - lx) * kx, sy = box.y + (y0 - ly) * ky, sw = (x1 - x0) * kx, sh = (y1 - y0) * ky;
    // the frame turns about its centre: so does the part's offset
    var a = (it.rot || 0) * Math.PI / 180, ox = (x0 + x1) / 2 - it.w / 2, oy = (y0 + y1) / 2 - it.h / 2;
    var cx = it.x + it.w / 2 + ox * Math.cos(a) - oy * Math.sin(a), cy = it.y + it.h / 2 + ox * Math.sin(a) + oy * Math.cos(a);
    return { x: cx - (x1 - x0) / 2, y: cy - (y1 - y0) / 2, w: x1 - x0, h: y1 - y0, sx: sx, sy: sy, sw: sw, sh: sh };
  }

  function grab(id) {
    var it = photo(id);
    if (!it) return;
    Promise.all([INP.ready(), CUT.ready(), A.load(it.a)]).then(function (r) {
      var have = r[0] && r[1], img = r[2];
      if (!img) { AT.toast(t("ep.missing")); return; }
      var dlg = AT.$("dlg"), ctl = new AbortController();
      AT.openDialog(t("ai.grab"), function (body, close) {
        body.appendChild(el("p", "hint", t("mg.grabHint")));
        if (!have) body.appendChild(el("p", "hint", t("mg.need", { mb: INP.APPROX_MB })));
        var stat = el("p", "hint ai-stat");
        body.appendChild(stat);
        var act = el("div", "dlg-actions");
        var c = el("button", "btn", t("btn.cancel")); c.type = "button";
        var go = el("button", "btn primary", t("mg.grabGo")); go.type = "button";
        act.appendChild(c); act.appendChild(go);
        body.appendChild(act);
        c.addEventListener("click", close);
        function progress(p) { if (!have) stat.textContent = t("mg.load", { p: Math.round(p * 100) }); }
        go.addEventListener("click", function () {
          go.disabled = true;
          stat.textContent = have ? t("mg.grabRun") : t("mg.load", { p: 0 });
          var work = canvasOf(img), w = work.width, h = work.height, res, alpha, box;
          CUT.cut(work, { signal: ctl.signal, onProgress: progress, onRun: function () { stat.textContent = t("mg.grabRun"); } }).then(function (cr) {
            res = cr;
            alpha = CUT.alphaFor(cr.mask, CUT.S, w, h);
            box = INP.opaqueBox(alpha, w, h, 127);
            if (!box || box.w * box.h > 0.9 * w * h || box.w * box.h < 0.002 * w * h) throw new Error("none");
            var hole = new Uint8ClampedArray(w * h);
            for (var i = 0; i < hole.length; i++) hole[i] = alpha[i] > 40 ? 255 : 0;
            hole = INP.grow(hole, w, h, Math.max(4, Math.round(Math.max(w, h) * 0.012)));
            stat.textContent = t("mg.grabFill");
            return INP.fill(work, hole, { signal: ctl.signal, onProgress: progress, onRun: function () { stat.textContent = t("mg.grabFill"); } });
          }).then(function (bg) {
            if (ctl.signal.aborted) return;
            var cut = res.render(CUT.LO, Math.max(w, h));
            var full = INP.opaqueBox(alpha, w, h, 10) || box;
            var pl = placeOf(it, full, w, h);
            if (!pl) throw new Error("none");
            var sub = document.createElement("canvas");
            sub.width = Math.max(1, Math.round(pl.sw)); sub.height = Math.max(1, Math.round(pl.sh));
            sub.getContext("2d").drawImage(cut, pl.sx, pl.sy, pl.sw, pl.sh, 0, 0, sub.width, sub.height);
            stat.textContent = t("mg.grabFill");
            return Promise.all([store(bg, baseName(it) + "-background", hasAlpha(work)), store(sub, baseName(it) + "-subject", true)]).then(function (st) {
              var made = null;
              close();
              var ok = AT.editItems([id], function (x, doc, nw) {
                if (x.fit === "custom" && x.iw > 0) x.isc = x.isc * x.iw / st[0].w;
                x.a = st[0].id; x.iw = st[0].w; x.ih = st[0].h;
                var spec = { k: "photo", a: st[1].id, iw: st[1].w, ih: st[1].h, nm: baseName(it) + "-subject", fit: "fill",
                  x: pl.x, y: pl.y, w: pl.w, h: pl.h };
                if (x.rot) spec.rot = x.rot;
                if (x.ax.adj) spec.adj = JSON.parse(JSON.stringify(x.ax.adj));
                if (x.ax.flt) spec.flt = x.ax.flt;
                made = AT.AX.addItem(doc, x.pg, spec, nw);
              });
              if (ok && made) {
                if (ED.select) ED.select([made.id]);
                AT.toast(t("mg.grabbed"), t("btn.undo"), AT.undo);
              }
            });
          }).catch(function (e) {
            if (ctl.signal.aborted) return;
            stat.textContent = e && e.message === "none" ? t("mg.grabNone") : t("mg.fail", { why: why(e) });
            go.disabled = false;
          });
        });
      }, true);
      dlg.addEventListener("close", function () { ctl.abort(); }, { once: true });
    });
  }

  AT.magic = { erase: erase, grab: grab, placeOf: placeOf,
    painter: painter, photo: photo, canvasOf: canvasOf, hasAlpha: hasAlpha, store: store, baseName: baseName, why: why };
})();
