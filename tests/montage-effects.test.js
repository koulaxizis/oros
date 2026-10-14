// Montage wave 41 (pure logic): speed curves (time remapping, split,
// trim, sound pieces), chroma key, border, reframe (focus keys, crop
// maths, the subject finder's steps), noise removal streaming with the
// real RNNoise wasm, speech to text (mel, decoding rules, text), and
// old projects loading unchanged.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "montage/core.js"));
const G = require(path.join(ROOT, "montage/gl.js"));
const R = require(path.join(ROOT, "montage/reframe.js"));
const D = require(path.join(ROOT, "montage/denoise.js"));

const T0 = 1760000000000;
const H = (c) => c.repeat(64);
const VID = H("a") + ".mp4", PIC = H("c") + ".jpg", SND = H("d") + ".mp3", CLEAN = H("e") + ".m4a", CLEAN2 = H("f") + ".ogg";
const J = (x) => JSON.stringify(x);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), (msg || "") + " " + a + " ≉ " + b);

function proj(extra) {
  let d = C.newProject(C.merge(null, null), { name: "W41", ar: "9:16" }, T0, "p1");
  d = C.addItem(d, "p1", Object.assign({ id: "v1", k: "video", tr: "main", src: VID, len: 30, in: 2, out: 12 }, extra || {}), T0 + 1);
  return d;
}
const item = (d, id) => d.projects.p1.items[id || "v1"];

test("old projects load unchanged: no new field is written when unused", () => {
  const d = proj();
  d.projects.p1.items.i1 = { id: "i1", k: "image", tr: "ov", src: PIC, d: 4, m: T0, at: 1 };
  const once = C.merge(d, null);
  assert.equal(J(C.merge(once, null)), J(once));
  for (const it of Object.values(once.projects.p1.items)) for (const k of ["sr", "ck", "bd", "fc", "na"]) assert.ok(!(k in it), k + " absent");
  // a speed curve of one key, an empty key list, junk: dropped
  const j = proj({ sr: [{ s: 3, v: 2 }], ck: "green", bd: { w: 0, r: 0 }, fc: [], na: "x.m4a" });
  for (const k of ["sr", "ck", "bd", "fc", "na"]) assert.ok(!(k in item(j)), k + " dropped");
});

test("new fields: normalized, clamped, only on the kinds that use them", () => {
  const d = proj({ sr: [{ s: 9, v: 50 }, { s: 3, v: 0.01 }, { s: 3, v: 0.5 }, { x: 1 }], ck: { col: "#00FF00", tol: 400, soft: -1 }, bd: { w: 30, col: "red", r: 80 }, fc: [{ t: 5, x: 2, y: -1 }, { t: 1, x: 0.25, y: 0.75 }], na: CLEAN });
  const it = item(d);
  assert.deepEqual(it.sr, [{ s: 3, v: 0.5 }, { s: 9, v: 10 }]);
  assert.deepEqual(it.ck, { col: "#00b140", tol: 100, soft: 0, sp: 50 });
  assert.deepEqual(it.bd, { w: 10, col: "#ffffff", r: 50 });
  assert.deepEqual(it.fc, [{ t: 1, x: 0.25, y: 0.75 }, { t: 5, x: 1, y: 0 }]);
  assert.equal(it.na, CLEAN);
  // a sound clip takes sr / na, never ck / bd / fc; a picture the other way round
  let e = C.addItem(d, "p1", { id: "a1", k: "audio", tr: "a1", src: SND, len: 10, in: 0, out: 10, at: 0, sr: [{ s: 0, v: 1 }, { s: 10, v: 2 }], na: CLEAN, ck: {}, fc: [{ t: 0, x: 0, y: 0 }] }, T0 + 2);
  e = C.addItem(e, "p1", { id: "i1", k: "image", tr: "ov", src: PIC, d: 3, at: 0, sr: [{ s: 0, v: 1 }, { s: 1, v: 2 }], na: CLEAN, ck: {}, bd: { w: 2 } }, T0 + 3);
  assert.ok(item(e, "a1").sr && item(e, "a1").na && !item(e, "a1").ck && !item(e, "a1").fc);
  assert.ok(!item(e, "i1").sr && !item(e, "i1").na && item(e, "i1").ck && item(e, "i1").bd);
  assert.equal(J(C.merge(e, e)), J(e));
});

