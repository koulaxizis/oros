// ============================================================
// orOS Mockups — scene.js (v1.6.0, ES module)
// The 3D book and its scene, drawn with the vendored three.js
// (vendor/three, MIT). Loaded by mockups.js with import() only
// when the editor opens, so the app list stays light.
//   - the book is rebuilt from MockCore.profile(): the printed cover
//     (or dust jacket) and the hardcover case are extruded from
//     their cross-section, so every size, page count, binding and
//     flap change shows at once; the front piece turns on the hinge
//   - the cover picture is composed on a canvas laid along the arc
//     of the cover (flap, back, spine, front, flap), or one full
//     wrap picture (the printer's sheet of MockCore.template) split
//     panel by panel
//   - sets: every book of MockCore.setList() is built (books that
//     look the same share one texture), posed (standing, lying,
//     leaning, its back to the camera), turned, and laid side by
//     side or stacked; the whole set is framed and turned together
//   - the open book (wave 4): the cover laid open, two halves of the
//     page block whose tops follow MockCore.openCurve() (dipping into
//     the gutter, arching up), the inside pictures on them with a
//     gutter shadow; the e-book: a tablet, phone or e-reader body with
//     its screen showing a page (glowing, or grey e-ink)
//   - bindings (v1.4.0): a saddle-stitched booklet folds round its
//     pages with two staples in the fold; a spiral book has no spine,
//     its two covers are held by a coil of wire loops through holes
//     (MockCore.coilLoops), also across the gutter of the open book
//   - finishes (v1.5.0): foil, spot UV and emboss / deboss from mask
//     pictures (finishMaps: foil colour on the cover, roughness /
//     metalness, clearcoat, bump and iridescence maps in the cover's
//     own layout), cover materials as a bump pattern, rounded corners
//     (an alpha map on the cover, a rounded page block), deckled and
//     printed page edges, a belly band laid along the cover, a
//     slipcase open at the spine, a sticker, a notebook's elastic
//     band, ruled empty pages and a box set round a shelf of books
//   - products (v1.6.0): CD and DVD / Blu-ray from goods/media3d.js,
//     posed, framed, lit and saved like a book; "open" opens a lid
//     or slides a disc out (fronts with userData.open)
//   - turntable frames: drawTo(ctx, w, h, clear, { spin, cam })
//     draws one finished frame with the set turned a little more
//   - floor shadow (shadow catcher + contact shadows), a wall when
//     the book leans, key light + soft fill + a small studio
//     environment for gloss
//   - the background is drawn on a 2D canvas under the 3D canvas
//     (live) and composited under it on export, so what you see is
//     what you save
// Exports createStage(host, MockCore) → stage.
// ============================================================
import * as THREE from "../vendor/three/three.module.min.js";
import { build as buildMedia } from "./goods/media3d.js";

var S = 0.01;                          // scene units per mm

// ---------- Canvas helpers ----------
function canvas(w, h) { var c = document.createElement("canvas"); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
function coverFit(ctx, img, x, y, w, h) {
  var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih || w <= 0 || h <= 0) return;
  var s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}
function shade(hex, k) {
  var c = new THREE.Color(hex);
  if (k > 0) c.lerp(new THREE.Color(1, 1, 1), k); else c.lerp(new THREE.Color(0, 0, 0), -k);
  return "#" + c.getHexString();
}

