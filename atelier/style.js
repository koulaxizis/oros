// ============================================================
// orOS Atelier — style.js: My style (wave AC4, v1.0.0)
// What the person's own designs have in common, per kind of design
// (told apart by page shape): the fonts of titles, subtitles and body
// text, the text and background colours, the sizes (% of the page's
// short side), alignment, capitals and line spacing. Worked out on
// this device from the designs in the library and kept only here
// (localStorage oros-atelier-style); the Assistant reads it with the
// app's read permission, and its new texts take these looks when the
// command leaves them out (assist.js).
//   profile(docs, now, nameOf) → { v: 1, at, kinds: { kind: entry } }
//     (nameOf: font id → name; each entry also carries `sum`, its
//     summary(), so the Assistant needs nothing but commands.js)
//   entry: { n designs, pages, fonts: { title|subtitle|body: [{ id,
//     fb, name, share }] (≤ 3; id an own uf_ font, fb its stand-in) },
//     colours: [#rrggbb] (text, most used first, ≤ 6), backgrounds:
//     [#rrggbb] (≤ 4), sizes: { title|subtitle|body: % }, align
//     l|c|r|j, caps 0..1, lh % }
//   kindOf(w, h) → square | 4:5 | 9:16 | 16:9 | A portrait | bookmark
//     | banner (KINDS)
//   summary(profile, kind) → the short object the Assistant reads
//   look(profile, kind, role) → { font, fam?, size share, fc } for a
//     new text (assist.js)
// Pure: no DOM. Exposes window.AtelierStyle (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var KINDS = ["square", "4:5", "9:16", "16:9", "A portrait", "bookmark", "banner"];
  var ROLES = ["title", "subtitle", "body"];
  var UF = /^uf_[0-9a-f]{16}$/, HEX = /^#[0-9a-f]{6}$/;

  // by the page's width / height
  function kindOf(w, h) {
    var r = w > 0 && h > 0 ? w / h : 1;
    if (r < 0.42) return "bookmark";
    if (r < 0.6) return "9:16";
    if (r < 0.72) return "A portrait";
    if (r < 0.88) return "4:5";
    if (r < 1.15) return "square";
    if (r < 1.9) return "16:9";
    return "banner";
  }

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[s.length >> 1];
  }
  function top(counts, n) {
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); }).slice(0, n);
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  // the design's own fonts by id: { id: name }
  function ownNames(doc) {
    var out = {}, x = doc.setup && doc.setup.ext && doc.setup.ext.fonts;
    if (Array.isArray(x)) x.forEach(function (f) { if (f && UF.test(f.id) && typeof f.name === "string") out[f.id] = f.name.slice(0, 60); });
    return out;
  }

  function profile(docs, now, nameOf) {
    var acc = {};
    (docs || []).forEach(function (doc) {
      if (!doc || !doc.setup || !Array.isArray(doc.items) || !Array.isArray(doc.pages)) return;
      var W = doc.setup.w, H = doc.setup.h, short = Math.min(W, H);
      if (!(short > 0)) return;
      var kind = kindOf(W, H), names = ownNames(doc);
      var a = acc[kind] = acc[kind] || { n: 0, pages: 0, fonts: { title: {}, subtitle: {}, body: {} }, info: {}, colours: {}, bgs: {}, sizes: { title: [], subtitle: [], body: [] }, align: {}, caps: 0, texts: 0, lh: [] };
      a.n++;
      doc.pages.forEach(function (p) {
        var items = doc.items.filter(function (it) { return it.pg === p.id && it.ax && !it.hide; });
        var texts = items.filter(function (it) { return it.ax.k === "text" && it.ax.tx && it.ax.tx.trim(); });
        if (!items.length) return;
        a.pages++;
        items.forEach(function (it) {
          if (it.ax.bg && it.ax.k === "shape" && HEX.test(it.ax.fc || "")) a.bgs[it.ax.fc] = (a.bgs[it.ax.fc] || 0) + 1;
        });
        var max = 0;
        texts.forEach(function (it) { max = Math.max(max, it.ax.size || 48); });
        texts.forEach(function (it) {
          var ax = it.ax, size = ax.size || 48, chars = ax.tx.replace(/\s/g, "").length;
          var role = size >= max * 0.75 ? "title" : size >= max * 0.4 ? "subtitle" : "body";
          var fam = it.ext && typeof it.ext.fam === "string" && UF.test(it.ext.fam) ? it.ext.fam : "";
          var id = fam || ax.font || "sans";
          a.fonts[role][id] = (a.fonts[role][id] || 0) + chars;
          if (!a.info[id]) a.info[id] = { fb: ax.font || "sans", name: fam ? names[fam] || "" : "" };
          if (HEX.test(ax.fc || "#000000")) a.colours[ax.fc || "#000000"] = (a.colours[ax.fc || "#000000"] || 0) + chars;
          a.sizes[role].push(size / short * 100);
          a.align[ax.al || "l"] = (a.align[ax.al || "l"] || 0) + 1;
          if (ax.caps) a.caps++;
          a.texts++;
          a.lh.push(ax.lh || 120);
        });
      });
    });
    var kinds = {};
    Object.keys(acc).sort().forEach(function (k) {
      var a = acc[k];
      if (!a.texts) return;
      var e = { n: a.n, pages: a.pages, fonts: {}, colours: top(a.colours, 6), backgrounds: top(a.bgs, 4), sizes: {}, align: top(a.align, 1)[0] || "l", caps: r2(a.caps / a.texts), lh: median(a.lh) };
      ROLES.forEach(function (role) {
        var c = a.fonts[role], total = 0;
        Object.keys(c).forEach(function (id) { total += c[id]; });
        var list = top(c, 3).map(function (id) {
          var f = { id: id, fb: a.info[id].fb, share: r2(c[id] / Math.max(1, total)) };
          if (a.info[id].name) f.name = a.info[id].name;
          return f;
        });
        if (list.length) e.fonts[role] = list;
        if (a.sizes[role].length) e.sizes[role] = r2(median(a.sizes[role]));
      });
      kinds[k] = e;
    });
    var p = { v: 1, at: now || 0, kinds: kinds };
    Object.keys(kinds).forEach(function (k) { kinds[k].sum = summary(p, k, nameOf); });
    return p;
  }

  // a font id → a name the Assistant can say (own fonts by their name)
  function fontLabel(f, nameOf) {
    if (!f) return "";
    if (f.name) return f.name;
    return nameOf ? nameOf(f.id) : f.id;
  }
  function summary(p, kind, nameOf) {
    var e = p && p.kinds && p.kinds[kind];
    if (!e) return null;
    var o = { kind: kind, designs: e.n };
    ROLES.forEach(function (role) {
      if (e.fonts[role]) o[role + "_font"] = fontLabel(e.fonts[role][0], nameOf);
    });
    o.colours = e.colours.slice(0, 5);
    if (e.backgrounds.length) o.backgrounds = e.backgrounds.slice(0, 3);
    o.size_pct_of_short_side = e.sizes;
    o.align = e.align;
    if (e.caps >= 0.5) o.caps = true;
    return o;
  }

  // The look of a new text of a role in this kind of design, or null:
  // { font (built-in / Fontsource), fam (own font, when there is one),
  //   size (points, for a page whose short side is `short`), fc }
  function look(p, kind, role, short) {
    var e = p && p.kinds && p.kinds[kind];
    if (!e || ROLES.indexOf(role) < 0) return null;
    var f = e.fonts[role] || e.fonts.body || e.fonts.title, sz = e.sizes[role] || e.sizes.body || e.sizes.title;
    if (!f) return null;
    var o = { font: UF.test(f[0].id) ? f[0].fb : f[0].id };
    if (UF.test(f[0].id)) o.fam = f[0].id;
    if (sz && short > 0) o.size = r2(Math.max(2, Math.min(2000, sz * short / 100)));
    if (e.colours[0]) o.fc = e.colours[0];
    return o;
  }

  var api = { KINDS: KINDS, ROLES: ROLES, kindOf: kindOf, profile: profile, summary: summary, look: look };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierStyle = api;
})(typeof window !== "undefined" ? window : this);