test("speed curve: duration is ∫ds/v, time remapping runs both ways", () => {
  // constant curve = constant speed
  const flat = item(proj({ sr: [{ s: 0, v: 2 }, { s: 30, v: 2 }] }));
  near(C.itemDur(flat), 5, 1e-9);
  near(C.srcTime(flat, 1.5), 5, 1e-9);
  // a ramp 1× → 3× over the clip (2 … 12 s of the file)
  const it = item(proj({ sr: [{ s: 2, v: 1 }, { s: 12, v: 3 }] }));
  near(C.itemDur(it), 10 * Math.log(3) / 2, 1e-9, "closed form");
  assert.equal(C.srcTime(it, 0), 2);
  near(C.srcTime(it, C.itemDur(it)), 12, 1e-9);
  let last = 2;
  for (let i = 1; i <= 50; i++) {
    const L = C.itemDur(it) * i / 50, s = C.srcTime(it, L);
    assert.ok(s > last, "monotonic");
    near(C.fwdLocal(it, s), L, 1e-9, "inverse");
    last = s;
  }
  // the rate is the curve's speed where the clip is
  near(C.rateAt(it, 0), 1, 1e-9);
  near(C.rateAt(it, C.itemDur(it)), 3, 1e-9);
  // keys outside the clip still shape it (held / interpolated)
  const wide = item(proj({ sr: [{ s: 0, v: 1 }, { s: 20, v: 3 }] }));
  near(C.rateAt(wide, 0), 1.2, 1e-9);
  // numeric check of the integral against small steps
  let t = 0;
  for (let s = 2; s < 12; s += 0.0005) t += 0.0005 / C.srAt(wide.sr, s + 0.00025);
  near(C.itemDur(wide), t, 1e-6, "numeric");
});

test("speed curve: reverse, split and trim keep every frame where it was", () => {
  const sr = [{ s: 2, v: 0.5 }, { s: 6, v: 4 }, { s: 12, v: 1 }];
  const fwd = item(proj({ sr })), rev = item(proj({ sr, rv: true })), D0 = C.itemDur(fwd);
  near(C.itemDur(rev), D0, 1e-12);
  for (const L of [0.3, 1, 2.5, D0 - 0.2]) near(C.srcTime(rev, L), C.srcTime(fwd, D0 - L) - 0.001, 1e-9, "reverse mirror");
  // split at 40 %: both halves together last as long, and show the same frames
  const cutT = D0 * 0.4;
  const d = C.split(proj({ sr }), "p1", "v1", cutT, T0 + 5, "v2");
  const a = item(d, "v1"), b = item(d, "v2");
  near(C.itemDur(a) + C.itemDur(b), D0, 2e-3, "duration kept");
  near(C.srcTime(b, 0.5), C.srcTime(fwd, cutT + 0.5), 2e-3, "same frame after the cut");
  assert.deepEqual(a.sr, sr); assert.deepEqual(b.sr, sr);
  // reversed split
  const dr = C.split(proj({ sr, rv: true }), "p1", "v1", cutT, T0 + 5, "v2");
  near(C.srcTime(item(dr, "v2"), 0.5), C.srcTime(rev, cutT + 0.5), 2e-3, "reversed: same frame");
  // trimming: the left edge moves by timeline time along the curve
  near(C.trimSrc(fwd, "l", 1), C.srcTime(fwd, 1), 1e-12);
  near(C.trimSrc(fwd, "r", -1), C.srcTime(fwd, D0 - 1), 1e-12);
  near(C.trimSrc(fwd, "l", -1), 2 - 0.5, 1e-12, "outside: edge speed");
  // no curve: the old arithmetic
  const plain = item(proj({ sp: 2 }));
  assert.equal(C.trimSrc(plain, "l", 1), 4); assert.equal(C.trimSrc(plain, "r", 1), 14);
});