// The background (also used on export).
export function drawBackground(ctx, w, h, bg, img, keep) {
  if (!keep) ctx.clearRect(0, 0, w, h);
  if (!bg || bg.k === "none") return;
  if (bg.k === "solid") { ctx.fillStyle = bg.c1; ctx.fillRect(0, 0, w, h); return; }
  if (bg.k === "photo") {
    if (img) coverFit(ctx, img, 0, 0, w, h);
    else { ctx.fillStyle = bg.c1; ctx.fillRect(0, 0, w, h); }
    return;
  }
  // gradient, CSS angle: 180 = top → bottom
  var a = (bg.ang - 90) * Math.PI / 180, cx = w / 2, cy = h / 2;
  var r = Math.abs(w / 2 * Math.cos(a)) + Math.abs(h / 2 * Math.sin(a));
  var g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  g.addColorStop(0, bg.c1); g.addColorStop(1, bg.c2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// The printed sheet as one picture, laid along the cover's arc.
// maxPx: the longest side of the texture (smaller for big sets).
export function composeCover(C, bk, art, imgs, maxPx) {
  var cv = composeBase(C, bk, art, imgs, maxPx);
  if (bk.stick && imgs.stick) drawSticker(C, bk, cv, imgs.stick);
  return cv;
}
// The sticker on the front cover, with a soft shadow.
function drawSticker(C, bk, cv, img) {
  var L = C.layout(bk), p = L.panels.filter(function (q) { return q.k === "front"; })[0];
  if (!p) return;
  var ppm = cv.width / L.total, sb = C.stickerBox(bk), kx = p.w / bk.w, ky = cv.height / (L.h * ppm) * (L.h / bk.h);
  var off = (L.h - bk.h) / 2;                        // a hardcover's boards stand out round the pages
  var x = (p.x + sb.x * kx) * ppm, y = (off + sb.y) * ppm * ky, w = sb.w * kx * ppm, h = sb.h * ppm * ky;
  var ctx = cv.getContext("2d");
  function shape() {
    ctx.beginPath();
    if (sb.round) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else { var r = Math.min(w, h) * 0.12; ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  }
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.28)"; ctx.shadowBlur = Math.max(2, w * 0.03); ctx.shadowOffsetY = Math.max(1, w * 0.012);
  shape(); ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.restore();
  ctx.save(); shape(); ctx.clip(); coverFit(ctx, img, x, y, w, h);
  var g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "rgba(255,255,255,0.22)"); g.addColorStop(0.5, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,0.06)");
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.restore();
}
function composeBase(C, bk, art, imgs, maxPx) {
  var L = C.layout(bk), mx = maxPx || 4096;
  var ppm = Math.min(10, mx / L.total, mx / L.h);
  var cv = canvas(Math.round(L.total * ppm), Math.round(L.h * ppm)), ctx = cv.getContext("2d");
  var H = cv.height;
  ctx.fillStyle = art.c; ctx.fillRect(0, 0, cv.width, H);
  if (art.mode === "wrap" && imgs.wrap) {
    // the picture is the printer's sheet (MockCore.template): each
    // panel takes its own part of it
    var im = imgs.wrap, iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    var wm = C.wrapMap(bk, art), sy = iw && ih ? ih * wm.y0 : 0, sh = ih * (wm.y1 - wm.y0);
    wm.panels.forEach(function (m) {
      var p = L.panels.filter(function (q) { return q.k === m.k; })[0];
      if (!p || !(sh > 0)) return;
      ctx.drawImage(im, iw * m.x0, sy, iw * (m.x1 - m.x0), sh, p.x * ppm, 0, p.w * ppm, H);
    });
    return cv;
  }
  L.panels.forEach(function (p) {
    var x = p.x * ppm, w = p.w * ppm, im = imgs[p.k];
    if (im) { ctx.save(); ctx.beginPath(); ctx.rect(x, 0, w, H); ctx.clip(); coverFit(ctx, im, x, 0, w, H); ctx.restore(); return; }
    if (p.k === "flapB" || p.k === "flapF") { ctx.fillStyle = shade(art.c, 0.08); ctx.fillRect(x, 0, w, H); }
    if (p.k === "spine" && art.spT) {
      ctx.save();
      ctx.translate(x + w / 2, H / 2);
      ctx.rotate(Math.PI / 2);                 // reads top → bottom
      var fs = Math.max(6, Math.min(w * 0.55, H * 0.05));
      ctx.font = "700 " + fs + "px Nunito, 'Segoe UI', system-ui, sans-serif";
      ctx.fillStyle = art.spTC; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var txt = art.spT;
      while (txt.length > 1 && ctx.measureText(txt).width > H * 0.86) txt = txt.slice(0, -1);
      if (txt !== art.spT) txt = txt.slice(0, -1) + "…";
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }
  });
  return cv;
}

// ---------- Finishes (v1.5.0) ----------
var FOIL_C = { gold: ["#f6dd8c", "#c89b3c", "#8a6420"], silver: ["#f4f6f8", "#b9bec6", "#7b818a"],
  copper: ["#f2b38a", "#b8693d", "#7a3d1f"], rose: ["#f6d0c4", "#d39a8a", "#9c6457"], holo: ["#eef3f8", "#c9d3df", "#9aa7b6"] };
// Material texture of the cover: { rough, sheen, bump (scale), tint }.
export var TEX_LOOK = {
  paper: { rough: 0, sheen: 0, bump: 0 },
  linen: { rough: 0.94, sheen: 0.35, bump: 1.2 },
  cloth: { rough: 0.9, sheen: 0.5, bump: 1.6 },
  leather: { rough: 0.5, sheen: 0, bump: 1.4 },
  kraft: { rough: 0.93, sheen: 0, bump: 0.8, tint: "#d6b98a" }
};
function rng(seed) { var s = seed || 7; return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
// One tile of the cover material's surface (grey = flat), tw px wide.
function texTile(k, tw) {
  var n = Math.max(12, Math.min(96, Math.round(tw))), cv = canvas(n, n), ctx = cv.getContext("2d"), r = rng(11);
  ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, n, n);
  var i;
  if (k === "linen" || k === "cloth") {
    var step = k === "linen" ? Math.max(2, n / 16) : Math.max(3, n / 10);
    for (i = 0; i < n; i += step) {
      ctx.fillStyle = "rgba(255,255,255," + (0.18 + r() * 0.2) + ")"; ctx.fillRect(0, i, n, step * 0.5);
      ctx.fillStyle = "rgba(0,0,0," + (0.12 + r() * 0.18) + ")"; ctx.fillRect(i, 0, step * 0.5, n);
    }
    if (k === "cloth") for (i = 0; i < n * 2; i++) { ctx.fillStyle = r() > 0.5 ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"; ctx.fillRect(r() * n, r() * n, step, 1); }
  } else if (k === "leather") {
    for (i = 0; i < n * 1.4; i++) {
      var x = r() * n, y = r() * n, rad = n * (0.04 + r() * 0.07), g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, "rgba(255,255,255,0.35)"); g.addColorStop(0.7, "rgba(255,255,255,0.05)"); g.addColorStop(1, "rgba(0,0,0,0.25)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
  } else if (k === "kraft") {
    for (i = 0; i < n * 3; i++) {
      ctx.strokeStyle = r() > 0.5 ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.22)"; ctx.lineWidth = 1;
      var a = r() * Math.PI, l = n * (0.05 + r() * 0.15), x0 = r() * n, y0 = r() * n;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(a) * l, y0 + Math.sin(a) * l); ctx.stroke();
    }
  }
  return cv;
}
// A mask picture laid on the front cover → a canvas whose alpha is the
// effect (the picture's own see-through if it has any, else white).
export function maskOn(C, bk, img, fw, fh) {
  var L = C.layout(bk), p = L.panels.filter(function (q) { return q.k === "front"; })[0];
  var cv = canvas(fw, fh), ctx = cv.getContext("2d");
  if (!p || !img) return cv;
  var ppm = fw / L.total, x = Math.round(p.x * ppm), w = Math.round(p.w * ppm);
  ctx.save(); ctx.beginPath(); ctx.rect(x, 0, w, fh); ctx.clip(); coverFit(ctx, img, x, 0, w, fh); ctx.restore();
  var id = ctx.getImageData(x, 0, Math.max(1, w), fh), d = id.data, clear = false, i;
  for (i = 3; i < d.length; i += 4 * 7) if (d[i] < 245) { clear = true; break; }
  for (i = 0; i < d.length; i += 4) {
    var a = clear ? d[i + 3] : (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * d[i + 3] / 255;
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a;
  }
  ctx.putImageData(id, x, 0);
  return cv;
}
// A colour (or gradient) where the mask is.
function tinted(mask, fill) {
  var cv = canvas(mask.width, mask.height), ctx = cv.getContext("2d");
  ctx.fillStyle = fill; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.globalCompositeOperation = "destination-in"; ctx.drawImage(mask, 0, 0);
  return cv;
}
// The finish maps of one cover (null when there is nothing to add).
// Paints the foil on the cover picture cv itself.
export function finishMaps(C, bk, pics, cv, baseRough, gloss) {
  var foil = pics.foil, uv = pics.uv, emb = pics.emb, look = TEX_LOOK[bk.tex] || TEX_LOOK.paper;
  if (!foil && !uv && !emb && bk.tex === "paper" && !bk.corners) return null;
  var k = Math.min(1, 2048 / Math.max(cv.width, cv.height)), fw = Math.max(2, Math.round(cv.width * k)), fh = Math.max(2, Math.round(cv.height * k));
  var L = C.layout(bk), ppm = fw / L.total, out = {};
  var ctx = cv.getContext("2d");
  if (bk.tex === "kraft") {
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.5; ctx.fillStyle = look.tint; ctx.fillRect(0, 0, cv.width, cv.height); ctx.restore();
  }
  var mF = foil ? maskOn(C, bk, foil, fw, fh) : null, mU = uv ? maskOn(C, bk, uv, fw, fh) : null, mE = emb ? maskOn(C, bk, emb, fw, fh) : null;
  if (mF) {
    var fc = FOIL_C[bk.foilK] || FOIL_C.gold, g = ctx.createLinearGradient(0, 0, cv.width * 0.6, cv.height);
    g.addColorStop(0, fc[0]); g.addColorStop(0.45, fc[1]); g.addColorStop(0.7, fc[0]); g.addColorStop(1, fc[2]);
    var big = canvas(cv.width, cv.height); big.getContext("2d").drawImage(mF, 0, 0, cv.width, cv.height);
    ctx.drawImage(tinted(big, g), 0, 0);
  }
  if (mF || mU || bk.tex !== "paper") {
    // roughness in G, metalness in B
    var orm = canvas(fw, fh), o = orm.getContext("2d");
    o.fillStyle = "rgb(0," + Math.round((look.rough || baseRough) * 255) + ",0)"; o.fillRect(0, 0, fw, fh);
    if (mU) o.drawImage(tinted(mU, "rgb(0,26,0)"), 0, 0);
    if (mF) o.drawImage(tinted(mF, "rgb(0," + (bk.foilK === "holo" ? 46 : 72) + ",210)"), 0, 0);
    out.orm = orm;
  }
  if (mU) {
    var cc = canvas(fw, fh), c2 = cc.getContext("2d");
    c2.fillStyle = gloss ? "#e6e6e6" : "#000000"; c2.fillRect(0, 0, fw, fh);
    c2.drawImage(tinted(mU, "#ffffff"), 0, 0);
    out.cc = cc;
  }
  if (mE || look.bump) {
    var bm = canvas(fw, fh), b = bm.getContext("2d");
    b.fillStyle = "#808080"; b.fillRect(0, 0, fw, fh);
    if (look.bump) { b.globalAlpha = 0.9; b.fillStyle = b.createPattern(texTile(bk.tex, 3 * ppm), "repeat"); b.fillRect(0, 0, fw, fh); b.globalAlpha = 1; }
    if (mE) { b.filter = "blur(" + Math.max(1, ppm * 0.35).toFixed(1) + "px)"; b.drawImage(tinted(mE, bk.embK === "deboss" ? "#000000" : "#ffffff"), 0, 0); b.filter = "none"; }
    out.bump = bm; out.bumpK = mE ? 2.2 : look.bump;
  }
  if (mF && bk.foilK === "holo") out.irid = tinted(mF, "#ffffff");
  if (bk.corners) out.alpha = cornerMask(C, bk, fw, fh);
  return out;
}
// Rounded corners at the fore-edge of the front and the back (alpha).
export function cornerMask(C, bk, fw, fh) {
  var L = C.layout(bk), ppm = fw / L.total, cv = canvas(fw, fh), ctx = cv.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, fw, fh);
  var R = C.CORNER_R * ppm, ky = fh / (L.h * ppm), Ry = R * ky;
  L.panels.forEach(function (p) {
    if (p.k !== "front" && p.k !== "back") return;
    var xe = p.k === "front" ? (p.x + p.w) * ppm : p.x * ppm, dir = p.k === "front" ? -1 : 1;
    [[0, 1], [fh, -1]].forEach(function (c) {
      var cx = xe + dir * R, cy = c[0] + c[1] * Ry;
      ctx.fillStyle = "#000000"; ctx.fillRect(Math.min(xe, cx), Math.min(c[0], cy), R, Ry);
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.ellipse(cx, cy, R, Ry, 0, 0, Math.PI * 2); ctx.fill();
    });
  });
  return cv;
}
// A page block with rounded corners at the fore-edge: a group of the
// sides (page edges) and the two page faces.
function roundBlock(x0, x1, H, zh, r, edgeM, pageM, own) {
  var pts = [], h = H / 2, N = 8, i;
  pts.push([x0, -h]); pts.push([x1 - r, -h]);
  for (i = 1; i <= N; i++) { var a = -Math.PI / 2 + i / N * Math.PI / 2; pts.push([x1 - r + Math.cos(a) * r, -h + r + Math.sin(a) * r]); }
  pts.push([x1, h - r]);
  for (i = 1; i <= N; i++) { var b = i / N * Math.PI / 2; pts.push([x1 - r + Math.cos(b) * r, h - r + Math.sin(b) * r]); }
  pts.push([x0, h]); pts.push([x0, -h]);
  var len = [0];
  for (i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  var tot = len[len.length - 1], pos = [], uv = [], idx = [];
  for (i = 0; i < pts.length; i++) {
    pos.push(pts[i][0] * S, pts[i][1] * S, -zh * S, pts[i][0] * S, pts[i][1] * S, zh * S);
    uv.push(len[i] / tot, 0, len[i] / tot, 1);
    if (i) { var q = (i - 1) * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
  }
  var sg = own(new THREE.BufferGeometry());
  sg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  sg.setIndex(idx); sg.computeVertexNormals();
  var g = new THREE.Group(), side = new THREE.Mesh(sg, edgeM);
  side.castShadow = true; side.receiveShadow = true; g.add(side);
  var sh = new THREE.Shape();
  sh.moveTo(pts[0][0] * S, pts[0][1] * S);
  for (i = 1; i < pts.length; i++) sh.lineTo(pts[i][0] * S, pts[i][1] * S);
  [1, -1].forEach(function (zs) {
    var cap = new THREE.Mesh(own(new THREE.ShapeGeometry(sh)), pageM);
    cap.position.z = zs * zh * S;
    if (zs < 0) cap.rotation.y = Math.PI, cap.position.x = 0, cap.scale.x = -1;
    cap.receiveShadow = true; g.add(cap);
  });
  return g;
}
// A picture (or a colour) stretched over w × h mm.
function picCanvas(img, c, w, h, maxPx) {
  var k = Math.min(8, (maxPx || 1024) / Math.max(w, h)), cv = canvas(Math.round(w * k), Math.round(h * k)), ctx = cv.getContext("2d");
  ctx.fillStyle = c; ctx.fillRect(0, 0, cv.width, cv.height);
  if (img) coverFit(ctx, img, 0, 0, cv.width, cv.height);
  return cv;
}
// Ruled lines on an empty notebook page.
function ruleCanvas(ctx, cw, ch, W, rule) {
  var k = cw / W, i;
  if (rule === "lined") {
    ctx.strokeStyle = "rgba(90,120,160,0.35)"; ctx.lineWidth = Math.max(1, k * 0.25);
    for (i = 22 * k; i < ch - 10 * k; i += 7 * k) { ctx.beginPath(); ctx.moveTo(10 * k, i); ctx.lineTo(cw - 10 * k, i); ctx.stroke(); }
  } else if (rule === "dotted") {
    ctx.fillStyle = "rgba(70,80,95,0.42)";
    for (var y = 10 * k; y < ch - 6 * k; y += 5 * k) for (var x = 8 * k; x < cw - 6 * k; x += 5 * k) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.8, k * 0.3), 0, Math.PI * 2); ctx.fill(); }
  } else if (rule === "grid") {
    ctx.strokeStyle = "rgba(90,120,160,0.28)"; ctx.lineWidth = Math.max(1, k * 0.2);
    for (i = 0; i < ch; i += 5 * k) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(cw, i); ctx.stroke(); }
    for (i = 0; i < cw; i += 5 * k) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, ch); ctx.stroke(); }
  }
}

