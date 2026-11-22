// ============================================================
// orOS Layout — InDesign (.idml) and Scribus (.sla) export (LY-W15)
// A Layout document written for the two programs a printer or a
// designer is most likely to open it in. Both writers are pure: they
// take the document and what the caller already has (pictures as
// base64, or a folder name for linked pictures) and return text and
// bytes; layout/io.js zips the IDML and saves the files.
//   - Pages, facing spreads, bleed, margins and columns, masters (each
//     page keeps its master), colours (RGB or CMYK, by name),
//     paragraph and character styles with "based on", text frames with
//     their columns, inset, vertical alignment and threads, rectangles
//     (rounded), ellipses, lines, paths (curves kept), pictures (where
//     they sit in the frame, mirrored or not), rotation, opacity,
//     groups, hidden and locked objects, text wrap, page numbers.
//   - Text: one paragraph per paragraph with its style; local bold,
//     italic, underline and character styles; line breaks, tabs;
//     tables as real tables (IDML) or one row per paragraph at tab
//     stops (Scribus, whose tables are frames of their own).
//   - Effects (LY-W14) go to IDML's own drop shadow, outer glow and
//     feather settings and blend mode; Scribus gets the blend mode and
//     the opacity only.
//   - Not written: tracked changes and comments (Layout's own), index
//     marks (the index text is kept), text on a path (a frame with the
//     text), symbols (their placements are plain groups), gradients
//     (their first colour), colour corrections of pictures.
// The IDML reader (layout/idml.js) and the Scribus reader
// (layout/sla.js) read what these write (tests/layout-w15.test.js).
// Exposes LY_XOUT (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var M = node ? require("../designkit/model.js") : root.orosDK.model;
  var T = node ? require("../designkit/text.js") : root.orosDK.text;
  var R = node ? require("../designkit/render.js") : root.orosDK.render;
  var TB = node ? require("../designkit/table.js") : root.orosDK.table;

  // ---------- 1. Shared ----------
  function esc(s) {
    return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function n4(v) { v = Math.round(Number(v) * 10000) / 10000; return isFinite(v) ? String(v === 0 ? 0 : v) : "0"; }
  function nameOf(n, lang) { return String(M.label(n, lang || "en") || "").replace(/[\u0000-\u001f]/g, " ").trim(); }
  // unique names for a list (colours, styles): name → once
  function namer() {
    var seen = {};
    return function (s, def) {
      var b = String(s || def || "x").replace(/[:\/\\]+/g, " ").trim().slice(0, 60) || def || "x", n = b, k = 2;
      while (seen[n.toLowerCase()]) n = b + " " + k++;
      seen[n.toLowerCase()] = 1;
      return n;
    };
  }
  // the family names a reader can find (extra families: their own name)
  function familyName(fam, font, opts) {
    if (fam && opts && typeof opts.familyName === "function") { var f = opts.familyName(fam); if (f) return String(f); }
    if (fam) return fam.replace(/^(fs|uf)_/, "").split("_").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
    return font === "sans" ? "Noto Sans" : font === "mono" ? "Noto Sans Mono" : "Noto Serif";
  }
  function faceName(b, i) { return b ? (i ? "Bold Italic" : "Bold") : (i ? "Italic" : "Regular"); }
  // the text runs of a paragraph with what each looks like
  function styleMaps(doc) { return { ps: T.byId(doc.pstyles), cs: T.byId(doc.cstyles) }; }
  function runLook(maps, para, run) {
    var ps = T.resolvePs(maps.ps, para.ps), cs = run.cs ? T.resolveCs(maps.cs, run.cs) : {};
    var a = T.runAttrs(ps, cs, run);
    return { ps: ps, a: a, sup: !!(run.ext && run.ext.sup) || cs.pos === "sup", sub: cs.pos === "sub" };
  }
  // the frames of each story in thread order
  function threads(doc) {
    var by = {};
    doc.items.forEach(function (it) { if (it.t === "text" && it.story) (by[it.story] = by[it.story] || []).push(it); });
    Object.keys(by).forEach(function (k) { by[k].sort(function (a, b) { return a.seq - b.seq || (a.id < b.id ? -1 : 1); }); });
    return by;
  }
  // pages, masters, spreads: [{ owner (page or master), pages: [{ p, side, ox }] }]
  function spreadList(doc) {
    var s = doc.setup, w = s.w, order = M.pagesInOrder(doc), out = [];
    M.spreads(doc).forEach(function (sp) {
      var idx0 = order.indexOf(sp[0]);
      out.push(sp.map(function (p, k) {
        var side = M.sideOf(doc, idx0 + k);
        var ox = !s.facing ? -w / 2 : sp.length === 2 ? (k === 0 ? -w : 0) : side === "L" ? -w : 0;
        return { p: p, side: side, ox: ox, idx: idx0 + k };
      }));
    });
    return out;
  }
  function masterPages(doc, ms) {
    var w = doc.setup.w;
    return doc.setup.facing ? [{ p: ms, side: "L", ox: -w }, { p: ms, side: "R", ox: 0 }] : [{ p: ms, side: "", ox: -w / 2 }];
  }
  // the items drawn on one page of a spread (masters: by side)
  function itemsOf(doc, P, isMaster) {
    return doc.items.filter(function (it) {
      if (it.pg !== P.p.id) return false;
      // a master item without a side shows on the right-hand page
      if (isMaster && P.side) return it.side ? it.side === P.side : P.side === "R";
      return true;
    }).sort(function (a, b) { return a.z - b.z || (a.id < b.id ? -1 : 1); });
  }
  function fxOf(it) { return M.itemFx ? M.itemFx(it) : null; }

  // ---------- 2. IDML ----------
  var NS = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="13.0"';
  var HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  var BLEND = { multiply: "Multiply", screen: "Screen", overlay: "Overlay", darken: "Darken", lighten: "Lighten" };
  var JUST = { l: "LeftAlign", c: "CenterAlign", r: "RightAlign", j: "LeftJustified" };

  // opts: { name, lang, images: { asset: { b64, name } } (embedded) |
  // links: "Links/" (pictures linked by file name), familyName(fam) }
  // → { files: [{ name, data (string) }], stats: { pages, items, stories } }
  function idml(doc, opts) {
    opts = opts || {};
    var lang = opts.lang || "en", maps = styleMaps(doc), files = [], uid = 0;
    function U(p) { return "u" + (p || "") + (++uid).toString(36); }
    var stats = { pages: doc.pages.length, items: 0, stories: 0 };

    // colours
    var colName = namer(), colRef = { "": "Swatch/None", "sw-black": "Color/Black", "sw-paper": "Color/Paper" };
    colName("Black"); colName("Paper"); colName("Registration"); colName("None");
    var colXml = [];
    doc.swatches.forEach(function (sw) {
      if (colRef[sw.id]) return;
      var nm = colName(nameOf(sw.name, lang), "Colour"), ref = "Color/" + nm;
      colRef[sw.id] = ref;
      colXml.push('<Color Self="' + esc(ref) + '" Model="Process" Space="' + (sw.mode === "cmyk" ? "CMYK" : "RGB") + '" ColorValue="' + sw.v.map(n4).join(" ") + '" ColorOverride="Normal" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="' + esc(nm) + '" ColorEditable="true" ColorRemovable="true" Visible="true" SwatchCreatorID="7937"/>');
    });
    function col(id) { return colRef.hasOwnProperty(id || "") ? colRef[id || ""] : "Color/Black"; }
    files.push({ name: "Resources/Graphic.xml", data: HEAD + '<idPkg:Graphic ' + NS + '>\n' +
      '<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>\n' +
      '<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Paper" ColorEditable="true" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>\n' +
      '<Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" ColorOverride="Specialregistration" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Registration" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>\n' +
      colXml.join("\n") + (colXml.length ? "\n" : "") +
      '<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>\n' +
      '<StrokeStyle Self="StrokeStyle/$ID/Solid" Name="$ID/Solid"/>\n<StrokeStyle Self="StrokeStyle/$ID/Dashed" Name="$ID/Dashed"/>\n' +
      '</idPkg:Graphic>\n' });

    // fonts used
    var fams = {};
    function fontAttrs(o, look) {
      var fam = familyName(look.fam, look.font, opts);
      fams[fam] = fams[fam] || {};
      fams[fam][faceName(look.b, look.i)] = 1;
      return { font: fam, style: faceName(look.b, look.i) };
    }

    // styles
    var psName = namer(), csName = namer(), psRef = {}, csRef = {};
    psName("[No paragraph style]"); psName("NormalParagraphStyle"); csName("[No character style]");
    function styleAttrs(s, full) {
      var a = [], props = [];
      var look = full ? s : null;
      if (full || s.font !== undefined || s.b !== undefined || s.i !== undefined || (s.ext && s.ext.fam)) {
        var r = full ? look : T.resolvePs(maps.ps, s.id);
        var f = fontAttrs(null, r);
        props.push('<AppliedFont type="string">' + esc(f.font) + '</AppliedFont>');
        a.push('FontStyle="' + esc(f.style) + '"');
      }
      if (s.size !== undefined) a.push('PointSize="' + n4(s.size) + '"');
      if (s.lead !== undefined) props.push('<Leading type="' + (s.lead > 0 ? 'unit">' + n4(s.lead) : 'enumeration">Auto') + '</Leading>');
      if (s.align !== undefined) a.push('Justification="' + (JUST[s.align] || "LeftAlign") + '"');
      if (s.sb !== undefined) a.push('SpaceBefore="' + n4(s.sb) + '"');
      if (s.sa !== undefined) a.push('SpaceAfter="' + n4(s.sa) + '"');
      if (s.fi !== undefined) a.push('FirstLineIndent="' + n4(s.fi) + '"');
      if (s.li !== undefined) a.push('LeftIndent="' + n4(s.li) + '"');
      if (s.ri !== undefined) a.push('RightIndent="' + n4(s.ri) + '"');
      if (s.color !== undefined) a.push('FillColor="' + esc(col(s.color)) + '"');
      if (s.u !== undefined) a.push('Underline="' + (s.u ? "true" : "false") + '"');
      if (s.caps !== undefined) a.push('Capitalization="' + (s.caps ? "AllCaps" : "Normal") + '"');
      if (s.track !== undefined) a.push('Tracking="' + n4(s.track) + '"');
      if (s.bul !== undefined) a.push('BulletsAndNumberingListType="' + (s.bul ? "BulletList" : "NoList") + '"');
      var tabs = s.ext && Array.isArray(s.ext.tabs) ? s.ext.tabs : null;
      if (tabs && tabs.length) props.push('<TabList type="list">' + tabs.map(function (p) { return '<ListItem type="record"><Alignment type="enumeration">LeftAlign</Alignment><AlignmentCharacter type="string">.</AlignmentCharacter><Leader type="string"></Leader><Position type="unit">' + n4(p) + '</Position></ListItem>'; }).join("") + '</TabList>');
      return { a: a, props: props };
    }
    var psXml = [], csXml = [];
    var base = T.resolvePs(maps.ps, "ps-base");
    psRef["ps-base"] = "ParagraphStyle/$ID/NormalParagraphStyle";
    var bst = styleAttrs(Object.assign({}, base, { ext: (M.find(doc.pstyles, "ps-base") || {}).ext }), true);
    psXml.push('<ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" Imported="false"/>');
    psXml.push('<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" Imported="false" ' + bst.a.join(" ") + '><Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn>' + bst.props.join("") + '</Properties></ParagraphStyle>');
    doc.pstyles.forEach(function (s) { if (s.id !== "ps-base") psRef[s.id] = "ParagraphStyle/" + psName(nameOf(s.name, lang), "Style"); });
    doc.pstyles.forEach(function (s) {
      if (s.id === "ps-base") return;
      var at = styleAttrs(s, false), ref = psRef[s.id];
      psXml.push('<ParagraphStyle Self="' + esc(ref) + '" Name="' + esc(ref.slice(15)) + '" Imported="false" ' + at.a.join(" ") + '><Properties><BasedOn type="object">' + esc(psRef[s.base] || psRef["ps-base"]) + '</BasedOn>' + at.props.join("") + '</Properties></ParagraphStyle>');
    });
    doc.cstyles.forEach(function (s) { csRef[s.id] = "CharacterStyle/" + csName(nameOf(s.name, lang), "Character"); });
    doc.cstyles.forEach(function (s) {
      var a = [], props = [];
      if (s.font !== undefined || (s.ext && s.ext.fam)) {
        var f = familyName(s.ext && s.ext.fam, s.font || "serif", opts);
        props.push('<AppliedFont type="string">' + esc(f) + '</AppliedFont>');
      }
      if (s.b !== undefined || s.i !== undefined) a.push('FontStyle="' + faceName(s.b, s.i) + '"');
      if (s.size !== undefined) a.push('PointSize="' + n4(s.size) + '"');
      if (s.color !== undefined) a.push('FillColor="' + esc(col(s.color)) + '"');
      if (s.u !== undefined) a.push('Underline="' + (s.u ? "true" : "false") + '"');
      if (s.caps !== undefined) a.push('Capitalization="' + (s.caps ? "AllCaps" : "Normal") + '"');
      if (s.track !== undefined) a.push('Tracking="' + n4(s.track) + '"');
      if (s.ext && s.ext.pos === "sup") a.push('Position="Superscript"');
      if (s.ext && s.ext.pos === "sub") a.push('Position="Subscript"');
      var ref = csRef[s.id];
      csXml.push('<CharacterStyle Self="' + esc(ref) + '" Name="' + esc(ref.slice(15)) + '" Imported="false" ' + a.join(" ") + '><Properties><BasedOn type="' + (s.base && csRef[s.base] ? 'object">' + esc(csRef[s.base]) : 'string">$ID/[No character style]') + '</BasedOn>' + props.join("") + '</Properties></CharacterStyle>');
    });
    files.push({ name: "Resources/Styles.xml", data: HEAD + '<idPkg:Styles ' + NS + '>\n' +
      '<RootCharacterStyleGroup Self="rcsg">\n<CharacterStyle Self="CharacterStyle/$ID/[No character style]" Imported="false" Name="$ID/[No character style]"/>\n' + csXml.join("\n") + (csXml.length ? "\n" : "") + '</RootCharacterStyleGroup>\n' +
      '<RootParagraphStyleGroup Self="rpsg">\n' + psXml.join("\n") + '\n</RootParagraphStyleGroup>\n' +
      '<RootCellStyleGroup Self="rcesg"><CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]"/></RootCellStyleGroup>\n' +
      '<RootTableStyleGroup Self="rtsg"><TableStyle Self="TableStyle/$ID/[Basic Table]" Name="$ID/[Basic Table]"/></RootTableStyleGroup>\n' +
      '<RootObjectStyleGroup Self="rosg"><ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]"/><ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]"/><ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]"/></RootObjectStyleGroup>\n' +
      '</idPkg:Styles>\n' });

    // stories
    var thr = threads(doc), storyIds = [], storyFiles = [];
    var frameSelf = {};
    doc.items.forEach(function (it) { frameSelf[it.id] = "u" + it.id.replace(/[^A-Za-z0-9]/g, ""); });
    var storySelf = {};
    function cellXml(tbl, text, ps, look) {
      var out = "";
      String(text || "").split("\n").forEach(function (t, k, all) {
        out += '<ParagraphStyleRange AppliedParagraphStyle="' + esc(ps) + '"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">' + (t ? '<Content>' + esc(t) + '</Content>' : "") + (k < all.length - 1 ? '<Br/>' : "") + '</CharacterStyleRange></ParagraphStyleRange>';
      });
      return out;
    }
    function tableXml(para, width) {
      var tb = TB.norm(para.ext.tbl);
      if (!tb) return "";
      var C = tb.cols.length, sum = tb.cols.reduce(function (a, b) { return a + b; }, 0), id = U("t");
      var hdr = Math.min(tb.hdr || 0, tb.rows.length), ps = psRef[tb.cps] || psRef[para.ps] || psRef["ps-base"], hps = psRef[tb.hps] || ps;
      var out = '<Table Self="' + id + '" HeaderRowCount="' + hdr + '" FooterRowCount="0" BodyRowCount="' + (tb.rows.length - hdr) + '" ColumnCount="' + C + '" AppliedTableStyle="TableStyle/$ID/[Basic Table]" TableDirection="LeftToRightDirection">';
      tb.rows.forEach(function (r, i) { out += '<Row Self="' + id + 'Row' + i + '" Name="' + i + '" SingleRowHeight="' + n4(Math.max(r.h || 0, 12)) + '" MinimumHeight="' + n4(r.h || 3) + '" AutoGrow="true"/>'; });
      tb.cols.forEach(function (c, j) { out += '<Column Self="' + id + 'Column' + j + '" Name="' + j + '" SingleColumnWidth="' + n4(width * c / sum) + '"/>'; });
      tb.rows.forEach(function (r, i) {
        r.c.forEach(function (c, j) {
          if (c.x) return;
          var fill = c.f || (i < hdr ? tb.hf : "");
          out += '<Cell Self="' + id + 'i' + j + 'i' + i + '" Name="' + j + ':' + i + '" RowSpan="' + (c.r || 1) + '" ColumnSpan="' + (c.s || 1) + '" AppliedCellStyle="CellStyle/$ID/[None]"' +
            (fill ? ' FillColor="' + esc(col(fill)) + '"' : "") + ' TopInset="' + n4(tb.pad) + '" BottomInset="' + n4(tb.pad) + '" LeftInset="' + n4(tb.pad) + '" RightInset="' + n4(tb.pad) + '"' +
            ['Top', 'Bottom', 'Left', 'Right'].map(function (sd) { return ' ' + sd + 'EdgeStrokeWeight="' + n4(tb.bw) + '" ' + sd + 'EdgeStrokeColor="' + esc(col(tb.bc || "sw-black")) + '"'; }).join("") + '>' +
            cellXml(tb, c.t, i < hdr ? hps : ps) + '</Cell>';
        });
      });
      return out + '</Table>';
    }
    Object.keys(thr).forEach(function (sid) {
      var st = M.find(doc.stories, sid);
      if (!st) return;
      var self = U("s");
      storySelf[sid] = self;
      storyIds.push(self);
      stats.stories++;
      var first = thr[sid][0], width = Math.max(10, (first.w - 2 * (first.ins || 0) - (first.cols - 1) * first.gut) / first.cols);
      var body = "";
      st.paras.forEach(function (p, pi) {
        var last = pi === st.paras.length - 1;
        body += '<ParagraphStyleRange AppliedParagraphStyle="' + esc(psRef[p.ps] || psRef["ps-base"]) + '">';
        if (p.ext && p.ext.tbl) {
          body += '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">' + tableXml(p, width) + (last ? "" : '<Br/>') + '</CharacterStyleRange>';
        } else {
          var pl = T.resolvePs(maps.ps, p.ps);
          if (!p.runs.length && !last) body += '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Br/></CharacterStyleRange>';
          p.runs.forEach(function (r, ri) {
            var L = runLook(maps, p, r), a = L.a, at = [];
            at.push('AppliedCharacterStyle="' + esc(r.cs && csRef[r.cs] ? csRef[r.cs] : "CharacterStyle/$ID/[No character style]") + '"');
            var famP = familyName(pl.fam, pl.font, opts), famR = familyName(a.fam, a.font, opts), props = "";
            if (famR !== famP) props = '<Properties><AppliedFont type="string">' + esc(famR) + '</AppliedFont></Properties>';
            if (famR !== famP || a.b !== pl.b || a.i !== pl.i) { at.push('FontStyle="' + faceName(a.b, a.i) + '"'); fontAttrs(null, a); }
            if (r.u) at.push('Underline="true"');
            if (L.sup) at.push('Position="Superscript"');
            var content = "";
            if (r.f === "pn") content = '<Content><?ACE 18?></Content>';
            else if (r.f === "pc") content = '<TextVariableInstance Self="' + U("v") + '" Name="Last Page Number" ResultText="' + doc.pages.length + '" AssociatedTextVariable="dTextVariablenLast Page Number"/>';
            else content = String(r.t).split("\n").map(function (t) { return t ? '<Content>' + esc(t) + '</Content>' : ""; }).join('<Content> </Content>');
            body += '<CharacterStyleRange ' + at.join(" ") + '>' + props + content + (!last && ri === p.runs.length - 1 ? '<Br/>' : "") + '</CharacterStyleRange>';
          });
        }
        body += '</ParagraphStyleRange>';
      });
      storyFiles.push({ name: "Stories/Story_" + self + ".xml", data: HEAD + '<idPkg:Story ' + NS + '>\n<Story Self="' + self + '" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">\n' +
        '<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>\n' +
        '<InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false"/>\n' + body + '\n</Story>\n</idPkg:Story>\n' });
    });

    // objects
    var layer = "uL";
    function pathPts(pts) {
      return '<Properties><PathGeometry>' + pts.map(function (o) {
        return '<GeometryPathType PathOpen="' + (o.open ? "true" : "false") + '"><PathPointArray>' + o.pts.map(function (p) {
          return '<PathPointType Anchor="' + n4(p.a[0]) + ' ' + n4(p.a[1]) + '" LeftDirection="' + n4(p.l[0]) + ' ' + n4(p.l[1]) + '" RightDirection="' + n4(p.r[0]) + ' ' + n4(p.r[1]) + '"/>';
        }).join("") + '</PathPointArray></GeometryPathType>';
      }).join("") + '</PathGeometry></Properties>';
    }
    function boxPts(w, h) {
      var x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2;
      return [{ open: false, pts: [[x0, y0], [x0, y1], [x1, y1], [x1, y0]].map(function (a) { return { a: a, l: a, r: a }; }) }];
    }
    var K = 0.5522847498;
    function ellPts(w, h) {
      var rx = w / 2, ry = h / 2, kx = rx * K, ky = ry * K;
      return [{ open: false, pts: [
        { a: [0, -ry], l: [-kx, -ry], r: [kx, -ry] }, { a: [rx, 0], l: [rx, -ky], r: [rx, ky] },
        { a: [0, ry], l: [kx, ry], r: [-kx, ry] }, { a: [-rx, 0], l: [-rx, ky], r: [-rx, -ky] }] }];
    }
    // a path item's outline in local coordinates (centred)
    function dPts(d, w, h) {
      var cmds = M.parsePath ? M.parsePath(d) : null, out = [], cur = null;
      if (!cmds) return boxPts(w, h);
      function P(x, y) { return [x * w - w / 2, y * h - h / 2]; }
      cmds.forEach(function (c) {
        if (c[0] === "M") { cur = { open: true, pts: [] }; out.push(cur); var a = P(c[1], c[2]); cur.pts.push({ a: a, l: a, r: a }); }
        else if (c[0] === "L") { var b = P(c[1], c[2]); cur.pts.push({ a: b, l: b, r: b }); }
        else if (c[0] === "C") { var prev = cur.pts[cur.pts.length - 1], e = P(c[5], c[6]); prev.r = P(c[1], c[2]); cur.pts.push({ a: e, l: P(c[3], c[4]), r: e }); }
        else if (c[0] === "Z") {
          cur.open = false;
          var f = cur.pts[0], l = cur.pts[cur.pts.length - 1];
          if (cur.pts.length > 1 && Math.abs(f.a[0] - l.a[0]) < 1e-6 && Math.abs(f.a[1] - l.a[1]) < 1e-6) { f.l = l.l; cur.pts.pop(); }
        }
      });
      return out.filter(function (o) { return o.pts.length > 1; });
    }
    function common(it, out) {
      var a = [];
      a.push('ItemLayer="' + layer + '"');
      if (it.lock) a.push('Locked="true"');
      if (it.hide) a.push('Visible="false"');
      a.push('FillColor="' + esc(it.t === "line" ? "Swatch/None" : col(it.fill || (it.gr && it.gr.st[0][1]) || "")) + '"');
      a.push('StrokeColor="' + esc(it.stroke && it.sw > 0 ? col(it.stroke) : "Swatch/None") + '"');
      a.push('StrokeWeight="' + n4(it.stroke ? it.sw : 0) + '"');
      if (it.dash) a.push('StrokeType="StrokeStyle/$ID/Dashed"');
      if (it.r > 0 && (it.t === "rect" || it.t === "img" || it.t === "text")) a.push('CornerOption="RoundedCorner" CornerRadius="' + n4(it.r) + '"');
      var fx = fxOf(it), sub = "";
      if (it.op < 100 || (fx && (fx.bm || fx.sh || fx.gl || fx.fe))) {
        sub += '<TransparencySetting><BlendingSetting BlendMode="' + (fx && fx.bm ? BLEND[fx.bm] : "Normal") + '" Opacity="' + it.op + '"/>' +
          (fx && fx.sh ? '<DropShadowSetting Mode="Drop" BlendMode="Multiply" Opacity="' + fx.sh.o + '" Size="' + n4(fx.sh.b) + '" XOffset="' + n4(fx.sh.x) + '" YOffset="' + n4(fx.sh.y) + '" EffectColor="' + esc(col(fx.sh.c || "sw-black")) + '" UseGlobalLight="false" Distance="' + n4(Math.hypot(fx.sh.x, fx.sh.y)) + '" Angle="' + n4(Math.atan2(-fx.sh.y, -fx.sh.x) * 180 / Math.PI) + '"/>' : "") +
          (fx && fx.gl ? '<OuterGlowSetting Applied="true" BlendMode="Screen" Opacity="' + fx.gl.o + '" Size="' + n4(fx.gl.b) + '" EffectColor="' + esc(col(fx.gl.c || "sw-black")) + '"/>' : "") +
          (fx && fx.fe ? '<FeatherSetting Mode="Standard" Width="' + n4(fx.fe) + '" CornerType="Diffusion"/>' : "") +
          '</TransparencySetting>';
      }
      if (it.wrap && it.wrap !== "none") sub += '<TextWrapPreference TextWrapMode="' + (it.wrap === "ell" ? "Contour" : "BoundingBoxTextWrap") + '"><Properties><TextWrapOffset Top="' + n4(it.wo) + '" Left="' + n4(it.wo) + '" Bottom="' + n4(it.wo) + '" Right="' + n4(it.wo) + '"/></Properties></TextWrapPreference>';
      out.a = a; out.sub = sub;
    }
    function transform(it, P, ph) {
      var r = (it.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      return [c, s, -s, c, P.ox + it.x + it.w / 2, -ph / 2 + it.y + it.h / 2].map(n4).join(" ");
    }
    function picture(it) {
      var im = opts.images && opts.images[it.a], name = (im && im.name) || it.nm || it.a || "picture";
      if (!it.a || !(it.iw > 0)) return "";
      var rr = R.imageRect(it), fl = R.flipOf(it), sx = rr.w / it.iw, sy = rr.h / it.ih;
      var tx = -it.w / 2 + rr.x, ty = -it.h / 2 + rr.y;
      if (fl.h) { sx = -sx; tx += rr.w; }
      if (fl.v) { sy = -sy; ty += rr.h; }
      var uri = "file:" + (opts.links || "Links/") + encodeURIComponent(name);
      return '<Image Self="' + U("i") + '" ItemTransform="' + [sx, 0, 0, sy, tx, ty].map(n4).join(" ") + '" ImageTypeName="$ID/' + (/png$/i.test(it.a) ? "PNG" : "JPEG") + '" ActualPpi="72 72" EffectivePpi="' + n4(72 / Math.abs(sx)) + ' ' + n4(72 / Math.abs(sy)) + '">' +
        '<Properties><Profile type="string">$ID/Embedded</Profile><GraphicBounds Left="0" Top="0" Right="' + it.iw + '" Bottom="' + it.ih + '"/>' + (im && im.b64 ? '<Contents><![CDATA[' + im.b64 + ']]></Contents>' : "") + '</Properties>' +
        '<Link Self="' + U("l") + '" LinkResourceURI="' + esc(uri) + '" StoredState="' + (im && im.b64 ? "Embedded" : "Normal") + '" LinkResourceFormat="$ID/' + (/png$/i.test(it.a) ? "PNG" : "JPEG") + '"/></Image>';
    }
    function itemXml(it, P, ph) {
      var o = {};
      common(it, o);
      stats.items++;
      var self = frameSelf[it.id], tr = transform(it, P, ph);
      if (it.t === "line") {
        var x0 = it.x, y0 = it.y, x1 = it.x + it.w, y1 = it.y + it.h;
        o.a[1] = 'FillColor="Swatch/None"';
        return '<GraphicLine Self="' + self + '" ' + o.a.join(" ") + ' ItemTransform="1 0 0 1 ' + n4(P.ox) + ' ' + n4(-ph / 2) + '">' +
          pathPts([{ open: true, pts: [[x0, y0], [x1, y1]].map(function (a) { return { a: a, l: a, r: a }; }) }]) + o.sub + '</GraphicLine>';
      }
      if (it.t === "text") {
        var fr = thr[it.story] || [it], k = fr.indexOf(it), prev = k > 0 ? frameSelf[fr[k - 1].id] : "n", next = k >= 0 && k < fr.length - 1 ? frameSelf[fr[k + 1].id] : "n";
        return '<TextFrame Self="' + self + '" ParentStory="' + (storySelf[it.story] || "n") + '" PreviousTextFrame="' + prev + '" NextTextFrame="' + next + '" ContentType="TextType" ' + o.a.join(" ") + ' ItemTransform="' + tr + '">' +
          pathPts(boxPts(it.w, it.h)) + '<TextFramePreference TextColumnCount="' + it.cols + '" TextColumnGutter="' + n4(it.gut) + '" InsetSpacing="' + n4(it.ins || 0) + '" VerticalJustification="' + (it.va === "c" ? "CenterAlign" : it.va === "b" ? "BottomAlign" : "TopAlign") + '"/>' + o.sub + '</TextFrame>';
      }
      if (it.t === "ell") return '<Oval Self="' + self + '" ContentType="GraphicType" ' + o.a.join(" ") + ' ItemTransform="' + tr + '">' + pathPts(ellPts(it.w, it.h)) + o.sub + '</Oval>';
      if (it.t === "path") return '<Polygon Self="' + self + '" ContentType="GraphicType" ' + o.a.join(" ") + ' ItemTransform="' + tr + '">' + pathPts(dPts(it.d, it.w, it.h)) + o.sub + '</Polygon>';
      var pic = it.t === "img" ? picture(it) : "";
      return '<Rectangle Self="' + self + '" ContentType="' + (it.t === "img" ? "GraphicType" : "Unassigned") + '" ' + o.a.join(" ") + ' ItemTransform="' + tr + '">' + pathPts(boxPts(it.w, it.h)) + o.sub + pic + '</Rectangle>';
    }
    // a page's items, groups kept (a group is its members, in order)
    function pageItems(list, P, ph) {
      var out = "", done = {};
      list.forEach(function (it) {
        if (done[it.id]) return;
        if (it.grp) {
          var g = list.filter(function (o) { return o.grp === it.grp; });
          if (g.length > 1) {
            g.forEach(function (o) { done[o.id] = 1; });
            out += '<Group Self="' + U("g") + '" ItemLayer="' + layer + '" ItemTransform="1 0 0 1 0 0">' + g.map(function (o) { return itemXml(o, P, ph); }).join("") + '</Group>\n';
            return;
          }
        }
        out += itemXml(it, P, ph) + "\n";
      });
      return out;
    }
    var s = doc.setup, w = s.w, h = s.h, bl = M.bleeds(doc, "R");
    function pageXml(self, P, name, ms) {
      var mg = M.margins(doc, P.side === "L" ? "L" : "R"), sz = P.p.ext && P.p.ext.sz ? M.pageSize(doc, P.p) : { w: w, h: h };
      return '<Page Self="' + self + '" Name="' + esc(name) + '" AppliedMaster="' + (ms || "n") + '" GeometricBounds="0 0 ' + n4(sz.h) + ' ' + n4(sz.w) + '" ItemTransform="1 0 0 1 ' + n4(P.ox) + ' ' + n4(-h / 2) + '" MasterPageTransform="1 0 0 1 0 0" OverrideList="" TabOrder="" GridStartingPoint="TopOutside" UseMasterGrid="true">' +
        '<Properties><PageColor type="enumeration">UseMasterColor</PageColor></Properties>' +
        '<MarginPreference ColumnCount="' + s.cols + '" ColumnGutter="' + n4(s.gut) + '" Top="' + n4(mg.t) + '" Bottom="' + n4(mg.b) + '" Left="' + n4(mg.l) + '" Right="' + n4(mg.r) + '" ColumnDirection="Horizontal" ColumnsPositions="0 ' + n4(sz.w - mg.l - mg.r) + '"/></Page>\n';
    }
    // masters
    var msSelf = {}, msFiles = [], pageNames = M.pageLabels ? M.pageLabels(doc) : null;
    doc.masters.forEach(function (ms) {
      var self = U("m"), pre = ms.pre || "A", base = nameOf(ms.name, lang).replace(/^[A-Z]{1,3}-/, "") || "Master";
      msSelf[ms.id] = self;
      var Ps = masterPages(doc, ms), body = "";
      Ps.forEach(function (P, k) { body += pageXml(self + "p" + k, P, pre, ""); });
      Ps.forEach(function (P) { body += pageItems(itemsOf(doc, P, true), P, h); });
      msFiles.push({ name: "MasterSpreads/MasterSpread_" + self + ".xml", data: HEAD + '<idPkg:MasterSpread ' + NS + '>\n<MasterSpread Self="' + self + '" Name="' + esc(pre + "-" + base) + '" NamePrefix="' + esc(pre) + '" BaseName="' + esc(base) + '" ShowMasterItems="true" PageCount="' + Ps.length + '" OverriddenPageItemProps="" PrimaryTextFrame="n" ItemTransform="1 0 0 1 0 0">\n' + body + '</MasterSpread>\n</idPkg:MasterSpread>\n' });
    });
    // spreads
    var spFiles = [], firstPage = "";
    spreadList(doc).forEach(function (sp) {
      var self = U("p"), body = "";
      sp.forEach(function (P) {
        var ps = self + "p" + P.idx;
        if (!firstPage) firstPage = ps;
        body += pageXml(ps, P, pageNames && pageNames[P.idx] ? String(pageNames[P.idx]) : String(P.idx + 1), msSelf[P.p.ms]);
      });
      sp.forEach(function (P) { body += pageItems(itemsOf(doc, P, false), P, h); });
      var lefts = sp.filter(function (P) { return P.side === "L"; }).length;
      spFiles.push({ name: "Spreads/Spread_" + self + ".xml", data: HEAD + '<idPkg:Spread ' + NS + '>\n<Spread Self="' + self + '" PageCount="' + sp.length + '" BindingLocation="' + (s.facing ? lefts : 0) + '" AllowPageShuffle="true" ItemTransform="1 0 0 1 0 0" ShowMasterItems="true" PageTransitionType="None">\n' + body + '</Spread>\n</idPkg:Spread>\n' });
    });

    // preferences
    var unit = s.unit === "mm" ? "Millimeters" : s.unit === "in" ? "Inches" : "Points";
    files.push({ name: "Resources/Preferences.xml", data: HEAD + '<idPkg:Preferences ' + NS + '>\n' +
      '<DocumentPreference PageHeight="' + n4(h) + '" PageWidth="' + n4(w) + '" PagesPerDocument="' + doc.pages.length + '" FacingPages="' + (s.facing ? "true" : "false") + '" DocumentBleedTopOffset="' + n4(bl.t) + '" DocumentBleedBottomOffset="' + n4(bl.b) + '" DocumentBleedInsideOrLeftOffset="' + n4(bl.i) + '" DocumentBleedOutsideOrRightOffset="' + n4(bl.o) + '" DocumentBleedUniformSize="' + (bl.t === bl.b && bl.b === bl.i && bl.i === bl.o ? "true" : "false") + '" SlugTopOffset="' + n4(M.slugOf(doc)) + '" SlugBottomOffset="' + n4(M.slugOf(doc)) + '" SlugInsideOrLeftOffset="' + n4(M.slugOf(doc)) + '" SlugRightOrOutsideOffset="' + n4(M.slugOf(doc)) + '" PageBinding="LeftToRight" Intent="PrintIntent" ColumnDirection="Horizontal"/>\n' +
      '<MarginPreference ColumnCount="' + s.cols + '" ColumnGutter="' + n4(s.gut) + '" Top="' + n4(s.mt) + '" Bottom="' + n4(s.mb) + '" Left="' + n4(s.mi) + '" Right="' + n4(s.mo) + '" ColumnDirection="Horizontal" ColumnsPositions="0 ' + n4(w - s.mi - s.mo) + '"/>\n' +
      '<ViewPreference HorizontalMeasurementUnits="' + unit + '" VerticalMeasurementUnits="' + unit + '" RulerOrigin="SpreadOrigin"/>\n' +
      '<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>\n' +
      '</idPkg:Preferences>\n' });
    // fonts
    files.push({ name: "Resources/Fonts.xml", data: HEAD + '<idPkg:Fonts ' + NS + '>\n' + Object.keys(fams).sort().map(function (f, k) {
      return '<FontFamily Self="di' + k + '" Name="' + esc(f) + '">' + Object.keys(fams[f]).sort().map(function (st, j) {
        return '<Font Self="di' + k + 'f' + j + '" FontFamily="' + esc(f) + '" Name="' + esc(f + " " + st) + '" PostScriptName="' + esc((f + "-" + st).replace(/\s+/g, "")) + '" Status="NotAvailable" FontStyleName="' + esc(st) + '" FontType="OpenTypeTT"/>';
      }).join("") + '</FontFamily>';
    }).join("\n") + '\n</idPkg:Fonts>\n' });

    var dm = HEAD + '<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="13.0(166)" ?>\n' +
      '<Document ' + NS + ' Self="d" StoryList="' + storyIds.join(" ") + '" Name="' + esc((opts.name || "Layout") + ".indd") + '" ZeroPoint="0 0" ActiveLayer="' + layer + '" CMYKProfile="Coated FOGRA39 (ISO 12647-2:2004)" RGBProfile="sRGB IEC61966-2.1" SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" CMYKPolicy="CombinationOfPreserveAndSafeCMYK" AccurateLABSpots="false">\n' +
      '<idPkg:Graphic src="Resources/Graphic.xml"/>\n<idPkg:Fonts src="Resources/Fonts.xml"/>\n<idPkg:Styles src="Resources/Styles.xml"/>\n<idPkg:Preferences src="Resources/Preferences.xml"/>\n' +
      '<TextVariable Self="dTextVariablenLast Page Number" Name="Last Page Number" VariableType="LastPageNumberType"><PageNumberVariablePreference Format="Current" TextBefore="" TextAfter="" Scope="EntireDocument"/></TextVariable>\n' +
      '<Layer Self="' + layer + '" Name="Layer 1" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"/>\n' +
      msFiles.map(function (f) { return '<idPkg:MasterSpread src="' + f.name + '"/>'; }).join("\n") + "\n" +
      spFiles.map(function (f) { return '<idPkg:Spread src="' + f.name + '"/>'; }).join("\n") + "\n" +
      '<Section Self="dS" Length="' + doc.pages.length + '" Name="" PageNumberStyle="Arabic" ContinueNumbering="false" IncludeSectionPrefix="false" PageNumberStart="' + (M.firstNumber ? M.firstNumber(doc) : 1) + '" Marker="" PageStart="' + firstPage + '" SectionPrefix=""/>\n' +
      storyFiles.map(function (f) { return '<idPkg:Story src="' + f.name + '"/>'; }).join("\n") + "\n" +
      '</Document>\n';
    var out = [{ name: "mimetype", data: "application/vnd.adobe.indesign-idml-package" },
      { name: "META-INF/container.xml", data: HEAD + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>\n' },
      { name: "designmap.xml", data: dm }].concat(files, msFiles, spFiles, storyFiles);
    return { files: out, stats: stats };
  }

  // ---------- 3. Scribus ----------
  var SALIGN = { l: 0, c: 1, r: 2, j: 3 };
  // opts: { name, lang, images: { asset: { data (qCompress base64),
  // ext, name } } (inline) | links: "Links/", familyName(fam) }
  // → { xml, stats }
  function sla(doc, opts) {
    opts = opts || {};
    var lang = opts.lang || "en", maps = styleMaps(doc), s = doc.setup, w = s.w, h = s.h, bl = M.bleeds(doc, "R");
    var stats = { pages: doc.pages.length, items: 0, stories: 0 };
    var colName = namer(), colRef = { "": "None", "sw-black": "Black", "sw-paper": "White" };
    colName("Black"); colName("White"); colName("None"); colName("Registration");
    var cols = ['<COLOR NAME="Black" SPACE="CMYK" C="0" M="0" Y="0" K="100"/>', '<COLOR NAME="White" SPACE="CMYK" C="0" M="0" Y="0" K="0"/>', '<COLOR NAME="Registration" SPACE="CMYK" C="100" M="100" Y="100" K="100" Register="1"/>'];
    doc.swatches.forEach(function (sw) {
      if (colRef[sw.id] !== undefined) return;
      var nm = colName(nameOf(sw.name, lang), "Colour");
      colRef[sw.id] = nm;
      cols.push(sw.mode === "cmyk" ? '<COLOR NAME="' + esc(nm) + '" SPACE="CMYK" C="' + n4(sw.v[0]) + '" M="' + n4(sw.v[1]) + '" Y="' + n4(sw.v[2]) + '" K="' + n4(sw.v[3]) + '"/>' : '<COLOR NAME="' + esc(nm) + '" SPACE="RGB" R="' + sw.v[0] + '" G="' + sw.v[1] + '" B="' + sw.v[2] + '"/>');
    });
    function col(id) { return colRef.hasOwnProperty(id || "") ? colRef[id || ""] : "Black"; }
    function font(fam, f, b, i) { return familyName(fam, f, opts) + " " + faceName(b, i); }
    // styles
    var psName = namer(), psRef = {}, csName = namer(), csRef = {};
    psName("Default Paragraph Style"); csName("Default Character Style");
    psRef["ps-base"] = "Default Paragraph Style";
    doc.pstyles.forEach(function (p) { if (p.id !== "ps-base") psRef[p.id] = psName(nameOf(p.name, lang), "Style"); });
    doc.cstyles.forEach(function (c) { csRef[c.id] = csName(nameOf(c.name, lang), "Character"); });
    function psAttrs(p, full) {
      var a = [], r = T.resolvePs(maps.ps, p.id);
      if (full || p.font !== undefined || p.b !== undefined || p.i !== undefined || (p.ext && p.ext.fam)) a.push('FONT="' + esc(font(r.fam, r.font, r.b, r.i)) + '"');
      var src = full ? r : p;
      if (src.size !== undefined) a.push('FONTSIZE="' + n4(src.size) + '"');
      if (src.lead !== undefined) a.push(src.lead > 0 ? 'LINESPMode="0" LINESP="' + n4(src.lead) + '"' : 'LINESPMode="1"');
      if (src.align !== undefined) a.push('ALIGN="' + (SALIGN[src.align] || 0) + '"');
      if (src.sb !== undefined) a.push('VOR="' + n4(src.sb) + '"');
      if (src.sa !== undefined) a.push('NACH="' + n4(src.sa) + '"');
      if (src.fi !== undefined) a.push('FIRST="' + n4(src.fi) + '"');
      if (src.li !== undefined) a.push('INDENT="' + n4(src.li) + '"');
      if (src.ri !== undefined) a.push('RMARGIN="' + n4(src.ri) + '"');
      if (src.color !== undefined) a.push('FCOLOR="' + esc(col(src.color)) + '"');
      var feats = [];
      if (src.u) feats.push("underline");
      if (src.caps) feats.push("allcaps");
      if (src.u !== undefined || src.caps !== undefined) a.push('FEATURES="' + (feats.join(" ") || "inherit") + '"');
      if (src.track !== undefined) a.push('KERN="' + n4(src.track / 10) + '"');
      return a.join(" ");
    }
    function tabsXml(p) {
      var own = p.ext && Array.isArray(p.ext.tabs) ? p.ext.tabs : null;
      return own ? own.map(function (v) { return '<Tabs Type="0" Pos="' + n4(v) + '" Fill=""/>'; }).join("") : "";
    }
    var styles = [];
    doc.pstyles.forEach(function (p) {
      var full = p.id === "ps-base", tb = tabsXml(p), at = psAttrs(p, full);
      styles.push('<STYLE NAME="' + esc(psRef[p.id]) + '"' + (full ? ' DefaultStyle="1"' : ' PARENT="' + esc(psRef[p.base] || "Default Paragraph Style") + '"') + (at ? " " + at : "") + (tb ? ">" + tb + "</STYLE>" : "/>"));
    });
    var cstyles = ['<CHARSTYLE CNAME="Default Character Style" DefaultStyle="1"/>'];
    doc.cstyles.forEach(function (c) {
      var a = [];
      if (c.font !== undefined || (c.ext && c.ext.fam) || c.b !== undefined || c.i !== undefined) a.push('FONT="' + esc(font(c.ext && c.ext.fam, c.font || "serif", c.b, c.i)) + '"');
      if (c.size !== undefined) a.push('FONTSIZE="' + n4(c.size) + '"');
      if (c.color !== undefined) a.push('FCOLOR="' + esc(col(c.color)) + '"');
      if (c.track !== undefined) a.push('KERN="' + n4(c.track / 10) + '"');
      cstyles.push('<CHARSTYLE CNAME="' + esc(csRef[c.id]) + '"' + (c.base && csRef[c.base] ? ' CPARENT="' + esc(csRef[c.base]) + '"' : "") + (a.length ? " " + a.join(" ") : "") + '/>');
    });
    // text
    var thr = threads(doc);
    function storyXml(st, width) {
      var out = "";
      st.paras.forEach(function (p, pi) {
        var pl = T.resolvePs(maps.ps, p.ps);
        var runs = p.runs;
        if (p.ext && p.ext.tbl) {
          var tb = TB.norm(p.ext.tbl);
          if (tb) {
            var sum = tb.cols.reduce(function (a, b) { return a + b; }, 0), acc = 0, stops = [];
            tb.cols.forEach(function (c, j) { if (j) stops.push(acc); acc += width * c / sum; });
            tb.rows.forEach(function (r) {
              r.c.forEach(function (c, j) {
                if (j) out += '<tab/>';
                if (!c.x && c.t) out += '<ITEXT CH="' + esc(c.t.replace(/\n/g, " ")) + '"/>';
              });
              out += '<para PARENT="' + esc(psRef[p.ps] || "Default Paragraph Style") + '">' + stops.map(function (v) { return '<Tabs Type="0" Pos="' + n4(v) + '" Fill=""/>'; }).join("") + '</para>';
            });
            return;
          }
        }
        runs.forEach(function (r) {
          var L = runLook(maps, p, r), a = L.a, at = [];
          if (r.cs && csRef[r.cs]) at.push('CPARENT="' + esc(csRef[r.cs]) + '"');
          if (a.fam !== pl.fam || a.font !== pl.font || a.b !== pl.b || a.i !== pl.i) at.push('FONT="' + esc(font(a.fam, a.font, a.b, a.i)) + '"');
          if (Math.abs(a.size - pl.size) > 0.001 && !L.sup) at.push('FONTSIZE="' + n4(a.size) + '"');
          if (a.color !== pl.color) at.push('FCOLOR="' + esc(col(a.color)) + '"');
          var feats = [];
          if (r.u || a.u) feats.push("underline");
          if (L.sup) feats.push("superscript");
          if (feats.length) at.push('FEATURES="' + feats.join(" ") + '"');
          var ats = at.length ? " " + at.join(" ") : "";
          if (r.f === "pn" || r.f === "pc") { out += '<var name="' + (r.f === "pn" ? "pgno" : "pgco") + '"' + ats + '/>'; return; }
          String(r.t).split(/(\n|\t)/).forEach(function (t) {
            if (t === "\n") out += '<breakline' + ats + '/>';
            else if (t === "\t") out += '<tab' + ats + '/>';
            else if (t) out += '<ITEXT' + ats + ' CH="' + esc(t) + '"/>';
          });
        });
        out += (pi === st.paras.length - 1 ? '<trail' : '<para') + ' PARENT="' + esc(psRef[p.ps] || "Default Paragraph Style") + '"/>';
      });
      return out;
    }
    // pages: Scribus lays pages out on a canvas; one row per spread
    var GAP = 40, pagePos = {}, pagesXml = [], y = GAP;
    spreadList(doc).forEach(function (sp) {
      var x0 = GAP + (s.facing ? w : 0);
      sp.forEach(function (P) {
        var px = x0 + P.ox + (s.facing ? 0 : w / 2);
        pagePos[P.p.id] = { x: px, y: y, n: P.idx };
      });
      y += h + GAP;
    });
    // masters (after the pages on the canvas)
    var msName = {}, msPos = {}, mNamer = namer(), mastersXml = [];
    doc.masters.forEach(function (ms) {
      var nm = mNamer(nameOf(ms.name, lang) || "Master", "Master");
      msName[ms.id] = nm;
    });
    spreadList(doc).forEach(function (sp) {
      sp.forEach(function (P) {
        var pp = pagePos[P.p.id], mg = M.margins(doc, P.side), ms = P.p.ms && M.find(doc.masters, P.p.ms);
        pagesXml.push('<PAGE PAGEXPOS="' + n4(pp.x) + '" PAGEYPOS="' + n4(pp.y) + '" PAGEWIDTH="' + n4(w) + '" PAGEHEIGHT="' + n4(h) + '" BORDERLEFT="' + n4(mg.l) + '" BORDERRIGHT="' + n4(mg.r) + '" BORDERTOP="' + n4(mg.t) + '" BORDERBOTTOM="' + n4(mg.b) + '" NUM="' + P.idx + '" NAM="" MNAM="' + esc(ms ? msName[ms.id] + (s.facing ? (P.side === "L" ? " L" : " R") : "") : "") + '" Size="Custom" Orientation="0" LEFT="' + (P.side === "L" && s.facing ? 1 : 0) + '" PRESET="0" HorizontalGuides="" VerticalGuides=""/>');
      });
    });
    var mi = 0;
    doc.masters.forEach(function (ms) {
      masterPages(doc, ms).forEach(function (P) {
        var nm = msName[ms.id] + (s.facing ? (P.side === "L" ? " L" : " R") : ""), mg = M.margins(doc, P.side || "R");
        var px = GAP + (s.facing && P.side === "R" ? w : 0), py = y + GAP * 2 + (mi >> (s.facing ? 1 : 0)) * (h + GAP);
        msPos[ms.id + (P.side || "")] = { x: px, y: py, n: mi, nm: nm };
        mastersXml.push('<MASTERPAGE PAGEXPOS="' + n4(px) + '" PAGEYPOS="' + n4(py) + '" PAGEWIDTH="' + n4(w) + '" PAGEHEIGHT="' + n4(h) + '" BORDERLEFT="' + n4(mg.l) + '" BORDERRIGHT="' + n4(mg.r) + '" BORDERTOP="' + n4(mg.t) + '" BORDERBOTTOM="' + n4(mg.b) + '" NUM="' + mi + '" NAM="' + esc(nm) + '" MNAM="" Size="Custom" Orientation="0" LEFT="' + (P.side === "L" ? 1 : 0) + '" PRESET="0" HorizontalGuides="" VerticalGuides=""/>');
        mi++;
      });
    });
    // objects
    var itemIdOf = {}, nextId = 1;
    doc.items.forEach(function (it) { itemIdOf[it.id] = 100000 + nextId++; });
    function objXml(it, own, tag, extra) {
      stats.items++;
      var a = [], fx = fxOf(it);
      // Scribus rotates about the top-left corner
      var r = (it.rot || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
      var cx = it.x + it.w / 2, cy = it.y + it.h / 2, x0 = cx - (it.w / 2) * c + (it.h / 2) * sn, y0 = cy - (it.w / 2) * sn - (it.h / 2) * c;
      var typ = it.t === "text" ? 4 : it.t === "img" ? 2 : it.t === "line" ? 5 : 6;
      var X = own.x + x0, Y = own.y + y0, W = it.w, H = it.h, ROT = it.rot || 0;
      if (it.t === "line") { X = own.x + it.x; Y = own.y + it.y; W = Math.hypot(it.w, it.h); H = 1; ROT = Math.atan2(it.h, it.w) * 180 / Math.PI; }
      a.push('ItemID="' + itemIdOf[it.id] + '"', 'PTYPE="' + typ + '"', 'XPOS="' + n4(X) + '"', 'YPOS="' + n4(Y) + '"', 'WIDTH="' + n4(W) + '"', 'HEIGHT="' + n4(H) + '"', 'ROT="' + n4(ROT) + '"');
      a.push(own.master ? 'OnMasterPage="' + esc(own.nm) + '"' : 'OwnPage="' + own.n + '"');
      a.push('PCOLOR="' + esc(it.t === "line" ? "None" : col(it.fill || (it.gr && it.gr.st[0][1]) || "")) + '"', 'PCOLOR2="' + esc(it.stroke && it.sw > 0 ? col(it.stroke) : "None") + '"', 'PWIDTH="' + n4(it.stroke ? it.sw : 0) + '"');
      if (it.op < 100) a.push('TransValue="' + n4(1 - it.op / 100) + '"');
      if (fx && fx.bm) a.push('TransBlend="' + ({ darken: 1, lighten: 2, multiply: 3, screen: 4, overlay: 5 })[fx.bm] + '"');
      if (it.lock) a.push('LOCK="1"');
      if (it.dash) a.push('PLINEART="2"');
      if (it.wrap && it.wrap !== "none") a.push('TEXTFLOWMODE="' + (it.wrap === "ell" ? 2 : 1) + '"');
      a.push('FRTYPE="' + (it.t === "ell" ? 1 : it.r > 0 && it.t === "rect" ? 2 : it.t === "path" ? 3 : 0) + '"');
      if (it.r > 0 && it.t === "rect") a.push('RADRECT="' + n4(it.r) + '"');
      if (it.t === "ell" || it.t === "path") a.push('path="' + esc(svgD(it)) + '"');
      if (it.t === "path" && !it.eo) a.push('fillRule="0"');
      return '<' + tag + ' ' + a.concat(extra || []).join(" ") + (it._body ? '>' + it._body + '</' + tag + '>' : '/>');
    }
    function svgD(it) {
      var w2 = it.w, h2 = it.h;
      if (it.t === "ell") {
        var K2 = 0.5522847498, rx = w2 / 2, ry = h2 / 2;
        return "M" + n4(w2) + " " + n4(ry) + " C" + n4(w2) + " " + n4(ry + ry * K2) + " " + n4(rx + rx * K2) + " " + n4(h2) + " " + n4(rx) + " " + n4(h2) +
          " C" + n4(rx - rx * K2) + " " + n4(h2) + " 0 " + n4(ry + ry * K2) + " 0 " + n4(ry) + " C0 " + n4(ry - ry * K2) + " " + n4(rx - rx * K2) + " 0 " + n4(rx) + " 0" +
          " C" + n4(rx + rx * K2) + " 0 " + n4(w2) + " " + n4(ry - ry * K2) + " " + n4(w2) + " " + n4(ry) + " Z";
      }
      var cmds = M.parsePath(it.d) || [];
      return cmds.map(function (c) {
        if (c[0] === "Z") return "Z";
        var v = c.slice(1).map(function (q, k) { return n4(q * (k % 2 ? h2 : w2)); });
        return c[0] + v.join(" ");
      }).join(" ");
    }
    var objs = [];
    function withText(it) {
      var fr = thr[it.story] || [it], k = fr.map(function (o) { return o.id; }).indexOf(it.id), extra = [];
      extra.push('COLUMNS="' + it.cols + '"', 'COLGAP="' + n4(it.gut) + '"', 'EXTRA="' + n4(it.ins || 0) + '"', 'TEXTRA="' + n4(it.ins || 0) + '"', 'BEXTRA="' + n4(it.ins || 0) + '"', 'REXTRA="' + n4(it.ins || 0) + '"', 'VAlign="' + (it.va === "c" ? 1 : it.va === "b" ? 2 : 0) + '"');
      extra.push('NEXTITEM="' + (k >= 0 && k < fr.length - 1 ? itemIdOf[fr[k + 1].id] : -1) + '"', 'BACKITEM="' + (k > 0 ? itemIdOf[fr[k - 1].id] : -1) + '"');
      if (k === 0) {
        var st = M.find(doc.stories, it.story);
        if (st) { stats.stories++; it._body = '<StoryText><DefaultStyle/>' + storyXml(st, Math.max(10, (it.w - 2 * (it.ins || 0) - (it.cols - 1) * it.gut) / it.cols)) + '</StoryText>'; }
      }
      return extra;
    }
    function withPicture(it) {
      var im = opts.images && opts.images[it.a], extra = [], name = (im && im.name) || it.nm || it.a || "picture";
      if (!it.a || !(it.iw > 0)) return extra;
      var rr = R.imageRect(it), sx = rr.w / it.iw, sy = rr.h / it.ih, fl = R.flipOf(it);
      extra.push('SCALETYPE="0"', 'RATIO="1"', 'LOCALSCX="' + n4(sx) + '"', 'LOCALSCY="' + n4(sy) + '"', 'LOCALX="' + n4(rr.x / sx) + '"', 'LOCALY="' + n4(rr.y / sy) + '"');
      if (fl.h) extra.push('FLIPPEDH="1"');
      if (fl.v) extra.push('FLIPPEDV="1"');
      if (im && im.data) extra.push('isInlineImage="1"', 'inlineImageExt="' + (/png$/i.test(it.a) ? "png" : "jpg") + '"', 'ImageData="' + im.data + '"', 'PFILE=""');
      else extra.push('PFILE="' + esc((opts.links || "Links/") + name) + '"');
      return extra;
    }
    function emit(list, own, tag) {
      list.forEach(function (it) {
        var extra = it.t === "text" ? withText(it) : it.t === "img" ? withPicture(it) : [];
        objs.push(objXml(it, own, tag, extra));
        delete it._body;
      });
    }
    var work = JSON.parse(JSON.stringify(doc.items));
    // masters first (Scribus lists them as MASTEROBJECT)
    doc.masters.forEach(function (ms) {
      masterPages(doc, ms).forEach(function (P) {
        var pos = msPos[ms.id + (P.side || "")];
        emit(itemsOf({ items: work }, P, true), { x: pos.x, y: pos.y, master: true, nm: pos.nm }, "MASTEROBJECT");
      });
    });
    spreadList(doc).forEach(function (sp) {
      sp.forEach(function (P) {
        var pp = pagePos[P.p.id];
        emit(itemsOf({ items: work }, P, false), { x: pp.x, y: pp.y, n: pp.n }, "PAGEOBJECT");
      });
    });
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<SCRIBUSUTF8NEW Version="1.6.1">\n<DOCUMENT ANZPAGES="' + doc.pages.length + '" PAGEWIDTH="' + n4(w) + '" PAGEHEIGHT="' + n4(h) + '" BORDERLEFT="' + n4(s.mi) + '" BORDERRIGHT="' + n4(s.mo) + '" BORDERTOP="' + n4(s.mt) + '" BORDERBOTTOM="' + n4(s.mb) + '" PRESET="0" ORIENTATION="0" PAGESIZE="Custom" FIRSTNUM="' + (M.firstNumber ? M.firstNumber(doc) : 1) + '" BOOK="' + (s.facing ? 1 : 0) + '" AUTOSPALTEN="' + s.cols + '" ABSTSPALTEN="' + n4(s.gut) + '" UNITS="' + (s.unit === "mm" ? 1 : s.unit === "in" ? 2 : 0) + '" DFONT="' + esc(familyName("", "serif", opts) + " Regular") + '" DSIZE="11" BleedTop="' + n4(bl.t) + '" BleedLeft="' + n4(bl.i) + '" BleedRight="' + n4(bl.o) + '" BleedBottom="' + n4(bl.b) + '" TITLE="' + esc(opts.name || "") + '" AUTHOR="" COMMENTS="" KEYWORDS="" PUBLISHER="" DOCDATE="" DOCTYPE="" DOCFORMAT="" DOCIDENT="" DOCSOURCE="" DOCLANGINFO="' + esc(lang) + '" DOCRELATION="" DOCCOVER="" DOCRIGHTS="" DOCCONTRIB="" ALAYER="0" LANGUAGE="' + esc(lang) + '" AutoSave="0" ScratchBottom="20" ScratchLeft="100" ScratchRight="100" ScratchTop="20" GapHorizontal="0" GapVertical="40">\n' +
      '<CheckProfile Name="PDF/X-4" ignoreErrors="0" autoCheck="1" checkGlyphs="1" checkOrphans="1" checkOverflow="1" checkPictures="1" checkPartFilledImageFrames="0" checkResolution="1" checkTransparency="0" minResolution="144" maxResolution="2400" checkAnnotations="0" checkRasterPDF="1" checkForGIF="1" ignoreOffLayers="0" checkNotCMYKOrSpot="0" checkDeviceColorsAndOutputIntent="0" checkFontNotEmbedded="0" checkFontIsOpenType="0" checkAppliedMasterDifferentSide="1" checkEmptyTextFrames="1"/>\n' +
      cols.join("\n") + "\n" + cstyles.join("\n") + "\n" + styles.join("\n") + "\n" +
      '<LAYERS NUMMER="0" LEVEL="0" NAME="Background" SICHTBAR="1" DRUCKEN="1" EDIT="1" SELECT="0" FLOW="1" TRANS="1" BLEND="0" OUTL="0" LAYERC="#000000"/>\n' +
      mastersXml.join("\n") + "\n" + pagesXml.join("\n") + "\n" + objs.join("\n") + '\n</DOCUMENT>\n</SCRIBUSUTF8NEW>\n';
    return { xml: xml, stats: stats };
  }

  // ---------- 4. Package (LY-W15, item 36) ----------
  // A file name for every picture: its own name (no folders), the
  // picture's type as the extension, "name (2).jpg" when two pictures
  // share a name. → { asset: name }
  function linkNames(doc) {
    var out = {}, used = {};
    doc.items.forEach(function (it) {
      if (it.t !== "img" || !it.a || out[it.a]) return;
      var ext = /\.png$/i.test(it.a) ? ".png" : ".jpg";
      var b = String(it.nm || "").split(/[\\\/]/).pop().replace(/[\u0000-\u001f:*?"<>|]+/g, " ").replace(/\.(jpe?g|png|gif|webp|tiff?|bmp|psd|heic)$/i, "").trim().slice(0, 80) || it.a.slice(0, 12);
      var n = b + ext, k = 2;
      while (used[n.toLowerCase()]) n = b + " (" + k++ + ")" + ext;
      used[n.toLowerCase()] = 1;
      out[it.a] = n;
    });
    return out;
  }
  // The faces the text uses: [{ fam (id or ""), font, b, i, key }]
  function facesUsed(doc) {
    var maps = styleMaps(doc), seen = {}, out = [];
    function add(a) {
      var k = (a.fam || a.font) + "-" + (a.b ? 1 : 0) + (a.i ? 1 : 0);
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ fam: a.fam || "", font: a.font, b: a.b ? 1 : 0, i: a.i ? 1 : 0, key: T.fontKey(a.font, a.b, a.i) });
    }
    var placed = {};
    doc.items.forEach(function (it) { if (it.t === "text" && it.story) placed[it.story] = 1; });
    doc.stories.forEach(function (st) {
      if (!placed[st.id]) return;
      st.paras.forEach(function (p) {
        if (!p.runs.length) return;
        p.runs.forEach(function (r) { add(runLook(maps, p, r).a); });
      });
    });
    return out.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  }
  // Report.txt: what the printer needs to know. tr(key, vars) gives
  // the words; facts: { date, pf: [{ pg, code, sev, n, m, id }],
  // links, faces, pdf (file name) }
  function report(doc, tr, facts) {
    var s = doc.setup, mm = function (v) { return Math.round(v * 25.4 / 72 * 10) / 10; }, L = [], bl = M.bleeds(doc, "R");
    var order = M.pagesInOrder(doc), idx = {};
    order.forEach(function (p, i) { idx[p.id] = i + 1; });
    L.push(tr("xo.r.title", { name: doc.name || "" }));
    L.push(tr("xo.r.made", { date: facts.date || "" }));
    L.push("");
    L.push(tr("xo.r.pages", { n: order.length, w: mm(s.w), h: mm(s.h) }));
    L.push(tr("xo.r.bleed", { t: mm(bl.t), b: mm(bl.b), i: mm(bl.i), o: mm(bl.o) }));
    L.push(tr(s.facing ? "xo.r.facing" : "xo.r.single"));
    L.push("");
    L.push(tr("xo.r.colours"));
    doc.swatches.forEach(function (sw) { L.push("  " + nameOf(sw.name, facts.lang) + "  " + (sw.mode === "cmyk" ? "CMYK " : "RGB ") + sw.v.map(n4).join(" ")); });
    L.push("");
    L.push(tr("xo.r.fonts"));
    var byFam = {};
    (facts.faces || []).forEach(function (f) { var n = familyName(f.fam, f.font, facts); (byFam[n] = byFam[n] || []).push(faceName(f.b, f.i)); });
    Object.keys(byFam).sort().forEach(function (n) { L.push("  " + n + ": " + byFam[n].join(", ")); });
    L.push("");
    L.push(tr("xo.r.links"));
    var links = facts.links || {};
    doc.items.filter(function (it) { return it.t === "img" && it.a; }).forEach(function (it) {
      var where = idx[it.pg] ? tr("xo.r.page", { n: idx[it.pg] }) : tr("xo.r.master");
      L.push("  " + (links[it.a] || it.a) + "  " + where + "  " + Math.round(R.effectivePpi(it)) + " ppi");
    });
    L.push("");
    var pf = facts.pf || [];
    L.push(pf.length ? tr("xo.r.pf", { n: pf.length }) : tr("xo.r.pfNone"));
    pf.slice(0, 200).forEach(function (x) { L.push("  " + (idx[x.pg] ? tr("xo.r.page", { n: idx[x.pg] }) : tr("xo.r.master")) + "  " + (x.text || x.code)); });
    L.push("");
    L.push(tr("xo.r.files", { pdf: facts.pdf || "" }));
    return L.join("\r\n") + "\r\n";
  }

  var api = { idml: idml, sla: sla, esc: esc, linkNames: linkNames, facesUsed: facesUsed, report: report };
  if (node) { module.exports = api; return; }
  root.LY_XOUT = api;

  // ---------- 5. Browser: LY.xout ----------
  var LY = root.LY;
  if (!LY) return;
  var t = LY.t, busy = false;
  function famNamer(doc) {
    var F = LY.F, by = {};
    if (F && F.docFonts) F.docFonts(doc).forEach(function (e) { by[e.id] = e.name; });
    return function (fam) { return by[fam] || ""; };
  }
  function b64(u8) {
    var s = "", k = 0x8000;
    for (var i = 0; i < u8.length; i += k) s += String.fromCharCode.apply(null, u8.subarray(i, i + k));
    return btoa(s);
  }
  // Scribus's inline picture: base64 of qCompress (4-byte big-endian
  // length + a zlib stream)
  function qCompress(u8) {
    var cs = new CompressionStream("deflate"), w = cs.writable.getWriter();
    w.write(u8); w.close();
    return new Response(cs.readable).arrayBuffer().then(function (ab) {
      var z = new Uint8Array(ab), out = new Uint8Array(z.length + 4), n = u8.length;
      out[0] = (n >>> 24) & 255; out[1] = (n >>> 16) & 255; out[2] = (n >>> 8) & 255; out[3] = n & 255;
      out.set(z, 4);
      return b64(out);
    });
  }
  // the pictures' bytes: { asset: Uint8Array }
  function pictureBytes(doc) {
    var out = {}, chain = Promise.resolve();
    LY.io.assetIds(doc).forEach(function (id) {
      chain = chain.then(function () { return LY.A.blob(id); }).then(function (b) { return b ? b.arrayBuffer() : null; }).then(function (ab) { if (ab) out[id] = new Uint8Array(ab); });
    });
    return chain.then(function () { return out; });
  }
  function zip() { return LY.io.script("../atelier/zip.js", "AtelierZip"); }
  function enc(s) { return new TextEncoder().encode(s); }
  function current() {
    var doc = LY.doc;
    if (!doc || busy) return null;
    LY.flushStory && LY.flushStory();
    return LY.findDoc ? LY.findDoc(doc.id) || doc : doc;
  }
  function done(p, ok) {
    return p.then(function (r) { busy = false; if (r) LY.toast(ok); }, function (e) {
      busy = false;
      try { console.error("[orOS] layout: export failed", e); } catch (x) {}
      LY.toast(t("xo.fail"));
    });
  }
  function idmlBytes(doc, embed, pics) {
    var names = linkNames(doc), images = {};
    if (embed) Object.keys(pics).forEach(function (id) { images[id] = { b64: b64(pics[id]), name: names[id] }; });
    else Object.keys(names).forEach(function (id) { images[id] = { name: names[id] }; });
    var r = idml(doc, { name: doc.name, lang: LY.LANG, images: images, links: "Links/", familyName: famNamer(doc) });
    return zip().then(function (Z) {
      // mimetype first and stored, as the format asks
      return Z.write(r.files.map(function (f) { return { name: f.name, data: enc(f.data) }; }));
    });
  }
  function exportIdml() {
    var doc = current();
    if (!doc) return;
    busy = true;
    LY.toast(t("exp.working"));
    done(pictureBytes(doc).then(function (pics) { return idmlBytes(doc, true, pics); }).then(function (bytes) {
      return LY.io.saveBlob(new Blob([bytes], { type: "application/vnd.adobe.indesign-idml-package" }), LY.io.fileName(doc, ".idml"), "application/vnd.adobe.indesign-idml-package", "InDesign", ".idml");
    }), t("xo.idmlDone"));
  }
  function slaText(doc, inline, pics) {
    var names = linkNames(doc), images = {}, chain = Promise.resolve();
    Object.keys(names).forEach(function (id) {
      images[id] = { name: names[id] };
      if (inline && pics[id]) chain = chain.then(function () { return qCompress(pics[id]); }).then(function (d) { images[id].data = d; });
    });
    return chain.then(function () { return sla(doc, { name: doc.name, lang: LY.LANG, images: images, links: "Links/", familyName: famNamer(doc) }).xml; });
  }
  function exportSla() {
    var doc = current();
    if (!doc) return;
    busy = true;
    LY.toast(t("exp.working"));
    done(pictureBytes(doc).then(function (pics) { return slaText(doc, true, pics); }).then(function (xml) {
      return LY.io.saveBlob(new Blob([xml], { type: "application/vnd.scribus" }), LY.io.fileName(doc, ".sla"), "application/vnd.scribus", "Scribus", ".sla");
    }), t("xo.slaDone"));
  }
  // Package for print: one .zip with a folder holding the document
  // (.oroslayout), a PDF/X-4 with bleed and marks, the .idml and .sla
  // with their pictures in Links/, the fonts in Fonts/ and Report.txt
  function exportPackage() {
    var doc = current();
    if (!doc) return;
    busy = true;
    LY.toast(t("xo.pkgWorking"));
    var base = LY.io.fileName(doc, ""), dir = base + "/", files = [], pics = null, names = linkNames(doc), faces = facesUsed(doc);
    var pdfName = base + " (PDF-X-4).pdf";
    var p = pictureBytes(doc).then(function (pb) {
      pics = pb;
      Object.keys(names).forEach(function (id) { if (pics[id]) files.push({ name: dir + "Links/" + names[id], data: pics[id] }); });
      return LY.io.bundleBytes(doc);
    }).then(function (bytes) {
      files.push({ name: dir + base + ".oroslayout", data: bytes });
      return LY.io.pdfBlob(doc, { ppi: 300, bleed: true, marks: true });
    }).then(function (blob) {
      return Promise.all([blob.arrayBuffer(), LY.io.script("pdfout.js", "LY_PDFOUT")]);
    }).then(function (r) {
      return r[1].pdfx(doc, new Uint8Array(r[0]), { cmyk: false });
    }).then(function (x) {
      files.push({ name: dir + pdfName, data: x.bytes });
      return idmlBytes(doc, false, pics);
    }).then(function (bytes) {
      files.push({ name: dir + base + ".idml", data: bytes });
      return slaText(doc, false, pics);
    }).then(function (xml) {
      files.push({ name: dir + base + ".sla", data: enc(xml) });
      // the fonts: Noto (built in, OFL) and the user's own files
      var chain = Promise.resolve(), got = {};
      faces.forEach(function (f) {
        var file = f.fam ? null : T.fontFile(f.key);
        if (!file || got[file]) return;
        got[file] = 1;
        chain = chain.then(function () { return fetch("../vendor/noto/" + file); }).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).then(function (ab) { if (ab) files.push({ name: dir + "Fonts/" + file, data: new Uint8Array(ab) }); }, function () {});
      });
      if (faces.some(function (f) { return !f.fam; })) chain = chain.then(function () { return fetch("../vendor/NotoSans-OFL.txt"); }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (tx) { if (tx) files.push({ name: dir + "Fonts/Noto-OFL.txt", data: enc(tx) }); }, function () {});
      (LY.io.fontFiles(doc) || []).forEach(function (name) {
        chain = chain.then(function () { return LY.F.blob(name); }).then(function (b) { return b ? b.arrayBuffer() : null; }).then(function (ab) { if (ab) files.push({ name: dir + "Fonts/" + name, data: new Uint8Array(ab) }); }, function () {});
      });
      return chain;
    }).then(function () {
      var ED = LY.ed, pf = doc === LY.doc && ED && ED.pf ? ED.pf : [];
      pf = pf.map(function (x) {
        var it = M.find(doc.items, x.id);
        return { pg: x.pg, code: x.code, text: x.code === "ppi" && it ? t("pf.ppi", { n: Math.round(R.effectivePpi(it)) }) : x.code === "glyph" ? t("pf.glyph", { c: x.chars || "" }) : t("pf." + x.code, { n: x.n, m: x.m }) };
      });
      var d = new Date(), date = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
      files.push({ name: dir + t("xo.r.file") + ".txt", data: enc(report(doc, t, { date: date, pf: pf, links: names, faces: faces, pdf: pdfName, lang: LY.LANG, familyName: famNamer(doc) })) });
      return zip();
    }).then(function (Z) {
      var bytes = Z.write(files);
      return LY.io.saveBlob(new Blob([bytes], { type: "application/zip" }), base + " - " + t("xo.pkgFile") + ".zip", "application/zip", "ZIP", ".zip");
    });
    done(p, t("xo.pkgDone"));
  }
  LY.xout = { exportIdml: exportIdml, exportSla: exportSla, exportPackage: exportPackage };
})(typeof window !== "undefined" ? window : this);
