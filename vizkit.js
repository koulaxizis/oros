// ============================================================
// orOS — vizkit.js: light that moves with the sound (MU-VIZ,
// Chris 2026-11-17, option B: Music first, then Radio and Podcasts).
// ------------------------------------------------------------
// One shared look for the "Now playing" screens of the sound apps.
// The app owns the button, the canvas and the words around it; the
// kit only draws:
//
//   <script src="../vizkit.js"></script>      (or loaded on first use)
//   var v = OrosViz.create(canvas, {
//     source:  function () { return { live, f, w } | null },  // f = byte
//              // frequency bins, w = byte time-domain samples (an
//              // AnalyserNode's arrays; any realm), live = real sound
//     playing: function () { return bool },
//     colors:  function () { return { a: "#rrggbb", bg: "#rrggbb" } },
//              // bg "transparent" (1.2.0): cleared, for a light over a card
//     style:   "glow" | "rings" | "bars" | "wave",
//     area:    function () { return { x, y, w, h } },  // optional: the
//              // free space in canvas CSS pixels the light centres on
//     onState: function (reason) {}, // "", "reduced", "battery", "slow",
//              // "saver" (only with opts.saver)
//     // Desktop wallpaper (1.2.0, VIZWALL-1), all optional:
//     saver:   function () { return bool },  // Energy saver on: still
//     paused:  function () { return bool },  // covered (an app is open):
//              // no frames at all until wake()
//     soft:    0.6,     // light strength 0..1 (icons stay readable)
//     rest:    true     // nothing playing = the levels settle on the
//              // still picture and the loop stops (never goes dark)
//   });
//   v.setStyle(id); v.wake(); v.redraw(); v.destroy();
//
// No sound data (a stream from a site that does not allow reading
// it): the light breathes on its own, slowly, and source().live is
// false so the app can say why.
//
// Rules (the live wallpaper rules of seasonal.js / land.js):
//   - at most 30 frames a second, nothing while the tab is hidden,
//     paused and quiet = the loop stops (wake() starts it again);
//   - reduced motion (watched live), a low battery (< 20 %, not
//     charging) or a slow device leave one still picture;
//   - slow device (1.3.0, VIZ-SLOW): the median frame gap over 90
//     frames above 55 ms, counted only after the first 20 s of the
//     page (start-up work is not the light's fault); the first time
//     the light goes lighter (15 fps, devicePixelRatio 1), after that
//     it rests for 1, 2, 4 ... at most 10 minutes and tries again by
//     itself (it used to stay still for the whole session, so a busy
//     start on a phone stopped it for good);
//   - canvas at devicePixelRatio <= 1.25 and <= 1.8 M pixels;
//   - the beat (1.4.0, MU-VIZ-BEAT, Chris 2026-11-27 "it does not follow
//     the rhythm and the energy"): with real sound, a rise of the bass
//     well above its recent rises (beatStep: spectral flux over a
//     running mean + 1.8 standard deviations, at least 0.06, to
//     a level 15 % over the bass's recent average, at most one beat per
//     200 ms) is a beat; each style answers it (glow swells, a ring
//     starts, the bars jump, the wave grows) and the pulse fades over
//     ~250 ms. Levels with real sound follow faster (up 0.6, down 0.18
//     a frame); without sound the light moves slowly on its own and
//     never imitates a beat;
//   - no flashes: levels rise over ~3 frames and fall over ~12, the
//     brightest layer stays under 0.85 alpha, no white frames, no
//     strobing colour changes (photosensitivity).
// Nothing is stored, nothing is sent. The pure part (bands, smoothing,
// colours, still reasons, labels) runs in Node: tests/vizkit.test.js.
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.4.0";
  var STYLES = ["glow", "rings", "bars", "wave"];
  var FPS_GAP = 1000 / 30;
  var SLOW_MS = 55, SLOW_N = 90;
  var BOOT_MS = 20000;        // frame gaps of the page's first 20 s never count
  var slow = { lite: false, n: 0, until: 0 };   // this page: lighter light, then rests (VIZ-SLOW)

  var STR = {
    en: {
      btn: "Light show", on: "Light show on", off: "Light show off",
      style: "Light: {s}", next: "Next light style",
      glow: "Glow", rings: "Rings", bars: "Bars", wave: "Wave",
      immersive: "Light only", back: "Show the controls", close: "Close", play: "Play", pause: "Pause",
      calm: "This source does not let orOS listen to the sound, so the light moves on its own.",
      reduced: "Reduced motion is on, so the light stays still.",
      battery: "The battery is low, so the light stays still.",
      slow: "This device is busy, so the light rests for a few minutes and then moves again by itself.",
      saver: "Energy saver is on, so the light stays still."
    },
    el: {
      btn: "Φωτορυθμικό", on: "Φωτορυθμικό ενεργό", off: "Φωτορυθμικό ανενεργό",
      style: "Φως: {s}", next: "Επόμενο στυλ φωτός",
      glow: "Λάμψη", rings: "Κύκλοι", bars: "Στήλες", wave: "Κύμα",
      immersive: "Μόνο το φως", back: "Εμφάνιση χειριστηρίων", close: "Κλείσιμο", play: "Αναπαραγωγή", pause: "Παύση",
      calm: "Αυτή η πηγή δεν αφήνει το orOS να ακούσει τον ήχο, γι' αυτό το φως κινείται μόνο του.",
      reduced: "Οι μειωμένες κινήσεις είναι ενεργές, γι' αυτό το φως μένει ακίνητο.",
      battery: "Η μπαταρία είναι χαμηλή, γι' αυτό το φως μένει ακίνητο.",
      slow: "Η συσκευή είναι φορτωμένη, γι' αυτό το φως ξεκουράζεται λίγα λεπτά και μετά ξανακινείται μόνο του.",
      saver: "Η Εξοικονόμηση ενέργειας είναι ενεργή, γι' αυτό το φως μένει ακίνητο."
    },
    de: {
      btn: "Lichtshow", on: "Lichtshow an", off: "Lichtshow aus",
      style: "Licht: {s}", next: "Nächster Lichtstil",
      glow: "Leuchten", rings: "Ringe", bars: "Balken", wave: "Welle",
      immersive: "Nur das Licht", back: "Steuerung zeigen", close: "Schließen", play: "Abspielen", pause: "Pause",
      calm: "Diese Quelle lässt orOS den Ton nicht hören, darum bewegt sich das Licht von selbst.",
      reduced: "Reduzierte Bewegung ist an, darum bleibt das Licht still.",
      battery: "Der Akku ist schwach, darum bleibt das Licht still.",
      slow: "Dieses Gerät ist ausgelastet, darum ruht das Licht ein paar Minuten und bewegt sich dann von selbst wieder.",
      saver: "Der Energiesparen ist an, darum bleibt das Licht still."
    }
  };

  // ---------- Pure part ----------
  function lang2(l) { l = String(l || "").slice(0, 2).toLowerCase(); return STR[l] ? l : "en"; }
  function label(key, l, vars) {
    var s = STR[lang2(l)][key];
    if (s == null) s = STR.en[key];
    if (s == null) return key;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split("{" + n + "}").join(String(vars[n])); });
    return s;
  }
  function normStyle(s) { return STYLES.indexOf(s) >= 0 ? s : STYLES[0]; }
  function nextStyle(s) { return STYLES[(STYLES.indexOf(normStyle(s)) + 1) % STYLES.length]; }

  // Byte frequency bins → { lo, mid, hi, all } in 0..1. The bins cover
  // 0 .. rate / 2; bass < 250 Hz, mids < 2 kHz, the rest highs (to 10 kHz).
  function bands(f, rate) {
    var n = f && f.length ? f.length : 0;
    if (!n) return { lo: 0, mid: 0, hi: 0, all: 0 };
    var hz = (rate > 0 ? rate : 48000) / 2 / n;
    var edge = [20, 250, 2000, 10000], out = [0, 0, 0], tot = 0, cnt = 0;
    for (var b = 0; b < 3; b++) {
      var i0 = Math.max(0, Math.floor(edge[b] / hz)), i1 = Math.min(n, Math.max(i0 + 1, Math.ceil(edge[b + 1] / hz)));
      var s = 0;
      for (var i = i0; i < i1; i++) s += f[i];
      out[b] = i1 > i0 ? s / (i1 - i0) / 255 : 0;
      tot += s; cnt += i1 - i0;
    }
    return { lo: out[0], mid: out[1], hi: out[2], all: cnt ? tot / cnt / 255 : 0 };
  }
  // One step of a level towards its target: quick up, slow down.
  function smooth(prev, next, up, down) {
    prev = +prev || 0; next = +next || 0;
    return prev + (next - prev) * (next > prev ? (up == null ? 0.35 : up) : (down == null ? 0.08 : down));
  }
  // Auto gain: a quiet song (or a low volume) still moves the light.
  // → { peak, v } with v in 0..1.
  function gain(peak, x) {
    peak = Math.max((+peak || 0) * 0.996, +x || 0);
    var v = (+x || 0) / Math.max(peak, 0.12);
    return { peak: peak, v: Math.max(0, Math.min(1, v)) };
  }
  // One frame of beat finding on the bass level x (0..1) at time t ms.
  // s = { prev, m, v, e, at } (running mean / variance of the rises,
  // the bass's average level, the last beat): a beat is a rise well
  // above the usual rises to a level above the recent average.
  // → { s, beat } (a new state; beat true on a beat).
  function beatStep(s, x, t) {
    s = s || {};
    x = +x || 0;
    var prev = s.prev == null ? x : s.prev, rise = Math.max(0, x - prev);
    var m = s.m == null ? 0.01 : s.m, v = s.v == null ? 0.0004 : s.v, at = s.at == null ? -1e9 : s.at;
    var e = s.e == null ? x : s.e;   // the bass's recent average level
    var beat = rise > m + 1.8 * Math.sqrt(v) + 0.015 && rise > 0.06 && x > 0.12 && x > e * 1.15 && t - at >= 200;
    var d = rise - m;
    m += 0.06 * d;
    v = Math.max(1e-5, 0.94 * (v + 0.06 * d * d));
    return { s: { prev: x, m: m, v: v, e: e + 0.05 * (x - e), at: beat ? t : at }, beat: beat };
  }
  // Levels of the still picture (and of the wallpaper at rest).
  var REST = { lo: 0.4, mid: 0.32, hi: 0.24 };
  // How far levels are from the rest picture (sum of differences).
  function restGap(lv) { return Math.abs(lv.lo - REST.lo) + Math.abs(lv.mid - REST.mid) + Math.abs(lv.hi - REST.hi); }
  // The light on its own (no sound data): slow, soft, never still.
  function idle(t) {
    t = (+t || 0) / 1000;
    return {
      lo: 0.32 + 0.14 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1),
      mid: 0.26 + 0.1 * Math.sin(t * 0.61 + 2),
      hi: 0.18 + 0.08 * Math.sin(t * 1.3 + 4)
    };
  }
  // Why the light must stay still, "" when it may move.
  function stillReason(o) {
    o = o || {};
    if (o.reduced) return "reduced";
    if (o.saver) return "saver";
    if (o.battery && o.battery.level != null && !o.battery.charging && o.battery.level < 0.2) return "battery";
    if (o.slow) return "slow";
    return "";
  }
  // Median frame gap over the last SLOW_N frames above SLOW_MS? The
  // median, not the mean: a few long stalls (sync, an app loading)
  // say nothing about the light, most frames being late does.
  function isSlow(gaps) {
    if (!gaps || gaps.length < SLOW_N) return false;
    var a = gaps.slice(gaps.length - SLOW_N).sort(function (x, y) { return x - y; });
    return (a[(SLOW_N - 1) >> 1] + a[SLOW_N >> 1]) / 2 > SLOW_MS;
  }
  // How long the n-th rest of a slow device lasts: 1, 2, 4, 8, 10 min.
  function slowWait(n) { return Math.min(600000, 60000 * Math.pow(2, Math.max(0, (n | 0) - 1))); }
  function hex(c) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || "").trim());
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  // "rgb(1, 2, 3)" / "#abc" / "#aabbcc" → [r, g, b] or null.
  function rgb(c) {
    var m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(String(c || "").trim());
    if (m) return [+m[1], +m[2], +m[3]].map(function (x) { return Math.max(0, Math.min(255, x)); });
    return hex(c);
  }
  function toHsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  // Three colours of the light from the app's accent: the accent and
  // two neighbours on the colour wheel, saturated and bright enough to
  // glow on a dark screen. → ["hsl(...)", ...] (hue, sat %, light %).
  function palette(accent) {
    var c = rgb(accent) || [167, 139, 250];
    var hsl = toHsl(c), h = hsl[0], s = Math.max(0.55, hsl[1]), l = Math.min(0.7, Math.max(0.55, hsl[2]));
    return [0, 42, -48].map(function (dh) {
      return [Math.round(((h + dh) % 360 + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
    });
  }
  function hsla(p, a) { return "hsla(" + p[0] + "," + p[1] + "%," + p[2] + "%," + Math.max(0, Math.min(0.85, a)).toFixed(3) + ")"; }
  // Canvas size for a box: devicePixelRatio <= 1.25 and <= 1.8 M pixels.
  function fit(w, h, dpr) {
    var r = Math.min(1.25, Math.max(1, +dpr || 1));
    var px = w * h * r * r;
    if (px > 1.8e6) r = Math.sqrt(1.8e6 / Math.max(1, w * h));
    return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)), r: r };
  }
  // Byte bins → n bar heights in 0..1 on a log frequency scale
  // (40 Hz .. 12 kHz), so bass does not fill half the bars.
  function bars(f, n, rate) {
    var len = f && f.length ? f.length : 0, out = [];
    var hz = (rate > 0 ? rate : 48000) / 2 / Math.max(1, len);
    for (var i = 0; i < n; i++) {
      if (!len) { out.push(0); continue; }
      var a = 40 * Math.pow(300, i / n), b = 40 * Math.pow(300, (i + 1) / n);
      var i0 = Math.min(len - 1, Math.floor(a / hz)), i1 = Math.min(len, Math.max(i0 + 1, Math.ceil(b / hz)));
      var s = 0;
      for (var k = i0; k < i1; k++) s = Math.max(s, f[k]);
      out.push(s / 255);
    }
    return out;
  }

  // ---------- Drawing ----------
  // Each style draws around the box B {x, y, w, h} (the app's free
  // space: the cover's place, or the whole canvas) on a canvas W × H.
  function drawGlow(g, B, lv, t, pal) {
    var W = B.W, H = B.H, m = Math.max(Math.min(B.w, B.h), Math.min(W, H) * 0.7), cx = B.x + B.w / 2, cy = B.y + B.h / 2;
    var spots = [
      { p: pal[0], v: lv.lo, x: Math.sin(t * 0.00021) * 0.22, y: Math.cos(t * 0.00017) * 0.16, r: 0.42 },
      { p: pal[1], v: lv.mid, x: Math.cos(t * 0.00013 + 2) * 0.28, y: Math.sin(t * 0.00019 + 1) * 0.2, r: 0.34 },
      { p: pal[2], v: lv.hi, x: Math.sin(t * 0.00016 + 4) * 0.26, y: Math.cos(t * 0.00023 + 3) * 0.22, r: 0.3 }
    ];
    g.globalCompositeOperation = "lighter";
    spots.forEach(function (s) {
      var pp = (lv.p || 0) * (s === spots[0] ? 1 : 0.4);   // the beat swells the bass light most
      var x = cx + s.x * Math.max(B.w, W * 0.6), y = cy + s.y * Math.max(B.h, H * 0.5), r = m * (s.r + s.v * 0.32 + pp * 0.1);
      var gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, hsla(s.p, 0.25 + s.v * 0.55 + pp * 0.15));
      gr.addColorStop(0.55, hsla(s.p, 0.08 + s.v * 0.2));
      gr.addColorStop(1, hsla(s.p, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    });
    g.globalCompositeOperation = "source-over";
  }
  function drawRings(g, B, lv, t, pal, st) {
    var W = B.W, H = B.H, m = Math.min(B.w, B.h) * 1.15, cx = B.x + B.w / 2, cy = B.y + B.h / 2;
    // A new ring on each beat (real sound, 1.4.0); without sound data
    // when the bass rises, at most one every 160 ms; up to 9.
    st.rings = st.rings || [];
    var ringNow = lv.real ? !!lv.beat : lv.lo > (st.lastLo || 0) + 0.06 && lv.lo > 0.3;
    if (ringNow && t - (st.ringAt || 0) > 160 && st.rings.length < 9) {
      st.rings.push({ at: t, v: lv.lo, p: st.rings.length % 3 });
      st.ringAt = t;
    }
    st.lastLo = lv.lo;
    var core = g.createRadialGradient(cx, cy, 0, cx, cy, m * (0.16 + lv.lo * 0.2 + (lv.p || 0) * 0.06));
    core.addColorStop(0, hsla(pal[0], 0.3 + lv.lo * 0.45 + (lv.p || 0) * 0.15));
    core.addColorStop(1, hsla(pal[0], 0));
    g.fillStyle = core;
    g.fillRect(0, 0, W, H);
    g.lineCap = "round";
    st.rings = st.rings.filter(function (r) {
      var age = (t - r.at) / 2600;
      if (age >= 1 || age < 0) return false;
      g.strokeStyle = hsla(pal[r.p], (1 - age) * (0.25 + r.v * 0.5));
      g.lineWidth = Math.max(1, m * 0.012 * (1 - age) + m * 0.004);
      g.beginPath();
      g.arc(cx, cy, m * (0.14 + age * 0.62), 0, Math.PI * 2);
      g.stroke();
      return true;
    });
    // A slow ring that always turns, wider with the mids and highs.
    g.strokeStyle = hsla(pal[1], 0.2 + lv.mid * 0.4);
    g.lineWidth = Math.max(1, m * 0.006);
    g.setLineDash([m * 0.02, m * 0.03]);
    g.lineDashOffset = -t * 0.01;
    g.beginPath();
    g.arc(cx, cy, m * (0.3 + lv.hi * 0.08), 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  function drawBars(g, B, lv, t, pal, st, src) {
    var W = B.w, n = W < 520 * B.r ? 28 : 44;
    var hs = src && src.live && src.f ? bars(src.f, n, src.rate) : null;
    st.bars = st.bars || [];
    var gap = W / n, bw = Math.max(2, gap * 0.56), base = B.y + B.h * 0.78, maxH = B.h * 0.7;
    var grad = g.createLinearGradient(0, base - maxH, 0, base);
    grad.addColorStop(0, hsla(pal[1], 0.8));
    grad.addColorStop(1, hsla(pal[0], 0.7));
    var refl = g.createLinearGradient(0, base, 0, base + maxH * 0.45);
    refl.addColorStop(0, hsla(pal[0], 0.22));
    refl.addColorStop(1, hsla(pal[0], 0));
    for (var i = 0; i < n; i++) {
      // Real sound: the spectrum, lifted on the beat (most in the bass).
      // Without it: slow waves of the levels, never a fake beat.
      var target = hs ? (gain(st["pk" + i], hs[i]).v * 0.35 + hs[i] * 0.55) * (1 + (lv.p || 0) * (i < n / 3 ? 0.3 : 0.12))
        : (i < n / 3 ? lv.lo : i < 2 * n / 3 ? lv.mid : lv.hi) * (0.55 + 0.45 * Math.sin(t * 0.0005 + i * 0.7) * Math.sin(t * 0.0002 + i));
      if (hs) st["pk" + i] = Math.max((st["pk" + i] || 0) * 0.996, hs[i]);
      st.bars[i] = hs ? smooth(st.bars[i], Math.min(1.1, Math.max(0, target)), 0.6, 0.2) : smooth(st.bars[i], Math.max(0, target));
      var h = Math.max(bw, st.bars[i] * maxH), x = B.x + i * gap + (gap - bw) / 2;
      g.fillStyle = grad;
      round(g, x, base - h, bw, h, bw / 2);
      g.fillStyle = refl;
      round(g, x, base + 2, bw, h * 0.45, bw / 2);
    }
  }
  function drawWave(g, B, lv, t, pal, st, src) {
    var W = B.W, H = B.h, mid = B.y + B.h / 2;
    var w = src && src.live && src.w ? src.w : null;
    var layers = [[pal[0], lv.lo, 0.0011, 0], [pal[1], lv.mid, 0.0017, 2], [pal[2], lv.hi, 0.0023, 4]];
    g.lineCap = "round"; g.lineJoin = "round";
    layers.forEach(function (L, li) {
      var amp = H * (0.05 + L[1] * 0.2) * (1 + (li ? 0.2 : 0.5) * (lv.p || 0));
      g.strokeStyle = hsla(L[0], 0.35 + L[1] * 0.45);
      g.lineWidth = Math.max(1.5, Math.min(W, B.h) * (0.008 - li * 0.0015));
      g.beginPath();
      var steps = 64;
      for (var i = 0; i <= steps; i++) {
        var x = i / steps * W;
        var y = Math.sin(i / steps * Math.PI * (2 + li) + t * L[2] + L[3]) * amp;
        if (w && li === 0) {
          // The real waveform, smoothed over a few samples, on the first line.
          var k = Math.floor(i / steps * (w.length - 4)), s = 0;
          for (var j = 0; j < 4; j++) s += w[k + j] - 128;
          y = y * 0.4 + (s / 4 / 128) * H * 0.32;
        }
        y *= Math.sin(i / steps * Math.PI);      // calm at the edges
        if (i) g.lineTo(x, mid + y); else g.moveTo(x, mid + y);
      }
      g.stroke();
    });
  }
  function round(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
    g.fill();
  }
  var DRAW = { glow: drawGlow, rings: drawRings, bars: drawBars, wave: drawWave };

  // ---------- The live part ----------
  function create(canvas, opts) {
    opts = opts || {};
    var win = (canvas && canvas.ownerDocument && canvas.ownerDocument.defaultView) || root;
    var g = null;
    try { g = canvas.getContext("2d"); } catch (e) { g = null; }
    var style = normStyle(opts.style);
    var lv = { lo: 0, mid: 0, hi: 0 }, pk = { lo: 0, mid: 0, hi: 0 };
    var bt = null, pulse = 0;   // beat finding (1.4.0)
    var st = {}, raf = 0, last = 0, prevT = 0, gaps = [], quiet = 0, dead = false, drawT = 0;
    var soft = opts.soft > 0 && opts.soft < 1 ? +opts.soft : 1, rest = !!opts.rest;
    var reason = "", battery = null, mq = null, pal = palette("");
    var bat = null, slowT = 0;
    function now() { try { return win.performance.now(); } catch (e) { return Date.now(); } }

    function reduced() { return !!(mq && mq.matches); }
    function setReason() {
      var sv = false;
      try { sv = !!(opts.saver && opts.saver()); } catch (e) { sv = false; }
      var r = stillReason({ reduced: reduced(), saver: sv, battery: battery, slow: now() < slow.until });
      clearTimeout(slowT);
      if (r === "slow") slowT = setTimeout(function () { if (!dead) { reason = "-"; if (!setReason()) wake(); } }, Math.max(1000, slow.until - now() + 50));
      if (r !== reason) {
        reason = r;
        try { if (opts.onState) opts.onState(reason); } catch (e) {}
      }
      return reason;
    }
    function colours() {
      var c = null;
      try { c = opts.colors ? opts.colors() : null; } catch (e) { c = null; }
      pal = palette(c && c.a);
      return c || {};
    }
    function size() {
      var w = canvas.clientWidth || 300, h = canvas.clientHeight || 300;
      var f = fit(w, h, slow.lite ? 1 : win.devicePixelRatio);
      if (canvas.width !== f.w || canvas.height !== f.h) { canvas.width = f.w; canvas.height = f.h; }
      return f;
    }
    function covered() { try { return !!(opts.paused && opts.paused()); } catch (e) { return false; } }
    function frame(t, still) {
      if (!g) return;
      if (still) t = drawT; else drawT = t;
      var f = size(), W = f.w, H = f.h;
      var c = colours();
      var src = null;
      try { src = opts.source ? opts.source() : null; } catch (e) { src = null; }
      var playing = false;
      try { playing = !!(opts.playing && opts.playing()); } catch (e) {}
      var target, real = false;
      if (still) target = REST;
      else if (src && src.live && src.f) {
        real = true;
        var b = bands(src.f, src.rate);
        var a1 = gain(pk.lo, b.lo), a2 = gain(pk.mid, b.mid), a3 = gain(pk.hi, b.hi);
        pk.lo = a1.peak; pk.mid = a2.peak; pk.hi = a3.peak;
        target = { lo: a1.v, mid: a2.v, hi: a3.v };
        var bs = beatStep(bt, b.lo, t);
        bt = bs.s;
        pulse = bs.beat ? 1 : pulse * 0.86;
        lv.beat = bs.beat;
      } else if (playing) target = idle(t);
      else target = rest ? REST : { lo: 0, mid: 0, hi: 0 };
      if (!real) { pulse = 0; lv.beat = false; bt = null; }
      lv.p = pulse; lv.real = real;
      if (still) lv = { lo: target.lo, mid: target.mid, hi: target.hi, p: 0, beat: false };
      else if (real) { lv.lo = smooth(lv.lo, target.lo, 0.6, 0.18); lv.mid = smooth(lv.mid, target.mid, 0.6, 0.18); lv.hi = smooth(lv.hi, target.hi, 0.6, 0.18); }
      else { lv.lo = smooth(lv.lo, target.lo); lv.mid = smooth(lv.mid, target.mid); lv.hi = smooth(lv.hi, target.hi); }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      if (c && c.bg === "transparent") g.clearRect(0, 0, W, H);   // 1.2.0: over a card
      else { g.fillStyle = (c && c.bg) || "#0b0b10"; g.fillRect(0, 0, W, H); }
      var a = null;
      try { a = opts.area ? opts.area() : null; } catch (e) { a = null; }
      var B = a && a.w > 40 && a.h > 40 ? { x: a.x * f.r, y: a.y * f.r, w: a.w * f.r, h: a.h * f.r } : { x: 0, y: 0, w: W, h: H };
      B.W = W; B.H = H; B.r = f.r;
      g.globalAlpha = soft;
      try { DRAW[style](g, B, lv, t, pal, st, still ? null : src); } catch (e) {}
      g.globalAlpha = 1;
      quiet = !playing && (rest ? restGap(lv) < 0.01 : lv.lo + lv.mid + lv.hi < 0.03) ? quiet + 1 : 0;
    }
    function loop(t) {
      raf = 0;
      if (dead) return;
      var doc = canvas.ownerDocument;
      if (doc && doc.hidden) return;                   // visibilitychange wakes it
      if (covered()) { prevT = 0; return; }            // the owner wakes it
      if (prevT && t > BOOT_MS) { gaps.push(t - prevT); if (gaps.length > SLOW_N) gaps.shift(); }
      prevT = t;
      if (isSlow(gaps)) {
        gaps = [];
        if (!slow.lite) slow.lite = true;                  // first: a lighter light
        else { slow.n++; slow.until = now() + slowWait(slow.n); }   // then: rest, try again
      }
      if (setReason()) { frame(t, true); prevT = 0; return; }
      if (t - last >= (slow.lite ? 2 * FPS_GAP : FPS_GAP) - 2) { last = t; frame(t, false); }
      if (quiet > 30) { prevT = 0; return; }         // paused and dark: rest
      raf = win.requestAnimationFrame(loop);
    }
    function wake() {
      if (dead || raf) return;
      quiet = 0;
      prevT = 0;
      if (setReason()) { frame(0, true); return; }
      if (covered()) return;
      raf = win.requestAnimationFrame(loop);
    }
    // One picture now at the current levels (a resize, a new accent),
    // without starting the loop.
    function redraw() {
      if (dead || covered()) return;
      if (setReason()) { frame(0, true); return; }
      frame(drawT, false);
      if (!raf) wake();
    }
    function onVis() { if (!canvas.ownerDocument.hidden) wake(); }
    function onMq() { reason = "-"; if (!setReason()) wake(); else frame(0, true); }
    try {
      mq = win.matchMedia ? win.matchMedia("(prefers-reduced-motion: reduce)") : null;
      if (mq) { if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq); }
    } catch (e) { mq = null; }
    try { canvas.ownerDocument.addEventListener("visibilitychange", onVis); } catch (e) {}
    function readBattery(b) {
      bat = b;
      battery = { level: b.level, charging: b.charging };
      // Brave and the spec default say 1 + charging: unknown, never low.
      if (battery.level === 1 && battery.charging) battery = null;
    }
    function onBat() { if (bat) { readBattery(bat); if (setReason()) frame(0, true); else wake(); } }
    try {
      var nav = win.navigator;
      if (nav && typeof nav.getBattery === "function") nav.getBattery().then(function (b) {
        if (dead) return;
        readBattery(b);
        b.addEventListener("levelchange", onBat);
        b.addEventListener("chargingchange", onBat);
        onBat();
      }, function () {});
    } catch (e) {}

    setReason();
    wake();
    return {
      setStyle: function (s) { style = normStyle(s); st = {}; if (reason) frame(0, true); else wake(); },
      style: function () { return style; },
      wake: wake,
      redraw: redraw,
      // Re-read the still reasons (Energy saver changed): still now or moving again.
      check: function () { if (setReason()) frame(0, true); else wake(); },
      reason: function () { return reason; },
      destroy: function () {
        dead = true;
        clearTimeout(slowT);
        if (raf) { try { win.cancelAnimationFrame(raf); } catch (e) {} raf = 0; }
        try { canvas.ownerDocument.removeEventListener("visibilitychange", onVis); } catch (e) {}
        try { if (mq) { if (mq.removeEventListener) mq.removeEventListener("change", onMq); else if (mq.removeListener) mq.removeListener(onMq); } } catch (e) {}
        try { if (bat) { bat.removeEventListener("levelchange", onBat); bat.removeEventListener("chargingchange", onBat); } } catch (e) {}
      }
    };
  }

  // ---------- The stage (Radio, Podcasts: wave 2) ----------
  // A full-window light show over an app that has no big player of its
  // own: the light, the title, play / pause, the style, "Light only"
  // and the note, in the kit's own markup and style (.ovz-…).
  //   var s = OrosViz.stage({ lang, title(), sub(), playing(), toggle(),
  //     source(), colors(), style, onStyle(id), onClose() });
  //   s.paint() after every player change; s.close().
  var ICON = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/><circle cx="12" cy="12" r="3.5"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'
  };
  var CSS = [
    ".ovz-stage{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;border-radius:0;background:#08080d;color:#f3f3f8;color-scheme:dark;overflow:hidden;font:inherit}",
    ".ovz-stage::backdrop{background:#08080d}",
    ".ovz-c{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}",
    ".ovz-top,.ovz-bot{position:absolute;left:0;right:0;z-index:1;padding:max(10px,env(safe-area-inset-top)) 16px 0}",
    ".ovz-top{top:0;display:flex;align-items:center;gap:8px}",
    ".ovz-bot{bottom:0;padding:0 16px calc(18px + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}",
    ".ovz-b{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:44px;min-height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(8,8,13,.55);color:inherit;font:inherit;font-size:14px;padding:0 14px;cursor:pointer}",
    ".ovz-b svg{width:22px;height:22px;flex:none}",
    ".ovz-b:focus-visible{outline:2px solid #fff;outline-offset:2px}",
    ".ovz-x{border:0;background:transparent;padding:0}",
    ".ovz-p{width:64px;height:64px;padding:0;background:#f3f3f8;color:#08080d;border:0}",
    ".ovz-p svg{width:30px;height:30px}",
    ".ovz-t{font-size:22px;font-weight:800;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 4px #000}",
    ".ovz-s{font-size:14px;opacity:.8;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 4px #000}",
    ".ovz-row{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}",
    ".ovz-note{font-size:13px;opacity:.8;max-width:460px;line-height:1.4;margin:0;text-shadow:0 1px 3px #000}",
    ".ovz-note[hidden]{display:none}",
    ".ovz-back{display:none;position:absolute;z-index:2;top:max(10px,env(safe-area-inset-top));left:10px;opacity:.7}",
    ".ovz-imm .ovz-top,.ovz-imm .ovz-bot{visibility:hidden}",
    ".ovz-imm .ovz-back{display:inline-flex}",
    "@media (max-width:380px){.ovz-b{font-size:13px;padding:0 10px}.ovz-t{font-size:19px}}"
  ].join("\n");
  function stage(o) {
    o = o || {};
    var doc = o.doc || root.document, l = o.lang;
    if (!doc.getElementById("ovz-css")) {
      var css = doc.createElement("style");
      css.id = "ovz-css";
      css.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(css);
    }
    var mk = function (tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    var btn = function (cls, icon, text, label, fn) {
      var b = mk("button", "ovz-b " + cls);
      b.type = "button";
      b.innerHTML = ICON[icon];
      if (text) b.appendChild(mk("span", "", text));
      b.setAttribute("aria-label", label); b.title = label;
      b.addEventListener("click", fn);
      return b;
    };
    var style = normStyle(o.style), v = null, why = "", live = true;
    var dlg = mk("dialog", "ovz-stage");
    dlg.setAttribute("aria-label", label("btn", l));
    var cv = mk("canvas", "ovz-c"); cv.setAttribute("aria-hidden", "true");
    var top = mk("div", "ovz-top"), bot = mk("div", "ovz-bot");
    top.appendChild(btn("ovz-x", "close", "", label("close", l), function () { dlg.close(); }));
    var tt = mk("div", "ovz-t"), ts = mk("div", "ovz-s");
    var play = btn("ovz-p", "play", "", label("play", l), function () { try { o.toggle(); } catch (e) {} paint(); });
    var stB = btn("ovz-st", "light", label("style", l, { s: label(style, l) }), "", function () {
      style = nextStyle(style);
      if (v) v.setStyle(style);
      try { if (o.onStyle) o.onStyle(style); } catch (e) {}
      paint();
    });
    var imB = btn("ovz-im", "expand", label("immersive", l), label("immersive", l), function () { imm(true); });
    var row = mk("div", "ovz-row");
    row.appendChild(play); row.appendChild(stB); row.appendChild(imB);
    var note = mk("p", "ovz-note"); note.setAttribute("aria-live", "polite"); note.hidden = true;
    bot.appendChild(tt); bot.appendChild(ts); bot.appendChild(row); bot.appendChild(note);
    var back = btn("ovz-back ovz-x", "close", "", label("back", l), function (e) { e.stopPropagation(); imm(false); });
    dlg.appendChild(cv); dlg.appendChild(top); dlg.appendChild(bot); dlg.appendChild(back);
    function imm(on) {
      dlg.classList.toggle("ovz-imm", !!on);
      try { (on ? back : imB).focus({ preventScroll: true }); } catch (e) {}
    }
    dlg.addEventListener("cancel", function (e) { if (dlg.classList.contains("ovz-imm")) { e.preventDefault(); imm(false); } });
    dlg.addEventListener("click", function (e) { if (dlg.classList.contains("ovz-imm") && !back.contains(e.target)) { e.stopImmediatePropagation(); imm(false); } }, true);
    dlg.addEventListener("keydown", function (e) { if (dlg.classList.contains("ovz-imm") && e.key !== "Escape" && e.key !== "Tab") imm(false); });
    function playing() { try { return !!o.playing(); } catch (e) { return false; } }
    function paint() {
      var t1 = "", t2 = "";
      try { t1 = o.title ? o.title() || "" : ""; t2 = o.sub ? o.sub() || "" : ""; } catch (e) {}
      if (tt.textContent !== t1) tt.textContent = t1;
      if (ts.textContent !== t2) ts.textContent = t2;
      var p = playing();
      if (play._p !== p) {
        play._p = p;
        play.innerHTML = ICON[p ? "pause" : "play"];
        play.setAttribute("aria-label", label(p ? "pause" : "play", l)); play.title = play.getAttribute("aria-label");
      }
      stB.lastChild.textContent = label("style", l, { s: label(style, l) });
      stB.setAttribute("aria-label", label("style", l, { s: label(style, l) }) + " · " + label("next", l));
      if (p) {
        var fr = null;
        try { fr = o.source ? o.source() : null; } catch (e) {}
        live = !!(fr && fr.live);
      } else live = true;
      var msg = why ? label(why, l) : !live ? label("calm", l) : "";
      if (note.textContent !== msg) note.textContent = msg;
      note.hidden = !msg;
      if (v && p) v.wake();
    }
    dlg.addEventListener("close", function () {
      if (v) { v.destroy(); v = null; }
      try { dlg.remove(); } catch (e) {}
      try { if (o.onClose) o.onClose(); } catch (e) {}
    });
    doc.body.appendChild(dlg);
    try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    v = create(cv, {
      style: style, source: o.source, playing: playing, colors: o.colors,
      area: function () {
        if (dlg.classList.contains("ovz-imm")) return null;
        var a = top.getBoundingClientRect(), b = bot.getBoundingClientRect(), d = dlg.getBoundingClientRect();
        return { x: 0, y: a.bottom - d.top, w: d.width, h: Math.max(0, b.top - a.bottom) };
      },
      onState: function (r) { why = r; paint(); }
    });
    paint();
    return { el: dlg, paint: paint, close: function () { try { dlg.close(); } catch (e) {} }, style: function () { return style; } };
  }

  var api = {
    v: VER, STYLES: STYLES, create: create, stage: stage, label: label, normStyle: normStyle, nextStyle: nextStyle,
    bands: bands, smooth: smooth, gain: gain, idle: idle, stillReason: stillReason, beatStep: beatStep, isSlow: isSlow, slowWait: slowWait, BOOT_MS: BOOT_MS, REST: REST, restGap: restGap,
    rgb: rgb, palette: palette, fit: fit, bars: bars, STR: STR
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosViz = api;
})(typeof window !== "undefined" ? window : this);
