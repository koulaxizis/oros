// ============================================================
// orOS Mockups — goods/small3d.js (v1.0.0, ES module)
// The 3D badge, sticker, keychain, enamel pin and magnet, built in
// code with the vendored three.js (imported by scene.js). Every
// printed face takes its picture from the printer's sheet of
// goods/small.js drawn by MockPrint, and its outline from the same
// cut (MockPrint.cutOf), so the Print tab and the 3D agree.
//   - badge: the domed face with the print wrapped round the rim,
//     the metal back with a pin or a magnet
//   - sticker: vinyl with a white edge (die cut), matte, gloss,
//     holographic or clear
//   - keychain: acrylic, metal or rubber, the hole (on a tab for a
//     die cut) and the split ring; printed on both sides on request
//   - enamel pin: metal with the picture in a few enamel colours
//     and metal lines, hard (glossy) or soft enamel, the back with
//     its clutches, on a backing card on request
//   - magnet: a printed piece on a dark magnetic back
// Units: 1 mm = S scene units. build(H, p) → { g, fronts } or null.
// ============================================================
import { sheetCanvas, box, clearMat, solidMat } from "./media3d.js";

var METAL_C = { gold: "#d4af37", silver: "#c9ccd1", black: "#2a2b2e", rose: "#d9a08b", copper: "#b87333" };

