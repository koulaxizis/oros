// ============================================================
// orOS Lyric Sync — the waveform timeline (wave 2)
// A canvas strip under the transport: the song's loudness, a window
// of a few seconds around the play position, the lines' starts (and,
// for the selected line, its words) as markers you can drag, and the
// play position. A tap or click on the strip away from a marker
// seeks there.
//   LyricsyncWave.peaks(blob) → Promise<{ rate, data: Float32Array }>
//     (100 values a second, the loudest sample of each 10 ms, all
//     channels; decoded on this device with Web Audio)
//   var w = LyricsyncWave.create(canvas, {
//     state() → { list: C.timed(…), sel, now, dur, peaks, span, words },
//     seek(ms), move(lineIndex, wordIndex | -1, ms) })
//   w.draw() · w.dragging() → bool
// ============================================================
(function (root) {
  "use strict";

  var RATE = 100, HIT = 10;

  function peaks(blob) {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return Promise.reject(new Error("no audio"));
    return blob.arrayBuffer().then(function (buf) {
      var ac = new AC();
      return new Promise(function (res, rej) {
        var p = ac.decodeAudioData(buf, res, rej);
        if (p && p.then) p.then(res, rej);
      }).then(function (ab) {
        var n = Math.ceil(ab.duration * RATE), out = new Float32Array(n), step = ab.sampleRate / RATE;
        for (var c = 0; c < ab.numberOfChannels; c++) {
          var d = ab.getChannelData(c);
          for (var k = 0; k < n; k++) {
            var a = Math.floor(k * step), b = Math.min(d.length, Math.floor((k + 1) * step)), m = out[k];
            for (var j = a; j < b; j += 4) { var v = d[j] < 0 ? -d[j] : d[j]; if (v > m) m = v; }
            out[k] = m;
          }
        }
        var max = 0;
        for (k = 0; k < n; k++) if (out[k] > max) max = out[k];
        if (max > 0) for (k = 0; k < n; k++) out[k] /= max;
        try { ac.close(); } catch (e) {}
        return { rate: RATE, data: out };
      }, function (e) { try { ac.close(); } catch (er) {} throw e; });
    });
  }

  function css(name, fb) {
    try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; } catch (e) { return fb; }
  }

  function create(canvas, o) {
    var ctx = canvas.getContext("2d"), view0 = 0, drag = null, W = 0, H = 0, dpr = 1;

    function size() {
      dpr = root.devicePixelRatio || 1;
      W = canvas.clientWidth; H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      }
    }
    function x2t(x) { var s = o.state(); return view0 + x / W * s.span; }
    function t2x(t) { var s = o.state(); return (t - view0) / s.span * W; }

    // Markers in view: [{ x, i, k }] (k = -1 for a line's start).
    function markers(s) {
      var out = [];
      s.list.forEach(function (x) {
        out.push({ t: x.s, i: x.i, k: -1 });
        if (x.i === s.sel && s.words) s.words.forEach(function (w, k) { if (w !== null && k > 0) out.push({ t: w, i: x.i, k: k }); });
      });
      return out;
    }

    function follow(s) {
      if (drag) return;
      var lead = s.span * 0.25;
      if (s.now < view0 + s.span * 0.1 || s.now > view0 + s.span * 0.85) view0 = Math.max(0, s.now - lead);
      if (s.dur) view0 = Math.min(view0, Math.max(0, s.dur - s.span));
    }

    function draw() {
      size();
      if (!W || !H) return;
      var s = o.state();
      follow(s);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = css("--panel-bg", "#1d1a13");
      ctx.fillRect(0, 0, W, H);
      var acc = css("--accent", "#d4af37"), dim = css("--text-dim", "#a89f8a"), txt = css("--text", "#f0ead9");
      // the selected line's span
      s.list.forEach(function (x) {
        if (x.i !== s.sel) return;
        var a = t2x(x.s), b = t2x(x.e);
        if (b < 0 || a > W) return;
        ctx.fillStyle = css("--accent-soft", "rgba(212,175,55,.2)");
        ctx.fillRect(a, 0, b - a, H);
      });
      // loudness
      if (s.peaks) {
        var pd = s.peaks.data, mid = H / 2, scale = (H / 2 - 4);
        ctx.fillStyle = dim;
        ctx.globalAlpha = 0.55;
        for (var px = 0; px < W; px += 2) {
          var ta = x2t(px), tb = x2t(px + 2), ka = Math.floor(ta / 1000 * s.peaks.rate), kb = Math.ceil(tb / 1000 * s.peaks.rate), m = 0;
          for (var k = Math.max(0, ka); k < Math.min(pd.length, kb); k++) if (pd[k] > m) m = pd[k];
          var h = Math.max(1, m * scale);
          ctx.fillRect(px, mid - h, 1.5, h * 2);
        }
        ctx.globalAlpha = 1;
      }
      // markers
      ctx.font = "11px system-ui, sans-serif";
      ctx.textBaseline = "top";
      markers(s).forEach(function (m) {
        var x = t2x(drag && drag.i === m.i && drag.k === m.k ? drag.t : m.t);
        if (x < -40 || x > W + 2) return;
        ctx.fillStyle = m.k < 0 ? acc : txt;
        ctx.fillRect(Math.round(x) - (m.k < 0 ? 1 : 0), m.k < 0 ? 0 : H * 0.25, m.k < 0 ? 2 : 1, m.k < 0 ? H : H * 0.5);
        if (m.k < 0) { ctx.fillText(String(m.i + 1), x + 3, 2); }
      });
      // play position
      var xp = t2x(s.now);
      if (xp >= 0 && xp <= W) { ctx.fillStyle = txt; ctx.fillRect(Math.round(xp), 0, 1, H); }
    }

    function hit(x) {
      var s = o.state(), best = null, bd = HIT + 1;
      markers(s).forEach(function (m) {
        var d = Math.abs(t2x(m.t) - x);
        // words win over a line start at the same place
        if (d < bd || (d === bd && m.k >= 0)) { bd = d; best = m; }
      });
      return bd <= HIT ? best : null;
    }
    function px(e) { var r = canvas.getBoundingClientRect(); return e.clientX - r.left; }

    canvas.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var x = px(e), m = hit(x);
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
      drag = m ? { i: m.i, k: m.k, t: m.t, moved: false, x0: x } : { seek: true, x0: x };
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!drag || drag.seek) return;
      var x = px(e);
      if (Math.abs(x - drag.x0) > 2) drag.moved = true;
      drag.t = Math.max(0, x2t(x));
      draw();
    });
    function up(e) {
      if (!drag) return;
      var d = drag;
      drag = null;
      if (d.seek) { if (e.type === "pointerup") o.seek(Math.max(0, x2t(px(e)))); }
      else if (d.moved && e.type === "pointerup") o.move(d.i, d.k, Math.round(d.t));
      else if (!d.moved && e.type === "pointerup") o.seek(d.t);
      draw();
    }
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    return { draw: draw, dragging: function () { return !!drag; }, reset: function () { view0 = 0; } };
  }

  root.LyricsyncWave = { peaks: peaks, create: create, RATE: RATE };
})(window);
