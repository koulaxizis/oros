// ============================================================
// orOS Atelier — pptxout.js: save a design as PowerPoint (.pptx) (v1.0.0)
// Made so a design opens in Canva (Upload › a .pptx), PowerPoint,
// Keynote, Google Slides or LibreOffice with its text still editable.
// Pure (no DOM, Node-testable):
//   needs(doc) → { assets:[image names], raster:[item ids] }: what the
//     caller has to supply before build().
//   kindOf(it) → "text" | "shape" | "photo" | "line" | "raster" | "":
//     how one element goes out ("raster": drawn once as a picture by
//     the caller, so its look survives; "": left out).
//   build(doc, media, opts) → { bytes: Uint8Array, out: { native,
//     raster, missing } }. media: { "a:<image name>": Uint8Array,
//     "r:<item id>": { png: Uint8Array, pad: points } }.
// What maps natively: text boxes (one look per box like Atelier:
// font by name, size, bold, italic, underline, caps, colour,
// alignment, line height, letter spacing, shadow / lift as a shadow),
// shapes (rectangle, ellipse and rounded rectangle as PowerPoint's
// own, every other Atelier shape as an exact custom outline; colour,
// gradient, outline, dashes), photos (crop, flips, shape mask,
// transparency), lines with arrow heads or dots, the page background
// (colour, gradient or picture). As pictures: icons, curved text and
// text effects PowerPoint has no equal for, photos with filters or
// adjustments, video elements (their poster frame). Hidden elements,
// animations, page timing and sounds are left out.
// Sizes: 1 pt of the design = 12700 EMU; a design bigger than
// PowerPoint's 56 in slide limit (or smaller than 1 in) is scaled as
// a whole. Text is XML-escaped; nothing in the file runs code.
// Exposes window.AtelierPPTXOut (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var M, AX, FX, Z;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); AX = require("./ax.js");
    FX = require("../designkit/fx.js"); Z = require("./zip.js");
  } else {
    M = root.orosDK.model; AX = root.AtelierAX; FX = root.orosDK.fx; Z = root.AtelierZip;
  }

  var EMU = 12700;
  var MIN_PT = 72, MAX_PT = 4032;              // PowerPoint: 1 in .. 56 in
  var NATIVE_FX = ["none", "shadow", "lift"];
  var NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  var NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  var NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  var REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
  var XML = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

  // ---------- 1. Small helpers ----------
  function esc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function int(v) { return Math.round(v); }
  function hex(c) { return /^#[0-9a-f]{6}$/i.test(c || "") ? c.slice(1).toUpperCase() : "000000"; }
  function colour(c, op) {
    var a = op === undefined || op >= 100 ? "" : "<a:alpha val=\"" + int(Math.max(0, op) * 1000) + "\"/>";
    return "<a:srgbClr val=\"" + hex(c) + "\">" + a + "</a:srgbClr>";
  }
  function solid(c, op) { return "<a:solidFill>" + colour(c, op) + "</a:solidFill>"; }
  function opOf(it) { return it.op === undefined ? 100 : it.op; }
  // the image's drawn rect inside its frame (designkit/render.js imageRect)
  function imageRect(it) {
    var iw = it.iw || 1, ih = it.ih || 1;
    if (it.fit === "custom") return { x: it.ix, y: it.iy, w: iw * it.isc, h: ih * it.isc };
    var s = it.fit === "fit" ? Math.min(it.w / iw, it.h / ih) : Math.max(it.w / iw, it.h / ih);
    return { x: (it.w - iw * s) / 2, y: (it.h - ih * s) / 2, w: iw * s, h: ih * s };
  }

  // ---------- 2. What goes out how ----------
  function kindOf(it) {
    var ax = it && it.ax;
    if (!ax || it.hide) return "";
    if (ax.k === "text") {
      if (!ax.tx || !ax.tx.trim()) return "";
      return ax.cv || (ax.tfx && NATIVE_FX.indexOf(ax.tfx.type) < 0) ? "raster" : "text";
    }
    if (ax.k === "shape") return ax.fc || ax.g || (ax.sc && it.sw > 0) ? "shape" : "";
    if (ax.k === "line") return "line";
    if (ax.k === "icon" || ax.k === "table" || ax.k === "chart") return "raster";      // tables, charts: as pictures
    if (ax.k === "photo") {
      if (ax.vid) return "raster";
      if (!it.a) return "";
      return ax.adj || ax.flt ? "raster" : "photo";
    }
    return "";
  }
  function pageItems(doc, pg) {
    return doc.items.filter(function (it) { return it.pg === pg && it.ax && !it.hide && !it.ax.tg; }).sort(M.byZ);
  }
  function needs(doc) {
    var assets = {}, raster = [];
    M.pagesInOrder(doc).forEach(function (p) {
      pageItems(doc, p.id).forEach(function (it) {
        var k = kindOf(it);
        if (k === "photo") assets[it.a] = 1;
        else if (k === "raster") raster.push(it.id);
      });
    });
    return { assets: Object.keys(assets).sort(), raster: raster };
  }

  // ---------- 3. Geometry ----------
  // the design's scale into the slide (1 unless past PowerPoint's limits)
  function scaleOf(setup) {
    var big = Math.max(setup.w, setup.h), small = Math.min(setup.w, setup.h);
    if (big > MAX_PT) return MAX_PT / big;
    if (small < MIN_PT && big * MIN_PT / small <= MAX_PT) return MIN_PT / small;
    return 1;
  }
  function xfrm(k, x, y, w, h, rot, flh, flv) {
    var r = ((rot % 360) + 360) % 360, a = "";
    if (r) a += " rot=\"" + int(r * 60000) + "\"";
    if (flh) a += " flipH=\"1\"";
    if (flv) a += " flipV=\"1\"";
    return "<a:xfrm" + a + "><a:off x=\"" + int(x * k * EMU) + "\" y=\"" + int(y * k * EMU) + "\"/>" +
      "<a:ext cx=\"" + Math.max(1, int(w * k * EMU)) + "\" cy=\"" + Math.max(1, int(h * k * EMU)) + "\"/></a:xfrm>";
  }
  // a shape's outline: PowerPoint's own where it has one, else Atelier's
  // exact path as custom geometry (in the shape's box, EMU)
  function geom(shp, rd, w, h, k) {
    if (!shp || shp === "rect") return "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>";
    if (shp === "circle") return "<a:prstGeom prst=\"ellipse\"><a:avLst/></a:prstGeom>";
    var round = rd === undefined ? AX.RD_DEF : rd;
    if (shp === "rounded") {
      // Atelier: r = round% of half the short side; PowerPoint: adj/50000 of half the short side
      return "<a:prstGeom prst=\"roundRect\"><a:avLst><a:gd name=\"adj\" fmla=\"val " + int(round / 100 * 50000) + "\"/></a:avLst></a:prstGeom>";
    }
    var cmds = FX.shapePath(shp, Math.max(0.01, w), Math.max(0.01, h), { round: round });
    if (!cmds.length) return "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>";
    var pw = Math.max(1, int(w * k * EMU)), ph = Math.max(1, int(h * k * EMU));
    function P(x, y) { return "<a:pt x=\"" + int(x * k * EMU) + "\" y=\"" + int(y * k * EMU) + "\"/>"; }
    var d = cmds.map(function (c) {
      if (c[0] === "M") return "<a:moveTo>" + P(c[1], c[2]) + "</a:moveTo>";
      if (c[0] === "L") return "<a:lnTo>" + P(c[1], c[2]) + "</a:lnTo>";
      if (c[0] === "C") return "<a:cubicBezTo>" + P(c[1], c[2]) + P(c[3], c[4]) + P(c[5], c[6]) + "</a:cubicBezTo>";
      if (c[0] === "Q") return "<a:quadBezTo>" + P(c[1], c[2]) + P(c[3], c[4]) + "</a:quadBezTo>";
      if (c[0] === "Z") return "<a:close/>";
      return "";
    }).join("");
    return "<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l=\"0\" t=\"0\" r=\"r\" b=\"b\"/>" +
      "<a:pathLst><a:path w=\"" + pw + "\" h=\"" + ph + "\">" + d + "</a:path></a:pathLst></a:custGeom>";
  }
  function fillXml(ax, op) {
    if (ax.g) {
      var ang = (((ax.g.ang - 90) % 360) + 360) % 360;      // pptx.js reads ang + 90
      return "<a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\">" + colour(ax.g.a, op) + "</a:gs>" +
        "<a:gs pos=\"100000\">" + colour(ax.g.b, op) + "</a:gs></a:gsLst><a:lin ang=\"" + int(ang * 60000) + "\" scaled=\"0\"/></a:gradFill>";
    }
    if (ax.fc) return solid(ax.fc, op);
    return "<a:noFill/>";
  }
  function lineXml(c, sw, dash, op, k, extra) {
    if (!c || !(sw > 0)) return "<a:ln><a:noFill/></a:ln>";
    return "<a:ln w=\"" + Math.max(1, int(sw * k * EMU)) + "\" cap=\"rnd\">" + solid(c, op) +
      (dash ? "<a:prstDash val=\"dash\"/>" : "") + "<a:round/>" + (extra || "") + "</a:ln>";
  }

  // ---------- 4. Elements ----------
  function nv(tag, id, name, inner, descr) {
    return "<p:nv" + tag + "Pr><p:cNvPr id=\"" + id + "\" name=\"" + esc(name) + "\"" +
      (descr ? " descr=\"" + esc(descr) + "\"" : "") + "/>" + inner + "<p:nvPr/></p:nv" + tag + "Pr>";
  }
  function shapeXml(it, id, k) {
    var ax = it.ax, op = opOf(it);
    return "<p:sp>" + nv("Sp", id, "Shape " + id, "<p:cNvSpPr/>") + "<p:spPr>" +
      xfrm(k, it.x, it.y, it.w, it.h, it.rot) + geom(ax.shp, ax.rd, it.w, it.h, k) + fillXml(ax, op) +
      lineXml(ax.sc, it.sw, it.dash, op, k) + "</p:spPr></p:sp>";
  }
  var ALIGN = { l: "l", c: "ctr", r: "r", j: "just" };
  function textXml(it, id, k) {
    var ax = it.ax, size = (ax.size || AX.TEXT_DEF.size) * k, op = opOf(it);
    var lh = ax.lh || AX.TEXT_DEF.lh;                         // pptx.js reads lh = 120 × pct
    var greek = /[Ͱ-Ͽἀ-῿]/.test(ax.tx);
    var face = esc(AX.fontName(ax.font || AX.TEXT_DEF.font));
    var eff = "";
    if (ax.tfx && (ax.tfx.type === "shadow" || ax.tfx.type === "lift")) {
      var f = FX.normTextFx(ax.tfx), lift = f.type === "lift";
      var blur = lift ? size * (0.1 + f.blur / 100 * 0.3) : f.blur / 100 * size * 0.3;
      var dist = lift ? size * 0.06 : f.off / 100 * size * 0.2;
      var dir = lift ? 90 : ((f.dir % 360) + 360) % 360;
      var alpha = lift ? 15 + f.alpha * 0.4 : f.alpha;
      eff = "<a:effectLst><a:outerShdw blurRad=\"" + int(blur * EMU) + "\" dist=\"" + int(dist * EMU) + "\" dir=\"" + int(dir * 60000) +
        "\" algn=\"ctr\" rotWithShape=\"0\">" + colour(lift ? "#000000" : f.color, alpha) + "</a:outerShdw></a:effectLst>";
    }
    var rpr = "<a:rPr lang=\"" + (greek ? "el-GR" : "en-US") + "\" sz=\"" + Math.max(100, Math.min(400000, int(size * 100))) + "\"" +
      (ax.b ? " b=\"1\"" : " b=\"0\"") + (ax.i ? " i=\"1\"" : " i=\"0\"") + (ax.u ? " u=\"sng\"" : "") + (ax.caps ? " cap=\"all\"" : "") +
      (ax.tr ? " spc=\"" + int(ax.tr / 1000 * size * 100) + "\"" : "") + " dirty=\"0\">" +
      solid(ax.fc || "#000000", op) + eff + "<a:latin typeface=\"" + face + "\"/><a:ea typeface=\"" + face + "\"/><a:cs typeface=\"" + face + "\"/></a:rPr>";
    var ppr = "<a:pPr algn=\"" + (ALIGN[ax.al || "l"] || "l") + "\"><a:lnSpc><a:spcPct val=\"" + int(lh / 1.2 * 1000) + "\"/></a:lnSpc>" +
      "<a:spcBef><a:spcPts val=\"0\"/></a:spcBef><a:spcAft><a:spcPts val=\"0\"/></a:spcAft><a:buNone/></a:pPr>";
    var paras = ax.tx.split("\n").map(function (line) {
      return "<a:p>" + ppr + (line ? "<a:r>" + rpr + "<a:t>" + esc(line) + "</a:t></a:r>" : "") +
        "<a:endParaRPr" + rpr.slice(6, rpr.indexOf(">") ) + "/></a:p>";
    }).join("");
    return "<p:sp>" + nv("Sp", id, "Text " + id, "<p:cNvSpPr txBox=\"1\"/>") + "<p:spPr>" +
      xfrm(k, it.x, it.y, it.w, it.h, it.rot) + "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>" +
      "<p:txBody><a:bodyPr wrap=\"square\" lIns=\"0\" tIns=\"0\" rIns=\"0\" bIns=\"0\" rtlCol=\"0\" anchor=\"t\"><a:noAutofit/></a:bodyPr>" +
      "<a:lstStyle/>" + paras + "</p:txBody></p:sp>";
  }
  var HEAD = { arrow: "triangle", dot: "oval" };
  function lineItemXml(it, id, k) {
    var ax = it.ax, op = opOf(it);
    var x = Math.min(it.x, it.x + it.w), y = Math.min(it.y, it.y + it.h);
    var ends = (ax.as ? "<a:headEnd type=\"" + HEAD[ax.as] + "\" w=\"med\" len=\"med\"/>" : "") +
      (ax.ae ? "<a:tailEnd type=\"" + HEAD[ax.ae] + "\" w=\"med\" len=\"med\"/>" : "");
    return "<p:cxnSp>" + nv("CxnSp", id, "Line " + id, "<p:cNvCxnSpPr/>") + "<p:spPr>" +
      xfrm(k, x, y, Math.abs(it.w), Math.abs(it.h), 0, it.w < 0, it.h < 0) +
      "<a:prstGeom prst=\"line\"><a:avLst/></a:prstGeom>" + lineXml(ax.sc || "#000000", it.sw || 1, it.dash, op, k, ends) +
      "</p:spPr></p:cxnSp>";
  }
  function picXml(id, rid, box, k, o) {
    o = o || {};
    var src = "";
    if (o.crop) {
      var c = o.crop, a = "";
      ["l", "t", "r", "b"].forEach(function (s) { var v = int(c[s] * 100000); if (v) a += " " + s + "=\"" + v + "\""; });
      src = "<a:srcRect" + a + "/>";
    }
    return "<p:pic>" + nv("Pic", id, (o.name || "Picture " + id), "<p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr>", o.descr) +
      "<p:blipFill><a:blip r:embed=\"" + rid + "\">" + (o.op < 100 ? "<a:alphaModFix amt=\"" + int(o.op * 1000) + "\"/>" : "") + "</a:blip>" +
      src + "<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>" +
      xfrm(k, box.x, box.y, box.w, box.h, box.rot || 0, o.flh, o.flv) + (o.geom || "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>") +
      "</p:spPr></p:pic>";
  }
  function photoCrop(it) {
    var r = imageRect(it);
    if (!(r.w > 0 && r.h > 0)) return null;
    return { l: -r.x / r.w, t: -r.y / r.h, r: (r.x + r.w - it.w) / r.w, b: (r.y + r.h - it.h) / r.h };
  }

  // ---------- 5. Package parts ----------
  var THEME = XML + "<a:theme xmlns:a=\"" + NS_A + "\" name=\"orOS\"><a:themeElements>" +
    "<a:clrScheme name=\"orOS\"><a:dk1><a:srgbClr val=\"000000\"/></a:dk1><a:lt1><a:srgbClr val=\"FFFFFF\"/></a:lt1>" +
    "<a:dk2><a:srgbClr val=\"1F2937\"/></a:dk2><a:lt2><a:srgbClr val=\"F3F4F6\"/></a:lt2>" +
    "<a:accent1><a:srgbClr val=\"2563EB\"/></a:accent1><a:accent2><a:srgbClr val=\"DC2626\"/></a:accent2>" +
    "<a:accent3><a:srgbClr val=\"16A34A\"/></a:accent3><a:accent4><a:srgbClr val=\"D97706\"/></a:accent4>" +
    "<a:accent5><a:srgbClr val=\"7C3AED\"/></a:accent5><a:accent6><a:srgbClr val=\"0891B2\"/></a:accent6>" +
    "<a:hlink><a:srgbClr val=\"2563EB\"/></a:hlink><a:folHlink><a:srgbClr val=\"7C3AED\"/></a:folHlink></a:clrScheme>" +
    "<a:fontScheme name=\"orOS\"><a:majorFont><a:latin typeface=\"Noto Sans\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont>" +
    "<a:minorFont><a:latin typeface=\"Noto Sans\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont></a:fontScheme>" +
    "<a:fmtScheme name=\"orOS\"><a:fillStyleLst>" + "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>".repeat(3) + "</a:fillStyleLst>" +
    "<a:lnStyleLst>" + "<a:ln w=\"12700\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln>".repeat(3) + "</a:lnStyleLst>" +
    "<a:effectStyleLst>" + "<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3) + "</a:effectStyleLst>" +
    "<a:bgFillStyleLst>" + "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>".repeat(3) + "</a:bgFillStyleLst></a:fmtScheme>" +
    "</a:themeElements></a:theme>";
  var TREE0 = "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>" +
    "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>";
  var PNS = " xmlns:a=\"" + NS_A + "\" xmlns:r=\"" + NS_R + "\" xmlns:p=\"" + NS_P + "\"";
  var MASTER = XML + "<p:sldMaster" + PNS + "><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val=\"FFFFFF\"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>" +
    "<p:spTree>" + TREE0 + "</p:spTree></p:cSld>" +
    "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>" +
    "<p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst></p:sldMaster>";
  var LAYOUT = XML + "<p:sldLayout" + PNS + " type=\"blank\" preserve=\"1\"><p:cSld name=\"Blank\"><p:spTree>" + TREE0 + "</p:spTree></p:cSld>" +
    "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>";
  function rels(list) {
    return XML + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      list.map(function (r) { return "<Relationship Id=\"" + r[0] + "\" Type=\"" + REL + r[1] + "\" Target=\"" + esc(r[2]) + "\"/>"; }).join("") +
      "</Relationships>";
  }

  // ---------- 6. Build ----------
  function build(doc, media, opts) {
    media = media || {}; opts = opts || {};
    var setup = doc.setup, k = scaleOf(setup);
    var pages = M.pagesInOrder(doc);
    if (opts.pages) pages = pages.filter(function (p) { return opts.pages.indexOf(p.id) >= 0; });
    var out = { native: 0, raster: 0, missing: 0 };
    var files = [], mediaFiles = {}, mediaN = 0, hasPng = false, hasJpg = false;
    function mediaPath(key, bytes, ext) {
      if (!mediaFiles[key]) {
        mediaN++;
        mediaFiles[key] = "media/image" + mediaN + "." + ext;
        files.push({ name: "ppt/" + mediaFiles[key], data: bytes });
        if (ext === "png") hasPng = true; else hasJpg = true;
      }
      return "../" + mediaFiles[key];
    }
    var slides = pages.map(function (pg, si) {
      var rl = [["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]], nid = 2, bgXml = "", tree = "";
      function rid(target) {
        for (var i = 0; i < rl.length; i++) if (rl[i][2] === target) return rl[i][0];
        var r = "rId" + (rl.length + 1);
        rl.push([r, "image", target]);
        return r;
      }
      pageItems(doc, pg.id).forEach(function (it) {
        var kind = kindOf(it), ax = it.ax, id = nid++;
        if (!kind) return;
        if (ax.bg && ax.k === "shape" && kind === "shape") {
          bgXml = "<p:bg><p:bgPr>" + fillXml(ax, opOf(it)) + "<a:effectLst/></p:bgPr></p:bg>";
          out.native++;
          return;
        }
        if (kind === "raster") {
          var R = media["r:" + it.id];
          if (!R || !R.png) { out.missing++; return; }
          var pad = R.pad || 0;
          tree += picXml(id, rid(mediaPath("r:" + it.id, R.png, "png")),
            { x: it.x - pad, y: it.y - pad, w: it.w + 2 * pad, h: it.h + 2 * pad, rot: ax.k === "line" ? 0 : it.rot }, k,
            { name: "Picture " + id });
          out.raster++;
          return;
        }
        if (kind === "photo") {
          var bytes = media["a:" + it.a];
          if (!bytes) { out.missing++; return; }
          var ext = /\.png$/.test(it.a) ? "png" : "jpg";
          tree += picXml(id, rid(mediaPath("a:" + it.a, bytes, ext)), it, k, {
            crop: photoCrop(it), flh: ax.flh, flv: ax.flv, op: opOf(it), descr: it.nm,
            geom: ax.shp ? geom(ax.shp, ax.rd, it.w, it.h, k) : ""
          });
        } else if (kind === "text") tree += textXml(it, id, k);
        else if (kind === "shape") tree += shapeXml(it, id, k);
        else if (kind === "line") tree += lineItemXml(it, id, k);
        out.native++;
      });
      var name = "ppt/slides/slide" + (si + 1) + ".xml";
      files.push({ name: name, data: XML + "<p:sld" + PNS + "><p:cSld>" + bgXml + "<p:spTree>" + TREE0 + tree + "</p:spTree></p:cSld>" +
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>" });
      files.push({ name: "ppt/slides/_rels/slide" + (si + 1) + ".xml.rels", data: rels(rl) });
      return si + 1;
    });
    var cx = Math.max(914400, Math.min(51206400, int(setup.w * k * EMU)));
    var cy = Math.max(914400, Math.min(51206400, int(setup.h * k * EMU)));
    var presRels = [["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ["rId2", "theme", "theme/theme1.xml"],
      ["rId3", "presProps", "presProps.xml"], ["rId4", "viewProps", "viewProps.xml"], ["rId5", "tableStyles", "tableStyles.xml"]];
    slides.forEach(function (n) { presRels.push(["rId" + (5 + n), "slide", "slides/slide" + n + ".xml"]); });
    var pres = XML + "<p:presentation" + PNS + " saveSubsetFonts=\"1\">" +
      "<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>" +
      "<p:sldIdLst>" + slides.map(function (n) { return "<p:sldId id=\"" + (255 + n) + "\" r:id=\"rId" + (5 + n) + "\"/>"; }).join("") + "</p:sldIdLst>" +
      "<p:sldSz cx=\"" + cx + "\" cy=\"" + cy + "\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/><p:defaultTextStyle/></p:presentation>";
    var CT = "application/vnd.openxmlformats-officedocument.presentationml.";
    var types = XML + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
      "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
      "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
      (hasPng ? "<Default Extension=\"png\" ContentType=\"image/png\"/>" : "") +
      (hasJpg ? "<Default Extension=\"jpg\" ContentType=\"image/jpeg\"/>" : "") +
      "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"" + CT + "presentation.main+xml\"/>" +
      "<Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"" + CT + "slideMaster+xml\"/>" +
      "<Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"" + CT + "slideLayout+xml\"/>" +
      "<Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>" +
      "<Override PartName=\"/ppt/presProps.xml\" ContentType=\"" + CT + "presProps+xml\"/>" +
      "<Override PartName=\"/ppt/viewProps.xml\" ContentType=\"" + CT + "viewProps+xml\"/>" +
      "<Override PartName=\"/ppt/tableStyles.xml\" ContentType=\"" + CT + "tableStyles+xml\"/>" +
      slides.map(function (n) { return "<Override PartName=\"/ppt/slides/slide" + n + ".xml\" ContentType=\"" + CT + "slide+xml\"/>"; }).join("") +
      "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>" +
      "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>" +
      "</Types>";
    var core = XML + "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" " +
      "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
      "<dc:title>" + esc(doc.name || "") + "</dc:title><dc:creator>orOS Atelier</dc:creator></cp:coreProperties>";
    var app = XML + "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\">" +
      "<Application>orOS Atelier</Application><Slides>" + slides.length + "</Slides></Properties>";
    var head = [
      { name: "[Content_Types].xml", data: types },
      { name: "_rels/.rels", data: rels([["rId1", "officeDocument", "ppt/presentation.xml"],
        ["rId2", "metadata/core-properties", "docProps/core.xml"], ["rId3", "extended-properties", "docProps/app.xml"]])
        .replace(REL + "metadata/core-properties", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties") },
      { name: "docProps/core.xml", data: core },
      { name: "docProps/app.xml", data: app },
      { name: "ppt/presentation.xml", data: pres },
      { name: "ppt/_rels/presentation.xml.rels", data: rels(presRels) },
      { name: "ppt/presProps.xml", data: XML + "<p:presentationPr" + PNS + "/>" },
      { name: "ppt/viewProps.xml", data: XML + "<p:viewPr" + PNS + "/>" },
      { name: "ppt/tableStyles.xml", data: XML + "<a:tblStyleLst xmlns:a=\"" + NS_A + "\" def=\"{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}\"/>" },
      { name: "ppt/slideMasters/slideMaster1.xml", data: MASTER },
      { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "theme", "../theme/theme1.xml"]]) },
      { name: "ppt/slideLayouts/slideLayout1.xml", data: LAYOUT },
      { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]) },
      { name: "ppt/theme/theme1.xml", data: THEME }
    ];
    return { bytes: Z.write(head.concat(files)), out: out, scale: k };
  }

  var api = { needs: needs, kindOf: kindOf, build: build, scaleOf: scaleOf, EMU: EMU,
    MIME: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierPPTXOut = api;
})(typeof window !== "undefined" ? window : this);
