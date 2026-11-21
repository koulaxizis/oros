// ============================================================
// orOS Mockups — goods/media3d.js (v1.0.0, ES module)
// The 3D CD and DVD / Blu-ray, built in code with the vendored
// three.js (imported by scene.js). Every printed part takes its
// picture from the printer's sheet of goods/media.js, drawn by
// MockPrint, so what is on the Print tab is what is on the case.
//   - CD: jewel case (clear lid with the booklet, tray, tray card
//     with its two spines seen through the clear base), slim case,
//     digipak (printed boards, a tray inside) or card sleeve (the
//     disc slides out)
//   - DVD / Blu-ray: the case with the sleeve under its clear film,
//     the disc on the hub inside
//   - the disc: silver, white or black, the printed label from the
//     hub out, the clear centre ring and the hole
// "Open" (the Scene tab) opens the lid or the front, or slides the
// disc out of a sleeve. Units: 1 mm = S scene units.
// build(H, p) → { g, fronts } where H gives THREE, S, own, ANISO,
// pics (slot → picture), MP (MockPrint), C (MockCore).
// ============================================================

var CARD_EDGE = "#d8d1c3";
var BASES = { silver: { c: "#d9dce0", metal: 1, rough: 0.22 }, white: { c: "#f2f2ef", metal: 0, rough: 0.55 }, black: { c: "#141416", metal: 0, rough: 0.35 } };
var TRAY_C = { black: "#16171a", white: "#efefec", clear: "#cfd6dc" };
var CASE_C = { black: "#121214", blue: "#1d4f9c", clear: "#d5dce2", white: "#ecebe7" };