test("speed curve: presets, setting a point, sound in pieces of one rate", () => {
  const it = item(proj());
  const hero = C.rampPreset(it, "hero");
  assert.equal(hero[0].s, 2); assert.equal(hero[hero.length - 1].s, 12);
  assert.deepEqual(C.RAMPS, ["hero", "bullet", "montage", "jump", "flashin", "flashout"]);
  assert.deepEqual(C.rampPreset(it, "nope"), []);
  // a point near an existing one moves it; elsewhere a new one goes in
  const withHero = Object.assign({}, it, { sr: hero });
  assert.equal(C.srSet(withHero, 7.1, 3, 0.4).length, hero.length);
  assert.equal(C.srSet(withHero, 9, 3, 0.4).length, hero.length + 1);
  assert.equal(C.srSet(it, 5, 2).length, 2, "the first point makes a flat curve");
  // sound pieces cover the segment without gaps, rate = Δs/Δt
  let d = proj({ sr: [{ s: 2, v: 0.5 }, { s: 12, v: 2 }] });
  const seg = C.soundPlan(d.projects.p1)[0];
  assert.deepEqual(seg.sr, item(d).sr); assert.equal(seg.out, 12);
  const pcs = C.srcPieces(seg, 0, seg.dur, 0.05);
  near(pcs[0].s0, 2, 1e-9); near(pcs[pcs.length - 1].s1, 12, 1e-9);
  for (let i = 1; i < pcs.length; i++) { assert.equal(pcs[i].t0, pcs[i - 1].t1); assert.equal(pcs[i].s0, pcs[i - 1].s1); }
  assert.ok(pcs.every((p) => p.t1 - p.t0 <= 0.05 + 1e-9));
  // without a curve: one piece at the clip speed
  d = proj({ sp: 1.5 });
  assert.deepEqual(C.srcPieces(C.soundPlan(d.projects.p1)[0], 1, 3), [{ t0: 1, t1: 3, s0: 3.5, s1: 6.5 }]);
});

test("cleaned sound: plays instead of the file's own, is media, follows relinks and detach", () => {
  let d = proj({ na: CLEAN, sr: [{ s: 2, v: 1 }, { s: 12, v: 2 }] });
  assert.equal(C.soundPlan(d.projects.p1)[0].src, CLEAN);
  assert.deepEqual(C.mediaOf(d.projects.p1), [VID, CLEAN].sort());
  // relink the cleaned file: swapped
  let e = C.replaceSrc(d, "p1", CLEAN, CLEAN2, 0, T0 + 9);
  assert.equal(item(e).na, CLEAN2);
  // relink the video with a different file: the cleaned sound no longer fits
  e = C.replaceSrc(d, "p1", VID, H("9") + ".mp4", 30, T0 + 9);
  assert.ok(!("na" in item(e)));
  // extract sound: the new sound clip keeps the curve and the cleaned sound
  e = C.detachSound(d, "p1", "v1", T0 + 9, "s1", "a1");
  assert.equal(item(e, "s1").na, CLEAN); assert.deepEqual(item(e, "s1").sr, item(d).sr);
  near(C.itemDur(item(e, "s1")), C.itemDur(item(d)), 1e-9);
});

test("chroma key: the key colour goes, far colours stay, the shader's numbers match", () => {
  const ck = { col: "#00b140", tol: 40, soft: 25, sp: 50 };
  assert.equal(C.chromaKey([0, 0xb1 / 255, 0x40 / 255], ck).a, 0);
  assert.equal(C.chromaKey([0.9, 0.7, 0.6], ck).a, 1, "skin stays");
  const edge = C.chromaKey([0.15, 0.55, 0.3], ck).a;
  assert.ok(edge >= 0 && edge <= 1);
  assert.ok(C.chromaKey([0.15, 0.55, 0.3], Object.assign({}, ck, { tol: 100 })).a <= edge, "more tolerance removes more");
  // spill: a greenish pixel that stays loses some of its green cast
  const g = C.chromaKey([0.5, 0.75, 0.45], Object.assign({}, ck, { tol: 10, sp: 100 }));
  assert.ok(g.rgb[1] - g.rgb[0] < 0.25);
  assert.deepEqual(G.ckParams(ck), C.ckParams(ck));
  const kc = G.keyCbCr("#00b140");
  near(kc[0], -0.1687 * 0 - 0.3313 * (0xb1 / 255) + 0.5 * (0x40 / 255), 1e-9);
});

