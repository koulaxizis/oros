// ============================================================
// orOS Mockups — goods/analog3d.js (v1.0.0, ES module)
// The 3D cassette, VHS and vinyl, built in code with the vendored
// three.js (imported by scene.js). Printed parts come from the
// printer's sheets of goods/analog.js, drawn by MockPrint.
//   - cassette: the shell (clear, white, black or smoke) with its two
//     reels and labels (side A in front, side B behind), in a clear
//     Norelco case with its J-card (front, spine, back flap), in a
//     card O-card sleeve, or on its own
//   - VHS: the tape (spine label on its long edge, face label), in a
//     card slip sleeve open at the side, or a clamshell case with its
//     sleeve under the clear film
//   - vinyl: the jacket (single or gatefold), the inner sleeve (white,
//     black or printed) and the record (black, clear, red, blue, white
//     or marbled) with grooves and its two labels
// "Open" (the Scene tab) opens the case or slides the tape or the
// record out. build(H, p) → { g, fronts } or null.
// ============================================================
import { sheetCanvas, panel, printMat, box, clearMat, solidMat, faceMat, amaray, CARD_EDGE } from "./media3d.js";

var SHELL_C = { clear: ["#dfe5ea", 0.35], white: ["#efeeea", 1], black: ["#1a1a1d", 1], smoke: ["#5a5f66", 0.55] };
var REC_C = { black: "#0d0d0f", clear: "#e8eef2", red: "#b3162b", blue: "#1f4fa8", white: "#f1f0ec", marble: "#6b3fa0" };

function shellMat(H, k) {
  var c = SHELL_C[k] || SHELL_C.clear;
  return c[1] < 1 ? clearMat(H, c[0], c[1]) : H.own(new H.THREE.MeshPhysicalMaterial({ color: c[0], roughness: 0.4, clearcoat: 0.3 }));
}
// A rectangle facing +x (a side edge), its picture read bottom to top.
function sidePanel(H, sh, k, len, wid) {
  var g = new H.THREE.Group(), m = panel(H, sh, k, len, wid, printMat(H, sh));
  m.rotation.z = Math.PI / 2;
  g.add(m);
  g.rotation.y = Math.PI / 2;
  return g;
}

