// ============================================================
// orOS Photo Lab — aiedit.js: AI for the Assistant's and Claude's
// commands (PL-AI, v1.0.0)
// Chris 2026-11-22 «δώσε στο Photolab πλήρη δυνατότητες χρήσης AI …
// και τα AI που χρησιμοποιεί και το Atelier, όπως έχει το Photoshop».
// The commands of commands.js with kind "ai" (assist.js runs them here):
//   generate  a picture from words → a new photo layer on top
//   nobg      the picked photo layers' background → their mask (on
//             this device: subject.js, the model Atelier uses too)
//   fill      a box redrawn from words (generative fill) → a new layer
//   expand    the canvas grows and AI draws beyond the edges
//             (generative expand) → a new bottom layer
//   upscale   the whole picture larger: on this device (Real-ESRGAN,
//             enlarge.js) with prov device or when the owner's image AI
//             cannot upscale; with an AI that can (WebUI /
//             Forge) its sharper copy as a top layer
//   image     a picture file from Claude's folders → a new photo layer
// The image AI is the one the owner chose in the Assistant (Settings ›
// Pictures, assistant/imgai.js: AI Horde free, Hugging Face, OpenAI,
// Stability AI, Stable Diffusion WebUI / Forge or ComfyUI on the
// owner's computer), or prov for another one set up there; its key is
// the Assistant's own, read and never written (as Atelier does).
// Requests go straight from this device to that AI with only the
// picture part and the words. Every command is one undo step.
// Exposes PL.aiedit.run(step, notes) → Promise<count>.
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, st = PL.st, C = PL.C, T = PL.T;
  var ASSIST_DB = "oros-assistant", MAX_SIDE = 8192;
  function t(k, p) { return PL.t(k, p); }
  function ver() { var v = (document.querySelector('script[src*="app.js?v="]') || {}).src || "", m = v.match(/[?&]v=([^&#]+)/); return m ? "?v=" + m[1] : ""; }
  function load(f) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = f + ver();
      s.onload = ok; s.onerror = function () { fail(new Error(f)); };
      document.head.appendChild(s);
    });
  }
  var iaP = null;
  function imageAI() {
    if (window.OrosImageAI) return Promise.resolve(window.OrosImageAI);
    if (!iaP) {
      iaP = load("../assistant/imgai.js").then(function () { if (!window.OrosImageAI) throw new Error("imgai"); return window.OrosImageAI; });
      iaP.catch(function () { iaP = null; });
    }
    return iaP;
  }
  // The Assistant's sealed key for a service ("" when none), as Atelier reads it.
  function readKey(pid) {
    return new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(ASSIST_DB); } catch (e) { resolve(""); return; }
      req.onupgradeneeded = function () { try { req.transaction.abort(); } catch (e) {} };
      req.onerror = req.onblocked = function () { resolve(""); };
      req.onsuccess = function () {
        var d = req.result;
        function done(v) { try { d.close(); } catch (e) {} resolve(v); }
        if (!d.objectStoreNames.contains("creds") || !d.objectStoreNames.contains("keys")) { done(""); return; }
        var tx = d.transaction(["creds", "keys"], "readonly"), rc = tx.objectStore("creds").get(pid), rk = tx.objectStore("keys").get("device");
        tx.oncomplete = function () {
          var rec = rc.result, dk = rk.result;
          if (!rec || !dk) { done(""); return; }
          crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, dk, rec.data).then(function (p) { done(new TextDecoder().decode(p)); }, function () { done(""); });
        };
        tx.onerror = tx.onabort = function () { done(""); };
      };
    });
  }
  // The AI for a command → Promise<{ IA, cf, key }>; rejects with a note
  // key ("aiNoKey", "aiNoMask", "aiNone") the Assistant explains.
  function ai(prov, need) {
    return imageAI().then(function (IA) {
      var pref = IA.readPref(), cf;
      if (prov) cf = IA.conf(prov === pref.prov ? pref : { prov: prov });
      else cf = IA.use(pref);
      if (!cf) throw { note: "aiNone" };
      if (need === "mask" && !cf.p.mask) throw { note: "aiNoMask" };
      return (cf.p.keyId ? readKey(cf.p.keyId) : Promise.resolve("")).then(function (key) {
        if (cf.p.key === "yes" && !key) throw { note: "aiNoKey" };
        return { IA: IA, cf: cf, key: key };
      });
    });
  }

  // ---------- pixels ----------
  function canvas(w, h) { var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function blobOf(cv) { return new Promise(function (ok, no) { cv.toBlob(function (b) { if (b) ok(b); else no(new Error("png")); }, "image/png"); }); }
  function b64Of(blob) {
    return new Promise(function (ok, no) { var fr = new FileReader(); fr.onload = function () { ok(String(fr.result)); }; fr.onerror = function () { no(new Error("read")); }; fr.readAsDataURL(blob); });
  }
  function bitmap(blob) { return createImageBitmap(blob); }
  // canvas → a new photo layer at x, y (on top, or at the bottom)
  // ai: "g" (an AI made it) | "e" (an AI redrew part of the picture) |
  // "" (no AI, e.g. a file from Claude's folders); exports say so (AI-MARK).
  function addPixels(cv, x, y, name, label, bottom, ai) {
    var g = cv.getContext("2d"), id = g.getImageData(0, 0, cv.width, cv.height);
    var s = T.create();
    T.writeRect(s, 0, 0, { w: cv.width, h: cv.height, data: id.data });
    // on top of everything (addLayer puts it above the active layer), outside any group
    var top = st.doc.layers[st.doc.layers.length - 1];
    if (top && !bottom) PL.selectLayer(top.id, false);
    var L = PL.addLayer({ k: "raster", name: name, x: Math.round(x), y: Math.round(y), surface: s, g: 0, ai: ai || "" }, label);
    if (L && bottom) {
      PL.docChange(label, function () {
        var i = C.findLayer(st.doc, L.id);
        if (i > 0) { st.doc.layers.splice(i, 1); st.doc.layers.unshift(L); }
      }, []);
    }
    return L ? 1 : 0;
  }
  // A picture drawn to w × h: cover fills it (cropping), contain fits in it.
  function drawFit(src, sw, sh, w, h, fit) {
    var c = canvas(w, h), g = c.getContext("2d"), k = fit === "contain" ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh);
    var dw = sw * k, dh = sh * k;
    g.imageSmoothingQuality = "high";
    g.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return c;
  }

  // The service's frame for a part rw × rh (atelier/magicai.js frameFor).
  function frameFor(pid, rw, rh) {
    var r = rw / rh;
    if (pid === "openai") return r > 1.2 ? { w: 1536, h: 1024 } : r < 0.83 ? { w: 1024, h: 1536 } : { w: 1024, h: 1024 };
    if (pid === "sdwebui" || pid === "comfyui") return r >= 1 ? { w: 1024, h: Math.max(256, Math.round(1024 / r / 64) * 64) } : { w: Math.max(256, Math.round(1024 * r / 64) * 64), h: 1024 };
    return r >= 1 ? { w: 1024, h: Math.max(64, Math.round(1024 / r)) } : { w: Math.max(64, Math.round(1024 * r)), h: 1024 };
  }
  function fitRect(rw, rh, fw, fh) {
    var k = Math.min(fw / rw, fh / rh), w = Math.round(rw * k), h = Math.round(rh * k);
    return { x: Math.round((fw - w) / 2), y: Math.round((fh - h) / 2), w: w, h: h };
  }
  // Redraw `region` of the picture `src` (a canvas of the whole doc):
  // `box` (doc pixels) may change, or, to grow, everything outside
  // `keep`. → Promise<canvas region.w × region.h>
  function redraw(A, prompt, src, region, box, keep, signal) {
    var cf = A.cf, F = frameFor(cf.pid, region.w, region.h), fr = fitRect(region.w, region.h, F.w, F.h);
    var kx = fr.w / region.w, ky = fr.h / region.h;
    var img = canvas(F.w, F.h), g = img.getContext("2d");
    g.filter = "blur(24px)";
    g.drawImage(src, 0, 0, src.width, src.height, 0, 0, F.w, F.h);
    g.filter = "none";
    g.drawImage(src, 0, 0, src.width, src.height, fr.x - region.x * kx, fr.y - region.y * ky, src.width * kx, src.height * ky);
    var ed = canvas(F.w, F.h), eg = ed.getContext("2d");
    eg.fillStyle = "#fff";
    if (keep) {
      eg.fillRect(0, 0, F.w, F.h);
      var inset = Math.max(2, Math.round(Math.min(fr.w, fr.h) / 100));
      eg.clearRect(fr.x + (keep.x - region.x) * kx + inset, fr.y + (keep.y - region.y) * ky + inset, keep.w * kx - 2 * inset, keep.h * ky - 2 * inset);
    } else eg.fillRect(fr.x + (box.x - region.x) * kx, fr.y + (box.y - region.y) * ky, box.w * kx, box.h * ky);
    var oa = canvas(F.w, F.h), og = oa.getContext("2d");
    og.fillStyle = "#000"; og.fillRect(0, 0, F.w, F.h);
    og.globalCompositeOperation = "destination-out"; og.drawImage(ed, 0, 0);
    var bw = canvas(F.w, F.h), bg = bw.getContext("2d");
    bg.fillStyle = "#000"; bg.fillRect(0, 0, F.w, F.h); bg.drawImage(ed, 0, 0);
    return Promise.all([blobOf(img), blobOf(oa), blobOf(bw)]).then(function (b) {
      return Promise.all([b64Of(b[0]), b64Of(b[2])]).then(function (s) {
        return A.IA.run(A.IA.buildEdit(cf, A.key, { prompt: prompt, image: b[0], mask: b[1], maskBw: b[2], imageB64: s[0], maskB64: s[1], w: F.w, h: F.h, n: 1 }), signal);
      });
    }).then(function (list) { return bitmap(list[0]); }).then(function (bmp) {
      var out = canvas(region.w, region.h);
      out.getContext("2d").drawImage(bmp, fr.x * bmp.width / F.w, fr.y * bmp.height / F.h, fr.w * bmp.width / F.w, fr.h * bmp.height / F.h, 0, 0, region.w, region.h);
      return out;
    });
  }
  // only the box of a redrawn part, the rest transparent
  function keepBox(cv, bx, by, bw, bh) {
    var c = canvas(bw, bh);
    c.getContext("2d").drawImage(cv, bx, by, bw, bh, 0, 0, bw, bh);
    return c;
  }

  // ---------- the commands ----------
  function generate(s) {
    var d = st.doc, w = Math.round(s.w || d.w), h = Math.round(s.h || d.h);
    return ai(s.prov, "").then(function (A) {
      var req = A.IA.buildGenerate(A.cf, A.key, { prompt: A.IA.styled(s.prompt, s.style), w: w, h: h, n: 1 });
      return A.IA.run(req);
    }).then(function (list) { return bitmap(list[0]); }).then(function (bmp) {
      var cv = drawFit(bmp, bmp.width, bmp.height, w, h, "cover");
      var x = s.x !== null && s.x !== undefined ? s.x : (d.w - w) / 2, y = s.y !== null && s.y !== undefined ? s.y : (d.h - h) / 2;
      return addPixels(cv, x, y, s.title || t("ai.layerGen"), t("ai.stepGen"), false, "g");
    });
  }
  function fill(s) {
    var d = st.doc;
    var box = { x: Math.max(0, Math.round(s.x)), y: Math.max(0, Math.round(s.y)) };
    box.w = Math.min(d.w - box.x, Math.round(s.w)); box.h = Math.min(d.h - box.y, Math.round(s.h));
    if (box.w < 8 || box.h < 8) return Promise.reject({ note: "aiOutside" });
    var m = Math.max(48, Math.round(Math.max(box.w, box.h) * 0.35));
    var region = { x: Math.max(0, box.x - m), y: Math.max(0, box.y - m) };
    region.w = Math.min(d.w, box.x + box.w + m) - region.x; region.h = Math.min(d.h, box.y + box.h + m) - region.y;
    return ai(s.prov, "mask").then(function (A) {
      return redraw(A, s.prompt, PL.view.flatten(null, 1), region, box, null);
    }).then(function (cv) {
      return addPixels(keepBox(cv, box.x - region.x, box.y - region.y, box.w, box.h), box.x, box.y, t("ai.layerFill"), t("ai.stepFill"), false, "e");
    });
  }
  function expand(s) {
    var d = st.doc, z = window.PhotoLabCommands.aiSize(d, s);
    if (!z) return Promise.resolve(0);
    var A0 = null, before = PL.view.flatten(null, 1), w0 = d.w, h0 = d.h;
    return ai(s.prov, "mask").then(function (A) {
      A0 = A;
      PL.ops.canvasSize(z.w, z.h, s.pos);
      // where the old picture is now (the editor's own anchor rule)
      var ox = /l$/.test(s.pos) || s.pos === "l" ? 0 : /r$/.test(s.pos) || s.pos === "r" ? z.w - w0 : Math.round((z.w - w0) / 2);
      var oy = s.pos.charAt(0) === "t" ? 0 : s.pos.charAt(0) === "b" ? z.h - h0 : Math.round((z.h - h0) / 2);
      var src = canvas(z.w, z.h);
      src.getContext("2d").drawImage(before, ox, oy);
      return redraw(A0, s.prompt || "", src, { x: 0, y: 0, w: z.w, h: z.h }, null, { x: ox, y: oy, w: w0, h: h0 });
    }).then(function (cv) { return addPixels(cv, 0, 0, t("ai.layerExpand"), t("ai.stepExpand"), true, "e") + 1; });
  }
  // PL-UP: on this device (Real-ESRGAN, enlarge.js), one undo step.
  function onDevice(f) {
    return PL.enlargeTool().then(function (E) { return E.run(f); }).then(function (r) { return r.same ? 0 : 1; },
      function () { return Promise.reject({ note: "aiUpFail" }); });
  }
  function upscale(s) {
    var d = st.doc, z = window.PhotoLabCommands.aiSize(d, s);
    if (!z) return Promise.resolve(0);
    var f = z.w / d.w;
    if (s.prov === "device") return onDevice(f);
    return imageAI().then(function (IA) {
      var cf = s.prov ? IA.conf(s.prov === IA.readPref().prov ? IA.readPref() : { prov: s.prov }) : IA.conf(IA.readPref());
      if (!s.prov && !(cf && cf.p.upscale)) return onDevice(f);   // PL-UP: rather than a plain resize
      var src = cf && cf.p.upscale ? PL.view.flatten(null, 1) : null;
      return Promise.resolve(PL.ops.resizeImage(z.w, z.h)).then(function () {
        if (!src) return 1;
        return blobOf(src).then(b64Of).then(function (b64) {
          return IA.run(IA.buildUpscale(cf, { b64: b64, f: f }));
        }).then(function (list) { return bitmap(list[0]); }).then(function (bmp) {
          return 1 + addPixels(drawFit(bmp, bmp.width, bmp.height, z.w, z.h, "cover"), 0, 0, t("ai.layerUp"), t("ai.stepUp"));
        });
      });
    });
  }
  function nobg(s, notes) {
    var list = window.PhotoLabCommands.pick(st.doc, s).map(function (L) { return L.id; }), n = 0, chain = Promise.resolve();
    if (!PL.subject || typeof PL.subject.auto !== "function") return Promise.reject({ note: "aiNoCut" });
    list.forEach(function (id) {
      chain = chain.then(function () {
        if (C.findLayer(st.doc, id) < 0) return;
        PL.selectLayer(id, false);
        return PL.subject.auto(st.doc.layers[C.findLayer(st.doc, id)]).then(function (ok) { if (ok) n++; else if (notes.indexOf("aiLittle") < 0) notes.push("aiLittle"); });
      });
    });
    return chain.then(function () { return n; });
  }
  // Claude's folders, as the gate keeps them
  function inFolders(path) {
    var l = [];
    try { var g = window.parent && window.parent !== window ? window.parent.orosGate : null; l = g && typeof g.folders === "function" ? g.folders() : []; } catch (e) { l = []; }
    return (Array.isArray(l) ? l : []).some(function (f) { return typeof f === "string" && (path === f || path.indexOf(f + "/") === 0); });
  }
  function readPic(path) {
    if (!inFolders(path)) return Promise.reject({ note: "aiOutside" });
    var fs = PL.fs();
    if (!fs) return Promise.reject({ note: "aiNoFile" });
    return Promise.resolve(fs.read(path)).then(function (b) {
      var blob = b instanceof Blob ? b : new Blob([b]);
      if (/\.svg$/i.test(path)) blob = new Blob([blob], { type: "image/svg+xml" });
      return PL.io.source(blob);
    }, function () { throw { note: "aiNoFile" }; });
  }
  function image(s) {
    var d = st.doc;
    return readPic(s.path).then(function (src) {
      var w = Math.round(s.w || (s.fit ? d.w : src.w)), h = Math.round(s.h || (s.fit ? d.h : src.h));
      if (!s.w && !s.h && !s.fit) { var k = Math.min(1, MAX_SIDE / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k); }
      var cv = s.fit || s.w || s.h ? drawFit(src.src, src.w, src.h, w, h, s.fit || "contain") : drawFit(src.src, src.w, src.h, w, h, "cover");
      var x = s.x !== null && s.x !== undefined ? s.x : (d.w - w) / 2, y = s.y !== null && s.y !== undefined ? s.y : (d.h - h) / 2;
      return addPixels(cv, x, y, s.title || s.path.split("/").pop().replace(/\.[^.]+$/, ""), t("ai.stepImage"));
    });
  }
  // a NEW project from a picture file in Claude's folders
  function create(s) {
    if (!inFolders(s.from)) return Promise.reject({ note: "aiOutside" });
    var was = st.doc ? st.doc.id : "";
    return PL.io.openDiskPath(s.from).then(function () {
      if (!st.doc || st.doc.id === was) throw { note: "aiNoFile" };
      if (s.title) { var nm = s.title; PL.docChange(t("as.step"), function () { st.doc.name = nm; }, []); }
      return PL.saveNow().then(function () { return { id: st.doc.id, name: st.doc.name }; });
    });
  }

  var RUN = { generate: generate, fill: fill, expand: expand, upscale: upscale, nobg: nobg, image: image };
  function run(s, notes) {
    var f = RUN[s.op];
    if (!f) return Promise.resolve(0);
    return f(s, notes).then(function (n) { return n || 0; }, function (e) {
      var k = e && e.note ? e.note : e && e.code ? "aiErr." + e.code : "aiFail";
      if (notes.indexOf(k) < 0) notes.push(k);
      try { if (!(e && e.note)) console.warn("[orOS] photolab AI", s.op, e); } catch (x) {}
      return 0;
    });
  }

  PL.aiedit = { run: run, create: create, readKey: readKey, frameFor: frameFor, fitRect: fitRect };
})();
