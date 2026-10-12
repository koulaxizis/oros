// ============================================================
// orOS Library — EPUB engine (v1.0.0)
// Reads an EPUB 2 / 3 (a ZIP: atelier/zip.js) chapter by chapter.
// Each chapter is cleaned by sanitize.js and shown in ONE iframe
// whose document starts with a Content-Security-Policy "default-src
// 'none'" (no script runs, nothing loads from the network; the
// book's pictures, styles and fonts are blob: URLs of its own files).
// The iframe has no sandbox attribute on purpose: the app must read
// the selection and handle taps inside it, and the two walls above
// already keep everything in the book inert.
// Paged mode: CSS columns, one page = the frame's width (two columns
// on wide screens); the frame scrolls sideways by whole pages.
// Scroll mode: the chapter scrolls down; the next one follows at the end.
// Places: "e:<spine index>:<offset>" in the chapter's text (sanitize.js
// textNodes); highlights are <mark class="lib-hl"> around their text,
// re-found by their quote if the offsets ever move.
// ============================================================
(function () {
  "use strict";

  var LIB = window.LIB, C = LIB.C, S = window.LibSanitize;
  var MAX_RES = 30 * 1024 * 1024;       // one picture / font / stylesheet
  var MAX_BOOK = 300 * 1024 * 1024;     // everything inflated for one book
  var MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
               svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif", css: "text/css",
               otf: "font/otf", ttf: "font/ttf", woff: "font/woff", woff2: "font/woff2" };
  var THEMES = {
    paper: { bg: "#fbf8f1", fg: "#23201b", link: "#8a4b0f" },
    sepia: { bg: "#f3e7cf", fg: "#4b3a26", link: "#8a4b0f" },
    night: { bg: "#000000", fg: "#c8c8c8", link: "#8ab4f8" }
  };
  var HL = ["rgba(255,213,0,.42)", "rgba(76,195,90,.36)", "rgba(66,153,255,.36)", "rgba(255,95,170,.36)"];
  var CSP = "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; font-src 'self' blob: data:; media-src blob:";

  function create(stage, ctx) {
    var zip = null, pkg = null, spine = [], weights = [], wsum = [], total = 1, toc = [];
    var res = {}, resBytes = 0, cssText = {}, chapters = {}, chapterOrder = [];
    var lower = {};
    var frame = null, doc = null, root = null, idx = -1, nodes = [], text = "", nodeStart = null;
    var page = 0, pages = 1, W = 0, H = 0, geo = null;
    var marks = [], destroyed = false, renderGen = 0, moveTimer = null, selTimer = null;
    var lastWheel = 0, touch = null;
    var P = ctx.prefs();

    // ---------- ZIP helpers ----------
    function realName(p) {
      if (!p) return null;
      if (zip.has(p)) return p;
      return lower[p.toLowerCase()] || null;
    }
    function resource(path) {
      var n = realName(path);
      if (!n) return Promise.resolve("");
      if (Object.prototype.hasOwnProperty.call(res, n)) return Promise.resolve(res[n]);
      if (resBytes > MAX_BOOK) return Promise.resolve("");
      res[n] = "";
      return zip.bytes(n, MAX_RES).then(function (b) {
        if (!b || destroyed) return "";
        resBytes += b.length;
        var ext = C.extOf(n);
        var type = MIME[ext] || ((pkg.items[pkg.byPath[n]] || {}).type) || "application/octet-stream";
        if (!/^(image|font)\//.test(type) && type !== "text/css" && type !== "application/font-woff" && type !== "application/vnd.ms-opentype") return "";
        res[n] = URL.createObjectURL(new Blob([b], { type: type }));
        return res[n];
      }, function () { return ""; });
    }
    function resSync(path) { var n = realName(path); return n && res[n] ? res[n] : ""; }
    function cssUrls(text, base) {
      var out = [], re = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi, m;
      while ((m = re.exec(text)) && out.length < 200) {
        var rp = C.resolvePath(base, m[2]);
        if (rp) out.push(rp.path);
      }
      return out;
    }
    function loadCss(path) {
      var n = realName(path);
      if (!n) return Promise.resolve("");
      if (Object.prototype.hasOwnProperty.call(cssText, n)) return Promise.resolve(cssText[n]);
      return zip.text(n, 2 * 1024 * 1024).then(function (txt) {
        txt = txt || "";
        return Promise.all(cssUrls(txt, n).map(resource)).then(function () {
          cssText[n] = S.css(txt, n, resSync);
          return cssText[n];
        });
      }, function () { cssText[n] = ""; return ""; });
    }

    // ---------- Chapters ----------
    // → { html, css, text, lang, dir, bodyClass }
    function chapter(i) {
      if (chapters[i]) return Promise.resolve(chapters[i]);
      var path = spine[i].path;
      var n = realName(path);
      if (!n) return Promise.resolve(store(i, { html: "", css: "", text: "", lang: "", dir: "", bodyClass: "" }));
      return zip.text(n, 16 * 1024 * 1024).then(function (src) {
        var prep = S.prepare(src || "", n);
        var styleUrls = [];
        prep.styles.forEach(function (s) { styleUrls = styleUrls.concat(cssUrls(s, n)); });
        return Promise.all(prep.imgs.concat(styleUrls).map(resource)).then(function () {
          return Promise.all(prep.css.map(loadCss));
        }).then(function (sheets) {
          var css = sheets.join("\n") + "\n" + prep.styles.map(function (s) { return S.css(s, n, resSync); }).join("\n");
          var html = S.build(prep, n, resSync);
          var tx = S.textOf(html).text;
          return store(i, { html: html, css: css, text: tx, lang: prep.lang, dir: prep.dir, bodyClass: prep.bodyClass });
        });
      });
    }
    function store(i, ch) {
      chapters[i] = ch;
      chapterOrder.push(i);
      // keep the html of a few chapters; texts stay (search, labels)
      while (chapterOrder.length > 6) {
        var old = chapterOrder.shift();
        if (old !== idx && chapters[old]) chapters[old] = { text: chapters[old].text, lite: true };
      }
      return ch;
    }
    function chapterFull(i) {
      if (chapters[i] && !chapters[i].lite) return Promise.resolve(chapters[i]);
      delete chapters[i];
      return chapter(i);
    }
    function textOfChapter(i) {
      return chapters[i] ? Promise.resolve(chapters[i].text) : chapter(i).then(function (c) { return c.text; });
    }

    // ---------- Open ----------
    // kind "fb2" / "cbz": built into an EPUB in memory (store.openEpub)
    function open(bytes, startLoc, kind, name) {
      return LIB.store.openEpub(bytes, kind, name).then(function (e) {
        zip = e.zip;
        pkg = e.pkg;
        zip.names.forEach(function (nm) { lower[nm.toLowerCase()] = nm; });
        if (zip.has("META-INF/rights.xml")) throw new Error("drm");
        return (zip.has("META-INF/encryption.xml") ? zip.text("META-INF/encryption.xml", 1024 * 1024) : Promise.resolve(null)).then(function (enc) {
          if (enc && drmProtected(enc)) throw new Error("drm");
          spine = pkg.spine.slice();
          if (!spine.length) throw new Error("epub");
          var acc = 0;
          weights = spine.map(function (s) { return Math.max(1, zip.size(realName(s.path) || "") || 1); });
          wsum = weights.map(function (w) { var v = acc; acc += w; return v; });
          total = Math.max(1, acc);
          var tocP = pkg.navPath && realName(pkg.navPath) ? zip.text(realName(pkg.navPath), 4 * 1024 * 1024).then(function (x) { return C.parseNav(x, pkg.navPath); }) :
            pkg.ncxPath && realName(pkg.ncxPath) ? zip.text(realName(pkg.ncxPath), 4 * 1024 * 1024).then(function (x) { return C.parseNcx(x, pkg.ncxPath); }) :
            Promise.resolve([]);
          return tocP.catch(function () { return []; });
        });
      }).then(function (list) {
        var bySpine = {};
        spine.forEach(function (s, i) { bySpine[s.path] = i; bySpine[s.path.toLowerCase()] = i; });
        toc = [];
        list.forEach(function (e) {
          var si = bySpine[e.path];
          if (si === undefined) si = bySpine[String(e.path).toLowerCase()];
          if (si === undefined) return;
          toc.push({ t: e.t, d: e.d, s: si, frag: e.frag, o: e.frag ? -1 : 0 });
        });
        frame = document.createElement("iframe");
        frame.className = "ep-frame";
        frame.setAttribute("title", LIB.t("rd.bookFrame"));
        stage.appendChild(frame);
        var st = C.parseLoc(startLoc);
        var s = st && st.f === "e" && st.s < spine.length ? st.s : firstLinear();
        return render(s).then(function () {
          if (st && st.f === "e" && st.s === s) goOffset(st.o, false);
          else setPage(0);
          report(true);
          return { toc: toc, pages: C.estPagesBytes(total) };
        });
      });
    }
    function firstLinear() {
      for (var i = 0; i < spine.length; i++) if (spine[i].linear) return i;
      return 0;
    }
    // Font obfuscation (IDPF / Adobe) is not DRM; anything else is.
    function drmProtected(xml) {
      var r = C.xmlParse(xml);
      var found = false;
      (function walk(n) {
        (n.c || []).forEach(function (c) {
          if (typeof c !== "object") return;
          if (c.l === "encryptionmethod") {
            var alg = String(c.a.Algorithm || c.a.algorithm || "");
            if (!/(idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC)/.test(alg)) found = true;
          }
          walk(c);
        });
      })(r);
      return found;
    }

    // ---------- Render one chapter into the frame ----------
    function render(i) {
      var my = ++renderGen;
      return chapterFull(i).then(function (ch) {
        if (destroyed || my !== renderGen) return;
        idx = i;
        measure();
        var lang = ch.lang || "";
        var html = "<!doctype html><html" + (lang ? " lang=\"" + lang + "\"" : "") + (ch.dir ? " dir=\"" + ch.dir + "\"" : "") + ">" +
          "<head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"" + CSP + "\">" +
          "<style>" + ch.css + "</style><style id=\"__lib_css\">" + readerCss() + "</style></head>" +
          "<body>" + S.wrap(ch.html) + "</body></html>";
        return new Promise(function (resolve) {
          var done = false;
          frame.onload = function () {
            if (done) return;
            done = true;
            if (destroyed || my !== renderGen) { resolve(); return; }
            doc = frame.contentDocument;
            root = doc && doc.getElementById(S.ROOT_ID);
            if (!root) { resolve(); return; }
            if (ch.bodyClass) root.className = ch.bodyClass;
            doc.documentElement.classList.toggle("scroll", P.mode === "scroll");
            wire(doc);
            paintNow();
            tocOffsets();
            var imgs = [].slice.call(doc.images || []);
            Promise.all(imgs.map(function (im) {
              return im.complete ? null : new Promise(function (r) { im.onload = im.onerror = function () { r(); }; setTimeout(r, 1500); });
            })).then(function () {
              var fonts = doc.fonts && doc.fonts.ready ? doc.fonts.ready.catch(function () {}) : null;
              return Promise.race([fonts, new Promise(function (r) { setTimeout(r, 800); })]);
            }).then(function () {
              layout();
              resolve();
            });
          };
          frame.srcdoc = html;
        });
      });
    }
    function measure() {
      W = Math.max(200, stage.clientWidth);
      H = Math.max(200, stage.clientHeight);
      var narrow = W < 500;
      var ph = [[12, 18, 28], [16, 30, 56]][narrow ? 0 : 1][P.margin];
      var pv = narrow ? 18 : 30;
      var cols = P.mode === "paged" && P.spread && W >= 900 ? 2 : 1;
      var cw = cols === 2 ? (W - 4 * ph) / 2 : W - 2 * ph;
      geo = { ph: ph, pv: pv, cols: cols, cw: Math.max(100, Math.floor(cw)) };
    }
    function theme() {
      var th = THEMES[P.theme];
      if (th) return th;
      var bg = ctx.palette("--bg") || "#14120d", fg = ctx.palette("--text") || "#f0ead9", ln = ctx.palette("--accent") || "#d4af37";
      return { bg: bg, fg: fg, link: ln };
    }
    function fontFaces() {
      var base = new URL("../vendor/noto/", location.href).href;
      var out = "";
      [["Noto Serif", "NotoSerif"], ["Noto Sans", "NotoSans"]].forEach(function (f) {
        [["Regular", 400, "normal"], ["Bold", 700, "normal"], ["Italic", 400, "italic"], ["BoldItalic", 700, "italic"]].forEach(function (v) {
          out += "@font-face{font-family:\"Lib " + f[0] + "\";src:url(\"" + base + f[1] + "-" + v[0] + ".ttf\");font-weight:" + v[1] + ";font-style:" + v[2] + ";font-display:swap}";
        });
      });
      return out;
    }
    function readerCss() {
      var th = theme(), g = geo || { ph: 20, pv: 24, cols: 1, cw: 400 };
      var paged = P.mode === "paged";
      var fam = P.font === "serif" ? "\"Lib Noto Serif\", Georgia, serif" : P.font === "sans" ? "\"Lib Noto Sans\", system-ui, sans-serif" : "";
      var css = fontFaces() +
        "html{height:100%;overflow:hidden;background:" + th.bg + " !important;color:" + th.fg + " !important;-webkit-text-size-adjust:100%;text-size-adjust:100%}" +
        "html.scroll{overflow-x:hidden;overflow-y:auto}" +
        "body{margin:0 !important;padding:0 !important;height:100%;background:transparent !important;color:inherit !important;" +
        "font-size:" + P.size + "% !important;line-height:" + P.lh + " !important;" + (fam ? "font-family:" + fam + " !important;" : "") + "}" +
        "#" + S.ROOT_ID + "{box-sizing:border-box;padding:" + g.pv + "px " + g.ph + "px;" +
        (paged ? "height:100%;column-width:" + g.cw + "px;column-gap:" + (2 * g.ph) + "px;column-fill:auto;" : "max-width:44em;margin:0 auto;min-height:100%;padding-bottom:" + (g.pv * 3) + "px;") + "}" +
        "#" + S.ROOT_ID + " *{color:inherit !important;background-color:transparent !important;max-width:100%;box-sizing:border-box}" +
        (fam ? "#" + S.ROOT_ID + " *{font-family:inherit !important}" : "") +
        "#" + S.ROOT_ID + " p,#" + S.ROOT_ID + " li,#" + S.ROOT_ID + " dd,#" + S.ROOT_ID + " blockquote{line-height:inherit !important;" +
        (P.justify ? "text-align:justify;" : "") + "hyphens:" + (P.hyph ? "auto" : "manual") + ";-webkit-hyphens:" + (P.hyph ? "auto" : "manual") + "}" +
        "#" + S.ROOT_ID + " img{max-width:100% !important;height:auto;max-height:" + Math.max(80, (paged ? H - 2 * g.pv : H * 0.9)) + "px !important;object-fit:contain;break-inside:avoid}" +
        "#" + S.ROOT_ID + " img.lib-svgimg{display:block;margin:0 auto}" +
        "#" + S.ROOT_ID + " h1,#" + S.ROOT_ID + " h2,#" + S.ROOT_ID + " h3,#" + S.ROOT_ID + " h4{break-after:avoid;line-height:1.25 !important}" +
        "#" + S.ROOT_ID + " table{border-collapse:collapse} #" + S.ROOT_ID + " td,#" + S.ROOT_ID + " th{border-color:currentColor}" +
        "#" + S.ROOT_ID + " pre{white-space:pre-wrap;word-break:break-word}" +
        "#" + S.ROOT_ID + " a[data-lh],#" + S.ROOT_ID + " a[data-lx]{color:" + th.link + " !important;text-decoration:underline;cursor:pointer}" +
        "mark.lib-hl{color:inherit !important;border-radius:2px;cursor:pointer;-webkit-box-decoration-break:clone;box-decoration-break:clone}" +
        HL.map(function (c, i) { return "mark.lib-hl.c" + i + "{background:" + c + " !important}"; }).join("") +
        "mark.lib-hl.has-n{border-bottom:2px dotted currentColor}" +
        "::highlight(lib-flash){background-color:" + th.link + ";color:" + th.bg + "}" +
        "::highlight(lib-speak){background-color:rgba(255,170,40,.32);background-color:color-mix(in srgb," + th.link + " 30%,transparent)}" +
        "::selection{background:" + (P.theme === "night" ? "rgba(138,180,248,.4)" : "rgba(66,133,244,.32)") + "}";
      return css;
    }
    function restyle() {
      if (!doc) return;
      var st = doc.getElementById("__lib_css");
      if (st) st.textContent = readerCss();
      doc.documentElement.classList.toggle("scroll", P.mode === "scroll");
    }

    // ---------- Text index ----------
    function reindex() {
      nodes = root ? S.textNodes(root) : [];
      text = root ? root.textContent : "";
      nodeStart = new WeakMap();
      nodes.forEach(function (x) { nodeStart.set(x.n, x.s); });
    }
    function nodeAt(o) {           // last node with s <= o
      var lo = 0, hi = nodes.length - 1, best = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (nodes[mid].s <= o) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    }
    // A DOM point → offset in the chapter's text.
    function pointOffset(node, off) {
      if (!node) return -1;
      if (node.nodeType === 3) {
        var s = nodeStart.get(node);
        return s === undefined ? -1 : s + Math.min(off, node.nodeValue.length);
      }
      var child = node.childNodes[off] || null;
      var w = doc.createTreeWalker(root, 4, null);
      if (child) {
        w.currentNode = child;
        if (child.nodeType === 3) return nodeStart.get(child);
        var n = w.nextNode();
        while (n && !child.contains(n) && (child.compareDocumentPosition(n) & 2)) n = w.nextNode();
        return n ? nodeStart.get(n) : text.length;
      }
      // after the last child of node: the first text node after node
      var last = node.lastChild ? lastText(node) : null;
      if (last) return nodeStart.get(last) + last.nodeValue.length;
      w.currentNode = node;
      var nx = w.nextNode();
      return nx ? nodeStart.get(nx) : text.length;
    }
    function lastText(node) {
      var w = doc.createTreeWalker(node, 4, null), n, last = null;
      while ((n = w.nextNode())) last = n;
      return last;
    }
    function rangeOf(a, b) {
      var i = nodeAt(a), j = nodeAt(Math.max(a, b - 1));
      if (i < 0 || j < 0) return null;
      var r = doc.createRange();
      r.setStart(nodes[i].n, Math.min(a - nodes[i].s, nodes[i].n.nodeValue.length));
      r.setEnd(nodes[j].n, Math.min(b - nodes[j].s, nodes[j].n.nodeValue.length));
      return r;
    }
    function charRect(o) {
      var i = nodeAt(Math.min(o, Math.max(0, text.length - 1)));
      if (i < 0) return null;
      var n = nodes[i].n, k = Math.min(o - nodes[i].s, Math.max(0, n.nodeValue.length - 1));
      var r = doc.createRange();
      // skip to the next visible character that has a box
      for (var tries = 0; tries < 400; tries++) {
        if (k >= n.nodeValue.length) {
          i++;
          if (i >= nodes.length) return null;
          n = nodes[i].n; k = 0;
          continue;
        }
        // whitespace is skipped too: a space at a line end hangs at the
        // edge of the previous column and would point at the wrong page
        if (!/\s/.test(n.nodeValue.charAt(k))) {
          r.setStart(n, k); r.setEnd(n, k + 1);
          var rs = r.getClientRects();
          if (rs.length && (rs[0].width > 0 || rs[0].height > 0)) return rs[0];
        }
        k++;
      }
      return null;
    }

    // ---------- Layout + paging ----------
    function scroller() { return doc && (doc.scrollingElement || doc.documentElement); }
    function layout() {
      if (!doc || !root) return;
      reindex();
      if (P.mode === "paged") {
        var sw = scroller().scrollWidth;
        pages = Math.max(1, Math.ceil((sw - 2) / W));
      } else {
        pages = Math.max(1, Math.ceil(scroller().scrollHeight / H));
      }
    }
    function setPage(p) {
      if (!doc) return;
      page = Math.max(0, Math.min(pages - 1, p));
      if (P.mode === "paged") scroller().scrollLeft = page * W;
      else scroller().scrollTop = page * H;
    }
    function goOffset(o, flashEnd) {
      if (!doc) return;
      var r = charRect(Math.max(0, Math.min(o, text.length)));
      if (P.mode === "paged") {
        if (r) setPage(Math.floor((r.left + r.width / 2 + scroller().scrollLeft) / W));
        else setPage(o >= text.length ? pages - 1 : 0);
      } else {
        var sc = scroller();
        sc.scrollTop = r ? Math.max(0, r.top + sc.scrollTop - geo.pv - 4) : 0;
        page = Math.floor(sc.scrollTop / H);
      }
      if (flashEnd) flash(o, flashEnd);
    }
    var flashTimer = null;
    function flash(a, b) {
      try {
        var w = frame.contentWindow;
        if (!w.CSS || !w.CSS.highlights || typeof w.Highlight !== "function") return;
        var r = rangeOf(a, b);
        if (!r) return;
        w.CSS.highlights.set("lib-flash", new w.Highlight(r));
        clearTimeout(flashTimer);
        flashTimer = setTimeout(function () { try { w.CSS.highlights.delete("lib-flash"); } catch (e) {} }, 2500);
      } catch (e) {}
    }

    // First character at the top-left of the view.
    function firstVisible() {
      if (!nodes.length) return 0;
      var paged = P.mode === "paged";
      function after(rect) { return paged ? rect.right > 1 : rect.bottom > 1; }
      var r = doc.createRange();
      // binary search over nodes: first node whose end is in or after the view
      var lo = 0, hi = nodes.length - 1, found = nodes.length - 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        r.selectNodeContents(nodes[mid].n);
        var rs = r.getClientRects();
        if (!rs.length) {          // no box (collapsed whitespace): look at a neighbour
          var k = mid + 1;
          while (k <= hi) { r.selectNodeContents(nodes[k].n); rs = r.getClientRects(); if (rs.length) break; k++; }
          if (!rs.length) { hi = mid - 1; continue; }
          if (after(rs[rs.length - 1])) { found = k; hi = mid - 1; } else lo = k + 1;
          continue;
        }
        if (after(rs[rs.length - 1])) { found = mid; hi = mid - 1; } else lo = mid + 1;
      }
      // inside it: the first character whose next visible box is in view
      // (charRect skips spaces and box-less characters, so the test only
      // flips once along the node)
      var base = nodes[found].s, len = nodes[found].n.nodeValue.length;
      var a = 0, b = len - 1, best = 0;
      while (a <= b) {
        var m = (a + b) >> 1;
        var box = charRect(base + m);
        if (!box || after(box)) { best = m; b = m - 1; } else a = m + 1;
      }
      return base + best;
    }
    function visibleRange() {
      var a = firstVisible();
      var b = text.length;
      // last visible: probe from a forward in steps (bounded)
      var paged = P.mode === "paged";
      var lo = a, hi = text.length;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        var r = charRect(mid);
        if (!r) { hi = mid - 1; continue; }
        var inView = paged ? r.left < W - 1 : r.top < H - 1;
        if (inView) lo = mid; else hi = mid - 1;
      }
      b = lo;
      return { a: a, b: b };
    }

    function pctOf(o) {
      var frac = text.length ? Math.min(1, o / text.length) : 0;
      if (idx === spine.length - 1 && page >= pages - 1) return 1000;
      return Math.min(999, Math.floor((wsum[idx] + weights[idx] * frac) / total * 1000));
    }
    function here() {
      if (!doc || !root) return null;
      var o = firstVisible();
      var ti = tocIndexAt(idx, o);
      var lbl = ti >= 0 ? toc[ti].t : LIB.t("rd.section", { n: idx + 1 });
      var sub = P.mode === "paged" ? LIB.t("rd.pageOf", { p: page + 1, n: pages }) : "";
      return { loc: C.makeLoc("e", idx, o), pct: pctOf(o), label: lbl, sub: sub, text: text.slice(o, o + 240) };
    }
    function report(now) {
      clearTimeout(moveTimer);
      var go = function () { if (!destroyed) ctx.onMove(here()); };
      if (now) go(); else moveTimer = setTimeout(go, 150);
    }

    // ---------- TOC positions ----------
    function tocOffsets() {
      toc.forEach(function (e) {
        if (e.s !== idx || !e.frag) return;
        var target = null;
        try { target = doc.getElementById(e.frag); } catch (er) { target = null; }
        if (!target) { e.o = 0; return; }
        reindexIfNeeded();
        var w = doc.createTreeWalker(root, 4, null);
        w.currentNode = target;
        var n = target.firstChild && target.firstChild.nodeType === 3 ? target.firstChild : w.nextNode();
        e.o = n && nodeStart.has(n) ? nodeStart.get(n) : 0;
      });
    }
    function reindexIfNeeded() { if (!nodeStart) reindex(); }
    function tocIndexAt(s, o) {
      var best = -1;
      for (var i = 0; i < toc.length; i++) {
        var e = toc[i];
        if (e.s < s || (e.s === s && (e.o < 0 ? 0 : e.o) <= o)) best = i;
        else if (e.s > s) break;
      }
      return best;
    }

    // ---------- Highlights ----------
    function paint(list) {
      marks = list || [];
      if (doc && root) { paintNow(); layout(); }
    }
    function paintNow() {
      if (!root) return;
      [].slice.call(root.querySelectorAll("mark.lib-hl")).forEach(function (m) {
        var p = m.parentNode;
        while (m.firstChild) p.insertBefore(m.firstChild, m);
        p.removeChild(m);
      });
      root.normalize();
      reindex();
      var spans = [];
      marks.forEach(function (k) {
        if (k.k !== "hl") return;
        var a0 = C.parseLoc(k.loc), b0 = C.parseLoc(k.end);
        if (!a0 || a0.f !== "e" || a0.s !== idx || !b0) return;
        var len = b0.s === a0.s ? b0.o - a0.o : (k.q || "").length;
        var a = a0.o;
        if (k.q && text.substr(a, k.q.length) !== k.q) {
          a = C.reanchor(text, k.q, k.pre, k.suf, a0.o);
          if (a < 0) return;
          len = k.q.length;
        }
        if (len > 0) spans.push({ a: a, b: Math.min(text.length, a + len), id: k.id, c: k.c || 0, n: !!k.n, m: k.m });
      });
      if (!spans.length) return;
      spans.sort(function (x, y) { return x.m - y.m; });          // newer on top
      // cut every text node at every boundary, last node first
      for (var i = nodes.length - 1; i >= 0; i--) {
        var nd = nodes[i], s = nd.s, e = s + nd.n.nodeValue.length;
        var cuts = {}, any = false;
        spans.forEach(function (sp) {
          if (sp.b <= s || sp.a >= e) return;
          any = true;
          cuts[Math.max(s, sp.a)] = 1;
          cuts[Math.min(e, sp.b)] = 1;
        });
        if (!any) continue;
        cuts[s] = 1; cuts[e] = 1;
        var pts = Object.keys(cuts).map(Number).sort(function (x, y) { return x - y; });
        var node = nd.n;
        for (var j = pts.length - 2; j >= 0; j--) {
          var pa = pts[j], pb = pts[j + 1];
          if (pb <= pa) continue;
          var piece = node;
          if (pb - s < node.nodeValue.length) node.splitText(pb - s);
          if (pa > s) piece = node.splitText(pa - s);
          var top = null;
          spans.forEach(function (sp) { if (sp.a <= pa && sp.b >= pb) top = sp; });
          if (top) {
            var mk = doc.createElement("mark");
            mk.className = "lib-hl c" + top.c + (top.n ? " has-n" : "");
            mk.setAttribute("data-id", top.id);
            piece.parentNode.insertBefore(mk, piece);
            mk.appendChild(piece);
          }
        }
      }
      reindex();
    }

    // ---------- Events inside the frame ----------
    function wire(d) {
      d.addEventListener("keydown", function (e) {
        LIB.forwardShortcut(e);
        if (!e.defaultPrevented) ctx.onKey(e);
      });
      d.addEventListener("click", onClick);
      d.addEventListener("selectionchange", function () {
        clearTimeout(selTimer);
        selTimer = setTimeout(selChanged, 250);
      });
      d.addEventListener("wheel", function (e) {
        if (P.mode !== "paged" || e.ctrlKey) return;
        e.preventDefault();
        var now = Date.now();
        if (now - lastWheel < 350) return;
        var dv = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (Math.abs(dv) < 8) return;
        lastWheel = now;
        if (dv > 0) next(); else prev();
      }, { passive: false });
      d.addEventListener("scroll", function () {
        if (P.mode !== "scroll") return;
        page = Math.floor(scroller().scrollTop / H);
        report(false);
      }, { passive: true });
      d.addEventListener("touchstart", function (e) {
        touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
      }, { passive: true });
      d.addEventListener("touchend", function (e) {
        if (!touch || P.mode !== "paged") { touch = null; return; }
        var tt = e.changedTouches[0], dx = tt.clientX - touch.x, dy = tt.clientY - touch.y;
        var quick = Date.now() - touch.t < 700;
        touch = null;
        if (!quick || Math.abs(dx) < 50 || Math.abs(dy) > 60) return;
        var sel = d.getSelection();
        if (sel && !sel.isCollapsed) return;
        if (dx < 0) next(); else prev();
      }, { passive: true });
    }
    function frameRect(r) {
      var f = frame.getBoundingClientRect();
      return { left: f.left + r.left, top: f.top + r.top, right: f.left + r.right, bottom: f.top + r.bottom, width: r.width, height: r.height };
    }
    function selChanged() {
      if (!doc) return;
      var s = doc.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) { ctx.onSelect(null); return; }
      var r = s.getRangeAt(0);
      if (!root.contains(r.commonAncestorContainer)) { ctx.onSelect(null); return; }
      var rects = r.getClientRects();
      var box = rects.length ? rects[0] : r.getBoundingClientRect();
      ctx.onSelect(frameRect(box));
    }
    function onClick(e) {
      var s = doc.getSelection();
      if (s && !s.isCollapsed) return;
      var t = e.target;
      var a = t && t.closest ? t.closest("a[data-lh],a[data-lx]") : null;
      if (a) { e.preventDefault(); linkClick(a); return; }
      var mk = t && t.closest ? t.closest("mark.lib-hl") : null;
      if (mk) { ctx.onMarkTap(mk.getAttribute("data-id"), frameRect(mk.getBoundingClientRect())); return; }
      if (P.mode !== "paged") { ctx.onTap("menu"); return; }
      var x = e.clientX / Math.max(1, W);
      ctx.onTap(x < 0.25 ? "prev" : x > 0.75 ? "next" : "menu");
    }
    function linkClick(a) {
      var lx = a.getAttribute("data-lx");
      if (lx) { ctx.onLink(lx); return; }
      var lh = a.getAttribute("data-lh") || "";
      var h = lh.indexOf("#");
      var path = h >= 0 ? lh.slice(0, h) : lh, frag = h >= 0 ? lh.slice(h + 1) : "";
      var et = a.getAttribute("data-et") || "";
      var noteLike = /noteref/.test(et) || (a.closest && a.closest("sup")) || /^\s*[\[(]?(\d{1,3}|[*†‡a-z])[\])]?\s*$/i.test(a.textContent || "");
      if (frag && noteLike) {
        noteText(path, frag).then(function (txt) {
          if (txt) ctx.onNote(txt, frameRect(a.getBoundingClientRect()));
          else goHref(path, frag);
        });
        return;
      }
      goHref(path, frag);
    }
    function spineOf(path) {
      for (var i = 0; i < spine.length; i++) if (spine[i].path === path || spine[i].path.toLowerCase() === String(path).toLowerCase()) return i;
      return -1;
    }
    function noteText(path, frag) {
      var si = spineOf(path);
      if (si < 0) return Promise.resolve("");
      function from(d) {
        var el = null;
        try { el = d.getElementById(frag); } catch (e) { el = null; }
        if (!el) return "";
        var box = el;
        // a bare anchor: take its paragraph / list item / aside
        if (!(el.textContent || "").trim() || (el.textContent || "").trim().length < 4) box = el.closest("p,li,aside,div,section") || el;
        return (box.textContent || "").trim();
      }
      if (si === idx && doc) return Promise.resolve(from(doc));
      return chapterFull(si).then(function (ch) { return ch.html ? from(S.textOf(ch.html).doc) : ""; });
    }
    function goHref(path, frag) {
      var si = path ? spineOf(path) : idx;
      if (si < 0) return;
      var go = function () {
        var el = null;
        if (frag) { try { el = doc.getElementById(frag); } catch (e) { el = null; } }
        if (el) {
          var w = doc.createTreeWalker(root, 4, null);
          w.currentNode = el;
          var n = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : w.nextNode();
          goOffset(n && nodeStart.has(n) ? nodeStart.get(n) : 0, null);
        } else setPage(0);
        report(true);
      };
      if (si === idx) go(); else render(si).then(go);
    }

    // ---------- Navigation ----------
    function next() {
      if (!doc) return;
      if (P.mode === "paged") {
        if (page < pages - 1) { setPage(page + 1); report(false); return; }
      } else {
        var sc = scroller();
        if (sc.scrollTop + H < sc.scrollHeight - 2) { sc.scrollTop = sc.scrollTop + H * 0.9; return; }
      }
      if (idx < spine.length - 1) render(idx + 1).then(function () { setPage(0); report(true); });
    }
    function prev() {
      if (!doc) return;
      if (P.mode === "paged") {
        if (page > 0) { setPage(page - 1); report(false); return; }
      } else {
        var sc = scroller();
        if (sc.scrollTop > 2) { sc.scrollTop = Math.max(0, sc.scrollTop - H * 0.9); return; }
      }
      if (idx > 0) render(idx - 1).then(function () {
        if (P.mode === "paged") setPage(pages - 1);
        else scroller().scrollTop = scroller().scrollHeight;
        report(true);
      });
    }
    function lineDown() { if (P.mode !== "scroll" || !doc) return false; scroller().scrollTop += 48; return true; }
    function lineUp() { if (P.mode !== "scroll" || !doc) return false; scroller().scrollTop -= 48; return true; }
    function go(loc, endLoc) {
      var l = C.parseLoc(loc);
      if (!l || l.f !== "e" || l.s >= spine.length) return;
      var e = C.parseLoc(endLoc);
      var fin = function () { goOffset(l.o, e && e.s === l.s ? e.o : null); report(true); };
      if (l.s === idx) fin(); else render(l.s).then(fin);
    }
    function goToc(entry) {
      if (!entry) return;
      if (entry.s === idx && entry.o >= 0) { goOffset(entry.o, null); report(true); return; }
      goHref(spine[entry.s].path, entry.frag);
    }
    function goPct(pct) {
      var target = pct / 1000 * total;
      var s = 0;
      for (var i = 0; i < spine.length; i++) if (wsum[i] <= target) s = i;
      var frac = Math.max(0, Math.min(1, (target - wsum[s]) / weights[s]));
      var fin = function () { goOffset(Math.floor(frac * text.length), null); report(true); };
      if (s === idx) fin(); else render(s).then(fin);
    }
    function visible(loc) {
      var l = C.parseLoc(loc);
      if (!l || l.f !== "e" || l.s !== idx || !doc) return false;
      var v = visibleRange();
      return l.o >= v.a && l.o <= v.b;
    }
    function selection() {
      if (!doc) return null;
      var s = doc.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) return null;
      var r = s.getRangeAt(0);
      if (!root.contains(r.commonAncestorContainer)) return null;
      var a = pointOffset(r.startContainer, r.startOffset), b = pointOffset(r.endContainer, r.endOffset);
      if (a < 0 || b < 0) return null;
      // trim spaces at both ends
      while (a < b && /\s/.test(text.charAt(a))) a++;
      while (b > a && /\s/.test(text.charAt(b - 1))) b--;
      if (b - a < 1) return null;
      if (b - a > C.QUOTE_LEN) b = a + C.QUOTE_LEN;
      var cx = C.contextOf(text, a, b);
      var ti = tocIndexAt(idx, a);
      return { loc: C.makeLoc("e", idx, a), end: C.makeLoc("e", idx, b), q: cx.q, pre: cx.pre, suf: cx.suf,
               label: ti >= 0 ? toc[ti].t : LIB.t("rd.section", { n: idx + 1 }) };
    }
    function clearSel() {
      try { doc.getSelection().removeAllRanges(); } catch (e) {}
      ctx.onSelect(null);
    }
    function labelOf(loc) {
      var l = C.parseLoc(loc);
      if (!l) return "";
      var ti = tocIndexAt(l.s, l.o);
      return ti >= 0 ? toc[ti].t : LIB.t("rd.section", { n: l.s + 1 });
    }
    function tocIndex(loc) {
      var l = C.parseLoc(loc);
      return l ? tocIndexAt(l.s, l.o) : -1;
    }

    // ---------- Read aloud (speak.js) ----------
    function speechStart() { return doc && root ? { s: idx, o: firstVisible(), n: spine.length } : null; }
    var BLOCK = "p,div,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,pre,td,th,caption,figcaption,section,article,aside,header,footer,hr,table,tr";
    // Offsets where a new block starts, so a heading with no full stop
    // is not read on into the next paragraph.
    function blockStarts() {
      var out = [], last = null;
      nodes.forEach(function (x) {
        var p = x.n.parentNode, b = p && p.closest ? p.closest(BLOCK) : null;
        if (x.s > 0 && b !== last) out.push(x.s);
        last = b;
      });
      return out;
    }
    // The chapter is shown first: offsets and the mark share its text.
    function speechSection(si) {
      var fin = function () {
        if (!doc || idx !== si) throw new Error("gone");
        reindexIfNeeded();
        return { text: text, breaks: blockStarts(), lang: doc.documentElement.lang || "" };
      };
      if (si === idx && doc) return Promise.resolve(fin());
      return render(si).then(function () { setPage(0); report(true); return fin(); });
    }
    function speakMark(si, a, b) {
      var w = frame && frame.contentWindow;
      try { if (w && w.CSS && w.CSS.highlights) w.CSS.highlights.delete("lib-speak"); } catch (e) {}
      if (si === null || si === undefined || !doc) return;
      if (si !== idx) {         // you turned to another chapter: the voice takes you back
        render(si).then(function () { setPage(0); speakMark(si, a, b); report(true); });
        return;
      }
      try {
        var r = rangeOf(a, b);
        if (r && typeof w.Highlight === "function") w.CSS.highlights.set("lib-speak", new w.Highlight(r));
      } catch (e) {}
      // the page follows the start of the part being read
      var rc = charRect(a);
      if (!rc) return;
      if (P.mode === "paged") {
        var p = Math.floor((rc.left + rc.width / 2 + scroller().scrollLeft) / W);
        if (p !== page) { setPage(p); report(false); }
      } else if (rc.top < 0 || rc.bottom > H) { goOffset(a, null); report(false); }
    }
    // The voice reached offset o (word boundary): a part that runs on to
    // the next page turns it there, not at the next part.
    function speakAt(si, o) {
      if (si !== idx || !doc || P.mode !== "paged") return;
      var rc = charRect(o);
      if (!rc) return;
      var p = Math.floor((rc.left + rc.width / 2 + scroller().scrollLeft) / W);
      if (p > page) { setPage(p); report(false); }
    }

    // ---------- Search the whole book ----------
    function search(q, onHit) {
      var count = 0, stop = false, i = 0;
      function step() {
        if (stop || destroyed || i >= spine.length || count >= 500) return Promise.resolve(count);
        var si = i++;
        return textOfChapter(si).then(function (tx) {
          var fm = C.foldMap(tx);
          var hits = C.findAll(tx, q, 500 - count, fm);
          for (var h = 0; h < hits.length && !stop; h++) {
            var sn = C.snippet(tx, hits[h].o, hits[h].len);
            var ti = tocIndexAt(si, hits[h].o);
            var ok = onHit({ loc: C.makeLoc("e", si, hits[h].o), end: C.makeLoc("e", si, hits[h].o + hits[h].len),
                             label: ti >= 0 ? toc[ti].t : LIB.t("rd.section", { n: si + 1 }), pre: sn.pre, hit: sn.hit, post: sn.post });
            if (ok === false) stop = true; else count++;
          }
        }, function () {}).then(function () { return new Promise(function (r) { setTimeout(r, 0); }); }).then(step);
      }
      return step();
    }

    // ---------- Settings, size ----------
    function applyPrefs(p) {
      var keep = doc ? firstVisible() : 0;
      var modeChanged = P && p && P.mode !== p.mode;
      P = p;
      stage.style.background = theme().bg;
      if (!doc) return;
      measure();
      restyle();
      if (modeChanged) { scroller().scrollLeft = 0; scroller().scrollTop = 0; }
      setTimeout(function () {
        if (!doc) return;
        layout();
        goOffset(keep, null);
        report(true);
      }, 60);
    }
    function resize() {
      if (!doc) return;
      var keep = firstVisible();
      measure();
      restyle();
      setTimeout(function () { if (!doc) return; layout(); goOffset(keep, null); report(true); }, 60);
    }

    function destroy() {
      destroyed = true;
      clearTimeout(moveTimer); clearTimeout(selTimer); clearTimeout(flashTimer);
      Object.keys(res).forEach(function (k) { if (res[k]) { try { URL.revokeObjectURL(res[k]); } catch (e) {} } });
      res = {}; chapters = {};
      if (frame) { frame.onload = null; frame.remove(); }
      frame = doc = root = null;
    }

    return {
      open: open, go: go, goToc: goToc, goPct: goPct, next: next, prev: prev, lineDown: lineDown, lineUp: lineUp,
      here: here, visible: visible, selection: selection, clearSel: clearSel, paint: paint, search: search,
      applyPrefs: applyPrefs, labelOf: labelOf, tocIndex: tocIndex, resize: resize, destroy: destroy,
      speechStart: speechStart, speechSection: speechSection, speakMark: speakMark, speakAt: speakAt
    };
  }

  LIB.epubEngine = { create: create };
})();