test("border and corners: pixels from percentages, never past a circle", () => {
  assert.deepEqual(G.borderPx({ w: 2, r: 10 }, 400, 300, 1080, 1920), { r: 30, w: 21.6 });
  assert.deepEqual(G.borderPx({ w: 10, r: 50 }, 200, 200, 1080, 1920), { r: 100, w: 100 });
  const d = proj({ tr: "main", bd: { w: 1, col: "#ff0000", r: 20 } });
  const L = C.framePlan(d.projects.p1, 1)[0];
  assert.deepEqual(L.bd, { w: 1, col: "#ff0000", r: 20 });
});

test("reframe crop maths: the focus goes to the middle while the picture still covers the box", () => {
  const box = { x: 0, y: 0, w: 1, h: 1 };
  // a 16:9 picture filling a 9:16 frame (1080×1920): 3413 px wide
  const centred = G.placeIn(box, 1920, 1080, 1080, 1920, true);
  near(centred.x, -(3413.333 - 1080) / 2 / 1080, 1e-3);
  assert.deepEqual(G.placeIn(box, 1920, 1080, 1080, 1920, true, { x: 0.5, y: 0.5 }), centred);
  const left = G.placeIn(box, 1920, 1080, 1080, 1920, true, { x: 0.3, y: 0.5 });
  near(left.x + 0.3 * left.w, 0.5, 1e-9, "focus at the middle");
  near(left.y, 0, 1e-12, "no room up/down: stays");
  const edge = G.placeIn(box, 1920, 1080, 1080, 1920, true, { x: 0.02, y: 0.5 });
  assert.equal(edge.x, 0, "clamped: never shows past the picture");
  const right = G.placeIn(box, 1920, 1080, 1080, 1920, true, { x: 1, y: 0.5 });
  near(right.x + right.w, 1, 1e-12);
  // inside an overlay box
  const ob = { x: 0.6, y: 0.1, w: 0.3, h: 0.3 };
  const r2 = G.placeIn(ob, 1000, 1000, 1080, 1920, true, { x: 0.9, y: 0.1 });
  assert.ok(r2.x <= ob.x + 1e-12 && r2.x + r2.w >= ob.x + ob.w - 1e-12 && r2.y <= ob.y && r2.y + r2.h >= ob.y + ob.h - 1e-12);
  // "fit" ignores the focus
  assert.deepEqual(G.placeIn(box, 1920, 1080, 1080, 1920, false, { x: 0, y: 0 }), G.placeIn(box, 1920, 1080, 1080, 1920, false));
});

test("reframe keys: even pace, held outside, in file time, rotate / mirror mapped", () => {
  const keys = [{ t: 4, x: 0.2, y: 0.5 }, { t: 8, x: 0.6, y: 0.3 }];
  assert.deepEqual(C.fcAt(keys, 0), { x: 0.2, y: 0.5 });
  const m = C.fcAt(keys, 6);
  near(m.x, 0.4, 1e-12); near(m.y, 0.4, 1e-12);
  assert.deepEqual(C.fcAt(keys, 99), { x: 0.6, y: 0.3 });
  assert.deepEqual(C.fcAt([], 3), { x: 0.5, y: 0.5 });
  assert.equal(C.fcSet(keys, 4.1, { x: 0.9, y: 0.9 }, 0.25).length, 2, "near key replaced");
  assert.equal(C.fcSet(keys, 6, { x: 0.9, y: 0.9 }).length, 3);
  assert.equal(C.fcSet(keys, 4, null, 0.25).length, 1, "removed");
  // the layer gets the focus at the file time it shows (only when filling)
  let d = proj({ fit: "fill", fc: keys });
  near(C.framePlan(d.projects.p1, 4)[0].fc.x, 0.4, 1e-9, "t=4 on the timeline is 6 s into the file");
  d = proj({ fit: "fit", fc: keys });
  assert.ok(!("fc" in C.framePlan(d.projects.p1, 4)[0]));
  // a split keeps the focus path: keys are on the file, not the clip
  d = C.split(proj({ fit: "fill", fc: keys }), "p1", "v1", 3, T0 + 3, "v2");
  near(C.framePlan(d.projects.p1, 4)[0].fc.x, 0.4, 1e-9);
  // shownPoint inverts the vertex mapping for every rotate / mirror
  for (const rot of [0, 90, 180, 270]) for (const fl of [false, true]) {
    const p = C.shownPoint(0.2, 0.7, rot, fl), uv = C.uvOf(p[0], p[1], rot, fl);
    near(uv[0], 0.2, 1e-12); near(uv[1], 0.7, 1e-12);
  }
  near(C.mediaTime({ k: "image" }, 2.5), 2.5);
});

