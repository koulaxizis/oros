// ============================================================
// orOS Mockups — goods/cloth3d.js (v1.0.0, ES module)
// The 3D T-shirt and tote bag with the vendored three.js (imported by
// scene.js). The garments are our own Blender models (oros-models,
// mockups/*.glb: named meshes, POSITION + NORMAL in metres, uint32
// indices, front toward +z, y up), read by the small GLB reader below
// once goods/cloth.js has downloaded and checked them. Until then a
// flat stand-in of the same size shows the print.
//   - fabric: the colour, a knit (T-shirt) or canvas weave (tote)
//     normal map, sheen, heather speckle
//   - print: the triangles of the model's front (or back) inside the
//     print area of index.json, mapped flat from the front, the
//     picture as garment ink (no background) on the same weave
// Units: 1 mm = S scene units. build(H, p) → { g, fronts } or null.
// ============================================================
import { sheetCanvas } from "./media3d.js";

var parsed = {};                  // model name → { mesh name → { pos (mm), nrm, idx } }

// ---------- GLB reader (just what make.py writes) ----------
export function parseGLB(buf) {
  var dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67 || dv.getUint32(4, true) !== 2) throw new Error("not a GLB 2");
  var jl = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4E4F534A) throw new Error("no JSON chunk");
  var js = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  var binOff = 20 + jl + 8, out = {};
  var SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, TYPE = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array };
  function acc(i) {
    var a = js.accessors[i], bv = js.bufferViews[a.bufferView], T = TYPE[a.componentType], n = a.count * SIZE[a.type];
    if (!T || !n) throw new Error("accessor");
    var off = binOff + (bv.byteOffset || 0) + (a.byteOffset || 0);
    if (off + n * T.BYTES_PER_ELEMENT > buf.byteLength) throw new Error("accessor out of range");
    return new T(buf.slice(off, off + n * T.BYTES_PER_ELEMENT));
  }
  (js.meshes || []).forEach(function (m) {
    var pr = m.primitives && m.primitives[0];
    if (!pr || pr.attributes.POSITION == null) return;
    var pos = acc(pr.attributes.POSITION);
    for (var i = 0; i < pos.length; i++) pos[i] *= 1000;        // metres → mm
    out[m.name] = { pos: pos, nrm: pr.attributes.NORMAL != null ? acc(pr.attributes.NORMAL) : null, idx: pr.indices != null ? acc(pr.indices) : null };
  });
  return out;
}
function modelMeshes(name) {
  var CL = typeof window !== "undefined" && window.MockCloth, buf = CL && CL.buffer(name);
  if (!buf) { delete parsed[name]; return null; }          // removed from the device
  if (parsed[name] && parsed[name].buf === buf) return parsed[name].m;
  try { parsed[name] = { buf: buf, m: parseGLB(buf) }; return parsed[name].m; } catch (e) { console.warn("[orOS Mockups] model", name, e); return null; }
}

