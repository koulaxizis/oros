// ============================================================
// orOS Atelier — magicai.js: Magic edit and Magic expand (v1.0.0)
//   - Magic edit: paint over a part of a photo and say what should be
//     there ("a red umbrella", "blue sky"); the image AI redraws only
//     that part.
//   - Magic expand: the photo grows to a new shape (its frame, square,
//     16:9…) or just "more around", and the AI draws what is beyond
//     its edges.
// Both use the image AI chosen in the Assistant (Settings › Pictures;
// assistant/imgai.js) that can fill a painted part: OpenAI
// gpt-image-1, Stability AI, or Stable Diffusion WebUI / Forge on the
// user's own computer. Only the part of the picture around the paint
// (or the photo, to expand), its mask and the description are sent,
// straight from this device. One undoable step each.
// The geometry is pure (unit-tested); the rest needs a browser.
// ============================================================
(function (root) {
  "use strict";

  // ---------- Pure steps ----------
  // The part of the picture sent to edit: the painted box with room
  // around it (the AI needs to see what is there), inside the picture.
  function regionFor(box, w, h) {
    var bw = box.x1 - box.x0, bh = box.y1 - box.y0, m = Math.max(48, Math.round(Math.max(bw, bh) * 0.35));
    var x0 = Math.max(0, box.x0 - m), y0 = Math.max(0, box.y0 - m), x1 = Math.min(w, box.x1 + m), y1 = Math.min(h, box.y1 + m);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // The canvas the service gets for a rw × rh part.
  //   openai: its three sizes; sdwebui: long side 1024, multiples of
  //   64; stability: the same shape, long side 1024.
  function frameFor(pid, rw, rh) {
    var r = rw / rh;
    if (pid === "openai") return r > 1.2 ? { w: 1536, h: 1024 } : r < 0.83 ? { w: 1024, h: 1536 } : { w: 1024, h: 1024 };
    if (pid === "sdwebui") {
      return r >= 1 ? { w: 1024, h: Math.max(256, Math.round(1024 / r / 64) * 64) } : { w: Math.max(256, Math.round(1024 * r / 64) * 64), h: 1024 };
    }
    return r >= 1 ? { w: 1024, h: Math.max(64, Math.round(1024 / r)) } : { w: Math.max(64, Math.round(1024 * r)), h: 1024 };
  }
  // rw × rh fitted (centred) in fw × fh.
  function fitRect(rw, rh, fw, fh) {
    var k = Math.min(fw / rw, fh / rh), w = Math.max(1, Math.round(rw * k)), h = Math.max(1, Math.round(rh * k));
    return { x: Math.round((fw - w) / 2), y: Math.round((fh - h) / 2), w: w, h: h };
  }
  // The grown picture: ratio = W / H to reach (0 = the same shape,
  // `more` times bigger). → { W, H, ox, oy } (where the photo sits) |
  // null (it already has that shape).
  function expandRect(w, h, ratio, more) {
    var W, H;
    if (!ratio) { W = Math.round(w * (more || 1.5)); H = Math.round(h * (more || 1.5)); }
    else if (ratio > w / h) { H = h; W = Math.round(h * ratio); }
    else { W = w; H = Math.round(w / ratio); }
    if (W <= w + 1 && H <= h + 1) return null;
    return { W: W, H: H, ox: Math.round((W - w) / 2), oy: Math.round((H - h) / 2) };
  }
  // Stability's outpaint: pixels to add on each side (scaled by k,
  // at most 2000 each).
  function padFor(ex, w, h, k) {
    function c(v) { return Math.max(0, Math.min(2000, Math.round(v * (k || 1)))); }
    return { left: c(ex.ox), right: c(ex.W - w - ex.ox), up: c(ex.oy), down: c(ex.H - h - ex.oy) };
  }
  var RATIOS = { frame: -1, more: 0, "1:1": 1, "4:5": 0.8, "3:2": 1.5, "16:9": 16 / 9, "9:16": 9 / 16 };
  var RATIO_IDS = ["frame", "more", "1:1", "4:5", "3:2", "16:9", "9:16"];

  var pure = { regionFor: regionFor, frameFor: frameFor, fitRect: fitRect, expandRect: expandRect, padFor: padFor, RATIOS: RATIOS, RATIO_IDS: RATIO_IDS };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  // ---------- Runtime ----------
  var AT = root.AT, t = AT.t, el = AT.el, A = AT.A, M = AT.M;
  var IA = root.OrosImageAI, INP = root.AtelierInpaint;
  if (!IA || !AT.magic) return;
  var MG = AT.magic;

  var STR = {
    en: {
      "me.hint": "Paint over a part of the photo and say what should be there. Only that part changes.",
      "me.ask": "What should be there?", "me.ph": "e.g. a red umbrella · blue sky · a bunch of flowers",
      "me.go": "Make it", "me.again": "Try again", "me.making": "{name} is drawing…",
      "me.sent": "The part of the photo around your paint and your words go to {name}, straight from this device.",
      "me.sentX": "The photo and your words go to {name}, straight from this device.",
      "me.local": "Made on your own computer: nothing leaves your network.",
      "me.need": "Magic edit and Magic expand need an image AI that can fill a painted part: OpenAI, Stability AI or Stable Diffusion WebUI / Forge on your computer. Choose one in the Assistant (Settings › Pictures): the steps are there.",
      "me.needBtn": "Choose in the Assistant", "me.done": "Edited", "me.say": "Say what should be there.",
      "mx.hint": "The photo grows and AI draws what is beyond its edges.",
      "mx.shape": "New shape", "mx.r.frame": "Fill its frame", "mx.r.more": "More around (1.5×)",
      "mx.r.1:1": "Square", "mx.r.4:5": "4:5 (post)", "mx.r.3:2": "3:2", "mx.r.16:9": "16:9 (wide)", "mx.r.9:16": "9:16 (story)",
      "mx.ask": "What is around? (optional)", "mx.ph": "e.g. a sandy beach", "mx.go": "Expand",
      "mx.same": "The photo already has this shape: pick another.", "mx.done": "Expanded"
    },
    el: {
      "me.hint": "Βάψε πάνω σε ένα κομμάτι της φωτογραφίας και πες τι να υπάρχει εκεί. Αλλάζει μόνο αυτό το κομμάτι.",
      "me.ask": "Τι να υπάρχει εκεί;", "me.ph": "π.χ. μια κόκκινη ομπρέλα · γαλάζιος ουρανός · ένα μπουκέτο λουλούδια",
      "me.go": "Φτιάξ' το", "me.again": "Ξανά", "me.making": "Το {name} ζωγραφίζει…",
      "me.sent": "Το κομμάτι της φωτογραφίας γύρω από το βάψιμο και τα λόγια σου πηγαίνουν στο {name}, απευθείας από αυτή τη συσκευή.",
      "me.sentX": "Η φωτογραφία και τα λόγια σου πηγαίνουν στο {name}, απευθείας από αυτή τη συσκευή.",
      "me.local": "Γίνεται στον δικό σου υπολογιστή: τίποτα δεν βγαίνει από το δίκτυό σου.",
      "me.need": "Η Μαγική επεξεργασία και η Μαγική επέκταση θέλουν AI εικόνας που γεμίζει ένα βαμμένο κομμάτι: OpenAI, Stability AI ή Stable Diffusion WebUI / Forge στον υπολογιστή σου. Διάλεξε ένα στον Βοηθό (Ρυθμίσεις › Εικόνες): εκεί είναι τα βήματα.",
      "me.needBtn": "Επιλογή στον Βοηθό", "me.done": "Έγινε η αλλαγή", "me.say": "Πες τι να υπάρχει εκεί.",
      "mx.hint": "Η φωτογραφία μεγαλώνει και το AI ζωγραφίζει ό,τι υπάρχει πέρα από τις άκρες της.",
      "mx.shape": "Νέο σχήμα", "mx.r.frame": "Να γεμίσει το πλαίσιό της", "mx.r.more": "Περισσότερο γύρω (1,5×)",
      "mx.r.1:1": "Τετράγωνο", "mx.r.4:5": "4:5 (ανάρτηση)", "mx.r.3:2": "3:2", "mx.r.16:9": "16:9 (φαρδύ)", "mx.r.9:16": "9:16 (story)",
      "mx.ask": "Τι υπάρχει γύρω; (προαιρετικό)", "mx.ph": "π.χ. μια αμμουδιά", "mx.go": "Επέκταση",
      "mx.same": "Η φωτογραφία έχει ήδη αυτό το σχήμα: διάλεξε άλλο.", "mx.done": "Η φωτογραφία επεκτάθηκε"
    }
  };
  // into Atelier's strings; a pack language gets its lines (core.js AT.addStrings)
  AT.addStrings(STR);

  function canvas(w, h) { var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function blobOf(cv, type) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("PNG")); }, type || "image/png", 0.92);
    });
  }
  function b64Of(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(new Error("read")); };
      fr.readAsDataURL(blob);
    });
  }
  function imageOf(blob) {
    return createImageBitmap(blob).catch(function () { throw new IA.ImageError("bad"); });
  }
  function openAssistant() {
    try {
      var p = root.parent;
      if (p && p !== root && typeof p.__orosOpenAt === "function") { p.__orosOpenAt("assistant", {}); return; }
    } catch (e) {}
    AT.toast(t("ai.noAssistant"));
  }

  // The image AI that can fill, with its key → then({ cf, name, key })
  function need(then) {
    var ch = AT.imagine.choice(), cf = ch.cf;
    function stop(text) {
      AT.openDialog(t("ai.edit"), function (body, close) {
        body.appendChild(el("p", "hint", text));
        var act = el("div", "dlg-actions");
        var c = el("button", "btn", t("btn.cancel")); c.type = "button";
        var o = el("button", "btn primary", t("me.needBtn")); o.type = "button";
        c.addEventListener("click", close);
        o.addEventListener("click", function () { close(); openAssistant(); });
        act.appendChild(c); act.appendChild(o);
        body.appendChild(act);
      });
    }
    if (!cf.p.mask) { stop(t("me.need")); return; }
    (cf.p.keyId ? AT.ai.readKey(cf.p.keyId) : Promise.resolve("")).then(function (key) {
      if (cf.p.key === "yes" && !key) { stop(t("im.noKey", { name: ch.name })); return; }
      then({ cf: cf, name: ch.name, key: key });
    });
  }

  // Send a part of src (region, in src pixels; it may reach beyond src
  // to grow it) with what may change: `hole` (Uint8 over src, 255 =
  // change) or, to grow, everything outside `keep` (src pixels).
  // → Promise<canvas region.w × region.h>
  function redraw(ai, prompt, src, region, hole, keep, signal) {
    var cf = ai.cf, F = frameFor(cf.pid, region.w, region.h), fr = fitRect(region.w, region.h, F.w, F.h);
    var kx = fr.w / region.w, ky = fr.h / region.h;
    // the picture: a blurred copy behind (the bands), the part on top
    var img = canvas(F.w, F.h), g = img.getContext("2d");
    g.filter = "blur(24px)";
    g.drawImage(src, Math.max(0, region.x), Math.max(0, region.y), Math.min(src.width, region.w), Math.min(src.height, region.h), 0, 0, F.w, F.h);
    g.filter = "none";
    // what is outside src (to grow) stays the blurred colour
    g.drawImage(src, 0, 0, src.width, src.height, fr.x - region.x * kx, fr.y - region.y * ky, src.width * kx, src.height * ky);
    // what may change, white
    var ed = canvas(F.w, F.h), eg = ed.getContext("2d");
    eg.fillStyle = "#fff";
    if (keep) {
      eg.fillRect(0, 0, F.w, F.h);
      var inset = Math.max(2, Math.round(Math.min(fr.w, fr.h) / 100));
      eg.clearRect(fr.x + (keep.x - region.x) * kx + inset, fr.y + (keep.y - region.y) * ky + inset, keep.w * kx - 2 * inset, keep.h * ky - 2 * inset);
    } else {
      var hc = canvas(src.width, src.height), hg = hc.getContext("2d"), hd = hg.createImageData(hc.width, hc.height);
      for (var i = 0; i < hole.length; i++) { hd.data[i * 4] = hd.data[i * 4 + 1] = hd.data[i * 4 + 2] = 255; hd.data[i * 4 + 3] = hole[i] > 127 ? 255 : 0; }
      hg.putImageData(hd, 0, 0);
      eg.drawImage(hc, region.x, region.y, region.w, region.h, fr.x, fr.y, fr.w, fr.h);
    }
    // OpenAI: transparent = change; the others: white = change
    var oa = canvas(F.w, F.h), og = oa.getContext("2d");
    og.fillStyle = "#000"; og.fillRect(0, 0, F.w, F.h);
    og.globalCompositeOperation = "destination-out"; og.drawImage(ed, 0, 0);
    var bw = canvas(F.w, F.h), bg = bw.getContext("2d");
    bg.fillStyle = "#000"; bg.fillRect(0, 0, F.w, F.h); bg.drawImage(ed, 0, 0);
    return Promise.all([blobOf(img), blobOf(oa), blobOf(bw)]).then(function (b) {
      return Promise.all([b64Of(b[0]), b64Of(b[2])]).then(function (s) {
        var req = IA.buildEdit(cf, ai.key, { prompt: prompt, image: b[0], mask: b[1], maskBw: b[2], imageB64: s[0], maskB64: s[1], w: F.w, h: F.h, n: 1 });
        return IA.run(req, signal);
      });
    }).then(function (list) { return imageOf(list[0]); }).then(function (bmp) {
      // back to the part's size (the service may answer at another size)
      var out = canvas(region.w, region.h);
      out.getContext("2d").drawImage(bmp, fr.x * bmp.width / F.w, fr.y * bmp.height / F.h, fr.w * bmp.width / F.w, fr.h * bmp.height / F.h, 0, 0, region.w, region.h);
      return out;
    });
  }

  // Stability's own outpaint: the photo (long side ≤ 1024) and how
  // much to add. → Promise<canvas ex.W × ex.H>
  function outpaint(ai, prompt, src, ex, signal) {
    var k = Math.min(1, 1024 / Math.max(src.width, src.height)), sm = canvas(src.width * k, src.height * k);
    sm.getContext("2d").drawImage(src, 0, 0, sm.width, sm.height);
    return blobOf(sm).then(function (b) {
      return IA.run(IA.buildExpand(ai.cf, ai.key, { prompt: prompt, original: b, pad: padFor(ex, src.width, src.height, k) }), signal);
    }).then(function (list) { return imageOf(list[0]); }).then(function (bmp) {
      var out = canvas(ex.W, ex.H);
      out.getContext("2d").drawImage(bmp, 0, 0, ex.W, ex.H);
      return out;
    });
  }

  // a piece drawn on top with a soft edge: only where mask (or the
  // whole piece, inset) says
  function softPaste(dst, piece, x, y, hole, region) {
    var p = canvas(piece.width, piece.height), pg = p.getContext("2d");
    pg.drawImage(piece, 0, 0);
    pg.globalCompositeOperation = "destination-in";
    var f = Math.max(1, Math.round(Math.max(piece.width, piece.height) / 300));
    pg.filter = "blur(" + f + "px)";
    if (hole) {
      var hc = canvas(dst.width, dst.height), hg = hc.getContext("2d"), hd = hg.createImageData(hc.width, hc.height);
      for (var i = 0; i < hole.length; i++) hd.data[i * 4 + 3] = hole[i] > 127 ? 255 : 0;
      hg.putImageData(hd, 0, 0);
      pg.drawImage(hc, region.x, region.y, region.w, region.h, 0, 0, piece.width, piece.height);
    } else {
      pg.fillStyle = "#000";
      pg.fillRect(2 * f, 2 * f, piece.width - 4 * f, piece.height - 4 * f);
    }
    dst.getContext("2d").drawImage(p, x, y);
  }

  function noteFor(ai, grow) { return ai.cf.p.local ? t("me.local") : t(grow ? "me.sentX" : "me.sent", { name: ai.name }); }

  // ---------- Magic edit ----------
  function edit(id) {
    var it = MG.photo(id);
    if (!it) return;
    need(function (ai) {
      A.load(it.a).then(function (img) {
        if (!img) { AT.toast(t("ep.missing")); return; }
        var work = MG.canvasOf(img), alpha = MG.hasAlpha(work), changed = false;
        var dlg = AT.$("dlg"), ctl = new AbortController(), prompt = "";
        AT.openDialog(t("ai.edit"), function (body, close) {
          body.appendChild(el("p", "hint", t("me.hint")));
          var pt = MG.painter(body, work);
          var ta = el("input", "inp"); ta.type = "text"; ta.maxLength = 500; ta.placeholder = t("me.ph");
          ta.setAttribute("aria-label", t("me.ask"));
          var f = el("label", "fld"); f.appendChild(el("span", "fld-lbl", t("me.ask"))); f.appendChild(ta);
          body.appendChild(f);
          body.appendChild(el("p", "hint ai-note", noteFor(ai, false)));
          var stat = el("p", "hint ai-stat"); stat.setAttribute("role", "status");
          body.appendChild(stat);
          var act = el("div", "dlg-actions");
          var c = el("button", "btn", t("btn.cancel")); c.type = "button";
          var clr = el("button", "btn", t("mg.clear")); clr.type = "button";
          var go = el("button", "btn", t("me.go")); go.type = "button";
          var use = el("button", "btn primary", t("mg.use")); use.type = "button"; use.disabled = true;
          act.appendChild(c); act.appendChild(clr); act.appendChild(go); act.appendChild(use);
          body.appendChild(act);
          c.addEventListener("click", close);
          clr.addEventListener("click", function () { pt.clear(); stat.textContent = ""; });
          ta.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go.click(); } });
          go.addEventListener("click", function () {
            if (!pt.painted()) { stat.textContent = t("mg.paint"); return; }
            prompt = ta.value.trim();
            if (!prompt) { stat.textContent = t("me.say"); ta.focus(); return; }
            var hole = pt.mask(work.width, work.height), box = INP.opaqueBox(hole, work.width, work.height, 127);
            if (!box) { stat.textContent = t("mg.paint"); return; }
            var region = regionFor({ x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h }, work.width, work.height);
            pt.busy(true); go.disabled = clr.disabled = use.disabled = true;
            stat.textContent = t("me.making", { name: ai.name });
            redraw(ai, prompt, work, region, hole, null, ctl.signal).then(function (piece) {
              if (ctl.signal.aborted) return;
              var next = canvas(work.width, work.height);
              next.getContext("2d").drawImage(work, 0, 0);
              softPaste(next, piece, region.x, region.y, hole, region);
              work = next; changed = true; pt.show(work); pt.clear();
              stat.textContent = "";
            }, function (e) {
              if (!ctl.signal.aborted) stat.textContent = AT.imagine.errText(e, ai.name);
            }).then(function () { pt.busy(false); go.disabled = clr.disabled = false; use.disabled = !changed; });
          });
          use.addEventListener("click", function () {
            if (!changed) return;
            use.disabled = go.disabled = true;
            MG.store(work, MG.baseName(it) + "-edited", alpha).then(function (r) {
              close();
              var ok = AT.editItems([id], function (x) {
                if (x.fit === "custom" && x.iw > 0) x.isc = x.isc * x.iw / r.w;
                x.a = r.id; x.iw = r.w; x.ih = r.h;
              });
              if (ok) AT.toast(t("me.done"), t("btn.undo"), AT.undo);
            }, function (e) { stat.textContent = t("mg.fail", { why: MG.why(e) }); use.disabled = go.disabled = false; });
          });
          setTimeout(function () { ta.focus(); }, 0);
        }, true);
        dlg.addEventListener("close", function () { ctl.abort(); }, { once: true });
      });
    });
  }

  // ---------- Magic expand ----------
  function expand(id) {
    var it = MG.photo(id);
    if (!it) return;
    need(function (ai) {
      A.load(it.a).then(function (img) {
        if (!img) { AT.toast(t("ep.missing")); return; }
        var src = MG.canvasOf(img), result = null, resEx = null;
        var dlg = AT.$("dlg"), ctl = new AbortController();
        var frameR = it.w / it.h, picR = src.width / src.height;
        var choice = Math.abs(Math.log(frameR / picR)) > 0.02 ? "frame" : "more";
        AT.openDialog(t("ai.expand"), function (body, close) {
          body.appendChild(el("p", "hint", t("mx.hint")));
          var f = el("label", "fld"); f.appendChild(el("span", "fld-lbl", t("mx.shape")));
          var sel = el("select", "inp");
          RATIO_IDS.forEach(function (r) { var o = el("option", "", t("mx.r." + r)); o.value = r; sel.appendChild(o); });
          sel.value = choice;
          f.appendChild(sel); body.appendChild(f);
          var stage = el("div", "mg-stage ai-checker");
          var view = el("canvas", "mg-view");
          stage.appendChild(view); body.appendChild(stage);
          var f2 = el("label", "fld"); f2.appendChild(el("span", "fld-lbl", t("mx.ask")));
          var ta = el("input", "inp"); ta.type = "text"; ta.maxLength = 500; ta.placeholder = t("mx.ph");
          f2.appendChild(ta); body.appendChild(f2);
          body.appendChild(el("p", "hint ai-note", noteFor(ai, true)));
          var stat = el("p", "hint ai-stat"); stat.setAttribute("role", "status");
          body.appendChild(stat);
          var act = el("div", "dlg-actions");
          var c = el("button", "btn", t("btn.cancel")); c.type = "button";
          var go = el("button", "btn", t("mx.go")); go.type = "button";
          var use = el("button", "btn primary", t("mg.use")); use.type = "button"; use.disabled = true;
          act.appendChild(c); act.appendChild(go); act.appendChild(use);
          body.appendChild(act);
          c.addEventListener("click", close);
          function exOf() {
            var r = RATIOS[sel.value];
            return expandRect(src.width, src.height, r < 0 ? frameR : r, 1.5);
          }
          // the new shape, the photo in it (or the result)
          function show() {
            var ex = result ? resEx : exOf();
            var W = ex ? ex.W : src.width, H = ex ? ex.H : src.height;
            var maxW = Math.min(560, (root.innerWidth || 400) - 64), maxH = Math.min(380, (root.innerHeight || 600) * 0.4);
            var k = Math.min(maxW / W, maxH / H, 1), vw = Math.max(1, Math.round(W * k)), vh = Math.max(1, Math.round(H * k));
            view.width = vw; view.height = vh;
            stage.style.width = vw + "px"; stage.style.aspectRatio = vw + " / " + vh;
            var g = view.getContext("2d");
            g.clearRect(0, 0, vw, vh);
            if (result) { g.drawImage(result, 0, 0, vw, vh); return; }
            g.fillStyle = "rgba(127,127,127,0.25)"; g.fillRect(0, 0, vw, vh);
            g.drawImage(src, (ex ? ex.ox : 0) * k, (ex ? ex.oy : 0) * k, src.width * k, src.height * k);
            stat.textContent = ex ? "" : t("mx.same");
            go.disabled = !ex;
          }
          sel.addEventListener("change", function () { result = null; use.disabled = true; go.textContent = t("mx.go"); show(); });
          show();
          go.addEventListener("click", function () {
            var ex = exOf();
            if (!ex) { stat.textContent = t("mx.same"); return; }
            go.disabled = use.disabled = sel.disabled = true;
            stat.textContent = t("me.making", { name: ai.name });
            var prompt = ta.value.trim();
            var job = ai.cf.pid === "stability" ? outpaint(ai, prompt, src, ex, ctl.signal)
              : redraw(ai, prompt || "continue the picture naturally, same style and light", src,
                  { x: -ex.ox, y: -ex.oy, w: ex.W, h: ex.H }, null, { x: 0, y: 0, w: src.width, h: src.height }, ctl.signal);
            job.then(function (big) {
              if (ctl.signal.aborted) return;
              // the photo itself stays as it was, with a soft edge
              softPaste(big, src, ex.ox, ex.oy, null, null);
              result = big; resEx = ex;
              show();
              stat.textContent = "";
              go.textContent = t("me.again");
              use.disabled = false;
            }, function (e) {
              if (!ctl.signal.aborted) stat.textContent = AT.imagine.errText(e, ai.name);
            }).then(function () { go.disabled = sel.disabled = false; });
          });
          use.addEventListener("click", function () {
            if (!result) return;
            use.disabled = go.disabled = true;
            var ex = resEx, frame = sel.value === "frame";
            MG.store(result, MG.baseName(it) + "-expanded", false).then(function (r) {
              close();
              var ok = AT.editItems([id], function (x) {
                x.a = r.id; x.iw = r.w; x.ih = r.h;
                x.fit = "fill"; x.ix = 0; x.iy = 0; x.isc = 1;
                delete x.ax.cr;
                if (!frame) {
                  // the frame takes the new shape around the same centre
                  var cy = x.y + x.h / 2;
                  x.h = x.w * ex.H / ex.W;
                  x.y = cy - x.h / 2;
                }
              });
              if (ok) AT.toast(t("mx.done"), t("btn.undo"), AT.undo);
            }, function (e) { stat.textContent = t("mg.fail", { why: MG.why(e) }); use.disabled = go.disabled = false; });
          });
        }, true);
        dlg.addEventListener("close", function () { ctl.abort(); }, { once: true });
      });
    });
  }

  AT.magic.edit = edit;
  AT.magic.expand = expand;
  AT.magicAI = pure;
  void M;
})(typeof window !== "undefined" ? window : this);
