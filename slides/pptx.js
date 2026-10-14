// ============================================================
// orOS Slides — pptx.js: PowerPoint (.pptx) save and open (v1.1.0)
// Pure (no DOM besides DOMParser, no storage, no network). The ZIP
// reader / writer is Atelier's (atelier/zip.js, AtelierZip).
//
//   needs(data, deckId) → [asset ids]: the pictures write() needs.
//   charts(data, deckId, lang) → { key: spec }: the chart pictures
//     write() needs (dk.js chartSpec); the caller draws them and passes
//     each PNG as media[key].
//   write(data, deckId, media, opts) → { bytes: Uint8Array, out:
//     { slides, pictures, missing } }. media: { assetId: Uint8Array }.
//   read(zip, opts) → Promise<plan>: a neutral plan of the file
//     { as, title, th, slides:[{ ly, hid, tr, bg, n, items:[spec] }],
//       media:{ path:true }, count:{ skipped, approx, unknown } }.
//     opts.parseXml(text) → node tree (tests); default DOMParser.
//     opts.labels: { chart, table, diagram, media, object } texts of
//     the placeholder notes for what Slides cannot show.
//   build(plan, assets, now, newId) → { deck, slides, items, missing }:
//     a NEW deck (fresh ids, everything through core.js normalizers);
//     assets: { mediaPath: { id, w, h } } (designkit/assets.js).
//
// Saving: every slide with its text boxes (paragraphs, bullets,
// numbering and levels, bold / italic / underline, colour, size,
// alignment, vertical anchor, shrink to fit), pictures (the visible
// part as a crop of the stored picture, rounded corners, description),
// rectangles, rounded rectangles, ellipses, lines, opacity, rotation,
// the slide background, speaker notes, hidden slides, transitions
// (with their speed: fast / medium / slow), tables (a:tbl: header row,
// banded rows, lines, colours), charts (as their picture), groups
// (p:grpSp) and build animations (p:timing: Appear, Fly In with its
// direction, Fade, Zoom; on click / with / after the previous, delay,
// length, bullets one by one as paragraph builds), 16:9 / 4:3. Placeholders stay PowerPoint placeholders (title, body,
// subtitle, picture) on one slide layout per Slides layout; theme
// colours and theme fonts are written as the theme's own (schemeClr,
// +mj-lt / +mn-lt), so a file saved by Slides opens again with its
// theme roles intact. The deck footer is not written.
//
// Opening: slides, text boxes with paragraph and run formatting
// (inherited from the placeholder, the slide layout, the master and
// the theme like PowerPoint does), pictures (crop, rounded / round
// mask, transparency, description), rectangles, ellipses and lines,
// groups (one level: the outermost group of a slide's own objects),
// backgrounds (colour; a picture becomes a locked picture under
// everything), master / layout decoration, notes, slide size (other
// sizes fit into 16:9 or 4:3), hidden slides, transitions and their
// speed, tables (text, header row, banded rows, header colour, size;
// merged cells come apart), entrance animations (other entrance
// effects become Fade; exit, emphasis and motion paths are left out).
// Charts, SmartArt, video, audio and embedded objects become a dashed
// placeholder note with their name; other shapes become their nearest
// rectangle or ellipse.
// XML is parsed with DOMParser (no DTD, no entities: refused before
// parsing), external relationships are never followed, nothing in the
// file runs. Every value goes through core.js normalizers.
// Exposes OrosSlidesPPTX on its global (browser or a Node vm).
// ============================================================
(function (root) {
  "use strict";

  function C() { return root.OrosSlidesCore; }
  function D() { return root.OrosSlidesDK; }
  function Z() { return root.AtelierZip; }

  var EMU = 6858;                          // EMU per slide unit (1000 units = 7.5 in)
  var SLIDE_CY = 6858000;
  var SLIDE_CX = { "16:9": 12192000, "4:3": 9144000 };
  var MAX_XML = 16 * 1024 * 1024, MAX_NODES = 400000, MAX_MEDIA = 60 * 1024 * 1024;
  var NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  var NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  var NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  var REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
  var XML = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";
  var PNS = " xmlns:a=\"" + NS_A + "\" xmlns:r=\"" + NS_R + "\" xmlns:p=\"" + NS_P + "\"";
  var MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  // theme roles <-> PowerPoint colour slots
  var ROLE_CLR = { fg: "tx1", bg: "bg1", mu: "tx2", sf: "bg2", a1: "accent1", a2: "accent2", a3: "accent3" };
  var SLOT_ROLE = { dk1: "fg", lt1: "bg", dk2: "mu", lt2: "sf", accent1: "a1", accent2: "a2", accent3: "a3" };
  var FONT_NAME = { sans: "Noto Sans", serif: "Noto Serif", mono: "Noto Sans Mono" };
  // placeholders: role <-> PowerPoint ph type / idx
  var ROLE_PH = {
    title: { type: "title" }, sub: { type: "subTitle", idx: 1 }, body: { type: "body", idx: 2 },
    body2: { type: "body", idx: 3 }, cap: { type: "body", idx: 4 }, cap2: { type: "body", idx: 5 },
    quote: { type: "body", idx: 6 }, img: { type: "pic", idx: 7 }
  };
  var LAYOUT_TYPE = { title: "title", content: "obj", section: "secHead", two: "twoObj", compare: "twoTxTwoObj",
    imgtext: "picTx", photo: "cust", quote: "cust", blank: "blank" };
  var TRANS_OUT = { fade: "<p:fade/>", slide: "<p:cover dir=\"l\"/>", push: "<p:push dir=\"l\"/>", wipe: "<p:wipe/>", zoom: "<p:zoom/>" };
  // a transition's length as PowerPoint's three speeds
  function spdOf(td) { return !td ? "med" : td <= 350 ? "fast" : td >= 800 ? "slow" : "med"; }
  var SPD_MS = { fast: 300, slow: 1000 };
  // build animations <-> PowerPoint entrance presets
  var FX_PRESET = { appear: 1, fly: 2, fade: 10, zoom: 53 };
  var FLY_SUB = { t: 1, r: 2, b: 4, l: 8 };
  var NODE_W = { clickEffect: "c", withEffect: "w", afterEffect: "a" };

  // ---------- 1. Small helpers ----------
  function esc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function int(v) { return Math.round(v); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---------- 2. Writing ----------
  function colourXml(c, op) {
    var a = op === undefined || op >= 100 ? "" : "<a:alpha val=\"" + int(Math.max(0, op) * 1000) + "\"/>";
    if (typeof c === "string" && /^t:/.test(c) && ROLE_CLR[c.slice(2)]) return "<a:schemeClr val=\"" + ROLE_CLR[c.slice(2)] + "\">" + a + "</a:schemeClr>";
    var h = typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.slice(1).toUpperCase() : "000000";
    return "<a:srgbClr val=\"" + h + "\">" + a + "</a:srgbClr>";
  }
  function solid(c, op) { return "<a:solidFill>" + colourXml(c, op) + "</a:solidFill>"; }
  function xfrm(x, y, w, h, rot, flipV) {
    var r = ((int(rot || 0) % 360) + 360) % 360, a = "";
    if (r) a += " rot=\"" + r * 60000 + "\"";
    if (flipV) a += " flipV=\"1\"";
    return "<a:xfrm" + a + "><a:off x=\"" + int(x * EMU) + "\" y=\"" + int(y * EMU) + "\"/>" +
      "<a:ext cx=\"" + Math.max(0, int(w * EMU)) + "\" cy=\"" + Math.max(0, int(h * EMU)) + "\"/></a:xfrm>";
  }
  function prst(name, adj) {
    return "<a:prstGeom prst=\"" + name + "\"><a:avLst>" + (adj !== undefined ? "<a:gd name=\"adj\" fmla=\"val " + int(adj) + "\"/>" : "") + "</a:avLst></a:prstGeom>";
  }
  function radAdj(rad, w, h) { return clamp(rad / Math.max(1, Math.min(w, h) / 2) * 50000, 0, 50000); }
  function lnXml(it, op) {
    if (!it.st) return "<a:ln><a:noFill/></a:ln>";
    return "<a:ln w=\"" + Math.max(1, int(it.sw * EMU)) + "\">" + solid(it.st, op) + (it.dash ? "<a:prstDash val=\"dash\"/>" : "") + "</a:ln>";
  }
  function phXml(role) {
    var p = ROLE_PH[role];
    return p ? "<p:ph type=\"" + p.type + "\"" + (p.idx ? " idx=\"" + p.idx + "\"" : "") + "/>" : "";
  }
  function nv(tag, id, name, inner, ph, descr) {
    return "<p:nv" + tag + "Pr><p:cNvPr id=\"" + id + "\" name=\"" + esc(name) + "\"" + (descr ? " descr=\"" + esc(descr) + "\"" : "") + "/>" +
      inner + "<p:nvPr>" + (ph || "") + "</p:nvPr></p:nv" + tag + "Pr>";
  }
  var ALIGN_OUT = { l: "l", c: "ctr", r: "r", j: "just" };
  var VA_OUT = { t: "t", m: "ctr", b: "b" };
  function langOf(s) { return /[\u0370-\u03ff\u1f00-\u1fff]/.test(s) ? "el-GR" : "en-US"; }

  // A text item's paragraphs as DrawingML (sizes in points: 1 unit = 0.54 pt).
  function parasXml(it, theme) {
    var op = it.op === undefined ? 100 : it.op;
    var face = it.ff ? FONT_NAME[it.ff] : (it.ph === "title" || it.ph === "quote" ? "+mj-lt" : "+mn-lt");
    var fontXml = "<a:latin typeface=\"" + esc(face) + "\"/><a:ea typeface=\"" + esc(face) + "\"/><a:cs typeface=\"" + esc(face) + "\"/>";
    var forceB = it.ph === "title", forceI = it.ph === "quote";
    var paras = it.paras.length ? it.paras : [{ l: 0, ls: "", r: [] }];
    return paras.map(function (p) {
      var size = D().levelSize(it.fs, p.l) * 0.54;            // points
      var sz = clamp(int(size * 100), 100, 400000);
      var indent = "", bu = "<a:buNone/>";
      if (p.ls === "b" || p.ls === "n") {
        indent = " marL=\"" + int((p.l * 1.2 + 0.9) * size * 12700) + "\" indent=\"" + -int(0.9 * size * 12700) + "\"";
        bu = p.ls === "b" ? "<a:buFont typeface=\"Arial\"/><a:buChar char=\"\u2022\"/>" : "<a:buFont typeface=\"+mj-lt\"/><a:buAutoNum type=\"arabicPeriod\"/>";
      } else if (p.l) indent = " marL=\"" + int(p.l * 1.2 * size * 12700) + "\" indent=\"0\"";
      var ppr = "<a:pPr" + (p.l ? " lvl=\"" + p.l + "\"" : "") + indent + " algn=\"" + (ALIGN_OUT[it.al] || "l") + "\">" +
        "<a:spcBef><a:spcPts val=\"0\"/></a:spcBef><a:spcAft><a:spcPts val=\"" + int(size * 0.35 * 100) + "\"/></a:spcAft>" + bu + "</a:pPr>";
      var runs = p.r.map(function (r) {
        var b = r.b || forceB, i = r.i || forceI;
        return "<a:r><a:rPr lang=\"" + langOf(r.t) + "\" sz=\"" + sz + "\" b=\"" + (b ? 1 : 0) + "\" i=\"" + (i ? 1 : 0) + "\"" +
          (r.u ? " u=\"sng\"" : "") + " dirty=\"0\">" + solid(r.c || it.fc, op) + fontXml + "</a:rPr><a:t>" + esc(r.t) + "</a:t></a:r>";
      }).join("");
      return "<a:p>" + ppr + runs + "<a:endParaRPr lang=\"" + langOf(C().paraText(p)) + "\" sz=\"" + sz + "\" dirty=\"0\"/></a:p>";
    }).join("");
  }

  function textXml(it, id, ph, theme) {
    var op = it.op === undefined ? 100 : it.op;
    var fill = it.fill ? solid(it.fill, op) : "<a:noFill/>";
    var ins = int(D().INS * EMU);
    return "<p:sp>" + nv("Sp", id, (ph ? "Placeholder " : "Text ") + id, ph ? "<p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr>" : "<p:cNvSpPr txBox=\"1\"/>", ph) +
      "<p:spPr>" + xfrm(it.x, it.y, it.w, it.h, it.r) + prst("rect") + fill + lnXml(it, op) + "</p:spPr>" +
      "<p:txBody><a:bodyPr wrap=\"square\" lIns=\"" + ins + "\" tIns=\"" + ins + "\" rIns=\"" + ins + "\" bIns=\"" + ins + "\" rtlCol=\"0\" anchor=\"" + (VA_OUT[it.va] || "t") + "\">" +
      (it.fit === false ? "<a:noAutofit/>" : "<a:normAutofit/>") + "</a:bodyPr><a:lstStyle/>" + parasXml(it, theme) + "</p:txBody></p:sp>";
  }
  function shapeXml(it, id) {
    var op = it.op === undefined ? 100 : it.op;
    var geom = it.sh === "ellipse" ? prst("ellipse") : it.rad ? prst("roundRect", radAdj(it.rad, it.w, it.h)) : prst("rect");
    return "<p:sp>" + nv("Sp", id, "Shape " + id, "<p:cNvSpPr/>") + "<p:spPr>" + xfrm(it.x, it.y, it.w, it.h, it.r) + geom +
      (it.fill ? solid(it.fill, op) : "<a:noFill/>") + lnXml(it, op) + "</p:spPr></p:sp>";
  }
  function lineXml(it, id) {
    var op = it.op === undefined ? 100 : it.op, x = it.x, y = it.y, w = it.w, h = it.h, flip = !!it.flip;
    if (it.h <= 2) { y = it.y + it.h / 2; h = 0; flip = false; }
    else if (it.w <= 2) { x = it.x + it.w / 2; w = 0; flip = false; }
    return "<p:cxnSp>" + nv("CxnSp", id, "Line " + id, "<p:cNvCxnSpPr/>") + "<p:spPr>" + xfrm(x, y, w, h, it.r, flip) + prst("line") +
      "<a:ln w=\"" + Math.max(1, int((it.sw || 1) * EMU)) + "\" cap=\"rnd\">" + solid(it.st || "t:fg", op) + (it.dash ? "<a:prstDash val=\"dash\"/>" : "") +
      "<a:round/></a:ln></p:spPr></p:cxnSp>";
  }
  // The visible part of a picture: the frame ∩ the drawn picture,
  // as a box on the slide and a crop of the stored picture.
  function picGeom(it) {
    var g = D().imageGeom(it, it.w, it.h), W = it.img.pw * g.isc, H = it.img.ph * g.isc;
    var x0 = Math.max(0, g.ix), y0 = Math.max(0, g.iy), x1 = Math.min(it.w, g.ix + W), y1 = Math.min(it.h, g.iy + H);
    if (!(x1 > x0 && y1 > y0 && W > 0 && H > 0)) return null;
    // the visible box's centre, turned with the frame round the frame's centre
    var a = (it.r || 0) * Math.PI / 180, vx = (x0 + x1) / 2 - it.w / 2, vy = (y0 + y1) / 2 - it.h / 2;
    var cx = it.x + it.w / 2 + vx * Math.cos(a) - vy * Math.sin(a), cy = it.y + it.h / 2 + vx * Math.sin(a) + vy * Math.cos(a);
    return {
      x: cx - (x1 - x0) / 2, y: cy - (y1 - y0) / 2, w: x1 - x0, h: y1 - y0,
      crop: { l: (x0 - g.ix) / W, t: (y0 - g.iy) / H, r: (g.ix + W - x1) / W, b: (g.iy + H - y1) / H }
    };
  }
  function picXml(it, id, rid, ph) {
    var g = picGeom(it);
    if (!g) return "";
    var c = g.crop, a = "";
    ["l", "t", "r", "b"].forEach(function (s) { var v = int(c[s] * 100000); if (v > 0) a += " " + s + "=\"" + v + "\""; });
    var op = it.op === undefined ? 100 : it.op;
    var geom = it.rad ? prst("roundRect", radAdj(it.rad, g.w, g.h)) : prst("rect");
    return "<p:pic>" + nv("Pic", id, "Picture " + id, "<p:cNvPicPr><a:picLocks noGrp=\"1\" noChangeAspect=\"1\"/></p:cNvPicPr>", ph, it.img.alt) +
      "<p:blipFill><a:blip r:embed=\"" + rid + "\">" + (op < 100 ? "<a:alphaModFix amt=\"" + int(op * 1000) + "\"/>" : "") + "</a:blip>" +
      (a ? "<a:srcRect" + a + "/>" : "") + "<a:stretch><a:fillRect/></a:stretch></p:blipFill>" +
      "<p:spPr>" + xfrm(g.x, g.y, g.w, g.h, it.r) + geom + lnXml(it, op) + "</p:spPr></p:pic>";
  }
  function emptyPhXml(it, id, ph) {
    return "<p:sp>" + nv("Sp", id, "Placeholder " + id, "<p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr>", ph) +
      "<p:spPr>" + xfrm(it.x, it.y, it.w, it.h, it.r) + "</p:spPr>" +
      (it.k === "text" ? "<p:txBody><a:bodyPr anchor=\"" + (VA_OUT[it.va] || "t") + "\"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:endParaRPr lang=\"en-US\" dirty=\"0\"/></a:p></p:txBody>" : "") +
      "</p:sp>";
  }

  // A table as a DrawingML table (a:tbl in a graphic frame).
  function tableXml(it, id, theme) {
    var tb = it.tb, R = tb.rows.length, Cn = tb.rows[0].length, op = it.op === undefined ? 100 : it.op;
    var face = it.ff ? FONT_NAME[it.ff] : "+mn-lt";
    var sz = clamp(int(tb.fs * 0.54 * 100), 100, 400000);
    var headInk = D().inkOn(D().hexOf(tb.ac, theme) || "#2563eb");
    var mar = int(D().T_INS * EMU);
    function ln(tag, on) {
      return on && it.st ? "<a:" + tag + " w=\"" + Math.max(1, int(it.sw * EMU)) + "\">" + solid(it.st, op) + "</a:" + tag + ">"
        : "<a:" + tag + " w=\"0\"><a:noFill/></a:" + tag + ">";
    }
    var all = tb.ln === "all", hz = tb.ln !== "none";
    var grid = "", rowsXml = "";
    for (var c = 0; c < Cn; c++) grid += "<a:gridCol w=\"" + int(it.w * EMU / Cn) + "\"/>";
    tb.rows.forEach(function (row, r) {
      var head = tb.hd && r === 0;
      var fillC = head ? tb.ac : (tb.bd && (r - (tb.hd ? 1 : 0)) % 2 === 1 ? "t:sf" : it.fill || "");
      rowsXml += "<a:tr h=\"" + int(it.h * EMU / R) + "\">" + row.map(function (cell) {
        var paras = String(cell || "").split("\n").map(function (l) {
          var rpr = "<a:rPr lang=\"" + langOf(l) + "\" sz=\"" + sz + "\" b=\"" + (head ? 1 : 0) + "\" dirty=\"0\">" +
            solid(head ? headInk : it.fc || "t:fg", op) + "<a:latin typeface=\"" + esc(face) + "\"/></a:rPr>";
          return "<a:p>" + (l ? "<a:r>" + rpr + "<a:t>" + esc(l) + "</a:t></a:r>" : "<a:endParaRPr lang=\"en-US\" sz=\"" + sz + "\" dirty=\"0\"/>") + "</a:p>";
        }).join("");
        return "<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>" + paras + "</a:txBody>" +
          "<a:tcPr marL=\"" + mar + "\" marR=\"" + mar + "\" marT=\"" + mar + "\" marB=\"" + mar + "\" anchor=\"ctr\">" +
          ln("lnL", all) + ln("lnR", all) + ln("lnT", hz) + ln("lnB", hz) + (fillC ? solid(fillC, op) : "<a:noFill/>") + "</a:tcPr></a:tc>";
      }).join("") + "</a:tr>";
    });
    return "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"" + id + "\" name=\"Table " + id + "\"/>" +
      "<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp=\"1\"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>" +
      "<p:xfrm><a:off x=\"" + int(it.x * EMU) + "\" y=\"" + int(it.y * EMU) + "\"/><a:ext cx=\"" + int(it.w * EMU) + "\" cy=\"" + int(it.h * EMU) + "\"/></p:xfrm>" +
      "<a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/table\"><a:tbl>" +
      "<a:tblPr" + (tb.hd ? " firstRow=\"1\"" : "") + (tb.bd ? " bandRow=\"1\"" : "") + "/><a:tblGrid>" + grid + "</a:tblGrid>" + rowsXml +
      "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>";
  }
  // A chart goes out as its picture (the same one the slide shows).
  function chartPicXml(it, id, rid) {
    var op = it.op === undefined ? 100 : it.op;
    return "<p:pic>" + nv("Pic", id, "Chart " + id, "<p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr>", "", it.ch.ttl || "") +
      "<p:blipFill><a:blip r:embed=\"" + rid + "\">" + (op < 100 ? "<a:alphaModFix amt=\"" + int(op * 1000) + "\"/>" : "") + "</a:blip>" +
      "<a:stretch><a:fillRect/></a:stretch></p:blipFill>" +
      "<p:spPr>" + xfrm(it.x, it.y, it.w, it.h, 0) + prst("rect") + lnXml(it, op) + "</p:spPr></p:pic>";
  }
  function groupXml(id, list, inner) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (it) { x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y); x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h); });
    var o = "<a:off x=\"" + int(x0 * EMU) + "\" y=\"" + int(y0 * EMU) + "\"/>", e = "<a:ext cx=\"" + int((x1 - x0) * EMU) + "\" cy=\"" + int((y1 - y0) * EMU) + "\"/>";
    return "<p:grpSp><p:nvGrpSpPr><p:cNvPr id=\"" + id + "\" name=\"Group " + id + "\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>" +
      "<p:grpSpPr><a:xfrm>" + o + e + o.replace("a:off", "a:chOff") + e.replace("a:ext", "a:chExt") + "</a:xfrm></p:grpSpPr>" + inner + "</p:grpSp>";
  }

  // The build animations of a slide as PowerPoint timing: one outer
  // group per click (the first one starts with the slide when it is
  // "with / after the previous"), inner groups for "after the
  // previous", entrance presets Appear, Fly In, Fade and Zoom.
  // target(itemIds) -> [{ spid, text }] of what was written.
  function timingXml(data, slideId, target) {
    var Co = C(), effects = [];
    Co.animUnits(data, slideId).forEach(function (u) {
      var an = u.an, tg = target(u.ids);
      if (!tg.length) return;
      var it = u.ids.length === 1 ? data.items[u.ids[0]] : null, paras = [];
      if (an.p && it && it.k === "text" && tg.length === 1) it.paras.forEach(function (p, i) { if (Co.paraText(p).trim()) paras.push(i); });
      var base = { e: an.e, d: an.d || "b", du: an.e === "appear" ? 1 : (an.du || 500), dl: an.dl || 0 };
      if (paras.length) paras.forEach(function (pi, k) { effects.push(fx(base, tg[0], pi, k === 0 ? an.w || "c" : "c")); });
      else tg.forEach(function (x, k) { effects.push(fx(base, x, -1, k === 0 ? an.w || "c" : "w")); });
    });
    function fx(b, x, pi, w) { return { e: b.e, d: b.d, du: b.du, dl: b.dl, spid: x.spid, text: x.text, pi: pi, w: w }; }
    if (!effects.length) return "";
    var outers = [], cur = null, inner = null;
    effects.forEach(function (e) {
      if (e.w === "c" || !cur) {
        cur = { auto: e.w !== "c", inners: [] };
        outers.push(cur);
        inner = { start: 0, end: 0, list: [] };
        cur.inners.push(inner);
      } else if (e.w === "a") {
        inner = { start: inner.end, end: inner.end, list: [] };
        cur.inners.push(inner);
      }
      inner.list.push(e);
      inner.end = Math.max(inner.end, inner.start + e.dl + e.du);
    });
    var n = 2, bld = {};
    function tgt(e) {
      return "<p:tgtEl><p:spTgt spid=\"" + e.spid + "\">" + (e.pi >= 0 ? "<p:txEl><p:pRg st=\"" + e.pi + "\" end=\"" + e.pi + "\"/></p:txEl>" : "") + "</p:spTgt></p:tgtEl>";
    }
    function anim(e, attr, from, to) {
      return "<p:anim calcmode=\"lin\" valueType=\"num\"><p:cBhvr additive=\"base\"><p:cTn id=\"" + (++n) + "\" dur=\"" + e.du + "\" fill=\"hold\"/>" + tgt(e) +
        "<p:attrNameLst><p:attrName>" + attr + "</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst>" +
        "<p:tav tm=\"0\"><p:val><p:strVal val=\"" + from + "\"/></p:val></p:tav><p:tav tm=\"100000\"><p:val><p:strVal val=\"" + to + "\"/></p:val></p:tav></p:tavLst></p:anim>";
    }
    function effXml(e) {
      var id = ++n, sub = e.e === "fly" ? FLY_SUB[e.d] || 4 : e.e === "zoom" ? 16 : 0;
      var body = "<p:set><p:cBhvr><p:cTn id=\"" + (++n) + "\" dur=\"1\" fill=\"hold\"><p:stCondLst><p:cond delay=\"0\"/></p:stCondLst></p:cTn>" + tgt(e) +
        "<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val=\"visible\"/></p:to></p:set>";
      if (e.e === "fade" || e.e === "zoom") {
        if (e.e === "zoom") body += anim(e, "ppt_w", "0", "#ppt_w") + anim(e, "ppt_h", "0", "#ppt_h");
        body += "<p:animEffect transition=\"in\" filter=\"fade\"><p:cBhvr><p:cTn id=\"" + (++n) + "\" dur=\"" + e.du + "\"/>" + tgt(e) + "</p:cBhvr></p:animEffect>";
      } else if (e.e === "fly") {
        var X = "#ppt_x", Y = "#ppt_y";
        if (e.d === "l") X = "0-#ppt_w/2"; else if (e.d === "r") X = "1+#ppt_w/2";
        else if (e.d === "t") Y = "0-#ppt_h/2"; else Y = "1+#ppt_h/2";
        body += anim(e, "ppt_x", X, "#ppt_x") + anim(e, "ppt_y", Y, "#ppt_y");
      }
      if (e.text) bld[e.spid] = bld[e.spid] || e.pi >= 0;
      return "<p:par><p:cTn id=\"" + id + "\" presetID=\"" + FX_PRESET[e.e] + "\" presetClass=\"entr\" presetSubtype=\"" + sub + "\" fill=\"hold\"" +
        (e.text ? " grpId=\"0\"" : "") + " nodeType=\"" + (e.w === "c" ? "clickEffect" : e.w === "a" ? "afterEffect" : "withEffect") + "\">" +
        "<p:stCondLst><p:cond delay=\"" + e.dl + "\"/></p:stCondLst><p:childTnLst>" + body + "</p:childTnLst></p:cTn></p:par>";
    }
    var seq = outers.map(function (o) {
      var oid = ++n;
      var ins = o.inners.map(function (g) {
        var gid = ++n;
        return "<p:par><p:cTn id=\"" + gid + "\" fill=\"hold\"><p:stCondLst><p:cond delay=\"" + g.start + "\"/></p:stCondLst><p:childTnLst>" +
          g.list.map(effXml).join("") + "</p:childTnLst></p:cTn></p:par>";
      }).join("");
      return "<p:par><p:cTn id=\"" + oid + "\" fill=\"hold\"><p:stCondLst><p:cond delay=\"indefinite\"/>" +
        (o.auto ? "<p:cond evt=\"onBegin\" delay=\"0\"><p:tn val=\"2\"/></p:cond>" : "") + "</p:stCondLst><p:childTnLst>" + ins + "</p:childTnLst></p:cTn></p:par>";
    }).join("");
    var bl = Object.keys(bld).map(function (s) { return "<p:bldP spid=\"" + s + "\" grpId=\"0\"" + (bld[s] ? " build=\"p\"" : " animBg=\"1\"") + "/>"; }).join("");
    return "<p:timing><p:tnLst><p:par><p:cTn id=\"1\" dur=\"indefinite\" restart=\"never\" nodeType=\"tmRoot\"><p:childTnLst>" +
      "<p:seq concurrent=\"1\" nextAc=\"seek\"><p:cTn id=\"2\" dur=\"indefinite\" nodeType=\"mainSeq\"><p:childTnLst>" + seq + "</p:childTnLst></p:cTn>" +
      "<p:prevCondLst><p:cond evt=\"onPrev\" delay=\"0\"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>" +
      "<p:nextCondLst><p:cond evt=\"onNext\" delay=\"0\"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>" +
      "</p:childTnLst></p:cTn></p:par></p:tnLst>" + (bl ? "<p:bldLst>" + bl + "</p:bldLst>" : "") + "</p:timing>";
  }

  var TREE0 = "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>" +
    "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>";
  var CLRMAP = "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>";
  function hexv(h) { return String(h).slice(1).toUpperCase(); }
  function themeXml(theme, name) {
    var c = theme.c;
    function s(tag, h) { return "<a:" + tag + "><a:srgbClr val=\"" + hexv(h) + "\"/></a:" + tag + ">"; }
    return XML + "<a:theme xmlns:a=\"" + NS_A + "\" name=\"" + esc(name) + "\"><a:themeElements>" +
      "<a:clrScheme name=\"" + esc(name) + "\">" + s("dk1", c.fg) + s("lt1", c.bg) + s("dk2", c.mu) + s("lt2", c.sf) +
      s("accent1", c.a1) + s("accent2", c.a2) + s("accent3", c.a3) + s("accent4", "#7c3aed") + s("accent5", "#0891b2") + s("accent6", "#64748b") +
      s("hlink", c.a1) + s("folHlink", c.a2) + "</a:clrScheme>" +
      "<a:fontScheme name=\"" + esc(name) + "\"><a:majorFont><a:latin typeface=\"" + FONT_NAME[theme.tf] + "\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont>" +
      "<a:minorFont><a:latin typeface=\"" + FONT_NAME[theme.ff] + "\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont></a:fontScheme>" +
      "<a:fmtScheme name=\"" + esc(name) + "\"><a:fillStyleLst>" + "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>".repeat(3) + "</a:fillStyleLst>" +
      "<a:lnStyleLst>" + "<a:ln w=\"12700\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln>".repeat(3) + "</a:lnStyleLst>" +
      "<a:effectStyleLst>" + "<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3) + "</a:effectStyleLst>" +
      "<a:bgFillStyleLst>" + "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>".repeat(3) + "</a:bgFillStyleLst></a:fmtScheme>" +
      "</a:themeElements></a:theme>";
  }
  function rels(list) {
    return XML + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      list.map(function (r) { return "<Relationship Id=\"" + r[0] + "\" Type=\"" + (r[1].indexOf("http") === 0 ? r[1] : REL + r[1]) + "\" Target=\"" + esc(r[2]) + "\"/>"; }).join("") +
      "</Relationships>";
  }
  // The layout's placeholders (with the prompt texts) on its own part.
  function layoutXml(ly, as, prompts) {
    var tree = "", n = 2;
    ly.ph.forEach(function (ph) {
      var b = C().phBox(ph, as), id = n++, p = phXml(ph.role);
      if (ph.role === "img") {
        tree += "<p:sp>" + nv("Sp", id, "Picture Placeholder " + id, "<p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr>", p) +
          "<p:spPr>" + xfrm(b.x, b.y, b.w, b.h) + "</p:spPr></p:sp>";
        return;
      }
      var fs = C().ROLE_FS[ph.role] || 44;
      tree += "<p:sp>" + nv("Sp", id, "Placeholder " + id, "<p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr>", p) +
        "<p:spPr>" + xfrm(b.x, b.y, b.w, b.h) + "</p:spPr><p:txBody><a:bodyPr anchor=\"" + (VA_OUT[ph.va] || "t") + "\"><a:normAutofit/></a:bodyPr>" +
        "<a:lstStyle><a:lvl1pPr marL=\"0\" indent=\"0\" algn=\"" + (ALIGN_OUT[ph.al] || "l") + "\"><a:buNone/><a:defRPr sz=\"" + int(fs * 54) + "\"" +
        (ph.role === "title" ? " b=\"1\"" : "") + (ph.role === "quote" ? " i=\"1\"" : "") + ">" +
        solid(ph.role === "sub" || ph.role === "cap" || ph.role === "cap2" ? "t:mu" : "t:fg") +
        "<a:latin typeface=\"" + (ph.role === "title" || ph.role === "quote" ? "+mj-lt" : "+mn-lt") + "\"/></a:defRPr></a:lvl1pPr></a:lstStyle>" +
        "<a:p><a:r><a:rPr lang=\"en-US\" dirty=\"0\"/><a:t>" + esc(prompts[ph.role] || "") + "</a:t></a:r></a:p></p:txBody></p:sp>";
    });
    return XML + "<p:sldLayout" + PNS + " type=\"" + LAYOUT_TYPE[ly.id] + "\" preserve=\"1\"><p:cSld name=\"" + esc(ly.name.en) + "\"><p:spTree>" + TREE0 + tree + "</p:spTree></p:cSld>" +
      "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>";
  }

  function needs(data, deckId) {
    var ids = {};
    C().deckSlides(data, deckId).forEach(function (s) {
      C().slideItems(data, s.id).forEach(function (it) { if (it.k === "image" && it.img) ids[it.img.a] = 1; });
    });
    return Object.keys(ids).sort();
  }
  // The chart pictures write() needs: { key: spec } (dk.js chartSpec);
  // the caller draws each one (sheetkit) and passes its PNG as media[key].
  function charts(data, deckId, lang) {
    var out = {}, deck = data.decks[deckId];
    if (!deck) return out;
    var theme = C().themeById(deck.th);
    C().deckSlides(data, deckId).forEach(function (s) {
      C().slideItems(data, s.id).forEach(function (it) {
        if (it.k !== "chart") return;
        var spec = D().chartSpec(it, theme, s.bg, lang);
        out[D().chartKey(spec)] = spec;
      });
    });
    return out;
  }

  function write(data, deckId, media, opts) {
    var Co = C();
    media = media || {}; opts = opts || {};
    var deck = data.decks[deckId];
    if (!deck) throw new Error("deck");
    var theme = Co.themeById(deck.th), prompts = opts.prompts || {};
    var out = { slides: 0, pictures: 0, missing: 0 };
    var files = [], mediaPath = {}, mediaN = 0, notesN = 0;
    var LYS = Co.LAYOUTS;
    var lyIndex = {};
    LYS.forEach(function (l, i) { lyIndex[l.id] = i + 1; });
    var slideList = Co.deckSlides(data, deckId);
    var notesOf = {};
    slideList.forEach(function (s, si) {
      var n = si + 1, ly = Co.layoutById(s.ly) || Co.layoutById("blank");
      var roles = {};
      ly.ph.forEach(function (p) { roles[p.role] = 1; });
      var rl = [["rId1", "slideLayout", "../slideLayouts/slideLayout" + lyIndex[ly.id] + ".xml"]];
      function rid(key, bytes) {
        if (!mediaPath[key]) {
          mediaN++;
          mediaPath[key] = "media/image" + mediaN + (/\.png$/.test(key) ? ".png" : ".jpg");
          files.push({ name: "ppt/" + mediaPath[key], data: bytes });
        }
        var target = "../" + mediaPath[key];
        for (var i = 0; i < rl.length; i++) if (rl[i][2] === target) return rl[i][0];
        var r = "rId" + (rl.length + 1);
        rl.push([r, "image", target]);
        return r;
      }
      var nid = 2, used = {}, parts = [], spidOf = {}, textSp = {}, grpSp = {};
      Co.slideItems(data, s.id).forEach(function (it) {
        var id = nid++, xml = "";
        // a placeholder the layout does not have (or a second one) goes out as a free object
        var ph = it.ph && roles[it.ph] && !used[it.ph] ? phXml(it.ph) : "";
        if (ph) used[it.ph] = 1;
        if (Co.isEmptyPlaceholder(it)) { if (ph) xml = emptyPhXml(it, id, ph); }
        else if (it.k === "text") { xml = textXml(it, id, ph, theme); textSp[id] = 1; }
        else if (it.k === "shape") xml = shapeXml(it, id);
        else if (it.k === "line") xml = lineXml(it, id);
        else if (it.k === "table") xml = tableXml(it, id, theme);
        else if (it.k === "chart") {
          var key = D().chartKey(D().chartSpec(it, theme, s.bg, opts.lang));
          if (!media[key]) out.missing++;
          else { xml = chartPicXml(it, id, rid(key, media[key])); out.pictures++; }
        } else if (it.k === "image") {
          var bytes = media[it.img.a];
          if (!bytes) { out.missing++; if (ph) xml = emptyPhXml(it, id, ph); }
          else { xml = picXml(it, id, rid(it.img.a, bytes), ph); if (xml) out.pictures++; }
        }
        if (!xml) return;
        spidOf[it.id] = id;
        // placeholders stay out of groups (PowerPoint keeps them loose)
        parts.push({ it: it, xml: xml, g: it.g && !ph ? it.g : "" });
      });
      // a group (two or more written members) goes out where its lowest member is
      var members = {};
      parts.forEach(function (p) { if (p.g) (members[p.g] = members[p.g] || []).push(p); });
      var tree = "", done = {};
      parts.forEach(function (p) {
        var list = p.g && members[p.g].length > 1 ? members[p.g] : null;
        if (!list) { tree += p.xml; return; }
        if (done[p.g]) return;
        done[p.g] = 1;
        grpSp[p.g] = nid++;
        tree += groupXml(grpSp[p.g], list.map(function (q) { return q.it; }), list.map(function (q) { return q.xml; }).join(""));
      });
      var timing = timingXml(data, s.id, function (ids) {
        var g = ids.length > 1 && data.items[ids[0]].g;
        if (g && grpSp[g]) return [{ spid: grpSp[g], text: false }];
        return ids.filter(function (id) { return spidOf[id]; }).map(function (id) { return { spid: spidOf[id], text: !!textSp[spidOf[id]] }; });
      });
      var bg = s.bg ? "<p:bg><p:bgPr>" + solid(s.bg) + "<a:effectLst/></p:bgPr></p:bg>" : "";
      if (s.n) {
        notesN++;
        notesOf[n] = notesN;
        rl.push(["rId" + (rl.length + 1), "notesSlide", "../notesSlides/notesSlide" + notesN + ".xml"]);
        var np = s.n.split("\n").map(function (l) {
          return "<a:p>" + (l ? "<a:r><a:rPr lang=\"" + langOf(l) + "\" dirty=\"0\"/><a:t>" + esc(l) + "</a:t></a:r>" : "<a:endParaRPr lang=\"en-US\" dirty=\"0\"/>") + "</a:p>";
        }).join("");
        files.push({ name: "ppt/notesSlides/notesSlide" + notesN + ".xml", data: XML + "<p:notes" + PNS + "><p:cSld><p:spTree>" + TREE0 +
          "<p:sp>" + nv("Sp", 2, "Slide Image 1", "<p:cNvSpPr><a:spLocks noGrp=\"1\" noRot=\"1\" noChangeAspect=\"1\"/></p:cNvSpPr>", "<p:ph type=\"sldImg\"/>") + "<p:spPr/></p:sp>" +
          "<p:sp>" + nv("Sp", 3, "Notes Placeholder 2", "<p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr>", "<p:ph type=\"body\" idx=\"1\"/>") + "<p:spPr/>" +
          "<p:txBody><a:bodyPr/><a:lstStyle/>" + np + "</p:txBody></p:sp>" +
          "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>" });
        files.push({ name: "ppt/notesSlides/_rels/notesSlide" + notesN + ".xml.rels", data: rels([
          ["rId1", "notesMaster", "../notesMasters/notesMaster1.xml"], ["rId2", "slide", "../slides/slide" + n + ".xml"]]) });
      }
      var tr = TRANS_OUT[s.tr] ? "<p:transition spd=\"" + spdOf(s.td) + "\">" + TRANS_OUT[s.tr] + "</p:transition>" : "";
      files.push({ name: "ppt/slides/slide" + n + ".xml", data: XML + "<p:sld" + PNS + (s.hid ? " show=\"0\"" : "") + "><p:cSld>" + bg + "<p:spTree>" + TREE0 + tree + "</p:spTree></p:cSld>" +
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" + tr + timing + "</p:sld>" });
      files.push({ name: "ppt/slides/_rels/slide" + n + ".xml.rels", data: rels(rl) });
      out.slides++;
    });

    var N = slideList.length, L = LYS.length;
    var cx = SLIDE_CX[deck.as] || SLIDE_CX["16:9"];
    // presentation rels: 1 master, 2 theme, 3 notes master, 4-6 props, 7.. slides
    var presRels = [["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ["rId2", "theme", "theme/theme1.xml"],
      ["rId3", "notesMaster", "notesMasters/notesMaster1.xml"],
      ["rId4", "presProps", "presProps.xml"], ["rId5", "viewProps", "viewProps.xml"], ["rId6", "tableStyles", "tableStyles.xml"]];
    for (var i = 1; i <= N; i++) presRels.push(["rId" + (6 + i), "slide", "slides/slide" + i + ".xml"]);
    var lvl = "";
    for (var l = 1; l <= 9; l++) lvl += "<a:lvl" + l + "pPr marL=\"" + (l - 1) * 457200 + "\" algn=\"l\" defTabSz=\"914400\"><a:defRPr sz=\"1800\">" + solid("t:fg") + "<a:latin typeface=\"+mn-lt\"/><a:ea typeface=\"+mn-ea\"/><a:cs typeface=\"+mn-cs\"/></a:defRPr></a:lvl" + l + "pPr>";
    var pres = XML + "<p:presentation" + PNS + " saveSubsetFonts=\"1\">" +
      "<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>" +
      "<p:notesMasterIdLst><p:notesMasterId r:id=\"rId3\"/></p:notesMasterIdLst>" +
      (N ? "<p:sldIdLst>" + slideList.map(function (s, k) { return "<p:sldId id=\"" + (256 + k) + "\" r:id=\"rId" + (7 + k) + "\"/>"; }).join("") + "</p:sldIdLst>" : "") +
      "<p:sldSz cx=\"" + cx + "\" cy=\"" + SLIDE_CY + "\"" + (deck.as === "4:3" ? " type=\"screen4x3\"" : "") + "/><p:notesSz cx=\"6858000\" cy=\"9144000\"/>" +
      "<p:defaultTextStyle>" + lvl + "</p:defaultTextStyle></p:presentation>";
    var master = XML + "<p:sldMaster" + PNS + "><p:cSld><p:bg><p:bgPr>" + solid("t:bg") + "<a:effectLst/></p:bgPr></p:bg>" +
      "<p:spTree>" + TREE0 + "</p:spTree></p:cSld>" + CLRMAP +
      "<p:sldLayoutIdLst>" + LYS.map(function (ly, k) { return "<p:sldLayoutId id=\"" + (2147483649 + k) + "\" r:id=\"rId" + (k + 1) + "\"/>"; }).join("") + "</p:sldLayoutIdLst>" +
      "<p:txStyles><p:titleStyle><a:lvl1pPr algn=\"l\"><a:buNone/><a:defRPr sz=\"4320\" b=\"1\">" + solid("t:fg") + "<a:latin typeface=\"+mj-lt\"/></a:defRPr></a:lvl1pPr></p:titleStyle>" +
      "<p:bodyStyle><a:lvl1pPr marL=\"0\" indent=\"0\" algn=\"l\"><a:buNone/><a:defRPr sz=\"2376\">" + solid("t:fg") + "<a:latin typeface=\"+mn-lt\"/></a:defRPr></a:lvl1pPr></p:bodyStyle>" +
      "<p:otherStyle><a:lvl1pPr><a:defRPr>" + solid("t:fg") + "</a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>";
    var notesMaster = XML + "<p:notesMaster" + PNS + "><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val=\"FFFFFF\"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>" + TREE0 +
      "<p:sp>" + nv("Sp", 2, "Slide Image Placeholder 1", "<p:cNvSpPr><a:spLocks noGrp=\"1\" noRot=\"1\" noChangeAspect=\"1\"/></p:cNvSpPr>", "<p:ph type=\"sldImg\" idx=\"2\"/>") +
      "<p:spPr><a:xfrm><a:off x=\"685800\" y=\"1143000\"/><a:ext cx=\"5486400\" cy=\"" + int(5486400 * SLIDE_CY / cx) + "\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/></p:spPr></p:sp>" +
      "<p:sp>" + nv("Sp", 3, "Notes Placeholder 2", "<p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr>", "<p:ph type=\"body\" sz=\"quarter\" idx=\"3\"/>") +
      "<p:spPr><a:xfrm><a:off x=\"685800\" y=\"4800600\"/><a:ext cx=\"5486400\" cy=\"3771900\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr>" +
      "<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang=\"en-US\"/></a:p></p:txBody></p:sp>" +
      "</p:spTree></p:cSld><p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>" +
      "<p:notesStyle><a:lvl1pPr marL=\"0\" algn=\"l\"><a:defRPr sz=\"1200\"><a:solidFill><a:srgbClr val=\"000000\"/></a:solidFill><a:latin typeface=\"+mn-lt\"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>";

    var CT = "application/vnd.openxmlformats-officedocument.presentationml.";
    var ov = function (part, type) { return "<Override PartName=\"" + part + "\" ContentType=\"" + type + "\"/>"; };
    var types = XML + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
      "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
      "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
      "<Default Extension=\"png\" ContentType=\"image/png\"/><Default Extension=\"jpg\" ContentType=\"image/jpeg\"/>" +
      ov("/ppt/presentation.xml", CT + "presentation.main+xml") +
      ov("/ppt/slideMasters/slideMaster1.xml", CT + "slideMaster+xml") +
      LYS.map(function (ly, k) { return ov("/ppt/slideLayouts/slideLayout" + (k + 1) + ".xml", CT + "slideLayout+xml"); }).join("") +
      ov("/ppt/notesMasters/notesMaster1.xml", CT + "notesMaster+xml") +
      ov("/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml") +
      ov("/ppt/theme/theme2.xml", "application/vnd.openxmlformats-officedocument.theme+xml") +
      ov("/ppt/presProps.xml", CT + "presProps+xml") + ov("/ppt/viewProps.xml", CT + "viewProps+xml") + ov("/ppt/tableStyles.xml", CT + "tableStyles+xml") +
      slideList.map(function (s, k) { return ov("/ppt/slides/slide" + (k + 1) + ".xml", CT + "slide+xml"); }).join("") +
      Object.keys(notesOf).map(function (k) { return ov("/ppt/notesSlides/notesSlide" + notesOf[k] + ".xml", CT + "notesSlide+xml"); }).join("") +
      ov("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml") +
      ov("/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml") +
      "</Types>";
    var core = XML + "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" " +
      "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
      "<dc:title>" + esc(deck.t || "") + "</dc:title><dc:creator>orOS Slides</dc:creator></cp:coreProperties>";
    var app = XML + "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\">" +
      "<Application>orOS Slides</Application><Slides>" + N + "</Slides><Notes>" + notesN + "</Notes></Properties>";
    var head = [
      { name: "[Content_Types].xml", data: types },
      { name: "_rels/.rels", data: rels([["rId1", "officeDocument", "ppt/presentation.xml"],
        ["rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"],
        ["rId3", "extended-properties", "docProps/app.xml"]]) },
      { name: "docProps/core.xml", data: core },
      { name: "docProps/app.xml", data: app },
      { name: "ppt/presentation.xml", data: pres },
      { name: "ppt/_rels/presentation.xml.rels", data: rels(presRels) },
      { name: "ppt/presProps.xml", data: XML + "<p:presentationPr" + PNS + "/>" },
      { name: "ppt/viewProps.xml", data: XML + "<p:viewPr" + PNS + "/>" },
      { name: "ppt/tableStyles.xml", data: XML + "<a:tblStyleLst xmlns:a=\"" + NS_A + "\" def=\"{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}\"/>" },
      { name: "ppt/slideMasters/slideMaster1.xml", data: master },
      { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: rels(LYS.map(function (ly, k) { return ["rId" + (k + 1), "slideLayout", "../slideLayouts/slideLayout" + (k + 1) + ".xml"]; })
        .concat([["rId" + (L + 1), "theme", "../theme/theme1.xml"]])) },
      { name: "ppt/notesMasters/notesMaster1.xml", data: notesMaster },
      { name: "ppt/notesMasters/_rels/notesMaster1.xml.rels", data: rels([["rId1", "theme", "../theme/theme2.xml"]]) },
      { name: "ppt/theme/theme1.xml", data: themeXml(theme, "orOS " + theme.id) },
      { name: "ppt/theme/theme2.xml", data: themeXml(Co.themeById("light"), "orOS notes") }
    ];
    LYS.forEach(function (ly, k) {
      head.push({ name: "ppt/slideLayouts/slideLayout" + (k + 1) + ".xml", data: layoutXml(ly, deck.as, prompts) });
      head.push({ name: "ppt/slideLayouts/_rels/slideLayout" + (k + 1) + ".xml.rels", data: rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]) });
    });
    return { bytes: Z().write(head.concat(files)), out: out };
  }

  // ---------- 3. Reading: XML ----------
  // DOM → { n, a:{}, c:[nodes], t:"text of direct children" }
  function domParse(src) {
    if (typeof root.DOMParser !== "function") throw new Error("xml");
    var doc = new root.DOMParser().parseFromString(src, "application/xml");
    if (!doc || !doc.documentElement || doc.getElementsByTagName("parsererror").length) throw new Error("xml");
    var count = 0;
    function conv(el) {
      if (++count > MAX_NODES) throw new Error("xml");
      var o = { n: el.nodeName, a: {}, c: [], t: "" }, i;
      for (i = 0; i < el.attributes.length; i++) o.a[el.attributes[i].name] = el.attributes[i].value;
      for (var ch = el.firstChild; ch; ch = ch.nextSibling) {
        if (ch.nodeType === 1) o.c.push(conv(ch));
        else if (ch.nodeType === 3 || ch.nodeType === 4) o.t += ch.nodeValue;
      }
      return o;
    }
    return { n: "#doc", a: {}, c: [conv(doc.documentElement)], t: "" };
  }
  function kid(n, name) {
    if (!n) return null;
    for (var i = 0; i < n.c.length; i++) if (n.c[i].n === name) return n.c[i];
    return null;
  }
  function kids(n, name) { return n ? n.c.filter(function (x) { return x.n === name; }) : []; }
  function path(n, names) {
    for (var i = 0; i < names.length && n; i++) n = kid(n, names[i]);
    return n;
  }
  function find(n, name) {
    if (!n) return null;
    for (var i = 0; i < n.c.length; i++) {
      if (n.c[i].n === name) return n.c[i];
      var f = find(n.c[i], name);
      if (f) return f;
    }
    return null;
  }
  function num(n, k, def) { var v = n && n.a[k] !== undefined ? Number(n.a[k]) : NaN; return isFinite(v) ? v : def; }
  function bool(n, k) { var v = n && n.a[k]; return v === undefined ? undefined : v === "1" || v === "true" || v === "on"; }

  function dirOf(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i + 1); }
  function resolve(base, target) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;           // external: never followed
    var parts = (target[0] === "/" ? target.slice(1) : dirOf(base) + target).split("/"), out = [];
    parts.forEach(function (s) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); });
    return out.join("/");
  }
  function relsPath(p) { return dirOf(p) + "_rels/" + p.slice(dirOf(p).length) + ".rels"; }
  function loader(zip, parse) {
    var cache = {};
    function xml(p) {
      if (!p || !zip.has(p)) return Promise.resolve(null);
      if (!cache[p]) cache[p] = zip.text(p, MAX_XML).then(function (s) {
        if (s === null) return null;
        if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw new Error("xml");
        return parse(s);
      });
      return cache[p];
    }
    function rels(p) {
      if (!p) return Promise.resolve({});
      return xml(relsPath(p)).then(function (doc) {
        var map = {};
        kids(kid(doc, "Relationships"), "Relationship").forEach(function (r) {
          if (r.a.TargetMode === "External") return;
          var t = resolve(p, r.a.Target || "");
          if (t) map[r.a.Id] = { target: t, type: (r.a.Type || "").split("/").pop() };
        });
        return map;
      });
    }
    return { xml: xml, rels: rels };
  }
  function relOfType(rels, type) {
    var ks = Object.keys(rels);
    for (var i = 0; i < ks.length; i++) if (rels[ks[i]].type === type) return rels[ks[i]].target;
    return null;
  }

  // ---------- 4. Reading: colours, fonts ----------
  function hex2(n) { n = clamp(Math.round(n), 0, 255); return (n < 16 ? "0" : "") + n.toString(16); }
  function toHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function fromHsl(h, s, l) {
    function f(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    if (!s) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
  }
  var PRESET = { black: "000000", white: "ffffff", red: "ff0000", green: "008000", blue: "0000ff", yellow: "ffff00", gray: "808080", grey: "808080", darkGray: "a9a9a9", lightGray: "d3d3d3", orange: "ffa500" };
  var CLR_NODES = ["a:srgbClr", "a:schemeClr", "a:sysClr", "a:prstClr", "a:scrgbClr", "a:hslClr"];
  // a colour node → { c: "#rrggbb" | "t:role", a: 0..1 } (a theme role
  // only in a file Slides wrote, and only without colour changes)
  function colourOf(n, ctx) {
    if (!n) return null;
    var hex = null, role = null;
    if (n.n === "a:srgbClr") hex = n.a.val;
    else if (n.n === "a:schemeClr") {
      var v = n.a.val;
      if (v === "phClr") return ctx.phClr || null;
      var slot = ctx.clrMap[v] || v;
      hex = ctx.theme.colors[slot];
      if (ctx.oros && SLOT_ROLE[slot]) role = "t:" + SLOT_ROLE[slot];
    } else if (n.n === "a:sysClr") hex = n.a.lastClr || (n.a.val === "window" ? "ffffff" : "000000");
    else if (n.n === "a:prstClr") hex = PRESET[n.a.val] || "000000";
    else if (n.n === "a:scrgbClr") hex = hex2(num(n, "r", 0) / 100000 * 255) + hex2(num(n, "g", 0) / 100000 * 255) + hex2(num(n, "b", 0) / 100000 * 255);
    else if (n.n === "a:hslClr") { var q = fromHsl(num(n, "hue", 0) / 21600000, num(n, "sat", 0) / 100000, num(n, "lum", 0) / 100000); hex = hex2(q[0]) + hex2(q[1]) + hex2(q[2]); }
    if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    var r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16), a = 1, changed = false;
    n.c.forEach(function (m) {
      var x = num(m, "val", 0) / 100000;
      if (m.n === "a:alpha") { a = x; return; }
      changed = true;
      if (m.n === "a:tint") { r = 255 - (255 - r) * x; g = 255 - (255 - g) * x; b = 255 - (255 - b) * x; }
      else if (m.n === "a:shade") { r *= x; g *= x; b *= x; }
      else if (m.n === "a:lumMod" || m.n === "a:lumOff") {
        var hsl = toHsl(r, g, b);
        hsl[2] = m.n === "a:lumMod" ? hsl[2] * x : Math.min(1, hsl[2] + x);
        var o = fromHsl(hsl[0], hsl[1], hsl[2]); r = o[0]; g = o[1]; b = o[2];
      }
    });
    return { c: role && !changed ? role : "#" + hex2(r) + hex2(g) + hex2(b), a: clamp(a, 0, 1) };
  }
  function colourIn(n, ctx) {
    if (!n) return null;
    for (var i = 0; i < n.c.length; i++) if (CLR_NODES.indexOf(n.c[i].n) >= 0) return colourOf(n.c[i], ctx);
    return null;
  }
  // fill of an spPr / bgPr / rPr: { c, a } | { none } | { blip } | null
  function fillOf(pr, ctx) {
    if (!pr) return null;
    if (kid(pr, "a:noFill")) return { none: true };
    var sf = kid(pr, "a:solidFill");
    if (sf) return colourIn(sf, ctx);
    var gf = kid(pr, "a:gradFill");
    if (gf) {
      var gs = kids(kid(gf, "a:gsLst"), "a:gs").sort(function (x, y) { return num(x, "pos", 0) - num(y, "pos", 0); });
      return gs.length ? colourIn(gs[0], ctx) : null;
    }
    if (kid(pr, "a:blipFill")) return { blip: kid(pr, "a:blipFill") };
    if (kid(pr, "a:pattFill")) return colourIn(kid(kid(pr, "a:pattFill"), "a:fgClr"), ctx);
    return null;
  }
  // the most common theme light colour decides light or dark
  function lum(h) {
    var v = [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  var SERIF = /serif|times|garamond|georgia|playfair|merriweather|lora|baskerville|bodoni|didot|cormorant|crimson|cambria|book antiqua|palatino|minion|caslon|rockwell|bitter|constantia|century schoolbook|bookman/i;
  var MONO = /mono|courier|consolas|code|menlo|inconsolata|lucida console/i;
  function familyOf(name) {
    if (!name) return "sans";
    if (MONO.test(name)) return "mono";
    if (/sans/i.test(name)) return "sans";
    return SERIF.test(name) ? "serif" : "sans";
  }
  function parseTheme(doc) {
    var t = { colors: {}, major: "", minor: "", name: "" };
    var th = kid(doc, "a:theme");
    if (th) t.name = th.a.name || "";
    var cs = find(doc, "a:clrScheme");
    if (cs) cs.c.forEach(function (c) {
      var v = c.c[0];
      if (!v) return;
      var name = c.n.replace(/^a:/, "");
      if (v.n === "a:srgbClr") t.colors[name] = v.a.val;
      else if (v.n === "a:sysClr") t.colors[name] = v.a.lastClr || (v.a.val === "window" ? "ffffff" : "000000");
    });
    var mj = find(find(doc, "a:majorFont"), "a:latin"), mn = find(find(doc, "a:minorFont"), "a:latin");
    t.major = mj && mj.a.typeface || ""; t.minor = mn && mn.a.typeface || "";
    return t;
  }

  // ---------- 5. Reading: placeholders and inherited text styles ----------
  function phOf(n) {
    var nvp = kid(n, "p:nvSpPr") || kid(n, "p:nvPicPr") || kid(n, "p:nvCxnSpPr") || kid(n, "p:nvGraphicFramePr");
    var ph = nvp && path(nvp, ["p:nvPr", "p:ph"]);
    return ph ? { type: ph.a.type || "obj", idx: ph.a.idx || "" } : null;
  }
  var TITLE_T = { title: 1, ctrTitle: 1 };
  function phMatch(k, key) {
    if (key.idx && k.idx === key.idx && key.idx !== "0") return true;
    if (k.type === key.type) return true;
    if (TITLE_T[k.type] && TITLE_T[key.type]) return true;
    if ((key.type === "obj" || key.type === "subTitle") && k.type === "body") return true;
    return false;
  }
  // the layout's / master's placeholder: same idx first, then same type
  function phFind(tree, key) {
    var byIdx = null, byType = null;
    if (!tree) return null;
    (function walk(n) {
      n.c.forEach(function (c) {
        if (c.n === "p:sp" || c.n === "p:pic") {
          var k = phOf(c);
          if (!k) return;
          if (!byIdx && key.idx && key.idx !== "0" && k.idx === key.idx) byIdx = c;
          if (!byType && phMatch(k, { type: key.type, idx: "" })) byType = c;
        } else if (c.n === "p:grpSp") walk(c);
      });
    })(tree);
    return byIdx || byType;
  }
  function styleFor(key, ctx) {
    if (!key) return ctx.styles.other;
    if (TITLE_T[key.type]) return ctx.styles.title;
    return ctx.styles.body;
  }
  // the level's paragraph properties, nearest first
  function chainOf(lst, lvl) {
    var name = "a:lvl" + (lvl + 1) + "pPr";
    return lst.map(function (l) { return kid(l, name); }).filter(Boolean);
  }
  function firstAttr(nodes, k) {
    for (var i = 0; i < nodes.length; i++) if (nodes[i] && nodes[i].a[k] !== undefined) return nodes[i].a[k];
    return undefined;
  }
  function firstKid(nodes, names) {
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i]) continue;
      for (var j = 0; j < nodes[i].c.length; j++) if (names.indexOf(nodes[i].c[j].n) >= 0) return nodes[i].c[j];
    }
    return null;
  }

  // ---------- 6. Reading: shapes ----------
  var ALIGN_IN = { l: "l", ctr: "c", r: "r", just: "j", dist: "j", justLow: "j", thaiDist: "j" };
  var LINE_PRST = /^(line|straightConnector1|bentConnector[2-5]|curvedConnector[2-5])$/;
  var ELLIPSE_PRST = /^(ellipse|flowChartConnector|donut|pie|chord|blockArc|arc|flowChartOr|flowChartSummingJunction|smileyFace|noSmoking)$/;
  var ROUND_PRST = /^(roundRect|round1Rect|round2SameRect|round2DiagRect|snipRoundRect|flowChartAlternateProcess|flowChartTerminator)$/;

  function box(xf, tf) {
    if (!xf) return null;
    var off = kid(xf, "a:off"), ext = kid(xf, "a:ext");
    if (!off || !ext) return null;
    return {
      x: tf.ox + num(off, "x", 0) * tf.sx, y: tf.oy + num(off, "y", 0) * tf.sy,
      w: num(ext, "cx", 0) * tf.sx, h: num(ext, "cy", 0) * tf.sy,
      rot: num(xf, "rot", 0) / 60000 + tf.rot,
      flh: bool(xf, "flipH") === true, flv: bool(xf, "flipV") === true
    };
  }
  // EMU box → slide units
  function U(b, ctx) {
    return { x: b.x * ctx.k + ctx.dx, y: b.y * ctx.k, w: b.w * ctx.k, h: b.h * ctx.k, r: Math.round(((b.rot % 360) + 540) % 360 - 180) };
  }

  function lineOf(spPr, style, ctx) {
    var ln = kid(spPr, "a:ln");
    if (ln && kid(ln, "a:noFill")) return null;
    var c = ln && fillOf(ln, ctx);
    if (c && (c.none || c.blip)) c = null;
    if (!c && style && !(ln && kid(ln, "a:solidFill"))) { var r = kid(style, "a:lnRef"); if (r && num(r, "idx", 0) > 0) c = colourIn(r, ctx); }
    if (!c) return null;
    var w = ln ? num(ln, "w", 12700) : 12700;
    var dash = path(ln, ["a:prstDash"]);
    return { c: c, w: w, dash: !!(dash && dash.a.val && dash.a.val !== "solid") };
  }
  function opOf(a) { return a === undefined || a >= 1 ? undefined : Math.round(a * 100); }

  function noteItem(kind, b, ctx, extra) {
    var label = ctx.labels[kind] || ctx.labels.object;
    var paras = [{ r: [{ t: label, b: true }] }].concat(extra || []);
    return { k: "text", x: b.x, y: b.y, w: Math.max(80, b.w), h: Math.max(60, b.h), r: 0, paras: paras, fs: 24, fc: "#6b7280",
      st: "#9ca3af", sw: 2, dash: true, al: "c", va: "m", note: kind };
  }

  function walkTree(tree, tf, ctx, out, deco) {
    (tree ? tree.c : []).forEach(function (n) {
      try { walkNode(n, tf, ctx, out, deco); } catch (e) { out.count.skipped++; }
    });
  }
  // Every item read from a slide's own tree remembers the PowerPoint
  // shape it came from (spid, for the animations) and its outermost
  // group (grp).
  function walkNode(n, tf, ctx, out, deco) {
    var n0 = out.items.length;
    walkNode0(n, tf, ctx, out, deco);
    if (deco) return;
    var nvp = kid(n, "p:nvSpPr") || kid(n, "p:nvPicPr") || kid(n, "p:nvGrpSpPr") || kid(n, "p:nvCxnSpPr") || kid(n, "p:nvGraphicFramePr");
    var cNvPr = nvp && kid(nvp, "p:cNvPr"), id = cNvPr && cNvPr.a.id;
    if (!id) return;
    for (var i = n0; i < out.items.length; i++) {
      if (n.n === "p:grpSp") out.items[i].grp = String(id);
      else if (out.items[i].spid === undefined) out.items[i].spid = String(id);
    }
  }
  function walkNode0(n, tf, ctx, out, deco) {
    var nvp = kid(n, "p:nvSpPr") || kid(n, "p:nvPicPr") || kid(n, "p:nvGrpSpPr") || kid(n, "p:nvCxnSpPr") || kid(n, "p:nvGraphicFramePr");
    var cNvPr = nvp && kid(nvp, "p:cNvPr");
    if (cNvPr && bool(cNvPr, "hidden")) return;
    if (deco && phOf(n)) return;                         // layout / master placeholders are not content
    if (n.n === "p:grpSp") {
      var gx = path(n, ["p:grpSpPr", "a:xfrm"]);
      if (!gx) { walkTree(n, tf, ctx, out, deco); return; }
      var off = kid(gx, "a:off"), ext = kid(gx, "a:ext"), cho = kid(gx, "a:chOff"), che = kid(gx, "a:chExt");
      var sx = che && num(che, "cx", 0) ? num(ext, "cx", 0) / num(che, "cx", 1) : 1;
      var sy = che && num(che, "cy", 0) ? num(ext, "cy", 0) / num(che, "cy", 1) : 1;
      walkTree(n, {
        ox: tf.ox + (num(off, "x", 0) - (cho ? num(cho, "x", 0) : 0) * sx) * tf.sx,
        oy: tf.oy + (num(off, "y", 0) - (cho ? num(cho, "y", 0) : 0) * sy) * tf.sy,
        sx: tf.sx * sx, sy: tf.sy * sy, rot: tf.rot + num(gx, "rot", 0) / 60000
      }, ctx, out, deco);
      return;
    }
    if (n.n === "mc:AlternateContent") {
      var fb = kid(n, "mc:Fallback");
      if (fb) walkTree(fb, tf, ctx, out, deco); else out.count.skipped++;
      return;
    }
    if (n.n === "p:pic") { picture(n, tf, ctx, out, deco); return; }
    if (n.n === "p:sp" || n.n === "p:cxnSp") { shape(n, tf, ctx, out, deco); return; }
    if (n.n === "p:graphicFrame") { frame(n, tf, ctx, out); return; }
    if (n.n === "p:contentPart") out.count.skipped++;
  }

  function frame(n, tf, ctx, out) {
    var b = box(kid(n, "p:xfrm"), tf);
    if (!b) { out.count.skipped++; return; }
    var gd = path(n, ["a:graphic", "a:graphicData"]), uri = gd && gd.a.uri || "";
    var kind = /\/chart$/.test(uri) ? "chart" : /\/table$/.test(uri) ? "table" : /\/diagram$/.test(uri) ? "diagram" : "object";
    var extra = [];
    if (kind === "table") {
      var tbl = kid(gd, "a:tbl"), rows = [], fs = 0, ac = null;
      kids(tbl, "a:tr").slice(0, C().LIM.tRows).forEach(function (tr, r) {
        rows.push(kids(tr, "a:tc").slice(0, C().LIM.tCols).map(function (tc, c) {
          if (r === 0 && c === 0) { var f = fillOf(kid(tc, "a:tcPr"), ctx); if (f && !f.none && f.c) ac = f.c; }
          return kids(kid(tc, "a:txBody"), "a:p").map(function (p) {
            var s = "";
            p.c.forEach(function (x) {
              if (x.n === "a:r" || x.n === "a:fld") {
                s += (kid(x, "a:t") || { t: "" }).t;
                var rp = kid(x, "a:rPr");
                if (!fs && rp && rp.a.sz) fs = Number(rp.a.sz) / 100 * 12700 * ctx.k;
              }
            });
            return s;
          }).join("\n");
        }));
      });
      if (rows.length) {
        var pr = kid(tbl, "a:tblPr"), tu = U(b, ctx);
        var tbo = { rows: rows, hd: bool(pr, "firstRow") === true, bd: bool(pr, "bandRow") === true };
        if (fs) tbo.fs = Math.round(fs);
        if (ac) tbo.ac = ac;
        out.items.push({ k: "table", x: tu.x, y: tu.y, w: tu.w, h: tu.h, r: 0, tb: tbo });
        return;
      }
      kids(kid(gd, "a:tbl"), "a:tr").slice(0, 30).forEach(function (tr) {
        var cells = kids(tr, "a:tc").map(function (tc) {
          return kids(kid(tc, "a:txBody"), "a:p").map(function (p) {
            var s = "";
            p.c.forEach(function (r) { if (r.n === "a:r" || r.n === "a:fld") s += (kid(r, "a:t") || { t: "" }).t; });
            return s;
          }).join(" ").trim();
        });
        var line = cells.join(" \u00b7 ").trim();
        if (line.replace(/[\s\u00b7]/g, "")) extra.push({ r: [{ t: line }] });
      });
    }
    out.items.push(noteItem(kind, U(b, ctx), ctx, extra));
    out.count.unknown++;
  }

  function picture(n, tf, ctx, out, deco) {
    var spPr = kid(n, "p:spPr"), key = phOf(n);
    var b = box(kid(spPr, "a:xfrm"), tf);
    if (!b && key) b = phBox(key, ctx, tf);
    if (!b) { out.count.skipped++; return; }
    var nvPr = path(n, ["p:nvPicPr", "p:nvPr"]);
    if (nvPr && (kid(nvPr, "a:videoFile") || kid(nvPr, "a:audioFile") || kid(nvPr, "a:quickTimeFile") || find(nvPr, "p14:media"))) {
      out.items.push(noteItem("media", U(b, ctx), ctx));
      out.count.unknown++;
      return;
    }
    var blipFill = kid(n, "p:blipFill"), blip = kid(blipFill, "a:blip");
    var rel = blip && ctx.rels[blip.a["r:embed"]];
    if (!rel || !/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(rel.target)) { out.count.skipped++; return; }
    var u = U(b, ctx), src = kid(blipFill, "a:srcRect"), crop = null;
    if (src) crop = { l: num(src, "l", 0) / 100000, t: num(src, "t", 0) / 100000, r: num(src, "r", 0) / 100000, b: num(src, "b", 0) / 100000 };
    var it = { k: "image", x: u.x, y: u.y, w: u.w, h: u.h, r: u.r, media: rel.target, crop: crop };
    var cNvPr = path(n, ["p:nvPicPr", "p:cNvPr"]);
    if (cNvPr && cNvPr.a.descr) it.alt = cNvPr.a.descr;
    var pg = kid(spPr, "a:prstGeom"), pid = pg ? pg.a.prst : "rect";
    if (pid === "ellipse") it.rad = Math.min(u.w, u.h) / 2;
    else if (ROUND_PRST.test(pid)) it.rad = roundRad(pg, u);
    var am = kid(blip, "a:alphaModFix");
    if (am) it.op = Math.round(num(am, "amt", 100000) / 1000);
    var ln = lineOf(spPr, kid(n, "p:style"), ctx);
    if (ln) { it.st = ln.c.c; it.sw = Math.max(1, ln.w * ctx.k); if (ln.dash) it.dash = true; }
    if (key) it.phKey = key;
    if (deco) it.lk = true;
    out.media[rel.target] = true;
    out.items.push(it);
  }
  function roundRad(pg, u) {
    var gd = find(kid(pg, "a:avLst"), "a:gd");
    var adj = gd ? Number(String(gd.a.fmla || "").replace(/^val\s+/, "")) : 16667;
    if (!isFinite(adj)) adj = 16667;
    return clamp(adj, 0, 50000) / 50000 * Math.min(u.w, u.h) / 2;
  }
  function phBox(key, ctx, tf) {
    var trees = [ctx.layoutTree, ctx.masterTree];
    for (var i = 0; i < trees.length; i++) {
      var hit = phFind(trees[i], key);
      var b = hit && box(path(hit, ["p:spPr", "a:xfrm"]), tf);
      if (b) return b;
    }
    return null;
  }

  function shape(n, tf, ctx, out, deco) {
    var spPr = kid(n, "p:spPr"), style = kid(n, "p:style"), key = phOf(n);
    if (key && /^(dt|ftr|sldNum|hdr)$/.test(key.type)) return;     // Slides has its own footer
    var b = box(kid(spPr, "a:xfrm"), tf) || (key ? phBox(key, ctx, tf) : null);
    if (!b) { out.count.skipped++; return; }
    var pg = kid(spPr, "a:prstGeom"), cust = kid(spPr, "a:custGeom");
    var pid = pg ? pg.a.prst : cust ? "" : "rect";
    var ln = lineOf(spPr, style, ctx);

    if (n.n === "p:cxnSp" || LINE_PRST.test(pid)) {
      if (!ln) { out.count.skipped++; return; }
      var x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
      if (b.flh) { var tx = x0; x0 = x1; x1 = tx; }
      if (b.flv) { var ty = y0; y0 = y1; y1 = ty; }
      if (b.rot) {
        var cx = b.x + b.w / 2, cy = b.y + b.h / 2, a = b.rot * Math.PI / 180;
        var rp = function (x, y) { return [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]; };
        var p0 = rp(x0, y0), p1 = rp(x1, y1); x0 = p0[0]; y0 = p0[1]; x1 = p1[0]; y1 = p1[1];
      }
      var X0 = x0 * ctx.k + ctx.dx, Y0 = y0 * ctx.k, X1 = x1 * ctx.k + ctx.dx, Y1 = y1 * ctx.k;
      var li = { k: "line", x: Math.min(X0, X1), y: Math.min(Y0, Y1), w: Math.abs(X1 - X0), h: Math.abs(Y1 - Y0), r: 0,
        st: ln.c.c, sw: Math.max(1, ln.w * ctx.k) };
      if ((X1 - X0) * (Y1 - Y0) < 0) li.flip = true;
      if (li.h < 2) { li.y = (Y0 + Y1) / 2 - 1; li.h = 2; delete li.flip; }
      else if (li.w < 2) { li.x = (X0 + X1) / 2 - 1; li.w = 2; delete li.flip; }
      if (ln.dash) li.dash = true;
      var lo = opOf(ln.c.a); if (lo !== undefined) li.op = lo;
      if (deco) li.lk = true;
      out.items.push(li);
      return;
    }

    var u = U(b, ctx);
    var fill = fillOf(spPr, ctx);
    if (!fill && style) { var fr = kid(style, "a:fillRef"); if (fr && num(fr, "idx", 0) > 0) fill = colourIn(fr, ctx); }
    if (fill && fill.blip) {
      // a shape filled with a picture: the picture in the shape's box
      var bl = kid(fill.blip, "a:blip"), rel = bl && ctx.rels[bl.a["r:embed"]];
      if (rel && /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(rel.target)) {
        var pi = { k: "image", x: u.x, y: u.y, w: u.w, h: u.h, r: u.r, media: rel.target, crop: null };
        if (pid === "ellipse") pi.rad = Math.min(u.w, u.h) / 2;
        else if (ROUND_PRST.test(pid)) pi.rad = roundRad(pg, u);
        if (deco) pi.lk = true;
        out.media[rel.target] = true;
        out.items.push(pi);
      } else out.count.skipped++;
      fill = null;
    }
    var hasFill = fill && !fill.none && fill.c;
    var txBody = kid(n, "p:txBody");
    var text = txBody ? textOf(txBody, n, key, ctx) : null;
    if (text && text.empty && !key) text = null;          // shapes carry an empty text body
    var asText = text || (key && !deco);
    var rectish = !cust && (pid === "rect" || !pid);
    var shp = null;
    if (hasFill || ln) {
      if (cust && !text) { out.count.skipped++; }
      else if (!(rectish && asText)) {
        shp = { k: "shape", x: u.x, y: u.y, w: u.w, h: u.h, r: u.r, sh: ELLIPSE_PRST.test(pid) ? "ellipse" : "rect" };
        if (ROUND_PRST.test(pid)) shp.rad = roundRad(pg, u);
        if (hasFill) { shp.fill = fill.c; var fo = opOf(fill.a); if (fo !== undefined) shp.op = fo; }
        if (ln) { shp.st = ln.c.c; shp.sw = Math.max(1, ln.w * ctx.k); if (ln.dash) shp.dash = true; }
        if (pid && pid !== "rect" && !ELLIPSE_PRST.test(pid) && !ROUND_PRST.test(pid) && pid !== "ellipse") out.count.approx++;
        if (deco) shp.lk = true;
        out.items.push(shp);
      }
    }
    if (!asText) return;
    var t = text || { paras: [], al: "l", fs: 0, fc: null, ff: "", va: "t", fit: true };
    var ti = { k: "text", x: u.x, y: u.y, w: u.w, h: u.h, r: u.r, paras: t.paras, al: t.al, va: t.va, ff: t.ff };
    if (t.fs) ti.fs = t.fs;
    if (t.fc) ti.fc = t.fc;
    if (t.op !== undefined) ti.op = t.op;
    if (t.fit === false) ti.fit = false;
    if (!shp && rectish && (hasFill || ln)) {
      if (hasFill) ti.fill = fill.c;
      if (ln) { ti.st = ln.c.c; ti.sw = Math.max(1, ln.w * ctx.k); if (ln.dash) ti.dash = true; }
    }
    if (key) ti.phKey = key;
    if (deco) ti.lk = true;
    out.items.push(ti);
  }

  // A text body → { paras, al, va, fs, fc, ff, op, fit } with every
  // property looked up the way PowerPoint inherits it.
  function textOf(txBody, n, key, ctx) {
    var lst = [kid(txBody, "a:lstStyle")], bodies = [kid(txBody, "a:bodyPr")];
    if (key) [ctx.layoutTree, ctx.masterTree].forEach(function (tree) {
      var hit = phFind(tree, key);
      if (hit) { lst.push(path(hit, ["p:txBody", "a:lstStyle"])); bodies.push(path(hit, ["p:txBody", "a:bodyPr"])); }
    });
    lst.push(styleFor(key, ctx));
    if (!key) lst.push(ctx.styles.def);
    lst = lst.filter(Boolean);
    bodies = bodies.filter(Boolean);
    var anchor = firstAttr(bodies, "anchor") || "t";
    var fitNode = firstKid(bodies, ["a:normAutofit", "a:noAutofit", "a:spAutoFit"]);
    var scale = fitNode && fitNode.n === "a:normAutofit" ? num(fitNode, "fontScale", 100000) / 100000 : 1;
    var fontRef = path(n, ["p:style", "a:fontRef"]), refColour = fontRef ? colourIn(fontRef, ctx) : null;
    var isTitle = key && TITLE_T[key.type];
    var paras = [], first = null;
    kids(txBody, "a:p").forEach(function (p) {
      var pPr = kid(p, "a:pPr");
      var lvl = clamp(Math.round(num(pPr, "lvl", 0)), 0, 8);
      var chain = [pPr].concat(chainOf(lst, lvl));
      var defs = chain.map(function (x) { return x && kid(x, "a:defRPr"); }).filter(Boolean);
      var bu = firstKid(chain, ["a:buNone", "a:buChar", "a:buAutoNum", "a:buBlip"]);
      var ls = isTitle || !bu || bu.n === "a:buNone" ? "" : bu.n === "a:buAutoNum" ? "n" : "b";
      var algn = firstAttr(chain, "algn") || "l";
      var cur = { l: Math.min(lvl, 4), ls: ls, r: [], al: ALIGN_IN[algn] || "l" };
      var segs = [cur];
      p.c.forEach(function (r) {
        if (r.n === "a:br") { cur = { l: cur.l, ls: "", r: [], al: cur.al, cont: true }; segs.push(cur); return; }
        if (r.n !== "a:r" && r.n !== "a:fld") return;
        var tn = kid(r, "a:t"), str = tn ? tn.t.replace(/[\t\u000b]/g, " ") : "";
        if (!str) return;
        var rPr = kid(r, "a:rPr"), rr = [rPr].concat(defs);
        var sz = Number(firstAttr(rr, "sz")) || 1800;
        var b = firstAttr(rr, "b"), i = firstAttr(rr, "i"), un = firstAttr(rr, "u");
        var colNode = firstKid(rr, ["a:solidFill", "a:gradFill", "a:noFill"]);
        var col = colNode ? fillOf({ c: [colNode] }, ctx) : null;
        if (!col || col.none || col.blip) col = refColour || ctx.defText;
        var lat = firstKid(rr, ["a:latin"]), face = lat && lat.a.typeface || "+mn-lt";
        var run = { t: str, b: b === "1" || b === "true", i: i === "1" || i === "true", u: !!un && un !== "none", c: col, sz: sz * scale, face: face };
        if (!first) first = { run: run, l: cur.l };
        cur.r.push(run);
      });
      segs.forEach(function (s) { paras.push(s); });
    });
    // the box's own look: from its first run
    var fc = first ? first.run.c : (ctx.defText || null), ff = "", fs = 0;
    if (first) {
      fs = first.run.sz / 100 * 12700 * ctx.k / D().levelSize(1, first.l);
      var face = first.run.face;
      if (/^\+mj-/.test(face) || /^\+mn-/.test(face)) ff = ctx.oros ? "" : familyOf(/^\+mj-/.test(face) ? ctx.theme.major : ctx.theme.minor);
      else ff = familyOf(face);
    } else if (key) {
      // an empty placeholder: the size it would have
      var d0 = firstKid(chainOf(lst, 0), ["a:defRPr"]);
      if (d0 && d0.a.sz) fs = Number(d0.a.sz) / 100 * 12700 * ctx.k;
    }
    var al = paras.length ? paras[0].al : "l";
    var outParas = paras.map(function (p) {
      return { l: p.l, ls: p.ls, r: p.r.map(function (r) {
        var o = { t: r.t };
        if (r.b) o.b = true;
        if (r.i) o.i = true;
        if (r.u) o.u = true;
        if (r.c && fc && r.c.c !== fc.c) o.c = r.c.c;
        return o;
      }) };
    });
    // a paragraph continued after a line break carries no bullet; a
    // text that is all empty is no text
    if (!outParas.some(function (p) { return p.r.length; })) outParas = [];
    return {
      paras: outParas, al: al, va: anchor === "ctr" ? "m" : anchor === "b" ? "b" : "t",
      fs: fs ? Math.round(fs) : 0, fc: fc && first ? fc.c : null, op: fc ? opOf(fc.a) : undefined, ff: ff,
      // "do not shrink" only from Slides itself: Slides clips what overflows,
      // PowerPoint lets it run over, so other files keep shrink to fit on
      fit: !(ctx.oros && fitNode && fitNode.n === "a:noAutofit"), empty: !outParas.length
    };
  }

  function bgOf(cSld, ctx) {
    var bg = kid(cSld, "p:bg");
    if (!bg) return null;
    var pr = kid(bg, "p:bgPr");
    if (pr) {
      var f = fillOf(pr, ctx);
      if (f && f.blip) {
        var bl = kid(f.blip, "a:blip"), rel = bl && ctx.rels[bl.a["r:embed"]];
        return rel && /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(rel.target) ? { img: rel.target } : null;
      }
      return f && !f.none ? { c: f.c } : null;
    }
    var ref = kid(bg, "p:bgRef");
    if (ref) { var c = colourIn(ref, ctx); return c ? { c: c.c } : null; }
    return null;
  }
  function transOf(sld) {
    var tr = kid(sld, "p:transition");
    if (!tr) {
      var ac = kids(sld, "mc:AlternateContent");
      for (var i = 0; i < ac.length && !tr; i++) tr = path(ac[i], ["mc:Fallback", "p:transition"]) || path(ac[i], ["mc:Choice", "p:transition"]);
    }
    if (!tr || !tr.c.length) return "none";
    var k = tr.c[0].n.replace(/^p\d*:/, "");
    if (k === "fade" || k === "dissolve") return "fade";
    if (k === "push") return "push";
    if (k === "wipe" || k === "split" || k === "strips") return "wipe";
    if (k === "zoom" || k === "newsflash" || k === "vortex") return "zoom";
    if (/^(cover|pull|reveal|cut|randomBar|blinds|checker|comb|wheel|wedge|circle|diamond|plus)$/.test(k)) return "slide";
    return "fade";
  }
  // The transition's length: PowerPoint 2010's p14:dur when there,
  // else its speed (medium = Slides' default, not stored).
  function tdOf(sld) {
    var ac = kids(sld, "mc:AlternateContent"), tr = kid(sld, "p:transition");
    for (var i = 0; i < ac.length; i++) {
      var ch = path(ac[i], ["mc:Choice", "p:transition"]);
      if (ch && ch.a["p14:dur"] !== undefined) return clamp(Math.round(num(ch, "p14:dur", 450)), 100, 5000);
      if (!tr) tr = path(ac[i], ["mc:Fallback", "p:transition"]) || ch;
    }
    if (!tr) return undefined;
    if (tr.a["p14:dur"] !== undefined) return clamp(Math.round(num(tr, "p14:dur", 450)), 100, 5000);
    return SPD_MS[tr.a.spd];
  }
  // A slide's entrance animations: [{ spid, pi, e, d, w, du, dl }] in
  // playing order. Exit, emphasis and motion paths are left out.
  var PRESET_FX = { 1: "appear", 2: "fly", 10: "fade", 53: "zoom", 23: "zoom", 21: "zoom", 31: "zoom" };
  var SUB_FLY = { 1: "t", 2: "r", 4: "b", 8: "l" };
  function timingOf(sld) {
    var root = kid(sld, "p:timing"), out = [];
    if (!root) return out;
    var main = null;
    (function walk(n, depth) {
      if (main || !n || depth > 12) return;
      n.c.forEach(function (c) { if (!main && c.n === "p:cTn" && c.a.nodeType === "mainSeq") main = c; else walk(c, depth + 1); });
    })(root, 0);
    if (!main) return out;
    (function walk(n, depth) {
      if (!n || depth > 12 || out.length >= 200) return;
      n.c.forEach(function (c) {
        if (c.n === "p:cTn" && c.a.presetClass) {
          if (c.a.presetClass !== "entr") return;
          var st = find(c, "p:spTgt");
          if (!st || !st.a.spid) return;
          var pr = find(st, "p:pRg"), du = 0;
          (function durs(x) { x.c.forEach(function (y) { if (y.n === "p:cTn" && y !== c) { var d = num(y, "dur", 0); if (d > 1 && d > du) du = d; } durs(y); }); })(c);
          var cond = path(c, ["p:stCondLst", "p:cond"]);
          var id = num(c, "presetID", 10), e = PRESET_FX[id] || "fade";
          out.push({ spid: String(st.a.spid), pi: pr ? num(pr, "st", 0) : -1, e: e, d: e === "fly" ? SUB_FLY[num(c, "presetSubtype", 4)] || "b" : undefined,
            w: NODE_W[c.a.nodeType] || "c", du: du || 500, dl: cond ? num(cond, "delay", 0) : 0 });
          return;
        }
        walk(c, depth + 1);
      });
    })(main, 0);
    return out;
  }
  // The effects onto the items: an item (or every item of a group)
  // takes the first effect aimed at it; effects aimed at single
  // paragraphs become "bullets one by one".
  function applyTiming(effects, items) {
    var prev = "", seen = {};
    effects.forEach(function (f) {
      var hit = items.filter(function (it) { return it.spid === f.spid || it.grp === f.spid; });
      if (!hit.length || seen[f.spid]) return;
      seen[f.spid] = 1;
      prev = C().posBetween(prev, null);
      var an = { e: f.e, o: prev, du: f.du, dl: f.dl };
      if (f.d) an.d = f.d;
      if (f.w !== "c") an.w = f.w;
      if (f.pi >= 0) an.p = true;
      hit.forEach(function (it) { it.an = JSON.parse(JSON.stringify(an)); });
    });
  }

  // ---------- 7. Reading: the presentation ----------
  function read(zip, opts) {
    opts = opts || {};
    var L = loader(zip, opts.parseXml || domParse);
    var labels = opts.labels || {};
    ["chart", "table", "diagram", "media", "object"].forEach(function (k) {
      if (!labels[k]) labels[k] = { chart: "Chart (not imported)", table: "Table (not imported)", diagram: "SmartArt (not imported)",
        media: "Video or sound (not imported)", object: "Embedded object (not imported)" }[k];
    });
    var plan = { as: "16:9", title: "", th: "light", slides: [], media: {}, count: { skipped: 0, approx: 0, unknown: 0, slides: 0 } };
    var presP = "ppt/presentation.xml", ctx0 = null, themes = {};
    return Promise.all([L.xml(presP), L.rels(presP), L.xml("docProps/app.xml"), L.xml("docProps/core.xml")]).then(function (res) {
      var pres = kid(res[0], "p:presentation"), prels = res[1];
      if (!pres) throw new Error("pptx");
      var appName = (find(res[2], "Application") || { t: "" }).t;
      var title = find(res[3], "dc:title");
      plan.title = title ? title.t : "";
      var sz = kid(pres, "p:sldSz");
      var cx = num(sz, "cx", 12192000), cy = num(sz, "cy", 6858000);
      if (!(cx > 0 && cy > 0)) { cx = 12192000; cy = 6858000; }
      plan.as = Math.abs(cx / cy - 16 / 9) <= Math.abs(cx / cy - 4 / 3) ? "16:9" : "4:3";
      var k = 1000 / cy;
      ctx0 = { k: k, dx: (C().widthOf(plan.as) - cx * k) / 2, labels: labels, orosApp: /^orOS Slides/.test(appName),
        defStyle: kid(pres, "p:defaultTextStyle") };
      var ids = kids(kid(pres, "p:sldIdLst"), "p:sldId").map(function (s) { return s.a["r:id"]; });
      plan.count.slides = ids.length;
      var chain = Promise.resolve();
      ids.slice(0, C().LIM.slides).forEach(function (rid) {
        var r = prels[rid];
        if (!r) return;
        chain = chain.then(function () { return slide(L, r.target, ctx0, plan, themes); }).then(null, function (e) {
          if (e && e.message === "xml") throw e;
          plan.count.skipped++;
        });
      });
      return chain;
    }).then(function () {
      if (!plan.slides.length && plan.count.slides) throw new Error("pptx");
      return plan;
    });
  }

  function slide(L, sp, base, plan, themes) {
    var doc, rels, layoutP, layout, lrels, masterP, master, mrels, theme;
    return Promise.all([L.xml(sp), L.rels(sp)]).then(function (r) {
      doc = r[0]; rels = r[1];
      layoutP = relOfType(rels, "slideLayout");
      return Promise.all([L.xml(layoutP), L.rels(layoutP)]);
    }).then(function (r) {
      layout = r[0]; lrels = r[1];
      masterP = relOfType(lrels, "slideMaster");
      return Promise.all([L.xml(masterP), L.rels(masterP)]);
    }).then(function (r) {
      master = r[0]; mrels = r[1];
      var themeP = relOfType(mrels, "theme") || "ppt/theme/theme1.xml";
      if (!themes[themeP]) themes[themeP] = L.xml(themeP).then(function (t) { return t ? parseTheme(t) : { colors: {}, major: "", minor: "", name: "" }; });
      return themes[themeP];
    }).then(function (th) {
      theme = th;
      var notesP = relOfType(rels, "notesSlide");
      return L.xml(notesP);
    }).then(function (notes) {
      var sld = kid(doc, "p:sld");
      if (!sld) return;
      var msl = kid(master, "p:sldMaster"), lsl = kid(layout, "p:sldLayout");
      var clrMap = {};
      var cm = kid(msl, "p:clrMap");
      if (cm) Object.keys(cm.a).forEach(function (k) { clrMap[k] = cm.a[k]; });
      else clrMap = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
      var oros = base.orosApp && /^orOS /.test(theme.name);
      var themeId = oros ? theme.name.slice(5) : null;
      var ctx = {
        k: base.k, dx: base.dx, labels: base.labels, theme: theme, clrMap: clrMap, oros: oros,
        layoutTree: path(lsl, ["p:cSld", "p:spTree"]), masterTree: path(msl, ["p:cSld", "p:spTree"]),
        styles: {
          title: path(msl, ["p:txStyles", "p:titleStyle"]), body: path(msl, ["p:txStyles", "p:bodyStyle"]),
          other: path(msl, ["p:txStyles", "p:otherStyle"]), def: base.defStyle
        }
      };
      ctx.defText = colourOf({ n: "a:schemeClr", a: { val: "tx1" }, c: [] }, ctx) || { c: "#000000", a: 1 };
      if (!plan.slides.length) {
        if (themeId && C().THEME_IDS.indexOf(themeId) >= 0) plan.th = themeId;
        else {
          var bgHex = theme.colors[clrMap.bg1 || "lt1"];
          plan.th = bgHex && /^[0-9a-f]{6}$/i.test(bgHex) && lum("#" + bgHex) < 0.35 ? "dark" : "light";
        }
      }
      var S = { hid: bool(sld, "show") === false, tr: transOf(sld), td: tdOf(sld), bg: null, n: "", ly: "blank", items: [], layoutName: "" };
      S.layoutName = path(lsl, ["p:cSld"]) ? path(lsl, ["p:cSld"]).a.name || "" : "";
      var out = { items: [], media: plan.media, count: plan.count };
      var tf = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0 };
      // background: the slide's, else the layout's, else the master's
      var cs = path(sld, ["p:cSld"]);
      var bg = bgOf(cs, assign(ctx, { rels: rels }));
      var bgFrom = "slide";
      if (!bg) { bg = bgOf(path(lsl, ["p:cSld"]), assign(ctx, { rels: lrels })); bgFrom = "layout"; }
      if (!bg) { bg = bgOf(path(msl, ["p:cSld"]), assign(ctx, { rels: mrels })); bgFrom = "master"; }
      if (bg && bg.img) {
        plan.media[bg.img] = true;
        out.items.push({ k: "image", x: 0, y: 0, w: C().widthOf(plan.as), h: C().H, r: 0, media: bg.img, crop: null, lk: true });
      } else if (bg && bg.c && !(oros && bgFrom !== "slide")) S.bg = bg.c;
      // layout and master decoration (not their placeholders)
      if (bool(sld, "showMasterSp") !== false) {
        if (bool(lsl, "showMasterSp") !== false) walkTree(ctx.masterTree, tf, assign(ctx, { rels: mrels }), out, true);
        walkTree(ctx.layoutTree, tf, assign(ctx, { rels: lrels }), out, true);
      }
      walkTree(path(cs, ["p:spTree"]), tf, assign(ctx, { rels: rels }), out, false);
      // speaker notes: the notes page's body placeholder
      var nt = path(kid(notes, "p:notes"), ["p:cSld", "p:spTree"]);
      if (nt) {
        var body = null;
        (function walk(t) {
          t.c.forEach(function (c) {
            if (body) return;
            if (c.n === "p:sp") { var k = phOf(c); if (k && k.type === "body") body = c; }
            else if (c.n === "p:grpSp") walk(c);
          });
        })(nt);
        if (body) {
          var lines = [];
          kids(kid(body, "p:txBody"), "a:p").forEach(function (p) {
            var s = "";
            p.c.forEach(function (r) {
              if (r.n === "a:r" || r.n === "a:fld") s += (kid(r, "a:t") || { t: "" }).t;
              else if (r.n === "a:br") s += "\n";
            });
            lines.push(s);
          });
          S.n = C().cleanBlock(lines.join("\n"), C().LIM.notes);
        }
      }
      try { applyTiming(timingOf(sld), out.items); } catch (e) { plan.count.skipped++; }
      assignRoles(S, out.items, ctx.oros);
      if (out.items.length > C().LIM.items) { plan.count.skipped += out.items.length - C().LIM.items; out.items = out.items.slice(0, C().LIM.items); }
      S.items = out.items;
      plan.slides.push(S);
    });
  }
  function assign(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }

  // Placeholders → Slides roles, and the Slides layout that holds them.
  var IDX_ROLE = { "1": "sub", "2": "body", "3": "body2", "4": "cap", "5": "cap2", "6": "quote", "7": "img" };
  function roleOf(key, oros, taken) {
    if (oros) {
      if (TITLE_T[key.type]) return "title";
      if (IDX_ROLE[key.idx]) return IDX_ROLE[key.idx];
    }
    if (TITLE_T[key.type]) return "title";
    if (key.type === "subTitle") return "sub";
    if (key.type === "pic") return "img";
    if (/^(body|obj|tx)$/.test(key.type)) return taken.body ? "body2" : "body";
    return null;
  }
  function assignRoles(S, items, oros) {
    var taken = {};
    items.forEach(function (it) {
      var key = it.phKey;
      delete it.phKey;
      if (!key) return;
      var role = roleOf(key, oros, taken);
      var kindOk = role === "img" ? it.k === "image" || (it.k === "text" && !it.paras.length) : it.k === "text";
      if (!role || taken[role] || !kindOk) {
        if (it.k === "text" && !it.paras.length) it.drop = true;        // an empty placeholder with no place
        return;
      }
      taken[role] = 1;
      if (role === "img" && it.k === "text") { it.k = "image"; delete it.paras; it.empty = true; }
      it.ph = role;
      // Slides draws a title bold and a quote italic anyway
      if (it.paras && (role === "title" || role === "quote")) it.paras.forEach(function (p) {
        p.r.forEach(function (r) { if (role === "title") delete r.b; else delete r.i; });
      });
    });
    for (var i = items.length - 1; i >= 0; i--) if (items[i].drop) items.splice(i, 1);
    var roles = Object.keys(taken);
    var best = null, bestExtra = 99;
    var byName = null;
    C().LAYOUTS.forEach(function (ly) { if (ly.name.en === S.layoutName) byName = ly; });
    var fits = function (ly) { var r = ly.ph.map(function (p) { return p.role; }); return roles.every(function (x) { return r.indexOf(x) >= 0; }) ? r.length - roles.length : -1; };
    if (oros && byName && fits(byName) >= 0) best = byName;
    else if (roles.length) C().LAYOUTS.forEach(function (ly) { var e = fits(ly); if (e >= 0 && e < bestExtra) { best = ly; bestExtra = e; } });
    S.ly = best ? best.id : "blank";
    if (!best) items.forEach(function (it) { delete it.ph; });
    delete S.layoutName;
  }

  // ---------- 8. Building the deck ----------
  function cropToImg(spec, asset) {
    var pw = asset.w, ph = asset.h, w = spec.w, h = spec.h;
    var img = { a: asset.id, pw: pw, ph: ph, fit: "fill", ox: 0, oy: 0, zm: 100, alt: spec.alt || "" };
    var c = spec.crop;
    if (!c || !(c.l || c.t || c.r || c.b)) return img;
    var fw = 1 - c.l - c.r, fh = 1 - c.t - c.b;
    if (!(fw > 0.01 && fh > 0.01)) return img;
    var s0 = Math.max(w / pw, h / ph);
    var s = Math.max(w / (fw * pw), h / (fh * ph), s0);
    img.zm = clamp(Math.round(s / s0 * 100), 100, 800);
    s = s0 * img.zm / 100;
    var W = pw * s, H = ph * s;
    if (W - w > 0.5) img.ox = clamp(Math.round((-c.l * W / ((w - W) / 2) - 1) * 100), -100, 100);
    if (H - h > 0.5) img.oy = clamp(Math.round((-c.t * H / ((h - H) / 2) - 1) * 100), -100, 100);
    return img;
  }
  function build(plan, assets, now, newId) {
    var Co = C();
    assets = assets || {};
    var out = { deck: null, slides: [], items: [], missing: 0 };
    out.deck = Co.normDeck({ id: newId(), m: now, c: now, tm: now, t: plan.title, as: plan.as, th: plan.th });
    var W = Co.widthOf(plan.as), prev = "";
    plan.slides.forEach(function (S) {
      var p = Co.posBetween(prev, null);
      prev = p;
      var s = Co.normSlide({ id: newId(), m: now, d: out.deck.id, p: p, ly: S.ly, tr: S.tr, td: S.td, hid: S.hid, n: S.n, nm: S.n ? now : 0, tm: now,
        bg: typeof S.bg === "string" ? S.bg.toLowerCase() : undefined });
      if (!s) return;
      out.slides.push(s);
      var z = 0, roles = {};
      // groups: a PowerPoint group, or the shape + text two items made of one shape
      var gkey = function (x) { return x.lk ? "" : x.grp ? "g" + x.grp : x.spid ? "s" + x.spid : ""; };
      var gcount = {}, gid = {};
      S.items.forEach(function (x) { var k = gkey(x); if (k) gcount[k] = (gcount[k] || 0) + 1; });
      S.items.forEach(function (x) {
        var o = { id: newId(), m: now, s: s.id, k: x.k, x: x.x, y: x.y, w: Math.max(1, x.w), h: Math.max(1, x.h), r: x.r, z: ++z };
        ["ph", "lk", "op", "fill", "st", "sw", "dash", "paras", "al", "va", "fs", "ff", "fc", "fit", "sh", "rad", "flip", "tb", "an"].forEach(function (k) {
          if (x[k] !== undefined && x[k] !== null && x[k] !== "") o[k] = x[k];
        });
        var gk = gkey(x);
        if (gk && gcount[gk] > 1 && !x.ph) o.g = gid[gk] || (gid[gk] = newId());
        ["fill", "st", "fc"].forEach(function (k) { if (typeof o[k] === "string") o[k] = o[k].toLowerCase(); });
        if (o.tb && typeof o.tb.ac === "string") o.tb.ac = o.tb.ac.toLowerCase();
        if (o.paras) o.paras = o.paras.map(function (p) {
          return { l: p.l, ls: p.ls, r: p.r.map(function (r) { var q = {}; Object.keys(r).forEach(function (k) { q[k] = k === "c" ? String(r[k]).toLowerCase() : r[k]; }); return q; }) };
        });
        if (x.k === "image") {
          if (!x.empty) {
            var a = assets[x.media];
            if (!a) { out.missing++; if (!x.ph) return; }
            else o.img = cropToImg(x, a);
          }
        }
        var it = Co.normItem(o);
        if (!it) return;
        if (it.ph) roles[it.ph] = 1;
        out.items.push(it);
      });
      // the layout's placeholders the file did not have, empty
      var ly = Co.layoutById(s.ly);
      if (ly) ly.ph.forEach(function (ph) {
        if (roles[ph.role]) return;
        var b = Co.phBox(ph, plan.as), o = { id: newId(), m: now, s: s.id, k: ph.role === "img" ? "image" : "text", x: b.x, y: b.y, w: b.w, h: b.h, z: ++z, ph: ph.role };
        if (o.k === "text") { o.al = ph.al; o.va = ph.va; o.paras = []; }
        var it = Co.normItem(o);
        if (it) out.items.push(it);
      });
      void W;
    });
    return out;
  }

  // ---------- 9. Sniffing ----------
  function isZip(bytes) { return bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4; }
  var MEDIA_TYPE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };
  function mediaType(p) { var m = /\.([a-z0-9]+)$/i.exec(p || ""); return m ? MEDIA_TYPE[m[1].toLowerCase()] || "" : ""; }

  root.OrosSlidesPPTX = {
    MIME: MIME, EMU: EMU, MAX_MEDIA: MAX_MEDIA,
    needs: needs, charts: charts, write: write, read: read, build: build, timingOf: timingOf,
    isZip: isZip, mediaType: mediaType, familyOf: familyOf, cropToImg: cropToImg, picGeom: picGeom
  };
})(typeof window !== "undefined" ? window : this);
