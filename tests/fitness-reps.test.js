// Workouts: camera rep counting (fitness/reps-core.js) on made-up
// keypoint sequences: a body whose knee, elbow or shoulder angle
// moves along a curve, with noise, at 15 frames a second.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../fitness/reps-core.js");

const FPS = 15;
const rad = (d) => d * Math.PI / 180;

// A standing body, seen from the side, in 0..1 coordinates ([y, x, s]).
// knee: angle at the knee; elbow: at the elbow; shoulder: between
// the torso and the upper arm; arm: torso to the wrist (straight arm).
function body(o) {
  o = Object.assign({ knee: 175, elbow: 170, shoulder: 10, score: 0.9 }, o);
  const kp = Array.from({ length: 17 }, () => [0, 0, o.score]);
  const put = (i, y, x) => { kp[i] = [y, x, o.score]; };
  const hip = [0.55, 0.5], sh = [0.3, 0.5];
  put(0, 0.2, 0.5); put(1, 0.19, 0.49); put(2, 0.19, 0.51); put(3, 0.2, 0.48); put(4, 0.2, 0.52);
  // thigh straight down from the hip, shin turned by (180 - knee)
  const knee = [hip[0] + 0.2, hip[1]];
  const bend = rad(180 - o.knee);
  const ankle = [knee[0] + 0.2 * Math.cos(bend), knee[1] - 0.2 * Math.sin(bend)];
  // upper arm turned forward by the shoulder angle, forearm by (180 - elbow)
  const sa = rad(o.shoulder);
  const el = [sh[0] + 0.15 * Math.cos(sa), sh[1] + 0.15 * Math.sin(sa)];
  const fa = sa + rad(180 - o.elbow);
  const wr = [el[0] + 0.13 * Math.cos(fa), el[1] + 0.13 * Math.sin(fa)];
  [[5, sh], [6, sh], [11, hip], [12, hip], [13, knee], [14, knee], [15, ankle], [16, ankle], [7, el], [8, el], [9, wr], [10, wr]]
    .forEach(([i, p]) => put(i, p[0], p[1]));
  return kp;
}
// A plank: lying, body line bent by sag degrees at the hip.
function plank(sag, score) {
  const s = score == null ? 0.9 : score;
  const kp = Array.from({ length: 17 }, () => [0.5, 0.5, s]);
  const sh = [0.5, 0.2], hip = [0.5, 0.5];
  const a = rad(sag);
  const an = [hip[0] + 0.3 * Math.sin(a), hip[1] + 0.3 * Math.cos(a)];
  [[5, sh], [6, sh], [11, hip], [12, hip], [15, an], [16, an], [13, [(hip[0] + an[0]) / 2, (hip[1] + an[1]) / 2]], [14, [(hip[0] + an[0]) / 2, (hip[1] + an[1]) / 2]]]
    .forEach(([i, p]) => { kp[i] = [p[0], p[1], s]; });
  return kp;
}
// Deterministic noise.
function rng(seed) { let x = seed; return () => { x = (x * 16807) % 2147483647; return x / 2147483647 - 0.5; }; }
// reps up-and-down movements of key from top to bottom, period seconds
// each, then still seconds of rest; noise in degrees.
function run(counter, key, top, bottom, reps, opts) {
  opts = Object.assign({ period: 2, still: 0, noise: 3, t0: 0, seed: 7, extra: {} }, opts);
  const r = rng(opts.seed);
  let t = opts.t0, st;
  const n = Math.round(reps * opts.period * FPS);
  for (let i = 0; i <= n; i++, t += 1 / FPS) {
    const ph = (i / FPS) / opts.period;
    const v = top + (bottom - top) * (1 - Math.cos(2 * Math.PI * ph)) / 2 + r() * 2 * opts.noise;
    st = counter.feed(body(Object.assign({}, opts.extra, { [key]: v })), t);
  }
  for (let i = 0; i < opts.still * FPS; i++, t += 1 / FPS) st = counter.feed(body(Object.assign({}, opts.extra, { [key]: top + r() * 2 })), t);
  return { st, t };
}

