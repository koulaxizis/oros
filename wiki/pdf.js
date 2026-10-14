// ============================================================
// orOS Wiki — article as PDF (v1.0.0, wave 2)
// Draws one parsed article (WikiCore.parseDoc) with jsPDF: title,
// headings, paragraphs (bold, italic, code, links), lists, quotes,
// code blocks, tables, pictures, galleries, infobox, references.
// No DOM: the app passes jsPDF, the vendored Noto fonts (base64) and
// the pictures it read from the orOS disk, so Node tests can run it.
//   WikiPdf.build(JsPDF, fonts, {
//     title, sub, parsed,
//     imgs: { id: { data: Uint8Array, w, h } },
//     L: { refs, missingImg, page }   // labels in the reader's language
//   }) → jsPDF document
// Exposes window.WikiPdf (browser) / module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var FONTS = {
    "NotoSerif-Regular": ["serif", "normal"],
    "NotoSerif-Bold": ["serif", "bold"],
    "NotoSerif-Italic": ["serif", "italic"],
    "NotoSerif-BoldItalic": ["serif", "bolditalic"],
    "NotoSansMono-Regular": ["mono", "normal"]
  };
  var INK = [25, 25, 25], DIM = [110, 110, 110], LINK = [40, 85, 170], RULE = [200, 200, 200];

  function nfc(s) { s = String(s == null ? "" : s); try { return s.normalize("NFC"); } catch (e) { return s; } }

  // Inline nodes → styled runs [{ s, b, i, code, href, link, sup }]
  function runs(nodes, st, out) {
    st = st || {}; out = out || [];
    (nodes || []).forEach(function (n) {
      switch (n.k) {
        case "t": out.push(Object.assign({ s: n.v }, st)); break;
        case "code": out.push(Object.assign({}, st, { s: n.v, code: true })); break;
        case "b": runs(n.c, Object.assign({}, st, { b: true }), out); break;
        case "i": runs(n.c, Object.assign({}, st, { i: true }), out); break;
        case "s": runs(n.c, st, out); break;
        case "wl": case "cl": out.push(Object.assign({}, st, { s: n.v, link: true })); break;
        case "xl": out.push(Object.assign({}, st, { s: n.v, href: n.href })); break;
        case "ref": out.push({ s: "[" + n.n + "]", sup: true }); break;
        case "img": if (n.alt) out.push(Object.assign({}, st, { s: n.alt, i: true })); break;
        default: break;
      }
    });
    return out;
  }
  function text(nodes) { return runs(nodes).map(function (r) { return r.s; }).join(""); }

  function build(JsPDF, fonts, o) {
    o = o || {};
    var L = o.L || {}, imgs = o.imgs || {}, parsed = o.parsed || { blocks: [], refs: [] };
    var pdf = new JsPDF({ unit: "pt", format: "a4", compress: true });
    var have = {};
    Object.keys(FONTS).forEach(function (n) {
      if (!fonts || !fonts[n]) return;
      pdf.addFileToVFS(n + ".ttf", fonts[n]);
      pdf.addFont(n + ".ttf", FONTS[n][0], FONTS[n][1]);
      have[FONTS[n][0] + FONTS[n][1]] = 1;
    });
    var SERIF = have.serifnormal ? "serif" : "times", MONO = have.mononormal ? "mono" : "courier";
    function face(r) {
      if (r.code) return [MONO, "normal"];
      var st = r.b && r.i ? "bolditalic" : (r.b ? "bold" : (r.i ? "italic" : "normal"));
      if (SERIF === "serif" && !have["serif" + st]) st = "normal";
      return [SERIF, st];
    }
    try { pdf.setProperties({ title: nfc(o.title), creator: "orOS Wiki" }); } catch (e) {}

    var W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
    var M = 56, CW = W - 2 * M, BOT = H - 52, y = M, page = 1;

    function footer() {
      pdf.setFont(SERIF, "normal"); pdf.setFontSize(8); pdf.setTextColor(DIM[0], DIM[1], DIM[2]);
      pdf.text(nfc(o.title || ""), M, H - 30);
      pdf.text(String(page), W - M, H - 30, { align: "right" });
    }
    function newPage() { footer(); pdf.addPage(); page++; y = M; }
    function need(h) { if (y + h > BOT && y > M) newPage(); }
    function color(c) { pdf.setTextColor(c[0], c[1], c[2]); }

    // Word flow over runs between x0 and x1; moves y below the text.
    function flow(rs, size, x0, x1, lead, col) {
      var x = x0, lineH = size * (lead || 1.45);
      x1 = x1 || W - M;
      need(lineH);
      rs.forEach(function (r) {
        var f = face(r), sz = r.sup ? size * 0.68 : (r.code ? size * 0.92 : size);
        pdf.setFont(f[0], f[1]);
        pdf.setFontSize(sz);
        var c = r.href || r.link ? LINK : (col || INK);
        color(c);
        nfc(r.s).split(/(\s+)/).forEach(function (w) {
          if (!w) return;
          if (/^\s+$/.test(w)) { if (x > x0) x += pdf.getTextWidth(" "); return; }
          var ww = pdf.getTextWidth(w);
          if (x + ww > x1 && x > x0) { y += lineH; need(lineH); x = x0; }
          while (ww > x1 - x0) {                 // one very long word: cut it
            var cut = w.length;
            while (cut > 1 && pdf.getTextWidth(w.slice(0, cut)) > x1 - x0) cut--;
            pdf.text(w.slice(0, cut), x, y + size * 0.8);
            w = w.slice(cut); ww = pdf.getTextWidth(w);
            y += lineH; need(lineH); x = x0;
          }
          pdf.text(w, x, y + (r.sup ? size * 0.45 : size * 0.8));
          if (r.href) { try { pdf.link(x, y, ww, size, { url: r.href }); } catch (e) {} }
          x += ww;
        });
      });
      y += lineH;
    }
    // Plain lines (captions, cells): wrapped, optionally centred.
    function lines(s, size, x0, w, style, col, center) {
      pdf.setFont(SERIF, style || "normal");
      pdf.setFontSize(size);
      color(col || INK);
      var ls = pdf.splitTextToSize(nfc(s), w), lh = size * 1.3;
      ls.forEach(function (l) {
        need(lh);
        pdf.text(l, center ? x0 + w / 2 : x0, y + size * 0.8, center ? { align: "center" } : undefined);
        y += lh;
      });
    }
    function rule(x0, x1, c) { pdf.setDrawColor((c || RULE)[0], (c || RULE)[1], (c || RULE)[2]); pdf.setLineWidth(0.6); pdf.line(x0, y, x1, y); }

    // A picture of at most maxW × maxH, centred in [x0, x0 + boxW].
    function picture(id, maxW, maxH, x0, boxW, alt) {
      var p = imgs[id];
      if (!p || !p.data || !p.w || !p.h) {
        lines("[" + (L.missingImg || "picture") + "]", 9, x0, boxW, "italic", DIM, true);
        return;
      }
      var w = Math.min(maxW, p.w * 0.75), h = w * p.h / p.w;
      if (h > maxH) { h = maxH; w = h * p.w / p.h; }
      need(h + 4);
      try { pdf.addImage(p.data, /\.png$/.test(id) ? "PNG" : "JPEG", x0 + (boxW - w) / 2, y, w, h, undefined, "FAST"); } catch (e) {}
      y += h + 4;
    }

    var refsDone = false;
    function refList(refs) {
      refs.forEach(function (r) {
        need(14);
        pdf.setFont(SERIF, "normal"); pdf.setFontSize(9); color(DIM);
        pdf.text(r.n + ".", M + 14, y + 7.2, { align: "right" });
        flow(r.c ? runs(r.c) : [{ s: "—" }], 9, M + 20, W - M, 1.4);
      });
    }
    function list(l, depth) {
      var ind = M + 6 + depth * 16;
      l.items.forEach(function (it, n) {
        need(15);
        pdf.setFont(SERIF, "normal"); pdf.setFontSize(10.5); color(INK);
        pdf.text(l.k === "ol" ? (n + 1) + "." : "•", ind, y + 8.4);
        flow(runs(it.c), 10.5, ind + 14, W - M, 1.45);
        if (it.sub) list(it.sub, depth + 1);
      });
      y += 3;
    }
    function table(b) {
      var n = Math.max(b.head.length, 1);
      b.rows.forEach(function (r) { n = Math.max(n, r.length); });
      var cw = CW / n, pad = 4, size = 9, lh = size * 1.3;
      function row(cells, head) {
        pdf.setFont(SERIF, head ? "bold" : "normal");
        pdf.setFontSize(size);
        var wrapped = [], hmax = 0;
        for (var i = 0; i < n; i++) {
          var ls = pdf.splitTextToSize(nfc(text(cells[i] || [])), cw - 2 * pad);
          wrapped.push(ls);
          hmax = Math.max(hmax, ls.length);
        }
        var rh = hmax * lh + 2 * pad;
        need(rh);
        if (head) { pdf.setFillColor(238, 238, 238); pdf.rect(M, y, CW, rh, "F"); }
        pdf.setDrawColor(RULE[0], RULE[1], RULE[2]); pdf.setLineWidth(0.5);
        color(INK);
        for (var j = 0; j < n; j++) {
          pdf.rect(M + j * cw, y, cw, rh);
          var al = b.al[j] || "left", tx = al === "right" ? M + (j + 1) * cw - pad : (al === "center" ? M + j * cw + cw / 2 : M + j * cw + pad);
          wrapped[j].forEach(function (l, k) { pdf.text(l, tx, y + pad + size * 0.8 + k * lh, al === "left" ? undefined : { align: al }); });
        }
        y += rh;
      }
      row(b.head, true);
      b.rows.forEach(function (r) { row(r, false); });
      y += 8;
    }
    function infobox(b) {
      var bw = Math.min(CW, 300), x0 = M + (CW - bw) / 2;
      y += 2;
      if (b.title) {
        need(26);
        pdf.setFillColor(232, 232, 232); pdf.rect(x0, y, bw, 22, "F");
        pdf.setFont(SERIF, "bold"); pdf.setFontSize(12); color(INK);
        pdf.text(pdf.splitTextToSize(nfc(text(b.title)), bw - 10)[0] || "", x0 + bw / 2, y + 15, { align: "center" });
        y += 26;
      }
      if (b.img) picture(b.img.id, bw - 20, 220, x0, bw, b.img.alt);
      if (b.cap) lines(text(b.cap), 8.5, x0 + 6, bw - 12, "italic", DIM, true);
      b.rows.forEach(function (r) {
        var kw = bw * 0.38, y0 = y;
        rule(x0, x0 + bw);
        y += 3;
        var top = y;
        lines(text(r.k), 9, x0 + 4, kw - 8, "bold");
        var yk = y;
        y = top;
        flow(runs(r.v), 9, x0 + kw, x0 + bw - 4, 1.3);
        y = Math.max(y, yk) + 1;
        if (y < y0) y = y0;
      });
      rule(x0, x0 + bw);
      y += 12;
    }
    function blocks(bs, indent) {
      (bs || []).forEach(function (b) {
        switch (b.k) {
          case "h":
            var hs = b.lvl === 2 ? 15 : (b.lvl === 3 ? 12.5 : 11);
            y += b.lvl === 2 ? 10 : 6;
            need(hs * 2.4);
            flow(runs(b.c, { b: true }), hs, M, W - M, 1.3);
            if (b.lvl === 2) { rule(M, W - M); y += 6; }
            break;
          case "p": flow(runs(b.c), 10.5, M + (indent || 0), W - M, 1.45); y += 5; break;
          case "ul": case "ol": list(b, indent ? 1 : 0); break;
          case "quote":
            var y0 = y;
            blocks(b.c.map(function (q) { return q.k === "p" ? { k: "p", c: [{ k: "i", c: q.c }] } : q; }), 16);
            pdf.setDrawColor(RULE[0], RULE[1], RULE[2]); pdf.setLineWidth(2);
            if (y > y0) pdf.line(M + 5, y0 + 2, M + 5, y - 6);
            break;
          case "pre":
            pdf.setFont(MONO, "normal"); pdf.setFontSize(8.5); color(INK);
            String(b.v).split("\n").forEach(function (raw) {
              pdf.splitTextToSize(nfc(raw) || " ", CW - 16).forEach(function (l) {
                need(11.5);
                pdf.setFillColor(244, 244, 244); pdf.rect(M, y, CW, 11.5, "F");
                pdf.text(l, M + 8, y + 8.5);
                y += 11.5;
              });
            });
            y += 8;
            break;
          case "hr": need(14); y += 6; rule(M + 60, W - M - 60); y += 8; break;
          case "table": table(b); break;
          case "fig":
            var fw = b.al === "none" ? CW : (b.w ? Math.min(CW, b.w * 0.75) : Math.min(CW, 260));
            y += 4;
            picture(b.id, fw, 420, M, CW, b.alt || text(b.c));
            if (b.c.length) lines(text(b.c), 9, M + (CW - Math.max(fw, 160)) / 2, Math.max(fw, 160), "italic", DIM, true);
            y += 8;
            break;
          case "gal":
            var cols = 3, gap = 10, cell = (CW - gap * (cols - 1)) / cols;
            for (var i = 0; i < b.items.length; i += cols) {
              var row = b.items.slice(i, i + cols), top = y, bottom = y;
              need(cell + 30);
              top = y;
              row.forEach(function (it, j) {
                y = top;
                picture(it.id, cell, cell, M + j * (cell + gap), cell, it.alt || text(it.c));
                if (it.c.length) lines(text(it.c), 8, M + j * (cell + gap), cell, "italic", DIM, true);
                bottom = Math.max(bottom, y);
              });
              y = bottom + 6;
            }
            break;
          case "ibox": infobox(b); break;
          case "refs":
            if (parsed.refs && parsed.refs.length) { refList(parsed.refs); refsDone = true; y += 6; }
            break;
          default: break;
        }
      });
    }

    // Title, line under it, then the article.
    pdf.setFont(SERIF, "bold"); pdf.setFontSize(24); color(INK);
    pdf.splitTextToSize(nfc(o.title || ""), CW).forEach(function (l) { pdf.text(l, M, y + 22); y += 30; });
    if (o.sub) { pdf.setFont(SERIF, "normal"); pdf.setFontSize(9); color(DIM); pdf.text(nfc(o.sub), M, y + 4); y += 12; }
    rule(M, W - M, [120, 120, 120]);
    y += 14;
    blocks(parsed.blocks);
    if (parsed.refs && parsed.refs.length && !refsDone) {
      y += 10;
      need(50);
      flow([{ s: L.refs || "References", b: true }], 15, M, W - M, 1.3);
      rule(M, W - M);
      y += 6;
      refList(parsed.refs);
    }
    footer();
    return pdf;
  }

  var API = { build: build, runs: runs, FONTS: Object.keys(FONTS) };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.WikiPdf = API;
})(typeof window !== "undefined" ? window : globalThis);
