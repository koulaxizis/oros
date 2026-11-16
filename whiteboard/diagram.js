// ============================================================
// orOS Whiteboard — diagram.js: draw.io files in and out, and
// Mermaid flowchart text in (wave DG4; pure, no DOM)
// Loaded by app.js when a draw.io file is opened or saved, or Mermaid
// text is pasted, and by commands.js (the Assistant's `mermaid`), and
// by Node in the tests. Exposes window.WhiteboardDiagram or
// module.exports.
//
// Reading is careful with what it is given:
// - the XML is read by a small reader of our own (elements,
//   attributes, text); a DOCTYPE or ENTITY makes the file refused, so
//   nothing is ever fetched or expanded, and no markup reaches the page:
//   labels written as HTML become plain text;
// - at most MAX_FILE characters, MAX_PAGES pages, C.MAX_OBJS... per
//   board (the app's own limit), MAX_NODES Mermaid boxes;
// - compressed pages (base64 + raw deflate + URL encoding, the draw.io
//   default) are inflated by the function the caller gives
//   (DecompressionStream in the browser, zlib in the tests).
// Everything comes out as ordinary Whiteboard objects (DG1 symbols,
// DG2 lines), so nothing new is stored.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var C = node ? require("./core.js") : root.WhiteboardCore;

  var MAX_FILE = 8000000, MAX_PAGES = 20, MAX_OBJS = 2000, MAX_NODES = 500, MAX_EDGES = 1000, MAX_MERMAID = 20000;
  function r2(v) { return Math.round(v * 100) / 100; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ---------- 1. A small XML reader ----------
  var ENT = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'", nbsp: " " };
  function decode(s) {
    return s.indexOf("&") < 0 ? s : s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, function (m, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
      }
      return own(ENT, e) ? ENT[e] : m;
    });
  }
  // → { name, attrs, kids: [element], text } (the root element) or throws.
  function parseXml(src) {
    if (typeof src !== "string") throw new Error("xml");
    if (/<!(DOCTYPE|ENTITY)/i.test(src)) throw new Error("doctype");
    var i = 0, n = src.length, top = { name: "#doc", attrs: {}, kids: [], text: "" }, stack = [top], depth = 0;
    var nameRe = /[A-Za-z_][\w.:-]*/y, attrRe = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;
    while (i < n) {
      var lt = src.indexOf("<", i);
      if (lt < 0) lt = n;
      if (lt > i) stack[stack.length - 1].text += decode(src.slice(i, lt));
      if (lt >= n) break;
      i = lt;
      if (src.startsWith("<!--", i)) { var ce = src.indexOf("-->", i + 4); if (ce < 0) throw new Error("xml"); i = ce + 3; continue; }
      if (src.startsWith("<![CDATA[", i)) { var de = src.indexOf("]]>", i + 9); if (de < 0) throw new Error("xml"); stack[stack.length - 1].text += src.slice(i + 9, de); i = de + 3; continue; }
      if (src.startsWith("<?", i)) { var pe = src.indexOf("?>", i + 2); if (pe < 0) throw new Error("xml"); i = pe + 2; continue; }
      if (src[i + 1] === "/") {
        var ge = src.indexOf(">", i);
        if (ge < 0) throw new Error("xml");
        var nm = src.slice(i + 2, ge).trim();
        if (stack.length < 2 || stack[stack.length - 1].name !== nm) throw new Error("xml");
        stack.pop(); depth--;
        i = ge + 1;
        continue;
      }
      nameRe.lastIndex = i + 1;
      var mm = nameRe.exec(src);
      if (!mm) throw new Error("xml");
      var el = { name: mm[0], attrs: {}, kids: [], text: "" };
      i = nameRe.lastIndex;
      for (;;) {
        attrRe.lastIndex = i;
        var am = attrRe.exec(src);
        if (!am) break;
        el.attrs[am[1]] = decode(am[3] !== undefined ? am[3] : am[4]);
        i = attrRe.lastIndex;
      }
      while (i < n && /\s/.test(src[i])) i++;
      stack[stack.length - 1].kids.push(el);
      if (src[i] === "/" && src[i + 1] === ">") { i += 2; continue; }
      if (src[i] !== ">") throw new Error("xml");
      i++;
      if (++depth > 64) throw new Error("deep");
      stack.push(el);
    }
    if (stack.length !== 1 || !top.kids.length) throw new Error("xml");
    return top.kids[0];
  }
  function kid(e, name) { for (var i = 0; i < e.kids.length; i++) if (e.kids[i].name === name) return e.kids[i]; return null; }
  function all(e, name, out) {
    out = out || [];
    e.kids.forEach(function (k) { if (k.name === name) out.push(k); all(k, name, out); });
    return out;
  }

  // ---------- 2. Styles, colours and labels ----------
  // "rounded=1;shape=cloud;ellipse" → { rounded: "1", shape: "cloud", ellipse: "" }; the
  // first bare word is also kept as base.
  function styleOf(s) {
    var o = {};
    String(s || "").split(";").forEach(function (p) {
      p = p.trim();
      if (!p) return;
      var k = p.indexOf("=");
      if (k < 0) { if (!own(o, "base")) o.base = p; o[p] = ""; }
      else o[p.slice(0, k)] = p.slice(k + 1);
    });
    return o;
  }
  function rgb(h) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h || "").trim());
    if (!m) return null;
    var x = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
  }
  function hsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0;
    if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s: d ? d / (1 - Math.abs(2 * l - 1)) : 0, l: l };
  }
  // The nearest of the board's colours by hue (draw.io's pale fills
  // and their darker lines land on the same one), grays by lightness;
  // strong: dark enough to be a solid fill.
  function nearest(h) {
    var c = rgb(h);
    if (!c) return null;
    var x = hsl(c);
    if (x.s < 0.18 || x.l < 0.1) return { c: x.l < 0.45 ? "ink" : "gray", strong: x.l < 0.6 };
    var best = "blue", bd = Infinity;
    C.COLOR_KEYS.forEach(function (k) {
      if (k === "gray" || k === "ink") return;
      var d = Math.abs(hsl(rgb(C.COLORS[k][0])).h - x.h);
      d = Math.min(d, 360 - d);
      if (d < bd) { bd = d; best = k; }
    });
    return { c: best, strong: x.l < 0.72 };
  }
  function whiteish(h) { var c = rgb(h); return !!c && c[0] > 235 && c[1] > 235 && c[2] > 235; }
  // A label as plain text (draw.io's html=1 labels are HTML).
  function label(v, html) {
    var s = String(v || "");
    if (html) {
      s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li|tr|h[1-6])\s*>/gi, "\n").replace(/<[^>]*>/g, "");
      s = decode(s).replace(/ /g, " ");
    }
    return s.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, C.MAX_TEXT);
  }

  // ---------- 3. draw.io shapes ↔ Whiteboard ----------
  // A vertex style → { k, shp, sym } or null (a frame / text is decided elsewhere).
  var FLOW = { process: "process", decision: "decision", terminator: "terminator", start_1: "terminator", start_2: "connector", data: "data",
    document: "document", "multi-document": "documents", predefined_process: "predefined", manual_input: "manual-input",
    manual_operation: "manual-op", preparation: "preparation", database: "database", stored_data: "database", direct_data: "database",
    delay: "delay", "off-page_reference": "off-page", "on-page_reference": "connector", merge_or_storage: "merge",
    extract_or_measurement: "merge", annotation_1: "comment", annotation_2: "comment" };
  var SHAPE = { parallelogram: "data", document: "document", cylinder: "database", cylinder3: "database", datastore: "database",
    process: "predefined", hexagon: "hexagon", delay: "delay", manualInput: "manual-input", trapezoid: "manual-op",
    offPageConnector: "off-page", umlActor: "actor", note: "comment", folder: "package", component: "component", module: "component",
    cube: "node", cloud: "cloud", callout: "callout", cross: "cross", singleArrow: "arrow-right", doubleArrow: "arrow-both",
    star: "star", octagon: "octagon", doubleEllipse: "end", partialRectangle: "", internalStorage: "", step: "", card: "", tape: "" };
  var NET = [[/server.*(stor|data|db)|(stor|data|db).*server/, "db-server"], [/server|rack|blade|mainframe/, "server"], [/router/, "router"],
    [/switch|hub(?!.*wire)/, "switch"], [/firewall/, "firewall"], [/laptop|notebook/, "laptop"], [/tablet|ipad/, "tablet"],
    [/mobile|phone|iphone|android|smartphone/, "phone"], [/\bpc\b|desktop|workstation|monitor|computer/, "desktop"],
    [/printer/, "printer"], [/wireless|wifi|wi-fi|access_?point|antenna/, "wifi"], [/storage|nas\b|san\b|disk/, "storage"],
    [/internet|globe|world|cloud/, "internet"], [/user|person|people|users/, "user"]];
  function symFor(st) {
    var shape = st.shape || "", lower = shape.toLowerCase();
    if (/^mxgraph\.flowchart\./.test(lower)) {
      var f = lower.slice(18);
      return own(FLOW, f) ? { sym: FLOW[f] } : { simple: 1 };
    }
    if (/^mxgraph\.basic\./.test(lower)) {
      if (/star/.test(lower)) return { sym: "star" };
      if (/octagon/.test(lower)) return { sym: "octagon" };
      if (/cross/.test(lower)) return { sym: "cross" };
      return { simple: 1 };
    }
    if (/^mxgraph\./.test(lower)) {
      var tail = lower.replace(/^mxgraph\.[a-z0-9_]+\./, "");
      for (var i = 0; i < NET.length; i++) if (NET[i][0].test(tail)) return { sym: NET[i][1] };
      return { simple: 1 };
    }
    if (shape) {
      if (own(SHAPE, shape)) return SHAPE[shape] ? { sym: SHAPE[shape] } : { simple: 1 };
      if (shape === "ellipse") return { shp: "ellipse" };
      if (shape === "rhombus") return { shp: "diamond" };
      if (shape === "triangle") return { shp: "tri" };
      if (shape === "rectangle" || shape === "rect") return { shp: st.rounded === "1" ? "round" : "rect" };
      return { simple: 1 };
    }
    if (own(st, "ellipse")) return { shp: "ellipse" };
    if (own(st, "rhombus")) return { shp: "diamond" };
    if (own(st, "triangle")) return { shp: "tri" };
    return { shp: st.rounded === "1" ? "round" : "rect" };
  }
  // The other way: a symbol or basic shape → draw.io style words.
  var OUT = { process: "rounded=0", decision: "rhombus", terminator: "shape=mxgraph.flowchart.terminator", data: "shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1",
    document: "shape=document;boundedLbl=1", documents: "shape=mxgraph.flowchart.multi-document", predefined: "shape=process;backgroundOutline=1",
    "manual-input": "shape=manualInput;size=15", "manual-op": "shape=mxgraph.flowchart.manual_operation", preparation: "shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1",
    database: "shape=cylinder3;boundedLbl=1;size=12", delay: "shape=delay", "off-page": "shape=offPageConnector", connector: "ellipse",
    merge: "triangle;direction=south", person: "rounded=1;arcSize=10", unit: "rounded=0", "class": "rounded=0;align=left;verticalAlign=top;spacingLeft=6",
    "interface": "rounded=0;align=left;verticalAlign=top;spacingLeft=6", actor: "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top",
    usecase: "ellipse", "package": "shape=folder;tabWidth=60;tabHeight=16;tabPosition=left", component: "shape=component;align=left;spacingLeft=36",
    comment: "shape=note;size=16", node: "shape=cube;size=12", start: "ellipse;fillColor=#1f2328", end: "ellipse;shape=doubleEllipse",
    hexagon: "shape=hexagon;perimeter=hexagonPerimeter2", octagon: "shape=mxgraph.basic.octagon2", star: "shape=mxgraph.basic.star",
    cross: "shape=cross", "arrow-right": "shape=singleArrow", "arrow-both": "shape=doubleArrow", cloud: "ellipse;shape=cloud", callout: "shape=callout",
    server: "mxgraph.network.server", router: "mxgraph.network.router", "switch": "mxgraph.network.switch", firewall: "mxgraph.network.firewall",
    internet: "mxgraph.network.cloud", laptop: "mxgraph.network.laptop", desktop: "mxgraph.network.pc", phone: "mxgraph.network.mobile",
    tablet: "mxgraph.network.tablet", "db-server": "shape=cylinder3;boundedLbl=1;size=12", storage: "mxgraph.network.storage",
    user: "mxgraph.network.user_male", printer: "mxgraph.network.printer", wifi: "mxgraph.network.wireless_hub" };
  var BASIC_OUT = { rect: "rounded=0", round: "rounded=1", ellipse: "ellipse", diamond: "rhombus", tri: "triangle;direction=north" };

  // Arrow heads.
  function headIn(name, fill) {
    name = String(name || "");
    if (!name || name === "none") return "none";
    if (/^diamond/.test(name)) return fill === "0" ? "odia" : "dia";
    if (/^(oval|circle|dash)/.test(name)) return "dot";
    if (/^open/.test(name)) return "open";
    if (/^block/.test(name)) return fill === "0" ? "tri" : "arrow";
    if (/^classic|async/.test(name)) return fill === "0" ? "open" : "arrow";
    return "arrow";
  }
  var HEAD_OUT = { arrow: ["classic", 1], open: ["open", 0], tri: ["block", 0], dia: ["diamond", 1], odia: ["diamond", 0], dot: ["oval", 1], none: ["none", 0] };
  var SIDE_IN = function (x, y) { x = +x; y = +y; return y === 0 ? "t" : y === 1 ? "b" : x === 0 ? "l" : x === 1 ? "r" : ""; };
  var SIDE_OUT = { t: [0.5, 0], b: [0.5, 1], l: [0, 0.5], r: [1, 0.5] };

  // ---------- 4. draw.io in ----------
  // text → Promise<{ pages: [{ name, objs }], simplified, skipped, cut }>
  // inflate(Uint8Array) → Promise<string> (raw deflate).
  function b64(s) {
    s = String(s).replace(/\s+/g, "");
    if (typeof atob === "function") { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
    return new Uint8Array(Buffer.from(s, "base64"));
  }
  function readDrawio(text, inflate, newId) {
    return Promise.resolve().then(function () {
      if (typeof text !== "string" || text.length > MAX_FILE) throw new Error("big");
      var x = parseXml(text.replace(/^﻿/, ""));
      // a .drawio.svg keeps the file in its content attribute
      if (x.name === "svg" && x.attrs.content) x = parseXml(x.attrs.content);
      var pages = [];
      if (x.name === "mxfile") pages = x.kids.filter(function (k) { return k.name === "diagram"; });
      else if (x.name === "mxGraphModel") pages = [{ name: "diagram", attrs: {}, kids: [x], text: "" }];
      else throw new Error("notdrawio");
      if (!pages.length) throw new Error("notdrawio");
      pages = pages.slice(0, MAX_PAGES);
      return Promise.all(pages.map(function (pg, k) {
        var model = kid(pg, "mxGraphModel");
        if (model) return { name: pg.attrs.name || "", model: model, k: k };
        var raw = pg.text.trim();
        if (!raw) return null;
        if (typeof inflate !== "function") throw new Error("compressed");
        return inflate(b64(raw)).then(function (s) {
          var t = s;
          try { t = decodeURIComponent(s); } catch (e) { t = s; }
          return { name: pg.attrs.name || "", model: parseXml(t), k: k };
        });
      }));
    }).then(function (list) {
      var out = { pages: [], simplified: 0, skipped: 0, cut: false };
      list.forEach(function (p) {
        if (!p || p.model.name !== "mxGraphModel") return;
        var r = readModel(p.model, newId || C.uid);
        out.simplified += r.simplified; out.skipped += r.skipped; out.cut = out.cut || r.cut;
        out.pages.push({ name: (p.name || "").slice(0, 120), objs: r.objs });
      });
      if (!out.pages.length) throw new Error("empty");
      return out;
    });
  }

  function readModel(model, newId) {
    var rootEl = kid(model, "root"), cells = [], byId = {};
    if (!rootEl) return { objs: [], simplified: 0, skipped: 0, cut: false };
    // mxCell, or UserObject / object wrapping one (its label and id)
    rootEl.kids.forEach(function (e) {
      var cell = e, lab = null, id = e.attrs.id;
      if (e.name === "UserObject" || e.name === "object") { cell = kid(e, "mxCell"); lab = e.attrs.label; if (!cell) return; }
      else if (e.name !== "mxCell") return;
      var c = { id: String(id || cell.attrs.id || ""), parent: cell.attrs.parent || "", value: lab !== null ? lab : (cell.attrs.value || ""),
        st: styleOf(cell.attrs.style), vertex: cell.attrs.vertex === "1", edge: cell.attrs.edge === "1",
        source: cell.attrs.source || "", target: cell.attrs.target || "", geo: kid(cell, "mxGeometry"), kids: [] };
      if (!c.id || own(byId, c.id)) return;
      byId[c.id] = c;
      cells.push(c);
    });
    cells.forEach(function (c) { if (own(byId, c.parent)) byId[c.parent].kids.push(c); });
    function num(v, d) { var n = parseFloat(v); return isFinite(n) && Math.abs(n) < 1e6 ? n : d; }
    // absolute top-left of a vertex (children of groups and lanes are relative)
    var absMemo = {};
    function abs(c, depth) {
      if (own(absMemo, c.id)) return absMemo[c.id];
      var g = c.geo ? c.geo.attrs : {}, x = num(g.x, 0), y = num(g.y, 0);
      var p = byId[c.parent];
      if (p && p.vertex && (depth || 0) < 50) { var pa = abs(p, (depth || 0) + 1); x += pa.x; y += pa.y; }
      return (absMemo[c.id] = { x: x, y: y, w: Math.max(8, num(g.width, 120)), h: Math.max(8, num(g.height, 60)) });
    }
    var objs = [], made = {}, simplified = 0, skipped = 0, cut = false, z = 1, frames = [];
    function html(c) { return c.st.html === "1"; }
    // draw.io's default is a white box with a black line: no fill, ink
    function color(st) {
      var fill = st.fillColor, stroke = st.strokeColor;
      if (!fill || fill === "none" || fill === "default" || whiteish(fill)) {
        var s = nearest(stroke && stroke !== "none" && stroke !== "default" ? stroke : C.COLORS.ink[0]);
        return { c: s ? s.c : "ink", f: "none" };
      }
      var n = nearest(fill);
      return { c: n ? n.c : "blue", f: n && n.strong ? "solid" : "soft" };
    }
    function push(o) {
      if (objs.length >= MAX_OBJS) { cut = true; return false; }
      o.z = z++;
      objs.push(o);
      return true;
    }
    function isClass(c) {
      return own(c.st, "swimlane") && /stackLayout/.test(c.st.childLayout || "") && c.kids.length > 0 && c.kids.every(function (k) { return k.vertex; });
    }
    // vertices
    cells.forEach(function (c) {
      if (!c.vertex) return;
      var p = byId[c.parent];
      if (p && p.edge) return;                                   // an edge's label
      if (p && p.vertex && isClass(p)) return;                    // a row of a UML class
      var st = c.st, a = abs(c), tx = label(c.value, html(c)), o = null;
      if (st.base === "group" || (own(st, "group") && !tx)) return;
      if ((own(st, "swimlane") && !isClass(c)) || (st.container === "1" && c.kids.some(function (k) { return k.vertex; }))) {
        o = { id: newId(), k: "frame", x: a.x, y: a.y, w: a.w, h: a.h, tx: tx.replace(/\n/g, " ").slice(0, 120), c: color(st).c };
        frames.push(o);
      } else if (st.orosKind === "note") {
        o = { id: newId(), k: "note", x: a.x, y: a.y, w: a.w, h: a.h, tx: tx, c: color(st).c };
      } else if (isClass(c)) {
        var lines = [tx], prevLine = false;
        c.kids.forEach(function (k) {
          if (own(k.st, "line") || k.st.shape === "line") { lines.push("--"); prevLine = true; return; }
          var t = label(k.value, html(k));
          if (t) lines.push(t);
          prevLine = false;
        });
        if (lines.length > 1 && lines[1] !== "--") lines.splice(1, 0, "--");
        if (prevLine) lines.pop();
        var cc = color(st);
        o = { id: newId(), k: "shape", shp: "rect", sym: /interface/i.test(tx) ? "interface" : "class", f: cc.f, c: cc.c, x: a.x, y: a.y, w: a.w, h: a.h, tx: lines.join("\n").slice(0, C.MAX_TEXT) };
      } else if (st.base === "text" || own(st, "text") && !st.shape) {
        if (!tx) return;
        var fs = Math.max(8, Math.min(200, Math.round(num(st.fontSize, 16))));
        var tc = nearest(st.fontColor || "#1f2328");
        o = { id: newId(), k: "text", x: a.x, y: a.y, w: a.w, h: a.h, tx: tx, fs: fs, c: tc ? tc.c : "ink" };
      } else if (st.shape === "image" || own(st, "image") && st.image) {
        var src = String(st.image || "");
        var m = /^data:image\/(png|jpeg|jpg|webp)[,;]/i.exec(src);
        if (m) {
          var body = src.slice(src.indexOf(",") + 1).replace(/\s+/g, "");
          var uri = "data:image/" + (m[1].toLowerCase() === "jpg" ? "jpeg" : m[1].toLowerCase()) + ";base64," + body;
          if (/^[A-Za-z0-9+\/]+={0,2}$/.test(body) && uri.length <= C.IMG_LEN) o = { id: newId(), k: "image", x: a.x, y: a.y, w: a.w, h: a.h, src: uri, c: "ink" };
        }
        if (!o) { skipped++; if (!tx) return; o = { id: newId(), k: "shape", shp: "rect", f: "none", c: "gray", x: a.x, y: a.y, w: a.w, h: a.h, tx: tx }; }
      } else {
        // orosSym: written by us, so a file that comes back is the same
        var s = own(C.SYMS, st.orosSym) ? { sym: st.orosSym } : symFor(st), col = color(st);
        if (s.simple) simplified++;
        o = { id: newId(), k: "shape", shp: "rect", f: col.f, c: col.c, x: a.x, y: a.y, w: a.w, h: a.h, tx: tx };
        if (s.sym && C.SYMS[s.sym]) {
          o.sym = s.sym; o.shp = C.SYMS[s.sym][1];
          // draw.io writes an icon's label under its box; here it is inside, under the icon
          if (C.SYMS[s.sym][0] === "net" && tx && !st.orosSym) { var grow = Math.max(0, 100 - o.w); o.x -= grow / 2; o.w += grow; o.h += 34; }
        }
        else if (s.shp) o.shp = s.shp;
      }
      if (o && push(o)) made[c.id] = o;
    });
    // a cell inside a class row maps to the class
    function target(id) {
      var c = byId[id], n = 0;
      while (c && !made[c.id] && n++ < 50) c = byId[c.parent];
      return c && made[c.id] ? made[c.id] : null;
    }
    // edges
    cells.forEach(function (c) {
      if (!c.edge) return;
      var st = c.st, A = target(c.source), B = target(c.target), g = c.geo;
      var pt = function (as) {
        var p = g ? g.kids.filter(function (k) { return k.name === "mxPoint" && k.attrs.as === as; })[0] : null;
        return p ? { x: num(p.attrs.x, 0), y: num(p.attrs.y, 0) } : null;
      };
      var sp = A ? { x: A.x + A.w / 2, y: A.y + A.h / 2 } : pt("sourcePoint"), tp = B ? { x: B.x + B.w / 2, y: B.y + B.h / 2 } : pt("targetPoint");
      if (!sp || !tp) { skipped++; return; }
      if (st.orosKind === "pen" && !A && !B) {
        // a drawing we wrote: its points back, relative to its box
        var arr = g ? g.kids.filter(function (k) { return k.name === "Array"; })[0] : null, ps = [sp];
        if (arr) arr.kids.forEach(function (k) { if (k.name === "mxPoint" && ps.length < C.MAX_PTS / 2 - 1) ps.push({ x: num(k.attrs.x, 0), y: num(k.attrs.y, 0) }); });
        ps.push(tp);
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        ps.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
        var pc = nearest(st.strokeColor || C.COLORS.ink[0]), flat = [];
        ps.forEach(function (p) { flat.push(r2(p.x - x0), r2(p.y - y0)); });
        push({ id: newId(), k: "pen", x: x0, y: y0, w: Math.max(1, r2(x1 - x0)), h: Math.max(1, r2(y1 - y0)), pts: flat,
          sw: Math.max(1, Math.min(40, Math.round(num(st.strokeWidth, 3)))), c: pc ? pc.c : "ink" });
        return;
      }
      var tx = label(c.value, html(c));
      c.kids.forEach(function (k) { var t = label(k.value, html(k)); if (t) tx = tx ? tx + " " + t : t; });
      var ha = headIn(st.startArrow || "none", st.startFill), hb = headIn(own(st, "endArrow") ? st.endArrow : "classic", st.endFill);
      var col = nearest(st.strokeColor && st.strokeColor !== "default" && st.strokeColor !== "none" ? st.strokeColor : "#1f2328");
      var o = { id: newId(), k: "arrow", ax: r2(sp.x), ay: r2(sp.y), bx: r2(tp.x), by: r2(tp.y), ao: A ? A.id : "", bo: B ? B.id : "",
        hd: C.hdFor(ha, hb), ds: st.dashed === "1", tx: tx.replace(/\n/g, " ").slice(0, 120), c: col ? col.c : "ink" };
      if (ha !== "none" || hb !== "arrow") { o.ha = ha; o.hb = hb; }
      if (/orthogonal|elbow|entityRelation|isometric/.test(st.edgeStyle || "")) o.rt = "elbow";
      else if (st.curved === "1") o.rt = "curve";
      if (o.rt && A) { var s1 = SIDE_IN(st.exitX, st.exitY); if (s1) o.ap = s1; }
      if (o.rt && B) { var s2 = SIDE_IN(st.entryX, st.entryY); if (s2) o.bp = s2; }
      push(o);
    });
    // frames under the rest, then the page moved so its top-left is 0, 0
    frames.forEach(function (f) { f.z = 0; });
    var minX = Infinity, minY = Infinity;
    objs.forEach(function (o) { if (o.k === "arrow") return; minX = Math.min(minX, o.x); minY = Math.min(minY, o.y); });
    if (!isFinite(minX)) { minX = 0; minY = 0; }
    objs.forEach(function (o) {
      if (o.k === "arrow") { o.ax = r2(o.ax - minX); o.ay = r2(o.ay - minY); o.bx = r2(o.bx - minX); o.by = r2(o.by - minY); }
      else { o.x = r2(o.x - minX); o.y = r2(o.y - minY); o.w = r2(o.w); o.h = r2(o.h); }
    });
    return { objs: objs, simplified: simplified, skipped: skipped, cut: cut };
  }

  // ---------- 5. draw.io out ----------
  // Shapes carry orosSym=<symbol> beside draw.io's own style (draw.io
  // keeps style words it does not know), so they come back as they went.
  function attr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#xa;").replace(/\r/g, "").replace(/\t/g, "&#x9;");
  }
  function hex(c, j) { return (C.COLORS[c] || C.COLORS.ink)[j]; }
  function geom(o, extra) {
    return "<mxGeometry x=\"" + r2(o.x) + "\" y=\"" + r2(o.y) + "\" width=\"" + r2(o.w) + "\" height=\"" + r2(o.h) + "\" as=\"geometry\"" + (extra ? ">" + extra + "</mxGeometry>" : " />");
  }
  // objects → the text of a .drawio file (uncompressed; one page).
  function writeDrawio(list, name) {
    var ids = {}, n = 0, cells = [];
    function idOf(o) { if (!own(ids, o.id)) ids[o.id] = "wb-" + (++n); return ids[o.id]; }
    var sorted = list.slice().sort(function (a, b) { return (a.k === "frame" ? 0 : 1) - (b.k === "frame" ? 0 : 1) || a.z - b.z; });
    var m = C.index(list);
    sorted.forEach(function (o) {
      var id = idOf(o), style, v = o.tx || "";
      if (o.k === "note") style = "rounded=0;whiteSpace=wrap;html=0;fillColor=" + hex(o.c, 1) + ";strokeColor=" + hex(o.c, 0) + ";shadow=1;orosKind=note;";
      else if (o.k === "text") style = "text;html=0;whiteSpace=wrap;align=left;verticalAlign=top;fontSize=" + (o.fs || 16) + ";fontColor=" + hex(o.c, 0) + ";";
      else if (o.k === "frame") style = "swimlane;whiteSpace=wrap;html=0;startSize=24;fillColor=none;strokeColor=" + hex(o.c, 0) + ";fontStyle=1;";
      else if (o.k === "image") {
        style = "shape=image;html=0;imageAspect=0;image=" + String(o.src).replace(";base64,", ",") + ";";
        v = "";
      } else if (o.k === "shape") {
        var sym = C.symOf(o), base = sym ? OUT[sym] : BASIC_OUT[o.shp] || "rounded=0";
        if (/^mxgraph\./.test(base)) base = "shape=" + base + ";verticalLabelPosition=bottom;verticalAlign=top;aspect=fixed";
        var fill = o.f === "none" ? "none" : o.f === "solid" ? hex(o.c, 0) : hex(o.c, 1);
        style = base + ";whiteSpace=wrap;html=0;" + (/fillColor=/.test(base) ? "" : "fillColor=" + fill + ";") + "strokeColor=" + hex(o.c, 0) + ";" + (o.f === "solid" ? "fontColor=#ffffff;" : "") + (sym ? "orosSym=" + sym + ";" : "");
      } else if (o.k === "arrow") {
        var hz = C.headsOf(o), s0 = HEAD_OUT[hz.a] || HEAD_OUT.none, s1 = HEAD_OUT[hz.b] || HEAD_OUT.arrow;
        style = "html=0;endArrow=" + s1[0] + ";endFill=" + s1[1] + ";startArrow=" + s0[0] + ";startFill=" + s0[1] + ";strokeColor=" + hex(o.c, 0) + ";" + (o.ds ? "dashed=1;" : "");
        if (o.rt === "elbow") style += "edgeStyle=orthogonalEdgeStyle;rounded=0;";
        else if (o.rt === "curve") style += "curved=1;";
        var A = o.ao && m[o.ao], B = o.bo && m[o.bo];
        if (o.ap && A && SIDE_OUT[o.ap]) style += "exitX=" + SIDE_OUT[o.ap][0] + ";exitY=" + SIDE_OUT[o.ap][1] + ";exitDx=0;exitDy=0;";
        if (o.bp && B && SIDE_OUT[o.bp]) style += "entryX=" + SIDE_OUT[o.bp][0] + ";entryY=" + SIDE_OUT[o.bp][1] + ";entryDx=0;entryDy=0;";
        var pts = (A ? "" : "<mxPoint x=\"" + r2(o.ax) + "\" y=\"" + r2(o.ay) + "\" as=\"sourcePoint\" />") + (B ? "" : "<mxPoint x=\"" + r2(o.bx) + "\" y=\"" + r2(o.by) + "\" as=\"targetPoint\" />");
        cells.push("<mxCell id=\"" + id + "\" value=\"" + attr(v) + "\" style=\"" + attr(style) + "\" edge=\"1\" parent=\"1\"" +
          (A ? " source=\"" + idOf(A) + "\"" : "") + (B ? " target=\"" + idOf(B) + "\"" : "") + "><mxGeometry relative=\"1\" as=\"geometry\"" + (pts ? ">" + pts + "</mxGeometry>" : " />") + "</mxCell>");
        return;
      } else if (o.k === "pen") {
        var p = o.pts || [], arr = "", step = Math.max(1, Math.ceil(p.length / 2 / 200)) * 2;
        if (p.length < 4) return;
        for (var i = 2; i < p.length - 2; i += step) arr += "<mxPoint x=\"" + r2(o.x + p[i]) + "\" y=\"" + r2(o.y + p[i + 1]) + "\" />";
        style = "html=0;endArrow=none;curved=1;strokeWidth=" + (o.sw || 3) + ";strokeColor=" + hex(o.c, 0) + ";orosKind=pen;";
        cells.push("<mxCell id=\"" + id + "\" value=\"\" style=\"" + attr(style) + "\" edge=\"1\" parent=\"1\"><mxGeometry relative=\"1\" as=\"geometry\">" +
          "<mxPoint x=\"" + r2(o.x + p[0]) + "\" y=\"" + r2(o.y + p[1]) + "\" as=\"sourcePoint\" /><mxPoint x=\"" + r2(o.x + p[p.length - 2]) + "\" y=\"" + r2(o.y + p[p.length - 1]) + "\" as=\"targetPoint\" />" +
          (arr ? "<Array as=\"points\">" + arr + "</Array>" : "") + "</mxGeometry></mxCell>");
        return;
      } else return;
      cells.push("<mxCell id=\"" + id + "\" value=\"" + attr(v) + "\" style=\"" + attr(style) + "\" vertex=\"1\" parent=\"1\">" + geom(o) + "</mxCell>");
    });
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<mxfile host=\"orOS Whiteboard\" type=\"device\">\n  <diagram name=\"" + attr(name || "Page-1") + "\" id=\"orOS-1\">\n" +
      "    <mxGraphModel grid=\"1\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"0\" pageScale=\"1\" math=\"0\" shadow=\"0\">\n      <root>\n" +
      "        <mxCell id=\"0\" />\n        <mxCell id=\"1\" parent=\"0\" />\n" + cells.map(function (c) { return "        " + c + "\n"; }).join("") +
      "      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n";
  }

  // ---------- 6. Mermaid flowchart in ----------
  // text → { objs, nodes, edges, cut } (laid out with C.layout "flow",
  // top-left 0, 0) or { err } (English, for the model / the app's code).
  var MSHAPES = [
    ["(((", ")))", { shp: "ellipse" }], ["([", "])", { sym: "terminator" }], ["[[", "]]", { sym: "predefined" }], ["[(", ")]", { sym: "database" }],
    ["((", "))", { shp: "ellipse" }], ["{{", "}}", { sym: "preparation" }], ["[/", "/]", { sym: "data" }], ["[\\", "\\]", { sym: "data" }],
    ["[/", "\\]", { sym: "manual-op" }], ["[\\", "/]", { sym: "manual-op" }], ["{", "}", { sym: "decision" }], ["(", ")", { shp: "round" }],
    [">", "]", { shp: "rect" }], ["[", "]", { shp: "rect" }]
  ];
  var ID_RE = /^[\p{L}\p{N}_]+(?:[.\-][\p{L}\p{N}_]+)*/u;
  function mtext(s) {
    s = String(s).trim();
    if (s.length > 1 && s[0] === "\"" && s[s.length - 1] === "\"") s = s.slice(1, -1);
    if (s[0] === "`" && s[s.length - 1] === "`") s = s.slice(1, -1);
    return label(s.replace(/<br\s*\/?>/gi, "\n").replace(/\*\*|__/g, ""), /<[a-z\/]/i.test(s)).slice(0, 500);
  }
  // Lines, and ; between statements (not inside quotes).
  function statements(s) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === "\"") q = !q;
      if (!q && (ch === "\n" || ch === ";")) { out.push(cur); cur = ""; if (ch === "\n") q = false; continue; }
      if (ch === "\n") q = false;
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  function readMermaid(src, newId, opts) {
    opts = opts || {};
    newId = newId || C.uid;
    if (typeof src !== "string" || !src.trim()) return { err: "mermaid: the text is empty" };
    if (src.length > MAX_MERMAID) return { err: "mermaid: the text is longer than " + MAX_MERMAID + " characters" };
    var lines = src.replace(/\r\n?/g, "\n").split("\n"), li = 0, dir = "v";
    while (li < lines.length && (!lines[li].trim() || /^\s*%%/.test(lines[li]) || /^\s*---/.test(lines[li]))) {
      if (/^\s*---/.test(lines[li])) { li++; while (li < lines.length && !/^\s*---/.test(lines[li])) li++; }   // front matter
      li++;
    }
    var head = /^\s*(graph|flowchart)\b\s*(TD|TB|BT|LR|RL)?\s*;?\s*(.*)$/i.exec(lines[li] || "");
    if (!head) return { err: "mermaid: only flowcharts are read (the first line is graph TD, flowchart LR, …)" };
    if (head[2] && /^(LR|RL)$/i.test(head[2])) dir = "h";
    var rest = [head[3] || ""].concat(lines.slice(li + 1)).join("\n");
    var N = {}, order = [], edges = [], subs = [], stack = [], cut = false;
    function nodeAt(s, i) {
      while (s[i] === " " || s[i] === "\t") i++;
      var m = ID_RE.exec(s.slice(i));
      if (!m) return null;
      var id = m[0], j = i + id.length, text = null, look = null;
      for (var k = 0; k < MSHAPES.length; k++) {
        var o = MSHAPES[k][0], c = MSHAPES[k][1];
        if (s.startsWith(o, j)) {
          var q = j + o.length, e;
          if (s[q] === "\"") { var qe = s.indexOf("\"", q + 1); e = qe >= 0 ? s.indexOf(c, qe + 1) : -1; }
          else e = s.indexOf(c, q);
          if (e < 0) continue;
          text = mtext(s.slice(q, e)); look = MSHAPES[k][2]; j = e + c.length;
          break;
        }
      }
      if (s.startsWith(":::", j)) { var cm = /^:::[\w-]+/.exec(s.slice(j)); if (cm) j += cm[0].length; }
      if (!own(N, id)) {
        if (order.length >= MAX_NODES) { cut = true; return { id: null, end: j }; }
        N[id] = { id: id, text: id, look: { shp: "rect" } };
        order.push(id);
      }
      if (text !== null) { N[id].text = text; N[id].look = look; }
      stack.forEach(function (sg) { if (sg.members.indexOf(id) < 0) sg.members.push(id); });
      return { id: id, end: j };
    }
    function groupAt(s, i) {
      var ids = [], n = nodeAt(s, i);
      if (!n) return null;
      ids.push(n.id); i = n.end;
      for (;;) {
        var m = /^\s*&\s*/.exec(s.slice(i));
        if (!m) break;
        var n2 = nodeAt(s, i + m[0].length);
        if (!n2) break;
        ids.push(n2.id); i = n2.end;
      }
      return { ids: ids.filter(Boolean), end: i };
    }
    var LINK_TXT = /^\s*(<|x|o)?(--|==|-\.)(?![->.=])\s*([^\n]*?)\s*(-{2,}|={2,}|\.+-)(>|[xo](?![\p{L}\p{N}_]))?(?=[\s\p{L}\p{N}_"]|$)/u;
    var LINK = /^\s*(<|x|o)?(-{2,}|={2,}|-\.+-|~~~)(>|[xo](?![\p{L}\p{N}_]))?(?:\s*\|([^|]*)\|)?/u;
    function linkAt(s, i) {
      var t = s.slice(i), m = LINK_TXT.exec(t), txt = "", a, b, body;
      if (m && !/^\s*(<|x|o)?(-{2,}|={2,})(>|x|o)?\s*\|/.test(t)) { a = m[1]; body = m[2] + m[4]; b = m[5]; txt = m[3]; }
      else {
        m = LINK.exec(t);
        if (!m) return null;
        a = m[1]; body = m[2]; b = m[3]; txt = m[4] || "";
      }
      // x / o at the start belong to a node id when a letter follows
      var head = function (c) { return c === ">" || c === "<" ? "arrow" : c === "o" ? "dot" : c === "x" ? "none" : ""; };
      return { end: i + m[0].length, ha: head(a) || "none", hb: head(b) || "none", ds: body.indexOf(".") >= 0, hidden: body === "~~~", tx: mtext(txt).replace(/\n/g, " ").slice(0, 120) };
    }
    statements(rest).forEach(function (raw) {
      var s = raw.replace(/%%.*$/, "").trim();
      if (!s) return;
      var sm = /^subgraph\s+(.*)$/.exec(s);
      if (sm) {
        var tt = sm[1].trim(), mm2 = /^([\p{L}\p{N}_-]+)\s*\[(.*)\]$/u.exec(tt);
        stack.push({ title: mtext(mm2 ? mm2[2] : tt), members: [] });
        return;
      }
      if (/^end$/.test(s)) { var sg = stack.pop(); if (sg) subs.push(sg); return; }
      if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/.test(s)) return;
      var g = groupAt(s, 0);
      if (!g) return;
      var i = g.end;
      for (;;) {
        var l = linkAt(s, i);
        if (!l) break;
        var g2 = groupAt(s, l.end);
        if (!g2) break;
        if (!l.hidden) g.ids.forEach(function (x) {
          g2.ids.forEach(function (y) {
            if (edges.length >= MAX_EDGES) { cut = true; return; }
            edges.push({ a: x, b: y, l: l });
          });
        });
        g = g2; i = g2.end;
      }
    });
    while (stack.length) subs.push(stack.pop());
    if (!order.length) return { err: "mermaid: no boxes found" };
    // boxes, sized from their text; then arrows
    var objs = [], obj = {}, z = 1;
    order.forEach(function (id) {
      var nd = N[id], ls = String(nd.text).split("\n"), longest = 0;
      ls.forEach(function (l) { longest = Math.max(longest, l.length); });
      var w = Math.max(110, Math.min(320, longest * 9 + 48)), h = Math.max(56, ls.length * 22 + 34), o;
      if (nd.look.sym === "decision") { w = Math.round(w * 1.35); h = Math.round(h * 1.5); }
      else if (nd.look.shp === "ellipse") { w = Math.max(w, h + 20); h = Math.max(h, 70); }
      else if (nd.look.sym === "database") h += 26;
      o = { id: newId(), b: "-", k: "shape", shp: nd.look.shp || C.SYMS[nd.look.sym][1], f: "soft", c: opts.c || "blue", x: z, y: z, w: w, h: h, tx: nd.text, z: z++ };   // x, y: the order they were written in
      if (nd.look.sym) o.sym = nd.look.sym;
      objs.push(o); obj[id] = o;
    });
    edges.forEach(function (e) {
      var A = obj[e.a], B = obj[e.b];
      if (!A || !B || A === B) return;
      var o = { id: newId(), b: "-", k: "arrow", c: "ink", z: z++, ax: 0, ay: 0, bx: 0, by: 0, ao: A.id, bo: B.id, hd: C.hdFor(e.l.ha, e.l.hb), ds: e.l.ds, tx: e.l.tx, rt: "elbow" };
      if (e.l.ha !== "none" || e.l.hb !== "arrow") { o.ha = e.l.ha; o.hb = e.l.hb; }
      objs.push(o);
    });
    var moved = C.layout(objs, null, { kind: "flow", dir: dir, gap: 48 });
    objs = objs.map(function (o) { return moved[o.id] || o; });
    // subgraphs: a frame round their boxes, under them
    var m = C.index(objs);
    subs.forEach(function (sg) {
      var boxes = sg.members.map(function (id) { return obj[id] && m[obj[id].id]; }).filter(Boolean);
      if (!boxes.length) return;
      var bd = C.bounds(boxes, null, 0);
      objs.push({ id: newId(), b: "-", k: "frame", c: "gray", z: 0, x: r2(bd.x - 24), y: r2(bd.y - 44), w: r2(bd.w + 48), h: r2(bd.h + 68), tx: sg.title.replace(/\n/g, " ").slice(0, 120) });
    });
    // top-left at 0, 0 and the arrows' kept ends
    var bb = C.bounds(objs.filter(function (o) { return o.k !== "arrow"; }), null, 0), dx = -bb.x, dy = -bb.y;
    objs = objs.map(function (o) { return o.k === "arrow" ? o : C.moved(o, r2(dx), r2(dy)); });
    var mi = C.index(objs);
    objs.forEach(function (o) {
      if (o.k !== "arrow") return;
      var en = C.ends(o, mi);
      o.ax = r2(en.a.x); o.ay = r2(en.a.y); o.bx = r2(en.b.x); o.by = r2(en.b.y);
    });
    return { objs: objs, nodes: order.length, edges: edges.length, cut: cut };
  }

  // ---------- 7. Visio .vsdx in (wave DG5, basic) ----------
  // A .vsdx is a zip of XML parts (designkit/zipin.js reads it). Each
  // foreground page becomes a board: shapes by their master's name
  // (Process, Decision, …) → DG1 symbols, else a plain rectangle
  // (counted); text, size, place, fill and line colour; connectors
  // joined through <Connects> (dynamic connectors are elbow lines);
  // containers and swimlanes → frames; groups are flattened. Visio's
  // own geometry, pictures (EMF) and themes are not drawn. Units are
  // inches with y going up: 1 in = 96 px here.
  var MAX_VSDX = 30000000, MAX_PART = 12000000, PX = 96;
  var VMASTER = [[/^(start ?\/ ?end|terminator|start|end)\b/, "terminator"], [/^decision/, "decision"], [/^(predefined process|subprocess|sub-process)/, "predefined"],
    [/^multiple documents?/, "documents"], [/^document/, "document"], [/^manual input/, "manual-input"], [/^manual operation/, "manual-op"],
    [/^preparation/, "preparation"], [/^(database|stored data|direct data|data store)/, "database"], [/^data/, "data"], [/^delay/, "delay"],
    [/^off-?page reference/, "off-page"], [/^on-?page reference/, "connector"], [/^merge|^extract/, "merge"], [/^(process|step)\b/, "process"],
    [/^(executive|manager|position|assistant|consultant|staff|vacancy)\b/, "person"], [/^(team|department|unit)\b/, "unit"],
    [/^(class)\b/, "class"], [/^interface\b/, "interface"], [/^actor\b/, "actor"], [/^use ?case\b/, "usecase"], [/^package\b/, "package"],
    [/^component\b/, "component"], [/^(note|comment|annotation)\b/, "comment"], [/^node\b/, "node"],
    [/^hexagon/, "hexagon"], [/^octagon/, "octagon"], [/^star/, "star"], [/^cross/, "cross"], [/^(double arrow|2-d double)/, "arrow-both"],
    [/^(arrow|block arrow|2-d single|right arrow)/, "arrow-right"], [/^cloud/, "cloud"], [/^(callout|speech)/, "callout"],
    [/server.*(data|stor)|database server/, "db-server"], [/server/, "server"], [/router/, "router"], [/switch/, "switch"], [/firewall/, "firewall"],
    [/laptop/, "laptop"], [/(pc|desktop|workstation|computer|monitor)\b/, "desktop"], [/(phone|mobile|smartphone)/, "phone"], [/tablet/, "tablet"],
    [/printer/, "printer"], [/(wireless|wi-?fi|access point)/, "wifi"], [/(storage|disk|nas\b|san\b)/, "storage"], [/(internet|globe)/, "internet"],
    [/^(user|person|people)\b/, "user"]];
  var VBASIC = [[/^(rounded rectangle|rounded square)/, "round"], [/^(rectangle|square|box)/, "rect"], [/^(ellipse|circle|oval)/, "ellipse"],
    [/^diamond/, "diamond"], [/^triangle/, "tri"]];
  function vsdxPath(base, target) {
    var parts = base.split("/").slice(0, -1);
    String(target).split("/").forEach(function (p) { if (p === "..") parts.pop(); else if (p && p !== ".") parts.push(p); });
    return parts.join("/");
  }
  function relsOf(x) {
    var out = {};
    if (x) x.kids.forEach(function (r) { if (r.name === "Relationship" && r.attrs.Id) out[r.attrs.Id] = r.attrs.Target || ""; });
    return out;
  }
  function attrNS(e, local) {
    for (var k in e.attrs) if (own(e.attrs, k) && (k === local || k.slice(-local.length - 1) === ":" + local)) return e.attrs[k];
    return "";
  }
  // The cells of a shape (and its master's, as the fallback).
  function cellsOf(sh) {
    var c = {};
    sh.kids.forEach(function (k) { if (k.name === "Cell" && k.attrs.N) c[k.attrs.N] = k.attrs.V !== undefined ? k.attrs.V : ""; });
    return c;
  }
  function vText(sh) {
    var t = kid(sh, "Text");
    if (!t) return null;
    var s = t.text;
    t.kids.forEach(function (k) { if (k.name === "fld") s += k.text; });
    return label(s.replace(/\u2028|\u2029/g, "\n"), false);
  }
  function readVsdx(blob, newId) {
    newId = newId || C.uid;
    var zip = node ? require("../designkit/zipin.js") : root.orosZipIn;
    if (!zip) return Promise.reject(new Error("zipin"));
    if (!blob || blob.size > MAX_VSDX) return Promise.reject(new Error("big"));
    return zip.list(blob).then(function (entries) {
      var by = {};
      entries.forEach(function (e) { by[e.name.toLowerCase()] = e; });
      function xml(name, optional) {
        var e = by[String(name).toLowerCase()];
        if (!e) { if (optional) return Promise.resolve(null); throw new Error("notvsdx"); }
        return e.get(MAX_PART).then(function (b) { return b.text(); }).then(function (t) { return parseXml(t); });
      }
      if (!by["visio/pages/pages.xml"]) throw new Error("notvsdx");
      return Promise.all([xml("visio/pages/pages.xml"), xml("visio/pages/_rels/pages.xml.rels", true), xml("visio/masters/masters.xml", true), xml("visio/masters/_rels/masters.xml.rels", true)])
        .then(function (r) {
          var pagesX = r[0], prels = relsOf(r[1]), mrels = relsOf(r[3]), masters = {};
          // master id → { name, file }
          if (r[2]) r[2].kids.forEach(function (m) {
            if (m.name !== "Master") return;
            var rel = kid(m, "Rel"), file = rel ? mrels[attrNS(rel, "id")] : "";
            masters[m.attrs.ID] = { name: String(m.attrs.NameU || m.attrs.Name || ""), file: file ? vsdxPath("visio/masters/masters.xml", file) : "" };
          });
          var pages = pagesX.kids.filter(function (p) { return p.name === "Page" && p.attrs.Background !== "1"; }).slice(0, MAX_PAGES);
          // the masters' own first shapes: sizes and cells a shape may leave out
          var need = {};
          Object.keys(masters).forEach(function (id) { if (masters[id].file) need[masters[id].file] = 1; });
          return Promise.all(Object.keys(need).map(function (f) { return xml(f, true).then(function (x) { return [f, x]; }, function () { return [f, null]; }); })).then(function (mx) {
            var mshape = {};
            mx.forEach(function (p) {
              var shapes = p[1] && kid(p[1], "Shapes"), first = shapes && shapes.kids.filter(function (k) { return k.name === "Shape"; })[0];
              if (first) mshape[p[0]] = cellsOf(first);
            });
            Object.keys(masters).forEach(function (id) { masters[id].cells = mshape[masters[id].file] || {}; });
            return Promise.all(pages.map(function (pg) {
              var rel = kid(pg, "Rel"), target = rel ? prels[attrNS(rel, "id")] : "";
              if (!target) return null;
              var sheet = kid(pg, "PageSheet"), ph = sheet ? parseFloat(cellsOf(sheet).PageHeight) : NaN;
              return xml(vsdxPath("visio/pages/pages.xml", target), true).then(function (x) {
                return x ? { name: String(pg.attrs.NameU || pg.attrs.Name || ""), x: x, ph: isFinite(ph) ? ph : 11 } : null;
              });
            }));
          }).then(function (list) {
            var out = { pages: [], simplified: 0, skipped: 0, cut: false };
            list.forEach(function (p) {
              if (!p) return;
              var res = readVsdxPage(p.x, p.ph, masters, newId);
              out.simplified += res.simplified; out.skipped += res.skipped; out.cut = out.cut || res.cut;
              out.pages.push({ name: p.name.slice(0, 120), objs: res.objs });
            });
            if (!out.pages.length) throw new Error("empty");
            return out;
          });
        });
    });
  }
  function readVsdxPage(x, pageH, masters, newId) {
    var objs = [], made = {}, ends = {}, simplified = 0, skipped = 0, cut = false, z = 1, conn = [];
    function f(v, d) { var n = parseFloat(v); return isFinite(n) && Math.abs(n) < 1e5 ? n : d; }
    function push(o) { if (objs.length >= MAX_OBJS) { cut = true; return false; } o.z = z++; objs.push(o); return true; }
    // box: the parent's frame in page inches { x, y (top), h }
    function walk(shapesEl, box, mInherit, depth) {
      if (!shapesEl || depth > 20) return;
      shapesEl.kids.forEach(function (sh) {
        if (sh.name !== "Shape") return;
        var m = masters[sh.attrs.Master] || mInherit || { name: "", cells: {} }, own2 = cellsOf(sh), mc = m.cells || {};
        var cell = function (n, d) { return own(own2, n) ? own2[n] : own(mc, n) ? mc[n] : d; };
        var w = f(cell("Width"), 1), h = f(cell("Height"), 0.75), px = f(cell("PinX"), 0), py = f(cell("PinY"), 0);
        var lx = f(cell("LocPinX"), w / 2), ly = f(cell("LocPinY"), h / 2);
        var left = box.x + px - lx, top = box.y + (box.h - (py - ly + h));
        var tx = vText(sh), name = m.name.toLowerCase().replace(/\.\d+$/, "").trim(), id = sh.attrs.ID;
        var oneD = own(own2, "BeginX") || own(mc, "BeginX") || /connector|^line|^arc/.test(name);
        if (oneD) {
          var bx = f(cell("BeginX"), left), by2 = f(cell("BeginY"), top), ex = f(cell("EndX"), left + w), ey = f(cell("EndY"), top);
          conn.push({ id: id, a: { x: box.x + bx, y: box.y + box.h - by2 }, b: { x: box.x + ex, y: box.y + box.h - ey }, tx: tx || "", name: name,
            line: cell("LineColor", ""), dash: f(cell("LinePattern"), 1), ba: f(cell("BeginArrow"), 0), ea: f(cell("EndArrow"), /connector/.test(name) ? 0 : 0), route: f(cell("ConLineRouteExt"), 0) });
          return;
        }
        var kids = kid(sh, "Shapes");
        if (sh.attrs.Type === "Group" && kids) {
          if (tx && /container|swimlane|lane|pool|frame/.test(name)) push({ id: newId(), k: "frame", x: left, y: top, w: w, h: h, tx: tx.replace(/\n/g, " ").slice(0, 120), c: "gray" });
          walk(kids, { x: left, y: top, h: h }, null, depth + 1);
          return;
        }
        var o;
        if (/container|swimlane|lane|pool|phase|separator/.test(name)) o = { id: newId(), k: "frame", tx: (tx || "").replace(/\n/g, " ").slice(0, 120), c: "gray" };
        else {
          var sym = "", shp = "rect", i;
          for (i = 0; i < VMASTER.length && !sym; i++) if (VMASTER[i][0].test(name)) sym = VMASTER[i][1];
          for (i = 0; i < VBASIC.length && !sym && shp === "rect"; i++) if (VBASIC[i][0].test(name)) shp = VBASIC[i][1];
          if (!sym && shp === "rect" && name && !/^(rectangle|square|box)/.test(name)) simplified++;
          if (!name && !tx) { skipped++; return; }
          var fill = String(cell("FillForegnd", "")), line = String(cell("LineColor", "")), pat = f(cell("FillPattern"), 1), col;
          if (pat === 0 || !/^#/.test(fill) || whiteish(fill)) { var lc = nearest(/^#/.test(line) ? line : C.COLORS.ink[0]); col = { c: lc ? lc.c : "ink", f: "none" }; }
          else { var fc = nearest(fill); col = { c: fc ? fc.c : "blue", f: fc && fc.strong ? "solid" : "soft" }; }
          o = { id: newId(), k: "shape", shp: shp, f: col.f, c: col.c, tx: tx || "" };
          if (sym && C.SYMS[sym]) { o.sym = sym; o.shp = C.SYMS[sym][1]; }
        }
        o.x = left; o.y = top; o.w = w; o.h = h;
        // an icon's label goes under the icon, inside its box (as draw.io's)
        if (o.sym && C.SYMS[o.sym][0] === "net" && o.tx) { var gw = Math.max(0, 100 / PX - o.w); o.x -= gw / 2; o.w += gw; o.h += 34 / PX; }
        if (push(o)) made[id] = o;
      });
    }
    var shapes = kid(x, "Shapes");
    walk(shapes, { x: 0, y: 0, h: pageH }, null, 0);
    // connections: FromSheet (the line) BeginX / EndX → ToSheet
    var cx = kid(x, "Connects");
    if (cx) cx.kids.forEach(function (c) {
      if (c.name !== "Connect") return;
      var e = ends[c.attrs.FromSheet] = ends[c.attrs.FromSheet] || {};
      if (/^Begin/.test(c.attrs.FromCell || "")) e.a = c.attrs.ToSheet; else if (/^End/.test(c.attrs.FromCell || "")) e.b = c.attrs.ToSheet;
    });
    var HEAD = function (n) { return !n ? "none" : n === 4 || n === 5 ? "tri" : n === 13 || n === 1 || n === 2 ? "arrow" : n >= 20 && n <= 22 ? "dia" : n === 10 ? "dot" : "arrow"; };
    conn.forEach(function (l) {
      var e = ends[l.id] || {}, A = e.a && made[e.a], B = e.b && made[e.b];
      var ha = HEAD(l.ba), hb = HEAD(l.ea);
      if (!l.ea && !l.ba && /connector/.test(l.name)) hb = "arrow";          // a dynamic connector's usual end
      var col = nearest(/^#/.test(l.line) ? l.line : C.COLORS.ink[0]);
      var o = { id: newId(), k: "arrow", ax: r2(l.a.x), ay: r2(l.a.y), bx: r2(l.b.x), by: r2(l.b.y), ao: A ? A.id : "", bo: B ? B.id : "",
        hd: C.hdFor(ha, hb), ds: l.dash > 1, tx: l.tx.replace(/\n/g, " ").slice(0, 120), c: col ? col.c : "ink" };
      if (ha !== "none" || hb !== "arrow") { o.ha = ha; o.hb = hb; }
      if (/connector/.test(l.name)) o.rt = l.route === 2 ? "curve" : "elbow";
      push(o);
    });
    // inches → px, top-left at 0, 0, frames under the rest
    var minX = Infinity, minY = Infinity;
    objs.forEach(function (o) { if (o.k !== "arrow") { minX = Math.min(minX, o.x); minY = Math.min(minY, o.y); } });
    if (!isFinite(minX)) { minX = 0; minY = 0; }
    objs.forEach(function (o) {
      if (o.k === "frame") o.z = 0;
      if (o.k === "arrow") { o.ax = r2((o.ax - minX) * PX); o.ay = r2((o.ay - minY) * PX); o.bx = r2((o.bx - minX) * PX); o.by = r2((o.by - minY) * PX); }
      else { o.x = r2((o.x - minX) * PX); o.y = r2((o.y - minY) * PX); o.w = Math.max(8, r2(o.w * PX)); o.h = Math.max(8, r2(o.h * PX)); }
    });
    return { objs: objs, simplified: simplified, skipped: skipped, cut: cut };
  }

  var API = { parseXml: parseXml, styleOf: styleOf, nearest: nearest, readDrawio: readDrawio, writeDrawio: writeDrawio, readMermaid: readMermaid, readVsdx: readVsdx, MAX_VSDX: MAX_VSDX,
    MAX_FILE: MAX_FILE, MAX_PAGES: MAX_PAGES, MAX_NODES: MAX_NODES, MAX_MERMAID: MAX_MERMAID };
  if (node) module.exports = API;
  if (root) root.WhiteboardDiagram = API;
})(typeof window !== "undefined" ? window : globalThis);