test("angle: right, straight and folded", () => {
  assert.equal(Math.round(R.angle([0, 1], [0, 0], [1, 0])), 90);
  assert.equal(Math.round(R.angle([0, -1], [0, 0], [0, 1])), 180);
  assert.equal(Math.round(R.angle([1, 0], [0, 0], [1, 0.0001])), 0);
  assert.ok(isNaN(R.angle([0, 0], [0, 0], [1, 0])));
  assert.equal(Math.round(R.jointAngle(body({ knee: 120 }), "knee")), 120);
  assert.equal(Math.round(R.jointAngle(body({ elbow: 60 }), "elbow")), 60);
});

test("profiles: ready exercises, auto for others, holds only for planks", () => {
  assert.equal(R.profileFor("x-squat", "wr"), R.PROFILES.squat);
  assert.equal(R.profileFor("x-pushup", "r"), R.PROFILES.pushup);
  assert.deepEqual(R.profileFor("u-mine", "r"), { auto: true });
  assert.deepEqual(R.profileFor("x-calf", "wr"), { auto: true });
  assert.equal(R.profileFor("x-plank", "t"), R.PROFILES.hold);
  assert.equal(R.profileFor("x-rope", "t"), null);
  assert.equal(R.profileFor("x-run", "dt"), null);
  assert.deepEqual(R.profileFor("x-plank", "r"), { auto: true });
});

test("squats: full reps count, with no hint", () => {
  const c = R.Counter(R.profileFor("x-squat", "wr"));
  const { st } = run(c, "knee", 172, 85, 8);
  assert.equal(st.reps, 8);
  assert.equal(st.hint, null);
});

test("half squats and jitter never count", () => {
  let c = R.Counter(R.PROFILES.squat);
  assert.equal(run(c, "knee", 172, 135, 6).st.reps, 0);
  c = R.Counter(R.PROFILES.squat);
  assert.equal(run(c, "knee", 150, 150, 6, { noise: 9 }).st.reps, 0);
});

test("shallow squats count and say deeper", () => {
  const c = R.Counter(R.PROFILES.squat);
  const { st } = run(c, "knee", 172, 108, 5);
  assert.equal(st.reps, 5);
  assert.equal(st.hint, "deeper");
});

test("not coming back up says full", () => {
  const c = R.Counter(R.PROFILES.squat);
  const { st } = run(c, "knee", 158, 85, 5, { noise: 1, still: 1 });
  assert.equal(st.reps, 5);
  assert.equal(st.hint, "full");
});

test("curls (elbow) and fast shaking", () => {
  let c = R.Counter(R.profileFor("x-dbcurl", "wr"));
  assert.equal(run(c, "elbow", 165, 45, 10, { period: 1.6 }).st.reps, 10);
  // a swing faster than a rep can be (0.2 s) counts once at most per MIN_REP
  c = R.Counter(R.PROFILES.curl);
  assert.ok(run(c, "elbow", 165, 45, 10, { period: 0.2, noise: 0 }).st.reps <= 6);
});

test("lateral raises rest low (shoulder)", () => {
  const c = R.Counter(R.profileFor("x-latraise", "wr"));
  const { st } = run(c, "shoulder", 12, 88, 6, { extra: { elbow: 175 } });
  assert.equal(st.reps, 6);
});

test("auto: an exercise without a profile learns its joint and counts every rep", () => {
  const c = R.Counter(R.profileFor("u-mine", "r"));
  const { st } = run(c, "elbow", 170, 70, 7);
  assert.equal(st.calibrating, false);
  assert.equal(st.joint, "elbow");
  assert.equal(st.reps, 7);
});

test("auto: standing still never calibrates", () => {
  const c = R.Counter({ auto: true });
  const { st } = run(c, "knee", 170, 170, 4);
  assert.equal(st.calibrating, true);
  assert.equal(st.reps, 0);
});

