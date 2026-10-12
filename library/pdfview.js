// ============================================================
// orOS Library — PDF engine (v1.0.0)
// PDF.js (vendor/pdfjs, Mozilla, Apache-2.0) draws the pages; eval
// is off and nothing in the file runs (no scripts, no forms). Pages
// are drawn only near the view (at most 10 kept), each with:
//   - a canvas (the page), a text layer (PDF.js TextLayer: invisible
//     text over the page, so you can select and search it),
//   - a highlight layer (boxes under the text) and a link layer.
// Continuous scroll; zoom: fit width, fit page or a percentage
// (Ctrl + wheel, pinch, the settings). Night mode inverts the pages.
// Places: "p:<page>:y<per-mille>" (reading place, bookmarks; works
// for scanned pages too) or "p:<page>:<offset>" (text: highlights,
// search hits). The page's text = every text item + "\n" at each
// line end, which is exactly what the text layer holds (spans + <br>).
// ============================================================
(function () {
  "use strict";

  var LIB = window.LIB, C = LIB.C;
  var KEEP = 10, GAP = 12, PAD = 12;
  var HL = ["rgba(255,213,0,.45)", "rgba(76,195,90,.4)", "rgba(66,153,255,.4)", "rgba(255,95,170,.4)"];

  function create(stage, ctx) {
    var lib = null, pdf = null, n = 0, sizes = [], tops = [], scale = 1;
    var scroller = null, wrap = null, pageEls = [], rendered = {}, renderOrder = [], texts = {}, idxs = {};
    var outline = [], outlinePages = [], marks = [], destroyed = false, moveTimer = null, selTimer = null;
    var observer = null, P = ctx.prefs(), pinch = null, hlRects = {};

    // ---------- Open ----------
    function open(bytes, startLoc) {
      return LIB.store.pdfjs().then(function (l) {
        lib = l;
        return LIB.store.openPdf(bytes);
      }).then(function (doc) {
        pdf = doc;
        n = pdf.numPages;
        if (!(n > 0)) throw new Error("pdf");
        return pageSizes();
      }).then(function () {
        return pdf.getOutline().catch(function () { return null; });
      }).then(function (ol) {
        outline = [];
        (function walk(items, d) {
          (items || []).forEach(function (it) {
            if (outline.length >= 3000) return;
            var tt = C.cleanText(it.title || "", 200);
            if (tt) outline.push({ t: tt, d: Math.min(d, 6), dest: it.dest, url: it.url || null, page: -1 });
            walk(it.items, d + 1);
          });
        })(ol, 0);
        build();
        layout();
        return resolveOutline();
      }).then(function () {
        var l = C.parseLoc(startLoc);
        if (l && l.f === "p") go(startLoc, null, true);
        report(true);
        return { toc: outline };
      });
    }
    function pageSizes() {
      var i = 0;
      sizes = [];
      function step() {
        if (i >= n || destroyed) return Promise.resolve();
        var k = i++;
        return pdf.getPage(k + 1).then(function (pg) {
          var vp = pg.getViewport({ scale: 1 });
          sizes[k] = { w: vp.width, h: vp.height };
        }, function () { sizes[k] = sizes[k - 1] || { w: 612, h: 792 }; }).then(step);
      }
      return step();
    }
    // Outline destinations → page numbers (for the TOC and labels).
    function resolveOutline() {
      return Promise.all(outline.map(function (e) {
        return pageOfDest(e.dest).then(function (p) { e.page = p; });
      })).then(function () {
        outlinePages = outline.map(function (e, i) { return { p: e.page, i: i }; }).filter(function (x) { return x.p >= 0; });
      });
    }
    function pageOfDest(dest) {
      var p = typeof dest === "string" ? pdf.getDestination(dest) : Promise.resolve(dest);
      return p.then(function (d) {
        if (!Array.isArray(d) || !d.length) return -1;
        var ref = d[0];
        if (typeof ref === "number") return ref;
        return pdf.getPageIndex(ref);
      }).catch(function () { return -1; });
    }

    // ---------- DOM ----------
    function build() {
      scroller = document.createElement("div");
      scroller.className = "pdf-scroll";
      scroller.tabIndex = -1;
      wrap = document.createElement("div");
      wrap.className = "pdf-pages";
      scroller.appendChild(wrap);
      stage.appendChild(scroller);
      for (var i = 0; i < n; i++) {
        var pg = document.createElement("div");
        pg.className = "pdf-page";
        pg.setAttribute("data-p", i);
        var hl = document.createElement("div");
        hl.className = "pdf-hl";
        pg.appendChild(hl);
        pageEls.push(pg);
        wrap.appendChild(pg);
      }
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) renderPage(+en.target.getAttribute("data-p"));
        });
      }, { root: scroller, rootMargin: "100% 0px" });
      pageEls.forEach(function (p) { observer.observe(p); });
      scroller.addEventListener("scroll", function () { report(false); }, { passive: true });
      scroller.addEventListener("click", onClick);
      scroller.addEventListener("wheel", function (e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      }, { passive: false });
      scroller.addEventListener("touchstart", onTouchStart, { passive: true });
      scroller.addEventListener("touchmove", onTouchMove, { passive: false });
      scroller.addEventListener("touchend", onTouchEnd, { passive: true });
      document.addEventListener("selectionchange", onSelChange);
      applyNight();
    }
    function fitScale() {
      var W = Math.max(200, stage.clientWidth - 2 * PAD - 8), H = Math.max(200, stage.clientHeight - 2 * PAD);
      var maxW = 1;
      sizes.forEach(function (s) { if (s.w > maxW) maxW = s.w; });
      var s0 = sizes[0] || { w: 612, h: 792 };
      if (P.pdfZoom === "page") return Math.min(W / s0.w, H / s0.h);
      if (P.pdfZoom === "width") return Math.min(W / maxW, 4);
      return typeof P.pdfZoom === "number" ? P.pdfZoom * (96 / 72) : W / maxW;
    }
    function layout() {
      var keep = scroller && tops.length ? placeNow() : null;
      scale = Math.max(0.1, fitScale());
      var y = PAD;
      tops = [];
      for (var i = 0; i < n; i++) {
        var s = sizes[i] || sizes[0];
        var w = Math.floor(s.w * scale), h = Math.floor(s.h * scale);
        var el = pageEls[i];
        el.style.width = w + "px";
        el.style.height = h + "px";
        el.style.setProperty("--scale-factor", scale);
        el.style.setProperty("--total-scale-factor", scale);
        tops.push(y);
        y += h + GAP;
      }
      // pages drawn at the old size: draw again
      Object.keys(rendered).forEach(function (k) { unrender(+k); });
      if (keep) restore(keep);
      setTimeout(function () { visiblePages().forEach(renderPage); }, 0);
    }
    function visiblePages() {
      var top = scroller.scrollTop, bottom = top + scroller.clientHeight, out = [];
      for (var i = 0; i < n; i++) {
        var h = pageEls[i].offsetHeight;
        if (tops[i] + h >= top - 200 && tops[i] <= bottom + 200) out.push(i);
      }
      return out;
    }

    // ---------- Drawing one page ----------
    function renderPage(i) {
      if (destroyed || rendered[i]) return;
      var my = rendered[i] = { s: scale };
      renderOrder.push(i);
      while (renderOrder.length > KEEP) {
        var far = farthest();
        if (far === null) break;
        unrender(far);
      }
      pdf.getPage(i + 1).then(function (page) {
        if (destroyed || rendered[i] !== my) return null;
        var vp = page.getViewport({ scale: scale });
        var el = pageEls[i];
        var dpr = Math.min(window.devicePixelRatio || 1, 3);
        var area = vp.width * vp.height * dpr * dpr;
        if (area > 16e6) dpr = Math.max(0.5, Math.sqrt(16e6 / (vp.width * vp.height)));
        var cv = document.createElement("canvas");
        cv.width = Math.floor(vp.width * dpr);
        cv.height = Math.floor(vp.height * dpr);
        cv.className = "pdf-canvas";
        var task = page.render({ canvasContext: cv.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null, background: "#ffffff" });
        my.task = task;
        return task.promise.then(function () {
          if (destroyed || rendered[i] !== my) return null;
          var old = el.querySelector(".pdf-canvas");
          if (old) old.remove();
          el.insertBefore(cv, el.firstChild);
          return page.getTextContent();
        }).then(function (tc) {
          if (!tc || destroyed || rendered[i] !== my) return null;
          texts[i] = pageTextOf(tc);
          var tl = document.createElement("div");
          tl.className = "textLayer";
          el.appendChild(tl);
          my.tl = tl;
          var layer = new lib.TextLayer({ textContentSource: tc, container: tl, viewport: vp });
          return layer.render().then(function () {
            if (rendered[i] !== my) return;
            idxs[i] = domIndex(tl);
            paintPage(i);
            return page.getAnnotations({ intent: "display" }).then(function (an) { links(i, an, vp); }, function () {});
          });
        });
      }).catch(function () { if (rendered[i] === my) delete rendered[i]; });
    }
    function farthest() {
      var v = visiblePages(), mid = v.length ? v[Math.floor(v.length / 2)] : 0, best = null, bd = -1;
      renderOrder.forEach(function (i) {
        if (v.indexOf(i) >= 0) return;
        var d = Math.abs(i - mid);
        if (d > bd) { bd = d; best = i; }
      });
      return best;
    }
    function unrender(i) {
      var r = rendered[i];
      delete rendered[i];
      renderOrder = renderOrder.filter(function (x) { return x !== i; });
      if (r && r.task) { try { r.task.cancel(); } catch (e) {} }
      var el = pageEls[i];
      if (!el) return;
      [].slice.call(el.querySelectorAll(".pdf-canvas,.textLayer,.pdf-links")).forEach(function (x) { x.remove(); });
      el.querySelector(".pdf-hl").textContent = "";
      delete idxs[i];
      delete hlRects[i];
    }
    function links(i, annots, vp) {
      var el = pageEls[i];
      var box = document.createElement("div");
      box.className = "pdf-links";
      (annots || []).forEach(function (a) {
        if (a.subtype !== "Link" || !a.rect) return;
        var url = a.url || a.unsafeUrl || null;
        if (url && !/^(https?:|mailto:)/i.test(url)) url = null;
        if (!url && !a.dest) return;
        var r = vp.convertToViewportRectangle(a.rect);
        var x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]), w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
        var d = document.createElement("button");
        d.type = "button";
        d.className = "pdf-link";
        d.style.left = x + "px"; d.style.top = y + "px"; d.style.width = w + "px"; d.style.height = h + "px";
        d.setAttribute("aria-label", url || LIB.t("rd.link"));
        d.addEventListener("click", function (e) {
          e.stopPropagation();
          if (url) { ctx.onLink(url); return; }
          pageOfDest(a.dest).then(function (p) { if (p >= 0) { scrollToY(tops[p] - PAD); report(true); } });
        });
        box.appendChild(d);
      });
      if (box.childNodes.length) el.appendChild(box);
    }

    // ---------- Page text ----------
    function pageTextOf(tc) {
      var s = "";
      (tc.items || []).forEach(function (it) {
        if (typeof it.str !== "string") return;
        s += it.str + (it.hasEOL ? "\n" : "");
      });
      return s;
    }
    function pageText(i) {
      if (texts[i] !== undefined) return Promise.resolve(texts[i]);
      return pdf.getPage(i + 1).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
        texts[i] = pageTextOf(tc);
        return texts[i];
      }, function () { texts[i] = ""; return ""; });
    }
    // text nodes + <br> of a text layer, as offsets in the page text
    function domIndex(tl) {
      var out = [], at = 0;
      var w = document.createTreeWalker(tl, 1 | 4, null), x;
      while ((x = w.nextNode())) {
        if (x.nodeType === 3) { out.push({ n: x, s: at }); at += x.nodeValue.length; }
        else if (x.tagName === "BR") { out.push({ br: x, s: at }); at += 1; }
      }
      out.total = at;
      return out;
    }
    function offsetIn(i, node, off) {
      var ix = idxs[i];
      if (!ix) return -1;
      if (node.nodeType === 3) {
        for (var k = 0; k < ix.length; k++) if (ix[k].n === node) return ix[k].s + Math.min(off, node.nodeValue.length);
        return -1;
      }
      var child = node.childNodes[off];
      if (!child) {
        // end of this element: after its last text
        var last = -1;
        for (var j = 0; j < ix.length; j++) {
          var it = ix[j].n || ix[j].br;
          if (node.contains(it)) last = ix[j].s + (ix[j].n ? ix[j].n.nodeValue.length : 1);
        }
        return last;
      }
      for (var q = 0; q < ix.length; q++) {
        var nd = ix[q].n || ix[q].br;
        if (nd === child || child.contains(nd) || (child.compareDocumentPosition(nd) & 4)) return ix[q].s;
      }
      return ix.total;
    }
    function rangeIn(i, a, b) {
      var ix = idxs[i];
      if (!ix || !ix.length) return null;
      var r = document.createRange(), started = false;
      for (var k = 0; k < ix.length; k++) {
        var x = ix[k];
        if (!x.n) continue;
        var e = x.s + x.n.nodeValue.length;
        if (!started && a < e) { r.setStart(x.n, Math.max(0, a - x.s)); started = true; }
        if (started && b <= e) { r.setEnd(x.n, Math.max(0, b - x.s)); return r; }
      }
      if (!started) return null;
      var lastT = null;
      for (var j = ix.length - 1; j >= 0; j--) if (ix[j].n) { lastT = ix[j].n; break; }
      r.setEnd(lastT, lastT.nodeValue.length);
      return r;
    }

    // ---------- Highlights ----------
    function paint(list) {
      marks = list || [];
      Object.keys(rendered).forEach(function (k) { if (idxs[k]) paintPage(+k); });
    }
    function spanOf(k, i) {
      var a0 = C.parseLoc(k.loc), b0 = C.parseLoc(k.end);
      if (!a0 || a0.f !== "p" || a0.y || a0.s !== i + 1 || !b0) return null;
      var tx = texts[i] || "";
      var a = a0.o, len = b0.s === a0.s ? b0.o - a0.o : (k.q || "").length;
      if (k.q && tx.substr(a, k.q.length) !== k.q) {
        a = C.reanchor(tx, k.q, k.pre, k.suf, a0.o);
        if (a < 0) return null;
        len = k.q.length;
      }
      return { a: a, b: a + len };
    }
    function paintPage(i) {
      var el = pageEls[i], layer = el.querySelector(".pdf-hl");
      layer.textContent = "";
      hlRects[i] = [];
      var base = el.getBoundingClientRect();
      marks.forEach(function (k) {
        if (k.k !== "hl") return;
        var sp = spanOf(k, i);
        if (!sp) return;
        var r = rangeIn(i, sp.a, sp.b);
        if (!r) return;
        [].forEach.call(r.getClientRects(), function (rc) {
          if (rc.width < 1 || rc.height < 1) return;
          var d = document.createElement("div");
          d.className = "pdf-hl-box" + (k.n ? " has-n" : "");
          d.style.background = HL[k.c || 0];
          d.style.left = (rc.left - base.left) + "px";
          d.style.top = (rc.top - base.top) + "px";
          d.style.width = rc.width + "px";
          d.style.height = rc.height + "px";
          layer.appendChild(d);
          hlRects[i].push({ id: k.id, x: rc.left - base.left, y: rc.top - base.top, w: rc.width, h: rc.height });
        });
      });
    }
    var flashEl = null, flashTimer = null;
    function flash(i, a, b) {
      if (!idxs[i]) return;
      var r = rangeIn(i, a, b);
      if (!r) return;
      var el = pageEls[i], base = el.getBoundingClientRect();
      if (flashEl) flashEl.remove();
      flashEl = document.createElement("div");
      flashEl.className = "pdf-flash";
      [].forEach.call(r.getClientRects(), function (rc) {
        var d = document.createElement("div");
        d.style.left = (rc.left - base.left) + "px"; d.style.top = (rc.top - base.top) + "px";
        d.style.width = rc.width + "px"; d.style.height = rc.height + "px";
        flashEl.appendChild(d);
      });
      el.appendChild(flashEl);
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () { if (flashEl) { flashEl.remove(); flashEl = null; } }, 2500);
    }

    // ---------- Place ----------
    function pageAtY(y) {
      var lo = 0, hi = n - 1, best = 0;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (tops[mid] <= y) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    }
    function placeNow() {
      var y = scroller.scrollTop + 1;
      var i = pageAtY(y), h = pageEls[i].offsetHeight || 1;
      return { i: i, f: Math.max(0, Math.min(1, (y - tops[i]) / h)) };
    }
    function restore(pl) {
      var h = pageEls[pl.i].offsetHeight;
      scrollToY(tops[pl.i] + pl.f * h);
    }
    function scrollToY(y) { scroller.scrollTop = Math.max(0, y); }
    function here() {
      if (!scroller) return null;
      var pl = placeNow();
      var atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      var pct = atEnd && n > 0 && pl.i >= n - 2 ? 1000 : Math.min(999, Math.floor((pl.i + pl.f) / n * 1000));
      var li = outlineIndexAt(pl.i);
      return { loc: C.makeLoc("p", pl.i + 1, Math.round(pl.f * 1000), true), pct: pct,
               label: li >= 0 ? outline[li].t : LIB.t("rd.pageN", { n: pl.i + 1 }),
               sub: LIB.t("rd.pageOf", { p: pl.i + 1, n: n }),
               text: (texts[pl.i] || "").slice(0, 240) };
    }
    function outlineIndexAt(p) {
      var best = -1, bp = -1;
      outlinePages.forEach(function (x) { if (x.p <= p && x.p >= bp) { best = x.i; bp = x.p; } });
      return best;
    }
    function report(now) {
      clearTimeout(moveTimer);
      var g = function () { if (!destroyed) ctx.onMove(here()); };
      if (now) g(); else moveTimer = setTimeout(g, 150);
    }
    function go(loc, endLoc, quiet) {
      var l = C.parseLoc(loc);
      if (!l || l.f !== "p") return;
      var i = Math.max(0, Math.min(n - 1, l.s - 1));
      var h = pageEls[i].offsetHeight;
      if (l.y) { scrollToY(tops[i] + l.o / 1000 * h); if (!quiet) report(true); return; }
      scrollToY(tops[i] - PAD);
      var e = C.parseLoc(endLoc);
      var fin = function () {
        if (!idxs[i]) return;
        var r = rangeIn(i, l.o, e && e.s === l.s ? e.o : l.o + 1);
        if (r) {
          var rc = r.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
          scrollToY(scroller.scrollTop + rc.top - sr.top - scroller.clientHeight / 3);
        }
        if (e && e.s === l.s) flash(i, l.o, e.o);
        report(true);
      };
      renderPage(i);
      var tries = 0;
      (function wait() {
        if (destroyed) return;
        if (idxs[i] || tries++ > 40) { fin(); return; }
        setTimeout(wait, 100);
      })();
    }
    function goToc(entry) {
      if (entry.page >= 0) { scrollToY(tops[entry.page] - PAD); report(true); return; }
      if (entry.url) ctx.onLink(entry.url);
    }
    function goPct(pct) {
      var x = pct / 1000 * n, i = Math.min(n - 1, Math.floor(x));
      scrollToY(tops[i] + (x - i) * pageEls[i].offsetHeight);
      report(true);
    }
    function next() {
      var pl = placeNow();
      if (P.pdfZoom === "page") { if (pl.i < n - 1) scrollToY(tops[pl.i + 1] - PAD); }
      else scrollToY(scroller.scrollTop + scroller.clientHeight * 0.9);
      report(false);
    }
    function prev() {
      var pl = placeNow();
      if (P.pdfZoom === "page") scrollToY(tops[Math.max(0, pl.f > 0.05 ? pl.i : pl.i - 1)] - PAD);
      else scrollToY(scroller.scrollTop - scroller.clientHeight * 0.9);
      report(false);
    }
    function lineDown() { scroller.scrollTop += 48; return true; }
    function lineUp() { scroller.scrollTop -= 48; return true; }
    function visible(loc) {
      var l = C.parseLoc(loc);
      if (!l || l.f !== "p" || !scroller) return false;
      var i = l.s - 1;
      if (i < 0 || i >= n) return false;
      var top = scroller.scrollTop, bottom = top + scroller.clientHeight;
      if (l.y) {
        var y = tops[i] + l.o / 1000 * pageEls[i].offsetHeight;
        return y >= top - 2 && y < bottom;
      }
      return tops[i] < bottom && tops[i] + pageEls[i].offsetHeight > top;
    }

    // ---------- Selection, taps ----------
    function selRange() {
      var s = document.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) return null;
      var r = s.getRangeAt(0);
      if (!scroller || !scroller.contains(r.commonAncestorContainer)) return null;
      return r;
    }
    function onSelChange() {
      clearTimeout(selTimer);
      selTimer = setTimeout(function () {
        if (destroyed) return;
        var r = selRange();
        if (!r) { ctx.onSelect(null); return; }
        var rs = r.getClientRects();
        ctx.onSelect(rs.length ? rs[0] : r.getBoundingClientRect());
      }, 250);
    }
    function pageOfNode(node) {
      var el = node.nodeType === 1 ? node : node.parentNode;
      var pg = el && el.closest ? el.closest(".pdf-page") : null;
      return pg ? +pg.getAttribute("data-p") : -1;
    }
    function selection() {
      var r = selRange();
      if (!r) return null;
      var i = pageOfNode(r.startContainer);
      if (i < 0 || !idxs[i]) return null;
      var a = offsetIn(i, r.startContainer, r.startOffset);
      var b = pageOfNode(r.endContainer) === i ? offsetIn(i, r.endContainer, r.endOffset) : (texts[i] || "").length;
      var tx = texts[i] || "";
      if (a < 0 || b < 0) return null;
      while (a < b && /\s/.test(tx.charAt(a))) a++;
      while (b > a && /\s/.test(tx.charAt(b - 1))) b--;
      if (b - a < 1) return null;
      if (b - a > C.QUOTE_LEN) b = a + C.QUOTE_LEN;
      var cx = C.contextOf(tx, a, b);
      var li = outlineIndexAt(i);
      return { loc: C.makeLoc("p", i + 1, a), end: C.makeLoc("p", i + 1, b), q: cx.q, pre: cx.pre, suf: cx.suf,
               label: li >= 0 ? outline[li].t : LIB.t("rd.pageN", { n: i + 1 }) };
    }
    function clearSel() {
      try { document.getSelection().removeAllRanges(); } catch (e) {}
      ctx.onSelect(null);
    }
    function onClick(e) {
      if (selRange()) return;
      var pg = e.target && e.target.closest ? e.target.closest(".pdf-page") : null;
      if (pg) {
        var i = +pg.getAttribute("data-p"), b = pg.getBoundingClientRect();
        var x = e.clientX - b.left, y = e.clientY - b.top;
        var hit = (hlRects[i] || []).filter(function (r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }).pop();
        if (hit) {
          ctx.onMarkTap(hit.id, { left: b.left + hit.x, top: b.top + hit.y, right: b.left + hit.x + hit.w, bottom: b.top + hit.y + hit.h, width: hit.w, height: hit.h });
          return;
        }
      }
      var sb = scroller.getBoundingClientRect();
      var fx = (e.clientX - sb.left) / Math.max(1, sb.width);
      ctx.onTap(fx < 0.2 ? "prev" : fx > 0.8 ? "next" : "menu");
    }

    // ---------- Zoom ----------
    function zoomValue() { return scale * 72 / 96; }
    function zoomBy(f) {
      P.pdfZoom = Math.max(0.25, Math.min(5, Math.round(zoomValue() * f * 100) / 100));
      LIB.savePrefs();
      layout();
      report(false);
    }
    function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    function onTouchStart(e) {
      if (e.touches.length === 2) {
        var r = scroller.getBoundingClientRect();
        pinch = { d: dist(e.touches), f: 1,
                  ox: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left + scroller.scrollLeft,
                  oy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top + scroller.scrollTop };
        wrap.style.transformOrigin = pinch.ox + "px " + pinch.oy + "px";
      }
    }
    function onTouchMove(e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      pinch.f = Math.max(0.3, Math.min(4, dist(e.touches) / pinch.d));
      wrap.style.transform = "scale(" + pinch.f + ")";
    }
    function onTouchEnd(e) {
      if (!pinch || e.touches.length) return;
      var f = pinch.f;
      pinch = null;
      wrap.style.transform = "";
      if (Math.abs(f - 1) > 0.05) zoomBy(f);
    }
    function applyNight() { stage.classList.toggle("pdf-night", !!P.pdfNight); }

    // ---------- Search ----------
    function search(q, onHit) {
      var count = 0, stop = false, i = 0;
      function step() {
        if (stop || destroyed || i >= n || count >= 500) return Promise.resolve(count);
        var k = i++;
        return pageText(k).then(function (tx) {
          var hits = C.findAll(tx, q, 500 - count);
          for (var h = 0; h < hits.length && !stop; h++) {
            var sn = C.snippet(tx, hits[h].o, hits[h].len);
            var ok = onHit({ loc: C.makeLoc("p", k + 1, hits[h].o), end: C.makeLoc("p", k + 1, hits[h].o + hits[h].len),
                             label: LIB.t("rd.pageN", { n: k + 1 }), pre: sn.pre, hit: sn.hit, post: sn.post });
            if (ok === false) stop = true; else count++;
          }
        }).then(function () { return k % 8 === 7 ? new Promise(function (r) { setTimeout(r, 0); }) : null; }).then(step);
      }
      return step();
    }

    function applyPrefs(p) {
      var zoomChanged = !P || P.pdfZoom !== p.pdfZoom;
      P = p;
      applyNight();
      if (scroller && zoomChanged) layout();
    }
    function resize() { if (scroller && typeof P.pdfZoom === "string") layout(); }
    function labelOf(loc) {
      var l = C.parseLoc(loc);
      if (!l) return "";
      var li = outlineIndexAt(l.s - 1);
      return li >= 0 ? outline[li].t + " · " + LIB.t("rd.pageN", { n: l.s }) : LIB.t("rd.pageN", { n: l.s });
    }
    function tocIndex(loc) {
      var l = C.parseLoc(loc);
      return l ? outlineIndexAt(l.s - 1) : -1;
    }
    function destroy() {
      destroyed = true;
      clearTimeout(moveTimer); clearTimeout(selTimer); clearTimeout(flashTimer);
      document.removeEventListener("selectionchange", onSelChange);
      if (observer) observer.disconnect();
      Object.keys(rendered).forEach(function (k) { unrender(+k); });
      try { if (pdf) pdf.destroy(); } catch (e) {}
      stage.classList.remove("pdf-night");
      if (scroller) scroller.remove();
    }

    return {
      open: open, go: go, goToc: goToc, goPct: goPct, next: next, prev: prev, lineDown: lineDown, lineUp: lineUp,
      here: here, visible: visible, selection: selection, clearSel: clearSel, paint: paint, search: search,
      applyPrefs: applyPrefs, labelOf: labelOf, tocIndex: tocIndex, resize: resize, destroy: destroy, zoomValue: zoomValue
    };
  }

  LIB.pdfEngine = { create: create };
})();
