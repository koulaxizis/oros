// ============================================================
// orOS Mockups — goods/home3d.js (v1.0.0, ES module)
// The 3D mug, framed poster and postcard / greeting card, built in
// code with the vendored three.js (imported by scene.js). Every
// printed part takes its picture from the printer's sheet of
// goods/home.js drawn by MockPrint.
//   - mug: 11 or 15 oz ceramic, the wrap round it (its middle
//     opposite the handle), inside and handle colours
//   - poster: in a black, white, oak, walnut or aluminium frame,
//     with a mat (passe-partout) and glass, or bare; on a wall
//   - card: a flat postcard (front and back) or a folded greeting
//     card that opens ("open"), with an envelope behind it
// Units: 1 mm = S scene units. build(H, p) → { g, fronts } or null.
// ============================================================
import { sheetCanvas, panel, box, clearMat, solidMat } from "./media3d.js";

var MUG_C = { white: "#f4f3ef", black: "#1b1b1d", red: "#c8312b", blue: "#2a5ca8", yellow: "#f0c419", green: "#3c8a4e" };
var FRAME_C = { black: ["#18181a", 0.45, 0], white: ["#f1f0ec", 0.5, 0], oak: ["#c29a6b", 0.7, 0], walnut: ["#5a3a28", 0.6, 0], alu: ["#b9bdc3", 0.3, 1] };
var ENV_C = { white: "#f6f5f1", kraft: "#c7a47a", black: "#1d1d1f" };
var WALL_C = { light: "#e9e5de", dark: "#3b3e44" };

// a printed panel drawn over what is right behind it (no z-fighting)
function onTop(m) { m.material.polygonOffset = true; m.material.polygonOffsetFactor = -2; m.material.polygonOffsetUnits = -2; return m; }
// a thin body casts its shadow from its back faces, so the print on its front does not shade itself
function backShadow(H, m) { m.shadowSide = H.THREE.BackSide; return m; }
function mat(H, c, rough, metal, extra) {
  return H.own(new H.THREE.MeshPhysicalMaterial(Object.assign({ color: c, roughness: rough, metalness: metal || 0 }, extra || {})));
}

// ---------- Mug ----------
function mug(H, p) {
  var THREE = H.THREE, S = H.S, g = p.g, D = H.C.good("mug").dims(g), R = D.w / 2, Hh = D.h, grp = new THREE.Group();
  var gloss = g.fin === "gloss" ? { clearcoat: 1, clearcoatRoughness: 0.08 } : {};
  var white = mat(H, MUG_C.white, g.fin === "gloss" ? 0.18 : 0.6, 0, gloss);
  var inner = mat(H, MUG_C[g.inner], 0.25, 0, { side: THREE.BackSide, clearcoat: 0.8 });
  var handleM = mat(H, MUG_C[g.handle], g.fin === "gloss" ? 0.18 : 0.6, 0, gloss);
  var body = new THREE.Mesh(H.own(new THREE.CylinderGeometry(R * S, R * 0.985 * S, Hh * S, 96, 1, true)), white);
  body.castShadow = true; body.receiveShadow = true;
  grp.add(body);
  var ins = new THREE.Mesh(H.own(new THREE.CylinderGeometry((R - 3) * S, (R - 3.4) * S, (Hh - 0.2) * S, 96, 1, true)), inner);
  grp.add(ins);
  var rim = new THREE.Mesh(H.own(new THREE.RingGeometry((R - 3) * S, R * S, 96)), mat(H, MUG_C[g.inner], 0.25, 0, { side: THREE.DoubleSide }));
  rim.rotation.x = -Math.PI / 2; rim.position.y = Hh / 2 * S;
  grp.add(rim);
  var floor = new THREE.Mesh(H.own(new THREE.CircleGeometry((R - 3.4) * S, 64)), mat(H, MUG_C[g.inner], 0.3));
  floor.rotation.x = -Math.PI / 2; floor.position.y = (-Hh / 2 + 7) * S;
  grp.add(floor);
  var base = new THREE.Mesh(H.own(new THREE.CircleGeometry(R * 0.985 * S, 64)), white);
  base.rotation.x = Math.PI / 2; base.position.y = -Hh / 2 * S;
  grp.add(base);
  // the wrap: its middle opposite the handle (handle on +x)
  var sh = sheetCanvas(H, p, "mugwrap");
  if (sh) {
    var T = sh.T, L = T.sheet.w / (R + 0.15), mid = -Math.PI / 2;
    var band = new THREE.Mesh(H.own(new THREE.CylinderGeometry((R + 0.15) * S, (R + 0.15) * S, T.sheet.h * S, 160, 1, true, mid - L / 2, L)),
      mat(H, "#ffffff", g.fin === "gloss" ? 0.2 : 0.62, 0, Object.assign({ map: sh.tex }, gloss)));
    band.position.y = -2 * S;
    band.receiveShadow = true;
    grp.add(band);
  }
  var hR = Hh * 0.27, handle = new THREE.Mesh(H.own(new THREE.TorusGeometry(hR * S, 5.2 * S, 18, 48, Math.PI)), handleM);
  handle.rotation.z = -Math.PI / 2; handle.position.set((R - 1) * S, 3 * S, 0);
  handle.castShadow = true;
  grp.add(handle);
  return grp;
}

