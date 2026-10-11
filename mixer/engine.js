// ============================================================
// orOS Sound Mixer — audio engine (v1.0.0)
// Runs in the SHELL window (the Sound Mixer app loads it there), so
// the sound keeps playing after the app closes; the taskbar chip
// (shell mixerTrayTick) and the app both drive it through
// window.__orosMixerHost. Every sound is synthesized live with Web
// Audio: no audio files, no network.
// Host API (plain JSON in and out; nothing keeps the app's objects):
//   play({ mix, vol, mute, timer, label }) → "ok" | "none" | "noaudio"
//   pause(reason) · toggle() · stop() (pause + the chip goes away)
//   update({ mix?, vol?, mute?, label? })  live changes
//   setTimer(minutes)                      0 = off; restarts while playing
//   state() → { active, playing, endAt, mix, vol, mute, timer, label }
//   subscribe(fn(event)) → unsubscribe; events "play" | "pause" |
//     "change" | "timer" (the sleep timer ended) | "tick" (1/s playing)
//   selfTest(id, seconds, nc) → Promise<{ rms, peak, nan }> (harness)
// Sections:
//   1. Constants + helpers
//   2. Sound: noise buffers, envelopes, the channel builders
//   3. Engine: context, channels, scheduler, play / pause, timer
//   4. Host
// ============================================================
(function (w) {
  "use strict";
  if (w.__orosMixerHost) return;                     // one engine per shell

  // ---------- 1. Constants + helpers ----------
  var CHANNELS = ["rain", "thunder", "wind", "waves", "stream", "fire", "cafe",
                  "crickets", "birds", "noise", "train", "keyboard", "clock"];
  var NOISE_COLORS = ["pink", "brown", "white"];
  var FADE_MS = 30000;                               // sleep-timer fade-out
  var TIMERS = [0, 15, 30, 60, 90];

  function clampInt(v, lo, hi, dflt) {
    if (typeof v !== "number" || !isFinite(v)) return dflt;
    v = Math.round(v);
    return v < lo ? lo : (v > hi ? hi : v);
  }
  // The app's mix, copied into this window (fixed shape).
  function copyMix(m) {
    m = (m && typeof m === "object") ? m : {};
    var src = (m.ch && typeof m.ch === "object") ? m.ch : {}, ch = {};
    CHANNELS.forEach(function (id) {
      var c = (src[id] && typeof src[id] === "object") ? src[id] : {};
      ch[id] = { o: c.o === 1 ? 1 : 0, v: clampInt(c.v, 0, 100, 50) };
    });
    return { ch: ch, nc: NOISE_COLORS.indexOf(m.nc) >= 0 ? m.nc : "pink" };
  }
  function anyOn(m) { return CHANNELS.some(function (id) { return m.ch[id].o === 1 && m.ch[id].v > 0; }); }
  // Perceived loudness: level² (a slider at half sounds about half).
  function levelGain(v) { var x = clampInt(v, 0, 100, 0) / 100; return x * x; }
  // Sleep-timer fade: 1 until the last 30 s, then linear to 0.
  function fadeFactor(remainingMs) {
    if (!(remainingMs > 0)) return 0;
    return remainingMs >= FADE_MS ? 1 : remainingMs / FADE_MS;
  }

  // ---------- 2. Sound ----------
  // A channel builder gets (ctx, out, rnd, opts) and returns
  //   { tick(from, to), stop(at) }
  // tick schedules every event that starts in [from, to); the engine
  // calls it a little ahead of time. It works the same on an
  // OfflineAudioContext (the self-test renders each channel).
  function rr(rnd, a, b) { return a + (b - a) * rnd(); }

  function noiseBuf(ctx, kind) {
    ctx.__orosNoise = ctx.__orosNoise || {};
    if (ctx.__orosNoise[kind]) return ctx.__orosNoise[kind];
    var len = Math.floor(ctx.sampleRate * 4);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        if (kind === "white") d[i] = w * 0.5;
        else if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else {                                   // pink (Paul Kellet)
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
      }
    }
    ctx.__orosNoise[kind] = buf;
    return buf;
  }

  function Bag(ctx) { this.ctx = ctx; this.srcs = []; }
  Bag.prototype.loop = function (kind, at) {
    var s = this.ctx.createBufferSource();
    s.buffer = noiseBuf(this.ctx, kind);
    s.loop = true;
    s.start(at || 0, Math.random() * s.buffer.duration);
    this.srcs.push(s);
    return s;
  };
  Bag.prototype.stop = function (at) {
    this.srcs.forEach(function (s) { try { s.stop(at); } catch (e) {} });
    this.srcs = [];
  };

  function node(ctx, kind, props) {
    var n = kind === "gain" ? ctx.createGain()
          : kind === "pan" ? (ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain())
          : ctx.createBiquadFilter();
    if (kind !== "gain" && kind !== "pan") n.type = kind;
    Object.keys(props || {}).forEach(function (k) {
      if (n[k] && n[k].setValueAtTime) n[k].value = props[k];
    });
    return n;
  }

  function chain() {
    for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]);
    return arguments[arguments.length - 1];
  }

  // One short noise burst through a filter, with an envelope.
  function burst(ctx, out, at, o) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf(ctx, o.kind || "white");
    var f = node(ctx, o.type || "bandpass", { frequency: o.f, Q: o.q || 1 });
    var g = node(ctx, "gain", { gain: 0 });
    var p = node(ctx, "pan", { pan: o.pan || 0 });
    chain(s, f, g, p, out);
    var a = o.a || 0.002;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(o.peak, at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + a + o.d);
    s.start(at, Math.random() * (s.buffer.duration - 1));
    s.stop(at + a + o.d + 0.05);
  }

  // One tone: sine from f0 to f1, with an envelope.
  function tone(ctx, out, at, o) {
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(o.f0, at);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, at + o.d);
    var g = node(ctx, "gain", { gain: 0 });
    var p = node(ctx, "pan", { pan: o.pan || 0 });
    chain(osc, g, p, out);
    var a = o.a || 0.005;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(o.peak, at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + a + o.d);
    osc.start(at);
    osc.stop(at + a + o.d + 0.05);
  }

  // Poisson-ish events: calls fire(t) for every event in [from, to).
  function every(state, key, from, to, gap, fire) {
    if (state[key] === undefined || state[key] < from - 1) state[key] = from + gap();
    while (state[key] < to) {
      fire(Math.max(state[key], from));
      state[key] += gap();
    }
  }

  var BUILD = {
    rain: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {};
      var bed = chain(bag.loop("pink"), node(ctx, "highpass", { frequency: 450 }),
                      node(ctx, "lowpass", { frequency: 9000 }), node(ctx, "gain", { gain: 0.55 }));
      bed.connect(out);
      return {
        tick: function (from, to) {
          every(st, "swell", from, to, function () { return rr(rnd, 2, 5); }, function (at) {
            bed.gain.setTargetAtTime(rr(rnd, 0.42, 0.65), at, 1.5);
          });
          every(st, "drop", from, to, function () { return -Math.log(1 - rnd()) / 28; }, function (at) {
            burst(ctx, out, at, { f: rr(rnd, 2500, 7500), q: rr(rnd, 1, 4), peak: rr(rnd, 0.03, 0.12),
                                  d: rr(rnd, 0.015, 0.05), pan: rr(rnd, -0.8, 0.8) });
          });
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    thunder: function (ctx, out, rnd) {
      var st = {};
      return {
        tick: function (from, to) {
          if (st.next === undefined) st.next = from + rr(rnd, 1, 5);
          while (st.next < to) {
            var at = Math.max(st.next, from);
            var s = ctx.createBufferSource();
            s.buffer = noiseBuf(ctx, "brown");
            var lp = node(ctx, "lowpass", { frequency: rr(rnd, 180, 420), Q: 0.7 });
            var g = node(ctx, "gain", { gain: 0 });
            var p = node(ctx, "pan", { pan: rr(rnd, -0.6, 0.6) });
            chain(s, lp, g, p, out);
            var atk = rr(rnd, 0.08, 0.9), dec = rr(rnd, 3, 7), peak = rr(rnd, 0.7, 1.2);
            g.gain.setValueAtTime(0.0001, at);
            g.gain.linearRampToValueAtTime(peak, at + atk);
            g.gain.setTargetAtTime(peak * 0.5, at + atk, 0.4);
            g.gain.exponentialRampToValueAtTime(0.0001, at + atk + dec);
            lp.frequency.setTargetAtTime(80, at + atk, dec / 3);
            s.start(at, Math.random() * 3);
            s.stop(at + atk + dec + 0.1);
            if (rnd() < 0.35) burst(ctx, out, at, { f: rr(rnd, 900, 2200), q: 0.8, peak: 0.35, d: 0.18, a: 0.004 });
            st.next += rr(rnd, 12, 40);
          }
        },
        stop: function () {}
      };
    },

    wind: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {};
      var bp = node(ctx, "bandpass", { frequency: 420, Q: 0.8 });
      var g = node(ctx, "gain", { gain: 0.8 });
      chain(bag.loop("brown"), bp, g, out);
      var wbp = node(ctx, "bandpass", { frequency: 1300, Q: 6 });
      var wg = node(ctx, "gain", { gain: 0.02 });
      chain(bag.loop("pink"), wbp, wg, out);
      return {
        tick: function (from, to) {
          every(st, "gust", from, to, function () { return rr(rnd, 0.8, 2.5); }, function (at) {
            var k = rnd();
            bp.frequency.setTargetAtTime(250 + k * 500, at, 1.4);
            g.gain.setTargetAtTime(0.35 + k * 0.9, at, 1.8);
            wbp.frequency.setTargetAtTime(rr(rnd, 900, 1800), at, 2);
            wg.gain.setTargetAtTime(k * 0.06, at, 2);
          });
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    waves: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {};
      var lp = node(ctx, "lowpass", { frequency: 400 });
      var g = node(ctx, "gain", { gain: 0.15 });
      chain(bag.loop("brown"), lp, g, out);
      var hp = node(ctx, "highpass", { frequency: 1500 });
      var hg = node(ctx, "gain", { gain: 0.01 });
      chain(bag.loop("pink"), hp, hg, out);
      return {
        tick: function (from, to) {
          if (st.next === undefined) st.next = from;
          while (st.next < to) {
            var at = Math.max(st.next, from), per = rr(rnd, 6, 11), up = per * rr(rnd, 0.35, 0.45);
            var peak = rr(rnd, 0.7, 1.1);
            g.gain.setValueAtTime(0.15, at);
            g.gain.linearRampToValueAtTime(peak, at + up);
            g.gain.linearRampToValueAtTime(0.15, at + per);
            lp.frequency.setValueAtTime(350, at);
            lp.frequency.linearRampToValueAtTime(rr(rnd, 1100, 1700), at + up);
            lp.frequency.linearRampToValueAtTime(350, at + per);
            hg.gain.setValueAtTime(0.01, at);
            hg.gain.linearRampToValueAtTime(peak * 0.16, at + up + 0.3);
            hg.gain.linearRampToValueAtTime(0.01, at + per);
            st.next += per;
          }
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    stream: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {};
      chain(bag.loop("pink"), node(ctx, "bandpass", { frequency: 1700, Q: 0.6 }), node(ctx, "gain", { gain: 0.45 }), out);
      chain(bag.loop("white"), node(ctx, "highpass", { frequency: 3500 }), node(ctx, "gain", { gain: 0.04 }), out);
      return {
        tick: function (from, to) {
          every(st, "bub", from, to, function () { return -Math.log(1 - rnd()) / 11; }, function (at) {
            var f0 = rr(rnd, 500, 1400);
            tone(ctx, out, at, { f0: f0, f1: f0 * rr(rnd, 1.3, 2.1), d: rr(rnd, 0.025, 0.07),
                                 peak: rr(rnd, 0.01, 0.045), pan: rr(rnd, -0.7, 0.7), a: 0.003 });
          });
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    fire: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {};
      var roar = node(ctx, "gain", { gain: 0.4 });
      chain(bag.loop("brown"), node(ctx, "lowpass", { frequency: 420 }), roar, out);
      return {
        tick: function (from, to) {
          every(st, "roar", from, to, function () { return rr(rnd, 1, 3); }, function (at) {
            roar.gain.setTargetAtTime(rr(rnd, 0.28, 0.5), at, 0.8);
          });
          every(st, "crk", from, to, function () {
            return rnd() < 0.3 ? rr(rnd, 0.01, 0.05) : -Math.log(1 - rnd()) / 6;    // clusters
          }, function (at) {
            burst(ctx, out, at, { type: "highpass", f: rr(rnd, 1500, 5000), q: 0.7, peak: rr(rnd, 0.1, 0.5),
                                  d: rr(rnd, 0.004, 0.03), a: 0.0008, pan: rr(rnd, -0.4, 0.4) });
          });
          every(st, "pop", from, to, function () { return rr(rnd, 0.6, 2.5); }, function (at) {
            burst(ctx, out, at, { f: rr(rnd, 300, 900), q: 3, peak: rr(rnd, 0.15, 0.35), d: 0.08, a: 0.001,
                                  pan: rr(rnd, -0.3, 0.3) });
          });
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    cafe: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {}, voices = [];
      chain(bag.loop("pink"), node(ctx, "lowpass", { frequency: 600 }), node(ctx, "gain", { gain: 0.12 }), out);
      for (var i = 0; i < 5; i++) {
        var f = node(ctx, "bandpass", { frequency: rr(rnd, 250, 950), Q: rr(rnd, 2, 5) });
        var g = node(ctx, "gain", { gain: 0 });
        chain(bag.loop("pink"), f, g, node(ctx, "pan", { pan: rr(rnd, -0.7, 0.7) }), out);
        voices.push({ f: f, g: g });
      }
      return {
        tick: function (from, to) {
          voices.forEach(function (v, i) {
            every(st, "v" + i, from, to, function () { return rr(rnd, 0.12, 0.45); }, function (at) {
              var talking = rnd() < 0.7;
              v.g.gain.setTargetAtTime(talking ? rr(rnd, 0.25, 0.7) : 0, at, 0.05);
              v.f.frequency.setTargetAtTime(rr(rnd, 250, 950), at, 0.1);
            });
          });
          every(st, "clink", from, to, function () { return rr(rnd, 1.5, 6); }, function (at) {
            var base = rr(rnd, 2000, 3400), pan = rr(rnd, -0.8, 0.8), d = rr(rnd, 0.15, 0.4);
            [1, 2.76, 5.4].forEach(function (k, j) {
              tone(ctx, out, at, { f0: base * k, d: d / (j + 1), peak: 0.05 / (j + 1), pan: pan, a: 0.001 });
            });
          });
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    crickets: function (ctx, out, rnd) {
      var st = {}, bugs = [], oscs = [];
      for (var i = 0; i < 3; i++) {
        var osc = ctx.createOscillator();
        osc.frequency.value = rr(rnd, 4200, 5200);
        var g = node(ctx, "gain", { gain: 0 });
        chain(osc, g, node(ctx, "pan", { pan: rr(rnd, -0.8, 0.8) }), out);
        osc.start(0);
        oscs.push(osc);
        bugs.push({ g: g, amp: rr(rnd, 0.05, 0.12) });
      }
      return {
        tick: function (from, to) {
          bugs.forEach(function (b, i) {
            every(st, "c" + i, from, to, function () { return rnd() < 0.12 ? rr(rnd, 2, 5) : rr(rnd, 0.6, 1.2); }, function (at) {
              var n = 3 + Math.floor(rnd() * 2);
              for (var k = 0; k < n; k++) {
                var p = at + k * 0.04;
                b.g.gain.setValueAtTime(0, p);
                b.g.gain.linearRampToValueAtTime(b.amp, p + 0.004);
                b.g.gain.setValueAtTime(b.amp, p + 0.014);
                b.g.gain.linearRampToValueAtTime(0, p + 0.019);
              }
            });
          });
        },
        stop: function (at) { oscs.forEach(function (o) { try { o.stop(at); } catch (e) {} }); }
      };
    },

    birds: function (ctx, out, rnd) {
      var st = {};
      return {
        tick: function (from, to) {
          every(st, "song", from, to, function () { return rr(rnd, 1, 4); }, function (at) {
            var n = 2 + Math.floor(rnd() * 5), pan = rr(rnd, -0.8, 0.8), p = at;
            var base = rr(rnd, 2500, 5000);
            for (var k = 0; k < n; k++) {
              var d = rr(rnd, 0.05, 0.15), f0 = base * rr(rnd, 0.85, 1.2);
              tone(ctx, out, p, { f0: f0, f1: f0 * rr(rnd, 0.7, 1.45), d: d, peak: rr(rnd, 0.08, 0.18), pan: pan, a: 0.008 });
              p += d + rr(rnd, 0.02, 0.09);
            }
          });
        },
        stop: function () {}
      };
    },

    // A train: low rumble with a slow sway, the wheels' "ta-dum ta-dum"
    // over the rail joints, now and then a distant horn.
    train: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {};
      var rumble = node(ctx, "gain", { gain: 0.5 });
      var lp = node(ctx, "lowpass", { frequency: 220, Q: 0.8 });
      chain(bag.loop("brown"), lp, rumble, out);
      chain(bag.loop("pink"), node(ctx, "bandpass", { frequency: 900, Q: 0.7 }), node(ctx, "gain", { gain: 0.05 }), out);
      var beat = rr(rnd, 0.95, 1.25);                // seconds between joints
      return {
        tick: function (from, to) {
          every(st, "sway", from, to, function () { return rr(rnd, 2, 4); }, function (at) {
            rumble.gain.setTargetAtTime(rr(rnd, 0.38, 0.6), at, 1.2);
            lp.frequency.setTargetAtTime(rr(rnd, 170, 300), at, 1.5);
          });
          if (st.joint === undefined || st.joint < from - 1) st.joint = from + rr(rnd, 0.1, 0.6);
          while (st.joint < to) {
            var at = Math.max(st.joint, from), pan = rr(rnd, -0.2, 0.2);
            [0, 0.16].forEach(function (dt, k) {
              burst(ctx, out, at + dt, { kind: "brown", type: "lowpass", f: rr(rnd, 500, 800), q: 1,
                                         peak: rr(rnd, 0.5, 0.75) * (k ? 0.8 : 1), d: 0.09, a: 0.003, pan: pan });
              burst(ctx, out, at + dt, { f: rr(rnd, 1800, 2600), q: 3, peak: 0.05, d: 0.03, a: 0.001, pan: pan });
            });
            st.joint += beat * rr(rnd, 0.97, 1.03);
          }
          every(st, "horn", from, to, function () { return rr(rnd, 70, 160); }, function (at) {
            var f = rr(rnd, 280, 340), d = rr(rnd, 1.2, 2.2);
            [1, 1.26].forEach(function (k) {
              tone(ctx, out, at, { f0: f * k, f1: f * k * 0.985, d: d, peak: 0.035, pan: rr(rnd, -0.5, 0.5), a: 0.25 });
            });
          });
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    // Someone typing: bursts of key clicks in words, a lower space bar,
    // pauses to think.
    keyboard: function (ctx, out, rnd) {
      var st = {};
      return {
        tick: function (from, to) {
          if (st.next === undefined || st.next < from - 1) st.next = from + rr(rnd, 0.1, 0.8);
          while (st.next < to) {
            var at = Math.max(st.next, from), pan = rr(rnd, -0.25, 0.25);
            var space = (st.left || 0) <= 0;
            if (space) {
              burst(ctx, out, at, { f: rr(rnd, 500, 800), q: 1.5, peak: rr(rnd, 0.4, 0.55), d: 0.05, a: 0.002, pan: pan });
              burst(ctx, out, at, { type: "highpass", f: 1800, q: 0.7, peak: 0.13, d: 0.025, a: 0.001, pan: pan });
              st.left = 2 + Math.floor(rnd() * 8);           // letters in the next word
              st.next += rnd() < 0.15 ? rr(rnd, 0.9, 2.8) : rr(rnd, 0.12, 0.3);
            } else {
              burst(ctx, out, at, { type: "highpass", f: rr(rnd, 2200, 4200), q: 0.8, peak: rr(rnd, 0.2, 0.35),
                                    d: rr(rnd, 0.012, 0.025), a: 0.0008, pan: pan });
              burst(ctx, out, at + 0.004, { f: rr(rnd, 900, 1500), q: 2, peak: rr(rnd, 0.08, 0.16), d: 0.03, a: 0.001, pan: pan });
              st.left -= 1;
              st.next += rr(rnd, 0.07, 0.19);
            }
          }
        },
        stop: function () {}
      };
    },

    // A wall clock: tick … tock, once a second, a little uneven.
    clock: function (ctx, out, rnd) {
      var st = {}, f = rr(rnd, 2600, 3400);
      return {
        tick: function (from, to) {
          if (st.next === undefined || st.next < from - 1) { st.next = from + 0.2; st.n = 0; }
          while (st.next < to) {
            var at = Math.max(st.next, from), tock = st.n % 2 === 1;
            burst(ctx, out, at, { f: tock ? f * 0.78 : f, q: 9, peak: rr(rnd, 0.8, 0.95), d: 0.014, a: 0.0005, pan: tock ? 0.05 : -0.05 });
            burst(ctx, out, at, { kind: "brown", type: "lowpass", f: 600, q: 1, peak: 0.25, d: 0.03, a: 0.001 });
            st.n++;
            st.next += 1 + rr(rnd, -0.004, 0.004);
          }
        },
        stop: function () {}
      };
    },

    noise: function (ctx, out, rnd, o) {
      var bag = new Bag(ctx);
      var kind = (o && NOISE_COLORS.indexOf(o.nc) >= 0) ? o.nc : "pink";
      chain(bag.loop(kind), node(ctx, "gain", { gain: kind === "white" ? 0.35 : 0.6 }), out);
      return { tick: function () {}, stop: function (at) { bag.stop(at); } };
    }
  };


  // ---------- 3. Engine ----------
  var ctx = null, master = null, live = {}, playing = false, active = false;
  var schedTimer = null, tickTimer = null, endAt = 0;
  var cur = { mix: copyMix(null), vol: 70, mute: 0, timer: 0, label: "" };
  var subs = [];

  function emit(ev) {
    for (var i = subs.length - 1; i >= 0; i--) {
      try { subs[i](ev); } catch (e) { subs.splice(i, 1); }   // a closed frame
    }
  }

  function audioCtor() { return w.AudioContext || w.webkitAudioContext || null; }

  function ensureCtx() {
    if (ctx) return true;
    var C = audioCtor();
    if (!C) return false;
    try {
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0;
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.3;
      master.connect(comp);
      comp.connect(ctx.destination);
      return true;
    } catch (e) { ctx = null; return false; }
  }

  function masterTarget() {
    if (cur.mute) return 0;
    var g = levelGain(cur.vol);
    if (endAt) g *= fadeFactor(endAt - Date.now());
    return g;
  }
  function applyMaster(tc) {
    if (!ctx) return;
    master.gain.setTargetAtTime(playing ? masterTarget() : 0, ctx.currentTime, tc || 0.15);
  }

  function chanTarget(id) { return levelGain(cur.mix.ch[id].v); }

  function startChannel(id) {
    var g = ctx.createGain();
    g.gain.value = 0;
    g.connect(master);
    var inst = BUILD[id](ctx, g, Math.random, { nc: cur.mix.nc });
    inst.out = g;
    inst.until = ctx.currentTime;
    inst.nc = cur.mix.nc;
    live[id] = inst;
    g.gain.setTargetAtTime(chanTarget(id), ctx.currentTime, 0.25);
    inst.tick(inst.until, ctx.currentTime + 0.4);
    inst.until = ctx.currentTime + 0.4;
  }

  function stopChannel(id) {
    var inst = live[id];
    if (!inst) return;
    delete live[id];
    var now = ctx.currentTime;
    inst.out.gain.setTargetAtTime(0, now, 0.2);
    inst.stop(now + 1.5);
    w.setTimeout(function () { try { inst.out.disconnect(); } catch (e) {} }, 2000);
  }

  // Bring the running channels in line with the mix.
  function syncChannels() {
    if (!ctx || !playing) return;
    CHANNELS.forEach(function (id) {
      var on = cur.mix.ch[id].o === 1 && cur.mix.ch[id].v > 0;
      if (on && live[id] && id === "noise" && live[id].nc !== cur.mix.nc) stopChannel(id);
      if (on && !live[id]) startChannel(id);
      else if (!on && live[id]) stopChannel(id);
      else if (on) live[id].out.gain.setTargetAtTime(chanTarget(id), ctx.currentTime, 0.15);
    });
  }

  function schedule() {
    if (!ctx || !playing) return;
    var to = ctx.currentTime + 0.4;
    Object.keys(live).forEach(function (id) {
      var inst = live[id];
      if (inst.until < to) {
        try { inst.tick(Math.max(inst.until, ctx.currentTime), to); } catch (e) { console.error("[orOS] mixer " + id, e); }
        inst.until = to;
      }
    });
  }

  function tick() {
    if (playing && endAt) {
      var left = endAt - Date.now();
      if (left <= 0) { pause("timer"); emit("timer"); return; }
      if (left < FADE_MS + 1000) applyMaster(0.5);
    }
    emit("tick");
  }

  function take(o) {
    if (!o || typeof o !== "object") return;
    if (o.mix) cur.mix = copyMix(JSON.parse(JSON.stringify(o.mix)));
    if (o.vol !== undefined) cur.vol = clampInt(o.vol, 0, 100, cur.vol);
    if (o.mute !== undefined) cur.mute = o.mute ? 1 : 0;
    if (o.timer !== undefined) cur.timer = TIMERS.indexOf(o.timer) >= 0 ? o.timer : 0;
    if (typeof o.label === "string") cur.label = o.label.slice(0, 60);
  }

  function play(o) {
    take(o);
    if (!anyOn(cur.mix)) return "none";
    if (!ensureCtx()) return "noaudio";
    playing = true;
    active = true;
    if (ctx.state === "suspended" && ctx.resume) ctx.resume();
    if (cur.timer && !endAt) endAt = Date.now() + cur.timer * 60000;
    syncChannels();
    applyMaster(0.3);
    w.clearInterval(schedTimer);
    schedTimer = w.setInterval(schedule, 100);
    w.clearInterval(tickTimer);
    tickTimer = w.setInterval(tick, 1000);
    mediaSession();
    emit("play");
    return "ok";
  }

  function pause(reason) {
    if (!playing) return;
    playing = false;
    endAt = 0;
    w.clearInterval(schedTimer); schedTimer = null;
    w.clearInterval(tickTimer); tickTimer = null;
    if (ctx) {
      applyMaster(0.12);
      var c = ctx;
      w.setTimeout(function () {
        if (playing || c !== ctx) return;
        Object.keys(live).forEach(stopChannel);
        if (c.suspend) c.suspend();
      }, 600);
    }
    mediaSession();
    if (reason !== "timer") emit("pause");
  }

  function mediaSession() {
    try {
      var ms = w.navigator.mediaSession;
      if (!ms || typeof w.MediaMetadata !== "function") return;
      ms.metadata = new w.MediaMetadata({ title: cur.label || "Sound Mixer", artist: "orOS · Sound Mixer" });
      ms.setActionHandler("play", function () { play(); });
      ms.setActionHandler("pause", function () { pause(); });
      ms.playbackState = playing ? "playing" : "paused";
    } catch (e) {}
  }

  // ---------- 4. Host ----------
  w.__orosMixerHost = {
    ver: 1,
    CHANNELS: CHANNELS.slice(),
    play: play,
    pause: function (reason) { pause(typeof reason === "string" ? reason : ""); },
    toggle: function () { if (playing) pause(); else play(); },
    stop: function () { pause(); active = false; emit("change"); },
    update: function (o) {
      take(o);
      if (o && o.mix) {
        syncChannels();
        if (playing && !anyOn(cur.mix)) pause();
      }
      applyMaster(0.08);
      if (o && o.label !== undefined) mediaSession();
      emit("change");
    },
    setTimer: function (minutes) {
      take({ timer: minutes });
      endAt = (playing && cur.timer) ? Date.now() + cur.timer * 60000 : 0;
      applyMaster(0.3);
      emit("change");
    },
    state: function () {
      return { active: active, playing: playing, endAt: endAt, mix: JSON.parse(JSON.stringify(cur.mix)),
               vol: cur.vol, mute: cur.mute, timer: cur.timer, label: cur.label };
    },
    subscribe: function (fn) {
      if (typeof fn !== "function") return function () {};
      subs.push(fn);
      return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    },
    // Renders one channel offline and reports its level (harness).
    selfTest: function (id, seconds, nc) {
      var O = w.OfflineAudioContext || w.webkitOfflineAudioContext;
      if (!O || !BUILD[id]) return Promise.resolve(null);
      var sr = 22050, oc = new O(2, Math.floor(sr * seconds), sr);
      var g = oc.createGain();
      g.connect(oc.destination);
      var inst = BUILD[id](oc, g, Math.random, { nc: nc || "pink" });
      inst.tick(0, seconds);
      return oc.startRendering().then(function (buf) {
        var sum = 0, peak = 0, nan = 0, n = 0;
        for (var c = 0; c < buf.numberOfChannels; c++) {
          var d = buf.getChannelData(c);
          for (var i = 0; i < d.length; i++) {
            var v = d[i];
            if (v !== v) { nan++; continue; }
            sum += v * v; n++;
            if (Math.abs(v) > peak) peak = Math.abs(v);
          }
        }
        return { rms: Math.sqrt(sum / Math.max(1, n)), peak: peak, nan: nan };
      });
    }
  };
})(window);
