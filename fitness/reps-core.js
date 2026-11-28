// ============================================================
// orOS Workouts — reps-core.js: count repetitions from body
// keypoints (v1.0.0). Pure: no DOM, no camera; fed with MoveNet's
// 17 keypoints per frame by fitness/camera.js, unit-tested in node.
//   - a rep is a joint angle (knee, elbow, shoulder, hip) going from
//     its rest side past a far threshold and back (hysteresis): a
//     half movement or jitter never counts, and a rep takes at
//     least MIN_REP seconds
//   - ready exercises have a profile; any other exercise learns its
//     joint and range from the first movements ("auto"), then
//     counts those movements too
//   - holds (plank, side plank): time in a straight body line
//   - form hints: not deep enough, not fully straightened, body
//     line sagging (keys, translated by the app)
//   - idle: reps counted and no movement for IDLE seconds, so the
//     app can finish the set and start the rest timer
// Keypoints: [y, x, score] in 0..1 of a square input (MoveNet).
// Exposes window.OrosFitnessReps (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var KP = { nose: 0, lEye: 1, rEye: 2, lEar: 3, rEar: 4, lSh: 5, rSh: 6, lEl: 7, rEl: 8,
             lWr: 9, rWr: 10, lHip: 11, rHip: 12, lKn: 13, rKn: 14, lAn: 15, rAn: 16 };
  // The bones drawn over the camera picture.
  var BONES = [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12],
               [11, 13], [13, 15], [12, 14], [14, 16], [0, 1], [0, 2], [1, 3], [2, 4]];
  var MIN_SCORE = 0.3;   // a keypoint below this is not seen
  var MIN_REP = 0.35;    // seconds: a faster swing is jitter
  var IDLE = 4;          // seconds without a rep or movement after the last rep
  var CALIB = 25;        // degrees an "auto" joint must move before it counts
  var GRACE = 0.8;       // seconds a hold may lose sight of the body

  // Joint angles, left and right: [a, b (the joint), c].
  var JOINTS = {
    knee:     [[11, 13, 15], [12, 14, 16]],
    elbow:    [[5, 7, 9], [6, 8, 10]],
    shoulder: [[11, 5, 7], [12, 6, 8]],
    arm:      [[11, 5, 9], [12, 6, 10]],      // hip–shoulder–wrist (jumping jacks)
    hip:      [[5, 11, 13], [6, 12, 14]],
    line:     [[5, 11, 15], [6, 12, 16]]      // shoulder–hip–ankle: the body line
  };

  // rest: the side a rep starts and ends on ("hi" = open angle).
  // lo / hi: the thresholds; deep: a rep whose far end stays above
  // (rest hi) or below (rest lo) this gets the "deeper" hint; full:
  // a rep that does not come back past this gets the "full" hint.
  var P = {
    squat:   { joint: "knee", rest: "hi", lo: 120, hi: 155, deep: 100, full: 160 },
    lunge:   { joint: "knee", rest: "hi", lo: 120, hi: 155, deep: 105, full: 160, pick: "min" },
    pushup:  { joint: "elbow", rest: "hi", lo: 110, hi: 150, deep: 95, full: 155, line: 150 },
    dip:     { joint: "elbow", rest: "hi", lo: 110, hi: 150, deep: 95, full: 155 },
    press:   { joint: "elbow", rest: "lo", lo: 100, hi: 150, deep: 95, full: 160 },
    pull:    { joint: "elbow", rest: "hi", lo: 85, hi: 145, deep: 75, full: 150 },
    curl:    { joint: "elbow", rest: "hi", lo: 75, hi: 135, deep: 60, full: 145 },
    raise:   { joint: "shoulder", rest: "lo", lo: 35, hi: 70, deep: 80, full: 25 },
    jacks:   { joint: "arm", rest: "lo", lo: 50, hi: 120, deep: 140, full: 40, pick: "max" },
    hinge:   { joint: "hip", rest: "hi", lo: 120, hi: 160, deep: 100, full: 165 },
    bridge:  { joint: "hip", rest: "lo", lo: 140, hi: 162, deep: 170, full: 135 },
    situp:   { joint: "hip", rest: "hi", lo: 80, hi: 110, deep: 70, full: 115 },
    legraise:{ joint: "hip", rest: "hi", lo: 120, hi: 155, deep: 100, full: 160 },
    hold:    { hold: true, line: 155 }
  };
  // Ready exercises (fitness.js SEED) → profile. Others count "auto".
  var BY_EX = {
    "x-squat": "squat", "x-frontsquat": "squat", "x-goblet": "squat",
    "x-lunge": "lunge", "x-bulgarian": "lunge",
    "x-pushup": "pushup", "x-dips": "dip",
    "x-ohp": "press", "x-dbshoulder": "press",
    "x-pullup": "pull", "x-chinup": "pull",
    "x-curl": "curl", "x-dbcurl": "curl", "x-hammer": "curl",
    "x-latraise": "raise", "x-jacks": "jacks",
    "x-deadlift": "hinge", "x-rdl": "hinge", "x-kbswing": "hinge", "x-backext": "hinge",
    "x-hipthrust": "bridge", "x-bridge": "bridge",
    "x-situp": "situp", "x-crunch": "situp", "x-legraise": "legraise",
    "x-plank": "hold", "x-sideplank": "hold"
  };
  // Holds are only these two; other timed exercises have no camera.
  function profileFor(exId, kind) {
    var k = BY_EX[exId];
    if (kind === "t") return k === "hold" ? P.hold : null;
    if (kind !== "r" && kind !== "wr") return null;
    return k && k !== "hold" ? P[k] : { auto: true };
  }

  // ---------- Geometry ----------
  function seen(kp, i) { return kp[i] && kp[i][2] >= MIN_SCORE; }
  // The angle at b, in degrees (0..180); y and x in the same scale.
  function angle(a, b, c) {
    var v1y = a[0] - b[0], v1x = a[1] - b[1], v2y = c[0] - b[0], v2x = c[1] - b[1];
    var n = Math.hypot(v1y, v1x) * Math.hypot(v2y, v2x);
    if (!(n > 1e-9)) return NaN;
    var cos = (v1y * v2y + v1x * v2x) / n;
    return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  }
  // One joint's angle from the side that is seen best, or both sides
  // reduced by pick ("min" / "max"); NaN when neither side is seen.
  function jointAngle(kp, joint, pick) {
    var best = NaN, bestScore = -1, vals = [];
    JOINTS[joint].forEach(function (t) {
      if (!seen(kp, t[0]) || !seen(kp, t[1]) || !seen(kp, t[2])) return;
      var a = angle(kp[t[0]], kp[t[1]], kp[t[2]]);
      if (isNaN(a)) return;
      vals.push(a);
      var sc = Math.min(kp[t[0]][2], kp[t[1]][2], kp[t[2]][2]);
      if (sc > bestScore) { bestScore = sc; best = a; }
    });
    if (!vals.length) return NaN;
    if (pick === "min") return Math.min.apply(null, vals);
    if (pick === "max") return Math.max.apply(null, vals);
    return best;
  }
  // Holds: the body line is straight and the body lies, not stands.
  function holdOk(kp, minLine) {
    var line = jointAngle(kp, "line");
    if (isNaN(line)) return { seen: false, ok: false, line: NaN };
    var sh = seen(kp, 5) ? kp[5] : kp[6], an = seen(kp, 15) ? kp[15] : kp[16];
    var lying = Math.abs(sh[0] - an[0]) < Math.abs(sh[1] - an[1]);
    return { seen: true, ok: line >= minLine && lying, line: line, lying: lying };
  }

  // ---------- The counter ----------
  // profile from profileFor. feed(kp, t seconds) → state:
  // { reps, hold (seconds), phase, angle, seen, calibrating, hint,
  //   newRep (this frame), idle, joint }
  function Counter(profile) {
    var pr = profile || { auto: true };
    var s = {
      reps: 0, hold: 0, phase: null, angle: NaN, seen: false, hint: null, idle: false,
      calibrating: !!pr.auto, joint: pr.joint || null
    };
    var cfg = pr.auto ? null : pr;
    var sm = NaN, lastT = null, phaseT = 0, extreme = NaN, lastRepT = null, lastMoveT = null;
    var moveRef = NaN, autoAng = {}, holdLast = null, lastLine = NaN;

    function smooth(a) { sm = isNaN(sm) ? a : sm + 0.5 * (a - sm); return sm; }
    function far(a) { return cfg.rest === "hi" ? a < cfg.lo : a > cfg.hi; }
    function back(a) { return cfg.rest === "hi" ? a > cfg.hi : a < cfg.lo; }
    // restPeak: how far back toward rest the joint came since the
    // last rep; a rep that starts without coming back past "full"
    // gets the "full" hint.
    var restPeak = NaN, notFull = false;
    function step(a, t) {
      if (s.phase === null) { s.phase = far(a) ? "far" : "rest"; phaseT = t; extreme = a; restPeak = a; return; }
      if (s.phase === "rest") {
        restPeak = cfg.rest === "hi" ? Math.max(restPeak, a) : Math.min(restPeak, a);
        if (far(a)) {
          notFull = s.reps > 0 && cfg.full != null && (cfg.rest === "hi" ? restPeak < cfg.full : restPeak > cfg.full);
          if (notFull) s.hint = "full";
          s.phase = "far"; phaseT = t; extreme = a;
        }
      } else {
        extreme = cfg.rest === "hi" ? Math.min(extreme, a) : Math.max(extreme, a);
        if (back(a)) {
          if (t - phaseT >= MIN_REP / 2 && (lastRepT === null || t - lastRepT >= MIN_REP)) {
            s.reps++;
            lastRepT = t;
            s.hint = repHint(extreme) || (notFull ? "full" : null);
            s.newRep = true;
          }
          s.phase = "rest"; phaseT = t; restPeak = a;
        }
      }
    }
    function repHint(ext) {
      if (cfg.deep == null) return null;
      if (cfg.rest === "hi" ? ext > cfg.deep : ext < cfg.deep) return "deeper";
      return null;
    }
    // "auto": the joint that moved most; thresholds a third in from
    // both ends of its range; then the buffered frames are replayed.
    function calibrate() {
      var bestJ = null, bestR = 0;
      Object.keys(autoAng).forEach(function (j) {
        var v = autoAng[j].filter(function (x) { return !isNaN(x.a); });
        if (v.length < 5) return;
        var lo = Infinity, hi = -Infinity;
        v.forEach(function (x) { if (x.a < lo) lo = x.a; if (x.a > hi) hi = x.a; });
        if (hi - lo > bestR) { bestR = hi - lo; bestJ = j; }
      });
      if (!bestJ || bestR < CALIB) return false;
      var v = autoAng[bestJ].filter(function (x) { return !isNaN(x.a); });
      var lo = Infinity, hi = -Infinity;
      v.forEach(function (x) { if (x.a < lo) lo = x.a; if (x.a > hi) hi = x.a; });
      var r = hi - lo, first = v[0].a;
      cfg = { joint: bestJ, rest: first - lo > hi - first ? "hi" : "lo", lo: lo + r / 3, hi: hi - r / 3 };
      s.joint = bestJ;
      s.calibrating = false;
      sm = NaN;
      v.forEach(function (x) { step(smooth(x.a), x.t); });
      s.newRep = s.reps > 0;
      return true;
    }

    function feed(kp, t) {
      s.newRep = false;
      if (pr.hold) return feedHold(kp, t);
      if (cfg && cfg.line) lastLine = jointAngle(kp, "line");
      if (!cfg) {
        // collect every joint until one has moved enough
        var any = false;
        ["knee", "elbow", "shoulder", "hip", "arm"].forEach(function (j) {
          var a = jointAngle(kp, j);
          if (!isNaN(a)) any = true;
          (autoAng[j] = autoAng[j] || []).push({ a: a, t: t });
          if (autoAng[j].length > 400) autoAng[j].shift();
        });
        s.seen = any;
        if (any && lastMoveT === null) lastMoveT = t;
        calibrate(t);
        if (cfg) s.idle = idleAt(t);
        lastT = t;
        return s;
      }
      var raw = jointAngle(kp, cfg.joint, cfg.pick);
      s.seen = !isNaN(raw);
      if (!s.seen) { s.idle = idleAt(t); lastT = t; return s; }
      var a = smooth(raw);
      s.angle = a;
      if (isNaN(moveRef) || Math.abs(a - moveRef) > 12) { moveRef = a; lastMoveT = t; }
      step(a, t);
      if (cfg.line && !isNaN(lastLine) && lastLine < cfg.line) s.hint = "line";
      s.idle = idleAt(t);
      lastT = t;
      return s;
    }
    function idleAt(t) {
      if (!s.reps) return false;
      var since = Math.max(lastRepT || 0, lastMoveT || 0);
      return t - since >= IDLE;
    }
    function feedHold(kp, t) {
      var h = holdOk(kp, pr.line);
      s.seen = h.seen;
      s.angle = h.line;
      var dt = lastT === null ? 0 : Math.min(0.5, Math.max(0, t - lastT));
      if (h.ok) { s.hold += dt; holdLast = t; s.phase = "hold"; s.hint = null; }
      else if (holdLast !== null && t - holdLast <= GRACE && s.phase === "hold") s.hold += dt;
      else {
        s.phase = s.hold > 0 ? "off" : null;
        s.hint = h.seen && h.lying && !h.ok ? "line" : null;
      }
      s.idle = s.hold >= 1 && holdLast !== null && t - holdLast >= IDLE;
      lastT = t;
      return s;
    }
    return { feed: feed, state: s };
  }

  // Square letterbox of a w × h frame into side × side: the scale and
  // offsets, so keypoints map back to the picture.
  function letterbox(w, h, side) {
    var sc = side / Math.max(w, h);
    return { scale: sc, dw: Math.round(w * sc), dh: Math.round(h * sc),
             ox: Math.round((side - w * sc) / 2), oy: Math.round((side - h * sc) / 2) };
  }
  // A keypoint [y, x, s] in 0..1 of the square → picture pixels.
  function toPicture(k, lb, side) {
    return [(k[0] * side - lb.oy) / lb.scale, (k[1] * side - lb.ox) / lb.scale, k[2]];
  }
  // MoveNet's output (Float32Array 51) → 17 × [y, x, s].
  function unpack(arr) {
    var out = [];
    for (var i = 0; i < 17; i++) out.push([arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]]);
    return out;
  }

  var api = { KP: KP, BONES: BONES, JOINTS: JOINTS, PROFILES: P, BY_EX: BY_EX, MIN_SCORE: MIN_SCORE, IDLE: IDLE,
              profileFor: profileFor, angle: angle, jointAngle: jointAngle, holdOk: holdOk,
              Counter: Counter, letterbox: letterbox, toPicture: toPicture, unpack: unpack };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosFitnessReps = api;
})(typeof self !== "undefined" ? self : this);
