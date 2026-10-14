// ============================================================
// orOS Montage — auto reframe: find where the subject is, so a picture
// cropped to the project's shape (9:16, 1:1, 16:9 …) keeps it in view.
// Runs on the device, no service, no download:
//   - the browser's face detector (FaceDetector, Shape Detection API)
//     where it exists: the biggest face is the subject;
//   - else centre-weighted motion: what changes between two frames,
//     weighted towards the middle of the picture; a still picture
//     uses its detail (edges) the same way.
// The raw track is smoothed and thinned to a few keys (MontageCore
// item field `fc`, file seconds for a video), which the user can still
// change by hand (Reframe panel).
//   MontageReframe.analyse({ blob, kind: "video"|"image", in, out,
//     progress(f), cancelled() }) → Promise<[{ t, x, y }]>
// The pure steps (gray, motionCentroid, detailCentroid, faceFocus,
// buildTrack, smoothTrack, simplifyTrack) are unit-tested in node.
// UMD: module.exports in Node, window.MontageReframe in the browser.
// ============================================================
(function (root) {
  "use strict";

  var SIDE = 96;                 // analysis width in pixels
  var SIGMA = 0.38;              // centre weight: Gaussian, fraction of the frame
  var E_MIN = 0.004;             // less motion than this is noise: hold the last point
  var MAX_SAMPLES = 180, RATE = 3;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  // RGBA → luminance 0..1
  function gray(rgba, w, h) {
    var out = new Float32Array(w * h);
    for (var i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]) / 255;
    return out;
  }
  function centreWeight(x, y, w, h) {
    var dx = (x + 0.5) / w - 0.5, dy = (y + 0.5) / h - 0.5;
    return Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
  }
  // Weighted centroid of a field of non-negative values (0..1 positions).
  function centroid(field, w, h) {
    var sx = 0, sy = 0, sw = 0;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var v = field[y * w + x];
      if (!(v > 0)) continue;
      var k = v * centreWeight(x, y, w, h);
      sx += k * (x + 0.5) / w; sy += k * (y + 0.5) / h; sw += k;
    }
    return sw > 0 ? { x: sx / sw, y: sy / sw, sum: sw } : null;
  }
  // What moved between two frames: { x, y, e } (e = share of the
  // picture that changed, after the noise floor) or null.
  function motionCentroid(prev, cur, w, h) {
    if (!prev || prev.length !== cur.length) return null;
    var n = cur.length, d = new Float32Array(n), mean = 0, i;
    for (i = 0; i < n; i++) { d[i] = Math.abs(cur[i] - prev[i]); mean += d[i]; }
    mean /= n;
    var floor = Math.max(0.02, mean * 1.5), e = 0;
    for (i = 0; i < n; i++) { d[i] = d[i] > floor ? d[i] - floor : 0; e += d[i]; }
    e /= n;
    var c = centroid(d, w, h);
    return c ? { x: c.x, y: c.y, e: e } : null;
  }
  // Where the detail is in a still picture (gradient strength).
  function detailCentroid(g, w, h) {
    var f = new Float32Array(w * h), mean = 0, x, y;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var i = y * w + x, gx = g[i + 1] - g[i - 1], gy = g[i + w] - g[i - w];
      f[i] = Math.sqrt(gx * gx + gy * gy);
      mean += f[i];
    }
    mean /= Math.max(1, (w - 2) * (h - 2));
    for (var k = 0; k < f.length; k++) f[k] = f[k] > mean ? f[k] - mean : 0;
    var c = centroid(f, w, h);
    return c ? { x: c.x, y: c.y } : { x: 0.5, y: 0.5 };
  }
  // Faces [{ x, y, width, height }] in a w×h picture → the biggest
  // face's middle, a little above its centre (eyes), or null.
  function faceFocus(faces, w, h) {
    var best = null;
    (faces || []).forEach(function (f) {
      var b = f.boundingBox || f;
      if (!(b.width > 0 && b.height > 0)) return;
      if (!best || b.width * b.height > best.width * best.height) best = b;
    });
    if (!best) return null;
    return { x: clamp((best.x + best.width / 2) / w, 0, 1), y: clamp((best.y + best.height * 0.42) / h, 0, 1) };
  }
  // Samples [{ t, face?, motion? }] → one point a sample: a face wins,
  // then clear motion; otherwise the last point holds (the middle at first).
  function buildTrack(samples) {
    var out = [], last = { x: 0.5, y: 0.5 };
    (samples || []).forEach(function (s) {
      var p = s.face || (s.motion && s.motion.e >= E_MIN ? s.motion : null);
      if (p) last = { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
      out.push({ t: s.t, x: last.x, y: last.y });
    });
    return out;
  }
  // Centred moving average over `win` seconds.
  function smoothTrack(pts, win) {
    var half = (win || 1) / 2;
    return pts.map(function (p) {
      var sx = 0, sy = 0, n = 0;
      pts.forEach(function (q) { if (Math.abs(q.t - p.t) <= half + 1e-9) { sx += q.x; sy += q.y; n++; } });
      return { t: p.t, x: sx / n, y: sy / n };
    });
  }
  // Fewest keys (Ramer–Douglas–Peucker) such that the even-paced path
  // between keys stays within `tol` of every point; at most `max` keys
  // (the tolerance grows until they fit).
  function simplifyTrack(pts, tol, max) {
    if (pts.length <= 2) return pts.map(function (p) { return { t: r3(p.t), x: r3(p.x), y: r3(p.y) }; });
    max = max || 60;
    tol = tol || 0.02;
    for (var guard = 0; guard < 40; guard++) {
      var keep = new Uint8Array(pts.length);
      keep[0] = keep[pts.length - 1] = 1;
      (function rdp(a, b) {
        var worst = -1, wd = tol;
        for (var i = a + 1; i < b; i++) {
          var q = (pts[i].t - pts[a].t) / ((pts[b].t - pts[a].t) || 1);
          var d = Math.max(Math.abs(pts[a].x + (pts[b].x - pts[a].x) * q - pts[i].x), Math.abs(pts[a].y + (pts[b].y - pts[a].y) * q - pts[i].y));
          if (d > wd) { wd = d; worst = i; }
        }
        if (worst < 0) return;
        keep[worst] = 1;
        rdp(a, worst); rdp(worst, b);
      })(0, pts.length - 1);
      var out = [];
      for (var j = 0; j < pts.length; j++) if (keep[j]) out.push({ t: r3(pts[j].t), x: r3(pts[j].x), y: r3(pts[j].y) });
      // a path that never moves is one key
      if (out.length === 2 && Math.abs(out[0].x - out[1].x) < tol && Math.abs(out[0].y - out[1].y) < tol) return [out[0]];
      if (out.length <= max) return out;
      tol *= 1.5;
    }
    return [pts[0]];
  }
  // When to look: about RATE samples a second, MAX_SAMPLES at most.
  function sampleTimes(a, b) {
    var n = clamp(Math.round((b - a) * RATE) + 1, 2, MAX_SAMPLES), out = [];
    for (var i = 0; i < n; i++) out.push(a + (b - a) * i / (n - 1));
    return out;
  }

  var pure = {
    gray: gray, motionCentroid: motionCentroid, detailCentroid: detailCentroid, faceFocus: faceFocus,
    buildTrack: buildTrack, smoothTrack: smoothTrack, simplifyTrack: simplifyTrack, sampleTimes: sampleTimes, E_MIN: E_MIN
  };
  if (typeof module === "object" && module.exports) { module.exports = pure; return; }

  // ---------- Browser ----------
  var detector;                  // FaceDetector, false once it failed
  function faces(src) {
    if (detector === false) return Promise.resolve(null);
    if (!detector) {
      try { detector = typeof root.FaceDetector === "function" ? new root.FaceDetector({ fastMode: true, maxDetectedFaces: 4 }) : false; }
      catch (e) { detector = false; }
      if (!detector) return Promise.resolve(null);
    }
    return Promise.resolve(createImageBitmap(src)).then(function (bmp) {
      return detector.detect(bmp).then(function (r) { if (bmp.close) bmp.close(); return r; }, function (e) { if (bmp.close) bmp.close(); throw e; });
    }).then(null, function () { detector = false; return null; });
  }
  function small(src, w, h) {
    var sh = Math.max(2, Math.round(SIDE * h / w)), cv = document.createElement("canvas");
    cv.width = SIDE; cv.height = sh;
    var g = cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(src, 0, 0, SIDE, sh);
    return { g: gray(g.getImageData(0, 0, SIDE, sh).data, SIDE, sh), w: SIDE, h: sh };
  }
  function hasFaceDetector() { return typeof root.FaceDetector === "function" && detector !== false; }

  async function analyse(opts) {
    var progress = opts.progress || function () {}, cancelled = opts.cancelled || function () { return false; };
    if (opts.kind === "image") {
      var bmp = await createImageBitmap(opts.blob), fp = null;
      try {
        var f = await faces(bmp);
        fp = f && f.length ? faceFocus(f, bmp.width, bmp.height) : null;
        if (!fp) { var sm = small(bmp, bmp.width, bmp.height); fp = detailCentroid(sm.g, sm.w, sm.h); }
      } finally { if (bmp.close) bmp.close(); }
      progress(1);
      return [{ t: 0, x: r3(fp.x), y: r3(fp.y) }];
    }
    var M = root.Mediabunny;
    if (!M) throw new Error("decode");
    var input = new M.Input({ source: new M.BlobSource(opts.blob), formats: M.ALL_FORMATS });
    try {
      var vt = await input.getPrimaryVideoTrack();
      if (!vt || !(await vt.canDecode())) throw new Error("decode");
      var off = await vt.getFirstTimestamp(), w = vt.displayWidth, h = vt.displayHeight, k = Math.min(1, 480 / Math.max(w, h));
      var sink = new M.CanvasSink(vt, { width: Math.max(2, Math.round(w * k)), height: Math.max(2, Math.round(h * k)), fit: "fill", poolSize: 2 });
      var ts = sampleTimes(opts["in"], opts.out), samples = [], prev = null, i = 0;
      for await (var wc of sink.canvasesAtTimestamps(ts.map(function (x) { return x + off; }))) {
        if (cancelled()) throw new Error("cancelled");
        var t = ts[i++], s = { t: t };
        if (wc && wc.canvas) {
          var cv = wc.canvas, fc = await faces(cv);
          if (fc && fc.length) s.face = faceFocus(fc, cv.width, cv.height);
          var sm2 = small(cv, cv.width, cv.height);
          s.motion = motionCentroid(prev, sm2.g, sm2.w, sm2.h);
          prev = sm2.g;
        }
        samples.push(s);
        progress(i / ts.length);
      }
      var track = smoothTrack(buildTrack(samples), 1.2);
      return simplifyTrack(track, 0.025, 60);
    } finally {
      if (input.dispose) input.dispose();
    }
  }

  root.MontageReframe = {
    analyse: analyse, hasFaceDetector: hasFaceDetector,
    gray: gray, motionCentroid: motionCentroid, detailCentroid: detailCentroid, faceFocus: faceFocus,
    buildTrack: buildTrack, smoothTrack: smoothTrack, simplifyTrack: simplifyTrack, sampleTimes: sampleTimes
  };
})(typeof window !== "undefined" ? window : this);