// ---------- Fabric ----------
var texCache = {};
function canvas(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
// a seeded small random (the same weave every time)
function rnd(seed) { var s = seed >>> 0 || 1; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
// height field → normal map canvas
function normalCanvas(n, hf, k) {
  var cv = canvas(n, n), ctx = cv.getContext("2d"), im = ctx.createImageData(n, n);
  for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
    var dx = (hf[y * n + (x + 1) % n] - hf[y * n + (x + n - 1) % n]) * k, dy = (hf[((y + 1) % n) * n + x] - hf[((y + n - 1) % n) * n + x]) * k;
    var l = Math.sqrt(dx * dx + dy * dy + 1), o = (y * n + x) * 4;
    im.data[o] = (-dx / l * 0.5 + 0.5) * 255; im.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; im.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; im.data[o + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return cv;
}
// jersey knit: columns of little V loops; canvas: an over-under weave
function weaveCanvas(kind) {
  if (texCache[kind]) return texCache[kind];
  var n = 64, hf = new Float32Array(n * n), r = rnd(kind === "knit" ? 7 : 11);
  for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
    var h;
    if (kind === "knit") {
      var cx = (x % 8) / 8, cy = ((y + (x % 8 < 4 ? (x % 4) : 4 - (x % 4))) % 8) / 8;
      h = Math.sin(cx * Math.PI) * (0.6 + 0.4 * Math.sin(cy * Math.PI));
    } else {
      var wx = Math.floor(x / 4), wy = Math.floor(y / 4), over = (wx + wy) % 2;
      h = over ? Math.sin((y % 4 + 0.5) / 4 * Math.PI) : Math.sin((x % 4 + 0.5) / 4 * Math.PI) * 0.9;
    }
    hf[y * n + x] = h + r() * 0.15;
  }
  texCache[kind] = normalCanvas(n, hf, kind === "knit" ? 2.2 : 1.8);
  return texCache[kind];
}
// heather: fibres of lighter and darker grey
function heatherCanvas(hex) {
  var key = "h" + hex;
  if (texCache[key]) return texCache[key];
  var n = 128, cv = canvas(n, n), ctx = cv.getContext("2d"), r = rnd(23);
  ctx.fillStyle = hex; ctx.fillRect(0, 0, n, n);
  for (var i = 0; i < 1400; i++) {
    var l = r(), a = 0.25 + r() * 0.35;
    ctx.fillStyle = l > 0.5 ? "rgba(255,255,255," + a * 0.55 + ")" : "rgba(30,30,34," + a * 0.5 + ")";
    ctx.fillRect(Math.floor(r() * n), Math.floor(r() * n), 1 + Math.floor(r() * 3), 1);
  }
  texCache[key] = cv;
  return cv;
}
function tex(H, cv, rep, channel, srgb) {
  var THREE = H.THREE, t = H.own(new THREE.CanvasTexture(cv));
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = H.ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (channel) t.channel = channel;
  return t;
}
var TILE = { knit: 10, canvas: 9 };          // mm per 64 px tile (8 knit columns, 16 canvas threads)
function fabricMat(H, hex, kind, heather) {
  var THREE = H.THREE, c = new THREE.Color(hex);
  var o = { color: heather ? 0xffffff : c, roughness: 0.93, metalness: 0, sheen: 0.7, sheenRoughness: 0.65, sheenColor: c.clone().lerp(new THREE.Color(0xffffff), 0.35),
    normalMap: tex(H, weaveCanvas(kind), 1, 1), normalScale: new THREE.Vector2(0.6, 0.6) };
  if (heather) o.map = tex(H, heatherCanvas(hex), 1, 1, true);
  return H.own(new THREE.MeshPhysicalMaterial(o));
}
function inkMat(H, t, kind) {
  var THREE = H.THREE;
  return H.own(new THREE.MeshPhysicalMaterial({ map: t, transparent: true, alphaTest: 0.04, roughness: 0.86, sheen: 0.25, sheenRoughness: 0.7,
    normalMap: tex(H, weaveCanvas(kind), 1, 1), normalScale: new THREE.Vector2(0.3, 0.3),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false }));
}

// ---------- Geometry ----------
// positions (mm) → a mesh: uv1 = the weave, laid flat from the front
function meshOf(H, pos, nrm, idx, mat, kind) {
  var THREE = H.THREE, S = H.S, n = pos.length / 3, P = new Float32Array(pos.length), W = new Float32Array(n * 2), t = TILE[kind];
  for (var i = 0; i < n; i++) {
    P[i * 3] = pos[i * 3] * S; P[i * 3 + 1] = pos[i * 3 + 1] * S; P[i * 3 + 2] = pos[i * 3 + 2] * S;
    W[i * 2] = pos[i * 3] / t; W[i * 2 + 1] = pos[i * 3 + 1] / t;
  }
  var geo = H.own(new THREE.BufferGeometry());
  geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
  geo.setAttribute("uv1", new THREE.BufferAttribute(W, 2));
  if (nrm) geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3)); else geo.computeVertexNormals();
  if (idx) geo.setIndex(new THREE.BufferAttribute(idx, 1));
  var m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
// The model's triangles facing side (+1 front, -1 back) inside the
// print rect r (mm, x left / y top), as their own mesh with the
// picture's uv. back: seen from behind, so the picture's left is +x.
var PAD = 96;                    // px of clear border round the picture (wide enough for the small mip levels)
function printPiece(H, m, r, side, sh, kind) {
  if (!sh) return null;
  var src = sh.tex.image, w = src.width, h = src.height, cv = canvas(w + 2 * PAD, h + 2 * PAD);
  cv.getContext("2d").drawImage(src, PAD, PAD);
  var t = tex(H, cv, 1, 0, true);
  t.wrapS = t.wrapT = H.THREE.ClampToEdgeWrapping;
  var pos = m.pos, nrm = m.nrm, idx = m.idx, P = [], N = [], U = [], x0 = r.x - 2, x1 = r.x + r.w + 2, y0 = r.y - r.h - 2, y1 = r.y + 2;
  var lift = 0.25;               // mm off the fabric
  for (var f = 0; f < idx.length; f += 3) {
    var a = idx[f], b = idx[f + 1], c = idx[f + 2];
    var nz = nrm ? (nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2]) / 3 : side;
    if (nz * side < 0.25) continue;
    var minX = Math.min(pos[a * 3], pos[b * 3], pos[c * 3]), maxX = Math.max(pos[a * 3], pos[b * 3], pos[c * 3]);
    var minY = Math.min(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]), maxY = Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]);
    if (maxX < x0 || minX > x1 || maxY < y0 || minY > y1) continue;
    [a, b, c].forEach(function (v) {
      var x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      var nx = nrm ? nrm[v * 3] : 0, ny = nrm ? nrm[v * 3 + 1] : 0, nzz = nrm ? nrm[v * 3 + 2] : side;
      P.push((x + nx * lift) * H.S, (y + ny * lift) * H.S, (z + nzz * lift) * H.S);
      N.push(nx, ny, nzz);
      var u = (x - r.x) / r.w, vv = (y - (r.y - r.h)) / r.h;
      if (side < 0) u = 1 - u;
      U.push((PAD + u * w) / (w + 2 * PAD), (PAD + vv * h) / (h + 2 * PAD), x / TILE[kind], y / TILE[kind]);
    });
  }
  if (!P.length) return null;
  var THREE = H.THREE, geo = H.own(new THREE.BufferGeometry()), n = P.length / 3, uv = new Float32Array(n * 2), uv1 = new Float32Array(n * 2);
  for (var i = 0; i < n; i++) { uv[i * 2] = U[i * 4]; uv[i * 2 + 1] = U[i * 4 + 1]; uv1[i * 2] = U[i * 4 + 2]; uv1[i * 2 + 1] = U[i * 4 + 3]; }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
  var piece = new THREE.Mesh(geo, inkMat(H, t, kind));
  piece.receiveShadow = true; piece.renderOrder = 2;
  return piece;
}

