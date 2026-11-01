// ============================================================
// orOS Studio — effect chain processor "studio-fx-chain" (v1.1.0)
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
//   - instruments (NULL Drum Machine): like null-fx-chain, MIDI and
//     transport changes scheduled on the audio clock (NULLFXHost.Sched,
//     messages "midi" and "time" with at), the plugin's own state
//     ("state", item.state) and its interface's pokes ("vars"); an
//     export hands its MIDI and transport over in processorOptions.
//   - MIDI effects (Arpeggiator, Chords...) sit before the instrument:
//     the block's MIDI goes through the slots in order, and what a slot
//     that uses MIDI sends (midisend) is what the next slots receive.
//   - sliders the effect moves itself (sliderchange()/slider_automate()
//     in @slider, @block or @sample, e.g. an Assisted effect's Learn
//     writing its result): message "sliders" { uid, v: { i: value } }
//     tells the page, at most every FLUSH blocks, and only for values
//     that differ from what the page, a key or automation last set.
// Lives in studio/ (not studio/nullfx/, which the sync workflow owns).
// Load eel-rt.js, null-fx.js and the effect files first.
// ============================================================
/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentTime, NULLRT, NULLFXHost, NULLFX */
(function () {
  "use strict";
  var BLOCK = 128, PARAMS = 16, UNSET = -3e38, KEYS = 8, FLUSH = 16;

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
      this.blocks = 0;
      this.sched = new NULLFXHost.Sched();
      this.port.onmessage = function (e) { self.onMessage(e.data); };
      if (o.time) this.setTime(o.time);
      if (o.chain) this.setChain(o.chain);
      if (o.auto) this.setAuto(o.auto);
      if (o.midi) this.sched.addMidi(o.midi);
      if (o.times) o.times.forEach(function (t) { self.sched.addTime(t); });
    }
  }
  var P = StudioFxChain.prototype;
  // a block's MIDI [[offset, status, d1, d2]] in time order (stable: same offset keeps the order sent)
  function sortMidi(list) {
    for (var i = 1; i < list.length; i++) {
      var e = list[i], k = i;
      while (k > 0 && list[k - 1][0] > e[0]) { list[k] = list[k - 1]; k--; }
      list[k] = e;
    }
    return list;
  }

  P.post = function (m) { this.port.postMessage(m); };
  P.onMessage = function (m) {
    if (!m || typeof m !== "object") return;
    var s = m.uid != null ? this.find(m.uid) : null;
    switch (m.type) {
      case "chain": this.setChain(m.chain || []); break;
      case "slider": if (s) this.setSl(s, m.i, +m.v); break;
      case "bypass": if (s) s.bypass = !!m.on; break;
      case "time": if (m.at >= 0) this.sched.addTime(m); else { if (m.playing === false) this.sched.clear(); this.setTime(m); } break;
      case "auto": this.setAuto(m.map || []); break;
      case "midi": if (Array.isArray(m.ev)) this.sched.addMidi(m.ev); break;
      case "midi-clear": this.sched.midi = []; break;
      case "state": if (s) s.fx.setState(m.data); break;
      case "vars":
        if (s && m.vars) (s.FX.pokes || []).forEach(function (k) { var v = m.vars[k]; if (typeof v === "number" && isFinite(v)) s.fx.inst.setVar(k, v); });
        break;
      case "file":
        if (s && m.data) {
          s.fx.files["slider" + m.i] = { channels: m.channels | 0, srate: +m.srate, data: m.data };
          this.setSl(s, m.i, +m.v);
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
      if (it.state) fx.setState(it.state);
    } catch (e) {
      this.post({ type: "error", uid: it.uid, id: it.id, message: String(e && e.message || e) });
      return null;
    }
    var known = {};
    FX.sliders.forEach(function (sl) { known[sl.i] = fx.inst.getSlider(sl.i); });
    return { uid: it.uid, id: it.id, FX: FX, fx: fx, bypass: false, key: 0, pins: FX.inPins.length, known: known, pend: 0 };
  };
  // a slider the page (or automation) sets: known, so it is not reported back
  P.setSl = function (s, i, v) {
    s.known[i] = v;
    s.fx.setSlider(i, v);
  };
  // the sliders the effects moved themselves since the last report
  P.reportSliders = function () {
    for (var j = 0; j < this.slots.length; j++) {
      var s = this.slots[j], mask = s.pend, v = null;
      if (!mask) continue;
      s.pend = 0;
      for (var q = 0; q < s.FX.sliders.length; q++) {
        var i = s.FX.sliders[q].i;
        if (!(mask & Math.pow(2, i - 1))) continue;
        var x = s.fx.inst.getSlider(i);
        if (x === s.known[i] || !isFinite(x)) continue;
        s.known[i] = x;
        (v || (v = {}))[i] = x;
      }
      if (v) this.post({ type: "sliders", uid: s.uid, v: v });
    }
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
    // memory the audio writes for the interface to fade (FX.flash): once, then cleared
    if (s.FX.flash) msg.flash = s.FX.flash.map(function (f) {
      var b = inst.getVar(f[0]), n = f[1] | 0;
      if (!(b >= 0) || n < 1 || n > 4096) return null;
      var d = inst.mem.read(b, n);
      inst.mem.write(b, new Float64Array(n));
      return { base: b, data: d };
    }).filter(Boolean);
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
      if (s) this.setSl(s, m.i, v);
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
    var due = this.sched.block(currentTime, n, sampleRate);
    if (due.time) this.setTime(due.time);
    var T = this.time, mid = due.midi;
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
        s.fx.process(ins, this.a, n, nin, s.FX.usesMidi ? mid : null);
        // what a MIDI effect sends goes on to the next slots (the instrument); the others pass it on
        if (s.FX.usesMidi) mid = sortMidi(s.fx.midiOut);
      } catch (e) {
        s.bypass = true;
        this.post({ type: "error", uid: s.uid, id: s.id, message: String(e && e.message || e) });
      }
      if (s.fx.changed) { s.pend |= s.fx.changed; s.fx.changed = 0; }
    }
    if (++this.blocks >= FLUSH) { this.blocks = 0; this.reportSliders(); }
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
