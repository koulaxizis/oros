// ============================================================
// orOS Atelier — kit.js: a book's release kit (v1.0.0, publisher
// wave P9)
// Publishing's "Release kit in Atelier" sends { releaseKit: { title,
// sub, author, line, price, imprint, quote, img } } (img = the cover
// on the orOS disk, under /internal/). Atelier asks once, then makes
// five ordinary designs in a new folder named after the book:
//   post 1080 × 1080 · story 1080 × 1920 · banner 1920 × 600 (px)
//   bookmark 50 × 180 mm · poster A3 (mm)
// each with the cover, the title, the author, the line ("Out 15
// November"), the price and the imprint, in the colour picked from the
// cover's edge (or a deep blue). Everything stays editable; nothing is
// exported by itself (Export works on each design as usual).
// The pure part (AtelierKit.build) has no DOM and runs in Node tests.
// ============================================================
(function (root) {
  "use strict";

  var M, AX;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js");
    AX = require("./ax.js");
  } else {
    M = root.orosDK.model;
    AX = root.AtelierAX;
  }

  var MM = 72 / 25.4;
  var FORMATS = [
    { id: "post", w: 1080, h: 1080, unit: "px" },
    { id: "story", w: 1080, h: 1920, unit: "px" },
    { id: "banner", w: 1920, h: 600, unit: "px" },
    { id: "bookmark", w: 50 * MM, h: 180 * MM, unit: "mm" },
    { id: "poster", w: 297 * MM, h: 420 * MM, unit: "mm" }
  ];
  var DEF_BG = "#1f3a5f";

  function line(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function color(v) { return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : ""; }
  // light text on a dark colour, dark text on a light one
  function inkFor(bg) {
    var n = parseInt(bg.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum < 0.55 ? "#ffffff" : "#111111";
  }

  // spec → the clean fields; null without a title
  function norm(spec) {
    var s = spec && typeof spec === "object" ? spec : {};
    var o = { title: line(s.title, 200), sub: line(s.sub, 200), author: line(s.author, 200), line: line(s.line, 120),
              price: line(s.price, 40), imprint: line(s.imprint, 120), quote: line(s.quote, 300), bg: color(s.bg) || DEF_BG };
    return o.title ? o : null;
  }

  // One design per format. img = { a, iw, ih, nm } (an Atelier asset)
  // or null (a plain panel in its place). names: { post: "Instagram
  // post", … } (the language's words). → normalized designs.
  function build(spec, img, now, names) {
    var s = norm(spec);
    if (!s) return [];
    var ink = inkFor(s.bg), soft = ink === "#ffffff" ? "#dfe6ee" : "#333333";
    var ar = img && img.iw > 0 && img.ih > 0 ? img.iw / img.ih : 2 / 3;
    return FORMATS.map(function (f) {
      var nm = (s.title + " · " + ((names && names[f.id]) || f.id)).slice(0, 120);
      var d = AX.newDesign({ name: nm, w: f.w, h: f.h, unit: f.unit, bg: s.bg }, now);
      var pg = M.pagesInOrder(d)[0];
      var W = f.w, H = f.h, u = Math.min(W, H) / 1080;      // 1 at 1080 px
      function cover(x, y, h) {
        var w = h * ar;
        if (img && img.a) AX.addItem(d, pg.id, { k: "photo", a: img.a, iw: img.iw, ih: img.ih, nm: img.nm || "", x: x, y: y, w: w, h: h, fit: "fill" }, now);
        else AX.addItem(d, pg.id, { k: "shape", shp: "rect", fc: soft, x: x, y: y, w: w, h: h }, now);
        return w;
      }
      function text(tx, x, y, w, size, o) {
        if (!tx) return y;
        var it = AX.addItem(d, pg.id, Object.assign({ k: "text", tx: tx, x: x, y: y, w: w, size: Math.round(size * 10) / 10, fc: ink, al: "l", lh: 115 }, o || {}), now);
        return it ? y + it.h + size * 0.35 : y;
      }
      var x, y, w, cw;
      if (f.id === "post") {
        cw = cover(90 * u, 140 * u, 800 * u);
        x = 90 * u + cw + 60 * u; w = W - x - 80 * u; y = 220 * u;
        y = text(s.title, x, y, w, 64 * u, { font: "serif", b: 1 });
        y = text(s.author, x, y, w, 34 * u, { caps: 1, tr: 60, fc: soft });
        y += 30 * u;
        y = text(s.line, x, y, w, 34 * u);
        text(s.price, x, y + 10 * u, w, 44 * u, { b: 1 });
        if (s.imprint) text(s.imprint, x, H - 150 * u, w, 26 * u, { caps: 1, tr: 80, fc: soft });
      } else if (f.id === "story") {
        cw = cover((W - 640 * u) / 2, 240 * u, 960 * u);
        x = 90 * u; w = W - 180 * u; y = 1270 * u;
        y = text(s.title, x, y, w, 72 * u, { font: "serif", b: 1, al: "c" });
        y = text(s.author, x, y, w, 38 * u, { caps: 1, tr: 60, fc: soft, al: "c" });
        y += 30 * u;
        y = text(s.line, x, y, w, 40 * u, { al: "c" });
        text(s.price, x, y + 10 * u, w, 48 * u, { b: 1, al: "c" });
        if (s.imprint) text(s.imprint, x, H - 140 * u, w, 28 * u, { caps: 1, tr: 80, fc: soft, al: "c" });
      } else if (f.id === "banner") {
        cw = cover(120 * u, 60 * u, 480 * u);
        x = 120 * u + cw + 80 * u; w = W - x - 120 * u; y = 120 * u;
        y = text(s.title, x, y, w, 76 * u, { font: "serif", b: 1 });
        y = text(s.author, x, y, w, 40 * u, { caps: 1, tr: 60, fc: soft });
        y += 20 * u;
        text([s.line, s.price].filter(Boolean).join(" · "), x, y, w, 40 * u, { b: 1 });
      } else if (f.id === "bookmark") {
        var m = 5 * MM;
        cw = W - 2 * m;
        cover(m + (cw - Math.min(cw, (H * 0.5) * ar)) / 2, m, Math.min(H * 0.5, cw / ar));
        x = m; w = W - 2 * m; y = m + Math.min(H * 0.5, cw / ar) + 5 * MM;
        y = text(s.title, x, y, w, 14, { font: "serif", b: 1, al: "c" });
        y = text(s.author, x, y, w, 8.5, { caps: 1, tr: 60, fc: soft, al: "c" });
        if (s.quote) y = text("“" + s.quote + "”", x, y + 3 * MM, w, 8, { font: "serif", i: 1, al: "c" });
        if (s.imprint) text(s.imprint, x, H - m - 10, w, 7, { caps: 1, tr: 80, fc: soft, al: "c" });
      } else {
        var pm = 20 * MM, ch = H * 0.5;
        cover((W - ch * ar) / 2, pm, ch);
        x = pm; w = W - 2 * pm; y = pm + ch + 12 * MM;
        y = text(s.title, x, y, w, 54, { font: "serif", b: 1, al: "c" });
        if (s.sub) y = text(s.sub, x, y, w, 22, { font: "serif", i: 1, al: "c" });
        y = text(s.author, x, y, w, 26, { caps: 1, tr: 60, fc: soft, al: "c" });
        y += 8 * MM;
        y = text(s.line, x, y, w, 26, { b: 1, al: "c" });
        if (s.quote) text("“" + s.quote + "”", x, y + 6 * MM, w, 16, { font: "serif", i: 1, al: "c" });
        if (s.imprint) text(s.imprint, x, H - pm - 14, w, 14, { caps: 1, tr: 80, fc: soft, al: "c" });
      }
      return M.normDoc(d);
    });
  }

  var API = { FORMATS: FORMATS, norm: norm, build: build, inkFor: inkFor };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }
  root.AtelierKit = API;

  // ---------- Browser: the deep link ----------
  var AT = root.AT;
  if (!AT) return;
  var t = AT.t;
  var STR = {
    en: {
      "kit.ask": "Make the release kit for “{t}”? Five designs (Instagram post, story, site banner, bookmark, A3 poster) in a new folder.",
      "kit.go": "Make the kit", "kit.done": "Release kit ready: {n} designs in the folder “{f}”.",
      "kit.noPic": "The cover could not be read; the designs have a panel in its place.",
      "kit.post": "Instagram post", "kit.story": "Story", "kit.banner": "Site banner", "kit.bookmark": "Bookmark", "kit.poster": "Poster A3"
    },
    el: {
      "kit.ask": "Να φτιαχτεί το πακέτο κυκλοφορίας για το «{t}»; Πέντε σχέδια (ανάρτηση Instagram, story, banner για το site, σελιδοδείκτης, αφίσα A3) σε νέο φάκελο.",
      "kit.go": "Φτιάξε το πακέτο", "kit.done": "Το πακέτο κυκλοφορίας είναι έτοιμο: {n} σχέδια στον φάκελο «{f}».",
      "kit.noPic": "Το εξώφυλλο δεν διαβάστηκε· τα σχέδια έχουν ένα πλαίσιο στη θέση του.",
      "kit.post": "Ανάρτηση Instagram", "kit.story": "Story", "kit.banner": "Banner για το site", "kit.bookmark": "Σελιδοδείκτης", "kit.poster": "Αφίσα A3"
    }
  };
  AT.addStrings(STR);
  var IMG = /^\/internal\/(?!.*(^|\/)\.\.(\/|$))[^\u0000-\u001f]+\.(png|jpe?g|webp)$/i, IMG_MAX = 50 * 1024 * 1024;

  function diskFs() {
    try { var p = window.parent; return p && p !== window && p.orosFS ? p.orosFS : null; }
    catch (e) { return null; }
  }
  // the cover → an Atelier asset { a, iw, ih, nm }, or null
  function coverAsset(path) {
    var F = diskFs();
    if (!path || !IMG.test(path) || !F) return Promise.resolve(null);
    return Promise.resolve(F.read(path)).then(function (blob) {
      if (!blob || !blob.size || blob.size > IMG_MAX) return null;
      return AT.A.importFile(new File([blob], path.split("/").pop(), { type: blob.type || "" }));
    }).then(function (r) { return r ? { a: r.id, iw: r.w, ih: r.h, nm: r.name } : null; }, function () { return null; });
  }
  // the colour at the cover's left edge, middle height (a quiet pick)
  function edgeColor(asset) {
    if (!asset) return Promise.resolve("");
    return Promise.resolve(AT.A.load(asset.a)).then(function (img) {
      if (!img) return "";
      var cv = document.createElement("canvas");
      cv.width = 8; cv.height = 64;
      var ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0, Math.max(1, (img.naturalWidth || img.width) * 0.04), img.naturalHeight || img.height, 0, 0, 8, 64);
      var px = ctx.getImageData(0, 0, 8, 64).data, r = 0, g = 0, b = 0, n = 0;
      for (var i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
      function h2(v) { return ("0" + Math.round(v / n * 0.8).toString(16)).slice(-2); }   // a touch darker
      return n ? "#" + h2(r) + h2(g) + h2(b) : "";
    }).then(null, function () { return ""; });
  }
  function make(rk) {
    var s = norm(rk);
    if (!s || document.querySelector("dialog[open]")) return;
    AT.confirm(t("kit.ask", { t: s.title }), t("kit.go"), function () {
      var path = typeof rk.img === "string" ? rk.img : "";
      coverAsset(path).then(function (img) {
        return edgeColor(img).then(function (bg) { return { img: img, bg: bg }; });
      }).then(function (r) {
        var now = AT.now(), names = {};
        FORMATS.forEach(function (f) { names[f.id] = t("kit." + f.id); });
        var docs = build(Object.assign({}, rk, { bg: r.bg || rk.bg }), r.img, now, names);
        if (!docs.length) return;
        var fid = AT.folders && AT.folders.add ? AT.folders.add(s.title.slice(0, 60)) : "";
        if (r.img) AT.noteUpload(r.img.a);
        AT.addDocs(docs, fid);
        if (path && !r.img) AT.toast(t("kit.noPic"));
        else AT.toast(t("kit.done", { n: docs.length, f: s.title.slice(0, 60) }));
      });
    });
  }
  AT.kit = { make: make };
})(typeof window !== "undefined" ? window : this);
