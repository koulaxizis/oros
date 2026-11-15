// ============================================================
// orOS Layout — EPUB 3 export, reflowable (v1.0.0, LY-EPUB, wave L7 E2)
// One Layout document → a reflowable EPUB 3: the text in the book's
// reading order (page, then top to bottom, then left to right; a
// threaded story is read once, at its first frame), one XHTML file per
// chapter (a level 1-2 heading or a style that starts a page opens
// one), one CSS file from the styles, the pictures as <figure> after
// the text above them on their page, the fonts in use, the cover, a
// nav (headings, landmarks, the print edition's page numbers as a
// page-list) and EPUB Accessibility 1.1 metadata.
// Left out: master items (running heads, page numbers), page-number
// fields, the contents pages (the nav takes their place), shapes and
// lines (counted in the report), text that does not fit its frames
// (overset: the print book does not show it either).
// Pure: no DOM. The browser side (layout/io.js) hands in the pictures
// (already cropped, ≤ 2400 px), the font files, the cover picture and
// a ZIP writer (atelier/zip.js); Node tests do the same.
//   build(doc, opts) → Promise<{ bytes: Uint8Array, report }>
//   opts = { L (computeLayout of doc), pages ([page id] that go out),
//            meta: { title, sub, ser, sn, lang, ppl [{ r, n }], isbn,
//                    printIsbn, publisher, date, desc, kw },
//            modified ("YYYY-MM-DDThh:mm:ssZ"), images: { itemId:
//            { data, type, w, h } }, cover: { data, type, w, h } | null,
//            fontFiles: fn(key) → [{ data, range }] | null (null opts.
//            fontFiles = no fonts inside), pageList (default true),
//            zip: { write }, sha1: fn(Uint8Array) → Promise<Uint8Array> }
// Fonts: the built-in Noto families and Fontsource families (open
// licences) go in as they are; a font file of the user's (uf_) is
// obfuscated with the IDPF algorithm (META-INF/encryption.xml), as
// other layout programs do for fonts that are not open licence.
// Exposes LY_EPUB (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M, T, O;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js"); O = require("./outprof.js");
  } else { M = root.orosDK.model; T = root.orosDK.text; O = root.LY_OUT; }

  var VERSION = "1.1.0";
  var MAX_IMG = 2400;           // px on the long side (the browser side resizes)
  var XHTML_WARN = 300 * 1024;  // bytes per chapter file before a warning
  var ROLE = { a: "aut", t: "trl", i: "ill", e: "edt", c: "cov", n: "nrt", o: "oth" };

  // ---------- small helpers ----------
  function esc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function r3(n) { return String(Math.round(n * 1000) / 1000); }
  function pad(n) { return (n < 10 ? "00" : n < 100 ? "0" : "") + n; }
  function utf8(s) { return new TextEncoder().encode(s); }
  // The book's own words (content in the book's language, not the
  // interface's). i18n-inline-ok: text that goes into the e-book
  var WORDS = {
    el: { toc: "Περιεχόμενα", cover: "Εξώφυλλο", start: "Αρχή", pages: "Σελίδες", landmarks: "Σημεία", summary: "Το βιβλίο έχει πίνακα περιεχομένων με τις επικεφαλίδες του, σωστή σειρά ανάγνωσης και τους αριθμούς σελίδων της έντυπης έκδοσης.", summaryNp: "Το βιβλίο έχει πίνακα περιεχομένων με τις επικεφαλίδες του και σωστή σειρά ανάγνωσης.", summaryFx: "Βιβλίο σταθερής διάταξης: κάθε σελίδα όπως στο έντυπο, με το κείμενό της ως κείμενο, πίνακα περιεχομένων και τους αριθμούς σελίδων του έντυπου.", summaryFxi: "Βιβλίο σταθερής διάταξης: κάθε σελίδα είναι εικόνα της έντυπης σελίδας, με το κείμενό της κρυφό από κάτω για αναζήτηση και ανάγνωση φωναχτά." },
    de: { toc: "Inhalt", cover: "Umschlag", start: "Beginn", pages: "Seiten", landmarks: "Orientierung", summary: "Das Buch hat ein Inhaltsverzeichnis aus seinen Überschriften, eine richtige Lesereihenfolge und die Seitenzahlen der Druckausgabe.", summaryNp: "Das Buch hat ein Inhaltsverzeichnis aus seinen Überschriften und eine richtige Lesereihenfolge.", summaryFx: "Buch mit festem Layout: jede Seite wie im Druck, ihr Text als Text, mit Inhaltsverzeichnis und den Seitenzahlen der Druckausgabe.", summaryFxi: "Buch mit festem Layout: jede Seite ist ein Bild der Druckseite, ihr Text liegt unsichtbar darunter zum Suchen und Vorlesen." },
    en: { toc: "Contents", cover: "Cover", start: "Start", pages: "Pages", landmarks: "Landmarks", summary: "The book has a table of contents from its headings, a correct reading order and the page numbers of the print edition.", summaryNp: "The book has a table of contents from its headings and a correct reading order.", summaryFx: "A fixed-layout book: every page as in print, its text as text, with a table of contents and the print edition's page numbers.", summaryFxi: "A fixed-layout book: every page is a picture of the printed page, with its text hidden underneath for search and reading aloud." }
  };
  function words(lang) { return WORDS[String(lang || "").split("-")[0]] || WORDS.en; }

  // ISBN-13 check digit
  function isbnOk(s) {
    if (!/^\d{13}$/.test(s || "")) return false;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+s[i]) * (i % 2 ? 3 : 1);
    return (10 - sum % 10) % 10 === +s[12];
  }

  // ---------- 1. Reading order ----------
  // [{ k: "p", st, pi (para index), para, page (index), y, breaks:
  //    [{ o, page }] (where a later page starts inside it) }
  //  | { k: "img", it, page, y }]
  function flow(doc, L, pagesOut) {
    var order = M.pagesInOrder(doc), idx = {}, out = {}, rep = { overset: 0, shapes: 0, dropped: 0 };
    order.forEach(function (p, i) { idx[p.id] = i; });
    (pagesOut || order.map(function (p) { return p.id; })).forEach(function (id) { out[id] = 1; });
    var seen = {}, entries = [];
    O.framesInOrder(doc, L).forEach(function (f) {
      var st = M.story(doc, f.it.story);
      if (!st || seen[st.id]) return;
      seen[st.id] = 1;
      if (st.ext && st.ext.hs === "toc") return;
      var frames = doc.items.filter(function (it) { return it.t === "text" && it.story === st.id && idx[it.pg] !== undefined && L.frames[it.id]; })
        .sort(function (a, b) { return a.seq - b.seq || M.cmpStr(a.id, b.id); });
      var info = {};
      frames.forEach(function (fr) {
        var pg = idx[fr.pg];
        L.frames[fr.id].lines.forEach(function (ln) {
          var o0 = null;
          for (var k = 0; k < ln.runs.length; k++) if (typeof ln.runs[k].o === "number") { o0 = ln.runs[k].o; break; }
          var inf = info[ln.p];
          if (!inf) info[ln.p] = { page: pg, pgId: fr.pg, y: fr.y + ln.y, x: fr.x, last: pg, breaks: [], frame: fr.id };
          else if (pg !== inf.last) { if (o0 !== null) inf.breaks.push({ o: o0, page: pg }); inf.last = pg; }
        });
      });
      st.paras.forEach(function (para, pi) {
        var inf = info[pi];
        if (!inf) { if (O.paraText(para)) rep.overset++; return; }
        if (!out[inf.pgId]) { rep.dropped++; return; }
        entries.push({ k: "p", st: st, pi: pi, para: para, page: inf.page, y: inf.y, x: inf.x, breaks: inf.breaks, frame: inf.frame });
      });
    });
    // pictures and shapes on the pages that go out
    var imgs = [];
    order.forEach(function (p, i) {
      if (!out[p.id]) return;
      M.itemsOn(doc, p.id).forEach(function (it) {
        if (it.hide) return;
        if (it.t === "img" && it.a) imgs.push({ k: "img", it: it, page: i, y: it.y, x: it.x });
        else if (it.t !== "text" && it.t !== "img") rep.shapes++;
      });
    });
    imgs.sort(function (a, b) { return a.page - b.page || a.y - b.y || a.x - b.x; });
    // each picture after the last text that starts above it (page, y)
    imgs.forEach(function (im) {
      var at = 0;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.page < im.page || (e.page === im.page && e.y <= im.y)) at = i + 1;
      }
      entries.splice(at, 0, im);
    });
    return { entries: entries, rep: rep, order: order };
  }

  // A short text frame touching a picture (just above or below it,
  // overlapping it across) is its caption: [entries index] → img entry.
  function captions(doc, L, entries) {
    var byStory = {};
    entries.forEach(function (e, i) { if (e.k === "p") (byStory[e.st.id] = byStory[e.st.id] || []).push(i); });
    var taken = {};
    entries.forEach(function (im) {
      if (im.k !== "img") return;
      var it = im.it;
      M.itemsOn(doc, it.pg).forEach(function (tf) {
        if (im.cap || tf.t !== "text" || tf.hide) return;
        var list = byStory[tf.story];
        if (!list || list.length > 3 || taken[tf.story]) return;
        var frames = doc.items.filter(function (x) { return x.t === "text" && x.story === tf.story; });
        if (frames.length !== 1) return;
        var chars = list.reduce(function (n, i) { return n + O.paraText(entries[i].para).length; }, 0);
        if (!chars || chars > 400) return;
        var ox = Math.min(it.x + it.w, tf.x + tf.w) - Math.max(it.x, tf.x);
        if (ox < 0.5 * Math.min(it.w, tf.w)) return;
        var gapBelow = tf.y - (it.y + it.h), gapAbove = it.y - (tf.y + tf.h);
        if ((gapBelow >= -2 && gapBelow <= 14) || (gapAbove >= -2 && gapAbove <= 14)) {
          taken[tf.story] = 1;
          im.cap = list.slice();
        }
      });
    });
    var skip = {};
    Object.keys(taken).forEach(function (sid) { (byStory[sid] || []).forEach(function (i) { skip[i] = 1; }); });
    return skip;
  }

  // ---------- 2. Styles → CSS ----------
  function famName(fam) {
    var f = T.FAMILIES[fam];
    return f ? f.name : "serif";
  }
  function generic(fam) {
    var f = T.FAMILIES[fam], base = f && f.urls ? f.fallback || "sans" : fam;
    return base === "mono" ? "monospace" : base === "sans" ? "sans-serif" : "serif";
  }
  function famOfAttrs(a) { return a.fam && T.FAMILIES[a.fam] ? a.fam : a.font; }
  function colorCss(doc, id) {
    var c = M.swatchColor(doc, id);
    if (!c) return "";
    var v = c.rgb;
    if (v[0] < 40 && v[1] < 40 && v[2] < 40) return "";   // black stays the reader's text colour (night mode)
    return "#" + v.map(function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  }
  // The size most of the text is set in: 1em in the book.
  function baseSize(doc, entries, psMap) {
    var count = {};
    entries.forEach(function (e) {
      if (e.k !== "p") return;
      var ps = T.resolvePs(psMap, e.para.ps), n = O.paraText(e.para).length;
      count[ps.size] = (count[ps.size] || 0) + n;
    });
    var best = 11, most = -1;
    Object.keys(count).forEach(function (k) { if (count[k] > most) { most = count[k]; best = +k; } });
    return best || 11;
  }
  function psCss(doc, id, ps, base, lvl) {
    var d = [];
    d.push("font-family: \"" + famName(ps.fam || ps.font) + "\", " + generic(ps.fam || ps.font));
    if (Math.abs(ps.size - base) > 0.01) d.push("font-size: " + r3(ps.size / base) + "em");
    if (ps.lead > 0) d.push("line-height: " + r3(Math.max(1, Math.min(3, ps.lead / ps.size))));
    d.push("text-align: " + ({ l: "left", c: "center", r: "right", j: "justify" }[ps.align] || "left"));
    d.push("font-weight: " + (ps.b ? "bold" : "normal"));
    d.push("font-style: " + (ps.i ? "italic" : "normal"));
    if (ps.u) d.push("text-decoration: underline");
    var em = function (pt) { return r3(pt / ps.size) + "em"; };
    d.push("margin: " + (ps.sb ? em(ps.sb) : "0") + " " + (ps.ri > 0 ? em(ps.ri) : "0") + " " + (ps.sa ? em(ps.sa) : "0") + " " + (ps.li > 0 ? em(ps.li) : "0"));
    d.push("text-indent: " + (ps.fi ? em(ps.fi) : "0"));
    if (ps.track) d.push("letter-spacing: " + r3(ps.track / 1000) + "em");
    var c = colorCss(doc, ps.color);
    if (c) d.push("color: " + c);
    if (ps.caps) d.push("text-transform: uppercase");
    if (ps.hyph !== 0 && ps.align === "j") d.push("-webkit-hyphens: auto", "hyphens: auto");
    else d.push("-webkit-hyphens: manual", "hyphens: manual");
    d.push("widows: " + (ps.wid || 2), "orphans: " + (ps.orph || 2));
    if (ps.kwn || lvl) d.push("page-break-after: avoid", "break-after: avoid");
    return "." + id + " { " + d.join("; ") + "; }";
  }
  function csCss(doc, id, cs, base) {
    var d = [];
    if (cs.font !== undefined || cs.fam) d.push("font-family: \"" + famName(cs.fam || cs.font) + "\", " + generic(cs.fam || cs.font));
    if (cs.size) d.push("font-size: " + r3(cs.size / base) + "rem");
    if (cs.b !== undefined) d.push("font-weight: " + (cs.b ? "bold" : "normal"));
    if (cs.i !== undefined) d.push("font-style: " + (cs.i ? "italic" : "normal"));
    if (cs.u) d.push("text-decoration: underline");
    if (cs.track) d.push("letter-spacing: " + r3(cs.track / 1000) + "em");
    var c = colorCss(doc, cs.color);
    if (c) d.push("color: " + c);
    if (cs.caps) d.push("text-transform: uppercase");
    return d.length ? "." + id + " { " + d.join("; ") + "; }" : "";
  }

  // ---------- 3. Paragraphs → XHTML ----------
  function runsHtml(para, ps, csMap, keys, breaks, marker) {
    var out = "", base = 0, bi = 0;
    function marks(upto) {
      var s = "";
      while (bi < breaks.length && breaks[bi].o <= upto) s += marker(breaks[bi++].page);
      return s;
    }
    (para.runs || []).forEach(function (run) {
      var cs = run.cs ? T.resolveCs(csMap, run.cs) : {};
      var a = T.runAttrs(ps, cs, run);
      if (run.f) { base += 1; return; }   // page-number fields: no pages here
      var txt = String(run.t || ""), html = "";
      keys[a.key] = 1;
      // a page of the print edition that starts inside this run
      var pos = 0;
      while (bi < breaks.length && breaks[bi].o < base + txt.length) {
        var cut = Math.max(0, breaks[bi].o - base);
        html += piece(txt.slice(pos, cut)) + marker(breaks[bi++].page);
        pos = cut;
      }
      html += piece(txt.slice(pos));
      base += txt.length;
      if (!html) return;
      if (run.ext && run.ext.sup) html = "<sup>" + html + "</sup>";
      if (run.u) html = "<span class=\"u\">" + html + "</span>";
      if (run.i) html = "<em>" + html + "</em>";
      if (run.b) html = "<strong>" + html + "</strong>";
      if (run.cs && csMap[run.cs]) html = "<span class=\"" + run.cs + "\">" + html + "</span>";
      out += html;
    });
    return out + marks(Infinity);
  }
  function piece(s) {
    return esc(s.replace(/\t/g, " ")).replace(/\n/g, "<br/>");
  }

  // ---------- 4. The book ----------
  function uuidOf(hex) {
    var h = hex.slice(0, 32).split("");
    h[12] = "5"; h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
    h = h.join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32);
  }
  function hexOf(b) { return Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); }

  // Everything the files are made of, before any bytes: chapters,
  // headings, page markers, pictures, keys of the fonts in use.
  function compose(doc, opts) {
    var L = opts.L, psMap = T.byId(doc.pstyles), csMap = T.byId(doc.cstyles);
    var F = flow(doc, L, opts.pages);
    var entries = F.entries, skip = captions(doc, L, entries);
    var first = M.firstNumber(doc), base = baseSize(doc, entries, psMap);
    var pageList = opts.pageList !== false, lvl = {}, psUsed = {}, csUsed = {}, keys = {};
    var chapters = [], cur = null, heads = [], marks = [], nextPage = 0, outSet = {};
    (opts.pages || F.order.map(function (p) { return p.id; })).forEach(function (id) { outSet[id] = 1; });
    var report = { chapters: 0, headings: 0, images: 0, noAlt: [], overset: F.rep.overset, shapes: F.rep.shapes, dropped: F.rep.dropped, fonts: [], pages: 0, warnings: [] };
    function level(ps) { if (!(ps in lvl)) lvl[ps] = O.level(doc, ps); return lvl[ps]; }
    function newChapter() { cur = { n: chapters.length + 1, html: [], title: "", ids: 0 }; chapters.push(cur); }
    function marker(page) {
      // the print edition's pages from nextPage up to this one
      if (!pageList) return "";
      var s = "";
      while (nextPage <= page) {
        var p = F.order[nextPage];
        if (p && outSet[p.id]) {
          var label = String(nextPage + first), id = "pg" + label.replace(/[^0-9A-Za-z]/g, "");
          marks.push({ label: label, file: cur.n, id: id });
          s += "<span epub:type=\"pagebreak\" role=\"doc-pagebreak\" id=\"" + id + "\" aria-label=\"" + esc(label) + "\"></span>";
        }
        nextPage++;
      }
      return s;
    }
    var ul = false;
    function closeList() { if (ul) { cur.html.push("</ul>"); ul = false; } }
    entries.forEach(function (e, i) {
      if (skip[i]) return;
      if (e.k === "img") {
        if (!cur) newChapter();
        closeList();
        var im = opts.images && opts.images[e.it.id];
        if (!im) return;
        report.images++;
        var x = e.it.ext || {}, alt = x.deco ? "" : (typeof x.alt === "string" ? x.alt : "");
        // no description: no alt attribute (an empty alt says "decorative")
        if (!x.deco && !alt) report.noAlt.push({ item: e.it.id, page: String(e.page + first) });
        var name = "images/" + e.it.id + (im.type === "image/png" ? ".png" : ".jpg");
        var wPct = Math.max(10, Math.min(100, Math.round(e.it.w / Math.max(1, doc.setup.w - 2 * 36) * 100)));
        var html = marker(e.page) + "<figure class=\"fig\"><img src=\"../" + name + "\"" + (x.deco || alt ? " alt=\"" + esc(alt) + "\"" : "") + (x.deco ? " role=\"presentation\"" : "") + " style=\"width: " + wPct + "%\"/>";
        if (e.cap) {
          html += "<figcaption>" + e.cap.map(function (ci) {
            var pe = entries[ci], ps = T.resolvePs(psMap, pe.para.ps);
            psUsed[pe.para.ps] = 1;
            return "<span class=\"" + pe.para.ps + "\">" + runsHtml(pe.para, ps, csMap, keys, [], function () { return ""; }) + "</span>";
          }).join("<br/>") + "</figcaption>";
        }
        cur.html.push(html + "</figure>");
        cur.files = cur.files || [];
        cur.files.push({ name: name, im: im, item: e.it.id });
        return;
      }
      var para = e.para, ps = T.resolvePs(psMap, para.ps), lv = level(para.ps);
      var text = O.paraText(para);
      var opens = lv === 1 || lv === 2 || ps.brk === "page" || ps.brk === "odd" || ps.brk === "even";
      if (!cur || (opens && cur.html.length)) { closeList(); newChapter(); }
      var mk = marker(e.page);
      if (!text) { if (mk) cur.html.push("<div>" + mk + "</div>"); return; }   // an empty paragraph: only the space it made in print
      psUsed[para.ps] = 1;
      (para.runs || []).forEach(function (r) { if (r.cs && csMap[r.cs]) csUsed[r.cs] = 1; });
      var inner = mk + runsHtml(para, ps, csMap, keys, e.breaks, marker);
      if (lv > 0) {
        closeList();
        var hid = "h" + (++cur.ids);
        cur.html.push("<h" + lv + " id=\"" + hid + "\" class=\"" + para.ps + "\">" + inner + "</h" + lv + ">");
        heads.push({ t: text.slice(0, 300), lvl: lv, file: cur.n, id: hid });
        if (!cur.title) cur.title = text.slice(0, 200);
      } else if (ps.bul) {
        if (!ul) { cur.html.push("<ul class=\"" + para.ps + "\">"); ul = true; }
        cur.html.push("<li>" + inner + "</li>");
      } else {
        closeList();
        cur.html.push("<p class=\"" + para.ps + "\">" + inner + "</p>");
      }
    });
    closeList();
    if (!chapters.length) newChapter();
    // pages after the last text (pictures only, empty) still get a mark
    cur = chapters[chapters.length - 1];
    var tail = marker(F.order.length - 1);
    if (tail) cur.html.push("<div>" + tail + "</div>");
    report.chapters = chapters.length;
    report.headings = heads.length;
    report.pages = marks.length;
    return { chapters: chapters, heads: heads, marks: marks, base: base, psUsed: psUsed, csUsed: csUsed, keys: keys, report: report, lvl: lvl, psMap: psMap, csMap: csMap };
  }

  function chapterXhtml(ch, lang, title) {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n" +
      "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"" + lang + "\" lang=\"" + lang + "\">\n" +
      "<head>\n<meta charset=\"UTF-8\"/>\n<title>" + esc(ch.title || title) + "</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"../css/book.css\"/>\n</head>\n" +
      "<body>\n" + ch.html.join("\n") + "\n</body>\n</html>\n";
  }

  // nested <ol> of the headings (a level can only go one deeper)
  function tocOl(heads, href) {
    var out = "", depth = 0, stack = [];
    heads.forEach(function (h, i) {
      var lv = Math.max(1, h.lvl);
      if (i === 0) { out += "<ol>"; stack.push(lv); depth = 1; }
      else {
        var top = stack[stack.length - 1];
        if (lv > top) { out += "<ol>"; stack.push(lv); }
        else {
          out += "</li>";
          // back out to the list whose parent is above this level
          while (stack.length > 1 && lv <= stack[stack.length - 2]) { out += "</ol></li>"; stack.pop(); }
          stack[stack.length - 1] = lv;
        }
      }
      out += "<li><a href=\"" + href(h) + "\">" + esc(h.t) + "</a>";
    });
    if (heads.length) { out += "</li>"; while (stack.length > 1) { out += "</ol></li>"; stack.pop(); } out += "</ol>"; }
    return out;
  }

  function navXhtml(c, lang, title, hasCover, bodyFile) {
    var W = words(lang);
    var heads = c.heads.length ? c.heads : c.chapters.map(function (ch) {
      return { t: ch.title || title, lvl: 1, file: ch.n, id: "" };
    });
    var href = function (h) { return "text/c" + pad(h.file) + ".xhtml" + (h.id ? "#" + h.id : ""); };
    var s = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n" +
      "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"" + lang + "\" lang=\"" + lang + "\">\n" +
      "<head>\n<meta charset=\"UTF-8\"/>\n<title>" + esc(W.toc) + "</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"css/book.css\"/>\n</head>\n<body>\n" +
      "<nav epub:type=\"toc\" id=\"toc\" role=\"doc-toc\">\n<h1>" + esc(W.toc) + "</h1>\n" + tocOl(heads, href) + "\n</nav>\n";
    s += "<nav epub:type=\"landmarks\" id=\"landmarks\" hidden=\"\">\n<h2>" + esc(W.landmarks) + "</h2>\n<ol>";
    if (hasCover) s += "<li><a epub:type=\"cover\" href=\"cover.xhtml\">" + esc(W.cover) + "</a></li>";
    s += "<li><a epub:type=\"toc\" href=\"nav.xhtml#toc\">" + esc(W.toc) + "</a></li>";
    s += "<li><a epub:type=\"bodymatter\" href=\"text/c" + pad(bodyFile) + ".xhtml\">" + esc(W.start) + "</a></li></ol>\n</nav>\n";
    if (c.marks.length) {
      s += "<nav epub:type=\"page-list\" id=\"page-list\" hidden=\"\">\n<h2>" + esc(W.pages) + "</h2>\n<ol>" + c.marks.map(function (m) {
        return "<li><a href=\"text/c" + pad(m.file) + ".xhtml#" + m.id + "\">" + esc(m.label) + "</a></li>";
      }).join("") + "</ol>\n</nav>\n";
    }
    return s + "</body>\n</html>\n";
  }

  function coverXhtml(lang, title, cover) {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n" +
      "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"" + lang + "\" lang=\"" + lang + "\">\n" +
      "<head>\n<meta charset=\"UTF-8\"/>\n<title>" + esc(words(lang).cover) + "</title>\n" +
      "<style>body { margin: 0; padding: 0; text-align: center; } img { max-width: 100%; max-height: 100vh; height: auto; }</style>\n</head>\n" +
      "<body epub:type=\"cover\">\n<section epub:type=\"cover\"><img role=\"doc-cover\" src=\"images/cover" + (cover.type === "image/png" ? ".png" : ".jpg") + "\" alt=\"" + esc(title) + "\"/></section>\n</body>\n</html>\n";
  }

  function fontFace(key) {
    var p = key.split("-"), v = p[1] || "r";
    return { fam: p[0], weight: v === "b" || v === "bi" ? "bold" : "normal", style: v === "i" || v === "bi" ? "italic" : "normal" };
  }

  // The OPF. ids: manifest rows [{ id, href, type, props }], spine ids.
  // fx (fixed layout, E3): { spread: "auto"|"none", props: { spine id: properties } }
  function opf(meta, uid, lang, modified, man, spine, a11y, fx) {
    var md = [];
    md.push("<dc:identifier id=\"uid\">" + esc(uid) + "</dc:identifier>");
    md.push("<dc:title id=\"title\">" + esc(meta.title) + "</dc:title>");
    md.push("<meta refines=\"#title\" property=\"title-type\">main</meta>");
    if (meta.sub) { md.push("<dc:title id=\"subtitle\">" + esc(meta.sub) + "</dc:title>"); md.push("<meta refines=\"#subtitle\" property=\"title-type\">subtitle</meta>"); }
    md.push("<dc:language>" + esc(lang) + "</dc:language>");
    var n = 0;
    (meta.ppl || []).forEach(function (p) {
      if (!p || !p.n) return;
      var id = "p" + (++n), role = ROLE[p.r] || "oth", tag = role === "aut" ? "dc:creator" : "dc:contributor";
      md.push("<" + tag + " id=\"" + id + "\">" + esc(p.n) + "</" + tag + ">");
      md.push("<meta refines=\"#" + id + "\" property=\"role\" scheme=\"marc:relators\">" + role + "</meta>");
    });
    if (meta.publisher) md.push("<dc:publisher>" + esc(meta.publisher) + "</dc:publisher>");
    if (meta.date) md.push("<dc:date>" + esc(meta.date) + "</dc:date>");
    if (meta.desc) md.push("<dc:description>" + esc(meta.desc) + "</dc:description>");
    String(meta.kw || "").split(/[,;\n]/).map(function (k) { return k.trim(); }).filter(Boolean).slice(0, 20).forEach(function (k) {
      md.push("<dc:subject>" + esc(k) + "</dc:subject>");
    });
    if (meta.ser) {
      md.push("<meta property=\"belongs-to-collection\" id=\"series\">" + esc(meta.ser) + "</meta>");
      md.push("<meta refines=\"#series\" property=\"collection-type\">series</meta>");
      if (meta.sn) md.push("<meta refines=\"#series\" property=\"group-position\">" + esc(meta.sn) + "</meta>");
    }
    if (a11y.pageList && isbnOk(meta.printIsbn)) {
      md.push("<dc:source>urn:isbn:" + meta.printIsbn + "</dc:source>");
      md.push("<meta property=\"pageBreakSource\">urn:isbn:" + meta.printIsbn + "</meta>");
    }
    md.push("<meta property=\"dcterms:modified\">" + modified + "</meta>");
    if (fx) {
      md.push("<meta property=\"rendition:layout\">pre-paginated</meta>");
      md.push("<meta property=\"rendition:orientation\">auto</meta>");
      md.push("<meta property=\"rendition:spread\">" + (fx.spread === "none" ? "none" : "auto") + "</meta>");
    }
    a11y.modes.forEach(function (m) { md.push("<meta property=\"schema:accessMode\">" + m + "</meta>"); });
    a11y.sufficient.forEach(function (m) { md.push("<meta property=\"schema:accessModeSufficient\">" + m + "</meta>"); });
    a11y.features.forEach(function (f) { md.push("<meta property=\"schema:accessibilityFeature\">" + f + "</meta>"); });
    md.push("<meta property=\"schema:accessibilityHazard\">none</meta>");
    md.push("<meta property=\"schema:accessibilitySummary\">" + esc(a11y.summary) + "</meta>");
    if (a11y.conforms) md.push("<meta property=\"dcterms:conformsTo\">EPUB Accessibility 1.1 - WCAG 2.1 Level AA</meta>");
    if (man.some(function (m) { return m.id === "cover-image"; })) md.push("<meta name=\"cover\" content=\"cover-image\"/>");
    var items = man.map(function (m) {
      return "<item id=\"" + m.id + "\" href=\"" + esc(m.href) + "\" media-type=\"" + m.type + "\"" + (m.props ? " properties=\"" + m.props + "\"" : "") + "/>";
    });
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
      "<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"uid\" xml:lang=\"" + lang + "\">\n" +
      "<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n" + md.join("\n") + "\n</metadata>\n" +
      "<manifest>\n" + items.join("\n") + "\n</manifest>\n" +
      "<spine>\n" + spine.map(function (id) { var pr = fx && fx.props[id]; return "<itemref idref=\"" + id + "\"" + (id === "nav" ? " linear=\"no\"" : "") + (pr ? " properties=\"" + pr + "\"" : "") + "/>"; }).join("\n") + "\n</spine>\n</package>\n";
  }

  // IDPF font obfuscation: the first 1040 bytes XOR the SHA-1 of the
  // unique identifier (whitespace removed).
  function obfuscate(data, key) {
    var out = new Uint8Array(data);
    for (var i = 0; i < Math.min(1040, out.length); i++) out[i] ^= key[i % key.length];
    return out;
  }

  function build(doc, opts) {
    opts = opts || {};
    var meta = Object.assign({ title: doc.name || "Untitled" }, opts.meta || {});
    var lang = O.okLang(meta.lang) || "und";
    var c = compose(doc, opts);
    var report = c.report;
    var sha1 = opts.sha1;
    var uidP = isbnOk(meta.isbn) ? Promise.resolve("urn:isbn:" + meta.isbn)
      : sha1(utf8("orOS Layout EPUB " + doc.id)).then(function (h) { return "urn:uuid:" + uuidOf(hexOf(h)); });
    return uidP.then(function (uid) {
      var files = [], man = [], spine = [], enc = [];
      var keyP = sha1(utf8(uid.replace(/[\u0020\u0009\u000D\u000A]/g, "")));
      return keyP.then(function (obfKey) {
        // CSS
        var css = ["@charset \"UTF-8\";"];
        var faces = {}, fontRows = [];
        if (opts.fontFiles) {
          Object.keys(c.keys).sort().forEach(function (key) {
            var fk = T.FAMILIES[key.split("-")[0]] ? key : T.fallbackKey(key);
            var ff = fontFace(fk), fam = ff.fam, parts = opts.fontFiles(fk);
            var famRow = T.FAMILIES[fam];
            if (!parts || !parts.length) { report.fonts.push({ key: fk, name: famName(fam), ok: 0, why: "missing" }); return; }
            var open = !/^uf_/.test(fam);
            parts.forEach(function (pt, k) {
              var file = "fonts/" + fk + (parts.length > 1 ? "-" + (k + 1) : "") + ".ttf";
              if (faces[file]) return;
              faces[file] = 1;
              var data = open ? pt.data : obfuscate(pt.data, obfKey);
              files.push({ name: "EPUB/" + file, data: data });
              man.push({ id: "f-" + fk.replace(/_/g, "-") + "-" + (k + 1), href: file, type: "font/ttf" });
              if (!open) enc.push("EPUB/" + file);
              css.push("@font-face { font-family: \"" + (famRow ? famRow.name : fam) + "\"; font-weight: " + ff.weight + "; font-style: " + ff.style + "; src: url(../" + file + ")" + (pt.range ? "; unicode-range: " + pt.range : "") + "; }");
            });
            report.fonts.push({ key: fk, name: famName(fam), ok: 1, obf: open ? 0 : 1 });
          });
        }
        css.push("body { margin: 0; padding: 0; }");
        css.push("p, li { margin: 0; }");
        css.push("h1, h2, h3 { font-size: 1em; margin: 0; }");
        css.push("ul { margin: 0; padding-left: 1.2em; }");
        css.push(".u { text-decoration: underline; }");
        css.push("sup { font-size: 0.65em; line-height: 0; }");
        css.push("figure.fig { margin: 1em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }");
        css.push("figure.fig img { max-width: 100%; height: auto; }");
        css.push("figure.fig figcaption { margin-top: 0.4em; }");
        Object.keys(c.psUsed).sort().forEach(function (id) {
          css.push(psCss(doc, id, T.resolvePs(c.psMap, id), c.base, c.lvl[id] || 0));
        });
        Object.keys(c.csUsed).sort().forEach(function (id) {
          var r = csCss(doc, id, T.resolveCs(c.csMap, id), c.base);
          if (r) css.push(r);
        });
        files.push({ name: "EPUB/css/book.css", data: css.join("\n") + "\n" });
        man.push({ id: "css", href: "css/book.css", type: "text/css" });
        // cover
        var cover = opts.cover && opts.cover.data ? opts.cover : null;
        if (cover) {
          var cname = "images/cover" + (cover.type === "image/png" ? ".png" : ".jpg");
          files.push({ name: "EPUB/" + cname, data: cover.data });
          man.push({ id: "cover-image", href: cname, type: cover.type === "image/png" ? "image/png" : "image/jpeg", props: "cover-image" });
          files.push({ name: "EPUB/cover.xhtml", data: coverXhtml(lang, meta.title, cover) });
          man.push({ id: "cover", href: "cover.xhtml", type: "application/xhtml+xml" });
          spine.push("cover");
        }
        // chapters and their pictures
        var anyAlt = false, visual = false;
        c.chapters.forEach(function (ch) {
          var name = "text/c" + pad(ch.n) + ".xhtml", x = chapterXhtml(ch, lang, meta.title);
          var bytes = utf8(x);
          if (bytes.length > XHTML_WARN) report.warnings.push({ k: "big", file: name, n: bytes.length });
          files.push({ name: "EPUB/" + name, data: bytes });
          man.push({ id: "c" + pad(ch.n), href: name, type: "application/xhtml+xml" });
          spine.push("c" + pad(ch.n));
          (ch.files || []).forEach(function (f) {
            files.push({ name: "EPUB/" + f.name, data: f.im.data });
            man.push({ id: "i-" + f.item, href: f.name, type: f.im.type === "image/png" ? "image/png" : "image/jpeg" });
            var it = M.find(doc.items, f.item), x2 = (it && it.ext) || {};
            if (!x2.deco) visual = true;
            if (x2.alt) anyAlt = true;
          });
        });
        var body = 1;
        for (var i = 0; i < c.chapters.length; i++) if (c.heads.some(function (h) { return h.file === c.chapters[i].n && h.lvl <= 2; })) { body = c.chapters[i].n; break; }
        files.push({ name: "EPUB/nav.xhtml", data: navXhtml(c, lang, meta.title, !!cover, body) });
        man.push({ id: "nav", href: "nav.xhtml", type: "application/xhtml+xml", props: "nav" });
        // in the spine (not in the reading line) so the landmarks may point at it
        spine.splice(cover ? 1 : 0, 0, "nav");
        // accessibility (EPUB Accessibility 1.1)
        var features = ["tableOfContents", "readingOrder", "displayTransformability"];
        if (c.heads.length) features.push("structuralNavigation");
        if (c.marks.length) features.push("pageNavigation");
        if (anyAlt) features.push("alternativeText");
        var a11y = {
          modes: visual ? ["textual", "visual"] : ["textual"],
          sufficient: !visual || !report.noAlt.length ? ["textual"] : ["textual,visual"],
          features: features, summary: c.marks.length ? words(lang).summary : words(lang).summaryNp, pageList: !!c.marks.length,
          conforms: !report.noAlt.length
        };
        var modified = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(opts.modified || "") ? opts.modified : new Date().toISOString().replace(/\.\d+Z$/, "Z");
        var pkg = opf(meta, uid, lang, modified, man, spine, a11y);
        var zipFiles = [{ name: "mimetype", data: "application/epub+zip" },
          { name: "META-INF/container.xml", data: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n<rootfiles>\n<rootfile full-path=\"EPUB/package.opf\" media-type=\"application/oebps-package+xml\"/>\n</rootfiles>\n</container>\n" }];
        if (enc.length) {
          zipFiles.push({ name: "META-INF/encryption.xml", data: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<encryption xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\" xmlns:enc=\"http://www.w3.org/2001/04/xmlenc#\">\n" +
            enc.map(function (f) { return "<enc:EncryptedData><enc:EncryptionMethod Algorithm=\"http://www.idpf.org/2008/embedding\"/><enc:CipherData><enc:CipherReference URI=\"" + esc(f) + "\"/></enc:CipherData></enc:EncryptedData>"; }).join("\n") + "\n</encryption>\n" });
        }
        zipFiles.push({ name: "EPUB/package.opf", data: pkg });
        var bytes = opts.zip.write(zipFiles.concat(files));
        report.bytes = bytes.length;
        report.uid = uid;
        return { bytes: bytes, report: report };
      });
    });
  }

  // ---------- Fixed layout (LY-EPUB fixed, wave L7 E3) ----------
  // One XHTML file per page that goes out, the size of the print page
  // (1 pt = 1 CSS px, the viewport), its picture behind and its text as
  // text, every word where the print page has it:
  //   mode "text"  the picture is the page without its text (io.js
  //                renders it with render.js skipText = live), the text
  //                is real text over it in the book's fonts;
  //   mode "image" the picture is the whole page, the text lies on top
  //                invisible (search, selection, reading aloud).
  // A rotated text frame stays in the picture (live() false).
  //   buildFixed(doc, opts) → Promise<{ bytes, report }>
  //   opts as build() plus mode, backgrounds: { pageId: { data, type } }
  function live(it) { return it && it.t === "text" && !it.hide && !it.rot; }
  function hex2(v) { return "#" + v.map(function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); }
  function fxPage(doc, L, pg, ctx) {
    var out = [], lvCache = ctx.lvl;
    function level(ps) { if (!(ps in lvCache)) lvCache[ps] = O.level(doc, ps); return lvCache[ps]; }
    function cls(r) {
      var c = M.swatchColor(doc, r.color), col = c ? hex2(c.rgb) : "#000000";
      var k = r.key + "|" + r3(r.size) + "|" + col + "|" + (r.track || 0) + "|" + (r.u ? 1 : 0) + "|" + (r.kern ? 1 : 0);
      if (!ctx.cls[k]) {
        var n = "t" + (++ctx.nCls), fk = T.FAMILIES[r.key.split("-")[0]] ? r.key : T.fallbackKey(r.key), ff = fontFace(fk);
        var asc = T.ascent(r.key, r.size), dsc = T.descent(r.key, r.size);
        ctx.keys[fk] = 1;
        ctx.cls[k] = { n: n, asc: asc, css: "." + n + " { font-family: \"" + famName(ff.fam) + "\", " + generic(ff.fam) + "; font-weight: " + ff.weight + "; font-style: " + ff.style +
          "; font-size: " + r3(r.size) + "px; line-height: " + r3(asc + dsc) + "px; color: " + col +
          (r.track ? "; letter-spacing: " + r3(r.track * r.size / 1000) + "px" : "") + (r.u ? "; text-decoration: underline" : "") +
          "; font-kerning: " + (r.kern ? "normal" : "none") + "; }" };
      }
      return ctx.cls[k];
    }
    var items = M.itemsOn(doc, pg.id);
    items.filter(function (it) { return live(it) && L.frames[it.id]; }).sort(function (a, b) { return a.y - b.y || a.x - b.x || M.cmpStr(a.id, b.id); }).forEach(function (it) {
      var st = M.story(doc, it.story), lines = L.frames[it.id].lines;
      var open = null;
      lines.forEach(function (ln, li) {
        var para = st && st.paras[ln.p];
        if (!open || open.p !== ln.p) {
          if (open) out.push("</" + open.tag + ">");
          var lv = para ? level(para.ps) : 0, hid = "";
          var hk = it.id + ":" + ln.p;
          if (lv > 0 && ctx.headIds[hk]) hid = ctx.headIds[hk];
          open = { p: ln.p, tag: lv > 0 ? "h" + Math.min(3, lv) : "p" };
          out.push("<" + open.tag + (hid ? " id=\"" + hid + "\"" : "") + ">");
        }
        var nextLn = lines[li + 1];
        ln.runs.forEach(function (r, k) {
          if (!r.t) return;
          var c = cls(r), auto = r.t === "-" && typeof r.o !== "number" && k === ln.runs.length - 1;
          var nx = ln.runs[k + 1];
          var gap = nx ? nx.x > r.x + (r.w || 0) + 0.3 : !auto && !!(nextLn && nextLn.p === ln.p);
          var x = it.x + r.x, y = it.y + r.y - c.asc;
          out.push("<span class=\"" + c.n + (ctx.inv ? " inv" : "") + "\" style=\"left: " + r3(x) + "px; top: " + r3(y) + "px\"" + (auto ? " aria-hidden=\"true\"" : "") + ">" + esc(r.t) + (gap ? " " : "") + "</span>");
        });
      });
      if (open) out.push("</" + open.tag + ">");
    });
    // pictures: the description over the place the picture has (it is
    // in the background)
    items.forEach(function (it) {
      if (it.t !== "img" || !it.a || it.hide) return;
      ctx.report.images++;
      var x = it.ext || {};
      if (x.deco) return;
      if (!x.alt) { ctx.report.noAlt.push({ item: it.id, page: ctx.label }); return; }
      ctx.anyAlt = true;
      out.push("<span class=\"im\" role=\"img\" aria-label=\"" + esc(x.alt) + "\" style=\"left: " + r3(it.x) + "px; top: " + r3(it.y) + "px; width: " + r3(it.w) + "px; height: " + r3(it.h) + "px\"></span>");
    });
    // the contents: each line a link to its chapter's page
    (ctx.links[pg.id] || []).forEach(function (lk) {
      out.push("<a class=\"lk\" href=\"" + lk.href + "\" style=\"left: " + r3(lk.x) + "px; top: " + r3(lk.y) + "px; width: " + r3(lk.w) + "px; height: " + r3(lk.h) + "px\"><span class=\"sr\">" + esc(lk.t) + "</span></a>");
    });
    items.forEach(function (it) { if (it.t === "text" && !it.hide && it.rot && L.frames[it.id]) ctx.report.rotated++; });
    return out.join("\n");
  }
  function fxXhtml(lang, title, w, h, bgName, body) {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n" +
      "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"" + lang + "\" lang=\"" + lang + "\">\n" +
      "<head>\n<meta charset=\"UTF-8\"/>\n<meta name=\"viewport\" content=\"width=" + w + ", height=" + h + "\"/>\n<title>" + esc(title) + "</title>\n" +
      "<link rel=\"stylesheet\" type=\"text/css\" href=\"../css/fxl.css\"/>\n</head>\n<body>\n<div class=\"pg\" style=\"width: " + w + "px; height: " + h + "px\">\n" +
      (bgName ? "<img class=\"bg\" src=\"../" + bgName + "\" alt=\"\"/>\n" : "") + body + "\n</div>\n</body>\n</html>\n";
  }
  function buildFixed(doc, opts) {
    opts = opts || {};
    var meta = Object.assign({ title: doc.name || "Untitled" }, opts.meta || {});
    var lang = O.okLang(meta.lang) || "und", L = opts.L, mode = opts.mode === "image" ? "image" : "text";
    var order = M.pagesInOrder(doc), idx = {}, first = M.firstNumber(doc);
    order.forEach(function (p, i) { idx[p.id] = i; });
    var pages = (opts.pages || order.map(function (p) { return p.id; })).filter(function (id) { return idx[id] !== undefined; })
      .sort(function (a, b) { return idx[a] - idx[b]; });
    var W = Math.max(1, Math.round(doc.setup.w)), H = Math.max(1, Math.round(doc.setup.h));
    var report = { fixed: 1, mode: mode, chapters: 0, headings: 0, images: 0, noAlt: [], overset: 0, shapes: 0, dropped: order.length - pages.length, rotated: 0, fonts: [], pages: pages.length, warnings: [] };
    var fileOf = {}, labelOf = {};
    pages.forEach(function (id, k) { fileOf[id] = "pages/p" + ("000" + (k + 1)).slice(-4) + ".xhtml"; labelOf[id] = String(idx[id] + first); });
    // headings → nav (only on pages that go out)
    var heads = O.headings(doc, L).filter(function (h) { return fileOf[h.pg]; }), headIds = {};
    heads.forEach(function (h, k) { h.id = "h" + (k + 1); });
    // a heading's id sits on the paragraph of its first line
    heads.forEach(function (h) {
      var lines = (L.frames[h.item] || {}).lines || [];
      var it = M.find(doc.items, h.item);
      var hit = false;
      for (var i = 0; i < lines.length; i++) { if (it && live(it) && it.y + lines[i].y - lines[i].h === h.y) { headIds[h.item + ":" + lines[i].p] = h.id; hit = true; break; } }
      if (!hit) h.id = "";   // in the picture (a rotated frame): the nav goes to its page
    });
    report.headings = heads.length;
    var links = {};
    O.tocLinks(doc, L, O.headings(doc, L)).forEach(function (lk) {
      if (!fileOf[lk.pg] || !fileOf[lk.to]) return;
      var to = heads.filter(function (h) { return h.pg === lk.to; })[0];
      (links[lk.pg] = links[lk.pg] || []).push({ x: lk.x, y: lk.y, w: lk.w, h: lk.h, href: fileOf[lk.to].replace(/^pages\//, "") + (to && to.id ? "#" + to.id : ""), t: to ? to.t : labelOf[lk.to] });
    });
    var ctx = { cls: {}, nCls: 0, keys: {}, lvl: {}, headIds: headIds, links: links, report: report, inv: mode === "image", anyAlt: false, label: "" };
    var bodies = pages.map(function (id) { ctx.label = labelOf[id]; return fxPage(doc, L, M.find(doc.pages, id), ctx); });
    var sha1 = opts.sha1;
    var uidP = isbnOk(meta.isbn) ? Promise.resolve("urn:isbn:" + meta.isbn)
      : sha1(utf8("orOS Layout EPUB " + doc.id)).then(function (h) { return "urn:uuid:" + uuidOf(hexOf(h)); });
    return uidP.then(function (uid) {
      return sha1(utf8(uid.replace(/[\u0020\u0009\u000D\u000A]/g, ""))).then(function (obfKey) {
        var files = [], man = [], spine = [], enc = [], props = {};
        var css = ["@charset \"UTF-8\";"];
        if (opts.fontFiles && mode === "text") {
          var faces = {};
          Object.keys(ctx.keys).sort().forEach(function (fk) {
            var ff = fontFace(fk), fam = ff.fam, parts = opts.fontFiles(fk), famRow = T.FAMILIES[fam];
            if (!parts || !parts.length) { report.fonts.push({ key: fk, name: famName(fam), ok: 0, why: "missing" }); return; }
            var open = !/^uf_/.test(fam);
            parts.forEach(function (pt, k) {
              var file = "fonts/" + fk + (parts.length > 1 ? "-" + (k + 1) : "") + ".ttf";
              if (faces[file]) return;
              faces[file] = 1;
              files.push({ name: "EPUB/" + file, data: open ? pt.data : obfuscate(pt.data, obfKey) });
              man.push({ id: "f-" + fk.replace(/_/g, "-") + "-" + (k + 1), href: file, type: "font/ttf" });
              if (!open) enc.push("EPUB/" + file);
              css.push("@font-face { font-family: \"" + (famRow ? famRow.name : fam) + "\"; font-weight: " + ff.weight + "; font-style: " + ff.style + "; src: url(../" + file + ")" + (pt.range ? "; unicode-range: " + pt.range : "") + "; }");
            });
            report.fonts.push({ key: fk, name: famName(fam), ok: 1, obf: open ? 0 : 1 });
          });
        }
        css.push("html, body { margin: 0; padding: 0; background: #fff; }");
        css.push(".pg { position: relative; overflow: hidden; }");
        css.push(".pg .bg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }");
        css.push(".pg p, .pg h1, .pg h2, .pg h3 { margin: 0; padding: 0; font-size: 1em; font-weight: normal; }");
        css.push(".pg span, .pg a { position: absolute; margin: 0; padding: 0; white-space: pre; }");
        css.push(".pg .inv { color: transparent !important; }");
        css.push(".pg .im, .pg .lk { display: block; }");
        css.push(".pg .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }");
        Object.keys(ctx.cls).sort(function (a, b) { return +ctx.cls[a].n.slice(1) - +ctx.cls[b].n.slice(1); }).forEach(function (k) { css.push(ctx.cls[k].css); });
        files.push({ name: "EPUB/css/fxl.css", data: css.join("\n") + "\n" });
        man.push({ id: "css", href: "css/fxl.css", type: "text/css" });
        var cover = opts.cover && opts.cover.data ? opts.cover : null;
        if (cover) {
          var cname = "images/cover" + (cover.type === "image/png" ? ".png" : ".jpg");
          files.push({ name: "EPUB/" + cname, data: cover.data });
          man.push({ id: "cover-image", href: cname, type: cover.type === "image/png" ? "image/png" : "image/jpeg", props: "cover-image" });
          files.push({ name: "EPUB/pages/cover.xhtml", data: fxXhtml(lang, words(lang).cover, W, H, "", "<img class=\"bg\" src=\"../" + cname + "\" alt=\"" + esc(meta.title) + "\" style=\"object-fit: contain\"/>") });
          man.push({ id: "cover", href: "pages/cover.xhtml", type: "application/xhtml+xml" });
          spine.push("cover");
          if (doc.setup.facing) props.cover = "rendition:page-spread-center";
        }
        pages.forEach(function (id, k) {
          var bg = opts.backgrounds && opts.backgrounds[id], sid = "p" + ("000" + (k + 1)).slice(-4), bgName = "";
          if (bg && bg.data) {
            bgName = "images/" + sid + (bg.type === "image/png" ? ".png" : ".jpg");
            files.push({ name: "EPUB/" + bgName, data: bg.data });
            man.push({ id: "bg-" + sid, href: bgName, type: bg.type === "image/png" ? "image/png" : "image/jpeg", props: !cover && k === 0 ? "cover-image" : "" });
          } else report.warnings.push({ k: "nobg", page: labelOf[id] });
          var x = fxXhtml(lang, meta.title + " · " + labelOf[id], W, H, bgName, bodies[k]);
          files.push({ name: "EPUB/" + fileOf[id], data: utf8(x) });
          man.push({ id: sid, href: fileOf[id], type: "application/xhtml+xml" });
          spine.push(sid);
          if (doc.setup.facing) props[sid] = M.sideOf(doc, idx[id]) === "L" ? "page-spread-left" : "page-spread-right";
        });
        // nav
        var Wd = words(lang);
        var navHeads = heads.length ? heads.map(function (h) { return { t: h.t, lvl: h.lvl, f: fileOf[h.pg], id: h.id }; }) : [{ t: meta.title, lvl: 1, f: fileOf[pages[0]], id: "" }];
        var hrefN = function (h) { return h.f + (h.id ? "#" + h.id : ""); };
        var nav = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n" +
          "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"" + lang + "\" lang=\"" + lang + "\">\n" +
          "<head>\n<meta charset=\"UTF-8\"/>\n<title>" + esc(Wd.toc) + "</title>\n</head>\n<body>\n" +
          "<nav epub:type=\"toc\" id=\"toc\" role=\"doc-toc\">\n<h1>" + esc(Wd.toc) + "</h1>\n" + tocOl(navHeads, hrefN) + "\n</nav>\n" +
          "<nav epub:type=\"landmarks\" id=\"landmarks\" hidden=\"\">\n<h2>" + esc(Wd.landmarks) + "</h2>\n<ol>" +
          (cover ? "<li><a epub:type=\"cover\" href=\"pages/cover.xhtml\">" + esc(Wd.cover) + "</a></li>" : "") +
          "<li><a epub:type=\"bodymatter\" href=\"" + (heads[0] ? fileOf[heads[0].pg] : fileOf[pages[0]]) + "\">" + esc(Wd.start) + "</a></li></ol>\n</nav>\n" +
          "<nav epub:type=\"page-list\" id=\"page-list\" hidden=\"\">\n<h2>" + esc(Wd.pages) + "</h2>\n<ol>" +
          pages.map(function (id) { return "<li><a href=\"" + fileOf[id] + "\">" + esc(labelOf[id]) + "</a></li>"; }).join("") + "</ol>\n</nav>\n</body>\n</html>\n";
        files.push({ name: "EPUB/nav.xhtml", data: nav });
        man.push({ id: "nav", href: "nav.xhtml", type: "application/xhtml+xml", props: "nav" });
        var features = ["tableOfContents", "pageNavigation"];
        if (heads.length) features.push("structuralNavigation");
        if (ctx.anyAlt) features.push("alternativeText");
        var a11y = { modes: ["textual", "visual"], sufficient: ["textual,visual"], features: features,
          summary: mode === "image" ? Wd.summaryFxi : Wd.summaryFx, pageList: true, conforms: false };
        var modified = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(opts.modified || "") ? opts.modified : new Date().toISOString().replace(/\.\d+Z$/, "Z");
        var pkg = opf(meta, uid, lang, modified, man, spine, a11y, { spread: doc.setup.facing ? "auto" : "none", props: props });
        var zipFiles = [{ name: "mimetype", data: "application/epub+zip" },
          { name: "META-INF/container.xml", data: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n<rootfiles>\n<rootfile full-path=\"EPUB/package.opf\" media-type=\"application/oebps-package+xml\"/>\n</rootfiles>\n</container>\n" }];
        if (enc.length) {
          zipFiles.push({ name: "META-INF/encryption.xml", data: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<encryption xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\" xmlns:enc=\"http://www.w3.org/2001/04/xmlenc#\">\n" +
            enc.map(function (f) { return "<enc:EncryptedData><enc:EncryptionMethod Algorithm=\"http://www.idpf.org/2008/embedding\"/><enc:CipherData><enc:CipherReference URI=\"" + esc(f) + "\"/></enc:CipherData></enc:EncryptedData>"; }).join("\n") + "\n</encryption>\n" });
        }
        zipFiles.push({ name: "EPUB/package.opf", data: pkg });
        var bytes = opts.zip.write(zipFiles.concat(files));
        report.bytes = bytes.length;
        report.uid = uid;
        return { bytes: bytes, report: report };
      });
    });
  }

  var api = { VERSION: VERSION, MAX_IMG: MAX_IMG, isbnOk: isbnOk, flow: flow, compose: compose, build: build, buildFixed: buildFixed, live: live, tocOl: tocOl, obfuscate: obfuscate, uuidOf: uuidOf, ROLE: ROLE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_EPUB = api;
})(typeof window !== "undefined" ? window : this);