// ---------- Stand-ins (before the model is downloaded) ----------
function teeOutline() {
  var half = [];
  for (var i = 0; i <= 10; i++) { var a = -Math.PI / 2 + i / 10 * Math.PI / 2; half.push([95 * Math.cos(a), 360 + 75 * Math.sin(a)]); }
  half = half.concat([[232, 332], [398, 214], [312, 96], [262, 150], [262, -300], [258, -352], [230, -362], [0, -364]]);
  var left = half.slice(1, -1).reverse().map(function (q) { return [-q[0], q[1]]; });
  return half.concat(left);
}
function toteOutline() {
  var W = 380, Hh = 420, r = 6, out = [];
  [[W / 2 - r, Hh / 2 - r, 0], [-W / 2 + r, Hh / 2 - r, Math.PI / 2], [-W / 2 + r, -Hh / 2 + r, Math.PI], [W / 2 - r, -Hh / 2 + r, 1.5 * Math.PI]].forEach(function (c) {
    for (var i = 0; i <= 4; i++) { var a = c[2] + i / 4 * Math.PI / 2; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  });
  return out;
}
// a flat stand-in, as mesh arrays (mm) so the print goes on it the same way
function flatArrays(H, outline, thick) {
  var THREE = H.THREE, sh = new THREE.Shape();
  outline.forEach(function (q, i) { if (i) sh.lineTo(q[0], q[1]); else sh.moveTo(q[0], q[1]); });
  var g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -thick / 2);
  g = g.toNonIndexed(); g.computeVertexNormals();
  var pos = g.attributes.position.array, nrm = g.attributes.normal.array, idx = new Uint32Array(pos.length / 3);
  for (var i = 0; i < idx.length; i++) idx[i] = i;
  g.dispose();
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: idx };
}

// ---------- The garments ----------
function garment(H, p, name) {
  var THREE = H.THREE, CL = window.MockCloth, M = CL.MODELS[name], g = p.g, grp = new THREE.Group();
  var kind = name === "tote" ? "canvas" : "knit", hex = CL.CLOTH_C[g.col] || "#f2f2ef", heather = g.col === "heather";
  var fab = fabricMat(H, hex, kind, heather), meshes = modelMeshes(name), main;
  if (meshes && meshes[M.main]) {
    main = meshes[M.main];
    Object.keys(meshes).forEach(function (k) {
      if (/^handle_/.test(k) && k.indexOf("handle_" + g.handles + "_") !== 0) return;
      var q = meshes[k];
      grp.add(meshOf(H, q.pos, q.nrm, q.idx, fab, kind));
    });
  } else {
    main = name === "tote" ? flatArrays(H, toteOutline(), 6) : flatArrays(H, teeOutline(), 14);
    grp.add(meshOf(H, main.pos, main.nrm, main.idx, fab, kind));
    if (name === "tote") {
      var rise = g.handles === "long" ? 300 : 150;
      [-1, 1].forEach(function (s) {
        var hd = new THREE.Mesh(H.own(new THREE.TorusGeometry(85 * H.S, 1.6 * H.S, 8, 32, Math.PI)), fab);
        hd.scale.set(1, (rise - 15) / 85, 1); hd.position.set(s * 4 * H.S, (M.h / 2 - 30) * H.S, (s > 0 ? 5 : 3) * H.S);
        hd.castShadow = true; grp.add(hd);
      });
    }
  }
  var front = name === "tshirt" ? M.print[g.area] : M.print.front;
  var pf = printPiece(H, main, front, 1, sheetCanvas(H, p, name === "tote" ? "totefront" : "teefront"), kind);
  if (pf) grp.add(pf);
  if (g.back) {
    var pb = printPiece(H, main, M.print.front, -1, sheetCanvas(H, p, name === "tote" ? "toteback" : "teeback"), kind);
    if (pb) grp.add(pb);
  }
  return grp;
}

export function build(H, p) {
  if (p.kind !== "tshirt" && p.kind !== "tote") return null;
  if (typeof window === "undefined" || !window.MockCloth) return null;
  var g = new H.THREE.Group();
  g.add(garment(H, p, p.kind));
  return { g: g, fronts: [] };
}
