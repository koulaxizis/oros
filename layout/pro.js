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
  function Rd() { return node ? require("../designkit/render.js") : root.orosDK && root.orosDK.render; }
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
  // a starter book (LY-N1): layout/starters.js where it is loaded
  function starter() { return node ? require("./starters.js") : root.LY_START; }
  function makeDoc(st, now) {
    var u = PT_PER[st.u] ? st.u : "mm";
    var w = toPt(st.w, u), h = toPt(st.h, u);
    var SK = st.starter ? starter() : null;
    if (SK && SK.kindOf(st.starter)) return fromStarter(SK, st, w, h, now);
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
  // the starter, with the margins, bleed, grid and colour asked for
  function fromStarter(SK, st, w, h, now) {
    var LYw = !node && root.LY;
    var doc = SK.build({
      kind: st.starter, w: w, h: h, pair: st.pair || "", now: now, name: st.title || "",
      meta: { title: st.title || "" }, t: LYw && LYw.t, names: LYw && LYw.startUI && LYw.startUI.names
    });
    var s = doc.setup, x = s.ext || {};
    var mg = function (k, v) { if (typeof v === "number" && v >= 0) s[k] = v * MM; };
    mg("mt", st.t); mg("mb", st.b); mg("mi", st.i); mg("mo", st.o);
    if (typeof st.mm === "number" && st.mm >= 0 && st.mm !== 3) s.bleed = st.mm * MM;
    if (st.ncol > 1) s.cols = st.ncol;
    if (typeof st.gut === "number" && st.gut >= 0) s.gut = st.gut * MM;
    if (st.slug > 0) x.slug = r3(st.slug * MM);
    if (st.grid > 0) x.bg = { st: r3(st.grid), s: r3(s.mt) };
    if (st.color === "cmyk") { x.cm = "cmyk"; x.icc = st.icc || "fogra39"; }
    s.ext = x;
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
  // to the nearest 0.5 pt (a play's sizes and spaces: 16.8 → 17, 12.075 → 12)
  function h5(n) { return Math.round(n * 2) / 2; }

  // ---------- pages from pictures ----------
  function renumber(order, now) {
    order.forEach(function (p, i) { if (p.pos !== (i + 1) * 1024) { p.pos = (i + 1) * 1024; M.touch(p, now); } });
  }
  // The frame of a picture on a page of side `sd` for fit mode `fit`.
  function frameFor(doc, sd, fit, pg) {
    var s = M.pageSize(doc, pg);
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
      var pg = ins[k++], idx = order.indexOf(pg), f = frameFor(doc, M.sideOf(doc, idx), st.fit, pg);
      var it = { id: nid("it"), m: now, t: "img", pg: pg.id, x: r3(f.x), y: r3(f.y), w: r3(f.w), h: r3(f.h), a: p.a, nm: String(p.nm || "").slice(0, 120),
                 iw: p.iw, ih: p.ih, fit: f.fit, sw: 0, z: (z += 16) };
      if (p.lc) it.ext = { lc: 1 };   // LOCAL-1: copied in from a local folder
      doc.items.push(it);
      ids.push(it.id);
    });
    return { pages: add.length, blank: blank, items: ids, first: at + blank + 1 };
  }

  // ---------- bleed of full-page pictures ----------
  var EPS = 0.75;   // points
  // A picture that covers the whole trim of its page.
  function pageOfItem(doc, it) {
    for (var i = 0; i < doc.pages.length; i++) if (doc.pages[i].id === it.pg) return doc.pages[i];
    return null;
  }
  function fullPage(doc, it) {
    var s = M.pageSize(doc, pageOfItem(doc, it));
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
    var b = M.bleeds(doc, sd), s = M.pageSize(doc, pageOfItem(doc, it));
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
    var labels = M.pageLabels(doc);
    o.page_list = order.slice(0, MAX_PAGES_OUT).map(function (p, i) {
      var e = { page: i + 1, number: labels[i].label, side: M.sideOf(doc, i) === "L" ? "left" : "right", id: p.id };
      if (p.ms) e.master = msName[p.ms] || "";
      var sc = M.secOfPage(p);
      if (sc) e.section = { start: sc.n >= 0 ? sc.n : "continues", numstyle: sc.f, prefix: sc.pre };
      var ps = M.pageSize(doc, p);
      if (ps.own) e.trim_mm = { w: mm(ps.w), h: mm(ps.h) };
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
        if (it.ext && it.ext.fl) f.flip = it.ext.fl;
        var adj = Rd() && Rd().adjOf(it);
        if (adj) f.adj = adj;                    // colour corrections (W4b)
        if (it.r) f.corner_mm = mm(it.r);
        if (it.mf) f.merge_field = it.mf;
      }
      if (it.t === "text") { f.story = it.story; f.columns = it.cols || 1; }
      if (it.ext && typeof it.ext.anc === "string") f.anchored_in = it.ext.anc;   // W4b
      if (it.t === "img" && it.ext && it.ext.pp) f.page_of = { file: it.ext.pp.f, page: it.ext.pp.p };
      if (it.wrap && it.wrap !== "none") { f.wrap = it.ext && it.ext.wc ? it.ext.wc : it.wrap; f.wrap_mm = mm(it.wo || 0); }   // W4b
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
        // opts.full (Chris 2026-11-18): whole paragraphs, for proofreading
        var cap = opts.full ? 20000 : MAX_PARA;
        var t = paraText(p), q = { style: psName[p.ps || "ps-base"] || p.ps || "", text: t.length > cap ? t.slice(0, cap) + "…" : t };
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
      if (p.ext && Array.isArray(p.ext.nest) && p.ext.nest[0]) e.nested = p.ext.nest.map(function (q) { return { character_style: csName[q.cs] || q.cs, through: q.to }; });
      if (p.ext && p.ext.kwn) e.keep_with_next = true;
      if (p.ext && p.ext.brk) e.starts = p.ext.brk;
      return e;
    });
    o.character_styles = (doc.cstyles || []).map(function (c) {
      var e = { name: csName[c.id] };
      ["b", "i", "u", "size", "color", "caps", "track"].forEach(function (k) { if (c[k] !== undefined && c[k] !== "" && c[k] !== 0) e[k] = c[k]; });
      return e;
    });
    o.masters = (doc.masters || []).map(function (m) { return msName[m.id]; });
    o.master_list = (doc.masters || []).map(function (m) { var e = { name: msName[m.id], prefix: m.pre }; if (m.ext && m.ext.base && msName[m.ext.base]) e.based_on = msName[m.ext.base]; return e; });
    o.swatches = (doc.swatches || []).map(function (w) { return { name: nameOf(w.name) || w.id, mode: w.mode, value: w.v }; });
    if (opts.fonts) o.fonts_in_use = opts.fonts;
    if (opts.problems) o.preflight = opts.problems;
    if (opts.livePf) o.preflight_now = opts.livePf;
    if (opts.lastExport) o.last_export = opts.lastExport;
    return o;
  }


  // ---------- W2: styles, text frames, house pages ----------
  // A style by id or by any of its names (case and white space folded).
  function styleNamed(list, v) {
    if (!v) return null;
    var want = String(v).replace(/\s+/g, " ").trim().toLocaleLowerCase(), hit = null;
    (list || []).forEach(function (e) {
      if (hit) return;
      if (e.id === v) { hit = e; return; }
      var n = e.name, names = n && typeof n === "object" ? Object.keys(n).map(function (k) { return n[k]; }) : [n];
      names.forEach(function (x) { if (!hit && typeof x === "string" && x.replace(/\s+/g, " ").trim().toLocaleLowerCase() === want) hit = e; });
    });
    return hit;
  }
  function slugId(pre, name, list, idf) {
    var base = fold(name).replace(/[^a-z0-9]+/g, "").slice(0, 14);
    var id = base ? pre + "-ly" + base : (idf || M.newId)(pre);
    if (!(list || []).some(function (e) { return e.id === id; })) return id;
    return (idf || M.newId)(pre);
  }
  // defstyle: a paragraph (kind para) or character style made or
  // changed by name. Lengths in pt; nest_cs + nest_to: a nested style.
  // → number of styles made or changed (0 when nothing differs).
  // A font by the name list_fonts shows (Chris 2026-11-18: "defstyle
  // font Carlito"): the built-in families by key or name, a family the
  // document lists (setup.ext.fonts), or one Layout found before the
  // run (found: { key: entry }, from the disk or Fontsource, as
  // fonts.js match()). → { font, fam?, entry? } or null.
  var BUILT_FONT = { serif: "serif", sans: "sans", mono: "mono", notoserif: "serif", notosans: "sans", notosansmono: "mono" };
  var FAM_ID = /^(fs|uf)_[a-z0-9]+(_[a-z0-9]+)*$/;
  function fontKey(name) { return fold(name).replace(/[^a-z0-9]/g, ""); }
  function fontFor(doc, name, found) {
    var k = fontKey(name);
    if (!k) return null;
    if (BUILT_FONT[k]) return { font: BUILT_FONT[k] };
    var list = (doc.setup && doc.setup.ext && Array.isArray(doc.setup.ext.fonts)) ? doc.setup.ext.fonts : [];
    var e = list.filter(function (x) { return x && (x.id === name || fontKey(x.name) === k); })[0] || (found && found[k]) || null;
    if (!e || !FAM_ID.test(e.id)) return null;
    return { font: BUILT_FONT[e.fb] || "serif", fam: e.id, entry: e };
  }
  // The family in the document's list (setup.ext.fonts, at most 40):
  // → 1 when the list changed.
  function listFont(doc, e) {
    if (!e || !FAM_ID.test(e.id)) return 0;
    doc.setup.ext = doc.setup.ext || {};
    var list = Array.isArray(doc.setup.ext.fonts) ? doc.setup.ext.fonts : [];
    var o = { id: e.id, name: String(e.name || e.id).replace(/[\u0000-\u001F]/g, "").slice(0, 60), fb: BUILT_FONT[e.fb] || "serif" };
    if (e.id.indexOf("uf_") === 0) ["r", "b", "i", "bi"].forEach(function (v) { if (typeof e[v] === "string" && /^[0-9a-f]{64}\.ttf$/.test(e[v])) o[v] = e[v]; });
    var cur = list.filter(function (x) { return x && x.id === o.id; })[0];
    if (cur && JSON.stringify(cur) === JSON.stringify(o)) return 0;
    doc.setup.ext.fonts = list.filter(function (x) { return !x || x.id !== o.id; }).concat([o]).slice(-40);
    return 1;
  }
  var PS_SET = { size: 1, lead: 1, align: 1, track: 1, sb: 1, sa: 1, fi: 1, li: 1, ri: 1 };
  function defStyle(doc, st, now, idf, env) {
    var para = st.kind !== "char", list = para ? doc.pstyles : doc.cstyles, pre = para ? "ps" : "cs";
    if (!st.name) return 0;
    var cur = styleNamed(list, st.name), made = 0;
    if (!cur) {
      cur = { id: slugId(pre, st.name, list, idf), m: now, name: String(st.name).slice(0, 60) };
      if (para) cur.base = "ps-base";
      list.push(cur); made = 1;
    }
    var set = {};
    if (st.base) { var b = styleNamed(list, st.base); if (b && b.id !== cur.id) set.base = b.id; }
    Object.keys(PS_SET).forEach(function (k) {
      if (!para && !{ size: 1, track: 1 }[k]) return;
      if (st[k] === undefined || st[k] === null || st[k] === "" || (typeof st[k] === "number" && st[k] < 0)) return;
      if ((k === "size" || k === "lead" || k === "track") && st[k] === 0) return;   // 0: as it is (as the style command)
      set[k] = st[k];
    });
    [["bold", "b"], ["ital", "i"], ["caps", "caps"], ["under", "u"]].forEach(function (kv) { var v = st[kv[0]]; if (v === "on" || v === "off") set[kv[1]] = v === "on" ? 1 : 0; });
    if (st.color) { var sw = swatchFor(doc, st.color, now); if (sw) set.color = sw; }
    var fam;   // undefined: as it is; "": a built-in; an id: that family
    if (st.font) {
      var ff = fontFor(doc, st.font, env && env.fonts);
      // before Layout looked (the card's preview) a family it may still find counts as a change
      if (!ff && !(env && env.prepared)) made = 1;
      else if (!ff) { if (env.notes) { var nf = "noFont: " + String(st.font).slice(0, 60); if (env.notes.indexOf(nf) < 0) env.notes.push(nf); } }
      else { set.font = ff.font; fam = ff.fam || ""; if (ff.entry) listFont(doc, ff.entry); }
    }
    var n = made;
    Object.keys(set).forEach(function (k) { if (cur[k] !== set[k]) { cur[k] = set[k]; n = 1; } });
    var x = cur.ext || {};
    if (fam !== undefined && (x.fam || "") !== fam) { if (fam) x.fam = fam; else delete x.fam; n = 1; }
    if (para && st.nest_cs && st.nest_cs !== "none") {
      var cs = styleNamed(doc.cstyles, st.nest_cs), to = String(st.nest_to || ":").slice(0, 4);
      if (cs) {
        var want = [{ cs: cs.id, to: to }];
        if (JSON.stringify(x.nest || null) !== JSON.stringify(want)) { x.nest = want; n = 1; }
      }
    }
    if (para && st.nest_cs === "none" && x.nest) { delete x.nest; n = 1; }
    if (para) {
      if (st.keep === "on" || st.keep === "off") { var kv2 = st.keep === "on" ? 1 : 0; if (x.kwn !== kv2) { x.kwn = kv2; n = 1; } }
      if (st.brk) { var bv = st.brk === "any" ? "" : st.brk; if ((x.brk || "") !== bv) { x.brk = bv; n = 1; } }
      if (st.hyph === "on" || st.hyph === "off") { var hv = st.hyph === "on" ? 1 : 0; if (x.hyph !== hv) { x.hyph = hv; n = 1; } }
    }
    if (Object.keys(x).length) cur.ext = x;
    if (n) M.touch(cur, now);
    return n;
  }
  // "#1a6fb0" (or a swatch's name) → a swatch id; a new RGB swatch is
  // made for a colour the document does not have.
  function swatchFor(doc, v, now) {
    var hit = styleNamed(doc.swatches, v);
    if (hit) return hit.id;
    var m = /^#?([0-9a-f]{6})$/i.exec(String(v).trim());
    if (!m) return "";
    var hex = m[1].toLowerCase(), rgb = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4), 16)];
    var same = (doc.swatches || []).filter(function (w) { return w.mode === "rgb" && w.v && w.v[0] === rgb[0] && w.v[1] === rgb[1] && w.v[2] === rgb[2]; })[0];
    if (same) return same.id;
    var id = "sw-ly" + hex;
    doc.swatches = doc.swatches || [];
    if (!doc.swatches.some(function (w) { return w.id === id; })) doc.swatches.push({ id: id, m: now, name: "#" + hex, mode: "rgb", v: rgb });
    return id;
  }
  // A play's styles (spec item 18): cast list, act and scene headings,
  // dialogue with the speaker as a nested character style up to ":",
  // stage directions, songs. Names in the book's language (el / en).
  // i18n-inline-ok: style names that go into the document, in the book's language
  var PLAY = {
    el: { speaker: "Ομιλητής", cast_h: "Πρόσωπα (τίτλος)", cast: "Πρόσωπα", act: "Πράξη", scene: "Σκηνή", line: "Διάλογος", dir: "Σκηνική οδηγία", song: "Τραγούδι" },
    en: { speaker: "Speaker", cast_h: "Cast list heading", cast: "Cast list", act: "Act heading", scene: "Scene heading", line: "Dialogue", dir: "Stage direction", song: "Song" }
  };
  function playStyles(doc, lang, now) {
    var N = PLAY[lang] || PLAY.el, base = M.find(doc.pstyles, "ps-base") || {}, sz = base.size || 11, n = 0;
    function cs(key, o) { if (M.find(doc.cstyles, "cs-play" + key)) return; doc.cstyles.push(Object.assign({ id: "cs-play" + key, m: now, name: N[key] }, o)); n++; }
    function ps(key, o, x) { if (M.find(doc.pstyles, "ps-play" + key)) return; var e = Object.assign({ id: "ps-play" + key, m: now, name: N[key], base: "ps-base" }, o); if (x) e.ext = x; doc.pstyles.push(e); n++; }
    cs("speaker", { b: 1, caps: 1, track: 20 });
    ps("cast_h", { size: h5(sz * 1.25), b: 1, align: "c", sa: h5(sz) }, { kwn: 1, hyph: 0 });
    ps("cast", { sa: h5(sz * 0.3) }, { hyph: 0 });
    ps("act", { size: h5(sz * 1.6), b: 1, caps: 1, align: "c", sb: h5(sz * 2), sa: h5(sz) }, { kwn: 1, hyph: 0, brk: "page" });
    ps("scene", { size: h5(sz * 1.15), b: 1, align: "c", sb: h5(sz), sa: h5(sz * 0.5) }, { kwn: 1, hyph: 0 });
    ps("line", { sa: h5(sz * 0.35) }, { nest: [{ cs: "cs-playspeaker", to: ":" }] });
    ps("dir", { i: 1, li: h5(sz * 1.6), sa: h5(sz * 0.35) });
    ps("song", { i: 1, li: h5(sz * 3.2), sa: 0 }, { hyph: 0 });
    return n;
  }
  // Paragraphs as the model writes them: "[Style] text" picks the
  // paragraph style, "{Char style|text}" a character style; anything
  // else is text. → [{ ps, runs }]
  function parseParas(doc, list, def) {
    var dps = (def && styleNamed(doc.pstyles, def)) || null;
    return (list || []).map(function (raw) {
      var t = String(raw == null ? "" : raw), ps = dps ? dps.id : "ps-base";
      var m = /^\s*\[([^\[\]]{1,60})\]\s?/.exec(t);
      if (m) { var hit = styleNamed(doc.pstyles, m[1]); if (hit) { ps = hit.id; t = t.slice(m[0].length); } }
      var runs = [], re = /\{([^{}|]{1,60})\|([^{}]*)\}/g, at = 0, k;
      while ((k = re.exec(t))) {
        var c = styleNamed(doc.cstyles, k[1]);
        if (!c) continue;
        if (k.index > at) runs.push({ t: t.slice(at, k.index) });
        if (k[2]) runs.push({ t: k[2], cs: c.id });
        at = k.index + k[0].length;
      }
      if (at < t.length) runs.push({ t: t.slice(at) });
      return { ps: ps, runs: runs };
    });
  }
  // frame: a text frame with its own story on a page (1-based), at a
  // box in mm (x/y/w/h −1: the page's margins), above what is there.
  // → { id, story } or null
  // the commands' t|m|b (j as t: no vertical justify yet) → the model's t|c|b
  function vaOf(v) { return v === "m" || v === "c" ? "c" : v === "b" ? "b" : "t"; }
  function addFrame(doc, st, now, idf) {
    var nid = idf || M.newId, order = M.pagesInOrder(doc), pg = order[(st.page || 1) - 1];
    if (!pg) return null;
    var idx = order.indexOf(pg), mg = M.margins(doc, M.sideOf(doc, idx)), s = M.pageSize(doc, pg);
    var box = { x: mg.l, y: mg.t, w: s.w - mg.l - mg.r, h: s.h - mg.t - mg.b };
    var x = st.x >= 0 ? st.x * MM : box.x, y = st.y >= 0 ? st.y * MM : box.y;
    var w = st.w > 0 ? st.w * MM : (st.x >= 0 ? s.w - mg.r - x : box.w), h = st.h > 0 ? st.h * MM : (st.y >= 0 ? s.h - mg.b - y : box.h);
    var paras = parseParas(doc, st.lines, st.style);
    if (st.clear) clearPage(doc, pg.id, now);
    var sid = nid("st"), id = nid("it");
    doc.stories.push({ id: sid, m: now, h: [], paras: paras.length ? paras : [{ ps: "ps-base", runs: [] }] });
    var z = doc.items.reduce(function (a, it) { return it.pg === pg.id ? Math.max(a, it.z || 0) : a; }, 0) + 16;
    var it = { id: id, m: now, t: "text", pg: pg.id, story: sid, x: r3(x), y: r3(y), w: r3(Math.max(5, w)), h: r3(Math.max(5, h)), z: z,
               cols: st.ncol || 1, gut: r3((st.gut >= 0 ? st.gut : 5) * MM), ins: r3((st.ins > 0 ? st.ins : 0) * MM), va: vaOf(st.va), sw: 0 };
    if (st.fill) { var f = swatchFor(doc, st.fill, now); if (f) it.fill = f; }
    if (st.opacity >= 0 && st.opacity < 100) it.op = st.opacity;
    doc.items.push(it);
    return { id: id, story: sid };
  }
  // framemod (Chris 2026-11-18, P0): frames by id (as the document's
  // frames list shows them) get a new place or size (mm from the page's
  // top left, -1 = as it is), columns, gutter, inset, vertical
  // alignment, fill (nofill: none), opacity; del removes them (a story
  // goes with its last frame, its text stays in the other frames of the
  // chain). → the number of frames changed.
  function modFrame(doc, ids, st, now) {
    var n = 0, gone = {};
    if (!doc.tombs) doc.tombs = {};
    ids.forEach(function (id) {
      var it = M.find(doc.items, id);
      if (!it) return;
      if (st.del) { gone[it.id] = it; n++; return; }
      var set = {};
      ["x", "y", "w", "h"].forEach(function (k) { if (st[k] >= 0 && (k === "x" || k === "y" || st[k] > 0)) set[k] = r3(Math.max(k === "w" || k === "h" ? 1 : -1e6, st[k] * MM)); });
      if (it.t === "text") {
        if (st.ncol > 0) set.cols = st.ncol;
        if (st.gut >= 0) set.gut = r3(st.gut * MM);
        if (st.ins >= 0) set.ins = r3(st.ins * MM);
        if (st.va) set.va = vaOf(st.va);
      }
      if (st.fill) { var f = swatchFor(doc, st.fill, now); if (f) set.fill = f; }
      if (st.opacity >= 0) set.op = st.opacity;
      var k = 0;
      Object.keys(set).forEach(function (key) { if (it[key] !== set[key]) { it[key] = set[key]; k = 1; } });
      if (st.nofill && it.fill) { delete it.fill; k = 1; }
      if (st.opacity === 100 && it.op !== undefined) { delete it.op; k = 1; }
      if (k) { M.touch(it, now); n++; }
    });
    var ids2 = Object.keys(gone);
    if (ids2.length) {
      var stories = {};
      doc.items = doc.items.filter(function (it) {
        if (!gone[it.id]) return true;
        doc.tombs[it.id] = Math.max(now, doc.tombs[it.id] || 0);
        if (it.story) stories[it.story] = 1;
        return false;
      });
      doc.items.forEach(function (it) { if (it.story) delete stories[it.story]; });
      doc.stories = doc.stories.filter(function (sx) {
        if (!stories[sx.id]) return true;
        doc.tombs[sx.id] = Math.max(now, doc.tombs[sx.id] || 0);
        return false;
      });
    }
    return n;
  }
  // Everything on a page goes (tombstones, so the deletion syncs); a
  // story goes with its last frame.
  function clearPage(doc, pgId, now) {
    var gone = 0, left = {};
    if (!doc.tombs) doc.tombs = {};
    doc.items = doc.items.filter(function (it) {
      if (it.pg !== pgId) return true;
      doc.tombs[it.id] = Math.max(now, doc.tombs[it.id] || 0); gone++;
      if (it.story) left[it.story] = 1;
      return false;
    });
    doc.items.forEach(function (it) { if (it.story) delete left[it.story]; });
    doc.stories = doc.stories.filter(function (s) {
      if (!left[s.id]) return true;
      doc.tombs[s.id] = Math.max(now, doc.tombs[s.id] || 0);
      return false;
    });
    return gone;
  }
  // retext: replace the paragraphs of a story (by id, or the story of
  // a frame id) with new ones.
  function setStory(doc, st, now) {
    var sid = st.story, fr = !sid && st.frame ? M.find(doc.items, st.frame) : null;
    if (fr && fr.t === "text") sid = fr.story;
    var story = sid && M.find(doc.stories, sid);
    if (!story) return 0;
    var paras = parseParas(doc, st.lines, st.style);
    story.paras = paras.length ? paras : [{ ps: "ps-base", runs: [] }];
    M.touch(story, now);
    return 1;
  }

  // house_pages: the front and back pages of a house style document
  // (LY-HS: pages before / after its body page) copied into the book,
  // scaled to its trim, their fields ({title} {author} …) filled from
  // meta; blank pages pad the book to a multiple of `pad` (before the
  // back pages), and with keep the first page of the book keeps its
  // side. → { front, back, blank }
  function housePages(doc, house, meta, st, now, idf, fill) {
    var nid = idf || M.newId, out = { front: 0, back: 0, blank: 0 };
    if (!house) return out;
    var ho = M.pagesInOrder(house), bi = -1;
    ho.forEach(function (p, i) { if (bi < 0 && p.ext && p.ext.hs === "body") bi = i; });
    var front = bi < 0 ? ho.slice() : ho.slice(0, bi), back = bi < 0 ? [] : ho.slice(bi + 1);
    if (st.where === "front") back = [];
    if (st.where === "back") front = [];
    if (st.where === "none") { front = []; back = []; }
    var sx = doc.setup.w / house.setup.w, sy = doc.setup.h / house.setup.h, k = Math.min(sx, sy);
    var have = {};
    ["pstyles", "cstyles", "swatches"].forEach(function (list) { (doc[list] || []).forEach(function (e) { have[e.id] = 1; }); });
    function needStyle(list, id) {
      var seen = 0;
      while (id && !have[id] && seen++ < 16) {
        var e = M.find(house[list] || [], id);
        if (!e) return;
        var c = JSON.parse(JSON.stringify(e)); c.m = now;
        doc[list] = doc[list] || [];
        doc[list].push(c); have[id] = 1;
        if (c.color) needStyle("swatches", c.color);
        id = c.base;
      }
    }
    var stories = [], items = [];
    function copyPage(p) {
      var np = { id: nid("pg"), m: now, pos: 0, ms: M.find(doc.masters, p.ms) ? p.ms : "" };
      house.items.forEach(function (it) {
        if (it.pg !== p.id) return;
        var c = JSON.parse(JSON.stringify(it));
        c.id = nid("it"); c.pg = np.id; c.m = now;
        c.x = r3(c.x * sx); c.y = r3(c.y * sy); c.w = r3(c.w * (c.t === "text" ? sx : k)); c.h = r3(c.h * (c.t === "text" ? sy : k));
        if (c.t === "img" || c.t === "rect" || c.t === "ell" || c.t === "path") { c.x = r3(it.x * sx + (it.w * sx - c.w) / 2); c.y = r3(it.y * sy + (it.h * sy - c.h) / 2); }
        if (c.fill) needStyle("swatches", c.fill);
        if (c.stroke) needStyle("swatches", c.stroke);
        if (c.t === "text") {
          var s0 = M.find(house.stories, it.story);
          if (!s0) return;
          var sc = JSON.parse(JSON.stringify(s0)); sc.id = nid("st"); sc.m = now; sc.h = [];
          sc.paras.forEach(function (pa) { needStyle("pstyles", pa.ps); (pa.runs || []).forEach(function (r) { if (r.cs) needStyle("cstyles", r.cs); }); });
          c.story = sc.id;
          stories.push(sc);
        }
        items.push(c);
      });
      return np;
    }
    var F = front.map(copyPage), B = back.map(copyPage);
    var order = M.pagesInOrder(doc);
    var lead = F.slice();
    if (st.keep && doc.setup.facing && F.length % 2 === 1) { lead.push({ id: nid("pg"), m: now, pos: 0, ms: order[0] ? order[0].ms : "" }); out.blank++; }
    var total = lead.length + order.length + B.length, pad = st.pad || 0, fillN = pad > 1 ? (pad - total % pad) % pad : 0;
    fillN = Math.min(fillN, M.MAX_PAGES - total);
    var mid = [];
    for (var i = 0; i < fillN; i++) mid.push({ id: nid("pg"), m: now, pos: 0, ms: order.length ? order[order.length - 1].ms : "" });
    out.blank += mid.length;
    var all = lead.concat(order, mid, B).slice(0, M.MAX_PAGES);
    renumber(all, now);
    doc.pages = all;
    doc.items = doc.items.concat(items);
    doc.stories = doc.stories.concat(stories);
    if (fill && meta) { var tmp = { stories: stories }; fill(tmp, meta); }
    out.front = F.length; out.back = B.length;
    return out;
  }

  // ---------- W3: pages, sections and masters ----------
  // section: page `page` (1-based) opens a section: start (−1 = the
  // count goes on), numstyle 1|i|I|a|A, prefix; off removes it.
  function setSection(doc, st, now) {
    var pg = M.pagesInOrder(doc)[(st.page || 1) - 1];
    if (!pg) return 0;
    var x = pg.ext || {}, before = JSON.stringify(x.sec || null);
    if (st.off) delete x.sec;
    else x.sec = { n: st.start >= 0 ? st.start : -1, f: st.numstyle || "1", pre: String(st.prefix || "").slice(0, 8) };
    if (JSON.stringify(x.sec || null) === before) return 0;
    if (Object.keys(x).length) pg.ext = x; else delete pg.ext;
    M.touch(pg, now);
    return 1;
  }
  // picture (W4): the picture frames `ids` (or every picture on the
  // pages `want` picks): flip none|h|v|hv, corner radius (pt, −1 = as
  // it is), fit fit|fill|frame (frame: the frame takes the picture's
  // proportions, keeping its width), adj colour corrections (W4b: a
  // record as R.adjNorm reads, merged by kind, or "none"). → number
  // changed
  function setPicture(doc, ids, want, st, now) {
    var on = {}, n = 0;
    if (want) M.pagesInOrder(doc).forEach(function (p, i) { if (want(i + 1)) on[p.id] = 1; });
    var pick = ids && ids.length ? function (it) { return ids.indexOf(it.id) >= 0; } : function (it) { return !!on[it.pg]; };
    doc.items.forEach(function (it) {
      if (it.t !== "img" || it.lock || !pick(it)) return;
      var before = JSON.stringify([it.ext && it.ext.fl, it.ext && it.ext.adj, it.r, it.fit, it.w, it.h, it.isc, it.ix, it.iy]);
      if (st.flip) {
        var x = it.ext || {};
        if (st.flip === "none") delete x.fl; else x.fl = st.flip;
        if (Object.keys(x).length) it.ext = x; else delete it.ext;
      }
      // colour corrections (W4b): "none" takes them all off; a record
      // sets the corrections it names (one that changes nothing goes)
      if (st.adj) {
        var R = Rd(), xa = it.ext || {};
        if (st.adj === "none") delete xa.adj;
        else if (R && typeof st.adj === "object") {
          var na = Object.assign({}, R.adjNorm(xa.adj) || {}, st.adj);
          na = R.adjNorm(na);
          if (na) xa.adj = na; else delete xa.adj;
        }
        if (Object.keys(xa).length) it.ext = xa; else delete it.ext;
      }
      if (st.corner >= 0) it.r = r3(Math.min(st.corner, Math.min(it.w, it.h) / 2));
      if (st.fit === "fit" || st.fit === "fill") { it.fit = st.fit; it.ix = 0; it.iy = 0; it.isc = 1; }
      else if (st.fit === "frame" && it.iw && it.ih) { it.h = r3(it.w * it.ih / it.iw); it.fit = "fill"; it.ix = 0; it.iy = 0; it.isc = 1; }
      if (it.ext && it.ext.iscy !== undefined && st.fit) { delete it.ext.iscy; if (!Object.keys(it.ext).length) delete it.ext; }
      if (JSON.stringify([it.ext && it.ext.fl, it.ext && it.ext.adj, it.r, it.fit, it.w, it.h, it.isc, it.ix, it.iy]) === before) return;
      M.touch(it, now);
      n++;
    });
    return n;
  }
  // A page of a PDF / Scribus / InDesign file as the picture of frame
  // `id` (W4b): pic = { a, iw, ih, nm, pp: { f, k, p } } (io.js
  // pageImage); the whole page shows (fit). → true if changed
  function setPage(doc, id, pic, now) {
    var it = M.find(doc.items, id);
    if (!it || it.t !== "img" || it.lock || !pic || !pic.a) return false;
    it.a = pic.a; it.nm = String(pic.nm || "").slice(0, 120); it.iw = pic.iw; it.ih = pic.ih;
    it.fit = "fit"; it.ix = 0; it.iy = 0; it.isc = 1;
    var x = it.ext || {};
    delete x.iscy; delete x.wpr; delete x.wpa;
    if (pic.pp) x.pp = { f: String(pic.pp.f || "").slice(0, 120), k: pic.pp.k, p: pic.pp.p };
    it.ext = x;
    M.touch(it, now);
    return true;
  }
  // Anchored objects (W4b): the frame `id` (a picture or a shape, not
  // on a master) goes into the story `sid` at paragraph `pi` (0-based),
  // character `off` (clamped; -1 = the paragraph's end) as a U+FFFC
  // run with ext.obj = id; it.ext.anc = sid. From then on the text
  // carries it (render.js computeLayout). One place at a time: an
  // anchor it had goes first. → true if done
  function unanchorRuns(doc, id, now) {
    var n = 0;
    doc.stories.forEach(function (st) {
      var hit = false;
      st.paras.forEach(function (p) {
        (p.runs || []).forEach(function (r) {
          if (!r.ext || r.ext.obj !== id || typeof r.t !== "string" || r.t.indexOf("\uFFFC") < 0) return;
          r.t = r.t.split("\uFFFC").join("");
          hit = true;
        });
        p.runs = (p.runs || []).filter(function (r) { return r.f || (typeof r.t === "string" && r.t.length); });
      });
      if (hit) { M.touch(st, now); n++; }
    });
    return n;
  }
  function anchorItem(doc, id, sid, pi, off, now) {
    var it = M.find(doc.items, id), st = M.story(doc, sid);
    if (!it || !st || it.t === "text" || it.lock || M.find(doc.masters, it.pg) || !st.paras.length) return false;
    unanchorRuns(doc, id, now);
    var p = st.paras[Math.max(0, Math.min(st.paras.length - 1, pi | 0))];
    var runs = p.runs || [], at = off < 0 ? Infinity : off | 0, pos = 0, out = [], put = false;
    // never inside a word: back to where it starts
    var plain = runs.map(function (r) { return r.f ? "#" : String(r.t || ""); }).join("");
    if (at !== Infinity) { at = Math.min(at, plain.length); while (at > 0 && !/[\s\u00a0\uFFFC]/.test(plain[at - 1])) at--; }
    var obj = { t: "\uFFFC", ext: { obj: id } };
    runs.forEach(function (r) {
      var len = r.f ? 1 : String(r.t || "").length;
      if (!put && at <= pos + len && !r.f && at - pos > 0 && at - pos < len) {
        var a = JSON.parse(JSON.stringify(r)), b = JSON.parse(JSON.stringify(r));
        a.t = r.t.slice(0, at - pos); b.t = r.t.slice(at - pos);
        out.push(a, obj, b); put = true;
      } else {
        if (!put && at <= pos) { out.push(obj); put = true; }
        out.push(r);
      }
      pos += len;
    });
    if (!put) out.push(obj);
    p.runs = out;
    M.touch(st, now);
    var x = it.ext || {};
    x.anc = sid;
    it.ext = x;
    M.touch(it, now);
    return true;
  }
  // The frame goes back to being a free frame where it is now.
  function releaseItem(doc, id, now) {
    var it = M.find(doc.items, id);
    if (!it || !it.ext || typeof it.ext.anc !== "string") return false;
    unanchorRuns(doc, id, now);
    delete it.ext.anc;
    if (!Object.keys(it.ext).length) delete it.ext;
    M.touch(it, now);
    return true;
  }

  // Text wrap of frames (W4b): st.wrap none|box|ell, st.wo the offset
  // (pt, -1 = as it is), st.wc box|shape|alpha (by the frame, its
  // outline or a picture's transparent edges; alpha on pictures only),
  // st.prof { id: profile } read from the pictures (R.alphaProfile;
  // [] = no transparent edges); without one Layout reads it when the
  // picture loads (io.js fillWrapProfiles). A wc other than box turns a
  // wrap that was none on. → number changed
  function setWrap(doc, ids, st, now) {
    var n = 0;
    doc.items.forEach(function (it) {
      if (ids.indexOf(it.id) < 0 || it.lock) return;
      var before = JSON.stringify([it.wrap, it.wo, it.ext && it.ext.wc, it.ext && it.ext.wpr, it.ext && it.ext.wpa]);
      if (st.wrap) it.wrap = st.wrap;
      if (st.wo >= 0) it.wo = r3(Math.min(500, st.wo));
      var wc = st.wc === "alpha" && !(it.t === "img" && it.a) ? "" : st.wc;
      if (wc) {
        var x = it.ext || {}, oldPr = x.wpr, oldPa = x.wpa;
        delete x.wpr; delete x.wpa;
        if (wc === "box") delete x.wc;
        else {
          x.wc = wc;
          if (wc === "alpha" && st.prof && Array.isArray(st.prof[it.id])) { x.wpr = st.prof[it.id]; x.wpa = it.a; }
          else if (wc === "alpha" && Array.isArray(oldPr) && oldPa === it.a) { x.wpr = oldPr; x.wpa = oldPa; }
          if (it.wrap === "none" && !st.wrap) it.wrap = "box";
        }
        if (Object.keys(x).length) it.ext = x; else delete it.ext;
      }
      if (JSON.stringify([it.wrap, it.wo, it.ext && it.ext.wc, it.ext && it.ext.wpr, it.ext && it.ext.wpa]) === before) return;
      M.touch(it, now);
      n++;
    });
    return n;
  }
  // Every picture frame for the Links list: [{ id, page (1-based),
  // name, ppi, state ok|missing|empty|small|low, flip }] in page order
  // (small: a Scribus picture drawn smaller than in Scribus, isSmall).
  function links(doc, isMissing, ppiOf, low, isSmall) {
    var pos = {}, out = [];
    M.pagesInOrder(doc).forEach(function (p, i) { pos[p.id] = i + 1; });
    doc.items.forEach(function (it) {
      if (it.t !== "img" || !pos[it.pg]) return;
      var ppi = it.a && ppiOf ? Math.round(ppiOf(it)) : 0;
      var state = !it.a ? "empty" : isMissing && isMissing(it.a) ? "missing" : isSmall && isSmall(it) ? "small" : ppi && ppi < (low || 200) ? "low" : "ok";
      out.push({ id: it.id, page: pos[it.pg], name: it.nm || "", ppi: ppi, state: state, flip: it.ext && it.ext.fl || "", adj: !!(it.ext && it.ext.adj), local: !!(it.ext && it.ext.lc) });
    });
    return out.sort(function (a, b) { return a.page - b.page || M.cmpStr(a.name, b.name); });
  }
  // pagesize (W3b): the pages `want` picks get their own trim w × h
  // (pt, 36-14400); 0 × 0 = the document's again. → number changed
  function setPageSize(doc, want, w, h, now) {
    var off = !(w > 0) && !(h > 0), n = 0;
    if (!off && !(w >= 36 && w <= 14400 && h >= 36 && h <= 14400)) return 0;
    var same = !off && Math.abs(w - doc.setup.w) < 0.01 && Math.abs(h - doc.setup.h) < 0.01;
    M.pagesInOrder(doc).forEach(function (p, i) {
      if (!want(i + 1)) return;
      var x = p.ext || {}, before = JSON.stringify(x.sz || null);
      if (off || same) delete x.sz; else x.sz = { w: r3(w), h: r3(h) };
      if (JSON.stringify(x.sz || null) === before) return;
      if (Object.keys(x).length) p.ext = x; else delete p.ext;
      M.touch(p, now);
      n++;
    });
    return n;
  }
  // movepages: the pages `want` picks (1-based) go, in their order,
  // before page `to` (0 = to the end). → number moved
  function movePages(doc, want, to, now) {
    var order = M.pagesInOrder(doc), pick = [], rest = [];
    order.forEach(function (p, i) { (want(i + 1) ? pick : rest).push(p); });
    if (!pick.length || pick.length === order.length) return 0;
    var anchor = to > 0 ? order[to - 1] : null;
    while (anchor && pick.indexOf(anchor) >= 0) { var k = order.indexOf(anchor) + 1; anchor = order[k] || null; }
    var at = anchor ? rest.indexOf(anchor) : rest.length;
    var next = rest.slice(0, at).concat(pick, rest.slice(at));
    if (next.every(function (p, i) { return p === order[i]; })) return 0;
    renumber(next, now);
    return pick.length;
  }
  // duppages: copies of the pages `want` picks, after the last of them,
  // each frame with its own copy of the text it shows.
  function dupPages(doc, want, now, idf) {
    var nid = idf || M.newId, order = M.pagesInOrder(doc), pick = order.filter(function (p, i) { return want(i + 1); });
    if (!pick.length || order.length + pick.length > M.MAX_PAGES) return 0;
    var last = order.indexOf(pick[pick.length - 1]), made = [], storyMap = {};
    pick.forEach(function (p) {
      var np = { id: nid("pg"), m: now, pos: 0, ms: p.ms || "" };
      if (p.ext) { np.ext = JSON.parse(JSON.stringify(p.ext)); delete np.ext.sec; if (!Object.keys(np.ext).length) delete np.ext; }
      made.push(np);
      doc.items.filter(function (it) { return it.pg === p.id; }).forEach(function (it) {
        var c = JSON.parse(JSON.stringify(it));
        c.id = nid("it"); c.m = now; c.pg = np.id;
        if (c.t === "text") {
          if (!storyMap[c.story]) {
            var s0 = M.find(doc.stories, c.story);
            var sc = { id: nid("st"), m: now, h: [], paras: s0 ? JSON.parse(JSON.stringify(s0.paras)) : [{ ps: "ps-base", runs: [] }] };
            doc.stories.push(sc);
            storyMap[c.story] = sc.id;
          }
          c.story = storyMap[c.story];
        }
        if (c.grp) c.grp = "";
        doc.items.push(c);
      });
      (doc.guides || []).forEach(function (g) { if (g.pg === p.id) doc.guides.push({ id: nid("gd"), m: now, pg: np.id, o: g.o, p: g.p }); });
    });
    doc.pages = doc.pages.concat(made);
    renumber(order.slice(0, last + 1).concat(made, order.slice(last + 1)), now);
    return made.length;
  }
  // masterpages: the pages `want` picks get master `ms` ("" = none).
  function masterPages(doc, want, ms, now) {
    var n = 0;
    M.pagesInOrder(doc).forEach(function (p, i) { if (want(i + 1) && (p.ms || "") !== ms) { p.ms = ms; M.touch(p, now); n++; } });
    return n;
  }
  // defmaster: a master made or changed by name: its prefix (1-3
  // letters) and the master it is based on (base "none" = none).
  // masterfield (Chris 2026-11-18, P1): page numbers or a running head
  // on a master's pages, as text frames of the master (ext.mfk "pn" |
  // "rh", one per side), set again in place by a second call; hide
  // (a page list) keeps them off chosen pages (a hidden copy that
  // detaches them there, ext.mfh), show puts them back; remove takes
  // them off the master. → number of things changed, -1 no master.
  var MF_NAME = { el: { pn: "Αριθμός σελίδας", rh: "Τρέχων τίτλος", L: " (αριστερή)", R: " (δεξιά)" }, en: { pn: "Page number", rh: "Running head", L: " (left)", R: " (right)" } };
  function masterField(doc, st, now, idf, pagesOf) {
    var ms = styleNamed(doc.masters, st.master);
    if (!ms) return -1;
    var nid = idf || M.newId, kind = st.kind === "runhead" ? "rh" : "pn", n = 0;
    if (!doc.tombs) doc.tombs = {};
    var mine = doc.items.filter(function (it) { return it.pg === ms.id && it.ext && it.ext.mfk === kind; });
    function drop(list) {
      var ids = {};
      list.forEach(function (it) { ids[it.id] = 1; doc.tombs[it.id] = Math.max(now, doc.tombs[it.id] || 0); if (it.story) { doc.tombs[it.story] = Math.max(now, doc.tombs[it.story] || 0); } n++; });
      var sids = {};
      list.forEach(function (it) { if (it.story) sids[it.story] = 1; });
      doc.items = doc.items.filter(function (it) { return !ids[it.id]; });
      doc.stories = doc.stories.filter(function (x) { return !sids[x.id]; });
    }
    if (st.remove) {
      var mids = {};
      mine.forEach(function (it) { mids[it.id] = 1; });
      drop(mine.concat(doc.items.filter(function (it) { return it.ov && mids[it.ov] && it.ext && it.ext.mfh; })));
      return n;
    }
    var lang = MF_NAME[st.lang] ? st.lang : "el", N = MF_NAME[lang], s = doc.setup;
    var sides = s.facing ? ["L", "R"] : [""], pos = st.pos || "bc", top = pos.charAt(0) === "t", where = pos.charAt(1);
    var size = st.size > 0 ? st.size : 9, dist = (st.from_edge >= 0 ? st.from_edge : 10) * MM, h = r3(size * 2.2);
    var text = kind === "rh" ? String(st.text || "{title}").replace(/\{title\}/g, doc.name || "") : "";
    if (kind === "rh" && !text.trim()) return 0;
    sides.forEach(function (sd) {
      var al = where === "c" ? "c" : (where === "o") === (sd !== "L") ? "r" : "l";
      var sname = N[kind] + (where === "c" || !sd ? "" : N[sd]);
      var spec = { kind: "para", name: sname, size: size, align: al, hyph: "off" };
      if (st.font) spec.font = st.font;
      n += defStyle(doc, spec, now, idf, st.env);
      var ps = styleNamed(doc.pstyles, sname);
      var mg = M.margins(doc, sd || "R");
      var geo = { x: r3(mg.l), w: r3(Math.max(10, s.w - mg.l - mg.r)), h: h, y: r3(top ? dist : s.h - dist - h) };
      var paras = [{ ps: ps ? ps.id : "ps-base", runs: kind === "pn" ? [{ f: "pn" }] : [{ t: text.slice(0, 200) }] }];
      var it = mine.filter(function (x) { return (x.side || "") === sd; })[0];
      if (!it) {
        var sid = nid("st"), id = nid("it");
        doc.stories.push({ id: sid, m: now, h: [], paras: paras });
        doc.items.push(Object.assign({ id: id, m: now, t: "text", pg: ms.id, side: sd, story: sid, z: 1e6, cols: 1, gut: 12, ins: 0, va: top ? "t" : "b", sw: 0, ext: { mfk: kind } }, geo));
        n++;
        return;
      }
      var k = 0;
      Object.keys(geo).forEach(function (g) { if (it[g] !== geo[g]) { it[g] = geo[g]; k = 1; } });
      var story = M.find(doc.stories, it.story);
      if (story && JSON.stringify(story.paras) !== JSON.stringify(paras)) { story.paras = paras; M.touch(story, now); k = 1; }
      if (k) { M.touch(it, now); n++; }
    });
    // hide on pages (a list of page indexes from 0), show again
    var fields = doc.items.filter(function (it) { return it.pg === ms.id && it.ext && it.ext.mfk === kind; });
    var order = M.pagesInOrder(doc);
    function copiesOn(pg) { return doc.items.filter(function (it) { return it.pg === pg.id && it.ov && it.ext && it.ext.mfh === kind; }); }
    (pagesOf ? pagesOf(st.hide) : []).forEach(function (i) {
      var pg = order[i];
      if (!pg || pg.ms !== ms.id || copiesOn(pg).length) return;
      var sd = s.facing ? M.sideOf(doc, i) : "";
      fields.filter(function (f) { return (f.side || "") === sd; }).forEach(function (f) {
        doc.items.push({ id: nid("it"), m: now, t: "rect", pg: pg.id, ov: f.id, x: f.x, y: f.y, w: 1, h: 1, z: 0, hide: 1, sw: 0, ext: { mfh: kind } });
        n++;
      });
    });
    (pagesOf ? pagesOf(st.show) : []).forEach(function (i) { var pg = order[i]; if (pg) drop(copiesOn(pg)); });
    return n;
  }
  function defMaster(doc, st, now, idf) {
    if (!st.name) return 0;
    var cur = styleNamed(doc.masters, st.name), n = 0;
    if (!cur) {
      var used = {}, pre = "";
      doc.masters.forEach(function (m) { used[m.pre] = 1; });
      for (var c = 65; c < 91 && !pre; c++) if (!used[String.fromCharCode(c)]) pre = String.fromCharCode(c);
      cur = { id: (idf || M.newId)("ms"), m: now, name: String(st.name).slice(0, 60), pre: pre || "Z" };
      doc.masters.push(cur); n = 1;
    }
    var want = String(st.prefix || "").replace(/[^A-Za-zΑ-Ωα-ω0-9]/g, "").toUpperCase().slice(0, 3);
    if (want && cur.pre !== want) { cur.pre = want; n = 1; }
    if (st.base) {
      var x = cur.ext || {}, b = st.base === "none" ? null : styleNamed(doc.masters, st.base), bid = b && b.id !== cur.id ? b.id : "";
      // never a loop: the base may not be based on this one
      for (var k = bid, guard = 0; k && guard < 9; guard++) { if (k === cur.id) { bid = ""; break; } var bm = M.find(doc.masters, k); k = bm && bm.ext ? bm.ext.base : ""; }
      if (st.base === "none" || bid) {
        if ((x.base || "") !== bid) { if (bid) x.base = bid; else delete x.base; n = 1; }
        if (Object.keys(x).length) cur.ext = x; else delete cur.ext;
      }
    }
    if (n) M.touch(cur, now);
    return n;
  }

  var api = { setPicture: setPicture, setPage: setPage, setWrap: setWrap, anchorItem: anchorItem, releaseItem: releaseItem, links: links, setSection: setSection, setPageSize: setPageSize, movePages: movePages, dupPages: dupPages, masterPages: masterPages, defMaster: defMaster, natSort: natSort, natCmp: natCmp, normPath: normPath, pathOk: pathOk, makeDoc: makeDoc, frameFor: frameFor, placePictures: placePictures,
              fullPage: fullPage, bleedTargets: bleedTargets, needPx: needPx, applyFill: applyFill, noBleed: noBleed, outline: outline, PIC: PIC,
              styleNamed: styleNamed, defStyle: defStyle, fontFor: fontFor, fontKey: fontKey, listFont: listFont, swatchFor: swatchFor, playStyles: playStyles, parseParas: parseParas, addFrame: addFrame, modFrame: modFrame, masterField: masterField, setStory: setStory, clearPage: clearPage, housePages: housePages, PLAY: PLAY };
  if (node) module.exports = api;
  else root.LayoutPro = api;
})(typeof window !== "undefined" ? window : this);