test("subject finder: motion, detail and faces become a smooth, short key path", () => {
  const W = 32, Hh = 18;
  const frame = (bx) => { const g = new Float32Array(W * Hh); for (let y = 6; y < 12; y++) for (let x = bx; x < bx + 4; x++) g[y * W + x] = 1; return g; };
  const mc = R.motionCentroid(frame(4), frame(6), W, Hh);
  assert.ok(mc.x > 4 / W && mc.x < 11 / W && Math.abs(mc.y - 0.5) < 0.05, "the moving block");
  assert.ok(mc.e > R.E_MIN);
  assert.equal(R.motionCentroid(null, frame(4), W, Hh), null);
  const still = R.motionCentroid(frame(4), frame(4), W, Hh);
  assert.ok(!still || still.e === 0);
  const dc = R.detailCentroid(frame(22), W, Hh);
  assert.ok(dc.x > 0.6, "detail on the right");
  assert.deepEqual(R.faceFocus([{ boundingBox: { x: 10, y: 10, width: 10, height: 10 } }, { x: 60, y: 20, width: 30, height: 30 }], 100, 100), { x: 0.75, y: 0.326 });
  assert.equal(R.faceFocus([], 10, 10), null);
  const gray = R.gray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1);
  near(gray[0], 1, 1e-6); near(gray[1], 0, 1e-12);
  // track: a face wins, then motion; nothing holds the last point
  const tr = R.buildTrack([{ t: 0 }, { t: 1, motion: { x: 0.2, y: 0.4, e: 0.1 } }, { t: 2, motion: { x: 0.9, y: 0.9, e: 0 } }, { t: 3, face: { x: 0.7, y: 0.3 }, motion: { x: 0.1, y: 0.1, e: 1 } }]);
  assert.deepEqual(tr.map((p) => [p.x, p.y]), [[0.5, 0.5], [0.2, 0.4], [0.2, 0.4], [0.7, 0.3]]);
  const sm = R.smoothTrack([{ t: 0, x: 0, y: 0 }, { t: 1, x: 1, y: 1 }, { t: 2, x: 0, y: 0 }], 2);
  near(sm[1].x, 1 / 3, 1e-12);
  // a straight glide is two keys, a still subject one, a wobble at most max
  const line = Array.from({ length: 50 }, (_, i) => ({ t: i / 10, x: 0.2 + i * 0.01, y: 0.5 }));
  assert.equal(R.simplifyTrack(line, 0.02).length, 2);
  assert.equal(R.simplifyTrack(line.map((p) => ({ t: p.t, x: 0.4, y: 0.5 })), 0.02).length, 1);
  const wob = Array.from({ length: 300 }, (_, i) => ({ t: i / 10, x: 0.5 + 0.3 * Math.sin(i), y: 0.5 }));
  assert.ok(R.simplifyTrack(wob, 0.001, 20).length <= 20);
  const ts = R.sampleTimes(2, 12);
  assert.equal(ts[0], 2); assert.equal(ts[ts.length - 1], 12); assert.equal(ts.length, 31);
  assert.equal(R.sampleTimes(0, 3600).length, 180);
});

