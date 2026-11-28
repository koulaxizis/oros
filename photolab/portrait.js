// ============================================================
// orOS Photo Lab — portrait.js: Portrait blur and Select by depth
// (PB, v1.0.0)
// Chris 2026-11-27: background blur like a phone's portrait mode, on
// the device. The depth model Depth Anything V2 Small (Apache-2.0;
// only Small is, Base/Large are non-commercial and never used) runs in
// ONNX Runtime Web (vendor/ort, MIT) through Atelier's loader
// atelier/cutout.js, so the runtime is shared with Remove background.
//   - the model (about 27 MB) comes from the orOS model mirror
//     koulaxizis/oros-models-vision (GitHub Pages), only when the
//     person asks, and is kept only when its SHA-256 matches; it lives
//     in the IndexedDB "oros-atelier-ai" (never synced, never in the
//     service worker's caches), so it works offline from then on
//   - Filter › Portrait blur…: tap what stays sharp; the result is a
//     new top layer with a layer mask (white = blurred), one undo step
//   - Select › By depth…: near (or far) parts become the selection
//   - the Assistant's and Claude's "portrait" command (aiedit.js)
// The same file is the blur's worker (no document there) and, in node,
// the pure steps for the unit tests.
// ============================================================
(function (root) {
  "use strict";

  // ---------- The model ----------
  var MIRROR = "https://koulaxizis.github.io/oros-models-vision/";
  var MODEL = {
    url: MIRROR + "depth-anything-v2-small/onnx/model_quantized.onnx",
    sha: "fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d",
    size: 27258801
  };
  var APPROX_MB = 27, RUNTIME_MB = 12;              // the model; ONNX Runtime (shared with Remove background)
  var SIDE = 518, PATCH = 14, MAX_LONG = 1036;      // the model's input (DPTImageProcessor)
  var MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
  var GRID = 1024;                                   // depth and focus are worked out at most this big
  var LEVELS = 6;                                    // blur levels (0 = sharp)

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1); return t * t * (3 - 2 * t); }

  // ---------- Pure steps ----------
  // The model's input size for a w × h picture: the short side 518, the
  // aspect kept, both sides multiples of 14, the long side at most 1036.
  function inputSize(w, h) {
    var k = SIDE / Math.min(w, h);
    var lw = Math.min(MAX_LONG, w * k), lh = Math.min(MAX_LONG, h * k);
    if (w >= h) lh = lw * h / w; else lw = lh * w / h;
    return { w: Math.max(PATCH, Math.round(lw / PATCH) * PATCH), h: Math.max(PATCH, Math.round(lh / PATCH) * PATCH) };
  }
  // RGBA already at the input size → Float32Array CHW, ImageNet normalised.
  function prep(rgba, w, h) {
    var n = w * h, out = new Float32Array(3 * n);
    for (var i = 0; i < n; i++) {
      for (var c = 0; c < 3; c++) out[c * n + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
    }
    return out;
  }
  // The model's relative inverse depth → 0 (far) .. 1 (near), stretched
  // between its 1st and 99th percentile (a few odd values do not decide).
  function normDepth(pred) {
    var n = pred.length, s = Array.prototype.slice.call(pred).sort(function (a, b) { return a - b; });
    var lo = s[Math.floor((n - 1) * 0.01)], hi = s[Math.ceil((n - 1) * 0.99)], span = hi - lo || 1;
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) out[i] = clamp((pred[i] - lo) / span, 0, 1);
    return out;
  }
  // Bilinear resize of one float plane.
  function resizeF(src, sw, sh, dw, dh) {
    var out = new Float32Array(dw * dh);
    for (var y = 0; y < dh; y++) {
      var sy = clamp((y + 0.5) * sh / dh - 0.5, 0, sh - 1), y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), fy = sy - y0;
      for (var x = 0; x < dw; x++) {
        var sx = clamp((x + 0.5) * sw / dw - 0.5, 0, sw - 1), x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), fx = sx - x0;
        out[y * dw + x] = (src[y0 * sw + x0] * (1 - fx) + src[y0 * sw + x1] * fx) * (1 - fy) + (src[y1 * sw + x0] * (1 - fx) + src[y1 * sw + x1] * fx) * fy;
      }
    }
    return out;
  }
  // The mean over a (2r + 1)² box (edges: only the part inside counts).
  function boxMean(a, w, h, r) {
    if (r < 1) return Float32Array.from(a);
    var ii = new Float64Array((w + 1) * (h + 1)), x, y;
    for (y = 0; y < h; y++) {
      var row = 0;
      for (x = 0; x < w; x++) { row += a[y * w + x]; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row; }
    }
    var out = new Float32Array(w * h);
    for (y = 0; y < h; y++) {
      var ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
        out[y * w + x] = (ii[yb * (w + 1) + xb] - ii[ya * (w + 1) + xb] - ii[yb * (w + 1) + xa] + ii[ya * (w + 1) + xa]) / ((yb - ya) * (xb - xa));
      }
    }
    return out;
  }
  // RGBA → brightness 0..1.
  function grayOf(rgba, n) {
    var g = new Float32Array(n);
    for (var i = 0; i < n; i++) g[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
    return g;
  }
  // Guided filter (He, Sun, Tang 2010): p smoothed so that its edges
  // follow the guide I (the photo), so the coarse depth lines up with
  // hair, shoulders and the edges of things.
  function guided(I, p, w, h, r, eps) {
    var n = w * h, Ip = new Float32Array(n), II = new Float32Array(n), i;
    for (i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
    var mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r), mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r);
    var a = new Float32Array(n), b = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var cov = mIp[i] - mI[i] * mp[i], v = mII[i] - mI[i] * mI[i];
      a[i] = cov / (v + eps); b[i] = mp[i] - a[i] * mI[i];
    }
    var ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r), out = new Float32Array(n);
    for (i = 0; i < n; i++) out[i] = clamp(ma[i] * I[i] + mb[i], 0, 1);
    return out;
  }
  // Otsu's threshold of values 0..1 (256 bins): where the near part
  // (the foreground) starts.
  function otsu(v) {
    var hist = new Float64Array(256), n = v.length, i, sum = 0;
    for (i = 0; i < n; i++) hist[Math.min(255, Math.floor(v[i] * 256))]++;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var wB = 0, sB = 0, best = -1, th = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sB += i * hist[i];
      var mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; th = i; }
    }
    return (th + 1) / 256;
  }
  function pct(list, q) { list.sort(function (a, b) { return a - b; }); return list[Math.floor((list.length - 1) * q)]; }
  // The depth from which everything nearer stays sharp, as a phone's
  // portrait mode keeps the whole person: the back of the subject (when
  // its mask is known), else the back of the near part of the picture.
  function autoFocus(depth, subj) {
    var i, n = depth.length, l = [];
    if (subj) {
      for (i = 0; i < n; i++) if (subj[i] > 0.5) l.push(depth[i]);
      if (l.length > n * 0.01) return pct(l, 0.1);
      l = [];
    }
    var th = otsu(depth);
    for (i = 0; i < n; i++) if (depth[i] >= th) l.push(depth[i]);
    return l.length ? pct(l, 0.15) : th;
  }
  // The subject model sometimes takes part of the background too (a
  // dark room, a table): only the subject's near part counts, so the
  // mask never keeps a far area sharp.
  function nearSubject(subj, depth) {
    if (!subj) return null;
    var th = otsu(depth), out = new Float32Array(subj.length);
    for (var i = 0; i < subj.length; i++) out[i] = subj[i] * smooth(th - 0.08, th + 0.02, depth[i]);
    return out;
  }
  // The depth around a point of the grid (a 5 × 5 average).
  function depthAt(depth, w, h, x, y) {
    var s = 0, c = 0;
    for (var j = -2; j <= 2; j++) for (var i = -2; i <= 2; i++) {
      var xx = clamp(Math.round(x) + i, 0, w - 1), yy = clamp(Math.round(y) + j, 0, h - 1);
      s += depth[yy * w + xx]; c++;
    }
    return s / c;
  }
  // The blur radius of every grid point, in picture pixels:
  //   R      the largest radius
  //   focus  the depth from which nearer stays sharp, dof how much
  //          farther still stays sharp (0..0.5)
  //   soft   how many grid points the change from sharp to blurred takes
  //   subj   the subject's mask (0..1), kept sharp, or null
  function cocMap(depth, w, h, o) {
    var n = w * h, c = new Float32Array(n), dof = clamp(o.dof || 0, 0, 0.5), i;
    for (i = 0; i < n; i++) {
      // only what is farther than the focus is blurred
      var t = clamp((o.focus - depth[i] - dof) / 0.3, 0, 1);
      c[i] = o.R * t;
    }
    if (o.soft >= 1) c = boxMean(c, w, h, Math.round(o.soft));
    if (o.subj) for (i = 0; i < n; i++) c[i] *= 1 - o.subj[i];
    return c;
  }
  // A selection 0..255 from the depth: near parts (or far ones) inside,
  // with a soft edge. at 0..1 (0 = only the nearest), soft 0..0.5.
  function depthSel(depth, at, soft, far) {
    var n = depth.length, out = new Uint8ClampedArray(n), th = 1 - clamp(at, 0, 1), s = Math.max(0.005, soft);
    for (var i = 0; i < n; i++) {
      var v = smooth(th - s, th + s, depth[i]);
      out[i] = Math.round((far ? 1 - v : v) * 255);
    }
    return out;
  }

  // Disc (lens) blur of premultiplied planes, radius r (row prefix sums).
  function disc(planes, w, h, r) {
    if (r < 1) return planes;
    var span = [], k;
    for (k = -r; k <= r; k++) span.push(Math.floor(Math.sqrt(r * r - k * k) + 0.5));
    return planes.map(function (p) {
      var pre = new Float64Array((w + 1) * h), out = new Float32Array(w * h), x, y;
      for (y = 0; y < h; y++) { var rb = y * (w + 1); for (x = 0; x < w; x++) pre[rb + x + 1] = pre[rb + x] + p[y * w + x]; }
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          var s = 0, n = 0;
          for (var j = -r; j <= r; j++) {
            var yy = clamp(y + j, 0, h - 1), sp = span[j + r], a = Math.max(0, x - sp), b = Math.min(w - 1, x + sp), rb2 = yy * (w + 1);
            s += pre[rb2 + b + 1] - pre[rb2 + a]; n += b - a + 1;
          }
          out[y * w + x] = s / n;
        }
      }
      return out;
    });
  }
  // The blur radius at picture pixel (x, y): bilinear from the grid.
  function cocAt(o, x, y) {
    var gx = clamp((x + 0.5) * o.gw / o.w - 0.5, 0, o.gw - 1), gy = clamp((y + 0.5) * o.gh / o.h - 0.5, 0, o.gh - 1);
    var x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(o.gw - 1, x0 + 1), y1 = Math.min(o.gh - 1, y0 + 1), fx = gx - x0, fy = gy - y0, c = o.coc;
    return (c[y0 * o.gw + x0] * (1 - fx) + c[y0 * o.gw + x1] * fx) * (1 - fy) + (c[y1 * o.gw + x0] * (1 - fx) + c[y1 * o.gw + x1] * fx) * fy;
  }
  // The portrait blur. o: { img {w, h, data RGBA}, coc (gw × gh, radius
  // in img pixels), gw, gh, R, bokeh }. → { img {w, h, data}, mask
  // Uint8 (w × h, 255 = blurred) }: the img is blurred at least R / 2
  // everywhere, the mask mixes it with the sharp picture, so painting
  // the mask white blurs more and black keeps sharp.
  function render(o) {
    var W = o.img.w, H = o.img.h, src = o.img.data, R = Math.max(0, o.R), N = W * H;
    var out = new Uint8ClampedArray(N * 4), mask = new Uint8ClampedArray(N);
    var g = { w: W, h: H, gw: o.gw, gh: o.gh, coc: o.coc }, x, y, i, k, c;
    if (R < 0.5) { out.set(src); return { img: { w: W, h: H, data: out }, mask: mask }; }
    var cf = new Float32Array(N);                       // the radius of every pixel
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) cf[y * W + x] = cocAt(g, x, y);
    var Rm = R / 2, lv = [null];
    for (k = 1; k < LEVELS; k++) {
      var rk = R * k / (LEVELS - 1), q = Math.max(1, rk / 4), sw = Math.max(1, Math.ceil(W / q)), sh = Math.max(1, Math.ceil(H / q));
      // area-downscaled, premultiplied by alpha and by a weight: a pixel
      // that stays sharper than this level adds little, so the subject
      // never smears into the blurred background around it
      var pr = new Float32Array(sw * sh), pg = new Float32Array(sw * sh), pb = new Float32Array(sw * sh), pa = new Float32Array(sw * sh), pw = new Float32Array(sw * sh);
      for (y = 0; y < H; y++) {
        var sy = Math.min(sh - 1, Math.floor(y / q)) * sw;
        for (x = 0; x < W; x++) {
          i = y * W + x;
          var si = sy + Math.min(sw - 1, Math.floor(x / q)), j = i * 4, wgt = 0.02 + Math.min(1, cf[i] / rk), f = wgt * src[j + 3] / 255, fb = f;
          if (o.bokeh) fb = f * (1 + 3 * smooth(0.8, 1, (0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2]) / 255));
          pr[si] += src[j] * fb; pg[si] += src[j + 1] * fb; pb[si] += src[j + 2] * fb; pa[si] += f; pw[si] += wgt;
        }
      }
      var bl = disc([pr, pg, pb, pa, pw], sw, sh, Math.max(1, Math.round(rk / q)));
      // to straight RGBA once (alpha 0..255)
      var L = { q: q, w: sw, h: sh, r: bl[0], g: bl[1], b: bl[2], a: bl[3] };
      for (i = 0; i < sw * sh; i++) {
        var A = bl[3][i];
        if (A > 1e-6) { L.r[i] /= A; L.g[i] /= A; L.b[i] /= A; L.a[i] = A / (bl[4][i] || 1e-6) * 255; }
        else { L.r[i] = L.g[i] = L.b[i] = 0; L.a[i] = 0; }
      }
      lv.push(L);
    }
    var px = [0, 0, 0, 0], py = [0, 0, 0, 0];
    // level k at (x, y), bilinear, into the 4-array dst
    function at(k, x, y, j, dst) {
      if (k === 0) { dst[0] = src[j]; dst[1] = src[j + 1]; dst[2] = src[j + 2]; dst[3] = src[j + 3]; return; }
      var L = lv[k], sx = clamp((x + 0.5) / L.q - 0.5, 0, L.w - 1), sy = clamp((y + 0.5) / L.q - 0.5, 0, L.h - 1);
      var x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(L.w - 1, x0 + 1), y1 = Math.min(L.h - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
      var i00 = y0 * L.w + x0, i01 = y0 * L.w + x1, i10 = y1 * L.w + x0, i11 = y1 * L.w + x1;
      var w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
      dst[0] = L.r[i00] * w00 + L.r[i01] * w01 + L.r[i10] * w10 + L.r[i11] * w11;
      dst[1] = L.g[i00] * w00 + L.g[i01] * w01 + L.g[i10] * w10 + L.g[i11] * w11;
      dst[2] = L.b[i00] * w00 + L.b[i01] * w01 + L.b[i10] * w10 + L.b[i11] * w11;
      dst[3] = L.a[i00] * w00 + L.a[i01] * w01 + L.a[i10] * w10 + L.a[i11] * w11;
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        var j2 = i * 4, c0 = cf[i], c1 = Math.max(c0, Rm);
        var u = clamp(c1 / R * (LEVELS - 1), 0, LEVELS - 1), k0 = Math.floor(u), k1 = Math.min(LEVELS - 1, k0 + 1), fu = u - k0;
        at(k0, x, y, j2, px);
        if (fu > 0) { at(k1, x, y, j2, py); for (c = 0; c < 4; c++) out[j2 + c] = px[c] * (1 - fu) + py[c] * fu; }
        else for (c = 0; c < 4; c++) out[j2 + c] = px[c];
        mask[i] = Math.round(clamp(c0 / Rm, 0, 1) * 255);
      }
    }
    return { img: { w: W, h: H, data: out }, mask: mask };
  }

  var pure = {
    MODEL: MODEL, APPROX_MB: APPROX_MB, inputSize: inputSize, prep: prep, normDepth: normDepth, resizeF: resizeF,
    boxMean: boxMean, grayOf: grayOf, guided: guided, otsu: otsu, nearSubject: nearSubject, autoFocus: autoFocus, depthAt: depthAt, cocMap: cocMap,
    depthSel: depthSel, disc: disc, render: render
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  // ---------- The worker ----------
  if (typeof document === "undefined") {
    root.onmessage = function (e) {
      var m = e.data || {};
      try {
        var r = render(m.a);
        root.postMessage({ id: m.id, ok: true, r: r }, [r.img.data.buffer, r.mask.buffer]);
      } catch (err) { root.postMessage({ id: m.id, ok: false, e: String(err && err.message || "render") }); }
    };
    return;
  }

  // ---------- In Photo Lab ----------
  var PL = window.PL, C = PL.C, T = PL.T, S = PL.S, st = PL.st, el = PL.el;
  function t(k, p) { return PL.t(k, p); }
  function ver() { var v = (document.querySelector('script[src*="app.js?v="]') || {}).src || "", m = v.match(/[?&]v=([^&#]+)/); return m ? "?v=" + m[1] : ""; }

  // the blur off the main thread (the same render on it when no worker)
  var wk = null, wkBroken = false, seq = 0, waiting = {};
  function renderJob(a) {
    if (!wk && !wkBroken) {
      try {
        wk = new Worker("portrait.js" + ver());
        wk.onmessage = function (e) { var m = e.data || {}, w = waiting[m.id]; if (!w) return; delete waiting[m.id]; if (m.ok) w.ok(m.r); else w.fail(new Error(m.e)); };
        wk.onerror = function () { wkBroken = true; wk = null; Object.keys(waiting).forEach(function (id) { var w = waiting[id]; delete waiting[id]; w.local(); }); };
      } catch (e) { wkBroken = true; wk = null; }
    }
    function local() { return new Promise(function (ok, fail) { setTimeout(function () { try { ok(render(a)); } catch (e) { fail(e); } }, 16); }); }
    if (!wk) return local();
    return new Promise(function (ok, fail) {
      var id = ++seq;
      waiting[id] = { ok: ok, fail: fail, local: function () { local().then(ok, fail); } };
      try { wk.postMessage({ id: id, a: a }); } catch (e) { delete waiting[id]; local().then(ok, fail); }
    });
  }

  // ---------- The model file: mirror → SHA-256 → IndexedDB ----------
  var DB = "oros-atelier-ai", KEY = "depth", VER = "dav2s-" + MODEL.sha.slice(0, 16);
  function idb(mode, fn) {
    return new Promise(function (ok, fail) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files"); };
      req.onerror = function () { fail(req.error); };
      req.onblocked = function () { fail(new Error("blocked")); };
      req.onsuccess = function () {
        var d = req.result, tx = d.transaction("files", mode), r = fn(tx.objectStore("files")), res;
        if (r) r.onsuccess = function () { res = r.result; };
        tx.oncomplete = function () { d.close(); ok(res); };
        tx.onerror = tx.onabort = function () { d.close(); fail(tx.error || new Error("idb")); };
      };
    });
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }
  function haveModel() {
    return idb("readonly", function (s) { return s.get(KEY); }).then(function (r) { return !!(r && r.v === VER && r.blob instanceof Blob); }, function () { return false; });
  }
  function fetchModel(onProgress, signal) {
    return fetch(MODEL.url, { cache: "no-cache", signal: signal }).then(function (res) {
      if (!res.ok) throw new Error("http " + res.status);
      if (!res.body || !res.body.getReader) return res.arrayBuffer();
      var rd = res.body.getReader(), parts = [], got = 0;
      function pump() {
        return rd.read().then(function (r) {
          if (r.done) return new Blob(parts).arrayBuffer();
          parts.push(r.value); got += r.value.byteLength;
          if (onProgress) onProgress(Math.min(0.99, got / MODEL.size));
          return pump();
        });
      }
      return pump();
    }).then(function (buf) {
      return crypto.subtle.digest("SHA-256", buf).then(function (d) {
        if (hex(d) !== MODEL.sha) throw new Error(t("pb.badFile"));
        var blob = new Blob([buf]);
        // kept only here: the runtime loader below reads it from IndexedDB
        // (it would otherwise fetch the file again, unchecked)
        return idb("readwrite", function (s) { s.put({ v: VER, blob: blob }, KEY); }).then(function () { return blob; });
      });
    });
  }
  // → the ONNX session (runtime through cutout.js, model checked first)
  var sessP = null;
  function session(CUT, onProgress, signal) {
    if (sessP) return sessP;
    sessP = haveModel().then(function (have) {
      if (have) return;
      // the runtime first (shared, same origin), then the model
      return fetchModel(onProgress, signal);
    }).then(function () {
      var spec = CUT.list({ js: CUT.FILES.js, mjs: CUT.FILES.mjs, wasm: CUT.FILES.wasm }, CUT.FILES_VER);
      spec[KEY] = { url: MODEL.url, v: VER };
      return CUT.sessionOf(spec, KEY, RUNTIME_MB, onProgress, signal);
    });
    sessP.catch(function () { sessP = null; });
    return sessP;
  }
  // → how many MB a first use downloads (0: everything is here)
  function needMb(CUT) {
    return Promise.all([haveModel(), CUT.readyOf(CUT.list({ js: CUT.FILES.js, mjs: CUT.FILES.mjs, wasm: CUT.FILES.wasm }, CUT.FILES_VER))])
      .then(function (l) { return (l[0] ? 0 : APPROX_MB) + (l[1] ? 0 : RUNTIME_MB); }, function () { return APPROX_MB + RUNTIME_MB; });
  }

  // ---------- Depth of the visible picture ----------
  // → { gw, gh, depth (0 far .. 1 near), subj (or null), cv (the grid's picture) }
  function analyse(CUT, opts) {
    var d = st.doc, k = Math.min(1, GRID / Math.max(d.w, d.h)), cv = PL.view.flatten(null, k);
    var gw = cv.width, gh = cv.height;
    return session(CUT, opts.onProgress, opts.signal).then(function (sess) {
      if (opts.signal && opts.signal.aborted) throw new Error("abort");
      if (opts.onRun) opts.onRun();
      return new Promise(function (r) { setTimeout(r, 30); }).then(function () {
        var z = inputSize(gw, gh), c2 = document.createElement("canvas");
        c2.width = z.w; c2.height = z.h;
        var g2 = c2.getContext("2d", { willReadFrequently: true });
        g2.imageSmoothingQuality = "high";
        g2.drawImage(cv, 0, 0, z.w, z.h);
        var feeds = {};
        feeds[sess.inputNames[0]] = new window.ort.Tensor("float32", prep(g2.getImageData(0, 0, z.w, z.h).data, z.w, z.h), [1, 3, z.h, z.w]);
        return sess.run(feeds).then(function (out) {
          var o = out[sess.outputNames[0]], dims = o.dims, mh = dims[dims.length - 2], mw = dims[dims.length - 1];
          var px = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, gw, gh).data;
          var gray = grayOf(px, gw * gh), raw = resizeF(normDepth(o.data), mw, mh, gw, gh);
          var depth = guided(gray, raw, gw, gh, Math.max(2, Math.round(Math.max(gw, gh) / 64)), 1e-3);
          return subjectOf(CUT, cv, gw, gh).then(function (subj) { return { gw: gw, gh: gh, depth: depth, subj: nearSubject(subj, depth), cv: cv }; });
        });
      });
    });
  }
  // The subject's mask on the grid, only when Remove background's files
  // are already here (no second download for this tool).
  function subjectOf(CUT, cv, gw, gh) {
    return CUT.ready().then(function (have) {
      if (!have) return null;
      return CUT.cut(cv, {}).then(function (r) {
        var a = CUT.alphaFor(r.mask, CUT.S, gw, gh, CUT.LO, Math.min(1, CUT.LO + 0.76)), s = new Float32Array(gw * gh);
        for (var i = 0; i < s.length; i++) s[i] = a[i] / 255;
        return s;
      });
    }).catch(function () { return null; });
  }

  // settings → the blur radius per grid point, for a picture of side `long`
  function cocFor(D, p, long) {
    return cocMap(D.depth, D.gw, D.gh, {
      R: p.amt / 100 * 0.04 * long, focus: p.focus, dof: p.dof / 100 * 0.4,
      soft: p.soft / 100 * Math.max(D.gw, D.gh) * 0.02, subj: p.guard ? D.subj : null
    });
  }
  function imgOf(cv) { var g = cv.getContext("2d", { willReadFrequently: true }), d = g.getImageData(0, 0, cv.width, cv.height); return { w: cv.width, h: cv.height, data: d.data }; }
  function canvasOf(img) { var c = document.createElement("canvas"); c.width = img.w; c.height = img.h; c.getContext("2d").putImageData(new ImageData(img.data, img.w, img.h), 0, 0); return c; }

  // The new top layer: the blurred picture with its mask.
  function addResult(res, d) {
    var s = T.create(), m = T.create(), mk = { w: d.w, h: d.h, data: new Uint8ClampedArray(d.w * d.h * 4) };
    T.writeRect(s, 0, 0, res.img);
    for (var i = 0; i < res.mask.length; i++) { var j = i * 4; mk.data[j] = mk.data[j + 1] = mk.data[j + 2] = 255; mk.data[j + 3] = res.mask[i]; }
    T.writeRect(m, 0, 0, mk);
    var top = st.doc.layers[st.doc.layers.length - 1];
    if (top) PL.selectLayer(top.id, false);
    return PL.addLayer({ k: "raster", name: t("pb.layer"), x: 0, y: 0, surface: s, g: 0, mk: { id: C.newLayerId(), t: {}, on: 1, bg: 0 }, maskSurface: m }, t("pb.step"));
  }
  // The whole picture at full size → the new layer. → Promise<layer|null>
  function applyFull(D, p) {
    var d = st.doc, img = imgOf(PL.view.flatten(null, 1)), long = Math.max(d.w, d.h);
    return renderJob({ img: img, coc: cocFor(D, p, long), gw: D.gw, gh: D.gh, R: p.amt / 100 * 0.04 * long, bokeh: !!p.bokeh }).then(function (res) {
      if (st.doc !== d) return null;
      return addResult(res, d);
    });
  }

  function loadCut() {
    if (window.AtelierCutout) return Promise.resolve(window.AtelierCutout);
    return PL.subject.loader();
  }

  // ---------- Filter › Portrait blur… / Select › By depth… ----------
  // kind: "blur" | "select"
  function run(kind) {
    if (!st.doc) return;
    PL.busy(true);
    loadCut().then(function (CUT) {
      return needMb(CUT).then(function (mb) { PL.busy(false); dialog(kind, CUT, mb); });
    }, function () { PL.busy(false); PL.toast(t("pb.fail", { why: t("subject.noLoader") })); });
  }

  function dialog(kind, CUT, mb) {
    var d = st.doc, ctl = typeof AbortController === "function" ? new AbortController() : null;
    var have = !mb, D = null, working = false, pend = 0, busyPrev = false, again = false;
    var p = { amt: 50, dof: 10, soft: 30, bokeh: false, focus: 0.5, guard: true };
    var sp = { at: 40, soft: 10, far: false };
    var need = el("p", "hint", t("pb.need", { mb: mb })); need.hidden = have;
    var about = el("p", "hint", t(kind === "blur" ? "pb.about" : "pb.aboutSel"));
    var stage = el("div", "subj-stage pb-stage"); stage.hidden = true;
    var view = document.createElement("canvas"); view.className = "subj-img pb-view";
    stage.appendChild(view);
    var tapHint = el("p", "hint", t(kind === "blur" ? "pb.tap" : "pb.tapSel")); tapHint.hidden = true;
    var ctrls = el("div", "pb-ctrls"); ctrls.hidden = true;
    function rng(lbl, obj, key, lo, hi) { ctrls.appendChild(PL.ui.range(lbl, obj[key], lo, hi, function (x) { obj[key] = x; schedule(); })); }
    var showDepth = PL.ui.check(t("pb.showDepth"), false);
    showDepth.input.addEventListener("change", schedule);
    if (kind === "blur") {
      rng(t("pb.amt"), p, "amt", 1, 100); rng(t("pb.dof"), p, "dof", 0, 100); rng(t("pb.soft"), p, "soft", 0, 100);
      var bok = PL.ui.check(t("pb.bokeh"), false);
      bok.input.addEventListener("change", function () { p.bokeh = bok.input.checked; schedule(); });
      ctrls.appendChild(bok);
    } else {
      rng(t("pb.selAt"), sp, "at", 0, 100); rng(t("pb.soft"), sp, "soft", 0, 50);
      var far = PL.ui.check(t("pb.far"), false);
      far.input.addEventListener("change", function () { sp.far = far.input.checked; schedule(); });
      ctrls.appendChild(far);
    }
    ctrls.appendChild(showDepth);
    var stat = el("p", "hint subj-stat"); stat.setAttribute("aria-live", "polite");
    var dlg = PL.dialog({
      title: t(kind === "blur" ? "dlg.portrait" : "dlg.byDepth"),
      ok: t(have ? "pb.find" : "pb.download"),
      body: [about, need, stage, tapHint, ctrls, stat],
      onOk: function () {
        if (working) return false;
        if (!D) { start(); return false; }
        apply();
        return true;
      },
      onCancel: function () { if (ctl) ctl.abort(); }
    });
    // tap on the preview: that depth stays sharp (blur) / is the edge (select)
    view.addEventListener("click", function (e) {
      if (!D) return;
      var b = view.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * D.gw, y = (e.clientY - b.top) / b.height * D.gh;
      var z = depthAt(D.depth, D.gw, D.gh, x, y);
      if (kind === "blur") {
        p.focus = z;
        p.guard = !!(D.subj && D.subj[clamp(Math.round(y), 0, D.gh - 1) * D.gw + clamp(Math.round(x), 0, D.gw - 1)] > 0.5);
      } else {
        sp.at = Math.round((1 - z) * 100);
        var r = ctrls.querySelector("input[type=range]");
        if (r) { r.value = String(sp.at); r.dispatchEvent(new Event("input")); }
      }
      schedule();
    });
    function schedule() { if (D && !pend) pend = requestAnimationFrame(function () { pend = 0; preview(); }); }
    function preview() {
      if (busyPrev) { again = true; return; }
      var k = Math.min(1, 720 / Math.max(D.gw, D.gh)), pw = Math.max(1, Math.round(D.gw * k)), ph = Math.max(1, Math.round(D.gh * k));
      if (view.width !== pw || view.height !== ph) { view.width = pw; view.height = ph; }
      var g = view.getContext("2d");
      if (showDepth.input.checked) {
        var dv = resizeF(D.depth, D.gw, D.gh, pw, ph), id = g.createImageData(pw, ph);
        for (var i = 0; i < dv.length; i++) { var v = Math.round(dv[i] * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
        g.putImageData(id, 0, 0);
        return;
      }
      if (kind === "select") {
        g.drawImage(D.cv, 0, 0, pw, ph);
        var sel = depthSel(resizeF(D.depth, D.gw, D.gh, pw, ph), sp.at / 100, sp.soft / 100, sp.far), im = g.getImageData(0, 0, pw, ph);
        for (var j = 0; j < sel.length; j++) {
          var a = (255 - sel[j]) / 255 * 0.7;        // outside the selection: darkened
          im.data[j * 4] *= 1 - a; im.data[j * 4 + 1] *= 1 - a; im.data[j * 4 + 2] *= 1 - a;
        }
        g.putImageData(im, 0, 0);
        return;
      }
      busyPrev = true;
      g.drawImage(D.cv, 0, 0, pw, ph);
      var img = imgOf(view);
      renderJob({ img: img, coc: cocFor(D, p, pw > ph ? pw : ph), gw: D.gw, gh: D.gh, R: p.amt / 100 * 0.04 * Math.max(pw, ph), bokeh: p.bokeh }).then(function (res) {
        busyPrev = false;
        // the preview shows the layer as it will look: the mask mixes it in
        var out = res.img.data, src = img.data;
        for (var i = 0; i < res.mask.length; i++) {
          var a = res.mask[i] / 255, j = i * 4;
          for (var c = 0; c < 4; c++) out[j + c] = src[j + c] * (1 - a) + out[j + c] * a;
        }
        g.putImageData(new ImageData(out, pw, ph), 0, 0);
        if (again) { again = false; preview(); }
      }, function () { busyPrev = false; });
    }
    function start() {
      working = true; dlg.ok.disabled = true;
      stat.textContent = have ? t("pb.run") : t("subject.load", { p: 0 });
      analyse(CUT, {
        signal: ctl ? ctl.signal : undefined,
        onProgress: function (x) { stat.textContent = t("subject.load", { p: Math.round(x * 100) }); },
        onRun: function () { stat.textContent = t("pb.run"); }
      }).then(function (r) {
        working = false;
        if (ctl && ctl.signal.aborted) return;
        D = r; have = true; need.hidden = true;
        p.focus = autoFocus(D.depth, D.subj); p.guard = !!D.subj;
        if (kind === "select") {
          // start at the back of the near part (the person)
          sp.at = Math.round((1 - p.focus) * 100 + 2);
          var r0 = ctrls.querySelector("input[type=range]");
          if (r0) { r0.value = String(sp.at); r0.dispatchEvent(new Event("input")); }
        }
        stage.hidden = false; ctrls.hidden = false; tapHint.hidden = false;
        stat.textContent = "";
        preview();
        dlg.ok.textContent = t("btn.apply"); dlg.ok.disabled = false;
      }, function (e) {
        working = false;
        if (ctl && ctl.signal.aborted) return;
        stat.textContent = t("pb.fail", { why: String(e && e.message || e).slice(0, 120) });
        dlg.ok.disabled = false;
      });
    }
    function apply() {
      if (st.doc !== d) return;
      if (kind === "select") {
        var a = depthSel(resizeF(D.depth, D.gw, D.gh, d.w, d.h), sp.at / 100, sp.soft / 100, sp.far), m = S.make(d.w, d.h);
        m.data.set(a);
        PL.setSel(S.isEmpty(m) ? null : m, t("pb.stepSel"));
        PL.toast(t(st.sel ? "pb.selDone" : "pb.selNone"));
        return;
      }
      PL.busy(true);
      applyFull(D, p).then(function (L) {
        PL.busy(false);
        if (L) PL.toast(t("pb.done"));
      }, function () { PL.busy(false); PL.toast(t("msg.failed")); });
    }
    if (have) start();
  }

  // PL-AI: the Assistant's and Claude's "portrait": amt 1-100, focus
  // "near" (the subject / nearest part) → Promise<true | false>.
  function auto(s) {
    var d = st.doc;
    if (!d) return Promise.resolve(false);
    return loadCut().then(function (CUT) {
      return analyse(CUT, {}).then(function (D) {
        if (st.doc !== d) return false;
        var p = { amt: s && s.amt ? s.amt : 50, dof: 10, soft: 30, bokeh: !!(s && s.bokeh), focus: autoFocus(D.depth, D.subj), guard: !!D.subj };
        return applyFull(D, p).then(function (L) { return !!L; });
      });
    });
  }

  PL.portrait = { run: run, auto: auto };
})(typeof self !== "undefined" ? self : this);
