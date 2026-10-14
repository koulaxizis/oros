// ============================================================
// orOS Montage — pure core (no DOM): projects, the timeline, the
// merge for sync, and what is on screen and heard at a given time.
//
//   Data    { ver, projects: { <pid>: project }, tombs: { <pid>: ms } }
//   project { id, name, ar, fps, bg, vs, m, items: { <iid>: item },
//             tombs: { <iid>: ms } }
//           ar  "16:9" | "9:16" | "1:1" | "4:5"; fps 30 | 60;
//           bg  "#rrggbb" behind everything; vs = sync this project's
//           media through Vault Drive (off by default, device only);
//           m   mtime of the project's own fields (name … vs).
//   item    { id, k, tr, m, … } one clip on one track
//           k   "video" | "image" | "audio" | "title"
//           tr  "main" (magnetic: clips follow each other, no gaps),
//               "ov" (overlay: picture in picture), "tt" (titles),
//               "a1" / "a2" (sound: music, voice)
//           main clips have an order `o`; the others a start `at`
//           (seconds on the timeline). Optional (only when in use):
//           sr speed curve, ck chroma key, bd border / corners,
//           fc reframe focus keys, na cleaned sound (see normItem).
//   Media are files on the orOS disk, /internal/Assets/<sha256>.<ext>
//   (the same folder and ids as Atelier's clips.js); a project keeps
//   only the ids, never the media.
//
// Merge (R5, R17, R26, R27): projects and items are separate entities,
// each last-writer-wins by its own m; tombstones max-union; a newer
// edit beats an older tombstone. Output is canonical (keys sorted,
// every item normalized), so merge(merge(a)) === merge(a).
//
// UMD: module.exports in Node, window.MontageCore in the browser.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var MIN = 0.1;                       // shortest clip, seconds
  var MAX_DUR = 4 * 3600;              // longest clip or still, seconds
  var MAX_ITEMS = 2000;                // per project
  var ID_RE = /^[a-z0-9]{1,40}$/;
  // The same id forms Atelier's clips.js and designkit/assets.js use,
  // so Atelier's "unused files" check sees Montage's media as in use.
  var PIC_RE = /^[0-9a-f]{64}\.(jpg|png)$/;
  var VIDEO_RE = /^[0-9a-f]{64}\.(webm|mp4)$/;
  var SOUND_RE = /^[0-9a-f]{64}\.(mp3|m4a|ogg|wav|weba)$/;
  var COLOR_RE = /^#[0-9a-f]{6}$/;

  var KINDS = ["video", "image", "audio", "title", "shape"];
  var TRACKS = ["main", "ov", "tt", "a1", "a2"];
  var TRACK_KINDS = { main: ["video", "image", "title"], ov: ["video", "image", "shape"], tt: ["title"], a1: ["audio"], a2: ["audio"] };
  var RATIOS = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5] };
  var FPS = [30, 60];
  var TRANSITIONS = ["fade", "black", "slide", "wipe", "push", "zoom", "circle"];
  var FILTERS = ["none", "mono", "sepia", "warm", "cool", "vivid", "fade", "noir", "film", "vintage", "chrome", "dusk", "golden"];
  var ANIMS = ["none", "fade", "rise", "pop"];
  var ALIGNS = ["l", "c", "r"];
  var SHAPES = ["rect", "round", "ellipse", "triangle", "star", "heart", "arrow", "bubble"];

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isInt(v) { return isNum(v) && Math.floor(v) === v; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, d, lo, hi) { return isNum(v) ? clamp(v, lo, hi) : d; }
  function r3(v) { return Math.round(v * 1000) / 1000; }        // ms precision: stable JSON
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
  function stamp(v) { return isInt(v) && v >= 0 ? v : 0; }

  function isPicture(id) { return typeof id === "string" && PIC_RE.test(id); }
  function isVideo(id) { return typeof id === "string" && VIDEO_RE.test(id); }
  function isSound(id) { return typeof id === "string" && SOUND_RE.test(id); }
  function isId(id) { return typeof id === "string" && ID_RE.test(id); }

  // ---------- Normalizers (strict: invalid rows are dropped) ----------
  function normLook(v) {
    var o = obj(v) || {};
    return {
      b: Math.round(num(o.b, 0, -100, 100)), c: Math.round(num(o.c, 0, -100, 100)),
      s: Math.round(num(o.s, 0, -100, 100)), t: Math.round(num(o.t, 0, -100, 100))
    };
  }
  function normBox(v, d) {
    var o = obj(v) || d;
    var w = r3(num(o.w, d.w, 0.02, 4)), h = r3(num(o.h, d.h, 0.02, 4));
    return { x: r3(num(o.x, d.x, -2, 2)), y: r3(num(o.y, d.y, -2, 2)), w: w, h: h };
  }
  function normText(v) {
    var o = obj(v) || {};
    var t = str(o.t, 500).replace(/\r\n?/g, "\n");
    return {
      t: t, f: str(o.f, 40).replace(/[^a-z0-9-]/gi, "") || "sans",
      sz: r3(num(o.sz, 8, 2, 40)),
      col: COLOR_RE.test(o.col) ? o.col : "#ffffff",
      ol: COLOR_RE.test(o.ol) ? o.ol : "",
      bx: COLOR_RE.test(o.bx) ? o.bx : "",
      al: oneOf(o.al, ALIGNS, "c"), an: oneOf(o.an, ANIMS, "none")
    };
  }
  var BOX_OV = { x: 0.6, y: 0.06, w: 0.34, h: 0.34 };
  // A shape: kind, fill colour ("" = none), outline colour ("" = none),
  // outline width 0-20 (% of the shape's shorter side).
  function normShape(v) {
    var o = obj(v) || {};
    var col = o.col === "" ? "" : (COLOR_RE.test(o.col) ? o.col : "#f8d14a");
    var ol = COLOR_RE.test(o.ol) ? o.ol : "";
    var ow = Math.round(num(o.ow, 0, 0, 20));
    if (!col && (!ol || !ow)) { ol = ol || "#ffffff"; ow = ow || 4; }        // never invisible
    return { k: oneOf(o.k, SHAPES, "rect"), col: col, ol: ol, ow: ow };
  }
  var BOX_TT = { x: 0.05, y: 0.72, w: 0.9, h: 0.2 };

  function normItem(v, id) {
    var o = obj(v);
    if (!o || !isId(id) || o.id !== id) return null;
    var k = oneOf(o.k, KINDS, ""), tr = oneOf(o.tr, TRACKS, "");
    if (!k || !tr || TRACK_KINDS[tr].indexOf(k) < 0) return null;
    var it = { id: id, k: k, tr: tr, m: stamp(o.m) };
    if (k === "video" || k === "audio") {
      if (k === "video" ? !isVideo(o.src) : !(isSound(o.src) || isVideo(o.src))) return null;
      it.src = o.src;
      var len = num(o.len, 0, 0, MAX_DUR);
      var inn = num(o["in"], 0, 0, MAX_DUR);
      var out = num(o.out, 0, 0, MAX_DUR);
      if (len > 0) { out = Math.min(out, len); inn = Math.min(inn, Math.max(0, len - MIN)); }
      if (!(out - inn >= MIN - 1e-9)) return null;
      it.len = r3(len); it["in"] = r3(inn); it.out = r3(out);
      it.sp = r3(num(o.sp, 1, 0.25, 4));
      it.vol = Math.round(num(o.vol, 100, 0, 200));
      it.mu = o.mu === true;
      if (k === "video" && o.rv === true) it.rv = true;   // plays backwards, without sound
    } else {
      if (k === "image" && !isPicture(o.src)) return null;
      if (k === "image") it.src = o.src;
      it.d = r3(num(o.d, k === "title" ? 3 : 4, MIN, MAX_DUR));
    }
    if (tr === "main") it.o = isNum(o.o) ? o.o : 0;
    else it.at = r3(num(o.at, 0, 0, MAX_DUR * 4));
    it.fi = r3(num(o.fi, 0, 0, 10));
    it.fo = r3(num(o.fo, 0, 0, 10));
    if (k !== "audio") {
      it.op = Math.round(num(o.op, 100, 0, 100));
      if (k === "video" || k === "image") {
        it.fit = oneOf(o.fit, ["fit", "fill"], "fit");
        it.rot = oneOf(o.rot, [0, 90, 180, 270], 0);
        it.fl = o.fl === true;
        it.lk = normLook(o.lk);
        it.flt = oneOf(o.flt, FILTERS, "none");
        if (isPicture(o.lut)) it.lut = o.lut;       // a colour look (.cube) stored as a picture
      }
      if (tr !== "main") it.box = normBox(o.box, tr === "tt" ? BOX_TT : BOX_OV);
      if (k === "shape") it.sh = normShape(o.sh);
      if (k === "title") {
        it.text = normText(o.text);
        if (tr === "main") it.bg = COLOR_RE.test(o.bg) ? o.bg : "#000000";
      }
    }
    if (tr === "main") {
      var tx = obj(o.tx);
      it.tx = tx && TRANSITIONS.indexOf(tx.k) >= 0 ? { k: tx.k, d: r3(num(tx.d, 0.5, 0.1, 2)) } : null;
    }
    var kf = normKf(o.kf, it);
    if (kf.length) it.kf = kf;                  // written only when the clip has keys
    // Wave 41 fields, each written only when in use (absent = off), so
    // a project without them is byte-identical on copies that predate them.
    if (k === "video" || k === "audio") {
      var sr = normSr(o.sr);
      if (sr.length >= 2) it.sr = sr;           // speed curve (ramp)
      if (isSound(o.na)) it.na = o.na;          // the clip's sound with the noise removed
    }
    if (k === "video" || k === "image") {
      var ck = normCk(o.ck);
      if (ck) it.ck = ck;                       // chroma key
      var bd = normBd(o.bd);
      if (bd) it.bd = bd;                       // border + rounded corners
      var fc = normFc(o.fc);
      if (fc.length) it.fc = fc;                // reframe: the point kept in view
    }
    return it;
  }

  // ---------- Speed curve (ramp) ----------
  // sr = [{ s, v }] sorted by s: s seconds into the FILE, v speed
  // 0.1-10. Between keys the speed changes evenly along the file, before
  // the first and after the last it holds. Because the keys sit on the
  // file (not on the clip), a split or a trim keeps every frame's speed:
  // both halves read the same curve. While a clip has a curve its `sp`
  // is not used (it comes back when the curve is removed).
  var MAX_SR = 20, SR_MIN = 0.1, SR_MAX = 10;
  function normSr(v) {
    if (!Array.isArray(v)) return [];
    var byS = {};
    v.slice(0, MAX_SR * 2).forEach(function (raw) {
      var o = obj(raw);
      if (!o || !isNum(o.s) || !isNum(o.v)) return;
      var s = r3(clamp(o.s, 0, MAX_DUR));
      byS[s] = { s: s, v: r3(clamp(o.v, SR_MIN, SR_MAX)) };
    });
    return Object.keys(byS).map(function (k) { return byS[k]; })
      .sort(function (a, b) { return a.s - b.s; }).slice(0, MAX_SR);
  }
  // Speed of a curve at file second s.
  function srAt(keys, s) {
    var a = keys[0], b = keys[keys.length - 1];
    if (s <= a.s) return a.v;
    if (s >= b.s) return b.v;
    for (var i = 1; i < keys.length; i++) if (keys[i].s >= s) { a = keys[i - 1]; b = keys[i]; break; }
    return b.s > a.s ? a.v + (b.v - a.v) * (s - a.s) / (b.s - a.s) : a.v;
  }
  // Timeline seconds to read the file from s0 to s1 while the speed
  // changes evenly from v0 to v1: ∫ ds / v(s).
  function spanTime(s0, s1, v0, v1) {
    var L = s1 - s0;
    if (!(L > 0)) return 0;
    if (Math.abs(v1 - v0) < 1e-9) return L / v0;
    return L * Math.log(v1 / v0) / (v1 - v0);
  }
  // The clip's [in, out] cut into pieces of even change: [{ s0, s1, v0,
  // v1, t0, t1 }] (t = seconds into the clip, reading forwards).
  var rampCache = typeof WeakMap === "function" ? new WeakMap() : null;
  function rampSegs(it) {
    if (rampCache && rampCache.has(it)) return rampCache.get(it);
    var keys = it.sr, pts = [it["in"]];
    keys.forEach(function (k) { if (k.s > it["in"] + 1e-6 && k.s < it.out - 1e-6) pts.push(k.s); });
    pts.push(it.out);
    var out = [], t = 0;
    for (var i = 0; i + 1 < pts.length; i++) {
      var s0 = pts[i], s1 = pts[i + 1], v0 = srAt(keys, s0), v1 = srAt(keys, s1), d = spanTime(s0, s1, v0, v1);
      out.push({ s0: s0, s1: s1, v0: v0, v1: v1, t0: t, t1: t + d });
      t += d;
    }
    if (rampCache) rampCache.set(it, out);
    return out;
  }
  function hasRamp(it) { return !!(it && it.sr && it.sr.length >= 2); }
  // Seconds into the file reached `local` seconds into the clip, reading
  // forwards from the in point (outside the clip: at the edge speed).
  function fwdPos(it, local) {
    if (!hasRamp(it)) return it["in"] + local * it.sp;
    var segs = rampSegs(it), last = segs[segs.length - 1];
    if (local <= 0) return it["in"] + local * segs[0].v0;
    if (local >= last.t1) return it.out + (local - last.t1) * last.v1;
    for (var i = 0; i < segs.length; i++) {
      var g = segs[i];
      if (local > g.t1 && i < segs.length - 1) continue;
      var dt = local - g.t0, k = (g.v1 - g.v0) / (g.s1 - g.s0);
      var s = Math.abs(k) < 1e-9 ? g.s0 + g.v0 * dt : g.s0 + g.v0 / k * (Math.exp(k * dt) - 1);
      return clamp(s, g.s0, g.s1);
    }
    return it.out;
  }
  // The other way: seconds into the clip (reading forwards) where the
  // file reaches second s.
  function fwdLocal(it, s) {
    if (!hasRamp(it)) return (s - it["in"]) / it.sp;
    var segs = rampSegs(it), last = segs[segs.length - 1];
    if (s <= it["in"]) return (s - it["in"]) / segs[0].v0;
    if (s >= it.out) return last.t1 + (s - it.out) / last.v1;
    for (var i = 0; i < segs.length; i++) {
      var g = segs[i];
      if (s > g.s1) continue;
      return g.t0 + spanTime(g.s0, s, g.v0, g.v0 + (g.v1 - g.v0) * (s - g.s0) / (g.s1 - g.s0));
    }
    return last.t1;
  }
  // Speed `local` seconds into the clip (the playback rate there).
  function rateAt(it, local) {
    if (!hasRamp(it)) return it.sp;
    var d = itemDur(it);
    return srAt(it.sr, fwdPos(it, it.rv ? d - local : local));
  }
  // A curve from a preset (CapCut-style names) over the clip's in…out:
  // [u (0..1 of the clip), speed] pairs.
  var RAMPS = {
    hero: [[0, 1], [0.35, 1], [0.5, 0.25], [0.65, 1], [1, 1]],
    bullet: [[0, 2.5], [0.4, 0.2], [0.6, 0.2], [1, 2.5]],
    montage: [[0, 1.5], [0.25, 0.5], [0.5, 2.5], [0.75, 0.5], [1, 1.5]],
    jump: [[0, 0.6], [0.42, 0.6], [0.5, 4], [0.58, 0.6], [1, 0.6]],
    flashin: [[0, 4], [0.3, 1], [1, 1]],
    flashout: [[0, 1], [0.7, 1], [1, 4]]
  };
  function rampPreset(it, name) {
    var r = RAMPS[name];
    if (!r || !(it.out > it["in"])) return [];
    return normSr(r.map(function (p) { return { s: it["in"] + (it.out - it["in"]) * p[0], v: p[1] }; }));
  }
  // The curve after setting speed v at file second s: a key within
  // `near` seconds of s moves there, else a new key goes in.
  function srSet(it, s, v, near) {
    var keys = (it.sr || []).slice(), lim = near > 0 ? near : 1e-3, hit = -1;
    keys.forEach(function (k, i) { if (Math.abs(k.s - s) <= lim && (hit < 0 || Math.abs(k.s - s) < Math.abs(keys[hit].s - s))) hit = i; });
    if (hit >= 0) keys[hit] = { s: s, v: v }; else keys.push({ s: s, v: v });
    if (keys.length < 2) keys.push({ s: s === it["in"] ? it.out : it["in"], v: v });
    return normSr(keys);
  }
  // Pieces of a sound segment between a and b seconds into it, each
  // short enough (`step`) to play at one rate: [{ t0, t1, s0, s1 }]
  // (s = file seconds). Without a curve: one piece.
  function srcPieces(seg, a, b, step) {
    if (!(b > a)) return [];
    if (!hasRamp(seg)) return [{ t0: a, t1: b, s0: seg["in"] + a * seg.sp, s1: seg["in"] + b * seg.sp }];
    var n = Math.max(1, Math.ceil((b - a) / (step || 0.05))), out = [], prev = fwdPos(seg, a);
    for (var i = 1; i <= n; i++) {
      var t1 = a + (b - a) * i / n, s1 = fwdPos(seg, t1);
      out.push({ t0: a + (b - a) * (i - 1) / n, t1: t1, s0: prev, s1: s1 });
      prev = s1;
    }
    return out;
  }
  // New in or out point when an edge of a clip is dragged by dt
  // timeline seconds (left edge: + shortens; right edge: + lengthens).
  function trimSrc(it, edge, dt) {
    var d = itemDur(it);
    if (edge === "l") return dt >= 0 ? fwdPos(it, Math.min(dt, d)) : it["in"] + dt * rateAt(it, 0);
    return dt <= 0 ? fwdPos(it, Math.max(0, d + dt)) : it.out + dt * (hasRamp(it) ? srAt(it.sr, it.out) : it.sp);
  }

  // ---------- Chroma key, border, reframe ----------
  // ck = { col, tol, soft, sp }: pixels near the colour col become
  // transparent; tol (0-100) how near, soft (0-100) the soft edge, sp
  // (0-100) how much of the colour's spill is taken off what stays.
  function normCk(v) {
    var o = obj(v);
    if (!o) return null;
    return {
      col: COLOR_RE.test(o.col) ? o.col : "#00b140",
      tol: Math.round(num(o.tol, 40, 0, 100)), soft: Math.round(num(o.soft, 25, 0, 100)), sp: Math.round(num(o.sp, 50, 0, 100))
    };
  }
  // The key's numbers as the compositor uses them (fractions of the
  // CbCr plane): similarity, smoothness, spill.
  function ckParams(ck) {
    return { sim: ck.tol / 100 * 0.3, sm: Math.max(0.001, ck.soft / 100 * 0.2), sp: Math.max(0.001, ck.sp / 100 * 0.3) };
  }
  function cbcr(r, g, b) { return [-0.1687 * r - 0.3313 * g + 0.5 * b, 0.5 * r - 0.4187 * g - 0.0813 * b]; }
  function hex3(h) { var n = parseInt(String(h).slice(1), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  // What the key does to one pixel (rgb 0..1): { a (alpha 0..1), rgb }.
  // MontageGL's shader computes the same.
  function chromaKey(rgb, ck) {
    var q = ckParams(ck), k = hex3(ck.col), a = cbcr(rgb[0], rgb[1], rgb[2]), b = cbcr(k[0], k[1], k[2]);
    var base = Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])) - q.sim;
    var alpha = Math.pow(clamp(base / q.sm, 0, 1), 1.5), spill = Math.pow(clamp(base / q.sp, 0, 1), 1.5);
    var l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return { a: alpha, rgb: rgb.map(function (c) { return l + (c - l) * spill; }) };
  }
  // bd = { w, col, r }: border width (0-10, % of the frame's shorter
  // side), its colour, corner radius (0-50, % of the picture's shorter
  // side: 50 = a circle on a square).
  function normBd(v) {
    var o = obj(v);
    if (!o) return null;
    var w = r3(num(o.w, 0, 0, 10)), r = Math.round(num(o.r, 0, 0, 50));
    if (!(w > 0) && !(r > 0)) return null;
    return { w: w, col: COLOR_RE.test(o.col) ? o.col : "#ffffff", r: r };
  }
  // fc = [{ t, x, y }]: the point of the picture (x, y 0..1 of the file's
  // own frame, before rotate and mirror) kept in the middle when the
  // picture is cropped to fill its box. t = seconds into the file
  // (video) or into the clip (picture), so splits and speed changes keep
  // it. Even pace between keys, held outside.
  var MAX_FC = 60;
  function normFc(v) {
    if (!Array.isArray(v)) return [];
    var byT = {};
    v.slice(0, MAX_FC * 2).forEach(function (raw) {
      var o = obj(raw);
      if (!o || !isNum(o.t) || !isNum(o.x) || !isNum(o.y)) return;
      var t = r3(clamp(o.t, 0, MAX_DUR));
      byT[t] = { t: t, x: r3(clamp(o.x, 0, 1)), y: r3(clamp(o.y, 0, 1)) };
    });
    return Object.keys(byT).map(function (k) { return byT[k]; })
      .sort(function (a, b) { return a.t - b.t; }).slice(0, MAX_FC);
  }
  function fcAt(keys, t) {
    if (!keys || !keys.length) return { x: 0.5, y: 0.5 };
    var a = keys[0], b = keys[keys.length - 1];
    if (t <= a.t) b = a;
    else if (t >= b.t) a = b;
    else for (var i = 1; i < keys.length; i++) if (keys[i].t >= t) { a = keys[i - 1]; b = keys[i]; break; }
    var q = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    return { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q };
  }
  // The keys after setting the point at time t (a key within `near`
  // seconds is replaced), or removing it (pt null).
  function fcSet(keys, t, pt, near) {
    var lim = near > 0 ? near : 1 / 120;
    var out = (keys || []).filter(function (k) { return Math.abs(k.t - t) > lim; });
    if (pt) out.push({ t: t, x: pt.x, y: pt.y });
    return normFc(out);
  }
  // Media time of a clip `local` seconds in: file seconds for a video,
  // clip seconds for a picture.
  function mediaTime(it, local) { return it.k === "video" ? srcTime(it, local) : local; }
  // Where the texture point (u, v) of a picture shows inside its placed
  // rectangle after rotate (0/90/180/270) and mirror: the inverse of
  // MontageGL's vertex mapping (uvOf).
  function uvOf(px, py, rot, fl) {
    var x = fl ? 1 - px : px, y = py;
    if (rot === 90) return [y, 1 - x];
    if (rot === 180) return [1 - x, 1 - y];
    if (rot === 270) return [1 - y, x];
    return [x, y];
  }
  function shownPoint(u, v, rot, fl) {
    var p;
    if (rot === 90) p = [1 - v, u];
    else if (rot === 180) p = [1 - u, 1 - v];
    else if (rot === 270) p = [v, 1 - u];
    else p = [u, v];
    if (fl) p[0] = 1 - p[0];
    return p;
  }

  // ---------- Keyframes ----------
  // kf = [{ t, x, y, s, o, v }] sorted by t (seconds into the clip): x, y
  // move the picture (fraction of the frame), s scales it, o opacity
  // 0-100 (pictures and titles); v volume 0-200 (video and sound). A clip
  // takes only the keys it can use. Between two keys values change at an
  // even pace (so a cut between keys changes nothing); before the first
  // and after the last they hold.
  var MAX_KEYS = 60;
  var KF_PROPS = { x: [0, -2, 2], y: [0, -2, 2], s: [1, 0.1, 5], o: [100, 0, 100], v: [100, 0, 200] };
  function kfProps(it) {
    var out = [];
    if (it.k !== "audio") out.push("x", "y", "s", "o");
    if (it.k === "video" || it.k === "audio") out.push("v");
    return out;
  }
  function normKf(v, it) {
    if (!Array.isArray(v)) return [];
    var props = kfProps(it), byT = {};
    v.slice(0, MAX_KEYS * 2).forEach(function (raw) {
      var o = obj(raw);
      if (!o || !isNum(o.t)) return;
      var key = { t: r3(clamp(o.t, 0, MAX_DUR)) };
      props.forEach(function (k) {
        var d = KF_PROPS[k];
        key[k] = r3(num(o[k], d[0], d[1], d[2]));
      });
      byT[key.t] = key;
    });
    return Object.keys(byT).map(function (k) { return byT[k]; })
      .sort(function (a, b) { return a.t - b.t; }).slice(0, MAX_KEYS);
  }
  // Values of every keyframed property `local` seconds into the clip.
  function kfAt(it, local) {
    var out = {}, keys = it.kf || [], props = kfProps(it);
    props.forEach(function (k) { out[k] = KF_PROPS[k][0]; });
    if (!keys.length) return out;
    var a = keys[0], b = keys[keys.length - 1];
    if (local <= a.t) b = a;
    else if (local >= b.t) a = b;
    else for (var i = 1; i < keys.length; i++) if (keys[i].t >= local) { a = keys[i - 1]; b = keys[i]; break; }
    var q = b.t > a.t ? (local - a.t) / (b.t - a.t) : 0;
    props.forEach(function (k) { out[k] = a[k] + (b[k] - a[k]) * q; });
    return out;
  }
  // The keys of a clip after setting `vals` at `local` (a key within half
  // a frame at 60 fps is the same key), or removing it (vals null).
  function kfSet(it, local, vals) {
    var keys = (it.kf || []).filter(function (k) { return Math.abs(k.t - local) > 1 / 120; });
    if (vals) {
      var key = kfAt(it, local);
      Object.keys(vals).forEach(function (k) { if (k in key) key[k] = vals[k]; });
      key.t = local;
      keys.push(key);
    }
    return normKf(keys, it);
  }
  // A clip cut at `local`: the keys of each side, with a key at the cut
  // so that both halves keep moving exactly as before.
  function kfSplit(it, local) {
    var keys = it.kf || [];
    if (!keys.length) return [[], []];
    var mid = kfAt(it, local), left = [], right = [];
    keys.forEach(function (k) {
      if (k.t < local) left.push(k);
      else if (k.t > local) right.push(Object.assign({}, k, { t: k.t - local }));
    });
    left.push(Object.assign({}, mid, { t: local }));
    right.unshift(Object.assign({}, mid, { t: 0 }));
    return [normKf(left, it), normKf(right, it)];
  }

  function normFields(o) {
    var f = {
      name: str(o.name, 80).replace(/[\r\n\t]+/g, " ").trim() || "Untitled",
      ar: RATIOS[o.ar] ? o.ar : "16:9",
      fps: oneOf(o.fps, FPS, 30),
      bg: COLOR_RE.test(o.bg) ? o.bg : "#000000",
      vs: o.vs === true,
      m: stamp(o.m)
    };
    // dk (ducking, % the music drops under the voice) is written only
    // when on, so a project without it reads the same on older copies.
    var dk = Math.round(num(o.dk, 0, 0, 90));
    if (dk > 0) f.dk = dk;
    return f;
  }

  function normTombs(v, keyOk) {
    var out = {}, o = obj(v);
    if (!o) return out;
    Object.keys(o).forEach(function (k) { if (keyOk(k) && isInt(o[k]) && o[k] >= 0) out[k] = o[k]; });
    return out;
  }

  // ---------- Merge ----------
  function newerOf(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function maxInto(into, tm) {
    Object.keys(tm).forEach(function (k) { if (!(k in into) || tm[k] > into[k]) into[k] = tm[k]; });
  }
  function sortedObj(o) {
    var out = {};
    Object.keys(o).sort(cmpStr).forEach(function (k) { out[k] = o[k]; });
    return out;
  }

  function mergeProject(pa, pb, id) {
    var fa = pa ? normFields(pa) : null, fb = pb ? normFields(pb) : null;
    var f = newerOf(fa, fb);
    var tombs = {};
    [pa, pb].forEach(function (p) { if (p) maxInto(tombs, normTombs(p.tombs, isId)); });
    var best = {};
    [pa, pb].forEach(function (p) {
      var its = p && obj(p.items);
      if (!its) return;
      Object.keys(its).forEach(function (k) {
        var it = normItem(its[k], k);
        if (it) best[k] = newerOf(best[k], it);
      });
    });
    var items = {};
    Object.keys(best).sort(cmpStr).forEach(function (k) {
      if (k in tombs && tombs[k] >= best[k].m) return;
      items[k] = best[k];
    });
    // a tombstone older than every possible resurrection is still kept:
    // dropping it would let an offline device's stale copy return.
    var out = { id: id };
    Object.keys(f).forEach(function (k) { out[k] = f[k]; });
    out.items = items;
    out.tombs = sortedObj(tombs);
    return out;
  }

  // Newest edit anywhere in a project (its fields or any item).
  function lastEdit(p) {
    var m = p.m;
    Object.keys(p.items).forEach(function (k) { if (p.items[k].m > m) m = p.items[k].m; });
    Object.keys(p.tombs).forEach(function (k) { if (p.tombs[k] > m) m = p.tombs[k]; });
    return m;
  }

  function merge(A, B) {
    var a = obj(A) || {}, b = obj(B) || {};
    var tombs = {};
    maxInto(tombs, normTombs(a.tombs, isId));
    maxInto(tombs, normTombs(b.tombs, isId));
    var ids = {};
    [a.projects, b.projects].forEach(function (ps) {
      ps = obj(ps);
      if (ps) Object.keys(ps).forEach(function (k) { if (isId(k) && obj(ps[k])) ids[k] = 1; });
    });
    var projects = {};
    Object.keys(ids).sort(cmpStr).forEach(function (id) {
      var pa = obj(a.projects) && obj(a.projects[id]), pb = obj(b.projects) && obj(b.projects[id]);
      var p = mergeProject(pa, pb, id);
      if (id in tombs && tombs[id] >= lastEdit(p)) return;     // a newer edit resurrects (R17)
      projects[id] = p;
    });
    return { ver: VER, projects: projects, tombs: sortedObj(tombs) };
  }

  // ---------- Timeline ----------
  function itemDur(it) {
    if (it.k === "video" || it.k === "audio") {
      if (hasRamp(it)) { var g = rampSegs(it); return g.length ? g[g.length - 1].t1 : 0; }
      return (it.out - it["in"]) / it.sp;
    }
    return it.d;
  }
  function byOrder(a, b) { return a.o !== b.o ? a.o - b.o : cmpStr(a.id, b.id); }
  function byStart(a, b) { return a.at !== b.at ? a.at - b.at : cmpStr(a.id, b.id); }
  function trackItems(p, tr) {
    var out = [];
    Object.keys(p.items).forEach(function (k) { if (p.items[k].tr === tr) out.push(p.items[k]); });
    return out.sort(tr === "main" ? byOrder : byStart);
  }
  // The transition into a main clip overlaps the clip before it; it is
  // never longer than half of either clip.
  function txLen(prev, cur) {
    if (!prev || !cur.tx) return 0;
    return Math.min(cur.tx.d, itemDur(prev) / 2, itemDur(cur) / 2);
  }
  // Main track in order with each clip's place: [{ it, start, end, tx }]
  function mainSeq(p) {
    var list = trackItems(p, "main"), out = [], t = 0, prev = null;
    list.forEach(function (it) {
      var tx = txLen(prev, it), start = Math.max(0, t - tx), end = start + itemDur(it);
      out.push({ it: it, start: start, end: end, tx: tx });
      t = end; prev = it;
    });
    return out;
  }
  // Where an item sits on the timeline: { start, end } (null if absent)
  function placeOf(p, iid) {
    var it = p.items[iid];
    if (!it) return null;
    if (it.tr !== "main") return { start: it.at, end: it.at + itemDur(it) };
    var seq = mainSeq(p);
    for (var i = 0; i < seq.length; i++) if (seq[i].it.id === iid) return { start: seq[i].start, end: seq[i].end };
    return null;
  }
  function duration(p) {
    var seq = mainSeq(p), end = seq.length ? seq[seq.length - 1].end : 0;
    Object.keys(p.items).forEach(function (k) {
      var it = p.items[k];
      if (it.tr !== "main") end = Math.max(end, it.at + itemDur(it));
    });
    return end;
  }

  function outputSize(ar, shortSide) {
    var r = RATIOS[ar] || RATIOS["16:9"], s = shortSide || 1080;
    var w, h;
    if (r[0] >= r[1]) { h = s; w = s * r[0] / r[1]; } else { w = s; h = s * r[1] / r[0]; }
    return { w: Math.round(w / 2) * 2, h: Math.round(h / 2) * 2 };
  }

  // Fade multiplier 0..1 for a clip `local` seconds into it.
  function fadeAt(it, local, dur) {
    var g = 1;
    if (it.fi > 0 && local < it.fi) g = Math.min(g, local / it.fi);
    if (it.fo > 0 && local > dur - it.fo) g = Math.min(g, (dur - local) / it.fo);
    return clamp(g, 0, 1);
  }
  // Seconds into the file shown `local` seconds into a clip (backwards
  // from the out point when reversed).
  function srcTime(it, local) {
    if (hasRamp(it)) {
      if (it.rv) return Math.max(it["in"], fwdPos(it, itemDur(it) - local) - 0.001);
      return Math.min(it.out, fwdPos(it, local));
    }
    if (it.rv) return Math.max(it["in"], it.out - local * it.sp - 0.001);
    return Math.min(it.out, it["in"] + local * it.sp);
  }

  function pictureLayer(it, local, dur) {
    var L = {
      id: it.id, k: it.k, tr: it.tr, src: it.src || null, alpha: fadeAt(it, local, dur) * (it.op / 100),
      bri: 1, dx: 0, dy: 0, sc: 1, iris: -1, clip: null, local: local
    };
    if (it.k === "video") L.st = srcTime(it, local);
    if (it.k === "video" || it.k === "image") {
      L.fit = it.fit; L.rot = it.rot; L.fl = it.fl; L.lk = it.lk; L.flt = it.flt;
      if (it.lut) L.lut = it.lut;
      if (it.ck) L.ck = it.ck;
      if (it.bd) L.bd = it.bd;
      if (it.fc && it.fit === "fill") {
        var f = fcAt(it.fc, mediaTime(it, local)), sp = shownPoint(f.x, f.y, it.rot, it.fl);
        L.fc = { x: sp[0], y: sp[1] };
      }
    }
    if (it.k === "shape") L.sh = it.sh;
    if (it.box) L.box = it.box;
    if (it.k === "title") { L.text = it.text; if (it.bg) L.bg = it.bg; }
    if (it.kf) {
      var k = kfAt(it, local), b0 = it.box || { x: 0, y: 0, w: 1, h: 1 };
      var w = b0.w * k.s, h = b0.h * k.s;
      L.box = { x: b0.x + (b0.w - w) / 2 + k.x, y: b0.y + (b0.h - h) / 2 + k.y, w: w, h: h };
      L.alpha *= k.o / 100;
    }
    return L;
  }

  // What is on screen at time t, bottom to top. Each layer:
  // { id, k, tr, src, st (video: seconds into the file), alpha, bri,
  //   dx, dy (shift, fraction of the frame: slide, push), sc (scale
  //   around the centre: zoom), iris (0..1 circle that reveals the
  //   clip, -1 = none), clip ([x0, x1] of the frame shown, wipes), fit, rot, fl, lk, flt, box, text, bg,
  //   local (seconds into the clip) }
  function framePlan(p, t) {
    var layers = [], seq = mainSeq(p);
    for (var i = 0; i < seq.length; i++) {
      var s = seq[i];
      if (t < s.start || t >= s.end) continue;
      var L = pictureLayer(s.it, t - s.start, s.end - s.start);
      var next = seq[i + 1];
      // inside the transition into this clip
      if (s.tx > 0 && t < s.start + s.tx) {
        var q = (t - s.start) / s.tx, k = s.it.tx.k;
        if (k === "fade") L.alpha *= q;
        else if (k === "black") { if (q < 0.5) L.alpha = 0; else L.bri = 2 * q - 1; }
        else if (k === "slide") L.dx = 1 - q;
        else if (k === "wipe") L.clip = [0, q];
        else if (k === "push") L.dy = 1 - q;
        else if (k === "zoom") { var e = 1 - Math.pow(1 - q, 2); L.alpha *= q; L.sc = 1.3 - 0.3 * e; }
        else if (k === "circle") L.iris = q;
      }
      // inside the transition out of this clip (into the next one)
      if (next && next.tx > 0 && t >= next.start) {
        var q2 = (t - next.start) / next.tx, k2 = next.it.tx.k;
        if (k2 === "black") { if (q2 >= 0.5) L.alpha = 0; else L.bri = 1 - 2 * q2; }
        else if (k2 === "slide") L.dx = -q2;
        else if (k2 === "push") L.dy = -q2;
      }
      layers.push(L);
    }
    ["ov", "tt"].forEach(function (tr) {
      trackItems(p, tr).forEach(function (it) {
        var d = itemDur(it);
        if (t >= it.at && t < it.at + d) layers.push(pictureLayer(it, t - it.at, d));
      });
    });
    return layers;
  }

  // Everything that makes sound, on the timeline:
  // [{ id, src, start, dur, in, sp, vol (0..2), fi, fo, kv?, dk?, duck? }]
  // (dk 0..0.9 and duck [[from, to], …] seconds into the segment: the
  // voice-over parts the music ducks under)
  // A main transition crossfades the two clips' sound over its length.
  function soundPlan(p) {
    var out = [], seq = mainSeq(p);
    seq.forEach(function (s, i) {
      var it = s.it;
      if (it.k !== "video" || it.mu || it.rv || it.vol === 0) return;
      var next = seq[i + 1];
      out.push(volKeys({
        id: it.id, src: it.na || it.src, start: s.start, dur: s.end - s.start, "in": it["in"], sp: it.sp, vol: it.vol / 100,
        fi: Math.max(it.fi, s.tx), fo: Math.max(it.fo, next ? next.tx : 0)
      }, it));
    });
    ["ov", "a1", "a2"].forEach(function (tr) {
      trackItems(p, tr).forEach(function (it) {
        if ((it.k !== "video" && it.k !== "audio") || it.mu || it.rv || it.vol === 0) return;
        out.push(volKeys({ id: it.id, src: it.na || it.src, start: it.at, dur: itemDur(it), "in": it["in"], sp: it.sp, vol: it.vol / 100, fi: it.fi, fo: it.fo }, it));
      });
    });
    // Ducking: Music (a1) drops by dk % while anything plays on Voice (a2).
    if (p.dk > 0) {
      var voice = [];
      trackItems(p, "a2").forEach(function (it) {
        if (!it.mu && it.vol > 0) voice.push([it.at, it.at + itemDur(it)]);
      });
      if (voice.length) out.forEach(function (seg) {
        var it = p.items[seg.id];
        if (!it || it.tr !== "a1") return;
        var duck = [];
        voice.forEach(function (v) {
          if (v[0] < seg.start + seg.dur + DUCK_RAMP && v[1] > seg.start - DUCK_RAMP) duck.push([r3(v[0] - seg.start), r3(v[1] - seg.start)]);
        });
        if (duck.length) { seg.dk = p.dk / 100; seg.duck = duck; }
      });
    }
    return out.sort(function (a, b) { return a.start !== b.start ? a.start - b.start : cmpStr(a.id, b.id); });
  }
  // A segment carries its clip's volume keys as kv [[t, 0..2], …], and
  // a speed curve as out + sr (srcPieces reads it).
  function volKeys(seg, it) {
    if (it.kf && it.kf.some(function (k) { return k.v !== 100; })) seg.kv = it.kf.map(function (k) { return [k.t, k.v / 100]; });
    if (hasRamp(it)) { seg.out = it.out; seg.sr = it.sr; }
    return seg;
  }
  var DUCK_RAMP = 0.25;                // seconds the music takes to go down / up
  // Gain of a sound segment `local` seconds into it.
  function gainAt(seg, local) {
    var g = seg.vol;
    if (seg.kv) {
      var kv = seg.kv, a = kv[0], b = kv[kv.length - 1];
      if (local <= a[0]) b = a;
      else if (local >= b[0]) a = b;
      else for (var j = 1; j < kv.length; j++) if (kv[j][0] >= local) { a = kv[j - 1]; b = kv[j]; break; }
      g *= a[1] + (b[1] - a[1]) * (b[0] > a[0] ? (local - a[0]) / (b[0] - a[0]) : 0);
    }
    if (seg.fi > 0 && local < seg.fi) g *= clamp(local / seg.fi, 0, 1);
    if (seg.fo > 0 && local > seg.dur - seg.fo) g *= clamp((seg.dur - local) / seg.fo, 0, 1);
    if (seg.duck) {
      var cov = 0;
      for (var i = 0; i < seg.duck.length && cov < 1; i++) {
        var a = seg.duck[i][0], b = seg.duck[i][1], c;
        if (local >= a && local <= b) c = 1;
        else if (local < a) c = 1 - (a - local) / DUCK_RAMP;
        else c = 1 - (local - b) / DUCK_RAMP;
        if (c > cov) cov = c;
      }
      g *= 1 - seg.dk * clamp(cov, 0, 1);
    }
    return g;
  }

  // Every media id a project (or all projects) needs.
  function mediaOf(p) {
    var ids = {};
    Object.keys(p.items).forEach(function (k) {
      if (p.items[k].src) ids[p.items[k].src] = 1;
      if (p.items[k].lut) ids[p.items[k].lut] = 1;
      if (p.items[k].na) ids[p.items[k].na] = 1;
    });
    return Object.keys(ids).sort(cmpStr);
  }

  // ---------- Edits (each returns new data; the input is untouched) ----------
  // Every edit stamps m at the mutation site (R27) with a clock that
  // never goes back for that entity (a device whose clock is behind
  // still wins over its own previous edit).
  function clone(data) { return merge(data, null); }
  function tick(old, now) { return Math.max(now, old ? old + 1 : 0); }

  function newProject(data, opts, now, id) {
    var d = clone(data);
    if (!isId(id) || d.projects[id]) return d;
    var f = normFields({ name: opts && opts.name, ar: opts && opts.ar, fps: opts && opts.fps, bg: opts && opts.bg, m: tick(d.tombs[id], now) });
    var p = { id: id };
    Object.keys(f).forEach(function (k) { p[k] = f[k]; });
    p.items = {}; p.tombs = {};
    d.projects[id] = p;
    return merge(d, null);
  }
  function setProject(data, pid, patch, now) {
    var d = clone(data), p = d.projects[pid];
    if (!p) return d;
    var f = normFields(p), changed = false;
    ["name", "ar", "fps", "bg", "vs", "dk"].forEach(function (k) {
      if (!patch || !(k in patch)) return;
      var cand = Object.assign({}, f);
      cand[k] = patch[k];
      var v = normFields(cand)[k];
      if (v !== p[k]) { p[k] = v; changed = true; }
    });
    if (changed) p.m = tick(p.m, now);
    return merge(d, null);
  }
  function delProject(data, pid, now) {
    var d = clone(data), p = d.projects[pid];
    if (!p) return d;
    d.tombs[pid] = tick(lastEdit(p), now);
    return merge(d, null);
  }

  // A fresh order key after `afterId` on the main track (null = first;
  // undefined = last). Renumbers the track when two keys get too close.
  function orderKey(p, afterId, now) {
    var list = trackItems(p, "main");
    if (afterId === undefined) return list.length ? list[list.length - 1].o + 1 : 1;
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === afterId) idx = i;
    if (afterId !== null && idx < 0) return list.length ? list[list.length - 1].o + 1 : 1;
    var lo = idx >= 0 ? list[idx].o : (list.length ? list[0].o - 2 : 0);
    var hi = idx + 1 < list.length ? list[idx + 1].o : lo + 2;
    if (hi - lo > 1e-6) return (lo + hi) / 2;
    list.forEach(function (it, j) { it.o = j + 1; it.m = tick(it.m, now); });
    return (idx >= 0 ? idx + 1 : 0) + 0.5;
  }

  // Add an item; opts.after = the main clip it follows (null = first).
  function addItem(data, pid, item, now, opts) {
    var d = clone(data), p = d.projects[pid];
    if (!p || !item || !isId(item.id) || p.items[item.id]) return d;
    if (Object.keys(p.items).length >= MAX_ITEMS) return d;
    var it = Object.assign({}, item, { m: tick(p.tombs[item.id], now) });
    if (it.tr === "main") it.o = orderKey(p, opts ? opts.after : undefined, now);
    var n = normItem(it, it.id);
    if (!n) return d;
    p.items[n.id] = n;
    return merge(d, null);
  }
  function setItem(data, pid, iid, patch, now) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it) return d;
    var next = Object.assign({}, it, patch || {}, { id: it.id, k: it.k, m: it.m });
    if (next.tr !== it.tr) {                                 // change of track
      if (next.tr === "main") { delete next.at; next.o = orderKey(p, undefined, now); }
      else if (it.tr === "main") { var pl = placeOf(p, iid); next.at = pl ? pl.start : 0; delete next.tx; }
    }
    var n = normItem(next, iid);
    if (!n || JSON.stringify(n) === JSON.stringify(it)) return d;
    n.m = tick(it.m, now);
    p.items[iid] = n;
    return merge(d, null);
  }
  function delItem(data, pid, iid, now) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it) return d;
    p.tombs[iid] = tick(it.m, now);
    delete p.items[iid];
    return merge(d, null);
  }
  // Move a main clip so that it follows `afterId` (null = first).
  function moveMain(data, pid, iid, afterId, now) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it || it.tr !== "main" || afterId === iid) return d;
    delete p.items[iid];
    var o = orderKey(p, afterId, now);
    p.items[iid] = it;
    if (o === it.o) return merge(d, null);
    it.o = o; it.m = tick(it.m, now);
    return merge(d, null);
  }

  // Split an item at timeline time t; the right part gets newId.
  function split(data, pid, iid, t, now, newId) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it || !isId(newId) || p.items[newId]) return d;
    var pl = placeOf(p, iid), local = t - pl.start, dur = pl.end - pl.start;
    if (!(local >= MIN && dur - local >= MIN)) return d;
    var left = JSON.parse(JSON.stringify(it)), right = JSON.parse(JSON.stringify(it));
    right.id = newId; right.fi = 0; left.fo = 0;
    if (it.k === "video" || it.k === "audio") {
      if (it.rv) { var rcut = hasRamp(it) ? fwdPos(it, dur - local) : it.out - local * it.sp; left["in"] = rcut; right.out = rcut; }
      else { var cut = fwdPos(it, local); left.out = cut; right["in"] = cut; }
    } else { left.d = local; right.d = dur - local; }
    if (it.tr === "main") { right.tx = null; right.o = orderKey(p, iid, now); }
    else right.at = it.at + local;
    if (it.kf) { var ks = kfSplit(it, local); left.kf = ks[0]; right.kf = ks[1]; }
    left.m = tick(it.m, now); right.m = tick(p.tombs[newId], now);
    var nl = normItem(left, iid), nr = normItem(right, newId);
    if (!nl || !nr) return d;
    p.items[iid] = nl; p.items[newId] = nr;
    return merge(d, null);
  }
  function duplicate(data, pid, iid, now, newId) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it || !isId(newId) || p.items[newId]) return d;
    var c = JSON.parse(JSON.stringify(it));
    c.id = newId; c.m = tick(p.tombs[newId], now);
    if (it.tr === "main") c.o = orderKey(p, iid, now);
    else c.at = it.at + itemDur(it);
    var n = normItem(c, newId);
    if (!n) return d;
    p.items[newId] = n;
    return merge(d, null);
  }
  // The sound of a video clip becomes its own clip on a sound track,
  // and the video goes silent.
  function detachSound(data, pid, iid, now, newId, track) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it || it.k !== "video" || it.mu || !isId(newId) || p.items[newId]) return d;
    var pl = placeOf(p, iid);
    var a = normItem({
      id: newId, k: "audio", tr: track === "a2" ? "a2" : "a1", src: it.src, len: it.len, "in": it["in"], out: it.out,
      sp: it.sp, vol: it.vol, fi: it.fi, fo: it.fo, at: pl.start, m: tick(p.tombs[newId], now), kf: it.kf, sr: it.sr, na: it.na
    }, newId);
    if (!a) return d;
    p.items[newId] = a;
    it.mu = true; it.m = tick(it.m, now);
    return merge(d, null);
  }

  // Relink with a different file: every clip that used oldId uses
  // newId (its length clamps in/out points to the new file).
  function replaceSrc(data, pid, oldId, newId, len, now) {
    var d = clone(data), p = d.projects[pid];
    if (!p) return d;
    Object.keys(p.items).forEach(function (k) {
      var it = p.items[k];
      if (it.lut === oldId && isPicture(newId)) {
        var nl = JSON.parse(JSON.stringify(it));
        nl.lut = newId;
        var nn = normItem(nl, k);
        if (nn) { nn.m = tick(it.m, now); p.items[k] = it = nn; }
      }
      if (it.na === oldId && isSound(newId)) {
        var na = JSON.parse(JSON.stringify(it));
        na.na = newId;
        var nn2 = normItem(na, k);
        if (nn2) { nn2.m = tick(it.m, now); p.items[k] = it = nn2; }
      }
      if (it.src !== oldId) return;
      var next = JSON.parse(JSON.stringify(it));
      next.src = newId;
      if (newId !== oldId) delete next.na;          // the cleaned sound was made from the old file
      if (it.k === "video" || it.k === "audio") {
        next.len = len || 0;
        if (len > 0 && next.out > len) { next.out = len; next["in"] = Math.min(next["in"], Math.max(0, len - MIN)); }
      }
      var n = normItem(next, k);
      if (!n) return;
      n.m = tick(it.m, now);
      p.items[k] = n;
    });
    return merge(d, null);
  }

  // Undo / redo: bring a project back to an earlier copy of itself.
  // Every item that differs gets a fresh m (and items gone since then
  // come back newer than their tombstone), so the restore is an edit
  // like any other and travels through sync.
  function restoreProject(data, pid, snap, now) {
    var d = clone(data), p = d.projects[pid];
    var wrap = { projects: {} };
    wrap.projects[pid] = snap;
    var s = snap ? merge(wrap, null).projects[pid] : null;
    if (!p || !s) return d;
    var f = normFields(p), fs = normFields(s), changed = false;
    ["name", "ar", "fps", "bg", "vs", "dk"].forEach(function (k) {
      if (f[k] === fs[k]) return;
      if (k in fs) p[k] = fs[k]; else delete p[k];
      changed = true;
    });
    if (changed) p.m = tick(p.m, now);
    Object.keys(p.items).forEach(function (k) {
      if (!s.items[k]) { p.tombs[k] = tick(p.items[k].m, now); delete p.items[k]; }
    });
    Object.keys(s.items).forEach(function (k) {
      var want = JSON.parse(JSON.stringify(s.items[k])), cur = p.items[k];
      if (cur) { want.m = cur.m; if (JSON.stringify(want) === JSON.stringify(cur)) return; }
      want.m = tick(Math.max(cur ? cur.m : 0, p.tombs[k] || 0), now);
      p.items[k] = want;
    });
    return merge(d, null);
  }

  // Bring a deleted project back (undo): a fresh edit newer than its
  // tombstone, so every device sees it return (R17).
  function undeleteProject(data, snap, now) {
    var d = clone(data);
    if (!snap || !isId(snap.id) || d.projects[snap.id]) return d;
    var wrap = { projects: {} };
    wrap.projects[snap.id] = snap;
    var s = merge(wrap, null).projects[snap.id];
    if (!s) return d;
    var m = tick(Math.max(d.tombs[snap.id] || 0, lastEdit(s)), now);
    s.m = m;
    Object.keys(s.items).forEach(function (k) { s.items[k].m = m; });
    d.projects[snap.id] = s;
    return merge(d, null);
  }

  // ---------- Small helpers for the app ----------
  function projectList(data) {
    var ps = (data && data.projects) || {};
    return Object.keys(ps).map(function (k) { return ps[k]; })
      .sort(function (a, b) { var ma = lastEdit(a), mb = lastEdit(b); return ma !== mb ? mb - ma : cmpStr(a.id, b.id); });
  }
  function fmtTime(sec, withFrames, fps) {
    sec = Math.max(0, sec || 0);
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = Math.floor(sec) % 60;
    var out = (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
    if (withFrames) { var f = Math.floor((sec - Math.floor(sec)) * (fps || 30) + 1e-6); out += "." + (f < 10 ? "0" : "") + f; }
    return out;
  }
  function exportName(name, ext) {
    var base = String(name || "montage").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "montage";
    return base + "." + (EXTS.indexOf(ext) >= 0 ? ext : "mp4");
  }
  var EXTS = ["mp4", "webm", "png", "gif", "m4a", "ogg", "wav", "srt"];

  // ---------- Colour looks: .cube 3D LUT files ----------
  // parseCube(text) → { n, data: Float32Array(n³·3) } (red fastest, then
  // green, then blue, as the format lists them) or null. Only 3D tables
  // of 2–64 points per side; DOMAIN_MIN/MAX rescale to 0–1.
  var MAX_LUT = 64;
  function parseCube(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var n = 0, lo = [0, 0, 0], hi = [1, 1, 1], data = null, i = 0;
    for (var li = 0; li < lines.length; li++) {
      var ln = lines[li].replace(/#.*/, "").trim();
      if (!ln) continue;
      var w = ln.split(/\s+/);
      if (/^LUT_3D_SIZE$/i.test(w[0])) {
        n = Number(w[1]);
        if (!isInt(n) || n < 2 || n > MAX_LUT) return null;
        data = new Float32Array(n * n * n * 3);
      } else if (/^LUT_1D_SIZE$/i.test(w[0])) return null;
      else if (/^DOMAIN_MIN$/i.test(w[0])) lo = w.slice(1, 4).map(Number);
      else if (/^DOMAIN_MAX$/i.test(w[0])) hi = w.slice(1, 4).map(Number);
      else if (/^[-+.\d]/.test(w[0])) {
        if (!data || w.length < 3 || i >= data.length) return null;
        for (var c = 0; c < 3; c++) {
          var v = Number(w[c]), span = hi[c] - lo[c];
          if (!isFinite(v) || !(span > 0)) return null;
          data[i++] = clamp((v - lo[c]) / span, 0, 1);
        }
      }
    }
    return data && i === data.length ? { n: n, data: data } : null;
  }
  // The table as an RGBA picture n² wide and n high: blue slice b sits
  // at x = b·n, red runs along x inside it, green down y (the layout
  // MontageGL samples).
  function lutPixels(lut) {
    var n = lut.n, w = n * n, px = new Uint8ClampedArray(w * n * 4);
    for (var b = 0; b < n; b++) for (var g = 0; g < n; g++) for (var r = 0; r < n; r++) {
      var src = ((b * n + g) * n + r) * 3, dst = (g * w + b * n + r) * 4;
      px[dst] = Math.round(lut.data[src] * 255);
      px[dst + 1] = Math.round(lut.data[src + 1] * 255);
      px[dst + 2] = Math.round(lut.data[src + 2] * 255);
      px[dst + 3] = 255;
    }
    return { w: w, h: n, data: px };
  }

  // ---------- Subtitles (SRT, and WebVTT on the way in) ----------
  var SUB_BOX = { x: 0.05, y: 0.8, w: 0.9, h: 0.14 };
  var MAX_CUES = 1500;
  function cueTime(s) {
    var m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/.exec(String(s).trim());
    if (!m) return NaN;
    var ms = m[4] ? Number((m[4] + "00").slice(0, 3)) : 0;
    return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
  }
  // Text of a subtitle file → [{ start, end, text }] in time order.
  // Markup (<i>, {\an8}, VTT cue settings) is dropped: titles are plain.
  function parseSrt(text) {
    var src = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    var out = [];
    src.split(/\n[ \t]*\n/).forEach(function (block) {
      if (out.length >= MAX_CUES) return;
      var lines = block.split("\n").filter(function (l, i, a) { return l.trim() || (i > 0 && i < a.length - 1); });
      var at = -1;
      for (var i = 0; i < lines.length && i < 3; i++) if (lines[i].indexOf("-->") >= 0) { at = i; break; }
      if (at < 0) return;
      var parts = lines[at].split("-->");
      var a = cueTime(parts[0]), b = cueTime(String(parts[1] || "").trim().split(/\s+/)[0]);
      if (!isNum(a) || !isNum(b) || !(b - a >= MIN - 1e-9) || a > MAX_DUR * 4) return;
      var t = lines.slice(at + 1).join("\n")
        .replace(/<[^>]*>/g, "").replace(/\{\\[^}]*\}/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .split("\n").map(function (l) { return l.trim(); }).filter(Boolean).join("\n").slice(0, 500);
      if (t) out.push({ start: r3(a), end: r3(b), text: t });
    });
    return out.sort(function (x, y) { return x.start - y.start; });
  }
  function srtTime(sec) {
    var ms = Math.round(Math.max(0, sec) * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    function pad(v, n) { v = String(v); while (v.length < n) v = "0" + v; return v; }
    return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s, 2) + "," + pad(ms % 1000, 3);
  }
  // The text clips of the Text row (tt) as an SRT file, in time order.
  function toSrt(p) {
    var n = 0;
    return trackItems(p, "tt").filter(function (it) { return it.text.t.trim(); }).map(function (it) {
      n++;
      return n + "\n" + srtTime(it.at) + " --> " + srtTime(it.at + it.d) + "\n" + it.text.t.replace(/\n{2,}/g, "\n").trim() + "\n";
    }).join("\n");
  }
  // Cues → text clips on the Text row in the subtitle style (bottom
  // band, outlined), all in one edit; newIds supplies one id per cue.
  function addSubtitles(data, pid, cues, now, newIds) {
    var d = clone(data), p = d.projects[pid];
    if (!p) return d;
    var room = MAX_ITEMS - Object.keys(p.items).length;
    (cues || []).slice(0, Math.max(0, room)).forEach(function (c, i) {
      var id = newIds && newIds[i];
      if (!isId(id) || p.items[id]) return;
      var it = normItem({
        id: id, k: "title", tr: "tt", at: c.start, d: c.end - c.start, box: SUB_BOX, m: tick(p.tombs[id], now),
        text: { t: c.text, f: "sans", sz: 5.5, col: "#ffffff", ol: "#000000", al: "c", an: "none" }
      }, id);
      if (it) p.items[id] = it;
    });
    return merge(d, null);
  }

  // Freeze frame: a still picture (pic, the frame at t) is held for
  // `hold` seconds inside a main video clip: the clip splits at t and
  // the still goes between the two parts. ids = { tail, still }.
  function freezeAt(data, pid, iid, t, pic, hold, now, ids) {
    var p0 = data && data.projects && data.projects[pid], it = p0 && p0.items[iid];
    if (!it || it.tr !== "main" || it.k !== "video" || !isPicture(pic) || !ids || !isId(ids.still)) return data;
    var pl = placeOf(p0, iid), local = t - pl.start, d = data, after = iid;
    if (local >= MIN && pl.end - pl.start - local >= MIN) {
      d = split(d, pid, iid, t, now, ids.tail);
      if (!d.projects[pid].items[ids.tail]) return data;
    } else if (local < MIN) {
      after = null;
      var seq = mainSeq(d.projects[pid]);
      for (var i = 0; i < seq.length; i++) if (seq[i].it.id === iid) { after = i ? seq[i - 1].it.id : null; break; }
    }
    return addItem(d, pid, {
      id: ids.still, k: "image", tr: "main", src: pic, d: r3(num(hold, 2, MIN, 60)),
      fit: it.fit, rot: it.rot, fl: it.fl, lk: it.lk, flt: it.flt, op: it.op
    }, now, { after: after });
  }

  var api = {
    VER: VER, MIN: MIN, MAX_ITEMS: MAX_ITEMS, KINDS: KINDS, TRACKS: TRACKS, TRACK_KINDS: TRACK_KINDS,
    SHAPES: SHAPES.slice(), RATIOS: Object.keys(RATIOS), FPS: FPS.slice(), TRANSITIONS: TRANSITIONS.slice(), FILTERS: FILTERS.slice(), ANIMS: ANIMS.slice(),
    isId: isId, isPicture: isPicture, isVideo: isVideo, isSound: isSound,
    normItem: normItem, merge: merge, lastEdit: lastEdit,
    itemDur: itemDur, trackItems: trackItems, mainSeq: mainSeq, placeOf: placeOf, duration: duration,
    outputSize: outputSize, framePlan: framePlan, soundPlan: soundPlan, gainAt: gainAt, fadeAt: fadeAt, mediaOf: mediaOf,
    newProject: newProject, setProject: setProject, delProject: delProject,
    addItem: addItem, setItem: setItem, delItem: delItem, moveMain: moveMain,
    split: split, duplicate: duplicate, detachSound: detachSound, restoreProject: restoreProject, undeleteProject: undeleteProject, replaceSrc: replaceSrc,
    projectList: projectList, fmtTime: fmtTime, exportName: exportName,
    kfAt: kfAt, kfSet: kfSet, kfSplit: kfSplit, kfProps: kfProps, MAX_KEYS: MAX_KEYS,
    parseCube: parseCube, lutPixels: lutPixels, srcTime: srcTime,
    parseSrt: parseSrt, toSrt: toSrt, addSubtitles: addSubtitles, freezeAt: freezeAt, SUB_BOX: SUB_BOX, DUCK_RAMP: DUCK_RAMP,
    hasRamp: hasRamp, fwdPos: fwdPos, fwdLocal: fwdLocal, rateAt: rateAt, srAt: srAt, srSet: srSet, rampPreset: rampPreset,
    RAMPS: Object.keys(RAMPS), SR_MIN: SR_MIN, SR_MAX: SR_MAX, MAX_SR: MAX_SR, srcPieces: srcPieces, trimSrc: trimSrc,
    chromaKey: chromaKey, ckParams: ckParams, fcAt: fcAt, fcSet: fcSet, MAX_FC: MAX_FC, mediaTime: mediaTime, uvOf: uvOf, shownPoint: shownPoint
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MontageCore = api;
})(typeof window !== "undefined" ? window : this);
