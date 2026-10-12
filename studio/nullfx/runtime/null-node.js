// Page side of the "null-fx-chain" AudioWorklet (NULL JSFX, MIT License): loads the runtime
// and effect files into an AudioContext (or OfflineAudioContext) and wraps the node.
// Plain ES5 with Promises; registers globalThis.NULLFXNode.
//
//   NULLFXNode.load(ctx, "path/to/web/", ["reverb", "tilt"]).then(function () {
//     var chain = new NULLFXNode.Chain(ctx, { chain: [{ uid: "a", id: "reverb", sliders: { 1: 30 } }] });
//     source.connect(chain.node); chain.node.connect(ctx.destination);
//   });
(function (g) {
  "use strict";

  var loaded = typeof WeakMap !== "undefined" ? new WeakMap() : null;

  // base: the folder that holds runtime/ and fx/ (with a trailing slash)
  function load(ctx, base, ids) {
    var st = loaded && loaded.get(ctx);
    if (!st) {
      st = { fx: {}, core: null };
      st.core = ["runtime/eel-rt.js", "runtime/null-fx.js"].reduce(function (p, f) {
        return p.then(function () { return ctx.audioWorklet.addModule(base + f); });
      }, Promise.resolve());
      if (loaded) loaded.set(ctx, st);
    }
    var core = st.core;
    var parts = (ids || []).map(function (id) {
      if (!/^[a-z0-9_]+$/.test(id)) return Promise.reject(new Error("bad effect id " + id));
      if (!st.fx[id]) st.fx[id] = core.then(function () { return ctx.audioWorklet.addModule(base + "fx/" + id + ".js"); });
      return st.fx[id];
    });
    if (!st.proc) st.proc = core.then(function () { return ctx.audioWorklet.addModule(base + "runtime/null-worklet.js"); });
    return Promise.all(parts.concat([st.proc]));
  }

  // opts: { chain: [{ uid, id, sliders, bypass }], time: { tempo, playing, position } }
  function Chain(ctx, opts) {
    opts = opts || {};
    var self = this;
    this.ctx = ctx;
    this.node = new AudioWorkletNode(ctx, "null-fx-chain", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers",
      processorOptions: { chain: opts.chain || [], time: opts.time || null }
    });
    this.pdc = 0;
    this.waiting = {};
    this.req = 0;
    this.onpdc = null; this.onerror = null; this.onmissing = null;
    this.node.port.onmessage = function (e) {
      var m = e.data || {};
      if (m.type === "pdc") { self.pdc = m.samples; if (self.onpdc) self.onpdc(m.samples); }
      else if (m.type === "live") { var w = self.waiting[m.req]; if (w) { delete self.waiting[m.req]; w(m); } }
      else if (m.type === "error") { if (self.onerror) self.onerror(m); }
      else if (m.type === "missing") { if (self.onmissing) self.onmissing(m); }
    };
  }
  Chain.prototype.send = function (m) { this.node.port.postMessage(m); };
  Chain.prototype.setChain = function (chain) { this.send({ type: "chain", chain: chain }); };
  Chain.prototype.setSlider = function (uid, i, v) { this.send({ type: "slider", uid: uid, i: i, v: v }); };
  Chain.prototype.setBypass = function (uid, on) { this.send({ type: "bypass", uid: uid, on: !!on }); };
  // { tempo, playing, position (seconds), num, denom }
  Chain.prototype.setTime = function (t) { var m = { type: "time" }; for (var k in t) m[k] = t[k]; this.send(m); };
  // an AudioBuffer for a file slider (Convolution's IR File); v: the new slider value
  Chain.prototype.setFile = function (uid, i, v, buf) {
    var ch = buf.numberOfChannels, n = buf.length, data = new Float64Array(n * ch);
    for (var c = 0; c < ch; c++) { var src = buf.getChannelData(c); for (var j = 0; j < n; j++) data[j * ch + c] = src[j]; }
    this.node.port.postMessage({ type: "file", uid: uid, i: i, v: v, channels: ch, srate: buf.sampleRate, data: data }, [data.buffer]);
  };
  // resolves with { live: Float64Array, mem?: { base, data } } for the @gfx mirror
  Chain.prototype.peek = function (uid) {
    var self = this, req = ++this.req;
    return new Promise(function (res) { self.waiting[req] = res; self.send({ type: "peek", uid: uid, req: req }); });
  };
  Chain.prototype.disconnect = function () { try { this.node.disconnect(); } catch (e) { /* not connected */ } this.node.port.onmessage = null; };

  var API = { load: load, Chain: Chain };
  g.NULLFXNode = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