// ---------- Framed poster ----------
function poster(H, p) {
  var THREE = H.THREE, S = H.S, g = p.g, D = H.C.good("poster").dims(g), grp = new THREE.Group(), sh = sheetCanvas(H, p, "poster");
  var pw = D.poster.w, ph = D.poster.h, d = D.d;
  if (g.frame === "none") {
    var pp = onTop(panel(H, sh, "front", pw, ph));
    grp.add(pp);
    var back = box(H, pw, ph, 0.3, backShadow(H, solidMat(H, "#efede8", 0.8))); back.position.z = -0.5 * S; grp.add(back);
  } else {
    var ow = D.mat ? pw + 2 * D.mat : pw - 2 * D.lip, oh = D.mat ? ph + 2 * D.mat : ph - 2 * D.lip, b = D.bar;
    var fc = FRAME_C[g.frame] || FRAME_C.black, fm = mat(H, fc[0], fc[1], fc[2]);
    [[ow + 2 * b, b, 0, (oh + b) / 2], [ow + 2 * b, b, 0, -(oh + b) / 2], [b, oh, -(ow + b) / 2, 0], [b, oh, (ow + b) / 2, 0]].forEach(function (r) {
      var m = box(H, r[0], r[1], d, fm); m.position.set(r[2] * S, r[3] * S, 0); grp.add(m);
    });
    var board = box(H, ow + 2, oh + 2, 2, backShadow(H, solidMat(H, "#d9d4ca", 0.9))); board.position.z = (-d / 2 + 1) * S; grp.add(board);
    var pic = onTop(panel(H, sh, "front", pw, ph));
    pic.position.z = (-d / 2 + 2.6) * S;
    grp.add(pic);
    if (D.mat) {
      var shape = new THREE.Shape();
      shape.moveTo(-ow / 2 * S, -oh / 2 * S); shape.lineTo(ow / 2 * S, -oh / 2 * S); shape.lineTo(ow / 2 * S, oh / 2 * S); shape.lineTo(-ow / 2 * S, oh / 2 * S); shape.closePath();
      var hw = pw / 2 - D.lip, hh = ph / 2 - D.lip, hole = new THREE.Path();
      hole.moveTo(-hw * S, -hh * S); hole.lineTo(-hw * S, hh * S); hole.lineTo(hw * S, hh * S); hole.lineTo(hw * S, -hh * S); hole.closePath();
      shape.holes.push(hole);
      var mg = H.own(new THREE.ExtrudeGeometry(shape, { depth: 1.6 * S, bevelEnabled: false }));
      var mm = new THREE.Mesh(mg, solidMat(H, "#f6f4ee", 0.85));
      mm.position.z = (-d / 2 + 3.2) * S; mm.castShadow = true; mm.receiveShadow = true;
      grp.add(mm);
    }
    var glass = new THREE.Mesh(H.own(new THREE.PlaneGeometry(ow * S, oh * S)), clearMat(H, "#ffffff", 0.07));
    glass.position.z = (d / 2 - 3) * S;
    grp.add(glass);
  }
  if (g.wall !== "none") {
    var bb = new THREE.Box3().setFromObject(grp), sz = bb.getSize(new THREE.Vector3());
    var wall = new THREE.Mesh(H.own(new THREE.PlaneGeometry(sz.x * 3.2, sz.y * 2.6)), solidMat(H, WALL_C[g.wall], 0.95));
    wall.position.set(0, sz.y * 0.25, bb.min.z - 0.2 * S);
    wall.receiveShadow = true; wall.userData.skip = true;
    grp.add(wall);
  }
  return grp;
}

