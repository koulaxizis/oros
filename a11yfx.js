// ============================================================
// orOS — a11yfx.js (colour filters and the large pointer, v1.0.0)
// ------------------------------------------------------------
// A shell component: it runs IN the shell document, loaded on demand
// by shell.js (section 5e, Accessibility) only while a filter or a
// pointer size is on or an overlay is asked for, so start-up carries
// no extra script. shell.js keeps the choice in its device-local
// "oros-a11y" and calls apply() whenever it changes; this file stores
// nothing.
//
//   • Colour filter: ONE CSS filter on the shell's root element. The
//     root is exempt from "a filter makes a containing block", so
//     fixed bars, menus and dialogs stay where they are, and the
//     filter colours everything painted under it: every app frame,
//     cross-origin ones (map tiles, embeds) included. No app changes.
//       grey     grayscale(strength)
//       protan   red-green, red weak     } daltonize matrices (the
//       deutan   red-green, green weak   } Android/iOS approach: the
//       tritan   blue-yellow             } confused colours are moved
//                                          apart, not simulated)
//       invert   invert(1) hue-rotate(180deg), "smart": photos,
//                video, canvas and pictures inverted back in the shell
//                and in every same-origin app (css(), data-oros-invert)
//     The corrections are SVG feColorMatrix filters in a hidden <svg>
//     in the shell (sRGB, mixed with the identity by strength 25-100).
//     Saved and exported files never carry it (it is only how the page
//     is painted); a screenshot or screen recording does, unlike an
//     OS-level filter.
//   • Overlays: other features (Screen time's Bedtime) add a temporary
//     filter after the person's own with overlay(name, "grey" | null,
//     fadeMs); it composes with the chosen filter, fades, and never
//     touches "oros-a11y". Night Light is its own element (#oros-night)
//     and stays under the filter like everything else.
//   • Large pointer: "large" (32 px) or "xl" (48 px) SVG cursors (arrow,
//     hand, I-beam) through css() under data-oros-pointer, only on a
//     device with a mouse or touchpad (any-pointer: fine). Chromium
//     hides a cursor larger than 32 px while it touches the window's
//     edge, so Large always shows. A place that sets its own cursor (a
//     game's crosshair, a drawing tool, a resize handle) keeps it.
//
// Pure logic (matrices, filter strings, cursors, CSS) is unit-tested
// in node (tests/a11yfx.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var FILTERS = ["off", "grey", "protan", "deutan", "tritan", "invert"];
  var STRENGTHS = [25, 50, 75, 100];
  var POINTERS = ["normal", "large", "xl"];
  var CORRECT = { protan: 1, deutan: 1, tritan: 1 };
  var SVG_ID = "oros-cf-svg";

  // ---------- 1. Model (pure) ----------
  // Simulation of each deficiency (Machado, Oliveira & Fernandes 2009,
  // severity 1), and the error shift that moves what is lost into
  // channels that are still seen (Fidaner et al., daltonize).
  var SIM = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
  };
  var SHIFT = {
    protan: [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]],
    deutan: [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]],
    tritan: [[1, 0, 0.7], [0, 1, 0.7], [0, 0, 0]]
  };
  var I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  function mul(a, b) {
    var r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      var s = 0;
      for (var k = 0; k < 3; k++) s += a[i][k] * b[k][j];
      r[i][j] = s;
    }
    return r;
  }
  function sub(a, b) { return a.map(function (row, i) { return row.map(function (v, j) { return v - b[i][j]; }); }); }
  function add(a, b) { return a.map(function (row, i) { return row.map(function (v, j) { return v + b[i][j]; }); }); }
  function mix(a, b, t) { return a.map(function (row, i) { return row.map(function (v, j) { return v + (b[i][j] - v) * t; }); }); }

  function cleanFilter(v) { return FILTERS.indexOf(v) !== -1 ? v : "off"; }
  function cleanStrength(v) { return STRENGTHS.indexOf(v) !== -1 ? v : 100; }
  function cleanPointer(v) { return POINTERS.indexOf(v) !== -1 ? v : "normal"; }

  // The 3×3 correction: D = I + Shift·(I − Sim), mixed with I by strength.
  function matrix3(kind, strength) {
    if (!CORRECT[kind]) return I3;
    var d = add(I3, mul(SHIFT[kind], sub(I3, SIM[kind])));
    return mix(I3, d, cleanStrength(strength) / 100);
  }
  // feColorMatrix type="matrix" values: 4×5, alpha untouched.
  function matrixValues(kind, strength) {
    var m = matrix3(kind, strength), out = [];
    for (var i = 0; i < 3; i++) out.push(m[i][0], m[i][1], m[i][2], 0, 0);
    out.push(0, 0, 0, 1, 0);
    return out.map(function (v) { return String(Math.round(v * 10000) / 10000); }).join(" ");
  }
  function apply3(m, rgb) {
    return [0, 1, 2].map(function (i) { return m[i][0] * rgb[0] + m[i][1] * rgb[1] + m[i][2] * rgb[2]; });
  }

  // The person's own filter as CSS.
  function ownCss(cfg) {
    var f = cleanFilter(cfg && cfg.filter), s = cleanStrength(cfg && cfg.strength);
    if (f === "grey") return "grayscale(" + (s / 100) + ")";
    if (f === "invert") return "invert(1) hue-rotate(180deg)";
    if (CORRECT[f]) return "url(#oros-cf-" + f + ")";
    return "";
  }
  var OVERLAY_CSS = { grey: "grayscale(1)" };
  // Own filter first, then each overlay in the order they came.
  function filterCss(cfg, overlays) {
    var parts = [], own = ownCss(cfg);
    if (own) parts.push(own);
    (overlays || []).forEach(function (o) { if (OVERLAY_CSS[o.kind]) parts.push(OVERLAY_CSS[o.kind]); });
    return parts.join(" ");
  }

  // Cursors: white with a black outline (seen on light and dark).
  var CUR = {
    arrow: { d: "M4 2 L4 26 L10 20 L14.5 29.5 L18.5 27.5 L14 18.5 L22 18.5 Z", x: 4, y: 2 },
    hand: { d: "M11 4.5 a2 2 0 0 1 4 0 V14 a2 2 0 0 1 4 0 v1 a2 2 0 0 1 4 0 v1.5 a2 2 0 0 1 4 0 V23 c0 4.5-3 7.5-7.5 7.5 h-2.5 c-3 0-5-1.5-6.5-4 L5 19 a2 2 0 0 1 3.2-2.4 L11 19.5 Z", x: 13, y: 3 },
    text: { d: "M11 3 h3 c1 0 2 .6 2 1.5 c0-.9 1-1.5 2-1.5 h3 v3 h-3 v20 h3 v3 h-3 c-1 0-2-.6-2-1.5 c0 .9-1 1.5-2 1.5 h-3 v-3 h3 V6 h-3 Z", x: 16, y: 16 }
  };
  function cursorUrl(name, px) {
    var c = CUR[name];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 32 32">' +
      '<path d="' + c.d + '" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    var k = px / 32;
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") ' + Math.round(c.x * k) + " " + Math.round(c.y * k);
  }
  var PX = { large: 32, xl: 48 };
  var CLICK = "a[href], button, summary, label[for], select, [role=button], [role=link], [role=tab], [role=menuitem]," +
    " [role=option], [role=switch], [role=checkbox], [role=radio], input[type=checkbox], input[type=radio]," +
    " input[type=button], input[type=submit], input[type=reset], input[type=file], input[type=color], input[type=range]";
  var TYPE = "textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url]," +
    " input[type=tel], input[type=password], input[type=number], [contenteditable=\"\"], [contenteditable=true]";
  function pointerCss() {
    var out = "";
    ["large", "xl"].forEach(function (p) {
      var sel = 'html[data-oros-pointer="' + p + '"]', px = PX[p];
      out += sel + ", " + sel + " body { cursor: " + cursorUrl("arrow", px) + ", auto; }\n";
      out += CLICK.split(",").map(function (s) { return sel + " " + s.trim(); }).join(", ") +
        " { cursor: " + cursorUrl("hand", px) + ", pointer !important; }\n";
      out += TYPE.split(",").map(function (s) { return sel + " " + s.trim(); }).join(", ") +
        " { cursor: " + cursorUrl("text", px) + ", text !important; }\n";
      out += sel + " :disabled, " + sel + " [aria-disabled=\"true\"] { cursor: " + cursorUrl("arrow", px) + ", default !important; }\n";
    });
    return out;
  }
  // Smart invert: what shows a picture is turned back, so photos and
  // faces look right inside the inverted screen.
  var MEDIA = "img, video, canvas, picture, svg image, object, embed";
  function invertCss() {
    var sel = "html[data-oros-invert]";
    return MEDIA.split(",").map(function (s) { return sel + " " + s.trim(); }).join(", ") +
      " { filter: invert(1) hue-rotate(180deg); }\n" +
      // A picture inside a picture is turned back once only.
      sel + " picture img { filter: none; }\n";
  }
  function css() { return invertCss() + pointerCss(); }

  // ---------- 2. Page (shell document) ----------
  var doc = root.document;
  var overlays = [];
  var lastCfg = null;
  var fadeTimer = 0;

  function svgDefs(d) {
    var s = d.getElementById(SVG_ID);
    if (s) return s;
    var NS = "http://www.w3.org/2000/svg";
    s = d.createElementNS(NS, "svg");
    s.id = SVG_ID;
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
    s.setAttribute("width", "0");
    s.setAttribute("height", "0");
    s.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    ["protan", "deutan", "tritan"].forEach(function (k) {
      var f = d.createElementNS(NS, "filter");
      f.id = "oros-cf-" + k;
      f.setAttribute("color-interpolation-filters", "sRGB");
      var m = d.createElementNS(NS, "feColorMatrix");
      m.setAttribute("type", "matrix");
      m.setAttribute("values", matrixValues(k, 100));
      f.appendChild(m);
      s.appendChild(f);
    });
    (d.body || d.documentElement).appendChild(s);
    return s;
  }
  function finePointer() {
    try { return !!(root.matchMedia && root.matchMedia("(any-pointer: fine)").matches); } catch (e) { return false; }
  }
  function attr(el, name, v) { if (v) el.setAttribute(name, v); else el.removeAttribute(name); }

  // The shell's root: the filter (own + overlays) and its marks.
  function paint(fadeMs) {
    if (!doc) return;
    var r = doc.documentElement, cfg = lastCfg || {};
    var f = cleanFilter(cfg.filter);
    if (CORRECT[f]) {
      var s = svgDefs(doc), m = s.querySelector("#oros-cf-" + f + " feColorMatrix");
      if (m) m.setAttribute("values", matrixValues(f, cfg.strength));
    }
    var v = filterCss(cfg, overlays);
    clearTimeout(fadeTimer);
    if (fadeMs > 0) {
      r.style.transition = "filter " + Math.round(fadeMs) + "ms linear";
      fadeTimer = setTimeout(function () { r.style.removeProperty("transition"); }, fadeMs + 50);
    } else r.style.removeProperty("transition");
    if (v) r.style.filter = v;
    else r.style.removeProperty("filter");
  }
  // Marks one document (the shell or a same-origin app): smart invert
  // and the pointer act through these, with css() injected by shell.js.
  function mark(d) {
    if (!d || !d.documentElement) return;
    var cfg = lastCfg || {};
    attr(d.documentElement, "data-oros-invert", cleanFilter(cfg.filter) === "invert" ? "on" : null);
    var p = cleanPointer(cfg.pointer);
    attr(d.documentElement, "data-oros-pointer", p !== "normal" && finePointer() ? p : null);
  }
  function apply(cfg) {
    lastCfg = { filter: cleanFilter(cfg && cfg.filter), strength: cleanStrength(cfg && cfg.strength),
                pointer: cleanPointer(cfg && cfg.pointer) };
    paint(0);
    mark(doc);
  }
  // A temporary filter of another feature, never stored.
  function overlay(name, kind, opts) {
    name = String(name || "");
    if (!name || (kind && !OVERLAY_CSS[kind])) return false;   // unknown kind: nothing changes
    overlays = overlays.filter(function (o) { return o.name !== name; });
    if (kind) overlays.push({ name: name, kind: kind });
    paint(opts && opts.fadeMs > 0 ? Math.min(opts.fadeMs, 60000) : 0);
    return true;
  }

  root.orosA11yFx = {
    VER: VER, FILTERS: FILTERS, STRENGTHS: STRENGTHS, POINTERS: POINTERS,
    apply: apply, mark: mark, css: css, overlay: overlay, finePointer: finePointer,
    overlays: function () { return overlays.map(function (o) { return o.name + ":" + o.kind; }); },
    // pure, for tests
    _: { matrix3: matrix3, matrixValues: matrixValues, apply3: apply3, ownCss: ownCss, filterCss: filterCss,
         cursorUrl: cursorUrl, pointerCss: pointerCss, invertCss: invertCss, SIM: SIM,
         cleanFilter: cleanFilter, cleanStrength: cleanStrength, cleanPointer: cleanPointer }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.orosA11yFx;
})(typeof window !== "undefined" ? window : globalThis);
