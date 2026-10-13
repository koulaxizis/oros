// ============================================================
// orOS Photo Lab — xmp.js: Lightroom / Camera Raw presets (no DOM)
// Integrations wave 5 (Adobe without an account): a preset saved as
// .xmp (Lightroom Classic and CC, Camera Raw) becomes adjustment
// layers, so it stays editable and its opacity says how strong.
//   parse(text) → { name, layers: [{ id, p }], skipped: [group] }
//     layers bottom → top, only those that change something:
//       levels   Exposure2012, Whites2012, Blacks2012
//       curves   Contrast2012, Shadows2012, Highlights2012
//       curves   ToneCurvePV2012 (the point curve, sampled)
//       balance  (Incremental)Temperature, (Incremental)Tint
//       hsl      Saturation, Vibrance (half as strong)
//       gray     ConvertToGrayscale
//     skipped: what Photo Lab has no layer for, by group ("clarity",
//     "texture", "dehaze", "sharpen", "noise", "grain", "vignette",
//     "mixer", "grading"), when the preset changes it.
//   Rejects (throws Error("xmp")) when the text is not a Camera Raw
//   settings file. The mapping is an approximation: Lightroom works
//   on raw data in linear light; these layers work on the picture.
// The text is only matched with patterns: nothing in it runs, and a
// value is read only when it is a plain number in range.
// UMD: module.exports in Node (tests), window.PhotoLab.xmp in the app.
// ============================================================
(function (root) {
  "use strict";

  var MAX_TEXT = 2 * 1024 * 1024;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function r(v) { return Math.round(v); }

  function getter(text) {
    return function (key) {
      var re1 = new RegExp("crs:" + key + "\\s*=\\s*\"([^\"]{0,40})\""), re2 = new RegExp("<crs:" + key + ">([^<]{0,40})</crs:" + key + ">");
      var m = re1.exec(text) || re2.exec(text);
      return m ? m[1].trim() : null;
    };
  }
  function numOf(get, key, lo, hi) {
    var s = get(key);
    if (s === null || !/^[+-]?[0-9]{1,6}(\.[0-9]{1,6})?$/.test(s)) return null;
    return clamp(parseFloat(s), lo, hi);
  }
  function nameOf(text) {
    var m = /crs:Name\s*=\s*"([^"]{1,200})"/.exec(text) ||
            /<crs:Name>\s*<rdf:Alt>\s*<rdf:li[^>]*>([^<]{1,200})<\/rdf:li>/.exec(text) ||
            /<crs:Name>([^<]{1,200})<\/crs:Name>/.exec(text);
    var s = m ? m[1] : "";
    s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
    return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  }
  // "x, y" points (0..255) → the curve's outputs at 64 / 128 / 192
  function toneCurve(text) {
    var m = /<crs:ToneCurvePV2012>\s*<rdf:Seq>([\s\S]{0,4000}?)<\/rdf:Seq>/.exec(text);
    if (!m) return null;
    var pts = [], re = /<rdf:li>\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*<\/rdf:li>/g, x;
    while ((x = re.exec(m[1])) && pts.length < 64) pts.push([clamp(+x[1], 0, 255), clamp(+x[2], 0, 255)]);
    pts.sort(function (a, b) { return a[0] - b[0]; });
    if (pts.length < 2) return null;
    function at(v) {
      if (v <= pts[0][0]) return pts[0][1];
      for (var i = 1; i < pts.length; i++) {
        if (v <= pts[i][0]) {
          var a = pts[i - 1], b = pts[i], d = b[0] - a[0];
          return d ? a[1] + (b[1] - a[1]) * (v - a[0]) / d : b[1];
        }
      }
      return pts[pts.length - 1][1];
    }
    var p = { s: r(at(64)), m: r(at(128)), h: r(at(192)) };
    return p.s === 64 && p.m === 128 && p.h === 192 ? null : p;
  }

  var SKIP = [
    ["clarity", /^Clarity2012$/], ["texture", /^Texture$/], ["dehaze", /^Dehaze$/],
    ["sharpen", /^Sharpness$/], ["noise", /^(LuminanceSmoothing|ColorNoiseReduction)$/],
    ["grain", /^GrainAmount$/], ["vignette", /^PostCropVignetteAmount$/],
    ["mixer", /^(Hue|Saturation|Luminance)Adjustment[A-Za-z]+$/],
    ["grading", /^(SplitToning(Shadow|Highlight)Saturation|ColorGrade(Shadow|Midtone|Highlight|Global)Sat)$/]
  ];
  // Lightroom's defaults for the sharpening and noise sliders are not 0
  var DEFAULTS = { Sharpness: 40, ColorNoiseReduction: 25 };

  function parse(text) {
    if (typeof text !== "string" || text.length > MAX_TEXT || text.indexOf("http://ns.adobe.com/camera-raw-settings/1.0/") < 0) throw new Error("xmp");
    var get = getter(text);
    var layers = [], skipped = [];

    // levels: exposure (in gamma space), whites, blacks
    var ev = numOf(get, "Exposure2012", -5, 5), wh = numOf(get, "Whites2012", -100, 100), bk = numOf(get, "Blacks2012", -100, 100);
    var lv = { ib: 0, iw: 255, g: 1, ob: 0, ow: 255 };
    if (ev) {
      var f = Math.pow(2, ev / 2.2);
      if (ev > 0) lv.iw = 255 / f; else lv.ow = 255 * f;
    }
    if (wh) { if (wh > 0) lv.iw -= wh * 0.4; else lv.ow += wh * 0.4; }
    if (bk) { if (bk < 0) lv.ib = -bk * 0.4; else lv.ob = bk * 0.4; }
    lv = { ib: r(clamp(lv.ib, 0, 254)), iw: r(clamp(lv.iw, 1, 255)), g: 1, ob: r(clamp(lv.ob, 0, 255)), ow: r(clamp(lv.ow, 0, 255)) };
    if (lv.iw <= lv.ib) lv.iw = lv.ib + 1;
    if (lv.ib || lv.iw !== 255 || lv.ob || lv.ow !== 255) layers.push({ id: "levels", p: lv });

    // curves: contrast, shadows, highlights
    var ct = numOf(get, "Contrast2012", -100, 100) || 0, sh = numOf(get, "Shadows2012", -100, 100) || 0, hl = numOf(get, "Highlights2012", -100, 100) || 0;
    var cv = { s: r(clamp(64 - ct * 0.16 + sh * 0.24, 0, 255)), m: 128, h: r(clamp(192 + ct * 0.16 + hl * 0.24, 0, 255)) };
    if (cv.s !== 64 || cv.h !== 192) layers.push({ id: "curves", p: cv });
    var tc = toneCurve(text);
    if (tc) layers.push({ id: "curves", p: tc });

    // white balance: relative (presets for any picture) or Kelvin
    var tp = numOf(get, "IncrementalTemperature", -100, 100), ti = numOf(get, "IncrementalTint", -100, 100);
    if (tp === null) { var k = numOf(get, "Temperature", 2000, 50000); tp = k === null ? 0 : clamp((k - 5500) / 45, -100, 100); }
    if (ti === null) ti = numOf(get, "Tint", -150, 150) || 0;
    var bal = { r: r(clamp(tp * 0.3, -100, 100)), g: r(clamp(-ti * 0.3, -100, 100)), b: r(clamp(-tp * 0.3, -100, 100)) };
    if (bal.r || bal.g || bal.b) layers.push({ id: "balance", p: bal });

    var sat = (numOf(get, "Saturation", -100, 100) || 0) + (numOf(get, "Vibrance", -100, 100) || 0) * 0.5;
    if (r(sat)) layers.push({ id: "hsl", p: { h: 0, s: r(clamp(sat, -100, 100)), l: 0 } });

    if (get("ConvertToGrayscale") === "True") layers.push({ id: "gray", p: {} });

    // what Photo Lab has no layer for
    var keys = {}, kre = /crs:([A-Za-z0-9]{1,60})\s*=\s*"([^"]{0,40})"|<crs:([A-Za-z0-9]{1,60})>([^<]{0,40})<\/crs:/g, km, guard = 0;
    while ((km = kre.exec(text)) && guard++ < 5000) keys[km[1] || km[3]] = (km[2] !== undefined ? km[2] : km[4]).trim();
    Object.keys(keys).forEach(function (key) {
      var v = parseFloat(keys[key]);
      if (!isFinite(v) || v === 0 || v === DEFAULTS[key]) return;
      SKIP.forEach(function (s) { if (s[1].test(key) && skipped.indexOf(s[0]) < 0) skipped.push(s[0]); });
    });
    return { name: nameOf(text), layers: layers, skipped: skipped };
  }

  var api = { parse: parse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.xmp = api; }
})(typeof window !== "undefined" ? window : this);
