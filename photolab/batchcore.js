// ============================================================
// orOS Photo Lab — batchcore.js: batch processing, the pure part
// (no DOM). photolab/batch.js runs it; tests/photolab-batch.test.js
// checks it.
//   norm(raw)                 the batch settings (device-local prefs)
//   targetSize(w, h, rs)      the output size: rs = { mode: "none" |
//                             "long" | "w" | "h" | "pct", v, up }
//                             (up = may enlarge)
//   fileName(pattern, ctx)    {name} {n} {nn…} {date} {w} {h} → a safe
//                             file name without its extension
//   uniqueName(base, ext, taken)  "x.jpg", "x (2).jpg"… (taken: an
//                             object of lower-case names, updated)
//   wmPos(W, H, w, h, pos, margin)  where a watermark of w × h goes
//   wmFont(W, H, pct)         text watermark size in px
//   stackOf(layers)           the visible adjustment layers of a
//                             picture as [{ id, p, op }]
//   applyStack(img, stack, A, FX)  those adjustments on { w, h, data }
//                             (A = photolab/adjust.js), opacity mixed
// UMD: module.exports in Node (tests), window.PhotoLab.batch in the app.
// ============================================================
(function (root) {
  "use strict";

  var MAX_SIDE = 8192;
  var FORMATS = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
  var POS = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];
  var MODES = ["none", "long", "w", "h", "pct"];
  var BAD_RE = /[\u0000-\u001f\u007f\\\/:*?"<>|]+/g;
  var NAME_MAX = 120;

  function clampNum(v, lo, hi, d) {
    v = Number(v);
    if (!isFinite(v)) return d;
    return v < lo ? lo : v > hi ? hi : v;
  }
  function str(v, max, d) { return typeof v === "string" ? v.slice(0, max) : d; }
  function hex(v, d) { return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d; }

  // ---------- Settings ----------
  function norm(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var rs = raw.rs && typeof raw.rs === "object" ? raw.rs : {};
    var wm = raw.wm && typeof raw.wm === "object" ? raw.wm : {};
    var mode = MODES.indexOf(rs.mode) >= 0 ? rs.mode : "long";
    return {
      adj: ["none", "doc", "xmp"].indexOf(raw.adj) >= 0 ? raw.adj : "none",
      rs: { mode: mode, v: Math.round(clampNum(rs.v, 1, mode === "pct" ? 400 : MAX_SIDE, mode === "pct" ? 50 : 2048)), up: !!rs.up },
      wm: {
        kind: ["none", "text", "image"].indexOf(wm.kind) >= 0 ? wm.kind : "none",
        text: str(wm.text, 200, "© "),
        size: Math.round(clampNum(wm.size, 1, 100, 5)),
        c: hex(wm.c, "#ffffff"),
        pos: POS.indexOf(wm.pos) >= 0 ? wm.pos : "br",
        op: Math.round(clampNum(wm.op, 5, 100, 60))
      },
      fmt: FORMATS[raw.fmt] ? raw.fmt : "jpg",
      q: Math.round(clampNum(raw.q, 10, 100, 88)),
      pattern: str(raw.pattern, 120, "{name}") || "{name}",
      dest: raw.dest === "zip" ? "zip" : "disk",
      folder: cleanFolder(raw.folder) || "Batch"
    };
  }
  // One folder name inside Pictures (no paths, no dots-only names).
  function cleanFolder(s) {
    if (typeof s !== "string") return "";
    s = s.replace(BAD_RE, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    return /^\.+$/.test(s) ? "" : s;
  }

  // ---------- Size ----------
  function targetSize(w, h, rs) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    rs = rs || {};
    var v = Number(rs.v), k = 1;
    if (!isFinite(v) || v <= 0 || rs.mode === "none" || MODES.indexOf(rs.mode) < 0) k = 1;
    else if (rs.mode === "pct") k = v / 100;
    else if (rs.mode === "long") k = v / Math.max(w, h);
    else if (rs.mode === "w") k = v / w;
    else if (rs.mode === "h") k = v / h;
    if (k > 1 && !rs.up) k = 1;
    // never past the editor's own limit
    k = Math.min(k, MAX_SIDE / Math.max(w, h));
    if (k === 1) return { w: w, h: h };
    var tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
    // the side that was asked for is exact
    if (rs.mode === "long" && k < MAX_SIDE / Math.max(w, h)) { if (w >= h) tw = Math.round(v); else th = Math.round(v); }
    if (rs.mode === "w" && k < MAX_SIDE / Math.max(w, h)) tw = Math.round(v);
    if (rs.mode === "h" && k < MAX_SIDE / Math.max(w, h)) th = Math.round(v);
    return { w: Math.min(MAX_SIDE, tw), h: Math.min(MAX_SIDE, th) };
  }
  // A RAW file can be developed at half size when the output is at
  // most half as big as what the camera made (w0, h0 = full size, or
  // unknown: then only a "pct" ≤ 50 qualifies).
  function rawHalf(rs, w0, h0) {
    if (!rs || rs.mode === "none") return false;
    if (rs.mode === "pct") return rs.v <= 50;
    if (!w0 || !h0) return false;
    var t = targetSize(w0, h0, rs);
    return t.w * 2 <= w0 && t.h * 2 <= h0;
  }

  // ---------- Names ----------
  function pad(n, d) { var s = String(n); while (s.length < d) s = "0" + s; return s; }
  function ymd(d) {
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    d = d instanceof Date && !isNaN(d) ? d : new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1, 2) + "-" + pad(d.getDate(), 2);
  }
  function baseOf(name) {
    return String(name || "").split(/[\\\/]/).pop().replace(/\.[a-z0-9]{1,5}$/i, "");
  }
  // ctx = { name: the original file name, n: 1-based number, date, w, h }
  function fileName(pattern, ctx) {
    ctx = ctx || {};
    var p = typeof pattern === "string" && pattern.trim() ? pattern : "{name}";
    var out = p.replace(/\{(name|date|w|h|n+)\}/gi, function (m, k) {
      var key = k.toLowerCase();
      if (key === "name") return baseOf(ctx.name);
      if (key === "date") return ymd(ctx.date);
      if (key === "w") return String(ctx.w || 0);
      if (key === "h") return String(ctx.h || 0);
      return pad(ctx.n || 1, Math.min(6, key.length));            // {n} 1, {nnn} 001
    });
    out = out.replace(BAD_RE, "-").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, NAME_MAX).trim();
    return out || "photo-" + pad(ctx.n || 1, 3);
  }
  function uniqueName(base, ext, taken) {
    var name = base + "." + ext, i = 2;
    while (taken[name.toLowerCase()]) name = base + " (" + i++ + ")." + ext;
    taken[name.toLowerCase()] = 1;
    return name;
  }

  // ---------- Watermark ----------
  // W × H picture, w × h mark → { x, y } (top-left), margin in px.
  function wmPos(W, H, w, h, pos, margin) {
    var m = margin || 0, x, y;
    var col = pos === "tl" || pos === "l" || pos === "bl" ? 0 : pos === "tr" || pos === "r" || pos === "br" ? 2 : 1;
    var row = pos === "tl" || pos === "t" || pos === "tr" ? 0 : pos === "bl" || pos === "b" || pos === "br" ? 2 : 1;
    x = col === 0 ? m : col === 2 ? W - w - m : (W - w) / 2;
    y = row === 0 ? m : row === 2 ? H - h - m : (H - h) / 2;
    return { x: Math.round(x), y: Math.round(y) };
  }
  // The margin around a watermark: 3% of the short side.
  function wmMargin(W, H) { return Math.round(Math.min(W, H) * 0.03); }
  // Text size: pct of the short side (at least 6 px).
  function wmFont(W, H, pct) { return Math.max(6, Math.round(Math.min(W, H) * clampNum(pct, 1, 100, 5) / 100)); }
  // Picture mark: pct of the picture's width, its own aspect kept.
  function wmImageSize(W, H, iw, ih, pct) {
    var w = Math.max(1, Math.round(W * clampNum(pct, 1, 100, 20) / 100)), h = Math.max(1, Math.round(w * ih / iw));
    if (h > H) { h = H; w = Math.max(1, Math.round(h * iw / ih)); }
    return { w: w, h: h };
  }

  // ---------- Adjustments ----------
  // layers: a picture's layers (core.js); visible adjustment layers
  // with some opacity, bottom → top. Masks are left out (their places
  // belong to that picture), so `masked` says how many had one.
  function stackOf(layers) {
    var out = [], masked = 0;
    (Array.isArray(layers) ? layers : []).forEach(function (L) {
      if (!L || L.k !== "adj" || !L.vis || !L.op || !L.aj) return;
      if (L.mk && L.mk.on) masked++;
      out.push({ id: L.aj.id, p: JSON.parse(JSON.stringify(L.aj.p || {})), op: L.op });
    });
    out.masked = masked;
    return out;
  }
  // xmp.js layers ([{ id, p }]) → a stack at full opacity.
  function stackFromXmp(list) {
    return (Array.isArray(list) ? list : []).map(function (a) { return { id: a.id, p: a.p || {}, op: 100 }; });
  }
  function applyStack(img, stack, A, FX) {
    (stack || []).forEach(function (s) {
      var k = clampNum(s.op, 0, 100, 100) / 100;
      if (k <= 0) return;
      if (k >= 1) { A.run(img, s.id, s.p, FX); return; }
      var after = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
      A.run(after, s.id, s.p, FX);
      var b = img.data, a = after.data;
      for (var i = 0; i < b.length; i += 4) {
        b[i] += (a[i] - b[i]) * k; b[i + 1] += (a[i + 1] - b[i + 1]) * k; b[i + 2] += (a[i + 2] - b[i + 2]) * k;
      }
    });
    return img;
  }

  var API = {
    FORMATS: FORMATS, POS: POS, MODES: MODES, MAX_SIDE: MAX_SIDE,
    norm: norm, cleanFolder: cleanFolder, targetSize: targetSize, rawHalf: rawHalf,
    fileName: fileName, uniqueName: uniqueName, ymd: ymd,
    wmPos: wmPos, wmMargin: wmMargin, wmFont: wmFont, wmImageSize: wmImageSize,
    stackOf: stackOf, stackFromXmp: stackFromXmp, applyStack: applyStack
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.batch = API; }
})(typeof self !== "undefined" ? self : this);