// Stacked page edges: thin lines across the thickness (deckle: rougher,
// with darker torn patches).
function edgeCanvas(base, across, deckle) {
  var n = 512, cv = across ? canvas(n, deckle ? 64 : 8) : canvas(deckle ? 64 : 8, n), ctx = cv.getContext("2d");
  ctx.fillStyle = base; ctx.fillRect(0, 0, cv.width, cv.height);
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  if (deckle) {
    for (var j = 0; j < 900; j++) {
      ctx.fillStyle = "rgba(60,45,30," + (0.05 + rnd() * 0.12) + ")";
      var lx = rnd() * cv.width, ly = rnd() * cv.height;
      if (across) ctx.fillRect(lx, ly, 1 + rnd() * 2, 2 + rnd() * 10); else ctx.fillRect(lx, ly, 2 + rnd() * 10, 1 + rnd() * 2);
    }
  }
  for (var i = 0; i < n; i += 1) {
    var a = (deckle ? 0.06 : 0.03) + rnd() * (deckle ? 0.16 : 0.09);
    ctx.fillStyle = rnd() > 0.5 ? "rgba(0,0,0," + a + ")" : "rgba(255,255,255," + a + ")";
    if (across) ctx.fillRect(i, 0, 1, 8); else ctx.fillRect(0, i, 8, 1);
  }
  return cv;
}
function stripeCanvas(c) {
  var cv = canvas(16, 64), ctx = cv.getContext("2d");
  for (var i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? "#f3efe4" : c; ctx.fillRect(0, i * 8, 16, 8); }
  return cv;
}
function contactCanvas() {
  var cv = canvas(128, 128), ctx = cv.getContext("2d");
  var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(0.55, "rgba(0,0,0,0.22)"); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return cv;
}


// One inside page: the picture filling the page, a shadow toward the
// gutter. side "l": gutter on the right; "r": on the left.
function pageCanvas(img, W, H, side, paper, maxPx, rule) {
  var k = Math.min(maxPx / H, maxPx / W, 8), cw = Math.round(W * k), ch = Math.round(H * k);
  var cv = canvas(cw, ch), ctx = cv.getContext("2d");
  ctx.fillStyle = paper; ctx.fillRect(0, 0, cw, ch);
  if (img) coverFit(ctx, img, 0, 0, cw, ch);
  else if (rule && rule !== "none") ruleCanvas(ctx, cw, ch, W, rule);
  var gx = side === "l" ? cw : 0, g = ctx.createLinearGradient(gx, 0, side === "l" ? cw * 0.82 : cw * 0.18, 0);
  g.addColorStop(0, "rgba(40,30,20,0.34)"); g.addColorStop(0.35, "rgba(40,30,20,0.10)"); g.addColorStop(1, "rgba(40,30,20,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  return cv;
}
// What the e-book's screen shows: the page inside the screen (contain).
function screenCanvas(C, dv, img, fallback, maxPx) {
  var k = Math.min(maxPx / dv.sh, maxPx / dv.sw), cw = Math.round(dv.sw * k), ch = Math.round(dv.sh * k);
  var cv = canvas(cw, ch), ctx = cv.getContext("2d");
  ctx.fillStyle = dv.ink ? "#e8e6df" : "#ffffff"; ctx.fillRect(0, 0, cw, ch);
  var m = dv.ink ? Math.round(cw * 0.04) : 0;
  if (img) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, r = C.containIn(iw, ih, cw - 2 * m, ch - 2 * m);
    if (dv.ink) ctx.filter = "grayscale(1) contrast(1.08)";
    ctx.drawImage(img, m + r.x, m + r.y, r.w, r.h);
    ctx.filter = "none";
    if (dv.ink) { ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "#e8e6df"; ctx.fillRect(0, 0, cw, ch); ctx.globalCompositeOperation = "source-over"; }
  } else if (fallback) {
    ctx.fillStyle = dv.ink ? "#7a7a78" : fallback.c; ctx.fillRect(m, m, cw - 2 * m, ch - 2 * m);
    if (fallback.t) {
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var fs = Math.round(cw * 0.09);
      ctx.font = "700 " + fs + "px Nunito, 'Segoe UI', system-ui, sans-serif";
      var t = fallback.t;
      while (t.length > 1 && ctx.measureText(t).width > cw * 0.84) t = t.slice(0, -1);
      ctx.fillText(t, cw / 2, ch * 0.42);
    }
  }
  if (dv.k === "phone") { ctx.fillStyle = "#050505"; ctx.beginPath(); ctx.arc(cw / 2, ch * 0.025, cw * 0.022, 0, Math.PI * 2); ctx.fill(); }
  return cv;
}
// A rounded rectangle shape, centred, mm → scene units.
function roundRect(w, h, r) {
  var x = -w / 2 * S, y = -h / 2 * S, W = w * S, H = h * S, R = Math.min(r, w / 2, h / 2) * S;
  var sh = new THREE.Shape();
  sh.moveTo(x + R, y); sh.lineTo(x + W - R, y); sh.quadraticCurveTo(x + W, y, x + W, y + R);
  sh.lineTo(x + W, y + H - R); sh.quadraticCurveTo(x + W, y + H, x + W - R, y + H);
  sh.lineTo(x + R, y + H); sh.quadraticCurveTo(x, y + H, x, y + H - R);
  sh.lineTo(x, y + R); sh.quadraticCurveTo(x, y, x + R, y);
  return sh;
}

