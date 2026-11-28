// ============================================================
// orOS Atelier — smartpick.js: Pick an object and Colourize (SC,
// v1.0.0), for a photo on the page (AI tab › Picture tools)
// Chris 2026-11-28 («Ναι σε όλα, σύμφωνα με το πλάνο σου»).
//   - Pick an object: tap the object in the photo (SlimSAM, Segment
//     Anything, atelier/smartai.js); it becomes an element of its own
//     on top, in the same place, the background transparent. The photo
//     itself stays as it was. One undo step.
//   - Colourize: DDColor guesses the colours of a black-and-white photo;
//     Strength, Quality; the photo's picture is replaced (one undo step)
// On this device; the models download once, only when asked for.
// Loaded by ai.js the first time it is needed. Uses magic.js's helpers.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, t = AT.t, el = AT.el, ED = AT.ed, A = AT.A;
  var CUT = window.AtelierCutout, MG = AT.magic;
  var VIEW = 480;                               // the dialog's picture (long side)

  var STR = {
    en: {
      "sp.pick": "Pick an object", "sp.color": "Colourize",
      "sp.pickHint": "Tap the object you want (a person, a cup, a car). It becomes an element of its own on top; the photo stays as it is.",
      "sp.part": "Only the part I tap", "sp.use": "Use this", "sp.reading": "Reading the picture…", "sp.tap": "Tap an object in the picture.",
      "sp.nothing": "Nothing was found there. Tap inside the object.",
      "sp.need": "Runs on this device: the picture is not sent anywhere. The first time, Atelier downloads the tool (about {mb} MB); after that it works offline.",
      "sp.go": "Download and start", "sp.load": "Downloading the tool… {p}%", "sp.fail": "That did not work ({why}).",
      "sp.picked": "The object is now its own element: drag it anywhere.",
      "sp.colorHint": "Guesses the colours of a black-and-white or faded photo. The colours are a guess: check them.",
      "sp.colorGo": "Colourize", "sp.coloring": "Colouring…", "sp.strength": "Strength", "sp.quality": "Quality",
      "sp.qBest": "Best", "sp.qFast": "Faster", "sp.colored": "Colourized", "sp.badFile": "the downloaded file was damaged; try again"
    },
    el: {
      "sp.pick": "Πιάσε αντικείμενο", "sp.color": "Χρωματισμός",
      "sp.pickHint": "Πάτα το αντικείμενο που θέλεις (ένα πρόσωπο, μια κούπα, ένα αυτοκίνητο). Γίνεται ξεχωριστό στοιχείο από πάνω· η φωτογραφία μένει όπως είναι.",
      "sp.part": "Μόνο το μέρος που πατάω", "sp.use": "Χρήση", "sp.reading": "Διαβάζω την εικόνα…", "sp.tap": "Πάτα ένα αντικείμενο στην εικόνα.",
      "sp.nothing": "Δεν βρέθηκε κάτι εκεί. Πάτα μέσα στο αντικείμενο.",
      "sp.need": "Γίνεται σε αυτή τη συσκευή: η εικόνα δεν στέλνεται πουθενά. Την πρώτη φορά το Ατελιέ κατεβάζει το εργαλείο (περίπου {mb} MB)· μετά δουλεύει και χωρίς σύνδεση.",
      "sp.go": "Λήψη και έναρξη", "sp.load": "Λήψη του εργαλείου… {p}%", "sp.fail": "Δεν έγινε ({why}).",
      "sp.picked": "Το αντικείμενο είναι τώρα ξεχωριστό στοιχείο: σύρε το όπου θέλεις.",
      "sp.colorHint": "Μαντεύει τα χρώματα μιας ασπρόμαυρης ή ξεθωριασμένης φωτογραφίας. Τα χρώματα είναι εκτίμηση: έλεγξέ τα.",
      "sp.colorGo": "Χρωματισμός", "sp.coloring": "Χρωματίζω…", "sp.strength": "Ένταση", "sp.quality": "Ποιότητα",
      "sp.qBest": "Καλύτερη", "sp.qFast": "Πιο γρήγορη", "sp.colored": "Χρωματίστηκε", "sp.badFile": "το αρχείο που κατέβηκε ήταν χαλασμένο· δοκίμασε ξανά"
    }
  };
  AT.addStrings(STR);

  var aiP = null;
  function engine() {
    if (window.OrosSmartAI) return Promise.resolve(window.OrosSmartAI);
    if (!aiP) {
      aiP = new Promise(function (ok, fail) {
        var v = (document.querySelector('script[src*="core.js?v="]') || {}).src || "", m = v.match(/[?&]v=([^&#]+)/);
        var s = document.createElement("script");
        s.src = "smartai.js" + (m ? "?v=" + m[1] : "");
        s.onload = function () { if (window.OrosSmartAI) ok(window.OrosSmartAI); else fail(new Error("smartai")); };
        s.onerror = function () { fail(new Error("smartai")); };
        document.head.appendChild(s);
      });
      aiP.catch(function () { aiP = null; });
    }
    return aiP;
  }
  function why(e) { return e && e.message === "sha" ? t("sp.badFile") : MG.why(e); }
  // read: the copy is read back often (the previews)
  function small(cv, side, read) {
    var k = Math.min(1, side / Math.max(cv.width, cv.height)), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(cv.width * k)); c.height = Math.max(1, Math.round(cv.height * k));
    c.getContext("2d", read ? { willReadFrequently: true } : undefined).drawImage(cv, 0, 0, c.width, c.height);
    return c;
  }
  function box(alpha, w, h, th) {
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (alpha[y * w + x] <= th) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // ---------- Pick an object ----------
  function pick(id) {
    var it = MG.photo(id);
    if (!it) return;
    Promise.all([engine(), A.load(it.a)]).then(function (r) {
      var AI = r[0], img = r[1];
      if (!img) { AT.toast(t("ep.missing")); return; }
      return AI.needMb(CUT, [AI.MODELS.samEnc, AI.MODELS.samDec]).then(function (mb) { openPick(it, id, AI, img, mb); });
    }).catch(function (e) { AT.toast(t("sp.fail", { why: why(e) })); });
  }
  function openPick(it, id, AI, img, mb) {
    var dlg = AT.$("dlg"), ctl = new AbortController();
    AT.openDialog(t("sp.pick"), function (body, close) {
      var work = MG.canvasOf(img), w = work.width, h = work.height, view = small(work, VIEW);
      var seg = null, res = null, alpha = null, busy = false;
      body.appendChild(el("p", "hint", t("sp.pickHint")));
      var needP = mb ? body.appendChild(el("p", "hint", t("sp.need", { mb: mb }))) : null;
      var stage = el("div", "ai-cut-stage sp-stage");
      var shown = small(work, VIEW, true);
      shown.className = "ai-cut-img sp-img";
      stage.appendChild(shown);
      body.appendChild(stage);
      var ck = el("label", "chk"), part = el("input"); part.type = "checkbox";
      ck.appendChild(part); ck.appendChild(el("span", "", t("sp.part")));
      body.appendChild(ck);
      var stat = el("p", "hint ai-stat"); stat.setAttribute("aria-live", "polite");
      stat.textContent = mb ? "" : t("sp.tap");
      body.appendChild(stat);
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      var use = el("button", "btn primary", t("sp.use")); use.type = "button"; use.disabled = true;
      act.appendChild(c); act.appendChild(use);
      body.appendChild(act);
      c.addEventListener("click", close);
      // the picture with the picked object lit, the rest dimmed
      function draw() {
        var g = shown.getContext("2d");
        g.clearRect(0, 0, shown.width, shown.height);
        g.drawImage(view, 0, 0);
        if (!res) return;
        var a = seg.alpha(res, shown.width, shown.height, 1.5), d = g.getImageData(0, 0, shown.width, shown.height);
        for (var i = 0; i < a.length; i++) {
          var k = 0.35 + 0.65 * a[i] / 255;
          d.data[i * 4] *= k; d.data[i * 4 + 1] *= k; d.data[i * 4 + 2] *= k;
        }
        g.putImageData(d, 0, 0);
      }
      var last = null;
      function run(pt) {
        if (busy) return;
        busy = true; use.disabled = true;
        var first = !seg;
        stat.textContent = first ? (mb ? t("sp.load", { p: 0 }) : t("sp.reading")) : "";
        (seg ? Promise.resolve(seg) : AI.segmenter(CUT, work, {
          signal: ctl.signal,
          onProgress: function (p) { stat.textContent = t("sp.load", { p: Math.round(p * 100) }); },
          onRun: function () { stat.textContent = t("sp.reading"); }
        })).then(function (s) {
          seg = s; mb = 0; if (needP) needP.hidden = true;
          return s.select([pt], part.checked);
        }).then(function (r) {
          busy = false;
          if (ctl.signal.aborted) return;
          res = r; alpha = seg.alpha(r, w, h, 1.5);
          var bx = box(alpha, w, h, 127);
          if (!bx) { res = null; alpha = null; draw(); stat.textContent = t("sp.nothing"); return; }
          draw(); stat.textContent = ""; use.disabled = false;
        }, function (e) {
          busy = false;
          if (!ctl.signal.aborted) stat.textContent = t("sp.fail", { why: why(e) });
        });
      }
      shown.addEventListener("click", function (e) {
        var r = shown.getBoundingClientRect();
        last = { x: (e.clientX - r.left) / r.width * w, y: (e.clientY - r.top) / r.height * h };
        run(last);
      });
      part.addEventListener("change", function () { if (last && seg) run(last); });
      use.addEventListener("click", function () {
        if (!alpha) return;
        use.disabled = true;
        var full = box(alpha, w, h, 10), pl = full && MG.placeOf(it, full, w, h);
        if (!pl) { stat.textContent = t("sp.nothing"); return; }
        var cut = document.createElement("canvas"); cut.width = w; cut.height = h;
        var g = cut.getContext("2d", { willReadFrequently: true });
        g.drawImage(work, 0, 0);
        var d = g.getImageData(0, 0, w, h);
        for (var i = 0; i < alpha.length; i++) d.data[i * 4 + 3] = Math.round(d.data[i * 4 + 3] * alpha[i] / 255);
        g.putImageData(d, 0, 0);
        var sub = document.createElement("canvas");
        sub.width = Math.max(1, Math.round(pl.sw)); sub.height = Math.max(1, Math.round(pl.sh));
        sub.getContext("2d").drawImage(cut, pl.sx, pl.sy, pl.sw, pl.sh, 0, 0, sub.width, sub.height);
        MG.store(sub, MG.baseName(it) + "-object", true).then(function (st) {
          var made = null;
          close();
          // a new item only, the photo unchanged: AT.op (editItems
          // keeps no step when the items it edits stay the same)
          var ok = AT.op(function (doc, nw) {
            var x = AT.M.find(doc.items, id);
            if (!x) return false;
            var spec = { k: "photo", a: st.id, iw: st.w, ih: st.h, nm: MG.baseName(it) + "-object", fit: "fill", x: pl.x, y: pl.y, w: pl.w, h: pl.h };
            if (x.rot) spec.rot = x.rot;
            if (x.ax.adj) spec.adj = JSON.parse(JSON.stringify(x.ax.adj));
            if (x.ax.flt) spec.flt = x.ax.flt;
            made = AT.AX.addItem(doc, x.pg, spec, nw);
            if (!made) return false;
          });
          if (ok && made) {
            if (ED.select) ED.select([made.id]);
            AT.toast(t("sp.picked"), t("btn.undo"), AT.undo);
          }
        }, function (e) { stat.textContent = t("sp.fail", { why: why(e) }); use.disabled = false; });
      });
    }, true);
    dlg.addEventListener("close", function () { ctl.abort(); }, { once: true });
  }

  // ---------- Colourize ----------
  function colorize(id) {
    var it = MG.photo(id);
    if (!it) return;
    Promise.all([engine(), A.load(it.a)]).then(function (r) {
      var AI = r[0], img = r[1];
      if (!img) { AT.toast(t("ep.missing")); return; }
      return AI.needMb(CUT, [AI.MODELS.color]).then(function (mb) { openColor(it, id, AI, img, mb); });
    }).catch(function (e) { AT.toast(t("sp.fail", { why: why(e) })); });
  }
  function openColor(it, id, AI, img, mb) {
    var dlg = AT.$("dlg"), ctl = new AbortController();
    AT.openDialog(t("sp.color"), function (body, close) {
      var work = MG.canvasOf(img), view = small(work, VIEW, true), res = null, amt = 100, fast = window.matchMedia && matchMedia("(max-width: 700px)").matches;
      body.appendChild(el("p", "hint", t("sp.colorHint")));
      var needP = mb ? body.appendChild(el("p", "hint", t("sp.need", { mb: mb }))) : null;
      var qf = el("label", "fld"); qf.appendChild(el("span", "fld-lbl", t("sp.quality")));
      var q = el("select", "inp");
      [["best", t("sp.qBest")], ["fast", t("sp.qFast")]].forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; q.appendChild(op); });
      q.value = fast ? "fast" : "best"; qf.appendChild(q); body.appendChild(qf);
      var stage = el("div", "ai-cut-stage sp-stage"); stage.hidden = true; body.appendChild(stage);
      var sf = el("label", "fld"); sf.hidden = true;
      sf.appendChild(el("span", "fld-lbl", t("sp.strength")));
      var rng = el("input", "rng"); rng.type = "range"; rng.min = "0"; rng.max = "150"; rng.value = "100";
      rng.setAttribute("aria-label", t("sp.strength"));
      sf.appendChild(rng); body.appendChild(sf);
      var stat = el("p", "hint ai-stat"); stat.setAttribute("aria-live", "polite"); body.appendChild(stat);
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      var go = el("button", "btn primary", mb ? t("sp.go") : t("sp.colorGo")); go.type = "button";
      act.appendChild(c); act.appendChild(go); body.appendChild(act);
      c.addEventListener("click", close);
      var vdata = view.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, view.width, view.height).data, pend = 0;
      function preview() {
        var cv = document.createElement("canvas"); cv.width = view.width; cv.height = view.height;
        var d = new Uint8ClampedArray(vdata);
        res.apply(d, view.width, view.height, amt / 100);
        cv.getContext("2d").putImageData(new ImageData(d, view.width, view.height), 0, 0);
        cv.className = "ai-cut-img";
        stage.innerHTML = ""; stage.appendChild(cv);
      }
      rng.addEventListener("input", function () { amt = +rng.value; if (res && !pend) pend = requestAnimationFrame(function () { pend = 0; preview(); }); });
      q.addEventListener("change", function () { fast = q.value === "fast"; if (res) { res = null; start(); } });
      function start() {
        go.disabled = true;
        stat.textContent = mb ? t("sp.load", { p: 0 }) : t("sp.coloring");
        AI.colorize(CUT, small(work, 1024), {
          side: fast ? 256 : 512, signal: ctl.signal,
          onProgress: function (p) { stat.textContent = t("sp.load", { p: Math.round(p * 100) }); },
          onRun: function () { stat.textContent = t("sp.coloring"); }
        }).then(function (r) {
          if (ctl.signal.aborted) return;
          res = r; mb = 0; if (needP) needP.hidden = true;
          stage.hidden = false; sf.hidden = false; stat.textContent = "";
          preview();
          go.textContent = t("sp.use"); go.disabled = false;
        }, function (e) {
          if (ctl.signal.aborted) return;
          stat.textContent = t("sp.fail", { why: why(e) }); go.disabled = false;
        });
      }
      go.addEventListener("click", function () {
        if (!res) { start(); return; }
        go.disabled = true;
        var g = work.getContext("2d", { willReadFrequently: true }), d = g.getImageData(0, 0, work.width, work.height);
        res.apply(d.data, work.width, work.height, amt / 100);
        g.putImageData(d, 0, 0);
        var alpha = MG.hasAlpha(work);
        MG.store(work, MG.baseName(it) + "-colour", alpha).then(function (r) {
          close();
          var ok = AT.editItems([id], function (x) {
            if (x.fit === "custom" && x.iw > 0) x.isc = x.isc * x.iw / r.w;
            x.a = r.id; x.iw = r.w; x.ih = r.h;
          });
          if (ok) AT.toast(t("sp.colored"), t("btn.undo"), AT.undo);
        }, function (e) { stat.textContent = t("sp.fail", { why: why(e) }); go.disabled = false; });
      });
      if (!mb) start();
    }, true);
    dlg.addEventListener("close", function () { ctl.abort(); }, { once: true });
  }

  // The Assistant's and Claude's colorize: one photo of a design copy
  // (it is changed in place, as recipes.js cutOne does) → Promise<bool>
  function colorOne(it, st, signal) {
    return Promise.all([engine(), A.load(it.a)]).then(function (r) {
      var AI = r[0], img = r[1];
      if (!img) return false;
      var work = MG.canvasOf(img);
      return AI.colorize(CUT, small(work, 1024), { side: st.fast ? 256 : 512, signal: signal }).then(function (res) {
        if (signal && signal.aborted) return false;
        var g = work.getContext("2d", { willReadFrequently: true }), d = g.getImageData(0, 0, work.width, work.height);
        res.apply(d.data, work.width, work.height, (st.amt == null ? 100 : st.amt) / 100);
        g.putImageData(d, 0, 0);
        return MG.store(work, MG.baseName(it) + "-colour", MG.hasAlpha(work)).then(function (f) {
          if (it.fit === "custom" && it.iw > 0) it.isc = it.isc * it.iw / f.w;
          it.a = f.id; it.iw = f.w; it.ih = f.h;
          AT.M.touch(it, AT.now());
          return true;
        });
      });
    });
  }

  AT.smartPick = { pick: pick, colorize: colorize, colorOne: colorOne, engine: engine };
})();
