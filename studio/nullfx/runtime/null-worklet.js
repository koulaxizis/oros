// AudioWorklet processor "null-fx-chain": a chain of translated NULL JSFX effects (MIT
// License). Load eel-rt.js, null-fx.js, the effect files and then this file with
// audioWorklet.addModule() (null-node.js does it), and drive it from the page through
// null-node.js. Input and output are stereo; effects process in place, one after another.
/* global AudioWorkletProcessor, registerProcessor, sampleRate, NULLRT, NULLFXHost, NULLFX */
(function () {
  "use strict";
  var BLOCK = 128;

  class NullFxChain extends AudioWorkletProcessor {
    constructor(options) {
      super();
      var self = this, o = (options && options.processorOptions) || {};
      this.slots = [];
      this.time = { tempo: 120, playing: false, position: 0, beat: 0, num: 4, denom: 4 };
      this.timeDirty = true;
      this.a = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
      this.zero = new Float32Array(BLOCK);
      this.lastPdc = -1;
      this.port.onmessage = function (e) { self.onMessage(e.data); };
      if (o.time) this.setTime(o.time);
      if (o.chain) this.setChain(o.chain);
    }
  }

  NullFxChain.prototype.post = function (m) { this.port.postMessage(m); };

  NullFxChain.prototype.onMessage = function (m) {
    if (!m || typeof m !== "object") return;
    var s = m.uid != null ? this.find(m.uid) : null;
    switch (m.type) {
      case "chain": this.setChain(m.chain || []); break;
      case "slider": if (s) s.fx.setSlider(m.i, +m.v); break;
      case "bypass": if (s) s.bypass = !!m.on; break;
      case "time": this.setTime(m); break;
      case "file":
        // a decoded audio file for a file slider (Convolution's IR): channels, srate, data
        // (interleaved); the slider gets a new value so the effect reloads it
        if (s && m.data) {
          s.fx.files["slider" + m.i] = { channels: m.channels | 0, srate: +m.srate, data: m.data };
          s.fx.setSlider(m.i, +m.v);
        }
        break;
      case "peek": if (s) this.peek(s, m.req); break;
    }
  };

  NullFxChain.prototype.find = function (uid) {
    for (var i = 0; i < this.slots.length; i++) if (this.slots[i].uid === uid) return this.slots[i];
    return null;
  };

  // chain: [{ uid, id, sliders: { index: value }, bypass }]; slots that keep their uid and
  // effect keep their state (a reorder does not reset reverb tails)
  NullFxChain.prototype.setChain = function (list) {
    var old = {}, self = this;
    this.slots.forEach(function (s) { old[s.uid] = s; });
    var next = [];
    list.forEach(function (it) {
      var s = old[it.uid];
      if (!s || s.id !== it.id) s = self.make(it);
      if (!s) return;
      s.bypass = !!it.bypass;
      next.push(s);
    });
    this.slots = next;
    this.reportPdc();
  };

  NullFxChain.prototype.make = function (it) {
    var FX = typeof NULLFX !== "undefined" ? NULLFX[it.id] : null;
    if (!FX) { this.post({ type: "missing", uid: it.uid, id: it.id }); return null; }
    var fx;
    try {
      fx = new NULLFXHost.Effect(FX, NULLRT, { srate: sampleRate, blockSize: BLOCK, sliders: it.sliders || {}, playing: this.time.playing });
    } catch (e) {
      this.post({ type: "error", uid: it.uid, id: it.id, message: String(e && e.message || e) });
      return null;
    }
    // extra input pins (Sidechain Ducker's key input) get silence for now
    var ins = [this.a[0], this.a[1]];
    for (var k = 2; k < FX.inPins.length; k++) ins.push(this.zero);
    return { uid: it.uid, id: it.id, FX: FX, fx: fx, bypass: false, ins: ins };
  };

  NullFxChain.prototype.setTime = function (t) {
    var T = this.time;
    if (t.tempo > 0) T.tempo = +t.tempo;
    if (t.num > 0) T.num = +t.num;
    if (t.denom > 0) T.denom = +t.denom;
    if (t.position != null) { T.position = +t.position; T.beat = T.position * T.tempo / 60; }
    if (t.playing != null) T.playing = !!t.playing;
    this.timeDirty = true;
  };

  // live variables for the page's @gfx mirror, plus the scope tap memory of the NULL GFX library
  NullFxChain.prototype.peek = function (s, req) {
    var inst = s.fx.inst, live = new Float64Array(s.FX.live.length);
    inst.getLive(live);
    var msg = { type: "live", uid: s.uid, req: req, live: live };
    if (s.FX.vars && s.FX.vars.indexOf("ng_tb") >= 0) {
      var base = inst.getVar("ng_tb"), len = inst.getVar("ng_tl") * 2;
      if (base > 0 && len > 0 && len <= 65536) msg.mem = { base: base, data: inst.mem.read(base, len) };
    }
    this.post(msg);
  };

  NullFxChain.prototype.reportPdc = function () {
    var total = 0;
    for (var i = 0; i < this.slots.length; i++) if (!this.slots[i].bypass) total += this.slots[i].fx.pdc();
    if (total !== this.lastPdc) { this.lastPdc = total; this.post({ type: "pdc", samples: total }); }
  };

  NullFxChain.prototype.process = function (inputs, outputs) {
    var inp = inputs[0] || [], out = outputs[0] || [];
    var n = out[0] ? out[0].length : BLOCK;
    var a0 = this.a[0], a1 = this.a[1], i;
    var l = inp[0], r = inp[1] || inp[0];
    if (l) { for (i = 0; i < n; i++) { a0[i] = l[i]; a1[i] = r[i]; } }
    else { a0.fill(0); a1.fill(0); }
    var T = this.time;
    for (var k = 0; k < this.slots.length; k++) {
      var s = this.slots[k];
      if (s.bypass) continue;
      if (this.timeDirty || T.playing) s.fx.setTime(T);
      try {
        s.fx.process(s.ins, this.a, n, 2);
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

  registerProcessor("null-fx-chain", NullFxChain);
})();