test("noise removal: the stream keeps the timing (480-sample delay undone) and RNNoise cleans", () => {
  // a fake engine that, like RNNoise, answers each frame one frame late
  let prev = [new Float32Array(D.FRAME)];
  const fake = { frame: (ch, x) => { const out = prev[ch] || new Float32Array(D.FRAME); prev[ch] = Float32Array.from(x); return out; } };
  const st = new D.Stream(fake, 1), input = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i / 7));
  const parts = [];
  for (let i = 0; i < input.length; i += 777) parts.push(st.push([input.subarray(i, Math.min(input.length, i + 777))])[0]);
  parts.push(st.flush()[0]);
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  assert.equal(out.length, input.length);
  for (let i = 0; i < input.length; i++) near(out[i], input[i], 1e-6, "sample " + i);
  // the real wasm: no imports, noise goes down a lot, speech-like tone stays
  const wasm = fs.readFileSync(path.join(ROOT, "vendor/rnnoise/rnnoise.wasm"));
  const mod = new WebAssembly.Module(wasm);
  assert.deepEqual(WebAssembly.Module.imports(mod), []);
  assert.ok(fs.existsSync(path.join(ROOT, "vendor/rnnoise/LICENSE")));
  const eng = D.engine(mod), s2 = new D.Stream(eng, 2);
  let seed = 1;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return ((seed >>> 8) & 0xffff) / 32768 - 1; };
  const N = 48000 * 2, noise = Float32Array.from({ length: N }, () => rnd() * 0.08);
  const res = s2.push([noise, noise]);
  const tail = s2.flush();
  assert.equal(res[0].length + tail[0].length, N);
  const energy = (a, from) => { let e = 0; for (let i = from; i < a.length; i++) e += a[i] * a[i]; return e; };
  assert.ok(energy(res[0], 24000) < energy(noise, 24480) / 20, "noise at least 13 dB down");
});

test("app wiring: new scripts load, strings in both languages, licence for the vendored wasm", () => {
  const html = fs.readFileSync(path.join(ROOT, "montage/index.html"), "utf8");
  assert.match(html, /reframe\.js\?v=/); assert.match(html, /denoise\.js\?v=/); assert.match(html, /asr\.js\?v=/);
  const app = fs.readFileSync(path.join(ROOT, "montage/montage.js"), "utf8");
  for (const k of ["tool.chroma", "tool.reframe", "tool.denoise", "p.curve", "ramp.here", "p.corners", "set.reframe", "asr.go", "asr.need", "asr.forget"]) {
    assert.equal((app.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k + " in EN and EL");
  }
  assert.match(fs.readFileSync(path.join(ROOT, "vendor/rnnoise/LICENSE"), "utf8"), /Redistribution and use in source and binary forms/);
});

// ---------- Speech to text (Whisper) ----------
const ASR = require(path.join(ROOT, "montage/asr.js"));
const TS0 = ASR.TS0, EOT = ASR.EOT, V = 51865;
// GPT-2 byte-level token text for a string (what vocab.json holds)
function bpeText(str) {
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice(); let n = 0;
  for (let i = 0; i < 256; i++) if (bs.indexOf(i) < 0) { bs.push(i); cs.push(256 + n); n++; }
  const ch = {}; bs.forEach((b, k) => { ch[b] = String.fromCharCode(cs[k]); });
  return [...Buffer.from(str, "utf8")].map((b) => ch[b]).join("");
}

test("speech: mel filters match Whisper's own table, log-mel finds a tone, 48 → 16 kHz keeps speech", () => {
  const mf = ASR.melFilters(16000, 400, 80);
  assert.equal(mf.length, 80 * 201);
  // values from openai/whisper assets/mel_filters.npz (mel_80)
  const row = (r) => Array.from(mf.subarray(r * 201, r * 201 + 201));
  assert.ok(Math.abs(mf[1] - 0.024862595) < 1e-7);
  assert.ok(Math.abs(Math.max(...row(10)) - 0.019908218) < 1e-7);
  assert.equal(row(40).indexOf(Math.max(...row(40))), 43);
  assert.ok(Math.abs(row(79).reduce((a, b) => a + b, 0) - 0.02492534) < 1e-6);
  // a 1 kHz tone for 2 s, then silence: brightest band is the one around 1 kHz
  const x = new Float32Array(32000);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 16000);
  const m = ASR.logMel(x);
  assert.equal(m.length, 80 * 3000);
  const f = 100;                                            // a frame inside the tone
  let best = 0; for (let b = 1; b < 80; b++) if (m[b * 3000 + f] > m[best * 3000 + f]) best = b;
  const centre = row(best).indexOf(Math.max(...row(best))) * 40;   // Hz of the band's peak
  assert.ok(Math.abs(centre - 1000) <= 80, "band at " + centre + " Hz");
  let max = -Infinity; for (const v of m) max = Math.max(max, v);
  assert.ok(Math.abs(m[best * 3000 + 2500] - (max - 2)) < 1e-5, "silence sits on the floor (max - 8 + 4) / 4");
  // decimation: 1 kHz passes, 10 kHz (above the new Nyquist) is gone
  const tone = (hz) => { const y = new Float32Array(48000); for (let i = 0; i < y.length; i++) y[i] = Math.sin(2 * Math.PI * hz * i / 48000); return y; };
  const peak = (y) => { let p = 0; for (let i = 100; i < y.length - 100; i++) p = Math.max(p, Math.abs(y[i])); return p; };
  const lo = ASR.decimate3(tone(1000));
  assert.equal(lo.length, 16000);
  assert.ok(Math.abs(peak(lo) - 1) < 0.02);
  assert.ok(peak(ASR.decimate3(tone(10000))) < 0.01);
});

