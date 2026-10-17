// ============================================================
// orOS Flashcards — pictures, sounds and voices (FlashcardsMedia)
// Browser side of the media rules in core.js:
//   - a picture is redrawn on a canvas (long side ≤ 1600 px, JPEG
//     0.85), so EXIF data and location never reach the disk;
//   - a sound is kept as given (≤ 10 MB, mp3/ogg/opus/m4a/wav/webm);
//   - the file name is the SHA-256 of the bytes, in
//     /internal/Flashcards/Media, written once and never rewritten;
//   - recording uses MediaRecorder on this device only;
//   - Read aloud uses speechSynthesis with LOCAL voices only
//     (localService === true; NO GOOGLE LOGGING rule).
// ============================================================
(function (root) {
  "use strict";
  var C = root.FlashcardsCore;
  var IMG_MAX = 1600, JPEG_Q = 0.85, AUDIO_MAX = 10 * 1024 * 1024, IMG_IN_MAX = 40 * 1024 * 1024;
  var REC_MAX_MS = 5 * 60000;

  function fail(code) { var e = new Error(code); e.code = code; return e; }

  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function sha256(blob) {
    if (!(root.crypto && root.crypto.subtle)) return Promise.reject(fail("nocrypto"));
    return blob.arrayBuffer().then(function (buf) { return root.crypto.subtle.digest("SHA-256", buf); }).then(hex);
  }

  function decode(blob) {
    if (typeof root.createImageBitmap === "function") {
      return root.createImageBitmap(blob).catch(function () { return viaImg(blob); });
    }
    return viaImg(blob);
  }
  function viaImg(blob) {
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { ok(img); setTimeout(function () { URL.revokeObjectURL(url); }, 0); };
      img.onerror = function () { URL.revokeObjectURL(url); no(fail("badimage")); };
      img.src = url;
    });
  }
  // Picture → { blob (JPEG), ext "jpg" }.
  function redraw(blob) {
    if (blob.size > IMG_IN_MAX) return Promise.reject(fail("toobig"));
    return decode(blob).then(function (img) {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) throw fail("badimage");
      var sz = C.fitSize(w, h, IMG_MAX);
      var cv = document.createElement("canvas");
      cv.width = sz.w; cv.height = sz.h;
      var g = cv.getContext("2d");
      g.fillStyle = "#fff";                 // transparent parts become white, not black
      g.fillRect(0, 0, sz.w, sz.h);
      g.drawImage(img, 0, 0, sz.w, sz.h);
      if (img.close) try { img.close(); } catch (e) { /* not a bitmap */ }
      return new Promise(function (ok, no) {
        cv.toBlob(function (b) { if (b) ok({ blob: b, ext: "jpg" }); else no(fail("badimage")); }, "image/jpeg", JPEG_Q);
      });
    });
  }
  // Any picked, pasted, dropped or recorded file → { name, blob, kind "img"|"aud", url }.
  // Nothing is written yet: the editor writes on Save (write()).
  function prepare(file) {
    if (!file) return Promise.reject(fail("badtype"));
    var ext = C.mediaExt(file.type, file.name);
    if (!ext) return Promise.reject(fail("badtype"));
    var kind = /^(jpg|png|webp|gif)$/.test(ext) ? "img" : "aud";
    var step = kind === "img" ? redraw(file)
      : (file.size > AUDIO_MAX ? Promise.reject(fail("toobig")) : Promise.resolve({ blob: file, ext: ext }));
    return step.then(function (r) {
      return sha256(r.blob).then(function (h) {
        var name = h + "." + r.ext;
        var blob = r.blob.type ? r.blob : new Blob([r.blob], { type: C.mediaMime(name) });
        remember(name, blob);
        return { name: name, blob: blob, kind: kind, url: cache[name] };
      });
    });
  }
  // Write one prepared file unless it is already on the disk.
  function write(Fs, item) {
    var path = C.MEDIA_DIR + "/" + item.name;
    return Promise.resolve(Fs.stat ? Fs.stat(path) : null).then(function (st) { return !!st; }, function () { return false; })
      .then(function (there) { return there ? true : Fs.write(path, item.blob).then(function () { return true; }); });
  }

  // ---------- object URLs (kept for the last 200 files) ----------
  var cache = {}, order = [], pending = {};
  function remember(name, blob) {
    if (cache[name]) return cache[name];
    cache[name] = URL.createObjectURL(blob);
    order.push(name);
    while (order.length > 200) {
      var old = order.shift();
      try { URL.revokeObjectURL(cache[old]); } catch (e) { /* gone */ }
      delete cache[old];
    }
    return cache[name];
  }
  // name → object URL, or null when the file is not on this device (yet).
  function url(Fs, name) {
    if (!C.mediaKind(name)) return Promise.resolve(null);
    if (cache[name]) return Promise.resolve(cache[name]);
    if (!Fs || typeof Fs.read !== "function") return Promise.resolve(null);
    if (pending[name]) return pending[name];
    pending[name] = Fs.read(C.MEDIA_DIR + "/" + name).then(function (blob) {
      delete pending[name];
      if (!blob || !blob.size) return null;
      var typed = blob.type ? blob : new Blob([blob], { type: C.mediaMime(name) });
      return remember(name, typed);
    }, function () { delete pending[name]; return null; });
    return pending[name];
  }

  // ---------- recording ----------
  function canRecord() {
    return typeof root.MediaRecorder === "function" && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
  function recType() {
    var list = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
    if (!root.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    return "";
  }
  // Starts recording. Returns { stop() → Promise<File>, cancel() }; stops by itself after 5 minutes.
  function record(onAutoStop) {
    return navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (stream) {
      var type = recType(), chunks = [], done = null, timer = 0;
      var rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      var finished = new Promise(function (ok) { done = ok; });
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        clearTimeout(timer);
        stream.getTracks().forEach(function (t) { t.stop(); });
        var mt = (rec.mimeType || type || "audio/webm").split(";")[0];
        var ext = C.mediaExt(mt, "") || "webm";
        done(new File(chunks, "recording." + ext, { type: mt }));
      };
      rec.start();
      timer = setTimeout(function () { if (rec.state !== "inactive") { rec.stop(); if (onAutoStop) onAutoStop(); } }, REC_MAX_MS);
      return {
        stop: function () { if (rec.state !== "inactive") rec.stop(); return finished; },
        cancel: function () { chunks = []; if (rec.state !== "inactive") rec.stop(); }
      };
    });
  }

  // ---------- Read aloud (local voices only) ----------
  function synth() { return root.speechSynthesis || null; }
  function voices() { var s = synth(); try { return s ? s.getVoices() || [] : []; } catch (e) { return []; } }
  function hasVoices() { return C.voiceLangs(voices()).length > 0; }
  function onVoices(fn) {
    var s = synth();
    if (s && s.addEventListener) s.addEventListener("voiceschanged", fn);
  }
  // parts = [{ text, lang }]. Returns false when no local voice reads any part.
  function speak(parts) {
    var s = synth();
    if (!s || typeof root.SpeechSynthesisUtterance !== "function") return false;
    stopSpeaking();
    var any = false, vs = voices();
    parts.forEach(function (p) {
      var text = String(p.text || "").replace(/\s+/g, " ").trim();
      var v = C.localVoice(vs, p.lang);
      if (!text || !v) return;
      var u = new SpeechSynthesisUtterance(text.slice(0, 4000));
      u.voice = v;
      u.lang = v.lang;
      s.speak(u);
      any = true;
    });
    return any;
  }
  function stopSpeaking() { var s = synth(); try { if (s) s.cancel(); } catch (e) { /* none */ } }

  root.FlashcardsMedia = {
    prepare: prepare, write: write, url: url,
    canRecord: canRecord, record: record,
    voices: voices, hasVoices: hasVoices, onVoices: onVoices, speak: speak, stopSpeaking: stopSpeaking,
    AUDIO_MAX: AUDIO_MAX, IMG_MAX: IMG_MAX
  };
})(window);
