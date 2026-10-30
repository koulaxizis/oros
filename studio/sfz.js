// ============================================================
// orOS Studio — sample instruments (SFZ subset player)
//   - parse(text): an .sfz file → { regions, warnings }. Headers
//     <control> <global> <master> <group> <region>, // and /* */
//     comments, note names (c4 = 60). Opcodes Studio plays: sample,
//     lokey/hikey/key/pitch_keycenter, lovel/hivel, volume, pan, tune,
//     transpose, pitch_keytrack, amp_veltrack, offset, ampeg_attack/
//     hold/decay/sustain/release, loop_mode/loop_start/loop_end,
//     trigger (attack, release), seq_length/seq_position, lorand/hirand,
//     group/off_by. default_path and note_offset/octave_offset in
//     <control>. Anything else is listed once in warnings and ignored.
//     #include and #define are not followed. Pure, tested in
//     tests/studio-sfz.test.js.
//   - samplePath(p): a sample's path inside the instrument's folder,
//     or null when it would leave the folder (absolute, "..").
//   - pick(inst, note, vel, trig, rr, rnd): the regions that sound.
//   - Instrument(regions, buffers): played by playNote() (scheduled
//     notes, also offline for the export) and by Live (keys, MIDI).
//   - lead(buf): where the sound starts in a decoded sample (an MP3's
//     leading encoder padding is zeros; browsers differ in removing it).
// Loaded before studio.js (window.StudioSfz).
// ============================================================
(function (root) {
  "use strict";

  var MAX_REGIONS = 4096;
  var NOTES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  var KNOWN = {
    sample: 1, lokey: 1, hikey: 1, key: 1, pitch_keycenter: 1, lovel: 1, hivel: 1, volume: 1, pan: 1, tune: 1,
    transpose: 1, pitch_keytrack: 1, amp_veltrack: 1, offset: 1, ampeg_attack: 1, ampeg_hold: 1, ampeg_decay: 1,
    ampeg_sustain: 1, ampeg_release: 1, ampeg_delay: 1, loop_mode: 1, loopmode: 1, loop_start: 1, loopstart: 1,
    loop_end: 1, loopend: 1, trigger: 1, seq_length: 1, seq_position: 1, lorand: 1, hirand: 1, group: 1, off_by: 1,
    default_path: 1, note_offset: 1, octave_offset: 1,
    // labels and hints that change nothing in the sound
    group_label: 1, region_label: 1, sw_label: 1, ampeg_dynamic: 1, label_cc: 1, set_cc: 1
  };

  function note(v) {
    if (v == null) return NaN;
    var s = String(v).trim().toLowerCase();
    if (/^-?\d+$/.test(s)) return +s;
    var m = /^([a-g])([#b]?)(-?\d+)$/.exec(s);
    if (!m) return NaN;
    return (+m[3] + 1) * 12 + NOTES[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function strip(text) {
    return String(text || "").replace(/\r/g, "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/.*$/gm, "$1");
  }
  // headers and key=value pairs; a value runs to the next opcode or header
  // (a sample name may hold spaces)
  function tokens(text) {
    var out = [], s = strip(text), re = /<(\w+)>|([A-Za-z][A-Za-z0-9_]*)=/g, m, last = null;
    while ((m = re.exec(s))) {
      if (last) { last.value = s.slice(last.end, m.index).trim(); out.push(last); last = null; }
      if (m[1]) out.push({ header: m[1].toLowerCase() });
      else last = { key: m[2].toLowerCase(), end: re.lastIndex };
    }
    if (last) { last.value = s.slice(last.end).trim(); out.push(last); }
    return out;
  }

  function samplePath(p) {
    var s = String(p || "").replace(/\\/g, "/").trim(), parts = [];
    if (!s || s.charAt(0) === "/" || /^[a-z]+:/i.test(s)) return null;
    var bad = s.split("/").some(function (x) {
      if (x === "" || x === ".") return false;
      if (x !== "..") { parts.push(x); return false; }
      return !parts.pop();
    });
    return bad || !parts.length ? null : parts.join("/");
  }

  function region(o, ctl, warn) {
    var off = num(ctl.note_offset, 0) + 12 * num(ctl.octave_offset, 0);
    var r = {}, lo, hi;
    var path = samplePath((ctl.default_path || "").replace(/\\/g, "/") + (o.sample || ""));
    if (!o.sample) return null;
    if (!path) { warn("path", o.sample); return null; }
    r.sample = path;
    if (o.key != null) lo = hi = note(o.key);
    lo = o.lokey != null ? note(o.lokey) : lo;
    hi = o.hikey != null ? note(o.hikey) : hi;
    r.lokey = clamp(isNaN(lo) || lo == null ? 0 : lo + off, 0, 127);
    r.hikey = clamp(isNaN(hi) || hi == null ? 127 : hi + off, 0, 127);
    var kc = o.pitch_keycenter != null ? note(o.pitch_keycenter) : o.key != null ? note(o.key) : 60;
    r.center = isNaN(kc) ? 60 : kc + off;
    r.lovel = clamp(Math.round(num(o.lovel, 0)), 0, 127);
    r.hivel = clamp(Math.round(num(o.hivel, 127)), 0, 127);
    r.volume = clamp(num(o.volume, 0), -144, 48);
    r.pan = clamp(num(o.pan, 0), -100, 100);
    r.tune = clamp(num(o.tune, 0), -9600, 9600) + 100 * clamp(Math.round(num(o.transpose, 0)), -127, 127);
    r.keytrack = clamp(num(o.pitch_keytrack, 100), -1200, 1200);
    r.veltrack = clamp(num(o.amp_veltrack, 100), -100, 100);
    r.offset = Math.max(0, Math.round(num(o.offset, 0)));
    r.delay = clamp(num(o.ampeg_delay, 0), 0, 100);
    r.attack = clamp(num(o.ampeg_attack, 0), 0, 100);
    r.hold = clamp(num(o.ampeg_hold, 0), 0, 100);
    r.decay = clamp(num(o.ampeg_decay, 0), 0, 100);
    r.sustain = clamp(num(o.ampeg_sustain, 100), 0, 100) / 100;
    r.release = clamp(num(o.ampeg_release, 0.001), 0.001, 100);
    var lm = String(o.loop_mode || o.loopmode || "").toLowerCase();
    r.loop = lm === "loop_continuous" || lm === "loop_sustain" ? lm : lm === "one_shot" ? "one_shot" : "";
    var ls = o.loop_start != null ? o.loop_start : o.loopstart, le = o.loop_end != null ? o.loop_end : o.loopend;
    if (r.loop && r.loop !== "one_shot") {
      r.loopStart = Math.max(0, Math.round(num(ls, 0)));
      r.loopEnd = Math.max(0, Math.round(num(le, 0)));
    }
    var tr = String(o.trigger || "attack").toLowerCase();
    if (tr !== "attack" && tr !== "release") { warn("trigger", tr); return null; }
    r.trigger = tr;
    r.seqLength = Math.max(1, Math.round(num(o.seq_length, 1)));
    r.seqPos = Math.max(1, Math.round(num(o.seq_position, 1)));
    r.lorand = clamp(num(o.lorand, 0), 0, 1);
    r.hirand = clamp(num(o.hirand, 1), 0, 1);
    if (o.group != null) r.group = Math.round(num(o.group, 0));
    if (o.off_by != null) r.offBy = Math.round(num(o.off_by, 0));
    if (r.lokey > r.hikey || r.lovel > r.hivel) return null;
    return r;
  }

  function parse(text) {
    var lv = { control: {}, global: {}, master: {}, group: {} }, raw = [], where = null, cur = null;
    var warnings = [], seen = {};
    function warn(k, v) { var key = k + ":" + v; if (!seen[key] && warnings.length < 50) { seen[key] = 1; warnings.push(k === "path" ? "sample outside the folder: " + v : k === "trigger" ? "trigger=" + v + " not played" : k === "header" ? "<" + v + "> ignored" : k + " ignored"); } }
    tokens(text).forEach(function (t) {
      if (t.header) {
        where = t.header;
        if (where === "region") { cur = {}; for (var k in lv.global) cur[k] = lv.global[k]; for (k in lv.master) cur[k] = lv.master[k]; for (k in lv.group) cur[k] = lv.group[k]; raw.push({ o: cur, ctl: Object.assign({}, lv.control) }); return; }
        cur = null;
        if (where === "global") { lv.global = {}; lv.master = {}; lv.group = {}; }
        else if (where === "master") { lv.master = {}; lv.group = {}; }
        else if (where === "group") lv.group = {};
        else if (where === "control") lv.control = {};
        else warn("header", where);
        return;
      }
      if (!KNOWN[t.key]) warn(t.key);
      if (where === "region" && cur) cur[t.key] = t.value;
      else if (lv[where]) lv[where][t.key] = t.value;
    });
    var regions = [];
    raw.forEach(function (x) {
      if (regions.length >= MAX_REGIONS) return;
      var r = region(x.o, x.ctl, warn);
      if (r) regions.push(r);
    });
    if (raw.length > MAX_REGIONS) warnings.push("only the first " + MAX_REGIONS + " regions");
    return { regions: regions, warnings: warnings };
  }

  // regions → .sfz text again (the opcodes Studio plays, defaults left
  // out); rename: { old sample path: new name } for an imported copy
  function write(regions, rename, head) {
    var lines = (head || []).map(function (h) { return "// " + String(h).replace(/[\r\n]+/g, " "); });
    regions.forEach(function (r) {
      var o = ["sample=" + ((rename && rename[r.sample]) || r.sample), "lokey=" + r.lokey, "hikey=" + r.hikey, "pitch_keycenter=" + r.center,
        "lovel=" + r.lovel, "hivel=" + r.hivel];
      var add = function (k, v, d) { if (v !== d && v != null) o.push(k + "=" + v); };
      add("volume", r.volume, 0); add("pan", r.pan, 0); add("tune", r.tune, 0); add("pitch_keytrack", r.keytrack, 100);
      add("amp_veltrack", r.veltrack, 100); add("offset", r.offset, 0); add("ampeg_delay", r.delay, 0); add("ampeg_attack", r.attack, 0);
      add("ampeg_hold", r.hold, 0); add("ampeg_decay", r.decay, 0); add("ampeg_sustain", Math.round(r.sustain * 1000) / 10, 100);
      add("ampeg_release", r.release, 0.001);
      if (r.loop) { o.push("loop_mode=" + r.loop); if (r.loop !== "one_shot") o.push("loop_start=" + r.loopStart, "loop_end=" + r.loopEnd); }
      add("trigger", r.trigger, "attack"); add("seq_length", r.seqLength, 1); add("seq_position", r.seqPos, 1);
      add("lorand", r.lorand, 0); add("hirand", r.hirand, 1); add("group", r.group, undefined); add("off_by", r.offBy, undefined);
      lines.push("<region> " + o.join(" "));
    });
    return lines.join("\n") + "\n";
  }

  // the sample files an instrument needs, in order, once each
  function samples(regions) {
    var seen = {}, out = [];
    regions.forEach(function (r) { if (!seen[r.sample]) { seen[r.sample] = 1; out.push(r.sample); } });
    return out;
  }

  // the regions that sound for one note; rr: { "<group key>": count } is
  // updated (round robin), rnd in [0, 1)
  function pick(regions, nt, vel, trig, rr, rnd) {
    var out = [], bump = {};
    regions.forEach(function (r) {
      if (r.trigger !== trig || nt < r.lokey || nt > r.hikey || vel < r.lovel || vel > r.hivel) return;
      if (rnd < r.lorand || (rnd >= r.hirand && r.hirand < 1)) return;
      if (r.seqLength > 1) {
        var k = r.lokey + ":" + r.hikey + ":" + r.lovel + ":" + r.seqLength;
        var c = (rr && rr[k]) || 0;
        if ((c % r.seqLength) + 1 !== r.seqPos) return;
        bump[k] = 1;
      }
      out.push(r);
    });
    if (rr) for (var k in bump) rr[k] = (rr[k] || 0) + 1;
    return out;
  }

  // the first frame of sound: leading samples that are all but zero
  // (encoder padding) are skipped, at most 0.1 s
  function lead(buf) {
    var n = Math.min(buf.length, Math.round(buf.sampleRate * 0.1)), first = n;
    for (var ch = 0; ch < buf.numberOfChannels; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < first; i++) if (d[i] > 1e-5 || d[i] < -1e-5) { first = i; break; }
    }
    return first >= n ? 0 : first;
  }

  // ---------- Playing (Web Audio) ----------
  function db(v) { return Math.pow(10, v / 20); }
  function velAmp(r, vel) {
    var x = vel / 127, curve = x * x, t = r.veltrack / 100;
    return t >= 0 ? 1 - t + t * curve : 1 + t * curve;   // amp_veltrack 100: (vel/127)²
  }
  // instrument: { regions, buffers: { path: AudioBuffer }, leads: { path: frames }, rr: {} }
  function Instrument(regions, buffers) {
    this.regions = regions;
    this.buffers = buffers || {};
    this.leads = {};
    for (var p in this.buffers) this.leads[p] = lead(this.buffers[p]);
    this.rr = {};
  }
  // one region as a voice: returns { src, env, r, end(t) }
  function voice(ctx, out, inst, r, nt, vel, when, gain, bend) {
    var buf = inst.buffers[r.sample];
    if (!buf) return null;
    var src = ctx.createBufferSource(), env = ctx.createGain(), pn = null, sr = buf.sampleRate;
    src.buffer = buf;
    var cents = (nt - r.center) * r.keytrack + r.tune + (bend || 0) * 200;
    src.playbackRate.value = Math.pow(2, cents / 1200);
    var start = (inst.leads[r.sample] || 0) / sr + r.offset / sr;
    if (start >= buf.duration) return null;
    if ((r.loop === "loop_continuous" || r.loop === "loop_sustain") && r.loopEnd > r.loopStart) {
      src.loop = true;
      src.loopStart = (inst.leads[r.sample] || 0) / sr + r.loopStart / sr;
      src.loopEnd = (inst.leads[r.sample] || 0) / sr + (r.loopEnd + 1) / sr;
    }
    var lvl = (gain == null ? 1 : gain) * db(r.volume) * velAmp(r, vel);
    var t0 = when + r.delay, a = Math.max(0.001, r.attack), g = env.gain;
    g.setValueAtTime(0, when);
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(lvl, t0 + a);
    var t1 = t0 + a + r.hold;
    g.setValueAtTime(lvl, t1);
    if (r.decay > 0 && r.sustain < 1) g.setTargetAtTime(lvl * r.sustain, t1, r.decay / 4);
    else if (r.sustain < 1) g.setValueAtTime(lvl * r.sustain, t1);
    src.connect(env);
    if (r.pan && ctx.createStereoPanner) { pn = ctx.createStereoPanner(); pn.pan.value = r.pan / 100; env.connect(pn); pn.connect(out); }
    else env.connect(out);
    src.start(t0, start);
    var v = { src: src, env: env, pn: pn, r: r, lvl: lvl, ends: !src.loop ? t0 + (buf.duration - start) / src.playbackRate.value : Infinity };
    return v;
  }
  function releaseVoice(ctx, v, at, fast) {
    if (v.r.loop === "one_shot" && !fast) return v.ends;
    var g = v.env.gain, R = fast ? 0.02 : v.r.release;
    if (typeof g.cancelAndHoldAtTime === "function") g.cancelAndHoldAtTime(at);
    else { g.cancelScheduledValues(at); g.setValueAtTime(g.value, at); }
    g.setTargetAtTime(0, at, Math.max(0.005, R / 4));
    var stop = Math.min(v.ends, at + R * 1.5 + 0.05);
    try { v.src.stop(stop); } catch (e) { /* stopped */ }
    return stop;
  }
  function cut(v) { try { (v.pn || v.env).disconnect(); } catch (e) { /* gone */ } }

  // a scheduled note (instrument tracks, export): same handle as StudioMidi.playNote
  function playNote(ctx, out, inst, nt, vel, when, dur, gain) {
    var vs = [], end = when, rnd = Math.random();
    pick(inst.regions, nt, vel, "attack", inst.rr, rnd).forEach(function (r) {
      var v = voice(ctx, out, inst, r, nt, vel, when, gain);
      if (v) vs.push(v);
    });
    var off = when + Math.max(dur, 0.005);
    vs.forEach(function (v) { end = Math.max(end, releaseVoice(ctx, v, off)); });
    pick(inst.regions, nt, vel, "release", inst.rr, rnd).forEach(function (r) {
      var v = voice(ctx, out, inst, r, nt, vel, off, gain);
      if (v) { vs.push(v); end = Math.max(end, Math.min(v.ends, off + 30)); try { v.src.stop(Math.min(v.ends, off + 30)); } catch (e) {} }
    });
    return {
      end: end,
      stop: function () { vs.forEach(function (v) { try { v.src.stop(); } catch (e) { /* stopped */ } }); },
      disconnect: function () { vs.forEach(cut); }
    };
  }

  var MAX_VOICES = 48;
  // live playing from the keys or a MIDI keyboard (the Synth interface of midi.js)
  function Live(ctx, out, inst) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(out);
    this.inst = inst;
    this.voices = [];
    this.sustain = false;
    this.bend = 0;
    this.vels = {};
  }
  Live.prototype.noteOn = function (nt, vel) {
    var c = this.ctx, t = c.currentTime, self = this;
    this.noteOff(nt, true);
    this.vels[nt] = vel;
    pick(this.inst.regions, nt, vel, "attack", this.inst.rr, Math.random()).forEach(function (r) {
      if (r.group) self.voices.slice().forEach(function (v) { if (v.r.offBy === r.group) self.kill(v, true); });
      while (self.voices.length >= MAX_VOICES) self.kill(self.voices[0]);
      var v = voice(c, self.out, self.inst, r, nt, vel, t, 1, self.bend);
      if (!v) return;
      v.note = nt; v.held = true; v.sus = false;
      v.src.onended = function () { self.drop(v); };
      self.voices.push(v);
    });
  };
  Live.prototype.noteOff = function (nt, now) {
    var self = this, any = false;
    this.voices.slice().forEach(function (v) {
      if (v.note !== nt || !v.held) return;
      any = true;
      if (self.sustain && !now) { v.held = false; v.sus = true; return; }
      v.held = false;
      releaseVoice(self.ctx, v, self.ctx.currentTime, !!now);
    });
    if (any && !now && !this.sustain) this.releaseHit(nt);
  };
  Live.prototype.releaseHit = function (nt) {
    var self = this, c = this.ctx, vel = this.vels[nt] || 64;
    pick(this.inst.regions, nt, vel, "release", this.inst.rr, Math.random()).forEach(function (r) {
      var v = voice(c, self.out, self.inst, r, nt, vel, c.currentTime, 1, self.bend);
      if (!v) return;
      v.note = -1; v.held = false;
      v.src.onended = function () { self.drop(v); };
      self.voices.push(v);
    });
  };
  Live.prototype.kill = function (v, soft) {
    if (soft) { releaseVoice(this.ctx, v, this.ctx.currentTime, true); return; }
    try { v.src.stop(); } catch (e) { /* stopped */ }
    this.drop(v);
  };
  Live.prototype.drop = function (v) {
    var i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    cut(v);
  };
  Live.prototype.setSustain = function (on) {
    var self = this;
    this.sustain = !!on;
    if (!on) this.voices.slice().forEach(function (v) { if (v.sus) { v.sus = false; releaseVoice(self.ctx, v, self.ctx.currentTime); } });
  };
  Live.prototype.setBend = function (b) {
    var t = this.ctx.currentTime;
    this.bend = b;
    this.voices.forEach(function (v) {
      if (v.note < 0) return;
      var cents = (v.note - v.r.center) * v.r.keytrack + v.r.tune + b * 200;
      v.src.playbackRate.setTargetAtTime(Math.pow(2, cents / 1200), t, 0.005);
    });
  };
  Live.prototype.allOff = function () {
    var self = this;
    this.sustain = false;
    this.voices.slice().forEach(function (v) { v.held = false; v.sus = false; releaseVoice(self.ctx, v, self.ctx.currentTime, true); });
  };
  Live.prototype.midi = function (m) {
    if (!m) return;
    if (m.type === "on") this.noteOn(m.note, m.vel);
    else if (m.type === "off") this.noteOff(m.note);
    else if (m.type === "bend") this.setBend(m.bend);
    else if (m.type === "cc" && m.cc === 64) this.setSustain(m.val >= 64);
    else if (m.type === "cc" && (m.cc === 120 || m.cc === 123)) this.allOff();
  };

  var api = {
    parse: parse, write: write, note: note, samplePath: samplePath, samples: samples, pick: pick, lead: lead, velAmp: velAmp,
    Instrument: Instrument, playNote: playNote, Live: Live, MAX_REGIONS: MAX_REGIONS, MAX_VOICES: MAX_VOICES
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioSfz = api;
})(typeof window !== "undefined" ? window : this);