test("idle: after the last rep, still for IDLE seconds", () => {
  const c = R.Counter(R.PROFILES.squat);
  let r = run(c, "knee", 172, 85, 3, { still: 2 });
  assert.equal(r.st.idle, false);
  r = run(c, "knee", 172, 172, 0, { still: R.IDLE + 1, t0: r.t, noise: 0 });
  assert.equal(r.st.reps, 3);
  assert.equal(r.st.idle, true);
  // no reps: never idle
  const c2 = R.Counter(R.PROFILES.squat);
  assert.equal(run(c2, "knee", 172, 172, 0, { still: 8 }).st.idle, false);
});

test("not seen: low scores count nothing", () => {
  const c = R.Counter(R.PROFILES.squat);
  let st, t = 0;
  for (let i = 0; i < 200; i++, t += 1 / FPS) st = c.feed(body({ knee: i % 30 < 15 ? 170 : 80, score: 0.1 }), t);
  assert.equal(st.seen, false);
  assert.equal(st.reps, 0);
});

test("plank: time only in a straight line, short dropouts forgiven", () => {
  const c = R.Counter(R.PROFILES.hold);
  let st, t = 0;
  for (let i = 0; i < 10 * FPS; i++, t += 1 / FPS) st = c.feed(plank(3), t);
  assert.ok(Math.abs(st.hold - 10) < 0.2, String(st.hold));
  for (let i = 0; i < 0.5 * FPS; i++, t += 1 / FPS) st = c.feed(plank(0, 0.05), t);   // lost for 0.5 s
  assert.ok(st.hold > 10.3);
  for (let i = 0; i < 3 * FPS; i++, t += 1 / FPS) st = c.feed(plank(40), t);        // hips sag
  const at = st.hold;
  assert.equal(st.hint, "line");
  for (let i = 0; i < 2 * FPS; i++, t += 1 / FPS) st = c.feed(plank(40), t);
  assert.equal(st.hold, at);
  for (let i = 0; i < R.IDLE * FPS + 2; i++, t += 1 / FPS) st = c.feed(plank(40), t);
  assert.equal(st.idle, true);
});

test("standing is not a plank", () => {
  const c = R.Counter(R.PROFILES.hold);
  let st, t = 0;
  for (let i = 0; i < 5 * FPS; i++, t += 1 / FPS) st = c.feed(body({}), t);
  assert.equal(st.hold, 0);
});

test("push-ups: sagging hips say line", () => {
  const c = R.Counter(R.PROFILES.pushup);
  let st, t = 0;
  // elbow from body(), body line from a sagging plank
  for (let i = 0; i < 3 * 2 * FPS; i++, t += 1 / FPS) {
    const e = 170 - 90 * (1 - Math.cos(2 * Math.PI * (i / FPS) / 2)) / 2;
    const kp = plank(35);
    const arm = body({ elbow: e });
    [5, 6, 7, 8, 9, 10].forEach((k) => { kp[k] = arm[k]; });
    st = c.feed(kp, t);
  }
  assert.equal(st.reps, 3);
  assert.equal(st.hint, "line");
});

test("letterbox and back", () => {
  const lb = R.letterbox(640, 480, 192);
  assert.deepEqual([lb.dw, lb.dh, lb.ox, lb.oy], [192, 144, 0, 24]);
  const p = R.toPicture([(24 + 240 * lb.scale) / 192, (320 * lb.scale) / 192, 0.8], lb, 192);
  assert.ok(Math.abs(p[0] - 240) < 1e-6 && Math.abs(p[1] - 320) < 1e-6 && p[2] === 0.8);
  const u = R.unpack(Float32Array.from({ length: 51 }, (_, i) => i));
  assert.equal(u.length, 17);
  assert.deepEqual(u[16], [48, 49, 50]);
});

test("camera.js: the model is checked by SHA-256 and its database goes in the factory reset", () => {
  const fs = require("fs"), path = require("path");
  const cam = fs.readFileSync(path.join(__dirname, "..", "fitness/camera.js"), "utf8");
  const shell = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");
  assert.match(cam, /url: "https:\/\/koulaxizis\.github\.io\/oros-models-vision\/movenet\/movenet-lightning\.onnx"/);
  assert.match(cam, /sha: "[0-9a-f]{64}"/);
  assert.match(cam, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(cam, /localService === true/);
  assert.match(shell, /"oros-fitness-ai"[^\]]*\]\.forEach/);
});
