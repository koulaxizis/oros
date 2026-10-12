// Runs one translated NULL JSFX effect the way REAPER and ysfx do (NULL JSFX, MIT License):
// @init on load and at every transport start, @slider when a slider changed, then @block
// and @sample for each block. Used by the AudioWorklet, the page (@gfx) and the tests.
// Plain ES5; registers globalThis.NULLFXHost.
(function (g) {
  "use strict";

  function noop() { return 0; }

  // host services the generated code calls (H.*); files are handed over by the page
  function makeHost(owner) {
    return {
      timePrecise: function () { return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000; },
      time: function () { return Math.floor(Date.now() / 1000); },
      // mask: bit 0 = slider1 (the generated code turns sliderX into its bit)
      sliderChange: function (mask) { owner.changed |= mask; return 0; },
      sliderAutomate: function (mask) { owner.changed |= mask; if (owner.onAutomate) owner.onAutomate(mask); return 0; },
      sliderShow: function (mask) { return mask; },
      // files: owner.files[handle] = { channels, srate, data: Float64Array (interleaved), pos }
      fileOpen: function (h) { return owner.openFile(h); },
      fileClose: function (h) { if (owner.open[h]) delete owner.open[h]; return 0; },
      fileAvail: function (h) { var f = owner.open[h]; return f ? f.data.length - f.pos : 0; },
      fileRewind: function (h) { var f = owner.open[h]; if (f) f.pos = 0; return 0; },
      fileRiff: function (h) {
        var f = owner.open[h];
        this.riffCh = f ? f.channels : 0; this.riffSr = f ? f.srate : 0;
        return 0;
      },
      fileMem: function (mem, h, offs, len) {
        var f = owner.open[h];
        if (!f) return 0;
        var n = Math.max(0, Math.min(Math.floor(len + 0.0001), f.data.length - f.pos));
        var d = Math.floor(offs + 0.0001);
        if (n < 1 || d < 0) return 0;
        mem.write(d, f.data.subarray(f.pos, f.pos + n));
        f.pos += n;
        return n;
      },
      fileVar: function (h, cur) {
        var f = owner.open[h];
        if (!f || f.pos >= f.data.length) return cur;
        return f.data[f.pos++];
      },
      riffCh: 0, riffSr: 0
    };
  }

  // a gfx object that ignores drawing (the audio thread has no canvas)
  var NO_GFX = { mw: 0, mh: 0 };
  ["line", "rect", "roundrect", "circle", "arc", "setfont", "drawstr", "drawnumber", "drawchar", "lineto",
    "setpixel", "triangle", "gradrect", "set", "getchar", "muladdrect", "showmenu", "setcursor", "measurestr", "measurechar"
  ].forEach(function (k) { NO_GFX[k] = noop; });

  // FX: a registered effect (globalThis.NULLFX[id]); R: globalThis.NULLRT
  function Effect(FX, R, opts) {
    opts = opts || {};
    this.FX = FX;
    this.changed = 0;
    this.files = opts.files || {};   // slider file paths -> decoded audio
    this.open = {};
    this.nextHandle = 1;
    this.H = makeHost(this);
    this.G = opts.gfx || NO_GFX;
    this.inst = FX.create(R, this.H, this.G);
    this.srate = opts.srate || 48000;
    this.blockSize = opts.blockSize || 128;
    this.playing = !!opts.playing;
    this.mustInit = true;
    this.mustSlider = true;
    var self = this, given = opts.sliders || {};
    FX.sliders.forEach(function (s) { self.inst.setSlider(s.i, given[s.i] != null ? given[s.i] : s.def); });
    this.inst.setHost("srate", this.srate);
    this.inst.setHost("samplesblock", this.blockSize);
    this.inst.setHost("tempo", 120);
    this.inst.setHost("play_state", this.playing ? 1 : 0);
    this.inst.setHost("ts_num", 4);
    this.inst.setHost("ts_denom", 4);
    this.init();
  }
  Effect.prototype.init = function () {
    this.inst.setHost("srate", this.srate);
    this.inst.setHost("samplesblock", this.blockSize);
    this.open = {};
    this.inst.init();
    this.mustInit = false;
    this.mustSlider = true;
  };
  Effect.prototype.setSlider = function (i, v) {
    this.inst.setSlider(i, v);
    this.mustSlider = true;
  };
  // file sliders: the value is an index into the folder's file list; the host resolves it
  Effect.prototype.openFile = function (h) {
    var key = this.inst.str ? this.inst.str.get(h) : "";
    var src = this.files[key] || this.files[h];
    if (!src) {
      // a slider number (file_open(sliderN)) picks the file chosen on that slider
      var s = this.FX.sliders.filter(function (x) { return x.path; })[0];
      src = s ? this.files["slider" + s.i] : null;
    }
    if (!src) return -1;
    var handle = this.nextHandle++;
    this.open[handle] = { channels: src.channels, srate: src.srate, data: src.data, pos: 0 };
    return handle;
  };
  // tempo, playing, position (s), beat position, ts num/denom
  Effect.prototype.setTime = function (t) {
    if (t.playing && !this.playing) this.mustInit = true; // REAPER re-runs @init at transport start
    this.playing = !!t.playing;
    this.inst.setHost("tempo", t.tempo || 120);
    this.inst.setHost("play_state", t.playing ? 1 : 0);
    this.inst.setHost("play_position", t.position || 0);
    this.inst.setHost("beat_position", t.beat || 0);
    this.inst.setHost("ts_num", t.num || 4);
    this.inst.setHost("ts_denom", t.denom || 4);
  };
  // ins/outs: arrays of Float64Array or Float32Array; nin: inputs with signal
  Effect.prototype.process = function (ins, outs, n, nin) {
    if (this.mustInit) this.init();
    this.inst.setHost("samplesblock", n);
    this.inst.setHost("num_ch", nin);
    if (this.mustSlider) { this.inst.slider(); this.mustSlider = false; }
    this.inst.block();
    this.inst.sample(ins, outs, n, nin);
  };
  Effect.prototype.pdc = function () {
    var d = this.inst.getHost("pdc_delay");
    return d > 0 ? d : 0;
  };

  var API = { Effect: Effect, NO_GFX: NO_GFX };
  g.NULLFXHost = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
