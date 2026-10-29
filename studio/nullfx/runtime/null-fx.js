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
      fileAvail: function (h) {
        if (h === 0 && owner.ser) return owner.ser.write ? -1 : owner.ser.data.length - owner.ser.pos; // as in REAPER's @serialize
        var f = owner.open[h]; return f ? f.data.length - f.pos : 0;
      },
      fileRewind: function (h) { var f = owner.open[h]; if (f) f.pos = 0; return 0; },
      fileRiff: function (h) {
        var f = owner.open[h];
        this.riffCh = f ? f.channels : 0; this.riffSr = f ? f.srate : 0;
        return 0;
      },
      fileMem: function (mem, h, offs, len) {
        if (h === 0 && owner.ser) return owner.serMem(mem, offs, len);
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
        if (h === 0 && owner.ser) return owner.serVar(cur);
        var f = owner.open[h];
        if (!f || f.pos >= f.data.length) return cur;
        return f.data[f.pos++];
      },
      riffCh: 0, riffSr: 0,
      // MIDI of the current block: midiRecv() moves the next event into mo (offset), m1..m3
      midiRecv: function () {
        var q = owner.midiIn, e = q && q[owner.midiPos];
        if (!e) return 0;
        owner.midiPos++;
        this.mo = e[0]; this.m1 = e[1]; this.m2 = e[2]; this.m3 = e[3];
        return 1;
      },
      midiSend: function (ofs, m1, m2, m3) { owner.midiOut.push([ofs, m1 & 255, m2 & 255, m3 & 255]); return m1; },
      mo: 0, m1: 0, m2: 0, m3: 0
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
    this.midiIn = null; this.midiPos = 0; this.midiOut = [];
    this.ser = null;
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
    // REAPER re-runs @init at transport start, unless @init set ext_noinit
    if (t.playing && !this.playing && !this.inst.getHost("ext_noinit")) this.mustInit = true;
    this.playing = !!t.playing;
    this.inst.setHost("tempo", t.tempo || 120);
    this.inst.setHost("play_state", t.playing ? 1 : 0);
    this.inst.setHost("play_position", t.position || 0);
    this.inst.setHost("beat_position", t.beat || 0);
    this.inst.setHost("ts_num", t.num || 4);
    this.inst.setHost("ts_denom", t.denom || 4);
  };
  // ins/outs: arrays of Float64Array or Float32Array; nin: inputs with signal;
  // midi: the block's MIDI events [[offset, status, data1, data2], ...] in time order (or none).
  // What the effect sends with midisend() is in this.midiOut afterwards.
  Effect.prototype.process = function (ins, outs, n, nin, midi) {
    this.midiIn = midi || null; this.midiPos = 0; this.midiOut = [];
    if (this.mustInit) this.init();
    this.inst.setHost("samplesblock", n);
    this.inst.setHost("num_ch", nin);
    if (this.mustSlider) { this.inst.slider(); this.mustSlider = false; }
    this.inst.block();
    this.inst.sample(ins, outs, n, nin);
  };
  // @serialize: the state the effect saves beyond its sliders (an instrument's own pattern),
  // as an array of numbers; setState() hands a saved one back, like REAPER loading a project
  Effect.prototype.getState = function () {
    if (!this.FX.serialize) return null;
    this.ser = { write: true, data: [], pos: 0 };
    try { this.inst.serialize(); } finally { var d = this.ser.data; this.ser = null; }
    return d;
  };
  Effect.prototype.setState = function (data) {
    if (!this.FX.serialize || !data || !data.length) return;
    this.ser = { write: false, data: Array.prototype.slice.call(data), pos: 0 };
    try { this.inst.serialize(); } finally { this.ser = null; }
    this.mustSlider = true;
  };
  Effect.prototype.serVar = function (cur) {
    var s = this.ser;
    if (s.write) { s.data.push(+cur || 0); return cur; }
    return s.pos < s.data.length ? +s.data[s.pos++] || 0 : cur;
  };
  Effect.prototype.serMem = function (mem, offs, len) {
    var s = this.ser, n = Math.max(0, Math.floor(len + 0.0001)), d = Math.floor(offs + 0.0001);
    if (n < 1 || d < 0) return 0;
    if (s.write) { var a = mem.read(d, n); for (var i = 0; i < n; i++) s.data.push(a[i]); return n; }
    n = Math.min(n, s.data.length - s.pos);
    if (n < 1) return 0;
    mem.write(d, Float64Array.from(s.data.slice(s.pos, s.pos + n), function (x) { return +x || 0; }));
    s.pos += n;
    return n;
  };
  Effect.prototype.pdc = function () {
    var d = this.inst.getHost("pdc_delay");
    return d > 0 ? d : 0;
  };

  // Events a page schedules ahead on the audio clock (seconds, AudioContext.currentTime), for
  // a worklet to hand over at the right sample: MIDI [at, status, data1, data2] and transport
  // changes { at, playing, position, ... }. block() takes what falls in the block that starts
  // at t0 (n frames at sr); what is already late plays at the block's first sample.
  function Sched() { this.midi = []; this.times = []; }
  Sched.prototype.addMidi = function (list) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || !(e[0] >= 0) || this.midi.length >= 8192) continue;
      var ev = [+e[0], e[1] & 255, e[2] & 255, e[3] & 255], k = this.midi.length;
      while (k > 0 && this.midi[k - 1][0] > ev[0]) k--;   // stable: same time keeps the order sent
      this.midi.splice(k, 0, ev);
    }
  };
  Sched.prototype.addTime = function (t) {
    var k = this.times.length;
    while (k > 0 && this.times[k - 1].at > t.at) k--;
    this.times.splice(k, 0, t);
  };
  Sched.prototype.clear = function () { this.midi = []; this.times = []; };
  // -> { midi: [[offset, status, data1, data2]] or null, time: the last transport change due
  //      with its position moved back to the block's start, or null }
  Sched.prototype.block = function (t0, n, sr) {
    var end = t0 + n / sr, out = null, time = null, ofs;
    while (this.midi.length && this.midi[0][0] < end) {
      var e = this.midi.shift();
      ofs = Math.max(0, Math.min(n - 1, Math.round((e[0] - t0) * sr)));
      (out || (out = [])).push([ofs, e[1], e[2], e[3]]);
    }
    while (this.times.length && this.times[0].at < end) {
      var t = this.times.shift(), c = {};
      for (var k in t) if (k !== "at") c[k] = t[k];
      ofs = Math.max(0, Math.round((t.at - t0) * sr));
      if (c.position != null) c.position = +c.position - ofs / sr;
      time = c;
    }
    return { midi: out, time: time };
  };

  var API = { Effect: Effect, NO_GFX: NO_GFX, Sched: Sched };
  g.NULLFXHost = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
