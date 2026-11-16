// ============================================================
// orOS Files — clean-core.js: remove hidden details before a file
// leaves (STRICT-4, v1.0.0). Pure: no DOM, no storage. Exposes
// window.orosClean (browser) or module.exports (Node tests).
//
// Every cleaner keeps the content exactly as it is and only drops the
// parts that say who made the file, where, when and with what:
//   JPEG  APP1 (EXIF, XMP), APP13 (IPTC), other APPn, COM. Kept: JFIF,
//         the colour profile (APP2 ICC), Adobe (APP14, CMYK needs it),
//         every image segment byte for byte. A turned photo keeps a
//         36-byte EXIF with only its orientation, so it is not shown
//         on its side.
//   PNG   tEXt, zTXt, iTXt, eXIf, tIME chunks.
//   WebP  EXIF and XMP chunks (VP8X flags and RIFF size follow).
//   PDF   Author, Creator, Producer, Subject, Keywords, dates, the XMP
//         stream; written again whole, so earlier saved versions inside
//         the file go too (pdf-lib, passed in). Title stays.
//   Word, Excel, PowerPoint (OOXML) and OpenDocument: the people,
//         dates, program, company, template, custom properties and the
//         Word editing-session ids (rsid). Comments and tracked changes
//         are reported, not removed: they are content the person sees
//         and must decide on in the program they write with.
// Results: { bytes, removed:[label], warn:[label] } — labels are keys
// the app translates (gps, camera, xmp, iptc, comment, text, time,
// people, dates, app, custom, rsid, history; warn: comments, tracked,
// annots). removed empty = nothing hidden was found (bytes unchanged).
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.0.0";

  function u16be(b, o) { return (b[o] << 8) | b[o + 1]; }
  function u32be(b, o) { return b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); }
  function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  function ascii(b, o, n) { var s = ""; for (var i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; }
  function concat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), p = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
    return out;
  }
  function add(list, label) { if (list.indexOf(label) === -1) list.push(label); }
  function bad() { return new Error("bad"); }

  // ---------- Kind ----------
  var OOXML = ["docx", "docm", "dotx", "xlsx", "xlsm", "pptx", "pptm"];
  var ODF = ["odt", "ods", "odp", "odg"];
  function extOf(name) { var m = /\.([a-z0-9]+)$/i.exec(String(name || "")); return m ? m[1].toLowerCase() : ""; }
  // name + the first bytes → "jpeg" | "png" | "webp" | "pdf" | "ooxml" | "odf" | ""
  function kindOf(name, b) {
    var ext = extOf(name);
    if (!b || b.length < 12) return "";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
    if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "png";
    if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
    if (ascii(b, 0, 5) === "%PDF-") return "pdf";
    if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) {
      if (OOXML.indexOf(ext) !== -1) return "ooxml";
      if (ODF.indexOf(ext) !== -1) return "odf";
    }
    return "";
  }
  // By name alone (the menu shows the action only for these).
  function canClean(name) {
    var ext = extOf(name);
    return ["jpg", "jpeg", "png", "webp", "pdf"].indexOf(ext) !== -1 || OOXML.indexOf(ext) !== -1 || ODF.indexOf(ext) !== -1;
  }
  // "Report.docx" → "Report (clean).docx"
  function cleanName(name) {
    name = String(name || "file");
    var dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) + " (clean)" + name.slice(dot) : name + " (clean)";
  }

  // ---------- EXIF (TIFF) ----------
  // → { orient: 1..8, gps: bool } from the TIFF block of an EXIF APP1.
  function tiffInfo(b, o, end) {
    var out = { orient: 1, gps: false, only: false };
    if (o + 8 > end) return out;
    var le = b[o] === 0x49 && b[o + 1] === 0x49;
    if (!le && !(b[o] === 0x4d && b[o + 1] === 0x4d)) return out;
    function r16(p) { return le ? (b[p] | (b[p + 1] << 8)) : u16be(b, p); }
    function r32(p) { return le ? u32le(b, p) : u32be(b, p); }
    var ifd = o + r32(o + 4);
    if (ifd + 2 > end) return out;
    var n = r16(ifd), others = 0;
    for (var i = 0; i < n && i < 500; i++) {
      var e = ifd + 2 + i * 12;
      if (e + 12 > end) break;
      var tag = r16(e);
      if (tag === 0x0112) { var v = r16(e + 8); if (v >= 1 && v <= 8) out.orient = v; }
      if (tag === 0x8825) out.gps = true;
      if (tag !== 0x0112) others++;
    }
    out.only = n === 1 && !others && r32(ifd + 14) === 0;   // orientation alone (our own)
    return out;
  }
  // A 36-byte APP1 that holds only the orientation (big-endian TIFF).
  function orientApp1(v) {
    var s = [0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0,   // "Exif\0\0"
      0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8,                            // MM, 42, IFD at 8
      0, 1,                                                      // one entry
      0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, v, 0, 0,                   // Orientation SHORT 1 = v
      0, 0, 0, 0];                                               // no next IFD
    return new Uint8Array(s);
  }

  // ---------- JPEG ----------
  function cleanJpeg(b) {
    var removed = [], parts = [b.subarray(0, 2)], p = 2, orient = 1;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xff) throw bad();
      var m = b[p + 1];
      if (m === 0xff) { p++; continue; }                    // fill byte
      if (m === 0xd9) { parts.push(b.subarray(p)); p = b.length; break; }
      if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { parts.push(b.subarray(p, p + 2)); p += 2; continue; }
      var len = u16be(b, p + 2);
      if (len < 2 || p + 2 + len > b.length) throw bad();
      var seg = b.subarray(p, p + 2 + len), keep = true, d = p + 4, dEnd = p + 2 + len;
      if (m === 0xda) { parts.push(b.subarray(p)); p = b.length; break; }   // image data to the end, as it is
      if (m === 0xe1) {
        keep = false;
        if (ascii(b, d, 6) === "Exif\u0000\u0000") {
          var ti = tiffInfo(b, d + 6, dEnd);
          if (ti.orient > 1) orient = ti.orient;
          if (!(ti.only && len === 34)) add(removed, "camera");   // ours: put back below if anything else goes
          if (ti.gps) add(removed, "gps");
        } else add(removed, "xmp");
      } else if (m === 0xed) { keep = false; add(removed, "iptc"); }
      else if (m === 0xfe) { keep = false; add(removed, "comment"); }
      else if (m === 0xe0) keep = ascii(b, d, 5) === "JFIF\u0000" || ascii(b, d, 5) === "JFXX\u0000";
      else if (m === 0xe2) keep = ascii(b, d, 12) === "ICC_PROFILE\u0000";
      else if (m === 0xee) keep = ascii(b, d, 5) === "Adobe";
      else if (m >= 0xe3 && m <= 0xef) keep = false;
      if (!keep && m >= 0xe0 && m <= 0xef && m !== 0xe1 && m !== 0xed) add(removed, "app");
      if (keep) parts.push(seg);
      p += 2 + len;
    }
    if (!removed.length) return { bytes: b, removed: [], warn: [] };
    if (orient > 1) parts.splice(1, 0, orientApp1(orient));
    return { bytes: concat(parts), removed: removed, warn: [] };
  }

  // ---------- PNG ----------
  var PNG_DROP = { tEXt: "text", zTXt: "text", iTXt: "text", eXIf: "camera", tIME: "time" };
  function cleanPng(b) {
    var removed = [], parts = [b.subarray(0, 8)], p = 8;
    while (p + 12 <= b.length) {
      var len = u32be(b, p), type = ascii(b, p + 4, 4), end = p + 12 + len;
      if (end > b.length) throw bad();
      if (PNG_DROP[type]) add(removed, PNG_DROP[type]);
      else parts.push(b.subarray(p, end));
      p = end;
      if (type === "IEND") break;
    }
    if (!removed.length) return { bytes: b, removed: [], warn: [] };
    if (p < b.length) parts.push(b.subarray(p));
    return { bytes: concat(parts), removed: removed, warn: [] };
  }

  // ---------- WebP ----------
  function cleanWebp(b) {
    var removed = [], parts = [], p = 12, vp8x = -1;
    while (p + 8 <= b.length) {
      var id = ascii(b, p, 4), len = u32le(b, p + 4), end = p + 8 + len + (len & 1);
      if (p + 8 + len > b.length) throw bad();
      end = Math.min(end, b.length);
      if (id === "EXIF") add(removed, "camera");
      else if (id === "XMP ") add(removed, "xmp");
      else { if (id === "VP8X") vp8x = parts.length; parts.push(b.slice(p, end)); }
      p = end;
    }
    if (!removed.length) return { bytes: b, removed: [], warn: [] };
    if (vp8x !== -1 && parts[vp8x].length > 8) parts[vp8x][8] &= ~0x0c;   // no EXIF / XMP flags
    var body = concat(parts), size = body.length + 4;
    var head = new Uint8Array([0x52, 0x49, 0x46, 0x46, size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255, 0x57, 0x45, 0x42, 0x50]);
    return { bytes: concat([head, body]), removed: removed, warn: [] };
  }

  // ---------- XML helpers (office files) ----------
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  // Drop every element <q:name …>…</q:name> or <q:name …/>; → [text, count]
  function dropEl(xml, qname) {
    var n = 0, q = esc(qname);
    var re = new RegExp("<" + q + "(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</" + q + "\\s*>)", "g");
    var out = xml.replace(re, function () { n++; return ""; });
    return [out, n];
  }
  function dropAll(xml, names) {
    var n = 0;
    names.forEach(function (q) { var r = dropEl(xml, q); xml = r[0]; n += r[1]; });
    return [xml, n];
  }

  // parts: { "docProps/core.xml": text, … } — only the XML parts that
  // matter (see officeNames). → { changes: { name: newText }, removed, warn }
  function officeNames(kind) {
    return kind === "odf" ? ["meta.xml", "content.xml", "settings.xml"]
      : ["docProps/core.xml", "docProps/app.xml", "docProps/custom.xml", "word/settings.xml", "word/document.xml"];
  }
  function cleanOffice(kind, parts, names) {
    var changes = {}, removed = [], warn = [];
    names = names || Object.keys(parts);
    function has(re) { return names.some(function (n) { return re.test(n); }); }
    if (kind === "ooxml") {
      var core = parts["docProps/core.xml"];
      if (typeof core === "string") {
        var a = dropAll(core, ["dc:creator", "cp:lastModifiedBy"]), b2 = dropAll(a[0], ["dcterms:created", "dcterms:modified", "cp:lastPrinted", "cp:revision"]);
        var c = dropAll(b2[0], ["dc:description", "cp:keywords", "cp:category", "cp:contentStatus"]);
        if (a[1]) add(removed, "people");
        if (b2[1]) add(removed, "dates");
        if (c[1]) add(removed, "text");
        if (a[1] + b2[1] + c[1]) changes["docProps/core.xml"] = c[0];
      }
      var app = parts["docProps/app.xml"];
      if (typeof app === "string") {
        var ap = dropAll(app, ["Company", "Manager", "Template", "TotalTime", "Application", "AppVersion", "HyperlinkBase"]);
        if (ap[1]) { add(removed, "app"); changes["docProps/app.xml"] = ap[0]; }
      }
      var cu = parts["docProps/custom.xml"];
      if (typeof cu === "string" && /<property[\s>]/.test(cu)) {
        var cr = dropEl(cu, "property");
        add(removed, "custom");
        changes["docProps/custom.xml"] = cr[0];
      }
      var ws = parts["word/settings.xml"];
      if (typeof ws === "string") {
        var wr = dropAll(ws, ["w:rsids", "w:attachedTemplate"]);
        if (wr[1]) { add(removed, "rsid"); changes["word/settings.xml"] = wr[0]; }
      }
      var doc = parts["word/document.xml"];
      if (typeof doc === "string") {
        var k = 0;
        var nd = doc.replace(/\sw:rsid[A-Za-z]*="[0-9A-Fa-f]*"/g, function () { k++; return ""; });
        if (k) { add(removed, "rsid"); changes["word/document.xml"] = nd; }
        if (/<w:(ins|del)[\s>/]/.test(doc)) add(warn, "tracked");
      }
      if (has(/^word\/comments[^/]*\.xml$/) || has(/^xl\/comments\d*\.xml$/) || has(/^xl\/threadedComments\//) ||
          has(/^ppt\/comments\//) || has(/^ppt\/commentAuthors\.xml$/)) add(warn, "comments");
    } else if (kind === "odf") {
      var meta = parts["meta.xml"];
      if (typeof meta === "string") {
        var p1 = dropAll(meta, ["meta:initial-creator", "dc:creator", "meta:printed-by"]);
        var p2 = dropAll(p1[0], ["meta:creation-date", "dc:date", "meta:print-date", "meta:editing-cycles", "meta:editing-duration"]);
        var p3 = dropAll(p2[0], ["meta:generator", "meta:template"]);
        var p4 = dropAll(p3[0], ["meta:user-defined", "meta:keyword", "dc:description"]);
        if (p1[1]) add(removed, "people");
        if (p2[1]) add(removed, "dates");
        if (p3[1]) add(removed, "app");
        if (p4[1]) add(removed, "custom");
        if (p1[1] + p2[1] + p3[1] + p4[1]) changes["meta.xml"] = p4[0];
      }
      var st = parts["settings.xml"];
      if (typeof st === "string") {
        var sk = 0;
        var ns = st.replace(/(<config:config-item\s+config:name="(?:PrinterName|PrinterSetup)"[^>]*>)[\s\S]*?(<\/config:config-item>)/g, function (m0, o, e) { sk++; return o + e; });
        if (sk) { add(removed, "app"); changes["settings.xml"] = ns; }
      }
      var ct = parts["content.xml"];
      if (typeof ct === "string") {
        if (/<office:annotation[\s>/]/.test(ct)) add(warn, "comments");
        if (/<text:tracked-changes[\s>/]/.test(ct)) add(warn, "tracked");
      }
    }
    return { changes: changes, removed: removed, warn: warn };
  }

  // ---------- PDF (pdf-lib passed in as lib) ----------
  var PDF_INFO = { Author: "people", Creator: "app", Producer: "app", Subject: "text", Keywords: "text", CreationDate: "dates", ModDate: "dates" };
  function countRevisions(b) {
    // %%EOF markers: more than one means saved versions are stacked inside.
    var n = 0;
    for (var i = 0; i + 5 <= b.length; i++) {
      if (b[i] === 0x25 && b[i + 1] === 0x25 && b[i + 2] === 0x45 && b[i + 3] === 0x4f && b[i + 4] === 0x46) n++;
    }
    return n;
  }
  function cleanPdf(b, lib) {
    if (!lib || !lib.PDFDocument) return Promise.reject(new Error("lib"));
    var N = lib.PDFName, removed = [], warn = [];
    return lib.PDFDocument.load(b, { updateMetadata: false }).then(function (doc) {
      var info = null;
      try { info = doc.getInfoDict(); } catch (e) { info = null; }
      if (info) {
        Object.keys(PDF_INFO).forEach(function (k) {
          if (info.has(N.of(k))) { info.delete(N.of(k)); add(removed, PDF_INFO[k]); }
        });
      }
      var cat = doc.catalog;
      if (cat.has(N.of("Metadata"))) { cat.delete(N.of("Metadata")); add(removed, "xmp"); }
      if (cat.has(N.of("PieceInfo"))) { cat.delete(N.of("PieceInfo")); add(removed, "app"); }
      if (countRevisions(b) > 1) add(removed, "history");
      var notes = { Text: 1, FreeText: 1, Popup: 1, Highlight: 1, Underline: 1, StrikeOut: 1, Squiggly: 1, Ink: 1, Caret: 1 };
      doc.getPages().some(function (pg) {
        var an = pg.node.Annots ? pg.node.Annots() : null;
        if (!an || typeof an.size !== "function") return false;
        for (var i = 0; i < an.size(); i++) {
          var d = an.lookup(i);
          var st = d && typeof d.get === "function" ? d.get(N.of("Subtype")) : null;
          var s = st && typeof st.asString === "function" ? st.asString().replace(/^\//, "") : String(st || "").replace(/^\//, "");
          if (notes[s]) { add(warn, "annots"); return true; }
        }
        return false;
      });
      if (!removed.length) return { bytes: b, removed: [], warn: warn };
      return doc.save({ updateFieldAppearances: false }).then(function (out) {
        return { bytes: out, removed: removed, warn: warn };
      });
    }, function (e) {
      throw new Error(/encrypt/i.test(String(e && e.message)) ? "encrypted" : "bad");
    });
  }

  // An office file (zip) end to end. deps: { Zip: AtelierZip, build:
  // files-core zipBuild, crc32, deflate(bytes) → Promise<Uint8Array>
  // (optional) }. Unchanged parts are copied byte for byte; every entry
  // gets the same neutral date (1980-01-01), since zip dates tell when
  // the file was last saved. ODF's "mimetype" stays first and stored.
  function cleanZip(kind, b, deps) {
    var z;
    try { z = deps.Zip.open(b); } catch (e) { return Promise.reject(bad()); }
    var names = z.names, want = officeNames(kind).filter(function (n) { return z.has(n); }), parts = {};
    return want.reduce(function (ch, n) {
      return ch.then(function () { return z.text(n); }).then(function (txt) { if (typeof txt === "string") parts[n] = txt; });
    }, Promise.resolve()).then(function () {
      var r = cleanOffice(kind, parts, names);
      if (!Object.keys(r.changes).length) return { bytes: b, removed: [], warn: r.warn };
      var enc = new TextEncoder(), entries = [], when = new Date(1980, 0, 1);
      return names.reduce(function (ch, n) {
        return ch.then(function () {
          return Object.prototype.hasOwnProperty.call(r.changes, n) ? enc.encode(r.changes[n]) : z.bytes(n);
        }).then(function (raw) {
          raw = raw || new Uint8Array(0);
          var crc = deps.crc32(raw);
          var squeeze = n !== "mimetype" && raw.length > 64 && typeof deps.deflate === "function"
            ? Promise.resolve(deps.deflate(raw)).catch(function () { return null; }) : Promise.resolve(null);
          return squeeze.then(function (def) {
            var use = !!(def && def.length < raw.length);
            entries.push({ name: n, size: raw.length, crc: crc, data: use ? def : raw, method: use ? 8 : 0, date: when });
          });
        });
      }, Promise.resolve()).then(function () {
        return { bytes: concat(deps.build(entries)), removed: r.removed, warn: r.warn };
      });
    });
  }

  // Images and the parts check, synchronously. → result or throws.
  function cleanImage(kind, b) {
    if (kind === "jpeg") return cleanJpeg(b);
    if (kind === "png") return cleanPng(b);
    if (kind === "webp") return cleanWebp(b);
    throw bad();
  }

  var api = {
    version: VERSION, extOf: extOf, kindOf: kindOf, canClean: canClean, cleanName: cleanName,
    cleanJpeg: cleanJpeg, cleanPng: cleanPng, cleanWebp: cleanWebp, cleanImage: cleanImage,
    officeNames: officeNames, cleanOffice: cleanOffice, cleanZip: cleanZip, cleanPdf: cleanPdf, tiffInfo: tiffInfo
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.orosClean = api;
})(typeof window !== "undefined" ? window : this);
