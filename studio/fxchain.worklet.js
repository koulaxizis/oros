// ============================================================
// orOS Studio — effect chain processor "studio-fx-chain" (v1.0.0)
// Studio's own AudioWorklet processor for a chain of NULL JSFX effects.
// It speaks the same messages as NULL JSFX's "null-fx-chain"
// (nullfx/runtime/null-worklet.js, MIT License, driven through
// nullfx/runtime/null-node.js) and runs the same effects through the
// runtime's public API (NULLFXHost.Effect, NULLRT, NULLFX), plus two
// things Studio needs that the generic processor does not do:
//   - key inputs: input 0 is the track; inputs 1..8 are key signals.
//     A slot with { key: n } gets input n on its extra pins (Sidechain
//     Ducker's "Sidechain Left/Right"); other slots get silence there.
//   - automation: AudioParams a0..a15 (k-rate). Message "auto" maps
//     param k to a slider { k, uid, i, inc, min, max }; at each block
//     a mapped param whose value changed moves that slider. Because the
//     values are scheduled on AudioParams, an offline export plays the
//     automation at the very same samples as playback does.
// Lives in studio/ (not studio/nullfx/, which the sync workflow owns).
// Load eel-rt.js, null-fx.js and the effect files first.
// ============================================================
/* global AudioWorkletProcessor, registerProcessor, sampleRate, NULLRT, NULLFXHost, NULLFX */
(function () {
  "use strict";
  var BLOCK = 128, PARAMS = 16, UNSET = -3e38, KEYS = 8;

  class StudioFxChain extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      var out = [];
      for (var k = 0; k < PARAMS; k++) out.push({ name: "a" + k, defaultValue: UNSET, minValue: UNSET, maxValue: 3e38, automationRate: "k-rate" });
      return out;
    }
    constructor(options) {
      super();
      var self = this, o = (options && options.processorOptions) || {};
      this.slots = [];
      this.time = { tempo: 120, playing: false, position: 0, beat: 0, num: 4, denom: 4 };
      this.timeDirty = true;
      this.a = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
      this.zero = new Float32Array(BLOCK);
      this.keyBufs = [];
      for (var k = 0; k <= KEYS; k++) this.keyBufs.push([new Float32Array(BLOCK), new Float32Array(BLOCK)]);
      this.map = [];
      this.last = new Float64Array(PARAMS).fill(NaN);
      this.lastPdc = -1;
      this.port.onmessage = function (e) { self.onMessage(e.data); };
      if (o.time) this.setTime(o.time);
      if (o.chain) this.setChain(o.chain);
      if (o.auto) this.setAuto(o.auto);
    }
  }
  var P = StudioFxChain.prototype;

  P.post = function (m) { this.port.postMessage(m); };
  P.onMessage = function (m) {
    if (!m || typeof m !== "object") return;
    var s = m.uid != null ? this.find(m.uid) : null;
    switch (m.type) {
      case "chain": this.setChain(m.chain || []); break;
      case "slider": if (s) s.fx.setSlider(m.i, +m.v); break;
      case "bypass": if (s) s.bypass = !!m.on; break;
      case "time": this.setTime(m); break;
      case "auto": this.setAuto(m.map || []); break;
      case "file":
        if (s && m.data) {
          s.fx.files["slider" + m.i] = { channels: m.channels | 0, srate: +m.srate, data: m.data };
          s.fx.setSlider(m.i, +m.v);
        }
        break;
      case "peek": if (s) this.peek(s, m.req); break;
    }
  };
  P.find = function (uid) {
    for (var i = 0; i < this.slots.length; i++) if (this.slots[i].uid === uid) return this.slots[i];
    return null;
  };
  // [{ uid, id, sliders, bypass, key }]: slots that keep their uid and effect keep their state
  P.setChain = function (list) {
    var old = {}, self = this;
    this.slots.forEach(function (s) { old[s.uid] = s; });
    var next = [];
    list.forEach(function (it) {
      var s = old[it.uid];
      if (!s || s.id !== it.id) s = self.make(it);
      if (!s) return;
      s.bypass = !!it.bypass;
      s.key = it.key > 0 && it.key <= KEYS ? it.key | 0 : 0;
      next.push(s);
    });
    this.slots = next;
    this.reportPdc();
  };
  P.make = function (it) {
    var FX = typeof NULLFX !== "undefined" ? NULLFX[it.id] : null;
    if (!FX) { this.post({ type: "missing", uid: it.uid, id: it.id }); return null; }
    var fx;
    try {
      fx = new NULLFXHost.Effect(FX, NULLRT, { srate: sampleRate, blockSize: BLOCK, sliders: it.sliders || {}, playing: this.time.playing });
    } catch (e) {
      this.post({ type: "error", uid: it.uid, id: it.id, message: String(e && e.message || e) });
      return null;
    }
    return { uid: it.uid, id: it.id, FX: FX, fx: fx, bypass: false, key: 0, pins: FX.inPins.length };
  };
  // [{ k, uid, i, inc, min, max }]
  P.setAuto = function (map) {
    this.map = [];
    for (var j = 0; j < map.length && j < PARAMS; j++) {
      var m = map[j];
      if (!m || !(m.k >= 0 && m.k < PARAMS)) continue;
      this.map.push({ k: m.k | 0, uid: m.uid, i: m.i | 0, inc: +m.inc || 0, min: +m.min, max: +m.max });
    }
    this.last.fill(NaN);
  };
  P.setTime = function (t) {
    var T = this.time;
    if (t.tempo > 0) T.tempo = +t.tempo;
    if (t.num > 0) T.num = +t.num;
    if (t.denom > 0) T.denom = +t.denom;
    if (t.position != null) { T.position = +t.position; T.beat = T.position * T.tempo / 60; }
    if (t.playing != null) T.playing = !!t.playing;
    this.timeDirty = true;
  };
  P.peek = function (s, req) {
    var inst = s.fx.inst, live = new Float64Array(s.FX.live.length);
    inst.getLive(live);
    var msg = { type: "live", uid: s.uid, req: req, live: live };
    if (s.FX.vars && s.FX.vars.indexOf("ng_tb") >= 0) {
      var base = inst.getVar("ng_tb"), len = inst.getVar("ng_tl") * 2;
      if (base > 0 && len > 0 && len <= 65536) msg.mem = { base: base, data: inst.mem.read(base, len) };
    }
    this.post(msg);
  };
  P.reportPdc = function () {
    var total = 0;
    for (var i = 0; i < this.slots.length; i++) if (!this.slots[i].bypass) total += this.slots[i].fx.pdc();
    if (total !== this.lastPdc) { this.lastPdc = total; this.post({ type: "pdc", samples: total }); }
  };
  // automation: move the mapped sliders whose param changed
  P.applyAuto = function (params) {
    for (var j = 0; j < this.map.length; j++) {
      var m = this.map[j], arr = params["a" + m.k];
      if (!arr || !arr.length) continue;
      var v = arr[0];
      if (!(v > UNSET / 2) || v === this.last[m.k]) continue;
      this.last[m.k] = v;
      if (m.inc > 0) v = m.min + Math.round((v - m.min) / m.inc) * m.inc;
      if (m.max >= m.min) v = Math.max(m.min, Math.min(m.max, v));
      else v = Math.max(m.max, Math.min(m.min, v));
      var s = this.find(m.uid);
      if (s) s.fx.setSlider(m.i, v);
    }
  };

  P.process = function (inputs, outputs, params) {
    var inp = inputs[0] || [], out = outputs[0] || [];
    var n = out[0] ? out[0].length : BLOCK;
    var a0 = this.a[0], a1 = this.a[1], i, k;
    var l = inp[0], r = inp[1] || inp[0];
    if (l) { for (i = 0; i < n; i++) { a0[i] = l[i]; a1[i] = r[i]; } }
    else { a0.fill(0); a1.fill(0); }
    // key inputs, copied so an effect cannot change them for another
    for (k = 1; k <= KEYS; k++) {
      var kin = inputs[k] || [], kb = this.keyBufs[k];
      if (kin[0]) { kb[0].set(kin[0]); kb[1].set(kin[1] || kin[0]); }
      else { kb[0].fill(0); kb[1].fill(0); }
    }
    if (params) this.applyAuto(params);
    var T = this.time;
    for (var j = 0; j < this.slots.length; j++) {
      var s = this.slots[j];
      if (s.bypass) continue;
      if (this.timeDirty || T.playing) s.fx.setTime(T);
      var ins = [a0, a1], nin = 2;
      if (s.pins > 2) {
        var kk = this.keyBufs[s.key] || this.keyBufs[0];
        if (!s.key) { kk[0].fill(0); kk[1].fill(0); }
        ins.push(kk[0], kk[1]);
        for (var q = 4; q < s.pins; q++) ins.push(this.zero);
        nin = s.pins;
      }
      try {
        s.fx.process(ins, this.a, n, nin);
      } catch (e) {
        s.bypass = true;
        this.post({ type: "error", uid: s.uid, id: s.id, message: String(e && e.message || e) });
      }
    }
    this.timeDirty = false;
    if (T.playing) { T.position += n / sampleRate; T.beat = T.position * T.tempo / 60; }
    if (out[0]) out[0].set(n === BLOCK ? a0 : a0.subarray(0, n));
    if (out[1]) out[1].set(n === BLOCK ? a1 : a1.subarray(0, n));
    for (i = 2; i < out.length; i++) out[i].fill(0);
    this.reportPdc();
    return true;
  };

  registerProcessor("studio-fx-chain", StudioFxChain);
})();