test("speech: Whisper's timestamp rules, segments and text", () => {
  const fresh = () => new Float32Array(V).fill(0);
  // a window starts with a stamp, and only the first ones
  let l = ASR.applyTimestampRules(fresh(), [], [], [220, EOT]);
  assert.ok(l[100] === -Infinity && l[EOT] === -Infinity && l[TS0] === 0 && l[TS0 + 1] === 0 && l[TS0 + 2] === -Infinity);
  // after text + one stamp: another stamp (not earlier) or the end
  l = new Float32Array(V).fill(-Infinity); l[100] = 0; l[EOT] = 2; l[TS0 + 49] = 0; l[TS0 + 50] = 0;
  ASR.applyTimestampRules(l, [TS0, 100, TS0 + 50], [], []);
  assert.ok(l[100] === -Infinity && l[EOT] === 2 && l[TS0 + 49] === -Infinity && l[TS0 + 50] === 0);
  // … and when the stamps outweigh everything else, the end is barred too
  l = ASR.applyTimestampRules(fresh(), [TS0, 100, TS0 + 50], [], []);
  assert.ok(l[100] === -Infinity && l[EOT] === -Infinity && l[TS0 + 50] === 0);
  // after a pair: text, never a stamp
  l = ASR.applyTimestampRules(fresh(), [TS0, 100, TS0 + 50, TS0 + 50], [], []);
  for (let i = TS0; i < V; i++) assert.equal(l[i], -Infinity);
  assert.equal(l[100], 0);
  // the stamps together outweigh the best text token: text is barred
  l = fresh(); l[100] = 3; for (let i = TS0 + 10; i < TS0 + 1500; i++) l[i] = 0;
  ASR.applyTimestampRules(l, [TS0, 100], [], []);
  assert.equal(l[100], -Infinity);
  // suppressed tokens and "no timestamps" never come
  l = ASR.applyTimestampRules(fresh(), [TS0, 100], [7, 9], []);
  assert.ok(l[7] === -Infinity && l[9] === -Infinity && l[50363] === -Infinity);

  // segments: two closed lines, the window used to the end
  let r = ASR.segmentsFrom([TS0, 1, 2, TS0 + 50, TS0 + 50, 3, TS0 + 100], 30);
  assert.deepEqual(r.segs, [{ t0: 0, t1: 1, ids: [1, 2] }, { t0: 1, t1: 2, ids: [3] }]);
  assert.equal(r.advance, 30);
  // the last line never closed: the next window starts where it began
  r = ASR.segmentsFrom([TS0, 1, TS0 + 150, TS0 + 150, 2, 3], 30);
  assert.deepEqual(r.segs, [{ t0: 0, t1: 3, ids: [1] }]);
  assert.equal(r.advance, 3);
  // no pair at all: one line over the window
  r = ASR.segmentsFrom([TS0, 1, 2], 12);
  assert.deepEqual(r.segs, [{ t0: 0, t1: 12, ids: [1, 2] }]);

  // text: byte-level BPE back to UTF-8, a Greek letter split over two tokens
  const g = bpeText(" Καλημέρα"), inv = [];
  inv[0] = g.slice(0, 2); inv[1] = g.slice(2); inv[2] = bpeText(", κόσμε!"); inv[3] = "<|en|>"; inv[4] = bpeText("é").slice(0, 1);
  assert.equal(ASR.decodeText([0, 1, 3, 2], inv), "Καλημέρα, κόσμε!");
  assert.equal(ASR.decodeText([0, 1, 4], inv), "Καλημέρα", "a letter cut at the end is dropped");
  const iv = ASR.invertVocab({ a: 0, b: 2 });
  assert.ok(iv[0] === "a" && iv[1] === undefined && iv[2] === "b" && iv.length === 3);

  // long lines split by words, time shared by length
  const parts = ASR.splitCue({ start: 10, end: 20, text: "aaaa bbbb cccc dddd" }, 9);
  assert.deepEqual(parts.map((p) => p.text), ["aaaa bbbb", "cccc dddd"]);
  assert.equal(parts[0].start, 10); assert.equal(parts[0].end, 15); assert.equal(parts[1].end, 20);
  assert.deepEqual(ASR.splitCue({ start: 0, end: 1, text: "short" }), [{ start: 0, end: 1, text: "short" }]);
});

