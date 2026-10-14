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
//     opts.gif        true: a silent looping GIF (at most GIF_MAX_SEC s), long
//                     side opts.gifSide px
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

  // A reversed clip asks for frames from late to early. Decoders only run
  // forwards, so the frames come in short runs: each run is decoded
  // forwards (one seek) and handed out backwards.
  var BACK_RUN = 15;
  function backwards(sink, ts) {
    var i = 0, buf = [], stopped = false;
    return {
      next: async function () {
        if (!buf.length) {
          if (stopped || i >= ts.length) return { done: true, value: undefined };
          var run = ts.slice(i, i + BACK_RUN);
          i += BACK_RUN;
          var got = [];
          for await (var wc of sink.canvasesAtTimestamps(run.slice().reverse())) got.push(wc);
          buf = got.reverse();
        }
        return { done: false, value: buf.shift() };
      },
      "return": function () { stopped = true; buf = []; return Promise.resolve({ done: true }); }
    };
  }

  // Size a decoder output: the source's shape, no bigger than the frame.
  function sinkSize(vt, fw, fh) {
    var w = vt.displayWidth, h = vt.displayHeight, s = Math.min(1, Math.max(fw, fh) / Math.max(w, h));
    return { width: Math.max(2, Math.round(w * s / 2) * 2), height: Math.max(2, Math.round(h * s / 2) * 2) };
  }

  // Draws frame f of N (at fps) of a project onto comp, with each video
  // clip read by its own decoder while it is on screen.
  function Frames(p, fps, N, size, lib, comp) {
    var M = MB(), C = root.MontageCore;
    // which source time each video clip shows on which frame
    var times = {}, last = {}, streams = {};
    for (var i = 0; i < N; i++) {
      C.framePlan(p, i / fps).forEach(function (L) {
        if (L.k !== "video") return;
        (times[L.id] = times[L.id] || []).push(L.st);
        last[L.id] = i;
      });
    }
    this.draw = async function (f) {
      var layers = C.framePlan(p, f / fps), frame = {};
      for (var j = 0; j < layers.length; j++) {
        var L = layers[j];
        if (L.k === "video") {
          var s = streams[L.id];
          if (!s) {
            var inp = await lib.input(L.src), vt = await inp.getPrimaryVideoTrack();
            if (vt && await vt.canDecode()) {
              var off = await vt.getFirstTimestamp();
              var ts = times[L.id].map(function (x) { return x + off; });
              if (p.items[L.id] && p.items[L.id].rv) {
                // every frame of a run is kept until handed out: no canvas pool
                s = streams[L.id] = { it: backwards(new M.CanvasSink(vt, Object.assign({ fit: "fill" }, sinkSize(vt, size.w, size.h))), ts) };
              } else {
                var sink = new M.CanvasSink(vt, Object.assign({ fit: "fill", poolSize: 2 }, sinkSize(vt, size.w, size.h)));
                s = streams[L.id] = { it: sink.canvasesAtTimestamps(ts) };
              }
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
        if (L.lut && !frame["lut:" + L.lut]) frame["lut:" + L.lut] = await lib.picture(L.lut).catch(function () { return null; });
      }
      comp.draw(layers, function (L) { return frame[L.id] || null; }, { bg: p.bg });
    };
    this.close = function () {
      Object.keys(streams).forEach(function (k) { if (streams[k].it) { try { streams[k].it.return(); } catch (e) {} } });
    };
  }

  async function run(opts) {
    if (opts.soundOnly) return runSound(opts);
    if (opts.gif) return runGif(opts);
    var M = MB(), C = root.MontageCore, G = root.MontageGL;
    var p = opts.project, fps = p.fps, size = C.outputSize(p.ar, opts.short || 1080);
    var total = C.duration(p), N = Math.max(1, Math.round(total * fps));
    var cancelled = opts.cancelled || function () { return false; };
    var progress = opts.progress || function () {};
    var fmt = await pickFormat(size.w, size.h);
    if (!fmt) throw new Error("This browser cannot encode video at " + size.w + "×" + size.h + ".");

    var lib = new Library(opts.file);
    var cv = document.createElement("canvas");
    cv.width = size.w; cv.height = size.h;
    var comp = G.create(cv);
    var frames = new Frames(p, fps, N, size, lib, comp);
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
    try {
      await out.start();
      var audioJob = asrc ? mixSound(p, sound, lib, asrc, N / fps, cancelled) : Promise.resolve();
      audioJob.catch(function () {});
      for (var f = 0; f < N; f++) {
        if (cancelled()) throw new Error("cancelled");
        await frames.draw(f);
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
      frames.close();
      comp.dispose();
      lib.close();
    }
  }

  // One frame at time t from the original files (never a light copy),
  // short side `short` px, as a PNG (Grab frame).
  async function still(opts) {
    var M = MB(), C = root.MontageCore, G = root.MontageGL, p = opts.project;
    var size = C.outputSize(p.ar, opts.short || 1080), lib = new Library(opts.file);
    var cv = document.createElement("canvas");
    cv.width = size.w; cv.height = size.h;
    var comp = G.create(cv);
    try {
      var layers = C.framePlan(p, opts.t || 0), frame = {};
      for (var j = 0; j < layers.length; j++) {
        var L = layers[j];
        if (L.k === "video") {
          var vt = await (await lib.input(L.src)).getPrimaryVideoTrack();
          if (vt && await vt.canDecode()) {
            var off = await vt.getFirstTimestamp();
            var wc = await new M.CanvasSink(vt, Object.assign({ fit: "fill" }, sinkSize(vt, size.w, size.h))).getCanvas(L.st + off);
            if (wc) frame[L.id] = { img: wc.canvas, w: wc.canvas.width, h: wc.canvas.height };
          }
        } else if (L.k === "image") frame[L.id] = await lib.picture(L.src);
        if (L.lut && !frame["lut:" + L.lut]) frame["lut:" + L.lut] = await lib.picture(L.lut).catch(function () { return null; });
      }
      comp.draw(layers, function (L) { return frame[L.id] || null; }, { bg: p.bg });
      return await new Promise(function (resolve) { cv.toBlob(resolve, "image/png"); });
    } finally {
      comp.dispose();
      lib.close();
    }
  }

  // ---------- GIF: a short silent loop ----------
  // GIF_FPS frames a second, the long side at most opts.gifSide px, one
  // palette of up to 256 colours per frame (the most used colours,
  // 5 bits a channel), LZW-packed as the format wants.
  var GIF_FPS = 12, GIF_MAX_SEC = 30;
  async function runGif(opts) {
    var C = root.MontageCore, G = root.MontageGL, p = opts.project;
    var cancelled = opts.cancelled || function () { return false; };
    var progress = opts.progress || function () {};
    var total = C.duration(p);
    if (total > GIF_MAX_SEC + 0.01) { var e = new Error("too long"); e.code = "gifLong"; throw e; }
    var side = opts.gifSide || 480, ratio = C.outputSize(p.ar, 1000);
    var k = side / Math.max(ratio.w, ratio.h), size = { w: Math.round(ratio.w * k / 2) * 2, h: Math.round(ratio.h * k / 2) * 2 };
    var N = Math.max(1, Math.round(total * GIF_FPS));
    var lib = new Library(opts.file);
    var cv = document.createElement("canvas");
    cv.width = size.w; cv.height = size.h;
    var comp = G.create(cv), frames = new Frames(p, GIF_FPS, N, size, lib, comp);
    var c2 = document.createElement("canvas");
    c2.width = size.w; c2.height = size.h;
    var g2 = c2.getContext("2d", { willReadFrequently: true });
    var gif = new GifWriter(size.w, size.h, Math.round(100 / GIF_FPS)), t0 = performance.now();
    try {
      for (var f = 0; f < N; f++) {
        if (cancelled()) throw new Error("cancelled");
        await frames.draw(f);
        g2.drawImage(cv, 0, 0);
        gif.frame(g2.getImageData(0, 0, size.w, size.h).data);
        if (f % 3 === 0) { progress(f / N); await new Promise(function (r) { setTimeout(r, 0); }); }
      }
      progress(1);
      return { ext: "gif", mime: "image/gif", vc: null, ac: null, blob: gif.finish(), seconds: (performance.now() - t0) / 1000 };
    } finally {
      frames.close();
      comp.dispose();
      lib.close();
    }
  }

  function GifWriter(w, h, delay) {
    var chunks = [], bytes = [];
    function flush() { if (bytes.length) { chunks.push(new Uint8Array(bytes)); bytes = []; } }
    function u8(v) { bytes.push(v & 255); }
    function u16(v) { bytes.push(v & 255, (v >> 8) & 255); }
    function str(s) { for (var i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)); }
    str("GIF89a"); u16(w); u16(h); u8(0x70); u8(0); u8(0);          // no global palette
    str("!\xFF\x0BNETSCAPE2.0"); u8(3); u8(1); u16(0); u8(0);      // loop forever
    var map = new Int16Array(32768);
    this.frame = function (rgba) {
      var n = w * h, hist = new Uint32Array(32768), idx = new Uint16Array(n), i;
      for (i = 0; i < n; i++) {
        var q = ((rgba[i * 4] >> 3) << 10) | ((rgba[i * 4 + 1] >> 3) << 5) | (rgba[i * 4 + 2] >> 3);
        idx[i] = q; hist[q]++;
      }
      var used = [];
      for (i = 0; i < 32768; i++) if (hist[i]) used.push(i);
      used.sort(function (a, b) { return hist[b] - hist[a]; });
      var pal = used.slice(0, 256);
      map.fill(-1);
      pal.forEach(function (q, j) { map[q] = j; });
      var pix = new Uint8Array(n);
      for (i = 0; i < n; i++) {
        var key = idx[i], m = map[key];
        if (m < 0) {                       // a rare colour: the nearest one in the palette
          var r = key >> 10, g = (key >> 5) & 31, b = key & 31, best = 0, bd = 1e9;
          for (var j = 0; j < pal.length; j++) {
            var pq = pal[j], dr = r - (pq >> 10), dg = g - ((pq >> 5) & 31), db = b - (pq & 31);
            var d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
            if (d < bd) { bd = d; best = j; }
          }
          m = map[key] = best;
        }
        pix[i] = m;
      }
      var bits = 1;
      while ((1 << bits) < pal.length) bits++;
      u8(0x21); u8(0xF9); u8(4); u8(0); u16(delay); u8(0); u8(0);      // frame delay
      u8(0x2C); u16(0); u16(0); u16(w); u16(h); u8(0x80 | (bits - 1));  // local palette
      for (i = 0; i < (1 << bits); i++) {
        var c = pal[i] || 0;
        u8(((c >> 10) << 3) | 4); u8((((c >> 5) & 31) << 3) | 4); u8(((c & 31) << 3) | 4);
      }
      lzw(pix, Math.max(2, bits));
      flush();
    };
    function lzw(pix, minBits) {
      u8(minBits);
      var clear = 1 << minBits, eoi = clear + 1, next, size, dict, out = [], acc = 0, nb = 0;
      function put(code) {
        acc |= code << nb; nb += size;
        while (nb >= 8) { out.push(acc & 255); acc >>>= 8; nb -= 8; }
      }
      function reset() { dict = new Map(); next = eoi + 1; size = minBits + 1; }
      reset(); put(clear);
      var cur = pix[0];
      for (var i = 1; i < pix.length; i++) {
        var k = cur * 4096 + pix[i], hit = dict.get(k);
        if (hit !== undefined) { cur = hit; continue; }
        put(cur);
        if (next < 4096) {
          dict.set(k, next++);
          if (next > (1 << size) && size < 12) size++;
        } else { put(clear); reset(); }
        cur = pix[i];
      }
      put(cur); put(eoi);
      if (nb > 0) out.push(acc & 255);
      for (var o = 0; o < out.length; o += 255) {
        var len = Math.min(255, out.length - o);
        u8(len);
        for (var q = 0; q < len; q++) bytes.push(out[o + q]);
      }
      u8(0);
    }
    this.finish = function () { u8(0x3B); flush(); return new Blob(chunks, { type: "image/gif" }); };
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
        // pieces of one rate each (one piece unless the clip has a speed
        // curve); every decoded buffer plays the part of a piece it holds
        var pieces = C.srcPieces(seg, a - seg.start, b - seg.start, 0.05), sa = Infinity, sb = -Infinity;
        pieces.forEach(function (pc) { sa = Math.min(sa, pc.s0); sb = Math.max(sb, pc.s1); });
        var bufs = [];
        for await (var wb of tr.sink.buffers(sa + tr.off, sb + tr.off)) bufs.push({ bt: wb.timestamp - tr.off, buf: wb.buffer });
        pieces.forEach(function (pc) {
          var rate = (pc.s1 - pc.s0) / (pc.t1 - pc.t0);
          if (!(rate > 0)) return;
          bufs.forEach(function (x) {
            var o0 = Math.max(pc.s0, x.bt), o1 = Math.min(pc.s1, x.bt + x.buf.duration);
            if (o1 - o0 <= 1e-6) return;
            var when = seg.start + pc.t0 + (o0 - pc.s0) / rate - w0;   // seconds into this window
            var node = ctx.createBufferSource();
            node.buffer = x.buf;
            node.playbackRate.value = rate;
            node.connect(gain);
            node.start(Math.max(0, when), o0 - x.bt, o1 - o0);
          });
        });
      }
      var mixed = await ctx.startRendering();
      await asrc.add(mixed);
      if (progress) progress(Math.min(0.99, (w0 + wl) / length));
    }
  }

  // The project's sound for speech to text: the same mix as an export,
  // folded to mono and brought down to 16 kHz window by window (so a
  // long project never holds its 48 kHz mix whole).
  //   opts = { project, file, cancelled, progress } → Float32Array at 16 kHz
  var SPEECH_MAX_SEC = 30 * 60;
  async function speech16k(opts) {
    var C = root.MontageCore, p = opts.project;
    var cancelled = opts.cancelled || function () { return false; };
    var total = Math.min(C.duration(p), SPEECH_MAX_SEC), sound = C.soundPlan(p);
    var out = new Float32Array(Math.ceil(total * 16000) + 16000), n = 0;
    var lib = new Library(opts.file);
    var sink = {
      add: function (ab) {
        var len = ab.length, mono = new Float32Array(len), chs = ab.numberOfChannels;
        for (var c = 0; c < chs; c++) { var d = ab.getChannelData(c); for (var i = 0; i < len; i++) mono[i] += d[i] / chs; }
        var lo = root.MontageASR.decimate3(mono);
        var take = Math.min(lo.length, out.length - n);
        out.set(lo.subarray(0, take), n); n += take;
        return Promise.resolve();
      }
    };
    try {
      await mixSound(p, sound, lib, sink, Math.max(0.1, total), cancelled, opts.progress);
    } finally {
      lib.close();
    }
    if (cancelled()) throw new Error("cancelled");
    return out.subarray(0, n);
  }

  var api = { pickFormat: pickFormat, pickSoundFormat: pickSoundFormat, run: run, still: still, speech16k: speech16k, SPEECH_MAX_SEC: SPEECH_MAX_SEC, WIN: WIN, GIF_MAX_SEC: GIF_MAX_SEC, GifWriter: GifWriter };
  root.MontageExport = api;
})(typeof window !== "undefined" ? window : this);