// ---------- Geometry ----------
// A piece of sheet (cover, case, jacket) extruded along y. Groups:
// 0 outside (printed), 1 inside, 2 edges (printed, edge rows).
function slab(piece, height, total, flip) {
  var P = piece.pts, N = piece.nrm, T = piece.th, U = piece.u, n = P.length;
  var pos = [], nor = [], uv = [], idx = [], groups = [];
  var y0 = -height / 2 * S, y1 = height / 2 * S;
  function v(x, y, z, nx, ny, nz, uu, vv) { pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(uu, vv); return pos.length / 3 - 1; }
  function out(i) { return [P[i][0] * S, P[i][1] * S]; }
  function inn(i) { return [(P[i][0] - N[i][0] * T[i]) * S, (P[i][1] - N[i][1] * T[i]) * S]; }
  function strip(get, sign, group) {
    var start = idx.length, base = pos.length / 3;
    for (var i = 0; i < n; i++) {
      var p = get(i), uu = U[i] / total;
      v(p[0], y0, p[1], N[i][0] * sign, 0, N[i][1] * sign, uu, 0);
      v(p[0], y1, p[1], N[i][0] * sign, 0, N[i][1] * sign, uu, 1);
    }
    for (var k = 0; k < n - 1; k++) {
      var a = base + k * 2, b = a + 1, c = a + 2, dd = a + 3;
      if (sign > 0) idx.push(a, c, b, b, c, dd); else idx.push(a, b, c, b, dd, c);
    }
    groups.push([start, idx.length - start, group]);
  }
  strip(out, 1, 0);
  strip(inn, -1, 1);
  // top + bottom edges
  var s0 = idx.length;
  [[y1, 1, 1], [y0, -1, 0]].forEach(function (e) {
    var base = pos.length / 3;
    for (var i = 0; i < n; i++) {
      var o = out(i), q = inn(i), uu = U[i] / total;
      v(o[0], e[0], o[1], 0, e[1], 0, uu, e[2]);
      v(q[0], e[0], q[1], 0, e[1], 0, uu, e[2]);
    }
    for (var k = 0; k < n - 1; k++) {
      var a = base + k * 2, b = a + 1, c = a + 2, dd = a + 3;
      if (e[1] > 0) idx.push(a, b, c, b, dd, c); else idx.push(a, c, b, b, c, dd);
    }
  });
  // the two ends
  [[0, -1], [n - 1, 1]].forEach(function (e) {
    var i = e[0], j = i === 0 ? 1 : n - 2;
    var tx = (P[i][0] - P[j][0]), tz = (P[i][1] - P[j][1]), l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    var o = out(i), q = inn(i), uu = U[i] / total, base = pos.length / 3;
    v(o[0], y0, o[1], tx, 0, tz, uu, 0); v(o[0], y1, o[1], tx, 0, tz, uu, 1);
    v(q[0], y0, q[1], tx, 0, tz, uu, 0); v(q[0], y1, q[1], tx, 0, tz, uu, 1);
    if (i === 0) idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    else idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  });
  groups.push([s0, idx.length - s0, 2]);
  var g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  groups.forEach(function (gr) { g.addGroup(gr[0], gr[1], gr[2]); });
  if (flip) g.scale(1, 1, 1);
  return g;
}
// A flat ribbon along a path in the y-z plane, width w (mm) in x.
function ribbonGeo(path, x, w) {
  var pos = [], nor = [], idx = [];
  for (var i = 0; i < path.length; i++) {
    var p = path[i], q = path[Math.min(path.length - 1, i + 1)], r = path[Math.max(0, i - 1)];
    var dy = q[0] - r[0], dz = q[1] - r[1], l = Math.hypot(dy, dz) || 1;
    var ny = -dz / l, nz = dy / l;
    pos.push((x - w / 2) * S, p[0] * S, p[1] * S, (x + w / 2) * S, p[0] * S, p[1] * S);
    nor.push(0, ny, nz, 0, ny, nz);
    if (i) { var a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// A small studio for reflections: a soft box over a grey room.
function studioEnv(renderer) {
  var sc = new THREE.Scene();
  var room = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x5a5d63, side: THREE.BackSide }));
  sc.add(room);
  function panel(w, h, x, y, z, k) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); sc.add(m);
  }
  panel(6, 3, 0, 4.8, 1, 6);
  panel(3, 4, -4.8, 1.5, 2, 2.4);
  panel(3, 4, 4.8, 1, -1, 1.6);
  var pm = new THREE.PMREMGenerator(renderer);
  var rt = pm.fromScene(sc, 0.04);
  pm.dispose();
  return rt.texture;
}

