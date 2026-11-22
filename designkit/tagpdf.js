// ============================================================
// orOS designkit — tagpdf.js (v1.0.0, LY-N6)
// A tagged, accessible PDF (PDF/UA-1) from a PDF that pdf.js built with
// opts.tagged: its marked content (pdf.orosTag: MCIDs per page, each
// with what it is) becomes the structure tree, with pdf-lib:
//   Document → P / H1-H6 / Note / TOC (TOCI) / Figure (Alt, BBox) /
//   Link (OBJR, the link annotation; its /Contents described),
//   in reading order: the stories in the order they start (page, top,
//   left), each paragraph by paragraph, its footnotes after the last
//   paragraph that starts on or before their page; pictures where they
//   stand. Headings never skip a level and start at H1.
//   ParentTree and /StructParents, /StructParent on the links, /Tabs /S,
//   MarkInfo, /Lang, DisplayDocTitle, XMP with dc:title and
//   pdfuaid:part 1, an IDTree for the notes.
//   - plan(tag) → [{ s, key, parts: [{ n, mcid }], alt, bbox, kids }]
//     (pure: the order and the roles, tested on its own)
//   - make(PDFLib, bytes, tag, { title, lang, linkText(uri | page) })
//     → Promise<{ bytes, elems, figures, links, notes }>
// Pure (no DOM): Node tests run it. Exposes orosDK.tagpdf /
// module.exports.
// ============================================================
(function (root) {
  "use strict";

  function before(a, b) { return a.n - b.n || a.y - b.y || a.x - b.x; }

  // units (one per paragraph, note or figure) in reading order
  function plan(tag) {
    var units = {}, list = [];
    Object.keys(tag && tag.pages || {}).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
      (tag.pages[n] || []).forEach(function (e, mcid) {
        if (!e || typeof e.key !== "string") return;
        var u = units[e.key];
        if (!u) {
          u = units[e.key] = { key: e.key, k: e.k, sid: e.sid, p: e.p, note: !!e.note, r: e.k === "f" ? "Figure" : e.r || "P",
            alt: e.alt || "", first: { n: n, y: +e.y || 0, x: +e.x || 0 }, parts: [], boxes: [], text: [] };
          list.push(u);
        }
        u.parts.push({ n: n, mcid: mcid });
        u.boxes.push({ n: n, x: +e.x || 0, y: +e.y || 0, w: +e.w || 0, h: +e.h || 0 });
        if (e.t) u.text.push(e.t);
      });
    });
    // stories in the order they start; in a story, paragraphs in order
    // (endnotes come last: their index is past the story's own) and
    // each footnote after the last paragraph that starts on its page
    // or before it
    var stories = {}, sOrder = [], figs = [];
    list.forEach(function (u) {
      if (u.k === "f") { figs.push(u); return; }
      var s = stories[u.sid];
      if (!s) { s = stories[u.sid] = { first: u.first, paras: [], foot: [] }; sOrder.push(u.sid); }
      if (before(u.first, s.first) < 0) s.first = u.first;
      if (u.p < 0) s.foot.push(u); else s.paras.push(u);
    });
    sOrder.sort(function (a, b) { return before(stories[a].first, stories[b].first); });
    var seq = [];
    sOrder.forEach(function (sid) {
      var s = stories[sid], out = s.paras.sort(function (a, b) { return a.p - b.p; }).slice();
      s.foot.sort(function (a, b) { return before(a.first, b.first); }).forEach(function (f) {
        var at = 0;
        for (var i = 0; i < out.length; i++) if (out[i].first.n <= f.first.n) at = i + 1;
        out.splice(at, 0, f);
      });
      seq = seq.concat(out);
    });
    // a picture after the last unit that starts before it
    figs.sort(function (a, b) { return before(a.first, b.first); }).forEach(function (f) {
      var at = 0;
      for (var i = 0; i < seq.length; i++) if (before(seq[i].first, f.first) <= 0) at = i + 1;
      seq.splice(at, 0, f);
    });
    // headings: the first is H1, none skips a level
    var prev = 0;
    seq.forEach(function (u) {
      var m = /^H([1-6])$/.exec(u.r);
      if (!m) return;
      var lv = Math.min(+m[1], prev + 1);
      u.r = "H" + lv; prev = lv;
    });
    // contents lines in a TOC each run of them
    var out = [], toc = null;
    seq.forEach(function (u) {
      if (u.r === "TOCI") {
        if (!toc) { toc = { r: "TOC", kids: [] }; out.push(toc); }
        toc.kids.push(u);
        return;
      }
      toc = null;
      out.push(u);
    });
    return out;
  }

  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return Uint8Array.from(Buffer.from(s, "utf8"));
  }
  function xmlEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function xmp(title, lang) {
    return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" ' +
      'xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">\n' +
      '<dc:format>application/pdf</dc:format>\n' +
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">' + xmlEsc(title) + '</rdf:li></rdf:Alt></dc:title>\n' +
      (lang ? '<dc:language><rdf:Bag><rdf:li>' + xmlEsc(lang) + '</rdf:li></rdf:Bag></dc:language>\n' : "") +
      '<xmp:CreatorTool>orOS Layout</xmp:CreatorTool>\n<pdf:Producer>orOS Layout (jsPDF + pdf-lib)</pdf:Producer>\n' +
      '<pdfuaid:part>1</pdfuaid:part>\n' +
      '</rdf:Description>\n</rdf:RDF>\n</x:xmpmeta>\n' + new Array(20).join("                                                  \n") + '<?xpacket end="w"?>';
  }

  function num(P, v) { return v && typeof v.asNumber === "function" ? v.asNumber() : 0; }

  function make(P, bytes, tag, opts) {
    opts = opts || {};
    var N = P.PDFName.of;
    return P.PDFDocument.load(bytes, { updateMetadata: false }).then(function (doc) {
      var ctx = doc.context, pages = doc.getPages(), units = plan(tag);
      var pageRef = function (n) { return pages[n - 1] ? pages[n - 1].ref : null; };
      var rootRef = ctx.nextRef(), docRef = ctx.nextRef();
      var parentOf = {};   // page number → [elem ref by MCID]
      var stats = { elems: 0, figures: 0, links: 0, notes: 0 }, ids = [];
      function elem(s, parent, n) {
        var d = ctx.obj({ Type: "StructElem", S: s });
        d.set(N("P"), parent);
        if (n && pageRef(n)) d.set(N("Pg"), pageRef(n));
        stats.elems++;
        return d;
      }
      function textOf(s) { return P.PDFHexString.fromText(String(s).replace(/\s+/g, " ").trim().slice(0, 2000)); }
      var made = [];   // { u, ref, dict }
      function unitElem(u, parentRef) {
        var ref = ctx.nextRef();
        if (u.kids) {
          var dt = elem(u.r, parentRef, 0), ks = [];
          u.kids.forEach(function (k) { ks.push(unitElem(k, ref)); });
          dt.set(N("K"), ctx.obj(ks));
          ctx.assign(ref, dt);
          return ref;
        }
        var n0 = u.parts[0].n, d = elem(u.r, parentRef, n0), K = [];
        u.parts.forEach(function (pt) {
          (parentOf[pt.n] = parentOf[pt.n] || [])[pt.mcid] = ref;
          if (pt.n === n0) K.push(ctx.obj(pt.mcid));
          else K.push(ctx.obj({ Type: "MCR", Pg: pageRef(pt.n), MCID: pt.mcid }));
        });
        if (u.r === "Figure") {
          stats.figures++;
          d.set(N("Alt"), textOf(u.alt));
          var b = u.boxes[0], H = pages[n0 - 1].getHeight();
          d.set(N("A"), ctx.obj({ O: "Layout", BBox: [b.x, H - b.y - b.h, b.x + b.w, H - b.y] }));
        }
        if (u.r === "Note") {
          stats.notes++;
          var id = "note-" + stats.notes;
          d.set(N("ID"), P.PDFString.of(id));
          ids.push([id, ref]);
        }
        d.set(N("K"), ctx.obj(K));
        ctx.assign(ref, d);
        made.push({ u: u, ref: ref, dict: d, K: K });
        return ref;
      }
      var top = units.map(function (u) { return unitElem(u, docRef); });

      // links: a Link element (OBJR) in the paragraph the link sits on
      var nextKey = pages.length, nums = [];
      pages.forEach(function (pg, i) {
        var n = i + 1, arr = parentOf[n] || [];
        pg.node.set(N("Tabs"), N("S"));
        if (arr.length) {
          pg.node.set(N("StructParents"), ctx.obj(i));
          for (var m = 0; m < arr.length; m++) if (!arr[m]) arr[m] = docRef;
          nums.push(ctx.obj(i), ctx.obj(arr));
        }
        var annots = pg.node.get(N("Annots"));
        if (annots instanceof P.PDFRef) annots = ctx.lookup(annots);
        if (!(annots instanceof P.PDFArray)) return;
        var H = pg.getHeight();
        for (var a = 0; a < annots.size(); a++) {
          var aref = annots.get(a), ad = aref instanceof P.PDFRef ? ctx.lookup(aref) : aref;
          if (!ad || typeof ad.get !== "function" || ad.get(N("Subtype")) !== N("Link")) continue;
          if (!(aref instanceof P.PDFRef)) { aref = ctx.register(ad); annots.set(a, aref); }
          var rc = ad.get(N("Rect")), r = rc instanceof P.PDFArray ? [0, 1, 2, 3].map(function (q) { return num(P, rc.get(q)); }) : [0, 0, 0, 0];
          var lx0 = Math.min(r[0], r[2]), lx1 = Math.max(r[0], r[2]), ly0 = H - Math.max(r[1], r[3]), ly1 = H - Math.min(r[1], r[3]);
          // the unit with the most of its text under the link
          var host = null, best = 0, words = [];
          made.forEach(function (m) {
            m.u.boxes.forEach(function (b, bi) {
              if (b.n !== n) return;
              var ox = Math.min(lx1, b.x + b.w) - Math.max(lx0, b.x), oy = Math.min(ly1, b.y + b.h) - Math.max(ly0, b.y);
              if (ox <= 0 || oy <= 0) return;
              if (ox * oy > best) { best = ox * oy; host = m; }
              if (m.u.text[bi]) words.push(m.u.text[bi]);
            });
          });
          var lref = ctx.nextRef(), parent = host ? host.ref : docRef, ld = elem("Link", parent, n);
          ld.set(N("K"), ctx.obj([ctx.obj({ Type: "OBJR", Obj: aref, Pg: pg.ref })]));
          ctx.assign(lref, ld);
          if (host) host.K.push(lref), host.dict.set(N("K"), ctx.obj(host.K));
          else top.push(lref);
          ad.set(N("StructParent"), ctx.obj(nextKey));
          nums.push(ctx.obj(nextKey), lref);
          nextKey++;
          if (!ad.get(N("Contents"))) {
            // a web link says where it goes; a link to a page, the
            // words it sits on (a contents line: the chapter and page)
            var act = ad.get(N("A")), uri = act && typeof act.get === "function" ? act.get(N("URI")) : null;
            var desc = uri ? (uri.decodeText ? uri.decodeText() : String(uri.asString ? uri.asString() : "")) : words.join(" ").trim();
            if (opts.linkText) desc = opts.linkText(desc, uri ? "uri" : "page") || desc;
            ad.set(N("Contents"), textOf(desc || "Link"));
          }
          stats.links++;
        }
      });

      var D = elem("Document", rootRef, 0);
      D.set(N("K"), ctx.obj(top));
      if (opts.lang) D.set(N("Lang"), P.PDFString.of(String(opts.lang)));
      ctx.assign(docRef, D);
      var str = ctx.obj({ Type: "StructTreeRoot" });
      str.set(N("K"), docRef);
      str.set(N("ParentTree"), ctx.register(ctx.obj({ Nums: nums })));
      str.set(N("ParentTreeNextKey"), ctx.obj(nextKey));
      if (ids.length) {
        ids.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
        var names = [];
        ids.forEach(function (x) { names.push(P.PDFString.of(x[0]), x[1]); });
        str.set(N("IDTree"), ctx.register(ctx.obj({ Names: names })));
      }
      ctx.assign(rootRef, str);
      var cat = doc.catalog;
      cat.set(N("StructTreeRoot"), rootRef);
      cat.set(N("MarkInfo"), ctx.obj({ Marked: true }));
      if (opts.lang) cat.set(N("Lang"), P.PDFString.of(String(opts.lang)));
      var title = String(opts.title || doc.getTitle() || "Untitled").slice(0, 300);
      doc.setTitle(title, { showInWindowTitleBar: true });
      cat.set(N("Metadata"), ctx.register(ctx.stream(utf8(xmp(title, opts.lang)), { Type: "Metadata", Subtype: "XML" })));
      return doc.save({ useObjectStreams: false, updateFieldAppearances: false }).then(function (out) {
        return { bytes: out, elems: stats.elems, figures: stats.figures, links: stats.links, notes: stats.notes };
      });
    });
  }

  var api = { plan: plan, make: make };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.tagpdf = api; root.DK_TAGPDF = api; }
})(typeof window !== "undefined" ? window : this);