function cutFor(H, p, key) {
  var T = H.C.templateOf(p, key), R = T && H.MP && H.MP.cutOf ? H.MP.cutOf(T, H.pics) : null;
  return R ? { T: T, R: R } : null;
}
// The outline as a THREE.Shape centred on the sheet (y up).
function shapeOf(H, c, holes) {
  var THREE = H.THREE, S = H.S, T = c.T, sh = new THREE.Shape();
  c.R.path.forEach(function (q, i) { var x = (q[0] - T.W / 2) * S, y = (T.H / 2 - q[1]) * S; if (i) sh.lineTo(x, y); else sh.moveTo(x, y); });
  sh.closePath();
  (holes || []).forEach(function (h) {
    var hp = new THREE.Path();
    hp.absarc((h.x - T.W / 2) * S, (T.H / 2 - h.y) * S, h.d / 2 * S, 0, Math.PI * 2, true);
    sh.holes.push(hp);
  });
  return sh;
}
function inside(path, x, y) {
  var n = false;
  for (var i = 0, j = path.length - 1; i < path.length; j = i++) {
    var a = path[i], b = path[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) n = !n;
  }
  return n;
}
// uv of every vertex from its place on the sheet (mirror: seen from the back)
function sheetUV(H, geo, T, mirror) {
  var S = H.S, pos = geo.attributes.position, uv = geo.attributes.uv;
  for (var i = 0; i < pos.count; i++) {
    var x = pos.getX(i) / S + T.W / 2, y = T.H / 2 - pos.getY(i) / S;
    if (mirror) x = T.W - x;
    uv.setXY(i, (T.bleed + x) / T.sheet.w, 1 - (T.bleed + y) / T.sheet.h);
  }
  uv.needsUpdate = true;
}
// The body: the outline extruded depth mm, centred on z = 0.
function slab(H, shape, depth, mats, bevel) {
  var THREE = H.THREE, S = H.S;
  var geo = H.own(new THREE.ExtrudeGeometry(shape, { depth: depth * S, bevelEnabled: !!bevel, bevelThickness: (bevel || 0) * S, bevelSize: (bevel || 0) * S, bevelSegments: 2, curveSegments: 24 }));
  geo.translate(0, 0, -depth / 2 * S);
  var m = new THREE.Mesh(geo, mats);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
// A printed face on the outline, at z mm, facing +z (or -z: back).
function face(H, shape, T, tex, z, matOpts, back) {
  var THREE = H.THREE, S = H.S, geo = H.own(new THREE.ShapeGeometry(shape, 24));
  sheetUV(H, geo, T, back);
  var mat = H.own(new THREE.MeshPhysicalMaterial(Object.assign({ map: tex, transparent: true, alphaTest: 0.02, side: back ? THREE.BackSide : THREE.FrontSide }, matOpts)));
  var m = new THREE.Mesh(geo, mat);
  m.position.z = z * S;
  m.receiveShadow = true;
  return m;
}
function finishOf(fin) {
  if (fin === "matte") return { roughness: 0.75 };
  if (fin === "holo") return { roughness: 0.22, metalness: 0.45, iridescence: 1, iridescenceIOR: 1.4, iridescenceThicknessRange: [180, 640], clearcoat: 0.6 };
  if (fin === "clear") return { roughness: 0.2, clearcoat: 0.8 };
  return { roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.12 };
}
function metalMat(H, c, rough) { return H.own(new H.THREE.MeshPhysicalMaterial({ color: METAL_C[c] || c, metalness: 1, roughness: rough == null ? 0.28 : rough })); }

// ---------- Badge ----------
function badge(H, p, back) {
  var THREE = H.THREE, S = H.S, M = H.C.good("badge"), D = M.dims(p.g), R = p.g.d / 2, cut = D.cut;
  var sh = sheetCanvas(H, p, "badge"), g = new THREE.Group();
  var hr = D.d - D.dome, rr = Math.min(1.8, hr * 0.6), pts = [], N = 28;
  for (var i = 0; i <= N; i++) { var r = (R - rr) * i / N; pts.push([r, hr + D.dome * (1 - (r / R) * (r / R))]); }
  var top = pts[pts.length - 1][1];
  for (var k = 1; k <= 8; k++) { var a = k / 8 * Math.PI / 2; pts.push([R - rr + Math.sin(a) * rr, top - rr + Math.cos(a) * rr]); }
  pts.push([R, 0.4], [R - 0.6, 0]);
  var sArr = [0];
  for (var j = 1; j < pts.length; j++) sArr.push(sArr[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
  var geo = H.own(new THREE.LatheGeometry(pts.map(function (q) { return new THREE.Vector2(q[0] * S, q[1] * S); }), 96));
  var pos = geo.attributes.position, uv = geo.attributes.uv, np = pts.length;
  for (var v = 0; v < pos.count; v++) {
    var s = Math.min(sArr[v % np], cut / 2), x = pos.getX(v), z = pos.getZ(v), rad = Math.hypot(x, z) || 1;
    uv.setXY(v, 0.5 + s / cut * (x / rad), 0.5 - s / cut * (z / rad));
  }
  uv.needsUpdate = true;
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  var mat = H.own(new THREE.MeshPhysicalMaterial(Object.assign({ map: sh ? sh.tex : null, color: sh ? 0xffffff : 0xdddddd, side: THREE.DoubleSide }, finishOf(p.g.fin))));
  var dome = new THREE.Mesh(geo, mat);
  dome.castShadow = true; dome.receiveShadow = true;
  g.add(dome);
  // the back: metal shell, and the pin or the magnet
  var metal = metalMat(H, "silver", 0.35);
  var bk = new THREE.Mesh(H.own(new THREE.CircleGeometry((R - 0.6) * S, 64)), metal);
  bk.rotation.y = Math.PI; bk.position.z = 0.05 * S;
  g.add(bk);
  if (p.g.back === "magnet") {
    var mg = new THREE.Mesh(H.own(new THREE.CylinderGeometry(R * 0.55 * S, R * 0.55 * S, 2 * S, 48)), solidMat(H, "#1b1b1d", 0.6));
    mg.rotation.x = Math.PI / 2; mg.position.z = -1 * S; g.add(mg);
  } else {
    var L = R * 1.4, bar = new THREE.Mesh(H.own(new THREE.CylinderGeometry(0.45 * S, 0.45 * S, L * S, 10)), metal);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, -R * 0.15 * S, -1.2 * S); g.add(bar);
    var hinge = box(H, 3, 2.5, 1.6, metal); hinge.position.set(-L / 2 * S, -R * 0.15 * S, -0.8 * S); g.add(hinge);
    var catchM = box(H, 3.5, 3, 1.8, metal); catchM.position.set(L / 2 * S, -R * 0.15 * S, -0.9 * S); g.add(catchM);
  }
  if (back) g.rotation.y = Math.PI;
  return g;
}

// ---------- Sticker / magnet ----------
function flatPiece(H, p, key, depth, bodyMat, printOpts) {
  var THREE = H.THREE, c = cutFor(H, p, key);
  if (!c) return null;
  var sh = sheetCanvas(H, p, key), shape = shapeOf(H, c), g = new THREE.Group();
  g.add(slab(H, shape, depth, [bodyMat, bodyMat]));
  if (sh) g.add(face(H, shape, c.T, sh.tex, depth / 2 + 0.01, printOpts));
  return g;
}
function sticker(H, p) {
  var clear = p.g.fin === "clear";
  var body = clear ? clearMat(H, "#f4f8fa", 0.25) : solidMat(H, "#f7f7f4", 0.55);
  return flatPiece(H, p, "sticker", 0.25, body, finishOf(p.g.fin));
}
function magnet(H, p) {
  return flatPiece(H, p, "magnet", 0.8, solidMat(H, "#202022", 0.7), finishOf(p.g.fin));
}

// ---------- Keychain ----------
function keychain(H, p) {
  var THREE = H.THREE, S = H.S, g = p.g, D = H.C.good("keychain").dims(g), c = cutFor(H, p, "kfront");
  if (!c) return null;
  var grp = new THREE.Group(), holes = c.R.holes, h = holes[0];
  var bodyMat = g.mat === "acrylic"
    ? H.own(new THREE.MeshPhysicalMaterial({ color: "#ffffff", transmission: 0.92, thickness: D.d * S, roughness: 0.06, ior: 1.49, clearcoat: 1 }))
    : g.mat === "metal" ? metalMat(H, g.ring, 0.3) : solidMat(H, p.art.c || "#d8d2c4", 0.85);
  var bodyHoles = h && inside(c.R.path, h.x, h.y) ? [h] : [];
  var shape = shapeOf(H, c, bodyHoles);
  grp.add(slab(H, shape, D.d, [bodyMat, bodyMat], g.mat === "rubber" ? 0.4 : 0));
  if (h && h.tab) {
    var tab = new THREE.Shape();
    tab.absarc((h.x - c.T.W / 2) * S, (c.T.H / 2 - h.y) * S, h.tab / 2 * S, 0, Math.PI * 2, false);
    var hp = new THREE.Path(); hp.absarc((h.x - c.T.W / 2) * S, (c.T.H / 2 - h.y) * S, h.d / 2 * S, 0, Math.PI * 2, true);
    tab.holes.push(hp);
    grp.add(slab(H, tab, D.d, [bodyMat, bodyMat]));
  }
  var opts = g.mat === "acrylic" ? { roughness: 0.15, clearcoat: 1 } : g.mat === "metal" ? { roughness: 0.3, clearcoat: 0.8 } : { roughness: 0.8 };
  var sh = sheetCanvas(H, p, "kfront");
  if (sh) grp.add(face(H, shape, c.T, sh.tex, D.d / 2 + 0.02, opts));
  if (g.two) {
    var bc = cutFor(H, p, "kback"), bs = sheetCanvas(H, p, "kback");
    if (bc && bs) grp.add(face(H, shape, bc.T, bs.tex, -D.d / 2 - 0.02, opts, true));
  }
  // the split ring through the hole
  if (h) {
    var rr = D.ring / 2, ring = new THREE.Mesh(H.own(new THREE.TorusGeometry(rr * S, 0.9 * S, 12, 64)), metalMat(H, g.ring, 0.25));
    ring.rotation.y = Math.PI / 2;
    ring.position.set((h.x - c.T.W / 2) * S, (c.T.H / 2 - h.y + rr - h.d / 2 + 0.6) * S, 0);
    ring.castShadow = true;
    grp.add(ring);
  }
  return grp;
}

// ---------- Enamel pin ----------
// The picture in a few flat colours with metal lines between them.
function enamel(H, sh, metal, soft) {
  var src = sh.tex.image, w = 512, h = Math.round(512 * src.height / src.width) || 512;
  var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  var x = cv.getContext("2d");
  x.drawImage(src, 0, 0, w, h);
  var id = x.getImageData(0, 0, w, h), d = id.data, count = {}, i, k;
  for (i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    k = (d[i] >> 5) + "," + (d[i + 1] >> 5) + "," + (d[i + 2] >> 5);
    var e = count[k] || (count[k] = [0, 0, 0, 0]);
    e[0] += d[i]; e[1] += d[i + 1]; e[2] += d[i + 2]; e[3]++;
  }
  var pal = Object.keys(count).map(function (q) { var e = count[q]; return [e[0] / e[3], e[1] / e[3], e[2] / e[3], e[3]]; })
    .sort(function (a, b) { return b[3] - a[3]; }).slice(0, 7);
  var idx = new Int16Array(w * h).fill(-1);
  for (i = 0; i < w * h; i++) {
    var o = i * 4;
    if (d[o + 3] < 128) { d[o + 3] = 0; continue; }
    var best = 0, bd = 1e9;
    for (k = 0; k < pal.length; k++) { var dr = d[o] - pal[k][0], dg = d[o + 1] - pal[k][1], db = d[o + 2] - pal[k][2], dd = dr * dr + dg * dg + db * db; if (dd < bd) { bd = dd; best = k; } }
    idx[i] = best; d[o] = pal[best][0]; d[o + 1] = pal[best][1]; d[o + 2] = pal[best][2]; d[o + 3] = 255;
  }
  var mc = parseInt((METAL_C[metal] || "#d4af37").slice(1), 16), MR = mc >> 16 & 255, MG = mc >> 8 & 255, MB = mc & 255, lw = soft ? 2 : 1;
  for (var y = 0; y < h; y++) for (var xx = 0; xx < w; xx++) {
    var n = y * w + xx, me = idx[n];
    if (me < 0) continue;
    var edge = false;
    for (var dy = -lw; dy <= lw && !edge; dy++) for (var dx = -lw; dx <= lw; dx++) {
      var yy = y + dy, xq = xx + dx;
      if (yy < 0 || xq < 0 || yy >= h || xq >= w) continue;
      var other = idx[yy * w + xq];
      if (other !== me && other >= 0 && other > me) { edge = true; break; }
    }
    if (edge) { var q4 = n * 4; d[q4] = MR; d[q4 + 1] = MG; d[q4 + 2] = MB; }
  }
  x.putImageData(id, 0, 0);
  var tex = H.own(new H.THREE.CanvasTexture(cv));
  tex.colorSpace = H.THREE.SRGBColorSpace; tex.anisotropy = H.ANISO;
  return tex;
}
function pin(H, p, back) {
  var THREE = H.THREE, S = H.S, g = p.g, c = cutFor(H, p, "pin");
  if (!c) return null;
  var grp = new THREE.Group(), metal = metalMat(H, g.metal, 0.22), shape = shapeOf(H, c), t = 1.6;
  grp.add(slab(H, shape, t, [metal, metal], 0.2));
  var sh = sheetCanvas(H, p, "pin");
  if (sh) {
    var tex = enamel(H, sh, g.metal, g.enamel === "soft");
    grp.add(face(H, shape, c.T, tex, t / 2 + 0.22, g.enamel === "soft" ? { roughness: 0.5, sheen: 0.3 } : { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }));
  }
  // two posts with their clutches on the back
  var posts = g.size >= 30 ? [-0.22, 0.22] : [0];
  posts.forEach(function (fx) {
    var post = new THREE.Mesh(H.own(new THREE.CylinderGeometry(0.5 * S, 0.5 * S, 8 * S, 10)), metal);
    post.rotation.x = Math.PI / 2; post.position.set(fx * g.size * S, 0, -(t / 2 + 4) * S); grp.add(post);
    var cl = new THREE.Mesh(H.own(new THREE.CylinderGeometry(4 * S, 4 * S, 1.2 * S, 24)), back ? metalMat(H, "silver", 0.3) : solidMat(H, "#151515", 0.6));
    cl.rotation.x = Math.PI / 2; cl.position.set(fx * g.size * S, 0, -(t / 2 + 5.5) * S); grp.add(cl);
  });
  if (back) grp.rotation.y = Math.PI;
  return grp;
}
function pinCard(H, p) {
  var THREE = H.THREE, S = H.S, c = cutFor(H, p, "pcard");
  if (!c) return null;
  var sh = sheetCanvas(H, p, "pcard"), shape = shapeOf(H, c, c.R.holes), card = solidMat(H, "#f2efe8", 0.85), grp = new THREE.Group();
  grp.add(slab(H, shape, 0.6, [card, card]));
  if (sh) grp.add(face(H, shape, c.T, sh.tex, 0.32, { roughness: 0.7 }));
  return grp;
}

export function build(H, p) {
  var THREE = H.THREE, S = H.S, k = p.kind, g = p.g, res = null;
  if (["badge", "sticker", "keychain", "pin", "magnet"].indexOf(k) < 0) return null;
  var main = k === "badge" ? badge(H, p) : k === "sticker" ? sticker(H, p) : k === "keychain" ? keychain(H, p) : k === "pin" ? pin(H, p) : magnet(H, p);
  if (!main) return null;
  res = { g: new THREE.Group(), fronts: [] };
  if (k === "pin" && g.card) {
    var cd = pinCard(H, p);
    if (cd) { cd.position.set(0, -6 * S, -(0.8 + 0.35) * S); res.g.add(cd); }
    main.position.y = -6 * S;
  }
  res.g.add(main);
  if (g.beside && (k === "badge" || k === "pin")) {
    var b = new THREE.Box3().setFromObject(main), w = b.max.x - b.min.x, other = k === "badge" ? badge(H, p, true) : pin(H, p, true);
    other.position.x = main.position.x + w + 6 * S;
    other.position.y = main.position.y;
    res.g.add(other);
  }
  return res;
}
