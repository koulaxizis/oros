// ============================================================
// orOS Mockups — surface3d.js (v1.0.0, ES module)
// Lifestyle surfaces and props for the 3D scene (Mockups v2 wave 9),
// made in code with the vendored three.js: no photos, no downloads.
//   - surfaces: wood planks, marble, linen, paper, concrete, as seeded
//     canvas textures (colour + roughness) laid at their real scale
//   - props: a coffee cup, a potted plant, a pencil, at real size,
//     set round the product and never counted in its framing
// Units: 1 mm = S scene units (scene.js passes S).
// ============================================================
export var SURFS = ["none", "wood", "marble", "linen", "paper", "concrete"];
var TILE = { wood: 520, marble: 700, linen: 90, paper: 320, concrete: 600 };   // mm per texture tile
var ROUGH = { wood: 0.62, marble: 0.22, linen: 0.95, paper: 0.9, concrete: 0.92 };
var cache = {};

function rnd(seed) { var s = seed >>> 0 || 1; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function canvas(n) { var c = document.createElement("canvas"); c.width = c.height = n; return c; }
// soft value noise that tiles (for blotches, veins, grain)
function noise(n, cells, r) {
  var g = [], out = new Float32Array(n * n);
  for (var i = 0; i < cells * cells; i++) g.push(r());
  function at(x, y) { return g[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)]; }
  for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
    var fx = x / n * cells, fy = y / n * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    var a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx, b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
    out[y * n + x] = a + (b - a) * ty;
  }
  return out;
}
function fbm(n, r, oct) {
  var out = new Float32Array(n * n), amp = 1, tot = 0;
  for (var o = 0; o < oct; o++) {
    var nz = noise(n, 4 << o, r);
    for (var i = 0; i < out.length; i++) out[i] += nz[i] * amp;
    tot += amp; amp *= 0.5;
  }
  for (i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function paint(n, fn) {
  var cv = canvas(n), ctx = cv.getContext("2d"), im = ctx.createImageData(n, n);
  for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
    var c = fn(x, y), o = (y * n + x) * 4;
    im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return cv;
}
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// The colour canvas of a surface (512 px, one tile).
export function surfaceCanvas(kind) {
  if (cache[kind]) return cache[kind];
  var n = 512, r = rnd({ wood: 3, marble: 5, linen: 7, paper: 11, concrete: 13 }[kind] || 1), cv;
  if (kind === "wood") {
    var f = fbm(n, r, 4), planks = 4, tone = [];
    for (var k = 0; k < planks; k++) tone.push(0.82 + r() * 0.3);
    cv = paint(n, function (x, y) {
      var p = Math.floor(x / (n / planks)), lx = x % (n / planks), t = tone[p];
      var streak = f[(Math.floor(y / 10) * 10 % n) * n + ((x * 5 + p * 97) % n)];   // long streaks along the plank
      var grain = Math.sin((lx * 0.7 + f[y * n + x] * 14 + p * 37) * 0.9) * 0.5 + 0.5;
      var c = mix([158, 110, 70], [192, 146, 100], streak * 0.75 + grain * 0.25);
      if (lx < 2) c = mix(c, [70, 45, 28], 0.65);                     // the gap between planks
      return [c[0] * t, c[1] * t, c[2] * t];
    });
  } else if (kind === "marble") {
    var m = fbm(n, r, 5);
    cv = paint(n, function (x, y) {
      var v = Math.abs(Math.sin((x + y) * 0.006 + m[y * n + x] * 5));
      var vein = Math.pow(1 - v, 22) + 0.35 * Math.pow(1 - Math.abs(Math.sin((x - y) * 0.004 + m[y * n + x] * 7)), 30), soft = m[y * n + x];
      var c = mix([238, 236, 232], [214, 212, 210], soft);
      return mix(c, [140, 140, 146], Math.min(1, vein) * 0.6);
    });
  } else if (kind === "linen") {
    var l = fbm(n, r, 3);
    cv = paint(n, function (x, y) {
      var w = (Math.sin(x * 1.6) * 0.5 + 0.5) * 0.5 + (Math.sin(y * 1.6) * 0.5 + 0.5) * 0.5, s = r() * 0.08;
      var c = mix([214, 204, 186], [236, 229, 214], w * 0.6 + l[y * n + x] * 0.4 - s);
      return c;
    });
  } else if (kind === "paper") {
    var q = fbm(n, r, 4);
    cv = paint(n, function (x, y) {
      var c = mix([238, 233, 222], [249, 246, 239], q[y * n + x]);
      if (r() < 0.004) c = mix(c, [190, 180, 165], 0.5);             // fibres
      return c;
    });
  } else {
    var b = fbm(n, r, 5);
    cv = paint(n, function (x, y) {
      var c = mix([150, 150, 146], [196, 195, 190], b[y * n + x]);
      if (r() < 0.006) c = mix(c, [90, 90, 88], 0.6);                 // pits
      return c;
    });
  }
  cache[kind] = cv;
  return cv;
}

// A big floor plane of the surface (size in scene units), or null for "none".
export function surfaceMesh(THREE, kind, S, size, aniso) {
  if (SURFS.indexOf(kind) <= 0) return null;
  var tex = new THREE.CanvasTexture(surfaceCanvas(kind));
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = aniso || 1;
  var rep = size / (TILE[kind] * S);
  tex.repeat.set(rep, rep);
  var mat = new THREE.MeshStandardMaterial({ map: tex, roughness: ROUGH[kind], metalness: 0 });
  var m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true;
  m.userData.skip = true;
  return m;
}

// ---------- Props ----------
export var PROPS = ["cup", "plant", "pencil"];
function cup(THREE, S) {
  var g = new THREE.Group(), R = 42, Hh = 92;
  var white = new THREE.MeshPhysicalMaterial({ color: "#f3f1ec", roughness: 0.25, clearcoat: 0.8 });
  var body = new THREE.Mesh(new THREE.CylinderGeometry(R * S, R * 0.86 * S, Hh * S, 48, 1, true), white);
  body.position.y = Hh / 2 * S; g.add(body);
  var inner = new THREE.Mesh(new THREE.CylinderGeometry((R - 3) * S, (R - 4) * 0.86 * S, (Hh - 4) * S, 48, 1, true), new THREE.MeshStandardMaterial({ color: "#efece6", side: THREE.BackSide }));
  inner.position.y = (Hh / 2 + 2) * S; g.add(inner);
  var coffee = new THREE.Mesh(new THREE.CircleGeometry((R - 3.2) * S, 40), new THREE.MeshPhysicalMaterial({ color: "#3b2214", roughness: 0.15, clearcoat: 1 }));
  coffee.rotation.x = -Math.PI / 2; coffee.position.y = (Hh - 14) * S; g.add(coffee);
  var rim = new THREE.Mesh(new THREE.RingGeometry((R - 3) * S, R * S, 48), white);
  rim.rotation.x = -Math.PI / 2; rim.position.y = Hh * S; g.add(rim);
  var bottom = new THREE.Mesh(new THREE.CircleGeometry(R * 0.86 * S, 40), white);
  bottom.rotation.x = Math.PI / 2; g.add(bottom);
  var handle = new THREE.Mesh(new THREE.TorusGeometry(22 * S, 5 * S, 12, 32, Math.PI), white);
  handle.rotation.z = -Math.PI / 2; handle.position.set((R - 2) * S, Hh * 0.52 * S, 0); g.add(handle);
  g.userData.r = (R + 26) * S;
  return g;
}
function plant(THREE, S) {
  var g = new THREE.Group(), R = 58, Hh = 100, r = rnd(17);
  var pot = new THREE.Mesh(new THREE.CylinderGeometry(R * S, R * 0.78 * S, Hh * S, 40), new THREE.MeshStandardMaterial({ color: "#c46f4c", roughness: 0.9 }));
  pot.position.y = Hh / 2 * S; g.add(pot);
  var soil = new THREE.Mesh(new THREE.CircleGeometry((R - 5) * S, 32), new THREE.MeshStandardMaterial({ color: "#3a2a1e", roughness: 1 }));
  soil.rotation.x = -Math.PI / 2; soil.position.y = (Hh - 6) * S; g.add(soil);
  var leafM = new THREE.MeshStandardMaterial({ color: "#3f7a45", roughness: 0.55, side: THREE.DoubleSide });
  var leafG = new THREE.SphereGeometry(1, 16, 10);
  leafG.scale(16, 3, 46); leafG.translate(0, 0, 40);
  for (var i = 0; i < 11; i++) {
    var lf = new THREE.Mesh(leafG, leafM), a = i / 11 * Math.PI * 2 + r() * 0.4;
    lf.scale.setScalar(S * (0.8 + r() * 0.5));
    lf.position.set(Math.cos(a) * 8 * S, (Hh + 4 + r() * 30) * S, Math.sin(a) * 8 * S);
    lf.rotation.set(0, -a + Math.PI / 2, 0); lf.rotateX(-0.5 - r() * 0.7);
    lf.castShadow = true;
    g.add(lf);
  }
  g.userData.r = (R + 40) * S;
  return g;
}
function pencil(THREE, S) {
  var g = new THREE.Group(), L = 170, D = 7.4;
  var body = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 * S, D / 2 * S, L * S, 6), new THREE.MeshStandardMaterial({ color: "#e8b923", roughness: 0.45 }));
  body.rotation.z = Math.PI / 2; g.add(body);
  var wood = new THREE.Mesh(new THREE.ConeGeometry(D / 2 * S, 18 * S, 6), new THREE.MeshStandardMaterial({ color: "#e3c39a", roughness: 0.8 }));
  wood.rotation.z = -Math.PI / 2; wood.position.x = (L / 2 + 9) * S; g.add(wood);
  var lead = new THREE.Mesh(new THREE.ConeGeometry(1.2 * S, 5 * S, 8), new THREE.MeshStandardMaterial({ color: "#2a2a2c", roughness: 0.4 }));
  lead.rotation.z = -Math.PI / 2; lead.position.x = (L / 2 + 16.5) * S; g.add(lead);
  var band = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 * 1.03 * S, D / 2 * 1.03 * S, 9 * S, 16), new THREE.MeshStandardMaterial({ color: "#b8b9bd", metalness: 1, roughness: 0.3 }));
  band.rotation.z = Math.PI / 2; band.position.x = -(L / 2 + 4.5) * S; g.add(band);
  var eraser = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 * S, D / 2 * S, 8 * S, 16), new THREE.MeshStandardMaterial({ color: "#e88a8f", roughness: 0.8 }));
  eraser.rotation.z = Math.PI / 2; eraser.position.x = -(L / 2 + 13) * S; g.add(eraser);
  g.position.y = D / 2 * S;
  var w = new THREE.Group(); w.add(g);
  w.userData.r = 30 * S;
  return w;
}
// Every prop, built once; place() shows and moves them.
export function makeProps(THREE, S) {
  var out = { cup: cup(THREE, S), plant: plant(THREE, S), pencil: pencil(THREE, S) };
  Object.keys(out).forEach(function (k) {
    out[k].traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.skip = true; } });
    out[k].visible = false;
  });
  return out;
}
// Put the props the scene asks for round the product's box (scene units).
export function placeProps(props, on, box, S) {
  var gap = 45 * S, mx = box.max.x, nx = box.min.x, mz = box.max.z, nz = box.min.z;
  var spots = {
    cup: [mx + gap + props.cup.userData.r * 0.7, nz + (mz - nz) * 0.25, 0.4],
    plant: [nx - gap - props.plant.userData.r * 0.6, nz + props.plant.userData.r * 0.2, 0],
    pencil: [mx * 0.35 + nx * 0.65, mz + gap * 0.9, 0.18]
  };
  PROPS.forEach(function (k) {
    var pr = props[k], s = spots[k];
    pr.visible = !!(on && on[k]);
    pr.position.set(s[0], 0, s[1]);
    pr.rotation.y = s[2];
  });
}
