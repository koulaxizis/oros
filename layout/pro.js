// ============================================================
// orOS Layout — pro.js: the pure part of the page-layout commands of
// LY-PRO wave W1 (Chris's spec v2, 2026-11-18): a new document from
// a command (create), pages from pictures (images), the bleed of
// full-page pictures (bleedfill), the full read-back for the
// Assistant and orOS Gate, and the checks around them.
//   natSort(names)            "1_A, 2_a, 10, 27" in reading order
//   makeDoc(st, now)          create → a new document (model newDoc)
//   placePictures(doc, pics, st, now) → { pages, blank, items }
//   bleedTargets(doc, test)   full-page pictures that stop at the trim
//   needPx(doc, it)           how many pixels each side needs
//   applyFill(doc, it, res, now)  the extended picture in the frame
//   noBleed(doc)              preflight: [{ page, id }] of those
//   outline(doc, L, opts)     everything read_in_app gives for Layout
//   pathOk(path, folders)     "" or why a path may not be read
// Files are read, pixels made and assets stored by Layout (assist.js,
// bleedfill.js); nothing here touches the DOM or the disk.
// Exposes window.LayoutPro (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var M = node ? require("../designkit/model.js") : root.orosDK && root.orosDK.model;
  if (!M) return;
  var MM = 72 / 25.4;
  var PT_PER = { pt: 1, mm: MM, in: 72, px: 72 / 96 };

  // ---------- names in reading order ----------
  // Digit runs compare as numbers, letters without case or accents,
  // "_" "-" " " "." as separators: 1_A < 1_b < 2_a < 10 < 27.
  function fold(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function parts(s) {
    var base = fold(s).replace(/\.[a-z0-9]{1,5}$/, ""), out = [], re = /(\d+)|([^\d_\-\s.]+)/g, m;
    while ((m = re.exec(base))) out.push(m[1] !== undefined ? { n: parseInt(m[1], 10), d: m[1].length } : { s: m[2] });
    return out;
  }
  function natCmp(a, b) {
    var pa = parts(a), pb = parts(b);
    for (var i = 0; i < Math.min(pa.length, pb.length); i++) {
      var x = pa[i], y = pb[i];
      if (x.n !== undefined && y.n !== undefined) { if (x.n !== y.n) return x.n - y.n; continue; }
      if (x.n !== undefined) return -1;
      if (y.n !== undefined) return 1;
      if (x.s !== y.s) return x.s < y.s ? -1 : 1;
    }
    if (pa.length !== pb.length) return pa.length - pb.length;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function natSort(names) { return names.slice().sort(natCmp); }
  function baseName(p) { p = String(p); return p.slice(p.lastIndexOf("/") + 1); }

  // ---------- which files may be read ----------
  // Only inside one of Claude's folders (Settings › orOS Gate ›
  // Claude's folders, the list assistant/claudefiles.js keeps), never
  // a dot segment, never a name that looks like a key; pictures and
  // PDFs only. folders: clean "/internal/…" paths.
  var PIC = /\.(jpe?g|png|webp|gif|bmp|tiff?|avif)$/i;
  var SECRET_FILE = /(^\.env)|(^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$)|(\.(kdbx|kdb|pem|key|p12|pfx|jks|keystore|asc|gpg|ovpn|ppk)$)/i;
  function normPath(f) {
    var s = String(f == null ? "" : f).normalize("NFC").trim().replace(/\s*›\s*/g, "/").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
    if (!s || s.length > 1024) return "";
    if (s.indexOf("/internal/") !== 0) s = "/internal/" + s.replace(/^\/+/, "");
    var segs = s.slice(10).split("/");
    for (var i = 0; i < segs.length; i++) {
      if (!segs[i] || segs[i].charAt(0) === "." || /[\u0000-\u001f]/.test(segs[i])) return "";
    }
    return s;
  }
  function under(p, dir) { return p === dir || p.indexOf(dir + "/") === 0; }
  function pathOk(p, folders, dir) {
    var n = normPath(p);
    if (!n) return "not a path on the orOS disk";
    if (!(folders || []).some(function (f) { return under(n, f); })) return "not inside one of Claude's folders (Settings › orOS Gate › Claude's folders)";
    if (SECRET_FILE.test(baseName(n))) return "a file that looks like a key is never read";
    if (!dir && !PIC.test(n)) return "not a picture (jpg, png, webp, gif, bmp, tiff, avif)";
    return "";
  }

  // ---------- create ----------
  function toPt(v, u) { return v * (PT_PER[u] || MM); }
  // A create step → a new document (not yet stored). Lengths of the
  // margins, bleed, slug and gutter are in mm; the trim in st.u.
  function makeDoc(st, now) {
    var u = PT_PER[st.u] ? st.u : "mm";
    var w = toPt(st.w, u), h = toPt(st.h, u);
    var bl = st.mm >= 0 ? st.mm : 3;
    var side = function (v) { return typeof v === "number" && v >= 0 ? v : bl; };
    var bt = side(st.bt), bb = side(st.bb), bi = side(st.bi), bo = side(st.bo);
    var mg = function (v, d) { return typeof v === "number" && v >= 0 ? v : d; };
    var doc = M.newDoc({
      name: st.title || "", w: w, h: h, unit: u === "px" ? "pt" : u, bleed: Math.max(bt, bb, bi, bo) * MM,
      mt: mg(st.t, 15) * MM, mb: mg(st.b, 15) * MM, mi: mg(st.i, 15) * MM, mo: mg(st.o, 15) * MM,
      cols: st.ncol || 1, gut: mg(st.gut, 5) * MM, facing: st.facing ? 1 : 0, preset: presetOf(w, h), pages: st.n || 1
    }, now);
    var x = doc.setup.ext || {};
    if (!(bt === bb && bb === bi && bi === bo)) x.bl = { t: r3(bt * MM), b: r3(bb * MM), i: r3(bi * MM), o: r3(bo * MM) };
    if (st.slug > 0) x.slug = r3(st.slug * MM);
    if (st.side === "left" && st.facing) x.first = "L";
    if (st.grid > 0) x.bg = { st: r3(st.grid), s: r3(mg(st.t, 15) * MM) };
    if (st.color === "cmyk") { x.cm = "cmyk"; x.icc = st.icc || "fogra39"; }
    if (Object.keys(x).length) doc.setup.ext = x;
    return M.normDoc(doc);
  }
  function presetOf(w, h) {
    var hit = "custom";
    M.PRESETS.forEach(function (p) {
      if (hit !== "custom") return;
      var pw = p[1] * MM, ph = p[2] * MM;
      if ((Math.abs(pw - w) < 0.6 && Math.abs(ph - h) < 0.6) || (Math.abs(pw - h) < 0.6 && Math.abs(ph - w) < 0.6)) hit = p[0];
    });
    return hit;
  }
  function r3(n) { return Math.round(n * 1000) / 1000; }

  // ---------- pages from pictures ----------
  function renumber(order, now) {
    order.forEach(function (p, i) { if (p.pos !== (i + 1) * 1024) { p.pos = (i + 1) * 1024; M.touch(p, now); } });
  }
  // The frame of a picture on a page of side `sd` for fit mode `fit`.
  function frameFor(doc, sd, fit) {
    var s = doc.setup;
    if (fit === "bleed") { var b = M.bleeds(doc, sd); return { x: -b.l, y: -b.t, w: s.w + b.l + b.r, h: s.h + b.t + b.b, fit: "fill" }; }
    if (fit === "margins") { var m = M.margins(doc, sd); return { x: m.l, y: m.t, w: Math.max(10, s.w - m.l - m.r), h: Math.max(10, s.h - m.t - m.b), fit: "fit" }; }
    if (fit === "proportional") return { x: 0, y: 0, w: s.w, h: s.h, fit: "fit" };
    return { x: 0, y: 0, w: s.w, h: s.h, fit: "fill" };
  }
  // pics: [{ a, iw, ih, nm }] in order. st: { fit, at, page, side }.
  // One new page per picture at the place asked; with side right|left
  // a blank page goes first when the first picture would land on the
  // other side. → { pages, blank, items: [item ids], first (page
  // position of the first picture, 1-based) }
  function placePictures(doc, pics, st, now, idf) {
    var nid = idf || M.newId;
    var order = M.pagesInOrder(doc);
    var room = M.MAX_PAGES - order.length;
    if (!pics.length || room < 1) return { pages: 0, blank: 0, items: [], first: 0 };
    var at = st.at === "before" && st.page ? st.page - 1 : st.at === "after" && st.page ? st.page : order.length;
    at = Math.max(0, Math.min(order.length, at));
    // an empty one-page document: the first picture takes that page
    var reuse = order.length === 1 && !doc.items.some(function (it) { return it.pg === order[0].id; }) && at >= 0 ? order[0] : null;
    if (reuse) at = 0;
    var like = order[Math.max(0, at - 1)] || order[0];
    var blank = 0;
    if (doc.setup.facing && (st.side === "right" || st.side === "left")) {
      var want = st.side === "right" ? "R" : "L";
      if (M.sideOf(doc, at) !== want && room > pics.length) blank = 1;
    }
    var made = [];
    // the empty page that is there becomes the blank one
    if (blank) made.push(reuse || { id: nid("pg"), m: now, pos: 0, ms: like ? like.ms : "", blank: 1 });
    pics.slice(0, room - blank).forEach(function (p, k) {
      if (reuse && k === 0 && !blank) { made.push(reuse); return; }
      made.push({ id: nid("pg"), m: now, pos: 0, ms: like ? like.ms : "" });
    });
    var add = made.filter(function (p) { return p !== reuse; }).map(function (p) { delete p.blank; return p; });
    order = order.filter(function (p) { return p !== reuse; });
    var ins = reuse ? made : add;
    order.splice.apply(order, [at, 0].concat(ins));
    renumber(order, now);
    doc.pages = order;
    var ids = [], k = blank;
    var z = doc.items.reduce(function (a, it) { return Math.max(a, it.z || 0); }, 0);
    pics.slice(0, room - blank).forEach(function (p) {
      var pg = ins[k++], idx = order.indexOf(pg), f = frameFor(doc, M.sideOf(doc, idx), st.fit);
      var it = { id: nid("it"), m: now, t: "img", pg: pg.id, x: r3(f.x), y: r3(f.y), w: r3(f.w), h: r3(f.h), a: p.a, nm: String(p.nm || "").slice(0, 120),
                 iw: p.iw, ih: p.ih, fit: f.fit, sw: 0, z: (z += 16) };
      doc.items.push(it);
      ids.push(it.id);
    });
    return { pages: add.length, blank: blank, items: ids, first: at + blank + 1 };
  }

  // ---------- bleed of full-page pictures ----------
  var EPS = 0.75;   // points
  // A picture that covers the whole trim of its page.
  function fullPage(doc, it) {
    var s = doc.setup;
    return it.t === "img" && !!it.a && !it.rot && it.x <= EPS && it.y <= EPS && it.x + it.w >= s.w - EPS && it.y + it.h >= s.h - EPS;
  }
  function sideOfItem(doc, it) {
    var order = M.pagesInOrder(doc), idx = -1;
    order.forEach(function (p, i) { if (p.id === it.pg) idx = i; });
    return idx < 0 ? null : M.sideOf(doc, idx);
  }
  // How far (points) each side of the frame is short of the bleed.
  function shortBy(doc, it) {
    var sd = sideOfItem(doc, it);
    if (!sd) return null;
    var b = M.bleeds(doc, sd), s = doc.setup;
    var o = { l: Math.max(0, b.l + it.x), t: Math.max(0, b.t + it.y), r: Math.max(0, s.w + b.r - (it.x + it.w)), b: Math.max(0, s.h + b.b - (it.y + it.h)) };
    return o.l > EPS || o.t > EPS || o.r > EPS || o.b > EPS ? o : null;
  }
  // Pictures on the pages `test` picks (1-based positions) that cover
  // the trim and stop short of the bleed, page order.
  function bleedTargets(doc, test) {
    var order = M.pagesInOrder(doc), on = {};
    order.forEach(function (p, i) { if (!test || test(i + 1)) on[p.id] = i + 1; });
    return doc.items.filter(function (it) { return on[it.pg] && fullPage(doc, it) && shortBy(doc, it); })
      .sort(function (a, b) { return on[a.pg] - on[b.pg] || (a.z || 0) - (b.z || 0); });
  }
  // The visible picture is stretched to the frame in "fill"; in pixels
  // of the picture, how much each side must grow so the frame can
  // reach the bleed with the same scale. → { l, t, r, b, k (px/pt) }
  function needPx(doc, it) {
    var o = shortBy(doc, it);
    if (!o || !it.iw || !it.ih) return null;
    var k = Math.max(it.iw / it.w, it.ih / it.h);   // the fill scale (px per pt)
    return { l: Math.ceil(o.l * k), t: Math.ceil(o.t * k), r: Math.ceil(o.r * k), b: Math.ceil(o.b * k), k: k, o: o };
  }
  // res: { a, iw, ih, mode, need } the extended picture. The frame
  // grows by need.o, the picture keeps its scale; ext.bf remembers the
  // original so a second fill starts from it.
  function applyFill(doc, it, res, now) {
    var o = res.need.o, x = it.ext || {};
    var src = x.bf && x.bf.src ? x.bf : { src: it.a, iw: it.iw, ih: it.ih, x: it.x, y: it.y, w: it.w, h: it.h };
    it.x = r3(it.x - o.l); it.y = r3(it.y - o.t); it.w = r3(it.w + o.l + o.r); it.h = r3(it.h + o.t + o.b);
    it.a = res.a; it.iw = res.iw; it.ih = res.ih; it.fit = "fill"; it.ix = 0; it.iy = 0; it.isc = 1;
    x.bf = { src: src.src, iw: src.iw, ih: src.ih, x: src.x, y: src.y, w: src.w, h: src.h, mode: res.mode };
    it.ext = x;
    M.touch(it, now);
    return 1;
  }
  function noBleed(doc) {
    var order = M.pagesInOrder(doc), pos = {};
    order.forEach(function (p, i) { pos[p.id] = i + 1; });
    var bl = M.bleeds(doc, "R");
    if (!(bl.t || bl.b || bl.i || bl.o)) return [];
    return doc.items.filter(function (it) { return pos[it.pg] && fullPage(doc, it) && shortBy(doc, it); })
      .map(function (it) { return { page: pos[it.pg], id: it.id }; });
  }

  // ---------- read-back (item 37) ----------
  var PT_MM = 25.4 / 72;
  function mm(v) { return Math.round((v || 0) * PT_MM * 10) / 10; }
  function nameOf(n) { return n && typeof n === "object" ? n.en || n.el || n[Object.keys(n)[0]] || "" : String(n || ""); }
  function paraText(p) { return (p.runs || []).map(function (r) { return typeof r.t === "string" ? r.t : r.f === "pn" ? "#" : r.f === "pc" ? "##" : ""; }).join(""); }
  var MAX_FRAMES = 1500, MAX_PARAS = 1500, MAX_PARA = 400, MAX_PAGES_OUT = 400;
  // L: designkit render computeLayout (optional: overset, frames of a
  // story); opts: { problems: preflight list, fonts: { key: name } }
  function outline(doc, L, opts) {
    opts = opts || {};
    var s = doc.setup, order = M.pagesInOrder(doc), x = s.ext || {};
    var msName = {}, psName = {}, csName = {}, pos = {};
    (doc.masters || []).forEach(function (m) { msName[m.id] = nameOf(m.name) || m.id; });
    (doc.pstyles || []).forEach(function (p) { psName[p.id] = nameOf(p.name) || p.id; });
    (doc.cstyles || []).forEach(function (c) { csName[c.id] = nameOf(c.name) || c.id; });
    order.forEach(function (p, i) { pos[p.id] = i + 1; });
    var b = M.bleeds(doc, "R"), first = M.firstNumber(doc);
    var o = {
      name: doc.name || "", unit: s.unit, trim_mm: { w: mm(s.w), h: mm(s.h) }, preset: s.preset,
      bleed_mm: { t: mm(b.t), b: mm(b.b), inside: mm(b.i), outside: mm(b.o) }, slug_mm: mm(M.slugOf(doc)),
      facing: !!s.facing, first_page: M.firstLeft(doc) ? "left" : "right",
      margins_mm: { t: mm(s.mt), b: mm(s.mb), inside: mm(s.mi), outside: mm(s.mo) }, columns: s.cols, gutter_mm: mm(s.gut),
      baseline_grid: x.bg && x.bg.st ? { step_pt: x.bg.st, start_mm: mm(x.bg.s) } : null,
      colour: x.cm === "cmyk" ? { mode: "cmyk", profile: x.icc || "fogra39" } : { mode: "rgb" },
      first_page_number: first, pages: order.length
    };
    o.page_list = order.slice(0, MAX_PAGES_OUT).map(function (p, i) {
      var e = { page: i + 1, number: String(i + first), side: M.sideOf(doc, i) === "L" ? "left" : "right", id: p.id };
      if (p.ms) e.master = msName[p.ms] || "";
      return e;
    });
    var frames = [];
    doc.items.forEach(function (it) {
      if (frames.length >= MAX_FRAMES || !pos[it.pg]) return;
      var f = { id: it.id, page: pos[it.pg], kind: it.t === "img" ? "picture" : it.t === "text" ? "text" : it.t === "path" ? "path" : it.t === "line" ? "line" : it.t === "ell" ? "ellipse" : "rectangle",
                x_mm: mm(it.x), y_mm: mm(it.y), w_mm: mm(it.w), h_mm: mm(it.h) };
      if (it.rot) f.rotation = it.rot;
      if (it.hide) f.hidden = true;
      if (it.lock) f.locked = true;
      if (it.t === "img") {
        f.file = it.nm || "";
        f.pixels = { w: it.iw, h: it.ih };
        f.fit = it.fit;
        var sc = it.fit === "fit" ? Math.min(it.w / (it.iw || 1), it.h / (it.ih || 1)) : it.fit === "fill" ? Math.max(it.w / (it.iw || 1), it.h / (it.ih || 1)) : (it.isc || 1) * (it.w / (it.iw || 1));
        f.effective_ppi = sc > 0 ? Math.round(72 / sc) : 0;
        if (it.ext && it.ext.bf) f.bleed_fill = it.ext.bf.mode;
        if (it.mf) f.merge_field = it.mf;
      }
      if (it.t === "text") { f.story = it.story; f.columns = it.cols || 1; }
      frames.push(f);
    });
    o.frames = frames;
    if (doc.items.length > frames.length) o.frames_note = "Only the first " + MAX_FRAMES + " frames are listed.";
    var paras = 0;
    o.stories = (doc.stories || []).map(function (st) {
      var chain = doc.items.filter(function (it) { return it.t === "text" && it.story === st.id; }).sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
      var e = { id: st.id, frames: chain.map(function (f) { return f.id; }), pages: chain.map(function (f) { return pos[f.pg]; }).filter(Boolean),
                overset: !!(L && L.overset && L.overset[st.id]), paragraphs: [] };
      (st.paras || []).forEach(function (p) {
        if (paras >= MAX_PARAS) return;
        paras++;
        var t = paraText(p), q = { style: psName[p.ps || "ps-base"] || p.ps || "", text: t.length > MAX_PARA ? t.slice(0, MAX_PARA) + "…" : t };
        var cs = (p.runs || []).filter(function (r) { return r.cs || r.b || r.i; }).slice(0, 10).map(function (r) {
          var d = {};
          if (r.cs) d.style = csName[r.cs] || r.cs;
          if (r.b) d.bold = true;
          if (r.i) d.italic = true;
          d.text = String(r.t || "").slice(0, 60);
          return d;
        });
        if (cs.length) q.runs = cs;
        e.paragraphs.push(q);
      });
      return e;
    });
    if (paras >= MAX_PARAS) o.stories_note = "Only the first " + MAX_PARAS + " paragraphs are listed.";
    var used = {};
    (doc.stories || []).forEach(function (st) { (st.paras || []).forEach(function (p) { var k = p.ps || "ps-base"; used[k] = (used[k] || 0) + 1; }); });
    o.paragraph_styles = (doc.pstyles || []).map(function (p) {
      var e = { name: psName[p.id], paragraphs: used[p.id] || 0 };
      if (p.base) e.based_on = psName[p.base] || p.base;
      ["font", "size", "lead", "align", "b", "i", "caps", "track", "sb", "sa", "fi", "li", "ri"].forEach(function (k) { if (p[k] !== undefined && p[k] !== "" && p[k] !== 0) e[k] = p[k]; });
      if (p.ext && p.ext.fam) e.family = p.ext.fam;
      return e;
    });
    o.character_styles = (doc.cstyles || []).map(function (c) {
      var e = { name: csName[c.id] };
      ["b", "i", "u", "size", "color", "caps", "track"].forEach(function (k) { if (c[k] !== undefined && c[k] !== "" && c[k] !== 0) e[k] = c[k]; });
      return e;
    });
    o.masters = (doc.masters || []).map(function (m) { return msName[m.id]; });
    o.swatches = (doc.swatches || []).map(function (w) { return { name: nameOf(w.name) || w.id, mode: w.mode, value: w.v }; });
    if (opts.fonts) o.fonts_in_use = opts.fonts;
    if (opts.problems) o.preflight = opts.problems;
    if (opts.lastExport) o.last_export = opts.lastExport;
    return o;
  }

  var api = { natSort: natSort, natCmp: natCmp, normPath: normPath, pathOk: pathOk, makeDoc: makeDoc, frameFor: frameFor, placePictures: placePictures,
              fullPage: fullPage, bleedTargets: bleedTargets, needPx: needPx, applyFill: applyFill, noBleed: noBleed, outline: outline, PIC: PIC };
  if (node) module.exports = api;
  else root.LayoutPro = api;
})(typeof window !== "undefined" ? window : this);
