// ============================================================
// orOS Studio — loudness and level meter (studio/meter.js, v1.0.0)
// Pure code, no DOM, no Web Audio: the same numbers in the live master
// meter (meter.worklet.js), in "Measure the song / a file", in the
// reference comparison and in the audiobook checks (ACX, Storytel).
//
//   new Meter(srate, channels)   ITU-R BS.1770-4 / EBU R128 loudness,
//     exactly as NULL Loudness Meter (null-jsfx loudness_meter.jsfx)
//     computes it, in doubles and in the same order:
//       K-weighting (high shelf + high pass, re-derived for srate),
//       100 ms sub-blocks of the summed channel energies,
//       momentary = last 400 ms, short-term = last 3 s, every 100 ms,
//       integrated = 400 ms blocks every 100 ms, gated at -70 LUFS and
//         -10 LU below their mean (0.01 LU histograms: constant memory
//         for hours),
//       loudness range (EBU Tech 3342) = 95th - 10th percentile of the
//         short-term values, gated at -70 LUFS and -20 LU,
//       sample peak and true peak (4x, BS.1770-4 Annex 2 interpolator).
//     .push(chans, n, off) feeds samples (chans = arrays per channel);
//     .read() → { m, s, i, lra, mmax, smax, tp, sp } (LUFS / LU; peaks
//     linear, 0 = none); .reset() clears what NULL's Reset clears.
//   new Levels(srate, channels)  what ACX-style checks need, unweighted:
//     RMS of the whole file, noise floor (the quietest 500 ms that is
//     not digital silence), room tone at the head and tail, the longest
//     run of digital silence, DC offset, clipped samples.
//   analyse(chans, srate)        both over a whole buffer → report;
//   new Analysis(chans, srate)   the same a slice at a time (.step(n)).
//   check(report, specId)        a report against ACX / Storytel →
//     [{ k, ok, v, lo?, hi? }] (dB, seconds).
//   platform(report, id)         what a streaming service does to it.
// Loaded by studio.js (window.StudioMeter), by meter.worklet.js after
// it in the AudioWorklet scope, and by the tests.
// ============================================================
(function (root) {
  "use strict";

  var NB = 9000;                 // histogram bins: 0.01 LU from -70 LUFS
  var HIST = 3000;               // 100 ms values kept for the live graph (5 min)
  // BS.1770-4 Annex 2 true-peak interpolator: phases 0 and 1; 2 and 3 are 1 and 0 reversed
  var TP_HALF = [0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625,
    0.9721679687500, -0.1022949218750, 0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500,
    -0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250, -0.1665039062500, 0.4650878906250,
    0.7797851562500, -0.2003173828125, 0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375];
  var TPC = new Float64Array(48);
  (function () { for (var i = 0; i < 48; i++) TPC[i] = i < 24 ? TP_HALF[i] : TP_HALF[47 - i]; })();

  // loudness of a mean-square energy, -200 for silence
  function lufs(p) { return p > 0 ? -0.691 + 10 * Math.log10(p) : -200; }
  function db(x) { return x > 0 ? 20 * Math.log10(x) : -Infinity; }

  // K-weighting coefficients at this sample rate (as libebur128 and NULL)
  function kweights(sr) {
    var k = Math.tan(Math.PI * 1681.974450955533 / sr);
    var vh = Math.pow(10, 3.999843853973347 / 20), vb = Math.pow(vh, 0.4996667741545416), q = 0.7071752369554196;
    var a0 = 1 + k / q + k * k;
    var w = {
      b0: (vh + vb * k / q + k * k) / a0, b1: 2 * (k * k - vh) / a0, b2: (vh - vb * k / q + k * k) / a0,
      a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0
    };
    k = Math.tan(Math.PI * 38.13547087602444 / sr);
    q = 0.5003270373238773;
    var c0 = 1 + k / q + k * k;
    w.c1 = 2 * (k * k - 1) / c0;
    w.c2 = (1 - k / q + k * k) / c0;
    return w;
  }

  function Meter(srate, channels) {
    this.sr = srate;
    this.ch = Math.max(1, Math.min(2, channels | 0 || 2));
    this.w = kweights(srate);
    this.z = new Float64Array(8);              // 4 filter states per channel
    this.x = new Float64Array(48);             // true-peak history, 24 per channel (12, mirrored)
    this.tw = 0;
    this.n = Math.floor(srate * 0.1 + 0.5);    // samples per 100 ms sub-block
    this.sb = new Float64Array(30);
    this.ic = new Float64Array(NB); this.ie = new Float64Array(NB); this.rc = new Float64Array(NB);
    this.hs = new Float64Array(HIST); this.hm = new Float64Array(HIST);
    this.acc = 0; this.cnt = 0; this.sbw = 0;
    this.m = -200; this.s = -200;
    this.reset();
  }
  // clears integrated, LRA, maxima and the history (momentary and short-term keep running)
  Meter.prototype.reset = function () {
    this.ic.fill(0); this.ie.fill(0); this.rc.fill(0);
    this.blocks = 0;
    this.absSum = 0; this.absN = 0; this.ihi = 0;
    this.stSum = 0; this.stN = 0; this.rhi = 0;
    this.int = -200; this.lra = 0;
    this.mmax = -200; this.smax = -200;
    this.tpmax = 0; this.spmax = 0;
    this.hw = 0; this.hn = 0;
  };
  Meter.prototype.subblock = function () {
    var k, s, b, rel, sum, cnt, n, lo, hi, cum, ilo, ihi, i;
    this.sb[this.sbw] = this.acc;
    this.acc = 0;
    this.sbw += 1;
    if (this.sbw >= 30) this.sbw = 0;
    this.blocks += 1;
    // newest sub-block first: 4 for momentary, 30 for short-term
    s = 0; k = this.sbw;
    for (i = 0; i < 4; i++) { k -= 1; if (k < 0) k += 30; s += this.sb[k]; }
    var mp = s / (4 * this.n);
    for (i = 0; i < 26; i++) { k -= 1; if (k < 0) k += 30; s += this.sb[k]; }
    var stp = s / (30 * this.n);
    this.m = lufs(mp);
    this.s = lufs(stp);
    // integrated: a 400 ms gating block every 100 ms
    if (this.blocks >= 4 && this.m > -70) {
      b = Math.min(NB - 1, Math.floor((this.m + 70) * 100));
      this.ic[b] += 1;
      this.ie[b] += mp;
      if (b >= this.ihi) this.ihi = b + 1;
      this.absSum += mp;
      this.absN += 1;
      rel = lufs(this.absSum / this.absN) - 10;
      b = Math.max(0, Math.floor((rel + 70) * 100));
      sum = 0; cnt = 0;
      while (b < this.ihi) { sum += this.ie[b]; cnt += this.ic[b]; b += 1; }
      this.int = cnt > 0 ? lufs(sum / cnt) : -200;
    }
    // loudness range: the short-term value every 100 ms once 3 s have been measured
    if (this.blocks >= 30 && this.s > -70) {
      b = Math.min(NB - 1, Math.floor((this.s + 70) * 100));
      this.rc[b] += 1;
      if (b >= this.rhi) this.rhi = b + 1;
      this.stSum += stp;
      this.stN += 1;
      rel = lufs(this.stSum / this.stN) - 20;
      b = Math.max(0, Math.floor((rel + 70) * 100));
      n = 0;
      for (k = b; k < this.rhi; k++) n += this.rc[k];
      if (n > 0) {
        lo = Math.floor((n - 1) * 0.1 + 0.5);
        hi = Math.floor((n - 1) * 0.95 + 0.5);
        cum = 0; ilo = -1; ihi = -1;
        for (k = b; k < this.rhi && ihi < 0; k++) {
          cum += this.rc[k];
          if (ilo < 0 && cum > lo) ilo = k;
          if (ihi < 0 && cum > hi) ihi = k;
        }
        this.lra = (ihi - ilo) / 100;
      }
    }
    if (this.m > this.mmax) this.mmax = this.m;
    if (this.s > this.smax) this.smax = this.s;
    this.hs[this.hw] = this.s;
    this.hm[this.hw] = this.m;
    this.hw += 1;
    if (this.hw >= HIST) this.hw = 0;
    this.hn = Math.min(HIST, this.hn + 1);
  };
  // chans: one array per channel (a mono meter reads chans[0]; a stereo
  // meter given one channel reads silence on the right, as NULL would)
  Meter.prototype.push = function (chans, n, off) {
    off = off | 0;
    if (n == null) n = chans[0].length - off;
    var w = this.w, z = this.z, X = this.x, two = this.ch === 2;
    var L = chans[0], R = two ? (chans[1] || null) : null;
    for (var i = 0; i < n; i++) {
      var l = L[off + i], r = R ? R[off + i] : 0;
      // K-weighting, transposed direct form II: shelf (b, a) then high pass (1, -2, 1 / c)
      var y = w.b0 * l + z[0];
      z[0] = w.b1 * l - w.a1 * y + z[1];
      z[1] = w.b2 * l - w.a2 * y;
      var kl = y + z[2];
      z[2] = -2 * y - w.c1 * kl + z[3];
      z[3] = y - w.c2 * kl;
      var e = kl * kl;
      if (two) {
        y = w.b0 * r + z[4];
        z[4] = w.b1 * r - w.a1 * y + z[5];
        z[5] = w.b2 * r - w.a2 * y;
        var kr = y + z[6];
        z[6] = -2 * y - w.c1 * kr + z[7];
        z[7] = y - w.c2 * kr;
        e += kr * kr;
      }
      this.acc += e;
      // sample peak and true peak (newest input at tw, mirrored 12 slots on)
      this.tw -= 1;
      if (this.tw < 0) this.tw = 11;
      var tw = this.tw;
      X[tw] = X[tw + 12] = l;
      X[24 + tw] = X[24 + tw + 12] = r;
      var pk = Math.max(Math.abs(l), Math.abs(r));
      if (pk > this.spmax) this.spmax = pk;
      for (var ph = 0; ph < 48; ph += 12) {
        var al = 0, ar = 0;
        for (var j = 0; j < 12; j++) {
          al += TPC[ph + j] * X[tw + j];
          ar += TPC[ph + j] * X[24 + tw + j];
        }
        pk = Math.max(pk, Math.max(Math.abs(al), Math.abs(ar)));
      }
      if (pk > this.tpmax) this.tpmax = pk;
      this.cnt += 1;
      if (this.cnt >= this.n) { this.cnt = 0; this.subblock(); }
    }
  };
  Meter.prototype.read = function () {
    return { m: this.m, s: this.s, i: this.int, lra: this.lra, mmax: this.mmax, smax: this.smax, tp: this.tpmax, sp: this.spmax };
  };
  // the last `count` short-term (or momentary) values, oldest first
  Meter.prototype.history = function (count, which) {
    var h = which === "m" ? this.hm : this.hs, n = Math.min(count | 0, this.hn), out = new Float64Array(n);
    for (var i = 0; i < n; i++) { var k = this.hw - n + i; if (k < 0) k += HIST; out[i] = h[k]; }
    return out;
  };

  // ---------- Levels: unweighted, for ACX-style checks ----------
  var LB = 0.01;                 // seconds per level block
  var WIN = 50;                  // blocks in the noise-floor window (500 ms)
  var SIL = 1e-12;               // below this a block is digital silence (exact zeros)
  var CLIP = 0.999;              // |sample| at or above this counts as clipped
  function Levels(srate, channels) {
    this.sr = srate;
    this.ch = Math.max(1, channels | 0 || 1);
    this.bn = Math.max(1, Math.round(srate * LB));
    this.blocks = [];            // mean square per block (channels averaged)
    this.acc = 0; this.cnt = 0;
    this.total = 0; this.frames = 0;
    this.dc = new Float64Array(this.ch);
    this.clip = 0;
    this.zrun = 0; this.zmax = 0;
  }
  Levels.prototype.push = function (chans, n, off) {
    off = off | 0;
    if (n == null) n = chans[0].length - off;
    var ch = this.ch;
    for (var i = 0; i < n; i++) {
      var e = 0, zero = true;
      for (var c = 0; c < ch; c++) {
        var v = chans[c] ? chans[c][off + i] : 0;
        e += v * v;
        this.dc[c] += v;
        if (v !== 0) zero = false;
        if (v >= CLIP || v <= -CLIP) this.clip++;
      }
      e /= ch;
      this.acc += e; this.total += e;
      if (zero) { this.zrun++; if (this.zrun > this.zmax) this.zmax = this.zrun; } else this.zrun = 0;
      this.cnt++;
      if (this.cnt >= this.bn) { this.blocks.push(this.acc / this.cnt); this.acc = 0; this.cnt = 0; }
    }
    this.frames += n;
  };
  Levels.prototype.read = function () {
    var bl = this.blocks.slice();
    if (this.cnt) bl.push(this.acc / this.cnt);
    var nb = bl.length, sr = this.sr;
    var rms = this.frames ? db(Math.sqrt(this.total / this.frames)) : -Infinity;
    // noise floor: the quietest 500 ms window that is not digital silence
    var floor = Infinity, sum = 0, zeros = 0, w = Math.min(WIN, nb);
    for (var i = 0; i < nb; i++) {
      sum += bl[i]; if (bl[i] < SIL) zeros++;
      if (i >= w) { sum -= bl[i - w]; if (bl[i - w] < SIL) zeros--; }
      if (i >= w - 1 && zeros < w) {
        var e = sum / w;
        if (e > 0 && e < floor) floor = e;
      }
    }
    var floorDb = floor === Infinity ? -Infinity : db(Math.sqrt(floor));
    // room tone: how long the file stays near its floor at each end
    var thr = Math.max(isFinite(floorDb) ? floorDb + 15 : -50, -50), thrE = Math.pow(10, thr / 10);
    var head = 0, tail = 0;
    while (head < nb && bl[head] < thrE) head++;
    while (tail < nb - head && bl[nb - 1 - tail] < thrE) tail++;
    var dc = 0;
    for (var c = 0; c < this.ch; c++) dc = Math.max(dc, Math.abs(this.frames ? this.dc[c] / this.frames : 0));
    return {
      dur: this.frames / sr, rms: rms, floor: floorDb,
      head: head * this.bn / sr, tail: tail * this.bn / sr, voice: head < nb,
      zero: this.zmax / sr, dc: db(dc), clip: this.clip
    };
  };

  // ---------- A whole buffer ----------
  // Analysis a slice at a time, so a page stays responsive:
  //   var A = new Analysis(chans, srate); while (!A.step(frames)) …; A.result()
  function Analysis(chans, srate) {
    this.chans = chans; this.sr = srate; this.n = chans[0].length; this.o = 0;
    this.M = new Meter(srate, Math.min(2, chans.length));
    this.L = new Levels(srate, chans.length);
  }
  Analysis.prototype.step = function (frames) {
    var k = Math.min(frames || 65536, this.n - this.o);
    if (k > 0) { this.M.push(this.chans, k, this.o); this.L.push(this.chans, k, this.o); this.o += k; }
    return this.o >= this.n;
  };
  Analysis.prototype.progress = function () { return this.n ? this.o / this.n : 1; };
  Analysis.prototype.result = function () {
    var a = this.M.read(), b = this.L.read();
    return {
      srate: this.sr, ch: this.chans.length, dur: b.dur,
      i: a.i, lra: a.lra, mmax: a.mmax, smax: a.smax, tp: db(a.tp), sp: db(a.sp),
      rms: b.rms, floor: b.floor, head: b.head, tail: b.tail, voice: b.voice,
      zero: b.zero, dc: b.dc, clip: b.clip
    };
  };
  // chans: Float32Array (or Float64Array) per channel → the full report
  function analyse(chans, srate) {
    var A = new Analysis(chans, srate);
    while (!A.step(65536)) {}
    return A.result();
  }

  // ---------- Targets ----------
  // Streaming services play every track at about their own loudness:
  // up = whether they raise a quiet track (limited: only while the true
  // peak stays at or under tp).
  var PLATFORMS = [
    { id: "spotify", name: "Spotify", i: -14, tp: -1, up: "limited" },
    { id: "apple", name: "Apple Music", i: -16, tp: -1, up: "yes" },
    { id: "youtube", name: "YouTube", i: -14, tp: -1, up: "no" },
    { id: "podcast", i: -16, tp: -1, up: "no" },
    { id: "ebu", name: "EBU R128", i: -23, tp: -1, up: "no" }
  ];
  // Audiobook specs (ACX's published numbers; Storytel publishes none,
  // so it starts from the same limits until the person enters theirs)
  var SPECS = {
    acx: { id: "acx", name: "ACX", rms: [-23, -18], peak: -3, floor: -60, head: [0.5, 1], tail: [1, 5], maxDur: 120 * 60, zero: 0.05 },
    storytel: { id: "storytel", name: "Storytel", rms: [-23, -18], peak: -3, floor: -60, head: [0.5, 1], tail: [1, 5], maxDur: 120 * 60, zero: 0.05 }
  };
  function platform(rep, id) {
    var p = PLATFORMS.filter(function (x) { return x.id === id; })[0];
    if (!p || !(rep.i > -70)) return null;
    var g = p.i - rep.i;
    if (g > 0) {
      if (p.up === "no") g = 0;
      else if (p.up === "limited") g = Math.max(0, Math.min(g, p.tp - rep.tp));
    }
    return { id: p.id, target: p.i, tp: p.tp, gain: Math.round(g * 10) / 10, over: rep.tp > p.tp };
  }
  // the peak a check means: the true peak when it was measured, else the sample peak
  function check(rep, specId) {
    var s = SPECS[specId];
    if (!s) return [];
    var pk = isFinite(rep.tp) ? Math.max(rep.tp, rep.sp) : rep.sp;
    var out = [
      { k: "rms", v: rep.rms, lo: s.rms[0], hi: s.rms[1], ok: rep.rms >= s.rms[0] && rep.rms <= s.rms[1] },
      { k: "peak", v: pk, hi: s.peak, ok: !(pk > s.peak) },
      { k: "floor", v: rep.floor, hi: s.floor, ok: rep.floor <= s.floor },
      { k: "head", v: rep.head, lo: s.head[0], hi: s.head[1], ok: rep.head >= s.head[0] - 0.005 && rep.head <= s.head[1] + 0.005 },
      { k: "tail", v: rep.tail, lo: s.tail[0], hi: s.tail[1], ok: rep.tail >= s.tail[0] - 0.005 && rep.tail <= s.tail[1] + 0.005 },
      { k: "zero", v: rep.zero, hi: s.zero, ok: rep.zero <= s.zero },
      { k: "dur", v: rep.dur, hi: s.maxDur, ok: rep.dur <= s.maxDur },
      { k: "clip", v: rep.clip, hi: 0, ok: rep.clip === 0 }
    ];
    return out;
  }
  // the gain (dB) that brings the RMS to `to` (default the middle of the
  // spec's window), and whether the peak then still fits
  function gainFor(rep, specId, to) {
    var s = SPECS[specId];
    if (!s || !isFinite(rep.rms)) return null;
    var target = to == null ? (s.rms[0] + s.rms[1]) / 2 : to;
    var g = target - rep.rms;
    var pk = isFinite(rep.tp) ? Math.max(rep.tp, rep.sp) : rep.sp;
    return { gain: Math.round(g * 100) / 100, peak: pk + g, limit: pk + g > s.peak, floor: rep.floor + g, noisy: rep.floor + g > s.floor };
  }

  var api = {
    VERSION: "1.0.0", Meter: Meter, Levels: Levels, Analysis: Analysis, analyse: analyse, check: check, gainFor: gainFor,
    platform: platform, PLATFORMS: PLATFORMS, SPECS: SPECS, lufs: lufs, db: db, kweights: kweights, NB: NB
  };
  root.StudioMeter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
