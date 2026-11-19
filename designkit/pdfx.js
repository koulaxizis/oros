// ============================================================
// orOS designkit — pdfx.js (v1.0.0, LY-PRO W1): a print PDF made by
// pdf.js (jsPDF) becomes PDF/X-4, with the vendored pdf-lib:
//   - OutputIntent GTS_PDFX with the print profile embedded
//     (DestOutputProfile, e.g. ISO Coated v2 = Coated FOGRA39);
//   - every RGB colour and picture tagged as sRGB (ICCBased): images
//     with /DeviceRGB get the sRGB profile as their colour space, and
//     each page's resources get /DefaultRGB, so the content stream's
//     rg / RG colours are device independent too (PDF/X-4 allows RGB
//     that is ICC based; the printer's RIP converts it);
//   - Info: GTS_PDFXVersion PDF/X-4, Trapped False, dates; XMP
//     metadata with pdfxid:GTS_PDFXVersion and the same values;
//     trailer /ID;
//   - checks: every page has a TrimBox (and a BleedBox inside its
//     MediaBox), no encryption, no fonts left unembedded.
// make(PDFLib, bytes, { icc, srgb, cond, info, title, now }) →
//   Promise<{ bytes, boxes: [{ trim, bleed, media }], problems: [] }>
// Pure (no DOM): Node tests run it. Exposes orosDK.pdfx / module.exports.
// ============================================================
(function (root) {
  "use strict";

  var FOGRA39 = { id: "FOGRA39", info: "Coated FOGRA39 (ISO 12647-2:2004)", file: "ISOcoated_v2_eci.icc", registry: "http://www.color.org" };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function pdfDate(d) {
    return "D:" + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }
  function isoDate(d) { return d.toISOString().replace(/\.\d{3}Z$/, "Z"); }
  function xmlEsc(s) { return String(s || "").replace(/[<>&"']/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]; }); }
  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, "utf8"));
  }
  function hex(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16); return s; }
  function uuid(rand) {
    var b = rand(16);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = hex(b);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function randBytes(n) {
    var b = new Uint8Array(n), c = root && root.crypto;
    if (c && c.getRandomValues) c.getRandomValues(b);
    else { try { require("crypto").randomFillSync(b); } catch (e) { for (var i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256); } }
    return b;
  }

  function xmp(o) {
    return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" ' +
      'xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">\n' +
      '<dc:format>application/pdf</dc:format>\n' +
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">' + xmlEsc(o.title) + '</rdf:li></rdf:Alt></dc:title>\n' +
      '<xmp:CreatorTool>' + xmlEsc(o.creator) + '</xmp:CreatorTool>\n' +
      '<xmp:CreateDate>' + o.date + '</xmp:CreateDate>\n<xmp:ModifyDate>' + o.date + '</xmp:ModifyDate>\n<xmp:MetadataDate>' + o.date + '</xmp:MetadataDate>\n' +
      '<pdf:Producer>' + xmlEsc(o.producer) + '</pdf:Producer>\n<pdf:Trapped>False</pdf:Trapped>\n' +
      '<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>\n' +
      '<xmpMM:DocumentID>uuid:' + o.docId + '</xmpMM:DocumentID>\n<xmpMM:InstanceID>uuid:' + o.instId + '</xmpMM:InstanceID>\n<xmpMM:RenditionClass>default</xmpMM:RenditionClass>\n<xmpMM:VersionID>1</xmpMM:VersionID>\n' +
      '</rdf:Description>\n</rdf:RDF>\n</x:xmpmeta>\n' + new Array(20).join("                                                  \n") + '<?xpacket end="w"?>';
  }

  function boxOf(page, P, name) {
    var v = page.node.get(P.PDFName.of(name));
    if (!v || !(v instanceof P.PDFArray) || v.size() !== 4) return null;
    return [0, 1, 2, 3].map(function (i) { var n = v.get(i); return n && typeof n.asNumber === "function" ? n.asNumber() : 0; });
  }

  // The text of a content stream (Flate decoded by pdf-lib), "" when
  // it cannot be read.
  function streamText(P, ctx, v) {
    var parts = [];
    function one(x) {
      if (x instanceof P.PDFRef) x = ctx.lookup(x);
      if (x instanceof P.PDFArray) { for (var i = 0; i < x.size(); i++) one(x.get(i)); return; }
      if (!x || !(x instanceof P.PDFStream)) return;
      try {
        var b = x instanceof P.PDFRawStream ? P.decodePDFRawStream(x).decode() : x.getContents();
        var s = "";
        for (var j = 0; j < b.length; j += 8192) s += String.fromCharCode.apply(null, b.subarray(j, j + 8192));
        parts.push(s);
      } catch (e) { parts.push(null); }
    }
    one(v);
    return parts.indexOf(null) !== -1 ? null : parts.join("\n");
  }
  // jsPDF lists its 14 standard fonts in every resource dictionary,
  // used or not; PDF/X needs every font embedded, so the ones no
  // content stream sets (Tf) go. A stream that cannot be read keeps
  // everything (then the check below reports the fonts).
  function pruneFonts(P, doc) {
    var ctx = doc.context, N = P.PDFName.of, used = {}, dicts = [], unreadable = false;
    function scan(text) {
      if (text === null) { unreadable = true; return; }
      var re = /\/([^\s\/\[\]()<>{}%]+)\s+[-+.\d]+\s+Tf\b/g, m;
      while ((m = re.exec(text))) used[m[1]] = 1;
    }
    function resOf(res) {
      if (res instanceof P.PDFRef) res = ctx.lookup(res);
      if (!res || typeof res.get !== "function") return;
      var f = res.get(N("Font"));
      if (f instanceof P.PDFRef) f = ctx.lookup(f);
      if (f && typeof f.keys === "function" && dicts.indexOf(f) === -1) dicts.push(f);
      var xo = res.get(N("XObject"));
      if (xo instanceof P.PDFRef) xo = ctx.lookup(xo);
      if (xo && typeof xo.keys === "function") xo.keys().forEach(function (k) {
        var st = ctx.lookup(xo.get(k));
        if (st && st.dict && st.dict.get(N("Subtype")) === N("Form")) { scan(streamText(P, ctx, st)); resOf(st.dict.get(N("Resources"))); }
      });
    }
    doc.getPages().forEach(function (pg) {
      scan(streamText(P, ctx, pg.node.get(N("Contents"))));
      resOf(pg.node.get(N("Resources")));
    });
    if (unreadable) return 0;
    var gone = 0, drop = [], keep = {};
    dicts.forEach(function (f) {
      f.keys().forEach(function (k) {
        var ref = f.get(k);
        if (used[k.asString().slice(1)]) { if (ref instanceof P.PDFRef) keep[ref.toString()] = 1; return; }
        f.delete(k);
        if (ref instanceof P.PDFRef) drop.push(ref);
        gone++;
      });
    });
    // an object another dictionary still names stays
    drop.forEach(function (ref) { if (!keep[ref.toString()]) ctx.delete(ref); });
    return gone;
  }

  function make(P, bytes, opts) {
    opts = opts || {};
    if (!opts.icc || !opts.srgb) return Promise.reject(new Error("profiles"));
    var N = P.PDFName.of;
    return P.PDFDocument.load(bytes, { updateMetadata: false }).then(function (doc) {
      var ctx = doc.context, problems = [];
      if (doc.isEncrypted) problems.push({ code: "encrypted" });
      var cond = opts.cond || FOGRA39;
      // the profiles
      var icc = ctx.flateStream(opts.icc, { N: 4 });
      var iccRef = ctx.register(icc);
      var srgb = ctx.flateStream(opts.srgb, { N: 3 });
      var srgbRef = ctx.register(srgb);
      var srgbCS = ctx.obj([N("ICCBased"), srgbRef]);
      var srgbCSRef = ctx.register(srgbCS);
      // OutputIntent
      var oi = ctx.obj({ Type: "OutputIntent", S: "GTS_PDFX", OutputConditionIdentifier: P.PDFString.of(cond.id), RegistryName: P.PDFString.of(cond.registry),
                         Info: P.PDFString.of(cond.info), OutputCondition: P.PDFString.of(cond.info) });
      oi.set(N("DestOutputProfile"), iccRef);
      doc.catalog.set(N("OutputIntents"), ctx.obj([ctx.register(oi)]));
      pruneFonts(P, doc);
      // pictures: DeviceRGB → sRGB; fonts must be embedded
      ctx.enumerateIndirectObjects().forEach(function (pair) {
        var obj = pair[1], dict = obj && obj.dict ? obj.dict : obj;
        if (!dict || typeof dict.get !== "function") return;
        var sub = dict.get(N("Subtype")), type = dict.get(N("Type"));
        if (sub === N("Image")) {
          var cs = dict.get(N("ColorSpace"));
          if (cs === N("DeviceRGB")) dict.set(N("ColorSpace"), srgbCSRef);
        }
        if (type === N("Font") && (sub === N("Type1") || sub === N("TrueType") || sub === N("Type0"))) {
          if (sub === N("Type1") && !dict.get(N("FontDescriptor"))) problems.push({ code: "fontNotEmbedded" });
        }
        if (type === N("FontDescriptor")) {
          if (!dict.get(N("FontFile")) && !dict.get(N("FontFile2")) && !dict.get(N("FontFile3"))) problems.push({ code: "fontNotEmbedded" });
        }
      });
      // pages: DefaultRGB, boxes
      var boxes = [];
      doc.getPages().forEach(function (pg, i) {
        var res = pg.node.Resources();
        if (!res) { res = ctx.obj({}); pg.node.set(N("Resources"), res); }
        var csd = res.get(N("ColorSpace"));
        if (csd && csd instanceof P.PDFRef) csd = ctx.lookup(csd);
        if (!csd || typeof csd.set !== "function") { csd = ctx.obj({}); res.set(N("ColorSpace"), csd); }
        csd.set(N("DefaultRGB"), srgbCSRef);
        var media = boxOf(pg, P, "MediaBox"), trim = boxOf(pg, P, "TrimBox"), bleed = boxOf(pg, P, "BleedBox");
        if (!trim) problems.push({ code: "noTrimBox", page: i + 1 });
        if (bleed && media && (bleed[0] < media[0] - 0.01 || bleed[1] < media[1] - 0.01 || bleed[2] > media[2] + 0.01 || bleed[3] > media[3] + 0.01)) problems.push({ code: "bleedOutside", page: i + 1 });
        boxes.push({ media: media, trim: trim, bleed: bleed || trim });
      });
      // Info + XMP
      var now = opts.now ? new Date(opts.now) : new Date();
      var title = String(opts.title || "Untitled").slice(0, 300), creator = "orOS Layout", producer = "orOS Layout (jsPDF + pdf-lib)";
      var info = ctx.obj({});
      info.set(N("Title"), P.PDFHexString.fromText(title));
      info.set(N("Creator"), P.PDFString.of(creator));
      info.set(N("Producer"), P.PDFString.of(producer));
      info.set(N("CreationDate"), P.PDFString.of(pdfDate(now)));
      info.set(N("ModDate"), P.PDFString.of(pdfDate(now)));
      info.set(N("Trapped"), N("False"));
      info.set(N("GTS_PDFXVersion"), P.PDFString.of("PDF/X-4"));
      ctx.trailerInfo.Info = ctx.register(info);
      // XMP is UTF-8 (a string would be written as Latin-1)
      var meta = ctx.stream(utf8(xmp({ title: title, creator: creator, producer: producer, date: isoDate(now), docId: uuid(randBytes), instId: uuid(randBytes) })),
                            { Type: "Metadata", Subtype: "XML" });
      doc.catalog.set(N("Metadata"), ctx.register(meta));
      var id = P.PDFHexString.of(hex(randBytes(16)));
      ctx.trailerInfo.ID = ctx.obj([id, id]);
      return doc.save({ useObjectStreams: false, updateFieldAppearances: false }).then(function (out) {
        return { bytes: out, boxes: boxes, problems: problems, intent: cond.info };
      });
    });
  }

  var api = { make: make, FOGRA39: FOGRA39 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.pdfx = api; }
})(typeof window !== "undefined" ? window : this);