// ---------- Cassette ----------
// The tape, landscape in x-y, side A toward +z.
function cassette(H, p) {
  var THREE = H.THREE, S = H.S, D = H.C.good("tape").dims(p.g), T = D.tape, g = new THREE.Group();
  var lab = sheetCanvas(H, p, "tlabel"), sm = shellMat(H, p.g.shell);
  var sh = box(H, T.w, T.h, T.d, sm);
  if (p.g.shell === "clear" || p.g.shell === "smoke") { sh.castShadow = false; sh.renderOrder = 2; }
  g.add(sh);
  // the two reels with their tape packs
  var hubM = solidMat(H, "#f2f2f0", 0.5), tapeM = solidMat(H, "#3a2a20", 0.6);
  [-1, 1].forEach(function (s, i) {
    var r = i ? 12 : 19;
    var pack = new THREE.Mesh(H.own(new THREE.CylinderGeometry(r * S, r * S, 6 * S, 40)), tapeM);
    pack.rotation.x = Math.PI / 2; pack.position.set(s * 21 * S, 4 * S, 0);
    g.add(pack);
    var hub = new THREE.Mesh(H.own(new THREE.CylinderGeometry(7.5 * S, 7.5 * S, 7 * S, 6)), hubM);
    hub.rotation.x = Math.PI / 2; hub.position.set(s * 21 * S, 4 * S, 0);
    g.add(hub);
  });
  // the labels, and the window through them
  var win = clearMat(H, "#20252b", 0.6);
  [["sideA", 1], ["sideB", -1]].forEach(function (x) {
    var l = panel(H, lab, x[0], D.label.w, D.label.h);
    l.position.set(0, 3 * S, x[1] * (T.d / 2 + 0.05) * S);
    if (x[1] < 0) l.rotation.y = Math.PI;
    g.add(l);
    var w = new THREE.Mesh(H.own(new THREE.PlaneGeometry(56 * S, 15 * S)), win);
    w.position.set(0, 4 * S, x[1] * (T.d / 2 + 0.1) * S);
    if (x[1] < 0) w.rotation.y = Math.PI;
    g.add(w);
  });
  // the head opening along the bottom edge
  var lip = box(H, 64, 8, T.d + 0.6, solidMat(H, (SHELL_C[p.g.shell] || SHELL_C.clear)[0], 0.5));
  lip.position.y = (-T.h / 2 + 4) * S;
  g.add(lip);
  return g;
}
// The tape stood up inside a case (portrait: its long side up).
function tapeUp(H, p) {
  var t = cassette(H, p);
  t.rotation.z = Math.PI / 2;
  t.scale.set(0.98, 0.98, 0.98);
  return t;
}
function norelco(H, p) {
  var THREE = H.THREE, S = H.S, D = H.C.good("tape").dims(p.g), out = { g: new THREE.Group(), fronts: [] };
  var jc = sheetCanvas(H, p, "jcard"), clear = clearMat(H), W = D.w, Hh = D.h, lidT = 2;
  var base = box(H, W, Hh, D.d - lidT, clear); base.castShadow = false; base.renderOrder = 2;
  base.position.z = -lidT / 2 * S;
  out.g.add(base);
  var t = tapeUp(H, p); t.position.z = -1.5 * S;
  out.g.add(t);
  // the J-card: spine on the left side, the flap inside the back
  var sp = panel(H, jc, "spine", D.j.spine, D.j.h);
  sp.rotation.y = -Math.PI / 2; sp.position.set((-W / 2 + 0.3) * S, 0, 0);
  sp.scale.x = (D.d - 1) / D.j.spine;
  out.g.add(sp);
  var fl = panel(H, jc, "flap", D.j.flap, D.j.h);
  fl.rotation.y = Math.PI; fl.position.set((-W / 2 + D.j.flap / 2 + 0.5) * S, 0, (-D.d / 2 + 0.3) * S);
  out.g.add(fl);
  var pivot = new THREE.Group();
  pivot.position.set(-W / 2 * S, 0, (D.d / 2 - lidT / 2) * S);
  var lid = new THREE.Group(); lid.position.x = W / 2 * S;
  var lm = box(H, W, Hh, lidT, clear); lm.castShadow = false; lm.renderOrder = 3;
  lid.add(lm);
  var fr = panel(H, jc, "front", D.j.front, D.j.h, printMat(H, jc, true));
  fr.position.set(1.5 * S, 0, (-lidT / 2 - 0.2) * S); fr.castShadow = true;
  lid.add(fr);
  pivot.add(lid);
  out.g.add(pivot);
  out.fronts.push(pivot);
  return out;
}
function ocard(H, p) {
  var THREE = H.THREE, S = H.S, out = { g: new THREE.Group(), fronts: [] };
  var oc = sheetCanvas(H, p, "ocard"), W = 70, Hh = 110.5, d = 17.5;
  var card = solidMat(H, CARD_EDGE, 0.85), open = solidMat(H, "#2a2c30", 0.7);
  // a tube: printed on four sides, open at the top and the bottom
  var tube = box(H, W, Hh, d, [faceMat(H, oc, "side"), faceMat(H, oc, "spine"), open, open, faceMat(H, oc, "front", true), faceMat(H, oc, "back")]);
  out.g.add(tube);
  void card;
  var slide = new THREE.Group(), cs = box(H, 69, 110, 17, clearMat(H)), t = tapeUp(H, p);
  slide.add(cs); slide.add(t);
  slide.userData.open = function (deg) { slide.position.y = (deg / 160) * 80 * S; slide.visible = deg > 0; };
  out.g.add(slide);
  out.fronts.push(slide);
  return out;
}

// ---------- VHS ----------
// The tape portrait (187 up, 102 across, 25 deep): spine label on +x.
function vhsTape(H, p) {
  var THREE = H.THREE, S = H.S, D = H.C.good("vhs").dims(p.g), T = D.tape, g = new THREE.Group();
  var fs = sheetCanvas(H, p, "vface"), ss = sheetCanvas(H, p, "vspine");
  g.add(box(H, T.h, T.w, T.d, H.own(new THREE.MeshPhysicalMaterial({ color: "#141416", roughness: 0.45, clearcoat: 0.2 }))));
  var sp = sidePanel(H, ss, "tspine", 147, 18);
  sp.position.x = (T.h / 2 + 0.05) * S;
  g.add(sp);
  var fc = panel(H, fs, "face", 78, 46);
  fc.rotation.z = Math.PI / 2;
  fc.position.set((T.h / 2 - 30) * S, 0, (T.d / 2 + 0.05) * S);
  g.add(fc);
  var win = new THREE.Mesh(H.own(new THREE.PlaneGeometry(28 * S, 70 * S)), clearMat(H, "#3a4048", 0.7));
  win.position.set(-18 * S, 0, (T.d / 2 + 0.06) * S);
  g.add(win);
  return g;
}
function vhsSlip(H, p) {
  var THREE = H.THREE, S = H.S, D = H.C.good("vhs").dims(p.g), out = { g: new THREE.Group(), fronts: [] };
  var sl = sheetCanvas(H, p, "vslip"), card = solidMat(H, CARD_EDGE, 0.85);
  var W = D.w, Hh = D.h, d = D.d, t = 0.7;
  [[W, Hh, t, 0, 0, d / 2 - t / 2, faceMat(H, sl, "front", true), card],
   [W, Hh, t, 0, 0, -d / 2 + t / 2, card, faceMat(H, sl, "back")]].forEach(function (a) {
    var m = box(H, a[0], a[1], a[2], [card, card, card, card, a[6], a[7]]);
    m.position.set(a[3] * S, a[4] * S, a[5] * S);
    out.g.add(m);
  });
  var spine = box(H, t, Hh, d, [card, faceMat(H, sl, "spine"), card, card, card, card]);
  spine.position.x = (-W / 2 + t / 2) * S;
  out.g.add(spine);
  [Hh / 2 - t / 2, -Hh / 2 + t / 2].forEach(function (y) {
    var e = box(H, W, t, d, card); e.position.y = y * S; out.g.add(e);
  });
  var slide = new THREE.Group(), tp = vhsTape(H, p);
  slide.add(tp);
  slide.position.x = 1.2 * S;
  slide.userData.open = function (deg) { slide.position.x = (1.2 + (deg / 160) * 90) * S; };
  out.g.add(slide);
  out.fronts.push(slide);
  return out;
}