test("speech: the decoding loop (language, cache, windows) with a scripted model", async () => {
  function Tensor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; }
  const vocab = { [bpeText(" Γεια")]: 100, [bpeText(" σου")]: 101 }, inv = ASR.invertVocab(vocab);
  const gen = { lang_to_id: { "<|en|>": 50259, "<|el|>": 50281 }, suppress_tokens: [], begin_suppress_tokens: [220, EOT] };
  const script = [TS0, 100, 101, TS0 + 50, EOT];
  const calls = [];
  const dec = {
    run: async (f) => {
      const ids = Array.from(f.input_ids.data, Number), n = ids.length, cache = f.use_cache_branch.data[0];
      const pastLen = f["past_key_values.0.decoder.key"].dims[2];
      calls.push({ ids, cache, past: pastLen });
      const logits = new Float32Array(n * V);
      const last = logits.subarray((n - 1) * V);
      if (n === 1 && ids[0] === 50258) last[50281] = 5;    // language detection: Greek
      else {
        const step = calls.filter((c) => c.cache).length;   // tokens sampled so far
        last[script[Math.min(step, script.length - 1)]] = 10;
      }
      const out = { logits: new Tensor("float32", logits, [1, n, V]) };
      for (let l = 0; l < 4; l++) for (const k of ["decoder.key", "decoder.value", "encoder.key", "encoder.value"]) {
        out["present." + l + "." + k] = new Tensor("float32", new Float32Array(0), [1, 6, k[0] === "d" ? pastLen + n : 1500, 64]);
      }
      return out;
    }
  };
  const enc = { run: async (f) => { assert.deepEqual(f.input_features.dims, [1, 80, 3000]); return { last_hidden_state: new Tensor("float32", new Float32Array(1), [1, 1500, 384]) }; } };
  const samples = new Float32Array(16000 * 4);
  for (let i = 0; i < 16000; i++) samples[i] = 0.2 * Math.sin(i / 3);
  const r = await ASR.transcribe({ ort: { Tensor }, enc, dec, vocabInv: inv, gen }, samples, { lang: "auto" });
  assert.equal(r.lang, "el");
  assert.deepEqual(r.cues, [{ start: 0, end: 1, text: "Γεια σου" }]);
  // prompt first without cache, then one token at a time on a growing cache
  assert.deepEqual(calls[1].ids, [50258, 50281, 50359]);
  assert.equal(calls[1].cache, false);
  assert.deepEqual(calls.slice(2).map((c) => [c.ids.length, c.cache, c.past]), [[1, true, 3], [1, true, 4], [1, true, 5], [1, true, 6]]);
  // a silent recording asks nothing of the model
  calls.length = 0;
  const quiet = await ASR.transcribe({ ort: { Tensor }, enc, dec, vocabInv: inv, gen }, new Float32Array(16000 * 40), { lang: "en" });
  assert.deepEqual(quiet.cues, []); assert.equal(calls.length, 0);
});
