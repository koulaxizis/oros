// ============================================================
// orOS Assistant — doctext.js: the text of a document, read on the
// device (documents for every model, wave DOC1)
// ------------------------------------------------------------
// A document the user attaches (Word, LibreOffice, a spreadsheet, a
// slide deck, an e-book, RTF, HTML, a vCard, plain text…) is never
// sent as a file: no AI service reads these formats directly. orOS
// reads its text here and only that text goes out, like a PDF for a
// service that can't read PDFs (core.js attTextBlock).
//   · kindOf(name, type)     → the canonical MIME type orOS uses for
//                              that document, or "" (not a document)
//   · read(bytes, name, opt) → Promise<string> (rejects on a file it
//                              can't read)
// opt.sheets: () → Promise<SheetJS> (vendor/xlsx.full.min.js), only
// for spreadsheets and old .xls; opt.max: characters to stop at.
// Nothing in a document runs: XML and HTML are taken apart as text
// (no DOM, no scripts, no links followed), ZIP entries are read with
// the size caps of atelier/zip.js.
// Pure: no DOM. window.OrosDocText (browser) or module.exports (node).
// ============================================================
(function (root) {
  "use strict";

  // extension → MIME. One canonical type per extension, so a file
  // the browser typed differently (or not at all) is read the same.
  var EXT = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    docm: "application/vnd.ms-word.document.macroEnabled.12",
    dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
    doc: "application/msword",
    odt: "application/vnd.oasis.opendocument.text",
    ott: "application/vnd.oasis.opendocument.text-template",
    rtf: "application/rtf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odp: "application/vnd.oasis.opendocument.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
    xls: "application/vnd.ms-excel",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    epub: "application/epub+zip",
    txt: "text/plain", text: "text/plain", log: "text/plain", ini: "text/plain",
    md: "text/markdown", markdown: "text/markdown",
    csv: "text/csv", tsv: "text/tab-separated-values",
    json: "application/json", xml: "application/xml",
    yaml: "application/yaml", yml: "application/yaml",
    html: "text/html", htm: "text/html", xhtml: "text/html",
    vcf: "text/vcard", vcard: "text/vcard",
    ics: "text/calendar",
    eml: "message/rfc822",
    srt: "application/x-subrip", vtt: "text/vtt",
    tex: "application/x-tex"
  };
  // Other names browsers give the same formats.
  var ALIAS = {
    "application/x-rtf": "application/rtf", "text/rtf": "application/rtf",
    "text/x-markdown": "text/markdown", "text/x-vcard": "text/vcard", "text/directory": "text/vcard",
    "text/xml": "application/xml", "application/xhtml+xml": "text/html", "text/x-yaml": "application/yaml",
    "application/vnd.ms-word": "application/msword", "application/x-tex": "application/x-tex"
  };
  var TYPES = {};
  Object.keys(EXT).forEach(function (k) { TYPES[EXT[k]] = 1; });
  var MAX = 400000;                  // characters read at most (core.js cuts further)
  var SHEET_ROWS = 3000;             // rows per sheet

  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }
  function kindOf(name, type) {
    var e = extOf(name);
    if (e && EXT[e]) return EXT[e];
    var t = String(type || "").toLowerCase().split(";")[0].trim();
    if (ALIAS[t]) return ALIAS[t];
    return TYPES[t] ? t : "";
  }

  // ---------- text from bytes ----------
  function decoder(label) {
    try { return new TextDecoder(label); } catch (e) { return new TextDecoder("utf-8"); }
  }
  // UTF-8 / UTF-16 by their BOM; text that isn't valid UTF-8 is read
  // as Windows-1253 (Greek), which also covers plain Latin text.
  function decodeText(bytes, fallback) {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return decoder("utf-16le").decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decoder("utf-16be").decode(bytes.subarray(2));
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (e) { return decoder(fallback || "windows-1253").decode(bytes); }
  }
  var NAMED = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
                laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·",
                euro: "€", copy: "©", reg: "®", deg: "°", shy: "" };
  function entities(s) {
    return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, function (m, x) {
      if (x.charAt(0) === "#") {
        var n = x.charAt(1).toLowerCase() === "x" ? parseInt(x.slice(2), 16) : parseInt(x.slice(1), 10);
        return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : "";
      }
      var k = x.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : m;
    });
  }
  function tidy(s) {
    return String(s).replace(/\r\n?/g, "\n").replace(/[  ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  // XML → text: the caller first turns the format's paragraph, tab and
  // cell marks into \n / \t; every other tag goes, entities are decoded.
  function xmlText(x) {
    return entities(x.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, function (m, c) { return c.replace(/</g, "&lt;"); })
                     .replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, ""));
  }
  function htmlText(h) {
    h = String(h)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|head|template|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<\/(td|th)\s*>/gi, "\t")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/?(p|div|section|article|header|footer|h[1-6]|tr|table|ul|ol|li|blockquote|pre|dt|dd|hr|title)\b[^>]*>/gi, "\n");
    return tidy(xmlText(h).replace(/[ \t]*\t[ \t]*/g, "\t").replace(/[ ]{2,}/g, " "));
  }

  // ---------- Word (.docx), ODF, PowerPoint ----------
  function docxXml(x) {
    x = x.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "")          // the same text box twice
         .replace(/<w:delText\b[\s\S]*?<\/w:delText>/g, "")              // tracked deletions
         .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, "")          // field codes (FORMTEXT…)
         .replace(/<w:(tab|ptab)\b[^>]*\/>/g, "\t")
         .replace(/<w:(br|cr)\b[^>]*\/>/g, "\n")
         .replace(/<w14:checked w14:val="(1|true)"\s*\/>/g, "")
         .replace(/<w:checkBox\b[\s\S]*?<\/w:checkBox>/g, function (m) {
           return /<w:(checked|default)(\s+w:val="(1|true)")?\s*\/>/.test(m) && !/<w:checked w:val="(0|false)"/.test(m) ? "☒ " : "☐ ";
         })
         .replace(/<\/w:p>\s*(<w:sdtEndPr\/>\s*)?(<\/w:sdtContent>\s*<\/w:sdt>\s*)?<\/w:tc>/g, "</w:tc>")
         .replace(/<\/w:p>/g, "\n")
         .replace(/<\/w:tc>/g, "\t")
         .replace(/<\/w:tr>/g, "\n");
    return xmlText(x).replace(/\t+\n/g, "\n");
  }
  function odfXml(x) {
    var body = /<office:body\b[\s\S]*<\/office:body>/.exec(x);
    x = (body ? body[0] : x)
      .replace(/<text:tracked-changes\b[\s\S]*?<\/text:tracked-changes>/g, "")
      .replace(/<text:s\b[^>]*?text:c="(\d+)"[^>]*\/>/g, function (m, n) { return new Array(Math.min(+n, 40) + 1).join(" "); })
      .replace(/<text:s\b[^>]*\/>/g, " ")
      .replace(/<text:tab\b[^>]*\/>/g, "\t")
      .replace(/<text:line-break\b[^>]*\/>/g, "\n")
      .replace(/<\/text:(p|h)>\s*<\/table:table-cell>/g, "</table:table-cell>")
      .replace(/<\/text:(p|h)>/g, "\n")
      .replace(/<\/table:table-cell>/g, "\t")
      .replace(/<\/table:table-row>/g, "\n")
      .replace(/<draw:page\b[^>]*draw:name="([^"]*)"[^>]*>/g, "\n--- $1 ---\n");
    return xmlText(x).replace(/\t+\n/g, "\n");
  }
  function slideXml(x) {
    return xmlText(x.replace(/<a:br\b[^>]*\/>/g, "\n").replace(/<\/a:p>/g, "\n").replace(/<\/a:tc>/g, "\t").replace(/<\/a:tr>/g, "\n"));
  }
  function numIn(name) { var m = /(\d+)\.xml$/.exec(name); return m ? +m[1] : 0; }

  function zipOf(bytes) {
    var Z = root.AtelierZip;
    if (!Z && typeof require === "function") { try { Z = require("../atelier/zip.js"); } catch (e) {} }
    if (!Z) throw new Error("zip reader missing");
    return Z.open(bytes);
  }
  var PART = 30 * 1024 * 1024;       // inflated bytes per XML part

  function readDocx(z) {
    var parts = ["word/document.xml"];
    z.names.filter(function (n) { return /^word\/(header|footer)\d*\.xml$/.test(n); }).sort().forEach(function (n) { parts.push(n); });
    ["word/footnotes.xml", "word/endnotes.xml"].forEach(function (n) { if (z.has(n)) parts.push(n); });
    if (!z.has(parts[0])) return Promise.reject(new Error("not a Word document"));
    return Promise.all(parts.map(function (n) { return z.text(n, PART); })).then(function (xs) {
      var main = docxXml(xs[0] || ""), extra = [];
      for (var i = 1; i < xs.length; i++) {
        var tx = tidy(docxXml(xs[i] || ""));
        if (tx && main.indexOf(tx) < 0 && extra.indexOf(tx) < 0) extra.push(tx);
      }
      return main + (extra.length ? "\n\n" + extra.join("\n\n") : "");
    });
  }
  function readOdf(z) {
    if (!z.has("content.xml")) return Promise.reject(new Error("not an OpenDocument file"));
    return z.text("content.xml", PART).then(odfXml);
  }
  function readPptx(z) {
    var slides = z.names.filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
      .sort(function (a, b) { return numIn(a) - numIn(b); });
    if (!slides.length) return Promise.reject(new Error("no slides"));
    return Promise.all(slides.map(function (n) { return z.text(n, PART); })).then(function (xs) {
      return xs.map(function (x, i) { return "--- " + (i + 1) + " ---\n" + tidy(slideXml(x || "")); }).join("\n\n");
    });
  }
  function readEpub(z) {
    return z.text("META-INF/container.xml", PART).then(function (c) {
      var m = c && /full-path="([^"]+)"/.exec(c);
      if (!m) throw new Error("not an e-book");
      var opf = entities(m[1]), dir = opf.indexOf("/") >= 0 ? opf.replace(/[^\/]*$/, "") : "";
      return z.text(opf, PART).then(function (o) {
        if (!o) throw new Error("not an e-book");
        var hrefs = {};
        o.replace(/<item\b[^>]*>/g, function (tag) {
          var id = /\bid="([^"]+)"/.exec(tag), h = /\bhref="([^"]+)"/.exec(tag);
          if (id && h) hrefs[id[1]] = entities(h[1]);
          return "";
        });
        var order = [];
        o.replace(/<itemref\b[^>]*idref="([^"]+)"[^>]*>/g, function (t, id) { if (hrefs[id]) order.push(dir + decodeURIComponent(hrefs[id].split("#")[0])); return ""; });
        var out = [], used = 0;
        return order.reduce(function (p, n) {
          return p.then(function () {
            if (used > MAX) return;
            return z.text(n, PART).then(function (h) {
              var tx = h ? htmlText(h) : "";
              if (tx) { out.push(tx); used += tx.length; }
            }, function () {});
          });
        }, Promise.resolve()).then(function () { return out.join("\n\n"); });
      });
    });
  }

  // ---------- RTF ----------
  // Groups, control words, \'hh in the file's code page, \uN with its
  // \ucN fallback skipped. Destinations that are not text (fonts,
  // colours, styles, pictures, objects, \*\…) are left out.
  var RTF_SKIP = { fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, pict: 1, object: 1, themedata: 1, colorschememapping: 1,
                   datastore: 1, latentstyles: 1, listtable: 1, listoverridetable: 1, rsidtbl: 1, generator: 1, xmlnstbl: 1,
                   filetbl: 1, revtbl: 1, pgdsctbl: 1, header: 0, footer: 0, fldinst: 1, bkmkstart: 1, bkmkend: 1 };
  function readRtf(s) {
    var cp = /\\ansicpg(\d+)/.exec(s), dec = decoder(cp ? "windows-" + cp[1] : "windows-1252");
    var out = "", bytes = [], stack = [], skip = false, uc = 1, pendingSkip = 0, i = 0, n = s.length;
    function flush() { if (bytes.length) { out += dec.decode(new Uint8Array(bytes)); bytes = []; } }
    function put(str) { if (skip) return; if (pendingSkip > 0) { pendingSkip--; return; } flush(); out += str; }
    while (i < n) {
      var ch = s.charAt(i);
      if (ch === "{") { stack.push({ skip: skip, uc: uc }); i++; continue; }
      if (ch === "}") { flush(); var st = stack.pop(); if (st) { skip = st.skip; uc = st.uc; } i++; continue; }
      if (ch === "\\") {
        var nx = s.charAt(i + 1);
        if (nx === "'") {
          var hx = parseInt(s.substr(i + 2, 2), 16);
          i += 4;
          if (skip) continue;
          if (pendingSkip > 0) { pendingSkip--; continue; }
          if (!isNaN(hx)) bytes.push(hx);
          continue;
        }
        if (nx === "*") { skip = true; i += 2; continue; }
        if (/[a-z]/i.test(nx)) {
          var m = /^\\([a-z]{1,32})(-?\d{1,10})? ?/i.exec(s.slice(i, i + 48));
          var w = m[1], arg = m[2] !== undefined ? parseInt(m[2], 10) : null;
          i += m[0].length;
          if (RTF_SKIP[w]) { skip = true; continue; }
          if (w === "uc" && arg !== null) { uc = arg; continue; }
          if (w === "u" && arg !== null) { put(String.fromCharCode(arg < 0 ? arg + 65536 : arg)); if (!skip) pendingSkip = uc; continue; }
          if (w === "par" || w === "line" || w === "sect" || w === "page" || w === "row") { put("\n"); continue; }
          if (w === "tab" || w === "cell") { put("\t"); continue; }
          if (w === "emdash") { put("—"); continue; }
          if (w === "endash") { put("–"); continue; }
          if (w === "bullet") { put("•"); continue; }
          if (w === "lquote") { put("‘"); continue; }
          if (w === "rquote") { put("’"); continue; }
          if (w === "ldblquote") { put("“"); continue; }
          if (w === "rdblquote") { put("”"); continue; }
          continue;
        }
        if (nx === "\\" || nx === "{" || nx === "}") { put(nx); i += 2; continue; }
        if (nx === "~") { put(" "); i += 2; continue; }
        if (nx === "\n" || nx === "\r") { put("\n"); i += 2; continue; }
        i += 2;
        continue;
      }
      if (ch === "\r" || ch === "\n") { i++; continue; }
      if (skip) { i++; continue; }
      if (pendingSkip > 0) { pendingSkip--; i++; continue; }
      bytes.push(s.charCodeAt(i) & 0xff);
      i++;
    }
    flush();
    return out;
  }

  // ---------- Word 97-2003 (.doc) ----------
  // The text is the piece table in the Clx (FIB fcClx / lcbClx, in the
  // 0Table or 1Table stream): each piece is UTF-16LE or, when flagged
  // "compressed", 8-bit Windows-1252. Field codes (\x13 … \x14) go,
  // their results (\x14 … \x15) stay. Needs the compound-file reader
  // that SheetJS carries (XLSX.CFB).
  function cfbStream(cfb, CFB, name) {
    var e = CFB.find(cfb, name) || CFB.find(cfb, "/" + name) || CFB.find(cfb, "Root Entry/" + name);
    return e && e.content ? (e.content instanceof Uint8Array ? e.content : new Uint8Array(e.content)) : null;
  }
  function readDoc(bytes, X) {
    if (!X || !X.CFB) throw new Error("no compound-file reader");
    var cfb = X.CFB.read(bytes, { type: "array" });
    var wd = cfbStream(cfb, X.CFB, "WordDocument");
    if (!wd || wd.length < 0x01aa) throw new Error("not a Word document");
    var dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    if (dv.getUint16(0, true) !== 0xa5ec) throw new Error("not a Word document");
    var flags = dv.getUint16(0x0a, true);
    if (flags & 0x0100) throw new Error("encrypted");
    var tbl = cfbStream(cfb, X.CFB, (flags & 0x0200) ? "1Table" : "0Table");
    var fcClx = dv.getUint32(0x01a2, true), lcbClx = dv.getUint32(0x01a6, true);
    if (!tbl || !lcbClx || fcClx + lcbClx > tbl.length) throw new Error("no text table");
    var tv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength), p = fcClx, end = fcClx + lcbClx;
    while (p < end && tbl[p] === 0x01) p += 3 + tv.getUint16(p + 1, true);     // Prc blocks
    if (tbl[p] !== 0x02) throw new Error("no piece table");
    var lcb = tv.getUint32(p + 1, true), plc = p + 5, cnt = Math.floor((lcb - 4) / 12);
    if (cnt < 1 || plc + lcb > tbl.length) throw new Error("no piece table");
    var cp1252 = decoder("windows-1252"), u16 = decoder("utf-16le"), out = "";
    for (var k = 0; k < cnt && out.length < MAX; k++) {
      var cpA = tv.getUint32(plc + k * 4, true), cpB = tv.getUint32(plc + (k + 1) * 4, true);
      var fc = tv.getUint32(plc + (cnt + 1) * 4 + k * 8 + 2, true), len = cpB - cpA;
      if (len <= 0 || len > MAX) continue;
      if (fc & 0x40000000) {
        var o = (fc & 0x3fffffff) / 2;
        if (o + len <= wd.length) out += cp1252.decode(wd.subarray(o, o + len));
      } else if (fc + len * 2 <= wd.length) {
        out += u16.decode(wd.subarray(fc, fc + len * 2));
      }
    }
    // fields: drop each code part, keep the result
    var res = "", depth = 0, inCode = [];
    for (var j = 0; j < out.length; j++) {
      var c = out.charCodeAt(j);
      if (c === 0x13) { depth++; inCode[depth] = true; continue; }
      if (c === 0x14) { if (depth) inCode[depth] = false; continue; }
      if (c === 0x15) { if (depth) depth--; continue; }
      if (depth && inCode[depth]) continue;
      res += out.charAt(j);
    }
    return res.replace(/\x07\x07/g, "\n").replace(/\x07/g, "\t").replace(/[\r\x0b\x0c]/g, "\n").replace(/[\x01-\x08\x0e-\x1f]/g, "");
  }

  // ---------- Spreadsheets ----------
  function readSheets(bytes, X) {
    if (!X || typeof X.read !== "function") throw new Error("no spreadsheet reader");
    var wb = X.read(bytes, { type: "array", cellDates: true, cellHTML: false, cellFormula: false, bookVBA: false, sheetRows: SHEET_ROWS + 1 });
    var out = [];
    (wb.SheetNames || []).forEach(function (nm) {
      var ws = wb.Sheets[nm];
      if (!ws) return;
      var csv = X.utils.sheet_to_csv(ws, { blankrows: false, dateNF: "yyyy-mm-dd" }).replace(/,+$/gm, "").trim();
      if (csv) out.push((wb.SheetNames.length > 1 ? "## " + nm + "\n" : "") + csv);
    });
    return out.join("\n\n");
  }

  // ---------- read ----------
  var ZIPPED = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": readDocx,
    "application/vnd.ms-word.document.macroEnabled.12": readDocx,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template": readDocx,
    "application/vnd.oasis.opendocument.text": readOdf,
    "application/vnd.oasis.opendocument.text-template": readOdf,
    "application/vnd.oasis.opendocument.presentation": readOdf,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": readPptx,
    "application/epub+zip": readEpub
  };
  var SHEETS = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": 1,
    "application/vnd.ms-excel.sheet.macroEnabled.12": 1,
    "application/vnd.ms-excel": 1,
    "application/vnd.oasis.opendocument.spreadsheet": 1
  };
  function needsSheets(type) { return !!SHEETS[type] || type === "application/msword"; }

  function read(bytes, name, opt) {
    opt = opt || {};
    var max = opt.max > 0 ? Math.min(opt.max, MAX) : MAX;
    return Promise.resolve().then(function () {
      if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
      var type = kindOf(name, opt.type);
      if (!type) throw new Error("not a document");
      if (ZIPPED[type]) return ZIPPED[type](zipOf(bytes));
      if (needsSheets(type)) {
        if (typeof opt.sheets !== "function") throw new Error("no spreadsheet reader");
        return Promise.resolve(opt.sheets()).then(function (X) {
          return type === "application/msword" ? readDoc(bytes, X) : readSheets(bytes, X);
        });
      }
      if (type === "application/rtf") return readRtf(decoder("latin1").decode(bytes));
      var tx = decodeText(bytes);
      if (type === "text/html") return htmlText(tx);
      if (type === "message/rfc822") return mailText(tx);
      return tx;
    }).then(function (tx) {
      tx = tidy(tx);
      return tx.length > max ? tx.slice(0, max) : tx;
    });
  }
  // An e-mail: its headers that say who and when, then the text part
  // (or the HTML part as text). Attachments stay out.
  function mailText(s) {
    var cut = s.search(/\r?\n\r?\n/), head = cut >= 0 ? s.slice(0, cut) : s, body = cut >= 0 ? s.slice(cut).trim() : "";
    var keep = head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).filter(function (l) { return /^(from|to|cc|date|subject):/i.test(l); });
    var bnd = /boundary="?([^";\r\n]+)"?/i.exec(head);
    if (bnd) {
      var parts = body.split("--" + bnd[1]), txt = "", html = "";
      parts.forEach(function (p) {
        var c = p.search(/\r?\n\r?\n/);
        if (c < 0) return;
        var ph = p.slice(0, c), pb = p.slice(c).trim();
        if (/content-disposition:\s*attachment/i.test(ph)) return;
        if (/quoted-printable/i.test(ph)) pb = qp(pb);
        else if (/base64/i.test(ph)) { try { pb = decodeText(Uint8Array.from(atob(pb.replace(/\s+/g, "")), function (ch) { return ch.charCodeAt(0); }), "utf-8"); } catch (e) { pb = ""; } }
        if (/content-type:\s*text\/plain/i.test(ph) && !txt) txt = pb;
        else if (/content-type:\s*text\/html/i.test(ph) && !html) html = pb;
      });
      body = txt || (html ? htmlText(html) : "");
    } else if (/quoted-printable/i.test(head)) body = qp(body);
    return keep.join("\n") + "\n\n" + body;
  }
  function qp(s) {
    var bytes = [];
    s = s.replace(/=\r?\n/g, "");
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) === "=" && /^[0-9a-f]{2}$/i.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(s.charCodeAt(i) & 0xff);
    }
    return decodeText(new Uint8Array(bytes), "utf-8");
  }

  var api = { kindOf: kindOf, read: read, needsSheets: needsSheets, TYPES: Object.keys(TYPES), EXT: Object.keys(EXT),
              _rtf: readRtf, _html: htmlText, _docx: docxXml, _odf: odfXml };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosDocText = api;
})(typeof window !== "undefined" ? window : this);
