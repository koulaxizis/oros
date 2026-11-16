// ============================================================
// orOS — uifont.js (FM-5): the font of orOS itself
// A family from the person's font collections or the orOS disk
// (designkit/fonts.js) stands in for Nunito, the font every orOS page
// draws in (fonts.css). Each face is added to the page as a FontFace
// named "Nunito": a face added from script comes after the
// stylesheet's ones, so it wins for the letters it has (its
// unicode-range) and Nunito keeps every letter it lacks. No app
// stylesheet changes. Faces: regular as weights 300-500, bold as
// 600-900 (Nunito's own weights), italics the same. A family without
// a bold face gives its regular one the bold weights too (bold text
// then stays in the family, not bold); a missing italic is slanted by
// the browser.
// The shell loads this file (with designkit/text.js and fonts.js)
// only when a font is set: key "oros-uifont" (this device only, like
// the text size: { id, name, fb, r?, b?, i?, bi? }, the r…bi file
// names for an own family). It applies to the shell and to every
// same-origin app page as it loads (shell.js a11yFrame).
// window.orosUiFont = { set(entry, docs), frame(doc) }
// ============================================================
(function () {
  "use strict";

  var DK = window.orosDK, T = DK.text, F = DK.fonts;
  T.setFetcher(F.fetcher);
  var VARS = ["r", "b", "i", "bi"];
  // Nunito's own weights (fonts.css): a face with the same weight
  // added later wins over the stylesheet's (a weight range does not:
  // the browser keeps the first face that fits).
  var WEIGHTS = { r: [300, 400, 500], b: [600, 700, 800, 900] };
  var STYLE = { r: "normal", b: "normal", i: "italic", bi: "italic" };
  var MARK = "__orosUiFont";
  var cur = null, dataP = null, seq = 0;

  function rangeOf(map) {
    var cps = Object.keys(map).map(Number).filter(function (c) { return map[c] > 0; }).sort(function (a, b) { return a - b; });
    var out = [], i = 0;
    while (i < cps.length) {
      var a = cps[i], b = a;
      while (i + 1 < cps.length && cps[i + 1] === b + 1) { i++; b = cps[i]; }
      out.push("U+" + a.toString(16) + (b > a ? "-" + b.toString(16) : ""));
      i++;
    }
    return out.join(",");
  }
  function sizes(k) { return T.faceParts(k).map(function (p) { return p.bytes().length; }).join(","); }
  function urlsOf(e) {
    if (e.id.indexOf("fs_") === 0) return F.fontsourceUrls(e.id);
    var u = {};
    VARS.forEach(function (v) { u[v] = e[v] ? ["asset:" + e[v]] : []; });
    return u.r.length ? u : null;
  }
  // The faces of the family: Promise of [{ buf, style, weight, range }].
  function load(e) {
    var urls = urlsOf(e);
    if (!urls || !T.registerFamily(e.id, { name: e.name, urls: urls, fallback: "sans" })) return Promise.resolve([]);
    return T.load(VARS.map(function (v) { return e.id + "-" + v; })).then(function () {
      if (!T.isLoaded(e.id + "-r")) return [];
      var r = sizes(e.id + "-r"), out = [];
      var own = {};
      VARS.forEach(function (v) { own[v] = v === "r" || (T.isLoaded(e.id + "-" + v) && sizes(e.id + "-" + v) !== r); });
      VARS.forEach(function (v) {
        var k = e.id + "-" + v;
        if (!own[v]) return;
        // no bold face: the regular one takes the bold weights too, or
        // bold text would come out in Nunito
        var ws = v === "b" || v === "bi" ? WEIGHTS.b : (v === "r" && !own.b) || (v === "i" && !own.bi) ? WEIGHTS.r.concat(WEIGHTS.b) : WEIGHTS.r;
        T.faceParts(k).forEach(function (p) {
          var range = p.range || rangeOf(p.map);
          if (!range) return;
          ws.forEach(function (w) {
            out.push({ bytes: p.bytes, style: STYLE[v], weight: String(w), range: range });
          });
        });
      });
      return out;
    }, function () { return []; });
  }

  function clear(d) {
    var list = d && d[MARK];
    if (!list) return;
    list.forEach(function (ff) { try { d.fonts.delete(ff); } catch (e) {} });
    d[MARK] = null;
  }
  // The faces into one page (its own window's FontFace).
  function frame(d) {
    if (!d || !d.fonts || !d.defaultView) return;
    clear(d);
    if (!dataP) return;
    var mine = seq;
    dataP.then(function (faces) {
      if (mine !== seq || !faces.length) return;
      clear(d);
      var FF = d.defaultView.FontFace, list = [];
      faces.forEach(function (x) {
        try {
          var ff = new FF("Nunito", x.bytes().buffer, { style: x.style, weight: x.weight, unicodeRange: x.range });
          d.fonts.add(ff);
          list.push(ff);
          ff.load().then(null, function () {});
        } catch (e) {}
      });
      d[MARK] = list;
    });
  }
  // entry null: Nunito again.
  function set(e, docs) {
    seq++;
    cur = e && F.isFam(e.id) ? e : null;
    dataP = cur ? load(cur) : null;
    (docs || []).forEach(frame);
    return dataP ? dataP.then(function (f) { return f.length > 0; }) : Promise.resolve(true);
  }

  window.orosUiFont = { set: set, frame: frame, current: function () { return cur; } };
})();
