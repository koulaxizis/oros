// ============================================================
// orOS Mockups — scene.js (v1.0.0, ES module)
// The 3D book and its scene, drawn with the vendored three.js
// (vendor/three, MIT). Loaded by mockups.js with import() only
// when the editor opens, so the app list stays light.
//   - the book is rebuilt from MockCore.profile(): the printed cover
//     (or dust jacket) and the hardcover case are extruded from
//     their cross-section, so every size, page count, binding and
//     flap change shows at once; the front piece turns on the hinge
//   - the cover picture is composed on a canvas laid along the arc
//     of the cover (flap, back, spine, front, flap), or one full
//     wrap picture split by the real spine width
//   - floor shadow (shadow catcher + contact shadow), a wall when
//     the book leans, key light + soft fill + a small studio
//     environment for gloss
//   - the background is drawn on a 2D canvas under the 3D canvas
//     (live) and composited under it on export, so what you see is
//     what you save
// Exports createStage(host, MockCore) → stage.
// ============================================================
import * as THREE from "../vendor/three/three.module.min.js";

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
export function drawBackground(ctx, w, h, bg, img) {
  ctx.clearRect(0, 0, w, h);
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
export function composeCover(C, bk, art, imgs) {
  var L = C.layout(bk), d = C.dims(bk);
  var ppm = Math.min(10, 4096 / L.total, 4096 / L.h);
  var cv = canvas(Math.round(L.total * ppm), Math.round(L.h * ppm)), ctx = cv.getContext("2d");
  var H = cv.height;
  ctx.fillStyle = art.c; ctx.fillRect(0, 0, cv.width, H);
  if (art.mode === "wrap" && imgs.wrap) {
    var im = imgs.wrap, iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    var bl = art.bleed >= 0 ? art.bleed : d.bleed;
    var fx = bl / (L.total + 2 * bl), fy = bl / (L.h + 2 * bl);
    ctx.drawImage(im, iw * fx, ih * fy, iw * (1 - 2 * fx), ih * (1 - 2 * fy), 0, 0, cv.width, H);
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

// Stacked page edges: thin lines across the thickness.
function edgeCanvas(base, across) {
  var n = 512, cv = across ? canvas(n, 8) : canvas(8, n), ctx = cv.getContext("2d");
  ctx.fillStyle = base; ctx.fillRect(0, 0, cv.width, cv.height);
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  for (var i = 0; i < n; i += 1) {
    var a = 0.03 + rnd() * 0.09;
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
  var contactTex = new THREE.CanvasTexture(contactCanvas());
  var contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.5 }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.0005;
  contact.renderOrder = 1;
  scene.add(contact);

  var turnG = new THREE.Group(), placeG = new THREE.Group();
  turnG.add(placeG); scene.add(turnG);
  var wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.ShadowMaterial({ opacity: 0.4 }));
  wall.receiveShadow = true;
  wall.visible = false;
  turnG.add(wall);

  var book = null, owned = [], coverTex = null;
  var state = { bk: null, art: null, sc: null, imgs: {}, bgImg: null };
  var frame = { R: 1, cy: 0.5 };
  var dirty = false, raf = 0, w = 1, h = 1;

  function own(x) { owned.push(x); return x; }
  function disposeBook() {
    if (book) placeG.remove(book);
    owned.forEach(function (x) { try { x.dispose(); } catch (e) {} });
    owned = []; book = null; coverTex = null;
  }

  function materials(bk, art) {
    var cv = composeCover(C, bk, art, state.imgs);
    coverTex = own(new THREE.CanvasTexture(cv));
    coverTex.colorSpace = THREE.SRGBColorSpace;
    coverTex.anisotropy = ANISO;
    var fin = bk.fin;
    var cover = own(new THREE.MeshPhysicalMaterial({
      map: coverTex,
      roughness: fin === "gloss" ? 0.32 : fin === "soft" ? 0.92 : 0.7,
      clearcoat: fin === "gloss" ? 0.9 : 0,
      clearcoatRoughness: 0.12,
      sheen: fin === "soft" ? 0.35 : 0, sheenRoughness: 0.9,
      envMapIntensity: fin === "gloss" ? 1.2 : 0.6
    }));
    var inside = own(new THREE.MeshStandardMaterial({ color: bk.inC, roughness: 0.9 }));
    var cloth = own(new THREE.MeshStandardMaterial({ color: bk.clothC, roughness: 0.95 }));
    var edgeCol = bk.edge === "cream" ? "#efe4c6" : bk.edge === "color" ? bk.edgeC : "#f6f4ee";
    var eA = own(new THREE.CanvasTexture(edgeCanvas(edgeCol, true)));
    var eB = own(new THREE.CanvasTexture(edgeCanvas(edgeCol, false)));
    eA.colorSpace = eB.colorSpace = THREE.SRGBColorSpace;
    var edgeA = own(new THREE.MeshStandardMaterial({ map: eA, roughness: 0.95 }));   // fore-edge
    var edgeB = own(new THREE.MeshStandardMaterial({ map: eB, roughness: 0.95 }));   // head + tail
    var page = own(new THREE.MeshStandardMaterial({ color: bk.edge === "cream" ? "#f3ead3" : "#fbfaf6", roughness: 0.95 }));
    return { cover: cover, inside: inside, cloth: cloth, edgeA: edgeA, edgeB: edgeB, page: page };
  }

  function buildBook() {
    disposeBook();
    var bk = state.bk, art = state.art, sc = state.sc;
    var pr = C.profile(bk), d = pr.d, M = materials(bk, art);
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
    add(pr.print.spine, ph, pr.total, printM, g);
    add(pr.print.front, ph, pr.total, printM, fInner);
    if (pr.caseP) {
      var cm = [M.cloth, M.inside, M.cloth], ct = pr.caseP.front.u[pr.caseP.front.u.length - 1];
      add(pr.caseP.back, d.Hc, ct, cm, g);
      add(pr.caseP.spine, d.Hc, ct, cm, g);
      add(pr.caseP.front, d.Hc, ct, cm, fInner);
    }
    // page block: +x fore-edge, -x spine, +y head, -y tail, +z/-z pages
    var bw = d.block.x1 - d.block.x0, bz = d.block.z * 2;
    var blk = new THREE.Mesh(own(new THREE.BoxGeometry(bw * S, d.H * S, bz * S)),
      [M.edgeA, M.edgeA, M.edgeB, M.edgeB, M.page, M.page]);
    blk.position.x = (d.block.x0 + bw / 2) * S;
    blk.castShadow = true; blk.receiveShadow = true;
    g.add(blk);
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
      var path = sc.place === "lie"
        ? [[yb + 6, 0], [yb - 6, 0.6], [yb - 26, 1.2]]
        : [[yb + 6, 0], [yb - 0.2, 0.1], [-d.Hc / 2 + 0.2, 1.8], [-d.Hc / 2 + 0.2, d.zF + 22]];
      var rm = own(new THREE.MeshStandardMaterial({ color: bk.ribC, roughness: 0.55, side: THREE.DoubleSide }));
      var rib = new THREE.Mesh(own(ribbonGeo(path, rx, 5)), rm);
      rib.castShadow = true;
      g.add(rib);
    }
    g.add(front);
    book = g;
    placeG.add(book);
    place();
  }

  // Placement on the floor + framing.
  function place() {
    if (!book) return;
    var sc = state.sc;
    turnG.rotation.y = 0;
    placeG.rotation.set(0, 0, 0);
    placeG.position.set(0, 0, 0);
    if (sc.place === "lie") placeG.rotation.x = -Math.PI / 2;
    else if (sc.place === "lean") placeG.rotation.x = -0.24;
    placeG.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(placeG);
    var c = box.getCenter(new THREE.Vector3());
    placeG.position.set(-c.x, -box.min.y, -c.z);
    placeG.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(placeG);
    wall.visible = sc.place === "lean";
    wall.position.set(0, 15, box.min.z - 0.0002);
    var size = box.getSize(new THREE.Vector3());
    contact.scale.set(size.x * 1.35, size.z * 1.35 + (sc.place === "lie" ? 0 : 0.12), 1);
    contact.position.set(0, 0.0005, (box.min.z + box.max.z) / 2);
    turnG.rotation.y = sc.turn * Math.PI / 180;
    contact.rotation.z = turnG.rotation.y;
    var cz = (box.min.z + box.max.z) / 2;
    contact.position.x = Math.sin(turnG.rotation.y) * cz;
    contact.position.z = Math.cos(turnG.rotation.y) * cz;
    frame.R = Math.max(size.x, size.y, size.z) * 0.56 + 0.03;
    frame.cy = (box.min.y + box.max.y) / 2;
    lights();
  }

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
    contact.material.opacity = state.sc.shadow * 0.85;
  }

  function aimCamera(cw, ch) {
    var cam = state.sc.cam, R = frame.R;
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

  function renderNow() {
    raf = 0;
    if (!book) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    drawBg(bgCv, Math.round(w * dpr), Math.round(h * dpr));
    aimCamera(w, h);
    renderer.render(scene, camera);
  }
  function request() { if (!raf) raf = requestAnimationFrame(renderNow); }

  // ---------- Public ----------
  var stage = {
    MAX: MAX,
    // Full update: book shape, pictures, scene.
    set: function (p, imgs, bgImg) {
      state.bk = p.bk; state.art = p.art; state.sc = p.sc;
      state.imgs = imgs || {}; state.bgImg = bgImg || null;
      buildBook();
      request();
    },
    // Scene-only update (camera, light, background, turn, open, place).
    scene: function (sc, bgImg, rebuild) {
      var placeChanged = !state.sc || sc.place !== state.sc.place;
      state.sc = sc;
      if (bgImg !== undefined) state.bgImg = bgImg;
      if (rebuild || placeChanged) { buildBook(); request(); return; }
      if (book) book.children[book.children.length - 1].rotation.y = -sc.open * Math.PI / 180;
      place();
      request();
    },
    resize: function (cw, ch) { w = Math.max(1, cw | 0); h = Math.max(1, ch | 0); request(); },
    render: request,
    // A finished picture: background + book, width × height px.
    snapshot: function (ow, oh, transparent) {
      var k = Math.min(1, MAX / Math.max(ow, oh));
      ow = Math.round(ow * k); oh = Math.round(oh * k);
      var out = canvas(ow, oh), ctx = out.getContext("2d");
      if (!transparent) drawBackground(ctx, ow, oh, state.sc.bg, state.bgImg);
      if (book) {
        renderer.setPixelRatio(1);
        renderer.setSize(ow, oh, false);
        aimCamera(ow, oh);
        renderer.render(scene, camera);
        ctx.drawImage(glCv, 0, 0, ow, oh);
      }
      renderNow();
      return { canvas: out, scaled: k < 1 };
    },
    // The mm per screen pixel at the book (for drag speed).
    radius: function () { return frame.R; },
    destroy: function () {
      disposeBook();
      try { scene.environment.dispose(); } catch (e) {}
      renderer.dispose();
      host.textContent = "";
    }
  };
  return stage;
}