// ---------- Vinyl ----------
var grooveCache = {};
function grooveCanvas(H, D, rc) {
  var key = D.rec + rc;
  if (grooveCache[key]) return grooveCache[key];
  var n = 1024, cv = document.createElement("canvas");
  cv.width = cv.height = n;
  var x = cv.getContext("2d"), c = n / 2, k = n / D.rec;
  x.fillStyle = REC_C[rc] || REC_C.black; x.fillRect(0, 0, n, n);
  if (rc === "marble") {
    for (var i = 0; i < 60; i++) {
      x.strokeStyle = ["#d9c7f0", "#2b124d", "#a77bd8", "#f4ecff"][i % 4]; x.globalAlpha = 0.35; x.lineWidth = 6 + (i % 5) * 4;
      x.beginPath(); x.arc(c + Math.sin(i * 7.1) * 120, c + Math.cos(i * 3.3) * 120, 60 + i * 7, i, i + 2.4); x.stroke();
    }
    x.globalAlpha = 1;
  }
  // grooves: fine rings, and two quiet bands between the tracks
  for (var r = D.label / 2 + 6; r < D.rec / 2 - 3; r += 0.45) {
    var band = Math.abs(r - D.rec * 0.3) < 0.8 || Math.abs(r - D.rec * 0.4) < 0.8;
    x.strokeStyle = band ? "rgba(255,255,255,0.12)" : (Math.floor(r * 7) % 2 ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.05)");
    x.lineWidth = 1;
    x.beginPath(); x.arc(c, c, r * k, 0, Math.PI * 2); x.stroke();
  }
  grooveCache[key] = cv;
  return cv;
}
function record(H, p) {
  var THREE = H.THREE, S = H.S, D = H.C.good("vinyl").dims(p.g), g = new THREE.Group(), R = D.rec / 2;
  var tex = H.own(new THREE.CanvasTexture(grooveCanvas(H, D, p.g.rc)));
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = H.ANISO;
  var see = p.g.rc === "clear";
  var faceM = H.own(new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.25,
    transparent: see, opacity: see ? 0.55 : 1, side: THREE.DoubleSide }));
  var edge = new THREE.Mesh(H.own(new THREE.CylinderGeometry(R * S, R * S, D.t * S, 120, 1, true)), faceM);
  edge.rotation.x = Math.PI / 2; edge.castShadow = true;
  g.add(edge);
  [["labelA", 1], ["labelB", -1]].forEach(function (x) {
    var f = new THREE.Mesh(H.own(new THREE.RingGeometry(D.hole / 2 * S, R * S, 120, 1)), faceM);
    var uv = f.geometry.attributes.uv, pos = f.geometry.attributes.position;
    for (var i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / (D.rec * S), 0.5 + pos.getY(i) / (D.rec * S));
    uv.needsUpdate = true;
    f.position.z = x[1] * D.t / 2 * S; if (x[1] < 0) f.rotation.y = Math.PI;
    f.castShadow = true; f.receiveShadow = true;
    g.add(f);
    var sh = sheetCanvas(H, p, x[0]);
    if (!sh) return;
    var lab = new THREE.Mesh(H.own(new THREE.RingGeometry(D.hole / 2 * S, D.label / 2 * S, 96, 1)),
      H.own(new THREE.MeshStandardMaterial({ map: sh.tex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    var u2 = lab.geometry.attributes.uv, p2 = lab.geometry.attributes.position;
    for (var j = 0; j < u2.count; j++) u2.setXY(j, 0.5 + p2.getX(j) / (D.label * S), 0.5 + p2.getY(j) / (D.label * S));
    u2.needsUpdate = true;
    lab.position.z = x[1] * (D.t / 2 + 0.08) * S; if (x[1] < 0) lab.rotation.y = Math.PI;
    g.add(lab);
  });
  return g;
}
function vinylPack(H, p) {
  var THREE = H.THREE, S = H.S, D = H.C.good("vinyl").dims(p.g), out = { g: new THREE.Group(), fronts: [] };
  var jk = sheetCanvas(H, p, H.C.sheetsOf(p)[0]), card = solidMat(H, CARD_EDGE, 0.85), W = D.w, d = D.d, t = 0.9;
  [[d / 2 - t / 2, faceMat(H, jk, "front"), card], [-d / 2 + t / 2, card, faceMat(H, jk, "back")]].forEach(function (a) {
    var m = box(H, W, W, t, [card, card, card, card, a[1], a[2]]);
    m.position.z = a[0] * S;
    out.g.add(m);
  });
  var spine = box(H, t, W, d, [card, faceMat(H, jk, "spine"), card, card, card, card]);
  spine.position.x = (-W / 2 + t / 2) * S;
  out.g.add(spine);
  [W / 2 - t / 2, -W / 2 + t / 2].forEach(function (y) { var e = box(H, W, t, d, card); e.position.y = y * S; out.g.add(e); });
  // the inner sleeve with the record half out of it
  var slide = new THREE.Group(), inner = new THREE.Group();
  var isheet = p.g.inner === "printed" ? sheetCanvas(H, p, "inner") : null;
  var paper = solidMat(H, p.g.inner === "black" ? "#16161a" : "#f3f1ec", 0.85);
  var im = box(H, D.inner, D.inner, 0.4, [paper, paper, paper, paper, isheet ? faceMat(H, isheet, "innerF") : paper, isheet ? faceMat(H, isheet, "innerB") : paper]);
  inner.add(im);
  var rec = record(H, p);
  rec.position.x = D.rec * 0.42 * S; rec.position.z = 0.4 * S;
  inner.add(rec);
  slide.add(inner);
  slide.userData.open = function (deg) {
    var f = deg / 160;
    slide.visible = f > 0;
    slide.position.x = f * W * 0.55 * S;
    rec.position.x = (0.15 + f * 0.35) * D.rec * S;
  };
  out.g.add(slide);
  out.fronts.push(slide);
  return out;
}

export function build(H, p) {
  var THREE = H.THREE, S = H.S, res;
  if (p.kind === "tape") {
    var k = p.g.pack;
    if (k === "norelco") res = norelco(H, p);
    else if (k === "ocard") res = ocard(H, p);
    else { res = { g: new THREE.Group(), fronts: [] }; var t = tapeUp(H, p); t.rotation.z = 0; res.g.add(t); }
  } else if (p.kind === "vhs") {
    if (p.g.pack === "slip") res = vhsSlip(H, p);
    else if (p.g.pack === "clam") res = amaray(H, p, H.C.good("vhs").dims(p.g), { key: "vclam", hollow: true, inner: function () { var v = vhsTape(H, p), D = H.C.good("vhs").dims(p.g); v.position.z = (-D.d / 2 + 1.3 + D.tape.d / 2) * H.S; return v; } });
    else { res = { g: new THREE.Group(), fronts: [] }; res.g.add(vhsTape(H, p)); }
  } else if (p.kind === "vinyl") {
    res = vinylPack(H, p);
  } else return null;
  if (p.g.beside && p.g.pack !== "none") {
    var b = new THREE.Box3().setFromObject(res.g), item = p.kind === "tape" ? cassette(H, p) : p.kind === "vhs" ? vhsTape(H, p) : record(H, p), wrap = new THREE.Group();
    wrap.add(item);
    var ib = new THREE.Box3().setFromObject(item);
    item.position.y = b.min.y - ib.min.y;
    wrap.rotation.y = -0.35;
    var room = p.kind === "vinyl" ? vinylRoom(H, p) : 20;
    wrap.position.set(b.max.x + (ib.max.x - ib.min.x) / 2 + room * S, 0, (b.min.z + b.max.z) / 2 + 20 * S);
    res.g.add(wrap);
  }
  return res;
}
function vinylRoom(H, p) { return H.C.good("vinyl").dims(p.g).w * 0.6; }
