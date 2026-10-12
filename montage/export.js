// ============================================================
// orOS Montage — export: the project becomes a video file, frame by
// frame (not recorded in real time), with WebCodecs through the
// Mediabunny library (vendor/mediabunny.min.js, MPL-2.0).
//
//   MontageExport.pickFormat(w, h) → { ext, mime, vc, ac } | null
//     MP4 (H.264 + AAC, or Opus) where the browser can encode H.264,
//     else WebM (VP9 / VP8 / AV1 + Opus).
//   MontageExport.pickSoundFormat() → { ext, mime, ac }
//     sound only: M4A (AAC), else Ogg (Opus), else WAV (no encoder needed)
//   MontageExport.run(opts) → Promise<{ blob?, ext, mime, vc, ac, seconds }>
//     opts.project    a normalized project (MontageCore)
//     opts.file(id)   → Promise<Blob> of a media file on the orOS disk
//     opts.short      short side in pixels (720 | 1080 | 2160)
//     opts.writable   optional WritableStream (e.g. an OPFS file) that
//                     receives the file as it is written; without it
//                     the whole file comes back as opts → blob
//     opts.soundOnly  true: just the mixed sound (pickSoundFormat), no picture
//     opts.progress(f) 0..1;  opts.cancelled() → true stops the export
//
// Every frame is planned by MontageCore.framePlan and drawn by
// MontageGL, the same code the preview uses. Each video clip gets its
// own decoder only while it is on screen. Sound is mixed in windows of
// WIN seconds with an OfflineAudioContext (volume, fades, speed).
// ============================================================
(function (root) {
  "use strict";

  var WIN = 10;                 // seconds of sound mixed at a time
  var SR = 48000;

  function MB() {
    var m = root.Mediabunny;
    if (!m) throw new Error("The video library did not load.");
    return m;
  }

  function pickFormat(w, h) {
    var M = MB();
    return M.getFirstEncodableVideoCodec(["avc"], { width: w, height: h, bitrate: M.QUALITY_HIGH }).then(function (vc) {
      if (vc) {
        return M.getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: 2, sampleRate: SR }).then(function (ac) {
          return { ext: "mp4", mime: "video/mp4", vc: vc, ac: ac };
        });
      }
      return M.getFirstEncodableVideoCodec(["vp9", "vp8", "av1"], { width: w, height: h, bitrate: M.QUALITY_HIGH }).then(function (vc2) {
        if (!vc2) return null;
        return M.getFirstEncodableAudioCodec(["opus"], { numberOfChannels: 2, sampleRate: SR }).then(function (ac2) {
          return { ext: "webm", mime: "video/webm", vc: vc2, ac: ac2 };
        });
      });
    });
  }

  function pickSoundFormat() {
    var M = MB();
    return M.getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: 2, sampleRate: SR }).then(function (ac) {
      if (ac === "aac") return { ext: "m4a", mime: "audio/mp4", ac: ac };
      if (ac === "opus") return { ext: "ogg", mime: "audio/ogg", ac: ac };
      return { ext: "wav", mime: "audio/wav", ac: "pcm-s16" };
    }, function () { return { ext: "wav", mime: "audio/wav", ac: "pcm-s16" }; });
  }
  function soundFormat(M, ext, streaming) {
    if (ext === "m4a") return new M.Mp4OutputFormat({ fastStart: streaming ? false : "in-memory" });
    if (ext === "ogg") return new M.OggOutputFormat();
    return new M.WavOutputFormat();
  }

  // Sound only: the same mix as a video export, written without a picture.
  async function runSound(opts) {
    var M = MB(), C = root.MontageCore, p = opts.project;
    var cancelled = opts.cancelled || function () { return false; };
    var progress = opts.progress || function () {};
    var total = C.duration(p), sound = C.soundPlan(p);
    var fmt = await pickSoundFormat();
    var lib = new Library(opts.file);
    var target = opts.writable ? new M.StreamTarget(opts.writable, { chunked: true }) : new M.BufferTarget();
    var out = new M.Output({ format: soundFormat(M, fmt.ext, !!opts.writable), target: target });
    var asrc = new M.AudioBufferSource(fmt.ac === "pcm-s16" ? { codec: "pcm-s16" } : { codec: fmt.ac, bitrate: 192e3 });
    out.addAudioTrack(asrc);
    var t0 = performance.now();
    try {
      await out.start();
      await mixSound(p, sound, lib, asrc, Math.max(0.1, total), cancelled, progress);
      if (cancelled()) throw new Error("cancelled");
      await out.finalize();
      progress(1);
      var res = { ext: fmt.ext, mime: fmt.mime, vc: null, ac: fmt.ac, seconds: (performance.now() - t0) / 1000 };
      if (!opts.writable) res.blob = new Blob([target.buffer], { type: fmt.mime });
      return res;
    } catch (e) {
      try { await out.cancel(); } catch (e2) {}
      throw e;
    } finally {
      lib.close();
    }
  }

  // One open file per media id (shared by every clip that uses it).
  function Library(fileOf) {
    var M = MB(), inputs = {}, pics = {};
    this.input = function (id) {
      if (!inputs[id]) {
        inputs[id] = Promise.resolve(fileOf(id)).then(function (blob) {
          if (!blob) throw new Error("missing media: " + id);
          return new M.Input({ source: new M.BlobSource(blob), formats: M.ALL_FORMATS });
        });
      }
      return inputs[id];
    };
    this.picture = function (id) {
      if (!pics[id]) {
        pics[id] = Promise.resolve(fileOf(id)).then(function (blob) {
          if (!blob) throw new Error("missing media: " + id);
          return createImageBitmap(blob);
        }).then(function (bmp) { return { img: bmp, w: bmp.width, h: bmp.height }; });
      }
      return pics[id];
    };
    this.close = function () {
      Object.keys(inputs).forEach(function (k) { inputs[k].then(function (i) { if (i.dispose) i.dispose(); }, function () {}); });
      Object.keys(pics).forEach(function (k) { pics[k].then(function (p) { if (p.img.close) p.img.close(); }, function () {}); });
    };
  }

  // Size a decoder output: the source's shape, no bigger than the frame.
  function sinkSize(vt, fw, fh) {
    var w = vt.displayWidth, h = vt.displayHeight, s = Math.min(1, Math.max(fw, fh) / Math.max(w, h));
    return { width: Math.max(2, Math.round(w * s / 2) * 2), height: Math.max(2, Math.round(h * s / 2) * 2) };
  }

  async function run(opts) {
    if (opts.soundOnly) return runSound(opts);
    var M = MB(), C = root.MontageCore, G = root.MontageGL;
    var p = opts.project, fps = p.fps, size = C.outputSize(p.ar, opts.short || 1080);
    var total = C.duration(p), N = Math.max(1, Math.round(total * fps));
    var cancelled = opts.cancelled || function () { return false; };
    var progress = opts.progress || function () {};
    var fmt = await pickFormat(size.w, size.h);
    if (!fmt) throw new Error("This browser cannot encode video at " + size.w + "×" + size.h + ".");

    // Pass 1: which source time each video clip shows on which frame.
    var times = {}, first = {}, last = {};
    for (var i = 0; i < N; i++) {
      C.framePlan(p, i / fps).forEach(function (L) {
        if (L.k !== "video") return;
        (times[L.id] = times[L.id] || []).push(L.st);
        if (!(L.id in first)) first[L.id] = i;
        last[L.id] = i;
      });
    }

    var lib = new Library(opts.file);
    var cv = document.createElement("canvas");
    cv.width = size.w; cv.height = size.h;
    var comp = G.create(cv);
    var target = opts.writable ? new M.StreamTarget(opts.writable, { chunked: true }) : new M.BufferTarget();
    var format = fmt.ext === "mp4" ? new M.Mp4OutputFormat({ fastStart: opts.writable ? false : "in-memory" }) : new M.WebMOutputFormat();
    var out = new M.Output({ format: format, target: target });
    var vsrc = new M.CanvasSource(cv, { codec: fmt.vc, bitrate: M.QUALITY_HIGH, keyFrameInterval: 2 });
    out.addVideoTrack(vsrc, { frameRate: fps });
    var sound = C.soundPlan(p), asrc = null;
    if (sound.length && fmt.ac) {
      asrc = new M.AudioBufferSource({ codec: fmt.ac, bitrate: 192e3 });
      out.addAudioTrack(asrc);
    }
    var t0 = performance.now();
    var streams = {};                                  // clip id → { it (iterator), cur }
    try {
      await out.start();
      var audioJob = asrc ? mixSound(p, sound, lib, asrc, N / fps, cancelled) : Promise.resolve();
      audioJob.catch(function () {});
      for (var f = 0; f < N; f++) {
        if (cancelled()) throw new Error("cancelled");
        var layers = C.framePlan(p, f / fps);
        var frame = {};
        for (var j = 0; j < layers.length; j++) {
          var L = layers[j];
          if (L.k === "video") {
            var s = streams[L.id];
            if (!s) {
              var inp = await lib.input(L.src), vt = await inp.getPrimaryVideoTrack();
              if (vt && await vt.canDecode()) {
                var off = await vt.getFirstTimestamp();
                var sink = new M.CanvasSink(vt, Object.assign({ fit: "fill", poolSize: 2 }, sinkSize(vt, size.w, size.h)));
                var ts = times[L.id].map(function (x) { return x + off; });
                s = streams[L.id] = { it: sink.canvasesAtTimestamps(ts) };
              } else s = streams[L.id] = { it: null };
            }
            if (s.it) {
              var r = await s.it.next();
              if (r.value && r.value.canvas) frame[L.id] = { img: r.value.canvas, w: r.value.canvas.width, h: r.value.canvas.height };
            }
            if (last[L.id] === f && s.it) { s.it.return(); s.it = null; }
          } else if (L.k === "image") {
            frame[L.id] = await lib.picture(L.src);
          }
        }
        comp.draw(layers, function (L) { return frame[L.id] || null; }, { bg: p.bg });
        await vsrc.add(f / fps, 1 / fps);
        if (f % 5 === 0) progress(f / N);
      }
      await audioJob;
      await out.finalize();
      progress(1);
      var res = { ext: fmt.ext, mime: fmt.mime, vc: fmt.vc, ac: asrc ? fmt.ac : null, seconds: (performance.now() - t0) / 1000 };
      if (!opts.writable) res.blob = new Blob([target.buffer], { type: fmt.mime });
      return res;
    } catch (e) {
      try { await out.cancel(); } catch (e2) {}
      throw e;
    } finally {
      Object.keys(streams).forEach(function (k) { if (streams[k].it) { try { streams[k].it.return(); } catch (e3) {} } });
      comp.dispose();
      lib.close();
    }
  }

  // Sound: windows of WIN seconds, each mixed offline and handed to the
  // encoder in order (so the timestamps run on without gaps).
  async function mixSound(p, sound, lib, asrc, length, cancelled, progress) {
    var C = root.MontageCore, M = MB();
    var tracks = {};
    function track(id) {
      if (!(id in tracks)) {
        tracks[id] = lib.input(id).then(function (inp) { return inp.getPrimaryAudioTrack(); }).then(function (at) {
          if (!at) return null;
          return at.canDecode().then(function (ok) {
            if (!ok) return null;
            return at.getFirstTimestamp().then(function (off) { return { sink: new M.AudioBufferSink(at), off: off }; });
          });
        }).catch(function () { return null; });
      }
      return tracks[id];
    }
    for (var w0 = 0; w0 < length - 1e-6; w0 += WIN) {
      if (cancelled()) return;
      var wl = Math.min(WIN, length - w0);
      var ctx = new OfflineAudioContext(2, Math.max(1, Math.round(wl * SR)), SR);
      for (var i = 0; i < sound.length; i++) {
        var seg = sound[i];
        var a = Math.max(seg.start, w0), b = Math.min(seg.start + seg.dur, w0 + wl);
        if (b - a <= 0.001) continue;
        var tr = await track(seg.src);
        if (!tr) continue;
        // gain curve for this window, every 10 ms
        var gain = ctx.createGain(), n = Math.max(2, Math.ceil((b - a) * 100) + 1), curve = new Float32Array(n);
        for (var k = 0; k < n; k++) curve[k] = C.gainAt(seg, a - seg.start + (b - a) * k / (n - 1));
        gain.gain.setValueAtTime(curve[0], a - w0);
        gain.gain.setValueCurveAtTime(curve, a - w0, Math.max(0.001, b - a));
        gain.connect(ctx.destination);
        var sa = seg["in"] + (a - seg.start) * seg.sp, sb = seg["in"] + (b - seg.start) * seg.sp;
        for await (var wb of tr.sink.buffers(sa + tr.off, sb + tr.off)) {
          var bt = wb.timestamp - tr.off;                       // seconds into the file
          var when = seg.start + (bt - seg["in"]) / seg.sp - w0;  // seconds into this window
          var node = ctx.createBufferSource();
          node.buffer = wb.buffer;
          node.playbackRate.value = seg.sp;
          node.connect(gain);
          var skip = 0;
          if (when < a - w0) { skip = (a - w0 - when) * seg.sp; when = a - w0; }
          if (skip >= wb.buffer.duration) continue;
          var play = Math.min((wb.buffer.duration - skip), (b - w0 - when) * seg.sp);
          if (play <= 0) continue;
          node.start(when, skip, play);
        }
      }
      var mixed = await ctx.startRendering();
      await asrc.add(mixed);
      if (progress) progress(Math.min(0.99, (w0 + wl) / length));
    }
  }

  var api = { pickFormat: pickFormat, pickSoundFormat: pickSoundFormat, run: run, WIN: WIN };
  root.MontageExport = api;
})(typeof window !== "undefined" ? window : this);
