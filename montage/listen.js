// ============================================================
// orOS — live dictation on the device (DICT-2): the microphone →
// 16 kHz → Silero VAD (vad.js) cuts it into phrases at the pauses →
// each phrase to Whisper (asr.js) while the person keeps talking → the
// text, phrase by phrase, in order. No Web Speech, nothing leaves the
// device. Used by Notes (Dictate) and the Assistant (voice input).
//   OrosListen.start({
//     lang: "el"|"en"|"de"|"auto", model: "tiny"|"base"|…,
//     onText(text),            a phrase's text, in speaking order
//     onState(st, info),       "load" (info = 0..1), "listen", "speak",
//                              "write" (phrases waiting), "done", "error" (info = code)
//     waitFirst: ms,           stop when nobody speaks this long at the start (8000)
//     waitAfter: ms,           stop this long after the last phrase (3000; 0 = never)
//     maxMs: ms                stop after this long in any case (10 minutes)
//   }) → { stop(), cancel() }
//   OrosListen.can() → bool (microphone, Web Audio, IndexedDB)
// Needs montage/asr.js and montage/vad.js loaded (OrosListen.load()
// loads them next to this file).
// The pure step (resampler) is unit-tested in node.
// UMD: module.exports in Node, window.OrosListen in the browser.
// ============================================================
(function (root) {
  "use strict";

  var SR = 16000;
  // Any rate → 16 kHz, block by block, keeping the fraction between
  // blocks: each output sample is the mean of the input samples it
  // covers (a box filter: enough for speech, no aliasing whistle).
  function Resampler(rate) {
    this.step = rate / SR; this.pos = 0; this.acc = 0; this.n = 0;
  }
  Resampler.prototype.push = function (input) {
    var out = new Float32Array(Math.ceil((input.length + 1) / this.step) + 1), k = 0;
    for (var i = 0; i < input.length; i++) {
      this.acc += input[i]; this.n++; this.pos += 1;
      if (this.pos >= this.step) { out[k++] = this.acc / this.n; this.acc = 0; this.n = 0; this.pos -= this.step; }
    }
    return out.subarray(0, k);
  };
  function joinText(a, b) {
    a = a || ""; b = String(b || "").trim();
    if (!b) return a;
    if (!a) return b;
    return /[\s(\[«"'“]$/.test(a) ? a + b : a + " " + b;
  }

  var pure = { Resampler: Resampler, joinText: joinText, SR: SR };
  if (typeof module === "object" && module.exports) { module.exports = pure; return; }

  // ---------- Browser ----------
  function can() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
      (root.AudioContext || root.webkitAudioContext) && root.indexedDB && root.crypto && crypto.subtle);
  }
  var here = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/[^/]*$/, "") : "../montage/";
  })();
  var ver = (function () {
    var s = document.currentScript && document.currentScript.src, m = s && s.match(/[?&]v=([^&#]+)/);
    return m ? "?v=" + m[1] : "";
  })();
  function script(name, ok) {
    if (ok()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var sc = document.createElement("script");
      sc.src = here + name + ver;
      sc.onload = function () { ok() ? resolve() : reject(new Error("load")); };
      sc.onerror = function () { sc.remove(); reject(new Error("load")); };
      document.head.appendChild(sc);
    });
  }
  function load() {
    return script("asr.js", function () { return !!(root.MontageASR && root.MontageASR.runtime); }).then(function () {
      return script("vad.js", function () { return !!root.OrosVAD; });
    });
  }

  function start(o) {
    o = o || {};
    var state = function (st, info) { if (o.onState) try { o.onState(st, info); } catch (e) {} };
    var dead = false, stream = null, ctx = null, node = null, src = null, vs = null, rs = null;
    var queue = Promise.resolve(), waiting = 0, spoke = false, lastPhrase = Date.now(), began = Date.now(), timer = 0;
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var waitFirst = o.waitFirst > 0 ? o.waitFirst : 8000, waitAfter = o.waitAfter >= 0 ? o.waitAfter : 3000, maxMs = o.maxMs > 0 ? o.maxMs : 600000;

    function release() {
      clearInterval(timer);
      try { if (node) { node.onaudioprocess = null; node.disconnect(); } } catch (e) {}
      try { if (src) src.disconnect(); } catch (e) {}
      try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { if (ctx && ctx.close) ctx.close(); } catch (e) {}
      node = src = stream = ctx = null;
    }
    function fail(code) {
      if (dead) return;
      dead = true; release();
      if (vs) vs.close();
      state("error", code);
    }
    function phrase(samples) {
      if (dead && !finishing) return;
      waiting++; lastPhrase = Date.now();
      state("write", waiting);
      queue = queue.then(function () {
        return root.MontageASR.run(samples, { lang: o.lang || "auto", model: o.model, signal: ctl ? ctl.signal : undefined,
          cancelled: function () { return cancelled; } });
      }).then(function (r) {
        var text = ((r && r.cues) || []).map(function (c) { return c.text; }).join(" ").replace(/\s+/g, " ").trim();
        if (text && !cancelled && o.onText) o.onText(text);
      }, function () {}).then(function () {
        waiting--; lastPhrase = Date.now();
        if (!cancelled && !finishing) state(waiting ? "write" : "listen", waiting);
      });
    }
    var cancelled = false, finishing = false;
    function finish() {
      if (finishing || cancelled) return;
      finishing = true;
      var done = function () {
        dead = true; release();
        queue.then(function () { if (!cancelled) state("done"); });
      };
      if (vs) vs.flush().then(done, done); else done();
    }

    state("load", 0);
    load().then(function () {
      if (cancelled) throw new Error("cancelled");
      // the models first (a download is asked for before start() is called)
      return root.MontageASR.prepare(o.model, function (f) { state("load", f * 0.9); }, ctl ? ctl.signal : undefined);
    }).then(function () {
      vs = root.OrosVAD.stream({
        pause: 0.7, onDownload: function () {},
        onStart: function () { spoke = true; state("speak"); },
        onPhrase: phrase
      });
      return vs.ready;
    }).then(function () {
      if (cancelled) throw new Error("cancelled");
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    }).then(function (s) {
      if (cancelled) { s.getTracks().forEach(function (t) { t.stop(); }); throw new Error("cancelled"); }
      stream = s;
      var AC = root.AudioContext || root.webkitAudioContext;
      ctx = new AC();
      rs = new Resampler(ctx.sampleRate);
      src = ctx.createMediaStreamSource(stream);
      node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = function (e) {
        if (finishing || cancelled) return;
        var lo = rs.push(e.inputBuffer.getChannelData(0));
        if (lo.length) vs.push(lo);
      };
      src.connect(node);
      node.connect(ctx.destination);   // ScriptProcessor runs only when connected (it writes silence)
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      began = Date.now(); lastPhrase = began;
      state("listen");
      timer = setInterval(function () {
        if (finishing || cancelled) return;
        var now = Date.now();
        if (now - began > maxMs) { finish(); return; }
        if (!spoke && now - began > waitFirst) { finish(); return; }
        if (spoke && waitAfter && !waiting && now - lastPhrase > waitAfter && !(vs && vs.speaking && vs.speaking())) finish();
      }, 250);
    }).catch(function (e) {
      if (cancelled) return;
      var n = e && (e.name || ""), m = String(e && e.message || e);
      fail(n === "NotAllowedError" || n === "SecurityError" ? "denied" : n === "NotFoundError" ? "nomic" :
        /^http|fetch|network|hash|load/i.test(m) ? "net" : "fail");
    });

    return {
      stop: finish,
      cancel: function () {
        cancelled = true; dead = true;
        if (ctl) ctl.abort();
        release();
        if (vs) vs.close();
      }
    };
  }

  root.OrosListen = { can: can, load: load, start: start, joinText: joinText };
})(typeof window !== "undefined" ? window : this);
