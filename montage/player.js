// ============================================================
// orOS Montage — preview player.
// Plays a project on a canvas with the browser's own <video>/<audio>
// elements as sources (hardware decoding) and MontageGL to draw them,
// so the preview and the export share one recipe (framePlan,
// soundPlan). Sound goes element → gain → speakers (Web Audio), so a
// volume above 100 % and fades work like in the export.
//
//   var pl = MontagePlayer.create({ canvas, media: id → Promise<Blob|null>,
//     proxy?: id → Promise<Blob|null> (light copy), onTime(t), onState(playing) })
//   pl.setProject(p)   after every edit (keeps the time)
//   pl.seek(t)         shows the frame at t
//   pl.play() / pl.pause() / pl.toggle(); pl.time(); pl.playing()
//   pl.grab(short)     → Promise<PNG Blob> of the frame at the playhead
//   pl.dispose()
// Elements exist only for clips near the playhead (phones allow only
// a few video decoders at once); far ones are released.
// ============================================================
(function (root) {
  "use strict";

  var NEAR_BEFORE = 1, NEAR_AFTER = 4, DRIFT = 0.25;

  function create(opts) {
    var C = root.MontageCore, G = root.MontageGL;
    var canvas = opts.canvas, comp = G.create(canvas);
    var p = null, t = 0, playing = false, t0 = 0, wall0 = 0, raf = 0, dur = 0;
    var urls = {}, els = {}, pics = {}, missing = {};
    var actx = null, gains = {};
    var onTime = opts.onTime || function () {}, onState = opts.onState || function () {};
    var drawQueued = false, disposed = false;

    // a video's light copy (opts.proxy) when the device has one
    function url(id) {
      if (!urls[id]) {
        urls[id] = Promise.resolve(opts.proxy ? opts.proxy(id) : null).then(null, function () { return null; })
          .then(function (px) { return px || opts.media(id); }).then(function (b) {
          if (!b) { missing[id] = 1; delete urls[id]; return null; }
          delete missing[id];
          return URL.createObjectURL(b);
        }, function () { missing[id] = 1; delete urls[id]; return null; });
      }
      return urls[id];
    }
    function picture(id) {
      if (!pics[id]) {
        pics[id] = { ready: null, p: opts.media(id).then(function (b) {
          if (!b) { missing[id] = 1; delete pics[id]; return; }
          return createImageBitmap(b).then(function (bmp) { if (pics[id]) { pics[id].ready = bmp; queueDraw(); } });
        }, function () { delete pics[id]; }) };
      }
      return pics[id].ready;
    }

    // One media element per clip id (the video clip's picture and sound
    // come from the same element). A clip whose sound was cleaned (na)
    // has a second, sound-only element "<id>~na" for the cleaned file.
    function element(n) {
      var e = els[n.key];
      if (e && e.src === n.src) return e;
      if (e) release(n.key);
      var m = document.createElement(n.tag);
      m.preload = "auto"; m.playsInline = true; m.crossOrigin = "anonymous";
      if ("preservesPitch" in m) m.preservesPitch = false;    // same as the export
      e = els[n.key] = { el: m, src: n.src, ready: false, seeking: false, wantT: -1, gain: null };
      m.addEventListener("loadeddata", function () { e.ready = true; queueDraw(); });
      m.addEventListener("seeked", function () { e.seeking = false; queueDraw(); });
      url(n.src).then(function (u) { if (u && els[n.key] === e) m.src = u; });
      return e;
    }
    function release(id) {
      var e = els[id];
      if (!e) return;
      try { e.el.pause(); } catch (x) {}
      if (e.gain) { try { e.node.disconnect(); e.gain.disconnect(); } catch (x) {} }
      e.el.removeAttribute("src");
      try { e.el.load(); } catch (x) {}
      delete els[id];
    }
    function audioOut(e) {
      if (!actx || e.gain) return;
      try {
        e.node = actx.createMediaElementSource(e.el);
        e.gain = actx.createGain();
        e.node.connect(e.gain); e.gain.connect(actx.destination);
      } catch (x) { e.gain = null; }
    }

    function itemsNear(time) {
      var out = {};
      if (!p) return out;
      Object.keys(p.items).forEach(function (k) {
        var it = p.items[k];
        if (it.k !== "video" && it.k !== "audio") return;
        var pl = C.placeOf(p, k);
        if (!(pl && pl.end > time - NEAR_BEFORE && pl.start < time + NEAR_AFTER)) return;
        var tag = it.k === "audio" ? "audio" : "video";
        if (it.na && !it.rv && !it.mu) {
          out[k] = { key: k, it: it, pl: pl, src: it.src, tag: tag, snd: false };
          out[k + "~na"] = { key: k + "~na", it: it, pl: pl, src: it.na, tag: "audio", snd: true };
        } else out[k] = { key: k, it: it, pl: pl, src: it.src, tag: tag, snd: true };
      });
      return out;
    }

    // Bring every element to where it should be at `time`.
    function syncElements(time) {
      var near = itemsNear(time), sound = C.soundPlan(p), gainOf = {};
      sound.forEach(function (s) {
        var local = time - s.start;
        if (local >= 0 && local < s.dur) gainOf[s.id] = C.gainAt(s, local);
      });
      Object.keys(els).forEach(function (k) { if (!near[k]) release(k); });
      Object.keys(near).forEach(function (k) {
        var n = near[k], it = n.it, e = element(n);
        var local = time - n.pl.start, inside = local >= 0 && local < n.pl.end - n.pl.start;
        var want = C.srcTime(it, Math.max(0, local));
        // a speed curve changes the rate as the clip plays
        var rate = Math.max(0.0625, Math.min(16, C.rateAt(it, Math.max(0, local))));
        if (Math.abs(e.el.playbackRate - rate) > 0.005) { try { e.el.playbackRate = rate; } catch (x) {} }
        var g = n.snd ? (gainOf[it.id] || 0) : 0;
        if (playing) audioOut(e);
        if (e.gain) { e.gain.gain.value = g; e.el.muted = false; e.el.volume = 1; }
        else { e.el.muted = g === 0; e.el.volume = Math.min(1, g); }
        if (!e.ready) return;
        if (playing && inside && it.rv) {
          // backwards: the element stays paused and is moved frame by frame
          if (!e.el.paused) e.el.pause();
          if (!e.seeking && Math.abs(e.el.currentTime - want) > 0.03) { e.seeking = true; e.el.currentTime = want; }
        } else if (playing && inside) {
          if (Math.abs(e.el.currentTime - want) > DRIFT && !e.seeking) { e.seeking = true; e.el.currentTime = want; }
          if (e.el.paused) { var pr = e.el.play(); if (pr && pr["catch"]) pr["catch"](function () {}); }
        } else {
          if (!e.el.paused) e.el.pause();
          if (Math.abs(e.el.currentTime - want) > 0.02 && e.wantT !== want) { e.wantT = want; e.seeking = true; e.el.currentTime = want; }
        }
      });
    }

    function source(L) {
      if (L.k === "image" || L.k === "lut") {
        var b = picture(L.src);
        return b ? { img: b, w: b.width, h: b.height } : null;
      }
      if (L.k === "video") {
        var e = els[L.id];
        if (!e || !e.ready || e.el.readyState < 2) return null;
        return { img: e.el, w: e.el.videoWidth, h: e.el.videoHeight };
      }
      return null;
    }
    function draw() {
      drawQueued = false;
      if (!p || disposed) return;
      comp.draw(C.framePlan(p, t), source, { bg: p.bg });
    }
    function queueDraw() {
      if (drawQueued || playing) return;
      drawQueued = true;
      requestAnimationFrame(draw);
    }

    function frame() {
      raf = 0;
      if (!playing) return;
      t = t0 + (performance.now() - wall0) / 1000;
      if (t >= dur) { t = dur; pause(); onTime(t); draw(); return; }
      syncElements(t);
      draw();
      onTime(t);
      raf = requestAnimationFrame(frame);
    }

    function play() {
      if (!p || playing) return;
      if (!actx) { try { actx = new (root.AudioContext || root.webkitAudioContext)(); } catch (x) { actx = null; } }
      if (actx && actx.state === "suspended") actx.resume();
      if (t >= dur - 0.05) t = 0;
      playing = true; t0 = t; wall0 = performance.now();
      Object.keys(els).forEach(function (k) { audioOut(els[k]); });
      syncElements(t);
      onState(true);
      raf = requestAnimationFrame(frame);
    }
    function pause() {
      if (!playing) return;
      playing = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      Object.keys(els).forEach(function (k) { try { els[k].el.pause(); } catch (x) {} });
      onState(false);
      syncElements(t);
      queueDraw();
    }
    function seek(time) {
      t = Math.max(0, Math.min(dur, time || 0));
      if (playing) { t0 = t; wall0 = performance.now(); }
      syncElements(t);
      if (!playing) queueDraw();
    }
    function setProject(np) {
      p = np;
      dur = p ? C.duration(p) : 0;
      if (t > dur) t = dur;
      var size = C.outputSize(p ? p.ar : "16:9", 720);
      if (canvas.width !== size.w || canvas.height !== size.h) { canvas.width = size.w; canvas.height = size.h; }
      if (p) { syncElements(t); queueDraw(); }
    }
    function dispose() {
      disposed = true;
      pause();
      Object.keys(els).forEach(release);
      Object.keys(urls).forEach(function (k) { urls[k].then(function (u) { if (u) URL.revokeObjectURL(u); }); });
      Object.keys(pics).forEach(function (k) { if (pics[k].ready && pics[k].ready.close) pics[k].ready.close(); });
      urls = {}; pics = {};
      comp.dispose();
      if (actx) { try { actx.close(); } catch (x) {} }
    }
    // The frame at the playhead as a PNG, drawn at `short` px on the
    // short side (the preview canvas grows for one draw, then shrinks).
    function grab(short) {
      if (!p) return Promise.resolve(null);
      var size = C.outputSize(p.ar, short || 1080), w0 = canvas.width, h0 = canvas.height;
      canvas.width = size.w; canvas.height = size.h;
      comp.draw(C.framePlan(p, t), source, { bg: p.bg });
      var out = new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
      canvas.width = w0; canvas.height = h0;
      drawQueued = false; queueDraw();
      return out;
    }
    // A file that turned up later (relink, sync) is tried again.
    function retry() { missing = {}; urls = {}; pics = {}; Object.keys(els).forEach(release); if (p) { syncElements(t); queueDraw(); } }

    return {
      setProject: setProject, seek: seek, grab: grab, play: play, pause: pause, retry: retry,
      toggle: function () { if (playing) pause(); else play(); },
      time: function () { return t; }, playing: function () { return playing; },
      isMissing: function (id) { return !!missing[id]; },
      dispose: dispose, redraw: queueDraw
    };
  }

  root.MontagePlayer = { create: create };
})(typeof window !== "undefined" ? window : this);