// ---------- The stage ----------
export function createStage(host, C) {
  var bgCv = document.createElement("canvas");
  bgCv.className = "mk-bg";
  var glCv = document.createElement("canvas");
  glCv.className = "mk-gl";
  host.appendChild(bgCv); host.appendChild(glCv);

  var renderer = new THREE.WebGLRenderer({ canvas: glCv, antialias: true, alpha: true, preserveDrawingBuffer: false });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  var gl = renderer.getContext();
  var MAX = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096, (gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [4096])[0] || 4096, 8192);
  var ANISO = renderer.capabilities.getMaxAnisotropy();

  var scene = new THREE.Scene();
  scene.environment = studioEnv(renderer);
  scene.environmentIntensity = 0.35;
  var camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);

  var hemi = new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.1);
  scene.add(hemi);
  var key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.025;
  scene.add(key); scene.add(key.target);

  var floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.5 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  var turnG = new THREE.Group(), setG = new THREE.Group();
  turnG.add(setG); scene.add(turnG);
  var wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.ShadowMaterial({ opacity: 0.4 }));
  wall.receiveShadow = true;
  wall.visible = false;
  turnG.add(wall);
  var contactTex = new THREE.CanvasTexture(contactCanvas());
  var contactMats = [];

  var built = false, owned = [], fronts = [], leanNow = false;
  // p: the project (bk, art, sc, set); pics: asset id → picture
  var state = { p: null, sc: null, pics: {}, bgImg: null, spin: 0 };
  var frame = { R: 1, cy: 0.5 };
  var raf = 0, w = 1, h = 1, sizeKey = "";

  function own(x) { owned.push(x); return x; }
  function disposeBooks() {
    while (setG.children.length) setG.remove(setG.children[0]);
    owned.forEach(function (x) { try { x.dispose(); } catch (e) {} });
    owned = []; fronts = []; contactMats = []; built = false;
  }
  function picsOf(art) {
    var o = {};
    var slots = state.p && C.isGood(state.p) ? C.goodSlots(state.p.kind) : C.SLOTS;
    slots.forEach(function (k) { if (art[k] && state.pics[art[k]]) o[k] = state.pics[art[k]]; });
    return o;
  }

  function materials(bk, art, maxPx) {
    var pics = picsOf(art);
    var cv = composeCover(C, bk, art, pics, maxPx);
    var fin = bk.fin, look = TEX_LOOK[bk.tex] || TEX_LOOK.paper;
    var baseRough = fin === "gloss" ? 0.32 : fin === "soft" ? 0.92 : 0.7;
    var fx = finishMaps(C, bk, pics, cv, baseRough, fin === "gloss");
    var coverTex = own(new THREE.CanvasTexture(cv));
    coverTex.colorSpace = THREE.SRGBColorSpace;
    coverTex.anisotropy = ANISO;
    var opt = {
      map: coverTex,
      roughness: look.rough || baseRough,
      clearcoat: fin === "gloss" && bk.tex === "paper" ? 0.9 : 0,
      clearcoatRoughness: 0.12,
      sheen: look.sheen || (fin === "soft" ? 0.35 : 0), sheenRoughness: 0.9,
      envMapIntensity: fin === "gloss" ? 1.2 : 0.6
    };
    function data(c) { var t = own(new THREE.CanvasTexture(c)); t.anisotropy = ANISO; return t; }
    if (fx) {
      if (fx.orm) { var ot = data(fx.orm); opt.roughnessMap = ot; opt.metalnessMap = ot; opt.roughness = 1; opt.metalness = 1; opt.envMapIntensity = pics.foil ? 1.7 : 1; }
      if (fx.cc) { opt.clearcoat = 1; opt.clearcoatMap = data(fx.cc); opt.clearcoatRoughness = 0.06; }
      if (fx.bump) { opt.bumpMap = data(fx.bump); opt.bumpScale = fx.bumpK; }
      if (fx.irid) { opt.iridescence = 1; opt.iridescenceMap = data(fx.irid); opt.iridescenceIOR = 1.7; opt.iridescenceThicknessRange = [250, 900]; }
      if (fx.alpha) { opt.alphaMap = data(fx.alpha); opt.alphaTest = 0.5; }
    }
    var cover = own(new THREE.MeshPhysicalMaterial(opt));
    var inside = own(new THREE.MeshStandardMaterial({ color: bk.inC, roughness: 0.9, alphaMap: opt.alphaMap || null, alphaTest: opt.alphaMap ? 0.5 : 0 }));
    var cloth = own(new THREE.MeshStandardMaterial({ color: bk.clothC, roughness: 0.95 }));
    var edgeCol = bk.edge === "cream" ? "#efe4c6" : bk.edge === "color" ? bk.edgeC : "#f6f4ee";
    var dk = !!(bk.deckle && C.canHave(bk, "deckle"));
    var eA = own(new THREE.CanvasTexture(edgeCanvas(edgeCol, true, dk)));
    var eB = own(new THREE.CanvasTexture(edgeCanvas(edgeCol, false, dk)));
    eA.colorSpace = eB.colorSpace = THREE.SRGBColorSpace;
    var edgeA = own(new THREE.MeshStandardMaterial({ map: eA, roughness: 0.95 }));   // fore-edge
    var edgeB = own(new THREE.MeshStandardMaterial({ map: eB, roughness: 0.95 }));   // head + tail
    var edgeF = edgeA;
    if (bk.edge === "print" && pics.edgeP) {
      var d = C.dims(bk), eF = own(new THREE.CanvasTexture(picCanvas(pics.edgeP, edgeCol, d.T, d.H, 1024)));
      eF.colorSpace = THREE.SRGBColorSpace; eF.anisotropy = ANISO;
      edgeF = own(new THREE.MeshStandardMaterial({ map: eF, roughness: 0.85 }));
    }
    var page = own(new THREE.MeshStandardMaterial({ color: bk.edge === "cream" ? "#f3ead3" : "#fbfaf6", roughness: 0.95 }));
    return { cover: cover, inside: inside, cloth: cloth, edgeA: edgeA, edgeB: edgeB, edgeF: edgeF, page: page, pics: pics };
  }

  // Belly band, slipcase and elastic band of one book.
  function extras(bk, d, pr, M, g, fInner, front) {
    var sc = state.sc;
    function solid(c, img, w, h) {
      var t = own(new THREE.CanvasTexture(picCanvas(img, c, w, h, 1024)));
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO;
      return own(new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 }));
    }
    if (bk.belly && C.canHave(bk, "belly")) {
      var bh = Math.min(bk.bellyH, d.Hc - 4), off = (d.j || 0) + 0.32, tot = pr.total;
      var bt = own(new THREE.CanvasTexture(picCanvas(M.pics.belly, bk.bellyC, tot, bh, 2048)));
      bt.colorSpace = THREE.SRGBColorSpace; bt.anisotropy = ANISO;
      var bm = own(new THREE.MeshPhysicalMaterial({ map: bt, roughness: 0.55, clearcoat: 0.3 })), bi = own(new THREE.MeshStandardMaterial({ color: bk.bellyC, roughness: 0.9 }));
      var yc = (-d.Hc / 2 + bh / 2 + 0.2) * S;
      [["back", g], ["spine", g], ["front", fInner]].forEach(function (x) {
        var pc = pr.print[x[0]];
        if (d.bind === "sp" && x[0] === "spine") return;
        var piece = { pts: pc.pts.map(function (q, i) { return [q[0] + pc.nrm[i][0] * off, q[1] + pc.nrm[i][1] * off]; }), nrm: pc.nrm,
          th: pc.th.map(function () { return 0.15; }), u: pc.u };
        var m = new THREE.Mesh(own(slab(piece, bh, tot)), [bm, bi, bm]);
        m.position.y = yc; m.castShadow = true; x[1].add(m);
      });
    }
    if (bk.slip && C.canHave(bk, "slip")) {
      front.rotation.y = 0;                       // a book in its case stays shut
      var c = C.slipcase(bk), t = c.t, w = c.x1 - c.x0, cx = (c.x0 + c.x1) / 2;
      var out = solid(bk.slipC, M.pics.slip, w, 2 * c.y), sideM = own(new THREE.MeshStandardMaterial({ color: bk.slipC, roughness: 0.8 }));
      var inM = own(new THREE.MeshStandardMaterial({ color: shade(bk.slipC, -0.35), roughness: 0.9 }));
      var walls = [
        [w, 2 * c.y, t, cx, 0, c.z - t / 2, [sideM, sideM, sideM, sideM, out, inM]],
        [w, 2 * c.y, t, cx, 0, -c.z + t / 2, [sideM, sideM, sideM, sideM, inM, out]],
        [w, t, 2 * c.z, cx, c.y - t / 2, 0, [sideM, sideM, sideM, inM, sideM, sideM]],
        [w, t, 2 * c.z, cx, -c.y + t / 2, 0, [sideM, sideM, inM, sideM, sideM, sideM]],
        [t, 2 * c.y, 2 * c.z, c.x1 - t / 2, 0, 0, [sideM, inM, sideM, sideM, sideM, sideM]]
      ];
      walls.forEach(function (a) {
        var m = new THREE.Mesh(own(new THREE.BoxGeometry(a[0] * S, a[1] * S, a[2] * S)), a[6]);
        m.position.set(a[3] * S, a[4] * S, a[5] * S); m.castShadow = true; m.receiveShadow = true; g.add(m);
      });
    }
    if (bk.elastic && !bk.slip && sc.open < 3 && d.bind !== "sp") {
      var h = d.Hc / 2, z = d.zF + (d.j || 0) + 0.5;
      var path = [[-h - 0.6, 0], [-h, z], [h, z], [h + 0.6, 0], [h, -z], [-h, -z], [-h - 0.6, 0]];
      var em = own(new THREE.MeshPhysicalMaterial({ color: bk.elasticC, roughness: 0.6, sheen: 0.6, sheenRoughness: 0.5, side: THREE.DoubleSide }));
      var el = new THREE.Mesh(own(ribbonGeo(path, d.xE - 16, 8)), em);
      el.castShadow = true; g.add(el);
    }
  }
  // One book → { g, front } (front: the cover piece on the hinge).
  function makeBook(bk, M, placeK) {
    var pr = C.profile(bk), d = pr.d, sc = state.sc;
    var g = new THREE.Group();
    var front = new THREE.Group();
    front.position.set(pr.hinge[0] * S, 0, pr.hinge[1] * S);
    var fInner = new THREE.Group();
    fInner.position.set(-pr.hinge[0] * S, 0, -pr.hinge[1] * S);
    front.add(fInner);
    front.rotation.y = -sc.open * Math.PI / 180;
    function add(piece, height, total, mats, into) {
      var m = new THREE.Mesh(own(slab(piece, height, total)), mats);
      m.castShadow = true; m.receiveShadow = true;
      into.add(m);
    }
    var printM = [M.cover, M.inside, M.cover];
    var jacket = d.hc && d.flaps;
    var ph = jacket ? d.Hc + 0.2 : d.Hc;
    add(pr.print.back, ph, pr.total, printM, g);
    if (d.bind !== "sp") add(pr.print.spine, ph, pr.total, printM, g);
    add(pr.print.front, ph, pr.total, printM, fInner);
    if (d.bind === "ss") {
      // two staples through the fold
      var stM = own(new THREE.MeshStandardMaterial({ color: "#c9ccd1", metalness: 0.9, roughness: 0.32 }));
      var stG = own(new THREE.BoxGeometry(0.5 * S, 12 * S, 0.5 * S));
      [-1, 1].forEach(function (sg) {
        var st = new THREE.Mesh(stG, stM);
        st.position.set((d.xS - d.bulge - 0.05) * S, sg * d.H * 0.27 * S, 0);
        g.add(st);
      });
    }
    if (d.coil) {
      // the coil: one wire loop round the spine edge through each pair of holes
      var cl = d.coil, wireC = { black: "#1b1c1f", silver: "#c4c8ce", white: "#f1f1ee", gold: "#c9a24a" }[bk.wire] || "#1b1c1f";
      var wM = own(new THREE.MeshStandardMaterial({ color: wireC, metalness: bk.wire === "silver" || bk.wire === "gold" ? 0.85 : 0.2, roughness: 0.35 }));
      var tG = own(new THREE.TorusGeometry(cl.r * S, cl.wire * S, 8, 40));
      var hM = own(new THREE.MeshBasicMaterial({ color: "#16171a" }));
      var hG = own(new THREE.CircleGeometry(1.7 * S, 14));
      C.coilLoops(bk).forEach(function (y, i) {
        var ring = new THREE.Mesh(tG, wM);
        ring.rotation.x = Math.PI / 2;
        ring.rotation.y = 0.06;                       // a coil climbs a little each turn
        ring.position.set(cl.x * S, y * S, 0);
        ring.castShadow = true;
        g.add(ring);
        // the holes, on the outside of both covers
        var hf = new THREE.Mesh(hG, hM);
        hf.position.set(d.xH * S, y * S, (d.zF + 0.02) * S);
        fInner.add(hf);
        var hb = new THREE.Mesh(hG, hM);
        hb.rotation.y = Math.PI;
        hb.position.set(d.xH * S, y * S, -(d.zF + 0.02) * S);
        g.add(hb);
      });
    }
    if (pr.caseP) {
      var cm = [M.cloth, M.inside, M.cloth], ct = pr.caseP.front.u[pr.caseP.front.u.length - 1];
      add(pr.caseP.back, d.Hc, ct, cm, g);
      add(pr.caseP.spine, d.Hc, ct, cm, g);
      add(pr.caseP.front, d.Hc, ct, cm, fInner);
    }
    // page block: +x fore-edge, -x spine, +y head, -y tail, +z/-z pages
    var bw = d.block.x1 - d.block.x0, bz = d.block.z * 2;
    if (bk.corners) {
      g.add(roundBlock(d.block.x0, d.block.x1, d.H, bz / 2, Math.max(1, C.CORNER_R - d.o), M.edgeB, M.page, own));
    } else {
      var blk = new THREE.Mesh(own(new THREE.BoxGeometry(bw * S, d.H * S, bz * S)),
        [M.edgeF, M.edgeA, M.edgeB, M.edgeB, M.page, M.page]);
      blk.position.x = (d.block.x0 + bw / 2) * S;
      blk.castShadow = true; blk.receiveShadow = true;
      g.add(blk);
    }
    extras(bk, d, pr, M, g, fInner, front);
    if (d.hc && bk.band) {
      var bt = own(new THREE.CanvasTexture(stripeCanvas(bk.bandC)));
      bt.colorSpace = THREE.SRGBColorSpace;
      var bm = own(new THREE.MeshStandardMaterial({ map: bt, roughness: 0.6 }));
      [1, -1].forEach(function (sgn) {
        var cyl = new THREE.Mesh(own(new THREE.CylinderGeometry(0.9 * S, 0.9 * S, bz * S, 10)), bm);
        cyl.rotation.x = Math.PI / 2;
        cyl.position.set((d.block.x0 + 0.9) * S, sgn * (d.H / 2 + 0.3) * S, 0);
        g.add(cyl);
      });
    }
    if (d.hc && bk.ribbon) {
      var rx = d.block.x0 + bw * 0.32, yb = -d.H / 2;
      var path = placeK === "lie"
        ? [[yb + 6, 0], [yb - 6, 0.6], [yb - 26, 1.2]]
        : [[yb + 6, 0], [yb - 0.2, 0.1], [-d.Hc / 2 + 0.2, 1.8], [-d.Hc / 2 + 0.2, d.zF + 22]];
      var rm = own(new THREE.MeshStandardMaterial({ color: bk.ribC, roughness: 0.55, side: THREE.DoubleSide }));
      var rib = new THREE.Mesh(own(ribbonGeo(path, rx, 5)), rm);
      rib.castShadow = true;
      g.add(rib);
    }
    g.add(front);
    return { g: g, front: front };
  }
  // Bounds of the books only (contact shadows left out).
  function boxOf(o) {
    o.updateMatrixWorld(true);
    var box = new THREE.Box3(), tmp = new THREE.Box3();
    o.traverse(function (x) {
      if (!x.isMesh || x.userData.skip) return;
      if (!x.geometry.boundingBox) x.geometry.computeBoundingBox();
      tmp.copy(x.geometry.boundingBox).applyMatrix4(x.matrixWorld);
      box.union(tmp);
    });
    return box;
  }


  // The open book, lying open on the floor: tail toward +z.
  function makeOpen(p) {
    var bk = p.bk, d = C.dims(bk), ins = p.ins, W = bk.w, H = bk.h, g = new THREE.Group();
    var M = materials(bk, p.art, 1024);
    var paper = bk.edge === "cream" ? "#f3ead3" : "#fbfaf6";
    var hc = d.hc, bt = hc ? d.b : d.c, bw = hc ? W + d.o - 1.5 : W, bh = hc ? H + 2 * d.o : H, gap = hc ? 1.5 : 0;
    var coverC = own(new THREE.MeshStandardMaterial({ color: hc ? bk.clothC : p.art.c, roughness: 0.8 }));
    // the open cover (boards), inside up
    [-1, 1].forEach(function (sg) {
      var b = new THREE.Mesh(own(new THREE.BoxGeometry(bw * S, bt * S, bh * S)), [coverC, coverC, M.inside, coverC, coverC, coverC]);
      b.position.set(sg * (gap + bw / 2) * S, bt / 2 * S, 0);
      b.castShadow = true; b.receiveShadow = true;
      g.add(b);
    });
    if (hc) {
      var sp = new THREE.Mesh(own(new THREE.BoxGeometry((2 * gap + 2) * S, 0.8 * S, bh * S)), coverC);
      sp.position.set(0, 0.4 * S, 0); sp.receiveShadow = true;
      g.add(sp);
    }
    // the two halves of the page block
    var cur = C.openCurve(bk, ins.curl, 36), base = bt, n = cur.length;
    var pics = state.pics;
    function half(sg, img, side) {
      var tex = own(new THREE.CanvasTexture(pageCanvas(img, W, H, side, paper, 2048, ins.rule)));
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = ANISO;
      var mat = own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, side: THREE.DoubleSide }));
      var pos = [], uv = [], idx = [];
      for (var i = 0; i < n; i++) {
        var x = sg * cur[i][0] * S, y = (base + cur[i][1]) * S, u = i / (n - 1);
        pos.push(x, y, -H / 2 * S, x, y, H / 2 * S);
        var tu = sg > 0 ? u : 1 - u;
        uv.push(tu, 1, tu, 0);
        if (i) { var a = (i - 1) * 2; if (sg > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      var geo = own(new THREE.BufferGeometry());
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      var top = new THREE.Mesh(geo, mat);
      top.castShadow = true; top.receiveShadow = true;
      g.add(top);
      // walls: head and tail follow the curve, the fore-edge is flat
      var wp = [], wi = [];
      [-1, 1].forEach(function (zs) {
        var b0 = wp.length / 3;
        for (var i = 0; i < n; i++) {
          var x = sg * cur[i][0] * S;
          wp.push(x, base * S, zs * H / 2 * S, x, (base + cur[i][1]) * S, zs * H / 2 * S);
          if (i) { var a = b0 + (i - 1) * 2; wi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        }
      });
      var e = cur[n - 1], xe = sg * e[0] * S, b1 = wp.length / 3;
      wp.push(xe, base * S, -H / 2 * S, xe, (base + e[1]) * S, -H / 2 * S, xe, base * S, H / 2 * S, xe, (base + e[1]) * S, H / 2 * S);
      wi.push(b1, b1 + 2, b1 + 1, b1 + 1, b1 + 2, b1 + 3);
      var wg = own(new THREE.BufferGeometry());
      wg.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
      wg.setIndex(wi); wg.computeVertexNormals();
      var wm = own(new THREE.MeshStandardMaterial({ color: paper, roughness: 0.95, side: THREE.DoubleSide }));
      var wall = new THREE.Mesh(wg, wm);
      wall.castShadow = true; wall.receiveShadow = true;
      g.add(wall);
    }
    half(-1, pics[ins.l] || null, "l");
    half(1, pics[ins.r] || null, "r");
    if (d.coil) {
      // spiral: the loops stand across the gutter
      var wireC = { black: "#1b1c1f", silver: "#c4c8ce", white: "#f1f1ee", gold: "#c9a24a" }[bk.wire] || "#1b1c1f";
      var wM = own(new THREE.MeshStandardMaterial({ color: wireC, metalness: bk.wire === "silver" || bk.wire === "gold" ? 0.85 : 0.2, roughness: 0.35 }));
      var top = base + cur[0][1], rr = Math.max(4, top * 0.6 + 2);
      var tG = own(new THREE.TorusGeometry(rr * S, d.coil.wire * S, 8, 32));
      C.coilLoops(bk).forEach(function (y) {
        var ring = new THREE.Mesh(tG, wM);
        ring.position.set(0, (top - rr * 0.35) * S, -y * S);
        ring.castShadow = true;
        g.add(ring);
      });
    }
    return g;
  }
  // The e-book: a device standing, screen to +z.
  function makeDevice(p) {
    var ins = p.ins, dv = C.device(ins.dev), g = new THREE.Group();
    var col = ins.dc === "white" ? "#eeeeec" : ins.dc === "silver" ? "#c4c7cc" : "#1c1d21";
    var body = own(new THREE.MeshPhysicalMaterial({ color: col, roughness: ins.dc === "silver" ? 0.3 : 0.45,
      metalness: ins.dc === "silver" ? 0.75 : 0.05, clearcoat: ins.dc === "silver" ? 0 : 0.4 }));
    var bev = Math.min(1.4, dv.d * 0.2);
    var geo = own(new THREE.ExtrudeGeometry(roundRect(dv.w - 2 * bev, dv.h - 2 * bev, dv.r - bev),
      { depth: (dv.d - 2 * bev) * S, bevelEnabled: true, bevelThickness: bev * S, bevelSize: bev * S, bevelSegments: 4, curveSegments: 10 }));
    geo.translate(0, 0, -(dv.d - 2 * bev) / 2 * S);
    var m = new THREE.Mesh(geo, body);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    var zf = dv.d / 2 * S;
    var bez = own(new THREE.MeshPhysicalMaterial({ color: ins.dc === "white" ? "#f4f4f2" : "#0b0b0d", roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }));
    var face = new THREE.Mesh(own(new THREE.ShapeGeometry(roundRect(dv.w - 1.2, dv.h - 1.2, dv.r - 0.6), 10)), bez);
    face.position.z = zf + 0.0004;
    g.add(face);
    var pics = state.pics, art = p.art;
    var img = pics[ins.scr] || pics[ins.r] || (art.front && pics[art.front]) || null;
    var tex = own(new THREE.CanvasTexture(screenCanvas(C, dv, img, { c: art.c, t: p.nm || art.spT }, 2048)));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = ANISO;
    var smat = dv.ink
      ? own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }))
      : own(new THREE.MeshPhysicalMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.78, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 }));
    var scr = new THREE.Mesh(own(new THREE.PlaneGeometry(dv.sw * S, dv.sh * S)), smat);
    scr.position.set(dv.sx * S, dv.sy * S, zf + 0.0008);
    g.add(scr);
    return g;
  }
  // One open book or device on the floor (no set).
  function buildOne() {
    disposeBooks();
    var p = state.p, open = p.show === "open", placeK = open ? "flat" : p.sc.place;
    var obj = open ? makeOpen(p) : makeDevice(p);
    var pose = new THREE.Group();
    pose.add(obj);
    if (placeK === "lie") pose.rotation.x = -Math.PI / 2;
    else if (placeK === "lean") pose.rotation.x = -0.24;
    else if (placeK === "stand") pose.rotation.x = -0.12;     // a device on its stand
    var pb = boxOf(pose), pc = pb.getCenter(new THREE.Vector3()), ps = pb.getSize(new THREE.Vector3());
    pose.position.set(-pc.x, -pb.min.y, -pc.z);
    var slot = new THREE.Group();
    slot.add(pose);
    var cm = own(new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.5 }));
    var ct = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), cm);
    ct.rotation.x = -Math.PI / 2; ct.position.y = 0.0005;
    ct.scale.set(ps.x * 1.25, ps.z * 1.25 + (placeK === "lie" || placeK === "flat" ? 0 : 0.1), 1);
    ct.renderOrder = 1; ct.userData.skip = true;
    slot.add(ct); contactMats.push(cm);
    setG.add(slot);
    leanNow = placeK === "lean";
    built = true;
    place();
  }

  // A product (CD, DVD…), posed on the floor like one book.
  function buildGood() {
    disposeBooks();
    var p = state.p, placeK = p.sc.place;
    var H = { THREE: THREE, S: S, own: own, ANISO: ANISO, pics: picsOf(p.art), MP: (typeof window !== "undefined" && window.MockPrint) || null, C: C };
    var res = buildMedia(H, p);
    if (!res) { built = false; return; }
    res.fronts.forEach(function (f) { fronts.push(f); });
    var pose = new THREE.Group();
    pose.add(res.g);
    if (placeK === "lie") pose.rotation.x = -Math.PI / 2;
    else if (placeK === "lean") pose.rotation.x = -0.24;
    var pb = boxOf(pose), pc = pb.getCenter(new THREE.Vector3()), ps = pb.getSize(new THREE.Vector3());
    pose.position.set(-pc.x, -pb.min.y, -pc.z);
    var slot = new THREE.Group();
    slot.add(pose);
    var cm = own(new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.5 }));
    var ct = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), cm);
    ct.rotation.x = -Math.PI / 2; ct.position.y = 0.0005;
    ct.scale.set(ps.x * 1.2, ps.z * 1.2 + (placeK === "lie" ? 0 : 0.08), 1);
    ct.renderOrder = 1; ct.userData.skip = true;
    slot.add(ct); contactMats.push(cm);
    setG.add(slot);
    leanNow = placeK === "lean";
    built = true;
    openFronts(p.sc.open);
    place();
  }
  function openFronts(deg) {
    fronts.forEach(function (f) {
      if (f.userData && typeof f.userData.open === "function") f.userData.open(deg);
      else f.rotation.y = -deg * Math.PI / 180;
    });
  }

  // Every book of the set, posed and laid out.
  function buildSet() {
    if (C.isGood(state.p)) { buildGood(); return; }
    if (state.p.show === "open" || state.p.show === "ebook") { buildOne(); return; }
    disposeBooks();
    var p = state.p, list = C.setList(p), maxPx = list.length > 2 ? 2048 : 4096, mats = {};
    var gap = (p.set ? p.set.gap : 0) * S, kind = p.set ? p.set.k : "one", cursor = 0;
    list.forEach(function (it, n) {
      var v = C.volume(p, it.i), key = C.canon([v.bk, v.art]);
      var M = mats[key] || (mats[key] = materials(v.bk, v.art, maxPx));
      var b = makeBook(v.bk, M, it.place);
      fronts.push(b.front);
      if (it.back) b.g.rotation.y = Math.PI;
      var pose = new THREE.Group();
      pose.add(b.g);
      if (it.place === "lie") pose.rotation.x = -Math.PI / 2;
      else if (it.place === "lean") pose.rotation.x = -0.24;
      var pb = boxOf(pose), pc = pb.getCenter(new THREE.Vector3()), ps = pb.getSize(new THREE.Vector3());
      pose.position.set(-pc.x, -pb.min.y, -pc.z);
      var slot = new THREE.Group();
      slot.add(pose);
      if (kind !== "stack" || n === 0) {
        var cm = own(new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.5 }));
        var ct = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), cm);
        ct.rotation.x = -Math.PI / 2;
        ct.position.y = 0.0005;
        ct.scale.set(ps.x * 1.35, ps.z * 1.35 + (it.place === "lie" ? 0 : 0.12), 1);
        ct.renderOrder = 1;
        ct.userData.skip = true;
        slot.add(ct);
        contactMats.push(cm);
      }
      slot.rotation.y = it.yaw * Math.PI / 180;
      var sb = boxOf(slot);
      if (kind === "stack") {
        slot.position.set(it.dx * S, cursor - sb.min.y, -(sb.min.z + sb.max.z) / 2);
        cursor += sb.max.y - sb.min.y;
      } else {
        // side by side, fronts (or spines) in one line
        slot.position.set(cursor - sb.min.x, 0, -sb.max.z);
        cursor += sb.max.x - sb.min.x + gap;
      }
      setG.add(slot);
    });
    if (kind === "box") boxSet(p);
    leanNow = list.some(function (it) { return it.place === "lean"; });
    built = true;
    place();
  }
  // A box set: a box round the shelf of books, open toward the spines.
  function boxSet(p) {
    var bk = p.bk, pics = picsOf(p.art), t = 2.5 * S, m = 0.8 * S;
    setG.updateMatrixWorld(true);
    var box = boxOf(setG).applyMatrix4(setG.matrixWorld.clone().invert()), sz = box.getSize(new THREE.Vector3());
    setG.children.forEach(function (c) { c.position.y += t; });
    var x0 = box.min.x - m - t, x1 = box.max.x + m + t, y1 = box.max.y + t + m + t, z0 = box.min.z - m - t, z1 = box.max.z;
    var W = x1 - x0, D = z1 - z0;
    var tex = own(new THREE.CanvasTexture(picCanvas(pics.slip || null, bk.slipC, D / S, y1 / S, 1024)));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = ANISO;
    var out = own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 })), sideM = own(new THREE.MeshStandardMaterial({ color: bk.slipC, roughness: 0.8 }));
    var inM = own(new THREE.MeshStandardMaterial({ color: shade(bk.slipC, -0.35), roughness: 0.9 }));
    [
      [t, y1, D, x0 + t / 2, y1 / 2, (z0 + z1) / 2, [inM, out, sideM, sideM, sideM, sideM]],
      [t, y1, D, x1 - t / 2, y1 / 2, (z0 + z1) / 2, [out, inM, sideM, sideM, sideM, sideM]],
      [W, t, D, (x0 + x1) / 2, y1 - t / 2, (z0 + z1) / 2, [sideM, sideM, sideM, inM, sideM, sideM]],
      [W, t, D, (x0 + x1) / 2, t / 2, (z0 + z1) / 2, [sideM, sideM, inM, sideM, sideM, sideM]],
      [W, y1, t, (x0 + x1) / 2, y1 / 2, z0 + t / 2, [sideM, sideM, sideM, sideM, inM, sideM]]
    ].forEach(function (a) {
      var w = new THREE.Mesh(own(new THREE.BoxGeometry(a[0], a[1], a[2])), a[6]);
      w.position.set(a[3], a[4], a[5]); w.castShadow = true; w.receiveShadow = true; setG.add(w);
    });
    void sz;
  }

  // The set on the floor + framing.
  function place() {
    if (!built) return;
    var sc = state.sc;
    turnG.rotation.y = 0;
    setG.position.set(0, 0, 0);
    var box = boxOf(setG), c = box.getCenter(new THREE.Vector3());
    setG.position.set(-c.x, -box.min.y, -c.z);
    box = boxOf(setG);
    wall.visible = leanNow;
    wall.position.set(0, 15, box.min.z - 0.0002);
    var size = box.getSize(new THREE.Vector3());
    frame.R = Math.max(size.x, size.y, size.z) * 0.56 + 0.03;
    frame.cy = (box.min.y + box.max.y) / 2;
    turn();
    lights();
  }
  function turn() { turnG.rotation.y = (state.sc.turn + state.spin) * Math.PI / 180; }

  function lights() {
    var li = state.sc.light, R = frame.R;
    var az = li.az * Math.PI / 180, el = li.el * Math.PI / 180, D = R * 8;
    key.position.set(Math.sin(az) * Math.cos(el) * D, Math.sin(el) * D, Math.cos(az) * Math.cos(el) * D);
    key.target.position.set(0, frame.cy, 0);
    var warm = li.warm, col = new THREE.Color(1, 1, 1);
    if (warm > 0) col.lerp(new THREE.Color("#ffcf96"), warm * 0.8); else col.lerp(new THREE.Color("#cfe0ff"), -warm * 0.8);
    key.color.copy(col);
    key.intensity = 2.6 * li.str;
    hemi.intensity = 0.55 + 0.75 * (1 - li.soft * 0.4);
    var sh = key.shadow.camera, e = R * 3;
    sh.left = -e; sh.right = e; sh.top = e; sh.bottom = -e; sh.near = R * 2; sh.far = R * 16;
    sh.updateProjectionMatrix();
    key.shadow.radius = 1 + li.soft * 14;
    key.shadow.blurSamples = 16;
    floor.material.opacity = state.sc.shadow * (0.9 - li.soft * 0.35);
    wall.material.opacity = state.sc.shadow * 0.7;
    contactMats.forEach(function (m) { m.opacity = state.sc.shadow * 0.85; });
  }

  function aimCamera(cw, ch, camO) {
    var cam = camO || state.sc.cam, R = frame.R;
    camera.fov = cam.fov;
    camera.aspect = cw / ch;
    var half = cam.fov * Math.PI / 360;
    var fit = Math.min(1, camera.aspect);                // keep the book inside a tall frame too
    var dist = R / Math.sin(half) / fit / cam.zoom;
    var th = cam.th * Math.PI / 180, ph = cam.ph * Math.PI / 180;
    var dir = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.sin(ph), Math.cos(th) * Math.cos(ph));
    var target = new THREE.Vector3(0, frame.cy, 0);
    var right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    var up = new THREE.Vector3().crossVectors(dir, right).normalize();
    target.addScaledVector(right, -cam.dx * R * 1.2).addScaledVector(up, -cam.dy * R * 1.2);
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.near = Math.max(0.005, dist - R * 6);
    camera.far = dist + R * 30;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }

  function drawBg(cv, cw, ch) {
    if (cv.width !== cw) cv.width = cw;
    if (cv.height !== ch) cv.height = ch;
    drawBackground(cv.getContext("2d"), cw, ch, state.sc.bg, state.bgImg);
  }

  function setSize(cw, ch, dpr) {
    var k = cw + "x" + ch + "@" + dpr;
    if (k === sizeKey) return;
    sizeKey = k;
    renderer.setPixelRatio(dpr);
    renderer.setSize(cw, ch, false);
  }
  function renderNow() {
    raf = 0;
    if (!built) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    setSize(w, h, dpr);
    drawBg(bgCv, Math.round(w * dpr), Math.round(h * dpr));
    aimCamera(w, h);
    renderer.render(scene, camera);
  }
  function request() { if (!raf) raf = requestAnimationFrame(renderNow); }
  // One finished frame into ctx (ow × oh, at most MAX): background +
  // the set. o: { spin (degrees more turn), cam (another camera),
  // under (a colour below a see-through background, for video) }.
  function drawTo(ctx, ow, oh, clear, o) {
    o = o || {};
    if (o.under) { ctx.fillStyle = o.under; ctx.fillRect(0, 0, ow, oh); }
    if (!clear) drawBackground(ctx, ow, oh, state.sc.bg, state.bgImg, !!o.under);
    else if (!o.under) ctx.clearRect(0, 0, ow, oh);
    if (!built) return;
    var spin = state.spin;
    state.spin = o.spin || 0;
    turn();
    setSize(ow, oh, 1);
    aimCamera(ow, oh, o.cam);
    renderer.render(scene, camera);
    ctx.drawImage(glCv, 0, 0, ow, oh);
    state.spin = spin;
    turn();
  }

  // ---------- Public ----------
  var stage = {
    MAX: MAX,
    // Full update: the set's shape, pictures, scene.
    // pics: asset id → picture (every picture the project names).
    set: function (p, pics, bgImg) {
      state.p = p; state.sc = p.sc;
      state.pics = pics || {}; state.bgImg = bgImg || null;
      buildSet();
      request();
    },
    // Scene-only update (camera, light, background, turn, open, place).
    scene: function (sc, bgImg, rebuild) {
      var placeChanged = !state.sc || sc.place !== state.sc.place;
      state.sc = sc;
      if (state.p) state.p = Object.assign({}, state.p, { sc: sc });
      if (bgImg !== undefined) state.bgImg = bgImg;
      if (state.p && (rebuild || placeChanged)) { buildSet(); request(); return; }
      openFronts(sc.open);
      place();
      request();
    },
    resize: function (cw, ch) { w = Math.max(1, cw | 0); h = Math.max(1, ch | 0); request(); },
    render: request,
    // The largest frame this device draws for ow × oh.
    fit: function (ow, oh) {
      var k = Math.min(1, MAX / Math.max(ow, oh));
      return { w: Math.round(ow * k), h: Math.round(oh * k), scaled: k < 1 };
    },
    drawTo: drawTo,
    // A finished picture: background + the set, width × height px.
    snapshot: function (ow, oh, transparent, o) {
      var f = stage.fit(ow, oh);
      var out = canvas(f.w, f.h);
      drawTo(out.getContext("2d"), f.w, f.h, !!transparent, o);
      renderNow();
      return { canvas: out, scaled: f.scaled };
    },
    radius: function () { return frame.R; },
    destroy: function () {
      disposeBooks();
      try { contactTex.dispose(); } catch (e) {}
      try { scene.environment.dispose(); } catch (e) {}
      renderer.dispose();
      host.textContent = "";
    }
  };
  return stage;
}
