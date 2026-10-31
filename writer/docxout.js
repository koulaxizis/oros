// ============================================================
// orOS Writer — docxout.js: the Word (.docx) writer (DOCX v2)
// Turns the exported clone of a document (a detached element, see
// writer.js ioExportClone) into the parts of a .docx package. Shared
// by writer.js (window.WriterDocxOut) and the round-trip tests.
//   · build(root, o) → Promise<[{ name, data: Uint8Array }]>
//       o = { title, author, category, tags, page {w, h} mm,
//             margins {top, right, bottom, left} mm,
//             appendix (XML of extra paragraphs, after a page break),
//             track (WriterTrack, for <ins>/<del class="tc">),
//             imageOf(src) → Promise<{ bytes, ext, w, h } | null> }
//   · run(text, pr), para(runsXml, opts): the helpers the appendix uses
//   · listFormat(listEl): Word number format of an <ol>/<ul>
// Kept: headings, bold / italic / underline / strike / superscript,
// alignment (w:jc), quotes, code, rules, page breaks, tables, tracked
// changes, real numbered and bulleted lists (word/numbering.xml: one
// list definition per list, with its start and per-level formats,
// Greek letters as a custom format with a lowerLetter fallback), and
// real pictures (word/media/*, an inline w:drawing sized as shown,
// never wider than the text column). A picture that can't be read
// (another site that does not allow it) stays an "[image]" text.
// No scripts, no external relationships: only what is written here.
// ============================================================
(function (root) {
  "use strict";

  var NS = {
    w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
    mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
    w14: "http://schemas.microsoft.com/office/word/2010/wordml"
  };
  var REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
  var EMU_PX = 9525;          // EMU per CSS pixel (96 dpi)
  var EMU_MM = 36000;
  var TWIP_MM = 1440 / 25.4;
  var MAX_IMG_PX = 1600;      // a picture without a size: its natural size, at most this

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function clean(s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); }
  function twips(mm) { return Math.round((Number(mm) || 0) * TWIP_MM); }

  /* ----- runs ----- */
  function run(text, pr) {
    pr = pr || {};
    var rPr = "";
    if (pr.b)      rPr += "<w:b/>";
    if (pr.i)      rPr += "<w:i/>";
    if (pr.strike) rPr += "<w:strike/>";
    if (pr.u)      rPr += "<w:u w:val=\"single\"/>";
    if (pr.sup)    rPr += "<w:vertAlign w:val=\"superscript\"/>";
    var tag = pr.del ? "w:delText" : "w:t";     // text of a tracked deletion
    return "<w:r>" + (rPr ? "<w:rPr>" + rPr + "</w:rPr>" : "") +
      "<" + tag + " xml:space=\"preserve\">" + esc(clean(text)) + "</" + tag + "></w:r>";
  }

  // w:jc of an element's own text-align ('' = left, the default)
  var JC = { center: "center", right: "right", end: "right", justify: "both" };
  function jcOf(el) {
    if (!el || el.nodeType !== 1) return "";
    var a = String((el.style && el.style.textAlign) || el.getAttribute("align") || "").toLowerCase();
    return JC[a] || "";
  }

  function para(runsXml, opts) {
    opts = opts || {};
    var pPr = "";
    if (opts.style) pPr += "<w:pStyle w:val=\"" + opts.style + "\"/>";
    if (opts.num)   pPr += "<w:numPr><w:ilvl w:val=\"" + opts.num.ilvl + "\"/><w:numId w:val=\"" + opts.num.id + "\"/></w:numPr>";
    if (opts.border) pPr += "<w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"auto\"/></w:pBdr>";
    if (opts.jc)    pPr += "<w:jc w:val=\"" + opts.jc + "\"/>";
    return runsXml || pPr
      ? "<w:p>" + (pPr ? "<w:pPr>" + pPr + "</w:pPr>" : "") + (runsXml || "") + "</w:p>"
      : "<w:p/>";
  }

  /* ----- lists → word/numbering.xml ----- */
  // list-style-type → Word number format
  var FMT = { decimal: "decimal", "lower-alpha": "lowerLetter", "lower-latin": "lowerLetter",
    "upper-alpha": "upperLetter", "upper-latin": "upperLetter", "lower-roman": "lowerRoman",
    "upper-roman": "upperRoman", "lower-greek": "greek", "decimal-leading-zero": "decimalZero" };
  var TYPE_ATTR = { a: "lowerLetter", A: "upperLetter", i: "lowerRoman", I: "upperRoman", "1": "decimal" };
  function listFormat(listEl) {
    if (!listEl || listEl.nodeName !== "OL") return "bullet";
    var st = String((listEl.style && listEl.style.listStyleType) || "").toLowerCase();
    if (FMT[st]) return FMT[st];
    var ty = listEl.getAttribute("type");
    return (ty && TYPE_ATTR[ty]) || "decimal";
  }
  var BULLETS = ["•", "◦", "▪"];
  var GREEK = "\u03b1, \u03b2, \u03b3, ...";   // Word's name of the Greek letter format
  function lvlXml(ilvl, fmt, start) {
    var ind = 720 * (ilvl + 1);
    var numFmt = fmt === "greek"
      // Word 2010+ reads the custom format; older readers take the fallback
      ? "<mc:AlternateContent><mc:Choice Requires=\"w14\"><w:numFmt w:val=\"custom\" w:format=\"" + GREEK + "\"/></mc:Choice>" +
        "<mc:Fallback><w:numFmt w:val=\"lowerLetter\"/></mc:Fallback></mc:AlternateContent>"
      : "<w:numFmt w:val=\"" + fmt + "\"/>";
    var text = fmt === "bullet" ? BULLETS[ilvl % 3] : "%" + (ilvl + 1) + (fmt === "decimal" || fmt === "decimalZero" ? "." : ")");
    return "<w:lvl w:ilvl=\"" + ilvl + "\"><w:start w:val=\"" + (fmt === "bullet" ? 1 : start) + "\"/>" + numFmt +
      "<w:lvlText w:val=\"" + esc(text) + "\"/><w:lvlJc w:val=\"left\"/>" +
      "<w:pPr><w:ind w:left=\"" + ind + "\" w:hanging=\"360\"/></w:pPr>" +
      (fmt === "bullet" ? "<w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\"/></w:rPr>" : "") + "</w:lvl>";
  }
  function startOf(listEl) {
    var s = parseInt(listEl.getAttribute("start"), 10);
    return isFinite(s) && s >= 0 ? Math.min(s, 32767) : 1;
  }

  /* ----- the writer ----- */
  function Writer(o) {
    this.o = o || {};
    this.tcN = 0;
    this.lists = [];          // [{ levels: { ilvl: { fmt, start } } }] → numId = index + 1
    this.media = [];          // [{ name, bytes, ext }]
    this.rels = [];           // [{ id, type, target }]
    this.imgs = new Map();    // src → { rid, w, h } (filled by prepare)
    this.drawN = 0;
    var pg = this.o.page || { w: 210, h: 297 }, m = this.o.margins || {};
    this.colEmu = Math.max(EMU_MM * 20, (pg.w - (m.left || 0) - (m.right || 0)) * EMU_MM);
  }

  Writer.prototype.rel = function (type, target) {
    var id = "rId" + (this.rels.length + 1);
    this.rels.push({ id: id, type: type, target: target });
    return id;
  };

  // Every picture once, before the XML is written (reading is async)
  Writer.prototype.prepare = function (rootEl) {
    var self = this, of = this.o.imageOf || imageOf;
    var srcs = [];
    Array.prototype.forEach.call(rootEl.querySelectorAll("img"), function (im) {
      var s = im.getAttribute("src") || "";
      if (s && srcs.indexOf(s) === -1) srcs.push(s);
    });
    var chain = Promise.resolve();
    srcs.forEach(function (s) {
      chain = chain.then(function () { return Promise.resolve(of(s)).catch(function () { return null; }); })
        .then(function (r) {
          if (!r || !r.bytes || !r.bytes.length || !/^(png|jpeg|gif)$/.test(r.ext)) return;
          var name = "image" + (self.media.length + 1) + "." + (r.ext === "jpeg" ? "jpg" : r.ext);
          self.media.push({ name: name, bytes: r.bytes, ext: r.ext });
          self.imgs.set(s, { rid: self.rel(REL + "image", "media/" + name), w: r.w || 0, h: r.h || 0, name: name });
        });
    });
    return chain;
  };

  // shown size of a picture in px: its width / height (style or
  // attribute), else its natural size; never wider than the column
  function px(v) {
    var m = /^\s*([\d.]+)\s*(px)?\s*$/i.exec(String(v || ""));
    return m ? parseFloat(m[1]) : 0;
  }
  Writer.prototype.drawing = function (im, pr) {
    var info = this.imgs.get(im.getAttribute("src") || "");
    var alt = im.getAttribute("alt") || "";
    if (!info) return run(alt ? "[image: " + alt + "]" : "[image]", pr);
    var nw = info.w || 1, nh = info.h || 1;
    var w = px(im.style && im.style.width) || px(im.getAttribute("width"));
    var h = px(im.style && im.style.height) || px(im.getAttribute("height"));
    if (w && !h) h = w * nh / nw;
    else if (h && !w) w = h * nw / nh;
    else if (!w && !h) {
      var k = Math.min(1, MAX_IMG_PX / Math.max(nw, nh));
      w = nw * k; h = nh * k;
    }
    var cx = Math.max(1, Math.round(w * EMU_PX)), cy = Math.max(1, Math.round(h * EMU_PX));
    if (cx > this.colEmu) { cy = Math.round(cy * this.colEmu / cx); cx = Math.round(this.colEmu); }
    var n = ++this.drawN;
    return "<w:r><w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\">" +
      "<wp:extent cx=\"" + cx + "\" cy=\"" + cy + "\"/><wp:docPr id=\"" + n + "\" name=\"Picture " + n + "\" descr=\"" + esc(clean(alt)) + "\"/>" +
      "<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect=\"1\"/></wp:cNvGraphicFramePr>" +
      "<a:graphic><a:graphicData uri=\"" + NS.pic + "\"><pic:pic>" +
      "<pic:nvPicPr><pic:cNvPr id=\"" + n + "\" name=\"" + info.name + "\" descr=\"" + esc(clean(alt)) + "\"/><pic:cNvPicPr/></pic:nvPicPr>" +
      "<pic:blipFill><a:blip r:embed=\"" + info.rid + "\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>" +
      "<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"" + cx + "\" cy=\"" + cy + "\"/></a:xfrm>" +
      "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>" +
      "</wp:inline></w:drawing></w:r>";
  };

  var MAP = { STRONG: "b", B: "b", EM: "i", I: "i", U: "u", DEL: "strike", S: "strike", STRIKE: "strike", SUP: "sup" };
  Writer.prototype.runs = function (node, pr) {
    var self = this, out = "", T = this.o.track;
    Array.prototype.forEach.call(node.childNodes, function (ch) {
      if (ch.nodeType === 3) { out += run(ch.nodeValue.replace(/[\r\n\t]+/g, " "), pr); return; }
      if (ch.nodeType !== 1) return;
      // tracked change (wave 22) → <w:ins> / <w:del> around its runs
      if ((ch.nodeName === "INS" || ch.nodeName === "DEL") && ch.classList.contains("tc") && T && !pr.tc) {
        var kind = ch.nodeName === "DEL" ? "del" : "ins";
        out += T.docxOpen(kind, ++self.tcN, ch.getAttribute("data-au"), ch.getAttribute("data-ts")) +
          self.runs(ch, Object.assign({}, pr, { tc: true, del: kind === "del" })) + T.docxClose(kind);
        return;
      }
      if (ch.nodeName === "BR") { out += "<w:r><w:br/></w:r>"; return; }
      if (ch.nodeName === "IMG") { out += self.drawing(ch, pr); return; }
      var f = MAP[ch.nodeName];
      out += self.runs(ch, f ? Object.assign({}, pr, (function () { var o = {}; o[f] = true; return o; })()) : pr);
    });
    return out;
  };

  // one list (with the lists inside it) → paragraphs with w:numPr
  Writer.prototype.list = function (listEl) {
    var self = this, def = { levels: {} };
    this.lists.push(def);
    var id = this.lists.length, out = "";
    (function walk(el, ilvl) {
      if (ilvl > 8) ilvl = 8;
      if (!def.levels[ilvl]) def.levels[ilvl] = { fmt: listFormat(el), start: startOf(el) };
      Array.prototype.forEach.call(el.children, function (li) {
        if (li.nodeName !== "LI") return;
        var body = li.cloneNode(true), nested = [];
        Array.prototype.slice.call(body.children).forEach(function (c) { if (/^(UL|OL)$/.test(c.nodeName)) c.remove(); });
        Array.prototype.forEach.call(li.children, function (c) { if (/^(UL|OL)$/.test(c.nodeName)) nested.push(c); });
        out += para(self.runs(body, {}), { style: "ListParagraph", num: { id: id, ilvl: ilvl }, jc: jcOf(li) || jcOf(body.firstElementChild) });
        nested.forEach(function (c) { walk(c, ilvl + 1); });
      });
    })(listEl, 0);
    return out;
  };

  Writer.prototype.blocks = function (node) {
    var self = this, out = "";
    Array.prototype.forEach.call(node.childNodes, function (ch) {
      if (ch.nodeType === 3) {
        var txt = ch.nodeValue.trim();
        if (txt) out += para(run(txt, {}));
        return;
      }
      if (ch.nodeType !== 1) return;
      if (ch.classList && ch.classList.contains("page-break-marker")) { out += "<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>"; return; }
      if (ch.classList && ch.classList.contains("toc-inline")) return;
      var jc = jcOf(ch);
      switch (ch.nodeName) {
        case "H1": case "H2": case "H3": case "H4": case "H5": case "H6":
          out += para(self.runs(ch, {}), { style: "Heading" + Math.min(4, +ch.nodeName.charAt(1)), jc: jc }); break;
        case "P": out += para(self.runs(ch, {}), { jc: jc }); break;
        case "BLOCKQUOTE":
          if (ch.querySelector("p,h1,h2,h3,h4,ul,ol,table")) {
            Array.prototype.forEach.call(ch.children, function (c) {
              out += /^(UL|OL|TABLE)$/.test(c.nodeName) ? self.blocks({ childNodes: [c] }) : para(self.runs(c, {}), { style: "Quote", jc: jcOf(c) || jc });
            });
          } else out += para(self.runs(ch, {}), { style: "Quote", jc: jc });
          break;
        case "PRE":
          ch.textContent.split("\n").forEach(function (line) { out += para(run(line, {}), { style: "Code" }); });
          break;
        case "HR": out += para("", { border: true }); break;
        case "UL": case "OL": out += self.list(ch); break;
        case "TABLE": out += self.table(ch); break;
        case "FIGURE": {
          var cap = ch.querySelector("figcaption"), im = ch.querySelector("img");
          out += para(im ? self.drawing(im, {}) : self.runs(ch, {}), { jc: jc || "center" });
          if (cap) out += para(self.runs(cap, {}), { jc: jcOf(cap) || jc || "center", style: "Caption" });
          break;
        }
        case "IMG": out += para(self.drawing(ch, {}), { jc: jc }); break;
        default: out += self.blocks(ch);
      }
    });
    return out;
  };

  Writer.prototype.table = function (tbl) {
    var self = this;
    var rows = Array.prototype.slice.call(tbl.querySelectorAll("tr"));
    if (!rows.length) return "";
    var cols = rows.reduce(function (n, tr) { return Math.max(n, tr.children.length); }, 1);
    var out = "<w:tbl><w:tblPr><w:tblW w:w=\"5000\" w:type=\"pct\"/><w:tblBorders>" +
      ["top", "left", "bottom", "right", "insideH", "insideV"].map(function (s) {
        return "<w:" + s + " w:val=\"single\" w:sz=\"4\" w:color=\"auto\"/>";
      }).join("") + "</w:tblBorders></w:tblPr>" +
      "<w:tblGrid>" + new Array(cols + 1).join("<w:gridCol/>") + "</w:tblGrid>";
    rows.forEach(function (tr) {
      out += "<w:tr>";
      Array.prototype.forEach.call(tr.children, function (tc) {
        var inner = tc.querySelector("p,h1,h2,h3,h4,ul,ol") ? self.blocks(tc) : para(self.runs(tc, tc.nodeName === "TH" ? { b: true } : {}), { jc: jcOf(tc) });
        out += "<w:tc><w:tcPr><w:tcW w:w=\"0\" w:type=\"auto\"/></w:tcPr>" + (inner || "<w:p/>") + "</w:tc>";
      });
      out += "</w:tr>";
    });
    return out + "</w:tbl>";
  };

  Writer.prototype.numberingXml = function () {
    var abs = "", nums = "";
    this.lists.forEach(function (def, i) {
      var lv = "", last = { fmt: "bullet", start: 1 };
      for (var l = 0; l < 9; l++) {
        var d = def.levels[l] || { fmt: last.fmt === "bullet" ? "bullet" : "decimal", start: 1 };
        lv += lvlXml(l, d.fmt, d.start);
        last = d;
      }
      abs += "<w:abstractNum w:abstractNumId=\"" + i + "\"><w:multiLevelType w:val=\"hybridMultilevel\"/>" + lv + "</w:abstractNum>";
      nums += "<w:num w:numId=\"" + (i + 1) + "\"><w:abstractNumId w:val=\"" + i + "\"/></w:num>";
    });
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
      "<w:numbering xmlns:w=\"" + NS.w + "\" xmlns:mc=\"" + NS.mc + "\" xmlns:w14=\"" + NS.w14 + "\" mc:Ignorable=\"w14\">" +
      abs + nums + "</w:numbering>";
  };

  function heading(id, name, sz, lvl) {
    return "<w:style w:type=\"paragraph\" w:styleId=\"" + id + "\"><w:name w:val=\"" + name + "\"/>" +
      "<w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:qFormat/>" +
      "<w:pPr><w:keepNext/><w:spacing w:before=\"240\" w:after=\"120\"/><w:outlineLvl w:val=\"" + lvl + "\"/></w:pPr>" +
      "<w:rPr><w:b/><w:sz w:val=\"" + sz + "\"/></w:rPr></w:style>";
  }
  var STYLES = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
    "<w:styles xmlns:w=\"" + NS.w + "\">" +
    "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:cs=\"Calibri\"/>" +
    "<w:sz w:val=\"22\"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after=\"120\"/></w:pPr></w:pPrDefault></w:docDefaults>" +
    "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style>" +
    heading("Heading1", "heading 1", "40", 0) + heading("Heading2", "heading 2", "32", 1) +
    heading("Heading3", "heading 3", "27", 2) + heading("Heading4", "heading 4", "24", 3) +
    "<w:style w:type=\"paragraph\" w:styleId=\"Quote\"><w:name w:val=\"Quote\"/><w:basedOn w:val=\"Normal\"/>" +
    "<w:pPr><w:ind w:left=\"567\"/></w:pPr></w:style>" +
    "<w:style w:type=\"paragraph\" w:styleId=\"Code\"><w:name w:val=\"Code\"/><w:basedOn w:val=\"Normal\"/>" +
    "<w:pPr><w:spacing w:after=\"0\"/></w:pPr><w:rPr><w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/><w:sz w:val=\"20\"/></w:rPr></w:style>" +
    "<w:style w:type=\"paragraph\" w:styleId=\"ListParagraph\"><w:name w:val=\"List Paragraph\"/><w:basedOn w:val=\"Normal\"/>" +
    "<w:qFormat/><w:pPr><w:spacing w:after=\"40\"/><w:contextualSpacing/></w:pPr></w:style>" +
    "<w:style w:type=\"paragraph\" w:styleId=\"Caption\"><w:name w:val=\"caption\"/><w:basedOn w:val=\"Normal\"/>" +
    "<w:rPr><w:i/><w:sz w:val=\"18\"/></w:rPr></w:style>" +
    "</w:styles>";

  // The parts of the package, ready for a ZIP writer
  function build(rootEl, o) {
    o = o || {};
    var wr = new Writer(o);
    return wr.prepare(rootEl).then(function () {
      var body = wr.blocks(rootEl);
      if (o.appendix) body += "<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>" + o.appendix;
      var pg = o.page || { w: 210, h: 297 }, m = o.margins || { top: 25, right: 25, bottom: 25, left: 25 };
      var sectPr = "<w:sectPr><w:pgSz w:w=\"" + twips(pg.w) + "\" w:h=\"" + twips(pg.h) + "\"" +
        (pg.w > pg.h ? " w:orient=\"landscape\"" : "") + "/>" +
        "<w:pgMar w:top=\"" + twips(m.top) + "\" w:right=\"" + twips(m.right) + "\" w:bottom=\"" + twips(m.bottom) +
        "\" w:left=\"" + twips(m.left) + "\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/></w:sectPr>";

      var stylesRel = wr.rel(REL + "styles", "styles.xml");
      var numRel = wr.lists.length ? wr.rel(REL + "numbering", "numbering.xml") : "";
      void stylesRel; void numRel;
      var exts = {};
      wr.media.forEach(function (f) { exts[f.name.split(".").pop()] = f.ext; });

      var CT = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
        Object.keys(exts).map(function (e) { return "<Default Extension=\"" + e + "\" ContentType=\"image/" + exts[e] + "\"/>"; }).join("") +
        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
        "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>" +
        (wr.lists.length ? "<Override PartName=\"/word/numbering.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml\"/>" : "") +
        "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>" +
        "</Types>";
      var RELS = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
        "<Relationship Id=\"rId1\" Type=\"" + REL + "officeDocument\" Target=\"word/document.xml\"/>" +
        "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>" +
        "</Relationships>";
      var DOCRELS = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
        wr.rels.map(function (r) { return "<Relationship Id=\"" + r.id + "\" Type=\"" + r.type + "\" Target=\"" + r.target + "\"/>"; }).join("") +
        "</Relationships>";
      var CORE = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
        "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\"" +
        " xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\"" +
        " xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
        "<dc:title>" + esc(clean(o.title || "")) + "</dc:title>" +
        (o.author ? "<dc:creator>" + esc(clean(o.author)) + "</dc:creator>" : "") +
        (o.category ? "<dc:subject>" + esc(clean(o.category)) + "</dc:subject>" : "") +
        (o.tags && o.tags.length ? "<cp:keywords>" + esc(clean(o.tags.join(", "))) + "</cp:keywords>" : "") +
        "</cp:coreProperties>";
      var DOC = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
        "<w:document xmlns:w=\"" + NS.w + "\" xmlns:r=\"" + NS.r + "\" xmlns:wp=\"" + NS.wp + "\" xmlns:a=\"" + NS.a +
        "\" xmlns:pic=\"" + NS.pic + "\"><w:body>" + body + sectPr + "</w:body></w:document>";

      var enc = new TextEncoder();
      var files = [
        { name: "[Content_Types].xml", data: enc.encode(CT) },
        { name: "_rels/.rels", data: enc.encode(RELS) },
        { name: "docProps/core.xml", data: enc.encode(CORE) },
        { name: "word/_rels/document.xml.rels", data: enc.encode(DOCRELS) },
        { name: "word/styles.xml", data: enc.encode(STYLES) }
      ];
      if (wr.lists.length) files.push({ name: "word/numbering.xml", data: enc.encode(wr.numberingXml()) });
      wr.media.forEach(function (f) { files.push({ name: "word/media/" + f.name, data: f.bytes }); });
      files.push({ name: "word/document.xml", data: enc.encode(DOC) });
      return files;
    });
  }

  /* ----- pictures: src → { bytes, ext, w, h } (browser) ----- */
  function b64Bytes(b64) {
    var bin = atob(String(b64).replace(/\s+/g, "")), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  // PNG / JPEG / GIF data: URLs go in as they are; anything else is
  // redrawn as PNG (a picture from a site that does not allow it → null)
  function imageOf(src) {
    return new Promise(function (resolve) {
      src = String(src || "");
      if (!src || /^\s*(javascript|vbscript):/i.test(src) || typeof Image === "undefined") { resolve(null); return; }
      var im = new Image(), done = false;
      if (!/^data:/i.test(src)) im.crossOrigin = "anonymous";
      var fin = function (v) { if (!done) { done = true; clearTimeout(tm); resolve(v); } };
      var tm = setTimeout(function () { fin(null); }, 10000);
      im.onload = function () {
        var w = im.naturalWidth, h = im.naturalHeight;
        if (!w || !h) { fin(null); return; }
        var m = /^data:image\/(png|jpe?g|gif);base64,(.*)$/i.exec(src);
        if (m) {
          try { fin({ bytes: b64Bytes(m[2]), ext: /png/i.test(m[1]) ? "png" : /gif/i.test(m[1]) ? "gif" : "jpeg", w: w, h: h }); }
          catch (e) { fin(null); }
          return;
        }
        try {
          var k = Math.min(1, 2000 / Math.max(w, h));
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          var url = c.toDataURL("image/png");
          fin({ bytes: b64Bytes(url.slice(url.indexOf(",") + 1)), ext: "png", w: w, h: h });
        } catch (e) { fin(null); }    // tainted canvas
      };
      im.onerror = function () { fin(null); };
      im.src = src;
    });
  }

  var api = { build: build, run: run, para: para, listFormat: listFormat, imageOf: imageOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WriterDocxOut = api;
})(typeof window !== "undefined" ? window : this);