// The sheets of a project as canvases (pictures composed by MockPrint).
function sheetCanvas(H, p, key) {
  var T = H.C.templateOf(p, key);
  if (!T || !H.MP) return null;
  var ppm = Math.min(9, 2600 / Math.max(T.sheet.w, T.sheet.h));
  var art = Object.assign({}, p.art);
  if (!H.C.good(p.kind).wrap || key !== H.C.sheetsOf(p)[0]) art.mode = "parts";
  var cv = H.MP.render(T, art, H.pics, ppm, { art: true });
  var tex = H.own(new H.THREE.CanvasTexture(cv));
  tex.colorSpace = H.THREE.SRGBColorSpace; tex.anisotropy = H.ANISO;
  return { T: T, tex: tex };
}
// A flat w × h mm rectangle showing part k of a sheet (facing +z).
function panel(H, sh, k, w, h, mat) {
  var THREE = H.THREE, S = H.S;
  var geo = H.own(new THREE.PlaneGeometry(w * S, h * S));
  if (sh) {
    var T = sh.T, parts = T.parts.filter(function (q) { return q.k === k; }), q = parts[0];
    if (q) {
      var u0 = (T.bleed + q.x) / T.sheet.w, u1 = (T.bleed + q.x + q.w) / T.sheet.w;
      var v0 = 1 - (T.bleed + T.H) / T.sheet.h, v1 = 1 - T.bleed / T.sheet.h;
      var uv = geo.attributes.uv;
      for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
      uv.needsUpdate = true;
    }
  }
  var m = new THREE.Mesh(geo, mat || printMat(H, sh));
  m.receiveShadow = true;
  return m;
}
function printMat(H, sh, gloss) {
  return H.own(new H.THREE.MeshPhysicalMaterial({ map: sh ? sh.tex : null, color: sh ? 0xffffff : 0xdddddd,
    roughness: gloss ? 0.32 : 0.6, clearcoat: gloss ? 0.6 : 0, clearcoatRoughness: 0.2 }));
}
function box(H, w, h, d, mats) {
  var m = new H.THREE.Mesh(H.own(new H.THREE.BoxGeometry(w * H.S, h * H.S, d * H.S)), mats);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function clearMat(H, tint, op) {
  return H.own(new H.THREE.MeshPhysicalMaterial({ color: tint || "#eef3f6", transparent: true, opacity: op || 0.16,
    roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false, side: H.THREE.DoubleSide }));
}
function solidMat(H, c, rough) { return H.own(new H.THREE.MeshStandardMaterial({ color: c, roughness: rough == null ? 0.5 : rough })); }

// ---------- The disc (lying in x-y, label toward +z) ----------
export function disc(H, p) {
  var THREE = H.THREE, S = H.S, M = H.C.good(p.kind), g = p.g, D = 120, t = 1.2;
  var grp = new THREE.Group(), base = BASES[g.disc] || BASES.silver;
  var baseM = H.own(new THREE.MeshPhysicalMaterial({ color: base.c, metalness: base.metal, roughness: base.rough, clearcoat: 0.5, iridescence: g.disc === "silver" ? 0.35 : 0 }));
  var body = new THREE.Mesh(H.own(new THREE.CylinderGeometry(D / 2 * S, D / 2 * S, t * S, 96, 1, true)), baseM);
  body.rotation.x = Math.PI / 2; body.castShadow = true;
  grp.add(body);
  [1, -1].forEach(function (side) {
    var ring = new THREE.Mesh(H.own(new THREE.RingGeometry(11.5 * S, D / 2 * S, 96, 1)), baseM);
    ring.position.z = side * t / 2 * S; if (side < 0) ring.rotation.y = Math.PI;
    ring.castShadow = true; ring.receiveShadow = true;
    grp.add(ring);
    var hub = new THREE.Mesh(H.own(new THREE.RingGeometry(7.5 * S, 11.5 * S, 48, 1)), clearMat(H, "#e8eef2", 0.35));
    hub.position.z = side * t / 2 * S; if (side < 0) hub.rotation.y = Math.PI;
    grp.add(hub);
  });
  // the printed label: the disc sheet, drawn only where it is printed
  var hasPic = !!(p.art.disc && H.pics.disc);
  if (hasPic || g.disc !== "silver") {
    var sh = sheetCanvas(H, p, "disc");
    if (sh) {
      var c = sh.T.circle, lab = new THREE.Mesh(H.own(new THREE.RingGeometry(c.hub / 2 * S, c.print / 2 * S, 96, 1)),
        H.own(new THREE.MeshStandardMaterial({ map: sh.tex, transparent: true, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
      // RingGeometry's uv runs over its bounding square: map it onto the sheet (Ø D)
      var uv = lab.geometry.attributes.uv, pos = lab.geometry.attributes.position;
      for (var i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / (D * S), 0.5 + pos.getY(i) / (D * S));
      uv.needsUpdate = true;
      lab.position.z = (t / 2 + 0.08) * S;
      lab.receiveShadow = true;
      grp.add(lab);
    }
  }
  void M;
  return grp;
}

// ---------- CD ----------
function jewel(H, p, d, slim) {
  var THREE = H.THREE, S = H.S, g = p.g, out = { g: new THREE.Group(), fronts: [] };
  var bk = sheetCanvas(H, p, "booklet"), inl = slim ? null : sheetCanvas(H, p, "inlay");
  var lidT = d.lid, baseD = d.d - lidT, W = d.w, Hh = d.h;
  var clear = clearMat(H);
  var trayC = TRAY_C[g.tray] || TRAY_C.black;
  // base: clear (jewel) with the tray, or solid (slim)
  var base = new THREE.Group();
  base.position.z = (-d.d / 2 + baseD / 2) * S;
  out.g.add(base);
  if (slim) {
    var sb = box(H, W, Hh, baseD - 2.2, solidMat(H, trayC, 0.35));
    sb.position.z = -1.1 * S;
    base.add(sb);
  }
  else {
    var shell = box(H, W, Hh, baseD, clear); shell.castShadow = false; shell.renderOrder = 2;
    base.add(shell);
    // the tray fills the base up to just under the disc (the booklet sits above the disc, in the lid)
    var trayD = baseD - 3.4;
    var tray = box(H, W - 10, Hh - 4, trayD, g.tray === "clear" ? clearMat(H, "#dfe6ea", 0.3) : solidMat(H, trayC, 0.35));
    tray.position.set(1.5 * S, 0, (-baseD / 2 + 0.8 + trayD / 2) * S);
    base.add(tray);
    // the tray card: back panel under the tray, spines folded at both ends
    var back = panel(H, inl, "back", 138, 118);
    back.rotation.y = Math.PI; back.position.z = (-baseD / 2 + 0.35) * S; back.position.x = 0;
    base.add(back);
    [["spineL", -1], ["spineR", 1]].forEach(function (s) {
      var sp = panel(H, inl, s[0], 6.5, 118);
      sp.rotation.y = s[1] * Math.PI / 2; sp.position.x = s[1] * (138 / 2 + 0.05) * S; sp.position.z = (-baseD / 2 + 3.6) * S;
      base.add(sp);
    });
  }
  // the disc on the tray, under the booklet
  var dc = disc(H, p);
  dc.position.set(3 * S, 0, (slim ? baseD / 2 - 1.0 : -baseD / 2 + 0.8 + baseD - 3.4 + 0.7) * S);
  base.add(dc);
  // the lid on its hinge (left), the booklet in it
  var pivot = new THREE.Group();
  pivot.position.set(-W / 2 * S, 0, (d.d / 2 - lidT / 2) * S);
  var lid = new THREE.Group();
  lid.position.x = W / 2 * S;
  pivot.add(lid);
  var lidM = box(H, W, Hh, lidT, clear); lidM.castShadow = false; lidM.renderOrder = 3;
  lid.add(lidM);
  var front = panel(H, bk, "front", 120, 120, printMat(H, bk, true));
  front.position.set(5 * S, 0, (-lidT / 2 - 0.15) * S);
  front.castShadow = true;
  lid.add(front);
  var inside = panel(H, bk, "inside", 120, 120);
  inside.rotation.y = Math.PI;
  inside.position.set(5 * S, 0, (-lidT / 2 - 0.45) * S);
  lid.add(inside);
  // hinge knuckles
  [-1, 1].forEach(function (s) {
    var k = new THREE.Mesh(H.own(new THREE.CylinderGeometry(1.4 * S, 1.4 * S, 18 * S, 16)), clear);
    k.position.set(0, s * (Hh / 2 - 12) * S, -0.6 * S);
    pivot.add(k);
  });
  out.g.add(pivot);
  out.fronts.push(pivot);
  return out;
}
// A board of a digipak or sleeve: printed both sides, card edges.
function board(H, w, h, t, outM, inM) {
  var edge = solidMat(H, CARD_EDGE, 0.85);
  return box(H, w, h, t, [edge, edge, edge, edge, outM, inM]);
}
// A material showing part k of a sheet on a box face of w × h mm.
function faceMat(H, sh, k, gloss) {
  if (!sh) return printMat(H, null, gloss);
  var T = sh.T, q = T.parts.filter(function (x) { return x.k === k; })[0];
  var tex = sh.tex;
  if (q) {
    tex = H.own(sh.tex.clone());
    tex.repeat.set(q.w / T.sheet.w, T.H / T.sheet.h);
    tex.offset.set((T.bleed + q.x) / T.sheet.w, T.bleed / T.sheet.h);
    tex.needsUpdate = true;
  }
  return H.own(new H.THREE.MeshPhysicalMaterial({ map: tex, roughness: gloss ? 0.35 : 0.7, clearcoat: gloss ? 0.4 : 0 }));
}
function digipak(H, p, d) {
  var THREE = H.THREE, S = H.S, g = p.g, out = { g: new THREE.Group(), fronts: [] };
  var o = sheetCanvas(H, p, "digi"), ins = sheetCanvas(H, p, "digiIn");
  var b = d.board, W = d.w, Hh = d.h;
  var back = board(H, W, Hh, b, faceMat(H, ins, "tray"), faceMat(H, o, "back"));
  back.position.z = (-d.d / 2 + b / 2) * S;
  out.g.add(back);
  var spine = panel(H, o, "spine", d.d, Hh);
  spine.rotation.y = -Math.PI / 2; spine.position.x = (-W / 2 - 0.05) * S;
  out.g.add(spine);
  var tray = box(H, W - 12, Hh - 12, d.d - 2 * b - 0.6, g.tray === "clear" ? clearMat(H, "#dfe6ea", 0.3) : solidMat(H, TRAY_C[g.tray] || TRAY_C.black, 0.35));
  tray.position.set(2 * S, 0, (-d.d / 2 + b + (d.d - 2 * b - 0.6) / 2) * S);
  out.g.add(tray);
  var dc = disc(H, p);
  dc.position.set(2 * S, 0, (d.d / 2 - b - 0.2) * S);
  out.g.add(dc);
  var pivot = new THREE.Group();
  pivot.position.set(-W / 2 * S, 0, (d.d / 2 - b / 2) * S);
  var fr = board(H, W, Hh, b, faceMat(H, o, "front"), faceMat(H, ins, "inside"));
  fr.position.x = W / 2 * S;
  pivot.add(fr);
  out.g.add(pivot);
  out.fronts.push(pivot);
  return out;
}
function sleeve(H, p, d) {
  var THREE = H.THREE, S = H.S, out = { g: new THREE.Group(), fronts: [] };
  var o = sheetCanvas(H, p, "sleeve"), b = d.board, W = d.w, Hh = d.h;
  var inM = solidMat(H, CARD_EDGE, 0.85);
  var fr = board(H, W, Hh, b, faceMat(H, o, "front"), inM);
  fr.position.z = (d.d / 2 - b / 2) * S;
  var bk = board(H, W, Hh, b, inM, faceMat(H, o, "back"));
  bk.position.z = (-d.d / 2 + b / 2) * S;
  out.g.add(fr); out.g.add(bk);
  // glued along the top, the bottom and the left: open at the right
  var gap = d.d - 2 * b;
  [[W, 0.8, 0, Hh / 2 - 0.4], [W, 0.8, 0, -Hh / 2 + 0.4], [0.8, Hh, -W / 2 + 0.4, 0]].forEach(function (e) {
    var m = box(H, e[0], e[1], gap, inM);
    m.position.set(e[2] * S, e[3] * S, 0);
    out.g.add(m);
  });
  // the disc between the boards, open at the right edge
  var slide = new THREE.Group(), dc = disc(H, p);
  slide.add(dc);
  slide.userData.open = function (deg) { slide.position.x = (deg / 160) * 72 * S; };
  out.g.add(slide);
  out.fronts.push(slide);
  return out;
}

// ---------- DVD / Blu-ray ----------
// o: { key (the sleeve's sheet), inner(H, p) → what lies inside (the disc) }
function amaray(H, p, d, o) {
  o = o || {};
  var THREE = H.THREE, S = H.S, g = p.g, out = { g: new THREE.Group(), fronts: [] };
  var sh = sheetCanvas(H, p, o.key || "sleeve"), W = d.w, Hh = d.h, half = d.d / 2;
  var col = CASE_C[g.col] || CASE_C.black, clearCase = g.col === "clear";
  var body = clearCase ? clearMat(H, col, 0.3) : H.own(new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.42, clearcoat: 0.3 }));
  var film = clearMat(H, "#ffffff", 0.08);
  var sw = d.panel, shH = d.sh;
  // back half with the spine and the hub
  // a deep case (VHS) is two hollow trays, a DVD case two solid halves
  var wall = 1.2;
  function half3(sign) {
    var grp = new THREE.Group();
    if (!o.hollow) { grp.add(box(H, W, Hh, half, body)); return grp; }
    var pl = box(H, W, Hh, wall, body);
    pl.position.z = sign * (half / 2 - wall / 2) * S;
    grp.add(pl);
    [[W, wall, 0, Hh / 2 - wall / 2], [W, wall, 0, -Hh / 2 + wall / 2], [wall, Hh, -W / 2 + wall / 2, 0], [wall, Hh, W / 2 - wall / 2, 0]].forEach(function (r) {
      var m = box(H, r[0], r[1], half, body);
      m.position.set(r[2] * S, r[3] * S, 0);
      grp.add(m);
    });
    return grp;
  }
  var back = half3(-1);
  back.position.z = -half / 2 * S;
  out.g.add(back);
  var bpic = panel(H, sh, "back", sw, shH, printMat(H, sh, true));
  bpic.rotation.y = Math.PI; bpic.position.z = (-d.d / 2 - 0.06) * S;
  out.g.add(bpic);
  var spic = panel(H, sh, "spine", d.spine, shH, printMat(H, sh, true));
  spic.rotation.y = -Math.PI / 2; spic.position.x = (-W / 2 - 0.06) * S;
  spic.scale.x = d.d / d.spine;
  out.g.add(spic);
  if (o.inner) out.g.add(o.inner(H, p));
  else {
    var hub = new THREE.Mesh(H.own(new THREE.CylinderGeometry(7 * S, 7 * S, 2.5 * S, 24)), body);
    hub.rotation.x = Math.PI / 2; hub.position.set(2 * S, 0, 1.2 * S);
    out.g.add(hub);
    var dc = disc(H, p);
    dc.position.set(2 * S, 0, 0.8 * S);
    out.g.add(dc);
  }
  // front half on the hinge
  var pivot = new THREE.Group();
  pivot.position.set(-W / 2 * S, 0, half / 2 * S);
  var fr = new THREE.Group();
  fr.position.x = W / 2 * S;
  fr.add(half3(1));
  var fpic = panel(H, sh, "front", sw, shH, printMat(H, sh, true));
  fpic.position.z = (half / 2 + 0.06) * S;
  fr.add(fpic);
  var fl = new THREE.Mesh(H.own(new THREE.PlaneGeometry(W * S, Hh * S)), film);
  fl.position.z = (half / 2 + 0.12) * S;
  fr.add(fl);
  pivot.add(fr);
  out.g.add(pivot);
  out.fronts.push(pivot);
  // the inside of the halves is the case colour: hide the disc when shut
  return out;
}

export function build(H, p) {
  var kind = p.kind, res;
  if (kind === "cd") {
    var d = H.C.good("cd").dims(p.g);
    res = p.g.pack === "jewel" ? jewel(H, p, d, false)
      : p.g.pack === "slim" ? jewel(H, p, d, true)
      : p.g.pack === "digi" ? digipak(H, p, d) : sleeve(H, p, d);
  } else if (kind === "dvd") {
    res = amaray(H, p, H.C.good("dvd").dims(p.g));
  } else return null;
  if (p.g.beside) {
    // the disc standing next to the pack, leaning a little
    var THREE = H.THREE, S = H.S, b = new THREE.Box3().setFromObject(res.g), side = disc(H, p), wrap = new THREE.Group();
    wrap.add(side);
    side.position.y = b.min.y + 60 * S;
    wrap.rotation.y = -0.35;
    var room = kind === "cd" && p.g.pack === "sleeve" ? 78 : 0;
    wrap.position.set(b.max.x + (66 + room) * S, 0, (b.min.z + b.max.z) / 2 + 20 * S);
    res.g.add(wrap);
  }
  return res;
}

// Shared with the other product modules (goods/analog3d.js).
export { sheetCanvas, panel, printMat, box, clearMat, solidMat, faceMat, board, amaray, CARD_EDGE };
