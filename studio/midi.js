// ============================================================
// orOS Studio — MIDI keyboard and built-in synth (v1.0.0)
//   - parse(): one MIDI message (Web MIDI hands them over whole) to
//     { type: "on" | "off" | "cc" | "bend", ch, note, vel, cc, val, bend }
//     or null for what Studio does not use (clock, sysex, …). Pure,
//     tested in tests/studio-mix.test.js.
//   - access(): Web MIDI (Chrome, Edge), asked for only from a button
//     the person presses; known(): whether it was allowed before, so a
//     later visit can reconnect without asking again.
//   - Synth(ctx, out): a small polyphonic synth (two oscillators, a
//     low-pass filter and an envelope per voice) with a few sounds and
//     a drum kit, played live from the keys or a MIDI keyboard.
//   - playNote(ctx, out, inst, note, vel, when, dur, gain): one note of
//     an instrument (MIDI) track scheduled ahead, also in an
//     OfflineAudioContext for the export; returns a handle with stop()
//     and disconnect(). The drum kit follows the General MIDI drum map
//     (36 kick, 38 snare, 42 closed hi-hat, …); every sound is made here
//     from oscillators and noise, no samples.
// Loaded before studio.js (window.StudioMidi).
// ============================================================
(function (root) {
  "use strict";

  // ---------- Pure ----------
  function parse(data) {
    if (!data || data.length < 1) return null;
    var st = data[0] & 0xff;
    if (st < 0x80 || st >= 0xf0) return null;               // running status never reaches Web MIDI; system messages are not used
    var kind = st & 0xf0, ch = st & 0x0f, d1 = (data[1] || 0) & 0x7f, d2 = (data[2] || 0) & 0x7f;
    if (kind === 0x90 && data.length >= 3) return d2 ? { type: "on", ch: ch, note: d1, vel: d2 } : { type: "off", ch: ch, note: d1, vel: 0 };
    if (kind === 0x80 && data.length >= 3) return { type: "off", ch: ch, note: d1, vel: d2 };
    if (kind === 0xb0 && data.length >= 3) return { type: "cc", ch: ch, cc: d1, val: d2 };
    if (kind === 0xe0 && data.length >= 3) {
      var v = (d2 << 7) | d1;                                // 0..16383, centre 8192
      return { type: "bend", ch: ch, val: v, bend: v >= 8192 ? (v - 8192) / 8191 : (v - 8192) / 8192 };
    }
    return null;
  }
  function noteFreq(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  var NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  function noteName(n) { return NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); }   // 60 = C4
  function isBlack(n) { return [1, 3, 6, 8, 10].indexOf(((n % 12) + 12) % 12) >= 0; }
  function velGain(v) { return Math.pow(Math.max(0, Math.min(127, v)) / 127, 1.6); }

  // ---------- Sounds ----------
  // a, b: oscillator types; mix of b; det: cents between them; oct: octave of b;
  // cut: filter cut-off (Hz) and how much it follows the key (trk) and
  // the envelope (env, x cut); A D S R in seconds (S level 0..1).
  var PRESETS = {
    piano:   { a: "triangle", b: "sine", mix: 0.5, det: 3, oct: 1, cut: 2600, trk: 0.6, env: 1.5, q: 0.4, A: 0.004, D: 1.4, S: 0, R: 0.35, lvl: 0.55 },
    epiano:  { a: "sine", b: "sine", mix: 0.35, det: 6, oct: 2, cut: 5000, trk: 0.3, env: 0.5, q: 0.2, A: 0.003, D: 1.8, S: 0.25, R: 0.5, lvl: 0.6 },
    organ:   { a: "sine", b: "square", mix: 0.18, det: 2, oct: 1, cut: 3200, trk: 0.4, env: 0, q: 0.3, A: 0.01, D: 0.1, S: 1, R: 0.08, lvl: 0.4 },
    strings: { a: "sawtooth", b: "sawtooth", mix: 0.8, det: 11, oct: 0, cut: 2200, trk: 0.3, env: 0.4, q: 0.3, A: 0.35, D: 0.6, S: 0.8, R: 0.9, lvl: 0.3 },
    lead:    { a: "sawtooth", b: "square", mix: 0.45, det: 7, oct: 0, cut: 3600, trk: 0.5, env: 1, q: 3, A: 0.01, D: 0.3, S: 0.75, R: 0.2, lvl: 0.32 },
    bass:    { a: "sawtooth", b: "sine", mix: 0.9, det: 0, oct: -1, cut: 700, trk: 0.4, env: 2, q: 2, A: 0.005, D: 0.4, S: 0.6, R: 0.12, lvl: 0.55 },
    drums:   { kit: true, lvl: 0.9 }
  };
  var ORDER = ["piano", "epiano", "organ", "strings", "lead", "bass", "drums"];

  // ---------- Drum kit (General MIDI drum map) ----------
  var KIT = {
    35: "kick", 36: "kick", 37: "rim", 38: "snare", 39: "clap", 40: "snare", 41: "tom1", 42: "hat", 43: "tom1",
    44: "pedal", 45: "tom2", 46: "ohat", 47: "tom2", 48: "tom3", 49: "crash", 50: "tom3", 51: "ride", 52: "crash",
    53: "ride", 54: "shaker", 55: "crash", 56: "cow", 57: "crash", 59: "ride", 69: "shaker", 70: "shaker", 75: "rim", 76: "rim", 77: "rim"
  };
  // the sound a note plays on the kit ("" = none: a short rim click is played)
  function drumKind(n) { return KIT[n] || ""; }
  var TOMS = { tom1: 95, tom2: 135, tom3: 185 };
  function noiseBuf(ctx) {
    if (ctx.__orosNoise && ctx.__orosNoise.sampleRate === ctx.sampleRate) return ctx.__orosNoise;
    var n = Math.floor(ctx.sampleRate * 1.6), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0), x = 22222;
    for (var i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; d[i] = x / 0x3fffffff - 1; }   // the same noise every time: exports repeat exactly
    try { ctx.__orosNoise = b; } catch (e) { /* frozen object */ }
    return b;
  }
  // One drum hit at `when`; returns a handle (stop, disconnect, end).
  function drumHit(ctx, out, note, vel, when, gain) {
    var kind = drumKind(note) || "rim", v = velGain(vel) * (gain == null ? 1 : gain) * PRESETS.drums.lvl;
    var srcs = [], gains = [], end = when;
    function env(peak, decay, t0) {
      var g = ctx.createGain();
      t0 = t0 || when;
      g.gain.setValueAtTime(Math.max(1e-4, peak), t0);
      g.gain.exponentialRampToValueAtTime(1e-4, t0 + decay);
      g.connect(out);
      gains.push(g);
      end = Math.max(end, t0 + decay);
      return g;
    }
    function noise(to, type, f, q, t0, len) {
      var s = ctx.createBufferSource(), flt = ctx.createBiquadFilter();
      s.buffer = noiseBuf(ctx);
      flt.type = type; flt.frequency.value = f; flt.Q.value = q || 0.7;
      s.connect(flt); flt.connect(to);
      s.start(t0 || when, (note * 0.0731) % 1);
      s.stop((t0 || when) + len + 0.02);
      srcs.push(s);
    }
    function tone(to, type, f0, f1, glide, len, t0) {
      var o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0 || when);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, (t0 || when) + glide);
      o.connect(to);
      o.start(t0 || when); o.stop((t0 || when) + len + 0.02);
      srcs.push(o);
    }
    if (v > 0) {
      if (kind === "kick") { tone(env(v, 0.45), "sine", 150, 45, 0.12, 0.45); noise(env(v * 0.25, 0.012), "highpass", 3000, 0.7, when, 0.012); }
      else if (kind === "snare") { noise(env(v * 0.55, 0.2), "highpass", 1200, 0.7, when, 0.2); tone(env(v * 0.4, 0.1), "triangle", 200, 150, 0.08, 0.1); }
      else if (kind === "rim") { noise(env(v * 0.4, 0.035), "bandpass", 2400, 4, when, 0.035); tone(env(v * 0.3, 0.03), "triangle", 900, 900, 0, 0.03); }
      else if (kind === "clap") { [0, 0.011, 0.022].forEach(function (d, i) { noise(env(v * (i === 2 ? 0.6 : 0.4), i === 2 ? 0.16 : 0.012, when + d), "bandpass", 1100, 1.2, when + d, i === 2 ? 0.16 : 0.012); }); }
      else if (kind === "hat" || kind === "pedal") noise(env(v * 0.32, kind === "hat" ? 0.05 : 0.035), "highpass", 7500, 0.7, when, 0.05);
      else if (kind === "ohat") noise(env(v * 0.3, 0.35), "highpass", 7000, 0.7, when, 0.35);
      else if (kind === "crash") noise(env(v * 0.32, 1.4), "highpass", 4500, 0.7, when, 1.4);
      else if (kind === "ride") { noise(env(v * 0.18, 0.9), "bandpass", 6500, 0.8, when, 0.9); tone(env(v * 0.06, 0.6), "sine", 3150, 3150, 0, 0.6); }
      else if (kind === "shaker") noise(env(v * 0.22, 0.07), "bandpass", 5200, 1, when, 0.07);
      else if (kind === "cow") { var bp = ctx.createBiquadFilter(), g = env(v * 0.28, 0.25); bp.type = "bandpass"; bp.frequency.value = 800; bp.connect(g); tone(bp, "square", 545, 545, 0, 0.25); tone(bp, "square", 815, 815, 0, 0.25); }
      else if (TOMS[kind]) tone(env(v * 0.75, 0.35), "sine", TOMS[kind], TOMS[kind] * 0.62, 0.2, 0.35);
    }
    return {
      end: end + 0.05,
      stop: function () { srcs.forEach(function (s) { try { s.stop(); } catch (e) { /* stopped */ } }); },
      disconnect: function () { gains.forEach(function (g) { try { g.disconnect(); } catch (e) { /* gone */ } }); }
    };
  }

  // ---------- A scheduled note (instrument tracks, export) ----------
  function playNote(ctx, out, inst, note, vel, when, dur, gain) {
    var P = PRESETS[inst] || PRESETS.piano;
    if (P.kit) return drumHit(ctx, out, note, vel, when, gain);
    var f = noteFreq(note), g0 = gain == null ? 1 : gain;
    var o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain(), flt = ctx.createBiquadFilter(), env = ctx.createGain();
    o1.type = P.a; o2.type = P.b;
    o1.frequency.value = f; o2.frequency.value = f * Math.pow(2, P.oct);
    o1.detune.value = -P.det / 2; o2.detune.value = P.det / 2;
    g2.gain.value = P.mix;
    flt.type = "lowpass"; flt.Q.value = P.q;
    var base = Math.min(18000, P.cut * Math.pow(f / 261.63, P.trk)), peak = Math.min(18000, base * (1 + P.env * velGain(vel)));
    flt.frequency.setValueAtTime(peak, when);
    flt.frequency.setTargetAtTime(base, when + P.A, Math.max(0.02, P.D / 3));
    var lvl = g0 * P.lvl * (0.25 + 0.75 * velGain(vel)) / (1 + P.mix), off = when + Math.max(dur, P.A + 0.002);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(lvl, when + P.A);
    env.gain.setTargetAtTime(lvl * P.S, when + P.A, Math.max(0.01, P.D / 3));
    env.gain.setTargetAtTime(0, off, Math.max(0.005, P.R / 4));
    o1.connect(flt); o2.connect(g2); g2.connect(flt); flt.connect(env); env.connect(out);
    var stop = off + P.R * 1.5 + 0.05;
    o1.start(when); o2.start(when); o1.stop(stop); o2.stop(stop);
    return {
      end: stop,
      stop: function () { try { o1.stop(); o2.stop(); } catch (e) { /* stopped */ } },
      disconnect: function () { try { env.disconnect(); } catch (e) { /* gone */ } }
    };
  }
  var MAX_VOICES = 16;

  // ---------- Synth (Web Audio) ----------
  function Synth(ctx, out) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(out);
    this.voices = [];
    this.preset = PRESETS.piano;
    this.sustain = false;
    this.bend = 0;
  }
  Synth.prototype.setPreset = function (id) { if (PRESETS[id]) this.preset = PRESETS[id]; };
  Synth.prototype.noteOn = function (note, vel) {
    var c = this.ctx, P = this.preset, t = c.currentTime, f = noteFreq(note);
    if (P.kit) { drumHit(c, this.out, note, vel, t, 1); return; }   // one shot, nothing to hold
    this.noteOff(note, true);
    if (this.voices.length >= MAX_VOICES) this.kill(this.voices[0]);
    var o1 = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain(), flt = c.createBiquadFilter(), env = c.createGain();
    o1.type = P.a; o2.type = P.b;
    o1.frequency.value = f; o2.frequency.value = f * Math.pow(2, P.oct);
    o1.detune.value = this.bend * 200 - P.det / 2; o2.detune.value = this.bend * 200 + P.det / 2;
    g2.gain.value = P.mix;
    flt.type = "lowpass"; flt.Q.value = P.q;
    var base = Math.min(18000, P.cut * Math.pow(f / 261.63, P.trk)), peak = Math.min(18000, base * (1 + P.env * velGain(vel)));
    flt.frequency.setValueAtTime(peak, t);
    flt.frequency.setTargetAtTime(base, t + P.A, Math.max(0.02, P.D / 3));
    var lvl = P.lvl * (0.25 + 0.75 * velGain(vel)) / (1 + P.mix);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(lvl, t + P.A);
    env.gain.setTargetAtTime(lvl * P.S, t + P.A, Math.max(0.01, P.D / 3));
    o1.connect(flt); o2.connect(g2); g2.connect(flt); flt.connect(env); env.connect(this.out);
    o1.start(t); o2.start(t);
    this.voices.push({ note: note, o1: o1, o2: o2, env: env, held: true, sus: false, end: 0 });
  };
  Synth.prototype.noteOff = function (note, now) {
    var self = this;
    this.voices.slice().forEach(function (v) {
      if (v.note !== note || !v.held) return;
      if (self.sustain && !now) { v.held = false; v.sus = true; return; }
      self.release(v, now);
    });
  };
  Synth.prototype.release = function (v, fast) {
    var c = this.ctx, t = c.currentTime, R = fast ? 0.02 : this.preset.R, g = v.env.gain;
    v.held = false; v.sus = false;
    if (typeof g.cancelAndHoldAtTime === "function") g.cancelAndHoldAtTime(t);
    else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
    g.setTargetAtTime(0, t, Math.max(0.005, R / 4));
    var stop = t + R * 1.5 + 0.05;
    try { v.o1.stop(stop); v.o2.stop(stop); } catch (e) { /* already stopped */ }
    var self = this;
    v.o1.onended = function () { self.drop(v); };
  };
  Synth.prototype.kill = function (v) {
    try { v.o1.stop(); v.o2.stop(); } catch (e) { /* stopped */ }
    this.drop(v);
  };
  Synth.prototype.drop = function (v) {
    var i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    try { v.env.disconnect(); } catch (e) { /* gone */ }
  };
  Synth.prototype.setSustain = function (on) {
    var self = this;
    this.sustain = !!on;
    if (!on) this.voices.slice().forEach(function (v) { if (v.sus) self.release(v); });
  };
  Synth.prototype.setBend = function (b) {
    var t = this.ctx.currentTime, self = this;
    this.bend = b;
    this.voices.forEach(function (v) {
      v.o1.detune.setTargetAtTime(b * 200 - self.preset.det / 2, t, 0.005);
      v.o2.detune.setTargetAtTime(b * 200 + self.preset.det / 2, t, 0.005);
    });
  };
  Synth.prototype.allOff = function () {
    var self = this;
    this.sustain = false;
    this.voices.slice().forEach(function (v) { self.release(v, true); });
  };
  // one parsed MIDI message
  Synth.prototype.midi = function (m) {
    if (!m) return;
    if (m.type === "on") this.noteOn(m.note, m.vel);
    else if (m.type === "off") this.noteOff(m.note);
    else if (m.type === "bend") this.setBend(m.bend);
    else if (m.type === "cc" && m.cc === 64) this.setSustain(m.val >= 64);
    else if (m.type === "cc" && (m.cc === 120 || m.cc === 123)) this.allOff();
  };

  // ---------- Web MIDI ----------
  function supported() { return !!(root && root.navigator && typeof root.navigator.requestMIDIAccess === "function"); }
  // Only call from a click: this is what shows the browser's question.
  function access() {
    if (!supported()) return Promise.reject(new Error("nomidi"));
    return root.navigator.requestMIDIAccess({ sysex: false });
  }
  // Allowed before? ("granted" lets Studio reconnect without asking)
  function known() {
    try {
      var p = root.navigator.permissions;
      if (!p || typeof p.query !== "function") return Promise.resolve(false);
      return p.query({ name: "midi" }).then(function (r) { return r.state === "granted"; }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  var api = {
    parse: parse, noteFreq: noteFreq, noteName: noteName, isBlack: isBlack, velGain: velGain,
    PRESETS: PRESETS, ORDER: ORDER, MAX_VOICES: MAX_VOICES, drumKind: drumKind, playNote: playNote,
    Synth: Synth, supported: supported, access: access, known: known
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioMidi = api;
})(typeof window !== "undefined" ? window : this);