// ---------- Card ----------
function card(H, p) {
  var THREE = H.THREE, S = H.S, g = p.g, D = H.C.good("card").dims(g), w = D.w, h = D.h, t = 0.35, grp = new THREE.Group(), fronts = [];
  var paper = backShadow(H, solidMat(H, "#f7f5f0", 0.85));
  function leaf(sh1, k1, sh2, k2) {
    var lf = new THREE.Group(), body = box(H, w, h, t, paper);
    lf.add(body);
    var a = onTop(panel(H, sh1, k1, w, h)); a.position.z = (t / 2 + 0.06) * S; lf.add(a);
    var b = onTop(panel(H, sh2, k2, w, h)); b.rotation.y = Math.PI; b.position.z = -(t / 2 + 0.06) * S; lf.add(b);
    return lf;
  }
  if (g.ck === "folded") {
    var out = sheetCanvas(H, p, "gcout"), inn = sheetCanvas(H, p, "gcin");
    var backLeaf = leaf(inn, "inside2", out, "back");
    backLeaf.position.z = -t / 2 * S;
    grp.add(backLeaf);
    var pivot = new THREE.Group();
    pivot.position.set(-w / 2 * S, 0, t / 2 * S);
    var fl = leaf(out, "front", inn, "inside");
    fl.position.x = w / 2 * S;
    pivot.add(fl);
    grp.add(pivot);
    fronts.push(pivot);
  } else {
    grp.add(leaf(sheetCanvas(H, p, "pcfront"), "front", sheetCanvas(H, p, "pcback"), "back"));
  }
  if (g.env !== "none") {
    var ec = ENV_C[g.env], em = solidMat(H, ec, g.env === "kraft" ? 0.9 : 0.8), env = new THREE.Group();
    var ew = D.env.w, eh = D.env.h;
    env.add(box(H, ew, eh, 0.5, em));
    var fs = new THREE.Shape();
    fs.moveTo(-ew / 2 * S, 0); fs.lineTo(ew / 2 * S, 0); fs.lineTo(0, eh * 0.42 * S); fs.closePath();
    var flap = new THREE.Mesh(H.own(new THREE.ShapeGeometry(fs)), H.own(new THREE.MeshStandardMaterial({ color: ec, roughness: 0.85, side: THREE.DoubleSide })));
    flap.position.set(0, eh / 2 * S, 0.26 * S);
    env.add(flap);
    env.position.set(-w * 0.18 * S, h * 0.12 * S, -(t + 1.2) * S);
    env.rotation.z = 0.08;
    grp.add(env);
  }
  return { g: grp, fronts: fronts };
}

export function build(H, p) {
  var THREE = H.THREE, k = p.kind;
  if (k === "mug") return { g: wrap(THREE, mug(H, p)), fronts: [] };
  if (k === "poster") return { g: wrap(THREE, poster(H, p)), fronts: [] };
  if (k === "card") return card(H, p);
  return null;
}
function wrap(THREE, o) { var g = new THREE.Group(); g.add(o); return g; }
